import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import { currentWeekRange, daysInMonth, detectMonth, isDentistName, matchDentist, normalizeDentistName, parseDutyRosterGrid, thaiMonthLabel } from './dutyRoster.js';
import { buildDutyRosterTemplate, readDutyRosterGrid } from '../services/dutyRosterExcel.js';

const headerRow = ['ลำดับ', 'ชื่อ - สกุล', ...Array.from({ length: 31 }, (_, index) => String(index + 1))];

function rosterGrid(overrides: string[][] = []) {
  return [
    ['', 'ตารางปฏิบัติงานสำหรับเจ้าหน้าที่ (ในเวลาราชการ)'],
    ['', 'คลินิกรูปแบบพิเศษ Premium Clinic โรงพยาบาลวังทอง ประจำเดือน ....กันยายน.....2569.....'],
    [],
    headerRow,
    ['1', 'ทพญ.นิศา ทองนพคุณ', ...Array.from({ length: 31 }, (_, index) => (index + 1 === 17 ? '/' : ''))],
    ['2', 'ทพ.จรูญพันธ์ อธิกชัย', ...Array.from({ length: 31 }, (_, index) => ([14, 28].includes(index + 1) ? '/' : ''))],
    ...overrides,
  ];
}

describe('detectMonth', () => {
  it('อ่านเดือนไทยและแปลง พ.ศ. เป็น ค.ศ.', () => {
    expect(detectMonth('ประจำเดือน ....กันยายน.....2569.....')).toBe('2026-09');
    expect(detectMonth('ประจำเดือน ม.ค. 2570')).toBe('2027-01');
    expect(detectMonth('ประจำเดือน ธันวาคม 2026')).toBe('2026-12');
    expect(detectMonth('รอบ 09/2569')).toBe('2026-09');
  });

  it('คืน null เมื่อไม่พบเดือนหรือปี', () => {
    expect(detectMonth('ตารางปฏิบัติงานสำหรับเจ้าหน้าที่')).toBeNull();
    expect(detectMonth('ประจำเดือน กันยายน')).toBeNull();
  });
});

describe('normalizeDentistName / matchDentist', () => {
  const dentists = [
    { id: 3, displayName: 'ทพญ.นิศา ทองนพคุณ' },
    { id: 4, displayName: 'ทพ.จรูญพันธ์ อธิกชัย' },
  ];

  it('จับคู่ได้แม้คำนำหน้าและช่องว่างต่างกัน', () => {
    expect(normalizeDentistName('ทพญ. นิศา  ทองนพคุณ')).toBe(normalizeDentistName('ทพญ.นิศา ทองนพคุณ'));
    expect(matchDentist('ทพญ. นิศา ทองนพคุณ', dentists)?.id).toBe(3);
    expect(matchDentist('จรูญพันธ์ อธิกชัย', dentists)?.id).toBe(4);
  });

  it('จับคู่ได้เมื่อไฟล์เขียนคำนำหน้าแบบเต็ม', () => {
    expect(matchDentist('ทันตแพทย์หญิงนิศา ทองนพคุณ', dentists)?.id).toBe(3);
    expect(matchDentist('ทันตแพทย์ จรูญพันธ์ อธิกชัย', dentists)?.id).toBe(4);
  });

  it('คืน null เมื่อไม่มีชื่อในทะเบียน', () => {
    expect(matchDentist('ทพ.สมชาย ใจดี', dentists)).toBeNull();
  });
});

