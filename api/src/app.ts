import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';

import cors from 'cors';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import QRCode from 'qrcode';
import { z } from 'zod';

import { config, assertPatientSsoConfigured, assertProviderSsoConfigured, assertThaidSsoConfigured } from './config.js';
import { pool } from './db.js';
import { createAppointment } from './domain/booking.js';
import { currentWeekRange, daysInMonth, dutyDate, isDentistName, matchDentist, parseDutyRosterGrid } from './domain/dutyRoster.js';
import { buildDutyRosterTemplate, readDutyRosterGrid } from './services/dutyRosterExcel.js';
import { getThaiHolidaysForMonth } from './services/thaiHolidays.js';
import { buildAppointmentCancellationPayload, buildAppointmentConfirmationPayload, decryptCredential, encryptCredential, isValidCid, retryableDeliveryFailure, sendMophAlert } from './services/mophAlert.js';
import { buildAuthorizeUrl, exchangeCodeForCitizenToken, getCitizenIdentity, MophAuthError, newOauthNonce, noncesMatch, type CitizenIdentity } from './services/mophHealthId.js';
import { exchangeProviderToken, getProviderProfile, ProviderIdError } from './services/providerId.js';
import { buildThaidAuthorizeUrl, exchangeThaidCode, getThaidIdentity, ThaidAuthError } from './services/thaidAuth.js';
import { createPatientSession, destroyPatientSession, getPatientSession, mophAuthFlowCookie, oauthNonceCookie, patientSessionCookie, readSessionCookie, sessionCookieOptions } from './services/patientSession.js';
import { consumeStaffOauthAttempt, createStaffOauthAttempt, createStaffSession, destroyStaffSession, getStaffCsrfToken, getStaffSession, staffCsrfCookie, staffSessionCookie, staffSessionCookieOptions, type StaffRole, verifyStaffCsrf } from './services/staffSession.js';

