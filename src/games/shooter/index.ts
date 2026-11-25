/**
 * Sky Hunter: birds glide across the sky left→right and right→left. Make a finger gun, aim with your index finger,
 * drop your thumb to fire, make a fist to reload. Both hands can shoot.
 * Mouse: aim, click (or hold) to fire, right-click or R to reload.
 */
import type { Game, GameEnv, GameMeta } from '../../core/types';
import type { HandView, BotHandState } from '../../core/input';
import type { HandPose } from '../../hand-gesture-kit';
import { createWorld, startGame, step, fire, reload, pick, project, accuracy, MAG, MAX_LIVES, RAPID_S, type World, type Bird } from './rules';
import { ShooterScene } from './scene';
import { ThumbTrigger, AimHistory } from './trigger';

export const META: GameMeta = {
  id: 'shooter',
  name: 'Sky Hunter',
  tagline: 'Birds glide across the sky. Finger-gun them before they fly away.',
  accent: '#f59e0b',
  surface: 'gl',
  howTo: [
    { icon: '👉', title: 'Aim', desc: 'Make a finger gun, point your index finger' },
    { icon: '👍', title: 'Fire', desc: 'Drop your thumb down like a trigger' },
    { icon: '✊', title: 'Reload', desc: 'Make a fist (or it auto-reloads)' },
  ],
  tip: '🐦 Every bird that reaches the other side costs a heart (you have 5). Geese take 2 hits, golden birds are fast and worth 500. Shoot balloons: red = +1 heart, yellow = rapid fire, blue = slow motion.',
};

/**
 * A deliberate fist: every finger curled, thumb tucked. Pointing the index finger at the camera can make it *look*
 * curled to the tracker, so the index must be clearly folded too, and the fist has to be held (see FIST_HOLD_S).
 */
const isFist = (h: HandView) => h.curl[1] > 0.78 && h.curl[2] > 0.7 && h.curl[3] > 0.6 && h.thumbGap < 0.5;
const FIST_HOLD_S = 0.3;
/** A thumb press nudges the hand: a shot may use the aim from up to this long before the trigger fired. */
const REWIND_MS = 120;

