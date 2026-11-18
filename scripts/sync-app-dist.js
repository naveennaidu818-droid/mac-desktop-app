"use strict";

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const chatAppDist = path.resolve(rootDir, "..", "chat-app", "frontend", "dist");
const webAppDist = path.resolve(rootDir, "..", "web-app", "dist");
const sourceDist = fs.existsSync(path.join(chatAppDist, "index.html")) ? chatAppDist : webAppDist;
const targetDist = path.resolve(rootDir, "src", "app-dist");

console.log("[sync-app-dist] Starting sync from:", sourceDist);
console.log("[sync-app-dist] Target directory:", targetDist);

if (!fs.existsSync(sourceDist)) {
  console.error("[sync-app-dist] ERROR: Source dist does not exist! Please run build first.");
  process.exit(1);
}

const indexHtml = path.join(sourceDist, "index.html");
if (!fs.existsSync(indexHtml)) {
  console.error("[sync-app-dist] ERROR: index.html not found in source dist!");
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

// Copy web-app/dist to src/app-dist
fs.cpSync(webAppDist, targetDist, { recursive: true, force: true });

console.log("[sync-app-dist] Successfully synced web-app/dist to exe-file/src/app-dist!");
const fileCount = fs.readdirSync(targetDist, { recursive: true }).length;
console.log(`[sync-app-dist] Total files copied: ${fileCount}`);
