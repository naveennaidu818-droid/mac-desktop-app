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
  [webPreferencesSource.includes("contextIsolation: true"), "contextIsolation enabled"],
  [webPreferencesSource.includes("nodeIntegration: false"), "nodeIntegration disabled"],
  [webPreferencesSource.includes("sandbox: true"), "sandbox enabled"],
  [webPreferencesSource.includes("setPermissionRequestHandler"), "media permission handler configured"],
  [webPreferencesSource.includes("certificate-error"), "certificate error handler configured"],
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
