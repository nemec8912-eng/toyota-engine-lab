// Простая шина событий приложения.
type Handler<T> = (payload: T) => void;

export interface Events {
  parts: void;            // изменилось состояние установленных деталей/разъёмов
  select: string | null;  // выбрана деталь
  log: LogEntry;          // новая запись журнала
  scenario: void;         // смена сценария
  probes: void;           // смена точек подключения щупов
  focus: string;          // приблизить камеру к детали
}

export interface LogEntry {
  t: number;
  kind: 'info' | 'ok' | 'warn' | 'err' | 'action';
  text: string;
}

class Bus {
  private map = new Map<keyof Events, Set<Handler<any>>>();
  on<K extends keyof Events>(k: K, h: Handler<Events[K]>): () => void {
    if (!this.map.has(k)) this.map.set(k, new Set());
    this.map.get(k)!.add(h);
    return () => this.map.get(k)!.delete(h);
  }
  emit<K extends keyof Events>(k: K, payload: Events[K]): void {
    this.map.get(k)?.forEach((h) => h(payload));
  }
}

export const bus = new Bus();

const startTime = performance.now();
export function log(text: string, kind: LogEntry['kind'] = 'info'): void {
  bus.emit('log', { t: (performance.now() - startTime) / 1000, kind, text });
}
