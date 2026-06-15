# MRLC Ledger — Android App (Capacitor) Setup

This repo is now pre-wired for an Android app. The backend mobile auth (bearer
token, CSRF exemption, CORS) and the frontend bridge are already done, so you can
go straight to scaffolding the Android project.

## What's already done (you can skip Prompts 1–4)

**Backend (server/)** — already in the codebase:
- `requireAuth` accepts an `Authorization: Bearer <token>` header *or* the website
  cookie (`server/middleware/auth.js`).
- Login returns the JWT in the response body when the request sends
  `X-Client: mobile`, and skips setting a cookie (`server/routes/auth.js`).
- CSRF is exempt for bearer-token requests (`server/middleware/csrf.js`).
- CORS allows the Capacitor origins (`capacitor://localhost`, `https://localhost`,
  etc.) and is mounted in `server/index.js`.

**Frontend (public/)** — just added:
- `public/components/utils.js` detects native (Capacitor), sets
  `window.API_BASE = 'https://ledger.monrefugeelc.com'`, attaches the bearer token
  and `X-Client: mobile` header on native, and stores/reads the token in
  `localStorage`. On the website everything behaves exactly as before.
- `public/app.js` saves the token on login and clears it on logout.
- `capacitor.config.ts` (repo root) — appId `com.monrefugeelc.schoolops`,
  app name "MRLC Ledger", `webDir: 'public'`.

## Prerequisites

- Node.js 22 (already used here)
- Android Studio (Windows / Mac / Linux — no Mac required)
- A physical Android phone with USB debugging (recommended) or an emulator

## 1. Install Capacitor

```bash
npm install @capacitor/core
npm install -D @capacitor/cli
npm install @capacitor/android
```

`capacitor.config.ts` already exists, so you do **not** need to run `cap init`.

## 2. Add the Android platform

```bash
npx cap add android
npx cap sync
```

## 3. Open and run

```bash
npx cap open android
```

In Android Studio, pick your device/emulator and press Run. The app loads your
frontend and talks to `https://ledger.monrefugeelc.com`. Log in with your normal
credentials — on native the server returns a token, which the app stores.

> This first build needs internet to boot (React/Babel load from a CDN). That's
> expected. See "Going offline" below.

## 4. After any frontend change

```bash
npx cap copy android   # push updated public/ into the app
# or: npx cap sync android   (also updates native plugins)
```

## Going offline (next step)

`webDir` is currently `public`, which still pulls React + Babel from a CDN at
runtime. For real offline support, do **Prompt 3** in
`MOBILE_APP_PROMPTS_ANDROID.md`: precompile the frontend into a self-contained
`mobile-dist/` (no CDN), then change `webDir` in `capacitor.config.ts` to
`mobile-dist` and re-run `npx cap sync`.

## Then continue with the prompt pack

- Prompt 5 — camera / file upload
- Prompt 6 — offline data caching
- Prompt 7 — push notifications (Firebase)
- Prompt 8 — biometric login
- Prompt 9 — build a signed AAB and publish to Google Play

## Quick sanity check (optional, from a computer)

Confirm the API accepts a bearer token (replace TOKEN):

```bash
# 1. Get a token as the mobile client would:
curl -s -X POST https://ledger.monrefugeelc.com/api/auth/login \
  -H 'Content-Type: application/json' -H 'X-Client: mobile' \
  -d '{"username":"YOUR_USER","password":"YOUR_PASS"}'

# 2. Use the returned token:
curl -s https://ledger.monrefugeelc.com/api/auth/me \
  -H 'Authorization: Bearer TOKEN'
```

If step 2 returns your user, the mobile auth path works end-to-end.
