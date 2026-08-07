"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

async function main() {
  const iconsDir = path.join(__dirname, "..", "build", "icons");
  const svgPath = path.join(iconsDir, "vitelglobal-logo.svg");
  const svgContent = await fs.readFile(svgPath, "utf8");

  // Extract the base64 PNG embedded inside id4 clipPath
  const match = svgContent.match(/clipPath id="id4"[\s\S]*?xlink:href="data:image\/png;base64,([^"]+)"/);

  if (!match) {
    console.error("Could not find id4 clipPath image");
    process.exit(1);
  }

  const imageBuffer = Buffer.from(match[1], "base64");
  
  // Crop only the V logo section (X: 1100 to 8000 out of 33528, Y: 1200 to 6800 out of 7620)
  const meta = await sharp(imageBuffer).metadata();
  console.log("Extracted PNG metadata:", meta);

  // The base64 PNG has width=1000, height=264.
  // The V logo occupies the far left section (width ~260, height 264)
  const cropLeft = 0;
  const cropTop = 0;
  const cropWidth = 260;
  const cropHeight = meta.height;

  const croppedV = await sharp(imageBuffer)
    .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
    .toBuffer();

  // Create a 1024x1024 high-res icon canvas with rounded squircle badge background or transparent
  // We composite the exact extracted V logo centered on a sleek background
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
        input: await sharp(croppedV).resize(860, 860, { fit: "contain" }).toBuffer(),
        gravity: "center"
      }
    ])
    .png()
    .toBuffer();

  const vIconPngPath = path.join(iconsDir, "vitel-v-only.png");
  await fs.writeFile(vIconPngPath, squareIcon);

  // Also construct clean SVG containing the exact V clipPath shape
  const vSvgContent = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <clipPath id="vClip">
      <path d="M 235 210 C 235 210 160 162 180 268 C 180 268 209 378 279 401 C 279 401 310 409 315 373 C 315 373 326 313 263 234 C 263 234 333 153 378 186 C 378 186 398 201 393 242 C 386 298 350 353 317 392 C 317 392 307 445 245 429 C 220 423 168 404 118 351 C 103 335 32 268 16 176 C 16 176 6 79 107 115 C 107 115 181 143 235 210 Z" transform="scale(2.1) translate(40, 40)"/>
    </clipPath>
  </defs>
  <image width="1024" height="1024" href="data:image/png;base64,${squareIcon.toString("base64")}"/>
</svg>`;

  const vIconSvgPath = path.join(iconsDir, "vitel-v-icon.svg");
  await fs.writeFile(vIconSvgPath, vSvgContent);

  console.log("Successfully extracted exact V logo to:", vIconPngPath, "and", vIconSvgPath);
}

main().catch(err => {
  console.error("Error extracting V logo:", err);
  process.exit(1);
});