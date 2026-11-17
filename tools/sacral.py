"""Sacral anatomy for the caudal epidural block, built from the CT (cropped voxel frame:
x = patient right, y = anterior, z = superior).

From the CT:
  sacral canal (space enclosed by the sacrum, below the dural sac), the sacral hiatus
  (lowest part of the canal where the bony roof is missing), the end of the dural sac,
  and the sacral foramina (channels through the sacrum lateral to the canal).
Modelled (a CT cannot show them):
  sacrococcygeal ligament (a 3 mm layer closing the hiatus), S1-S4 roots from the canal
  through the foramina (positions from the foramina found on the CT, mirrored to the
  other side where one side is not found), and the ventral sacral epidural veins.

Label codes added: 14 sacral canal (epidural space), 15 sacrococcygeal ligament.
Foraminal channels reuse 13 (foramen / periradicular fat), roots reuse 12.
"""
import numpy as np
from scipy import ndimage

import spine_anatomy as sa

CANAL, LIG = 14, 15


def canal_and_roof(sac, hu, dura, mid):
    """Sacral canal below the dural sac. In each slice, along columns near the midline, the canal is
    the low-density gap between the dorsal plate (or, at the hiatus, the back of the sacrum's
    outline) and the sacral bodies in front. Gaps are kept only where they join up from slice to
    slice with the canal under the dural sac."""
    st = ndimage.generate_binary_structure(2, 1)
    canal = np.zeros(sac.shape, bool)
    closed = np.zeros(sac.shape, bool)
    zs = np.nonzero(sac.any((0, 1)))[0]
    zd = int(np.nonzero(dura.any((0, 1)))[0].min())
    for z in range(zs.min(), zs.max() + 1):
        s_ = sac[:, :, z]
        if s_.sum() < 30:
            continue
        cl = ndimage.binary_closing(s_, st, iterations=4)
        closed[:, :, z] = cl
        if z > zd + 2:
            continue
        xs = np.nonzero(cl.any(1))[0]
        xm = int(round(np.nonzero(cl)[0].mean())) if abs(np.nonzero(cl)[0].mean() - mid) < 12 else int(round(mid))
        for x in range(xm - 11, xm + 12):
            col = cl[x]
            if not col.any():
                continue
            ys = np.nonzero(col)[0]
            y0, y1 = ys.min(), ys.max()
            prof = hu[x, y0:y1 + 1, z]
            dense = prof > 220
            if not dense.any():
                continue
            # the gap: low-density voxels behind the first dense voxels of the bodies (from the back)
            front = np.nonzero(dense)[0]
            # first dense run from the back (dorsal plate) - may be absent at the hiatus
            k = 0
            while k < len(prof) and not dense[k]:
                k += 1
            back_end = k
            while back_end < len(prof) and dense[back_end]:
                back_end += 1
            gap = np.zeros(len(prof), bool)
            if back_end < len(prof):
                rest = dense[back_end:]
                nxt = np.nonzero(rest)[0]
                if len(nxt):
                    g0, g1 = back_end, back_end + nxt[0]
                    if 1 <= g1 - g0 <= 14:
                        gap[g0:g1] = True
            if k > 0 and not gap.any() and k <= 10:          # hiatus: no dorsal plate, gap is behind the body
                gap[0:k] = prof[0:k] < 150
            canal[x, y0:y1 + 1, z] = gap & (prof < 200)
    canal &= ~dura
    # keep what joins (in 3D) the canal just under the dural sac
    lab, n = ndimage.label(canal, structure=np.ones((3, 3, 3)))
    if n:
        top = lab[:, :, max(0, zd - 6):zd + 1]
        ids = [i for i in np.unique(top) if i]
        if ids:
            sizes = {i: (lab == i).sum() for i in ids}
            canal = lab == max(sizes, key=sizes.get)
    canal = ndimage.binary_closing(canal, structure=np.ones((3, 3, 3))) & (hu < 220) & ~dura
    return canal, closed


