import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { DRR, toImage } from './drr.js';
import { CArm } from './carm.js';
import { setupXR } from './xr.js';

const $ = (id) => document.getElementById(id);
const loading = $('loading');

// ---------- data loading ----------
async function fetchBin(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  let buf = new Uint8Array(await r.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) { // gzip (server did not unpack it)
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    buf = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return buf;
}

function meshGeometry(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset);
  const nv = dv.getUint32(0, true), nf = dv.getUint32(4, true);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ab, 8, nv * 3), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(ab, 8 + nv * 12, nf * 3), 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

// ---------- 3D scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
$('view3d').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d232b);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.02, 20);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1, 3, 2);
scene.add(sun);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0x2a3038 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const TABLE_TOP = 0.8, MIDLINE_Z = -0.45;
const table = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 0.52), new THREE.MeshStandardMaterial({ color: 0x3b4655 }));
table.position.set(0, TABLE_TOP - 0.025, MIDLINE_Z);
const pad = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.012, 0.5), new THREE.MeshStandardMaterial({ color: 0x5a6b7c }));
pad.position.set(0, TABLE_TOP - 0.006, MIDLINE_Z);
const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, TABLE_TOP - 0.05, 0.3), new THREE.MeshStandardMaterial({ color: 0x2f3742 }));
leg.position.set(0.6, (TABLE_TOP - 0.05) / 2, MIDLINE_Z);
scene.add(table, pad, leg);

const skinMat = new THREE.MeshStandardMaterial({ color: 0xd8a58a, roughness: 0.75 });
const boneMat = new THREE.MeshStandardMaterial({ color: 0xefe6d0, roughness: 0.55 });

const carm = new CArm();
scene.add(carm.model);

// ---------- state ----------
const state = { k: 0.012, shots: 0, liveSec: 0, live: false, bones: false, preset: 'AP', level: 'L4-5', dirty: false, lastMove: 0, hq: true };
let drr, volToWorld, worldToVol, levels = {}, xr = null;
const fcanvas = $('fluoro');
const fctx = fcanvas.getContext('2d');
const off = document.createElement('canvas');

function setCamera() {
  camera.position.set(carm.iso.x + 0.35, carm.iso.y + 0.95, carm.iso.z + 1.25);
  controls.target.copy(carm.iso);
  controls.update();
}

// ---------- C-arm image ----------
function volFrame() {
  const f = carm.frame();
  const lin = new THREE.Matrix3().setFromMatrix4(worldToVol);
  return {
    src: f.src.applyMatrix4(worldToVol), detC: f.detC.applyMatrix4(worldToVol),
    detU: f.detU.applyMatrix3(lin), detV: f.detV.applyMatrix3(lin),
  };
}

function makeImage(size, step) {
  const sums = drr.render(volFrame(), size, step);
  const img = toImage(sums, size, { flip: carm.flip, k: state.k });
  off.width = size; off.height = size;
  off.getContext('2d').putImageData(img, 0, 0);
  fctx.imageSmoothingEnabled = true;
  fctx.drawImage(off, 0, 0, fcanvas.width, fcanvas.height);
  fctx.font = '600 17px system-ui, sans-serif';
  fctx.fillStyle = '#9fe3ff';
  fctx.fillText(carm.label(), 12, 24);
  fctx.textAlign = 'right';
  fctx.fillText(state.live ? 'LIVE' : `#${state.shots}`, fcanvas.width - 12, 24);
  fctx.fillText(carm.flip ? 'flipped' : '', fcanvas.width - 12, fcanvas.height - 12);
  fctx.textAlign = 'left';
  if (xr) xr.onImage();
}

function shot() {
  state.shots++;
  makeImage(512, 0.75);
  readout();
}

