"""Blender 5.3 无头建模 + Cycles 真实宇宙深空光影/AO 分组烘焙 + GLB 导出 + 诊断预览脚本。

运行方式：
    "C:\\Program Files\\Blender Foundation\\Blender 5.3\\blender.exe" --background --python scripts/room-blender/build_room.py

设计目标：
1. 多对象语义分组（Arch_Room / Hotspot_* / Arch_Bookcase / Decor_Lounge）并共享同一套无重叠 UVMap_Bake，使 Three.js 能沿建模边缘精准描边且共享单张 AO / Lightmap 贴图；
2. 新增开放边缘低矮天文观测围栏（+X / +Z 两侧）、平滑 48 段车削花盆与雕塑心形龟背竹叶片、流畅放样人体工学无线鼠标，并对准真实黑洞校准黄铜天文望远镜；
3. Cycles CPU + OpenImageDenoise 物理启发「纯黑宇宙真空 + 紫粉黑洞窗光轮廓光 + 室内局部暖灯」烘焙（40 samples），彻底告别灰蓝假天空光雾。
"""
from __future__ import annotations

import math
import os
from pathlib import Path
import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

OUT_DIR = Path(__file__).resolve().parent / "out"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# 书桌阅读垫上的生日蛋糕盘底中心（Three.js 世界坐标，阅读垫顶面 y = 0.769）
CAKE_DESK_ORIGIN = (-1.22, 0.769, -2.78)


def to_bl(tx: float, ty: float, tz: float) -> Vector:
    """Three.js (X右, Y上, Z前) -> Blender (X右, Y后, Z上)。glTF +Y Up 导出后严丝合缝还原。"""
    return Vector((tx, -tz, ty))


def local_pt(
    origin: tuple[float, float, float],
    rot_y: float,
    lp: tuple[float, float, float],
) -> tuple[float, float, float]:
    """将 Three.js 局部坐标 (lx, ly, lz) 绕 Y 轴旋转 rot_y 后平移到世界坐标 origin。"""
    c = math.cos(rot_y)
    s = math.sin(rot_y)
    return (
        origin[0] + lp[0] * c + lp[2] * s,
        origin[1] + lp[1],
        origin[2] - lp[0] * s + lp[2] * c,
    )


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_mat(
    name: str,
    color: tuple[float, float, float],
    roughness: float = 0.65,
    metallic: float = 0.0,
    emission: tuple[float, float, float] | None = None,
    emission_strength: float = 0.0,
    alpha: float = 1.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None and emission_strength > 0:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
    return mat


def set_smooth(mesh: bpy.types.Mesh, smooth: bool = True) -> None:
    if len(mesh.polygons) > 0:
        mesh.polygons.foreach_set("use_smooth", [smooth] * len(mesh.polygons))
    mesh.update()


def apply_box_uv(obj: bpy.types.Object, scale: float = 0.65) -> None:
    """为物体创建平整的米制世界比例盒式 UVMap（uv0），避免贴图拉伸。"""
    if obj.get("_keep_uv0"):
        return
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    me.uv_layers.active = me.uv_layers["UVMap"]
    bm = bmesh.new()
    bm.from_mesh(me)
    uv_lay = bm.loops.layers.uv.verify()
    world_mat = obj.matrix_world
    for face in bm.faces:
        n = (world_mat.to_3x3() @ face.normal).normalized()
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for loop in face.loops:
            p = world_mat @ loop.vert.co
            if az >= ax and az >= ay:
                u, v = p.x * scale, p.y * scale
            elif ax >= ay and ax >= az:
                u, v = p.y * scale, p.z * scale
            else:
                u, v = p.x * scale, p.z * scale
            loop[uv_lay].uv = (u, v)
    bm.to_mesh(me)
    bm.free()


def mark_uv_prio(obj: bpy.types.Object, prio: int) -> bpy.types.Object:
    obj["_uv_prio"] = prio
    return obj


def link_obj(obj: bpy.types.Object) -> bpy.types.Object:
    bpy.context.collection.objects.link(obj)
    return obj


def add_box(
    name: str,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    mat: bpy.types.Material,
    bevel: float = 0.008,
    bevel_segs: int = 1,
    rot_y: float = 0.0,
    rot_x: float = 0.0,
    rot_z: float = 0.0,
    smooth: bool = False,
) -> bpy.types.Object:
    wx, hy, dz = size
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(wx, dz, hy), verts=bm.verts)
    if bevel > 0.0:
        min_dim = min(wx, hy, dz)
        bw = min(bevel, min_dim * 0.32)
        bmesh.ops.bevel(
            bm,
            geom=list(bm.edges),
            offset=bw,
            segments=bevel_segs,
            profile=0.5,
            affect="EDGES",
            clamp_overlap=True,
        )
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    set_smooth(me, smooth or bevel_segs >= 2)
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    obj.location = to_bl(*center)
    obj.rotation_euler = Euler((rot_x, rot_z, rot_y), "XYZ")
    return link_obj(obj)


def add_cylinder(
    name: str,
    center: tuple[float, float, float],
    r_top: float,
    r_bot: float,
    height_y: float,
    mat: bpy.types.Material,
    segs: int = 16,
    rot_euler: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel_caps: float = 0.0,
    open_ended: bool = False,
) -> bpy.types.Object:
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=not open_ended,
        cap_tris=False,
        segments=segs,
        radius1=r_bot,
        radius2=r_top,
        depth=height_y,
    )
    if bevel_caps > 0.0 and not open_ended:
        cap_edges = [e for e in bm.edges if len(e.link_faces) == 2 and abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-4]
        if cap_edges:
            bmesh.ops.bevel(
                bm,
                geom=cap_edges,
                offset=min(bevel_caps, min(r_top, r_bot, height_y) * 0.35),
                segments=1,
                profile=0.5,
                affect="EDGES",
                clamp_overlap=True,
            )
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    set_smooth(me, True)
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    obj.location = to_bl(*center)
    obj.rotation_euler = Euler(rot_euler, "XYZ")
    return link_obj(obj)


def add_cylinder_between(
    name: str,
    p_a: tuple[float, float, float],
    p_b: tuple[float, float, float],
    r_a: float,
    r_b: float,
    mat: bpy.types.Material,
    segs: int = 18,
    open_ended: bool = False,
    bevel_caps: float = 0.0,
) -> bpy.types.Object:
    """在两个精确 Three.js 世界坐标点之间创建严丝合缝连接的圆柱/圆台，彻底消除角度/错位漂移。"""
    va = to_bl(*p_a)
    vb = to_bl(*p_b)
    vec = vb - va
    length = max(vec.length, 1e-4)
    direction = vec.normalized()
    up_hint = "X" if abs(direction.y) > 0.96 else "Y"
    quat = direction.to_track_quat("Z", up_hint)

    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=not open_ended,
        cap_tris=False,
        segments=segs,
        radius1=r_a,
        radius2=r_b,
        depth=length,
    )
    if bevel_caps > 0.0 and not open_ended:
        cap_edges = [e for e in bm.edges if len(e.link_faces) == 2 and abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-4]
        if cap_edges:
            bmesh.ops.bevel(
                bm,
                geom=cap_edges,
                offset=min(bevel_caps, min(r_a, r_b, length) * 0.32),
                segments=1,
                profile=0.5,
                affect="EDGES",
                clamp_overlap=True,
            )
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    set_smooth(me, True)
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    obj.location = (va + vb) * 0.5
    obj.rotation_euler = quat.to_euler("XYZ")
    return link_obj(obj)


