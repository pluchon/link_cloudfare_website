// 点开看大图：文章和公告共用。正文里的图和 mermaid 图都限到七成屏高，细节靠这层补回来。
// 用事件委托挂在 document 上：mermaid 是滚到附近才画的，图晚于绑定出现；
// 模块脚本整页只跑一次，ClientRouter 换页后监听还在，所以换到公告页、文章页都管用

declare global {
  interface Window {
    __nnZoomBound?: boolean;
  }
}

function closeBox(): void {
  const box = document.querySelector('.lightbox');
  if (!box) return;
  box.removeAttribute('data-open');
  document.documentElement.style.overflow = '';
  window.setTimeout(() => box.remove(), 200);
}

function openBox(node: Node): void {
  closeBox();
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.appendChild(node);

  const hint = document.createElement('p');
  hint.className = 'lightbox__hint';
  hint.textContent = '点击任意处关闭';
  box.appendChild(hint);

  document.body.appendChild(box);
  // 打开期间锁住页面滚动，免得背后的正文跟着动
  document.documentElement.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    box.dataset.open = '1';
  });
}

function onZoom(event: MouseEvent): void {
  if (document.querySelector('.lightbox')) {
    closeBox();
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) return;

  // 包在链接里的图（公告的站内、站外视窗封面）点了是跳转，不放大
  const img = target.closest<HTMLImageElement>('.prose img, img[data-zoom]');
  if (img && !img.closest('a')) {
    const copy = new Image();
    copy.src = img.currentSrc || img.src;
    copy.alt = img.alt;
    openBox(copy);
    return;
  }

  const svg = target.closest<SVGSVGElement>('.prose pre.mermaid[data-ready="1"] svg');
  if (svg) {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // mermaid 会把渲染尺寸写进行内样式，留着的话放大也只有原来那么大
    clone.removeAttribute('style');
    clone.removeAttribute('width');
    clone.removeAttribute('height');

    // 按 viewBox 的比例算出能放多大：交给 CSS 拉满会把扁长的图
    // 摊在一块竖着的底板中间。48 是左右各 1.5rem 的内边距
    const view = svg.viewBox.baseVal;
    if (view && view.width && view.height) {
      const room = Math.min(
        (window.innerWidth - 64 - 48) / view.width,
        (window.innerHeight - 88 - 48) / view.height,
      );
      clone.style.width = `${Math.round(view.width * room)}px`;
      clone.style.height = `${Math.round(view.height * room)}px`;
    }

    openBox(clone);
  }
}

if (!window.__nnZoomBound) {
  window.__nnZoomBound = true;
  document.addEventListener('click', onZoom);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeBox();
  });
}

export {};
