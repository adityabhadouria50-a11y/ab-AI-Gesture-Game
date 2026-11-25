/**
 * GESTURE ARCADE — the shell.
 *
 * Owns the camera / input, audio, the shared WebGL renderer, the hub and every menu, the countdown, pausing,
 * best scores, the hand-controlled menu cursor, and the test hook. Games plug in through src/core/types.ts.
 *
 * URL flags:
 *   ?game=starfall|shooter|fruit  open that game's intro directly
 *   ?bot=1        synthetic player (needs ?game=; restarts itself after each round)
 *   ?autostart=1  skip menus and play with mouse / touch
 *   ?mute=1       no sound
 *   ?seed=N       deterministic seed
 *   ?round=S      Starfall round length in seconds
 *   ?speed=K      game speed multiplier
 */
import '@fontsource/fraunces/400.css';
import '@fontsource/fraunces/700.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import './style.css';
import * as THREE from 'three';
import { drawHand } from './hand-gesture-kit';
import { Input, type HandView } from './core/input';
import { PinchLatch } from './core/pinch';
import { Sound } from './core/audio';
import type { Game, GameEnv, GameFactory, GameMeta } from './core/types';
import { createStarfall, META as STARFALL } from './games/starfall';
import { createShooter, META as SHOOTER } from './games/shooter';
import { createFruit, META as FRUIT } from './games/fruit';

type GameId = GameMeta['id'];
const GAMES: Record<GameId, { meta: GameMeta; create: GameFactory }> = {
  starfall: { meta: STARFALL, create: createStarfall },
  shooter: { meta: SHOOTER, create: createShooter },
  fruit: { meta: FRUIT, create: createFruit },
};

const q = new URLSearchParams(location.search);
const flag = (k: string) => q.get(k) === '1';
const speed = Number(q.get('speed')) || 1;
const BOT = flag('bot');

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ------------------------------------------------------------------ shared services
const glCanvas = $<HTMLCanvasElement>('gl');
const c2d = $<HTMLCanvasElement>('c2d');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;
renderer.setClearColor(0x07050f);

const input = new Input($<HTMLVideoElement>('cam'), document.body);
const sound = new Sound();
sound.muted = flag('mute');

const best: Record<GameId, number> = { starfall: 0, shooter: 0, fruit: 0 };
const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage blocked: fine */
    }
  },
};
for (const id of Object.keys(best) as GameId[]) best[id] = Number(store.get(`arcade.best.${id}`)) || 0;
// carry over the original game's record
best.starfall = Math.max(best.starfall, Number(store.get('starfall-blade.best')) || 0);

// ------------------------------------------------------------------ fx: shake, banner, popups
let shakeAmt = 0;
const stage = $('stage');
const fx = $('fx');
const bannerEl = $('banner');
function shake(a: number) {
  shakeAmt = Math.min(1.2, Math.max(shakeAmt, a));
}
function banner(text: string, color = '#ffffff', sub?: string) {
  bannerEl.innerHTML = `<span class="b-main"></span>${sub ? '<span class="b-sub"></span>' : ''}`;
  (bannerEl.querySelector('.b-main') as HTMLElement).textContent = text;
  if (sub) (bannerEl.querySelector('.b-sub') as HTMLElement).textContent = sub;
  bannerEl.style.setProperty('--c', color);
  bannerEl.classList.remove('show');
  void bannerEl.offsetWidth;
  bannerEl.classList.add('show');
}
function popup(x: number, y: number, text: string, color = '#ffffff', size = 22) {
  if (fx.childElementCount > 40) fx.children[1]?.remove();
  const el = document.createElement('span');
  el.className = 'popup';
  el.textContent = text;
  el.style.left = `${Math.max(4, Math.min(96, x * 100))}%`;
  el.style.top = `${Math.max(8, Math.min(92, y * 100))}%`;
  el.style.color = color;
  el.style.fontSize = `${size}px`;
  el.addEventListener('animationend', () => el.remove());
  fx.appendChild(el);
}

// ------------------------------------------------------------------ screens
type Screen = 'hub' | 'intro' | 'countdown' | 'play' | 'paused' | 'results';
let screen: Screen = 'hub';
let game: Game | null = null;
let gameId: GameId | null = null;
let resultsAt = 0;
let countdownT = 0;
let lastCount = 0;

