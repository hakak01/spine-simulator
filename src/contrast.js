// Contrast injection: decide the pattern from the needle-tip position, then spread
// contrast through the matching space over time (epidural/perineural, vascular,
// intrathecal, subdural, intradiscal, soft tissue). The result is a small 3D density
// grid that the C-arm renderer adds to the CT.
import * as THREE from 'three';

const DISC = 10, EPI = 11, ROOT = 12, FOR = 13, SAC = 3, BONE = 2;

export const PATTERNS = {
  epidural: { name: 'Epidural / perineural', ok: true,
    text: 'Contrast outlines the nerve root and flows medially along the pedicle into the epidural space. Correct pattern.' },
  vascular: { name: 'Vascular', ok: false,
    text: 'Contrast streaked away and washed out in under 1 second. The tip is in a vessel. Do not inject steroid: reposition.' },
  intrathecal: { name: 'Intrathecal', ok: false,
    text: 'Contrast spreads fast inside the dural sac, pools anteriorly (dependent when prone) and outlines the cauda equina (myelogram).' },
  subdural: { name: 'Subdural', ok: false,
    text: 'Thin, sharply edged contrast along the sac, spreading far with a small volume and no root-sleeve filling.' },
  intradiscal: { name: 'Intradiscal', ok: false,
    text: 'Contrast stays inside the disc space (nucleogram). The tip is too anterior / in the annulus.' },
  softtissue: { name: 'Soft tissue / muscle', ok: false,
    text: 'Irregular, feathery blob that does not follow the root or the epidural space. The tip is not in the foramen.' },
};

const VOL_ML = 1.0;          // contrast volume per injection
const INJ_SEC = 3.0;         // injection time
const VOX_UL = 1.5 * 1.5 * 1.5; // µL per voxel
const BOX = [72, 64, 112];   // contrast grid, voxels (108 x 96 x 168 mm)

class Heap { // binary min-heap of [cost, index]
  constructor() { this.c = []; this.i = []; }
  get size() { return this.c.length; }
  push(c, i) {
    const C = this.c, I = this.i; let k = C.length; C.push(c); I.push(i);
    while (k > 0) { const p = (k - 1) >> 1; if (C[p] <= c) break; C[k] = C[p]; I[k] = I[p]; k = p; }
    C[k] = c; I[k] = i;
  }
  pop() {
    const C = this.c, I = this.i, top = I[0], lc = C.pop(), li = I.pop(), n = C.length;
    if (n) {
      let k = 0;
      for (;;) {
        let m = 2 * k + 1; if (m >= n) break;
        if (m + 1 < n && C[m + 1] < C[m]) m++;
        if (C[m] >= lc) break;
        C[k] = C[m]; I[k] = I[m]; k = m;
      }
      C[k] = lc; I[k] = li;
    }
    return top;
  }
}

export class Contrast {
  constructor(tissue, meta) {
    this.t = tissue;
    this.sp = meta.spacing;
    this.anat = meta.anatomy;
    this.n = BOX[0] * BOX[1] * BOX[2];
    this.data = new Uint8Array(this.n);   // what the renderer sees
    this.base = new Uint8Array(this.n);   // contrast left from earlier injections
    this.tex = new THREE.Data3DTexture(this.data, BOX[0], BOX[1], BOX[2]);
    this.tex.format = THREE.RedFormat;
    this.tex.type = THREE.UnsignedByteType;
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    this.tex.unpackAlignment = 1;
    this.tex.needsUpdate = true;
    this.origin = [0, 0, 0];              // CT voxel index of the grid corner
    this.dims = BOX;
    this.hidden = false;
    this.any = false;                     // anything to draw?
    this.anim = null;                     // running injection
    this.last = null;                     // {pattern, ...} of the last injection
    this.roll = null;                     // random vascular result for this tip position
    this.roots = [];                      // root polylines, voxel coordinates
    for (const lv of Object.keys(this.anat.roots)) {
      for (const s of Object.keys(this.anat.roots[lv])) {
        this.roots.push({ name: `${lv} ${s === 'L' ? 'left' : 'right'}`, pts: this.anat.roots[lv][s].map((p) => p.map((v, i) => v / this.sp[i])) });
      }
    }
    this.s1z = (this.anat.pedicles.S1.L.c[2] + this.anat.pedicles.S1.R.c[2]) / 2 / this.sp[2];
    this.v = new THREE.Vector3();
  }

