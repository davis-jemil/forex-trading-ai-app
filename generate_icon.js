'use strict';
/**
 * Generates a 256x256 PNG icon with a dark navy (#1a1a2e) background
 * and white "FX" text, using only Node.js built-ins (zlib + fs).
 *
 * Run once: node generate_icon.js
 */
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const W = 256, H = 256;

// ── pixel data ────────────────────────────────────────────────────────────────
// RGBA: navy background
const BG = [0x1a, 0x1a, 0x2e, 0xff];
const FG = [0xff, 0xff, 0xff, 0xff]; // white

const pixels = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) pixels.set(BG, i * 4);

// ── bitmap font for "FX" (5×7 pixels each, 1 px gap between, drawn at centre) ─
const GLYPHS = {
  F: [
    [1,1,1,1,1],
    [1,0,0,0,0],
    [1,1,1,1,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
  ],
  X: [
    [1,0,0,0,1],
    [1,0,0,0,1],
    [0,1,0,1,0],
    [0,0,1,0,0],
    [0,1,0,1,0],
    [1,0,0,0,1],
    [1,0,0,0,1],
  ],
};

const SCALE  = 12; // each pixel → 12×12 block
const GW     = 5;  // glyph width in mini-pixels
const GH     = 7;  // glyph height
const GAP    = 2;  // gap between glyphs (mini-pixels)
const totalW = GW * 2 + GAP;          // 12 mini-pixels
const totalH = GH;                     // 7 mini-pixels
const offX   = Math.floor((W - totalW * SCALE) / 2);
const offY   = Math.floor((H - totalH * SCALE) / 2);

function drawGlyph(glyph, startX) {
  glyph.forEach((row, gy) => {
    row.forEach((bit, gx) => {
      if (!bit) return;
      const px = startX + gx * SCALE;
      const py = offY   + gy * SCALE;
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const idx = ((py + dy) * W + (px + dx)) * 4;
          FG.forEach((v, k) => { pixels[idx + k] = v; });
        }
      }
    });
  });
}

drawGlyph(GLYPHS.F, offX);
drawGlyph(GLYPHS.X, offX + (GW + GAP) * SCALE);

// ── PNG encoder ───────────────────────────────────────────────────────────────
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function chunk(type, data) {
  const tBuf = Buffer.from(type, 'ascii');
  const crc  = crc32(Buffer.concat([tBuf, data]));
  return Buffer.concat([u32(data.length), tBuf, data, u32(crc)]);
}

// CRC-32 table
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Build raw scanline data (filter byte 0 + RGBA row per line)
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  const off = y * (1 + W * 4);
  raw[off] = 0; // None filter
  pixels.copy(raw, off + 1, y * W * 4, (y + 1) * W * 4);
}

const compressed = zlib.deflateSync(raw, { level: 9 });

const IHDR = chunk('IHDR', Buffer.concat([
  u32(W), u32(H),
  Buffer.from([8, 2, 0, 0, 0]), // bit depth 8, RGB... wait need RGBA → color type 6
]));

// Rebuild IHDR with color type 6 (RGBA)
const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(W, 0);
ihdrData.writeUInt32BE(H, 4);
ihdrData[8]  = 8; // bit depth
ihdrData[9]  = 6; // color type: RGBA
ihdrData[10] = 0; // compression
ihdrData[11] = 0; // filter
ihdrData[12] = 0; // interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG sig
  chunk('IHDR', ihdrData),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = path.join(__dirname, 'assets');
fs.mkdirSync(outDir, { recursive: true });
const pngPath = path.join(outDir, 'icon.png');
fs.writeFileSync(pngPath, png);
console.log('Written:', pngPath, '(' + png.length + ' bytes)');

// Copy as .ico placeholder (electron-builder converts on real build)
const icoPath = path.join(outDir, 'icon.ico');
fs.copyFileSync(pngPath, icoPath);
console.log('Written:', icoPath, '(PNG copy — convert to real ICO before release build)');
