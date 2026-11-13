// Quest 3 VR: movable C-arm screen, C-arm on the left stick, hand-held needle,
// marker pen, and in-VR buttons (EXIT VR, ERASE INK).
import * as THREE from 'three';
import { VRButton } from 'three/addons/VRButton.js';
import { VRPanel } from './vrpanel.js';

const HAND_OFFSET = 0.03; // needle hub sits this far in front of the controller (m)
const PEN_REACH = 0.075;  // pen tip this far in front of the controller (m)

// A row of buttons on a plane, clicked with a controller ray + trigger.
function buttonBar(defs, width, height) {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = Math.round(1024 * height / width);
  const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  const bar = { mesh, defs, hover: null, labels: {} };
  const w = cv.width / defs.length;
  bar.draw = () => {
    g.clearRect(0, 0, cv.width, cv.height);
    defs.forEach((d, i) => {
      const x = i * w + 8, y = 8, bw = w - 16, bh = cv.height - 16;
      g.fillStyle = bar.hover === d.id ? d.hot : d.bg;
      g.strokeStyle = '#ffffff'; g.lineWidth = bar.hover === d.id ? 8 : 3;
      g.beginPath(); g.roundRect(x, y, bw, bh, 22); g.fill(); g.stroke();
      g.fillStyle = '#ffffff';
      g.font = `bold ${Math.round(bh * 0.36)}px sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(bar.labels[d.id] || d.label, x + bw / 2, y + bh / 2);
    });
    tex.needsUpdate = true;
  };
  bar.at = (uv) => defs[Math.min(defs.length - 1, Math.floor(uv.x * defs.length))].id;
  bar.draw();
  return bar;
}

export async function setupXR(renderer, scene, ctx) {
  if (!('xr' in navigator)) return null;
  let ok = false;
  try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) { ok = false; }
  if (!ok) return null;
  renderer.xr.enabled = true;
  const btn = VRButton.createButton(renderer);
  btn.id = 'vrbutton';
  document.body.appendChild(btn);
  const needle = ctx.needle;

  // ----- C-arm screen -----
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const help = document.createElement('canvas');
  help.width = 1024; help.height = 408;
  const hctx = help.getContext('2d');
  hctx.fillStyle = '#11161c'; hctx.fillRect(0, 0, 1024, 408);
  hctx.fillStyle = '#cfe8ff'; hctx.font = '27px sans-serif';
  [
    'LEFT stick: rotate / tilt C-arm (hold left trigger: move it)',
    'X: shot    Y: AP / LAT    A: live on/off    B: show bones',
    'GRIP: pick up the needle. Push it into the back like a real one.',
    'Needle left in the patient: RIGHT stick = fine advance / withdraw',
    'Curved tip: TWIST your wrist while holding the needle to turn the hub',
    'RIGHT TRIGGER: inject contrast (1 mL, live fluoro)',
    'Right stick click: hide / show contrast   Left stick click: clear it',
    'PEN on the tray: grip near it, touch the skin to draw (metal tip shows)',
    'Screen: point + hold GRIP to move it. Buttons + setup sliders: point + TRIGGER',
  ].forEach((t, i) => hctx.fillText(t, 20, 40 + i * 43));
  const helpTex = new THREE.CanvasTexture(help);
  helpTex.colorSpace = THREE.SRGBColorSpace;

  const monitor = new THREE.Group();
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.94, 0.03), new THREE.MeshStandardMaterial({ color: 0x20262e }));
  bezel.position.set(0, -0.16, -0.017);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.52), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.y = 0.03;
  const helpPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.207), new THREE.MeshBasicMaterial({ map: helpTex }));
  helpPlane.position.y = -0.35;
  monitor.add(bezel, screen, helpPlane);

  // ----- in-VR buttons: on the screen and on the left wrist -----
  const DEFS = [
    { id: 'exit', label: 'EXIT VR', bg: '#9b2b22', hot: '#e0473a' },
    { id: 'erase', label: 'ERASE INK', bg: '#3c4654', hot: '#5d6c80' },
    { id: 'curve', label: 'CURVE: OFF', bg: '#3c4654', hot: '#5d6c80' },
  ];
  const monBar = buttonBar(DEFS, 0.52, 0.07);
  monBar.mesh.position.set(0, -0.505, 0.001);
  monitor.add(monBar.mesh);
  const wristBar = buttonBar(DEFS, 0.21, 0.04);
  wristBar.mesh.position.set(0, 0.035, 0.03);
  wristBar.mesh.rotation.x = -Math.PI / 3;
  const bars = [monBar, wristBar];
  let exitArmed = 0;
  function press(id) {
    if (id === 'exit') {
      const now = performance.now();
      if (now - exitArmed < 4000) { const s = renderer.xr.getSession(); if (s) s.end(); return; }
      exitArmed = now;
      bars.forEach((b) => { b.labels.exit = 'PRESS AGAIN'; b.draw(); });
      setTimeout(() => { bars.forEach((b) => { b.labels.exit = null; b.draw(); }); }, 4000);
    } else if (id === 'erase') {
      pen.clearInk();
    } else if (id === 'curve') {
      ctx.setCurved(!needle.curved);
    }
  }

  // ----- C-arm setup panel (left of the screen; moves with it) -----
  const panel = new VRPanel(768, 1180, 0.4);
  panel.title = 'C-ARM SETUP  (transforaminal)';
  const fmtDeg = (pos, neg) => (v) => (Math.abs(v) < 0.25 ? '0°' : `${Math.abs(v).toFixed(1)}° ${v > 0 ? pos : neg}`);
  ['L3', 'L4', 'L5'].forEach((r, i) => panel.button(`root${r}`, 24 + i * 112, 72, 100, 62, `${r} root`, () => ctx.setRoot(r), () => ctx.setup.root === r));
  panel.button('sideL', 400, 72, 160, 62, 'LEFT', () => ctx.setSide('L'), () => ctx.setup.side === 'L');
  panel.button('sideR', 580, 72, 160, 62, 'RIGHT', () => ctx.setSide('R'), () => ctx.setup.side === 'R');
  panel.slider('tilt', 50, 200, 668, 50, 'Tilt', -45, 45, () => ctx.carm.tilt, (v) => ctx.setTilt(Math.round(v * 2) / 2), fmtDeg('cranial', 'caudal'));
  panel.slider('obl', 50, 310, 668, 50, 'Oblique', -95, 95, () => ctx.carm.obl, (v) => ctx.setObl(Math.round(v * 2) / 2), fmtDeg('left', 'right'));
  panel.slider('pos', 50, 420, 668, 50, 'Along the spine', -100, 100, () => ctx.along(), (v) => ctx.setAlong(Math.round(v)),
    (v) => `${Math.abs(v).toFixed(0)} mm ${v >= 0 ? 'head' : 'feet'}`);
  panel.button('centre', 24, 500, 170, 70, 'CENTRE', () => ctx.setupCentre());
  panel.button('apcheck', 208, 500, 170, 70, 'AP CHECK', () => ctx.setupCheck('AP'));
  panel.button('latcheck', 392, 500, 170, 70, 'LAT CHECK', () => ctx.setupCheck('LAT'));
  panel.button('shot', 576, 500, 168, 70, 'SHOT', () => ctx.shot());
  panel.button('plate', 24, 584, 720, 56, '', () => ctx.setPlate(ctx.setup.plate === 'upper' ? 'lower' : 'upper'));
  const plateBtn = panel.widgets.find((k) => k.id === 'plate');
  panel.textTop = 690;
  const redrawPanel = () => {
    plateBtn.label = ctx.setup.plate === 'upper' ? 'SQUARE: lower endplate of upper vertebra' : 'SQUARE: upper endplate of lower vertebra';
    panel.draw();
  };
  panel.mesh.position.set(-0.5, -0.12, 0.04);
  panel.mesh.rotation.y = 0.35;
  monitor.add(panel.mesh);
  redrawPanel();

  // ----- marker pen -----
  const pen = ctx.pen;
  const penPark = ctx.tray.clone().add(new THREE.Vector3(-0.06, 0.012, 0.03));
  const parkPen = () => pen.setPose(penPark, new THREE.Vector3(-1, 0, 0), 'tray');
  monitor.position.set(-0.45, 1.45, -1.05);
  monitor.lookAt(0, 1.45, 0);
  monitor.visible = false;
  scene.add(monitor);

  // ----- needle tray -----
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.01, 0.1), new THREE.MeshStandardMaterial({ color: 0x8fb7c9 }));
  tray.position.copy(ctx.tray);
  tray.visible = false;
  scene.add(tray);
  const parkHub = ctx.tray.clone().add(new THREE.Vector3(0.07, 0.012, 0));
  const parkDir = new THREE.Vector3(-1, 0, 0);
  const park = () => needle.setFree(parkHub, parkDir);

  renderer.xr.addEventListener('sessionstart', () => {
    monitor.visible = true; tray.visible = true;
    if (needle.state === 'none') park();
    if (pen.state === 'none') parkPen();
    ctx.onXR(true);
  });
  renderer.xr.addEventListener('sessionend', () => {
    monitor.visible = false; tray.visible = false;
    if (needle.state === 'free') needle.remove();
    if (pen.state === 'tray' || pen.state === 'hand') pen.hide();
    heldNeedle = null; heldPen = null;
    ctx.onXR(false);
  });

  const ctrls = [0, 1].map((i) => {
    const c = renderer.xr.getController(i);
    const grip = renderer.xr.getControllerGrip(i);
    c.addEventListener('connected', (e) => {
      c.userData.source = e.data;
      if (e.data.handedness === 'left') grip.add(wristBar.mesh); // wrist menu
    });
    c.addEventListener('disconnected', () => { c.userData.source = null; });
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.35 }));
    line.scale.z = 0.6;
    c.add(line);
    c.userData.line = line;
    scene.add(c);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.11, 12), new THREE.MeshStandardMaterial({ color: 0x444c58 }));
    body.rotation.x = Math.PI / 2;
    grip.add(body);
    scene.add(grip);
    return c;
  });

  const prev = new Map();
  const ray = new THREE.Raycaster();
  const rot = new THREE.Matrix4();
  const pos = new THREE.Vector3(), fwd = new THREE.Vector3(), H = new THREE.Vector3();
  const v = new THREE.Vector3(), p = new THREE.Vector3(), nd = new THREE.Vector3();
  const grabOff = new THREE.Vector3();
  let grabbedBy = null, heldNeedle = null, heldPen = null, lastTick = 0, sliding = null, lastRoll = null;
  const plane = new THREE.Plane(), hitP = new THREE.Vector3(), nrm = new THREE.Vector3();
  const dz = (x) => (Math.abs(x) < 0.15 ? 0 : x);

  function pose(c) {
    rot.identity().extractRotation(c.matrixWorld);
    pos.setFromMatrixPosition(c.matrixWorld);
    fwd.set(0, 0, -1).applyMatrix4(rot).normalize();
    H.copy(pos).addScaledVector(fwd, HAND_OFFSET);
  }

  // controller roll around the needle axis (radians): twisting the wrist turns the hub
  const HEADW = new THREE.Vector3(-1, 0, 0);
  function rollAngle() {
    const axis = needle.state === 'skin' ? needle.d : fwd;
    const r = v.set(1, 0, 0).applyMatrix4(rot);
    r.addScaledVector(axis, -r.dot(axis));
    const ref = p.copy(HEADW).addScaledVector(axis, -HEADW.dot(axis));
    if (ref.lengthSq() < 0.04) ref.set(0, 0, 1).addScaledVector(axis, -axis.z);
    return Math.atan2(nd.crossVectors(ref, r).dot(axis), ref.dot(r));
  }

  function holdNeedle(dt) {
    const T = needle.tissue, L = needle.length;
    const roll = rollAngle();
    if (lastRoll !== null) {
      let dr = roll - lastRoll;
      if (dr > Math.PI) dr -= 2 * Math.PI;
      if (dr < -Math.PI) dr += 2 * Math.PI;
      if (Math.abs(dr) > 1e-4) needle.spin(dr);
    }
    lastRoll = roll;
    if (needle.state !== 'skin') {
      // needle in the air: it follows the hand. Does the tip enter the skin?
      needle.setFree(H, fwd);
      const tip = needle.tip(v);
      if (!T.inBody(tip) || T.inBody(H)) return;
      let s = 0;
      for (; s <= L; s += 0.5) { if (T.inBody(p.copy(H).addScaledVector(fwd, s * 0.001))) break; }
      const E = p.clone();
      needle.place(E, fwd);
      needle.advance(L - s);
      grabOff.set(0, 0, 0);
      return;
    }
    // needle in the patient: it pivots at the skin entry point and slides along its own axis
    H.add(grabOff);
    v.copy(needle.E).sub(H);
    const dist = v.length();
    if (dist > 1e-4 && dist < (L + 60) * 0.001) {
      // shallow: the needle follows the hand. Deep: tissue holds it, so it turns only slowly.
      v.multiplyScalar(1 / dist);
      const ang = needle.d.angleTo(v);
      const rate = (needle.depth <= 15 ? 600 : 50 * needle.steerFactor()) * Math.PI / 180; // rad/s
      if (ang > 1e-4) {
        nd.copy(needle.d).lerp(v, Math.min(1, rate * dt / ang)).normalize();
        needle.aim(nd);
      }
    }
    const want = L - v.copy(needle.E).sub(H).dot(needle.d) * 1000; // depth the hand asks for
    if (want < -8) { grabOff.set(0, 0, 0); needle.setFree(H, needle.d.clone()); return; } // pulled out
    const max = 250 * dt;
    needle.advance(Math.max(-max, Math.min(max, want - needle.depth)));
  }

  // pen in the hand: it follows the controller, cannot go into the skin, and draws where it touches
  function holdPen(c) {
    const want = v.copy(pos).addScaledVector(fwd, PEN_REACH);
    const hit = pen.contact(want, fwd);
    if (!hit) { pen.touching = false; pen.lift(); pen.setPose(want, fwd, 'hand'); return; }
    pen.touching = true;
    pen.setPose(hit.point, fwd, 'hand');
    if (pen.dot(hit.point, hit.normal)) {
      const now = performance.now();
      if (now - lastTick > 90) { lastTick = now; pulse(c, 0.08, 12); } // felt-tip on skin
    }
  }

  function pulse(c, strength, ms) {
    const gp = c.userData.source && c.userData.source.gamepad;
    const act = gp && gp.hapticActuators && gp.hapticActuators[0];
    if (act && act.pulse) act.pulse(strength, ms).catch(() => {});
  }

  // which in-VR button / panel widget (if any) is this controller pointing at?
  function pointedButton() {
    ray.ray.origin.copy(pos); ray.ray.direction.copy(fwd);
    let best = null;
    for (const b of bars) {
      if (!b.mesh.parent || !b.mesh.visible) continue;
      const h = ray.intersectObject(b.mesh, false)[0];
      if (h && h.distance < 3 && (!best || h.distance < best.dist)) best = { bar: b, id: b.at(h.uv), dist: h.distance };
    }
    const h = ray.intersectObject(panel.mesh, false)[0];
    if (h && h.distance < 3 && (!best || h.distance < best.dist)) {
      const k = panel.at(h.uv);
      best = { panel: true, k, uv: h.uv, dist: h.distance };
    }
    return best;
  }

  // uv on the panel plane where the ray points (also outside the panel, for dragging)
  function panelUV() {
    panel.mesh.updateMatrixWorld();
    nrm.set(0, 0, 1).transformDirection(panel.mesh.matrixWorld);
    plane.setFromNormalAndCoplanarPoint(nrm, hitP.setFromMatrixPosition(panel.mesh.matrixWorld));
    ray.ray.origin.copy(pos); ray.ray.direction.copy(fwd);
    if (!ray.ray.intersectPlane(plane, hitP)) return null;
    const loc = panel.mesh.worldToLocal(hitP.clone());
    const g = panel.mesh.geometry.parameters;
    return { x: loc.x / g.width + 0.5, y: loc.y / g.height + 0.5 };
  }

  function update(dt) {
    if (!renderer.xr.isPresenting) return;
    const hovers = new Map();
    let panelHover = sliding ? sliding.k.id : null;
    for (const c of ctrls) {
      const src = c.userData.source;
      if (!src || !src.gamepad) continue;
      const gp = src.gamepad;
      const pressed = gp.buttons.map((b) => b.pressed);
      const was = prev.get(c) || [];
      let edge = (i) => pressed[i] && !was[i];
      const ax = dz(gp.axes[2] || 0), ay = dz(gp.axes[3] || 0);
      pose(c);
      // pointing at a button: the trigger clicks it instead of its normal job
      const pb = heldNeedle === c || heldPen === c ? null : pointedButton();
      c.userData.line.material.color.set(pb ? 0xffe066 : 0x88ccff);
      c.userData.line.material.opacity = pb ? 0.9 : 0.35;
      if (sliding && sliding.c === c) {                       // dragging a slider
        if (!pressed[0]) sliding = null;
        else { const uv = panelUV(); if (uv) panel.drag(sliding.k, uv); }
      }
      if (pb) {
        if (pb.panel) {
          panelHover = pb.k ? pb.k.id : null;
          if (edge(0) && pb.k) {
            if (pb.k.type === 'button') pb.k.onClick();
            else { sliding = { c, k: pb.k }; panel.drag(pb.k, pb.uv); }
          }
        } else {
          hovers.set(pb.bar, pb.id);
          if (edge(0)) press(pb.id);
        }
        const e0 = edge; edge = (i) => (i === 0 ? false : e0(i));
      }
      if (src.handedness === 'left') {
        if (ax || ay) {
          if (pressed[0] && !pb) ctx.panCArm(ax * 0.08 * dt, -ay * 0.08 * dt);
          else ctx.moveCArm(ax * 30 * dt, -ay * 20 * dt);
        }
        if (edge(4)) ctx.shot();
        if (edge(5)) ctx.togglePreset();
        if (edge(3)) ctx.clearContrast();     // left stick click
      } else {
        if (ay && needle.state === 'skin' && heldNeedle !== c) needle.advance(-ay * 6 * dt);
        else if ((ax || ay) && needle.state !== 'skin') ctx.panCArm(ax * 0.08 * dt, -ay * 0.08 * dt);
        if (edge(4)) ctx.toggleLive();
        if (edge(5)) ctx.toggleBones();
        if (edge(0)) ctx.injectContrast();    // right trigger = push the plunger
        if (edge(3)) ctx.toggleHideContrast(); // right stick click
      }
      if (edge(1) && grabbedBy !== c && heldNeedle !== c && heldPen !== c) {
        ray.ray.origin.copy(pos); ray.ray.direction.copy(fwd);
        const penGrip = pen.state !== 'none' ? pen.tip.clone().addScaledVector(pen.dir, -0.06) : null;
        if (!grabbedBy && ray.intersectObject(monitor, true).length) { c.attach(monitor); grabbedBy = c; }
        else if (!heldPen && penGrip && penGrip.distanceTo(pos) < 0.13) { heldPen = c; pen.lift(); }
        else if (!heldNeedle) {
          if (needle.state !== 'skin') { heldNeedle = c; grabOff.set(0, 0, 0); }
          else if (needle.hub(v).distanceTo(H) < 0.15) { heldNeedle = c; grabOff.copy(v).sub(H); }
        }
      }
      if (!pressed[1]) {
        if (grabbedBy === c) { scene.attach(monitor); grabbedBy = null; }
        if (heldNeedle === c) { heldNeedle = null; lastRoll = null; if (needle.state !== 'skin') park(); }
        if (heldPen === c) { heldPen = null; pen.lift(); if (pen.touching) pen.setPose(pen.tip, pen.dir, 'rest'); else parkPen(); }
      }
      if (heldNeedle === c) holdNeedle(dt);
      if (heldPen === c) holdPen(c);
      prev.set(c, pressed);
    }
    for (const b of bars) {
      const h = hovers.get(b) || null;
      if (h !== b.hover) { b.hover = h; b.draw(); }
    }
    if (panelHover !== panel.hover) { panel.hover = panelHover; redrawPanel(); }
  }

  function buzz(strength, ms) {
    const targets = heldNeedle ? [heldNeedle] : ctrls.filter((c) => c.userData.source && c.userData.source.handedness === 'right');
    for (const c of targets) {
      const gp = c.userData.source && c.userData.source.gamepad;
      const act = gp && gp.hapticActuators && gp.hapticActuators[0];
      if (act && act.pulse) act.pulse(strength, ms).catch(() => {});
    }
  }

  const setupChanged = (lines) => { panel.lines = lines; redrawPanel(); };
  const curvedChanged = () => { bars.forEach((b) => { b.labels.curve = needle.curved ? 'CURVE: ON' : null; b.draw(); }); };
  return { update, buzz, setupChanged, curvedChanged, onImage: () => { tex.needsUpdate = true; }, monitor, monBar, wristBar, panel };
}
