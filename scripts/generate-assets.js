"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const pngToIcoModule = require("png-to-ico");
const pngToIco = pngToIcoModule.default || pngToIcoModule;

const root = path.join(__dirname, "..");
const iconsDir = path.join(root, "build", "icons");
const sourceLogo = path.join(iconsDir, "vitel-v-icon.svg");
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

function writeUInt32BE(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

async function writeIcns(chunks) {
  const payloads = await Promise.all(chunks.map(async ([type, file]) => {
    const data = await fs.readFile(file);
    return Buffer.concat([Buffer.from(type), writeUInt32BE(data.length + 8), data]);
  }));
  const totalLength = 8 + payloads.reduce((sum, payload) => sum + payload.length, 0);
  await fs.writeFile(path.join(iconsDir, "icon.icns"), Buffer.concat([
    Buffer.from("icns"),
    writeUInt32BE(totalLength),
    ...payloads
  ]));
}

async function writeDmgBackground() {
  const background = Buffer.from(`
    <svg width="540" height="380" viewBox="0 0 540 380" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f6f8ff"/>
          <stop offset="1" stop-color="#e9f0ff"/>
        </linearGradient>
      </defs>
      <rect width="540" height="380" fill="url(#background)"/>
      <rect x="0" y="0" width="540" height="92" fill="#104d9d"/>
      <text x="270" y="42" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="700" text-anchor="middle">VitelGlobal Desktop</text>
      <text x="270" y="68" fill="#dbeafe" font-family="Arial, Helvetica, sans-serif" font-size="14" text-anchor="middle">Install VitelGlobal meetings on your Mac</text>
      <path d="M226 224 H311" stroke="#2563eb" stroke-width="4" stroke-linecap="round"/>
      <path d="M299 212 L311 224 L299 236" fill="none" stroke="#2563eb" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="270" y="343" fill="#334155" font-family="Arial, Helvetica, sans-serif" font-size="14" text-anchor="middle">Drag the app to Applications to install</text>
    </svg>
  `);
  await sharp(background).png().toFile(path.join(root, "build", "dmg-background.png"));
}

async function main() {
  await fs.mkdir(iconsDir, { recursive: true });
  const logo = await fs.readFile(sourceLogo);

  const icon = await sharp(logo, { density: 300 })
    .resize(1024, 1024)
    .png()
    .toBuffer();

  await fs.writeFile(path.join(iconsDir, "icon.png"), icon);
  await fs.writeFile(path.join(iconsDir, "tray.png"), icon);
  await fs.writeFile(path.join(iconsDir, "notification.png"), icon);
  await writeDmgBackground();

  const generatedPngs = [];
  for (const size of pngSizes) {
    const output = path.join(iconsDir, `${size}x${size}.png`);
    await sharp(icon).resize(size, size).png().toFile(output);
    generatedPngs.push(output);
  }

  const icoSizes = new Set([16, 24, 32, 48, 64, 128, 256]);
  const ico = await pngToIco(generatedPngs.filter((file) => {
    const match = path.basename(file).match(/^(\d+)x\1\.png$/);
    return match && icoSizes.has(Number(match[1]));
  }));
  await fs.writeFile(path.join(iconsDir, "icon.ico"), ico);

  await writeIcns([
    ["icp4", path.join(iconsDir, "16x16.png")],
    ["icp5", path.join(iconsDir, "32x32.png")],
    ["icp6", path.join(iconsDir, "64x64.png")],
    ["ic07", path.join(iconsDir, "128x128.png")],
    ["ic08", path.join(iconsDir, "256x256.png")],
    ["ic09", path.join(iconsDir, "512x512.png")],
    ["ic10", path.join(iconsDir, "1024x1024.png")]
  ]);

  console.log(`Generated icons in ${iconsDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});