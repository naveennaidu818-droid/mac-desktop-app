# Vitelglobal Pro Desktop — Mac App Store Submission Guide

A clean, step-by-step guide for building, uploading, and submitting **Vitelglobal Pro Desktop** to the **Apple Mac App Store**.

---

## 1. App Identity & Certificates

Keep these values identical across `package.json`, `build/embedded.provisionprofile`, and App Store Connect:

| Field | Value |
| --- | --- |
| **App Store Name** | `Vitelglobal Pro Desktop` |
| **Bundle ID** | `com.vitelglobal.desktop` |
| **Helper Bundle ID** | `com.vitelglobal.desktop.helper` |
| **Apple Team Name** | `Vitel Global Communications Llc` |
| **Apple Team ID** | `95ZKEEHT9T` |
| **Provisioning Profile** | `build/embedded.provisionprofile` (`VitelGlobal-Mac-AppStore`) |
| **Entitlements** | `build/entitlements.mas.plist` & `build/entitlements.mas.inherit.plist` |
| **Platform & Arch** | macOS `12.0+` (Universal: Apple Silicon `arm64` + Intel `x86_64`) |
| **Category** | Business (`public.app-category.business`) |

---

## 2. Step 1 — Get the Signed `.pkg` File

### From GitHub Actions (Recommended)
1. Open **GitHub → Actions → Build Mac App Store (MAS) release** (`.github/workflows/release-mas.yml`).
2. Run the workflow on `main` (or open the completed run).
3. Download the **Artifacts** `.zip` at the bottom of the run and extract:
   `Vitelglobal Pro Desktop-<version>-universal-mas.pkg`

### Or Build on a Mac
On a Mac with Xcode + `Apple Distribution: Vitel Global Communications Llc (95ZKEEHT9T)` + `3rd Party Mac Developer Installer` certificates in Keychain:
```bash
npm ci
npm run lint
npm run test:notifications
npm run dist:mas
```
Output: `dist/mas/Vitelglobal Pro Desktop-<version>-universal-mas.pkg`

> **For every new release:** Bump `"version"` in `package.json` (for example `1.0.15` → `1.0.16`) before building. Apple rejects duplicate version numbers.

---

## 3. Step 2 — Upload `.pkg` via Transporter

1. Open **Transporter** on macOS and sign in with the VitelGlobal Apple Developer / App Store Connect account.
2. Click **+** and select `Vitelglobal Pro Desktop-<version>-universal-mas.pkg`.
3. Click **Verify**, then **Deliver**.
4. Wait **5–15 minutes** for Apple to finish processing the build.

---

## 4. Step 3 — Complete App Store Connect Sections

Open **App Store Connect → My Apps → Vitelglobal Pro Desktop** and fill in every section in order:

### A. App Information
- **Name:** `Vitelglobal Pro Desktop`
- **Subtitle (optional):** `Enterprise Chat, Voice & Video`
- **Primary Language:** `English (U.S.)`
- **Category:** Primary = `Business` | Secondary = `Productivity`
- **Age Rating:** `4+` (answer No to all restricted content questions)

### B. Pricing and Availability
- **Price:** `Free` ($0.00)
- **Availability:** All Countries or Regions (or your target regions)

### C. App Privacy
- **Privacy Policy URL:** `https://www.vitelglobal.com/privacy-policy` (use your live URL)
- **Data Collection:** Declare Contact Info (Email, Name, Phone), User Content (Messages, Audio, Video), and User ID under **App Functionality** (linked to user). Select **No tracking**.

### D. macOS Version (`Prepare for Submission`)
1. **Screenshots (Required):** Upload 3–5 macOS screenshots using one of Apple's exact sizes (`1280×800`, `1440×900`, `2560×1600`, or `2880×1800`):
   - Login screen
   - Main workspace showing green SIP registration (`Ext: 175`) and Chat
   - Dialpad / Calls view
   - Active Call / Video Meeting view
