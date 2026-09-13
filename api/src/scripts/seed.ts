import type { RowDataPacket } from 'mysql2';

import { pool } from '../db.js';

const procedures = [
  ['งานทั่วไป', 'ถอนฟัน/ถอนฟันยาก', 60, '350–600 บาท'], ['งานทั่วไป', 'ผ่าฟันคุด/ฟันฝัง', 90, '1,500–3,500 บาท'], ['งานทั่วไป', 'อุดฟัน', 60, '550–1,000 บาท'], ['งานทั่วไป', 'ขูดหินปูนทั้งปาก', 45, '700 บาท'], ['งานทั่วไป', 'เกลารากฟัน/ขูดหินน้ำลายลึก', 60, '1,400 บาท'],
  ['ทันตกรรมสำหรับเด็ก', 'เคลือบฟลูออไรด์', 30, '300 บาท'], ['ทันตกรรมสำหรับเด็ก', 'เคลือบหลุมร่องฟัน (Sealant)', 45, '300 บาท'], ['ทันตกรรมสำหรับเด็ก', 'รักษาโพรงประสาทฟันน้ำนม/Pulpotomy', 60, '1,000–1,400 บาท'], ['ทันตกรรมสำหรับเด็ก', 'ครอบฟันเหล็กไร้สนิม (SSC)', 60, '1,400 บาท'],
  ['งานรักษาคลองรากฟันแท้', 'รักษาคลองรากฟันหน้า', 90, '4,250–5,250 บาท'], ['งานรักษาคลองรากฟันแท้', 'รักษาคลองรากฟันกรามน้อย', 120, '6,000–7,000 บาท'], ['งานรักษาคลองรากฟันแท้', 'รักษาคลองรากฟันกราม', 150, '9,500 บาท'],
  ['งานบูรณะและฟันเทียม', 'แกนฟัน (Core)', 60, '850–1,000 บาท'], ['งานบูรณะและฟันเทียม', 'เดือยฟันและแกนฟัน (Post & Core)', 90, '2,500 บาท'], ['งานบูรณะและฟันเทียม', 'ครอบฟัน (Metal / Porcelain / Zirconia)', 90, '5,000 บาท'], ['งานบูรณะและฟันเทียม', 'ฟันเทียมอะคริลิกบางส่วน', 90, '2,500–4,000 บาท'], ['งานบูรณะและฟันเทียม', 'ฟันเทียมทั้งปาก ฐานอะคริลิก', 120, '5,500 บาท/ขากรรไกร; 11,000 บาท/บน-ล่าง'],
  ['รากฟันเทียมและเอกซเรย์', 'รากฟันเทียมมาตรฐาน (Fixture + Crown)', 120, '39,000 บาท'], ['รากฟันเทียมและเอกซเรย์', 'เอกซเรย์ในช่องปาก', 20, '150–200 บาท'], ['รากฟันเทียมและเอกซเรย์', 'Panoramic / Cephalometry', 30, '500 บาท'], ['รากฟันเทียมและเอกซเรย์', 'CT Dental scan (ขากรรไกรบนหรือล่าง)', 45, '3,500 บาท'],
] as const;

const legacyTitles = ['ตรวจสุขภาพช่องปาก', 'ขูดหินปูน', 'ถอนฟัน', 'รักษารากฟัน'];
await pool.query(`UPDATE services SET active = FALSE, category = 'รายการเดิม', deposit_amount = 400 WHERE title IN (${legacyTitles.map(() => '?').join(', ')})`, legacyTitles);
for (const [category, title, duration, priceLabel] of procedures) {
  const [existing] = await pool.query<RowDataPacket[]>('SELECT id FROM services WHERE title = ? LIMIT 1', [title]);
  if (existing[0]) await pool.query('UPDATE services SET category = ?, duration_minutes = ?, price_label = ?, deposit_amount = 400, active = TRUE WHERE id = ?', [category, duration, priceLabel, existing[0].id]);
  else await pool.query('INSERT INTO services (title, category, duration_minutes, price_label, deposit_amount) VALUES (?, ?, ?, ?, 400)', [title, category, duration, priceLabel]);
}

