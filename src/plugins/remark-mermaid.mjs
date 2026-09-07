// 把 ```mermaid 代码块换成 <pre class="mermaid">，让它绕开 Shiki 高亮，
// 交给页面上的脚本在浏览器里渲染成图。
//
// 必须在 remark 阶段做：Shiki 是 Astro 内建的 rehype 阶段插件，
// 等到了 rehype 再改，源码已经被拆成一堆着色 span，拼不回来了。

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (ch) => ESCAPE[ch]);
}

function walk(node) {
  if (!Array.isArray(node.children)) return;

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];

    if (child.type === 'code' && child.lang === 'mermaid') {
      node.children[i] = {
        type: 'html',
        // 原样保留源码；实体会被 HTML 解析器还原，textContent 拿到的仍是原文
        value: `<pre class="mermaid" data-mermaid>${escapeHtml(child.value)}</pre>`,
      };
      continue;
    }

    walk(child);
  }
}

export function remarkMermaid() {
  return (tree) => walk(tree);
}
