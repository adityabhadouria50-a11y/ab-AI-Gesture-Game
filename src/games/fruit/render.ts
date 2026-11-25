/**
 * Juice Dojo renderer (Canvas 2D).
 *
 * Fruit are painted procedurally once per size into sprite canvases (whole fruit + its cut face), then blitted with
 * rotation every frame. Juice splats are painted into a separate stain layer that slowly fades, droplets are simple
 * particles, and the blade is a tapered polygon with a coloured glow and a white core.
 */
import type { World, Kind, Half, Fruit } from './rules';

interface Art {
  skin: [string, string, string]; // highlight, mid, shadow
  flesh: string;
  rind: string;
  juice: string;
  glow?: string;
}

const ART: Record<Kind, Art> = {
  watermelon: { skin: ['#7fd36b', '#2f8f3a', '#0f4a1c'], flesh: '#ff3b4f', rind: '#d9f7c4', juice: '255,60,80' },
  orange: { skin: ['#ffd27a', '#ff9418', '#c25a00'], flesh: '#ffae33', rind: '#fff1d2', juice: '255,160,40' },
  apple: { skin: ['#ff8a8a', '#e01f2d', '#7c0610'], flesh: '#fff3c8', rind: '#e01f2d', juice: '255,240,190' },
  lemon: { skin: ['#fff7a8', '#f7dc1c', '#b99800'], flesh: '#fff27a', rind: '#fffbe0', juice: '255,240,90' },
  kiwi: { skin: ['#b48a5c', '#7a5530', '#3f2a14'], flesh: '#8fd13b', rind: '#5c3d1f', juice: '150,220,70' },
  plum: { skin: ['#c68bff', '#6b23b8', '#2c0a52'], flesh: '#ffc34d', rind: '#6b23b8', juice: '190,90,240' },
  peach: { skin: ['#ffd1a6', '#ff8c69', '#c2464b'], flesh: '#ffb347', rind: '#ff8c69', juice: '255,170,90' },
  coconut: { skin: ['#a67651', '#6b4429', '#2e1a0c'], flesh: '#fffdf5', rind: '#5a3a20', juice: '250,250,240' },
  frenzy: { skin: ['#ff9ad5', '#e0218a', '#7a0a47'], flesh: '#fdf7fb', rind: '#e0218a', juice: '255,80,180', glow: '255,80,190' },
  freeze: { skin: ['#e6fbff', '#6fd3ff', '#1f6ea8'], flesh: '#dff7ff', rind: '#9be3ff', juice: '170,230,255', glow: '120,210,255' },
  double: { skin: ['#fff5b8', '#ffc928', '#a86b00'], flesh: '#fff3c8', rind: '#ffc928', juice: '255,215,80', glow: '255,205,60' },
  bomb: { skin: ['#6b6b78', '#22222a', '#050507'], flesh: '#111', rind: '#111', juice: '255,140,40', glow: '255,60,40' },
};

interface Sprite {
  whole: HTMLCanvasElement;
  cut: HTMLCanvasElement;
  size: number;
}

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  max: number;
  color: string;
}

interface Ring {
  x: number;
  y: number;
  t: number;
  max: number;
  color: string;
  width: number;
}

interface Miss {
  x: number;
  t: number;
}

export interface BladeVis {
  active: boolean;
  speed: number;
  x: number;
  y: number;
}

const TRAIL_MS = 130;

