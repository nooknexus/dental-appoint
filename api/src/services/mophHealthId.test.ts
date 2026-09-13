import { describe, expect, it, vi } from 'vitest';

import { buildAuthorizeUrl, decodeJwtPayload, exchangeCodeForCitizenToken, getCitizenIdentity, MophAuthError, noncesMatch } from './mophHealthId.js';

const base64urlJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('mophHealthId', () => {
  it('forces a fresh HealthID authentication for the shared authorization URL', () => {
    const url = new URL(buildAuthorizeUrl('one-time-state'));

    expect(url.searchParams.get('is_auth')).toBe('yes');
    expect(url.searchParams.get('state')).toBe('one-time-state');
  });

  describe('exchangeCodeForCitizenToken', () => {
    it('returns the access token when moph.id.th answers status "success" (string)', async () => {
      const fetcher = vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ status: 'success', data: { access_token: 'jwt-token' } }),
        { status: 200 },
      ));
      await expect(exchangeCodeForCitizenToken('the-code', fetcher as unknown as typeof fetch)).resolves.toBe('jwt-token');
      const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
      expect(String(init.body)).toContain('grant_type=authorization_code');
      expect(String(init.body)).toContain('code=the-code');
      expect(init.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' });
    });

    it('fails at the token hop when the body reports the wrong status shape (integer 200)', async () => {
      const fetcher = vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ status: 200, message: 'wrong convention for this host' }),
        { status: 200 },
      ));
      await expect(exchangeCodeForCitizenToken('the-code', fetcher as unknown as typeof fetch))
        .rejects.toMatchObject({ hop: 'token' });
    });

    it('does not expose an upstream message that echoes authorization material', async () => {
      const fetcher = vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ status: 'error', message: 'rejected the-code using client-secret' }),
        { status: 401 },
      ));

      const error = await exchangeCodeForCitizenToken('the-code', fetcher as unknown as typeof fetch).catch((reason: unknown) => reason);

      expect(String(error)).toContain('[token]');
      expect(String(error)).not.toContain('the-code');
      expect(String(error)).not.toContain('client-secret');
    });
  });

  describe('decodeJwtPayload', () => {
    it('decodes the payload segment without verifying the signature', () => {
      const token = `header.${base64urlJson({ exp: 123, scopes_detail: { ial: 1.3 } })}.signature`;
      expect(decodeJwtPayload(token)).toEqual({ exp: 123, scopes_detail: { ial: 1.3 } });
    });

    it('throws a jwt hop error for malformed tokens', () => {
      expect(() => decodeJwtPayload('not-a-jwt')).toThrow(MophAuthError);
    });
  });

  describe('getCitizenIdentity', () => {
    const identityJwt = (scopesDetail: Record<string, unknown>) =>
      `header.${base64urlJson({ scopes_detail: scopesDetail })}.signature`;

    it('reads the 13-digit cid, Thai name and IAL from the token claims', async () => {
      const fetcher = vi.fn();
      await expect(getCitizenIdentity(identityJwt({
        id_card: '1101700203456', name_prefix: 'นาย', name: 'สมชาย', surname: 'ใจดี', ial: 1.3,
      }), fetcher as unknown as typeof fetch)).resolves.toEqual({
        cid: '1101700203456', displayName: 'นายสมชาย ใจดี', ial: 1.3,
      });
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('falls back to the accounts endpoint when the token carries a masked cid', async () => {
      const fetcher = vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ status: 'success', data: { id_card_num: '1101700203456', account_title_th: 'นาย', first_name_th: 'สมชาย', last_name_th: 'ใจดี' } }),
        { status: 200 },
      ));
      await expect(getCitizenIdentity(identityJwt({ id_card: 'xxxxxxx000001', name: 'สมชาย' }), fetcher as unknown as typeof fetch))
        .resolves.toEqual({ cid: '1101700203456', displayName: 'นายสมชาย ใจดี', ial: null });
    });

    it('reports the identity hop when neither the token nor the account yields a full cid', async () => {
      const fetcher = vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ status: 'success', data: { id_card_num: 'xxxxxxx000001' } }),
        { status: 200 },
      ));
      await expect(getCitizenIdentity(identityJwt({ id_card: 'xxxxxxx000001' }), fetcher as unknown as typeof fetch))
        .rejects.toMatchObject({ hop: 'identity' });
    });
  });

  describe('noncesMatch', () => {
    it('requires both values and an exact match', () => {
      expect(noncesMatch('abc', 'abc')).toBe(true);
      expect(noncesMatch('abc', 'abd')).toBe(false);
      expect(noncesMatch(undefined, 'abc')).toBe(false);
      expect(noncesMatch('abc', null)).toBe(false);
    });
  });
});
