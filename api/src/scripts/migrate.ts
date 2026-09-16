import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

import { config } from '../config.js';
import { pool } from '../db.js';

// MariaDB รองรับ `ADD COLUMN IF NOT EXISTS` / `DROP INDEX IF EXISTS` แต่ MySQL แท้ (Oracle MySQL) ไม่รองรับ
// เช็คผ่าน information_schema ก่อนเองแทน เพื่อให้ migrate รันได้ทั้งสองเอนจิน
async function columnExists(table: string, column: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [table, column],
  );
  return rows.length > 0;
}
async function addColumnIfMissing(table: string, column: string, columnDdl: string) {
  if (!(await columnExists(table, column))) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${columnDdl}`);
}
async function indexExists(table: string, indexName: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
    [table, indexName],
  );
  return rows.length > 0;
}
async function addUniqueIndexIfMissing(table: string, indexName: string, columns: string) {
  if (!(await indexExists(table, indexName))) await pool.query(`ALTER TABLE ${table} ADD UNIQUE INDEX ${indexName} (${columns})`);
}
async function dropIndexIfExists(table: string, indexName: string) {
  if (await indexExists(table, indexName)) await pool.query(`ALTER TABLE ${table} DROP INDEX ${indexName}`);
}

const bootstrap = await mysql.createConnection({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
});

await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${config.database.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await bootstrap.end();

await pool.query(`
  CREATE TABLE IF NOT EXISTS services (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(120) NOT NULL,
    category VARCHAR(120) NOT NULL DEFAULT 'งานทั่วไป',
    duration_minutes INT NOT NULL,
    price_label VARCHAR(100) NOT NULL DEFAULT 'โปรดสอบถามเจ้าหน้าที่',
    deposit_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
await addColumnIfMissing('services', 'category', "category VARCHAR(120) NOT NULL DEFAULT 'งานทั่วไป' AFTER title");
await addColumnIfMissing('services', 'price_label', "price_label VARCHAR(100) NOT NULL DEFAULT 'โปรดสอบถามเจ้าหน้าที่' AFTER duration_minutes");
await pool.query('ALTER TABLE services MODIFY deposit_amount DECIMAL(10, 2) NOT NULL DEFAULT 400');
await pool.query('UPDATE services SET deposit_amount = 400');
await pool.query(`
  CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(80) PRIMARY KEY,
    boolean_value BOOLEAN NOT NULL,
    text_value TEXT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`);
await addColumnIfMissing('system_settings', 'text_value', 'text_value TEXT NULL AFTER boolean_value');
await pool.query('ALTER TABLE system_settings MODIFY text_value TEXT NULL');
await pool.query("INSERT IGNORE INTO system_settings (setting_key, boolean_value) VALUES ('reservation_payment_enabled', TRUE)");
await pool.query("INSERT IGNORE INTO system_settings (setting_key, boolean_value, text_value) VALUES ('booking_flow', TRUE, 'PROCEDURE_AND_DENTIST')");
await pool.query("INSERT IGNORE INTO system_settings (setting_key, boolean_value, text_value) VALUES ('clinic_types', TRUE, 'PMC,SMC')");
await pool.query("INSERT IGNORE INTO system_settings (setting_key, boolean_value) VALUES ('moph_alert_enabled', FALSE)");
await pool.query("INSERT IGNORE INTO system_settings (setting_key, boolean_value) VALUES ('moph_alert_client_key', FALSE)");
await pool.query("INSERT IGNORE INTO system_settings (setting_key, boolean_value) VALUES ('moph_alert_secret_key', FALSE)");
await pool.query(`CREATE TABLE IF NOT EXISTS patient_registry (
  patient_identity VARCHAR(100) PRIMARY KEY, patient_display_name VARCHAR(160) NOT NULL,
  access_status ENUM('ACTIVE', 'BLOCKED') NOT NULL DEFAULT 'ACTIVE', updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS dentists (
    id INT PRIMARY KEY AUTO_INCREMENT,
    display_name VARCHAR(160) NOT NULL,
    professional_title VARCHAR(10) NOT NULL DEFAULT 'ทพ.',
    specialty VARCHAR(255) NOT NULL DEFAULT 'ทันตกรรมทั่วไป',
    queue_prefix VARCHAR(12) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE KEY dentists_queue_prefix_unique (queue_prefix)
  )
`);
await addColumnIfMissing('dentists', 'portrait_file_name', 'portrait_file_name VARCHAR(255) NULL AFTER queue_prefix');
await addColumnIfMissing('dentists', 'professional_title', "professional_title VARCHAR(10) NOT NULL DEFAULT 'ทพ.' AFTER display_name");
await addColumnIfMissing('dentists', 'specialty', "specialty VARCHAR(255) NOT NULL DEFAULT 'ทันตกรรมทั่วไป' AFTER professional_title");
await pool.query("UPDATE dentists SET professional_title = CASE WHEN display_name LIKE 'ทพญ.%' THEN 'ทพญ.' ELSE 'ทพ.' END");
await pool.query(`
  CREATE TABLE IF NOT EXISTS dentist_services (
    dentist_id INT NOT NULL,
    service_id INT NOT NULL,
    PRIMARY KEY (dentist_id, service_id),
    CONSTRAINT dentist_services_dentist_fk FOREIGN KEY (dentist_id) REFERENCES dentists(id),
    CONSTRAINT dentist_services_service_fk FOREIGN KEY (service_id) REFERENCES services(id)
  )
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS booking_slots (
    id INT PRIMARY KEY AUTO_INCREMENT,
    dentist_id INT NOT NULL,
    service_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    capacity INT NOT NULL DEFAULT 1,
    booked_count INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE KEY booking_slots_unique (dentist_id, service_date, start_time),
    CONSTRAINT booking_slots_dentist_fk FOREIGN KEY (dentist_id) REFERENCES dentists(id)
  )
`);
await pool.query('ALTER TABLE booking_slots MODIFY dentist_id INT NULL');
await pool.query(`
  CREATE TABLE IF NOT EXISTS queue_counters (
    service_date DATE NOT NULL,
    queue_prefix VARCHAR(12) NOT NULL,
    next_sequence INT NOT NULL,
    PRIMARY KEY (service_date, queue_prefix)
  )
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS appointments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    reference_code VARCHAR(40) NOT NULL UNIQUE,
    queue_number VARCHAR(24) NOT NULL,
    service_id INT NULL,
    dentist_id INT NOT NULL,
    slot_id INT NOT NULL,
    patient_identity VARCHAR(100) NOT NULL,
    patient_display_name VARCHAR(160) NOT NULL,
    patient_phone VARCHAR(32) NOT NULL,
    notes TEXT NULL,
    appointment_status ENUM('PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED') NOT NULL,
    payment_status ENUM('AWAITING_PAYMENT', 'SLIP_UPLOADED', 'VERIFIED', 'REJECTED') NOT NULL,
    payment_amount DECIMAL(10, 2) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY appointments_queue_date_unique (queue_number, slot_id),
    CONSTRAINT appointments_service_fk FOREIGN KEY (service_id) REFERENCES services(id),
    CONSTRAINT appointments_dentist_fk FOREIGN KEY (dentist_id) REFERENCES dentists(id),
    CONSTRAINT appointments_slot_fk FOREIGN KEY (slot_id) REFERENCES booking_slots(id)
  )
`);
await pool.query('ALTER TABLE appointments MODIFY service_id INT NULL');
await pool.query('ALTER TABLE appointments MODIFY dentist_id INT NULL');
await pool.query(`CREATE TABLE IF NOT EXISTS patient_visit_registry (
  id INT PRIMARY KEY AUTO_INCREMENT, appointment_id INT NOT NULL UNIQUE, patient_identity VARCHAR(100) NOT NULL,
  visit_status ENUM('BOOKED', 'SERVED', 'NO_SHOW') NOT NULL DEFAULT 'BOOKED', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT patient_visit_appointment_fk FOREIGN KEY (appointment_id) REFERENCES appointments(id),
  CONSTRAINT patient_visit_patient_fk FOREIGN KEY (patient_identity) REFERENCES patient_registry(patient_identity)
)`);
await pool.query(`CREATE TABLE IF NOT EXISTS patient_sessions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  session_id_hash CHAR(64) NOT NULL UNIQUE,
  patient_identity VARCHAR(100) NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  ial DECIMAL(3, 1) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  INDEX patient_sessions_expiry_idx (expires_at)
)`);
// บอกว่า session นี้มาจาก provider ไหน ('moph' | 'thaid' | 'manual')
await addColumnIfMissing('patient_sessions', 'provider', "provider VARCHAR(20) NOT NULL DEFAULT 'moph'");
await pool.query(`
  CREATE TABLE IF NOT EXISTS payment_slips (
    id INT PRIMARY KEY AUTO_INCREMENT,
    appointment_id INT NOT NULL UNIQUE,
    file_name VARCHAR(255) NOT NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by VARCHAR(100) NULL,
    reviewed_at DATETIME NULL,
    rejection_reason VARCHAR(255) NULL,
    CONSTRAINT payment_slips_appointment_fk FOREIGN KEY (appointment_id) REFERENCES appointments(id)
  )
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS satisfaction_surveys (
    id INT PRIMARY KEY AUTO_INCREMENT,
    appointment_id INT NOT NULL UNIQUE,
    patient_identity VARCHAR(100) NOT NULL,
    dentist_id INT NULL,
    cleanliness_rating TINYINT NOT NULL,
    staff_rating TINYINT NOT NULL,
    dentist_rating TINYINT NULL,
    wait_time_rating TINYINT NOT NULL,
    overall_rating TINYINT NOT NULL,
    comment VARCHAR(1000) NULL,
    submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT satisfaction_surveys_appointment_fk FOREIGN KEY (appointment_id) REFERENCES appointments(id),
    CONSTRAINT satisfaction_surveys_patient_fk FOREIGN KEY (patient_identity) REFERENCES patient_registry(patient_identity),
    CONSTRAINT satisfaction_surveys_dentist_fk FOREIGN KEY (dentist_id) REFERENCES dentists(id)
  )
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS appointment_status_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    appointment_id INT NOT NULL,
    appointment_status VARCHAR(40) NOT NULL,
    payment_status VARCHAR(40) NOT NULL,
    actor VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT appointment_status_history_appointment_fk FOREIGN KEY (appointment_id) REFERENCES appointments(id)
  )
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS staff_users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    provider_identity VARCHAR(100) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    department VARCHAR(160) NOT NULL,
    role ENUM('IT_STAFF', 'CLINIC_STAFF', 'MANAGER') NOT NULL DEFAULT 'CLINIC_STAFF',
    approval_status ENUM('PENDING_APPROVAL', 'APPROVED', 'DISABLED') NOT NULL DEFAULT 'PENDING_APPROVAL',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY staff_users_identity_unique (provider_identity)
  )
`);
await addColumnIfMissing('staff_users', 'provider_hash_cid', 'provider_hash_cid VARCHAR(255) NULL AFTER provider_identity');
await addColumnIfMissing('staff_users', 'provider_title', 'provider_title VARCHAR(80) NULL AFTER display_name');
await addColumnIfMissing('staff_users', 'provider_email', 'provider_email VARCHAR(255) NULL AFTER provider_title');
await addColumnIfMissing('staff_users', 'provider_hcode', 'provider_hcode VARCHAR(20) NULL AFTER department');
await pool.query("ALTER TABLE staff_users MODIFY approval_status ENUM('PENDING_APPROVAL', 'APPROVED', 'DISABLED') NOT NULL DEFAULT 'PENDING_APPROVAL'");
await pool.query(`CREATE TABLE IF NOT EXISTS staff_sessions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  session_id_hash CHAR(64) NOT NULL UNIQUE,
  staff_user_id INT NOT NULL,
  csrf_token_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  INDEX staff_sessions_expiry_idx (expires_at),
  INDEX staff_sessions_user_idx (staff_user_id),
  CONSTRAINT staff_sessions_user_fk FOREIGN KEY (staff_user_id) REFERENCES staff_users(id) ON DELETE CASCADE
)`);
await pool.query(`CREATE TABLE IF NOT EXISTS staff_oauth_attempts (
  state_hash CHAR(64) PRIMARY KEY,
  auth_flow ENUM('staff') NOT NULL DEFAULT 'staff',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  INDEX staff_oauth_attempts_expiry_idx (expires_at)
)`);
await pool.query("ALTER TABLE appointments MODIFY payment_status ENUM('AWAITING_PAYMENT', 'SLIP_UPLOADED', 'VERIFIED', 'REJECTED', 'NOT_REQUIRED') NOT NULL");
await pool.query(`CREATE TABLE IF NOT EXISTS notification_deliveries (
  id INT PRIMARY KEY AUTO_INCREMENT,
  appointment_id INT NOT NULL,
  recipient_masked VARCHAR(32) NOT NULL,
  delivery_status ENUM('PENDING', 'SENDING', 'SENT', 'FAILED', 'INVALID_RECIPIENT') NOT NULL DEFAULT 'PENDING',
  attempt_count INT NOT NULL DEFAULT 0,
  last_attempt_at DATETIME NULL,
  sent_at DATETIME NULL,
  response_status INT NULL,
  error_message VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY notification_deliveries_appointment_unique (appointment_id),
  CONSTRAINT notification_deliveries_appointment_fk FOREIGN KEY (appointment_id) REFERENCES appointments(id)
)`);
// แจ้งเตือนยกเลิกนัดผ่าน MOPH Alert แยกประเภทจากยืนยันนัด — นัดหมายเดียวมีได้ทั้งสองประเภท จึงเปลี่ยน unique key เป็นคู่
await addColumnIfMissing('notification_deliveries', 'notification_type', "notification_type ENUM('CONFIRMATION', 'CANCELLATION') NOT NULL DEFAULT 'CONFIRMATION' AFTER appointment_id");
await addColumnIfMissing('notification_deliveries', 'cancel_reason', 'cancel_reason VARCHAR(500) NULL AFTER error_message');
// ต้องสร้าง unique key ใหม่ก่อนลบตัวเก่า เพราะ FK ของ appointment_id ต้องมี index รองรับอยู่เสมอ
await addUniqueIndexIfMissing('notification_deliveries', 'notification_deliveries_appointment_type_unique', 'appointment_id, notification_type');
await dropIndexIfExists('notification_deliveries', 'notification_deliveries_appointment_unique');

await pool.query(`CREATE TABLE IF NOT EXISTS duty_rosters (
  id INT PRIMARY KEY AUTO_INCREMENT,
  duty_month CHAR(7) NOT NULL,
  roster_title VARCHAR(255) NOT NULL DEFAULT '',
  source_file_name VARCHAR(255) NULL,
  uploaded_by VARCHAR(100) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY duty_rosters_month_unique (duty_month)
)`);
await pool.query(`CREATE TABLE IF NOT EXISTS duty_roster_members (
  id INT PRIMARY KEY AUTO_INCREMENT,
  roster_id INT NOT NULL,
  sequence_no INT NULL,
  source_name VARCHAR(160) NOT NULL,
  dentist_id INT NULL,
  CONSTRAINT duty_roster_members_roster_fk FOREIGN KEY (roster_id) REFERENCES duty_rosters(id) ON DELETE CASCADE,
  CONSTRAINT duty_roster_members_dentist_fk FOREIGN KEY (dentist_id) REFERENCES dentists(id)
)`);
await pool.query(`CREATE TABLE IF NOT EXISTS duty_roster_days (
  id INT PRIMARY KEY AUTO_INCREMENT,
  member_id INT NOT NULL,
  duty_date DATE NOT NULL,
  duty_mark VARCHAR(16) NOT NULL DEFAULT '/',
  UNIQUE KEY duty_roster_days_unique (member_id, duty_date),
  CONSTRAINT duty_roster_days_member_fk FOREIGN KEY (member_id) REFERENCES duty_roster_members(id) ON DELETE CASCADE
)`);

console.log(`Database ${config.database.database} migrated successfully.`);
await pool.end();
