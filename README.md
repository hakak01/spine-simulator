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
- Save C-arm position / Return to saved (C-arm tab and Setup tab): stores the oblique, tilt and position of the C-arm, and brings the C-arm back to them later. The saved position is kept in the browser, so it survives a page reload.
- View button (B in VR): steps through Skin → Fascia → Muscles → Nerves + vessels → Bones. Flip L/R: mirror the image.

**Needle on the phone** (Needle tab):
- "Place on skin", then tap the patient's back. The needle starts in line with the C-arm beam.
- The needle follows `docs/needle-rules.md` (like a 22 G Quincke spinal needle in soft tissue):
  - Under 15 mm deep, "Aim toward" Head / Feet / Left / Right re-aims the whole needle, 1° per tap.
  - Deeper, the tissue holds the shaft: the arrows only lean the hub (the outside part bends). The lean is limited (about 20° at 15 mm, 10° at 30 mm, 7° at 45 mm); pushing past it gives a message. The tip turns a little toward the hub, and only while you advance.
  - Every needle drifts away from the bevel while advancing: about 3 mm at 40 mm and 9 mm at 80 mm for a straight needle; "Bent tip" drifts 2.5 x more. The yellow notch on the hub marks the bevel; the readout gives the notch o'clock and the side it drifts to.
  - "Turn hub ⟲ / ⟳" turns the hub one clock hour per tap. A turn of 30° or more restarts the early drift "kick".
  - "Needle bend" slider: 100% = the rules above. 0% = rigid pipe: no bevel drift, no hub lean, no shaft bend (deeper than 15 mm the needle cannot be redirected at all; withdraw first). Values in between scale the drift, the lean limit and the steering at depth. It applies to the part of the track advanced after the change.
  - Big redirects need withdrawal: "Back to skin" withdraws to 6 mm, and under 15 mm the needle is free to re-aim again.
- Advance / Withdraw: 1 mm or 5 mm per tap; hold ±1 to keep moving.
- The needle stops on bone. You get a short vibration (Android) and a soft tick sound. iPhone browsers do not support vibration.
- "Align to beam" lines the needle up with the C-arm beam (only when shallower than 15 mm). "Needle 3.5 in / 5 in" changes the length.
- The needle shows on the C-arm image after a SHOT, or all the time in LIVE.

**Contrast** (Needle tab): "Inject contrast 1 mL" pushes 1 mL over 3 s under live fluoro (caudal: 3 mL over 6 s). "Hide contrast" hides it on the images, "Clear contrast" removes it, "Show answer" shows or hides the name of the pattern.

**Marker pen** (Mark tab): turn "Pen" on. Tap the skin: the pen rests there and its metal tip shows on the next C-arm image, so you can check it is over the target. "✕ Mark at pen tip" draws a cross under the tip. Drag on the skin to draw lines (two fingers still zoom and move the view). The violet ink does not show on the C-arm image. "Erase marks" clears the ink.

**C-arm setup coach** (Setup tab): choose the root (L3, L4, L5) and side, and which endplate you square. "Centre on target" puts the C-arm on the foramen. Sliders set tilt, oblique and position along the spine. The checklist updates as you move:
1. true AP of the target vertebra (spinous process midway between the pedicles),
2. endplate square (degrees off, and which way to tilt),
3. oblique toward the injection side until the straight "down the beam" path to the target under the pedicle is clear of bone (and whether the needle is long enough),
4. after the needle is in: "AP check" and "Lateral check" swing the C-arm (keeping the tilt), take a shot, and report the tip: mm below the pedicle and lateral/medial to its 6 o'clock line; mm in front of/behind the posterior vertebral body line and which third of the foramen.

