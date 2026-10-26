// 3D-вьюер: сцена, камера, выбор деталей, режимы просмотра, анимация двигателя и разборки.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EngineModel, CX, FIRE_OFFSET, CRANK_R, ROD_L, PartObj } from './model';
import { orientBetween } from './geo';
import { store, partById, isRemovable } from '../core/store';
import { bus } from '../core/bus';
import { sim } from '../sim/engine';
import { probePoints, ProbePoint } from '../sim/probes';

const SHELL_IDS = new Set(['block', 'head', 'valve_cover', 'timing_cover', 'oil_pan', 'engine_cover', 'intake_manifold', 'heat_shield']);
const CUT_IDS = new Set(['block', 'head', 'valve_cover', 'timing_cover', 'oil_pan', 'engine_cover', 'intake_manifold', 'pcv_hose', 'throttle', 'fuel_rail', 'knock', 'oil_filter', 'oil_press', 'thermostat', 'coil_1', 'coil_2', 'coil_3', 'coil_4', 'injector_1', 'injector_2', 'injector_3', 'injector_4']);
const CUT_HIDE = new Set(['radiator', 'fan', 'upper_hose', 'lower_hose', 'exp_tank', 'ac_comp', 'alternator', 'drive_belt', 'crank_pulley', 'belt_tensioner', 'idler', 'water_pump', 'ckp', 'air_duct']);

interface PartAnim { id: string; dir: 'out' | 'in'; t: number; boltT: number; moveT: number }

export type ProbeLead = 'red' | 'black';

export class Viewer {
  renderer: THREE.WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  model = new EngineModel();
  selected: string | null = null;
  hovered: string | null = null;
  xray = false;
  cut = false;
  isolate = false;
  slow = 1;
  crankDeg = 0;
  probesOn = false;
  activeLead: ProbeLead = 'red';
  leads: Record<ProbeLead, string | null> = { red: 'battery:+', black: 'bay:gnd' };
  onProbePick: ((id: string) => void) | null = null;

