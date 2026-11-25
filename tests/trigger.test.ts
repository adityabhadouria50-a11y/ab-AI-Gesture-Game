// The finger-gun trigger must fire once per thumb press for very different hands, ignore jitter and a resting fist,
// and it must still work when the hand is fed through the real gesture engine.
import { describe, expect, it } from 'vitest';
import { ThumbTrigger, AimHistory } from '../src/games/shooter/trigger';
import { GestureEngine, syntheticHand, type HandPose } from '../src/hand-gesture-kit';
import { thumbGap } from '../src/core/input';

const DT = 1 / 60;
/** Feeds a gap sequence, linearly ramping between key values over `frames` frames each. Returns shots fired. */
function play(t: ThumbTrigger, keys: number[], frames = 8, noise = 0) {
  let shots = 0, seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let k = 0; k < keys.length - 1; k++) {
    for (let f = 0; f < frames; f++) {
      const g = keys[k] + (keys[k + 1] - keys[k]) * (f / frames) + rnd() * noise;
      if (t.update(g, DT)) shots++;
    }
  }
  for (let f = 0; f < 10; f++) if (t.update(keys[keys.length - 1], DT)) shots++;
  return shots;
}

describe('thumb trigger', () => {
  it('one press fires exactly one shot', () => {
    expect(play(new ThumbTrigger(), [0.75, 0.75, 0.35, 0.35])).toBe(1);
  });

  it('three presses fire three shots', () => {
    expect(play(new ThumbTrigger(), [0.75, 0.75, 0.35, 0.75, 0.35, 0.75, 0.35, 0.75])).toBe(3);
  });

  it('adapts to a hand whose thumb never sticks out far', () => {
    // a lazy finger gun: thumb "up" at 0.5, pressed at 0.3 (would never cross fixed thresholds tuned for 0.75)
    expect(play(new ThumbTrigger(), [0.5, 0.5, 0.3, 0.5, 0.3, 0.5])).toBe(2);
  });

  it('a slow press still fires', () => {
    expect(play(new ThumbTrigger(), [0.75, 0.75, 0.38], 40)).toBe(1);
  });

  it('tracking jitter on a held thumb does not fire', () => {
    expect(play(new ThumbTrigger(), [0.72, 0.72, 0.72, 0.72, 0.72, 0.72], 20, 0.06)).toBe(0);
  });

  it('a hand that starts with the thumb already down does not fire until it has been up', () => {
    const t = new ThumbTrigger();
    expect(play(t, [0.3, 0.3, 0.3])).toBe(0);
    expect(play(t, [0.3, 0.7, 0.7, 0.3])).toBe(1);
  });

  it('a permanently tucked thumb (fist) never fires', () => {
    expect(play(new ThumbTrigger(), [0.3, 0.35, 0.25, 0.33, 0.28], 10, 0.03)).toBe(0);
  });

  it('the meter reads 0 with the thumb up and 1 at the firing point', () => {
    const t = new ThumbTrigger();
    play(t, [0.75, 0.75]);
    expect(t.level).toBeLessThan(0.05);
    t.update(0.75 * 0.72, DT);
    expect(t.level).toBeCloseTo(1, 1);
  });

  it('fires from synthetic finger-gun hands run through the real gesture engine', () => {
    const GUN: HandPose = { curl: [0, 0, 1, 1, 1], pinch: 0 };
    const BANG: HandPose = { curl: [1, 0, 1, 1, 1], pinch: 0 };
    const e = new GestureEngine();
    const t = new ThumbTrigger();
    let shots = 0, ms = 0;
    for (const [pose, frames] of [[GUN, 20], [BANG, 10], [GUN, 15], [BANG, 10], [GUN, 10]] as const) {
      for (let f = 0; f < frames; f++) {
        const fr = e.update([syntheticHand(0.5, 0.5, pose, { scale: 0.17 })], (ms += 33));
        if (t.update(thumbGap(fr.hands[0].landmarks, 16 / 9), 0.033)) shots++;
      }
    }
    expect(shots).toBe(2);
  });
});

describe('aim history', () => {
  it('returns where you were aiming before the press', () => {
    const h = new AimHistory();
    for (let ms = 0; ms <= 500; ms += 16) h.push(ms, ms < 400 ? 0.5 : 0.6, 0.5);
    expect(h.at(500, 120)!.x).toBe(0.5);
    expect(h.at(500, 0)!.x).toBe(0.6);
  });
});
