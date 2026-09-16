import { useSyncExternalStore } from 'react';
import { teamMembers } from './site';
import type { TeamMember } from '../types';

type RegisteredDentist = { id: number; name: string; title: 'ทพ.' | 'ทพญ.'; specialty?: string; portraitUrl?: string | null };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const imageBase = apiBase.replace(/\/api$/, '');

// เฉพาะทันตแพทย์ที่ยังมีประวัติจริงเขียนไว้ (2 ท่านแรก) ใครนอกเหนือจากนี้แสดงข้อมูลกลางที่ตรงความจริง แทนการยืมประวัติของอีกคน
const curatedDentistBios = new Map(teamMembers.filter((member) => member.role.includes('ทันตแพทย์')).map((member) => [member.name.trim(), member]));
const supportTeamMembers = teamMembers.filter((member) => !member.role.includes('ทันตแพทย์'));

function toTeamCard(dentist: RegisteredDentist): TeamMember {
  const curated = curatedDentistBios.get(dentist.name.trim());
  if (curated) return { ...curated, image: dentist.portraitUrl ? `${imageBase}${dentist.portraitUrl}` : curated.image, imageAlt: dentist.portraitUrl ? `ภาพ ${dentist.name}` : curated.imageAlt };
  return { role: 'ทันตแพทย์ทั่วไป', name: dentist.name, credentials: dentist.specialty ?? 'ทันตกรรมทั่วไป', focus: '', specialties: [], availability: '', image: dentist.portraitUrl ? `${imageBase}${dentist.portraitUrl}` : '', imageAlt: dentist.portraitUrl ? `ภาพ ${dentist.name}` : '' };
}

async function loadRegisteredDentists(): Promise<RegisteredDentist[]> {
  const response = await fetch(`${apiBase}/dentists`);
  if (!response.ok) return [];
  const data = await response.json();
  return data?.dentists ?? [];
}

let dentistSnapshot: RegisteredDentist[] | null = null;
let dentistLoadStarted = false;
const dentistSubscribers = new Set<() => void>();

function refreshPublicDentists() {
  void loadRegisteredDentists().then((dentists) => {
    dentistSnapshot = dentists;
    dentistSubscribers.forEach((subscriber) => subscriber());
  }).catch(() => undefined);
}

function subscribeToDentistRegistry(listener: () => void) {
  dentistSubscribers.add(listener);
  const refresh = () => refreshPublicDentists();
  window.addEventListener('dentist-registry-updated', refresh);
  if (!dentistLoadStarted) {
    dentistLoadStarted = true;
    refreshPublicDentists();
  }
  return () => { dentistSubscribers.delete(listener); window.removeEventListener('dentist-registry-updated', refresh); };
}

function getDentistSnapshot() { return dentistSnapshot; }

/** ทำเนียบทีมงานตัวเดียวที่ใช้ร่วมกันทั้งหน้า /team และหน้าแรก — ทันตแพทย์มาจากทะเบียนจริง
 *  (`GET /api/dentists`, จัดการที่ /staff/dentists) ต่อด้วยทีมสนับสนุนที่ยังเป็นข้อมูลกลาง (data/site.ts) */
export function useTeamDirectory(): TeamMember[] {
  const registeredDentists = useSyncExternalStore(subscribeToDentistRegistry, getDentistSnapshot, getDentistSnapshot);
  const dentistCards = registeredDentists === null ? [...curatedDentistBios.values()] : registeredDentists.map(toTeamCard);
  return [...dentistCards, ...supportTeamMembers];
}
