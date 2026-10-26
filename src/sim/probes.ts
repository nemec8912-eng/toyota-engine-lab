// Точки замера (выводы разъёмов, клеммы, контактные площадки предохранителей) и
// расчёт показаний мультиметра и контрольной лампы.
import { store, partById } from '../core/store';
import { sim, ntcOhm } from './engine';

export interface ProbePoint {
  id: string;           // имя якоря в 3D-модели, напр. 'coil_1:B'
  part: string;         // деталь, к которой относится (для группировки)
  label: string;        // подпись
  hint?: string;        // что это за вывод
  ground?: boolean;     // точка массы
  signal?: boolean;     // сигнальная цепь ЭБУ (контролькой нельзя)
  visible: () => boolean;
  v: () => number;      // потенциал относительно массы кузова, В
  ac?: () => number;    // переменная составляющая, В (RMS)
  gndOhm?: () => number | null; // сопротивление на массу (для датчиков-выключателей)
}

interface ResPair { a: string; b: string; ohm: () => number | null }

const points: ProbePoint[] = [];
const pairs: ResPair[] = [];
const n = () => sim.net;
const ig = () => (sim.ign === 'on' || sim.ign === 'start');
const turning = () => sim.running || sim.cranking;

function add(p: Omit<ProbePoint, 'visible' | 'label' | 'part'> & { label?: string; visible?: () => boolean }): void {
  const [part, pin] = p.id.split(':');
  const name = partById.get(part)?.name ?? part;
  points.push({
    visible: () => store.installed(part),
    label: `${name} — ${pin}`,
    part,
    ...p,
  } as ProbePoint);
}
function pair(a: string, b: string, ohm: () => number | null) { pairs.push({ a, b, ohm }); }

// ---------- Масса и АКБ ----------
add({ id: 'bay:gnd', label: 'Масса кузова (болт на брызговике)', hint: 'Надёжная масса — сюда обычно ставят чёрный щуп', ground: true, visible: () => true, v: () => 0 });
add({ id: 'block:gnd', label: 'Масса двигателя (блок цилиндров)', ground: true, visible: () => true, v: () => 0 });
add({ id: 'battery:+', label: 'АКБ — штырь «+»', hint: 'Сам вывод аккумулятора, под клеммой', v: () => (n().negOk ? n().vPost : 0) });
add({ id: 'battery:-', label: 'АКБ — штырь «−»', ground: true, v: () => (n().negOk ? 0 : -n().vPost) });
add({ id: 'battery_pos:clamp', label: 'Плюсовая клемма (на клемме, не на штыре)', v: () => (n().negOk ? n().vClamp : n().vClamp - n().vPost) });
add({ id: 'battery_neg:clamp', label: 'Минусовая клемма', ground: true, v: () => (sim.cranking ? 0.08 : 0) });

// ---------- Предохранители ----------
const fuseFeeds: Record<string, [() => number, () => number]> = {
  fuse_am2: [() => n().bplus, () => n().am2],
  fuse_rdi: [() => n().bplus, () => n().rdi],
  fuse_efi: [() => n().bplus, () => n().efiFuseOut],
  fuse_efi2: [() => n().efiB, () => n().efi2],
  fuse_ig2: [() => n().ig2feed, () => n().ig2],
  fuse_etcs: [() => n().bplus, () => n().etcs],
  fuse_alts: [() => n().bplus, () => n().alts],
};
for (const [fid, [vin, vout]] of Object.entries(fuseFeeds)) {
  const nm = partById.get(fid)!.name.replace('Предохранитель ', '');
  add({ id: `${fid}:in`, label: `Пред. ${nm} — площадка 1`, hint: 'Контрольная площадка на корпусе предохранителя', v: vin });
  add({ id: `${fid}:out`, label: `Пред. ${nm} — площадка 2`, hint: 'Контрольная площадка на корпусе предохранителя', v: vout });
  pair(`${fid}:in`, `${fid}:out`, () => (store.defect(fid) === 'blown' ? null : 0.1));
}

