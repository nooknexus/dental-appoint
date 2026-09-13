---
name: thaid-login-development
description: "Provides instructions and workflows for developing and integrating ThaiD login functionality into a Next.js application with NextAuth."
---

# ThaiD Login Development

This skill guides ThaiD SSO integration for this Next.js application. The project uses the App Router, Route Handlers, and NextAuth Credentials providers.

Before editing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` because this project uses a newer Next.js version with breaking changes.

## Current Project Shape

ThaiD login is implemented through these files:

- Login UI: `src/app/login/page.tsx`
- ThaiD OIDC helper: `src/lib/thaid.ts`
- NextAuth provider wiring: `src/lib/auth.ts`
- ThaiD login init route: `src/app/api/auth/thaid/init/route.ts`
- ThaiD callback route: `src/app/api/auth/callback/thaid/route.ts`
- NextAuth route: `src/app/api/auth/[...nextauth]/route.ts`
- User table model: `prisma/schema.prisma` model `User`

## Quick Start

Add a ThaiD login button in the login page and redirect to the ThaiD init route.

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { BadgeCheck } from "lucide-react";

export function ThaiDLoginButton({
  disabled,
}: {
  disabled?: boolean;
}) {
  return (
    <Button
      onClick={() => {
        window.location.href = "/api/auth/thaid/init?callbackUrl=%2F";
      }}
      disabled={disabled}
      variant="outline"
      className="w-full h-12 justify-between rounded-lg border-sky-200 bg-white px-4 text-base font-semibold"
    >
      <span>ThaiD</span>
      <BadgeCheck className="size-5 text-sky-700" />
    </Button>
  );
}
```

For this system, the login page should present the identity providers as:

- `ลงทะเบียน/เข้าสู่ระบบ`: MOPH ProviderID
- `เข้าสู่ระบบ`: ThaiD

ThaiD is login-only in this project. If a ThaiD `pid` is not found in `users.username`, show an error telling the user to log in through MOPH ProviderID first to register.

## Authentication Flow

1. **Initiate Login**
   - User clicks the ThaiD button in `src/app/login/page.tsx`.
   - The browser navigates to `/api/auth/thaid/init?callbackUrl=/`.

2. **Create CSRF State and Redirect**
   - `src/app/api/auth/thaid/init/route.ts` generates a random `state`.
   - It stores these HTTP-only cookies for 10 minutes:
     - `thaid_state`
     - `thaid_callback_url`
     - `thaid_redirect_uri`
   - It loads ThaiD OpenID configuration from `THAID_WELL_KNOWN_URL`.
   - It redirects to the discovered `authorization_endpoint` with:
     - `client_id`
     - `redirect_uri`
     - `response_type=code`
     - `scope`
     - `state`

3. **ThaiD Authentication**
   - The user authenticates on ThaiD.
   - ThaiD redirects back to `/api/auth/callback/thaid` with `code` and `state`.

4. **Handle Callback**
   - `src/app/api/auth/callback/thaid/route.ts` verifies returned `state` against the cookie.
   - It deletes the temporary cookies.
   - If valid, it redirects to `/login` with:
     - `code`
     - `provider=thaid`
     - `callbackUrl`
     - `thaidRedirectUri`

5. **Exchange Code through NextAuth**
   - `src/app/login/page.tsx` detects `provider=thaid` and calls:

```tsx
await signIn("thaid-sso", {
  code,
  redirectUri: thaidRedirectUri,
  callbackUrl,
  redirect: false,
});
```

6. **Fetch ThaiD Profile**
   - The `thaid-sso` Credentials provider in `src/lib/auth.ts` calls `authenticateWithThaiD`.
   - `src/lib/thaid.ts` exchanges the authorization code at the discovered `token_endpoint`.
   - It reads claims from `id_token` and, when available, `userinfo_endpoint`.
   - It normalizes profile data into:

```ts
export type ThaidProfile = {
  birthdate?: string;
  email?: string;
  nameEng?: string;
  nameTh?: string;
  pid?: string;
  subject?: string;
  titleTh?: string;
};
```

7. **Find Existing User**
   - The app searches `users.username` by ThaiD `pid`.
   - If found, it updates available profile fields and logs the user in.
   - If not found, it throws `thaid_user_not_registered`.
   - The login page maps that error to:

```ts
"ไม่พบบัญชีผู้ใช้จาก ThaiD กรุณาเข้าสู่ระบบผ่าน MOPH ProviderID เพื่อลงทะเบียนก่อน"
```

## Route Handler Examples

### Init Route

```ts
// src/app/api/auth/thaid/init/route.ts
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { getThaidLoginUrl } from "@/lib/thaid";
import { getPublicBaseUrl } from "@/lib/url";

export async function GET(request: Request) {
  const baseUrl = getPublicBaseUrl(request);
  const redirectUri =
    process.env.THAID_REDIRECT_URI ?? `${baseUrl}/api/auth/callback/thaid`;
  const state = randomBytes(24).toString("base64url");
  const cookieStore = await cookies();

  cookieStore.set("thaid_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });

  return Response.redirect(await getThaidLoginUrl({ redirectUri, state }), 302);
}
```

