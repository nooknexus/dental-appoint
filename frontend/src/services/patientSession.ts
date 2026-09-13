import { useSyncExternalStore } from 'react';

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';

export type PatientSessionInfo = { displayName: string; identityMasked: string; ial: number | null; provider: string };
type PatientAuthState = {
  loaded: boolean;
  patientSso: boolean;
  thaidSso: boolean;
  staffAuthMode: 'mock' | 'provider';
  staffProviderSso: boolean;
  session: PatientSessionInfo | null;
};

let snapshot: PatientAuthState = { loaded: false, patientSso: false, thaidSso: false, staffAuthMode: 'mock', staffProviderSso: false, session: null };
const subscribers = new Set<() => void>();
let requested = false;

function setSnapshot(next: PatientAuthState) {
  snapshot = next;
  subscribers.forEach((listener) => listener());
}

/** โหลดสถานะล็อกอินผู้ป่วย (เรียกจากหน้า /appointment เท่านั้น จุดเดียวที่ต้องรู้ก่อนแสดง UI)
 *  เขียนเฉพาะข้อมูลแสดงผลลง sessionStorage — ห้ามเก็บเลขบัตรประชาชนฝั่ง browser */
export function loadPatientAuth() {
  if (requested) return;
  requested = true;
  void fetch(`${apiBase}/auth/config`).then(async (response) => {
    if (!response.ok) { setSnapshot({ loaded: true, patientSso: false, thaidSso: false, staffAuthMode: 'mock', staffProviderSso: false, session: null }); return; }
    const authConfig = await response.json() as { patientSso?: boolean; thaidSso?: boolean; staffAuthMode?: 'mock' | 'provider'; staffProviderSso?: boolean };
    const staffAuthMode = authConfig.staffAuthMode === 'provider' ? 'provider' : 'mock';
    const staffProviderSso = staffAuthMode === 'provider' && authConfig.staffProviderSso === true;
    const me = await fetch(`${apiBase}/auth/me`, { credentials: 'include' }).then(async (meResponse) => meResponse.ok
      ? await meResponse.json() as { authenticated: boolean; displayName?: string; identityMasked?: string; ial?: number | null; provider?: string }
      : { authenticated: false });
    if (me.authenticated) {
      sessionStorage.setItem('clinic_mock_role', 'PATIENT');
      sessionStorage.setItem('clinic_mock_patient', me.displayName ?? '');
      sessionStorage.setItem('clinic_patient_sso', '1');
      setSnapshot({ loaded: true, patientSso: Boolean(authConfig.patientSso), thaidSso: Boolean(authConfig.thaidSso), staffAuthMode, staffProviderSso, session: { displayName: me.displayName ?? '', identityMasked: me.identityMasked ?? '', ial: me.ial ?? null, provider: me.provider ?? '' } });
    } else {
      sessionStorage.removeItem('clinic_patient_sso');
      setSnapshot({ loaded: true, patientSso: Boolean(authConfig.patientSso), thaidSso: Boolean(authConfig.thaidSso), staffAuthMode, staffProviderSso, session: null });
    }
  }).catch(() => setSnapshot({ ...snapshot, loaded: true }));
}

export function usePatientAuth() {
  return useSyncExternalStore(
    (listener) => { subscribers.add(listener); return () => subscribers.delete(listener); },
    () => snapshot, () => snapshot,
  );
}

/** ผู้ป่วยล็อกอินผ่านหมอพร้อมอยู่ — ฝั่ง server ใช้ identity จาก session เอง */
export function patientSsoActive() { return sessionStorage.getItem('clinic_patient_sso') === '1'; }

export async function patientSsoLogout() {
  if (patientSsoActive()) {
    try { await fetch(`${apiBase}/auth/patient/logout`, { method: 'POST', credentials: 'include' }); } catch { /* ล้างฝั่ง client ต่อได้ */ }
  }
  sessionStorage.removeItem('clinic_patient_sso');
}

/** ใช้ใน test เท่านั้น ล้าง cache ระดับโมดูลก่อน mount หน้า /appointment ซ้ำ */
export function resetPatientAuthCache() {
  requested = false;
  snapshot = { loaded: false, patientSso: false, thaidSso: false, staffAuthMode: 'mock', staffProviderSso: false, session: null };
}
