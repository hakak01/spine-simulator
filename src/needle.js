// Needle: tissue lookup from the CT, insertion mechanics, 3D model.
// Positions are world metres; depth and length are mm.
import * as THREE from 'three';

// CT + label volume sampled on the CPU.
export class Tissue {
  constructor(ct, labels, meta, worldToVol) {
    this.ct = ct; this.labels = labels;
    [this.nx, this.ny, this.nz] = meta.dims;
    [this.sx, this.sy, this.sz] = meta.spacing;
    this.worldToVol = worldToVol;
    this.v = new THREE.Vector3();
  }

  // trilinear HU at a world point (air outside the scan)
  hu(pw) {
    const p = this.v.copy(pw).applyMatrix4(this.worldToVol);
    const x = p.x / this.sx, y = p.y / this.sy, z = p.z / this.sz;
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    if (x0 < 0 || y0 < 0 || z0 < 0 || x0 >= this.nx - 1 || y0 >= this.ny - 1 || z0 >= this.nz - 1) return -1000;
    const fx = x - x0, fy = y - y0, fz = z - z0, nx = this.nx, nxy = this.nx * this.ny, c = this.ct;
    const i = x0 + y0 * nx + z0 * nxy;
    const a = c[i] * (1 - fx) + c[i + 1] * fx, b = c[i + nx] * (1 - fx) + c[i + nx + 1] * fx;
    const e = c[i + nxy] * (1 - fx) + c[i + nxy + 1] * fx, f = c[i + nxy + nx] * (1 - fx) + c[i + nxy + nx + 1] * fx;
    const v = (a * (1 - fy) + b * fy) * (1 - fz) + (e * (1 - fy) + f * fy) * fz;
    return v * 10 - 1000;
  }

  label(pw) {
    const p = this.v.copy(pw).applyMatrix4(this.worldToVol);
    const x = Math.round(p.x / this.sx), y = Math.round(p.y / this.sy), z = Math.round(p.z / this.sz);
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return 0;
    return this.labels[x + y * this.nx + z * this.nx * this.ny];
  }

  inBone(pw) { return this.hu(pw) > 180 && this.label(pw) === 2; }
  inBody(pw) { return this.hu(pw) > -500; }
}

const STEP = 0.25; // mm between stored track points
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const HEAD = new THREE.Vector3(-1, 0, 0);   // patient's head in the world (prone, head toward -X)

// Needle behaviour, from docs/needle-rules.md. Named so they can be tuned.
// Drift numbers come from bench studies (gel, meat, pig muscle), not living patients.
// The 15 mm cut-off, the lean limits and the steering at depth are estimates.
export const RULES = {
  FREE_DEPTH: 15,          // mm: above this depth the whole needle can be re-aimed (rule 1)
  LEAN_MIN: 6,             // deg: max hub lean = LEAN_MIN + LEAN_EXTRA * exp(-(depth - 15) / LEAN_DECAY) (rule 2)
  LEAN_EXTRA: 14,
  LEAN_DECAY: 12,
  STEER_BASE: 1 / 45,      // rad per mm: tip turn toward the hub while advancing at depth (rule 2)
  STEER_DECAY: 8,          // mm
  STEER_FULL_LEAN: 10,     // deg of lean for full steering
  DRIFT_BASE: 1 / 580,     // 1/mm: bevel drift curvature (rule 3) ...
  DRIFT_KICK: 0.0105,      // ... + DRIFT_KICK * exp(-s / DRIFT_KICK_MM): early "kick"
  DRIFT_KICK_MM: 4,
  BENT_FACTOR: 2.5,        // bent tip drifts 2.5 x more
  KICK_RESET_DEG: 30,      // turning the hub this much restarts the kick
  SPRING_SEC: 0.3,         // VR: the bend springs back when the hub is let go
  BACK_TO_SKIN_MM: 6,      // rule 4
  LIMIT_MSG_SEC: 4,        // at most one "deep tissue" message per 4 s
};

