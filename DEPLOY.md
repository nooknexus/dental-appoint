# คู่มือติดตั้งระบบผ่าน aaPanel + Nginx

คู่มือนี้สำหรับติดตั้งระบบจองคิว สาสุข พรีเมียม Dental Clinic บนเซิร์ฟเวอร์ที่ลง [aaPanel](https://www.aapanel.com/) แล้ว
อ้างอิงจากโค้ดจริงในโปรเจกต์ (`api/`, `frontend/`) ไม่ใช่คู่มือทั่วไป

## 1. ภาพรวมสถาปัตยกรรมตอน production

```
ผู้ใช้ → HTTPS (Nginx) ─┬─ /api/*  → proxy_pass → Node.js API (Express, พอร์ต 3001, รันด้วย PM2/aaPanel Node Manager)
                        └─ อื่นๆ   → ไฟล์ static จาก frontend/dist (React SPA, build ด้วย Vite)

Node.js API ─── MySQL (localhost:3306)
```

- Frontend และ API **ต้องอยู่โดเมนเดียวกัน** ผ่าน reverse proxy เดียว (ไม่ใช่คนละ origin) เพราะ session cookie ของผู้ป่วย/เจ้าหน้าที่ตั้งเป็น `SameSite=Lax` — ถ้าแยกโดเมนกัน cookie จะไม่ถูกส่งและล็อกอินไม่ติด
- รูปทันตแพทย์และสลิปการชำระเงินที่อัปโหลดไว้ **ไม่ได้ให้ Nginx เสิร์ฟตรง** — API มี route เฉพาะ (`/api/dentists/:id/portrait`, `/api/staff/appointments/:id/slip`) อ่านไฟล์จากโฟลเดอร์ `api/uploads/` แล้วส่งกลับเอง จึงไม่ต้องตั้งค่า Nginx เพิ่มสำหรับไฟล์อัปโหลด

## 2. สิ่งที่ต้องมีในเซิร์ฟเวอร์ (ติดตั้งผ่านเมนู App Store ของ aaPanel)

| รายการ | เวอร์ชันแนะนำ | หมายเหตุ |
|---|---|---|
| Nginx | เวอร์ชันล่าสุดที่ aaPanel มี | ใช้เป็น reverse proxy + serve static |
| MySQL หรือ MariaDB | MySQL 8.x | ต้องรองรับ utf8mb4 (migrate จะสร้าง DB เป็น `utf8mb4_unicode_ci` เอง) |
| Node.js Version Manager (ปลั๊กอิน) | Node.js **20 LTS** | โค้ดใช้ `type: module`, native `fetch`, syntax ES2022 — ต้อง Node ≥ 18, แนะนำ 20 ให้ตรงกับที่พัฒนา |
| PM2 Manager (มากับ Node.js Version Manager) หรือเมนู "Node project" ของ aaPanel | — | ใช้รัน `api/dist/server.js` เป็น background service ถาวร |
| Git | — | ใช้ `git clone` ดึงโค้ดจาก GitHub |
| SSL — Let's Encrypt (ในแท็บ SSL ของเว็บไซต์) | — | ต้องมี HTTPS จริงก่อนเปิดใช้ ProviderID/HealthID/ThaiID SSO |

## 3. สร้างเว็บไซต์ใน aaPanel

1. เมนู **Website → Add site** ตั้งโดเมน (เช่น `appoint.yourclinic.go.th`) เลือก PHP เป็น "ไม่ต้องการ" (Pure static เดี๋ยวจะเขียน config เอง) และสร้างฐานข้อมูลพร้อมกันได้เลย (หรือสร้างทีหลังในข้อ 5)
2. เก็บพาธเว็บไซต์ที่ aaPanel สร้างให้ไว้ (เช่น `/www/wwwroot/appoint.yourclinic.go.th`) — จะใช้เป็นที่ clone โค้ด

## 4. ดึงโค้ดขึ้นเซิร์ฟเวอร์

เปิด **Terminal** ของ aaPanel (หรือ SSH เข้าเครื่อง) แล้วรัน:

```bash
cd /www/wwwroot/appoint.yourclinic.go.th
git clone https://github.com/nooknexus/dental-appoint.git .
```

> ถ้าโฟลเดอร์เว็บไซต์ที่ aaPanel สร้างให้มีไฟล์ default อยู่ก่อน (เช่น `index.html` ตัวอย่าง) ให้ลบทิ้งก่อน clone หรือ clone ไปที่โฟลเดอร์ว่างแล้วค่อยย้ายทีหลัง

## 5. เตรียมฐานข้อมูล MySQL

ไปที่เมนู **Database → Add database** ใน aaPanel สร้าง:
- ชื่อฐานข้อมูล เช่น `clinic_appoint_db`
- ผู้ใช้ + รหัสผ่านสำหรับฐานข้อมูลนี้โดยเฉพาะ (อย่าใช้ `root` ตามค่า default ใน `.env.example`)
- ให้สิทธิ์ผู้ใช้นี้ `CREATE` ด้วย เพราะสคริปต์ migrate จะรัน `CREATE DATABASE IF NOT EXISTS` เองตอนติดตั้งครั้งแรก (ถ้า aaPanel สร้าง DB ให้แล้วก็ไม่ต้องกังวล ข้ามได้เพราะมีอยู่แล้ว)

## 6. ตั้งค่า environment ของ API (`api/.env`)

```bash
cd /www/wwwroot/appoint.yourclinic.go.th/api
cp .env.example .env
nano .env   # หรือแก้ผ่าน File Manager ของ aaPanel
```

ค่าที่ **ต้องเปลี่ยนจาก `.env.example` ก่อนใช้งานจริง**:

| ตัวแปร | ค่าที่ต้องตั้ง |
|---|---|
| `API_PORT` | `3001` (หรือพอร์ตว่างอื่นที่ไม่ชนกับเว็บไซต์อื่นในเครื่อง) |
| `FRONTEND_ORIGIN` | `https://appoint.yourclinic.go.th` (โดเมนจริง ใช้ตรวจ CORS/credential) |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | ค่าจากข้อ 5 (ห้ามเหลือ `root/root`) |
| `AUTH_MODE` | `provider` เมื่อพร้อมเปิดให้เจ้าหน้าที่ล็อกอินจริงด้วย ProviderID (ดูเงื่อนไขในข้อ 9) — ถ้ายังไม่พร้อมให้คงค่า `mock` ไว้ก่อนเพื่อทดสอบระบบภายใน |
| `SESSION_SECRET` | สุ่มค่าใหม่ที่คาดเดาไม่ได้ (เช่น `openssl rand -hex 32`) |
| `MOPH_ALERT_ENCRYPTION_KEY` | สุ่มค่าใหม่เช่นกัน — ใช้เข้ารหัส MOPH Alert client/secret key ที่เก็บใน DB |
| `COOKIE_SECURE` | `true` **เมื่อเปิด HTTPS แล้วเท่านั้น** (ข้อ 10) — ถ้าตั้ง `true` ก่อนมี HTTPS จริง cookie ล็อกอินทุกชนิดจะใช้งานไม่ได้เลย |

ค่าที่เป็น **ทางเลือก** ตามฟีเจอร์ที่จะเปิดใช้:

- **ล็อกอินผู้ป่วยด้วยหมอพร้อม (HealthID)**: ตั้ง `PATIENT_SSO_ENABLED=true` พร้อม `MOPH_CLIENT_ID`, `MOPH_CLIENT_SECRET`, `MOPH_REDIRECT_URI=https://appoint.yourclinic.go.th/api/auth/patient/moph/callback` (ต้องตรงกับที่ลงทะเบียนไว้กับ moph.id.th **แบบ byte-to-byte** — ดูรายละเอียดใน [PROVIDER.md](PROVIDER.md))
- **ล็อกอินเจ้าหน้าที่ด้วย ProviderID**: ตั้ง `AUTH_MODE=provider` พร้อม `PROVIDER_CLIENT_ID`, `PROVIDER_CLIENT_SECRET` — ใช้ `MOPH_CLIENT_ID/SECRET/REDIRECT_URI` ชุดเดียวกับผู้ป่วยด้านบน (ต้องตั้งคู่กันเสมอ)
- **ล็อกอินผู้ป่วยด้วย ThaiID**: ตั้ง `THAID_SSO_ENABLED=true` พร้อม `THAID_CLIENT_ID`, `THAID_CLIENT_SECRET`, `THAID_REDIRECT_URI=https://appoint.yourclinic.go.th/api/auth/patient/thaid/callback` (ดู [THAID.md](THAID.md))

> ค่า MOPH Alert client-key/secret-key (สำหรับส่งแจ้งเตือน LINE ตอนยืนยัน/ยกเลิกนัด) **ไม่ได้ตั้งใน `.env`** — ไปกรอกในหน้าเว็บ "ตั้งค่าระบบ" (System Settings) หลังติดตั้งเสร็จและมีบัญชี IT Staff แล้ว (ดู [MOPHALERT.md](MOPHALERT.md))

## 7. ติดตั้ง dependency และ build

```bash
# API
cd /www/wwwroot/appoint.yourclinic.go.th/api
npm ci
npm run build          # คอมไพล์ TypeScript → dist/

# Frontend
cd /www/wwwroot/appoint.yourclinic.go.th/frontend
npm ci
npm run build           # ได้ frontend/dist/ เป็นไฟล์ static
```

frontend ไม่ต้องมี `.env` เพิ่ม เพราะค่า default `VITE_API_BASE_URL=/api` ใช้ path เดียวกับโดเมนอยู่แล้ว (ตั้งใจให้ผ่าน reverse proxy origin เดียวกัน)

## 8. สร้างตารางฐานข้อมูลและข้อมูลตั้งต้น (รันครั้งเดียวตอนติดตั้งใหม่)

```bash
cd /www/wwwroot/appoint.yourclinic.go.th/api
npm run db:migrate   # สร้างฐานข้อมูล/ตารางทั้งหมดจากศูนย์ (idempotent รันซ้ำได้ไม่พัง)
npm run db:seed      # ใส่รายการหัตถการและทันตแพทย์จริงของคลินิก (idempotent เช่นกัน)
```

ทุกครั้งที่ดึงโค้ดเวอร์ชันใหม่ที่มีการแก้ schema ให้รัน `npm run db:migrate` ซ้ำได้เสมอ (ปลอดภัย ไม่ลบข้อมูลเดิม) ส่วน `db:seed` รันซ้ำได้แต่จะไม่ทับข้อมูลที่แก้ไขในหน้าเว็บแล้ว

## 9. รัน API ด้วย aaPanel Node.js Project Manager

ในเมนู aaPanel ที่มากับปลั๊กอิน Node.js Version Manager จะมีเมนูย่อย **"Node project"**:

1. **Add Node project**
2. **Project directory**: `/www/wwwroot/appoint.yourclinic.go.th/api`
3. **Startup file**: `dist/server.js`
4. **Node version**: 20.x
5. **Port**: `3001` (ต้องตรงกับ `API_PORT` ใน `.env`)
6. **Startup mode**: `npm run start` หรือชี้ตรงไปที่ `node dist/server.js` ก็ได้ (`start` script ใน `package.json` เป็นตัวเดียวกัน)
7. กด **Start** — เช็ค log ในหน้าเดียวกันว่าเห็นข้อความ `Clinic appointment API running at http://localhost:3001` ไม่มี error

ถ้า aaPanel เวอร์ชันที่ใช้ไม่มีเมนูนี้ ใช้ PM2 ตรงผ่าน Terminal แทนได้:

```bash
cd /www/wwwroot/appoint.yourclinic.go.th/api
pm2 start dist/server.js --name dental-appoint-api
pm2 save
pm2 startup   # ทำตามคำสั่งที่ pm2 พิมพ์ออกมา เพื่อให้ auto-start ตอนเครื่อง reboot
```

## 10. ตั้งค่า Nginx (reverse proxy + serve frontend)

ไปที่ **Website → [โดเมนของคุณ] → Config file** ใน aaPanel แล้วเพิ่ม/แก้ไข block ต่อไปนี้ในส่วน `server { ... }` (เก็บ block SSL ที่ aaPanel สร้างให้ไว้ตามเดิม เพิ่มแค่ส่วนนี้เข้าไป):

```nginx
    client_max_body_size 10m;   # อัปโหลดรูปทันตแพทย์/สลิป/ไฟล์ตารางเวรได้ถึง 5MB ต่อไฟล์

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    root /www/wwwroot/appoint.yourclinic.go.th/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;   # จำเป็นสำหรับ React Router (SPA) ไม่ให้ refresh หน้าใน /staff/* แล้วเจอ 404
    }
```

จุดที่มักพลาด:
- **`location /api/` ต้องมี `/` ปิดท้าย** ให้ตรงกับ `proxy_pass http://127.0.0.1:3001` (ไม่มี path ต่อท้าย) — Nginx จะส่ง path ต่อจาก `/api/` ไปที่ Node ตรงๆ ซึ่งตรงกับที่โค้ด mount ทุก route ไว้ที่ `/api/...` อยู่แล้ว
- **`root` ต้องชี้ที่ `frontend/dist` ไม่ใช่ `frontend/`** (ไม่งั้นจะเจอหน้า Vite dev หรือ 403)
- ห้ามลืม `try_files ... /index.html` ไม่งั้นการ refresh หน้า `/staff/queue`, `/appointment` ฯลฯ จะได้ 404 จาก Nginx เพราะไฟล์เหล่านี้ไม่มีอยู่จริงบนดิสก์ (React Router จัดการฝั่ง client)

กด **Save** แล้ว **Reload Nginx** (ปุ่มอยู่แถบบนของ aaPanel หรือ `nginx -s reload`)

## 11. เปิด HTTPS (บังคับก่อนใช้งานจริง)

1. แท็บ **SSL** ของเว็บไซต์ในเว็บ aaPanel → เลือก **Let's Encrypt** → apply (ต้องมี DNS ชี้โดเมนมาที่เซิร์ฟเวอร์นี้แล้ว)
2. เปิด **Force HTTPS**
3. กลับไปแก้ `api/.env`: ตั้ง `COOKIE_SECURE=true`
4. ถ้าเปิด SSO ใด ๆ ไว้ (ข้อ 6) ตรวจว่า `MOPH_REDIRECT_URI` / `THAID_REDIRECT_URI` เป็น `https://` ตรงกับโดเมนจริงแบบ byte-to-byte แล้วไปอัปเดต callback URL ที่ลงทะเบียนไว้กับผู้ให้บริการ (moph.id.th / ThaiID) ให้ตรงกันด้วย
5. รีสตาร์ท Node project (ข้อ 9) ให้อ่านค่า `.env` ใหม่

> **สำคัญ**: ห้ามตั้ง `COOKIE_SECURE=true` ก่อนมี HTTPS จริง เพราะ browser จะไม่ยอมรับ cookie ที่มีแฟล็ก `Secure` บน HTTP ธรรมดา ทำให้ล็อกอินทุกชนิด (ผู้ป่วยและเจ้าหน้าที่) ใช้งานไม่ได้ทันที

## 12. เงื่อนไขก่อนเปิด `AUTH_MODE=provider` ให้เจ้าหน้าที่ใช้จริง

ระบบออกแบบให้ผู้ใช้ ProviderID **รายใหม่ทุกคน** (รวมคนแรก) ถูกสร้างเป็น `PENDING_APPROVAL` เสมอ เข้าได้แค่หน้ารออนุมัติ — ต้องมีขั้นตอน bootstrap คนแรกด้วยมือ:

1. ตั้ง `AUTH_MODE=provider` และ `PROVIDER_CLIENT_ID/SECRET` ให้ครบตามข้อ 6 แล้ว restart Node project
2. ให้ผู้ที่จะเป็น IT Staff คนแรก ล็อกอินผ่านปุ่ม "ลงชื่อเข้าใช้ด้วย Provider ID" หนึ่งครั้ง — ระบบจะสร้างบัญชีเป็น `CLINIC_STAFF` + `PENDING_APPROVAL` และพาไปหน้ารออนุมัติ
3. เข้า **Database → phpMyAdmin** (หรือ Terminal) ของ aaPanel รันคำสั่งนี้เพื่อโปรโมทให้เป็นผู้ดูแลระบบ:

   ```sql
   USE clinic_appoint_db;
   SELECT id, display_name, department, role, approval_status FROM staff_users;  -- หา id ของบัญชีที่เพิ่งล็อกอิน
   UPDATE staff_users SET role = 'IT_STAFF', approval_status = 'APPROVED' WHERE id = <ใส่ id ที่เจอ>;
   ```

4. ให้ผู้ใช้กด "ตรวจสอบสถานะอีกครั้ง" ในหน้ารออนุมัติ (หรือ refresh) — ควรถูกพาไปหน้า `/staff/system-settings` ทันที
5. จากนั้นใช้หน้า **ผู้ใช้งาน** (Users) ในระบบเพื่ออนุมัติเจ้าหน้าที่คนถัดไปได้ตามปกติ ไม่ต้องแตะฐานข้อมูลตรงอีก

## 13. หลังติดตั้งเสร็จ — สิ่งที่ต้องตั้งค่าในหน้าเว็บ (ไม่ใช่ `.env`)

- **ตั้งค่าระบบ → MOPH Alert**: กรอก client-key/secret-key ที่ได้จากการลงทะเบียน morprompt แล้วเปิดสวิตช์ให้ระบบส่งแจ้งเตือนยืนยัน/ยกเลิกนัดอัตโนมัติ
- **ตั้งค่าระบบ → รูปแบบการจอง / ประเภทคลินิก**: ตั้งค่าตามการทำงานจริงของคลินิก (มีในระบบอยู่แล้วตั้งแต่ seed แต่ควรตรวจอีกครั้ง)
- **ทะเบียนทันตแพทย์**: อัปโหลดรูปจริงแทนรายชื่อที่ seed มาให้ตอนติดตั้ง (ข้อ 8) ถ้าต้องการ

## 14. อัปเดตเวอร์ชันครั้งถัดไป

```bash
cd /www/wwwroot/appoint.yourclinic.go.th
git pull

cd api && npm ci && npm run build && npm run db:migrate
cd ../frontend && npm ci && npm run build

# รีสตาร์ท Node project ผ่านหน้า aaPanel (หรือ `pm2 restart dental-appoint-api` ถ้าใช้ PM2 ตรง)
```

Nginx ไม่ต้องแก้ไขอะไรเพิ่ม (อ่านไฟล์ static ใหม่จาก `frontend/dist` ที่ build ทับอัตโนมัติ)

## 15. Checklist ความปลอดภัยก่อนเปิดใช้จริง

- [ ] `api/.env` ไม่มีค่า `DB_PASSWORD=root` หรือค่า default อื่นจาก `.env.example` หลงเหลืออยู่
- [ ] `COOKIE_SECURE=true` และเว็บไซต์บังคับ HTTPS แล้วจริง
- [ ] พอร์ต `3001` (Node API) และ `3306` (MySQL) **ไม่เปิดออกอินเทอร์เน็ต** — ในแท็บ **Security/Firewall** ของ aaPanel เปิดเฉพาะ 80/443 เท่านั้น ให้ Nginx เป็นทางเข้าเดียว
- [ ] มีบัญชี `IT_STAFF` + `APPROVED` อย่างน้อย 1 บัญชีแล้ว ก่อนประกาศให้เจ้าหน้าที่คนอื่นเข้าใช้งานจริง (ข้อ 12)
- [ ] ตั้ง backup ฐานข้อมูลอัตโนมัติผ่านเมนู **Database → Backup** ของ aaPanel (ตารางเก็บข้อมูลผู้ป่วย/นัดหมายจริง)
- [ ] โฟลเดอร์ `api/uploads/` (รูปทันตแพทย์ + สลิปโอนเงิน) รวมอยู่ในแผน backup ด้วย ไม่ใช่แค่ฐานข้อมูล

## 16. แก้ปัญหาเบื้องต้น

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| เข้าเว็บแล้วเจอหน้า Nginx default หรือ 404 | `root` ใน Nginx config ไม่ได้ชี้ไปที่ `frontend/dist` หรือยังไม่ได้ `npm run build` ฝั่ง frontend |
| Refresh หน้า `/staff/...` หรือ `/appointment` แล้วเจอ 404 | ลืมใส่ `try_files $uri $uri/ /index.html;` ในข้อ 10 |
| เรียก `/api/...` แล้วได้ 502 Bad Gateway | Node project ยังไม่ได้ start หรือ crash ไปแล้ว — เช็ค log ในหน้า Node project ของ aaPanel |
| ล็อกอินไม่ติด (กดแล้วเด้งกลับหน้าเดิมเงียบๆ) | `COOKIE_SECURE=true` ทั้งที่ยังไม่มี HTTPS จริง หรือโดเมน frontend/API ไม่ตรงกัน (ดูข้อ 1) |
| อัปโหลดไฟล์รูป/สลิป/ตารางเวรไม่ได้ ขึ้น 413 | ยังไม่ได้ตั้ง `client_max_body_size 10m;` ใน Nginx (ข้อ 10) |
| ProviderID/HealthID/ThaiID ล็อกอินแล้ว error เรื่อง redirect/state ไม่ตรง | `MOPH_REDIRECT_URI`/`THAID_REDIRECT_URI` ใน `.env` กับที่ลงทะเบียนไว้กับผู้ให้บริการไม่ตรงกันแบบ byte-to-byte (เช่น มี trailing slash เกิน) |
