"""3D meshes of the soft tissues, for the see-through views of the patient.

Real (from this patient's CT, TotalSegmentator masks):
  dural sac, arteries (aorta + iliac arteries), veins (IVC + iliac veins),
  muscles (erector spinae, psoas/iliacus, gluteus maximus and medius), discs.
Built from the CT:
  thoracolumbar fascia = the sheath closed around both erector spinae muscles.
Modelled (CT cannot show them):
  nerve roots (tools/spine_anatomy.py) and the L3 and L4 lumbar segmental arteries,
  drawn round the waist of the vertebral body from the aorta to the foramen, where
  the spinal (radicular) branch joins the root.
"""
import numpy as np
from scipy import ndimage

import spine_anatomy

MUSCLES = {
    "erector": ["autochthon_left", "autochthon_right"],
    "psoas": ["iliopsoas_left", "iliopsoas_right"],
    "gluteal": ["gluteus_maximus_left", "gluteus_maximus_right", "gluteus_medius_left", "gluteus_medius_right"],
}
ARTERIES = ["aorta", "iliac_artery_left", "iliac_artery_right"]
VEINS = ["inferior_vena_cava", "iliac_vena_left", "iliac_vena_right"]


def smooth(mask, sigma=0.8):
    return ndimage.gaussian_filter(mask.astype(np.float32), sigma)


def union(load, names, sl, body):
    m = np.zeros(body.shape, bool)
    for n in names:
        try:
            m |= load(n)[sl]
        except FileNotFoundError:
            pass
    return m & body


def fascia_mask(erector):
    """Sheath around both erector spinae: close the gap over the spinous processes, 1 voxel thick skin."""
    out = np.zeros(erector.shape, bool)
    st = ndimage.generate_binary_structure(2, 1)
    for z in range(erector.shape[2]):
        s = erector[:, :, z]
        if s.any():
            out[:, :, z] = ndimage.binary_closing(ndimage.binary_dilation(s, st, iterations=1), st, iterations=7)
    return out


def lumbar_arteries(art, lab, verts, anatomy, sac, sp):
    """Modelled L3 and L4 segmental arteries: aorta -> round the body waist -> foramen (with the root)."""
    xc, yc, _ = spine_anatomy.sac_axis(sac)
    bone = lab == 2
    out = {}
    for v in ("L3", "L4"):
        body = spine_anatomy.body_mask(verts[v], yc)
        zs = np.nonzero(body.any((0, 1)))[0]
        zm = int(round((zs.min() + zs.max()) / 2))
        bx, by = np.nonzero(body[:, :, zm])
        c = np.array([bx.mean(), by.mean()])
        ax, ay = np.nonzero(art[:, :, zm])
        if not len(ax):
            continue
        i = np.argmin((ax - c[0]) ** 2 + (ay - c[1]) ** 2)
        start = np.array([ax[i], ay[i]], float)
        out[v] = {}
        solid = ndimage.binary_closing(verts[v] | bone, iterations=2)   # whole vertebra, marrow included
        for s, sg in spine_anatomy.SIDES.items():
            drg = np.array(anatomy["roots"][v][s][2]) / sp          # voxel coords
            a0 = np.arctan2(start[1] - c[1], start[0] - c[0])
            a1 = np.arctan2(drg[1] - c[1], drg[0] - c[0])
            lat = 0.0 if sg > 0 else np.pi                           # pass round the lateral side
            # unwrap so the sweep a0 -> lat -> a1 is monotonic
            def near(a, ref):
                return a + 2 * np.pi * np.round((ref - a) / (2 * np.pi))
            lat = near(lat, a0)
            a1 = near(a1, lat)
            pts = [np.array([start[0], start[1], zm], float)]
            n = 9
            for k in range(1, n):
                t = k / n
                ang = a0 + (lat - a0) * min(1, t / 0.55) if t < 0.55 else lat + (a1 - lat) * ((t - 0.55) / 0.45)
                d = np.array([np.cos(ang), np.sin(ang)])
                z = zm + (drg[2] - zm) * max(0.0, (t - 0.5) / 0.5) ** 1.5
                r = 2.0
                while r < 60:                                        # march out of the vertebral body
                    p = c + d * r
                    i = (int(round(p[0])), int(round(p[1])), int(round(z)))
                    if not solid[i]:
                        break
                    r += 0.5
                p = c + d * (r + 1.5)
                pts.append(spine_anatomy.free_spot(bone, np.array([p[0], p[1], z])))
            pts.append(spine_anatomy.free_spot(bone, drg + np.array([sg * 1.5, 1.5, 1.0])))
            out[v][s] = [(q * sp).round(1).tolist() for q in pts]
    return out


def build(load, sl, body, lab, hu, verts, anatomy, sp, mesh, save):
    """Write the mesh files; returns the info block for ct.json."""
    info = {"files": {}, "modelled": ["nerve roots", "lumbar segmental arteries", "sacral roots", "sacral veins", "sacrococcygeal ligament"]}

    def emit(name, mask, tris, sigma=0.8, level=0.5):
        if mask.sum() < 50:
            return
        v, f = mesh(smooth(mask, sigma), level, sp, tris)
        save(f"{name}.bin.gz", v, f)
        info["files"][name] = f"{name}.bin.gz"

    sac = load("spinal_cord")[sl] & body
    emit("sac", sac, 6000, 1.0)
    art = union(load, ARTERIES, sl, body)
    emit("arteries", art, 14000, 0.7)
    emit("veins", union(load, VEINS, sl, body), 14000, 0.7)
    emit("discs", lab == 10, 6000, 0.8)
    erector = union(load, MUSCLES["erector"], sl, body)
    emit("erector", erector, 22000, 1.0)
    emit("psoas", union(load, MUSCLES["psoas"], sl, body), 20000, 1.0)
    emit("gluteal", union(load, MUSCLES["gluteal"], sl, body), 22000, 1.2)
    emit("fascia", fascia_mask(erector) & body, 16000, 1.2)
    emit("ligament", lab == 15, 3000, 0.7)
    info["lumbar_arteries"] = lumbar_arteries(art, lab, verts, anatomy, sac, sp)
    return info
