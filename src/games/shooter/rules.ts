/**
 * Neon Strike rules: pure, deterministic, no DOM / WebGL.
 *
 * World space: metres, y up, the camera at CAM looking straight down -z with a vertical FOV of FOV degrees.
 * The renderer uses exactly this camera, so project()/ray() here agree with what's on screen.
 *
 * Enemies fly in from the horizon toward the player. Shoot them before they reach you; each one that gets through
 * drains your shield. Every 5th wave is a boss. Consecutive hits build a score multiplier; a miss resets it.
 */

export const FOV = 62;
export const CAM = { x: 0, y: 2.4, z: 0 };
export const SPAWN_Z = -64;
export const IMPACT_Z = -1.6;
export const MAG = 14;
export const RELOAD_S = 0.9;
export const FIRE_CD = 0.14;
export const RAPID_CD = 0.07;
export const RAPID_S = 6;
export const ASSIST = 0.035; // screen heights of aim forgiveness
export const MAX_SHIELD = 100;

export type EnemyKind = 'drone' | 'zig' | 'tank' | 'missile' | 'boss' | 'pickup';
export type PickupKind = 'shield' | 'rapid' | 'nuke';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  pickup?: PickupKind;
  x: number;
  y: number;
  z: number;
  /** spawn point and the point near the camera it's diving at */
  sx: number;
  sy: number;
  sz: number;
  tx: number;
  ty: number;
  speed: number;
  r: number;
  hp: number;
  maxHp: number;
  t: number;
  seed: number;
  /** boss only: next missile */
  fireIn: number;
  hitFlash: number;
}

export type ShotEvent =
  | { type: 'shot'; hand: number; sx: number; sy: number; hit: boolean; x: number; y: number; z: number; rapid: boolean }
  | { type: 'hit'; id: number; kind: EnemyKind; x: number; y: number; z: number; killed: boolean; points: number }
  | { type: 'kill'; id: number; kind: EnemyKind; x: number; y: number; z: number; points: number; pickup?: PickupKind }
  | { type: 'impact'; kind: EnemyKind; damage: number; x: number; y: number }
  | { type: 'empty' }
  | { type: 'reload' }
  | { type: 'reloaded' }
  | { type: 'wave'; wave: number; boss: boolean }
  | { type: 'waveClear'; wave: number; bonus: number }
  | { type: 'missile'; x: number; y: number; z: number }
  | { type: 'multiplier'; value: number };

export type Phase = 'title' | 'play' | 'over';

export interface World {
  phase: Phase;
  time: number;
  score: number;
  shield: number;
  wave: number;
  waveState: 'intro' | 'fight' | 'clear';
  waveTimer: number;
  toSpawn: number;
  spawnIn: number;
  enemies: Enemy[];
  events: ShotEvent[];
  ammo: number;
  reloadT: number;
  fireCd: number;
  rapidT: number;
  streak: number;
  bestStreak: number;
  multiplier: number;
  kills: number;
  shots: number;
  hits: number;
  damageTaken: number;
  nextId: number;
  rand: () => number;
}

export const POINTS: Record<EnemyKind, number> = { drone: 100, zig: 150, tank: 400, missile: 120, boss: 5000, pickup: 50 };
const DAMAGE: Record<EnemyKind, number> = { drone: 9, zig: 11, tank: 24, missile: 16, boss: 100, pickup: 0 };
const RADIUS: Record<EnemyKind, number> = { drone: 0.85, zig: 0.7, tank: 1.35, missile: 0.55, boss: 3.4, pickup: 0.75 };
const HP: Record<EnemyKind, number> = { drone: 1, zig: 1, tank: 4, missile: 1, boss: 40, pickup: 1 };
const SPEED: Record<EnemyKind, number> = { drone: 12.5, zig: 15, tank: 7.5, missile: 24, boss: 6, pickup: 9 };

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
    shield: MAX_SHIELD,
    wave: 0,
    waveState: 'intro',
    waveTimer: 0,
    toSpawn: 0,
    spawnIn: 0,
    enemies: [],
    events: [],
    ammo: MAG,
    reloadT: 0,
    fireCd: 0,
    rapidT: 0,
    streak: 0,
    bestStreak: 0,
    multiplier: 1,
    kills: 0,
    shots: 0,
    hits: 0,
    damageTaken: 0,
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
const TAN = Math.tan((FOV * Math.PI) / 360);

/** World point → screen 0..1 (y down). `scale` is screen heights per world metre at that depth. */
export function project(x: number, y: number, z: number, aspect: number) {
  const d = Math.max(0.01, CAM.z - z);
  const nx = (x - CAM.x) / (d * TAN * aspect);
  const ny = (y - CAM.y) / (d * TAN);
  return { sx: (nx + 1) / 2, sy: (1 - ny) / 2, scale: 1 / (2 * d * TAN), depth: d };
}

