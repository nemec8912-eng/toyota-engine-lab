// Процедурная 3D-модель двигателя 1ZR-FE и моторного отсека Corolla E150.
// Оси: X — поперёк машины (+X — правая сторона, где привод ГРМ), Y — вверх, Z — вперёд (к радиатору).
// Единицы — метры. Ось коленвала — в начале координат.
import * as THREE from 'three';
import { M, box, cyl, sphere, torus, tube, corrugated, rod, orientBetween, boltMesh, plateXZ, roundRect, hullPath, loopTube, stripeTexture, finTexture, labelPlane, v, V3, Circle2 } from './geo';

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
    // Лонжероны
    bay.add(box(0.09, 0.12, 1.3, M.bodyInner, [-0.66, -0.16, 0.05], 0.01), box(0.09, 0.12, 1.3, M.bodyInner, [0.66, -0.16, 0.05], 0.01));
    // Брызговики с опорами стоек
    for (const s of [-1, 1]) {
      bay.add(box(0.05, 0.5, 0.95, M.body, [s * 0.74, 0.17, 0.02], 0.01));
      bay.add(cyl(0.11, 0.12, M.body, [s * 0.67, 0.44, -0.18], 'y', 28));
      bay.add(cyl(0.035, 0.02, M.darkSteel, [s * 0.67, 0.51, -0.18], 'y', 16));
      bay.add(box(0.06, 0.06, 0.95, M.body, [s * 0.76, 0.45, 0.02], 0.01));
    }
    // Моторный щит
    bay.add(box(1.5, 0.75, 0.03, M.body, [0, 0.2, -0.5], 0.01));
    bay.add(box(1.5, 0.08, 0.2, M.plastic, [0, 0.55, -0.56], 0.01)); // жабо
    // Рамка радиатора
    bay.add(box(1.46, 0.05, 0.06, M.bodyInner, [0, 0.49, 0.58], 0.01), box(1.4, 0.05, 0.06, M.bodyInner, [0, -0.06, 0.58], 0.01));
    bay.add(box(0.05, 0.55, 0.05, M.bodyInner, [-0.42, 0.22, 0.58]), box(0.05, 0.55, 0.05, M.bodyInner, [0.42, 0.22, 0.58]));
    // Замок капота
    bay.add(box(0.06, 0.05, 0.04, M.darkSteel, [0, 0.47, 0.6]));
    // Подрамник
    bay.add(box(1.25, 0.05, 0.12, M.darkSteel, [0, -0.25, -0.15], 0.01));
    // Опоры двигателя
    bay.add(box(0.36, 0.04, 0.08, M.darkSteel, [0.5, 0.36, 0.0], 0.008), cyl(0.04, 0.05, M.rubber, [0.66, 0.36, 0.0], 'x'));
    bay.add(box(0.2, 0.04, 0.08, M.darkSteel, [-0.6, 0.25, -0.03], 0.008));
    // Масса на брызговике
    bay.anchor('gnd', [-0.715, 0.38, 0.28]);
    bay.add(cyl(0.008, 0.008, M.steel, [-0.712, 0.38, 0.28], 'x', 6));

    const tr = this.P('transmission');
    const bell = cyl(0.17, 0.12, M.castAlu, [-0.3, 0.02, -0.02], 'x', 32, 0.14);
    tr.add(bell);
    tr.add(box(0.26, 0.26, 0.24, M.castAlu, [-0.48, -0.02, -0.05], 0.04));
    tr.add(cyl(0.09, 0.14, M.castAlu, [-0.48, 0.04, 0.12], 'z', 24));
    tr.add(cyl(0.03, 0.4, M.darkSteel, [-0.45, -0.08, 0.1], 'x', 12)); // привод
    for (let i = 0; i < 8; i++) tr.add(box(0.012, 0.015, 0.012, M.steel, [-0.24, 0.16 * Math.cos((i * Math.PI) / 4) + 0.02, 0.16 * Math.sin((i * Math.PI) / 4) - 0.02]));
  }

  // ================= Блок, КШМ =================
  private buildBlock(kin: Kin): void {
    const bl = this.P('block');
    const shell = box(0.47, 0.265, 0.25, M.castAlu, [0, 0.0825, 0], 0.012);
    shell.userData.shell = true;
    bl.add(shell);
    // Рёбра и приливы рубашки
    for (const z of [-0.126, 0.126]) {
      for (const x of CX) bl.add(cyl(0.045, 0.16, M.castAlu, [x, 0.13, z * 0.93], 'y', 20));
      bl.add(box(0.46, 0.02, 0.012, M.castAlu, [0, -0.035, z]));
    }
    // Нижний картер (верхний поддон)
    bl.add(box(0.46, 0.05, 0.24, M.castAlu, [0, -0.072, 0], 0.01));
    // Гильзы (видны в рентгене)
    for (const x of CX) {
      const liner = cyl(0.0405, 0.16, M.darkSteel, [x, 0.135, 0], 'y', 24, undefined, true);
      liner.userData.liner = true;
      bl.add(liner);
    }
    // Трубка щупа
    bl.add(tube([[-0.205, 0.0, 0.125], [-0.208, 0.2, 0.15], [-0.212, 0.42, 0.16]], 0.006, M.darkSteel));
    bl.anchor('gnd', [-0.236, 0.15, -0.08]);
    bl.add(cyl(0.007, 0.01, M.steel, [-0.236, 0.15, -0.08], 'x', 6));

    // Коленвал
    const cr = kin.crank;
    cr.add(cyl(0.022, 0.52, M.steel, [0.015, 0, 0], 'x', 20));
    const phase = [0, Math.PI, Math.PI, 0];
    for (let i = 0; i < 4; i++) {
      const y = Math.cos(phase[i]) * CRANK_R;
      for (const dx of [-0.028, 0.028]) {
        const web = box(0.014, 0.085, 0.06, M.darkSteel, [CX[i] + dx, y * 0.5, 0], 0.005);
        cr.add(web);
        cr.add(box(0.014, 0.04, 0.07, M.darkSteel, [CX[i] + dx, -y * 0.9, 0], 0.005)); // противовес
      }
      cr.add(cyl(0.019, 0.042, M.steel, [CX[i], y, 0], 'x', 16));
    }
    const crankPart = this.P('crankshaft');
    crankPart.add(cr);
    // Поршни и шатуны
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Group();
      p.add(cyl(0.0398, 0.05, M.alu, [0, 0.012, 0], 'y', 28));
      for (const yy of [0.028, 0.02, 0.012]) p.add(torus(0.0399, 0.0012, M.darkSteel, [0, yy, 0], 'y'));
      p.add(cyl(0.009, 0.06, M.steel, [0, 0, 0], 'x', 10));
      p.position.set(CX[i], ROD_L + CRANK_R, 0);
      crankPart.add(p);
      kin.pistons.push(p);
      const r = rod(v(CX[i], CRANK_R, 0), v(CX[i], ROD_L + CRANK_R, 0), 0.008, M.steel);
      crankPart.add(r);
      kin.rods.push(r);
      // Вспышка сгорания
      const glow = sphere(0.034, new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0, depthWrite: false }), [CX[i], 0.205, 0]);
      glow.userData.noPick = true;
      crankPart.add(glow);
      kin.glows.push(glow);
    }
  }

  // ================= ГБЦ, клапанная крышка, катушки, свечи =================
  private buildHeadAndTop(kin: Kin): void {
    const hd = this.P('head');
    const head = box(0.47, 0.12, 0.245, M.castAlu, [0, 0.275, 0], 0.01);
    head.userData.shell = true;
    hd.add(head);
    hd.add(box(0.47, 0.012, 0.25, M.darkSteel, [0, 0.215, 0])); // прокладка
    // Выходной патрубок ОЖ на левом торце
    hd.add(box(0.05, 0.05, 0.06, M.castAlu, [-0.26, 0.3, 0.0], 0.008));
    hd.add(cyl(0.017, 0.03, M.castAlu, [-0.27, 0.3, 0.04], 'z', 16));
    // Клапаны
    for (let i = 0; i < 4; i++) {
      for (const intake of [true, false]) {
        for (const dx of [-0.016, 0.016]) {
          const g = new THREE.Group();
          const z = intake ? 0.03 : -0.03;
          g.add(cyl(intake ? 0.015 : 0.013, 0.003, M.steel, [0, 0, 0], 'y', 16));
          g.add(cyl(0.0028, 0.1, M.steel, [0, 0.05, 0], 'y', 6));
          g.add(cyl(0.011, 0.012, M.darkAlu, [0, 0.11, 0], 'y', 12)); // толкатель
          const y0 = 0.219;
          g.traverse((o) => { o.userData.internal = true; });
          g.position.set(CX[i] + dx, y0, z);
          hd.add(g);
          kin.valves.push({ obj: g, y0, cyl: i, intake });
        }
      }
    }
    // Распредвалы
    const mkCam = (g: THREE.Group, z: number, intake: boolean) => {
      g.position.set(0, 0.343, z);
      g.add(cyl(0.012, 0.47, M.steel, [0.0, 0, 0], 'x', 14));
      for (let i = 0; i < 4; i++) {
        const loc = FIRE_OFFSET[i] / 2 + (intake ? 230 : 130);
        for (const dx of [-0.016, 0.016]) {
          const lobe = box(0.01, 0.03, 0.022, M.steel, [CX[i] + dx, 0, 0], 0.008);
          lobe.geometry.translate(0, 0.006, 0);
          lobe.rotation.x = (-loc * Math.PI) / 180;
          g.add(lobe);
        }
      }
      // Муфта VVT-i со звёздочкой
      g.add(cyl(0.045, 0.02, M.darkSteel, [0.25, 0, 0], 'x', 32));
      g.add(cyl(0.035, 0.012, M.castAlu, [0.236, 0, 0], 'x', 24));
    };
    mkCam(kin.camIn, 0.06, true);
    mkCam(kin.camEx, -0.06, false);
    this.P('cam_in', [0, 1, 0]).add(kin.camIn);
    this.P('cam_ex', [0, 1, 0]).add(kin.camEx);

    // Свечи
    for (let i = 0; i < 4; i++) {
      const p = this.P(`plug_${i + 1}`, [0, 1, 0]);
      p.add(cyl(0.0075, 0.03, M.ceramic, [CX[i], 0.305, 0], 'y', 14));
      p.add(cyl(0.009, 0.01, M.steel, [CX[i], 0.285, 0], 'y', 6));
      p.add(cyl(0.006, 0.025, M.steel, [CX[i], 0.267, 0], 'y', 10));
      const spark = sphere(0.007, new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0, depthWrite: false }), [CX[i], 0.222, 0], 10);
      spark.userData.noPick = true;
      p.add(spark);
      kin.sparks.push(spark);
    }

    // Клапанная крышка с колодцами свечей
    const vc = this.P('valve_cover', [0, 1, 0]);
    const holes = CX.map((x) => ({ x, z: 0, r: 0.0145 }));
    const plate = plateXZ(roundRect(-0.228, -0.118, 0.228, 0.118, 0.025), holes, 0.05, M.blackPaint, 0.337, 0.004);
    plate.userData.shell = true;
    vc.add(plate);
    for (const x of CX) {
      const well = cyl(0.016, 0.05, M.blackPaint, [x, 0.36, 0], 'y', 20, undefined, true);
      vc.add(well);
    }
    for (const z of [-0.08, 0.08]) vc.add(box(0.4, 0.008, 0.006, M.blackPaint, [0, 0.394, z]));
    for (const [x, z] of [[-0.21, -0.1], [-0.21, 0.1], [0.21, -0.1], [0.21, 0.1], [0, -0.105], [0, 0.105], [-0.1, -0.105], [0.1, 0.105]] as [number, number][]) vc.bolt([x, 0.392, z]);
    vc.add(cyl(0.012, 0.02, M.plastic, [0.08, 0.398, -0.08], 'y', 12)); // клапан PCV
    vc.add(labelPlane('DUAL VVT-i', 0.12, 0.03, '#22252a', '#a9aeb5', 'bold 64px sans-serif').translateY(0.3955).translateZ(0.075).rotateX(-Math.PI / 2));

    // Крышка маслозаливной горловины
    const oc = this.P('oil_cap', [0, 1, 0]);
    oc.add(cyl(0.024, 0.016, M.plastic, [-0.1, 0.402, -0.07], 'y', 24));
    oc.add(box(0.034, 0.008, 0.008, M.plastic, [-0.1, 0.413, -0.07]));
    oc.add(labelPlane('OIL', 0.02, 0.01, '#1c1e22', '#e8812d', 'bold 160px sans-serif').translateY(0.4105).translateX(-0.1).translateZ(-0.058).rotateX(-Math.PI / 2));

    // Катушки
    for (let i = 0; i < 4; i++) {
      const c = this.P(`coil_${i + 1}`, [0, 1, 0]);
      const x = CX[i];
      c.add(cyl(0.011, 0.14, M.plastic, [x, 0.38, 0], 'y', 14));
      c.add(cyl(0.013, 0.016, M.rubber, [x, 0.315, 0], 'y', 14));
      c.add(box(0.044, 0.034, 0.05, M.plastic, [x, 0.462, 0.0], 0.006));
      c.add(box(0.02, 0.006, 0.024, M.plastic, [x + 0.028, 0.448, 0.0]));
      c.bolt([x + 0.034, 0.452, 0.0], [0, 1, 0], 0.0045);
      c.add(box(0.022, 0.018, 0.018, M.connectorDark, [x, 0.462, -0.034], 0.003));
      c.pins(['B', 'IGT', 'GND'], [x, 0.462, -0.044], [1, 0, 0], 0.007);
    }

    // Декоративная крышка
    const ec = this.P('engine_cover', [0, 1, 0]);
    const cov = box(0.44, 0.03, 0.2, M.plastic, [0, 0.5, 0.0], 0.012);
    cov.userData.shell = true;
    ec.add(cov);
    for (let k = -3; k <= 3; k++) ec.add(box(0.008, 0.006, 0.16, M.plasticGray, [k * 0.05, 0.516, 0]));
    ec.add(labelPlane('1ZR', 0.07, 0.025, '#1c1e22', '#9aa0a6', 'bold 120px sans-serif').translateY(0.5165).translateZ(0.07).translateX(-0.15).rotateX(-Math.PI / 2));
    ec.bolt([-0.19, 0.515, 0.0]).bolt([0.19, 0.515, 0.0]);

    // OCV
    for (const [id, z] of [['ocv_in', 0.085], ['ocv_ex', -0.085]] as [string, number][]) {
      const o = this.P(id, [0, 1, 0]);
      o.add(cyl(0.013, 0.05, M.plastic, [0.205, 0.405, z], 'y', 16));
      o.add(box(0.018, 0.014, 0.022, M.connectorDark, [0.205, 0.43, z + Math.sign(z) * 0.018]));
      o.add(box(0.03, 0.005, 0.014, M.darkSteel, [0.222, 0.385, z]));
      o.bolt([0.234, 0.39, z], [0, 1, 0], 0.0042);
      o.pins(['+', '-'], [0.205, 0.43, z + Math.sign(z) * 0.03], [1, 0, 0], 0.008);
    }

    // Шланг PCV
    const pcv = this.P('pcv_hose', [0, 1, 0.3]);
    pcv.add(tube([[0.08, 0.405, -0.08], [0.088, 0.43, 0.02], [0.088, 0.41, 0.17], [0.09, 0.34, 0.27]], 0.007, M.rubber));
  }

  // ================= Привод ГРМ =================
  private buildTiming(kin: Kin): void {
    const XC = 0.25;
    // Цепь — огибает звёздочку коленвала и обе муфты VVT
    const circles: Circle2[] = [
      { u: 0, v: 0, r: 0.03 },
      { u: 0.06, v: 0.343, r: 0.047 },
      { u: -0.06, v: 0.343, r: 0.047 },
      { u: -0.055, v: 0.12, r: 0.012 },
    ];
    const pts = hullPath(circles, 12).map(([u, vv]) => v(XC, vv, u));
    const tex = stripeTexture('chain');
    const ch = loopTube(pts, 0.0045, new THREE.MeshStandardMaterial({ map: tex, metalness: 0.8, roughness: 0.35 }), 6);
    tex.repeat.set(ch.length / 0.032, 1);
    const chain = this.P('chain', [1, 0, 0]);
    chain.add(ch.mesh);
    chain.add(cyl(0.03, 0.012, M.darkSteel, [XC, 0, 0], 'x', 24));
    // Башмаки
    chain.add(box(0.01, 0.26, 0.012, M.plasticGray, [XC, 0.18, -0.075]));
    chain.add(box(0.01, 0.24, 0.012, M.plasticGray, [XC, 0.18, 0.058]));
    kin.chain = { tex, length: ch.length, speedRatio: 0.03 };

    const tn = this.P('chain_tensioner', [0, 0, -1]);
    tn.add(cyl(0.011, 0.05, M.darkAlu, [XC - 0.005, 0.13, -0.1], 'z', 12));
    tn.add(box(0.03, 0.03, 0.012, M.darkAlu, [XC - 0.005, 0.13, -0.122]));
    tn.bolt([XC + 0.006, 0.145, -0.128], [0, 0, -1], 0.004).bolt([XC + 0.006, 0.115, -0.128], [0, 0, -1], 0.004);

    // Крышка цепи
    const tc = this.P('timing_cover', [1, 0, 0]);
    const cover = box(0.026, 0.42, 0.25, M.castAlu, [0.273, 0.16, 0], 0.01);
    cover.userData.shell = true;
    tc.add(cover);
    tc.add(cyl(0.06, 0.026, M.castAlu, [0.273, 0.343, 0], 'x', 24));
    tc.add(cyl(0.04, 0.02, M.castAlu, [0.283, 0.0, 0], 'x', 24)); // сальник
    for (const [y, z] of [[-0.03, 0.11], [-0.03, -0.11], [0.1, 0.12], [0.1, -0.12], [0.25, 0.12], [0.25, -0.12], [0.36, 0.1], [0.36, -0.1]] as [number, number][]) tc.bolt([0.287, y, z], [1, 0, 0]);
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
    const pulley = (r: number, ribs = true): THREE.Group => {
      const g = new THREE.Group();
      g.add(cyl(r, 0.024, M.darkSteel, [0, 0, 0], 'x', 32));
      if (ribs) for (const dx of [-0.008, 0, 0.008]) g.add(torus(r * 0.985, 0.0018, M.steel, [dx, 0, 0], 'x'));
      g.add(cyl(r * 0.35, 0.03, M.steel, [0, 0, 0], 'x', 16));
      return g;
    };
    const mount = (b: PartBuilder, g: THREE.Group, c: { u: number; v: number; r: number }, ratio: number) => {
      g.position.set(XB, c.v, c.u);
      b.add(g);
      kin.spinners.push({ obj: g, axis: 'x', ratio });
    };

    // Шкив коленвала
    const cp = this.P('crank_pulley', [1, 0, 0]);
    const cpg = pulley(P.crank.r);
    cpg.add(box(0.004, 0.01, 0.004, M.yellow, [0.013, P.crank.r - 0.008, 0])); // метка ВМТ
    cpg.add(boltMesh(0.009).rotateZ(-Math.PI / 2).translateY(0.014));
    mount(cp, cpg, P.crank, 1);
    cp.bolts.push(cpg.children[cpg.children.length - 1]);
    cpg.children[cpg.children.length - 1].userData.dir = v(1, 0, 0);

    // Ремень
    const pts = hullPath([P.crank, P.ac, P.tens, P.alt, P.idler, P.pump], 14).map(([u, vv]) => v(XB, vv, u));
    const tex = stripeTexture('belt');
    const bl = loopTube(pts, 0.0035, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), 6);
    bl.mesh.scale.set(1, 1, 1);
    tex.repeat.set(bl.length / 0.02, 1);
    const belt = this.P('drive_belt', [1, 0, 0]);
    belt.add(bl.mesh);
    kin.belt = { tex, length: bl.length, speedRatio: P.crank.r };

    // Натяжитель и обводной
    const tn = this.P('belt_tensioner', [1, 0, 0]);
    tn.add(box(0.03, 0.08, 0.05, M.castAlu, [XB - 0.03, P.tens.v - 0.03, P.tens.u - 0.02], 0.01));
    mount(tn, pulley(P.tens.r, false), P.tens, P.crank.r / P.tens.r);
    tn.bolt([XB + 0.014, P.tens.v, P.tens.u], [1, 0, 0]);
    const id = this.P('idler', [1, 0, 0]);
    mount(id, pulley(P.idler.r, false), P.idler, P.crank.r / P.idler.r);
    id.bolt([XB + 0.014, P.idler.v, P.idler.u], [1, 0, 0]);

    // Помпа
    const wp = this.P('water_pump', [1, 0, 0]);
    wp.add(cyl(0.05, 0.03, M.castAlu, [0.285, P.pump.v, P.pump.u], 'x', 24));
    mount(wp, pulley(P.pump.r), P.pump, P.crank.r / P.pump.r);
    for (const a of [0.6, 2.2, 3.8, 5.2]) wp.bolt([0.299, P.pump.v + Math.cos(a) * 0.045, P.pump.u + Math.sin(a) * 0.045], [1, 0, 0], 0.004);

    // Генератор
    const al = this.P('alternator', [0.3, 0.6, 0.6]);
    const ab = new THREE.Group();
    ab.add(cyl(0.066, 0.1, M.alu, [0, 0, 0], 'x', 32));
    for (let k = 0; k < 16; k++) ab.add(box(0.1, 0.005, 0.012, M.castAlu, [0, 0.066 * Math.cos((k * Math.PI) / 8), 0.066 * Math.sin((k * Math.PI) / 8)]).rotateX((k * Math.PI) / 8));
    ab.add(cyl(0.05, 0.02, M.darkAlu, [-0.06, 0, 0], 'x', 24));
    ab.position.set(0.225, P.alt.v, P.alt.u);
    al.add(ab);
    mount(al, pulley(P.alt.r), P.alt, P.crank.r / P.alt.r);
    al.add(cyl(0.006, 0.02, M.brass, [0.155, P.alt.v + 0.04, P.alt.u + 0.03], 'x', 8)); // клемма B
    al.add(box(0.02, 0.018, 0.026, M.connectorDark, [0.16, P.alt.v + 0.03, P.alt.u - 0.045]));
    al.anchor('B', [0.143, P.alt.v + 0.04, P.alt.u + 0.03]);
    al.pins(['IG', 'S', 'L'], [0.149, P.alt.v + 0.03, P.alt.u - 0.045], [0, 0, 1], 0.007);
    al.bolt([0.29, P.alt.v - 0.06, P.alt.u], [1, 0, 0]).bolt([0.16, P.alt.v - 0.06, P.alt.u - 0.02], [1, 0, 0]);

    // Компрессор кондиционера
    const ac = this.P('ac_comp', [0, -1, 0.5]);
    ac.add(cyl(0.062, 0.18, M.alu, [0.185, P.ac.v, P.ac.u], 'x', 32));
    ac.add(cyl(0.05, 0.03, M.darkAlu, [0.08, P.ac.v, P.ac.u], 'x', 24));
    ac.add(box(0.03, 0.03, 0.03, M.darkAlu, [0.15, P.ac.v + 0.07, P.ac.u - 0.02]));
    ac.add(tube([[0.15, P.ac.v + 0.085, P.ac.u - 0.02], [0.15, 0.15, 0.35], [0.2, 0.3, 0.5]], 0.009, M.darkSteel));
    ac.add(box(0.016, 0.014, 0.02, M.connectorDark, [0.26, P.ac.v + 0.06, P.ac.u + 0.02]));
    mount(ac, pulley(P.ac.r), P.ac, P.crank.r / P.ac.r);
    ac.bolt([0.12, P.ac.v + 0.06, P.ac.u + 0.05], [0, 0, 1]).bolt([0.24, P.ac.v + 0.06, P.ac.u + 0.05], [0, 0, 1]).bolt([0.12, P.ac.v - 0.06, P.ac.u + 0.05], [0, 0, 1]).bolt([0.24, P.ac.v - 0.06, P.ac.u + 0.05], [0, 0, 1]);

    // Стартер (сзади слева, у колокола КПП)
    const st = this.P('starter', [0, 0, -1]);
    st.add(cyl(0.042, 0.13, M.blackPaint, [-0.33, -0.01, -0.19], 'x', 24));
    st.add(cyl(0.026, 0.09, M.alu, [-0.31, 0.055, -0.19], 'x', 20));
    st.add(cyl(0.03, 0.03, M.castAlu, [-0.255, -0.01, -0.19], 'x', 20));
    st.add(cyl(0.006, 0.014, M.brass, [-0.36, 0.068, -0.19], 'x', 8));
    st.add(box(0.012, 0.012, 0.014, M.connectorDark, [-0.36, 0.04, -0.19]));
    st.anchor('30', [-0.37, 0.068, -0.19]);
    st.anchor('50', [-0.368, 0.04, -0.19]);
    st.bolt([-0.245, 0.04, -0.15], [-1, 0, 0]).bolt([-0.245, -0.06, -0.15], [-1, 0, 0]);
    // силовой провод к АКБ
    st.add(tube([[-0.37, 0.068, -0.19], [-0.42, 0.15, -0.05], [-0.48, 0.3, 0.2], [-0.47, 0.38, 0.35]], 0.006, M.rubber));
  }

  // ================= Впуск =================
  private buildIntake(): void {
    // Корпус фильтра (низ)
    const base = this.P('air_box_base');
    base.add(box(0.22, 0.1, 0.26, M.plastic, [-0.51, 0.27, 0.03], 0.015));
    base.add(tube([[-0.51, 0.25, 0.16], [-0.5, 0.25, 0.35], [-0.36, 0.4, 0.55]], 0.03, M.plastic));
    const lid = this.P('air_box_lid', [0, 1, 0]);
    lid.add(box(0.22, 0.05, 0.26, M.plastic, [-0.51, 0.345, 0.03], 0.015));
    lid.add(cyl(0.036, 0.04, M.plastic, [-0.4, 0.345, 0.1], 'x', 20));
    for (const [x, z] of [[-0.61, -0.09], [-0.61, 0.15], [-0.41, -0.09], [-0.41, 0.15]] as [number, number][]) lid.add(box(0.012, 0.03, 0.02, M.plasticGray, [x + Math.sign(x + 0.51) * 0.006, 0.32, z]));
    const filt = this.P('air_filter', [0, 1, 0]);
    const fm = new THREE.MeshStandardMaterial({ map: finTexture('#d8c9a0', '#efe3c3', true, 30), roughness: 0.9 });
    filt.add(box(0.19, 0.03, 0.23, fm, [-0.51, 0.318, 0.03]));
    filt.add(box(0.2, 0.006, 0.24, M.orange, [-0.51, 0.333, 0.03]));

    // ДМРВ
    const maf = this.P('maf', [0, 1, 0]);
    maf.add(box(0.03, 0.04, 0.03, M.plastic, [-0.4, 0.38, 0.1], 0.004));
    maf.add(box(0.024, 0.016, 0.022, M.connectorDark, [-0.4, 0.405, 0.115]));
    maf.pins(['+B', 'E2G', 'VG', 'THA', 'E2'], [-0.4, 0.416, 0.115], [1, 0, 0], 0.005);
    maf.bolt([-0.42, 0.401, 0.09], [0, 1, 0], 0.0035).bolt([-0.38, 0.401, 0.09], [0, 1, 0], 0.0035);

    // Патрубок
    const duct = this.P('air_duct', [0, 1, 0.4]);
    duct.add(corrugated([[-0.38, 0.345, 0.1], [-0.34, 0.33, 0.2], [-0.3, 0.27, 0.29], [-0.272, 0.235, 0.29]], 0.034, M.rubber, 9));
    duct.add(torus(0.036, 0.004, M.steel, [-0.372, 0.345, 0.1], 'x'), torus(0.036, 0.004, M.steel, [-0.28, 0.235, 0.29], 'x'));

    // Дроссель
    const th = this.P('throttle', [-1, 0.3, 0]);
    th.add(cyl(0.035, 0.05, M.alu, [-0.24, 0.235, 0.29], 'x', 24));
    th.add(box(0.045, 0.06, 0.05, M.castAlu, [-0.24, 0.19, 0.29], 0.008));
    th.add(box(0.03, 0.02, 0.02, M.connectorDark, [-0.24, 0.165, 0.31]));
    th.pins(['VC', 'VTA1', 'E2', 'M+'], [-0.24, 0.155, 0.31], [1, 0, 0], 0.006);
    const flap = cyl(0.032, 0.002, M.steel, [-0.24, 0.235, 0.29], 'x', 24);
    th.add(flap);
    for (const [y, z] of [[0.27, 0.32], [0.27, 0.26], [0.2, 0.32], [0.2, 0.26]] as [number, number][]) th.bolt([-0.262, y, z], [-1, 0, 0], 0.0045);

    // Впускной коллектор (спереди, пластик)
    const im = this.P('intake_manifold', [0, 0.4, 1]);
    const plen = box(0.37, 0.1, 0.085, M.plastic, [-0.025, 0.225, 0.29], 0.03);
    plen.userData.shell = true;
    im.add(plen);
    im.add(cyl(0.036, 0.03, M.plastic, [-0.215, 0.235, 0.29], 'x', 20));
    for (let i = 0; i < 4; i++) {
      const x = CX[i];
      const r = tube([[x, 0.285, 0.13], [x, 0.33, 0.175], [x, 0.335, 0.245], [x, 0.29, 0.29]], 0.019, M.plastic, false, 24, 12);
      r.userData.shell = true;
      im.add(r);
    }
    im.add(box(0.4, 0.06, 0.012, M.plastic, [0, 0.288, 0.128], 0.004));
    for (const x of [-0.17, -0.088, 0, 0.088, 0.17]) im.bolt([x, 0.31, 0.136], [0, 0, 1], 0.005);

    // Рампа и форсунки (под коллектором)
    const fr = this.P('fuel_rail', [0, 0.3, 1]);
    fr.add(cyl(0.009, 0.36, M.steel, [0, 0.262, 0.175], 'x', 12));
    fr.add(tube([[-0.18, 0.262, 0.175], [-0.22, 0.2, 0.2], [-0.25, 0.05, 0.1]], 0.004, M.darkSteel));
    fr.bolt([-0.09, 0.27, 0.178], [0, 0, 1], 0.0045).bolt([0.09, 0.27, 0.178], [0, 0, 1], 0.0045);
    for (let i = 0; i < 4; i++) {
      const inj = this.P(`injector_${i + 1}`, [0, 0.4, 1]);
      const a = v(CX[i], 0.258, 0.168), b = v(CX[i], 0.277, 0.14);
      inj.add(rod(a, b, 0.007, M.plastic, 12));
      inj.add(box(0.012, 0.012, 0.012, M.connectorDark, [CX[i] + 0.012, 0.262, 0.16]));
      inj.pins(['B', 'S'], [CX[i] + 0.012, 0.27, 0.16], [0, 0, 1], 0.006);
    }
  }

  // ================= Выпуск =================
  private buildExhaust(): void {
    const ex = this.P('exhaust_manifold', [0, 0.2, -1]);
    for (let i = 0; i < 4; i++) {
      const x = CX[i];
      ex.add(tube([[x, 0.28, -0.122], [x * 0.9, 0.29, -0.17], [x * 0.4, 0.25, -0.24], [0, 0.2, -0.27]], 0.017, M.exhaust, false, 20, 10));
    }
    ex.add(box(0.42, 0.06, 0.012, M.exhaust, [0, 0.28, -0.125], 0.004));
    ex.add(cyl(0.065, 0.24, M.exhaust, [0, 0.07, -0.29], 'y', 28)); // катализатор
    ex.add(cyl(0.04, 0.05, M.exhaust, [0, 0.215, -0.28], 'y', 20, 0.06));
    ex.add(tube([[0, -0.05, -0.29], [0, -0.14, -0.3], [0.02, -0.2, -0.38], [0.05, -0.22, -0.55]], 0.025, M.exhaust));
    for (const x of [-0.18, -0.088, 0, 0.088, 0.18]) ex.bolt([x, 0.3, -0.132], [0, 0, -1]);
    const hs = this.P('heat_shield', [0, 1, -0.3]);
    const s = box(0.44, 0.008, 0.18, M.heatShield, [0, 0.33, -0.21], 0.004);
    s.rotation.x = -0.35;
    s.userData.shell = true;
    hs.add(s);
    for (let k = -4; k <= 4; k++) { const r = box(0.006, 0.01, 0.17, M.heatShield, [k * 0.045, 0.337, -0.21]); r.rotation.x = -0.35; hs.add(r); }
    hs.bolt([-0.19, 0.36, -0.13]).bolt([0.19, 0.36, -0.13]).bolt([-0.19, 0.3, -0.28]).bolt([0.19, 0.3, -0.28]);

    const o2u = this.P('o2_up', [0, 1, -0.3]);
    o2u.add(cyl(0.009, 0.06, M.steel, [0.06, 0.26, -0.29], 'y', 12));
    o2u.add(cyl(0.012, 0.012, M.steel, [0.06, 0.24, -0.29], 'y', 6));
    o2u.add(tube([[0.06, 0.29, -0.29], [0.1, 0.33, -0.33], [0.16, 0.36, -0.36]], 0.004, M.rubber));
    o2u.add(box(0.025, 0.014, 0.02, M.connectorDark, [0.16, 0.365, -0.36]));
    o2u.pins(['OX', 'E2', 'HT', '+B'], [0.16, 0.374, -0.36], [1, 0, 0], 0.005);
    const o2d = this.P('o2_down', [0, -0.3, -1]);
    o2d.add(cyl(0.009, 0.05, M.steel, [0.0, -0.12, -0.33], 'z', 12));
    o2d.add(tube([[0, -0.12, -0.355], [0.05, -0.08, -0.4], [0.12, 0.05, -0.43]], 0.004, M.rubber));
    o2d.add(box(0.025, 0.014, 0.02, M.connectorDark, [0.12, 0.06, -0.43]));
    o2d.pins(['OX', 'E2', 'HT', '+B'], [0.12, 0.069, -0.43], [1, 0, 0], 0.005);
  }

  // ================= Охлаждение =================
  private buildCooling(kin: Kin): void {
    const rad = this.P('radiator', [0, 1, 0]);
    const core = new THREE.MeshStandardMaterial({ map: finTexture(), roughness: 0.8, metalness: 0.4 });
    (core.map as THREE.Texture).repeat.set(6, 1);
    rad.add(box(0.66, 0.4, 0.025, core, [0.0, 0.23, 0.515]));
    rad.add(box(0.05, 0.44, 0.04, M.plastic, [-0.355, 0.23, 0.515], 0.008), box(0.05, 0.44, 0.04, M.plastic, [0.355, 0.23, 0.515], 0.008));
    rad.add(cyl(0.017, 0.04, M.plastic, [-0.355, 0.4, 0.48], 'z', 14), cyl(0.017, 0.04, M.plastic, [-0.355, 0.07, 0.48], 'z', 14));
    rad.add(cyl(0.006, 0.02, M.yellow, [0.355, 0.03, 0.535], 'z', 8)); // сливной кран
    rad.bolt([-0.33, 0.46, 0.53]).bolt([0.33, 0.46, 0.53]);

    const fan = this.P('fan', [0, 1, 0.3]);
    fan.add(box(0.6, 0.38, 0.012, M.plastic, [0.05, 0.23, 0.485], 0.01));
    fan.add(torus(0.155, 0.012, M.plastic, [0.06, 0.23, 0.475], 'z'));
    fan.add(cyl(0.045, 0.06, M.blackPaint, [0.06, 0.23, 0.45], 'z', 20));
    const blades = new THREE.Group();
    blades.position.set(0.06, 0.23, 0.468);
    blades.add(cyl(0.035, 0.03, M.plastic, [0, 0, 0], 'z', 16));
    for (let k = 0; k < 7; k++) {
      const b = box(0.11, 0.04, 0.004, M.plastic, [0.075, 0, 0]);
      const piv = new THREE.Group();
      b.rotation.x = 0.4;
      piv.add(b);
      piv.rotation.z = (k / 7) * Math.PI * 2;
      blades.add(piv);
    }
    fan.add(blades);
    kin.fan = blades;
    fan.add(box(0.02, 0.016, 0.014, M.connectorDark, [0.11, 0.27, 0.44]));
    fan.pins(['+', '-'], [0.11, 0.27, 0.432], [1, 0, 0], 0.007);
    fan.bolt([-0.22, 0.42, 0.49], [0, 0, -1]).bolt([0.32, 0.42, 0.49], [0, 0, -1]);

    const uh = this.P('upper_hose', [0, 1, 0]);
    uh.add(tube([[-0.27, 0.3, 0.05], [-0.3, 0.34, 0.16], [-0.33, 0.4, 0.38], [-0.355, 0.4, 0.47]], 0.017, M.rubber, false, 40, 12));
    const lh = this.P('lower_hose', [0, -0.5, 0.8]);
    lh.add(tube([[-0.2, 0.11, 0.155], [-0.22, 0.08, 0.25], [-0.3, 0.06, 0.4], [-0.355, 0.07, 0.47]], 0.017, M.rubber, false, 40, 12));
    const thm = this.P('thermostat', [0, 0, 1]);
    thm.add(cyl(0.028, 0.03, M.castAlu, [-0.2, 0.11, 0.142], 'z', 20));
    thm.add(cyl(0.018, 0.02, M.castAlu, [-0.2, 0.11, 0.155], 'z', 16));
    thm.bolt([-0.225, 0.13, 0.155], [0, 0, 1], 0.004).bolt([-0.175, 0.09, 0.155], [0, 0, 1], 0.004);
    // Блок: прилив под термостат
    const bl = this.builders.find((b) => b.id === 'block')!;
    bl.add(box(0.06, 0.06, 0.02, M.castAlu, [-0.2, 0.11, 0.128], 0.008));

    const et = this.P('exp_tank', [0, 1, 0]);
    et.add(box(0.1, 0.12, 0.08, M.tankWhite, [0.52, 0.32, 0.4], 0.015));
    et.add(box(0.09, 0.06, 0.07, new THREE.MeshStandardMaterial({ color: 0xe5559a, transparent: true, opacity: 0.8 }), [0.52, 0.29, 0.4]));
    et.add(cyl(0.02, 0.02, M.plastic, [0.52, 0.39, 0.4], 'y', 16));
    et.add(tube([[0.52, 0.27, 0.44], [0.45, 0.42, 0.5], [0.355, 0.44, 0.52]], 0.005, M.rubber));
    et.bolt([0.575, 0.36, 0.4], [1, 0, 0], 0.004);
  }

  // ================= Смазка =================
  private buildLube(): void {
    const pan = this.P('oil_pan', [0, -1, 0]);
    const pn = box(0.44, 0.1, 0.22, M.darkSteel, [0.0, -0.145, -0.005], 0.015);
    pn.userData.shell = true;
    pan.add(pn);
    pan.add(box(0.46, 0.008, 0.235, M.darkSteel, [0, -0.1, -0.005]));
    for (let k = -3; k <= 3; k++) { pan.bolt([k * 0.065, -0.097, 0.118], [0, -1, 0], 0.004); pan.bolt([k * 0.065, -0.097, -0.128], [0, -1, 0], 0.004); }
    const dr = this.P('oil_drain', [0, -1, 0]);
    dr.add(cyl(0.012, 0.004, M.copper, [0.12, -0.197, 0.0], 'y', 16));
    dr.bolt([0.12, -0.199, 0.0], [0, -1, 0], 0.008);
    const of = this.P('oil_filter', [0, -1, 0]);
    of.add(cyl(0.038, 0.08, M.plastic, [-0.05, -0.045, 0.165], 'y', 28));
    of.add(cyl(0.04, 0.012, M.plastic, [-0.05, -0.09, 0.165], 'y', 6));
    of.add(cyl(0.009, 0.01, M.plasticGray, [-0.05, -0.1, 0.165], 'y', 8));
    // корпус фильтра на блоке
    const bl = this.builders.find((b) => b.id === 'block')!;
    bl.add(box(0.09, 0.03, 0.06, M.castAlu, [-0.05, 0.0, 0.15], 0.008));
    const ds = this.P('dipstick', [0, 1, 0]);
    ds.add(torus(0.014, 0.004, M.yellow, [-0.212, 0.445, 0.16], 'z'));
    ds.add(cyl(0.003, 0.03, M.yellow, [-0.212, 0.425, 0.16], 'y', 6));
  }

  // ================= Электрика: АКБ, блок реле, ЭБУ, жгуты, датчики =================
  private buildElectric(): void {
    // АКБ
    const bat = this.P('battery', [0, 1, 0]);
    bat.add(box(0.2, 0.2, 0.17, M.battery, [-0.52, 0.27, 0.33], 0.008));
    bat.add(box(0.2, 0.012, 0.17, M.plasticGray, [-0.52, 0.375, 0.33], 0.004));
    bat.add(labelPlane('12V  60Ah\n540A (EN)', 0.14, 0.07, '#23272d', '#d0d4da').translateX(-0.52).translateY(0.28).translateZ(0.4155));
    bat.add(cyl(0.009, 0.018, M.steel, [-0.47, 0.39, 0.37], 'y', 14), cyl(0.009, 0.018, M.steel, [-0.57, 0.39, 0.37], 'y', 14));
    bat.anchor('+', [-0.47, 0.401, 0.37]);
    bat.anchor('-', [-0.57, 0.401, 0.37]);
    bat.add(labelPlane('+', 0.02, 0.02, '#c8323a', '#ffffff', 'bold 400px sans-serif').translateX(-0.47).translateY(0.3815).translateZ(0.395).rotateX(-Math.PI / 2));
    bat.add(labelPlane('−', 0.02, 0.02, '#1c1e22', '#ffffff', 'bold 400px sans-serif').translateX(-0.57).translateY(0.3815).translateZ(0.395).rotateX(-Math.PI / 2));
    // площадка
    const bay = this.builders.find((b) => b.id === 'bay')!;
    bay.add(box(0.24, 0.02, 0.2, M.darkSteel, [-0.52, 0.16, 0.33], 0.004));

    const bp = this.P('battery_pos', [0, 1, 0]);
    bp.add(box(0.03, 0.016, 0.022, M.copper, [-0.47, 0.393, 0.37], 0.003));
    bp.add(box(0.03, 0.012, 0.04, M.red, [-0.47, 0.405, 0.375], 0.004));
    bp.add(tube([[-0.47, 0.395, 0.385], [-0.45, 0.39, 0.3], [-0.47, 0.38, 0.2], [-0.52, 0.34, -0.12]], 0.006, M.red));
    bp.anchor('clamp', [-0.455, 0.396, 0.37]);
    bp.bolt([-0.47, 0.41, 0.362], [0, 1, 0], 0.004);
    const bn = this.P('battery_neg', [0, 1, 0]);
    bn.add(box(0.03, 0.016, 0.022, M.darkSteel, [-0.57, 0.393, 0.37], 0.003));
    bn.add(tube([[-0.57, 0.395, 0.38], [-0.62, 0.39, 0.32], [-0.7, 0.38, 0.28]], 0.006, M.rubber));
    bn.anchor('clamp', [-0.585, 0.396, 0.37]);
    bn.bolt([-0.57, 0.405, 0.362], [0, 1, 0], 0.004);
    const bc = this.P('battery_clamp', [0, 1, 0]);
    bc.add(box(0.02, 0.008, 0.18, M.darkSteel, [-0.52, 0.386, 0.33]));
    bc.bolt([-0.52, 0.392, 0.235]).bolt([-0.52, 0.392, 0.425]);

    // Блок реле и предохранителей
    const fb = this.P('fusebox');
    const FB = { x: -0.54, y: 0.29, z: -0.25 };
    fb.add(box(0.17, 0.09, 0.18, M.plastic, [FB.x, FB.y - 0.02, FB.z], 0.01));
    fb.add(box(0.16, 0.004, 0.17, M.plasticGray, [FB.x, FB.y + 0.026, FB.z]));
    const lid = this.P('fusebox_lid', [0, 1, 0]);
    lid.add(box(0.178, 0.04, 0.188, M.plastic, [FB.x, FB.y + 0.05, FB.z], 0.012));
    lid.add(labelPlane('RELAY BOX', 0.1, 0.03, '#1c1e22', '#8f949b').translateX(FB.x).translateY(FB.y + 0.0705).translateZ(FB.z).rotateX(-Math.PI / 2));
    // предохранители: id, цвет, x, z
    const fuses: [string, THREE.Material, number, number, boolean][] = [
      ['fuse_am2', M.green, -0.03, -0.06, true], ['fuse_rdi', M.green, 0.0, -0.06, true],
      ['fuse_efi', M.yellow, -0.055, 0.0, false], ['fuse_efi2', M.red, -0.035, 0.0, false], ['fuse_ig2', M.blue, -0.015, 0.0, false],
      ['fuse_etcs', M.red, 0.005, 0.0, false], ['fuse_alts', M.brown, 0.025, 0.0, false],
    ];
    for (const [fid, mat, dx, dz, maxi] of fuses) {
      const f = this.P(fid, [0, 1, 0]);
      const x = FB.x + dx, z = FB.z + dz;
      if (maxi) {
        f.add(box(0.022, 0.02, 0.01, mat, [x, FB.y + 0.035, z], 0.002));
        f.add(box(0.012, 0.008, 0.006, M.ceramic, [x, FB.y + 0.046, z]));
      } else {
        f.add(box(0.012, 0.018, 0.005, mat, [x, FB.y + 0.035, z], 0.0015));
      }
      f.anchor('in', [x - (maxi ? 0.007 : 0.004), FB.y + (maxi ? 0.047 : 0.045), z]);
      f.anchor('out', [x + (maxi ? 0.007 : 0.004), FB.y + (maxi ? 0.047 : 0.045), z]);
      // гнёзда на блоке
      fb.add(box(maxi ? 0.026 : 0.016, 0.006, maxi ? 0.014 : 0.009, M.connectorDark, [x, FB.y + 0.028, z]));
    }
    // декоративные предохранители
    for (let k = 0; k < 4; k++) fb.add(box(0.012, 0.018, 0.005, [M.red, M.blue, M.yellow, M.red][k], [FB.x + 0.045 + k * 0.012, FB.y + 0.035, FB.z]));
    // реле
    const relays: [string, number, number][] = [['relay_efi', -0.045, 0.06], ['relay_copn', -0.005, 0.06], ['relay_st', 0.035, 0.06], ['relay_fan', 0.05, -0.06]];
    for (const [rid, dx, dz] of relays) {
      const r = this.P(rid, [0, 1, 0]);
      const x = FB.x + dx, z = FB.z + dz;
      r.add(box(0.028, 0.03, 0.028, M.plastic, [x, FB.y + 0.043, z], 0.003));
      r.add(labelPlane(rid.replace('relay_', '').toUpperCase(), 0.024, 0.012, '#1c1e22', '#c9ced4', 'bold 150px sans-serif').translateX(x).translateY(FB.y + 0.0585).translateZ(z).rotateX(-Math.PI / 2));
      const pinPos: Record<string, V3> = { '1': [x - 0.009, FB.y + 0.059, z - 0.009], '2': [x + 0.009, FB.y + 0.059, z - 0.009], '3': [x - 0.009, FB.y + 0.059, z + 0.009], '5': [x + 0.009, FB.y + 0.059, z + 0.009] };
      for (const [nm, p] of Object.entries(pinPos)) r.anchor(nm, p);
      fb.add(box(0.03, 0.006, 0.03, M.connectorDark, [x, FB.y + 0.028, z]));
      for (const [nm, p] of Object.entries(pinPos)) fb.anchor(`${rid}.${nm}`, [p[0], FB.y + 0.032, p[2]]);
    }
    fb.add(tube([[FB.x, FB.y - 0.06, FB.z + 0.09], [-0.5, 0.2, -0.05], [-0.45, 0.3, 0.2]], 0.01, M.plastic));

    // ЭБУ
    const ecu = this.P('ecu', [0, 1, 0]);
    const E = { x: -0.32, y: 0.31, z: -0.4 };
    ecu.add(box(0.16, 0.035, 0.12, M.alu, [E.x, E.y, E.z], 0.006));
    for (let k = -3; k <= 3; k++) ecu.add(box(0.15, 0.004, 0.006, M.alu, [E.x, E.y + 0.019, E.z + k * 0.015]));
    ecu.add(labelPlane('ECM\n89661-xxxxx', 0.07, 0.035, '#d8dce0', '#2a2d31', 'bold 70px sans-serif').translateX(E.x - 0.03).translateY(E.y + 0.0222).translateZ(E.z).rotateX(-Math.PI / 2));
    for (const [dx, dz] of [[-0.085, -0.055], [0.085, -0.055], [-0.085, 0.055], [0.085, 0.055]] as [number, number][]) ecu.bolt([E.x + dx, E.y - 0.005, E.z + dz], [0, 1, 0], 0.004);
    bay.add(box(0.2, 0.01, 0.14, M.darkSteel, [E.x, E.y - 0.025, E.z]));
    const conn = this.P('ecu_conn', [0, 0, 1]);
    conn.add(box(0.06, 0.03, 0.025, M.connector, [E.x - 0.04, E.y, E.z + 0.07], 0.004));
    conn.add(box(0.05, 0.03, 0.025, M.connector, [E.x + 0.035, E.y, E.z + 0.07], 0.004));
    conn.add(box(0.06, 0.006, 0.03, M.plasticGray, [E.x - 0.04, E.y + 0.018, E.z + 0.07]));
    conn.pins(['+B', 'BATT', 'E1', 'THW', 'VG', 'NE+', 'FC'], [E.x, E.y + 0.017, E.z + 0.084], [1, 0, 0], 0.01);
    // Жгут двигателя (декоративный)
    const harness = this.builders.find((b) => b.id === 'head')!;
    const hm = M.plasticGray;
    harness.add(tube([[E.x, E.y, E.z + 0.08], [-0.27, 0.4, -0.2], [-0.15, 0.44, -0.13], [0.2, 0.44, -0.12], [0.25, 0.42, -0.02]], 0.011, M.plastic, false, 60, 10));
    for (let i = 0; i < 4; i++) harness.add(tube([[CX[i], 0.44, -0.12], [CX[i], 0.46, -0.08], [CX[i], 0.462, -0.05]], 0.004, hm, false, 10, 6));
    harness.add(tube([[-0.2, 0.44, -0.13], [-0.25, 0.36, -0.05], [-0.27, 0.32, 0.06]], 0.005, hm, false, 20, 6));

    // ---------- Датчики ----------
    const ect = this.P('ect', [-1, 0, 0]);
    ect.add(cyl(0.008, 0.02, M.brass, [-0.29, 0.31, 0.02], 'x', 6));
    ect.add(box(0.016, 0.018, 0.018, M.connectorDark, [-0.305, 0.31, 0.02], 0.003));
    ect.pins(['THW', 'E2'], [-0.315, 0.31, 0.02], [0, 0, 1], 0.007);

    const ckp = this.P('ckp', [0, 0, 1]);
    ckp.add(cyl(0.009, 0.03, M.plastic, [0.27, -0.03, 0.105], 'z', 12));
    ckp.add(box(0.016, 0.014, 0.014, M.connectorDark, [0.27, -0.03, 0.125]));
    ckp.add(box(0.025, 0.006, 0.012, M.darkSteel, [0.283, -0.03, 0.098]));
    ckp.bolt([0.293, -0.03, 0.1], [1, 0, 0], 0.004);
    ckp.pins(['NE+', 'NE-'], [0.27, -0.03, 0.135], [0, 1, 0], 0.007);

    for (const [id, z] of [['cmp_in', 0.115], ['cmp_ex', -0.115]] as [string, number][]) {
      const c = this.P(id, [0, 0, Math.sign(z)]);
      c.add(cyl(0.009, 0.03, M.plastic, [0.245, 0.343, z + Math.sign(z) * 0.01], 'z', 12));
      c.add(box(0.018, 0.016, 0.014, M.connectorDark, [0.245, 0.343, z + Math.sign(z) * 0.03]));
      c.bolt([0.263, 0.343, z + Math.sign(z) * 0.005], [0, 0, Math.sign(z)], 0.004);
      c.pins(['VC', 'VV', 'E2'], [0.245, 0.343, z + Math.sign(z) * 0.04], [0, 1, 0], 0.005);
    }
    const kn = this.P('knock', [0, 0, 1]);
    kn.add(cyl(0.016, 0.012, M.plastic, [0.0, 0.11, 0.132], 'z', 16));
    kn.add(box(0.014, 0.012, 0.012, M.connectorDark, [0.02, 0.11, 0.135]));
    kn.bolt([0.0, 0.11, 0.139], [0, 0, 1], 0.005);
    kn.pins(['KNK', 'EKNK'], [0.03, 0.11, 0.135], [0, 1, 0], 0.006);
    const op = this.P('oil_press', [0, 0, 1]);
    op.add(cyl(0.011, 0.025, M.brass, [-0.14, 0.03, 0.137], 'z', 6));
    op.add(cyl(0.006, 0.01, M.connectorDark, [-0.14, 0.03, 0.153], 'z', 10));
    op.anchor('SIG', [-0.14, 0.03, 0.16]);
  }
}
