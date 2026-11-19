// 纯客户端零依赖中英拼音/注音/模糊/容错检索引擎。
// 与构建期 src/lib/search-index.ts 使用相同的 RE_ZH 与 UTF-16 下标规则，确保 <mark> 高亮零错位。

export const RE_ZH = /^[\u3400-\u4dbf\u4e00-\u9fff]$/;

// 1-to-1 UTF-16 繁简映射（每两个字符为一对：繁+简），保证 fold(s).length === s.length
const TRAD_PAIRS =
  '遊游長长門门夢梦諾诺設设計计開开發发網网資资學学習习記记憶忆飛飞機机視视頻频戲戏畫画寫写讀读說说話话詩诗國国際际關关係系' +
  '覺觉觀观現现實实體体驗验構构靜静態态碼码輯辑貓猫鳥鸟魚鱼雲云風风陽阳陰阴閃闪電电腦脑標标籤签類类頁页錄录庫库節节點点線线' +
  '環环術术藝艺樂乐聲声響响應应達达運运动动轉转換换變变進进過过還还這这個个時时間间問问题题結结經经歷历總总論论證证認认識识' +
  '讓让給给從从來来後后裡里邊边對对與与為为沒没隻只雙双兩两萬万億亿號号稱称專专業业傳传統统優优導导圖图場场彈弹復复懷怀戰战' +
  '擴扩據据斷断條条檢检權权欄栏歡欢歸归氣气漢汉準准燈灯燒烧營营獨独產产異异盡尽眾众確确離离種种穩稳窮穷範范簡简築筑篩筛紙纸' +
  '級级細细組组終终絲丝維维緊紧緒绪編编緩缓練练縮缩縱纵織织繪绘續续羅罗義义聯联聽听職职腳脚臉脸臨临舉举興兴艦舰艙舱華华葉叶' +
  '藍蓝虛虚蟲虫補补裝装製制襲袭見见規规覽览觸触訂订訊讯討讨訓训託托許许訪访評评詞词詢询試试該该詳详誇夸誕诞語语誤误誰谁課课' +
  '調调談谈請请諸诸讚赞貝贝負负財财貨货貧贫責责貴贵買买貸贷費费貼贴貿贸賀贺賞赏賢贤賣卖質质賬账賴赖賺赚購购賽赛贈赠贏赢趕赶' +
  '趨趋躍跃車车軌轨軍军軒轩軟软軸轴較较載载輔辅輕轻輪轮輸输辭辞辯辩農农違违遙遥遠远適适選选遺遗邁迈鄰邻釋释針针鐵铁鈴铃銀银' +
  '銅铜銷销鋁铝鋒锋銳锐錯错錦锦鋼钢鍵键鍾钟鎖锁鎮镇鏡镜鏈链鐘钟鑽钻閉闭閒闲閘闸鬧闹聞闻閣阁閱阅闊阔隊队陣阵階阶陸陆陳陈險险' +
  '隨随隱隐難难霧雾靈灵頂顶項项順顺須须預预頑顽頓顿領领頗颇顆颗額额顏颜願愿顧顾顯显飄飘飲饮飯饭飾饰飽饱餅饼養养餘余館馆馬马' +
  '駐驻駕驾駛驶騎骑騙骗驅驱驕骄驚惊髮发鬆松鬥斗鬱郁鮮鲜鯨鲸鳳凤鳴鸣鴉鸦鴨鸭鴻鸿鵝鹅鵜鹈鶘鹕鶴鹤雞鸡鷗鸥鷹鹰鹹咸麥麦麵面黃黄' +
  '黨党齊齐齒齿齡龄龍龙龜龟廠厂廣广廳厅創创劇剧劍剑務务勝胜勞劳勢势區区醫医單单嚴严園园聖圣執执塵尘壞坏奧奥獎奖婦妇孫孙寶宝' +
  '屬属島岛幣币師师帶带幫帮當当彙汇愛爱憂忧憤愤憲宪戀恋數数曆历書书會会殺杀極极樣样樹树歲岁殘残滅灭無无熱热療疗盤盘舊旧蘇苏' +
  '處处護护豐丰裏里複复莊庄親亲鑰钥頭头臺台灣湾櫻樱澤泽潤润潔洁溫温滿满漲涨漿浆潛潜瀾澜災灾燦灿燭烛牆墙猶犹獸兽獻献畢毕盧卢' +
  '礎础禮礼禍祸禪禅積积競竞糧粮純纯紛纷絕绝綱纲緣缘縣县縫缝績绩繞绕繳缴繼继罰罚罷罢翹翘聰聪肅肃腸肠膚肤膠胶騰腾艱艰豔艳藥药' +
  '蘆芦蘋苹蘭兰虧亏蝕蚀蠻蛮訴诉詠咏誌志誠诚講讲謝谢議议';

