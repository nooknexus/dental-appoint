---
name: moph-providerid-integration
description: Comprehensive specification for integrating MOPH HealthID and ProviderID SSO using OAuth 2.0. Includes 3-legged token exchange logic, exact API schemas, real response examples, and troubleshooting for Express.js/React environments.
version: "3.0.0"
author: "Phanupong Dongyen"
---

# MOPH HealthID & ProviderID Integration Skill

> [!IMPORTANT]
> **CRITICAL FOR AI AGENTS:** This integration uses **non-standard** OAuth 2.0 patterns.
> You **MUST** follow the field naming conventions (underscores vs dashes) and JSON nesting rules (`data.data`) exactly as specified below.
> Do **NOT** assume standard OAuth behavior.

เอกสารนี้ระบุ **Specifications** ที่ถูกต้องแม่นยำสำหรับการเชื่อมต่อ HealthID / ProviderID ของกระทรวงสาธารณสุข

## 1. Authentication Concept (The 3-Legged Flow)

ระบบใช้มาตรฐาน OAuth 2.0 และมีการแลกเปลี่ยน Token ต่อเนื่อง 3 ขั้นตอน:

1.  **User Action:** User Login ผ่านหน้าเว็บ MOPH -> ได้ `code` กลับมา
2.  **Back-Channel Step 1:** Backend นำ `code` แลก **HealthID Token** (`moph.id.th`)
3.  **Back-Channel Step 2:** Backend นำ **HealthID Token** แลก **ProviderID Token** (`provider.id.th`)
4.  **Back-Channel Step 3:** Backend นำ **ProviderID Token** ดึง **User Profile** (`provider.id.th`)

> [!CAUTION]
> **Domain แยกกัน!**
> - HealthID (Step 1): `https://moph.id.th`
> - ProviderID (Step 2-3): `https://provider.id.th`
> - ห้ามใช้ `moph.id.th` สำหรับ Step 2-3 (จะได้ 404)

---

## 2. Environment Variables Specification

ต้องกำหนดค่าใน `.env` ให้ครบถ้วน (ห้ามเปลี่ยนชื่อตัวแปร ถ้าจะใช้ Code ตัวอย่างด้านล่าง)

```bash
# === Set 1: HealthID (For Step 1) ===
HEALTH_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
HEALTH_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
HEALTH_REDIRECT_URI=http://localhost:3001/api/auth/healthid  # ต้องตรงกับที่ลงทะเบียนเป๊ะๆ
HEALTH_TOKEN_ENDPOINT=https://moph.id.th/api/v1/token

# === Set 2: ProviderID (For Step 2 & 3) ===
# ⚠️ Domain = provider.id.th (ไม่ใช่ moph.id.th)
PROVIDER_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
PROVIDER_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
PROVIDER_EXCHANGE_ENDPOINT=https://provider.id.th/api/v1/services/token
PROVIDER_USERINFO_ENDPOINT=https://provider.id.th/api/v1/services/profile
```

---

## 3. Implementation Specifications

### Step 0: Frontend Redirect (React/Vite)
ส่งผู้ใช้ไปที่หน้า Login API **(GET)**

**Endpoint:** `https://moph.id.th/oauth/redirect`

**Query Parameters:**
| Param | Value / Description |
| :--- | :--- |
| `client_id` | ค่าจาก `HEALTH_CLIENT_ID` |
| `redirect_uri` | ค่าจาก `HEALTH_REDIRECT_URI` |
| `response_type` | `code` |
| `landing` | (Optional) URL ที่จะให้ Redirect กลับหลังจบ Flow |
| `is_auth` | `yes` (บังคับ login ทุกครั้ง) |

---

### Step 1: Exchange Code for HealthID Token (Backend)

**Endpoint:** `POST https://moph.id.th/api/v1/token`
**Content-Type:** `application/json`

**Request Body:**
```json
{
  "grant_type": "authorization_code",
  "code": "<code>_from_frontend",
  "redirect_uri": "must_match_env_HEALTH_REDIRECT_URI",
  "client_id": "env_HEALTH_CLIENT_ID",
  "client_secret": "env_HEALTH_CLIENT_SECRET"
}
```