// ---------- Реле (на реле — щупом сзади) и гнёзда (реле снято) ----------
type RelayPins = { r1: () => number; r2: () => number; r3: () => number; r5: () => number; s1: () => number; s3: () => number; on: () => boolean };
const relayPins: Record<string, RelayPins> = {
  relay_efi: {
    r1: () => (ig() ? n().am2 : 0), r2: () => 0, r3: () => n().efiFuseOut, r5: () => n().efiB,
    s1: () => (ig() ? n().am2 : 0), s3: () => n().efiFuseOut, on: () => n().efiRelayOn,
  },
  relay_copn: {
    r1: () => n().efiB,
    r2: () => (store.defect('relay_copn') === 'coil_open' ? 0 : n().copnOn ? 0.8 : n().efiB),
    r3: () => n().efiB, r5: () => n().pumpV,
    s1: () => n().efiB, s3: () => n().efiB, on: () => n().copnOn,
  },
  relay_st: {
    r1: () => (sim.ign === 'start' ? n().am2 : 0), r2: () => 0, r3: () => n().am2, r5: () => (n().stRelayOn ? n().am2 : 0),
    s1: () => (sim.ign === 'start' ? n().am2 : 0), s3: () => n().am2, on: () => n().stRelayOn,
  },
  relay_fan: {
    r1: () => (n().igOn ? n().am2 : 0),
    r2: () => (store.defect('relay_fan') === 'coil_open' ? 0 : n().fanRelayOn ? 0.8 : n().igOn ? n().am2 : 0),
    r3: () => n().rdi, r5: () => n().fanV,
    s1: () => (n().igOn ? n().am2 : 0), s3: () => n().rdi, on: () => n().fanRelayOn,
  },
};
const PIN_HINT: Record<string, string> = { '1': 'обмотка, питание', '2': 'обмотка, управление/масса', '3': 'силовой контакт, вход', '5': 'силовой контакт, выход на нагрузку' };
for (const [rid, rp] of Object.entries(relayPins)) {
  const nm = partById.get(rid)!.name;
  const map: Record<string, () => number> = { '1': rp.r1, '2': rp.r2, '3': rp.r3, '5': rp.r5 };
  for (const pin of ['1', '2', '3', '5']) {
    add({ id: `${rid}:${pin}`, label: `${nm} — вывод ${pin}`, hint: PIN_HINT[pin], v: map[pin] });
    const sv = pin === '1' ? rp.s1 : pin === '3' ? rp.s3 : () => 0;
    add({ id: `fusebox:${rid}.${pin}`, label: `Гнездо: ${nm} — ${pin}`, hint: PIN_HINT[pin], visible: () => !store.installed(rid), v: sv });
  }
  pair(`${rid}:1`, `${rid}:2`, () => (store.defect(rid) === 'coil_open' ? null : 86));
  pair(`${rid}:3`, `${rid}:5`, () => (rp.on() ? 0.1 : null));
}

// ---------- Катушки и форсунки ----------
for (let i = 1; i <= 4; i++) {
  const c = `coil_${i}`;
  add({ id: `${c}:B`, hint: '+B, питание от предохранителя IG2', v: () => n().ig2 });
  add({ id: `${c}:IGT`, hint: 'Сигнал зажигания от ЭБУ (импульсы 0–5 В)', signal: true, v: () => (n().ecuOn && turning() && store.live('ckp') && store.defect('ckp') !== 'open' ? 0.4 + sim.rpmVisual / 12000 : 0) });
  add({ id: `${c}:GND`, hint: 'Масса катушки', ground: true, v: () => 0 });
  const inj = `injector_${i}`;
  const duty = () => (sim.running ? Math.min(0.5, (sim.injMs * sim.rpmVisual) / 120000) : 0);
  add({ id: `${inj}:B`, hint: '+B, питание от IG2', v: () => n().ig2 });
  add({ id: `${inj}:S`, hint: 'Управление от ЭБУ (масса в момент впрыска)', signal: true,
    v: () => (store.live(inj) ? n().ig2 * (1 - duty()) : 0) });
  pair(`${inj}:B`, `${inj}:S`, () => 12.0);
}

