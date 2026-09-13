# Project Guide for AI Agents

> เอกสารนี้เป็นจุดเริ่มต้นสำหรับ AI agent หรือผู้พัฒนาที่เข้ามาทำงานต่อในโปรเจกต์
> ตรวจสอบจาก source code ปัจจุบันเมื่อ 11 กันยายน 2026 และให้ถือว่า source code,
> `package.json`, `.env.example` และ test เป็น source of truth หากข้อมูลขัดกับเอกสารเก่า

## 1. สรุปโปรเจกต์

โปรเจกต์นี้คือเว็บไซต์และระบบจองคิวของ **สาสุข พรีเมียม Dental Clinic** ประกอบด้วย:

- เว็บไซต์สาธารณะ: หน้าแรก บริการ ทีม เกี่ยวกับคลินิก และติดต่อ
- ฝั่งผู้รับบริการ: login ด้วยหมอพร้อม (HealthID) หรือกรอกข้อมูลเอง, เมนูผู้ป่วย, จองคิว, ดูรายการนัด และแบบประเมิน
- ฝั่งเจ้าหน้าที่: จัดการคิว สล็อต หัตถการ ทันตแพทย์ ผู้ใช้ ผู้ป่วย และค่าระบบ
- API: Express + TypeScript เชื่อม MySQL
- ระบบชำระเงิน: QR และการตรวจสลิปแบบ mock
- ระบบแจ้งเตือน: เชื่อม MOPH Alert v3.1 หลังเจ้าหน้าที่ยืนยันนัด

ระบบปัจจุบันเป็น prototype/demo ที่มี backend จริงและฐานข้อมูลจริง — ล็อกอินผู้ป่วยด้วยหมอพร้อม
(HealthID) และฟอร์มกรอกเองใช้งานได้จริง แต่ **staff authentication**, payment และบาง integration
ยังไม่พร้อมใช้ production (ดูหัวข้อ 8 และ 15)

## 2. Source of truth และเอกสารเดิม

ใช้ลำดับความน่าเชื่อถือต่อไปนี้:

1. `api/src/**`, `frontend/src/**`
2. test ใน `api/src/**/*.test.ts` และ `frontend/src/__tests__/**`
3. `api/package.json`, `frontend/package.json`, `api/.env.example`, `frontend/.env.example`
4. เอกสาร Markdown อื่น

ข้อควรระวังเกี่ยวกับเอกสารเดิม:

- `architecture.md` และ `summary.md` ล้าสมัยบางส่วน: ระบบจริงใช้ **MySQL** ไม่ใช่ SQLite,
  API ไม่ได้ serve frontend static files และ frontend ปัจจุบันไม่ได้ใช้ Tailwind/Recharts
- `PROVIDER.md` และ `THAID.md` เป็นเอกสารอ้างอิง integration จากบริบทอื่น
  ยังไม่ได้ implement flow จริงใน codebase นี้
- `MOPHALERT.md` เป็นแนวทางประกอบ ส่วน implementation จริงอยู่ที่
  `api/src/services/mophAlert.ts` และ `api/src/app.ts`
- `GOOGLEHOLIDAY.md` เป็นสเปกการต่อ Google Calendar ICS ส่วน implementation ในโปรเจกต์นี้อยู่ที่
  `api/src/services/thaiHolidays.ts` (ต่างจากเอกสารตรงที่ใช้ปฏิทินไทยเป็นตัวหลักเพื่อให้ได้ชื่อวันหยุดภาษาไทย)
- `PLAN-service-price-only.md` เป็นแผนเก่า บางงานถูกทำแล้วและบางงานอาจยังไม่ครบ
- `dist/`, `frontend/dist/` และ `api/dist/` เป็น generated output ไม่ใช่ไฟล์ต้นฉบับ

## 3. โครงสร้าง repository

```text
clinic-dental-spa/
├── AGENTS.md                       # เอกสารนี้
├── api/
│   ├── src/
│   │   ├── app.ts                  # Express app และ API routes ทั้งหมด
│   │   ├── server.ts               # เปิด server และ scheduler MOPH Alert
│   │   ├── config.ts               # อ่าน environment variables
│   │   ├── db.ts                   # MySQL connection pool
│   │   ├── domain/booking.ts       # pure booking/queue state logic
│   │   ├── domain/dutyRoster.ts    # pure parser ตารางเวรจาก Excel grid
│   │   ├── services/mophAlert.ts   # encryption, payload และ HTTP client
│   │   ├── services/dutyRosterExcel.ts # อ่าน/สร้าง .xlsx ด้วย ExcelJS
│   │   ├── services/thaiHolidays.ts # วันหยุดนักขัตฤกษ์จาก Google Calendar ICS
│   │   └── scripts/
│   │       ├── migrate.ts           # สร้าง/ปรับ schema
│   │       └── seed.ts              # ข้อมูลตัวอย่างและสล็อต 14 วัน
│   ├── uploads/                     # รูปทันตแพทย์และสลิปที่ upload แล้ว
│   ├── dist/                        # TypeScript build output
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx                 # route map และ layout routing
│   │   ├── pages/                  # page-level UI
│   │   ├── components/             # shared UI/layout
│   │   ├── services/               # frontend API/store helpers
│   │   ├── data/                   # static clinic/service/team content
│   │   ├── styles/global.css       # styling ทั้งระบบ
│   │   └── __tests__/app.test.tsx  # frontend behavior tests
│   ├── dist/                        # Vite build output
│   ├── .env.example
│   └── package.json
├── dist/                            # สำเนา frontend build อีกชุดที่ root
└── *.md                             # เอกสารประกอบ/แผนเดิม
```

ไม่มี root `package.json`, Docker Compose หรือคำสั่งเดียวสำหรับเปิดทั้งระบบ
ต้องทำงานใน `api/` และ `frontend/` แยกกัน

## 4. Technology stack

### Frontend

- React + React DOM
- TypeScript แบบ strict
- Vite, port เริ่มต้น `3000`
- React Router DOM
- Lucide React icons
- CSS ปกติใน `frontend/src/styles/global.css`
- Vitest + Testing Library + jsdom
- ไม่ใช้ global state library; หลายหน้าใช้ module-level store ร่วมกับ `useSyncExternalStore`
- แจ้งเตือนผลการทำงานของหน้า staff ทุกหน้าใช้ toast มุมขวาล่าง (`components/Toast.tsx`, hook `useToast()`)
  แทนแถบข้อความบนหัวหน้าแบบเดิม (`.booking-message`) — เขียว/`role="status"` สำหรับสำเร็จ,
  แดง/`role="alert"` สำหรับผิดพลาด ปิดเองใน 6 วินาทีหรือกดปิดเองได้ หน้าใหม่ที่ต้องแจ้งผลการทำงาน
  ให้ใช้ `const { toast, notify, dismissToast } = useToast();` แล้ววาง `<Toast toast={toast} onDismiss={dismissToast} />`
  ไว้ท้าย JSX ที่คืนค่า อย่าใช้ `<p className="booking-message">` หรือให้ข้อความ error แทนที่เนื้อหาหลักของหน้า

### Backend

- Node.js + TypeScript/ES modules
- Express 5
- MySQL ผ่าน `mysql2/promise`
- Zod สำหรับ request validation
- Multer สำหรับรับรูปและสลิป (memory storage สำหรับไฟล์ตารางเวร)
- ExcelJS สำหรับอ่านและสร้างไฟล์ตารางเวร `.xlsx`
- Google Calendar ICS สาธารณะสำหรับวันหยุดนักขัตฤกษ์ (ไม่ใช้ API key ดู `GOOGLEHOLIDAY.md`)
- `qrcode` สำหรับ mock payment QR
- Vitest + Supertest

## 5. วิธีติดตั้งและรัน local

ต้องมี Node.js ที่รองรับ ES2022 และ MySQL ที่เข้าถึงได้ก่อน

### Backend

```bash
cd api
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

API เปิดที่ `http://localhost:3001` ตามค่าเริ่มต้น

### Frontend

เปิดอีก terminal:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Frontend เปิดที่ `http://localhost:3000`

### Environment variables

Backend (`api/.env`):

