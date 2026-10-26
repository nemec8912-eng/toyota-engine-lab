// Интерфейс: дерево деталей, карточка детали, тестеры, сканер, сценарии, журнал, управление.
import { store, groups, parts, partById, isRemovable, Unit, PartDef } from '../core/store';
import { bus, log, LogEntry } from '../core/bus';
import { sim, Ign } from '../sim/engine';
import { probePoints, measure, testLight, MeterMode } from '../sim/probes';
import { scenarios, scn, startScenario, giveUp, nextHint, checkSolved, defectNames } from '../sim/scenarios';
import { Viewer } from '../scene/viewer';

// ---------- Мини-хелпер DOM ----------
type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, val] of Object.entries(attrs)) {
    if (val == null || val === false) continue;
    if (k.startsWith('on') && typeof val === 'function') e.addEventListener(k.slice(2).toLowerCase(), val);
    else if (k === 'class') e.className = val;
    else if (k === 'html') e.innerHTML = val;
    else if (k in e && k !== 'list') (e as any)[k] = val;
    else e.setAttribute(k, String(val));
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c as Node | string);
  return e;
}

type TabId = 'tree' | 'part' | 'tester' | 'scanner' | 'scenarios' | 'log';
const TABS: { id: TabId; name: string; cls?: string }[] = [
  { id: 'tree', name: 'Узлы', cls: 'tab-tree' },
  { id: 'part', name: 'Деталь' },
  { id: 'tester', name: 'Тестер' },
  { id: 'scanner', name: 'Сканер' },
  { id: 'scenarios', name: 'Сценарии' },
  { id: 'log', name: 'Журнал' },
];

export class App {
  tab: TabId = 'scenarios';
  selected: string | null = null;
  private logEntries: LogEntry[] = [];
  private unreadErr = 0;
  private tool: 'meter' | 'lamp' = 'meter';
  private meterMode: MeterMode = 'vdc';
  private scanSub: 'dtc' | 'live' = 'dtc';
  private scanRead = false;
  private openGroups = new Set<string>(['ignition', 'relayblock']);
  private liveEls: { [k: string]: HTMLElement } = {};
  private isMobile = matchMedia('(max-width: 980px)');

  constructor(private viewer: Viewer) {
    this.buildToolbar();
    this.buildControls();
    this.renderTabs();
    this.renderTree(document.getElementById('treeHost')!);
    this.renderTab();

    bus.on('select', (id) => {
      this.selected = id;
      if (id) this.setTab('part');
      else if (this.tab === 'part') this.renderTab();
      this.refreshTrees();
    });
    bus.on('parts', () => {
      this.refreshTrees();
      if (this.tab === 'part' || this.tab === 'tester') this.renderTab();
    });
    bus.on('scenario', () => {
      this.updateTaskChip();
      if (this.tab === 'scenarios' || this.tab === 'part') this.renderTab();
    });
    bus.on('log', (e) => {
      this.logEntries.push(e);
      if (this.logEntries.length > 400) this.logEntries.shift();
      if (this.tab === 'log') this.appendLogRow(e, document.querySelector('.log') as HTMLElement | null);
      else if (e.kind === 'err' || e.kind === 'ok') { this.unreadErr++; this.renderTabs(); }
    });
    viewer.onProbePick = (id) => {
      viewer.leads[viewer.activeLead] = id;
      bus.emit('probes', undefined);
      if (this.tab !== 'tester') this.setTab('tester');
      else this.syncLeadSelects();
    };
    this.isMobile.addEventListener('change', () => this.renderTabs());
    document.getElementById('taskChip')!.addEventListener('click', () => this.setTab('scenarios'));
    this.updateTaskChip();

    setInterval(() => this.tickLive(), 120);
    setInterval(() => checkSolved(), 700);
  }

