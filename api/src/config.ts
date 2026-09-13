import 'dotenv/config';

function required(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export const config = {
  apiPort: Number(process.env.API_PORT ?? 3001),
  frontendOrigin: required('FRONTEND_ORIGIN', 'http://localhost:3000'),
  authMode: required('AUTH_MODE', 'mock'),
  mophAlertEncryptionKey: process.env.MOPH_ALERT_ENCRYPTION_KEY ?? '',
  // ล็อกอินผู้ป่วยด้วยหมอพร้อม (MOPH HealthID) — ค่า required ตรวจตอนเรียกใช้จริง เพื่อไม่ให้ tsx watch พังตอนบูต
  patientSsoEnabled: process.env.PATIENT_SSO_ENABLED === 'true',
  mophHealthIdBaseUrl: process.env.MOPH_HEALTH_ID_BASE_URL ?? 'https://moph.id.th',
  mophClientId: process.env.MOPH_CLIENT_ID ?? '',
  mophClientSecret: process.env.MOPH_CLIENT_SECRET ?? '',
  mophRedirectUri: process.env.MOPH_REDIRECT_URI ?? '',
  mophLoginScope: process.env.MOPH_LOGIN_SCOPE ?? 'ProviderID',
  minPatientIal: Number(process.env.MIN_PATIENT_IAL ?? 1.3),
  patientSessionHours: Number(process.env.PATIENT_SESSION_HOURS ?? 12),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  // ProviderID ใช้ HealthID client/callback ชุดเดียวกับผู้ป่วย แล้วแลก token ต่อที่ ProviderID
  providerClientId: process.env.PROVIDER_CLIENT_ID ?? '',
  providerClientSecret: process.env.PROVIDER_CLIENT_SECRET ?? '',
  providerExchangeEndpoint: process.env.PROVIDER_EXCHANGE_ENDPOINT ?? 'https://provider.id.th/api/v1/services/token',
  providerUserinfoEndpoint: process.env.PROVIDER_USERINFO_ENDPOINT ?? 'https://provider.id.th/api/v1/services/profile',
  staffSessionHours: Number(process.env.STAFF_SESSION_HOURS ?? 8),
  // ล็อกอินผู้ป่วยด้วย ThaiID (DOPA OIDC) — โครง session เดียวกับหมอพร้อม ต่างแค่ provider
  thaidSsoEnabled: process.env.THAID_SSO_ENABLED === 'true',
  thaidWellKnownUrl: process.env.THAID_WELL_KNOWN_URL ?? 'https://imauth.bora.dopa.go.th/.well-known/openid-configuration',
  thaidClientId: process.env.THAID_CLIENT_ID ?? '',
  thaidClientSecret: process.env.THAID_CLIENT_SECRET ?? '',
  thaidScope: (process.env.THAID_SCOPE ?? 'pid openid name name_en birthdate address').trim(),
  // trim ทั้งคู่กัน trailing space ใน .env ทำให้ scope/redirect_uri ไม่ตรงกับที่ลงทะเบียน (ต้อง match แบบ byte-to-byte)
  thaidRedirectUri: (process.env.THAID_REDIRECT_URI ?? '').trim(),
  database: {
    host: required('DB_HOST', 'localhost'),
    port: Number(process.env.DB_PORT ?? 3306),
    database: required('DB_NAME', 'clinic_appoint_db'),
    user: required('DB_USER', 'root'),
    password: required('DB_PASSWORD', 'root'),
  },
};

/** ค่าจำเป็นของ patient SSO — เรียกก่อนเริ่ม flow เพื่อให้ error ชี้ env ที่ขาด ไม่ใช่ token exchange ที่ล้มเหลว */
export function assertPatientSsoConfigured() {
  const missing = ([
    ['MOPH_CLIENT_ID', config.mophClientId],
    ['MOPH_CLIENT_SECRET', config.mophClientSecret],
    ['MOPH_REDIRECT_URI', config.mophRedirectUri],
  ] as const).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Patient SSO is enabled but missing environment variables: ${missing.join(', ')}`);
}

/** Provider mode ต้องมีทั้ง HealthID และ ProviderID credentials ก่อนเริ่ม redirect */
export function assertProviderSsoConfigured() {
  assertPatientSsoConfigured();
  const missing = ([
    ['PROVIDER_CLIENT_ID', config.providerClientId],
    ['PROVIDER_CLIENT_SECRET', config.providerClientSecret],
    ['PROVIDER_EXCHANGE_ENDPOINT', config.providerExchangeEndpoint],
    ['PROVIDER_USERINFO_ENDPOINT', config.providerUserinfoEndpoint],
  ] as const).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`ProviderID SSO is enabled but missing environment variables: ${missing.join(', ')}`);
}

/** ค่าจำเป็นของ ThaiID SSO — รูปแบบเดียวกับ assertPatientSsoConfigured */
export function assertThaidSsoConfigured() {
  const missing = ([
    ['THAID_CLIENT_ID', config.thaidClientId],
    ['THAID_CLIENT_SECRET', config.thaidClientSecret],
    ['THAID_REDIRECT_URI', config.thaidRedirectUri],
  ] as const).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`ThaiID SSO is enabled but missing environment variables: ${missing.join(', ')}`);
}