const TRAD_TO_SIMP: Record<string, string> = {};
for (let i = 0; i + 1 < TRAD_PAIRS.length; i += 2) {
  TRAD_TO_SIMP[TRAD_PAIRS[i]] = TRAD_PAIRS[i + 1];
}

const PY_DIACRITICS: Record<string, string> = {
  ā: 'a', á: 'a', ǎ: 'a', à: 'a',
  ē: 'e', é: 'e', ě: 'e', è: 'e',
  ī: 'i', í: 'i', ǐ: 'i', ì: 'i',
  ō: 'o', ó: 'o', ǒ: 'o', ò: 'o',
  ū: 'u', ú: 'u', ǔ: 'u', ù: 'u',
  ǖ: 'v', ǘ: 'v', ǚ: 'v', ǜ: 'v', ü: 'v',
};

const ZHUYIN_INIT: Record<string, string> = {
  ㄅ: 'b', ㄆ: 'p', ㄇ: 'm', ㄈ: 'f',
  ㄉ: 'd', ㄊ: 't', ㄋ: 'n', ㄌ: 'l',
  ㄍ: 'g', ㄎ: 'k', ㄏ: 'h',
  ㄐ: 'j', ㄑ: 'q', ㄒ: 'x',
  ㄓ: 'zh', ㄔ: 'ch', ㄕ: 'sh', ㄖ: 'r',
  ㄗ: 'z', ㄘ: 'c', ㄙ: 's',
};

const ZHUYIN_BARE_FINAL: Record<string, string> = {
  ㄚ: 'a', ㄛ: 'o', ㄜ: 'e', ㄝ: 'e',
  ㄞ: 'ai', ㄟ: 'ei', ㄠ: 'ao', ㄡ: 'ou',
  ㄢ: 'an', ㄣ: 'en', ㄤ: 'ang', ㄥ: 'eng',
  ㄦ: 'er',
};

const ZHUYIN_YI_ZERO: Record<string, string> = {
  '': 'yi', ㄚ: 'ya', ㄛ: 'yo', ㄝ: 'ye', ㄜ: 'ye',
  ㄞ: 'yai', ㄠ: 'yao', ㄡ: 'you', ㄢ: 'yan', ㄣ: 'yin',
  ㄤ: 'yang', ㄥ: 'ying',
};

const ZHUYIN_WU_ZERO: Record<string, string> = {
  '': 'wu', ㄚ: 'wa', ㄛ: 'wo', ㄜ: 'wo',
  ㄞ: 'wai', ㄟ: 'wei', ㄢ: 'wan', ㄣ: 'wen',
  ㄤ: 'wang', ㄥ: 'weng',
};

const ZHUYIN_YU_ZERO: Record<string, string> = {
  '': 'yu', ㄝ: 'yue', ㄜ: 'yue', ㄢ: 'yuan', ㄣ: 'yun', ㄥ: 'yong',
};

const ZHUYIN_I_FIN: Record<string, string> = {
  '': 'i', ㄚ: 'ia', ㄛ: 'io', ㄝ: 'ie', ㄜ: 'ie',
  ㄠ: 'iao', ㄡ: 'iu', ㄢ: 'ian', ㄣ: 'in',
  ㄤ: 'iang', ㄥ: 'ing',
};

const ZHUYIN_U_FIN: Record<string, string> = {
  '': 'u', ㄚ: 'ua', ㄛ: 'uo', ㄜ: 'uo',
  ㄞ: 'uai', ㄟ: 'ui', ㄢ: 'uan', ㄣ: 'un',
  ㄤ: 'uang', ㄥ: 'ong',
};

const ZHUYIN_V_JQX: Record<string, string> = {
  '': 'u', ㄝ: 'ue', ㄜ: 'ue', ㄢ: 'uan', ㄣ: 'un', ㄥ: 'iong',
};

const ZHUYIN_V_NL: Record<string, string> = {
  '': 'v', ㄝ: 've', ㄜ: 've', ㄢ: 'van', ㄣ: 'vn',
};

const RE_ZHUYIN_RUN = /[\u3105-\u3129\u02CA\u02C7\u02CB\u02D9\u02C9]+/g;
const RE_ZHUYIN_SYL =
  /[˙ˉˊˇˋ]?([ㄅ-ㄙ])([ㄧㄨㄩ])?([ㄚ-ㄦ])?([ˉˊˇˋ˙])?|[˙ˉˊˇˋ]?([ㄧㄨㄩ])([ㄚ-ㄦ])?([ˉˊˇˋ˙])?|[˙ˉˊˇˋ]?([ㄚ-ㄦ])([ˉˊˇˋ˙])?/g;
