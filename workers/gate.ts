import {
  COOKIE_MAX_AGE,
  COOKIE_NAME,
  buildSetCookie,
  isBypassedPath,
  readCookie,
  signGateValue,
  verifyGateCookie,
} from '../shared/gate';

export interface Env {
  ASSETS: Fetcher;
  TURNSTILE_SECRET_KEY?: string;
  GATE_COOKIE_SECRET?: string;
}

async function handleTurnstileVerify(request: Request, env: Env): Promise<Response> {
  if (!env.TURNSTILE_SECRET_KEY || !env.GATE_COOKIE_SECRET) {
    return Response.json({ ok: false, error: 'gate_not_configured' }, { status: 503 });
  }

  let token = '';
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = (await request.json()) as { token?: string };
    token = body.token?.trim() || '';
  } else {
    const form = await request.formData();
    token = String(form.get('token') || form.get('cf-turnstile-response') || '').trim();
  }

  if (!token) {
    return Response.json({ ok: false, error: 'missing_token' }, { status: 400 });
  }

  const ip = request.headers.get('CF-Connecting-IP') || undefined;
  const verifyBody = new URLSearchParams();
  verifyBody.set('secret', env.TURNSTILE_SECRET_KEY);
  verifyBody.set('response', token);
  if (ip) verifyBody.set('remoteip', ip);

  const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: verifyBody,
  });
  const verifyJson = (await verifyRes.json()) as { success?: boolean };

  if (!verifyJson.success) {
    return Response.json({ ok: false, error: 'turnstile_failed' }, { status: 403 });
  }

  const expiresAt = Date.now() + COOKIE_MAX_AGE * 1000;
  const signed = await signGateValue(env.GATE_COOKIE_SECRET, expiresAt);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': buildSetCookie(signed, COOKIE_MAX_AGE),
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/turnstile-verify' || url.pathname === '/api/turnstile-verify/') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      return handleTurnstileVerify(request, env);
    }

    // 密钥未配齐时不拦截，避免锁死站点
    if (!env.TURNSTILE_SECRET_KEY || !env.GATE_COOKIE_SECRET) {
      return env.ASSETS.fetch(request);
    }

    if (isBypassedPath(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    const raw = readCookie(request.headers.get('Cookie'), COOKIE_NAME);
    if (await verifyGateCookie(env.GATE_COOKIE_SECRET, raw)) {
      return env.ASSETS.fetch(request);
    }

    const gate = new URL('/gate/', url);
    gate.searchParams.set('next', `${url.pathname}${url.search}`);
    return Response.redirect(gate.toString(), 302);
  },
};
