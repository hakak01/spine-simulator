# Spine Injection Simulator

Practice fluoroscopy-guided spinal injections on a real CT scan, in a phone browser or on a Meta Quest 3 (VR).

**Status:** C-arm, needle and contrast injection work. Now adding the TFESI trainer features one at a time.

| # | Feature | Status |
|---|---|---|
| 1 | Contrast injection with live fluoro: epidural/perineural, vascular, intrathecal, subdural, intradiscal (+ soft tissue); random vascular uptake | done |
| 2 | DSA (bone subtraction) | skipped for now |
| 3 | Decision after contrast: inject steroid / reposition / stop | skipped for now |
| 4 | C-arm setup steps (square endplate, oblique, AP + lateral checks), sliders in VR | next |
| 5 | Case variety (levels, high iliac crest, S1 foramen, stenosis, scoliosis, obese) and subpedicular / infraneural approaches | |
| 6 | Curved-tip needle with bevel steering, root contact = leg pain | |
| 7 | Score sheet | |
| 8 | Random case mode (answer hidden until debrief) | |
| 9 | Show ideal needle placement | |
| 10 | Move the C-arm screen in VR | already works (grip on the screen) |
| 11 | Marker pen for the skin entry point | done |
| – | EXIT VR button inside VR | done |
| 12 | Show nerve roots | |

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

**Contrast** (Needle tab): "Inject contrast 1 mL" pushes 1 mL over 3 s under live fluoro. "Hide contrast" hides it on the images, "Clear contrast" removes it, "Show answer" shows or hides the name of the pattern.

**Marker pen** (Mark tab): turn "Pen" on. Tap the skin: the pen rests there and its metal tip shows on the next C-arm image, so you can check it is over the target. "✕ Mark at pen tip" draws a cross under the tip. Drag on the skin to draw lines (two fingers still zoom and move the view). The violet ink does not show on the C-arm image. "Erase marks" clears the ink.

**Quest 3:** press "Enter VR".
- Left stick: rotate/tilt C-arm; hold the left trigger to move it instead. X: shot. Y: AP/LAT. A: live. B: bones.
- Grip: pick up the needle from the tray. Push it into the back like a real needle. It pivots at the skin entry point, and deep tissue makes it stiff. The controller buzzes on bone.
- Let go and the needle stays in. Then the right stick advances or withdraws it slowly. Grip near the hub to take it again; pull back to take it out.
- Right trigger: inject contrast. Right stick click: hide/show contrast. Left stick click: clear contrast.
- Marker pen: it lies on the tray next to the needle. Hold grip near it to pick it up. Touch the back to draw (light buzz); it slides on the skin and does not go in. Let go while it touches the skin and it stays standing there; take a shot to see its metal tip.
- EXIT VR and ERASE INK buttons are under the C-arm screen and on your left wrist. Point with the controller and pull the trigger; for EXIT VR press twice (the first press shows "PRESS AGAIN").
- Point at the screen and hold grip to move the screen.

## How the C-arm image is made

The image is computed from the CT: X-rays are traced from the tube, through the CT, to a 9-inch detector (tube-to-detector 100 cm, tube-to-isocentre 60 cm). Attenuation is summed along each ray, with extra weight for bone. Then the image gets automatic brightness (like a C-arm's ABC), edge enhancement, noise and a round field. Dense structures (bone, needle, contrast) are dark.

Limits: the CT has 1.5 mm voxels, so the image is a little softer than a real C-arm image.

## How the needle works

The needle is a 22G spinal needle (0.7 mm). Bone is found from the CT (above 180 HU inside the segmented bones), so the needle stops where the real bone surface is. The needle is drawn into the C-arm image as a steel cylinder with a plastic hub, so a needle in line with the beam shows as a dot inside the hub ring ("hub view").

Limits for now: the needle is straight (no bevel steering or bending), and it passes through soft organs without warning. Complications and contrast come in steps 3 and 4.

## How contrast works

The tip position decides the pattern, using the tissue map:

| Tip in | Pattern |
|---|---|
| foramen / epidural space (or within 1.5 mm of it) | epidural / perineural: contrast tracks along the root sleeve and into the epidural space |
| foramen, but random vascular uptake (20 % lumbar, 40 % S1, rolled once per tip position) | vascular: fast streak (radicular artery with hairpin into the anterior spinal artery, or epidural veins), gone in < 1 s |
| dural sac, outer 1.5 mm | subdural: thin, one-sided, long cranio-caudal line |
| dural sac, deeper | intrathecal: myelogram, pools anteriorly (dependent when prone) |
| disc | intradiscal: nucleogram |
| muscle / soft tissue | soft tissue: patchy streaks |

Contrast spreads through the matching space over time (a shortest-path flood through the tissue map, 1 mL), is smoothed, and is drawn into the C-arm image like the CT.
For comparison, a prospective study found intravascular spread in 8.1 % of lumbar and 21.3 % of S1 transforaminal injections (Furman MB et al. *Spine* 2000;25:2628-32, doi:10.1097/00007632-200010150-00014). The trainer uses higher rates on purpose.

The CT does not show nerve roots, so `tools/spine_anatomy.py` builds them: discs (between vertebral bodies), epidural space (4.5 mm ring round the dural sac), foramina (below each pedicle) and the exiting L3, L4 and L5 roots (round the lower border of the pedicle, through the upper foramen, then down and out toward the psoas).

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
