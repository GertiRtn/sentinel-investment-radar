import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { getChatGPTUser } from './chatgpt-auth';
import { verifyAccessJwt } from '@/lib/sentinel/access-jwt';

/**
 * One place that decides who the caller is.
 *
 * - Own Cloudflare account (`SENTINEL_HOST=cloudflare`, set in deploy/cloudflare/wrangler.jsonc):
 *   only a verified Cloudflare Access token for the configured owner email is
 *   accepted. ChatGPT `oai-authenticated-*` headers are ignored, because on this
 *   host anyone could send them. Missing configuration fails closed.
 * - Anywhere else (ChatGPT Sites, and the existing test harness): the Sites
 *   platform headers, exactly as before.
 *
 * The owner id stored on records stays the same across hosts:
 * `SENTINEL_OWNER_ID` is set to the id the existing data was written under,
 * so no record has to be rewritten (the immutability triggers would refuse).
 */

export type SentinelUser = { userId: string; email: string; displayName: string; fullName: string | null };

type AuthEnv = {
  SENTINEL_HOST?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  SENTINEL_OWNER_EMAIL?: string;
  SENTINEL_OWNER_ID?: string;
};

const ACCESS_HEADER = 'cf-access-jwt-assertion';

function authEnv(): AuthEnv { return env as unknown as AuthEnv; }

export function onOwnCloudflare(): boolean { return authEnv().SENTINEL_HOST === 'cloudflare'; }

/** Owner configuration for the own-Cloudflare host, or null if incomplete. */
export function ownerConfig(): { ownerId: string; ownerEmail: string } | null {
  const e = authEnv();
  const ownerId = e.SENTINEL_OWNER_ID?.trim(), ownerEmail = e.SENTINEL_OWNER_EMAIL?.trim().toLowerCase();
  return ownerId && ownerEmail ? { ownerId, ownerEmail } : null;
}

/** Resolve the caller from an Access token value. Exported for tests. */
export async function userFromAccessToken(token: string | null): Promise<SentinelUser | null> {
  const e = authEnv(), owner = ownerConfig();
  if (!owner || !e.CF_ACCESS_TEAM_DOMAIN || !e.CF_ACCESS_AUD) {
    console.error('Sentinel auth: Cloudflare Access is not fully configured; refusing all requests.');
    return null;
  }
  const result = await verifyAccessJwt(token, { teamDomain: e.CF_ACCESS_TEAM_DOMAIN, audience: e.CF_ACCESS_AUD });
  if (!result.ok) return null;
  if (result.claims.email.toLowerCase() !== owner.ownerEmail) return null;
  return { userId: owner.ownerId, email: result.claims.email, displayName: result.claims.email, fullName: null };
}

/** The signed-in user for the current request, or null. */
export async function getUser(): Promise<SentinelUser | null> {
  if (onOwnCloudflare()) return userFromAccessToken((await headers()).get(ACCESS_HEADER));
  const user = await getChatGPTUser();
  return user ? { userId: user.userId, email: user.email, displayName: user.displayName ?? user.email, fullName: user.fullName ?? null } : null;
}

/**
 * Caller of the MCP endpoint (used by the ChatGPT scheduled task on Sites).
 * On the own-Cloudflare host the endpoint requires the same Access token as
 * the app; scheduled work runs through Cron Triggers instead.
 */
export async function mcpCaller(request: Request): Promise<{ owner: string; email: string | null } | null> {
  if (onOwnCloudflare()) {
    const user = await userFromAccessToken(request.headers.get(ACCESS_HEADER));
    return user ? { owner: user.userId, email: user.email } : null;
  }
  const owner = request.headers.get('oai-authenticated-user-id');
  return owner ? { owner, email: request.headers.get('oai-authenticated-user-email') } : null;
}
