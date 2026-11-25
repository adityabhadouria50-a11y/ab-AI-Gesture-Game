/**
 * Sky Hunter rules: pure, deterministic, no DOM / WebGL.
 *
 * World space: metres, y up, the camera at CAM looking straight down -z with a vertical FOV of FOV degrees.
 * The renderer uses exactly this camera, so project()/ray() here agree with what's on screen.
 *
 * Birds fly across the sky from one side to the other (left→right or right→left) at different heights and
 * distances, bobbing as they flap. Shoot them before they cross; every bird that gets away costs a life.
 * Balloons drift up from the ground carrying power-ups. Consecutive hits build a score multiplier.
 */

export const FOV = 62;
export const CAM = { x: 0, y: 2.4, z: 0 };
/** The camera looks up a little, so most of the frame is sky. */
export const PITCH = 0.22;
export const MAG = 10;
export const RELOAD_S = 0.9;
export const FIRE_CD = 0.16;
export const RAPID_CD = 0.08;
export const RAPID_S = 6;
export const SLOWMO_S = 5;
export const SLOWMO_SCALE = 0.45;
export const ASSIST = 0.035; // screen heights of aim forgiveness
export const MAX_LIVES = 5;
export const GRAVITY = 14;

export type BirdKind = 'sparrow' | 'swift' | 'goose' | 'golden' | 'balloon';
export type PickupKind = 'life' | 'rapid' | 'slowmo';

export interface Bird {
  id: number;
  kind: BirdKind;
  pickup?: PickupKind;
  x: number;
  y: number;
  z: number;
  /** +1 flies left→right, −1 right→left (balloons: 0, they rise). */
  dir: 1 | -1 | 0;
  /** horizontal speed in world units / s (already includes depth scaling) */
  vx: number;
  baseY: number;
  amp: number;
  freq: number;
  /** x where the bird has left the screen */
  exitX: number;
  r: number;
  hp: number;
  maxHp: number;
  t: number;
  seed: number;
  hitFlash: number;
}

/** A shot bird tumbling to the ground (visual only, but simulated here so it's deterministic). */
export interface Faller {
  id: number;
  kind: BirdKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  rot: number;
  dir: 1 | -1 | 0;
}

export type ShotEvent =
  | { type: 'shot'; hand: number; sx: number; sy: number; hit: boolean; x: number; y: number; z: number; rapid: boolean }
  | { type: 'hit'; id: number; kind: BirdKind; x: number; y: number; z: number }
  | { type: 'kill'; id: number; kind: BirdKind; x: number; y: number; z: number; points: number; pickup?: PickupKind }
  | { type: 'escape'; kind: BirdKind; x: number; y: number; z: number; dir: number }
  | { type: 'empty' }
  | { type: 'reload' }
  | { type: 'reloaded' }
  | { type: 'wave'; wave: number; flock: boolean }
  | { type: 'waveClear'; wave: number; bonus: number }
  | { type: 'multiplier'; value: number };

export type Phase = 'title' | 'play' | 'over';

export interface World {
  phase: Phase;
  time: number;
  score: number;
  lives: number;
  wave: number;
  waveState: 'intro' | 'fight' | 'clear';
  waveTimer: number;
  toSpawn: number;
  spawnIn: number;
  birds: Bird[];
  fallers: Faller[];
  events: ShotEvent[];
  ammo: number;
  reloadT: number;
  fireCd: number;
  rapidT: number;
  slowT: number;
  streak: number;
  bestStreak: number;
  multiplier: number;
  kills: number;
  escaped: number;
  shots: number;
  hits: number;
  nextId: number;
  rand: () => number;
}

export const POINTS: Record<BirdKind, number> = { sparrow: 100, swift: 150, goose: 250, golden: 500, balloon: 50 };
const RADIUS: Record<BirdKind, number> = { sparrow: 0.9, swift: 0.72, goose: 1.3, golden: 0.85, balloon: 0.85 };
const HP: Record<BirdKind, number> = { sparrow: 1, swift: 1, goose: 2, golden: 1, balloon: 1 };
/** Crossing speed as screen widths per second (so near and far birds take about as long to cross). */
const CROSS: Record<BirdKind, number> = { sparrow: 0.15, swift: 0.22, goose: 0.11, golden: 0.26, balloon: 0 };

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
    wave: 0,
    waveState: 'intro',
    waveTimer: 0,
    toSpawn: 0,
    spawnIn: 0,
    birds: [],
    fallers: [],
    events: [],
    ammo: MAG,
    reloadT: 0,
    fireCd: 0,
    rapidT: 0,
    slowT: 0,
    streak: 0,
    bestStreak: 0,
    multiplier: 1,
    kills: 0,
    escaped: 0,
    shots: 0,
    hits: 0,
    nextId: 1,
    rand: mulberry32(seed),
  };
}

