# Security Notes

The desktop shell follows Electron hardening defaults suitable for a hosted enterprise app:

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- `webSecurity: true`
- no remote module
- HTTPS-only trusted navigation
- invalid TLS certificates rejected
- narrow IPC bridge with explicit channels only
- local pages include a restrictive Content Security Policy
- permission requests are allowed only for trusted VitelGlobal and OfficeMeetings origins

The hosted web application still owns application-layer security controls such as API authorization, CSRF protection, token refresh, SIP credentials, and chat/meeting authorization. Validate those controls in the web service and regression-test them from the desktop shell.

Before production release:

1. Code-sign Windows and macOS artifacts.
2. Notarize macOS builds.
3. Publish updates over HTTPS from a controlled update origin.
4. Confirm certificate pinning requirements with VitelGlobal security. The current implementation rejects invalid certificates but does not pin a specific public key.
5. Perform WebRTC, deep-link, file upload/download, and protocol-handler threat testing.
