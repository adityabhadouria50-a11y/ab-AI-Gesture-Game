/**
 * Juice Dojo rules: pure, deterministic, no DOM.
 *
 * Screen space x, y in 0..1 (y down); distances in screen heights (aspect-corrected).
 * Classic rules: fruit is tossed up from below, you slice it with a fast fingertip.
 *   - a whole fruit that falls back off the bottom costs a life (not during Frenzy)
 *   - slicing a bomb costs a life and blows up everything on screen
 *   - 3+ fruit in one stroke is a combo bonus; special fruit start Frenzy, Freeze or Double points
 *   - out of lives: game over. A life comes back at every LIFE_EVERY points (up to the max).
 */

export type FruitKind = 'watermelon' | 'orange' | 'apple' | 'lemon' | 'kiwi' | 'plum' | 'peach' | 'coconut';
export type SpecialKind = 'frenzy' | 'freeze' | 'double';
export type Kind = FruitKind | SpecialKind | 'bomb';

export const FRUITS: FruitKind[] = ['watermelon', 'orange', 'apple', 'lemon', 'kiwi', 'plum', 'peach', 'coconut'];

export const RADIUS: Record<Kind, number> = {
  watermelon: 0.072,
  coconut: 0.056,
  orange: 0.05,
  apple: 0.048,
  peach: 0.048,
  lemon: 0.044,
  plum: 0.04,
  kiwi: 0.04,
  frenzy: 0.052,
  freeze: 0.048,
  double: 0.048,
  bomb: 0.05,
};

export const POINTS: Record<Kind, number> = {
  watermelon: 15,
  coconut: 15,
  orange: 10,
  apple: 10,
  peach: 10,
  lemon: 10,
  plum: 10,
  kiwi: 10,
  frenzy: 25,
  freeze: 25,
  double: 25,
  bomb: 0,
};

export const GRAVITY = 1.25;
export const MAX_LIVES = 3;
export const LIFE_EVERY = 750;
export const BLADE_MIN_SPEED = 0.9; // screen heights / s
export const BLADE_MARGIN = 0.018;
export const STROKE_GAP_S = 0.14;
export const FRENZY_S = 5;
export const FREEZE_S = 4.5;
export const DOUBLE_S = 7;
export const FREEZE_SCALE = 0.4;

export interface Fruit {
  id: number;
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rot: number;
  vRot: number;
  age: number;
}

export interface Half {
  id: number;
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rot: number;
  vRot: number;
  /** Cut angle (aspect-corrected screen radians). */
  angle: number;
  side: 0 | 1;
  life: number;
}

export type FruitEvent =
  | { type: 'slice'; kind: Kind; x: number; y: number; angle: number; points: number; hand: number }
  | { type: 'miss'; kind: Kind; x: number }
  | { type: 'bomb'; x: number; y: number }
  | { type: 'combo'; n: number; bonus: number; x: number; y: number }
  | { type: 'power'; kind: SpecialKind }
  | { type: 'life'; lives: number }
  | { type: 'launch'; count: number; bomb: boolean };

interface Stroke {
  hits: number;
  idle: number;
  x: number;
  y: number;
}

interface Pending {
  at: number;
  kind: Kind;
  x0: number;
  y0: number;
  vx: number;
  vy: number;
}

export type Phase = 'title' | 'play' | 'over';

export interface World {
  phase: Phase;
  time: number;
  score: number;
  lives: number;
  sliced: number;
  missed: number;
  bombsHit: number;
  bestCombo: number;
  fruits: Fruit[];
  halves: Half[];
  events: FruitEvent[];
  queue: Pending[];
  strokes: Stroke[];
  nextId: number;
  waveIn: number;
  frenzyT: number;
  freezeT: number;
  doubleT: number;
  frenzySpawn: number;
  nextLifeAt: number;
  rand: () => number;
}

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

export function createWorld(seed = Date.now()): World {
  return {
    phase: 'title',
    time: 0,
    score: 0,
    lives: MAX_LIVES,
    sliced: 0,
    missed: 0,
    bombsHit: 0,
    bestCombo: 0,
    fruits: [],
    halves: [],
    events: [],
    queue: [],
    strokes: [newStroke(), newStroke()],
    nextId: 1,
    waveIn: 0.5,
    frenzyT: 0,
    freezeT: 0,
    doubleT: 0,
    frenzySpawn: 0,
    nextLifeAt: LIFE_EVERY,
    rand: mulberry32(seed),
  };
}

function newStroke(): Stroke {
  return { hits: 0, idle: 0, x: 0.5, y: 0.5 };
}

export function startGame(w: World) {
  const rand = w.rand;
  Object.assign(w, createWorld(0), { rand, phase: 'play' as Phase });
}

/** Difficulty 0..1 over the first ~2.5 minutes. */
export function difficulty(w: World) {
  return Math.min(1, w.time / 150);
}

function pick<T>(w: World, arr: T[]): T {
  return arr[Math.floor(w.rand() * arr.length) % arr.length];
}