export class Needle {
  constructor(tissue) {
    this.tissue = tissue;
    this.length = 89;        // 3.5 inch, 22G Quincke
    this.radius = 0.36;      // mm
    this.state = 'none';     // 'none' | 'free' (in the hand, VR) | 'skin' (on or in the patient)
    this.E = new THREE.Vector3();          // skin entry point
    this.d = new THREE.Vector3(0, -1, 0);  // hub direction: the outside part of the needle, hub -> skin
    this.inDir = new THREE.Vector3(0, -1, 0); // direction of the track where it enters the skin
    this.tipDir = new THREE.Vector3(0, -1, 0); // stored tip direction (rule 3: never re-derived from points)
    this.depth = 0;          // mm of needle under the skin
    this.path = [];          // track points from the skin to the tip, STEP mm apart (world)
    this.dirs = [];          // stored tip direction at each track point
    this.hubFree = new THREE.Vector3();
    this.boneContact = false;
    this.punctures = 0;
    this.curved = false;     // bent tip: drifts BENT_FACTOR x more
    this.bevel = 0;          // notch clock angle, rad: 0 = 12 o'clock (toward the head), clockwise seen from the hub
    this.sKick = 0;          // mm advanced since entry or since the hub was last turned >= 30 deg
    this.turnSince = 0;      // hub turn since the kick was last restarted (rad)
    this.onBone = () => {};
    this.onLimit = () => {}; // pushed the hub beyond the lean limit (rule 2)
    this.onChange = () => {};
    this.tmp = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.model = buildModel(this);
    this.model.visible = false;
  }

  tip(out = new THREE.Vector3()) {
    if (this.state === 'free') return out.copy(this.hubFree).addScaledVector(this.d, this.length * 0.001);
    if (this.path.length) return out.copy(this.path[this.path.length - 1]);
    return out.copy(this.E);
  }

  hub(out = new THREE.Vector3()) {
    if (this.state === 'free') return out.copy(this.hubFree);
    return out.copy(this.E).addScaledVector(this.d, -(this.length - this.depth) * 0.001);
  }

  isDeep() { return this.depth > RULES.FREE_DEPTH; }
  maxLean() { return RULES.LEAN_MIN + RULES.LEAN_EXTRA * Math.exp(-(this.depth - RULES.FREE_DEPTH) / RULES.LEAN_DECAY); }
  lean() { return this.state === 'skin' ? this.d.angleTo(this.inDir) / DEG : 0; }

  setLength(mm) {
    this.length = mm;
    if (this.depth > mm) this.advance(mm - this.depth);
    rebuild(this);
    this.changed();
  }

  // put the tip on the skin at E, pointing along d
  place(E, d) {
    this.state = 'skin';
    this.E.copy(E);
    this.d.copy(d).normalize(); this.inDir.copy(this.d); this.tipDir.copy(this.d);
    this.path = [this.E.clone()]; this.dirs = [this.d.clone()];
    this.depth = 0; this.boneContact = false;
    this.sKick = 0; this.turnSince = 0;
    this.punctures++;
    this.changed();
  }

  // a straight needle already in place (tests, and "ideal placement" later)
  setStraight(E, d, depthMM) {
    this.state = 'skin';
    this.E.copy(E);
    this.d.copy(d).normalize(); this.inDir.copy(this.d); this.tipDir.copy(this.d);
    this.rebuildStraight(Math.round(depthMM / STEP) * STEP);
    this.boneContact = false; this.sKick = depthMM; this.turnSince = 0;
    this.changed();
  }

  rebuildStraight(depthMM) {
    this.path = []; this.dirs = [];
    const n = Math.round(depthMM / STEP);
    for (let i = 0; i <= n; i++) {
      this.path.push(this.E.clone().addScaledVector(this.inDir, i * STEP * 0.001));
      this.dirs.push(this.inDir.clone());
    }
    this.depth = n * STEP;
    this.tipDir.copy(this.inDir);
  }

  remove() {
    this.state = 'none'; this.depth = 0; this.boneContact = false; this.path = []; this.dirs = [];
    this.changed();
  }

  // needle carried in the hand, outside the patient
  setFree(hub, d) {
    this.state = 'free'; this.hubFree.copy(hub);
    this.d.copy(d).normalize(); this.inDir.copy(this.d); this.tipDir.copy(this.d);
    this.depth = 0; this.boneContact = false; this.path = []; this.dirs = [];
    this.changed();
  }