const RE_BENIGN_SEP = /^[ \t.·\-_:/]$/;
const RE_ASCII_LOWER = /^[a-z0-9]+$/;

// 校验普通话声母与介音合法拼合（例如 ㄏ+ㄧ、ㄐ+ㄨ、ㄓ+ㄩ 均非法，应拆成两音）
function validInitMed(init: string, med: string): boolean {
  if (!init || !med) return true;
  if (med === 'ㄧ') return 'ㄅㄆㄇㄉㄊㄋㄌㄐㄑㄒ'.includes(init);
  if (med === 'ㄩ') return 'ㄋㄌㄐㄑㄒ'.includes(init);
  if (med === 'ㄨ') return !'ㄐㄑㄒ'.includes(init);
  return true;
}

export interface PreparedField {
  raw: string;
  folded: string;
  pys: (string[] | null)[];
}

export interface SearchTerm {
  raw: string;
  folded: string;
  query: string;
  altQuery: string;
  fuzzyQuery: string;
  hasZhuyin: boolean;
  hasLatin: boolean;
  isAsciiAlpha: boolean;
}

export interface ParsedQuery {
  terms: SearchTerm[];
  phrase: SearchTerm | null;
}

export interface FieldMatch {
  tier: 1 | 2 | 3 | 4 | 5;
  quality: number;
  count: number;
  ranges: [number, number][];
}

export interface MatchOptions {
  isBody?: boolean;
  allowTypo?: boolean;
  collectAll?: boolean;
}

/**
 * 逐字折叠：全角→半角（NFKC 后若长度变化如 `…`→`...` 则保留原字）、大写→小写、繁→简。
 * 严格保证 `fold(text).length === text.length`（UTF-16 码元长度不变）。
 */
export function fold(text: string): string {
  const s = String(text || '');
  let out = '';
  for (const ch of s) {
    let mapped = TRAD_TO_SIMP[ch];
    if (!mapped) {
      const nfkc = ch.normalize('NFKC').toLowerCase();
      mapped = nfkc.length === ch.length ? nfkc : ch.toLowerCase();
    }
    out += mapped.length === ch.length ? mapped : ch;
  }
  return out;
}

export function stripQueryDiacritics(text: string): string {
  let out = '';
  for (const ch of text) {
    out += PY_DIACRITICS[ch] ?? ch;
  }
  return out;
}

interface ZhuyinSyllable {
  init: string;
  med: string;
  fin: string;
  tone: string;
}

function syllableToPinyin(s: ZhuyinSyllable, bareMedialInitial: boolean): string {
  const { init, med, fin } = s;
  if (!init) {
    if (med === 'ㄧ') {
      if (!fin && bareMedialInitial) return 'y';
      return ZHUYIN_YI_ZERO[fin] ?? `y${ZHUYIN_BARE_FINAL[fin] ?? ''}`;
    }
    if (med === 'ㄨ') {
      if (!fin && bareMedialInitial) return 'w';
      return ZHUYIN_WU_ZERO[fin] ?? `w${ZHUYIN_BARE_FINAL[fin] ?? ''}`;
    }
    if (med === 'ㄩ') {
      if (!fin && bareMedialInitial) return 'y';
      return ZHUYIN_YU_ZERO[fin] ?? `y${ZHUYIN_BARE_FINAL[fin] ?? ''}`;
    }
    return ZHUYIN_BARE_FINAL[fin] ?? '';
  }

  const pyInit = ZHUYIN_INIT[init] ?? '';
  if (!med && !fin) return pyInit;
  if (!med) return pyInit + (ZHUYIN_BARE_FINAL[fin] ?? '');
  if (med === 'ㄧ') return pyInit + (ZHUYIN_I_FIN[fin] ?? ZHUYIN_BARE_FINAL[fin] ?? '');
  if (med === 'ㄨ') return pyInit + (ZHUYIN_U_FIN[fin] ?? ZHUYIN_BARE_FINAL[fin] ?? '');
  const vMap = pyInit === 'j' || pyInit === 'q' || pyInit === 'x' ? ZHUYIN_V_JQX : ZHUYIN_V_NL;
  return pyInit + (vMap[fin] ?? ZHUYIN_BARE_FINAL[fin] ?? '');
}