def build(lab, hu, sac, dura, verts, sp, anatomy):
    """Writes labels 14 / 15 / 13 / 12 into `lab`; returns the "sacral" block for ct.json."""
    xs = np.nonzero(sac.any((1, 2)))[0]
    mid = float(np.median(np.nonzero(sac)[0]))
    canal, closed = canal_and_roof(sac, hu, dura, mid)
    zc = np.nonzero(canal.any((0, 1)))[0]
    bone = lab == 2

    # roof: is there bone behind the canal at the midline?  The hiatus is where it is missing.
    axis, roofless = {}, []
    for z in zc:
        cx, cy = np.nonzero(canal[:, :, z])
        x0 = int(round(cx.mean()))
        axis[int(z)] = (float(np.clip(cx.mean(), mid - 6, mid + 6)), float(cy.mean()), int(cy.min()))
        if not sac[x0 - 2:x0 + 3, max(0, cy.min() - 12):cy.min(), z].any():
            roofless.append(int(z))
    # the hiatus: from the bottom of the canal up to the highest roofless slice of the
    # lowest roofless stretch (gaps of up to 4 slices are bridged)
    rl = sorted(roofless)
    h_lo = h_hi = rl[0]
    for z in rl[1:]:
        if z - h_hi <= 5:
            h_hi = z
        else:
            break
    h_lo = min(h_lo, int(zc.min()))

    # sacrococcygeal ligament: a 3 mm layer (2 voxels) closing the hiatus behind the canal,
    # carried on 10 mm below the hiatus over the back of the lower sacrum / coccyx
    lig = np.zeros(lab.shape, bool)
    for z in range(h_lo - 7, h_hi + 1):
        a = axis.get(z) or axis[min(axis, key=lambda k: abs(k - z))]
        x0, ymin = int(round(a[0])), a[2]
        for x in range(x0 - 5, x0 + 6):
            col = sac[x, :, z]
            back = ymin if z >= h_lo else (int(np.nonzero(col)[0].min()) if col.any() else ymin)
            for y in range(back - 2, back):
                if not bone[x, y, z]:
                    lig[x, y, z] = True
    # the canal wins over the generous (1-voxel dilated) bone edge: at the hiatus the canal is only
    # 1-2 voxels deep, and the needle and contrast must be able to get in
    lab[canal & np.isin(lab, (1, 2, 7, 11, 13)) & (hu < 200)] = CANAL
    lab[lig & np.isin(lab, (1, 7))] = LIG

    # dural sac end
    zd = np.nonzero(dura.any((0, 1)))[0]
    zend = int(zd.min())
    dx, dy = np.nonzero(dura[:, :, zend])
    sac_end = [float(dx.mean()), float(dy.mean()), float(zend)]

    # sacral foramina: channels through the sacrum, 9-39 mm from the midline
    st = ndimage.generate_binary_structure(2, 1)
    cand = np.zeros(lab.shape, bool)
    x = np.arange(lab.shape[0])[:, None]
    zsac = np.nonzero(sac.any((0, 1)))[0]
    for z in range(max(0, int(zc.min()) - 15), int(zsac.max()) - 8):
        s = sac[:, :, z]
        if s.sum() < 30:
            continue
        filled = ndimage.binary_fill_holes(ndimage.binary_closing(s, st, iterations=3))
        cand[:, :, z] = filled & ~s & ~canal[:, :, z] & (np.abs(x - mid) >= 6) & (np.abs(x - mid) <= 26) & (hu[:, :, z] < 200)
    cl, n = ndimage.label(cand, structure=np.ones((3, 3, 3)))
    sizes = ndimage.sum(cand, cl, range(1, n + 1))
    comps = []
    for i, size in enumerate(sizes):
        if size >= 40:
            p = np.argwhere(cl == i + 1)
            comps.append({"c": p.mean(0), "side": "L" if p.mean(0)[0] < mid else "R", "size": int(size)})
    # one channel per level and side, from the top: S1..S4 (biggest component per 12 mm band)
    found = {"L": [], "R": []}
    for s in ("L", "R"):
        cs = sorted([c for c in comps if c["side"] == s], key=lambda c: -c["c"][2])
        for c in cs:
            if all(abs(c["c"][2] - f[2]) > 8 for f in found[s]):
                found[s].append(c["c"])
        found[s] = found[s][:4]
    ref = max(found.values(), key=len)
    levels = {}
    for i, name in enumerate(["S1", "S2", "S3", "S4"][:len(ref)]):
        levels[name] = {}
        for s in ("L", "R"):
            same = [f for f in found[s] if abs(f[2] - ref[i][2]) < 9]
            if same:
                levels[name][s] = (same[0], "CT")
            else:                                     # mirror the other side
                m = ref[i].copy(); m[0] = 2 * mid - m[0]
                levels[name][s] = (m, "mirrored")

    # modelled roots: canal -> foramen -> out in front of the sacrum
    roots, veins, foramina = {}, [], {}
    for name, sides in levels.items():
        roots[name], foramina[name] = {}, {}
        for s, (f, how) in sides.items():
            sg = sa.SIDES[s]
            z = int(round(f[2]))
            a = axis.get(z + 5) or axis[min(axis, key=lambda k: abs(k - (z + 5)))]
            p0 = np.array([a[0] + sg * 3, a[1], z + 5])
            p1 = f.copy()
            p2 = f.copy()
            while p2[1] < lab.shape[1] - 2 and (closed[int(round(p2[0])), int(round(p2[1])), int(round(p2[2]))]):
                p2[1] += 1
            p2 = p2 + np.array([sg * 3, 3, -2])
            p3 = p2 + np.array([sg * 8, 8, -6])
            pts = [sa.free_spot(bone, q, 2) for q in (p0, p1, p2, p3)]
            chan = sa.tube(lab.shape, pts[:3], [2.6, 2.6, 2.6]) & (hu < 130) & np.isin(lab, (1, 7, 14))
            lab[chan & (lab != CANAL)] = 13
            root = sa.tube(lab.shape, pts, [1.3, 1.5, 1.5, 1.4]) & (hu < 130) & ~bone
            lab[root] = 12
            roots[name][s] = [(np.array(q) * sp).round(1).tolist() for q in pts]
            foramina[name][s] = {"c": (np.array(f) * sp).round(1).tolist(), "from": how}
            # vein running with the root
            veins.append([(np.array(q + np.array([0, 1.2, -1.2])) * sp).round(1).tolist() for q in pts[:3]])
    # ventral sacral epidural plexus: two veins on the floor of the canal, hiatus to sac end and above
    for side in (-1, 1):
        line = []
        for z in range(h_lo, min(zend + 12, int(zc.max())) + 1, 4):
            a = axis.get(z) or axis[min(axis, key=lambda k: abs(k - z))]
            cx, cy = np.nonzero(canal[:, :, z]) if canal[:, :, z].any() else (np.array([a[0]]), np.array([a[1]]))
            line.append((np.array([a[0] + side * 3.5, cy.max() - 1.0, z]) * sp).round(1).tolist())
        veins.append(line)

    # S-levels by height (for the readout): foramen heights, and S5 / coccyx below
    level_z = {k: round(float(v["L"][0][2]) * sp[2], 1) for k, v in levels.items()}
    return {
        "midline_x": round(mid * sp[0], 1),
        "hiatus_apex": (np.array([axis[h_hi][0], axis[h_hi][2], h_hi]) * sp).round(1).tolist(),
        "hiatus_low": (np.array([axis[h_lo][0], axis[h_lo][2], h_lo]) * sp).round(1).tolist(),
        "hiatus_centre": (np.array([axis[(h_lo + h_hi) // 2][0], axis[(h_lo + h_hi) // 2][1], (h_lo + h_hi) / 2]) * sp).round(1).tolist(),
        "sac_end": (np.array(sac_end) * sp).round(1).tolist(),
        "canal_axis": [(np.array([a[0], a[1], z]) * sp).round(1).tolist() for z, a in sorted(axis.items())][::3],
        "level_z": level_z,
        "roots": roots,
        "foramina": foramina,
        "veins": veins,
    }
