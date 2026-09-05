import { COOKIE_NAME, readCookie, verifyGateCookie } from './_lib/gate';

interface Env {
  TURNSTILE_SECRET_KEY?: string;
  GATE_COOKIE_SECRET?: string;
}

function isBypassedPath(pathname: string): boolean {
  return (
    pathname === '/gate' ||
    pathname === '/gate/' ||
    pathname.startsWith('/api/turnstile-verify') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt'
  );
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // 未配置密钥时不拦（本地 / 未启用）
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

  const nextPath = `${url.pathname}${url.search}`;
  const gate = new URL('/gate/', url);
  gate.searchParams.set('next', nextPath);
  return Response.redirect(gate.toString(), 302);
};