function bareLetterInitial(ch: string): string {
  if (ch === 'ㄧ' || ch === 'ㄩ') return 'y';
  if (ch === 'ㄨ') return 'w';
  return ZHUYIN_INIT[ch] ?? ZHUYIN_BARE_FINAL[ch] ?? '';
}

/**
 * 将输入串中的注音符号段（ㄅㄆㄇㄈ）按标准国语规则转为拼音串。
 * - 自动拆分非法声介拼合（如 `ㄏㄧ` -> `hy`）；
 * - 若整段无任何韵母且无声调、并出现纯声母（如 `ㄒㄏㄇㄧ`、`ㄩㄓ`），按逐字声母简拼输出（`xhmy`、`yzh`）。
 */
export function convertZhuyinRuns(input: string): {
  text: string;
  altText: string;
  hasZhuyin: boolean;
} {
  let hasZhuyin = false;
  let hasAlt = false;
  const altRuns: string[] = [];

  const text = input.replace(RE_ZHUYIN_RUN, (run) => {
    const syllables: ZhuyinSyllable[] = [];
    let pos = 0;
    while (pos < run.length) {
      RE_ZHUYIN_SYL.lastIndex = pos;
      const m = RE_ZHUYIN_SYL.exec(run);
      if (!m || m.index !== pos) {
        pos += 1;
        continue;
      }
      if (m[1]) {
        const init = m[1];
        const med = m[2] || '';
        if (med && !validInitMed(init, med)) {
          syllables.push({ init, med: '', fin: '', tone: '' });
          const startMed = run.indexOf(med, pos);
          pos = startMed !== -1 ? startMed : pos + 1;
          continue;
        }
        syllables.push({ init, med, fin: m[3] || '', tone: m[4] || '' });
      } else if (m[5]) {
        syllables.push({ init: '', med: m[5], fin: m[6] || '', tone: m[7] || '' });
      } else if (m[8]) {
        syllables.push({ init: '', med: '', fin: m[8], tone: m[9] || '' });
      }
      pos = RE_ZHUYIN_SYL.lastIndex;
    }
    if (!syllables.length) return '';
    hasZhuyin = true;

    const allNoFinNoTone = syllables.every((s) => !s.fin && !s.tone);
    const letters = run.replace(/[ˉˊˇˋ˙]/g, '');
    let initialsOut = '';
    if (allNoFinNoTone) {
      for (const ch of letters) initialsOut += bareLetterInitial(ch);
    }

    const hasBareInit = syllables.some((s) => !!s.init && !s.med);
    if (allNoFinNoTone && hasBareInit) {
      altRuns.push(initialsOut);
      return initialsOut;
    }

    const primaryOut = syllables.map((s) => syllableToPinyin(s, allNoFinNoTone)).join('');
    if (allNoFinNoTone && initialsOut && initialsOut !== primaryOut) {
      hasAlt = true;
      altRuns.push(initialsOut);
    } else {
      altRuns.push(primaryOut);
    }
    return primaryOut;
  });

  let altText = '';
  if (hasAlt) {
    let idx = 0;
    altText = input.replace(RE_ZHUYIN_RUN, () => altRuns[idx++] ?? '');
  }
  return { text, altText, hasZhuyin };
}

function buildFuzzyQuery(q: string): string {
  return q
    .replace(/([zcs])h(?=[aeiouv])/g, '$1')
    .replace(/l/g, 'n')
    .replace(/v/g, 'u');
}

function makeTerm(rawToken: string): SearchTerm {
  const folded = fold(rawToken);
  const { text: zhConverted, altText, hasZhuyin } = convertZhuyinRuns(folded);
  const query = stripQueryDiacritics(zhConverted).replace(/[ˉˊˇˋ˙]/g, '');
  const altQuery = altText ? stripQueryDiacritics(altText).replace(/[ˉˊˇˋ˙]/g, '') : '';
  return {
    raw: rawToken,
    folded,
    query,
    altQuery,
    fuzzyQuery: buildFuzzyQuery(query),
    hasZhuyin,
    hasLatin: /[a-z]/.test(query),
    isAsciiAlpha: /^[a-z]+$/.test(query),
  };
}

export function parseQuery(rawInput: string): ParsedQuery {
  const tokens = fold(rawInput).split(/\s+/).filter(Boolean);
  const terms = tokens.map(makeTerm);
  let phrase: SearchTerm | null = null;
  if (terms.length >= 2 && terms.every((t) => /^[a-z0-9\u3105-\u3129\u02CA\u02C7\u02CB\u02D9\u02C9]+$/.test(t.folded))) {
    phrase = makeTerm(tokens.join(''));
  }
  return { terms, phrase };
}