describe('parseDutyRosterGrid', () => {
  it('อ่านเดือน รายชื่อ และวันลงเวรจากตารางรูปแบบเดียวกับไฟล์ของคลินิก', () => {
    const parsed = parseDutyRosterGrid(rosterGrid());
    expect(parsed.detectedMonth).toBe('2026-09');
    expect(parsed.title).toContain('Premium Clinic');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({ sequenceNo: 1, name: 'ทพญ.นิศา ทองนพคุณ' });
    expect(parsed.rows[0].days.map((day) => day.day)).toEqual([17]);
    expect(parsed.rows[1].days.map((day) => day.day)).toEqual([14, 28]);
    expect(parsed.warnings).toHaveLength(0);
  });

  it('นำเข้าเฉพาะทันตแพทย์ และรายงานรายชื่อเจ้าหน้าที่อื่นที่ถูกข้าม', () => {
    const parsed = parseDutyRosterGrid(rosterGrid([
      ['3', 'นางสาวสมหญิง ใจดี', ...Array.from({ length: 31 }, (_, index) => (index + 1 === 9 ? '/' : ''))],
      ['4', 'ผู้ช่วยทันตแพทย์ สมศรี', ...Array.from({ length: 31 }, () => '')],
      ['5', 'ทันตาภิบาล สมปอง', ...Array.from({ length: 31 }, (_, index) => (index + 1 === 11 ? '/' : ''))],
      ['6', 'ทพญ.วิจิตรา ลิ้มตระกูล', ...Array.from({ length: 31 }, (_, index) => (index + 1 === 19 ? '/' : ''))],
    ]));

    expect(parsed.rows.map((row) => row.name)).toEqual(['ทพญ.นิศา ทองนพคุณ', 'ทพ.จรูญพันธ์ อธิกชัย', 'ทพญ.วิจิตรา ลิ้มตระกูล']);
    expect(parsed.skippedNames).toEqual(['นางสาวสมหญิง ใจดี', 'ผู้ช่วยทันตแพทย์ สมศรี', 'ทันตาภิบาล สมปอง']);
    expect(parsed.warnings).toContain('ข้าม 3 รายชื่อที่ไม่ใช่ทันตแพทย์: นางสาวสมหญิง ใจดี, ผู้ช่วยทันตแพทย์ สมศรี, ทันตาภิบาล สมปอง');
  });

  it('เตือนอย่างชัดเจนเมื่อไฟล์ไม่มีรายชื่อทันตแพทย์เลย', () => {
    const parsed = parseDutyRosterGrid(rosterGrid().map((row, index) => index === 4 || index === 5 ? [String(index - 3), `นางสาวเจ้าหน้าที่ ${index}`, ...Array.from({ length: 31 }, () => '')] : row));

    expect(parsed.rows).toHaveLength(0);
    expect(parsed.warnings.some((warning) => warning.includes('ระบบนำเข้าเฉพาะชื่อที่ขึ้นต้นด้วย ทพ. หรือ ทพญ.'))).toBe(true);
  });

  it('ข้ามแถวท้ายตารางและเตือนเมื่อไม่มีวันลงเวร', () => {
    const parsed = parseDutyRosterGrid(rosterGrid([
      ['3', 'ทพญ.วิจิตรา ลิ้มตระกูล', ...Array.from({ length: 31 }, () => '')],
      ['', 'ลงชื่อ....................ผู้จัดทำ'],
    ]));
    expect(parsed.rows.map((row) => row.name)).toEqual(['ทพญ.นิศา ทองนพคุณ', 'ทพ.จรูญพันธ์ อธิกชัย', 'ทพญ.วิจิตรา ลิ้มตระกูล']);
    expect(parsed.warnings).toContain('ทพญ.วิจิตรา ลิ้มตระกูล ไม่มีวันลงเวรในไฟล์นี้');
  });

  it('ตัดเครื่องหมายที่เกินจำนวนวันของเดือน', () => {
    const grid = rosterGrid();
    grid[1] = ['', 'ประจำเดือน กุมภาพันธ์ 2569'];
    grid[4] = ['1', 'ทพญ.นิศา ทองนพคุณ', ...Array.from({ length: 31 }, (_, index) => ([3, 30].includes(index + 1) ? '/' : ''))];
    const parsed = parseDutyRosterGrid(grid);
    expect(parsed.detectedMonth).toBe('2026-02');
    expect(parsed.rows[0].days.map((day) => day.day)).toEqual([3]);
    expect(parsed.warnings.some((warning) => warning.includes('เกินจำนวนวันของเดือน'))).toBe(true);
  });

  it('เตือนเมื่อไม่พบแถวหัวตารางวันที่', () => {
    const parsed = parseDutyRosterGrid([['ตารางเวร'], ['ลำดับ', 'ชื่อ - สกุล', 'จันทร์', 'อังคาร']]);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.warnings[0]).toContain('ไม่พบแถวหัวตาราง');
  });
});

describe('หัวตารางที่ merge ข้ามคอลัมน์', () => {
  it('ไม่ทำให้ title ยาวเกินจนบันทึกไม่ได้ และยังอ่านเดือนได้', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('กันยายน 2569');
    worksheet.mergeCells(1, 1, 1, 33);
    worksheet.getCell(1, 1).value = 'ตารางปฏิบัติงานสำหรับเจ้าหน้าที่ (ในเวลาราชการ)';
    worksheet.mergeCells(2, 1, 2, 33);
    worksheet.getCell(2, 1).value = 'คลินิกรูปแบบพิเศษ Premium Clinic โรงพยาบาลวังทอง ประจำเดือน ....กันยายน.....2569.....';
    worksheet.getRow(4).values = ['ลำดับ', 'ชื่อ - สกุล', ...Array.from({ length: 31 }, (_, index) => index + 1)];
    worksheet.getRow(5).values = ['1', 'ทพญ.นิศา ทองนพคุณ', ...Array.from({ length: 31 }, (_, index) => (index + 1 === 17 ? '/' : ''))];

    const { grid } = await readDutyRosterGrid(Buffer.from(await workbook.xlsx.writeBuffer()));
    const parsed = parseDutyRosterGrid(grid);

    expect(parsed.detectedMonth).toBe('2026-09');
    expect(parsed.title.length).toBeLessThanOrEqual(255);
    expect(parsed.title).toBe('ตารางปฏิบัติงานสำหรับเจ้าหน้าที่ (ในเวลาราชการ) คลินิกรูปแบบพิเศษ Premium Clinic โรงพยาบาลวังทอง ประจำเดือน กันยายน 2569');
    expect(parsed.rows[0].days.map((day) => day.day)).toEqual([17]);
  });
});

