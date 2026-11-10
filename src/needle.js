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

const STEP = 0.25; // mm
const UP = new THREE.Vector3(0, 1, 0);

export class Needle {
  constructor(tissue) {
    this.tissue = tissue;
    this.length = 89;        // 3.5 inch, 22G
    this.radius = 0.36;      // mm
    this.state = 'none';     // 'none' | 'free' (in the hand, VR) | 'skin' (on or in the patient)
    this.E = new THREE.Vector3();   // skin entry point
    this.d = new THREE.Vector3(0, -1, 0); // direction, hub -> tip
    this.depth = 0;          // mm of needle under the skin
    this.hubFree = new THREE.Vector3();
    this.boneContact = false;
    this.punctures = 0;
    this.onBone = () => {};
    this.onChange = () => {};
    this.model = buildModel(this);
    this.model.visible = false;
    this.tmp = new THREE.Vector3();
  }

  tip(out = new THREE.Vector3()) {
    if (this.state === 'free') return out.copy(this.hubFree).addScaledVector(this.d, this.length * 0.001);
    return out.copy(this.E).addScaledVector(this.d, this.depth * 0.001);
  }

  hub(out = new THREE.Vector3()) {
    if (this.state === 'free') return out.copy(this.hubFree);
    return out.copy(this.E).addScaledVector(this.d, -(this.length - this.depth) * 0.001);
  }

  setLength(mm) {
    this.length = mm;
    this.depth = Math.min(this.depth, mm);
    rebuild(this);
    this.changed();
  }

  // put the tip on the skin at E, pointing along d
  place(E, d) {
    this.state = 'skin';
    this.E.copy(E); this.d.copy(d).normalize();
    this.depth = 0; this.boneContact = false;
    this.punctures++;
    this.changed();
  }

  remove() {
    this.state = 'none'; this.depth = 0; this.boneContact = false;
    this.changed();
  }

  // needle carried in the hand, outside the patient
  setFree(hub, d) {
    this.state = 'free'; this.hubFree.copy(hub); this.d.copy(d).normalize();
    this.depth = 0; this.boneContact = false;
    this.changed();
  }

  // push (+mm) or pull (-mm) along the needle. Stops at bone. Returns mm really moved.
  advance(mm) {
    if (this.state !== 'skin' || !mm) return 0;
    const dir = Math.sign(mm);
    let left = Math.abs(mm), moved = 0, hit = false;
    while (left > 1e-6) {
      const st = Math.min(STEP, left);
      const nd = this.depth + dir * st;
      if (nd > this.length || nd < 0) break;
      if (dir > 0) {
        this.tmp.copy(this.E).addScaledVector(this.d, nd * 0.001);
        if (this.tissue.inBone(this.tmp)) { hit = true; break; }
      }
      this.depth = nd; moved += st; left -= st;
    }
    if (dir < 0 && moved > 0) this.boneContact = false;
    if (hit) { this.boneContact = true; this.onBone(); }
    if (moved > 0 || hit) this.changed();
    return moved * dir;
  }

  // Turn the needle about the skin entry point. Deep tissue holds the needle,
  // so the change is small when the tip is deep. Refused if the tip would end in bone.
  aim(newDir) {
    if (this.state !== 'skin') return false;
    const nd = this.tmp.copy(newDir).normalize();
    const tipNew = new THREE.Vector3().copy(this.E).addScaledVector(nd, this.depth * 0.001);
    if (this.depth > 0.5 && this.tissue.inBone(tipNew)) { this.onBone(); return false; }
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

  changed(notify = true) {
    this.updateModel();
    if (notify) this.onChange();
  }

  updateModel() {
    const m = this.model;
    m.visible = this.state !== 'none';
    if (!m.visible) return;
    this.tip(m.position);
    m.quaternion.setFromUnitVectors(UP, this.tmp.copy(this.d).negate()); // local +Y = tip -> hub
  }

  // angles for the readout: tip direction away from straight down
  angles() {
    const d = this.d;
    const down = Math.max(1e-6, -d.y);
    return {
      cranial: Math.atan2(-d.x, down) * 180 / Math.PI,  // + = tip toward the head
      left: Math.atan2(d.z, down) * 180 / Math.PI,      // + = tip toward the patient's left
    };
  }
}

function buildModel(n) {
  const g = new THREE.Group();
  rebuild(n, g);
  return g;
}

function rebuild(n, g = n.model) {
  g.clear();
  const L = n.length * 0.001;
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.9, roughness: 0.25 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.5 }); // 22G = black hub
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0006, L, 8), steel);
  shaft.scale.y = (L - 0.003) / L; shaft.position.y = 0.0015 + L / 2; // from the bevel to the hub
  const tipCone = new THREE.Mesh(new THREE.ConeGeometry(0.0006, 0.003, 8), steel);
  tipCone.rotation.x = Math.PI; tipCone.position.y = 0.0015;          // point at y = 0
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.0026, 0.02, 14), hubMat);
  hub.position.y = L + 0.01;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.006, 14), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }));
  cap.position.y = L + 0.023;
  g.add(shaft, tipCone, hub, cap);
}