const dentistRoster = [
  ['ทพญ. พิมพ์ใจ สุขสันต์', 'ทพญ.', 'DEN'],
  ['ทพ. ณัฐวุฒิ ยิ้มแย้ม', 'ทพ.', 'DNT'],
  ['ทพญ.นิศา ทองนพคุณ', 'ทพญ.', 'DDS01'],
  ['ทพ.จรูญพันธ์ อธิกชัย', 'ทพ.', 'DDS02'],
  ['ทพญ.วิจิตรา ลิ้มตระกูล', 'ทพญ.', 'DDS03'],
  ['ทพญ.วทันยา แช่มช้อย', 'ทพญ.', 'DDS04'],
  ['ทพญ.ฐานิดา ปุญญฤทธิ์', 'ทพญ.', 'DDS05'],
  ['ทพ.ฉัตรชัย ปุญญฤทธิ์', 'ทพ.', 'DDS06'],
  ['ทพญ.วนิตา มากล้น', 'ทพญ.', 'DDS07'],
  ['ทพญ.อมรรัตน์ อิ่มหมี', 'ทพญ.', 'DDS08'],
  ['ทพญ.นนธกานต์ จันทร์รักษ์', 'ทพญ.', 'DDS09'],
  ['ทพญ.จิตรเรขา สัมพันธรัตน์', 'ทพญ.', 'DDS10'],
  ['ทพญ.สุวัจณา ทองสุข', 'ทพญ.', 'DDS11'],
  ['ทพญ.สุชญา อุดมพันท์', 'ทพญ.', 'DDS12'],
  ['ทพ.วิทยา แสงเหมือนขวัญ', 'ทพ.', 'DDS13'],
  ['ทพญ.วาสนา สุวรรณฤทธิ์', 'ทพญ.', 'DDS14'],
  ['ทพ.ปัญญา ขวัญวงศ์', 'ทพ.', 'DDS15'],
  ['ทพ.ปกรณ์ จิตรกฤษฎากุล', 'ทพ.', 'DDS16'],
  ['ทพ.ศุภวัฒน์ วงศ์ไพโรจน์พานิช', 'ทพ.', 'DDS17'],
  ['ทพ.พัสกร สาธกุไร', 'ทพ.', 'DDS18'],
  ['ทพญ.นดา เก่งพานิช', 'ทพญ.', 'DDS19'],
  ['ทพ.กฤต ด่านกิตติไกรลาศ', 'ทพ.', 'DDS20'],
  ['ทพญ.จิราภา วงศ์ไพโรจน์พานิช', 'ทพญ.', 'DDS21'],
  ['ทพญ.ปทุมพรรณ พรมสินชัย', 'ทพญ.', 'DDS22'],
] as const;

for (const [displayName, title, queuePrefix] of dentistRoster) {
  const [existing] = await pool.query<RowDataPacket[]>('SELECT id FROM dentists WHERE display_name = ? LIMIT 1', [displayName]);
  if (!existing[0]) {
    await pool.query(
      'INSERT INTO dentists (display_name, professional_title, queue_prefix) VALUES (?, ?, ?)',
      [displayName, title, queuePrefix],
    );
  }
}

const mockDentistServiceCategories = [
  { displayName: 'ทพญ. พิมพ์ใจ สุขสันต์', categories: ['งานทั่วไป', 'ทันตกรรมสำหรับเด็ก'] },
  { displayName: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม', categories: ['งานทั่วไป', 'งานรักษาคลองรากฟันแท้', 'งานบูรณะและฟันเทียม', 'รากฟันเทียมและเอกซเรย์'] },
] as const;

for (const assignment of mockDentistServiceCategories) {
  await pool.query(
    'DELETE ds FROM dentist_services ds JOIN dentists d ON d.id = ds.dentist_id WHERE d.display_name = ?',
    [assignment.displayName],
  );
  const categoryPlaceholders = assignment.categories.map(() => '?').join(', ');
  await pool.query(
    `INSERT IGNORE INTO dentist_services (dentist_id, service_id)
     SELECT d.id, s.id FROM dentists d JOIN services s
     WHERE d.display_name = ? AND s.active = TRUE AND s.category IN (${categoryPlaceholders})`,
    [assignment.displayName, ...assignment.categories],
  );
}

const [dentists] = await pool.query<RowDataPacket[]>('SELECT id, display_name AS displayName FROM dentists WHERE active = TRUE ORDER BY id');
for (let offset = 0; offset < 14; offset += 1) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  if (date.getDay() === 0) continue;
  const serviceDate = date.toISOString().slice(0, 10);
  for (const dentist of dentists) {
    const times = dentist.displayName === 'ทพญ. พิมพ์ใจ สุขสันต์'
      ? [['09:00:00', '09:30:00'], ['10:00:00', '10:30:00'], ['13:00:00', '13:30:00'], ['14:00:00', '14:30:00']]
      : [['09:30:00', '10:00:00'], ['11:00:00', '11:30:00'], ['13:30:00', '14:00:00'], ['15:00:00', '15:30:00']];
    for (const [start, end] of times) {
      await pool.query(
        'INSERT IGNORE INTO booking_slots (dentist_id, service_date, start_time, end_time, capacity) VALUES (?, ?, ?, ?, 1)',
        [dentist.id, serviceDate, start, end],
      );
    }
  }
}

const [staffUserCount] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM staff_users');
if (staffUserCount[0].count === 0) {
  await pool.query(
    `INSERT INTO staff_users (provider_identity, display_name, department, role, approval_status) VALUES
      (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
    [
      'PROVIDER-1001', 'นางสาวอรทัย ใจดี', 'คลินิกทันตกรรม', 'CLINIC_STAFF', 'PENDING_APPROVAL',
      'PROVIDER-1002', 'นายสมชาย มั่นคง', 'ฝ่ายบริหาร', 'MANAGER', 'APPROVED',
      'PROVIDER-1003', 'นางสาววิภา พร้อมพงษ์', 'กลุ่มงานเทคโนโลยีสารสนเทศ', 'IT_STAFF', 'APPROVED',
    ],
  );
}

console.log('Mock appointment data seeded successfully.');
await pool.end();
