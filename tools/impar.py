"""Coccyx anatomy for the ganglion impar block, built from the CT (cropped voxel frame:
x = patient right, y = anterior, z = superior).

From the CT:
  the coccyx centre line (TotalSegmentator "sacrum" mask, which includes the coccyx), the
  sacrococcygeal joint and the first intercoccygeal joint, the front surface of the sacrum and
  coccyx, and the rectum (TotalSegmentator "colon" mask, already label 6).
  The joints are only 1-2 voxels (1.5 mm) thick on this CT and the marrow inside each small
  coccygeal body is just as dark, so automatic detection was not reliable. Their levels were picked
  by looking at sagittal and coronal slices (see JOINT_Z in prepare_ct.py); this code then finds
  each joint's exact height (within 2 mm) and tilt as the thin slab of lowest density there.
Modelled (a CT cannot show them):
  the ganglion impar (just in front of the sacrococcygeal joint), the two sympathetic trunks
  (medial to the anterior sacral foramina, joining at the ganglion), the median sacral artery and
  vein, and the retrorectal (presacral) space where the contrast spreads.

Label codes added: 16 coccygeal joint (sacrococcygeal and first intercoccygeal), 17 retrorectal
(presacral) space, 18 coccyx / lowest sacrum bone. The coccyx is thin and low in density on CT
(often under 180 HU), so it is labelled 18 and always stops the needle, except at the joints.
"""
import numpy as np
from scipy import ndimage

import spine_anatomy as sa

JOINT, PRESAC, HARD = 16, 17, 18
BOWEL = 6


def centre_line(sac, xm, z_lo, z_hi):
    """Per slice z: x centre of the bone near the midline, y of the body centre (anterior part),
    front (anterior) and back (posterior) surface y. Smoothed."""
    rows = []
    for z in range(z_lo, z_hi + 1):
        xs, ys = np.nonzero(sac[:, :, z])
        if len(xs) < 3:
            continue
        near = np.abs(xs - xm) <= 8
        xc = xs[near].mean() if near.any() else xs.mean()
        yy = np.nonzero(sac[int(round(xc)) - 2:int(round(xc)) + 3, :, z].any(0))[0]
        ya, yp = yy.max(), yy.min()
        rows.append((z, xc, ya - min(4, (ya - yp) / 2), ya, yp))
    r = np.array(rows, float)
    for k in (1, 2):
        r[:, k] = ndimage.gaussian_filter1d(r[:, k], 2, mode="nearest")
    return r          # columns: z, x, y centre, y front, y back


def fit_joint(hu, sac, c, a0):
    """The joint as the thin slab of lowest density through the bone near c (x, y, z voxels).
    a = angle of the joint line in the sagittal plane, from straight anterior (+y) toward the
    head (+z). Returns (a, centre)."""
    x0 = int(round(c[0]))
    y, z = np.mgrid[0:sac.shape[1], 0:sac.shape[2]]
    m2 = sac[x0 - 3:x0 + 4].any(0) & (np.hypot(y - c[1], z - c[2]) <= 7)
    h2 = hu[x0 - 3:x0 + 4].mean(0)
    def slab(a, o):
        n = np.array([-np.sin(a), np.cos(a)])            # normal in (y, z)
        return m2 & (np.abs((y - c[1]) * n[0] + (z - c[2]) * n[1] - o) <= 0.6)
    ref = slab(np.radians(a0), 0).sum()
    best = None
    for a in np.radians(np.arange(a0 - 25, a0 + 25.1, 2.5)):
        for o in np.arange(-1.5, 1.51, 0.5):
            s = slab(a, o)
            k = s.sum()
            if k < 0.6 * ref or k < 4:
                continue
            v = h2[s].mean()
            if best is None or v < best[0]:
                best = (v, a, o)
    _, a, o = best
    n = np.array([-np.sin(a), np.cos(a)])
    return a, np.array([c[0], c[1] + o * n[0], c[2] + o * n[1]])


