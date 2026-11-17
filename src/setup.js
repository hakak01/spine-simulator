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
    this.proc = 'tfesi';      // 'tfesi' (transforaminal) | 'caudal'
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
  centre() { this.carm.iso.copy(this.proc === 'caudal' ? this.hiatusWorld() : this.targetWorld()); }

  // ---- caudal ----
  // C-arm centre for the caudal block: midline, at the sacral canal, at the hiatus
  hiatusWorld() {
    const S = this.anat.sacral;
    return this.toWorld([S.midline_x, S.hiatus_centre[1], S.hiatus_centre[2]]);
  }

  // distance (mm) along the sacral canal from the tip up to the end of the dural sac (+ = tip below the sac),
  // measured along a smoothed canal centre line (side view: height and depth)
  belowSac(t) {
    const S = this.anat.sacral;
    const raw = S.canal_axis.map((p) => [p[1], p[2]]);
    const ax = raw.map((p, i) => {
      const a = raw[Math.max(0, i - 1)], c = raw[Math.min(raw.length - 1, i + 1)];
      return [(a[0] + p[0] + c[0]) / 3, (a[1] + p[1] + c[1]) / 3];
    });
    ax.push([S.sac_end[1], S.sac_end[2]]);
    if (t.z >= S.sac_end[2]) return -(t.z - S.sac_end[2]);
    let best = 0, bd = 1e9;
    for (let i = 0; i < ax.length; i++) { const d = Math.hypot(ax[i][0] - t.y, ax[i][1] - t.z); if (d < bd) { bd = d; best = i; } }
    let s = 0;
    for (let i = best; i < ax.length - 1; i++) s += Math.hypot(ax[i + 1][0] - ax[i][0], ax[i + 1][1] - ax[i][1]);
    return s;
  }

  sacralLevel(z) {
    const L = this.anat.sacral.level_z, names = Object.keys(L);
    const low = Math.min(...names.map((n) => L[n]));
    if (z < low - 12) return 'S5';
    return names.reduce((a, b) => (Math.abs(L[a] - z) <= Math.abs(L[b] - z) ? a : b));
  }

  caudalLines() {
    const c = this.carm, out = [], S = this.anat.sacral;
    out.push({ ok: null, text: `Caudal epidural: through the sacral hiatus (apex at about ${this.sacralLevel(S.hiatus_apex[2])} here); the dural sac ends at ${this.sacralLevel(S.sac_end[2])}` });
    // view: relative to the S1 pedicles (true lateral = beam along the line between them)
    const P = this.anat.pedicles.S1;
    const lat = new THREE.Vector3(...P.R.c).sub(new THREE.Vector3(...P.L.c)).normalize();
    const d = this.toVolDir(this.dirFor(c.obl, c.tilt));
    const rel = Math.asin(Math.max(-1, Math.min(1, Math.abs(d.dot(lat))))) / DEG;   // 0 = AP, 90 = lateral
    const centred = this.carm.iso.distanceTo(this.hiatusWorld()) < 0.03;
    if (rel >= 75) out.push({ ok: rel >= 82, text: rel >= 82 ? 'Lateral of the sacrum: hiatus and canal seen side on' : `Lateral, ${(90 - rel).toFixed(0)}° off true: rotate the C-arm a little` });
    else if (rel <= 5) out.push({ ok: null, text: 'AP view: use it to check the needle stays in the midline' });
    else out.push({ ok: false, text: 'Use a lateral view to find the hiatus and judge depth, AP to check the midline' });
    out.push({ ok: centred, text: centred ? 'Centred on the sacral hiatus' : 'Centre the C-arm on the hiatus (CENTRE)' });
    const N = this.needle;
    if (!N || N.state !== 'skin' || N.depth < 1) {
      out.push({ ok: null, text: 'Enter just below the hiatus at about 45°, through the sacrococcygeal ligament into the canal. To flatten the needle you must be under 15 mm deep (needle rules); otherwise start lower and flatter' });
      return out;
    }
    const tw = N.tip(), t = tw.clone().applyMatrix4(this.worldToVol);
    const lab = this.tissue.label(tw);
    const kind = this.classify ? this.classify(tw) : '';     // same rule as the contrast
    let where;
    if (kind === 'intrathecal' || kind === 'subdural' || lab === 3) where = { ok: false, text: 'Tip IN THE DURAL SAC: withdraw now' };
    else if (N.boneContact) where = { ok: false, text: 'Tip on bone: withdraw 1-2 mm before injecting' };
    else if (kind === 'caudal') where = { ok: true, text: 'Tip in the sacral canal (epidural)' };
    else if (lab === 15) where = { ok: false, text: 'Tip in the sacrococcygeal ligament: advance 1-2 mm' };
    else where = { ok: false, text: 'Tip behind the sacrum (subcutaneous): it is not in the hiatus' };
    out.push(where);
    const b = this.belowSac(t);
    out.push({ ok: b > 10, text: b > 0 ? `Tip ${b.toFixed(0)} mm below the end of the dural sac, at ${this.sacralLevel(t.z)} level${b <= 10 ? ': too close, withdraw' : ''}` : `Tip ${(-b).toFixed(0)} mm ABOVE the end of the dural sac: withdraw` });
    const inCanal = this.canalMM ? this.canalMM() : 0;
    if (inCanal > 0) out.push({ ok: inCanal <= 5 ? true : null, text: `${inCanal.toFixed(0)} mm of needle up the canal${inCanal > 5 ? ' (deeper = more vascular uptake: 20 % vs 3 % just past the ligament, Park 2018)' : ''}` });
    out.push({ ok: Math.abs(t.x - S.midline_x) <= 5 ? null : false, text: `Tip ${Math.abs(t.x - S.midline_x).toFixed(0)} mm ${t.x - S.midline_x > 0 ? 'right' : 'left'} of the midline (on AP)` });
    return out;
  }

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
    if (this.proc === 'caudal') return this.caudalLines();
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
