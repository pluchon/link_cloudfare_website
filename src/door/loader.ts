// 穿过视界之后的加载画面：先把目标页的 HTML 拿下来，从里面找出样式、脚本和首屏图片挨个预加载，
// 进度条按真实完成的数量走；全部就绪（或超时）后文字淡掉，留下和目标页第一帧一样的网格画面，再跳过去。
// 目标页那边由 BaseLayout 接住（html[data-arrive]），网格渐隐露出页面

export interface LoaderUI {
  root: HTMLElement;
  floor: HTMLElement;
  fill: HTMLElement;
  label: HTMLElement;
  pct: HTMLElement;
}

// 图片最多等这么多张，再多也只是首屏以外的
const MAX_IMAGES = 8;
// 整个预加载最多等这么久，网络慢就别让人一直看进度条
const TIMEOUT_MS = 6000;
// 进度条至少走这么久，太快一闪而过反而像出错了
const MIN_MS = 1200;

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
  ui.root.hidden = false;
  requestAnimationFrame(() => (ui.root.dataset.state = 'on'));

  const startedAt = performance.now();
  let goal = 0.04;
  let shown = 0;
  let finished = false;

  // 进度条追着真实进度走，带一点缓动；地面随进度往前推，像在往前开。
  // 缓动按经过的时间算、不按帧算：标签页在后台被降帧时也要按时走完
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    shown += (goal - shown) * Math.min(dt * 6, 1);
    if (goal - shown < 0.004) shown = goal;
    ui.fill.style.transform = `scaleX(${shown})`;
    ui.pct.textContent = `${Math.round(shown * 100)}%`;
    ui.floor.style.backgroundPosition = `center ${shown * 640}px`;
    if (finished && shown >= 1) {
      arrive();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const arrive = () => {
    const wait = Math.max(0, MIN_MS - (performance.now() - startedAt));
    window.setTimeout(() => {
      // 文字先淡掉，剩下的画面和目标页第一帧一样
      ui.root.dataset.state = 'done';
      window.setTimeout(() => {
        try {
          sessionStorage.setItem('nn-arrive', '1');
        } catch {
          /* 写不进去也照样跳，只是目标页没有渐隐 */
        }
        location.assign(href);
      }, 260);
    }, wait);
  };

  const url = new URL(href, location.href).href;
  const work = fetch(url, { credentials: 'same-origin' })
    .then((r) => r.text())
    .then((html) => {
      goal = 0.3;
      const assets = collect(html, url);
      if (!assets.length) return;
      let done = 0;
      return Promise.all(
        assets.map((a) =>
          loadAsset(a.url, a.image).then(() => {
            done++;
            goal = 0.3 + 0.7 * (done / assets.length);
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
