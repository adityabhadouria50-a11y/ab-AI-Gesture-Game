/**
 * Input: one adapter for camera (MediaPipe through the gesture kit), mouse / touch, and the test bot.
 *
 * Every source ends up as the same HandView list. Pointer and bot hands are turned into synthetic 21-point hands and
 * pushed through the real gesture engine, so pinches, poses and claps are recognised the same way for every source.
 *
 * Positions are sampled once per *render* frame (update()), so `prev*` is always "where this hand was last frame".
 * A hand that vanishes and comes back starts with prev = current, so it can't draw a phantom slash across the screen.
 */
import {
  createHands,
  fromScreen,
  toScreen,
  syntheticHand,
  type Hands,
  type HandInput,
  type HandPose,
  type HandResult,
  type Region,
  type Vec3,
} from '../hand-gesture-kit';

/** Camera crop mapped to the whole screen (palm centre). */
export const REGION: Region = { x0: 0.12, x1: 0.88, y0: 0.08, y1: 0.82 };
/** The index fingertip sits above the palm, so its crop is shifted up: aiming low doesn't need the hand off-frame. */
export const TIP_REGION: Region = { x0: 0.1, x1: 0.9, y0: 0.02, y1: 0.7 };

export type Mode = 'none' | 'camera' | 'pointer' | 'bot';

export interface P {
  x: number;
  y: number;
}

export interface HandView {
  id: number;
  handedness: 'Left' | 'Right';
  /** Palm centre, screen 0..1. */
  palm: P;
  prevPalm: P;
  /** Index fingertip, screen 0..1 (equals the palm for pointer and bot hands). */
  tip: P;
  prevTip: P;
  /** Smoothed fingertip speed in screen heights per second. */
  speed: number;
  pinch: number;
  /** Thumb tip to the index finger's base, in wrist→index-knuckle lengths (3D). Big = thumb up, small = pressed. */
  thumbGap: number;
  /** Steadier pointing position for aiming: between the index knuckle and fingertip (palm for pointer / bot). */
  aim: P;
  thumbOut: number;
  curl: number[];
  pose: string | null;
  landmarks: Vec3[];
}

export interface BotHandState {
  x: number;
  y: number;
  pinch: number;
  /** Optional finger shape (defaults to a relaxed open hand). */
  pose?: HandPose;
}

const POINTER_PINCH_S = 0.1;

/** Thumb tip to the nearer of the index knuckle / middle joint, over the wrist→index-knuckle bone, in 3D. */
export function thumbGap(lm: Vec3[], aspect: number): number {
  const P = (i: number) => ({ x: lm[i].x * aspect, y: lm[i].y, z: lm[i].z * aspect * 0.6 });
  const d = (a: number, b: number) => {
    const p = P(a), q = P(b);
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  };
  const bone = d(0, 5);
  return bone > 1e-6 ? Math.min(d(4, 5), d(4, 6)) / bone : 0;
}

export class Input {
  readonly hands: Hands;
  mode: Mode = 'none';
  activeHands: HandView[] = [];
  botHands: BotHandState[] | null = null;
  onClap: (() => void) | null = null;
  /** Clicks / taps since the last update(), for games that want discrete "fire" presses. */
  clicks = 0;
  rightClicks = 0;
  /** Whether the pointer button is held. */
  pointerDown = false;
  /** True when the pointer has moved in the last moment (used to show / hide the pointer cursor). */
  pointerSeen = false;

  private latest: HandResult[] = [];
  private last = new Map<number, { palm: P; tip: P; speed: number }>();
  private ptr = { x: 0.5, y: 0.6, down: false, pinch: 0, seen: false, touch: false };

