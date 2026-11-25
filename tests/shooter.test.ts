import { describe, expect, it } from 'vitest';
import { createWorld, startGame, step, fire, reload, project, ray, raySphere, pick, spawn, halfWidth, CAM, MAG, RELOAD_S, MAX_LIVES, type Bird, type World } from '../src/games/shooter/rules';

const A = 16 / 9;
const bird = (id: number, x: number, y: number, z: number, kind: Bird['kind'] = 'sparrow', hp = 1): Bird => ({
  id, kind, x, y, z, dir: 1, vx: 0, baseY: y, amp: 0, freq: 1, exitX: 999, r: 0.75, hp, maxHp: hp, t: 0, seed: 0, hitFlash: 0,
});
const fresh = (): World => {
  const w = createWorld(7);
  startGame(w);
  w.events = [];
  w.toSpawn = 0;
  w.waveState = 'fight';
  return w;
};
const aimAt = (e: Bird) => project(e.x, e.y, e.z, A);

describe('sky hunter rules', () => {
  it('project and ray are inverses', () => {
    const p = project(3, 4, -20, A);
    const d = ray(p.sx, p.sy, A);
    const t = -20 / d.z;
    expect(CAM.x + d.x * t).toBeCloseTo(3, 6);
    expect(CAM.y + d.y * t).toBeCloseTo(4, 6);
  });

  it('a ray through a sphere centre hits it; one beside it misses', () => {
    const p = project(0, 3, -30, A);
    expect(raySphere(ray(p.sx, p.sy, A), 0, 3, -30, 1)).toBeGreaterThan(0);
    expect(raySphere(ray(p.sx + 0.2, p.sy, A), 0, 3, -30, 1)).toBe(-1);
  });

  it('birds enter from one side, fly across horizontally and leave from the other', () => {
    const w = fresh();
    for (const dir of [1, -1] as const) {
      const b = spawn(w, 'sparrow', A, { dir, z: -25 });
      const p = project(b.x, b.y, b.z, A);
      expect(dir > 0 ? p.sx < 0 : p.sx > 1).toBe(true); // starts just off-screen
      expect(Math.sign(b.vx)).toBe(dir);
      // a calm crossing: several seconds, not a blur
      const crossS = (2 * halfWidth(b.z, A)) / Math.abs(b.vx);
      expect(crossS).toBeGreaterThan(4);
      expect(crossS).toBeLessThan(10);
    }
  });

  it('a bird that crosses the whole screen escapes and costs a heart', () => {
    const w = fresh();
    w.birds = [];
    const b = spawn(w, 'sparrow', A, { dir: -1, z: -20 });
    for (let i = 0; i < 60 * 12 && w.birds.length; i++) step(w, 1 / 60, A);
    expect(w.birds).toHaveLength(0);
    expect(w.escaped).toBe(1);
    expect(w.lives).toBe(MAX_LIVES - 1);
    expect(w.events.some((e) => e.type === 'escape' && e.dir === b.dir)).toBe(true);
  });

  it('a shot on target downs a bird, uses one round, scores, and it falls', () => {
    const w = fresh();
    const e = bird(1, 2, 5, -25);
    w.birds = [e];
    const p = aimAt(e);
    expect(fire(w, p.sx, p.sy, A)).toBe(true);
    expect(w.birds).toHaveLength(0);
    expect(w.fallers).toHaveLength(1);
    expect(w.ammo).toBe(MAG - 1);
    expect(w.kills).toBe(1);
    expect(w.score).toBe(100);
  });

  it('aim assist forgives a near miss, a wide miss breaks the streak', () => {
    const w = fresh();
    const e = bird(1, 0, CAM.y + 2, -30);
    w.birds = [e];
    const p = aimAt(e);
    const edge = e.r * p.scale;
    expect(pick(w, p.sx + (edge + 0.02) / A, p.sy, A)?.e.id).toBe(1);
    expect(pick(w, p.sx + (edge + 0.2) / A, p.sy, A)).toBeNull();
    w.streak = 4;
    fire(w, 0.02, 0.98, A);
    expect(w.streak).toBe(0);
  });

  it('geese take two hits', () => {
    const w = fresh();
    const e = { ...bird(1, 0, 5, -20, 'goose', 2), r: 1.1 };
    w.birds = [e];
    const p = aimAt(e);
    fire(w, p.sx, p.sy, A);
    expect(w.birds).toHaveLength(1);
    w.fireCd = 0;
    fire(w, p.sx, p.sy, A);
    expect(w.birds).toHaveLength(0);
  });

  it('an empty gun clicks and reloads itself; reload refills after RELOAD_S', () => {
    const w = fresh();
    w.ammo = 0;
    expect(fire(w, 0.5, 0.5, A)).toBe(false);
    expect(w.events.some((e) => e.type === 'empty')).toBe(true);
    for (let t = 0; t < RELOAD_S + 0.1; t += 1 / 60) step(w, 1 / 60, A);
    expect(w.ammo).toBe(MAG);
    expect(reload(w)).toBe(false); // already full
  });

  it('balloons give power-ups', () => {
    const w = fresh();
    w.lives = 3;
    const b = { ...bird(1, 0, 3, -15, 'balloon'), pickup: 'life' as const };
    w.birds = [b];
    const p = aimAt(b);
    fire(w, p.sx, p.sy, A);
    expect(w.lives).toBe(4);
  });

  it('losing every heart ends the game; a clean wave moves on', () => {
    const w = fresh();
    w.lives = 1;
    w.birds = [{ ...bird(1, 0, 5, -20), x: 998, vx: 10 }];
    step(w, 0.5, A);
    expect(w.phase).toBe('over');

    const c = fresh();
    c.birds = [];
    step(c, 1 / 60, A);
    expect(c.waveState).toBe('clear');
    for (let i = 0; i < 150; i++) step(c, 1 / 60, A);
    expect(c.wave).toBe(2);
  });
});
