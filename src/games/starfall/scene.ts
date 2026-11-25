/**
 * Three.js scene for Starfall Blade.
 * Lit, faceted crystals with additive halos; sliced crystals split into two real halves (clipping planes);
 * glowing ribbon blade trails; pooled sparks; parallax star layers; shockwave ring and void flash.
 * Everything it creates is freed in dispose(), and nothing is allocated per frame in the hot path.
 */
import * as THREE from 'three';
import type { Target, SplitHalf, World, TargetKind } from './rules';
import { Ribbon, Sparks, glowTexture, disposeTree } from '../../core/ribbon';

const FOV = 50;
const CAM_Z = 10;

type Kind = Exclude<TargetKind, 'void'>;

const STYLE: Record<TargetKind, { color: number; emissive: number; glow: string; spark: string }> = {
  crystal: { color: 0x5fd4ff, emissive: 0x0b6fa8, glow: '90,225,255', spark: '120,230,255' },
  prism: { color: 0xe879f9, emissive: 0x8a1f9e, glow: '240,90,220', spark: '245,140,240' },
  gold: { color: 0xffd35c, emissive: 0xa86a00, glow: '255,215,80', spark: '255,225,120' },
  star: { color: 0xffffff, emissive: 0x9aa8ff, glow: '255,255,255', spark: '255,255,255' },
  void: { color: 0x14060c, emissive: 0x000000, glow: '240,40,70', spark: '255,60,90' },
};

