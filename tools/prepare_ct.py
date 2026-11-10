#!/usr/bin/env python3
"""Prepare the CT volume and 3D meshes used by the simulator.

Source data
-----------
TotalSegmentator dataset, small subset v2.0.1, case s0461 (57 y male, "no pathology").
Zenodo record 10047263, licence CC BY 4.0.
Wasserthal J, et al. TotalSegmentator: Robust Segmentation of 104 Anatomic Structures
in CT Images. Radiol Artif Intell. 2023;5(5):e230024. doi:10.1148/ryai.230024

What this script does
---------------------
1. Downloads only case s0461 from the remote zip (HTTP range requests).
2. Removes the CT table and everything outside the body (set to air).
3. Removes IV contrast: aorta, IVC, iliac vessels and kidneys are set to plain
   soft-tissue values, so they do not look like injected contrast on the C-arm image.
4. Crops from the coccyx (bottom of scan) up to the top of L2.
5. Saves:
   data/ct_u8.bin.gz  uint8 volume, HU = value*10 - 1000, x fastest (RAS index order)
   data/skin.bin.gz   body surface mesh
   data/bone.bin.gz   bone surface mesh
   data/ct.json       size, spacing, landmarks (mm, volume frame)

Needs: pip install remotezip nibabel numpy scipy scikit-image fast-simplification
Run:   python3 tools/prepare_ct.py [workdir]
"""
import gzip, json, os, struct, sys

import numpy as np
import nibabel as nib
from scipy import ndimage
from skimage import measure
import fast_simplification

URL = "https://zenodo.org/records/10047263/files/Totalsegmentator_dataset_small_v201.zip?download=1"
CASE = "s0461"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data")
WORK = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, ".ctwork")

VESSELS_AND_KIDNEYS = {
    "aorta": 40, "inferior_vena_cava": 40, "iliac_artery_left": 40, "iliac_artery_right": 40,
    "iliac_vena_left": 40, "iliac_vena_right": 40, "kidney_left": 35, "kidney_right": 35,
    "portal_vein_and_splenic_vein": 40,
}
BONES = ["vertebrae_L1", "vertebrae_L2", "vertebrae_L3", "vertebrae_L4", "vertebrae_L5",
         "vertebrae_S1", "sacrum", "hip_left", "hip_right", "femur_left", "femur_right",
         "vertebrae_T12", "rib_left_12", "rib_right_12", "rib_left_11", "rib_right_11"]


def fetch():
    seg_dir = os.path.join(WORK, CASE, "segmentations")
    if os.path.exists(os.path.join(WORK, CASE, "ct.nii.gz")) and os.path.isdir(seg_dir):
        return
    from remotezip import RemoteZip
    with RemoteZip(URL) as z:
        for n in z.namelist():
            if n.startswith(CASE + "/") and n.endswith(".nii.gz"):
                z.extract(n, WORK)


def load(name):
    p = os.path.join(WORK, CASE, "segmentations", name + ".nii.gz")
    return nib.load(p).get_fdata(dtype=np.float32) > 0.5


def body_mask(hu):
    m = hu > -500
    lab, n = ndimage.label(m)
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    m = lab == (1 + int(np.argmax(sizes)))
    for k in range(m.shape[2]):
        m[:, :, k] = ndimage.binary_fill_holes(m[:, :, k])
    return ndimage.binary_opening(m, iterations=2)


def save_mesh(path, verts, faces):
    verts = np.ascontiguousarray(verts, dtype=np.float32)
    faces = np.ascontiguousarray(faces, dtype=np.uint32)
    with gzip.open(path, "wb", compresslevel=9) as f:
        f.write(struct.pack("<II", len(verts), len(faces)))
        f.write(verts.tobytes())
        f.write(faces.tobytes())
    print(f"  {os.path.basename(path)}: {len(verts)} verts, {len(faces)} tris, {os.path.getsize(path)/1e6:.1f} MB")


def mesh(field, level, spacing, target_tris):
    v, f, _, _ = measure.marching_cubes(field, level=level, spacing=spacing)
    f = f[:, ::-1]  # outward winding for three.js
    if len(f) > target_tris:
        v, f = fast_simplification.simplify(v.astype(np.float32), f.astype(np.int64),
                                            target_reduction=1 - target_tris / len(f))
    return v, f


def centroid_mm(mask, sp, z_offset=0):
    idx = np.argwhere(mask).astype(np.float64)
    idx[:, 2] += z_offset
    return [round(float(c), 1) for c in idx.mean(0) * sp]


