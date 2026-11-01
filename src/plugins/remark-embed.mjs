// 公告正文里的特色内容：```post、```link、```xiaomeng 三种代码块。
//
// 和 mermaid 一样要在 remark 阶段换掉，否则源码会被 Shiki 拆成着色 span。
// 这里只留一个占位，真正的内容在 lib/embeds.ts 里生成：帖子视窗要查别的集合，
// 而 Markdown 是在加载器里渲染的，那时候集合还没建好。

const KINDS = new Set(['post', 'link', 'xiaomeng']);

function walk(node) {
  if (!Array.isArray(node.children)) return;

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];

    if (child.type === 'code' && KINDS.has(child.lang)) {
      node.children[i] = {
        type: 'html',
        value: `<div data-embed="${child.lang}" data-value="${encodeURIComponent(child.value)}"></div>`,
      };
      continue;
    }

    walk(child);
  }
}

export function remarkEmbed() {
  return (tree) => walk(tree);
}
