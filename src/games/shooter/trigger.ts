/**
 * Thumb-drop trigger that calibrates itself to each hand.
 *
 * Input: the thumb gap (thumb tip to the index finger's base, divided by the wrist→index-knuckle length) every frame.
 * Everybody's "thumb up" is different, and it changes as the hand turns, so instead of fixed thresholds the trigger
 * follows the recent *peak* gap (the thumb-up position) and fires when the gap drops well below it:
 *
 *   fire    when gap < peak × FIRE_RATIO   (the thumb came down a good way from where it was)
 *   re-arm  when gap > peak × REARM_RATIO  (the thumb went back up)
 *
 * The peak follows the gap up instantly and sinks back slowly, so a glitchy high reading can't lock it out, and a
 * hand that never stretches its thumb fully still works. MIN_PEAK keeps a permanently tucked thumb (or noise around
 * a fist) from firing.
 */
export const FIRE_RATIO = 0.72;
export const REARM_RATIO = 0.86;
export const MIN_PEAK = 0.42;
/** How fast the remembered thumb-up position sinks toward the current gap (per second). */
const DECAY_ARMED = 0.6;
const DECAY_FIRED = 0.25;

export class ThumbTrigger {
  peak = 0;
  armed = false;
  /** 0 (thumb up) … 1 (at the firing point), for the on-screen trigger meter. */
  level = 0;

  reset() {
    this.peak = 0;
    this.armed = false;
    this.level = 0;
  }

  /** Feed one frame. Returns true on the frame the shot fires. */
  update(gap: number, dt: number): boolean {
    if (!Number.isFinite(gap)) return false;
    if (gap > this.peak) this.peak = gap;
    else this.peak -= (this.peak - gap) * Math.min(1, dt * (this.armed ? DECAY_ARMED : DECAY_FIRED));

    const peak = Math.max(this.peak, MIN_PEAK);
    this.level = Math.max(0, Math.min(1, (peak - gap) / (peak * (1 - FIRE_RATIO))));

    if (this.armed && gap < peak * FIRE_RATIO) {
      this.armed = false;
      return true;
    }
    if (!this.armed && gap > peak * REARM_RATIO && this.peak >= MIN_PEAK) this.armed = true;
    return false;
  }
}

/** Remembers recent aim points so a shot can use where you were aiming *before* the thumb press nudged the hand. */
export class AimHistory {
  private buf: { t: number; x: number; y: number }[] = [];

  push(t: number, x: number, y: number) {
    this.buf.push({ t, x, y });
    while (this.buf.length > 2 && t - this.buf[0].t > 600) this.buf.shift();
  }

  /** The aim `ms` milliseconds ago (or the oldest kept). */
  at(t: number, ms: number): { x: number; y: number } | null {
    if (!this.buf.length) return null;
    const want = t - ms;
    for (let i = this.buf.length - 1; i >= 0; i--) if (this.buf[i].t <= want) return this.buf[i];
    return this.buf[0];
  }

  clear() {
    this.buf.length = 0;
  }
}
