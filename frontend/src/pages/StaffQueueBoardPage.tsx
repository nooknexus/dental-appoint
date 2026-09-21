import { CalendarClock, CalendarX2, CheckCircle2, Plus, RotateCw, UserRoundX, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Toast, useToast } from '../components/Toast';
import { staffFetch } from '../services/staffAuth';
import { appointmentStatusLabels, paymentStatusLabels, visitStatusLabels } from '../services/appointmentStatus';

type DayAppointment = {
  id: number; reference: string; queueNumber: string; patientIdentityMasked: string; patientName: string; phone: string;
  status: string; paymentStatus: string; visitStatus: string; serviceName: string; notes: string | null; slipAvailable: boolean;
};
type DaySlot = { id: number; dentistId: number | null; dentistName: string; startTime: string; endTime: string; capacity: number; bookedCount: number; active: boolean; appointments: DayAppointment[] };
type DayQueue = {
  date: string;
  summary: { totalSlots: number; totalCapacity: number; totalBooked: number; freeSeats: number; pending: number; confirmed: number; cancelled: number };
  slots: DaySlot[];
  dentists: { id: number; displayName: string; queuePrefix: string; services: { id: number; title: string }[] }[];
};

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const today = () => new Date().toISOString().slice(0, 10);
const AUTO_REFRESH_MS = 30_000;