**Response Scheme:**
> [!WARNING]
> Response มักจะซ้อน `data` สองชั้น
```json
{
  "data": {
    "access_token": "eyJ0eXAi...",
    "expires_in": 3600,
    "token_type": "Bearer"
  }
}
```
```javascript
// Code ต้อง Handle ทั้ง 2 รูปแบบ:
const healthToken = res.data?.data?.access_token || res.data?.access_token;
```

**👇 Decoded JWT Payload (Inside `access_token`):**
เมื่อนำ `access_token` ที่ได้มา Decode (base64) จะได้ข้อมูลดังนี้:

```json
{
  "iss": "https://moph.id.th",
  "sub": "a1b2c3d4-1234-5678-abcd-ef1234567890",
  "aud": "01970bfc-c8bc-78ea-a3d6-003f01c96c38",
  "iat": 1771386600,
  "exp": 1771390200,
  "scopes": ["id_card", "name", "birthdate"],
  "scopes_detail": {
    "id_card": "1234567890123",
    "hash_id_card": "abc123def456789abcdef0123456789abcdef0123456789abcdef0123456789ab",
    "name_prefix": "นาย",
    "name": "สมชาย",
    "surname": "ใจดี",
    "birthdate": "1985-06-15",
    "mobile_no": "0891234567"
  },
  "pid": "1234567890123",
  "email": "somchai.j@example.com"
}
```

> [!NOTE]
> JWT มีเฉพาะข้อมูลพื้นฐาน (`name`, `surname`, `id_card`)
> **ไม่มี** `name_th`, `name_eng`, `organization`, `hcode`, `hname`
> ต้องใช้ Step 2-3 เพื่อดึงข้อมูลเหล่านี้จาก ProviderID Profile

---

### Step 2: Exchange HealthID Token for ProviderID Token (Backend)

**Endpoint:** `POST https://provider.id.th/api/v1/services/token`
**Content-Type:** `application/json`

> [!CAUTION]
> Parameter Name Trap: ใช้ `secret_key` (underscore)
> และต้องส่ง `token_by: 'Health ID'` (มีเว้นวรรค)

**Request Body:**
```json
{
  "client_id": "env_PROVIDER_CLIENT_ID",
  "secret_key": "env_PROVIDER_CLIENT_SECRET",
  "token_by": "Health ID",
  "token": "<access_token_from_step_1>"
}
```

**✅ Response Example (HTTP 200):**
```json
{
  "status": 200,
  "message": "OK",
  "data": {
    "token_type": "Bearer",
    "expires_in": 86400,
    "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9...",
    "expiration_date": "2026-02-19 10:52:14",
    "account_id": "1365000000000000",
    "result": "Success",
    "username": "somchai_j2025",
    "login_by": "access_token_health_id"
  }
}
```

```javascript
// Code ต้อง Handle:
const providerToken = res.data?.data?.access_token || res.data?.access_token;
```

---

### Step 3: Get User Profile (Backend)

**Endpoint:** `GET https://provider.id.th/api/v1/services/profile`

> [!CAUTION]
> Header Name Trap: ใช้ `client-id` และ `secret-key` (dash/hyphen)
> ต่างจาก Step 2 ที่ใช้ underscore

**Headers:**
```javascript
{
  "client-id": "env_PROVIDER_CLIENT_ID",      // <-- ใช้ dash '-'
  "secret-key": "env_PROVIDER_CLIENT_SECRET", // <-- ใช้ dash '-'
  "Authorization": "Bearer <provider_token_from_step_2>"
}
```

