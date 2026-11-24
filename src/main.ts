/**
 * STARFALL BLADE: Celestial Slicer
 * Main wiring: Input -> Rules -> Scene & Audio -> HUD & Camera Preview
 * URL flags:
 *   ?bot=1        synthetic bot player through gesture engine
 *   ?autostart=1  skip title screen
 *   ?mute=1       no sound
 *   ?seed=N       deterministic seed for tests/captures
 *   ?round=S      custom round length in seconds
 *   ?speed=K      game speed multiplier
 */
import '@fontsource/fraunces/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/700.css';
import './style.css';
import { drawHand } from './hand-gesture-kit';
import { Input } from './input';
import { PinchLatch } from './pinch';
import {
  createWorld,
  startRound,
  step,
  trySlice,
  tryNova,
  tryShockwave,
  ROUND_S,
} from './rules';
import { Scene } from './scene';
import { Sound } from './audio';
import { Bot } from './bot';

const q = new URLSearchParams(location.search);
const flag = (k: string) => q.get(k) === '1';
const BEST_KEY = 'starfall-blade.best';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const world = createWorld(
  Number(q.get('seed')) || Date.now(),
  Number(q.get('round')) || ROUND_S
);

const scene = new Scene($('stage'));
const input = new Input($<HTMLVideoElement>('cam'), document.body);
const sound = new Sound();
const latches = [new PinchLatch(), new PinchLatch()];
const pinchCharge = [0, 0];
const bot = flag('bot') ? new Bot() : null;
const speed = Number(q.get('speed')) || 1;
sound.muted = flag('mute');

let best = 0;
try {
  best = Number(localStorage.getItem(BEST_KEY)) || 0;
} catch {
  /* storage blocked: fine */
}
let resultsAt = 0;

// Camera preview canvas
const preview = $<HTMLCanvasElement>('preview');
const pctx = preview.getContext('2d')!;

// ------------------------------------------------------------------ screens
function show(id: 'title' | 'results' | null) {
  for (const s of ['title', 'results']) $(s).classList.toggle('hidden', s !== id);
  $('hud').classList.toggle('hidden', id !== null);
}

function begin() {
  sound.start();
  startRound(world);
  latches[0].reset();
  latches[1].reset();
  pinchCharge[0] = 0;
  pinchCharge[1] = 0;
  show(null);
}

function finish() {
  sound.end();
  const isBest = world.score > best;
  if (isBest) {
    best = world.score;
    try {
      localStorage.setItem(BEST_KEY, String(best));
    } catch {
      /* ignore */
    }
  }

  $('r-score').textContent = String(world.score);
  $('r-sliced').textContent = String(world.slicedCount);
  $('r-combo').textContent = `${world.maxCombo}x`;
  $('r-best').textContent = isBest && world.score > 0
    ? 'New All-Time Best Record!'
    : `Best Record: ${best}`;
  resultsAt = performance.now();
  latches[0].reset();
  latches[1].reset();
  show('results');
}

// Button listeners
$('b-cam').addEventListener('click', async () => {
  sound.start();
  $('err').textContent = '';
  $('b-cam').textContent = 'Connecting Camera…';
  try {
    await input.startCamera();
    $('cam-container').classList.remove('hidden');
    begin();
  } catch {
    $('b-cam').textContent = 'Play with Camera';
    $('err').textContent =
      'Camera unavailable or blocked. You can still play with mouse or touch!';
  }
});

$('b-mouse').addEventListener('click', () => {
  input.setMode('pointer');
  begin();
});

$('b-restart').addEventListener('click', () => {
  begin();
});

// Two-hand clap listener
input.onClap = () => {
  if (world.phase === 'play') {
    const res = tryShockwave(world);
    sound.shockwave();
    if (res.sliced.length > 0) {
      sound.slice(res.combo, 'star');
      for (const t of res.sliced) {
        scene.addSparks(t.x, t.y, '90,225,255', 14);
      }
    }
  }
};

// Keyboard controls
addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (world.phase === 'title' || world.phase === 'results') {
      input.setMode(input.mode === 'none' ? 'pointer' : input.mode);
      begin();
    }
  } else if (e.key === 'm' || e.key === 'M') {
    sound.setMuted(!sound.muted);
  }
});

addEventListener('resize', () => scene.resize());

// ------------------------------------------------------------------ game loop
let lastT = performance.now();
let fpsSmoothed = 60;

