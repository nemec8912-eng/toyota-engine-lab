// Вспомогательные функции построения процедурной геометрии.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type V3 = [number, number, number];
export const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------- Процедурные фактуры ----------
function noiseCanvas(size: number, base: number, amp: number, blobs = 0, seed = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  let x = seed * 9301 + 49297;
  const rnd = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
  for (let i = 0; i < size * size; i++) {
    const n = base + (rnd() - 0.5) * amp;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.max(0, Math.min(255, n));
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // крупные пятна (литьё, неровность окраски)
  for (let k = 0; k < blobs; k++) {
    const r = 4 + rnd() * size * 0.12;
    const gr = g.createRadialGradient(rnd() * size, rnd() * size, 0, rnd() * size, rnd() * size, r);
    const v = rnd() > 0.5 ? 255 : 0;
    gr.addColorStop(0, `rgba(${v},${v},${v},0.10)`);
    gr.addColorStop(1, 'rgba(128,128,128,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
  }
  return c;
}
function tex(c: HTMLCanvasElement, repeat = 4, srgb = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const hasDom = typeof document !== 'undefined';
/** Шершавое литьё: мелкий шум + пятна. */
const castBump = hasDom ? tex(noiseCanvas(256, 128, 120, 60, 3), 6) : null;
/** Порошковая/кракле-краска. */
const crinkleBump = hasDom ? tex(noiseCanvas(256, 128, 200, 0, 7), 10) : null;
/** Мелкая фактура пластика/резины. */
const fineBump = hasDom ? tex(noiseCanvas(128, 128, 70, 0, 11), 14) : null;
const roughVar = hasDom ? tex(noiseCanvas(256, 150, 60, 40, 5), 3) : null;

// ---------- Материалы ----------
function std(color: number, metal = 0.1, rough = 0.6, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, ...extra });
}
const cast = (color: number, metal: number, rough: number, bump = 0.0012) => std(color, metal, rough, { bumpMap: castBump ?? undefined, bumpScale: bump, roughnessMap: roughVar ?? undefined });

export const M = {
  castAlu: cast(0x8f949b, 0.6, 0.62),
  alu: std(0xb3b8be, 0.75, 0.36, { roughnessMap: roughVar ?? undefined }),
  darkAlu: cast(0x6f747b, 0.6, 0.55),
  steel: std(0xa3a9b0, 0.88, 0.28),
  darkSteel: std(0x3a3e44, 0.7, 0.45, { roughnessMap: roughVar ?? undefined }),
  blackPaint: std(0x1d2024, 0.35, 0.55, { bumpMap: crinkleBump ?? undefined, bumpScale: 0.0006 }),
  plastic: std(0x18191c, 0.05, 0.62, { bumpMap: fineBump ?? undefined, bumpScale: 0.0004 }),
  plasticGray: std(0x3a3e45, 0.05, 0.6, { bumpMap: fineBump ?? undefined, bumpScale: 0.0004 }),
  rubber: std(0x111213, 0.0, 0.88, { bumpMap: fineBump ?? undefined, bumpScale: 0.0005 }),
  exhaust: cast(0x6a5d52, 0.65, 0.72, 0.002),
  heatShield: std(0xd0d4d7, 0.92, 0.32, { roughnessMap: roughVar ?? undefined }),
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
  body: std(0x4b525b, 0.35, 0.55),
  bodyInner: std(0x2c3036, 0.45, 0.6, { roughnessMap: roughVar ?? undefined }),
  radCore: std(0x2c2f34, 0.5, 0.7),
  battery: std(0x202328, 0.05, 0.5, { bumpMap: fineBump ?? undefined, bumpScale: 0.0003 }),
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

// ================= Расширенная геометрия (v2.1) =================

/** Тело вращения по профилю [[r, y], ...]; ось — 'x' | 'y' | 'z'. */
export function lathe(profile: [number, number][], mat: THREE.Material, pos: V3, axis: 'x' | 'y' | 'z' = 'y', seg = 32): THREE.Mesh {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg);
  const m = new THREE.Mesh(g, mat);
  if (axis === 'x') m.rotation.z = -Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.position.set(...pos);
  return m;
}

/** Профиль поликлинового шкива: n ручьёв по ширине w, радиус r. */
export function pulleyProfile(r: number, w: number, n = 6, depth = 0.0022, flange = 0.003): [number, number][] {
  const pts: [number, number][] = [[r * 0.3, -w / 2], [r + flange * 0.6, -w / 2], [r + flange * 0.6, -w / 2 + 0.0015]];
  const step = (w - 0.003) / n;
  for (let i = 0; i < n; i++) {
    const y0 = -w / 2 + 0.0015 + i * step;
    pts.push([r, y0 + step * 0.15], [r - depth, y0 + step * 0.5], [r, y0 + step * 0.85]);
  }
  pts.push([r + flange * 0.6, w / 2 - 0.0015], [r + flange * 0.6, w / 2], [r * 0.3, w / 2]);
  return pts;
}

/** Протяжка круглого сечения вдоль кривой с переменным радиусом r(t). */
export function sweep(points: V3[], radius: (t: number) => number, mat: THREE.Material, seg = 48, radial = 14, closed = false): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => v(...p)), closed, 'catmullrom', 0.35);
  const frames = curve.computeFrenetFrames(seg, closed);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, P);
    const r = radius(t);
    const n = frames.normals[i], b = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      N.set(0, 0, 0).addScaledVector(n, Math.cos(a)).addScaledVector(b, Math.sin(a)).normalize();
      pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r);
      nor.push(N.x, N.y, N.z);
      uv.push(t, j / radial);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return new THREE.Mesh(g, mat);
}

