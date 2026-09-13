import { Search } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Toast, useToast } from '../components/Toast';
import { appointmentStatusLabels, paymentStatusLabels } from '../services/appointmentStatus';
import { getStaffRole, staffFetch } from '../services/staffAuth';

type ReportAppointment = { id: number; reference: string; queueNumber: string; serviceDate: string; startTime: string; patientName: string; phone: string; serviceName: string; dentistName: string; status: string; paymentStatus: string; paymentAmount: number };
type ReportSummary = { total: number; pending: number; confirmed: number; cancelled: number; bookingValue: number };
type AppointmentsReport = { summary: ReportSummary; appointments: ReportAppointment[] };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const todayIso = new Date().toISOString().slice(0, 10);
const monthStartIso = `${todayIso.slice(0, 8)}01`;
const statusOptions = ['PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED'] as const;

export function StaffAppointmentsReportPage() {
  const [from, setFrom] = useState(monthStartIso);
  const [to, setTo] = useState(todayIso);
  const [dentistId, setDentistId] = useState('');
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [report, setReport] = useState<AppointmentsReport | null>(null);
  const [dentists, setDentists] = useState<{ id: number; name: string }[]>([]);
  const { toast, notify, dismissToast } = useToast();
  const role = getStaffRole() === 'IT_STAFF' ? 'IT_STAFF' : 'MANAGER';

  const load = useCallback(() => {
    const params = new URLSearchParams({ from, to });
    if (dentistId) params.set('dentistId', dentistId);
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    void staffFetch(`${apiBase}/staff/reports/appointments?${params.toString()}`, { headers: { 'x-mock-role': role } }).then(async (response) => {
      if (!response.ok) throw new Error('ไม่สามารถโหลดรายงานนัดหมายได้');
      setReport(await response.json() as AppointmentsReport);
    }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'ไม่สามารถโหลดรายงานนัดหมายได้', 'error'));
  }, [from, to, dentistId, status, search, role, notify]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void fetch(`${apiBase}/dentists`).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { dentists: { id: number; name: string }[] };
      setDentists(data.dentists);
    }).catch(() => undefined);
  }, []);

  const submitSearch = (event: FormEvent) => { event.preventDefault(); setSearch(searchInput.trim()); };
  const summary = report?.summary;

  return <section className="staff-page"><div className="container">
    <p className="eyebrow">Manager · Reports</p>
    <h1>รายงานนัดหมายทั้งหมด</h1>
    <p>ค้นดูนัดหมายย้อนหลังและล่วงหน้า กรองตามช่วงวันที่ ทันตแพทย์ และสถานะ (อ่านอย่างเดียว)</p>

    <form className="report-filters" onSubmit={submitSearch}>
      <label>จากวันที่<input type="date" aria-label="จากวันที่" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>ถึงวันที่<input type="date" aria-label="ถึงวันที่" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label>ทันตแพทย์<select aria-label="ทันตแพทย์ในรายงาน" value={dentistId} onChange={(event) => setDentistId(event.target.value)}><option value="">ทุกคน</option>{dentists.map((dentist) => <option key={dentist.id} value={dentist.id}>{dentist.name}</option>)}</select></label>
      <label>สถานะนัด<select aria-label="สถานะนัดในรายงาน" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">ทุกสถานะ</option>{statusOptions.map((option) => <option key={option} value={option}>{appointmentStatusLabels[option]}</option>)}</select></label>
      <label>ค้นหา<input type="search" aria-label="ค้นหารายการนัดหมาย" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="ชื่อ เบอร์โทร เลขคิว รหัสอ้างอิง" /></label>
      <button className="button" type="submit"><Search size={17} /> ค้นหา</button>
    </form>

    {summary && <div className="report-summary">
      <span>รวม <b>{summary.total.toLocaleString()}</b> รายการ</span>
      <span>รอคอนเฟิร์ม <b>{summary.pending.toLocaleString()}</b></span>
      <span>ยืนยันแล้ว <b>{summary.confirmed.toLocaleString()}</b></span>
      <span>ยกเลิก <b>{summary.cancelled.toLocaleString()}</b></span>
      <span>มูลค่า (ไม่รวมยกเลิก) <b>{summary.bookingValue.toLocaleString()} บาท</b></span>
    </div>}

    <div className="staff-table-wrap">
      <table>
        <thead><tr><th>วันที่ / เวลา</th><th>คิว</th><th>ผู้รับบริการ</th><th>บริการ / ทันตแพทย์</th><th>สถานะ</th><th>การชำระเงิน</th><th>มูลค่า</th></tr></thead>
        <tbody>
          {report && report.appointments.length ? report.appointments.map((item) => <tr key={item.id}>
            <td>{item.serviceDate}<br /><small>{item.startTime} น.</small></td>
            <td><b>{item.queueNumber}</b><br /><small>{item.reference}</small></td>
            <td>{item.patientName}<br /><small>{item.phone}</small></td>
            <td>{item.serviceName}<br /><small>{item.dentistName}</small></td>
            <td><span className={`status-pill ${item.status === 'CONFIRMED' ? 'status-pill--approved' : item.status === 'CANCELLED' ? 'status-pill--disabled' : ''}`}>{appointmentStatusLabels[item.status] ?? item.status}</span></td>
            <td>{paymentStatusLabels[item.paymentStatus] ?? item.paymentStatus}</td>
            <td>{item.paymentAmount.toLocaleString()} บาท</td>
          </tr>) : <tr><td colSpan={7}>{report ? 'ไม่พบรายการนัดหมายตามเงื่อนไขที่เลือก' : 'กำลังโหลด...'}</td></tr>}
        </tbody>
      </table>
    </div>
    <p className="report-note">แสดงสูงสุด 500 รายการล่าสุดตามเงื่อนไข</p>
    <Toast onDismiss={dismissToast} toast={toast} />
  </div></section>;
}
