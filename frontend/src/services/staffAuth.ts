import { useSyncExternalStore } from 'react';

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';

export type StaffRole = 'IT_STAFF' | 'CLINIC_STAFF' | 'MANAGER';
export type StaffApprovalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'DISABLED';
export type StaffSessionInfo = {
  id: number | null;
  providerIdentity: string;
  displayName: string;
  department: string;
  hcode: string | null;
  role: StaffRole;
  status: StaffApprovalStatus;
};
type StaffAuthState = { loaded: boolean; mode: 'mock' | 'provider'; session: StaffSessionInfo | null };

let snapshot: StaffAuthState = { loaded: false, mode: 'mock', session: null };
let requested = false;
let requestInFlight: Promise<void> | null = null;
let csrfToken: string | null = null;
const subscribers = new Set<() => void>();

function setSnapshot(next: StaffAuthState) {
  snapshot = next;
  subscribers.forEach((listener) => listener());
}

function mockSession(): StaffSessionInfo | null {
  const role = sessionStorage.getItem('clinic_mock_role');
  if (role !== 'IT_STAFF' && role !== 'CLINIC_STAFF' && role !== 'MANAGER') return null;
  return { id: null, providerIdentity: 'MOCK-PROVIDER-001', displayName: 'เจ้าหน้าที่ทดสอบ', department: '', hcode: null, role, status: 'APPROVED' };
}

export function refreshStaffAuth() {
  if (requestInFlight) return requestInFlight;
  requested = true;
  requestInFlight = fetch(`${apiBase}/auth/config`, { credentials: 'include' })
    .then(async (response) => {
      if (!response.ok) throw new Error('auth config unavailable');
      const authConfig = await response.json() as { staffAuthMode?: 'mock' | 'provider' };
      if (authConfig.staffAuthMode !== 'provider') {
        setSnapshot({ loaded: true, mode: 'mock', session: mockSession() });
        return;
      }
      const meResponse = await fetch(`${apiBase}/auth/staff/me`, { credentials: 'include' });
      const me = meResponse.ok ? await meResponse.json() as StaffSessionInfo & { authenticated: boolean } : { authenticated: false };
      setSnapshot({ loaded: true, mode: 'provider', session: me.authenticated ? me as StaffSessionInfo : null });
    })
    .catch(() => setSnapshot({ loaded: true, mode: 'provider', session: null }))
    .finally(() => { requestInFlight = null; });
  return requestInFlight;
}

export function loadStaffAuth() {
  if (!requested) void refreshStaffAuth();
}

export function useStaffAuth() {
  return useSyncExternalStore(
    (listener) => { subscribers.add(listener); return () => subscribers.delete(listener); },
    () => snapshot,
    () => snapshot,
  );
}

export function getStaffRole() { return snapshot.mode === 'mock' ? mockSession()?.role ?? null : snapshot.session?.role ?? null; }

function isMutation(method?: string) {
  return ['POST', 'PATCH', 'PUT', 'DELETE'].includes((method ?? 'GET').toUpperCase());
}

async function loadCsrfToken() {
  if (csrfToken) return csrfToken;
  const response = await fetch(`${apiBase}/auth/staff/csrf`, { credentials: 'include' });
  if (!response.ok) throw new Error('ไม่สามารถยืนยันความปลอดภัยของเซสชันได้');
  const data = await response.json() as { csrfToken?: string };
  if (!data.csrfToken) throw new Error('ไม่พบ CSRF token');
  csrfToken = data.csrfToken;
  return csrfToken;
}

export async function staffFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (snapshot.mode === 'provider') {
    headers.delete('x-mock-role');
    if (isMutation(init.method)) headers.set('x-csrf-token', await loadCsrfToken());
  } else if (!headers.has('x-mock-role') && snapshot.session?.role) {
    headers.set('x-mock-role', snapshot.session.role);
  }
  const response = await fetch(input, { ...init, credentials: 'include', headers });
  if (response.status === 401 || response.status === 403) {
    const error = await response.clone().json().catch(() => null) as { code?: string } | null;
    if (error?.code === 'CSRF_INVALID') csrfToken = null;
    if (error?.code === 'AUTH_REQUIRED' || error?.code === 'PENDING_APPROVAL' || error?.code === 'ACCOUNT_DISABLED') {
      csrfToken = null;
      await refreshStaffAuth();
    }
  }
  return response;
}

export async function staffLogout() {
  if (snapshot.mode === 'provider') {
    let response = await staffFetch(`${apiBase}/auth/staff/logout`, { method: 'POST' });
    let result = await response.clone().json().catch(() => null) as { code?: string; message?: string } | null;
    if (response.status === 403 && result?.code === 'CSRF_INVALID') {
      response = await staffFetch(`${apiBase}/auth/staff/logout`, { method: 'POST' });
      result = await response.clone().json().catch(() => null) as { message?: string } | null;
    }
    if (!response.ok) throw new Error(result?.message ?? 'ไม่สามารถออกจากระบบได้ กรุณาลองใหม่');
  }
  sessionStorage.removeItem('clinic_mock_role');
  csrfToken = null;
  setSnapshot({ loaded: true, mode: snapshot.mode, session: null });
}

export function staffLandingPath(role: StaffRole) {
  if (role === 'MANAGER') return '/staff/dashboard';
  if (role === 'IT_STAFF') return '/staff/system-settings';
  return '/staff/appointments';
}

export function selectMockStaffRole(role: StaffRole) {
  sessionStorage.setItem('clinic_mock_role', role);
  requested = true;
  setSnapshot({ loaded: true, mode: 'mock', session: mockSession() });
}

export function prepareMockStaffAuth() {
  requested = true;
  setSnapshot({ loaded: true, mode: 'mock', session: mockSession() });
}

export function resetStaffAuthCache() {
  requested = false;
  requestInFlight = null;
  csrfToken = null;
  snapshot = { loaded: false, mode: 'mock', session: null };
}
