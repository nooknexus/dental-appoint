import { config } from '../config.js';
import { isValidCid } from './mophAlert.js';
import { decodeJwtPayload } from './mophHealthId.js';

const requestTimeoutMs = 30_000;
const discoveryCacheTtlMs = 3_600_000;

/** hop ระบุขั้นที่พัง (discovery / token / identity) เพื่อ log โดยไม่แตะ token หรือเลขบัตร */
export class ThaidAuthError extends Error {
  constructor(public readonly hop: string, message: string) {
    super(`[${hop}] ${message}`);
  }
}

type Discovery = { authorizationEndpoint: string; tokenEndpoint: string; userinfoEndpoint: string | null };
let discoveryCache: { value: Discovery; fetchedAt: number } | null = null;

export function resetThaidDiscoveryCache() { discoveryCache = null; }

/** อ่าน OIDC well-known ของ ThaiID (cache ในหน่วยความจำ 1 ชั่วโมง — discovery ไม่ควรยิงทุก login) */
async function fetchDiscovery(fetcher: typeof fetch): Promise<Discovery> {
  if (discoveryCache && Date.now() - discoveryCache.fetchedAt < discoveryCacheTtlMs) return discoveryCache.value;
  const response = await fetcher(config.thaidWellKnownUrl, { signal: AbortSignal.timeout(requestTimeoutMs) });
  const body = await response.json() as Record<string, string>;
  if (!response.ok || !body.authorization_endpoint || !body.token_endpoint) {
    throw new ThaidAuthError('discovery', `discovery failed (HTTP ${response.status})`);
  }
  const value: Discovery = {
    authorizationEndpoint: body.authorization_endpoint,
    tokenEndpoint: body.token_endpoint,
    userinfoEndpoint: body.userinfo_endpoint ?? null,
  };
  discoveryCache = { value, fetchedAt: Date.now() };
  return value;
}

/** Step 1 — URL หน้ายืนยันตัวตน ThaiID จาก authorization_endpoint ที่ค้นพบ */
export async function buildThaidAuthorizeUrl(state: string, fetcher: typeof fetch = fetch) {
  const discovery = await fetchDiscovery(fetcher);
  const params = new URLSearchParams({
    client_id: config.thaidClientId,
    redirect_uri: config.thaidRedirectUri,
    response_type: 'code',
    scope: config.thaidScope,
    state,
  });
  return `${discovery.authorizationEndpoint}?${params.toString()}`;
}

type ThaidTokenResponse = { access_token?: string; id_token?: string; error?: string; error_description?: string };

/** Step 2 — แลก authorization code เป็น access_token + id_token (form-encoded ตาม OIDC) */
export async function exchangeThaidCode(code: string, fetcher: typeof fetch = fetch) {
  const discovery = await fetchDiscovery(fetcher);
  const response = await fetcher(discovery.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.thaidClientId,
      client_secret: config.thaidClientSecret,
      redirect_uri: config.thaidRedirectUri,
    }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const body = await response.json() as ThaidTokenResponse;
  if (!response.ok || !body.access_token) {
    throw new ThaidAuthError('token', body.error_description ?? body.error ?? `token exchange failed (HTTP ${response.status})`);
  }
  return { accessToken: body.access_token, idToken: body.id_token };
}

export type ThaidIdentity = { cid: string; displayName: string };

async function fetchUserinfoClaims(accessToken: string, userinfoEndpoint: string, fetcher: typeof fetch): Promise<{ status: number; claims: Record<string, unknown> | null }> {
  try {
    const response = await fetcher(userinfoEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) return { status: response.status, claims: null };
    return { status: response.status, claims: await response.json() as Record<string, unknown> };
  } catch {
    return { status: 0, claims: null };
  }
}

/** introspect endpoint ไม่ปรากฏใน discovery ของ DOPA — ETDA sample อ้าง path นี้โดยตรง (origin เดียวกับ well-known) */
const thaidIntrospectPath = '/api/v2/oauth2/introspect/';

/** ตรวจ token กับ DOPA แบบ RFC 7662 (Basic auth) — ทางเลือกเมื่อไม่มี openid scope จึงไม่ได้ id_token
 *  และ userinfo ปฏิเสธ token ที่ไม่ได้ออกจาก openid flow ด้วย 400 */
async function fetchIntrospectClaims(accessToken: string, fetcher: typeof fetch): Promise<{ status: number; claims: Record<string, unknown> | null }> {
  const origin = new URL(config.thaidWellKnownUrl).origin;
  try {
    const response = await fetcher(`${origin}${thaidIntrospectPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.thaidClientId}:${config.thaidClientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token: accessToken }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) return { status: response.status, claims: null };
    return { status: response.status, claims: await response.json() as Record<string, unknown> };
  } catch {
    return { status: 0, claims: null };
  }
}

/** รวม step 2+3: ได้ identity ผู้ป่วยจาก ThaiID (ห้าม log ค่าที่คืน)
 *  ลำดับอ่าน claims: id_token → userinfo → introspect (introspect จำเป็นเมื่อ client ไม่ได้ขอ openid scope) */
export async function getThaidIdentity(tokens: { accessToken: string; idToken?: string }, fetcher: typeof fetch = fetch): Promise<ThaidIdentity> {
  const claimSources: Record<string, unknown>[] = [];
  const sourceLabels: string[] = [];
  if (tokens.idToken) {
    try {
      claimSources.push(decodeJwtPayload<Record<string, unknown>>(tokens.idToken));
      sourceLabels.push('id_token');
    } catch { /* id_token พัง — ลองจาก userinfo ต่อ */ }
  }
  const discovery = await fetchDiscovery(fetcher);
  let userinfoStatus = 0;
  if (discovery.userinfoEndpoint) {
    const userinfo = await fetchUserinfoClaims(tokens.accessToken, discovery.userinfoEndpoint, fetcher);
    userinfoStatus = userinfo.status;
    if (userinfo.claims) {
      claimSources.push(userinfo.claims);
      sourceLabels.push('userinfo');
    }
  }
  let introspectStatus = 0;
  if (claimSources.length === 0) {
    const introspect = await fetchIntrospectClaims(tokens.accessToken, fetcher);
    introspectStatus = introspect.status;
    if (introspect.claims) {
      claimSources.push(introspect.claims);
      sourceLabels.push('introspect');
    }
  }
  for (const [index, claims] of claimSources.entries()) {
    const source = sourceLabels[index];
    // introspect ของ DOPA ตอบแค่ active/scope/sub โดย sub คือเลขบัตร 13 หลักของผู้ใช้ (ไม่มี pid/name ให้)
    const subCandidate = source === 'introspect' ? String(claims.sub ?? '') : '';
    const cid = String(claims.pid ?? (isValidCid(subCandidate) ? subCandidate : ''));
    if (!isValidCid(cid)) continue;
    const displayName = String(claims.name ?? claims.name_en ?? '').trim() || 'ผู้ใช้ ThaiID';
    return { cid, displayName };
  }
  throw new ThaidAuthError('identity', 'could not resolve a 13-digit pid from ThaiID');
}
