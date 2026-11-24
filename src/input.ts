/**
 * Input handling: unifies camera (MediaPipe via kit), mouse/touch pointer, and bot.
 * Every source feeds the same synthetic hand landmarks and gesture engine.
 */
import {
  createHands,
  fromScreen,
  toScreen,
  syntheticHand,
  type Hands,
  type HandInput,
  type Region,
  type Vec3,
} from './hand-gesture-kit';

export const REGION: Region = { x0: 0.12, x1: 0.88, y0: 0.08, y1: 0.82 };

export type Mode = 'none' | 'camera' | 'pointer' | 'bot';

export interface HandView {
  id: number;
  screen: { x: number; y: number };
  prevScreen: { x: number; y: number };
  pinch: number;
  speed: number;
  landmarks: Vec3[];
}

export interface BotHandState {
  x: number;
  y: number;
  pinch: number;
}

const POINTER_PINCH_S = 0.10;

export class Input {
  readonly hands: Hands;
  mode: Mode = 'none';
  activeHands: HandView[] = [];
  botHands: BotHandState[] | null = null;
  onClap: (() => void) | null = null;

  private prevPositions = new Map<number, { x: number; y: number }>();
  private ptr = {
    x: 0.5,
    y: 0.6,
    prevX: 0.5,
    prevY: 0.6,
    down: false,
    pinch: 0,
    seen: false,
    touch: false,
    lastMoveT: 0,
  };

  constructor(video: HTMLVideoElement, el: HTMLElement) {
    this.hands = createHands({
      video,
      config: { pose: { experimental: false } },
      numHands: 2,
      onFrame: (f) => {
        const views: HandView[] = [];
        for (const h of f.hands) {
          const screen = toScreen(h.features.center, REGION);
          const prev = this.prevPositions.get(h.id) ?? { ...screen };
          const dx = screen.x - prev.x;
          const dy = screen.y - prev.y;
          const speed = Math.hypot(dx, dy);

          views.push({
            id: h.id,
            screen,
            prevScreen: prev,
            pinch: h.pinch,
            speed,
            landmarks: h.landmarks,
          });

          this.prevPositions.set(h.id, { ...screen });
        }
        this.activeHands = views;
      },
    });

    this.hands.engine.on('clap', () => {
      this.onClap?.();
    });

    const move = (e: PointerEvent) => {
      this.ptr.prevX = this.ptr.x;
      this.ptr.prevY = this.ptr.y;
      this.ptr.x = e.clientX / innerWidth;
      this.ptr.y = e.clientY / innerHeight;
      this.ptr.seen = true;
      this.ptr.touch = e.pointerType === 'touch';
      this.ptr.lastMoveT = performance.now();
    };

    el.addEventListener('pointermove', move);
    el.addEventListener('pointerdown', (e) => {
      move(e);
      this.ptr.down = true;
    });
    const up = () => {
      this.ptr.down = false;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  async startCamera() {
    await this.hands.startCamera();
    this.setMode('camera');
  }

  setMode(m: Mode) {
    this.mode = m;
    this.hands.inject(m === 'camera' ? null : []);
    this.prevPositions.clear();
  }

  update(dt: number) {
    if (this.mode === 'camera') return;

    const out: HandInput[] = [];

    if (this.mode === 'pointer' && this.ptr.seen) {
      const p = this.ptr;
      p.pinch = p.down
        ? Math.min(1, p.pinch + dt / POINTER_PINCH_S)
        : Math.max(0, p.pinch - dt / POINTER_PINCH_S);

      const sy = p.touch ? p.y - 0.08 : p.y;
      out.push(this.synth(p.x, sy, p.pinch));
    } else if (this.mode === 'bot' && this.botHands && this.botHands.length > 0) {
      for (const bh of this.botHands) {
        out.push(this.synth(bh.x, bh.y, bh.pinch));
      }
    }

    this.hands.inject(out);
  }

  private synth(sx: number, sy: number, pinch: number): HandInput {
    const c = fromScreen({ x: sx, y: sy }, REGION);
    return syntheticHand(
      c.x,
      c.y,
      { curl: [0.1, 0.15 + pinch * 0.35, 0.2, 0.25, 0.3], pinch },
      { scale: 0.17 }
    );
  }
}
