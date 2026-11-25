/**
 * Neon Strike: make a finger gun, aim with your index finger, drop your thumb to fire. Fist to reload.
 * Both hands can shoot. Mouse: aim, click (or hold) to fire, right-click or R to reload.
 */
import type { Game, GameEnv, GameMeta } from '../../core/types';
import type { HandView, BotHandState } from '../../core/input';
import type { HandPose } from '../../hand-gesture-kit';
import { createWorld, startGame, step, fire, reload, pick, project, accuracy, MAG, MAX_SHIELD, RAPID_S, type World, type Enemy } from './rules';
import { ShooterScene } from './scene';

export const META: GameMeta = {
  id: 'shooter',
  name: 'Neon Strike',
  tagline: 'Finger-gun blaster. Hold the line against waves of neon drones.',
  accent: '#f472b6',
  surface: 'gl',
  howTo: [
    { icon: '👉', title: 'Aim', desc: 'Make a finger gun, point your index finger' },
    { icon: '👍', title: 'Fire', desc: 'Drop your thumb down like a trigger' },
    { icon: '✊', title: 'Reload', desc: 'Make a fist (or it auto-reloads)' },
  ],
  tip: '🛡️ Anything that reaches you drains your shield. Shoot the glowing cubes: green = shield, yellow = rapid fire, white = nuke. Boss every 5th wave.',
};

/** Thumb-drop trigger with hysteresis: fires once per drop, re-arms when the thumb comes back up. */
class Trigger {
  armed = false;
  down = false;
  update(h: HandView): boolean {
    // the thumb is "up" when it sticks out and isn't curled across the palm
    const v = Math.max(1 - h.thumbOut, h.curl[0]);
    if (!this.down && v > 0.55) {
      this.down = true;
      if (this.armed) {
        this.armed = false;
        return true;
      }
    } else if (v < 0.32) {
      // thumb back up: ready for the next shot
      this.down = false;
      this.armed = true;
    }
    return false;
  }
}

const isFist = (h: HandView) => h.pose === 'fist' || (h.curl[1] > 0.7 && h.curl[2] > 0.7 && h.curl[3] > 0.6);

