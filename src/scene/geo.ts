// Вспомогательные функции построения процедурной геометрии.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type V3 = [number, number, number];
export const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------- Материалы ----------
function std(color: number, metal = 0.1, rough = 0.6, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, ...extra });
}

export const M = {
  castAlu: std(0x8e939a, 0.55, 0.55),
  alu: std(0xadb2b8, 0.7, 0.38),
  darkAlu: std(0x7b8087, 0.6, 0.5),
  steel: std(0x9aa1a8, 0.85, 0.3),
  darkSteel: std(0x3c4046, 0.7, 0.45),
  blackPaint: std(0x22252a, 0.3, 0.5),
  plastic: std(0x1c1e22, 0.05, 0.65),
  plasticGray: std(0x3d4148, 0.05, 0.6),
  rubber: std(0x121314, 0.0, 0.9),
  exhaust: std(0x6e6359, 0.6, 0.7),
  heatShield: std(0xd5d9dc, 0.9, 0.35),
  copper: std(0xb87333, 0.9, 0.35),
  brass: std(0xc9a646, 0.9, 0.35),
  ceramic: std(0xf1f0ea, 0.0, 0.4),
  yellow: std(0xf2c230, 0.1, 0.5),
  orange: std(0xe8812d, 0.1, 0.5),
  red: std(0xc8323a, 0.1, 0.5),
  blue: std(0x3b6fd6, 0.1, 0.5),
  green: std(0x3e9a4a, 0.1, 0.5),
  brown: std(0x7a5232, 0.1, 0.5),
  pink: std(0xe96aa0, 0.0, 0.3),
  body: std(0x4a5058, 0.5, 0.45),
  bodyInner: std(0x2f3338, 0.4, 0.6),
  radCore: std(0x2c2f34, 0.5, 0.7),
  battery: std(0x23272d, 0.05, 0.55),
  filter: std(0xe9dcb8, 0.0, 0.85),
  tankWhite: new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.4, transparent: true, opacity: 0.55 }),
  connector: std(0x50555c, 0.05, 0.6),
  connectorDark: std(0x2a2d31, 0.05, 0.6),
  pcb: std(0x2f6b3c, 0.1, 0.6),
};

// ---------- Простые формы ----------
export function box(w: number, h: number, d: number, mat: THREE.Material, pos: V3, radius = 0): THREE.Mesh {
  const g = radius > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat);
  m.position.set(...pos);
  return m;
}

/** Цилиндр вдоль оси 'x' | 'y' | 'z'. */
export function cyl(r: number, h: number, mat: THREE.Material, pos: V3, axis: 'x' | 'y' | 'z' = 'y', seg = 24, rTop?: number, open = false): THREE.Mesh {
  const g = new THREE.CylinderGeometry(rTop ?? r, r, h, seg, 1, open);
  const m = new THREE.Mesh(g, mat);
  if (axis === 'x') m.rotation.z = -Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.position.set(...pos);
  return m;
}

export function sphere(r: number, mat: THREE.Material, pos: V3, seg = 16): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg / 2)), mat);
  m.position.set(...pos);
  return m;
}

export function torus(r: number, tube: number, mat: THREE.Material, pos: V3, axis: 'x' | 'y' | 'z' = 'z'): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 28), mat);
  if (axis === 'x') m.rotation.y = Math.PI / 2;
  if (axis === 'y') m.rotation.x = Math.PI / 2;
  m.position.set(...pos);
  return m;
}

/** Трубка по точкам (сглаженная). */
export function tube(points: V3[], r: number, mat: THREE.Material, closed = false, seg = 48, radial = 10): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => v(...p)), closed, 'catmullrom', 0.3);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, radial, closed), mat);
}

/** Гофрированный патрубок: трубка + кольца. */
export function corrugated(points: V3[], r: number, mat: THREE.Material, rings = 10): THREE.Group {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(points.map((p) => v(...p)), false, 'catmullrom', 0.3);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, r, 14, false), mat));
  for (let i = 1; i < rings; i++) {
    const t = i / rings;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, r * 0.12, 6, 20), mat);
    ring.position.copy(p);
    ring.quaternion.setFromUnitVectors(v(0, 0, 1), tan);
    g.add(ring);
  }
  return g;
}

/** Цилиндр между двумя точками. */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, seg = 10): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  orientBetween(m, a, b);
  return m;
}
export function orientBetween(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  m.position.copy(a).add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).normalize();
  m.quaternion.setFromUnitVectors(v(0, 1, 0), dir);
}

/** Шестигранная головка болта с шайбой; ось — направление выкручивания. */
export function boltMesh(size = 0.0055): THREE.Group {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.CylinderGeometry(size, size, size * 0.9, 6), M.steel);
  head.position.y = size * 0.6;
  const washer = new THREE.Mesh(new THREE.CylinderGeometry(size * 1.35, size * 1.35, size * 0.25, 16), M.steel);
  washer.position.y = size * 0.12;
  g.add(head, washer);
  return g;
}

/** Листовой профиль, выдавленный вдоль Y (вид сверху на плоскость XZ). */
export function plateXZ(outline: [number, number][], holes: { x: number; z: number; r: number }[], height: number, mat: THREE.Material, y: number, bevel = 0.004): THREE.Mesh {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) {
    const p = new THREE.Path();
    p.absarc(h.x, -h.z, h.r, 0, Math.PI * 2, true);
    shape.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.y = y;
  return m;
}

