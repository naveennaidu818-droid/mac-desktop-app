# Complete Mac App Store Upload & Submission Guide (`Vitelglobal Pro Desktop`)

This is the **complete, zero-skipped-steps** guide for building, uploading, configuring App Store Connect, providing Demo Login Details, and submitting **Vitelglobal Pro Desktop** to the **Mac App Store**.

---

## 1. App Identity & Signing Reference

Keep these exact values aligned across `package.json`, `build/embedded.provisionprofile`, and App Store Connect:

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
| **Primary Category** | `Business` (`public.app-category.business`) |

---

## 2. Step-by-Step: Getting the Signed `.pkg` File

### Option A: Download from GitHub Actions (When Building from Windows)
1. Push your `exe-file` changes to `main` (or tag `v*`).
2. Open **GitHub → Actions → Build Mac App Store (MAS) release** (`.github/workflows/release-mas.yml`).
3. Click **Run workflow** (branch `main`) and wait for the job **`Build and sign Universal Mac App Store (MAS) package`** to turn green.
4. Scroll down to **Artifacts** on the workflow run page and download the MAS package artifact.
5. Unzip the downloaded `.zip` to get:
   `Vitelglobal Pro Desktop-<version>-universal-mas.pkg`

### Option B: Build Directly on a Mac
On a Mac with Xcode + `Apple Distribution: Vitel Global Communications Llc (95ZKEEHT9T)` + `3rd Party Mac Developer Installer` certificates in Keychain:
```bash
npm ci
npm run lint
npm run test:notifications
npm run dist:mas
```
Output file: `dist/mas/Vitelglobal Pro Desktop-<version>-universal-mas.pkg`

> **Important for every update:** Always increment `"version"` in `package.json` (e.g., `1.0.15` → `1.0.16`) before building a new `.pkg`, otherwise App Store Connect rejects the upload as a duplicate version.

---

## 3. Step-by-Step: Upload the `.pkg` to App Store Connect

1. On a Mac, open the **Transporter** app (install from the Mac App Store if not installed).
2. Sign in with your **VitelGlobal Apple Developer / App Store Connect** account.
3. Click **+** (Add App) and select `Vitelglobal Pro Desktop-<version>-universal-mas.pkg`.
4. Click **Verify** (optional pre-check) and then click **Deliver**.
5. Wait **5–15 minutes** for Apple to process the binary. You will receive an email when the build finishes processing and is available in App Store Connect.

*(CLI alternative using App Store Connect API Key):*
```bash
xcrun altool --upload-app \
  --type osx \
  --file "dist/mas/Vitelglobal Pro Desktop-1.0.15-universal-mas.pkg" \
  --apiKey <API_KEY_ID> \
  --apiIssuer <ISSUER_UUID>
```

---

## 4. Step-by-Step: App Store Connect Setup (Do Not Miss Any Section)

Log in to **App Store Connect → My Apps → Vitelglobal Pro Desktop** and complete **every section** in the left sidebar from top to bottom:

### Step 4.1: App Information (Left Sidebar → General → App Information)
- **Name:** `Vitelglobal Pro Desktop`
- **Subtitle (optional, max 30 chars):** `Enterprise Chat, Voice & Video`
- **Primary Language:** `English (U.S.)`
- **Category:**
  - **Primary:** `Business`
  - **Secondary (optional):** `Productivity`
- **Content Rights:** Select *"Does not contain, show, or access third-party content"* (or *"Yes, it has all necessary rights"* if applicable to your organization).
- **Age Rating:** Click **Set Age Rating** → answer **No** to all restricted content questions → result will be **4+**.
- **License Agreement:** Standard Apple EULA (default).

### Step 4.2: Pricing and Availability (Left Sidebar → Monetization → Pricing and Availability)
- **Price:** `Free` ($0.00) — *(Enterprise users log in with their existing VitelGlobal account)*.
- **Availability:** Select **All Countries or Regions** (or your target countries).
- **App Distribution Methods:** **Public** (or Private/Unlisted if only for specific organizations).

