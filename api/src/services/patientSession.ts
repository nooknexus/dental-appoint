import { createHash, randomBytes } from 'node:crypto';

import type { Request } from 'express';
import type { RowDataPacket } from 'mysql2';

import { config } from '../config.js';
import { pool } from '../db.js';

export const patientSessionCookie = 'clinic_patient_session';
export const oauthNonceCookie = 'moph_oauth_nonce';
export const mophAuthFlowCookie = 'moph_auth_flow';

export type PatientSession = { identity: string; displayName: string; ial: number | null; provider: string };

/** เก็บเฉพาะ sha256 ของ cookie id — ฐานข้อมูลรั่วจึงนำ id ไปแอบอ้างสิทธิ์ไม่ได้ */
function hashSessionId(raw: string) { return createHash('sha256').update(raw).digest('hex'); }

function parseCookieHeader(header: string | undefined) {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    try {
      cookies.set(name, decodeURIComponent(part.slice(index + 1).trim()));
    } catch {
      cookies.set(name, part.slice(index + 1).trim());
    }
  }
  return cookies;
}

export function readSessionCookie(request: Request, name: string = patientSessionCookie) {
  return parseCookieHeader(request.headers.cookie).get(name) ?? null;
}

export async function createPatientSession(identity: string, displayName: string, ial: number | null, provider = 'moph') {
  const raw = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.patientSessionHours * 3_600_000);
  await pool.query('DELETE FROM patient_sessions WHERE expires_at < NOW()');
  await pool.query(
    'INSERT INTO patient_sessions (session_id_hash, patient_identity, display_name, ial, provider, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [hashSessionId(raw), identity, displayName, ial, provider, expiresAt],
  );
  return { raw, expiresAt };
}

export async function getPatientSession(request: Request): Promise<PatientSession | null> {
  const raw = readSessionCookie(request);
  if (!raw) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT patient_identity AS identity, display_name AS displayName, ial, provider FROM patient_sessions WHERE session_id_hash = ? AND expires_at > NOW()',
    [hashSessionId(raw)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    identity: String(row.identity), displayName: String(row.displayName),
    ial: row.ial === null || row.ial === undefined ? null : Number(row.ial), provider: String(row.provider ?? 'moph'),
  };
}

export async function destroyPatientSession(request: Request) {
  const raw = readSessionCookie(request);
  if (raw) await pool.query('DELETE FROM patient_sessions WHERE session_id_hash = ?', [hashSessionId(raw)]);
}

/** express `res.cookie({ maxAge })` นับเป็น "มิลลิวินาที" ต้องคูณ 1000 เสมอ
 *  (เคยส่งเป็นวินาทีตรง ๆ ทำให้ cookie 12 ชั่วโมงเหลืออายุจริงแค่ 43 วินาที แล้ว session หลุดเงียบ ๆ) */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: maxAgeSeconds * 1000 } as const;
}
