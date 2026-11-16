// FIRST LIGHT — a tiny seed cracks open and a whole spiral galaxy blooms out of it.
//
// A procedural painting in pure TypeScript (Node standard library only, no
// network, no assets): deep-space indigo dark, a golden crack of light in a
// seed at the bottom of the frame, a beam of light rising from it, and a
// tilted spiral galaxy for a crown — roots of light below mirroring the
// galaxy's arms above. Everything is drawn from one fixed-seed PRNG, so two
// runs write exactly the same bytes.
//
// The grader runs this in a container with the repository read-only at /bot
// and a writable /output; locally MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — the single source of randomness.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0x5eed1234);

// ---------------------------------------------------------------------------
// Value noise for nebula / texture work.
// ---------------------------------------------------------------------------
const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
function lattice(ix: number, iy: number): number {
  return PERM[(PERM[ix & 255] + iy) & 255] / 255;
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = lattice(ix, iy), b = lattice(ix + 1, iy);
  const c = lattice(ix, iy + 1), d = lattice(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x: number, y: number, octaves: number): number {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    v += amp * vnoise(x * f, y * f);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return v / norm;
}
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Float RGB frame buffer with additive splats and dark (occluding) splats.
// ---------------------------------------------------------------------------
const buf = new Float32Array(W * H * 3);
function addSplat(cx: number, cy: number, radius: number, r: number, g: number, b: number, strength: number): void {
  const R = radius * 1.7;
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(W - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(H - 1, Math.ceil(cy + R));
  const inv = 1 / (radius * radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > R * R) continue;
      const fall = Math.exp(-d2 * inv * 1.6) * strength;
      const i = (y * W + x) * 3;
      buf[i] += r * fall; buf[i + 1] += g * fall; buf[i + 2] += b * fall;
    }
  }
}
function darkSplat(cx: number, cy: number, radius: number, alpha: number): void {
  const R = radius * 1.6;
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(W - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(H - 1, Math.ceil(cy + R));
  const inv = 1 / (radius * radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > R * R) continue;
      const keep = 1 - alpha * Math.exp(-d2 * inv * 1.6);
      const i = (y * W + x) * 3;
      buf[i] *= keep; buf[i + 1] *= keep; buf[i + 2] *= keep;
    }
  }
}
function blendStamp(cx: number, cy: number, radius: number, r: number, g: number, b: number, alpha: number): void {
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(W - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(H - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > radius) continue;
      const a = alpha * (1 - smoothstep(radius * 0.55, radius, d));
      const i = (y * W + x) * 3;
      buf[i] = lerp(buf[i], r, a); buf[i + 1] = lerp(buf[i + 1], g, a); buf[i + 2] = lerp(buf[i + 2], b, a);
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Deep-space background: vertical gradient + dark nebula washes + stars.
// ---------------------------------------------------------------------------
for (let y = 0; y < H; y++) {
  const v = y / (H - 1);
  for (let x = 0; x < W; x++) {
    const n = fbm(x * 0.004 + 31.7, y * 0.004 + 11.2, 4);
    const n2 = fbm(x * 0.0016 + 91.3, y * 0.0016 + 47.9, 3);
    // base gradient: near-black indigo up top, a touch warmer near the soil
    let r = lerp(0.012, 0.020, v);
    let g = lerp(0.014, 0.016, v);
    let b = lerp(0.045, 0.030, v);
    // nebula washes, kept dark so the galaxy owns the light
    const neb = Math.max(0, n - 0.52) * 1.9;
    r += neb * 0.055 + Math.max(0, n2 - 0.55) * 0.05;
    g += neb * 0.020;
    b += neb * 0.105 + Math.max(0, n2 - 0.55) * 0.02;
    const teal = Math.max(0, fbm(x * 0.003 + 61.1, y * 0.003 + 77.4, 3) - 0.58) * 1.4;
    g += teal * 0.045; b += teal * 0.05;
    const i = (y * W + x) * 3;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
  }
}
// faint colour pools low in the frame (magenta left, cyan right) for balance
addSplat(150, 760, 300, 0.30, 0.05, 0.42, 0.10);
addSplat(880, 720, 300, 0.04, 0.22, 0.45, 0.10);

// background stars
for (let s = 0; s < 1400; s++) {
  const x = rng() * W, y = Math.pow(rng(), 1.25) * H;
  const bright = rng();
  const warm = rng();
  const cr = lerp(0.75, 1.0, warm), cg = lerp(0.82, 0.9, warm), cb = lerp(1.0, 0.72, warm);
  const inten = 0.12 + Math.pow(bright, 3.2) * 0.85;
  addSplat(x, y, 0.9 + bright * 1.1, cr, cg, cb, inten);
  if (bright > 0.965) addSplat(x, y, 5.5, cr, cg, cb, 0.16); // halo on the few bright ones
}

// ---------------------------------------------------------------------------
// 2. The ground: a soft dark hill the seed sits in.
// ---------------------------------------------------------------------------
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const gy = 946 + 16 * Math.sin(x * 0.004 + 1.7) + 10 * Math.sin(x * 0.0013 + 0.4);
    const a = smoothstep(gy - 5, gy + 9, y);
    if (a <= 0) continue;
    const i = (y * W + x) * 3;
    const shade = 0.55 + 0.45 * clamp((y - gy) / 90, 0, 1);
    buf[i] = lerp(buf[i], 0.016 * shade + 0.006, a);
    buf[i + 1] = lerp(buf[i + 1], 0.012 * shade + 0.004, a);
    buf[i + 2] = lerp(buf[i + 2], 0.026 * shade + 0.008, a);
  }
}
// a pool of spilled gold light on the soil around the seed
addSplat(512, 952, 190, 1.0, 0.66, 0.25, 0.13);
addSplat(512, 946, 90, 1.0, 0.74, 0.34, 0.16);

