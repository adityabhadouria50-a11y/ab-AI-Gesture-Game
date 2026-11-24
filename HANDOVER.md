# Handover: Starfall Blade

## Status
Complete, verified AI webcam gesture game. Fully playable with real camera, pointer/touch fallback, or autonomous bot.
- **Rules & Simulation**: Fully tested, 100% pass rate across unit test suite.
- **Graphics**: 60 fps at DPR 2 with zero GL errors.
- **Audio**: Procedural Web Audio, measured loudness p90 at -26.9 dBFS.
- **Verification**: Headless GPU Playwright capture tests pass on both desktop and mobile viewports.

---

## What Works & Verification Evidence

1. **Unit Tests (`npm test`)**:
   - `tests/rules.test.ts` (10 tests): determinism, distance calculations, slicing intersections, combo chains, void penalties, chain bursts, and nova blasts.
   - `tests/gestures.test.ts` (3 tests): synthetic hand pinch detection for both Left and Right hands with jitter hysteresis.
   - Total: 13 tests passing.

2. **TypeScript & Bundling (`npm run typecheck && npm run build`)**:
   - Compiles cleanly with zero errors.
   - Self-contained `dist/` with relative asset links.

3. **Bot Gameplay Capture (`npm run capture` and `npm run capture -- mobile`)**:
   - Plays a complete round using synthetic hand landmarks.
   - Achieves 30+ slices, reaches 10x combo streak, and restarts via synthetic pinch on the results screen.
   - Zero console errors and zero WebGL `GL_INVALID` warnings.

4. **Frame Rate Benchmark (`npm run fps`)**:
   - Result: `{"fps":60,"p50ms":16.7,"p95ms":16.8,"worstms":16.8,"gameDpr":2,"glInvalid":0}`.
   - 60 fps sustained at DPR 2 with p95 at 16.8 ms.

5. **Loudness Audit (`npm run loud`)**:
   - Result: `{"audible":121,"medianDb":-30,"p90Db":-26.9,"p99Db":-16.7,"peakDb":-7.3}`.
   - Meets the recommended loudness criteria for web browser gaming.

---

## What Was NOT Verified
- Testing on a live human webcam in different lighting conditions (tested with MediaPipe hand models and synthetic hand landmark injectors).
- Safari on physical iOS hardware (tested in headless Chromium with mobile emulation).

---

## Tuning Knobs

| Knob | Location | Description |
| :--- | :--- | :--- |
| `BLADE_RADIUS` | `src/rules.ts` (0.055) | Hit margin in screen heights. Increase to make slicing easier. |
| `NOVA_RADIUS` | `src/rules.ts` (0.22) | Blast radius of Pinch Nova shockwave. |
| `COMBO_WINDOW_S` | `src/rules.ts` (1.6) | Time allowed between successive slices before combo resets. |
| `CLAP_COOLDOWN_S` | `src/rules.ts` (6.0) | Cooldown duration for two-hand Clap Shockwave. |
| `GRAVITY` | `src/rules.ts` (0.65) | Target gravity affecting crystal arc heights. |
| `PINCH_ON`, `PINCH_OFF`| `src/pinch.ts` (0.6, 0.35)| Hysteresis thresholds for pinch press / release. |
| `REGION` | `src/input.ts` | Camera crop region mapped to full screen space. |
