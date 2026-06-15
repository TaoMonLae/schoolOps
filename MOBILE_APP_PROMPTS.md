# SchoolOps Mobile Apps — Prompt Pack (Capacitor)

Goal: ship **iOS + Android apps** for the existing web app at
`https://ledger.monrefugeelc.com`, using **Capacitor** to wrap your current
React SPA. Features required: camera/file upload, offline caching, push
notifications, biometric login.

Feed these prompts **in order** to an AI coding assistant (Claude Code, Cursor,
etc.) that has access to your `schoolOps` repo. Each prompt is self-contained.
Finish and test one before moving to the next.

---

## Before you start — what you need

- A **Mac with Xcode** (required to build/submit the iOS app — there is no way
  around this for iOS).
- **Android Studio** (for the Android build).
- **Node.js 22** (you already use this).
- An **Apple Developer account** ($99/year) and a **Google Play Developer
  account** ($25 one-time) for store submission.
- A **Firebase project** (free) for push notifications.

> Key architectural note baked into these prompts: your web app currently
> authenticates with an **httpOnly cookie + CSRF token** and talks to a
> **same-origin** `/api`. Inside a native Capacitor webview the app is served
> from `capacitor://localhost`, so those cookies become cross-origin and break.
> Prompt 1 fixes this by adding a **bearer-token** auth path for mobile, without
> breaking the existing website. Do Prompt 1 first.

---

## Prompt 1 — Backend: add a mobile-friendly auth + CORS path

```
I have an Express app (server/) that serves a React SPA and a REST API under
/api. Auth currently uses a JWT stored in an httpOnly cookie, with CSRF
protection (server/middleware/csrf.js) and JWT verification in
server/middleware/auth.js (reads req.cookies.token).

I'm building native iOS/Android apps with Capacitor that will load the frontend
from capacitor://localhost and call this API cross-origin at
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
3. Exempt bearer-token (mobile) requests from CSRF, since CSRF protection is only
   needed for cookie-based browser sessions. Keep CSRF enforced for cookie
   requests.
4. Add CORS configured to allow the Capacitor origins (capacitor://localhost,
   http://localhost, https://localhost) and the existing web origin, with
   credentials support for the web origin. Use the cors package or a small
   middleware.
5. Keep all existing rate limiting working. The mutation limiter already keys by
   user via peekUserId — make sure bearer-token requests are keyed by user too.

Do not change any business logic. Show me a summary of every file you touched
and confirm the existing website login still works.
```

---

## Prompt 2 — Make the frontend work from a native shell (absolute API + token storage)

```
My frontend is a browser-Babel React SPA in public/ (index.html loads
components/*.js as type="text/babel"). It calls the API at relative paths like
api('/api/...') and relies on the auth cookie.

I'm packaging this same frontend inside a Capacitor app, so it must work when
served from capacitor://localhost and talk to https://ledger.monrefugeelc.com.

Make these changes so the SAME code works both on the website and in the app:

1. Introduce an API base URL. When running inside Capacitor (detect with
   window.Capacitor?.isNativePlatform?.() or a build flag), use
   "https://ledger.monrefugeelc.com" as the base; otherwise use "" (same-origin,
   unchanged for the website). Route every api() call through this base.
2. In the api() helper, when on native: send "X-Client: mobile", attach
   "Authorization: Bearer <token>" from stored token, and do NOT rely on cookies.
   On web: behave exactly as today.
3. On successful login in the app, store the returned JWT using
   @capacitor/preferences (or secure storage). On logout, clear it. On 401,
   redirect to the login screen.
4. Don't break the website build at all.

Show me the diff for the api() helper and the login/logout flow.
```

---

## Prompt 3 — Precompile the frontend so it works offline (no CDN at runtime)

```
My public/index.html loads React, ReactDOM, and @babel/standalone from unpkg.com
at runtime, and transpiles components/*.js (type="text/babel") in the browser.

This breaks offline use inside the mobile app and is slow on phones. Create a
build step that produces a fully self-contained bundle for the app:

1. Add a small build script (e.g. esbuild) that bundles React + ReactDOM locally
   and precompiles all JSX in public/components/*.js and public/app.js into plain
   JS — no @babel/standalone, no unpkg, no network needed to boot the UI.
2. Output to a folder like mobile-dist/ that Capacitor will use as its webDir.
3. The website (served by Express from public/) must remain untouched and keep
   working as it does today. This build is ONLY for the mobile bundle.
4. Vendor the Google Fonts locally too, so the app renders offline.

Show me how to run the build and confirm the bundle has zero external network
dependencies for booting.
```

---

## Prompt 4 — Scaffold the Capacitor project

```
Set up Capacitor in this repo to wrap the mobile bundle from Prompt 3.

1. Install @capacitor/core, @capacitor/cli, @capacitor/ios, @capacitor/android.
2. Run cap init with appId "com.monrefugeelc.schoolops", appName "MRLC Ledger",
   and webDir pointing to the mobile-dist/ folder from Prompt 3.
3. Add the ios and android platforms.
4. Configure capacitor.config so the app loads the bundled assets (NOT a remote
   URL — we want offline support), but API calls go to
   https://ledger.monrefugeelc.com (handled in Prompt 2).
5. Set the app display name to "MRLC Ledger", use the existing logo
   (public/branding/) for the app icon and splash screen — generate all required
   icon/splash sizes for both platforms.
6. Give me the exact commands to open the iOS project in Xcode and the Android
   project in Android Studio, and to run on a simulator/emulator.

Document everything in a MOBILE.md file at the repo root.
```

---

## Prompt 5 — Camera / file upload