// ---------- C-arm movement ----------
function changed() {
  carm.updateModel();
  state.lastMove = performance.now();
  if (state.live) { state.dirty = true; state.hq = false; }
  readout();
}
function moveCArm(dObl, dTilt) {
  carm.obl = Math.max(-95, Math.min(95, carm.obl + dObl));
  carm.tilt = Math.max(-45, Math.min(45, carm.tilt + dTilt));
  changed();
}
function panCArm(dx, dy) { // move the field of view right / up on the screen
  const f = carm.frame();
  const sx = carm.flip ? -1 : 1;
  carm.iso.addScaledVector(f.detU.normalize(), dx * sx).addScaledVector(f.detV.normalize(), dy);
  changed();
}
function setPreset(p) {
  state.preset = p;
  if (p === 'AP') { carm.obl = 0; carm.tilt = 0; }
  if (p === 'LAT') { carm.obl = -90; carm.tilt = 0; }
  if (p === 'OBLL') { carm.obl = 25; }
  if (p === 'OBLR') { carm.obl = -25; }
  changed();
}
function goLevel(name) {
  state.level = name;
  carm.iso.copy(levels[name]);
  document.querySelectorAll('#levels button').forEach((b) => b.classList.toggle('sel', b.dataset.level === name));
  changed();
}
function toggleLive() {
  state.live = !state.live;
  $('live').classList.toggle('on', state.live);
  if (state.live) { state.dirty = true; state.hq = false; }
  readout();
}
function toggleBones() {
  state.bones = !state.bones;
  $('bones').classList.toggle('on', state.bones);
  skinMat.transparent = state.bones;
  skinMat.opacity = state.bones ? 0.22 : 1;
  skinMat.depthWrite = !state.bones;
  skinMat.needsUpdate = true;
}
function readout() {
  $('readout').textContent = `${carm.label()}  ·  centre: ${state.level}  ·  shots ${state.shots}  ·  live ${state.liveSec.toFixed(1)} s`;
}

// hold-to-repeat buttons
const HOLD = {
  'obl-1': (dt) => moveCArm(-25 * dt, 0), obl1: (dt) => moveCArm(25 * dt, 0),
  tilt1: (dt) => moveCArm(0, 18 * dt), 'tilt-1': (dt) => moveCArm(0, -18 * dt),
  panL: (dt) => panCArm(-0.05 * dt, 0), panR: (dt) => panCArm(0.05 * dt, 0),
  panU: (dt) => panCArm(0, 0.05 * dt), panD: (dt) => panCArm(0, -0.05 * dt),
};
const held = new Set();
document.querySelectorAll('[data-hold]').forEach((b) => {
  const k = b.dataset.hold;
  const on = (e) => { e.preventDefault(); held.add(k); HOLD[k](0.04); };
  const offH = () => held.delete(k);
  b.addEventListener('pointerdown', on);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, offH));
});
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => setPreset(b.dataset.act)));
$('shot').addEventListener('click', shot);
$('live').addEventListener('click', toggleLive);
$('bones').addEventListener('click', toggleBones);
$('flip').addEventListener('click', () => { carm.flip = !carm.flip; $('flip').classList.toggle('on', carm.flip); makeImage(512, 0.75); });
$('cam').addEventListener('click', setCamera);
$('fold').addEventListener('click', () => {
  const min = $('dock').classList.toggle('min');
  $('fold').textContent = min ? '▴ More' : '▾ Less';
});

// keyboard (desktop)
window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === ' ') { e.preventDefault(); shot(); }
  else if (k === 'ArrowLeft') moveCArm(-2, 0);
  else if (k === 'ArrowRight') moveCArm(2, 0);
  else if (k === 'ArrowUp') moveCArm(0, 2);
  else if (k === 'ArrowDown') moveCArm(0, -2);
  else if (k === 'l') toggleLive();
  else if (k === 'b') toggleBones();
});

