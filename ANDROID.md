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

## Offline support (now set up)

The app is now configured for offline use. `capacitor.config.json` points
`webDir` at `mobile-dist/`, a self-contained bundle produced by
`scripts/build-mobile.js` (React vendored locally, all JSX precompiled — no CDN).
Data caching is built into the API layer (`public/components/utils.js`): the last
successful GET responses are cached, and when the device is offline the app shows
that cached data with an "Offline" banner.

### One-time: deploy the server's CORS/bearer support FIRST

A bundled app runs from `https://localhost`, so it calls your API cross-origin.
That only works if the live server sends the CORS headers (the code for this is
already in `server/index.js`, `server/middleware/auth.js`, etc. — it just has to
be deployed). **Do this before building the bundle, or you'll get "Failed to
fetch" again:**

```bash
# from your machine
git push
# on the VPS
cd /path/to/schoolOps && git pull && pm2 restart all   # or your restart command
```

Verify CORS is live (replace ORIGIN test):

```bash
curl -i -X OPTIONS https://ledger.monrefugeelc.com/api/auth/me \
  -H 'Origin: https://localhost' -H 'Access-Control-Request-Method: GET'
# Look for: Access-Control-Allow-Origin: https://localhost
```

### Build and run the offline bundle

```bash
npm install              # installs the build deps (babel, react for vendoring)
npm run build:mobile     # produces mobile-dist/
npx cap sync             # copies mobile-dist/ into the Android app
npx cap open android     # then press Run
```

Re-run `npm run build:mobile && npx cap copy android` after any change to
`public/`. (`mobile-dist/` is generated and gitignored — don't edit it by hand.)

### Test offline

Log in once while online (so data caches), then enable Airplane mode on the
device/emulator and reopen the app — the shell loads and cached screens render
with the red "Offline" banner.

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