  // unit vector across the needle (axis pointing into the patient) toward the hub notch
  notchDir(axis = this.tipDir, out = new THREE.Vector3()) {
    out.copy(HEAD).addScaledVector(axis, -HEAD.dot(axis));             // 12 o'clock = toward the head
    if (out.lengthSq() < 0.04) out.set(0, 0, 1).addScaledVector(axis, -axis.z);
    out.normalize().applyAxisAngle(axis, this.bevel);                  // clockwise as seen from the hub
    return out;
  }

  notchClock() {
    const h = Math.round(this.bevel / (Math.PI / 6)) % 12;
    return h === 0 ? 12 : h;
  }

  // turn the hub (and the bevel) by rad; a turn of 30 deg or more restarts the drift "kick"
  spin(rad) {
    this.bevel = ((this.bevel + rad) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    this.turnSince += rad;
    if (Math.abs(this.turnSince) >= RULES.KICK_RESET_DEG * DEG) { this.sKick = 0; this.turnSince = 0; }
    this.changed();
  }

  // turn the stored tip direction toward unit vector `to` by `ang` radians, never past it
  turnTip(to, ang) {
    const a = this.tipDir.angleTo(to);
    if (a < 1e-9 || ang <= 0) return;
    const f = Math.min(1, ang / a);
    this.q.setFromUnitVectors(this.tipDir, to);
    const part = new THREE.Quaternion().slerp(this.q, f);
    this.tipDir.applyQuaternion(part).normalize();
  }

  // push (+mm) or pull (-mm) along the track. Stops at bone. Returns mm really moved.
  advance(mm) {
    if (this.state !== 'skin' || !mm) return 0;
    if (!this.path.length) { this.path = [this.E.clone()]; this.dirs = [this.tipDir.clone()]; }
    let moved = 0, hit = false;
    if (mm > 0) {
      let left = mm;
      const away = new THREE.Vector3();
      while (left >= STEP * 0.5 && this.depth + STEP <= this.length + 1e-6) {
        const tip = this.path[this.path.length - 1];
        const nt = tip.clone().addScaledVector(this.tipDir, STEP * 0.001);
        if (this.tissue.inBone(nt)) { hit = true; break; }
        if (this.tissue.inBody(nt)) {
          // rule 3: bevel drift, away from the notch (every needle; bent tip x2.5)
          const k = (RULES.DRIFT_BASE + RULES.DRIFT_KICK * Math.exp(-this.sKick / RULES.DRIFT_KICK_MM))
            * (this.curved ? RULES.BENT_FACTOR : 1);
          this.notchDir(this.tipDir, away).negate();
          this.turnTip(away, k * STEP);
          // rule 2: at depth the tip turns a little toward the hub, only while advancing
          if (this.depth > RULES.FREE_DEPTH) {
            const lean = this.lean();
            if (lean > 0.01) {
              const r = RULES.STEER_BASE * Math.exp(-(this.depth - RULES.FREE_DEPTH) / RULES.STEER_DECAY)
                * Math.min(1, lean / RULES.STEER_FULL_LEAN);
              this.turnTip(this.d, r * STEP);
            }
          }
        }
        this.path.push(nt); this.dirs.push(this.tipDir.clone());
        this.depth += STEP; this.sKick += STEP; moved += STEP; left -= STEP;
      }
    } else {
      let left = -mm;
      while (left >= STEP * 0.5 && this.path.length > 1) {   // back along the same track
        this.path.pop(); this.dirs.pop();
        this.depth -= STEP; moved -= STEP; left -= STEP;
      }
      this.tipDir.copy(this.dirs[this.dirs.length - 1]);
      if (moved < 0) this.boneContact = false;
      if (this.depth <= RULES.FREE_DEPTH) this.d.copy(this.inDir);  // rule 4: back under 15 mm, the lean clears
    }
    if (hit) { this.boneContact = true; this.onBone(); }
    if (moved !== 0 || hit) this.changed();
    return moved;
  }

  // rule 4: withdraw to about 6 mm
  backToSkin() {
    if (this.state === 'skin' && this.depth > RULES.BACK_TO_SKIN_MM) this.advance(RULES.BACK_TO_SKIN_MM - this.depth);
  }

  // The user moves the hub toward a new direction.
  //  - under 15 mm (rule 1): the whole needle is re-aimed; the track is rebuilt from the skin.
  //  - deeper (rule 2): the tissue holds the shaft. The hub only leans, up to the limit;
  //    the tip does not move now (it turns a little later, while advancing).
  // Returns false if refused (bone) or held at the lean limit.
  aim(newDir) {
    if (this.state !== 'skin') return false;
    const nd = this.tmp.copy(newDir).normalize().clone();
    if (this.depth <= RULES.FREE_DEPTH) {
      const tipNew = this.E.clone().addScaledVector(nd, this.depth * 0.001);
      if (this.depth > 0.5 && this.tissue.inBone(tipNew)) { this.onBone(); return false; }
      this.d.copy(nd); this.inDir.copy(nd);
      this.rebuildStraight(this.depth);
      this.changed();
      return true;
    }
    const max = this.maxLean() * DEG, ang = nd.angleTo(this.inDir);
    if (ang > max) {   // held at the limit
      this.q.setFromUnitVectors(this.inDir, nd);
      this.d.copy(this.inDir).applyQuaternion(new THREE.Quaternion().slerp(this.q, max / ang)).normalize();
      this.onLimit();
      this.changed();
      return false;
    }
    this.d.copy(nd);
    this.changed();
    return true;
  }

  // rotate the hub direction by deg around a world axis (phone arrows: 1 deg per tap)
  rotate(axis, deg) {
    const q = new THREE.Quaternion().setFromAxisAngle(axis, deg * DEG);
    return this.aim(new THREE.Vector3().copy(this.d).applyQuaternion(q));
  }

  // VR: when the hub is let go, the bend springs back to straight within about 0.3 s
  relax(dt) {
    if (this.state !== 'skin' || this.lean() < 0.02) return;
    const f = 1 - Math.exp(-dt / (RULES.SPRING_SEC / 4));
    this.q.setFromUnitVectors(this.d, this.inDir);
    this.d.applyQuaternion(new THREE.Quaternion().slerp(this.q, f)).normalize();
    if (this.lean() < 0.05) this.d.copy(this.inDir);
    this.changed();
  }

  // the outside part: leaves the skin along the track and bends toward the leaned hub
  outsideCurve(n = 10) {
    const hub = this.hub(), out = this.length - this.depth;
    const c1 = this.E.clone().addScaledVector(this.inDir, -0.45 * out * 0.001);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
      pts.push(new THREE.Vector3().addScaledVector(this.E, a).addScaledVector(c1, b).addScaledVector(hub, c));
    }
    return pts;
  }

