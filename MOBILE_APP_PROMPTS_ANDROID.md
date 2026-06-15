# SchoolOps Android App — Prompt Pack (Capacitor, Android-only)

Goal: ship an **Android app** for the existing web app at
`https://ledger.monrefugeelc.com`, using **Capacitor** to wrap your current
React SPA. Features: camera/file upload, offline caching, push notifications,
biometric login.

Feed these prompts **in order** to an AI coding assistant (Claude Code, Cursor,
etc.) that has access to your `schoolOps` repo. Finish and test one before moving
to the next. iOS is intentionally left out — everything here is platform-shared,
so you can add iOS later without redoing prompts 1–8.

---

## Before you start — what you need (Android-only)

- **Android Studio** (Windows, Mac, or Linux — no Mac required for Android).
- **Node.js 22** (you already use this).
- A **Google Play Developer account** ($25, one-time) for store submission.
- A **Firebase project** (free) for push notifications.
- A physical **Android phone** for real-device testing (recommended).

> Architectural note baked into these prompts: your web app authenticates with an
> httpOnly **cookie + CSRF token** against a **same-origin** `/api`. Inside a
> native Capacitor webview the app is served from `capacitor://localhost`, so
> those cookies become cross-origin and break. **Prompt 1** fixes this by adding a
> **bearer-token** auth path for mobile without breaking the existing website.
> Do Prompt 1 first.

---

## Prompt 1 — Backend: add a mobile-friendly auth + CORS path

```
I have an Express app (server/) that serves a React SPA and a REST API under
/api. Auth currently uses a JWT stored in an httpOnly cookie, with CSRF
protection (server/middleware/csrf.js) and JWT verification in
server/middleware/auth.js (reads req.cookies.token).

I'm building a native Android app with Capacitor that will load the frontend from
capacitor://localhost and call this API cross-origin at
https://ledger.monrefugeelc.com. Cookies won't work in that context.

Add a parallel BEARER-TOKEN auth path for mobile WITHOUT breaking the existing
cookie-based website auth:

1. In server/middleware/auth.js, update requireAuth so it accepts a token from
   EITHER the existing cookie OR an "Authorization: Bearer <token>" header.
   Same JWT secret, same verification, same user lookup. Cookie path stays
   exactly as-is.
2. On the login route, when the request comes from the mobile app (detect via a
   custom header like "X-Client: mobile"), return the JWT in the JSON response
   body in addition to / instead of setting the cookie, so the app can store it.
3. Exempt bearer-token (mobile) requests from CSRF, since CSRF is only needed for
   cookie-based browser sessions. Keep CSRF enforced for cookie requests.
4. Add CORS configured to allow the Capacitor origins (capacitor://localhost,
   http://localhost, https://localhost) and the existing web origin, with
   credentials support for the web origin.
5. Keep all existing rate limiting working. The mutation limiter already keys by
   user via peekUserId — make sure bearer-token requests are keyed by user too.

Do not change any business logic. Summarize every file you touched and confirm
the existing website login still works.
```

---

## Prompt 2 — Frontend: absolute API base + token storage

```
My frontend is a browser-Babel React SPA in public/ (index.html loads
components/*.js as type="text/babel"). It calls the API at relative paths like
api('/api/...') and relies on the auth cookie.

I'm packaging this same frontend inside an Android Capacitor app, so it must work
when served from capacitor://localhost and talk to
https://ledger.monrefugeelc.com.

Make these changes so the SAME code works both on the website and in the app:

1. Introduce an API base URL. When running inside Capacitor (detect with
   window.Capacitor?.isNativePlatform?.()), use
   "https://ledger.monrefugeelc.com" as the base; otherwise use "" (same-origin,
   unchanged for the website). Route every api() call through this base.
2. In the api() helper, when on native: send "X-Client: mobile", attach
   "Authorization: Bearer <token>" from stored token, and do NOT rely on cookies.
   On web: behave exactly as today.
3. On successful login in the app, store the returned JWT using
   @capacitor/preferences. On logout, clear it. On 401, redirect to login.
4. Don't break the website build at all.

Show me the diff for the api() helper and the login/logout flow.
```

---

## Prompt 3 — Precompile the frontend so it works offline (no CDN at runtime)

```
My public/index.html loads React, ReactDOM, and @babel/standalone from unpkg.com
at runtime and transpiles components/*.js (type="text/babel") in the browser.
This breaks offline use inside the app and is slow on phones.

Create a build step that produces a fully self-contained bundle for the app:

1. Add a build script (e.g. esbuild) that bundles React + ReactDOM locally and
   precompiles all JSX in public/components/*.js and public/app.js into plain JS —
   no @babel/standalone, no unpkg, no network needed to boot the UI.
2. Output to mobile-dist/ which Capacitor will use as its webDir.
3. The website (served by Express from public/) must remain UNTOUCHED and keep
   working as it does today. This build is ONLY for the mobile bundle.
4. Vendor the Google Fonts locally too, so the app renders offline.

Show me how to run the build and confirm the bundle has zero external network
dependencies for booting.
```

---

## Prompt 4 — Scaffold the Capacitor Android project

```
Set up Capacitor in this repo to wrap the mobile bundle from Prompt 3, ANDROID
ONLY (do not add the iOS platform).

1. Install @capacitor/core, @capacitor/cli, @capacitor/android.
2. Run cap init with appId "com.monrefugeelc.schoolops", appName "MRLC Ledger",
   webDir pointing to mobile-dist/.
3. Add ONLY the android platform.
4. Configure capacitor.config to load the bundled assets (NOT a remote URL — we
   want offline), while API calls go to https://ledger.monrefugeelc.com.
5. App display name "MRLC Ledger". Use the existing logo (public/branding/) to
   generate all Android launcher icon densities and an adaptive icon + splash.
6. Give me the exact commands to open the project in Android Studio and run it on
   an emulator and a physical device (USB debugging).

Document everything in an ANDROID.md file at the repo root.
```

