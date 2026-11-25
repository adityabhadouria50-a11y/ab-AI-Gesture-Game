/**
 * Pure rules for Starfall Blade / Celestial Slicer.
 * No DOM, no WebGL, no camera dependencies: fully deterministic and unit-testable.
 *
 * Screen space:
 *   x: 0..1 (left to right)
 *   y: 0..1 (top to bottom)
 * Distances are measured in screen heights (aspect-corrected) for consistent feel
 * across portrait, square, and ultrawide viewports.
 */

export type Phase = 'title' | 'play' | 'results';
export type TargetKind = 'crystal' | 'prism' | 'gold' | 'star' | 'void';

export interface Target {
  id: number;
  kind: TargetKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rotation: number;
  vRot: number;
  age: number;
  seed: number;
}

export interface SplitHalf {
  id: number;
  kind: TargetKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vRot: number;
  life: number;
  maxLife: number;
  halfIndex: 0 | 1;
  sliceAngle: number;
  /** Radius of the target it came from. */
  r: number;
}

export interface SliceResult {
  sliced: Target[];
  voidHit: boolean;
  starHit: boolean;
  points: number;
  combo: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface World {
  phase: Phase;
  time: number;
  roundS: number;
  score: number;
  slicedCount: number;
  maxCombo: number;
  combo: number;
  lastSliceT: number;
  targets: Target[];
  halves: SplitHalf[];
  nextId: number;
  spawnIn: number;
  waveCount: number;
  clapCooldown: number;
  voidFlash: number;
  shockwaveActive: number;
  rand: () => number;
}

export const ROUND_S = 45;
export const BLADE_RADIUS = 0.055; // Charitable hit margin in screen heights
export const NOVA_RADIUS = 0.22;
export const COMBO_WINDOW_S = 1.6;
export const CLAP_COOLDOWN_S = 6.0;
export const GRAVITY = 0.65; // Screen heights / s^2

export const POINTS: Record<TargetKind, number> = {
  crystal: 100,
  prism: 200,
  gold: 350,
  star: 500,
  void: -150,
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorld(seed = Date.now(), roundS = ROUND_S): World {
  return {
    phase: 'title',
    time: 0,
    roundS,
    score: 0,
    slicedCount: 0,
    maxCombo: 1,
    combo: 1,
    lastSliceT: -99,
    targets: [],
    halves: [],
    nextId: 1,
    spawnIn: 0.5,
    waveCount: 0,
    clapCooldown: 0,
    voidFlash: 0,
    shockwaveActive: 0,
    rand: mulberry32(seed),
  };
}

export function startRound(w: World) {
  w.phase = 'play';
  w.time = 0;
  w.score = 0;
  w.slicedCount = 0;
  w.maxCombo = 1;
  w.combo = 1;
  w.lastSliceT = -99;
  w.targets = [];
  w.halves = [];
  w.spawnIn = 0.4;
  w.waveCount = 0;
  w.clapCooldown = 0;
  w.voidFlash = 0;
  w.shockwaveActive = 0;

  // Initial wave so action starts immediately
  spawnWave(w, 2);
}

function spawnWave(w: World, count?: number) {
  const n = count ?? (1 + Math.floor(w.rand() * 3));
  w.waveCount++;

  for (let i = 0; i < n; i++) {
    const roll = w.rand();
    let kind: TargetKind = 'crystal';
    if (roll < 0.12) {
      kind = 'void';
    } else if (roll < 0.24) {
      kind = 'gold';
    } else if (roll < 0.42) {
      kind = 'prism';
    } else if (roll < 0.48) {
      kind = 'star';
    }

    const startX = 0.15 + w.rand() * 0.70;
    // Launch angle curves toward center
    const targetCenterX = 0.5;
    const dirToCenter = (targetCenterX - startX);
    const vx = dirToCenter * (0.2 + w.rand() * 0.3) + (w.rand() - 0.5) * 0.1;
    // Launch power reaches middle-to-upper screen
    const vy = -(0.75 + w.rand() * 0.28);
    const r = kind === 'gold' ? 0.038 : kind === 'void' ? 0.042 : kind === 'star' ? 0.045 : 0.035;

    w.targets.push({
      id: w.nextId++,
      kind,
      x: startX,
      y: 1.10 + i * 0.05,
      vx,
      vy,
      r,
      rotation: w.rand() * Math.PI * 2,
      vRot: (w.rand() - 0.5) * 4.0,
      age: 0,
      seed: w.rand() * 1000,
    });
  }
}

/** Distance from point C to line segment AB, in screen heights */
export function distToSegment(
  cx: number, cy: number,
  ax: number, ay: number,
  bx: number, by: number,
  aspect: number
): number {
  const pax = (ax - cx) * aspect;
  const pay = ay - cy;
  const pbx = (bx - cx) * aspect;
  const pby = by - cy;

  const abx = pbx - pax;
  const aby = pby - pay;
  const abLen2 = abx * abx + aby * aby;

  if (abLen2 < 1e-6) {
    return Math.hypot(pax, pay);
  }

  // Projection t onto segment [0, 1]
  const t = Math.max(0, Math.min(1, -(pax * abx + pay * aby) / abLen2));
  const qx = pax + t * abx;
  const qy = pay + t * aby;
  return Math.hypot(qx, qy);
}

function spawnHalves(w: World, t: Target, sliceAngle: number) {
  const normX = Math.cos(sliceAngle + Math.PI / 2);
  const normY = Math.sin(sliceAngle + Math.PI / 2);
  const speed = 0.25 + w.rand() * 0.15;

  for (let idx of [0, 1] as const) {
    const sign = idx === 0 ? 1 : -1;
    w.halves.push({
      id: w.nextId++,
      kind: t.kind,
      x: t.x,
      y: t.y,
      vx: t.vx * 0.5 + normX * speed * sign,
      vy: t.vy * 0.5 + normY * speed * sign - 0.1,
      rot: t.rotation,
      vRot: (w.rand() - 0.5) * 8.0 + sign * 3.0,
      life: 0.9,
      maxLife: 0.9,
      halfIndex: idx,
      sliceAngle,
      r: t.r,
    });
  }
}

export function trySlice(w: World, p1: Point, p2: Point, aspect: number): SliceResult {
  const res: SliceResult = {
    sliced: [],
    voidHit: false,
    starHit: false,
    points: 0,
    combo: w.combo,
  };

  if (w.phase !== 'play') return res;

  const sliceAngle = Math.atan2(p2.y - p1.y, (p2.x - p1.x) * aspect);
  const hits: Target[] = [];

  for (const t of w.targets) {
    const d = distToSegment(t.x, t.y, p1.x, p1.y, p2.x, p2.y, aspect);
    if (d <= t.r + BLADE_RADIUS) {
      hits.push(t);
    }
  }

  if (hits.length === 0) return res;

  // Process hits
  for (const t of hits) {
    w.targets = w.targets.filter((x) => x.id !== t.id);

    if (t.kind === 'void') {
      res.voidHit = true;
      w.combo = 1;
      w.score = Math.max(0, w.score + POINTS.void);
      w.voidFlash = 0.5;
    } else {
      res.sliced.push(t);
      spawnHalves(w, t, sliceAngle);

      if (t.kind === 'star') {
        res.starHit = true;
      }

      // Combo management
      if (w.time - w.lastSliceT < COMBO_WINDOW_S) {
        w.combo = Math.min(10, w.combo + 1);
      } else {
        w.combo = 1;
      }
      w.lastSliceT = w.time;
      if (w.combo > w.maxCombo) w.maxCombo = w.combo;

      const earned = POINTS[t.kind] * w.combo;
      w.score += earned;
      w.slicedCount++;
      res.points += earned;
    }
  }

  // If a star was sliced, trigger chain burst: auto-slice all other non-void targets!
  if (res.starHit) {
    const others = w.targets.filter((t) => t.kind !== 'void');
    for (const ot of others) {
      w.targets = w.targets.filter((x) => x.id !== ot.id);
      res.sliced.push(ot);
      spawnHalves(w, ot, sliceAngle);
      w.combo = Math.min(10, w.combo + 1);
      w.lastSliceT = w.time;
      if (w.combo > w.maxCombo) w.maxCombo = w.combo;
      const earned = POINTS[ot.kind] * w.combo;
      w.score += earned;
      w.slicedCount++;
      res.points += earned;
    }
  }

  res.combo = w.combo;
  return res;
}

export function tryNova(w: World, center: Point, aspect: number): SliceResult {
  const res: SliceResult = {
    sliced: [],
    voidHit: false,
    starHit: false,
    points: 0,
    combo: w.combo,
  };

  if (w.phase !== 'play') return res;

  const hits = w.targets.filter((t) => {
    const dx = (t.x - center.x) * aspect;
    const dy = t.y - center.y;
    return Math.hypot(dx, dy) <= NOVA_RADIUS + t.r;
  });

  for (const t of hits) {
    w.targets = w.targets.filter((x) => x.id !== t.id);

    if (t.kind === 'void') {
      res.voidHit = true;
      w.combo = 1;
      w.score = Math.max(0, w.score + POINTS.void);
      w.voidFlash = 0.5;
    } else {
      res.sliced.push(t);
      spawnHalves(w, t, w.rand() * Math.PI * 2);

      if (w.time - w.lastSliceT < COMBO_WINDOW_S) {
        w.combo = Math.min(10, w.combo + 1);
      } else {
        w.combo = 1;
      }
      w.lastSliceT = w.time;
      if (w.combo > w.maxCombo) w.maxCombo = w.combo;

      const earned = POINTS[t.kind] * w.combo;
      w.score += earned;
      w.slicedCount++;
      res.points += earned;
    }
  }

  res.combo = w.combo;
  return res;
}

export function tryShockwave(w: World): SliceResult {
  const res: SliceResult = {
    sliced: [],
    voidHit: false,
    starHit: false,
    points: 0,
    combo: w.combo,
  };

  if (w.phase !== 'play' || w.clapCooldown > 0) return res;

  w.clapCooldown = CLAP_COOLDOWN_S;
  w.shockwaveActive = 0.6;

  // Shockwave safely eliminates void anomalies and slices all crystals on screen
  for (const t of [...w.targets]) {
    w.targets = w.targets.filter((x) => x.id !== t.id);
    if (t.kind !== 'void') {
      res.sliced.push(t);
      spawnHalves(w, t, w.rand() * Math.PI * 2);
      w.combo = Math.min(10, w.combo + 1);
      w.lastSliceT = w.time;
      if (w.combo > w.maxCombo) w.maxCombo = w.combo;
      const earned = POINTS[t.kind] * w.combo;
      w.score += earned;
      w.slicedCount++;
      res.points += earned;
    }
  }

  res.combo = w.combo;
  return res;
}

export function step(w: World, dt: number) {
  w.time += dt;

  if (w.clapCooldown > 0) w.clapCooldown = Math.max(0, w.clapCooldown - dt);
  if (w.voidFlash > 0) w.voidFlash = Math.max(0, w.voidFlash - dt * 2.0);
  if (w.shockwaveActive > 0) w.shockwaveActive = Math.max(0, w.shockwaveActive - dt);

  // Check combo expiry
  if (w.combo > 1 && w.time - w.lastSliceT >= COMBO_WINDOW_S) {
    w.combo = 1;
  }

  // Update target physics
  for (const t of w.targets) {
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.vy += GRAVITY * dt;
    t.rotation += t.vRot * dt;
    t.age += dt;
  }

  // Remove targets that fell off bottom after being launched
  w.targets = w.targets.filter((t) => t.y < 1.35 || t.vy < 0);

  // Update split halves
  for (const h of w.halves) {
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    h.vy += (GRAVITY * 0.8) * dt;
    h.rot += h.vRot * dt;
    h.life -= dt;
  }
  w.halves = w.halves.filter((h) => h.life > 0);

  // Spawning logic during play
  if (w.phase === 'play') {
    w.spawnIn -= dt;
    if (w.spawnIn <= 0) {
      spawnWave(w);
      const progress = Math.min(1, w.time / w.roundS);
      w.spawnIn = 0.9 - progress * 0.35 + w.rand() * 0.3;
    }

    if (w.time >= w.roundS) {
      w.phase = 'results';
    }
  } else {
    // During title/results screens, keep a few drifting crystals for atmospheric visuals
    if (w.targets.length < 3) {
      spawnWave(w, 1);
    }
  }
}
