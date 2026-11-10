# Spine Injection Simulator

Practice fluoroscopy-guided spinal injections on a real CT scan, in a phone browser or on a Meta Quest 3 (VR).

**Status: Step 2 of 5.** CT spine (L2 to coccyx), realistic C-arm images, C-arm movements, movable C-arm screen, and a needle you can place, angle, advance and withdraw, with a buzz on bone contact.

| Step | What | Status |
|---|---|---|
| 1 | CT spine, C-arm image, C-arm moves, movable screen | done |
| 2 | Needle: skin entry, angle, advance/withdraw, buzz on bone | done |
| 3 | Contrast at L4-5 transforaminal: right and wrong patterns, hide contrast | next |
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

**Needle on the phone** (Needle tab):
- "Place on skin", then tap the patient's back. The needle starts in line with the C-arm beam.
- "Aim tip to" Head / Feet / Left / Right: 1° per tap, hold to keep turning. The needle pivots at the skin. When the tip is deeper than 15 mm, tissue holds the needle, so angle changes are small: withdraw to redirect.
- Advance / Withdraw: 1 mm or 5 mm per tap; hold ±1 to keep moving.
- The needle stops on bone. You get a short vibration (Android) and a soft tick sound. iPhone browsers do not support vibration.
- "Align to beam" lines the needle up with the C-arm beam (only when shallower than 15 mm). "Needle 3.5 in / 5 in" changes the length.
- The needle shows on the C-arm image after a SHOT, or all the time in LIVE.

**Quest 3:** press "Enter VR".
- Left stick: rotate/tilt C-arm; hold the left trigger to move it instead. X: shot. Y: AP/LAT. A: live. B: bones.
- Grip: pick up the needle from the tray. Push it into the back like a real needle. It pivots at the skin entry point, and deep tissue makes it stiff. The controller buzzes on bone.
- Let go and the needle stays in. Then the right stick advances or withdraws it slowly. Grip near the hub to take it again; pull back to take it out.
- Point at the screen and hold grip to move the screen.

## How the C-arm image is made

The image is computed from the CT: X-rays are traced from the tube, through the CT, to a 9-inch detector (tube-to-detector 100 cm, tube-to-isocentre 60 cm). Attenuation is summed along each ray, with extra weight for bone. Then the image gets automatic brightness (like a C-arm's ABC), edge enhancement, noise and a round field. Dense structures (bone, needle, contrast) are dark.

Limits: the CT has 1.5 mm voxels, so the image is a little softer than a real C-arm image.

## How the needle works

The needle is a 22G spinal needle (0.7 mm). Bone is found from the CT (above 180 HU inside the segmented bones), so the needle stops where the real bone surface is. The needle is drawn into the C-arm image as a steel cylinder with a plastic hub, so a needle in line with the beam shows as a dot inside the hub ring ("hub view").

Limits for now: the needle is straight (no bevel steering or bending), and it passes through soft organs without warning. Complications and contrast come in steps 3 and 4.

## Data and credits

- CT: TotalSegmentator dataset v2.0.1 (small subset), case s0461, 57-year-old male, labelled "no pathology". Licence CC BY 4.0. Zenodo doi:10.5281/zenodo.10047263.
  Wasserthal J, Breit HC, Meyer MT, et al. TotalSegmentator: Robust Segmentation of 104 Anatomic Structures in CT Images. *Radiol Artif Intell.* 2023;5(5):e230024. doi:10.1148/ryai.230024
- Changes made to the CT (`tools/prepare_ct.py`): CT table and outside air removed; IV contrast removed from the aorta, IVC, iliac vessels and kidneys; cropped from the coccyx to L2; stored as 8-bit (HU = value × 10 − 1000).
- three.js r170 (MIT licence), in `vendor/three`.

This is a training aid with one patient's anatomy. It is not a medical device and does not replace supervised training.

## Files

- `index.html`, `src/` – the app (no build step)
- `data/` – prepared CT, tissue labels and meshes
- `tools/prepare_ct.py` – rebuilds `data/` from the source dataset