// ---------------------------------------------------------------------------
// 3. The galaxy crown. Disk frame: centre (512, 352), tilted, squashed.
// ---------------------------------------------------------------------------
const GCX = 512, GCY = 352;
const TILT = (-16 * Math.PI) / 180;
const COS = Math.cos(TILT), SIN = Math.sin(TILT);
const SQUASH = 0.58;
function diskToScreen(u: number, v: number): [number, number] {
  const sy = v * SQUASH;
  return [GCX + u * COS - sy * SIN, GCY + u * SIN + sy * COS];
}
// base glow + core, evaluated per pixel in the disk's bounding box
for (let y = 30; y < 690; y++) {
  for (let x = 120; x < 904; x++) {
    const dx = x - GCX, dy = y - GCY;
    const u = dx * COS + dy * SIN;
    const v = (dy * COS - dx * SIN) / SQUASH;
    const r = Math.sqrt(u * u + v * v);
    if (r > 430) continue;
    const tex = 0.78 + 0.45 * fbm(u * 0.008 + 5.1, v * 0.008 + 2.3, 3);
    const disk = Math.exp(-Math.pow(r / 245, 2)) * 0.27 * tex;
    const core = Math.exp(-Math.pow(r / 74, 2)) * 0.88;
    const coreHot = Math.exp(-Math.pow(r / 27, 2)) * 1.15;
    const i = (y * W + x) * 3;
    buf[i] += disk * 0.42 + core * 1.0 + coreHot * 1.0;
    buf[i + 1] += disk * 0.30 + core * 0.84 + coreHot * 0.93;
    buf[i + 2] += disk * 0.85 + core * 0.55 + coreHot * 0.78;
  }
}
// spiral arms: three arms of additive splats, colour running gold -> magenta
// -> violet -> cyan as they sweep outward
const armPalette: Array<[number, number, number, number]> = [
  [0.0, 1.00, 0.82, 0.55],
  [0.32, 1.00, 0.44, 0.74],
  [0.62, 0.58, 0.38, 1.00],
  [0.85, 0.30, 0.62, 1.00],
  [1.0, 0.28, 0.72, 1.00],
];
function paletteAt(t: number): [number, number, number] {
  for (let k = 0; k < armPalette.length - 1; k++) {
    const a = armPalette[k], b = armPalette[k + 1];
    if (t >= a[0] && t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      return [lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f)];
    }
  }
  return [0.28, 0.72, 1.0];
}
for (let arm = 0; arm < 3; arm++) {
  const phase = (arm * Math.PI * 2) / 3 + 0.5;
  const splats = 3400;
  for (let s = 0; s < splats; s++) {
    const t = Math.pow(rng(), 0.82);
    const r = 26 + t * 318;
    const phi = phase + (r - 26) * 0.0092 + (rng() - 0.5) * (0.22 + t * 0.42);
    const rr = r + (rng() - 0.5) * (14 + t * 34);
    const u = Math.cos(phi) * rr, v = Math.sin(phi) * rr;
    const [sx, sy] = diskToScreen(u, v);
    const [cr, cg, cb] = paletteAt(t);
    const knot = rng() > 0.965;
    const size = (16 * (1 - t) + 4.0) * (knot ? 1.7 : 1);
    const inten = (0.13 + 0.22 * rng()) * (knot ? 2.1 : 1) * (1 - t * 0.35) * (0.30 + 0.70 * smoothstep(0.02, 0.30, t));
    addSplat(sx, sy, size, cr, cg, cb, inten);
    if (knot) addSplat(sx, sy, 1.6, 1, 1, 1, 0.9); // hot young star at the knot
  }
}
// dust lanes: dark splats trailing each arm, carving the light
for (let arm = 0; arm < 3; arm++) {
  const phase = (arm * Math.PI * 2) / 3 + 0.5;
  for (let s = 0; s < 480; s++) {
    const t = 0.15 + rng() * 0.8;
    const r = 26 + t * 318;
    const phi = phase + (r - 26) * 0.0092 + 0.30 + (rng() - 0.5) * 0.12;
    const u = Math.cos(phi) * r, v = Math.sin(phi) * r;
    const [sx, sy] = diskToScreen(u, v);
    darkSplat(sx, sy, 6 + rng() * 8, 0.055);
  }
}
// inter-arm haze: broad, faint splats between the arms so the disk reads as
// one luminous body of stars rather than separate ribbons
for (let arm = 0; arm < 3; arm++) {
  const phase = (arm * Math.PI * 2) / 3 + 0.5 + 0.62;
  for (let s = 0; s < 1100; s++) {
    const t = Math.pow(rng(), 0.9);
    const r = 30 + t * 300;
    const phi = phase + (r - 26) * 0.0092 + (rng() - 0.5) * (0.3 + t * 0.5);
    const rr = r + (rng() - 0.5) * (18 + t * 40);
    const u = Math.cos(phi) * rr, v = Math.sin(phi) * rr;
    const [sx, sy] = diskToScreen(u, v);
    const [cr, cg, cb] = paletteAt(t);
    addSplat(sx, sy, 17 * (1 - t) + 7, cr, cg, cb, 0.045 + 0.05 * rng());
  }
}
// a general population of stars spread across the whole disk
for (let s = 0; s < 1700; s++) {
  const r = 335 * Math.pow(rng(), 1.6);
  const phi = rng() * Math.PI * 2;
  const u = Math.cos(phi) * r, v = Math.sin(phi) * r;
  const [sx, sy] = diskToScreen(u, v);
  const [cr, cg, cb] = paletteAt(clamp(r / 344, 0, 1));
  const mix = rng() * 0.7;
  addSplat(sx, sy, 0.8 + rng() * 1.1, lerp(cr, 1, mix), lerp(cg, 1, mix), lerp(cb, 1, mix), 0.20 + rng() * 0.5);
}
// stars that live inside the disk
for (let s = 0; s < 800; s++) {
  const arm = Math.floor(rng() * 3);
  const phase = (arm * Math.PI * 2) / 3 + 0.5;
  const t = Math.pow(rng(), 1.4);
  const r = 20 + t * 320;
  const phi = phase + (r - 26) * 0.0092 + (rng() - 0.5) * 0.22;
  const u = Math.cos(phi) * r, v = Math.sin(phi) * r;
  const [sx, sy] = diskToScreen(u, v);
  const [cr, cg, cb] = paletteAt(t);
  addSplat(sx, sy, 1.0 + rng() * 1.2, lerp(cr, 1, 0.6), lerp(cg, 1, 0.6), lerp(cb, 1, 0.6), 0.35 + rng() * 0.6);
}