def add_torus(
    name: str,
    center: tuple[float, float, float],
    major_r: float,
    minor_r: float,
    mat: bpy.types.Material,
    major_segs: int = 20,
    minor_segs: int = 8,
    rot_euler: tuple[float, float, float] = (0.0, 0.0, 0.0),
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0),
) -> bpy.types.Object:
    bm = bmesh.new()
    rings = []
    for i in range(major_segs):
        theta = (i / major_segs) * math.tau
        ct, st = math.cos(theta), math.sin(theta)
        ring = []
        for j in range(minor_segs):
            phi = (j / minor_segs) * math.tau
            r_xy = major_r + math.cos(phi) * minor_r
            ring.append(bm.verts.new((ct * r_xy * scale[0], st * r_xy * scale[2], math.sin(phi) * minor_r * scale[1])))
        rings.append(ring)
    for i in range(major_segs):
        ni = (i + 1) % major_segs
        for j in range(minor_segs):
            nj = (j + 1) % minor_segs
            bm.faces.new((rings[i][j], rings[ni][j], rings[ni][nj], rings[i][nj]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    set_smooth(me, True)
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    obj.location = to_bl(*center)
    obj.rotation_euler = Euler(rot_euler, "XYZ")
    return link_obj(obj)


def add_sphere(
    name: str,
    center: tuple[float, float, float],
    radius: float,
    mat: bpy.types.Material,
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0),
    segs: int = 12,
    rings: int = 8,
    rot_euler: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rot_y: float = 0.0,
) -> bpy.types.Object:
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=radius)
    bmesh.ops.scale(bm, vec=(scale[0], scale[2], scale[1]), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    set_smooth(me, True)
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    obj.location = to_bl(*center)
    if rot_euler != (0.0, 0.0, 0.0):
        obj.rotation_euler = Euler(rot_euler, "XYZ")
    else:
        obj.rotation_euler = Euler((0.0, 0.0, rot_y), "XYZ")
    return link_obj(obj)


def add_lathe(
    name: str,
    center: tuple[float, float, float],
    profile: list[tuple[float, float]],
    mat: bpy.types.Material,
    segs: int = 24,
    rot_euler: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    """围绕垂直轴旋转二维轮廓 [(radius, y_height), ...] 生成光滑陶瓷/植物盆器曲面。"""
    bm = bmesh.new()
    rings = []
    for r, y in profile:
        if r <= 1e-4:
            v = bm.verts.new((0.0, 0.0, y))
            rings.append([v])
        else:
            ring = []
            for i in range(segs):
                a = (i / segs) * math.tau
                ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, y)))
            rings.append(ring)
    for k in range(len(rings) - 1):
        r0, r1 = rings[k], rings[k + 1]
        if len(r0) == 1 and len(r1) > 1:
            for i in range(segs):
                bm.faces.new((r0[0], r1[(i + 1) % segs], r1[i]))
        elif len(r0) > 1 and len(r1) == 1:
            for i in range(segs):
                bm.faces.new((r0[i], r0[(i + 1) % segs], r1[0]))
        elif len(r0) > 1 and len(r1) > 1:
            for i in range(segs):
                n = (i + 1) % segs
                bm.faces.new((r0[i], r0[n], r1[n], r1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    set_smooth(me, True)
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    obj.location = to_bl(*center)
    obj.rotation_euler = Euler(rot_euler, "XYZ")
    return link_obj(obj)


def add_tube(
    name: str,
    points_three: list[tuple[float, float, float]],
    radius: float,
    mat: bpy.types.Material,
    bevel_res: int = 1,
    taper_end: float = 1.0,
) -> bpy.types.Object:
    curve = bpy.data.curves.new(name + "_curve", type="CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = bevel_res
    curve.resolution_u = 5
    spline = curve.splines.new("POLY")
    spline.points.add(len(points_three) - 1)
    total = max(len(points_three) - 1, 1)
    for i, pt in enumerate(points_three):
        v = to_bl(*pt)
        spline.points[i].co = (v.x, v.y, v.z, 1.0)
        if abs(taper_end - 1.0) > 1e-3:
            spline.points[i].radius = 1.0 + (taper_end - 1.0) * (i / total)
    spline.type = "NURBS"
    spline.use_endpoint_u = True
    c_obj = bpy.data.objects.new(name, curve)
    link_obj(c_obj)
    bpy.context.view_layer.objects.active = c_obj
    c_obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    c_obj.select_set(False)
    c_obj.data.materials.append(mat)
    set_smooth(c_obj.data, True)
    return c_obj


def add_uv_panel(
    name: str,
    center: tuple[float, float, float],
    width: float,
    height: float,
    mat: bpy.types.Material,
    facing: str = "+Z",
    rot_y_extra: float = 0.0,
) -> bpy.types.Object:
    """创建严格 0..1 单面 UV 平面，用于 Three.js 实时贴图（屏幕、日历、画框、书架铭牌、软木板）。"""
    hw, hh = width * 0.5, height * 0.5
    bm = bmesh.new()
    v0 = bm.verts.new((-hw, 0.0, -hh))
    v1 = bm.verts.new((hw, 0.0, -hh))
    v2 = bm.verts.new((hw, 0.0, hh))
    v3 = bm.verts.new((-hw, 0.0, hh))
    face = bm.faces.new((v0, v1, v2, v3))
    uv_lay = bm.loops.layers.uv.verify()
    uvs = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    for loop, uv in zip(face.loops, uvs):
        loop[uv_lay].uv = uv
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    obj.location = to_bl(*center)
    base_rz = 0.0 if facing == "+Z" else (math.pi * 0.5 if facing == "+X" else 0.0)
    obj.rotation_euler = Euler((0.0, 0.0, base_rz + rot_y_extra), "XYZ")
    return link_obj(obj)


def add_curtain_drape(
    name: str,
    x_center: float,
    y_top: float,
    y_bot: float,
    z_pos: float,
    width: float,
    pinch_side: float,
    mat: bpy.types.Material,
) -> bpy.types.Object:
    """雕塑感束带百褶窗帘。"""
    bm = bmesh.new()
    cols = 12
    rows = 8
    grid = []
    for r in range(rows + 1):
        v = r / rows
        y = y_top + (y_bot - y_top) * v
        waist = math.exp(-((v - 0.58) / 0.14) ** 2)
        scale_w = 1.0 - 0.52 * waist
        pull_x = pinch_side * 0.08 * waist
        row_verts = []
        for c in range(cols + 1):
            u = c / cols - 0.5
            pleat = math.sin(c * math.pi * 0.85) * (0.036 * (1.0 - 0.4 * waist))
            tx = x_center + u * width * scale_w + pull_x
            tz = z_pos + pleat + 0.018 * waist
            row_verts.append(bm.verts.new(to_bl(tx, y, tz)))
        grid.append(row_verts)

    for r in range(rows):
        for c in range(cols):
            bm.faces.new((grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]))

    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    set_smooth(me, True)
    me.materials.append(mat)
    obj = link_obj(bpy.data.objects.new(name, me))

    sol = obj.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = 0.014
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=sol.name)
    obj.select_set(False)
    return obj


def add_plush_cushion(
    name: str,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    mat: bpy.types.Material,
    rot_euler: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    obj = add_box(name, center, size, mat, bevel=min(size) * 0.24, bevel_segs=1, smooth=True)
    obj.rotation_euler = Euler(rot_euler, "XYZ")
    sub = obj.modifiers.new("Subsurf", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=sub.name)
    obj.select_set(False)
    return obj


def add_ergonomic_mouse(
    origin: tuple[float, float, float],
    mats: dict[str, bpy.types.Material],
) -> list[bpy.types.Object]:
    """光滑放样人体工学无线鼠标（流线型掌托曲线 + 贴桌底盘 + 左右独立键中缝 + 金属滚花滚轮 + 拇指双侧键）。"""
    mx, my, mz = origin
    bm = bmesh.new()
    slices = [
        (0.056, 0.008, 0.0020, 0.0065, 0.0000),
        (0.050, 0.020, 0.0008, 0.0155, -0.0010),
        (0.038, 0.028, 0.0005, 0.0265, -0.0022),
        (0.020, 0.031, 0.0005, 0.0345, -0.0028),
        (0.004, 0.031, 0.0005, 0.0372, -0.0026),
        (-0.012, 0.0285, 0.0005, 0.0330, -0.0018),
        (-0.026, 0.0278, 0.0006, 0.0260, -0.0010),
        (-0.040, 0.0255, 0.0008, 0.0185, -0.0004),
        (-0.050, 0.0205, 0.0012, 0.0125, 0.0000),
        (-0.056, 0.0110, 0.0022, 0.0080, 0.0000),
    ]
    ring_n = 12
    rings: list[list[bmesh.types.BMVert]] = []
    for z_off, hw, bot_y, top_y, ax in slices:
        ring: list[bmesh.types.BMVert] = []
        for i in range(ring_n):
            theta = (i / ring_n) * math.tau
            ca = math.cos(theta)
            sa = math.sin(theta)
            if sa >= 0.0:
                ly = bot_y + (top_y - bot_y) * (sa ** 0.72)
            else:
                ly = bot_y * 0.55
            ergo = (1.0 - 0.10 * ca) if sa > 0.15 else 1.0
            lx = hw * ca + ax * max(0.0, sa)
            ly_ergo = bot_y + (ly - bot_y) * ergo if sa > 0.0 else ly
            ring.append(bm.verts.new(to_bl(mx + lx, my + ly_ergo, mz + z_off)))
        rings.append(ring)

    v_back = bm.verts.new(to_bl(mx, my + 0.0045, mz + 0.059))
    for i in range(ring_n):
        bm.faces.new((v_back, rings[0][(i + 1) % ring_n], rings[0][i]))

    for s_idx in range(len(rings) - 1):
        r0, r1 = rings[s_idx], rings[s_idx + 1]
        for i in range(ring_n):
            ni = (i + 1) % ring_n
            bm.faces.new((r0[i], r0[ni], r1[ni], r1[i]))

    v_front = bm.verts.new(to_bl(mx, my + 0.0055, mz - 0.0585))
    r_last = rings[-1]
    for i in range(ring_n):
        bm.faces.new((r_last[i], r_last[(i + 1) % ring_n], v_front))

    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new("Mouse_Shell")
    bm.to_mesh(me)
    bm.free()
    set_smooth(me, True)
    me.materials.append(mats["trim"])
    shell = link_obj(bpy.data.objects.new("Mouse_Shell", me))
    sub = shell.modifiers.new("Subsurf", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    bpy.context.view_layer.objects.active = shell
    shell.select_set(True)
    bpy.ops.object.modifier_apply(modifier=sub.name)
    shell.select_set(False)
    set_smooth(shell.data, True)

    return [
        shell,
        add_box("Mouse_Wheel_Well", (mx, my + 0.0252, mz - 0.025), (0.0098, 0.0065, 0.024), mats["steel"], bevel=0.002, rot_x=0.38),
        add_cylinder("Mouse_ScrollWheel", (mx, my + 0.0276, mz - 0.025), 0.0064, 0.0064, 0.0058, mats["brass"], segs=22, rot_euler=(0.0, math.pi * 0.5, 0.0)),
        add_box("Mouse_CenterSeam", (mx, my + 0.0205, mz - 0.039), (0.0018, 0.004, 0.024), mats["steel"], bevel=0.0004, rot_x=0.46),
        add_cylinder("Mouse_DPI_Btn", (mx, my + 0.0342, mz - 0.008), 0.0032, 0.0035, 0.0045, mats["pink"], segs=12, rot_euler=(0.20, 0.0, 0.0)),
        add_box("Mouse_ThumbBtn_F", (mx - 0.0280, my + 0.0155, mz - 0.010), (0.0035, 0.0048, 0.012), mats["steel"], bevel=0.0015),
        add_box("Mouse_ThumbBtn_B", (mx - 0.0290, my + 0.0165, mz + 0.006), (0.0035, 0.0048, 0.012), mats["steel"], bevel=0.0015),
    ]


def add_botanical_leaf(
    name: str,
    stem_tip: tuple[float, float, float],
    yaw: float,
    pitch: float,
    length: float,
    width: float,
    droop: float,
    mat: bpy.types.Material,
    arch_cup: float = 0.022,
    thickness: float = 0.004,
    cols: int = 8,
    rows: int = 8,
) -> bpy.types.Object:
    """雕塑感心形微卷植物叶片（带 V 形主叶脉凹折、自然下垂弧度与实体厚度）。"""
    bm = bmesh.new()
    ca, sa = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    grid: list[list[bmesh.types.BMVert]] = []

    for r in range(rows + 1):
        v = r / rows
        if v < 0.14:
            half_w = width * 0.5 * (0.30 + 0.70 * math.sin((v / 0.14) * math.pi * 0.5))
        else:
            lobe_wave = 1.0 - 0.10 * max(0.0, math.sin((v - 0.25) * math.pi * 4.5)) * math.sin(v * math.pi)
            half_w = width * 0.5 * math.sin(math.pow((1.0 - v) / 0.86, 0.65) * math.pi * 0.5) * lobe_wave
        half_w = max(half_w, 0.002)

        fwd_s = v * length - 0.014 * math.exp(-((v - 0.05) / 0.12) ** 2)
        up_curve = math.sin(v * math.pi) * arch_cup - (v * v) * droop

        row_verts: list[bmesh.types.BMVert] = []
        for c in range(cols + 1):
            u = (c / cols) * 2.0 - 1.0
            lx = u * half_w
            vein_fold = abs(u) * (0.012 * length / 0.25) * (1.0 - 0.65 * v)
            margin_curl = -0.008 * (u * u) * (0.4 + 0.6 * v)
            ly = up_curve + vein_fold + margin_curl

            ry = ly * cp + fwd_s * sp
            rz = -ly * sp + fwd_s * cp
            wx = stem_tip[0] + lx * ca + rz * sa
            wy = stem_tip[1] + ry
            wz = stem_tip[2] - lx * sa + rz * ca
            row_verts.append(bm.verts.new(to_bl(wx, wy, wz)))
        grid.append(row_verts)

    for r in range(rows):
        for c in range(cols):
            bm.faces.new((grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]))

    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    set_smooth(me, True)
    me.materials.append(mat)
    obj = link_obj(bpy.data.objects.new(name, me))

    sol = obj.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = thickness
    sol.offset = 0.0
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=sol.name)
    obj.select_set(False)
    set_smooth(obj.data, True)
    return obj


def cake_materials() -> dict[str, bpy.types.Material]:
    """生日蛋糕专用材质（线性色值，对应参考贺卡的深蓝蛋糕体、奶油描边、橙色裱花与薄荷点缀）。书房与生日场景共用。"""
    existing = bpy.data.materials.get("Mat_Cake_Frost")
    if existing is not None:
        names = {
            "plate": "Mat_Cake_Plate",
            "frost": "Mat_Cake_Frost",
            "frost_top": "Mat_Cake_FrostTop",
            "cream": "Mat_Cake_Cream",
            "orange": "Mat_Cake_Orange",
            "mint": "Mat_Cake_Mint",
            "candle_mint": "Mat_Cake_CandleMint",
            "candle_coral": "Mat_Cake_CandleCoral",
            "wick": "Mat_Cake_Wick",
            "leaf": "Mat_Cake_Leaf",
            "flame": "Mat_Cake_Flame",
        }
        return {k: bpy.data.materials[v] for k, v in names.items()}
    return {
        "plate": make_mat("Mat_Cake_Plate", (0.93, 0.89, 0.80), roughness=0.24),
        "frost": make_mat("Mat_Cake_Frost", (0.040, 0.058, 0.190), roughness=0.58),
        "frost_top": make_mat("Mat_Cake_FrostTop", (0.068, 0.098, 0.300), roughness=0.56),
        "cream": make_mat("Mat_Cake_Cream", (0.900, 0.780, 0.580), roughness=0.50),
        "orange": make_mat("Mat_Cake_Orange", (0.760, 0.230, 0.090), roughness=0.46),
        "mint": make_mat("Mat_Cake_Mint", (0.190, 0.440, 0.240), roughness=0.48),
        "candle_mint": make_mat("Mat_Cake_CandleMint", (0.230, 0.500, 0.280), roughness=0.40),
        "candle_coral": make_mat("Mat_Cake_CandleCoral", (0.800, 0.220, 0.085), roughness=0.40),
        "wick": make_mat("Mat_Cake_Wick", (0.06, 0.05, 0.05), roughness=0.9),
        "leaf": make_mat("Mat_Cake_Leaf", (0.212, 0.423, 0.238), roughness=0.52),
        "flame": make_mat(
            "Mat_Cake_Flame",
            (1.0, 0.80, 0.45),
            roughness=0.3,
            emission=(1.0, 0.70, 0.30),
            emission_strength=3.2,
        ),
    }


def add_bead_ring(
    name: str,
    center: tuple[float, float, float],
    major_r: float,
    minor_r: float,
    beads: int,
    mat: bpy.types.Material,
    minor_segs: int = 8,
) -> bpy.types.Object:
    """水平裱花珠链：单一连续环面，次半径按珠数起伏，避免几十个小球带来的碎边线。"""
    major_segs = max(beads * 6, 48)
    bm = bmesh.new()
    rings = []
    for i in range(major_segs):
        theta = (i / major_segs) * math.tau
        ct, st = math.cos(theta), math.sin(theta)
        bead = abs(math.cos(theta * beads * 0.5)) ** 0.7
        m_r = minor_r * (0.58 + 0.42 * bead)
        ring = []
        for j in range(minor_segs):
            phi = (j / minor_segs) * math.tau
            r_xy = major_r + math.cos(phi) * m_r
            ring.append(bm.verts.new((ct * r_xy, st * r_xy, math.sin(phi) * m_r)))
        rings.append(ring)
    for i in range(major_segs):
        ni = (i + 1) % major_segs
        for j in range(minor_segs):
            nj = (j + 1) % minor_segs
            bm.faces.new((rings[i][j], rings[ni][j], rings[ni][nj], rings[i][nj]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    set_smooth(me, True)
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    obj.location = to_bl(*center)
    return link_obj(obj)


def add_drip_band(
    name: str,
    center: tuple[float, float, float],
    radius: float,
    thickness: float,
    drips: int,
    depth_max: float,
    mat: bpy.types.Material,
    phase: float = 0.35,
) -> list[bpy.types.Object]:
    """蛋糕顶缘奶油淋面：闭合环带，下缘按滴数呈长短错落的垂滴，并在滴尖补圆润小珠。center 为淋面顶缘中心。"""
    amps = [0.55 + 0.45 * abs(math.sin(k * 2.17 + 0.6)) for k in range(drips)]
    segs = drips * 56
    depth_min = depth_max * 0.16

    def drip_depth(theta: float) -> float:
        u = drips * theta + phase
        n = round(u / math.tau)
        k = int(n) % drips
        du = abs(u - n * math.tau)
        # U 形垂滴：滴身两侧近乎竖直、底部圆润，滴与滴之间留出平缓的浅缘
        t = min(1.0, max(0.0, (du - 0.42) / 0.40))
        bulge = 1.0 - t * t * (3.0 - 2.0 * t)
        bulge = math.sqrt(max(bulge, 0.0))
        return depth_min + (depth_max - depth_min) * bulge * amps[k]

    bm = bmesh.new()
    r_in = radius - 0.0015
    r_out = radius + thickness
    sections = []
    for i in range(segs):
        theta = (i / segs) * math.tau
        ct, st = math.cos(theta), math.sin(theta)
        d = drip_depth(theta)
        sections.append([
            bm.verts.new((ct * r_in, st * r_in, 0.0)),
            bm.verts.new((ct * r_out, st * r_out, 0.0)),
            bm.verts.new((ct * r_out, st * r_out, -d)),
            bm.verts.new((ct * r_in, st * r_in, -d)),
        ])
    for i in range(segs):
        a, b = sections[i], sections[(i + 1) % segs]
        for j in range(4):
            nj = (j + 1) % 4
            bm.faces.new((a[j], b[j], b[nj], a[nj]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    set_smooth(me, True)
    me.materials.append(mat)
    band = bpy.data.objects.new(name, me)
    band.location = to_bl(*center)
    link_obj(band)

    out = [band]
    cx, cy, cz = center
    for k in range(drips):
        theta = (math.tau * k - phase) / drips
        d = depth_min + (depth_max - depth_min) * amps[k]
        rr = radius + thickness * 0.55
        tip_r = thickness * 1.75
        tip = (cx + math.cos(theta) * rr, cy - d + tip_r * 0.45, cz - math.sin(theta) * rr)
        # 滴尖小珠沿径向压扁（局部 Blender Y 轴对齐径向），贴合淋面而不外凸
        out.append(add_sphere(
            f"{name}_Tip_{k}",
            tip,
            tip_r,
            mat,
            scale=(1.0, 1.1, 0.6),
            segs=12,
            rings=8,
            rot_y=theta - math.pi * 0.5,
        ))
    return out


def add_number_candle(
    name: str,
    base: tuple[float, float, float],
    char: str,
    height: float,
    depth: float,
    mat: bpy.types.Material,
) -> tuple[list[bpy.types.Object], tuple[float, float, float]]:
    """圆润管状数字蜡烛（手绘笔画路径，不依赖任何字体文件）：底边中心落在 base，笔画在 XY 平面、正面朝 Three.js +Z。

    返回 (网格列表, 顶端烛芯世界坐标)。depth 为笔画管径（直径）。
    """
    # 笔画中心线，单位为字高（x 居中，y 自下而上）；重复点用于让 NURBS 在拐角处收紧
    strokes = {
        "2": [
            (-0.27, 0.70), (-0.22, 0.85), (-0.06, 0.95), (0.13, 0.94), (0.27, 0.82), (0.28, 0.66),
            (0.17, 0.49), (-0.02, 0.31), (-0.20, 0.13), (-0.27, 0.05), (-0.27, 0.05),
            (-0.27, 0.05), (0.03, 0.05), (0.31, 0.05),
        ],
        "1": [
            (-0.20, 0.72), (-0.07, 0.83), (0.05, 0.95), (0.05, 0.95), (0.05, 0.95), (0.05, 0.50), (0.05, 0.05),
        ],
    }
    wick_x = {"2": 0.02, "1": 0.05}
    pts = strokes[char]
    r = depth * 0.5
    span = height - 2.0 * r
    world = [(base[0] + x * height, base[1] + r + (y - 0.05) / 0.90 * span, base[2]) for x, y in pts]
    tube = add_tube(name, world, r, mat, bevel_res=4)
    objs = [tube]
    for idx, end in enumerate((world[0], world[-1])):
        objs.append(add_sphere(f"{name}_Cap_{idx}", end, r * 0.98, mat, segs=14, rings=8))
    wick = (base[0] + wick_x[char] * height, base[1] + height - r * 0.4, base[2])
    return objs, wick


def add_birthday_cake(
    origin: tuple[float, float, float],
    s: float,
    put: "callable",
    put_dyn: "callable",
    prefix: str = "Cake",
) -> list[tuple[float, float, float]]:
    """双层生日蛋糕（深蓝奶油 + 奶白淋面垂滴 + 橙色花边 + 双色圆点 + 「21」数字蜡烛 + 薄荷叶）。

    origin 为蛋糕盘底中心（Three.js 世界坐标），s 为整体缩放（1.0 ≈ 直径 23cm 的盘）。
    put 收集静态烘焙网格，put_dyn 收集不参与烘焙的自发光火苗。返回两簇火苗中心坐标，供补光/动画使用。
    """
    cm = cake_materials()
    ox, oy, oz = origin

    def P(lx: float, ly: float, lz: float) -> tuple[float, float, float]:
        return (ox + lx * s, oy + ly * s, oz + lz * s)

    def prof(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
        return [(r * s, y * s) for r, y in pts]

    # 奶白陶瓷蛋糕盘
    put(add_lathe(f"{prefix}_Plate", P(0, 0, 0), prof([
        (0.0, 0.0), (0.090, 0.0), (0.108, 0.003), (0.116, 0.008), (0.1165, 0.0105), (0.113, 0.0112), (0.100, 0.0085), (0.0, 0.0085),
    ]), cm["plate"], segs=64))

    y0 = 0.0085
    h1 = 0.060
    r1 = 0.0845
    put(add_lathe(f"{prefix}_TierLow", P(0, 0, 0), prof([
        (0.0, y0), (r1 - 0.001, y0), (r1, y0 + 0.003), (r1, y0 + h1), (0.0, y0 + h1),
    ]), cm["frost"], segs=64))
    # 底层奶油顶盖（圆角收边，压住淋面上缘）
    put(add_lathe(f"{prefix}_TierLow_Cap", P(0, 0, 0), prof([
        (0.0, y0 + h1 + 0.0035), (r1 - 0.004, y0 + h1 + 0.0035), (r1 + 0.0018, y0 + h1 + 0.0018), (r1 + 0.0024, y0 + h1 - 0.0012), (0.0, y0 + h1 - 0.0012),
    ]), cm["cream"], segs=64))
    for obj in add_drip_band(f"{prefix}_Drip", P(0, y0 + h1, 0), r1 * s, 0.0021 * s, 11, 0.027 * s, cm["cream"]):
        put(obj)
    put(add_bead_ring(f"{prefix}_BeadLow", P(0, y0 + 0.0042, 0), (r1 + 0.0022) * s, 0.0046 * s, 30, cm["cream"]))

    # 底层侧面橙 / 薄荷交替圆点
    dots = 12
    for k in range(dots):
        a = (k / dots) * math.tau + 0.12
        mat = cm["orange"] if k % 2 == 0 else cm["mint"]
        put(add_sphere(
            f"{prefix}_Dot_{k}",
            P(math.sin(a) * (r1 + 0.0006), y0 + 0.021, math.cos(a) * (r1 + 0.0006)),
            0.0043 * s,
            mat,
            segs=12,
            rings=8,
        ))

    # 上层
    y1 = y0 + h1 + 0.0035
    h2 = 0.040
    r2 = 0.057
    put(add_lathe(f"{prefix}_TierTop", P(0, 0, 0), prof([
        (0.0, y1), (r2, y1), (r2, y1 + h2), (0.0, y1 + h2),
    ]), cm["frost_top"], segs=56))
    put(add_lathe(f"{prefix}_TierTop_Cap", P(0, 0, 0), prof([
        (0.0, y1 + h2 + 0.0032), (r2 - 0.006, y1 + h2 + 0.0030), (r2 + 0.0006, y1 + h2 + 0.0010), (r2 + 0.0008, y1 + h2 - 0.0016), (0.0, y1 + h2 - 0.0016),
    ]), cm["cream"], segs=56))
    put(add_bead_ring(f"{prefix}_BeadTopRim", P(0, y1 + h2 + 0.0008, 0), (r2 - 0.0004) * s, 0.0033 * s, 24, cm["cream"]))
    put(add_bead_ring(f"{prefix}_BeadTopBase", P(0, y1 + 0.0030, 0), (r2 + 0.0012) * s, 0.0035 * s, 24, cm["cream"]))

    # 上层橙色垂花边（6 段弧形垂幔）
    swags = 7
    garland = []
    n_pts = 168
    for i in range(n_pts + 1):
        a = (i / n_pts) * math.tau
        drop = abs(math.sin(a * swags * 0.5))
        rr = r2 + 0.0014
        garland.append(P(math.sin(a) * rr, y1 + h2 - 0.0075 - 0.0105 * drop, math.cos(a) * rr))
    put(add_tube(f"{prefix}_Garland", garland, 0.0019 * s, cm["orange"], bevel_res=2))
    for i in range(swags):
        a = (i / swags) * math.tau
        put(add_sphere(
            f"{prefix}_GarlandKnot_{i}",
            P(math.sin(a) * (r2 + 0.0022), y1 + h2 - 0.0072, math.cos(a) * (r2 + 0.0022)),
            0.0034 * s,
            cm["orange"],
            segs=10,
            rings=6,
        ))

    # 「21」数字蜡烛：2 为薄荷绿、1 为珊瑚橙（呼应参考贺卡）
    top_y = y1 + h2 + 0.0025
    flames: list[tuple[float, float, float]] = []
    for idx, (ch, lx, mat_key) in enumerate((("2", -0.0175, "candle_mint"), ("1", 0.0185, "candle_coral"))):
        cobjs, wick_pt = add_number_candle(f"{prefix}_Candle_{ch}", P(lx, top_y - 0.002, 0.002), ch, 0.050 * s, 0.0118 * s, cm[mat_key])
        for cobj in cobjs:
            put(cobj)
        wick_top = (wick_pt[0], wick_pt[1] + 0.0058 * s, wick_pt[2])
        put(add_cylinder_between(f"{prefix}_Wick_{ch}", (wick_pt[0], wick_pt[1] - 0.0015 * s, wick_pt[2]), wick_top, 0.0008 * s, 0.0006 * s, cm["wick"], segs=6))
        put_dyn(add_lathe(f"{prefix}_Flame_{idx}", (wick_top[0], wick_top[1] - 0.0012 * s, wick_top[2]), prof([
            (0.0, 0.0), (0.0030, 0.0015), (0.0046, 0.0055), (0.0045, 0.0095), (0.0033, 0.0140), (0.0016, 0.0185), (0.0, 0.0215),
        ]), cm["flame"], segs=16))
        flames.append((wick_top[0], wick_top[1] + 0.009 * s, wick_top[2]))

    # 盘沿两簇薄荷叶
    for side in (-1, 1):
        yaw0 = side * 1.25
        for j, (dyaw, ln, wd) in enumerate(((0.0, 0.056, 0.026), (0.52 * side, 0.044, 0.021))):
            tip = P(side * 0.080, 0.010, 0.026)
            put(add_botanical_leaf(
                f"{prefix}_Leaf_{side}_{j}",
                tip,
                yaw0 + dyaw,
                0.18,
                ln * s,
                wd * s,
                0.010 * s,
                cm["leaf"],
                arch_cup=0.005 * s,
                thickness=0.0022 * s,
                cols=6,
                rows=8,
            ))
    return flames


def add_mechanical_keyboard(
    origin: tuple[float, float, float],
    mats: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    tilt = 0.085
    ct, st = math.cos(tilt), math.sin(tilt)
    ox, oy, oz = origin

    def kb_pt(lx: float, ly: float, lz: float) -> Vector:
        wy = oy + ly * ct - lz * st
        wz = oz + ly * st + lz * ct
        return to_bl(ox + lx, wy, wz)

    bm = bmesh.new()
    mat_list = [mats["ceramic"], mats["curtain"], mats["pink"]]

    def add_keycap(cx: float, cz: float, u_w: float, u_d: float, h: float, mat_idx: int) -> None:
        pitch = 0.0192
        gap = 0.0024
        bw = u_w * pitch - gap
        bd = u_d * pitch - gap
        tw = bw * 0.74
        td = bd * 0.72
        y0 = 0.0205
        y1 = y0 + h
        hx0, hz0 = bw * 0.5, bd * 0.5
        hx1, hz1 = tw * 0.5, td * 0.5
        v0 = bm.verts.new(kb_pt(cx - hx0, y0, cz - hz0))
        v1 = bm.verts.new(kb_pt(cx + hx0, y0, cz - hz0))
        v2 = bm.verts.new(kb_pt(cx + hx0, y0, cz + hz0))
        v3 = bm.verts.new(kb_pt(cx - hx0, y0, cz + hz0))
        v4 = bm.verts.new(kb_pt(cx - hx1, y1, cz - hz1))
        v5 = bm.verts.new(kb_pt(cx + hx1, y1, cz - hz1))
        v6 = bm.verts.new(kb_pt(cx + hx1, y1, cz + hz1))
        v7 = bm.verts.new(kb_pt(cx - hx1, y1, cz + hz1))
        faces = [
            bm.faces.new((v4, v5, v6, v7)),
            bm.faces.new((v0, v1, v5, v4)),
            bm.faces.new((v1, v2, v6, v5)),
            bm.faces.new((v2, v3, v7, v6)),
            bm.faces.new((v3, v0, v4, v7)),
        ]
        for f in faces:
            f.material_index = mat_idx

    rows: list[list[tuple[float, float, int]]] = [
        [(1.0, 0.011, 2)] + [(1.0, 0.011, 0) for _ in range(12)] + [(2.0, 0.011, 1), (1.0, 0.011, 1)],
        [(1.5, 0.010, 1)] + [(1.0, 0.010, 0) for _ in range(12)] + [(1.5, 0.010, 1), (1.0, 0.010, 1)],
        [(1.75, 0.0095, 1)] + [(1.0, 0.0095, 0) for _ in range(11)] + [(2.25, 0.0095, 2), (1.0, 0.0095, 1)],
        [(2.25, 0.0095, 1)] + [(1.0, 0.0095, 0) for _ in range(10)] + [(1.75, 0.0095, 1), (1.0, 0.0095, 1), (1.0, 0.0095, 1)],
        [(1.25, 0.0095, 1), (1.25, 0.0095, 1), (1.25, 0.0095, 1), (6.25, 0.0095, 0), (1.0, 0.0095, 1), (1.0, 0.0095, 1), (1.0, 0.0095, 1), (1.0, 0.0095, 1), (1.0, 0.0095, 1), (1.0, 0.0095, 1)],
    ]
    pitch = 0.0192
    total_w = 16.0 * pitch
    start_x = -total_w * 0.5
    row_z0 = -2.0 * pitch
    for r_idx, row in enumerate(rows):
        cx_u = 0.0
        cz = row_z0 + r_idx * pitch
        for u_w, kh, mi in row:
            cx = start_x + (cx_u + u_w * 0.5) * pitch
            add_keycap(cx, cz, u_w, 1.0, kh, mi)
            cx_u += u_w

    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new("KB_Keycaps")
    bm.to_mesh(me)
    bm.free()
    set_smooth(me, False)
    for m in mat_list:
        me.materials.append(m)
    obj = bpy.data.objects.new("KB_Keycaps", me)
    return link_obj(obj)


def build_scene() -> None:
    clear_scene()

    mats = {
        "floor": make_mat("Mat_Floor", (0.76, 0.60, 0.44), roughness=0.62),
        "wall": make_mat("Mat_WallInner", (0.94, 0.91, 0.87), roughness=0.88),
        "hull": make_mat("Mat_HullOuter", (0.28, 0.30, 0.38), roughness=0.52, metallic=0.18),
        "plinth": make_mat("Mat_Plinth", (0.22, 0.21, 0.25), roughness=0.56, metallic=0.14),
        "trim": make_mat("Mat_Trim", (0.96, 0.94, 0.91), roughness=0.58),
        "wood_light": make_mat("Mat_WoodLight", (0.81, 0.67, 0.51), roughness=0.48),
        "wood_mid": make_mat("Mat_WoodMid", (0.56, 0.38, 0.25), roughness=0.46),
        "wood_dark": make_mat("Mat_WoodDark", (0.31, 0.21, 0.15), roughness=0.44),
        "brass": make_mat("Mat_Brass", (0.82, 0.66, 0.34), roughness=0.26, metallic=0.84),
        "steel": make_mat("Mat_Steel", (0.28, 0.30, 0.35), roughness=0.34, metallic=0.68),
        "curtain": make_mat("Mat_Curtain", (0.82, 0.78, 0.92), roughness=0.86),
        "rug": make_mat("Mat_Rug", (0.92, 0.89, 0.86), roughness=0.92),
        "upholstery": make_mat("Mat_Upholstery", (0.88, 0.85, 0.83), roughness=0.88),
        "pillow": make_mat("Mat_Pillow", (0.78, 0.66, 0.88), roughness=0.86),
        "ceramic": make_mat("Mat_Ceramic", (0.96, 0.94, 0.91), roughness=0.22),
        "pink": make_mat("Mat_PinkAccent", (0.95, 0.66, 0.76), roughness=0.34),
        "plant": make_mat("Mat_Plant", (0.36, 0.58, 0.42), roughness=0.55),
        "soil": make_mat("Mat_Soil", (0.22, 0.16, 0.12), roughness=0.96),
        "glass": make_mat("Mat_Glass", (0.86, 0.92, 0.98), roughness=0.06, alpha=0.14),
        "glow": make_mat("Mat_WarmGlow", (1.0, 0.86, 0.65), roughness=0.2, emission=(1.0, 0.82, 0.56), emission_strength=2.2),
        "screen_crt": make_mat("Mat_ScreenCRT", (0.12, 0.16, 0.24), roughness=0.18),
        "screen_mon": make_mat("Mat_ScreenMonitor", (0.12, 0.14, 0.18), roughness=0.2),
        "face_cal": make_mat("Mat_FaceCalendar", (0.95, 0.93, 0.9), roughness=0.72),
        "face_cork": make_mat("Mat_FaceCork", (0.72, 0.56, 0.4), roughness=0.84),
        "art0": make_mat("Mat_Art0", (0.92, 0.9, 0.88), roughness=0.38),
        "art1": make_mat("Mat_Art1", (0.92, 0.9, 0.88), roughness=0.38),
        "art2": make_mat("Mat_Art2", (0.92, 0.9, 0.88), roughness=0.38),
        "plate0": make_mat("Mat_Plate0", (0.9, 0.88, 0.84), roughness=0.45),
        "plate1": make_mat("Mat_Plate1", (0.9, 0.88, 0.84), roughness=0.45),
        "plate2": make_mat("Mat_Plate2", (0.9, 0.88, 0.84), roughness=0.45),
        "plate3": make_mat("Mat_Plate3", (0.9, 0.88, 0.84), roughness=0.45),
        "plate4": make_mat("Mat_Plate4", (0.9, 0.88, 0.84), roughness=0.45),
    }

    static_groups: dict[str, list[bpy.types.Object]] = {}
    dynamic_objs: list[bpy.types.Object] = []

    def S(group_name: str, obj: bpy.types.Object) -> bpy.types.Object:
        static_groups.setdefault(group_name, []).append(obj)
        return obj

    def D(obj: bpy.types.Object) -> bpy.types.Object:
        dynamic_objs.append(obj)
        return obj

    # ================================================================
    # 1. 悬浮观测书房建筑基座、双墙与开放边缘天文台金属木质围栏
    # ================================================================
    S("Arch_Room", add_box("Floor_Top", (0.0, -0.025, 0.0), (7.02, 0.05, 7.02), mats["floor"], bevel=0.006))
    S("Arch_Room", mark_uv_prio(add_box("Deck_Plinth_Upper", (0.0, -0.14, 0.0), (7.22, 0.18, 7.22), mats["plinth"], bevel=0.025, bevel_segs=1), 0))
    S("Arch_Room", mark_uv_prio(add_box("Deck_Brass_Band", (0.0, -0.23, 0.0), (7.06, 0.03, 7.06), mats["brass"], bevel=0.008), 0))
    S("Arch_Room", mark_uv_prio(add_box("Deck_Plinth_Lower", (0.0, -0.32, 0.0), (6.58, 0.16, 6.58), mats["hull"], bevel=0.04, bevel_segs=1), 0))

    # 左墙 X = -3.40
    S("Arch_Room", add_box("Wall_Left_Inner", (-3.47, 1.66, 0.0), (0.14, 3.32, 7.02), mats["wall"], bevel=0.006))
    S("Arch_Room", mark_uv_prio(add_box("Wall_Left_Outer", (-3.61, 1.66, 0.0), (0.14, 3.32, 7.22), mats["hull"], bevel=0.018, bevel_segs=2), 0))
    S("Arch_Room", add_box("Wall_Left_Cap", (-3.54, 3.34, 0.0), (0.30, 0.05, 7.24), mats["wood_mid"], bevel=0.012))
    S("Arch_Room", add_box("Left_Baseboard", (-3.385, 0.065, 0.04), (0.03, 0.13, 6.92), mats["trim"], bevel=0.005))
    S("Arch_Room", add_box("Left_Crown", (-3.38, 3.26, 0.04), (0.045, 0.10, 6.92), mats["trim"], bevel=0.008))
    for rz in (-2.6, -0.9, 0.9, 2.6):
        S("Arch_Room", mark_uv_prio(add_box(f"Hull_Left_Rib_{rz:.1f}", (-3.69, 1.66, rz), (0.03, 3.16, 0.08), mats["brass"], bevel=0.006), 0))

    # 后墙 Z = -3.40（围绕宽景观测窗开洞）
    S("Arch_Room", add_box("Wall_Back_Under_In", (-1.975, 0.51, -3.47), (2.85, 1.02, 0.14), mats["wall"], bevel=0.004))
    S("Arch_Room", mark_uv_prio(add_box("Wall_Back_Under_Out", (-2.05, 0.51, -3.61), (3.10, 1.02, 0.14), mats["hull"], bevel=0.012), 0))
    S("Arch_Room", add_box("Wall_Back_Top_In", (-1.975, 3.09, -3.47), (2.85, 0.46, 0.14), mats["wall"], bevel=0.004))
    S("Arch_Room", mark_uv_prio(add_box("Wall_Back_Top_Out", (-2.05, 3.09, -3.61), (3.10, 0.46, 0.14), mats["hull"], bevel=0.012), 0))
    S("Arch_Room", add_box("Wall_Back_PierL_In", (-3.075, 1.94, -3.47), (0.65, 1.84, 0.14), mats["wall"], bevel=0.004))
    S("Arch_Room", mark_uv_prio(add_box("Wall_Back_PierL_Out", (-3.18, 1.94, -3.61), (0.86, 1.84, 0.14), mats["hull"], bevel=0.012), 0))
    S("Arch_Room", add_box("Wall_Back_Right_In", (1.48, 1.66, -3.47), (4.06, 3.32, 0.14), mats["wall"], bevel=0.006))
    S("Arch_Room", mark_uv_prio(add_box("Wall_Back_Right_Out", (1.53, 1.66, -3.61), (4.16, 3.32, 0.14), mats["hull"], bevel=0.018), 0))
    S("Arch_Room", add_box("Wall_Back_Cap", (-0.02, 3.34, -3.54), (7.26, 0.05, 0.30), mats["wood_mid"], bevel=0.012))
    S("Arch_Room", add_box("Back_Baseboard", (0.04, 0.065, -3.385), (6.92, 0.13, 0.03), mats["trim"], bevel=0.005))
    S("Arch_Room", add_box("Back_Crown", (0.04, 3.26, -3.38), (6.92, 0.10, 0.045), mats["trim"], bevel=0.008))
    for rx in (0.15, 1.75, 3.15):
        S("Arch_Room", mark_uv_prio(add_box(f"Hull_Back_Rib_{rx:.1f}", (rx, 1.66, -3.69), (0.08, 3.16, 0.03), mats["brass"], bevel=0.006), 0))

    # 1b. 无墙开放边缘天文观测围栏（+X 右缘 x=3.43, +Z 前缘 z=3.43，低矮 0.48m 通透不挡视）
    rail_posts: list[tuple[float, float]] = [
        (3.43, -3.28),
        (3.43, -1.60),
        (3.43, 0.08),
        (3.43, 1.76),
        (3.43, 3.43),
        (1.76, 3.43),
        (0.08, 3.43),
        (-1.60, 3.43),
        (-3.28, 3.43),
    ]
    for idx, (rx, rz) in enumerate(rail_posts):
        S("Arch_Room", add_cylinder(f"Rail_Base_{idx}", (rx, 0.012, rz), 0.024, 0.028, 0.024, mats["brass"], segs=10))
        S("Arch_Room", add_cylinder_between(f"Rail_Post_{idx}", (rx, 0.020, rz), (rx, 0.445, rz), 0.015, 0.012, mats["steel"], segs=8))
        S("Arch_Room", add_cylinder(f"Rail_Neck_{idx}", (rx, 0.438, rz), 0.015, 0.015, 0.022, mats["brass"], segs=8))
    # 转角球与墙端收口法兰
    S("Arch_Room", add_sphere("Rail_CornerBall", (3.43, 0.466, 3.43), 0.022, mats["brass"], segs=10, rings=6))
    S("Arch_Room", add_cylinder_between("Rail_WallEsc_R", (3.43, 0.466, -3.40), (3.43, 0.466, -3.37), 0.024, 0.024, mats["brass"], segs=10))
    S("Arch_Room", add_cylinder_between("Rail_WallEsc_F", (-3.40, 0.466, 3.43), (-3.37, 0.466, 3.43), 0.024, 0.024, mats["brass"], segs=10))
    # 木质圆角顶扶手 + 两道黄铜细横拉杆
    S("Arch_Room", add_box("Rail_Top_R", (3.43, 0.466, 0.02), (0.038, 0.028, 6.84), mats["wood_mid"], bevel=0.009, bevel_segs=1))
    S("Arch_Room", add_box("Rail_Top_F", (0.02, 0.466, 3.43), (6.84, 0.028, 0.038), mats["wood_mid"], bevel=0.009, bevel_segs=1))
    for mid_y in (0.175, 0.315):
        S("Arch_Room", add_cylinder_between(f"Rail_WireR_{mid_y:.2f}", (3.43, mid_y, -3.39), (3.43, mid_y, 3.43), 0.0055, 0.0055, mats["brass"], segs=6))
        S("Arch_Room", add_cylinder_between(f"Rail_WireF_{mid_y:.2f}", (-3.39, mid_y, 3.43), (3.43, mid_y, 3.43), 0.0055, 0.0055, mats["brass"], segs=6))

    # ================================================================
    # 2. 全景观测窗（透视直面真实紫粉黑洞）、束腰窗帘与精细窗台盆栽/樱花瓶
    # ================================================================
    S("Arch_Room", add_box("Window_Sill", (-1.65, 1.01, -3.50), (2.34, 0.05, 0.38), mats["wood_light"], bevel=0.012))
    S("Arch_Room", add_box("Win_Frame_T", (-1.65, 2.84, -3.53), (2.26, 0.06, 0.30), mats["trim"], bevel=0.008))
    S("Arch_Room", add_box("Win_Frame_L", (-2.73, 1.94, -3.53), (0.06, 1.84, 0.30), mats["trim"], bevel=0.008))
    S("Arch_Room", add_box("Win_Frame_R", (-0.57, 1.94, -3.53), (0.06, 1.84, 0.30), mats["trim"], bevel=0.008))
    S("Arch_Room", add_box("Win_Outer_Brass_T", (-1.65, 2.88, -3.69), (2.36, 0.04, 0.05), mats["brass"], bevel=0.006))
    S("Arch_Room", add_box("Win_Outer_Brass_B", (-1.65, 0.99, -3.69), (2.36, 0.04, 0.05), mats["brass"], bevel=0.006))
    for mx in (-2.02, -1.28):
        S("Arch_Room", add_box(f"Win_Mullion_{mx:.2f}", (mx, 1.93, -3.54), (0.026, 1.80, 0.045), mats["trim"], bevel=0.004))

    D(add_uv_panel("Window_Glass", (-1.65, 1.93, -3.55), 2.14, 1.78, mats["glass"], facing="+Z"))

    S("Arch_Room", add_cylinder("Curtain_Rod", (-1.65, 3.00, -3.30), 0.014, 0.014, 2.74, mats["brass"], segs=16, rot_euler=(0.0, math.pi * 0.5, 0.0)))
    for ex in (-3.02, -0.28):
        S("Arch_Room", add_sphere(f"Rod_Finial_{ex:.1f}", (ex, 3.00, -3.30), 0.028, mats["brass"], segs=14, rings=10))
    S("Arch_Room", add_curtain_drape("Curtain_L", -2.74, 2.98, 1.04, -3.28, 0.42, -1.0, mats["curtain"]))
    S("Arch_Room", add_curtain_drape("Curtain_R", -0.56, 2.98, 1.04, -3.28, 0.42, 1.0, mats["curtain"]))

    # 窗台白瓷盆栽（38 段光滑卷口 + 雕塑叶片莲座） + 樱花细枝瓷瓶
    S("Decor_Lounge", add_lathe(
        "Sill_Pot",
        (-2.46, 1.035, -3.40),
        [(0.0, 0.0), (0.052, 0.0), (0.068, 0.07), (0.072, 0.112), (0.068, 0.120), (0.061, 0.120), (0.056, 0.105), (0.0, 0.105)],
        mats["ceramic"],
        segs=24,
    ))
    S("Decor_Lounge", add_lathe("Sill_Soil", (-2.46, 1.132, -3.40), [(0.0, 0.014), (0.036, 0.010), (0.057, 0.002)], mats["soil"], segs=18))
    for i in range(6):
        ang = (i / 6) * math.tau + 0.25
        sc_len = 0.068 + (i % 2) * 0.016
        S("Decor_Lounge", add_tube(
            f"Sill_Stem_{i}",
            [(-2.46, 1.14, -3.40), (-2.46 + math.cos(ang) * 0.025, 1.175 + (i % 2) * 0.012, -3.40 + math.sin(ang) * 0.025)],
            0.0035,
            mats["plant"],
            taper_end=0.7,
        ))
        S("Decor_Lounge", add_botanical_leaf(
            f"Sill_Leaf_{i}",
            (-2.46 + math.cos(ang) * 0.025, 1.175 + (i % 2) * 0.012, -3.40 + math.sin(ang) * 0.025),
            yaw=-ang + math.pi * 0.5,
            pitch=0.38,
            length=sc_len,
            width=sc_len * 0.62,
            droop=0.016,
            mat=mats["plant"],
            arch_cup=0.008,
            thickness=0.0025,
            cols=5,
            rows=5,
        ))

    S("Decor_Lounge", add_lathe(
        "Sakura_Vase",
        (-0.82, 1.035, -3.40),
        [(0.0, 0.0), (0.042, 0.0), (0.062, 0.07), (0.054, 0.14), (0.026, 0.19), (0.032, 0.21), (0.024, 0.21), (0.02, 0.18)],
        mats["ceramic"],
        segs=24,
    ))
    S("Decor_Lounge", add_tube("Sakura_Branch", [(-0.82, 1.21, -3.40), (-0.79, 1.32, -3.38), (-0.72, 1.42, -3.35)], 0.006, mats["wood_dark"]))
    for idx, pos in enumerate([(-0.79, 1.34, -3.37), (-0.74, 1.41, -3.35), (-0.71, 1.45, -3.34), (-0.83, 1.30, -3.39)]):
        S("Decor_Lounge", add_sphere(f"Sakura_Blossom_{idx}", pos, 0.024, mats["pink"], scale=(1.1, 0.65, 1.1), segs=10, rings=6))

    # ================================================================
    # 3. 窗边浅橡木书桌（Hotspot_Desk_About：精雕机械键盘 + 放样人体工学鼠标 + 台灯 + 音箱 + 杯具）
    # ================================================================
    S("Hotspot_Desk_About", add_box("Desk_Top", (-1.68, 0.74, -2.86), (2.00, 0.045, 0.88), mats["wood_light"], bevel=0.012, bevel_segs=1))
    S("Hotspot_Desk_About", add_box("Desk_Read_Blotter", (-1.26, 0.766, -2.74), (0.72, 0.006, 0.48), mats["upholstery"], bevel=0.003))
    S("Hotspot_Desk_About", add_box("Desk_Key_Mat", (-2.00, 0.766, -2.84), (0.74, 0.006, 0.36), mats["plinth"], bevel=0.004))

    S("Hotspot_Desk_About", add_box("Desk_Drawer_Cab", (-0.96, 0.36, -2.86), (0.48, 0.72, 0.78), mats["wood_light"], bevel=0.012))
    for dy in (0.16, 0.37, 0.58):
        S("Hotspot_Desk_About", add_box(f"Desk_Drawer_Face_{dy:.2f}", (-0.96, dy, -2.465), (0.43, 0.17, 0.022), mats["trim"], bevel=0.006))
        S("Hotspot_Desk_About", add_cylinder(
            f"Desk_Pull_{dy:.2f}",
            (-0.96, dy, -2.445),
            0.008,
            0.008,
            0.12,
            mats["brass"],
            segs=14,
            rot_euler=(0.0, math.pi * 0.5, 0.0),
        ))
    for lz in (-3.20, -2.52):
        S("Hotspot_Desk_About", add_cylinder(f"Desk_Leg_{lz:.2f}", (-2.56, 0.36, lz), 0.026, 0.018, 0.72, mats["wood_mid"], segs=18))
    S("Hotspot_Desk_About", add_cylinder("Desk_Crossbar", (-2.56, 0.16, -2.86), 0.014, 0.014, 0.68, mats["brass"], segs=12, rot_euler=(math.pi * 0.5, 0.0, 0.0)))

    S("Hotspot_Desk_About", add_box("Mon_Base", (-2.04, 0.772, -3.14), (0.21, 0.014, 0.16), mats["steel"], bevel=0.005))
    S("Hotspot_Desk_About", add_box("Mon_Neck", (-2.04, 0.87, -3.17), (0.044, 0.20, 0.03), mats["steel"], bevel=0.006))
    S("Hotspot_Desk_About", add_box("Mon_Body", (-2.04, 1.07, -3.13), (0.68, 0.41, 0.028), mats["steel"], bevel=0.008))
    S("Hotspot_Desk_About", add_box("Mon_Webcam", (-2.04, 1.28, -3.122), (0.055, 0.016, 0.022), mats["plinth"], bevel=0.004))
    D(add_uv_panel("Screen_Monitor", (-2.04, 1.07, -3.114), 0.64, 0.37, mats["screen_mon"], facing="+Z"))

    S("Hotspot_Desk_About", add_box("Desk_Speaker", (-1.59, 0.845, -3.13), (0.115, 0.165, 0.125), mats["wood_mid"], bevel=0.01))
    S("Hotspot_Desk_About", add_cylinder("Speaker_Woofer", (-1.59, 0.818, -3.066), 0.036, 0.036, 0.012, mats["steel"], segs=22, rot_euler=(math.pi * 0.5, 0.0, 0.0)))
    S("Hotspot_Desk_About", add_cylinder("Speaker_Tweeter", (-1.59, 0.892, -3.066), 0.017, 0.017, 0.010, mats["brass"], segs=18, rot_euler=(math.pi * 0.5, 0.0, 0.0)))

    kb_pos = (-2.06, 0.769, -2.87)
    S("Hotspot_Desk_About", add_box("KB_Case", (kb_pos[0], kb_pos[1] + 0.011, kb_pos[2]), (0.352, 0.020, 0.126), mats["trim"], bevel=0.006, bevel_segs=2, rot_x=0.085))
    S("Hotspot_Desk_About", add_box("KB_Plate", (kb_pos[0], kb_pos[1] + 0.017, kb_pos[2]), (0.332, 0.008, 0.106), mats["steel"], bevel=0.002, rot_x=0.085))
    S("Hotspot_Desk_About", add_mechanical_keyboard(kb_pos, mats))
    S("Hotspot_Desk_About", add_box("KB_WristRest", (kb_pos[0], kb_pos[1] + 0.007, kb_pos[2] + 0.092), (0.35, 0.013, 0.056), mats["wood_mid"], bevel=0.005))
    S("Hotspot_Desk_About", add_tube("KB_CoiledCable", [
        (kb_pos[0] - 0.10, kb_pos[1] + 0.014, kb_pos[2] - 0.064),
        (kb_pos[0] - 0.09, kb_pos[1] + 0.010, kb_pos[2] - 0.098),
        (kb_pos[0] - 0.04, kb_pos[1] + 0.010, kb_pos[2] - 0.100),
        (kb_pos[0] + 0.01, kb_pos[1] + 0.010, kb_pos[2] - 0.098),
        (kb_pos[0] + 0.03, kb_pos[1] + 0.010, kb_pos[2] - 0.17),
    ], 0.0045, mats["curtain"]))

    # 放样流线型人体工学鼠标（真实有机壳面 + 滚花铜轮 + 拇指双键）
    for m_obj in add_ergonomic_mouse((-1.73, 0.769, -2.86), mats):
        S("Hotspot_Desk_About", mark_uv_prio(m_obj, 2))

    S("Hotspot_Desk_About", mark_uv_prio(add_cylinder("Pink_Mug_Coaster", (-0.84, 0.767, -2.62), 0.052, 0.054, 0.007, mats["wood_mid"], segs=22, bevel_caps=0.002), 2))
    S("Hotspot_Desk_About", mark_uv_prio(add_lathe(
        "Pink_Mug",
        (-0.84, 0.770, -2.62),
        [(0.0, 0.0), (0.038, 0.0), (0.044, 0.088), (0.039, 0.092), (0.035, 0.084), (0.033, 0.014), (0.0, 0.014)],
        mats["pink"],
        segs=24,
    ), 2))
    S("Hotspot_Desk_About", mark_uv_prio(add_cylinder("Pink_Mug_Latte", (-0.84, 0.842, -2.62), 0.034, 0.034, 0.004, mats["trim"], segs=20), 2))
    S("Hotspot_Desk_About", mark_uv_prio(add_tube("Pink_Mug_Handle", [(-0.80, 0.840, -2.62), (-0.77, 0.820, -2.62), (-0.80, 0.790, -2.62)], 0.007, mats["pink"], bevel_res=3), 2))

    # 生日小蛋糕（Hotspot_Desk_Cake：阅读垫上的「21」双层蛋糕，点击进入 /birthday/）
    cake_flames = add_birthday_cake(
        CAKE_DESK_ORIGIN,
        0.78,
        lambda o: S("Hotspot_Desk_Cake", mark_uv_prio(o, 2)),
        D,
        prefix="Cake",
    )

    S("Hotspot_Desk_About", mark_uv_prio(add_lathe("Desk_PenCup", (-2.50, 0.7625, -2.68), [(0.0, 0.0), (0.034, 0.0), (0.038, 0.092), (0.033, 0.094), (0.030, 0.086), (0.030, 0.012), (0.0, 0.012)], mats["ceramic"], segs=24), 2))
    for px, pz, rx, rz, mkey in [
        (-2.51, -2.69, 0.14, 0.08, "pink"),
        (-2.49, -2.67, -0.10, 0.15, "brass"),
        (-2.50, -2.66, 0.06, -0.14, "curtain"),
    ]:
        S("Hotspot_Desk_About", mark_uv_prio(add_cylinder_between(f"Desk_Pen_{mkey}", (px, 0.78, pz), (px + rx * 0.12, 0.90, pz + rz * 0.12), 0.0045, 0.004, mats[mkey], segs=8), 2))

    lamp_b = (-2.58, 0.780, -3.02)
    lamp_e1 = (-2.64, 1.03, -2.97)
    lamp_w = (-2.51, 1.22, -2.81)
    lamp_cap = (-2.50, 1.18, -2.78)
    S("Hotspot_Desk_About", mark_uv_prio(add_cylinder("Lamp_Base", (-2.58, 0.776, -3.02), 0.070, 0.078, 0.024, mats["brass"], segs=22, bevel_caps=0.005), 2))
    S("Hotspot_Desk_About", mark_uv_prio(add_cylinder_between("Lamp_Arm_Lower", lamp_b, lamp_e1, 0.0085, 0.0085, mats["brass"], segs=12), 2))
    S("Hotspot_Desk_About", mark_uv_prio(add_sphere("Lamp_Joint_Elbow", lamp_e1, 0.015, mats["steel"], segs=12, rings=8), 2))
    S("Hotspot_Desk_About", mark_uv_prio(add_cylinder_between("Lamp_Arm_Upper", lamp_e1, lamp_w, 0.008, 0.008, mats["brass"], segs=12), 2))
    S("Hotspot_Desk_About", mark_uv_prio(add_sphere("Lamp_Joint_Wrist", lamp_w, 0.013, mats["steel"], segs=12, rings=8), 2))
    S("Hotspot_Desk_About", mark_uv_prio(add_cylinder_between("Lamp_Arm_Neck", lamp_w, lamp_cap, 0.0075, 0.0075, mats["brass"], segs=12), 2))
    S("Hotspot_Desk_About", mark_uv_prio(add_cylinder_between("Lamp_ShadeCap", lamp_cap, (-2.50, 1.155, -2.78), 0.022, 0.025, mats["brass"], segs=16), 2))
    S("Hotspot_Desk_About", mark_uv_prio(add_lathe(
        "Lamp_Shade",
        (-2.50, 1.045, -2.78),
        [(0.094, 0.0), (0.068, 0.088), (0.024, 0.125), (0.0, 0.125), (0.0, 0.119), (0.022, 0.119), (0.064, 0.084), (0.089, 0.0)],
        mats["curtain"],
        segs=26,
    ), 2))
    D(add_sphere("Desk_Lamp_Bulb", (-2.50, 1.075, -2.78), 0.028, mats["glow"], segs=10, rings=6))

    # 曲线木壳人体工学书房椅（Decor_Lounge，含微弧侧抱靠背 + 扶手 + 滚轮）
    chair_cx, chair_cz, chair_ry = -1.78, -2.02, 0.34
    S("Decor_Lounge", add_cylinder("Chair_Stem", (chair_cx, 0.25, chair_cz), 0.022, 0.026, 0.36, mats["steel"], segs=16))
    S("Decor_Lounge", add_cylinder("Chair_Stem_Collar", (chair_cx, 0.22, chair_cz), 0.028, 0.028, 0.08, mats["brass"], segs=16))
    for k in range(5):
        a = (k / 5) * math.tau + chair_ry
        tip_x = chair_cx + math.sin(a) * 0.25
        tip_z = chair_cz + math.cos(a) * 0.25
        S("Decor_Lounge", add_cylinder_between(f"Chair_Foot_{k}", (chair_cx, 0.09, chair_cz), (tip_x, 0.06, tip_z), 0.018, 0.013, mats["steel"], segs=12))
        w_tangent_x = math.cos(a) * 0.012
        w_tangent_z = -math.sin(a) * 0.012
        S("Decor_Lounge", add_cylinder_between(f"Chair_Caster_{k}", (tip_x - w_tangent_x, 0.024, tip_z - w_tangent_z), (tip_x + w_tangent_x, 0.024, tip_z + w_tangent_z), 0.022, 0.022, mats["plinth"], segs=14))
    S("Decor_Lounge", add_plush_cushion("Chair_Seat", (chair_cx, 0.47, chair_cz), (0.50, 0.085, 0.48), mats["upholstery"], (0.0, 0.0, chair_ry)))
    for s in (-1, 1):
        arm_post_a = local_pt((chair_cx, 0.46, chair_cz), chair_ry, (s * 0.24, 0.0, 0.02))
        arm_post_b = local_pt((chair_cx, 0.62, chair_cz), chair_ry, (s * 0.25, 0.0, 0.02))
        S("Decor_Lounge", add_cylinder_between(f"Chair_ArmPost_{s}", arm_post_a, arm_post_b, 0.011, 0.011, mats["brass"], segs=10))
        arm_pad = local_pt((chair_cx, 0.625, chair_cz), chair_ry, (s * 0.25, 0.0, -0.02))
        S("Decor_Lounge", add_box(f"Chair_ArmPad_{s}", arm_pad, (0.044, 0.022, 0.24), mats["wood_mid"], bevel=0.008, rot_y=chair_ry))
    S("Decor_Lounge", add_box(
        "Chair_Back_Shell",
        local_pt((chair_cx, 0.74, chair_cz), chair_ry, (0.0, 0.0, 0.23)),
        (0.42, 0.42, 0.044),
        mats["wood_light"],
        bevel=0.016,
        bevel_segs=2,
        rot_y=chair_ry,
        rot_x=0.12,
    ))
    for s in (-1, 1):
        S("Decor_Lounge", add_box(
            f"Chair_Back_Wing_{s}",
            local_pt((chair_cx, 0.74, chair_cz), chair_ry, (s * 0.22, 0.0, 0.19)),
            (0.085, 0.39, 0.040),
            mats["wood_light"],
            bevel=0.012,
            bevel_segs=2,
            rot_y=chair_ry - s * 0.42,
            rot_x=0.12,
        ))
    S("Decor_Lounge", add_plush_cushion(
        "Chair_Back_Pad",
        local_pt((chair_cx, 0.74, chair_cz), chair_ry, (0.0, 0.0, 0.19)),
        (0.41, 0.36, 0.044),
        mats["upholstery"],
        (0.12, 0.0, chair_ry),
    ))

    # ================================================================
    # 4. 左墙：五隔层浅橡木分类书柜（Arch_Bookcase，保持 1:1 书本槽位）
    # ================================================================
    S("Arch_Bookcase", add_box("BC_Kick", (-3.15, 0.075, -1.05), (0.42, 0.15, 2.58), mats["wood_mid"], bevel=0.006))
    S("Arch_Bookcase", add_box("BC_Back", (-3.355, 1.40, -1.05), (0.03, 2.56, 2.56), mats["wood_mid"], bevel=0.003))
    S("Arch_Bookcase", add_box("BC_Stile_L", (-3.14, 1.41, -2.33), (0.45, 2.56, 0.045), mats["wood_light"], bevel=0.008))
    S("Arch_Bookcase", add_box("BC_Stile_R", (-3.14, 1.41, 0.23), (0.45, 2.56, 0.045), mats["wood_light"], bevel=0.008))
    S("Arch_Bookcase", add_box("BC_Stile_Mid", (-3.14, 1.83, -1.05), (0.43, 1.68, 0.04), mats["wood_light"], bevel=0.006))
    for sy in (0.14, 0.98, 1.82, 2.64):
        S("Arch_Bookcase", add_box(f"BC_Shelf_{sy:.2f}", (-3.14, sy, -1.05), (0.45, 0.04, 2.60), mats["wood_light"], bevel=0.007))
    S("Arch_Bookcase", add_box("BC_Crown", (-3.12, 2.70, -1.05), (0.50, 0.075, 2.68), mats["wood_mid"], bevel=0.014, bevel_segs=1))

    plate_specs = [
        ("Plate_Shelf_0", (-2.912, 1.82, -1.69), mats["plate0"]),
        ("Plate_Shelf_1", (-2.912, 1.82, -0.41), mats["plate1"]),
        ("Plate_Shelf_2", (-2.912, 0.98, -1.69), mats["plate2"]),
        ("Plate_Shelf_3", (-2.912, 0.98, -0.41), mats["plate3"]),
        ("Plate_Shelf_4", (-2.912, 0.14, -1.05), mats["plate4"]),
    ]
    for pname, ppos, pmat in plate_specs:
        D(add_uv_panel(pname, ppos, 0.34, 0.082, pmat, facing="+X"))

    for idx, (ly, lz, lw) in enumerate([(2.61, -1.69, 1.14), (2.61, -0.41, 1.14), (1.79, -1.69, 1.14), (1.79, -0.41, 1.14), (0.95, -1.05, 2.40)]):
        D(add_box(f"Shelf_LED_{idx}", (-3.02, ly, lz), (0.016, 0.012, lw), mats["glow"], bevel=0.0))

    # [项目] 车削空心深胡桃木卷轴筒 + 双卷中空羊皮卷轴（严丝合缝贴合隔板 y=1.84，零穿模）
    S("Decor_Lounge", mark_uv_prio(add_lathe(
        "Prop_Proj_Cup",
        (-3.12, 1.84, -1.20),
        [
            (0.0, 0.0),
            (0.049, 0.0),
            (0.054, 0.012),
            (0.056, 0.140),
            (0.053, 0.155),
            (0.047, 0.155),
            (0.044, 0.144),
            (0.043, 0.018),
            (0.0, 0.018),
        ],
        mats["wood_dark"],
        segs=28,
    ), 2))
    scroll_specs = [
        ("Prop_Proj_Roll_0", (-3.106, 1.862, -1.212), 0.235, (-0.03, -0.04, 0.0), 0.165),
        ("Prop_Proj_Roll_1", (-3.132, 1.862, -1.186), 0.195, (0.04, 0.03, 0.0), 0.135),
    ]
    for r_name, r_pos, r_h, r_rot, band_h in scroll_specs:
        S("Decor_Lounge", mark_uv_prio(add_lathe(
            r_name,
            r_pos,
            [
                (0.0, 0.0),
                (0.0145, 0.0),
                (0.0155, r_h * 0.92),
                (0.0145, r_h),
                (0.0105, r_h),
                (0.0095, r_h * 0.72),
                (0.0, r_h * 0.72),
            ],
            mats["ceramic"],
            segs=20,
            rot_euler=r_rot,
        ), 2))
        S("Decor_Lounge", mark_uv_prio(add_lathe(
            f"{r_name}_Band",
            r_pos,
            [
                (0.0154, band_h),
                (0.0166, band_h + 0.002),
                (0.0166, band_h + 0.012),
                (0.0154, band_h + 0.014),
            ],
            mats["brass"],
            segs=18,
            rot_euler=r_rot,
        ), 2))

    S("Decor_Lounge", mark_uv_prio(add_box("Prop_Tool_Box", (-3.12, 1.895, 0.08), (0.20, 0.11, 0.18), mats["steel"], bevel=0.012), 2))
    S("Decor_Lounge", mark_uv_prio(add_cylinder("Prop_Tool_Handle", (-3.12, 1.965, 0.08), 0.008, 0.008, 0.09, mats["brass"], segs=12, rot_euler=(math.pi * 0.5, 0.0, 0.0)), 2))

    arm_c = (-3.12, 1.12, -1.20)
    S("Decor_Lounge", mark_uv_prio(add_cylinder("Prop_Exp_Base", (-3.12, 1.018, -1.20), 0.050, 0.062, 0.036, mats["wood_dark"], segs=24), 2))
    S("Decor_Lounge", mark_uv_prio(add_cylinder_between("Prop_Exp_Stem", (-3.12, 1.034, -1.20), (-3.12, 1.175, -1.20), 0.007, 0.005, mats["brass"], segs=12), 2))
    S("Decor_Lounge", mark_uv_prio(add_torus("Prop_Exp_RingOuter", arm_c, 0.056, 0.0045, mats["brass"], rot_euler=(math.pi * 0.5, 0.0, 0.0)), 2))
    S("Decor_Lounge", mark_uv_prio(add_torus("Prop_Exp_RingEq", arm_c, 0.048, 0.004, mats["brass"], rot_euler=(0.38, 0.2, 0.65)), 2))
    S("Decor_Lounge", mark_uv_prio(add_torus("Prop_Exp_RingMer", arm_c, 0.041, 0.0038, mats["brass"], rot_euler=(math.pi * 0.5, 0.42, -0.4)), 2))
    S("Decor_Lounge", mark_uv_prio(add_cylinder_between("Prop_Exp_Axis", (-3.12, 1.072, -1.225), (-3.12, 1.168, -1.175), 0.0035, 0.0035, mats["steel"], segs=10), 2))
    S("Decor_Lounge", mark_uv_prio(add_sphere("Prop_Exp_Core", arm_c, 0.018, mats["brass"], segs=16, rings=12), 2))

    # [日常] 光滑陶土多肉盆（36段 + 莲座状多层叶片）
    S("Decor_Lounge", mark_uv_prio(add_lathe(
        "Prop_Daily_Pot",
        (-3.12, 1.00, 0.08),
        [(0.0, 0.0), (0.040, 0.0), (0.052, 0.06), (0.054, 0.086), (0.049, 0.092), (0.043, 0.086), (0.041, 0.075), (0.0, 0.075)],
        mats["pink"],
        segs=36,
    ), 2))
    S("Decor_Lounge", mark_uv_prio(add_cylinder("Prop_Daily_Soil", (-3.12, 1.080, 0.08), 0.042, 0.042, 0.010, mats["soil"], segs=20), 2))
    for ring_idx, (num_p, rad_r, y_p, leaf_l, tilt_p) in enumerate([(7, 0.018, 1.088, 0.036, 0.28), (5, 0.007, 1.096, 0.026, 0.72)]):
        for p_i in range(num_p):
            ang = (p_i / num_p) * math.tau + ring_idx * 0.45
            bx = -3.12 + math.cos(ang) * rad_r
            bz = 0.08 + math.sin(ang) * rad_r
            S("Decor_Lounge", mark_uv_prio(add_botanical_leaf(
                f"Succ_Leaf_{ring_idx}_{p_i}",
                (bx, y_p, bz),
                yaw=-ang + math.pi * 0.5,
                pitch=tilt_p,
                length=leaf_l,
                width=leaf_l * 0.65,
                droop=-0.006,
                mat=mats["plant"],
                arch_cup=0.006,
                thickness=0.003,
                cols=5,
                rows=5,
            ), 2))

    # [小萌] 圆润温润白瓷小猫雕塑（24 段顺滑身躯 + 贴合圆耳粉内耳 + 立体蝴蝶结 + 贴合卷尾）
    kitty_z = -0.62
    S("Decor_Lounge", mark_uv_prio(add_lathe(
        "Kitty_Body",
        (-3.12, 0.16, kitty_z),
        [
            (0.0, 0.0),
            (0.056, 0.0),
            (0.080, 0.032),
            (0.086, 0.078),
            (0.074, 0.128),
            (0.050, 0.162),
            (0.0, 0.168),
        ],
        mats["ceramic"],
        segs=24,
    ), 2))
    S("Decor_Lounge", mark_uv_prio(add_sphere("Kitty_Head", (-3.12, 0.398, kitty_z), 0.088, mats["ceramic"], scale=(0.94, 0.90, 1.05), segs=24, rings=16), 2))
    for s in (-1, 1):
        S("Decor_Lounge", mark_uv_prio(add_lathe(
            f"Kitty_Ear_{s}",
            (-3.12, 0.438, kitty_z + s * 0.052),
            [(0.028, 0.0), (0.026, 0.024), (0.017, 0.052), (0.008, 0.068), (0.0, 0.072)],
            mats["ceramic"],
            segs=16,
            rot_euler=(s * 0.24, 0.0, 0.0),
        ), 2))
        S("Decor_Lounge", mark_uv_prio(add_sphere(f"Kitty_EarPad_{s}", (-3.097, 0.465, kitty_z + s * 0.055), 0.016, mats["pink"], scale=(0.42, 0.95, 0.65), segs=12, rings=8, rot_euler=(s * 0.24, 0.0, 0.0)), 2))
        S("Decor_Lounge", mark_uv_prio(add_sphere(f"Kitty_Paw_{s}", (-3.048, 0.180, kitty_z + s * 0.036), 0.019, mats["ceramic"], scale=(1.15, 0.72, 0.85), segs=12, rings=8), 2))
        S("Decor_Lounge", mark_uv_prio(add_sphere(f"Kitty_Cheek_{s}", (-3.046, 0.382, kitty_z + s * 0.048), 0.014, mats["pink"], scale=(0.45, 0.62, 1.18), segs=12, rings=8), 2))
        S("Decor_Lounge", mark_uv_prio(add_sphere(f"Kitty_Eye_{s}", (-3.040, 0.408, kitty_z + s * 0.033), 0.0088, mats["steel"], scale=(0.55, 1.15, 0.92), segs=12, rings=8), 2))
        S("Decor_Lounge", mark_uv_prio(add_sphere(f"Kitty_Bow_Loop_{s}", (-3.047, 0.319, kitty_z + s * 0.018), 0.013, mats["pink"], scale=(0.55, 0.88, 1.25), segs=12, rings=8, rot_euler=(s * 0.18, 0.0, 0.0)), 2))
        S("Decor_Lounge", mark_uv_prio(add_box(f"Kitty_Bow_Tail_{s}", (-3.046, 0.299, kitty_z + s * 0.012), (0.007, 0.022, 0.011), mats["pink"], bevel=0.0025, bevel_segs=2, rot_x=s * 0.32), 2))
    S("Decor_Lounge", mark_uv_prio(add_sphere("Kitty_Nose", (-3.035, 0.388, kitty_z), 0.0062, mats["pink"], scale=(0.65, 0.78, 1.25), segs=12, rings=8), 2))
    S("Decor_Lounge", mark_uv_prio(add_sphere("Kitty_Bow_Knot", (-3.044, 0.318, kitty_z), 0.010, mats["pink"], scale=(0.8, 0.9, 1.0), segs=12, rings=8), 2))
    S("Decor_Lounge", mark_uv_prio(add_sphere("Kitty_Bell", (-3.036, 0.298, kitty_z), 0.0105, mats["brass"], segs=12, rings=8), 2))
    S("Decor_Lounge", mark_uv_prio(add_tube("Kitty_Tail", [(-3.18, 0.20, kitty_z), (-3.22, 0.21, -0.54), (-3.18, 0.26, -0.495), (-3.13, 0.30, -0.505)], 0.014, mats["ceramic"], bevel_res=4, taper_end=0.82), 2))
    S("Decor_Lounge", mark_uv_prio(add_sphere("Kitty_TailTip", (-3.13, 0.30, -0.505), 0.0115, mats["ceramic"], segs=12, rings=8), 2))
    S("Decor_Lounge", mark_uv_prio(add_box("XM_Gift_Box", (-3.12, 0.23, -0.10), (0.22, 0.14, 0.24), mats["curtain"], bevel=0.01), 2))
    S("Decor_Lounge", mark_uv_prio(add_box("XM_Gift_Rib", (-3.12, 0.235, -0.10), (0.23, 0.15, 0.03), mats["pink"], bevel=0.002), 2))
    for s in (-1, 1):
        S("Decor_Lounge", mark_uv_prio(add_sphere(f"XM_Gift_Bow_{s}", (-3.12, 0.312, -0.10 + s * 0.022), 0.016, mats["pink"], scale=(0.65, 0.72, 1.25), segs=12, rings=8, rot_euler=(s * 0.24, 0.0, 0.0)), 2))

    # ================================================================
    # 5. 左墙中段：公告日历（Hotspot_Cal_Notice）+ 月相钟与小木凳
    # ================================================================
    S("Decor_Lounge", mark_uv_prio(add_torus("Wall_Lunar_Clock", (-3.37, 2.58, 0.78), 0.125, 0.011, mats["brass"], major_segs=28, minor_segs=10, rot_euler=(0.0, math.pi * 0.5, 0.0)), 2))
    S("Decor_Lounge", mark_uv_prio(add_cylinder_between("Wall_Lunar_Dial", (-3.384, 2.58, 0.78), (-3.372, 2.58, 0.78), 0.114, 0.114, mats["ceramic"], segs=24), 2))
    S("Decor_Lounge", mark_uv_prio(add_cylinder_between("Wall_Lunar_Moon", (-3.373, 2.58, 0.79), (-3.364, 2.58, 0.79), 0.044, 0.044, mats["brass"], segs=18), 2))

    S("Hotspot_Cal_Notice", add_box("Cal_TopBar", (-3.36, 2.18, 0.78), (0.04, 0.048, 0.52), mats["wood_mid"], bevel=0.008))
    S("Hotspot_Cal_Notice", add_box("Cal_Pad", (-3.365, 1.88, 0.78), (0.026, 0.58, 0.44), mats["trim"], bevel=0.004))
    D(add_uv_panel("Face_Calendar", (-3.348, 1.88, 0.78), 0.43, 0.57, mats["face_cal"], facing="+X"))
    S("Decor_Lounge", add_box("Stool_Top", (-3.12, 0.42, 0.78), (0.38, 0.038, 0.50), mats["wood_light"], bevel=0.01))
    for lx, lz in ((-3.26, 0.58), (-2.98, 0.58), (-3.26, 0.98), (-2.98, 0.98)):
        S("Decor_Lounge", add_cylinder(f"Stool_Leg_{lx:.2f}_{lz:.2f}", (lx, 0.21, lz), 0.02, 0.014, 0.42, mats["wood_mid"], segs=14))

    # ================================================================
    # 6. 左墙前段：电视柜与复古 CRT 电视（Hotspot_TV_Game）
    # ================================================================
    S("Hotspot_TV_Game", add_box("TV_Cred_Top", (-3.08, 0.545, 2.06), (0.54, 0.03, 1.48), mats["wood_light"], bevel=0.009, bevel_segs=2))
    S("Hotspot_TV_Game", add_box("TV_Cred_Bot", (-3.08, 0.215, 2.06), (0.54, 0.03, 1.48), mats["wood_light"], bevel=0.009, bevel_segs=2))
    S("Hotspot_TV_Game", add_box("TV_Cred_Back", (-3.335, 0.38, 2.06), (0.03, 0.30, 1.44), mats["wood_mid"], bevel=0.004))
    S("Hotspot_TV_Game", add_box("TV_Cred_SideL", (-3.08, 0.38, 1.335), (0.54, 0.30, 0.03), mats["wood_light"], bevel=0.008))
    S("Hotspot_TV_Game", add_box("TV_Cred_SideR", (-3.08, 0.38, 2.785), (0.54, 0.30, 0.03), mats["wood_light"], bevel=0.008))
    S("Hotspot_TV_Game", add_box("TV_Cred_DivL", (-3.08, 0.38, 1.775), (0.50, 0.30, 0.024), mats["wood_mid"], bevel=0.004))
    S("Hotspot_TV_Game", add_box("TV_Cred_DivR", (-3.08, 0.38, 2.345), (0.50, 0.30, 0.024), mats["wood_mid"], bevel=0.004))
    S("Hotspot_TV_Game", add_box("TV_Cubby_InnerShelf", (-3.09, 0.375, 2.06), (0.48, 0.018, 0.54), mats["wood_dark"], bevel=0.004))

    for d_idx, dz_c in enumerate((1.555, 2.565)):
        S("Hotspot_TV_Game", add_box(f"TV_Door_{d_idx}", (-2.818, 0.38, dz_c), (0.022, 0.292, 0.405), mats["wood_mid"], bevel=0.005))
        for sl in (-0.14, -0.07, 0.0, 0.07, 0.14):
            S("Hotspot_TV_Game", add_box(f"TV_Slat_{d_idx}_{sl:.2f}", (-2.804, 0.38, dz_c + sl), (0.008, 0.255, 0.028), mats["wood_light"], bevel=0.0))
        knob_z = 1.71 if d_idx == 0 else 2.41
        S("Hotspot_TV_Game", add_cylinder_between(f"TV_DoorPull_{d_idx}", (-2.807, 0.38, knob_z), (-2.785, 0.38, knob_z), 0.011, 0.012, mats["brass"], segs=10))

    S("Hotspot_TV_Game", add_box("Game_Console", (-3.02, 0.255, 2.02), (0.28, 0.048, 0.34), mats["steel"], bevel=0.008))
    S("Hotspot_TV_Game", add_box("Console_FrontBar", (-2.878, 0.258, 2.02), (0.010, 0.010, 0.24), mats["trim"], bevel=0.002))
    D(add_box("Console_Led", (-2.876, 0.268, 1.88), (0.008, 0.006, 0.018), mats["glow"], bevel=0.0))
    S("Hotspot_TV_Game", add_box("Cubby_Disc_0", (-3.00, 0.422, 1.96), (0.14, 0.075, 0.022), mats["pink"], bevel=0.003))
    S("Hotspot_TV_Game", add_box("Cubby_Disc_1", (-3.00, 0.422, 1.99), (0.14, 0.075, 0.022), mats["curtain"], bevel=0.003))

    for lx, lz in ((-3.28, 1.40), (-2.88, 1.40), (-3.28, 2.72), (-2.88, 2.72)):
        S("Hotspot_TV_Game", add_cylinder(f"TV_Leg_{lx:.2f}_{lz:.2f}", (lx, 0.108, lz), 0.024, 0.015, 0.184, mats["wood_mid"], segs=14))
        S("Hotspot_TV_Game", add_cylinder(f"TV_LegFoot_{lx:.2f}_{lz:.2f}", (lx, 0.014, lz), 0.015, 0.013, 0.028, mats["brass"], segs=14))

    tv_o = (-3.07, 0.84, 2.12)
    tv_ry = -0.14

    def tv_p(lx: float, ly: float, lz: float) -> tuple[float, float, float]:
        return local_pt(tv_o, tv_ry, (lx, ly, lz))

    for sx in (-0.12, 0.12):
        for sz in (-0.24, 0.24):
            S("Hotspot_TV_Game", add_cylinder(f"TV_Foot_{sx:.2f}_{sz:.2f}", tv_p(sx, -0.265, sz), 0.022, 0.020, 0.032, mats["steel"], segs=14))

    S("Hotspot_TV_Game", add_box("TV_Housing", tv_p(0.0, 0.0, 0.0), (0.42, 0.50, 0.76), mats["wood_mid"], bevel=0.038, bevel_segs=2, rot_y=tv_ry))
    S("Hotspot_TV_Game", add_box("TV_Bezel", tv_p(0.195, 0.0, 0.0), (0.04, 0.43, 0.68), mats["trim"], bevel=0.015, bevel_segs=1, rot_y=tv_ry))
    S("Hotspot_TV_Game", add_box("TV_Screen_Rim", tv_p(0.212, 0.0, 0.068), (0.018, 0.386, 0.496), mats["steel"], bevel=0.006, rot_y=tv_ry))
    D(add_uv_panel("Screen_CRT", tv_p(0.223, 0.0, 0.068), 0.475, 0.365, mats["screen_crt"], facing="+X", rot_y_extra=tv_ry))

    for ky in (0.115, 0.015):
        S("Hotspot_TV_Game", add_cylinder_between(f"TV_DialCollar_{ky:.2f}", tv_p(0.214, ky, -0.245), tv_p(0.224, ky, -0.245), 0.032, 0.030, mats["steel"], segs=18))
        S("Hotspot_TV_Game", add_cylinder_between(f"TV_Dial_{ky:.2f}", tv_p(0.222, ky, -0.245), tv_p(0.248, ky, -0.245), 0.025, 0.023, mats["brass"], segs=18))
        S("Hotspot_TV_Game", add_cylinder_between(f"TV_DialCap_{ky:.2f}", tv_p(0.247, ky, -0.245), tv_p(0.252, ky, -0.245), 0.010, 0.010, mats["wood_dark"], segs=12))
    S("Hotspot_TV_Game", add_cylinder_between("TV_PowerBtn", tv_p(0.214, -0.062, -0.262), tv_p(0.228, -0.062, -0.262), 0.009, 0.009, mats["steel"], segs=12))
    D(add_sphere("TV_PowerLed", tv_p(0.224, -0.062, -0.228), 0.006, mats["glow"], segs=10, rings=8))
    for gl in (-0.105, -0.126, -0.147, -0.168):
        S("Hotspot_TV_Game", add_box(f"TV_Grille_{gl:.3f}", tv_p(0.218, gl, -0.245), (0.008, 0.008, 0.088), mats["steel"], bevel=0.002, rot_y=tv_ry))

    S("Hotspot_TV_Game", add_cylinder("TV_AntBase", tv_p(0.0, 0.256, 0.0), 0.032, 0.042, 0.018, mats["brass"], segs=16))
    for s in (-1, 1):
        a0 = tv_p(0.0, 0.262, s * 0.018)
        a1 = tv_p(0.0, 0.545, s * 0.168)
        S("Hotspot_TV_Game", add_cylinder_between(f"TV_Ant_{s}", a0, a1, 0.007, 0.004, mats["steel"], segs=10))
        S("Hotspot_TV_Game", add_sphere(f"TV_AntTip_{s}", a1, 0.015, mats["pink"], segs=12, rings=8))

    S("Hotspot_TV_Game", add_box("Cart_Rack", (-3.02, 0.566, 1.445), (0.12, 0.012, 0.15), mats["wood_dark"], bevel=0.004))
    for idx, mkey in enumerate(["pink", "plant", "curtain"]):
        cz = 1.405 + idx * 0.042
        S("Hotspot_TV_Game", add_box(f"Cart_{idx}", (-3.02, 0.635, cz), (0.095, 0.128, 0.026), mats[mkey], bevel=0.004))
        S("Hotspot_TV_Game", add_box(f"Cart_Lbl_{idx}", (-2.971, 0.635, cz), (0.004, 0.084, 0.018), mats["ceramic"], bevel=0.001))

    gp_o = (-2.94, 0.566, 1.65)
    gp_ry = 0.28

    def gp_p(lx: float, ly: float, lz: float) -> tuple[float, float, float]:
        return local_pt(gp_o, gp_ry, (lx, ly, lz))

    S("Hotspot_TV_Game", add_box("Gamepad_Body", gp_p(0.0, 0.014, 0.0), (0.072, 0.020, 0.125), mats["trim"], bevel=0.009, bevel_segs=1, rot_y=gp_ry))
    for s in (-1, 1):
        g_top = gp_p(0.008, 0.014, s * 0.048)
        g_end = gp_p(0.046, 0.007, s * 0.068)
        S("Hotspot_TV_Game", add_cylinder_between(f"Gamepad_Grip_{s}", g_top, g_end, 0.017, 0.013, mats["trim"], segs=14))
        S("Hotspot_TV_Game", add_sphere(f"Gamepad_Cap_{s}", g_end, 0.013, mats["trim"], segs=12, rings=8))
    S("Hotspot_TV_Game", add_box("GP_Dpad_H", gp_p(-0.006, 0.026, -0.042), (0.022, 0.006, 0.008), mats["steel"], bevel=0.001, rot_y=gp_ry))
    S("Hotspot_TV_Game", add_box("GP_Dpad_V", gp_p(-0.006, 0.026, -0.042), (0.008, 0.006, 0.022), mats["steel"], bevel=0.001, rot_y=gp_ry))
    for sz in (-0.018, 0.018):
        S("Hotspot_TV_Game", add_cylinder(f"GP_Stick_{sz:.3f}", gp_p(0.014, 0.028, sz), 0.010, 0.006, 0.010, mats["plinth"], segs=12))
    for (bx, bz, mkey) in [(-0.014, 0.042, "pink"), (0.0, 0.042, "brass"), (-0.007, 0.035, "curtain"), (-0.007, 0.049, "plant")]:
        S("Hotspot_TV_Game", add_cylinder(f"GP_Btn_{mkey}", gp_p(bx, 0.026, bz), 0.0042, 0.0042, 0.005, mats[mkey], segs=10))

    # ================================================================
    # 7. 后墙中段：软木标签板（Hotspot_Board_Tags）+ 黑胶唱片柜（Decor_Lounge）
    # ================================================================
    D(add_uv_panel("Face_Cork", (0.28, 1.98, -3.372), 1.20, 0.84, mats["face_cork"], facing="+Z"))
    for fx, fy, fw, fh in (
        (0.28, 2.42, 1.28, 0.05),
        (0.28, 1.54, 1.28, 0.05),
        (-0.34, 1.98, 0.05, 0.92),
        (0.90, 1.98, 0.05, 0.92),
    ):
        S("Hotspot_Board_Tags", add_box(f"Cork_Frame_{fx:.2f}_{fy:.2f}", (fx, fy, -3.37), (fw, fh, 0.046), mats["wood_light"], bevel=0.008))

    S("Decor_Lounge", add_box("Side_Credenza", (0.28, 0.46, -3.14), (1.22, 0.66, 0.42), mats["wood_light"], bevel=0.014, bevel_segs=2))
    for d_idx, dx_c in enumerate((-0.02, 0.58)):
        S("Decor_Lounge", add_box(f"Side_Door_{d_idx}", (dx_c, 0.46, -2.928), (0.55, 0.58, 0.022), mats["wood_mid"], bevel=0.006))
        pull_x = dx_c + (0.21 if d_idx == 0 else -0.21)
        S("Decor_Lounge", add_cylinder(f"Side_Pull_{d_idx}", (pull_x, 0.50, -2.905), 0.010, 0.010, 0.018, mats["brass"], segs=12, rot_euler=(math.pi * 0.5, 0.0, 0.0)))
    for lx in (-0.24, 0.80):
        for lz in (-3.28, -3.00):
            S("Decor_Lounge", add_cylinder(f"Side_Leg_{lx:.2f}_{lz:.2f}", (lx, 0.07, lz), 0.02, 0.013, 0.14, mats["wood_mid"], segs=12))

    S("Decor_Lounge", add_box("Turntable", (0.04, 0.82, -3.14), (0.38, 0.055, 0.30), mats["trim"], bevel=0.008))
    S("Decor_Lounge", add_cylinder("Turntable_Platter", (-0.01, 0.850, -3.14), 0.122, 0.125, 0.008, mats["steel"], segs=32))
    S("Decor_Lounge", add_cylinder("Vinyl_Disc", (-0.01, 0.857, -3.14), 0.115, 0.115, 0.008, mats["plinth"], segs=32))
    S("Decor_Lounge", add_cylinder("Vinyl_Label", (-0.01, 0.862, -3.14), 0.038, 0.038, 0.006, mats["pink"], segs=20))
    S("Decor_Lounge", add_cylinder("Vinyl_Spindle", (-0.01, 0.868, -3.14), 0.004, 0.004, 0.012, mats["brass"], segs=10))
    S("Decor_Lounge", add_cylinder("Tonearm_Pivot", (0.16, 0.862, -3.22), 0.020, 0.022, 0.024, mats["brass"], segs=16))
    S("Decor_Lounge", add_tube("Tonearm_Tube", [(0.16, 0.875, -3.22), (0.145, 0.880, -3.14), (0.08, 0.876, -3.09)], 0.004, mats["brass"]))
    S("Decor_Lounge", add_box("Tonearm_Headshell", (0.072, 0.872, -3.084), (0.026, 0.010, 0.014), mats["steel"], bevel=0.002, rot_y=0.35))

    S("Decor_Lounge", add_box("LP_Stand_Base", (0.50, 0.798, -3.14), (0.24, 0.016, 0.24), mats["wood_mid"], bevel=0.004))
    for idx, mkey in enumerate(["pink", "curtain", "plant", "wood_dark"]):
        S("Decor_Lounge", add_box(f"LP_Sleeve_{idx}", (0.44 + idx * 0.038, 0.905, -3.14), (0.010, 0.22, 0.22), mats[mkey], bevel=0.002, rot_z=-0.06 + idx * 0.02))

    S("Decor_Lounge", add_cylinder("HP_Base", (0.76, 0.798, -3.11), 0.056, 0.062, 0.016, mats["wood_dark"], segs=24))
    S("Decor_Lounge", add_cylinder_between("HP_Stem", (0.76, 0.806, -3.11), (0.76, 1.03, -3.11), 0.007, 0.007, mats["brass"], segs=12))
    S("Decor_Lounge", add_cylinder("HP_CrossRest", (0.76, 1.032, -3.11), 0.014, 0.014, 0.044, mats["brass"], segs=12, rot_euler=(math.pi * 0.5, 0.0, 0.0)))
    S("Decor_Lounge", add_tube("HP_Headband", [(0.705, 0.955, -3.11), (0.715, 1.028, -3.11), (0.76, 1.050, -3.11), (0.805, 1.028, -3.11), (0.815, 0.955, -3.11)], 0.010, mats["steel"], bevel_res=3))
    for s in (-1, 1):
        S("Decor_Lounge", add_sphere(f"HP_Cup_{s}", (0.76 + s * 0.058, 0.925, -3.11), 0.038, mats["curtain"], scale=(0.48, 1.15, 1.02)))

    # ================================================================
    # 8. 后墙右侧：三幅画框画廊墙（Hotspot_Gallery_Wall）+ 精细 48 段白瓷龟背竹盆栽（Decor_Lounge）
    # ================================================================
    gallery_specs = [
        ("Art_Gallery_0", 1.72, 2.02, 0.98, 0.74, mats["art0"]),
        ("Art_Gallery_1", 2.70, 2.34, 0.70, 0.52, mats["art1"]),
        ("Art_Gallery_2", 2.70, 1.66, 0.70, 0.52, mats["art2"]),
    ]
    for gname, gx, gy, gw, gh, gmat in gallery_specs:
        t = 0.042
        D(add_uv_panel(gname, (gx, gy, -3.372), gw - t * 1.4, gh - t * 1.4, gmat, facing="+Z"))
        for bx, by, bw, bh in (
            (gx, gy + gh / 2 - t / 2, gw, t),
            (gx, gy - gh / 2 + t / 2, gw, t),
            (gx - gw / 2 + t / 2, gy, t, gh - t * 2),
            (gx + gw / 2 - t / 2, gy, t, gh - t * 2),
        ):
            S("Hotspot_Gallery_Wall", add_box(f"{gname}_F_{bx:.2f}_{by:.2f}", (bx, by, -3.368), (bw, bh, 0.05), mats["wood_mid"], bevel=0.008))

    for sx, sy in ((1.72, 2.52), (2.70, 2.72)):
        S("Decor_Lounge", add_box(f"PicLight_Arm_{sx:.2f}", (sx, sy, -3.28), (0.022, 0.022, 0.22), mats["brass"], bevel=0.004))
        S("Decor_Lounge", add_box(f"PicLight_Hood_{sx:.2f}", (sx, sy - 0.01, -3.18), (0.32, 0.036, 0.062), mats["brass"], bevel=0.008))
        D(add_box(f"PicLight_Led_{sx:.2f}", (sx, sy - 0.026, -3.18), (0.28, 0.012, 0.035), mats["glow"], bevel=0.0))

    S("Decor_Lounge", add_box("Gallery_Bench", (2.04, 0.42, -3.02), (1.16, 0.048, 0.40), mats["wood_light"], bevel=0.012))
    for bx in (1.54, 2.54):
        S("Decor_Lounge", add_box(f"Bench_Leg_{bx:.2f}", (bx, 0.20, -3.02), (0.045, 0.40, 0.34), mats["wood_mid"], bevel=0.008))

    # 精细 30 段白瓷接水托盘 + 鼓腰卷口大花盆 + 拱形土壤与石砾 + 9 枝曲线弯茎与心形雕塑龟背竹叶片（距墙与围栏留足安全余量）
    p_cx, p_cz = 2.90, -2.80
    S("Decor_Lounge", mark_uv_prio(add_lathe(
        "Corner_Saucer",
        (p_cx, 0.0, p_cz),
        [(0.0, 0.0), (0.175, 0.0), (0.205, 0.028), (0.198, 0.032), (0.168, 0.012), (0.0, 0.012)],
        mats["ceramic"],
        segs=30,
    ), 2))
    S("Decor_Lounge", mark_uv_prio(add_lathe(
        "Corner_Planter",
        (p_cx, 0.0, p_cz),
        [
            (0.0, 0.014),
            (0.155, 0.014),
            (0.214, 0.165),
            (0.236, 0.340),
            (0.244, 0.372),
            (0.236, 0.392),
            (0.218, 0.394),
            (0.202, 0.376),
            (0.194, 0.335),
            (0.0, 0.335),
        ],
        mats["ceramic"],
        segs=30,
    ), 2))
    S("Decor_Lounge", add_lathe(
        "Corner_Soil",
        (p_cx, 0.0, p_cz),
        [(0.0, 0.365), (0.095, 0.360), (0.165, 0.348), (0.198, 0.336)],
        mats["soil"],
        segs=24,
    ))
    for i, (px, pz, r_peb) in enumerate([(-0.07, 0.05, 0.016), (0.08, -0.04, 0.014), (0.02, 0.09, 0.012), (-0.09, -0.06, 0.013)]):
        S("Decor_Lounge", add_sphere(f"Soil_Pebble_{i}", (p_cx + px, 0.358, p_cz + pz), r_peb, mats["plinth"], scale=(1.3, 0.55, 0.9), segs=8, rings=5))

    leaf_specs = [
        # (ang, stem_h, reach_r, length, width, pitch, droop)
        (0.25, 0.98, 0.25, 0.30, 0.24, 0.20, 0.042),
        (1.05, 0.84, 0.29, 0.27, 0.22, 0.12, 0.048),
        (1.85, 0.92, 0.24, 0.28, 0.23, 0.22, 0.040),
        (2.65, 0.74, 0.27, 0.25, 0.20, 0.10, 0.046),
        (3.45, 0.88, 0.22, 0.26, 0.21, 0.24, 0.038),
        (4.25, 0.69, 0.25, 0.24, 0.19, 0.08, 0.042),
        (5.05, 0.80, 0.25, 0.27, 0.21, 0.16, 0.044),
        (5.75, 0.66, 0.21, 0.21, 0.17, 0.06, 0.036),
        (0.70, 1.06, 0.14, 0.24, 0.18, 0.34, 0.032),
    ]
    for i, (ang, h_stem, r_reach, l_len, l_w, l_pitch, l_droop) in enumerate(leaf_specs):
        ca, sa = math.cos(ang), math.sin(ang)
        p0 = (p_cx + ca * 0.025, 0.34, p_cz + sa * 0.025)
        p1 = (p_cx + ca * (r_reach * 0.48), 0.34 + (h_stem - 0.34) * 0.62, p_cz + sa * (r_reach * 0.48))
        tip = (p_cx + ca * r_reach, h_stem, p_cz + sa * r_reach)
        S("Decor_Lounge", mark_uv_prio(add_tube(f"Monstera_Stem_{i}", [p0, p1, tip], 0.011, mats["plant"], bevel_res=3, taper_end=0.52), 2))
        S("Decor_Lounge", mark_uv_prio(add_botanical_leaf(
            f"Monstera_Leaf_{i}",
            tip,
            yaw=-ang + math.pi * 0.5,
            pitch=l_pitch,
            length=l_len,
            width=l_w,
            droop=l_droop,
            mat=mats["plant"],
            arch_cup=0.024,
            thickness=0.0045,
            cols=6,
            rows=6,
        ), 2))

    # ================================================================
    # 9. 起居区：星轨地毯（纳入静态烘焙接收茶几/沙发/望远镜阴影）、沙发连续弯折搭毯、茶几、落地灯与望远镜
    # ================================================================
    rug_obj = add_cylinder("Rug_Main", (0.18, 0.008, 0.86), 1.82, 1.84, 0.016, mats["rug"], segs=36, bevel_caps=0.006)
    bm = bmesh.new()
    bm.from_mesh(rug_obj.data)
    uv_lay = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for loop in f.loops:
            u = (loop.vert.co.x / 3.68) + 0.5
            v = (loop.vert.co.y / 3.68) + 0.5
            loop[uv_lay].uv = (u, v)
    bm.to_mesh(rug_obj.data)
    bm.free()
    if rug_obj.data.uv_layers:
        rug_obj.data.uv_layers[0].name = "UVMap"
    rug_obj["_keep_uv0"] = 1
    S("Decor_Lounge", rug_obj)

    sofa_x, sofa_z, sofa_ry = 1.66, 0.34, -0.62

    def sofa_pt(lx: float, ly: float, lz: float) -> tuple[float, float, float]:
        return local_pt((sofa_x, 0.0, sofa_z), sofa_ry, (lx, ly, lz))

    S("Decor_Lounge", add_box("Sofa_Frame", sofa_pt(0.0, 0.16, 0.0), (0.98, 0.09, 0.90), mats["wood_light"], bevel=0.016, rot_y=sofa_ry))
    for lx, lz in ((-0.40, -0.36), (0.40, -0.36), (-0.40, 0.36), (0.40, 0.36)):
        S("Decor_Lounge", add_cylinder(f"Sofa_Leg_{lx:.1f}_{lz:.1f}", sofa_pt(lx, 0.075, lz), 0.024, 0.015, 0.15, mats["wood_mid"], segs=16))
    S("Decor_Lounge", add_plush_cushion("Sofa_Seat", sofa_pt(0.0, 0.295, 0.02), (0.86, 0.17, 0.78), mats["upholstery"], (0.0, 0.0, sofa_ry)))
    S("Decor_Lounge", add_plush_cushion("Sofa_Back", sofa_pt(0.0, 0.58, -0.30), (0.86, 0.50, 0.20), mats["upholstery"], (-0.14, 0.0, sofa_ry)))
    for s in (-1, 1):
        S("Decor_Lounge", add_box(f"Sofa_Arm_{s}", sofa_pt(s * 0.45, 0.38, -0.02), (0.11, 0.34, 0.84), mats["wood_light"], bevel=0.022, bevel_segs=2, rot_y=sofa_ry))
    S("Decor_Lounge", add_plush_cushion("Sofa_Pillow", sofa_pt(-0.14, 0.51, -0.10), (0.34, 0.30, 0.13), mats["pillow"], (-0.28, 0.16, sofa_ry + 0.24)))
    S("Decor_Lounge", add_plush_cushion("Sofa_Pillow_Pink", sofa_pt(0.18, 0.46, -0.12), (0.24, 0.22, 0.10), mats["pink"], (-0.24, -0.14, sofa_ry - 0.18)))

    # 连续平滑弯折的沙发扶手搭毯（单一曲面过渡，彻底消除直棱两片拼接）
    bm_bl = bmesh.new()
    blanket_profile = [
        (0.388, 0.528),
        (0.408, 0.556),
        (0.450, 0.564),
        (0.494, 0.556),
        (0.514, 0.532),
        (0.519, 0.486),
        (0.521, 0.415),
        (0.522, 0.340),
        (0.524, 0.275),
    ]
    z_segs = 8
    bl_grid: list[list[bmesh.types.BMVert]] = []
    for p_idx, (bx, by) in enumerate(blanket_profile):
        row_v: list[bmesh.types.BMVert] = []
        fold_scale = max(0.0, (p_idx - 3) / 5.0) * 0.008
        for zi in range(z_segs + 1):
            u = zi / z_segs
            bz = 0.08 + (u - 0.5) * 0.35
            wave = math.sin(u * math.tau * 1.5) * fold_scale
            row_v.append(bm_bl.verts.new(to_bl(*sofa_pt(bx + wave, by, bz))))
        bl_grid.append(row_v)
    for r in range(len(blanket_profile) - 1):
        for c in range(z_segs):
            bm_bl.faces.new((bl_grid[r][c], bl_grid[r][c + 1], bl_grid[r + 1][c + 1], bl_grid[r + 1][c]))
    bmesh.ops.recalc_face_normals(bm_bl, faces=list(bm_bl.faces))
    me_bl = bpy.data.meshes.new("Sofa_Blanket")
    bm_bl.to_mesh(me_bl)
    bm_bl.free()
    set_smooth(me_bl, True)
    me_bl.materials.append(mats["curtain"])
    bl_obj = link_obj(bpy.data.objects.new("Sofa_Blanket", me_bl))
    sol_bl = bl_obj.modifiers.new("Solidify", "SOLIDIFY")
    sol_bl.thickness = 0.016
    sol_bl.offset = 0.0
    bpy.context.view_layer.objects.active = bl_obj
    bl_obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=sol_bl.name)
    bl_obj.select_set(False)
    set_smooth(bl_obj.data, True)
    S("Decor_Lounge", bl_obj)

    S("Decor_Lounge", add_cylinder("FL_Base", (2.38, 0.02, -0.36), 0.20, 0.21, 0.04, mats["steel"], segs=32, bevel_caps=0.008))
    S("Decor_Lounge", add_tube("FL_Arc", [
        (2.38, 0.04, -0.36),
        (2.38, 1.50, -0.36),
        (2.26, 2.04, -0.22),
        (1.96, 2.22, -0.02),
        (1.80, 2.16, 0.08),
        (1.80, 2.03, 0.08),
        (1.80, 1.97, 0.08),
    ], 0.015, mats["brass"]))
    S("Decor_Lounge", add_cylinder_between("FL_Socket", (1.80, 1.98, 0.08), (1.80, 1.87, 0.08), 0.018, 0.026, mats["brass"], segs=20))
    for i in range(3):
        a = (i / 3) * math.tau
        S("Decor_Lounge", add_cylinder_between(
            f"FL_Spider_{i}",
            (1.80, 1.94, 0.08),
            (1.80 + math.cos(a) * 0.145, 1.94, 0.08 + math.sin(a) * 0.145),
            0.0045,
            0.0045,
            mats["brass"],
            segs=8,
        ))
    D(add_lathe("FL_Shade", (1.80, 1.70, 0.08), [(0.205, 0.0), (0.148, 0.25), (0.142, 0.25), (0.198, 0.0)], mats["trim"], segs=28))
    D(add_sphere("FL_Bulb", (1.80, 1.835, 0.08), 0.042, mats["glow"], segs=12, rings=8))

    S("Decor_Lounge", add_cylinder("Table_Top", (0.20, 0.38, 1.02), 0.54, 0.52, 0.042, mats["wood_light"], segs=32, bevel_caps=0.01))
    for i in range(3):
        a = (i / 3) * math.tau + 0.4
        top_p = (0.20 + math.cos(a) * 0.28, 0.365, 1.02 + math.sin(a) * 0.28)
        bot_p = (0.20 + math.cos(a) * 0.38, 0.0, 1.02 + math.sin(a) * 0.38)
        S("Decor_Lounge", add_cylinder_between(f"Table_Leg_{i}", bot_p, top_p, 0.014, 0.024, mats["wood_mid"], segs=16))
    S("Decor_Lounge", mark_uv_prio(add_cylinder("Tea_Tray", (0.14, 0.405, 1.00), 0.22, 0.21, 0.012, mats["wood_mid"], segs=26, bevel_caps=0.004), 2))
    S("Decor_Lounge", mark_uv_prio(add_lathe("Teapot", (0.04, 0.411, 0.95), [(0.0, 0.0), (0.062, 0.0), (0.086, 0.055), (0.070, 0.11), (0.036, 0.125), (0.016, 0.145), (0.0, 0.145)], mats["ceramic"], segs=24), 2))
    S("Decor_Lounge", mark_uv_prio(add_sphere("Teapot_Knob", (0.04, 0.560, 0.95), 0.012, mats["brass"], segs=12, rings=8), 2))
    S("Decor_Lounge", mark_uv_prio(add_tube("Teapot_Spout", [(0.105, 0.455, 0.95), (0.148, 0.478, 0.95), (0.168, 0.525, 0.95)], 0.011, mats["ceramic"], bevel_res=3, taper_end=0.58), 2))
    S("Decor_Lounge", mark_uv_prio(add_tube("Teapot_Handle", [(-0.025, 0.51, 0.95), (-0.078, 0.49, 0.95), (-0.068, 0.44, 0.95), (-0.03, 0.435, 0.95)], 0.009, mats["ceramic"], bevel_res=3), 2))

    for idx, (cx, cz, mkey) in enumerate([(0.24, 1.08, "pink"), (0.26, 0.92, "ceramic")]):
        S("Decor_Lounge", mark_uv_prio(add_cylinder(f"Teacup_Saucer_{idx}", (cx, 0.413, cz), 0.055, 0.046, 0.008, mats["ceramic"], segs=20), 2))
        S("Decor_Lounge", mark_uv_prio(add_lathe(f"Teacup_{idx}", (cx, 0.417, cz), [(0.0, 0.0), (0.028, 0.0), (0.038, 0.056), (0.034, 0.058), (0.028, 0.01), (0.0, 0.01)], mats[mkey], segs=20), 2))
    S("Decor_Lounge", mark_uv_prio(add_cylinder("Dessert_Plate", (0.34, 0.405, 1.18), 0.085, 0.072, 0.010, mats["ceramic"], segs=22), 2))
    S("Decor_Lounge", mark_uv_prio(add_box("Cake_Base", (0.34, 0.430, 1.18), (0.068, 0.042, 0.052), mats["trim"], bevel=0.006, rot_y=0.45), 2))
    S("Decor_Lounge", mark_uv_prio(add_sphere("Cake_Berry", (0.34, 0.458, 1.18), 0.013, mats["pink"], segs=12, rings=8), 2))

    # 黄铜三脚架天文望远镜（Hotspot_Scope_Door：准确校准朝向统一场景中黑洞原点 (28, -3.6, 44 偏移处)，透过右格玻璃无窗棂遮挡）
    sc_x, sc_z, sc_ry, sc_el = 2.66, 2.08, 0.587, 0.046
    aim_dir = Vector((
        -math.sin(sc_ry) * math.cos(sc_el),
        math.sin(sc_el),
        -math.cos(sc_ry) * math.cos(sc_el),
    )).normalized()
    right_dir = aim_dir.cross(Vector((0.0, 1.0, 0.0))).normalized()
    up_perp = right_dir.cross(aim_dir).normalized()
    pivot = Vector((sc_x, 1.07, sc_z))

    def scope_pt(s: float, up_off: float = 0.0, r_off: float = 0.0) -> tuple[float, float, float]:
        p = pivot + aim_dir * s + up_perp * up_off + right_dir * r_off
        return (p.x, p.y, p.z)

    for i in range(3):
        a = (i / 3) * math.tau + 0.35
        foot = Vector((sc_x + math.cos(a) * 0.34, 0.0, sc_z + math.sin(a) * 0.34))
        top = Vector((sc_x + math.cos(a) * 0.044, 0.885, sc_z + math.sin(a) * 0.044))
        ferrule_end = foot.lerp(top, 0.06)
        mid = foot.lerp(top, 0.50)
        S("Hotspot_Scope_Door", mark_uv_prio(add_cylinder_between(f"Scope_Foot_{i}", (foot.x, foot.y, foot.z), (ferrule_end.x, ferrule_end.y, ferrule_end.z), 0.015, 0.014, mats["brass"], segs=14), 2))
        S("Hotspot_Scope_Door", mark_uv_prio(add_cylinder_between(f"Scope_Leg_{i}", (ferrule_end.x, ferrule_end.y, ferrule_end.z), (top.x, top.y, top.z), 0.012, 0.017, mats["wood_dark"], segs=14), 2))
        S("Hotspot_Scope_Door", mark_uv_prio(add_cylinder_between(f"Scope_Strut_{i}", (sc_x, 0.44, sc_z), (mid.x, mid.y, mid.z), 0.0055, 0.0055, mats["brass"], segs=8), 2))
    S("Hotspot_Scope_Door", mark_uv_prio(add_cylinder("Scope_SpreaderHub", (sc_x, 0.44, sc_z), 0.024, 0.024, 0.024, mats["brass"], segs=14), 2))

    S("Hotspot_Scope_Door", mark_uv_prio(add_cylinder("Scope_Hub", (sc_x, 0.90, sc_z), 0.050, 0.058, 0.08, mats["brass"], segs=18), 2))
    S("Hotspot_Scope_Door", mark_uv_prio(add_cylinder("Scope_YokeBase", (sc_x, 0.952, sc_z), 0.072, 0.056, 0.028, mats["steel"], segs=18), 2))
    for side in (-1, 1):
        fork_bot = (sc_x + right_dir.x * side * 0.064, 0.955, sc_z + right_dir.z * side * 0.064)
        fork_top = (sc_x + right_dir.x * side * 0.064, 1.078, sc_z + right_dir.z * side * 0.064)
        S("Hotspot_Scope_Door", mark_uv_prio(add_cylinder_between(f"Scope_ForkArm_{side}", fork_bot, fork_top, 0.013, 0.011, mats["steel"], segs=12), 2))
        S("Hotspot_Scope_Door", mark_uv_prio(add_sphere(f"Scope_ForkKnob_{side}", (fork_top[0] + right_dir.x * side * 0.012, 1.070, fork_top[2] + right_dir.z * side * 0.012), 0.014, mats["brass"], segs=10, rings=6), 2))

    S("Hotspot_Scope_Door", mark_uv_prio(add_cylinder_between("Scope_Barrel", scope_pt(-0.30), scope_pt(0.36), 0.036, 0.045, mats["brass"], segs=22), 2))
    for rs in (-0.05, 0.05):
        S("Hotspot_Scope_Door", mark_uv_prio(add_cylinder_between(f"Scope_Ring_{rs:.2f}", scope_pt(rs - 0.014), scope_pt(rs + 0.014), 0.046, 0.046, mats["steel"], segs=20), 2))
    S("Hotspot_Scope_Door", mark_uv_prio(add_cylinder_between("Scope_Dew", scope_pt(0.34), scope_pt(0.50), 0.047, 0.056, mats["wood_dark"], segs=22), 2))
    D(add_cylinder_between("Scope_ObjLens", scope_pt(0.42), scope_pt(0.432), 0.046, 0.046, mats["glass"], segs=14))

    S("Hotspot_Scope_Door", add_cylinder_between("Scope_TailCap", scope_pt(-0.32), scope_pt(-0.295), 0.038, 0.032, mats["steel"], segs=12))
    S("Hotspot_Scope_Door", add_cylinder_between("Scope_Focuser", scope_pt(-0.42), scope_pt(-0.315), 0.021, 0.021, mats["steel"], segs=10))
    S("Hotspot_Scope_Door", add_cylinder_between("Scope_FocusShaft", scope_pt(-0.37, 0.0, -0.044), scope_pt(-0.37, 0.0, 0.044), 0.005, 0.005, mats["brass"], segs=6))
    for side in (-1, 1):
        S("Hotspot_Scope_Door", add_sphere(f"Scope_FocusWheel_{side}", scope_pt(-0.37, 0.0, side * 0.046), 0.012, mats["brass"], segs=8, rings=5))

    S("Hotspot_Scope_Door", add_sphere("Scope_Diagonal", scope_pt(-0.42), 0.024, mats["steel"], segs=10, rings=6))
    S("Hotspot_Scope_Door", add_cylinder_between("Scope_EyepieceTube", scope_pt(-0.42), scope_pt(-0.42, 0.068), 0.016, 0.016, mats["brass"], segs=10))
    S("Hotspot_Scope_Door", add_cylinder_between("Scope_Eyecup", scope_pt(-0.42, 0.064), scope_pt(-0.42, 0.092), 0.018, 0.021, mats["wood_dark"], segs=10))

    S("Hotspot_Scope_Door", add_cylinder_between("Scope_Finder", scope_pt(-0.20, 0.078), scope_pt(0.05, 0.078), 0.011, 0.013, mats["steel"], segs=10))
    for bs in (-0.15, -0.01):
        S("Hotspot_Scope_Door", add_cylinder_between(f"Scope_FinderBrk_{bs:.2f}", scope_pt(bs, 0.042), scope_pt(bs, 0.078), 0.005, 0.005, mats["brass"], segs=6))

    # ================================================================
    # 10. 合并到单主网格按重要性分级打包无重叠 UVMap_Bake -> Cycles 2048 接触 AO 与深空光照烘焙 -> 拆分语义组导出 GLB
    # ================================================================
    bpy.context.view_layer.update()
    group_names = [k for k, v in static_groups.items() if v]
    all_static_objs: list[bpy.types.Object] = []
    bpy.ops.object.select_all(action="DESELECT")
    for gid, grp_name in enumerate(group_names):
        for obj in static_groups[grp_name]:
            uv_prio = int(obj.get("_uv_prio", 1))
            is_floor_top = obj.name == "Floor_Top"
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            obj.select_set(False)
            apply_box_uv(obj, scale=0.55)
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            gl = bm.faces.layers.int.new("_grp_id")
            pl = bm.faces.layers.int.new("_uv_prio")
            for f in bm.faces:
                f[gl] = gid
                if is_floor_top and f.normal.z < -0.9:
                    f[pl] = 0
                else:
                    f[pl] = uv_prio
            bm.to_mesh(obj.data)
            bm.free()
            all_static_objs.append(obj)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in all_static_objs:
        obj.select_set(True)
    master_obj = all_static_objs[0]
    master_obj.name = "Temp_Bake_Master"
    bpy.context.view_layer.objects.active = master_obj
    bpy.ops.object.join()

    bake_uv = master_obj.data.uv_layers.new(name="UVMap_Bake")
    master_obj.data.uv_layers.active = bake_uv
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.003, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")

    bm_uv = bmesh.new()
    bm_uv.from_mesh(master_obj.data)
    uv_bake_lay = bm_uv.loops.layers.uv.get("UVMap_Bake")
    pl_uv = bm_uv.faces.layers.int.get("_uv_prio")
    if uv_bake_lay is not None and pl_uv is not None:
        # 按 UV 连通孤岛整体缩放（严禁按单面中心缩放导致曲面接缝撕裂与顶点数翻倍）
        bm_uv.faces.ensure_lookup_table()
        visited = [False] * len(bm_uv.faces)
        for seed in bm_uv.faces:
            if visited[seed.index]:
                continue
            island: list[bmesh.types.BMFace] = []
            stack = [seed]
            visited[seed.index] = True
            while stack:
                cf = stack.pop()
                island.append(cf)
                for edge in cf.edges:
                    if len(edge.link_faces) < 2:
                        continue
                    c_uvs: dict[bmesh.types.BMVert, Vector] = {}
                    for l in cf.loops:
                        if l.vert in edge.verts:
                            c_uvs[l.vert] = l[uv_bake_lay].uv
                    for nf in edge.link_faces:
                        if visited[nf.index]:
                            continue
                        n_uvs = {l.vert: l[uv_bake_lay].uv for l in nf.loops if l.vert in edge.verts}
                        if len(c_uvs) == 2 and len(n_uvs) == 2 and all(
                            (c_uvs[v] - n_uvs[v]).length_squared < 1e-8 for v in edge.verts
                        ):
                            visited[nf.index] = True
                            stack.append(nf)
            max_p = max(f[pl_uv] for f in island)
            s = 0.16 if max_p == 0 else (1.45 if max_p == 2 else 1.0)
            if s != 1.0:
                loops = [l for f in island for l in f.loops]
                if loops:
                    cx = sum(l[uv_bake_lay].uv.x for l in loops) / len(loops)
                    cy = sum(l[uv_bake_lay].uv.y for l in loops) / len(loops)
                    for l in loops:
                        l[uv_bake_lay].uv.x = cx + (l[uv_bake_lay].uv.x - cx) * s
                        l[uv_bake_lay].uv.y = cy + (l[uv_bake_lay].uv.y - cy) * s
        bm_uv.faces.layers.int.remove(pl_uv)
    bm_uv.to_mesh(master_obj.data)
    bm_uv.free()

    scene = bpy.context.scene
    scene.tool_settings.use_uv_select_sync = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(margin=0.0035, scale=True, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 40
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.015
    scene.cycles.sample_clamp_direct = 6.0
    scene.cycles.sample_clamp_indirect = 2.5
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 1
    scene.render.bake.margin = 12
    scene.render.bake.use_clear = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    print(f"[Cycles] Baking unified master mesh ({len(group_names)} groups) onto priority-packed 2048 AO & Cosmic Lightmap")

    seen_mats: list[bpy.types.Material] = []
    for mat in master_obj.data.materials:
        if mat and mat.use_nodes and mat not in seen_mats:
            seen_mats.append(mat)

    def setup_bake_image(
        img_name: str,
        size: int = 2048,
        float_buffer: bool = False,
    ) -> tuple[bpy.types.Image, list[tuple[bpy.types.NodeTree, bpy.types.Node]]]:
        img = bpy.data.images.new(img_name, width=size, height=size, alpha=False, float_buffer=float_buffer)
        created = []
        for mat in seen_mats:
            nt = mat.node_tree
            node = nt.nodes.new("ShaderNodeTexImage")
            node.image = img
            node.select = True
            nt.nodes.active = node
            created.append((nt, node))
        return img, created

    def teardown_bake_nodes(created: list[tuple[bpy.types.NodeTree, bpy.types.Node]]) -> None:
        for nt, node in created:
            nt.nodes.remove(node)

    bpy.ops.object.select_all(action="DESELECT")
    master_obj.select_set(True)
    bpy.context.view_layer.objects.active = master_obj

    # ---- Bake 1: 0.65m 局部接触阴影 Ambient Occlusion（2048×2048，彻底突出体块与角落接触感） ----
    world = bpy.data.worlds.new("BakeWorld")
    scene.world = world
    world.use_nodes = True
    bg_node = world.node_tree.nodes.get("Background")
    bg_node.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg_node.inputs["Strength"].default_value = 1.0

    saved_surface_links: list[tuple[bpy.types.NodeTree, bpy.types.NodeSocket, bpy.types.NodeSocket, list[bpy.types.Node]]] = []
    for mat in seen_mats:
        nt = mat.node_tree
        out_node = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if out_node is None:
            continue
        surf_in = out_node.inputs["Surface"]
        orig_from = surf_in.links[0].from_socket if surf_in.links else None
        ao_node = nt.nodes.new("ShaderNodeAmbientOcclusion")
        ao_node.samples = 16
        ao_node.inputs["Distance"].default_value = 0.65
        gamma_node = nt.nodes.new("ShaderNodeGamma")
        gamma_node.inputs["Gamma"].default_value = 1.18
        emit_node = nt.nodes.new("ShaderNodeEmission")
        emit_node.inputs["Strength"].default_value = 1.0
        nt.links.new(ao_node.outputs["AO"], gamma_node.inputs["Color"])
        nt.links.new(gamma_node.outputs["Color"], emit_node.inputs["Color"])
        nt.links.new(emit_node.outputs["Emission"], surf_in)
        saved_surface_links.append((nt, surf_in, orig_from, [ao_node, gamma_node, emit_node]))

    ao_img, ao_nodes = setup_bake_image("Room_AO", 2048)
    bpy.ops.object.bake(type="EMIT")
    ao_png = OUT_DIR / "room_ao.png"
    ao_img.filepath_raw = str(ao_png)
    ao_img.file_format = "PNG"
    ao_img.save()
    teardown_bake_nodes(ao_nodes)

    for nt, surf_in, orig_from, temp_nodes in saved_surface_links:
        for lnk in list(surf_in.links):
            nt.links.remove(lnk)
        if orig_from is not None:
            nt.links.new(orig_from, surf_in)
        for tn in temp_nodes:
            nt.nodes.remove(tn)
    print(f"[Cycles] Baked 2048 Contact AO -> {ao_png}")

    # ---- Bake 2: 深空庇护所柔光烘培（移除顶部全局天光回弹，深邃太空基调 + 窗外紫粉黑洞漫射 + 柔和局域暖光岛） ----
    bg_node.inputs["Color"].default_value = (0.036, 0.042, 0.082, 1.0)
    bg_node.inputs["Strength"].default_value = 0.19

    bake_lights: list[bpy.types.Object] = []

    def add_bake_light(
        lname: str,
        ltype: str,
        pos: tuple[float, float, float],
        energy: float,
        color: tuple[float, float, float],
        size: float = 0.15,
        look_at: tuple[float, float, float] | None = None,
        shape: str = "SQUARE",
        size_y: float | None = None,
        spread_deg: float | None = None,
    ) -> None:
        ldata = bpy.data.lights.new(name=lname, type=ltype)
        ldata.energy = energy
        ldata.color = color
        if ltype == "POINT":
            ldata.shadow_soft_size = size
        elif ltype == "AREA":
            ldata.shape = shape
            ldata.size = size
            if shape == "RECTANGLE" and size_y is not None:
                ldata.size_y = size_y
            if spread_deg is not None:
                ldata.spread = math.radians(spread_deg)
        lobj = bpy.data.objects.new(lname, ldata)
        vp = to_bl(*pos)
        lobj.location = vp
        if look_at is not None:
            vt = to_bl(*look_at)
            direction = (vt - vp).normalized()
            up_axis = "Y" if abs(direction.z) >= 0.95 else "Z"
            lobj.rotation_euler = direction.to_track_quat("-Z", up_axis).to_euler("XYZ")
        link_obj(lobj)
        bake_lights.append(lobj)

    add_bake_light("L_BH_Window", "AREA", (-1.85, 2.05, -4.35), 32.0, (0.94, 0.72, 0.98), size=2.35, look_at=(0.4, 0.85, 0.5), shape="RECTANGLE", size_y=1.75, spread_deg=115.0)

    add_bake_light("L_Floor_Down", "AREA", (1.80, 1.66, 0.08), 62.0, (1.0, 0.81, 0.56), size=0.55, look_at=(1.35, 0.0, 0.32), shape="DISK", spread_deg=122.0)
    add_bake_light("L_Floor_Shade", "POINT", (1.80, 1.82, 0.08), 28.0, (1.0, 0.79, 0.54), size=0.45)

    add_bake_light("L_Desk_Down", "AREA", (-2.46, 1.02, -2.76), 28.0, (1.0, 0.82, 0.58), size=0.32, look_at=(-1.95, 0.74, -2.82), shape="DISK", spread_deg=112.0)
    add_bake_light("L_Desk_Bounce", "POINT", (-2.15, 1.18, -2.62), 14.0, (1.0, 0.80, 0.58), size=0.35)
    for fi, fp in enumerate(cake_flames):
        add_bake_light(f"L_Cake_Candle_{fi}", "POINT", fp, 0.9, (1.0, 0.70, 0.38), size=0.012)

    add_bake_light("L_Gal1", "AREA", (1.72, 2.46, -3.14), 30.0, (1.0, 0.85, 0.65), size=0.55, look_at=(1.72, 1.82, -3.38), shape="RECTANGLE", size_y=0.14, spread_deg=96.0)
    add_bake_light("L_Gal2", "AREA", (2.70, 2.65, -3.14), 32.0, (1.0, 0.85, 0.65), size=0.55, look_at=(2.70, 1.92, -3.38), shape="RECTANGLE", size_y=0.14, spread_deg=96.0)
    add_bake_light("L_Cork", "AREA", (0.28, 2.55, -2.92), 14.0, (1.0, 0.84, 0.66), size=0.72, look_at=(0.28, 1.80, -3.38), shape="RECTANGLE", size_y=0.18, spread_deg=110.0)

    add_bake_light("L_ShelfTop", "AREA", (-3.00, 2.56, -1.05), 26.0, (1.0, 0.82, 0.58), size=0.14, look_at=(-3.14, 1.91, -1.05), shape="RECTANGLE", size_y=2.15, spread_deg=112.0)
    add_bake_light("L_ShelfMid", "AREA", (-3.00, 1.74, -1.05), 24.0, (1.0, 0.82, 0.58), size=0.14, look_at=(-3.14, 1.09, -1.05), shape="RECTANGLE", size_y=2.15, spread_deg=112.0)
    add_bake_light("L_ShelfBot", "AREA", (-3.00, 0.90, -1.05), 20.0, (1.0, 0.82, 0.58), size=0.14, look_at=(-3.14, 0.25, -1.05), shape="RECTANGLE", size_y=2.15, spread_deg=112.0)

    add_bake_light("L_LeftWall_Soft", "AREA", (-2.70, 2.62, 1.30), 12.0, (1.0, 0.86, 0.72), size=0.95, look_at=(-3.38, 1.65, 1.20), shape="RECTANGLE", size_y=0.25, spread_deg=118.0)
    add_bake_light("L_TV", "AREA", (-2.80, 0.84, 2.15), 12.0, (0.58, 0.84, 1.0), size=0.48, look_at=(-1.6, 0.65, 2.00), shape="RECTANGLE", size_y=0.36, spread_deg=118.0)
    add_bake_light("L_Plant_Rim", "AREA", (2.85, 2.10, -2.25), 9.0, (0.94, 0.86, 0.84), size=0.65, look_at=(2.95, 0.45, -2.85), shape="DISK", spread_deg=125.0)

    saved_colors = {}
    for mat in seen_mats:
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            saved_colors[mat.name] = tuple(bsdf.inputs["Base Color"].default_value)
            bsdf.inputs["Base Color"].default_value = (0.88, 0.88, 0.88, 1.0)

    scene.cycles.samples = 72
    scene.cycles.adaptive_threshold = 0.018
    lm_img, lm_nodes = setup_bake_image("Room_NightLM", 2048, float_buffer=True)
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"})
    import numpy as np
    arr = np.empty(len(lm_img.pixels), dtype=np.float32)
    lm_img.pixels.foreach_get(arr)
    pixels_rgba = arr.reshape((-1, 4))
    rgb = np.maximum(pixels_rgba[:, :3], 0.0)
    pixels_rgba[:, :3] = rgb / (1.0 + rgb * 0.50)
    lm_img.pixels.foreach_set(pixels_rgba.ravel())
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    lm_png = OUT_DIR / "room_night_lm.png"
    lm_img.filepath_raw = str(lm_png)
    lm_img.file_format = "PNG"
    lm_img.save()
    teardown_bake_nodes(lm_nodes)
    print(f"[Cycles] Baked Cosmic Lightmap -> {lm_png}")

    for mat in seen_mats:
        if mat.name in saved_colors:
            mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = saved_colors[mat.name]

    master_obj.data.uv_layers.active = master_obj.data.uv_layers["UVMap"]

    # 从统一烘焙主网格按 _grp_id 拆分为 9 个语义命名的组（保留完整 UVMap 与共享 UVMap_Bake）
    master_mesh = master_obj.data
    for gid, grp_name in enumerate(group_names):
        me_g = master_mesh.copy()
        me_g.name = grp_name
        bm = bmesh.new()
        bm.from_mesh(me_g)
        gl = bm.faces.layers.int.get("_grp_id")
        if gl is not None:
            del_faces = [f for f in bm.faces if f[gl] != gid]
            if del_faces:
                bmesh.ops.delete(bm, geom=del_faces, context="FACES")
            unused_verts = [v for v in bm.verts if not v.link_faces]
            if unused_verts:
                bmesh.ops.delete(bm, geom=unused_verts, context="VERTS")
            bm.faces.layers.int.remove(gl)
        bm.to_mesh(me_g)
        bm.free()
        obj_g = link_obj(bpy.data.objects.new(grp_name, me_g))
        bpy.ops.object.select_all(action="DESELECT")
        obj_g.select_set(True)
        bpy.context.view_layer.objects.active = obj_g
        bpy.ops.object.material_slot_remove_unused()
        obj_g.select_set(False)

    bpy.data.objects.remove(master_obj, do_unlink=True)
    bpy.data.meshes.remove(master_mesh)

    for lobj in bake_lights:
        bpy.data.objects.remove(lobj, do_unlink=True)

    glb_path = OUT_DIR / "study-room.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_apply=True,
        export_lights=False,
        export_cameras=False,
    )
    print(f"[Export] Exported GLB -> {glb_path} ({os.path.getsize(glb_path) // 1024} KB)")

    # ================================================================
    # 11. 诊断性多机位 Cycles 预览图渲染（仅用于本轮模型自检，不写入 GLB）
    # ================================================================
    bg_node.inputs["Color"].default_value = (0.04, 0.03, 0.08, 1.0)
    bg_node.inputs["Strength"].default_value = 0.7
    sun_data = bpy.data.lights.new("DiagSun", type="SUN")
    sun_data.energy = 2.4
    sun_obj = bpy.data.objects.new("DiagSun", sun_data)
    sun_obj.rotation_euler = Euler((0.65, 0.2, 0.45), "XYZ")
    link_obj(sun_obj)

    cam_data = bpy.data.cameras.new("DiagCam")
    cam_data.lens = 34
    cam_obj = bpy.data.objects.new("DiagCam", cam_data)
    link_obj(cam_obj)
    scene.camera = cam_obj
    scene.cycles.samples = 14
    scene.render.resolution_x = 560
    scene.render.resolution_y = 380
    scene.render.image_settings.file_format = "PNG"

    shots = [
        ("preview_overview.png", (5.15, 3.05, 5.25), (-0.2, 0.95, -0.25)),
        ("preview_desk_mouse.png", (-1.52, 0.96, -2.55), (-1.82, 0.78, -2.87)),
        ("preview_desk_cake.png", (-1.12, 0.93, -2.42), (-1.22, 0.83, -2.78)),
        ("preview_plant.png", (2.00, 1.08, -1.90), (2.90, 0.56, -2.80)),
        ("preview_railing_scope.png", (4.55, 1.42, 4.45), (2.25, 0.72, 1.95)),
        ("preview_kitty.png", (-2.55, 0.46, -0.34), (-3.12, 0.34, -0.62)),
        ("preview_scroll.png", (-2.74, 2.04, -1.06), (-3.12, 1.94, -1.20)),
    ]
    for fname, pos, look in shots:
        vp = to_bl(*pos)
        vt = to_bl(*look)
        direction = (vt - vp).normalized()
        cam_obj.location = vp
        cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler("XYZ")
        scene.render.filepath = str(OUT_DIR / fname)
        bpy.ops.render.render(write_still=True)
        print(f"[Preview] Rendered -> {OUT_DIR / fname}")


if __name__ == "__main__":
    build_scene()
