// Quest 3 VR: movable C-arm screen, C-arm on the left stick, hand-held needle.
import * as THREE from 'three';
import { VRButton } from 'three/addons/VRButton.js';

const HAND_OFFSET = 0.03; // needle hub sits this far in front of the controller (m)

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
  help.width = 1024; help.height = 322;
  const hctx = help.getContext('2d');
  hctx.fillStyle = '#11161c'; hctx.fillRect(0, 0, 1024, 322);
  hctx.fillStyle = '#cfe8ff'; hctx.font = '27px sans-serif';
  [
    'LEFT stick: rotate / tilt C-arm (hold left trigger: move it)',
    'X: shot    Y: AP / LAT    A: live on/off    B: show bones',
    'GRIP: pick up the needle. Push it into the back like a real one.',
    'Needle left in the patient: RIGHT stick = fine advance / withdraw',
    'RIGHT TRIGGER: inject contrast (1 mL, live fluoro)',
    'Right stick click: hide / show contrast   Left stick click: clear it',
    'Point at this screen + hold GRIP: move the screen',
  ].forEach((t, i) => hctx.fillText(t, 20, 40 + i * 43));
  const helpTex = new THREE.CanvasTexture(help);
  helpTex.colorSpace = THREE.SRGBColorSpace;

  const monitor = new THREE.Group();
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.8, 0.03), new THREE.MeshStandardMaterial({ color: 0x20262e }));
  bezel.position.set(0, -0.09, -0.017);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.52), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.y = 0.03;
  const helpPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.163), new THREE.MeshBasicMaterial({ map: helpTex }));
  helpPlane.position.y = -0.33;
  monitor.add(bezel, screen, helpPlane);
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
    ctx.onXR(true);
  });
  renderer.xr.addEventListener('sessionend', () => {
    monitor.visible = false; tray.visible = false;
    if (needle.state === 'free') needle.remove();
    heldNeedle = null;
    ctx.onXR(false);
  });

  const ctrls = [0, 1].map((i) => {
    const c = renderer.xr.getController(i);
    c.addEventListener('connected', (e) => { c.userData.source = e.data; });
    c.addEventListener('disconnected', () => { c.userData.source = null; });
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.35 }));
    line.scale.z = 0.25;
    c.add(line);
    scene.add(c);
    const grip = renderer.xr.getControllerGrip(i);
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
  let grabbedBy = null, heldNeedle = null;
  const dz = (x) => (Math.abs(x) < 0.15 ? 0 : x);

  function pose(c) {
    rot.identity().extractRotation(c.matrixWorld);
    pos.setFromMatrixPosition(c.matrixWorld);
    fwd.set(0, 0, -1).applyMatrix4(rot).normalize();
    H.copy(pos).addScaledVector(fwd, HAND_OFFSET);
  }

  function holdNeedle(dt) {
    const T = needle.tissue, L = needle.length;
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

  function update(dt) {
    if (!renderer.xr.isPresenting) return;
    for (const c of ctrls) {
      const src = c.userData.source;
      if (!src || !src.gamepad) continue;
      const gp = src.gamepad;
      const pressed = gp.buttons.map((b) => b.pressed);
      const was = prev.get(c) || [];
      const edge = (i) => pressed[i] && !was[i];
      const ax = dz(gp.axes[2] || 0), ay = dz(gp.axes[3] || 0);
      if (src.handedness === 'left') {
        if (ax || ay) {
          if (pressed[0]) ctx.panCArm(ax * 0.08 * dt, -ay * 0.08 * dt);
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
      pose(c);
      if (edge(1) && grabbedBy !== c && heldNeedle !== c) {
        ray.ray.origin.copy(pos); ray.ray.direction.copy(fwd);
        if (!grabbedBy && ray.intersectObject(monitor, true).length) { c.attach(monitor); grabbedBy = c; }
        else if (!heldNeedle) {
          if (needle.state !== 'skin') { heldNeedle = c; grabOff.set(0, 0, 0); }
          else if (needle.hub(v).distanceTo(H) < 0.15) { heldNeedle = c; grabOff.copy(v).sub(H); }
        }
      }
      if (!pressed[1]) {
        if (grabbedBy === c) { scene.attach(monitor); grabbedBy = null; }
        if (heldNeedle === c) { heldNeedle = null; if (needle.state !== 'skin') park(); }
      }
      if (heldNeedle === c) holdNeedle(dt);
      prev.set(c, pressed);
    }
  }

  function buzz(strength, ms) {
    const targets = heldNeedle ? [heldNeedle] : ctrls.filter((c) => c.userData.source && c.userData.source.handedness === 'right');
    for (const c of targets) {
      const gp = c.userData.source && c.userData.source.gamepad;
      const act = gp && gp.hapticActuators && gp.hapticActuators[0];
      if (act && act.pulse) act.pulse(strength, ms).catch(() => {});
    }
  }

  return { update, buzz, onImage: () => { tex.needsUpdate = true; } };
}