export function StaffQueueBoardPage() {
  const [date, setDate] = useState(today);
  const [data, setData] = useState<DayQueue | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [walkInSlot, setWalkInSlot] = useState<DaySlot | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DayAppointment | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const { toast, notify, dismissToast } = useToast();
  const walkInDialogRef = useRef<HTMLDialogElement>(null);
  const cancelDialogRef = useRef<HTMLDialogElement>(null);
  const walkInSlotRef = useRef<DaySlot | null>(null);
  useEffect(() => { walkInSlotRef.current = walkInSlot; }, [walkInSlot]);

  const load = useCallback(async (nextDate: string) => {
    setLoading(true);
    try {
      const response = await staffFetch(`${apiBase}/staff/day-queue?date=${nextDate}`, { headers: { 'x-mock-role': 'CLINIC_STAFF' } });
      if (!response.ok) throw new Error('ไม่สามารถโหลดคิวของวันนี้ได้');
      setData(await response.json() as DayQueue);
      setLastUpdatedAt(new Date());
    } catch (error) {
      notify(error instanceof Error ? error.message : 'ไม่สามารถโหลดคิวของวันนี้ได้', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void load(date); }, 0);
    return () => window.clearTimeout(timeout);
  }, [date, load]);
  useEffect(() => {
    const interval = setInterval(() => { if (!walkInSlotRef.current) void load(date); }, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [date, load]);
  useEffect(() => { if (walkInSlot) walkInDialogRef.current?.showModal(); }, [walkInSlot]);
  useEffect(() => { if (cancelTarget) cancelDialogRef.current?.showModal(); }, [cancelTarget]);

  const closeWalkInDialog = () => setWalkInSlot(null);
  const closeCancelDialog = () => setCancelTarget(null);

  const submitWalkIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!walkInSlot) return;
    const form = new FormData(event.currentTarget);
    const citizenId = String(form.get('citizenId') ?? '').trim();
    if (!/^\d{13}$/.test(citizenId)) { notify('กรุณากรอกเลขบัตรประชาชน 13 หลัก', 'error'); return; }
    const serviceId = form.get('serviceId') ? Number(form.get('serviceId')) : undefined;
    setBusyId(walkInSlot.id);
    try {
      const response = await staffFetch(`${apiBase}/staff/appointments/walk-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-role': 'CLINIC_STAFF' },
        body: JSON.stringify({
          slotId: walkInSlot.id,
          patientDisplayName: String(form.get('patientDisplayName') ?? '').trim(),
          phone: String(form.get('phone') ?? '').trim(),
          citizenId,
          serviceId,
          notes: String(form.get('notes') ?? '').trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      notify(`เพิ่มคิว ${result.appointment.queueNumber} เรียบร้อยแล้ว`);
      closeWalkInDialog();
      await load(date);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'ไม่สามารถเพิ่มคิวได้', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const confirmCancelAppointment = async () => {
    const appointment = cancelTarget;
    if (!appointment) return;
    setBusyId(appointment.id);
    try {
      const response = await staffFetch(`${apiBase}/staff/appointments/${appointment.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-mock-role': 'CLINIC_STAFF' }, body: JSON.stringify({}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      notify(result.message);
      closeCancelDialog();
      await load(date);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'ไม่สามารถยกเลิกคิวได้', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const setVisitStatus = async (appointment: DayAppointment, visitStatus: 'SERVED' | 'NO_SHOW' | 'BOOKED') => {
    setBusyId(appointment.id);
    try {
      const response = await staffFetch(`${apiBase}/staff/appointments/${appointment.id}/visit-status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-mock-role': 'CLINIC_STAFF' }, body: JSON.stringify({ visitStatus }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      notify(result.message);
      await load(date);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'ไม่สามารถบันทึกสถานะได้', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const walkInServices = walkInSlot?.dentistId != null ? data?.dentists.find((dentist) => dentist.id === walkInSlot.dentistId)?.services ?? [] : [];

  return <section className="staff-page"><div className="container">
    <p className="eyebrow">Clinic Staff · Daily Queue</p>
    <h1>ปฏิบัติงานประจำวัน</h1>
    <p>เปิดหน้านี้ค้างไว้เพื่อบริหารคิวของวันนั้น เพิ่มคิว walk-in ยกเลิกคิว และดูรายชื่อผู้จองในแต่ละสล็อตได้จากหน้าเดียว</p>

    <div className="queue-toolbar">
      <label htmlFor="queue-date">วันที่ปฏิบัติงาน<input id="queue-date" type="date" value={date} onChange={(event) => setDate(event.target.value || today())} /></label>
      <button className="button button--outline" disabled={loading} type="button" onClick={() => void load(date)}><RotateCw size={16} /> รีเฟรช</button>
      <span className="queue-toolbar__updated">{loading ? 'กำลังโหลด...' : lastUpdatedAt ? `อัปเดตล่าสุด ${lastUpdatedAt.toLocaleTimeString('th-TH')}` : ''}</span>
    </div>

    {data && <div className="manager-stats">
      <article><CalendarClock /><span>สล็อตทั้งหมด</span><b>{data.summary.totalSlots}</b></article>
      <article><CalendarClock /><span>จองแล้ว/ความจุ</span><b>{data.summary.totalBooked}/{data.summary.totalCapacity}</b></article>
      <article><CalendarClock /><span>รอยืนยัน</span><b>{data.summary.pending}</b></article>
      <article><CheckCircle2 /><span>ยืนยันแล้ว</span><b>{data.summary.confirmed}</b></article>
      <article><XCircle /><span>ยกเลิก</span><b>{data.summary.cancelled}</b></article>
      <article><CalendarClock /><span>ที่นั่งว่าง</span><b>{data.summary.freeSeats}</b></article>
    </div>}

    {data && data.slots.length === 0 && <section className="user-admin-card">
      <p>ยังไม่มีสล็อตของวันที่เลือก <Link to="/staff/slots">ไปสร้างสล็อตที่ /staff/slots</Link></p>
    </section>}

    {data?.slots.map((slot) => <section className="user-admin-card" key={slot.id}>
      <div className="queue-slot-card__header">
        <div className="user-admin-card__heading"><CalendarClock size={22} /><div><h2>{slot.dentistName} · {slot.startTime}–{slot.endTime} น.</h2><small><span className={`status-pill ${slot.bookedCount < slot.capacity ? 'status-pill--approved' : 'status-pill--disabled'}`}>{slot.bookedCount}/{slot.capacity} ที่นั่ง</span>{!slot.active && <span className="status-pill status-pill--disabled">ปิดรับ</span>}</small></div></div>
        <button className="button button--small" disabled={slot.bookedCount >= slot.capacity || !slot.active} type="button" onClick={() => setWalkInSlot(slot)}><Plus size={15} /> เพิ่มคิว</button>
      </div>
      <div className="staff-table-wrap">
        <table>
          <thead><tr><th>คิว</th><th>ชื่อ-สกุล</th><th>เลขบัตร</th><th>เบอร์โทร</th><th>บริการ</th><th>หมายเหตุ</th><th>สถานะนัด</th><th>การชำระเงิน</th><th>มาตามนัด</th><th>จัดการ</th></tr></thead>
          <tbody>
            {slot.appointments.length ? slot.appointments.map((appointment) => <tr className={appointment.status === 'CANCELLED' ? 'queue-cancelled-row' : undefined} key={appointment.id}>
              <td><b>{appointment.queueNumber}</b></td>
              <td>{appointment.patientName}</td>
              <td>{appointment.patientIdentityMasked}</td>
              <td>{appointment.phone}</td>
              <td>{appointment.serviceName}</td>
              <td>{appointment.notes || '—'}</td>
              <td>{appointmentStatusLabels[appointment.status] ?? appointment.status}</td>
              <td>{paymentStatusLabels[appointment.paymentStatus] ?? appointment.paymentStatus}</td>
              <td>
                {appointment.status !== 'CONFIRMED' ? '—' : appointment.visitStatus === 'BOOKED' ? (
                  <div className="queue-visit-actions">
                    <button className="button button--small" disabled={busyId === appointment.id} type="button" onClick={() => void setVisitStatus(appointment, 'SERVED')}><CheckCircle2 size={14} /> มา</button>
                    <button className="button button--small button--outline" disabled={busyId === appointment.id} type="button" onClick={() => void setVisitStatus(appointment, 'NO_SHOW')}><UserRoundX size={14} /> ไม่มา</button>
                  </div>
                ) : (
                  <div className="queue-visit-actions">
                    <span className={`status-pill ${appointment.visitStatus === 'SERVED' ? 'status-pill--approved' : 'status-pill--disabled'}`}>{visitStatusLabels[appointment.visitStatus] ?? appointment.visitStatus}</span>
                    <button className="text-button" disabled={busyId === appointment.id} type="button" onClick={() => void setVisitStatus(appointment, 'BOOKED')}>เคลียร์</button>
                  </div>
                )}
              </td>
              <td>{appointment.status !== 'CANCELLED' && <button className="button button--small button--outline" disabled={busyId === appointment.id} type="button" onClick={() => setCancelTarget(appointment)}><CalendarX2 size={14} /> ยกเลิก</button>}</td>
            </tr>) : <tr><td colSpan={10}>ยังไม่มีผู้จองในสล็อตนี้</td></tr>}
          </tbody>
        </table>
      </div>
    </section>)}

    {walkInSlot && <dialog aria-label={`เพิ่มคิว walk-in ${walkInSlot.dentistName} ${walkInSlot.startTime}`} className="walk-in-dialog" onClose={closeWalkInDialog} ref={walkInDialogRef}>
      <form onSubmit={submitWalkIn}>
        <h2>เพิ่มคิว walk-in</h2>
        <p>{walkInSlot.dentistName} · {walkInSlot.startTime}–{walkInSlot.endTime} น.</p>
        <label>ชื่อ-สกุล<input name="patientDisplayName" required /></label>
        <label>เบอร์โทร<input name="phone" required inputMode="tel" /></label>
        <label>เลขบัตรประชาชน*<input name="citizenId" inputMode="numeric" maxLength={13} pattern="\d{13}" required /></label>
        {walkInServices.length > 0 && <label>หัตถการ<select name="serviceId" defaultValue="">
          <option value="">— เลือกหัตถการ —</option>
          {walkInServices.map((service) => <option key={service.id} value={service.id}>{service.title}</option>)}
        </select></label>}
        <label>หมายเหตุ<textarea name="notes" rows={2} /></label>
        <div className="walk-in-dialog__actions">
          <button className="text-button" type="button" onClick={closeWalkInDialog}>ยกเลิก</button>
          <button className="button" disabled={busyId === walkInSlot.id} type="submit">เพิ่มคิว</button>
        </div>
      </form>
    </dialog>}

    {cancelTarget && <dialog aria-label={`ยืนยันยกเลิกคิวหมายเลข ${cancelTarget.queueNumber}`} className="confirm-dialog" onClose={closeCancelDialog} ref={cancelDialogRef}>
      <h2>ยืนยันยกเลิกคิวหมายเลข {cancelTarget.queueNumber}?</h2>
      <p>{cancelTarget.patientName}</p>
      <div className="confirm-dialog__actions">
        <button className="text-button" disabled={busyId === cancelTarget.id} type="button" onClick={closeCancelDialog}>ไม่ยกเลิก</button>
        <button className="button button--outline" disabled={busyId === cancelTarget.id} type="button" onClick={() => void confirmCancelAppointment()}><CalendarX2 size={14} /> ยืนยันยกเลิก</button>
      </div>
    </dialog>}

    <Toast onDismiss={dismissToast} toast={toast} />
  </div></section>;
}
