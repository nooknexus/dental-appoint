import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App';
import { resetPatientAuthCache } from '../services/patientSession';
import { getStaffRole, refreshStaffAuth, resetStaffAuthCache, staffFetch, staffLogout } from '../services/staffAuth';

const json = (body: unknown, status = 200) => Promise.resolve(new Response(
  JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } },
));

describe('ProviderID staff authentication UI', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetPatientAuthCache();
    resetStaffAuthCache();
    vi.unstubAllGlobals();
  });

  it('links the staff login action to ProviderID when provider mode is enabled', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/config')) return json({
        patientSso: false,
        thaidSso: false,
        staffAuthMode: 'provider',
        staffProviderSso: true,
      });
      return json({}, 404);
    }));

    render(<App initialEntries={['/appointment']} />);

    expect(await screen.findByRole('link', { name: 'ลงชื่อเข้าใช้ด้วย Provider ID' }))
      .toHaveAttribute('href', '/api/auth/staff/provider/login');
  });

  it('redirects a pending ProviderID account to a waiting page without rendering the staff sidebar', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/config')) return json({ staffAuthMode: 'provider', staffProviderSso: true });
      if (url.endsWith('/auth/staff/me')) return json({
        authenticated: true,
        staffAuthMode: 'provider',
        id: 91,
        providerIdentity: 'provider-ui-91',
        displayName: 'ทพญ. ทดสอบ รออนุมัติ',
        department: 'โรงพยาบาลทดสอบ',
        hcode: '12345',
        role: 'CLINIC_STAFF',
        status: 'PENDING_APPROVAL',
      });
      return json({}, 404);
    }));

    render(<App initialEntries={['/staff/users']} />);

    expect(await screen.findByRole('heading', { name: 'บัญชีกำลังรอการอนุมัติ' })).toBeInTheDocument();
    expect(screen.getByText('ทพญ. ทดสอบ รออนุมัติ')).toBeInTheDocument();
    expect(screen.getByText(/โรงพยาบาลทดสอบ/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'ผู้ใช้งานและสิทธิ์' })).not.toBeInTheDocument();
  });

  it('revokes the server session with its CSRF token when a pending user logs out', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/config')) return json({ staffAuthMode: 'provider', staffProviderSso: true });
      if (url.endsWith('/auth/staff/me')) return json({
        authenticated: true,
        id: 92,
        providerIdentity: 'provider-ui-92',
        displayName: 'เจ้าหน้าที่รออนุมัติ',
        department: 'โรงพยาบาลทดสอบ',
        hcode: null,
        role: 'CLINIC_STAFF',
        status: 'PENDING_APPROVAL',
      });
      if (url.endsWith('/auth/staff/csrf')) return json({ csrfToken: 'csrf-ui-92' });
      if (url.endsWith('/auth/staff/logout')) {
        expect(init?.method).toBe('POST');
        expect(init?.credentials).toBe('include');
        expect(new Headers(init?.headers).get('x-csrf-token')).toBe('csrf-ui-92');
        return json({ success: true });
      }
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<App initialEntries={['/staff/pending-approval']} />);
    await user.click(await screen.findByRole('button', { name: 'ออกจากระบบ' }));

    expect(await screen.findByRole('heading', { name: 'ระบบจองคิวออนไลน์' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/staff\/logout$/), expect.any(Object));
  });

  it('retries logout once with a refreshed CSRF token instead of reporting a false success', async () => {
    let csrfCalls = 0;
    let logoutCalls = 0;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/config')) return json({ staffAuthMode: 'provider', staffProviderSso: true });
      if (url.endsWith('/auth/staff/me')) return json({
        authenticated: true, id: 95, providerIdentity: 'provider-ui-95', displayName: 'IT', department: 'Clinic', hcode: null,
        role: 'IT_STAFF', status: 'APPROVED',
      });
      if (url.endsWith('/auth/staff/csrf')) return json({ csrfToken: ++csrfCalls === 1 ? 'stale-csrf' : 'fresh-csrf' });
      if (url.endsWith('/auth/staff/logout')) {
        logoutCalls += 1;
        return logoutCalls === 1 ? json({ code: 'CSRF_INVALID' }, 403) : json({ success: true });
      }
      return json({}, 404);
    }));

    await refreshStaffAuth();
    await staffLogout();

    expect(logoutCalls).toBe(2);
    expect(csrfCalls).toBe(2);
    expect(getStaffRole()).toBeNull();
  });

  it('keeps the staff session locally when the server cannot revoke it', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/config')) return json({ staffAuthMode: 'provider', staffProviderSso: true });
      if (url.endsWith('/auth/staff/me')) return json({
        authenticated: true, id: 96, providerIdentity: 'provider-ui-96', displayName: 'IT', department: 'Clinic', hcode: null,
        role: 'IT_STAFF', status: 'APPROVED',
      });
      if (url.endsWith('/auth/staff/csrf')) return json({ csrfToken: 'csrf-ui-96' });
      if (url.endsWith('/auth/staff/logout')) return json({ message: 'logout unavailable' }, 503);
      return json({}, 404);
    }));

    await refreshStaffAuth();

    await expect(staffLogout()).rejects.toThrow('logout unavailable');
    expect(getStaffRole()).toBe('IT_STAFF');
  });

  it('restores a valid manual patient session even when both SSO providers are disabled', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/config')) return json({ patientSso: false, thaidSso: false, staffAuthMode: 'mock', staffProviderSso: false });
      if (url.endsWith('/auth/me')) return json({
        authenticated: true, displayName: 'ผู้ป่วย Manual', identityMasked: '110******3456', ial: null, provider: 'manual',
      });
      return json({}, 404);
    }));

    render(<App initialEntries={['/appointment']} />);

    expect(await screen.findByRole('heading', { name: 'เลือกเมนูบริการ' })).toBeInTheDocument();
  });

  it('uses the server-approved role immediately when a pending account is approved', async () => {
    let meCalls = 0;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/config')) return json({ staffAuthMode: 'provider', staffProviderSso: true });
      if (url.endsWith('/auth/staff/me')) {
        meCalls += 1;
        return json({
          authenticated: true,
          id: 93,
          providerIdentity: 'provider-ui-93',
          displayName: 'เจ้าหน้าที่ที่อนุมัติแล้ว',
          department: 'โรงพยาบาลทดสอบ',
          hcode: null,
          role: 'IT_STAFF',
          status: meCalls === 1 ? 'PENDING_APPROVAL' : 'APPROVED',
        });
      }
      return json({}, 404);
    }));
    const user = userEvent.setup();

    render(<App initialEntries={['/staff/pending-approval']} />);
    await user.click(await screen.findByRole('button', { name: 'ตรวจสอบสถานะอีกครั้ง' }));

    expect(await screen.findByRole('heading', { name: 'ตั้งค่าระบบ' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ผู้ใช้งานและสิทธิ์' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'นัดหมายรอตรวจสอบ' })).not.toBeInTheDocument();
  });

  it('does not expose the mock role selector in provider mode', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/config')) return json({
        patientSso: false,
        thaidSso: false,
        staffAuthMode: 'provider',
        staffProviderSso: true,
      });
      return json({}, 404);
    }));

    render(<App initialEntries={['/staff/role-select']} />);

    expect(await screen.findByRole('link', { name: 'ลงชื่อเข้าใช้ด้วย Provider ID' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'เลือกระดับสิทธิ์ของเจ้าหน้าที่' })).not.toBeInTheDocument();
  });

  it('explains when ProviderID sign-in is rejected for a disabled account', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/config')) return json({
        patientSso: false,
        thaidSso: false,
        staffAuthMode: 'provider',
        staffProviderSso: true,
      });
      return json({}, 404);
    }));

    render(<App initialEntries={['/appointment?staff=error&reason=disabled']} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('บัญชีเจ้าหน้าที่นี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  });

  it('adds session credentials and CSRF while discarding a forged mock role in provider mode', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/config')) return json({ staffAuthMode: 'provider', staffProviderSso: true });
      if (url.endsWith('/auth/staff/me')) return json({
        authenticated: true, id: 94, providerIdentity: 'provider-ui-94', displayName: 'IT', department: 'Clinic', hcode: null,
        role: 'IT_STAFF', status: 'APPROVED',
      });
      if (url.endsWith('/auth/staff/csrf')) return json({ csrfToken: 'csrf-ui-94' });
      if (url.endsWith('/staff/example')) {
        const headers = new Headers(init?.headers);
        expect(init?.credentials).toBe('include');
        expect(headers.get('x-csrf-token')).toBe('csrf-ui-94');
        expect(headers.has('x-mock-role')).toBe(false);
        return json({ ok: true });
      }
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await refreshStaffAuth();
    const response = await staffFetch('/api/staff/example', { method: 'PATCH', headers: { 'x-mock-role': 'CLINIC_STAFF' } });

    expect(response.ok).toBe(true);
  });

  it('keeps the development role selector working in mock mode', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/config')) return json({ staffAuthMode: 'mock', staffProviderSso: false });
      return json({}, 404);
    }));
    const user = userEvent.setup();

    render(<App initialEntries={['/staff/role-select']} />);
    await user.click(await screen.findByRole('button', { name: /เจ้าหน้าที่ไอที/ }));

    expect(await screen.findByRole('heading', { name: 'ตั้งค่าระบบ' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ผู้ใช้งานและสิทธิ์' })).toBeInTheDocument();
  });
});