const uploadDirectory = join(process.cwd(), 'uploads');
mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDirectory,
  filename: (_request, file, callback) => callback(null, `${Date.now()}-${randomBytes(6).toString('hex')}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

const spreadsheetMimeTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel.sheet.macroEnabled.12', 'application/octet-stream'];
const rosterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => callback(null, /\.(xlsx|xlsm)$/i.test(file.originalname) && spreadsheetMimeTypes.includes(file.mimetype)),
});

const bookingInput = z.object({
  serviceId: z.number().int().positive().optional(),
  dentistId: z.number().int().positive().optional(),
  slotId: z.number().int().positive(),
  phone: z.string().trim().min(9).max(32),
  notes: z.string().trim().max(1000).optional().default(''),
});

const satisfactionInput = z.object({
  appointmentId: z.number().int().positive(),
  cleanlinessRating: z.number().int().min(1).max(5),
  staffRating: z.number().int().min(1).max(5),
  dentistRating: z.number().int().min(1).max(5).optional(),
  waitTimeRating: z.number().int().min(1).max(5),
  overallRating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional().default(''),
});

function referenceCode() {
  return `APT-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

async function requireStaff(request: Request, response: Response, allowedRoles: StaffRole[] = ['IT_STAFF', 'CLINIC_STAFF', 'MANAGER']) {
  if (config.authMode === 'mock') {
    const role = request.header('x-mock-role') as StaffRole | undefined;
    if (!role || !allowedRoles.includes(role)) {
      response.status(403).json({ code: 'ROLE_FORBIDDEN', message: 'Staff access is required.' });
      return false;
    }
    response.locals.staff = { providerIdentity: 'MOCK-PROVIDER-001', role, status: 'APPROVED' };
    return true;
  }

  const staff = await getStaffSession(request);
  if (!staff) {
    response.status(401).json({ code: 'AUTH_REQUIRED', message: 'กรุณาเข้าสู่ระบบเจ้าหน้าที่' });
    return false;
  }
  if (staff.status === 'PENDING_APPROVAL') {
    response.status(403).json({ code: 'PENDING_APPROVAL', message: 'บัญชีนี้กำลังรอการอนุมัติ' });
    return false;
  }
  if (staff.status === 'DISABLED') {
    response.status(403).json({ code: 'ACCOUNT_DISABLED', message: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ' });
    return false;
  }
  if (!allowedRoles.includes(staff.role)) {
    response.status(403).json({ code: 'ROLE_FORBIDDEN', message: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้' });
    return false;
  }
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method) && !await verifyStaffCsrf(request)) {
    response.status(403).json({ code: 'CSRF_INVALID', message: 'คำขอหมดอายุหรือไม่ถูกต้อง กรุณาลองใหม่' });
    return false;
  }
  response.locals.staff = staff;
  return true;
}

/** ใช้กับ multipart route เพื่อยืนยัน session, role และ CSRF ก่อน Multer อ่านหรือเขียนไฟล์ */
function requireStaffBeforeBody(allowedRoles: StaffRole[]) {
  return async (request: Request, response: Response, next: (error?: unknown) => void) => {
    try {
      if (await requireStaff(request, response, allowedRoles)) next();
    } catch (error) { next(error); }
  };
}

function staffActor(response: Response) {
  const staff = response.locals.staff as { providerIdentity?: string } | undefined;
  return staff?.providerIdentity ?? 'MOCK-PROVIDER-001';
}

const reservationPaymentAmount = 400;
const overlapsLunchBreak = (startTime: string, durationMinutes: number) => {
  const [hours, minutes] = startTime.split(':').map(Number);
  const startMinutes = hours * 60 + minutes;
  return startMinutes < 13 * 60 && startMinutes + durationMinutes > 12 * 60;
};

async function reservationPaymentEnabled() {
  const [settings] = await pool.query<RowDataPacket[]>("SELECT boolean_value AS enabled FROM system_settings WHERE setting_key = 'reservation_payment_enabled'");
  return settings[0] ? Boolean(settings[0].enabled) : true;
}

type BookingFlow = 'PROCEDURE_AND_DENTIST' | 'DENTIST_ONLY' | 'TIME_ONLY';
type ClinicType = 'PMC' | 'SMC';
const defaultClinicTypes: ClinicType[] = ['PMC', 'SMC'];

async function bookingFlow(): Promise<BookingFlow> {
  const [settings] = await pool.query<RowDataPacket[]>("SELECT text_value AS bookingFlow FROM system_settings WHERE setting_key = 'booking_flow'");
  const value = settings[0]?.bookingFlow;
  return value === 'DENTIST_ONLY' || value === 'TIME_ONLY' ? value : 'PROCEDURE_AND_DENTIST';
}

async function clinicTypes(): Promise<ClinicType[]> {
  const [settings] = await pool.query<RowDataPacket[]>("SELECT text_value AS clinicTypes FROM system_settings WHERE setting_key = 'clinic_types'");
  const enabledTypes = String(settings[0]?.clinicTypes ?? '').split(',').filter((type): type is ClinicType => type === 'PMC' || type === 'SMC');
  const selectedTypes = defaultClinicTypes.filter((type) => enabledTypes.includes(type));
  return selectedTypes.length ? selectedTypes : defaultClinicTypes;
}

function maskCid(value: string) { return value.length === 13 ? `${value.slice(0, 3)}******${value.slice(-4)}` : 'invalid CID'; }

/** identity ของผู้ป่วยมาจาก session cookie **ที่เดียวเท่านั้น** (หมอพร้อม/ThaiD/ฟอร์มกรอกเอง ออก session
 *  เหมือนกันหมด) — ห้ามรับ identity จาก query/body และห้ามมี fallback เป็น identity สมมติเด็ดขาด
 *  เพราะเคยทำให้ผู้ป่วยที่ session หมดอายุเห็นคิวของคนอื่น */
const patientLoginRequired = { message: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' };

async function queueAppointmentConfirmation(appointmentId: number) {
  const [appointments] = await pool.query<RowDataPacket[]>(
    `SELECT a.patient_identity AS patientIdentity FROM appointments a WHERE a.id = ? AND a.appointment_status = 'CONFIRMED'`, [appointmentId],
  );
  const appointment = appointments[0];
  if (!appointment) return;
  const valid = isValidCid(String(appointment.patientIdentity));
  await pool.query(
    `INSERT IGNORE INTO notification_deliveries (appointment_id, recipient_masked, delivery_status, error_message)
     VALUES (?, ?, ?, ?)`,
    [appointmentId, maskCid(String(appointment.patientIdentity)), valid ? 'PENDING' : 'INVALID_RECIPIENT', valid ? null : 'patient_identity must be a 13-digit CID'],
  );
  if (valid) void processNotificationDeliveries();
}

/** เจ้าหน้าที่ยกเลิกนัด: คิวแจ้งเตือน MOPH Alert แยกประเภทจากยืนยันนัด ใช้ unique key (appointment_id, notification_type) จึงอยู่คนละแถวกันได้ */
async function queueAppointmentCancellation(appointmentId: number, reason: string | null) {
  const [appointments] = await pool.query<RowDataPacket[]>(
    `SELECT a.patient_identity AS patientIdentity FROM appointments a WHERE a.id = ? AND a.appointment_status = 'CANCELLED'`, [appointmentId],
  );
  const appointment = appointments[0];
  if (!appointment) return;
  const valid = isValidCid(String(appointment.patientIdentity));
  await pool.query(
    `INSERT IGNORE INTO notification_deliveries (appointment_id, notification_type, recipient_masked, delivery_status, error_message, cancel_reason)
     VALUES (?, 'CANCELLATION', ?, ?, ?, ?)`,
    [appointmentId, maskCid(String(appointment.patientIdentity)), valid ? 'PENDING' : 'INVALID_RECIPIENT', valid ? null : 'patient_identity must be a 13-digit CID', reason],
  );
  if (valid) void processNotificationDeliveries();
}

export async function processNotificationDeliveries() {
  const [settings] = await pool.query<RowDataPacket[]>("SELECT setting_key AS settingKey, boolean_value AS booleanValue, text_value AS textValue FROM system_settings WHERE setting_key IN ('moph_alert_enabled', 'moph_alert_client_key', 'moph_alert_secret_key')");
  const values = new Map(settings.map((setting) => [setting.settingKey, setting]));
  if (!values.get('moph_alert_enabled')?.booleanValue || !config.mophAlertEncryptionKey) return;
  const clientEncrypted = values.get('moph_alert_client_key')?.textValue;
  const secretEncrypted = values.get('moph_alert_secret_key')?.textValue;
  if (!clientEncrypted || !secretEncrypted) return;
  const [deliveries] = await pool.query<RowDataPacket[]>(
    `SELECT nd.id, nd.appointment_id AS appointmentId, nd.notification_type AS notificationType, nd.cancel_reason AS cancelReason, nd.attempt_count AS attemptCount,
            a.patient_identity AS citizenId, a.queue_number AS queueNumber,
            DATE_FORMAT(bs.service_date, '%Y-%m-%d') AS serviceDate, TIME_FORMAT(bs.start_time, '%H:%i') AS startTime,
            d.display_name AS dentistName, s.title AS serviceName
     FROM notification_deliveries nd JOIN appointments a ON a.id = nd.appointment_id JOIN booking_slots bs ON bs.id = a.slot_id
     LEFT JOIN dentists d ON d.id = a.dentist_id LEFT JOIN services s ON s.id = a.service_id
     WHERE nd.delivery_status IN ('PENDING', 'FAILED') AND nd.attempt_count < 3 ORDER BY nd.id LIMIT 10`,
  );
  for (const delivery of deliveries) {
    if (!isValidCid(String(delivery.citizenId))) {
      await pool.query("UPDATE notification_deliveries SET delivery_status = 'INVALID_RECIPIENT', error_message = 'patient_identity must be a 13-digit CID' WHERE id = ?", [delivery.id]);
      continue;
    }
    const [claim] = await pool.query<ResultSetHeader>("UPDATE notification_deliveries SET delivery_status = 'SENDING', attempt_count = attempt_count + 1, last_attempt_at = CURRENT_TIMESTAMP WHERE id = ? AND delivery_status IN ('PENDING', 'FAILED') AND attempt_count < 3", [delivery.id]);
    if (!claim.affectedRows) continue;
    try {
      const shared = { citizenId: String(delivery.citizenId), queueNumber: String(delivery.queueNumber), serviceDate: String(delivery.serviceDate), startTime: String(delivery.startTime), dentistName: delivery.dentistName ? String(delivery.dentistName) : null, serviceName: delivery.serviceName ? String(delivery.serviceName) : null };
      const payload = delivery.notificationType === 'CANCELLATION'
        ? buildAppointmentCancellationPayload({ ...shared, reason: delivery.cancelReason ? String(delivery.cancelReason) : null })
        : buildAppointmentConfirmationPayload(shared);
      const result = await sendMophAlert(payload, { clientKey: decryptCredential(clientEncrypted, config.mophAlertEncryptionKey), secretKey: decryptCredential(secretEncrypted, config.mophAlertEncryptionKey) });
      const success = result.status === 200;
      const retryable = retryableDeliveryFailure(result.status, false);
      await pool.query("UPDATE notification_deliveries SET delivery_status = ?, response_status = ?, sent_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END, attempt_count = CASE WHEN ? OR ? THEN attempt_count ELSE 3 END, error_message = ? WHERE id = ?", [success ? 'SENT' : 'FAILED', result.status, success, success, retryable, success ? null : `MOPH returned HTTP ${result.status}`, delivery.id]);
    } catch (error) {
      const message = error instanceof Error ? error.name : 'network error';
      await pool.query("UPDATE notification_deliveries SET delivery_status = 'FAILED', error_message = ? WHERE id = ?", [retryableDeliveryFailure(undefined, true) ? message : 'delivery failed', delivery.id]);
    }
  }
}

export const app = express();
app.use(cors({ credentials: true, origin: config.frontendOrigin }));
app.use('/api/staff/duty-rosters', express.json({ limit: '2mb' }));
app.use(express.json());

app.get('/api/health', async (_request, response) => {
  await pool.query('SELECT 1');
  response.json({ status: 'ok' });
});

app.get('/api/booking-config', async (_request, response) => {
  response.json({ bookingFlow: await bookingFlow() });
});

app.get('/api/clinic-config', async (_request, response) => {
  response.json({ clinicTypes: await clinicTypes() });
});

app.post('/api/dev-auth/staff', (request, response) => {
  if (config.authMode !== 'mock') return response.status(404).json({ code: 'AUTH_REQUIRED', message: 'Mock staff login is disabled.' });
  const role: StaffRole = ['IT_STAFF', 'MANAGER'].includes(request.body?.role) ? request.body.role : 'CLINIC_STAFF';
  response.json({
    identity: 'MOCK-PROVIDER-001',
    displayName: 'เจ้าหน้าที่ทดสอบ',
    provider: 'Provider ID Mock',
    role,
  });
});

app.get('/api/auth/config', (_request, response) => {
  const staffAuthMode = config.authMode === 'provider' ? 'provider' : 'mock';
  response.json({
    patientSso: config.patientSsoEnabled,
    thaidSso: config.thaidSsoEnabled,
    staffAuthMode,
    staffProviderSso: staffAuthMode === 'provider',
  });
});

/** เริ่ม flow เจ้าหน้าที่ด้วย HealthID client/callback เดียวกับผู้ป่วย แล้วจึงแลก ProviderID token ใน callback */
app.get('/api/auth/staff/provider/login', async (_request, response, next) => {
  if (config.authMode !== 'provider') return response.status(404).json({ message: 'ProviderID staff SSO is not enabled.' });
  try {
    assertProviderSsoConfigured();
  } catch (error) {
    console.warn(error instanceof Error ? error.message : 'provider sso misconfigured');
    return response.status(503).json({ message: 'ระบบล็อกอินด้วย ProviderID ยังตั้งค่าไม่ครบบนเซิร์ฟเวอร์' });
  }
  try {
    const nonce = newOauthNonce();
    await createStaffOauthAttempt(nonce);
    const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: 600_000 } as const;
    response.cookie(oauthNonceCookie, nonce, cookieOptions);
    response.cookie(mophAuthFlowCookie, 'staff', cookieOptions);
    return response.redirect(buildAuthorizeUrl(nonce));
  } catch (error) { return next(error); }
});

/** เริ่ม flow ล็อกอินผู้ป่วยด้วยหมอพร้อม: เก็บ nonce ลง cookie แล้วพาไปหน้ายืนยันตัวตนของ moph.id.th */
app.get('/api/auth/patient/moph/login', async (_request, response, next) => {
  if (!config.patientSsoEnabled) return response.status(404).json({ message: 'Patient SSO is not enabled.' });
  try {
    assertPatientSsoConfigured();
  } catch (error) {
    console.warn(error instanceof Error ? error.message : 'patient sso misconfigured');
    return response.status(503).json({ message: 'ระบบล็อกอินด้วยหมอพร้อมยังตั้งค่าไม่ครบบนเซิร์ฟเวอร์ (ต้องมี MOPH_CLIENT_ID, MOPH_CLIENT_SECRET และ MOPH_REDIRECT_URI)' });
  }
  try {
    const nonce = newOauthNonce();
    const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: 600_000 } as const;
    response.cookie(oauthNonceCookie, nonce, cookieOptions);
    response.cookie(mophAuthFlowCookie, 'patient', cookieOptions);
    return response.redirect(buildAuthorizeUrl(nonce));
  } catch (error) { return next(error); }
});

const patientSsoErrorReasons = new Set(['cancelled', 'invalid_state', 'token', 'identity', 'ial', 'blocked', 'server']);
const patientSessionProviderLabels: Record<string, string> = { moph: 'MOPH HealthID', thaid: 'ThaiID' };

function patientSsoBackToFrontend(response: Response, provider: 'moph' | 'thaid', outcome: 'success' | string) {
  const key = provider === 'thaid' ? 'thaid' : 'login';
  const suffix = outcome === 'success' ? `${key}=success` : `${key}=error&reason=${outcome}`;
  return response.redirect(`${config.frontendOrigin}/appointment?${suffix}`);
}

function staffLanding(role: StaffRole) {
  if (role === 'MANAGER') return '/staff/dashboard';
  if (role === 'IT_STAFF') return '/staff/system-settings';
  return '/staff/appointments';
}

function staffSsoBackToFrontend(response: Response, outcome: 'cancelled' | 'invalid_state' | 'disabled' | 'server') {
  return response.redirect(`${config.frontendOrigin}/appointment?staff=error&reason=${outcome}`);
}

/** callback จาก moph.id.th: แลก code → HealthID token → อ่านเลขบัตร/ชื่อ/IAL → เปิด session ผู้ป่วย
 *  ทุกความล้มเหลวพากลับหน้า login พร้อม reason — ห้าม log token หรือเลขบัตร */
app.get('/api/auth/patient/moph/callback', async (request, response, next) => {
  try {
    const authFlow = readSessionCookie(request, mophAuthFlowCookie) === 'staff' ? 'staff' : 'patient';
    if (authFlow === 'staff' && config.authMode !== 'provider') return response.status(404).json({ message: 'ProviderID staff SSO is not enabled.' });
    if (authFlow === 'patient' && !config.patientSsoEnabled) return response.status(404).json({ message: 'Patient SSO is not enabled.' });
    const fail = (reason: string) => patientSsoBackToFrontend(response, 'moph', patientSsoErrorReasons.has(reason) ? reason : 'server');
    const staffFail = (reason: 'cancelled' | 'invalid_state' | 'disabled' | 'server') => staffSsoBackToFrontend(response, reason);

    // staff flow บังคับ state เสมอ; patient flow เดิมยังรองรับผู้ให้บริการที่ไม่ echo state เพื่อคง compatibility
    const expectedNonce = readSessionCookie(request, oauthNonceCookie);
    const state = typeof request.query.state === 'string' ? request.query.state : undefined;
    const validState = authFlow === 'staff'
      ? noncesMatch(state, expectedNonce)
      : Boolean(expectedNonce && (state === undefined || noncesMatch(state, expectedNonce)));
    if (!validState) return authFlow === 'staff' ? staffFail('invalid_state') : fail('invalid_state');
    if (authFlow === 'staff' && !await consumeStaffOauthAttempt(state!)) return staffFail('invalid_state');
    response.clearCookie(oauthNonceCookie, { path: '/' });
    response.clearCookie(mophAuthFlowCookie, { path: '/' });
    if (typeof request.query.error === 'string' || typeof request.query.code !== 'string') {
      return authFlow === 'staff' ? staffFail('cancelled') : fail('cancelled');
    }

    let healthAccessToken: string;
    try {
      healthAccessToken = await exchangeCodeForCitizenToken(request.query.code as string);
    } catch (error) {
      console.warn(`${authFlow === 'staff' ? 'Staff ProviderID' : 'Patient'} SSO token exchange failed:`, error instanceof MophAuthError ? error.message : 'upstream error');
      return authFlow === 'staff' ? staffFail('server') : fail('server');
    }

    if (authFlow === 'staff') {
      try {
        const providerToken = await exchangeProviderToken(healthAccessToken);
        const profile = await getProviderProfile(providerToken);
        await pool.query(
          `INSERT INTO staff_users
             (provider_identity, provider_hash_cid, display_name, provider_title, provider_email, department, provider_hcode)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE provider_hash_cid = VALUES(provider_hash_cid), display_name = VALUES(display_name),
             provider_title = VALUES(provider_title), provider_email = VALUES(provider_email),
             department = VALUES(department), provider_hcode = VALUES(provider_hcode)`,
          [profile.providerIdentity, profile.hashCid, profile.displayName, profile.title, profile.email, profile.department, profile.hcode],
        );
        const [users] = await pool.query<RowDataPacket[]>(
          'SELECT id, role, approval_status AS status FROM staff_users WHERE provider_identity = ?',
          [profile.providerIdentity],
        );
        const user = users[0];
        if (!user) throw new ProviderIdError('profile', 'ProviderID account could not be persisted');
        if (user.status === 'DISABLED') return staffFail('disabled');

        const session = await createStaffSession(Number(user.id));
        const cookieOptions = staffSessionCookieOptions();
        response.cookie(staffSessionCookie, session.raw, cookieOptions);
        response.cookie(staffCsrfCookie, session.csrfRaw, cookieOptions);
        return response.redirect(user.status === 'PENDING_APPROVAL'
          ? `${config.frontendOrigin}/staff/pending-approval`
          : `${config.frontendOrigin}${staffLanding(user.role as StaffRole)}`);
      } catch (error) {
        console.warn('Staff ProviderID SSO failed:', error instanceof ProviderIdError ? `${error.hop} request failed` : 'unexpected error');
        return staffFail('server');
      }
    }

    let identity: CitizenIdentity;
    try {
      identity = await getCitizenIdentity(healthAccessToken);
    } catch (error) {
      // log เฉพาะ hop + ข้อความจากผู้ให้บริการ ไม่ลง token หรือเลขบัตร
      console.warn('Patient SSO failed:', error instanceof MophAuthError ? error.message : 'upstream error');
      return fail(error instanceof MophAuthError && error.hop === 'identity' ? 'identity' : 'server');
    }
    if (identity.ial === null || identity.ial < config.minPatientIal) return fail('ial');

    const [registry] = await pool.query<RowDataPacket[]>('SELECT access_status AS accessStatus FROM patient_registry WHERE patient_identity = ?', [identity.cid]);
    if (registry[0]?.accessStatus === 'BLOCKED') return fail('blocked');
    await pool.query(
      'INSERT INTO patient_registry (patient_identity, patient_display_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE patient_display_name = VALUES(patient_display_name)',
      [identity.cid, identity.displayName],
    );
    const session = await createPatientSession(identity.cid, identity.displayName, identity.ial, 'moph');
    response.cookie(patientSessionCookie, session.raw, sessionCookieOptions(config.patientSessionHours * 3_600));
    return patientSsoBackToFrontend(response, 'moph', 'success');
  } catch (error) {
    console.warn('Patient SSO callback failed:', error instanceof MophAuthError ? error.message : 'unexpected error');
    return patientSsoBackToFrontend(response, 'moph', 'server');
  }
});

app.get('/api/auth/staff/me', async (request, response, next) => {
  try {
    if (config.authMode !== 'provider') return response.json({ authenticated: false, staffAuthMode: 'mock' });
    const staff = await getStaffSession(request);
    if (!staff) return response.json({ authenticated: false, staffAuthMode: 'provider' });
    return response.json({ authenticated: true, staffAuthMode: 'provider', ...staff });
  } catch (error) { return next(error); }
});

app.get('/api/auth/staff/csrf', async (request, response, next) => {
  try {
    if (config.authMode !== 'provider') return response.status(404).json({ code: 'AUTH_REQUIRED', message: 'ProviderID staff SSO is not enabled.' });
    const staff = await getStaffSession(request);
    if (!staff) return response.status(401).json({ code: 'AUTH_REQUIRED', message: 'กรุณาเข้าสู่ระบบเจ้าหน้าที่' });
    const csrfToken = await getStaffCsrfToken(request);
    if (!csrfToken) return response.status(403).json({ code: 'CSRF_INVALID', message: 'ไม่สามารถสร้างคำขอที่ปลอดภัยได้ กรุณาเข้าสู่ระบบใหม่' });
    return response.json({ csrfToken });
  } catch (error) { return next(error); }
});

app.post('/api/auth/staff/logout', async (request, response, next) => {
  try {
    if (config.authMode === 'provider' && !await verifyStaffCsrf(request)) {
      return response.status(403).json({ code: 'CSRF_INVALID', message: 'คำขอหมดอายุหรือไม่ถูกต้อง กรุณาลองใหม่' });
    }
    await destroyStaffSession(request);
    response.clearCookie(staffSessionCookie, { path: '/' });
    response.clearCookie(staffCsrfCookie, { path: '/' });
    return response.json({ ok: true });
  } catch (error) { return next(error); }
});

const thaidStateCookie = 'thaid_state';

/** เริ่ม flow ล็อกอินผู้ป่วยด้วย ThaiID: เก็บ state ลง cookie แล้วพาไป authorization_endpoint ที่ค้นพบจาก well-known */
app.get('/api/auth/patient/thaid/login', async (_request, response, next) => {
  if (!config.thaidSsoEnabled) return response.status(404).json({ message: 'ThaiID SSO is not enabled.' });
  try {
    assertThaidSsoConfigured();
  } catch (error) {
    console.warn(error instanceof Error ? error.message : 'thaid sso misconfigured');
    return response.status(503).json({ message: 'ระบบล็อกอินด้วย ThaiID ยังตั้งค่าไม่ครบบนเซิร์ฟเวอร์ (ต้องมี THAID_CLIENT_ID, THAID_CLIENT_SECRET และ THAID_REDIRECT_URI)' });
  }
  try {
    const state = newOauthNonce();
    response.cookie(thaidStateCookie, state, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: 600_000 });
    return response.redirect(await buildThaidAuthorizeUrl(state));
  } catch (error) { return next(error); }
});

/** callback จาก ThaiID: ตรวจ state → แลก code → อ่าน pid/ชื่อ → เปิด session ผู้ป่วย (โครงเดียวกับหมอพร้อม) */
app.get('/api/auth/patient/thaid/callback', async (request, response, next) => {
  try {
    if (!config.thaidSsoEnabled) return response.status(404).json({ message: 'ThaiID SSO is not enabled.' });
    const fail = (reason: string) => patientSsoBackToFrontend(response, 'thaid', patientSsoErrorReasons.has(reason) ? reason : 'server');

    const expectedState = readSessionCookie(request, thaidStateCookie);
    const state = typeof request.query.state === 'string' ? request.query.state : undefined;
    if (!expectedState || !noncesMatch(state, expectedState)) return fail('invalid_state');
    response.clearCookie(thaidStateCookie, { path: '/' });
    if (typeof request.query.error === 'string' || typeof request.query.code !== 'string') return fail('cancelled');

    let identity: { cid: string; displayName: string };
    try {
      const tokens = await exchangeThaidCode(request.query.code as string);
      identity = await getThaidIdentity(tokens);
    } catch (error) {
      console.warn('ThaiID SSO failed:', error instanceof ThaidAuthError ? error.message : 'upstream error');
      return fail(error instanceof ThaidAuthError && error.hop === 'identity' ? 'identity' : 'server');
    }

    const [registry] = await pool.query<RowDataPacket[]>('SELECT access_status AS accessStatus FROM patient_registry WHERE patient_identity = ?', [identity.cid]);
    if (registry[0]?.accessStatus === 'BLOCKED') return fail('blocked');
    await pool.query(
      'INSERT INTO patient_registry (patient_identity, patient_display_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE patient_display_name = VALUES(patient_display_name)',
      [identity.cid, identity.displayName],
    );
    const session = await createPatientSession(identity.cid, identity.displayName, null, 'thaid');
    response.cookie(patientSessionCookie, session.raw, sessionCookieOptions(config.patientSessionHours * 3_600));
    return patientSsoBackToFrontend(response, 'thaid', 'success');
  } catch (error) {
    console.warn('ThaiID SSO callback failed:', error instanceof ThaidAuthError ? error.message : 'unexpected error');
    return patientSsoBackToFrontend(response, 'thaid', 'server');
  }
});

const manualLoginInput = z.object({
  citizenId: z.string().trim().length(13),
  displayName: z.string().trim().min(1).max(160),
});

/** ล็อกอินด้วยการกรอกข้อมูลเอง สำหรับผู้ที่ไม่มีแอปหมอพร้อม/ThaiD — identity ยังเป็น self-declared
 *  (ไม่ได้ยืนยันกับผู้ให้บริการ) แต่ **ออก session จริงฝั่ง server เหมือน SSO** เพื่อให้ endpoint ฝั่งผู้ป่วย
 *  อ่าน identity จาก session ที่เดียว ไม่ต้องรับเลขบัตรจาก browser ในทุก request อีกต่อไป */
app.post('/api/auth/patient/manual', async (request, response, next) => {
  try {
    const input = manualLoginInput.parse(request.body);
    if (!isValidCid(input.citizenId)) return response.status(400).json({ message: 'เลขบัตรประชาชนไม่ถูกต้อง' });
    const [patients] = await pool.query<RowDataPacket[]>('SELECT access_status AS accessStatus FROM patient_registry WHERE patient_identity = ?', [input.citizenId]);
    if (patients[0]?.accessStatus === 'BLOCKED') return response.status(403).json({ message: 'บัญชีผู้ใช้นี้ถูกระงับการใช้งาน กรุณาติดต่อคลินิก' });
    const session = await createPatientSession(input.citizenId, input.displayName, null, 'manual');
    response.cookie(patientSessionCookie, session.raw, sessionCookieOptions(config.patientSessionHours * 3_600));
    return response.status(201).json({ displayName: input.displayName, identityMasked: maskCid(input.citizenId), provider: 'manual' });
  } catch (error) { return next(error); }
});

app.post('/api/auth/patient/logout', async (request, response, next) => {
  try {
    await destroyPatientSession(request);
    response.clearCookie(patientSessionCookie, { path: '/' });
    return response.json({ ok: true });
  } catch (error) { return next(error); }
});

app.get('/api/auth/me', async (request, response, next) => {
  try {
    const session = await getPatientSession(request);
    if (!session) return response.json({ authenticated: false });
    return response.json({
      authenticated: true, role: 'PATIENT', displayName: session.displayName,
      identityMasked: maskCid(session.identity), ial: session.ial,
      provider: patientSessionProviderLabels[session.provider] ?? session.provider,
    });
  } catch (error) { return next(error); }
});

app.get('/api/services', async (_request, response) => {
  const [services] = await pool.query<RowDataPacket[]>('SELECT id, title, category, duration_minutes AS durationMinutes, price_label AS priceLabel, deposit_amount AS depositAmount FROM services WHERE active = TRUE ORDER BY category, id');
  response.json({ services: services.map((service) => ({ id: service.id, code: `SERVICE-${service.id}`, name: service.title, category: service.category, description: `ระยะเวลานัดหมายประมาณ ${service.durationMinutes} นาที`, priceLabel: service.priceLabel, depositAmount: Number(service.depositAmount) })) });
});

app.get('/api/services/:serviceId/dentists', async (request, response) => {
  const serviceId = Number(request.params.serviceId);
  const [dentists] = await pool.query<RowDataPacket[]>(
    `SELECT d.id, d.display_name AS displayName, d.specialty AS specialty
     FROM dentists d JOIN dentist_services ds ON ds.dentist_id = d.id
     WHERE ds.service_id = ? AND d.active = TRUE ORDER BY d.display_name`,
    [serviceId],
  );
  response.json({ dentists: dentists.map((dentist) => ({ id: dentist.id, code: `DENTIST-${dentist.id}`, name: dentist.displayName, specialty: dentist.specialty })) });
});

app.get('/api/dentists', async (_request, response) => {
  const [dentists] = await pool.query<RowDataPacket[]>('SELECT id, display_name AS name, professional_title AS title, specialty, portrait_file_name AS portraitFileName FROM dentists WHERE active = TRUE ORDER BY display_name');
  response.json({ dentists: dentists.map((dentist) => ({ id: dentist.id, name: dentist.name, title: dentist.title, specialty: dentist.specialty, portraitUrl: dentist.portraitFileName ? `/api/dentists/${dentist.id}/portrait` : null })) });
});

app.get('/api/dentists/:dentistId/portrait', async (request, response, next) => {
  try {
    const dentistId = Number(request.params.dentistId);
    if (!Number.isInteger(dentistId) || dentistId <= 0) return response.status(404).json({ message: 'ไม่พบรูปทันตแพทย์' });
    const [dentists] = await pool.query<RowDataPacket[]>('SELECT portrait_file_name AS portraitFileName FROM dentists WHERE id = ? AND active = TRUE', [dentistId]);
    const dentist = dentists[0];
    if (!dentist?.portraitFileName) return response.status(404).json({ message: 'ไม่พบรูปทันตแพทย์' });
    return response.sendFile(basename(dentist.portraitFileName), { root: uploadDirectory }, (error) => {
      if (error) next(error);
    });
  } catch (error) { return next(error); }
});

app.get('/api/dentists/:dentistId/availability', async (request, response) => {
  const dentistId = Number(request.params.dentistId);
  const serviceId = request.query.serviceId === undefined ? undefined : Number(request.query.serviceId);
  const date = String(request.query.date ?? '');
  const flow = await bookingFlow();
  if (flow !== 'DENTIST_ONLY' && (!Number.isInteger(serviceId) || (serviceId ?? 0) <= 0)) {
    return response.status(400).json({ message: 'กรุณาระบุหัตถการ' });
  }
  const scopedToService = Number.isInteger(serviceId) && (serviceId ?? 0) > 0;
  const [slots] = await pool.query<RowDataPacket[]>(
    `SELECT bs.id, DATE_FORMAT(bs.service_date, '%Y-%m-%d') AS serviceDate,
            TIME_FORMAT(bs.start_time, '%H:%i') AS startTime, TIME_FORMAT(bs.end_time, '%H:%i') AS endTime,
            bs.capacity - bs.booked_count AS available
     FROM booking_slots bs
     JOIN dentists d ON d.id = bs.dentist_id
     ${scopedToService ? 'JOIN dentist_services ds ON ds.dentist_id = bs.dentist_id' : ''}
     WHERE bs.dentist_id = ? ${scopedToService ? 'AND ds.service_id = ?' : ''} AND bs.service_date = ?
       AND d.active = TRUE AND bs.active = TRUE AND bs.booked_count < bs.capacity
     ORDER BY bs.start_time`,
    scopedToService ? [dentistId, serviceId, date] : [dentistId, date],
  );
  response.json({ slots: slots.map((slot) => ({ id: slot.id, startsAt: `${slot.serviceDate}T${slot.startTime}:00+07:00`, endsAt: `${slot.serviceDate}T${slot.endTime}:00+07:00` })) });
});

app.get('/api/availability', async (request, response) => {
  const date = String(request.query.date ?? '');
  const [slots] = await pool.query<RowDataPacket[]>(`SELECT bs.id, DATE_FORMAT(bs.service_date, '%Y-%m-%d') AS serviceDate, TIME_FORMAT(bs.start_time, '%H:%i') AS startTime, TIME_FORMAT(bs.end_time, '%H:%i') AS endTime, bs.capacity - bs.booked_count AS available FROM booking_slots bs WHERE bs.dentist_id IS NULL AND bs.service_date = ? AND bs.active = TRUE AND bs.booked_count < bs.capacity ORDER BY bs.start_time`, [date]);
  response.json({ slots: slots.map((slot) => ({ id: slot.id, startsAt: `${slot.serviceDate}T${slot.startTime}:00+07:00`, endsAt: `${slot.serviceDate}T${slot.endTime}:00+07:00`, available: Number(slot.available) })) });
});

type BookAppointmentInput = {
  serviceId?: number;
  dentistId?: number;
  slotId: number;
  phone: string;
  notes?: string;
  patientIdentity: string;
  patientDisplayName: string;
  actor: string;
  /** walk-in ของเจ้าหน้าที่: ยืนยันคิวทันทีโดยไม่ต้องรอชำระเงิน/ตรวจสอบ */
  immediateConfirm?: boolean;
  /** walk-in ของเจ้าหน้าที่: ข้ามการเช็ค patient_registry.access_status === 'BLOCKED' (บล็อกมีไว้กันการจองออนไลน์ ไม่ใช่การมาที่คลินิกเอง) */
  skipBlockCheck?: boolean;
};
type BookAppointmentResult =
  | { ok: true; status: 201; appointment: Record<string, unknown> }
  | { ok: false; status: 400 | 403 | 409; message: string };

/**
 * Transaction กลางสำหรับ "จองคิวเข้าไปในสล็อต" ใช้ร่วมกันทั้งการจองสาธารณะของผู้ป่วย (POST /api/appointments)
 * และการเพิ่ม walk-in ของเจ้าหน้าที่ (POST /api/staff/appointments/walk-in) ห้ามแยก copy ตรรกะนี้ที่อื่นอีก
 * เพราะเป็นจุดเดียวที่ล็อกสล็อต+ออกเลขคิวป้องกัน race condition/overbooking
 */
async function bookAppointmentInSlot(input: BookAppointmentInput): Promise<BookAppointmentResult> {
  const flow = await bookingFlow();
  if (flow === 'PROCEDURE_AND_DENTIST' && !input.serviceId) {
    return { ok: false, status: 400, message: 'กรุณาระบุหัตถการ' };
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [slotRows] = await connection.query<RowDataPacket[]>(
      flow === 'TIME_ONLY'
        ? `SELECT bs.id, bs.dentist_id AS dentistId, bs.service_date AS serviceDate, bs.capacity, bs.booked_count AS bookedCount,
                  'CLN' AS queuePrefix
           FROM booking_slots bs
           WHERE bs.id = ? AND bs.dentist_id IS NULL AND bs.active = TRUE FOR UPDATE`
        : `SELECT bs.id, bs.dentist_id AS dentistId, bs.service_date AS serviceDate, bs.capacity, bs.booked_count AS bookedCount,
                  d.queue_prefix AS queuePrefix
           FROM booking_slots bs
           JOIN dentists d ON d.id = bs.dentist_id
           ${input.serviceId ? 'JOIN services s ON s.id = ? JOIN dentist_services ds ON ds.dentist_id = bs.dentist_id AND ds.service_id = s.id' : ''}
           WHERE bs.id = ? AND bs.dentist_id = ? AND d.active = TRUE AND bs.active = TRUE FOR UPDATE`,
      flow === 'TIME_ONLY' ? [input.slotId] : input.serviceId ? [input.serviceId, input.slotId, input.dentistId] : [input.slotId, input.dentistId],
    );
    const slot = slotRows[0];
    if (!slot || slot.bookedCount >= slot.capacity) {
      await connection.rollback();
      return { ok: false, status: 409, message: 'ช่วงเวลานี้เต็มหรือไม่พร้อมให้จองแล้ว' };
    }

    const [counterRows] = await connection.query<RowDataPacket[]>(
      'SELECT next_sequence AS nextSequence FROM queue_counters WHERE service_date = ? AND queue_prefix = ? FOR UPDATE',
      [slot.serviceDate, slot.queuePrefix],
    );
    const queueSequence = counterRows[0]?.nextSequence ?? 1;
    if (counterRows[0]) {
      await connection.query('UPDATE queue_counters SET next_sequence = ? WHERE service_date = ? AND queue_prefix = ?', [queueSequence + 1, slot.serviceDate, slot.queuePrefix]);
    } else {
      await connection.query('INSERT INTO queue_counters (service_date, queue_prefix, next_sequence) VALUES (?, ?, ?)', [slot.serviceDate, slot.queuePrefix, 2]);
    }

    const [paymentSettings] = await connection.query<RowDataPacket[]>("SELECT boolean_value AS enabled FROM system_settings WHERE setting_key = 'reservation_payment_enabled' FOR UPDATE");
    const paymentEnabled = paymentSettings[0] ? Boolean(paymentSettings[0].enabled) : true;
    if (!input.skipBlockCheck) {
      const [patients] = await connection.query<RowDataPacket[]>('SELECT access_status AS accessStatus FROM patient_registry WHERE patient_identity = ? FOR UPDATE', [input.patientIdentity]);
      if (patients[0]?.accessStatus === 'BLOCKED') {
        await connection.rollback();
        return { ok: false, status: 403, message: 'บัญชีผู้ใช้นี้ถูกระงับการจองคิว กรุณาติดต่อคลินิก' };
      }
    }
    let appointment = createAppointment({
      queuePrefix: slot.queuePrefix,
      queueSequence,
      reference: referenceCode(),
      serviceId: input.serviceId,
      dentistId: input.dentistId,
      slotId: input.slotId,
      patientPhone: input.phone,
      reservationPaymentEnabled: paymentEnabled,
    });
    const paymentAmount = paymentEnabled ? reservationPaymentAmount : 0;
    if (input.immediateConfirm) {
      appointment = { ...appointment, appointmentStatus: 'CONFIRMED', paymentStatus: 'NOT_REQUIRED' };
    }
    const insertedPaymentAmount = input.immediateConfirm ? 0 : paymentAmount;
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO appointments (reference_code, queue_number, service_id, dentist_id, slot_id, patient_identity, patient_display_name, patient_phone, notes, appointment_status, payment_status, payment_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [appointment.reference, appointment.queueNumber, input.serviceId ?? null, input.dentistId ?? null, input.slotId, input.patientIdentity, input.patientDisplayName, input.phone, input.notes ?? '', appointment.appointmentStatus, appointment.paymentStatus, insertedPaymentAmount],
    );
    await connection.query('INSERT INTO patient_registry (patient_identity, patient_display_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE patient_display_name = VALUES(patient_display_name)', [input.patientIdentity, input.patientDisplayName]);
    await connection.query('INSERT INTO patient_visit_registry (appointment_id, patient_identity) VALUES (?, ?)', [result.insertId, input.patientIdentity]);
    await connection.query('UPDATE booking_slots SET booked_count = booked_count + 1 WHERE id = ?', [input.slotId]);
    await connection.query('INSERT INTO appointment_status_history (appointment_id, appointment_status, payment_status, actor) VALUES (?, ?, ?, ?)', [result.insertId, appointment.appointmentStatus, appointment.paymentStatus, input.actor]);
    await connection.commit();
    return {
      ok: true,
      status: 201,
      appointment: {
        ...appointment,
        appointmentId: result.insertId,
        paymentAmount: insertedPaymentAmount,
        reservationPaymentRequired: input.immediateConfirm ? false : paymentEnabled,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

app.post('/api/appointments', async (request, response, next) => {
  try {
    const input = bookingInput.parse(request.body);
    // identity/ชื่อผู้จองมาจาก session เท่านั้น ไม่รับค่าจาก browser (ทุกทางล็อกอินออก session เหมือนกันหมด)
    const patientSession = await getPatientSession(request);
    if (!patientSession) return response.status(401).json(patientLoginRequired);
    const result = await bookAppointmentInSlot({
      ...input,
      patientIdentity: patientSession.identity,
      patientDisplayName: patientSession.displayName,
      actor: patientSession.identity,
    });
    if (!result.ok) return response.status(result.status).json({ message: result.message });
    return response.status(201).json({ appointment: result.appointment });
  } catch (error) {
    next(error);
  }
});

app.get('/api/appointments/:reference/payment-qr', async (request, response) => {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT reference_code AS referenceCode, queue_number AS queueNumber, payment_amount AS paymentAmount FROM appointments WHERE reference_code = ?', [request.params.reference]);
  const appointment = rows[0];
  if (!appointment) return response.status(404).json({ message: 'ไม่พบรายการนัดหมาย' });
  if (Number(appointment.paymentAmount) === 0) return response.status(409).json({ message: 'รายการนัดหมายนี้ไม่ต้องชำระค่าจองคิว' });
  const payload = `MOCK-PAYMENT|${appointment.referenceCode}|${appointment.queueNumber}|${appointment.paymentAmount}`;
  const image = await QRCode.toDataURL(payload, { margin: 2, width: 520 });
  return response.json({ ...appointment, qrCodeDataUrl: image, isMock: true });
});

app.post('/api/appointments/:reference/slip', upload.single('slip'), async (request, response) => {
  if (!request.file) return response.status(400).json({ message: 'กรุณาแนบสลิปเป็นไฟล์ JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB' });
  const [rows] = await pool.query<RowDataPacket[]>('SELECT id, payment_amount AS paymentAmount, patient_identity AS patientIdentity FROM appointments WHERE reference_code = ?', [request.params.reference]);
  const appointment = rows[0];
  if (!appointment) return response.status(404).json({ message: 'ไม่พบรายการนัดหมาย' });
  if (Number(appointment.paymentAmount) === 0) return response.status(409).json({ message: 'รายการนัดหมายนี้ไม่ต้องชำระค่าจองคิว' });
  await pool.query('INSERT INTO payment_slips (appointment_id, file_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), uploaded_at = CURRENT_TIMESTAMP, reviewed_by = NULL, reviewed_at = NULL, rejection_reason = NULL', [appointment.id, request.file.filename]);
  await pool.query("UPDATE appointments SET payment_status = 'SLIP_UPLOADED' WHERE id = ?", [appointment.id]);
  await pool.query('INSERT INTO appointment_status_history (appointment_id, appointment_status, payment_status, actor) SELECT id, appointment_status, payment_status, ? FROM appointments WHERE id = ?', [String(appointment.patientIdentity), appointment.id]);
  return response.status(201).json({ message: 'ส่งสลิปเพื่อรอตรวจสอบแล้ว' });
});

app.get('/api/patient/appointments', async (request, response) => {
  const session = await getPatientSession(request);
  if (!session) return response.status(401).json(patientLoginRequired);
  const identity = session.identity;
  const [appointments] = await pool.query<RowDataPacket[]>(
    `SELECT a.reference_code AS referenceCode, a.queue_number AS queueNumber, a.appointment_status AS appointmentStatus,
            a.payment_status AS paymentStatus, s.title AS serviceTitle, d.display_name AS dentistName,
            DATE_FORMAT(bs.service_date, '%Y-%m-%d') AS serviceDate, TIME_FORMAT(bs.start_time, '%H:%i') AS startTime
     FROM appointments a LEFT JOIN services s ON s.id = a.service_id LEFT JOIN dentists d ON d.id = a.dentist_id
     JOIN booking_slots bs ON bs.id = a.slot_id WHERE a.patient_identity = ? ORDER BY bs.service_date DESC, bs.start_time DESC`,
    [identity],
  );
  return response.json({ appointments: appointments.map((appointment) => ({
    reference: appointment.referenceCode, queueNumber: appointment.queueNumber, status: appointment.appointmentStatus,
    paymentStatus: appointment.paymentStatus,
    serviceName: appointment.serviceTitle ?? (appointment.dentistName ? 'นัดหมายกับทันตแพทย์' : 'คิวกลางคลินิก'),
    startsAt: `${appointment.serviceDate}T${appointment.startTime}:00+07:00`,
    dentistName: appointment.dentistName ?? 'คิวกลางคลินิก',
  })) });
});

/** รายการนัดหมายที่ผู้ป่วยมาตามนัดแล้ว (visit_status = SERVED) พร้อมสถานะว่าประเมินความพึงพอใจไปแล้วหรือยัง
 *  ใช้ป้อนหน้า /patient/satisfaction — hasDentist มาจาก appointments.dentist_id ของนัดหมายนั้นเอง (ไม่ใช่ booking_flow ปัจจุบัน)
 *  เพื่อตัดสินใจว่าต้องโชว์คำถามให้คะแนนทันตแพทย์หรือไม่ */
app.get('/api/patient/satisfaction', async (request, response) => {
  const session = await getPatientSession(request);
  if (!session) return response.status(401).json(patientLoginRequired);
  const identity = session.identity;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT a.id AS appointmentId, a.reference_code AS referenceCode, a.queue_number AS queueNumber, a.dentist_id AS dentistId,
            s.title AS serviceTitle, d.display_name AS dentistName,
            DATE_FORMAT(bs.service_date, '%Y-%m-%d') AS serviceDate, TIME_FORMAT(bs.start_time, '%H:%i') AS startTime,
            ss.cleanliness_rating AS cleanlinessRating, ss.staff_rating AS staffRating, ss.dentist_rating AS dentistRating,
            ss.wait_time_rating AS waitTimeRating, ss.overall_rating AS overallRating, ss.comment, ss.submitted_at AS submittedAt
     FROM appointments a
     JOIN patient_visit_registry pvr ON pvr.appointment_id = a.id AND pvr.visit_status = 'SERVED'
     JOIN booking_slots bs ON bs.id = a.slot_id
     LEFT JOIN services s ON s.id = a.service_id LEFT JOIN dentists d ON d.id = a.dentist_id
     LEFT JOIN satisfaction_surveys ss ON ss.appointment_id = a.id
     WHERE a.patient_identity = ? ORDER BY bs.service_date DESC, bs.start_time DESC`,
    [identity],
  );
  return response.json({ visits: rows.map((row) => ({
    appointmentId: row.appointmentId,
    reference: row.referenceCode,
    queueNumber: row.queueNumber,
    serviceName: row.serviceTitle ?? (row.dentistName ? 'นัดหมายกับทันตแพทย์' : 'คิวกลางคลินิก'),
    dentistName: row.dentistName ?? 'คิวกลางคลินิก',
    hasDentist: row.dentistId !== null,
    startsAt: `${row.serviceDate}T${row.startTime}:00+07:00`,
    survey: row.submittedAt ? {
      cleanlinessRating: row.cleanlinessRating,
      staffRating: row.staffRating,
      dentistRating: row.dentistRating,
      waitTimeRating: row.waitTimeRating,
      overallRating: row.overallRating,
      comment: row.comment,
      submittedAt: row.submittedAt,
    } : null,
  })) });
});

/** ผู้ป่วยส่งแบบประเมินความพึงพอใจของนัดหมายที่มาตามนัดแล้ว ประเมินได้ครั้งเดียวต่อนัดหมาย (appointment_id UNIQUE)
 *  บังคับให้คะแนนทันตแพทย์เพิ่มเมื่อนัดหมายนั้นผูกทันตแพทย์อยู่ (dentist_id ไม่ null) */
app.post('/api/patient/satisfaction', async (request, response, next) => {
  try {
    const input = satisfactionInput.parse(request.body);
    const session = await getPatientSession(request);
    if (!session) return response.status(401).json(patientLoginRequired);
    const identity = session.identity;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT a.patient_identity AS patientIdentity, a.dentist_id AS dentistId, pvr.visit_status AS visitStatus
       FROM appointments a JOIN patient_visit_registry pvr ON pvr.appointment_id = a.id WHERE a.id = ?`,
      [input.appointmentId],
    );
    const appointment = rows[0];
    if (!appointment || appointment.patientIdentity !== identity) return response.status(404).json({ message: 'ไม่พบนัดหมายนี้' });
    if (appointment.visitStatus !== 'SERVED') return response.status(403).json({ message: 'ประเมินได้เฉพาะนัดหมายที่มาตามนัดแล้วเท่านั้น' });
    if (appointment.dentistId !== null && input.dentistRating === undefined) {
      return response.status(400).json({ message: 'กรุณาให้คะแนนทันตแพทย์ที่ให้บริการด้วย' });
    }

    try {
      await pool.query(
        `INSERT INTO satisfaction_surveys
           (appointment_id, patient_identity, dentist_id, cleanliness_rating, staff_rating, dentist_rating, wait_time_rating, overall_rating, comment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.appointmentId, identity, appointment.dentistId, input.cleanlinessRating, input.staffRating,
          appointment.dentistId !== null ? input.dentistRating : null, input.waitTimeRating, input.overallRating, input.comment,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') return response.status(409).json({ message: 'ท่านได้ประเมินนัดหมายนี้ไปแล้ว' });
      throw error;
    }
    return response.status(201).json({ message: 'ขอบคุณสำหรับความคิดเห็นของท่าน' });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/staff/appointments', async (request, response) => {
  if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
  const [appointments] = await pool.query<RowDataPacket[]>(
    `SELECT a.id, a.reference_code AS referenceCode, a.queue_number AS queueNumber, a.patient_display_name AS patientDisplayName,
            a.patient_phone AS patientPhone, a.appointment_status AS appointmentStatus, a.payment_status AS paymentStatus,
            a.payment_amount AS paymentAmount, s.title AS serviceTitle, d.display_name AS dentistName,
            DATE_FORMAT(bs.service_date, '%Y-%m-%d') AS serviceDate, TIME_FORMAT(bs.start_time, '%H:%i') AS startTime,
            ps.file_name AS slipFileName
     FROM appointments a
     LEFT JOIN services s ON s.id = a.service_id LEFT JOIN dentists d ON d.id = a.dentist_id JOIN booking_slots bs ON bs.id = a.slot_id
     LEFT JOIN payment_slips ps ON ps.appointment_id = a.id
     WHERE a.appointment_status <> 'CONFIRMED'
     ORDER BY a.created_at DESC`,
  );
  response.json({ appointments: appointments.map((appointment) => ({
    id: appointment.id,
    reference: appointment.referenceCode,
    queueNumber: appointment.queueNumber,
    status: appointment.appointmentStatus,
    paymentStatus: appointment.paymentStatus,
    patientName: appointment.patientDisplayName,
    serviceName: appointment.serviceTitle ?? 'ยังไม่ระบุหัตถการ',
    dentistName: appointment.dentistName ?? 'คิวกลางคลินิก',
    startsAt: `${appointment.serviceDate}T${appointment.startTime}:00+07:00`,
    phone: appointment.patientPhone,
    slipAvailable: Boolean(appointment.slipFileName),
  })) });
});

app.get('/api/staff/appointments/:id/slip', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
    const appointmentId = Number(request.params.id);
    if (!Number.isInteger(appointmentId) || appointmentId <= 0) return response.status(400).json({ message: 'รหัสนัดหมายไม่ถูกต้อง' });
    const [slips] = await pool.query<RowDataPacket[]>('SELECT file_name AS fileName FROM payment_slips WHERE appointment_id = ?', [appointmentId]);
    const slip = slips[0];
    if (!slip) return response.status(404).json({ message: 'ไม่พบสลิปการโอนเงิน' });
    return response.sendFile(basename(slip.fileName), { root: uploadDirectory }, (error) => {
      if (error) next(error);
    });
  } catch (error) {
    next(error);
  }
});

/** ตารางเวรและนัดหมายทั้งหมดของวันหนึ่ง แยกตามสล็อต ใช้ป้อนหน้าปฏิบัติงานประจำวัน (/staff/queue) ในคำขอเดียว
 *  เช็ค system_settings.booking_flow เหมือน GET /api/staff/slots: ถ้าเป็น TIME_ONLY จะกรองเฉพาะสล็อต
 *  dentist_id IS NULL (คิวกลางคลินิก) เท่านั้น สล็อตผูกทันตแพทย์เก่าจากตอนใช้ flow อื่นจะไม่ถูกนำมาแสดง */
app.get('/api/staff/day-queue', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(request.query.date ?? new Date().toISOString().slice(0, 10));
    const flow = await bookingFlow();
    const centralQueueOnly = flow === 'TIME_ONLY' ? ' AND bs.dentist_id IS NULL' : '';

    const [slotRows] = await pool.query<RowDataPacket[]>(
      `SELECT bs.id, bs.dentist_id AS dentistId, COALESCE(d.display_name, 'คิวกลางคลินิก') AS dentistName,
              TIME_FORMAT(bs.start_time, '%H:%i') AS startTime, TIME_FORMAT(bs.end_time, '%H:%i') AS endTime,
              bs.capacity, bs.booked_count AS bookedCount, bs.active
       FROM booking_slots bs LEFT JOIN dentists d ON d.id = bs.dentist_id
       WHERE bs.service_date = ?${centralQueueOnly} ORDER BY d.display_name, bs.start_time`,
      [date],
    );
    const [appointmentRows] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.slot_id AS slotId, a.reference_code AS referenceCode, a.queue_number AS queueNumber,
              a.patient_identity AS patientIdentity, a.patient_display_name AS patientName, a.patient_phone AS phone,
              a.appointment_status AS status, a.payment_status AS paymentStatus, a.notes,
              COALESCE(s.title, 'ยังไม่ระบุหัตถการ') AS serviceName, ps.file_name AS slipFileName,
              COALESCE(pvr.visit_status, 'BOOKED') AS visitStatus
       FROM appointments a
       JOIN booking_slots bs ON bs.id = a.slot_id
       LEFT JOIN services s ON s.id = a.service_id
       LEFT JOIN payment_slips ps ON ps.appointment_id = a.id
       LEFT JOIN patient_visit_registry pvr ON pvr.appointment_id = a.id
       WHERE bs.service_date = ?${centralQueueOnly} ORDER BY bs.start_time, a.created_at`,
      [date],
    );
    const [dentistRows] = await pool.query<RowDataPacket[]>(
      `SELECT d.id, d.display_name AS displayName, d.queue_prefix AS queuePrefix, s.id AS serviceId, s.title AS serviceTitle
       FROM dentists d
       LEFT JOIN dentist_services ds ON ds.dentist_id = d.id
       LEFT JOIN services s ON s.id = ds.service_id AND s.active = TRUE AND s.category <> 'รายการเดิม'
       WHERE d.active = TRUE ORDER BY d.display_name`,
    );

    const appointmentsBySlot = new Map<number, RowDataPacket[]>();
    appointmentRows.forEach((row) => { const list = appointmentsBySlot.get(row.slotId) ?? []; list.push(row); appointmentsBySlot.set(row.slotId, list); });
    const dentistsById = new Map<number, { id: number; displayName: string; queuePrefix: string; services: { id: number; title: string }[] }>();
    dentistRows.forEach((row) => {
      if (!dentistsById.has(row.id)) dentistsById.set(row.id, { id: row.id, displayName: row.displayName, queuePrefix: row.queuePrefix, services: [] });
      if (row.serviceId) dentistsById.get(row.id)!.services.push({ id: row.serviceId, title: row.serviceTitle });
    });

    let pending = 0;
    let confirmed = 0;
    let cancelled = 0;
    let totalCapacity = 0;
    let totalBooked = 0;
    const slots = slotRows.map((slot) => {
      const appointments = (appointmentsBySlot.get(slot.id) ?? []).map((appointment) => ({
        id: appointment.id,
        reference: appointment.referenceCode,
        queueNumber: appointment.queueNumber,
        patientIdentityMasked: maskCid(String(appointment.patientIdentity)),
        patientName: appointment.patientName,
        phone: appointment.phone,
        status: appointment.status,
        paymentStatus: appointment.paymentStatus,
        visitStatus: appointment.visitStatus,
        serviceName: appointment.serviceName,
        notes: appointment.notes,
        slipAvailable: Boolean(appointment.slipFileName),
      }));
      appointments.forEach((appointment) => {
        if (appointment.status === 'PENDING_CONFIRMATION') pending += 1;
        else if (appointment.status === 'CONFIRMED') confirmed += 1;
        else if (appointment.status === 'CANCELLED') cancelled += 1;
      });
      totalCapacity += slot.capacity;
      totalBooked += slot.bookedCount;
      return {
        id: slot.id, dentistId: slot.dentistId, dentistName: slot.dentistName,
        startTime: slot.startTime, endTime: slot.endTime, capacity: slot.capacity,
        bookedCount: slot.bookedCount, active: Boolean(slot.active), appointments,
      };
    });

    return response.json({
      date,
      bookingFlow: flow,
      summary: { totalSlots: slots.length, totalCapacity, totalBooked, freeSeats: totalCapacity - totalBooked, pending, confirmed, cancelled },
      slots,
      dentists: [...dentistsById.values()],
    });
  } catch (error) { return next(error); }
});

const walkInInput = z.object({
  slotId: z.number().int().positive(),
  patientDisplayName: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(9).max(32),
  citizenId: z.string().trim().length(13),
  serviceId: z.number().int().positive().optional(),
  notes: z.string().trim().max(1000).optional().default(''),
});

/** เจ้าหน้าที่เพิ่มคิว walk-in เข้าไปในสล็อตที่มีอยู่แล้ว ยืนยันคิวทันทีโดยไม่ต้องรอชำระเงิน/ตรวจสอบ
 *  และไม่เช็คสถานะระงับสิทธิ์จองออนไลน์ (บล็อกมีไว้กันการจองออนไลน์ ไม่ใช่การมาที่คลินิกเอง)
 *  บังคับกรอกเลขบัตรประชาชนเสมอ (ไม่มี identity สังเคราะห์ WALKIN-... อีกต่อไป) เพื่อให้ผูกกับ patient_registry ตัวจริงได้ */
app.post('/api/staff/appointments/walk-in', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
    const input = walkInInput.parse(request.body);
    if (!isValidCid(input.citizenId)) return response.status(400).json({ message: 'เลขบัตรประชาชนไม่ถูกต้อง' });
    const patientIdentity = input.citizenId;

    const [slotRows] = await pool.query<RowDataPacket[]>('SELECT dentist_id AS dentistId FROM booking_slots WHERE id = ?', [input.slotId]);
    if (!slotRows[0]) return response.status(404).json({ message: 'ไม่พบสล็อตนี้' });

    const result = await bookAppointmentInSlot({
      serviceId: input.serviceId,
      dentistId: slotRows[0].dentistId ?? undefined,
      slotId: input.slotId,
      phone: input.phone,
      notes: input.notes,
      patientIdentity,
      patientDisplayName: input.patientDisplayName,
      actor: staffActor(response),
      immediateConfirm: true,
      skipBlockCheck: true,
    });
    if (!result.ok) return response.status(result.status).json({ message: result.message });
    return response.status(201).json({ appointment: result.appointment });
  } catch (error) { return next(error); }
});

/** เจ้าหน้าที่ยกเลิกนัดหมาย: ตั้งสถานะเป็น CANCELLED และคืนที่นั่งกลับให้สล็อต (ลด booked_count) */
app.post('/api/staff/appointments/:id/cancel', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
    const appointmentId = Number(request.params.id);
    if (!Number.isInteger(appointmentId) || appointmentId <= 0) return response.status(400).json({ message: 'รหัสนัดหมายไม่ถูกต้อง' });
    const reason = z.string().trim().max(500).optional().parse(request.body?.reason);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT slot_id AS slotId, appointment_status AS status, payment_status AS paymentStatus, notes, queue_number AS queueNumber FROM appointments WHERE id = ? FOR UPDATE',
        [appointmentId],
      );
      const existing = rows[0];
      if (!existing) { await connection.rollback(); return response.status(404).json({ message: 'ไม่พบนัดหมาย' }); }
      if (existing.status === 'CANCELLED') { await connection.rollback(); return response.status(409).json({ message: 'นัดหมายนี้ถูกยกเลิกไปแล้ว' }); }

      const combinedNotes = reason ? [existing.notes, `ยกเลิก: ${reason}`].filter(Boolean).join(' | ') : existing.notes;
      await connection.query("UPDATE appointments SET appointment_status = 'CANCELLED', notes = ? WHERE id = ?", [combinedNotes, appointmentId]);
      await connection.query('UPDATE booking_slots SET booked_count = GREATEST(booked_count - 1, 0) WHERE id = ?', [existing.slotId]);
      await connection.query(
        "INSERT INTO appointment_status_history (appointment_id, appointment_status, payment_status, actor) VALUES (?, 'CANCELLED', ?, ?)",
        [appointmentId, existing.paymentStatus, staffActor(response)],
      );
      await connection.commit();
      await queueAppointmentCancellation(appointmentId, reason ?? null);
      return response.json({ message: `ยกเลิกคิวหมายเลข ${existing.queueNumber} แล้ว` });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  } catch (error) { return next(error); }
});