export function createShooter(env: GameEnv): Game {
  const world = createWorld(env.seed);
  const scene = new ShooterScene(env.gl);
  const triggers = [new ThumbTrigger(), new ThumbTrigger()];
  const history = [new AimHistory(), new AimHistory()];
  const fistT = [0, 0];
  const aims = [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }];
  const bot = new ShooterBot();
  let phase: Game['phase'] = 'intro';
  let autoFire = false;
  try {
    autoFire = localStorage.getItem('arcade.shooter.autofire') === '1';
  } catch {
    /* storage blocked */
  }

  env.hud.innerHTML = `
    <div class="hud-bar">
      <div class="hud-block"><span class="hud-label">Score</span><span class="hud-val" data-k="score">0</span><span class="mult" data-k="mult" hidden>x1</span></div>
      <div class="hud-block center"><span class="hud-label">Wave</span><span class="hud-val small" data-k="wave">1</span><div class="powers" data-k="powers"></div></div>
      <div class="hud-block right"><span class="hud-label">Hearts</span><div class="lives hearts" data-k="lives">${'<i></i>'.repeat(MAX_LIVES)}</div></div>
    </div>
    <div class="ammo" data-k="ammo"></div>
    <div class="crosshair" data-k="ch0"><i></i><b></b><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/></svg><u><s></s></u></div>
    <div class="crosshair alt" data-k="ch1"><i></i><b></b><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/></svg><u><s></s></u></div>
    <div class="damage-vignette" data-k="dmg"></div>
    <label class="hud-toggle"><input type="checkbox" data-k="auto"> Auto-fire on target</label>`;
  const $ = (k: string) => env.hud.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
  const elScore = $('score'), elMult = $('mult'), elWave = $('wave'), elLives = $('lives'), elAmmo = $('ammo'), elDmg = $('dmg'), elPowers = $('powers');
  const ch = [$('ch0'), $('ch1')];
  const autoBox = $('auto') as HTMLInputElement;
  autoBox.checked = autoFire;
  autoBox.addEventListener('change', () => {
    autoFire = autoBox.checked;
    try {
      localStorage.setItem('arcade.shooter.autofire', autoFire ? '1' : '0');
    } catch {
      /* ignore */
    }
  });
  autoBox.parentElement!.addEventListener('pointerdown', (e) => e.stopPropagation());
  elAmmo.innerHTML = '<i></i>'.repeat(MAG);
  const pips = [...elAmmo.querySelectorAll('i')];
  let shownAmmo = -1, shownScore = -1, shownLives = -1, shownPowers = '';
  let dmgFlash = 0;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'r' || e.key === 'R') reload(world);
  };
  addEventListener('keydown', onKey);

  const handle = () => {
    const aspect = innerWidth / Math.max(1, innerHeight);
    for (const e of world.events) {
      switch (e.type) {
        case 'shot':
          scene.tracer(e.hand, e.x, e.y, e.z);
          env.sound.gunshot(e.rapid);
          if (e.hit) {
            const el = ch[e.hand] ?? ch[0];
            el.classList.remove('hit');
            void el.offsetWidth;
            el.classList.add('hit');
          }
          break;
        case 'hit':
          scene.puff(e.x, e.y, e.z, e.kind, 6);
          env.sound.hit();
          break;
        case 'kill': {
          const p = project(e.x, e.y, e.z, aspect);
          if (e.kind === 'balloon') {
            scene.pop(e.x, e.y, e.z);
            env.sound.powerup();
            const label = e.pickup === 'life' ? '+1 HEART' : e.pickup === 'rapid' ? 'RAPID FIRE' : 'SLOW MOTION';
            env.banner(label, e.pickup === 'life' ? '#f87171' : e.pickup === 'rapid' ? '#facc15' : '#38bdf8');
          } else {
            scene.puff(e.x, e.y, e.z, e.kind, e.kind === 'goose' ? 22 : 14);
            env.sound.hit();
            env.popup(p.sx, p.sy, `+${e.points}`, e.kind === 'golden' ? '#fde047' : '#ffffff', e.kind === 'golden' ? 34 : 24);
            if (e.kind === 'golden') env.banner('GOLDEN BIRD!', '#fde047');
          }
          break;
        }
        case 'escape': {
          env.sound.lifeLost();
          env.shake(0.3);
          dmgFlash = 0.7;
          const p = project(e.x, e.y, e.z, aspect);
          env.popup(e.dir > 0 ? 0.9 : 0.1, Math.min(0.85, Math.max(0.15, p.sy)), 'ESCAPED!', '#fca5a5', 22);
          break;
        }
        case 'empty':
          env.sound.emptyClick();
          break;
        case 'reload':
          env.sound.reload();
          break;
        case 'wave':
          env.banner(e.flock ? `FLOCK WAVE ${e.wave}` : `WAVE ${e.wave}`, e.flock ? '#fde047' : '#ffffff', e.flock ? 'Here they come!' : 'Birds incoming');
          env.sound.waveStart();
          break;
        case 'waveClear':
          env.banner('WAVE CLEAR', '#4ade80', `+${e.bonus}`);
          env.sound.fanfare();
          break;
        case 'multiplier':
          if (e.value > 1) env.popup(0.5, 0.22, `x${e.value} STREAK`, '#facc15', 26);
          break;
        case 'reloaded':
          break;
      }
    }
    world.events.length = 0;
  };

  const game: Game = {
    meta: META,
    get phase() {
      return phase;
    },
    start() {
      startGame(world, Number(env.params.get('wave')) || 1);
      triggers.forEach((t) => t.reset());
      history.forEach((hh) => hh.clear());
      phase = 'play';
      shownAmmo = shownScore = shownLives = -1;
      env.sound.setTheme('dojo');
    },
    frame(dt, hands: HandView[]) {
      const aspect = innerWidth / Math.max(1, innerHeight);
      const playing = phase === 'play' && dt > 0;
      const visAims: { x: number; y: number; active: boolean }[] = [];
      const pointer = env.input.mode === 'pointer';

      for (let i = 0; i < 2; i++) {
        const h = hands[i];
        const el = ch[i];
        if (!h) {
          visAims.push({ x: 0.5, y: 0.5, active: false });
          el.classList.remove('on');
          fistT[i] = 0;
          triggers[i].reset();
          history[i].clear();
          continue;
        }
        // smooth the aim a little more than the engine does, but stay responsive on big moves
        const a = aims[i];
        const k = Math.min(1, dt * (pointer ? 60 : 22));
        a.x += (h.aim.x - a.x) * k;
        a.y += (h.aim.y - a.y) * k;
        const now = performance.now();
        history[i].push(now, a.x, a.y);
        visAims.push({ x: a.x, y: a.y, active: true });
        el.classList.toggle('on', phase === 'play');
        el.style.transform = `translate(${a.x * innerWidth}px, ${a.y * innerHeight}px)`;
        const target = phase === 'play' ? pick(world, a.x, a.y, aspect) : null;
        el.classList.toggle('lock', !!target);
        el.classList.toggle('reloading', world.reloadT > 0);
        if (!playing) continue;

        if (pointer) {
          if (env.input.clicks > 0 || env.input.pointerDown) fire(world, a.x, a.y, aspect, i);
          if (env.input.rightClicks > 0) reload(world);
        } else {
          const pulled = triggers[i].update(h.thumbGap, dt);
          el.style.setProperty('--trig', triggers[i].level.toFixed(2));
          el.classList.toggle('armed', triggers[i].armed);
          if (isFist(h)) {
            fistT[i] += dt;
            if (fistT[i] > FIST_HOLD_S) reload(world);
          } else fistT[i] = 0;
          if (pulled) {
            // the press may have nudged the aim off the bird: use the most recent aim that was on one
            let at: { x: number; y: number } = a;
            for (const ms of [0, 40, 80, REWIND_MS]) {
              const p = ms === 0 ? a : history[i].at(now, ms);
              if (p && pick(world, p.x, p.y, aspect)) {
                at = p;
                break;
              }
            }
            fire(world, at.x, at.y, aspect, i);
          } else if (autoFire && target && fistT[i] === 0) fire(world, a.x, a.y, aspect, i);
        }
      }

      if (dt > 0) step(world, dt, aspect);
      handle();
      if (phase === 'play' && world.phase === 'over') {
        phase = 'over';
        env.sound.end();
        ch.forEach((c) => c.classList.remove('on'));
      }

      if (phase === 'play') {
        if (world.score !== shownScore) {
          shownScore = world.score;
          elScore.textContent = world.score.toLocaleString();
        }
        elMult.hidden = world.multiplier < 2;
        elMult.textContent = `x${world.multiplier}`;
        elWave.textContent = String(world.wave);
        if (world.lives !== shownLives) {
          const lost = shownLives > world.lives;
          shownLives = world.lives;
          elLives.querySelectorAll('i').forEach((el, n) => el.classList.toggle('lost', n >= world.lives));
          if (lost) {
            elLives.classList.remove('hurt');
            void elLives.offsetWidth;
            elLives.classList.add('hurt');
          }
        }
        const ammo = world.rapidT > 0 ? MAG : world.ammo;
        if (ammo !== shownAmmo) {
          shownAmmo = ammo;
          pips.forEach((p, n) => p.classList.toggle('spent', n >= ammo));
        }
        elAmmo.classList.toggle('rapid', world.rapidT > 0);
        elAmmo.classList.toggle('reloading', world.reloadT > 0);
        elAmmo.style.setProperty('--rapid', String(world.rapidT / RAPID_S));
        const pw: string[] = [];
        if (world.rapidT > 0) pw.push(`<span class="pw double">RAPID ${world.rapidT.toFixed(1)}</span>`);
        if (world.slowT > 0) pw.push(`<span class="pw freeze">SLOW-MO ${world.slowT.toFixed(1)}</span>`);
        const html = pw.join('');
        if (html !== shownPowers) {
          shownPowers = html;
          elPowers.innerHTML = html;
        }
      }
      dmgFlash = Math.max(0, dmgFlash - dt * 2.5);
      elDmg.style.opacity = String(Math.max(dmgFlash, phase === 'play' && world.lives === 1 ? 0.3 + Math.sin(performance.now() / 180) * 0.12 : 0));

      scene.update(world, dt, visAims);
    },
    resize() {
      scene.resize();
    },
    result() {
      const headline = world.wave >= 12 ? 'Legendary Marksman' : world.wave >= 8 ? 'Eagle Eye' : world.wave >= 5 ? 'Sharpshooter' : world.wave >= 3 ? 'Steady Hand' : 'Fresh Recruit';
      return {
        score: world.score,
        headline,
        stats: [
          { label: 'Wave', value: String(world.wave) },
          { label: 'Birds', value: String(world.kills) },
          { label: 'Accuracy', value: `${accuracy(world)}%` },
          { label: 'Best Streak', value: String(world.bestStreak) },
        ],
      };
    },
    bot(dt) {
      return bot.update(world, dt, innerWidth / Math.max(1, innerHeight), aims[0]);
    },
    stats() {
      return { score: world.score, wave: world.wave, kills: world.kills, escaped: world.escaped, shots: world.shots, hits: world.hits, lives: world.lives, ammo: world.ammo, birds: world.birds.length };
    },
    dispose() {
      removeEventListener('keydown', onKey);
      scene.dispose();
      env.hud.innerHTML = '';
    },
  };
  return game;
}

