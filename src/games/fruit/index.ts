/**
 * Juice Dojo: slice tossed fruit with a fast fingertip. Three lives; bombs and dropped fruit cost one.
 */
import type { Game, GameEnv, GameMeta } from '../../core/types';
import type { HandView, BotHandState } from '../../core/input';
import { createWorld, startGame, step, blade, isSpecial, MAX_LIVES, BLADE_MIN_SPEED, distToSegment, type World, type Fruit } from './rules';
import { FruitRenderer, type BladeVis } from './render';

export const META: GameMeta = {
  id: 'fruit',
  name: 'Juice Dojo',
  tagline: 'Slash flying fruit with your fingertip. Never touch the bombs.',
  accent: '#fb923c',
  surface: '2d',
  howTo: [
    { icon: '☝️', title: 'Finger Blade', desc: 'Swipe your index finger fast to cut' },
    { icon: '🍉', title: 'Combos', desc: '3+ fruit in one swipe = bonus points' },
    { icon: '💣', title: 'Bombs', desc: 'Cost a life and blow up the board' },
  ],
  tip: '❤️ 3 lives: every fruit you drop costs one. Pink fruit = Frenzy, blue = Freeze time, gold = Double points.',
};

const JUICE: Record<string, string> = {
  watermelon: '#ff5a6e', orange: '#ffb347', apple: '#ffe9a8', lemon: '#fff27a', kiwi: '#a3e05a',
  plum: '#d4a5ff', peach: '#ffb38a', coconut: '#ffffff', frenzy: '#ff7ad1', freeze: '#9be3ff', double: '#ffd447',
};