const SCREENS = ['hub', 'intro', 'results', 'pause'] as const;
function show(s: Screen) {
  screen = s;
  const card = s === 'paused' ? 'pause' : s === 'countdown' || s === 'play' ? null : s;
  for (const id of SCREENS) $(id).classList.toggle('hidden', id !== card);
  $('hud').classList.toggle('hidden', !(s === 'play' || s === 'paused' || s === 'countdown'));
  $('controls').classList.toggle('hidden', !(s === 'play' || s === 'countdown'));
  $('countdown').classList.toggle('hidden', s !== 'countdown');
  document.body.dataset.screen = s;
}

function renderBest() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-best]')) {
    const id = el.dataset.best as GameId;
    el.textContent = best[id] ? `Best ${best[id].toLocaleString()}` : 'New';
  }
}

function setSurface(surface: 'gl' | '2d') {
  glCanvas.style.display = surface === 'gl' ? 'block' : 'none';
  c2d.style.display = surface === '2d' ? 'block' : 'none';
}

const env: GameEnv = {
  gl: renderer,
  canvas2d: c2d,
  hud: $('hud'),
  sound,
  input,
  params: q,
  seed: Number(q.get('seed')) || Date.now(),
  shake,
  banner,
  popup,
};

function loadGame(id: GameId) {
  if (game && gameId === id) return;
  unloadGame();
  gameId = id;
  setSurface(GAMES[id].meta.surface);
  game = GAMES[id].create({ ...env, seed: Number(q.get('seed')) || Date.now() });
  document.documentElement.style.setProperty('--accent', GAMES[id].meta.accent);
  game.resize();
}

function unloadGame() {
  game?.dispose();
  game = null;
  gameId = null;
  renderer.setClearColor(0x07050f);
  renderer.clear();
}

function openIntro(id: GameId) {
  sound.start();
  loadGame(id);
  const m = GAMES[id].meta;
  $('i-badge').textContent = m.surface === 'gl' ? 'HAND-TRACKING · 3D' : 'HAND-TRACKING · ARCADE';
  $('i-name').textContent = m.name;
  $('i-tag').textContent = m.tagline;
  $('i-how').innerHTML = m.howTo
    .map((h) => `<div class="gesture-item"><div class="gesture-icon">${h.icon}</div><div class="gesture-title">${h.title}</div><div class="gesture-desc">${h.desc}</div></div>`)
    .join('');
  $('i-tip').textContent = m.tip;
  $('i-best').textContent = best[id] ? `Your best: ${best[id].toLocaleString()}` : '';
  $('i-hint').textContent = input.mode === 'camera' ? 'Pinch or hold your finger on Start · Esc pauses · M mutes' : 'Space to start · Esc to pause · M to mute';
  show('intro');
}

function goHub() {
  unloadGame();
  sizeHubCanvas();
  sound.setTheme('hub');
  renderBest();
  setSurface('2d');
  show('hub');
}

function beginCountdown() {
  if (!game) return;
  sound.start();
  if (input.mode === 'none') input.setMode('pointer');
  if (BOT) {
    startNow();
    return;
  }
  countdownT = 2.4;
  lastCount = 0;
  show('countdown');
}

function startNow() {
  if (!game) return;
  game.start();
  show('play');
}

function finish() {
  if (!game || !gameId) return;
  const r = game.result();
  const isBest = r.score > best[gameId];
  if (isBest) {
    best[gameId] = r.score;
    store.set(`arcade.best.${gameId}`, String(r.score));
  }
  $('r-badge').textContent = `${GAMES[gameId].meta.name.toUpperCase()} · GAME OVER`;
  $('r-title').textContent = r.headline;
  $('r-score').textContent = r.score.toLocaleString();
  $('r-best').textContent = isBest && r.score > 0 ? '🏆 New personal best!' : `Best: ${best[gameId].toLocaleString()}`;
  $('r-best').classList.toggle('new', isBest && r.score > 0);
  $('r-stats').innerHTML = r.stats.map((s) => `<div class="stat-box"><span class="stat-num"></span><span class="stat-lbl"></span></div>`).join('');
  $('r-stats').querySelectorAll('.stat-box').forEach((el, i) => {
    el.querySelector('.stat-num')!.textContent = r.stats[i].value;
    el.querySelector('.stat-lbl')!.textContent = r.stats[i].label;
  });
  if (isBest && r.score > 0) sound.fanfare();
  resultsAt = performance.now();
  show('results');
}

