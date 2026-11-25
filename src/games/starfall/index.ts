/**
 * Starfall Blade: slice rising crystals with your palm, pinch-and-release for a Nova, clap for a Shockwave.
 */
import type { Game, GameEnv, GameMeta } from '../../core/types';
import type { HandView } from '../../core/input';
import { PinchLatch } from '../../core/pinch';
import { createWorld, startRound, step, trySlice, tryNova, tryShockwave, ROUND_S, CLAP_COOLDOWN_S, type SliceResult } from './rules';
import { StarfallScene, type HandVis } from './scene';
import { Bot } from './bot';

export const META: GameMeta = {
  id: 'starfall',
  name: 'Starfall Blade',
  tagline: 'Slice rising cosmic crystals. Chain combos. Dodge the void.',
  accent: '#38bdf8',
  surface: 'gl',
  howTo: [
    { icon: '⚔️', title: 'Blade Slash', desc: 'Sweep your hand through crystals' },
    { icon: '🤏', title: 'Pinch Nova', desc: 'Pinch, hold a beat, release to blast' },
    { icon: '👏', title: 'Cosmic Clap', desc: 'Clap both hands to clear the sky' },
  ],
  tip: '⚠️ Avoid dark red Void Orbs: they cost points and break your combo. White Nova Stars chain-slice everything.',
};

const NOVA_CHARGE_S = 0.15;
const COLORS = { crystal: '#7dd3fc', prism: '#f0abfc', gold: '#fde047', star: '#ffffff' } as const;

