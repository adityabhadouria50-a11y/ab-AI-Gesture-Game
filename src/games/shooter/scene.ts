/**
 * Neon Strike 3D scene: synthwave sky, striped sun, scrolling neon grid, wireframe mountains, enemy models,
 * a boss saucer, two hand-held blasters with recoil, laser tracers, explosions and hit flashes.
 * Uses the same camera as rules.ts (FOV, CAM), so what you aim at is what you hit.
 */
import * as THREE from 'three';
import { FOV, CAM, type Enemy, type EnemyKind, type World } from './rules';
import { Sparks, glowTexture, disposeTree } from '../../core/ribbon';

const COL: Record<EnemyKind, number> = {
  drone: 0x22d3ee,
  zig: 0xf472b6,
  tank: 0xfb923c,
  missile: 0xff3355,
  boss: 0xa855f7,
  pickup: 0xffffff,
};
const PICKUP_COL = { shield: 0x4ade80, rapid: 0xfacc15, nuke: 0xffffff } as const;
const SPARK: Record<EnemyKind, string> = {
  drone: '90,230,255',
  zig: '255,120,210',
  tank: '255,170,80',
  missile: '255,80,100',
  boss: '190,120,255',
  pickup: '255,255,255',
};

function skyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 512;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#05010f');
  grd.addColorStop(0.45, '#1a0636');
  grd.addColorStop(0.72, '#4a0d5e');
  grd.addColorStop(0.86, '#b3206e');
  grd.addColorStop(1, '#ff6a3d');
  g.fillStyle = grd;
  g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function sunTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, S);
  grd.addColorStop(0, '#fff27a');
  grd.addColorStop(0.5, '#ff9a3d');
  grd.addColorStop(1, '#ff2a7a');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.48, 0, Math.PI * 2);
  g.fill();
  // horizontal slats cut out of the lower half
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9; i++) {
    const y = S * 0.55 + i * S * 0.05;
    g.fillRect(0, y, S, 3 + i * 2.2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const GRID_VS = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
  }`;
const GRID_FS = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uPulse;
  varying vec3 vPos;
  // 1 on the grid line through every integer v, anti-aliased with screen-space derivatives
  float gridLine(float v, float w) {
    float d = abs(fract(v - 0.5) - 0.5);
    float fw = fwidth(v);
    return 1.0 - smoothstep(w, w + fw * 1.5, d);
  }
  void main() {
    vec2 p = vec2(vPos.x / 4.0, (vPos.z + uTime * 14.0) / 4.0);
    float g = max(gridLine(p.x, 0.018), gridLine(p.y, 0.018));
    float dist = clamp(-vPos.z / 140.0, 0.0, 1.0);
    float fade = 1.0 - dist;
    vec3 base = mix(vec3(0.03, 0.0, 0.08), vec3(0.18, 0.0, 0.2), dist);
    vec3 col = base + uColor * g * fade * (1.2 + uPulse) + uColor * 0.15 * pow(dist, 3.0);
    gl_FragColor = vec4(col, 1.0);
  }`;

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
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
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 400);
  readonly sparks = new Sparks(900);

  private grid: THREE.Mesh;
  private gridMat: THREE.ShaderMaterial;
  private sky: THREE.Mesh;
  private sun: THREE.Mesh;
  private enemies = new Map<number, { g: THREE.Group; mats: THREE.MeshStandardMaterial[]; hp?: THREE.Mesh }>();
  private geos: Record<string, THREE.BufferGeometry> = {};
  private halo: Record<EnemyKind, THREE.SpriteMaterial> = {} as Record<EnemyKind, THREE.SpriteMaterial>;
  private tracers: Tracer[] = [];
  private tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  private guns: Gun[] = [];
  private flashTex = glowTexture('255,230,160');
  private boomLight: THREE.PointLight;
  private rings: { m: THREE.Mesh; t: number; max: number; size: number }[] = [];
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48);
  private pulse = 0;

  constructor(private gl: THREE.WebGLRenderer) {
    this.camera.position.set(CAM.x, CAM.y, CAM.z);
    this.scene.fog = new THREE.Fog(0x16052a, 40, 170);
    this.scene.add(this.camera);

    // sky dome
    const skyMat = new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2 + 0.05), skyMat);
    this.sky.position.y = -2;
    this.scene.add(this.sky);
    // stars in the upper sky
    const sp = new Float32Array(500 * 3);
    for (let i = 0; i < 500; i++) {
      const a = Math.random() * Math.PI - Math.PI, el = 0.12 + Math.random() * 1.2;
      sp[i * 3] = Math.cos(a) * Math.cos(el) * 250;
      sp[i * 3 + 1] = Math.sin(el) * 250;
      sp[i * 3 + 2] = Math.sin(a) * Math.cos(el) * 250;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.scene.add(new THREE.Points(sgeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));

    this.sun = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: sunTexture(), transparent: true, fog: false, depthWrite: false })
    );
    this.sun.scale.setScalar(110);
    this.sun.position.set(0, 22, -260);
    this.scene.add(this.sun);
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,90,140'), transparent: true, opacity: 0.6, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    sunGlow.scale.setScalar(260);
    sunGlow.position.set(0, 20, -262);
    this.scene.add(sunGlow);

    // mountains: low-poly ridges on both sides
    for (const side of [-1, 1]) {
      const pts: number[] = [];
      let x = side * 22;
      const ridge: [number, number][] = [];
      for (let i = 0; i < 14; i++) {
        ridge.push([x, 2 + Math.random() * (10 + i * 1.2)]);
        x += side * (6 + Math.random() * 6);
      }
      for (let i = 0; i < ridge.length - 1; i++) {
        const [x0, y0] = ridge[i], [x1, y1] = ridge[i + 1];
        pts.push(x0, 0, -150, x0, y0, -150, x0, y0, -150, x1, y1, -150);
        pts.push(x0, y0, -150, (x0 + x1) / 2, 0, -150);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xff3fa4, transparent: true, opacity: 0.75, fog: false })));
      const fill = new THREE.Shape();
      fill.moveTo(ridge[0][0], 0);
      for (const [rx, ry] of ridge) fill.lineTo(rx, ry);
      fill.lineTo(ridge[ridge.length - 1][0], 0);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(fill), new THREE.MeshBasicMaterial({ color: 0x12031f, fog: false, side: THREE.DoubleSide }));
      m.position.z = -150.5;
      this.scene.add(m);
    }

    // neon grid floor
    this.gridMat = new THREE.ShaderMaterial({
      vertexShader: GRID_VS,
      fragmentShader: GRID_FS,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xff2fd0) }, uPulse: { value: 0 } },
    });
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(400, 260), this.gridMat);
    this.grid.rotation.x = -Math.PI / 2;
    this.grid.position.z = -120;
    this.scene.add(this.grid);

    this.scene.add(new THREE.HemisphereLight(0x9ad7ff, 0x40104a, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(2, 6, 4);
    this.scene.add(key);
    const back = new THREE.DirectionalLight(0xff4fa0, 2.2);
    back.position.set(0, 3, -20);
    this.scene.add(back);
    this.boomLight = new THREE.PointLight(0xffaa55, 0, 40, 1.4);
    this.scene.add(this.boomLight);

    // geometries
    this.geos.drone = new THREE.OctahedronGeometry(0.55, 0);
    this.geos.droneRing = new THREE.TorusGeometry(0.85, 0.07, 6, 28);
    this.geos.zig = new THREE.ConeGeometry(0.5, 1.4, 4);
    this.geos.zig.rotateX(Math.PI / 2);
    this.geos.zigWing = new THREE.BoxGeometry(1.6, 0.06, 0.4);
    this.geos.tank = new THREE.DodecahedronGeometry(1.05, 0);
    this.geos.tankSpike = new THREE.ConeGeometry(0.22, 0.8, 5);
    this.geos.missile = new THREE.ConeGeometry(0.26, 1.3, 8);
    this.geos.missile.rotateX(Math.PI / 2);
    this.geos.bossBody = new THREE.LatheGeometry(
      [[0, -0.6], [2.2, -0.4], [3.6, 0], [2.4, 0.35], [1.2, 0.5], [0, 0.55]].map(([x, y]) => new THREE.Vector2(x, y)),
      32
    );
    this.geos.bossDome = new THREE.SphereGeometry(1.25, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    this.geos.bossRing = new THREE.TorusGeometry(3.7, 0.08, 6, 64);
    this.geos.pickup = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    this.geos.pickupEdges = new THREE.EdgesGeometry(this.geos.pickup);
    this.geos.hp = new THREE.PlaneGeometry(1, 0.14);
    for (const k of Object.keys(COL) as EnemyKind[]) {
      const c = new THREE.Color(COL[k]);
      this.halo[k] = new THREE.SpriteMaterial({
        map: glowTexture(`${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`),
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    }

    this.scene.add(this.sparks.group);
    for (let i = 0; i < 2; i++) this.guns.push(this.makeGun(i === 0 ? 1 : -1));
    this.resize();
  }

  private makeGun(side: 1 | -1): Gun {
    const root = new THREE.Group();
    const barrel = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x1b1530, metalness: 0.7, roughness: 0.3 });
    const neon = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: side === 1 ? 0x22d3ee : 0xf472b6, emissiveIntensity: 2.2 });
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.17, 0.7), body);
    const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.55, 12), body);
    b2.rotation.x = Math.PI / 2;
    b2.position.set(0, 0.03, -0.55);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 0.6), neon);
    stripe.position.y = 0.07;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 0.14), body);
    grip.position.set(0, -0.2, 0.2);
    grip.rotation.x = -0.35;
    const tip = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.018, 6, 16), neon);
    tip.position.set(0, 0.03, -0.82);
    barrel.add(b1, b2, stripe, grip, tip);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.position.set(0, 0.03, -0.95);
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
    const aspect = w / h;
    // keep the guns in the lower corners whatever the aspect
    const halfH = Math.tan((FOV * Math.PI) / 360) * 1.6;
    for (const g of this.guns) g.root.position.set(g.side * Math.min(halfH * aspect * 0.58, 1.05), -halfH * 0.74, -1.6);
  }

  private enemyVis(e: Enemy) {
    const g = new THREE.Group();
    const mats: THREE.MeshStandardMaterial[] = [];
    const mat = (color: number, emissive = 0.6, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: emissive, roughness: 0.35, metalness: 0.4, flatShading: true, ...extra });
      m.userData.base = emissive;
      mats.push(m);
      return m;
    };
    const c = COL[e.kind];
    let hp: THREE.Mesh | undefined;
    switch (e.kind) {
      case 'drone': {
        g.add(new THREE.Mesh(this.geos.drone, mat(c, 0.7)));
        const ring = new THREE.Mesh(this.geos.droneRing, mat(0xffffff, 1.2));
        ring.name = 'spin';
        g.add(ring);
        break;
      }
      case 'zig': {
        g.add(new THREE.Mesh(this.geos.zig, mat(c, 0.8)));
        g.add(new THREE.Mesh(this.geos.zigWing, mat(0x2a0a2a, 0.2)));
        break;
      }
      case 'tank': {
        const core = new THREE.Mesh(this.geos.tank, mat(c, 0.45, { metalness: 0.7 }));
        core.name = 'spin';
        for (let i = 0; i < 6; i++) {
          const s = new THREE.Mesh(this.geos.tankSpike, mat(0xffe1c2, 0.8));
          const dir = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][i];
          s.position.set(dir[0] * 1.05, dir[1] * 1.05, dir[2] * 1.05);
          s.lookAt(dir[0] * 3, dir[1] * 3, dir[2] * 3);
          s.rotateX(Math.PI / 2);
          core.add(s);
        }
        g.add(core);
        break;
      }
      case 'missile': {
        g.add(new THREE.Mesh(this.geos.missile, mat(c, 1.2)));
        break;
      }
      case 'boss': {
        const body = new THREE.Mesh(this.geos.bossBody, mat(0x3b1d6e, 0.35, { metalness: 0.8, roughness: 0.25 }));
        const dome = new THREE.Mesh(this.geos.bossDome, mat(0xc084fc, 0.9, { transparent: true, opacity: 0.85 }));
        dome.position.y = 0.45;
        const ring = new THREE.Mesh(this.geos.bossRing, mat(0xff3fd0, 1.6));
        ring.rotation.x = Math.PI / 2;
        ring.name = 'spin';
        g.add(body, dome, ring);
        for (let i = 0; i < 10; i++) {
          const l = new THREE.Mesh(this.geos.drone, mat(0xfff27a, 2));
          const a = (i / 10) * Math.PI * 2;
          l.scale.setScalar(0.28);
          l.position.set(Math.cos(a) * 3, 0.05, Math.sin(a) * 3);
          body.add(l);
        }
        break;
      }
      case 'pickup': {
        const pc = PICKUP_COL[e.pickup ?? 'shield'];
        const box = new THREE.Mesh(this.geos.pickup, mat(pc, 0.9, { transparent: true, opacity: 0.35 }));
        box.name = 'spin';
        box.add(new THREE.LineSegments(this.geos.pickupEdges, new THREE.LineBasicMaterial({ color: pc })));
        g.add(box);
        break;
      }
    }
    const halo = new THREE.Sprite(e.kind === 'pickup' ? this.halo.pickup : this.halo[e.kind]);
    halo.scale.setScalar(e.r * (e.kind === 'boss' ? 3.5 : 4));
    g.add(halo);
    if (e.kind === 'tank' || e.kind === 'boss') {
      hp = new THREE.Mesh(this.geos.hp, new THREE.MeshBasicMaterial({ color: 0x4ade80, depthTest: false, transparent: true, fog: false }));
      hp.position.y = e.r + 0.5;
      hp.scale.x = e.kind === 'boss' ? 6 : 2;
      hp.renderOrder = 5;
      g.add(hp);
    }
    return { g, mats, hp };
  }

  /** Bright tracer from the gun muzzle to the target point. */
  tracer(hand: number, x: number, y: number, z: number, color: number) {
    const gun = this.guns[hand] ?? this.guns[0];
    const from = new THREE.Vector3(0, 0.03, -0.95);
    gun.barrel.localToWorld(from);
    const to = new THREE.Vector3(x, y, z);
    const len = from.distanceTo(to);
    let t = this.tracers.find((tr) => tr.life <= 0);
    if (!t) {
      const m = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      t = { mesh: m, life: 0 };
      this.tracers.push(t);
      this.scene.add(m);
    }
    const mat = t.mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(color);
    t.mesh.position.copy(from).lerp(to, 0.5);
    t.mesh.scale.set(0.035, len, 0.035);
    t.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    t.mesh.visible = true;
    t.life = 0.09;
    gun.recoil = 1;
    (gun.flash.material as THREE.SpriteMaterial).opacity = 1;
    gun.flash.material.rotation = Math.random() * Math.PI;
  }

  hitSpark(x: number, y: number, z: number, kind: EnemyKind) {
    this.sparks.burst(x, y, z, SPARK[kind], 10, 6, 0.25, 0.35, true);
  }

  explode(x: number, y: number, z: number, kind: EnemyKind) {
    const big = kind === 'boss' ? 4 : kind === 'tank' ? 1.8 : 1;
    this.sparks.burst(x, y, z, SPARK[kind], Math.round(34 * big), 9 * big, 0.45 * big, 0.8, true);
    this.sparks.burst(x, y, z, '255,240,200', Math.round(12 * big), 4 * big, 1.1 * big, 0.35, true);
    this.boomLight.position.set(x, y, z + 2);
    this.boomLight.intensity = 60 * big;
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(COL[kind]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.position.set(x, y, z);
    this.scene.add(m);
    this.rings.push({ m, t: 0, max: 0.5, size: 3.5 * big });
    if (kind === 'boss') this.pulse = 2;
  }

  gridPulse(v = 1) {
    this.pulse = Math.max(this.pulse, v);
  }

  update(w: World, dt: number, aims: { x: number; y: number; active: boolean }[]) {
    const aspect = this.camera.aspect;
    this.gridMat.uniforms.uTime.value += dt;
    this.pulse = Math.max(0, this.pulse - dt * 2);
    this.gridMat.uniforms.uPulse.value = this.pulse;
    this.boomLight.intensity *= Math.exp(-dt * 9);

    // enemies
    const ids = new Set<number>();
    for (const e of w.enemies) {
      ids.add(e.id);
      let v = this.enemies.get(e.id);
      if (!v) {
        v = this.enemyVis(e);
        this.enemies.set(e.id, v);
        this.scene.add(v.g);
      }
      v.g.position.set(e.x, e.y, e.z);
      const spin = v.g.getObjectByName('spin');
      if (spin) {
        spin.rotation.y += dt * (e.kind === 'boss' ? 0.8 : 2.5);
        if (e.kind !== 'boss') spin.rotation.x += dt * 1.3;
      }
      if (e.kind === 'zig' || e.kind === 'missile') v.g.rotation.z = Math.sin(e.t * 4.5 + e.seed) * 0.6;
      if (e.kind === 'drone') v.g.children[0].rotation.y += dt * 3;
      if (e.kind === 'boss') v.g.rotation.z = Math.cos(e.t * 0.55 + e.seed) * 0.15;
      const flash = e.hitFlash > 0;
      for (const m of v.mats) m.emissiveIntensity = flash ? 4 : m.userData.base;
      if (v.hp) {
        const f = Math.max(0, e.hp / e.maxHp);
        v.hp.scale.x = (e.kind === 'boss' ? 6 : 2) * f;
        (v.hp.material as THREE.MeshBasicMaterial).color.setHSL(0.33 * f, 0.9, 0.55);
        v.hp.lookAt(this.camera.position);
      }
      if (e.kind === 'missile' && Math.random() < 0.6) this.sparks.burst(e.x, e.y, e.z - 0.7, '255,140,60', 1, 1, 0.3, 0.3, true);
    }
    for (const [id, v] of this.enemies) {
      if (!ids.has(id)) {
        this.scene.remove(v.g);
        for (const m of v.mats) m.dispose();
        v.g.traverse((o) => {
          const lm = (o as THREE.LineSegments).material as THREE.Material | undefined;
          if (o instanceof THREE.LineSegments && lm) lm.dispose();
        });
        if (v.hp) (v.hp.material as THREE.Material).dispose();
        this.enemies.delete(id);
      }
    }

    // guns follow the aim
    for (let i = 0; i < 2; i++) {
      const gun = this.guns[i];
      const a = aims[i];
      gun.root.visible = !!a?.active && w.phase === 'play';
      if (!gun.root.visible) continue;
      // point the barrel at a far point along the aim ray (camera-local, the camera is unrotated)
      const tan = Math.tan((FOV * Math.PI) / 360);
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
      gun.root.position.y = -Math.tan((FOV * Math.PI) / 360) * 1.6 * 0.74 - reload * 0.25;
    }

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      const m = t.mesh.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, t.life / 0.09);
      t.mesh.scale.x = t.mesh.scale.z = 0.035 * m.opacity + 0.005;
      if (t.life <= 0) t.mesh.visible = false;
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const u = r.t / r.max;
      if (u >= 1) {
        this.scene.remove(r.m);
        (r.m.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      r.m.scale.setScalar(0.3 + u * r.size);
      r.m.lookAt(this.camera.position);
      (r.m.material as THREE.MeshBasicMaterial).opacity = 1 - u;
    }

    this.sparks.update(dt);
    this.gl.render(this.scene, this.camera);
  }

  dispose() {
    for (const v of this.enemies.values()) for (const m of v.mats) m.dispose();
    this.enemies.clear();
    this.sparks.dispose();
    disposeTree(this.scene);
    for (const g of Object.values(this.geos)) g.dispose();
    this.tracerGeo.dispose();
    this.ringGeo.dispose();
    this.flashTex.dispose();
    for (const m of Object.values(this.halo)) {
      m.map?.dispose();
      m.dispose();
    }
  }
}