describe('ทันตแพทย์ที่ไม่มีเวรในเดือน', () => {
  it('ยังถูกนำเข้าเป็นสมาชิกของทะเบียน พร้อมเตือนให้ตรวจสอบ', () => {
    const parsed = parseDutyRosterGrid(rosterGrid([
      ['3', 'ทพญ.วิจิตรา ลิ้มตระกูล', ...Array.from({ length: 31 }, () => '')],
    ]));

    expect(parsed.rows.map((row) => ({ name: row.name, days: row.days.length }))).toEqual([
      { name: 'ทพญ.นิศา ทองนพคุณ', days: 1 },
      { name: 'ทพ.จรูญพันธ์ อธิกชัย', days: 2 },
      { name: 'ทพญ.วิจิตรา ลิ้มตระกูล', days: 0 },
    ]);
    expect(parsed.warnings).toContain('ทพญ.วิจิตรา ลิ้มตระกูล ไม่มีวันลงเวรในไฟล์นี้');
  });
});

describe('isDentistName', () => {
  it('รับเฉพาะคำนำหน้าของทันตแพทย์', () => {
    ['ทพญ.นิศา ทองนพคุณ', 'ทพ. ณัฐวุฒิ ยิ้มแย้ม', 'ทพญ นิศา', 'ทันตแพทย์หญิงวนิดา ใจดี', 'ทญ.สมหญิง รักงาน'].forEach((name) => {
      expect(isDentistName(name)).toBe(true);
    });
  });

  it('ปฏิเสธเจ้าหน้าที่ประเภทอื่น', () => {
    ['นางสาวสมหญิง ใจดี', 'นาย สมชาย ขยัน', 'ผู้ช่วยทันตแพทย์ สมศรี', 'ทันตาภิบาล สมปอง', 'นพ.สมคิด รักษาดี', 'พญ.มาลี ใจงาม', 'จนท.ธุรการ', 'ทพ.', 'ทพญ.'].forEach((name) => {
      expect(isDentistName(name)).toBe(false);
    });
  });
});

describe('daysInMonth', () => {
  it('นับจำนวนวันรวมปีอธิกสุรทิน', () => {
    expect(daysInMonth('2026-09')).toBe(30);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
  });
});

describe('readDutyRosterGrid', () => {
  it('อ่านไฟล์ .xlsx จริงแล้ว parse เป็นทะเบียนลงเวรได้', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('เวรกันยายน');
    rosterGrid().forEach((row) => worksheet.addRow(row));
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const { sheetName, grid } = await readDutyRosterGrid(buffer);
    expect(sheetName).toBe('เวรกันยายน');
    const parsed = parseDutyRosterGrid(grid);
    expect(parsed.detectedMonth).toBe('2026-09');
    expect(parsed.rows.map((row) => row.name)).toEqual(['ทพญ.นิศา ทองนพคุณ', 'ทพ.จรูญพันธ์ อธิกชัย']);
    expect(parsed.rows[1].days).toEqual([{ day: 14, mark: '/' }, { day: 28, mark: '/' }]);
  });
});

describe('thaiMonthLabel', () => {
  it('แสดงเดือนไทยพร้อมปี พ.ศ.', () => {
    expect(thaiMonthLabel('2026-09')).toBe('กันยายน 2569');
    expect(thaiMonthLabel('2027-01')).toBe('มกราคม 2570');
  });
});

