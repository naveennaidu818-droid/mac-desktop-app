"use strict";

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const chatAppDist = path.resolve(rootDir, "..", "chat-app", "frontend", "dist");
const webAppDist = path.resolve(rootDir, "..", "web-app", "dist");
const sourceDist = fs.existsSync(path.join(webAppDist, "index.html"))
  ? webAppDist
  : (fs.existsSync(path.join(chatAppDist, "index.html")) ? chatAppDist : null);
const targetDist = path.resolve(rootDir, "src", "app-dist");

console.log("[sync-app-dist] Starting sync from:", sourceDist);
console.log("[sync-app-dist] Target directory:", targetDist);

if (!fs.existsSync(sourceDist) || !fs.existsSync(path.join(sourceDist, "index.html"))) {
  if (fs.existsSync(path.join(targetDist, "index.html"))) {
    console.log("[sync-app-dist] External source dist not found, but bundled src/app-dist is present. Preserving existing app-dist.");
    process.exit(0);
  }
  console.error("[sync-app-dist] ERROR: Source dist does not exist and src/app-dist is missing! Please run build first.");
  process.exit(1);
}

// Remove old app-dist if present
try {
  if (fs.existsSync(targetDist)) {
    fs.rmSync(targetDist, { recursive: true, force: true });
  }
} catch (rmErr) {
  console.warn("[sync-app-dist] Warning: Could not rmSync targetDist, continuing with direct overwrite:", rmErr.message);
}

// Copy source dist to src/app-dist
fs.cpSync(sourceDist, targetDist, { recursive: true, force: true });

// Also ensure public/ contents are available at root level (e.g. sounds, webrtc-phone, chat-picker)
const publicDir = path.join(sourceDist, "public");
if (fs.existsSync(publicDir)) {
  const publicItems = fs.readdirSync(publicDir);
  for (const item of publicItems) {
    const srcItem = path.join(publicDir, item);
    const destItem = path.join(targetDist, item);
    if (!fs.existsSync(destItem)) {
      fs.cpSync(srcItem, destItem, { recursive: true, force: true });
    }
  }
}

// Merge any media/sounds/webrtc assets from web-app/dist if present
if (fs.existsSync(webAppDist)) {
  const extraDirs = ["sounds", "webrtc-phone", "chat-picker"];
  for (const dir of extraDirs) {
    const srcDir = path.join(webAppDist, dir);
    const destDir = path.join(targetDist, dir);
    if (fs.existsSync(srcDir) && !fs.existsSync(destDir)) {
      fs.cpSync(srcDir, destDir, { recursive: true, force: true });
    }
  }
}

console.log(`[sync-app-dist] Successfully synced ${sourceDist} to exe-file/src/app-dist!`);
const fileCount = fs.readdirSync(targetDist, { recursive: true }).length;
console.log(`[sync-app-dist] Total files copied: ${fileCount}`);
