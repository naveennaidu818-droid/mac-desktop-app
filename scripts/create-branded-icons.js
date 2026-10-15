"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const pngToIcoModule = require("png-to-ico");
const pngToIco = pngToIcoModule.default || pngToIcoModule;

const rootDir = path.join(__dirname, "..");
const iconsDir = path.join(rootDir, "build", "icons");
const webPublicDir = path.join(rootDir, "..", "web-app", "public");

async function main() {
  await fs.mkdir(iconsDir, { recursive: true });

  const fsSync = require("node:fs");
  const masterPath = path.join(iconsDir, "vitel-v-master.png");
  let vMarkPngBuffer;
  if (fsSync.existsSync(masterPath)) {
    vMarkPngBuffer = await fs.readFile(masterPath);
  } else {
    // Read vitelglobal-logo.svg as fallback
    const svgPath = path.join(rootDir, "..", "web-app", "src", "assets", "vitelglobal-logo.svg");
    const svgContent = await fs.readFile(svgPath, "utf8");
    const match = svgContent.match(/clipPath id="id4"[\s\S]*?xlink:href="data:image\/png;base64,([^"]+)"/);
    if (match) {
      const rawPng = Buffer.from(match[1], "base64");
      vMarkPngBuffer = await sharp(rawPng)
        .extract({ left: 0, top: 0, width: 250, height: 264 })
        .toBuffer();
    }
  }

  // Trim all outer empty padding so the logo mark fills the icon frame prominently
  const trimmedVMark = await sharp(vMarkPngBuffer).trim().toBuffer();
  const resizedLogo = await sharp(trimmedVMark)
    .resize(1000, 1000, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .toBuffer();

  // Build high-res 1024x1024 icon:
  // High-res canvas holding the crisp, large orange/yellow V logo mark centered
  const squareIcon = await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    }
  })
    .composite([
      {
        input: resizedLogo,
        gravity: "center"
      }
    ])
    .png()
    .toBuffer();

  const finalIconBuffer = squareIcon;

  // Save icon.png to build/icons and web-app/public
  await fs.writeFile(path.join(iconsDir, "icon.png"), finalIconBuffer);
  await fs.writeFile(path.join(iconsDir, "tray.png"), finalIconBuffer);
  if (fsSync.existsSync(webPublicDir)) {
    await fs.writeFile(path.join(webPublicDir, "icon.png"), finalIconBuffer);
  }

  // Generate ICO for Windows
  const icoBuffer = await pngToIco([
    await sharp(finalIconBuffer).resize(16, 16).toBuffer(),
    await sharp(finalIconBuffer).resize(24, 24).toBuffer(),
    await sharp(finalIconBuffer).resize(32, 32).toBuffer(),
    await sharp(finalIconBuffer).resize(48, 48).toBuffer(),
    await sharp(finalIconBuffer).resize(64, 64).toBuffer(),
    await sharp(finalIconBuffer).resize(128, 128).toBuffer(),
    await sharp(finalIconBuffer).resize(256, 256).toBuffer()
  ]);
  await fs.writeFile(path.join(iconsDir, "icon.ico"), icoBuffer);

  // Also construct clean SVG wrapper
  const svgWrapper = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <image width="1024" height="1024" href="data:image/png;base64,${finalIconBuffer.toString("base64")}"/>
</svg>`;
  await fs.writeFile(path.join(iconsDir, "vitel-v-icon.svg"), svgWrapper);

  // Generate crisp badge overlay for Windows taskbar (vibrant notification badge indicator)
  const badgeSvg = Buffer.from(`
    <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="28" fill="#e11d48" stroke="#ffffff" stroke-width="5"/>
    </svg>
  `);
  const badgeOverlayPng = await sharp(badgeSvg).png().toBuffer();
  await fs.writeFile(path.join(iconsDir, "badge-overlay.png"), badgeOverlayPng);

  console.log("Successfully generated crisp VitelGlobal branded icons in both exe-file and web-app/public!");
}

main().catch(err => {
  console.error("Error creating branded icons:", err);
  process.exit(1);
});