function pause() {
  if (screen !== 'play' && screen !== 'countdown') return;
  show('paused');
}
function resume() {
  if (screen !== 'paused') return;
  show(game?.phase === 'play' ? 'play' : 'countdown');
  if (game?.phase !== 'play') countdownT = 2.4;
}

// ------------------------------------------------------------------ wiring
for (const card of document.querySelectorAll<HTMLElement>('.game-card')) {
  card.addEventListener('click', () => {
    sound.uiSelect();
    openIntro(card.dataset.game as GameId);
  });
  card.addEventListener('pointerenter', () => sound.uiHover());
}

function setController(mode: 'camera' | 'pointer') {
  input.setMode(mode);
  $('m-cam').classList.toggle('on', mode === 'camera');
  $('m-ptr').classList.toggle('on', mode === 'pointer');
  $('cam-pip').classList.toggle('hidden', mode !== 'camera');
  document.body.classList.toggle('camera-mode', mode === 'camera');
}

$('b-cam').addEventListener('click', async () => {
  sound.start();
  $('err').textContent = '';
  const b = $<HTMLButtonElement>('b-cam');
  if (input.cameraOn) {
    setController('camera');
    return;
  }
  b.textContent = 'Loading hand tracking…';
  b.disabled = true;
  try {
    await input.startCamera();
    setController('camera');
    $<HTMLButtonElement>('m-cam').disabled = false;
    b.textContent = '✅ Camera On';
  } catch (e) {
    b.textContent = '📷 Enable Camera';
    b.disabled = false;
    $('err').textContent =
      (e as Error)?.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow it in your browser’s address bar, or play with mouse / touch.'
        : 'Camera unavailable. You can still play every game with mouse or touch.';
  }
});
$('m-cam').addEventListener('click', () => input.cameraOn && setController('camera'));
$('m-ptr').addEventListener('click', () => setController('pointer'));

$('b-start').addEventListener('click', () => beginCountdown());
$('b-back').addEventListener('click', () => goHub());
$('b-again').addEventListener('click', () => {
  if (game) beginCountdown();
});
$('b-menu').addEventListener('click', () => goHub());
$('b-pause').addEventListener('click', (e) => {
  e.stopPropagation();
  pause();
});
$('b-pause').addEventListener('pointerdown', (e) => e.stopPropagation());
$('b-mute').addEventListener('pointerdown', (e) => e.stopPropagation());
$('b-mute').addEventListener('click', () => toggleMute());
$('b-resume').addEventListener('click', () => resume());
$('b-restart').addEventListener('click', () => beginCountdown());
$('b-quit').addEventListener('click', () => goHub());

function toggleMute() {
  sound.setMuted(!sound.muted);
  $('b-mute').textContent = sound.muted ? '🔇' : '🔊';
}

addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (screen === 'intro' || screen === 'results') beginCountdown();
    else if (screen === 'paused') resume();
  } else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    if (screen === 'play' || screen === 'countdown') pause();
    else if (screen === 'paused') resume();
    else if (screen === 'intro' || screen === 'results') goHub();
  } else if (e.key === 'm' || e.key === 'M') toggleMute();
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  game?.resize();
  sizeHubCanvas();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !BOT) pause();
});

input.onClap = () => {
  if (screen === 'play') game?.onClap?.();
};

// ------------------------------------------------------------------ hand cursor for menus
const cursor = $('cursor');
const cursorFill = cursor.querySelector<SVGCircleElement>('.fill')!;
const menuLatch = new PinchLatch();
const DWELL_S = 1.1;
let dwellEl: HTMLElement | null = null;
let dwellT = 0;
let clickCooldown = 0;

function pressable(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const b = el?.closest<HTMLElement>('button, .game-card, label');
  if (!b || (b as HTMLButtonElement).disabled) return null;
  return b;
}

