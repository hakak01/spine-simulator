// C-arm setup coach for lumbar transforaminal injection (subpedicular approach).
// Everything is measured on this patient's CT:
//  - rotation: is the view a true AP of the target vertebra?
//  - endplate: is the chosen endplate squared (beam along the endplate rim)?
//  - oblique: is the straight "down the beam" path to the spot under the pedicle free of bone?
//  - needle tip on the AP and lateral checks.
import * as THREE from 'three';

const DEG = Math.PI / 180;
export const ROOTS = {
  L3: { upper: 'L3', lower: 'L4', level: 'L3-4' },
  L4: { upper: 'L4', lower: 'L5', level: 'L4-5' },
  L5: { upper: 'L5', lower: 'S1', level: 'L5-S1' },
};

export class Setup {
  constructor(anat, tissue, carm, needle, volToWorld, worldToVol) {
    Object.assign(this, { anat, tissue, carm, needle, volToWorld, worldToVol });
    this.root = 'L4';
    this.side = 'L';          // patient's left / right
    this.plate = 'upper';     // 'upper' = lower endplate of the upper vertebra, 'lower' = upper endplate of the lower one
    this.lin = new THREE.Matrix3().setFromMatrix4(worldToVol);
    this.cache = null;
  }

  get sideSign() { return this.side === 'L' ? 1 : -1; } // + oblique = detector toward the patient's left

