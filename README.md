# สาสุข พรีเมียม Dental Clinic — ระบบจองคิวและบริหารคลินิก

เว็บแอปพลิเคชัน full-stack สำหรับคลินิกทันตกรรม ครอบคลุมทั้งเว็บไซต์สาธารณะ ระบบจองคิวออนไลน์สำหรับผู้ป่วย
และระบบหลังบ้านสำหรับเจ้าหน้าที่คลินิก — พัฒนาด้วย React + TypeScript (frontend) และ Express + TypeScript + MySQL (API)

## ฟีเจอร์หลัก

**ฝั่งผู้รับบริการ**
- เว็บไซต์สาธารณะ: หน้าแรก บริการ ทีมทันตแพทย์ เกี่ยวกับคลินิก ติดต่อ
- เวลาให้บริการบนหน้าแรก หน้า “ติดต่อเรา” และ footer อ่านจากการตั้งค่า `clinic_types` ชุดเดียวกัน
- ล็อกอินด้วยหมอพร้อม (MOPH HealthID) หรือ ThaiID (DOPA OIDC) หรือกรอกข้อมูลเองก็ได้
- จองคิวออนไลน์ ดูรายการนัดหมาย และแบบประเมินความพึงพอใจหลังเข้ารับบริการ

**ฝั่งเจ้าหน้าที่ (`/staff/*`)**
- ล็อกอินด้วย Provider ID (ระบบจะสร้างบัญชีใหม่เป็น "รอการอนุมัติ" เสมอ ต้องให้ IT Staff อนุมัติและกำหนดสิทธิ์ก่อนใช้งาน)
- บริหารคิวประจำวัน (walk-in, ยกเลิก, เช็คอิน), จัดการสล็อตเวลา, ทะเบียนทันตแพทย์และหัตถการ, ทะเบียนผู้ป่วย, ผู้ใช้งานระบบ
- นำเข้าและจัดการทะเบียนลงเวรทันตแพทย์รายเดือนจากไฟล์ Excel
- แดชบอร์ดและรายงาน (นัดหมาย, การมาตามนัด, รายได้, productivity ทันตแพทย์, แจ้งเตือน, ช่วงเวลาที่มีผู้ใช้บริการมาก)
- แจ้งเตือนผู้ป่วยผ่าน MOPH Alert (Flex Message) อัตโนมัติเมื่อยืนยัน/ยกเลิกนัดหมาย

## เทคโนโลยีที่ใช้

| ส่วน | เทคโนโลยี |
|---|---|
| Frontend | React 19, TypeScript, Vite, React Router, plain CSS (ไม่ใช้ CSS framework) |
| Backend / API | Express 5, TypeScript, native `fetch` (ไม่ใช้ axios), Zod สำหรับ validate input |
| ฐานข้อมูล | MySQL/MariaDB (ผ่าน `mysql2`) — schema สร้างจากสคริปต์ migrate โดยตรง ไม่ใช้ ORM |
| ไฟล์/เอกสาร | ExcelJS (นำเข้า/ส่งออกทะเบียนลงเวร), `multer` (อัปโหลดรูป/สลิป) |
| Auth ผู้ป่วย | HealthID (moph.id.th), ThaiID (DOPA OIDC), หรือกรอกข้อมูลเอง |
| Auth เจ้าหน้าที่ | Provider ID (ผ่าน HealthID client เดียวกัน) พร้อมระบบอนุมัติบัญชีในตัว |
| ทดสอบ | Vitest (unit + integration ทั้งสองฝั่ง), Testing Library (frontend) |

## โครงสร้างโปรเจกต์

```
api/          Express API — src/app.ts (routes ทั้งหมด), src/services/*, src/domain/*, src/scripts/{migrate,seed}.ts
frontend/     React SPA — src/pages/*, src/services/*, src/App.tsx (routing + route guard)
DEPLOY.md     คู่มือติดตั้งขึ้นเซิร์ฟเวอร์จริงผ่าน aaPanel + Nginx
PROVIDER.md   สเปกการเชื่อมต่อ ProviderID (ล็อกอินเจ้าหน้าที่)
THAID.md      สเปกการเชื่อมต่อ ThaiID (DOPA OIDC)
MOPHALERT.md  สเปกการส่งแจ้งเตือนผ่าน MOPH Alert
AGENTS.md     คู่มือฉบับละเอียดสำหรับผู้พัฒนา/AI agent ที่เข้ามาทำงานต่อในโปรเจกต์
```

## เริ่มต้นใช้งาน (Development)

### สิ่งที่ต้องมี
- Node.js 20 LTS
- MySQL หรือ MariaDB ที่รันอยู่ในเครื่อง (หรือเข้าถึงได้ผ่านเครือข่าย)

### ติดตั้ง

```bash
git clone https://github.com/nooknexus/dental-appoint.git
cd dental-appoint

cd api && npm install
cp .env.example .env   # แก้ DB_USER/DB_PASSWORD ให้ตรงกับ MySQL ในเครื่อง
npm run db:migrate     # สร้างฐานข้อมูลและตารางทั้งหมด
npm run db:seed        # ใส่รายการหัตถการและทันตแพทย์เริ่มต้น
npm run dev            # รัน API ที่ http://localhost:3001
```

เปิดอีกเทอร์มินัลสำหรับ frontend:

```bash
cd frontend && npm install
npm run dev             # รันที่ http://localhost:3000 (proxy /api ไปที่ API พอร์ต 3001 อัตโนมัติ)
```

ค่าเริ่มต้นใน `.env.example` เปิด `AUTH_MODE=mock` — เข้าหน้า `/staff/role-select` เพื่อเลือกบทบาททดสอบได้โดยไม่ต้องเชื่อมต่อ ProviderID จริง
ดูรายละเอียดตัวแปร environment ทั้งหมดและวิธีเปิดใช้ SSO จริงแต่ละตัวใน [DEPLOY.md](DEPLOY.md)

### ทดสอบ

```bash
cd api && npm test        # unit + integration test (ต้องมี MySQL ที่เชื่อมต่อได้ตาม .env)
cd frontend && npm test   # unit/component test
```

## Deploy ขึ้นเซิร์ฟเวอร์จริง

ดูคู่มือละเอียดใน [DEPLOY.md](DEPLOY.md) — ครอบคลุมการติดตั้งผ่าน aaPanel, ตั้งค่า Nginx reverse proxy, เปิด HTTPS,
และขั้นตอน bootstrap บัญชี IT Staff คนแรกก่อนเปิดใช้ Provider ID SSO จริง

## เอกสารที่เกี่ยวข้อง

| เอกสาร | เนื้อหา |
|---|---|
| [AGENTS.md](AGENTS.md) | ภาพรวมโค้ด สถาปัตยกรรม และรายละเอียดเชิงลึกสำหรับผู้พัฒนา |
| [DEPLOY.md](DEPLOY.md) | ขั้นตอนติดตั้งขึ้น production ผ่าน aaPanel + Nginx |
| [PROVIDER.md](PROVIDER.md) | สเปก ProviderID API (ล็อกอินเจ้าหน้าที่) |
| [THAID.md](THAID.md) | สเปก ThaiID OIDC (ล็อกอินผู้ป่วย) |
| [MOPHALERT.md](MOPHALERT.md) | สเปกการส่ง Flex Message แจ้งเตือนผ่าน MOPH Alert |
| [GOOGLEHOLIDAY.md](GOOGLEHOLIDAY.md) | การดึงวันหยุดนักขัตฤกษ์จาก Google Calendar สำหรับตารางลงเวร |