export function prepareField(raw: string, pyEncoded = ''): PreparedField {
  const tokens = pyEncoded ? pyEncoded.split(' ') : [];
  const pys: (string[] | null)[] = new Array(raw.length);
  let cursor = 0;

  for (let i = 0; i < raw.length; i++) {
    if (RE_ZH.test(raw[i]) && cursor < tokens.length) {
      const tok = tokens[cursor++];
      pys[i] = tok && tok !== '-' ? tok.split('|') : null;
    } else {
      pys[i] = null;
    }
  }

  return { raw, folded: fold(raw), pys };
}

function fuzzyVariants(py: string): string[] {
  const base = py.replace(/^([zcs])h/, '$1').replace(/^l/, 'n').replace(/v/g, 'u');
  const out = [base];
  if (/(?:an|en|in)g$/.test(base)) {
    out.push(base.slice(0, -1));
  } else if (/(?:an|en|in)$/.test(base)) {
    out.push(`${base}g`);
  }
  return out;
}

interface SeqResult {
  end: number;
  tier: 2 | 3 | 4;
  quality: number;
}

/**
 * 从 field 下标 `start` 起尝试连续匹配拼音/汉字/混输序列 `q`。
 * 优先全音节（首读音 > 多音字备选），其次双字母声母（zh/ch/sh），再单字首字母与尾音节未打完前缀。
 */
function matchSeqAt(
  field: PreparedField,
  start: number,
  qMatch: string,
  fuzzy: boolean,
  hasZhuyin: boolean,
  isBody: boolean,
): SeqResult | null {
  const folded = field.folded;
  const tLen = folded.length;
  const qLen = qMatch.length;
  if (start >= tLen || qLen === 0) return null;

  // 起点不能落在轻量连接符上
  if (RE_BENIGN_SEP.test(folded[start])) return null;

  // 每次最多跨 2 个连接符，匹配跨度严格有界，避免对长正文做 O(N²) 分配
  const maxSpan = Math.min(tLen - start, qLen * 3 + 2);
  const failStates = new Uint8Array((maxSpan + 1) * (qLen + 1));

  function dfs(
    ti: number,
    qi: number,
    fullCnt: number,
    initCnt: number,
    directCnt: number,
    usedSecondary: boolean,
    seps: number,
  ): SeqResult | null {
    if (qi === qLen) {
      if (isBody && !hasZhuyin && fullCnt === 0 && directCnt === 0 && qLen < 3) {
        return null;
      }
      if (fuzzy) {
        return { end: ti, tier: 4, quality: Math.max(0.56, 0.64 - seps * 0.02) };
      }
      if (initCnt === 0) {
        return {
          end: ti,
          tier: 2,
          quality: (usedSecondary ? 0.82 : 0.90) - Math.min(0.06, seps * 0.02),
        };
      }
      return {
        end: ti,
        tier: 3,
        quality: Math.max(0.64, (usedSecondary ? 0.68 : 0.74) - seps * 0.02),
      };
    }

    if (ti >= tLen || ti - start >= maxSpan) return null;

    const stateKey = (ti - start) * (qLen + 1) + qi;
    if (failStates[stateKey]) return null;

    // 跳过字段中连续最多 2 个轻量连接符（如 `Three.js` 中的 `.`、`果冻 2048` 中的空格）
    if (qi > 0 && RE_BENIGN_SEP.test(folded[ti])) {
      let sepEnd = ti;
      while (sepEnd < tLen && sepEnd - ti < 2 && RE_BENIGN_SEP.test(folded[sepEnd])) {
        sepEnd++;
      }
      if (sepEnd < tLen) {
        const res = dfs(sepEnd, qi, fullCnt, initCnt, directCnt, usedSecondary, seps + 1);
        if (res) return res;
      }
    }

    // 1) 原字符直接匹配（中文/英文字母/数字）
    if (folded[ti] === qMatch[qi]) {
      const res = dfs(ti + 1, qi + 1, fullCnt, initCnt, directCnt + 1, usedSecondary, seps);
      if (res) return res;
    }

    // 2) 汉字拼音序列匹配
    const pyList = field.pys[ti];
    if (pyList) {
      const rem = qMatch.slice(qi);

      for (let pi = 0; pi < pyList.length; pi++) {
        const sec = usedSecondary || pi > 0;
        const rawPy = pyList[pi];

        if (!fuzzy) {
          const p = rawPy;
          if (qMatch.startsWith(p, qi)) {
            const res = dfs(ti + 1, qi + p.length, fullCnt + 1, initCnt, directCnt, sec, seps);
            if (res) return res;
          }
          if (p.startsWith('zh') || p.startsWith('ch') || p.startsWith('sh')) {
            if (qi + 2 <= qLen && qMatch.startsWith(p.slice(0, 2), qi)) {
              const res = dfs(ti + 1, qi + 2, fullCnt, initCnt + 1, directCnt, sec, seps);
              if (res) return res;
            }
          }
          if (rem.length >= 1 && rem.length < p.length && p.startsWith(rem)) {
            const nextFull = rem.length >= 2 && p.length <= rem.length + 1 ? fullCnt + 1 : fullCnt;
            const nextInit = nextFull > fullCnt ? initCnt : initCnt + 1;
            const res = dfs(ti + 1, qLen, nextFull, nextInit, directCnt, sec, seps);
            if (res) return res;
          }
          if (qMatch[qi] === p[0]) {
            const res = dfs(ti + 1, qi + 1, fullCnt, initCnt + 1, directCnt, sec, seps);
            if (res) return res;
          }
        } else {
          const candidates = fuzzyVariants(rawPy);
          for (let ci = 0; ci < candidates.length; ci++) {
            const p = candidates[ci];
            if (qMatch.startsWith(p, qi)) {
              const res = dfs(ti + 1, qi + p.length, fullCnt + 1, initCnt, directCnt, sec, seps);
              if (res) return res;
            }
            if (rem.length >= 1 && rem.length < p.length && p.startsWith(rem)) {
              const nextFull = rem.length >= 2 && p.length <= rem.length + 1 ? fullCnt + 1 : fullCnt;
              const nextInit = nextFull > fullCnt ? initCnt : initCnt + 1;
              const res = dfs(ti + 1, qLen, nextFull, nextInit, directCnt, sec, seps);
              if (res) return res;
            }
            if (qMatch[qi] === p[0]) {
              const res = dfs(ti + 1, qi + 1, fullCnt, initCnt + 1, directCnt, sec, seps);
              if (res) return res;
            }
          }
        }
      }
    }

    failStates[stateKey] = 1;
    return null;
  }

  return dfs(start, 0, 0, 0, 0, false, 0);
}

