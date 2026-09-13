import { FormEvent, useRef, useState, useSyncExternalStore } from 'react';
import { Stethoscope } from 'lucide-react';
import { StaffAccessDenied } from '../components/StaffAccessDenied';
import { Toast, useToast } from '../components/Toast';
import { getStaffRole, staffFetch } from '../services/staffAuth';

type Service = { id: number; title: string; category: string };
type Dentist = { id: number; displayName: string; title: 'ทพ.' | 'ทพญ.'; queuePrefix: string; portraitUrl: string | null; active: boolean; serviceIds: number[] };
type BookingFlow = 'PROCEDURE_AND_DENTIST' | 'DENTIST_ONLY' | 'TIME_ONLY';
type Registry = { dentists: Dentist[]; services: Service[]; bookingFlow: BookingFlow };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const imageBase = apiBase.replace(/\/api$/, '');
let registrySnapshot: Registry = { dentists: [], services: [], bookingFlow: 'PROCEDURE_AND_DENTIST' };
const registrySubscribers = new Set<() => void>();

async function fetchRegistry() {
  const role = getStaffRole() ?? 'CLINIC_STAFF';
  const response = await staffFetch(`${apiBase}/staff/dentists`, { headers: { 'x-mock-role': role } });
  if (!response.ok) throw new Error();
  return response.json() as Promise<Registry>;
}

function refreshRegistry() {
  void fetchRegistry().then((registry) => {
    registrySnapshot = registry;
    registrySubscribers.forEach((subscriber) => subscriber());
  }).catch(() => undefined);
}

function subscribeToRegistry(listener: () => void) {
  registrySubscribers.add(listener);
  refreshRegistry();
  return () => registrySubscribers.delete(listener);
}

function getRegistrySnapshot() { return registrySnapshot; }

function DentistServiceEditor({ dentist, services, onSave }: { dentist: Dentist; services: Service[]; onSave: (dentistId: number, serviceIds: number[]) => Promise<void> }) {
  const [selectedServiceIds, setSelectedServiceIds] = useState(dentist.serviceIds);
  const [saving, setSaving] = useState(false);
  const selectedServiceIdSet = new Set(selectedServiceIds);
  const groupedServices = services.reduce<Record<string, Service[]>>((groups, service) => {
    (groups[service.category] ??= []).push(service);
    return groups;
  }, {});
  const toggleService = (serviceId: number) => setSelectedServiceIds((current) => current.includes(serviceId) ? current.filter((id) => id !== serviceId) : [...current, serviceId]);
  const save = async () => {
    setSaving(true);
    try { await onSave(dentist.id, selectedServiceIds); } finally { setSaving(false); }
  };

  return <details className="dentist-services-editor"><summary>เพิ่ม/ลด หัตถการ</summary><div className="dentist-service-checklist">{Object.entries(groupedServices).map(([category, categoryServices]) => <fieldset key={category}><legend>{category}</legend>{categoryServices.map((service) => <label key={service.id}><input type="checkbox" checked={selectedServiceIdSet.has(service.id)} onChange={() => toggleService(service.id)} /> {service.title}</label>)}</fieldset>)}</div><button className="button button--small" type="button" disabled={saving} onClick={() => void save()}>{saving ? 'กำลังบันทึก…' : 'บันทึกหัตถการ'}</button></details>;
}

