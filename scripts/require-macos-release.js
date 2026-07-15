"use strict";

const { spawnSync } = require("node:child_process");

function fail(message) {
  console.error(`macOS release preflight failed: ${message}`);
  process.exit(1);
}

function commandExists(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return result.status === 0;
}

function hasCertificateInKeychain(certificateType) {
  const result = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  return result.status === 0 && new RegExp(`${certificateType}:`).test(`${result.stdout}\n${result.stderr}`);
}

function hasNotaryCredentials() {
  const apiKey = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"].every((name) => process.env[name]);
  const appleId = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"].every((name) => process.env[name]);
  const keychainProfile = ["APPLE_KEYCHAIN", "APPLE_KEYCHAIN_PROFILE"].every((name) => process.env[name]);
  return apiKey || appleId || keychainProfile;
}

if (process.platform !== "darwin") {
  fail("run this command on a macOS host; Windows and Linux cannot create a release-ready signed and notarized macOS package.");
}

if (!commandExists("xcrun", ["--find", "notarytool"])) {
  fail("Xcode 14 or later with notarytool is required.");
}

if (!process.env.CSC_LINK) {
  const hasApplicationCertificate = hasCertificateInKeychain("Developer ID Application");
  const hasInstallerCertificate = hasCertificateInKeychain("Developer ID Installer");
  if (!hasApplicationCertificate || !hasInstallerCertificate) {
    fail("import both Developer ID Application and Developer ID Installer certificates into the login keychain, or provide CSC_LINK containing both certificates (and CSC_KEY_PASSWORD when applicable).");
  }
}

if (!hasNotaryCredentials()) {
  fail("provide Apple notary API-key credentials, Apple ID credentials, or a notarytool keychain profile.");
}

console.log("macOS release preflight passed.");