export function startGame(w: World, firstWave = 1) {
  const rand = w.rand;
  Object.assign(w, createWorld(0), { rand, phase: 'play' as Phase, wave: Math.max(0, firstWave - 1) });
  nextWave(w);
}

// ------------------------------------------------------------------ camera model
const HALF = (FOV * Math.PI) / 360;
const TAN = Math.tan(HALF);
const CP = Math.cos(PITCH), SP = Math.sin(PITCH);

/** World point → screen 0..1 (y down). `scale` is screen heights per world metre at that depth. */
export function project(x: number, y: number, z: number, aspect: number) {
  const dx = x - CAM.x, dy = y - CAM.y, dz = z - CAM.z;
  // into camera space (undo the upward pitch)
  const yc = dy * CP + dz * SP;
  const d = Math.max(0.01, -(-dy * SP + dz * CP));
  const nx = dx / (d * TAN * aspect);
  const ny = yc / (d * TAN);
  return { sx: (nx + 1) / 2, sy: (1 - ny) / 2, scale: 1 / (2 * d * TAN), depth: d };
}

/** Screen 0..1 → unit ray direction from CAM (world space). */
export function ray(sx: number, sy: number, aspect: number) {
  const x = (2 * sx - 1) * TAN * aspect;
  const yc = (1 - 2 * sy) * TAN;
  // camera-space (x, yc, -1) rotated up by the pitch
  const y = yc * CP + SP;
  const z = yc * SP - CP;
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
}

/** Half the visible width (world units) at depth z for a given aspect. */
export function halfWidth(z: number, aspect: number) {
  return (CAM.z - z) * TAN * aspect;
}

/** World height at horizontal distance `dist` for an elevation angle (radians) above the horizon. */
function heightAt(dist: number, elevation: number) {
  return CAM.y + dist * Math.tan(elevation);
}

/** Distance along the ray to the sphere, or -1. */
export function raySphere(d: { x: number; y: number; z: number }, cx: number, cy: number, cz: number, r: number) {
  const ox = CAM.x - cx, oy = CAM.y - cy, oz = CAM.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : -1;
}

/** The bird under a screen point (with aim assist), or null. */
export function pick(w: World, sx: number, sy: number, aspect: number): { e: Bird; t: number } | null {
  const d = ray(sx, sy, aspect);
  let best: { e: Bird; t: number } | null = null;
  for (const e of w.birds) {
    const t = raySphere(d, e.x, e.y, e.z, e.r * 1.15);
    if (t > 0 && (!best || t < best.t)) best = { e, t };
  }
  if (best) return best;
  let bestGap = ASSIST;
  for (const e of w.birds) {
    const p = project(e.x, e.y, e.z, aspect);
    const gap = Math.hypot((p.sx - sx) * aspect, p.sy - sy) - e.r * p.scale;
    if (gap < bestGap) {
      bestGap = gap;
      best = { e, t: p.depth };
    }
  }
  return best;
}

// ------------------------------------------------------------------ waves
/** Every 5th wave is a big flock. */
export function isFlockWave(n: number) {
  return n % 5 === 0;
}

function speedScale(w: World) {
  return 1 + Math.min(0.6, (w.wave - 1) * 0.05);
}

function nextWave(w: World) {
  w.wave++;
  w.waveState = 'intro';
  w.waveTimer = w.wave === 1 ? 1.4 : 2.2;
  const flock = isFlockWave(w.wave);
  w.toSpawn = flock ? 10 + w.wave * 2 : 4 + w.wave * 2;
  w.spawnIn = 0;
  w.events.push({ type: 'wave', wave: w.wave, flock });
}

/**
 * Spawns a bird just off one side of the screen. `aspect` is the viewport's, so birds always enter from the
 * visible edge; rules stay deterministic for a fixed aspect.
 */
