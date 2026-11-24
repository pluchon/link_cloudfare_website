import * as THREE from 'three';
import type { RoomGalleryItem, RoomPayload, RoomThemeConfig } from './types';

// 严格遵守 AGENTS.md：不加载 Web 字体，仅使用系统字体栈
const FONT_SANS = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';
const FONT_SERIF = '"Songti SC", "STSong", "Noto Serif SC", Georgia, serif';
const FONT_MONO = 'ui-monospace, "Cascadia Mono", SFMono-Regular, Consolas, monospace';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)}, ${Math.round(g1 + (g2 - g1) * t)}, ${Math.round(b1 + (b2 - b1) * t)})`;
}

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function configureColorTex(tex: THREE.CanvasTexture, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  // glTF 2.0 导出的 UV 坐标系以左上角为原点，动态 CanvasTexture 须关闭 flipY 才能正立显示
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = repeatX === 1 ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.wrapT = repeatY === 1 ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function wrapCjkLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(cur);
      cur = '';
      if (lines.length >= maxLines) break;
      continue;
    }
    const next = cur + ch;
    if (ctx.measureText(next).width > maxWidth && cur.length > 0) {
      lines.push(cur);
      cur = ch;
      if (lines.length >= maxLines) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && text.length > lines.join('').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
  }
  return lines;
}

export interface UpdatableTexture {
  texture: THREE.CanvasTexture;
  update(theme: RoomThemeConfig): void;
}

export interface TvScreenHandle {
  texture: THREE.CanvasTexture;
  tick(elapsed: number, theme: RoomThemeConfig, reducedMotion: boolean, lite?: boolean): void;
}

export function createFloorTextures(initialTheme: RoomThemeConfig): {
  map: UpdatableTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const [canvas, ctx] = makeCanvas(512, 512);
  const [rCanvas, rCtx] = makeCanvas(512, 512);

  const randR = seededRand(88);
  rCtx.fillStyle = '#a4a4a4';
  rCtx.fillRect(0, 0, 512, 512);
  const cols = 8;
  const plankW = 512 / cols;
  const plankH = 256;
  for (let c = 0; c < cols; c++) {
    const stagger = (c % 2) * 128;
    for (let row = -1; row < 3; row++) {
      const y = row * plankH + stagger;
      const val = Math.round(138 + randR() * 34);
      rCtx.fillStyle = `rgb(${val},${val},${val})`;
      rCtx.fillRect(c * plankW + 2, y + 2, plankW - 4, plankH - 4);
    }
  }

  const drawColor = (theme: RoomThemeConfig) => {
    const rand = seededRand(42);
    ctx.fillStyle = theme.floorBase;
    ctx.fillRect(0, 0, 512, 512);

    for (let c = 0; c < cols; c++) {
      const stagger = (c % 2) * 128;
      for (let row = -1; row < 3; row++) {
        const x = c * plankW;
        const y = row * plankH + stagger;
        const shade = 0.05 + rand() * 0.2;
        ctx.fillStyle = mixHex(theme.floorBase, theme.floorGrain, shade);
        ctx.fillRect(x, y, plankW, plankH);

        ctx.strokeStyle = mixHex(theme.floorGrain, theme.woodDark, 0.24);
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.22;
        for (let g = 0; g < 9; g++) {
          const gx = x + 4 + rand() * (plankW - 8);
          ctx.beginPath();
          ctx.moveTo(gx, y);
          ctx.bezierCurveTo(
            gx + (rand() - 0.5) * 6,
            y + plankH * 0.35,
            gx + (rand() - 0.5) * 6,
            y + plankH * 0.65,
            gx + (rand() - 0.5) * 3,
            y + plankH,
          );
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        ctx.strokeStyle = mixHex(theme.floorGrain, '#000000', 0.28);
        ctx.lineWidth = 1.4;
        ctx.strokeRect(x + 0.5, y + 0.5, plankW - 1, plankH - 1);
      }
    }
  };

  drawColor(initialTheme);
  const mapTex = configureColorTex(new THREE.CanvasTexture(canvas), 1.6, 1.6);
  const roughTex = new THREE.CanvasTexture(rCanvas);
  roughTex.wrapS = THREE.RepeatWrapping;
  roughTex.wrapT = THREE.RepeatWrapping;
  roughTex.repeat.set(1.6, 1.6);
  roughTex.needsUpdate = true;

  return {
    map: {
      texture: mapTex,
      update(theme) {
        drawColor(theme);
        mapTex.needsUpdate = true;
      },
    },
    roughnessMap: roughTex,
  };
}

export function createPlasterTexture(initialTheme: RoomThemeConfig): UpdatableTexture {
  const [canvas, ctx] = makeCanvas(256, 256);

  const draw = (theme: RoomThemeConfig) => {
    const rand = seededRand(19);
    ctx.fillStyle = theme.plaster;
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 520; i++) {
      ctx.fillStyle = rand() > 0.5 ? theme.plasterAlt : theme.trim;
      ctx.globalAlpha = 0.08 + rand() * 0.12;
      ctx.beginPath();
      ctx.arc(rand() * 256, rand() * 256, 1 + rand() * 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  draw(initialTheme);
  const tex = configureColorTex(new THREE.CanvasTexture(canvas), 1.5, 1.5);
  return {
    texture: tex,
    update(theme) {
      draw(theme);
      tex.needsUpdate = true;
    },
  };
}

export function createRugTexture(initialTheme: RoomThemeConfig): UpdatableTexture {
  const [canvas, ctx] = makeCanvas(512, 512);

  const draw = (theme: RoomThemeConfig) => {
    const rand = seededRand(209);
    const cx = 256;
    const cy = 256;

    ctx.fillStyle = theme.rugBase;
    ctx.fillRect(0, 0, 512, 512);

    for (let r = 10; r < 252; r += 5) {
      ctx.strokeStyle = mixHex(theme.rugBase, theme.rugPattern, 0.06 + rand() * 0.05);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = theme.rugPattern;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 232, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = theme.rugBorder;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.arc(cx, cy, 212, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = mixHex(theme.rugPattern, theme.rugBorder, 0.35);
    ctx.lineWidth = 2;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r0 = i % 2 === 0 ? 186 : 196;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * 206, cy + Math.sin(a) * 206);
      ctx.stroke();
    }

    ctx.strokeStyle = theme.rugPattern;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, cy, 146, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = mixHex(theme.rugPattern, theme.pinkAccent, 0.5);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 134, 62, -0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, 134, 62, 0.42, 0, Math.PI * 2);
    ctx.stroke();

    const drawStar = (x: number, y: number, rOut: number, rIn: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const rad = i % 2 === 0 ? rOut : rIn;
        const px = x + Math.cos(a) * rad;
        const py = y + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    };
    drawStar(cx, cy, 34, 8, theme.rugPattern);
    drawStar(cx + 106, cy - 58, 12, 3.2, theme.pinkAccent);
    drawStar(cx - 110, cy + 54, 10, 2.8, theme.rugBorder);
  };

  draw(initialTheme);
  const tex = configureColorTex(new THREE.CanvasTexture(canvas), 1, 1);
  return {
    texture: tex,
    update(theme) {
      draw(theme);
      tex.needsUpdate = true;
    },
  };
}

export function createShelfPlateTexture(
  code: string,
  label: string,
  total: number,
  initialTheme: RoomThemeConfig,
): UpdatableTexture {
  const [canvas, ctx] = makeCanvas(256, 64);

  const draw = (theme: RoomThemeConfig) => {
    ctx.fillStyle = '#181b26';
    ctx.fillRect(0, 0, 256, 64);

    ctx.strokeStyle = theme.metalBrass;
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 56);

    ctx.fillStyle = theme.accent;
    ctx.fillRect(14, 16, 6, 32);

    ctx.fillStyle = '#f0ede4';
    ctx.font = `600 22px ${FONT_SANS}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 30, 33);

    ctx.fillStyle = '#9aa0b4';
    ctx.font = `500 15px ${FONT_MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${code} · ${total}册`, 240, 33);
    ctx.textAlign = 'left';
  };

  draw(initialTheme);
  const tex = configureColorTex(new THREE.CanvasTexture(canvas), 1, 1);
  return {
    texture: tex,
    update(theme) {
      draw(theme);
      tex.needsUpdate = true;
    },
  };
}

