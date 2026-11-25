/**
 * Sky Hunter 3D scene: a sunny countryside (sky dome, sun, drifting clouds, mountains, hills, tree line, meadow),
 * low-poly birds that flap and face the way they fly, power-up balloons, shot birds tumbling down in a puff of
 * feathers, and a hand-held blaster with recoil and tracers.
 * Uses the same camera as rules.ts (FOV, CAM), so what you aim at is what you hit.
 */
import * as THREE from 'three';
import { FOV, CAM, PITCH, type Bird, type BirdKind, type World } from './rules';
import { Sparks, glowTexture, disposeTree } from '../../core/ribbon';

interface Look {
  body: number;
  belly: number;
  wing: number;
  head: number;
  beak: number;
  size: number;
}

const LOOK: Record<Exclude<BirdKind, 'balloon'>, Look> = {
  sparrow: { body: 0x8a5a3b, belly: 0xe8d2b0, wing: 0x5e3b24, head: 0x6b4a33, beak: 0xf2b134, size: 0.75 },
  swift: { body: 0x23395d, belly: 0xf2f2f2, wing: 0x15233d, head: 0x1b2c4a, beak: 0x333333, size: 0.62 },
  goose: { body: 0x8d8f94, belly: 0xf3f3f0, wing: 0x6d6f75, head: 0x1d1d1d, beak: 0xf08a24, size: 1.15 },
  golden: { body: 0xffc928, belly: 0xfff2a8, wing: 0xe6a700, head: 0xffd94a, beak: 0xff7a1a, size: 0.72 },
};
const FEATHER: Record<BirdKind, number[]> = {
  sparrow: [0x8a5a3b, 0xe8d2b0, 0x5e3b24],
  swift: [0x23395d, 0xf2f2f2],
  goose: [0x8d8f94, 0xf3f3f0],
  golden: [0xffc928, 0xfff2a8, 0xffffff],
  balloon: [0xef4444, 0xfacc15, 0x38bdf8, 0xffffff],
};
const BALLOON = { life: 0xef4444, rapid: 0xfacc15, slowmo: 0x38bdf8 } as const;

function canvasTex(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const skyTexture = () =>
  canvasTex(16, 512, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, '#2f6fd6');
    grd.addColorStop(0.55, '#6fb2f2');
    grd.addColorStop(0.85, '#bfe3ff');
    grd.addColorStop(1, '#ffe9c2');
    g.fillStyle = grd;
    g.fillRect(0, 0, 16, 512);
  });

