# Spine Injection Simulator

Practice fluoroscopy-guided spinal injections on a real CT scan, in a phone browser or on a Meta Quest 3 (VR).

**Status:** C-arm, needle and contrast injection work. Now adding the TFESI trainer features one at a time.

| # | Feature | Status |
|---|---|---|
| 1 | Contrast injection with live fluoro: epidural/perineural, vascular, intrathecal, subdural, intradiscal (+ soft tissue); random vascular uptake | done |
| 2 | DSA (bone subtraction) | skipped for now |
| 3 | Decision after contrast: inject steroid / reposition / stop | skipped for now |
| 4 | C-arm setup steps (square endplate, oblique, AP + lateral checks), sliders in VR | done |
| 5 | Case variety (levels, high iliac crest, S1 foramen, stenosis, scoliosis, obese) and subpedicular / infraneural approaches | paused (plan: extra real CTs + changes to this CT) |
| 6 | Needle movement per docs/needle-rules.md: free pivot under 15 mm, hub lean + shaft bend at depth, bevel drift (bent tip x2.5), back to skin | done (bone vibration and leg pain unchanged) |
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
- The needle follows `docs/needle-rules.md` (like a 22 G Quincke spinal needle in soft tissue):
  - Under 15 mm deep, "Aim toward" Head / Feet / Left / Right re-aims the whole needle, 1° per tap.
  - Deeper, the tissue holds the shaft: the arrows only lean the hub (the outside part bends). The lean is limited (about 20° at 15 mm, 10° at 30 mm, 7° at 45 mm); pushing past it gives a message. The tip turns a little toward the hub, and only while you advance.
  - Every needle drifts away from the bevel while advancing: about 3 mm at 40 mm and 9 mm at 80 mm for a straight needle; "Bent tip" drifts 2.5 x more. The yellow notch on the hub marks the bevel; the readout gives the notch o'clock and the side it drifts to.
  - "Turn hub ⟲ / ⟳" turns the hub one clock hour per tap. A turn of 30° or more restarts the early drift "kick".
  - Big redirects need withdrawal: "Back to skin" withdraws to 6 mm, and under 15 mm the needle is free to re-aim again.
- Advance / Withdraw: 1 mm or 5 mm per tap; hold ±1 to keep moving.
- The needle stops on bone. You get a short vibration (Android) and a soft tick sound. iPhone browsers do not support vibration.
- "Curved tip: ON" gives the needle a bent tip. As it advances through soft tissue it drifts toward its curve (about 0.35° per mm: ~3 mm over 30 mm). "Turn hub ⟲ / ⟳" turns the hub 45° per tap (hold to keep turning); the yellow notch on the hub and the readout show where the curve points. Withdrawing follows the same track back; turning the hub only changes the path from there on.
- "Align to beam" lines the needle up with the C-arm beam (only when shallower than 15 mm). "Needle 3.5 in / 5 in" changes the length.
- The needle shows on the C-arm image after a SHOT, or all the time in LIVE.

**Contrast** (Needle tab): "Inject contrast 1 mL" pushes 1 mL over 3 s under live fluoro. "Hide contrast" hides it on the images, "Clear contrast" removes it, "Show answer" shows or hides the name of the pattern.

**Marker pen** (Mark tab): turn "Pen" on. Tap the skin: the pen rests there and its metal tip shows on the next C-arm image, so you can check it is over the target. "✕ Mark at pen tip" draws a cross under the tip. Drag on the skin to draw lines (two fingers still zoom and move the view). The violet ink does not show on the C-arm image. "Erase marks" clears the ink.