// ---------------------------------------------------------------------------
// 4. Two planets riding the crown: a ringed giant and a small crescent.
// ---------------------------------------------------------------------------
function planet(cx: number, cy: number, rad: number, base: [number, number, number], band: [number, number, number]): void {
  for (let y = Math.floor(cy - rad - 2); y <= cy + rad + 2; y++) {
    for (let x = Math.floor(cx - rad - 2); x <= cx + rad + 2; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const dx = (x - cx) / rad, dy = (y - cy) / rad;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const edge = 1 - smoothstep(0.92, 1.0, Math.sqrt(d2));
      const light = clamp(0.30 + 0.85 * (-dx * 0.55 - dy * 0.75), 0.06, 1.15);
      const stripe = 0.5 + 0.5 * Math.sin(dy * 9.0 + Math.sin(dx * 3.0) * 0.7);
      const i = (y * W + x) * 3;
      const mixv = stripe * 0.55;
      buf[i] = lerp(buf[i], lerp(base[0], band[0], mixv) * light, edge);
      buf[i + 1] = lerp(buf[i + 1], lerp(base[1], band[1], mixv) * light, edge);
      buf[i + 2] = lerp(buf[i + 2], lerp(base[2], band[2], mixv) * light, edge);
    }
  }
}
function ring(cx: number, cy: number, rx: number, ry: number, tilt: number, front: boolean): void {
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  for (let s = 0; s <= 220; s++) {
    const a = (s / 220) * Math.PI * 2;
    const ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
    const isFront = ey > 0;
    if (isFront !== front) continue;
    const x = cx + ex * ct - ey * st, y = cy + ex * st + ey * ct;
    const fade = 0.35 + 0.65 * Math.abs(Math.cos(a));
    blendStamp(x, y, 3.4, 0.92, 0.80, 0.58, 0.34 * fade);
  }
}
addSplat(792, 206, 74, 1.0, 0.78, 0.45, 0.10); // halo behind the ringed planet
ring(792, 206, 64, 17, -0.24, false);
planet(792, 206, 30, [0.88, 0.64, 0.36], [0.98, 0.82, 0.55]);
ring(792, 206, 64, 17, -0.24, true);
// crescent world, lower left of the crown
planet(214, 296, 21, [0.16, 0.44, 0.50], [0.30, 0.66, 0.66]);
for (let y = 268; y <= 324; y++) {
  for (let x = 186; x <= 242; x++) {
    const dx = x - 202, dy = y - 290;
    if (dx * dx + dy * dy < 20 * 20) {
      const i = (y * W + x) * 3;
      buf[i] *= 0.10; buf[i + 1] *= 0.12; buf[i + 2] *= 0.16;
    }
  }
}
addSplat(214, 296, 30, 0.3, 0.7, 0.8, 0.10);