export function createShooter(env: GameEnv): Game {
  const world = createWorld(env.seed);
  const scene = new ShooterScene(env.gl);
  const triggers = [new Trigger(), new Trigger()];
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
      <div class="hud-block center"><span class="hud-label">Wave</span><span class="hud-val small" data-k="wave">1</span></div>
      <div class="hud-block right">
        <span class="hud-label">Shield</span>
        <div class="shield"><div data-k="shield"></div></div>
      </div>
    </div>
    <div class="ammo" data-k="ammo"></div>
    <div class="crosshair" data-k="ch0"><i></i><b></b><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/></svg></div>
    <div class="crosshair alt" data-k="ch1"><i></i><b></b><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/></svg></div>
    <div class="damage-vignette" data-k="dmg"></div>
    <label class="hud-toggle"><input type="checkbox" data-k="auto"> Auto-fire on target</label>`;
  const $ = (k: string) => env.hud.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
  const elScore = $('score'), elMult = $('mult'), elWave = $('wave'), elShield = $('shield'), elAmmo = $('ammo'), elDmg = $('dmg');
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
  autoBox.addEventListener('pointerdown', (e) => e.stopPropagation());
  elAmmo.innerHTML = '<i></i>'.repeat(MAG);
  const pips = [...elAmmo.querySelectorAll('i')];
  let shownAmmo = -1, shownScore = -1, shownShield = -1;
  let dmgFlash = 0;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'r' || e.key === 'R') reload(world);
  };
  addEventListener('keydown', onKey);

  const handle = () => {
    for (const e of world.events) {
      switch (e.type) {
        case 'shot':
          scene.tracer(e.hand, e.x, e.y, e.z, e.hand === 0 ? 0x7cf3ff : 0xff8ad8);
          env.sound.gunshot(e.rapid);
          if (e.hit) {
            const el = ch[e.hand] ?? ch[0];
            el.classList.remove('hit');
            void el.offsetWidth;
            el.classList.add('hit');
          }
          break;
        case 'hit':
          scene.hitSpark(e.x, e.y, e.z, e.kind);
          env.sound.hit();
          break;
        case 'kill': {
          scene.explode(e.x, e.y, e.z, e.kind);
          env.sound.explosion(e.kind === 'boss' ? 2 : e.kind === 'tank' ? 1.1 : 0.6);
          const p = project(e.x, e.y, e.z, innerWidth / innerHeight);
          if (e.kind === 'pickup') {
            env.sound.powerup();
            const label = e.pickup === 'shield' ? '+30 SHIELD' : e.pickup === 'rapid' ? 'RAPID FIRE' : 'NUKE!';
            env.banner(label, e.pickup === 'shield' ? '#4ade80' : e.pickup === 'rapid' ? '#facc15' : '#ffffff');
            if (e.pickup === 'nuke') {
              env.shake(0.9);
              scene.gridPulse(2.5);
            }
          } else {
            env.popup(p.sx, p.sy, `+${e.points}`, e.kind === 'boss' ? '#e9d5ff' : '#fdf2f8', e.kind === 'boss' ? 40 : 22);
          }
          if (e.kind === 'boss') {
            env.banner('BOSS DESTROYED', '#c084fc', `+${e.points}`);
            env.shake(1);
          }
          break;
        }
        case 'impact':
          env.sound.damage();
          env.shake(0.7);
          dmgFlash = 1;
          break;
        case 'empty':
          env.sound.emptyClick();
          break;
        case 'reload':
          env.sound.reload();
          break;
        case 'wave':
          env.banner(e.boss ? `BOSS WAVE ${e.wave}` : `WAVE ${e.wave}`, e.boss ? '#c084fc' : '#f472b6', e.boss ? 'Destroy the mothership' : 'Incoming');
          if (e.boss) env.sound.alarm();
          else env.sound.waveStart();
          scene.gridPulse(1.2);
          break;
        case 'waveClear':
          env.banner('WAVE CLEAR', '#4ade80', `+${e.bonus}`);
          env.sound.fanfare();
          break;
        case 'multiplier':
          if (e.value > 1) env.popup(0.5, 0.2, `x${e.value} STREAK`, '#facc15', 26);
          break;
        case 'missile':
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
      phase = 'play';
      shownAmmo = shownScore = shownShield = -1;
      env.sound.setTheme('synth');
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
          continue;
        }
        // smooth the aim a little more than the engine does, but stay responsive on big moves
        const a = aims[i];
        const k = Math.min(1, dt * (pointer ? 60 : 22));
        a.x += (h.tip.x - a.x) * k;
        a.y += (h.tip.y - a.y) * k;
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
          const pulled = triggers[i].update(h);
          if (isFist(h)) {
            fistT[i] += dt;
            if (fistT[i] > 0.15) reload(world);
          } else {
            fistT[i] = 0;
            if (pulled || (autoFire && target)) fire(world, a.x, a.y, aspect, i);
          }
        }
      }

      if (dt > 0) step(world, dt);
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
        if (world.shield !== shownShield) {
          shownShield = world.shield;
          const f = world.shield / MAX_SHIELD;
          elShield.style.transform = `scaleX(${f})`;
          elShield.style.background = f > 0.5 ? '#4ade80' : f > 0.25 ? '#facc15' : '#f87171';
        }
        const ammo = world.rapidT > 0 ? MAG : world.ammo;
        if (ammo !== shownAmmo || world.rapidT > 0) {
          shownAmmo = ammo;
          pips.forEach((p, k) => p.classList.toggle('spent', k >= ammo));
        }
        elAmmo.classList.toggle('rapid', world.rapidT > 0);
        elAmmo.classList.toggle('reloading', world.reloadT > 0);
        elAmmo.style.setProperty('--rapid', String(world.rapidT / RAPID_S));
      }
      dmgFlash = Math.max(0, dmgFlash - dt * 2.5);
      elDmg.style.opacity = String(Math.max(dmgFlash, phase === 'play' && world.shield < 30 ? 0.35 + Math.sin(performance.now() / 180) * 0.15 : 0));

      scene.update(world, dt, visAims);
    },
    resize() {
      scene.resize();
    },
    result() {
      const s = world.score;
      const headline = world.wave >= 10 ? 'Neon Legend' : world.wave >= 7 ? 'Grid Guardian' : world.wave >= 5 ? 'Boss Breaker' : world.wave >= 3 ? 'Sharpshooter' : 'Rookie Pilot';
      return {
        score: s,
        headline,
        stats: [
          { label: 'Wave', value: String(world.wave) },
          { label: 'Kills', value: String(world.kills) },
          { label: 'Accuracy', value: `${accuracy(world)}%` },
          { label: 'Best Streak', value: String(world.bestStreak) },
        ],
      };
    },
    bot(dt) {
      return bot.update(world, dt, innerWidth / Math.max(1, innerHeight), aims[0]);
    },
    stats() {
      return { score: world.score, wave: world.wave, kills: world.kills, shots: world.shots, hits: world.hits, shield: world.shield, ammo: world.ammo, enemies: world.enemies.length };
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

/** Synthetic gunner: tracks the most urgent enemy, drops its thumb to fire, makes a fist to reload. */
class ShooterBot {
  x = 0.5;
  y = 0.55;
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
      this.fistT = 0.35;
      return out(FIST);
    }
    // most urgent = closest to the player (pickups when nothing is close)
    let best: Enemy | null = null;
    let bestScore = -Infinity;
    for (const e of w.enemies) {
      if (e.z < -65) continue;
      const s = e.z + (e.kind === 'pickup' ? 10 : 0) + (e.kind === 'missile' ? 8 : 0);
      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    if (!best) {
      this.x += (0.5 - this.x) * dt * 2;
      this.y += (0.5 - this.y) * dt * 2;
      return out(GUN);
    }
    const lead = 0.06;
    const p = project(best.x, best.y, best.z + best.speed * lead, aspect);
    const dx = (p.sx - this.x) * aspect, dy = p.sy - this.y;
    const d = Math.hypot(dx, dy);
    const v = 2.4 * dt;
    if (d > 1e-4) {
      this.x += (dx / d) * Math.min(d, v) / aspect;
      this.y += (dy / d) * Math.min(d, v);
    }
    // fire once the smoothed aim has caught up
    const ad = Math.hypot((aim.x - p.sx) * aspect, aim.y - p.sy);
    this.settle = ad < 0.03 + best.r * p.scale ? this.settle + dt : 0;
    if (this.settle > 0.05 && w.fireCd <= 0 && w.reloadT <= 0) {
      this.bangT = 0.12;
      this.settle = 0;
    }
    return out(GUN);
  }
}
