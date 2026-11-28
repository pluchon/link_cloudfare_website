"""生日小屋（/birthday/）星空草坡野餐场景：Blender 5.3 无头建模 + Cycles 接触 AO 烘焙 + GLB 导出 + 诊断预览。

运行方式：
    "C:\\Program Files\\Blender Foundation\\Blender 5.3\\blender.exe" --background --python scripts/birthday-blender/build_birthday.py

坐标约定沿用书房脚本：函数参数一律写 Three.js 世界坐标（X 右、Y 上、Z 朝镜头），to_bl() 负责换算。
场景以矮桌中心为原点，默认机位在 +Z 一侧俯看桌面、仰望 -Z 方向天穹的银河。

产出（scripts/birthday-blender/out/，不入库）：
- birthday-scene.glb：静态烘焙组（Ground / Picnic / Table / Cake / Props）共享 UVMap_Bake；
  不烘焙的动态组（Grass / Flowers / Glow_* / Cake_Flame_*）只带基础材质，由 Three.js 实时打光与动画。
- birthday_ao.png：2048 接触 AO。
- preview_*.png：Cycles 诊断预览。
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "room-blender"))
import build_room as br  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent / "out"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# 蛋糕盘底中心（矮桌桌面之上）与缩放：s=1.75 时蛋糕盘直径约 0.41m
TABLE_TOP_Y = 0.315
CAKE_ORIGIN = (0.0, TABLE_TOP_Y, 0.02)
CAKE_SCALE = 1.75


ISLAND_R = 4.4
RIM_R = 4.75
TOP_SEGS = 128


def ground_h(x: float, z: float) -> float:
    """浮空岛岛面：r < 2.6m 的野餐平台保持水平，往外缓缓隆起又在岛缘圆润收边。"""
    r = math.hypot(x, z)
    flat = min(1.0, max(0.0, (r - 2.4) / 1.6))
    hump = 0.10 * math.sin(x * 0.75 + 0.7) * math.cos(z * 0.6 - 0.3) + 0.05 * math.sin(z * 1.4 + x * 0.5)
    lip = -0.55 * max(0.0, r - ISLAND_R + 0.35) ** 2
    return hump * flat + lip


def rock_noise(a: float, t: float) -> float:
    return (
        0.5 * math.sin(5.0 * a + 1.3) * math.cos(3.0 * t * math.pi + 0.4)
        + 0.3 * math.sin(11.0 * a + 7.0 * t)
        + 0.2 * math.sin(23.0 * a - 4.0 * t + 0.8)
    )


def add_island(name: str, grass: bpy.types.Material, soil: bpy.types.Material, rock: bpy.types.Material) -> bpy.types.Object:
    """浮空岛：岛面极坐标网格（草地）+ 岛缘一圈土层 + 向下收拢成钟乳尖的岩石底座，三段共用顶点无缝相接。"""
    segs = TOP_SEGS
    radii = []
    r = 0.25
    while r < RIM_R:
        radii.append(r)
        r += 0.25 if r < 3.0 else 0.18
    radii.append(RIM_R)

    bm = bmesh.new()
    center = bm.verts.new(br.to_bl(0.0, ground_h(0.0, 0.0), 0.0))
    rings: list[list[bmesh.types.BMVert]] = []
    ring_kind: list[int] = []
    for rr in radii:
        ring = []
        for i in range(segs):
            a = (i / segs) * math.tau
            wob = 1.0 + 0.035 * math.sin(7.0 * a + 0.6) if rr > ISLAND_R - 0.2 else 1.0
            x, z = math.cos(a) * rr * wob, math.sin(a) * rr * wob
            ring.append(bm.verts.new(br.to_bl(x, ground_h(x, z), z)))
        rings.append(ring)
        ring_kind.append(0)

    # 岛底：14 圈由岛缘向下收拢，半径按 (1-t)^0.8 缩小并叠岩面起伏与下垂的岩尖
    under = 16
    for k in range(1, under + 1):
        t = k / under
        ring = []
        for i in range(segs):
            a = (i / segs) * math.tau
            n = rock_noise(a, t)
            # 分层岩脊：按 t 做阶梯，让侧面出现一道道层理凸棱，而不是光滑的冰淇淋筒
            ledge = 0.06 * math.floor(t * 6.0 + 0.5 * math.sin(3.0 * a))
            rad = RIM_R * (1.0 - t) ** 0.78 * (1.0 + 0.22 * n + ledge * (1.0 - t)) * (1.0 + 0.035 * math.sin(7.0 * a + 0.6))
            drip = 0.7 * max(0.0, math.sin(6.0 * a + 2.0 * t + 0.3)) ** 3 * t + 0.35 * max(0.0, math.sin(13.0 * a + 1.1)) ** 6 * t
            y = -0.26 - 4.4 * t ** 1.1 - drip + 0.16 * n * (1.0 - t)
            x, z = math.cos(a) * rad, math.sin(a) * rad
            ring.append(bm.verts.new(br.to_bl(x, y, z)))
        rings.append(ring)
        ring_kind.append(1 if k <= 2 else 2)
    tip = bm.verts.new(br.to_bl(0.15, -5.4, -0.1))

    for i in range(segs):
        bm.faces.new((center, rings[0][(i + 1) % segs], rings[0][i]))
    for k in range(len(rings) - 1):
        a_r, b_r = rings[k], rings[k + 1]
        kind = ring_kind[k + 1]
        for i in range(segs):
            nx = (i + 1) % segs
            f = bm.faces.new((a_r[i], a_r[nx], b_r[nx], b_r[i]))
            f.material_index = kind
    for i in range(segs):
        f = bm.faces.new((rings[-1][i], rings[-1][(i + 1) % segs], tip))
        f.material_index = 2
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    br.set_smooth(me, True)
    # 岩石底座用平直着色出切面感，草面与土层保持平滑
    for poly in me.polygons:
        if poly.material_index == 2:
            poly.use_smooth = False
    me.materials.append(grass)
    me.materials.append(soil)
    me.materials.append(rock)
    return br.link_obj(bpy.data.objects.new(name, me))


def add_float_rock(name: str, center: tuple[float, float, float], size: float, seed: int, mat: bpy.types.Material) -> bpy.types.Object:
    """漂浮在岛周围的小碎岩：二次细分二十面体按噪声起伏，上面略平、下面拉尖。"""
    rng = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    ph = [rng.uniform(0.0, math.tau) for _ in range(3)]
    for v in bm.verts:
        p = v.co.copy()
        n = 0.18 * math.sin(3.1 * p.x + ph[0]) * math.sin(2.7 * p.y + ph[1]) + 0.12 * math.sin(4.3 * p.z + ph[2])
        stretch = 1.0 + (0.9 if p.z < 0 else -0.25) * abs(p.z)
        v.co = Vector((p.x * (1 + n), p.y * (1 + n), p.z * stretch * (1 + n))) * size
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    br.set_smooth(me, False)
    me.materials.append(mat)
    obj = br.link_obj(bpy.data.objects.new(name, me))
    obj.location = br.to_bl(*center)
    obj.rotation_euler = (rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(0, math.tau))
    return obj


def add_checker_blanket(
    name: str,
    center: tuple[float, float, float],
    size: tuple[float, float],
    cells: tuple[int, int],
    mat_a: bpy.types.Material,
    mat_b: bpy.types.Material,
    yaw: float,
) -> bpy.types.Object:
    """格纹野餐垫：每格独立材质槽交替，带轻微布料起伏与微翘的四边。"""
    sx, sz = size
    nx, nz = cells
    sub = 3
    gx, gz = nx * sub, nz * sub
    cy, sy = math.cos(yaw), math.sin(yaw)
    bm = bmesh.new()
    grid = []
    for j in range(gz + 1):
        row = []
        for i in range(gx + 1):
            u = i / gx - 0.5
            v = j / gz - 0.5
            lx, lz = u * sx, v * sz
            edge = max(abs(u), abs(v)) * 2.0
            ly = 0.012 + 0.006 * math.sin(lx * 7.0 + 0.4) * math.sin(lz * 6.0) + 0.018 * max(0.0, edge - 0.9) ** 2 * 10
            wx = center[0] + lx * cy + lz * sy
            wz = center[2] - lx * sy + lz * cy
            row.append(bm.verts.new(br.to_bl(wx, center[1] + ly, wz)))
        grid.append(row)
    for j in range(gz):
        for i in range(gx):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            f.material_index = ((i // sub) + (j // sub)) % 2
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    br.set_smooth(me, True)
    me.materials.append(mat_a)
    me.materials.append(mat_b)
    obj = br.link_obj(bpy.data.objects.new(name, me))
    sol = obj.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = 0.008
    sol.offset = -1.0
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=sol.name)
    obj.select_set(False)
    return obj


def add_gift(
    prefix: str,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    yaw: float,
    box_mat: bpy.types.Material,
    ribbon_mat: bpy.types.Material,
) -> list[bpy.types.Object]:
    """礼物盒：盒身 + 略宽的盒盖 + 十字缎带 + 双环蝴蝶结。center 为盒底中心。"""
    w, h, d = size
    out = []
    out.append(br.add_box(f"{prefix}_Box", (center[0], center[1] + h * 0.46, center[2]), (w, h * 0.92, d), box_mat, bevel=0.006, bevel_segs=2, rot_y=yaw))
    out.append(br.add_box(f"{prefix}_Lid", (center[0], center[1] + h * 0.94, center[2]), (w * 1.05, h * 0.14, d * 1.05), box_mat, bevel=0.006, bevel_segs=2, rot_y=yaw))
    rb = min(w, d) * 0.16
    out.append(br.add_box(f"{prefix}_RibbonA", (center[0], center[1] + h * 0.5, center[2]), (w * 1.07, h * 1.03, rb), ribbon_mat, bevel=0.002, rot_y=yaw))
    out.append(br.add_box(f"{prefix}_RibbonB", (center[0], center[1] + h * 0.5, center[2]), (rb, h * 1.03, d * 1.07), ribbon_mat, bevel=0.002, rot_y=yaw))
    top = center[1] + h * 1.02
    loop_r = min(w, d) * 0.17
    for side in (-1, 1):
        a = yaw + side * 0.0
        ox = math.cos(a) * loop_r * 0.9 * side
        oz = -math.sin(a) * loop_r * 0.9 * side
        out.append(br.add_torus(
            f"{prefix}_Bow_{side}",
            (center[0] + ox, top + loop_r * 0.55, center[2] + oz),
            loop_r,
            loop_r * 0.28,
            ribbon_mat,
            major_segs=20,
            minor_segs=8,
            rot_euler=(math.pi * 0.5, side * 0.5, yaw),
            scale=(1.0, 1.0, 0.62),
        ))
    out.append(br.add_sphere(f"{prefix}_Knot", (center[0], top + loop_r * 0.25, center[2]), loop_r * 0.42, ribbon_mat, segs=12, rings=8))
    return out


def build() -> None:
    br.clear_scene()

    mats = {
        "grass_ground": br.make_mat("Mat_BD_Ground", (0.030, 0.058, 0.060), roughness=0.95),
        "soil": br.make_mat("Mat_BD_Soil", (0.090, 0.058, 0.050), roughness=0.95),
        "rock": br.make_mat("Mat_BD_Rock", (0.110, 0.095, 0.140), roughness=0.9),
        "blanket_a": br.make_mat("Mat_BD_BlanketCream", (0.86, 0.76, 0.58), roughness=0.9),
        "blanket_b": br.make_mat("Mat_BD_BlanketSage", (0.30, 0.45, 0.36), roughness=0.9),
        "wood": br.make_mat("Mat_BD_Wood", (0.50, 0.31, 0.18), roughness=0.5),
        "wood_dark": br.make_mat("Mat_BD_WoodDark", (0.22, 0.13, 0.08), roughness=0.55),
        "ceramic": br.make_mat("Mat_BD_Ceramic", (0.92, 0.89, 0.82), roughness=0.22),
        "tea": br.make_mat("Mat_BD_Tea", (0.42, 0.17, 0.05), roughness=0.08),
        "navy": br.make_mat("Mat_BD_GiftNavy", (0.040, 0.058, 0.190), roughness=0.55),
        "coral": br.make_mat("Mat_BD_GiftCoral", (0.760, 0.230, 0.090), roughness=0.55),
        "mint": br.make_mat("Mat_BD_GiftMint", (0.190, 0.440, 0.240), roughness=0.55),
        "cream": br.make_mat("Mat_BD_GiftCream", (0.900, 0.780, 0.580), roughness=0.5),
        "lilac": br.make_mat("Mat_BD_GiftLilac", (0.52, 0.42, 0.78), roughness=0.5),
        "pink": br.make_mat("Mat_BD_Pink", (0.95, 0.55, 0.66), roughness=0.45),
        "brass": br.make_mat("Mat_BD_Brass", (0.82, 0.66, 0.34), roughness=0.28, metallic=0.85),
        "steel": br.make_mat("Mat_BD_Steel", (0.12, 0.13, 0.16), roughness=0.4, metallic=0.6),
        "glass": br.make_mat("Mat_BD_Glass", (0.82, 0.90, 0.96), roughness=0.05, alpha=0.22),
        "book_a": br.make_mat("Mat_BD_BookA", (0.17, 0.25, 0.52), roughness=0.6),
        "book_b": br.make_mat("Mat_BD_BookB", (0.80, 0.45, 0.28), roughness=0.6),
        "paper": br.make_mat("Mat_BD_Paper", (0.93, 0.90, 0.82), roughness=0.85),
        "wire": br.make_mat("Mat_BD_Wire", (0.05, 0.05, 0.06), roughness=0.6),
        "petal_a": br.make_mat("Mat_BD_PetalWhite", (0.86, 0.84, 0.92), roughness=0.6),
        "petal_b": br.make_mat("Mat_BD_PetalLilac", (0.62, 0.52, 0.86), roughness=0.6),
        "petal_core": br.make_mat("Mat_BD_PetalCore", (0.95, 0.72, 0.30), roughness=0.6),
        "bulb": br.make_mat("Mat_BD_BulbGlow", (1.0, 0.82, 0.55), roughness=0.3, emission=(1.0, 0.74, 0.42), emission_strength=4.0),
        "bulb_pink": br.make_mat("Mat_BD_BulbPink", (1.0, 0.78, 0.84), roughness=0.3, emission=(1.0, 0.62, 0.72), emission_strength=3.6),
        "flag_cream": br.make_mat("Mat_BD_FlagCream", (0.90, 0.80, 0.62), roughness=0.85),
        "flag_sage": br.make_mat("Mat_BD_FlagSage", (0.26, 0.48, 0.32), roughness=0.85),
        "flag_coral": br.make_mat("Mat_BD_FlagCoral", (0.80, 0.28, 0.14), roughness=0.85),
        "flag_navy": br.make_mat("Mat_BD_FlagNavy", (0.06, 0.09, 0.28), roughness=0.85),
        "flag_lilac": br.make_mat("Mat_BD_FlagLilac", (0.52, 0.42, 0.78), roughness=0.85),
        "flag_pink": br.make_mat("Mat_BD_FlagPink", (0.95, 0.55, 0.66), roughness=0.85),
        "jar_glow": br.make_mat("Mat_BD_JarGlow", (1.0, 0.85, 0.6), roughness=0.3, emission=(1.0, 0.78, 0.48), emission_strength=3.0),
    }
    for key in ("petal_a", "petal_b", "glass", "flag_cream", "flag_sage", "flag_coral", "flag_navy", "flag_lilac", "flag_pink"):
        mats[key].use_backface_culling = False

    static_groups: dict[str, list[bpy.types.Object]] = {}
    dynamic: dict[str, list[bpy.types.Object]] = {}

    def S(group: str, obj: bpy.types.Object, prio: int = 2) -> bpy.types.Object:
        br.mark_uv_prio(obj, prio)
        static_groups.setdefault(group, []).append(obj)
        return obj

    def D(group: str, obj: bpy.types.Object) -> bpy.types.Object:
        dynamic.setdefault(group, []).append(obj)
        return obj

    # ---------------- 地形与远山 ----------------
    S("Ground", add_island("Island", mats["grass_ground"], mats["soil"], mats["rock"]), prio=0)
    rng_rock = random.Random(911)
    for k in range(11):
        a = k / 11 * math.tau + rng_rock.uniform(-0.2, 0.2)
        rr = rng_rock.uniform(6.2, 11.0)
        D("Float_Rocks", add_float_rock(
            f"Float_Rock_{k}",
            (math.cos(a) * rr, rng_rock.uniform(-3.2, 1.6), math.sin(a) * rr),
            rng_rock.uniform(0.18, 0.65),
            300 + k,
            mats["rock"],
        ))

    # ---------------- 野餐垫 ----------------
    S("Picnic", add_checker_blanket("Blanket", (0.05, 0.0, 0.10), (2.5, 1.85), (8, 6), mats["blanket_a"], mats["blanket_b"], yaw=0.07))

    # ---------------- 矮圆桌 ----------------
    S("Table", br.add_cylinder("Table_Top", (0.0, TABLE_TOP_Y - 0.018, 0.0), 0.44, 0.44, 0.036, mats["wood"], segs=64, bevel_caps=0.008))
    S("Table", br.add_torus("Table_Rim", (0.0, TABLE_TOP_Y - 0.004, 0.0), 0.437, 0.006, mats["wood_dark"], major_segs=64, minor_segs=6))
    for k in range(3):
        a = (k / 3) * math.tau + 0.5
        top = (math.cos(a) * 0.27, TABLE_TOP_Y - 0.03, math.sin(a) * 0.27)
        foot = (math.cos(a) * 0.36, 0.02, math.sin(a) * 0.36)
        S("Table", br.add_cylinder_between(f"Table_Leg_{k}", foot, top, 0.022, 0.03, mats["wood_dark"], segs=14))
        S("Table", br.add_sphere(f"Table_Foot_{k}", foot, 0.028, mats["brass"], scale=(1.0, 0.6, 1.0), segs=12, rings=6))
    S("Table", br.add_torus("Table_Brace", (0.0, 0.13, 0.0), 0.31, 0.008, mats["brass"], major_segs=48, minor_segs=6))

    # ---------------- 蛋糕（Cake 组：Three.js 端按名称拾取） ----------------
    flames: list[tuple[float, float, float]] = br.add_birthday_cake(
        CAKE_ORIGIN,
        CAKE_SCALE,
        lambda o: S("Cake", o),
        lambda o: D("Cake_Flames", o),
        prefix="Cake",
    )

    # ---------------- 热茶：茶壶 + 两只茶杯 + 两只甜点碟（呼应「喜欢热茶」） ----------------
    tp = (-0.27, TABLE_TOP_Y, -0.10)
    S("Table", br.add_lathe("Teapot_Body", tp, [
        (0.0, 0.0), (0.050, 0.0), (0.072, 0.025), (0.080, 0.060), (0.070, 0.098), (0.048, 0.118), (0.040, 0.122), (0.0, 0.122),
    ], mats["ceramic"], segs=36))
    S("Table", br.add_lathe("Teapot_Lid", (tp[0], tp[1] + 0.118, tp[2]), [
        (0.0, 0.032), (0.010, 0.030), (0.012, 0.022), (0.040, 0.012), (0.046, 0.0), (0.0, 0.0),
    ], mats["ceramic"], segs=28))
    S("Table", br.add_sphere("Teapot_Knob", (tp[0], tp[1] + 0.153, tp[2]), 0.011, mats["pink"], segs=12, rings=8))
    S("Table", br.add_tube("Teapot_Spout", [
        (tp[0] + 0.070, tp[1] + 0.045, tp[2]), (tp[0] + 0.105, tp[1] + 0.070, tp[2]), (tp[0] + 0.125, tp[1] + 0.105, tp[2]),
    ], 0.012, mats["ceramic"], bevel_res=3, taper_end=0.55))
    S("Table", br.add_tube("Teapot_Handle", [
        (tp[0] - 0.066, tp[1] + 0.090, tp[2]), (tp[0] - 0.110, tp[1] + 0.085, tp[2]), (tp[0] - 0.112, tp[1] + 0.045, tp[2]), (tp[0] - 0.070, tp[1] + 0.030, tp[2]),
    ], 0.008, mats["ceramic"], bevel_res=3))
    S("Table", br.add_torus("Teapot_Band", (tp[0], tp[1] + 0.062, tp[2]), 0.0795, 0.0035, mats["pink"], major_segs=40, minor_segs=6))
    for idx, cp in enumerate(((0.24, TABLE_TOP_Y, 0.20), (-0.20, TABLE_TOP_Y, 0.25))):
        S("Table", br.add_cylinder(f"Saucer_{idx}", (cp[0], cp[1] + 0.004, cp[2]), 0.058, 0.050, 0.008, mats["ceramic"], segs=32, bevel_caps=0.002))
        S("Table", br.add_lathe(f"Cup_{idx}", (cp[0], cp[1] + 0.008, cp[2]), [
            (0.0, 0.0), (0.024, 0.0), (0.036, 0.020), (0.042, 0.050), (0.040, 0.052), (0.035, 0.024), (0.022, 0.006), (0.0, 0.006),
        ], mats["ceramic"], segs=28))
        S("Table", br.add_cylinder(f"Cup_Tea_{idx}", (cp[0], cp[1] + 0.046, cp[2]), 0.037, 0.037, 0.003, mats["tea"], segs=24))
        S("Table", br.add_tube(f"Cup_Handle_{idx}", [
            (cp[0] + 0.040, cp[1] + 0.046, cp[2]), (cp[0] + 0.060, cp[1] + 0.040, cp[2]), (cp[0] + 0.058, cp[1] + 0.022, cp[2]), (cp[0] + 0.036, cp[1] + 0.020, cp[2]),
        ], 0.0045, mats["ceramic"], bevel_res=2))
    for idx, pp in enumerate(((0.30, TABLE_TOP_Y, -0.12), (0.05, TABLE_TOP_Y, 0.33))):
        S("Table", br.add_cylinder(f"Plate_{idx}", (pp[0], pp[1] + 0.005, pp[2]), 0.068, 0.058, 0.009, mats["ceramic"], segs=36, bevel_caps=0.002))
        S("Table", br.add_cylinder_between(f"Fork_{idx}", (pp[0] - 0.05, pp[1] + 0.012, pp[2] + 0.03), (pp[0] + 0.045, pp[1] + 0.012, pp[2] - 0.02), 0.0028, 0.0028, mats["brass"], segs=6))

    # ---------------- 礼物盒、书本 ----------------
    for obj in add_gift("GiftA", (-0.78, 0.02, 0.42), (0.26, 0.20, 0.22), 0.35, mats["navy"], mats["cream"]):
        S("Props", obj)
    for obj in add_gift("GiftB", (-0.55, 0.02, 0.66), (0.17, 0.14, 0.17), -0.4, mats["coral"], mats["cream"]):
        S("Props", obj)
    for obj in add_gift("GiftC", (-0.98, 0.02, 0.10), (0.14, 0.24, 0.14), 0.15, mats["mint"], mats["pink"]):
        S("Props", obj)
    for obj in add_gift("GiftD", (0.62, 0.02, -0.52), (0.16, 0.12, 0.16), 0.6, mats["lilac"], mats["cream"]):
        S("Props", obj)
    S("Props", br.add_box("Book_A", (0.98, 0.04, -0.20), (0.30, 0.04, 0.22), mats["book_a"], bevel=0.004, rot_y=0.4))
    S("Props", br.add_box("Book_A_Pages", (0.985, 0.04, -0.20), (0.29, 0.032, 0.205), mats["paper"], bevel=0.002, rot_y=0.4))
    S("Props", br.add_box("Book_B", (0.97, 0.075, -0.19), (0.24, 0.032, 0.17), mats["book_b"], bevel=0.004, rot_y=0.1))
    S("Props", br.add_box("Book_B_Pages", (0.975, 0.075, -0.19), (0.23, 0.025, 0.16), mats["paper"], bevel=0.002, rot_y=0.1))

    # ---------------- 玻璃罐小夜灯 ×3 ----------------
    jar_spots = [(-1.08, 0.02, -0.60), (1.10, 0.02, 0.55), (0.25, 0.02, -0.80)]
    for idx, jp in enumerate(jar_spots):
        S("Props", br.add_lathe(f"Jar_Glass_{idx}", jp, [
            (0.0, 0.0), (0.050, 0.0), (0.056, 0.012), (0.056, 0.120), (0.044, 0.140), (0.040, 0.150), (0.0, 0.150),
        ], mats["glass"], segs=28), prio=1)
        S("Props", br.add_cylinder(f"Jar_Lid_{idx}", (jp[0], jp[1] + 0.155, jp[2]), 0.043, 0.043, 0.014, mats["brass"], segs=24, bevel_caps=0.002))
        S("Props", br.add_tube(f"Jar_Handle_{idx}", [
            (jp[0] - 0.043, jp[1] + 0.155, jp[2]), (jp[0] - 0.03, jp[1] + 0.21, jp[2]), (jp[0] + 0.03, jp[1] + 0.21, jp[2]), (jp[0] + 0.043, jp[1] + 0.155, jp[2]),
        ], 0.0022, mats["wire"], bevel_res=1))
        rng = random.Random(77 + idx)
        for k in range(7):
            gp = (jp[0] + rng.uniform(-0.03, 0.03), jp[1] + rng.uniform(0.03, 0.12), jp[2] + rng.uniform(-0.03, 0.03))
            D("Glow_Jars", br.add_sphere(f"Jar_Spark_{idx}_{k}", gp, rng.uniform(0.006, 0.011), mats["jar_glow"], segs=8, rings=5))

    # ---------------- 串灯：三根木杆 + 两段梨形灯泡串 + 一段生日三角旗 ----------------
    posts = [(-2.05, -1.35), (2.15, -1.65), (2.4, 1.5)]
    tops: list[Vector] = []
    for idx, (px, pz) in enumerate(posts):
        gy = ground_h(px, pz)
        pb = (px, gy, pz)
        S("Props", br.add_cylinder_between(f"Post_{idx}", pb, (px, gy + 2.22, pz), 0.036, 0.026, mats["wood_dark"], segs=14), prio=1)
        S("Props", br.add_cylinder(f"Post_Foot_{idx}", (px, gy + 0.05, pz), 0.05, 0.056, 0.1, mats["brass"], segs=16, bevel_caps=0.006), prio=1)
        for cy_ in (1.92, 2.12):
            S("Props", br.add_torus(f"Post_Collar_{idx}_{cy_:.2f}", (px, gy + cy_, pz), 0.031, 0.007, mats["brass"], major_segs=18, minor_segs=6), prio=1)
        S("Props", br.add_sphere(f"Post_Cap_{idx}", (px, gy + 2.25, pz), 0.04, mats["brass"], segs=14, rings=8), prio=1)
        S("Props", br.add_cylinder_between(f"Post_Finial_{idx}", (px, gy + 2.28, pz), (px, gy + 2.36, pz), 0.016, 0.001, mats["brass"], segs=10), prio=1)
        tops.append(Vector((px, gy + 2.14, pz)))

    def catenary(a: Vector, b: Vector, sag: float, bow: float, n: int) -> list[Vector]:
        pts_: list[Vector] = []
        for i in range(n + 1):
            t = i / n
            p = a.lerp(b, t)
            p.y -= sag * 4.0 * t * (1.0 - t)
            side = Vector((-(b.z - a.z), 0.0, b.x - a.x)).normalized()
            p += side * bow * math.sin(t * math.pi)
            pts_.append(p)
        return pts_

    def bulb_strand(name: str, a: Vector, b: Vector, sag: float, bow: float, count: int, seed: int) -> None:
        line = catenary(a, b, sag, bow, 40)
        D("Wire", br.add_tube(f"{name}_Wire", [tuple(p) for p in line], 0.0045, mats["wire"], bevel_res=1))
        rng_b = random.Random(seed)
        dense = catenary(a, b, sag, bow, 1000)
        for i in range(1, count + 1):
            t = i / (count + 1)
            p = dense[int(t * 1000)]
            drop = 0.035 + 0.02 * rng_b.random()
            sock_top = (p.x, p.y, p.z)
            sock_bot = (p.x, p.y - drop, p.z)
            D("Wire", br.add_cylinder_between(f"{name}_Cord_{i}", sock_top, (p.x, p.y - drop + 0.004, p.z), 0.0025, 0.0025, mats["wire"], segs=5))
            D("Sockets", br.add_cylinder_between(f"{name}_Socket_{i}", (p.x, p.y - drop + 0.006, p.z), (p.x, p.y - drop - 0.022, p.z), 0.0105, 0.0125, mats["brass"], segs=10))
            glow = mats["bulb_pink"] if i % 4 == 2 else mats["bulb"]
            D("Glow_Bulbs", br.add_lathe(f"{name}_Bulb_{i}", (sock_bot[0], sock_bot[1] - 0.022, sock_bot[2]), [
                (0.0, 0.0), (0.009, -0.002), (0.019, -0.016), (0.024, -0.036), (0.021, -0.056), (0.011, -0.069), (0.0, -0.072),
            ], glow, segs=14))

    bulb_strand("StrandA", tops[0], tops[1], 0.58, 0.32, 15, 41)
    bulb_strand("StrandB", tops[1], tops[2], 0.42, -0.18, 9, 42)

    # 生日三角旗：挂在第一段灯串下方，奶油 / 鼠尾草 / 珊瑚 / 靛蓝 / 淡紫 / 樱粉轮换
    flag_mats = [mats["flag_cream"], mats["flag_sage"], mats["flag_coral"], mats["flag_navy"], mats["flag_lilac"], mats["flag_pink"]]
    flag_bm = [bmesh.new() for _ in flag_mats]
    fa = tops[0] + Vector((0.0, -0.16, 0.0))
    fb = tops[1] + Vector((0.0, -0.16, 0.0))
    flag_line = catenary(fa, fb, 0.72, 0.2, 1200)
    D("Wire", br.add_tube("Bunting_Cord", [tuple(p) for p in flag_line[::30]], 0.0035, mats["wire"], bevel_res=1))
    flags = 17
    rng_f = random.Random(77)
    for i in range(flags):
        t0 = (i + 0.18) / flags
        t1 = (i + 0.82) / flags
        p0 = flag_line[int(t0 * 1200)]
        p1 = flag_line[int(t1 * 1200)]
        mid = (p0 + p1) * 0.5
        tip = mid + Vector((rng_f.uniform(-0.01, 0.01), -0.19, rng_f.uniform(0.015, 0.04)))
        bm = flag_bm[i % len(flag_mats)]
        v0 = bm.verts.new(br.to_bl(*p0))
        v1 = bm.verts.new(br.to_bl(*p1))
        v2 = bm.verts.new(br.to_bl(*tip))
        bm.faces.new((v0, v1, v2))
    for k, (bm, mat) in enumerate(zip(flag_bm, flag_mats)):
        me = bpy.data.meshes.new(f"Bunting_{k}")
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        D("Bunting", br.link_obj(bpy.data.objects.new(f"Bunting_{k}", me)))

    # ---------------- 望远镜（右后方，指向银河） ----------------
    sp = (1.85, ground_h(1.85, -0.95), -0.95)
    head = Vector((sp[0], sp[1] + 1.05, sp[2]))
    for k in range(3):
        a = (k / 3) * math.tau + 0.3
        foot = (sp[0] + math.cos(a) * 0.38, ground_h(sp[0] + math.cos(a) * 0.38, sp[2] + math.sin(a) * 0.38), sp[2] + math.sin(a) * 0.38)
        S("Props", br.add_cylinder_between(f"Scope_Leg_{k}", foot, (head.x, head.y, head.z), 0.012, 0.016, mats["wood_dark"], segs=8), prio=1)
    # 望远镜对准银河那头的紫粉黑洞（与 Three.js 端黑洞方向一致）
    aim = Vector((-0.25, 0.16, -0.96)).normalized()
    tube_a = head - aim * 0.36
    tube_b = head + aim * 0.46
    S("Props", br.add_cylinder_between("Scope_Tube", tuple(tube_a), tuple(tube_b), 0.045, 0.055, mats["navy"], segs=24))
    S("Props", br.add_cylinder_between("Scope_Ring_A", tuple(tube_b - aim * 0.02), tuple(tube_b + aim * 0.02), 0.06, 0.06, mats["brass"], segs=24))
    S("Props", br.add_cylinder_between("Scope_Ring_B", tuple(head - aim * 0.05), tuple(head + aim * 0.05), 0.052, 0.052, mats["brass"], segs=24))
    S("Props", br.add_cylinder_between("Scope_Eyepiece", tuple(tube_a), tuple(tube_a - aim * 0.09), 0.018, 0.022, mats["brass"], segs=12))

    # ---------------- 草丛与小花（不烘焙，实时打光） ----------------
    rng = random.Random(20261128)
    cy, sy = math.cos(0.07), math.sin(0.07)

    def on_blanket(x: float, z: float) -> bool:
        lx = (x - 0.05) * cy - (z - 0.10) * sy
        lz = (x - 0.05) * sy + (z - 0.10) * cy
        return abs(lx) < 1.33 and abs(lz) < 1.0

    # 草叶改由 Three.js 运行期 InstancedMesh 生成（按设备分档数量），不再写进 GLB

    petals_bm = {"petal_a": bmesh.new(), "petal_b": bmesh.new(), "petal_core": bmesh.new()}
    flowers = 0
    while flowers < 140:
        rr = 1.4 + rng.random() * (ISLAND_R - 1.8)
        a = rng.uniform(0.0, math.tau)
        x, z = math.cos(a) * rr, math.sin(a) * rr
        if on_blanket(x, z):
            continue
        y = ground_h(x, z) + rng.uniform(0.06, 0.13)
        key = "petal_a" if rng.random() < 0.6 else "petal_b"
        bm = petals_bm[key]
        pr = rng.uniform(0.012, 0.02)
        rot = rng.uniform(0.0, math.tau)
        c = bm.verts.new(br.to_bl(x, y + 0.002, z))
        ring = []
        for k in range(10):
            ang = rot + k / 10 * math.tau
            rad = pr * (1.0 if k % 2 == 0 else 0.45)
            ring.append(bm.verts.new(br.to_bl(x + math.cos(ang) * rad, y, z + math.sin(ang) * rad)))
        for k in range(10):
            bm.faces.new((c, ring[k], ring[(k + 1) % 10]))
        cb = petals_bm["petal_core"]
        cc = cb.verts.new(br.to_bl(x, y + 0.004, z))
        cr = [cb.verts.new(br.to_bl(x + math.cos(k / 6 * math.tau) * pr * 0.3, y + 0.003, z + math.sin(k / 6 * math.tau) * pr * 0.3)) for k in range(6)]
        for k in range(6):
            cb.faces.new((cc, cr[k], cr[(k + 1) % 6]))
        flowers += 1
    for key, bm in petals_bm.items():
        me = bpy.data.meshes.new(f"Flowers_{key}")
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mats[key])
        D("Flowers", br.link_obj(bpy.data.objects.new(f"Flowers_{key}", me)))

    bake_and_export(static_groups, dynamic, flames)


def join_group(name: str, objs: list[bpy.types.Object]) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    obj.select_set(False)
    return obj


def bake_and_export(
    static_groups: dict[str, list[bpy.types.Object]],
    dynamic: dict[str, list[bpy.types.Object]],
    flames: list[tuple[float, float, float]],
) -> None:
    # ---- 静态组：应用变换 + 写组号 / UV 优先级 -> 合并主网格 -> 统一 UVMap_Bake -> AO 烘焙 -> 拆回各组 ----
    group_names = [k for k, v in static_groups.items() if v]
    all_static: list[bpy.types.Object] = []
    for gid, grp in enumerate(group_names):
        for obj in static_groups[grp]:
            prio = int(obj.get("_uv_prio", 1))
            bpy.ops.object.select_all(action="DESELECT")
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            obj.select_set(False)
            br.apply_box_uv(obj, scale=0.55)
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            gl = bm.faces.layers.int.new("_grp_id")
            pl = bm.faces.layers.int.new("_uv_prio")
            for f in bm.faces:
                f[gl] = gid
                f[pl] = prio
            bm.to_mesh(obj.data)
            bm.free()
            all_static.append(obj)

    master = join_group("Temp_Bake_Master", all_static)
    bake_uv = master.data.uv_layers.new(name="UVMap_Bake")
    master.data.uv_layers.active = bake_uv
    bpy.context.view_layer.objects.active = master
    master.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.003, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")

    # 按 UV 孤岛整体缩放：地形压缩到很小、主角道具放大，再统一打包
    bm = bmesh.new()
    bm.from_mesh(master.data)
    uv_lay = bm.loops.layers.uv.get("UVMap_Bake")
    pl = bm.faces.layers.int.get("_uv_prio")
    islands = bmesh_uv_islands(bm, uv_lay)
    for island in islands:
        max_p = max(f[pl] for f in island)
        s = 0.35 if max_p == 0 else (1.55 if max_p == 2 else 1.0)
        if s == 1.0:
            continue
        loops = [l for f in island for l in f.loops]
        cx = sum(l[uv_lay].uv.x for l in loops) / len(loops)
        cy = sum(l[uv_lay].uv.y for l in loops) / len(loops)
        for l in loops:
            l[uv_lay].uv.x = cx + (l[uv_lay].uv.x - cx) * s
            l[uv_lay].uv.y = cy + (l[uv_lay].uv.y - cy) * s
    bm.faces.layers.int.remove(pl)
    bm.to_mesh(master.data)
    bm.free()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(margin=0.004, scale=True, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.render.bake.margin = 12
    scene.view_settings.view_transform = "Standard"

    world = bpy.data.worlds.new("BakeWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs["Strength"].default_value = 1.0

    mats_seen = []
    for m in master.data.materials:
        if m and m.use_nodes and m not in mats_seen:
            mats_seen.append(m)
    img = bpy.data.images.new("BD_AO", width=2048, height=2048, alpha=False)
    temp: list[tuple[bpy.types.NodeTree, bpy.types.NodeSocket, bpy.types.NodeSocket | None, list[bpy.types.Node]]] = []
    for m in mats_seen:
        nt = m.node_tree
        out_node = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if out_node is None:
            continue
        surf = out_node.inputs["Surface"]
        orig = surf.links[0].from_socket if surf.links else None
        ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
        ao.samples = 16
        ao.inputs["Distance"].default_value = 0.45
        gamma = nt.nodes.new("ShaderNodeGamma")
        gamma.inputs["Gamma"].default_value = 1.15
        emit = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(ao.outputs["AO"], gamma.inputs["Color"])
        nt.links.new(gamma.outputs["Color"], emit.inputs["Color"])
        nt.links.new(emit.outputs["Emission"], surf)
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.nodes.active = tex
        temp.append((nt, surf, orig, [ao, gamma, emit, tex]))
    bpy.ops.object.select_all(action="DESELECT")
    master.select_set(True)
    bpy.context.view_layer.objects.active = master
    # 动态物体（草、灯泡、远山）不参与遮蔽计算以外的任何事；它们仍在场景里，会给地面投下合理的接触 AO
    bpy.ops.object.bake(type="EMIT")
    ao_png = OUT_DIR / "birthday_ao.png"
    img.filepath_raw = str(ao_png)
    img.file_format = "PNG"
    img.save()
    for nt, surf, orig, nodes in temp:
        for lnk in list(surf.links):
            nt.links.remove(lnk)
        if orig is not None:
            nt.links.new(orig, surf)
        for n in nodes:
            nt.nodes.remove(n)
    print(f"[Cycles] Baked 2048 AO -> {ao_png}")

    master.data.uv_layers.active = master.data.uv_layers["UVMap"]
    master_mesh = master.data
    for gid, grp in enumerate(group_names):
        me_g = master_mesh.copy()
        me_g.name = grp
        bm = bmesh.new()
        bm.from_mesh(me_g)
        gl = bm.faces.layers.int.get("_grp_id")
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[gl] != gid], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.faces.layers.int.remove(gl)
        bm.to_mesh(me_g)
        bm.free()
        obj_g = br.link_obj(bpy.data.objects.new(grp, me_g))
        bpy.ops.object.select_all(action="DESELECT")
        obj_g.select_set(True)
        bpy.context.view_layer.objects.active = obj_g
        bpy.ops.object.material_slot_remove_unused()
        obj_g.select_set(False)
    bpy.data.objects.remove(master, do_unlink=True)
    bpy.data.meshes.remove(master_mesh)

    # 动态组按组合并，减少 draw call；火苗保持独立以便逐根熄灭
    for grp, objs in dynamic.items():
        if grp == "Cake_Flames":
            continue
        objs = [o for o in objs if o.name in bpy.data.objects]
        for o in objs:
            bpy.ops.object.select_all(action="DESELECT")
            bpy.context.view_layer.objects.active = o
            o.select_set(True)
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            o.select_set(False)
        join_group(grp, objs)

    glb = OUT_DIR / "birthday-scene.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(glb),
        export_format="GLB",
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_apply=True,
        export_lights=False,
        export_cameras=False,
    )
    print(f"[Export] GLB -> {glb} ({glb.stat().st_size // 1024} KB)")
    print(f"[Flames] {flames}")

    # ---- 诊断预览 ----
    bg.inputs["Color"].default_value = (0.05, 0.06, 0.14, 1.0)
    bg.inputs["Strength"].default_value = 0.9
    moon = bpy.data.lights.new("Moon", type="SUN")
    moon.energy = 1.6
    moon.color = (0.75, 0.8, 1.0)
    mo = br.link_obj(bpy.data.objects.new("Moon", moon))
    mo.rotation_euler = (0.9, 0.3, 2.4)
    for i, fp in enumerate(flames):
        pl_ = bpy.data.lights.new(f"Flame{i}", type="POINT")
        pl_.energy = 6.0
        pl_.color = (1.0, 0.7, 0.4)
        po = br.link_obj(bpy.data.objects.new(f"Flame{i}", pl_))
        po.location = br.to_bl(*fp)
    cam_d = bpy.data.cameras.new("Cam")
    cam_d.lens = 30
    cam = br.link_obj(bpy.data.objects.new("Cam", cam_d))
    scene.camera = cam
    scene.cycles.samples = 24
    scene.render.resolution_x = 960
    scene.render.resolution_y = 600
    scene.render.image_settings.file_format = "PNG"
    for fname, pos, look in (
        ("preview_main.png", (0.15, 1.05, 2.35), (0.0, 0.45, 0.0)),
        ("preview_table.png", (0.55, 0.75, 1.05), (0.0, 0.42, 0.0)),
        ("preview_wide.png", (7.5, 3.2, 11.0), (0.0, -1.2, 0.0)),
        ("preview_under.png", (6.5, -5.0, 8.0), (0.0, -1.8, 0.0)),
    ):
        vp = br.to_bl(*pos)
        vt = br.to_bl(*look)
        cam.location = vp
        cam.rotation_euler = (vt - vp).normalized().to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(OUT_DIR / fname)
        bpy.ops.render.render(write_still=True)
        print(f"[Preview] {fname}")


def bmesh_uv_islands(bm: bmesh.types.BMesh, uv_lay: bmesh.types.BMLayerItem) -> list[list[bmesh.types.BMFace]]:
    """按共享 UV 的边连通性划分孤岛（与书房脚本一致，避免按单面缩放撕裂曲面）。"""
    bm.faces.ensure_lookup_table()
    visited = [False] * len(bm.faces)
    islands = []
    for seed in bm.faces:
        if visited[seed.index]:
            continue
        island = []
        stack = [seed]
        visited[seed.index] = True
        while stack:
            cf = stack.pop()
            island.append(cf)
            for edge in cf.edges:
                if len(edge.link_faces) < 2:
                    continue
                c_uvs = {l.vert: l[uv_lay].uv for l in cf.loops if l.vert in edge.verts}
                for nf in edge.link_faces:
                    if visited[nf.index]:
                        continue
                    n_uvs = {l.vert: l[uv_lay].uv for l in nf.loops if l.vert in edge.verts}
                    if len(c_uvs) == 2 and len(n_uvs) == 2 and all((c_uvs[v] - n_uvs[v]).length_squared < 1e-8 for v in edge.verts):
                        visited[nf.index] = True
                        stack.append(nf)
        islands.append(island)
    return islands


if __name__ == "__main__":
    build()
