import { useSyncExternalStore } from 'react';
import femaleDentistMockup from '../assets/images/team-pimjai-v1.png';
import maleDentistMockup from '../assets/images/team-nattawut-v1.png';
import { teamMembers } from './site';
import type { TeamMember } from '../types';

type RegisteredDentist = { id: number; name: string; title: 'ทพ.' | 'ทพญ.'; specialty?: string; portraitUrl?: string | null };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const imageBase = apiBase.replace(/\/api$/, '');

// เฉพาะทันตแพทย์ที่ยังมีประวัติจริงเขียนไว้ (2 ท่านแรก) ใครนอกเหนือจากนี้แสดงข้อมูลกลางที่ตรงความจริง แทนการยืมประวัติของอีกคน
const curatedDentistBios = new Map(teamMembers.filter((member) => member.role.includes('ทันตแพทย์')).map((member) => [member.name.trim(), member]));

function mockPortraitFor(dentist: RegisteredDentist) {
  return dentist.title === 'ทพญ.'
    ? { image: femaleDentistMockup, imageAlt: `รูปตัวอย่างทันตแพทย์หญิงสำหรับ ${dentist.name}` }
    : { image: maleDentistMockup, imageAlt: `รูปตัวอย่างทันตแพทย์ชายสำหรับ ${dentist.name}` };
}

function toTeamCard(dentist: RegisteredDentist): TeamMember {
  const curated = curatedDentistBios.get(dentist.name.trim());
  const portrait = dentist.portraitUrl
    ? { image: `${imageBase}${dentist.portraitUrl}`, imageAlt: `ภาพ ${dentist.name}` }
    : mockPortraitFor(dentist);
  if (curated) return { ...curated, role: 'ทันตแพทย์', credentials: dentist.specialty ?? curated.credentials, ...portrait };
  return { role: 'ทันตแพทย์', name: dentist.name, credentials: dentist.specialty ?? 'ทันตกรรมทั่วไป', focus: '', specialties: [], availability: '', ...portrait };
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

/** ทำเนียบทีมงานตัวเดียวที่ใช้ร่วมกันทั้งหน้า /team และหน้าแรก — แสดงเฉพาะทันตแพทย์
 *  จากทะเบียนจริง (`GET /api/dentists`, จัดการที่ /staff/dentists) เท่านั้น */
export function useTeamDirectory(): TeamMember[] {
  const registeredDentists = useSyncExternalStore(subscribeToDentistRegistry, getDentistSnapshot, getDentistSnapshot);
  return registeredDentists?.map(toTeamCard) ?? [];
}