  // ================= Панель инструментов 3D =================
  private buildToolbar(): void {
    const tb = document.getElementById('vtoolbar')!;
    const v = this.viewer;
    const toggle = (label: string, title: string, get: () => boolean, set: (b: boolean) => void) => {
      const b = h('button', { class: 'vbtn', title }, label);
      const upd = () => b.classList.toggle('on', get());
      b.onclick = () => { set(!get()); upd(); };
      upd();
      return b;
    };
    const speeds: [number, string][] = [[1, '1×'], [0.25, '¼×'], [0.04, '1/25×']];
    const speedBtn = h('button', { class: 'vbtn', title: 'Скорость анимации механизмов' }, 'Анимация 1×');
    let si = 0;
    speedBtn.onclick = () => { si = (si + 1) % speeds.length; v.slow = speeds[si][0]; speedBtn.textContent = 'Анимация ' + speeds[si][1]; };
    const viewSel = h('select', { class: 'vbtn', title: 'Вид' },
      h('option', { value: '' }, 'Вид…'), h('option', { value: 'reset' }, 'Общий'), h('option', { value: 'front' }, 'Спереди'),
      h('option', { value: 'top' }, 'Сверху'), h('option', { value: 'right' }, 'Справа (ГРМ)'), h('option', { value: 'left' }, 'Слева (КПП)'), h('option', { value: 'rear' }, 'Сзади (щит)'));
    viewSel.onchange = () => {
      const val = viewSel.value;
      if (val === 'reset') v.resetView();
      else if (val) v.viewPreset(val as any);
      viewSel.value = '';
    };
    tb.append(
      toggle('Рентген', 'Полупрозрачные корпуса: видно поршни, коленвал, клапаны, цепь', () => v.xray, (b) => v.setXray(b)),
      toggle('Разрез', 'Разрез двигателя по цилиндрам (вид спереди)', () => v.cut, (b) => { v.setCut(b); if (b) v.viewPreset('front'); }),
      toggle('Изолировать', 'Показать только выбранную деталь', () => v.isolate, (b) => v.setIsolate(b)),
      viewSel,
      speedBtn,
      h('button', { class: 'vbtn', title: 'Установить на место все снятые детали', onclick: () => this.assembleAll() }, 'Собрать всё'),
    );
  }

