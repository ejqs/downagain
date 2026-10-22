// Renders the app icons from assets/icon.svg. Run after changing the SVG:
//   bun scripts/make-icons.ts
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";

const svg = await readFile("assets/icon.svg");
const maskable = await readFile("assets/icon-maskable.svg");
const png = (src: Buffer, size: number) => sharp(src, { density: (72 * size) / 32 }).resize(size, size).png().toBuffer();

// favicon.ico holds PNG frames, which every current browser reads.
const frames = await Promise.all([16, 32, 48].map((s) => png(svg, s).then((data) => ({ s, data }))));
const header = Buffer.alloc(6 + frames.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach(({ s, data }, k) => {
  const e = 6 + k * 16;
  header.writeUInt8(s, e);
  header.writeUInt8(s, e + 1);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(data.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += data.length;
});
await writeFile("src/app/favicon.ico", Buffer.concat([header, ...frames.map((f) => f.data)]));
await writeFile("src/app/icon.svg", svg);
await writeFile("src/app/apple-icon.png", await png(maskable, 180));
await writeFile("public/icon-192.png", await png(svg, 192));
await writeFile("public/icon-512.png", await png(svg, 512));
await writeFile("public/icon-maskable-512.png", await png(maskable, 512));
console.log("icons written");