**✅ Response Example (HTTP 200):**
```json
{
  "status": 200,
  "message": "OK",
  "data": {
    "account_id": "1365000000000000",
    "hash_cid": "abc123def456789abcdef0123456789abcdef0123456789abcdef0123456789ab",
    "provider_id": "07ABCD1234567",
    "title_th": "นาย",
    "special_title_th": "อื่นๆ",
    "name_th": "สมชาย ใจดี",
    "name_eng": "MR.SOMCHAI JAIDEE",
    "created_at": "2024-04-30T02:55:04.000Z",
    "title_en": "MR.",
    "special_title_en": "Other",
    "firstname_th": "สมชาย",
    "lastname_th": "ใจดี",
    "firstname_en": "SOMCHAI",
    "lastname_en": "JAIDEE",
    "email": "somchai.j@example.com",
    "date_of_birth": "1985-06-15",
    "organization": [
      {
        "business_id": "4357501332400000",
        "position": "นักวิชาการสาธารณสุข",
        "position_id": "0011",
        "affiliation": "นักวิชาการสาธารณสุข",
        "license_id": null,
        "hcode": "00051",
        "code9": "000005100",
        "hcode9": "AA0000051",
        "level": "3",
        "hname_th": "สำนักงานสาธารณสุขจังหวัดพิษณุโลก",
        "hname_eng": "Provincial Public Health Office",
        "tax_id": "2885556200000000",
        "license_expired_date": null,
        "license_id_verify": false,
        "expertise": null,
        "expertise_id": null,
        "moph_station_ref_code": null,
        "is_private_provider": false,
        "address": {
          "address": null,
          "moo": null,
          "building": null,
          "soi": null,
          "street": null,
          "province": "พิษณุโลก",
          "district": "เมืองพิษณุโลก",
          "sub_district": "ในเมือง",
          "zip_code": "65000"
        },
        "position_type": "นักวิชาการสาธารณสุข"
      }
    ]
  }
}
```

```javascript
// Code ต้อง Handle nested data:
const profile = res.data?.data || res.data;
```

**Data Mapping → User Table:**

| User Table Field | Source (Priority) | Fallback |
| :--- | :--- | :--- |
| `username` | `jwt.scopes_detail.id_card` | — |
| `provider_id` | `jwt.sub` | — |
| `hash_cid` | `profile.hash_cid` | `jwt.scopes_detail.hash_id_card` |
| `name_th` | `profile.name_th` | `profile.firstname_th + lastname_th` → `jwt.name + surname` |
| `name_eng` | `profile.name_eng` | `profile.firstname_en + lastname_en` |
| `email` | `profile.email` | `jwt.email` |
| `title_th` | `profile.title_th` | `jwt.scopes_detail.name_prefix` |
| `hcode` | `profile.organization[0].hcode` | — |
| `hname` | `profile.organization[0].hname_th` | `organization[0].hname_eng` |

---

## 4. Backend Implementation Example (Node.js/Axios)

```javascript
/* eslint-disable camelcase */
router.get('/auth/healthid', async (req, res) => {
    try {
        const { code } = req.query;

        // --- Step 1: Exchange Code → HealthID Token (moph.id.th) ---
        const healthRes = await axios.post(process.env.HEALTH_TOKEN_ENDPOINT, {
            grant_type: 'authorization_code',
            code,
            redirect_uri: process.env.HEALTH_REDIRECT_URI,
            client_id: process.env.HEALTH_CLIENT_ID,
            client_secret: process.env.HEALTH_CLIENT_SECRET
        });
        const healthToken = healthRes.data?.data?.access_token || healthRes.data?.access_token;
        if (!healthToken) throw new Error("Step 1 Failed: No Health Token");

        // Parse JWT for basic user info (id_card, name)
        const jwtPayload = parseJwt(healthToken);
        const jwtDetails = jwtPayload?.scopes_detail;
        const cid = jwtDetails?.id_card || jwtDetails?.pid;

        // --- Step 2: Exchange Token → ProviderID Token (provider.id.th) ---
        const providerRes = await axios.post(process.env.PROVIDER_EXCHANGE_ENDPOINT, {
            client_id: process.env.PROVIDER_CLIENT_ID,
            secret_key: process.env.PROVIDER_CLIENT_SECRET, // Underscore!
            token_by: 'Health ID',
            token: healthToken
        });
        const providerToken = providerRes.data?.data?.access_token || providerRes.data?.access_token;
        if (!providerToken) throw new Error("Step 2 Failed: No Provider Token");

        // --- Step 3: Fetch Profile (provider.id.th) ---
        const profileRes = await axios.get(process.env.PROVIDER_USERINFO_ENDPOINT, {
            headers: {
                'client-id': process.env.PROVIDER_CLIENT_ID, // Dash!
                'secret-key': process.env.PROVIDER_CLIENT_SECRET, // Dash!
                'Authorization': `Bearer ${providerToken}`
            }
        });
        const profile = profileRes.data?.data || profileRes.data;

        // --- Build User Data (Profile first, JWT as fallback) ---
        const org = profile?.organization?.[0] || {};
        const userData = {
            username: cid,                                          // id_card from JWT
            provider_id: jwtPayload.sub,
            hash_cid: profile?.hash_cid || jwtDetails?.hash_id_card,
            name_th: profile?.name_th || `${jwtDetails?.name || ''} ${jwtDetails?.surname || ''}`.trim(),
            name_eng: profile?.name_eng,
            email: profile?.email || jwtPayload.email,
            title_th: profile?.title_th || jwtDetails?.name_prefix,
            hcode: org.hcode,
            hname: org.hname_th || org.hname_eng,
        };

        // ... Upsert User & Login ...

    } catch (error) {
        console.error("SSO Error:", error.response?.data || error.message);
        res.redirect(`${process.env.FRONTEND_URL}?error=auth_failed`);
    }
});
```

