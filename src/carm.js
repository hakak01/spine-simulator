// C-arm geometry and a simple 3D model.
// World frame: patient prone, head toward -X, patient's left toward +Z (operator side), up = +Y.
import * as THREE from 'three';

const DEG = Math.PI / 180;

export class CArm {
  constructor() {
    this.iso = new THREE.Vector3();
    this.obl = 0;    // degrees, + = detector toward patient's LEFT
    this.tilt = 0;   // degrees, + = detector toward the HEAD (cranial)
    this.SOD = 0.6;  // tube to isocentre, m
    this.SID = 1.0;  // tube to detector, m
    this.detR = 0.115; // 9-inch intensifier
    this.flip = false;
    this.model = buildModel(this);
  }

  // Like a mobile C-arm: the cranio-caudal tilt tilts the whole C, and the oblique (orbital)
  // turn happens inside the tilted C. So a squared endplate stays square when you oblique.
  rotation() {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(this.obl * DEG, 0, this.tilt * DEG, 'ZYX'));
  }

  // beam direction, tube -> detector
  dir() { return new THREE.Vector3(0, 1, 0).applyQuaternion(this.rotation()); }

  // world-space frame of the projection
  frame() {
    const d = this.dir();
    const src = this.iso.clone().addScaledVector(d, -this.SOD);
    const detC = this.iso.clone().addScaledVector(d, this.SID - this.SOD);
    const view = d.clone().negate(); // from detector looking at the tube
    const up = new THREE.Vector3(-1, 0, 0); // patient's head at top of image
    up.addScaledVector(d, -up.dot(d));
    if (up.lengthSq() < 1e-6) up.set(0, 0, 1);
    up.normalize();
    const right = new THREE.Vector3().crossVectors(view, up).normalize();
    return { src, detC, detU: right.multiplyScalar(this.detR), detV: up.multiplyScalar(this.detR) };
  }

  label() {
    const o = Math.round(this.obl), t = Math.round(this.tilt);
    const ob = Math.abs(o) >= 88 ? `LAT (${o > 0 ? 'det. L' : 'det. R'})` : o === 0 ? 'AP' : `OBL ${Math.abs(o)}° ${o > 0 ? 'L' : 'R'}`;
    const ti = t === 0 ? '' : ` · TILT ${Math.abs(t)}° ${t > 0 ? 'CRAN' : 'CAUD'}`;
    return ob + ti;
  }

  updateModel() {
    this.model.position.copy(this.iso);
    this.model.quaternion.copy(this.rotation());
  }
}

function buildModel(c) {
  const g = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.6, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.7 });
  // tube (below the table)
  const tube = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.2), grey);
  tube.position.y = -c.SOD - 0.03;
  g.add(tube);
  // detector (above the patient)
  const det = new THREE.Mesh(new THREE.CylinderGeometry(c.detR + 0.04, c.detR + 0.04, 0.09, 40), grey);
  det.position.y = c.SID - c.SOD + 0.045;
  g.add(det);
  const face = new THREE.Mesh(new THREE.CircleGeometry(c.detR, 40), dark);
  face.rotation.x = Math.PI / 2;
  face.position.y = c.SID - c.SOD - 0.001;
  g.add(face);
  // the "C", on the far side of the table
  const y0 = -c.SOD - 0.03, y1 = c.SID - c.SOD + 0.06;
  const r = (y1 - y0) / 2 + 0.02;
  const arc = new THREE.TorusGeometry(r, 0.035, 10, 48, Math.PI);
  arc.rotateZ(-Math.PI / 2);
  arc.rotateY(Math.PI / 2);
  arc.translate(0, (y0 + y1) / 2, 0);
  g.add(new THREE.Mesh(arc, grey));
  // beam (faint cone) and central ray
  const len = c.SID;
  const cone = new THREE.ConeGeometry(c.detR, len, 40, 1, true);
  cone.rotateX(Math.PI); // apex at bottom (tube)
  cone.translate(0, -c.SOD + len / 2, 0);
  g.add(new THREE.Mesh(cone, new THREE.MeshBasicMaterial({
    color: 0x66ccff, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide,
  })));
  const ray = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -c.SOD, 0), new THREE.Vector3(0, c.SID - c.SOD, 0)]);
  g.add(new THREE.Line(ray, new THREE.LineBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.5 })));
  return g;
}