function canStartSeqAt(
  folded: string,
  pys: (string[] | null)[],
  idx: number,
  q0: string,
  fuzzy: boolean,
): boolean {
  if (folded[idx] === q0) return true;
  const pyList = pys[idx];
  if (!pyList) return false;
  for (let pi = 0; pi < pyList.length; pi++) {
    const p0 = pyList[pi][0];
    if (p0 === q0 || (fuzzy && q0 === 'n' && p0 === 'l')) return true;
  }
  return false;
}

// 最优字符串对齐（Damerau-Levenshtein，含相邻换位=1），限制在 maxDist 以内快速剪枝
function damerauDistance(a: string, b: string, maxDist: number): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > maxDist) return maxDist + 1;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevPrev = new Array<number>(n + 1);
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ai = a[i - 1];
    for (let j = 1; j <= n; j++) {
      const bj = b[j - 1];
      const cost = ai === bj ? 0 : 1;
      let val = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && ai === b[j - 2] && a[i - 2] === bj) {
        val = Math.min(val, prevPrev[j - 2] + 1);
      }
      curr[j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
    const tmp = prevPrev;
    prevPrev = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[n];
}

function matchTypo(field: PreparedField, q: string, hasZhuyin: boolean): FieldMatch | null {
  if (hasZhuyin || q.length < 4 || !RE_ASCII_LOWER.test(q)) return null;
  const maxDist = q.length >= 8 ? 2 : 1;

  let bestDist = maxDist + 1;
  let bestRange: [number, number] | null = null;

  // A) 检查英文/数字词 token（包括去连字符/点形态，如 Three.js -> threejs）
  const wordRe = /[a-z0-9][a-z0-9._-]*/g;
  let wm: RegExpExecArray | null;
  while ((wm = wordRe.exec(field.folded)) !== null) {
    const rawWord = wm[0];
    const cleanWord = rawWord.replace(/[._-]+/g, '');
    for (const candidate of cleanWord !== rawWord ? [rawWord, cleanWord] : [rawWord]) {
      if (Math.abs(candidate.length - q.length) <= maxDist) {
        const d = damerauDistance(q, candidate, Math.min(maxDist, bestDist - 1));
        if (d < bestDist) {
          bestDist = d;
          bestRange = [wm.index, wm.index + rawWord.length];
        }
      }
      // 也检查长英文词前段（如 elasticsearch 前缀误拼）
      if (candidate.length > q.length + 1) {
        const pref = candidate.slice(0, q.length);
        const d = damerauDistance(q, pref, Math.min(maxDist, bestDist - 1));
        if (d < bestDist) {
          bestDist = d;
          bestRange = [wm.index, wm.index + rawWord.length];
        }
      }
    }
  }

  // B) 检查连续多字汉字主读音拼串的编辑距离（如 nuono -> 诺诺, xinghiamanyou -> 星海漫游），
  // 限制 >= 5 字符且至少跨 2 个汉字，避免单字音节（如 meng）误匹配到 ming/mang 等 unrelated 单字
  if (q.length >= 5) {
    const len = field.pys.length;
    for (let i = 0; i < len; i++) {
      if (!field.pys[i]) continue;
      let concat = '';
      for (let j = i; j < len; j++) {
        const pList = field.pys[j];
        if (!pList) break;
        concat += pList[0];
        if (j === i) continue;
        if (concat.length < q.length - maxDist) continue;
        if (concat.length > q.length + maxDist) break;
        // 至少首字母或次字母之一相近，避免无关短词误伤
        if (concat[0] !== q[0] && (concat[1] ?? '') !== (q[1] ?? '') && concat[0] !== q[1]) continue;
        const d = damerauDistance(q, concat, Math.min(maxDist, bestDist - 1));
        if (d < bestDist) {
          bestDist = d;
          bestRange = [i, j + 1];
        }
      }
    }
  }

  if (!bestRange) return null;
  return {
    tier: 5,
    quality: bestDist === 1 ? 0.50 : 0.44,
    count: 1,
    ranges: [bestRange],
  };
}

