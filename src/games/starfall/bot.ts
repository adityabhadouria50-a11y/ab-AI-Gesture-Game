/**
 * ?bot=1: Synthetic AI player.
 * Steers synthetic hands through the gesture engine, slicing through crystals,
 * dodging void anomalies, chaining multi-combos, and restarting on results.
 */
import type { World, Target } from './rules';
import type { BotHandState } from '../../core/input';

export class Bot {
  x = 0.5;
  y = 0.65;
  pinch = 0;

  private holdPinch = 0;

  update(w: World, dt: number, aspect: number, _over = false): BotHandState[] {
    if (w.phase !== 'play') {
      this.pinch = 0;
      return [this.out()];
    }

    // Handle active pinch/Nova hold
    if (this.holdPinch > 0) {
      this.holdPinch -= dt;
      this.pinch = this.holdPinch > 0.1 ? 1 : 0;
      return [this.out()];
    }

    // Pick best target (exclude void anomalies)
    const candidates = w.targets.filter(
      (t) => t.kind !== 'void' && t.y > 0.18 && t.y < 0.85
    );

    if (candidates.length === 0) {
      // Drift gently toward center
      this.x += (0.5 - this.x) * dt * 2.0;
      this.y += (0.6 - this.y) * dt * 2.0;
      this.pinch = 0;
      return [this.out()];
    }

    // Priority: star > gold > prism > crystal
    const score = (t: Target) => {
      const dist = Math.hypot((t.x - this.x) * aspect, t.y - this.y);
      const bonus =
        t.kind === 'star' ? -0.4 : t.kind === 'gold' ? -0.3 : t.kind === 'prism' ? -0.15 : 0;
      return dist + bonus;
    };

    const target = [...candidates].sort((a, b) => score(a) - score(b))[0];

    // Predict target trajectory slightly ahead
    const predictT = 0.12;
    const targetX = Math.max(0.12, Math.min(0.88, target.x + target.vx * predictT));
    const targetY = Math.max(0.12, Math.min(0.88, target.y + target.vy * predictT));

    const dx = (targetX - this.x) * aspect;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy);

    // Fast slicing stroke speed (about 1.8 screen heights per second)
    const speed = 1.9 * dt;
    if (dist > 1e-4) {
      this.x += (dx / dist) * (Math.min(dist, speed) / aspect);
      this.y += (dy / dist) * Math.min(dist, speed);
    }

    // If close enough and multiple candidates near, trigger nova occasionally
    const nearby = candidates.filter(
      (c) => Math.hypot((c.x - this.x) * aspect, c.y - this.y) < 0.18
    );
    if (nearby.length >= 2 && Math.random() < 0.05) {
      this.holdPinch = 0.28;
    }

    return [this.out()];
  }

  private out(): BotHandState {
    return { x: this.x, y: this.y, pinch: this.pinch };
  }
}
