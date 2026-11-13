import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { DRR, toImage } from './drr.js';
import { CArm } from './carm.js';
import { setupXR } from './xr.js';
import { Tissue, Needle } from './needle.js';
import { Contrast, PATTERNS } from './contrast.js';
import { Pen } from './pen.js';

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
const state = { answer: true, lastLive: 0, k: 0.012, shots: 0, liveSec: 0, live: false, bones: false, preset: 'AP', level: 'L4-5', dirty: false, lastMove: 0, hq: true };
let drr, volToWorld, worldToVol, levels = {}, xr = null, needle = null, skinMesh = null, contrast = null, pen = null;
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
  if (contrast) drr.setContrast(contrast);
  const mk = pen && pen.xray();
  drr.setMarker(mk ? { a: mk.a.applyMatrix4(worldToVol), b: mk.b.applyMatrix4(worldToVol) } : null);
  if (needle && needle.state !== 'none') {
    const tip = needle.tip().applyMatrix4(worldToVol), hub = needle.hub().applyMatrix4(worldToVol);
    const hubEnd = hub.clone().add(hub.clone().sub(tip).normalize().multiplyScalar(20));
    drr.setNeedle({ tip, hub, hubEnd, radius: needle.radius }, 2 * carm.detR * 1000 * carm.SOD / carm.SID / size);
  } else drr.setNeedle(null);
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
  if (contrast) {
    let t = '';
    if (contrast.anim) t = `CONTRAST ${contrast.injectedML().toFixed(1)} mL`;
    else if (contrast.hidden && contrast.any) t = 'contrast hidden';
    else if (contrast.last && contrast.last.done && state.answer) {
      const P = PATTERNS[contrast.last.kind];
      t = `${P.name} ${P.ok ? '✓' : '✗'}`;
    }
    fctx.fillStyle = contrast.anim ? '#ffd27a' : '#9fe3ff';
    fctx.fillText(t, 12, fcanvas.height - 14);
  }
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

// ---------- needle ----------
const AX_X = new THREE.Vector3(1, 0, 0), AX_Z = new THREE.Vector3(0, 0, 1);
let placing = false, lastBuzz = 0, audio = null, boneFlash = 0;

function boneFeedback() { // mild buzz (Android, Quest) + soft tick (all phones)
  const now = performance.now();
  boneFlash = now;
  if (now - lastBuzz < 180) return;
  lastBuzz = now;
  if (navigator.vibrate) navigator.vibrate(30);
  if (xr) xr.buzz(0.3, 50);
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 140; g.gain.setValueAtTime(0.12, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.06);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.07);
  } catch (e) { /* no sound */ }
}

// ---------- contrast ----------
function injectContrast() {
  if (!contrast || contrast.anim) return;
  if (!needle || needle.state !== 'skin' || needle.depth < 2) {
    $('cread').textContent = 'Put the needle tip in the patient first.';
    $('cread').className = '';
    return;
  }
  const r = contrast.inject(needle.tip());
  if (!r) { $('cread').textContent = 'Contrast cannot spread from here.'; return; }
  $('c-hide').classList.remove('on');
  state.lastLive = 0;
  contrastReadout();
}
function toggleHideContrast() {
  if (!contrast) return;
  contrast.hidden = !contrast.hidden;
  $('c-hide').classList.toggle('on', contrast.hidden);
  makeImage(512, 0.75);
  contrastReadout();
}
function clearContrast() {
  if (!contrast) return;
  contrast.clear();
  $('c-hide').classList.remove('on');
  makeImage(512, 0.75);
  contrastReadout();
}
function contrastReadout() {
  const el = $('cread');
  el.className = '';
  if (!contrast || !contrast.last) { el.textContent = ''; return; }
  if (contrast.anim) { el.textContent = `Injecting contrast under live fluoro… ${contrast.injectedML().toFixed(1)} / 1.0 mL`; return; }
  if (!state.answer) { el.textContent = 'Contrast done. Read the pattern yourself (answer hidden).'; return; }
  const P = PATTERNS[contrast.last.kind];
  el.className = P.ok ? 'ok' : 'bad';
  el.textContent = `${P.name} ${P.ok ? '✓' : '✗'} — ${P.text}`
    + (contrast.last.randomVascular ? ' (Random vascular uptake: it can happen even with a good tip position.)' : '');
}
$('c-inject').addEventListener('click', injectContrast);
$('c-hide').addEventListener('click', toggleHideContrast);
$('c-clear').addEventListener('click', clearContrast);
$('c-answer').addEventListener('click', () => {
  state.answer = !state.answer;
  $('c-answer').classList.toggle('on', state.answer);
  contrastReadout();
  makeImage(512, 0.75);
});

function needleChanged() {
  state.lastMove = performance.now();
  if (state.live) { state.dirty = true; state.hq = false; }
  needleReadout();
}