export function createCalendarTexture(
  payload: RoomPayload,
  initialTheme: RoomThemeConfig,
): UpdatableTexture {
  const [canvas, ctx] = makeCanvas(320, 420);

  const draw = (theme: RoomThemeConfig) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());

    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const year = Number(get('year') || '2026');
    const month = Number(get('month') || '11');
    const day = Number(get('day') || '21');
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const weekNames = ['日', '一', '二', '三', '四', '五', '六'];
    const todayWeekday = weekNames[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];

    const latestMs = payload.latestNoticeAt ? Date.parse(payload.latestNoticeAt) : 0;
    const hasFresh = latestMs > 0 && Date.now() - latestMs < 24 * 60 * 60 * 1000;
    const latestTitle = payload.notices[0]?.title ?? '基地公告栏';

    ctx.fillStyle = '#2a2e40';
    ctx.fillRect(0, 0, 320, 420);

    ctx.fillStyle = theme.accent;
    ctx.fillRect(0, 0, 320, 56);

    ctx.fillStyle = '#ffffff';
    ctx.font = `600 18px ${FONT_MONO}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(`${year}.${String(month).padStart(2, '0')} // NOTICE`, 18, 28);

    if (hasFresh) {
      ctx.fillStyle = '#ff4d4f';
      ctx.beginPath();
      ctx.arc(294, 28, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#f2efe8';
    ctx.font = `700 84px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(day).padStart(2, '0'), 96, 128);

    ctx.textAlign = 'left';
    ctx.fillStyle = theme.accent;
    ctx.font = `600 22px ${FONT_SANS}`;
    ctx.fillText(`星期${todayWeekday}`, 178, 108);
    ctx.fillStyle = '#9ea2b0';
    ctx.font = `500 15px ${FONT_MONO}`;
    ctx.fillText(`共 ${payload.notices.length} 条公告`, 178, 142);

    ctx.strokeStyle = '#383c4c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(20, 184);
    ctx.lineTo(300, 184);
    ctx.stroke();

    const startX = 28;
    const colW = 40;
    ctx.font = `500 13px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    weekNames.forEach((w, i) => {
      ctx.fillStyle = i === 0 || i === 6 ? theme.accent : '#8c909e';
      ctx.fillText(w, startX + i * colW + 14, 208);
    });

    for (let d = 1; d <= daysInMonth; d++) {
      const idx = firstWeekday + (d - 1);
      const col = idx % 7;
      const row = Math.floor(idx / 7);
      const cx = startX + col * colW + 14;
      const cy = 232 + row * 25;
      if (d === day) {
        ctx.fillStyle = theme.accent;
        ctx.fillRect(cx - 12, cy - 10, 24, 20);
        ctx.fillStyle = '#ffffff';
      } else {
        ctx.fillStyle = '#d8d7d2';
      }
      ctx.fillText(String(d), cx, cy + 1);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#222636';
    ctx.fillRect(16, 360, 288, 44);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(16, 360);
    ctx.lineTo(16, 404);
    ctx.stroke();

    ctx.fillStyle = '#eceae4';
    ctx.font = `600 14px ${FONT_SANS}`;
    const shortTitle = latestTitle.length > 15 ? `${latestTitle.slice(0, 15)}…` : latestTitle;
    ctx.fillText(shortTitle, 28, 383);
  };

  draw(initialTheme);
  const tex = configureColorTex(new THREE.CanvasTexture(canvas), 1, 1);
  return {
    texture: tex,
    update(theme) {
      draw(theme);
      tex.needsUpdate = true;
    },
  };
}

// 书桌电脑屏幕：直接渲染本站真实 /about/「关于」页面内容（导航栏 + 诺诺头像名片 + 同心圆弧 + 社交链接 + 技能标签 + 自述正文）
export function createMonitorTexture(
  payload: RoomPayload,
  initialTheme: RoomThemeConfig,
): UpdatableTexture {
  const [canvas, ctx] = makeCanvas(640, 380);
  let avatarImg: HTMLImageElement | null = null;
  let currentTheme = initialTheme;
  const tex = configureColorTex(new THREE.CanvasTexture(canvas), 1, 1);

  const draw = (theme: RoomThemeConfig) => {
    currentTheme = theme;
    const bg = '#0f1119';
    const bgElev = '#161924';
    const line = '#2a2e3d';
    const fg = '#eceae4';
    const fgMuted = '#a4a7b5';
    const fgFaint = '#727585';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 640, 380);

    // 1. 顶部站点导航栏（复刻 SiteHeader）
    ctx.fillStyle = '#12151f';
    ctx.fillRect(0, 0, 640, 28);
    ctx.fillStyle = line;
    ctx.fillRect(0, 28, 640, 1);

    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(18, 14, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fg;
    ctx.font = `600 11px ${FONT_SERIF}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(payload.site.name, 28, 14);

    const navLabels = ['项目', '工具', '探究', '日常', '小萌', '|', '标签', '关于'];
    let nx = 382;
    ctx.font = `500 10px ${FONT_SANS}`;
    for (const lbl of navLabels) {
      if (lbl === '|') {
        ctx.fillStyle = line;
        ctx.fillRect(nx, 8, 1, 12);
        nx += 10;
        continue;
      }
      ctx.fillStyle = lbl === '关于' ? theme.accent : fgMuted;
      ctx.fillText(lbl, nx, 14);
      if (lbl === '关于') {
        ctx.fillRect(nx, 25, 20, 1.5);
      }
      nx += 30;
    }

    // 2. 关于页名片卡片（左头像 170x186 + 右详情与右上角同心半圆环）
    const cx = 20;
    const cy = 42;
    const cw = 600;
    const ch = 220;
    const avW = 166;

    ctx.fillStyle = bgElev;
    ctx.fillRect(cx, cy, cw, ch);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx, cy, cw, ch);

    // 左侧真实诺诺头像
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx + 1, cy + 1, avW - 1, ch - 2);
    ctx.clip();
    if (avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) {
      const sc = Math.max(avW / avatarImg.naturalWidth, ch / avatarImg.naturalHeight);
      const dw = avatarImg.naturalWidth * sc;
      const dh = avatarImg.naturalHeight * sc;
      ctx.drawImage(avatarImg, cx + (avW - dw) * 0.5, cy + (ch - dh) * 0.5, dw, dh);
    } else {
      ctx.fillStyle = '#202436';
      ctx.fillRect(cx, cy, avW, ch);
      ctx.fillStyle = theme.accent;
      ctx.font = `600 12px ${FONT_MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText('NUONUO', cx + avW * 0.5, cy + ch * 0.5);
      ctx.textAlign = 'left';
    }
    ctx.restore();

    // 中缝发丝线
    const bx = cx + avW;
    ctx.fillStyle = line;
    ctx.fillRect(bx, cy, 1.5, ch);

    // 右上角同心轨道环发丝线（复刻 about.astro .card__rings）
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx + 1, cy + 1, cw - avW - 2, ch - 2);
    ctx.clip();
    const rx0 = cx + cw - 36;
    const ry0 = cy;
    [22, 42, 64, 88, 114].forEach((rad, i) => {
      ctx.strokeStyle = i % 2 === 1 ? 'rgba(138, 146, 174, 0.35)' : 'rgba(160, 168, 196, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash(i % 2 === 1 ? [3, 4] : []);
      ctx.beginPath();
      ctx.arc(rx0, ry0, rad, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(rx0 - 44, ry0 + 46, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 姓名 + 一句话介绍
    const px = bx + 20;
    ctx.fillStyle = fg;
    ctx.font = `700 21px ${FONT_SERIF}`;
    ctx.fillText(payload.profile.name, px, cy + 28);

    ctx.fillStyle = fgMuted;
    ctx.font = `400 11.5px ${FONT_SANS}`;
    const bioLines = wrapCjkLines(ctx, payload.profile.bio, cw - avW - 44, 2);
    bioLines.forEach((l, i) => ctx.fillText(l, px, cy + 54 + i * 17));

    // 社交链接小胶囊
    let lx = px;
    const ly = cy + 98;
    ctx.font = `500 10px ${FONT_SANS}`;
    for (const lk of payload.profile.links.slice(0, 5)) {
      const txt = `${lk.label} ↗`;
      const tw = ctx.measureText(txt).width + 14;
      if (lx + tw > cx + cw - 12) break;
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.fillStyle = '#12151f';
      ctx.fillRect(lx, ly - 10, tw, 20);
      ctx.strokeRect(lx, ly - 10, tw, 20);
      ctx.fillStyle = fg;
      ctx.fillText(txt, lx + 7, ly);
      lx += tw + 6;
    }

    // 分隔发丝线 + 真实技能标签阵
    ctx.fillStyle = line;
    ctx.fillRect(px, cy + 122, cw - avW - 36, 1);

    let sx = px;
    let sy = cy + 142;
    ctx.font = `500 9.5px ${FONT_MONO}`;
    for (const sk of payload.profile.skills.slice(0, 14)) {
      const sw = ctx.measureText(sk).width + 12;
      if (sx + sw > cx + cw - 14) {
        sx = px;
        sy += 21;
      }
      if (sy > cy + ch - 12) break;
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.strokeRect(sx, sy - 8, sw, 16);
      ctx.fillStyle = fgMuted;
      ctx.fillText(sk, sx + 6, sy);
      sx += sw + 5;
    }

    // 3. 下方正文档案纸页（PROFILE · NOTES // ABOUT 01）
    const ay = 276;
    const ah = 90;
    ctx.fillStyle = bgElev;
    ctx.fillRect(cx, ay, cw, ah);
    ctx.strokeStyle = line;
    ctx.strokeRect(cx, ay, cw, ah);

    // 头部栏
    ctx.fillStyle = fgFaint;
    ctx.font = `600 9.5px ${FONT_MONO}`;
    ctx.fillText('PROFILE · NOTES', cx + 16, ay + 15);
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.accent;
    ctx.fillText('ABOUT // 01', cx + cw - 16, ay + 15);
    ctx.textAlign = 'left';
    ctx.fillStyle = line;
    ctx.fillRect(cx + 12, ay + 25, cw - 24, 1);

    // 真实 my_introduction.md 开篇正文
    ctx.fillStyle = fgMuted;
    ctx.font = `400 11px ${FONT_SANS}`;
    const introText =
      payload.profile.intro ||
      '我是诺诺，计算机专业本科在读，主攻 Java 后端和 AI 应用工程。这里就是我的笔记本。';
    const introLines = wrapCjkLines(ctx, introText, cw - 32, 3);
    introLines.forEach((l, i) => ctx.fillText(l, cx + 16, ay + 41 + i * 17));
  };

  draw(initialTheme);

  if (payload.profile.avatar) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const sep = payload.profile.avatar.includes('?') ? '&' : '?';
    img.onload = () => {
      avatarImg = img;
      draw(currentTheme);
      tex.needsUpdate = true;
    };
    img.src = `${payload.profile.avatar}${sep}nn_tex=1`;
  }

  return {
    texture: tex,
    update(theme) {
      draw(theme);
      tex.needsUpdate = true;
    },
  };
}

export function createCorkBoardTexture(
  payload: RoomPayload,
  initialTheme: RoomThemeConfig,
): UpdatableTexture {
  const [canvas, ctx] = makeCanvas(512, 360);

  const draw = (theme: RoomThemeConfig) => {
    const rand = seededRand(77);

    ctx.fillStyle = '#68503c';
    ctx.fillRect(0, 0, 512, 360);
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = rand() > 0.5 ? '#7c6048' : '#523e2e';
      ctx.globalAlpha = 0.26;
      ctx.fillRect(rand() * 512, rand() * 360, 2 + rand() * 4, 2 + rand() * 3);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#1b1e28';
    ctx.fillRect(156, 16, 200, 36);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(156, 16, 200, 36);
    ctx.fillStyle = '#f0ede6';
    ctx.font = `600 16px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`站内标签 · ${payload.tags.length} 个主题`, 256, 34);

    const topTags = payload.tags.slice(0, 9);
    const pinColors = [theme.accent, '#eab308', '#38bdf8', '#4ade80'];
    const noteBg = ['#2b2f40', '#322d24', '#25322e'];

    topTags.forEach((item, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const cx = 92 + col * 164 + (rand() - 0.5) * 14;
      const cy = 104 + row * 94 + (rand() - 0.5) * 10;
      const rot = (rand() - 0.5) * 0.14;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);

      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(-62, -30, 128, 68);
      ctx.fillStyle = noteBg[idx % noteBg.length];
      ctx.fillRect(-64, -34, 128, 68);
      ctx.strokeStyle = '#3c4050';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-64, -34, 128, 68);

      ctx.fillStyle = pinColors[idx % pinColors.length];
      ctx.beginPath();
      ctx.arc(0, -24, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#eceae4';
      ctx.font = `600 15px ${FONT_SANS}`;
      const title = item.tag.length > 8 ? `${item.tag.slice(0, 8)}…` : item.tag;
      ctx.fillText(`# ${title}`, 0, 0);

      ctx.fillStyle = theme.accent;
      ctx.font = `500 12px ${FONT_MONO}`;
      ctx.fillText(`${item.count} 篇笔记`, 0, 21);

      ctx.restore();
    });
    ctx.textAlign = 'left';
  };

  draw(initialTheme);
  const tex = configureColorTex(new THREE.CanvasTexture(canvas), 1, 1);
  return {
    texture: tex,
    update(theme) {
      draw(theme);
      tex.needsUpdate = true;
    },
  };
}

// 复古电视 CRT 屏幕：展示《星海漫游》（cosmic-roam）开局待命界面
export function createTvScreenController(
  _payload: RoomPayload,
  initialTheme: RoomThemeConfig,
): TvScreenHandle {
  const [canvas, ctx] = makeCanvas(512, 384);
  const texture = configureColorTex(new THREE.CanvasTexture(canvas), 1, 1);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  let lastDraw = -1;

  // 确定性深空星点与斯隆长城彩带
  const starRand = seededRand(20261121);
  const bgStars = Array.from({ length: 130 }, () => ({
    x: starRand() * 512,
    y: starRand() * 384,
    r: 0.5 + Math.pow(starRand(), 2.2) * 1.4,
    c: starRand() < 0.35 ? '#ffd6a0' : starRand() < 0.72 ? '#9fd8ff' : '#ffffff',
    a: 0.35 + starRand() * 0.6,
  }));

  const routeColors = ['#ffc878', '#6ee7b7', '#ff9ec7', '#ff9d76', '#7ce2ff'];
  const routeNames = ['基地', '标签', '画廊', '关于', '游戏'];
  const skinColors = ['#8fd4ff', '#ffc878', '#d8b4fe', '#ff9ec7'];

  const drawFrame = (t: number, theme: RoomThemeConfig) => {
    // 1. 深邃斯隆长城太空背景
    const bgGrad = ctx.createRadialGradient(256, 178, 22, 256, 192, 310);
    bgGrad.addColorStop(0, '#0c1833');
    bgGrad.addColorStop(0.55, '#050a18');
    bgGrad.addColorStop(1, '#02040b');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 512, 384);

    // 倾斜星云微光带
    const nebGrad = ctx.createLinearGradient(40, 290, 470, 95);
    nebGrad.addColorStop(0, 'rgba(224, 103, 79, 0.08)');
    nebGrad.addColorStop(0.5, 'rgba(110, 198, 255, 0.14)');
    nebGrad.addColorStop(1, 'rgba(196, 152, 255, 0.09)');
    ctx.fillStyle = nebGrad;
    ctx.fillRect(0, 0, 512, 384);

    for (const s of bgStars) {
      ctx.fillStyle = s.c;
      ctx.globalAlpha = s.a;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 2. 顶部三角对称 HUD：左「斯隆长城 + 图鉴 0/25」、中「五星系航程线」、右「声音 + 暂停」
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(12, 18, 34, 0.85)';
    ctx.strokeStyle = 'rgba(143, 212, 255, 0.34)';
    ctx.lineWidth = 1.2;
    ctx.fillRect(18, 16, 78, 26);
    ctx.strokeRect(18, 16, 78, 26);
    ctx.fillStyle = '#eef4ff';
    ctx.font = `600 12px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('斯隆长城', 57, 29);

    ctx.fillStyle = 'rgba(12, 18, 34, 0.85)';
    ctx.fillRect(102, 16, 74, 26);
    ctx.strokeRect(102, 16, 74, 26);
    ctx.font = `500 11px ${FONT_SANS}`;
    ctx.fillStyle = '#9bb6d8';
    ctx.fillText('图鉴 ', 124, 29);
    ctx.fillStyle = '#ffc878';
    ctx.font = `700 11px ${FONT_MONO}`;
    ctx.fillText('0/25', 155, 29);

    // 居中五星系航程线
    ctx.strokeStyle = 'rgba(143, 212, 255, 0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(198, 26);
    ctx.lineTo(354, 26);
    ctx.stroke();
    routeColors.forEach((rc, idx) => {
      const rx = 204 + idx * 36;
      ctx.fillStyle = rc;
      ctx.beginPath();
      ctx.arc(rx, 26, idx === 0 ? 4.2 : 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(218, 232, 255, 0.72)';
      ctx.font = `500 9px ${FONT_SANS}`;
      ctx.fillText(routeNames[idx], rx, 39);
    });

    // 右上 声音 & 暂停图标按钮
    for (const bx of [442, 472]) {
      ctx.fillStyle = 'rgba(12, 18, 34, 0.85)';
      ctx.strokeStyle = 'rgba(143, 212, 255, 0.34)';
      ctx.fillRect(bx, 16, 24, 24);
      ctx.strokeRect(bx, 16, 24, 24);
    }
    ctx.fillStyle = '#cfe4ff';
    ctx.fillRect(449, 24, 5, 8);
    ctx.fillRect(479, 23, 3, 10);
    ctx.fillRect(486, 23, 3, 10);

    // 3. 中央《星海漫游》飞船剪影 + 双喷口加力尾焰
    const hoverY = Math.sin(t * 2.2) * 5;
    const flicker = 0.88 + 0.12 * Math.sin(t * 14.0);
    ctx.save();
    ctx.translate(256, 186 + hoverY);

    // 推进器尾焰柔光（蓝青外焰 + 金白内核）
    for (const ex of [-18, 18]) {
      const flameGrad = ctx.createRadialGradient(ex, 40, 2, ex, 50, 32 * flicker);
      flameGrad.addColorStop(0, 'rgba(255, 246, 210, 0.96)');
      flameGrad.addColorStop(0.35, 'rgba(110, 210, 255, 0.72)');
      flameGrad.addColorStop(1, 'rgba(40, 120, 255, 0)');
      ctx.fillStyle = flameGrad;
      ctx.beginPath();
      ctx.moveTo(ex - 10, 24);
      ctx.lineTo(ex + 10, 24);
      ctx.lineTo(ex, 64 * flicker);
      ctx.closePath();
      ctx.fill();
    }

    // 飞船主三角翼与尾翼轮廓
    ctx.fillStyle = '#dce6f8';
    ctx.strokeStyle = '#8fd4ff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -52);
    ctx.lineTo(54, 20);
    ctx.lineTo(24, 16);
    ctx.lineTo(18, 28);
    ctx.lineTo(-18, 28);
    ctx.lineTo(-24, 16);
    ctx.lineTo(-54, 20);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 驾驶舱舷窗与翼尖灯
    ctx.fillStyle = '#1b2c4c';
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.lineTo(10, -4);
    ctx.lineTo(-10, -4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = theme.accent;
    ctx.fillRect(-52, 16, 4, 4);
    ctx.fillRect(48, 16, 4, 4);
    ctx.restore();

    // 4. 底部左侧遥测 + 右侧微缩雷达 + 居中选船与「点击空白区域开始游戏」
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(8, 13, 26, 0.86)';
    ctx.strokeStyle = 'rgba(143, 212, 255, 0.28)';
    ctx.fillRect(18, 304, 138, 62);
    ctx.strokeRect(18, 304, 138, 62);
    ctx.fillStyle = '#8fd4ff';
    ctx.font = `600 9px ${FONT_MONO}`;
    ctx.fillText('TELEMETRY // NAV-03', 26, 318);
    ctx.fillStyle = '#cfe4ff';
    ctx.fillText('WARP', 26, 336);
    ctx.fillStyle = '#79e6b8';
    ctx.fillRect(58, 333, 66, 5);
    ctx.fillStyle = '#a4bbd8';
    ctx.fillText('VEL 26.4 c · READY', 26, 353);

    // 底部居中：飞船涂装选择 + 开局提示
    const activeSkin = Math.floor(t / 2.6) % skinColors.length;
    skinColors.forEach((sc, idx) => {
      const bx = 208 + idx * 28;
      ctx.fillStyle = sc;
      ctx.fillRect(bx, 308, 16, 12);
      if (idx === activeSkin) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.strokeRect(bx - 3, 305, 22, 18);
      }
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = '#eef4ff';
    ctx.font = `600 14px ${FONT_SANS}`;
    ctx.fillText('点击空白区域开始游戏', 256, 349);
    ctx.textAlign = 'left';

    // 右下星图小雷达
    ctx.fillStyle = 'rgba(8, 13, 26, 0.86)';
    ctx.strokeStyle = 'rgba(143, 212, 255, 0.28)';
    ctx.fillRect(408, 304, 86, 62);
    ctx.strokeRect(408, 304, 86, 62);
    ctx.strokeStyle = 'rgba(143, 212, 255, 0.35)';
    ctx.beginPath();
    ctx.arc(451, 335, 22, 0, Math.PI * 2);
    ctx.stroke();
    routeColors.forEach((rc, i) => {
      ctx.fillStyle = rc;
      ctx.beginPath();
      ctx.arc(430 + i * 11, 342 - (i % 3) * 10, 2.4, 0, Math.PI * 2);
      ctx.fill();
    });

    // 5. CRT 细微扫描线 + 暗角框
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    for (let y = 0; y < 384; y += 4) {
      ctx.fillRect(0, y, 512, 1.4);
    }
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 14;
    ctx.strokeRect(0, 0, 512, 384);
    texture.needsUpdate = true;
  };

  drawFrame(0, initialTheme);

  return {
    texture,
    tick(elapsed, theme, reducedMotion, lite = false) {
      if (reducedMotion) {
        if (lastDraw < 0) {
          lastDraw = 0;
          drawFrame(0, theme);
        }
        return;
      }
      const interval = lite ? 1.0 : 0.45;
      if (lastDraw >= 0 && elapsed - lastDraw < interval) return;
      lastDraw = elapsed;
      drawFrame(elapsed, theme);
    },
  };
}

export function createGalleryFrameTexture(
  item: RoomGalleryItem | undefined,
  index: number,
  initialTheme: RoomThemeConfig,
): UpdatableTexture {
  const [canvas, ctx] = makeCanvas(512, 384);
  let loadedImg: HTMLImageElement | null = null;
  let currentTheme = initialTheme;
  const tex = configureColorTex(new THREE.CanvasTexture(canvas), 1, 1);

  const draw = (theme: RoomThemeConfig) => {
    currentTheme = theme;
    ctx.fillStyle = '#e8e5dd';
    ctx.fillRect(0, 0, 512, 384);

    const mx = 40;
    const my = 34;
    const mw = 432;
    const mh = 292;

    if (loadedImg && loadedImg.complete && loadedImg.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(mx, my, mw, mh);
      ctx.clip();

      if (item?.cutout) {
        ctx.fillStyle = '#252734';
        ctx.fillRect(mx, my, mw, mh);
      }

      const scale = Math.max(mw / loadedImg.naturalWidth, mh / loadedImg.naturalHeight);
      const dw = loadedImg.naturalWidth * scale;
      const dh = loadedImg.naturalHeight * scale;
      ctx.drawImage(loadedImg, mx + (mw - dw) / 2, my + (mh - dh) / 2, dw, dh);
      ctx.restore();
    } else {
      const bg = ['#e9dde5', '#dde6ef', '#e3ece0'][index % 3];
      ctx.fillStyle = bg;
      ctx.fillRect(mx, my, mw, mh);
      ctx.fillStyle = theme.accent;
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(mx + mw * 0.65, my + mh * 0.42, 68, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(mx, my, mw, mh);

    if (item?.title) {
      ctx.fillStyle = '#4a4742';
      ctx.font = `500 13px ${FONT_SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const caption = item.title.length > 20 ? `${item.title.slice(0, 20)}…` : item.title;
      ctx.fillText(caption, 256, 355);
      ctx.textAlign = 'left';
    }
  };

  draw(initialTheme);

  if (item?.thumb) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const sep = item.thumb.includes('?') ? '&' : '?';
    img.onload = () => {
      loadedImg = img;
      draw(currentTheme);
      tex.needsUpdate = true;
    };
    img.src = `${item.thumb}${sep}nn_tex=1`;
  }

  return {
    texture: tex,
    update(theme) {
      draw(theme);
      tex.needsUpdate = true;
    },
  };
}