// ---------------------------------------------------------------------------
// 5. The beam: light pouring up out of the seed into the galaxy's heart.
// ---------------------------------------------------------------------------
for (let y = 330; y <= 806; y++) {
  const t = (806 - y) / (806 - 330); // 0 at the seed, 1 at the core
  const halfW = lerp(24, 132, Math.pow(t, 0.8));
  for (let x = 372; x <= 652; x++) {
    const dx = Math.abs(x - 512);
    if (dx > halfW) continue;
    const across = 1 - dx / halfW;
    const tex = 0.72 + 0.5 * fbm(x * 0.02 + 3.3, y * 0.02 + 8.8, 3);
    const fade = Math.sin(Math.PI * clamp(t * 1.06, 0, 1)) * 0.75 + 0.25;
    const inten = Math.pow(across, 1.8) * 0.34 * tex * fade;
    const core = Math.pow(across, 5.0) * 0.5 * fade;
    const i = (y * W + x) * 3;
    buf[i] += (1.0 * inten + 1.0 * core);
    buf[i + 1] += (0.74 * inten + 0.88 * core);
    buf[i + 2] += (0.34 * inten + 0.66 * core);
  }
}
// orbs of light rising inside the beam
for (let s = 0; s < 110; s++) {
  const y = 356 + Math.pow(rng(), 1.15) * 436;
  const t = (806 - y) / 476;
  const spread = lerp(24, 132, Math.pow(clamp(t, 0, 1), 0.8)) * 1.25;
  const x = 512 + (rng() + rng() + rng() - 1.5) * spread * 0.66;
  const gold = rng() > 0.3;
  const r = gold ? 1.0 : 0.45, g = gold ? 0.78 : 0.75, b = gold ? 0.38 : 1.0;
  const size = 1.2 + rng() * 3.6;
  addSplat(x, y, size, r, g, b, 0.35 + rng() * 0.55);
  addSplat(x, y, size * 3.2, r, g, b, 0.07);
}