  // ---- geometry helpers ----
  dirFor(obl, tilt) { // beam (tube -> detector) in world for given angles, same as CArm.dir()
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(obl * DEG, 0, tilt * DEG, 'ZYX'));
    return new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  }

  toVolDir(dw) { return dw.clone().applyMatrix3(this.lin).normalize(); }
  toWorld(pv) { return new THREE.Vector3(...pv).applyMatrix4(this.volToWorld); }

  targetVol() { return new THREE.Vector3(...this.anat.targets[this.root][this.side]); }
  targetWorld() { return this.toWorld(this.anat.targets[this.root][this.side]); }

  endplatePlane() {
    const r = ROOTS[this.root];
    const v = this.plate === 'upper' ? r.upper : r.lower;
    const e = this.anat.endplates[v][this.plate === 'upper' ? 'inf' : 'sup'];
    return { name: this.plate === 'upper' ? `lower endplate of ${v}` : `upper endplate of ${v}`, n: new THREE.Vector3(...e.n) };
  }

  // signed angle (deg) between the beam and the endplate plane
  plateAngle(obl, tilt) {
    const d = this.toVolDir(this.dirFor(obl, tilt));
    return Math.asin(Math.max(-1, Math.min(1, d.dot(this.endplatePlane().n)))) / DEG;
  }

  // rotation of the view relative to the target vertebra (deg toward the injection side; 0 = true AP)
  relOblique(obl, tilt) {
    const P = this.anat.pedicles[ROOTS[this.root].upper];
    const lat = new THREE.Vector3(...P.R.c).sub(new THREE.Vector3(...P.L.c)).normalize(); // toward patient's right
    const d = this.toVolDir(this.dirFor(obl, tilt));
    const a = Math.asin(Math.max(-1, Math.min(1, d.dot(lat)))) / DEG; // + = beam toward the right
    return this.side === 'L' ? -a : a;
  }

  // Is the straight path from the skin to the target, along the beam, free of bone?
  pathClear(obl, tilt) {
    const T = this.targetVol();
    const dv = this.toVolDir(this.dirFor(obl, tilt)); // from target toward the detector (= toward the skin)
    const p = new THREE.Vector3();
    for (let s = 2; s < 200; s += 0.5) {
      p.copy(T).addScaledVector(dv, s);
      const w = p.clone().applyMatrix4(this.volToWorld);
      if (!this.tissue.inBody(w)) return { clear: true, depth: s };
      if (this.tissue.inBone(w)) return { clear: false, at: s };
    }
    return { clear: true, depth: 180 };
  }

  // nearest oblique angle (same tilt) that gives a clear path
  suggestOblique(tilt) {
    const sg = this.sideSign;
    let best = null;
    for (let o = 0; o <= 60; o += 1) {
      if (this.pathClear(sg * o, tilt).clear) {
        const d = Math.abs(sg * o - this.carm.obl);
        if (!best || d < best.d) best = { o: sg * o, d };
      }
    }
    return best ? best.o : null;
  }

  // ---- C-arm actions ----
  centre() { this.carm.iso.copy(this.targetWorld()); }

  // ---- needle tip report (mm, measured on the CT) ----
  tipReport() {
    const N = this.needle;
    if (!N || N.state !== 'skin' || N.depth < 2) return null;
    const t = N.tip().applyMatrix4(this.worldToVol);
    const r = ROOTS[this.root];
    const P = this.anat.pedicles[r.upper][this.side];
    const lateral = (this.side === 'L' ? -1 : 1) * (t.x - P.c[0]); // + = lateral to the pedicle centre (6 o'clock line)
    const below = P.zb - t.z;                                        // + = below the pedicle
    const pw = this.anat.posterior_wall_y[r.upper];
    const ant = t.y - pw;                                            // + = in front of the posterior vertebral body line
    const lowP = this.anat.pedicles[r.lower] && r.lower !== 'S1' ? this.anat.pedicles[r.lower][this.side].zt : P.zb - 18;
    const frac = (P.zb - t.z) / Math.max(5, P.zb - lowP);
    return { lateral, below, ant, frac };
  }

  // ---- checklist for the UI: [{ok: true|false|null, text}] ----
  lines() {
    const c = this.carm, out = [];
    const rel = this.relOblique(c.obl, c.tilt);
    const sideName = this.side === 'L' ? 'left' : 'right';
    out.push({ ok: null, text: `Target: ${this.root} root, ${sideName} side (${ROOTS[this.root].level}), under the ${this.root} pedicle` });

    // 1. rotation
    if (Math.abs(rel) <= 5) {
      const ok = Math.abs(rel) <= 2;
      out.push({ ok, text: ok ? `True AP of ${ROOTS[this.root].upper}: spinous process midway between the pedicles`
        : `AP: rotated ${Math.abs(rel).toFixed(1)}° toward the ${rel > 0 ? sideName : (this.side === 'L' ? 'right' : 'left')} — rotate back to centre the spinous process` });
    } else if (Math.abs(rel) <= 60) {
      out.push({ ok: null, text: `Oblique ${Math.abs(rel).toFixed(0)}° toward the ${rel > 0 ? sideName + ' (same side)' : 'other side'}` });
    }

    // 2. endplate (not in a lateral view: there the tilt only turns the picture)
    const ep = this.endplatePlane();
    const a = this.plateAngle(c.obl, c.tilt);
    const da = this.plateAngle(c.obl, c.tilt + 1) - a;
    const sq = Math.abs(a) <= 1.5;
    if (Math.abs(rel) > 60 || Math.abs(da) < 0.2) {
      out.push({ ok: null, text: 'Lateral view: check the tip depth in the foramen' });
    } else {
      const need = -a / da;                                 // degrees of tilt to square it
      out.push({ ok: sq, text: sq ? `Endplate square (${ep.name}): single line`
        : `Endplate (${ep.name}) ${Math.abs(a).toFixed(1)}° off — tilt about ${Math.abs(need).toFixed(0)}° ${need > 0 ? 'cranial' : 'caudal'}` });
    }

    // 3. oblique / path
    if (rel > 5 && rel <= 60) {
      const p = this.pathClear(c.obl, c.tilt);
      if (p.clear) {
        const L = this.needle ? this.needle.length : 89;
        out.push({ ok: true, text: `Down-the-beam path to the target is clear of bone (skin to target ${p.depth.toFixed(0)} mm${p.depth > L - 5 ? ` — longer than this ${L === 89 ? '3.5' : '5'}-inch needle${L === 89 ? ': use the 5-inch' : ''}` : ''})` });
      }
      else {
        const s = this.suggestOblique(c.tilt);
        out.push({ ok: false, text: s === null ? `Bone in the way ${p.at.toFixed(0)} mm before the target — no clear oblique at this tilt; change the tilt`
          : `Bone in the way ${p.at.toFixed(0)} mm before the target — rotate about ${Math.abs(s - c.obl).toFixed(0)}° ${(s - c.obl) * this.sideSign > 0 ? 'more' : 'less'} oblique` });
      }
    } else if (Math.abs(rel) <= 5) {
      out.push({ ok: null, text: `Then oblique toward the ${sideName} until the path under the pedicle is clear` });
    } else if (rel < -5 && rel >= -60) {
      out.push({ ok: false, text: `Obliqued toward the other side: rotate toward the ${sideName}` });
    }

    // 4. tip
    const t = this.tipReport();
    if (t) {
      const lat = t.lateral >= 0 ? `${t.lateral.toFixed(1)} mm lateral to` : `${(-t.lateral).toFixed(1)} mm MEDIAL to`;
      const bel = t.below >= 0 ? `${t.below.toFixed(1)} mm below` : `${(-t.below).toFixed(1)} mm ABOVE the lower border of`;
      out.push({ ok: t.lateral >= -1 ? null : false, text: `Tip on AP: ${bel} the pedicle, ${lat} its 6 o'clock line${t.lateral < -1 ? ' (medial: risk of dural puncture)' : ''}` });
      const third = t.frac < 0 ? 'above the foramen' : t.frac < 0.34 ? 'upper third of the foramen' : t.frac < 0.67 ? 'middle third of the foramen' : t.frac <= 1 ? 'lower third of the foramen' : 'below the foramen';
      out.push({ ok: null, text: `Tip on lateral: ${Math.abs(t.ant).toFixed(1)} mm ${t.ant >= 0 ? 'in front of' : 'behind'} the posterior vertebral body line, ${third}` });
    }
    return out;
  }
}