function updateCursor(hands: HandView[], dt: number) {
  const menu = screen === 'hub' || screen === 'intro' || screen === 'results' || screen === 'paused';
  const h = hands[0];
  if (input.mode !== 'camera' || !menu || !h) {
    cursor.classList.add('hidden');
    dwellEl?.classList.remove('g-hover');
    dwellEl = null;
    dwellT = 0;
    menuLatch.reset();
    return;
  }
  const px = h.tip.x * innerWidth, py = h.tip.y * innerHeight;
  cursor.classList.remove('hidden');
  cursor.style.transform = `translate(${px}px, ${py}px)`;
  clickCooldown = Math.max(0, clickCooldown - dt);
  const target = pressable(px, py);
  if (target !== dwellEl) {
    dwellEl?.classList.remove('g-hover');
    dwellEl = target;
    dwellT = 0;
    if (target) {
      target.classList.add('g-hover');
      sound.uiHover();
    }
  }
  const pinched = menuLatch.update(h.pinch) === 'press';
  // ignore a pinch carried over from the round that just ended
  const ready = clickCooldown <= 0 && (screen !== 'results' || performance.now() - resultsAt > 700);
  if (target && ready) {
    dwellT += dt;
    if (pinched || dwellT >= DWELL_S) {
      dwellT = 0;
      clickCooldown = 0.8;
      cursor.classList.remove('clicked');
      void cursor.offsetWidth;
      cursor.classList.add('clicked');
      target.click();
    }
  } else dwellT = 0;
  const C = 2 * Math.PI * 18;
  cursorFill.style.strokeDasharray = `${C}`;
  cursorFill.style.strokeDashoffset = `${C * (1 - Math.min(1, dwellT / DWELL_S))}`;
  cursor.classList.toggle('over', !!target);
}

