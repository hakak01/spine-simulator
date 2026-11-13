# Needle rules (spinal needle in soft tissue)

Follow these rules whenever you build or change a needle in this simulator
(transforaminal, caudal, ganglion impar or any other injection).
All numbers are in millimetres. Convert them if the 3D model uses other units.
These numbers were tested in the Lumbar TFESI Trainer (Nov 2026).

Make the spinal needle behave like a real 22 G spinal needle in soft tissue.
Follow these rules exactly.

## 1. Free pivot only near the skin
- In the first 15 mm of depth, moving the hub re-aims the whole needle.
  Rebuild the whole path from the skin entry point along the new direction.
- Deeper than 15 mm, the tissue holds the shaft. The whole needle must never
  swing freely at depth.

## 2. At depth, the hub only leans and the shaft bends
- Limit how far the outside part of the needle can lean away from the line of
  the needle inside the tissue:
  `max lean (deg) = 6 + 14 * exp(-(depth - 15) / 12)`
  (about 20° at 15 mm, 10° at 30 mm, 7° at 45 mm)
- Draw the outside part as a smooth curve: it leaves the skin along the inside
  track and bends towards the leaned hub.
- The tip does not move while the needle is still. It turns only while
  advancing, a little, towards the hub direction:
  `turn per mm = (1/45) * exp(-(depth - 15) / 8)` radians,
  multiplied by `min(1, lean angle / 10°)`.
  Never turn past the hub direction.
- If the user pushes the hub beyond the max lean: hold it at the limit, give a
  short buzz on the controller, and show (at most every 4 s):
  "Deep tissue is holding the needle: the shaft bends but the tip hardly turns.
  Withdraw to under 15 mm to redirect."
- In VR, when the user lets go of the hub, the bend springs back to straight
  within about 0.3 s.

## 3. Bevel drift on every needle
- While advancing, the tip curves away from the notch (the bevel side). This
  applies to straight needles too, not only bent tips.
- `curvature per mm = 1/580 + 0.0105 * exp(-s / 4)`
  where `s` = mm advanced since the needle entered or since the hub was last
  turned by 30° or more. The second term gives the early "kick" seen in bench
  tests.
- Bent tip: multiply the curvature by 2.5.
- Targets to test: a straight 22 G Quincke should drift about 3 mm at 40 mm
  and about 9 mm at 80 mm (Rand 2016). A bent tip should drift about 7.5 mm
  and 22 mm.
- Turning the hub turns the bevel. Notch clock: 12 o'clock = towards the head,
  clockwise as seen from the hub. Draw the notch on the hub using the same
  clock, so the drift always goes to the side opposite the notch that the user
  sees.
- Keep the tip direction as its own stored value. Do not work it out again
  from the path points, or small steps will lose drift.

### Other needle types (Rand 2016 gel study)
- Quincke, Chiba, short bevel: drift away from the bevel (rules above).
- Tuohy and Hustead: drift towards the bevel. Reverse the drift direction.
- Whitacre (pencil point): almost no drift (under 1 mm at 80 mm).
- Thinner needles (25 G) drift more than 22 G.

## 4. Big redirects need withdrawal
- A large change of direction is only possible after withdrawing to under
  15 mm. When the needle is back under 15 mm, clear any lean and allow a free
  re-aim again.
- Keep a "Back to skin" button that withdraws to about 6 mm.

## Controls
- Desktop: arrow buttons re-aim 1° per tap under 15 mm. Deeper, they only lean
  the hub (rule 2). Show once: "Deep needle: the arrows now only lean the hub
  and bend the shaft. The tip turns a little, and only as you advance."
- Always show "Turn hub" buttons and the notch o'clock reading.
- VR (Quest): grip = hold needle; right stick up/down = advance or withdraw;
  right stick left/right = turn hub, for every needle.

## Not covered here
These rules cover needle movement only. Bone contact, nerve contact, contrast
spread and scoring need their own rules.

## Honesty note for the panel
- The drift numbers come from bench studies (gel, meat, pig muscle), not living
  patients.
- The 15 mm cut-off, the lean limits and the steering at depth are estimates.
  No study measures them. Keep them as named constants so they can be tuned.

## Sources
- Rand et al. Comparison of spinal needle deflection in a ballistic gel model.
  Anesth Pain Med 2016;6(5). doi:10.5812/aapm.36607
- Drummond & Scott. Deflection of spinal needles by the bevel.
  Anaesthesia 1980;35(9):854-7 (about 1 mm per cm away from the bevel)
- Sitzman & Uncles. The effects of needle type, gauge, and tip bend on spinal
  needle deflection. Anesth Analg 1996;82(2):297-301
- Webster et al. Nonholonomic modeling of needle steering.
  Int J Robot Res 2006 (the tip turns only while advancing)