// ---------- Датчики ----------
const ectOk = () => store.defect('ect') !== 'open';
add({ id: 'ect:THW', hint: 'Сигнал температуры ОЖ в ЭБУ (подтяжка к 5 В)', signal: true,
  v: () => { if (!n().ecuOn) return 0; if (!store.live('ect') || !ectOk()) return 5; const r = ntcOhm(sim.coolant); return (5 * r) / (r + 1000); } });
add({ id: 'ect:E2', hint: 'Масса датчиков (через ЭБУ)', ground: true, v: () => 0 });
pair('ect:THW', 'ect:E2', () => (ectOk() ? ntcOhm(sim.coolant) : null));

const ckpOk = () => store.defect('ckp') !== 'open';
const ckpAc = () => (turning() && ckpOk() && store.installed('ckp') ? Math.min(6, 0.25 + sim.rpmVisual / 600) : 0);
add({ id: 'ckp:NE+', hint: 'Сигнал оборотов (переменное напряжение)', signal: true, v: () => 0, ac: ckpAc });
add({ id: 'ckp:NE-', hint: 'Сигнал оборотов, обратный провод', signal: true, v: () => 0 });
pair('ckp:NE+', 'ckp:NE-', () => (ckpOk() ? 1850 : null));

for (const c of ['cmp_in', 'cmp_ex']) {
  add({ id: `${c}:VC`, hint: 'Питание датчика 5 В от ЭБУ', signal: true, v: () => (n().ecuOn ? 5 : 0) });
  add({ id: `${c}:VV`, hint: 'Сигнал (прямоугольные импульсы 0/5 В)', signal: true, v: () => (!n().ecuOn ? 0 : !store.live(c) ? 5 : turning() ? 2.5 : 0.2) });
  add({ id: `${c}:E2`, hint: 'Масса датчика', ground: true, v: () => 0 });
}
for (const o of ['ocv_in', 'ocv_ex']) {
  add({ id: `${o}:+`, hint: 'Управление ШИМ от ЭБУ', signal: true,
    v: () => (n().ecuOn && sim.running ? 12 * (0.3 + (o === 'ocv_in' ? sim.vvtInT : sim.vvtExT) / 100) : 0) });
  add({ id: `${o}:-`, hint: 'Обратный провод в ЭБУ', signal: true, v: () => 0 });
  pair(`${o}:+`, `${o}:-`, () => 7.4);
}
add({ id: 'maf:+B', hint: 'Питание от EFI NO.2', v: () => n().efi2 });
add({ id: 'maf:E2G', hint: 'Масса ДМРВ', ground: true, v: () => 0 });
add({ id: 'maf:VG', hint: 'Сигнал расхода воздуха', signal: true,
  v: () => (!store.live('maf') || n().efi2 < 8 ? 0 : sim.running ? 0.7 + sim.mafRead * 0.2 : 0.6) });
add({ id: 'maf:THA', hint: 'Сигнал температуры воздуха', signal: true,
  v: () => { if (!n().ecuOn) return 0; if (!store.live('maf')) return 5; const r = ntcOhm(sim.ambient + 5); return (5 * r) / (r + 1000); } });
add({ id: 'maf:E2', hint: 'Масса датчика температуры', ground: true, v: () => 0 });
pair('maf:THA', 'maf:E2', () => ntcOhm(sim.ambient + 5));

add({ id: 'throttle:VC', hint: 'Питание датчиков 5 В', signal: true, v: () => (n().ecuOn ? 5 : 0) });
add({ id: 'throttle:VTA1', hint: 'Положение заслонки', signal: true, v: () => (n().ecuOn && store.live('throttle') ? 0.6 + sim.throttleAct * 3.6 : 0) });
add({ id: 'throttle:E2', hint: 'Масса датчиков', ground: true, v: () => 0 });
add({ id: 'throttle:M+', hint: 'Мотор заслонки (ШИМ)', signal: true, v: () => (n().ecuOn && n().etcs > 8 && store.live('throttle') ? 3 + sim.throttleAct * 5 : 0) });

