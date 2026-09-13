import { CalendarPlus, Clock3, Stethoscope } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StaffAccessDenied } from '../components/StaffAccessDenied';
import { Toast, useToast } from '../components/Toast';
import { getStaffRole, staffFetch } from '../services/staffAuth';

type Dentist = { id: number; displayName: string; queuePrefix: string; services: string[] };
type Slot = { id: number; dentistId: number; dentistName: string; startTime: string; endTime: string; capacity: number; bookedCount: number; active: boolean };
type BookingFlow = 'PROCEDURE_AND_DENTIST' | 'DENTIST_ONLY' | 'TIME_ONLY';
type SlotData = { date: string; bookingFlow: BookingFlow; dentists: Dentist[]; slots: Slot[] };
const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const tomorrow = () => { const value = new Date(); value.setDate(value.getDate() + 1); return value.toISOString().slice(0, 10); };
const slotTimesForDate = (date: string, durationMinutes: number) => {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const closingMinutes = day === 0 || day === 6 ? 16 * 60 + 30 : 20 * 60 + 30;
  return Array.from({ length: Math.floor((closingMinutes - (8 * 60 + 30)) / durationMinutes) }, (_, index) => {
    const minutes = 8 * 60 + 30 + index * durationMinutes;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }).filter((startTime) => {
    const [hours, minutes] = startTime.split(':').map(Number);
    const startMinutes = hours * 60 + minutes;
    return startMinutes + durationMinutes <= 12 * 60 || startMinutes >= 13 * 60;
  });
};
const slotTimeLabel = (startTime: string, durationMinutes: number) => {
  const [hours, minutes] = startTime.split(':').map(Number);
  const endMinutes = hours * 60 + minutes + durationMinutes;
  return `${startTime}–${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')} น.`;
};
const openingHoursLabel = (date: string) => [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) ? '08:30–16:30 น.' : '08:30–20:30 น.';