/** Velocity for a toss from (x0, y0) that peaks at apexY and lands near targetX. */
export function tossVelocity(x0: number, y0: number, apexY: number, targetX: number) {
  const vy = -Math.sqrt(2 * GRAVITY * Math.max(0.05, y0 - apexY));
  const T = (2 * -vy) / GRAVITY;
  return { vx: (targetX - x0) / T, vy };
}

function queueToss(w: World, kind: Kind, delay: number) {
  const x0 = 0.12 + w.rand() * 0.76;
  const apex = 0.1 + w.rand() * 0.32;
  const target = 0.25 + w.rand() * 0.5;
  const v = tossVelocity(x0, 1.1, apex, target);
  w.queue.push({ at: w.time + delay, kind, x0, y0: 1.1, vx: v.vx, vy: v.vy });
}

function spawnWave(w: World) {
  const d = difficulty(w);
  const n = Math.max(w.time < 4 ? 1 : 2, Math.min(7, 1 + Math.floor(w.rand() * (2.6 + d * 4))));
  const bombChance = w.time < 6 ? 0 : 0.08 + d * 0.17;
  const pattern = w.rand();
  const stagger = pattern < 0.45 ? 0 : pattern < 0.8 ? 0.12 + w.rand() * 0.1 : 0.22;
  let bombs = 0;
  for (let i = 0; i < n; i++) {
    let kind: Kind = pick(w, FRUITS);
    if (bombs < 2 && w.rand() < bombChance) {
      kind = 'bomb';
      bombs++;
    }
    queueToss(w, kind, i * stagger);
  }
  // occasional special fruit, never two of the same effect running
  if (w.time > 10 && w.rand() < 0.07 + d * 0.04) {
    const options: SpecialKind[] = [];
    if (w.frenzyT <= 0) options.push('frenzy');
    if (w.freezeT <= 0) options.push('freeze');
    if (w.doubleT <= 0) options.push('double');
    if (options.length) queueToss(w, pick(w, options), n * stagger + 0.2);
  }
  w.events.push({ type: 'launch', count: n, bomb: bombs > 0 });
  w.waveIn = 1.55 - d * 0.75 + w.rand() * 0.45;
}

function launch(w: World, p: Pending) {
  w.fruits.push({
    id: w.nextId++,
    kind: p.kind,
    x: p.x0,
    y: p.y0,
    vx: p.vx,
    vy: p.vy,
    r: RADIUS[p.kind],
    rot: w.rand() * Math.PI * 2,
    vRot: (w.rand() - 0.5) * 5,
    age: 0,
  });
}

/** Distance from C to segment AB in screen heights. */
export function distToSegment(cx: number, cy: number, ax: number, ay: number, bx: number, by: number, aspect: number) {
  const pax = (ax - cx) * aspect, pay = ay - cy;
  const abx = (bx - ax) * aspect, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  if (l2 < 1e-9) return Math.hypot(pax, pay);
  const t = Math.max(0, Math.min(1, -(pax * abx + pay * aby) / l2));
  return Math.hypot(pax + t * abx, pay + t * aby);
}

function addHalves(w: World, f: Fruit, angle: number) {
  const nx = Math.cos(angle + Math.PI / 2), ny = Math.sin(angle + Math.PI / 2);
  for (const side of [0, 1] as const) {
    const s = side === 0 ? 1 : -1;
    const push = 0.12 + w.rand() * 0.08;
    w.halves.push({
      id: w.nextId++,
      kind: f.kind,
      x: f.x,
      y: f.y,
      vx: f.vx * 0.6 + nx * push * s,
      vy: Math.min(f.vy * 0.4, 0) + ny * push * s - 0.05,
      r: f.r,
      rot: 0,
      vRot: s * (1.5 + w.rand() * 2.5),
      angle,
      side,
      life: 2.2,
    });
  }
}

function award(w: World, base: number) {
  const pts = base * (w.doubleT > 0 ? 2 : 1);
  w.score += pts;
  while (w.score >= w.nextLifeAt) {
    w.nextLifeAt += LIFE_EVERY;
    if (w.lives < MAX_LIVES) {
      w.lives++;
      w.events.push({ type: 'life', lives: w.lives });
    }
  }
  return pts;
}

function loseLife(w: World) {
  w.lives = Math.max(0, w.lives - 1);
  w.events.push({ type: 'life', lives: w.lives });
  if (w.lives === 0) endGame(w);
}

function endGame(w: World) {
  w.phase = 'over';
  w.queue = [];
}

/**
 * One blade (hand) for one frame: the fingertip moved from p1 to p2 at `speed` screen heights / s.
 * Slow movement doesn't cut, so a resting hand never slices by accident.
 */