  // steel parts for the C-arm image: list of [a, b] world segments (max 8)
  segments() {
    if (this.state === 'none') return [];
    const hub = this.hub(), tip = this.tip();
    if (this.state === 'free' || this.path.length < 2) return [[tip, hub]];
    const segs = [], n = this.path.length - 1, k = Math.min(5, Math.max(1, Math.ceil(this.depth / 15)));
    for (let i = 0; i < k; i++) segs.push([this.path[Math.round((n * i) / k)], this.path[Math.round((n * (i + 1)) / k)]]);
    if (this.lean() > 0.2) {
      const o = this.outsideCurve(3);
      for (let i = 0; i < 3; i++) segs.push([o[i], o[i + 1]]);
    } else segs.push([this.E.clone(), hub]);
    return segs;
  }

  changed(notify = true) {
    this.updateModel();
    if (notify) this.onChange();
  }

  updateModel() {
    const m = this.model, P = m.userData;
    if (!P) return;
    m.visible = this.state !== 'none';
    if (!m.visible) return;
    const hub = this.hub(), tip = this.tip();
    const inside = this.state === 'skin' && this.path.length > 2;
    const tipDir = this.state === 'skin' ? this.tipDir : this.d;
    // inside part: a tube along the track
    P.tube.visible = inside;
    if (inside) {
      const pts = [], n = this.path.length - 1, k = Math.min(40, Math.max(2, Math.ceil(this.depth / 2)));
      for (let i = 0; i <= k; i++) pts.push(this.path[Math.round((n * i) / k)]);
      P.tube.geometry.dispose();
      P.tube.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), k * 2, 0.0006, 6, false);
    }
    // outside part: straight, or bent toward a leaned hub
    const bent = this.state === 'skin' && this.lean() > 0.05;
    P.outTube.visible = bent; P.shaft.visible = !bent;
    let hubAxis = this.tmp.copy(this.d).negate();          // outward, along the hub
    if (bent) {
      const o = this.outsideCurve(12);
      P.outTube.geometry.dispose();
      P.outTube.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(o), 24, 0.0006, 6, false);
      hubAxis = o[12].clone().sub(o[11]).normalize();
    } else {
      const a = inside || this.state === 'skin' ? this.E : tip.clone().addScaledVector(tipDir, -0.0025);
      placeCyl(P.shaft, a, hub);
    }
    hubAxis = hubAxis.clone();
    // sharp tip, hub, notch (the notch marks the bevel: the needle drifts away from it)
    P.tip.position.copy(tip);
    P.tip.quaternion.setFromUnitVectors(UP, tipDir);
    P.hubG.position.copy(hub);
    P.hubG.quaternion.setFromUnitVectors(UP, hubAxis);
    const nd = this.notchDir(hubAxis.clone().negate(), new THREE.Vector3());
    P.notch.position.copy(hub).addScaledVector(hubAxis, 0.012).addScaledVector(nd, 0.0042);
    P.notch.quaternion.copy(P.hubG.quaternion);
    P.tipBend.visible = this.curved;
    if (this.curved) { // short bent tip, bent away from the notch
      const away = this.notchDir(tipDir, new THREE.Vector3()).negate();
      const bendDir = tipDir.clone().multiplyScalar(Math.cos(0.26)).addScaledVector(away, Math.sin(0.26)).normalize();
      P.tipBend.position.copy(tip).addScaledVector(bendDir, -0.0025);
      P.tipBend.quaternion.setFromUnitVectors(UP, bendDir);
    }
  }

  // angles for the readout: hub direction away from straight down
  angles() {
    const d = this.d;
    const down = Math.max(1e-6, -d.y);
    return {
      cranial: Math.atan2(-d.x, down) * 180 / Math.PI,  // + = toward the head
      left: Math.atan2(d.z, down) * 180 / Math.PI,      // + = toward the patient's left
    };
  }
}