| Variable | Default/example | หน้าที่ |
|---|---|---|
| `API_PORT` | `3001` | port ของ Express |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | CORS origin ที่อนุญาต |
| `DB_HOST` | `localhost` | MySQL host |
| `DB_PORT` | `3306` | MySQL port |
| `DB_NAME` | `clinic_appoint_db` | database name |
| `DB_USER` | `root` | database user |
| `DB_PASSWORD` | `root` | database password |
| `AUTH_MODE` | `mock` | ปัจจุบัน staff API รองรับเฉพาะ `mock` |
| `PATIENT_SSO_ENABLED` | `false` | เปิดล็อกอินผู้ป่วยด้วยหมอพร้อม (HealthID OAuth2) — ต้องกรอกค่าด้านล่างให้ครบ |
| `MOPH_CLIENT_ID` / `MOPH_CLIENT_SECRET` | — | credentials จากการลงทะเบียน moph.id.th |
| `MOPH_REDIRECT_URI` | — | callback ที่ลงทะเบียนไว้ ต้องตรง byte-to-byte (HTTPS) เช่น `https://domain/api/auth/patient/moph/callback` |
| `MOPH_LOGIN_SCOPE` | `ProviderID` | ค่า scope ตามที่ลงทะเบียน — ยืนยันกับหน้าลงทะเบียน/ซัพพอร์ตก่อนใช้จริง |
| `MIN_PATIENT_IAL` | `1.3` | ระดับ IAL ขั้นต่ำที่ยอมให้ล็อกอิน (1.3 = Dipchip) |
| `PATIENT_SESSION_HOURS` | `12` | อายุ session ผู้ป่วย (ชั่วโมง) |
| `COOKIE_SECURE` | `false` | ตั้ง `true` เมื่อ serve ผ่าน HTTPS จริง เพื่อใส่แฟล็ก Secure ให้ cookie |
| `THAID_SSO_ENABLED` | `false` | เปิดล็อกอินผู้ป่วยด้วย ThaiID (DOPA OIDC) — session กลางเดียวกับหมอพร้อม |
| `THAID_WELL_KNOWN_URL` | `https://imauth.bora.dopa.go.th/.well-known/openid-configuration` | OIDC discovery ของ ThaiID (path นี้**ไม่มี** /api/v2 นำหน้า — ตรวจกับ DOPA จริง 2026-09-12, ต่างจาก THAID.md ที่ระบุผิด) |
| `THAID_CLIENT_ID` / `THAID_CLIENT_SECRET` | — | credentials จากการลงทะเบียน ThaiID (DOPA) |
| `THAID_REDIRECT_URI` | — | callback ที่ลงทะเบียนไว้ เช่น `https://domain/api/auth/patient/thaid/callback` |
| `THAID_SCOPE` | `pid openid name name_en birthdate address` | scope ที่ขอจาก ThaiID |
| `MOPH_ALERT_ENCRYPTION_KEY` | ไม่มีค่าปลอดภัยโดย default | encrypt client/secret key ที่เก็บใน DB |

`SESSION_SECRET` มีในตัวอย่างแต่ code ปัจจุบันยังไม่ได้ใช้งาน

Frontend (`frontend/.env`):

| Variable | Default/example | หน้าที่ |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:3001/api` | base URL ของ API |

ห้ามบันทึกค่าจริงจาก `api/.env`, credential, CID หรือข้อมูลผู้ป่วยลง source control,
log, test fixture หรือเอกสาร

## 6. Architecture และ data flow

```text
Browser / React SPA (:3000)
          |
          | JSON, multipart/form-data
          v
Express API (:3001) -----> MySQL (clinic_appoint_db)
          |
          +-----> api/uploads/ (portrait และ payment slip)
          |
          +-----> MOPH Alert v3.1 (เมื่อเปิดใช้งานและยืนยันนัด)
