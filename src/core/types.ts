/**
 * The contract between the arcade shell (src/main.ts) and each game.
 *
 * The shell owns the camera, the input adapter, audio, the shared WebGL renderer, the menus and the results card.
 * A game owns its own simulation, rendering and in-play HUD, and reports when its round is over.
 */
import type * as THREE from 'three';
import type { Input, HandView, BotHandState } from './input';
import type { Sound } from './audio';

export type GamePhase = 'intro' | 'play' | 'over';

export interface HowTo {
  icon: string;
  title: string;
  desc: string;
}

export interface GameMeta {
  id: 'starfall' | 'shooter' | 'fruit';
  name: string;
  tagline: string;
  /** CSS colour used for the game's accents in the shell. */
  accent: string;
  /** Which surface the game draws on. */
  surface: 'gl' | '2d';
  howTo: HowTo[];
  /** One line under the gesture grid on the intro card. */
  tip: string;
}

export interface GameResult {
  score: number;
  headline: string;
  stats: { label: string; value: string }[];
}

export interface GameEnv {
  gl: THREE.WebGLRenderer;
  canvas2d: HTMLCanvasElement;
  hud: HTMLElement;
  sound: Sound;
  input: Input;
  params: URLSearchParams;
  seed: number;
  /** Shakes the whole stage, 0..1. */
  shake(amount: number): void;
  /** Big centred announcement ("WAVE 3", "FRENZY!"). */
  banner(text: string, color?: string, sub?: string): void;
  /** Floating text at a screen point (0..1). */
  popup(x: number, y: number, text: string, color?: string, size?: number): void;
}

export interface Game {
  readonly meta: GameMeta;
  readonly phase: GamePhase;
  /** Begins (or restarts) a round. */
  start(): void;
  /** Simulates by dt (0 while paused) and renders. Called every animation frame, in every phase. */
  frame(dt: number, hands: HandView[], now: number): void;
  resize(): void;
  result(): GameResult;
  /** Synthetic player for ?bot=1. */
  bot(dt: number): BotHandState[];
  /** Values exposed on window.__game for tests. */
  stats(): Record<string, number | string>;
  onClap?(): void;
  dispose(): void;
}

export type GameFactory = (env: GameEnv) => Game;
