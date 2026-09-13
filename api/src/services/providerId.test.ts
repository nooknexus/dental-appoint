import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../config.js';
import { exchangeProviderToken, getProviderProfile } from './providerId.js';

const jwt = (payload: Record<string, unknown>) =>
  `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

describe('ProviderID Step 2 and Step 3', () => {
  const original = {
    clientId: config.providerClientId,
    clientSecret: config.providerClientSecret,
    exchangeEndpoint: config.providerExchangeEndpoint,
    userinfoEndpoint: config.providerUserinfoEndpoint,
  };

  beforeEach(() => {
    config.providerClientId = 'provider-client';
    config.providerClientSecret = 'provider-secret';
    config.providerExchangeEndpoint = 'https://provider.test/api/v1/services/token';
    config.providerUserinfoEndpoint = 'https://provider.test/api/v1/services/profile';
  });

  afterEach(() => {
    Object.assign(config, original);
    vi.restoreAllMocks();
  });

  it('exchanges a HealthID token using the exact ProviderID Step 2 JSON contract', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { access_token: 'provider-token' } }),
      { status: 200 },
    ));

    await expect(exchangeProviderToken('health-token', fetcher as unknown as typeof fetch))
      .resolves.toBe('provider-token');

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://provider.test/api/v1/services/token');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({
      client_id: 'provider-client',
      secret_key: 'provider-secret',
      token_by: 'Health ID',
      token: 'health-token',
    });
  });

  it('reads the ProviderID profile with the exact Step 3 headers and maps the primary organization', async () => {
    const accessToken = jwt({ sub: 'provider-123', hash_cid: 'hashed-cid' });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        title_th: 'นายแพทย์',
        name_th: 'ทดสอบ ระบบ',
        firstname_th: 'ชื่อสำรอง',
        lastname_th: 'นามสกุลสำรอง',
        email: 'doctor@example.test',
        organization: [{ hcode: '12345', hname_th: 'โรงพยาบาลทดสอบ' }],
      },
    }), { status: 200 }));

    await expect(getProviderProfile(accessToken, fetcher as unknown as typeof fetch)).resolves.toEqual({
      providerIdentity: 'provider-123',
      hashCid: 'hashed-cid',
      title: 'นายแพทย์',
      displayName: 'ทดสอบ ระบบ',
      email: 'doctor@example.test',
      hcode: '12345',
      department: 'โรงพยาบาลทดสอบ',
    });

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://provider.test/api/v1/services/profile');
    expect(init.headers).toEqual({
      'client-id': 'provider-client',
      'secret-key': 'provider-secret',
      Authorization: `Bearer ${accessToken}`,
    });
  });

  it('supports an access token and profile returned at the response root', async () => {
    const providerToken = jwt({ sub: 'provider-root' });
    const exchange = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ access_token: providerToken }),
      { status: 200 },
    ));
    const profile = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      firstname_th: 'ไม่มี', lastname_th: 'หน่วยงาน',
    }), { status: 200 }));

    await expect(exchangeProviderToken('health-token', exchange as unknown as typeof fetch))
      .resolves.toBe(providerToken);
    await expect(getProviderProfile(providerToken, profile as unknown as typeof fetch))
      .resolves.toMatchObject({
        providerIdentity: 'provider-root',
        displayName: 'ไม่มี หน่วยงาน',
        department: 'ไม่ระบุหน่วยงาน',
      });
  });

  it('falls back to the Provider token name while keeping the title separate', async () => {
    const accessToken = jwt({
      sub: 'provider-token-name',
      scopes_detail: { name_prefix: 'นางสาว', name: 'สุขใจ', surname: 'ทดสอบ' },
    });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));

    await expect(getProviderProfile(accessToken, fetcher as unknown as typeof fetch)).resolves.toMatchObject({
      providerIdentity: 'provider-token-name',
      title: 'นางสาว',
      displayName: 'สุขใจ ทดสอบ',
    });
  });

  it('ignores blank primary profile values and falls back to the English organization name', async () => {
    const accessToken = jwt({
      sub: 'provider-blank-values',
      email: 'fallback@example.test',
      scopes_detail: { name_prefix: 'นาย', name: 'ชื่อจากโทเคน', surname: 'นามสกุล' },
    });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      title_th: ' ', name_th: '', firstname_th: ' ', lastname_th: '', email: ' ',
      organization: [{ hcode: '77777', hname_th: ' ', hname_eng: 'English Clinic' }],
    } }), { status: 200 }));

    await expect(getProviderProfile(accessToken, fetcher as unknown as typeof fetch)).resolves.toMatchObject({
      providerIdentity: 'provider-blank-values',
      title: 'นาย',
      displayName: 'ชื่อจากโทเคน นามสกุล',
      email: 'fallback@example.test',
      hcode: '77777',
      department: 'English Clinic',
    });
  });

  it('applies a timeout signal and sanitizes upstream failures', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetcher = vi.fn().mockRejectedValue(new Error('provider-secret health-token'));

    const error = await exchangeProviderToken('health-token', fetcher as unknown as typeof fetch).catch((reason: unknown) => reason);

    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
    expect(error).toMatchObject({ name: 'ProviderIdError', hop: 'exchange', message: 'ProviderID exchange request failed' });
    expect(JSON.stringify(error)).not.toContain('provider-secret');
    expect(JSON.stringify(error)).not.toContain('health-token');
  });
});