/** Скруглённый прямоугольник как контур. */
export function roundRect(x0: number, z0: number, x1: number, z1: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [[x1 - r, z0 + r, -Math.PI / 2], [x1 - r, z1 - r, 0], [x0 + r, z1 - r, Math.PI / 2], [x0 + r, z0 + r, Math.PI]];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= 5; i++) {
      const a = a0 + (i / 5) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  }
  return pts;
}

// ---------- Ремень и цепь: огибающая окружностей ----------
export interface Circle2 { u: number; v: number; r: number }
/**
 * Огибающая (выпуклая) нескольких окружностей в плоскости (u,v).
 * Окружности должны лежать на выпуклой оболочке. Возвращает замкнутую ломаную.
 */
export function hullPath(circles: Circle2[], arcSeg = 10): [number, number][] {
  const cu = circles.reduce((s, c) => s + c.u, 0) / circles.length;
  const cv = circles.reduce((s, c) => s + c.v, 0) / circles.length;
  const cs = [...circles].sort((a, b) => Math.atan2(a.v - cv, a.u - cu) - Math.atan2(b.v - cv, b.u - cu));
  const N = cs.length;
  const tangents: { a: [number, number]; b: [number, number] }[] = [];
  for (let i = 0; i < N; i++) {
    const c1 = cs[i], c2 = cs[(i + 1) % N];
    const du = c2.u - c1.u, dv = c2.v - c1.v;
    const L = Math.hypot(du, dv);
    const ux = du / L, uy = dv / L;
    const nrx = uy, nry = -ux; // правая нормаль
    const s = (c1.r - c2.r) / L;
    const c = Math.sqrt(Math.max(0, 1 - s * s));
    const nx = nrx * c + ux * s, ny = nry * c + uy * s;
    tangents.push({ a: [c1.u + nx * c1.r, c1.v + ny * c1.r], b: [c2.u + nx * c2.r, c2.v + ny * c2.r] });
  }
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const t = tangents[i];
    pts.push(t.a, t.b);
    // дуга вокруг окружности i+1 от точки t.b до начала следующей касательной
    const c = cs[(i + 1) % N];
    const next = tangents[(i + 1) % N].a;
    let a0 = Math.atan2(t.b[1] - c.v, t.b[0] - c.u);
    let a1 = Math.atan2(next[1] - c.v, next[0] - c.u);
    while (a1 < a0) a1 += Math.PI * 2;
    for (let k = 1; k < arcSeg; k++) {
      const a = a0 + ((a1 - a0) * k) / arcSeg;
      pts.push([c.u + Math.cos(a) * c.r, c.v + Math.sin(a) * c.r]);
    }
  }
  return pts;
}

/** Полилиния → трубка с равномерной развёрткой UV по длине. Возвращает меш и длину. */
export function loopTube(points3: THREE.Vector3[], r: number, mat: THREE.Material, radial = 6, flat = 1): { mesh: THREE.Mesh; length: number } {
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i < points3.length; i++) {
    const a = points3[i], b = points3[(i + 1) % points3.length];
    if (a.distanceTo(b) > 1e-5) path.add(new THREE.LineCurve3(a, b));
  }
  const length = path.getLength();
  const geo = new THREE.TubeGeometry(path as any, Math.max(64, Math.round(length / 0.004)), r, radial, true);
  if (flat !== 1) geo.scale(1, 1, 1);
  return { mesh: new THREE.Mesh(geo, mat), length };
}

/** Текстура «рёбер» для движущегося ремня/цепи. */
export function stripeTexture(kind: 'belt' | 'chain'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 16;
  const g = c.getContext('2d')!;
  if (kind === 'belt') {
    g.fillStyle = '#16171a'; g.fillRect(0, 0, 64, 16);
    g.fillStyle = '#2a2c30';
    for (let i = 0; i < 4; i++) g.fillRect(i * 16, 0, 6, 16);
  } else {
    g.fillStyle = '#5a6068'; g.fillRect(0, 0, 64, 16);
    g.fillStyle = '#b8bec6';
    for (let i = 0; i < 4; i++) { g.fillRect(i * 16 + 1, 2, 10, 12); }
    g.fillStyle = '#2a2d31';
    for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(i * 16 + 13, 8, 3, 0, Math.PI * 2); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Текстура сот радиатора / гофры фильтра. */
export function finTexture(dark = '#24272b', light = '#3b4046', vertical = true, n = 40): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = dark; g.fillRect(0, 0, 128, 128);
  g.fillStyle = light;
  const step = 128 / n;
  for (let i = 0; i < n; i++) {
    if (vertical) g.fillRect(i * step, 0, step * 0.45, 128);
    else g.fillRect(0, i * step, 128, step * 0.45);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Плоская текстовая табличка (наклейка). */
export function labelPlane(text: string, w: number, h: number, bg = '#1c1e22', fg = '#d8dce2', font = 'bold 42px sans-serif'): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.round((512 * h) / w);
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lines = text.split('\n');
  lines.forEach((ln, i) => g.fillText(ln, c.width / 2, (c.height * (i + 1)) / (lines.length + 1)));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
}
