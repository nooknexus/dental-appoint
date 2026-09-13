import { Search, UserRoundX } from 'lucide-react';
import { FormEvent, useState, useSyncExternalStore } from 'react';

import { StaffAccessDenied } from '../components/StaffAccessDenied';
import { Toast, useToast } from '../components/Toast';
import { getStaffRole, staffFetch } from '../services/staffAuth';

type Patient = { patientIdentity: string; patientDisplayName: string; accessStatus: 'ACTIVE' | 'BLOCKED'; bookingCount: number; noShowCount: number };
const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
let patientSnapshot: Patient[] = [];
let patientRegistryRequested = false;
const patientRegistrySubscribers = new Set<() => void>();

function notifyPatientRegistrySubscribers() { patientRegistrySubscribers.forEach((subscriber) => subscriber()); }
async function requestPatients(search: string, role: string) {
  const response = await staffFetch(`${apiBase}/staff/patient-registry?search=${encodeURIComponent(search)}`, { headers: { 'x-mock-role': role } });
  if (!response.ok) throw new Error('Unable to load patient registry');
  const data = await response.json() as { patients: Patient[] };
  patientSnapshot = data.patients;
  notifyPatientRegistrySubscribers();
  return data.patients;
}
function subscribeToPatientRegistry(listener: () => void) {
  patientRegistrySubscribers.add(listener);
  if (!patientRegistryRequested) {
    patientRegistryRequested = true;
    const role = getStaffRole();
    if (role === 'IT_STAFF' || role === 'CLINIC_STAFF') void requestPatients('', role).catch(() => undefined);
  }
  return () => patientRegistrySubscribers.delete(listener);
}
function getPatientSnapshot() { return patientSnapshot; }
async function updatePatientAccess(patient: Patient, role: string) {
  const accessStatus = patient.accessStatus === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE';
  const response = await staffFetch(`${apiBase}/staff/patient-registry/${encodeURIComponent(patient.patientIdentity)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-mock-role': role }, body: JSON.stringify({ accessStatus }) });
  if (!response.ok) return null;
  patientSnapshot = patientSnapshot.map((item) => item.patientIdentity === patient.patientIdentity ? { ...item, accessStatus } : item);
  notifyPatientRegistrySubscribers();
  return accessStatus;
}

export function PatientRegistryPage() {
  const role = getStaffRole();
  const [search, setSearch] = useState('');
  const patients = useSyncExternalStore(subscribeToPatientRegistry, getPatientSnapshot, getPatientSnapshot);
  const { toast, notify, dismissToast } = useToast();
  if (role !== 'CLINIC_STAFF') return <StaffAccessDenied />;
  const load = async (event?: FormEvent) => {
    event?.preventDefault();
    try { const loadedPatients = await requestPatients(search, role); if (!loadedPatients.length) notify('ไม่พบข้อมูลผู้มารับบริการ', 'error'); } catch { notify('ไม่สามารถโหลดทะเบียนผู้มารับบริการได้', 'error'); }
  };
  const update = async (patient: Patient) => {
    const accessStatus = await updatePatientAccess(patient, role);
    if (!accessStatus) return notify('ไม่สามารถเปลี่ยนสถานะผู้ใช้ได้', 'error');
    notify(accessStatus === 'BLOCKED' ? 'บล็อกผู้ใช้แล้ว' : 'ปลดบล็อกผู้ใช้แล้ว');
  };
  return <section className="staff-page"><div className="container"><p className="eyebrow">Staff · Patient Registry</p><h1>ทะเบียนผู้มารับบริการ</h1><p>ค้นหาผู้ป่วย ตรวจสอบประวัติการจอง และระงับสิทธิ์การจองออนไลน์</p><form className="registry-search" onSubmit={load}><input aria-label="ค้นหาผู้มารับบริการ" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ชื่อ หรือรหัสผู้ป่วย" /><button className="button" type="submit"><Search size={17} /> ค้นหา</button></form><div className="staff-table-wrap"><table><thead><tr><th>ผู้มารับบริการ</th><th>จำนวนจอง</th><th>ไม่มาตามนัด</th><th>สิทธิ์ใช้งาน</th><th>จัดการ</th></tr></thead><tbody>{patients.map((patient) => <tr key={patient.patientIdentity}><td><b>{patient.patientDisplayName}</b><br /><small>{patient.patientIdentity}</small></td><td>{patient.bookingCount}</td><td>{patient.noShowCount}</td><td><span className={`status-pill ${patient.accessStatus === 'ACTIVE' ? 'status-pill--approved' : 'status-pill--disabled'}`}>{patient.accessStatus === 'ACTIVE' ? 'ใช้งานได้' : 'ถูกบล็อก'}</span></td><td><button className="button button--small" type="button" onClick={() => void update(patient)}><UserRoundX size={15} /> {patient.accessStatus === 'ACTIVE' ? 'บล็อก' : 'ปลดบล็อก'}</button></td></tr>)}</tbody></table></div></div><Toast onDismiss={dismissToast} toast={toast} /></section>;
}