describe('buildDutyRosterTemplate', () => {
  const dentists = [{ displayName: 'ทพญ.นิศา ทองนพคุณ' }, { displayName: 'ทพ.จรูญพันธ์ อธิกชัย' }];

  it('สร้างไฟล์ต้นแบบที่ระบบอ่านเดือนและรายชื่อกลับมาได้', async () => {
    const { sheetName, grid } = await readDutyRosterGrid(await buildDutyRosterTemplate('2026-09', dentists, 0));

    expect(sheetName).toBe('กันยายน 2569');
    const parsed = parseDutyRosterGrid(grid);
    expect(parsed.detectedMonth).toBe('2026-09');
    expect(parsed.rows.map((row) => row.name)).toEqual(['ทพญ.นิศา ทองนพคุณ', 'ทพ.จรูญพันธ์ อธิกชัย']);
    expect(parsed.rows.every((row) => row.days.length === 0)).toBe(true);
  });

  it('ใส่เลขวันเท่าจำนวนวันจริงของเดือน และเว้นแถวว่างให้เพิ่มชื่อได้', async () => {
    const { grid } = await readDutyRosterGrid(await buildDutyRosterTemplate('2027-02', dentists, 3));
    const header = grid.find((row) => row[0] === 'ลำดับ') ?? [];

    expect(header.slice(2).filter(Boolean)).toHaveLength(28);
    expect(header[header.length - 1]).toBe('28');
    expect(grid.some((row) => row[0] === '5' && !row[1])).toBe(true);
  });

  it('แรเงาวันหยุดนักขัตฤกษ์ด้วยสีส้ม ใส่ชื่อวันหยุดเป็น note และสรุปไว้ท้ายตาราง', async () => {
    const holidays = [
      { date: '2026-10-13', day: 13, name: 'วันคล้ายวันสวรรคต ร.9' },
      { date: '2026-10-23', day: 23, name: 'วันปิยมหาราช' },
    ];
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildDutyRosterTemplate('2026-10', dentists, 0, holidays) as unknown as ArrayBuffer);
    const worksheet = workbook.worksheets[0];
    const fillOf = (day: number) => worksheet.getRow(4).getCell(2 + day).fill as ExcelJS.FillPattern;

    expect(fillOf(13).fgColor?.argb).toBe('FFFFC000');
    expect(fillOf(23).fgColor?.argb).toBe('FFFFC000');
    expect(worksheet.getRow(4).getCell(2 + 13).note).toBe('วันคล้ายวันสวรรคต ร.9');
    expect(fillOf(3).fgColor?.argb).toBe('FFFFFF00');
    expect(fillOf(1).fgColor?.argb).toBe('FFEAF4ED');
    expect(worksheet.getRow(5).getCell(2 + 13).fill as ExcelJS.FillPattern).toMatchObject({ fgColor: { argb: 'FFFFC000' } });

    const legend = String(worksheet.getRow(5 + dentists.length + 3).getCell(2).value);
    expect(legend).toContain('13 วันคล้ายวันสวรรคต ร.9');
    expect(legend).toContain('23 วันปิยมหาราช');
  });

  it('เติมเครื่องหมายลงไฟล์ต้นแบบแล้ว parse กลับมาเป็นวันลงเวรได้', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildDutyRosterTemplate('2026-09', dentists, 0) as unknown as ArrayBuffer);
    const worksheet = workbook.worksheets[0];
    worksheet.getRow(5).getCell(2 + 17).value = '/';
    worksheet.getRow(6).getCell(2 + 14).value = '/';
    worksheet.getRow(6).getCell(2 + 28).value = '/';

    const { grid } = await readDutyRosterGrid(Buffer.from(await workbook.xlsx.writeBuffer()));
    const parsed = parseDutyRosterGrid(grid);
    expect(parsed.rows[0].days.map((day) => day.day)).toEqual([17]);
    expect(parsed.rows[1].days.map((day) => day.day)).toEqual([14, 28]);
    expect(parsed.warnings).toHaveLength(0);
  });
});

describe('currentWeekRange', () => {
  it('คืนวันจันทร์–อาทิตย์ของสัปดาห์ที่มีวันอ้างอิงอยู่ (กลางสัปดาห์)', () => {
    // 2026-09-16 คือวันพุธ
    expect(currentWeekRange(new Date('2026-09-16T10:00:00Z'))).toEqual({ start: '2026-09-14', end: '2026-09-20' });
  });

  it('จับวันจันทร์เป็นต้นสัปดาห์ของตัวเองได้', () => {
    expect(currentWeekRange(new Date('2026-09-14T00:00:00Z'))).toEqual({ start: '2026-09-14', end: '2026-09-20' });
  });

  it('จับวันอาทิตย์ว่าอยู่ท้ายสัปดาห์เดียวกับวันจันทร์ก่อนหน้า ไม่ใช่ต้นสัปดาห์ถัดไป', () => {
    expect(currentWeekRange(new Date('2026-09-20T23:00:00Z'))).toEqual({ start: '2026-09-14', end: '2026-09-20' });
  });

  it('ข้ามเดือนได้ถูกต้องเมื่อสัปดาห์คร่อมสิ้นเดือน', () => {
    // 2026-09-30 คือวันพุธ ของสัปดาห์ 28 ก.ย.–4 ต.ค.
    expect(currentWeekRange(new Date('2026-09-30T00:00:00Z'))).toEqual({ start: '2026-09-28', end: '2026-10-04' });
  });
});
