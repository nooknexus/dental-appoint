import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Request } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import { config } from '../config.js';
import { pool } from '../db.js';
import { readSessionCookie, sessionCookieOptions } from './patientSession.js';

export const staffSessionCookie = 'clinic_staff_session';
export const staffCsrfCookie = 'clinic_staff_csrf';

export type StaffRole = 'IT_STAFF' | 'CLINIC_STAFF' | 'MANAGER';
export type StaffApprovalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'DISABLED';
export type StaffSession = {
  id: number;
  providerIdentity: string;
  displayName: string;
  department: string;
  hcode: string | null;
  role: StaffRole;
  status: StaffApprovalStatus;
};

function hashOpaqueToken(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

function hashesMatch(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createStaffSession(staffUserId: number) {
  const raw = randomBytes(32).toString('base64url');
  const csrfRaw = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.staffSessionHours * 3_600_000);
  await pool.query('DELETE FROM staff_sessions WHERE expires_at < UTC_TIMESTAMP()');
  await pool.query(
    'INSERT INTO staff_sessions (session_id_hash, staff_user_id, csrf_token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))',
    [hashOpaqueToken(raw), staffUserId, hashOpaqueToken(csrfRaw), config.staffSessionHours * 3_600],
  );
  return { raw, csrfRaw, expiresAt };
}

export async function createStaffOauthAttempt(state: string) {
  await pool.query('DELETE FROM staff_oauth_attempts WHERE expires_at < UTC_TIMESTAMP()');
  await pool.query(
    "INSERT INTO staff_oauth_attempts (state_hash, auth_flow, expires_at) VALUES (?, 'staff', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))",
    [hashOpaqueToken(state)],
  );
}

/** claim แบบ atomic: state เดิมสำเร็จได้ครั้งเดียว แม้ callback เข้ามาพร้อมกัน */
export async function consumeStaffOauthAttempt(state: string) {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE staff_oauth_attempts SET consumed_at = CURRENT_TIMESTAMP
     WHERE state_hash = ? AND auth_flow = 'staff' AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP()`,
    [hashOpaqueToken(state)],
  );
  return result.affectedRows === 1;
}

export async function getStaffSession(request: Request): Promise<StaffSession | null> {
  const raw = readSessionCookie(request, staffSessionCookie);
  if (!raw) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT su.id, su.provider_identity AS providerIdentity, su.display_name AS displayName,
            su.department, su.provider_hcode AS hcode, su.role, su.approval_status AS status
     FROM staff_sessions ss JOIN staff_users su ON su.id = ss.staff_user_id
     WHERE ss.session_id_hash = ? AND ss.expires_at > UTC_TIMESTAMP()`,
    [hashOpaqueToken(raw)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    providerIdentity: String(row.providerIdentity),
    displayName: String(row.displayName),
    department: String(row.department),
    hcode: row.hcode ? String(row.hcode) : null,
    role: row.role as StaffRole,
    status: row.status as StaffApprovalStatus,
  };
}

export async function getStaffCsrfToken(request: Request) {
  const sessionRaw = readSessionCookie(request, staffSessionCookie);
  const csrfRaw = readSessionCookie(request, staffCsrfCookie);
  if (!sessionRaw || !csrfRaw) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT csrf_token_hash AS csrfHash FROM staff_sessions WHERE session_id_hash = ? AND expires_at > UTC_TIMESTAMP()',
    [hashOpaqueToken(sessionRaw)],
  );
  return rows[0] && hashesMatch(String(rows[0].csrfHash), hashOpaqueToken(csrfRaw)) ? csrfRaw : null;
}

export async function verifyStaffCsrf(request: Request) {
  const sessionRaw = readSessionCookie(request, staffSessionCookie);
  const csrfHeader = request.header('x-csrf-token');
  if (!sessionRaw || !csrfHeader) return false;
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT csrf_token_hash AS csrfHash FROM staff_sessions WHERE session_id_hash = ? AND expires_at > UTC_TIMESTAMP()',
    [hashOpaqueToken(sessionRaw)],
  );
  return Boolean(rows[0] && hashesMatch(String(rows[0].csrfHash), hashOpaqueToken(csrfHeader)));
}

export async function destroyStaffSession(request: Request) {
  const raw = readSessionCookie(request, staffSessionCookie);
  if (raw) await pool.query('DELETE FROM staff_sessions WHERE session_id_hash = ?', [hashOpaqueToken(raw)]);
}

export function staffSessionCookieOptions() {
  return sessionCookieOptions(config.staffSessionHours * 3_600);
}