  constructor(video: HTMLVideoElement, el: HTMLElement) {
    this.hands = createHands({
      video,
      config: { pose: { experimental: false } },
      numHands: 2,
      onFrame: (f) => {
        this.latest = f.hands;
      },
    });

    this.hands.engine.on('clap', () => this.onClap?.());

    const move = (e: PointerEvent) => {
      this.ptr.x = e.clientX / innerWidth;
      this.ptr.y = e.clientY / innerHeight;
      this.ptr.seen = true;
      this.ptr.touch = e.pointerType === 'touch';
      this.pointerSeen = true;
    };
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerdown', (e) => {
      move(e);
      if (e.button === 2) {
        this.rightClicks++;
        return;
      }
      this.ptr.down = true;
      this.pointerDown = true;
      this.clicks++;
    });
    const up = () => {
      this.ptr.down = false;
      this.pointerDown = false;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** The camera has been opened at least once (it stays open while switching games). */
  cameraOn = false;

  async startCamera() {
    await this.hands.startCamera();
    this.cameraOn = true;
    this.setMode('camera');
  }

  setMode(m: Mode) {
    this.mode = m;
    this.hands.inject(m === 'camera' ? null : []);
    this.last.clear();
    this.latest = [];
    this.activeHands = [];
  }

  /** Call once per render frame, before the game reads activeHands. */
  update(dt: number) {
    // 1) feed synthetic sources into the engine
    if (this.mode !== 'camera') {
      const out: HandInput[] = [];
      if (this.mode === 'pointer' && this.ptr.seen) {
        const p = this.ptr;
        p.pinch = p.down
          ? Math.min(1, p.pinch + dt / POINTER_PINCH_S)
          : Math.max(0, p.pinch - dt / POINTER_PINCH_S);
        out.push(this.synth(p.x, p.y, p.pinch, undefined, 'Right'));
      } else if (this.mode === 'bot' && this.botHands) {
        this.botHands.forEach((bh, i) => out.push(this.synth(bh.x, bh.y, bh.pinch, bh.pose, i === 0 ? 'Right' : 'Left')));
      }
      this.hands.inject(out);
    }

    // 2) build views from the engine's latest frame
    const aspect = innerWidth / Math.max(1, innerHeight);
    const views: HandView[] = [];
    const seen = new Set<number>();
    const synthetic = this.mode !== 'camera';
    const v = this.hands.video;
    const camAspect = !synthetic && v.videoWidth ? v.videoWidth / v.videoHeight : 16 / 9;

    for (const h of this.latest) {
      seen.add(h.id);
      const palm = toScreen(h.features.center, REGION);
      // synthetic hands are placed by their palm at exactly the pointer / bot point
      const lm = h.landmarks;
      const tip: P = synthetic ? palm : toScreen(lm[8], TIP_REGION);
      // the fingertip jitters most when the finger points at the camera; the knuckle is rock steady
      const aim: P = synthetic ? palm : toScreen({ x: lm[5].x * 0.45 + lm[8].x * 0.55, y: lm[5].y * 0.45 + lm[8].y * 0.55 }, TIP_REGION);
      const prev = this.last.get(h.id);
      const prevPalm = prev?.palm ?? palm;
      const prevTip = prev?.tip ?? tip;
      const inst = dt > 0 ? Math.hypot((tip.x - prevTip.x) * aspect, tip.y - prevTip.y) / dt : 0;
      // camera frames arrive at ~30 Hz while we render at 60+, so instant speed alternates; smooth it
      const speed = prev ? prev.speed + (inst - prev.speed) * Math.min(1, dt * 18) : 0;
      this.last.set(h.id, { palm, tip, speed });

      views.push({
        id: h.id,
        handedness: h.handedness,
        palm,
        prevPalm,
        tip,
        prevTip,
        speed,
        pinch: h.pinch,
        thumbGap: thumbGap(lm, camAspect),
        aim,
        thumbOut: h.features.thumbOut,
        curl: h.features.curl,
        pose: h.pose,
        landmarks: h.landmarks,
      });
    }
    for (const id of [...this.last.keys()]) if (!seen.has(id)) this.last.delete(id);
    this.activeHands = views;
  }

  /** Clears the click counters; the shell calls this after the game's frame. */
  consumeClicks() {
    this.clicks = 0;
    this.rightClicks = 0;
  }

  private synth(sx: number, sy: number, pinch: number, pose: HandPose | undefined, handedness: 'Left' | 'Right'): HandInput {
    const c = fromScreen({ x: sx, y: sy }, REGION);
    return syntheticHand(
      c.x,
      c.y,
      pose ?? { curl: [0.1, 0.15 + pinch * 0.35, 0.2, 0.25, 0.3], pinch },
      { scale: 0.17, handedness }
    );
  }
}
