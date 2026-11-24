/**
 * Three.js scene for Starfall Blade: Celestial Slicer.
 * 3D cosmic crystals, dynamic plasma blade ribbon trails, split crystal physics,
 * particle spark bursts, and glowing celestial backdrops.
 * High performance at DPR 2 with no expensive post-processing bloom.
 */
import * as THREE from 'three';
import type { Target, SplitHalf, World } from './rules';

const FOV = 50;
const CAM_Z = 10;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

/** Radial halo texture for additive glow without heavy post-processing */
function glowTexture(color = '255,255,255'): THREE.Texture {
  const S = 128;
  const { c, g } = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (let k = 0; k <= 16; k++) {
    const u = k / 16;
    const alpha = (Math.exp(-u * u * 45) * 0.9 + Math.pow(1 - u, 2.5) * 0.35).toFixed(3);
    grd.addColorStop(u, `rgba(${color},${alpha})`);
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Sci-fi targeting ring texture */
function ringTexture(): THREE.Texture {
  const S = 256;
  const { c, g } = canvas(S, S);
  g.strokeStyle = 'rgba(160, 230, 255, 0.9)';
  g.lineWidth = 6;
  g.shadowColor = 'rgba(80, 200, 255, 0.9)';
  g.shadowBlur = 14;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.38, 0, Math.PI * 2);
  g.stroke();

  // Corner notches
  for (let a = 0; a < 4; a++) {
    const ang = (a * Math.PI) / 2;
    g.beginPath();
    g.arc(
      S / 2 + Math.cos(ang) * (S * 0.38),
      S / 2 + Math.sin(ang) * (S * 0.38),
      S * 0.04,
      0,
      Math.PI * 2
    );
    g.fillStyle = '#ffffff';
    g.fill();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Deep space nebula and stardust backdrop */
function paintCosmicBackdrop(aspect: number): THREE.Texture {
  const H = 1024;
  const W = Math.round(H * aspect);
  const { c, g } = canvas(W, H);

  // Deep twilight void gradient
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#090814');
  bg.addColorStop(0.5, '#120f29');
  bg.addColorStop(0.85, '#1e1438');
  bg.addColorStop(1, '#0d0a1c');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // Soft nebula glow clouds
  const nebulae = [
    { x: W * 0.35, y: H * 0.45, r: H * 0.55, col: 'rgba(80, 45, 140, 0.32)' },
    { x: W * 0.72, y: H * 0.60, r: H * 0.45, col: 'rgba(30, 110, 180, 0.28)' },
    { x: W * 0.50, y: H * 0.20, r: H * 0.35, col: 'rgba(160, 50, 120, 0.22)' },
  ];
  for (const n of nebulae) {
    const grd = g.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
    grd.addColorStop(0, n.col);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  }

  // Stardust stars
  let s = 42;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 400; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const rad = rand() * 1.5 + 0.5;
    const alpha = (0.2 + rand() * 0.7).toFixed(2);
    g.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }

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
  maxLife: number;
}

interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

export class Scene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);

  private backdropMesh: THREE.Mesh;
  private glowCyan = glowTexture('90,225,255');
  private glowGold = glowTexture('255,215,80');
  private glowMagenta = glowTexture('240,90,220');
  private glowStar = glowTexture('255,255,255');
  private glowVoid = glowTexture('240,40,70');

  private targetMeshes = new Map<number, THREE.Group>();
  private halfMeshes = new Map<number, THREE.Group>();
  private sparks: Spark[] = [];

  // Hands & Blade trails
  private handRings: THREE.Sprite[] = [];
  private ringTex = ringTexture();
  private bladeTrails = new Map<number, TrailPoint[]>();
  private trailLines = new Map<number, THREE.Line>();

  private shockwaveSprite: THREE.Sprite;
  private voidOverlay: THREE.Mesh;

  private viewW = 1;
  private viewH = 1;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(container.clientWidth || innerWidth, container.clientHeight || innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera.position.z = CAM_Z;

    // Cosmic backdrop plane
    const bgGeo = new THREE.PlaneGeometry(1, 1);
    const bgMat = new THREE.MeshBasicMaterial({ depthWrite: false });
    this.backdropMesh = new THREE.Mesh(bgGeo, bgMat);
    this.backdropMesh.position.z = -1;
    this.scene.add(this.backdropMesh);

    // Void flash overlay for red damage warning
    const ovGeo = new THREE.PlaneGeometry(1, 1);
    const ovMat = new THREE.MeshBasicMaterial({
      color: 0xff1133,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.voidOverlay = new THREE.Mesh(ovGeo, ovMat);
    this.voidOverlay.position.z = 0.5;
    this.scene.add(this.voidOverlay);

    // Shockwave ring sprite
    const shockMat = new THREE.SpriteMaterial({
      map: this.glowCyan,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.shockwaveSprite = new THREE.Sprite(shockMat);
    this.shockwaveSprite.position.z = 0.2;
    this.scene.add(this.shockwaveSprite);

    // Hand cursor rings
    for (let i = 0; i < 2; i++) {
      const ringMat = new THREE.SpriteMaterial({
        map: this.ringTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const r = new THREE.Sprite(ringMat);
      r.scale.set(1.2, 1.2, 1);
      this.handRings.push(r);
      this.scene.add(r);
    }

    this.resize();
    this.renderer.compile(this.scene, this.camera);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    if (w < 2 || h < 2) return;

    this.renderer.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    // Visible world dimensions at z = 0
    this.viewH = 2 * Math.tan((FOV * Math.PI) / 360) * CAM_Z;
    this.viewW = this.viewH * aspect;

    // Fit backdrop and overlay plane
    this.backdropMesh.scale.set(this.viewW * 1.05, this.viewH * 1.05, 1);
    this.voidOverlay.scale.set(this.viewW * 1.05, this.viewH * 1.05, 1);

    (this.backdropMesh.material as THREE.MeshBasicMaterial).map = paintCosmicBackdrop(aspect);
    (this.backdropMesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - 0.5) * this.viewW,
      y: -(sy - 0.5) * this.viewH,
    };
  }

  private createTargetMesh(t: Target): THREE.Group {
    const group = new THREE.Group();

    let geo: THREE.BufferGeometry;
    let color: number;
    let haloTex: THREE.Texture;
    let size = t.r * this.viewH * 2.2;

    switch (t.kind) {
      case 'gold':
        geo = new THREE.OctahedronGeometry(size * 0.5, 0);
        color = 0xffc83b;
        haloTex = this.glowGold;
        break;
      case 'prism':
        geo = new THREE.DodecahedronGeometry(size * 0.45, 0);
        color = 0xd946ef;
        haloTex = this.glowMagenta;
        break;
      case 'star':
        geo = new THREE.IcosahedronGeometry(size * 0.55, 1);
        color = 0xffffff;
        haloTex = this.glowStar;
        break;
      case 'void':
        geo = new THREE.SphereGeometry(size * 0.45, 16, 16);
        color = 0x240b15;
        haloTex = this.glowVoid;
        break;
      default:
        geo = new THREE.IcosahedronGeometry(size * 0.48, 0);
        color = 0x38bdf8;
        haloTex = this.glowCyan;
    }

    // Core 3D crystal
    const mat = new THREE.MeshBasicMaterial({
      color,
      wireframe: t.kind === 'void',
    });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    // Glowing halo sprite
    const haloMat = new THREE.SpriteMaterial({
      map: haloTex,
      transparent: true,
      opacity: t.kind === 'void' ? 0.75 : 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(size * 2.4, size * 2.4, 1);
    group.add(halo);

    return group;
  }

  private createHalfMesh(h: SplitHalf): THREE.Group {
    const group = new THREE.Group();
    const size = 0.035 * this.viewH * 1.8;
    const geo = new THREE.TetrahedronGeometry(size * 0.45, 0);
    const color =
      h.kind === 'gold'
        ? 0xffc83b
        : h.kind === 'prism'
        ? 0xd946ef
        : h.kind === 'star'
        ? 0xffffff
        : 0x38bdf8;

    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    group.add(mesh);
    return group;
  }

  addSparks(sx: number, sy: number, color = '90,225,255', count = 12) {
    const w = this.toWorld(sx, sy);
    const tex = glowTexture(color);

    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = (0.5 + Math.random() * 2.5) * (this.viewH * 0.2);
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.position.set(w.x, w.y, 0.05);
      const sz = (0.008 + Math.random() * 0.015) * this.viewH;
      s.scale.set(sz, sz, 1);
      this.scene.add(s);

      this.sparks.push({
        s,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        vz: (Math.random() - 0.5) * speed * 0.5,
        life: 0.45 + Math.random() * 0.25,
        maxLife: 0.7,
      });
    }
  }

  update(
    w: World,
    dt: number,
    hands: { x: number; y: number; pinch: number; active: boolean }[]
  ) {
    if (innerWidth < 2 || innerHeight < 2) return;

    // Void flash overlay
    const ovMat = this.voidOverlay.material as THREE.MeshBasicMaterial;
    ovMat.opacity = Math.min(0.45, w.voidFlash * 0.9);

    // Shockwave ripple
    if (w.shockwaveActive > 0) {
      const p = 1 - w.shockwaveActive / 0.6;
      const sz = p * this.viewH * 2.5;
      this.shockwaveSprite.scale.set(sz, sz, 1);
      (this.shockwaveSprite.material as THREE.SpriteMaterial).opacity = (1 - p) * 0.9;
    } else {
      (this.shockwaveSprite.material as THREE.SpriteMaterial).opacity = 0;
    }

    // Hand targeting rings and dynamic trails
    for (let i = 0; i < 2; i++) {
      const ring = this.handRings[i];
      const h = hands[i];

      if (h && h.active) {
        const wp = this.toWorld(h.x, h.y);
        ring.position.set(wp.x, wp.y, 0.1);
        (ring.material as THREE.SpriteMaterial).opacity = 0.85;

        // Pinch charge scales ring
        const targetScale = (0.08 - h.pinch * 0.035) * this.viewH;
        ring.scale.set(targetScale, targetScale, 1);

        // Update trail points
        let trail = this.bladeTrails.get(i);
        if (!trail) {
          trail = [];
          this.bladeTrails.set(i, trail);
        }
        trail.push({ x: wp.x, y: wp.y, t: performance.now() });

        // Keep last 10 points within 120ms
        const now = performance.now();
        while (trail.length > 12 || (trail.length > 2 && now - trail[0].t > 150)) {
          trail.shift();
        }

        // Render ribbon line
        let line = this.trailLines.get(i);
        if (!line) {
          const lGeo = new THREE.BufferGeometry();
          const lMat = new THREE.LineBasicMaterial({
            color: i === 0 ? 0x67e8f9 : 0xf472b6,
            linewidth: 3,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          line = new THREE.Line(lGeo, lMat);
          this.trailLines.set(i, line);
          this.scene.add(line);
        }

        const pts = trail.map((p) => new THREE.Vector3(p.x, p.y, 0.08));
        line.geometry.setFromPoints(pts);
        line.visible = true;
      } else {
        (ring.material as THREE.SpriteMaterial).opacity = 0;
        const line = this.trailLines.get(i);
        if (line) line.visible = false;
        this.bladeTrails.delete(i);
      }
    }

    // Update targets
    const currentTargetIds = new Set(w.targets.map((t) => t.id));
    for (const [id, mesh] of this.targetMeshes) {
      if (!currentTargetIds.has(id)) {
        this.scene.remove(mesh);
        this.targetMeshes.delete(id);
      }
    }

    for (const t of w.targets) {
      let mesh = this.targetMeshes.get(t.id);
      if (!mesh) {
        mesh = this.createTargetMesh(t);
        this.targetMeshes.set(t.id, mesh);
        this.scene.add(mesh);
      }
      const wp = this.toWorld(t.x, t.y);
      mesh.position.set(wp.x, wp.y, 0);
      mesh.rotation.z = t.rotation;
      mesh.rotation.y += t.vRot * dt * 0.7;
    }

    // Update split halves
    const currentHalfIds = new Set(w.halves.map((h) => h.id));
    for (const [id, mesh] of this.halfMeshes) {
      if (!currentHalfIds.has(id)) {
        this.scene.remove(mesh);
        this.halfMeshes.delete(id);
      }
    }

    for (const h of w.halves) {
      let mesh = this.halfMeshes.get(h.id);
      if (!mesh) {
        mesh = this.createHalfMesh(h);
        this.halfMeshes.set(h.id, mesh);
        this.scene.add(mesh);
      }
      const wp = this.toWorld(h.x, h.y);
      mesh.position.set(wp.x, wp.y, 0);
      mesh.rotation.z = h.rot;
      const alpha = Math.max(0, h.life / h.maxLife);
      mesh.scale.set(alpha, alpha, alpha);
    }

    // Update sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.life -= dt;
      if (sp.life <= 0) {
        this.scene.remove(sp.s);
        this.sparks.splice(i, 1);
        continue;
      }
      sp.s.position.x += sp.vx * dt;
      sp.s.position.y += sp.vy * dt;
      sp.s.position.z += sp.vz * dt;
      const alpha = Math.max(0, sp.life / sp.maxLife);
      (sp.s.material as THREE.SpriteMaterial).opacity = alpha;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
