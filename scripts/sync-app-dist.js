"use strict";

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const webAppDist = path.resolve(rootDir, "..", "web-app", "dist");
const targetDist = path.resolve(rootDir, "src", "app-dist");

console.log("[sync-app-dist] Starting sync from:", webAppDist);
console.log("[sync-app-dist] Target directory:", targetDist);

if (!fs.existsSync(webAppDist)) {
  console.error("[sync-app-dist] ERROR: web-app/dist does not exist! Please run 'npm run build' in web-app first.");
  process.exit(1);
}

const indexHtml = path.join(webAppDist, "index.html");
if (!fs.existsSync(indexHtml)) {
  console.error("[sync-app-dist] ERROR: web-app/dist/index.html not found!");
  process.exit(1);
}

// Remove old app-dist if present
if (fs.existsSync(targetDist)) {
  fs.rmSync(targetDist, { recursive: true, force: true });
}

// Copy web-app/dist to src/app-dist
fs.cpSync(webAppDist, targetDist, { recursive: true });

console.log("[sync-app-dist] Successfully synced web-app/dist to exe-file/src/app-dist!");
const fileCount = fs.readdirSync(targetDist, { recursive: true }).length;
console.log(`[sync-app-dist] Total files copied: ${fileCount}`);