// ---------------------------------------------------------------------------
// 6. Veins of light in the soil under the seed — the galaxy's arms, mirrored
//    below: the same light that bursts upward also spreads underground.
// ---------------------------------------------------------------------------
function sampleCurve(points: Array<[number, number]>, stepPx: number): Array<[number, number, number]> {
  // Catmull-Rom through the points; returns [x, y, t] samples, t along the curve
  const pts: Array<[number, number]> = [points[0], ...points, points[points.length - 1]];
  const segs: number[] = [];
  let total = 0;
  for (let k = 1; k < pts.length - 2; k++) {
    const dx = pts[k + 1][0] - pts[k][0], dy = pts[k + 1][1] - pts[k][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    segs.push(len); total += len;
  }
  const out: Array<[number, number, number]> = [];
  let walked = 0;
  for (let k = 1; k < pts.length - 2; k++) {
    const p0 = pts[k - 1], p1 = pts[k], p2 = pts[k + 1], p3 = pts[k + 2];
    const steps = Math.max(2, Math.ceil(segs[k - 1] / stepPx));
    for (let sIdx = 0; sIdx < steps; sIdx++) {
      const u = sIdx / steps;
      const u2 = u * u, u3 = u2 * u;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3);
      out.push([x, y, (walked + segs[k - 1] * u) / total]);
    }
    walked += segs[k - 1];
  }
  const last = points[points.length - 1];
  out.push([last[0], last[1], 1]);
  return out;
}
function stroke(points: Array<[number, number]>, w0: number, w1: number, col: [number, number, number], alpha: number): void {
  for (const [x, y, t] of sampleCurve(points, 3)) {
    blendStamp(x, y, lerp(w0, w1, t), col[0], col[1], col[2], alpha);
  }
}
function glowStroke(
  points: Array<[number, number]>,
  radius: number,
  from: [number, number, number],
  to: [number, number, number],
  strength: number,
): void {
  for (const [x, y, t] of sampleCurve(points, 4)) {
    const fade = (1 - t * 0.55) * strength;
    addSplat(x, y, radius * (1 - t * 0.4), lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t), fade);
    addSplat(x, y, radius * 3.4, lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t), fade * 0.16);
  }
}
{
  const gold: [number, number, number] = [1.0, 0.70, 0.30];
  const cyan: [number, number, number] = [0.35, 0.70, 1.0];
  const magenta: [number, number, number] = [0.95, 0.42, 0.85];
  const veins: Array<[Array<[number, number]>, [number, number, number]]> = [
    [[[512, 946], [486, 968], [438, 984], [382, 992]], cyan],
    [[[512, 946], [544, 970], [596, 986], [652, 992]], magenta],
    [[[512, 946], [508, 976], [498, 1000], [486, 1018]], gold],
    [[[512, 946], [466, 962], [404, 972], [330, 976]], magenta],
    [[[512, 946], [560, 960], [626, 970], [700, 972]], cyan],
    [[[486, 968], [452, 986], [408, 1002]], gold],
    [[[544, 970], [574, 990], [606, 1006]], gold],
  ];
  for (const [def, tip] of veins) glowStroke(def, 2.6, gold, tip, 0.30);
}

