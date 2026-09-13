import { AlertTriangle, BadgeCheck, CalendarCheck2, CalendarRange, CircleDollarSign, ClipboardList, RotateCw, ShieldOff, Stethoscope, TrendingUp, UserRoundX, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Toast, useToast } from '../components/Toast';
import { appointmentStatusLabels, paymentStatusLabels } from '../services/appointmentStatus';
import { getStaffRole, staffFetch } from '../services/staffAuth';

type TodayAppointment = { id: number; queueNumber: string; status: string; paymentStatus: string; patientName: string; startTime: string; serviceName: string; dentistName: string };
type Dashboard = {
  totals: { totalBookings: number; pendingConfirmation: number; confirmedBookings: number; cancelledBookings: number; bookingValue: number };
  today: { date: string; total: number; confirmed: number; pending: number; appointments: TodayAppointment[] };
  last7Days: { date: string; bookings: number; revenue: number }[];
  topServices: { title: string; category: string; bookings: number }[];
  patients: { totalPatients: number; blockedPatients: number; noShowCount: number };
  duty: { weekStart: string; weekEnd: string; dentists: { id: number; displayName: string; dutyDayCount: number }[] };
};

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const thaiWeekdayShort = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const dayLabel = (date: string) => { const [, month, day] = date.split('-').map(Number); return `${Number(day)}/${Number(month)}`; };
const weekdayLabel = (date: string) => thaiWeekdayShort[new Date(`${date}T12:00:00Z`).getUTCDay()];
const thaiDateRangeLabel = (start: string, end: string) => `${dayLabel(start)}–${dayLabel(end)}`;