---

## Prompt 5 — Camera / file upload

```
The app needs to capture a photo or pick a file from the phone for
receipts/attachments, uploading to my endpoint
POST /api/attachments/:entityType/:entityId (multipart/form-data, field "file",
allowed: png/jpg/jpeg/gif/webp/pdf, handled by server/middleware/multipartUpload.js).

1. Install @capacitor/camera and a file picker plugin.
2. In the attachment upload UI, on native show "Take Photo", "Choose Photo", and
   "Choose File"; on web keep the current file input.
3. Convert the captured/selected file into the multipart upload my API expects,
   including the Authorization bearer header. Respect the server's file-type and
   size limits and surface the server's error message on rejection.
4. Add the Android camera + storage/media permissions to the manifest and request
   them at runtime (Android 13+ photo picker / READ_MEDIA_IMAGES).

Show me the changed component and the manifest/permission entries.
```

---

## Prompt 6 — Offline caching

```
Add basic offline support so the app opens and shows the last loaded data without
a connection.

1. Install @capacitor/network to detect connectivity and show an "Offline" banner.
2. Cache the most recent successful GET /api responses (dashboard summary, student
   roster, current month) in @capacitor/preferences or IndexedDB. When offline,
   render cached data read-only and disable server-dependent actions with a clear
   message.
3. Refresh automatically when connectivity returns.
4. The app shell already works offline (bundled in Prompt 3) — this is about the
   DATA. Keep it read-only; do not build a write/sync queue.

Show me the caching layer and how it integrates with the api() helper.
```

---

## Prompt 7 — Push notifications (Firebase Cloud Messaging)

```
Add push notifications so the school can alert admins/teachers about fee
reminders, attendance gaps, and low stock. Android only for now.

Client (Capacitor):
1. Install @capacitor/push-notifications. Register on login, get the FCM device
   token, and POST it to a new endpoint
   POST /api/notifications/device-token { token, platform: "android" } (bearer auth).
2. Handle foreground and tapped notifications; deep-link the tap to the relevant
   page (Fee Payments, Attendance).
3. Set up Firebase for Android: walk me through creating the Firebase project,
   adding the Android app with package com.monrefugeelc.schoolops, downloading
   google-services.json, and wiring it into the Android project. On Android 13+
   request the POST_NOTIFICATIONS runtime permission.

Server (Express):
4. Add a device_tokens table and the device-token endpoint.
5. Add a service that sends push via the Firebase Admin SDK (FCM) to the relevant
   users' tokens, wired to the existing notification/reminder logic so creating an
   in-app reminder also sends a push.
6. Store the Firebase service-account credentials in an env var; never commit it.

Show me the DB migration, the new endpoint, the send service, and the client code.
```

---

## Prompt 8 — Biometric login (fingerprint / face unlock)

```
Add biometric unlock to the Android app.

1. Install a maintained Capacitor biometric plugin (e.g.
   @aparajita/capacitor-biometric-auth), which uses Android BiometricPrompt.
2. After the user logs in once with username/password, offer to enable biometric
   login. If enabled, store the JWT in secure storage and require fingerprint /
   face unlock to access it on next launch.
3. If biometrics are unavailable or fail, fall back to the normal login screen.
4. Add any required Android manifest entries (USE_BIOMETRIC). Native-only; must
   not affect the website.

Show me the enable/unlock flow and the secure-storage handling.
```

---

## Prompt 9 — Build & publish to Google Play

```
Walk me through publishing this Capacitor Android app to Google Play, step by step:

1. Generate a signed release build (AAB) in Android Studio. Create an upload
   keystore, and tell me exactly how to back it up and what happens if I lose it.
2. Set version code / version name and the applicationId.
3. Create the app in the Google Play Console: store listing, screenshots, icon,
   feature graphic, short/full description.
4. Fill the Data Safety form accurately — the app collects student and financial
   data (names, contacts, fee/payment records) and uses camera + notifications.
   Help me answer each question correctly.
5. Set the content rating questionnaire and target audience (note: it's an admin
   tool for school staff, not aimed at children).
6. Upload to the Internal testing track first, test on my device, then promote to
   Production.
7. List which permissions (camera, media, notifications) need justification and
   how to phrase it.
```

---

## Suggested order & checkpoints

1. **Prompt 1** → website login still works AND `curl` with `Authorization: Bearer`
   hits the API.
2. **Prompts 2–4** → app builds and runs in the Android emulator; you can log in
   and data loads.
3. **Prompts 5–8** → one feature at a time, tested on a real Android phone.
4. **Prompt 9** → Internal testing track, then Production.

Every prompt is written to keep the existing website fully working at each step.

---

## Adding iOS later

When you're ready for iOS, you'll only need: a Mac with Xcode, an Apple Developer
account ($99/yr), `npx cap add ios`, APNs setup for push, and an App Store
submission pass. Prompts 1–8 carry over unchanged — only the build/submit step is
platform-specific.

---

## Quick test shortcut (optional)

To eyeball the app on a phone before doing the bundled build, you can point the
webview at the live site temporarily:

```
Configure Capacitor (Android only) to load the live URL
https://ledger.monrefugeelc.com directly in the webview instead of bundled
assets, as a throwaway test build. Note this won't work offline.
```
