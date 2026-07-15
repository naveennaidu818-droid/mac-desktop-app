"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const outputDirectory = path.resolve(root, process.argv[2] || pkg.build.directories.output);
const expectedPrefix = `${pkg.build.productName}-${pkg.version}-universal-macos`;

function fail(message) {
  console.error(`macOS release verification failed: ${message}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`.trim());
  }
  return `${result.stdout}\n${result.stderr}`;
}

function findApp(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const nested = findApp(fullPath);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

if (process.platform !== "darwin") {
  fail("run release verification on macOS.");
}

const appBundle = findApp(outputDirectory);
if (!appBundle) {
  fail(`could not find a .app bundle in ${outputDirectory}.`);
}

const executablesDirectory = path.join(appBundle, "Contents", "MacOS");
const executables = fs.readdirSync(executablesDirectory).filter((name) => fs.statSync(path.join(executablesDirectory, name)).isFile());
if (executables.length !== 1) {
  fail(`expected one main executable in ${executablesDirectory}.`);
}

const executable = path.join(executablesDirectory, executables[0]);
const architectures = run("lipo", ["-archs", executable]).trim().split(/\s+/).sort();
if (architectures.join(" ") !== "arm64 x86_64") {
  fail(`expected universal arm64 and x86_64 executable, received: ${architectures.join(" ")}.`);
}

run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appBundle]);
const signingInfo = run("codesign", ["--display", "--verbose=4", appBundle]);
if (!signingInfo.includes("Developer ID Application:")) {
  fail("app bundle is not signed with a Developer ID Application certificate.");
}
if (!signingInfo.includes("Runtime Version=")) {
  fail("app bundle does not have the hardened runtime enabled.");
}

run("spctl", ["--assess", "--type", "execute", "--verbose=4", appBundle]);
run("xcrun", ["stapler", "validate", appBundle]);

const requiredArtifacts = [".dmg", ".pkg", ".zip"];
for (const extension of requiredArtifacts) {
  const artifact = path.join(outputDirectory, `${expectedPrefix}${extension}`);
  if (!fs.existsSync(artifact)) {
    fail(`missing ${extension} artifact: ${artifact}.`);
  }
  console.log(`Verified artifact: ${artifact}`);
}

const installerPackage = path.join(outputDirectory, `${expectedPrefix}.pkg`);
const installerSignature = run("pkgutil", ["--check-signature", installerPackage]);
if (!installerSignature.includes("Developer ID Installer:")) {
  fail("PKG is not signed with a Developer ID Installer certificate.");
}
run("spctl", ["--assess", "--type", "install", "--verbose=4", installerPackage]);

const updateMetadata = path.join(outputDirectory, "latest-mac.yml");
if (!fs.existsSync(updateMetadata)) {
  fail(`missing macOS update metadata: ${updateMetadata}.`);
}
const metadata = fs.readFileSync(updateMetadata, "utf8");
if (!metadata.includes(".zip") || !metadata.includes("sha512:")) {
  fail("latest-mac.yml does not reference a signed ZIP update payload with a SHA-512 checksum.");
}

console.log(`Verified signed, notarized universal macOS release for ${pkg.build.productName} ${pkg.version}.`);
