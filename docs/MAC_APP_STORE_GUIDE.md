# Mac App Store Upload & Release Guide (`Vitelglobal Pro Desktop`)

This guide covers the complete end-to-end process for building, signing, uploading, and submitting **Vitelglobal Pro Desktop** to the **Mac App Store** via App Store Connect.

---

## 1. App Identity & Signing Configuration

These values are configured in `package.json` and `build/embedded.provisionprofile` and **must stay aligned**:

| Setting | Value |
| --- | --- |
| **App Store Connect Name** | `Vitelglobal Pro Desktop` |
| **Electron `productName`** | `Vitelglobal Pro Desktop` |
| **Bundle ID (`appId`)** | `com.vitelglobal.desktop` |
| **Helper Bundle ID** | `com.vitelglobal.desktop.helper` |
| **Apple Team Name** | `Vitel Global Communications Llc` |
| **Apple Team ID** | `95ZKEEHT9T` |
| **Provisioning Profile** | `build/embedded.provisionprofile` (`VitelGlobal-Mac-AppStore`) |
| **MAS Entitlements** | `build/entitlements.mas.plist` & `build/entitlements.mas.inherit.plist` |
| **Minimum macOS Version** | `12.0.0` (macOS Monterey, Universal `arm64` + `x86_64`) |
| **Category** | `public.app-category.business` |

---

## 2. App Naming Rules on the Apple App Store

If you ever create another Mac App Store listing in the future, follow these rules:

1. **Global Uniqueness in App Store Connect:**
   - Apple requires every App Store listing name (per primary language) to be unique.
   - Example: `"Vitelglobal Pro"` was rejected if another app or unpublished record already used that exact name. Adding a clear platform/product qualifier like **`Vitelglobal Pro Desktop`** or **`VitelGlobal Desktop`** avoids the collision.
2. **Match Binary Name to Store Name:**
   - `build.productName` in `package.json` controls `CFBundleName` / `CFBundleDisplayName` inside the `.app` and `.pkg`.
   - Always keep `productName` identical to the **App Name** in App Store Connect to avoid App Review metadata mismatch rejections.
3. **Certificate vs. App Name:**
   - Your Apple certificate and `.provisionprofile` lock **Team ID (`95ZKEEHT9T`)** and **Bundle ID (`com.vitelglobal.desktop`)**, not the display name. You only need a new provisioning profile if the **Bundle ID** changes.

---

## 3. Prerequisites on the macOS Build Machine

Building a Mac App Store `.pkg` (`mas` target) **must be done on macOS** (Windows/Linux cannot run Apple `codesign` / `productbuild`).

Ensure the Mac has:
1. **Xcode** (latest stable) + Command Line Tools (`xcode-select --install`).
2. **Node.js 22+** and project dependencies (`npm ci`).
3. **Two Apple Distribution Certificates** installed in **Keychain Access → login**:
   - **`Apple Distribution: Vitel Global Communications Llc (95ZKEEHT9T)`** (signs the `.app` bundle and helpers)
   - **`3rd Party Mac Developer Installer: Vitel Global Communications Llc (95ZKEEHT9T)`** *(or Mac Installer Distribution)* (signs the `.pkg` for App Store upload)
4. **Provisioning Profile** already included at `build/embedded.provisionprofile` (expires `2027-04-28`).
5. **Transporter** app installed from the Mac App Store (or `xcrun altool` / App Store Connect API key `.p8`).

---

## 4. Build the Mac App Store `.pkg`

Run these commands on the Mac inside `exe-file/`:

```bash
npm ci
npm run lint
npm run test:notifications
npm run dist:mas
```

What `npm run dist:mas` does (`electron-builder --mac mas --universal --config.directories.output=dist/mas --publish never`):
- Runs `npm run assets` to regenerate icons and DMG background assets.
- Packages a Universal (`arm64` + `x86_64`) Mac App Store build using:
  - `build/entitlements.mas.plist` (App Sandbox, Network Client/Server, Camera, Microphone/Audio Input, User-Selected/Downloads Read-Write, JIT, Print)
  - `build/entitlements.mas.inherit.plist`
  - `build/embedded.provisionprofile`
