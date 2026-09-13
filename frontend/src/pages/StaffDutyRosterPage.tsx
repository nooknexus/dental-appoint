import { CalendarCheck2, CalendarRange, Download, ExternalLink, FileSpreadsheet, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { StaffAccessDenied } from '../components/StaffAccessDenied';
import { Toast, useToast } from '../components/Toast';
import { getStaffRole, staffFetch } from '../services/staffAuth';

type DutyMark = { day: number; mark: string };
type PreviewRow = { sequenceNo: number | null; name: string; dentistId: number | null; matchedName: string | null; days: DutyMark[] };
type DentistOption = { id: number; displayName: string; active: boolean };
type ParseResult = { sheetName: string; title: string; detectedMonth: string | null; sourceFileName: string; rows: PreviewRow[]; skippedNames: string[]; warnings: string[]; dentists: DentistOption[] };
type RosterSummary = { month: string; title: string; sourceFileName: string | null; uploadedBy: string; updatedAt: string; memberCount: number; dutyCount: number };
type RosterMember = { id: number; sequenceNo: number | null; name: string; sourceName: string; dentistId: number | null; queuePrefix: string | null; dutyDays: { day: number; date: string; mark: string }[] };
type Holiday = { date: string; day: number; name: string };
type RosterDetail = { roster: { month: string; title: string; sourceFileName: string | null; uploadedBy: string; updatedAt: string; daysInMonth: number }; holidays: Holiday[]; holidaySource: 'google' | 'fallback'; members: RosterMember[] };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
/** ตารางปฏิบัติงานรวมของโรงพยาบาลวังทองบน Google Sheets (เปิดดูอย่างเดียว ไม่ได้เชื่อมต่อกับระบบ) */
const wangthongScheduleUrl = 'https://docs.google.com/spreadsheets/d/1sHMXo4i7UWfFdnKy2k1ULl1zrv_lZn1a/edit?gid=661870771#gid=661870771';
const thaiMonthNames = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const currentMonth = () => new Date().toISOString().slice(0, 7);
const monthLabel = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${thaiMonthNames[monthNumber - 1] ?? month} ${year + 543}`;
};
const isWeekend = (month: string, day: number) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return [0, 6].includes(new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay());
};

type RosterStore = { rosters: RosterSummary[]; detail: RosterDetail | null };
let rosterSnapshot: RosterStore = { rosters: [], detail: null };
let rosterRequested = false;
const rosterSubscribers = new Set<() => void>();

/** โหลดรายการเดือนทั้งหมด พร้อมรายละเอียดของเดือนที่เลือก (ค่าเริ่มต้นคือเดือนล่าสุด) */
async function loadRosterStore(role: string, month?: string) {
  const headers = { 'x-mock-role': role };
  const response = await staffFetch(`${apiBase}/staff/duty-rosters`, { headers });
  if (!response.ok) throw new Error('Unable to load duty rosters');
  const { rosters } = await response.json() as { rosters: RosterSummary[] };
  const target = month ?? rosters[0]?.month;
  let detail: RosterDetail | null = null;
  if (target) {
    const detailResponse = await staffFetch(`${apiBase}/staff/duty-rosters/${target}`, { headers });
    if (detailResponse.ok) detail = await detailResponse.json() as RosterDetail;
  }
  rosterSnapshot = { rosters, detail };
  rosterSubscribers.forEach((subscriber) => subscriber());
}

function subscribeToRosterStore(listener: () => void) {
  rosterSubscribers.add(listener);
  if (!rosterRequested) {
    rosterRequested = true;
    const role = getStaffRole();
    if (role === 'IT_STAFF' || role === 'CLINIC_STAFF') void loadRosterStore(role).catch(() => undefined);
  }
  return () => rosterSubscribers.delete(listener);
}

function getRosterSnapshot() { return rosterSnapshot; }

export function StaffDutyRosterPage() {
  const role = getStaffRole();
  const allowed = role === 'CLINIC_STAFF';
  const fileInput = useRef<HTMLInputElement>(null);
  const { rosters, detail } = useSyncExternalStore(subscribeToRosterStore, getRosterSnapshot, getRosterSnapshot);
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [previewMonth, setPreviewMonth] = useState(currentMonth);
  const [templateMonth, setTemplateMonth] = useState(currentMonth);
  const { toast, notify, dismissToast } = useToast();
  const [busy, setBusy] = useState(false);

  const staffHeaders = useMemo(() => ({ 'x-mock-role': role ?? '' }), [role]);
  const loadRosters = async (month?: string) => {
    try { await loadRosterStore(role ?? '', month); } catch { notify('ไม่สามารถโหลดทะเบียนลงเวรได้', 'error'); }
  };

  if (!allowed) return <StaffAccessDenied />;

  const downloadTemplate = async () => {
    setBusy(true); dismissToast();
    try {
      const response = await staffFetch(`${apiBase}/staff/duty-rosters/template?month=${templateMonth}`, { headers: staffHeaders });
      if (!response.ok) throw new Error('ไม่สามารถสร้างไฟล์ต้นแบบได้');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `duty-roster-${templateMonth}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      notify(`ดาวน์โหลดไฟล์ต้นแบบเดือน${monthLabel(templateMonth)} แล้ว`);
    } catch (error) { notify(error instanceof Error ? error.message : 'ไม่สามารถสร้างไฟล์ต้นแบบได้', 'error'); } finally { setBusy(false); }
  };

  const readFile = async () => {
    const file = fileInput.current?.files?.[0];
    if (!file) { notify('กรุณาเลือกไฟล์ Excel (.xlsx) ก่อน', 'error'); return; }
    setBusy(true); dismissToast();
    try {
      const body = new FormData();
      body.append('roster', file);
      const response = await staffFetch(`${apiBase}/staff/duty-rosters/parse`, { method: 'POST', headers: staffHeaders, body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      const parsed = result as ParseResult;
      setPreview(parsed);
      setPreviewMonth(parsed.detectedMonth ?? currentMonth());
      if (parsed.rows.length) notify(`อ่านไฟล์สำเร็จ พบทันตแพทย์ ${parsed.rows.length} รายชื่อ`);
      else notify('อ่านไฟล์แล้วแต่ไม่พบรายชื่อทันตแพทย์ (ระบบนำเข้าเฉพาะ ทพ./ทพญ.)', 'error');
    } catch (error) { notify(error instanceof Error && error.message ? error.message : 'อ่านไฟล์ Excel ไม่สำเร็จ', 'error'); } finally { setBusy(false); }
  };

  const changeRowDentist = (index: number, dentistId: number | null) => setPreview((current) => current && ({
    ...current,
    rows: current.rows.map((row, rowIndex) => rowIndex === index ? { ...row, dentistId } : row),
  }));

  const save = async () => {
    if (!preview) return;
    setBusy(true); dismissToast();
    try {
      const response = await staffFetch(`${apiBase}/staff/duty-rosters`, {
        method: 'POST',
        headers: { ...staffHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: previewMonth, title: preview.title, sourceFileName: preview.sourceFileName, rows: preview.rows.map((row) => ({ sequenceNo: row.sequenceNo, name: row.name, dentistId: row.dentistId, days: row.days })) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      notify(result.message);
      setPreview(null);
      if (fileInput.current) fileInput.current.value = '';
      await loadRosters(previewMonth);
    } catch (error) { notify(error instanceof Error && error.message ? error.message : 'บันทึกทะเบียนลงเวรไม่สำเร็จ', 'error'); } finally { setBusy(false); }
  };

  const remove = async (month: string) => {
    setBusy(true);
    try {
      const response = await staffFetch(`${apiBase}/staff/duty-rosters/${month}`, { method: 'DELETE', headers: staffHeaders });
      const result = await response.json();
      notify(result.message ?? 'ลบทะเบียนลงเวรแล้ว');
      await loadRosters();
    } catch { notify('ลบทะเบียนลงเวรไม่สำเร็จ', 'error'); } finally { setBusy(false); }
  };

  const dutyDays = detail ? Array.from({ length: detail.roster.daysInMonth }, (_, index) => index + 1) : [];
  const holidayByDay = new Map((detail?.holidays ?? []).map((holiday) => [holiday.day, holiday.name]));
  const dayClassName = (month: string, day: number) => holidayByDay.has(day) ? 'duty-grid__holiday' : isWeekend(month, day) ? 'duty-grid__weekend' : undefined;
  const dentistCountByDay = new Map<number, number>();
  detail?.members.forEach((member) => member.dutyDays.forEach((duty) => dentistCountByDay.set(duty.day, (dentistCountByDay.get(duty.day) ?? 0) + 1)));
  const totalDutyCount = detail?.members.reduce((sum, member) => sum + member.dutyDays.length, 0) ?? 0;

  return <section className="staff-page"><div className="container">
    <p className="eyebrow">Staff · Duty Roster</p>
    <h1>ทะเบียนลงเวรทันตแพทย์</h1>
    <p>อัปโหลดตารางปฏิบัติงานรายเดือนจากไฟล์ Excel ระบบจะอ่านเครื่องหมายในตารางแล้วสร้างวันลงเวรของทันตแพทย์แต่ละคนให้อัตโนมัติ</p>

    <section className="user-admin-card duty-reference">
      <div className="user-admin-card__heading"><CalendarRange size={25} /><div><h2>ตารางแพทย์วังทอง</h2><small>ตารางปฏิบัติงานรวมของโรงพยาบาลวังทองบน Google Sheets ใช้ตรวจสอบเวรก่อนบันทึกเข้าทะเบียน</small></div></div>
      <p className="duty-reference__notice"><i className="duty-legend__swatch duty-legend__swatch--swap" /> <span>ช่องที่เป็น<b> สีแดง </b>ในตารางแพทย์วังทอง คือเวรที่<b>มีการแลกเวร</b> เจ้าหน้าที่คลินิกโปรดตรวจสอบก่อนใช้งาน</span></p>
      <a className="button button--ghost" href={wangthongScheduleUrl} rel="noopener noreferrer" target="_blank"><ExternalLink size={17} /> ดูตารางแพทย์วังทอง</a>
    </section>

    <section className="user-admin-card">
      <div className="user-admin-card__heading"><FileSpreadsheet size={25} /><div><h2>อัปโหลดตารางเวรรายเดือน</h2><small>รองรับไฟล์ .xlsx ที่มีคอลัมน์ชื่อ-สกุล และหัวตารางเลขวันที่ 1–31 ขนาดไม่เกิน 5 MB · นำเข้าเฉพาะรายชื่อที่ขึ้นต้นด้วย ทพ. หรือ ทพญ.</small></div></div>
      <div className="duty-upload">
        <input aria-label="ไฟล์ตารางเวร Excel" accept=".xlsx,.xlsm" ref={fileInput} type="file" />
        <button className="button" disabled={busy} type="button" onClick={() => void readFile()}><Upload size={17} /> อ่านไฟล์</button>
      </div>
      <div className="duty-template">
        <div><b>ยังไม่มีไฟล์ตารางเวร?</b><span>ดาวน์โหลดไฟล์ต้นแบบที่มีเลขวันครบตามเดือน แรเงาวันเสาร์-อาทิตย์ และเติมรายชื่อทันตแพทย์ที่เปิดใช้งานไว้ให้แล้ว</span></div>
        <div className="duty-template__actions">
          <label htmlFor="duty-template-month">เดือนของไฟล์ต้นแบบ<input id="duty-template-month" type="month" value={templateMonth} onChange={(event) => setTemplateMonth(event.target.value || currentMonth())} /></label>
          <button className="button button--ghost" disabled={busy} type="button" onClick={() => void downloadTemplate()}><Download size={17} /> ดาวน์โหลดไฟล์ต้นแบบ</button>
        </div>
      </div>
    </section>

    {preview && <section className="user-admin-card">
      <div className="user-admin-card__heading"><CalendarCheck2 size={25} /><div><h2>ตรวจสอบก่อนบันทึก</h2><small>{preview.sourceFileName} · ชีต {preview.sheetName} · ทันตแพทย์ {preview.rows.length} รายชื่อ{preview.skippedNames.length ? ` · ข้ามผู้ที่ไม่ใช่ทันตแพทย์ ${preview.skippedNames.length} รายชื่อ` : ''}</small></div></div>
      {preview.skippedNames.length > 0 && <details className="duty-skipped"><summary>ระบบนำเข้าเฉพาะ ทพ./ทพญ. — ข้าม {preview.skippedNames.length} รายชื่อ</summary><ul>{preview.skippedNames.map((name) => <li key={name}>{name}</li>)}</ul></details>}
      {preview.warnings.length > 0 && <ul className="duty-warnings">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      <div className="duty-preview-fields">
        <label htmlFor="duty-month">เดือนที่บันทึก<input id="duty-month" type="month" value={previewMonth} onChange={(event) => setPreviewMonth(event.target.value || currentMonth())} /></label>
        <span className="duty-preview-fields__hint">บันทึกเป็นทะเบียนเดือน <b>{monthLabel(previewMonth)}</b> · หากมีทะเบียนเดือนนี้อยู่แล้วจะถูกแทนที่</span>
      </div>
      <div className="staff-table-wrap"><table><thead><tr><th>ลำดับ</th><th>ชื่อในไฟล์</th><th>จับคู่ทะเบียนทันตแพทย์</th><th>จำนวนวัน</th><th>วันที่ลงเวร</th></tr></thead><tbody>
        {preview.rows.map((row, index) => <tr key={`${row.name}-${index}`}>
          <td>{row.sequenceNo ?? index + 1}</td>
          <td><b>{row.name}</b></td>
          <td><select aria-label={`จับคู่ทันตแพทย์สำหรับ ${row.name}`} value={row.dentistId ?? ''} onChange={(event) => changeRowDentist(index, event.target.value ? Number(event.target.value) : null)}>
            <option value="">— ไม่จับคู่ (เก็บชื่อจากไฟล์) —</option>
            {preview.dentists.map((dentist) => <option key={dentist.id} value={dentist.id}>{dentist.displayName}{dentist.active ? '' : ' (ปิดใช้งาน)'}</option>)}
          </select></td>
          <td>{row.days.length}</td>
          <td><div className="duty-day-chips">{row.days.map((day) => <span key={day.day}>{day.day}</span>)}</div></td>
        </tr>)}
      </tbody></table></div>
      <button className="button" disabled={busy || !preview.rows.length} type="button" onClick={() => void save()}>บันทึกเข้าทะเบียนลงเวร</button>
    </section>}

    <section className="user-admin-card">
      <div className="user-admin-card__heading"><CalendarCheck2 size={25} /><div><h2>ทะเบียนลงเวรที่บันทึกไว้</h2><small>{rosters.length ? `${rosters.length} เดือน` : 'ยังไม่มีทะเบียนลงเวร'}</small></div></div>
      <div className="duty-roster-list">{rosters.map((roster) => <article key={roster.month} className={detail?.roster.month === roster.month ? 'duty-roster-list__item duty-roster-list__item--active' : 'duty-roster-list__item'}>
        <div><b>{monthLabel(roster.month)}</b><span>ทันตแพทย์ {roster.memberCount} คน · วันลงเวรรวม {roster.dutyCount} ครั้ง · แก้ไขล่าสุด {roster.updatedAt}</span></div>
        <div className="duty-roster-list__actions">
          <button className="button button--small" disabled={busy} type="button" onClick={() => void loadRosters(roster.month)}>ดูตาราง</button>
          <button className="button button--small" disabled={busy} type="button" onClick={() => void remove(roster.month)}><Trash2 size={15} /> ลบ</button>
        </div>
      </article>)}</div>
    </section>

    {detail && <section className="user-admin-card">
      <div className="user-admin-card__heading"><CalendarCheck2 size={25} /><div><h2>ตารางลงเวรเดือน{monthLabel(detail.roster.month)}</h2><small>{detail.roster.title || detail.roster.sourceFileName || 'ตารางปฏิบัติงานทันตแพทย์'}</small></div></div>
      <div className="staff-table-wrap duty-grid-wrap"><table><thead><tr>
        <th>ลำดับ</th><th>ทันตแพทย์</th>
        {dutyDays.map((day) => <th key={day} className={dayClassName(detail.roster.month, day)} title={holidayByDay.get(day)}>{day}</th>)}
        <th>รวม</th>
      </tr></thead><tbody>
        {detail.members.map((member, index) => {
          const marks = new Map(member.dutyDays.map((duty) => [duty.day, duty.mark]));
          return <tr key={member.id}>
            <td>{member.sequenceNo ?? index + 1}</td>
            <td><b>{member.name}</b>{member.dentistId ? null : <><br /><small>ยังไม่จับคู่ทะเบียน</small></>}</td>
            {dutyDays.map((day) => <td key={day} className={['duty-grid__cell', dayClassName(detail.roster.month, day)].filter(Boolean).join(' ')}>{marks.get(day) ?? ''}</td>)}
            <td><b>{member.dutyDays.length}</b></td>
          </tr>;
        })}
      </tbody><tfoot><tr className="duty-grid__summary">
        <td colSpan={2}>ทันตแพทย์ลงเวรต่อวัน</td>
        {dutyDays.map((day) => <td key={day} className={['duty-grid__cell', dayClassName(detail.roster.month, day)].filter(Boolean).join(' ')}>{dentistCountByDay.get(day) ?? 0}</td>)}
        <td><b>{totalDutyCount}</b></td>
      </tr></tfoot></table></div>
      <div className="duty-legend">
        <span><i className="duty-legend__swatch duty-legend__swatch--weekend" /> วันเสาร์-อาทิตย์</span>
        <span><i className="duty-legend__swatch duty-legend__swatch--holiday" /> วันหยุดนักขัตฤกษ์{detail.holidaySource === 'fallback' ? ' (ข้อมูลสำรอง — ต่อ Google Calendar ไม่ได้)' : ''}</span>
        {detail.holidays.length ? <small>{detail.holidays.map((holiday) => `${holiday.day} ${holiday.name}`).join(' · ')}</small> : <small>เดือนนี้ไม่มีวันหยุดนักขัตฤกษ์</small>}
      </div>
    </section>}
    <Toast onDismiss={dismissToast} toast={toast} />
  </div></section>;
}