export function ManagerDashboardPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const { toast, notify, dismissToast } = useToast();
  const role = getStaffRole() === 'IT_STAFF' ? 'IT_STAFF' : 'MANAGER';

  const load = useCallback(() => {
    setLoading(true);
    void staffFetch(`${apiBase}/staff/dashboard`, { headers: { 'x-mock-role': role } }).then(async (response) => {
      if (!response.ok) throw new Error('ไม่สามารถโหลดภาพรวมการจองได้');
      setDashboard(await response.json() as Dashboard);
      setLastUpdatedAt(new Date());
    }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'ไม่สามารถโหลดภาพรวมการจองได้', 'error'))
      .finally(() => setLoading(false));
  }, [role, notify]);

  useEffect(() => {
    const timeout = window.setTimeout(load, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const maxDailyBookings = Math.max(1, ...(dashboard?.last7Days.map((day) => day.bookings) ?? [1]));

  return <section className="staff-page"><div className="container">
    <p className="eyebrow">Manager</p>
    <h1>ภาพรวมการจอง</h1>
    <p>ติดตามยอดการจอง คิววันนี้ และแนวโน้มการให้บริการของคลินิก</p>

    <div className="queue-toolbar">
      <button className="button button--outline" disabled={loading} type="button" onClick={load}><RotateCw size={16} /> รีเฟรช</button>
      <span className="queue-toolbar__updated">{loading ? 'กำลังโหลด...' : lastUpdatedAt ? `อัปเดตล่าสุด ${lastUpdatedAt.toLocaleTimeString('th-TH')}` : ''}</span>
    </div>

    <div className="manager-stats">
      <article><CalendarCheck2 /><span>นัดหมายวันนี้</span><b>{dashboard?.today.total ?? '—'}</b></article>
      <article><ClipboardList /><span>รายการจองทั้งหมด</span><b>{dashboard?.totals.totalBookings ?? '—'}</b></article>
      <article><CalendarCheck2 /><span>รอยืนยัน</span><b>{dashboard?.totals.pendingConfirmation ?? '—'}</b></article>
      <article><BadgeCheck /><span>ยืนยันแล้ว</span><b>{dashboard?.totals.confirmedBookings ?? '—'}</b></article>
      <article><XCircle /><span>ยกเลิก</span><b>{dashboard?.totals.cancelledBookings ?? '—'}</b></article>
      <article><CircleDollarSign /><span>ยอดจองรวม</span><b>{dashboard ? `${dashboard.totals.bookingValue.toLocaleString()} บาท` : '—'}</b></article>
    </div>

    <section className="user-admin-card">
      <div className="user-admin-card__heading"><ClipboardList size={25} /><div><h2>นัดหมายวันนี้</h2><small>{dashboard ? `${dashboard.today.date} · ยืนยันแล้ว ${dashboard.today.confirmed} · รอยืนยัน ${dashboard.today.pending} · รวม ${dashboard.today.total} รายการ` : 'กำลังโหลด...'}</small></div></div>
      <div className="staff-table-wrap">
        <table>
          <thead><tr><th>เวลา</th><th>คิว</th><th>ผู้รับบริการ</th><th>บริการ / ทันตแพทย์</th><th>สถานะ</th><th>การชำระเงิน</th></tr></thead>
          <tbody>
            {dashboard && dashboard.today.appointments.length ? dashboard.today.appointments.map((item) => <tr key={item.id}>
              <td>{item.startTime} น.</td>
              <td><b>{item.queueNumber}</b></td>
              <td>{item.patientName}</td>
              <td>{item.serviceName}<br /><small>{item.dentistName}</small></td>
              <td><span className={`status-pill ${item.status === 'CONFIRMED' ? 'status-pill--approved' : ''}`}>{appointmentStatusLabels[item.status] ?? item.status}</span></td>
              <td>{paymentStatusLabels[item.paymentStatus] ?? item.paymentStatus}</td>
            </tr>) : <tr><td colSpan={6}>{dashboard ? 'ยังไม่มีนัดหมายวันนี้' : 'กำลังโหลด...'}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    <div className="manager-dashboard-grid">
      <section className="user-admin-card">
        <div className="user-admin-card__heading"><TrendingUp size={25} /><div><h2>แนวโน้ม 7 วันล่าสุด</h2><small>จำนวนการจองต่อวัน (ไม่รวมรายการที่ยกเลิก)</small></div></div>
        <div className="trend-bars">
          {dashboard ? dashboard.last7Days.map((day) => <div className="trend-bars__column" key={day.date}>
            <span className="trend-bars__value">{day.bookings}</span>
            <div className="trend-bars__track"><div className="trend-bars__bar" style={{ height: `${(day.bookings / maxDailyBookings) * 100}%` }} /></div>
            <span className="trend-bars__label">{weekdayLabel(day.date)} {dayLabel(day.date)}</span>
          </div>) : <p>กำลังโหลด...</p>}
        </div>
      </section>

      <section className="user-admin-card">
        <div className="user-admin-card__heading"><Stethoscope size={25} /><div><h2>หัตถการยอดนิยมเดือนนี้</h2><small>เรียงตามจำนวนการจอง (ไม่รวมรายการที่ยกเลิก)</small></div></div>
        {dashboard && dashboard.topServices.length ? <ol className="ranked-list">
          {dashboard.topServices.map((service, index) => <li key={service.title}><span className="ranked-list__rank">{index + 1}</span><span className="ranked-list__label"><b>{service.title}</b><small>{service.category}</small></span><span className="ranked-list__value">{service.bookings} ครั้ง</span></li>)}
        </ol> : <p>{dashboard ? 'ยังไม่มีข้อมูลการจองในเดือนนี้' : 'กำลังโหลด...'}</p>}
      </section>
    </div>

    <div className="manager-dashboard-grid">
      <section className="user-admin-card">
        <div className="user-admin-card__heading"><CalendarRange size={25} /><div><h2>ทันตแพทย์เข้าเวรสัปดาห์นี้</h2><small>{dashboard ? thaiDateRangeLabel(dashboard.duty.weekStart, dashboard.duty.weekEnd) : 'กำลังโหลด...'}</small></div></div>
        {dashboard && dashboard.duty.dentists.length ? <ul className="duty-summary-list">
          {dashboard.duty.dentists.map((dentist) => <li key={dentist.id}><span>{dentist.displayName}</span><span className="status-pill status-pill--approved">{dentist.dutyDayCount} วัน</span></li>)}
        </ul> : <p>{dashboard ? 'ยังไม่มีตารางเวรของสัปดาห์นี้ในระบบ' : 'กำลังโหลด...'}</p>}
      </section>

      <section className="user-admin-card">
        <div className="user-admin-card__heading"><UserRoundX size={25} /><div><h2>ทะเบียนผู้มารับบริการ</h2><small>สรุปสถานะผู้ป่วยในระบบ</small></div></div>
        <div className="manager-mini-stats">
          <div><span>ผู้ป่วยทั้งหมด</span><b>{dashboard?.patients.totalPatients ?? '—'}</b></div>
          <div><span><ShieldOff size={15} aria-hidden="true" /> ถูกบล็อก</span><b>{dashboard?.patients.blockedPatients ?? '—'}</b></div>
          <div><span><AlertTriangle size={15} aria-hidden="true" /> ไม่มาตามนัด</span><b>{dashboard?.patients.noShowCount ?? '—'}</b></div>
        </div>
      </section>
    </div>
    <Toast onDismiss={dismissToast} toast={toast} />
  </div></section>;
}
