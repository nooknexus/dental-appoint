import { CalendarRange, Download, Stethoscope } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Toast, useToast } from '../components/Toast';
import { paymentStatusLabels } from '../services/appointmentStatus';
import { getStaffRole, staffFetch } from '../services/staffAuth';

type RevenueBreakdown = { bookings: number; revenue: number; awaitingPayment: number; slipUploaded: number; verified: number; rejected: number; notRequired: number };
type MonthlyRevenue = RevenueBreakdown & { month: string };
type ServiceRevenue = RevenueBreakdown & { serviceName: string };
type RevenueReport = { range: { from: string; to: string }; summary: RevenueBreakdown; monthly: MonthlyRevenue[]; byService: ServiceRevenue[] };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const now = new Date();
const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)).toISOString().slice(0, 10);
const defaultTo = now.toISOString().slice(0, 10);
const statusColumns: { key: keyof RevenueBreakdown; label: string }[] = [
  { key: 'verified', label: paymentStatusLabels.VERIFIED },
  { key: 'awaitingPayment', label: paymentStatusLabels.AWAITING_PAYMENT },
  { key: 'slipUploaded', label: paymentStatusLabels.SLIP_UPLOADED },
  { key: 'rejected', label: paymentStatusLabels.REJECTED },
];

export function StaffRevenueReportPage() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [report, setReport] = useState<RevenueReport | null>(null);
  const { toast, notify, dismissToast } = useToast();
  const role = getStaffRole() === 'IT_STAFF' ? 'IT_STAFF' : 'MANAGER';

  const load = useCallback(() => {
    void staffFetch(`${apiBase}/staff/reports/revenue?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: { 'x-mock-role': role } }).then(async (response) => {
      if (!response.ok) throw new Error('ไม่สามารถโหลดรายงานรายได้ได้');
      setReport(await response.json() as RevenueReport);
    }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'ไม่สามารถโหลดรายงานรายได้ได้', 'error'));
  }, [from, to, role, notify]);

  useEffect(() => { void load(); }, [load]);
  const summary = report?.summary;

  /** ส่งออกตารางรายเดือนเป็น CSV (มี BOM ให้ Excel อ่านภาษาไทยได้) */
  const exportCsv = () => {
    if (!report) return;
    const header = ['เดือน', 'จำนวนนัด', ...statusColumns.map((column) => column.label), 'ค่าจองคิวรวม (บาท)'];
    const rows = report.monthly.map((row) => [row.month, row.bookings, ...statusColumns.map((column) => row[column.key]), row.revenue]);
    const csv = [header, ...rows].map((cells) => cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `revenue-report-${report.range.from}_${report.range.to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notify('ส่งออกไฟล์ CSV แล้ว');
  };

  return <section className="staff-page"><div className="container">
    <p className="eyebrow">Manager · Reports</p>
    <h1>รายงานรายได้ (ค่าจองคิว)</h1>
    <p>สรุปยอดค่าจองคิวแยกตามเดือนและหัตถการ พร้อมสถานะการชำระเงิน — ยอดนี้เป็นค่าจองคิว ไม่รวมค่ารักษา (ไม่รวมนัดหมายที่ยกเลิก)</p>

    <form className="report-filters">
      <label>จากวันที่<input type="date" aria-label="จากวันที่" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>ถึงวันที่<input type="date" aria-label="ถึงวันที่" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="button" type="button" onClick={exportCsv} disabled={!report || !report.monthly.length}><Download size={17} /> ส่งออก CSV</button>
    </form>

    {summary && <div className="report-summary">
      <span>รวม <b>{summary.bookings.toLocaleString()}</b> นัด</span>
      <span>ค่าจองคิวรวม <b>{summary.revenue.toLocaleString()} บาท</b></span>
      <span>ชำระแล้ว <b>{summary.verified.toLocaleString()}</b></span>
      <span>รอชำระ <b>{summary.awaitingPayment.toLocaleString()}</b></span>
      <span>รอตรวจสลิป <b>{summary.slipUploaded.toLocaleString()}</b></span>
      <span>สลิปถูกปฏิเสธ <b>{summary.rejected.toLocaleString()}</b></span>
    </div>}

    <section className="user-admin-card">
      <div className="user-admin-card__heading"><CalendarRange size={25} /><div><h2>สรุปรายเดือน</h2><small>ยอดค่าจองคิวและสถานะการชำระเงินของแต่ละเดือน</small></div></div>
      <div className="staff-table-wrap">
        <table>
          <thead><tr><th>เดือน</th><th>จำนวนนัด</th><th>ค่าจองคิว (บาท)</th>{statusColumns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
          <tbody>
            {report && report.monthly.length ? report.monthly.map((row) => <tr key={row.month}>
              <td><b>{row.month}</b></td><td>{row.bookings.toLocaleString()}</td><td>{row.revenue.toLocaleString()}</td>
              {statusColumns.map((column) => <td key={column.key}>{row[column.key].toLocaleString()}</td>)}
            </tr>) : <tr><td colSpan={3 + statusColumns.length}>{report ? 'ยังไม่มีข้อมูลค่าจองคิวในช่วงวันที่ที่เลือก' : 'กำลังโหลด...'}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    <section className="user-admin-card">
      <div className="user-admin-card__heading"><Stethoscope size={25} /><div><h2>แยกตามหัตถการ</h2><small>เรียงตามยอดค่าจองคิวในช่วงวันที่ที่เลือก</small></div></div>
      <div className="staff-table-wrap">
        <table>
          <thead><tr><th>หัตถการ</th><th>จำนวนนัด</th><th>ค่าจองคิว (บาท)</th><th>ชำระแล้ว</th></tr></thead>
          <tbody>
            {report && report.byService.length ? report.byService.map((row) => <tr key={row.serviceName}>
              <td><b>{row.serviceName}</b></td><td>{row.bookings.toLocaleString()}</td><td>{row.revenue.toLocaleString()}</td><td>{row.verified.toLocaleString()}</td>
            </tr>) : <tr><td colSpan={4}>{report ? 'ยังไม่มีข้อมูลค่าจองคิวในช่วงวันที่ที่เลือก' : 'กำลังโหลด...'}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    <p className="report-note">{report ? `ช่วงข้อมูล ${report.range.from} ถึง ${report.range.to} · ` : ''}จำนวนเงินคำนวณจาก <code>payment_amount</code> ของนัดหมายที่ไม่ได้ยกเลิก</p>
    <Toast onDismiss={dismissToast} toast={toast} />
  </div></section>;
}
