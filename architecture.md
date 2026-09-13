# Architecture: Phahol Appoint

## สถาปัตยกรรมระบบ (System Architecture)
โปรเจคนี้ใช้สถาปัตยกรรมแบบ **Monolithic Full-stack** บนพื้นฐานของ Node.js โดยรวมเอาทั้ง Frontend (React) และ Backend (Express) ไว้ในโปรเจคเดียวกัน (Single Repository) เพื่อความสะดวกในการพัฒนาและ Deploy

ในการทำงานโหมด Production, Frontend จะถูก Build เป็น Static Files (`dist/`) และถูกเสิร์ฟผ่าน Express Backend (Vite Middleware ในโหมด Dev และ Static File Serving ในโหมด Prod)

## เทคโนโลยี (Tech Stack)

### 1. Frontend (ฝั่งผู้ใช้งาน)
* **Framework:** React 19 (ใช้ Functional Components และ Hooks)
* **Bundler & Build Tool:** Vite 8
* **Routing:** React Router v7
* **Styling:** Tailwind CSS v4 (Utility-first CSS)
* **UI Components/Icons:** `lucide-react` (สำหรับไอคอน), `recharts` (สำหรับทำกราฟแสดงสถิติ)
* **Animations:** `framer-motion` และ `motion`

### 2. Backend (ฝั่งเซิร์ฟเวอร์)
* **Runtime:** Node.js
* **Framework:** Express.js v5
* **Build Tool:** `esbuild` (สำหรับรวมโค้ดฝั่ง Backend เป็นไฟล์ `dist/server.cjs` ไฟล์เดียว)
* **Environment Management:** `dotenv`

### 3. Database (ฐานข้อมูล)
* **Database Engine:** SQLite (ผ่านไลบรารี `better-sqlite3`)
* **Storage:** จัดเก็บข้อมูลลงไฟล์ Local (`database.sqlite`) โดยตรง ทำให้ไม่ต้องตั้งค่า Database Server แยกต่างหาก เหมาะกับสเกลของโปรเจคและการนำไปติดตั้งที่ง่ายดาย

---

## โครงสร้างฐานข้อมูล (Database Schema)

ระบบประกอบด้วยตาราง (Tables) หลักดังนี้:

1. **`clinics` (คลินิก/แผนก)**
   - จัดเก็บข้อมูลแผนก เช่น คลินิกอายุรกรรม, คลินิกศัลยกรรม
   - กำหนดเวลาทำการและโควต้าสูงสุดต่อวัน
2. **`exam_rooms` (ห้องตรวจ)**
   - จัดเก็บข้อมูลห้องตรวจต่างๆ สังกัดคลินิกไหน
   - จัดเก็บ `queuePrefix` (อักษรนำหน้าคิว) สำหรับสร้างหมายเลขคิว
   - จัดเก็บสถานะการทำงาน (พร้อมใช้งาน, ปิดซ่อม, กำลังตรวจ)
3. **`booking_slots` (ช่วงเวลาจอง)**
   - จัดเก็บช่วงเวลาที่เปิดให้จองในแต่ละคลินิก (เช่น 08:30 - 09:30)
   - กำหนดโควต้าสูงสุด (maxQuota) ในแต่ละช่วง
4. **`bookings` (ข้อมูลการจองคิว)**
   - จัดเก็บรายละเอียดของผู้ป่วย, วัน-เวลาที่จอง
   - **`bookingNumber`**: หมายเลขคิวที่ Generate อัตโนมัติ (เช่น MED001)
   - สถานะ (รอพิจารณา, อนุมัติแล้ว, ยกเลิก)
5. **`staff_users` (เจ้าหน้าที่)**
   - จัดเก็บข้อมูลและระดับสิทธิ์การเข้าถึงของบุคลากร (clinic_staff, it_staff)
6. **`questionnaires` (แบบคัดกรอง)**
   - เก็บชุดคำถามที่ผูกกับห้องตรวจต่างๆ

---

## กลไกการทำงานที่สำคัญ (Core Logics)

### 1. Queue Number Generation Logic
ระบบสร้างหมายเลขคิวอยู่ที่ฝั่ง Backend (`server.ts` ใน POST `/api/bookings`)
- **รับค่า Prefix:** เช็คว่าผู้ป่วยจองมาที่ห้องไหน และดึง `queuePrefix` ของห้องนั้นมา (เช่น 'AB')
- **ค้นหาคิวล่าสุด:** ค้นหา `bookingNumber` ล่าสุดที่ขึ้นต้นด้วย Prefix นั้น
- **สกัดตัวเลข (Regex):** ใช้ Regex `/\d+$/` ตัดแยกเอาเฉพาะตัวเลขด้านหลังมาบวก 1 (รองรับทั้งรูปแบบเก่าที่มีขีดกลาง และรูปแบบใหม่ที่ไม่มีขีดกลาง)
- **จัดฟอร์แมต:** ใช้ `.padStart(3, '0')` เพื่อให้ตัวเลขมี 3 หลักเสมอ (เช่น '001', '012')
- **ผลลัพธ์:** ประกอบ Prefix + หมายเลข (เช่น `AB012`)

### 2. Environment & Port Management
- โหมด Development (รันผ่าน `npm run dev`): พอร์ตถูกบังคับให้เป็น 3000 เสมอ เพื่อให้เข้ากับระบบ AI Studio Preview
- โหมด Production (รันไฟล์ `dist/server.cjs`): สามารถรับค่าพอร์ตจากระบบ (เช่น `PORT=3005`) ผ่านตัวแปร Environment ได้ เพื่อให้สามารถทำงานร่วมกับ Process Manager อย่าง PM2 ได้อย่างอิสระ