**C-arm setup coach** (Setup tab): choose the root (L3, L4, L5) and side, and which endplate you square. "Centre on target" puts the C-arm on the foramen. Sliders set tilt, oblique and position along the spine. The checklist updates as you move:
1. true AP of the target vertebra (spinous process midway between the pedicles),
2. endplate square (degrees off, and which way to tilt),
3. oblique toward the injection side until the straight "down the beam" path to the target under the pedicle is clear of bone (and whether the needle is long enough),
4. after the needle is in: "AP check" and "Lateral check" swing the C-arm (keeping the tilt), take a shot, and report the tip: mm below the pedicle and lateral/medial to its 6 o'clock line; mm in front of/behind the posterior vertebral body line and which third of the foramen.

**Quest 3:** press "Enter VR".
- Left stick: rotate/tilt C-arm; hold the left trigger to move it instead. X: shot. Y: AP/LAT. A: live. B: bones.
- Grip: hold the needle (pick it up from the tray). Touch the back with the tip to enter there.
- Right stick up/down: advance / withdraw (gentle push = slow). Right stick left/right: turn the hub (any needle).
- Under 15 mm your hand re-aims the whole needle. Deeper, your hand only leans the hub and bends the shaft (up to the limit, with a buzz and a message above the screen); withdraw to redirect.
- Buttons under the C-arm screen and on the left wrist: BENT TIP on/off, BACK TO SKIN.
- Let go and the needle stays in; the bend springs back to straight. Grip near the hub to take it again. To take it out: withdraw to the skin, then pull your hand back.
- Right trigger: inject contrast. Right stick click: hide/show contrast. Left stick click: clear contrast.
- Marker pen: it lies on the tray next to the needle. Hold grip near it to pick it up. Touch the back to draw (light buzz); it slides on the skin and does not go in. Let go while it touches the skin and it stays standing there; take a shot to see its metal tip.
- C-arm setup panel to the left of the C-arm screen (it moves with the screen): root and side buttons, sliders for tilt, oblique and position (point and hold the trigger, then move), CENTRE, AP CHECK, LAT CHECK, SHOT, endplate choice, and the same live checklist.
- EXIT VR and ERASE INK buttons are under the C-arm screen and on your left wrist. Point with the controller and pull the trigger; for EXIT VR press twice (the first press shows "PRESS AGAIN").
- Point at the screen and hold grip to move the screen.

## How the C-arm image is made

The image is computed from the CT: X-rays are traced from the tube, through the CT, to a 9-inch detector (tube-to-detector 100 cm, tube-to-isocentre 60 cm). Attenuation is summed along each ray, with extra weight for bone. Then the image gets automatic brightness (like a C-arm's ABC), edge enhancement, noise and a round field. Dense structures (bone, needle, contrast) are dark.

Limits: the CT has 1.5 mm voxels, so the image is a little softer than a real C-arm image.

## How the needle works

The needle is a 22G spinal needle (0.7 mm). Bone is found from the CT (above 180 HU inside the segmented bones), so the needle stops where the real bone surface is. The needle is drawn into the C-arm image as a steel cylinder with a plastic hub, so a needle in line with the beam shows as a dot inside the hub ring ("hub view").

The needle's track through tissue and its tip direction are stored at every 0.25 mm, so drift and bends show on the C-arm image (up to 8 straight pieces). It passes through soft organs without warning.

Honesty note: the drift numbers come from bench studies (gel, meat, pig muscle), not living patients. The 15 mm cut-off, the lean limits and the steering at depth are estimates; no study measures them. They are named constants (`RULES` in `src/needle.js`) so they can be tuned.

Needle sources (from `docs/needle-rules.md`):
- Rand et al. Comparison of spinal needle deflection in a ballistic gel model. Anesth Pain Med 2016;6(5). doi:10.5812/aapm.36607
- Drummond & Scott. Deflection of spinal needles by the bevel. Anaesthesia 1980;35(9):854-7
- Sitzman & Uncles. The effects of needle type, gauge, and tip bend on spinal needle deflection. Anesth Analg 1996;82(2):297-301
- Webster et al. Nonholonomic modeling of needle steering. Int J Robot Res 2006

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