function needleReadout() {
  const el = $('nread');
  if (!needle || needle.state === 'none') {
    el.textContent = placing ? 'Now tap the patient\'s back to choose the skin entry point.' : 'Tap "Place on skin", then tap the patient\'s back.';
    el.classList.remove('bone');
    return;
  }
  const a = needle.angles();
  const ang = (v, pos, neg) => (Math.abs(v) < 0.5 ? '' : `${Math.abs(v).toFixed(0)}° ${v > 0 ? pos : neg}`);
  const parts = [ang(a.cranial, 'to head', 'to feet'), ang(a.left, 'to left', 'to right')].filter(Boolean).join(', ') || 'straight down';
  let t = `Depth ${needle.depth.toFixed(1)} mm of ${needle.length}  ·  ${parts}  ·  skin punctures ${needle.punctures}`;
  if (needle.boneContact) t += '  ·  BONE CONTACT';
  else if (needle.depth >= needle.length - 0.01) t += '  ·  hub at skin';
  else if (needle.depth > 15) t += '  ·  deep: angle changes are small';
  el.textContent = t;
  el.classList.toggle('bone', needle.boneContact);
}

function setPlacing(on) {
  placing = on;
  $('n-place').classList.toggle('on', on);
  $('n-place').classList.toggle('arm', on);
  needleReadout();
}

function placeNeedleAt(point, normal) { // world point on the skin, outward normal
  const inward = normal.clone().negate();
  let d = carm.dir().negate();               // along the beam, toward the tube ("down the beam")
  if (d.dot(inward) < 0.25) d = inward;
  needle.place(point, d);
  setPlacing(false);
}

function tapSkin(clientX, clientY) {
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  const hit = rc.intersectObject(skinMesh, false)[0];
  if (!hit) return false;
  const n = hit.face.normal.clone().transformDirection(skinMesh.matrixWorld);
  placeNeedleAt(hit.point, n);
  return true;
}

const TAP = { // [first tap, per second while held]
  in1: [() => needle.advance(1), (dt) => needle.advance(10 * dt)],
  out1: [() => needle.advance(-1), (dt) => needle.advance(-10 * dt)],
  in5: [() => needle.advance(5), null],
  out5: [() => needle.advance(-5), null],
  aimCr: [() => needle.rotate(AX_Z, -1), (dt) => needle.rotate(AX_Z, -12 * dt)],
  aimCa: [() => needle.rotate(AX_Z, 1), (dt) => needle.rotate(AX_Z, 12 * dt)],
  aimL: [() => needle.rotate(AX_X, -1), (dt) => needle.rotate(AX_X, -12 * dt)],
  aimR: [() => needle.rotate(AX_X, 1), (dt) => needle.rotate(AX_X, 12 * dt)],
};
const heldTap = new Set();
document.querySelectorAll('[data-tap]').forEach((b) => {
  const k = b.dataset.tap;
  let timer = 0;
  const stop = () => { clearTimeout(timer); heldTap.delete(k); };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!needle || needle.state !== 'skin') { needleReadout(); return; }
    TAP[k][0]();
    if (TAP[k][1]) timer = setTimeout(() => heldTap.add(k), 400);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, stop));
});
$('n-place').addEventListener('click', () => setPlacing(!placing));
$('n-remove').addEventListener('click', () => { needle.remove(); setPlacing(false); });
$('n-beam').addEventListener('click', () => {
  if (needle.state !== 'skin') return;
  if (needle.depth > 15) { $('nread').textContent = 'Too deep to re-aim. Withdraw to under 15 mm first.'; return; }
  needle.aim(carm.dir().negate());
});
$('n-len').addEventListener('click', () => {
  needle.setLength(needle.length === 89 ? 127 : 89);
  $('n-len').textContent = needle.length === 89 ? 'Needle 3.5 in' : 'Needle 5 in';
});
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((o) => o.classList.toggle('sel', o === b));
  ['carm', 'needle', 'mark'].forEach((t) => $(`tab-${t}`).classList.toggle('hide', b.dataset.tab !== t));
  if (b.dataset.tab !== 'needle') setPlacing(false);
  if (b.dataset.tab !== 'mark') setPenMode(false);
}));