export function spawn(w: World, kind: BirdKind, aspect: number, opts: { dir?: 1 | -1; z?: number; y?: number } = {}) {
  const z = opts.z ?? -(12 + w.rand() * 20);
  const hw = halfWidth(z, aspect);
  const r = RADIUS[kind];
  const base: Bird = {
    id: w.nextId++,
    kind,
    x: 0,
    y: 0,
    z,
    dir: 0,
    vx: 0,
    baseY: 0,
    amp: 0,
    freq: 0,
    exitX: 0,
    r,
    hp: HP[kind],
    maxHp: HP[kind],
    t: 0,
    seed: w.rand() * 100,
    hitFlash: 0,
  };
  if (kind === 'balloon') {
    const roll = w.rand();
    base.pickup = roll < 0.4 ? 'life' : roll < 0.75 ? 'rapid' : 'slowmo';
    base.x = (w.rand() - 0.5) * hw * 1.4;
    base.y = base.baseY = heightAt(CAM.z - z, PITCH - HALF) - 1.5;
    base.amp = 0.4;
    base.freq = 1.2;
    w.birds.push(base);
    return base;
  }
  const dir: 1 | -1 = opts.dir ?? (w.rand() < 0.5 ? 1 : -1);
  // visible sky band at this distance: from just above the tree line to below the top of the frame
  const dist = CAM.z - z;
  const top = heightAt(dist, PITCH + HALF * 0.78);
  const low = heightAt(dist, 0.06);
  base.dir = dir;
  base.baseY = base.y = opts.y ?? low + w.rand() * (top - low);
  // the tilted camera sees a little wider higher up: size the entry / exit edge at the bird's real depth
  const edge = Math.max(hw, project(0, base.y, z, aspect).depth * TAN * aspect) + r * 2;
  base.x = -dir * edge;
  base.exitX = dir * edge;
  base.vx = dir * CROSS[kind] * 2 * hw * speedScale(w) * (0.85 + w.rand() * 0.3);
  base.amp = kind === 'swift' ? 0.9 + w.rand() * 0.8 : kind === 'goose' ? 0.25 : 0.4 + w.rand() * 0.5;
  base.freq = kind === 'swift' ? 2.2 : kind === 'goose' ? 0.8 : 1.4 + w.rand() * 0.6;
  w.birds.push(base);
  return base;
}

function pickKind(w: World): BirdKind {
  const n = w.wave, r = w.rand();
  if (w.rand() < 0.07) return 'balloon';
  if (r < 0.06) return 'golden';
  if (n >= 3 && r < 0.26) return 'goose';
  if (n >= 2 && r < 0.5) return 'swift';
  return 'sparrow';
}

// ------------------------------------------------------------------ actions
/** Pulls the trigger at a screen point. Returns false if the gun couldn't fire (cooldown, empty, reloading). */
export function fire(w: World, sx: number, sy: number, aspect: number, hand = 0): boolean {
  if (w.phase !== 'play' || w.fireCd > 0 || w.reloadT > 0) return false;
  const rapid = w.rapidT > 0;
  if (!rapid && w.ammo <= 0) {
    w.events.push({ type: 'empty' });
    w.fireCd = 0.25;
    reload(w);
    return false;
  }
  w.fireCd = rapid ? RAPID_CD : FIRE_CD;
  if (!rapid) w.ammo--;
  w.shots++;
  const hit = pick(w, sx, sy, aspect);
  if (!hit) {
    const d = ray(sx, sy, aspect);
    w.events.push({ type: 'shot', hand, sx, sy, hit: false, x: CAM.x + d.x * 60, y: CAM.y + d.y * 60, z: CAM.z + d.z * 60, rapid });
    if (w.streak > 0) {
      w.streak = 0;
      setMultiplier(w);
    }
    if (!rapid && w.ammo <= 0) reload(w);
    return true;
  }
  const e = hit.e;
  w.hits++;
  w.streak++;
  w.bestStreak = Math.max(w.bestStreak, w.streak);
  setMultiplier(w);
  w.events.push({ type: 'shot', hand, sx, sy, hit: true, x: e.x, y: e.y, z: e.z, rapid });
  damage(w, e);
  if (!rapid && w.ammo <= 0) reload(w);
  return true;
}

function setMultiplier(w: World) {
  const m = Math.min(5, 1 + Math.floor(w.streak / 5));
  if (m !== w.multiplier) {
    w.multiplier = m;
    w.events.push({ type: 'multiplier', value: m });
  }
}

function damage(w: World, e: Bird) {
  e.hp -= 1;
  e.hitFlash = 0.15;
  if (e.hp > 0) {
    w.events.push({ type: 'hit', id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z });
    // a hit goose panics and speeds up
    e.vx *= 1.35;
    return;
  }
  kill(w, e);
}

function kill(w: World, e: Bird) {
  w.birds = w.birds.filter((o) => o.id !== e.id);
  const points = POINTS[e.kind] * w.multiplier;
  w.score += points;
  if (e.kind !== 'balloon') {
    w.kills++;
    w.fallers.push({ id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z, vx: e.vx * 0.3, vy: 2, rot: 0, dir: e.dir });
  }
  w.events.push({ type: 'kill', id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z, points, pickup: e.pickup });
  if (e.pickup) applyPickup(w, e.pickup);
}

