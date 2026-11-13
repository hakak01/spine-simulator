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

const STEP = 0.25; // mm between stored path points
const UP = new THREE.Vector3(0, 1, 0);
const HEAD = new THREE.Vector3(-1, 0, 0);   // patient's head in the world (prone, head toward -X)

export class Needle {
  constructor(tissue) {
    this.tissue = tissue;
    this.length = 89;        // 3.5 inch, 22G
    this.radius = 0.36;      // mm
    this.state = 'none';     // 'none' | 'free' (in the hand, VR) | 'skin' (on or in the patient)
    this.E = new THREE.Vector3();         // skin entry point
    this.d = new THREE.Vector3(0, -1, 0); // direction of the needle outside the skin (hub -> skin)
    this.depth = 0;          // mm of needle under the skin
    this.hubFree = new THREE.Vector3();
    this.boneContact = false;
    this.punctures = 0;
    // curved tip: the needle bends toward its curve as it advances through soft tissue.
    // Turning the hub turns the curve. The notch on the hub shows where the curve points.
    this.curved = false;
    this.curveDeg = 0.35;    // degrees of turn per mm advanced (curved tip, soft tissue; ~16 cm radius)
    this.bevel = 0;          // radians around the needle axis; 0 = curve points toward the head
    this.path = [];          // world points from the skin entry to the tip, STEP mm apart
    this.tipDir = new THREE.Vector3(0, -1, 0);
    this.onBone = () => {};
    this.onChange = () => {};
    this.model = buildModel(this);
    this.model.visible = false;
    this.tmp = new THREE.Vector3();
    this.q = new THREE.Quaternion();
  }

  tip(out = new THREE.Vector3()) {
    if (this.state === 'free') return out.copy(this.hubFree).addScaledVector(this.d, this.length * 0.001);
    if (this.path.length) return out.copy(this.path[this.path.length - 1]);
    return out.copy(this.E).addScaledVector(this.d, this.depth * 0.001);
  }

  hub(out = new THREE.Vector3()) {
    if (this.state === 'free') return out.copy(this.hubFree);
    return out.copy(this.E).addScaledVector(this.d, -(this.length - this.depth) * 0.001);
  }

  setLength(mm) {
    this.length = mm;
    if (this.depth > mm) this.advance(mm - this.depth - 1e-6);
    rebuild(this);
    this.changed();
  }

  // put the tip on the skin at E, pointing along d
  place(E, d) {
    this.state = 'skin';
    this.E.copy(E); this.d.copy(d).normalize(); this.tipDir.copy(this.d);
    this.path = [this.E.clone()];
    this.depth = 0; this.boneContact = false;
    this.punctures++;
    this.changed();
  }

  // a straight needle already in place (used by tests and by "ideal placement" later)
  setStraight(E, d, depthMM) {
    this.state = 'skin';
    this.E.copy(E); this.d.copy(d).normalize(); this.tipDir.copy(this.d);
    this.path = [];
    const n = Math.round(depthMM / STEP);
    for (let i = 0; i <= n; i++) this.path.push(this.E.clone().addScaledVector(this.d, i * STEP * 0.001));
    this.depth = n * STEP; this.boneContact = false;
    this.changed();
  }

  remove() {
    this.state = 'none'; this.depth = 0; this.boneContact = false; this.path = [];
    this.changed();
  }

  // needle carried in the hand, outside the patient
  setFree(hub, d) {
    this.state = 'free'; this.hubFree.copy(hub); this.d.copy(d).normalize(); this.tipDir.copy(this.d);
    this.depth = 0; this.boneContact = false; this.path = [];
    this.changed();
  }

  // unit vector, across the needle at the tip, toward which the curved tip points
  curveDir(axis = this.tipDir, out = new THREE.Vector3()) {
    out.copy(HEAD).addScaledVector(axis, -HEAD.dot(axis));
    if (out.lengthSq() < 0.04) out.set(0, 0, 1).addScaledVector(axis, -axis.z);
    out.normalize().applyAxisAngle(axis, this.bevel);
    return out;
  }

