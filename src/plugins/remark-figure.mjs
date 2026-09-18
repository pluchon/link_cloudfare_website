// 独占一段的图片包一层「图版」：等宽的发丝线框，图居中放在里面。
//
// 为什么要包一层：图片宽度撑满正文栏时看着没问题，可竖图按高度缩完只有半栏宽，
// 居中摆着两边各空一大块，像是没排满。套进一个等宽的框里，那片空白就落在
// 框的内部，读起来是留白而不是漏排。
//
// 不渲染图注。alt 是截图工具自动生成的文件名（image-2026...、1752388690908），
// 显示出来只是噪音；alt 仍然留在标签里给读屏软件用。

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (ch) => ESCAPE[ch]);
}

// 只有独占一段的图片才套图版：`![](x) 后面还有字` 这种保持原样
function loneImage(node) {
  if (node.type !== 'paragraph' || !Array.isArray(node.children)) return null;
  const kids = node.children.filter(
    (child) => !(child.type === 'text' && !child.value.trim()),
  );
  return kids.length === 1 && kids[0].type === 'image' ? kids[0] : null;
}

function walk(node) {
  if (!Array.isArray(node.children)) return;

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const image = loneImage(child);

    if (image) {
      const title = image.title ? ` title="${escapeHtml(image.title)}"` : '';
      node.children[i] = {
        type: 'html',
        value:
          '<figure class="plate">' +
          `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || '')}"${title} loading="lazy" decoding="async">` +
          '</figure>',
      };
      continue;
    }

    walk(child);
  }
}

export function remarkFigure() {
  return (tree) => walk(tree);
}
