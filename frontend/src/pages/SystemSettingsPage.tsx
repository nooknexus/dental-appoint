import { CreditCard, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { StaffAccessDenied } from '../components/StaffAccessDenied';
import { Toast, useToast } from '../components/Toast';
import { getStaffRole, staffFetch } from '../services/staffAuth';

type BookingFlow = 'PROCEDURE_AND_DENTIST' | 'DENTIST_ONLY' | 'TIME_ONLY';
type ClinicType = 'PMC' | 'SMC';
type Delivery = { id: number; queueNumber: string; recipientMasked: string; deliveryStatus: string; attemptCount: number; errorMessage?: string | null };
type SystemSettings = {
  reservationPaymentEnabled: boolean;
  reservationPaymentAmount: number;
  bookingFlow: BookingFlow;
  clinicTypes?: ClinicType[];
  mophAlert?: { enabled: boolean; clientKeyConfigured: boolean; secretKeyConfigured: boolean; encryptionKeyConfigured: boolean };
};

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const defaultClinicTypes: ClinicType[] = ['PMC', 'SMC'];
const flows: { value: BookingFlow; label: string; detail: string }[] = [
  { value: 'PROCEDURE_AND_DENTIST', label: 'เลือกหัตถการและทันตแพทย์', detail: 'รูปแบบมาตรฐาน: เลือกหมวด หัตถการ และทันตแพทย์' },
  { value: 'DENTIST_ONLY', label: 'เลือกทันตแพทย์โดยไม่เลือกหัตถการ', detail: 'ผู้รับบริการเลือกทันตแพทย์และช่วงเวลา' },
  { value: 'TIME_ONLY', label: 'เลือกเฉพาะช่วงเวลา', detail: 'ผู้รับบริการเลือกช่วงเวลา โดยเจ้าหน้าที่กำหนดจำนวนรับต่อช่วง' },
];

export function SystemSettingsPage() {
  const role = getStaffRole();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [saving, setSaving] = useState(false);
  const [mophClientKey, setMophClientKey] = useState('');
  const [mophSecretKey, setMophSecretKey] = useState('');
  const { toast, notify, dismissToast } = useToast();

  useEffect(() => {
    if (role !== 'IT_STAFF') return;
    void staffFetch(`${apiBase}/staff/system-settings`, { headers: { 'x-mock-role': 'IT_STAFF' } })
      .then(async (response) => response.ok ? await response.json() as SystemSettings : null)
      .then(setSettings)
      .catch(() => setSettings(null));
    void staffFetch(`${apiBase}/staff/notification-deliveries`, { headers: { 'x-mock-role': 'IT_STAFF' } })
      .then(async (response) => response.ok ? await response.json() as { deliveries: Delivery[] } : null)
      .then((data) => setDeliveries(data?.deliveries ?? []))
      .catch(() => setDeliveries([]));
  }, [role]);

  if (role !== 'IT_STAFF') return <StaffAccessDenied />;

  const updateReservationPayment = async (enabled: boolean) => {
    if (!settings) return;
    setSaving(true); dismissToast();
    try {
      const response = await staffFetch(`${apiBase}/staff/system-settings/reservation-payment`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-mock-role': 'IT_STAFF' }, body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error();
      const nextSettings = await response.json() as SystemSettings;
      setSettings(nextSettings);
      notify(`${enabled ? 'เปิด' : 'ปิด'}การชำระค่าจองคิว ${nextSettings.reservationPaymentAmount} บาทแล้ว`);
    } catch { notify('ไม่สามารถบันทึกการตั้งค่าการชำระเงินได้', 'error'); } finally { setSaving(false); }
  };

  const saveMophAlert = async (enabled: boolean) => {
    if (!settings) return;
    setSaving(true); dismissToast();
    try {
      const response = await staffFetch(`${apiBase}/staff/system-settings/moph-alert`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-mock-role': 'IT_STAFF' },
        body: JSON.stringify({ enabled, ...(mophClientKey ? { clientKey: mophClientKey } : {}), ...(mophSecretKey ? { secretKey: mophSecretKey } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setSettings({ ...settings, mophAlert: { enabled, clientKeyConfigured: result.clientKeyConfigured || settings.mophAlert?.clientKeyConfigured || false, secretKeyConfigured: result.secretKeyConfigured || settings.mophAlert?.secretKeyConfigured || false, encryptionKeyConfigured: result.encryptionKeyConfigured } });
      setMophClientKey(''); setMophSecretKey(''); notify('บันทึกการตั้งค่า MOPH Alert แล้ว');
    } catch (error) { notify(error instanceof Error ? error.message : 'ไม่สามารถบันทึก MOPH Alert ได้', 'error'); } finally { setSaving(false); }
  };

  const updateBookingFlow = async (bookingFlow: BookingFlow) => {
    if (!settings) return;
    setSaving(true); dismissToast();
    try {
      const response = await staffFetch(`${apiBase}/staff/system-settings/booking-flow`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-mock-role': 'IT_STAFF' }, body: JSON.stringify({ bookingFlow }),
      });
      if (!response.ok) throw new Error();
      setSettings({ ...settings, bookingFlow });
      notify('บันทึกรูปแบบการจองคิวแล้ว');
    } catch { notify('ไม่สามารถบันทึกรูปแบบการจองคิวได้', 'error'); } finally { setSaving(false); }
  };

  const updateClinicTypes = async (clinicTypes: ClinicType[]) => {
    if (!settings || !clinicTypes.length) return;
    setSaving(true); dismissToast();
    try {
      const response = await staffFetch(`${apiBase}/staff/system-settings/clinic-types`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-mock-role': 'IT_STAFF' }, body: JSON.stringify({ clinicTypes }),
      });
      if (!response.ok) throw new Error();
      setSettings({ ...settings, clinicTypes });
      notify('บันทึกประเภทคลินิกที่เปิดบริการแล้ว');
    } catch { notify('ไม่สามารถบันทึกประเภทคลินิกได้', 'error'); } finally { setSaving(false); }
  };

  const retryDelivery = async (id: number) => {
    const response = await staffFetch(`${apiBase}/staff/notification-deliveries/${id}/retry`, { method: 'POST', headers: { 'x-mock-role': 'IT_STAFF' } });
    if (response.ok) notify('นำรายการเข้าคิวส่งซ้ำแล้ว'); else notify('ไม่สามารถส่งซ้ำได้', 'error');
  };

  const clinicTypes = settings?.clinicTypes ?? defaultClinicTypes;
  const toggleClinicType = (type: ClinicType, enabled: boolean) => void updateClinicTypes(enabled ? [...clinicTypes, type] : clinicTypes.filter((item) => item !== type));

  return <section className="staff-page"><div className="container">
    <p className="eyebrow">Super Admin · System Settings</p><h1>ตั้งค่าระบบ</h1><p>กำหนดพฤติกรรมการจองคิวที่มีผลกับผู้ป่วยทุกคน เฉพาะ Super Admin เท่านั้นที่แก้ไขได้</p>
    <section className="system-setting-card"><div className="system-setting-card__heading"><Settings2 size={26} /><div><h2>รูปแบบการจองคิว</h2><p>เลือกขั้นตอนที่ผู้รับบริการต้องระบุก่อนเลือกช่วงเวลา</p></div></div>
      {settings && <fieldset><legend>รูปแบบที่ใช้งาน</legend>{flows.map((flow) => <label className="system-setting-toggle" key={flow.value}><input checked={settings.bookingFlow === flow.value} disabled={saving} name="booking-flow" type="radio" onChange={() => void updateBookingFlow(flow.value)} /><span><b>{flow.label}</b><small>{flow.detail}</small></span></label>)}</fieldset>}
    </section>
    <section className="system-setting-card"><div className="system-setting-card__heading"><Settings2 size={26} /><div><h2>ประเภทคลินิกที่เปิดบริการ</h2><p>เลือกประเภทคลินิกและเวลาให้บริการที่จะแสดงบนหน้า Contact และส่วนท้ายเว็บไซต์</p></div></div>
      {settings && <fieldset><legend>ประเภทที่เปิดบริการ</legend>{(['PMC', 'SMC'] as ClinicType[]).map((type) => <label className="system-setting-toggle" key={type}><input aria-label={type === 'PMC' ? 'PMC · ในเวลา' : 'SMC · นอกเวลา'} checked={clinicTypes.includes(type)} disabled={saving || (clinicTypes.length === 1 && clinicTypes.includes(type))} type="checkbox" onChange={(event) => toggleClinicType(type, event.target.checked)} /><span><b>{type === 'PMC' ? 'PMC · ในเวลา' : 'SMC · นอกเวลา'}</b><small>{type === 'PMC' ? 'จันทร์–ศุกร์ 08:30–16:30 น.' : 'จันทร์–ศุกร์ 16:30–20:30 น. และเสาร์–อาทิตย์ 08:30–16:30 น.'}</small></span></label>)}</fieldset>}
    </section>
    <section className="system-setting-card"><div className="system-setting-card__heading"><Settings2 size={26} /><div><h2>การชำระเงินจองคิว</h2><p>ตั้งค่าว่าการจองคิวใหม่ต้องชำระเงินล่วงหน้าหรือไม่</p></div></div>
      {settings ? <label className="system-setting-toggle"><input aria-label={`เปิดใช้การชำระค่าจองคิว ${settings.reservationPaymentAmount} บาท`} checked={settings.reservationPaymentEnabled} disabled={saving} type="checkbox" onChange={(event) => void updateReservationPayment(event.target.checked)} /><span><CreditCard size={20} /><b>ชำระค่าจองคิว {settings.reservationPaymentAmount} บาท</b><small>{settings.reservationPaymentEnabled ? 'เปิดใช้งานอยู่: ผู้ป่วยต้องชำระและแนบสลิปก่อนรอเจ้าหน้าที่ตรวจสอบ' : 'ปิดใช้งานอยู่: การจองใหม่จะรอเจ้าหน้าที่ยืนยันคิวโดยไม่ต้องชำระเงิน'}</small></span><strong>{settings.reservationPaymentEnabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</strong></label> : <p>กำลังโหลดการตั้งค่า...</p>}
    </section>
    <section className="system-setting-card"><div className="system-setting-card__heading"><Settings2 size={26} /><div><h2>MOPH Alert</h2><p>ส่งข้อความยืนยันนัดผ่านหมอพร้อมหลังเจ้าหน้าที่ยืนยันคิว</p></div></div>
      {settings && <><label className="system-setting-toggle"><input aria-label="เปิดใช้ MOPH Alert" checked={settings.mophAlert?.enabled ?? false} disabled={saving || !settings.mophAlert?.encryptionKeyConfigured} type="checkbox" onChange={(event) => void saveMophAlert(event.target.checked)} /><span><b>เปิดใช้ MOPH Alert</b><small>{settings.mophAlert?.encryptionKeyConfigured ? 'ต้องบันทึก client key และ secret key ก่อนเปิดใช้งาน' : 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า MOPH_ALERT_ENCRYPTION_KEY'}</small></span></label><label>Client key<input value={mophClientKey} placeholder={settings.mophAlert?.clientKeyConfigured ? 'ตั้งค่าแล้ว (เว้นว่างเพื่อคงค่าเดิม)' : 'กรอก client key'} onChange={(event) => setMophClientKey(event.target.value)} /></label><label>Secret key<input type="password" value={mophSecretKey} placeholder={settings.mophAlert?.secretKeyConfigured ? 'ตั้งค่าแล้ว (เว้นว่างเพื่อคงค่าเดิม)' : 'กรอก secret key'} onChange={(event) => setMophSecretKey(event.target.value)} /></label><button className="button button--outline" disabled={saving} type="button" onClick={() => void saveMophAlert(settings.mophAlert?.enabled ?? false)}>บันทึก MOPH Alert</button></>}
      <h3>ประวัติการส่ง</h3>{deliveries.length ? <div className="staff-table-wrap"><table><thead><tr><th>คิว</th><th>ผู้รับ</th><th>สถานะ</th><th>ครั้ง</th><th>เหตุขัดข้อง</th><th /></tr></thead><tbody>{deliveries.map((delivery) => <tr key={delivery.id}><td>{delivery.queueNumber}</td><td>{delivery.recipientMasked}</td><td>{delivery.deliveryStatus}</td><td>{delivery.attemptCount}</td><td>{delivery.errorMessage ?? '-'}</td><td>{['FAILED', 'INVALID_RECIPIENT'].includes(delivery.deliveryStatus) && <button className="button button--small" type="button" onClick={() => void retryDelivery(delivery.id)}>ส่งซ้ำ</button>}</td></tr>)}</tbody></table></div> : <p>ยังไม่มีประวัติการส่ง</p>}
    </section>
  </div><Toast onDismiss={dismissToast} toast={toast} /></section>;
}