const GUN: HandPose = { curl: [0, 0, 1, 1, 1], pinch: 0 };
const BANG: HandPose = { curl: [1, 0, 1, 1, 1], pinch: 0 };
const FIST: HandPose = { curl: [1, 1, 1, 1, 1], pinch: 0 };

/** Synthetic hunter: tracks the bird closest to escaping, drops its thumb to fire, makes a fist to reload. */
class ShooterBot {
  x = 0.5;
  y = 0.45;
  private bangT = 0;
  private fistT = 0;
  private settle = 0;

  update(w: World, dt: number, aspect: number, aim: { x: number; y: number }): BotHandState[] {
    const out = (pose: HandPose) => [{ x: this.x, y: this.y, pinch: 0, pose }];
    if (w.phase !== 'play') return out(GUN);
    if (this.fistT > 0) {
      this.fistT -= dt;
      return out(FIST);
    }
    if (this.bangT > 0) {
      this.bangT -= dt;
      return out(this.bangT > 0.05 ? BANG : GUN);
    }
    if (w.ammo <= 0 && w.reloadT <= 0 && w.rapidT <= 0) {
      this.fistT = 0.5;
      return out(FIST);
    }
    let best: Bird | null = null;
    let bestScore = -Infinity;
    for (const e of w.birds) {
      const p = project(e.x, e.y, e.z, aspect);
      if (p.sx < 0.02 || p.sx > 0.98 || p.sy < 0.02 || p.sy > 0.95) continue;
      // how far across the screen it has flown (balloons are a bonus, lower priority)
      const progress = e.kind === 'balloon' ? 0.3 : e.dir > 0 ? p.sx : 1 - p.sx;
      if (progress > bestScore) {
        bestScore = progress;
        best = e;
      }
    }
    if (!best) {
      this.x += (0.5 - this.x) * dt * 2;
      this.y += (0.45 - this.y) * dt * 2;
      return out(GUN);
    }
    const p = project(best.x + best.vx * 0.08, best.y, best.z, aspect);
    const dx = (p.sx - this.x) * aspect, dy = p.sy - this.y;
    const d = Math.hypot(dx, dy);
    const v = 1.8 * dt;
    if (d > 1e-4) {
      this.x += ((dx / d) * Math.min(d, v)) / aspect;
      this.y += (dy / d) * Math.min(d, v);
    }
    const ad = Math.hypot((aim.x - p.sx) * aspect, aim.y - p.sy);
    this.settle = ad < 0.025 + best.r * p.scale ? this.settle + dt : 0;
    if (this.settle > 0.06 && w.fireCd <= 0 && w.reloadT <= 0) {
      this.bangT = 0.12;
      this.settle = 0;
    }
    return out(GUN);
  }
}