```
The app needs to let users capture a photo or pick a file from the phone for
receipts/attachments, which then upload to my existing endpoint
POST /api/attachments/:entityType/:entityId (multipart/form-data, field "file",
allowed: png/jpg/jpeg/gif/webp/pdf, handled by server/middleware/multipartUpload.js).

1. Install @capacitor/camera and a file picker plugin.
2. In the attachment upload UI, on native platforms show "Take Photo", "Choose
   Photo", and "Choose File" options; on web keep the current file input.
3. Convert the captured/selected file into the multipart upload my API expects,
   including the Authorization bearer header. Respect the same file-type and
   size limits the server enforces, and show the server's error message on
   rejection.
4. Request camera and photo-library permissions properly, with usage strings in
   Info.plist (iOS) and the Android manifest.

Show me the changed component and the permission entries.
```

---

## Prompt 6 — Offline caching

```
Add basic offline support to the Capacitor app so it opens and shows the last
loaded data without a connection.

1. Install @capacitor/network to detect connectivity and show an "Offline"
   banner when disconnected.
2. Cache the most recent successful GET /api responses (dashboard summary,
   student roster, current month) in @capacitor/preferences or IndexedDB. When
   offline, render the cached data read-only and disable actions that require the
   server (with a clear message).
3. When connectivity returns, refresh automatically.
4. The app shell itself already works offline (bundled in Prompt 3) — this is
   about the DATA. Keep it simple and read-only; do not build a write/sync queue.

Show me the caching layer and how it integrates with the api() helper.
```

---

## Prompt 7 — Push notifications (Firebase)

```
Add push notifications so the school can alert admins/teachers about fee
reminders, attendance gaps, and low stock.

Client (Capacitor):
1. Install @capacitor/push-notifications. Register for push on login, get the
   device token, and POST it to a new backend endpoint
   POST /api/notifications/device-token { token, platform } (bearer auth).
2. Handle foreground and tapped notifications; deep-link the tap to the relevant
   page (e.g. Fee Payments, Attendance).
3. Configure Firebase for Android (google-services.json) and APNs for iOS
   (push capability + APNs key). Walk me through the Firebase + Apple setup steps.

Server (Express):
4. Add a device_tokens table and the device-token endpoint.
5. Add a small service that sends push via Firebase Admin SDK (FCM) to the
   relevant users' tokens. Wire it to the existing notification/reminder logic so
   that when an in-app reminder is created, a push is also sent.
6. Add an env var for the Firebase service-account credentials; never commit it.

Show me the DB migration, the new endpoint, the send service, and the client
registration code.
```

---

## Prompt 8 — Biometric login (Face ID / fingerprint)

```
Add biometric unlock to the Capacitor app.

1. Install a maintained Capacitor biometric plugin (e.g.
   @aparajita/capacitor-biometric-auth).
2. After the user logs in once with username/password, offer to enable biometric
   login. If enabled, store the JWT (or a refresh credential) in secure storage
   and require Face ID / Touch ID / fingerprint to unlock it on next launch.
3. If biometrics are unavailable or fail, fall back to the normal login screen.
4. Add the iOS Face ID usage string (NSFaceIDUsageDescription) and any Android
   manifest entries. This must be native-only and not affect the website.

Show me the enable/unlock flow and the secure-storage handling.
```

---

## Prompt 9 — iOS build & App Store submission

```
Walk me through, step by step, taking this Capacitor app from Xcode to the App
Store:
1. Bundle identifier, signing with my Apple Developer account, and capabilities
   (Push Notifications, Background Modes if needed).
2. App icons, launch screen, version/build numbers.
3. Creating the app in App Store Connect, screenshots, privacy questionnaire
   (it collects student/financial data — help me answer the data-collection
   questions accurately), and the "App Privacy" + export-compliance sections.
4. Archiving and uploading the build, then submitting for review.
5. Because this wraps a web app, list exactly what native value the reviewers
   will see (push, camera, biometrics, offline) so it passes Guideline 4.2
   ("minimum functionality"). Flag anything likely to get rejected.
```

---

## Prompt 10 — Android build & Play Store submission

```
Walk me through publishing this Capacitor app to Google Play:
1. Generating a signed release build (AAB), keystore creation and safe storage.
2. App icons, version code/name.
3. Creating the app in the Play Console, store listing, screenshots, content
   rating, and the Data Safety form (it collects student/financial data — help me
   fill it accurately).
4. Uploading to internal testing first, then production.
5. Any permissions (camera, notifications) that need justification in the listing.
```

---

## Suggested order & checkpoints

1. **Prompt 1** (backend auth/CORS) → verify website login still works AND a
   `curl` with `Authorization: Bearer` hits the API.
2. **Prompt 2–4** → app boots in a simulator, you can log in, data loads.
3. **Prompt 5–8** → features one at a time, testing each on a real device.
4. **Prompt 9–10** → store submissions last.

Keep the existing website fully working at every step — every prompt above is
written to avoid breaking it.

---

## One thing to decide early

There are two ways to wrap a web app in Capacitor:

- **Bundled assets (what these prompts use):** the frontend ships inside the app.
  Required for offline, and far more likely to pass App Store review. More setup
  (Prompts 2–3).
- **Remote URL:** the app just points its webview at
  `https://ledger.monrefugeelc.com`. Trivial to set up, but **cannot work
  offline** and Apple often rejects it as "just a website."

Since you asked for offline + native features, the prompts use the **bundled**
approach. If you ever want the quick remote-URL version for testing, ask the
assistant: *"Configure Capacitor to load the live URL
https://ledger.monrefugeelc.com instead of bundled assets, as a temporary test
build."*