// ------------------------------------------------------------------ hub background (2D)
const hubG = c2d.getContext('2d')!;
const orbs = Array.from({ length: 26 }, (_, i) => ({
  x: Math.random(),
  y: Math.random(),
  r: 0.02 + Math.random() * 0.08,
  vx: (Math.random() - 0.5) * 0.02,
  vy: -0.01 - Math.random() * 0.03,
  c: ['56,189,248', '244,114,182', '251,146,60'][i % 3],
}));
function sizeHubCanvas() {
  if (game?.meta.surface === '2d') return;
  const d = Math.min(2, devicePixelRatio || 1);
  c2d.width = Math.round(innerWidth * d);
  c2d.height = Math.round(innerHeight * d);
}
function drawHub(dt: number, hands: HandView[]) {
  const W = c2d.width, H = c2d.height;
  const g = hubG;
  g.setTransform(1, 0, 0, 1, 0, 0);
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#07050f');
  bg.addColorStop(0.5, '#110a24');
  bg.addColorStop(1, '#1a0a1c');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  for (const o of orbs) {
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    if (o.y < -0.15) {
      o.y = 1.15;
      o.x = Math.random();
    }
    const x = o.x * W, y = o.y * H, r = o.r * H;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(${o.c},0.22)`);
    grd.addColorStop(1, `rgba(${o.c},0)`);
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // hands light the background
  for (const h of hands) {
    const x = h.tip.x * W, y = h.tip.y * H, r = H * 0.25;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(160,200,255,0.18)');
    grd.addColorStop(1, 'rgba(160,200,255,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.globalCompositeOperation = 'source-over';
}

// ------------------------------------------------------------------ camera preview
const preview = $<HTMLCanvasElement>('preview');
const pctx = preview.getContext('2d')!;
const camStatus = $('cam-status');
let noHandsT = 0;
function drawPreview(hands: HandView[], dt: number) {
  if (input.mode !== 'camera') return;
  const v = input.hands.video;
  pctx.clearRect(0, 0, preview.width, preview.height);
  try {
    if (v.readyState >= 2) {
      // the raw camera frame is un-mirrored; landmarks are already in mirrored (selfie) space
      pctx.save();
      pctx.translate(preview.width, 0);
      pctx.scale(-1, 1);
      pctx.drawImage(v, 0, 0, preview.width, preview.height);
      pctx.restore();
    }
  } catch {
    /* frame not ready */
  }
  for (const h of hands) drawHand(pctx, h.landmarks, preview.width, preview.height, { color: h.handedness === 'Right' ? '#38bdf8' : '#f472b6', lineWidth: 2, jointRadius: 2.5 });
  camStatus.textContent = hands.length ? `Tracking ${hands.length} hand${hands.length > 1 ? 's' : ''}${hands[0].pose ? ` · ${hands[0].pose}` : ''}` : 'No hand detected';
  camStatus.classList.toggle('lost', !hands.length);
  noHandsT = hands.length ? 0 : noHandsT + dt;
}

// ------------------------------------------------------------------ main loop
let lastT = performance.now();
let fps = 60;
let botRestartT = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const raw = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  if (raw > 0) fps = fps * 0.95 + (1 / raw) * 0.05;
  const dt = raw * speed;

  if (BOT && game) input.botHands = game.bot(dt);
  input.update(raw);
  const hands = input.activeHands;

  // countdown
  if (screen === 'countdown') {
    countdownT -= raw;
    const n = Math.ceil(countdownT / 0.8);
    const el = $('countdown');
    if (n !== lastCount) {
      lastCount = n;
      el.textContent = n > 0 ? String(n) : 'GO!';
      el.classList.remove('tick');
      void el.offsetWidth;
      el.classList.add('tick');
      sound.countdown(n <= 0);
    }
    if (countdownT <= 0) startNow();
  }

  const simDt = screen === 'paused' ? 0 : dt;
  if (game) {
    game.frame(simDt, hands, now);
    if (screen === 'play' && game.phase === 'over') finish();
  } else {
    drawHub(raw, hands);
  }
  input.consumeClicks();

  // shake the stage
  if (shakeAmt > 0.001) {
    const s = shakeAmt * 14;
    stage.style.transform = `translate(${(Math.random() - 0.5) * s}px, ${(Math.random() - 0.5) * s}px)`;
    shakeAmt *= Math.exp(-raw * 9);
  } else if (stage.style.transform) stage.style.transform = '';

  updateCursor(hands, raw);
  drawPreview(hands, raw);
  $('hand-hint').classList.toggle('hidden', !(input.mode === 'camera' && screen === 'play' && noHandsT > 1.5));

  if (BOT && screen === 'results') {
    botRestartT += raw;
    if (botRestartT > 1.5) {
      botRestartT = 0;
      beginCountdown();
    }
  }
}

// ------------------------------------------------------------------ boot
sizeHubCanvas();
setSurface('2d');
renderBest();
show('hub');
requestAnimationFrame(frame);

const deep = q.get('game') as GameId | null;
if (BOT) {
  input.setMode('bot');
  openIntro(deep && GAMES[deep] ? deep : 'starfall');
  beginCountdown();
} else if (deep && GAMES[deep]) {
  openIntro(deep);
  if (flag('autostart')) {
    setController('pointer');
    beginCountdown();
  }
} else if (flag('autostart')) {
  setController('pointer');
  openIntro('starfall');
  beginCountdown();
}

// ------------------------------------------------------------------ test hook
function snapshot(): Record<string, unknown> {
  const stats = game?.stats() ?? {};
  return {
    screen,
    phase: screen === 'results' ? 'results' : screen === 'play' ? 'play' : screen === 'hub' || screen === 'intro' ? 'title' : screen,
    game: gameId,
    mode: input.mode,
    handsCount: input.activeHands.length,
    fps: Math.round(fps),
    dpr: devicePixelRatio || 1,
    best: gameId ? best[gameId] : 0,
    caught: stats.slicedCount ?? stats.sliced ?? stats.kills ?? 0,
    ...stats,
  };
}
const hook = { start: beginCountdown, open: openIntro, snapshot };
(window as unknown as { __game: unknown }).__game = new Proxy(hook, {
  get(t, k: string) {
    if (k in t) return t[k as keyof typeof t];
    return snapshot()[k];
  },
  ownKeys() {
    return Object.keys(snapshot());
  },
  getOwnPropertyDescriptor(_t, k: string) {
    return { enumerable: true, configurable: true, value: snapshot()[k] };
  },
});