### Callback Route

```ts
// src/app/api/auth/callback/thaid/route.ts
import { cookies } from "next/headers";
import { getPublicBaseUrl } from "@/lib/url";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("thaid_state")?.value;

  const redirectUrl = new URL("/login", getPublicBaseUrl(request));

  if (!expectedState || expectedState !== returnedState) {
    redirectUrl.searchParams.set("error", "thaid_state_mismatch");
    return Response.redirect(redirectUrl, 302);
  }

  if (!code) {
    redirectUrl.searchParams.set("error", "missing_code");
    return Response.redirect(redirectUrl, 302);
  }

  redirectUrl.searchParams.set("code", code);
  redirectUrl.searchParams.set("provider", "thaid");
  return Response.redirect(redirectUrl, 302);
}
```

## NextAuth Provider Example

```ts
// src/lib/auth.ts
import CredentialsProvider from "next-auth/providers/credentials";
import { authenticateWithThaiD } from "@/lib/thaid";
import { db } from "@/server/db";

CredentialsProvider({
  id: "thaid-sso",
  name: "ThaiD",
  credentials: {
    code: { label: "Authorization Code", type: "text" },
    redirectUri: { label: "Redirect URI", type: "text" },
  },
  async authorize(credentials) {
    const code = credentials?.code?.trim();
    const redirectUri = credentials?.redirectUri?.trim();
    if (!code || !redirectUri) return null;

    const profile = await authenticateWithThaiD({ code, redirectUri });
    if (!profile.pid) return null;

    const existingUser = await db.user.findFirst({
      where: { username: profile.pid },
    });

    if (!existingUser) {
      throw new Error("thaid_user_not_registered");
    }

    return {
      id: existingUser.id.toString(),
      name: existingUser.name_th ?? existingUser.name_eng ?? "ไม่ระบุชื่อ",
      email: existingUser.email,
      role: existingUser.role,
      status: existingUser.status,
    };
  },
});
```

## Configuration

ThaiD configuration belongs in `.env`.

```dotenv
THAID_CLIENT_ID="your_client_id"
THAID_CLIENT_SECRET="your_client_secret"
THAID_REDIRECT_URI="http://localhost:3004/api/auth/callback/thaid"
THAID_SCOPE="pid openid name name_en birthdate address"
# ✅ verified 2026-09-12: well-known ที่ใช้ได้จริงไม่มี /api/v2 นำหน้า (path ด้านล่างเดิมตอบ 404)
THAID_WELL_KNOWN_URL="https://imauth.bora.dopa.go.th/.well-known/openid-configuration"
```

For production, `THAID_REDIRECT_URI` must use the public domain registered with ThaiD:

```dotenv
THAID_REDIRECT_URI="https://your-domain.go.th/api/auth/callback/thaid"
```

## Implementation Rules

- Use Next.js Route Handlers in `src/app/api/**/route.ts`; do not use Pages API routes for this app.
- Use `await cookies()` from `next/headers` because cookies are async in current Next.js.
- Always generate and verify `state` for CSRF protection.
- Keep temporary ThaiD cookies HTTP-only, same-site lax, and short-lived.
- Use `cache: "no-store"` for ThaiD discovery, token exchange, and userinfo fetches.
- ThaiD `pid` maps to `users.username`.
- ThaiD must not auto-create users in this project. Registration happens through MOPH ProviderID.
- Do not overwrite MOPH `provider_id` with ThaiD `sub`; this project uses `provider_id` for MOPH ProviderID.
- Surface missing ThaiD user as `thaid_user_not_registered`.

## Troubleshooting

- `thaid_not_configured`: missing `THAID_CLIENT_ID`, `THAID_CLIENT_SECRET`, or well-known config.
- `thaid_init_failed`: discovery or authorization URL construction failed.
- `thaid_state_mismatch`: callback state did not match the HTTP-only cookie; retry login.
- `missing_code`: ThaiD callback did not include an authorization code.
- `thaid_user_not_registered`: ThaiD login succeeded but `pid` was not found in `users.username`; ask the user to log in through MOPH ProviderID to register first.

## Example JSON Responses

Token endpoint response:

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6..."
}
```

Decoded `id_token` payload:

```json
{
  "sub": "user-subject-identifier",
  "pid": "1234567890123",
  "name": "นายทดสอบ ระบบ",
  "name_en": "Mr. Test System",
  "birthdate": "1990-01-01",
  "iss": "https://imauth.bora.dopa.go.th/api/v2/",
  "aud": "your_client_id",
  "exp": 1678886400,
  "iat": 1678882800
}
```
