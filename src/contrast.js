// Contrast injection: decide the pattern from the needle-tip position, then spread
// contrast through the matching space over time (epidural/perineural, vascular,
// intrathecal, subdural, intradiscal, soft tissue). The result is a small 3D density
// grid that the C-arm renderer adds to the CT.
import * as THREE from 'three';

const DISC = 10, EPI = 11, ROOT = 12, FOR = 13, SAC = 3, BONE = 2, CANAL = 14, LIG = 15;
const BOWEL = 6, JOINT = 16, PRESAC = 17, HARD = 18;   // ganglion impar region

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
  caudal: { name: 'Sacral epidural (caudal)', ok: true,
    text: 'Contrast fills the sacral canal, climbs toward L5-S1 and runs out along the sacral roots through the foramina. Correct pattern.' },
  subcutaneous: { name: 'Subcutaneous / dorsal to the sacrum', ok: false,
    text: 'Contrast pools behind the sacrum, under the skin and the sacrococcygeal ligament, and does not enter the canal. The needle is not through the hiatus.' },
  intraosseous: { name: 'Intraosseous', ok: false,
    text: 'A dense blush in the bone marrow. The tip was pressed into the bone: withdraw 1-2 mm off the bone before injecting.' },
  impar: { name: 'Ganglion impar (retrorectal space)', ok: true,
    text: 'Contrast collects just in front of the sacrococcygeal junction and spreads up along the front of the sacrum and coccyx: a "reverse comma" (apostrophe) on lateral, a small midline blot on AP. Correct pattern.' },
  joint: { name: 'In the joint', ok: false,
    text: 'Contrast stays in a thin line inside the joint (fibrocartilage). The tip has not passed through: advance 1-2 mm and check on lateral.' },
  rectal: { name: 'RECTUM: needle through the rectal wall', ok: false,
    text: 'Contrast outlines the rectal lumen and its folds. Withdraw now. The needle is contaminated: use a new needle before trying again (risk of presacral infection).' },
  imparsoft: { name: 'Soft tissue around the coccyx', ok: false,
    text: 'Contrast spreads in fat or muscle behind or beside the coccyx, not in front of it. The tip is not in the retrorectal space.' },
};

