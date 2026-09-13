import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RowDataPacket } from 'mysql2';

import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

/** ทดสอบ flow ล็อกอินผู้ป่วยด้วยหมอพร้อมปลายทางจริงของแอป โดย stub moph.id.th ทั้งหมด (ไม่ยิงออกอินเทอร์เน็ต) */

const testCid = '1101700203456';
const testDisplayName = 'นายทดสอบ หมอพร้อม';
const base64urlJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function healthIdJwt({ cid = testCid, ial = 1.3 }: { cid?: string; ial?: number } = {}) {
  return `header.${base64urlJson({ scopes_detail: { id_card: cid, name_prefix: 'นาย', name: 'ทดสอบ', surname: 'หมอพร้อม', ial } })}.signature`;
}

function stubHealthId({ cid, ial, tokenStatus = 'success' }: { cid?: string; ial?: number; tokenStatus?: unknown } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/v1/token')) {
      return new Response(JSON.stringify(tokenStatus === 'success'
        ? { status: 'success', data: { access_token: healthIdJwt({ cid, ial }) } }
        : { status: tokenStatus, message: 'token request rejected' }), { status: 200 });
    }
    if (url.endsWith('/api/v1/accounts')) {
      return new Response(JSON.stringify({ status: 'success', data: { id_card_num: cid, account_title_th: 'นาย', first_name_th: 'ทดสอบ', last_name_th: 'หมอพร้อม' } }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
}

function cookieValue(setCookie: string | string[] | undefined, name: string) {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const header = list.find((cookie) => cookie.startsWith(`${name}=`));
  expect(header, `expected a ${name} cookie`).toBeDefined();
  return /([^=]+)=([^;]+)/.exec(header!)![2];
}

describe('patient HealthID SSO', () => {
  const original = {
    enabled: config.patientSsoEnabled,
    clientId: config.mophClientId,
    clientSecret: config.mophClientSecret,
    redirectUri: config.mophRedirectUri,
  };

  beforeAll(() => {
    config.patientSsoEnabled = true;
    config.mophClientId = 'test-client-id';
    config.mophClientSecret = 'test-client-secret';
    config.mophRedirectUri = 'https://clinic.test/api/auth/patient/moph/callback';
  });

  afterAll(async () => {
    Object.assign(config, original);
    await pool.query('DELETE FROM patient_registry WHERE patient_identity = ?', [testCid]);
    await pool.query('DELETE FROM patient_sessions WHERE patient_identity = ?', [testCid]);
    vi.unstubAllGlobals();
  });

  it('exposes the auth config so the frontend can pick the login UI', async () => {
    const result = await request(app).get('/api/auth/config');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ patientSso: true });
  });

  it('has no mock patient login endpoint left at all', async () => {
    // ลบ POST /api/dev-auth/patient ทิ้งแล้ว ฟอร์มกรอกเองใช้ /api/auth/patient/manual ที่ออก session จริงแทน
    expect((await request(app).post('/api/dev-auth/patient').send({ identity: '1101700207003' })).status).toBe(404);
  });

  it('runs login → callback → session → booking with the session identity', async () => {
    vi.stubGlobal('fetch', stubHealthId());

    const login = await request(app).get('/api/auth/patient/moph/login');
    expect(login.status).toBe(302);
    expect(login.headers.location).toContain('https://moph.id.th/oauth/redirect');
    expect(login.headers.location).toContain('scope=ProviderID');
    const nonce = cookieValue(login.headers['set-cookie'], 'moph_oauth_nonce');

    const callback = await request(app)
      .get(`/api/auth/patient/moph/callback?code=one-time-code&state=${encodeURIComponent(nonce)}`)
      .set('Cookie', `moph_oauth_nonce=${nonce}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain('/appointment?login=success');
    const sessionValue = cookieValue(callback.headers['set-cookie'], 'clinic_patient_session');

    // regression: express นับ maxAge เป็นมิลลิวินาที เคยส่งเป็นวินาทีทำให้ cookie อายุจริงเหลือ 43 วินาที
    // แล้ว session หลุดเงียบ ๆ กลางทาง (ผู้ป่วยเห็นคิวของคนอื่นเพราะ endpoint fallback ไป identity สมมติ)
    const sessionCookieHeader = [callback.headers['set-cookie']].flat().find((cookie) => String(cookie).startsWith('clinic_patient_session='));
    const maxAgeSeconds = Number(/Max-Age=(\d+)/.exec(String(sessionCookieHeader))?.[1]);
    expect(maxAgeSeconds).toBe(config.patientSessionHours * 3600);

    const me = await request(app).get('/api/auth/me').set('Cookie', `clinic_patient_session=${sessionValue}`);
    expect(me.body).toMatchObject({
      authenticated: true, role: 'PATIENT', displayName: testDisplayName,
      identityMasked: '110******3456', provider: 'MOPH HealthID',
    });

    // จองโดยส่งค่า mock มาใน body — server ต้องเขียนทับด้วย identity จาก session
    // ไฟล์เทสต์อื่นรันขนานกันและแก้ booking_flow บน DB เดียวกันได้ จึงอ่าน flow แล้ว retry เมื่อโดน 409
    const date = '2099-12-30';
    let slotId = 0;
    let booking: import('supertest').Response | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const flow = (await request(app).get('/api/booking-config')).body.bookingFlow as 'PROCEDURE_AND_DENTIST' | 'DENTIST_ONLY' | 'TIME_ONLY';
      let bookingBody: Record<string, unknown>;
      if (flow === 'TIME_ONLY') {
        await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ date, startTimes: ['10:00'], capacity: 2 });
        const availability = await request(app).get(`/api/availability?date=${date}`);
        slotId = availability.body.slots.find((slot: { startsAt: string }) => slot.startsAt === `${date}T10:00:00+07:00`).id;
        bookingBody = { slotId, phone: '0812345678', patientIdentity: 'MOCK-PATIENT-001', patientDisplayName: 'นายทดสอบ ระบบจอง' };
      } else {
        const service = (await request(app).get('/api/services')).body.services[0];
        const dentistId = Number((await request(app).get(`/api/services/${service.id}/dentists`)).body.dentists[0].id);
        await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ dentistId, date, startTimes: ['10:00'] });
        const availability = await request(app).get(`/api/dentists/${dentistId}/availability?serviceId=${service.id}&date=${date}`);
        slotId = availability.body.slots[0].id;
        bookingBody = { serviceId: service.id, dentistId, slotId, phone: '0812345678', patientIdentity: 'MOCK-PATIENT-001', patientDisplayName: 'นายทดสอบ ระบบจอง' };
      }
      booking = await request(app).post('/api/appointments')
        .set('Cookie', `clinic_patient_session=${sessionValue}`)
        .send(bookingBody);
      if (booking.status === 201) break;
      // flow เปลี่ยนกลางคัน → slot ใช้ไม่ได้ ลบทิ้งแล้วลองใหม่ (409 เกิดก่อน insert ใด ๆ)
      await pool.query('DELETE FROM booking_slots WHERE id = ?', [slotId]);
    }
    expect(booking, 'booking should eventually succeed despite concurrent booking-flow changes').toBeDefined();
    expect(booking!.status).toBe(201);

    const appointments = await request(app).get('/api/patient/appointments').set('Cookie', `clinic_patient_session=${sessionValue}`);
    expect(appointments.body.appointments).toEqual(expect.arrayContaining([
      expect.objectContaining({ reference: booking!.body.appointment.reference }),
    ]));

    const registry = await pool.query<RowDataPacket[]>('SELECT patient_display_name FROM patient_registry WHERE patient_identity = ?', [testCid]);
    expect(registry[0][0]?.patient_display_name).toBe(testDisplayName);

    const logout = await request(app).post('/api/auth/patient/logout').set('Cookie', `clinic_patient_session=${sessionValue}`);
    expect(logout.body).toEqual({ ok: true });
    expect((await request(app).get('/api/auth/me').set('Cookie', `clinic_patient_session=${sessionValue}`)).body.authenticated).toBe(false);

    // cleanup booking rows ของวันที่ทดสอบนี้เท่านั้น
    await pool.query('DELETE ash FROM appointment_status_history ash INNER JOIN appointments a ON a.id = ash.appointment_id WHERE a.slot_id = ?', [slotId]);
    await pool.query('DELETE FROM patient_visit_registry WHERE patient_identity = ?', [testCid]);
    await pool.query('DELETE FROM appointments WHERE slot_id = ?', [slotId]);
    await pool.query('DELETE FROM booking_slots WHERE id = ?', [slotId]);
    await pool.query('DELETE FROM queue_counters WHERE service_date = ?', [date]);
  });

  it('rejects a callback whose nonce cookie does not match the state', async () => {
    vi.stubGlobal('fetch', stubHealthId());
    const callback = await request(app).get('/api/auth/patient/moph/callback?code=x&state=tampered')
      .set('Cookie', 'moph_oauth_nonce=expected');
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain('reason=invalid_state');
    vi.unstubAllGlobals();
  });

  it('sends the user back with reason=cancelled when moph.id.th returns an error', async () => {
    const login = await request(app).get('/api/auth/patient/moph/login');
    const nonce = cookieValue(login.headers['set-cookie'], 'moph_oauth_nonce');
    const callback = await request(app).get('/api/auth/patient/moph/callback?error=access_denied')
      .set('Cookie', `moph_oauth_nonce=${nonce}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain('reason=cancelled');
  });

  it('maps a failed token exchange to the server reason without leaking tokens', async () => {
    vi.stubGlobal('fetch', stubHealthId({ tokenStatus: 'invalid_grant' }));
    const login = await request(app).get('/api/auth/patient/moph/login');
    const nonce = cookieValue(login.headers['set-cookie'], 'moph_oauth_nonce');
    const callback = await request(app).get('/api/auth/patient/moph/callback?code=one-time-code')
      .set('Cookie', `moph_oauth_nonce=${nonce}`);
    expect(callback.headers.location).toContain('reason=server');
    vi.unstubAllGlobals();
  });

  it('rejects identities below the configured IAL level', async () => {
    vi.stubGlobal('fetch', stubHealthId({ ial: 1.2 }));
    const login = await request(app).get('/api/auth/patient/moph/login');
    const nonce = cookieValue(login.headers['set-cookie'], 'moph_oauth_nonce');
    const callback = await request(app).get('/api/auth/patient/moph/callback?code=one-time-code')
      .set('Cookie', `moph_oauth_nonce=${nonce}`);
    expect(callback.headers.location).toContain('reason=ial');
    vi.unstubAllGlobals();
  });

  it('blocks a suspended patient account from logging in', async () => {
    await pool.query('INSERT INTO patient_registry (patient_identity, patient_display_name, access_status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE access_status = ?', [testCid, testDisplayName, 'BLOCKED', 'BLOCKED']);
    vi.stubGlobal('fetch', stubHealthId());
    const login = await request(app).get('/api/auth/patient/moph/login');
    const nonce = cookieValue(login.headers['set-cookie'], 'moph_oauth_nonce');
    const callback = await request(app).get('/api/auth/patient/moph/callback?code=one-time-code')
      .set('Cookie', `moph_oauth_nonce=${nonce}`);
    expect(callback.headers.location).toContain('reason=blocked');
    expect((await request(app).get('/api/auth/me')).body.authenticated).toBe(false);
    await pool.query('DELETE FROM patient_registry WHERE patient_identity = ?', [testCid]);
    vi.unstubAllGlobals();
  });

  it('keeps the SSO login endpoint closed while the flag is off', async () => {
    config.patientSsoEnabled = false;
    try {
      expect((await request(app).get('/api/auth/patient/moph/login')).status).toBe(404);
      expect((await request(app).get('/api/auth/config')).body).toMatchObject({ patientSso: false });
      // ปิด SSO ไม่กระทบฟอร์มกรอกเอง — ยังล็อกอินและได้ session จริงเหมือนเดิม
      const manual = await request(app).post('/api/auth/patient/manual').send({ citizenId: '1101700207002', displayName: 'ไม่มีแอป ทดสอบ' });
      expect(manual.status).toBe(201);
      await pool.query('DELETE FROM patient_sessions WHERE patient_identity = ?', ['1101700207002']);
    } finally {
      config.patientSsoEnabled = true;
    }
  });
});