export function mergeRanges(ranges: [number, number][]): [number, number][] {
  if (ranges.length <= 1) return ranges.slice();
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr[0] <= prev[1]) {
      if (curr[1] > prev[1]) prev[1] = curr[1];
    } else {
      merged.push([curr[0], curr[1]]);
    }
  }
  return merged;
}

/**
 * 统一 5 层匹配入口：
 * 1) 精确/全半角/繁简子串
 * 2) 严格全拼/注音全拼（含上下文多音字）
 * 3) 严格首字母/中拼混输/后缀未打完前缀
 * 4) 模糊音（平翘舌/前后鼻音/n-l/v-u）
 * 5) 轻量拼写纠错（仅非正文短字段，Damerau-Levenshtein）
 */
export function matchField(
  field: PreparedField,
  term: SearchTerm,
  opts: MatchOptions = {},
): FieldMatch | null {
  const isBody = !!opts.isBody;
  const allowTypo = !!opts.allowTypo && !isBody;
  const collectAll = !!opts.collectAll;

  // Tier 1: 直接子串匹配（含繁简 & 全半角折叠）
  const directTerm = term.folded;
  if (directTerm) {
    const ranges: [number, number][] = [];
    let from = 0;
    let at: number;
    const limit = collectAll ? (isBody ? 5 : 20) : 1;
    while (ranges.length < limit && (at = field.folded.indexOf(directTerm, from)) !== -1) {
      ranges.push([at, at + directTerm.length]);
      from = at + directTerm.length;
    }
    if (ranges.length > 0) {
      return {
        tier: 1,
        quality: 1.0,
        count: collectAll ? Math.min(5, ranges.length) : 1,
        ranges: mergeRanges(ranges),
      };
    }
  }

  // 纯字母单字符不做跨全文拼音爆发匹配，至少 2 个字符才进序列/模糊推断（纯汉字如带分隔符 `果冻2048` / `爱因斯坦罗森桥` 只走严格序列不走声韵母模糊）
  const queries = term.altQuery && term.altQuery !== term.query ? [term.query, term.altQuery] : [term.query];
  const maxHits = collectAll ? (isBody ? 5 : 16) : 1;
  const allowPhoneticFuzzy = term.hasLatin || term.hasZhuyin;

  const folded = field.folded;
  const pys = field.pys;
  const fLen = folded.length;

  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    if (q.length < 2) continue;

    // Tier 2 & Tier 3: 严格拼音/注音/首字母/跨轻分隔符序列匹配
    const strictRanges: [number, number][] = [];
    let bestTier: 2 | 3 = 3;
    let bestQuality = 0;
    const q0 = q[0];

    for (let i = 0; i < fLen; i++) {
      if (!canStartSeqAt(folded, pys, i, q0, false)) continue;
      const m = matchSeqAt(field, i, q, false, term.hasZhuyin, isBody);
      if (m) {
        strictRanges.push([i, m.end]);
        if (m.tier < bestTier || m.quality > bestQuality) {
          bestTier = m.tier as 2 | 3;
          bestQuality = Math.max(bestQuality, m.quality);
        } else {
          bestQuality = Math.max(bestQuality, m.quality);
        }
        if (!collectAll || strictRanges.length >= maxHits) break;
        i = Math.max(i, m.end - 1);
      }
    }
    if (strictRanges.length > 0) {
      return {
        tier: bestTier,
        quality: bestQuality,
        count: Math.min(5, strictRanges.length),
        ranges: mergeRanges(strictRanges),
      };
    }

    if (!allowPhoneticFuzzy) continue;

    // Tier 4: 模糊音匹配（z/zh, c/ch, s/sh, n/l, in/ing, en/eng, an/ang, v/u）
    const qFuzzy = qi === 0 ? term.fuzzyQuery : buildFuzzyQuery(q);
    if (qFuzzy.length < 2) continue;
    const qf0 = qFuzzy[0];
    const fuzzyRanges: [number, number][] = [];
    let fuzzyQuality = 0;
    for (let i = 0; i < fLen; i++) {
      if (!canStartSeqAt(folded, pys, i, qf0, true)) continue;
      const m = matchSeqAt(field, i, qFuzzy, true, term.hasZhuyin, isBody);
      if (m) {
        fuzzyRanges.push([i, m.end]);
        fuzzyQuality = Math.max(fuzzyQuality, m.quality);
        if (!collectAll || fuzzyRanges.length >= maxHits) break;
        i = Math.max(i, m.end - 1);
      }
    }
    if (fuzzyRanges.length > 0) {
      return {
        tier: 4,
        quality: fuzzyQuality,
        count: Math.min(5, fuzzyRanges.length),
        ranges: mergeRanges(fuzzyRanges),
      };
    }
  }

  // Tier 5: 拼写微错推断（仅限标题/标签/摘要，>= 4 字符）
  if (allowTypo) {
    return matchTypo(field, term.query, term.hasZhuyin);
  }

  return null;
}