function paintBackdrop(aspect: number): THREE.CanvasTexture {
  const H = 1024;
  const W = Math.round(H * Math.min(3, Math.max(0.4, aspect)));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#05040d');
  bg.addColorStop(0.45, '#100c26');
  bg.addColorStop(0.85, '#1f1440');
  bg.addColorStop(1, '#0b0819');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const neb = [
    { x: 0.3, y: 0.42, r: 0.6, c: 'rgba(90,50,160,0.34)' },
    { x: 0.75, y: 0.62, r: 0.5, c: 'rgba(30,120,200,0.26)' },
    { x: 0.52, y: 0.18, r: 0.38, c: 'rgba(170,50,130,0.22)' },
    { x: 0.1, y: 0.85, r: 0.35, c: 'rgba(40,160,180,0.14)' },
  ];
  for (const n of neb) {
    const grd = g.createRadialGradient(n.x * W, n.y * H, 0, n.x * W, n.y * H, n.r * H);
    grd.addColorStop(0, n.c);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  }
  // faint galactic band
  g.save();
  g.translate(W / 2, H / 2);
  g.rotate(-0.35);
  const band = g.createLinearGradient(0, -H * 0.18, 0, H * 0.18);
  band.addColorStop(0, 'rgba(255,255,255,0)');
  band.addColorStop(0.5, 'rgba(200,190,255,0.07)');
  band.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = band;
  g.fillRect(-W, -H * 0.18, W * 2, H * 0.36);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function starLayer(count: number, size: number, opacity: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 30;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 14;
    pos[i * 3 + 2] = -0.5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size,
    sizeAttenuation: false,
    color: 0xffffff,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

interface HalfVis {
  group: THREE.Group;
  mat: THREE.MeshStandardMaterial;
  plane: THREE.Plane;
  n0: THREE.Vector2;
  rot0: number;
}

export interface HandVis {
  x: number;
  y: number;
  pinch: number;
  charge: number;
  active: boolean;
  speed: number;
}

export class StarfallScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  readonly sparks = new Sparks(700);

  private backdrop: THREE.Mesh;
  private stars: THREE.Points[] = [];
  private geos: Record<TargetKind, THREE.BufferGeometry>;
  private mats: Record<TargetKind, THREE.MeshStandardMaterial>;
  private halos: Record<TargetKind, THREE.SpriteMaterial>;
  private voidShell: THREE.BufferGeometry;
  private voidShellMat: THREE.MeshBasicMaterial;
  private targets = new Map<number, THREE.Group>();
  private halves = new Map<number, HalfVis>();
  private rings: THREE.Sprite[] = [];
  private chargeRings: THREE.Mesh[] = [];
  private ribbons: Ribbon[] = [];
  private shock: THREE.Mesh;
  private flash: THREE.Mesh;
  private keyLight: THREE.PointLight;
  private viewW = 1;
  private viewH = 1;

  constructor(private gl: THREE.WebGLRenderer) {
    this.camera.position.z = CAM_Z;

    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ depthWrite: false }));
    this.backdrop.position.z = -2;
    this.scene.add(this.backdrop);

    this.stars = [starLayer(260, 1.5, 0.55), starLayer(120, 2.5, 0.8)];
    for (const s of this.stars) this.scene.add(s);

    // lighting: cool sky fill, warm key, and a light that follows the blade
    this.scene.add(new THREE.HemisphereLight(0xa8c8ff, 0x2a1040, 1.4));
    const dir = new THREE.DirectionalLight(0xffffff, 2.2);
    dir.position.set(3, 5, 8);
    this.scene.add(dir);
    const rim = new THREE.DirectionalLight(0xd070ff, 1.4);
    rim.position.set(-6, -2, 3);
    this.scene.add(rim);
    this.keyLight = new THREE.PointLight(0x88e0ff, 0, 6, 1.5);
    this.keyLight.position.z = 1.5;
    this.scene.add(this.keyLight);

    this.geos = {
      crystal: new THREE.IcosahedronGeometry(1, 0),
      prism: new THREE.DodecahedronGeometry(1, 0),
      gold: new THREE.OctahedronGeometry(1, 0),
      star: new THREE.IcosahedronGeometry(1, 1),
      void: new THREE.SphereGeometry(1, 24, 16),
    };
    // stretch gold into a long gem
    this.geos.gold.scale(0.8, 1.35, 0.8);

    const mk = (k: TargetKind) =>
      new THREE.MeshStandardMaterial({
        color: STYLE[k].color,
        emissive: STYLE[k].emissive,
        emissiveIntensity: k === 'star' ? 0.9 : 0.55,
        roughness: k === 'void' ? 0.9 : 0.18,
        metalness: k === 'gold' ? 0.55 : 0.1,
        flatShading: true,
      });
    this.mats = { crystal: mk('crystal'), prism: mk('prism'), gold: mk('gold'), star: mk('star'), void: mk('void') };
    const haloTex = (k: TargetKind) => glowTexture(STYLE[k].glow);
    this.halos = {} as Record<TargetKind, THREE.SpriteMaterial>;
    for (const k of Object.keys(STYLE) as TargetKind[]) {
      this.halos[k] = new THREE.SpriteMaterial({
        map: haloTex(k),
        transparent: true,
        opacity: k === 'void' ? 0.8 : 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    }
    this.voidShell = new THREE.IcosahedronGeometry(1.25, 1);
    this.voidShellMat = new THREE.MeshBasicMaterial({ color: 0xff2a55, wireframe: true, transparent: true, opacity: 0.75 });

    this.scene.add(this.sparks.group);

    // shockwave ring
    this.shock = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 96),
      new THREE.MeshBasicMaterial({ color: 0x9ae6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.shock.position.z = 0.3;
    this.scene.add(this.shock);

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xff1133, transparent: true, opacity: 0, depthWrite: false })
    );
    this.flash.position.z = 1;
    this.flash.renderOrder = 20;
    this.scene.add(this.flash);

    const ringTex = this.ringTexture();
    const colors = [0x67e8f9, 0xf472b6];
    for (let i = 0; i < 2; i++) {
      const r = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, transparent: true, opacity: 0, depthWrite: false }));
      r.renderOrder = 11;
      this.rings.push(r);
      this.scene.add(r);
      const cr = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1, 48, 1, Math.PI / 2, Math.PI * 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      cr.renderOrder = 12;
      cr.visible = false;
      this.chargeRings.push(cr);
      this.scene.add(cr);
      const rb = new Ribbon(colors[i], 0.12);
      this.ribbons.push(rb);
      this.scene.add(rb.mesh);
    }

    this.resize();
  }

  private ringTexture(): THREE.CanvasTexture {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.strokeStyle = 'rgba(170,235,255,0.95)';
    g.lineWidth = 7;
    g.shadowColor = 'rgba(80,200,255,0.9)';
    g.shadowBlur = 16;
    g.beginPath();
    g.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#fff';
    for (let a = 0; a < 4; a++) {
      const ang = (a * Math.PI) / 2 + Math.PI / 4;
      g.beginPath();
      g.arc(S / 2 + Math.cos(ang) * S * 0.36, S / 2 + Math.sin(ang) * S * 0.36, S * 0.035, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath();
    g.arc(S / 2, S / 2, S * 0.04, 0, Math.PI * 2);
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    if (w < 2 || h < 2) return;
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.viewH = 2 * Math.tan((FOV * Math.PI) / 360) * CAM_Z;
    this.viewW = this.viewH * aspect;
    const bd = this.backdrop.material as THREE.MeshBasicMaterial;
    bd.map?.dispose();
    bd.map = paintBackdrop(aspect);
    bd.needsUpdate = true;
    // backdrop sits behind z=0, so it must be scaled up to fill the frustum there
    const k = (CAM_Z + 2) / CAM_Z;
    this.backdrop.scale.set(this.viewW * k * 1.06, this.viewH * k * 1.06, 1);
    this.flash.scale.set(this.viewW * 1.2, this.viewH * 1.2, 1);
    for (const rb of this.ribbons) rb.setWidth(this.viewH * 0.012);
  }

  toWorld(sx: number, sy: number) {
    return { x: (sx - 0.5) * this.viewW, y: -(sy - 0.5) * this.viewH };
  }

  burst(sx: number, sy: number, kind: TargetKind, big = false) {
    const p = this.toWorld(sx, sy);
    const st = STYLE[kind];
    this.sparks.burst(p.x, p.y, 0.1, st.spark, big ? 40 : 18, this.viewH * (big ? 0.9 : 0.6), this.viewH * 0.022, 0.65);
    this.sparks.burst(p.x, p.y, 0.12, '255,255,255', big ? 12 : 5, this.viewH * 0.3, this.viewH * 0.04, 0.3);
  }

  nova(sx: number, sy: number) {
    const p = this.toWorld(sx, sy);
    this.sparks.burst(p.x, p.y, 0.15, '255,255,255', 36, this.viewH * 1.1, this.viewH * 0.02, 0.5);
    this.sparks.burst(p.x, p.y, 0.15, '160,220,255', 20, this.viewH * 0.6, this.viewH * 0.05, 0.4);
  }

  private targetGroup(t: Target): THREE.Group {
    const g = new THREE.Group();
    const size = t.r * this.viewH * 1.15;
    const mesh = new THREE.Mesh(this.geos[t.kind], this.mats[t.kind]);
    mesh.scale.setScalar(size);
    mesh.name = 'core';
    g.add(mesh);
    if (t.kind === 'void') {
      const shell = new THREE.Mesh(this.voidShell, this.voidShellMat);
      shell.scale.setScalar(size);
      shell.name = 'shell';
      g.add(shell);
    }
    const halo = new THREE.Sprite(this.halos[t.kind]);
    halo.scale.setScalar(size * (t.kind === 'star' ? 6 : 4.6));
    halo.position.z = -0.2;
    g.add(halo);
    return g;
  }

  private halfVis(h: SplitHalf): HalfVis {
    const group = new THREE.Group();
    const mat = this.mats[h.kind].clone();
    mat.side = THREE.DoubleSide;
    mat.transparent = true;
    const plane = new THREE.Plane();
    mat.clippingPlanes = [plane];
    const mesh = new THREE.Mesh(this.geos[h.kind], mat);
    mesh.scale.setScalar(h.r * this.viewH * 1.15);
    mesh.rotation.y = h.id * 0.7;
    group.add(mesh);
    // slice angle is measured in aspect-corrected screen space with y down; the world has y up
    const a = h.sliceAngle;
    const sign = h.halfIndex === 0 ? 1 : -1;
    const n0 = new THREE.Vector2(Math.sin(a) * sign, Math.cos(a) * sign);
    return { group, mat, plane, n0, rot0: h.rot };
  }

  update(w: World, dt: number, hands: HandVis[], now: number) {
    // parallax star drift
    this.stars.forEach((s, i) => {
      s.position.y -= dt * (0.05 + i * 0.09);
      if (s.position.y < -7) s.position.y += 14;
    });

    (this.flash.material as THREE.MeshBasicMaterial).opacity = Math.min(0.42, w.voidFlash * 0.85);

    const sm = this.shock.material as THREE.MeshBasicMaterial;
    if (w.shockwaveActive > 0) {
      const p = 1 - w.shockwaveActive / 0.6;
      this.shock.scale.setScalar(0.2 + p * this.viewW * 0.8);
      sm.opacity = (1 - p) * 0.9;
    } else sm.opacity = 0;

    // hands
    let lightOn = 0;
    for (let i = 0; i < 2; i++) {
      const h = hands[i];
      const ring = this.rings[i];
      const rb = this.ribbons[i];
      const cr = this.chargeRings[i];
      if (h && h.active) {
        const p = this.toWorld(h.x, h.y);
        ring.position.set(p.x, p.y, 0.2);
        const s = (0.075 - h.pinch * 0.03) * this.viewH;
        ring.scale.set(s, s, 1);
        (ring.material as THREE.SpriteMaterial).opacity = 0.9;
        rb.push(p.x, p.y, now);
        rb.update(now, Math.min(1, h.speed / 2));
        rb.mesh.visible = true;
        if (h.charge > 0) {
          const frac = Math.min(1, h.charge / 0.15);
          cr.visible = true;
          cr.position.set(p.x, p.y, 0.25);
          cr.scale.setScalar(this.viewH * 0.05);
          cr.geometry.setDrawRange(0, Math.max(1, Math.round(frac * 48)) * 6);
          (cr.material as THREE.MeshBasicMaterial).color.set(frac >= 1 ? 0xffffff : 0x8fdcff);
        } else cr.visible = false;
        if (i === 0) {
          this.keyLight.position.x = p.x;
          this.keyLight.position.y = p.y;
          lightOn = 3 + Math.min(6, h.speed * 2);
        }
      } else {
        (ring.material as THREE.SpriteMaterial).opacity = 0;
        rb.clear();
        rb.update(now);
        cr.visible = false;
      }
    }
    this.keyLight.intensity += (lightOn - this.keyLight.intensity) * Math.min(1, dt * 10);

    // targets
    const ids = new Set<number>();
    for (const t of w.targets) {
      ids.add(t.id);
      let g = this.targets.get(t.id);
      if (!g) {
        g = this.targetGroup(t);
        this.targets.set(t.id, g);
        this.scene.add(g);
      }
      const p = this.toWorld(t.x, t.y);
      g.position.set(p.x, p.y, 0);
      const core = g.children[0];
      core.rotation.z = t.rotation;
      core.rotation.y = t.age * t.vRot * 0.7 + t.seed;
      core.rotation.x = t.age * 0.6;
      if (t.kind === 'void') {
        const shell = g.children[1];
        shell.rotation.y = -t.age * 2.4;
        shell.rotation.x = t.age * 1.3;
        const pulse = 1 + Math.sin(t.age * 9) * 0.06;
        shell.scale.setScalar(t.r * this.viewH * 1.15 * pulse);
      }
    }
    for (const [id, g] of this.targets) {
      if (!ids.has(id)) {
        this.scene.remove(g); // geometry and materials are shared: nothing to free
        this.targets.delete(id);
      }
    }

    // halves
    const hids = new Set<number>();
    const n = new THREE.Vector2();
    for (const h of w.halves) {
      hids.add(h.id);
      let v = this.halves.get(h.id);
      if (!v) {
        v = this.halfVis(h);
        this.halves.set(h.id, v);
        this.scene.add(v.group);
      }
      const p = this.toWorld(h.x, h.y);
      v.group.position.set(p.x, p.y, 0);
      v.group.rotation.z = -(h.rot - v.rot0);
      n.copy(v.n0).rotateAround(new THREE.Vector2(), -(h.rot - v.rot0));
      // the cut runs through the piece's centre; a small gap makes the split read clearly
      v.plane.normal.set(n.x, n.y, 0);
      v.plane.constant = -(n.x * p.x + n.y * p.y) - this.viewH * 0.004;
      const life = h.life / h.maxLife;
      v.mat.opacity = Math.min(1, life * 2.2);
    }
    for (const [id, v] of this.halves) {
      if (!hids.has(id)) {
        this.scene.remove(v.group);
        v.mat.dispose();
        this.halves.delete(id);
      }
    }

    this.sparks.update(dt);
    this.gl.render(this.scene, this.camera);
  }

  dispose() {
    this.targets.clear();
    this.halves.forEach((v) => v.mat.dispose());
    this.halves.clear();
    for (const rb of this.ribbons) rb.dispose();
    this.sparks.dispose();
    disposeTree(this.scene);
    for (const g of Object.values(this.geos)) g.dispose();
  }
}

export type { Kind };