export function blade(
  w: World,
  hand: number,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  speed: number,
  aspect: number,
  dt: number
) {
  const st = w.strokes[hand];
  const active = w.phase === 'play' && speed >= BLADE_MIN_SPEED;
  if (!active) {
    st.idle += dt;
    if (st.idle >= STROKE_GAP_S) endStroke(w, hand);
    return;
  }
  st.idle = 0;
  const angle = Math.atan2(p2.y - p1.y, (p2.x - p1.x) * aspect);
  for (const f of [...w.fruits]) {
    if (distToSegment(f.x, f.y, p1.x, p1.y, p2.x, p2.y, aspect) > f.r + BLADE_MARGIN) continue;
    w.fruits = w.fruits.filter((o) => o.id !== f.id);
    if (f.kind === 'bomb') {
      detonate(w, f);
      if (w.phase !== 'play') return;
      continue;
    }
    addHalves(w, f, angle);
    w.sliced++;
    const pts = award(w, POINTS[f.kind]);
    st.hits++;
    st.x = f.x;
    st.y = f.y;
    w.events.push({ type: 'slice', kind: f.kind, x: f.x, y: f.y, angle, points: pts, hand });
    if (f.kind === 'frenzy') {
      w.frenzyT = FRENZY_S;
      w.frenzySpawn = 0;
      w.events.push({ type: 'power', kind: 'frenzy' });
    } else if (f.kind === 'freeze') {
      w.freezeT = FREEZE_S;
      w.events.push({ type: 'power', kind: 'freeze' });
    } else if (f.kind === 'double') {
      w.doubleT = DOUBLE_S;
      w.events.push({ type: 'power', kind: 'double' });
    }
  }
}

function detonate(w: World, bomb: Fruit) {
  w.bombsHit++;
  w.events.push({ type: 'bomb', x: bomb.x, y: bomb.y });
  // the blast destroys everything else on screen, for no points
  for (const f of w.fruits) if (f.kind !== 'bomb') addHalves(w, f, w.rand() * Math.PI);
  w.fruits = [];
  w.queue = w.queue.filter((q) => q.at > w.time + 0.8);
  for (const s of w.strokes) s.hits = 0;
  loseLife(w);
}

export function endStroke(w: World, hand: number) {
  const st = w.strokes[hand];
  if (st.hits >= 3) {
    const bonus = award(w, st.hits * 10);
    w.bestCombo = Math.max(w.bestCombo, st.hits);
    w.events.push({ type: 'combo', n: st.hits, bonus, x: st.x, y: st.y });
  }
  st.hits = 0;
}

export function step(w: World, dt: number) {
  w.time += dt;
  const timeScale = w.freezeT > 0 ? FREEZE_SCALE : 1;
  const fdt = dt * timeScale;

  if (w.phase === 'play') {
    w.frenzyT = Math.max(0, w.frenzyT - dt);
    w.freezeT = Math.max(0, w.freezeT - dt);
    w.doubleT = Math.max(0, w.doubleT - dt);

    w.waveIn -= fdt;
    if (w.waveIn <= 0 && w.queue.length === 0 && (w.fruits.length < 2 || w.waveIn < -1.2)) spawnWave(w);

    if (w.frenzyT > 0) {
      w.frenzySpawn -= dt;
      if (w.frenzySpawn <= 0) {
        w.frenzySpawn = 0.11;
        const left = w.rand() < 0.5;
        const y0 = 0.35 + w.rand() * 0.35;
        w.queue.push({
          at: w.time,
          kind: pick(w, FRUITS),
          x0: left ? -0.06 : 1.06,
          y0,
          vx: (left ? 1 : -1) * (0.45 + w.rand() * 0.35),
          vy: -(0.55 + w.rand() * 0.45),
        });
      }
    }
  } else if (w.phase === 'title') {
    // a few lazy tosses behind the intro card
    w.waveIn -= dt;
    if (w.waveIn <= 0) {
      queueToss(w, pick(w, FRUITS), 0);
      w.waveIn = 0.9 + w.rand() * 0.6;
    }
  }

  for (let i = w.queue.length - 1; i >= 0; i--) {
    if (w.queue[i].at <= w.time) {
      launch(w, w.queue[i]);
      w.queue.splice(i, 1);
    }
  }

  for (const f of w.fruits) {
    f.x += f.vx * fdt;
    f.y += f.vy * fdt;
    f.vy += GRAVITY * fdt;
    f.rot += f.vRot * fdt;
    f.age += fdt;
  }
  const kept: Fruit[] = [];
  for (const f of w.fruits) {
    const gone = f.vy > 0 && f.y - f.r > 1.04;
    if (!gone) {
      kept.push(f);
      continue;
    }
    if (w.phase === 'play' && f.kind !== 'bomb' && !isSpecial(f.kind) && w.frenzyT <= 0) {
      w.missed++;
      w.events.push({ type: 'miss', kind: f.kind, x: f.x });
      loseLife(w);
    }
  }
  w.fruits = kept;

  for (const h of w.halves) {
    h.x += h.vx * fdt;
    h.y += h.vy * fdt;
    h.vy += GRAVITY * fdt;
    h.rot += h.vRot * fdt;
    h.life -= dt;
  }
  w.halves = w.halves.filter((h) => h.life > 0 && h.y < 1.4);
}

export function isSpecial(k: Kind): k is SpecialKind {
  return k === 'frenzy' || k === 'freeze' || k === 'double';
}
