import {
  COOKIE_NAME,
  isBypassedPath,
  readCookie,
  verifyGateCookie,
} from './_lib/gate';

interface Env {
  TURNSTILE_SECRET_KEY?: string;
  GATE_COOKIE_SECRET?: string;
}

// 分类改名、文章换分类之前发出去的链接要继续可用。
// 放在闸门校验之前：重定向不涉及内容，没必要先过 Turnstile。
// 请求里的中文路径是百分号编码过的，所以单篇文章的映射要 encodeURI
const RENAMED: ReadonlyArray<readonly [string, string]> = [
  ['/article', '/project'],
  ['/info', '/tool'],
  [encodeURI('/daily/日常随笔-人生没有标准答案'), encodeURI('/explore/人生没有标准答案')],
  [
    encodeURI('/daily/日常随笔-在算法的荒原上，做一只看月亮的鸟'),
    encodeURI('/explore/在算法的荒原上，做一只看月亮的鸟'),
  ],
];

// 标签总览以前分页，现在一页放下了，老的分页地址统一回到总览
const RETIRED_TAG_PAGES = /^\/tags\/page\/\d+\/?$/;

function renamedTarget(pathname: string): string | null {
  if (RETIRED_TAG_PAGES.test(pathname)) return '/tags/';
  for (const [from, to] of RENAMED) {
    if (pathname === from || pathname === `${from}/`) return `${to}/`;
    if (pathname.startsWith(`${from}/`)) return to + pathname.slice(from.length);
  }
  return null;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context;
  const url = new URL(request.url);

  const moved = renamedTarget(url.pathname);
  if (moved) {
    const target = new URL(moved, url);
    target.search = url.search;
    return Response.redirect(target.toString(), 301);
  }

  // 未配置密钥时不拦，避免锁死站点
  if (!env.TURNSTILE_SECRET_KEY || !env.GATE_COOKIE_SECRET) {
    return next();
  }

  if (isBypassedPath(url.pathname)) {
    return next();
  }

  const raw = readCookie(request.headers.get('Cookie'), COOKIE_NAME);
  if (await verifyGateCookie(env.GATE_COOKIE_SECRET, raw)) {
    return next();
  }

  const gate = new URL('/gate/', url);
  gate.searchParams.set('next', `${url.pathname}${url.search}`);
  return Response.redirect(gate.toString(), 302);
};
