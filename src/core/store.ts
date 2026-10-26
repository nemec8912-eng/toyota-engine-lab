// Состояние стенда: какие детали установлены, какие экземпляры (юниты) стоят в каких местах,
// подключены ли разъёмы, что лежит на «верстаке» (снятые детали).
import partsData from '../data/parts.json';
import { bus, log } from './bus';

export interface Fastener { n: number; type: string; size: string; socket: string; torque: number }
export interface PartDef {
  id: string;
  name: string;
  group: string;
  kind?: string;
  desc?: string;
  notes?: string;
  specs?: [string, string][];
  fasteners?: Fastener[];
  blockedBy?: string[];
  removable?: boolean;
  connector?: boolean;
  powerOff?: boolean;
}
export interface GroupDef { id: string; name: string }

export interface Unit {
  uid: number;
  kind: string;
  label: string;          // откуда родом, напр. «Катушка зажигания №3 (снята с места №3)»
  defect: string | null;  // код дефекта из faults.json или null
  isNew: boolean;
  home: string;           // место, с которого деталь снята (или для которого куплена)
}

export const groups: GroupDef[] = (partsData as any).groups;
export const parts: PartDef[] = (partsData as any).parts;
export const partById = new Map(parts.map((p) => [p.id, p]));

export function kindOf(p: PartDef): string {
  return p.kind ?? p.id;
}
export function isRemovable(id: string): boolean {
  const p = partById.get(id);
  return !!p && p.removable !== false;
}

/** Внешние условия, которые проверяет store (заполняются симуляцией). */
export const env = {
  engineTurning: () => false as boolean,
};

let uidSeq = 1;

class Store {
  slots = new Map<string, Unit | null>();
  connected = new Map<string, boolean>();
  tray: Unit[] = [];
  /** Новые детали, установленные в текущем сценарии (для оценки). */
  replacements: { slot: string; fixed: boolean }[] = [];
  /** Последний снятый с каждого места экземпляр — чтобы понять, оправдана ли замена. */
  lastRemoved = new Map<string, Unit>();

  constructor() {
    this.resetAll();
  }

  resetAll(): void {
    this.slots.clear();
    this.connected.clear();
    this.tray = [];
    this.replacements = [];
    this.lastRemoved.clear();
    for (const p of parts) {
      if (p.removable === false) continue;
      this.slots.set(p.id, this.makeUnit(p, false));
      if (p.connector) this.connected.set(p.id, true);
    }
  }

  makeUnit(p: PartDef, isNew: boolean): Unit {
    return { uid: uidSeq++, kind: kindOf(p), label: p.name, defect: null, isNew, home: p.id };
  }

  installed(id: string): boolean {
    if (!isRemovable(id)) return true;
    return this.slots.get(id) != null;
  }
  unit(id: string): Unit | null {
    return this.slots.get(id) ?? null;
  }
  /** Деталь установлена и (если есть разъём) подключена. */
  live(id: string): boolean {
    if (!this.installed(id)) return false;
    const p = partById.get(id);
    if (p?.connector) return this.connected.get(id) !== false;
    return true;
  }
  /** Деталь работает: установлена, подключена и без дефекта указанного типа. */
  defect(id: string): string | null {
    return this.slots.get(id)?.defect ?? null;
  }

  /** Детали, которые надо снять раньше этой (они ещё стоят). */
  blockersInstalled(id: string): string[] {
    const p = partById.get(id);
    return (p?.blockedBy ?? []).filter((b) => this.installed(b));
  }
  /** Детали, на которые садится эта (должны стоять перед установкой). */
  supportsMissing(id: string): string[] {
    const res: string[] = [];
    for (const q of parts) {
      if (q.blockedBy?.includes(id) && !this.installed(q.id)) res.push(q.id);
    }
    return res;
  }

  canRemove(id: string): string[] {
    const reasons: string[] = [];
    if (!isRemovable(id)) return ['Деталь не снимается на этом этапе стенда.'];
    if (!this.installed(id)) return ['Деталь уже снята.'];
    if (env.engineTurning()) reasons.push('Заглушите двигатель.');
    const p = partById.get(id)!;
    if (p.powerOff && id !== 'battery_neg' && this.installed('battery_neg')) {
      reasons.push('Сначала отключите минусовую клемму АКБ.');
    }
    const b = this.blockersInstalled(id);
    if (b.length) reasons.push('Мешают: ' + b.map((x) => partById.get(x)!.name).join(', ') + '.');
    return reasons;
  }

  canInstall(id: string): string[] {
    const reasons: string[] = [];
    if (this.installed(id)) return ['Деталь уже установлена.'];
    if (env.engineTurning()) reasons.push('Заглушите двигатель.');
    const b = this.blockersInstalled(id);
    if (b.length) reasons.push('Сначала снимите: ' + b.map((x) => partById.get(x)!.name).join(', ') + '.');
    const s = this.supportsMissing(id);
    if (s.length) reasons.push('Сначала установите: ' + s.map((x) => partById.get(x)!.name).join(', ') + '.');
    return reasons;
  }

  remove(id: string): boolean {
    const r = this.canRemove(id);
    if (r.length) {
      log(r.join(' '), 'warn');
      return false;
    }
    const u = this.slots.get(id)!;
    this.slots.set(id, null);
    this.lastRemoved.set(id, u);
    const p = partById.get(id)!;
    u.label = `${p.name} — снята${u.isNew ? ' (новая)' : ''}`;
    this.tray.push(u);
    log(`Снято: ${p.name}`, 'action');
    bus.emit('parts', undefined);
    return true;
  }

  /** Совместимые экземпляры на верстаке для данного места. */
  compatibleUnits(id: string): Unit[] {
    const k = kindOf(partById.get(id)!);
    return this.tray.filter((u) => u.kind === k);
  }

  /** unitUid = null → поставить новую деталь. */
  install(id: string, unitUid: number | null): boolean {
    const r = this.canInstall(id);
    if (r.length) {
      log(r.join(' '), 'warn');
      return false;
    }
    const p = partById.get(id)!;
    let u: Unit;
    if (unitUid == null) {
      u = this.makeUnit(p, true);
      u.label = `${p.name} (новая)`;
      this.replacements.push({ slot: id, fixed: this.lastRemoved.get(id)?.defect != null });
      log(`Установлена НОВАЯ деталь: ${p.name}`, 'action');
    } else {
      const i = this.tray.findIndex((x) => x.uid === unitUid);
      if (i < 0) return false;
      u = this.tray.splice(i, 1)[0];
      log(`Установлено: ${p.name}`, 'action');
    }
    this.slots.set(id, u);
    if (p.connector) this.connected.set(id, true);
    bus.emit('parts', undefined);
    return true;
  }

  setConnected(id: string, on: boolean): void {
    if (!this.installed(id)) return;
    this.connected.set(id, on);
    const p = partById.get(id)!;
    log(`${on ? 'Подключён' : 'Отключён'} разъём: ${p.name}`, 'action');
    bus.emit('parts', undefined);
  }
}

export const store = new Store();