add({ id: 'knock:KNK', hint: 'Сигнал детонации', signal: true, v: () => 0, ac: () => (sim.running && store.live('knock') ? 0.05 + sim.rpmVisual / 60000 : 0) });
add({ id: 'knock:EKNK', hint: 'Обратный провод', signal: true, v: () => 0 });
pair('knock:KNK', 'knock:EKNK', () => 200000);

add({ id: 'oil_press:SIG', hint: 'Провод от лампы давления масла',
  v: () => { if (!n().igOn) return 0; const closed = store.live('oil_press') && sim.oilPressure < 30; return closed ? 0 : n().am2 - 0.3; },
  gndOhm: () => (sim.oilPressure < 30 ? 0.5 : null) });

for (const o of ['o2_up', 'o2_down']) {
  add({ id: `${o}:OX`, hint: 'Сигнал датчика кислорода (0,1–0,9 В)', signal: true, v: () => (store.live(o) ? (o === 'o2_up' ? sim.o2up : sim.o2down) : 0) });
  add({ id: `${o}:E2`, hint: 'Масса сигнала', ground: true, v: () => 0 });
  add({ id: `${o}:HT`, hint: 'Нагреватель, управление от ЭБУ', signal: true, v: () => (store.live(o) ? (sim.running ? 1 : n().efi2) : 0) });
  add({ id: `${o}:+B`, hint: 'Питание нагревателя от EFI NO.2', v: () => n().efi2 });
  pair(`${o}:HT`, `${o}:+B`, () => 13);
}

// ---------- Генератор, стартер, вентилятор ----------
add({ id: 'alternator:B', hint: 'Силовой выход генератора (соединён с «+» АКБ)', v: () => n().bplus });
add({ id: 'alternator:IG', hint: 'Питание от замка зажигания', v: () => n().ig2feed });
add({ id: 'alternator:S', hint: 'Замер напряжения АКБ через ALT-S', v: () => n().alts });
add({ id: 'alternator:L', hint: 'Лампа зарядки (низкий уровень — лампа горит)', v: () => (!n().igOn ? 0 : sim.chargeOk ? 13.5 : 1.5) });
add({ id: 'starter:30', hint: 'Силовой плюс от АКБ', v: () => n().v30 });
add({ id: 'starter:50', hint: 'Управление от реле стартера (12 В в положении START)', v: () => n().st50 });
add({ id: 'fan:+', hint: 'Питание от реле вентилятора', v: () => n().fanV });
add({ id: 'fan:-', hint: 'Масса мотора', ground: true, v: () => 0 });
pair('fan:+', 'fan:-', () => 0.7);

// ---------- ЭБУ ----------
add({ id: 'ecu_conn:+B', hint: 'Основное питание ЭБУ от реле EFI', v: () => n().efiB });
add({ id: 'ecu_conn:BATT', hint: 'Постоянный плюс (память ЭБУ)', v: () => n().bplus });
add({ id: 'ecu_conn:E1', hint: 'Масса ЭБУ', ground: true, v: () => 0 });
add({ id: 'ecu_conn:THW', hint: 'Вход датчика температуры ОЖ', signal: true, v: () => points.find((p) => p.id === 'ect:THW')!.v() });
add({ id: 'ecu_conn:VG', hint: 'Вход ДМРВ', signal: true, v: () => points.find((p) => p.id === 'maf:VG')!.v() });
add({ id: 'ecu_conn:NE+', hint: 'Вход датчика коленвала', signal: true, v: () => 0, ac: ckpAc });
add({ id: 'ecu_conn:FC', hint: 'Управление реле топливного насоса (ЭБУ замыкает на массу)', signal: true, v: () => relayPins.relay_copn.r2() });

export const probePoints = points;
export const probeById = new Map(points.map((p) => [p.id, p]));

// ---------- Измерения ----------
export type MeterMode = 'vdc' | 'vac' | 'ohm' | 'cont';

