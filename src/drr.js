// Fluoroscopy image ("DRR": digitally reconstructed radiograph) from the CT volume.
// GPU: march X-rays from the tube through the CT and sum attenuation.
// CPU: auto-brightness, edge enhancement, noise, round field, like an image intensifier.
import * as THREE from 'three';

const VERT = /* glsl */`
in vec3 position; in vec2 uv; out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */`
precision highp float; precision highp sampler3D;
uniform sampler3D vol;
uniform vec3 dims, spacing;          // voxels, mm per voxel
uniform vec3 src, detC, detU, detV;  // tube, detector centre and half-axes (mm, volume frame)
uniform float stepMM;
in vec2 vUv; out vec4 outColor;

// relative linear attenuation (water = 1) at an effective energy of ~55 keV
float muOf(float v) {
  float hu = v * 2550.0 - 1000.0;
  float m = max(0.0, 1.0 + hu * 0.001);
  return m * (1.0 + max(0.0, hu - 50.0) * 0.0009);
}
vec4 pack(float x) {
  x = clamp(x / 2000.0, 0.0, 0.999999);
  vec3 e = fract(x * vec3(1.0, 255.0, 65025.0));
  e -= e.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0);
  return vec4(e, 1.0);
}
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  vec3 P = detC + detU * q.x + detV * q.y;
  vec3 d = normalize(P - src);
  d += 1e-5 * (1.0 - step(1e-5, abs(d)));
  vec3 bmax = (dims - 1.0) * spacing;
  vec3 t0 = (vec3(0.0) - src) / d, t1 = (bmax - src) / d;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  float tn = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  float tf = min(min(tmax.x, tmax.y), tmax.z);
  float sum = 0.0;
  if (tf > tn) {
    int n = int((tf - tn) / stepMM);
    vec3 p = src + d * (tn + 0.5 * stepMM);
    vec3 tc = (p / spacing + 0.5) / dims;
    vec3 dtc = (d * stepMM / spacing) / dims;
    for (int i = 0; i < 2000; i++) {
      if (i >= n) break;
      sum += muOf(texture(vol, tc).r);
      tc += dtc;
    }
    sum *= stepMM;
  }
  outColor = pack(sum);  // water-equivalent path length, mm
}`;

export class DRR {
  constructor(renderer, volTex, meta) {
    this.renderer = renderer;
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        vol: { value: volTex },
        dims: { value: new THREE.Vector3(...meta.dims) },
        spacing: { value: new THREE.Vector3(...meta.spacing) },
        src: { value: new THREE.Vector3() }, detC: { value: new THREE.Vector3() },
        detU: { value: new THREE.Vector3() }, detV: { value: new THREE.Vector3() },
        stepMM: { value: 1.0 },
      },
      depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.targets = {};
  }

  target(size) {
    if (!this.targets[size]) {
      this.targets[size] = new THREE.WebGLRenderTarget(size, size, {
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        type: THREE.UnsignedByteType, depthBuffer: false,
      });
    }
    return this.targets[size];
  }

  // frame: {src, detC, detU, detV} in volume mm. Returns Float32Array of path sums (row 0 = bottom).
  render(frame, size, stepMM) {
    const u = this.mat.uniforms;
    u.src.value.copy(frame.src); u.detC.value.copy(frame.detC);
    u.detU.value.copy(frame.detU); u.detV.value.copy(frame.detV);
    u.stepMM.value = stepMM;
    const r = this.renderer, rt = this.target(size);
    const prevTarget = r.getRenderTarget(), prevXR = r.xr.enabled;
    r.xr.enabled = false;
    r.setRenderTarget(rt);
    r.render(this.scene, this.cam);
    const px = new Uint8Array(size * size * 4);
    r.readRenderTargetPixels(rt, 0, 0, size, size, px);
    r.setRenderTarget(prevTarget);
    r.xr.enabled = prevXR;
    const out = new Float32Array(size * size);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) {
      out[i] = (px[j] / 255 + px[j + 1] / 65025 + px[j + 2] / 16581375) * 2000;
    }
    return out;
  }
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length), dst = new Float32Array(src.length), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0; const o = y * w;
    for (let x = -r; x <= r; x++) acc += src[o + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = acc / n;
      acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return dst;
}

let seed = 12345;
function randn() { // fast gaussian-ish noise
  let s = 0;
  for (let i = 0; i < 3; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; s += seed / 4294967296; }
  return (s - 1.5) * 2;
}

// Turn path sums into a fluoroscopy picture. Dense (bone, metal, contrast) = dark.
export function toImage(sums, size, opts = {}) {
  const { flip = false, noise = 1, k = 0.012 } = opts;
  // auto brightness (like a C-arm's ABC): exposure set by the centre of the field,
  // then a fixed, physical contrast: brightness ~ transmitted X-ray intensity.
  const vals = [];
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y += 2) for (let x = 0; x < size; x += 2) {
    const dx = (x - c) / c, dy = (y - c) / c;
    if (dx * dx + dy * dy < 0.3) vals.push(sums[y * size + x]);
  }
  vals.sort((a, b) => a - b);
  const ref = vals[Math.floor(vals.length * 0.5)];
  const K = k; // display contrast (attenuation per mm water, softened by camera gamma)
  const blur = boxBlur(sums, size, size, Math.max(2, Math.round(size / 120)));
  const img = new ImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = flip ? size - 1 - x : x;
      const i = y * size + sx;
      const dx = (x - c) / c, dy = (y - c) / c, r2 = dx * dx + dy * dy;
      const o = ((size - 1 - y) * size + x) * 4; // canvas row 0 = top
      if (r2 > 1) { d[o] = d[o + 1] = d[o + 2] = 0; d[o + 3] = 255; continue; }
      const s = sums[i] + 0.9 * (sums[i] - blur[i]);       // edge enhancement
      let v = 0.58 * Math.exp(-K * (s - ref));             // dense = dark, air = white
      v = Math.min(1, v) * 0.96 + 0.03;
      v += noise * randn() * (0.012 + 0.025 * (1 - v));     // quantum mottle, more where dose is low
      v *= 1 - 0.18 * r2;                                   // intensifier vignetting
      const edge = Math.min(1, (1 - r2) * 40);              // soft round edge
      const b = Math.max(0, Math.min(255, v * 255 * edge));
      d[o] = b; d[o + 1] = b; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  return img;
}