export function createFruit(env: GameEnv): Game {
  const world = createWorld(env.seed);
  const r = new FruitRenderer(env.canvas2d);
  let phase: Game['phase'] = 'intro';
  const bot = new FruitBot();

  env.hud.innerHTML = `
    <div class="hud-bar">
      <div class="hud-block"><span class="hud-label">Score</span><span class="hud-val" data-k="score">0</span></div>
      <div class="hud-block center"><div class="powers" data-k="powers"></div></div>
      <div class="hud-block right"><span class="hud-label">Lives</span><div class="lives" data-k="lives">${'<i></i>'.repeat(MAX_LIVES)}</div></div>
    </div>`;
  const $ = (k: string) => env.hud.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
  const elScore = $('score'), elLives = $('lives'), elPowers = $('powers');
  let shownLives = MAX_LIVES;
  let shownPowers = '';

  const handle = () => {
    for (const e of world.events) {
      switch (e.type) {
        case 'slice':
          r.splat(e.x, e.y, e.kind, e.angle);
          env.sound.splat();
          env.popup(e.x, e.y - 0.05, `+${e.points}`, JUICE[e.kind] ?? '#fff', isSpecial(e.kind) ? 30 : 22);
          break;
        case 'combo':
          env.sound.comboChime(e.n);
          env.banner(`${e.n} FRUIT COMBO`, '#fde047', `+${e.bonus}`);
          break;
        case 'bomb':
          r.blast(e.x, e.y);
          env.sound.explosion(1.2);
          env.shake(1);
          break;
        case 'miss':
          r.miss(e.x);
          env.sound.lifeLost();
          break;
        case 'power':
          if (e.kind === 'frenzy') {
            env.banner('FRUIT FRENZY!', '#ff7ad1', 'Slice everything!');
            env.sound.powerup();
            r.pulse('255,90,190');
          } else if (e.kind === 'freeze') {
            env.banner('FREEZE', '#9be3ff', 'Time slows down');
            env.sound.freeze();
            r.pulse('170,230,255');
          } else {
            env.banner('DOUBLE POINTS', '#ffd447');
            env.sound.powerup();
            r.pulse('255,210,80');
          }
          break;
        case 'life':
          if (e.lives > shownLives) env.popup(0.88, 0.12, '+1 ❤️', '#fca5a5', 26);
          break;
        case 'launch':
          env.sound.launch();
          if (e.bomb) env.sound.fuse();
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
      startGame(world);
      phase = 'play';
      r.clearTrails();
      shownLives = -1;
      env.sound.setTheme('dojo');
    },
    frame(dt, hands: HandView[], now) {
      const aspect = innerWidth / Math.max(1, innerHeight);
      const blades: BladeVis[] = [];
      for (let i = 0; i < 2; i++) {
        const h = hands[i];
        if (!h) {
          blades.push({ active: false, speed: 0, x: 0, y: 0 });
          if (dt > 0) blade(world, i, { x: 0, y: 0 }, { x: 0, y: 0 }, 0, aspect, dt);
          continue;
        }
        const fast = h.speed >= BLADE_MIN_SPEED * 0.8;
        blades.push({ active: fast || phase !== 'play', speed: h.speed, x: h.tip.x, y: h.tip.y });
        if (dt > 0) {
          blade(world, i, h.prevTip, h.tip, h.speed, aspect, dt);
          if (phase === 'play' && h.speed > 2.2) env.sound.slash(Math.min(1.4, h.speed / 3.5));
        }
      }
      if (dt > 0) step(world, dt);
      handle();
      if (phase === 'play' && world.phase === 'over') {
        phase = 'over';
        env.sound.end();
      }

      if (phase === 'play') {
        elScore.textContent = world.score.toLocaleString();
        if (world.lives !== shownLives) {
          const lost = shownLives > world.lives && shownLives !== -1;
          shownLives = world.lives;
          elLives.querySelectorAll('i').forEach((el, k) => el.classList.toggle('lost', k >= world.lives));
          if (lost) {
            elLives.classList.remove('hurt');
            void elLives.offsetWidth;
            elLives.classList.add('hurt');
          }
        }
        const p: string[] = [];
        if (world.frenzyT > 0) p.push(`<span class="pw frenzy">FRENZY ${world.frenzyT.toFixed(1)}</span>`);
        if (world.freezeT > 0) p.push(`<span class="pw freeze">FREEZE ${world.freezeT.toFixed(1)}</span>`);
        if (world.doubleT > 0) p.push(`<span class="pw double">×2 ${world.doubleT.toFixed(1)}</span>`);
        const html = p.join('');
        if (html !== shownPowers) {
          shownPowers = html;
          elPowers.innerHTML = html;
        }
      }
      r.draw(world, dt, blades, now);
    },
    resize() {
      r.resize();
    },
    result() {
      const s = world.score;
      const headline = s >= 3000 ? 'Grand Juice Master' : s >= 1800 ? 'Blade Sensei' : s >= 900 ? 'Fruit Samurai' : s >= 350 ? 'Dojo Apprentice' : 'Fresh Squeeze';
      return {
        score: s,
        headline,
        stats: [
          { label: 'Fruit Sliced', value: String(world.sliced) },
          { label: 'Best Combo', value: world.bestCombo ? `${world.bestCombo} fruit` : '—' },
          { label: 'Time', value: `${Math.floor(world.time)}s` },
        ],
      };
    },
    bot(dt) {
      return bot.update(world, dt, innerWidth / Math.max(1, innerHeight));
    },
    stats() {
      return { score: world.score, sliced: world.sliced, lives: world.lives, missed: world.missed, bombsHit: world.bombsHit, bestCombo: world.bestCombo, time: world.time, fruits: world.fruits.length };
    },
    dispose() {
      r.dispose();
      env.hud.innerHTML = '';
    },
  };
  return game;
}

/** Synthetic player: swipes through the nearest fruit, steering around bombs. */
class FruitBot {
  x = 0.5;
  y = 0.7;
  private cooldown = 0;

  update(w: World, dt: number, aspect: number): BotHandState[] {
    if (w.phase !== 'play') return [{ x: this.x, y: this.y, pinch: 0 }];
    this.cooldown -= dt;
    const bombs = w.fruits.filter((f) => f.kind === 'bomb');
    const targets = w.fruits.filter((f) => f.kind !== 'bomb' && f.y < 0.92 && f.y > 0.06);
    let best: Fruit | null = null;
    let bestD = Infinity;
    for (const f of targets) {
      const d = Math.hypot((f.x - this.x) * aspect, f.y - this.y) - (f.vy > 0 ? 0.15 : 0) - (isSpecial(f.kind) ? 0.2 : 0);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (!best) {
      this.x += (0.5 - this.x) * dt * 1.5;
      this.y += (0.6 - this.y) * dt * 1.5;
      return [{ x: this.x, y: this.y, pinch: 0 }];
    }
    // aim slightly through the fruit so the stroke carries on past it
    const tx = best.x + best.vx * 0.08, ty = best.y + best.vy * 0.08;
    let dx = (tx - this.x) * aspect, dy = ty - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    dx /= dist;
    dy /= dist;
    const v = 2.8 * dt;
    let nx = this.x + (dx * Math.min(dist + 0.04, v)) / aspect;
    let ny = this.y + dy * Math.min(dist + 0.04, v);
    // dodge: if this step would cross a bomb, sidestep perpendicular instead
    for (const b of bombs) {
      if (distToSegment(b.x, b.y, this.x, this.y, nx, ny, aspect) < b.r + 0.05) {
        nx = this.x - (dy * v) / aspect;
        ny = this.y + dx * v;
        if (distToSegment(b.x, b.y, this.x, this.y, nx, ny, aspect) < b.r + 0.05) {
          nx = this.x + (dy * v) / aspect;
          ny = this.y - dx * v;
        }
      }
    }
    this.x = Math.max(0.02, Math.min(0.98, nx));
    this.y = Math.max(0.02, Math.min(0.98, ny));
    return [{ x: this.x, y: this.y, pinch: 0 }];
  }
}
