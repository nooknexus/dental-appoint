import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RowDataPacket } from 'mysql2';

import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { resetThaidDiscoveryCache } from './services/thaidAuth.js';

/** ทดสอบ flow ล็อกอินผู้ป่วยด้วย ThaiID ปลายทางจริงของแอป โดย stub well-known/token/userinfo ทั้งหมด */

const testCid = '1101700203456';
const testDisplayName = 'นายทดสอบ ไทยแลนด์';
const base64urlJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

const discoveryDoc = {
  authorization_endpoint: 'https://thaid.test/oauth/authorize',
  token_endpoint: 'https://thaid.test/oauth/token',
  userinfo_endpoint: 'https://thaid.test/oauth/userinfo',
};

function thaidIdToken({ pid = testCid, name = testDisplayName }: { pid?: string; name?: string } = {}) {
  return `header.${base64urlJson({ pid, name, sub: 'thaid-sub' })}.signature`;
}

function stubThaid({ pid = testCid, name = testDisplayName, tokenError, userinfoStatus = 200, withIdToken = true, introspectMinimal = false }: { pid?: string; name?: string; tokenError?: string; userinfoStatus?: number; withIdToken?: boolean; introspectMinimal?: boolean } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('.well-known/openid-configuration')) {
      return new Response(JSON.stringify(discoveryDoc), { status: 200 });
    }
    if (url.endsWith('/oauth/token')) {
      if (tokenError) return new Response(JSON.stringify({ error: tokenError, error_description: 'rejected' }), { status: 400 });
      return new Response(JSON.stringify({ access_token: 'at', ...(withIdToken ? { id_token: thaidIdToken({ pid, name }) } : {}) }), { status: 200 });
    }
    if (url.endsWith('/oauth/userinfo')) {
      if (userinfoStatus !== 200) return new Response(JSON.stringify({ error: 'invalid_request' }), { status: userinfoStatus });
      return new Response(JSON.stringify({ pid, name }), { status: 200 });
    }
    if (url.endsWith('/oauth2/introspect/')) {
      // DOPA introspect จริงตอบแค่ active/scope/sub (sub = เลขบัตร 13 หลัก) ไม่มี pid/name
      if (introspectMinimal) return new Response(JSON.stringify({ active: true, scope: 'pid name name_en birthdate', sub: pid }), { status: 200 });
      return new Response(JSON.stringify({ active: true, pid, name }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
}

function cookieValue(setCookie: string | string[] | undefined, name: string) {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const header = list.find((cookie) => cookie.startsWith(`${name}=`));
  expect(header, `expected a ${name} cookie`).toBeDefined();
  return /([^=]+)=([^;]+)/.exec(header!)![2];
}

async function startLogin(fetchMock: ReturnType<typeof stubThaid>) {
  const login = await request(app).get('/api/auth/patient/thaid/login');
  expect(login.status).toBe(302);
  expect(login.headers.location).toContain('https://thaid.test/oauth/authorize');
  return cookieValue(login.headers['set-cookie'], 'thaid_state');
}

describe('patient ThaiID SSO', () => {
  const original = {
    enabled: config.thaidSsoEnabled,
    clientId: config.thaidClientId,
    clientSecret: config.thaidClientSecret,
    redirectUri: config.thaidRedirectUri,
  };

  beforeAll(() => {
    config.thaidSsoEnabled = true;
    config.thaidClientId = 'test-thaid-client';
    config.thaidClientSecret = 'test-thaid-secret';
    config.thaidRedirectUri = 'https://clinic.test/api/auth/patient/thaid/callback';
    resetThaidDiscoveryCache();
  });

  afterAll(async () => {
    Object.assign(config, original);
    resetThaidDiscoveryCache();
    await pool.query('DELETE FROM patient_registry WHERE patient_identity = ?', [testCid]);
    await pool.query('DELETE FROM patient_sessions WHERE patient_identity = ?', [testCid]);
    vi.unstubAllGlobals();
  });

  it('exposes the ThaiID flag on the auth config endpoint', async () => {
    const result = await request(app).get('/api/auth/config');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ thaidSso: true });
  });

  it('runs login → callback → session and reuses the discovery document across steps', async () => {
    const fetchMock = stubThaid();
    vi.stubGlobal('fetch', fetchMock);

    const state = await startLogin(fetchMock);
    const callback = await request(app)
      .get(`/api/auth/patient/thaid/callback?code=one-time-code&state=${encodeURIComponent(state)}`)
      .set('Cookie', `thaid_state=${state}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain('/appointment?thaid=success');
    const sessionValue = cookieValue(callback.headers['set-cookie'], 'clinic_patient_session');

    const me = await request(app).get('/api/auth/me').set('Cookie', `clinic_patient_session=${sessionValue}`);
    expect(me.body).toMatchObject({
      authenticated: true, role: 'PATIENT', displayName: testDisplayName,
      identityMasked: '110******3456', provider: 'ThaiID',
    });

    const registry = await pool.query<RowDataPacket[]>('SELECT patient_display_name FROM patient_registry WHERE patient_identity = ?', [testCid]);
    expect(registry[0][0]?.patient_display_name).toBe(testDisplayName);

    // discovery ต้องถูกยิงครั้งเดียว (login + callback ใช้ cache เดียวกัน)
    const discoveryCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('.well-known')).length;
    expect(discoveryCalls).toBe(1);

    const logout = await request(app).post('/api/auth/patient/logout').set('Cookie', `clinic_patient_session=${sessionValue}`);
    expect(logout.body).toEqual({ ok: true });
    expect((await request(app).get('/api/auth/me').set('Cookie', `clinic_patient_session=${sessionValue}`)).body.authenticated).toBe(false);
    vi.unstubAllGlobals();
  });

  it('rejects a callback whose state cookie does not match', async () => {
    vi.stubGlobal('fetch', stubThaid());
    const callback = await request(app).get('/api/auth/patient/thaid/callback?code=x&state=tampered')
      .set('Cookie', 'thaid_state=expected');
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain('thaid=error&reason=invalid_state');
    vi.unstubAllGlobals();
  });

  it('maps a failed token exchange to the server reason', async () => {
    const fetchMock = stubThaid({ tokenError: 'invalid_grant' });
    vi.stubGlobal('fetch', fetchMock);
    const state = await startLogin(fetchMock);
    const callback = await request(app).get(`/api/auth/patient/thaid/callback?code=one-time-code&state=${encodeURIComponent(state)}`)
      .set('Cookie', `thaid_state=${state}`);
    expect(callback.headers.location).toContain('thaid=error&reason=server');
    vi.unstubAllGlobals();
  });

  it('reports the identity hop when ThaiID yields no usable pid', async () => {
    const fetchMock = stubThaid({ pid: 'xxxxxxx000001' });
    vi.stubGlobal('fetch', fetchMock);
    const state = await startLogin(fetchMock);
    const callback = await request(app).get(`/api/auth/patient/thaid/callback?code=one-time-code&state=${encodeURIComponent(state)}`)
      .set('Cookie', `thaid_state=${state}`);
    expect(callback.headers.location).toContain('thaid=error&reason=identity');
    vi.unstubAllGlobals();
  });

  it('blocks a suspended patient account from logging in', async () => {
    await pool.query('INSERT INTO patient_registry (patient_identity, patient_display_name, access_status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE access_status = ?', [testCid, testDisplayName, 'BLOCKED', 'BLOCKED']);
    const fetchMock = stubThaid();
    vi.stubGlobal('fetch', fetchMock);
    const state = await startLogin(fetchMock);
    const callback = await request(app).get(`/api/auth/patient/thaid/callback?code=one-time-code&state=${encodeURIComponent(state)}`)
      .set('Cookie', `thaid_state=${state}`);
    expect(callback.headers.location).toContain('thaid=error&reason=blocked');
    await pool.query('DELETE FROM patient_registry WHERE patient_identity = ?', [testCid]);
    vi.unstubAllGlobals();
  });

  it('resolves the pid through introspect when openid scope is absent (no id_token, userinfo 400)', async () => {
    const fetchMock = stubThaid({ userinfoStatus: 400, withIdToken: false });
    vi.stubGlobal('fetch', fetchMock);
    const state = await startLogin(fetchMock);
    const callback = await request(app).get(`/api/auth/patient/thaid/callback?code=one-time-code&state=${encodeURIComponent(state)}`)
      .set('Cookie', `thaid_state=${state}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain('/appointment?thaid=success');
    const sessionValue = cookieValue(callback.headers['set-cookie'], 'clinic_patient_session');
    const me = await request(app).get('/api/auth/me').set('Cookie', `clinic_patient_session=${sessionValue}`);
    expect(me.body).toMatchObject({ authenticated: true, displayName: testDisplayName, provider: 'ThaiID' });
    vi.unstubAllGlobals();
  });

  it('falls back to the introspect sub claim as the citizen id and uses a generic display name', async () => {
    const fetchMock = stubThaid({ introspectMinimal: true, withIdToken: false, userinfoStatus: 400 });
    vi.stubGlobal('fetch', fetchMock);
    const state = await startLogin(fetchMock);
    const callback = await request(app).get(`/api/auth/patient/thaid/callback?code=one-time-code&state=${encodeURIComponent(state)}`)
      .set('Cookie', `thaid_state=${state}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain('/appointment?thaid=success');
    const sessionValue = cookieValue(callback.headers['set-cookie'], 'clinic_patient_session');
    const me = await request(app).get('/api/auth/me').set('Cookie', `clinic_patient_session=${sessionValue}`);
    expect(me.body).toMatchObject({ authenticated: true, displayName: 'ผู้ใช้ ThaiID', identityMasked: '110******3456', provider: 'ThaiID' });
    vi.unstubAllGlobals();
  });

  it('keeps the ThaiID login endpoint closed while the flag is off', async () => {
    config.thaidSsoEnabled = false;
    try {
      expect((await request(app).get('/api/auth/patient/thaid/login')).status).toBe(404);
      expect((await request(app).get('/api/auth/config')).body).toMatchObject({ thaidSso: false });
    } finally {
      config.thaidSsoEnabled = true;
    }
  });
});