2. **Promotional Text:**
   `Unified enterprise communications for macOS: HD VoIP calling, team chat, presence, and video meetings in one desktop app.`
3. **Description:**
   ```text
   Vitelglobal Pro Desktop brings your VitelGlobal business phone system, team messaging, and video meetings together in a fast, native macOS experience.

   Key Features:
   • Business VoIP Softphone: Make and receive HD voice calls directly from your Mac with instant SIP registration and full call controls.
   • Team Chat & Presence: Real-time 1-on-1 and group messaging, read receipts, file sharing, and live availability status.
   • Video Meetings & Screen Sharing: Host or join video meetings with camera, microphone, and screen sharing support.
   • Native macOS Notifications: Instant desktop alerts for incoming calls, messages, and voicemails.

   Requires an active VitelGlobal business account to sign in.
   ```
4. **Keywords:** `vitelglobal,voip,softphone,sip,business phone,team chat,video meeting,pbx`
5. **Support URL:** `https://www.vitelglobal.com/support`
6. **Copyright:** `2026 Vitel Global Communications Llc`
7. **Build:** Click **+** and select the processed `.pkg` build.
   - **Export Compliance:** Select **Yes** (uses HTTPS/TLS/SRTP) → select **Standard encryption / Exempt**.

---

## 5. Step 4 — Demo Login Details (Apple App Review)

> Apple Reviewers **must** be able to sign in without 2FA/OTP and test both SIP calling and chat immediately.

### Recommended Test Accounts (Ext `175` & Ext `186`)
Before submitting, verify that **Extension `175`** and **Extension `186`** are active in VitelGlobal with **2FA/OTP disabled**, and fill in their live login passwords below before pasting into App Store Connect:

| Role | Extension | Login Username / Email | Password |
| --- | --- | --- | --- |
| **Primary Apple Review Account** | `175` | *(enter Ext 175 login email/username)* | *(enter Ext 175 password)* |
| **Secondary Peer Account (for 2-way Call/Chat)** | `186` | *(enter Ext 186 login email/username)* | *(enter Ext 186 password)* |

### In App Store Connect → App Review Information
1. **Contact Information:** Enter Sunil's (or release owner's) Name, Phone, and Email.
2. **Sign-in required:** Check **Yes** ✅
   - **User Name:** *(Ext `175` login email/username)*
   - **Password:** *(Ext `175` password)*
3. **Notes (Paste this into App Store Connect Notes):**
   ```text
   Hello Apple Review Team,

   Please use the demo account below to test Vitelglobal Pro Desktop:

   Primary Demo Account (Ext 175):
   - Username: [Ext 175 login]
   - Password: [Ext 175 password]
   - 2FA / OTP: Disabled for review.

   Secondary Account for 2-Way Call & Chat Testing (Ext 186):
   - Extension / Peer: 186
   - Username: [Ext 186 login]
   - Password: [Ext 186 password]

   How to Test:
   1. Launch Vitelglobal Pro Desktop and sign in with the Primary Demo Account (Ext 175).
   2. After login, wait a few seconds for the green "Ext: 175" SIP status indicator in the top bar.
   3. Team Chat: Open Chat, select Extension 186 (or any contact), and send a message.
   4. VoIP Call / Meeting: Open Calls/Dialpad to dial Extension 186, or start a meeting to test microphone, camera, and screen sharing.

   Permissions Used:
   - Microphone & Camera: Strictly for user-initiated VoIP calls and video meetings.
   - Screen Recording / System Audio: Only when the user clicks "Share Screen" in a meeting.
   ```
4. **Attachment (Optional but Helpful):** Attach a 30-second screen recording showing login → green `Ext: 175` status → sending a chat message → placing a call.

---

## 6. Step 5 — Submit for Review

1. Under **Version Release**, select **Manually release this version** (or **Automatically release**).
2. Click **Save** → **Add for Review** → **Submit to App Review**.
3. Once status changes to **Ready for Sale**, the app is live on the Mac App Store.
