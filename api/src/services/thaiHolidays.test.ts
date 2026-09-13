import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getThaiHolidays, getThaiHolidaysForMonth, parseHolidayIcs, resetThaiHolidayCache } from './thaiHolidays.js';

function icsEvent(date: string, summary: string, description: string) {
  return `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${date}\r\nDTEND;VALUE=DATE:${date}\r\nDESCRIPTION:${description}\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\n`;
}

const sampleIcs = ['BEGIN:VCALENDAR\r\n',
  icsEvent('20261013', 'วันคล้ายวันสวรรคต ร.9', 'วันหยุดนักขัตฤกษ์'),
  icsEvent('20261023', 'วันปิยมหาราช', 'วันหยุดนักขัตฤกษ์'),
  icsEvent('20260214', 'วันวาเลนไทน์', 'วันสำคัญ\\nหากต้องการซ่อนวันสำคัญ\\, ไปที่การตั้งค่า'),
  icsEvent('20260501', 'วันแรงงานแห่งชาติ', 'วันหยุดนักขัตฤกษ์'),
  icsEvent('20261013', 'ซ้ำ', 'วันหยุดนักขัตฤกษ์'),
  'END:VCALENDAR\r\n'].join('');

beforeEach(() => { resetThaiHolidayCache(); });
afterEach(() => { vi.unstubAllGlobals(); resetThaiHolidayCache(); });

describe('parseHolidayIcs', () => {
  it('เก็บเฉพาะวันหยุดนักขัตฤกษ์ ตัดวันสำคัญ วันแรงงาน และวันซ้ำออก', () => {
    expect(parseHolidayIcs(sampleIcs)).toEqual([
      { date: '2026-10-13', name: 'วันคล้ายวันสวรรคต ร.9' },
      { date: '2026-10-23', name: 'วันปิยมหาราช' },
    ]);
  });

  it('รองรับ DESCRIPTION ภาษาอังกฤษของปฏิทินสำรอง', () => {
    expect(parseHolidayIcs(icsEvent('20261023', 'Chulalongkorn Day', 'Public holiday'))).toEqual([{ date: '2026-10-23', name: 'Chulalongkorn Day' }]);
  });

  it('คลี่บรรทัดที่ถูกพับและถอด escape ของ ICS', () => {
    const folded = 'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261205\r\nDESCRIPTION:วันหยุดนักขัตฤกษ์\r\nSUMMARY:วันคล้ายวันพระบรมราชสมภพ\\, \r\n วันชาติ\r\nEND:VEVENT\r\n';
    expect(parseHolidayIcs(folded)).toEqual([{ date: '2026-12-05', name: 'วันคล้ายวันพระบรมราชสมภพ, วันชาติ' }]);
  });

  it('คืนรายการว่างเมื่อ ICS ไม่มี VEVENT', () => {
    expect(parseHolidayIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toEqual([]);
  });
});

describe('getThaiHolidays', () => {
  it('ดึงจากปฏิทินไทยเป็นตัวแรกแล้วแคชไว้ ไม่ยิงซ้ำ', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(sampleIcs, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await getThaiHolidays();
    const second = await getThaiHolidays();

    expect(first.source).toBe('google');
    expect(first.holidays).toHaveLength(2);
    expect(second.holidays).toEqual(first.holidays);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('th.th%23holiday');
  });

  it('ถอยไปใช้ปฏิทินอังกฤษเมื่อปฏิทินแรกล้มเหลว', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(new Response(icsEvent('20261023', 'Chulalongkorn Day', 'Public holiday'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getThaiHolidays();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('en.th%23holiday');
    expect(result).toEqual({ source: 'google', holidays: [{ date: '2026-10-23', name: 'Chulalongkorn Day' }] });
  });

  it('ใช้ข้อมูลสำรองเมื่อดึงทั้งสองปฏิทินไม่สำเร็จ', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));

    const result = await getThaiHolidays();

    expect(result.source).toBe('fallback');
    expect(result.holidays.map((holiday) => holiday.date)).toContain('2026-10-23');
    expect(result.holidays.map((holiday) => holiday.date)).not.toContain('2026-05-01');
  });
});

describe('getThaiHolidaysForMonth', () => {
  it('กรองเฉพาะเดือนที่ขอ พร้อมเลขวันสำหรับแรเงาตาราง', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(sampleIcs, { status: 200 })));

    expect(await getThaiHolidaysForMonth('2026-10')).toEqual({
      source: 'google',
      holidays: [
        { date: '2026-10-13', day: 13, name: 'วันคล้ายวันสวรรคต ร.9' },
        { date: '2026-10-23', day: 23, name: 'วันปิยมหาราช' },
      ],
    });
    expect((await getThaiHolidaysForMonth('2026-09')).holidays).toEqual([]);
  });
});
