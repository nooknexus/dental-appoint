import { CheckCircle2, SlidersHorizontal } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { StaffAccessDenied } from '../components/StaffAccessDenied';
import { Toast, useToast } from '../components/Toast';
import { getStaffRole, staffFetch } from '../services/staffAuth';

type Service = { id: number; title: string; category: string; durationMinutes: number; priceLabel: string; active: boolean };
type Settings = { services: Service[]; dentists: { id: number; displayName: string; queuePrefix: string }[]; permissions: string[] };
const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
let settingsSnapshot: Settings | null = null;
let settingsRequested = false;
const settingsSubscribers = new Set<() => void>();
async function fetchSettings() { const response = await staffFetch(`${apiBase}/staff/settings`, { headers: { 'x-mock-role': 'IT_STAFF' } }); if (!response.ok) throw new Error(); return await response.json() as Settings; }
function refreshSettings() { settingsRequested = true; void fetchSettings().then((settings) => { settingsSnapshot = settings; settingsSubscribers.forEach((subscriber) => subscriber()); }).catch(() => undefined); }
function subscribeToSettings(listener: () => void) { settingsSubscribers.add(listener); if (!settingsRequested) refreshSettings(); return () => settingsSubscribers.delete(listener); }
function getSettingsSnapshot() { return settingsSnapshot; }

export function StaffAdminPage() {
  const role = getStaffRole();
  const settings = useSyncExternalStore(subscribeToSettings, getSettingsSnapshot, getSettingsSnapshot);
  const { toast, notify, dismissToast } = useToast();
  const updateService = async (service: Service, active: boolean) => { const response = await staffFetch(`${apiBase}/staff/services/${service.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-mock-role': 'IT_STAFF' }, body: JSON.stringify({ active }) }); if (!response.ok) { notify('ไม่สามารถบันทึกสถานะหัตถการได้', 'error'); return; } notify(`${active ? 'เปิด' : 'ปิด'}ให้บริการ ${service.title} เรียบร้อยแล้ว`); refreshSettings(); };
  if (role !== 'IT_STAFF') return <StaffAccessDenied />;
  const groups = settings?.services.reduce<Record<string, Service[]>>((result, service) => { (result[service.category] ??= []).push(service); return result; }, {}) ?? {};
  return <section className="staff-page"><div className="container"><p className="eyebrow">IT Staff · Service Administration</p><h1>ประเภทบริการ</h1><p>กำหนดหัตถการที่เปิดให้บริการ โดยรายการที่ปิดใช้งานจะไม่แสดงในขั้นตอนการจองคิว</p><div className="service-category-grid">{Object.entries(groups).map(([category, services]) => <section className="service-category-card" key={category}><div><SlidersHorizontal size={22} /><h2>{category}</h2></div>{services.map((service) => <label className="procedure-toggle" key={service.id}><input checked={Boolean(service.active)} type="checkbox" onChange={(event) => void updateService(service, event.target.checked)} /><span><b>{service.title}</b><small>{service.durationMinutes} นาที · ราคา {service.priceLabel}</small></span><CheckCircle2 aria-hidden="true" size={19} /></label>)}</section>)}</div></div><Toast onDismiss={dismissToast} toast={toast} /></section>;
}
