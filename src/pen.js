// Skin marker pen. Its short metal tip shows on the C-arm image (to localise the
// entry point under fluoroscopy, like resting a clamp tip on the skin), and it
// leaves violet ink dots on the skin. The ink does not show on the C-arm image.
import * as THREE from 'three';

export const PEN_LEN = 0.135;   // m
const METAL_MM = 12;            // radio-opaque tip length
const INK_MAX = 8000;
const INK_GAP = 0.0012;         // m between ink dots
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

export class Pen {
  constructor(tissue) {
    this.t = tissue;
    this.state = 'none';            // 'none' | 'tray' | 'hand' | 'rest' (resting on the skin)
    this.tip = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, -1, 0); // from the cap toward the tip
    this.touching = false;
    this.model = buildPen();
    this.model.visible = false;
    const ink = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.0017, 10),
      new THREE.MeshBasicMaterial({ color: 0x4a1a7a, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      INK_MAX);
    ink.count = 0;
    ink.frustumCulled = false;
    this.ink = ink;
    this.last = null;
    this.onChange = () => {};
    this.v = new THREE.Vector3(); this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion();
  }

  setPose(tip, dir, state) {
    this.tip.copy(tip); this.dir.copy(dir).normalize();
    if (state) this.state = state;
    this.model.visible = this.state !== 'none';
    this.model.position.copy(this.tip);
    this.model.quaternion.setFromUnitVectors(Y, this.v.copy(this.dir).negate()); // local +Y: tip -> cap
    this.onChange();
  }

  hide() { this.state = 'none'; this.model.visible = false; this.touching = false; this.onChange(); }

  // Where does the pen meet the skin if its tip is pushed to `tip` along `dir`?
  // Returns {point, normal} or null (tip still in the air). Uses the CT body surface.
  contact(tip, dir) {
    const T = this.t;
    if (!T.inBody(tip)) return null;
    const out = this.v.copy(tip).addScaledVector(dir, -0.06);
    if (T.inBody(out)) return null;           // far inside: ignore (should not happen)
    let a = 0, b = 0.06;                       // distance back from the tip: a inside, b outside
    for (let i = 0; i < 14; i++) {
      const mid = (a + b) / 2;
      if (T.inBody(this.v.copy(tip).addScaledVector(dir, -mid))) a = mid; else b = mid;
    }
    const point = tip.clone().addScaledVector(dir, -b);
    return { point, normal: this.normalAt(point, dir) };
  }

  normalAt(p, dir) { // outward skin normal from the CT gradient
    const T = this.t, h = 0.003, s = this.v;
    const g = new THREE.Vector3(
      T.hu(s.copy(p).setX(p.x - h)) - T.hu(s.copy(p).setX(p.x + h)),
      T.hu(s.copy(p).setY(p.y - h)) - T.hu(s.copy(p).setY(p.y + h)),
      T.hu(s.copy(p).setZ(p.z - h)) - T.hu(s.copy(p).setZ(p.z + h)));
    if (g.lengthSq() < 1e-6) return dir.clone().negate();
    return g.normalize();
  }

  // add one ink dot (skips dots closer than INK_GAP to the previous one unless forced)
  dot(p, n, force = false) {
    if (!force && this.last) {
      const d = this.last.distanceTo(p);
      if (d < INK_GAP) return false;
      if (d < 0.025) { // fill the gap since the last dot, so a fast stroke stays a line
        const from = this.last.clone();
        for (let s = INK_GAP; s < d - INK_GAP * 0.5; s += INK_GAP) this.put(from.clone().lerp(p, s / d), n);
      }
    }
    return this.put(p, n);
  }

  put(p, n) {
    if (this.ink.count >= INK_MAX) return false;
    this.q.setFromUnitVectors(Z, n);
    this.m.compose(this.v.copy(p).addScaledVector(n, 0.0007), this.q, new THREE.Vector3(1, 1, 1));
    this.ink.setMatrixAt(this.ink.count++, this.m);
    this.ink.instanceMatrix.needsUpdate = true;
    this.last = p.clone();
    return true;
  }

  lift() { this.last = null; } // next dot starts a new stroke

  // a small "X" (about 10 mm) centred on p
  cross(p, n) {
    const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : Y).normalize();
    const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
    const d1 = t1.clone().add(t2).normalize(), d2 = t1.clone().sub(t2).normalize();
    for (const d of [d1, d2]) {
      for (let s = -5; s <= 5; s += 1) this.dot(p.clone().addScaledVector(d, s * 0.001), n, true);
    }
    this.lift();
  }

  // mark under the pen tip (where it touches, or straight below it)
  markAtTip() {
    if (this.state === 'none' || this.state === 'tray') return false;
    const c = this.contact(this.tip.clone().addScaledVector(this.dir, 0.004), this.dir);
    if (!c) return false;
    this.cross(c.point, c.normal);
    return true;
  }

  clearInk() { this.ink.count = 0; this.ink.instanceMatrix.needsUpdate = true; this.last = null; }

  // metal tip for the C-arm image: {a, b} world points, or null
  xray() {
    if (this.state !== 'hand' && this.state !== 'rest') return null;
    return { a: this.tip.clone(), b: this.tip.clone().addScaledVector(this.dir, -METAL_MM * 0.001), radius: 1.0 };
  }
}

function buildPen() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xc9d0d6, metalness: 0.9, roughness: 0.3 });
  const body = new THREE.MeshStandardMaterial({ color: 0x6b2fa0, roughness: 0.5 });
  const capM = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
  const tipCone = new THREE.Mesh(new THREE.ConeGeometry(0.0012, 0.004, 10), metal);
  tipCone.rotation.x = Math.PI; tipCone.position.y = 0.002;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.008, 10), metal);
  shaft.position.y = 0.008;
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0016, 0.012, 14), body);
  cone.position.y = 0.018;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0048, 0.0048, PEN_LEN - 0.034, 14), body);
  barrel.position.y = 0.024 + (PEN_LEN - 0.034) / 2;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.012, 14), capM);
  cap.position.y = PEN_LEN - 0.004;
  g.add(tipCone, shaft, cone, barrel, cap);
  return g;
}
