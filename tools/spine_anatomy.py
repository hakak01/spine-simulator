"""Soft-tissue anatomy that a CT does not label directly, built from the CT and the
TotalSegmentator masks: intervertebral discs, epidural space, foramina and the
exiting lumbar nerve roots (L3, L4, L5).

All work is in voxel indices of the cropped volume (x = patient right, y = anterior,
z = superior). Codes written into the label volume:
  10 disc, 11 epidural space, 12 nerve root, 13 foramen / periradicular fat.
The dural sac is TotalSegmentator's "spinal_cord" label (code 3); in the lumbar
region it covers the whole thecal sac (about 22 x 16 mm here).

The root course is a model (CT cannot show roots): from the anterolateral sac at
pedicle level, round the medial and lower border of the pedicle, through the upper
foramen (dorsal root ganglion), then out laterally and downward toward the psoas.
"""
import numpy as np
from scipy import ndimage

DISC, EPI, ROOT, FOR = 10, 11, 12, 13
SOFT = (1, 7)          # soft tissue, muscle: may be relabelled
SIDES = {"L": -1, "R": 1}  # patient left = smaller x


def sac_axis(sac):
    """Per slice: centre x, centre y, half-width (voxels) of the dural sac."""
    nz = sac.shape[2]
    xc, yc, a = np.full(nz, np.nan), np.full(nz, np.nan), np.full(nz, np.nan)
    for z in range(nz):
        xs, ys = np.nonzero(sac[:, :, z])
        if len(xs) > 20:
            xc[z], yc[z], a[z] = xs.mean(), ys.mean(), (xs.max() - xs.min() + 1) / 2
    ok = ~np.isnan(xc)
    idx = np.arange(nz)
    for arr in (xc, yc, a):  # fill slices without sac with the nearest values
        arr[~ok] = np.interp(idx[~ok], idx[ok], arr[ok])
    return xc, yc, a


def pedicle(vmask, xc, yc, a, side):
    """Pedicle of one vertebra on one side: bone beside the front third of the canal."""
    zs = np.nonzero(vmask.any((0, 1)))[0]
    pts = []
    for z in zs:
        x0 = int(round(xc[z] + side * (a[z] + 0.5)))
        x1 = int(round(xc[z] + side * (a[z] + 10)))
        lo, hi = sorted((x0, x1))
        # front third of the canal: beside the canal only the pedicles reach this depth
        # (facets and pars lie further back, the vertebral body further forward)
        y0, y1 = int(round(yc[z] + 1)), int(round(yc[z] + 3))
        sub = vmask[lo:hi + 1, y0:y1 + 1, z]
        for x, y in zip(*np.nonzero(sub)):
            pts.append((lo + x, y0 + y, z))
    pts = np.array(pts)
    # the pedicle core: slices with the most bone in the band, extended while still
    # at least 45 % of the peak (drops the thin edges of the body and the facets)
    zu, cnt = np.unique(pts[:, 2], return_counts=True)
    area = np.zeros(zu.max() + 2)
    area[zu] = cnt
    area = np.convolve(area, [1 / 3, 1 / 3, 1 / 3], "same")
    zm = int(np.argmax(area))
    zb = zt = zm
    while zb > 0 and area[zb - 1] >= 0.45 * area[zm]:
        zb -= 1
    while zt < len(area) - 1 and area[zt + 1] >= 0.45 * area[zm]:
        zt += 1
    p = pts[(pts[:, 2] >= zb) & (pts[:, 2] <= zt)]
    c = p.mean(0)
    w = (p[:, 0].max() - p[:, 0].min() + 1) / 2
    return {"c": c, "zb": float(zb), "zt": float(zt), "w": float(w)}


def free_spot(bone, p, search=3):
    """Nearest non-bone voxel to p (prefers moving down and forward)."""
    p = np.round(p).astype(int)
    if not bone[tuple(p)]:
        return p.astype(float)
    best, bd = p, 1e9
    for dz in range(-search, search + 1):
        for dy in range(-search, search + 1):
            for dx in range(-1, 2):
                q = p + (dx, dy, dz)
                if not bone[tuple(q)]:
                    d = dx * dx + dy * dy + dz * dz + 0.1 * (dz > 0)
                    if d < bd:
                        best, bd = q, d
    return best.astype(float)


def tube(shape, pts, radius, box_pad=6):
    """Voxels within `radius` (voxels) of the polyline; radius may vary per point."""
    pts = np.asarray(pts, float)
    r = np.broadcast_to(np.asarray(radius, float), (len(pts),))
    lo = np.maximum(np.floor(pts.min(0) - r.max() - box_pad).astype(int), 0)
    hi = np.minimum(np.ceil(pts.max(0) + r.max() + box_pad).astype(int), np.array(shape) - 1)
    gx, gy, gz = np.meshgrid(*[np.arange(lo[i], hi[i] + 1) for i in range(3)], indexing="ij")
    P = np.stack([gx, gy, gz], -1).astype(float)
    inside = np.zeros(gx.shape, bool)
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ab = b - a
        t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
        d = np.linalg.norm(P - (a + t[..., None] * ab), axis=-1)
        rr = r[i] + (r[i + 1] - r[i]) * t
        inside |= d <= rr
    out = np.zeros(shape, bool)
    out[lo[0]:hi[0] + 1, lo[1]:hi[1] + 1, lo[2]:hi[2] + 1] = inside
    return out


