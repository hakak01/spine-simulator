// Soft tissues for the see-through views: dural sac, nerve roots, arteries, veins,
// discs, muscles and the thoracolumbar fascia. Meshes come from this patient's CT
// (tools/soft_tissue.py); nerve roots and lumbar segmental arteries are modelled.
import * as THREE from 'three';

export const VIEWS = [
  { name: 'Skin', skin: 1, show: [] },
  { name: 'Fascia', skin: 0.1, show: ['fascia', 'ligament', 'psoas', 'gluteal', 'sac', 'roots', 'arteries', 'veins', 'discs', 'rectum', 'bone'] },
  { name: 'Muscles', skin: 0.1, show: ['erector', 'ligament', 'psoas', 'gluteal', 'sac', 'roots', 'arteries', 'veins', 'discs', 'rectum', 'bone'] },
  { name: 'Nerves + vessels', skin: 0.1, show: ['sac', 'ligament', 'roots', 'arteries', 'veins', 'discs', 'rectum', 'bone'] },
  { name: 'Bones', skin: 0.22, show: ['bone'] },
];

const MATS = {
  sac: { color: 0xe9dfa6, roughness: 0.5, transparent: true, opacity: 0.6, depthWrite: false },
  roots: { color: 0xf2cf3a, roughness: 0.45 },
  arteries: { color: 0xc8322b, roughness: 0.4 },
  veins: { color: 0x3558b8, roughness: 0.45 },
  discs: { color: 0xa9c9d8, roughness: 0.6 },
  erector: { color: 0x9a3a33, roughness: 0.75 },
  psoas: { color: 0xa2443b, roughness: 0.75 },
  gluteal: { color: 0x8f3630, roughness: 0.8 },
  fascia: { color: 0xe8e3d6, roughness: 0.35, metalness: 0.05 },
  ligament: { color: 0xf4f1e6, roughness: 0.4 },
  rectum: { color: 0xb86b5e, roughness: 0.6, transparent: true, opacity: 0.55, depthWrite: false },
};

export class SoftTissue {
  constructor(patient, skinMat, boneMesh) {
    this.patient = patient;
    this.skinMat = skinMat;
    this.parts = { bone: boneMesh };
    this.view = 0;
  }

  // load in the background; the app works without it
  async load(meta, fetchBin, meshGeometry) {
    const soft = meta.soft;
    if (!soft) return;
    const add = (name, geom) => {
      const m = new THREE.Mesh(geom, new THREE.MeshStandardMaterial(MATS[name] || MATS.erector));
      if (name === 'sac' || name === 'rectum') m.renderOrder = 2;
      this.parts[name] = m;
      this.patient.add(m);
    };
    await Promise.all(Object.entries(soft.files).map(async ([name, file]) => {
      try { add(name, meshGeometry(await fetchBin(`data/${file}`))); } catch (e) { console.warn('soft tissue', name, e.message); }
    }));
    // nerve roots (modelled): a tube along each root, thicker at the dorsal root ganglion
    const roots = new THREE.Group();
    const rootMat = new THREE.MeshStandardMaterial(MATS.roots);
    for (const lv of Object.values(meta.anatomy.roots)) {
      for (const pts of Object.values(lv)) {
        const P = pts.map((p) => new THREE.Vector3(...p));
        const start = P[0].clone().add(P[0].clone().sub(P[1]).setLength(4));   // begins inside the sac
        const curve = new THREE.CatmullRomCurve3([start, ...P]);
        roots.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 2.4, 8, false), rootMat));
        const drg = new THREE.Mesh(new THREE.SphereGeometry(3.6, 12, 10), rootMat);
        drg.position.copy(P[2]);
        drg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), P[3].clone().sub(P[1]).normalize());
        drg.scale.set(1, 1.7, 1);
        roots.add(drg);
        const end = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 6), rootMat);
        end.position.copy(P[P.length - 1]);
        roots.add(end);
      }
    }
    // sacral roots S1-S4 (modelled): canal -> foramen -> in front of the sacrum
    const S = meta.anatomy.sacral;
    if (S) {
      for (const lv of Object.values(S.roots)) {
        for (const pts of Object.values(lv)) {
          const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
          roots.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 1.9, 8, false), rootMat));
        }
      }
    }
    // ganglion impar and the two sympathetic trunks joining at it (modelled)
    const I = meta.anatomy.impar;
    if (I) {
      for (const pts of Object.values(I.trunks)) {
        const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
        roots.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.9, 6, false), rootMat));
      }
      const gang = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), rootMat);
      gang.position.set(...I.ganglion);
      gang.scale.set(2.2, 1.6, 3.2);   // oval, about 4 x 3 x 6 mm
      roots.add(gang);
    }
    this.parts.roots = roots;
    this.patient.add(roots);
    // sacral epidural veins (modelled), joined to the real veins
    if (S && this.parts.veins) {
      const g = new THREE.Group();
      g.add(this.parts.veins);
      for (const pts of S.veins) {
        if (pts.length < 2) continue;
        const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
        g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 6, 0.9, 6, false), this.parts.veins.material));
      }
      this.parts.veins = g;
      this.patient.add(g);
    }
    // lumbar segmental arteries (modelled), joined to the real arteries
    if (soft.lumbar_arteries && this.parts.arteries) {
      const g = new THREE.Group();
      g.add(this.parts.arteries);
      for (const lv of Object.values(soft.lumbar_arteries)) {
        for (const pts of Object.values(lv)) {
          const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
          g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 36, 1.1, 6, false), this.parts.arteries.material));
        }
      }
      this.parts.arteries = g;
      this.patient.add(g);
    }
    // median sacral artery and vein (modelled)
    if (I && I.vessels) {
      for (const [name, part] of [['artery', 'arteries'], ['vein', 'veins']]) {
        const pts = I.vessels[name];
        if (!pts || !this.parts[part]) continue;
        let g = this.parts[part];
        if (!g.isGroup) { const grp = new THREE.Group(); grp.add(g); this.patient.add(grp); this.parts[part] = g = grp; }
        const mat = g.children[0].material;
        const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
        g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 4, 0.8, 6, false), mat));
      }
    }
    this.apply();
  }

  setView(i) {
    this.view = ((i % VIEWS.length) + VIEWS.length) % VIEWS.length;
    this.apply();
    return VIEWS[this.view].name;
  }

  apply() {
    const v = VIEWS[this.view], m = this.skinMat;
    m.transparent = v.skin < 1;
    m.opacity = v.skin;
    m.depthWrite = v.skin >= 1;
    m.needsUpdate = true;
    for (const [name, obj] of Object.entries(this.parts)) {
      obj.visible = v.skin >= 1 ? name === 'bone' : v.show.includes(name);
    }
  }
}
