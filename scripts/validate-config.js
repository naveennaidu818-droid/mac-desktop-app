"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const required = [
  "package.json",
  "src/main/index.js",
  "src/preload/index.js",
  "src/renderer/splash.html",
  "src/renderer/offline.html",
  "src/renderer/about.html",
  "build/icons/vitelglobal-logo.svg"
];

for (const relativePath of required) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
}

const pkg = require(path.join(root, "package.json"));
const webPreferencesSource = fs.readFileSync(path.join(root, "src/main/index.js"), "utf8");
const assetGeneratorSource = fs.readFileSync(path.join(root, "scripts/generate-assets.js"), "utf8");
const macEntitlements = fs.readFileSync(path.join(root, "build", "entitlements.mac.plist"), "utf8");
const macTargets = pkg.build?.mac?.target || [];
const universalMacTargets = new Set(
  macTargets
    .filter((target) => typeof target === "object")
    .filter((target) => target.arch?.includes("universal"))
    .map((target) => target.target)
);

const assertions = [
  [pkg.main === "src/main/index.js", "package main points to Electron main process"],
  [pkg.build?.appId === "com.vitelglobal.desktop", "electron-builder appId configured"],
  [pkg.build?.productName === "VitelGlobal Desktop", "installed desktop product keeps VitelGlobal branding"],
  [pkg.build?.win?.icon === "build/icons/icon.ico", "Windows application uses generated VitelGlobal icon"],
  [pkg.build?.nsis?.artifactName === "desktop.officemeetings-${version}-${arch}-setup.${ext}", "Windows Setup uses desktop.officemeetings filename"],
  [pkg.build?.portable?.artifactName === "desktop.officemeetings-${version}-${arch}-portable.${ext}", "Windows Portable uses desktop.officemeetings filename"],
  [assetGeneratorSource.includes('sourceLogo = path.join(iconsDir, "vitel-v-icon.svg")'), "all desktop icons originate from VitelGlobal SVG"],
  [assetGeneratorSource.includes('path.join(iconsDir, "notification.png")'), "native notification icon generated from VitelGlobal SVG"],
  [webPreferencesSource.includes("contextIsolation: true"), "contextIsolation enabled"],
  [webPreferencesSource.includes("nodeIntegration: false"), "nodeIntegration disabled"],
  [webPreferencesSource.includes("sandbox: true"), "sandbox enabled"],
  [webPreferencesSource.includes("setPermissionRequestHandler"), "media permission handler configured"],
  [webPreferencesSource.includes("certificate-error"), "certificate error handler configured"],
  [webPreferencesSource.includes('require("./notificationPolicy")'), "central native notification policy loaded"],
  [webPreferencesSource.includes("nativeNotificationDeduper.shouldDeliver"), "native notification deduplication configured"],
  [webPreferencesSource.includes("isLoadingMainFrame()") && webPreferencesSource.includes('once("did-finish-load"'), "notification click waits for renderer readiness"],
  [webPreferencesSource.includes('notification.on("action"'), "native incoming-call action routing configured"],
  [webPreferencesSource.includes('[DesktopNotification]'), "structured native notification logging configured"],
  [webPreferencesSource.includes("systemPreferences"), "macOS system notification dependency imported"],
  [webPreferencesSource.includes("buildWindowsLaunchSpec"), "Windows notification shortcut uses tested launch specification"],
  [webPreferencesSource.includes("args: launchSpec.args"), "development toast activation includes application arguments"],
  [webPreferencesSource.includes("icon: launchSpec.icon"), "development toast activation uses branded icon"],
  [webPreferencesSource.includes("shell.writeShortcutLink(shortcutPath, \"replace\""), "Windows notification shortcut repairs stale Electron target"],
  [webPreferencesSource.includes("app.setToastActivatorCLSID(WINDOWS_TOAST_ACTIVATOR_CLSID)"), "stable Windows toast activator configured before notifications"],
  [webPreferencesSource.includes("toastActivatorClsid: WINDOWS_TOAST_ACTIVATOR_CLSID"), "shortcut and Electron use the same toast activator"],
  [webPreferencesSource.includes('notification.once("show"') && webPreferencesSource.includes("setTimeout(registerWindowsNotificationShortcut, 500)"), "Windows shortcut repaired after asynchronous native toast registration"],
  [webPreferencesSource.includes("setAsDefaultProtocolClient(\"vitelglobal\", process.env.PORTABLE_EXECUTABLE_FILE || process.execPath)"), "Windows deep links target stable packaged launcher"],
  [pkg.build?.mac?.minimumSystemVersion === "12.0.0", "macOS minimum version is Monterey (12.0)"],
  [pkg.build?.mac?.hardenedRuntime === true, "macOS hardened runtime enabled"],
  [universalMacTargets.has("dmg") && universalMacTargets.has("pkg") && universalMacTargets.has("zip"), "macOS universal DMG, PKG, and ZIP targets configured"],
  [pkg.build?.mac?.extendInfo?.NSCameraUsageDescription, "macOS camera permission usage text configured"],
  [pkg.build?.mac?.extendInfo?.NSMicrophoneUsageDescription, "macOS microphone permission usage text configured"],
  [pkg.build?.mac?.extendInfo?.NSAudioCaptureUsageDescription, "macOS system-audio capture usage text configured"],
  [macEntitlements.includes("com.apple.security.cs.allow-jit"), "macOS JIT entitlement configured"],
  [macEntitlements.includes("com.apple.security.device.audio-input"), "macOS microphone entitlement configured"],
  [macEntitlements.includes("com.apple.security.device.camera"), "macOS camera entitlement configured"],
  [!macEntitlements.includes("com.apple.security.cs.allow-unsigned-executable-memory"), "unused unsigned-memory entitlement removed"],
  [fs.existsSync(path.join(root, "build", "dmg-background.png")) || fs.existsSync(path.join(root, "scripts", "generate-assets.js")), "macOS DMG background asset is generated"]
];

const failures = assertions.filter(([passed]) => !passed);
if (failures.length) {
  for (const [, message] of failures) {
    console.error(`FAIL ${message}`);
  }
  process.exit(1);
}

for (const [, message] of assertions) {
  console.log(`OK ${message}`);
}