def discs(lab, verts, pairs, yc):
    for up, low in pairs:
        U, L = verts[up], verts[low]
        nz = U.shape[2]
        ant = np.zeros(U.shape, bool)  # vertebral bodies only (in front of the sac)
        for z in range(nz):
            ant[:, int(round(yc[z])) + 6:, z] = True
        U, L = U & ant, L & ant
        cu, cl = U.any(2), L.any(2)
        both = cu & cl
        zlo_u = np.where(cu, np.argmax(U, axis=2), 0)                         # lowest z of upper body
        zhi_l = np.where(cl, U.shape[2] - 1 - np.argmax(L[:, :, ::-1], axis=2), 0)  # highest z of lower body
        disc = np.zeros(U.shape, bool)
        for x, y in zip(*np.nonzero(both)):
            g0, g1 = zhi_l[x, y] + 1, zlo_u[x, y]
            if 1 <= g1 - g0 <= 13:
                disc[x, y, g0:g1] = True
        disc = ndimage.binary_closing(disc, iterations=1) & (lab != 2) & (lab != 3)
        lab[disc] = DISC


def build(lab, sac, verts, sp):
    """lab: label volume (modified in place). verts: dict name -> mask (L3, L4, L5, S1)."""
    bone = lab == 2
    xc, yc, a = sac_axis(sac)
    discs(lab, verts, [("L2", "L3"), ("L3", "L4"), ("L4", "L5"), ("L5", "S1")], yc)

    # epidural space: a 4.5 mm ring around the sac, inside the canal (per slice)
    ring = np.zeros(sac.shape, bool)
    st = ndimage.generate_binary_structure(2, 1)
    for z in range(sac.shape[2]):
        if sac[:, :, z].any():
            ring[:, :, z] = ndimage.binary_dilation(sac[:, :, z], st, iterations=3)
    epi = ring & ~sac & np.isin(lab, SOFT)
    lab[epi] = EPI

    out = {"pedicles": {}, "roots": {}, "targets": {}}
    order = ["L3", "L4", "L5", "S1"]
    peds = {v: {s: pedicle(verts[v], xc, yc, a, sg) for s, sg in SIDES.items()} for v in order}
    for v in order:
        out["pedicles"][v] = {s: {"c": (p["c"] * sp).round(1).tolist(), "zb": round(p["zb"] * sp[2], 1),
                                  "zt": round(p["zt"] * sp[2], 1), "w": round(p["w"] * sp[0], 1)}
                              for s, p in peds[v].items()}
    for i, v in enumerate(order[:-1]):           # exiting root under pedicle v
        out["roots"][v], out["targets"][v] = {}, {}
        for s, sg in SIDES.items():
            p = peds[v][s]
            px, py, pz = p["c"]
            zb, w = p["zb"], p["w"]
            z0 = int(round(pz))
            ctrl = [
                (xc[z0] + sg * (a[z0] - 2.5), yc[z0] + 3.0, pz + 3),          # leaves the sac
                (xc[z0] + sg * (a[z0] + 0.5), yc[z0] + 3.5, zb - 1.5),       # round the pedicle
                (px + sg * 0.5, yc[z0] + 4.0, zb - 4.5),                     # DRG, upper foramen
                (px + sg * (w + 4), yc[z0] + 8.0, zb - 10),                  # foraminal exit
                (px + sg * (w + 13), yc[z0] + 17.0, zb - 22),                # extraforaminal
            ]
            pts = [free_spot(bone, np.array(c)) for c in ctrl]
            radius = [1.7, 1.7, 2.7, 2.0, 1.8]                               # voxels (2.5-4 mm)
            root = tube(lab.shape, pts, radius) & ~bone & (lab != DISC) & (lab != 3)
            peri = tube(lab.shape, pts, np.array(radius) + 2.7) & np.isin(lab, SOFT + (EPI,))
            # foramen: between this pedicle and the one below, sac edge to pedicle edge
            fz0, fz1 = int(round(zb - 18 / sp[2])), int(round(pz))   # ~18 mm tall; bone is never relabelled
            xa, xb = sorted((int(round(xc[z0] + sg * a[z0])), int(round(px + sg * (w + 3)))))
            fy0, fy1 = int(round(yc[z0] - 5)), int(round(yc[z0] + 9))
            fbox = np.zeros(lab.shape, bool)
            fbox[xa:xb + 1, fy0:fy1 + 1, fz0:fz1 + 1] = True
            lab[(peri | fbox) & np.isin(lab, SOFT)] = FOR
            lab[root] = ROOT
            out["roots"][v][s] = [(np.array(q) * sp).round(1).tolist() for q in pts]
            # subpedicular ("safe triangle") point: just under the pedicle, 6 o'clock in AP
            tgt = free_spot(bone, np.array((px + sg * 1.0, yc[z0] + 7.0, zb - 1.5)), 2)
            out["targets"][v][s] = (tgt * sp).round(1).tolist()
    out["sac_axis"] = {"z_mm": (np.arange(len(xc)) * sp[2]).round(1)[::4].tolist(),
                       "x_mm": (xc * sp[0]).round(1)[::4].tolist(), "y_mm": (yc * sp[1]).round(1)[::4].tolist(),
                       "half_width_mm": (a * sp[0]).round(1)[::4].tolist()}
    return out