const visitStatusInput = z.object({ visitStatus: z.enum(['SERVED', 'NO_SHOW', 'BOOKED']) });

/** เจ้าหน้าที่บันทึกว่าผู้ป่วยมาตามนัดหรือไม่ ทำได้เฉพาะนัดหมายที่ยืนยันแล้ว (CONFIRMED) เท่านั้น */
app.patch('/api/staff/appointments/:id/visit-status', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
    const appointmentId = Number(request.params.id);
    if (!Number.isInteger(appointmentId) || appointmentId <= 0) return response.status(400).json({ message: 'รหัสนัดหมายไม่ถูกต้อง' });
    const { visitStatus } = visitStatusInput.parse(request.body);
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE patient_visit_registry pvr JOIN appointments a ON a.id = pvr.appointment_id
       SET pvr.visit_status = ? WHERE pvr.appointment_id = ? AND a.appointment_status = 'CONFIRMED'`,
      [visitStatus, appointmentId],
    );
    if (!result.affectedRows) return response.status(409).json({ message: 'ทำเครื่องหมายได้เฉพาะนัดหมายที่ยืนยันแล้วเท่านั้น' });
    const labels: Record<string, string> = { SERVED: 'บันทึกว่ามาตามนัดแล้ว', NO_SHOW: 'บันทึกว่าไม่มาตามนัดแล้ว', BOOKED: 'ล้างสถานะการมาตามนัดแล้ว' };
    return response.json({ message: labels[visitStatus] });
  } catch (error) { return next(error); }
});

app.get('/api/staff/slots', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(request.query.date ?? new Date().toISOString().slice(0, 10));
    const dentistId = request.query.dentistId === undefined ? undefined : z.coerce.number().int().positive().parse(request.query.dentistId);
    const flow = await bookingFlow();
    const [dentists] = await pool.query<RowDataPacket[]>(
      `SELECT d.id, d.display_name AS displayName, d.queue_prefix AS queuePrefix,
              GROUP_CONCAT(s.title ORDER BY s.category, s.id SEPARATOR '|') AS serviceTitles
       FROM dentists d
       LEFT JOIN dentist_services ds ON ds.dentist_id = d.id
       LEFT JOIN services s ON s.id = ds.service_id AND s.active = TRUE AND s.category <> 'รายการเดิม'
       WHERE d.active = TRUE GROUP BY d.id ORDER BY d.display_name`,
    );
    const [slots] = await pool.query<RowDataPacket[]>(
      `SELECT bs.id, bs.dentist_id AS dentistId, COALESCE(d.display_name, 'คิวกลางคลินิก') AS dentistName,
              TIME_FORMAT(bs.start_time, '%H:%i') AS startTime, TIME_FORMAT(bs.end_time, '%H:%i') AS endTime,
              bs.capacity, bs.booked_count AS bookedCount, bs.active
       FROM booking_slots bs LEFT JOIN dentists d ON d.id = bs.dentist_id
       WHERE bs.service_date = ?${flow === 'TIME_ONLY' ? ' AND bs.dentist_id IS NULL' : dentistId === undefined ? '' : ' AND bs.dentist_id = ?'} ORDER BY d.display_name, bs.start_time`,
      flow === 'TIME_ONLY' || dentistId === undefined ? [date] : [date, dentistId],
    );
    return response.json({ date, bookingFlow: flow, dentists: dentists.map((dentist) => ({ ...dentist, services: dentist.serviceTitles ? String(dentist.serviceTitles).split('|') : [] })), slots: slots.map((slot) => ({ ...slot, active: Boolean(slot.active) })) });
  } catch (error) { return next(error); }
});

app.post('/api/staff/slots', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
    const input = z.object({
      dentistId: z.number().int().positive().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      startTimes: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(48),
      durationMinutes: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]).optional().default(30),
      capacity: z.number().int().min(1).max(50).optional(),
    }).parse(request.body);
    if (input.startTimes.some((startTime) => overlapsLunchBreak(startTime, input.durationMinutes))) {
      return response.status(400).json({ message: 'ช่วงเวลาที่เลือกทับกับเวลาพักกลางวัน 12:00–13:00 น.' });
    }
    const flow = await bookingFlow();
    if (flow === 'TIME_ONLY') {
      let createdCount = 0;
      for (const startTime of [...new Set(input.startTimes)].sort()) {
        const [existing] = await pool.query<RowDataPacket[]>('SELECT id FROM booking_slots WHERE dentist_id IS NULL AND service_date = ? AND start_time = ?', [input.date, startTime]);
        if (existing[0]) continue;
        const [result] = await pool.query<ResultSetHeader>('INSERT INTO booking_slots (dentist_id, service_date, start_time, end_time, capacity) VALUES (NULL, ?, ?, ADDTIME(?, SEC_TO_TIME(?)), ?)', [input.date, startTime, startTime, input.durationMinutes * 60, input.capacity ?? 1]);
        createdCount += result.affectedRows;
      }
      return response.status(201).json({ message: createdCount ? `สร้างสล็อต ${createdCount} ช่วงเวลาเรียบร้อยแล้ว` : 'ช่วงเวลาที่เลือกมีอยู่แล้ว', createdCount });
    }
    if (!input.dentistId) return response.status(400).json({ message: 'กรุณาเลือกทันตแพทย์' });
    const [dentists] = await pool.query<RowDataPacket[]>(
      flow === 'DENTIST_ONLY'
        ? 'SELECT id FROM dentists WHERE id = ? AND active = TRUE LIMIT 1'
        : `SELECT d.id FROM dentists d JOIN dentist_services ds ON ds.dentist_id = d.id
           JOIN services s ON s.id = ds.service_id AND s.active = TRUE
           WHERE d.id = ? AND d.active = TRUE LIMIT 1`,
      [input.dentistId],
    );
    if (!dentists[0]) return response.status(400).json({ message: flow === 'DENTIST_ONLY' ? 'ไม่พบทันตแพทย์ที่เปิดให้บริการ' : 'ทันตแพทย์รายนี้ยังไม่มีหัตถการที่เปิดให้บริการ' });
    let createdCount = 0;
    for (const startTime of [...new Set(input.startTimes)].sort()) {
      const [result] = await pool.query<ResultSetHeader>(
        'INSERT IGNORE INTO booking_slots (dentist_id, service_date, start_time, end_time, capacity) VALUES (?, ?, ?, ADDTIME(?, SEC_TO_TIME(?)), 1)',
        [input.dentistId, input.date, startTime, startTime, input.durationMinutes * 60],
      );
      createdCount += result.affectedRows;
    }
    return response.status(201).json({ message: createdCount ? `สร้างสล็อต ${createdCount} ช่วงเวลาเรียบร้อยแล้ว` : 'ช่วงเวลาที่เลือกมีอยู่แล้ว', createdCount });
  } catch (error) { return next(error); }
});

/** ลบได้เฉพาะสล็อตที่ยังไม่มีนัดหมายเลย: lock สล็อตก่อนตรวจเพื่อไม่ให้ชนกับการจองที่กำลังเกิดขึ้น */
app.delete('/api/staff/slots/:id', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
    const slotId = Number(request.params.id);
    if (!Number.isInteger(slotId) || slotId <= 0) return response.status(404).json({ message: 'ไม่พบสล็อตที่ต้องการลบ' });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [slots] = await connection.query<RowDataPacket[]>('SELECT id FROM booking_slots WHERE id = ? FOR UPDATE', [slotId]);
      if (!slots[0]) { await connection.rollback(); return response.status(404).json({ message: 'ไม่พบสล็อตที่ต้องการลบ' }); }
      const [appointments] = await connection.query<RowDataPacket[]>('SELECT id FROM appointments WHERE slot_id = ? LIMIT 1', [slotId]);
      if (appointments[0]) { await connection.rollback(); return response.status(409).json({ message: 'ไม่สามารถลบสล็อตที่มีการจองแล้วได้' }); }
      await connection.query('DELETE FROM booking_slots WHERE id = ?', [slotId]);
      await connection.commit();
      return response.json({ message: 'ลบสล็อตเรียบร้อยแล้ว' });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  } catch (error) { return next(error); }
});

app.get('/api/staff/settings', async (request, response) => {
  if (!await requireStaff(request, response, ['IT_STAFF'])) return;
  const [services] = await pool.query<RowDataPacket[]>("SELECT id, title, category, duration_minutes AS durationMinutes, price_label AS priceLabel, active FROM services WHERE category <> 'รายการเดิม' ORDER BY category, id");
  const [dentists] = await pool.query<RowDataPacket[]>('SELECT id, display_name AS displayName, queue_prefix AS queuePrefix FROM dentists WHERE active = TRUE ORDER BY display_name');
  response.json({ services: services.map((service) => ({ ...service, active: Boolean(service.active) })), dentists, permissions: ['ประเภทบริการ', 'ทันตแพทย์', 'ผู้ใช้งาน', 'Queue Prefix'] });
});

app.get('/api/staff/system-settings', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF'])) return;
    const [mophSettings] = await pool.query<RowDataPacket[]>("SELECT setting_key AS settingKey, boolean_value AS booleanValue, text_value AS textValue FROM system_settings WHERE setting_key IN ('moph_alert_enabled', 'moph_alert_client_key', 'moph_alert_secret_key')");
    const moph = new Map(mophSettings.map((setting) => [setting.settingKey, setting]));
    return response.json({ reservationPaymentEnabled: await reservationPaymentEnabled(), reservationPaymentAmount, bookingFlow: await bookingFlow(), clinicTypes: await clinicTypes(), mophAlert: { enabled: Boolean(moph.get('moph_alert_enabled')?.booleanValue), clientKeyConfigured: Boolean(moph.get('moph_alert_client_key')?.textValue), secretKeyConfigured: Boolean(moph.get('moph_alert_secret_key')?.textValue), encryptionKeyConfigured: Boolean(config.mophAlertEncryptionKey) } });
  } catch (error) { return next(error); }
});

app.patch('/api/staff/system-settings/moph-alert', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF'])) return;
    const input = z.object({ enabled: z.boolean(), clientKey: z.string().trim().max(500).optional(), secretKey: z.string().trim().max(500).optional() }).parse(request.body);
    if ((input.clientKey || input.secretKey) && !config.mophAlertEncryptionKey) return response.status(409).json({ message: 'ยังไม่ได้ตั้งค่า MOPH_ALERT_ENCRYPTION_KEY บนเซิร์ฟเวอร์' });
    await pool.query("UPDATE system_settings SET boolean_value = ? WHERE setting_key = 'moph_alert_enabled'", [input.enabled]);
    if (input.clientKey) await pool.query("UPDATE system_settings SET text_value = ?, boolean_value = TRUE WHERE setting_key = 'moph_alert_client_key'", [encryptCredential(input.clientKey, config.mophAlertEncryptionKey)]);
    if (input.secretKey) await pool.query("UPDATE system_settings SET text_value = ?, boolean_value = TRUE WHERE setting_key = 'moph_alert_secret_key'", [encryptCredential(input.secretKey, config.mophAlertEncryptionKey)]);
    return response.json({ enabled: input.enabled, clientKeyConfigured: Boolean(input.clientKey), secretKeyConfigured: Boolean(input.secretKey), encryptionKeyConfigured: Boolean(config.mophAlertEncryptionKey) });
  } catch (error) { return next(error); }
});

app.get('/api/staff/notification-deliveries', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF'])) return;
    const search = String(request.query.search ?? '').trim();
    const [deliveries] = await pool.query<RowDataPacket[]>(`SELECT nd.id, nd.recipient_masked AS recipientMasked, nd.delivery_status AS deliveryStatus, nd.attempt_count AS attemptCount, nd.last_attempt_at AS lastAttemptAt, nd.sent_at AS sentAt, nd.response_status AS responseStatus, nd.error_message AS errorMessage, a.queue_number AS queueNumber FROM notification_deliveries nd JOIN appointments a ON a.id = nd.appointment_id WHERE a.queue_number LIKE ? OR nd.recipient_masked LIKE ? ORDER BY nd.updated_at DESC LIMIT 100`, [`%${search}%`, `%${search}%`]);
    return response.json({ deliveries });
  } catch (error) { return next(error); }
});

app.post('/api/staff/notification-deliveries/:id/retry', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF'])) return;
    const id = Number(request.params.id);
    const [result] = await pool.query<ResultSetHeader>("UPDATE notification_deliveries SET delivery_status = 'PENDING', attempt_count = 0, error_message = NULL, response_status = NULL WHERE id = ? AND delivery_status IN ('FAILED', 'INVALID_RECIPIENT')", [id]);
    if (!result.affectedRows) return response.status(409).json({ message: 'รายการนี้ยังไม่พร้อมส่งซ้ำ' });
    void processNotificationDeliveries();
    return response.json({ message: 'นำรายการเข้าคิวส่งซ้ำแล้ว' });
  } catch (error) { return next(error); }
});

app.get('/api/staff/patient-registry', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
    const search = String(request.query.search ?? '').trim();
    const [patients] = await pool.query<RowDataPacket[]>(
      `SELECT pr.patient_identity AS patientIdentity, pr.patient_display_name AS patientDisplayName, pr.access_status AS accessStatus,
              COUNT(pvr.id) AS bookingCount, SUM(pvr.visit_status = 'NO_SHOW') AS noShowCount
       FROM patient_registry pr LEFT JOIN patient_visit_registry pvr ON pvr.patient_identity = pr.patient_identity
       WHERE pr.patient_identity LIKE ? OR pr.patient_display_name LIKE ? GROUP BY pr.patient_identity ORDER BY pr.updated_at DESC`,
      [`%${search}%`, `%${search}%`],
    );
    return response.json({ patients: patients.map((patient) => ({ ...patient, bookingCount: Number(patient.bookingCount), noShowCount: Number(patient.noShowCount) })) });
  } catch (error) { return next(error); }
});

app.patch('/api/staff/patient-registry/:identity', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
    const input = z.object({ accessStatus: z.enum(['ACTIVE', 'BLOCKED']) }).parse(request.body);
    const [result] = await pool.query<ResultSetHeader>('UPDATE patient_registry SET access_status = ? WHERE patient_identity = ?', [input.accessStatus, request.params.identity]);
    if (!result.affectedRows) return response.status(404).json({ message: 'ไม่พบผู้ป่วยในทะเบียน' });
    return response.json({ patientIdentity: request.params.identity, accessStatus: input.accessStatus });
  } catch (error) { return next(error); }
});

app.patch('/api/staff/system-settings/reservation-payment', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF'])) return;
    const input = z.object({ enabled: z.boolean() }).parse(request.body);
    await pool.query("UPDATE system_settings SET boolean_value = ? WHERE setting_key = 'reservation_payment_enabled'", [input.enabled]);
    return response.json({ reservationPaymentEnabled: input.enabled, reservationPaymentAmount });
  } catch (error) { return next(error); }
});

app.patch('/api/staff/system-settings/booking-flow', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF'])) return;
    const input = z.object({ bookingFlow: z.enum(['PROCEDURE_AND_DENTIST', 'DENTIST_ONLY', 'TIME_ONLY']) }).parse(request.body);
    await pool.query("UPDATE system_settings SET text_value = ? WHERE setting_key = 'booking_flow'", [input.bookingFlow]);
    return response.json({ bookingFlow: input.bookingFlow });
  } catch (error) { return next(error); }
});

app.patch('/api/staff/system-settings/clinic-types', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF'])) return;
    const input = z.object({ clinicTypes: z.array(z.enum(['PMC', 'SMC'])).min(1) }).parse(request.body);
    const enabledTypes = defaultClinicTypes.filter((type) => input.clinicTypes.includes(type));
    await pool.query("UPDATE system_settings SET text_value = ? WHERE setting_key = 'clinic_types'", [enabledTypes.join(',')]);
    return response.json({ clinicTypes: enabledTypes });
  } catch (error) { return next(error); }
});

app.get('/api/staff/dentists', async (request, response) => {
  if (!await requireStaff(request, response, ['IT_STAFF'])) return;
  const [services] = await pool.query<RowDataPacket[]>("SELECT id, title, category FROM services WHERE active = TRUE AND category <> 'รายการเดิม' ORDER BY category, id");
  const [dentists] = await pool.query<RowDataPacket[]>('SELECT id, display_name AS displayName, professional_title AS title, specialty, queue_prefix AS queuePrefix, portrait_file_name AS portraitFileName, active FROM dentists ORDER BY active DESC, display_name');
  const [assignments] = await pool.query<RowDataPacket[]>(`SELECT ds.dentist_id AS dentistId, ds.service_id AS serviceId FROM dentist_services ds JOIN services s ON s.id = ds.service_id WHERE s.active = TRUE AND s.category <> 'รายการเดิม'`);
  const serviceIdsByDentist = new Map<number, number[]>();
  assignments.forEach((assignment) => { const serviceIds = serviceIdsByDentist.get(assignment.dentistId) ?? []; serviceIds.push(assignment.serviceId); serviceIdsByDentist.set(assignment.dentistId, serviceIds); });
  response.json({ bookingFlow: await bookingFlow(), services, dentists: dentists.map((dentist) => ({ id: dentist.id, displayName: dentist.displayName, title: dentist.title, specialty: dentist.specialty, queuePrefix: dentist.queuePrefix, portraitUrl: dentist.portraitFileName ? `/api/dentists/${dentist.id}/portrait` : null, active: Boolean(dentist.active), serviceIds: serviceIdsByDentist.get(dentist.id) ?? [] })) });
});

app.post('/api/staff/dentists', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF'])) return;
    const input = z.object({
      displayName: z.string().trim().min(2).max(160),
      title: z.enum(['ทพ.', 'ทพญ.']),
      specialty: z.string().trim().min(2).max(255),
      queuePrefix: z.string().trim().min(1).max(12).regex(/^[A-Z0-9-]+$/),
    }).parse(request.body);
    const [result] = await pool.query<ResultSetHeader>('INSERT INTO dentists (display_name, professional_title, specialty, queue_prefix, active) VALUES (?, ?, ?, ?, TRUE)', [input.displayName, input.title, input.specialty, input.queuePrefix]);
    return response.status(201).json({ dentist: { id: result.insertId, displayName: input.displayName, title: input.title, specialty: input.specialty, queuePrefix: input.queuePrefix, portraitUrl: null, active: true, serviceIds: [] } });
  } catch (error) { return next(error); }
});

app.post('/api/staff/dentists/:id/portrait', requireStaffBeforeBody(['IT_STAFF']), upload.single('portrait'), async (request, response, next) => {
  try {
    const dentistId = Number(request.params.id);
    if (!Number.isInteger(dentistId) || dentistId <= 0 || !request.file) return response.status(400).json({ message: 'กรุณาแนบรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB' });
    const [result] = await pool.query<ResultSetHeader>('UPDATE dentists SET portrait_file_name = ? WHERE id = ?', [request.file.filename, dentistId]);
    if (!result.affectedRows) return response.status(404).json({ message: 'ไม่พบทันตแพทย์ในทะเบียน' });
    return response.status(201).json({ portraitUrl: `/api/dentists/${dentistId}/portrait` });
  } catch (error) { return next(error); }
});

app.patch('/api/staff/dentists/:id', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF'])) return;
    const input = z.object({ active: z.boolean() }).parse(request.body);
    const [result] = await pool.query<ResultSetHeader>('UPDATE dentists SET active = ? WHERE id = ?', [input.active, Number(request.params.id)]);
    if (!result.affectedRows) return response.status(404).json({ message: 'ไม่พบทันตแพทย์ในทะเบียน' });
    const [dentists] = await pool.query<RowDataPacket[]>('SELECT id, display_name AS displayName, queue_prefix AS queuePrefix, active FROM dentists WHERE id = ?', [Number(request.params.id)]);
    return response.json({ dentist: { ...dentists[0], active: Boolean(dentists[0].active) } });
  } catch (error) { return next(error); }
});

app.delete('/api/staff/dentists/:id', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF'])) return;
    const dentistId = Number(request.params.id);
    if (!Number.isInteger(dentistId) || dentistId <= 0) return response.status(404).json({ message: 'ไม่พบทันตแพทย์ในทะเบียน' });
    const connection = await pool.getConnection();
    let portraitFileName: string | null = null;
    try {
      await connection.beginTransaction();
      const [dentists] = await connection.query<RowDataPacket[]>('SELECT portrait_file_name AS portraitFileName FROM dentists WHERE id = ? FOR UPDATE', [dentistId]);
      if (!dentists[0]) { await connection.rollback(); return response.status(404).json({ message: 'ไม่พบทันตแพทย์ในทะเบียน' }); }
      portraitFileName = dentists[0].portraitFileName ? String(dentists[0].portraitFileName) : null;
      const [[dependencies]] = await connection.query<RowDataPacket[]>(
        `SELECT
          (SELECT COUNT(*) FROM booking_slots WHERE dentist_id = ?) AS slotCount,
          (SELECT COUNT(*) FROM appointments WHERE dentist_id = ?) AS appointmentCount,
          (SELECT COUNT(*) FROM duty_roster_members WHERE dentist_id = ?) AS dutyCount,
          (SELECT COUNT(*) FROM satisfaction_surveys WHERE dentist_id = ?) AS surveyCount`,
        [dentistId, dentistId, dentistId, dentistId],
      );
      if (Object.values(dependencies).some((count) => Number(count) > 0)) {
        await connection.rollback();
        return response.status(409).json({ message: 'ไม่สามารถลบทันตแพทย์ที่มีสล็อต นัดหมาย หรือประวัติลงเวรแล้วได้ กรุณาปิดใช้งานแทน' });
      }
      await connection.query('DELETE FROM dentist_services WHERE dentist_id = ?', [dentistId]);
      await connection.query('DELETE FROM dentists WHERE id = ?', [dentistId]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    if (portraitFileName) await unlink(join(uploadDirectory, basename(portraitFileName))).catch(() => undefined);
    return response.json({ message: 'ลบรายชื่อทันตแพทย์เรียบร้อยแล้ว' });
  } catch (error) { return next(error); }
});

app.patch('/api/staff/services/:id', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF'])) return;
    const input = z.object({ active: z.boolean() }).parse(request.body);
    const [result] = await pool.query<ResultSetHeader>('UPDATE services SET active = ? WHERE id = ?', [input.active, Number(request.params.id)]);
    if (!result.affectedRows) return response.status(404).json({ message: 'ไม่พบหัตถการในทะเบียน' });
    const [services] = await pool.query<RowDataPacket[]>('SELECT id, title, category, duration_minutes AS durationMinutes, price_label AS priceLabel, active FROM services WHERE id = ?', [Number(request.params.id)]);
    return response.json({ service: { ...services[0], active: Boolean(services[0].active) } });
  } catch (error) { return next(error); }
});

/** สรุปตารางเวรของสัปดาห์นี้ ใช้ร่วมกันทั้งหน้า /team สาธารณะ และ dashboard ผู้จัดการ */
async function weeklyDutySchedule() {
  const { start, end } = currentWeekRange();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT m.id AS rosterMemberId, m.dentist_id AS dentistId, COALESCE(d.display_name, m.source_name) AS displayName,
            d.portrait_file_name AS portraitFileName,
            DATE_FORMAT(dd.duty_date, '%Y-%m-%d') AS date
     FROM duty_roster_days dd
     JOIN duty_roster_members m ON m.id = dd.member_id
     LEFT JOIN dentists d ON d.id = m.dentist_id
     WHERE dd.duty_date BETWEEN ? AND ? AND (d.id IS NULL OR d.active = TRUE)
     ORDER BY d.display_name, dd.duty_date`,
    [start, end],
  );
  const dentistsById = new Map<number, { id: number; displayName: string; portraitUrl: string | null; dates: string[] }>();
  rows.forEach((row) => {
    // แถวที่นำเข้าจากตารางเวรอาจยังไม่ได้จับคู่ dentist_id — ให้แสดง source_name บนตารางสาธารณะ
    // โดยใช้ id ติดลบเฉพาะเป็น React/API key จนกว่าเจ้าหน้าที่จะจับคู่รายชื่อในทะเบียน
    const dentistId = row.dentistId === null ? -Number(row.rosterMemberId) : Number(row.dentistId);
    if (!dentistsById.has(dentistId)) dentistsById.set(dentistId, { id: dentistId, displayName: String(row.displayName), portraitUrl: row.portraitFileName && dentistId > 0 ? `/api/dentists/${dentistId}/portrait` : null, dates: [] });
    dentistsById.get(dentistId)!.dates.push(String(row.date));
  });
  return { weekStart: start, weekEnd: end, dentists: [...dentistsById.values()] };
}

