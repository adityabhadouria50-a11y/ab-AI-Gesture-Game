# Starfall Blade: Celestial Slicer

A high-performance AI webcam gesture game built on top of [open-source-hands](https://github.com/abouchedidxcode/open-source-hands) and Google's [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker).

Slice ascending cosmic crystals with your bare hands directly in front of your camera. Chain multi-combos, charge and detonate Pinch Novas, trigger two-hand Cosmic Shockwaves, and dodge dangerous Void Orbs.

Everything runs 100% locally in your browser — your webcam video never leaves your device.

---

## How to Play

| Action | Hand Gesture | Mouse / Touch Fallback | Keyboard |
| :--- | :--- | :--- | :--- |
| **Blade Slash** | Sweep your hand fast through crystals | Drag cursor across crystals | — |
| **Pinch Nova** | Pinch thumb & index together, then release | Click, hold for 0.2s, release | — |
| **Cosmic Shockwave** | Clap both open hands together | — | — |
| **Dodge Void** | Don't slice dark swirling void anomalies! | Avoid clicking/dragging through void | — |
| **Start / Restart** | Pinch on Title / Results screen | Click "Play" button | **Space** |
| **Mute Sound** | — | — | **M** |

### Target Types & Scoring
- 💎 **Astral Crystal (Cyan)**: 100 pts × combo multiplier.
- 🔮 **Prism Gem (Magenta)**: 200 pts × combo multiplier.
- 🌟 **Solar Crystal (Gold)**: 350 pts × combo multiplier.
- ✨ **Nova Star (White)**: 500 pts × combo multiplier + triggers a chain reaction auto-slicing all active crystals!
- 🕳️ **Void Anomaly (Dark Red/Black)**: -150 pts penalty, breaks combo streak, flashes red warning screen.

---

## Quick Start

```bash
# Ensure Node 20+ is in your PATH
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome or any modern browser.

> [!NOTE]
> Webcams require a secure origin (`http://localhost` or `https://`). Click **"Play with Camera"** to grant camera access, or click **"Play with Mouse / Touch"** to play immediately without a camera.

---

## Commands

```bash
npm run dev        # Vite dev server with hot reload
npm test           # Vitest unit tests (engine, mechanics & gesture detection)
npm run typecheck  # TypeScript validation
npm run build      # Production build to dist/
npm run capture    # Headless GPU Chrome test: bot plays a round & saves screenshots
npm run capture -- mobile # Same test at mobile viewport (390x844)
npm run fps        # Frame rate benchmark at DPR 2 (Target: 60 fps, p95 < 16.8 ms)
npm run loud       # Audio loudness test (Target: p90 -27 to -31 dBFS, peaks < -8)
```

---

## URL Flags & Test Hooks

| Flag | Description |
| :--- | :--- |
| `?bot=1` | Runs synthetic AI player steering through the gesture engine |
| `?autostart=1` | Bypasses title screen immediately into play mode |
| `?mute=1` | Mutes procedural audio |
| `?seed=N` | Deterministic PRNG seed for reproducible rounds |
| `?round=S` | Custom round duration in seconds (default: 45) |
| `?speed=K` | Game speed multiplier (e.g. `?speed=2`) |

Test automation hook `window.__game` exposes:
`{ phase, score, slicedCount, maxCombo, combo, time, targetsCount, mode, handsCount, fps, dpr, best }`.

---

## Architecture

- **`src/hand-gesture-kit/`**: MediaPipe Hand Landmarker + One Euro smoothing + pose & motion recognition engine.
- **`src/rules.ts`**: Pure mathematical game simulation (targets, trajectories, slicing segments, combos, split halves).
- **`src/scene.ts`**: High-performance Three.js 3D rendering (deep space nebulae, rotating 3D crystals, dynamic plasma ribbon trails, spark bursts).
- **`src/audio.ts`**: Pure procedural Web Audio API synthesis (ambient pads, blade swooshes, pentatonic chimes, sub-bass explosions).
- **`src/bot.ts`**: Autonomous bot controlling synthetic hand landmarks to slice crystals and trigger combos.
- **`src/input.ts`**: Unified input adapter translating camera, pointer, and bot sources into standard hand landmarks.
