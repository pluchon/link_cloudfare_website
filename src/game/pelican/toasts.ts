// 画面顶上的提示（捡到东西、进新场景、掉下去了）：一条一条叠着放（用户要的）。
// 只有一条时就在最上面；同时有几条时往下一行一行排开，最多三行；按剩下的时间排，快结束的在最上面，
// 多于三条时只放剩得最少的三条——和右下角道具计时是同一个规矩。位置变化交给 CSS 的过渡，这里只算每条该在第几行

// 每条提示放多久（秒）、退场的过渡多久（秒）、最多几行
const LIFE = 2.6;
const LEAVE = 0.35;
const ROWS = 3;

// 页面上的样式是 Astro 按组件加了作用域的（选择器后面带一个 data-astro-cid-xxx 属性），
// 脚本现建的元素没有这个属性，样式一条都套不上——从现成的元素上抄一份过来
export function scopeLike(node: Element, from: Element): void {
  for (const attribute of Array.from(from.attributes)) {
    if (attribute.name.startsWith('data-astro-cid-')) node.setAttribute(attribute.name, '');
  }
}

interface Toast {
  node: HTMLElement;
  text: string;
  left: number;
}

export class ToastStack {
  private readonly box: HTMLElement;
  private readonly live: Toast[] = [];
  // 正在淡出、过一会儿要从页面上拿掉的
  private readonly leaving: Array<{ node: HTMLElement; left: number }> = [];

  constructor(box: HTMLElement) {
    this.box = box;
  }

  // icon 是一段写死的 svg 内容（game.ts 的 ICONS）；同一句话还在的话只把时间续满，不再多出一条
  show(text: string, icon = ''): void {
    const same = this.live.find((toast) => toast.text === text);
    if (same) {
      same.left = LIFE;
      this.arrange();
      return;
    }
    const node = document.createElement('p');
    node.className = 'pelican__toast pelican__panel';
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mark.setAttribute('class', 'pelican__toast-icon');
    mark.setAttribute('viewBox', '0 0 24 24');
    mark.setAttribute('aria-hidden', 'true');
    mark.innerHTML = icon;
    const label = document.createElement('span');
    label.textContent = text;
    node.append(mark, label);
    [node, mark, label].forEach((part) => scopeLike(part, this.box));
    this.box.append(node);
    this.live.push({ node, text, left: LIFE });
    // 先摆在它该在的那一行、透明着，下一帧再显出来，才有从上面落下来的过渡
    this.arrange(node);
    requestAnimationFrame(() => this.arrange());
  }

  // 每帧调用；paused 时不走时间
  tick(dt: number, paused: boolean): void {
    if (!paused) {
      let changed = false;
      for (let i = this.live.length - 1; i >= 0; i -= 1) {
        const toast = this.live[i];
        toast.left -= dt;
        if (toast.left > 0) continue;
        this.live.splice(i, 1);
        delete toast.node.dataset.show;
        // 走的那条往上滑出去，下面的同时往上补位，不在原地慢慢淡掉、压着补上来的那条
        toast.node.dataset.leave = '1';
        this.leaving.push({ node: toast.node, left: LEAVE });
        changed = true;
      }
      if (changed) this.arrange();
    }
    for (let i = this.leaving.length - 1; i >= 0; i -= 1) {
      this.leaving[i].left -= dt;
      if (this.leaving[i].left > 0) continue;
      this.leaving[i].node.remove();
      this.leaving.splice(i, 1);
    }
  }

  // 全部清掉（再骑一次时）
  clear(): void {
    [...this.live.map((toast) => toast.node), ...this.leaving.map((item) => item.node)].forEach((node) => node.remove());
    this.live.length = 0;
    this.leaving.length = 0;
  }

  // 按剩下的时间从少到多排：前三条依次放在第 0、1、2 行，其余的先藏着。fresh 是刚加进来、这一帧先不显的那条
  private arrange(fresh?: HTMLElement): void {
    const order = [...this.live].sort((a, b) => a.left - b.left);
    order.forEach((toast, row) => {
      toast.node.style.setProperty('--row', String(Math.min(row, ROWS - 1)));
      const visible = row < ROWS && toast.node !== fresh;
      if (visible) toast.node.dataset.show = '1';
      else delete toast.node.dataset.show;
    });
  }
}