const cloudTexture = (seed: number) =>
  canvasTex(512, 256, (g) => {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const x = 90 + rnd() * 330;
      const y = 130 + (rnd() - 0.5) * 60 - Math.sin(((x - 90) / 330) * Math.PI) * 30;
      const r = 40 + rnd() * 55;
      const grd = g.createRadialGradient(x, y - r * 0.2, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.95)');
      grd.addColorStop(0.6, 'rgba(255,255,255,0.75)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // soft blue-grey underside
    g.globalCompositeOperation = 'source-atop';
    const sh = g.createLinearGradient(0, 110, 0, 220);
    sh.addColorStop(0, 'rgba(160,185,215,0)');
    sh.addColorStop(1, 'rgba(160,185,215,0.55)');
    g.fillStyle = sh;
    g.fillRect(0, 0, 512, 256);
  });

const grassTexture = () => {
  const t = canvasTex(256, 256, (g) => {
    g.fillStyle = '#5fa83a';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(40,110,30,0.35)' : 'rgba(150,210,90,0.3)';
      g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 3 + Math.random() * 4);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(40, 30);
  t.anisotropy = 8;
  return t;
};

const featherTexture = () =>
  canvasTex(32, 64, (g) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(16, 30, 9, 26, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(16, 4);
    g.lineTo(16, 62);
    g.stroke();
  });

/** A wing: a flat swept quad pivoting at the shoulder (origin), reaching out along +z (near) or −z (far). */
function wingGeometry(side: 1 | -1) {
  const g = new THREE.BufferGeometry();
  const v = [0.35, 0, 0, -0.35, 0, 0, -0.55, 0.02, side * 1.25, 0.05, 0.02, side * 0.95];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(side === 1 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  g.computeVertexNormals();
  return g;
}

interface Feather {
  s: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  life: number;
}

interface Vis {
  g: THREE.Group;
  wings: THREE.Object3D[];
  mats: THREE.MeshStandardMaterial[];
  hp?: THREE.Mesh;
}

interface Gun {
  root: THREE.Group;
  barrel: THREE.Group;
  flash: THREE.Sprite;
  recoil: number;
  side: 1 | -1;
}

export class ShooterScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 600);
  readonly sparks = new Sparks(300);

  private birds = new Map<number, Vis>();
  private fallers = new Map<number, Vis>();
  private geos: Record<string, THREE.BufferGeometry> = {};
  private clouds: { s: THREE.Sprite; v: number }[] = [];
  private feathers: Feather[] = [];
  private featherTex = featherTexture();
  private tracers: { mesh: THREE.Mesh; life: number }[] = [];
  private guns: Gun[] = [];
  private flashTex = glowTexture('255,230,160');

  constructor(private gl: THREE.WebGLRenderer) {
    this.camera.position.set(CAM.x, CAM.y, CAM.z);
    this.camera.rotation.x = PITCH;
    this.scene.fog = new THREE.Fog(0xcfe8ff, 80, 420);
    this.scene.add(this.camera);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2 + 0.1),
      new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false })
    );
    sky.position.y = -10;
    this.scene.add(sky);

    const sun = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture('255,244,200'), fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending })
    );
    sun.scale.setScalar(160);
    sun.position.set(120, 150, -420);
    this.scene.add(sun);

    // clouds drift slowly at several depths
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTexture(11 + i * 7), fog: false, depthWrite: false, transparent: true, opacity: 0.92 }));
      const z = -160 - Math.random() * 200;
      const wd = 50 + Math.random() * 70;
      s.scale.set(wd, wd / 2, 1);
      s.position.set((Math.random() - 0.5) * 500, 40 + Math.random() * 110 + (-z - 160) * 0.2, z);
      this.scene.add(s);
      this.clouds.push({ s, v: 1.2 + Math.random() * 2 });
    }

    // distant mountains, rolling hills, a tree line, then the meadow
    const ridge = (z: number, color: number, height: number, bumps: number, seed: number) => {
      let s = seed;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const shape = new THREE.Shape();
      const W = 900;
      shape.moveTo(-W / 2, -5);
      for (let i = 0; i <= bumps; i++) shape.lineTo(-W / 2 + (i / bumps) * W, height * (0.45 + rnd() * 0.55));
      shape.lineTo(W / 2, -5);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color }));
      m.position.z = z;
      this.scene.add(m);
    };
    ridge(-380, 0x8fb2d6, 70, 18, 3);
    ridge(-300, 0x7aa1c4, 46, 26, 7);
    const hills = (z: number, color: number, amp: number, freq: number) => {
      const shape = new THREE.Shape();
      const W = 700;
      shape.moveTo(-W / 2, -5);
      for (let i = 0; i <= 80; i++) {
        const x = -W / 2 + (i / 80) * W;
        shape.lineTo(x, amp * (0.6 + 0.4 * Math.sin(x * freq) + 0.25 * Math.sin(x * freq * 2.7 + 1)));
      }
      shape.lineTo(W / 2, -5);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color }));
      m.position.z = z;
      this.scene.add(m);
    };
    hills(-200, 0x6fa95a, 16, 0.02);
    hills(-130, 0x5c9a46, 9, 0.035);

    const trunk = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
    const leaf = [0x2f7d32, 0x3f8f3a, 0x276b2b].map((c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
    this.geos.trunk = new THREE.CylinderGeometry(0.25, 0.35, 2, 6);
    this.geos.crown = new THREE.ConeGeometry(2, 6, 7);
    this.geos.bush = new THREE.IcosahedronGeometry(2.4, 0);
    for (let i = 0; i < 70; i++) {
      const tree = new THREE.Group();
      const t = new THREE.Mesh(this.geos.trunk, trunk);
      t.position.y = 1;
      const round = Math.random() < 0.4;
      const c = new THREE.Mesh(round ? this.geos.bush : this.geos.crown, leaf[i % 3]);
      c.position.y = round ? 3.6 : 4.5;
      tree.add(t, c);
      tree.scale.setScalar(0.8 + Math.random() * 0.9);
      tree.position.set((Math.random() - 0.5) * 260, 0, -70 - Math.random() * 40);
      this.scene.add(tree);
    }

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 500), new THREE.MeshLambertMaterial({ map: grassTexture() }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -200;
    this.scene.add(ground);

    this.scene.add(new THREE.HemisphereLight(0xdff0ff, 0x5c8a3a, 2.2));
    const sunLight = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sunLight.position.set(30, 60, 20);
    this.scene.add(sunLight);

    // bird parts (shared by every bird)
    this.geos.body = new THREE.SphereGeometry(0.5, 14, 10);
    this.geos.body.scale(1.6, 0.85, 0.85);
    this.geos.head = new THREE.SphereGeometry(0.34, 12, 10);
    this.geos.beak = new THREE.ConeGeometry(0.1, 0.36, 6);
    this.geos.beak.rotateZ(-Math.PI / 2);
    this.geos.tail = new THREE.ConeGeometry(0.28, 0.7, 4);
    this.geos.tail.rotateZ(Math.PI / 2);
    this.geos.tail.scale(1, 1, 0.3);
    this.geos.eye = new THREE.SphereGeometry(0.06, 6, 6);
    this.geos.neck = new THREE.CylinderGeometry(0.14, 0.2, 0.7, 8);
    this.geos.wingNear = wingGeometry(1);
    this.geos.wingFar = wingGeometry(-1);
    this.geos.balloon = new THREE.SphereGeometry(0.75, 20, 16);
    this.geos.balloon.scale(1, 1.2, 1);
    this.geos.knot = new THREE.ConeGeometry(0.12, 0.2, 8);
    this.geos.crate = new THREE.BoxGeometry(0.45, 0.45, 0.45);
    this.geos.hp = new THREE.PlaneGeometry(1, 0.1);
    this.geos.tracer = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);

    this.scene.add(this.sparks.group);
    for (let i = 0; i < 2; i++) this.guns.push(this.makeGun(i === 0 ? 1 : -1));
    this.resize();
  }

  private makeGun(side: 1 | -1): Gun {
    const root = new THREE.Group();
    const barrel = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.8, roughness: 0.35 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5530, roughness: 0.7 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: side === 1 ? 0xffb020 : 0x38bdf8, emissiveIntensity: 1.2 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.6), metal);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 12), metal);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0.03, -0.6);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.34, 0.16), wood);
    grip.position.set(0, -0.22, 0.18);
    grip.rotation.x = -0.35;
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.06), accent);
    sight.position.set(0, 0.12, -0.2);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.016, 6, 16), accent);
    ring.position.set(0, 0.03, -0.95);
    barrel.add(body, tube, grip, sight, ring);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.position.set(0, 0.03, -1.05);
    flash.scale.setScalar(0.5);
    barrel.add(flash);
    root.add(barrel);
    root.scale.setScalar(0.62);
    root.visible = false;
    this.camera.add(root);
    return { root, barrel, flash, recoil: 0, side };
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    if (w < 2 || h < 2) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const halfH = Math.tan((FOV * Math.PI) / 360) * 1.6;
    for (const g of this.guns) g.root.position.set(g.side * Math.min(halfH * this.camera.aspect * 0.58, 1.05), -halfH * 0.74, -1.6);
  }

  private birdVis(e: Bird): Vis {
    const g = new THREE.Group();
    const mats: THREE.MeshStandardMaterial[] = [];
    const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra });
      m.userData.emissive = m.emissive.getHex();
      m.userData.base = m.emissiveIntensity;
      mats.push(m);
      return m;
    };
    const wings: THREE.Object3D[] = [];
    if (e.kind === 'balloon') {
      const color = BALLOON[e.pickup ?? 'life'];
      const b = new THREE.Mesh(this.geos.balloon, mat(color, { roughness: 0.25, flatShading: false, emissive: color, emissiveIntensity: 0.25 }));
      b.position.y = 0.4;
      const k = new THREE.Mesh(this.geos.knot, mat(color));
      k.position.y = -0.55;
      k.rotation.x = Math.PI;
      const crate = new THREE.Mesh(this.geos.crate, mat(0xb98a4e));
      crate.position.y = -1.6;
      const string = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.6, 0), new THREE.Vector3(0, -1.38, 0)]),
        new THREE.LineBasicMaterial({ color: 0x444444 })
      );
      g.add(b, k, crate, string);
      return { g, wings, mats };
    }
    const L = LOOK[e.kind];
    const glow = e.kind === 'golden' ? { emissive: 0xffb000, emissiveIntensity: 0.45, metalness: 0.5, roughness: 0.3 } : {};
    const body = new THREE.Mesh(this.geos.body, mat(L.body, glow));
    const belly = new THREE.Mesh(this.geos.body, mat(L.belly, glow));
    belly.scale.set(0.85, 0.7, 0.92);
    belly.position.set(0.05, -0.12, 0);
    const headMat = mat(L.head, glow);
    const head = new THREE.Mesh(this.geos.head, headMat);
    const beak = new THREE.Mesh(this.geos.beak, mat(L.beak));
    const eyeMat = mat(0x111111, { roughness: 0.2 });
    const eye1 = new THREE.Mesh(this.geos.eye, eyeMat);
    const eye2 = new THREE.Mesh(this.geos.eye, eyeMat);
    if (e.kind === 'goose') {
      const neck = new THREE.Mesh(this.geos.neck, headMat);
      neck.position.set(0.85, 0.35, 0);
      neck.rotation.z = -0.9;
      head.position.set(1.15, 0.6, 0);
      g.add(neck);
    } else head.position.set(0.82, 0.2, 0);
    beak.position.set(head.position.x + 0.42, head.position.y - 0.03, 0);
    eye1.position.set(head.position.x + 0.16, head.position.y + 0.1, 0.27);
    eye2.position.set(head.position.x + 0.16, head.position.y + 0.1, -0.27);
    const tail = new THREE.Mesh(this.geos.tail, mat(L.wing, glow));
    tail.position.set(-0.95, 0.05, 0);
    if (e.kind === 'swift') tail.scale.set(1.4, 1, 1.6);
    const wingMat = mat(L.wing, { side: THREE.DoubleSide, ...glow });
    const near = new THREE.Mesh(this.geos.wingNear, wingMat);
    const far = new THREE.Mesh(this.geos.wingFar, wingMat);
    near.position.set(0.1, 0.25, 0.3);
    far.position.set(0.1, 0.25, -0.3);
    if (e.kind === 'swift') {
      near.scale.set(0.9, 1, 1.35);
      far.scale.set(0.9, 1, 1.35);
    }
    wings.push(near, far);
    const model = new THREE.Group();
    model.add(body, belly, head, beak, eye1, eye2, tail, near, far);
    model.scale.setScalar(L.size * 1.5);
    // the model's beak points down +x: turn it round for birds flying right→left
    model.rotation.y = e.dir < 0 ? Math.PI : 0;
    model.name = 'model';
    g.add(model);
    let hp: THREE.Mesh | undefined;
    if (e.kind === 'goose') {
      hp = new THREE.Mesh(this.geos.hp, new THREE.MeshBasicMaterial({ color: 0x4ade80, depthTest: false, transparent: true }));
      hp.position.y = 1.9;
      hp.renderOrder = 5;
      g.add(hp);
    }
    return { g, wings, mats, hp };
  }

  tracer(hand: number, x: number, y: number, z: number) {
    const gun = this.guns[hand] ?? this.guns[0];
    const from = new THREE.Vector3(0, 0.03, -1.05);
    gun.barrel.localToWorld(from);
    const to = new THREE.Vector3(x, y, z);
    let t = this.tracers.find((tr) => tr.life <= 0);
    if (!t) {
      const m = new THREE.Mesh(this.geos.tracer, new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, depthWrite: false, fog: false }));
      t = { mesh: m, life: 0 };
      this.tracers.push(t);
      this.scene.add(m);
    }
    t.mesh.position.copy(from).lerp(to, 0.5);
    t.mesh.scale.set(0.03, from.distanceTo(to), 0.03);
    t.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    t.mesh.visible = true;
    t.life = 0.08;
    gun.recoil = 1;
    (gun.flash.material as THREE.SpriteMaterial).opacity = 1;
    gun.flash.material.rotation = Math.random() * Math.PI;
  }

  /** A puff of feathers (or balloon confetti) at a world point. */
  puff(x: number, y: number, z: number, kind: BirdKind, count = 14) {
    const colors = FEATHER[kind];
    for (let i = 0; i < count; i++) {
      let f = this.feathers.find((p) => p.life <= 0);
      if (!f) {
        if (this.feathers.length > 260) return;
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.featherTex, transparent: true, depthWrite: false }));
        f = { s, vx: 0, vy: 0, vz: 0, spin: 0, life: 0 };
        this.feathers.push(f);
        this.scene.add(s);
      }
      const m = f.s.material as THREE.SpriteMaterial;
      m.color.setHex(colors[i % colors.length]);
      m.opacity = 1;
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 4;
      f.vx = Math.cos(a) * v;
      f.vy = Math.sin(a) * v + 1.5;
      f.vz = (Math.random() - 0.5) * v;
      f.spin = (Math.random() - 0.5) * 8;
      f.life = 1.4 + Math.random() * 0.8;
      f.s.position.set(x, y, z);
      const sz = kind === 'balloon' ? 0.22 : 0.35 + Math.random() * 0.25;
      f.s.scale.set(sz * 0.5, sz, 1);
      f.s.visible = true;
    }
  }

  pop(x: number, y: number, z: number) {
    this.sparks.burst(x, y, z, '255,255,255', 16, 6, 0.4, 0.35, true);
    this.puff(x, y, z, 'balloon', 18);
  }

  update(w: World, dt: number, aims: { x: number; y: number; active: boolean }[]) {
    const aspect = this.camera.aspect;
    for (const c of this.clouds) {
      c.s.position.x += c.v * dt;
      if (c.s.position.x > 300) c.s.position.x = -300;
    }
    const now = performance.now() / 1000;

    const ids = new Set<number>();
    for (const e of w.birds) {
      ids.add(e.id);
      let v = this.birds.get(e.id);
      if (!v) {
        v = this.birdVis(e);
        this.birds.set(e.id, v);
        this.scene.add(v.g);
      }
      v.g.position.set(e.x, e.y, e.z);
      if (e.kind === 'balloon') v.g.rotation.z = Math.sin(e.t * 1.3 + e.seed) * 0.12;
      else {
        const rate = e.kind === 'swift' ? 9 : e.kind === 'goose' ? 4.5 : e.kind === 'golden' ? 10 : 7;
        const flap = Math.sin(now * rate * (w.slowT > 0 ? 0.5 : 1) + e.seed) * (e.kind === 'goose' ? 0.7 : 0.9);
        v.wings[0].rotation.x = -flap;
        v.wings[1].rotation.x = flap;
        // pitch the nose with the bob (in the bird's own frame, so it works for both directions)
        const climb = Math.cos(e.t * e.freq * Math.PI + e.seed) * e.amp * e.freq * 0.25;
        v.g.getObjectByName('model')!.rotation.z = climb * 0.6;
      }
      const flash = e.hitFlash > 0;
      for (const m of v.mats) {
        m.emissive.setHex(flash ? 0xffffff : m.userData.emissive);
        m.emissiveIntensity = flash ? 1.2 : m.userData.base;
      }
      if (v.hp) {
        const f = Math.max(0, e.hp / e.maxHp);
        v.hp.scale.x = 1.6 * f;
        (v.hp.material as THREE.MeshBasicMaterial).color.setHSL(0.33 * f, 0.9, 0.5);
      }
    }
    for (const [id, v] of this.birds) {
      if (ids.has(id)) continue;
      this.birds.delete(id);
      // a shot bird keeps its model and tumbles down as a faller
      if (w.fallers.some((f) => f.id === id)) {
        if (v.hp) v.hp.visible = false;
        this.fallers.set(id, v);
      } else this.freeVis(v);
    }

    const falling = new Set<number>();
    for (const f of w.fallers) {
      falling.add(f.id);
      const v = this.fallers.get(f.id);
      if (!v) continue;
      v.g.position.set(f.x, f.y, f.z);
      v.g.rotation.z = f.rot * (f.dir || 1);
      v.wings[0].rotation.x = 1.2;
      v.wings[1].rotation.x = -1.2;
    }
    for (const [id, v] of this.fallers) {
      if (!falling.has(id)) {
        this.freeVis(v);
        this.fallers.delete(id);
      }
    }

    // feathers flutter down
    for (const f of this.feathers) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const k = Math.exp(-dt * 2.5);
      f.vx *= k;
      f.vz *= k;
      f.vy = f.vy * k - 3 * dt;
      f.s.position.x += (f.vx + Math.sin(f.life * 6) * 0.8) * dt;
      f.s.position.y += f.vy * dt;
      f.s.position.z += f.vz * dt;
      const m = f.s.material as THREE.SpriteMaterial;
      m.rotation += f.spin * dt;
      m.opacity = Math.min(1, f.life);
      if (f.life <= 0) f.s.visible = false;
    }

    // guns follow the aim
    const tan = Math.tan((FOV * Math.PI) / 360);
    for (let i = 0; i < 2; i++) {
      const gun = this.guns[i];
      const a = aims[i];
      gun.root.visible = !!a?.active && w.phase === 'play';
      if (!gun.root.visible) continue;
      const target = new THREE.Vector3((2 * a.x - 1) * tan * aspect * 30, (1 - 2 * a.y) * tan * 30, -30);
      gun.barrel.lookAt(this.camera.localToWorld(target));
      gun.barrel.rotateY(Math.PI); // the model's muzzle points down -z
      gun.recoil = Math.max(0, gun.recoil - dt * 9);
      gun.barrel.position.z = gun.recoil * 0.12;
      gun.barrel.rotateX(gun.recoil * 0.18);
      const fm = gun.flash.material as THREE.SpriteMaterial;
      fm.opacity = Math.max(0, fm.opacity - dt * 14);
      gun.flash.scale.setScalar(0.35 + fm.opacity * 0.35);
      const reload = w.reloadT > 0 ? Math.sin((w.reloadT / 0.9) * Math.PI) : 0;
      gun.root.rotation.z = gun.side * reload * 0.9;
      gun.root.position.y = -tan * 1.6 * 0.74 - reload * 0.25;
    }

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      const m = t.mesh.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, t.life / 0.08);
      t.mesh.scale.x = t.mesh.scale.z = 0.03 * m.opacity + 0.004;
      if (t.life <= 0) t.mesh.visible = false;
    }

    this.sparks.update(dt);
    this.gl.render(this.scene, this.camera);
  }

  private freeVis(v: Vis) {
    this.scene.remove(v.g);
    for (const m of v.mats) m.dispose();
    v.g.traverse((o) => {
      if (o instanceof THREE.Line) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    if (v.hp) (v.hp.material as THREE.Material).dispose();
  }

  dispose() {
    for (const v of this.birds.values()) this.freeVis(v);
    for (const v of this.fallers.values()) this.freeVis(v);
    this.birds.clear();
    this.fallers.clear();
    this.sparks.dispose();
    disposeTree(this.scene);
    for (const g of Object.values(this.geos)) g.dispose();
    this.flashTex.dispose();
    this.featherTex.dispose();
  }
}