function frame(now: number) {
  requestAnimationFrame(frame);
  const rawDt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  const dt = rawDt * speed;

  // FPS calculation
  if (rawDt > 0) {
    fpsSmoothed = fpsSmoothed * 0.95 + (1 / rawDt) * 0.05;
  }

  const aspect = innerWidth / Math.max(1, innerHeight);

  // Bot update
  if (bot) {
    input.botHands = bot.update(world, dt, aspect);
  }

  input.update(dt);

  const before = world.phase;
  step(world, dt);
  if (before === 'play' && world.phase === 'results') finish();

  // Update game HUD
  if (world.phase === 'play') {
    $('score').textContent = String(world.score);
    const left = Math.max(0, Math.ceil(world.roundS - world.time));
    $('time').textContent = `${left}s`;

    // Combo badge
    const comboBadge = $('combo-badge');
    if (world.combo > 1) {
      comboBadge.classList.remove('hidden');
      $('combo-text').textContent = `x${world.combo} COMBO`;
    } else {
      comboBadge.classList.add('hidden');
    }
  }

  // Active hands processing (Slicing + Pinch Nova)
  const activeViews = input.activeHands;
  const handStatesForScene: { x: number; y: number; pinch: number; active: boolean }[] = [];

  for (let i = 0; i < 2; i++) {
    const h = activeViews[i];
    if (h) {
      handStatesForScene.push({ x: h.screen.x, y: h.screen.y, pinch: h.pinch, active: true });

      if (world.phase === 'play') {
        // Blade slice check
        const sliceDist = Math.hypot(
          (h.screen.x - h.prevScreen.x) * aspect,
          h.screen.y - h.prevScreen.y
        );

        if (sliceDist > 0.005 || h.speed > 0.01) {
          const res = trySlice(world, h.prevScreen, h.screen, aspect);
          if (res.sliced.length > 0) {
            for (const t of res.sliced) {
              const sparkCol =
                t.kind === 'gold'
                  ? '255,215,80'
                  : t.kind === 'prism'
                  ? '240,90,220'
                  : t.kind === 'star'
                  ? '255,255,255'
                  : '90,225,255';
              scene.addSparks(t.x, t.y, sparkCol, 14);
              sound.slice(res.combo, t.kind as 'crystal' | 'gold' | 'prism' | 'star');
            }
          }
          if (res.voidHit) {
            sound.void();
          }
          if (sliceDist > 0.04) {
            sound.slash();
          }
        }

        // Pinch Nova tracking
        const edge = latches[i].update(h.pinch);
        if (edge === 'press') {
          pinchCharge[i] = 0;
        } else if (edge === 'release') {
          if (pinchCharge[i] >= 0.15) {
            const res = tryNova(world, h.screen, aspect);
            sound.nova();
            scene.addSparks(h.screen.x, h.screen.y, '255,255,255', 24);
            if (res.sliced.length > 0) {
              for (const t of res.sliced) sound.slice(res.combo, t.kind as 'crystal' | 'gold' | 'prism' | 'star');
            }
            if (res.voidHit) sound.void();
          }
          pinchCharge[i] = 0;
        }
        if (latches[i].down) {
          pinchCharge[i] += dt;
        }
      } else {
        // Title or Results screen: pinch starts game
        const edge = latches[i].update(h.pinch);
        if (edge === 'press') {
          if (world.phase === 'title' || (world.phase === 'results' && now - resultsAt > 600)) {
            begin();
          }
        }
      }
    } else {
      handStatesForScene.push({ x: 0.5, y: 0.5, pinch: 0, active: false });
    }
  }

  // Render 3D Scene
  scene.update(world, dt, handStatesForScene);

  // Render Corner Camera PIP
  if (input.mode === 'camera' && input.hands.video) {
    pctx.clearRect(0, 0, preview.width, preview.height);
    try {
      pctx.drawImage(input.hands.video, 0, 0, preview.width, preview.height);
    } catch {
      /* video frame not ready */
    }
    for (const h of activeViews) {
      if (h.landmarks) {
        drawHand(pctx, h.landmarks, preview.width, preview.height, {
          color: '#38bdf8',
          lineWidth: 2,
          jointRadius: 3,
        });
      }
    }
  }
}

requestAnimationFrame(frame);

// Autostart / Bot
if (flag('bot')) {
  input.setMode('bot');
  begin();
} else if (flag('autostart')) {
  input.setMode('pointer');
  begin();
}

// ------------------------------------------------------------------ test hooks
(window as unknown as { __game: unknown }).__game = {
  get phase() {
    return world.phase;
  },
  get score() {
    return world.score;
  },
  get slicedCount() {
    return world.slicedCount;
  },
  get caught() {
    return world.slicedCount;
  },
  get maxCombo() {
    return world.maxCombo;
  },
  get combo() {
    return world.combo;
  },
  get time() {
    return world.time;
  },
  get targetsCount() {
    return world.targets.length;
  },
  get mode() {
    return input.mode;
  },
  get handsCount() {
    return input.activeHands.length;
  },
  get fps() {
    return Math.round(fpsSmoothed);
  },
  get dpr() {
    return devicePixelRatio || 1;
  },
  get best() {
    return best;
  },
  start: begin,
};
