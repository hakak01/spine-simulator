// Basic Quest 3 VR support: C-arm screen you can grab and move, C-arm on the thumbsticks.
import * as THREE from 'three';
import { VRButton } from 'three/addons/VRButton.js';

export async function setupXR(renderer, scene, ctx) {
  if (!('xr' in navigator)) return null;
  let ok = false;
  try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) { ok = false; }
  if (!ok) return null;
  renderer.xr.enabled = true;
  const btn = VRButton.createButton(renderer);
  btn.id = 'vrbutton';
  document.body.appendChild(btn);

  // C-arm screen
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const help = document.createElement('canvas');
  help.width = 1024; help.height = 150;
  const hctx = help.getContext('2d');
  hctx.fillStyle = '#11161c'; hctx.fillRect(0, 0, 1024, 150);
  hctx.fillStyle = '#cfe8ff'; hctx.font = '28px sans-serif';
  hctx.fillText('LEFT stick: rotate / tilt C-arm   X: shot   Y: AP / LAT', 20, 45);
  hctx.fillText('RIGHT stick: move C-arm   A: live on/off   B: show bones', 20, 88);
  hctx.fillText('Point at this screen + hold GRIP: move the screen', 20, 131);
  const helpTex = new THREE.CanvasTexture(help);
  helpTex.colorSpace = THREE.SRGBColorSpace;

  const monitor = new THREE.Group();
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.7, 0.03), new THREE.MeshStandardMaterial({ color: 0x20262e }));
  bezel.position.set(0, -0.04, -0.017);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.52), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.y = 0.03;
  const helpPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.076), new THREE.MeshBasicMaterial({ map: helpTex }));
  helpPlane.position.y = -0.3;
  monitor.add(bezel, screen, helpPlane);
  monitor.position.set(-0.45, 1.45, -1.05);
  monitor.lookAt(0, 1.45, 0);
  monitor.visible = false;
  scene.add(monitor);

  renderer.xr.addEventListener('sessionstart', () => { monitor.visible = true; ctx.onXR(true); });
  renderer.xr.addEventListener('sessionend', () => { monitor.visible = false; ctx.onXR(false); });

  const ctrls = [0, 1].map((i) => {
    const c = renderer.xr.getController(i);
    c.addEventListener('connected', (e) => { c.userData.source = e.data; });
    c.addEventListener('disconnected', () => { c.userData.source = null; });
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.6 }));
    line.scale.z = 1.5;
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
  let grabbedBy = null;
  const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);

  function update(dt) {
    for (const c of ctrls) {
      const src = c.userData.source;
      if (!src || !src.gamepad) continue;
      const gp = src.gamepad;
      const pressed = gp.buttons.map((b) => b.pressed);
      const was = prev.get(c) || [];
      const edge = (i) => pressed[i] && !was[i];
      const ax = dz(gp.axes[2] || 0), ay = dz(gp.axes[3] || 0);
      if (src.handedness === 'left') {
        if (ax || ay) ctx.moveCArm(ax * 30 * dt, -ay * 20 * dt);
        if (edge(4)) ctx.shot();
        if (edge(5)) ctx.togglePreset();
      } else {
        if (ax || ay) ctx.panCArm(ax * 0.08 * dt, -ay * 0.08 * dt);
        if (edge(4)) ctx.toggleLive();
        if (edge(5)) ctx.toggleBones();
      }
      if (edge(1) && !grabbedBy) {
        rot.identity().extractRotation(c.matrixWorld);
        ray.ray.origin.setFromMatrixPosition(c.matrixWorld);
        ray.ray.direction.set(0, 0, -1).applyMatrix4(rot);
        if (ray.intersectObject(monitor, true).length) { c.attach(monitor); grabbedBy = c; }
      }
      if (!pressed[1] && grabbedBy === c) { scene.attach(monitor); grabbedBy = null; }
      prev.set(c, pressed);
    }
  }

  return { update, onImage: () => { tex.needsUpdate = true; } };
}
