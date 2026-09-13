import { BarChart3, Bell, CalendarCheck2, CalendarClock, CalendarDays, CalendarSearch, CalendarX2, CircleDollarSign, ClipboardList, Clock, LogOut, Settings2, ShieldCheck, SlidersHorizontal, Stethoscope, UserRoundX, UsersRound } from 'lucide-react';
import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Toast, useToast } from './Toast';
import { getStaffRole, staffLogout, useStaffAuth } from '../services/staffAuth';

type BookingFlow = 'PROCEDURE_AND_DENTIST' | 'DENTIST_ONLY' | 'TIME_ONLY';
const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
let bookingFlowSnapshot: BookingFlow = 'PROCEDURE_AND_DENTIST';
const bookingFlowSubscribers = new Set<() => void>();

function refreshBookingFlow() {
  void fetch(`${apiBase}/booking-config`)
    .then((response) => response.ok ? response.json() : null)
    .then((data) => {
      if (data?.bookingFlow !== 'DENTIST_ONLY' && data?.bookingFlow !== 'TIME_ONLY' && data?.bookingFlow !== 'PROCEDURE_AND_DENTIST') return;
      bookingFlowSnapshot = data.bookingFlow;
      bookingFlowSubscribers.forEach((subscriber) => subscriber());
    })
    .catch(() => undefined);
}

function subscribeToBookingFlow(listener: () => void) {
  bookingFlowSubscribers.add(listener);
  refreshBookingFlow();
  return () => bookingFlowSubscribers.delete(listener);
}

function getBookingFlowSnapshot() { return bookingFlowSnapshot; }

export function AdminPanelLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast, notify, dismissToast } = useToast();
  useStaffAuth();
  const role = getStaffRole();
  const subscribe = useCallback((listener: () => void) => role === 'IT_STAFF' ? subscribeToBookingFlow(listener) : () => undefined, [role]);
  const bookingFlow = useSyncExternalStore(subscribe, getBookingFlowSnapshot, getBookingFlowSnapshot);
  const logout = async () => {
    try { await staffLogout(); navigate('/appointment', { replace: true }); }
    catch (error) { notify(error instanceof Error ? error.message : 'ไม่สามารถออกจากระบบได้ กรุณาลองใหม่', 'error'); }
  };
  const items = role === 'MANAGER'
    ? [
        { to: '/staff/dashboard', label: 'Dashboard', icon: BarChart3 },
        { to: '/staff/reports/appointments', label: 'รายงานนัดหมาย', icon: CalendarSearch },
        { to: '/staff/reports/visits', label: 'รายงานการเข้าพบ', icon: CalendarX2 },
        { to: '/staff/reports/revenue', label: 'รายงานรายได้', icon: CircleDollarSign },
        { to: '/staff/reports/dentist-productivity', label: 'ผลิตภาพทันตแพทย์', icon: Stethoscope },
        { to: '/staff/reports/notifications', label: 'MOPH Alert', icon: Bell },
        { to: '/staff/reports/peak-hours', label: 'ช่วงเวลานิยม', icon: Clock },
      ]
    : [];
  if (role === 'CLINIC_STAFF') items.push(
    { to: '/staff/appointments', label: 'นัดหมายรอตรวจสอบ', icon: ClipboardList },
    { to: '/staff/queue', label: 'ปฏิบัติงานประจำวัน', icon: CalendarClock },
    { to: '/staff/slots', label: 'สล็อตจอง', icon: CalendarDays },
  );
  if (role === 'IT_STAFF' && bookingFlow === 'PROCEDURE_AND_DENTIST') items.push({ to: '/staff/services', label: 'ประเภทบริการ', icon: SlidersHorizontal });
  if (role === 'IT_STAFF') items.push(
    { to: '/staff/system-settings', label: 'ตั้งค่าระบบ', icon: Settings2 },
    { to: '/staff/users', label: 'ผู้ใช้งานและสิทธิ์', icon: UsersRound },
  );
  if (role === 'IT_STAFF') items.push({ to: '/staff/dentists', label: 'ทะเบียนทันตแพทย์', icon: Stethoscope });
  if (role === 'CLINIC_STAFF') items.push({ to: '/staff/duty-roster', label: 'ทะเบียนลงเวร', icon: CalendarCheck2 });
  if (role === 'CLINIC_STAFF') items.push({ to: '/staff/patient-registry', label: 'ทะเบียนผู้มารับบริการ', icon: UserRoundX });
  return <div className="admin-panel"><aside className="admin-sidebar"><div className="admin-sidebar__brand"><ShieldCheck size={24} /><span>Dental Admin<small>{role === 'MANAGER' ? 'Manager' : role === 'IT_STAFF' ? 'Super Admin' : 'Clinic Staff'}</small></span></div><nav aria-label="เมนูผู้ดูแลระบบ">{items.map((item) => { const Icon = item.icon; return <Link className={location.pathname === item.to ? 'admin-sidebar__link admin-sidebar__link--active' : 'admin-sidebar__link'} key={item.label} to={item.to}><Icon size={19} /> {item.label}</Link>; })}</nav><button className="admin-sidebar__logout" type="button" onClick={() => void logout()}><LogOut size={18} /> ออกจากระบบ</button></aside><main className="admin-panel__content">{children}</main><Toast onDismiss={dismissToast} toast={toast} /></div>;
}