app.get('/api/dentists/weekly-duty-schedule', async (_request, response, next) => {
  try {
    return response.json(await weeklyDutySchedule());
  } catch (error) { return next(error); }
});

app.get('/api/staff/dashboard', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF', 'MANAGER'])) return;

    const [totalsRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS totalBookings, SUM(appointment_status = 'PENDING_CONFIRMATION') AS pendingConfirmation,
              SUM(appointment_status = 'CONFIRMED') AS confirmedBookings, SUM(appointment_status = 'CANCELLED') AS cancelledBookings,
              COALESCE(SUM(payment_amount), 0) AS bookingValue
       FROM appointments`,
    );
    const totals = totalsRows[0];

    const [todayCountRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total, SUM(a.appointment_status = 'CONFIRMED') AS confirmed, SUM(a.appointment_status = 'PENDING_CONFIRMATION') AS pending
       FROM appointments a JOIN booking_slots bs ON bs.id = a.slot_id
       WHERE bs.service_date = CURDATE() AND a.appointment_status <> 'CANCELLED'`,
    );
    const [todayAppointments] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.queue_number AS queueNumber, a.appointment_status AS status, a.payment_status AS paymentStatus,
              a.patient_display_name AS patientName, TIME_FORMAT(bs.start_time, '%H:%i') AS startTime,
              COALESCE(s.title, 'คิวกลาง') AS serviceName, COALESCE(d.display_name, 'คิวกลางคลินิก') AS dentistName
       FROM appointments a JOIN booking_slots bs ON bs.id = a.slot_id
       LEFT JOIN services s ON s.id = a.service_id LEFT JOIN dentists d ON d.id = a.dentist_id
       WHERE bs.service_date = CURDATE() AND a.appointment_status <> 'CANCELLED'
       ORDER BY bs.start_time LIMIT 200`,
    );

    const [last7DaysRows] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(bs.service_date, '%Y-%m-%d') AS date, COUNT(*) AS bookings, COALESCE(SUM(a.payment_amount), 0) AS revenue
       FROM appointments a JOIN booking_slots bs ON bs.id = a.slot_id
       WHERE bs.service_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 6 DAY) AND CURDATE() AND a.appointment_status <> 'CANCELLED'
       GROUP BY bs.service_date`,
    );
    const last7DaysByDate = new Map(last7DaysRows.map((row) => [String(row.date), { bookings: Number(row.bookings), revenue: Number(row.revenue) }]));
    const last7Days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.now() - (6 - index) * 86_400_000).toISOString().slice(0, 10);
      const entry = last7DaysByDate.get(date);
      return { date, bookings: entry?.bookings ?? 0, revenue: entry?.revenue ?? 0 };
    });

    const [topServices] = await pool.query<RowDataPacket[]>(
      `SELECT s.title, s.category, COUNT(*) AS bookings
       FROM appointments a JOIN services s ON s.id = a.service_id JOIN booking_slots bs ON bs.id = a.slot_id
       WHERE bs.service_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') AND a.appointment_status <> 'CANCELLED'
       GROUP BY s.id ORDER BY bookings DESC LIMIT 5`,
    );

    const [patientRows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS totalPatients, SUM(access_status = 'BLOCKED') AS blockedPatients FROM patient_registry");
    const [noShowRows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS noShowCount FROM patient_visit_registry WHERE visit_status = 'NO_SHOW'");

    const duty = await weeklyDutySchedule();

    return response.json({
      totals: {
        totalBookings: Number(totals.totalBookings), pendingConfirmation: Number(totals.pendingConfirmation),
        confirmedBookings: Number(totals.confirmedBookings), cancelledBookings: Number(totals.cancelledBookings), bookingValue: Number(totals.bookingValue),
      },
      today: {
        date: new Date().toISOString().slice(0, 10), total: Number(todayCountRows[0].total ?? 0), confirmed: Number(todayCountRows[0].confirmed ?? 0), pending: Number(todayCountRows[0].pending ?? 0),
        appointments: todayAppointments,
      },
      last7Days,
      topServices: topServices.map((service) => ({ title: service.title, category: service.category, bookings: Number(service.bookings) })),
      patients: { totalPatients: Number(patientRows[0].totalPatients ?? 0), blockedPatients: Number(patientRows[0].blockedPatients ?? 0), noShowCount: Number(noShowRows[0].noShowCount ?? 0) },
      duty: { weekStart: duty.weekStart, weekEnd: duty.weekEnd, dentists: duty.dentists.map((dentist) => ({ id: dentist.id, displayName: dentist.displayName, dutyDayCount: dentist.dates.length })) },
    });
  } catch (error) { return next(error); }
});

const reportDateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reportStatusInput = z.enum(['PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED']);

function optionalQueryString(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : undefined;
}

/** อัตรา no-show คิดจากนัดที่ถึงกำหนดแล้ว (SERVED + NO_SHOW) ไม่รวมนัดที่ยังรอเข้าพบ */
function visitNoShowRate(row: RowDataPacket) {
  const denominator = Number(row.served) + Number(row.noShow);
  return denominator ? Math.round((Number(row.noShow) / denominator) * 1000) / 10 : 0;
}

/** รายงานนัดหมายทั้งหมดแบบอ่านอย่างเดียว กรองตามช่วงวันที่ ทันตแพทย์ สถานะ และคำค้น */
app.get('/api/staff/reports/appointments', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF', 'MANAGER'])) return;
    const from = reportDateInput.optional().parse(optionalQueryString(request.query.from));
    const to = reportDateInput.optional().parse(optionalQueryString(request.query.to));
    const dentistId = optionalQueryString(request.query.dentistId) === undefined ? undefined : z.coerce.number().int().positive().parse(request.query.dentistId);
    const status = reportStatusInput.optional().parse(optionalQueryString(request.query.status));
    const search = optionalQueryString(request.query.search);
    const conditions = ['1 = 1'];
    const params: unknown[] = [];
    if (from) { conditions.push('bs.service_date >= ?'); params.push(from); }
    if (to) { conditions.push('bs.service_date <= ?'); params.push(to); }
    if (dentistId !== undefined) { conditions.push('a.dentist_id = ?'); params.push(dentistId); }
    if (status) { conditions.push('a.appointment_status = ?'); params.push(status); }
    if (search) {
      conditions.push('(a.patient_display_name LIKE ? OR a.patient_phone LIKE ? OR a.queue_number LIKE ? OR a.reference_code LIKE ? OR a.patient_identity LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const [summaryRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(a.appointment_status = 'PENDING_CONFIRMATION'), 0) AS pending,
              COALESCE(SUM(a.appointment_status = 'CONFIRMED'), 0) AS confirmed,
              COALESCE(SUM(a.appointment_status = 'CANCELLED'), 0) AS cancelled,
              COALESCE(SUM(CASE WHEN a.appointment_status <> 'CANCELLED' THEN a.payment_amount ELSE 0 END), 0) AS bookingValue
       FROM appointments a JOIN booking_slots bs ON bs.id = a.slot_id ${where}`,
      params,
    );
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.reference_code AS referenceCode, a.queue_number AS queueNumber,
              a.patient_display_name AS patientName, a.patient_phone AS phone,
              a.appointment_status AS status, a.payment_status AS paymentStatus, a.payment_amount AS paymentAmount,
              COALESCE(s.title, 'ยังไม่ระบุหัตถการ') AS serviceName, COALESCE(d.display_name, 'คิวกลางคลินิก') AS dentistName,
              DATE_FORMAT(bs.service_date, '%Y-%m-%d') AS serviceDate, TIME_FORMAT(bs.start_time, '%H:%i') AS startTime
       FROM appointments a
       JOIN booking_slots bs ON bs.id = a.slot_id
       LEFT JOIN services s ON s.id = a.service_id
       LEFT JOIN dentists d ON d.id = a.dentist_id
       ${where}
       ORDER BY bs.service_date DESC, bs.start_time DESC, a.id DESC
       LIMIT 500`,
      params,
    );
    const summary = summaryRows[0];
    return response.json({
      summary: {
        total: Number(summary.total), pending: Number(summary.pending), confirmed: Number(summary.confirmed),
        cancelled: Number(summary.cancelled), bookingValue: Number(summary.bookingValue),
      },
      appointments: rows.map(({ referenceCode, ...row }) => ({ reference: referenceCode, ...row, paymentAmount: Number(row.paymentAmount) })),
    });
  } catch (error) { return next(error); }
});

