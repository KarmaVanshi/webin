// Generates the extension icons as PNGs with no image dependencies.
// The motif is the product's core gesture: a selection frame with corner handles.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Supersampled coverage so edges stay smooth at every size.
//
// The motif is the product's core gesture: one shape, two skins. A disc split down the
// middle — the theme accent on one side, paper on the other — on the dark ground the
// panel uses. It has to survive 16px, so there is no detail in it beyond that split.
function draw(size) {
  const S = 4; // samples per axis
  const px = Buffer.alloc(size * size * 4);
  const u = size / 128; // design grid is 128 units

  const inset = 4 * u;
  const bgRadius = 26 * u;
  const centre = size / 2;
  const radius = 39 * u;
  // A hairline of ground between the two halves, so the split reads as a split.
  const gap = Math.max(0.75, 2 * u) / 2;

  const GROUND = [15, 23, 42];
  const ACCENT = [34, 197, 94];
  const PAPER = [248, 250, 252];

  const inRounded = (x, y, rx, ry, rw, rh, r) => {
    const cx = Math.min(Math.max(x, rx + r), rx + rw - r);
    const cy = Math.min(Math.max(y, ry + r), ry + rh - r);
    if (x >= rx && x <= rx + rw && y >= ry + r && y <= ry + rh - r) return true;
    if (y >= ry && y <= ry + rh && x >= rx + r && x <= rx + rw - r) return true;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ground = 0;
      let accent = 0;
      let paper = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px0 = x + (sx + 0.5) / S;
          const py0 = y + (sy + 0.5) / S;
          if (inRounded(px0, py0, inset, inset, size - inset * 2, size - inset * 2, bgRadius)) ground++;
          const inDisc = (px0 - centre) ** 2 + (py0 - centre) ** 2 <= radius * radius;
          if (!inDisc) continue;
          if (px0 < centre - gap) accent++;
          else if (px0 > centre + gap) paper++;
        }
      }
      const total = S * S;
      let r = 0, g = 0, b = 0, a = 0;
      const over = (src, cov) => {
        if (cov <= 0) return;
        r = src[0] * cov + r * (1 - cov);
        g = src[1] * cov + g * (1 - cov);
        b = src[2] * cov + b * (1 - cov);
        a = cov + a * (1 - cov);
      };
      over(GROUND, ground / total);
      over(ACCENT, accent / total);
      over(PAPER, paper / total);

      const i = (y * size + x) * 4;
      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

for (const size of [16, 48, 128]) {
  writeFileSync(new URL(`../icons/icon${size}.png`, import.meta.url), encodePng(size, draw(size)));
  console.log(`icons/icon${size}.png`);
}