const VOL_ML = 1.0;          // default contrast volume per injection (transforaminal)
const INJ_SEC = 3.0;         // default injection time
const ML_PER_SEC = 0.5;      // larger volumes (caudal) are pushed at this rate
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
    // sacrum: below the S1 foramina + 10 mm is "sacral" (caudal block rules apply)
    const S = this.anat.sacral;
    this.sacTopZ = S ? (S.level_z.S1 + 10) / this.sp[2] : -1;
    this.sacVeins = S ? S.veins.map((l) => l.map((p) => p.map((v, i) => v / this.sp[i]))) : [];
    // ganglion impar region: rectum counts below S2; median sacral vessels for vascular uptake
    const I = this.anat.impar;
    this.pelvisTopZ = S ? S.level_z.S2 / this.sp[2] : -1;
    this.imparZ = I ? I.scj.c[2] / this.sp[2] : -1;
    this.imparVessels = I ? Object.values(I.vessels).map((l) => l.map((p) => p.map((v, i) => v / this.sp[i]))) : [];
    this.proc = 'tfesi';                  // set by the app: 'tfesi' | 'caudal' | 'impar'
    this.ml = VOL_ML; this.injSec = INJ_SEC;
    this.v = new THREE.Vector3();
  }

  inSacrum(z) { return z < this.sacTopZ; }

  // mm of the needle track lying in the sacral canal (how far it was advanced up the canal)
  canalMM(needle) {
    if (!needle || !needle.path) return 0;
    let n = 0;
    for (let i = 0; i < needle.path.length; i += 2) {
      const [x, y, z] = this.vox(needle.path[i]).map(Math.round);
      if (this.lab(x, y, z) === CANAL) n++;
    }
    return n * 0.5;
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
  classify(tipWorld, opts = {}) {
    const [fx, fy, fz] = this.vox(tipWorld);
    const x = Math.round(fx), y = Math.round(fy), z = Math.round(fz);
    const L = this.lab(x, y, z);
    if (this.inSacrum(z)) {           // caudal region
      if (L === SAC) return this.onSacEdge(x, y, z) ? 'subdural' : 'intrathecal';
      if (L === BOWEL && z < this.pelvisTopZ) return 'rectal';
      if (opts.boneContact) return 'intraosseous';
      if (L === JOINT) return 'joint';
      if (L === PRESAC) return 'impar';
      if (L === CANAL || L === FOR || L === ROOT || L === EPI) return 'caudal';
      let presac = false;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const l = this.lab(x + dx, y + dy, z + dz);
        if (l === CANAL) return 'caudal';
        if (l === PRESAC) presac = true;
      }
      if (L === 4 || L === 5) return 'vascular';
      if (presac) return 'impar';      // within 1.5 mm of the retrorectal space
      return this.proc === 'impar' || z < this.imparZ ? 'imparsoft' : 'subcutaneous';
    }
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
  decide(tipWorld, opts = {}) {
    const kind = this.classify(tipWorld, opts);
    if (kind !== 'epidural' && kind !== 'caudal' && kind !== 'impar') return { kind, randomVascular: false };
    const v = this.vox(tipWorld);
    if (!this.roll || Math.hypot(v[0] - this.roll.v[0], v[1] - this.roll.v[1], v[2] - this.roll.v[2]) > 1.0) {
      // transforaminal: 20 % lumbar, 40 % S1 (user setting). Caudal: rises with how far the needle was
      // advanced up the canal: ~3 % just past the ligament, ~20 % at 1 cm (Park 2018, Doo 2015)
      // Ganglion impar: 1.3 % reported (Foye 2020); the trainer uses 5 %.
      const chance = kind === 'caudal'
        ? 0.03 + 0.17 * Math.max(0, Math.min(1, (this.canalMM(opts.needle) - 2) / 8))
        : kind === 'impar' ? 0.05
        : v[2] < this.s1z ? 0.4 : 0.2;
      this.roll = { v, vascular: Math.random() < chance, chance };
    }
    return this.roll.vascular ? { kind: 'vascular', randomVascular: true } : { kind, randomVascular: false };
  }

  // ---------- grid ----------
  placeGrid(c, up = 0.5) { // up: share of the grid above the tip (caudal contrast climbs)
    const o = this.origin, B = this.dims, m = 14;
    const inside = c.every((v, i) => v - o[i] >= m && v - o[i] < B[i] - m);
    if (inside && this.any && Math.abs(up - (this.lastUp || 0.5)) < 0.01) return;
    this.lastUp = up;
    const lim = [this.t.nx, this.t.ny, this.t.nz];
    this.origin = c.map((v, i) => Math.max(0, Math.min(lim[i] - B[i], Math.round(v - B[i] * (i === 2 ? 1 - up : 0.5)))));
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
    const dist = new Float64Array(this.n).fill(Infinity);   // 64-bit: the heap keeps 64-bit costs (32-bit rounding skipped voxels)
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
    for (let r = 0; r <= 5; r++) {
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
    const ml = this.ml * 1000;
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
      dens = 0.3; count = ml / (VOX_UL * dens); extra = 2.5;            // mixes with CSF, keeps spreading
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
      dens = 0.55; count = ml / (VOX_UL * 0.9); extra = 1.25;           // thin layer
    } else if (kind === 'intradiscal') {
      allowed = (g) => lab[g] === DISC;
      cost = (g) => {
        const e = lab[g + 1] !== DISC || lab[g - 1] !== DISC || lab[g + B[0]] !== DISC || lab[g - B[0]] !== DISC
          || lab[g + B[0] * B[1]] !== DISC || lab[g - B[0] * B[1]] !== DISC;
        return (e ? 3.0 : 0.8) * jit[g];                               // pools in the centre (nucleus)
      };
      dens = 0.6; count = ml / (VOX_UL * dens);
    } else if (kind === 'caudal') {
      // sacral canal: climbs toward L5-S1, runs out along the sacral roots through the foramina
      const near = this.nearRootMask(lab);
      allowed = (g) => lab[g] === CANAL || lab[g] === FOR || lab[g] === ROOT || lab[g] === EPI;
      cost = (g, dx, dy, dz) => {
        if (lab[g] === ROOT) return 2.5;
        if (lab[g] === CANAL || lab[g] === EPI) return (dz > 0 ? 0.45 : dz < 0 ? 0.8 : 1.2) * jit[g];
        return (near[g] ? 0.5 : 1.8) * jit[g];
      };
      skip = (g) => lab[g] === ROOT;
      dens = 0.5; count = ml / (VOX_UL * dens);
    } else if (kind === 'impar') {
      // retrorectal space: a bulb at the tip that hugs the front of the bone and runs up it
      // ("reverse comma" on lateral); the rectum side is held back by the fascia
      const nearBone = new Uint8Array(this.n);
      for (let g = 0; g < this.n; g++) {
        if (lab[g] !== PRESAC) continue;
        const gx = g % B[0], gy = Math.floor(g / B[0]) % B[1], gz = Math.floor(g / (B[0] * B[1]));
        for (let dy = -3; dy <= 0 && !nearBone[g]; dy++) for (let dz = -1; dz <= 1; dz++) {
          const y = gy + dy, z = gz + dz;
          if (y < 0 || z < 0 || z >= B[2]) continue;
          const l = lab[gx + y * B[0] + z * B[0] * B[1]];
          if (l === BONE || l === HARD || l === JOINT) { nearBone[g] = 1; break; }
        }
      }
      allowed = (g) => lab[g] === PRESAC;
      cost = (g, dx, dy, dz) => (nearBone[g] ? 0.5 : 1.7)
        * (dz > 0 ? 0.5 : dz < 0 ? 1.3 : 1) * (dy > 0 ? 1.6 : 1) * (dx ? 1.6 : 1) * jit[g];
      dens = 0.42; count = ml / (VOX_UL * dens);
    } else if (kind === 'joint') {
      // fills the thin joint and stops
      allowed = (g) => lab[g] === JOINT;
      cost = (g) => jit[g];
      dens = 0.6; count = ml / (VOX_UL * dens);
    } else if (kind === 'rectal') {
      // rectal lumen: coats the wall (outlines the rectum and its folds), mottled where it mixes with
      // the bowel content, and runs along the bowel
      const wall = new Uint8Array(this.n);
      for (let g = 0; g < this.n; g++) {
        if (lab[g] !== BOWEL) continue;
        const gx = g % B[0], gy = Math.floor(g / B[0]) % B[1], gz = Math.floor(g / (B[0] * B[1]));
        for (const [dx, dy, dz] of [[2, 0, 0], [-2, 0, 0], [0, 2, 0], [0, -2, 0], [0, 0, 2], [0, 0, -2]]) {
          const x = gx + dx, y = gy + dy, z = gz + dz;
          if (x < 0 || y < 0 || z < 0 || x >= B[0] || y >= B[1] || z >= B[2] || lab[x + y * B[0] + z * B[0] * B[1]] !== BOWEL) { wall[g] = 1; break; }
        }
      }
      const ph = Array.from({ length: 3 }, () => Math.random() * 6.283);
      const mott = (g) => { const x = g % B[0], y = Math.floor(g / B[0]) % B[1], z = Math.floor(g / (B[0] * B[1]));
        return Math.sin(x * 1.3 + ph[0]) + Math.sin(y * 1.1 + ph[1]) + Math.sin(z * 0.9 + ph[2]); };
      allowed = (g) => lab[g] === BOWEL && (wall[g] || mott(g) > 0.6);
      cost = (g, dx, dy, dz) => (wall[g] ? 0.45 : 1.6) * (dz ? 0.8 : 1) * jit[g];
      dens = 0.28; count = ml / (VOX_UL * dens); extra = 1.3;
    } else if (kind === 'intraosseous') {
      // marrow blush in the bone around the tip
      allowed = (g) => lab[g] === BONE || lab[g] === HARD;
      cost = (g) => (0.3 + Math.random() * 1.6);
      dens = 0.32; count = Math.min(ml, 1000) / (VOX_UL * dens);
    } else { // soft tissue (subcutaneous: also the ligament)
      // smooth random field, nearly constant head-to-foot: contrast runs in streaks along the
      // muscle fibres and fascial planes, not as a round blob
      const ph = Array.from({ length: 6 }, () => Math.random() * 6.283);
      const field = (g) => {
        const x = g % B[0], y = Math.floor(g / B[0]) % B[1], z = Math.floor(g / (B[0] * B[1]));
        return 0.55 * Math.sin(x * 1.15 + ph[0]) * Math.cos(y * 0.95 + ph[1])
          + 0.35 * Math.sin(x * 0.55 + y * 0.6 + ph[2]) + 0.2 * Math.sin(z * 0.12 + ph[3]);
      };
      if (kind === 'subcutaneous' || kind === 'imparsoft') {
        // over the sacrum: a thin, cloudy sheet under the skin that spreads sideways as much as
        // up and down, with no canal outline and no foramina
        const blot = (g) => { const x = g % B[0], z = Math.floor(g / (B[0] * B[1]));
          return 0.6 * Math.sin(x * 0.45 + ph[4]) * Math.cos(z * 0.4 + ph[5]) + 0.4 * Math.sin(x * 0.3 + z * 0.35 + ph[2]); };
        allowed = (g) => (lab[g] === 1 || lab[g] === 7 || lab[g] === LIG) && blot(g) < 0.45;
        cost = (g, dx, dy, dz) => (dy ? 1.6 : 0.8) * (1.3 + blot(g)) * jit[g];
        dens = 0.28; count = ml / (VOX_UL * dens);
      } else {
        allowed = (g) => (lab[g] === 1 || lab[g] === 7 || lab[g] === LIG) && field(g) < -0.05;
        cost = (g, dx, dy, dz) => (dz ? 0.35 : 1.0) * (1.2 + field(g)) * jit[g];
        dens = 0.32; count = ml / (VOX_UL * dens);
      }
    }
    const start = this.nearestAllowed(c, allowed);
    if (start < 0) return null;
    let order = this.spread(start, allowed, cost, Math.ceil(count * extra * (skip ? 1.5 : 1)));
    if (skip) order = order.filter((g) => !skip(g)).slice(0, Math.ceil(count * extra));
    const inj = this.injSec;
    return { kind, order, dens, count: Math.min(count, order.length / extra), extra, bbox: this.bbox(order), inj, ml: this.ml, dur: inj * (kind === 'intrathecal' ? 2.0 : kind === 'subdural' ? 1.5 : 1.15) };
  }

  // caudal: sacral epidural veins: from the tip into the nearest vein, along it, and out with a root vein
  sacralVeinPath(c) {
    let best = null, bd = 1e9;
    this.sacVeins.forEach((l, li) => l.forEach((p, i) => {
      const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
      if (d < bd) { bd = d; best = { li, i }; }
    }));
    const line = this.sacVeins[best.li];
    const up = [c.slice(), ...line.slice(best.i)];          // toward the head
    const lines = [up, line.slice(0, best.i + 1).reverse()];
    // root veins at the foramina near the tip
    this.sacVeins.forEach((l) => {
      if (l.length <= 3 && Math.abs(l[0][2] - c[2]) < 25) lines.push(l);
    });
    return lines;
  }

  // ganglion impar: from the tip into the nearest median sacral vessel, then up along it
  imparVesselPath(c) {
    let best = null, bd = 1e9;
    this.imparVessels.forEach((l, li) => l.forEach((p, i) => {
      const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
      if (d < bd) { bd = d; best = { li, i }; }
    }));
    if (!best) return [[c.slice(), [c[0], c[1], c[2] + 20]]];
    const line = this.imparVessels[best.li];
    const path = [c.slice(), ...line.slice(0, best.i + 1).reverse()];   // points run head -> feet
    // a small presacral venous network round the tip
    const side = [[c[0] - 6, c[1] + 1, c[2] + 4], [c[0], c[1], c[2]], [c[0] + 6, c[1] + 1, c[2] + 3]];
    return [path, side];
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
  // opts: {ml, needle}. ml: contrast volume (default 1 mL); needle: for bone contact and canal depth
  inject(tipWorld, opts = {}) {
    if (this.anim) return null;
    const c = this.vox(tipWorld).map(Math.round);
    const { kind, randomVascular } = this.decide(tipWorld, { needle: opts.needle, boneContact: opts.needle && opts.needle.boneContact });
    this.ml = opts.ml || VOL_ML;
    this.injSec = Math.max(INJ_SEC, this.ml / ML_PER_SEC);
    const sacral = this.inSacrum(c[2]);
    const imparRegion = this.imparVessels.length && c[2] < this.imparZ + 25;
    this.placeGrid(c, kind === 'impar' || (imparRegion && kind === 'vascular') ? 0.68
      : sacral && (kind === 'caudal' || kind === 'vascular') ? 0.78 : 0.5);   // caudal and impar contrast climbs
    if (kind === 'vascular') {
      const vox = this.rasterVessels(imparRegion ? this.imparVesselPath(c)
        : sacral && this.sacVeins.length ? this.sacralVeinPath(c) : this.vesselPath(c));
      this.anim = { kind, vox, bbox: this.bbox(vox.map((q) => q.g)), t: 0, dur: this.injSec, inj: this.injSec, ml: this.ml, randomVascular };
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
      const pushes = [];
      for (let t0 = 0, amp = 1; t0 < A.inj - 0.5; t0 += 1.4, amp *= 0.75) pushes.push([t0, amp]);
      for (const [t0, amp] of pushes) {
        const tp = A.t - t0;
        if (tp < 0) continue;
        const env = amp * (tp < 0.3 ? 1 : Math.max(0, 1 - (tp - 0.3) / 0.5));
        if (env <= 0) continue;
        const front = tp * 260; // voxels per second (~400 mm/s)
        for (const { g, t } of A.vox) if (t <= front && env > (best.get(g) || 0)) best.set(g, env);
      }
      for (const [g, v] of best) list.push([g, Math.min(1, v * 1.8)]); // thin vessel: strong before the blur
    } else {
      const inj = Math.min(1, A.t / A.inj);
      const post = Math.max(0, Math.min(1, (A.t - A.inj) / Math.max(0.01, A.dur - A.inj)));
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
    return this.anim ? Math.min(this.anim.ml, (this.anim.t / this.anim.inj) * this.anim.ml) : 0;
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