/** รายงานการเข้าพบและ no-show สรุปตามช่วงวันที่ (default ย้อนหลัง 6 เดือน) ไม่รวมนัดที่ยกเลิก */
app.get('/api/staff/reports/visits', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF', 'MANAGER'])) return;
    const now = new Date();
    const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)).toISOString().slice(0, 10);
    const from = reportDateInput.parse(optionalQueryString(request.query.from) ?? defaultFrom);
    const to = reportDateInput.parse(optionalQueryString(request.query.to) ?? now.toISOString().slice(0, 10));
    const visitCounts = `COUNT(*) AS total,
        COALESCE(SUM(pvr.visit_status = 'SERVED'), 0) AS served,
        COALESCE(SUM(pvr.visit_status = 'NO_SHOW'), 0) AS noShow,
        COALESCE(SUM(pvr.visit_status = 'BOOKED'), 0) AS booked`;
    const visitTables = 'FROM patient_visit_registry pvr JOIN appointments a ON a.id = pvr.appointment_id JOIN booking_slots bs ON bs.id = a.slot_id';
    const visitWhere = "WHERE bs.service_date BETWEEN ? AND ? AND a.appointment_status <> 'CANCELLED'";
    const params = [from, to];
    const [summaryRows] = await pool.query<RowDataPacket[]>(`SELECT ${visitCounts} ${visitTables} ${visitWhere}`, params);
    const [monthlyRows] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(bs.service_date, '%Y-%m') AS month, ${visitCounts} ${visitTables} ${visitWhere}
       GROUP BY DATE_FORMAT(bs.service_date, '%Y-%m') ORDER BY month DESC`,
      params,
    );
    const [dentistRows] = await pool.query<RowDataPacket[]>(
      `SELECT d.id AS dentistId, COALESCE(d.display_name, 'คิวกลางคลินิก') AS dentistName, ${visitCounts} ${visitTables}
       LEFT JOIN dentists d ON d.id = a.dentist_id ${visitWhere}
       GROUP BY d.id, d.display_name ORDER BY total DESC, dentistName`,
      params,
    );
    const summary = summaryRows[0];
    return response.json({
      range: { from, to },
      summary: {
        total: Number(summary.total), served: Number(summary.served), noShow: Number(summary.noShow),
        booked: Number(summary.booked), noShowRate: visitNoShowRate(summary),
      },
      monthly: monthlyRows.map((row) => ({
        month: String(row.month), total: Number(row.total), served: Number(row.served),
        noShow: Number(row.noShow), booked: Number(row.booked), noShowRate: visitNoShowRate(row),
      })),
      byDentist: dentistRows.map((row) => ({
        dentistId: row.dentistId === null ? null : Number(row.dentistId), dentistName: String(row.dentistName),
        total: Number(row.total), served: Number(row.served), noShow: Number(row.noShow),
        booked: Number(row.booked), noShowRate: visitNoShowRate(row),
      })),
    });
  } catch (error) { return next(error); }
});

/** รายงานค่าจองคิวแยกตามเดือน/หัตถการ พร้อมสถานะการชำระเงิน (ไม่รวมนัดที่ยกเลิก) */
app.get('/api/staff/reports/revenue', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF', 'MANAGER'])) return;
    const now = new Date();
    const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)).toISOString().slice(0, 10);
    const from = reportDateInput.parse(optionalQueryString(request.query.from) ?? defaultFrom);
    const to = reportDateInput.parse(optionalQueryString(request.query.to) ?? now.toISOString().slice(0, 10));
    const statusSums = `COUNT(*) AS bookings, COALESCE(SUM(a.payment_amount), 0) AS revenue,
        COALESCE(SUM(a.payment_status = 'AWAITING_PAYMENT'), 0) AS awaitingPayment,
        COALESCE(SUM(a.payment_status = 'SLIP_UPLOADED'), 0) AS slipUploaded,
        COALESCE(SUM(a.payment_status = 'VERIFIED'), 0) AS verified,
        COALESCE(SUM(a.payment_status = 'REJECTED'), 0) AS rejected,
        COALESCE(SUM(a.payment_status = 'NOT_REQUIRED'), 0) AS notRequired`;
    const revenueTables = 'FROM appointments a JOIN booking_slots bs ON bs.id = a.slot_id';
    const revenueWhere = "WHERE bs.service_date BETWEEN ? AND ? AND a.appointment_status <> 'CANCELLED'";
    const params = [from, to];
    const [summaryRows] = await pool.query<RowDataPacket[]>(`SELECT ${statusSums} ${revenueTables} ${revenueWhere}`, params);
    const [monthlyRows] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(bs.service_date, '%Y-%m') AS month, ${statusSums} ${revenueTables} ${revenueWhere}
       GROUP BY DATE_FORMAT(bs.service_date, '%Y-%m') ORDER BY month DESC`,
      params,
    );
    const [serviceRows] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(s.title, 'ยังไม่ระบุหัตถการ') AS serviceName, ${statusSums} ${revenueTables}
       LEFT JOIN services s ON s.id = a.service_id ${revenueWhere}
       GROUP BY s.id, s.title ORDER BY revenue DESC, bookings DESC`,
      params,
    );
    const toNumbers = (row: RowDataPacket) => ({
      bookings: Number(row.bookings), revenue: Number(row.revenue), awaitingPayment: Number(row.awaitingPayment),
      slipUploaded: Number(row.slipUploaded), verified: Number(row.verified), rejected: Number(row.rejected), notRequired: Number(row.notRequired),
    });
    return response.json({
      range: { from, to },
      summary: toNumbers(summaryRows[0]),
      monthly: monthlyRows.map((row) => ({ month: String(row.month), ...toNumbers(row) })),
      byService: serviceRows.map((row) => ({ serviceName: String(row.serviceName), ...toNumbers(row) })),
    });
  } catch (error) { return next(error); }
});

/** รายงานผลิตภาพทันตแพทย์: จำนวนนัดเทียบกับวันลงเวรจริงจากทะเบียนลงเวร (ไม่รวมคิวกลางและนัดที่ยกเลิก) */
app.get('/api/staff/reports/dentist-productivity', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF', 'MANAGER'])) return;
    const now = new Date();
    const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)).toISOString().slice(0, 10);
    const from = reportDateInput.parse(optionalQueryString(request.query.from) ?? defaultFrom);
    const to = reportDateInput.parse(optionalQueryString(request.query.to) ?? now.toISOString().slice(0, 10));
    const [appointmentRows] = await pool.query<RowDataPacket[]>(
      `SELECT a.dentist_id AS dentistId, d.display_name AS dentistName, COUNT(*) AS appointments
       FROM appointments a JOIN booking_slots bs ON bs.id = a.slot_id LEFT JOIN dentists d ON d.id = a.dentist_id
       WHERE bs.service_date BETWEEN ? AND ? AND a.appointment_status <> 'CANCELLED' AND a.dentist_id IS NOT NULL
       GROUP BY a.dentist_id, d.display_name`,
      [from, to],
    );
    const [dutyRows] = await pool.query<RowDataPacket[]>(
      `SELECT m.dentist_id AS dentistId, COUNT(DISTINCT dd.duty_date) AS dutyDays
       FROM duty_roster_days dd JOIN duty_roster_members m ON m.id = dd.member_id
       WHERE dd.duty_date BETWEEN ? AND ? AND m.dentist_id IS NOT NULL GROUP BY m.dentist_id`,
      [from, to],
    );
    const dentistById = new Map<number, { dentistId: number; dentistName: string; appointments: number; dutyDays: number }>();
    appointmentRows.forEach((row) => dentistById.set(Number(row.dentistId), { dentistId: Number(row.dentistId), dentistName: String(row.dentistName ?? 'ไม่ทราบชื่อ'), appointments: Number(row.appointments), dutyDays: 0 }));
    dutyRows.forEach((row) => {
      const dentistId = Number(row.dentistId);
      const entry = dentistById.get(dentistId) ?? { dentistId, dentistName: 'ไม่ทราบชื่อ', appointments: 0, dutyDays: 0 };
      entry.dutyDays = Number(row.dutyDays);
      if (!dentistById.has(dentistId)) dentistById.set(dentistId, entry);
    });
    const dentists = [...dentistById.values()].sort((left, right) => right.appointments - left.appointments || left.dentistName.localeCompare(right.dentistName, 'th'));
    return response.json({
      range: { from, to },
      dentists: dentists.map((dentist) => ({
        ...dentist,
        appointmentsPerDutyDay: dentist.dutyDays ? Math.round((dentist.appointments / dentist.dutyDays) * 100) / 100 : null,
      })),
    });
  } catch (error) { return next(error); }
});

/** ภาพรวมการส่ง MOPH Alert แบบอ่านอย่างเดียว (การตั้งค่าและส่งซ้ำยังอยู่กับ IT_STAFF) */
app.get('/api/staff/reports/notifications', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF', 'MANAGER'])) return;
    const [summaryRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(delivery_status = 'SENT'), 0) AS sent,
              COALESCE(SUM(delivery_status = 'PENDING'), 0) AS pending,
              COALESCE(SUM(delivery_status = 'SENDING'), 0) AS sending,
              COALESCE(SUM(delivery_status = 'FAILED'), 0) AS failed,
              COALESCE(SUM(delivery_status = 'INVALID_RECIPIENT'), 0) AS invalidRecipient
       FROM notification_deliveries`,
    );
    const [recentRows] = await pool.query<RowDataPacket[]>(
      `SELECT nd.id, a.queue_number AS queueNumber, nd.recipient_masked AS recipientMasked,
              nd.delivery_status AS status, nd.attempt_count AS attemptCount,
              DATE_FORMAT(nd.last_attempt_at, '%Y-%m-%d %H:%i') AS lastAttemptAt,
              DATE_FORMAT(nd.sent_at, '%Y-%m-%d %H:%i') AS sentAt,
              nd.response_status AS responseStatus, nd.error_message AS errorMessage
       FROM notification_deliveries nd JOIN appointments a ON a.id = nd.appointment_id
       ORDER BY nd.updated_at DESC LIMIT 20`,
    );
    const summary = summaryRows[0];
    const sent = Number(summary.sent);
    const total = Number(summary.total);
    return response.json({
      summary: {
        total, sent, pending: Number(summary.pending), sending: Number(summary.sending),
        failed: Number(summary.failed), invalidRecipient: Number(summary.invalidRecipient),
        successRate: total ? Math.round((sent / total) * 1000) / 10 : 0,
      },
      recent: recentRows,
    });
  } catch (error) { return next(error); }
});

