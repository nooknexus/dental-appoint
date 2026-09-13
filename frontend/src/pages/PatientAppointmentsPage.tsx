import { ClipboardCheck } from 'lucide-react';
import { useCallback, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';

type PatientAppointment = { reference: string; queueNumber: string; status: string; paymentStatus: string; serviceName: string; dentistName: string; startsAt: string };
type AppointmentState = { appointments: PatientAppointment[]; loading: boolean; unauthorized: boolean };
const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const loadingState: AppointmentState = { appointments: [], loading: true, unauthorized: false };
// identity มาจาก session cookie ฝั่ง server เท่านั้น ฝั่ง browser จึงเก็บสถานะเดียวพอ ไม่ต้องแยกตามเลขบัตรอีก
let appointmentState: AppointmentState = loadingState;
let appointmentRequested = false;
const appointmentSubscribers = new Set<() => void>();

function notify() { appointmentSubscribers.forEach((subscriber) => subscriber()); }

function loadAppointments() {
  return fetch(`${apiBase}/patient/appointments`)
    // 401 = ยังไม่ได้ล็อกอิน/session หมดอายุ ต้องแยกจาก "ไม่มีนัดหมาย" เพราะคนละความหมายกับผู้ใช้
    .then(async (response) => (response.ok
      ? { appointments: (await response.json()).appointments as PatientAppointment[], unauthorized: false }
      : { appointments: [] as PatientAppointment[], unauthorized: response.status === 401 }))
    .then((data) => { appointmentState = { ...data, loading: false }; notify(); })
    .catch(() => { appointmentState = { appointments: [], loading: false, unauthorized: false }; notify(); });
}

function subscribeToAppointments(listener: () => void) {
  appointmentSubscribers.add(listener);
  if (!appointmentRequested) {
    appointmentRequested = true;
    appointmentState = loadingState;
    void loadAppointments();
  }
  return () => {
    appointmentSubscribers.delete(listener);
    if (appointmentSubscribers.size === 0) appointmentRequested = false;
  };
}

/** ใช้ใน test เท่านั้น ล้าง cache ระดับโมดูลก่อน mount หน้านี้ซ้ำ */
export function resetPatientAppointmentsCache() {
  appointmentRequested = false;
  appointmentState = loadingState;
}

function appointmentServiceName(appointment: PatientAppointment) {
  if (appointment.serviceName !== 'ยังไม่ระบุหัตถการ') return appointment.serviceName;
  return appointment.dentistName === 'คิวกลางคลินิก' ? 'คิวกลางคลินิก' : 'นัดหมายกับทันตแพทย์';
}
function appointmentStatusMessage(appointment: PatientAppointment) {
  if (appointment.status === 'CONFIRMED') return 'ยืนยันนัดหมายแล้ว — ระบบจะแจ้งผลผ่านแอปหมอพร้อมของท่าน';
  if (appointment.paymentStatus === 'NOT_REQUIRED') return 'รอเจ้าหน้าที่ยืนยันนัดหมาย เมื่อยืนยันแล้วระบบจะแจ้งผลผ่านไลน์หมอพร้อมหรือแอปพลิเคชันหมอพร้อม';
  return 'รอเจ้าหน้าที่ตรวจสอบหลักฐานการโอนเงินจอง';
}
export function PatientAppointmentsPage() {
  const subscribe = useCallback((listener: () => void) => subscribeToAppointments(listener), []);
  const getSnapshot = useCallback(() => appointmentState, []);
  const { appointments, loading, unauthorized } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return <section className="booking-page"><div className="container booking-shell"><Link className="booking-back" to="/patient/menu">← กลับเมนูบริการ</Link><div className="booking-card"><div className="booking-payment"><ClipboardCheck size={46} /><h1>ดูคิวที่จอง</h1><p>ตรวจสอบหมายเลขคิว วันเวลา และสถานะการยืนยันนัดหมายล่าสุด</p></div>{appointments.map((appointment) => <article className="queue-ticket" key={appointment.reference}><span className="queue-ticket__cutout queue-ticket__cutout--left" /><span className="queue-ticket__cutout queue-ticket__cutout--right" /><div className="queue-ticket__number"><small>หมายเลขคิว</small><b>{appointment.queueNumber}</b></div><div className="queue-ticket__details"><strong>{appointmentServiceName(appointment)}</strong><span>{appointment.dentistName}</span><span>{new Date(appointment.startsAt).toLocaleString('th-TH')}</span></div><p>{appointmentStatusMessage(appointment)}</p></article>)}{appointments.length === 0 && (unauthorized
      ? <p className="booking-message">เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ <Link to="/appointment">เข้าสู่ระบบอีกครั้ง</Link></p>
      : <p className="booking-disclaimer">{loading ? 'กำลังค้นหารายการนัดหมายของท่าน...' : 'ไม่พบรายการนัดหมายของท่าน'}</p>)}</div></div></section>;
}
