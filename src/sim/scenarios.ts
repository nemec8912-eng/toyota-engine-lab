// Сценарии неисправностей: загрузка, подсказки, проверка ремонта и оценка.
import faultsData from '../data/faults.json';
import { store, partById } from '../core/store';
import { bus, log } from '../core/bus';
import { sim } from './engine';

export interface Scenario {
  id: string;
  title: string;
  complaint: string;
  defects: { slot: string; defect: string }[];
  hints: string[];
  cause: string;
  repair: string;
}

export const scenarios: Scenario[] = (faultsData as any).scenarios;
export const defectNames: Record<string, string> = (faultsData as any).defectNames;

export interface ScenarioState {
  current: Scenario | null;
  exam: boolean;
  startedAt: number;
  solved: boolean;
  gaveUp: boolean;
  hintsShown: number;
  result: { seconds: number; replaced: number; extra: string[] } | null;
}

export const scn: ScenarioState = { current: null, exam: false, startedAt: 0, solved: false, gaveUp: false, hintsShown: 0, result: null };

export function startScenario(id: string | null, exam = false): void {
  store.resetAll();
  sim.resetEngine();
  let s: Scenario | null = null;
  if (id === 'random') s = scenarios[Math.floor(Math.random() * scenarios.length)];
  else if (id) s = scenarios.find((x) => x.id === id) ?? null;
  scn.current = s;
  scn.exam = exam || id === 'random';
  scn.startedAt = performance.now();
  scn.solved = false;
  scn.gaveUp = false;
  scn.hintsShown = 0;
  scn.result = null;
  if (s) {
    for (const d of s.defects) {
      const u = store.slots.get(d.slot);
      if (u) u.defect = d.defect;
    }
    log(scn.exam ? 'Экзамен: на стенде скрытая неисправность. Жалоба клиента: ' + s.complaint : `Сценарий «${s.title}». Жалоба клиента: ${s.complaint}`, 'info');
  } else {
    log('Свободный режим: все детали исправны.', 'info');
  }
  bus.emit('parts', undefined);
  bus.emit('scenario', undefined);
}

/** Есть ли где-то на стенде установленная неисправная деталь. */
function anyDefectInstalled(): boolean {
  for (const [, u] of store.slots) if (u?.defect) return true;
  return false;
}

export function checkSolved(): void {
  const s = scn.current;
  if (!s || scn.solved || scn.gaveUp) return;
  if (anyDefectInstalled()) return;
  // Неисправность устранена, когда на местах дефектных деталей стоят исправные.
  const allBack = s.defects.every((d) => store.installed(d.slot));
  if (!allBack) return;
  scn.solved = true;
  const extra = store.replacements.filter((r) => !r.fixed).map((r) => partById.get(r.slot)!.name);
  scn.result = { seconds: (performance.now() - scn.startedAt) / 1000, replaced: store.replacements.length, extra };
  log(`Неисправность устранена! ${s.cause}`, 'ok');
  bus.emit('scenario', undefined);
}

export function giveUp(): void {
  if (!scn.current) return;
  scn.gaveUp = true;
  log(`Ответ: ${scn.current.cause} Ремонт: ${scn.current.repair}`, 'warn');
  bus.emit('scenario', undefined);
}

export function nextHint(): void {
  if (!scn.current) return;
  scn.hintsShown = Math.min(scn.current.hints.length, scn.hintsShown + 1);
  bus.emit('scenario', undefined);
}