### Step 4.3: App Privacy (Left Sidebar → Trust & Safety → App Privacy)
1. **Privacy Policy URL:** Enter your live public VitelGlobal Privacy Policy URL (e.g., `https://www.vitelglobal.com/privacy-policy`).
2. **Data Collection Questionnaire:** Click **Get Started** and declare what the app collects when users sign in and use chat/calls:
   - **Contact Info:** Email Address, Name, Phone Number (used for App Functionality, linked to user's identity).
   - **User Content:** Emails or Text Messages / Photos or Videos / Audio Data (used for App Functionality — chat messages, file attachments, VoIP/video calls).
   - **Identifiers:** User ID (used for App Functionality).
   - **Diagnostics:** Crash Data / Performance Data (if applicable, used for App Functionality).
   - **Tracking:** Select **No, we do not use data for tracking** (unless you use third-party ad tracking).

---

## 5. Step-by-Step: macOS Version Page (`1.0 Prepare for Submission`)

Click **macOS App → 1.0 Prepare for Submission** in the left sidebar and fill every field:

### Step 5.1: Screenshots (Required)
Upload **at least 3–5 clean screenshots** of `Vitelglobal Pro Desktop` on macOS.
Apple **strictly** accepts only these exact pixel dimensions for macOS screenshots:
- `1280 × 800`
- `1440 × 900`
- `2560 × 1600` (Retina)
- `2880 × 1800` (Retina)

Recommended screenshots to capture:
1. Login screen (`Vitelglobal Pro Desktop`).
2. Main workspace with **Green SIP Registered (`Ext: ...`)** badge and Chat conversation view.
3. Dialpad / Calls view.
4. Active Voice / Video Call or Meeting view.
5. Contacts / Extensions directory.

### Step 5.2: Text Metadata
- **Promotional Text (170 chars):**
  `Unified enterprise communications for macOS: HD VoIP calling, team chat, presence, and video meetings in one desktop app.`
- **Description (copy & customize):**
  ```text
  Vitelglobal Pro Desktop brings your VitelGlobal business phone system, team messaging, and video meetings together in a fast, native macOS experience.

  Key Features:
  • Business VoIP Softphone: Make and receive HD voice calls directly from your Mac with instant SIP registration and call controls (mute, hold, transfer, dialpad).
  • Team Chat & Presence: Real-time 1-on-1 and group messaging, read receipts, file sharing, and live user availability status.
  • Video Meetings & Screen Sharing: Join or host video meetings with camera, microphone, and screen sharing support.
  • Native macOS Notifications: Instant desktop alerts for incoming calls, messages, and voicemails.

  Note: Requires an active VitelGlobal business account to sign in.
  ```
- **Keywords (max 100 chars, comma-separated):**
  `vitelglobal,voip,softphone,sip,business phone,team chat,video meeting,pbx,calling`
- **Support URL:** `https://www.vitelglobal.com/support` (must be a live, working webpage).
- **Marketing URL (optional):** `https://www.vitelglobal.com/`
- **Version:** Match `package.json` (e.g., `1.0.15`) or `1.0.0`.
- **Copyright:** `2026 Vitel Global Communications Llc`

### Step 5.3: Build Selection & Export Compliance
1. Under **Build**, click **+** (Add Build) and select the `.pkg` build you uploaded via Transporter.
2. **App Encryption (Export Compliance):**
   - When asked *"Does your app use encryption?"* → Select **Yes** (because HTTPS, WSS, WebRTC/SRTP, and SIP-TLS use standard encryption).
   - Then select **Yes** / **Standard encryption algorithms** (*"Exempt: uses standard HTTPS/TLS encryption provided by macOS / standard protocols"*). No French/US ERN paperwork is needed for standard TLS/HTTPS.

---

## 6. Step-by-Step: Demo Login Details & App Review Information (CRITICAL)

> **Why this matters:** Under **Apple App Review Guideline 2.1(a)**, if your app requires login and you do not provide working demo credentials (or if the demo account has 2FA/OTP or an inactive SIP extension), Apple will **immediately reject** the submission.

### Step 6.1: Prepare a Dedicated Apple Review Demo Account (Before Submitting!)
Ask your VitelGlobal backend/admin team to create or verify **one dedicated test account** specifically for Apple Review:
1. **No 2FA / Email OTP / SMS OTP** on this account (Apple reviewers cannot access your email/phone for OTP).
2. **Active SIP Extension assigned** (so the softphone registers **Green** immediately after login).
3. **At least 2–3 sample contacts/chats** visible in the account so the reviewer can test messaging and calling right away.
4. Keep this account **active** until the app status becomes **Ready for Sale**.

### Step 6.2: Fill "App Review Information" in App Store Connect
Scroll to **App Review Information** on the `Prepare for Submission` page:

1. **Sign-in required:** **CHECK THIS BOX** ✅
2. **User Name:** Enter the exact demo login email/username (e.g. `applereview@vitelglobal.com`).
3. **Password:** Enter the exact demo password.
4. **Contact Information:**
   - **First Name / Last Name:** Sunil (or your release manager's name)
   - **Phone Number:** Active phone number with country code (e.g., `+1 ...` or `+91 ...`)
   - **Email Address:** Active team email monitored for Apple Review messages
5. **Notes (Copy-Paste & Fill Bracketed Values):**
   ```text
   Hello Apple App Review Team,

   Thank you for reviewing Vitelglobal Pro Desktop.

   === DEMO LOGIN DETAILS ===
   - App Login Screen: Opens automatically on launch (connects to https://desktop.officemeetings.net/)
   - Username / Email: <INSERT_ACTIVE_DEMO_EMAIL>
   - Password: <INSERT_ACTIVE_DEMO_PASSWORD>
   - Assigned SIP Extension: <INSERT_EXTENSION_NUMBER, e.g. 175>
   - 2FA / OTP: Disabled for this review account.

   === HOW TO TEST ALL FEATURES ===
   1. Launch "Vitelglobal Pro Desktop" and sign in using the demo credentials above.
   2. Softphone / SIP Registration: Within a few seconds after login, the extension badge in the top bar turns GREEN ("Ext: <NUMBER>"), confirming live VoIP/SIP registration.
   3. Team Chat: Open "Chat" from the left sidebar, select any contact/conversation, and send a test message.
   4. Voice / Video Calls: Open "Calls" / Dialpad to place a test audio/video call (or test dialing an internal extension).
   5. Meetings & Screen Sharing: Start or join a meeting to test camera, microphone, and screen sharing.

   === PERMISSIONS EXPLANATION ===
   - Microphone & Camera: Used only for VoIP voice calls and video meetings initiated by the user.
   - Screen Recording / System Audio: Used only when the user clicks "Share Screen" during an active meeting.

   Please contact us if you need any assistance during testing.
   ```
6. **Attachment (Strongly Recommended):**
   - Record a short **30–60 second `.mp4` / `.mov` screen recording** on macOS showing:
     1. Opening **Vitelglobal Pro Desktop**
     2. Signing in with the demo account
     3. Green `Ext` SIP registration appearing
     4. Sending a chat message and starting a test call/meeting
   - Attach this video under **App Review Information → Attachment**. It dramatically reduces review questions for VoIP/SIP apps.

---

## 7. Final Submit & Post-Submission Flow

1. **Version Release:** Choose **Manually release this version** (recommended so you can verify everything before going live) or **Automatically release this version**.
2. Click **Save** at the top right.
3. Click **Add for Review** → review summary → click **Submit to App Review**.
4. **Review Status Timeline:**
   - `Waiting for Review` (usually 12–48 hours)
   - `In Review` (Apple tester logs in using your Demo Login Details)
   - If approved → `Pending Developer Release` (click **Release This Version**) → `Ready for Sale` (live on the Mac App Store!).
   - If Apple sends a message in **Resolution Center**, reply directly in App Store Connect (and only upload a new `.pkg` build if a code/binary change is requested).

---

## 8. Future App Naming & Update Rules

- **Never reuse an existing App Store name** (e.g., `"Vitelglobal Pro"`). Always use a distinct name like **`Vitelglobal Pro Desktop`** and keep `build.productName` in `package.json` identical.
- **For every future update of `Vitelglobal Pro Desktop`:**
  1. Increment `"version"` in `package.json`.
  2. Push to `main` → run GitHub Actions `release-mas.yml` (or `npm run dist:mas` on Mac).
  3. Upload the new `.pkg` via Transporter.
  4. In App Store Connect, click **+ Version** (macOS), select the new build, update **What's New in This Version**, verify the Demo Login account is still active, and click **Submit to App Review**.
