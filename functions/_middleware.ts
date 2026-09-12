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

// 分类改名前发出去的链接要继续可用。
// 放在闸门校验之前：重定向不涉及内容，没必要先过 Turnstile
const RENAMED = [
  ['/article', '/project'],
  ['/info', '/tool'],
] as const;

function renamedTarget(pathname: string): string | null {
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