export function StaffSlotsPage() {
  const role = getStaffRole();
  const [date, setDate] = useState(tomorrow);
  const [data, setData] = useState<SlotData | null>(null);
  const [dentistId, setDentistId] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [selectedTimes, setSelectedTimes] = useState(() => slotTimesForDate(tomorrow(), 30));
  const [capacity, setCapacity] = useState(1);
  const { toast, notify, dismissToast } = useToast();
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (nextDate: string, nextDentistId: number | null, currentFlow = data?.bookingFlow) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ date: nextDate });
      if (currentFlow !== 'TIME_ONLY' && nextDentistId !== null) query.set('dentistId', String(nextDentistId));
      const response = await staffFetch(`${apiBase}/staff/slots?${query}`, { headers: { 'x-mock-role': 'CLINIC_STAFF' } });
      if (!response.ok) throw new Error();
      const nextData = await response.json() as SlotData;
      setData(nextData);
      if (!nextData.dentists.some((dentist) => dentist.id === nextDentistId) && nextData.dentists[0]) setDentistId(nextData.dentists[0].id);
    } catch {
      setData(null);
      notify('ไม่สามารถโหลดข้อมูลสล็อตได้ กรุณาลองใหม่อีกครั้ง', 'error');
    } finally {
      setLoading(false);
    }
  }, [data?.bookingFlow, notify]);
  useEffect(() => {
    const timeout = window.setTimeout(() => { void load(date, dentistId); }, 0);
    return () => window.clearTimeout(timeout);
  }, [date, dentistId, load]);
  const dentist = useMemo(() => data?.dentists.find((item) => item.id === dentistId) ?? data?.dentists[0], [data?.dentists, dentistId]);
  const suggestions = useMemo(() => slotTimesForDate(date, durationMinutes), [date, durationMinutes]);
  const selectedTimeSet = useMemo(() => new Set(selectedTimes), [selectedTimes]);
  const changeDate = (nextDate: string) => { setDate(nextDate); setSelectedTimes(slotTimesForDate(nextDate, durationMinutes)); };
  const changeDuration = (nextDurationMinutes: number) => { setDurationMinutes(nextDurationMinutes); setSelectedTimes(slotTimesForDate(date, nextDurationMinutes)); };
  const changeDentist = (nextId: number) => { setDentistId(nextId); setSelectedTimes(slotTimesForDate(date, durationMinutes)); };
  const toggleTime = (time: string) => setSelectedTimes((times) => times.includes(time) ? times.filter((item) => item !== time) : [...times, time]);
  const selectAllTimes = () => setSelectedTimes([...suggestions]);
  const clearAllTimes = () => setSelectedTimes([]);
  const generate = async () => {
    if (!data || !selectedTimes.length || (data.bookingFlow !== 'TIME_ONLY' && !dentist)) return;
    setLoading(true); dismissToast();
    try {
      const body = data.bookingFlow === 'TIME_ONLY' ? { date, startTimes: selectedTimes, durationMinutes, capacity } : { dentistId: dentist?.id, date, startTimes: selectedTimes, durationMinutes };
      const response = await staffFetch(`${apiBase}/staff/slots`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-mock-role': 'CLINIC_STAFF' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      notify(result.message); await load(date, dentistId);
    } catch (error) { notify(error instanceof Error ? error.message : 'ไม่สามารถสร้างสล็อตได้', 'error'); } finally { setLoading(false); }
  };
  if (role !== 'CLINIC_STAFF') return <StaffAccessDenied />;
  if (!data) return <section className="staff-page"><div className="container"><p className="eyebrow">Clinic Staff · Booking Slots</p><h1>จัดการสล็อตจอง</h1><p>{loading ? 'กำลังโหลดรูปแบบการจอง...' : 'ไม่สามารถโหลดข้อมูลสล็อตได้ กรุณาลองใหม่อีกครั้ง'}</p><Toast onDismiss={dismissToast} toast={toast} /></div></section>;
  const setSlotCapacity = (value: string) => { const nextCapacity = Number(value); setCapacity(Number.isInteger(nextCapacity) && nextCapacity >= 1 && nextCapacity <= 50 ? nextCapacity : 1); };
  const centralQueue = data.bookingFlow === 'TIME_ONLY';
  const dentistOnly = data.bookingFlow === 'DENTIST_ONLY';
  return <section className="staff-page"><div className="container"><p className="eyebrow">Clinic Staff · Booking Slots</p><h1>จัดการสล็อตจอง</h1><p>{centralQueue ? 'สร้างคิวกลางคลินิกตามช่วงเวลาและจำนวนผู้รับบริการ' : dentistOnly ? 'สร้างสล็อตตามทันตแพทย์และช่วงเวลา โดยไม่ผูกกับหัตถการ' : 'กำหนดวันและช่วงเวลาที่ผู้รับบริการสามารถนัดหมายได้'}</p><div className="slot-admin-layout"><section className="user-admin-card"><div className="user-admin-card__heading"><CalendarPlus size={25} /><div><h2>{centralQueue ? 'สร้างสล็อตคิวกลางคลินิก' : dentistOnly ? 'สร้างสล็อตของทันตแพทย์' : 'สร้างสล็อตนัดหมาย'}</h2><small>สร้างครั้งละหลายช่วงเวลาได้ โดยสล็อตเดิมจะไม่ถูกสร้างซ้ำ</small></div></div><div className="slot-admin-fields"><label htmlFor="slot-date">วันให้บริการ<input id="slot-date" type="date" value={date} onChange={(event) => changeDate(event.target.value)} /></label><label htmlFor="slot-duration">ระยะเวลาต่อสล็อต<select id="slot-duration" value={durationMinutes} onChange={(event) => changeDuration(Number(event.target.value))}><option value="15">15 นาที</option><option value="30">30 นาที</option><option value="45">45 นาที</option><option value="60">60 นาที</option></select></label>{centralQueue ? <label htmlFor="slot-capacity">จำนวนรับต่อช่วง<input id="slot-capacity" min="1" max="50" type="number" value={capacity} onChange={(event) => setSlotCapacity(event.target.value)} /></label> : <label htmlFor="slot-dentist">ทันตแพทย์<select id="slot-dentist" value={dentist?.id ?? ''} onChange={(event) => changeDentist(Number(event.target.value))}>{data.dentists.map((item) => <option key={item.id} value={item.id}>{item.displayName} ({item.queuePrefix})</option>)}</select></label>}</div><div className="slot-service-summary"><Stethoscope size={18} /><span><b>{centralQueue ? 'คิวกลางคลินิก' : dentistOnly ? 'ทันตแพทย์ที่เลือก' : 'เวลาที่เปิดให้สร้างสล็อต'}</b>{centralQueue ? `รับได้ ${capacity} คนต่อช่วง · ช่วงละ ${durationMinutes} นาที` : dentistOnly ? `${dentist?.displayName ?? ''} · ช่วงละ ${durationMinutes} นาที` : `${openingHoursLabel(date)} · ช่วงละ ${durationMinutes} นาที`}</span></div><fieldset className="slot-time-options"><legend>เลือกช่วงเวลา ({durationMinutes} นาที)</legend><div className="slot-time-options__actions"><button className="text-button" type="button" onClick={selectAllTimes}>เลือกทั้งหมด</button><button className="text-button" type="button" onClick={clearAllTimes}>ไม่เลือกทั้งหมด</button></div><div>{suggestions.map((time) => <label key={time}><input checked={selectedTimeSet.has(time)} type="checkbox" onChange={() => toggleTime(time)} /> <Clock3 size={15} /> {slotTimeLabel(time, durationMinutes)}</label>)}</div></fieldset><button className="button" disabled={loading || !selectedTimes.length || (!centralQueue && !dentist?.services.length)} type="button" onClick={() => void generate()}>สร้างสล็อตที่เลือก</button></section><section className="user-admin-card"><div className="user-admin-card__heading"><Clock3 size={25} /><div><h2>{dentistOnly ? 'สล็อตของทันตแพทย์ที่เลือก' : 'สล็อตของวันที่เลือก'}</h2><small>{date}{centralQueue ? '' : ` · ${dentist?.displayName ?? ''}`} · {loading ? 'กำลังโหลด...' : `${data.slots.length} ช่วงเวลา`}</small></div></div><div className="slot-admin-list">{data.slots.length ? data.slots.map((slot) => <article key={slot.id}><div><b>{slot.dentistName}</b><span>{slot.startTime}–{slot.endTime} น.</span></div><small>{slot.bookedCount ? `จองแล้ว ${slot.bookedCount}/${slot.capacity}` : `ว่าง ${slot.capacity} คน`}</small></article>) : <p>ยังไม่มีสล็อตในวันที่และทันตแพทย์ที่เลือก</p>}</div></section></div></div><Toast onDismiss={dismissToast} toast={toast} /></section>;
}