---

## 5. Troubleshooting Guide (Common Failures)

### Case 1: "Client authentication failed" (Step 1 or 2)
*   **Cause:** `client_id` หรือ `client_secret` ไม่ถูกต้อง
*   **Fix:** เช็ค .env ว่าก๊อปปี้มาครบถ้วน ไม่มีช่องว่างเกิน

### Case 2: "Redirect URI mismatch" (Step 1)
*   **Cause:** `HEALTH_REDIRECT_URI` ใน .env **ไม่ตรงกับ** ที่ลงทะเบียนไว้ในระบบ MOPH **ทุกตัวอักษร** (รวมถึง http/https และ trailing slash)
*   **Fix:** Log ค่า `process.env.HEALTH_REDIRECT_URI` ออกมาดูเทียบกับ Config หน้าเว็บ

### Case 3: "invalid_request" (Step 2)
*   **Cause:** ส่ง Parameter ผิดชื่อ โดยเฉพาะ `secret_key`
*   **Fix:** ตรวจสอบว่าใน Body ของ Step 2 ใช้ `secret_key` (underscore) **ไม่ใช่** `client_secret` หรือ `cilent_secret`

### Case 4: 404 Not Found (Step 2 or 3)
*   **Cause:** ใช้ domain ผิด — ส่ง request ไปที่ `moph.id.th` แทน `provider.id.th`
*   **Fix:** ตรวจสอบ `.env` ว่า `PROVIDER_EXCHANGE_ENDPOINT` และ `PROVIDER_USERINFO_ENDPOINT` ใช้ domain `https://provider.id.th` ไม่ใช่ `https://moph.id.th`

### Case 5: "Unauthorized" (Step 3)
*   **Cause:** Header ผิดชื่อ
*   **Fix:** ตรวจสอบ Header ของ Step 3 ต้องใช้ `client-id` และ `secret-key` (dash) **ไม่ใช่** underscore

### Case 6: "Cannot read properties of undefined (reading 'access_token')"
*   **Cause:** Code ไม่รองรับ Nested JSON
*   **Fix:** เปลี่ยนจาก `res.data.access_token` เป็น `res.data?.data?.access_token || res.data?.access_token`

### Case 7: ข้อมูลผู้ใช้ไม่ครบ (name_th, hcode, hname เป็น undefined)
*   **Cause:** ใช้ข้อมูลจาก JWT อย่างเดียว (Step 1) โดยไม่ได้เรียก Step 2-3
*   **Fix:** ต้อง implement Step 2-3 เพื่อดึงข้อมูลจาก ProviderID Profile ซึ่งมีข้อมูลครบถ้วน

---

## 6. User Approval & Pending State

หาก User ใหม่ Login เข้ามา สถานะเริ่มต้นควรเป็น `pending`
1.  **Pending UI:** Frontend แสดงหน้า "รอการอนุมัติ" พร้อมปุ่ม Logout
2.  **Polling:** Frontend ยิง API `/auth/me` ทุก 3-5 นาทีเพื่อเช็ค status
3.  **Activation:** เมื่อ status เปลี่ยนเป็น `active` -> Redirect เข้า Dashboard

**Reference Implementation:**
-   Backend: `api/routes/authRoutes.js`
-   Frontend: `frontend/src/components/LoginForm.tsx`
