import ExcelJS from 'exceljs';

import { daysInMonth, thaiMonthLabel } from '../domain/dutyRoster.js';
import type { ThaiHoliday } from './thaiHolidays.js';

function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if ('result' in value) return cellToText(value.result as ExcelJS.CellValue);
    if ('text' in value) return String(value.text);
    if ('error' in value) return '';
  }
  return '';
}

/** แปลง worksheet แรกที่มีข้อมูลเป็นตาราง 2 มิติของข้อความ เพื่อส่งต่อให้ parseDutyRosterGrid */
export async function readDutyRosterGrid(buffer: Buffer): Promise<{ sheetName: string; grid: string[][] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet = workbook.worksheets.find((sheet) => sheet.rowCount > 1) ?? workbook.worksheets[0];
  if (!worksheet) throw new Error('ไฟล์ Excel นี้ไม่มีชีตข้อมูล');
  const grid: string[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => { values[columnNumber - 1] = cellToText(cell.value); });
    grid[rowNumber - 1] = values;
  });
  for (let index = 0; index < grid.length; index += 1) grid[index] ??= [];
  return { sheetName: worksheet.name, grid };
}

const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF4ED' } };
const weekendFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
const holidayFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
const thinBorder: Partial<ExcelJS.Borders> = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

/** สร้างไฟล์ต้นแบบของเดือนที่เลือก: หัวตารางเลขวันตามจำนวนวันจริง แรเงาเสาร์-อาทิตย์ และเติมรายชื่อทันตแพทย์ให้ */
export async function buildDutyRosterTemplate(month: string, dentists: { displayName: string }[], blankRows = 5, holidays: (ThaiHoliday & { day: number })[] = []): Promise<Buffer> {
  const holidayByDay = new Map(holidays.map((holiday) => [holiday.day, holiday.name]));
  const [year, monthNumber] = month.split('-').map(Number);
  const dayCount = daysInMonth(month);
  const lastColumn = 2 + dayCount;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sasook Premium Dental Clinic';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(thaiMonthLabel(month), {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  worksheet.mergeCells(1, 1, 1, lastColumn);
  worksheet.getCell(1, 1).value = 'ตารางปฏิบัติงานสำหรับเจ้าหน้าที่ (ในเวลาราชการ)';
  worksheet.mergeCells(2, 1, 2, lastColumn);
  worksheet.getCell(2, 1).value = `คลินิกรูปแบบพิเศษ Premium Clinic โรงพยาบาลวังทอง ประจำเดือน ....${thaiMonthLabel(month)}.....`;
  worksheet.mergeCells(3, 1, 3, lastColumn);
  worksheet.getCell(3, 1).value = 'วิธีกรอก: ใส่เครื่องหมาย / ในช่องวันที่ลงเวรของแต่ละท่าน ช่องที่ไม่ได้ลงเวรให้เว้นว่าง (ห้ามแก้ไขแถวหัวตารางและคอลัมน์ชื่อ-สกุล)';
  [1, 2].forEach((rowNumber) => {
    const cell = worksheet.getCell(rowNumber, 1);
    cell.font = { bold: true, size: rowNumber === 1 ? 16 : 14 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  worksheet.getCell(3, 1).font = { italic: true, size: 10, color: { argb: 'FF6B7A71' } };
  worksheet.getCell(3, 1).alignment = { horizontal: 'center' };

  const headerRow = worksheet.getRow(4);
  headerRow.values = ['ลำดับ', 'ชื่อ - สกุล', ...Array.from({ length: dayCount }, (_, index) => index + 1)];
  headerRow.height = 22;
  headerRow.eachCell((cell, columnNumber) => {
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder;
    const headerDay = columnNumber - 2;
    const headerHoliday = columnNumber > 2 ? holidayByDay.get(headerDay) : undefined;
    if (headerHoliday) {
      cell.fill = holidayFill;
      cell.note = headerHoliday;
    } else cell.fill = columnNumber > 2 && isWeekendDay(year, monthNumber, headerDay) ? weekendFill : headerFill;
  });

  const names = [...dentists.map((dentist) => dentist.displayName), ...Array.from({ length: blankRows }, () => '')];
  names.forEach((name, index) => {
    const row = worksheet.getRow(5 + index);
    row.values = [index + 1, name];
    for (let column = 1; column <= lastColumn; column += 1) {
      const cell = row.getCell(column);
      cell.border = thinBorder;
      if (column === 1) cell.alignment = { horizontal: 'center' };
      if (column > 2) {
        cell.alignment = { horizontal: 'center' };
        if (holidayByDay.has(column - 2)) cell.fill = holidayFill;
        else if (isWeekendDay(year, monthNumber, column - 2)) cell.fill = weekendFill;
      }
    }
  });

  worksheet.getColumn(1).width = 7;
  worksheet.getColumn(2).width = 30;
  for (let column = 3; column <= lastColumn; column += 1) worksheet.getColumn(column).width = 4;

  const signatureRow = worksheet.getRow(5 + names.length + 1);
  signatureRow.getCell(2).value = 'ลงชื่อ....................................ผู้จัดทำ';
  const legendRow = worksheet.getRow(5 + names.length + 3);
  legendRow.getCell(2).value = holidays.length
    ? `หมายเหตุ: ช่องสีเหลืองคือวันเสาร์-อาทิตย์ ช่องสีส้มคือวันหยุดนักขัตฤกษ์ — ${holidays.map((holiday) => `${holiday.day} ${holiday.name}`).join(', ')}`
    : 'หมายเหตุ: ช่องสีเหลืองคือวันเสาร์-อาทิตย์';
  legendRow.getCell(2).font = { size: 10, color: { argb: 'FF6B7A71' } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function isWeekendDay(year: number, monthNumber: number, day: number) {
  return [0, 6].includes(new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay());
}