def build(lab, hu, sac, sp, anatomy, joint_z):
    """joint_z: {"scj": z, "cj1": z} voxel levels of the sacrococcygeal and first intercoccygeal
    joints at the coccyx centre line (picked on the CT, see prepare_ct.py)."""
    S = anatomy["sacral"]
    xm = S["midline_x"] / sp[0]
    zs = np.nonzero(sac.any((0, 1)))[0]
    tip = int(zs.min())
    canal_end = int(np.nonzero((lab == 14).any((0, 1)))[0].min())
    line = centre_line(sac, xm, tip, canal_end + 12)
    zl = line[:, 0].astype(int)
    joints = {}
    sac_d = ndimage.binary_dilation(sac, iterations=1)
    X, Y, Z = np.ogrid[0:lab.shape[0], 0:lab.shape[1], 0:lab.shape[2]]
    jmask = np.zeros(lab.shape, bool)
    ring = np.zeros(lab.shape, bool)
    for name in ("scj", "cj1"):
        i = int(np.argmin(np.abs(zl - joint_z[name])))
        z, x, y = line[i, 0], line[i, 1], line[i, 2]
        a, c = fit_joint(hu, sac, np.array([x, y, z]), 0.0)
        u = np.array([np.cos(a), np.sin(a)])                          # along the joint, toward the front
        n = np.array([-np.sin(a), np.cos(a)])
        d = (Y - c[1]) * n[0] + (Z - c[2]) * n[1]
        along = (Y - c[1]) * u[0] + (Z - c[2]) * u[1]
        slab = sac_d & (np.abs(d) <= 1.0) & (np.abs(along) <= 9) & (np.abs(X - c[0]) <= 10)
        jmask |= slab & sac
        ring |= slab & ~sac          # the openings of the joint, just outside the bone outline
        # front and back of the joint (where the slab leaves the bone, at the centre x)
        cols = [t for t in np.arange(-9, 9.01, 0.5)
                if sac[int(round(c[0])), int(round(c[1] + t * u[0])), int(round(c[2] + t * u[1]))]]
        front = c + np.array([0, (max(cols) + 0.5) * u[0], (max(cols) + 0.5) * u[1]])
        back = c + np.array([0, (min(cols) - 0.5) * u[0], (min(cols) - 0.5) * u[1]])
        joints[name] = {"c": c, "front": front, "back": back, "a": a, "u": u}

    # coccyx and lowest sacrum: always bone for the needle, except the joints
    zlow = int(round(joints["scj"]["c"][2])) + 10
    hard = sac & (Z <= zlow) & ~jmask & ~np.isin(lab, (12, 13, 14, 15))
    lab[hard] = HARD
    lab[jmask & np.isin(lab, (1, 2, 7, HARD))] = JOINT
    lab[ring & (lab == 2)] = 1                                       # dense bone edge at the openings: passable

    # front surface of the bone, per (x, z): most anterior bone voxel
    z_top = int(round(S["level_z"]["S3"] / sp[2]))
    z_s1 = int(round(S["level_z"]["S1"] / sp[2]))
    zr = range(tip - 2, z_top + 1)
    front_y = np.full((lab.shape[0], lab.shape[2]), -1)
    anyb = sac.any(1)
    yidx = np.arange(lab.shape[1])
    for z in range(tip - 2, min(lab.shape[2], z_s1 + 6)):
        for x in range(int(xm) - 14, int(xm) + 15):
            if anyb[x, z]:
                front_y[x, z] = yidx[sac[x, :, z]].max()

    # retrorectal (presacral) space: soft tissue in front of the sacrum / coccyx, up to the rectum,
    # within 15 mm of the midline, from the coccyx tip up to S3
    gsc = joints["scj"]["front"]
    gx = gsc[0]
    space = np.zeros(lab.shape, bool)
    mid_front = {int(r[0]): r[3] for r in line}
    for z in zr:
        ym = mid_front.get(z)
        if ym is None:
            ys = front_y[int(round(gx)) - 2:int(round(gx)) + 3, z]
            ym = ys.max() if (ys >= 0).any() else None
        if ym is None:
            continue
        for x in range(int(round(gx)) - 10, int(round(gx)) + 11):
            yb = front_y[x, z] if front_y[x, z] >= 0 else ym
            for y in range(int(yb) + 1, int(yb) + 13):
                l = lab[x, y, z]
                if l in (2, HARD, JOINT) and y <= yb + 2:   # bone or joint edge just in front of the outline
                    continue
                if l == BOWEL or l not in (1, 7):
                    break
                space[x, y, z] = True
    lab[space] = PRESAC

    # modelled ganglion impar: 2 mm in front of the sacrococcygeal joint (not into the rectum)
    u = joints["scj"]["u"]
    g = gsc + np.array([0, 1.3 * u[0], 1.3 * u[1]])
    for t in np.arange(1.3, -0.01, -0.1):
        p = gsc + np.array([0, t * u[0], t * u[1]])
        if lab[tuple(np.round(p).astype(int))] != BOWEL:
            g = p
            break

    # sympathetic trunks: medial to the anterior sacral foramina (where the S roots leave the front
    # of the sacrum), joining at the ganglion
    trunks, bone = {}, lab == 2
    for s, sg in sa.SIDES.items():
        pts = []
        for lv in ("S1", "S2", "S3", "S4"):
            r = S["roots"].get(lv, {}).get(s)
            if not r:
                continue
            p2 = np.array(r[2]) / sp
            off = max(4 / sp[0], abs(p2[0] - xm) - 7 / sp[0])
            x = int(round(xm + sg * off)); z = int(round(p2[2]))
            yb = front_y[x, z] if 0 <= z < front_y.shape[1] and front_y[x, z] >= 0 else p2[1] - 2
            pts.append(sa.free_spot(bone, np.array([x, yb + 1.5, z]), 2))
        pts.append(g + np.array([sg * 1.0, 0, 1.5]))
        trunks[s] = [(np.array(q) * sp).round(1).tolist() for q in pts]

    # median sacral artery and vein: on the front of the sacrum in the midline, S1 to 10 mm above the joint
    vessels = {}
    zj = int(round(joints["scj"]["c"][2])) + int(10 / sp[2])
    for name, code, dx in (("artery", 4, 1.0), ("vein", 5, -1.0)):
        pts = []
        for z in range(z_s1, zj - 1, -4):
            ys = front_y[int(round(xm)) - 1:int(round(xm)) + 2, z] if z < front_y.shape[1] else np.array([-1])
            if (ys < 0).all():
                continue
            pts.append(np.array([xm + dx, ys.max() + 1.2, z]))
        if len(pts) >= 2:
            tube = sa.tube(lab.shape, pts, [0.8] * len(pts)) & np.isin(lab, (1, PRESAC))
            lab[tube] = code
            vessels[name] = [(q * sp).round(1).tolist() for q in pts]

    # front surface along the coccyx centre line (y, z in mm), for "tip in front of the coccyx"
    front = []
    for z in range(tip, z_top + 1, 2):
        x = int(round(np.interp(z, line[:, 0], line[:, 1]))) if z <= line[-1, 0] else int(round(xm))
        if front_y[x, z] >= 0:
            front.append([round(float(front_y[x, z] + 0.5) * sp[1], 1), round(z * sp[2], 1)])

    def mm(p):
        return (np.array(p, float) * sp).round(1).tolist()
    out = {"tip": mm([line[0, 1], line[0, 2], tip]), "ganglion": mm(g), "trunks": trunks,
           "vessels": vessels, "front": front, "midline_x": round(float(gx * sp[0]), 1)}
    for name, j in joints.items():
        out[name] = {"c": mm(j["c"]), "front": mm(j["front"]), "back": mm(j["back"]),
                     # direction through the joint from back to front (y, z), and its tilt from straight
                     # anterior toward the head, in degrees
                     "dir": [round(float(j["u"][0]), 3), round(float(j["u"][1]), 3)],
                     "tilt": round(float(np.degrees(j["a"])), 1)}
    # rectum distance in front of each joint (mm, along the joint line)
    for name in ("scj", "cj1"):
        j = joints[name]
        dist = None
        for t in np.arange(0, 30, 0.25):
            p = j["front"] + np.array([0, t * j["u"][0], t * j["u"][1]])
            if lab[tuple(np.round(p).astype(int))] == BOWEL:
                dist = round(float(t * sp[1]), 1)
                break
        out[name]["rectum_mm"] = dist
    return out
