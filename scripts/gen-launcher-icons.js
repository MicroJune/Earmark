/*
 * Earmark launcher-icon generator (pure Node, no deps).
 * Source: assets/earmark.png (composite violet tile + white bookmark/waveform).
 * Produces standard Android adaptive layers + a clean iOS/legacy icon by:
 *   - recreating the diagonal violet gradient (drops the source's black corners)
 *   - extracting the white motif as a soft alpha mask (whiteness vs local gradient)
 *   - scaling the motif into the adaptive safe zone (<=33% radius)
 * Overwrites the files app.json already references, so no config path changes.
 */
const fs = require('fs');
const zlib = require('zlib');
const ASSETS = '/home/daryl/projects/Earmark/assets';

// ---------- PNG decode (truecolor / truecolor+alpha) ----------
function decodePNG(file) {
  const buf = fs.readFileSync(file);
  const W = buf.readUInt32BE(16), H = buf.readUInt32BE(20);
  const ch = buf[25] === 6 ? 4 : 3;
  let p = 8, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = W * ch;
  const img = Buffer.alloc(H * stride);
  const paeth = (a, b, c) => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  let q = 0;
  for (let y = 0; y < H; y++) {
    const ft = raw[q++];
    for (let x = 0; x < stride; x++) {
      const v = raw[q++];
      const a = x >= ch ? img[y * stride + x - ch] : 0;
      const b = y > 0 ? img[(y - 1) * stride + x] : 0;
      const c = (x >= ch && y > 0) ? img[(y - 1) * stride + x - ch] : 0;
      let val;
      if (ft === 0) val = v; else if (ft === 1) val = v + a; else if (ft === 2) val = v + b; else if (ft === 3) val = v + ((a + b) >> 1); else val = v + paeth(a, b, c);
      img[y * stride + x] = val & 255;
    }
  }
  return { W, H, ch, img };
}

