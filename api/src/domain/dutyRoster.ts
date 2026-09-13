export type DutyMark = { day: number; mark: string };
export type DutyRosterRow = { sequenceNo: number | null; name: string; days: DutyMark[] };
export type ParsedDutyRoster = { title: string; detectedMonth: string | null; rows: DutyRosterRow[]; skippedNames: string[]; warnings: string[] };

const thaiMonths = [
  ['มกราคม', 'ม.ค.'], ['กุมภาพันธ์', 'ก.พ.'], ['มีนาคม', 'มี.ค.'], ['เมษายน', 'เม.ย.'],
  ['พฤษภาคม', 'พ.ค.'], ['มิถุนายน', 'มิ.ย.'], ['กรกฎาคม', 'ก.ค.'], ['สิงหาคม', 'ส.ค.'],
  ['กันยายน', 'ก.ย.'], ['ตุลาคม', 'ต.ค.'], ['พฤศจิกายน', 'พ.ย.'], ['ธันวาคม', 'ธ.ค.'],
] as const;

const footerPattern = /^(รวม|ลงชื่อ|ลงนาม|หมายเหตุ|ผู้จัดทำ|ผู้ตรวจ|ผู้อนุมัติ|หัวหน้า|จัดทำโดย|ตรวจสอบ|\()/;
const honorificPattern = /^(ทันตแพทย์หญิง|ทันตแพทย์|ทพญ\.|ทพ\.|ทญ\.|นพ\.|พญ\.|นางสาว|นาย|นาง|น\.ส\.|ดร\.|ผศ\.|รศ\.|ศ\.)\s*/;
/** คำนำหน้าที่ถือว่าเป็นทันตแพทย์ เรียงจากยาวไปสั้นเพื่อให้จับคำที่ยาวที่สุดก่อน */
const dentistHonorifics = ['ทันตแพทย์หญิง', 'ทันตแพทย์', 'ทพญ.', 'ทพญ', 'ทพ.', 'ทญ.', 'ทพ'];

export function daysInMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

export function dutyDate(month: string, day: number) {
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** 'YYYY-MM' (ค.ศ.) -> 'กันยายน 2569' สำหรับหัวตารางและชื่อชีตของไฟล์ต้นแบบ */
export function thaiMonthLabel(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${thaiMonths[monthNumber - 1]?.[0] ?? month} ${year + 543}`;
}

/** รับเฉพาะรายชื่อที่ขึ้นต้นด้วยคำนำหน้าทันตแพทย์ เพื่อไม่ให้เจ้าหน้าที่ประเภทอื่นในตารางเวรถูกนำเข้า */
export function isDentistName(value: string) {
  const compact = value.replace(/\s+/g, '');
  const honorific = dentistHonorifics.find((prefix) => compact.startsWith(prefix));
  return honorific !== undefined && compact.length > honorific.length;
}

/** ตัดคำนำหน้าและช่องว่างออก เพื่อจับคู่ชื่อจาก Excel กับทะเบียนทันตแพทย์ */
export function normalizeDentistName(value: string) {
  return value.replace(/\s+/g, ' ').trim().replace(honorificPattern, '').replace(/\s+/g, '').toLowerCase();
}

export function matchDentist<T extends { id: number; displayName: string }>(name: string, dentists: T[]) {
  const normalized = normalizeDentistName(name);
  if (!normalized) return null;
  return dentists.find((dentist) => normalizeDentistName(dentist.displayName) === normalized) ?? null;
}

/** อ่าน "ประจำเดือน กันยายน 2569" หรือ "09/2569" ให้เป็น YYYY-MM ตามปี ค.ศ. */
export function detectMonth(text: string): string | null {
  const flattened = text.replace(/\s+/g, ' ');
  let monthIndex = -1;
  let monthEnd = 0;
  thaiMonths.forEach(([full, abbreviation], index) => {
    if (monthIndex >= 0) return;
    const position = flattened.indexOf(full) >= 0 ? flattened.indexOf(full) + full.length : flattened.indexOf(abbreviation) >= 0 ? flattened.indexOf(abbreviation) + abbreviation.length : -1;
    if (position >= 0) { monthIndex = index; monthEnd = position; }
  });
  if (monthIndex < 0) {
    const numeric = flattened.match(/(?:^|[^\d])(0?[1-9]|1[0-2])\s*[/-]\s*((?:19|20|25)\d{2})(?!\d)/);
    if (!numeric) return null;
    return `${toChristianYear(Number(numeric[2]))}-${String(Number(numeric[1])).padStart(2, '0')}`;
  }
  const year = flattened.slice(monthEnd).match(/((?:19|20|25)\d{2})(?!\d)/) ?? flattened.match(/((?:19|20|25)\d{2})(?!\d)/);
  if (!year) return null;
  return `${toChristianYear(Number(year[1]))}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function toChristianYear(year: number) {
  return year >= 2400 ? year - 543 : year;
}

function cellText(grid: string[][], row: number, column: number) {
  return (grid[row]?.[column] ?? '').trim();
}

/** หาแถวหัวตาราง = แถวที่มีเลขวัน 1..31 เรียงกันอย่างน้อย 20 ช่อง */
function findHeaderRow(grid: string[][]) {
  for (let row = 0; row < Math.min(grid.length, 40); row += 1) {
    const dayColumns = new Map<number, number>();
    (grid[row] ?? []).forEach((value, column) => {
      const day = Number(String(value ?? '').trim());
      if (Number.isInteger(day) && day >= 1 && day <= 31 && !dayColumns.has(day)) dayColumns.set(day, column);
    });
    const ascending = [...dayColumns.keys()].filter((day, index, days) => index === 0 || day === days[index - 1] + 1);
    if (dayColumns.has(1) && ascending.length >= 20) return { row, dayColumns };
  }
  return null;
}

function findNameColumn(grid: string[][], headerRow: number, firstDayColumn: number) {
  const labelled = (grid[headerRow] ?? []).findIndex((value, column) => column < firstDayColumn && /ชื่อ/.test(String(value ?? '')));
  if (labelled >= 0) return labelled;
  let bestColumn = 0;
  let bestScore = 0;
  for (let column = 0; column < firstDayColumn; column += 1) {
    let score = 0;
    for (let row = headerRow + 1; row < Math.min(grid.length, headerRow + 40); row += 1) {
      const value = cellText(grid, row, column);
      if (value.length > 3 && Number.isNaN(Number(value))) score += 1;
    }
    if (score > bestScore) { bestScore = score; bestColumn = column; }
  }
  return bestColumn;
}

function findSequenceColumn(grid: string[][], headerRow: number, nameColumn: number) {
  const labelled = (grid[headerRow] ?? []).findIndex((value, column) => column < nameColumn && /ลำดับ|ที่|no\.?/i.test(String(value ?? '')));
  return labelled >= 0 ? labelled : nameColumn > 0 ? nameColumn - 1 : -1;
}

export function parseDutyRosterGrid(grid: string[][]): ParsedDutyRoster {
  const warnings: string[] = [];
  const header = findHeaderRow(grid);
  if (!header) return { title: '', detectedMonth: null, rows: [], skippedNames: [], warnings: ['ไม่พบแถวหัวตารางที่มีเลขวันที่ 1–31 กรุณาตรวจรูปแบบไฟล์'] };

  // ExcelJS คืนค่าของ cell แม่ให้ทุก cell ที่ถูก merge หัวตารางที่ merge ข้ามคอลัมน์จึงซ้ำหลายสิบครั้ง
  const titleText = grid.slice(0, header.row)
    .map((row) => row.filter(Boolean).filter((value, index, values) => value !== values[index - 1]).join(' '))
    .filter(Boolean).join(' ').replace(/\.{2,}/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, 255);
  const detectedMonth = detectMonth(titleText);
  if (!detectedMonth) warnings.push('อ่านเดือน/ปีจากหัวตารางไม่ได้ กรุณาเลือกเดือนที่ต้องการบันทึกด้วยตนเอง');
  const monthLength = detectedMonth ? daysInMonth(detectedMonth) : 31;

  const dayColumns = [...header.dayColumns.entries()].sort((left, right) => left[0] - right[0]);
  const firstDayColumn = Math.min(...dayColumns.map(([, column]) => column));
  const nameColumn = findNameColumn(grid, header.row, firstDayColumn);
  const sequenceColumn = findSequenceColumn(grid, header.row, nameColumn);

  const rows: DutyRosterRow[] = [];
  const skippedNames: string[] = [];
  const seenNames = new Set<string>();
  let blankStreak = 0;
  let droppedOutOfRange = 0;
  for (let row = header.row + 1; row < grid.length; row += 1) {
    const name = cellText(grid, row, nameColumn).replace(/\s+/g, ' ');
    if (!name) { blankStreak += 1; if (blankStreak >= 8) break; continue; }
    blankStreak = 0;
    if (name.length < 2 || footerPattern.test(name)) continue;
    if (!isDentistName(name)) { if (!skippedNames.includes(name)) skippedNames.push(name); continue; }
    const sequenceValue = sequenceColumn >= 0 ? Number(cellText(grid, row, sequenceColumn)) : Number.NaN;
    const days: DutyMark[] = [];
    for (const [day, column] of dayColumns) {
      const mark = cellText(grid, row, column);
      if (!mark) continue;
      if (day > monthLength) { droppedOutOfRange += 1; continue; }
      days.push({ day, mark: mark.slice(0, 16) });
    }
    const normalized = normalizeDentistName(name);
    if (seenNames.has(normalized)) warnings.push(`พบชื่อซ้ำในไฟล์: ${name}`);
    seenNames.add(normalized);
    if (!days.length) warnings.push(`${name} ไม่มีวันลงเวรในไฟล์นี้`);
    rows.push({ sequenceNo: Number.isInteger(sequenceValue) && sequenceValue > 0 ? sequenceValue : null, name, days });
  }

  if (droppedOutOfRange) warnings.push(`ข้ามเครื่องหมาย ${droppedOutOfRange} ช่อง เพราะอยู่เกินจำนวนวันของเดือนที่เลือก`);
  if (skippedNames.length) warnings.push(`ข้าม ${skippedNames.length} รายชื่อที่ไม่ใช่ทันตแพทย์: ${skippedNames.join(', ')}`);
  if (!rows.length) warnings.push('ไม่พบรายชื่อทันตแพทย์ใต้แถวหัวตาราง (ระบบนำเข้าเฉพาะชื่อที่ขึ้นต้นด้วย ทพ. หรือ ทพญ. เท่านั้น)');
  return { title: titleText, detectedMonth, rows, skippedNames, warnings };
}

/** ช่วงวันจันทร์–อาทิตย์ของสัปดาห์ปัจจุบัน (UTC) ใช้แสดงตารางเวรรายสัปดาห์บนหน้าเว็บสาธารณะ */
export function currentWeekRange(reference = new Date()) {
  const dayOfWeek = reference.getUTCDay();
  const offsetToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate() - offsetToMonday));
  const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6));
  const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);
  return { start: toIsoDate(monday), end: toIsoDate(sunday) };
}
