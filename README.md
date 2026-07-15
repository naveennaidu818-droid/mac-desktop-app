# VitelGlobal Desktop

Enterprise Electron desktop application for the hosted VitelGlobal meetings service at `https://desktop.officemeetings.net/`.

## What This App Provides

- Secure Electron main process, sandboxed renderer, isolated preload bridge, and node integration disabled.
- Native tray lifecycle with close-to-tray, minimize-to-tray, show/hide shortcut, native menus, and desktop notifications.
- WebRTC-oriented permission handling for camera, microphone, notifications, fullscreen, and screen sharing.
- Download progress hooks, file picker bridge, clipboard bridge, deep linking through `vitelglobal://`, and app badge support.
- VitelGlobal splash, about, offline, app, tray, notification, taskbar, and installer branding assets.
- Electron Builder targets for Windows NSIS/portable, macOS DMG/ZIP universal, and Linux AppImage/DEB/RPM.
- Enterprise logging through `electron-log`, local crash reporting, update events, and renderer-download telemetry.

## Requirements

- Node.js 22 or newer.
- npm 10 or newer.
- Windows, macOS, or Linux desktop environment.

## Development

```powershell
npm install
npm run assets
npm start
```

The app loads the production service by default. To point a build at another environment:

```powershell
$env:VITELGLOBAL_APP_URL="https://desktop.officemeetings.net/"
npm start
```

## Verification

```powershell
npm run lint
npm run assets
npm run pack
```

`npm run pack` creates an unpacked app for local smoke testing without producing installers.

## Production Builds

```powershell
npm run dist:win
npm run dist:mac
npm run dist:linux
```

The macOS release command produces a signed, notarized universal DMG and PKG for installation plus a ZIP for `electron-updater`. It must run on macOS with a Developer ID Application certificate, a Developer ID Installer certificate (for the PKG), and Apple notary credentials. See [docs/MACOS_RELEASE.md](docs/MACOS_RELEASE.md) for the supported platform matrix, CI configuration, credentials, and release validation.

Release artifacts are organized by platform: `dist/windows/` contains Windows installers, `dist/macos/` contains the macOS DMG/PKG/ZIP release files, and `dist/linux/` contains Linux packages.

## Auto Updates

The app is wired to `electron-updater` with a generic provider at `https://updates.vitelglobal.com/desktop/`. Before release, replace that URL if needed and publish signed artifacts plus the generated update metadata files.

Windows production updates should use code-signed installers. macOS production updates require signing and notarization.

## Deep Links

The app registers:

```text
vitelglobal://
```

Examples:

```text
vitelglobal://join/meeting-id
vitelglobal://call/user-id
```

Deep links are translated into paths under the configured hosted app URL.

## Logs

Logs are written by `electron-log` to the per-user application log location. The About window and tray menu expose the log file.

## Release Checklist

1. Confirm the hosted app URL and update feed URL.
2. Replace or approve final VitelGlobal brand assets if marketing provides alternate production icons.
3. Configure Windows Authenticode certificate and macOS Developer ID signing.
4. Run the QA checklist in [docs/QA.md](docs/QA.md).
5. Build installers on each target platform.
6. Publish signed update artifacts and metadata.
