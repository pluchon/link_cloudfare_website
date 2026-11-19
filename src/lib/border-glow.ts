// 高性能鼠标沿边辉光追踪：仅在悬浮态按需开启 rAF 合批并缓存边界矩形，
// 零全局常驻循环、零逐帧强制回流，只在指针移动时更新单组 CSS 变量。

export function bindBorderGlow(el: HTMLElement): () => void {
  if (typeof window === 'undefined' || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    return () => {};
  }

  let rect: DOMRect | null = null;
  let rafId = 0;
  let leaveTimer = 0;
  let pendingX = 0;
  let pendingY = 0;
  let hovered = false;

  const invalidateRect = () => {
    rect = null;
  };

  function flush() {
    rafId = 0;
    if (!hovered) return;
    if (!rect) rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const x = Math.max(0, Math.min(rect.width, pendingX - rect.left));
    const y = Math.max(0, Math.min(rect.height, pendingY - rect.top));

    // 按到最近一条边框的绝对距离衰减：鼠标远离边框时辉光减弱，靠近单侧边框时仅在附近范围亮起
    const edgeDist = Math.min(x, rect.width - x, y, rect.height - y);
    const maxHalf = Math.min(rect.width, rect.height) * 0.5;
    const nearEdge = 1 - Math.min(1, edgeDist / Math.max(maxHalf, 1));
    const intensity = 0.22 + 0.78 * nearEdge * nearEdge;

    el.style.setProperty('--glow-x', `${x.toFixed(1)}px`);
    el.style.setProperty('--glow-y', `${y.toFixed(1)}px`);
    el.style.setProperty('--glow-op', intensity.toFixed(3));
  }

  function schedule(clientX: number, clientY: number) {
    pendingX = clientX;
    pendingY = clientY;
    if (!rafId) rafId = window.requestAnimationFrame(flush);
  }

  function onEnter(event: PointerEvent) {
    clearTimeout(leaveTimer);
    if (!hovered) {
      hovered = true;
      window.addEventListener('scroll', invalidateRect, { passive: true, capture: true });
      window.addEventListener('resize', invalidateRect, { passive: true });
    }
    rect = el.getBoundingClientRect();
    el.classList.add('is-glow');
    schedule(event.clientX, event.clientY);
  }

  function onMove(event: PointerEvent) {
    if (!hovered) return;
    schedule(event.clientX, event.clientY);
  }

  function onLeave() {
    hovered = false;
    window.removeEventListener('scroll', invalidateRect, true);
    window.removeEventListener('resize', invalidateRect);
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    el.style.setProperty('--glow-op', '0');
    clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => {
      if (!hovered) el.classList.remove('is-glow');
    }, 280);
  }

  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', onLeave);

  return () => {
    hovered = false;
    clearTimeout(leaveTimer);
    if (rafId) window.cancelAnimationFrame(rafId);
    window.removeEventListener('scroll', invalidateRect, true);
    window.removeEventListener('resize', invalidateRect);
    el.removeEventListener('pointerenter', onEnter);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerleave', onLeave);
    el.style.removeProperty('--glow-op');
    el.classList.remove('is-glow');
  };
}
