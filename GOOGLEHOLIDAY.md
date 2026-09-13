---
name: google-holiday-ics
description: "การพัฒนาระบบเชื่อมต่อวันหยุดของ Google Calendar ICS โดยไม่ต้องใช้ API Key"
---

# Google Holiday ICS Integration

ระบบนี้ทำหน้าที่ดึงข้อมูลวันหยุดนักขัตฤกษ์ของประเทศไทยจาก Google Calendar สาธารณะ (Public Calendar) ในรูปแบบไฟล์ ICS (.ics) เพื่อนำมาใช้ตรวจสอบวันหยุดในระบบ WFH/Attendance โดยไม่ต้องใช้ Google API Key หรือการยืนยันตัวตน (Authentication)

## Current Project Shape

ไฟล์หลักที่เกี่ยวข้องกับการจัดการวันหยุด:

- **Utility:** `src/server/utils/holidays.ts` - จัดการการดึงข้อมูล (Fetch), การแยกส่วนข้อมูล (Parse), การเก็บแคช (Cache), และข้อมูลสำรอง (Fallback)
- **Integration:** ถูกนำไปใช้ใน `src/server/routers/attendance.ts` เพื่อคำนวณวันทำงานและตรวจสอบความล่าช้า

## Configuration

ระบบใช้ปฏิทินสาธารณะของ Google:

- **Calendar ID:** `en.th#holiday@group.v.calendar.google.com`
- **ICS URL:** `https://calendar.google.com/calendar/ical/en.th%23holiday%40group.v.calendar.google.com/public/basic.ics`

## Implementation Logic

### 1. การดึงข้อมูล (Fetching)
ใช้ `fetch` มาตรฐานของ Node.js พร้อมกำหนด `AbortSignal.timeout(10_000)` เพื่อป้องกันการค้างกรณีเครือข่ายมีปัญหา และใช้ `cache: "no-store"` เพื่อให้แน่ใจว่าได้ข้อมูลที่อัปเดตเสมอ

### 2. การแยกส่วนข้อมูล (Parsing)
เนื่องจากต้องการลดการใช้ Dependency ที่ซับซ้อน (เช่น `node-ical` ซึ่งอาจมีปัญหากับ BigInt ในบางสภาพแวดล้อม) ระบบจึงใช้ Regex พื้นฐานในการดึง `DTSTART` จาก `VEVENT` บล็อก:

```typescript
function parseICS(icsText: string): Date[] {
  const holidays: Date[] = [];
  const blocks = icsText.split("BEGIN:VEVENT");
  for (let i = 1; i < blocks.length; i++) {
    const dtStartMatch = blocks[i].match(/DTSTART(?:;[^:]+)?:([^\r\n]+)/);
    if (dtStartMatch) {
      const parsed = parseICSDateString(dtStartMatch[1].trim());
      if (parsed) {
        // กรองวันหยุดที่ไม่ใช่เทศกาลทั่วไปออกได้ที่นี่
        holidays.push(parsed);
      }
    }
  }
  return holidays;
}
```

### 3. ระบบแคช (Cache Mechanism)
ข้อมูลวันหยุดจะถูกเก็บไว้ใน In-memory cache เป็นเวลา **24 ชั่วโมง** (`CACHE_TTL_MS`) เพื่อลดจำนวน HTTP Request

### 4. ระบบสำรอง (Fallback System)
หากไม่สามารถดึงข้อมูลจาก Google ได้ ระบบจะดึงข้อมูลจาก `THAI_HOLIDAYS_FALLBACK` ซึ่งเป็นข้อมูล Static ที่กำหนดไว้ล่วงหน้าในไฟล์ `holidays.ts`

## Usage Examples

### การตรวจสอบวันหยุด
สามารถใช้ฟังก์ชัน `getThaiHolidaysForRange` เพื่อดึงรายการวันหยุดในช่วงวันที่ต้องการ:

```typescript
import { getThaiHolidaysForRange, isHoliday } from '@/server/utils/holidays';

const start = new Date('2026-01-01');
const end = new Date('2026-12-31');

// ดึงรายการวันหยุดทั้งหมดในปี 2026
const holidays = await getThaiHolidaysForRange(start, end);

// ตรวจสอบว่าวันนี้เป็นวันหยุดหรือไม่
const today = new Date();
if (isHoliday(today, holidays)) {
  console.log("วันนี้เป็นวันหยุดนักขัตฤกษ์");
}
```

## Rules & Best Practices

1. **Labor Day Check:** ในโค้ดปัจจุบันมีการยกเว้นวันแรงงาน (1 พฤษภาคม) สำหรับการคำนวณบางประเภท หากต้องการรวมวันแรงงาน ต้องแก้ไขในฟังก์ชัน `parseICS`
2. **Local Time Handling:** ในการ Parse วันที่จาก ICS (`YYYYMMDD`) ต้องระวังเรื่อง Timezone Shift ระบบปัจจุบันใช้ `startOfDay(new Date(yr, mo - 1, dy))` เพื่อให้เป็นเวลาต้นวันตามเวลาท้องถิ่น
3. **Fallback Updates:** ควรตรวจสอบและอัปเดต `THAI_HOLIDAYS_FALLBACK` ทุกต้นปีเพื่อให้แน่ใจว่าระบบยังทำงานได้แม้ไม่มีอินเทอร์เน็ต

## Troubleshooting

- **ICS Fetch Failed:** ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตของเซิร์ฟเวอร์ หรือ URL ของ Google Calendar อาจมีการเปลี่ยนแปลง
- **Incorrect Holiday Dates:** Google Calendar อาจมีการปรับปรุงวันหยุดชดเชยช้ากว่าประกาศทางการ ให้ตรวจสอบแคชและรอการอัปเดต หรือใช้ Fallback เป็นหลัก
- **Memory Usage:** เนื่องจากแคชเป็นแบบ In-memory หากมีการรันหลาย Instance (เช่น ใน Cluster Mode) แต่ละ Instance จะมีแคชของตัวเอง