// ---------------------------------------------------------------------------
// 7. The seed: a warm almond of a thing, cracked open at the top.
// ---------------------------------------------------------------------------
const SCX = 512, SCY = 868, SRX = 76, SRY = 108;
const crack: Array<[number, number]> = [
  [472, 808], [486, 818], [500, 802], [514, 816], [528, 804], [542, 814], [554, 806],
];
function distToCrack(x: number, y: number): number {
  let best = 1e9;
  for (let k = 0; k < crack.length - 1; k++) {
    const ax = crack[k][0], ay = crack[k][1], bx = crack[k + 1][0], by = crack[k + 1][1];
    const abx = bx - ax, aby = by - ay;
    const t = clamp(((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby), 0, 1);
    const dx = x - (ax + abx * t), dy = y - (ay + aby * t);
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
for (let y = SCY - SRY - 26; y <= SCY + SRY + 4; y++) {
  for (let x = SCX - SRX - 26; x <= SCX + SRX + 26; x++) {
    let px = (x - SCX) / SRX;
    const py = (y - SCY) / SRY;
    // pinch the top of the seed to a soft point
    const pinch = 1 - 0.50 * smoothstep(-0.1, 1.0, -py);
    px = px / pinch;
    const d = Math.sqrt(px * px + py * py);
    const i = (y * W + x) * 3;
    if (d < 1.03) {
      const inside = 1 - smoothstep(0.965, 1.0, d);
      const grain = 0.80 + 0.40 * fbm(x * 0.03 + 7.7, y * 0.03 + 1.9, 3);
      let shade = clamp(0.60 - py * 0.66 - px * 0.16, 0.04, 1.05) * grain;
      // a faint suture line running down the seed's face
      shade *= 1 - 0.13 * Math.exp(-Math.pow((px - 0.16 + py * 0.05) / 0.045, 2)) * (1 - Math.abs(py));
      let r = lerp(0.120, 0.55, shade);
      let g = lerp(0.060, 0.315, shade);
      let b = lerp(0.022, 0.120, shade);
      // golden rim where the galaxy's light catches the top edge
      const rim = smoothstep(0.86, 1.0, d) * smoothstep(0.1, 0.9, -py);
      r += rim * 0.55; g += rim * 0.34; b += rim * 0.10;
      buf[i] = lerp(buf[i], r, inside);
      buf[i + 1] = lerp(buf[i + 1], g, inside);
      buf[i + 2] = lerp(buf[i + 2], b, inside);
    }
    // the crack: a jagged seam of pure light across the seed's crown
    const dc = distToCrack(x, y);
    if (dc < 26) {
      const glow = Math.exp(-Math.pow(dc / 6.5, 2)) * 1.35;
      const coreLine = Math.exp(-Math.pow(dc / 1.8, 2)) * 2.4;
      buf[i] += 1.0 * glow + 1.0 * coreLine;
      buf[i + 1] += 0.72 * glow + 0.86 * coreLine;
      buf[i + 2] += 0.30 * glow + 0.58 * coreLine;
    }
  }
}
// splinters of light escaping the crack
for (let s = 0; s < 46; s++) {
  const [bx, by] = crack[1 + Math.floor(rng() * (crack.length - 2))];
  const x = bx + (rng() - 0.5) * 22, y = by - rng() * 30;
  addSplat(x, y, 1 + rng() * 2.2, 1.0, 0.78, 0.4, 0.4 + rng() * 0.6);
}
// the burst: a halo at the crack and spores flung outward in an upward fan —
// the held breath the instant after the shell gives way
addSplat(512, 806, 62, 1.0, 0.72, 0.32, 0.16);
addSplat(512, 806, 26, 1.0, 0.85, 0.55, 0.20);
for (let s = 0; s < 70; s++) {
  const ang = -Math.PI / 2 + (rng() - 0.5) * 2.1;
  const dist = 24 + Math.pow(rng(), 1.6) * 130;
  const x = 512 + Math.cos(ang) * dist, y = 806 + Math.sin(ang) * dist * 0.92;
  const gold = rng() > 0.25;
  addSplat(x, y, 1 + rng() * 2.6, gold ? 1.0 : 0.5, gold ? 0.76 : 0.78, gold ? 0.36 : 1.0, 0.3 + rng() * 0.55);
}
// shockwave rings rippling through the soil from the seed
for (const [rx, ry, a] of [[150, 24, 0.30], [238, 38, 0.17], [330, 52, 0.09]] as Array<[number, number, number]>) {
  for (let s = 0; s <= 130; s++) {
    const th = (s / 130) * Math.PI * 2;
    const x = 512 + Math.cos(th) * rx, y = 950 + Math.sin(th) * ry;
    if (y < 946) continue;
    addSplat(x, y, 3.2, 1.0, 0.70, 0.30, a * (0.7 + 0.3 * Math.sin(th * 3)));
  }
}

// ---------------------------------------------------------------------------
// 8. The sprout: a young green stem climbing out of the crack toward the light.
// ---------------------------------------------------------------------------
stroke([[512, 810], [498, 756], [502, 706]], 5.2, 2.6, [0.07, 0.30, 0.11], 0.96);
function leaf(cx: number, cy: number, angle: number, len: number, wid: number, flip: number): void {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const x0 = Math.floor(cx - len), x1 = Math.ceil(cx + len);
  const y0 = Math.floor(cy - len), y1 = Math.ceil(cy + len);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const dx = x - cx, dy = y - cy;
      const u = (dx * ca + dy * sa) / len;          // 0 at base, 1 at tip
      const v = (-dx * sa + dy * ca) / wid;          // across the leaf
      if (u < 0 || u > 1) continue;
      const profile = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.75);
      const across = Math.abs(v + flip * 0.35 * Math.sin(Math.PI * u)); // a gentle curl
      if (across > profile) continue;
      const edge = 1 - smoothstep(0.8, 1.0, across / Math.max(profile, 0.001));
      const vein = 1 - 0.35 * Math.exp(-Math.pow((v + flip * 0.35 * Math.sin(Math.PI * u)) / 0.08, 2));
      const light = (0.35 + 0.75 * u) * vein;
      const i = (y * W + x) * 3;
      buf[i] = lerp(buf[i], 0.13 * light + 0.03, edge);
      buf[i + 1] = lerp(buf[i + 1], 0.42 * light + 0.05, edge);
      buf[i + 2] = lerp(buf[i + 2], 0.14 * light + 0.03, edge);
    }
  }
}
leaf(502, 706, -0.95, 64, 22, 1);   // up and to the right
leaf(500, 712, -2.25, 50, 17, -1);  // up and to the left
addSplat(503, 700, 26, 0.5, 1.0, 0.45, 0.10); // fresh glow around the leaves

