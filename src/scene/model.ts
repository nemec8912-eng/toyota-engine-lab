// Процедурная 3D-модель двигателя 1ZR-FE и моторного отсека Corolla E150 (v2.1 — детализированная).
// Оси: X — поперёк машины (+X — правая сторона, где привод ГРМ), Y — вверх, Z — вперёд (к радиатору).
// Единицы — метры. Ось коленвала — в начале координат.
import * as THREE from 'three';
import {
  M, box, cyl, sphere, torus, tube, corrugated, rod, boltMesh, plateXZ, roundRect, hullPath, stripeTexture, finTexture, labelPlane, v, V3, Circle2,
  lathe, pulleyProfile, sweep, hose, ribbonLoop, extrudeX, corrugatedSheet, beltTexture, bladeShape,
} from './geo';

/** X-координаты цилиндров 1..4 (у Toyota №1 — со стороны ГРМ). */
export const CX = [0.132, 0.044, -0.044, -0.132];
/** Смещение такта по цилиндрам (в градусах цикла 720°), порядок работы 1-3-4-2. */
export const FIRE_OFFSET = [0, 540, 180, 360];
export const CRANK_R = 0.03925;
export const ROD_L = 0.1355;

export interface PartObj {
  id: string;
  group: THREE.Group;
  bolts: THREE.Object3D[];
  removeDir: THREE.Vector3;
  mats: THREE.MeshStandardMaterial[];
  meshes: THREE.Mesh[];
  baseOpacity: number[];
  home: THREE.Vector3;
}

export interface Spinner { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; ratio: number; when?: 'engine' | 'fan' }

export interface Kin {
  crank: THREE.Group;
  pistons: THREE.Object3D[];
  rods: THREE.Mesh[];
  camIn: THREE.Group;
  camEx: THREE.Group;
  valves: { obj: THREE.Object3D; y0: number; cyl: number; intake: boolean }[];
  spinners: Spinner[];
  belt?: { tex: THREE.Texture; length: number; speedRatio: number };
  chain?: { tex: THREE.Texture; length: number; speedRatio: number };
  glows: THREE.Mesh[];
  sparks: THREE.Mesh[];
  fan: THREE.Object3D | null;
}

class PartBuilder {
  group = new THREE.Group();
  bolts: THREE.Object3D[] = [];
  constructor(public id: string, public removeDir: THREE.Vector3, private model: EngineModel) {
    this.group.name = id;
  }
  add(...objs: THREE.Object3D[]): this { this.group.add(...objs); return this; }
  /** Болт в точке pos, выкручивается вдоль dir. */
  bolt(pos: V3, dir: V3 = [0, 1, 0], size = 0.0055): this {
    const b = boltMesh(size);
    b.position.set(...pos);
    b.quaternion.setFromUnitVectors(v(0, 1, 0), v(...dir).normalize());
    b.userData.dir = v(...dir).normalize();
    this.group.add(b);
    this.bolts.push(b);
    return this;
  }
  anchor(name: string, pos: V3): this {
    const o = new THREE.Object3D();
    o.position.set(...pos);
    o.name = `${this.id}:${name}`;
    this.group.add(o);
    this.model.anchors.set(o.name, o);
    return this;
  }
  /** Ряд контактов разъёма вдоль оси. */
  pins(names: string[], origin: V3, along: V3 = [1, 0, 0], step = 0.008): this {
    const n = names.length;
    names.forEach((nm, i) => {
      const k = (i - (n - 1) / 2) * step;
      this.anchor(nm, [origin[0] + along[0] * k, origin[1] + along[1] * k, origin[2] + along[2] * k]);
    });
    return this;
  }
}

/** Корпус разъёма с защёлкой. dir — куда смотрит разъём. */
function connector(w: number, h: number, d: number, pos: V3, mat = M.connectorDark): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w, h, d, mat, [0, 0, 0], Math.min(w, h, d) * 0.2));
  g.add(box(w * 0.45, h * 0.18, d * 0.6, mat, [0, h * 0.55, 0], 0.0006));
  g.position.set(...pos);
  return g;
}

/** Полуцилиндр-противовес вдоль оси X (сегмент против шатунной шейки). */
function counterweight(r: number, w: number, mat: THREE.Material, x: number, down: boolean): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r, r, w, 20, 1, false, 0, Math.PI);
  g.rotateZ(-Math.PI / 2); // ось вдоль X, полудиск вниз
  if (!down) g.rotateX(Math.PI);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, 0, 0);
  return m;
}

export class EngineModel {
  root = new THREE.Group();
  parts = new Map<string, PartObj>();
  anchors = new Map<string, THREE.Object3D>();
  kin!: Kin;
  private builders: PartBuilder[] = [];

  constructor() {
    this.build();
    this.finalize();
  }

  private P(id: string, dir: V3 = [0, 1, 0]): PartBuilder {
    const b = new PartBuilder(id, v(...dir).normalize(), this);
    this.builders.push(b);
    return b;
  }
  private B(id: string): PartBuilder { return this.builders.find((b) => b.id === id)!; }