  // where the curve points, in words (for the readout)
  curveLabel() {
    const c = this.curveDir(this.tipDir);
    const ax = Math.abs(c.x), az = Math.abs(c.z), ay = Math.abs(c.y);
    if (ax >= az && ax >= ay) return c.x < 0 ? 'toward the head' : 'toward the feet';
    if (az >= ay) return c.z > 0 ? "toward the patient's left" : "toward the patient's right";
    return c.y > 0 ? 'toward the back (up)' : 'toward the front (down)';
  }

  // turn the hub (and with it the curved tip) by rad around the needle
  spin(rad) {
    this.bevel = ((this.bevel + rad) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    this.changed();
  }

  // push (+mm) or pull (-mm) along the needle path. Stops at bone. Returns mm really moved.
  advance(mm) {
    if (this.state !== 'skin' || !mm) return 0;
    if (!this.path.length) this.path = [this.E.clone()];
    let moved = 0, hit = false;
    if (mm > 0) {
      let left = mm;
      const c = new THREE.Vector3();
      while (left >= STEP * 0.5 && this.depth + STEP <= this.length + 1e-6) {
        const tip = this.path[this.path.length - 1];
        const nt = tip.clone().addScaledVector(this.tipDir, STEP * 0.001);
        if (this.tissue.inBone(nt)) { hit = true; break; }
        if (this.curved && this.depth > 1) { // the curved tip pulls the needle toward its curve
          const a = this.curveDeg * STEP * Math.PI / 180;
          this.curveDir(this.tipDir, c);
          this.tipDir.multiplyScalar(Math.cos(a)).addScaledVector(c, Math.sin(a)).normalize();
        }
        this.path.push(nt);
        this.depth += STEP; moved += STEP; left -= STEP;
      }
    } else {
      let left = -mm;
      while (left >= STEP * 0.5 && this.path.length > 1) {   // withdraw back along the same track
        this.path.pop();
        this.depth -= STEP; moved -= STEP; left -= STEP;
      }
      if (this.path.length > 1) {
        const n = this.path.length;
        this.tipDir.subVectors(this.path[n - 1], this.path[n - 2]).normalize();
      } else this.tipDir.copy(this.d);
      if (moved < 0) this.boneContact = false;
    }
    if (hit) { this.boneContact = true; this.onBone(); }
    if (moved !== 0 || hit) this.changed();
    return moved;
  }

  // Turn the needle about the skin entry point (the whole needle turns, its track too).
  // Deep tissue holds the needle, so the change is small when the tip is deep.
  // Refused if the tip would end in bone.
  aim(newDir) {
    if (this.state !== 'skin') return false;
    const nd = this.tmp.copy(newDir).normalize();
    this.q.setFromUnitVectors(this.d, nd);
    const tipNew = this.tip().sub(this.E).applyQuaternion(this.q).add(this.E);
    if (this.depth > 0.5 && this.tissue.inBone(tipNew)) { this.onBone(); return false; }
    for (const p of this.path) p.sub(this.E).applyQuaternion(this.q).add(this.E);
    this.tipDir.applyQuaternion(this.q);
    this.d.copy(nd);
    this.changed();
    return true;
  }

  // how freely the needle can be re-angled at this depth (1 = free, small = held by tissue)
  steerFactor() { return this.depth <= 15 ? 1 : Math.max(0.08, 15 / this.depth * 0.5); }

  // rotate by deg around a world axis, scaled by the tissue grip
  rotate(axis, deg) {
    const q = new THREE.Quaternion().setFromAxisAngle(axis, deg * this.steerFactor() * Math.PI / 180);
    return this.aim(new THREE.Vector3().copy(this.d).applyQuaternion(q));
  }

  // steel parts for the C-arm image: list of [a, b] world segments
  segments() {
    if (this.state === 'none') return [];
    const hub = this.hub(), tip = this.tip();
    if (this.state === 'free' || this.path.length < 2 || !this.isBent()) return [[tip, hub]];
    const segs = [], n = this.path.length - 1, k = Math.min(6, Math.max(1, Math.ceil(this.depth / 12)));
    for (let i = 0; i < k; i++) segs.push([this.path[Math.round((n * i) / k)], this.path[Math.round((n * (i + 1)) / k)]]);
    segs.push([this.E.clone(), hub]);
    return segs;
  }

  isBent() { return this.tipDir.angleTo(this.d) > 0.002; }

  changed(notify = true) {
    this.updateModel();
    if (notify) this.onChange();
  }

  updateModel() {
    const m = this.model, P = m.userData;
    m.visible = this.state !== 'none';
    if (!m.visible) return;
    const hub = this.hub(), tip = this.tip();
    const bent = this.state === 'skin' && this.path.length > 2 && this.isBent();
    // straight part: from the tip (or the skin, if the inside part is bent) to the hub
    const tipDir = this.state === 'skin' ? this.tipDir : this.d;
    const a = bent ? this.E : tip.clone().addScaledVector(tipDir, -0.0025); // stop where the sharp tip starts
    placeCyl(P.shaft, a, hub);
    // inside part of a bent needle: a tube along the track
    P.tube.visible = bent;
    if (bent) {
      const pts = [], n = this.path.length - 1, k = Math.min(40, Math.max(2, Math.ceil(this.depth / 2)));
      for (let i = 0; i <= k; i++) pts.push(this.path[Math.round((n * i) / k)]);
      P.tube.geometry.dispose();
      P.tube.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), k * 2, 0.0006, 6, false);
    }
    // tip, hub, notch (the notch on the hub marks where the curved tip points)
    P.tip.position.copy(tip);
    P.tip.quaternion.setFromUnitVectors(UP, tipDir);                      // cone apex at the tip
    P.hubG.position.copy(hub);
    P.hubG.quaternion.setFromUnitVectors(UP, this.tmp.copy(this.d).negate());
    const nd = this.curveDir(this.d, new THREE.Vector3());
    P.notch.position.copy(hub).addScaledVector(this.d, -0.012).addScaledVector(nd, 0.0042);
    P.notch.quaternion.copy(P.hubG.quaternion);
    P.notch.visible = true;
    P.tipBend.visible = this.curved;
    if (this.curved) { // a short bent tip, pointing toward the curve
      const cd = this.curveDir(tipDir, new THREE.Vector3());
      const bendDir = this.tmp.copy(tipDir).multiplyScalar(Math.cos(0.26)).addScaledVector(cd, Math.sin(0.26)).normalize();
      P.tipBend.position.copy(tip).addScaledVector(bendDir, -0.0025);       // ends at the tip
      P.tipBend.quaternion.setFromUnitVectors(UP, bendDir);
    }
  }

  // angles for the readout: needle direction away from straight down
  angles() {
    const d = this.d;
    const down = Math.max(1e-6, -d.y);
    return {
      cranial: Math.atan2(-d.x, down) * 180 / Math.PI,  // + = tip toward the head
      left: Math.atan2(d.z, down) * 180 / Math.PI,      // + = tip toward the patient's left
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
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0006, 0.0025, 8).translate(0, -0.00125, 0), steel); // apex at the origin, along +Y
  const tipG = new THREE.Group(); tipG.add(tip);
  // short bent tip of the curved needle (2.5 mm long, along its own local +Y)
  const tipBend = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0006, 0.0025, 8).translate(0, 0.00125, 0), steel);
  const hubG = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.0026, 0.02, 14), hubMat);
  hub.position.y = 0.01;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.006, 14), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }));
  cap.position.y = 0.023;
  hubG.add(hub, cap);
  const notch = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.006, 0.0016), new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.4 }));
  g.add(shaft, tube, tipG, tipBend, hubG, notch);
  g.userData = { shaft, tube, tip: tipG, tipBend, hubG, notch };
  if (n.model) n.updateModel();
}