def main():
    os.makedirs(OUT, exist_ok=True)
    fetch()
    img = nib.load(os.path.join(WORK, CASE, "ct.nii.gz"))
    assert nib.aff2axcodes(img.affine) == ("R", "A", "S"), nib.aff2axcodes(img.affine)
    sp = np.array(img.header.get_zooms()[:3], dtype=np.float32)
    hu = img.get_fdata(dtype=np.float32)

    # 1. table / outside air
    body = body_mask(hu)
    hu[~body] = -1000.0
    # 2. IV contrast
    for name, val in VESSELS_AND_KIDNEYS.items():
        m = ndimage.binary_dilation(load(name), iterations=1) & body
        hu[m & (hu > val)] = val
    # 3. crop: z from bottom of scan (below coccyx) to top of L2 + 8 mm
    l2 = load("vertebrae_L2")
    z1 = int(np.where(l2.any((0, 1)))[0].max()) + int(8 / sp[2])
    z0 = 0
    xy = np.argwhere(body[:, :, z0:z1 + 1].any(2))
    (x0, y0), (x1, y1) = xy.min(0) - 3, xy.max(0) + 3
    x0, y0 = max(x0, 0), max(y0, 0)
    sl = (slice(x0, x1 + 1), slice(y0, y1 + 1), slice(z0, z1 + 1))
    hu, body = hu[sl], body[sl]
    dims = hu.shape
    print("crop dims", dims, "spacing", sp)

    u8 = np.clip(np.round((hu + 1000.0) / 10.0), 0, 255).astype(np.uint8)
    with gzip.open(os.path.join(OUT, "ct_u8.bin.gz"), "wb", compresslevel=9) as f:
        f.write(np.ascontiguousarray(u8.transpose(2, 1, 0)).tobytes())  # x fastest
    print(f"  ct_u8.bin.gz: {os.path.getsize(os.path.join(OUT, 'ct_u8.bin.gz'))/1e6:.1f} MB")

    # 4. meshes
    skin_field = ndimage.gaussian_filter(body.astype(np.float32), 1.0)
    v, f = mesh(skin_field[::2, ::2, ::2], 0.5, sp * 2, 40000)
    save_mesh(os.path.join(OUT, "skin.bin.gz"), v, f)

    bone_mask = np.zeros(dims, bool)
    for b in BONES:
        bone_mask |= load(b)[sl]
    bone_mask = ndimage.binary_dilation(bone_mask, iterations=2)
    bone_field = ndimage.gaussian_filter(np.where(bone_mask, hu, -200.0), 0.7)
    v, f = mesh(bone_field, 180.0, sp, 160000)
    save_mesh(os.path.join(OUT, "bone.bin.gz"), v, f)

    # 5. landmarks (mm in cropped volume frame, index*spacing)
    lm = {}
    for lv in ["L2", "L3", "L4", "L5"]:
        lm[lv] = centroid_mm(load("vertebrae_" + lv)[sl], sp)
    sac = load("sacrum")[sl]
    zs = np.where(sac.any((0, 1)))[0]
    top = zs.max() - int(25 / sp[2])
    lm["S1"] = centroid_mm(sac[:, :, top:], sp, top)
    # TotalSegmentator's "sacrum" label also covers the coccyx; zs.min() is the coccyx tip.
    tip = zs.min()
    lm["coccyx_tip"] = centroid_mm(sac[:, :, tip:tip + 3], sp, tip)
    lm["sacrococcygeal"] = centroid_mm(sac[:, :, tip + int(25 / sp[2]):tip + int(35 / sp[2])], sp, tip + int(25 / sp[2]))
    lm["sacral_hiatus"] = centroid_mm(sac[:, :, tip + int(45 / sp[2]):tip + int(60 / sp[2])], sp, tip + int(45 / sp[2]))
    meta = {
        "source": "TotalSegmentator dataset v2.0.1 (small subset), case " + CASE + ", CC BY 4.0, doi:10.5281/zenodo.10047263",
        "dims": [int(d) for d in dims],
        "spacing": [float(s) for s in sp],
        "encoding": "uint8, HU = v*10 - 1000, x fastest; axes: +x patient right, +y anterior, +z superior",
        "landmarks": lm,
    }
    with open(os.path.join(OUT, "ct.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(json.dumps(lm))


if __name__ == "__main__":
    main()