/** ช่วงเวลานิยม: นับนัดที่ยังไม่ยกเลิกตามวันของสัปดาห์และชั่วโมง เพื่อวางแผนกำลังคน */
app.get('/api/staff/reports/peak-hours', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF', 'MANAGER'])) return;
    const conditions = ['a.appointment_status <> \'CANCELLED\''];
    const params: unknown[] = [];
    const from = reportDateInput.optional().parse(optionalQueryString(request.query.from));
    const to = reportDateInput.optional().parse(optionalQueryString(request.query.to));
    if (from) { conditions.push('bs.service_date >= ?'); params.push(from); }
    if (to) { conditions.push('bs.service_date <= ?'); params.push(to); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const peakTables = 'FROM appointments a JOIN booking_slots bs ON bs.id = a.slot_id';
    const [weekdayRows] = await pool.query<RowDataPacket[]>(
      `SELECT DAYOFWEEK(bs.service_date) AS dow, COUNT(*) AS bookings ${peakTables} ${where} GROUP BY DAYOFWEEK(bs.service_date) ORDER BY bookings DESC`,
      params,
    );
    const [hourRows] = await pool.query<RowDataPacket[]>(
      `SELECT HOUR(bs.start_time) AS hour, COUNT(*) AS bookings ${peakTables} ${where} GROUP BY HOUR(bs.start_time) ORDER BY hour`,
      params,
    );
    const [gridRows] = await pool.query<RowDataPacket[]>(
      `SELECT DAYOFWEEK(bs.service_date) AS dow, HOUR(bs.start_time) AS hour, COUNT(*) AS bookings ${peakTables} ${where}
       GROUP BY DAYOFWEEK(bs.service_date), HOUR(bs.start_time)`,
      params,
    );
    return response.json({
      byWeekday: weekdayRows.map((row) => ({ dow: Number(row.dow), bookings: Number(row.bookings) })),
      byHour: hourRows.map((row) => ({ hour: Number(row.hour), bookings: Number(row.bookings) })),
      grid: gridRows.map((row) => ({ dow: Number(row.dow), hour: Number(row.hour), bookings: Number(row.bookings) })),
    });
  } catch (error) { return next(error); }
});

app.get('/api/staff/users', async (request, response) => {
  if (!await requireStaff(request, response, ['IT_STAFF'])) return;
  const [users] = await pool.query<RowDataPacket[]>(
    `SELECT id, provider_identity AS providerIdentity, display_name AS displayName, provider_title AS title,
            provider_email AS email, department, provider_hcode AS hcode,
            role, approval_status AS status, created_at AS createdAt
     FROM staff_users ORDER BY approval_status ASC, display_name ASC`,
  );
  response.json({ users });
});

app.patch('/api/staff/users/:id', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF'])) return;
    const input = z.object({
      role: z.enum(['IT_STAFF', 'CLINIC_STAFF', 'MANAGER']),
      status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'DISABLED']),
    }).parse(request.body);
    const [result] = await pool.query<ResultSetHeader>(
      'UPDATE staff_users SET role = ?, approval_status = ? WHERE id = ?',
      [input.role, input.status, Number(request.params.id)],
    );
    if (!result.affectedRows) return response.status(404).json({ message: 'ไม่พบผู้ใช้งานในทะเบียน' });
    const [users] = await pool.query<RowDataPacket[]>(
      `SELECT id, provider_identity AS providerIdentity, display_name AS displayName, provider_title AS title,
              provider_email AS email, department, provider_hcode AS hcode,
              role, approval_status AS status, created_at AS createdAt
       FROM staff_users WHERE id = ?`,
      [Number(request.params.id)],
    );
    return response.json({ user: users[0] });
  } catch (error) { return next(error); }
});