```

Frontend และ backend deploy แยกกันใน code ปัจจุบัน Express ไม่ได้ serve `dist/`
หาก deploy production ต้องมี static hosting/reverse proxy และกำหนด CORS/API URL ให้ตรงกัน

## 7. Frontend routes

Route map หลักอยู่ใน `frontend/src/App.tsx`

### Public และ patient

| Route | Page | หน้าที่ |
|---|---|---|
| `/` | `HomePage` | หน้าแรกและข้อมูลคลินิก |
| `/services` | `ServicesPage` | รายการบริการ active จาก API |
| `/services/:id` | `ServiceDetailPage` | รายละเอียด static service เดิม |
| `/team` | `TeamPage` | ทีม static + ทันตแพทย์จาก API |
| `/about` | `AboutPage` | ข้อมูลคลินิก |
| `/contact` | `ContactPage` | ติดต่อและแผนที่ |
| `/appointment` | `AppointmentPage` | login ผู้ป่วย: หมอพร้อม (MOPH HealthID OAuth2), ThaiD (DOPA OIDC), ฟอร์มกรอกเอง — ทั้ง 3 ทางเป็นของจริงแล้ว (ดูหัวข้อ 8) |
| `/patient/menu` | `PatientMenuPage` | เมนูผู้รับบริการ |
| `/booking/service` | `BookingPage` | booking wizard |
| `/patient/appointments` | `PatientAppointmentsPage` | นัดของ identity ใน session |
| `/patient/satisfaction` | `SatisfactionPage` | แบบประเมินความพึงพอใจ เฉพาะนัดหมายที่ `visit_status = SERVED` (มาตามนัดแล้ว) — ประเมินได้ครั้งเดียวต่อนัดหมาย |

### Staff

| Route | Role ที่ UI ตั้งใจให้ใช้ | หน้าที่ |
|---|---|---|
| `/staff/role-select` | ทุก role แบบ mock | เลือกบทบาท |
| `/staff/queue` | `CLINIC_STAFF` | ปฏิบัติงานประจำวัน: เพิ่มคิว walk-in, ยกเลิกคิว, ดูผู้จองต่อสล็อต, มาร์คมาตามนัด |
| `/staff/appointments` | `CLINIC_STAFF` | ตรวจสลิป/ยืนยันคิว |
| `/staff/slots` | `CLINIC_STAFF` | สร้างสล็อต 30 นาที |
| `/staff/services` | `IT_STAFF` | เปิด/ปิดหัตถการ |
| `/staff/system-settings` | `IT_STAFF` | payment, booking flow, MOPH Alert |
| `/staff/users` | `IT_STAFF` | role และสถานะ staff |
| `/staff/dentists` | `IT_STAFF`, `CLINIC_STAFF` | ทะเบียนทันตแพทย์/รูป/หัตถการ |
| `/staff/duty-roster` | `IT_STAFF`, `CLINIC_STAFF` | ทะเบียนลงเวร: อัปโหลด Excel, ดูตารางรายเดือน และลิงก์ไปตารางแพทย์วังทองบน Google Sheets |
| `/staff/patient-registry` | `IT_STAFF`, `CLINIC_STAFF` | ค้นหาและ block ผู้ป่วย |
| `/staff/dashboard` | `MANAGER` | ภาพรวมการจอง: สรุปยอด, นัดหมายวันนี้, แนวโน้ม 7 วัน, หัตถการยอดนิยม, ตารางเวรสัปดาห์นี้ |
| `/staff/reports/appointments` | `IT_STAFF`, `MANAGER` | รายงาน/ค้นหานัดหมายทั้งหมดแบบ read-only: กรองช่วงวันที่, ทันตแพทย์, สถานะ และคำค้น (ชื่อ/เบอร์/เลขคิว/รหัสอ้างอิง) |
| `/staff/reports/visits` | `IT_STAFF`, `MANAGER` | รายงานการเข้าพบ/No-show: สรุปรวม, แยกรายเดือน และแยกตามทันตแพทย์ (ไม่รวมนัดที่ยกเลิก) |
| `/staff/reports/revenue` | `IT_STAFF`, `MANAGER` | รายงานค่าจองคิว: แยกตามเดือน/หัตถการ/สถานะการชำระ พร้อมปุ่มส่งออก CSV (สร้างไฟล์ฝั่ง browser) |
| `/staff/reports/dentist-productivity` | `IT_STAFF`, `MANAGER` | จำนวนนัดต่อทันตแพทย์เทียบวันลงเวรจากทะเบียนลงเวร (ยังไม่รวมคิวกลาง) |
| `/staff/reports/notifications` | `IT_STAFF`, `MANAGER` | ภาพรวม MOPH Alert แบบอ่านอย่างเดียว: อัตราส่งสำเร็จ + รายการล่าสุด 20 รายการ |
| `/staff/reports/peak-hours` | `IT_STAFF`, `MANAGER` | ช่วงเวลานิยม: นัดแยกตามวันสัปดาห์/ชั่วโมง + heatmap วัน × ชั่วโมง |

Frontend ใช้ `sessionStorage` keys ต่อไปนี้:

- `clinic_mock_role`
- `clinic_mock_patient`
- `clinic_mock_patient_citizen_id`

สิ่งนี้เป็นเพียง UI session ไม่ใช่ security boundary

## 8. Authentication และ authorization ปัจจุบัน

- ผู้ป่วย **เปิดล็อกอินจริงด้วยหมอพร้อม (MOPH HealthID) ได้** เมื่อตั้ง `PATIENT_SSO_ENABLED=true`
  (implementation: `api/src/services/mophHealthId.ts` + `api/src/services/patientSession.ts` + routes
  `/api/auth/*` ใน `app.ts`) — OAuth2 authorization-code กับ moph.id.th, ตรวจ nonce cookie + state,
  gate IAL ขั้นต่ำ (`MIN_PATIENT_IAL` default 1.3), session เก็บใน table `patient_sessions`
  (เก็บ sha256 ของ cookie id) ส่ง cookie `clinic_patient_session` แบบ HttpOnly เท่านั้น ไม่เก็บ/ไม่ส่ง
  token หรือเลขบัตรกลับไปยัง browser — เมื่อมี session, `POST /api/appointments` และ
  `GET /api/patient/appointments` ใช้ identity จาก session **เขียนทับ** ค่าที่ browser ส่งมา
  (`POST /api/dev-auth/patient` ถูกลบทิ้งแล้ว ไม่มี mock login ฝั่งผู้ป่วยเหลืออยู่)
- ผู้ป่วยมี 3 ทางเข้า: **ปุ่มหมอพร้อม** (flow จริงเมื่อเปิด flag ตามด้านบน), **ปุ่ม ThaiD** (flow จริง
  OIDC กับ DOPA เมื่อเปิด `THAID_SSO_ENABLED=true` — implementation: `api/src/services/thaidAuth.ts`,
  discovery จาก `THAID_WELL_KNOWN_URL` มี cache 1 ชม. (well-known ที่ใช้ได้จริงคือ
  `https://imauth.bora.dopa.go.th/.well-known/openid-configuration` — path `/api/v2/.well-known/...`
  ใน THAID.md ตอบ 404), `pid` 13 หลักจาก id_token/userinfo ใช้เป็น identity
  โดยไม่มี IAL gate, state cookie `thaid_state` ตรวจแบบบังคับต่างจาก moph) และ **ฟอร์มกรอกเอง** (ชื่อ-สกุล +
  เลขบัตร 13 หลัก — **ใช้งานได้จริงทุกโหมด** และ **ออก session จริงผ่าน `POST /api/auth/patient/manual`
  เหมือน SSO** (`provider = 'manual'`, เช็ค `access_status = 'BLOCKED'` ก่อนออก session, ไม่เก็บเลขบัตร
  ไว้ใน browser เลย) ต่างจาก SSO ตรงที่ identity ยังเป็น self-declared คือผู้กรอกประกาศเอง
  ระบบไม่ได้พิสูจน์กับผู้ให้บริการว่าเป็นเจ้าของบัตรจริง)
  ทั้งหมอพร้อมและ ThaiID ใช้ session กลางเดียวกัน (`patient_sessions` + cookie `clinic_patient_session`,
  คอลัมน์ `provider` บอกที่มา 'moph'/'thaid') — ปิด flag ตัวไหน ปุ่มของ provider นั้นจะ**หายไปเลย**
  (ไม่มีปุ่ม mock สำรองแล้ว) เหลือ "ฟอร์มกรอกเอง" เป็นทางเข้าสำรองทางเดียว
- **สถานะปัจจุบัน (`.env` ที่ dev ใช้อยู่): `PATIENT_SSO_ENABLED=true` และ `THAID_SSO_ENABLED=true` ทั้งคู่**
  — ล็อกอินฝั่งประชาชนทั้ง 3 ทาง (หมอพร้อม, ThaiD, ฟอร์มกรอกเอง) เป็นของจริง/พร้อมใช้งานแล้ว
  มีแค่ฝั่งเจ้าหน้าที่ (จนท.) เท่านั้นที่ยังเป็น mock (ดูข้อถัดไป)
- **บั๊กที่แก้แล้ว (สำคัญ อย่าทำพลาดซ้ำ)** สองตัวที่เคยทำให้ผู้ป่วยเห็นคิวของคนอื่น:
  1. `sessionCookieOptions()` เคยส่ง `maxAge` เป็น "วินาที" แต่ express นับเป็น **มิลลิวินาที**
     (`patientSessionHours * 3_600` → cookie อายุจริง **43 วินาที** ทั้งที่แถวใน `patient_sessions` อยู่ 12 ชม.)
     ผลคือล็อกอินเสร็จใช้ได้แป๊บเดียวแล้ว session หลุดเงียบ ๆ — แก้โดยคูณ 1000 ในตัว helper
     มี regression test คุมที่ `auth.patient.test.ts` (assert `Max-Age === patientSessionHours * 3600`)
  2. endpoint ฝั่งผู้ป่วยเคย fallback ไป identity สมมติ `'MOCK-PATIENT-001'` เมื่อไม่มี session
     ทำให้คนที่ session หมดอายุเห็นนัดหมายของ identity นั้นแทน — ตอนนี้ **ลบ fallback ทิ้งแล้ว ตอบ 401**
  3. `AppointmentPage.tsx` เคยเรนเดอร์ปุ่ม mock (identity `MOCK-PATIENT-001`) ระหว่างที่ `auth.loaded`
     ยังเป็น false — ตอนนี้โชว์ loading state แทน และปุ่ม mock ถูกลบออกทั้งหมดแล้ว
- เจ้าหน้าที่: frontend เลือก role เอง แล้วส่ง header `x-mock-role` (**ยังเป็น mock ทุกโหมด** —
  ProviderID SSO ฝั่งเจ้าหน้าที่ยังไม่ถูกต่อ ให้ steps 4–6 ของ ProviderID ใน `mophHealthId.ts` เป็นงานเฟสถัดไป)
- backend ตรวจ role ด้วย `requireMockStaff()` เฉพาะ staff endpoints
- ถ้า `AUTH_MODE` ไม่ใช่ `mock`, staff endpoints ตอบ `501` เพราะ SSO จริงยังไม่ถูกต่อ
- cookie ทำงานบนฐาน same-origin: dev ใช้ Vite proxy `/api` → `:3001` (`VITE_API_BASE_URL` default `/api`)
  production ต้อง serve frontend และ API บน origin เดียวกันผ่าน reverse proxy
**หมายเหตุ**: `/staff/dashboard` เคยเป็น route redirect เก่าที่ชี้ไป `/staff/appointments`
(สมัยที่ `StaffDashboardPage.tsx` ยังถูกเรียกว่า "dashboard") ตอนนี้ redirect นั้นถูกลบแล้ว
และ URL นี้ถูกนำกลับมาใช้กับหน้า Manager dashboard จริงแทน — ถ้าเจอโค้ดหรือลิงก์เก่าที่อ้างอิง
`/staff/dashboard` แล้วคาดหวังพฤติกรรม redirect เดิม ให้ถือว่าเป็นข้อมูลล้าสมัย

- public patient endpoints (`/api/patient/*`, `POST /api/appointments`) อ่าน identity จาก **session cookie
  เท่านั้น** (`getPatientSession()`) ไม่รับ `identity`/`patientIdentity` จาก query หรือ body อีกแล้ว
  และไม่มี fallback เป็น identity สมมติ — ไม่มี session = ตอบ `401 กรุณาเข้าสู่ระบบก่อนใช้งาน`
  ทุกทางล็อกอิน (หมอพร้อม/ThaiD/ฟอร์มกรอกเอง) ออก session แบบเดียวกันหมด จึงมีทางเข้าเดียวที่ต้องดูแล
- route guard ฝั่ง frontend มีไว้จัด UX เท่านั้น ผู้โจมตีแก้ session/header เองได้

เอกสาร `PROVIDER.md` และ `THAID.md` ใช้เป็นข้อมูลอ้างอิงได้ แต่ห้ามถือว่า integration
เหล่านั้นมีอยู่ในระบบแล้ว (ส่วน HealthID สำหรับผู้ป่วย implement แล้วตามด้านบน)

**⚠️ UI ไม่แสดงคำเตือน "mock/สาธิต/ตัวอย่าง" ต่อผู้ใช้แล้ว** (ลบออกตามคำขอเมื่อระบบใกล้ใช้งานจริง)
**แต่กลไก staff auth และการชำระเงินยังเป็น mock เหมือนเดิม** — ห้ามใช้ "ไม่มีข้อความเตือนบนหน้าเว็บ"
เป็นหลักฐานว่าระบบยืนยันตัวตนหรือการชำระเงินเป็นของจริงแล้ว ต้องตรวจโค้ดจริง (`x-mock-role`, `dev-auth`,
`services/mophAlert.ts`, mock QR ใน `BookingPage.tsx`) ก่อนสรุปเสมอ ล็อกอินผู้ป่วยด้วยหมอพร้อมเป็น
flow จริงเมื่อเปิด flag (ดูด้านบน) แต่ฝั่ง staff ต้องทำตามข้อ 2 ในหัวข้อ 15 ก่อนใช้งานจริง

## 9. Booking behavior

### Booking modes

ค่าระบบ `booking_flow` รองรับ:

1. `PROCEDURE_AND_DENTIST` — เลือกหัตถการ แล้วเลือกทันตแพทย์และเวลา
2. `DENTIST_ONLY` — เลือกทันตแพทย์และเวลา โดยไม่บังคับหัตถการ
3. `TIME_ONLY` — ตั้งใจให้เลือกเฉพาะคิวกลางตามเวลา

ค่าเริ่มต้นคือ `PROCEDURE_AND_DENTIST`

### Create appointment

Transaction การจองทั้งหมดอยู่ใน `bookAppointmentInSlot()` (`api/src/app.ts`) — ฟังก์ชันกลางที่
`POST /api/appointments` (สาธารณะ, ผู้ป่วยจองเอง) และ `POST /api/staff/appointments/walk-in`
(เจ้าหน้าที่เพิ่ม walk-in) เรียกใช้ร่วมกัน **ห้ามแยก copy ตรรกะนี้ที่อื่นอีก** เพราะเป็นจุดเดียวที่ล็อกสล็อต
และออกเลขคิวป้องกัน race condition/overbooking การแก้กติกาการจอง (เช่น capacity, เงื่อนไข block) ต้องแก้ที่นี่ที่เดียว
ทั้งสอง route ต่างกันแค่ 2 flag: `immediateConfirm` (walk-in เริ่มที่ `CONFIRMED`/`NOT_REQUIRED` ทันที
ไม่ต้องรอชำระเงิน) และ `skipBlockCheck` (walk-in ข้ามการเช็ค `patient_registry.access_status === 'BLOCKED'`
เพราะบล็อกมีไว้กันการจองออนไลน์ ไม่ใช่การมาที่คลินิกเอง)

ขั้นตอนใน transaction:

1. validate input ด้วย Zod (ที่ route เรียก ก่อนส่งเข้าฟังก์ชันกลาง)
2. lock สล็อตด้วย `FOR UPDATE`
3. ตรวจ capacity, ทันตแพทย์ และความสัมพันธ์กับหัตถการ
4. lock/update `queue_counters` แยกตามวันที่และ queue prefix
5. ตรวจว่าผู้ป่วยถูก block หรือไม่ (ข้ามได้ถ้า `skipBlockCheck`)
6. สร้างเลขคิวรูปแบบ `<PREFIX><เลข 3 หลัก>` เช่น `DNT002`
7. สร้าง appointment, patient registry, visit registry และ status history
8. เพิ่ม `booking_slots.booked_count`
9. commit transaction

Reference code มีรูปแบบประมาณ `APT-<timestamp base36>-<random hex>`

### Cancel appointment และตารางเวรวัน (/staff/queue)

`POST /api/staff/appointments/:id/cancel` ตั้ง `appointment_status = 'CANCELLED'` และลด
`booking_slots.booked_count` (มี `GREATEST(booked_count - 1, 0)` กันติดลบ) พร้อม lock ด้วย `FOR UPDATE`
กันสอง staff กดยกเลิกพร้อมกัน — เป็น endpoint เดียวในระบบที่ทำให้ `booked_count` ลดลง ดังนั้น
`capacity - bookedCount` ที่คืนจาก `GET /api/staff/day-queue`/`GET /api/staff/slots` ถือเป็น
"ที่นั่งว่างจริง" ได้เลยโดยไม่ต้องคำนวณแยกจาก appointment แต่ละแถวอีกที

`PATCH /api/staff/appointments/:id/visit-status` เป็นจุดเดียวที่เขียน `patient_visit_registry.visit_status`
ทั้งระบบ (ทำได้เฉพาะนัดที่ `CONFIRMED` แล้ว) — ก่อนหน้านี้ค่านี้ไม่เคยถูกเขียนหลัง INSERT เริ่มต้นเลย
ทำให้ `/staff/reports/visits` แสดง SERVED/NO_SHOW เป็น 0 ตลอด ถ้าจะเพิ่มจุดมาร์คมาตามนัดที่อื่น
ต้องเรียก endpoint นี้ ห้ามเขียน `visit_status` ตรง ๆ ที่อื่น

### Appointment/payment state

- `appointment_status`: `PENDING_CONFIRMATION`, `CONFIRMED`, `CANCELLED`
- ฝั่ง frontend ใช้ util กลาง `frontend/src/services/appointmentStatus.ts` (`appointmentStatusLabels`
  และ `paymentStatusLabels`) แปล `appointment_status`/`payment_status` เป็นภาษาไทยร่วมกันทุกหน้า staff
  (`StaffDashboardPage.tsx`, `ManagerDashboardPage.tsx`, หน้ารายงานใต้ `/staff/reports/*`) —
  ถ้าจะแก้คำแปลให้แก้ที่ไฟล์ util นี้ที่เดียว (`PENDING_CONFIRMATION` = "นัดรอคอนเฟิร์ม") อย่ากลับไป
  ประกาศ labels ซ้ำในหน้าเอง
- `payment_status`: `AWAITING_PAYMENT`, `SLIP_UPLOADED`, `VERIFIED`, `REJECTED`, `NOT_REQUIRED`
- ค่าจองปัจจุบันกำหนดตายตัวที่ `400` บาทใน `api/src/app.ts`
- เมื่อเปิดค่าจอง: สร้างนัดเป็น `AWAITING_PAYMENT`, แนบสลิป, เจ้าหน้าที่ approve,
  แล้วเปลี่ยนเป็น `VERIFIED` + `CONFIRMED`
- เมื่อปิดค่าจอง: สร้างนัดเป็น `NOT_REQUIRED`, เจ้าหน้าที่กด confirm,
  แล้วเปลี่ยนเป็น `CONFIRMED`
- QR ที่สร้างเป็น mock payload (`MOCK-PAYMENT|...`) ไม่ใช่ PromptPay/payment gateway จริง

## 10. API surface

API ทั้งหมดอยู่ใน `api/src/app.ts`

### Public/patient endpoints

- `GET /api/health`
- `GET /api/booking-config`
- `GET /api/auth/config` — คืน `{ patientSso }` ให้ frontend เลือกหน้า login
- `GET /api/auth/patient/moph/login` — เริ่ม OAuth2: set nonce cookie + 302 ไป moph.id.th (503 ถ้า env ไม่ครบ)
- `GET /api/auth/patient/moph/callback` — แลก code → HealthID token → ตรวจ IAL/BLOCKED → เปิด session → 302 กลับ frontend
- `GET /api/auth/patient/thaid/login` / `callback` — flow ThaiID (DOPA OIDC) โครงเดียวกัน: state cookie
  `thaid_state` ตรวจแบบบังคับ (ThaiID echo state กลับเสมอ), pid จาก id_token→userinfo, ไม่มี IAL gate
  (503 ถ้า env ไม่ครบ, redirect query key เป็น `thaid=success|error&reason=`)
- `POST /api/auth/patient/logout` — ลบ session + clear cookie
- `GET /api/auth/me` — session ผู้ป่วยปัจจุบัน (`identityMasked` เท่านั้น ไม่ส่ง CID เต็ม)
- `POST /api/auth/patient/manual` — ล็อกอินด้วยฟอร์มกรอกเอง (`citizenId` 13 หลัก + `displayName`)
  ออก session จริงเหมือน SSO (`provider = 'manual'`) → `201` พร้อม cookie, `403` ถ้าถูก `BLOCKED`,
  `400` ถ้าเลขบัตรผิดรูปแบบ — แทน `POST /api/dev-auth/patient` ที่ถูกลบทิ้งแล้ว
- `POST /api/dev-auth/staff`
- `GET /api/services`
- `GET /api/services/:serviceId/dentists`
- `GET /api/dentists`
- `GET /api/dentists/weekly-duty-schedule` — สาธารณะ ไม่ต้องมี role คืนตารางเวรจริงของสัปดาห์นี้
  (จันทร์–อาทิตย์ตามเวลา UTC) จากทะเบียนลงเวรที่บันทึกไว้ล่าสุด ใช้แสดงบนหน้า `/team`
- `GET /api/dentists/:dentistId/portrait`
- `GET /api/dentists/:dentistId/availability`
- `GET /api/availability`
- `POST /api/appointments`
- `GET /api/appointments/:reference/payment-qr`
- `POST /api/appointments/:reference/slip`
- `GET /api/patient/appointments?identity=...`
- `GET /api/patient/satisfaction?identity=...` — รายการนัดหมายที่ `visit_status = SERVED` ของ identity นั้น พร้อมสถานะว่าประเมินไปแล้วหรือยัง
  (`hasDentist` มาจาก `appointments.dentist_id` ของนัดหมายนั้นเอง ไม่ใช่ `booking_flow` ปัจจุบัน — ใช้ตัดสินใจว่าต้องโชว์คำถามให้คะแนนทันตแพทย์หรือไม่)
- `POST /api/patient/satisfaction` — ส่งแบบประเมิน (คะแนน 1–5 แยกหัวข้อ: ความสะอาด/เจ้าหน้าที่/ระยะเวลารอคิว/ความประทับใจโดยรวม
  บวกคะแนนทันตแพทย์ถ้านัดผูกทันตแพทย์) ประเมินได้ครั้งเดียวต่อนัดหมาย (`satisfaction_surveys.appointment_id UNIQUE` → 409 ถ้าซ้ำ)
  ต้องเป็นนัดที่ `visit_status = SERVED` เท่านั้น (403 ถ้ายังไม่ถึง) และเป็นเจ้าของนัดหมายจริง (404 ถ้าไม่ตรง identity)

### Daily staff (`CLINIC_STAFF`; บาง endpoint ยอมรับ role อื่นตาม code)

- `GET /api/staff/appointments` — คืน `patientName` (ชื่อ-สกุลผู้จอง) มาด้วยแล้ว หน้า `/staff/appointments` แสดงเป็นคอลัมน์ "ชื่อ-สกุล"
- `GET /api/staff/appointments/:id/slip`
- `POST /api/staff/appointments/:id/approve-payment`
- `POST /api/staff/appointments/:id/confirm`
- `GET /api/staff/day-queue?date=YYYY-MM-DD` — สล็อตทั้งหมดของวันนั้นพร้อมนัดหมายที่ซ้อนอยู่ในแต่ละสล็อต
  (เลขบัตร mask แล้ว), สรุปยอดของวัน และรายชื่อทันตแพทย์+หัตถการสำหรับฟอร์ม walk-in — endpoint เดียวป้อนหน้า `/staff/queue` ทั้งหมด
  เช็ค `system_settings.booking_flow` เหมือน `GET /api/staff/slots`: ถ้าเป็น `TIME_ONLY` จะกรองเฉพาะสล็อต `dentist_id IS NULL`
  (คิวกลางคลินิก) ไม่โชว์สล็อตผูกทันตแพทย์เก่าที่ค้างจากตอนใช้ flow อื่น — response มีฟิลด์ `bookingFlow` บอกโหมดปัจจุบันด้วย
- `POST /api/staff/appointments/walk-in` — เจ้าหน้าที่เพิ่มคิวเข้าไปในสล็อตที่มีอยู่ ยืนยันคิวทันที (`CONFIRMED`/`NOT_REQUIRED`)
  โดยไม่เช็ค `patient_registry.access_status === 'BLOCKED'` (บล็อกมีไว้กันการจองออนไลน์ ไม่ใช่การมาที่คลินิกเอง)
  บังคับกรอกเลขบัตรประชาชน 13 หลักเสมอ (ทั้งฝั่ง client และ `walkInInput` schema) ไม่มี identity สังเคราะห์ `WALKIN-...` อีกแล้ว
- `POST /api/staff/appointments/:id/cancel` — ตั้งสถานะเป็น `CANCELLED` และลด `booking_slots.booked_count` คืนที่นั่งให้สล็อต
- `PATCH /api/staff/appointments/:id/visit-status` — บันทึก `patient_visit_registry.visit_status` (SERVED/NO_SHOW/BOOKED)
  ทำได้เฉพาะนัดหมายที่ `CONFIRMED` แล้วเท่านั้น — endpoint นี้เป็นจุดเดียวในระบบที่เขียนค่านี้ (ก่อนหน้านี้ค่าติดอยู่ที่
  ค่าเริ่มต้น `BOOKED` เสมอ ทำให้ `/staff/reports/visits` ว่างเปล่าในทางปฏิบัติ)
- `GET /api/staff/slots`
- `POST /api/staff/slots`
- `GET /api/staff/dentists`
- `POST /api/staff/dentists`
- `POST /api/staff/dentists/:id/portrait`
- `PATCH /api/staff/dentists/:id`
- `PUT /api/staff/dentists/:id/queue-prefix`
- `PUT /api/staff/dentists/:id/services`
- `GET /api/staff/patient-registry`
- `PATCH /api/staff/patient-registry/:identity`

### Duty roster (`IT_STAFF`, `CLINIC_STAFF`)

- `GET /api/staff/duty-rosters/template?month=YYYY-MM` — ดาวน์โหลดไฟล์ต้นแบบ `.xlsx` ของเดือนนั้น (เลขวันตามจำนวนวันจริง แรเงาเสาร์-อาทิตย์ และเติมรายชื่อทันตแพทย์ที่ active)
- `POST /api/staff/duty-rosters/parse` — multipart field `roster` (.xlsx/.xlsm ไม่เกิน 5 MB) อ่านไฟล์อย่างเดียว ไม่บันทึก คืน `skippedNames` ของรายชื่อที่ถูกกรองออก
- `POST /api/staff/duty-rosters` — บันทึกผลที่เจ้าหน้าที่ยืนยันแล้ว (แทนที่ทะเบียนของเดือนนั้นทั้งเดือน) ปฏิเสธ 400 ถ้ามีแถวที่ชื่อไม่ใช่ทันตแพทย์และไม่ได้จับคู่ `dentistId`
- `GET /api/staff/duty-rosters`
- `GET /api/staff/duty-rosters/:month` (`YYYY-MM`) — คืน `holidays` และ `holidaySource` (`google`/`fallback`) ของเดือนนั้นมาด้วย
- `DELETE /api/staff/duty-rosters/:month`

### IT staff

- `GET /api/staff/settings`
- `GET /api/staff/system-settings`
- `PATCH /api/staff/system-settings/reservation-payment`
- `PATCH /api/staff/system-settings/booking-flow`
- `PATCH /api/staff/system-settings/moph-alert`
- `GET /api/staff/notification-deliveries`
- `POST /api/staff/notification-deliveries/:id/retry`
- `PATCH /api/staff/services/:id`
- `GET /api/staff/users`
- `PATCH /api/staff/users/:id`

### Manager/IT staff

- `GET /api/staff/dashboard` — สรุปครบทั้งยอดรวม, นัดหมายวันนี้ (รายการเต็ม), แนวโน้ม 7 วันล่าสุด,
  หัตถการยอดนิยมของเดือนนี้, สรุปทะเบียนผู้ป่วย และตารางเวรสัปดาห์นี้ (ใช้ฟังก์ชันเดียวกับ
  `/api/dentists/weekly-duty-schedule` ผ่าน `weeklyDutySchedule()` ใน `app.ts`)
- `GET /api/staff/reports/appointments` — รายงานนัดหมายทั้งหมด read-only (`['IT_STAFF', 'MANAGER']`):
  query `from`/`to` (YYYY-MM-DD, ไม่ใส่ = ไม่จำกัด), `dentistId`, `status`
  (`PENDING_CONFIRMATION|CONFIRMED|CANCELLED`), `search` (ชื่อ/เบอร์/เลขคิว/รหัสอ้างอิง/identity)
  คืน `summary` (จำนวนแยกสถานะ + มูลค่าไม่รวมยกเลิก) และ `appointments` ล่าสุดสูงสุด 500 แถว
- `GET /api/staff/reports/visits` — รายงานการเข้าพบ/No-show (`['IT_STAFF', 'MANAGER']`):
  query `from`/`to` (default ย้อนหลัง 6 เดือนถึงวันนี้) นับจาก `patient_visit_registry.visit_status`
  ไม่รวมนัดที่ยกเลิก คืน `summary`, `monthly` (group ตามเดือน) และ `byDentist`
  (คิวกลาง/นัดที่ไม่ระบุทันตแพทย์อยู่กลุ่ม `คิวกลางคลินิก`) โดย `noShowRate` = NO_SHOW ÷ (SERVED + NO_SHOW)
- `GET /api/staff/reports/revenue` — รายงานค่าจองคิว (`['IT_STAFF', 'MANAGER']`): แยกตามเดือน
  (`monthly`), หัตถการ (`byService`) และสถานะการชำระทั้ง 5 สถานะ ไม่รวมนัดที่ยกเลิก
  ปุ่ม export CSV อยู่ฝั่ง frontend (สร้าง CSV + BOM จากตารางรายเดือนใน browser ไม่มี endpoint export)
- `GET /api/staff/reports/dentist-productivity` — จำนวนนัด (ไม่ยกเลิก, ไม่รวม `dentist_id IS NULL`)
  เทียบ `COUNT(DISTINCT duty_date)` จาก `duty_roster_days` ของทันตแพทย์แต่ละคน คืน `appointmentsPerDutyDay`
  เป็น `null` เมื่อไม่มีวันลงเวรในช่วงนั้น
- `GET /api/staff/reports/notifications` — สรุป `notification_deliveries` ทั้งหมด (นับแยกสถานะ +
  `successRate` = SENT ÷ ทั้งหมด) และ `recent` 20 รายการล่าสุด อ่านอย่างเดียว การ retry ยังอยู่ที่
  `POST /api/staff/notification-deliveries/:id/retry` ของ IT_STAFF เท่าเดิม
- `GET /api/staff/reports/peak-hours` — นัดที่ไม่ยกเลิก จัดกลุ่มตาม `DAYOFWEEK(service_date)`
  (1=อาทิตย์…7=เสาร์) และ `HOUR(start_time)` คืน `byWeekday`, `byHour` และ `grid` (ไม่ใส่ from/to = ทั้งหมด)

ต้องอ่าน `requireMockStaff()` ที่ route จริงก่อนเปลี่ยน permission เพราะชื่อกลุ่มข้างต้นอธิบาย
intent ของ UI และไม่ได้แทนการตรวจสอบ allow-list ของแต่ละ endpoint

## 11. Database schema

Migration อยู่ใน `api/src/scripts/migrate.ts` และสร้าง database ให้อัตโนมัติถ้า DB user
มีสิทธิ์ `CREATE DATABASE`

| Table | หน้าที่สำคัญ |
|---|---|
| `services` | หัตถการ หมวด ระยะเวลา ราคา ค่าจอง และ active flag |
| `system_settings` | payment toggle, booking flow และ encrypted MOPH credentials |
| `patient_registry` | identity, ชื่อ และสถานะ `ACTIVE/BLOCKED` |
| `dentists` | ชื่อ คำนำหน้า queue prefix รูป และ active flag |
| `dentist_services` | many-to-many ระหว่างทันตแพทย์กับหัตถการ |
| `booking_slots` | วัน เวลา capacity, booked count และ dentist (nullable สำหรับคิวกลาง) |
| `queue_counters` | running sequence แยกตามวันที่และ prefix |
| `appointments` | ข้อมูลนัด ผู้ป่วย สถานะ payment และ reference |
| `patient_visit_registry` | สถานะ `BOOKED/SERVED/NO_SHOW` ของแต่ละนัด |
| `payment_slips` | ชื่อไฟล์และผลตรวจสลิป |
| `satisfaction_surveys` | คะแนนประเมินความพึงพอใจ 1 แถวต่อนัดหมาย (`appointment_id UNIQUE`) แยก 4 หัวข้อ + คะแนนทันตแพทย์ (nullable, มีเฉพาะนัดที่ผูกทันตแพทย์) |
| `appointment_status_history` | audit trail ของ appointment/payment state |
| `staff_users` | Provider identity, role และ approval status |
| `notification_deliveries` | สถานะและ retry metadata ของ MOPH Alert |
| `duty_rosters` | ทะเบียนลงเวร 1 แถวต่อเดือน (`duty_month` เป็น `YYYY-MM` ปี ค.ศ.) |
| `duty_roster_members` | รายชื่อในตารางเวรของเดือนนั้น พร้อม `dentist_id` ที่จับคู่ได้ |
| `duty_roster_days` | วันลงเวรรายวันของแต่ละรายชื่อ (`ON DELETE CASCADE` จาก roster) |

Migration เป็นชุด imperative `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE`; ไม่มี migration
version table และไม่มี rollback migration ห้ามแก้ schema โดยเดาว่าฐานข้อมูลว่าง

Seed (`api/src/scripts/seed.ts`) ทำสิ่งสำคัญดังนี้:

- upsert รายการหัตถการและราคา
- mark รายการ legacy บางรายการเป็น inactive
- สร้าง roster ทันตแพทย์และ queue prefix
- กำหนดหัตถการตัวอย่างให้ทันตแพทย์หลักสองคน
- สร้างสล็อตใน 14 วันถัดไป (ข้ามวันอาทิตย์)
- สร้าง staff mock ถ้าตารางยังว่าง

### หัวตารางที่ merge ข้ามคอลัมน์

ExcelJS คืนค่าของ cell แม่ให้ทุก cell ที่ถูก merge หัวตารางที่ merge ข้ามทั้งแถว (แบบที่ทำใน Excel ปกติ)
จึงถูกอ่านซ้ำหลายสิบครั้ง เคยทำให้ `title` ยาวเกิน 255 ตัวอักษรและบันทึกไม่ผ่าน

- `parseDutyRosterGrid()` ยุบค่าที่ซ้ำกันติดกันในแต่ละแถวก่อนประกอบ title และตัดที่ 255 ตัวอักษร
- ฝั่ง API `title`/`sourceFileName` ใช้ `.transform()` ตัดให้พอดีแทนการปฏิเสธ เพราะเป็นข้อมูลประกอบ
- แถวที่ทันตแพทย์ไม่มีเวรในเดือนนั้น (`days: []`) ถือว่าปกติ บันทึกเป็นสมาชิกของทะเบียนได้
- Zod error ของ route นี้ไม่ใช้ข้อความรวม `'ข้อมูลการจองไม่ครบถ้วน'` จาก error handler กลาง
  แต่ตอบเป็นข้อความที่ระบุชื่อฟิลด์ที่ผิด

### กรองเฉพาะทันตแพทย์ตอนนำเข้า

ทะเบียนลงเวรเก็บเฉพาะทันตแพทย์ ไม่รวมเจ้าหน้าที่ประเภทอื่นที่อยู่ในตารางเวรเดียวกัน

- `isDentistName()` ใน `api/src/domain/dutyRoster.ts` รับเฉพาะชื่อที่ขึ้นต้นด้วย
  `ทันตแพทย์หญิง`, `ทันตแพทย์`, `ทพญ.`, `ทพญ`, `ทพ.`, `ทญ.`, `ทพ` และต้องมีชื่อต่อท้าย
- แถวที่ไม่ผ่านจะถูกเก็บไว้ใน `skippedNames` พร้อม warning เพื่อให้เจ้าหน้าที่เห็นว่าใครถูกข้าม
  (หน้าเว็บแสดงเป็นรายการพับเก็บได้) ไม่ได้เงียบหาย
- ตอนบันทึก API ตรวจซ้ำอีกชั้น แต่ยอมให้แถวที่ชื่อไม่เข้าเกณฑ์ผ่านได้ถ้าเจ้าหน้าที่จับคู่
  `dentistId` กับทะเบียนทันตแพทย์แล้ว เพราะถือว่ายืนยันตัวตนด้วยมือแล้ว
- ถ้าคลินิกเพิ่มคำนำหน้าแบบอื่น ให้แก้ `dentistHonorifics` และ `honorificPattern` คู่กัน
  (ตัวแรกใช้กรอง ตัวหลังใช้ตัดคำนำหน้าตอนจับคู่ชื่อ)

### หน้า TeamPage (/team) — ทีมงานและตารางเวรรายสัปดาห์

- **โปรไฟล์ทันตแพทย์**: มี bio ที่เขียนไว้จริงแค่ 2 ท่าน (ตรงกับชื่อใน `data/site.ts` เท่านั้น จับคู่แบบ exact match)
  ทันตแพทย์คนอื่นในทะเบียนจะได้โปรไฟล์กลางที่เป็นความจริง (ไม่ยืม bio/เวลาออกตรวจ/รูปของอีกคน) และแสดงไอคอน
  แทนรูปถ้ายังไม่มีรูปอัปโหลด — **ห้ามแก้กลับไปใช้ fallback แบบ round-robin ตาม title/index เดิม**
  เพราะจะทำให้ทันตแพทย์คนหนึ่งแสดงข้อมูลของอีกคนที่มีตัวตนจริง
- **ตารางเวรรายสัปดาห์**: ดึงจาก `duty_roster_days` จริงผ่าน `/api/dentists/weekly-duty-schedule`
  (สัปดาห์ปัจจุบัน จันทร์–อาทิตย์) ไม่ใช่ตารางประจำสัปดาห์แบบ static อีกต่อไป ถ้าเดือนนั้นยังไม่มีใครอัปโหลด
  ทะเบียนลงเวร (ผ่าน `/staff/duty-roster`) หน้านี้จะแสดงข้อความ "ยังไม่มีตารางเวร..." แทนตารางว่าง/เส้นประ

### ลิงก์ตารางแพทย์วังทอง

`wangthongScheduleUrl` ใน `frontend/src/pages/StaffDutyRosterPage.tsx` เป็นลิงก์ Google Sheets
ภายนอก เปิดในแท็บใหม่เท่านั้น ไม่ได้ดึงข้อมูลเข้าระบบ และไม่ต้องล็อกอิน Google ฝั่งเซิร์ฟเวอร์
หน้าเดียวกันแจ้งเจ้าหน้าที่ว่า **ช่องสีแดงในตารางนั้นคือเวรที่มีการแลกเวร**
ถ้าไฟล์ถูกย้ายหรือเปลี่ยนสิทธิ์การเข้าถึง ต้องแก้ค่าคงที่นี้ค่าเดียว

### วันหยุดนักขัตฤกษ์ (`api/src/services/thaiHolidays.ts`)

- ดึง ICS สาธารณะจาก Google โดยไม่ใช้ API key ตาม `GOOGLEHOLIDAY.md`
- ปฏิทินหลัก `th.th#holiday@group.v.calendar.google.com` (ได้ชื่อวันหยุดภาษาไทย)
  ถ้าล้มเหลวจะถอยไป `en.th#holiday@...` แล้วจึงใช้ static fallback ในไฟล์
- คัดเฉพาะ event ที่ `DESCRIPTION` เป็น `วันหยุดนักขัตฤกษ์`/`Public holiday`
  จึงไม่รวมวันสำคัญอย่างวาเลนไทน์ ตรุษจีน หรือคริสต์มาส
- ไม่นับ **วันแรงงาน (1 พฤษภาคม)** เพราะไม่ใช่วันหยุดราชการ — แก้ได้ที่ `excludedMonthDays`
- แคชในหน่วยความจำ 24 ชั่วโมง (ถ้าใช้ fallback จะ retry ใหม่ใน 1 ชั่วโมง) ไม่มี state ใน DB
  ดังนั้นหลาย instance จะมีแคชแยกกัน และ `resetThaiHolidayCache()` มีไว้ใช้ใน test
- ใช้แรเงาไฟล์ต้นแบบ (สีส้ม) และคอลัมน์ในตารางลงเวรบนหน้าเว็บ ไม่มีผลกับการ parse ไฟล์ที่อัปโหลด

## 12. MOPH Alert

Implementation จริงอยู่ที่ `api/src/services/mophAlert.ts`:

- endpoint: `https://morpromt2c.moph.go.th/alert/v3.1/messages`
- CID ต้องเป็นเลข 13 หลัก
- credentials ส่งผ่าน headers `client-key` และ `secret-key`
- credentials ที่เก็บใน DB ถูกเข้ารหัส AES-256-GCM โดย derive key ด้วย `scrypt`
- server เรียก worker ตอน start และทุก 5 นาที
- สร้าง delivery หลังนัดเป็น `CONFIRMED`
- ถือ HTTP 200 เป็น success
- retry อัตโนมัติเฉพาะ network error หรือ HTTP 5xx สูงสุด 3 attempts
- manual retry รีเซ็ต failed/invalid delivery ได้ผ่าน IT endpoint
- request timeout 60 วินาที

หาก `moph_alert_enabled` ปิด, ไม่มี encrypted credentials หรือไม่ได้ตั้ง
`MOPH_ALERT_ENCRYPTION_KEY`, worker จะไม่ส่งข้อความ

## 13. Uploads และข้อมูลที่มีความอ่อนไหว

- Multer รับเฉพาะ JPEG, PNG, WebP ขนาดไม่เกิน 5 MB
- ไฟล์ถูกเขียนใน `api/uploads/` โดยใช้ timestamp + random suffix + sanitized filename
- ทั้งรูปทันตแพทย์และสลิปอยู่โฟลเดอร์เดียวกัน
- API ใช้ `basename()` ก่อน serve ไฟล์เพื่อลด path traversal risk
- code ปัจจุบันไม่มี cleanup ไฟล์เก่าเมื่อ upload ทับหรือ record เปลี่ยน
- ห้ามนำ `api/uploads/` ไปเผยแพร่เป็น static directory สาธารณะ เพราะมีสลิปการชำระเงิน
- staff slip endpoint ยังอาศัย mock role header ไม่ใช่ production-grade authorization

## 14. Tests และ verification

### Frontend

```bash
cd frontend
npm test
npm run lint
npm run build
```

`frontend/src/__tests__/app.test.tsx` ครอบคลุม public pages, booking journey,
mock login/session และ staff UI เป็นหลัก โดย stub `fetch`

ข้อควรระวัง: เทสต์ของ `StaffDentistsPage` (`...dentist registry...`, `...assigned procedures`)
**ไม่ได้ stub `fetch`** จึงยิงไปที่ API จริงที่ `http://localhost:3001` ต้องเปิด `npm run dev` ฝั่ง api
พร้อม DB ที่ seed แล้วก่อนรัน `npm test` ไม่เช่นนั้นสองเทสต์นี้จะ fail

### Backend

```bash
cd api
npm run build
npm test
```

คำเตือน: `api/src/app.integration.test.ts` ใช้ MySQL ตาม `.env` จริงและมีการเขียน/แก้ข้อมูล
จึงต้อง migrate/seed test database ก่อน และไม่ควรรันกับ production database

`api/vitest.config.ts` ตั้ง `fileParallelism: false` ไว้เพราะไฟล์เทสต์แก้ `system_settings.booking_flow`
ร่วมกันบน DB เดียวกัน — ห้ามเปิดรันไฟล์ขนาน (เคยเจอ deadlock, FK error และ flow เปลี่ยนกลางคัน)
และ suite นี้บังคับ `config.patientSsoEnabled = false` เสมอ ไม่ว่า `.env` จะเปิด SSO ไว้;
ส่วน flow ผู้ป่วยด้วยหมอพร้อมทดสอบใน `api/src/auth.patient.test.ts` (stub moph.id.th ทั้งหมด)

หากแก้ booking หรือ payment ให้รันอย่างน้อย:

```bash
cd api
npx vitest run src/domain/booking.test.ts src/services/mophAlert.test.ts
```

จากนั้นรัน integration suite บน test database และ frontend tests ที่เกี่ยวข้อง

## 15. Known gaps และสิ่งที่ต้องระวัง

1. **`TIME_ONLY` ยังไม่ complete end-to-end**: frontend ไม่ส่ง `dentistId` แต่ schema ของ
   `POST /api/appointments` ยังบังคับ `dentistId` และ query ยัง join `dentists`
2. **Staff authentication ยังเป็น mock**: ห้าม deploy ให้เจ้าหน้าที่ใช้จริงก่อนมี ProviderID SSO,
   server-side session, CSRF strategy และ authorization ที่เชื่อถือได้ (ผู้ป่วยผ่าน HealthID แล้วเมื่อ
   `PATIENT_SSO_ENABLED=true` — ดูหัวข้อ 8)
3. **ฟอร์มกรอกเองใช้งานได้จริง แต่ identity เป็น self-declared**: เลขบัตรที่กรอกถูกใช้จริงทั้งระบบ
   (ทะเบียนผู้ป่วย, การจอง, การบล็อก) ระบบตรวจแค่รูปแบบ 13 หลักใน browser — ใครก็กรอกเลขบัตรคนอื่นได้
   จึงต่างจากหมอพร้อม (Dipchip) และ ThaiID (DOPA login) ที่ยืนยันตัวตนกับผู้ให้บริการจริง
   — endpoint ฝั่งผู้ป่วยทุกตัวใช้กลไกเดียวกัน (session ก่อน ไม่งั้น self-declared, ไม่มีก็ 401)
   **อัปเดต**: ฟอร์มกรอกเองออก session จริงแล้ว (`provider = 'manual'`) และทุก endpoint อ่าน identity
   จาก session อย่างเดียว จึงไม่มีใครยิง `?identity=` สวมเป็นคนอื่นได้อีก — ที่ยังเหลือคือ "ตอนล็อกอิน"
   ยังกรอกเลขบัตรของคนอื่นได้ (ไม่มีการพิสูจน์กับ DOPA/หมอพร้อม) ถ้าต้องการปิดสนิทต้องบังคับใช้ SSO
   อย่างเดียวแล้วปิดฟอร์มกรอกเอง
4. ~~`AppointmentPage` hardcode `http://localhost:3001/api/dev-auth/patient`~~ **แก้แล้ว** —
   ใช้ `VITE_API_BASE_URL` แล้ว และค่า default เป็น `/api` (same-origin ผ่าน Vite proxy)
4.1. ~~`AppointmentPage.tsx` เรนเดอร์ปุ่ม mock ก่อน SSO config โหลดเสร็จ~~ **แก้แล้ว** — ปุ่ม mock
   ถูกลบทั้งหมด และระหว่าง `auth.loaded === false` จะโชว์ loading state แทนที่จะ fall through ไปหน้าปุ่ม mock
4.2. ~~endpoint ฝั่งผู้ป่วย fallback ไป `MOCK-PATIENT-001` / cookie session อายุ 43 วินาที~~ **แก้แล้ว**
   — ดูรายละเอียดในหัวข้อ 8 (ทั้งสองตัวรวมกันเคยทำให้ผู้ป่วยที่ล็อกอินจริงเห็นคิวของคนอื่น)
5. **Payment เป็น mock**: QR ไม่โอนเงินจริงและไม่มี payment callback/reconciliation
6. **Frontend/Backend build แยกกัน**: API ไม่มี static SPA hosting/fallback route
7. **Integration tests ใช้ DB ร่วม**: ยังไม่มี isolated ephemeral test database
8. **Upload storage เป็น local disk**: ไม่เหมาะกับหลาย instance และยังไม่มี lifecycle cleanup
9. **เอกสารเก่าขัดกับ code**: อย่าพึ่ง `architecture.md`/`summary.md` โดยไม่ตรวจ source
10. **Generated output ซ้ำหลายจุด**: แก้เฉพาะ source แล้ว build ใหม่ ห้ามแก้ `dist` โดยตรง
11. **Legacy frontend code ยังอยู่**: `frontend/src/services/appointment.ts`,
    `ServiceCard.tsx` และ type บางส่วนไม่ได้อยู่ใน booking flow ปัจจุบัน
12. **ไม่มี Git metadata ใน workspace ปัจจุบัน**: คำสั่ง `git status/diff` ใช้ไม่ได้ใน directory นี้
13. **ทะเบียนลงเวรยังไม่เชื่อมกับ `booking_slots`**: เป็นทะเบียนอ้างอิงอย่างเดียว การสร้างสล็อตจอง
    ยังต้องทำที่ `/staff/slots` ตามเดิม และยังไม่มีหน้าจอแก้วันลงเวรรายช่อง (ต้องอัปโหลดไฟล์ทับทั้งเดือน)
14. **Parser ตารางเวรอิงรูปแบบไฟล์**: ต้องมีแถวหัวตารางที่เป็นเลข 1–31 และคอลัมน์ที่มีคำว่า "ชื่อ"
    ถ้าไฟล์เปลี่ยนรูปแบบให้แก้/เพิ่ม test ใน `api/src/domain/dutyRoster.test.ts` ก่อน
15. **วันหยุดพึ่ง network ภายนอก**: ถ้าเซิร์ฟเวอร์ออกอินเทอร์เน็ตไม่ได้ ระบบจะใช้ static fallback
    ซึ่งมีข้อมูลถึงปี 2026 เท่านั้น ต้องอัปเดต `fallbackHolidays` ทุกต้นปี และ Google อาจประกาศ
    วันหยุดชดเชยช้ากว่าราชการ จึงควรให้เจ้าหน้าที่ตรวจก่อนใช้จริง
16. **ไฟล์ต้นแบบกับ parser ต้องแก้คู่กัน**: `buildDutyRosterTemplate()` สร้างไฟล์ที่ `parseDutyRosterGrid()`
    ต้องอ่านกลับได้ มี test round-trip ครอบไว้ทั้งใน `dutyRoster.test.ts` และ `app.integration.test.ts`

## 16. แนวทางสำหรับ agent ที่เข้ามาทำงานต่อ

ก่อนแก้โค้ด:

1. อ่านไฟล์นี้ทั้งหมด
2. ระบุว่าการเปลี่ยนแปลงอยู่ frontend, API, schema, integration หรือหลายส่วน
3. อ่าน source และ test ที่เกี่ยวข้องโดยตรง อย่าอาศัยเอกสารเก่าเพียงอย่างเดียว
4. ตรวจ `.env.example` แต่ห้ามเปิดเผยค่าจาก `.env`
5. ถ้าแตะ schema ให้ตรวจ migration กับ seed พร้อมกัน
6. ถ้าแตะ API contract ให้แก้ frontend consumer และ test ที่เกี่ยวข้อง
7. ถ้าแตะ permission ให้ตรวจทั้ง frontend navigation/guard และ backend role allow-list
8. ถ้าแตะ booking ให้ทดสอบครบทั้งสาม booking flow และ payment on/off
9. ถ้าแตะ upload/MOPH/auth/payment ให้ถือเป็นงานข้อมูลอ่อนไหวและทำ security review
10. อย่าแก้ generated files (`dist/**`) ด้วยมือ

หลังแก้โค้ด:

1. รัน focused tests ก่อน
2. รัน build/lint/test ของแพ็กเกจที่เปลี่ยน
3. ถ้าเป็น API integration ให้ใช้ test database เท่านั้น
4. สรุปไฟล์ที่แก้ behavior ที่เปลี่ยน และข้อจำกัดที่ยังเหลือ

## 17. จุดเริ่มอ่านตามประเภทงาน

| งาน | ไฟล์ที่ควรอ่านก่อน |
|---|---|
| Routing/layout | `frontend/src/App.tsx`, `frontend/src/components/SiteLayout.tsx`, `AdminPanelLayout.tsx` |
| Public content/UI | `frontend/src/pages/*`, `frontend/src/data/*`, `frontend/src/styles/global.css` |
| Booking wizard | `frontend/src/pages/BookingPage.tsx`, `api/src/app.ts`, `api/src/domain/booking.ts` |
| Login/session | `AppointmentPage.tsx`, `SiteHeader.tsx`, `StaffRoleSelectPage.tsx`, `api/src/app.ts`, `api/src/services/mophHealthId.ts`, `api/src/services/thaidAuth.ts`, `api/src/services/patientSession.ts`, `frontend/src/services/patientSession.ts` |
| Slots | `StaffSlotsPage.tsx`, route `/api/staff/slots*`, `booking_slots` schema |
| ปฏิบัติงานประจำวัน (คิว walk-in/ยกเลิก/มาตามนัด) | `StaffQueueBoardPage.tsx`, `bookAppointmentInSlot()` ใน `app.ts`, routes `/api/staff/day-queue`, `/api/staff/appointments/walk-in`, `/api/staff/appointments/:id/cancel`, `/api/staff/appointments/:id/visit-status` |
| Dentist registry | `StaffDentistsPage.tsx`, `TeamPage.tsx`, dentist API routes |
| ตารางเวรบนหน้า /team | `TeamPage.tsx`, `currentWeekRange()` ใน `dutyRoster.ts`, route `/api/dentists/weekly-duty-schedule` |
| Manager dashboard | `ManagerDashboardPage.tsx`, route `GET /api/staff/dashboard` ใน `app.ts` |
| Manager รายงาน (นัดหมาย/เข้าพบ/รายได้/ผลิตภาพ/MOPH/ช่วงเวลานิยม) | `StaffAppointmentsReportPage.tsx`, `StaffVisitsReportPage.tsx`, `StaffRevenueReportPage.tsx`, `StaffDentistProductivityPage.tsx`, `StaffNotificationsReportPage.tsx`, `StaffPeakHoursPage.tsx`, routes `/api/staff/reports/*` ใน `app.ts`, `appointmentStatus.ts` |
| Duty roster | `StaffDutyRosterPage.tsx`, `api/src/domain/dutyRoster.ts`, `services/dutyRosterExcel.ts`, duty roster API routes |
| Service registry | `ServicesPage.tsx`, `StaffAdminPage.tsx`, service API routes, `seed.ts` |
| Payment/slips | `BookingPage.tsx`, `StaffDashboardPage.tsx`, appointment/slip routes |
| Patient blocklist | `PatientRegistryPage.tsx`, patient registry API routes |
| Staff roles | `AdminPanelLayout.tsx`, staff user routes, `requireMockStaff()` |
| MOPH Alert | `SystemSettingsPage.tsx`, `mophAlert.ts`, delivery code ใน `app.ts` |
| Database | `api/src/scripts/migrate.ts`, `seed.ts`, SQL queries ใน `app.ts` |
| Test contract | `api/src/*.test.ts`, `api/src/domain/*.test.ts`, `frontend/src/__tests__/app.test.tsx` |