  private ray = new THREE.Raycaster();
  private ptr = new THREE.Vector2();
  private downAt = { x: 0, y: 0, t: 0 };
  private anims = new Map<string, PartAnim>();
  private visState = new Map<string, boolean>();
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.075);
  private probeGroup = new THREE.Group();
  private probeMeshes = new Map<string, THREE.Mesh>();
  private label: CSS2DObject;
  private leadLabels: Record<ProbeLead, CSS2DObject>;
  private camAnim: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number } | null = null;
  private clock = new THREE.Clock();
  private sized = false;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.appendChild(this.renderer.domElement);
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    host.appendChild(this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.02, 30);
    this.camera.position.set(0.55, 1.25, 1.15);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.18, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.15;
    this.controls.maxDistance = 4;
    this.controls.maxPolarAngle = Math.PI * 0.92;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.background = new THREE.Color(0x0c1016);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2420, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(1.5, 3, 1.5);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9bb7ff, 0.4);
    fill.position.set(-2, 1, -1);
    this.scene.add(fill);

    // Пол
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 64), new THREE.MeshStandardMaterial({ color: 0x151a21, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.42;
    floor.userData.noPick = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(6, 60, 0x2a3240, 0x1c222c);
    grid.position.y = -0.419;
    grid.userData.noPick = true;
    this.scene.add(grid);

    this.scene.add(this.model.root);
    this.scene.add(this.probeGroup);

    const el = document.createElement('div');
    el.className = 'part-label';
    this.label = new CSS2DObject(el);
    this.label.visible = false;
    this.scene.add(this.label);
    const mk = (cls: string, txt: string) => {
      const d = document.createElement('div');
      d.className = `lead-label ${cls}`;
      d.textContent = txt;
      const o = new CSS2DObject(d);
      o.visible = false;
      this.scene.add(o);
      return o;
    };
    this.leadLabels = { red: mk('red', '＋ красный'), black: mk('black', '− чёрный') };
    this.buildProbeMarkers();

    this.syncParts(false);
    bus.on('parts', () => this.syncParts(true));
    bus.on('select', (id) => this.setSelected(id));
    bus.on('focus', (id) => this.focusPart(id));
    bus.on('probes', () => this.updateProbeMarkers());

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => { this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    dom.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 7 && performance.now() - this.downAt.t < 600) this.pick(e);
    });
    dom.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this.hover(e); });
    dom.addEventListener('dblclick', () => { if (this.selected) this.focusPart(this.selected); });

    // Симуляция идёт в реальном времени независимо от частоты кадров
    let simLast = performance.now();
    setInterval(() => {
      const now = performance.now();
      let simDt = Math.min((now - simLast) / 1000, 1);
      simLast = now;
      while (simDt > 1e-4) { const d = Math.min(0.04, simDt); sim.step(d); simDt -= d; }
    }, 30);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- Размер ----------
  private resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    const first = !this.sized;
    this.sized = true;
    this.camera.fov = w < h ? 50 : 40;
    this.camera.updateProjectionMatrix();
    if (first) this.camera.position.copy(this.homePos());
  }

  // ---------- Выбор ----------
  private setPtr(e: PointerEvent | MouseEvent): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ptr, this.camera);
  }

  private visibleChain(o: THREE.Object3D): boolean {
    let p: THREE.Object3D | null = o;
    while (p) { if (!p.visible) return false; p = p.parent; }
    return true;
  }

  private hitPart(): string | null {
    const hits = this.ray.intersectObject(this.model.root, true);
    for (const h of hits) {
      const o = h.object as THREE.Mesh;
      if (o.userData.noPick || !this.visibleChain(o)) continue;
      const mat = o.material as THREE.MeshStandardMaterial;
      if (mat && mat.opacity < 0.5) continue;
      if (this.cut && mat.clippingPlanes?.length && this.clipPlane.distanceToPoint(h.point) < 0) continue;
      const id = o.userData.partId as string | undefined;
      if (id) return id;
    }
    return null;
  }

  private pick(e: PointerEvent): void {
    this.setPtr(e);
    if (this.probesOn) {
      const ph = this.ray.intersectObjects([...this.probeMeshes.values()].filter((m) => m.visible), false);
      if (ph.length) {
        const id = ph[0].object.userData.probeId as string;
        this.onProbePick?.(id);
        return;
      }
    }
    const id = this.hitPart();
    bus.emit('select', id);
  }

  private hover(e: PointerEvent): void {
    this.setPtr(e);
    const id = this.hitPart();
    if (id !== this.hovered) {
      const prev = this.hovered;
      this.hovered = id;
      if (prev) this.applyLook(prev);
      if (id) this.applyLook(id);
      this.renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
    }
  }

  private setSelected(id: string | null): void {
    const prev = this.selected;
    this.selected = id;
    if (prev) this.applyLook(prev);
    if (id) this.applyLook(id);
    if (this.isolate) this.applyIsolate();
    this.updateLabel();
  }

  private updateLabel(): void {
    const id = this.selected;
    const p = id ? this.model.parts.get(id) : null;
    if (!id || !p || !this.visState.get(id)) { this.label.visible = false; return; }
    const bb = new THREE.Box3().setFromObject(p.group);
    if (bb.isEmpty()) { this.label.visible = false; return; }
    this.label.position.set((bb.min.x + bb.max.x) / 2, bb.max.y + 0.02, (bb.min.z + bb.max.z) / 2);
    (this.label.element as HTMLElement).textContent = partById.get(id)?.name ?? id;
    this.label.visible = true;
  }

  focusPart(id: string): void {
    const p = this.model.parts.get(id);
    if (!p) return;
    const bb = new THREE.Box3().setFromObject(p.group);
    if (bb.isEmpty()) return;
    const c = bb.getCenter(new THREE.Vector3());
    const size = Math.max(0.12, bb.getSize(new THREE.Vector3()).length());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = Math.min(1.6, size * 2.2 + 0.15);
    this.camAnim = { from: this.camera.position.clone(), to: c.clone().add(dir.multiplyScalar(dist)), tFrom: this.controls.target.clone(), tTo: c, t: 0 };
  }

  resetView(): void {
    this.camAnim = { from: this.camera.position.clone(), to: this.homePos(), tFrom: this.controls.target.clone(), tTo: new THREE.Vector3(0, 0.18, 0), t: 0 };
  }

  private homePos(): THREE.Vector3 {
    return this.camera.aspect < 1 ? new THREE.Vector3(0.75, 1.55, 1.45) : new THREE.Vector3(0.55, 1.25, 1.15);
  }

  viewPreset(name: 'front' | 'top' | 'right' | 'left' | 'rear'): void {
    const t = new THREE.Vector3(0, name === 'front' ? 0.14 : 0.18, 0);
    const pos: Record<string, THREE.Vector3> = {
      front: new THREE.Vector3(0.04, 0.2, 1.0), top: new THREE.Vector3(0.01, 1.9, 0.15), right: new THREE.Vector3(1.6, 0.4, 0.1),
      left: new THREE.Vector3(-1.6, 0.5, 0.2), rear: new THREE.Vector3(0.1, 0.9, -1.5),
    };
    this.camAnim = { from: this.camera.position.clone(), to: pos[name], tFrom: this.controls.target.clone(), tTo: t, t: 0 };
  }

  // ---------- Внешний вид деталей ----------
  private fadeOf = new Map<string, number>();

  applyLook(id: string): void {
    const p = this.model.parts.get(id);
    if (!p) return;
    const fade = this.fadeOf.get(id) ?? 1;
    const xr = this.xray && SHELL_IDS.has(id) ? 0.13 : 1;
    const sel = this.selected === id;
    const hov = this.hovered === id && !sel;
    const clip = this.cut && CUT_IDS.has(id) ? [this.clipPlane] : null;
    p.mats.forEach((m, i) => {
      const op = p.baseOpacity[i] * fade * xr;
      m.opacity = op;
      const tr = op < 0.999;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      m.depthWrite = !tr || op > 0.6;
      m.emissive.setHex(sel ? 0x1d6fe8 : hov ? 0x3b82f6 : 0x000000);
      m.emissiveIntensity = sel ? 0.45 : hov ? 0.22 : 0;
      const mesh = p.meshes[i];
      const mclip = mesh.userData.internal ? null : clip;
      const hadClip = !!m.clippingPlanes?.length;
      if (hadClip !== !!mclip) { m.clippingPlanes = mclip; m.clipShadows = false; m.needsUpdate = true; }
      m.side = mclip ? THREE.DoubleSide : THREE.FrontSide;
      if (mesh.userData.liner) mesh.visible = !this.cut;
    });
  }

  setXray(on: boolean): void { this.xray = on; SHELL_IDS.forEach((id) => this.applyLook(id)); }
  setCut(on: boolean): void {
    this.cut = on;
    CUT_IDS.forEach((id) => this.applyLook(id));
    this.applyVisibility();
  }
  setIsolate(on: boolean): void { this.isolate = on; this.applyIsolate(); }

  private applyIsolate(): void { this.applyVisibility(); }

  private applyVisibility(): void {
    for (const [id, p] of this.model.parts) {
      const installedVis = this.visState.get(id) ?? true;
      let vis = installedVis || this.anims.has(id);
      if (this.isolate && this.selected && id !== this.selected) vis = false;
      if (this.cut && CUT_HIDE.has(id)) vis = false;
      p.group.visible = vis;
    }
    this.updateProbeMarkers();
  }

  // ---------- Синхронизация с состоянием и анимация разборки ----------
  syncParts(animate: boolean): void {
    for (const [id] of this.model.parts) {
      const want = store.installed(id);
      const cur = this.visState.get(id);
      if (cur === want) continue;
      this.visState.set(id, want);
      if (animate && cur !== undefined && isRemovable(id)) {
        this.anims.set(id, { id, dir: want ? 'in' : 'out', t: 0, boltT: 0, moveT: 0 });
      } else {
        this.anims.delete(id);
        this.setPose(id, want ? 0 : 1, want ? 0 : 1);
      }
    }
    this.applyVisibility();
    this.updateLabel();
  }

  /** boltP: 0 — болты закручены, 1 — выкручены; moveP: 0 — на месте, 1 — снято. */
  private setPose(id: string, boltP: number, moveP: number): void {
    const p = this.model.parts.get(id)!;
    const ease = (x: number) => x * x * (3 - 2 * x);
    for (const b of p.bolts) {
      if (b.userData.home === undefined) b.userData.home = b.position.clone();
      const dir = b.userData.dir as THREE.Vector3;
      b.position.copy(b.userData.home).addScaledVector(dir, ease(boltP) * 0.03);
      b.rotation.set(0, 0, 0);
      b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      b.rotateY(boltP * Math.PI * 6);
    }
    p.group.position.copy(p.home).addScaledVector(p.removeDir, ease(moveP) * 0.32);
    this.fadeOf.set(id, moveP > 0.6 ? 1 - (moveP - 0.6) / 0.4 : 1);
    this.applyLook(id);
  }

  private stepAnims(dt: number): void {
    for (const a of [...this.anims.values()]) {
      const p = this.model.parts.get(a.id)!;
      const hasBolts = p.bolts.length > 0;
      const boltDur = hasBolts ? 0.55 : 0.01, moveDur = 0.6;
      a.t += dt;
      let boltP: number, moveP: number;
      if (a.dir === 'out') {
        boltP = Math.min(1, a.t / boltDur);
        moveP = Math.max(0, Math.min(1, (a.t - boltDur) / moveDur));
      } else {
        moveP = 1 - Math.min(1, a.t / moveDur);
        boltP = 1 - Math.max(0, Math.min(1, (a.t - moveDur) / boltDur));
      }
      this.setPose(a.id, boltP, moveP);
      if (a.t >= boltDur + moveDur) {
        this.anims.delete(a.id);
        this.applyVisibility();
        this.updateLabel();
      }
    }
  }

  // ---------- Точки замера ----------
  private buildProbeMarkers(): void {
    const geo = new THREE.SphereGeometry(0.0042, 10, 8);
    const hitGeo = new THREE.SphereGeometry(0.009, 8, 6);
    for (const pp of probePoints) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true }));
      m.renderOrder = 10;
      const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.probeId = pp.id;
      m.add(hit);
      m.userData.probeId = pp.id;
      this.probeGroup.add(m);
      this.probeMeshes.set(pp.id, hit);
      hit.userData.marker = m;
    }
    this.updateProbeMarkers();
  }

  updateProbeMarkers(): void {
    const tmp = new THREE.Vector3();
    for (const pp of probePoints) {
      const hit = this.probeMeshes.get(pp.id)!;
      const m = hit.userData.marker as THREE.Mesh;
      const anchor = this.model.anchors.get(pp.id);
      const vis = this.probesOn && !!anchor && pp.visible() && this.visibleChain(anchor) && !this.anims.size;
      m.visible = vis;
      hit.visible = vis;
      if (anchor && vis) {
        anchor.getWorldPosition(tmp);
        m.position.copy(tmp);
      }
      const mat = m.material as THREE.MeshBasicMaterial;
      const isRed = this.leads.red === pp.id, isBlack = this.leads.black === pp.id;
      mat.color.setHex(isRed ? 0xff3344 : isBlack ? 0x1a1a1a : pp.ground ? 0x6b7a8f : 0xffd23f);
      m.scale.setScalar(isRed || isBlack ? 1.8 : 1);
    }
    for (const lead of ['red', 'black'] as ProbeLead[]) {
      const id = this.leads[lead];
      const lbl = this.leadLabels[lead];
      const anchor = id ? this.model.anchors.get(id) : null;
      const pp = id ? probePoints.find((p) => p.id === id) : null;
      if (this.probesOn && anchor && pp?.visible() && this.visibleChain(anchor)) {
        anchor.getWorldPosition(lbl.position);
        lbl.visible = true;
      } else lbl.visible = false;
    }
  }

  // ---------- Кинематика двигателя ----------
  private stepKinematics(dt: number): void {
    const k = this.model.kin;
    const rpm = sim.rpmVisual;
    this.crankDeg = (this.crankDeg + rpm * 6 * dt * this.slow) % 720;
    const ca = this.crankDeg;
    const th = (ca * Math.PI) / 180;
    k.crank.rotation.x = th;
    const phase = [0, Math.PI, Math.PI, 0];
    const pin = new THREE.Vector3(), top = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      const a = th + phase[i];
      const s = Math.sin(a), c = Math.cos(a);
      const y = CRANK_R * c + Math.sqrt(ROD_L * ROD_L - CRANK_R * CRANK_R * s * s);
      k.pistons[i].position.y = y;
      pin.set(CX[i], CRANK_R * c, CRANK_R * s);
      top.set(CX[i], y, 0);
      orientBetween(k.rods[i], pin, top);
      // Фазы
      const loc = (((ca - FIRE_OFFSET[i]) % 720) + 720) % 720;
      const glow = k.glows[i].material as THREE.MeshBasicMaterial;
      const fireOk = sim.running && sim.cylOk[i];
      glow.opacity = fireOk && loc < 70 ? (1 - loc / 70) * 0.85 * (this.xray || this.cut ? 1 : 0.0) : 0;
      const sp = k.sparks[i].material as THREE.MeshBasicMaterial;
      const sparkWin = loc > 712 || loc < 6;
      sp.opacity = sparkWin && (sim.running || sim.cranking) && sim.sparkOk[i] ? 1 : 0;
    }
    // Клапаны
    const lift = (loc: number, a: number, b: number) => {
      let x = loc;
      if (x < a - 100) x += 720;
      if (x < a || x > b) return 0;
      return Math.sin((Math.PI * (x - a)) / (b - a)) * 0.0085;
    };
    for (const vv of k.valves) {
      const loc = (((ca - FIRE_OFFSET[vv.cyl]) % 720) + 720) % 720;
      const adv = vv.intake ? sim.vvtInA : sim.vvtExA;
      const l = vv.intake ? lift(loc, 340 - adv, 590 - adv) : lift(loc, 140 + adv, 380 + adv);
      vv.obj.position.y = vv.y0 - l;
    }
    k.camIn.rotation.x = -th / 2 - (sim.vvtInA * Math.PI) / 360;
    k.camEx.rotation.x = -th / 2 + (sim.vvtExA * Math.PI) / 360;
    // Шкивы
    for (const s of k.spinners) s.obj.rotation.x = th * s.ratio;
    if (k.belt) k.belt.tex.offset.x = -((th * k.belt.speedRatio) / k.belt.length) * k.belt.tex.repeat.x;
    if (k.chain) k.chain.tex.offset.x = -((th * k.chain.speedRatio) / k.chain.length) * k.chain.tex.repeat.x;
    if (k.fan) {
      const target = sim.fanOn ? 1 : 0;
      k.fan.userData.speed = (k.fan.userData.speed ?? 0) + (target - (k.fan.userData.speed ?? 0)) * Math.min(1, dt * 1.5);
      k.fan.rotation.z += k.fan.userData.speed * dt * 40 * Math.max(0.15, this.slow);
    }
  }

  private frame(): void {
    const real = this.clock.getDelta();
    const dt = Math.min(real, 0.1);
    this.stepAnims(Math.min(real, 0.3));
    this.stepKinematics(dt);
    if (this.camAnim) {
      const a = this.camAnim;
      a.t = Math.min(1, a.t + dt * 1.8);
      const e = 1 - Math.pow(1 - a.t, 3);
      this.camera.position.lerpVectors(a.from, a.to, e);
      this.controls.target.lerpVectors(a.tFrom, a.tTo, e);
      if (a.t >= 1) this.camAnim = null;
    }
    this.controls.update();
    if (this.probesOn) this.updateProbeMarkers();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  setProbes(on: boolean): void {
    this.probesOn = on;
    this.updateProbeMarkers();
  }
}

export type { PartObj, ProbePoint };
