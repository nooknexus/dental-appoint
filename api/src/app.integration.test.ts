import ExcelJS from 'exceljs';
import type { RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { createPatientSession } from './services/patientSession.js';

// suite นี้ทดสอบสัญญาแบบ mock ทั้งหมด — บังคับปิด patient SSO ไม่ว่า .env จะเปิดไว้
config.patientSsoEnabled = false;

type RosterDetailForRestore = {
  roster: { title: string; sourceFileName: string | null };
  members: { sequenceNo: number | null; sourceName: string; dentistId: number | null; dutyDays: { day: number; mark: string }[] }[];
};

/** endpoint ฝั่งผู้ป่วยอ่าน identity จาก session cookie อย่างเดียว เทสต์จึงต้องเปิด session จริงก่อนเสมอ */
const issuedTestSessions: string[] = [];
async function patientCookie(identity: string, displayName = 'ผู้ป่วย ทดสอบ') {
  const session = await createPatientSession(identity, displayName, null, 'manual');
  issuedTestSessions.push(identity);
  return `clinic_patient_session=${session.raw}`;
}

// DB เป็นตัวเดียวกับ dev — เก็บกวาด session ที่เทสต์เปิดไว้ ไม่ให้ค้างสะสมในตาราง
afterAll(async () => {
  if (issuedTestSessions.length) {
    await pool.query('DELETE FROM patient_sessions WHERE patient_identity IN (?)', [issuedTestSessions]);
  }
});

/** สร้างไฟล์ .xlsx รูปแบบเดียวกับตารางเวรของคลินิก เพื่อทดสอบ endpoint จริง */
async function dutyRosterWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('เวรกันยายน');
  worksheet.addRow(['', 'ตารางปฏิบัติงานสำหรับเจ้าหน้าที่ (ในเวลาราชการ)']);
  worksheet.addRow(['', 'คลินิกรูปแบบพิเศษ Premium Clinic โรงพยาบาลวังทอง ประจำเดือน ....กันยายน.....2569.....']);
  worksheet.addRow([]);
  worksheet.addRow(['ลำดับ', 'ชื่อ - สกุล', ...Array.from({ length: 31 }, (_, index) => index + 1)]);
  worksheet.addRow(['1', 'ทพญ.นิศา ทองนพคุณ', ...Array.from({ length: 31 }, (_, index) => (index + 1 === 17 ? '/' : ''))]);
  worksheet.addRow(['2', 'ทพ.จรูญพันธ์ อธิกชัย', ...Array.from({ length: 31 }, (_, index) => ([14, 28].includes(index + 1) ? '/' : ''))]);
  worksheet.addRow(['3', 'นางสาวสมหญิง ใจดี', ...Array.from({ length: 31 }, (_, index) => (index + 1 === 9 ? '/' : ''))]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('appointment API contract', () => {
  it('opens a real session for the manual (no-app) login and serves the booking catalogue', async () => {
    // ฟอร์มกรอกเองออก session จริงเหมือน SSO — ไม่มี mock login endpoint ให้ใช้แล้ว
    expect((await request(app).post('/api/auth/patient/manual').send({ citizenId: '1101700207001' })).status).toBe(400);
    expect((await request(app).post('/api/auth/patient/manual').send({ citizenId: 'ABCDEFGHIJKLM', displayName: 'นายทดสอบ ระบบจอง' })).status).toBe(400);

    const signIn = await request(app).post('/api/auth/patient/manual').send({ citizenId: '1101700207001', displayName: 'นายทดสอบ ระบบจอง' });
    expect(signIn.status).toBe(201);
    expect(signIn.body).toMatchObject({ provider: 'manual', displayName: 'นายทดสอบ ระบบจอง', identityMasked: '110******7001' });
    const sessionCookie = [signIn.headers['set-cookie']].flat().find((cookie) => String(cookie).startsWith('clinic_patient_session='));
    expect(sessionCookie).toBeDefined();
    // session ที่ได้ต้องใช้เรียก endpoint ฝั่งผู้ป่วยได้จริง โดยไม่ต้องส่งเลขบัตรไปกับ request อีก
    const me = await request(app).get('/api/auth/me').set('Cookie', String(sessionCookie).split(';')[0]);
    expect(me.body).toMatchObject({ authenticated: true, identityMasked: '110******7001', provider: 'manual' });
    await pool.query('DELETE FROM patient_sessions WHERE patient_identity = ?', ['1101700207001']);

    const services = await request(app).get('/api/services');
    expect(services.status).toBe(200);
    expect(services.body.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.any(Number), name: expect.any(String), category: expect.any(String), priceLabel: expect.any(String), depositAmount: 400 }),
    ]));
  });

  it('exposes each procedure price separately from the fixed 400-baht deposit', async () => {
    const services = await request(app).get('/api/services');
    const filling = services.body.services.find((service: { name: string }) => service.name === 'อุดฟัน');

    expect(filling).toMatchObject({ priceLabel: '550–1,000 บาท', depositAmount: 400 });
  });

  it('returns dentists only for the mock procedures assigned to them', async () => {
    const catalogue = await request(app).get('/api/services');
    const pediatricProcedure = catalogue.body.services.find((service: { category: string }) => service.category === 'ทันตกรรมสำหรับเด็ก');
    const rootCanalProcedure = catalogue.body.services.find((service: { category: string }) => service.category === 'งานรักษาคลองรากฟันแท้');

    const pediatricDentists = await request(app).get(`/api/services/${pediatricProcedure.id}/dentists`);
    expect(pediatricDentists.body.dentists.map((dentist: { name: string }) => dentist.name)).toEqual(['ทพญ. พิมพ์ใจ สุขสันต์']);

    const rootCanalDentists = await request(app).get(`/api/services/${rootCanalProcedure.id}/dentists`);
    expect(rootCanalDentists.body.dentists.map((dentist: { name: string }) => dentist.name)).toEqual(['ทพ. ณัฐวุฒิ ยิ้มแย้ม']);
  });

  it('limits system settings and the dentist registry to IT Staff', async () => {
    const clinicSettings = await request(app).get('/api/staff/settings').set('x-mock-role', 'CLINIC_STAFF');
    expect(clinicSettings.status).toBe(403);

    const itSettings = await request(app).get('/api/staff/settings').set('x-mock-role', 'IT_STAFF');
    expect(itSettings.status).toBe(200);
    expect(itSettings.body.permissions).toContain('Queue Prefix');

    const dentistRegistry = await request(app).get('/api/dentists');
    expect(dentistRegistry.status).toBe(200);
    expect(dentistRegistry.body.dentists).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: expect.any(String), portraitUrl: null }),
    ]));

    const clinicDentistRegistry = await request(app).get('/api/staff/dentists').set('x-mock-role', 'CLINIC_STAFF');
    expect(clinicDentistRegistry.status).toBe(403);
    const itDentistRegistry = await request(app).get('/api/staff/dentists').set('x-mock-role', 'IT_STAFF');
    expect(itDentistRegistry.status).toBe(200);
    const managerDentistRegistry = await request(app).get('/api/staff/dentists').set('x-mock-role', 'MANAGER');
    expect(managerDentistRegistry.status).toBe(403);
  });

  it('lists the newly registered dentists without portraits in the public team registry', async () => {
    const registry = await request(app).get('/api/dentists');
    const addedDentistNames = [
      'ทพญ.นิศา ทองนพคุณ',
      'ทพ.จรูญพันธ์ อธิกชัย',
      'ทพญ.วิจิตรา ลิ้มตระกูล',
      'ทพญ.วทันยา แช่มช้อย',
      'ทพญ.ฐานิดา ปุญญฤทธิ์',
      'ทพ.ฉัตรชัย ปุญญฤทธิ์',
      'ทพญ.วนิตา มากล้น',
      'ทพญ.อมรรัตน์ อิ่มหมี',
      'ทพญ.นนธกานต์ จันทร์รักษ์',
      'ทพญ.จิตรเรขา สัมพันธรัตน์',
      'ทพญ.สุวัจณา ทองสุข',
      'ทพญ.สุชญา อุดมพันท์',
      'ทพ.วิทยา แสงเหมือนขวัญ',
      'ทพญ.วาสนา สุวรรณฤทธิ์',
      'ทพ.ปัญญา ขวัญวงศ์',
      'ทพ.ปกรณ์ จิตรกฤษฎากุล',
      'ทพ.ศุภวัฒน์ วงศ์ไพโรจน์พานิช',
      'ทพ.พัสกร สาธกุไร',
      'ทพญ.นดา เก่งพานิช',
      'ทพ.กฤต ด่านกิตติไกรลาศ',
      'ทพญ.จิราภา วงศ์ไพโรจน์พานิช',
      'ทพญ.ปทุมพรรณ พรมสินชัย',
    ];

    expect(registry.status).toBe(200);
    expect(registry.body.dentists).toEqual(expect.arrayContaining(
      addedDentistNames.map((name) => expect.objectContaining({ name, portraitUrl: null })),
    ));
  });

  it('allows only Clinic Staff to search the patient registry', async () => {
    const registry = await request(app).get('/api/staff/patient-registry?search=MOCK-PATIENT-001').set('x-mock-role', 'CLINIC_STAFF');
    expect(registry.status).toBe(200);
    expect(registry.body).toHaveProperty('patients');

    const itDenied = await request(app).get('/api/staff/patient-registry').set('x-mock-role', 'IT_STAFF');
    expect(itDenied.status).toBe(403);

    const denied = await request(app).get('/api/staff/patient-registry').set('x-mock-role', 'MANAGER');
    expect(denied.status).toBe(403);
  });

  it('lets only IT Staff disable the fixed 400-baht reservation payment for new bookings', async () => {
    const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({ reservationPaymentEnabled: expect.any(Boolean), reservationPaymentAmount: 400 });

    const clinicUpdate = await request(app)
      .patch('/api/staff/system-settings/reservation-payment')
      .set('x-mock-role', 'CLINIC_STAFF')
      .send({ enabled: false });
    expect(clinicUpdate.status).toBe(403);

    try {
      const disabled = await request(app)
        .patch('/api/staff/system-settings/reservation-payment')
        .set('x-mock-role', 'IT_STAFF')
        .send({ enabled: false });
      expect(disabled.status).toBe(200);
      expect(disabled.body).toMatchObject({ reservationPaymentEnabled: false, reservationPaymentAmount: 400 });
    } finally {
      await request(app)
        .patch('/api/staff/system-settings/reservation-payment')
        .set('x-mock-role', 'IT_STAFF')
        .send({ enabled: initial.body.reservationPaymentEnabled });
    }
  });

  it('lets only IT Staff choose the dentist-only booking flow', async () => {
    const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    const clinicUpdate = await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'CLINIC_STAFF').send({ bookingFlow: 'DENTIST_ONLY' });
    expect(clinicUpdate.status).toBe(403);

    try {
      const updated = await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'DENTIST_ONLY' });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ bookingFlow: 'DENTIST_ONLY' });
    } finally {
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
    }
  });

  it('lets only IT Staff choose which PMC and SMC clinic types are open', async () => {
    const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    const clinicUpdate = await request(app).patch('/api/staff/system-settings/clinic-types').set('x-mock-role', 'CLINIC_STAFF').send({ clinicTypes: ['PMC'] });
    expect(clinicUpdate.status).toBe(403);

    try {
      const updated = await request(app).patch('/api/staff/system-settings/clinic-types').set('x-mock-role', 'IT_STAFF').send({ clinicTypes: ['PMC'] });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ clinicTypes: ['PMC'] });

      const publicConfig = await request(app).get('/api/clinic-config');
      expect(publicConfig.status).toBe(200);
      expect(publicConfig.body).toMatchObject({ clinicTypes: ['PMC'] });
    } finally {
      await request(app).patch('/api/staff/system-settings/clinic-types').set('x-mock-role', 'IT_STAFF').send({ clinicTypes: initial.body.clinicTypes ?? ['PMC', 'SMC'] });
    }
  });

  it('lets Clinic Staff create a capacity-based central-clinic slot in time-only flow', async () => {
    const date = '2099-12-30';
    const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'TIME_ONLY' });
    try {
      const created = await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ date, startTimes: ['09:00'], capacity: 5 });
      expect(created.status).toBe(201);
      expect(created.body.createdCount).toBe(1);

      const available = await request(app).get(`/api/availability?date=${date}`);
      expect(available.body.slots).toEqual(expect.arrayContaining([expect.objectContaining({ startsAt: `${date}T09:00:00+07:00`, available: 5 })]));
    } finally {
      await pool.query('DELETE FROM booking_slots WHERE dentist_id IS NULL AND service_date = ?', [date]);
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
    }
  });

  it('lets a patient book a central-clinic slot without selecting a dentist', async () => {
    const date = '2099-12-26';
    const patientIdentity = 'CENTRAL-QUEUE-BOOKING-TEST';
    const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    try {
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'TIME_ONLY' });
      await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ date, startTimes: ['09:00'], capacity: 2 });
      const availability = await request(app).get(`/api/availability?date=${date}`);
      const slotId = availability.body.slots.find((slot: { startsAt: string }) => slot.startsAt === `${date}T09:00:00+07:00`).id;

      const booking = await request(app).post('/api/appointments').set('Cookie', await patientCookie(patientIdentity, 'นายคิวกลาง ทดสอบ')).send({ slotId, phone: '0812345678' });
      expect(booking.status).toBe(201);
      expect(booking.body.appointment).toMatchObject({ queueNumber: 'CLN001', appointmentStatus: expect.any(String) });

      const appointments = await request(app).get('/api/patient/appointments').set('Cookie', await patientCookie(patientIdentity));
      expect(appointments.body.appointments).toEqual([expect.objectContaining({
        queueNumber: 'CLN001', serviceName: 'คิวกลางคลินิก', dentistName: 'คิวกลางคลินิก',
      })]);
    } finally {
      await pool.query('DELETE ash FROM appointment_status_history ash INNER JOIN appointments a ON a.id = ash.appointment_id INNER JOIN booking_slots bs ON bs.id = a.slot_id WHERE bs.dentist_id IS NULL AND bs.service_date = ?', [date]);
      await pool.query('DELETE FROM patient_visit_registry WHERE patient_identity = ?', [patientIdentity]);
      await pool.query('DELETE a FROM appointments a INNER JOIN booking_slots bs ON bs.id = a.slot_id WHERE bs.dentist_id IS NULL AND bs.service_date = ?', [date]);
      await pool.query('DELETE FROM booking_slots WHERE dentist_id IS NULL AND service_date = ?', [date]);
      await pool.query('DELETE FROM queue_counters WHERE service_date = ? AND queue_prefix = ?', [date, 'CLN']);
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
    }
  });

  it('lets Clinic Staff create every half-hour slot through the weekday after-hours closing time', async () => {
    const date = '2099-12-28';
    const startTimes = ['08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00'];
    const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'TIME_ONLY' });
    try {
      const created = await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ date, startTimes, capacity: 2 });
      expect(created.status).toBe(201);
      expect(created.body.createdCount).toBe(22);

      const slots = await request(app).get(`/api/staff/slots?date=${date}`).set('x-mock-role', 'CLINIC_STAFF');
      expect(slots.body.slots).toEqual(expect.arrayContaining([
        expect.objectContaining({ startTime: '08:30', endTime: '09:00', capacity: 2 }),
        expect.objectContaining({ startTime: '20:00', endTime: '20:30', capacity: 2 }),
      ]));
    } finally {
      await pool.query('DELETE FROM booking_slots WHERE dentist_id IS NULL AND service_date = ?', [date]);
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
    }
  });

  it('creates slots with the duration selected by Clinic Staff', async () => {
    const date = '2099-12-29';
    const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'TIME_ONLY' });
    try {
      const created = await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ date, startTimes: ['08:30'], durationMinutes: 60, capacity: 2 });
      expect(created.status).toBe(201);

      const slots = await request(app).get(`/api/staff/slots?date=${date}`).set('x-mock-role', 'CLINIC_STAFF');
      expect(slots.body.slots).toEqual(expect.arrayContaining([
        expect.objectContaining({ startTime: '08:30', endTime: '09:30', capacity: 2 }),
      ]));
    } finally {
      await pool.query('DELETE FROM booking_slots WHERE dentist_id IS NULL AND service_date = ?', [date]);
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
    }
  });

  it('rejects slot times that overlap the clinic lunch break', async () => {
    const date = '2099-12-30';
    const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'TIME_ONLY' });
    try {
      const created = await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ date, startTimes: ['12:00'], durationMinutes: 30, capacity: 2 });
      expect(created.status).toBe(400);
      expect(created.body.message).toBe('ช่วงเวลาที่เลือกทับกับเวลาพักกลางวัน 12:00–13:00 น.');
    } finally {
      await pool.query('DELETE FROM booking_slots WHERE dentist_id IS NULL AND service_date = ?', [date]);
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
    }
  });

  it('shows only central-clinic slots in the staff panel when the booking flow is time-only', async () => {
    const date = '2099-12-27';
    const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    const [dentists] = await pool.query<RowDataPacket[]>('SELECT id FROM dentists WHERE active = TRUE ORDER BY id LIMIT 1');
    await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'TIME_ONLY' });
    try {
      await pool.query('INSERT INTO booking_slots (dentist_id, service_date, start_time, end_time, capacity) VALUES (NULL, ?, ?, ?, 1)', [date, '09:00', '09:30']);
      await pool.query('INSERT INTO booking_slots (dentist_id, service_date, start_time, end_time, capacity) VALUES (?, ?, ?, ?, 1)', [dentists[0].id, date, '10:00', '10:30']);

      const response = await request(app).get(`/api/staff/slots?date=${date}`).set('x-mock-role', 'CLINIC_STAFF');
      expect(response.status).toBe(200);
      expect(response.body.slots).toEqual([expect.objectContaining({ dentistId: null, startTime: '09:00' })]);
    } finally {
      await pool.query('DELETE FROM booking_slots WHERE service_date = ?', [date]);
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
    }
  });

  it('lets Clinic Staff view dentists and their generated booking slots', async () => {
    const response = await request(app).get('/api/staff/slots?date=2026-09-04').set('x-mock-role', 'CLINIC_STAFF');

    expect(response.status).toBe(200);
    expect(response.body.dentists).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.any(Number), displayName: expect.any(String), services: expect.any(Array) }),
    ]));
    expect(response.body.slots).toEqual(expect.any(Array));

    const denied = await request(app).get('/api/staff/slots?date=2026-09-04').set('x-mock-role', 'MANAGER');
    expect(denied.status).toBe(403);
  });

  it('includes the booking patient\'s full name in the Clinic Staff appointment-review list', async () => {
    const date = '2099-12-27';
    const patientIdentity = 'PATIENT-NAME-COLUMN-TEST';
    const patientDisplayName = 'นางสาวชื่อทดสอบ นามสกุลทดสอบ';
    const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    try {
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'TIME_ONLY' });
      await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ date, startTimes: ['09:00'], capacity: 2 });
      const availability = await request(app).get(`/api/availability?date=${date}`);
      const slotId = availability.body.slots.find((slot: { startsAt: string }) => slot.startsAt === `${date}T09:00:00+07:00`).id;
      const booking = await request(app).post('/api/appointments').set('Cookie', await patientCookie(patientIdentity, patientDisplayName)).send({ slotId, phone: '0812345678' });
      expect(booking.status).toBe(201);

      const appointments = await request(app).get('/api/staff/appointments').set('x-mock-role', 'CLINIC_STAFF');
      expect(appointments.status).toBe(200);
      expect(appointments.body.appointments).toEqual(expect.arrayContaining([
        expect.objectContaining({ queueNumber: booking.body.appointment.queueNumber, patientName: patientDisplayName }),
      ]));
    } finally {
      await pool.query('DELETE ash FROM appointment_status_history ash INNER JOIN appointments a ON a.id = ash.appointment_id INNER JOIN booking_slots bs ON bs.id = a.slot_id WHERE bs.dentist_id IS NULL AND bs.service_date = ?', [date]);
      await pool.query('DELETE FROM patient_visit_registry WHERE patient_identity = ?', [patientIdentity]);
      await pool.query('DELETE a FROM appointments a INNER JOIN booking_slots bs ON bs.id = a.slot_id WHERE bs.dentist_id IS NULL AND bs.service_date = ?', [date]);
      await pool.query('DELETE FROM booking_slots WHERE dentist_id IS NULL AND service_date = ?', [date]);
      await pool.query('DELETE FROM queue_counters WHERE service_date = ? AND queue_prefix = ?', [date, 'CLN']);
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
    }
  });

  it('denies Manager access to appointment-review data and actions', async () => {
    const appointments = await request(app).get('/api/staff/appointments').set('x-mock-role', 'MANAGER');
    const slip = await request(app).get('/api/staff/appointments/1/slip').set('x-mock-role', 'MANAGER');
    const confirmation = await request(app).post('/api/staff/appointments/1/confirm').set('x-mock-role', 'MANAGER');

    expect(appointments.status).toBe(403);
    expect(slip.status).toBe(403);
    expect(confirmation.status).toBe(403);
  });

  it('returns the active booking flow with the dentist registry', async () => {
    const response = await request(app).get('/api/staff/dentists').set('x-mock-role', 'IT_STAFF');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('bookingFlow');
  });

  it('returns only the selected dentist’s slots for the staff slot panel', async () => {
    const date = '2099-12-29';
    const registry = await request(app).get('/api/staff/dentists').set('x-mock-role', 'IT_STAFF');
    const [first, second] = registry.body.dentists.filter((dentist: { active: boolean; serviceIds: number[] }) => dentist.active && dentist.serviceIds.length).slice(0, 2);
    const currentFlow = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'PROCEDURE_AND_DENTIST' });
    try {
      await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ dentistId: first.id, date, startTimes: ['09:00'] });
      await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ dentistId: second.id, date, startTimes: ['09:00'] });
      const slots = await request(app).get(`/api/staff/slots?date=${date}&dentistId=${first.id}`).set('x-mock-role', 'CLINIC_STAFF');
      expect(slots.status).toBe(200);
      expect(slots.body.slots).toEqual(expect.arrayContaining([expect.objectContaining({ dentistId: first.id })]));
      expect(slots.body.slots).not.toEqual(expect.arrayContaining([expect.objectContaining({ dentistId: second.id })]));
    } finally {
      await pool.query('DELETE FROM booking_slots WHERE dentist_id IN (?, ?) AND service_date = ?', [first.id, second.id, date]);
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: currentFlow.body.bookingFlow });
    }
  });

  it('creates selected slot times only for a dentist with active procedures', async () => {
    const date = '2099-12-31';
    const currentFlow = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'PROCEDURE_AND_DENTIST' });
    const roster = await request(app).get(`/api/staff/slots?date=${date}`).set('x-mock-role', 'CLINIC_STAFF');
    const dentist = roster.body.dentists.find((item: { services: string[] }) => item.services.length > 0);

    try {
      const created = await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ dentistId: dentist.id, date, startTimes: ['17:00', '17:30'] });
      expect(created.status).toBe(201);
      expect(created.body.createdCount).toBe(2);

      const slots = await request(app).get(`/api/staff/slots?date=${date}`).set('x-mock-role', 'CLINIC_STAFF');
      expect(slots.body.slots).toEqual(expect.arrayContaining([
        expect.objectContaining({ dentistId: dentist.id, startTime: '17:00', endTime: '17:30' }),
        expect.objectContaining({ dentistId: dentist.id, startTime: '17:30', endTime: '18:00' }),
      ]));
    } finally {
      await pool.query('DELETE FROM booking_slots WHERE dentist_id = ? AND service_date = ?', [dentist.id, date]);
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: currentFlow.body.bookingFlow });
    }
  });

  it('shows a selected dentist\'s slots without requiring a procedure in dentist-only flow', async () => {
    const date = '2099-12-28';
    const roster = await request(app).get(`/api/staff/slots?date=${date}`).set('x-mock-role', 'CLINIC_STAFF');
    const dentist = roster.body.dentists.find((item: { services: string[] }) => item.services.length > 0);
    const currentFlow = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'DENTIST_ONLY' });

    try {
      await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ dentistId: dentist.id, date, startTimes: ['09:00'] });
      const available = await request(app).get(`/api/dentists/${dentist.id}/availability?date=${date}`);

      expect(available.status).toBe(200);
      expect(available.body.slots).toEqual(expect.arrayContaining([
        expect.objectContaining({ startsAt: `${date}T09:00:00+07:00` }),
      ]));
      const slot = available.body.slots.find((item: { startsAt: string }) => item.startsAt === `${date}T09:00:00+07:00`);
      const booking = await request(app).post('/api/appointments')
        .set('Cookie', await patientCookie('DENTIST-ONLY-BOOKING-TEST', 'นายทันตแพทย์อย่างเดียว ทดสอบ'))
        .send({ dentistId: dentist.id, slotId: slot.id, phone: '0812345678' });
      expect(booking.status).toBe(201);
    } finally {
      await pool.query(
        `DELETE ash FROM appointment_status_history ash
         INNER JOIN appointments a ON a.id = ash.appointment_id
         INNER JOIN booking_slots bs ON bs.id = a.slot_id
         WHERE bs.dentist_id = ? AND bs.service_date = ?`,
        [dentist.id, date],
      );
      await pool.query(
        `DELETE pvr FROM patient_visit_registry pvr
         INNER JOIN appointments a ON a.id = pvr.appointment_id
         INNER JOIN booking_slots bs ON bs.id = a.slot_id
         WHERE bs.dentist_id = ? AND bs.service_date = ?`,
        [dentist.id, date],
      );
      await pool.query('DELETE a FROM appointments a INNER JOIN booking_slots bs ON bs.id = a.slot_id WHERE bs.dentist_id = ? AND bs.service_date = ?', [dentist.id, date]);
      await pool.query('DELETE FROM booking_slots WHERE dentist_id = ? AND service_date = ?', [dentist.id, date]);
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: currentFlow.body.bookingFlow });
    }
  });

  it('does not offer or create a second procedure booking for an already-booked dentist time', async () => {
    const date = '2099-12-30';
    const time = '10:30';
    const registry = await request(app).get('/api/staff/dentists').set('x-mock-role', 'IT_STAFF');
    const dentist = registry.body.dentists.find((item: { serviceIds: number[] }) => item.serviceIds.length >= 2);
    const [firstServiceId, secondServiceId] = dentist.serviceIds;
    let initialPaymentSetting: boolean | undefined;
    const currentFlow = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    const cleanup = async () => {
      await pool.query(
        `DELETE ash FROM appointment_status_history AS ash
         INNER JOIN appointments AS a ON a.id = ash.appointment_id
         INNER JOIN booking_slots AS bs ON bs.id = a.slot_id
         WHERE bs.dentist_id = ? AND bs.service_date = ? AND bs.start_time = ?`,
        [dentist.id, date, time],
      );
      await pool.query(
        `DELETE ps FROM payment_slips AS ps
         INNER JOIN appointments AS a ON a.id = ps.appointment_id
         INNER JOIN booking_slots AS bs ON bs.id = a.slot_id
         WHERE bs.dentist_id = ? AND bs.service_date = ? AND bs.start_time = ?`,
        [dentist.id, date, time],
      );
      await pool.query(
        `DELETE pvr FROM patient_visit_registry AS pvr
         INNER JOIN appointments AS a ON a.id = pvr.appointment_id
         INNER JOIN booking_slots AS bs ON bs.id = a.slot_id
         WHERE bs.dentist_id = ? AND bs.service_date = ? AND bs.start_time = ?`,
        [dentist.id, date, time],
      );
      await pool.query(
        `DELETE nd FROM notification_deliveries AS nd
         INNER JOIN appointments AS a ON a.id = nd.appointment_id
         INNER JOIN booking_slots AS bs ON bs.id = a.slot_id
         WHERE bs.dentist_id = ? AND bs.service_date = ? AND bs.start_time = ?`,
        [dentist.id, date, time],
      );
      await pool.query(
        `DELETE a FROM appointments AS a
         INNER JOIN booking_slots AS bs ON bs.id = a.slot_id
         WHERE bs.dentist_id = ? AND bs.service_date = ? AND bs.start_time = ?`,
        [dentist.id, date, time],
      );
      await pool.query('DELETE FROM booking_slots WHERE dentist_id = ? AND service_date = ? AND start_time = ?', [dentist.id, date, time]);
    };

    try {
      await cleanup();
      const paymentSetting = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
      initialPaymentSetting = paymentSetting.body.reservationPaymentEnabled;
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'PROCEDURE_AND_DENTIST' });
      await request(app).patch('/api/staff/system-settings/reservation-payment').set('x-mock-role', 'IT_STAFF').send({ enabled: false });
      await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ dentistId: dentist.id, date, startTimes: [time] });
      const availableBeforeBooking = await request(app).get(`/api/dentists/${dentist.id}/availability?serviceId=${secondServiceId}&date=${date}`);
      const slotId = availableBeforeBooking.body.slots.find((slot: { startsAt: string }) => slot.startsAt.includes('T10:30:00')).id;

      const firstBooking = await request(app).post('/api/appointments').set('Cookie', await patientCookie('EXCLUSIVE-SLOT-TEST-ONE', 'นายหนึ่ง ทดสอบ')).send({  serviceId: firstServiceId, dentistId: dentist.id, slotId, phone: '0812345678' });
      expect(firstBooking.status).toBe(201);
      expect(firstBooking.body.appointment).toMatchObject({ appointmentStatus: 'PENDING_CONFIRMATION', paymentStatus: 'NOT_REQUIRED' });

      const confirmedWithoutPayment = await request(app).post(`/api/staff/appointments/${firstBooking.body.appointment.appointmentId}/confirm`).set('x-mock-role', 'CLINIC_STAFF');
      expect(confirmedWithoutPayment.status).toBe(200);
      const deliveries = await request(app).get('/api/staff/notification-deliveries').set('x-mock-role', 'IT_STAFF');
      expect(deliveries.body.deliveries).toEqual(expect.arrayContaining([
        expect.objectContaining({ deliveryStatus: 'INVALID_RECIPIENT', recipientMasked: 'invalid CID' }),
      ]));

      const patientRegistry = await request(app).get('/api/staff/patient-registry?search=EXCLUSIVE-SLOT-TEST-ONE').set('x-mock-role', 'CLINIC_STAFF');
      expect(patientRegistry.body.patients).toEqual(expect.arrayContaining([
        expect.objectContaining({ patientIdentity: 'EXCLUSIVE-SLOT-TEST-ONE', bookingCount: 1, accessStatus: 'ACTIVE' }),
      ]));

      const blocked = await request(app).patch('/api/staff/patient-registry/EXCLUSIVE-SLOT-TEST-ONE').set('x-mock-role', 'CLINIC_STAFF').send({ accessStatus: 'BLOCKED' });
      expect(blocked.status).toBe(200);
      await request(app).patch('/api/staff/patient-registry/EXCLUSIVE-SLOT-TEST-ONE').set('x-mock-role', 'CLINIC_STAFF').send({ accessStatus: 'ACTIVE' });

      const availabilityForOtherProcedure = await request(app).get(`/api/dentists/${dentist.id}/availability?serviceId=${secondServiceId}&date=${date}`);
      expect(availabilityForOtherProcedure.body.slots).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: slotId })]));

      const secondBooking = await request(app).post('/api/appointments').set('Cookie', await patientCookie('EXCLUSIVE-SLOT-TEST-TWO', 'นางสอง ทดสอบ')).send({  serviceId: secondServiceId, dentistId: dentist.id, slotId, phone: '0898765432' });
      expect(secondBooking.status).toBe(409);
      expect(secondBooking.body.message).toBe('ช่วงเวลานี้เต็มหรือไม่พร้อมให้จองแล้ว');
    } finally {
      if (initialPaymentSetting !== undefined) await request(app).patch('/api/staff/system-settings/reservation-payment').set('x-mock-role', 'IT_STAFF').send({ enabled: initialPaymentSetting });
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: currentFlow.body.bookingFlow });
      await cleanup();
    }
  });

  it('lets a signed-in patient retrieve their booked-queue statuses', async () => {
    const response = await request(app).get('/api/patient/appointments').set('Cookie', await patientCookie('QUEUE-STATUS-TEST'));
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('appointments');
  });

  it('allows only IT Staff to save a dentist queue prefix', async () => {
    const settings = await request(app).get('/api/staff/settings').set('x-mock-role', 'IT_STAFF');
    const dentist = settings.body.dentists[0];
    const clinicAttempt = await request(app).put(`/api/staff/dentists/${dentist.id}/queue-prefix`).set('x-mock-role', 'CLINIC_STAFF').send({ queuePrefix: dentist.queuePrefix });
    expect(clinicAttempt.status).toBe(403);

    const itAttempt = await request(app).put(`/api/staff/dentists/${dentist.id}/queue-prefix`).set('x-mock-role', 'IT_STAFF').send({ queuePrefix: dentist.queuePrefix });
    expect(itAttempt.status).toBe(200);
  });

  it('lets IT Staff add and disable dentists, removing disabled dentists from slots and the public team', async () => {
    const suffix = Date.now();
    const displayName = `ทพ. ทดสอบ ${suffix}`;
    const queuePrefix = `TEST${suffix}`.slice(0, 12);
    const title = 'ทพ.';
    let dentistId: number | undefined;
    try {
      const clinicAttempt = await request(app)
        .post('/api/staff/dentists')
        .set('x-mock-role', 'CLINIC_STAFF')
        .send({ displayName, queuePrefix, title });
      expect(clinicAttempt.status).toBe(403);

      const created = await request(app)
        .post('/api/staff/dentists')
        .set('x-mock-role', 'IT_STAFF')
        .send({ displayName, queuePrefix, title });
      expect(created.status).toBe(201);
      expect(created.body.dentist).toMatchObject({ displayName, queuePrefix, title, active: true, serviceIds: [] });
      dentistId = created.body.dentist.id;

      const portrait = await request(app)
        .post(`/api/staff/dentists/${dentistId}/portrait`)
        .set('x-mock-role', 'IT_STAFF')
        .attach('portrait', Buffer.from('mock png'), { filename: 'dentist.png', contentType: 'image/png' });
      expect(portrait.status).toBe(201);
      expect(portrait.body).toMatchObject({ portraitUrl: `/api/dentists/${dentistId}/portrait` });

      const publicTeamWithPortrait = await request(app).get('/api/dentists');
      expect(publicTeamWithPortrait.body.dentists).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: dentistId, title, portraitUrl: `/api/dentists/${dentistId}/portrait` }),
      ]));

      const portraitFile = await request(app).get(`/api/dentists/${dentistId}/portrait`);
      expect(portraitFile.status).toBe(200);
      expect(portraitFile.headers['content-type']).toContain('image/png');

      const activeSlots = await request(app).get('/api/staff/slots?date=2026-09-04').set('x-mock-role', 'CLINIC_STAFF');
      expect(activeSlots.body.dentists).toEqual(expect.arrayContaining([expect.objectContaining({ id: dentistId, displayName })]));

      const disabled = await request(app)
        .patch(`/api/staff/dentists/${dentistId}`)
        .set('x-mock-role', 'IT_STAFF')
        .send({ active: false });
      expect(disabled.status).toBe(200);
      expect(disabled.body.dentist).toMatchObject({ id: dentistId, active: false });

      const registry = await request(app).get('/api/staff/dentists').set('x-mock-role', 'IT_STAFF');
      expect(registry.body.dentists).toEqual(expect.arrayContaining([expect.objectContaining({ id: dentistId, active: false })]));

      const inactiveSlots = await request(app).get('/api/staff/slots?date=2026-09-04').set('x-mock-role', 'CLINIC_STAFF');
      expect(inactiveSlots.body.dentists).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: dentistId })]));

      const publicTeam = await request(app).get('/api/dentists');
      expect(publicTeam.body.dentists).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: dentistId })]));
    } finally {
      if (dentistId) await pool.query('DELETE FROM dentists WHERE id = ?', [dentistId]);
    }
  });

  it('lets only IT Staff maintain the procedures assigned to each dentist', async () => {
    const registry = await request(app).get('/api/staff/dentists').set('x-mock-role', 'IT_STAFF');
    expect(registry.status).toBe(200);
    const dentist = registry.body.dentists[0];
    const procedure = registry.body.services[0];
    const originalServiceIds = [...dentist.serviceIds];

    const clinicUpdate = await request(app)
      .put(`/api/staff/dentists/${dentist.id}/services`)
      .set('x-mock-role', 'CLINIC_STAFF')
      .send({ serviceIds: [procedure.id] });
    expect(clinicUpdate.status).toBe(403);

    try {
      const updated = await request(app)
        .put(`/api/staff/dentists/${dentist.id}/services`)
        .set('x-mock-role', 'IT_STAFF')
        .send({ serviceIds: [procedure.id] });

      expect(updated.status).toBe(200);
      expect(updated.body.dentist).toMatchObject({ id: dentist.id, serviceIds: [procedure.id] });
    } finally {
      await request(app)
        .put(`/api/staff/dentists/${dentist.id}/services`)
        .set('x-mock-role', 'IT_STAFF')
        .send({ serviceIds: originalServiceIds });
    }
  });

  it('allows Manager to read the full dashboard summary but not IT settings', async () => {
    const dashboard = await request(app).get('/api/staff/dashboard').set('x-mock-role', 'MANAGER');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body).toMatchObject({
      totals: { totalBookings: expect.any(Number), pendingConfirmation: expect.any(Number), confirmedBookings: expect.any(Number), cancelledBookings: expect.any(Number), bookingValue: expect.any(Number) },
      today: { date: expect.any(String), total: expect.any(Number), confirmed: expect.any(Number), pending: expect.any(Number), appointments: expect.any(Array) },
      last7Days: expect.any(Array),
      topServices: expect.any(Array),
      patients: { totalPatients: expect.any(Number), blockedPatients: expect.any(Number), noShowCount: expect.any(Number) },
      duty: { weekStart: expect.any(String), weekEnd: expect.any(String), dentists: expect.any(Array) },
    });
    expect(dashboard.body.last7Days).toHaveLength(7);

    const denied = await request(app).get('/api/staff/dashboard').set('x-mock-role', 'CLINIC_STAFF');
    expect(denied.status).toBe(403);

    const settings = await request(app).get('/api/staff/settings').set('x-mock-role', 'MANAGER');
    expect(settings.status).toBe(403);
  });

  it('lets Manager and IT Staff read appointment and visit reports while other roles are denied', async () => {
    const date = '2099-12-26';
    const patientIdentity = 'PATIENT-REPORT-TEST';
    const patientDisplayName = 'นายรายงาน นัดหมายทดสอบ';
    const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    try {
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'TIME_ONLY' });
      await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ date, startTimes: ['09:00'], capacity: 2 });
      const availability = await request(app).get(`/api/availability?date=${date}`);
      const slotId = availability.body.slots.find((slot: { startsAt: string }) => slot.startsAt === `${date}T09:00:00+07:00`).id;
      const booking = await request(app).post('/api/appointments').set('Cookie', await patientCookie(patientIdentity, patientDisplayName)).send({ slotId, phone: '0812345678' });
      expect(booking.status).toBe(201);

      const denied = await request(app).get('/api/staff/reports/appointments').set('x-mock-role', 'CLINIC_STAFF');
      expect(denied.status).toBe(403);

      const report = await request(app).get(`/api/staff/reports/appointments?from=${date}&to=${date}&search=${encodeURIComponent(patientIdentity)}`).set('x-mock-role', 'MANAGER');
      expect(report.status).toBe(200);
      expect(report.body.summary.total).toBe(1);
      expect(report.body.appointments).toEqual([
        expect.objectContaining({
          queueNumber: booking.body.appointment.queueNumber, patientName: patientDisplayName, phone: '0812345678',
          dentistName: 'คิวกลางคลินิก', serviceName: 'ยังไม่ระบุหัตถการ', paymentAmount: expect.any(Number),
        }),
      ]);

      const statusFilter = await request(app).get(`/api/staff/reports/appointments?from=${date}&to=${date}&status=CANCELLED`).set('x-mock-role', 'MANAGER');
      expect(statusFilter.status).toBe(200);
      expect(statusFilter.body.summary.total).toBe(0);
      expect(statusFilter.body.appointments).toEqual([]);

      const visits = await request(app).get(`/api/staff/reports/visits?from=${date}&to=${date}`).set('x-mock-role', 'IT_STAFF');
      expect(visits.status).toBe(200);
      expect(visits.body.range).toEqual({ from: date, to: date });
      expect(visits.body.summary).toMatchObject({ total: 1, served: 0, noShow: 0, booked: 1, noShowRate: 0 });
      expect(visits.body.monthly).toEqual([expect.objectContaining({ month: '2099-12', total: 1, booked: 1 })]);
      expect(visits.body.byDentist).toEqual([expect.objectContaining({ dentistName: 'คิวกลางคลินิก', total: 1, booked: 1, noShowRate: 0 })]);

      const invalid = await request(app).get('/api/staff/reports/visits?from=not-a-date').set('x-mock-role', 'MANAGER');
      expect(invalid.status).toBe(400);
    } finally {
      await pool.query('DELETE ash FROM appointment_status_history ash INNER JOIN appointments a ON a.id = ash.appointment_id INNER JOIN booking_slots bs ON bs.id = a.slot_id WHERE bs.dentist_id IS NULL AND bs.service_date = ?', [date]);
      await pool.query('DELETE FROM patient_visit_registry WHERE patient_identity = ?', [patientIdentity]);
      await pool.query('DELETE a FROM appointments a INNER JOIN booking_slots bs ON bs.id = a.slot_id WHERE bs.dentist_id IS NULL AND bs.service_date = ?', [date]);
      await pool.query('DELETE FROM booking_slots WHERE dentist_id IS NULL AND service_date = ?', [date]);
      await pool.query('DELETE FROM queue_counters WHERE service_date = ? AND queue_prefix = ?', [date, 'CLN']);
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
    }
  });

  it('lets Manager and IT Staff read revenue, productivity, notification and peak-hour reports', async () => {
    const date = '2099-12-25';
    const patientIdentity = 'PATIENT-REVENUE-TEST';
    const staffDentists = await request(app).get('/api/staff/dentists').set('x-mock-role', 'IT_STAFF');
    const dentist = staffDentists.body.dentists.find((entry: { active: boolean }) => entry.active);
    const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
    try {
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'DENTIST_ONLY' });
      await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ dentistId: dentist.id, date, startTimes: ['10:00'] });
      const availability = await request(app).get(`/api/dentists/${dentist.id}/availability?date=${date}`);
      const booking = await request(app).post('/api/appointments').set('Cookie', await patientCookie(patientIdentity, 'นายรายได้ ทดสอบ')).send({ dentistId: dentist.id, slotId: availability.body.slots[0].id, phone: '0812345678' });
      expect(booking.status).toBe(201);
      await request(app).post('/api/staff/duty-rosters').set('x-mock-role', 'CLINIC_STAFF')
        .send({ month: '2099-12', rows: [{ sequenceNo: 1, name: dentist.displayName, dentistId: dentist.id, days: [{ day: 25, mark: '/' }] }] });

      for (const endpoint of ['/api/staff/reports/revenue', '/api/staff/reports/dentist-productivity', '/api/staff/reports/notifications', '/api/staff/reports/peak-hours']) {
        expect((await request(app).get(endpoint).set('x-mock-role', 'CLINIC_STAFF')).status).toBe(403);
      }

      const revenue = await request(app).get('/api/staff/reports/revenue?from=2099-12-01&to=2099-12-31').set('x-mock-role', 'MANAGER');
      expect(revenue.status).toBe(200);
      expect(revenue.body.range).toEqual({ from: '2099-12-01', to: '2099-12-31' });
      expect(revenue.body.summary).toMatchObject({ bookings: 1, awaitingPayment: expect.any(Number), slipUploaded: expect.any(Number), verified: expect.any(Number), rejected: expect.any(Number), notRequired: expect.any(Number) });
      expect(revenue.body.summary.revenue).toBe(Number(booking.body.appointment.paymentAmount));
      expect(revenue.body.monthly).toEqual([expect.objectContaining({ month: '2099-12', bookings: 1 })]);
      expect(revenue.body.byService[0]).toMatchObject({ serviceName: 'ยังไม่ระบุหัตถการ', bookings: 1 });

      const productivity = await request(app).get('/api/staff/reports/dentist-productivity?from=2099-12-01&to=2099-12-31').set('x-mock-role', 'MANAGER');
      expect(productivity.status).toBe(200);
      const productivityRow = productivity.body.dentists.find((row: { dentistId: number }) => row.dentistId === dentist.id);
      expect(productivityRow).toMatchObject({ dutyDays: 1, appointmentsPerDutyDay: 1 });
      expect(productivityRow.appointments).toBeGreaterThanOrEqual(1);

      const notifications = await request(app).get('/api/staff/reports/notifications').set('x-mock-role', 'MANAGER');
      expect(notifications.status).toBe(200);
      expect(notifications.body.summary).toMatchObject({ total: expect.any(Number), sent: expect.any(Number), pending: expect.any(Number), sending: expect.any(Number), failed: expect.any(Number), invalidRecipient: expect.any(Number), successRate: expect.any(Number) });
      expect(notifications.body.recent).toEqual(expect.any(Array));

      const expectedDow = new Date(`${date}T00:00:00Z`).getUTCDay() + 1;
      const peakHours = await request(app).get('/api/staff/reports/peak-hours?from=2099-12-01&to=2099-12-31').set('x-mock-role', 'MANAGER');
      expect(peakHours.status).toBe(200);
      expect(peakHours.body.byHour).toEqual(expect.arrayContaining([expect.objectContaining({ hour: 10, bookings: 1 })]));
      expect(peakHours.body.grid).toEqual(expect.arrayContaining([expect.objectContaining({ dow: expectedDow, hour: 10, bookings: 1 })]));

      const invalid = await request(app).get('/api/staff/reports/revenue?from=not-a-date').set('x-mock-role', 'MANAGER');
      expect(invalid.status).toBe(400);
    } finally {
      await pool.query('DELETE FROM duty_rosters WHERE duty_month = ?', ['2099-12']);
      await pool.query('DELETE ash FROM appointment_status_history ash INNER JOIN appointments a ON a.id = ash.appointment_id INNER JOIN booking_slots bs ON bs.id = a.slot_id WHERE bs.dentist_id = ? AND bs.service_date = ?', [dentist.id, date]);
      await pool.query('DELETE FROM patient_visit_registry WHERE patient_identity = ?', [patientIdentity]);
      await pool.query('DELETE a FROM appointments a INNER JOIN booking_slots bs ON bs.id = a.slot_id WHERE bs.dentist_id = ? AND bs.service_date = ?', [dentist.id, date]);
      await pool.query('DELETE FROM booking_slots WHERE dentist_id = ? AND service_date = ?', [dentist.id, date]);
      await pool.query('DELETE FROM queue_counters WHERE service_date = ? AND queue_prefix = ?', [date, dentist.queuePrefix]);
      await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
    }
  });

  it('lets only IT Staff approve a pending user and assign that user a staff role', async () => {
    const denied = await request(app).get('/api/staff/users').set('x-mock-role', 'CLINIC_STAFF');
    expect(denied.status).toBe(403);

    const registry = await request(app).get('/api/staff/users').set('x-mock-role', 'IT_STAFF');
    expect(registry.status).toBe(200);
    expect(registry.body.users).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.any(Number), role: expect.any(String) }),
    ]));

    const pendingUser = registry.body.users[0];
    const updated = await request(app)
      .patch(`/api/staff/users/${pendingUser.id}`)
      .set('x-mock-role', 'IT_STAFF')
      .send({ role: 'MANAGER', status: 'APPROVED' });

    expect(updated.status).toBe(200);
    expect(updated.body.user).toMatchObject({ id: pendingUser.id, role: 'MANAGER', status: 'APPROVED' });
  });

  it('allows IT Staff to disable a user account from the user registry', async () => {
    const registry = await request(app).get('/api/staff/users').set('x-mock-role', 'IT_STAFF');
    const user = registry.body.users[0];

    const updated = await request(app)
      .patch(`/api/staff/users/${user.id}`)
      .set('x-mock-role', 'IT_STAFF')
      .send({ role: user.role, status: 'DISABLED' });

    expect(updated.status).toBe(200);
    expect(updated.body.user).toMatchObject({ id: user.id, status: 'DISABLED' });
  });

  it('lets IT Staff enable or disable a categorized procedure in the service registry', async () => {
    const settings = await request(app).get('/api/staff/settings').set('x-mock-role', 'IT_STAFF');
    const procedure = settings.body.services[0];
    expect(procedure).toMatchObject({ category: expect.any(String), active: expect.any(Boolean) });

    const disabled = await request(app)
      .patch(`/api/staff/services/${procedure.id}`)
      .set('x-mock-role', 'IT_STAFF')
      .send({ active: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.service).toMatchObject({ id: procedure.id, active: false });

    await request(app).patch(`/api/staff/services/${procedure.id}`).set('x-mock-role', 'IT_STAFF').send({ active: true });
  });
  it('imports a dentist duty roster from an uploaded Excel sheet and stores each duty date', async () => {
    const workbook = await dutyRosterWorkbook();

    const parsed = await request(app)
      .post('/api/staff/duty-rosters/parse')
      .set('x-mock-role', 'CLINIC_STAFF')
      .attach('roster', workbook, { filename: 'duty-2569-09.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(parsed.status).toBe(200);
    expect(parsed.body.detectedMonth).toBe('2026-09');
    expect(parsed.body.rows).toHaveLength(2);
    expect(parsed.body.skippedNames).toEqual(['นางสาวสมหญิง ใจดี']);
    expect(parsed.body.rows.map((row: { name: string }) => row.name)).not.toContain('นางสาวสมหญิง ใจดี');
    expect(parsed.body.rows[0]).toMatchObject({ name: 'ทพญ.นิศา ทองนพคุณ', dentistId: expect.any(Number), days: [{ day: 17, mark: '/' }] });
    expect(parsed.body.rows[1].days).toEqual([{ day: 14, mark: '/' }, { day: 28, mark: '/' }]);

    const saved = await request(app)
      .post('/api/staff/duty-rosters')
      .set('x-mock-role', 'CLINIC_STAFF')
      .send({ month: '2026-09', title: parsed.body.title, sourceFileName: parsed.body.sourceFileName, rows: parsed.body.rows });
    expect(saved.status).toBe(201);
    expect(saved.body.roster).toMatchObject({ month: '2026-09', daysInMonth: 30 });
    expect(saved.body.members[1].dutyDays.map((duty: { date: string }) => duty.date)).toEqual(['2026-09-14', '2026-09-28']);

    const itDenied = await request(app).get('/api/staff/duty-rosters/2026-09').set('x-mock-role', 'IT_STAFF');
    expect(itDenied.status).toBe(403);
    const detail = await request(app).get('/api/staff/duty-rosters/2026-09').set('x-mock-role', 'CLINIC_STAFF');
    expect(detail.status).toBe(200);
    expect(detail.body.members[0]).toMatchObject({ sequenceNo: 1, name: 'ทพญ.นิศา ทองนพคุณ', dutyDays: [{ day: 17, date: '2026-09-17', mark: '/' }] });
    expect(detail.body.holidays).toEqual([]);
    expect(['google', 'fallback']).toContain(detail.body.holidaySource);

    const listed = await request(app).get('/api/staff/duty-rosters').set('x-mock-role', 'CLINIC_STAFF');
    expect(listed.body.rosters).toEqual(expect.arrayContaining([expect.objectContaining({ month: '2026-09', memberCount: 2, dutyCount: 3 })]));

    const removed = await request(app).delete('/api/staff/duty-rosters/2026-09').set('x-mock-role', 'CLINIC_STAFF');
    expect(removed.status).toBe(200);
    expect((await request(app).get('/api/staff/duty-rosters/2026-09').set('x-mock-role', 'CLINIC_STAFF')).status).toBe(404);
  });

  it('replaces an existing duty roster month instead of duplicating it', async () => {
    const rows = [{ sequenceNo: 1, name: 'ทพญ.นิศา ทองนพคุณ', dentistId: null, days: [{ day: 3, mark: '/' }, { day: 31, mark: '/' }] }];
    await request(app).post('/api/staff/duty-rosters').set('x-mock-role', 'CLINIC_STAFF').send({ month: '2026-09', rows });
    const second = await request(app)
      .post('/api/staff/duty-rosters')
      .set('x-mock-role', 'CLINIC_STAFF')
      .send({ month: '2026-09', rows: [{ ...rows[0], days: [{ day: 5, mark: 'x' }] }] });

    expect(second.status).toBe(201);
    expect(second.body.members).toHaveLength(1);
    expect(second.body.members[0].dutyDays).toEqual([{ day: 5, date: '2026-09-05', mark: 'x' }]);

    await request(app).delete('/api/staff/duty-rosters/2026-09').set('x-mock-role', 'CLINIC_STAFF');
  });

  it('serves a duty roster template whose own upload round-trips through the parse endpoint', async () => {
    const template = await request(app).get('/api/staff/duty-rosters/template?month=2026-09').set('x-mock-role', 'CLINIC_STAFF').responseType('blob');
    expect(template.status).toBe(200);
    expect(template.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(template.headers['content-disposition']).toContain('duty-roster-2026-09.xlsx');

    const parsed = await request(app)
      .post('/api/staff/duty-rosters/parse')
      .set('x-mock-role', 'CLINIC_STAFF')
      .attach('roster', template.body, { filename: 'duty-roster-2026-09.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    expect(parsed.status).toBe(200);
    expect(parsed.body.detectedMonth).toBe('2026-09');
    expect(parsed.body.rows.length).toBeGreaterThan(0);
    expect(parsed.body.rows.every((row: { dentistId: number | null }) => row.dentistId !== null)).toBe(true);
    expect(parsed.body.rows.every((row: { days: unknown[] }) => row.days.length === 0)).toBe(true);
  });

  it('marks Thai public holidays in a saved roster month', async () => {
    await request(app).post('/api/staff/duty-rosters').set('x-mock-role', 'CLINIC_STAFF')
      .send({ month: '2026-10', rows: [{ sequenceNo: 1, name: 'ทพญ.นิศา ทองนพคุณ', dentistId: null, days: [{ day: 13, mark: '/' }] }] });

    const detail = await request(app).get('/api/staff/duty-rosters/2026-10').set('x-mock-role', 'CLINIC_STAFF');

    expect(detail.status).toBe(200);
    expect(detail.body.holidays.map((holiday: { day: number }) => holiday.day)).toEqual([13, 23]);
    expect(detail.body.holidays[0]).toMatchObject({ date: '2026-10-13', name: expect.any(String) });

    await request(app).delete('/api/staff/duty-rosters/2026-10').set('x-mock-role', 'CLINIC_STAFF');
  });

  it('refuses to save a duty roster row that is not a dentist unless it is mapped to the registry', async () => {
    const rejected = await request(app).post('/api/staff/duty-rosters').set('x-mock-role', 'CLINIC_STAFF')
      .send({ month: '2026-11', rows: [{ sequenceNo: 1, name: 'นางสาวสมหญิง ใจดี', dentistId: null, days: [{ day: 2, mark: '/' }] }] });

    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toContain('นางสาวสมหญิง ใจดี');
    expect((await request(app).get('/api/staff/duty-rosters/2026-11').set('x-mock-role', 'CLINIC_STAFF')).status).toBe(404);

    const dentists = await request(app).get('/api/staff/dentists').set('x-mock-role', 'IT_STAFF');
    const dentistId = dentists.body.dentists[0].id;
    const mapped = await request(app).post('/api/staff/duty-rosters').set('x-mock-role', 'CLINIC_STAFF')
      .send({ month: '2026-11', rows: [{ sequenceNo: 1, name: 'ชื่อเดิมในไฟล์', dentistId, days: [{ day: 2, mark: '/' }] }] });

    expect(mapped.status).toBe(201);
    await request(app).delete('/api/staff/duty-rosters/2026-11').set('x-mock-role', 'CLINIC_STAFF');
  });

  it('saves a roster whose Excel header was merged across columns instead of rejecting the long title', async () => {
    const saved = await request(app).post('/api/staff/duty-rosters').set('x-mock-role', 'CLINIC_STAFF')
      .send({ month: '2026-11', title: 'ตารางปฏิบัติงาน '.repeat(300), rows: [{ sequenceNo: 1, name: 'ทพญ.นิศา ทองนพคุณ', dentistId: null, days: [] }] });

    expect(saved.status).toBe(201);
    expect(saved.body.roster.title.length).toBeLessThanOrEqual(255);
    expect(saved.body.members[0]).toMatchObject({ name: 'ทพญ.นิศา ทองนพคุณ', dutyDays: [] });

    await request(app).delete('/api/staff/duty-rosters/2026-11').set('x-mock-role', 'CLINIC_STAFF');
  });

  it('names the offending field when a duty roster payload really is invalid', async () => {
    const rejected = await request(app).post('/api/staff/duty-rosters').set('x-mock-role', 'CLINIC_STAFF')
      .send({ month: '2569-99', rows: [] });

    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toContain('บันทึกทะเบียนลงเวรไม่ได้');
    expect(rejected.body.message).toContain('month');
    expect(rejected.body.message).not.toContain('ข้อมูลการจองไม่ครบถ้วน');
  });

  it('exposes the current week duty schedule publicly for the team page, without requiring a staff role', async () => {
    const dentists = await request(app).get('/api/staff/dentists').set('x-mock-role', 'IT_STAFF');
    const dentistId = dentists.body.dentists[0].id;
    const today = new Date();
    const isoToday = today.toISOString().slice(0, 10);
    const monthOfToday = isoToday.slice(0, 7);
    // เดือนนี้อาจมีทะเบียนลงเวรจริงของคลินิกอยู่แล้ว (ไม่ใช่เดือนทดสอบในอนาคตแบบเทสต์อื่น) —
    // เก็บสำรองไว้ก่อนเขียนทับ แล้วค่อยคืนกลับตอนจบ ไม่ให้ข้อมูลจริงหายเพราะรันเทสต์
    const before = await request(app).get(`/api/staff/duty-rosters/${monthOfToday}`).set('x-mock-role', 'CLINIC_STAFF');
    const existingRoster = before.status === 200 ? before.body as RosterDetailForRestore : null;

    await request(app).post('/api/staff/duty-rosters').set('x-mock-role', 'CLINIC_STAFF')
      .send({ month: monthOfToday, rows: [{ sequenceNo: 1, name: 'ทดสอบตารางรายสัปดาห์', dentistId, days: [{ day: today.getUTCDate(), mark: '/' }] }] });

    try {
      const schedule = await request(app).get('/api/dentists/weekly-duty-schedule');
      expect(schedule.status).toBe(200);
      expect(schedule.body.weekStart <= isoToday && isoToday <= schedule.body.weekEnd).toBe(true);
      const entry = schedule.body.dentists.find((dentist: { id: number }) => dentist.id === dentistId);
      expect(entry).toBeDefined();
      expect(entry.dates).toContain(isoToday);
    } finally {
      if (existingRoster) {
        await request(app).post('/api/staff/duty-rosters').set('x-mock-role', 'CLINIC_STAFF').send({
          month: monthOfToday, title: existingRoster.roster.title, sourceFileName: existingRoster.roster.sourceFileName,
          rows: existingRoster.members.map((member) => ({ sequenceNo: member.sequenceNo, name: member.sourceName, dentistId: member.dentistId, days: member.dutyDays.map((duty) => ({ day: duty.day, mark: duty.mark })) })),
        });
      } else {
        await request(app).delete(`/api/staff/duty-rosters/${monthOfToday}`).set('x-mock-role', 'CLINIC_STAFF');
      }
    }
  });

  it('rejects a template request for a malformed month', async () => {
    expect((await request(app).get('/api/staff/duty-rosters/template?month=2569-13').set('x-mock-role', 'CLINIC_STAFF')).status).toBe(400);
    expect((await request(app).get('/api/staff/duty-rosters/template').set('x-mock-role', 'MANAGER')).status).toBe(403);
  });

  it('keeps the duty roster endpoints closed to managers and rejects a non-Excel upload', async () => {
    expect((await request(app).get('/api/staff/duty-rosters').set('x-mock-role', 'MANAGER')).status).toBe(403);
    const rejected = await request(app)
      .post('/api/staff/duty-rosters/parse')
      .set('x-mock-role', 'CLINIC_STAFF')
      .attach('roster', Buffer.from('not a workbook'), { filename: 'duty.csv', contentType: 'text/csv' });
    expect(rejected.status).toBe(400);
  });

  describe('daily queue board (/staff/day-queue, walk-in, cancel, visit-status)', () => {
    async function cleanupCentralQueueDate(date: string) {
      await pool.query('DELETE ash FROM appointment_status_history ash INNER JOIN appointments a ON a.id = ash.appointment_id INNER JOIN booking_slots bs ON bs.id = a.slot_id WHERE bs.dentist_id IS NULL AND bs.service_date = ?', [date]);
      await pool.query('DELETE pvr FROM patient_visit_registry pvr INNER JOIN appointments a ON a.id = pvr.appointment_id INNER JOIN booking_slots bs ON bs.id = a.slot_id WHERE bs.dentist_id IS NULL AND bs.service_date = ?', [date]);
      await pool.query('DELETE nd FROM notification_deliveries nd INNER JOIN appointments a ON a.id = nd.appointment_id INNER JOIN booking_slots bs ON bs.id = a.slot_id WHERE bs.dentist_id IS NULL AND bs.service_date = ?', [date]);
      await pool.query('DELETE a FROM appointments a INNER JOIN booking_slots bs ON bs.id = a.slot_id WHERE bs.dentist_id IS NULL AND bs.service_date = ?', [date]);
      await pool.query('DELETE FROM booking_slots WHERE dentist_id IS NULL AND service_date = ?', [date]);
      await pool.query('DELETE FROM queue_counters WHERE service_date = ? AND queue_prefix = ?', [date, 'CLN']);
    }

    it('exposes the day\'s slots grouped with their appointments, masked CID, and assignable services', async () => {
      const date = '2100-01-05';
      const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
      try {
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'TIME_ONLY' });
        await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ date, startTimes: ['09:00'], capacity: 2 });
        const availability = await request(app).get(`/api/availability?date=${date}`);
        const slotId = availability.body.slots.find((slot: { startsAt: string }) => slot.startsAt === `${date}T09:00:00+07:00`).id;
        const booking = await request(app).post('/api/appointments').set('Cookie', await patientCookie('1103700123456', 'นางสาวคิว ทดสอบวัน')).send({  slotId, phone: '0812345678' });
        expect(booking.status).toBe(201);

        const denied = await request(app).get(`/api/staff/day-queue?date=${date}`).set('x-mock-role', 'IT_STAFF');
        expect(denied.status).toBe(403);

        const dayQueue = await request(app).get(`/api/staff/day-queue?date=${date}`).set('x-mock-role', 'CLINIC_STAFF');
        expect(dayQueue.status).toBe(200);
        expect(dayQueue.body.bookingFlow).toBe('TIME_ONLY');
        expect(dayQueue.body.summary).toMatchObject({ totalSlots: 1, totalCapacity: 2, totalBooked: 1, freeSeats: 1, pending: expect.any(Number), confirmed: expect.any(Number), cancelled: 0 });
        const slot = dayQueue.body.slots.find((item: { id: number }) => item.id === slotId);
        expect(slot).toMatchObject({ dentistName: 'คิวกลางคลินิก', capacity: 2, bookedCount: 1 });
        expect(slot.appointments).toEqual([expect.objectContaining({
          patientName: 'นางสาวคิว ทดสอบวัน', patientIdentityMasked: '110******3456', phone: '0812345678',
        })]);
        expect(dayQueue.body.dentists).toEqual(expect.arrayContaining([
          expect.objectContaining({ displayName: expect.any(String), services: expect.any(Array) }),
        ]));
      } finally {
        await cleanupCentralQueueDate(date);
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
      }
    });

    it('hides dentist-bound slots left over from another booking flow once the clinic switches to TIME_ONLY', async () => {
      const date = '2100-01-09';
      const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
      try {
        // สร้างสล็อตผูกทันตแพทย์ไว้ตอนยังเป็นโหมด DENTIST_ONLY
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'DENTIST_ONLY' });
        const roster = await request(app).get(`/api/staff/slots?date=${date}`).set('x-mock-role', 'CLINIC_STAFF');
        const dentist = roster.body.dentists[0];
        await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ dentistId: dentist.id, date, startTimes: ['09:00'] });

        // คลินิกเปลี่ยนมาใช้ TIME_ONLY (คิวกลาง) แล้วสร้างสล็อตกลางของวันเดียวกันเพิ่ม
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'TIME_ONLY' });
        await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ date, startTimes: ['10:00'], capacity: 2 });

        const dayQueue = await request(app).get(`/api/staff/day-queue?date=${date}`).set('x-mock-role', 'CLINIC_STAFF');
        expect(dayQueue.status).toBe(200);
        expect(dayQueue.body.bookingFlow).toBe('TIME_ONLY');
        // สล็อตผูกทันตแพทย์เก่าต้องไม่ถูกนำมาแสดงเมื่อ flow ปัจจุบันคือ TIME_ONLY
        expect(dayQueue.body.slots.every((slot: { dentistId: number | null }) => slot.dentistId === null)).toBe(true);
        expect(dayQueue.body.slots).toEqual([expect.objectContaining({ dentistName: 'คิวกลางคลินิก', startTime: '10:00' })]);
        expect(dayQueue.body.summary.totalSlots).toBe(1);

        // สลับกลับไป DENTIST_ONLY สล็อตผูกทันตแพทย์เดิมต้องกลับมาเห็นได้ตามปกติ
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'DENTIST_ONLY' });
        const dayQueueBack = await request(app).get(`/api/staff/day-queue?date=${date}`).set('x-mock-role', 'CLINIC_STAFF');
        expect(dayQueueBack.body.bookingFlow).toBe('DENTIST_ONLY');
        expect(dayQueueBack.body.slots).toEqual(expect.arrayContaining([expect.objectContaining({ dentistId: dentist.id, startTime: '09:00' })]));
        expect(dayQueueBack.body.summary.totalSlots).toBe(2);
      } finally {
        await pool.query('DELETE FROM booking_slots WHERE service_date = ?', [date]);
        await pool.query('DELETE FROM queue_counters WHERE service_date = ? AND queue_prefix = ?', [date, 'CLN']);
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
      }
    });

    it('lets Clinic Staff add a walk-in that is confirmed immediately and bypasses the online-booking block', async () => {
      const date = '2100-01-06';
      const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
      try {
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'TIME_ONLY' });
        await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ date, startTimes: ['09:00'], capacity: 1 });
        const availability = await request(app).get(`/api/availability?date=${date}`);
        const slotId = availability.body.slots.find((slot: { startsAt: string }) => slot.startsAt === `${date}T09:00:00+07:00`).id;

        // ผู้ป่วยรายนี้ถูกระงับสิทธิ์จองออนไลน์ไว้ก่อน (seed ตรงลง DB) — walk-in ของเจ้าหน้าที่ต้องยังเพิ่มได้
        const blockedIdentity = '1109900001112';
        await pool.query('INSERT INTO patient_registry (patient_identity, patient_display_name, access_status) VALUES (?, ?, ?)', [blockedIdentity, 'ทดสอบ ถูกบล็อก', 'BLOCKED']);

        const denied = await request(app).post('/api/staff/appointments/walk-in').set('x-mock-role', 'IT_STAFF').send({ slotId, patientDisplayName: 'ไม่ควรผ่าน', phone: '0899999999' });
        expect(denied.status).toBe(403);

        // เลขบัตรประชาชนบังคับกรอกเสมอ — ไม่กรอกเลยหรือกรอกผิดรูปแบบต้องถูกปฏิเสธ
        const missingCid = await request(app).post('/api/staff/appointments/walk-in').set('x-mock-role', 'CLINIC_STAFF').send({ slotId, patientDisplayName: 'ไม่มีเลขบัตร', phone: '0898765432' });
        expect(missingCid.status).toBe(400);
        const invalidCid = await request(app).post('/api/staff/appointments/walk-in').set('x-mock-role', 'CLINIC_STAFF').send({ slotId, patientDisplayName: 'เลขบัตรผิด', phone: '0898765432', citizenId: 'ABCDEFGHIJKLM' });
        expect(invalidCid.status).toBe(400);

        const walkIn = await request(app).post('/api/staff/appointments/walk-in').set('x-mock-role', 'CLINIC_STAFF').send({ slotId, patientDisplayName: 'คุณวอล์กอิน ถูกบล็อกออนไลน์', phone: '0898765432', citizenId: blockedIdentity });
        expect(walkIn.status).toBe(201);
        expect(walkIn.body.appointment).toMatchObject({ appointmentStatus: 'CONFIRMED', paymentStatus: 'NOT_REQUIRED', paymentAmount: 0, reservationPaymentRequired: false });

        const dayQueue = await request(app).get(`/api/staff/day-queue?date=${date}`).set('x-mock-role', 'CLINIC_STAFF');
        expect(dayQueue.body.summary).toMatchObject({ totalBooked: 1, confirmed: 1 });

        const full = await request(app).post('/api/staff/appointments/walk-in').set('x-mock-role', 'CLINIC_STAFF').send({ slotId, patientDisplayName: 'คนที่สอง เต็มแล้ว', phone: '0812340000', citizenId: '1109900001113' });
        expect(full.status).toBe(409);
      } finally {
        await cleanupCentralQueueDate(date);
        await pool.query("DELETE FROM patient_registry WHERE patient_identity IN ('1109900001112', '1109900001113')");
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
      }
    });

    it('lets Clinic Staff cancel an appointment, returns the seat to the slot, and rejects a second cancel', async () => {
      const date = '2100-01-07';
      const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
      try {
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'TIME_ONLY' });
        await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ date, startTimes: ['09:00'], capacity: 1 });
        const availability = await request(app).get(`/api/availability?date=${date}`);
        const slotId = availability.body.slots.find((slot: { startsAt: string }) => slot.startsAt === `${date}T09:00:00+07:00`).id;
        const booking = await request(app).post('/api/appointments').set('Cookie', await patientCookie('CANCEL-TEST-CID', 'นายยกเลิก ทดสอบ')).send({  slotId, phone: '0812345678' });
        const appointmentId = booking.body.appointment.appointmentId;

        const denied = await request(app).post(`/api/staff/appointments/${appointmentId}/cancel`).set('x-mock-role', 'MANAGER').send({});
        expect(denied.status).toBe(403);

        const cancelled = await request(app).post(`/api/staff/appointments/${appointmentId}/cancel`).set('x-mock-role', 'CLINIC_STAFF').send({ reason: 'ผู้ป่วยโทรมายกเลิกเอง' });
        expect(cancelled.status).toBe(200);

        const [cancellationDeliveries] = await pool.query<RowDataPacket[]>(
          "SELECT delivery_status AS deliveryStatus, cancel_reason AS cancelReason FROM notification_deliveries WHERE appointment_id = ? AND notification_type = 'CANCELLATION'",
          [appointmentId],
        );
        expect(cancellationDeliveries[0]).toMatchObject({ cancelReason: 'ผู้ป่วยโทรมายกเลิกเอง' });

        const dayQueue = await request(app).get(`/api/staff/day-queue?date=${date}`).set('x-mock-role', 'CLINIC_STAFF');
        const slot = dayQueue.body.slots.find((item: { id: number }) => item.id === slotId);
        expect(slot).toMatchObject({ bookedCount: 0 });
        expect(slot.appointments[0]).toMatchObject({ status: 'CANCELLED' });

        // เต็มโควตาหลังยกเลิกแล้วต้องจองซ้ำเข้าสล็อตเดิมได้อีก (พิสูจน์ว่า booked_count ลดจริง ไม่ใช่แค่ status เปลี่ยน)
        const rebook = await request(app).post('/api/appointments').set('Cookie', await patientCookie('CANCEL-TEST-REBOOK', 'นางจองซ้ำ ทดสอบ')).send({  slotId, phone: '0812345679' });
        expect(rebook.status).toBe(201);

        const secondCancel = await request(app).post(`/api/staff/appointments/${appointmentId}/cancel`).set('x-mock-role', 'CLINIC_STAFF').send({});
        expect(secondCancel.status).toBe(409);

        const missing = await request(app).post('/api/staff/appointments/999999999/cancel').set('x-mock-role', 'CLINIC_STAFF').send({});
        expect(missing.status).toBe(404);
      } finally {
        await cleanupCentralQueueDate(date);
        await pool.query("DELETE FROM patient_registry WHERE patient_identity IN ('CANCEL-TEST-CID', 'CANCEL-TEST-REBOOK')");
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
      }
    });

    it('lets Clinic Staff mark a confirmed appointment as served or no-show, but not a pending one', async () => {
      const date = '2100-01-08';
      const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
      try {
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'TIME_ONLY' });
        await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ date, startTimes: ['09:00', '09:30'], capacity: 1 });
        const availability = await request(app).get(`/api/availability?date=${date}`);
        const walkInSlotId = availability.body.slots.find((slot: { startsAt: string }) => slot.startsAt === `${date}T09:00:00+07:00`).id;
        const pendingSlotId = availability.body.slots.find((slot: { startsAt: string }) => slot.startsAt === `${date}T09:30:00+07:00`).id;

        const walkIn = await request(app).post('/api/staff/appointments/walk-in').set('x-mock-role', 'CLINIC_STAFF').send({ slotId: walkInSlotId, patientDisplayName: 'คุณมาตามนัด ทดสอบ', phone: '0812345678', citizenId: '1109900001114' });
        const confirmedId = walkIn.body.appointment.appointmentId;
        const pendingBooking = await request(app).post('/api/appointments').set('Cookie', await patientCookie('VISIT-STATUS-PENDING', 'ยังไม่ยืนยัน ทดสอบ')).send({  slotId: pendingSlotId, phone: '0898888888' });
        const pendingId = pendingBooking.body.appointment.appointmentId;

        const denied = await request(app).patch(`/api/staff/appointments/${confirmedId}/visit-status`).set('x-mock-role', 'MANAGER').send({ visitStatus: 'SERVED' });
        expect(denied.status).toBe(403);

        const served = await request(app).patch(`/api/staff/appointments/${confirmedId}/visit-status`).set('x-mock-role', 'CLINIC_STAFF').send({ visitStatus: 'SERVED' });
        expect(served.status).toBe(200);
        const dayQueue = await request(app).get(`/api/staff/day-queue?date=${date}`).set('x-mock-role', 'CLINIC_STAFF');
        const walkInSlot = dayQueue.body.slots.find((item: { id: number }) => item.id === walkInSlotId);
        expect(walkInSlot.appointments[0]).toMatchObject({ visitStatus: 'SERVED' });

        const pendingRejected = await request(app).patch(`/api/staff/appointments/${pendingId}/visit-status`).set('x-mock-role', 'CLINIC_STAFF').send({ visitStatus: 'NO_SHOW' });
        expect(pendingRejected.status).toBe(409);

        const cleared = await request(app).patch(`/api/staff/appointments/${confirmedId}/visit-status`).set('x-mock-role', 'CLINIC_STAFF').send({ visitStatus: 'BOOKED' });
        expect(cleared.status).toBe(200);
      } finally {
        await cleanupCentralQueueDate(date);
        await pool.query("DELETE FROM patient_registry WHERE patient_identity IN ('VISIT-STATUS-PENDING', '1109900001114')");
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
      }
    });
  });

  it('refuses a manual login for a patient the clinic has blocked', async () => {
    const identity = '1101700207009';
    try {
      await pool.query("INSERT INTO patient_registry (patient_identity, patient_display_name, access_status) VALUES (?, ?, 'BLOCKED')", [identity, 'ถูกบล็อก ทดสอบ']);
      const blocked = await request(app).post('/api/auth/patient/manual').send({ citizenId: identity, displayName: 'ถูกบล็อก ทดสอบ' });
      expect(blocked.status).toBe(403);
      expect(blocked.headers['set-cookie']).toBeUndefined();

      await pool.query("UPDATE patient_registry SET access_status = 'ACTIVE' WHERE patient_identity = ?", [identity]);
      expect((await request(app).post('/api/auth/patient/manual').send({ citizenId: identity, displayName: 'ถูกบล็อก ทดสอบ' })).status).toBe(201);
    } finally {
      await pool.query('DELETE FROM patient_sessions WHERE patient_identity = ?', [identity]);
      await pool.query('DELETE FROM patient_registry WHERE patient_identity = ?', [identity]);
    }
  });

  describe('patient endpoints without a session (no MOCK-PATIENT-001 fallback)', () => {
    // เดิม endpoint พวกนี้ fallback ไป identity สมมติ 'MOCK-PATIENT-001' ทำให้ผู้ป่วยที่ session หมดอายุ
    // เห็นคิวของคนอื่นแทนที่จะถูกเด้งไป login — ตอนนี้ต้องตอบ 401 เสมอ
    it('answers 401 instead of serving another identity\'s data', async () => {
      const appointments = await request(app).get('/api/patient/appointments');
      expect(appointments.status).toBe(401);
      expect(appointments.body).toEqual({ message: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });

      expect((await request(app).get('/api/patient/satisfaction')).status).toBe(401);

      const survey = await request(app).post('/api/patient/satisfaction')
        .send({ appointmentId: 1, cleanlinessRating: 5, staffRating: 5, waitTimeRating: 5, overallRating: 5 });
      expect(survey.status).toBe(401);

      const booking = await request(app).post('/api/appointments').send({ slotId: 999999, phone: '0812345678' });
      expect(booking.status).toBe(401);
    });

    it('ignores an identity claimed in the request body when there is no session', async () => {
      // เดิม body/query ประกาศ identity เองได้ ตอนนี้ต้องมาจาก session cookie เท่านั้น
      const booking = await request(app).post('/api/appointments').send({ slotId: 999999, phone: '0812345678', patientIdentity: 'BODY-CLAIMED-IDENTITY' });
      expect(booking.status).toBe(401);

      const appointments = await request(app).get('/api/patient/appointments?identity=BODY-CLAIMED-IDENTITY');
      expect(appointments.status).toBe(401);

      const satisfaction = await request(app).get('/api/patient/satisfaction?identity=BODY-CLAIMED-IDENTITY');
      expect(satisfaction.status).toBe(401);
    });
  });

  describe('patient satisfaction survey (/api/patient/satisfaction)', () => {
    it('lets a served patient rate a dentist-bound visit, requires the dentist rating, and blocks a second submission', async () => {
      const date = '2100-01-11';
      const patientIdentity = '1109900002201';
      const staffDentists = await request(app).get('/api/staff/dentists').set('x-mock-role', 'IT_STAFF');
      const dentist = staffDentists.body.dentists.find((entry: { active: boolean }) => entry.active);
      const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
      try {
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'DENTIST_ONLY' });
        await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ dentistId: dentist.id, date, startTimes: ['09:00'] });
        const availability = await request(app).get(`/api/dentists/${dentist.id}/availability?date=${date}`);
        const slotId = availability.body.slots[0].id;
        const walkIn = await request(app).post('/api/staff/appointments/walk-in').set('x-mock-role', 'CLINIC_STAFF')
          .send({ slotId, patientDisplayName: 'คุณประเมิน ทันตแพทย์', phone: '0891234567', citizenId: patientIdentity });
        expect(walkIn.status).toBe(201);
        const appointmentId = walkIn.body.appointment.appointmentId;

        // ยังไม่มาตามนัด (visit_status ยังเป็น BOOKED) ต้องประเมินไม่ได้
        const tooSoon = await request(app).post('/api/patient/satisfaction').set('Cookie', await patientCookie(patientIdentity))
          .send({ appointmentId, cleanlinessRating: 5, staffRating: 5, dentistRating: 5, waitTimeRating: 5, overallRating: 5 });
        expect(tooSoon.status).toBe(403);

        const served = await request(app).patch(`/api/staff/appointments/${appointmentId}/visit-status`).set('x-mock-role', 'CLINIC_STAFF').send({ visitStatus: 'SERVED' });
        expect(served.status).toBe(200);

        const before = await request(app).get('/api/patient/satisfaction').set('Cookie', await patientCookie(patientIdentity));
        expect(before.status).toBe(200);
        expect(before.body.visits).toEqual([expect.objectContaining({ appointmentId, hasDentist: true, dentistName: dentist.displayName, survey: null })]);

        const missingDentistRating = await request(app).post('/api/patient/satisfaction').set('Cookie', await patientCookie(patientIdentity))
          .send({ appointmentId, cleanlinessRating: 5, staffRating: 5, waitTimeRating: 5, overallRating: 5 });
        expect(missingDentistRating.status).toBe(400);

        const outOfRange = await request(app).post('/api/patient/satisfaction').set('Cookie', await patientCookie(patientIdentity))
          .send({ appointmentId, cleanlinessRating: 6, staffRating: 5, dentistRating: 5, waitTimeRating: 5, overallRating: 5 });
        expect(outOfRange.status).toBe(400);

        // ล็อกอินเป็นคนอื่นแล้วพยายามประเมินนัดของคนนี้ ต้องไม่เห็นนัดหมายนี้เลย
        const wrongOwner = await request(app).post('/api/patient/satisfaction').set('Cookie', await patientCookie('1109900002299', 'คนอื่น ทดสอบ'))
          .send({ appointmentId, cleanlinessRating: 5, staffRating: 5, dentistRating: 5, waitTimeRating: 5, overallRating: 5 });
        expect(wrongOwner.status).toBe(404);

        const submitted = await request(app).post('/api/patient/satisfaction').set('Cookie', await patientCookie(patientIdentity))
          .send({ appointmentId, cleanlinessRating: 4, staffRating: 5, dentistRating: 5, waitTimeRating: 3, overallRating: 4, comment: 'ประทับใจมาก' });
        expect(submitted.status).toBe(201);

        const after = await request(app).get('/api/patient/satisfaction').set('Cookie', await patientCookie(patientIdentity));
        expect(after.body.visits[0].survey).toMatchObject({ cleanlinessRating: 4, staffRating: 5, dentistRating: 5, waitTimeRating: 3, overallRating: 4, comment: 'ประทับใจมาก' });

        const duplicate = await request(app).post('/api/patient/satisfaction').set('Cookie', await patientCookie(patientIdentity))
          .send({ appointmentId, cleanlinessRating: 5, staffRating: 5, dentistRating: 5, waitTimeRating: 5, overallRating: 5 });
        expect(duplicate.status).toBe(409);
      } finally {
        await pool.query('DELETE FROM satisfaction_surveys WHERE appointment_id IN (SELECT id FROM appointments WHERE patient_identity = ?)', [patientIdentity]);
        await pool.query('DELETE FROM appointment_status_history WHERE appointment_id IN (SELECT id FROM appointments WHERE patient_identity = ?)', [patientIdentity]);
        await pool.query('DELETE FROM patient_visit_registry WHERE patient_identity = ?', [patientIdentity]);
        await pool.query('DELETE FROM appointments WHERE patient_identity = ?', [patientIdentity]);
        await pool.query('DELETE FROM booking_slots WHERE dentist_id = ? AND service_date = ?', [dentist.id, date]);
        await pool.query('DELETE FROM queue_counters WHERE service_date = ? AND queue_prefix = ?', [date, dentist.queuePrefix]);
        await pool.query('DELETE FROM patient_registry WHERE patient_identity = ?', [patientIdentity]);
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
      }
    });

    it('lets a served central-queue patient submit a survey without a dentist rating', async () => {
      const date = '2100-01-12';
      const patientIdentity = '1109900002202';
      const initial = await request(app).get('/api/staff/system-settings').set('x-mock-role', 'IT_STAFF');
      try {
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: 'TIME_ONLY' });
        await request(app).post('/api/staff/slots').set('x-mock-role', 'CLINIC_STAFF').send({ date, startTimes: ['09:00'], capacity: 1 });
        const availability = await request(app).get(`/api/availability?date=${date}`);
        const slotId = availability.body.slots.find((slot: { startsAt: string }) => slot.startsAt === `${date}T09:00:00+07:00`).id;
        const walkIn = await request(app).post('/api/staff/appointments/walk-in').set('x-mock-role', 'CLINIC_STAFF')
          .send({ slotId, patientDisplayName: 'คุณประเมิน คิวกลาง', phone: '0891112222', citizenId: patientIdentity });
        expect(walkIn.status).toBe(201);
        const appointmentId = walkIn.body.appointment.appointmentId;
        await request(app).patch(`/api/staff/appointments/${appointmentId}/visit-status`).set('x-mock-role', 'CLINIC_STAFF').send({ visitStatus: 'SERVED' });

        const before = await request(app).get('/api/patient/satisfaction').set('Cookie', await patientCookie(patientIdentity));
        expect(before.body.visits).toEqual([expect.objectContaining({ appointmentId, hasDentist: false, survey: null })]);

        const submitted = await request(app).post('/api/patient/satisfaction').set('Cookie', await patientCookie(patientIdentity))
          .send({ appointmentId, cleanlinessRating: 5, staffRating: 5, waitTimeRating: 4, overallRating: 5 });
        expect(submitted.status).toBe(201);

        const after = await request(app).get('/api/patient/satisfaction').set('Cookie', await patientCookie(patientIdentity));
        expect(after.body.visits[0].survey).toMatchObject({ dentistRating: null });
      } finally {
        await pool.query('DELETE FROM satisfaction_surveys WHERE appointment_id IN (SELECT id FROM appointments WHERE patient_identity = ?)', [patientIdentity]);
        await pool.query('DELETE FROM appointment_status_history WHERE appointment_id IN (SELECT id FROM appointments WHERE patient_identity = ?)', [patientIdentity]);
        await pool.query('DELETE FROM patient_visit_registry WHERE patient_identity = ?', [patientIdentity]);
        await pool.query('DELETE FROM appointments WHERE patient_identity = ?', [patientIdentity]);
        await pool.query('DELETE FROM booking_slots WHERE dentist_id IS NULL AND service_date = ?', [date]);
        await pool.query('DELETE FROM queue_counters WHERE service_date = ? AND queue_prefix = ?', [date, 'CLN']);
        await pool.query('DELETE FROM patient_registry WHERE patient_identity = ?', [patientIdentity]);
        await request(app).patch('/api/staff/system-settings/booking-flow').set('x-mock-role', 'IT_STAFF').send({ bookingFlow: initial.body.bookingFlow });
      }
    });
  });
});
