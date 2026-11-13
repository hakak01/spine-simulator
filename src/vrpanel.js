// A flat control panel for VR: buttons and sliders drawn on a canvas, used with a
// controller ray. Trigger clicks a button; hold the trigger on a slider and move to drag.
import * as THREE from 'three';

export class VRPanel {
  constructor(wPx, hPx, widthM) {
    this.w = wPx; this.h = hPx;
    this.cv = document.createElement('canvas');
    this.cv.width = wPx; this.cv.height = hPx;
    this.g = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, widthM * hPx / wPx),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true }));
    this.widgets = [];
    this.hover = null;
    this.lines = [];
    this.title = '';
    this.textTop = 0;
  }

  button(id, x, y, w, h, label, onClick, isOn = () => false) {
    this.widgets.push({ type: 'button', id, x, y, w, h, label, onClick, isOn });
  }

  slider(id, x, y, w, h, label, min, max, get, set, fmt) {
    this.widgets.push({ type: 'slider', id, x, y, w, h, label, min, max, get, set, fmt });
  }

  px(uv) { return { x: uv.x * this.w, y: (1 - uv.y) * this.h }; }

  at(uv) {
    const p = this.px(uv);
    return this.widgets.find((k) => p.x >= k.x && p.x <= k.x + k.w && p.y >= k.y - 6 && p.y <= k.y + k.h + 6) || null;
  }

  drag(k, uv) { // set a slider from a point on the panel
    const p = this.px(uv);
    const f = Math.max(0, Math.min(1, (p.x - k.x) / k.w));
    k.set(k.min + f * (k.max - k.min));
  }

  draw() {
    const g = this.g, W = this.w, H = this.h;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(17,22,28,0.94)';
    g.beginPath(); g.roundRect(0, 0, W, H, 28); g.fill();
    g.fillStyle = '#9fe3ff'; g.font = 'bold 34px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(this.title, 24, 48);
    for (const k of this.widgets) {
      const hot = this.hover === k.id;
      if (k.type === 'button') {
        const on = k.isOn();
        g.fillStyle = on ? '#1f6f3f' : hot ? '#46586c' : '#2a3542';
        g.strokeStyle = hot ? '#ffe066' : on ? '#2c9a57' : '#4a5a6c'; g.lineWidth = hot ? 5 : 3;
        g.beginPath(); g.roundRect(k.x, k.y, k.w, k.h, 14); g.fill(); g.stroke();
        g.fillStyle = '#fff'; g.font = `bold ${Math.round(k.h * 0.42)}px sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(k.label, k.x + k.w / 2, k.y + k.h / 2 + 1);
      } else {
        const v = k.get(), f = (v - k.min) / (k.max - k.min);
        g.fillStyle = '#cfe8ff'; g.font = '26px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        g.fillText(`${k.label}: ${k.fmt(v)}`, k.x, k.y - 8);
        const ty = k.y + k.h / 2;
        g.fillStyle = '#3a4757'; g.beginPath(); g.roundRect(k.x, ty - 7, k.w, 14, 7); g.fill();
        g.fillStyle = '#3fa7ff'; g.beginPath(); g.roundRect(k.x, ty - 7, k.w * f, 14, 7); g.fill();
        const zx = k.x + k.w * (k.min < 0 ? -k.min / (k.max - k.min) : 0);
        g.fillStyle = '#8fa1b3'; g.fillRect(zx - 1.5, ty - 14, 3, 28);           // zero mark
        g.fillStyle = hot ? '#ffe066' : '#ffffff';
        g.beginPath(); g.arc(k.x + k.w * f, ty, hot ? 19 : 16, 0, Math.PI * 2); g.fill();
      }
    }
    // checklist / feedback text
    let y = this.textTop;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = '24px sans-serif';
    for (const l of this.lines) {
      g.fillStyle = l.ok === true ? '#6fdc8c' : l.ok === false ? '#ffb36b' : '#cfe8ff';
      const words = `${l.ok === true ? '✓ ' : l.ok === false ? '✗ ' : '• '}${l.text}`.split(' ');
      let line = '';
      for (const w of words) {
        const t = line ? `${line} ${w}` : w;
        if (g.measureText(t).width > W - 48) { g.fillText(line, 24, y); y += 30; line = `   ${w}`; } else line = t;
      }
      g.fillText(line, 24, y); y += 36;
      if (y > H - 10) break;
    }
    this.tex.needsUpdate = true;
  }
}