function mk(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return { c, g: c.getContext('2d')! };
}

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export class FruitRenderer {
  private g: CanvasRenderingContext2D;
  private bg!: HTMLCanvasElement;
  private stain!: HTMLCanvasElement;
  private sg!: CanvasRenderingContext2D;
  private sprites = new Map<Kind, Sprite>();
  private drops: Drop[] = [];
  private rings: Ring[] = [];
  private misses: Miss[] = [];
  private trails: { x: number; y: number; t: number }[][] = [[], []];
  private flash = 0;
  private flashColor = '255,255,255';
  private fadeAcc = 0;
  private W = 1;
  private H = 1;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.W = innerWidth;
    this.H = innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.paintBackground();
    const st = mk(this.canvas.width, this.canvas.height);
    if (this.stain) st.g.drawImage(this.stain, 0, 0, st.c.width, st.c.height);
    this.stain = st.c;
    this.sg = st.g;
    this.sprites.clear();
  }

  /** Wooden dojo floor: vertical planks with grain, knots, seams and a warm vignette. */
  private paintBackground() {
    const W = this.canvas.width, H = this.canvas.height;
    const { c, g } = mk(W, H);
    const rnd = seeded(7);
    const plankW = Math.max(90, Math.min(W, H) * 0.2);
    const tones = ['#7a4a26', '#83522b', '#6f4221', '#8a5a30', '#744624'];
    for (let x = 0, i = 0; x < W; x += plankW, i++) {
      g.fillStyle = tones[i % tones.length];
      g.fillRect(x, 0, plankW + 1, H);
      // grain
      for (let k = 0; k < 26; k++) {
        const gx = x + rnd() * plankW;
        g.strokeStyle = `rgba(${rnd() < 0.5 ? '40,20,8' : '170,110,60'},${(0.06 + rnd() * 0.1).toFixed(3)})`;
        g.lineWidth = 1 + rnd() * 2.5 * this.dpr;
        g.beginPath();
        g.moveTo(gx, 0);
        for (let y = 0; y <= H; y += H / 12) g.lineTo(gx + Math.sin(y * 0.004 + k) * plankW * 0.05, y);
        g.stroke();
      }
      // knot
      if (rnd() < 0.7) {
        const kx = x + plankW * (0.25 + rnd() * 0.5), ky = rnd() * H, kr = plankW * (0.06 + rnd() * 0.06);
        const kg = g.createRadialGradient(kx, ky, 0, kx, ky, kr * 2.2);
        kg.addColorStop(0, 'rgba(40,18,6,0.7)');
        kg.addColorStop(0.4, 'rgba(60,30,12,0.35)');
        kg.addColorStop(1, 'rgba(60,30,12,0)');
        g.fillStyle = kg;
        g.beginPath();
        g.ellipse(kx, ky, kr * 1.4, kr * 2.4, 0, 0, Math.PI * 2);
        g.fill();
      }
      // seam
      g.fillStyle = 'rgba(25,12,4,0.65)';
      g.fillRect(x, 0, 2.5 * this.dpr, H);
      g.fillStyle = 'rgba(255,210,160,0.08)';
      g.fillRect(x + 2.5 * this.dpr, 0, 1.5 * this.dpr, H);
    }
    // warm light from the top and a vignette
    const light = g.createRadialGradient(W * 0.5, H * 0.25, 0, W * 0.5, H * 0.35, Math.max(W, H) * 0.75);
    light.addColorStop(0, 'rgba(255,200,130,0.22)');
    light.addColorStop(0.6, 'rgba(0,0,0,0.05)');
    light.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = light;
    g.fillRect(0, 0, W, H);
    this.bg = c;
  }

  // ------------------------------------------------------------------ sprites
  private sprite(kind: Kind, r: number): Sprite {
    const cached = this.sprites.get(kind);
    if (cached) return cached;
    const R = r * this.H * this.dpr;
    const size = R * 2.6;
    const whole = mk(size);
    const cut = mk(size);
    this.paintWhole(whole.g, kind, size / 2, size / 2, R);
    this.paintCut(cut.g, kind, size / 2, size / 2, R);
    const s = { whole: whole.c, cut: cut.c, size };
    this.sprites.set(kind, s);
    return s;
  }

  private ball(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, a: Art) {
    const grd = g.createRadialGradient(cx - rx * 0.35, cy - ry * 0.4, rx * 0.05, cx, cy, Math.max(rx, ry) * 1.05);
    grd.addColorStop(0, a.skin[0]);
    grd.addColorStop(0.45, a.skin[1]);
    grd.addColorStop(1, a.skin[2]);
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }

  private shine(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, alpha = 0.55) {
    const h = g.createRadialGradient(cx - R * 0.38, cy - R * 0.42, 0, cx - R * 0.38, cy - R * 0.42, R * 0.45);
    h.addColorStop(0, `rgba(255,255,255,${alpha})`);
    h.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = h;
    g.beginPath();
    g.arc(cx - R * 0.38, cy - R * 0.42, R * 0.45, 0, Math.PI * 2);
    g.fill();
  }

  private paintWhole(g: CanvasRenderingContext2D, kind: Kind, cx: number, cy: number, R: number) {
    const a = ART[kind];
    const rnd = seeded(kind.length * 977);
    if (a.glow) {
      const gl = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.3);
      gl.addColorStop(0, `rgba(${a.glow},0.55)`);
      gl.addColorStop(1, `rgba(${a.glow},0)`);
      g.fillStyle = gl;
      g.fillRect(0, 0, cx * 2, cy * 2);
    }
    // drop shadow
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.ellipse(cx + R * 0.08, cy + R * 0.12, R, R * 0.98, 0, 0, Math.PI * 2);
    g.fill();

    switch (kind) {
      case 'watermelon': {
        this.ball(g, cx, cy, R * 1.08, R * 0.92, a);
        g.save();
        g.beginPath();
        g.ellipse(cx, cy, R * 1.08, R * 0.92, 0, 0, Math.PI * 2);
        g.clip();
        g.strokeStyle = 'rgba(10,50,18,0.75)';
        g.lineWidth = R * 0.14;
        for (let i = -3; i <= 3; i++) {
          g.beginPath();
          for (let t = -1.2; t <= 1.2; t += 0.1) {
            const x = cx + i * R * 0.32 + Math.sin(t * 6 + i) * R * 0.05;
            const y = cy + t * R;
            t === -1.2 ? g.moveTo(x, y) : g.lineTo(x, y);
          }
          g.stroke();
        }
        g.restore();
        this.shine(g, cx, cy, R, 0.35);
        break;
      }
      case 'lemon': {
        this.ball(g, cx, cy, R * 1.12, R * 0.86, a);
        g.fillStyle = a.skin[1];
        g.beginPath();
        g.ellipse(cx + R * 1.1, cy, R * 0.16, R * 0.12, 0, 0, Math.PI * 2);
        g.ellipse(cx - R * 1.1, cy, R * 0.14, R * 0.1, 0, 0, Math.PI * 2);
        g.fill();
        this.dimples(g, cx, cy, R, 'rgba(160,120,0,0.25)', rnd);
        this.shine(g, cx, cy, R);
        break;
      }
      case 'apple':
      case 'double':
      case 'freeze': {
        this.ball(g, cx - R * 0.18, cy + R * 0.04, R * 0.82, R * 0.92, a);
        this.ball(g, cx + R * 0.18, cy + R * 0.04, R * 0.82, R * 0.92, a);
        g.strokeStyle = '#4a2a12';
        g.lineWidth = R * 0.1;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(cx, cy - R * 0.72);
        g.quadraticCurveTo(cx + R * 0.05, cy - R * 1.05, cx + R * 0.18, cy - R * 1.12);
        g.stroke();
        g.fillStyle = kind === 'freeze' ? '#c9f3ff' : '#47b13b';
        g.beginPath();
        g.ellipse(cx + R * 0.38, cy - R * 0.98, R * 0.28, R * 0.12, -0.5, 0, Math.PI * 2);
        g.fill();
        if (kind === 'freeze') {
          g.strokeStyle = 'rgba(255,255,255,0.8)';
          g.lineWidth = R * 0.05;
          for (let i = 0; i < 6; i++) {
            const ang = (i / 6) * Math.PI * 2;
            g.beginPath();
            g.moveTo(cx, cy + R * 0.05);
            g.lineTo(cx + Math.cos(ang) * R * 0.45, cy + R * 0.05 + Math.sin(ang) * R * 0.45);
            g.stroke();
          }
        }
        if (kind === 'double') {
          g.fillStyle = 'rgba(120,70,0,0.9)';
          g.font = `900 ${R * 0.7}px Manrope, system-ui, sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('×2', cx, cy + R * 0.1);
        }
        this.shine(g, cx, cy, R, 0.6);
        break;
      }
      case 'kiwi': {
        this.ball(g, cx, cy, R * 1.05, R * 0.9, a);
        g.strokeStyle = 'rgba(220,180,120,0.25)';
        g.lineWidth = Math.max(1, R * 0.02);
        for (let i = 0; i < 160; i++) {
          const ang = rnd() * Math.PI * 2, d = rnd() * R * 0.95;
          const x = cx + Math.cos(ang) * d * 1.05, y = cy + Math.sin(ang) * d * 0.9;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + (rnd() - 0.5) * R * 0.1, y + (rnd() - 0.5) * R * 0.1);
          g.stroke();
        }
        this.shine(g, cx, cy, R, 0.2);
        break;
      }
      case 'coconut': {
        this.ball(g, cx, cy, R, R, a);
        g.strokeStyle = 'rgba(30,15,5,0.4)';
        g.lineWidth = Math.max(1, R * 0.03);
        for (let i = 0; i < 90; i++) {
          const ang = rnd() * Math.PI * 2, d = rnd() * R * 0.95;
          const x = cx + Math.cos(ang) * d, y = cy + Math.sin(ang) * d;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + Math.cos(ang + 1.5) * R * 0.18, y + Math.sin(ang + 1.5) * R * 0.18);
          g.stroke();
        }
        g.fillStyle = '#20110a';
        for (const [ex, ey] of [[-0.22, -0.3], [0.22, -0.3], [0, -0.05]]) {
          g.beginPath();
          g.arc(cx + ex * R, cy + ey * R, R * 0.1, 0, Math.PI * 2);
          g.fill();
        }
        this.shine(g, cx, cy, R, 0.18);
        break;
      }
      case 'peach': {
        this.ball(g, cx, cy, R, R * 0.96, a);
        g.strokeStyle = 'rgba(150,40,40,0.35)';
        g.lineWidth = R * 0.06;
        g.beginPath();
        g.moveTo(cx + R * 0.1, cy - R * 0.9);
        g.quadraticCurveTo(cx - R * 0.35, cy, cx + R * 0.05, cy + R * 0.9);
        g.stroke();
        this.shine(g, cx, cy, R, 0.4);
        break;
      }
      case 'plum': {
        this.ball(g, cx, cy, R * 0.95, R, a);
        g.fillStyle = 'rgba(220,200,255,0.18)';
        g.beginPath();
        g.ellipse(cx + R * 0.1, cy + R * 0.1, R * 0.7, R * 0.75, 0, 0, Math.PI * 2);
        g.fill();
        this.shine(g, cx, cy, R, 0.5);
        break;
      }
      case 'frenzy': {
        this.ball(g, cx, cy, R * 0.95, R * 1.08, a);
        g.fillStyle = '#5fc44a';
        for (let i = 0; i < 9; i++) {
          const ang = (i / 9) * Math.PI * 2 + 0.2;
          const x = cx + Math.cos(ang) * R * 0.72, y = cy + Math.sin(ang) * R * 0.82;
          g.save();
          g.translate(x, y);
          g.rotate(ang + Math.PI / 2);
          g.beginPath();
          g.moveTo(-R * 0.14, 0);
          g.quadraticCurveTo(0, -R * 0.5, R * 0.14, 0);
          g.closePath();
          g.fill();
          g.restore();
        }
        this.shine(g, cx, cy, R, 0.5);
        break;
      }
      case 'bomb': {
        this.ball(g, cx, cy + R * 0.06, R * 0.95, R * 0.95, a);
        g.fillStyle = '#9a9aa8';
        g.fillRect(cx - R * 0.26, cy - R * 1.02, R * 0.52, R * 0.26);
        g.fillStyle = '#5e5e6a';
        g.fillRect(cx - R * 0.26, cy - R * 0.84, R * 0.52, R * 0.06);
        g.strokeStyle = '#c9a06a';
        g.lineWidth = R * 0.08;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(cx, cy - R * 1.02);
        g.quadraticCurveTo(cx + R * 0.15, cy - R * 1.35, cx + R * 0.42, cy - R * 1.22);
        g.stroke();
        // skull-ish warning mark
        g.fillStyle = 'rgba(255,70,50,0.9)';
        g.font = `900 ${R * 0.8}px Manrope, system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('✕', cx, cy + R * 0.1);
        this.shine(g, cx, cy, R, 0.45);
        break;
      }
      default: {
        // orange
        this.ball(g, cx, cy, R, R, a);
        this.dimples(g, cx, cy, R, 'rgba(150,60,0,0.25)', rnd);
        g.fillStyle = '#5a8f2a';
        g.beginPath();
        g.arc(cx + R * 0.05, cy - R * 0.92, R * 0.08, 0, Math.PI * 2);
        g.fill();
        this.shine(g, cx, cy, R);
      }
    }
  }

  private dimples(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, color: string, rnd: () => number) {
    g.fillStyle = color;
    for (let i = 0; i < 70; i++) {
      const ang = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R * 0.92;
      g.beginPath();
      g.arc(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, R * 0.025, 0, Math.PI * 2);
      g.fill();
    }
  }

  /** The cut face, seen head-on (a full disc; each half draws one side of it). */
  private paintCut(g: CanvasRenderingContext2D, kind: Kind, cx: number, cy: number, R: number) {
    const a = ART[kind];
    const rnd = seeded(kind.length * 131);
    const rx = kind === 'watermelon' || kind === 'lemon' ? R * 1.08 : R;
    const ry = kind === 'watermelon' ? R * 0.92 : kind === 'lemon' ? R * 0.86 : R;
    // skin edge
    g.fillStyle = a.skin[2];
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    const k = kind === 'watermelon' ? 0.8 : kind === 'coconut' ? 0.78 : 0.9;
    g.fillStyle = a.rind;
    g.beginPath();
    g.ellipse(cx, cy, rx * 0.95, ry * 0.95, 0, 0, Math.PI * 2);
    g.fill();
    const fl = g.createRadialGradient(cx, cy, 0, cx, cy, rx * k);
    fl.addColorStop(0, '#ffffff55');
    fl.addColorStop(0.25, a.flesh);
    fl.addColorStop(1, a.flesh);
    g.fillStyle = fl;
    g.beginPath();
    g.ellipse(cx, cy, rx * k, ry * k, 0, 0, Math.PI * 2);
    g.fill();

    switch (kind) {
      case 'watermelon':
      case 'frenzy':
        g.fillStyle = '#1a0a0a';
        for (let i = 0; i < (kind === 'frenzy' ? 60 : 16); i++) {
          const ang = rnd() * Math.PI * 2, d = (0.3 + rnd() * 0.5) * rx * k;
          g.beginPath();
          g.ellipse(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d * (ry / rx), R * (kind === 'frenzy' ? 0.025 : 0.05), R * 0.03, ang, 0, Math.PI * 2);
          g.fill();
        }
        break;
      case 'orange':
      case 'lemon':
        g.strokeStyle = a.rind;
        g.lineWidth = R * 0.05;
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * Math.PI * 2;
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(cx + Math.cos(ang) * rx * k, cy + Math.sin(ang) * ry * k);
          g.stroke();
        }
        break;
      case 'kiwi':
        g.fillStyle = '#f4ffe0';
        g.beginPath();
        g.ellipse(cx, cy, R * 0.25, R * 0.2, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#1b1208';
        for (let i = 0; i < 26; i++) {
          const ang = (i / 26) * Math.PI * 2;
          g.beginPath();
          g.ellipse(cx + Math.cos(ang) * R * 0.38, cy + Math.sin(ang) * R * 0.32, R * 0.035, R * 0.02, ang, 0, Math.PI * 2);
          g.fill();
        }
        break;
      case 'apple':
      case 'double':
      case 'freeze':
        g.fillStyle = '#4a2a12';
        for (let i = 0; i < 5; i++) {
          const ang = (i / 5) * Math.PI * 2 - Math.PI / 2;
          g.beginPath();
          g.ellipse(cx + Math.cos(ang) * R * 0.18, cy + Math.sin(ang) * R * 0.18, R * 0.06, R * 0.035, ang, 0, Math.PI * 2);
          g.fill();
        }
        break;
      case 'peach':
      case 'plum': {
        const pg = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.34);
        pg.addColorStop(0, '#7a3a14');
        pg.addColorStop(1, '#4a1f08');
        g.fillStyle = pg;
        g.beginPath();
        g.ellipse(cx, cy, R * 0.3, R * 0.36, 0, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case 'coconut':
        g.fillStyle = 'rgba(230,240,255,0.6)';
        g.beginPath();
        g.ellipse(cx, cy, rx * 0.55, ry * 0.55, 0, 0, Math.PI * 2);
        g.fill();
        break;
    }
    // wet sheen
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.ellipse(cx - rx * 0.25, cy - ry * 0.3, rx * 0.35, ry * 0.18, -0.4, 0, Math.PI * 2);
    g.fill();
  }

  // ------------------------------------------------------------------ effects
  splat(x: number, y: number, kind: Kind, angle: number) {
    const a = ART[kind];
    const px = x * this.W, py = y * this.H, R = 0.07 * this.H;
    const n = kind === 'watermelon' ? 26 : 16;
    for (let i = 0; i < n; i++) {
      const ang = angle + Math.PI / 2 + (Math.random() - 0.5) * 2.4 + (i % 2 ? Math.PI : 0);
      const v = (0.25 + Math.random() * 0.9) * this.H;
      this.drops.push({
        x: px,
        y: py,
        vx: Math.cos(ang) * v,
        vy: Math.sin(ang) * v - this.H * 0.2,
        r: (0.004 + Math.random() * 0.01) * this.H,
        life: 0.5 + Math.random() * 0.5,
        max: 1,
        color: a.juice,
      });
    }
    // the stain soaks into the floor
    const sg = this.sg, d = this.dpr;
    sg.save();
    sg.translate(px * d, py * d);
    sg.rotate(angle);
    // soft core, then streaks thrown along the cut and droplets around it
    const core = sg.createRadialGradient(0, 0, 0, 0, 0, R * 0.8 * d);
    core.addColorStop(0, `rgba(${a.juice},0.5)`);
    core.addColorStop(1, `rgba(${a.juice},0)`);
    sg.fillStyle = core;
    sg.beginPath();
    sg.ellipse(0, 0, R * 0.9 * d, R * 0.55 * d, 0, 0, Math.PI * 2);
    sg.fill();
    sg.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const side = i % 2 ? 1 : -1;
      const ang = side * Math.PI / 2 + (Math.random() - 0.5) * 1.4;
      const len = R * (0.6 + Math.random() * 0.9);
      sg.strokeStyle = `rgba(${a.juice},${(0.35 + Math.random() * 0.25).toFixed(2)})`;
      sg.lineWidth = (5 + Math.random() * 7) * d;
      sg.beginPath();
      sg.moveTo(Math.cos(ang) * R * 0.3 * d, Math.sin(ang) * R * 0.3 * d);
      sg.lineTo(Math.cos(ang) * len * d, Math.sin(ang) * len * d);
      sg.stroke();
      sg.fillStyle = sg.strokeStyle;
      sg.beginPath();
      sg.arc(Math.cos(ang) * len * d, Math.sin(ang) * len * d, (3 + Math.random() * 4) * d, 0, Math.PI * 2);
      sg.fill();
    }
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2, dist = R * (0.6 + Math.random() * 1.6);
      sg.fillStyle = `rgba(${a.juice},${(0.3 + Math.random() * 0.35).toFixed(2)})`;
      sg.beginPath();
      sg.arc(Math.cos(ang) * dist * d, Math.sin(ang) * dist * 0.7 * d, (1.5 + Math.random() * 5) * d, 0, Math.PI * 2);
      sg.fill();
    }
    sg.restore();
  }

  blast(x: number, y: number) {
    const px = x * this.W, py = y * this.H;
    this.flash = 1;
    this.flashColor = '255,240,220';
    this.rings.push({ x: px, y: py, t: 0, max: 0.7, color: '255,200,120', width: 0.03 });
    this.rings.push({ x: px, y: py, t: -0.08, max: 0.9, color: '255,90,40', width: 0.015 });
    for (let i = 0; i < 60; i++) {
      const ang = Math.random() * Math.PI * 2, v = (0.3 + Math.random() * 1.4) * this.H;
      this.drops.push({
        x: px,
        y: py,
        vx: Math.cos(ang) * v,
        vy: Math.sin(ang) * v,
        r: (0.004 + Math.random() * 0.012) * this.H,
        life: 0.4 + Math.random() * 0.6,
        max: 1,
        color: Math.random() < 0.5 ? '255,170,60' : '255,90,40',
      });
    }
    const sg = this.sg, d = this.dpr;
    const sc = sg.createRadialGradient(px * d, py * d, 0, px * d, py * d, this.H * 0.22 * d);
    sc.addColorStop(0, 'rgba(10,6,4,0.55)');
    sc.addColorStop(1, 'rgba(10,6,4,0)');
    sg.fillStyle = sc;
    sg.fillRect(0, 0, this.stain.width, this.stain.height);
  }

  pulse(color: string) {
    this.flash = 0.6;
    this.flashColor = color;
    this.rings.push({ x: this.W / 2, y: this.H / 2, t: 0, max: 0.8, color, width: 0.02 });
  }

  miss(x: number) {
    this.misses.push({ x: x * this.W, t: 0 });
  }

  // ------------------------------------------------------------------ frame
  draw(w: World, dt: number, blades: BladeVis[], now: number) {
    const g = this.g, d = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.bg, 0, 0);
    // stains slowly dry up
    this.fadeAcc += dt;
    if (this.fadeAcc > 0.12) {
      this.fadeAcc = 0;
      this.sg.globalCompositeOperation = 'destination-out';
      this.sg.fillStyle = 'rgba(0,0,0,0.035)';
      this.sg.fillRect(0, 0, this.stain.width, this.stain.height);
      this.sg.globalCompositeOperation = 'source-over';
    }
    g.drawImage(this.stain, 0, 0);
    g.setTransform(d, 0, 0, d, 0, 0);

    const aspect = this.W / this.H;
    for (const h of w.halves) this.drawHalf(h, aspect);
    for (const f of w.fruits) this.drawFruit(f, now);

    // droplets
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const p = this.drops[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.drops.splice(i, 1);
        continue;
      }
      p.vy += this.H * 1.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      g.fillStyle = `rgba(${p.color},${Math.min(1, p.life * 2).toFixed(2)})`;
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      g.fill();
    }

    // rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t >= r.max) {
        this.rings.splice(i, 1);
        continue;
      }
      if (r.t < 0) continue;
      const u = r.t / r.max;
      g.strokeStyle = `rgba(${r.color},${(1 - u).toFixed(2)})`;
      g.lineWidth = r.width * this.H * (1 - u);
      g.beginPath();
      g.arc(r.x, r.y, u * this.H * 0.6, 0, Math.PI * 2);
      g.stroke();
    }

    // missed-fruit markers at the bottom edge
    for (let i = this.misses.length - 1; i >= 0; i--) {
      const m = this.misses[i];
      m.t += dt;
      if (m.t > 1.2) {
        this.misses.splice(i, 1);
        continue;
      }
      const a = 1 - m.t / 1.2;
      const s = this.H * 0.04 * (1 + (1 - a) * 0.3);
      g.save();
      g.translate(Math.max(s, Math.min(this.W - s, m.x)), this.H - s * 1.4);
      g.strokeStyle = `rgba(255,60,60,${a.toFixed(2)})`;
      g.lineWidth = s * 0.28;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-s * 0.5, -s * 0.5);
      g.lineTo(s * 0.5, s * 0.5);
      g.moveTo(s * 0.5, -s * 0.5);
      g.lineTo(-s * 0.5, s * 0.5);
      g.stroke();
      g.restore();
    }

    this.drawBlades(blades, now);

    // power-up tints
    if (w.freezeT > 0) {
      const a = Math.min(1, w.freezeT) * 0.5;
      const v = g.createRadialGradient(this.W / 2, this.H / 2, this.H * 0.3, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.75);
      v.addColorStop(0, 'rgba(150,220,255,0)');
      v.addColorStop(1, `rgba(170,230,255,${a.toFixed(2)})`);
      g.fillStyle = v;
      g.fillRect(0, 0, this.W, this.H);
    }
    if (w.frenzyT > 0) {
      g.fillStyle = `rgba(255,80,190,${(0.06 + Math.sin(now / 90) * 0.03).toFixed(3)})`;
      g.fillRect(0, 0, this.W, this.H);
    }
    if (w.doubleT > 0) {
      g.strokeStyle = `rgba(255,205,60,${(0.35 + Math.sin(now / 160) * 0.15).toFixed(2)})`;
      g.lineWidth = 10;
      g.strokeRect(5, 5, this.W - 10, this.H - 10);
    }
    if (this.flash > 0) {
      g.fillStyle = `rgba(${this.flashColor},${(this.flash * 0.7).toFixed(2)})`;
      g.fillRect(0, 0, this.W, this.H);
      this.flash = Math.max(0, this.flash - dt * 2.2);
    }
  }

  private drawFruit(f: Fruit, now: number) {
    const s = this.sprite(f.kind, f.r);
    const g = this.g;
    const size = s.size / this.dpr;
    const px = f.x * this.W, py = f.y * this.H;
    g.save();
    g.translate(px, py);
    if (f.kind === 'bomb') {
      // pulsing danger glow
      const R = f.r * this.H;
      const pulse = 0.35 + Math.sin(now / 80) * 0.2;
      const gl = g.createRadialGradient(0, 0, R * 0.5, 0, 0, R * 1.9);
      gl.addColorStop(0, `rgba(255,50,30,${pulse.toFixed(2)})`);
      gl.addColorStop(1, 'rgba(255,50,30,0)');
      g.fillStyle = gl;
      g.beginPath();
      g.arc(0, 0, R * 1.9, 0, Math.PI * 2);
      g.fill();
    }
    g.rotate(f.kind === 'bomb' ? Math.sin(f.rot) * 0.3 : f.rot);
    g.drawImage(s.whole, -size / 2, -size / 2, size, size);
    if (f.kind === 'bomb') {
      // fuse spark at the fuse tip (sprite space)
      const R = f.r * this.H;
      const fx = R * 0.42, fy = -R * 1.22;
      const fl = 0.6 + Math.random() * 0.4;
      const sp = g.createRadialGradient(fx, fy, 0, fx, fy, R * 0.4 * fl);
      sp.addColorStop(0, 'rgba(255,255,220,1)');
      sp.addColorStop(0.3, 'rgba(255,200,60,0.9)');
      sp.addColorStop(1, 'rgba(255,80,0,0)');
      g.fillStyle = sp;
      g.beginPath();
      g.arc(fx, fy, R * 0.4 * fl, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  private drawHalf(h: Half, aspect: number) {
    const s = this.sprite(h.kind, h.r);
    const g = this.g;
    const size = s.size / this.dpr;
    const R = h.r * this.H;
    // the cut angle is in aspect-corrected space; in pixels it's the same angle because x is scaled by W = aspect * H
    void aspect;
    const a = Math.min(1, h.life / 0.5);
    g.save();
    g.globalAlpha = a;
    g.translate(h.x * this.W, h.y * this.H);
    g.rotate(h.angle + h.rot);
    // keep one side of the cut line
    g.beginPath();
    if (h.side === 0) g.rect(-size, 0, size * 2, size);
    else g.rect(-size, -size, size * 2, size);
    g.clip();
    // skin underneath, then the cut face tilted toward the viewer
    g.drawImage(s.whole, -size / 2, -size / 2, size, size);
    g.save();
    g.scale(1, 0.55);
    g.drawImage(s.cut, -size / 2, -size / 2, size, size);
    g.restore();
    // juicy edge on the cut
    g.strokeStyle = `rgba(${ART[h.kind].juice},0.9)`;
    g.lineWidth = Math.max(1.5, R * 0.06);
    g.beginPath();
    g.moveTo(-R * 0.95, 0);
    g.lineTo(R * 0.95, 0);
    g.stroke();
    g.restore();
  }

  private drawBlades(blades: BladeVis[], now: number) {
    const g = this.g;
    const colors = ['120,220,255', '255,140,220'];
    blades.forEach((b, i) => {
      const tr = this.trails[i];
      if (b.active) {
        const px = b.x * this.W, py = b.y * this.H;
        const last = tr[tr.length - 1];
        if (!last || Math.hypot(px - last.x, py - last.y) > 0.5) tr.push({ x: px, y: py, t: now });
        else last.t = now;
      }
      while (tr.length && now - tr[0].t > TRAIL_MS) tr.shift();
      if (tr.length > 24) tr.splice(0, tr.length - 24);
      if (tr.length < 2) return;
      const n = tr.length;
      const width = this.H * 0.016;
      const left: [number, number][] = [], right: [number, number][] = [];
      for (let k = 0; k < n; k++) {
        const p = tr[k], q = tr[Math.min(n - 1, k + 1)], o = tr[Math.max(0, k - 1)];
        let dx = q.x - o.x, dy = q.y - o.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        const u = k / (n - 1);
        const wdt = width * Math.sin(u * Math.PI * 0.5 + 0.05);
        left.push([p.x - dy * wdt, p.y + dx * wdt]);
        right.push([p.x + dy * wdt, p.y - dx * wdt]);
      }
      const path = () => {
        g.beginPath();
        g.moveTo(left[0][0], left[0][1]);
        for (const [x, y] of left) g.lineTo(x, y);
        const head = tr[n - 1];
        g.lineTo(head.x, head.y);
        for (let k = n - 1; k >= 0; k--) g.lineTo(right[k][0], right[k][1]);
        g.closePath();
      };
      g.save();
      g.shadowColor = `rgba(${colors[i]},0.95)`;
      g.shadowBlur = this.H * 0.03;
      g.fillStyle = `rgba(${colors[i]},0.75)`;
      path();
      g.fill();
      g.restore();
      g.save();
      g.translate(0, 0);
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const p = tr[k];
        const u = k / (n - 1);
        const r = width * 0.35 * u;
        g.moveTo(p.x + r, p.y);
        g.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
      g.fill();
      g.restore();
    });
  }

  clearTrails() {
    this.trails = [[], []];
  }

  dispose() {
    this.sprites.clear();
    this.drops = [];
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