function applyPickup(w: World, p: PickupKind) {
  if (p === 'life') w.lives = Math.min(MAX_LIVES, w.lives + 1);
  else if (p === 'rapid') {
    w.rapidT = RAPID_S;
    w.reloadT = 0;
    w.ammo = MAG;
  } else w.slowT = SLOWMO_S;
}

export function reload(w: World) {
  if (w.phase !== 'play' || w.reloadT > 0 || w.ammo >= MAG || w.rapidT > 0) return false;
  w.reloadT = RELOAD_S;
  w.events.push({ type: 'reload' });
  return true;
}

// ------------------------------------------------------------------ simulation
export function step(w: World, dt: number, aspect = 16 / 9) {
  w.time += dt;
  for (const e of w.birds) e.hitFlash = Math.max(0, e.hitFlash - dt);
  // slow motion slows the birds, not the player
  const bdt = w.slowT > 0 ? dt * SLOWMO_SCALE : dt;

  if (w.phase !== 'play') {
    // a few birds drift past behind the title card
    if (w.birds.length < 3 && w.rand() < dt * 0.8) spawn(w, w.rand() < 0.3 ? 'goose' : 'sparrow', aspect);
    moveBirds(w, bdt, false);
    moveFallers(w, dt);
    return;
  }

  w.fireCd = Math.max(0, w.fireCd - dt);
  w.rapidT = Math.max(0, w.rapidT - dt);
  w.slowT = Math.max(0, w.slowT - dt);
  if (w.reloadT > 0) {
    w.reloadT -= dt;
    if (w.reloadT <= 0) {
      w.reloadT = 0;
      w.ammo = MAG;
      w.events.push({ type: 'reloaded' });
    }
  }

  if (w.waveState === 'intro') {
    w.waveTimer -= dt;
    if (w.waveTimer <= 0) w.waveState = 'fight';
  } else if (w.waveState === 'fight') {
    if (w.toSpawn > 0) {
      w.spawnIn -= bdt;
      if (w.spawnIn <= 0) {
        w.toSpawn--;
        if (isFlockWave(w.wave) && w.rand() < 0.5) {
          // flock waves send small V-formations
          const dir: 1 | -1 = w.rand() < 0.5 ? 1 : -1;
          const z = -(18 + w.rand() * 16);
          const y = heightAt(-z, 0.15 + w.rand() * 0.35);
          for (let k = 0; k < 3; k++) {
            const b = spawn(w, 'sparrow', aspect, { dir, z: z - k * 1.5, y: y - Math.abs(k - 1) * 0.8 });
            b.x -= dir * k * 2.2;
          }
        } else spawn(w, pickKind(w), aspect);
        const base = Math.max(0.7, 1.9 - w.wave * 0.1);
        w.spawnIn = base * (0.7 + w.rand() * 0.6);
      }
    } else if (!w.birds.some((e) => e.kind !== 'balloon')) {
      w.waveState = 'clear';
      w.waveTimer = 1.8;
      const bonus = 200 * w.wave + (w.escaped === 0 ? 300 : 0);
      w.score += bonus;
      w.events.push({ type: 'waveClear', wave: w.wave, bonus });
    }
  } else {
    w.waveTimer -= dt;
    if (w.waveTimer <= 0) nextWave(w);
  }

  moveBirds(w, bdt, true);
  moveFallers(w, dt);
}

function moveBirds(w: World, dt: number, live: boolean) {
  const out: Bird[] = [];
  for (const e of w.birds) {
    e.t += dt;
    if (e.kind === 'balloon') {
      e.baseY += 1.1 * dt;
      e.y = e.baseY;
      e.x += Math.sin(e.t * e.freq + e.seed) * e.amp * dt;
      if (e.y > heightAt(CAM.z - e.z, PITCH + HALF) + 2) continue;
      out.push(e);
      continue;
    }
    e.x += e.vx * dt;
    e.y = e.baseY + Math.sin(e.t * e.freq * Math.PI + e.seed) * e.amp;
    const gone = e.dir > 0 ? e.x > e.exitX : e.x < e.exitX;
    if (gone) {
      if (live) {
        w.escaped++;
        w.lives = Math.max(0, w.lives - 1);
        w.streak = 0;
        setMultiplier(w);
        w.events.push({ type: 'escape', kind: e.kind, x: e.x, y: e.y, z: e.z, dir: e.dir });
        if (w.lives <= 0) w.phase = 'over';
      }
      continue;
    }
    out.push(e);
  }
  w.birds = out;
}

function moveFallers(w: World, dt: number) {
  for (const f of w.fallers) {
    f.vy -= GRAVITY * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.rot += dt * 9;
  }
  w.fallers = w.fallers.filter((f) => f.y > -3);
}

export function accuracy(w: World) {
  return w.shots ? Math.round((w.hits / w.shots) * 100) : 0;
}
