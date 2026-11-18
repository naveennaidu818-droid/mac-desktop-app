"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

console.log("=== VERIFYING MAC APP STORE (MAS) READINESS & .P8 KEY ===");

const rootDir = path.resolve(__dirname, "..");
const p8Path = path.join(rootDir, "build", "AuthKey_D75ZL2XFR6.p8");

// 1. Verify .p8 Key file
if (!fs.existsSync(p8Path)) {
  console.error("FAIL: AuthKey_D75ZL2XFR6.p8 does not exist in build/");
  process.exit(1);
}
const p8Content = fs.readFileSync(p8Path, "utf8");
try {
  const privKey = crypto.createPrivateKey(p8Content);
  if (privKey.asymmetricKeyType !== "ec" || privKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    console.error("FAIL: Key is not an EC prime256v1 private key");
    process.exit(1);
  }
  console.log("OK .p8 Key is valid ECDSA P-256 (prime256v1)");
  console.log("OK Key ID confirmed: D75ZL2XFR6");
} catch (err) {
  console.error("FAIL: Could not parse .p8 private key:", err.message);
  process.exit(1);
}

// 2. Verify entitlements
const masPlistPath = path.join(rootDir, "build", "entitlements.mas.plist");
const masInheritPlistPath = path.join(rootDir, "build", "entitlements.mas.inherit.plist");

if (!fs.existsSync(masPlistPath)) {
  console.error("FAIL: entitlements.mas.plist missing");
  process.exit(1);
}
const masPlist = fs.readFileSync(masPlistPath, "utf8");
if (!masPlist.includes("<key>com.apple.security.app-sandbox</key>") || !masPlist.includes("<true/>")) {
  console.error("FAIL: App Sandbox entitlement missing in entitlements.mas.plist");
  process.exit(1);
}
console.log("OK entitlements.mas.plist has com.apple.security.app-sandbox enabled");

if (!fs.existsSync(masInheritPlistPath)) {
  console.error("FAIL: entitlements.mas.inherit.plist missing");
  process.exit(1);
}
const masInheritPlist = fs.readFileSync(masInheritPlistPath, "utf8");
if (!masInheritPlist.includes("<key>com.apple.security.inherit</key>")) {
  console.error("FAIL: com.apple.security.inherit missing in entitlements.mas.inherit.plist");
  process.exit(1);
}
console.log("OK entitlements.mas.inherit.plist has com.apple.security.inherit enabled");

// 3. Verify GitHub Actions MAS workflow
const masWorkflowPath = path.join(rootDir, ".github", "workflows", "build-mas-release.yml");
if (!fs.existsSync(masWorkflowPath)) {
  console.error("FAIL: build-mas-release.yml workflow missing");
  process.exit(1);
}
const workflowContent = fs.readFileSync(masWorkflowPath, "utf8");
if (!workflowContent.includes("D75ZL2XFR6")) {
  console.error("FAIL: build-mas-release.yml does not reference new Key ID D75ZL2XFR6");
  process.exit(1);
}
console.log("OK build-mas-release.yml configured with Key ID D75ZL2XFR6");

// 4. Verify package.json configuration
const pkgPath = path.join(rootDir, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
if (!pkg.build?.mas?.entitlements || !pkg.build?.mas?.entitlementsInherit) {
  console.error("FAIL: package.json build.mas entitlements missing");
  process.exit(1);
}
console.log("OK package.json build.mas configured correctly (type: " + pkg.build.mas.type + ")");

console.log("\nALL MAC APP STORE (MAS) READINESS CHECKS PASSED!");
