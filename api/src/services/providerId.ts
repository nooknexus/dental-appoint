import { config } from '../config.js';
import { decodeJwtPayload } from './mophHealthId.js';

export type ProviderProfile = {
  providerIdentity: string;
  hashCid: string | null;
  title: string | null;
  displayName: string;
  email: string | null;
  hcode: string | null;
  department: string;
};

export class ProviderIdError extends Error {
  constructor(public readonly hop: 'exchange' | 'profile', message: string) {
    super(message);
    this.name = 'ProviderIdError';
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};

const textValue = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const firstText = (...values: unknown[]) => values.map(textValue).find((value): value is string => value !== null) ?? null;

async function providerRequest(
  hop: 'exchange' | 'profile',
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
) {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new ProviderIdError(hop, `ProviderID ${hop} request failed`);
  }
  if (!response.ok) throw new ProviderIdError(hop, `ProviderID ${hop} returned HTTP ${response.status}`);
  try {
    const body = asRecord(await response.json());
    return asRecord(body.data ?? body);
  } catch {
    throw new ProviderIdError(hop, `ProviderID ${hop} returned invalid JSON`);
  }
}

/** Step 2: แลก HealthID access token เป็น ProviderID access token */
export async function exchangeProviderToken(healthToken: string, fetcher: typeof fetch = fetch) {
  const body = await providerRequest('exchange', config.providerExchangeEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.providerClientId,
      secret_key: config.providerClientSecret,
      token_by: 'Health ID',
      token: healthToken,
    }),
  }, fetcher);
  const accessToken = textValue(body.access_token);
  if (!accessToken) throw new ProviderIdError('exchange', 'ProviderID exchange response did not include an access token');
  return accessToken;
}

/** Step 3: อ่าน profile และใช้ sub ใน Provider token เป็น identity หลัก */
export async function getProviderProfile(accessToken: string, fetcher: typeof fetch = fetch): Promise<ProviderProfile> {
  const profile = await providerRequest('profile', config.providerUserinfoEndpoint, {
    method: 'GET',
    headers: {
      'client-id': config.providerClientId,
      'secret-key': config.providerClientSecret,
      Authorization: `Bearer ${accessToken}`,
    },
  }, fetcher);
  let claims: Record<string, unknown>;
  try {
    claims = decodeJwtPayload<Record<string, unknown>>(accessToken);
  } catch {
    throw new ProviderIdError('profile', 'ProviderID access token did not include a readable identity');
  }
  const providerIdentity = textValue(claims.sub);
  if (!providerIdentity) throw new ProviderIdError('profile', 'ProviderID access token did not include sub');

  const claimDetails = asRecord(claims.scopes_detail);
  const title = firstText(profile.title_th, profile.title, claimDetails.name_prefix);
  const fullThaiName = textValue(profile.name_th);
  const firstName = firstText(profile.firstname_th, profile.first_name_th, profile.firstname, profile.first_name);
  const lastName = firstText(profile.lastname_th, profile.last_name_th, profile.lastname, profile.last_name);
  const thaiName = fullThaiName ?? [firstName, lastName].filter(Boolean).join(' ');
  const englishName = textValue(profile.name_eng)
    ?? [firstText(profile.firstname_en, profile.first_name_en), firstText(profile.lastname_en, profile.last_name_en)].filter(Boolean).join(' ');
  const tokenName = [textValue(claimDetails.name), textValue(claimDetails.surname)].filter(Boolean).join(' ');
  const organizations = Array.isArray(profile.organization) ? profile.organization : [];
  const organization = asRecord(organizations[0]);

  return {
    providerIdentity,
    hashCid: firstText(profile.hash_cid, claims.hash_cid, claimDetails.hash_id_card),
    title,
    displayName: thaiName || englishName || tokenName || providerIdentity,
    email: firstText(profile.email, claims.email),
    hcode: firstText(organization.hcode),
    department: firstText(organization.hname_th, organization.hname_eng, organization.hname) ?? 'ไม่ระบุหน่วยงาน',
  };
}
