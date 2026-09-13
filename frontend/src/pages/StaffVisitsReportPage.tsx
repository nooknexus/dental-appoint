import { CalendarRange, Stethoscope } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Toast, useToast } from '../components/Toast';
import { getStaffRole, staffFetch } from '../services/staffAuth';

type VisitCounts = { total: number; served: number; noShow: number; booked: number; noShowRate: number };
type MonthlyVisitRow = VisitCounts & { month: string };
type DentistVisitRow = VisitCounts & { dentistId: number | null; dentistName: string };
type VisitsReport = { range: { from: string; to: string }; summary: VisitCounts; monthly: MonthlyVisitRow[]; byDentist: DentistVisitRow[] };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const now = new Date();
const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)).toISOString().slice(0, 10);
const defaultTo = now.toISOString().slice(0, 10);
const visitHeadings = <><th>รวม</th><th>เข้าพบแล้ว</th><th>ไม่มาตามนัด</th><th>รอเข้าพบ</th><th>อัตรา No-show</th></>;

export function StaffVisitsReportPage() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [report, setReport] = useState<VisitsReport | null>(null);
  const { toast, notify, dismissToast } = useToast();
  const role = getStaffRole() === 'IT_STAFF' ? 'IT_STAFF' : 'MANAGER';

  const load = useCallback(() => {
    void staffFetch(`${apiBase}/staff/reports/visits?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: { 'x-mock-role': role } }).then(async (response) => {
      if (!response.ok) throw new Error('ไม่สามารถโหลดรายงานการเข้าพบได้');
      setReport(await response.json() as VisitsReport);
    }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'ไม่สามารถโหลดรายงานการเข้าพบได้', 'error'));
  }, [from, to, role, notify]);

  useEffect(() => { void load(); }, [load]);
  const summary = report?.summary;

  return <section className="staff-page"><div className="container">
    <p className="eyebrow">Manager · Reports</p>
    <h1>รายงานการเข้าพบและ No-show</h1>
    <p>ติดตามอัตราการมาตามนัดของคลินิก สรุปแยกตามเดือนและทันตแพทย์ (ไม่รวมนัดหมายที่ยกเลิก)</p>

    <form className="report-filters">
      <label>จากวันที่<input type="date" aria-label="จากวันที่" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>ถึงวันที่<input type="date" aria-label="ถึงวันที่" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    </form>

    {summary && <div className="report-summary">
      <span>รวม <b>{summary.total.toLocaleString()}</b> นัด</span>
      <span>เข้าพบแล้ว <b>{summary.served.toLocaleString()}</b></span>
      <span>ไม่มาตามนัด <b>{summary.noShow.toLocaleString()}</b></span>
      <span>รอเข้าพบ <b>{summary.booked.toLocaleString()}</b></span>
      <span>อัตรา No-show <b>{summary.noShowRate}%</b></span>
    </div>}

    <div className="manager-dashboard-grid">
      <section className="user-admin-card">
        <div className="user-admin-card__heading"><CalendarRange size={25} /><div><h2>สรุปรายเดือน</h2><small>จำนวนนัดและสถานะการเข้าพบในแต่ละเดือน</small></div></div>
        <div className="staff-table-wrap">
          <table>
            <thead><tr><th>เดือน</th>{visitHeadings}</tr></thead>
            <tbody>
              {report && report.monthly.length ? report.monthly.map((row) => <tr key={row.month}>
                <td><b>{row.month}</b></td><td>{row.total.toLocaleString()}</td><td>{row.served.toLocaleString()}</td>
                <td>{row.noShow.toLocaleString()}</td><td>{row.booked.toLocaleString()}</td><td>{row.noShowRate}%</td>
              </tr>) : <tr><td colSpan={6}>{report ? 'ยังไม่มีข้อมูลการเข้าพบในช่วงวันที่ที่เลือก' : 'กำลังโหลด...'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="user-admin-card">
        <div className="user-admin-card__heading"><Stethoscope size={25} /><div><h2>แยกตามทันตแพทย์</h2><small>เรียงตามจำนวนนัดในช่วงวันที่ที่เลือก</small></div></div>
        <div className="staff-table-wrap">
          <table>
            <thead><tr><th>ทันตแพทย์</th>{visitHeadings}</tr></thead>
            <tbody>
              {report && report.byDentist.length ? report.byDentist.map((row) => <tr key={row.dentistId ?? 'central'}>
                <td><b>{row.dentistName}</b></td><td>{row.total.toLocaleString()}</td><td>{row.served.toLocaleString()}</td>
                <td>{row.noShow.toLocaleString()}</td><td>{row.booked.toLocaleString()}</td><td>{row.noShowRate}%</td>
              </tr>) : <tr><td colSpan={6}>{report ? 'ยังไม่มีข้อมูลการเข้าพบในช่วงวันที่ที่เลือก' : 'กำลังโหลด...'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <p className="report-note">อัตรา No-show = ไม่มาตามนัด ÷ (เข้าพบแล้ว + ไม่มาตามนัด) นับเฉพาะนัดที่ถึงกำหนดแล้ว · {report ? `ช่วงข้อมูล ${report.range.from} ถึง ${report.range.to}` : ''}</p>
    <Toast onDismiss={dismissToast} toast={toast} />
  </div></section>;
}