// ---------- marker pen (phone) ----------
let penMode = false;
function setPenMode(on) {
  penMode = on;
  $('p-pen').classList.toggle('on', on);
  controls.enableRotate = !on;          // one finger draws; two fingers still zoom and pan
  if (on) setPlacing(false);
  penReadout();
}
function penReadout(msg) {
  if (msg) { $('pread').textContent = msg; return; }
  $('pread').textContent = penMode
    ? 'Tap the skin: the metal pen tip rests there (take a SHOT to see it). Drag on the skin: draw. Two fingers: zoom / move the view.'
    : 'Turn the pen on. Tap the skin to rest its metal tip there (it shows on the C-arm image). Drag on the skin to draw.';
}
function skinHit(clientX, clientY) {
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  const hit = rc.intersectObject(skinMesh, false)[0];
  if (!hit) return null;
  return { point: hit.point, normal: hit.face.normal.clone().transformDirection(skinMesh.matrixWorld) };
}
function penMoved() {
  state.lastMove = performance.now();
  if (state.live) { state.dirty = true; state.hq = false; }
}
(function penTouch() {
  const el = renderer.domElement;
  const pointers = new Set();
  let drawing = false;
  el.addEventListener('pointerdown', (e) => {
    pointers.add(e.pointerId);
    if (!penMode || !pen) return;
    if (pointers.size > 1) { drawing = false; pen.lift(); return; }
    const h = skinHit(e.clientX, e.clientY);
    if (!h) return;
    drawing = true;
    pen.lift();
    pen.setPose(h.point, h.normal.clone().negate(), 'rest');
  });
  el.addEventListener('pointermove', (e) => {
    if (!drawing || pointers.size > 1) return;
    const h = skinHit(e.clientX, e.clientY);
    if (!h) { pen.lift(); return; }
    pen.setPose(h.point, h.normal.clone().negate(), 'rest');
    pen.dot(h.point, h.normal);
  });
  const up = (e) => { pointers.delete(e.pointerId); if (drawing) { drawing = false; pen.lift(); } };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => el.addEventListener(ev, up));
})();
$('p-pen').addEventListener('click', () => setPenMode(!penMode));
$('p-cross').addEventListener('click', () => {
  if (!pen || !pen.markAtTip()) penReadout('Rest the pen tip on the skin first (Pen on, then tap the skin).');
  else penReadout('Marked. Take a SHOT: the mark is ink, so only the metal pen tip shows on the C-arm.');
});
$('p-erase').addEventListener('click', () => { if (pen) pen.clearInk(); });
$('p-away').addEventListener('click', () => { if (pen) pen.hide(); setPenMode(false); });
// a tap (not a drag) on the 3D view places the needle
(function tapToPlace() {
  let down = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  el.addEventListener('pointerup', (e) => {
    if (!down || !placing || !needle) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved < 8 && performance.now() - down.t < 600) tapSkin(e.clientX, e.clientY);
    down = null;
  });
})();

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
  heldTap.forEach((k) => TAP[k][1](dt));
  if (xr) xr.update(dt);
  if (contrast && contrast.anim) { // contrast injection: live fluoro until it settles
    contrast.update(dt);
    state.liveSec += dt;
    if (!contrast.anim) { makeImage(512, 0.75); contrastReadout(); readout(); }
    else if (now - state.lastLive > 70) { makeImage(256, 1.2); state.lastLive = now; contrastReadout(); }
  } else if (drr && state.live) {
    state.liveSec += dt;
    if (state.dirty && now - state.lastLive > 70) { makeImage(256, 1.2); state.dirty = false; state.lastLive = now; }
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
    const [ct, skinBuf, boneBuf, labels] = await Promise.all([
      fetchBin('data/ct_u8.bin.gz'), fetchBin('data/skin.bin.gz'), fetchBin('data/bone.bin.gz'), fetchBin('data/labels_u8.bin.gz')]);
    const [nx, ny, nz] = meta.dims;
    if (ct.length !== nx * ny * nz || labels.length !== ct.length) throw new Error('CT data size is wrong.');
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
    skinMesh = new THREE.Mesh(skinG, skinMat);
    patient.add(skinMesh, new THREE.Mesh(boneG, boneMat));
    scene.add(patient);
    patient.updateMatrixWorld(true);

    needle = new Needle(new Tissue(ct, labels, meta, worldToVol));
    needle.onBone = boneFeedback;
    needle.onChange = needleChanged;
    contrast = new Contrast(needle.tissue, meta);
    pen = new Pen(needle.tissue);
    pen.onChange = penMoved;
    scene.add(pen.model, pen.ink);
    scene.add(needle.model);

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
      canvas: fcanvas, shot, moveCArm, panCArm, toggleLive, toggleBones, needle,
      injectContrast, toggleHideContrast, clearContrast, pen,
      tray: new THREE.Vector3(0.38, TABLE_TOP + 0.03, MIDLINE_Z + 0.36),
      togglePreset: () => setPreset(state.preset === 'AP' ? 'LAT' : 'AP'),
      onXR: () => {},
    });
    loading.classList.add('hide');
    window.sim = { xr, pen, setPenMode, skinHit, contrast, injectContrast, toggleHideContrast, clearContrast, needle, tapSkin, placeNeedleAt, setPlacing, renderer, scene, camera, carm, shot, setPreset, goLevel, moveCArm, panCArm, toggleBones, toggleLive, levels, state, makeImage };
  } catch (e) {
    loading.textContent = `Could not start: ${e.message}`;
    console.error(e);
  }
}

renderer.setAnimationLoop(tick);
start();
