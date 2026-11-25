/**
 * A tapering, glowing blade ribbon for Three.js: a triangle strip rebuilt in place each frame (no allocations).
 * WebGL ignores `linewidth`, so a real mesh is the only way to get a thick, smooth trail.
 */
import * as THREE from 'three';

const MAX = 32;

export class Ribbon {
  readonly mesh: THREE.Mesh;
  private pts: { x: number; y: number; t: number }[] = [];
  private pos = new Float32Array(MAX * 2 * 3);
  private col = new Float32Array(MAX * 2 * 3);
  private geo = new THREE.BufferGeometry();
  private color: THREE.Color;

  constructor(color: number, private width: number, private lifeMs = 140, private z = 0.08) {
    this.color = new THREE.Color(color);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    this.geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  setWidth(w: number) {
    this.width = w;
  }

  push(x: number, y: number, now: number) {
    const last = this.pts[this.pts.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < 1e-4) {
      last.t = now;
    } else {
      this.pts.push({ x, y, t: now });
    }
    if (this.pts.length > MAX) this.pts.shift();
  }

  clear() {
    this.pts.length = 0;
  }

  /** Drops old points and rebuilds the strip. `boost` (0..1) brightens and widens it, e.g. with blade speed. */
  update(now: number, boost = 1) {
    while (this.pts.length && now - this.pts[0].t > this.lifeMs) this.pts.shift();
    const n = this.pts.length;
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      const q = this.pts[Math.min(n - 1, i + 1)];
      const o = this.pts[Math.max(0, i - 1)];
      let dx = q.x - o.x, dy = q.y - o.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const u = i / (n - 1); // 0 tail … 1 head
      const w = this.width * (0.15 + 0.85 * u) * (0.6 + 0.4 * boost);
      const nx = -dy * w, ny = dx * w;
      const k = i * 6;
      this.pos[k] = p.x + nx;
      this.pos[k + 1] = p.y + ny;
      this.pos[k + 2] = this.z;
      this.pos[k + 3] = p.x - nx;
      this.pos[k + 4] = p.y - ny;
      this.pos[k + 5] = this.z;
      const a = u * u * (0.5 + 0.5 * boost);
      // core whitens toward the head
      const r = this.color.r + (1 - this.color.r) * u * 0.6, g = this.color.g + (1 - this.color.g) * u * 0.6, b = this.color.b + (1 - this.color.b) * u * 0.6;
      this.col[k] = this.col[k + 3] = r * a;
      this.col[k + 1] = this.col[k + 4] = g * a;
      this.col[k + 2] = this.col[k + 5] = b * a;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Frees every geometry, material and texture under an object. */
export function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
}

/** Soft radial glow sprite texture (additive halos without post-processing). */
export function glowTexture(color = '255,255,255', size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let k = 0; k <= 16; k++) {
    const u = k / 16;
    const a = Math.exp(-u * u * 45) * 0.9 + Math.pow(1 - u, 2.5) * 0.35;
    grd.addColorStop(u, `rgba(${color},${a.toFixed(3)})`);
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Spark {
  s: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  drag: number;
}

/** Pooled additive spark particles: no per-burst texture or material creation. */
export class Sparks {
  readonly group = new THREE.Group();
  private pool: Spark[] = [];
  private live: Spark[] = [];
  private tex = new Map<string, THREE.Texture>();

  constructor(private maxCount = 600, private additive = true) {}

  private texFor(color: string) {
    let t = this.tex.get(color);
    if (!t) {
      t = glowTexture(color, 64);
      this.tex.set(color, t);
    }
    return t;
  }

  /** Falling particles (feathers, debris) when `fall` > 0, in world units / s². */
  fall = 0;

  burst(x: number, y: number, z: number, color: string, count: number, speed: number, size: number, life = 0.6, gravity3d = false) {
    for (let i = 0; i < count; i++) {
      if (this.live.length >= this.maxCount) {
        const old = this.live.shift()!;
        old.s.visible = false;
        this.pool.push(old);
      }
      let sp = this.pool.pop();
      if (!sp) {
        const mat = new THREE.SpriteMaterial({ transparent: true, blending: this.additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false });
        sp = { s: new THREE.Sprite(mat), vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, drag: 1 };
        this.group.add(sp.s);
      }
      const mat = sp.s.material as THREE.SpriteMaterial;
      const tex = this.texFor(color);
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      const a = Math.random() * Math.PI * 2;
      const e = gravity3d ? (Math.random() * 2 - 1) : 0;
      const v = speed * (0.25 + Math.random() * 0.9);
      sp.vx = Math.cos(a) * v * Math.sqrt(1 - e * e);
      sp.vy = Math.sin(a) * v * Math.sqrt(1 - e * e);
      sp.vz = gravity3d ? e * v : (Math.random() - 0.5) * v * 0.3;
      sp.s.position.set(x, y, z);
      sp.size = size * (0.5 + Math.random());
      sp.s.scale.setScalar(sp.size);
      sp.max = sp.life = life * (0.6 + Math.random() * 0.6);
      sp.drag = 2.2;
      sp.s.visible = true;
      mat.opacity = 1;
      this.live.push(sp);
    }
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const sp = this.live[i];
      sp.life -= dt;
      if (sp.life <= 0) {
        sp.s.visible = false;
        this.live.splice(i, 1);
        this.pool.push(sp);
        continue;
      }
      const k = Math.exp(-sp.drag * dt);
      sp.vx *= k;
      sp.vy *= k;
      sp.vz *= k;
      sp.vy -= this.fall * dt;
      sp.s.position.x += sp.vx * dt;
      sp.s.position.y += sp.vy * dt;
      sp.s.position.z += sp.vz * dt;
      const u = sp.life / sp.max;
      (sp.s.material as THREE.SpriteMaterial).opacity = u;
      sp.s.scale.setScalar(sp.size * (0.4 + 0.6 * u));
    }
  }

  dispose() {
    disposeTree(this.group);
    for (const t of this.tex.values()) t.dispose();
  }
}