export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function highlightRanges(raw: string, ranges: [number, number][]): string {
  if (!ranges.length) return escapeHtml(raw);
  const merged = mergeRanges(ranges);
  let html = '';
  let cursor = 0;
  for (let i = 0; i < merged.length; i++) {
    const [rawStart, rawEnd] = merged[i];
    const start = Math.max(cursor, rawStart);
    if (rawEnd <= start) continue;
    html +=
      escapeHtml(raw.slice(cursor, start)) +
      '<mark>' +
      escapeHtml(raw.slice(start, rawEnd)) +
      '</mark>';
    cursor = rawEnd;
  }
  return html + escapeHtml(raw.slice(cursor));
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * 在正文命中的位置截取一小段摘要，并把命中区间换算到片段坐标系用于 <mark> 高亮。
 */
export function extractSnippet(
  field: PreparedField,
  terms: SearchTerm[],
  phrase: SearchTerm | null = null,
): { text: string; ranges: [number, number][] } | null {
  const allMatches: [number, number][] = [];
  let anchor: [number, number] | null = null;

  if (phrase) {
    const pm = matchField(field, phrase, { isBody: true, allowTypo: false, collectAll: true });
    if (pm && pm.ranges.length > 0) {
      anchor = pm.ranges[0];
      allMatches.push(...pm.ranges);
    }
  }

  for (const t of terms) {
    const tm = matchField(field, t, { isBody: true, allowTypo: false, collectAll: true });
    if (tm && tm.ranges.length > 0) {
      if (!anchor || tm.ranges[0][0] < anchor[0]) {
        anchor = tm.ranges[0];
      }
      allMatches.push(...tm.ranges);
    }
  }

  if (!anchor) return null;

  const raw = field.raw;
  let begin = Math.max(0, anchor[0] - 36);
  let end = Math.min(raw.length, Math.max(anchor[1] + 72, anchor[0] + 84));
  if (begin > 0 && isLowSurrogate(raw.charCodeAt(begin))) begin += 1;
  if (end < raw.length && isLowSurrogate(raw.charCodeAt(end))) end -= 1;

  const prefix = begin > 0 ? '…' : '';
  const suffix = end < raw.length ? '…' : '';
  const slice = raw.slice(begin, end);
  const offset = prefix.length - begin;

  const localRanges: [number, number][] = [];
  for (const [s, e] of allMatches) {
    if (e <= begin || s >= end) continue;
    localRanges.push([Math.max(begin, s) + offset, Math.min(end, e) + offset]);
  }

  return {
    text: prefix + slice + suffix,
    ranges: mergeRanges(localRanges),
  };
}
