// PNG ikonok előállítása (192, 512) függőség nélkül: node scripts/make-icons.mjs
// Ugyanazt a rajzot követi, mint az icons/icon.svg (64x64-es koordinátákban).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BLUE = [29, 78, 216], WHITE = [255, 255, 255], YELLOW = [250, 204, 21];

const roundRect = (x, y, w, h, r) => (px, py) => {
  const cx = Math.max(x + r, Math.min(px, x + w - r)), cy = Math.max(y + r, Math.min(py, y + h - r));
  return px >= x && px <= x + w && py >= y && py <= y + h && (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};
const circle = (cx, cy, r) => (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
const poly = (pts) => (px, py) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const ring = (cx, cy, r, w) => (px, py) => { const d = Math.hypot(px - cx, py - cy); return d <= r + w / 2 && d >= r - w / 2; };

// rétegek alulról felfelé (a maskable ikonhoz a teljes háttér kék)
const layers = (full) => [
  [full ? () => true : roundRect(0, 0, 64, 64, 14), BLUE],
  [roundRect(9, 20, 28, 20, 3), WHITE],
  [poly([[37, 26], [46, 26], [53, 34], [53, 40], [37, 40]]), WHITE],
  [poly([[41, 29], [45.5, 29], [49, 33], [41, 33]]), BLUE],
  [circle(19, 43, 6.25), BLUE], [circle(19, 43, 3.75), WHITE],
  [circle(45, 43, 6.25), BLUE], [circle(45, 43, 3.75), WHITE],
  [circle(48, 15, 8), YELLOW],
  [(px, py) => (Math.abs(px - 48) <= 1.1 && py >= 10.5 && py <= 15.5)
    || (Math.abs((px - 48) * 2 - (py - 15.5) * 3) <= 2.4 && px >= 48 && px <= 51.2 && py >= 15 && py <= 17.8), BLUE],
];

function render(size, full) {
  const ls = layers(full);
  const scale = full ? 64 / (size * 0.8) : 64 / size, off = full ? size * 0.1 : 0;
  const ss = 4; // élsimítás: 4x4 minta pixelenként
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const px = ((x + (sx + 0.5) / ss) - off) * scale, py = ((y + (sy + 0.5) / ss) - off) * scale;
        let col = full ? BLUE : null;
        for (const [hit, c] of ls) if (hit(px, py)) col = c;
        if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
      }
      const n = ss * ss, i = y * (size * 4 + 1) + 1 + x * 4;
      const cov = a / 255;
      raw[i] = cov ? r / cov : 0; raw[i + 1] = cov ? g / cov : 0; raw[i + 2] = cov ? b / cov : 0; raw[i + 3] = a / n;
    }
  }
  return png(size, size, raw);
}

function png(w, h, raw) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const dir = new URL('../icons/', import.meta.url);
writeFileSync(new URL('icon-192.png', dir), render(192, true));
writeFileSync(new URL('icon-512.png', dir), render(512, true));
console.log('ikonok kész');