app.put('/api/staff/dentists/:id/queue-prefix', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF'])) return;
    const input = z.object({ queuePrefix: z.string().trim().min(1).max(12).regex(/^[A-Z0-9-]+$/) }).parse(request.body);
    const [result] = await pool.query<ResultSetHeader>('UPDATE dentists SET queue_prefix = ? WHERE id = ? AND active = TRUE', [input.queuePrefix, Number(request.params.id)]);
    if (!result.affectedRows) return response.status(404).json({ message: 'ไม่พบทันตแพทย์ในทะเบียน' });
    return response.json({ message: 'บันทึกอักษรนำหน้าคิวเรียบร้อยแล้ว' });
  } catch (error) { return next(error); }
});

app.put('/api/staff/dentists/:id/specialty', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['IT_STAFF'])) return;
    const input = z.object({ specialty: z.string().trim().min(2).max(255) }).parse(request.body);
    const dentistId = Number(request.params.id);
    const [result] = await pool.query<ResultSetHeader>('UPDATE dentists SET specialty = ? WHERE id = ? AND active = TRUE', [input.specialty, dentistId]);
    if (!result.affectedRows) return response.status(404).json({ message: 'ไม่พบทันตแพทย์ในทะเบียน' });
    return response.json({ message: 'บันทึกความเชี่ยวชาญของทันตแพทย์เรียบร้อยแล้ว', dentist: { id: dentistId, specialty: input.specialty } });
  } catch (error) { return next(error); }
});

app.put('/api/staff/dentists/:id/services', async (request, response, next) => {
  const dentistId = Number(request.params.id);
  try {
    if (!await requireStaff(request, response, ['IT_STAFF'])) return;
    if (!Number.isInteger(dentistId) || dentistId <= 0) return response.status(404).json({ message: 'ไม่พบทันตแพทย์ในทะเบียน' });
    const input = z.object({ serviceIds: z.array(z.number().int().positive()) }).parse(request.body);
    const serviceIds = [...new Set(input.serviceIds)];
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [dentists] = await connection.query<RowDataPacket[]>('SELECT id FROM dentists WHERE id = ? AND active = TRUE FOR UPDATE', [dentistId]);
      if (!dentists[0]) { await connection.rollback(); return response.status(404).json({ message: 'ไม่พบทันตแพทย์ในทะเบียน' }); }
      if (serviceIds.length) {
        const [services] = await connection.query<RowDataPacket[]>("SELECT id FROM services WHERE id IN (?) AND active = TRUE AND category <> 'รายการเดิม'", [serviceIds]);
        if (services.length !== serviceIds.length) { await connection.rollback(); return response.status(400).json({ message: 'พบหัตถการที่ไม่พร้อมให้กำหนดแก่ทันตแพทย์' }); }
      }
      await connection.query('DELETE FROM dentist_services WHERE dentist_id = ?', [dentistId]);
      if (serviceIds.length) await connection.query('INSERT INTO dentist_services (dentist_id, service_id) VALUES ?', [serviceIds.map((serviceId) => [dentistId, serviceId])]);
      await connection.commit();
      return response.json({ message: 'บันทึกหัตถการของทันตแพทย์เรียบร้อยแล้ว', dentist: { id: dentistId, serviceIds } });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  } catch (error) { return next(error); }
});

app.post('/api/staff/appointments/:id/approve-payment', async (request, response) => {
  if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
  const appointmentId = Number(request.params.id);
  const [result] = await pool.query<ResultSetHeader>("UPDATE appointments SET payment_status = 'VERIFIED', appointment_status = 'CONFIRMED' WHERE id = ? AND payment_status = 'SLIP_UPLOADED'", [appointmentId]);
  if (!result.affectedRows) return response.status(409).json({ message: 'รายการนี้ไม่อยู่ในสถานะรอตรวจสอบสลิป' });
  await pool.query('UPDATE payment_slips SET reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE appointment_id = ?', [staffActor(response), appointmentId]);
  await pool.query("INSERT INTO appointment_status_history (appointment_id, appointment_status, payment_status, actor) VALUES (?, 'CONFIRMED', 'VERIFIED', ?)", [appointmentId, staffActor(response)]);
  await queueAppointmentConfirmation(appointmentId);
  return response.json({ message: 'ยืนยันนัดหมายแล้ว' });
});

app.post('/api/staff/appointments/:id/confirm', async (request, response) => {
  if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
  const appointmentId = Number(request.params.id);
  const [result] = await pool.query<ResultSetHeader>("UPDATE appointments SET appointment_status = 'CONFIRMED' WHERE id = ? AND appointment_status = 'PENDING_CONFIRMATION' AND payment_status = 'NOT_REQUIRED'", [appointmentId]);
  if (!result.affectedRows) return response.status(409).json({ message: 'รายการนี้ไม่อยู่ในสถานะรอยืนยันโดยเจ้าหน้าที่' });
  await pool.query("INSERT INTO appointment_status_history (appointment_id, appointment_status, payment_status, actor) VALUES (?, 'CONFIRMED', 'NOT_REQUIRED', ?)", [appointmentId, staffActor(response)]);
  await queueAppointmentConfirmation(appointmentId);
  return response.json({ message: 'ยืนยันคิวแล้ว' });
});


const dutyMonthInput = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

async function dutyRosterDetail(month: string) {
  const [rosters] = await pool.query<RowDataPacket[]>(
    "SELECT id, duty_month AS month, roster_title AS title, source_file_name AS sourceFileName, uploaded_by AS uploadedBy, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i') AS updatedAt FROM duty_rosters WHERE duty_month = ?",
    [month],
  );
  const roster = rosters[0];
  if (!roster) return null;
  const [members] = await pool.query<RowDataPacket[]>(
    `SELECT m.id, m.sequence_no AS sequenceNo, m.source_name AS sourceName, m.dentist_id AS dentistId, d.display_name AS dentistName, d.queue_prefix AS queuePrefix
     FROM duty_roster_members m LEFT JOIN dentists d ON d.id = m.dentist_id
     WHERE m.roster_id = ? ORDER BY COALESCE(m.sequence_no, 9999), m.id`,
    [roster.id],
  );
  const [days] = await pool.query<RowDataPacket[]>(
    `SELECT dd.member_id AS memberId, DATE_FORMAT(dd.duty_date, '%Y-%m-%d') AS dutyDate, DAYOFMONTH(dd.duty_date) AS day, dd.duty_mark AS mark
     FROM duty_roster_days dd JOIN duty_roster_members m ON m.id = dd.member_id WHERE m.roster_id = ? ORDER BY dd.duty_date`,
    [roster.id],
  );
  const daysByMember = new Map<number, RowDataPacket[]>();
  days.forEach((row) => { const list = daysByMember.get(row.memberId) ?? []; list.push(row); daysByMember.set(row.memberId, list); });
  const { holidays, source: holidaySource } = await getThaiHolidaysForMonth(month);
  return {
    roster: { month: String(roster.month), title: String(roster.title), sourceFileName: roster.sourceFileName, uploadedBy: roster.uploadedBy, updatedAt: roster.updatedAt, daysInMonth: daysInMonth(month) },
    holidays,
    holidaySource,
    members: members.map((member) => ({
      id: member.id,
      sequenceNo: member.sequenceNo,
      name: member.dentistName ?? member.sourceName,
      sourceName: member.sourceName,
      dentistId: member.dentistId,
      queuePrefix: member.queuePrefix,
      dutyDays: (daysByMember.get(member.id) ?? []).map((row) => ({ day: Number(row.day), date: String(row.dutyDate), mark: String(row.mark) })),
    })),
  };
}

app.post('/api/staff/duty-rosters/parse', requireStaffBeforeBody(['CLINIC_STAFF']), rosterUpload.single('roster'), async (request, response, next) => {
  try {
    if (!request.file) return response.status(400).json({ message: 'กรุณาแนบไฟล์ Excel (.xlsx หรือ .xlsm) ขนาดไม่เกิน 5 MB' });
    const { sheetName, grid } = await readDutyRosterGrid(request.file.buffer);
    const parsed = parseDutyRosterGrid(grid);
    const [dentists] = await pool.query<RowDataPacket[]>('SELECT id, display_name AS displayName, active FROM dentists ORDER BY active DESC, display_name');
    const roster = dentists.map((dentist) => ({ id: Number(dentist.id), displayName: String(dentist.displayName), active: Boolean(dentist.active) }));
    const rows = parsed.rows.map((row) => {
      const matched = matchDentist(row.name, roster);
      return { sequenceNo: row.sequenceNo, name: row.name, dentistId: matched?.id ?? null, matchedName: matched?.displayName ?? null, days: row.days };
    });
    const unmatched = rows.filter((row) => row.dentistId === null).length;
    const warnings = [...parsed.warnings];
    if (unmatched) warnings.push(`มี ${unmatched} รายชื่อที่ยังจับคู่กับทะเบียนทันตแพทย์ไม่ได้ กรุณาเลือกด้วยตนเองก่อนบันทึก`);
    return response.json({ sheetName, title: parsed.title, detectedMonth: parsed.detectedMonth, sourceFileName: request.file.originalname, rows, skippedNames: parsed.skippedNames, warnings, dentists: roster });
  } catch (error) { return next(error); }
});

app.get('/api/staff/duty-rosters', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
    const [rosters] = await pool.query<RowDataPacket[]>(
      `SELECT r.duty_month AS month, r.roster_title AS title, r.source_file_name AS sourceFileName, r.uploaded_by AS uploadedBy,
              DATE_FORMAT(r.updated_at, '%Y-%m-%d %H:%i') AS updatedAt,
              COUNT(DISTINCT m.id) AS memberCount, COUNT(dd.id) AS dutyCount
       FROM duty_rosters r LEFT JOIN duty_roster_members m ON m.roster_id = r.id LEFT JOIN duty_roster_days dd ON dd.member_id = m.id
       GROUP BY r.id ORDER BY r.duty_month DESC`,
    );
    return response.json({ rosters: rosters.map((roster) => ({ ...roster, memberCount: Number(roster.memberCount), dutyCount: Number(roster.dutyCount) })) });
  } catch (error) { return next(error); }
});

app.get('/api/staff/duty-rosters/template', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
    const month = dutyMonthInput.parse(request.query.month ?? new Date().toISOString().slice(0, 7));
    const [dentists] = await pool.query<RowDataPacket[]>('SELECT display_name AS displayName FROM dentists WHERE active = TRUE ORDER BY id');
    const { holidays } = await getThaiHolidaysForMonth(month);
    const workbook = await buildDutyRosterTemplate(month, dentists.map((dentist) => ({ displayName: String(dentist.displayName) })), 5, holidays);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="duty-roster-${month}.xlsx"`);
    return response.send(workbook);
  } catch (error) { return next(error); }
});

app.get('/api/staff/duty-rosters/:month', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
    const month = dutyMonthInput.parse(request.params.month);
    const detail = await dutyRosterDetail(month);
    if (!detail) return response.status(404).json({ message: 'ยังไม่มีทะเบียนลงเวรของเดือนนี้' });
    return response.json(detail);
  } catch (error) { return next(error); }
});

app.post('/api/staff/duty-rosters', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
    const input = z.object({
      month: dutyMonthInput,
      // หัวตารางเป็นข้อมูลประกอบ ตัดให้พอดีแทนที่จะปฏิเสธทั้งไฟล์
      title: z.string().trim().optional().default('').transform((value) => value.slice(0, 255)),
      sourceFileName: z.string().trim().optional().nullable().transform((value) => value?.slice(0, 255) ?? null),
      rows: z.array(z.object({
        sequenceNo: z.number().int().positive().nullable().optional(),
        name: z.string().trim().min(2).max(160),
        dentistId: z.number().int().positive().nullable().optional(),
        days: z.array(z.object({ day: z.number().int().min(1).max(31), mark: z.string().trim().min(1).max(16) })).max(31),
      })).min(1).max(200),
    }).safeParse(request.body);
    if (!input.success) {
      const fields = Object.entries(input.error.flatten().fieldErrors).map(([field, issues]) => `${field}: ${issues?.[0] ?? 'ไม่ถูกต้อง'}`);
      return response.status(400).json({ message: `บันทึกทะเบียนลงเวรไม่ได้ เพราะข้อมูลไม่ถูกต้อง (${fields.join(' · ') || 'รูปแบบข้อมูลไม่ตรงกับที่ระบบรองรับ'})`, issues: input.error.flatten() });
    }

    const { data } = input;
    const monthLength = daysInMonth(data.month);
    const [knownDentists] = await pool.query<RowDataPacket[]>('SELECT id FROM dentists');
    const dentistIds = new Set(knownDentists.map((dentist) => Number(dentist.id)));
    if (data.rows.some((row) => row.dentistId && !dentistIds.has(row.dentistId))) return response.status(400).json({ message: 'มีทันตแพทย์ที่เลือกไม่อยู่ในทะเบียน' });
    // ทะเบียนนี้เก็บเฉพาะทันตแพทย์ ชื่อที่ไม่มีคำนำหน้า ทพ./ทพญ. จะผ่านได้ก็ต่อเมื่อจับคู่กับทะเบียนทันตแพทย์แล้ว
    const nonDentistNames = data.rows.filter((row) => !row.dentistId && !isDentistName(row.name)).map((row) => row.name);
    if (nonDentistNames.length) return response.status(400).json({ message: `ทะเบียนลงเวรรับเฉพาะทันตแพทย์ (ทพ./ทพญ.) พบรายชื่อที่ไม่ใช่ทันตแพทย์: ${nonDentistNames.join(', ')}` });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('DELETE FROM duty_rosters WHERE duty_month = ?', [data.month]);
      const [rosterResult] = await connection.query<ResultSetHeader>(
        'INSERT INTO duty_rosters (duty_month, roster_title, source_file_name, uploaded_by) VALUES (?, ?, ?, ?)',
        [data.month, data.title, data.sourceFileName ?? null, staffActor(response)],
      );
      let dutyCount = 0;
      for (const [index, row] of data.rows.entries()) {
        const [memberResult] = await connection.query<ResultSetHeader>(
          'INSERT INTO duty_roster_members (roster_id, sequence_no, source_name, dentist_id) VALUES (?, ?, ?, ?)',
          [rosterResult.insertId, row.sequenceNo ?? index + 1, row.name, row.dentistId ?? null],
        );
        const dutyDays = [...new Map(row.days.filter((day) => day.day <= monthLength).map((day) => [day.day, day])).values()];
        for (const day of dutyDays) {
          await connection.query('INSERT IGNORE INTO duty_roster_days (member_id, duty_date, duty_mark) VALUES (?, ?, ?)', [memberResult.insertId, dutyDate(data.month, day.day), day.mark]);
          dutyCount += 1;
        }
      }
      await connection.commit();
      const detail = await dutyRosterDetail(data.month);
      return response.status(201).json({ message: `บันทึกทะเบียนลงเวรเดือน ${data.month} แล้ว (${data.rows.length} คน / ${dutyCount} วันลงเวร)`, ...detail });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  } catch (error) { return next(error); }
});

app.delete('/api/staff/duty-rosters/:month', async (request, response, next) => {
  try {
    if (!await requireStaff(request, response, ['CLINIC_STAFF'])) return;
    const month = dutyMonthInput.parse(request.params.month);
    const [result] = await pool.query<ResultSetHeader>('DELETE FROM duty_rosters WHERE duty_month = ?', [month]);
    if (!result.affectedRows) return response.status(404).json({ message: 'ยังไม่มีทะเบียนลงเวรของเดือนนี้' });
    return response.json({ message: `ลบทะเบียนลงเวรเดือน ${month} แล้ว` });
  } catch (error) { return next(error); }
});

app.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) return response.status(400).json({ message: 'ข้อมูลการจองไม่ครบถ้วน', issues: error.flatten() });
  console.error(error);
  return response.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ' });
});