export function StaffDentistsPage() {
  const role = getStaffRole();
  const { dentists, services, bookingFlow } = useSyncExternalStore(subscribeToRegistry, getRegistrySnapshot, getRegistrySnapshot);
  const { toast, notify, dismissToast } = useToast();
  const [creating, setCreating] = useState(false);
  const [changingStatusId, setChangingStatusId] = useState<number | null>(null);
  const createInFlight = useRef(false);
  const createDentist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createInFlight.current) return;
    createInFlight.current = true;
    const form = new FormData(event.currentTarget);
    setCreating(true);
    try {
      const response = await staffFetch(`${apiBase}/staff/dentists`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-mock-role': role ?? 'CLINIC_STAFF' }, body: JSON.stringify({ displayName: form.get('displayName'), title: form.get('title'), queuePrefix: form.get('queuePrefix') }) });
      const created = response.ok ? await response.json() as { dentist: Dentist } : null;
      const portrait = form.get('portrait');
      const portraitUpload = portrait instanceof File && portrait.size > 0 && created ? await uploadPortrait(created.dentist.id, portrait) : true;
      if (response.ok && portraitUpload) notify('เพิ่มทันตแพทย์ในทะเบียนแล้ว กรุณากำหนดหัตถการก่อนสร้างสล็อต');
      else if (response.ok) notify('เพิ่มทันตแพทย์แล้ว แต่ไม่สามารถอัปโหลดรูปได้', 'error');
      else notify('ไม่สามารถเพิ่มทันตแพทย์ได้ กรุณาตรวจสอบชื่อและ Queue Prefix', 'error');
      if (response.ok) { event.currentTarget.reset(); refreshRegistry(); window.dispatchEvent(new Event('dentist-registry-updated')); }
    } finally { createInFlight.current = false; setCreating(false); }
  };
  const updatePrefix = async (event: FormEvent<HTMLFormElement>, id: number) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await staffFetch(`${apiBase}/staff/dentists/${id}/queue-prefix`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-mock-role': role ?? 'CLINIC_STAFF' }, body: JSON.stringify({ queuePrefix: form.get('queuePrefix') }) });
    if (response.ok) notify('บันทึก Queue Prefix เรียบร้อยแล้ว ระบบจะใช้ค่านี้ในการออกเลขคิวของทันตแพทย์ท่านนี้'); else notify('ไม่สามารถบันทึก Queue Prefix ได้', 'error');
    if (response.ok) refreshRegistry();
  };
  const updateServices = async (dentistId: number, serviceIds: number[]) => {
    const response = await staffFetch(`${apiBase}/staff/dentists/${dentistId}/services`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-mock-role': role ?? 'CLINIC_STAFF' }, body: JSON.stringify({ serviceIds }) });
    if (response.ok) notify('บันทึกหัตถการเรียบร้อยแล้ว การสร้างสล็อตและการจองจะอ้างอิงเฉพาะบริการที่เลือกไว้'); else notify('ไม่สามารถบันทึกหัตถการได้', 'error');
    if (response.ok) refreshRegistry();
  };
  const uploadPortrait = async (dentistId: number, portrait: File) => {
    const data = new FormData();
    data.append('portrait', portrait);
    const response = await staffFetch(`${apiBase}/staff/dentists/${dentistId}/portrait`, { method: 'POST', headers: { 'x-mock-role': role ?? 'CLINIC_STAFF' }, body: data });
    if (response.ok) { refreshRegistry(); window.dispatchEvent(new Event('dentist-registry-updated')); }
    return response.ok;
  };
  const handlePortraitSelection = (dentistId: number, portrait: File) => {
    void (async () => {
      const uploaded = await uploadPortrait(dentistId, portrait);
      if (uploaded) notify('อัปเดตรูปทันตแพทย์แล้ว'); else notify('ไม่สามารถอัปโหลดรูปได้', 'error');
    })();
  };
  const changeStatus = async (dentist: Dentist) => {
    if (changingStatusId !== null) return;
    setChangingStatusId(dentist.id);
    try {
      const response = await staffFetch(`${apiBase}/staff/dentists/${dentist.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-mock-role': role ?? 'CLINIC_STAFF' }, body: JSON.stringify({ active: !dentist.active }) });
      if (response.ok) notify(dentist.active ? 'ปิดใช้งานทันตแพทย์แล้ว จะไม่แสดงในการสร้างสล็อตและหน้าทีม' : 'เปิดใช้งานทันตแพทย์แล้ว'); else notify('ไม่สามารถเปลี่ยนสถานะทันตแพทย์ได้', 'error');
      if (response.ok) { refreshRegistry(); window.dispatchEvent(new Event('dentist-registry-updated')); }
    } finally { setChangingStatusId(null); }
  };

  if (role !== 'IT_STAFF') return <StaffAccessDenied />;
  const canManage = role === 'IT_STAFF';
  const showServices = bookingFlow === 'PROCEDURE_AND_DENTIST';
  const showQueuePrefix = bookingFlow !== 'TIME_ONLY';
  const showQueuePattern = bookingFlow !== 'TIME_ONLY';
  return <article className="staff-page"><div className="container"><p className="eyebrow">{role === 'IT_STAFF' ? 'IT Staff' : 'Clinic Staff'} · Dentist Registry</p><h1>ทะเบียนทันตแพทย์</h1><p>กำหนด Queue Prefix หัตถการ และรูปประจำตัวของทันตแพทย์ เพื่อใช้ในการสร้างสล็อต ตรวจสอบการจอง และแสดงบนหน้าทีม</p><section className="user-admin-card dentist-registry-card"><div className="user-admin-card__heading"><Stethoscope size={25} /><header className="dentist-registry-heading"><h2>กำหนดทันตแพทย์และหัตถการ</h2><small>ใช้ตัวอักษร A–Z, ตัวเลข และเครื่องหมายขีดกลางสำหรับ Queue Prefix; รูปรับ JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB</small></header></div>{canManage && <form className="dentist-prefix-form" onSubmit={createDentist}><h2>เพิ่มทันตแพทย์</h2><label>คำนำหน้า<select defaultValue="ทพ." name="title"><option value="ทพ.">ทพ.</option><option value="ทพญ.">ทพญ.</option></select></label><label>ชื่อทันตแพทย์<input name="displayName" required /></label><label>Queue Prefix<input name="queuePrefix" pattern="[A-Z0-9-]+" required /></label><label>รูปทันตแพทย์<input accept="image/jpeg,image/png,image/webp" name="portrait" type="file" /></label><button className="button button--small" type="submit" disabled={creating}>{creating ? 'กำลังเพิ่ม…' : 'เพิ่มทันตแพทย์'}</button></form>}<div className="staff-table-wrap"><table><thead><tr><th>ทันตแพทย์</th><th>คำนำหน้า</th><th>รูป</th><th>สถานะ</th>{showQueuePrefix && <th>Queue Prefix</th>}{showServices && <th>หัตถการที่ให้บริการ</th>}{showQueuePattern && <th>รูปแบบเลขคิว</th>}<th>จัดการ</th></tr></thead><tbody>{dentists.map((dentist) => { const assignedServiceIdSet = new Set(dentist.serviceIds); const assignedServices = services.filter((service) => assignedServiceIdSet.has(service.id)); return <tr key={dentist.id}><td><b>{dentist.displayName}</b></td><td>{dentist.title}</td><td>{dentist.portraitUrl && <img alt={`รูป ${dentist.displayName}`} className="dentist-portrait-preview" src={`${imageBase}${dentist.portraitUrl}`} />}{canManage && <label className="dentist-portrait-upload">เปลี่ยนรูป<input accept="image/jpeg,image/png,image/webp" onChange={(event) => { const portrait = event.currentTarget.files?.[0]; if (portrait) handlePortraitSelection(dentist.id, portrait); }} type="file" /></label>}</td><td><span className={`status-pill ${dentist.active ? 'status-pill--approved' : 'status-pill--disabled'}`}>{dentist.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span></td>{showQueuePrefix && <td>{canManage && dentist.active ? <form className="dentist-prefix-form" onSubmit={(event) => updatePrefix(event, dentist.id)}><input aria-label={`Queue Prefix ${dentist.displayName}`} defaultValue={dentist.queuePrefix} name="queuePrefix" required /><button className="button button--small" type="submit">บันทึก</button></form> : <span>{dentist.queuePrefix}</span>}</td>}{showServices && <td><div className="dentist-service-tags">{assignedServices.map((service) => <span key={service.id}>{service.title}</span>)}{!assignedServices.length && <small>ยังไม่กำหนดหัตถการ</small>}</div></td>}{showQueuePattern && <td><span className="status-pill status-pill--approved">{dentist.queuePrefix}-001</span></td>}<td>{canManage ? <><button className="button button--small" type="button" disabled={changingStatusId === dentist.id} onClick={() => void changeStatus(dentist)}>{changingStatusId === dentist.id ? 'กำลังบันทึก…' : dentist.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>{dentist.active && showServices && <DentistServiceEditor key={`${dentist.id}-${dentist.serviceIds.join('-')}`} dentist={dentist} services={services} onSave={updateServices} />}</> : <small>ดูข้อมูลได้เท่านั้น</small>}</td></tr>; })}</tbody></table></div></section></div><Toast onDismiss={dismissToast} toast={toast} /></article>;
}