/** Screen 0..1 → unit ray direction from CAM. */
export function ray(sx: number, sy: number, aspect: number) {
  const x = (2 * sx - 1) * TAN * aspect;
  const y = (1 - 2 * sy) * TAN;
  const z = -1;
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
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

/** The enemy under a screen point (with aim assist), or null. */
export function pick(w: World, sx: number, sy: number, aspect: number): { e: Enemy; t: number } | null {
  const d = ray(sx, sy, aspect);
  let best: { e: Enemy; t: number } | null = null;
  for (const e of w.enemies) {
    const t = raySphere(d, e.x, e.y, e.z, e.r * 1.12);
    if (t > 0 && (!best || t < best.t)) best = { e, t };
  }
  if (best) return best;
  // aim assist: nearest projected enemy within ASSIST of the crosshair edge
  let bestGap = ASSIST;
  for (const e of w.enemies) {
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
export function isBossWave(n: number) {
  return n % 5 === 0;
}

function nextWave(w: World) {
  w.wave++;
  w.waveState = 'intro';
  w.waveTimer = w.wave === 1 ? 1.4 : 2.2;
  const boss = isBossWave(w.wave);
  w.toSpawn = boss ? 4 + w.wave : 5 + w.wave * 3;
  w.spawnIn = 0;
  w.events.push({ type: 'wave', wave: w.wave, boss });
}

function spawn(w: World, kind: EnemyKind, at?: { x: number; y: number; z: number }) {
  const sx = at ? at.x : (w.rand() - 0.5) * 34;
  const sy = at ? at.y : 1.2 + w.rand() * 7.5;
  const sz = at ? at.z : SPAWN_Z - w.rand() * 8;
  const waveSpeed = 1 + Math.min(0.9, (w.wave - 1) * 0.07);
  const hp = kind === 'boss' ? HP.boss + w.wave * 6 : HP[kind];
  const e: Enemy = {
    id: w.nextId++,
    kind,
    x: sx,
    y: sy,
    z: sz,
    sx,
    sy,
    sz,
    tx: (w.rand() - 0.5) * 2.6,
    ty: CAM.y + (w.rand() - 0.5) * 1.6,
    speed: SPEED[kind] * (kind === 'boss' ? 1 : waveSpeed) * (0.9 + w.rand() * 0.2),
    r: RADIUS[kind],
    hp,
    maxHp: hp,
    t: 0,
    seed: w.rand() * 100,
    fireIn: 3,
    hitFlash: 0,
  };
  if (kind === 'pickup') {
    const roll = w.rand();
    e.pickup = roll < 0.45 ? 'shield' : roll < 0.85 ? 'rapid' : 'nuke';
    e.tx = (w.rand() - 0.5) * 10;
    e.ty = CAM.y + 1 + w.rand() * 2;
  }
  if (kind === 'boss') {
    e.sx = e.x = 0;
    e.sy = e.y = 6;
  }
  w.enemies.push(e);
  return e;
}

function pickKind(w: World): EnemyKind {
  const n = w.wave, r = w.rand();
  if (w.rand() < 0.06) return 'pickup';
  if (n >= 4 && r < 0.12) return 'missile';
  if (n >= 3 && r < 0.3) return 'tank';
  if (n >= 2 && r < 0.55) return 'zig';
  return 'drone';
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
    w.events.push({ type: 'shot', hand, sx, sy, hit: false, x: CAM.x + d.x * 80, y: CAM.y + d.y * 80, z: CAM.z + d.z * 80, rapid });
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
  damageEnemy(w, e, 1);
  if (!rapid && w.ammo <= 0) reload(w);
  return true;
}

function setMultiplier(w: World) {
  const m = Math.min(5, 1 + Math.floor(w.streak / 6));
  if (m !== w.multiplier) {
    w.multiplier = m;
    w.events.push({ type: 'multiplier', value: m });
  }
}

function damageEnemy(w: World, e: Enemy, dmg: number) {
  e.hp -= dmg;
  e.hitFlash = 0.12;
  if (e.hp > 0) {
    w.events.push({ type: 'hit', id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z, killed: false, points: 10 });
    w.score += 10 * w.multiplier;
    return;
  }
  kill(w, e);
}

function kill(w: World, e: Enemy) {
  w.enemies = w.enemies.filter((o) => o.id !== e.id);
  const points = POINTS[e.kind] * w.multiplier;
  w.score += points;
  if (e.kind !== 'pickup') w.kills++;
  w.events.push({ type: 'kill', id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z, points, pickup: e.pickup });
  if (e.kind === 'pickup') applyPickup(w, e.pickup!);
}

function applyPickup(w: World, p: PickupKind) {
  if (p === 'shield') w.shield = Math.min(MAX_SHIELD, w.shield + 30);
  else if (p === 'rapid') {
    w.rapidT = RAPID_S;
    w.reloadT = 0;
    w.ammo = MAG;
  } else {
    for (const e of [...w.enemies]) {
      if (e.kind === 'boss') damageEnemy(w, e, 10);
      else if (e.kind !== 'pickup') kill(w, e);
    }
  }
}

export function reload(w: World) {
  if (w.phase !== 'play' || w.reloadT > 0 || w.ammo >= MAG || w.rapidT > 0) return false;
  w.reloadT = RELOAD_S;
  w.events.push({ type: 'reload' });
  return true;
}

// ------------------------------------------------------------------ simulation
export function step(w: World, dt: number) {
  w.time += dt;
  for (const e of w.enemies) e.hitFlash = Math.max(0, e.hitFlash - dt);
  if (w.phase !== 'play') {
    // idle fly-bys behind the title card
    if (w.enemies.length < 4 && w.rand() < dt * 1.5) spawn(w, 'drone');
    moveEnemies(w, dt, false);
    return;
  }

  w.fireCd = Math.max(0, w.fireCd - dt);
  w.rapidT = Math.max(0, w.rapidT - dt);
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
    if (w.waveTimer <= 0) {
      w.waveState = 'fight';
      if (isBossWave(w.wave)) spawn(w, 'boss', { x: 0, y: 6, z: SPAWN_Z });
    }
  } else if (w.waveState === 'fight') {
    if (w.toSpawn > 0) {
      w.spawnIn -= dt;
      if (w.spawnIn <= 0) {
        w.toSpawn--;
        spawn(w, pickKind(w));
        const base = Math.max(0.36, 0.95 - w.wave * 0.06);
        w.spawnIn = base * (0.6 + w.rand() * 0.8);
      }
    } else if (!w.enemies.some((e) => e.kind !== 'pickup')) {
      w.waveState = 'clear';
      w.waveTimer = 1.6;
      const bonus = 250 * w.wave + (w.shield >= MAX_SHIELD ? 500 : 0);
      w.score += bonus;
      w.events.push({ type: 'waveClear', wave: w.wave, bonus });
    }
  } else {
    w.waveTimer -= dt;
    if (w.waveTimer <= 0) nextWave(w);
  }

  moveEnemies(w, dt, true);
}

function moveEnemies(w: World, dt: number, live: boolean) {
  const out: Enemy[] = [];
  for (const e of w.enemies) {
    e.t += dt;
    if (e.kind === 'boss') {
      // fly in, hold at range, strafe and launch missiles
      e.z = Math.min(-30, e.z + e.speed * dt);
      e.x = Math.sin(e.t * 0.55 + e.seed) * 9;
      e.y = 6 + Math.sin(e.t * 1.3) * 1.2;
      if (live && e.z >= -30.5) {
        e.fireIn -= dt;
        if (e.fireIn <= 0) {
          e.fireIn = Math.max(0.9, 2.4 - w.wave * 0.08) * (0.7 + w.rand() * 0.6);
          const m = spawn(w, w.rand() < 0.25 ? 'drone' : 'missile', { x: e.x, y: e.y - 1.5, z: e.z + 2 });
          w.events.push({ type: 'missile', x: m.x, y: m.y, z: m.z });
        }
      }
      out.push(e);
      continue;
    }
    e.z += e.speed * dt;
    // progress 0 (spawn) → 1 (impact) with an ease so they dive at you at the end
    const p = Math.min(1, (e.z - e.sz) / (IMPACT_Z - e.sz));
    const ease = p * p * (3 - 2 * p);
    e.x = e.sx + (e.tx - e.sx) * ease;
    e.y = e.sy + (e.ty - e.sy) * ease;
    if (e.kind === 'zig') e.x += Math.sin(e.t * 4.5 + e.seed) * 3 * (1 - p * 0.7);
    if (e.kind === 'drone') e.y += Math.sin(e.t * 2.2 + e.seed) * 0.6 * (1 - p);
    if (e.kind === 'pickup') e.y += Math.sin(e.t * 3) * 0.3;

    if (e.z >= IMPACT_Z) {
      if (live && e.kind !== 'pickup') {
        const dmg = DAMAGE[e.kind];
        w.shield = Math.max(0, w.shield - dmg);
        w.damageTaken += dmg;
        w.streak = 0;
        setMultiplier(w);
        w.events.push({ type: 'impact', kind: e.kind, damage: dmg, x: e.x, y: e.y });
        if (w.shield <= 0) {
          w.phase = 'over';
        }
      }
      continue;
    }
    out.push(e);
  }
  // missiles a boss launched during this loop were appended to w.enemies, so for..of visited them too
  w.enemies = out;
}

export function accuracy(w: World) {
  return w.shots ? Math.round((w.hits / w.shots) * 100) : 0;
}