// ---------- PNG encode ----------
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crc]); }
function encodePNG(w, h, ch, px) {
  const stride = w * ch;
  const rawf = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { rawf[y * (stride + 1)] = 0; px.copy(rawf, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const comp = zlib.deflateSync(rawf, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', comp), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- source + helpers ----------
const src = decodePNG(`${ASSETS}/earmark.png`);
const { W: SW, H: SH, ch: SC, img: SI } = src;
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

function bilinear(fx, fy) { // fx,fy in [0,1] -> [r,g,b]
  const x = clamp(fx * (SW - 1), 0, SW - 1), y = clamp(fy * (SH - 1), 0, SH - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, SW - 1), y1 = Math.min(y0 + 1, SH - 1);
  const dx = x - x0, dy = y - y0;
  const at = (xx, yy) => { const o = yy * SW * SC + xx * SC; return [SI[o], SI[o + 1], SI[o + 2]]; };
  const a = at(x0, y0), b = at(x1, y0), c = at(x0, y1), d = at(x1, y1);
  return [0, 1, 2].map(i => a[i] * (1 - dx) * (1 - dy) + b[i] * dx * (1 - dy) + c[i] * (1 - dx) * dy + d[i] * dx * dy);
}

// Recreated diagonal gradient (fitted from samples; t = (fx+fy)/2)
const G0 = [108, 107, 255], G1 = [86, 58, 234];
function gradient(fx, fy) { const t = clamp((fx + fy) / 2, 0, 1); return [0, 1, 2].map(i => G0[i] + (G1[i] - G0[i]) * t); }

// whiteness alpha of motif vs local gradient, using R&G (B is saturated in violet)
const WHITE = [252, 252, 254];
function motifAlphaRaw(fx, fy) {
  const px = bilinear(fx, fy), bg = gradient(fx, fy);
  let num = 0, den = 0;
  for (const i of [0, 1]) { num += px[i] - bg[i]; den += WHITE[i] - bg[i]; }
  return clamp(num / den, 0, 1);
}
// Remap to kill faint background haze (gradient-model mismatch) while keeping soft motif edges.
const LO = 0.34, HI = 0.82;
function motifAlpha(fx, fy) {
  const a = motifAlphaRaw(fx, fy);
  return clamp((a - LO) / (HI - LO), 0, 1);
}

// --- sanity: max raw alpha in a background strip vs min raw alpha in motif core ---
{
  let bgMax = 0;
  for (let y = 0.22; y <= 0.78; y += 0.01) for (let x = 0.14; x <= 0.20; x += 0.01) bgMax = Math.max(bgMax, motifAlphaRaw(x, y));
  let coreMin = 1;
  for (let y = 0.30; y <= 0.45; y += 0.01) coreMin = Math.min(coreMin, motifAlphaRaw(0.5, y)); // bookmark body, solid white
  console.log('raw alpha — bg strip max', bgMax.toFixed(3), '| motif core min', coreMin.toFixed(3), '| threshold LO', LO);
}

// ---------- find motif max radius to size the safe-zone scale ----------
let maxR = 0;
const step = 2;
for (let y = 0; y < SH; y += step) for (let x = 0; x < SW; x += step) {
  if (motifAlpha(x / SW, y / SH) > 0.6) { const r = Math.hypot(x / SW - 0.5, y / SH - 0.5); if (r > maxR) maxR = r; }
}
const SAFE_R = 0.31;                       // keep motif within 31% radius (<33% guaranteed safe zone)
const scale = clamp(SAFE_R / maxR, 0.5, 0.95);
console.log('motif max radius', (maxR * 100).toFixed(1) + '%', '-> foreground scale', scale.toFixed(3));

// ---------- renderers ----------
const N = 1024;
function renderTile(size) { // RGB, full-bleed clean gradient + motif at original size (icon / favicon)
  const out = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / (size - 1), fy = y / (size - 1);
    const bg = gradient(fx, fy), a = motifAlpha(fx, fy), o = (y * size + x) * 3;
    for (let i = 0; i < 3; i++) out[o + i] = clamp(Math.round(bg[i] * (1 - a) + WHITE[i] * a), 0, 255);
  }
  return encodePNG(size, size, 3, out);
}
// separable box blur (multi-pass ~ gaussian) over a single channel
function boxBlur(src, w, h, radius, passes) {
  let buf = Float32Array.from(src);
  const tmp = new Float32Array(w * h);
  const win = radius * 2 + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w; let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += buf[row + clamp(k, 0, w - 1)];
      for (let x = 0; x < w; x++) { tmp[row + x] = sum / win; sum += buf[row + clamp(x + radius + 1, 0, w - 1)] - buf[row + clamp(x - radius, 0, w - 1)]; }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += tmp[clamp(k, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) { buf[y * w + x] = sum / win; sum += tmp[clamp(y + radius + 1, 0, h - 1) * w + x] - tmp[clamp(y - radius, 0, h - 1) * w + x]; }
    }
  }
  return buf;
}

// Apple-style splash: rounded squircle brand tile + soft drop shadow on transparent,
// centered by the splash plugin on a light background. 3x supersampled for smooth edges.
function renderSplashApple() {
  const SS = 3, M = N * SS;
  const T = 700 * SS, half = T / 2, cen = M / 2, nExp = 5; // superellipse exponent ~ iOS squircle
  const mask = new Uint8Array(M * M);
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
    const nx = Math.abs((x - cen) / half), ny = Math.abs((y - cen) / half);
    if (Math.pow(nx, nExp) + Math.pow(ny, nExp) <= 1) mask[y * M + x] = 255;
  }
  const blurred = boxBlur(mask, M, M, Math.round(22 * SS), 3); // soft shadow
  const dy = Math.round(20 * SS), shOp = 0.18;
  const accR = new Float64Array(N * N), accG = new Float64Array(N * N), accB = new Float64Array(N * N), accA = new Float64Array(N * N);
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
    const sy = y - dy;
    const aS = (sy >= 0 && sy < M) ? (blurred[sy * M + x] / 255) * shOp : 0;
    const tA = mask[y * M + x] / 255;
    let r, g, b, a;
    if (tA > 0) {
      const tfx = (x - (cen - half)) / T, tfy = (y - (cen - half)) / T;
      const bg = gradient(tfx, tfy), ma = motifAlpha(tfx, tfy);
      r = bg[0] * (1 - ma) + WHITE[0] * ma; g = bg[1] * (1 - ma) + WHITE[1] * ma; b = bg[2] * (1 - ma) + WHITE[2] * ma;
      a = tA + aS * (1 - tA);
      r = (r * tA) / a; g = (g * tA) / a; b = (b * tA) / a; // shadow is black -> no color term
    } else { a = aS; r = 0; g = 0; b = 0; }
    const oi = ((y / SS) | 0) * N + ((x / SS) | 0);
    accR[oi] += r * a; accG[oi] += g * a; accB[oi] += b * a; accA[oi] += a;
  }
  const out = Buffer.alloc(N * N * 4), inv = 1 / (SS * SS);
  for (let i = 0; i < N * N; i++) {
    const a = accA[i] * inv;
    const r = accA[i] > 1e-6 ? accR[i] / accA[i] : 0, g = accA[i] > 1e-6 ? accG[i] / accA[i] : 0, b = accA[i] > 1e-6 ? accB[i] / accA[i] : 0;
    out[i * 4] = clamp(Math.round(r), 0, 255); out[i * 4 + 1] = clamp(Math.round(g), 0, 255); out[i * 4 + 2] = clamp(Math.round(b), 0, 255); out[i * 4 + 3] = clamp(Math.round(a * 255), 0, 255);
  }
  return encodePNG(N, N, 4, out);
}
function renderBackground() { // RGB, gradient only
  const out = Buffer.alloc(N * N * 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const bg = gradient(x / (N - 1), y / (N - 1)), o = (y * N + x) * 3;
    for (let i = 0; i < 3; i++) out[o + i] = clamp(Math.round(bg[i]), 0, 255);
  }
  return encodePNG(N, N, 3, out);
}
function renderMotifLayer(color) { // RGBA, scaled motif in safe zone; color=[r,g,b]
  const out = Buffer.alloc(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fxo = x / (N - 1), fyo = y / (N - 1);
    const sfx = 0.5 + (fxo - 0.5) / scale, sfy = 0.5 + (fyo - 0.5) / scale;
    const o = (y * N + x) * 4;
    let a = 0;
    if (sfx >= 0 && sfx <= 1 && sfy >= 0 && sfy <= 1) a = motifAlpha(sfx, sfy);
    out[o] = color[0]; out[o + 1] = color[1]; out[o + 2] = color[2]; out[o + 3] = clamp(Math.round(a * 255), 0, 255);
  }
  return encodePNG(N, N, 4, out);
}

fs.writeFileSync(`${ASSETS}/icon.png`, renderTile(N));
fs.writeFileSync(`${ASSETS}/android-icon-background.png`, renderBackground());
fs.writeFileSync(`${ASSETS}/android-icon-foreground.png`, renderMotifLayer(WHITE));
fs.writeFileSync(`${ASSETS}/android-icon-monochrome.png`, renderMotifLayer([0, 0, 0]));
fs.writeFileSync(`${ASSETS}/favicon.png`, renderTile(48));
fs.writeFileSync(`${ASSETS}/splash-icon.png`, renderSplashApple());
console.log('wrote icon.png, android-icon-{background,foreground,monochrome}.png, favicon.png, splash-icon.png');
