import { useSyncExternalStore } from 'react';

export type ClinicType = 'PMC' | 'SMC';

const defaultClinicTypes: ClinicType[] = ['PMC', 'SMC'];
const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
let clinicTypesSnapshot = defaultClinicTypes;
const subscribers = new Set<() => void>();

function normalizeClinicTypes(value: unknown): ClinicType[] {
  if (!Array.isArray(value)) return defaultClinicTypes;
  const enabledTypes = value.filter((type): type is ClinicType => type === 'PMC' || type === 'SMC');
  return enabledTypes.length ? defaultClinicTypes.filter((type) => enabledTypes.includes(type)) : defaultClinicTypes;
}

async function refreshClinicTypes() {
  try {
    const response = await fetch(`${apiBase}/clinic-config`);
    clinicTypesSnapshot = response.ok ? normalizeClinicTypes((await response.json() as { clinicTypes?: unknown }).clinicTypes) : defaultClinicTypes;
  } catch {
    clinicTypesSnapshot = defaultClinicTypes;
  }
  subscribers.forEach((subscriber) => subscriber());
}

function subscribe(listener: () => void) {
  subscribers.add(listener);
  void refreshClinicTypes();
  return () => subscribers.delete(listener);
}

function getSnapshot() { return clinicTypesSnapshot; }

export function useClinicTypes() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

type ClinicHoursRow = { department: string; days: string; hours: string };
/** แหล่งข้อมูลเดียวของช่วงเวลาให้บริการ ผูกกับ system_settings.clinic_types (แก้ที่หน้า /staff/system-settings)
 *  ใช้ร่วมกันทั้ง label แบบบรรทัดเดียว (clinicHoursLabel) และตารางแยกแถว (clinicHoursRows) */
const clinicHoursByType: Record<ClinicType, ClinicHoursRow[]> = {
  PMC: [{ department: 'ในเวลา', days: 'จันทร์–ศุกร์', hours: '08:30–16:30 น.' }],
  SMC: [
    { department: 'นอกเวลา', days: 'จันทร์–ศุกร์', hours: '16:30–20:30 น.' },
    { department: 'นอกเวลา', days: 'เสาร์–อาทิตย์', hours: '08:30–16:30 น.' },
  ],
};

export function clinicHoursRows(clinicTypes: ClinicType[]): ClinicHoursRow[] {
  return clinicTypes.flatMap((type) => clinicHoursByType[type]);
}

export function clinicHoursLabel(clinicTypes: ClinicType[]) {
  return clinicTypes.map((type) => type === 'PMC'
    ? 'PMC · ในเวลา จันทร์–ศุกร์ 08:30–16:30 น.'
    : 'SMC · นอกเวลา จันทร์–ศุกร์ 16:30–20:30 น. และเสาร์–อาทิตย์ 08:30–16:30 น.').join(' · ');
}
