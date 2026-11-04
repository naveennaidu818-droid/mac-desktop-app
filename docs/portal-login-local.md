Local portal-login repair — version 1.0.14
=========================================

Why the existing 1.0.13 setup does not auto-login
-----------------------------------------------

The actual desktop.officemeetings-1.0.13-x64-setup.exe was inspected by extracting
its app archive locally. Its preload has no openPortal bridge and its main
process has no app:open-portal handler. It therefore cannot use the current
portal page's desktop session handoff. Its normal startup page is the hosted app.
The earlier separate unpacked build did not update the installed 1.0.13 app.

Desktop build to use
--------------------

D:\Desktop-app\exe-file\dist\portal-login-1.0.14\win-unpacked\VitelGlobal Desktop.exe

The complete folder is also packaged in:
D:\Desktop-app\exe-file\dist\portal-login-1.0.14\desktop.officemeetings-1.0.14-x64-local.zip

Extract the entire ZIP before running it; keep the EXE with its adjacent files.
Fully quit the existing app from its tray before running the new EXE. Otherwise
the existing single-instance behavior may bring the old running app forward.
This is a local unsigned application build, not a replacement NSIS installer.
The existing setup and portable installers and installed application were not
overwritten. A replacement setup could not be compiled because NSIS is not
available locally and no tools were downloaded under the local-only constraint.

The new build exposes the portal bridge, passes fresh credentials, waits for
delayed login forms, restricts filling to the exact destination origin, replaces
stale handlers on reopened windows, and forwards the selected portal when
disconnecting. Other desktop modules were not intentionally changed.

The existing app startup URL and API settings remain unchanged. Running the
normal app or logging into real portals naturally contacts configured services.
That was NOT done during this task. To use a local frontend, use the existing
VITELGLOBAL_APP_URL override with your local frontend and backend.

Browser setup
-------------

Load D:\Desktop-app\web-app\portal-extension as an unpacked extension using
Developer mode in edge://extensions or chrome://extensions, then reload the
app tab. Save each portal's credentials in Project settings and click its
Open Portal / Login & Connect button.

The compatibility handler supports saved credentials on the existing hosted
portal page without a web deployment. The updated local web-app also has an
explicit extension bridge for first-time login. The extension handles only the
three named portal origins and the current user's saved portal cache. See:
D:\Desktop-app\web-app\portal-extension\README.md

No extension was installed into your existing browser profile. A temporary,
isolated Edge profile was used for local tests only.

Validation and limits
---------------------

- 22 focused Vitest tests passed.
- Real Electron test passed from preload through the actual portal IPC handler:
  delayed form, initial credentials, fresh credentials in a reused window,
  single submission, invalid URL rejection, and targeted disconnect.
- Isolated Edge extension test passed for all three named portal buttons with
  delayed forms and synthetic credentials. Every page was a local fixture;
  non-intercepted browser requests were blocked by a loopback proxy.
- Web production build, desktop configuration validation, and JS syntax checks
  passed. Packaged sources and version were verified against the local files.

No deployment, live portal inspection, actual account login, database migration,
or installation into your existing app/browser was performed. Current remote
portal markup and actual session acceptance remain unverified. CAPTCHA, OTP,
password expiry, and other verification steps still require normal user action.
