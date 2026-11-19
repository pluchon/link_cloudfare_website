// 穿过视界之后的跃迁加载画面：先预加载目标页 HTML、样式、模块脚本与首屏图片，
// 资源未落盘前进度严格封顶在 95%；每帧仅通过纯 GPU transform: scaleX(...) 推进 1px 导轨（零几何重绘），
// 就绪后推进至 100%，淡出面板与深空繁星并留下与目标页首帧完全一致的底图无缝跳转。

export interface LoaderUI {
  root: HTMLElement;
  fill: HTMLElement;
  label: HTMLElement;
  pct: HTMLElement;
  stage: HTMLElement;
  telemetry: HTMLElement;
  status: HTMLElement;
}

// 图片最多等这么多张，再多也只是首屏以外的
const MAX_IMAGES = 8;
// 整个预加载最多等这么久，网络慢就别让人一直看进度条
const TIMEOUT_MS = 6000;
// 进度条至少走这么久，太快一闪而过反而像出错了
const MIN_MS = 1200;

const STAGES: [number, string][] = [
  [0, '锁定测地线航道'],
  [0.34, '解析目标星域'],
  [0.62, '同步首屏资源'],
  [0.985, '视界跃迁就绪'],
];

function loadAsset(url: string, image: boolean): Promise<void> {
  if (image) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = img.onerror = () => resolve();
      img.src = url;
    });
  }
  return fetch(url, { credentials: 'same-origin' }).then(
    (r) => r.blob().then(() => undefined),
    () => undefined,
  );
}

// 从目标页里挑出要预加载的资源：样式、模块脚本、预加载的模块、非懒加载的图片
function collect(html: string, base: string): { url: string; image: boolean }[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const found = new Map<string, boolean>();
  const add = (raw: string | null, image: boolean) => {
    if (!raw) return;
    try {
      found.set(new URL(raw, base).href, image);
    } catch {
      /* 写坏的地址直接跳过 */
    }
  };
  doc.querySelectorAll('link[rel="stylesheet"]').forEach((el) => add(el.getAttribute('href'), false));
  doc.querySelectorAll('link[rel="modulepreload"]').forEach((el) => add(el.getAttribute('href'), false));
  doc.querySelectorAll('script[type="module"][src]').forEach((el) => add(el.getAttribute('src'), false));
  let images = 0;
  doc.querySelectorAll('img[src]').forEach((el) => {
    if (images >= MAX_IMAGES || el.getAttribute('loading') === 'lazy') return;
    images++;
    add(el.getAttribute('src'), true);
  });
  return [...found].map(([url, image]) => ({ url, image }));
}

export function travel(href: string, title: string, ui: LoaderUI) {
  ui.label.textContent = title;
  ui.status.textContent = 'GEODESIC · SYNC';
  ui.root.hidden = false;
  requestAnimationFrame(() => (ui.root.dataset.state = 'on'));

  const startedAt = performance.now();
  let goal = 0.08;
  let shown = 0;
  let finished = false;
  let finishing = false;
  let lastPct = -1;
  let lastStage = '';
  let lastTel = '';

  const paint = (ratio: number, allowHundred: boolean) => {
    ui.fill.style.transform = `scaleX(${ratio})`;

    let stageText = STAGES[0][1];
    for (let k = 0; k < STAGES.length; k++) {
      if (ratio >= STAGES[k][0]) stageText = STAGES[k][1];
    }
    if (stageText !== lastStage) {
      lastStage = stageText;
      ui.stage.textContent = stageText;
    }

    const rRs = Math.max(0, 1.5 * (1 - ratio));
    const beta = 0.3 + 0.692 * ratio;
    const gamma = 1 / Math.sqrt(Math.max(1 - beta * beta, 0.01));
    const tel = `R = ${rRs.toFixed(2)} Rs · γ = ${gamma.toFixed(2)}`;
    if (tel !== lastTel) {
      lastTel = tel;
      ui.telemetry.textContent = tel;
    }

    const p = allowHundred && ratio >= 0.996 ? 100 : Math.min(Math.round(ratio * 100), 95);
    if (p !== lastPct) {
      lastPct = p;
      ui.pct.textContent = `${p}%`;
      ui.root.setAttribute('aria-valuenow', String(p));
    }
  };

  paint(0, false);

  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    const ceiling = finished ? 1 : Math.min(goal, 0.95);
    shown += (ceiling - shown) * Math.min(dt * (finished ? 10 : 6), 1);
    if (!finished) shown = Math.min(shown, 0.95);

    if (finished && 1 - shown < 0.004) {
      shown = 1;
      paint(1, true);
      if (!finishing) {
        finishing = true;
        ui.status.textContent = 'GEODESIC · OPEN';
        arrive();
      }
      return;
    }
    paint(finished ? shown : Math.min(shown, 0.95), false);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const arrive = () => {
    const wait = Math.max(100, MIN_MS - (performance.now() - startedAt));
    window.setTimeout(() => {
      // 星野与进度面板先淡掉，留下与目标页第一帧完全一致的深空底图与 1px 导轨线
      ui.root.dataset.state = 'done';
      window.setTimeout(() => {
        try {
          sessionStorage.setItem('nn-arrive', '1');
        } catch {
          /* 写不进去也照样跳，只是目标页没有渐隐 */
        }
        location.assign(href);
      }, 280);
    }, wait);
  };

  const url = new URL(href, location.href).href;
  const work = fetch(url, { credentials: 'same-origin' })
    .then((r) => r.text())
    .then((html) => {
      goal = 0.34;
      const assets = collect(html, url);
      if (!assets.length) return;
      let done = 0;
      return Promise.all(
        assets.map((a) =>
          loadAsset(a.url, a.image).then(() => {
            done++;
            goal = 0.34 + 0.61 * (done / assets.length);
          }),
        ),
      ).then(() => undefined);
    })
    .catch(() => undefined);

  Promise.race([work, new Promise((r) => window.setTimeout(r, TIMEOUT_MS))]).then(() => {
    goal = 1;
    finished = true;
  });
}