  // ================= Ключ, педаль =================
  private buildControls(): void {
    const host = document.getElementById('controls')!;
    const key = h('div', { class: 'key' });
    const states: [Ign, string][] = [['lock', 'LOCK'], ['acc', 'ACC'], ['on', 'ON'], ['start', 'START']];
    const btns = new Map<Ign, HTMLButtonElement>();
    const upd = () => btns.forEach((b, k) => b.classList.toggle('on', sim.ign === k));
    for (const [k, label] of states) {
      const b = h('button', { class: k === 'start' ? 'start' : '' }, label) as HTMLButtonElement;
      if (k === 'start') {
        const release = () => { if (sim.ign === 'start') { sim.setIgn('on'); upd(); } };
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); sim.setIgn('start'); upd(); });
        b.addEventListener('pointerup', release);
        b.addEventListener('pointercancel', release);
        b.title = 'Удерживайте, чтобы крутить стартером';
      } else b.onclick = () => { sim.setIgn(k); upd(); };
      btns.set(k, b);
      key.append(b);
    }
    upd();
    setInterval(upd, 500);
    const out = h('output', {}, '0%');
    const range = h('input', { type: 'range', min: '0', max: '100', value: '0', step: '1' }) as HTMLInputElement;
    range.oninput = () => { sim.pedal = +range.value / 100; out.textContent = range.value + '%'; };
    const springBack = () => { /* педаль остаётся там, где оставили */ };
    range.onchange = springBack;
    const pedal = h('label', { class: 'pedal' }, 'Газ', range, out);
    const stats = h('div', { class: 'mini-stats' });
    this.liveEls.stats = stats;
    host.append(key, pedal, stats);
  }

  // ================= Вкладки =================
  private renderTabs(): void {
    const nav = document.getElementById('tabs')!;
    nav.innerHTML = '';
    for (const t of TABS) {
      const b = h('button', { class: `tab ${t.cls ?? ''} ${this.tab === t.id ? 'on' : ''}`, onclick: () => this.setTab(t.id, true) }, t.name);
      if (t.id === 'log' && this.unreadErr > 0) b.append(h('span', { class: 'badge' }, String(this.unreadErr)));
      nav.append(b);
    }
    if (!this.isMobile.matches && this.tab === 'tree') this.setTab('part');
  }

  setTab(t: TabId, fromUser = false): void {
    const panel = document.getElementById('rightPanel')!;
    if (this.isMobile.matches && fromUser && t === this.tab) {
      panel.classList.toggle('collapsed');
      return;
    }
    panel.classList.remove('collapsed');
    this.tab = t;
    if (t === 'log') this.unreadErr = 0;
    this.viewer.setProbes(t === 'tester');
    this.renderTabs();
    this.renderTab();
  }

  private renderTab(): void {
    const host = document.getElementById('tabHost')!;
    const keep = host.scrollTop;
    host.innerHTML = '';
    this.liveEls = { stats: this.liveEls.stats };
    switch (this.tab) {
      case 'tree': this.renderTree(host); break;
      case 'part': this.renderPart(host); break;
      case 'tester': this.renderTester(host); break;
      case 'scanner': this.renderScanner(host); break;
      case 'scenarios': this.renderScenarios(host); break;
      case 'log': this.renderLog(host); break;
    }
    host.scrollTop = keep;
  }

  // ================= Дерево =================
  private trees: HTMLElement[] = [];
  private refreshTrees(): void {
    for (const t of this.trees) if (t.isConnected) this.fillTree(t);
    this.trees = this.trees.filter((t) => t.isConnected);
  }

  private renderTree(host: HTMLElement): void {
    const wrap = h('div');
    host.append(wrap);
    this.trees.push(wrap);
    this.fillTree(wrap);
  }

  private fillTree(wrap: HTMLElement): void {
    wrap.innerHTML = '';
    if (store.tray.length) {
      const bench = h('div', { class: 'bench' }, h('h4', {}, `Снято (на верстаке): ${store.tray.length}`));
      for (const u of store.tray) {
        bench.append(h('div', { class: 'bench-item' },
          h('span', { title: this.unitLabel(u) }, this.unitLabel(u)),
          h('button', { class: 'link', onclick: () => bus.emit('select', u.home) }, 'место')));
      }
      wrap.append(bench);
    }
    for (const g of groups) {
      const items = parts.filter((p) => p.group === g.id);
      if (!items.length) continue;
      const removed = items.filter((p) => !store.installed(p.id)).length;
      const grp = h('div', { class: `tree-group ${this.openGroups.has(g.id) || items.some((p) => p.id === this.selected) ? 'open' : ''}` });
      const head = h('div', { class: 'tree-head' }, h('span', { class: 'chev' }, '▶'), g.name, h('span', { class: 'cnt' }, removed ? `снято ${removed}/${items.length}` : String(items.length)));
      head.onclick = () => { grp.classList.toggle('open'); if (grp.classList.contains('open')) this.openGroups.add(g.id); else this.openGroups.delete(g.id); };
      const list = h('div', { class: 'tree-items' });
      for (const p of items) {
        const st = !isRemovable(p.id) ? 'fixed' : !store.installed(p.id) ? 'off' : p.connector && store.connected.get(p.id) === false ? 'disc' : '';
        const it = h('div', { class: `tree-item ${this.selected === p.id ? 'sel' : ''}`, onclick: () => { bus.emit('select', p.id); bus.emit('focus', p.id); } }, h('span', { class: `dot ${st}` }), p.name);
        list.append(it);
      }
      grp.append(head, list);
      wrap.append(grp);
    }
  }

  private unitLabel(u: Unit): string {
    const p = partById.get(u.home)!;
    return `${p.name}${u.isNew ? ' (новая)' : ''}`;
  }

  // ================= Карточка детали =================
  private renderPart(host: HTMLElement): void {
    const id = this.selected;
    if (!id) {
      host.append(h('div', { class: 'empty' }, h('p', {}, 'Нажмите на деталь в 3D или выберите её в списке «Узлы».'), h('p', { class: 'small' }, 'Двойное нажатие — приблизить камеру к детали.')));
      return;
    }
    const p = partById.get(id)!;
    const removable = isRemovable(id);
    const installed = store.installed(id);
    const pad = h('div', { class: 'pad' });
    host.append(pad);
    const g = groups.find((x) => x.id === p.group);
    const status = !removable ? h('span', { class: 'chip' }, 'не снимается на стенде')
      : installed ? (p.connector && store.connected.get(id) === false ? h('span', { class: 'chip warn' }, 'разъём отключён') : h('span', { class: 'chip ok' }, 'установлена'))
        : h('span', { class: 'chip off' }, 'снята');
    pad.append(h('div', { class: 'card' },
      h('div', { class: 'muted small' }, g?.name ?? ''),
      h('h3', {}, p.name),
      h('div', { class: 'row', style: 'margin:6px 0 4px' }, status, h('button', { class: 'link', onclick: () => bus.emit('focus', id) }, 'показать')),
      p.desc ? h('p', { style: 'margin:8px 0 0' }, p.desc) : null,
    ));

    if (removable) {
      const actions = h('div', { class: 'card' }, h('h4', {}, 'Действия'));
      const reasons = installed ? store.canRemove(id) : store.canInstall(id);
      const row = h('div', { class: 'row' });
      if (installed) {
        row.append(h('button', { class: 'btn primary', disabled: reasons.length > 0, onclick: () => store.remove(id) }, 'Снять'));
        row.append(h('button', { class: 'btn amber', disabled: reasons.length > 0, onclick: () => this.replaceWithNew(id) }, 'Заменить на новую'));
        if (p.connector) {
          const on = store.connected.get(id) !== false;
          row.append(h('button', { class: 'btn', onclick: () => store.setConnected(id, !on) }, on ? 'Отключить разъём' : 'Подключить разъём'));
        }
      } else {
        row.append(h('button', { class: 'btn primary', disabled: reasons.length > 0, onclick: () => this.installDialog(id) }, 'Установить…'));
      }
      actions.append(row);
      if (reasons.length) {
        actions.append(h('div', { class: 'warnbox' }, reasons.join(' ')));
        const blockers = installed ? store.blockersInstalled(id) : [...store.blockersInstalled(id), ...store.supportsMissing(id)];
        if (blockers.length) {
          const ll = h('div', { class: 'linklist' });
          blockers.forEach((b) => ll.append(h('button', { class: 'link', onclick: () => { bus.emit('select', b); bus.emit('focus', b); } }, partById.get(b)!.name)));
          actions.append(h('div', { class: 'small muted' }, 'Перейти:'), ll);
        }
        if (installed && p.powerOff && store.installed('battery_neg')) {
          actions.append(h('button', { class: 'link', onclick: () => bus.emit('select', 'battery_neg') }, 'Минусовая клемма АКБ'));
        }
      }
      pad.append(actions);
    }

    if (p.fasteners?.length) {
      const t = h('table', { class: 'fast' }, h('tr', {}, h('th', {}, 'Крепёж'), h('th', {}, 'Кол.'), h('th', {}, 'Инструмент'), h('th', {}, 'Момент')));
      for (const f of p.fasteners) {
        t.append(h('tr', {}, h('td', {}, `${f.type} ${f.size !== '—' ? f.size : ''}`), h('td', {}, String(f.n)), h('td', {}, f.socket), h('td', {}, f.torque ? `${f.torque} Н·м` : '—')));
      }
      pad.append(h('div', { class: 'card' }, h('h4', {}, 'Крепёж и моменты затяжки'), t));
    }
    if (p.specs?.length) {
      const t = h('table', { class: 'kv' });
      for (const [k, val] of p.specs) t.append(h('tr', {}, h('td', {}, k), h('td', {}, val)));
      pad.append(h('div', { class: 'card' }, h('h4', {}, 'Характеристики и нормы'), t));
    }
    if (p.notes) pad.append(h('div', { class: 'card' }, h('h4', {}, 'Советы мастеру'), h('div', {}, p.notes)));
    const points = probePoints.filter((pp) => pp.id.split(':')[0] === id);
    if (points.length) {
      const ll = h('div', { class: 'linklist' });
      points.forEach((pp) => ll.append(h('button', { class: 'link', title: pp.hint ?? '', onclick: () => { this.viewer.leads[this.viewer.activeLead] = pp.id; bus.emit('probes', undefined); this.setTab('tester'); } }, pp.id.split(':')[1])));
      pad.append(h('div', { class: 'card' }, h('h4', {}, 'Точки замера'), h('div', { class: 'small muted' }, `Нажмите вывод, чтобы поставить на него ${this.viewer.activeLead === 'red' ? 'красный' : 'чёрный'} щуп.`), ll));
    }
    pad.append(h('div', { class: 'verify' }, '⚠ Моменты, нормы и распиновка — ориентировочные справочные данные. Перед реальным ремонтом сверяйте с заводским руководством (RM/EWD) для вашего VIN.'));
  }

  private replaceWithNew(id: string): void {
    if (!store.remove(id)) return;
    setTimeout(() => { store.install(id, null); }, 1300);
  }

  private installDialog(id: string): void {
    const units = store.compatibleUnits(id);
    const p = partById.get(id)!;
    const close = () => { host.innerHTML = ''; };
    const host = document.getElementById('modalHost')!;
    const own = units.find((u) => u.home === id && !u.isNew);
    const doInstall = (uid: number | null) => { close(); store.install(id, uid); };
    if (units.length === 1 && own) { doInstall(own.uid); return; }
    const m = h('div', { class: 'modal' }, h('h3', {}, `Установить: ${p.name}`),
      units.length ? h('p', { class: 'muted small' }, 'Какую деталь поставить?') : h('p', { class: 'muted small' }, 'Снятых деталей этого типа нет на верстаке.'));
    for (const u of units) {
      m.append(h('button', { class: 'btn choice', onclick: () => doInstall(u.uid) }, `↺ ${this.unitLabel(u)}${u.home === id ? ' — своя' : ' — с другого места'}`));
    }
    m.append(h('button', { class: 'btn amber choice', onclick: () => doInstall(null) }, '＋ Новая деталь из магазина'));
    m.append(h('button', { class: 'btn choice', onclick: close }, 'Отмена'));
    const back = h('div', { class: 'modal-back', onclick: (e: Event) => { if (e.target === back) close(); } }, m);
    host.append(back);
  }

  private assembleAll(): void {
    if (sim.running || sim.cranking) { log('Заглушите двигатель.', 'warn'); return; }
    let guard = 0, changed = true;
    while (changed && guard++ < 200) {
      changed = false;
      for (const p of parts) {
        if (!isRemovable(p.id) || store.installed(p.id)) continue;
        if (store.canInstall(p.id).length) continue;
        const units = store.compatibleUnits(p.id);
        const u = units.find((x) => x.home === p.id) ?? units[0];
        if (u) { store.install(p.id, u.uid); changed = true; }
      }
    }
    for (const p of parts) if (p.connector && store.installed(p.id) && store.connected.get(p.id) === false) store.setConnected(p.id, true);
    if (parts.some((p) => isRemovable(p.id) && !store.installed(p.id))) log('Не все детали удалось установить — нет подходящих снятых деталей.', 'warn');
  }

  // ================= Тестер =================
  private leadSelects: Partial<Record<'red' | 'black', HTMLSelectElement>> = {};

  private renderTester(host: HTMLElement): void {
    const v = this.viewer;
    const pad = h('div', { class: 'pad' });
    host.append(pad);
    const sw = h('div', { class: 'tool-switch' },
      h('button', { class: this.tool === 'meter' ? 'on' : '', onclick: () => { this.tool = 'meter'; this.renderTab(); } }, 'Мультиметр'),
      h('button', { class: this.tool === 'lamp' ? 'on' : '', onclick: () => { this.tool = 'lamp'; this.renderTab(); } }, 'Контролька'));
    pad.append(sw);

    if (this.tool === 'meter') {
      const val = h('span', { class: 'val' }, '----');
      const unit = h('span', { class: 'unit' }, 'V');
      const beep = h('span', { class: 'beep' }, '♪');
      this.liveEls.meterVal = val; this.liveEls.meterUnit = unit; this.liveEls.meterBeep = beep;
      const modes = h('div', { class: 'modes' });
      const ml: [MeterMode, string][] = [['vdc', 'V⎓'], ['vac', 'V~'], ['ohm', 'Ω'], ['cont', '•))']];
      for (const [m, l] of ml) modes.append(h('button', { class: this.meterMode === m ? 'on' : '', onclick: () => { this.meterMode = m; this.renderTab(); } }, l));
      pad.append(h('div', { class: 'meter' }, h('div', { class: 'meter-top' }, h('span', {}, 'DIGITAL MULTIMETER'), h('span', {}, 'AUTO')), h('div', { class: 'lcd' }, beep, val, unit), modes));
    } else {
      const bulb = h('div', { class: 'bulb' });
      this.liveEls.bulb = bulb;
      pad.append(h('div', { class: 'lamp-tester' }, bulb, h('div', { class: 'small' }, h('b', {}, 'Контрольная лампа 12 В / 5 Вт'), h('div', { class: 'muted' }, 'Горит ярко — есть питание, способное дать ток. Тускло — питание через сопротивление. Удобна для проверки предохранителей, питания и масс.'))));
    }
    const warn = h('div', { class: 'warnbox', style: 'display:none' });
    this.liveEls.meterWarn = warn;
    pad.append(warn);

    // Щупы
    const leads = h('div', { class: 'leads' });
    for (const lead of ['red', 'black'] as const) {
      const sel = h('select') as HTMLSelectElement;
      this.leadSelects[lead] = sel;
      sel.onchange = () => { v.leads[lead] = sel.value || null; bus.emit('probes', undefined); };
      const swc = h('div', { class: `sw ${lead} ${v.activeLead === lead ? 'active' : ''}`, title: 'Выбрать этот щуп для установки касанием в 3D', onclick: () => { v.activeLead = lead; this.renderTab(); } });
      leads.append(h('div', { class: 'lead' }, swc, sel));
    }
    pad.append(h('div', { class: 'card', style: 'margin-top:12px' }, h('h4', {}, 'Щупы'), h('div', { class: 'small muted' }, `Активный щуп: ${v.activeLead === 'red' ? 'красный' : 'чёрный'}. Нажмите на жёлтую точку в 3D, чтобы поставить его туда, или выберите точку из списка.`), leads));
    this.syncLeadSelects();

    const pointHint = h('div', { class: 'small muted' });
    this.liveEls.pointHint = pointHint;
    pad.append(pointHint);
    pad.append(h('div', { class: 'card', style: 'margin-top:12px' }, h('h4', {}, 'Как мерить'),
      h('div', { class: 'small' },
        h('p', { style: 'margin:0 0 6px' }, '• Напряжение: чёрный щуп на массу, красный — на проверяемый вывод. Включите зажигание, если цепь питается от замка.'),
        h('p', { style: 'margin:0 0 6px' }, '• Сопротивление: выключите зажигание и отключите разъём детали (кнопка в карточке детали), меряйте между выводами самой детали.'),
        h('p', { style: 'margin:0 0 6px' }, '• Падение напряжения: щупы на два конца одного провода/контакта под нагрузкой (например, штырь АКБ и клемма при прокрутке).'),
        h('p', { style: 'margin:0' }, '• Точки замера видны в 3D, пока открыта эта вкладка. Серые — массы.'))));
  }

  private syncLeadSelects(): void {
    const v = this.viewer;
    for (const lead of ['red', 'black'] as const) {
      const sel = this.leadSelects[lead];
      if (!sel || !sel.isConnected) continue;
      sel.innerHTML = '';
      sel.append(h('option', { value: '' }, '— не подключён —'));
      const byPart = new Map<string, typeof probePoints>();
      for (const pp of probePoints) {
        if (!pp.visible()) continue;
        const part = pp.id.split(':')[0];
        const key = part === 'fusebox' ? 'Гнёзда реле' : partById.get(part)?.name ?? part;
        if (!byPart.has(key)) byPart.set(key, []);
        byPart.get(key)!.push(pp);
      }
      for (const [k, list] of byPart) {
        const og = h('optgroup', { label: k });
        list.forEach((pp) => og.append(h('option', { value: pp.id }, pp.label.includes(' — ') && !pp.label.startsWith('Пред.') && !pp.label.startsWith('Гнездо') ? pp.label.split(' — ').slice(1).join(' — ') + (pp.hint ? ` (${pp.hint})` : '') : pp.label)));
        sel.append(og);
      }
      sel.value = v.leads[lead] ?? '';
    }
  }

  // ================= Сканер =================
  private renderScanner(host: HTMLElement): void {
    const pad = h('div', { class: 'pad' });
    host.append(pad);
    const status = h('span');
    this.liveEls.scanStatus = status;
    const body = h('div', { class: 'scanner-body' });
    pad.append(h('div', { class: 'scanner' }, h('div', { class: 'scanner-head' }, h('b', {}, 'OBD-II сканер'), status), body));
    const sub = h('div', { class: 'subtabs' },
      h('button', { class: this.scanSub === 'dtc' ? 'on' : '', onclick: () => { this.scanSub = 'dtc'; this.renderTab(); } }, 'Ошибки'),
      h('button', { class: this.scanSub === 'live' ? 'on' : '', onclick: () => { this.scanSub = 'live'; this.renderTab(); } }, 'Параметры'));
    body.append(sub);
    const content = h('div');
    body.append(content);
    this.liveEls.scanContent = content;
    this.fillScanner();
    pad.append(h('p', { class: 'small muted' }, 'Разъём OBD-II под панелью слева. Для связи нужно включённое зажигание и питание ЭБУ. Для чтения кодов при прокрутке/работе держите вкладку открытой — параметры обновляются вживую.'));
  }

  private scanLinked(): boolean { return sim.net.igOn && sim.net.ecuOn; }

  private fillScanner(): void {
    const c = this.liveEls.scanContent;
    if (!c) return;
    c.innerHTML = '';
    if (!sim.net.igOn) { c.append(h('div', { class: 'warnbox' }, 'Включите зажигание (ON).')); return; }
    if (!sim.net.ecuOn) { c.append(h('div', { class: 'errbox' }, 'Нет связи с ЭБУ. Проверьте питание блока управления (+B, масса) и линию связи.')); return; }
    if (this.scanSub === 'dtc') {
      const row = h('div', { class: 'row', style: 'margin-bottom:10px' },
        h('button', { class: 'btn primary sm', onclick: () => { this.scanRead = true; log('Сканер: коды прочитаны.'); this.fillScanner(); } }, 'Прочитать'),
        h('button', { class: 'btn danger sm', onclick: () => { sim.clearDtcs(); this.scanRead = true; log('Сканер: коды стёрты, адаптации топливных коррекций сброшены.', 'action'); this.fillScanner(); } }, 'Стереть'));
      c.append(row);
      if (!this.scanRead) { c.append(h('div', { class: 'muted small' }, 'Нажмите «Прочитать».')); return; }
      if (!sim.dtcs.size) { c.append(h('div', { class: 'okbox' }, 'Кодов неисправностей нет.')); return; }
      for (const d of sim.dtcs.values()) {
        const det = h('details', {}, h('summary', {}, 'Стоп-кадр'));
        const t = h('table', { class: 'kv' });
        for (const [k, val] of Object.entries(d.frame)) t.append(h('tr', {}, h('td', {}, k), h('td', {}, val)));
        det.append(t);
        c.append(h('div', { class: 'dtc' }, h('b', {}, d.code), d.text, det));
      }
    } else {
      const t = h('table', { class: 'live' });
      const rows: [string, string][] = [
        ['rpm', 'Обороты двигателя'], ['ect', 'Темп. ОЖ'], ['iat', 'Темп. воздуха на впуске'], ['maf', 'Расход воздуха (ДМРВ)'],
        ['thr', 'Положение дросселя'], ['ped', 'Положение педали газа'], ['load', 'Расчётная нагрузка'], ['adv', 'Угол опережения'],
        ['inj', 'Время впрыска'], ['stft', 'Кратковрем. коррекция (STFT)'], ['ltft', 'Долговрем. коррекция (LTFT)'],
        ['o2u', 'Датчик O2 B1S1'], ['o2d', 'Датчик O2 B1S2'], ['vvti', 'VVT впуск: цель / факт'], ['vvte', 'VVT выпуск: цель / факт'],
        ['volt', 'Напряжение питания ЭБУ'], ['fan', 'Вентилятор'], ['mis', 'Пропуски, цил. 1 / 2 / 3 / 4'], ['cl', 'Режим смеси'],
      ];
      for (const [k, label] of rows) {
        const td = h('td');
        this.liveEls['lv_' + k] = td;
        t.append(h('tr', {}, h('td', {}, label), td));
      }
      c.append(t);
      this.tickLive();
    }
  }

  // ================= Сценарии =================
  private renderScenarios(host: HTMLElement): void {
    const pad = h('div', { class: 'pad' });
    host.append(pad);
    const s = scn.current;
    if (s || scn.exam) {
      const card = h('div', { class: 'card' });
      card.append(h('h4', {}, scn.exam ? 'Экзамен' : 'Текущий сценарий'));
      card.append(h('h3', {}, scn.exam && !scn.solved && !scn.gaveUp ? 'Скрытая неисправность' : s!.title));
      card.append(h('p', { style: 'margin:6px 0' }, h('b', {}, 'Жалоба клиента: '), s!.complaint));
      if (scn.solved && scn.result) {
        const r = scn.result;
        const mm = Math.floor(r.seconds / 60), ss = Math.round(r.seconds % 60);
        card.append(h('div', { class: 'okbox' }, h('b', {}, 'Неисправность устранена! '), s!.cause,
          h('div', { style: 'margin-top:6px' }, `Время: ${mm} мин ${ss} с · Новых деталей: ${r.replaced}`),
          r.extra.length ? h('div', {}, `Заменено лишнее: ${r.extra.join(', ')}`) : h('div', {}, 'Лишних замен нет — отличная диагностика.')));
      } else if (scn.gaveUp) {
        card.append(h('div', { class: 'warnbox' }, h('b', {}, 'Ответ: '), s!.cause, h('div', {}, 'Ремонт: ' + s!.repair)));
      }
      if (!scn.exam && !scn.solved) {
        s!.hints.slice(0, scn.hintsShown).forEach((t, i) => card.append(h('div', { class: 'hint' }, h('span', { class: 'n' }, String(i + 1)), t)));
        const row = h('div', { class: 'row', style: 'margin-top:10px' });
        if (scn.hintsShown < s!.hints.length) row.append(h('button', { class: 'btn', onclick: () => nextHint() }, scn.hintsShown ? 'Следующая подсказка' : 'Подсказка'));
        if (!scn.gaveUp) row.append(h('button', { class: 'btn danger', onclick: () => giveUp() }, 'Показать ответ'));
        card.append(row);
      } else if (scn.exam && !scn.solved && !scn.gaveUp) {
        card.append(h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn danger', onclick: () => giveUp() }, 'Сдаться и показать ответ')));
      }
      card.append(h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: () => startScenario(null) }, 'Сбросить стенд (исправный)')));
      pad.append(card);
    } else {
      pad.append(h('div', { class: 'card' }, h('h4', {}, 'Свободный режим'), h('div', { class: 'small' }, 'Все детали исправны. Разбирайте, меряйте, изучайте. Выберите сценарий ниже, чтобы потренироваться в поиске неисправности.')));
    }
    pad.append(h('button', { class: 'btn amber', style: 'width:100%;margin-bottom:12px', onclick: () => startScenario('random', true) }, '🎲 Экзамен: случайная скрытая неисправность'));
    pad.append(h('div', { class: 'muted small', style: 'margin:0 0 8px' }, 'Обучающие сценарии (с подсказками):'));
    scenarios.forEach((sc, i) => {
      pad.append(h('div', { class: 'scn', onclick: () => { startScenario(sc.id); } }, h('div', { class: 'num' }, String(i + 1)), h('div', {}, h('b', {}, sc.title), h('span', {}, sc.complaint))));
    });
    pad.append(h('p', { class: 'small muted' }, 'Неисправность считается устранённой, когда дефектная деталь заменена исправной. Перестановка одинаковых деталей (катушки, реле) — честный способ проверки.'));
  }

  private updateTaskChip(): void {
    const c = document.getElementById('taskChip')!;
    const s = scn.current;
    c.classList.toggle('active', !!s && !scn.solved);
    if (!s) c.textContent = 'Свободный режим';
    else if (scn.solved) c.textContent = '✓ Устранено';
    else c.textContent = scn.exam ? 'Экзамен: найдите неисправность' : 'Сценарий: ' + s.title;
  }

  // ================= Журнал =================
  private renderLog(host: HTMLElement): void {
    const box = h('div', { class: 'log' });
    host.append(box);
    if (!this.logEntries.length) box.append(h('div', { class: 'empty' }, 'Событий пока нет.'));
    [...this.logEntries].reverse().forEach((e) => box.append(this.logRow(e)));
  }
  private logRow(e: LogEntry): HTMLElement {
    const m = Math.floor(e.t / 60), s = Math.floor(e.t % 60);
    return h('div', { class: `log-row ${e.kind}` }, h('time', {}, `${m}:${String(s).padStart(2, '0')}`), h('span', {}, e.text));
  }
  private appendLogRow(e: LogEntry, box: HTMLElement | null): void {
    if (!box) return;
    box.querySelector('.empty')?.remove();
    box.prepend(this.logRow(e));
  }

  // ================= Живые обновления =================
  private lastScanState = '';
  private tickLive(): void {
    // мини-статус под ключом
    const st = this.liveEls.stats;
    if (st) {
      st.innerHTML = '';
      st.append(
        h('span', {}, 'АКБ ', h('b', {}, sim.net.vPost.toFixed(1) + ' В')),
        h('span', {}, 'ОЖ ', h('b', {}, Math.round(sim.coolant) + ' °C')),
        h('span', {}, 'Обороты ', h('b', {}, String(Math.round(sim.rpmVisual)))),
        h('span', {}, sim.running ? h('b', { style: 'color:#8ff0bd' }, 'работает') : sim.cranking ? h('b', { style: 'color:#ffd39a' }, 'прокрутка') : 'заглушен'),
      );
    }
    if (this.tab === 'tester') this.tickTester();
    if (this.tab === 'scanner') {
      const state = `${sim.net.igOn}|${sim.net.ecuOn}|${this.scanSub}|${this.scanSub === 'dtc' ? sim.dtcs.size : ''}`;
      if (state !== this.lastScanState) { this.lastScanState = state; this.fillScanner(); }
      const s = this.liveEls.scanStatus;
      if (s) s.textContent = this.scanLinked() ? '● связь с ЭБУ' : '○ нет связи';
      if (this.scanSub === 'live' && this.scanLinked()) this.tickLiveData();
    }
  }

  private tickTester(): void {
    const v = this.viewer;
    const warn = this.liveEls.meterWarn;
    let w: string | undefined;
    if (this.tool === 'meter') {
      const r = measure(this.meterMode, v.leads.red, v.leads.black);
      if (this.liveEls.meterVal) this.liveEls.meterVal.textContent = r.text;
      if (this.liveEls.meterUnit) this.liveEls.meterUnit.textContent = r.unit;
      if (this.liveEls.meterBeep) this.liveEls.meterBeep.classList.toggle('on', !!r.beep);
      w = r.warn;
    } else {
      const r = testLight(v.leads.red, v.leads.black);
      const b = this.liveEls.bulb;
      if (b) {
        const l = r.level;
        b.style.background = l > 0.02 ? `radial-gradient(circle at 40% 35%, rgba(255,250,220,${0.6 + l * 0.4}), rgba(255,${170 + l * 60},40,${0.3 + l * 0.7}))` : '';
        b.style.boxShadow = l > 0.02 ? `0 0 ${10 + l * 30}px rgba(255,200,80,${l})` : '';
      }
      w = r.warn;
    }
    if (warn) { warn.style.display = w ? 'block' : 'none'; warn.textContent = w ?? ''; }
    const ph = this.liveEls.pointHint;
    if (ph) {
      const red = probePoints.find((p) => p.id === v.leads.red);
      const blk = probePoints.find((p) => p.id === v.leads.black);
      ph.textContent = `Красный: ${red ? red.label : '—'} · Чёрный: ${blk ? blk.label : '—'}`;
    }
  }

  private tickLiveData(): void {
    const set = (k: string, val: string) => { const e = this.liveEls['lv_' + k]; if (e) e.textContent = val; };
    set('rpm', Math.round(sim.rpmOut) + ' об/мин');
    set('ect', Math.round(sim.ectRead) + ' °C');
    set('iat', Math.round(sim.iatRead) + ' °C');
    set('maf', sim.mafRead.toFixed(2) + ' г/с');
    set('thr', Math.round(sim.throttleAct * 100) + ' %');
    set('ped', Math.round(sim.pedal * 100) + ' %');
    set('load', Math.round(sim.load) + ' %');
    set('adv', sim.advance.toFixed(1) + ' °');
    set('inj', sim.injMs.toFixed(2) + ' мс');
    set('stft', (sim.stft >= 0 ? '+' : '') + sim.stft.toFixed(1) + ' %');
    set('ltft', (sim.ltft >= 0 ? '+' : '') + sim.ltft.toFixed(1) + ' %');
    set('o2u', sim.o2up.toFixed(3) + ' В');
    set('o2d', sim.o2down.toFixed(3) + ' В');
    set('vvti', `${sim.vvtInT.toFixed(0)} / ${sim.vvtInA.toFixed(0)} °`);
    set('vvte', `${sim.vvtExT.toFixed(0)} / ${sim.vvtExA.toFixed(0)} °`);
    set('volt', sim.net.efiB.toFixed(2) + ' В');
    set('fan', sim.fanCmd ? 'ВКЛ' : 'ВЫКЛ');
    set('mis', sim.misfires.map((x) => Math.floor(x)).join(' / '));
    set('cl', !sim.running ? '—' : sim.coolant > 45 && sim.runTime > 15 && store.live('o2_up') ? 'замкнутый (по O2)' : 'разомкнутый');
  }
}

export { defectNames, type PartDef };