  // CT voxel coordinates (float) of a world point
  vox(pw) {
    const p = this.v.copy(pw).applyMatrix4(this.t.worldToVol);
    return [p.x / this.sp[0], p.y / this.sp[1], p.z / this.sp[2]];
  }

  lab(x, y, z) {
    const t = this.t;
    if (x < 0 || y < 0 || z < 0 || x >= t.nx || y >= t.ny || z >= t.nz) return 0;
    return t.labels[x + y * t.nx + z * t.nx * t.ny];
  }

  // Which pattern would an injection at this tip give? (before the random vascular roll)
  classify(tipWorld) {
    const [fx, fy, fz] = this.vox(tipWorld);
    const x = Math.round(fx), y = Math.round(fy), z = Math.round(fz);
    const L = this.lab(x, y, z);
    if (L === DISC) return 'intradiscal';
    if (L === SAC) return this.onSacEdge(x, y, z) ? 'subdural' : 'intrathecal';
    if (L === 4 || L === 5) return 'vascular';
    if (L === EPI || L === FOR || L === ROOT) return 'epidural';
    // within 1.5 mm of the epidural space / foramen: contrast still finds its way in
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const l = this.lab(x + dx, y + dy, z + dz);
      if (l === EPI || l === FOR) return 'epidural';
    }
    return 'softtissue';
  }

  onSacEdge(x, y, z) {
    return this.lab(x + 1, y, z) !== SAC || this.lab(x - 1, y, z) !== SAC || this.lab(x, y + 1, z) !== SAC
      || this.lab(x, y - 1, z) !== SAC || this.lab(x, y, z + 1) !== SAC || this.lab(x, y, z - 1) !== SAC;
  }

  // The pattern actually produced, including the random vascular uptake
  // (about 20 % at lumbar levels, 40 % at S1). Same tip position = same answer.
  decide(tipWorld) {
    const kind = this.classify(tipWorld);
    if (kind !== 'epidural') return { kind, randomVascular: false };
    const v = this.vox(tipWorld);
    if (!this.roll || Math.hypot(v[0] - this.roll.v[0], v[1] - this.roll.v[1], v[2] - this.roll.v[2]) > 1.0) {
      const chance = v[2] < this.s1z ? 0.4 : 0.2;
      this.roll = { v, vascular: Math.random() < chance, chance };
    }
    return this.roll.vascular ? { kind: 'vascular', randomVascular: true } : { kind, randomVascular: false };
  }

  // ---------- grid ----------
  placeGrid(c) {
    const o = this.origin, B = this.dims, m = 14;
    const inside = c.every((v, i) => v - o[i] >= m && v - o[i] < B[i] - m);
    if (inside && this.any) return;
    const lim = [this.t.nx, this.t.ny, this.t.nz];
    this.origin = c.map((v, i) => Math.max(0, Math.min(lim[i] - B[i], Math.round(v - B[i] / 2))));
    this.base.fill(0);
    if (this.any) this.data.fill(0);
  }

  gi(x, y, z) { // grid index from CT voxel, or -1
    const gx = x - this.origin[0], gy = y - this.origin[1], gz = z - this.origin[2], B = this.dims;
    if (gx < 0 || gy < 0 || gz < 0 || gx >= B[0] || gy >= B[1] || gz >= B[2]) return -1;
    return gx + gy * B[0] + gz * B[0] * B[1];
  }

  labAt(g) { // label at a grid index
    const B = this.dims, gx = g % B[0], gy = Math.floor(g / B[0]) % B[1], gz = Math.floor(g / (B[0] * B[1]));
    return this.lab(gx + this.origin[0], gy + this.origin[1], gz + this.origin[2]);
  }

  // ---------- spreading ----------
  // Dijkstra from the start voxel through the allowed space; returns voxels in order of arrival.
  spread(start, allowed, cost, maxCount) {
    const B = this.dims, sx = 1, sy = B[0], sz = B[0] * B[1];
    const dist = new Float32Array(this.n).fill(Infinity);
    const order = [];
    const h = new Heap();
    dist[start] = 0; h.push(0, start);
    const steps = []; // 18-connected: faces (cost x1) and edges (x1.41)
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const k = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
      if (k === 1 || k === 2) steps.push([dx, dy, dz, dx * sx + dy * sy + dz * sz, k === 1 ? 1 : 1.414]);
    }
    while (h.size && order.length < maxCount) {
      const c = h.c[0], g = h.pop();
      if (c > dist[g]) continue;
      order.push(g);
      const gx = g % B[0], gy = Math.floor(g / B[0]) % B[1], gz = Math.floor(g / sz);
      for (const [dx, dy, dz, di, w] of steps) {
        const nx = gx + dx, ny = gy + dy, nz = gz + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= B[0] || ny >= B[1] || nz >= B[2]) continue;
        const ng = g + di;
        if (!allowed(ng)) continue;
        const nc = c + w * cost(ng, dx, dy, dz);
        if (nc < dist[ng]) { dist[ng] = nc; h.push(nc, ng); }
      }
    }
    return order;
  }

  nearestAllowed(c, allowed) {
    for (let r = 0; r <= 3; r++) {
      let best = -1, bd = 1e9;
      for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const g = this.gi(c[0] + dx, c[1] + dy, c[2] + dz);
        if (g >= 0 && allowed(g)) { const d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = g; } }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  // voxels near a root (for the perineural tram-track along the root)
  nearRootMask(lab) {
    const B = this.dims, near = new Uint8Array(this.n);
    for (let g = 0; g < this.n; g++) {
      if (lab[g] !== ROOT) continue;
      const gx = g % B[0], gy = Math.floor(g / B[0]) % B[1], gz = Math.floor(g / (B[0] * B[1]));
      for (let dz = -2; dz <= 2; dz++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = gx + dx, y = gy + dy, z = gz + dz;
        if (x >= 0 && y >= 0 && z >= 0 && x < B[0] && y < B[1] && z < B[2]) near[x + y * B[0] + z * B[0] * B[1]] = 1;
      }
    }
    return near;
  }

  plan(kind, c) {
    const lab = new Uint8Array(this.n), B = this.dims, T = this.t, o = this.origin;
    for (let gz = 0, g = 0; gz < B[2]; gz++) for (let gy = 0; gy < B[1]; gy++) {
      const row = o[0] + (o[1] + gy) * T.nx + (o[2] + gz) * T.nx * T.ny;
      for (let gx = 0; gx < B[0]; gx++, g++) lab[g] = T.labels[row + gx];
    }
    const jit = new Float32Array(this.n);
    for (let g = 0; g < this.n; g++) jit[g] = 0.75 + Math.random() * 0.5;
    const ml = VOL_ML * 1000;
    let allowed, cost, dens, count, extra = 1, skip = null;
    if (kind === 'epidural') {
      const near = this.nearRootMask(lab);
      allowed = (g) => lab[g] === EPI || lab[g] === FOR || lab[g] === ROOT;
      cost = (g, dx, dy, dz) => {
        if (lab[g] === ROOT) return 2.5;                               // squeezes round the root
        if (lab[g] === EPI) return (dz ? 0.4 : 1.2) * jit[g];         // runs up and down the canal
        return (near[g] ? 0.3 : 1.8) * jit[g];                         // tracks along the root sleeve
      };
      skip = (g) => lab[g] === ROOT;                                   // the root itself stays clear
      dens = 0.42; count = ml / (VOX_UL * dens);
    } else if (kind === 'intrathecal') {
      allowed = (g) => lab[g] === SAC;
      cost = (g, dx, dy, dz) => (dy > 0 ? 0.45 : dy < 0 ? 1.6 : dz ? 0.7 : 1.0) * jit[g]; // +y = anterior = down when prone
      dens = 0.4; count = ml / (VOX_UL * dens); extra = 2.5;            // mixes with CSF, keeps spreading
    } else if (kind === 'subdural') {
      const ax = this.anat.sac_axis, side = Math.sign(c[0] - ax.x_mm[Math.round(c[2] * this.sp[2] / 6)] / this.sp[0]) || 1;
      allowed = (g) => {
        if (lab[g] !== SAC) return false;
        const gx = g % B[0] + o[0], gy = Math.floor(g / B[0]) % B[1] + o[1], gz = Math.floor(g / (B[0] * B[1])) + o[2];
        const zi = Math.min(ax.x_mm.length - 1, Math.round(gz * this.sp[2] / 6));
        if ((gx - ax.x_mm[zi] / this.sp[0]) * side < -1) return false;   // stays on the injected side
        return this.onSacEdge(gx, gy, gz);
      };
      cost = (g, dx, dy, dz) => (dz ? 0.35 : 3.0) * jit[g];            // stays on one side, runs up and down
      dens = 0.9; count = ml / (VOX_UL * dens) * 1.3; extra = 1.25;
    } else if (kind === 'intradiscal') {
      allowed = (g) => lab[g] === DISC;
      cost = (g) => {
        const e = lab[g + 1] !== DISC || lab[g - 1] !== DISC || lab[g + B[0]] !== DISC || lab[g - B[0]] !== DISC
          || lab[g + B[0] * B[1]] !== DISC || lab[g - B[0] * B[1]] !== DISC;
        return (e ? 3.0 : 0.8) * jit[g];                               // pools in the centre (nucleus)
      };
      dens = 0.6; count = ml / (VOX_UL * dens);
    } else { // soft tissue
      // smooth random field: contrast runs in low-resistance streaks along the muscle fibres
      const ph = Array.from({ length: 9 }, () => Math.random() * 6.283);
      const field = (g) => {
        const x = g % B[0], y = Math.floor(g / B[0]) % B[1], z = Math.floor(g / (B[0] * B[1]));
        return (Math.sin(x * 0.9 + ph[0]) * Math.sin(y * 0.8 + ph[1]) + Math.sin(x * 0.45 + y * 0.5 + ph[2])
          + 0.6 * Math.sin(z * 0.25 + x * 0.6 + ph[3]) + 0.5 * Math.sin(y * 1.3 + z * 0.2 + ph[4])) / 3.1;
      };
      allowed = (g) => lab[g] === 1 || lab[g] === 7;
      cost = (g, dx, dy, dz) => (dz ? 0.45 : 1.0) * Math.exp(2.2 * field(g)) * jit[g];
      dens = 0.36; count = ml / (VOX_UL * dens);
    }
    const start = this.nearestAllowed(c, allowed);
    if (start < 0) return null;
    let order = this.spread(start, allowed, cost, Math.ceil(count * extra * (skip ? 1.5 : 1)));
    if (skip) order = order.filter((g) => !skip(g)).slice(0, Math.ceil(count * extra));
    return { kind, order, dens, count: Math.min(count, order.length / extra), extra, bbox: this.bbox(order), dur: INJ_SEC * (kind === 'intrathecal' ? 2.0 : kind === 'subdural' ? 1.5 : 1.15) };
  }

  // radicular artery (to the anterior spinal artery, with its hairpin) or epidural veins
  vesselPath(c) {
    let best = null, bd = 1e9;
    for (const r of this.roots) {
      r.pts.forEach((p, i) => { const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]); if (d < bd) { bd = d; best = { r, i }; } });
    }
    const path = [c.slice()];
    for (let i = best.i; i >= 0; i--) path.push(best.r.pts[i].slice()); // along the root into the canal
    const e = path[path.length - 1];
    const z = Math.round(e[2]);
    const ax = this.anat.sac_axis;
    const zi = Math.min(ax.z_mm.length - 1, Math.max(0, Math.round(z * this.sp[2] / 6)));
    const xc = ax.x_mm[zi] / this.sp[0], yc = ax.y_mm[zi] / this.sp[1], a = ax.half_width_mm[zi] / this.sp[0];
    const branches = [];
    if (Math.random() < 0.6) { // artery: up to the front of the sac, hairpin, then down the midline
      path.push([xc, yc + 6, z + 8]);
      branches.push([[xc, yc + 6, z + 8], [xc, yc + 6.5, z - 30]]);
    } else { // veins: anterior epidural plexus, a "ladder" on both sides
      const sd = Math.sign(e[0] - xc) || 1;
      path.push([xc + sd * a * 0.8, yc + 6, z]);
      branches.push([[xc + sd * a * 0.8, yc + 6, z + 18], [xc + sd * a * 0.8, yc + 6, z - 18]]);
      branches.push([[xc + sd * a * 0.8, yc + 6.5, z - 2], [xc - sd * a * 0.8, yc + 6.5, z - 2]]);
      branches.push([[xc - sd * a * 0.8, yc + 6, z + 14], [xc - sd * a * 0.8, yc + 6, z - 16]]);
    }
    return [path, ...branches];
  }

  rasterVessels(lines) {
    // returns [{g, t}] : grid voxel and arrival distance (voxels) along the vessel
    const hit = new Map();
    let start = 0;
    lines.forEach((pts, li) => {
      let s = li === 0 ? 0 : start;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        for (let u = 0; u <= L; u += 0.4) {
          const p = a.map((v, k) => v + (b[k] - v) * (L ? u / L : 0));
          for (const [dx, dy, dz] of [[0, 0, 0], [0, 1, 0]]) { // ~1.5-2 mm vessel
            const g = this.gi(Math.round(p[0]) + dx, Math.round(p[1]) + dy, Math.round(p[2]) + dz);
            if (g >= 0 && !hit.has(g)) hit.set(g, s + u);
          }
        }
        s += L;
      }
      if (li === 0) start = s;
    });
    return [...hit.entries()].map(([g, t]) => ({ g, t }));
  }

  bbox(list) { // grid-voxel box around a list of grid indices, padded by 2
    const B = this.dims, lo = [1e9, 1e9, 1e9], hi = [-1, -1, -1];
    for (const g of list) {
      const p = [g % B[0], Math.floor(g / B[0]) % B[1], Math.floor(g / (B[0] * B[1]))];
      for (let i = 0; i < 3; i++) { if (p[i] < lo[i]) lo[i] = p[i]; if (p[i] > hi[i]) hi[i] = p[i]; }
    }
    for (let i = 0; i < 3; i++) { lo[i] = Math.max(0, lo[i] - 2); hi[i] = Math.min(B[i] - 1, hi[i] + 2); }
    return { lo, size: [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1] };
  }

  // write a sparse list of {g, val 0..1} into the grid, smoothed with a small 3D blur
  // (contrast is a fluid: no blocky voxels), on top of the earlier contrast
  paint(list, box) {
    const d = this.data, B = this.dims, [sx, sy, sz] = box.size, [ox, oy, oz] = box.lo;
    const n = sx * sy * sz;
    let a = this.tmpA, b = this.tmpB;
    if (!a || a.length < n) { a = this.tmpA = new Float32Array(n); b = this.tmpB = new Float32Array(n); }
    a.fill(0, 0, n);
    for (const [g, v] of list) {
      const x = g % B[0] - ox, y = Math.floor(g / B[0]) % B[1] - oy, z = Math.floor(g / (B[0] * B[1])) - oz;
      const i = x + y * sx + z * sx * sy;
      if (v > a[i]) a[i] = v;
    }
    for (const [st, len] of [[1, sx], [sx, sy], [sx * sy, sz]]) { // [1 2 1]/4 along each axis
      for (let i = 0; i < n; i++) {
        const c = Math.floor(i / st) % len;
        const l = c > 0 ? a[i - st] : a[i], r = c < len - 1 ? a[i + st] : a[i];
        b[i] = 0.25 * l + 0.5 * a[i] + 0.25 * r;
      }
      [a, b] = [b, a];
    }
    for (let z = 0, i = 0; z < sz; z++) for (let y = 0; y < sy; y++) {
      const row = ox + (oy + y) * B[0] + (oz + z) * B[0] * B[1];
      for (let x = 0; x < sx; x++, i++) {
        const v = Math.round(255 * Math.min(1, a[i] * 1.35));
        if (v > d[row + x]) d[row + x] = v;
      }
    }
  }

  // ---------- injection ----------
  inject(tipWorld) {
    if (this.anim) return null;
    const c = this.vox(tipWorld).map(Math.round);
    const { kind, randomVascular } = this.decide(tipWorld);
    this.placeGrid(c);
    if (kind === 'vascular') {
      const vox = this.rasterVessels(this.vesselPath(c));
      this.anim = { kind, vox, bbox: this.bbox(vox.map((q) => q.g)), t: 0, dur: INJ_SEC, randomVascular };
    } else {
      const p = this.plan(kind, c);
      if (!p) return null;
      this.anim = { ...p, t: 0, randomVascular };
    }
    this.hidden = false;
    this.last = { kind, randomVascular, done: false };
    return this.last;
  }

  // advance the animation; returns true while the picture is changing
  update(dt) {
    const A = this.anim;
    if (!A) return false;
    A.t += dt;
    const d = this.data;
    d.set(this.base);
    const list = [];
    if (A.kind === 'vascular') {
      // two pushes of contrast; each streaks along the vessel and washes out in < 1 s
      const best = new Map();
      for (const [t0, amp] of [[0, 1], [1.4, 0.65]]) {
        const tp = A.t - t0;
        if (tp < 0) continue;
        const env = amp * (tp < 0.3 ? 1 : Math.max(0, 1 - (tp - 0.3) / 0.5));
        if (env <= 0) continue;
        const front = tp * 260; // voxels per second (~400 mm/s)
        for (const { g, t } of A.vox) if (t <= front && env > (best.get(g) || 0)) best.set(g, env);
      }
      for (const [g, v] of best) list.push([g, Math.min(1, v * 1.8)]); // thin vessel: strong before the blur
    } else {
      const inj = Math.min(1, A.t / INJ_SEC);
      const post = Math.max(0, Math.min(1, (A.t - INJ_SEC) / Math.max(0.01, A.dur - INJ_SEC)));
      const n = Math.min(A.order.length, A.count * (inj + (A.extra - 1) * post));
      const soft = Math.max(8, n * 0.15);
      // diluted agents (intrathecal) get fainter as they spread
      const dens = A.dens * (A.kind === 'intrathecal' ? 1 / (1 + 0.6 * post) : 1);
      for (let k = 0; k < n; k++) list.push([A.order[k], dens * Math.min(1, (n - k) / soft)]);
    }
    if (list.length) this.paint(list, A.bbox);
    this.any = true;
    this.tex.needsUpdate = true;
    if (A.t >= A.dur + 0.4) {
      if (A.kind !== 'vascular') this.base.set(d); // contrast stays (except in vessels)
      else d.set(this.base);
      this.tex.needsUpdate = true;
      this.anim = null;
      this.last.done = true;
      return false;
    }
    return true;
  }

  injectedML() {
    return this.anim ? Math.min(VOL_ML, (this.anim.t / INJ_SEC) * VOL_ML) : 0;
  }

  clear() {
    this.anim = null; this.base.fill(0); this.data.fill(0); this.any = false; this.last = null;
    this.tex.needsUpdate = true;
  }

  // for the renderer: grid position in CT voxels
  uniforms() {
    return { on: this.any && !this.hidden, origin: this.origin, dims: this.dims };
  }
}
