import { useCallback, useEffect, useState } from 'react';
import { Toast, useToast } from '../components/Toast';
import { getStaffRole, staffFetch } from '../services/staffAuth';

type ProductivityRow = { dentistId: number; dentistName: string; appointments: number; dutyDays: number; appointmentsPerDutyDay: number | null };
type ProductivityReport = { range: { from: string; to: string }; dentists: ProductivityRow[] };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const now = new Date();
const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)).toISOString().slice(0, 10);
const defaultTo = now.toISOString().slice(0, 10);

export function StaffDentistProductivityPage() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [report, setReport] = useState<ProductivityReport | null>(null);
  const { toast, notify, dismissToast } = useToast();
  const role = getStaffRole() === 'IT_STAFF' ? 'IT_STAFF' : 'MANAGER';

  const load = useCallback(() => {
    void staffFetch(`${apiBase}/staff/reports/dentist-productivity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: { 'x-mock-role': role } }).then(async (response) => {
      if (!response.ok) throw new Error('ไม่สามารถโหลดรายงานผลิตภาพทันตแพทย์ได้');
      setReport(await response.json() as ProductivityReport);
    }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'ไม่สามารถโหลดรายงานผลิตภาพทันตแพทย์ได้', 'error'));
  }, [from, to, role, notify]);

  useEffect(() => { void load(); }, [load]);

  return <section className="staff-page"><div className="container">
    <p className="eyebrow">Manager · Reports</p>
    <h1>รายงานผลิตภาพทันตแพทย์</h1>
    <p>เทียบจำนวนนัดที่ผู้ป่วยจองกับจำนวนวันลงเวรจริงจากทะเบียนลงเวร (ไม่รวมคิวกลางและนัดหมายที่ยกเลิก)</p>

    <form className="report-filters">
      <label>จากวันที่<input type="date" aria-label="จากวันที่" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>ถึงวันที่<input type="date" aria-label="ถึงวันที่" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    </form>

    <div className="staff-table-wrap">
      <table>
        <thead><tr><th>ทันตแพทย์</th><th>จำนวนนัด</th><th>วันลงเวร</th><th>นัดต่อวันลงเวร</th></tr></thead>
        <tbody>
          {report && report.dentists.length ? report.dentists.map((row) => <tr key={row.dentistId}>
            <td><b>{row.dentistName}</b></td>
            <td>{row.appointments.toLocaleString()}</td>
            <td>{row.dutyDays.toLocaleString()}</td>
            <td>{row.appointmentsPerDutyDay === null ? '—' : row.appointmentsPerDutyDay.toFixed(2)}</td>
          </tr>) : <tr><td colSpan={4}>{report ? 'ยังไม่มีข้อมูลนัดหมายหรือทะเบียนลงเวรในช่วงวันที่ที่เลือก' : 'กำลังโหลด...'}</td></tr>}
        </tbody>
      </table>
    </div>

    <p className="report-note">วันลงเวรนับจากทะเบียนลงเวรที่บันทึกไว้เท่านั้น (หน้า /staff/duty-roster) ซึ่งยังไม่เชื่อมกับการสร้างสล็อตจอง · {report ? `ช่วงข้อมูล ${report.range.from} ถึง ${report.range.to}` : ''}</p>
    <Toast onDismiss={dismissToast} toast={toast} />
  </div></section>;
}
