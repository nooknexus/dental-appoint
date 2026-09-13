import { Clock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Toast, useToast } from '../components/Toast';
import { getStaffRole, staffFetch } from '../services/staffAuth';

type PeakWeekdayRow = { dow: number; bookings: number };
type PeakHourRow = { hour: number; bookings: number };
type PeakGridCell = { dow: number; hour: number; bookings: number };
type PeakReport = { byWeekday: PeakWeekdayRow[]; byHour: PeakHourRow[]; grid: PeakGridCell[] };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
/** MySQL DAYOFWEEK: 1=อาทิตย์ … 7=เสาร์ แสดงผลเรียงจันทร์–อาทิตย์ */
const weekdayLabels: Record<number, string> = { 2: 'จันทร์', 3: 'อังคาร', 4: 'พุธ', 5: 'พฤหัสบดี', 6: 'ศุกร์', 7: 'เสาร์', 1: 'อาทิตย์' };
const weekdayOrder = [2, 3, 4, 5, 6, 7, 1];

export function StaffPeakHoursPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<PeakReport | null>(null);
  const { toast, notify, dismissToast } = useToast();
  const role = getStaffRole() === 'IT_STAFF' ? 'IT_STAFF' : 'MANAGER';

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    void staffFetch(`${apiBase}/staff/reports/peak-hours${params.size ? `?${params.toString()}` : ''}`, { headers: { 'x-mock-role': role } }).then(async (response) => {
      if (!response.ok) throw new Error('ไม่สามารถโหลดรายงานช่วงเวลานิยมได้');
      setReport(await response.json() as PeakReport);
    }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'ไม่สามารถโหลดรายงานช่วงเวลานิยมได้', 'error'));
  }, [from, to, role, notify]);

  useEffect(() => { void load(); }, [load]);

  return <section className="staff-page"><div className="container">
    <p className="eyebrow">Manager · Reports</p>
    <h1>ช่วงเวลานิยม</h1>
    <p>นัดหมายที่ยังไม่ยกเลิก จัดกลุ่มตามวันของสัปดาห์และชั่วโมง เพื่อช่วยวางแผนกำลังคน</p>

    <form className="report-filters">
      <label>จากวันที่ (เว้นว่าง = ทุกวัน)<input type="date" aria-label="จากวันที่" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>ถึงวันที่ (เว้นว่าง = ถึงวันนี้)<input type="date" aria-label="ถึงวันที่" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    </form>

    <div className="manager-dashboard-grid">
      <section className="user-admin-card">
        <div className="user-admin-card__heading"><Clock size={25} /><div><h2>ตามวันของสัปดาห์</h2><small>เรียงจากวันที่มีนัดมากที่สุด</small></div></div>
        {report && report.byWeekday.length ? <ol className="ranked-list">
          {report.byWeekday.map((row) => <li key={row.dow}><span className="ranked-list__rank">{report.byWeekday.findIndex((item) => item.dow === row.dow) + 1}</span><span className="ranked-list__label"><b>{weekdayLabels[row.dow] ?? row.dow}</b></span><span className="ranked-list__value">{row.bookings.toLocaleString()} นัด</span></li>)}
        </ol> : <p>{report ? 'ยังไม่มีข้อมูลนัดหมายในช่วงวันที่ที่เลือก' : 'กำลังโหลด...'}</p>}
      </section>

      <section className="user-admin-card">
        <div className="user-admin-card__heading"><Clock size={25} /><div><h2>ตามชั่วโมงนัด</h2><small>ชั่วโมงเริ่มนัด (เวลาไทย)</small></div></div>
        {report && report.byHour.length ? <ol className="ranked-list">
          {report.byHour.map((row) => <li key={row.hour}><span className="ranked-list__rank">{String(row.hour).padStart(2, '0')}:00</span><span className="ranked-list__label"><b>{row.bookings.toLocaleString()} นัด</b></span></li>)}
        </ol> : <p>{report ? 'ยังไม่มีข้อมูลนัดหมายในช่วงวันที่ที่เลือก' : 'กำลังโหลด...'}</p>}
      </section>
    </div>

    <section className="user-admin-card">
      <div className="user-admin-card__heading"><Clock size={25} /><div><h2>ตารางความหนาแน่น วัน × ชั่วโมง</h2><small>สีเข้ม = จองมาก ใช้ดูช่วงที่ควรเพิ่ม/ลดกำลังคน</small></div></div>
      {report && report.grid.length ? (() => {
        const hours = [...new Set(report.grid.map((cell) => cell.hour))].sort((left, right) => left - right);
        const maxBookings = Math.max(1, ...report.grid.map((cell) => cell.bookings));
        const cellValue = new Map(report.grid.map((cell) => [`${cell.dow}:${cell.hour}`, cell.bookings]));
        return <div className="staff-table-wrap"><table className="peak-grid">
          <thead><tr><th>วัน / ชั่วโมง</th>{hours.map((hour) => <th key={hour}>{String(hour).padStart(2, '0')}:00</th>)}</tr></thead>
          <tbody>
            {weekdayOrder.map((dow) => <tr key={dow}>
              <td><b>{weekdayLabels[dow]}</b></td>
              {hours.map((hour) => {
                const bookings = cellValue.get(`${dow}:${hour}`) ?? 0;
                return <td key={hour} style={{ background: bookings ? `rgba(45, 124, 82, ${0.12 + (bookings / maxBookings) * 0.55})` : undefined, color: bookings ? '#0f3d29' : '#9aa8a0', fontWeight: bookings ? 800 : 500 }}>{bookings || '·'}</td>;
              })}
            </tr>)}
          </tbody>
        </table></div>;
      })() : <p>{report ? 'ยังไม่มีข้อมูลนัดหมายในช่วงวันที่ที่เลือก' : 'กำลังโหลด...'}</p>}
    </section>

    <p className="report-note">นับเฉพาะนัดหมายที่ไม่ได้ยกเลิก จัดกลุ่มตามวันที่และเวลาเริ่มของสล็อต{from || to ? ` · ช่วงที่เลือก ${from || '...'} ถึง ${to || '...'}` : ' · ช่วงข้อมูลทั้งหมด'}</p>
    <Toast onDismiss={dismissToast} toast={toast} />
  </div></section>;
}
