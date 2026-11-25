import { describe, expect, it } from 'vitest';
import {
  createWorld,
  startRound,
  step,
  trySlice,
  tryNova,
  tryShockwave,
  distToSegment,
  POINTS,
  type Target,
} from '../src/games/starfall/rules';

const testTarget = (
  id: number,
  x: number,
  y: number,
  kind: Target['kind'] = 'crystal',
  r = 0.035
): Target => ({
  id,
  kind,
  x,
  y,
  vx: 0,
  vy: 0,
  r,
  rotation: 0,
  vRot: 0,
  age: 0,
  seed: 0,
});

describe('rules', () => {
  it('distToSegment calculates correct perpendicular distance', () => {
    // Horizontal segment from (0.2, 0.5) to (0.8, 0.5) with aspect 1
    // Point at (0.5, 0.6) is distance 0.1 away
    const d = distToSegment(0.5, 0.6, 0.2, 0.5, 0.8, 0.5, 1);
    expect(d).toBeCloseTo(0.1, 4);

    // Point beyond end of segment (0.9, 0.5) is distance 0.1 from (0.8, 0.5)
    const dEnd = distToSegment(0.9, 0.5, 0.2, 0.5, 0.8, 0.5, 1);
    expect(dEnd).toBeCloseTo(0.1, 4);
  });

  it('the same seed gives the exact same round', () => {
    const a = createWorld(777);
    const b = createWorld(777);
    startRound(a);
    startRound(b);
    for (let i = 0; i < 200; i++) {
      step(a, 1 / 60);
      step(b, 1 / 60);
    }
    expect(a.targets.map((t) => [t.x, t.y, t.kind])).toEqual(
      b.targets.map((t) => [t.x, t.y, t.kind])
    );
  });

  it('blade swipe across target slices it and spawns split halves', () => {
    const w = createWorld(1);
    startRound(w);
    w.targets = [testTarget(101, 0.5, 0.5, 'crystal', 0.035)];

    // Swipe passing through (0.45, 0.5) -> (0.55, 0.5)
    const res = trySlice(w, { x: 0.45, y: 0.5 }, { x: 0.55, y: 0.5 }, 1);
    expect(res.sliced).toHaveLength(1);
    expect(res.sliced[0].id).toBe(101);
    expect(res.points).toBe(POINTS.crystal);
    expect(w.score).toBe(POINTS.crystal);
    expect(w.targets).toHaveLength(0);
    expect(w.halves).toHaveLength(2); // Two split halves
  });

  it('blade swipe outside hit margin misses target', () => {
    const w = createWorld(1);
    startRound(w);
    w.targets = [testTarget(101, 0.5, 0.5, 'crystal', 0.035)];

    // Swipe far above target at y = 0.2
    const res = trySlice(w, { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, 1);
    expect(res.sliced).toHaveLength(0);
    expect(w.targets).toHaveLength(1);
    expect(w.score).toBe(0);
  });

  it('successive slices build combos up to 10x', () => {
    const w = createWorld(1);
    startRound(w);

    w.targets = [testTarget(1, 0.5, 0.5, 'crystal')];
    trySlice(w, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }, 1);
    expect(w.combo).toBe(1);

    w.time += 0.4; // Within combo window
    w.targets = [testTarget(2, 0.5, 0.5, 'prism')];
    trySlice(w, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }, 1);
    expect(w.combo).toBe(2);
    expect(w.score).toBe(POINTS.crystal + POINTS.prism * 2);

    w.time += 0.4;
    w.targets = [testTarget(3, 0.5, 0.5, 'gold')];
    trySlice(w, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }, 1);
    expect(w.combo).toBe(3);
  });

  it('void anomaly slice breaks combo and deducts score', () => {
    const w = createWorld(1);
    startRound(w);
    w.score = 500;
    w.combo = 4;
    w.targets = [testTarget(99, 0.5, 0.5, 'void')];

    const res = trySlice(w, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }, 1);
    expect(res.voidHit).toBe(true);
    expect(w.combo).toBe(1);
    expect(w.score).toBe(500 + POINTS.void);
    expect(w.voidFlash).toBeGreaterThan(0);
  });

  it('star slice triggers chain burst on all active crystals', () => {
    const w = createWorld(1);
    startRound(w);
    w.targets = [
      testTarget(1, 0.5, 0.5, 'star'),
      testTarget(2, 0.2, 0.3, 'crystal'),
      testTarget(3, 0.8, 0.7, 'prism'),
      testTarget(4, 0.9, 0.9, 'void'), // void should NOT be sliced
    ];

    const res = trySlice(w, { x: 0.45, y: 0.5 }, { x: 0.55, y: 0.5 }, 1);
    expect(res.starHit).toBe(true);
    expect(res.sliced).toHaveLength(3);
    // Void anomaly must remain untouched
    expect(w.targets).toHaveLength(1);
    expect(w.targets[0].kind).toBe('void');
  });

  it('nova explosion slices targets within nova radius', () => {
    const w = createWorld(1);
    startRound(w);
    w.targets = [
      testTarget(1, 0.5, 0.55, 'crystal'), // Close to center (0.5, 0.5)
      testTarget(2, 0.5, 0.95, 'crystal'), // Far from center
    ];

    const res = tryNova(w, { x: 0.5, y: 0.5 }, 1);
    expect(res.sliced).toHaveLength(1);
    expect(res.sliced[0].id).toBe(1);
    expect(w.targets).toHaveLength(1);
    expect(w.targets[0].id).toBe(2);
  });

  it('shockwave clears void anomalies and slices all crystals', () => {
    const w = createWorld(1);
    startRound(w);
    w.targets = [
      testTarget(1, 0.2, 0.2, 'crystal'),
      testTarget(2, 0.8, 0.8, 'gold'),
      testTarget(3, 0.5, 0.5, 'void'),
    ];

    const res = tryShockwave(w);
    expect(res.sliced).toHaveLength(2); // crystal and gold sliced
    expect(w.targets).toHaveLength(0); // void removed without penalty
    expect(w.clapCooldown).toBeGreaterThan(0);
  });

  it('round transitions to results phase when time expires', () => {
    const w = createWorld(1, 2); // 2 second round
    startRound(w);
    expect(w.phase).toBe('play');
    for (let i = 0; i < 130; i++) step(w, 1 / 60);
    expect(w.phase).toBe('results');
  });
});
