// ---------------------------------------------------------------------------
// วันหยุดนักขัตฤกษ์ไทยจาก Google Calendar ICS สาธารณะ (ไม่ต้องใช้ API key)
// อ้างอิง GOOGLEHOLIDAY.md — ปฏิทินไทยเป็นตัวหลักเพราะได้ชื่อวันหยุดภาษาไทย
// และถอยไปใช้ปฏิทินอังกฤษตามเอกสารเดิมเมื่อดึงตัวแรกไม่สำเร็จ
// ---------------------------------------------------------------------------

export type ThaiHoliday = { date: string; name: string };
export type HolidaySource = 'google' | 'fallback';

const calendarIds = ['th.th#holiday@group.v.calendar.google.com', 'en.th#holiday@group.v.calendar.google.com'];
const icsUrl = (calendarId: string) => `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
/** ICS แยกวันหยุดจริงออกจาก "วันสำคัญ/Observance" (วาเลนไทน์, ตรุษจีน, คริสต์มาส) ด้วย DESCRIPTION */
const publicHolidayDescriptions = ['วันหยุดนักขัตฤกษ์', 'public holiday'];
/** วันแรงงานไม่ใช่วันหยุดราชการ จึงไม่นับเป็นวันหยุดของคลินิกในเวลาราชการ (ดู GOOGLEHOLIDAY.md ข้อ 1) */
const excludedMonthDays = ['05-01'];
const cacheTtlMs = 1000 * 60 * 60 * 24;
const fallbackRetryMs = 1000 * 60 * 60;
const fetchTimeoutMs = 10_000;

/** ข้อมูลสำรองเมื่อเครือข่ายไม่พร้อม — ควรตรวจและอัปเดตทุกต้นปี */
const fallbackHolidays: Record<number, string[]> = {
  2025: ['0101', '0102', '0212', '0406', '0413', '0414', '0415', '0504', '0512', '0513', '0603', '0710', '0711', '0728', '0812', '1013', '1023', '1205', '1210', '1231'],
  2026: ['0101', '0102', '0303', '0406', '0413', '0414', '0415', '0504', '0513', '0531', '0601', '0603', '0728', '0729', '0812', '1013', '1023', '1205', '1207', '1210', '1231'],
};

function unescapeIcsText(value: string) {
  return value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

/** แปลงข้อความ ICS เป็นรายการวันหยุด โดยคลี่บรรทัดที่ถูกพับ (line folding) ก่อนเสมอ */
export function parseHolidayIcs(icsText: string): ThaiHoliday[] {
  const unfolded = icsText.replace(/\r?\n[ \t]/g, '');
  const holidays = new Map<string, string>();
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const start = block.match(/[\r\n]DTSTART(?:;[^:\r\n]*)?:(\d{4})(\d{2})(\d{2})/);
    if (!start) continue;
    const description = unescapeIcsText(block.match(/[\r\n]DESCRIPTION:([^\r\n]*)/)?.[1] ?? '').toLowerCase();
    if (!publicHolidayDescriptions.some((prefix) => description.startsWith(prefix))) continue;
    const [, year, month, day] = start;
    if (excludedMonthDays.includes(`${month}-${day}`)) continue;
    const date = `${year}-${month}-${day}`;
    if (!holidays.has(date)) holidays.set(date, unescapeIcsText(block.match(/[\r\n]SUMMARY:([^\r\n]*)/)?.[1] ?? '') || 'วันหยุดนักขัตฤกษ์');
  }
  return [...holidays.entries()].map(([date, name]) => ({ date, name })).sort((left, right) => left.date.localeCompare(right.date));
}

function staticHolidays(): ThaiHoliday[] {
  return Object.entries(fallbackHolidays).flatMap(([year, monthDays]) => monthDays
    .filter((monthDay) => !excludedMonthDays.includes(`${monthDay.slice(0, 2)}-${monthDay.slice(2)}`))
    .map((monthDay) => ({ date: `${year}-${monthDay.slice(0, 2)}-${monthDay.slice(2)}`, name: 'วันหยุดนักขัตฤกษ์' })));
}

let holidayCache: { holidays: ThaiHoliday[]; fetchedAt: number; source: HolidaySource } | null = null;

export function resetThaiHolidayCache() { holidayCache = null; }

/** ดึงวันหยุดทั้งหมดครั้งเดียวแล้วแคช 24 ชั่วโมง (ถ้าใช้ข้อมูลสำรองจะ retry ใหม่ใน 1 ชั่วโมง) */
export async function getThaiHolidays(): Promise<{ holidays: ThaiHoliday[]; source: HolidaySource }> {
  const ttl = holidayCache?.source === 'google' ? cacheTtlMs : fallbackRetryMs;
  if (holidayCache && Date.now() - holidayCache.fetchedAt < ttl) return { holidays: holidayCache.holidays, source: holidayCache.source };
  for (const calendarId of calendarIds) {
    try {
      const response = await fetch(icsUrl(calendarId), { cache: 'no-store', signal: AbortSignal.timeout(fetchTimeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const holidays = parseHolidayIcs(await response.text());
      if (!holidays.length) throw new Error('ICS ไม่มีวันหยุดนักขัตฤกษ์');
      holidayCache = { holidays, fetchedAt: Date.now(), source: 'google' };
      return { holidays, source: 'google' };
    } catch (error) {
      console.error(`[holidays] ดึงปฏิทิน ${calendarId} ไม่สำเร็จ:`, error instanceof Error ? error.message : error);
    }
  }
  console.warn('[holidays] ใช้ข้อมูลวันหยุดสำรองแบบ static');
  holidayCache = { holidays: staticHolidays(), fetchedAt: Date.now(), source: 'fallback' };
  return { holidays: holidayCache.holidays, source: 'fallback' };
}

/** วันหยุดเฉพาะเดือน `YYYY-MM` พร้อมเลขวันที่ เพื่อใช้แรเงาในตารางเวรและไฟล์ต้นแบบ */
export async function getThaiHolidaysForMonth(month: string): Promise<{ holidays: (ThaiHoliday & { day: number })[]; source: HolidaySource }> {
  const { holidays, source } = await getThaiHolidays();
  return { holidays: holidays.filter((holiday) => holiday.date.startsWith(`${month}-`)).map((holiday) => ({ ...holiday, day: Number(holiday.date.slice(8)) })), source };
}
