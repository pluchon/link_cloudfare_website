/** Shared gate cookie helpers */

export const COOKIE_NAME = 'nn_gate';
export const COOKIE_MAX_AGE = 60 * 60 * 24; // 24h

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signGateValue(secret: string, expiresAt: number): Promise<string> {
  const payload = String(expiresAt);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${toHex(sig)}`;
}

export async function verifyGateCookie(secret: string, raw: string | undefined): Promise<boolean> {
  if (!raw) return false;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return false;
  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const expected = await signGateValue(secret, expiresAt);
  const expectedSig = expected.split('.')[1];
  if (expectedSig.length !== sig.length) return false;

  let diff = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    diff |= expectedSig.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export function buildSetCookie(value: string, maxAge = COOKIE_MAX_AGE): string {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

export function isBypassedPath(pathname: string): boolean {
  return (
    pathname === '/gate' ||
    pathname === '/gate/' ||
    pathname.startsWith('/api/turnstile-verify') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt'
  );
}