// a unit cylinder (height 1 along +Y, centred) stretched from a to b
function placeCyl(mesh, a, b) {
  const v = new THREE.Vector3().subVectors(b, a);
  const L = Math.max(1e-5, v.length());
  mesh.position.copy(a).addScaledVector(v, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, v.multiplyScalar(1 / L));
  mesh.scale.set(1, L, 1);
}

function buildModel(n) {
  const g = new THREE.Group();
  rebuild(n, g);
  return g;
}

function rebuild(n, g = n.model) {
  g.clear();
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.9, roughness: 0.25 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.5 }); // 22G = black hub
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0006, 1, 8), steel);
  const tube = new THREE.Mesh(new THREE.BufferGeometry(), steel);
  const outTube = new THREE.Mesh(new THREE.BufferGeometry(), steel);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0006, 0.0025, 8).translate(0, -0.00125, 0), steel); // apex at origin, along +Y
  const tipG = new THREE.Group(); tipG.add(tip);
  const tipBend = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0006, 0.0025, 8).translate(0, 0.00125, 0), steel);
  const hubG = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.0026, 0.02, 14), hubMat);
  hub.position.y = 0.01;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.006, 14), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }));
  cap.position.y = 0.023;
  hubG.add(hub, cap);
  const notch = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.006, 0.0016), new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.4 }));
  g.add(shaft, tube, outTube, tipG, tipBend, hubG, notch);
  g.userData = { shaft, tube, outTube, tip: tipG, tipBend, hubG, notch };
  if (n.model) n.updateModel();
}
