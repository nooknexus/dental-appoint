import { randomBytes, timingSafeEqual } from 'node:crypto';

import { config } from '../config.js';
import { isValidCid } from './mophAlert.js';

const requestTimeoutMs = 30_000;

/** hop ระบุว่าพังที่ขั้นไหน (token / identity / accounts) เพื่อ log โดยไม่ต้องแตะ token หรือเลขบัตร */
export class MophAuthError extends Error {
  constructor(public readonly hop: string, message: string) {
    super(`[${hop}] ${message}`);
  }
}

export function newOauthNonce() { return randomBytes(32).toString('base64url'); }

/** เทียบ nonce/state แบบ timing-safe — ต้องมีทั้งคู่จึงผ่าน */
export function noncesMatch(received: string | undefined, expected: string | null | undefined) {
  if (!received || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Step 1 — URL หน้ายืนยันตัวตนของ moph.id.th (state ไม่ได้อยู่ในเอกสาร แต่ส่งไปและตรวจกลับถ้าถูก echo) */
export function buildAuthorizeUrl(state: string) {
  const params = new URLSearchParams({
    client_id: config.mophClientId,
    redirect_uri: config.mophRedirectUri,
    scope: config.mophLoginScope,
    response_type: 'code',
    is_auth: 'yes',
    state,
  });
  return `${config.mophHealthIdBaseUrl}/oauth/redirect?${params.toString()}`;
}

type HealthIdTokenResponse = { status?: unknown; data?: { access_token?: string }; message?: string };

/** Step 2 — แลก authorization code เป็น HealthID access token (form-encoded, ความสำเร็จคือ string "success") */
export async function exchangeCodeForCitizenToken(code: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`${config.mophHealthIdBaseUrl}/api/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.mophClientId,
      client_secret: config.mophClientSecret,
      redirect_uri: config.mophRedirectUri,
    }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const body = await response.json() as HealthIdTokenResponse;
  if (!response.ok || body?.status !== 'success' || !body.data?.access_token) {
    throw new MophAuthError('token', `request rejected (HTTP ${response.status})`);
  }
  return String(body.data.access_token);
}

/** decode payload ของ JWT โดยไม่ตรวจลายเซ็น — ใช้อ่าน exp/ข้อมูลแสดงผลเท่านั้น ห้ามใช้ตัดสินสิทธิ์จาก token ที่ browser ส่งมา */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T {
  const [, payload] = token.split('.');
  if (!payload) throw new MophAuthError('jwt', 'malformed token');
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
  } catch {
    throw new MophAuthError('jwt', 'undecodable token payload');
  }
}

type HealthIdClaims = {
  scopes_detail?: { id_card?: string; name_prefix?: string; name?: string; surname?: string; ial?: number };
};

export type CitizenIdentity = { cid: string; displayName: string; ial: number | null };

function composeDisplayName(prefix: string | undefined, firstName: string | undefined, surname: string | undefined) {
  return `${prefix ?? ''}${firstName ?? ''} ${surname ?? ''}`.trim();
}

function identityFromClaims(claims: HealthIdClaims): CitizenIdentity | null {
  const details = claims.scopes_detail ?? {};
  const cid = String(details.id_card ?? '');
  if (!isValidCid(cid)) return null;
  return { cid, displayName: composeDisplayName(details.name_prefix, details.name, details.surname), ial: typeof details.ial === 'number' ? details.ial : null };
}

/** Step 3 (fallback) — เรียกเฉพาะเมื่อ JWT ไม่มีเลขบัตรครบ 13 หลัก */
async function getAccountIdentity(accessToken: string, fetcher: typeof fetch): Promise<CitizenIdentity | null> {
  const response = await fetcher(`${config.mophHealthIdBaseUrl}/api/v1/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const body = await response.json() as { status?: unknown; data?: { id_card_num?: string; account_title_th?: string; first_name_th?: string; last_name_th?: string }; message?: string };
  if (!response.ok || body?.status !== 'success') {
    throw new MophAuthError('accounts', `request rejected (HTTP ${response.status})`);
  }
  const cid = String(body.data?.id_card_num ?? '');
  if (!isValidCid(cid)) return null;
  return { cid, displayName: composeDisplayName(body.data?.account_title_th, body.data?.first_name_th, body.data?.last_name_th), ial: null };
}

/** รวม step 2+3: ได้ access token แล้วหาเลขบัตร 13 หลัก + ชื่อไทย + IAL (ห้าม log ค่าที่คืน) */
export async function getCitizenIdentity(accessToken: string, fetcher: typeof fetch = fetch): Promise<CitizenIdentity> {
  const fromClaims = identityFromClaims(decodeJwtPayload<HealthIdClaims>(accessToken));
  if (fromClaims) return fromClaims;
  const fromAccount = await getAccountIdentity(accessToken, fetcher);
  if (fromAccount) return fromAccount;
  throw new MophAuthError('identity', 'could not resolve a 13-digit citizen id from HealthID');
}
