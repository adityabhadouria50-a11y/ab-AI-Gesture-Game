import { describe, expect, it } from 'vitest';
import { createWorld, startGame, step, fire, reload, project, ray, raySphere, pick, CAM, MAG, RELOAD_S, MAX_SHIELD, type Enemy, type World } from '../src/games/shooter/rules';

const A = 16 / 9;
const enemy = (id: number, x: number, y: number, z: number, kind: Enemy['kind'] = 'drone', hp = 1): Enemy => ({
  id, kind, x, y, z, sx: x, sy: y, sz: z, tx: 0, ty: CAM.y, speed: 0, r: 0.85, hp, maxHp: hp, t: 0, seed: 0, fireIn: 9, hitFlash: 0,
});
const fresh = (): World => {
  const w = createWorld(7);
  startGame(w);
  w.events = [];
  w.toSpawn = 0;
  w.waveState = 'fight';
  return w;
};
const aimAt = (e: Enemy) => project(e.x, e.y, e.z, A);

describe('neon strike rules', () => {
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

  it('a shot on target kills a drone, uses one round and scores', () => {
    const w = fresh();
    const e = enemy(1, 2, 3, -25);
    w.enemies = [e];
    const p = aimAt(e);
    expect(fire(w, p.sx, p.sy, A)).toBe(true);
    expect(w.enemies).toHaveLength(0);
    expect(w.ammo).toBe(MAG - 1);
    expect(w.kills).toBe(1);
    expect(w.score).toBe(100);
  });

  it('aim assist forgives a near miss, a wide miss breaks the streak', () => {
    const w = fresh();
    const e = enemy(1, 0, CAM.y, -30);
    w.enemies = [e];
    const p = aimAt(e);
    const edge = 0.85 * p.scale; // sphere radius on screen
    expect(pick(w, p.sx + (edge + 0.02) / A, p.sy, A)?.e.id).toBe(1);
    expect(pick(w, p.sx + (edge + 0.2) / A, p.sy, A)).toBeNull();
    w.streak = 4;
    fire(w, 0.02, 0.02, A);
    expect(w.streak).toBe(0);
  });

  it('tanks take several hits', () => {
    const w = fresh();
    const e = enemy(1, 0, 3, -20, 'tank', 4);
    w.enemies = [e];
    const p = aimAt(e);
    for (let i = 0; i < 3; i++) {
      fire(w, p.sx, p.sy, A);
      w.fireCd = 0;
    }
    expect(w.enemies).toHaveLength(1);
    fire(w, p.sx, p.sy, A);
    expect(w.enemies).toHaveLength(0);
  });

  it('an empty gun clicks and reloads itself; reload refills after RELOAD_S', () => {
    const w = fresh();
    w.ammo = 0;
    expect(fire(w, 0.5, 0.5, A)).toBe(false);
    expect(w.events.some((e) => e.type === 'empty')).toBe(true);
    expect(w.reloadT).toBeGreaterThan(0);
    for (let t = 0; t < RELOAD_S + 0.1; t += 1 / 60) step(w, 1 / 60);
    expect(w.ammo).toBe(MAG);
    expect(reload(w)).toBe(false); // already full
  });

  it('an enemy that reaches you drains the shield; zero shield ends the game', () => {
    const w = fresh();
    w.enemies = [{ ...enemy(1, 0, CAM.y, -2), speed: 30 }];
    step(w, 0.1);
    expect(w.shield).toBeLessThan(MAX_SHIELD);
    w.shield = 1;
    w.enemies = [{ ...enemy(2, 0, CAM.y, -2), speed: 30 }];
    step(w, 0.1);
    expect(w.phase).toBe('over');
  });

  it('every fifth wave brings a boss', () => {
    const w = createWorld(3);
    startGame(w, 5);
    for (let i = 0; i < 200; i++) step(w, 1 / 60);
    expect(w.enemies.some((e) => e.kind === 'boss')).toBe(true);
  });

  it('a clean wave advances to the next one', () => {
    const w = fresh();
    w.enemies = [];
    step(w, 1 / 60);
    expect(w.waveState).toBe('clear');
    for (let i = 0; i < 120; i++) step(w, 1 / 60);
    expect(w.wave).toBe(2);
  });
});