// ---------- movable / resizable C-arm screen ----------
(function monitorUI() {
  const mon = $('monitor');
  const saved = (() => { try { return JSON.parse(localStorage.getItem('monitorPos') || 'null'); } catch (e) { return null; } })();
  const place = (x, y, w) => {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (w) mon.style.width = `${Math.max(140, Math.min(w, vw - 8, vh - 40))}px`;
    const r = mon.getBoundingClientRect();
    mon.style.left = `${Math.max(0, Math.min(x, vw - r.width))}px`;
    mon.style.top = `${Math.max(0, Math.min(y, vh - 60))}px`;
    mon.style.right = 'auto';
  };
  const save = () => {
    const r = mon.getBoundingClientRect();
    try { localStorage.setItem('monitorPos', JSON.stringify({ x: r.left, y: r.top, w: r.width })); } catch (e) { /* ignore */ }
  };
  if (saved) place(saved.x, saved.y, saved.w);
  let drag = null;
  $('monbar').addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    const r = mon.getBoundingClientRect();
    drag = { mode: 'move', dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  });
  $('monresize').addEventListener('pointerdown', (e) => {
    const r = mon.getBoundingClientRect();
    drag = { mode: 'size', x0: e.clientX, w0: r.width };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  });
  const move = (e) => {
    if (!drag) return;
    const r = mon.getBoundingClientRect();
    if (drag.mode === 'move') place(e.clientX - drag.dx, e.clientY - drag.dy);
    else place(r.left, r.top, drag.w0 + (e.clientX - drag.x0));
  };
  const end = () => { if (drag) save(); drag = null; };
  ['monbar', 'monresize'].forEach((id) => {
    $(id).addEventListener('pointermove', move);
    $(id).addEventListener('pointerup', end);
    $(id).addEventListener('pointercancel', end);
  });
  $('mon-max').addEventListener('click', () => {
    mon.classList.toggle('max');
    mon.style.width = '';
    const r = mon.getBoundingClientRect();
    place(r.left, r.top);
    save();
  });
  window.addEventListener('resize', () => { const r = mon.getBoundingClientRect(); place(r.left, r.top); });
})();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- main loop ----------
let last = performance.now();
function tick() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  held.forEach((k) => HOLD[k](dt));
  if (xr) xr.update(dt);
  if (drr && state.live) {
    state.liveSec += dt;
    if (state.dirty) { makeImage(256, 1.2); state.dirty = false; }
    else if (!state.hq && now - state.lastMove > 350) { makeImage(512, 0.75); state.hq = true; }
    if (Math.round(state.liveSec * 10) % 5 === 0) readout();
  }
  if (!renderer.xr.isPresenting) controls.update();
  renderer.render(scene, camera);
}

// ---------- start ----------
async function start() {
  try {
    if (!renderer.capabilities.isWebGL2) throw new Error('This browser has no WebGL2.');
    loading.textContent = 'Loading CT scan…';
    const meta = await (await fetch('data/ct.json')).json();
    const [ct, skinBuf, boneBuf] = await Promise.all([
      fetchBin('data/ct_u8.bin.gz'), fetchBin('data/skin.bin.gz'), fetchBin('data/bone.bin.gz')]);
    const [nx, ny, nz] = meta.dims;
    if (ct.length !== nx * ny * nz) throw new Error('CT data size is wrong.');
    const tex = new THREE.Data3DTexture(ct, nx, ny, nz);
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;

    const skinG = meshGeometry(skinBuf), boneG = meshGeometry(boneBuf);
    // CT frame (mm; +x right, +y anterior, +z superior) -> world (m; patient prone, head toward -X)
    const lm = meta.landmarks;
    const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
    const s = 0.001, ref = mid(lm.L4, lm.L5), ymax = skinG.boundingBox.max.y;
    volToWorld = new THREE.Matrix4().set(
      0, 0, -s, s * ref[2],
      0, -s, 0, TABLE_TOP + s * ymax,
      -s, 0, 0, MIDLINE_Z + s * ref[0],
      0, 0, 0, 1);
    worldToVol = volToWorld.clone().invert();
    const patient = new THREE.Group();
    patient.matrixAutoUpdate = false;
    patient.matrix.copy(volToWorld);
    patient.add(new THREE.Mesh(skinG, skinMat), new THREE.Mesh(boneG, boneMat));
    scene.add(patient);

    const W = (p) => new THREE.Vector3(...p).applyMatrix4(volToWorld);
    levels = {
      'L3-4': W(mid(lm.L3, lm.L4)), 'L4-5': W(mid(lm.L4, lm.L5)), 'L5-S1': W(mid(lm.L5, lm.S1)),
      Caudal: W(lm.sacral_hiatus), Impar: W(lm.sacrococcygeal),
    };
    const lv = $('levels');
    Object.keys(levels).forEach((name) => {
      const b = document.createElement('button');
      b.textContent = name; b.dataset.level = name;
      b.addEventListener('click', () => goLevel(name));
      lv.appendChild(b);
    });

    drr = new DRR(renderer, tex, meta);
    goLevel('L4-5');
    setCamera();
    shot();
    state.shots = 0;
    readout();
    xr = await setupXR(renderer, scene, {
      canvas: fcanvas, shot, moveCArm, panCArm, toggleLive, toggleBones,
      togglePreset: () => setPreset(state.preset === 'AP' ? 'LAT' : 'AP'),
      onXR: () => {},
    });
    loading.classList.add('hide');
    window.sim = { carm, shot, setPreset, goLevel, moveCArm, panCArm, toggleBones, toggleLive, levels, state, makeImage };
  } catch (e) {
    loading.textContent = `Could not start: ${e.message}`;
    console.error(e);
  }
}

renderer.setAnimationLoop(tick);
start();