  private finalize(): void {
    for (const b of this.builders) {
      const mats: THREE.MeshStandardMaterial[] = [];
      const meshes: THREE.Mesh[] = [];
      const base: number[] = [];
      b.group.traverse((o) => {
        o.userData.partId = b.id;
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const src = mesh.material as THREE.MeshStandardMaterial;
          const m = src.clone();
          mesh.material = m;
          if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            mats.push(m);
            meshes.push(mesh);
            base.push(m.opacity);
            mesh.castShadow = !mesh.userData.noShadow;
            mesh.receiveShadow = true;
          }
        }
      });
      this.root.add(b.group);
      this.parts.set(b.id, { id: b.id, group: b.group, bolts: b.bolts, removeDir: b.removeDir, mats, meshes, baseOpacity: base, home: b.group.position.clone() });
    }
  }

  private build(): void {
    const kin: Kin = {
      crank: new THREE.Group(), pistons: [], rods: [], camIn: new THREE.Group(), camEx: new THREE.Group(),
      valves: [], spinners: [], glows: [], sparks: [], fan: null,
    };
    this.kin = kin;
    this.buildBay();
    this.buildBlock(kin);
    this.buildHeadAndTop(kin);
    this.buildTiming(kin);
    this.buildAccessory(kin);
    this.buildIntake();
    this.buildExhaust();
    this.buildCooling(kin);
    this.buildLube();
    this.buildElectric();
  }

  // ================= Кузов и трансмиссия =================
  private buildBay(): void {
    const bay = this.P('bay');
    // Лонжероны (профиль с рёбрами)
    for (const s of [-1, 1]) {
      bay.add(box(0.09, 0.12, 1.3, M.bodyInner, [s * 0.66, -0.16, 0.05], 0.012));
      bay.add(box(0.1, 0.012, 1.3, M.bodyInner, [s * 0.66, -0.095, 0.05], 0.004));
    }
    // Брызговики с опорами стоек (становятся прозрачными, когда камера за ними)
    const tagFrom = bay.group.children.length;
    for (const s of [-1, 1]) {
      const from = bay.group.children.length;
      const fender = extrudeX([[-0.45, -0.1], [0.5, -0.1], [0.5, 0.44], [0.12, 0.47], [-0.45, 0.47]], s * 0.74 - 0.025, s * 0.74 + 0.025, M.body, 0.006);
      bay.add(fender);
      // стаканы стоек
      bay.add(lathe([[0.125, 0], [0.125, 0.06], [0.115, 0.12], [0.06, 0.13], [0.045, 0.14], [0, 0.14]], M.body, [s * 0.665, 0.37, -0.18], 'y', 36));
      bay.add(cyl(0.032, 0.025, M.darkSteel, [s * 0.665, 0.52, -0.18], 'y', 6));
      bay.add(cyl(0.012, 0.02, M.steel, [s * 0.665, 0.537, -0.18], 'y', 6));
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.3;
        bay.add(cyl(0.007, 0.012, M.steel, [s * 0.665 + Math.cos(a) * 0.075, 0.512, -0.18 + Math.sin(a) * 0.075], 'y', 6));
      }
      bay.add(box(0.06, 0.06, 0.95, M.body, [s * 0.765, 0.45, 0.02], 0.015));
      for (let k = from; k < bay.group.children.length; k++) bay.group.children[k].userData.fade = s > 0 ? '+x' : '-x';
    }
    void tagFrom;
    // Моторный щит с шумоизоляцией
    let from = bay.group.children.length;
    bay.add(box(1.5, 0.75, 0.03, M.body, [0, 0.2, -0.5], 0.01));
    bay.add(box(1.1, 0.42, 0.012, M.rubber, [0, 0.12, -0.482], 0.004));
    bay.add(box(1.5, 0.08, 0.2, M.plastic, [0, 0.55, -0.56], 0.02)); // жабо
    for (let k = -6; k <= 6; k++) bay.add(box(0.06, 0.004, 0.12, M.plasticGray, [k * 0.1, 0.592, -0.56]));
    for (let k = from; k < bay.group.children.length; k++) bay.group.children[k].userData.fade = '-z';
    // Рамка радиатора
    from = bay.group.children.length;
    bay.add(box(1.46, 0.05, 0.07, M.bodyInner, [0, 0.49, 0.58], 0.012), box(1.4, 0.05, 0.06, M.bodyInner, [0, -0.06, 0.58], 0.012));
    bay.add(box(0.05, 0.55, 0.05, M.bodyInner, [-0.42, 0.22, 0.58], 0.008), box(0.05, 0.55, 0.05, M.bodyInner, [0.42, 0.22, 0.58], 0.008));
    bay.add(box(0.06, 0.05, 0.04, M.darkSteel, [0, 0.47, 0.6], 0.006)); // замок капота
    bay.add(box(0.012, 0.012, 0.03, M.yellow, [0.05, 0.5, 0.6]));
    for (let k = from; k < bay.group.children.length; k++) bay.group.children[k].userData.fade = '+z';
    // Подрамник
    bay.add(box(1.25, 0.05, 0.12, M.darkSteel, [0, -0.25, -0.15], 0.012));
    // Опоры двигателя
    bay.add(box(0.36, 0.035, 0.09, M.darkSteel, [0.5, 0.36, 0.0], 0.008), lathe([[0, -0.03], [0.045, -0.03], [0.045, 0.03], [0, 0.03]], M.rubber, [0.66, 0.36, 0.0], 'x', 24));
    bay.add(box(0.2, 0.035, 0.09, M.darkSteel, [-0.6, 0.25, -0.03], 0.008));
    for (const x of [0.38, 0.6]) bay.add(cyl(0.008, 0.01, M.steel, [x, 0.38, 0.0], 'y', 6));
    // Масса на брызговике
    bay.anchor('gnd', [-0.715, 0.38, 0.28]);
    bay.add(cyl(0.008, 0.008, M.steel, [-0.712, 0.38, 0.28], 'x', 6));
    bay.add(box(0.004, 0.016, 0.012, M.copper, [-0.712, 0.38, 0.28]));

    const tr = this.P('transmission');
    { const lm = lathe([[0.155, 0], [0.175, 0.01], [0.178, 0.03], [0.165, 0.07], [0.13, 0.13], [0.11, 0.16], [0, 0.16]], M.castAlu, [-0.24, 0.02, -0.02], 'x', 40); lm.rotation.set(0, 0, Math.PI / 2); tr.add(lm); }
    tr.add(box(0.26, 0.26, 0.24, M.castAlu, [-0.48, -0.02, -0.05], 0.045));
    for (let k = 0; k < 5; k++) tr.add(box(0.008, 0.22, 0.24, M.castAlu, [-0.39 - k * 0.04, -0.02, -0.05], 0.004));
    tr.add(lathe([[0.09, 0], [0.095, 0.02], [0.09, 0.12], [0.06, 0.14], [0, 0.14]], M.castAlu, [-0.48, 0.04, 0.05], 'z', 32));
    tr.add(cyl(0.028, 0.4, M.darkSteel, [-0.45, -0.08, 0.1], 'x', 12));
    tr.add(lathe([[0.03, 0], [0.045, 0.02], [0.045, 0.06], [0.03, 0.08]], M.rubber, [-0.66, -0.08, 0.1], 'x', 20));
    for (let i = 0; i < 10; i++) tr.add(cyl(0.0065, 0.012, M.steel, [-0.235, 0.17 * Math.cos((i * Math.PI) / 5) + 0.02, 0.17 * Math.sin((i * Math.PI) / 5) - 0.02], 'x', 6));
  }

  // ================= Блок, КШМ =================
  private buildBlock(kin: Kin): void {
    const bl = this.P('block');
    // Отливка блока: профиль (Z,Y) с юбкой, выдавленный вдоль коленвала
    const prof: [number, number][] = [[-0.124, 0.215], [0.124, 0.215], [0.124, 0.16], [0.116, 0.07], [0.13, 0.01], [0.13, -0.047], [-0.13, -0.047], [-0.13, 0.01], [-0.116, 0.07], [-0.124, 0.16]];
    const shell = extrudeX(prof, -0.236, 0.236, M.castAlu, 0.006);
    shell.userData.shell = true;
    bl.add(shell);
    // Рубашка охлаждения — приливы цилиндров, рёбра жёсткости
    for (const z of [-1, 1]) {
      for (const x of CX) bl.add(cyl(0.043, 0.13, M.castAlu, [x, 0.145, z * 0.108], 'y', 24));
      for (const x of [-0.2, -0.088, 0, 0.088, 0.2]) bl.add(box(0.009, 0.06, 0.012, M.castAlu, [x, -0.015, z * 0.131], 0.003));
      bl.add(box(0.47, 0.012, 0.012, M.castAlu, [0, 0.2, z * 0.127], 0.004));
      bl.add(box(0.47, 0.01, 0.01, M.castAlu, [0, 0.015, z * 0.132], 0.003));
    }
    // Нижний картер (лестничная рама)
    bl.add(box(0.465, 0.05, 0.25, M.castAlu, [0, -0.072, 0], 0.008));
    for (const x of [-0.18, -0.06, 0.06, 0.18]) bl.add(box(0.012, 0.045, 0.254, M.castAlu, [x, -0.072, 0], 0.003));
    // Прилив опоры двигателя справа
    bl.add(box(0.02, 0.06, 0.08, M.castAlu, [0.24, 0.17, -0.06], 0.006));
    // Гильзы (видны в рентгене; в разрезе прячутся)
    for (const x of CX) {
      const liner = cyl(0.0405, 0.16, M.darkSteel, [x, 0.135, 0], 'y', 28, undefined, true);
      liner.userData.liner = true;
      bl.add(liner);
    }
    // Трубка щупа
    bl.add(sweep([[-0.205, 0.0, 0.125], [-0.207, 0.2, 0.15], [-0.212, 0.42, 0.16]], () => 0.006, M.darkSteel, 30, 8));
    bl.add(cyl(0.008, 0.015, M.darkSteel, [-0.212, 0.42, 0.16], 'y', 12));
    bl.anchor('gnd', [-0.236, 0.15, -0.08]);
    bl.add(cyl(0.007, 0.01, M.steel, [-0.236, 0.15, -0.08], 'x', 6));
    bl.add(box(0.004, 0.02, 0.014, M.copper, [-0.24, 0.15, -0.08]));

    // Коленвал: коренные шейки, щёки, противовесы-полудиски, шатунные шейки
    const cr = kin.crank;
    cr.add(cyl(0.022, 0.52, M.steel, [0.015, 0, 0], 'x', 22));
    const phase = [0, Math.PI, Math.PI, 0];
    for (let i = 0; i < 4; i++) {
      const up = Math.cos(phase[i]) > 0;
      const y = (up ? 1 : -1) * CRANK_R;
      for (const dx of [-0.028, 0.028]) {
        cr.add(box(0.013, 0.07, 0.05, M.darkSteel, [CX[i] + dx, y * 0.5, 0], 0.012));
        cr.add(counterweight(0.058, 0.014, M.darkSteel, CX[i] + dx, up));
      }
      cr.add(cyl(0.0195, 0.043, M.steel, [CX[i], y, 0], 'x', 18));
    }
    cr.add(lathe([[0.03, 0], [0.03, 0.012], [0, 0.012]], M.darkSteel, [0.25, 0, 0], 'x', 24)); // звёздочка
    cr.add(lathe([[0.03, 0], [0.135, 0], [0.135, 0.012], [0.03, 0.012]], M.darkSteel, [-0.26, 0, 0], 'x', 48)); // маховик/диск
    const crankPart = this.P('crankshaft');
    crankPart.add(cr);
    // Поршни (юбка, канавки колец, днище с выборками) и шатуны
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Group();
      p.add(lathe([[0.037, -0.03], [0.0398, -0.024], [0.0398, 0.026], [0.039, 0.03], [0.033, 0.032], [0, 0.0335]], M.alu, [0, 0.0, 0], 'y', 32));
      for (const yy of [0.024, 0.018, 0.012]) p.add(torus(0.0399, 0.0011, M.darkSteel, [0, yy, 0], 'y'));
      for (const zz of [-0.014, 0.014]) p.add(cyl(0.012, 0.002, M.darkAlu, [0, 0.033, zz], 'y', 16));
      p.add(cyl(0.009, 0.062, M.steel, [0, -0.008, 0], 'x', 12));
      p.position.set(CX[i], ROD_L + CRANK_R, 0);
      crankPart.add(p);
      kin.pistons.push(p);
      const r = rod(v(CX[i], CRANK_R, 0), v(CX[i], ROD_L + CRANK_R, 0), 0.0075, M.steel, 8);
      (r.geometry as THREE.BufferGeometry).scale(1, 1, 1.6);
      crankPart.add(r);
      kin.rods.push(r);
      const glow = sphere(0.034, new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0, depthWrite: false }), [CX[i], 0.205, 0]);
      glow.userData.noPick = true;
      crankPart.add(glow);
      kin.glows.push(glow);
    }
  }

  // ================= ГБЦ, клапанная крышка, катушки, свечи =================
  private buildHeadAndTop(kin: Kin): void {
    const hd = this.P('head');
    const prof: [number, number][] = [[-0.12, 0.221], [0.12, 0.221], [0.124, 0.24], [0.124, 0.3], [0.116, 0.336], [-0.116, 0.336], [-0.124, 0.3], [-0.124, 0.24]];
    const head = extrudeX(prof, -0.236, 0.236, M.castAlu, 0.005);
    head.userData.shell = true;
    hd.add(head);
    hd.add(box(0.472, 0.008, 0.252, M.darkSteel, [0, 0.217, 0], 0.002)); // прокладка ГБЦ
    // фланцы впуска и выпуска
    hd.add(box(0.44, 0.06, 0.01, M.castAlu, [0, 0.287, 0.126], 0.004));
    hd.add(box(0.44, 0.05, 0.01, M.castAlu, [0, 0.282, -0.126], 0.004));
    for (const x of CX) for (const z of [-1, 1]) hd.add(cyl(0.018, 0.012, M.castAlu, [x, 0.282, z * 0.128], 'z', 16));
    // Выходной патрубок ОЖ на левом торце
    hd.add(box(0.05, 0.05, 0.06, M.castAlu, [-0.26, 0.3, 0.0], 0.01));
    hd.add(lathe([[0.017, 0], [0.019, 0.006], [0.017, 0.012], [0.017, 0.035]], M.castAlu, [-0.27, 0.3, 0.025], 'z', 20));
    // Постели распредвалов (видны в рентгене)
    for (const x of [-0.2, -0.088, 0, 0.088, 0.2]) for (const z of [-0.06, 0.06]) {
      const cap = box(0.018, 0.016, 0.034, M.castAlu, [x, 0.343, z], 0.003);
      cap.userData.internal = true;
      hd.add(cap);
    }
    // Клапаны
    for (let i = 0; i < 4; i++) {
      for (const intake of [true, false]) {
        for (const dx of [-0.016, 0.016]) {
          const g = new THREE.Group();
          const z = intake ? 0.03 : -0.03;
          g.add(lathe([[0, 0], [intake ? 0.015 : 0.013, 0], [intake ? 0.015 : 0.013, 0.0015], [0.004, 0.008], [0.0028, 0.012]], M.steel, [0, 0, 0], 'y', 16));
          g.add(cyl(0.0028, 0.1, M.steel, [0, 0.055, 0], 'y', 6));
          g.add(cyl(0.008, 0.03, M.darkSteel, [0, 0.085, 0], 'y', 10)); // пружина
          g.add(cyl(0.011, 0.012, M.darkAlu, [0, 0.11, 0], 'y', 14)); // толкатель
          const y0 = 0.219;
          g.traverse((o) => { o.userData.internal = true; });
          g.position.set(CX[i] + dx, y0, z);
          hd.add(g);
          kin.valves.push({ obj: g, y0, cyl: i, intake });
        }
      }
    }
    // Распредвалы с кулачками и муфтами VVT-i
    const mkCam = (g: THREE.Group, z: number, intake: boolean) => {
      g.position.set(0, 0.343, z);
      g.add(cyl(0.012, 0.47, M.steel, [0.0, 0, 0], 'x', 14));
      for (let i = 0; i < 4; i++) {
        const loc = FIRE_OFFSET[i] / 2 + (intake ? 230 : 130);
        for (const dx of [-0.016, 0.016]) {
          const lobe = new THREE.Mesh(new THREE.ExtrudeGeometry((() => {
            const s = new THREE.Shape();
            s.moveTo(-0.0155, 0);
            s.absarc(0, 0, 0.0155, Math.PI, Math.PI * 2, false);
            s.quadraticCurveTo(0.012, 0.016, 0, 0.024);
            s.quadraticCurveTo(-0.012, 0.016, -0.0155, 0);
            return s;
          })(), { depth: 0.01, bevelEnabled: false }), M.steel);
          lobe.geometry.translate(0, 0, -0.005);
          lobe.rotation.y = Math.PI / 2;
          lobe.position.set(CX[i] + dx, 0, 0);
          lobe.rotation.x = (-loc * Math.PI) / 180;
          g.add(lobe);
        }
      }
      g.add(lathe([[0.02, 0], [0.047, 0], [0.047, 0.006], [0.044, 0.008], [0.044, 0.016], [0.047, 0.018], [0.047, 0.024], [0.02, 0.024]], M.darkSteel, [0.238, 0, 0], 'x', 40));
      g.add(cyl(0.036, 0.012, M.castAlu, [0.232, 0, 0], 'x', 28));
      g.add(cyl(0.008, 0.006, M.steel, [0.264, 0, 0], 'x', 6));
    };
    mkCam(kin.camIn, 0.06, true);
    mkCam(kin.camEx, -0.06, false);
    this.P('cam_in', [0, 1, 0]).add(kin.camIn);
    this.P('cam_ex', [0, 1, 0]).add(kin.camEx);

    // Свечи
    for (let i = 0; i < 4; i++) {
      const p = this.P(`plug_${i + 1}`, [0, 1, 0]);
      p.add(lathe([[0, 0.335], [0.004, 0.335], [0.0055, 0.33], [0.0075, 0.322], [0.0075, 0.298], [0.006, 0.296]], M.ceramic, [CX[i], 0, 0], 'y', 16));
      for (const yy of [0.316, 0.31, 0.304]) p.add(torus(0.0076, 0.0008, M.ceramic, [CX[i], yy, 0], 'y'));
      p.add(cyl(0.009, 0.01, M.steel, [CX[i], 0.29, 0], 'y', 6));
      p.add(cyl(0.006, 0.025, M.steel, [CX[i], 0.272, 0], 'y', 12));
      const spark = sphere(0.007, new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0, depthWrite: false }), [CX[i], 0.222, 0], 10);
      spark.userData.noPick = true;
      spark.userData.noShadow = true;
      p.add(spark);
      kin.sparks.push(spark);
    }

    // Клапанная крышка: фланец + скруглённое тело с колодцами свечей и рёбрами
    const vc = this.P('valve_cover', [0, 1, 0]);
    const holes = CX.map((x) => ({ x, z: 0, r: 0.0145 }));
    const flange = plateXZ(roundRect(-0.234, -0.13, 0.234, 0.13, 0.02), holes, 0.006, M.blackPaint, 0.337, 0.002);
    flange.userData.shell = true;
    vc.add(flange);
    const body = plateXZ(roundRect(-0.222, -0.104, 0.222, 0.104, 0.035), holes.map((h0) => ({ ...h0, r: 0.017 })), 0.03, M.blackPaint, 0.348, 0.012);
    body.userData.shell = true;
    vc.add(body);
    for (const x of CX) vc.add(cyl(0.0175, 0.05, M.blackPaint, [x, 0.367, 0], 'y', 24, undefined, true));
    for (const x of CX) vc.add(torus(0.0185, 0.0025, M.blackPaint, [x, 0.392, 0], 'y'));
    // продольные и поперечные рёбра
    for (const z of [-0.06, 0.06]) vc.add(box(0.4, 0.007, 0.006, M.blackPaint, [0, 0.393, z], 0.002));
    for (const x of [-0.176, -0.088, 0, 0.088, 0.176]) for (const z of [-1, 1]) vc.add(box(0.006, 0.006, 0.05, M.blackPaint, [x, 0.392, z * 0.085], 0.002));
    // приливы болтов по периметру
    const vcb: [number, number][] = [[-0.215, -0.122], [-0.215, 0.122], [0.215, -0.122], [0.215, 0.122], [0, -0.124], [0, 0.124], [-0.11, -0.124], [0.11, 0.124]];
    for (const [x, z] of vcb) { vc.add(cyl(0.009, 0.01, M.blackPaint, [x, 0.346, z], 'y', 14)); vc.bolt([x, 0.351, z], [0, 1, 0], 0.005); }
    vc.add(lathe([[0, 0], [0.012, 0], [0.012, 0.012], [0.006, 0.016], [0.006, 0.026], [0, 0.026]], M.plastic, [0.08, 0.382, -0.08], 'y', 14)); // клапан PCV
    vc.add(lathe([[0.026, 0], [0.026, 0.012], [0.022, 0.016], [0, 0.016]], M.blackPaint, [-0.1, 0.38, -0.07], 'y', 28)); // горловина
    const plate = labelPlane('DUAL VVT-i', 0.12, 0.026, '#c9ced4', '#22252a', 'bold 70px sans-serif');
    plate.position.set(-0.05, 0.3935, 0.08);
    plate.rotation.x = -Math.PI / 2;
    vc.add(plate);

    // Крышка маслозаливной горловины
    const oc = this.P('oil_cap', [0, 1, 0]);
    oc.add(lathe([[0, 0], [0.025, 0], [0.026, 0.004], [0.026, 0.014], [0.022, 0.017], [0, 0.017]], M.plastic, [-0.1, 0.396, -0.07], 'y', 32));
    oc.add(box(0.036, 0.008, 0.008, M.plastic, [-0.1, 0.415, -0.07], 0.003));
    oc.add(labelPlane('OIL', 0.02, 0.01, '#18191c', '#e8812d', 'bold 160px sans-serif').translateY(0.4135).translateX(-0.1).translateZ(-0.058).rotateX(-Math.PI / 2));

    // Катушки (Denso): головка, разъём с защёлкой, ушко крепления, наконечник
    for (let i = 0; i < 4; i++) {
      const c = this.P(`coil_${i + 1}`, [0, 1, 0]);
      const x = CX[i];
      c.add(lathe([[0, 0.3], [0.0118, 0.3], [0.0128, 0.312], [0.0128, 0.33], [0.0108, 0.336], [0.0105, 0.43], [0.0135, 0.436], [0.0135, 0.446], [0, 0.446]], M.plastic, [x, 0, 0], 'y', 18));
      for (const yy of [0.316, 0.324]) c.add(torus(0.0129, 0.0012, M.rubber, [x, yy, 0], 'y'));
      c.add(box(0.044, 0.032, 0.054, M.plastic, [x, 0.462, -0.004], 0.008));
      c.add(box(0.034, 0.006, 0.044, M.plasticGray, [x, 0.479, -0.004], 0.003));
      c.add(box(0.022, 0.006, 0.026, M.plastic, [x + 0.03, 0.448, 0.0], 0.002));
      c.add(cyl(0.007, 0.004, M.steel, [x + 0.034, 0.447, 0], 'y', 12)); // втулка
      c.bolt([x + 0.034, 0.452, 0.0], [0, 1, 0], 0.0045);
      c.add(connector(0.022, 0.018, 0.02, [x, 0.462, -0.038]));
      c.pins(['B', 'IGT', 'GND'], [x, 0.462, -0.049], [1, 0, 0], 0.007);
    }

    // Декоративная крышка (скруглённая, с рёбрами и шильдиком)
    const ec = this.P('engine_cover', [0, 1, 0]);
    const outline: [number, number][] = [];
    const ow = 0.225, od = 0.105;
    for (let k = 0; k <= 40; k++) {
      const t = (k / 40) * Math.PI * 2;
      const cx = Math.cos(t), cz = Math.sin(t);
      outline.push([Math.sign(cx) * Math.pow(Math.abs(cx), 0.25) * ow, Math.sign(cz) * Math.pow(Math.abs(cz), 0.35) * od + 0.005]);
    }
    const cov = plateXZ(outline, [], 0.018, M.plastic, 0.49, 0.01);
    cov.userData.shell = true;
    ec.add(cov);
    const center = plateXZ(roundRect(-0.13, -0.05, 0.13, 0.06, 0.03), [], 0.006, M.plasticGray, 0.512, 0.004);
    ec.add(center);
    for (let k = -4; k <= 4; k++) if (Math.abs(k) > 1) ec.add(box(0.006, 0.006, 0.13, M.plastic, [k * 0.044, 0.514, 0.005], 0.002));
    const badge = labelPlane('1ZR-FE   DUAL VVT-i', 0.2, 0.028, '#9aa0a6', '#18191c', 'bold 54px sans-serif');
    badge.position.set(0, 0.5235, 0.005);
    badge.rotation.x = -Math.PI / 2;
    ec.add(badge);
    for (const x of [-0.19, 0.19]) ec.add(lathe([[0, 0], [0.008, 0], [0.008, 0.08], [0.011, 0.085], [0.011, 0.095], [0, 0.095]], M.rubber, [x, 0.395, 0.0], 'y', 14));
    ec.bolt([-0.19, 0.515, 0.0]).bolt([0.19, 0.515, 0.0]);

    // OCV
    for (const [id, z] of [['ocv_in', 0.085], ['ocv_ex', -0.085]] as [string, number][]) {
      const o = this.P(id, [0, 1, 0]);
      o.add(lathe([[0, 0], [0.012, 0], [0.013, 0.004], [0.013, 0.04], [0.011, 0.046], [0, 0.046]], M.plastic, [0.205, 0.38, z], 'y', 20));
      o.add(connector(0.018, 0.014, 0.022, [0.205, 0.43, z + Math.sign(z) * 0.018]));
      o.add(box(0.032, 0.005, 0.016, M.darkSteel, [0.222, 0.385, z], 0.002));
      o.bolt([0.234, 0.39, z], [0, 1, 0], 0.0042);
      o.pins(['+', '-'], [0.205, 0.43, z + Math.sign(z) * 0.03], [1, 0, 0], 0.008);
    }

    // Шланг PCV
    const pcv = this.P('pcv_hose', [0, 1, 0.3]);
    pcv.add(hose([[0.08, 0.405, -0.08], [0.088, 0.43, 0.02], [0.088, 0.41, 0.17], [0.09, 0.34, 0.27]], 0.007, M.rubber, M.steel));
  }

  // ================= Привод ГРМ =================
  private buildTiming(kin: Kin): void {
    const XC = 0.25;
    const circles: Circle2[] = [
      { u: 0, v: 0, r: 0.032 },
      { u: 0.06, v: 0.343, r: 0.049 },
      { u: -0.06, v: 0.343, r: 0.049 },
      { u: -0.058, v: 0.12, r: 0.012 },
    ];
    const pts = hullPath(circles, 16).map(([u, vv]) => v(XC, vv, u));
    const tex = stripeTexture('chain');
    tex.repeat.set(1 / 0.016, 1);
    const ch = ribbonLoop(pts, 0.009, 0.007, new THREE.MeshStandardMaterial({ map: tex, metalness: 0.8, roughness: 0.35 }));
    const chain = this.P('chain', [1, 0, 0]);
    chain.add(ch.mesh);
    // Башмаки цепи (изогнутые)
    chain.add(sweep([[XC, 0.04, -0.072], [XC, 0.18, -0.083], [XC, 0.3, -0.1]], () => 0.007, M.plasticGray, 20, 8));
    chain.add(sweep([[XC, 0.05, 0.06], [XC, 0.18, 0.064], [XC, 0.29, 0.1]], () => 0.007, M.plasticGray, 20, 8));
    kin.chain = { tex, length: 1, speedRatio: 0.032 };

    const tn = this.P('chain_tensioner', [0, 0, -1]);
    tn.add(lathe([[0, 0], [0.011, 0], [0.011, 0.045], [0.007, 0.05], [0, 0.05]], M.darkAlu, [XC - 0.005, 0.13, -0.075], 'z', 16).rotateX(Math.PI));
    tn.add(box(0.032, 0.03, 0.012, M.darkAlu, [XC - 0.005, 0.13, -0.122], 0.003));
    tn.bolt([XC + 0.006, 0.145, -0.128], [0, 0, -1], 0.004).bolt([XC + 0.006, 0.115, -0.128], [0, 0, -1], 0.004);

    // Крышка цепи — литая, по контуру привода
    const tc = this.P('timing_cover', [1, 0, 0]);
    const tprof: [number, number][] = [[-0.124, -0.06], [0.124, -0.06], [0.128, 0.05], [0.118, 0.29], [0.1, 0.39], [0.06, 0.405], [-0.06, 0.405], [-0.1, 0.39], [-0.118, 0.29], [-0.128, 0.05]];
    const cover = extrudeX(tprof, 0.262, 0.286, M.castAlu, 0.005);
    cover.userData.shell = true;
    tc.add(cover);
    tc.add(lathe([[0, 0], [0.04, 0], [0.04, 0.008], [0.03, 0.012], [0, 0.012]], M.castAlu, [0.286, 0.0, 0], 'x', 28)); // сальник
    tc.add(lathe([[0.018, 0], [0.026, 0], [0.026, 0.004], [0.018, 0.004]], M.rubber, [0.298, 0.0, 0], 'x', 24));
    for (const z of [-0.06, 0.06]) tc.add(cyl(0.05, 0.01, M.castAlu, [0.289, 0.343, z], 'x', 32));
    for (const [y, z] of [[-0.03, 0.11], [-0.03, -0.11], [0.1, 0.12], [0.1, -0.12], [0.25, 0.115], [0.25, -0.115], [0.37, 0.09], [0.37, -0.09]] as [number, number][]) {
      tc.add(cyl(0.008, 0.006, M.castAlu, [0.289, y, z], 'x', 12));
      tc.bolt([0.29, y, z], [1, 0, 0]);
    }
  }

  // ================= Навесное: ремень, шкивы, генератор, компрессор, стартер =================
  private buildAccessory(kin: Kin): void {
    const XB = 0.302;
    const P = {
      crank: { u: 0, v: 0, r: 0.07 },
      ac: { u: 0.22, v: -0.035, r: 0.055 },
      tens: { u: 0.265, v: 0.1, r: 0.033 },
      alt: { u: 0.22, v: 0.255, r: 0.03 },
      idler: { u: 0.1, v: 0.315, r: 0.03 },
      pump: { u: 0.015, v: 0.2, r: 0.055 },
    };
    const W = 0.024;
    /** Поликлиновой шкив (с ручьями) или гладкий ролик. */
    const pulley = (r: number, ribs = true, spokes = 0): THREE.Group => {
      const g = new THREE.Group();
      if (ribs) g.add(lathe(pulleyProfile(r, W, 7), M.darkSteel, [0, 0, 0], 'x', 48));
      else g.add(lathe([[r * 0.4, -W / 2], [r, -W / 2], [r + 0.002, -W / 2 + 0.002], [r + 0.002, W / 2 - 0.002], [r, W / 2], [r * 0.4, W / 2]], M.steel, [0, 0, 0], 'x', 40));
      g.add(lathe([[0, -W / 2 - 0.003], [r * 0.32, -W / 2 - 0.003], [r * 0.32, W / 2 + 0.003], [0, W / 2 + 0.003]], M.steel, [0, 0, 0], 'x', 24));
      for (let k = 0; k < spokes; k++) {
        const a = (k / spokes) * Math.PI * 2;
        g.add(cyl(r * 0.12, 0.004, M.plastic, [W / 2 + 0.001, Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6], 'x', 12));
      }
      return g;
    };
    const mount = (b: PartBuilder, g: THREE.Group, c: { u: number; v: number; r: number }, ratio: number) => {
      g.position.set(XB, c.v, c.u);
      b.add(g);
      kin.spinners.push({ obj: g, axis: 'x', ratio });
    };

    // Шкив коленвала — демпфер с резиновым кольцом
    const cp = this.P('crank_pulley', [1, 0, 0]);
    const cpg = pulley(P.crank.r, true, 0);
    cpg.add(lathe([[P.crank.r * 0.55, -0.003], [P.crank.r * 0.62, -0.003], [P.crank.r * 0.62, 0.003], [P.crank.r * 0.55, 0.003]], M.rubber, [0.0, 0, 0], 'x', 40));
    for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2 + 0.4; cpg.add(cyl(0.008, 0.026, M.plastic, [0.0, Math.cos(a) * 0.035, Math.sin(a) * 0.035], 'x', 12)); }
    cpg.add(box(0.004, 0.012, 0.004, M.yellow, [0.013, P.crank.r - 0.006, 0])); // метка ВМТ
    const cbolt = boltMesh(0.009);
    cbolt.rotateZ(-Math.PI / 2);
    cbolt.translateY(0.015);
    cbolt.userData.dir = v(1, 0, 0);
    cpg.add(cbolt);
    mount(cp, cpg, P.crank, 1);
    cp.bolts.push(cbolt);

    // Ремень — плоская лента с продольными рёбрами
    const pts = hullPath([P.crank, P.ac, P.tens, P.alt, P.idler, P.pump], 18).map(([u, vv]) => v(XB, vv, u));
    const btex = beltTexture();
    btex.repeat.set(1 / 0.09, 1);
    const bl = ribbonLoop(pts, 0.021, 0.0045, new THREE.MeshStandardMaterial({ map: btex, roughness: 0.85, metalness: 0.0 }));
    const belt = this.P('drive_belt', [1, 0, 0]);
    belt.add(bl.mesh);
    kin.belt = { tex: btex, length: 1, speedRatio: P.crank.r };

    // Натяжитель и обводной ролик
    const tn = this.P('belt_tensioner', [1, 0, 0]);
    tn.add(lathe([[0, 0], [0.026, 0], [0.026, 0.035], [0, 0.035]], M.castAlu, [XB - 0.05, P.tens.v - 0.045, P.tens.u - 0.03], 'x', 24));
    tn.add(box(0.012, 0.07, 0.025, M.castAlu, [XB - 0.012, P.tens.v - 0.03, P.tens.u - 0.015], 0.006));
    mount(tn, pulley(P.tens.r, false), P.tens, P.crank.r / P.tens.r);
    tn.bolt([XB + 0.015, P.tens.v, P.tens.u], [1, 0, 0]);
    const id = this.P('idler', [1, 0, 0]);
    mount(id, pulley(P.idler.r, false), P.idler, P.crank.r / P.idler.r);
    id.add(box(0.012, 0.04, 0.03, M.castAlu, [XB - 0.02, P.idler.v - 0.02, P.idler.u], 0.005));
    id.bolt([XB + 0.015, P.idler.v, P.idler.u], [1, 0, 0]);

    // Помпа
    const wp = this.P('water_pump', [1, 0, 0]);
    wp.add(lathe([[0, 0], [0.052, 0], [0.052, 0.012], [0.035, 0.022], [0.02, 0.03], [0, 0.03]], M.castAlu, [0.272, P.pump.v, P.pump.u], 'x', 32));
    mount(wp, pulley(P.pump.r, true, 5), P.pump, P.crank.r / P.pump.r);
    for (const a of [0.6, 2.2, 3.8, 5.2]) wp.bolt([0.288, P.pump.v + Math.cos(a) * 0.046, P.pump.u + Math.sin(a) * 0.046], [1, 0, 0], 0.004);

    // Генератор: передняя крышка с вентиляцией, статор, задняя крышка, вентилятор
    const al = this.P('alternator', [0.3, 0.6, 0.6]);
    const ab = new THREE.Group();
    ab.add(lathe([[0.045, -0.075], [0.058, -0.072], [0.062, -0.06], [0.064, -0.035], [0.067, -0.032], [0.067, 0.01], [0.064, 0.013], [0.064, 0.04], [0.058, 0.05], [0.03, 0.055], [0.03, 0.062], [0, 0.062]], M.alu, [0, 0, 0], 'x', 40));
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      const slot = box(0.026, 0.0025, 0.008, M.darkAlu, [-0.012, Math.cos(a) * 0.0662, Math.sin(a) * 0.0662]);
      slot.rotation.x = a;
      ab.add(slot);
    }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const vent = box(0.003, 0.014, 0.006, M.darkSteel, [0.052, Math.cos(a) * 0.044, Math.sin(a) * 0.044]);
      vent.rotation.x = a;
      ab.add(vent);
    }
    ab.add(lathe([[0, 0], [0.04, 0], [0.04, 0.012], [0, 0.012]], M.plastic, [-0.088, 0, 0], 'x', 24)); // задняя крышка
    ab.position.set(0.225, P.alt.v, P.alt.u);
    al.add(ab);
    // ушки крепления
    al.add(box(0.02, 0.035, 0.025, M.castAlu, [0.29, P.alt.v - 0.06, P.alt.u], 0.006), box(0.02, 0.035, 0.025, M.castAlu, [0.16, P.alt.v - 0.06, P.alt.u - 0.02], 0.006));
    const af = new THREE.Group();
    af.add(lathe([[0.02, 0], [0.056, 0], [0.056, 0.002], [0.02, 0.002]], M.darkSteel, [0, 0, 0], 'x', 32));
    for (let k = 0; k < 12; k++) { const b = box(0.008, 0.018, 0.0018, M.darkSteel, [0.005, 0.045, 0]); const piv = new THREE.Group(); piv.add(b); piv.rotation.x = (k / 12) * Math.PI * 2; af.add(piv); }
    const altPulley = pulley(P.alt.r);
    altPulley.add(af);
    af.position.x = -0.017;
    mount(al, altPulley, P.alt, P.crank.r / P.alt.r);
    al.add(cyl(0.006, 0.02, M.brass, [0.155, P.alt.v + 0.04, P.alt.u + 0.03], 'x', 8));
    al.add(lathe([[0.004, 0], [0.011, 0], [0.011, 0.014], [0.004, 0.018]], M.red, [0.145, P.alt.v + 0.04, P.alt.u + 0.03], 'x', 14)); // колпачок клеммы B
    al.add(connector(0.02, 0.018, 0.026, [0.16, P.alt.v + 0.03, P.alt.u - 0.045]));
    al.anchor('B', [0.143, P.alt.v + 0.04, P.alt.u + 0.03]);
    al.pins(['IG', 'S', 'L'], [0.149, P.alt.v + 0.03, P.alt.u - 0.045], [0, 0, 1], 0.007);
    al.bolt([0.3, P.alt.v - 0.06, P.alt.u], [1, 0, 0]).bolt([0.17, P.alt.v - 0.06, P.alt.u - 0.02], [1, 0, 0]);

    // Компрессор кондиционера: корпус с рёбрами, муфта, магистрали
    const ac = this.P('ac_comp', [0, -1, 0.5]);
    ac.add(lathe([[0.04, -0.09], [0.058, -0.085], [0.062, -0.07], [0.062, 0.06], [0.058, 0.075], [0.05, 0.085], [0, 0.085]], M.alu, [0.185, P.ac.v, P.ac.u], 'x', 36));
    for (let k = -2; k <= 2; k++) ac.add(torus(0.0625, 0.0025, M.alu, [0.185 + k * 0.03, P.ac.v, P.ac.u], 'x'));
    ac.add(box(0.06, 0.035, 0.04, M.castAlu, [0.15, P.ac.v + 0.068, P.ac.u - 0.015], 0.006));
    for (const dz of [-0.03, 0.0]) ac.add(cyl(0.01, 0.02, M.alu, [0.15 + dz, P.ac.v + 0.09, P.ac.u - 0.015], 'y', 12));
    ac.add(sweep([[0.15, P.ac.v + 0.1, P.ac.u - 0.015], [0.15, 0.15, 0.32], [0.2, 0.3, 0.5]], () => 0.009, M.darkSteel, 30, 10));
    ac.add(sweep([[0.12, P.ac.v + 0.1, P.ac.u - 0.015], [0.1, 0.18, 0.3], [0.1, 0.32, 0.5]], () => 0.007, M.alu, 30, 10));
    ac.add(connector(0.016, 0.014, 0.02, [0.26, P.ac.v + 0.06, P.ac.u + 0.02]));
    const clutch = pulley(P.ac.r);
    clutch.add(lathe([[0, 0], [P.ac.r * 0.75, 0], [P.ac.r * 0.75, 0.004], [0, 0.004]], M.steel, [0.013, 0, 0], 'x', 32));
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; clutch.add(cyl(0.004, 0.006, M.darkSteel, [0.017, Math.cos(a) * 0.025, Math.sin(a) * 0.025], 'x', 8)); }
    mount(ac, clutch, P.ac, P.crank.r / P.ac.r);
    ac.bolt([0.12, P.ac.v + 0.06, P.ac.u + 0.05], [0, 0, 1]).bolt([0.24, P.ac.v + 0.06, P.ac.u + 0.05], [0, 0, 1]).bolt([0.12, P.ac.v - 0.06, P.ac.u + 0.05], [0, 0, 1]).bolt([0.24, P.ac.v - 0.06, P.ac.u + 0.05], [0, 0, 1]);

    // Стартер: двигатель, тяговое реле, фланец
    const st = this.P('starter', [0, 0, -1]);
    { const lm = lathe([[0.03, -0.075], [0.042, -0.07], [0.043, 0.04], [0.04, 0.05], [0.032, 0.06], [0, 0.06]], M.blackPaint, [-0.33, -0.01, -0.19], 'x', 32); lm.rotation.set(0, 0, Math.PI / 2); st.add(lm); }
    st.add(lathe([[0, -0.045], [0.026, -0.045], [0.027, 0.04], [0.02, 0.046], [0, 0.046]], M.alu, [-0.31, 0.056, -0.19], 'x', 24));
    st.add(lathe([[0, 0], [0.034, 0], [0.034, 0.01], [0.028, 0.03], [0, 0.03]], M.castAlu, [-0.265, -0.01, -0.19], 'x', 24));
    st.add(box(0.012, 0.09, 0.07, M.castAlu, [-0.248, 0.0, -0.17], 0.006));
    st.add(cyl(0.006, 0.014, M.brass, [-0.36, 0.068, -0.19], 'x', 8));
    st.add(connector(0.012, 0.012, 0.014, [-0.36, 0.04, -0.19]));
    st.anchor('30', [-0.37, 0.068, -0.19]);
    st.anchor('50', [-0.368, 0.04, -0.19]);
    st.bolt([-0.24, 0.035, -0.15], [-1, 0, 0]).bolt([-0.24, -0.035, -0.15], [-1, 0, 0]);
    st.add(sweep([[-0.37, 0.068, -0.19], [-0.42, 0.15, -0.05], [-0.48, 0.3, 0.2], [-0.47, 0.38, 0.35]], () => 0.006, M.rubber, 40, 8));
  }

  // ================= Впуск =================
  private buildIntake(): void {
    const base = this.P('air_box_base');
    base.add(box(0.22, 0.1, 0.26, M.plastic, [-0.51, 0.27, 0.03], 0.02));
    for (let k = -2; k <= 2; k++) base.add(box(0.224, 0.07, 0.006, M.plastic, [-0.51, 0.265, 0.03 + k * 0.05], 0.002));
    base.add(sweep([[-0.51, 0.25, 0.16], [-0.5, 0.25, 0.35], [-0.36, 0.4, 0.55]], (t) => 0.03 + t * 0.008, M.plastic, 30, 14));
    const lid = this.P('air_box_lid', [0, 1, 0]);
    lid.add(box(0.22, 0.05, 0.26, M.plastic, [-0.51, 0.345, 0.03], 0.02));
    for (let k = -3; k <= 3; k++) lid.add(box(0.2, 0.004, 0.006, M.plastic, [-0.51, 0.372, 0.03 + k * 0.032], 0.002));
    lid.add(lathe([[0.038, 0], [0.036, 0.03], [0.034, 0.05]], M.plastic, [-0.42, 0.345, 0.1], 'x', 24));
    for (const [x, z] of [[-0.61, -0.09], [-0.61, 0.15], [-0.41, -0.09], [-0.41, 0.15]] as [number, number][]) lid.add(box(0.012, 0.035, 0.022, M.plasticGray, [x + Math.sign(x + 0.51) * 0.006, 0.32, z], 0.003));
    const filt = this.P('air_filter', [0, 1, 0]);
    const fm = new THREE.MeshStandardMaterial({ map: finTexture('#d8c9a0', '#efe3c3', true, 30), roughness: 0.9 });
    filt.add(box(0.19, 0.03, 0.23, fm, [-0.51, 0.318, 0.03]));
    filt.add(box(0.2, 0.006, 0.24, M.orange, [-0.51, 0.333, 0.03], 0.002));

    // ДМРВ
    const maf = this.P('maf', [0, 1, 0]);
    maf.add(box(0.03, 0.04, 0.032, M.plastic, [-0.4, 0.38, 0.1], 0.006));
    maf.add(box(0.036, 0.006, 0.036, M.plasticGray, [-0.4, 0.398, 0.1], 0.002));
    maf.add(connector(0.024, 0.016, 0.022, [-0.4, 0.408, 0.115]));
    maf.pins(['+B', 'E2G', 'VG', 'THA', 'E2'], [-0.4, 0.419, 0.115], [1, 0, 0], 0.005);
    maf.bolt([-0.42, 0.401, 0.09], [0, 1, 0], 0.0035).bolt([-0.38, 0.401, 0.09], [0, 1, 0], 0.0035);

    // Патрубок (гофра)
    const duct = this.P('air_duct', [0, 1, 0.4]);
    duct.add(corrugated([[-0.375, 0.345, 0.1], [-0.34, 0.33, 0.2], [-0.3, 0.27, 0.29], [-0.272, 0.235, 0.29]], 0.034, M.rubber, 11));
    duct.add(torus(0.037, 0.004, M.steel, [-0.37, 0.345, 0.1], 'x'), torus(0.037, 0.004, M.steel, [-0.28, 0.235, 0.29], 'x'));
    duct.add(box(0.008, 0.012, 0.01, M.steel, [-0.37, 0.384, 0.1]), box(0.008, 0.012, 0.01, M.steel, [-0.28, 0.274, 0.29]));

    // Дроссель: корпус, мотор, датчик, разъём
    const th = this.P('throttle', [-1, 0.3, 0]);
    th.add(lathe([[0.032, -0.025], [0.04, -0.025], [0.04, -0.018], [0.036, -0.015], [0.036, 0.018], [0.042, 0.02], [0.042, 0.025], [0.032, 0.025]], M.alu, [-0.24, 0.235, 0.29], 'x', 32));
    th.add(box(0.045, 0.055, 0.05, M.castAlu, [-0.24, 0.19, 0.29], 0.01));
    th.add(lathe([[0, 0], [0.018, 0], [0.018, 0.04], [0, 0.04]], M.castAlu, [-0.26, 0.19, 0.31], 'x', 20));
    th.add(box(0.05, 0.05, 0.016, M.plastic, [-0.24, 0.2, 0.322], 0.006)); // крышка датчика
    th.add(connector(0.03, 0.02, 0.02, [-0.24, 0.165, 0.31]));
    th.pins(['VC', 'VTA1', 'E2', 'M+'], [-0.24, 0.155, 0.31], [1, 0, 0], 0.006);
    const flap = cyl(0.032, 0.002, M.steel, [-0.24, 0.235, 0.29], 'x', 24);
    flap.rotation.y = 0.3;
    th.add(flap);
    for (const [y, z] of [[0.27, 0.325], [0.27, 0.255], [0.2, 0.325], [0.2, 0.255]] as [number, number][]) th.bolt([-0.262, y, z], [-1, 0, 0], 0.0045);

    // Впускной коллектор: ресивер с рёбрами + плавные каналы с раструбами
    const im = this.P('intake_manifold', [0, 0.4, 1]);
    const plen = box(0.37, 0.1, 0.085, M.plastic, [-0.025, 0.225, 0.29], 0.04);
    plen.userData.shell = true;
    im.add(plen);
    for (let k = 0; k < 8; k++) im.add(box(0.004, 0.084, 0.087, M.plastic, [-0.19 + k * 0.047, 0.225, 0.29], 0.0015));
    { const lm = lathe([[0.036, 0], [0.04, 0.004], [0.04, 0.01], [0.036, 0.014], [0.036, 0.03]], M.plastic, [-0.2, 0.235, 0.29], 'x', 28); lm.rotation.set(0, 0, Math.PI / 2); im.add(lm); }
    for (let i = 0; i < 4; i++) {
      const x = CX[i];
      const r = sweep([[x, 0.287, 0.13], [x, 0.325, 0.168], [x, 0.338, 0.225], [x, 0.318, 0.272], [x, 0.278, 0.292]], (t) => 0.0185 + 0.004 * Math.max(0, 1 - t / 0.15) + 0.005 * Math.max(0, (t - 0.8) / 0.2), M.plastic, 36, 14);
      r.userData.shell = true;
      im.add(r);
    }
    im.add(box(0.4, 0.062, 0.012, M.plastic, [0, 0.288, 0.13], 0.004));
    for (const x of [-0.17, -0.088, 0, 0.088, 0.17]) { im.add(cyl(0.008, 0.012, M.plastic, [x, 0.31, 0.138], 'z', 12)); im.bolt([x, 0.31, 0.144], [0, 0, 1], 0.005); }
    im.add(cyl(0.006, 0.02, M.plastic, [0.09, 0.27, 0.335], 'z', 10)); // штуцер PCV
    im.add(cyl(0.004, 0.018, M.plastic, [-0.08, 0.27, 0.335], 'z', 8)); // штуцер EVAP

    // Рампа и форсунки (под коллектором)
    const fr = this.P('fuel_rail', [0, 0.3, 1]);
    fr.add(lathe([[0, -0.18], [0.009, -0.18], [0.009, 0.18], [0, 0.18]], M.steel, [0, 0.262, 0.175], 'x', 16));
    for (const x of CX) fr.add(cyl(0.011, 0.016, M.steel, [x, 0.258, 0.17], 'y', 14));
    fr.add(sweep([[-0.18, 0.262, 0.175], [-0.22, 0.2, 0.2], [-0.25, 0.05, 0.1]], () => 0.004, M.darkSteel, 24, 8));
    fr.add(box(0.03, 0.01, 0.02, M.steel, [-0.09, 0.27, 0.182], 0.002), box(0.03, 0.01, 0.02, M.steel, [0.09, 0.27, 0.182], 0.002));
    fr.bolt([-0.09, 0.276, 0.182], [0, 0, 1], 0.0045).bolt([0.09, 0.276, 0.182], [0, 0, 1], 0.0045);
    for (let i = 0; i < 4; i++) {
      const inj = this.P(`injector_${i + 1}`, [0, 0.4, 1]);
      const a = v(CX[i], 0.258, 0.168), b = v(CX[i], 0.277, 0.14);
      inj.add(rod(a, b, 0.0068, M.plastic, 14));
      inj.add(torus(0.007, 0.0015, M.orange, [CX[i], 0.274, 0.144], 'z'));
      inj.add(connector(0.012, 0.012, 0.012, [CX[i] + 0.012, 0.262, 0.16]));
      inj.pins(['B', 'S'], [CX[i] + 0.012, 0.27, 0.16], [0, 0, 1], 0.006);
    }
  }

  // ================= Выпуск =================
  private buildExhaust(): void {
    const ex = this.P('exhaust_manifold', [0, 0.2, -1]);
    for (let i = 0; i < 4; i++) {
      const x = CX[i];
      ex.add(sweep([[x, 0.28, -0.122], [x * 0.92, 0.292, -0.17], [x * 0.45, 0.255, -0.235], [x * 0.1, 0.21, -0.268]], (t) => 0.016 + t * 0.003, M.exhaust, 30, 12));
    }
    ex.add(box(0.42, 0.06, 0.012, M.exhaust, [0, 0.28, -0.127], 0.004));
    // Катализатор: конусы + корпус + фланцы
    ex.add(lathe([[0.03, 0.27], [0.045, 0.24], [0.066, 0.2], [0.066, -0.04], [0.045, -0.07], [0.028, -0.09]], M.exhaust, [0, 0, -0.29], 'y', 32));
    ex.add(torus(0.067, 0.004, M.exhaust, [0, 0.15, -0.29], 'y'), torus(0.067, 0.004, M.exhaust, [0, 0.0, -0.29], 'y'));
    ex.add(sweep([[0, -0.08, -0.29], [0, -0.14, -0.3], [0.02, -0.2, -0.38], [0.05, -0.22, -0.55]], () => 0.026, M.exhaust, 30, 14));
    ex.add(cyl(0.045, 0.01, M.exhaust, [0.04, -0.215, -0.5], 'z', 24));
    for (const x of [-0.18, -0.088, 0, 0.088, 0.18]) ex.bolt([x, 0.3, -0.135], [0, 0, -1]);
    // Теплозащитный экран — гофрированный лист
    const hs = this.P('heat_shield', [0, 1, -0.3]);
    const sheet = corrugatedSheet(0.44, 0.18, 9, 0.004, M.heatShield);
    sheet.position.set(0, 0.333, -0.21);
    sheet.rotation.x = -0.35;
    sheet.userData.shell = true;
    (sheet.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    hs.add(sheet);
    const edge = box(0.44, 0.012, 0.006, M.heatShield, [0, 0.364, -0.128], 0.002);
    hs.add(edge);
    hs.bolt([-0.19, 0.362, -0.13]).bolt([0.19, 0.362, -0.13]).bolt([-0.19, 0.302, -0.282]).bolt([0.19, 0.302, -0.282]);

    const o2u = this.P('o2_up', [0, 1, -0.3]);
    o2u.add(lathe([[0, 0], [0.008, 0], [0.008, 0.02], [0.0115, 0.02], [0.0115, 0.032], [0.008, 0.034], [0.008, 0.06], [0.005, 0.064], [0, 0.064]], M.steel, [0.06, 0.225, -0.29], 'y', 14));
    o2u.add(sweep([[0.06, 0.29, -0.29], [0.1, 0.33, -0.33], [0.16, 0.36, -0.36]], () => 0.004, M.rubber, 20, 6));
    o2u.add(connector(0.025, 0.014, 0.02, [0.16, 0.365, -0.36]));
    o2u.pins(['OX', 'E2', 'HT', '+B'], [0.16, 0.374, -0.36], [1, 0, 0], 0.005);
    const o2d = this.P('o2_down', [0, -0.3, -1]);
    o2d.add(lathe([[0, 0], [0.008, 0], [0.008, 0.015], [0.0115, 0.015], [0.0115, 0.027], [0.008, 0.03], [0.008, 0.05], [0, 0.052]], M.steel, [0.0, -0.12, -0.315], 'z', 14));
    o2d.add(sweep([[0, -0.12, -0.365], [0.05, -0.08, -0.4], [0.12, 0.05, -0.43]], () => 0.004, M.rubber, 20, 6));
    o2d.add(connector(0.025, 0.014, 0.02, [0.12, 0.06, -0.43]));
    o2d.pins(['OX', 'E2', 'HT', '+B'], [0.12, 0.069, -0.43], [1, 0, 0], 0.005);
  }

  // ================= Охлаждение =================
  private buildCooling(kin: Kin): void {
    const rad = this.P('radiator', [0, 1, 0]);
    const core = new THREE.MeshStandardMaterial({ map: finTexture('#24272b', '#3b4046', true, 60), roughness: 0.8, metalness: 0.4 });
    (core.map as THREE.Texture).repeat.set(8, 1);
    const coreH = new THREE.MeshStandardMaterial({ map: finTexture('#2a2d32', '#4a5058', false, 24), roughness: 0.7, metalness: 0.5, transparent: true, opacity: 0.6 });
    rad.add(box(0.66, 0.4, 0.024, core, [0.0, 0.23, 0.515]));
    rad.add(box(0.662, 0.4, 0.002, coreH, [0.0, 0.23, 0.502]));
    for (const s of [-1, 1]) {
      rad.add(box(0.05, 0.44, 0.042, M.plastic, [s * 0.355, 0.23, 0.515], 0.01));
      for (let k = 0; k < 9; k++) rad.add(box(0.052, 0.004, 0.044, M.plastic, [s * 0.355, 0.04 + k * 0.047, 0.515]));
    }
    rad.add(lathe([[0.017, 0], [0.019, 0.006], [0.017, 0.012], [0.017, 0.04]], M.plastic, [-0.355, 0.4, 0.475], 'z', 16).rotateX(Math.PI));
    rad.add(lathe([[0.017, 0], [0.019, 0.006], [0.017, 0.012], [0.017, 0.04]], M.plastic, [-0.355, 0.07, 0.475], 'z', 16).rotateX(Math.PI));
    rad.add(cyl(0.006, 0.02, M.yellow, [0.355, 0.03, 0.537], 'z', 8)); // сливной кран
    rad.add(box(0.02, 0.02, 0.03, M.rubber, [-0.33, 0.465, 0.53], 0.004), box(0.02, 0.02, 0.03, M.rubber, [0.33, 0.465, 0.53], 0.004));
    rad.bolt([-0.33, 0.477, 0.53]).bolt([0.33, 0.477, 0.53]);

    const fan = this.P('fan', [0, 1, 0.3]);
    const shroud = plateXZ(roundRect(-0.25, -0.18, 0.35, 0.18, 0.04), [{ x: 0.06, z: 0.0, r: 0.162 }], 0.012, M.plastic, 0, 0.004);
    shroud.rotation.x = Math.PI / 2;
    shroud.position.set(0, 0.23, 0.478);
    fan.add(shroud);
    fan.add(lathe([[0.162, 0], [0.168, 0.006], [0.168, 0.03]], M.plastic, [0.06, 0.23, 0.49], 'z', 48).rotateX(Math.PI));
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.4; const st = box(0.17, 0.012, 0.006, M.plastic, [0.06 + Math.cos(a) * 0.085, 0.23 + Math.sin(a) * 0.085, 0.455]); st.rotation.z = a; fan.add(st); }
    fan.add(lathe([[0, 0], [0.042, 0], [0.045, 0.01], [0.045, 0.05], [0.04, 0.055], [0, 0.055]], M.blackPaint, [0.06, 0.23, 0.425], 'z', 28));
    const blades = new THREE.Group();
    blades.position.set(0.06, 0.23, 0.47);
    blades.add(lathe([[0, 0], [0.036, 0], [0.036, 0.02], [0.03, 0.026], [0, 0.026]], M.plastic, [0, 0, -0.01], 'z', 24));
    for (let k = 0; k < 7; k++) {
      const b = new THREE.Mesh(bladeShape(0.12, 0.028, 0.06), M.plastic);
      b.position.set(0.03, 0, 0);
      b.rotation.x = 0.45;
      const piv = new THREE.Group();
      piv.add(b);
      piv.rotation.z = (k / 7) * Math.PI * 2;
      blades.add(piv);
    }
    fan.add(blades);
    kin.fan = blades;
    fan.add(connector(0.02, 0.016, 0.014, [0.11, 0.27, 0.44]));
    fan.pins(['+', '-'], [0.11, 0.27, 0.432], [1, 0, 0], 0.007);
    fan.bolt([-0.22, 0.42, 0.49], [0, 0, -1]).bolt([0.32, 0.42, 0.49], [0, 0, -1]);
    for (const g of [rad.group, fan.group]) g.traverse((o) => { o.userData.fade = '+z'; });

    const uh = this.P('upper_hose', [0, 1, 0]);
    uh.add(hose([[-0.27, 0.3, 0.05], [-0.3, 0.34, 0.16], [-0.33, 0.4, 0.38], [-0.355, 0.4, 0.47]], 0.017, M.rubber, M.steel));
    const lh = this.P('lower_hose', [0, -0.5, 0.8]);
    lh.add(hose([[-0.2, 0.11, 0.155], [-0.22, 0.08, 0.25], [-0.3, 0.06, 0.4], [-0.355, 0.07, 0.47]], 0.017, M.rubber, M.steel));
    const thm = this.P('thermostat', [0, 0, 1]);
    thm.add(lathe([[0, 0], [0.029, 0], [0.029, 0.012], [0.02, 0.02], [0.018, 0.035], [0.019, 0.04], [0.017, 0.045]], M.castAlu, [-0.2, 0.11, 0.135], 'z', 24));
    thm.add(box(0.07, 0.02, 0.008, M.castAlu, [-0.2, 0.11, 0.138], 0.004));
    thm.bolt([-0.228, 0.11, 0.143], [0, 0, 1], 0.004).bolt([-0.172, 0.11, 0.143], [0, 0, 1], 0.004);
    this.B('block').add(box(0.07, 0.06, 0.02, M.castAlu, [-0.2, 0.11, 0.126], 0.008));

    const et = this.P('exp_tank', [0, 1, 0]);
    et.add(box(0.1, 0.12, 0.08, M.tankWhite, [0.52, 0.32, 0.4], 0.018));
    et.add(box(0.09, 0.055, 0.07, new THREE.MeshStandardMaterial({ color: 0xe5559a, transparent: true, opacity: 0.8 }), [0.52, 0.288, 0.4], 0.012));
    et.add(lathe([[0, 0], [0.021, 0], [0.022, 0.004], [0.022, 0.018], [0.018, 0.022], [0, 0.022]], M.plastic, [0.52, 0.38, 0.4], 'y', 24));
    et.add(labelPlane('MAX\n\nMIN', 0.02, 0.05, 'rgba(0,0,0,0)', '#3a3a3a', 'bold 90px sans-serif').translateX(0.471).translateY(0.31).translateZ(0.4).rotateY(-Math.PI / 2));
    et.add(sweep([[0.52, 0.27, 0.44], [0.45, 0.42, 0.5], [0.355, 0.44, 0.52]], () => 0.005, M.rubber, 24, 6));
    et.bolt([0.575, 0.36, 0.4], [1, 0, 0], 0.004);
  }

  // ================= Смазка =================
  private buildLube(): void {
    const pan = this.P('oil_pan', [0, -1, 0]);
    const pprof: [number, number][] = [[-0.114, -0.1], [0.114, -0.1], [0.112, -0.13], [0.102, -0.19], [-0.06, -0.19], [-0.108, -0.135]];
    const pn = extrudeX(pprof, -0.218, 0.218, M.darkSteel, 0.006);
    pn.userData.shell = true;
    pan.add(pn);
    pan.add(box(0.46, 0.006, 0.236, M.darkSteel, [0, -0.099, 0], 0.002));
    for (let k = -3; k <= 3; k++) for (const z of [0.113, -0.113]) pan.bolt([k * 0.065, -0.095, z], [0, -1, 0], 0.004);
    const dr = this.P('oil_drain', [0, -1, 0]);
    dr.add(cyl(0.012, 0.004, M.copper, [0.12, -0.198, 0.04], 'y', 16));
    dr.bolt([0.12, -0.2, 0.04], [0, -1, 0], 0.008);
    const of = this.P('oil_filter', [0, -1, 0]);
    of.add(lathe([[0, 0.04], [0.035, 0.04], [0.038, 0.035], [0.038, -0.03], [0.04, -0.036], [0.04, -0.044], [0, -0.044]], M.plastic, [-0.05, -0.045, 0.165], 'y', 32));
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; of.add(box(0.006, 0.012, 0.004, M.plastic, [-0.05 + Math.cos(a) * 0.04, -0.084, 0.165 + Math.sin(a) * 0.04])); }
    of.add(cyl(0.009, 0.01, M.plasticGray, [-0.05, -0.094, 0.165], 'y', 8));
    this.B('block').add(box(0.09, 0.03, 0.06, M.castAlu, [-0.05, 0.0, 0.15], 0.01));
    const ds = this.P('dipstick', [0, 1, 0]);
    ds.add(torus(0.014, 0.004, M.yellow, [-0.212, 0.448, 0.16], 'z'));
    ds.add(cyl(0.006, 0.012, M.yellow, [-0.212, 0.43, 0.16], 'y', 12));
  }

  // ================= Электрика: АКБ, блок реле, ЭБУ, жгуты, датчики =================
  private buildElectric(): void {
    const bat = this.P('battery', [0, 1, 0]);
    bat.add(box(0.2, 0.19, 0.17, M.battery, [-0.52, 0.265, 0.33], 0.01));
    bat.add(box(0.204, 0.016, 0.174, M.plasticGray, [-0.52, 0.367, 0.33], 0.006));
    for (let k = 0; k < 6; k++) bat.add(cyl(0.006, 0.004, M.plastic, [-0.585 + k * 0.026, 0.377, 0.3], 'y', 10)); // пробки
    bat.add(box(0.12, 0.004, 0.01, M.plastic, [-0.52, 0.376, 0.27], 0.002)); // ручка
    bat.add(labelPlane('12V  60Ah\n540A (EN)', 0.14, 0.07, '#202328', '#d0d4da').translateX(-0.52).translateY(0.27).translateZ(0.4155));
    for (const x of [-0.47, -0.57]) bat.add(lathe([[0, 0], [0.0095, 0], [0.0078, 0.02], [0, 0.02]], M.steel, [x, 0.375, 0.37], 'y', 16));
    bat.anchor('+', [-0.47, 0.401, 0.37]);
    bat.anchor('-', [-0.57, 0.401, 0.37]);
    bat.add(labelPlane('+', 0.018, 0.018, '#c8323a', '#ffffff', 'bold 400px sans-serif').translateX(-0.47).translateY(0.3755).translateZ(0.398).rotateX(-Math.PI / 2));
    bat.add(labelPlane('−', 0.018, 0.018, '#18191c', '#ffffff', 'bold 400px sans-serif').translateX(-0.57).translateY(0.3755).translateZ(0.398).rotateX(-Math.PI / 2));
    const bay = this.B('bay');
    bay.add(box(0.24, 0.02, 0.2, M.darkSteel, [-0.52, 0.16, 0.33], 0.004));

    const bp = this.P('battery_pos', [0, 1, 0]);
    bp.add(box(0.03, 0.016, 0.022, M.copper, [-0.47, 0.391, 0.37], 0.004));
    bp.add(box(0.034, 0.014, 0.044, M.red, [-0.47, 0.404, 0.375], 0.006));
    bp.add(sweep([[-0.47, 0.395, 0.39], [-0.45, 0.39, 0.3], [-0.47, 0.38, 0.2], [-0.52, 0.34, -0.12]], () => 0.006, M.red, 40, 8));
    bp.anchor('clamp', [-0.455, 0.396, 0.37]);
    bp.bolt([-0.47, 0.412, 0.362], [0, 1, 0], 0.004);
    const bn = this.P('battery_neg', [0, 1, 0]);
    bn.add(box(0.03, 0.016, 0.022, M.darkSteel, [-0.57, 0.391, 0.37], 0.004));
    bn.add(sweep([[-0.57, 0.395, 0.385], [-0.62, 0.39, 0.32], [-0.7, 0.38, 0.28]], () => 0.006, M.rubber, 30, 8));
    bn.anchor('clamp', [-0.585, 0.396, 0.37]);
    bn.bolt([-0.57, 0.403, 0.362], [0, 1, 0], 0.004);
    const bc = this.P('battery_clamp', [0, 1, 0]);
    bc.add(box(0.022, 0.008, 0.18, M.darkSteel, [-0.52, 0.38, 0.33], 0.003));
    for (const z of [0.235, 0.425]) bc.add(cyl(0.003, 0.2, M.steel, [-0.52, 0.28, z], 'y', 6));
    bc.bolt([-0.52, 0.386, 0.235]).bolt([-0.52, 0.386, 0.425]);

    // Блок реле и предохранителей
    const fb = this.P('fusebox');
    const FB = { x: -0.54, y: 0.29, z: -0.25 };
    fb.add(box(0.17, 0.09, 0.18, M.plastic, [FB.x, FB.y - 0.02, FB.z], 0.012));
    fb.add(box(0.16, 0.004, 0.17, M.plasticGray, [FB.x, FB.y + 0.026, FB.z]));
    const lid = this.P('fusebox_lid', [0, 1, 0]);
    lid.add(box(0.178, 0.04, 0.188, M.plastic, [FB.x, FB.y + 0.05, FB.z], 0.015));
    for (let k = -3; k <= 3; k++) lid.add(box(0.15, 0.003, 0.006, M.plastic, [FB.x, FB.y + 0.0705, FB.z + k * 0.024]));
    for (const s of [-1, 1]) lid.add(box(0.03, 0.03, 0.008, M.plasticGray, [FB.x, FB.y + 0.04, FB.z + s * 0.095], 0.003));
    lid.add(labelPlane('RELAY BOX', 0.1, 0.03, '#18191c', '#8f949b').translateX(FB.x).translateY(FB.y + 0.0725).translateZ(FB.z).rotateX(-Math.PI / 2));
    const fuses: [string, THREE.Material, number, number, boolean][] = [
      ['fuse_am2', M.green, -0.03, -0.06, true], ['fuse_rdi', M.green, 0.0, -0.06, true],
      ['fuse_efi', M.yellow, -0.055, 0.0, false], ['fuse_efi2', M.red, -0.035, 0.0, false], ['fuse_ig2', M.blue, -0.015, 0.0, false],
      ['fuse_etcs', M.red, 0.005, 0.0, false], ['fuse_alts', M.brown, 0.025, 0.0, false],
    ];
    for (const [fid, mat, dx, dz, maxi] of fuses) {
      const f = this.P(fid, [0, 1, 0]);
      const x = FB.x + dx, z = FB.z + dz;
      if (maxi) {
        f.add(box(0.022, 0.02, 0.01, mat, [x, FB.y + 0.035, z], 0.003));
        f.add(box(0.012, 0.008, 0.006, M.ceramic, [x, FB.y + 0.046, z], 0.001));
      } else {
        f.add(box(0.012, 0.018, 0.005, mat, [x, FB.y + 0.035, z], 0.0015));
        f.add(box(0.008, 0.004, 0.0052, M.ceramic, [x, FB.y + 0.04, z]));
      }
      f.anchor('in', [x - (maxi ? 0.007 : 0.004), FB.y + (maxi ? 0.047 : 0.045), z]);
      f.anchor('out', [x + (maxi ? 0.007 : 0.004), FB.y + (maxi ? 0.047 : 0.045), z]);
      fb.add(box(maxi ? 0.026 : 0.016, 0.006, maxi ? 0.014 : 0.009, M.connectorDark, [x, FB.y + 0.028, z]));
    }
    for (let k = 0; k < 4; k++) fb.add(box(0.012, 0.018, 0.005, [M.red, M.blue, M.yellow, M.red][k], [FB.x + 0.045 + k * 0.012, FB.y + 0.035, FB.z], 0.0015));
    const relays: [string, number, number][] = [['relay_efi', -0.045, 0.06], ['relay_copn', -0.005, 0.06], ['relay_st', 0.035, 0.06], ['relay_fan', 0.05, -0.06]];
    for (const [rid, dx, dz] of relays) {
      const r = this.P(rid, [0, 1, 0]);
      const x = FB.x + dx, z = FB.z + dz;
      r.add(box(0.028, 0.03, 0.028, M.plastic, [x, FB.y + 0.043, z], 0.004));
      r.add(labelPlane(rid.replace('relay_', '').toUpperCase(), 0.024, 0.012, '#18191c', '#c9ced4', 'bold 150px sans-serif').translateX(x).translateY(FB.y + 0.0585).translateZ(z).rotateX(-Math.PI / 2));
      const pinPos: Record<string, V3> = { '1': [x - 0.009, FB.y + 0.059, z - 0.009], '2': [x + 0.009, FB.y + 0.059, z - 0.009], '3': [x - 0.009, FB.y + 0.059, z + 0.009], '5': [x + 0.009, FB.y + 0.059, z + 0.009] };
      for (const [nm, p] of Object.entries(pinPos)) r.anchor(nm, p);
      fb.add(box(0.03, 0.006, 0.03, M.connectorDark, [x, FB.y + 0.028, z]));
      for (const [nm, p] of Object.entries(pinPos)) fb.anchor(`${rid}.${nm}`, [p[0], FB.y + 0.032, p[2]]);
    }
    fb.add(sweep([[FB.x, FB.y - 0.06, FB.z + 0.09], [-0.5, 0.2, -0.05], [-0.45, 0.3, 0.2]], () => 0.011, M.plastic, 30, 10));

    // ЭБУ
    const ecu = this.P('ecu', [0, 1, 0]);
    const E = { x: -0.32, y: 0.31, z: -0.4 };
    ecu.add(box(0.16, 0.035, 0.12, M.alu, [E.x, E.y, E.z], 0.008));
    for (let k = -3; k <= 3; k++) ecu.add(box(0.15, 0.004, 0.006, M.alu, [E.x, E.y + 0.019, E.z + k * 0.015], 0.0015));
    ecu.add(labelPlane('ECM\n89661-xxxxx', 0.07, 0.035, '#d8dce0', '#2a2d31', 'bold 70px sans-serif').translateX(E.x - 0.03).translateY(E.y + 0.0222).translateZ(E.z).rotateX(-Math.PI / 2));
    for (const [dx, dz] of [[-0.085, -0.055], [0.085, -0.055], [-0.085, 0.055], [0.085, 0.055]] as [number, number][]) ecu.bolt([E.x + dx, E.y - 0.005, E.z + dz], [0, 1, 0], 0.004);
    bay.add(box(0.2, 0.01, 0.14, M.darkSteel, [E.x, E.y - 0.025, E.z], 0.003));
    const conn = this.P('ecu_conn', [0, 0, 1]);
    conn.add(box(0.06, 0.03, 0.025, M.connector, [E.x - 0.04, E.y, E.z + 0.07], 0.005));
    conn.add(box(0.05, 0.03, 0.025, M.connector, [E.x + 0.035, E.y, E.z + 0.07], 0.005));
    conn.add(box(0.06, 0.006, 0.03, M.plasticGray, [E.x - 0.04, E.y + 0.018, E.z + 0.07], 0.002));
    conn.pins(['+B', 'BATT', 'E1', 'THW', 'VG', 'NE+', 'FC'], [E.x, E.y + 0.017, E.z + 0.084], [1, 0, 0], 0.01);

    // Жгут двигателя в гофре (декоративный)
    const harness = this.B('head');
    const loom = new THREE.MeshStandardMaterial({ map: finTexture('#16171a', '#26282c', true, 64), roughness: 0.8 });
    (loom.map as THREE.Texture).repeat.set(1, 1);
    harness.add(sweep([[E.x, E.y, E.z + 0.08], [-0.27, 0.4, -0.2], [-0.15, 0.44, -0.13], [0.2, 0.44, -0.12], [0.25, 0.42, -0.02]], () => 0.011, loom, 80, 10));
    for (let i = 0; i < 4; i++) harness.add(sweep([[CX[i], 0.44, -0.12], [CX[i], 0.46, -0.085], [CX[i], 0.462, -0.058]], () => 0.004, M.plasticGray, 12, 6));
    harness.add(sweep([[-0.2, 0.44, -0.13], [-0.25, 0.36, -0.05], [-0.27, 0.32, 0.06]], () => 0.005, M.plasticGray, 20, 6));
    for (const x of [-0.12, 0.0, 0.12]) harness.add(box(0.01, 0.024, 0.006, M.plastic, [x, 0.44, -0.12], 0.002)); // клипсы

    // ---------- Датчики ----------
    const ect = this.P('ect', [-1, 0, 0]);
    ect.add(cyl(0.008, 0.02, M.brass, [-0.29, 0.31, 0.02], 'x', 6));
    ect.add(connector(0.016, 0.018, 0.018, [-0.305, 0.31, 0.02]));
    ect.pins(['THW', 'E2'], [-0.315, 0.31, 0.02], [0, 0, 1], 0.007);

    const ckp = this.P('ckp', [0, 0, 1]);
    ckp.add(lathe([[0, 0], [0.009, 0], [0.009, 0.028], [0.007, 0.032], [0, 0.032]], M.plastic, [0.27, -0.03, 0.09], 'z', 14));
    ckp.add(connector(0.016, 0.014, 0.014, [0.27, -0.03, 0.125]));
    ckp.add(box(0.026, 0.006, 0.012, M.darkSteel, [0.283, -0.03, 0.098], 0.002));
    ckp.bolt([0.293, -0.03, 0.1], [1, 0, 0], 0.004);
    ckp.pins(['NE+', 'NE-'], [0.27, -0.03, 0.135], [0, 1, 0], 0.007);

    for (const [id, z] of [['cmp_in', 0.115], ['cmp_ex', -0.115]] as [string, number][]) {
      const c = this.P(id, [0, 0, Math.sign(z)]);
      c.add(cyl(0.009, 0.03, M.plastic, [0.245, 0.343, z + Math.sign(z) * 0.01], 'z', 14));
      c.add(connector(0.018, 0.016, 0.014, [0.245, 0.343, z + Math.sign(z) * 0.03]));
      c.add(box(0.028, 0.012, 0.005, M.plastic, [0.255, 0.343, z + Math.sign(z) * 0.002], 0.002));
      c.bolt([0.263, 0.343, z + Math.sign(z) * 0.005], [0, 0, Math.sign(z)], 0.004);
      c.pins(['VC', 'VV', 'E2'], [0.245, 0.343, z + Math.sign(z) * 0.04], [0, 1, 0], 0.005);
    }
    const kn = this.P('knock', [0, 0, 1]);
    kn.add(lathe([[0.006, 0], [0.017, 0], [0.017, 0.012], [0.006, 0.012]], M.plastic, [0.0, 0.11, 0.128], 'z', 20));
    kn.add(connector(0.014, 0.012, 0.012, [0.02, 0.11, 0.135]));
    kn.bolt([0.0, 0.11, 0.139], [0, 0, 1], 0.005);
    kn.pins(['KNK', 'EKNK'], [0.03, 0.11, 0.135], [0, 1, 0], 0.006);
    const op = this.P('oil_press', [0, 0, 1]);
    op.add(lathe([[0, 0], [0.006, 0], [0.006, 0.008], [0.011, 0.008], [0.011, 0.018], [0.009, 0.026], [0, 0.026]], M.brass, [-0.14, 0.03, 0.128], 'z', 6));
    op.add(cyl(0.006, 0.01, M.connectorDark, [-0.14, 0.03, 0.156], 'z', 10));
    op.anchor('SIG', [-0.14, 0.03, 0.163]);
  }
}

// Экспорт для совместимости
export { tube };
