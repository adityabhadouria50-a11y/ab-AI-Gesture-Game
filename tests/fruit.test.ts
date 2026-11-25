import { describe, expect, it } from 'vitest';
import { createWorld, startGame, step, blade, endStroke, tossVelocity, GRAVITY, MAX_LIVES, BLADE_MIN_SPEED, LIFE_EVERY, type Fruit, type Kind } from '../src/games/fruit/rules';

const fruit = (id: number, kind: Kind, x: number, y: number): Fruit => ({ id, kind, x, y, vx: 0, vy: 0, r: 0.05, rot: 0, vRot: 0, age: 0 });
const fresh = () => {
  const w = createWorld(42);
  startGame(w);
  w.queue = [];
  w.waveIn = 99; // no random waves during a test
  return w;
};
const swipe = (w: ReturnType<typeof fresh>, y: number, speed = 3) => blade(w, 0, { x: 0.1, y }, { x: 0.9, y }, speed, 16 / 9, 1 / 60);

describe('juice dojo rules', () => {
  it('the same seed gives the same game', () => {
    const a = createWorld(9), b = createWorld(9);
    startGame(a);
    startGame(b);
    for (let i = 0; i < 600; i++) {
      step(a, 1 / 60);
      step(b, 1 / 60);
    }
    expect(a.fruits.map((f) => [f.kind, f.x, f.y])).toEqual(b.fruits.map((f) => [f.kind, f.x, f.y]));
  });

  it('a toss peaks where it was aimed', () => {
    const v = tossVelocity(0.3, 1.1, 0.25, 0.5);
    const apex = 1.1 - (v.vy * v.vy) / (2 * GRAVITY);
    expect(apex).toBeCloseTo(0.25, 5);
  });

  it('a fast swipe slices fruit into two halves and scores', () => {
    const w = fresh();
    w.fruits = [fruit(1, 'apple', 0.5, 0.5)];
    swipe(w, 0.5);
    expect(w.fruits).toHaveLength(0);
    expect(w.halves).toHaveLength(2);
    expect(w.score).toBe(10);
    expect(w.sliced).toBe(1);
  });

  it('a slow hand never cuts', () => {
    const w = fresh();
    w.fruits = [fruit(1, 'apple', 0.5, 0.5)];
    swipe(w, 0.5, BLADE_MIN_SPEED * 0.5);
    expect(w.fruits).toHaveLength(1);
  });

  it('three fruit in one stroke pays a combo bonus when the stroke ends', () => {
    const w = fresh();
    w.fruits = [fruit(1, 'apple', 0.3, 0.5), fruit(2, 'kiwi', 0.5, 0.5), fruit(3, 'plum', 0.7, 0.5)];
    swipe(w, 0.5);
    expect(w.score).toBe(30);
    endStroke(w, 0);
    expect(w.score).toBe(60);
    expect(w.bestCombo).toBe(3);
    expect(w.events.some((e) => e.type === 'combo' && e.n === 3)).toBe(true);
  });

  it('a bomb costs a life and clears the board for no points', () => {
    const w = fresh();
    w.fruits = [fruit(1, 'bomb', 0.5, 0.5), fruit(2, 'apple', 0.5, 0.2)];
    swipe(w, 0.5);
    expect(w.lives).toBe(MAX_LIVES - 1);
    expect(w.fruits).toHaveLength(0);
    expect(w.score).toBe(0);
  });

  it('dropped fruit cost lives, specials do not, and losing them all ends the game', () => {
    const w = fresh();
    w.fruits = [{ ...fruit(1, 'freeze', 0.5, 1.2), vy: 1 }];
    step(w, 1 / 60);
    expect(w.lives).toBe(MAX_LIVES);
    for (let i = 0; i < MAX_LIVES; i++) {
      w.fruits = [{ ...fruit(10 + i, 'orange', 0.5, 1.2), vy: 1 }];
      step(w, 1 / 60);
    }
    expect(w.lives).toBe(0);
    expect(w.phase).toBe('over');
  });

  it('frenzy stops misses from counting; double points doubles', () => {
    const w = fresh();
    w.fruits = [fruit(1, 'frenzy', 0.5, 0.5)];
    swipe(w, 0.5);
    expect(w.frenzyT).toBeGreaterThan(0);
    w.fruits = [{ ...fruit(2, 'orange', 0.5, 1.2), vy: 1 }];
    step(w, 1 / 60);
    expect(w.lives).toBe(MAX_LIVES);

    const d = fresh();
    d.fruits = [fruit(1, 'double', 0.5, 0.5)];
    swipe(d, 0.5);
    const before = d.score;
    d.fruits = [fruit(2, 'apple', 0.5, 0.5)];
    swipe(d, 0.5);
    expect(d.score - before).toBe(20);
  });

  it('a life comes back at every milestone', () => {
    const w = fresh();
    w.lives = 1;
    w.score = LIFE_EVERY - 5;
    w.fruits = [fruit(1, 'apple', 0.5, 0.5)];
    swipe(w, 0.5);
    expect(w.lives).toBe(2);
  });
});