**Caudal block** (Setup tab → Block → Caudal; in VR the BLOCK button at the top of the setup panel):
- The C-arm goes to a lateral view centred on the sacral hiatus. The checklist tells you the view (true lateral of the sacrum), whether you are centred, and, once the needle is in: where the tip is (canal, ligament, behind the sacrum, on bone, in the dural sac), how far below the end of the dural sac it is and at which sacral level, how many mm of needle are up the canal, and how far it is from the midline (check that on AP).
- Technique: enter just below the hiatus at about 45°, go through the sacrococcygeal ligament into the canal, then inject 3 mL. The needle follows the needle rules, so you can only flatten it while it is under 15 mm deep; deeper, start again lower and flatter.
- On this CT the hiatus apex is at about S4 and the dural sac ends at S2.

**Ganglion impar block** (Setup tab → Block → Ganglion impar; in VR press BLOCK until it says GANGLION IMPAR):
- Choose the route: through the sacrococcygeal joint (transsacrococcygeal), or through the first intercoccygeal joint, Co1-Co2 (transcoccygeal). The C-arm goes to a lateral view centred on that joint.
- The coccyx stops the needle everywhere except at its joints, as in real life. On lateral, find the joint (a thin pale line in the bone), enter in the midline over it, line the needle up with the joint and go straight through. On this CT the sacrococcygeal joint runs about 23° toward the head from back to front, and Co1-Co2 about 10°. Set the angle in the first 15 mm (needle rules). The joint is only about 3 mm wide, so the bevel matters: with the notch at 12 or 6 o'clock the drift pushes the tip into the bone; turn the hub so the notch is at 3 or 9 o'clock and the drift runs along the joint.
- Stop 1-3 mm past the front of the bone and inject 2 mL. The checklist shows where the tip is (behind the coccyx, in the joint, in the retrorectal space, on bone, in the rectum), how many mm it is in front of the bone, how far it is from the rectum, the needle angle against the joint line, and the distance to the ganglion.
- The rectum is close: on this CT it is about 8 mm in front of the sacrococcygeal joint and 17 mm in front of Co1-Co2. If the tip enters the rectum you get a warning (and a buzz in VR): withdraw, and use a new needle.

**Quest 3:** press "Enter VR".
- Left stick: rotate/tilt C-arm; hold the left trigger to move it instead. X: shot. Y: AP/LAT. A: live. B: bones.
- Grip: hold the needle (pick it up from the tray). Touch the back with the tip to enter there.
- Two ways to move it, usable together: (1) by hand: while gripping, push or pull your hand along the needle to advance or withdraw, and move it sideways to aim; (2) by stick: right stick up/down advances / withdraws (gentle push = slow), also when you are not gripping. Right stick left/right: turn the hub (any needle).
- Under 15 mm your hand re-aims the whole needle. Deeper, your hand only leans the hub and bends the shaft (up to the limit, with a buzz and a message above the screen); withdraw to redirect.
- Buttons under the C-arm screen and on the left wrist: BENT TIP on/off, BACK TO SKIN.
- On the C-arm setup panel: SAVE C-ARM POSITION, RETURN TO SAVED, and the "Needle bend" slider (0% rigid pipe to 100% normal).
- Let go and the needle stays in; the bend springs back to straight. Grip near the hub to take it again. To take it out: withdraw to the skin, then pull your hand back.
- Right trigger: inject contrast (1 mL; caudal 3 mL; ganglion impar 2 mL). Right stick click: hide/show contrast. Left stick click: clear contrast.
- Marker pen: it lies on the tray next to the needle. Hold grip near it to pick it up. Touch the back to draw (light buzz); it slides on the skin and does not go in. Let go while it touches the skin and it stays standing there; take a shot to see its metal tip.
- C-arm setup panel to the left of the C-arm screen (it moves with the screen): BLOCK button (transforaminal / caudal / ganglion impar), route buttons for the ganglion impar, root and side buttons, sliders for tilt, oblique and position (point and hold the trigger, then move), CENTRE, AP CHECK, LAT CHECK, SHOT, endplate choice, and the same live checklist.
- EXIT VR and ERASE INK buttons are under the C-arm screen and on your left wrist. Point with the controller and pull the trigger; for EXIT VR press twice (the first press shows "PRESS AGAIN").
- Point at the screen and hold grip to move the screen.

