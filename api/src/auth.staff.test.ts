import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RowDataPacket } from 'mysql2';

import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

function cookieValue(setCookie: string | string[] | undefined, name: string) {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const header = list.find((cookie) => cookie.startsWith(`${name}=`));
  expect(header, `expected a ${name} cookie`).toBeDefined();
  return /([^=]+)=([^;]+)/.exec(header!)![2];
}

const providerIdentity = 'provider-integration-001';
const providerJwt = `header.${Buffer.from(JSON.stringify({ sub: providerIdentity, hash_cid: 'hash-integration' })).toString('base64url')}.signature`;

function stubProviderFlow() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/v1/token') && url.includes('moph.id.th')) {
      return new Response(JSON.stringify({ status: 'success', data: { access_token: 'health-token-for-provider' } }), { status: 200 });
    }
    if (url.endsWith('/api/v1/services/token')) {
      return new Response(JSON.stringify({ data: { access_token: providerJwt } }), { status: 200 });
    }
    if (url.endsWith('/api/v1/services/profile')) {
      return new Response(JSON.stringify({ data: {
        title_th: 'ทันตแพทย์', name_th: 'พรทิพย์ ทดสอบ', firstname_th: 'พรทิพย์', lastname_th: 'ทดสอบ',
        email: 'provider.integration@example.test',
        organization: [{ hcode: '99999', hname_th: 'คลินิกทดสอบ ProviderID' }],
      } }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
}

describe('staff ProviderID SSO', () => {
  const original = {
    authMode: config.authMode,
    mophClientId: config.mophClientId,
    mophClientSecret: config.mophClientSecret,
    mophRedirectUri: config.mophRedirectUri,
    providerClientId: config.providerClientId,
    providerClientSecret: config.providerClientSecret,
    cookieSecure: config.cookieSecure,
  };

  beforeAll(() => {
    config.authMode = 'provider';
    config.mophClientId = 'health-client';
    config.mophClientSecret = 'health-secret';
    config.mophRedirectUri = 'https://clinic.test/api/auth/patient/moph/callback';
    config.providerClientId = 'provider-client';
    config.providerClientSecret = 'provider-secret';
    config.cookieSecure = true;
  });

  afterAll(async () => {
    Object.assign(config, original);
    vi.unstubAllGlobals();
    await pool.query('DELETE FROM staff_sessions WHERE staff_user_id IN (SELECT id FROM staff_users WHERE provider_identity = ?)', [providerIdentity]).catch(() => undefined);
    await pool.query('DELETE FROM staff_users WHERE provider_identity = ?', [providerIdentity]);
    await pool.query('DELETE FROM staff_oauth_attempts').catch(() => undefined);
  });

  it('publishes provider staff auth mode without exposing credentials', async () => {
    const result = await request(app).get('/api/auth/config');

    expect(result.status).toBe(200);
    expect(result.body).toEqual(expect.objectContaining({
      staffAuthMode: 'provider',
      staffProviderSso: true,
    }));
    expect(JSON.stringify(result.body)).not.toContain('health-secret');
    expect(JSON.stringify(result.body)).not.toContain('provider-secret');
  });

  it('starts ProviderID login with the shared HealthID redirect and a staff flow cookie', async () => {
    const login = await request(app).get('/api/auth/staff/provider/login');

    expect(login.status).toBe(302);
    expect(login.headers.location).toContain('https://moph.id.th/oauth/redirect');
    expect(login.headers.location).toContain(encodeURIComponent(config.mophRedirectUri));
    expect(new URL(login.headers.location).searchParams.get('is_auth')).toBe('yes');
    expect(cookieValue(login.headers['set-cookie'], 'moph_oauth_nonce')).toBeTruthy();
    expect(decodeURIComponent(cookieValue(login.headers['set-cookie'], 'moph_auth_flow'))).toBe('staff');
  });

  it('creates a pending account, enforces approval and CSRF, then revokes the session on logout', async () => {
    vi.stubGlobal('fetch', stubProviderFlow());
    const login = await request(app).get('/api/auth/staff/provider/login');
    const nonce = cookieValue(login.headers['set-cookie'], 'moph_oauth_nonce');
    const flow = cookieValue(login.headers['set-cookie'], 'moph_auth_flow');

    const callback = await request(app)
      .get(`/api/auth/patient/moph/callback?code=provider-code&state=${encodeURIComponent(nonce)}`)
      .set('Cookie', [`moph_oauth_nonce=${nonce}`, `moph_auth_flow=${flow}`]);

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe(`${config.frontendOrigin}/staff/pending-approval`);
    const session = cookieValue(callback.headers['set-cookie'], 'clinic_staff_session');
    const csrfCookie = cookieValue(callback.headers['set-cookie'], 'clinic_staff_csrf');
    for (const name of ['clinic_staff_session', 'clinic_staff_csrf']) {
      const cookie = [callback.headers['set-cookie']].flat().find((item) => String(item).startsWith(`${name}=`));
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain(`Max-Age=${config.staffSessionHours * 3600}`);
    }
    const authCookies = [`clinic_staff_session=${session}`, `clinic_staff_csrf=${csrfCookie}`];
    const [storedSessions] = await pool.query<RowDataPacket[]>(
      'SELECT session_id_hash AS sessionHash, csrf_token_hash AS csrfHash FROM staff_sessions WHERE session_id_hash = SHA2(?, 256)',
      [session],
    );
    expect(storedSessions).toHaveLength(1);
    expect(storedSessions[0].sessionHash).not.toBe(session);
    expect(storedSessions[0].csrfHash).not.toBe(csrfCookie);

    const pendingMe = await request(app).get('/api/auth/staff/me').set('Cookie', authCookies);
    expect(pendingMe.body).toMatchObject({
      authenticated: true,
      providerIdentity,
      displayName: 'พรทิพย์ ทดสอบ',
      department: 'คลินิกทดสอบ ProviderID',
      hcode: '99999',
      role: 'CLINIC_STAFF',
      status: 'PENDING_APPROVAL',
    });

    const [created] = await pool.query<RowDataPacket[]>(
      'SELECT provider_identity, provider_hash_cid, provider_hcode, approval_status FROM staff_users WHERE provider_identity = ?',
      [providerIdentity],
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      provider_identity: providerIdentity,
      provider_hash_cid: 'hash-integration',
      provider_hcode: '99999',
      approval_status: 'PENDING_APPROVAL',
    });

    const denied = await request(app).get('/api/staff/users')
      .set('Cookie', authCookies)
      .set('x-mock-role', 'IT_STAFF');
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('PENDING_APPROVAL');

    await pool.query("UPDATE staff_users SET role = 'IT_STAFF', approval_status = 'APPROVED' WHERE provider_identity = ?", [providerIdentity]);
    const approvedMe = await request(app).get('/api/auth/staff/me').set('Cookie', authCookies);
    expect(approvedMe.body).toMatchObject({ authenticated: true, role: 'IT_STAFF', status: 'APPROVED' });
    expect((await request(app).get('/api/staff/users').set('Cookie', authCookies)).status).toBe(200);

    const csrf = await request(app).get('/api/auth/staff/csrf').set('Cookie', authCookies);
    expect(csrf.status).toBe(200);
    expect(csrf.body.csrfToken).toEqual(expect.any(String));

    const staffUserId = Number(created[0].id ?? (await pool.query<RowDataPacket[]>('SELECT id FROM staff_users WHERE provider_identity = ?', [providerIdentity]))[0][0].id);
    const withoutCsrf = await request(app).patch(`/api/staff/users/${staffUserId}`)
      .set('Cookie', authCookies)
      .send({ role: 'IT_STAFF', status: 'APPROVED' });
    expect(withoutCsrf.status).toBe(403);
    expect(withoutCsrf.body.code).toBe('CSRF_INVALID');

    const withCsrf = await request(app).patch(`/api/staff/users/${staffUserId}`)
      .set('Cookie', authCookies)
      .set('x-csrf-token', csrf.body.csrfToken)
      .send({ role: 'IT_STAFF', status: 'APPROVED' });
    expect(withCsrf.status).toBe(200);

    await pool.query("UPDATE staff_users SET role = 'MANAGER' WHERE provider_identity = ?", [providerIdentity]);
    const forgedRole = await request(app).get('/api/staff/users')
      .set('Cookie', authCookies)
      .set('x-mock-role', 'IT_STAFF');
    expect(forgedRole.status).toBe(403);
    expect(forgedRole.body.code).toBe('ROLE_FORBIDDEN');
    await pool.query("UPDATE staff_users SET role = 'IT_STAFF' WHERE provider_identity = ?", [providerIdentity]);

    expect((await request(app).post('/api/auth/staff/logout').set('Cookie', authCookies)).body.code).toBe('CSRF_INVALID');
    expect((await request(app).post('/api/auth/staff/logout')
      .set('Cookie', authCookies)
      .set('x-csrf-token', csrf.body.csrfToken)).body).toEqual({ ok: true });
    expect((await request(app).get('/api/auth/staff/me').set('Cookie', authCookies)).body.authenticated).toBe(false);
  });

  it('preserves a disabled account decision during profile refresh and creates no session', async () => {
    await pool.query("UPDATE staff_users SET role = 'MANAGER', approval_status = 'DISABLED' WHERE provider_identity = ?", [providerIdentity]);
    vi.stubGlobal('fetch', stubProviderFlow());
    const login = await request(app).get('/api/auth/staff/provider/login');
    const nonce = cookieValue(login.headers['set-cookie'], 'moph_oauth_nonce');
    const flow = cookieValue(login.headers['set-cookie'], 'moph_auth_flow');

    const callback = await request(app)
      .get(`/api/auth/patient/moph/callback?code=provider-code&state=${encodeURIComponent(nonce)}`)
      .set('Cookie', [`moph_oauth_nonce=${nonce}`, `moph_auth_flow=${flow}`]);

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe(`${config.frontendOrigin}/appointment?staff=error&reason=disabled`);
    const callbackCookies = Array.isArray(callback.headers['set-cookie']) ? callback.headers['set-cookie'] : [callback.headers['set-cookie']].filter(Boolean);
    expect(callbackCookies.some((cookie) => String(cookie).startsWith('clinic_staff_session='))).toBe(false);
    const [users] = await pool.query<RowDataPacket[]>(
      'SELECT role, approval_status AS status, display_name AS displayName FROM staff_users WHERE provider_identity = ?',
      [providerIdentity],
    );
    expect(users[0]).toMatchObject({ role: 'MANAGER', status: 'DISABLED', displayName: 'พรทิพย์ ทดสอบ' });
    await pool.query("UPDATE staff_users SET role = 'IT_STAFF', approval_status = 'APPROVED' WHERE provider_identity = ?", [providerIdentity]);
  });

  it('rejects an expired staff session', async () => {
    vi.stubGlobal('fetch', stubProviderFlow());
    const login = await request(app).get('/api/auth/staff/provider/login');
    const nonce = cookieValue(login.headers['set-cookie'], 'moph_oauth_nonce');
    const flow = cookieValue(login.headers['set-cookie'], 'moph_auth_flow');
    const callback = await request(app)
      .get(`/api/auth/patient/moph/callback?code=provider-code&state=${encodeURIComponent(nonce)}`)
      .set('Cookie', [`moph_oauth_nonce=${nonce}`, `moph_auth_flow=${flow}`]);
    const session = cookieValue(callback.headers['set-cookie'], 'clinic_staff_session');
    const [users] = await pool.query<RowDataPacket[]>('SELECT id FROM staff_users WHERE provider_identity = ?', [providerIdentity]);
    await pool.query('UPDATE staff_sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE staff_user_id = ?', [users[0].id]);

    const me = await request(app).get('/api/auth/staff/me').set('Cookie', [`clinic_staff_session=${session}`]);

    expect(me.body).toEqual({ authenticated: false, staffAuthMode: 'provider' });
  });

  it('atomically consumes a staff OAuth state so the same callback cannot be replayed', async () => {
    vi.stubGlobal('fetch', stubProviderFlow());
    const login = await request(app).get('/api/auth/staff/provider/login');
    const nonce = cookieValue(login.headers['set-cookie'], 'moph_oauth_nonce');
    const flow = cookieValue(login.headers['set-cookie'], 'moph_auth_flow');
    const callbackUrl = `/api/auth/patient/moph/callback?code=provider-code&state=${encodeURIComponent(nonce)}`;
    const cookies = [`moph_oauth_nonce=${nonce}`, `moph_auth_flow=${flow}`];

    expect((await request(app).get(callbackUrl).set('Cookie', cookies)).status).toBe(302);
    const replay = await request(app).get(callbackUrl).set('Cookie', cookies);

    expect(replay.status).toBe(302);
    expect(replay.headers.location).toBe(`${config.frontendOrigin}/appointment?staff=error&reason=invalid_state`);
  });

  it('rejects missing, wrong and expired staff OAuth state', async () => {
    vi.stubGlobal('fetch', stubProviderFlow());
    const missingLogin = await request(app).get('/api/auth/staff/provider/login');
    const missingNonce = cookieValue(missingLogin.headers['set-cookie'], 'moph_oauth_nonce');
    const missingFlow = cookieValue(missingLogin.headers['set-cookie'], 'moph_auth_flow');
    const missing = await request(app).get('/api/auth/patient/moph/callback?code=provider-code')
      .set('Cookie', [`moph_oauth_nonce=${missingNonce}`, `moph_auth_flow=${missingFlow}`]);
    expect(missing.headers.location).toContain('reason=invalid_state');

    const wrong = await request(app).get('/api/auth/patient/moph/callback?code=provider-code&state=wrong')
      .set('Cookie', [`moph_oauth_nonce=${missingNonce}`, `moph_auth_flow=${missingFlow}`]);
    expect(wrong.headers.location).toContain('reason=invalid_state');

    const expiredLogin = await request(app).get('/api/auth/staff/provider/login');
    const expiredNonce = cookieValue(expiredLogin.headers['set-cookie'], 'moph_oauth_nonce');
    const expiredFlow = cookieValue(expiredLogin.headers['set-cookie'], 'moph_auth_flow');
    await pool.query('UPDATE staff_oauth_attempts SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE state_hash = SHA2(?, 256)', [expiredNonce]);
    const expired = await request(app).get(`/api/auth/patient/moph/callback?code=provider-code&state=${encodeURIComponent(expiredNonce)}`)
      .set('Cookie', [`moph_oauth_nonce=${expiredNonce}`, `moph_auth_flow=${expiredFlow}`]);
    expect(expired.headers.location).toContain('reason=invalid_state');
  });

  it('rejects an unauthenticated portrait upload before Multer writes a file', async () => {
    const marker = `unauthorized-provider-${Date.now()}.png`;
    let created: string[] = [];
    try {
      const result = await request(app).post('/api/staff/dentists/1/portrait')
        .attach('portrait', Buffer.from('not-a-real-image'), { filename: marker, contentType: 'image/png' });
      created = (await readdir(join(process.cwd(), 'uploads'))).filter((name) => name.endsWith(marker));

      expect(result.status).toBe(401);
      expect(result.body.code).toBe('AUTH_REQUIRED');
      expect(created).toEqual([]);
    } finally {
      await Promise.all(created.map((name) => unlink(join(process.cwd(), 'uploads', name))));
    }
  });
});
