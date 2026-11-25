# Handover: Gesture Arcade

## Status
Three playable hand-tracking games behind one hub, each also playable with mouse / touch and by an autonomous bot.

## What changed from Starfall Blade v0.1
- **New shell** (`src/main.ts`): hub with game cards, per-game intro / pause / results, 3-2-1 countdown, per-game best
  scores, auto-pause when the tab is hidden, mute and pause buttons, a "show your hand" hint, and a **hand-controlled
  menu cursor** (point + pinch, or dwell 1.1 s) so camera players never need the mouse.
- **Starfall Blade improved**: lit faceted crystals, crystals split into two real halves (clipping planes), a thick
  glowing ribbon blade trail (the old `THREE.Line` was always 1 px because WebGL ignores `linewidth`), pooled sparks
  (the old code created a new texture + material per spark burst and never freed meshes: a steady GPU leak), parallax
  stars, Nova charge ring, clap cooldown meter, time bar, last-5-seconds ticks, score popups, multi-slice banners,
  throttled whoosh sound.
- **Camera preview fix**: the old preview mirrored the canvas with CSS, which also flipped the already-mirrored hand
  skeleton, so the drawn hand didn't line up with the video. Now only the video is mirrored.
- **Input**: positions are sampled per render frame, so a slice segment is "where the hand was last frame → now", with
  no phantom slashes when a hand reappears; fingertip position and smoothed speed are exposed alongside the palm.
- **Sky Hunter** (new, replaced the first synthwave shooter draft): birds fly across a daytime countryside left→right
  and right→left at a calm pace (4–9 s per crossing), each escape costs one of 5 hearts. Finger-gun aim on the index
  tip, thumb-drop trigger with hysteresis, fist reload, dual-wield, aim assist, sparrows / swifts / geese (2 hits) /
  golden birds, flock waves, power-up balloons, streak multiplier, optional auto-fire. The camera is pitched up 12°
  so most of the frame is sky; `project()` / `ray()` in rules.ts include the pitch so hit-testing stays exact.
- **Juice Dojo** (new): Canvas 2D fruit slicer. 8 procedurally painted fruits with cut faces, juice stains that soak
  into the floor and dry, bombs, lives, swipe combos, Frenzy / Freeze / Double power fruit, difficulty ramp.

## Verification (this machine, headless GPU Chrome)
- `npm test`: 42/42 (starfall rules 10, gestures 3, fruit rules 9, sky hunter rules 10, thumb trigger 10).
- Thumb trigger: self-calibrates to each hand (fires when the thumb drops to 72% of its recent thumb-up gap,
  re-arms at 86%), shots use the last on-target aim from the 120 ms before the press, and an on-screen meter under
  the crosshair shows how far the thumb is pressed (yellow = armed, red = waiting for the thumb to come back up).
- `npm run typecheck`, `npm run build`: clean.
- `npm run capture`: all three bots score, Starfall reaches results and restarts, zero console / GL errors. Desktop and
  mobile (390x844) screenshots checked by eye.
- `npm run fps` at DPR 2: 60 fps, p95 16.8 ms for each game, 0 GL_INVALID.

## Not verified
- A live human webcam in varied lighting (all gesture paths were exercised with synthetic hands through the real
  engine, including the shooter's thumb-drop trigger and fist reload).
- The hand-cursor menu path with a real camera (it only activates in camera mode).
- Safari / physical iOS hardware.

## Tuning knobs
| Knob | Where | |
| :--- | :--- | :--- |
| `BLADE_RADIUS`, `NOVA_RADIUS`, `COMBO_WINDOW_S`, `CLAP_COOLDOWN_S` | `games/starfall/rules.ts` | Starfall feel |
| `BLADE_MIN_SPEED`, `BLADE_MARGIN`, `MAX_LIVES`, `LIFE_EVERY`, power-up durations | `games/fruit/rules.ts` | Juice Dojo feel |
| `CROSS` (bird speed, screen widths / s), `ASSIST`, `MAG`, `RELOAD_S`, `PITCH`, wave pacing in `step()` | `games/shooter/rules.ts` | Sky Hunter feel |
| `FIRE_RATIO`, `REARM_RATIO`, `MIN_PEAK` | `games/shooter/trigger.ts` | thumb-drop sensitivity (self-calibrating) |
| `REWIND_MS`, `FIST_HOLD_S` | `games/shooter/index.ts` | shot aim rewind, fist-to-reload hold time |
| `REGION`, `TIP_REGION` | `core/input.ts` | camera crop mapped to the screen |
| `DWELL_S` | `main.ts` | hand-cursor hold-to-click time |