## How the C-arm image is made

The image is computed from the CT: X-rays are traced from the tube, through the CT, to a 9-inch detector (tube-to-detector 100 cm, tube-to-isocentre 60 cm). Attenuation is summed along each ray, with extra weight for bone. Then the image gets automatic brightness (like a C-arm's ABC), edge enhancement, noise and a round field. Dense structures (bone, needle, contrast) are dark.

Limits: the CT has 1.5 mm voxels, so the image is a little softer than a real C-arm image.

## How the needle works

The needle is a 22G spinal needle (0.7 mm). Bone is found from the CT (above 180 HU inside the segmented bones), so the needle stops where the real bone surface is. The coccyx and the lowest sacrum are thin and low in density on CT, so they always stop the needle, except at the sacrococcygeal and Co1-Co2 joints. The needle is drawn into the C-arm image as a steel cylinder with a plastic hub, so a needle in line with the beam shows as a dot inside the hub ring ("hub view").

The needle's track through tissue and its tip direction are stored at every 0.25 mm, so drift and bends show on the C-arm image (up to 8 straight pieces). It passes through soft organs without warning.

Honesty note: the drift numbers come from bench studies (gel, meat, pig muscle), not living patients. The 15 mm cut-off, the lean limits and the steering at depth are estimates; no study measures them. They are named constants (`RULES` in `src/needle.js`) so they can be tuned.

Needle sources (from `docs/needle-rules.md`):
- Rand et al. Comparison of spinal needle deflection in a ballistic gel model. Anesth Pain Med 2016;6(5). doi:10.5812/aapm.36607
- Drummond & Scott. Deflection of spinal needles by the bevel. Anaesthesia 1980;35(9):854-7
- Sitzman & Uncles. The effects of needle type, gauge, and tip bend on spinal needle deflection. Anesth Analg 1996;82(2):297-301
- Webster et al. Nonholonomic modeling of needle steering. Int J Robot Res 2006

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
| caudal: sacral canal | caudal epidural: fills the canal, climbs toward L5-S1 and runs out along the sacral roots through the foramina ("Christmas tree" on AP) |
| caudal: sacral canal, random vascular uptake (3 % just past the ligament, rising to 20 % when 10 mm or more of needle is up the canal) | vascular: streaks along the sacral epidural veins, gone in < 1 s |
| caudal: behind the sacrum or in the ligament | subcutaneous: an irregular cloud behind the sacrum, no canal outline |
| caudal: tip pressed on bone | intraosseous: marrow blush in the sacrum |
| ganglion impar: retrorectal space in front of the sacrum / coccyx (or within 1.5 mm of it) | ganglion impar: collects at the tip and runs up along the front of the bone, a "reverse comma" (apostrophe) on lateral and a midline blot on AP |
| ganglion impar: retrorectal space, random vascular uptake (5 %) | vascular: streak along the median sacral vessels, gone in < 1 s |
| ganglion impar: inside the joint | in the joint: a thin line of contrast in the joint |
| rectum | rectal: mottled contrast coating the rectal wall, plus a warning to withdraw and change the needle |
| soft tissue behind or beside the coccyx | soft tissue: an irregular cloud |

Contrast spreads through the matching space over time (a shortest-path flood through the tissue map; 1 mL transforaminal, 3 mL caudal, 2 mL ganglion impar), is smoothed, and is drawn into the C-arm image like the CT.
For comparison, a prospective study found intravascular spread in 8.1 % of lumbar and 21.3 % of S1 transforaminal injections (Furman MB et al. *Spine* 2000;25:2628-32, doi:10.1097/00007632-200010150-00014). The trainer uses higher rates on purpose.
For caudal blocks, intravascular spread was 20.3 % when the needle was advanced into the canal and 3.2 % when it stayed just past the sacrococcygeal ligament (Park SJ et al. *J Pain Res* 2018;11:2961-7, doi:10.2147/JPR.S182227); a smaller study found 24 % with the needle 1 cm into the canal vs 0 % (Doo AR et al. *Korean J Pain* 2015;28:122-8, doi:10.3344/kjp.2015.28.2.122). Without fluoroscopy, a caudal needle was in the right place only 74 % of the time (Stitz MY, Sommer HM. *Spine* 1999;24:1371-6, doi:10.1097/00007632-199907010-00016).
For ganglion impar blocks, vascular uptake was seen in 1 of 78 transcoccygeal blocks, 1.3 % (Foye PM et al. *Indian J Radiol Imaging* 2020;30:181-3, doi:10.4103/ijri.IJRI_302_19); the trainer uses 5 % on purpose. On CT, the rectum was less than 1 mm from the sacrococcyx in some patients (Kwon YS et al. *Medicine* 2020;99:e20935, doi:10.1097/MD.0000000000020935).
Ganglion impar routes: transsacrococcygeal (Toshniwal GR et al. *Pain Physician* 2007;10:661-6, PMID 17876362) and transcoccygeal through the first intercoccygeal joint; a randomised comparison found both effective, with the transcoccygeal route easier (Malhotra N et al. *J Anaesthesiol Clin Pharmacol* 2021;37:90-6, doi:10.4103/joacp.JOACP_588_20). The ganglion is a single retroperitoneal ganglion at the level of the sacrococcygeal junction (Nalini KB et al. *J Anaesthesiol Clin Pharmacol* 2018;34:544-7, doi:10.4103/joacp.JOACP_301_16).

The CT does not show nerve roots, so `tools/spine_anatomy.py` builds them: discs (between vertebral bodies), epidural space (4.5 mm ring round the dural sac), foramina (below each pedicle) and the exiting L3, L4 and L5 roots (round the lower border of the pedicle, through the upper foramen, then down and out toward the psoas).

`tools/sacral.py` builds the sacrum for the caudal block from this CT: the sacral canal (the low-density gap between the vertebral bodies and the dorsal plate, followed down the midline), the hiatus (where the dorsal plate stops), the sacrococcygeal ligament (a thin layer over the hiatus), the dorsal sacral foramina S1-S4 on both sides, and modelled S1-S4 roots and epidural veins (from the canal out through each foramen).

`tools/impar.py` builds the coccyx for the ganglion impar block. The two joints are only 1-2 voxels thick on this CT, and the marrow inside each small coccygeal body is just as dark, so their levels were picked by looking at sagittal and coronal slices (`JOINT_Z` in `tools/prepare_ct.py`); the code then finds each joint's exact height and tilt as the thin slab of lowest density there. It also marks the retrorectal (presacral) space (soft tissue in front of the sacrum and coccyx, up to the rectum, within 15 mm of the midline, from the coccyx tip to S3), and models the ganglion impar (2 mm in front of the sacrococcygeal joint), the two sympathetic trunks (medial to the anterior sacral foramina, joining at the ganglion) and the median sacral artery and vein.

## How the setup coach measures

- Endplates: a plane is fitted to the rim of each vertebral body's upper and lower endplate on the CT (the rim is what makes the endplate look like one line on fluoro). "Square" = the beam is within 1.5° of that plane.
- C-arm movement: the cranio-caudal tilt tilts the whole C and the oblique turns inside it, like a mobile C-arm, so a squared endplate stays (nearly) square when you oblique.
- True AP: the beam is perpendicular to the line joining the two pedicles of the target vertebra (within 2°).
- Target ("safe triangle", subpedicular): an open spot in the foramen 1.5-7.5 mm under the pedicle and 0-7 mm behind the posterior vertebral body line that a straight down-the-beam needle can reach with the endplate squared at a 15-35° oblique. On this CT it lies 3-6 mm lateral to the AP 6 o'clock line.
- Path check: the straight line from the target back along the beam to the skin must not pass through bone.

Caudal block:
- Lateral: the beam runs along the line between the two S1 pedicles (within 8°). Centred: the C-arm centre is within 30 mm of the hiatus.
- Tip place: the same rule as the contrast (canal, ligament, behind the sacrum, on bone, dural sac).
- Distance to the dural sac: measured along the sacral canal from the end of the sac (S2 on this CT); more than 10 mm is marked as safe.
- Needle up the canal: the length of the needle track inside the canal; more than 5 mm raises the vascular chance (see How contrast works).

Ganglion impar:
- Lateral and centred: as for the caudal block, centred on the chosen joint.
- Tip in front of the bone: signed distance from the front surface of the sacrum and coccyx in the midline; 0-6 mm is marked as good.
- Rectum: straight-line distance from the tip to the nearest rectum voxel (searched up to 30 mm); under 5 mm is marked as too close.
- Needle against the joint: the needle's angle on lateral compared with the joint line; within 8° is marked as lined up.

## Soft tissues in the 3D views

| Structure | Source |
|---|---|
| Dural sac, aorta and iliac arteries, IVC and iliac veins, erector spinae, psoas/iliacus, gluteus maximus and medius | this patient's CT (TotalSegmentator masks), smoothed |
| Discs | space between the vertebral bodies on the CT |
| Thoracolumbar fascia | built from the CT as the sheath closed around both erector spinae muscles |
| Nerve roots L3-L5 with dorsal root ganglion | modelled (CT cannot show them): round the lower border of the pedicle, through the upper foramen |
| L3 and L4 lumbar segmental arteries | modelled: from the aorta round the waist of the vertebral body to the foramen, where the spinal (radicular) branch joins the root |
| Sacral roots S1-S4, sacral epidural veins, sacrococcygeal ligament | modelled from the sacral canal, foramina and hiatus found on the CT (`tools/sacral.py`) |
| Rectum and sigmoid colon (below S2) | this patient's CT (TotalSegmentator colon mask), see-through |
| Ganglion impar, sympathetic trunks, median sacral artery and vein | modelled (`tools/impar.py`): ganglion just in front of the sacrococcygeal joint, trunks medial to the anterior sacral foramina |

Not in the model: ligamentum flavum, interspinous ligament, small veins outside the sacrum, fat as a separate layer. The soft tissues are for viewing; the needle still uses the tissue map only for bone and contrast.

## Data and credits

- CT: TotalSegmentator dataset v2.0.1 (small subset), case s0461, 57-year-old male, labelled "no pathology". Licence CC BY 4.0. Zenodo doi:10.5281/zenodo.10047263.
  Wasserthal J, Breit HC, Meyer MT, et al. TotalSegmentator: Robust Segmentation of 104 Anatomic Structures in CT Images. *Radiol Artif Intell.* 2023;5(5):e230024. doi:10.1148/ryai.230024
- Changes made to the CT (`tools/prepare_ct.py`): CT table and outside air removed; IV contrast removed from the aorta, IVC, iliac vessels and kidneys; cropped from the coccyx to L2; coccyx bone (not its joints) raised by 250 HU, because at 1.5 mm voxels the thin coccyx reads too low (partial volume) and almost vanished on the lateral image; stored as 8-bit (HU = value × 10 − 1000).
- three.js r170 (MIT licence), in `vendor/three`.

This is a training aid with one patient's anatomy. It is not a medical device and does not replace supervised training.

## Files

- `index.html`, `src/` – the app (no build step)
- `data/` – prepared CT, tissue labels and meshes
- `tools/prepare_ct.py` – rebuilds `data/` from the source dataset (with `tools/spine_anatomy.py`, `tools/soft_tissue.py`, `tools/sacral.py` and `tools/impar.py`)