export function createStarfall(env: GameEnv): Game {
  const roundS = Number(env.params.get('round')) || ROUND_S;
  const world = createWorld(env.seed, roundS);
  const scene = new StarfallScene(env.gl);
  const bot = new Bot();
  const latches = [new PinchLatch(), new PinchLatch()];
  const charge = [0, 0];
  let phase: Game['phase'] = 'intro';
  let lastTick = -1;

  env.hud.innerHTML = `
    <div class="hud-bar">
      <div class="hud-block"><span class="hud-label">Score</span><span class="hud-val" data-k="score">0</span></div>
      <div class="hud-block center">
        <div class="combo-badge" data-k="combo" hidden><span>x2</span> COMBO</div>
      </div>
      <div class="hud-block right"><span class="hud-label">Time</span><span class="hud-val" data-k="time">${roundS}</span></div>
    </div>
    <div class="hud-meter" title="Cosmic Clap">
      <span class="hud-label">👏 Clap</span>
      <div class="meter"><div class="meter-fill" data-k="clap"></div></div>
    </div>
    <div class="timebar"><div data-k="timebar"></div></div>`;
  const $ = (k: string) => env.hud.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
  const elScore = $('score'), elTime = $('time'), elCombo = $('combo'), elClap = $('clap'), elBar = $('timebar');
  let shownScore = 0;
  let shownCombo = 1;

  const report = (res: SliceResult) => {
    for (const t of res.sliced) {
      if (t.kind === 'void') continue;
      scene.burst(t.x, t.y, t.kind, t.kind === 'star');
      env.sound.slice(res.combo, t.kind);
      const pts = { crystal: 100, prism: 200, gold: 350, star: 500 }[t.kind] * Math.max(1, res.combo);
      env.popup(t.x, t.y - 0.04, `+${pts}`, COLORS[t.kind], t.kind === 'star' ? 34 : 24);
    }
    if (res.starHit) {
      env.banner('NOVA CHAIN!', '#ffffff');
      env.shake(0.5);
    }
    if (res.voidHit) {
      env.sound.void();
      env.shake(0.8);
      env.popup(0.5, 0.42, 'VOID −150', '#f87171', 30);
    }
    if (res.sliced.length >= 3 && !res.starHit) env.banner(`${res.sliced.length}× MULTI-SLICE`, '#f0abfc');
  };

  const game: Game = {
    meta: META,
    get phase() {
      return phase;
    },
    start() {
      startRound(world);
      latches.forEach((l) => l.reset());
      charge[0] = charge[1] = 0;
      lastTick = -1;
      phase = 'play';
      env.sound.setTheme('cosmic');
    },
    frame(dt, hands: HandView[], now) {
      const aspect = innerWidth / Math.max(1, innerHeight);
      const playing = phase === 'play';
      const vis: HandVis[] = [];

      if (dt > 0) {
        step(world, dt);
        if (playing && world.phase === 'results') {
          phase = 'over';
          env.sound.end();
        }
      }

      for (let i = 0; i < 2; i++) {
        const h = hands[i];
        if (!h) {
          vis.push({ x: 0.5, y: 0.5, pinch: 0, charge: 0, active: false, speed: 0 });
          latches[i].reset();
          charge[i] = 0;
          continue;
        }
        vis.push({ x: h.palm.x, y: h.palm.y, pinch: h.pinch, charge: latches[i].down ? charge[i] : 0, active: true, speed: h.speed });
        if (!playing || dt === 0) continue;

        const moved = Math.hypot((h.palm.x - h.prevPalm.x) * aspect, h.palm.y - h.prevPalm.y);
        if (moved > 0.002) {
          const res = trySlice(world, h.prevPalm, h.palm, aspect);
          if (res.sliced.length || res.voidHit) report(res);
          if (h.speed > 1.6) env.sound.slash(Math.min(1.5, h.speed / 3));
        }

        const edge = latches[i].update(h.pinch);
        if (edge === 'press') charge[i] = 0;
        else if (edge === 'release') {
          if (charge[i] >= NOVA_CHARGE_S) {
            const res = tryNova(world, h.palm, aspect);
            env.sound.nova();
            scene.nova(h.palm.x, h.palm.y);
            env.shake(0.35);
            report(res);
          }
          charge[i] = 0;
        }
        if (latches[i].down) charge[i] += dt;
      }

      if (playing) {
        if (world.score !== shownScore) {
          shownScore = world.score;
          elScore.textContent = shownScore.toLocaleString();
        }
        const left = Math.max(0, Math.ceil(world.roundS - world.time));
        elTime.textContent = String(left);
        elTime.classList.toggle('warn', left <= 5);
        if (left <= 5 && left !== lastTick && left > 0) {
          lastTick = left;
          env.sound.tick();
        }
        elBar.style.transform = `scaleX(${Math.max(0, 1 - world.time / world.roundS)})`;
        if (world.combo !== shownCombo) {
          shownCombo = world.combo;
          elCombo.hidden = world.combo < 2;
          elCombo.querySelector('span')!.textContent = `x${world.combo}`;
          elCombo.classList.remove('pop');
          void elCombo.offsetWidth;
          elCombo.classList.add('pop');
        }
        const ready = world.clapCooldown <= 0;
        elClap.style.transform = `scaleX(${1 - world.clapCooldown / CLAP_COOLDOWN_S})`;
        elClap.classList.toggle('ready', ready);
      }

      scene.update(world, dt, vis, now);
    },
    resize() {
      scene.resize();
    },
    result() {
      const s = world.score;
      const headline = s >= 25000 ? 'Celestial Legend' : s >= 15000 ? 'Star Sovereign' : s >= 8000 ? 'Cosmic Adept' : s >= 3000 ? 'Rising Comet' : 'Stardust Initiate';
      return {
        score: s,
        headline,
        stats: [
          { label: 'Crystals', value: String(world.slicedCount) },
          { label: 'Max Combo', value: `x${world.maxCombo}` },
        ],
      };
    },
    bot(dt) {
      return bot.update(world, dt, innerWidth / Math.max(1, innerHeight), phase === 'over');
    },
    stats() {
      return { score: world.score, slicedCount: world.slicedCount, maxCombo: world.maxCombo, combo: world.combo, time: world.time, targetsCount: world.targets.length };
    },
    onClap() {
      if (phase !== 'play') return;
      const res = tryShockwave(world);
      if (world.shockwaveActive > 0.59) {
        env.sound.shockwave();
        env.shake(0.6);
        env.banner('COSMIC SHOCKWAVE', '#9ae6ff');
        report(res);
      }
    },
    dispose() {
      scene.dispose();
      env.hud.innerHTML = '';
    },
  };
  return game;
}
