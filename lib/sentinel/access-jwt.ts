/**
 * Cloudflare Access token verification.
 *
 * Cloudflare Access sits in front of the Worker and adds a signed JWT
 * (`Cf-Access-Jwt-Assertion`) to every request it lets through. The header
 * alone proves nothing: anyone can send it if the Worker is reachable another
 * way (e.g. a workers.dev URL). So the signature, issuer, audience and expiry
 * are all checked here against the team's published signing keys.
 *
 * Pure WebCrypto, no Worker-specific imports, so it can be unit tested in Node.
 */

export type AccessConfig = { teamDomain: string; audience: string };
export type AccessClaims = { email: string; sub: string; iss: string; aud: string[]; exp: number; iat?: number; nbf?: number; type?: string };
export type AccessResult = { ok: true; claims: AccessClaims } | { ok: false; reason: string };
type Jwk = JsonWebKey & { kid?: string };
export type JwksFetcher = (url: string) => Promise<{ keys: Jwk[] }>;

const CLOCK_SKEW_SECONDS = 60;
const JWKS_TTL_MS = 10 * 60 * 1000;

/** Accepts "team", "team.cloudflareaccess.com" or "https://team.cloudflareaccess.com/". */
export function normalizeTeamDomain(value: string): string | null {
  const v = value.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/+$/, '');
  const host = v.includes('.') ? v : `${v}.cloudflareaccess.com`;
  return /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(host) ? host : null;
}

function b64urlBytes(part: string): Uint8Array<ArrayBuffer> {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type JwtHeader = { alg?: unknown; kid?: unknown };
type JwtClaims = { iss?: unknown; aud?: unknown; exp?: unknown; nbf?: unknown; iat?: unknown; type?: unknown; email?: unknown; sub?: unknown };

function b64urlJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(part)));
}

const cache = new Map<string, { at: number; keys: Jwk[] }>();

/** Test hook: clears the in-memory signing-key cache. */
export function clearAccessKeyCache() { cache.clear(); }

const defaultFetcher: JwksFetcher = async url => {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Access signing keys unavailable (HTTP ${response.status})`);
  return response.json() as Promise<{ keys: Jwk[] }>;
};

async function keysFor(host: string, fetcher: JwksFetcher, force: boolean, nowMs: number): Promise<Jwk[]> {
  const hit = cache.get(host);
  if (hit && !force && nowMs - hit.at < JWKS_TTL_MS) return hit.keys;
  const body = await fetcher(`https://${host}/cdn-cgi/access/certs`);
  if (!body || !Array.isArray(body.keys)) throw new Error('Access signing keys response invalid');
  cache.set(host, { at: nowMs, keys: body.keys });
  return body.keys;
}

export async function verifyAccessJwt(
  token: string | null | undefined,
  config: AccessConfig,
  options: { nowMs?: number; fetcher?: JwksFetcher } = {},
): Promise<AccessResult> {
  const nowMs = options.nowMs ?? Date.now();
  const fetcher = options.fetcher ?? defaultFetcher;
  const host = normalizeTeamDomain(config.teamDomain || '');
  if (!host) return { ok: false, reason: 'Access team domain is not configured correctly.' };
  if (!config.audience) return { ok: false, reason: 'Access audience is not configured.' };
  if (!token) return { ok: false, reason: 'No Access token on the request.' };

  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, reason: 'Malformed token.' };

  let header: JwtHeader, claims: JwtClaims;
  try { header = b64urlJson<JwtHeader>(parts[0]); claims = b64urlJson<JwtClaims>(parts[1]); } catch { return { ok: false, reason: 'Malformed token.' }; }
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string') return { ok: false, reason: 'Unsupported token algorithm.' };

  let keys: Jwk[];
  try {
    keys = await keysFor(host, fetcher, false, nowMs);
    if (!keys.some(k => k.kid === header.kid)) keys = await keysFor(host, fetcher, true, nowMs);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Access signing keys unavailable.' };
  }
  const jwk = keys.find(k => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) return { ok: false, reason: 'Token signed by an unknown key.' };

  let valid = false;
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return { ok: false, reason: 'Token signature could not be checked.' };
  }
  if (!valid) return { ok: false, reason: 'Token signature is invalid.' };

  const now = Math.floor(nowMs / 1000);
  const aud = Array.isArray(claims?.aud) ? claims.aud : typeof claims?.aud === 'string' ? [claims.aud] : [];
  if (claims?.iss !== `https://${host}`) return { ok: false, reason: 'Token issuer does not match the team domain.' };
  if (!aud.includes(config.audience)) return { ok: false, reason: 'Token is for a different Access application.' };
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < now) return { ok: false, reason: 'Token has expired.' };
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > now) return { ok: false, reason: 'Token is not valid yet.' };
  if (claims.type !== undefined && claims.type !== 'app') return { ok: false, reason: 'Token is not an application token.' };
  if (typeof claims.email !== 'string' || !claims.email.includes('@')) return { ok: false, reason: 'Token carries no user email.' };

  return { ok: true, claims: { email: claims.email, sub: String(claims.sub ?? ''), iss: String(claims.iss), aud: aud.map(String), exp: claims.exp, iat: typeof claims.iat === 'number' ? claims.iat : undefined, nbf: typeof claims.nbf === 'number' ? claims.nbf : undefined, type: typeof claims.type === 'string' ? claims.type : undefined } };
}
