// 构建期专用（Node / Astro SSR）：借助 devDependencies 的 pinyin-pro 为中文文本预编码拼音序列，
// 按上下文消歧多音字，并与客户端 src/lib/search-engine.ts 使用完全一致的 RE_ZH 逐字对齐。
// 注意：不要在浏览器端脚本导入本文件，以保持运行期零大字典依赖。
import { pinyin } from 'pinyin-pro';

export const RE_ZH = /^[\u3400-\u4dbf\u4e00-\u9fff]$/;

function normalizePy(rawPy: string): string {
  return rawPy.toLowerCase().replace(/u:|ü/g, 'v').replace(/[^a-z]/g, '');
}

function countZh(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (RE_ZH.test(text[i])) n += 1;
  }
  return n;
}

/**
 * 为文本生成与每枚 BMP 汉字一一对应的空格分隔拼音序列。
 * - includePolyphones=true 时（用于标题/标签/摘要等短字段），在首选上下文读音之后附加最多 2 个备选读音，格式为 `zhuo|zhe`。
 */
export function encodePinyin(raw: string, includePolyphones = false): string {
  const s = String(raw || '');
  if (!s) return '';

  const expected = countZh(s);
  if (expected === 0) return '';

  const items = pinyin(s, { type: 'all', toneType: 'none', v: true });
  const tokens: string[] = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const orig = item.origin || '';
    for (let j = 0; j < orig.length; j++) {
      const ch = orig[j];
      if (!RE_ZH.test(ch)) continue;

      const primary = j === 0 || orig.length === 1 ? normalizePy(item.pinyin || '') : '';
      const fallback =
        primary ||
        normalizePy(pinyin(ch, { toneType: 'none', v: true }) || '');

      if (!includePolyphones) {
        tokens.push(fallback || '-');
        continue;
      }

      const readings: string[] = [];
      if (fallback) readings.push(fallback);

      const alts = pinyin(ch, { multiple: true, toneType: 'none', type: 'array', v: true });
      for (const alt of alts) {
        const norm = normalizePy(alt);
        if (norm && !readings.includes(norm)) {
          readings.push(norm);
          if (readings.length >= 3) break;
        }
      }

      tokens.push(readings.length > 0 ? readings.join('|') : '-');
    }
  }

  if (tokens.length !== expected) {
    throw new Error(
      `encodePinyin alignment mismatch: expected ${expected} Hanzi tokens, got ${tokens.length}`,
    );
  }

  return tokens.join(' ');
}