export interface Reading { text: string; unit: string; value: number | null; beep?: boolean; warn?: string }

function fmt(v: number, digits = 2): string {
  return v.toFixed(digits).replace('.', ',');
}

export function measure(mode: MeterMode, redId: string | null, blackId: string | null): Reading {
  if (!redId || !blackId) return { text: '----', unit: mode === 'ohm' || mode === 'cont' ? 'Ω' : 'V', value: null };
  const red = probeById.get(redId), black = probeById.get(blackId);
  if (!red || !black || !red.visible() || !black.visible()) return { text: '----', unit: 'V', value: null, warn: 'Щуп не на контакте (деталь снята).' };
  const vdc = red.v() - black.v();
  const noise = (Math.random() - 0.5) * 0.004;
  if (mode === 'vdc') {
    const val = Math.abs(vdc) < 0.005 ? 0 : vdc + noise;
    return { text: fmt(val, Math.abs(val) >= 10 ? 2 : 3), unit: 'V⎓', value: val };
  }
  if (mode === 'vac') {
    const ac = (red.ac?.() ?? 0) + (black.ac?.() ?? 0);
    return { text: fmt(ac > 0.005 ? ac + noise : 0, 3), unit: 'V~', value: ac };
  }
  // Сопротивление / прозвонка
  if (Math.abs(vdc) > 0.2) {
    return { text: 'Err', unit: 'Ω', value: null, warn: 'Цепь под напряжением! Сопротивление меряют только на обесточенной цепи (выключите зажигание или отключите разъём).' };
  }
  let ohm: number | null = null;
  if (redId === blackId) ohm = 0.05;
  else {
    const pr = pairs.find((p) => (p.a === redId && p.b === blackId) || (p.a === blackId && p.b === redId));
    if (pr) {
      const [partA] = pr.a.split(':');
      const pd = partById.get(partA);
      if (pd?.connector && store.connected.get(partA) !== false && store.installed(partA)) {
        // На подключённом разъёме измерение идёт параллельно цепям ЭБУ — показание неточное
        const raw = pr.ohm();
        ohm = raw == null ? 8500 : raw * 0.92;
      } else ohm = pr.ohm();
    } else if (red.ground && black.ground) ohm = 0.2;
    else {
      const gp = red.ground ? black : black.ground ? red : null;
      if (gp?.gndOhm) ohm = gp.gndOhm();
      else if (gp?.ground) ohm = 0.2;
    }
  }
  if (mode === 'cont') {
    if (ohm != null && ohm < 30) return { text: fmt(ohm, 1), unit: 'Ω', value: ohm, beep: true };
    return { text: 'OL', unit: 'Ω', value: null };
  }
  if (ohm == null) return { text: 'OL', unit: 'Ω', value: null };
  if (ohm >= 1e6) return { text: fmt(ohm / 1e6, 2), unit: 'MΩ', value: ohm };
  if (ohm >= 1000) return { text: fmt(ohm / 1000, 2), unit: 'kΩ', value: ohm };
  return { text: fmt(ohm + Math.abs(noise) * 10, 1), unit: 'Ω', value: ohm };
}

/** Контрольная лампа: 0 — не горит, 0..1 — яркость. */
export function testLight(redId: string | null, blackId: string | null): { level: number; warn?: string } {
  if (!redId || !blackId) return { level: 0 };
  const red = probeById.get(redId), black = probeById.get(blackId);
  if (!red || !black || !red.visible() || !black.visible()) return { level: 0 };
  const warn = red.signal || black.signal ? 'Осторожно: контрольная лампа нагружает сигнальные цепи ЭБУ и может повредить его. Для сигналов используйте мультиметр.' : undefined;
  const d = Math.abs(red.v() - black.v());
  let level = d >= 10 ? 1 : d >= 6 ? (d - 6) / 4 : 0;
  // Сигнальные цепи с подтяжкой через резистор не дают тока на лампу
  if (red.signal && !red.ground) level *= 0.05;
  return { level, warn };
}
