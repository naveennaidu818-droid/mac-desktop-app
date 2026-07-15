# macOS Release Guide

## Supported Platform

This release is a universal macOS application with native `arm64` and `x86_64` slices. It supports Apple Silicon MacBooks (M1, M2, M3, and M4) and 64-bit Intel MacBooks running macOS Monterey 12.0 or later. Electron 43 does not support releases before Monterey, so macOS 11 and older are intentionally excluded. Future macOS releases require a release-candidate smoke test before being listed as supported.

## Release Artifacts

`npm run dist:mac:release` creates these files in `dist/macos/`:

- `VitelGlobal Desktop-<version>-universal-macos.dmg` — standard drag-to-Applications installer for end users.
- `VitelGlobal Desktop-<version>-universal-macos.pkg` — signed installer for managed enterprise deployment.
- `VitelGlobal Desktop-<version>-universal-macos.zip` and `latest-mac.yml` — signed auto-update payload and metadata for `electron-updater`.

All artifacts are built from a single universal application bundle, so there is no architecture-selection step for customers.

## Required macOS Host

Build on a physical Mac or macOS CI runner with Xcode 14 or later and Node.js 22. The release command intentionally fails on Windows and Linux because Apple signing, notarization, Gatekeeper assessment, DMG creation, and universal-package verification require macOS tooling.

Import the following certificates into the build keychain, or provide them using `CSC_LINK` and `CSC_KEY_PASSWORD`:

- `Developer ID Application` — signs the application bundle.
- `Developer ID Installer` — signs the enterprise PKG.

Use one notarization method. App Store Connect API keys are preferred:

```bash
export APPLE_API_KEY=/secure/path/AuthKey_ABC123.p8
export APPLE_API_KEY_ID=ABC123
export APPLE_API_ISSUER=00000000-0000-0000-0000-000000000000
```

Alternatively, configure `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`, or a preconfigured `APPLE_KEYCHAIN` and `APPLE_KEYCHAIN_PROFILE`. Do not commit certificates, private keys, passwords, or API keys.

## Build And Verify

```bash
npm ci
npm run lint
npm run dist:mac:release
```

The release command regenerates branding assets, builds the universal app, signs it with the hardened runtime, submits it for notarization, staples its ticket, and verifies the code signature, Gatekeeper assessment, notarization ticket, architecture slices, PKG signature, and update metadata.

## Test Builds

GitHub Actions includes **Build macOS test installers** for smoke testing without Apple credentials. It produces unsigned universal DMG and ZIP artifacts for Intel and Apple Silicon. macOS will warn before opening these artifacts; they are only for testing and must not be distributed to customers.

## CI Secrets

The included GitHub Actions workflow expects:

- `MACOS_CERTIFICATE_P12_BASE64` — base64-encoded PKCS#12 export containing both Developer ID certificates.
- `MACOS_CERTIFICATE_PASSWORD` — password for that export.
- `APPLE_API_KEY_P8_BASE64` — base64-encoded App Store Connect API `.p8` key.
- `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` — identifiers for the API key.

Publish the DMG and PKG to the release download page. Publish the ZIP, `latest-mac.yml`, and any generated blockmap files to the configured update endpoint at `https://updates.vitelglobal.com/desktop/`.
