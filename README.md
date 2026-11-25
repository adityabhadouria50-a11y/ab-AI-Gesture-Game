# Gesture Arcade

Three webcam hand-tracking games that run entirely in your browser, built on
[open-source-hands](https://github.com/abouchedidxcode/open-source-hands) and Google's
[MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker).
Your video never leaves your device.

| Game | What you do | Ends when |
| :--- | :--- | :--- |
| **Starfall Blade** (3D) | Sweep your palm through rising cosmic crystals, pinch-and-release for a Nova blast, clap for a Shockwave. Dodge red Void Orbs. | 45 s timer |
| **Sky Hunter** (3D) | Birds glide across a sunny sky, left→right and right→left. Make a finger gun, aim with your index finger, drop your thumb to fire, make a fist to reload. Both hands can shoot. | 5 birds escape |
| **Juice Dojo** (2D) | Swipe your index finger fast to slice tossed fruit. 3+ in one swipe is a combo. Never cut a bomb. | You lose 3 lives |

Every game also plays with **mouse or touch**, and the menus work hands-free: with the camera on, point at a button
and **pinch** (or hold still for a second) to press it.

---

## Controls

| | Camera | Mouse / Touch | Keyboard |
| :--- | :--- | :--- | :--- |
| **Starfall** slash | Sweep your hand | Move / drag | — |
| **Starfall** Nova | Pinch, hold a beat, release | Click and hold, release | — |
| **Starfall** Shockwave | Clap both hands (6 s cooldown) | — | — |
| **Sky Hunter** aim / fire | Finger gun, drop thumb | Aim, click or hold | — |
| **Sky Hunter** reload | Fist | Right-click | **R** |
| **Sky Hunter** auto-fire | Tick *Auto-fire on target* (accessibility) | | |
| **Juice Dojo** slice | Fast index-finger swipe | Fast drag / swipe | — |
| Menus | Point + pinch, or point and hold | Click | **Space** start · **Esc/P** pause · **M** mute |

### Scoring

- **Starfall**: crystal 100, prism 200, gold 350, Nova Star 500 (chain-slices everything) × combo up to x10. Void −150 and breaks the combo.
- **Sky Hunter**: sparrow 100, swift 150 (quick, swoops), goose 250 (2 hits), golden bird 500 (rare, fast), × accuracy streak multiplier up to x5 (a miss or an escaped bird resets it). Birds take about 4–9 s to cross the screen and speed up a little each wave; every 5th wave is a flock wave with V-formations. Wave-clear bonus, extra if nothing escaped. Balloons: red +1 heart, yellow 6 s rapid fire, blue 5 s slow motion.
- **Juice Dojo**: 10–15 per fruit, +10 per fruit for 3+ in one swipe. Pink dragonfruit = 5 s Frenzy (fruit rain, misses don't count), blue = Freeze (slow motion), gold = Double points. A life comes back every 750 points.

Best scores are kept per game in `localStorage`.

---

## Quick start

```bash
npm install      # Node 20+
npm run dev      # also copies MediaPipe's wasm and downloads the hand model (~7.8 MB) on first run
```

Open `http://localhost:5173`. Cameras need a secure origin (`localhost` or `https://`).

## Commands

```bash
npm run dev        # Vite dev server
npm test           # Vitest: rules for all three games + gesture detection (31 tests)
npm run typecheck  # TypeScript
npm run build      # production build to dist/ (relative paths: works from any folder or GitHub Pages)
npm run capture    # headless GPU Chrome: bots play all three games, screenshots to captures/
npm run capture -- mobile        # same at 390x844 touch
npm run capture -- shooter       # just one game
npm run fps -- "http://localhost:5173/?bot=1&mute=1&game=shooter"   # frame-rate benchmark at DPR 2
npm run loud       # audio loudness check
```

If Playwright complains its browser is missing, either run `npx playwright install chromium-headless-shell` or point
the tools at any existing Chromium with `CHROME=/path/to/chrome npm run capture`.

## URL flags

| Flag | Effect |
| :--- | :--- |
| `?game=starfall\|shooter\|fruit` | Open that game's intro directly |
| `?bot=1` | A synthetic player drives synthetic hands through the real gesture engine (use with `?game=`) |
| `?autostart=1` | Skip the menus, play with mouse / touch |
| `?mute=1` | No sound |
| `?seed=N` | Deterministic round |
| `?round=S` | Starfall round length |
| `?wave=N` | Sky Hunter starting wave (`?wave=5` = flock wave) |
| `?speed=K` | Game speed multiplier |

Test hook: `window.__game.snapshot()` returns the current screen, game, mode, fps and that game's stats.

---

## Architecture

```
src/
  main.ts                  shell: hub, intro / pause / results cards, countdown, hand cursor, best scores, test hook
  style.css
  core/
    types.ts               the Game interface every game implements
    input.ts               camera + mouse/touch + bot → one HandView list (palm, fingertip, speed, pinch, pose)
    audio.ts               procedural Web Audio for all games (no audio files)
    ribbon.ts              Three.js helpers: glowing ribbon trail, pooled sparks, glow textures, disposal
    pinch.ts               pinch press/release latch with hysteresis
  games/
    starfall/  rules.ts · scene.ts (Three.js) · bot.ts · index.ts
    shooter/   rules.ts · scene.ts (Three.js) · index.ts (trigger detection + bot)
    fruit/     rules.ts · render.ts (Canvas 2D) · index.ts (+ bot)
  hand-gesture-kit/        MediaPipe tracking, One Euro smoothing, pose & motion engine (MIT)
```

Each game's `rules.ts` is pure and deterministic (seeded RNG, no DOM), which is what the unit tests cover. The renderers
read the world and draw it; the shell shares one WebGL renderer between the 3D games so switching never leaks a
context. All art is procedural (canvas-painted or geometry), all sound is synthesised.
