# QA Checklist

Use real VitelGlobal accounts, real devices, and a representative network matrix before releasing.

## Authentication

- Login, logout, session persistence, automatic login, token refresh, expired-session recovery.
- Restart app after login and confirm cookies/session survive.
- Verify auth recovery after network drop and VPN reconnect.

## Calling

- SIP registration after fresh login and after app restart.
- Incoming and outgoing audio calls.
- Video calls with camera preview and remote rendering.
- Hold, resume, transfer, mute, speaker switching, camera switching.
- Confirm audio route behavior with headset, Bluetooth, built-in microphone, and built-in speakers.

## WebRTC

- Camera and microphone permission prompts on first use.
- Device selection before and during a call.
- ICE, STUN, TURN behavior on office, home, VPN, and restricted networks.
- Screen sharing on Windows, macOS, and Linux.
- Network recovery after disconnect, sleep/wake, and IP address change.

## Meetings

- Create meeting, join meeting, waiting room, participants list, chat, raise hand, recording, and whiteboard.
- Screen share start/stop and source switching.
- Meeting controls while app is backgrounded and after restore from tray.

## Chat And Contacts

- Real-time messaging, typing indicators, receipts, attachments, emoji, search, reply, forward, delete, pin, and reactions.
- Personal contacts, global contacts, groups, favorites, search, pagination, and sync.

## Native Desktop

- Tray show/hide, close-to-tray, quit from tray.
- Native notifications for calls, chat, meetings, and downloads.
- Badge count behavior.
- File picker, uploads, downloads, clipboard, drag and drop.
- `vitelglobal://` links from browser, email, and command line.
- Global shortcut `Ctrl+Shift+V` or `Command+Shift+V`.

## Platform Packaging

- Windows NSIS install/uninstall, portable EXE, desktop shortcut, start menu shortcut, auto updater.
- macOS DMG and PKG installation, signed ZIP auto-update payload, notarized launch, camera/microphone/screen permissions, and first-launch deep-link registration.
- macOS hardware matrix: Intel x64 MacBook on macOS Monterey 12.7+, Apple Silicon M1 on Monterey 12.7+, and M2/M3/M4 on a currently supported macOS release. Verify both fresh install and upgrade paths.
- macOS release checks: `codesign --verify --deep --strict`, `spctl --assess`, `xcrun stapler validate`, universal `lipo -archs`, `pkgutil --check-signature`, and a signed update from the published ZIP metadata.
- Linux AppImage, DEB, RPM, tray integration, screen sharing under X11/Wayland.

## Resilience

- Offline launch screen and retry.
- Renderer crash recovery.
- App relaunch after machine restart when auto-launch is enabled.
- Log rotation and support log discovery.
- Update available, update downloaded, install on restart, rollback plan.