/** Патрубок: протяжка с утолщениями на концах и хомутами. */
export function hose(points: V3[], r: number, mat: THREE.Material, clamp: THREE.Material | null = null): THREE.Group {
  const g = new THREE.Group();
  g.add(sweep(points, (t) => r * (1 + 0.12 * (Math.max(0, 1 - t / 0.08) + Math.max(0, 1 - (1 - t) / 0.08))), mat, 40, 12));
  if (clamp) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => v(...p)), false, 'catmullrom', 0.35);
    for (const t of [0.04, 0.96]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.14, r * 0.12, 6, 20), clamp);
      ring.position.copy(curve.getPointAt(t));
      ring.quaternion.setFromUnitVectors(v(0, 0, 1), curve.getTangentAt(t));
      g.add(ring);
    }
  }
  return g;
}

/**
 * Плоская лента (поликлиновой ремень, цепь) по замкнутой ломаной в плоскости X = const.
 * Ширина вдоль X, толщина — по нормали наружу. UV.x — вдоль длины (в метрах * k).
 */
export function ribbonLoop(points: THREE.Vector3[], width: number, thick: number, mat: THREE.Material): { mesh: THREE.Mesh; length: number } {
  const n = points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / n, cz = points.reduce((s, p) => s + p.z, 0) / n;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let len = 0;
  const lens: number[] = [0];
  for (let i = 1; i <= n; i++) { len += points[i % n].distanceTo(points[i - 1]); lens.push(len); }
  const X = v(1, 0, 0);
  // 4 кольца вершин: внешняя кромка ±X и внутренняя кромка ±X
  const rings: THREE.Vector3[][] = [[], [], [], []];
  const outs: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const p = points[i % n];
    const t = points[(i + 1) % n].clone().sub(points[(i - 1 + n) % n]).normalize();
    const o = new THREE.Vector3().crossVectors(t, X).normalize();
    if (o.y * (p.y - cy) + o.z * (p.z - cz) < 0) o.negate();
    outs.push(o);
    const outer = p.clone().addScaledVector(o, thick / 2), inner = p.clone().addScaledVector(o, -thick / 2);
    rings[0].push(outer.clone().addScaledVector(X, -width / 2));
    rings[1].push(outer.clone().addScaledVector(X, width / 2));
    rings[2].push(inner.clone().addScaledVector(X, width / 2));
    rings[3].push(inner.clone().addScaledVector(X, -width / 2));
  }
  // грани: 0-1 наружная, 1-2 торец +X, 2-3 внутренняя, 3-0 торец -X
  const faceNormal = (f: number, i: number) => (f === 0 ? outs[i] : f === 2 ? outs[i].clone().negate() : f === 1 ? X : X.clone().negate());
  for (let f = 0; f < 4; f++) {
    const a = rings[f], b = rings[(f + 1) % 4];
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const nn = faceNormal(f, i);
      pos.push(a[i].x, a[i].y, a[i].z, b[i].x, b[i].y, b[i].z);
      nor.push(nn.x, nn.y, nn.z, nn.x, nn.y, nn.z);
      uv.push(lens[i], f === 2 ? 0 : 0.5, lens[i], f === 2 ? 1 : 0.6);
    }
    for (let i = 0; i < n; i++) {
      const k = base + i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, mat);
  (m.material as THREE.Material).side = THREE.DoubleSide;
  return { mesh: m, length: len };
}

/** Профиль в плоскости (Z, Y), выдавленный вдоль X от x0 до x1. */
export function extrudeX(profile: [number, number][], x0: number, x1: number, mat: THREE.Material, bevel = 0.004): THREE.Mesh {
  // Зеркалим Z в профиле, чтобы после поворота не выворачивать нормали: (−z, y, d) → поворот → (d, y, z)
  const pts = profile.map(([z, y]) => new THREE.Vector2(-z, y));
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
  const shape = new THREE.Shape(pts);
  const depth = Math.max(0.001, x1 - x0 - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 8 });
  g.rotateY(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.x = x0 + bevel;
  return m;
}

/** Гофрированный лист (теплозащитный экран): w × d, волны вдоль X. */
export function corrugatedSheet(w: number, d: number, waves: number, amp: number, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.PlaneGeometry(w, d, waves * 8, 4);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    p.setZ(i, Math.sin((x / w + 0.5) * Math.PI * 2 * waves) * amp);
  }
  g.computeVertexNormals();
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  return m;
}

/** Текстура поликлинового ремня: продольные рёбра + метки (видно движение). */
export function beltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#141517'; g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#202226';
  for (let i = 0; i < 7; i++) g.fillRect(0, 2 + i * 4.3, 256, 1.6);
  g.fillStyle = '#5b5f66';
  g.font = 'bold 9px Arial';
  g.fillText('7PK1516', 20, 22);
  g.fillRect(150, 10, 3, 12);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Плавник/лопасть вентилятора. */
export function bladeShape(len: number, w0: number, w1: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -w0 / 2);
  s.quadraticCurveTo(len * 0.5, -w1 * 0.75, len, -w1 / 2);
  s.quadraticCurveTo(len * 1.05, 0, len, w1 / 2);
  s.quadraticCurveTo(len * 0.5, w1 * 0.4, 0, w0 / 2);
  s.lineTo(0, -w0 / 2);
  return new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: true, bevelSize: 0.001, bevelThickness: 0.001, bevelSegments: 1 });
}
