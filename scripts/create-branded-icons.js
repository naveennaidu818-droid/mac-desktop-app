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

  // Read vitelglobal-logo.svg
  const svgPath = path.join(iconsDir, "vitelglobal-logo.svg");
  const svgContent = await fs.readFile(svgPath, "utf8");

  // Extract embedded base64 PNG from id4 clipPath (contains the authentic orange/yellow V swoosh)
  const match = svgContent.match(/clipPath id="id4"[\s\S]*?xlink:href="data:image\/png;base64,([^"]+)"/);
  
  let vMarkPngBuffer;
  if (match) {
    const rawPng = Buffer.from(match[1], "base64");
    const cropped = await sharp(rawPng)
      .extract({ left: 0, top: 0, width: 250, height: 264 })
      .toBuffer();

    const { data, info } = await sharp(cropped).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Convert white background pixels to transparent alpha
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 230 && g > 230 && b > 230) {
        data[i + 3] = 0;
      }
    }

    vMarkPngBuffer = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 }
    }).png().toBuffer();
  }

  // Build high-res 1024x1024 icon:
  // High-res canvas holding the crisp orange/yellow V logo mark centered
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
        input: await sharp(vMarkPngBuffer).resize(860, 860, { fit: "contain" }).toBuffer(),
        gravity: "center"
      }
    ])
    .png()
    .toBuffer();

  const finalIconBuffer = squareIcon;

  // Save icon.png to build/icons and web-app/public
  await fs.writeFile(path.join(iconsDir, "icon.png"), finalIconBuffer);
  await fs.writeFile(path.join(iconsDir, "tray.png"), finalIconBuffer);
  const fsSync = require("node:fs");
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

  console.log("Successfully generated crisp VitelGlobal branded icons in both exe-file and web-app/public!");
}

main().catch(err => {
  console.error("Error creating branded icons:", err);
  process.exit(1);
});
