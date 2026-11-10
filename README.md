# Spine Injection Simulator

Practice fluoroscopy-guided spinal injections on a real CT scan, in a phone browser or on a Meta Quest 3 (VR).

**Status: Step 1 of 5.** CT spine (L2 to coccyx), realistic C-arm images, C-arm movements, movable C-arm screen.

| Step | What | Status |
|---|---|---|
| 1 | CT spine, C-arm image, C-arm moves, movable screen | done |
| 2 | Needle: skin entry, angle, advance/withdraw, buzz on bone | next |
| 3 | Contrast at L4-5 transforaminal: right and wrong patterns, hide contrast | |
| 4 | L3-4, L4-5, L5-S1 transforaminal, facet joint, medial branch; caudal; ganglion impar | |
| 5 | Quest 3 VR polish | |

## Use it

Open the GitHub Pages link on your phone or in the Quest 3 browser.

**Phone:** drag to turn the 3D view, pinch to zoom. The C-arm screen can be dragged by its title bar and resized from its corner. ⤢ makes it big.
- Oblique ◄ ►, Tilt ▲ ▼: hold to rotate the C-arm.
- AP / LAT / Obl L / Obl R: preset positions.
- Move C-arm arrows: shift the field of view.
- Go to: centre on L3-4, L4-5, L5-S1, sacral hiatus (caudal) or sacrococcygeal junction (impar).
- SHOT: take one image. LIVE: image updates while you move the C-arm.
- Bones: see-through skin. Flip L/R: mirror the image.

**Quest 3:** press "Enter VR". Left stick: rotate/tilt C-arm. X: shot. Y: AP/LAT. Right stick: move C-arm. A: live. B: bones. Point at the screen and hold grip to move it.

## How the C-arm image is made

The image is computed from the CT: X-rays are traced from the tube, through the CT, to a 9-inch detector (tube-to-detector 100 cm, tube-to-isocentre 60 cm). Attenuation is summed along each ray, with extra weight for bone. Then the image gets automatic brightness (like a C-arm's ABC), edge enhancement, noise and a round field. Dense structures (bone, needle, contrast) are dark.

Limits: the CT has 1.5 mm voxels, so the image is a little softer than a real C-arm image.

## Data and credits

- CT: TotalSegmentator dataset v2.0.1 (small subset), case s0461, 57-year-old male, labelled "no pathology". Licence CC BY 4.0. Zenodo doi:10.5281/zenodo.10047263.
  Wasserthal J, Breit HC, Meyer MT, et al. TotalSegmentator: Robust Segmentation of 104 Anatomic Structures in CT Images. *Radiol Artif Intell.* 2023;5(5):e230024. doi:10.1148/ryai.230024
- Changes made to the CT (`tools/prepare_ct.py`): CT table and outside air removed; IV contrast removed from the aorta, IVC, iliac vessels and kidneys; cropped from the coccyx to L2; stored as 8-bit (HU = value × 10 − 1000).
- three.js r170 (MIT licence), in `vendor/three`.

This is a training aid with one patient's anatomy. It is not a medical device and does not replace supervised training.

## Files

- `index.html`, `src/` – the app (no build step)
- `data/` – prepared CT and meshes
- `tools/prepare_ct.py` – rebuilds `data/` from the source dataset
