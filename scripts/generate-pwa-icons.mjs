/**
 * PWA 用の単色 PNG（192 / 512）を public に生成（ブランド色 #5b4bce）。
 * 依存: pngjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

const BRAND = { r: 0x5b, g: 0x4b, b: 0xce };

function writeSolidPng(filename, size) {
  const png = new PNG({ width: size, height: size, colorType: 6 });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (size * y + x) << 2;
      png.data[i] = BRAND.r;
      png.data[i + 1] = BRAND.g;
      png.data[i + 2] = BRAND.b;
      png.data[i + 3] = 255;
    }
  }
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, filename), PNG.sync.write(png));
}

writeSolidPng("pwa-192.png", 192);
writeSolidPng("pwa-512.png", 512);
console.log("PWA icons: public/pwa-192.png, public/pwa-512.png");