// ---------------------------------------------------------------------------
// 9. Vignette, tone map, quantise.
// ---------------------------------------------------------------------------
const out = new Uint8Array(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const nx = (x - W / 2) / (W / 2), ny = (y - H / 2) / (H / 2);
    const vig = 1 - 0.36 * smoothstep(0.55, 1.35, Math.sqrt(nx * nx + ny * ny));
    let r = buf[i] * vig, g = buf[i + 1] * vig, b = buf[i + 2] * vig;
    r = 1 - Math.exp(-r * 1.5);
    g = 1 - Math.exp(-g * 1.5);
    b = 1 - Math.exp(-b * 1.5);
    // a whisper of saturation
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = clamp(lum + (r - lum) * 1.07, 0, 1);
    g = clamp(lum + (g - lum) * 1.07, 0, 1);
    b = clamp(lum + (b - lum) * 1.07, 0, 1);
    out[i] = Math.round(Math.pow(r, 0.94) * 255);
    out[i + 1] = Math.round(Math.pow(g, 0.94) * 255);
    out[i + 2] = Math.round(Math.pow(b, 0.94) * 255);
  }
}

// ---------------------------------------------------------------------------
// 10. PNG encode (zlib from the standard library) with per-row filter choice.
// ---------------------------------------------------------------------------
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(new Uint8Array(body)), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(): Buffer {
  const stride = W * 3;
  const raw = Buffer.alloc((stride + 1) * H);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < H; y++) {
    const row = out.subarray(y * stride, (y + 1) * stride);
    // try every filter, keep the one with the smallest sum of |signed bytes|
    let bestFilter = 0, bestScore = Infinity;
    let bestRow: Uint8Array | null = null;
    for (let f = 0; f <= 4; f++) {
      const cand = new Uint8Array(stride);
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 3 ? row[x - 3] : 0;
        const b = prev[x];
        const c = x >= 3 ? prev[x - 3] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const val = (row[x] - pred) & 0xff;
        cand[x] = val;
        score += val < 128 ? val : 256 - val;
      }
      if (score < bestScore) { bestScore = score; bestFilter = f; bestRow = cand; }
    }
    const off = y * (stride + 1);
    raw[off] = bestFilter;
    raw.set(bestRow as Uint8Array, off + 1);
    prev.set(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour RGB
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

const png = encodePng();
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), png);
console.log(`wrote ${join(outDir, 'entry.png')} (${png.length} bytes)`);