- Outputs the signed installer package to:
  - `dist/mas/Vitelglobal Pro Desktop-<version>-universal-mas.pkg`

> **Version Bump Reminder:** Before every new upload to App Store Connect, increment `"version"` in `package.json` (e.g., `1.0.15` → `1.0.16`). Apple rejects duplicate version/build numbers.

---

## 5. Upload to App Store Connect

### Option A: Using Apple Transporter (Recommended)
1. Open **Transporter** on the Mac and sign in with the VitelGlobal Apple Developer / App Store Connect account.
2. Click **+** (Add App) and select `dist/mas/Vitelglobal Pro Desktop-<version>-universal-mas.pkg`.
3. Click **Verify** (optional pre-check) and then **Deliver**.
4. Wait 5–15 minutes for Apple to process the build; it will appear under **App Store Connect → My Apps → Vitelglobal Pro Desktop → TestFlight / macOS App → Build**.

### Option B: Command-Line Upload (API Key)
```bash
xcrun altool --upload-app \
  --type osx \
  --file "dist/mas/Vitelglobal Pro Desktop-1.0.15-universal-mas.pkg" \
  --apiKey <API_KEY_ID> \
  --apiIssuer <ISSUER_UUID>
```

---

## 6. App Store Connect Listing & Demo Login Details (For Apple Review)

In **App Store Connect → macOS App → 1.0 Prepare for Submission**, fill out:

### A. App Information & Privacy
- **Name:** `Vitelglobal Pro Desktop`
- **Category:** Business
- **Privacy Policy URL:** Your public VitelGlobal privacy policy URL (`https://www.vitelglobal.com/...`)
- **App Privacy (Data Collection):** Declare account login info, contacts/directory, audio/video call data, and diagnostics as applicable.

### B. App Review Information → Sign-In Required (Demo Account)
Apple Reviewers **must** be able to sign in and test calling, chat, and meetings without creating a paid account. Check **"Sign-in required"** and provide dedicated, active test credentials:

```text
Demo Login Details (fill with active test account before submitting):
- Login URL / Portal: Built-in app login screen (https://desktop.officemeetings.net/)
- Username / Email: <demo-apple-review@vitelglobal.com>
- Password: <StrongDemoPassword123!>
- Test Extension / Account Role: <e.g., Ext 175 — Active SIP & Chat enabled>
- 2FA / OTP: Disabled for this review account (or provide static bypass code)
```

### C. Review Notes Template (Copy-Paste into App Store Connect)
```text
Hello Apple Review Team,

Thank you for reviewing Vitelglobal Pro Desktop.

How to test the app:
1. Launch Vitelglobal Pro Desktop and sign in using the demo credentials provided above.
2. After login, the app automatically connects to our chat and VoIP/SIP softphone services (you will see the green registered extension indicator in the top bar).
3. Chat & Presence: Click any contact or open a conversation to send a test message.
4. Audio/Video Calls & Meetings: Click the Calls/Dialpad or Meetings tab to place a test call or start a meeting.

Permission Explanations:
- Microphone & Camera: Used strictly for VoIP voice calls and video meetings initiated by the user.
- Screen Recording / System Audio: Used only when the user explicitly clicks "Share Screen" during an active meeting.

Please let us know if you need any additional test extensions or assistance.
```

---

## 7. Pre-Submission Checklist

- [ ] App Store Connect app name is `Vitelglobal Pro Desktop` and Bundle ID is `com.vitelglobal.desktop`.
- [ ] `"version"` in `package.json` is higher than any previously uploaded build.
- [ ] `npm run lint` and `npm run test:notifications` pass with zero errors.
- [ ] `npm run dist:mas` ran cleanly on macOS and produced `dist/mas/Vitelglobal Pro Desktop-<version>-universal-mas.pkg`.
- [ ] Demo account credentials are active, have SIP extension + chat enabled, and have **no** expiring OTP/2FA block.
- [ ] Screenshots (1280×800, 1440×900, 2560×1600, or 2880×1800) show the macOS app cleanly.
