// Симуляция двигателя 1ZR-FE и его электрики.
// Упрощённая, но причинно-следственная модель: каждое измерение и каждый симптом
// вычисляется из состояния деталей (установлена / подключена / дефект).
import { store, env, partById } from '../core/store';
import { log } from '../core/bus';

export type Ign = 'lock' | 'acc' | 'on' | 'start';

export interface Dtc { code: string; text: string; mil: boolean; at: number; frame: Record<string, string> }

export const DTC_TEXT: Record<string, string> = {
  P0010: 'Цепь привода VVT впуска (OCV) — обрыв/КЗ',
  P0011: 'Угол распредвала впуска — чрезмерное опережение',
  P0013: 'Цепь привода VVT выпуска (OCV) — обрыв/КЗ',
  P0014: 'Угол распредвала выпуска — чрезмерное опережение',
  P0101: 'ДМРВ — сигнал вне допустимого диапазона',
  P0102: 'ДМРВ — низкий уровень сигнала',
  P0113: 'Датчик температуры воздуха — высокий уровень сигнала',
  P0117: 'Датчик температуры ОЖ — низкий уровень сигнала',
  P0118: 'Датчик температуры ОЖ — высокий уровень сигнала',
  P0120: 'Датчик положения дросселя — неисправность цепи',
  P0130: 'Датчик кислорода 1 — неисправность цепи',
  P0135: 'Датчик кислорода 1 — цепь подогрева',
  P0136: 'Датчик кислорода 2 — неисправность цепи',
  P0141: 'Датчик кислорода 2 — цепь подогрева',
  P0171: 'Система слишком бедная',
  P0300: 'Случайные/множественные пропуски воспламенения',
  P0301: 'Пропуски воспламенения в цилиндре 1',
  P0302: 'Пропуски воспламенения в цилиндре 2',
  P0303: 'Пропуски воспламенения в цилиндре 3',
  P0304: 'Пропуски воспламенения в цилиндре 4',
  P0327: 'Датчик детонации — низкий уровень сигнала',
  P0335: 'Датчик положения коленвала — нет сигнала',
  P0340: 'Датчик распредвала впуска — нет сигнала',
  P0365: 'Датчик распредвала выпуска — нет сигнала',
  P0351: 'Катушка зажигания 1 — нет сигнала IGF',
  P0352: 'Катушка зажигания 2 — нет сигнала IGF',
  P0353: 'Катушка зажигания 3 — нет сигнала IGF',
  P0354: 'Катушка зажигания 4 — нет сигнала IGF',
  P2102: 'Мотор дроссельной заслонки — низкий сигнал цепи',
  P2135: 'Датчики положения дросселя VTA1/VTA2 — рассогласование',
};

/** Электрическая сеть: потенциалы узлов относительно массы кузова (В). */
export interface Net {
  battPresent: boolean;
  negOk: boolean;
  vPost: number;      // на штырях АКБ (между + и −)
  vClamp: number;     // на плюсовой клемме относительно штыря «−»
  bplus: number;      // B+ на входе блока реле (относительно массы)
  am2: number;        // после AM2
  ig2feed: number;    // от замка на IG2 (до предохранителя)
  ig2: number;        // после предохранителя IG2 — катушки и форсунки
  efiFuseOut: number; // после EFI MAIN
  efiRelayOn: boolean;
  efiB: number;       // +B ЭБУ (выход реле EFI)
  efi2: number;       // после EFI NO.2 — ДМРВ, подогревы
  etcs: number;
  alts: number;
  rdi: number;
  copnOn: boolean;
  pumpV: number;
  stRelayOn: boolean;
  st50: number;       // на клемме 50 стартера
  v30: number;        // на клемме 30 стартера
  fanRelayOn: boolean;
  fanV: number;
  ecuOn: boolean;
  igOn: boolean;      // зажигание ON/START и есть питание
}

const ZERO_NET: Net = {
  battPresent: false, negOk: false, vPost: 0, vClamp: 0, bplus: 0, am2: 0, ig2feed: 0, ig2: 0, efiFuseOut: 0,
  efiRelayOn: false, efiB: 0, efi2: 0, etcs: 0, alts: 0, rdi: 0, copnOn: false, pumpV: 0, stRelayOn: false,
  st50: 0, v30: 0, fanRelayOn: false, fanV: 0, ecuOn: false, igOn: false,
};

function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }
function lerp(a: number, b: number, t: number) { return a + (b - a) * clamp(t, 0, 1); }

/** Сопротивление NTC-термистора датчика ECT/IAT. ≈2,45 кОм при 20 °C, ≈0,32 кОм при 80 °C. */
export function ntcOhm(tC: number): number {
  const B = 3511, T = tC + 273.15, T0 = 293.15;
  return 2450 * Math.exp(B * (1 / T - 1 / T0));
}

export class Sim {
  ign: Ign = 'lock';
  pedal = 0;            // педаль газа 0..1
  rpm = 0;
  running = false;
  cranking = false;
  crankTime = 0;
  runTime = 0;
  coolant = 20;
  ambient = 20;
  soc = 12.6;           // напряжение покоя АКБ
  fuelPressure = 0;     // кПа
  primeTimer = 0;
  oilPressure = 0;      // кПа
  time = 0;
  warmFactor = 4;       // ускорение прогрева

  throttleAct = 0;      // фактическое открытие дросселя 0..1
  limp = false;
  fanOn = false;
  fanCmd = false;
  vvtInT = 0; vvtInA = 0; vvtExT = 0; vvtExA = 0;
  stft = 0; ltft = 0;
  mafRead = 0; mafTrue = 0;
  ectRead = 20; iatRead = 25;
  advance = 0; load = 0; injMs = 0;
  o2up = 0.45; o2down = 0.1;
  cylOk: boolean[] = [true, true, true, true];
  misfires = [0, 0, 0, 0];
  sparkOk: boolean[] = [true, true, true, true];
  rpmJitter = 0;
  chargeOk = false;
  net: Net = { ...ZERO_NET };

  dtcs = new Map<string, Dtc>();
  private pending = new Map<string, number>();
  private warned = new Set<string>();

  // Лампы приборной панели
  lamps = { mil: false, milBlink: false, batt: false, oil: false, abs: false, airbag: false, brake: false, eps: false, belt: false, master: false, hot: false };

  constructor() {
    env.engineTurning = () => this.running || this.cranking;
  }

  resetEngine(): void {
    this.ign = 'lock'; this.pedal = 0; this.rpm = 0; this.running = false; this.cranking = false;
    this.coolant = this.ambient = 20; this.soc = 12.6; this.fuelPressure = 0; this.dtcs.clear();
    this.pending.clear(); this.ltft = 0; this.stft = 0; this.vvtInA = 0; this.vvtExA = 0; this.warned.clear(); this.misfires = [0, 0, 0, 0];
  }

  setIgn(k: Ign): void {
    if (k === this.ign) return;
    const prev = this.ign;
    this.ign = k;
    if (k === 'on' && (prev === 'acc' || prev === 'lock')) {
      this.primeTimer = 2;
      // Сообщение о бензонасосе — через кадр, когда сеть пересчитается
      setTimeout(() => {
        if (this.ign !== 'on' && this.ign !== 'start') return;
        if (this.net.pumpV > 8) log('Слышно короткое жужжание бензонасоса (≈2 с).');
        else if (this.net.igOn) log('Тишина — жужжания бензонасоса не слышно.');
      }, 250);
    }
    if (k === 'start') {
      const block = this.mechanicalBlock();
      if (block) {
        log('Запуск заблокирован: ' + block, 'warn');
      }
    }
    if ((k === 'lock' || k === 'acc') && this.running) {
      this.running = false;
      log('Двигатель заглушен ключом.');
    }
  }

  /** Причина, по которой двигатель физически нельзя крутить/запускать. */
  mechanicalBlock(): string | null {
    const miss = (ids: string[]) => ids.filter((i) => !store.installed(i)).map((i) => partById.get(i)!.name);
    let m = miss(['chain', 'cam_in', 'cam_ex', 'timing_cover', 'valve_cover']);
    if (m.length) return 'не собран ГРМ/верх двигателя (' + m.join(', ') + ').';
    m = miss(['oil_pan', 'oil_drain', 'oil_filter']);
    if (m.length) return 'нет масла в двигателе (' + m.join(', ') + ').';
    m = miss(['radiator', 'upper_hose', 'lower_hose', 'thermostat', 'water_pump']);
    if (m.length) return 'система охлаждения разобрана (' + m.join(', ') + ').';
    m = miss(['intake_manifold', 'throttle', 'exhaust_manifold']);
    if (m.length) return 'не собраны впуск/выпуск (' + m.join(', ') + ').';
    m = miss(['plug_1', 'plug_2', 'plug_3', 'plug_4']);
    if (m.length) return 'выкручены свечи (' + m.join(', ') + ').';
    return null;
  }

  private fuseOk(id: string): boolean { return store.installed(id) && store.defect(id) !== 'blown'; }
  private relayOk(id: string): boolean { return store.installed(id) && store.defect(id) !== 'coil_open'; }

  private computeNet(dt: number): void {
    const n: Net = { ...ZERO_NET };
    n.battPresent = store.installed('battery');
    n.negOk = store.installed('battery_neg');
    const starterLoad = this.cranking ? 1 : 0;
    const igLoad = this.ign === 'on' || this.ign === 'start' ? 1 : 0;
    if (n.battPresent) {
      let v = this.soc - igLoad * 0.15;
      if (this.chargeOk) v = 14.1;
      // Попытка прокрутки (ST) нагружает АКБ, даже если стартер не провернул
      // Втягивающее реле стартера нагружает АКБ всё время, пока ключ в START
      const stDraw = this.ign === 'start' && !this.running && n.negOk && this.fuseOk('fuse_am2') && this.relayOk('relay_st') && store.live('starter') ? 1 : 0;
      if (stDraw) v = this.soc - (this.cranking ? 2.3 : 1.2);
      n.vPost = Math.max(0, v);
      if (store.installed('battery_pos')) {
        const corroded = store.defect('battery_pos') === 'corroded';
        const drop = stDraw ? (corroded ? 6.2 : 0.15) : corroded ? 0.08 : 0.02;
        n.vClamp = Math.max(0, n.vPost - drop);
      }
    }
    n.bplus = n.negOk ? n.vClamp : 0;
    n.am2 = this.fuseOk('fuse_am2') ? n.bplus : 0;
    n.igOn = (this.ign === 'on' || this.ign === 'start') && n.am2 > 6;
    n.ig2feed = this.ign === 'on' || this.ign === 'start' ? n.am2 : 0;
    n.ig2 = this.fuseOk('fuse_ig2') ? n.ig2feed : 0;
    n.efiFuseOut = this.fuseOk('fuse_efi') ? n.bplus : 0;
    n.efiRelayOn = n.igOn && this.relayOk('relay_efi');
    n.efiB = n.efiRelayOn ? n.efiFuseOut : 0;
    n.ecuOn = n.efiB > 8 && store.installed('ecu') && store.live('ecu_conn');
    n.efi2 = this.fuseOk('fuse_efi2') ? n.efiB : 0;
    n.etcs = this.fuseOk('fuse_etcs') ? n.bplus : 0;
    n.alts = this.fuseOk('fuse_alts') ? n.bplus : 0;
    n.rdi = this.fuseOk('fuse_rdi') ? n.bplus : 0;
    n.copnOn = n.ecuOn && (this.primeTimer > 0 || this.cranking || this.running) && this.relayOk('relay_copn');
    n.pumpV = n.copnOn ? n.efiB : 0;
    n.stRelayOn = this.ign === 'start' && n.am2 > 6 && this.relayOk('relay_st');
    n.st50 = n.stRelayOn && store.live('starter') ? n.am2 : 0;
    n.v30 = store.installed('starter') ? n.bplus : 0;
    n.fanRelayOn = n.ecuOn && this.fanCmd && this.relayOk('relay_fan');
    n.fanV = n.fanRelayOn ? n.rdi : 0;
    this.net = n;
    this.netPrev = n;
  }
  private netPrev: Net = { ...ZERO_NET };

  private setDtc(code: string, cond: boolean, delay: number, dt: number): void {
    if (!cond) { this.pending.delete(code); return; }
    if (this.dtcs.has(code)) return;
    const t = (this.pending.get(code) ?? 0) + dt;
    this.pending.set(code, t);
    if (t >= delay) {
      this.dtcs.set(code, {
        code, text: DTC_TEXT[code] ?? '', mil: true, at: this.time,
        frame: {
          'Обороты': Math.round(this.rpm) + ' об/мин', 'Темп. ОЖ': Math.round(this.ectRead) + ' °C',
          'Нагрузка': Math.round(this.load) + ' %', 'STFT': this.stft.toFixed(1) + ' %', 'LTFT': this.ltft.toFixed(1) + ' %',
          'Напряжение': this.net.bplus.toFixed(1) + ' В',
        },
      });
      log(`ЭБУ записал код ошибки ${code}`, 'err');
    }
  }

  clearDtcs(): void {
    this.dtcs.clear();
    this.misfires = [0, 0, 0, 0];
    this.pending.clear();
    this.ltft = 0;
  }

  private warnOnce(key: string, text: string, kind: 'warn' | 'err' | 'info' | 'ok' = 'warn'): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    log(text, kind);
  }

  step(dtReal: number): void {
    const dt = Math.min(dtReal, 0.1);
    this.time += dt;
    if (this.primeTimer > 0) this.primeTimer -= dt;
    this.computeNet(dt);
    const n = this.net;

    // ---------- Стартер ----------
    const wantCrank = this.ign === 'start' && !this.running;
    const solenoid = wantCrank && n.stRelayOn && store.live('starter');
    let canCrank = solenoid && n.st50 > 6;
    if (solenoid && n.v30 < 8.5) {
      canCrank = false;
      this.warnOnce('click', 'Щелчок тягового реле стартера, стартер не крутит. Приборная панель тускнеет.');
    }
    if (canCrank && this.mechanicalBlock()) canCrank = false;
    if (canCrank && this.soc < 10.9) {
      canCrank = false;
      this.warnOnce('lowbatt', 'АКБ разряжен — стартер не проворачивает двигатель.');
    }
    if (wantCrank && !solenoid && n.igOn) this.warnOnce('nost', 'Стартер молчит — нет напряжения на клемме 50.');
    if (!wantCrank) { this.warned.delete('click'); this.warned.delete('nost'); this.warned.delete('lowbatt'); this.warned.delete('crank'); }
    if (canCrank && !this.cranking) this.warnOnce('crank', 'Стартер крутит двигатель…');
    this.cranking = canCrank;
    this.crankTime = this.cranking ? this.crankTime + dt : 0;

    // ---------- Топливо ----------
    if (n.pumpV > 8) this.fuelPressure = Math.min(325, this.fuelPressure + 600 * dt);
    else this.fuelPressure = Math.max(0, this.fuelPressure - (this.running ? 300 : 4) * dt);

    // ---------- Сигналы датчиков ----------
    const turning = this.cranking || this.running;
    const ckpOk = store.live('ckp') && store.defect('ckp') !== 'open';
    const ckpSignal = ckpOk && turning;
    const cmpInOk = store.live('cmp_in');
    const cmpExOk = store.live('cmp_ex');

    const ectOk = store.live('ect') && store.defect('ect') !== 'open';
    this.ectRead = n.ecuOn ? (ectOk ? this.coolant : -40) : this.ectRead;
    const mafLive = store.live('maf') && n.efi2 > 8;
    const iatOk = store.live('maf');
    this.iatRead = iatOk ? this.ambient + 5 : -40;

    // ---------- Искра и топливо по цилиндрам ----------
    for (let i = 0; i < 4; i++) {
      const c = `coil_${i + 1}`;
      const spark = n.ecuOn && ckpSignal && n.ig2 > 9 && store.live(c) && store.defect(c) !== 'dead' && store.installed(`plug_${i + 1}`);
      const inj = n.ecuOn && ckpSignal && n.ig2 > 9 && store.live(`injector_${i + 1}`) && this.fuelPressure > 180;
      this.sparkOk[i] = spark;
      this.cylOk[i] = spark && inj;
    }
    const working = this.cylOk.filter(Boolean).length;
    const block = this.mechanicalBlock();

    // ---------- Дроссель ----------
    const tpsOk = store.live('throttle');
    this.limp = !tpsOk || n.etcs < 8;
    const thrTarget = this.limp ? 0.06 : this.pedal * 0.85 + 0.02;
    this.throttleAct += (thrTarget - this.throttleAct) * Math.min(1, dt * 8);

    // ---------- Запуск / остановка ----------
    if (this.cranking && !this.running && !block) {
      const needed = this.ectRead < 0 ? 1.2 : 0.7;
      if (working >= 2 && this.crankTime > needed && this.fuelPressure > 200) {
        this.running = true;
        this.runTime = 0;
        this.rpm = Math.max(this.rpm, 600);
        log(working < 4 ? 'Двигатель завёлся, но работает неровно.' : 'Двигатель запустился.', working < 4 ? 'warn' : 'ok');
      }
    }
    if (this.running) {
      this.runTime += dt;
      let stall: string | null = null;
      if (!n.igOn) stall = 'Двигатель заглох — пропало питание зажигания.';
      else if (!n.ecuOn) stall = 'Двигатель заглох — ЭБУ без питания.';
      else if (working < 2) stall = 'Двигатель заглох — работает меньше двух цилиндров.';
      else if (this.fuelPressure < 150) stall = 'Двигатель заглох — упало давление топлива.';
      else if (block) stall = 'Двигатель остановлен: ' + block;
      else if (this.coolant > 118) stall = 'ПЕРЕГРЕВ! Двигатель заглушен, чтобы не повредить ГБЦ.';
      if (stall) { this.running = false; log(stall, 'err'); }
    }

    // ---------- Воздух, смесь ----------
    const leak = (store.defect('pcv_hose') === 'cracked' || !store.installed('pcv_hose') ? 0.65 : 0) + (!store.installed('air_duct') ? 1.2 : 0);
    const dirty = store.defect('maf') === 'dirty';

    // ---------- Обороты ----------
    const dead = 4 - working;
    const ectForEcu = this.ectRead;
    let idle = lerp(1350, 720, (ectForEcu - 10) / 60);
    if (this.limp) idle = Math.max(idle, 1250);
    if (leak > 0) idle += 90;
    let target = 0;
    let kUp = 3.2, kDown = 2.4;
    if (this.running) {
      target = idle + (this.limp ? 0 : Math.pow(this.pedal, 1.2) * (6300 - idle));
      target *= 1 - dead * 0.12;
      if (target > 6200) target = 6200 + Math.random() * 100 - 120; // отсечка
      if (dirty) kUp = 1.1;
      if (!mafLive) kUp = 1.6;
    } else if (this.cranking) {
      target = this.soc > 11.8 ? 230 : 160;
      kUp = 6;
    }
    const k = target > this.rpm ? kUp : kDown;
    this.rpm += (target - this.rpm) * Math.min(1, k * dt);
    if (!this.running && !this.cranking && this.rpm < 40) this.rpm = 0;
    // Неровность
    let jitterAmp = 0;
    if (this.running) {
      jitterAmp = dead * 70 + (store.defect('ocv_in') === 'stuck' && this.pedal < 0.05 ? 90 : 0) + (leak > 0 && this.pedal < 0.05 ? 25 : 0) + (ectForEcu < -20 ? 30 : 0);
    }
    this.rpmJitter += ((Math.random() * 2 - 1) * jitterAmp - this.rpmJitter) * Math.min(1, dt * 10);
    const rpmShown = Math.max(0, this.rpm + this.rpmJitter);

    // ---------- Расход воздуха и коррекции ----------
    if (this.running) {
      this.mafTrue = (rpmShown / 300) * (0.9 + 1.6 * this.throttleAct) + leak;
      const metered = this.mafTrue - leak;
      this.mafRead = mafLive ? metered * (dirty ? 0.78 : 1) : 0;
      this.load = clamp((this.mafTrue / (rpmShown / 60)) * 55, 0, 100);
    } else {
      this.mafTrue = 0; this.mafRead = 0; this.load = 0;
    }
    const closedLoop = this.running && this.coolant > 45 && this.runTime > 15 && store.live('o2_up') && ectOk;
    let err = 0;
    if (this.running && mafLive && this.mafRead > 0.1) err = (this.mafTrue / Math.max(0.5, this.mafRead) - 1) * 100;
    if (closedLoop) {
      const ltTarget = clamp(err * 0.8, -25, 25);
      this.ltft += (ltTarget - this.ltft) * Math.min(1, dt * 0.08);
      const stTarget = clamp(err - this.ltft, -25, 25) + Math.sin(this.time * 6) * 2;
      this.stft += (stTarget - this.stft) * Math.min(1, dt * 3);
    } else {
      this.stft += (0 - this.stft) * Math.min(1, dt * 2);
    }
    const residualLean = closedLoop ? err - this.ltft - this.stft : 0;

    // ---------- Датчики кислорода ----------
    if (this.running && this.runTime > 10 && store.live('o2_up') && n.efi2 > 8) {
      if (residualLean > 4) this.o2up = 0.12 + Math.random() * 0.08;
      else this.o2up = 0.45 + 0.4 * Math.sin(this.time * (2 + rpmShown / 900)) + (Math.random() - 0.5) * 0.05;
    } else this.o2up = store.live('o2_up') ? 0.45 : 0;
    this.o2down = this.running && this.runTime > 30 && store.live('o2_down') ? 0.66 + Math.sin(this.time * 0.4) * 0.03 : store.live('o2_down') ? 0.1 : 0;

    // ---------- VVT-i ----------
    const vvtTarget = this.running && rpmShown > 1100 ? clamp((rpmShown - 1100) / 70, 0, 35) * (0.4 + this.throttleAct) : 0;
    this.vvtInT = clamp(vvtTarget, 0, 40);
    this.vvtExT = clamp(vvtTarget * 0.6, 0, 25);
    const ocvIn = store.live('ocv_in') && n.ecuOn;
    const ocvEx = store.live('ocv_ex') && n.ecuOn;
    const inStuck = store.defect('ocv_in') === 'stuck';
    const exStuck = store.defect('ocv_ex') === 'stuck';
    const pressOk = this.oilPressure > 60;
    const aIn = inStuck && pressOk ? 38 : ocvIn && pressOk ? this.vvtInT : 0;
    const aEx = exStuck && pressOk ? 24 : ocvEx && pressOk ? this.vvtExT : 0;
    this.vvtInA += (aIn - this.vvtInA) * Math.min(1, dt * 3);
    this.vvtExA += (aEx - this.vvtExA) * Math.min(1, dt * 3);

    // ---------- Опережение, впрыск ----------
    this.advance = this.running ? clamp(8 + (rpmShown - 700) / 160 - this.load * 0.05, 5, 38) : this.cranking ? 5 : 0;
    this.injMs = this.running ? clamp(2.2 + this.load * 0.04 + (ectForEcu < 40 ? (40 - ectForEcu) * 0.03 : 0), 1.8, 14) : this.cranking ? 6 : 0;

    // ---------- Масло ----------
    const oilPresent = store.installed('oil_pan') && store.installed('oil_drain') && store.installed('oil_filter');
    const oilT = turning && oilPresent ? (this.running ? 150 + rpmShown * 0.06 : 60) : 0;
    this.oilPressure += (oilT - this.oilPressure) * Math.min(1, dt * 4);

    // ---------- Охлаждение ----------
    const pumpTurning = this.running && store.installed('drive_belt') && store.installed('water_pump');
    const fanSpin = n.fanV > 8 && store.live('fan');
    if (n.ecuOn) {
      if (!ectOk) this.fanCmd = true; // аварийный режим: вентилятор включён постоянно
      else if (this.ectRead >= 96) this.fanCmd = true;
      else if (this.ectRead <= 92) this.fanCmd = false;
    } else this.fanCmd = false;
    this.fanOn = fanSpin;
    const wf = this.warmFactor;
    if (this.running) {
      const heat = (0.18 + rpmShown / 9000) * wf;
      let cool = 0;
      if (pumpTurning) {
        const open = clamp((this.coolant - 82) / 13, 0, 1);
        cool = open * (this.coolant - this.ambient) * (0.006 + (fanSpin ? 0.012 : 0.002)) * wf;
      }
      this.coolant += (heat - cool) * dt;
      if (!pumpTurning) this.warnOnce('nopump', 'Помпа не вращается (нет ремня) — температура быстро растёт!', 'err');
    } else {
      this.coolant += (this.ambient - this.coolant) * 0.0015 * wf * dt;
      if (fanSpin && this.coolant > this.ambient) this.coolant -= 0.01 * wf * dt;
    }
    if (pumpTurning) this.warned.delete('nopump');
    if (this.coolant > 108) this.warnOnce('hot', 'Температура ОЖ выше 108 °C — перегрев!', 'err');
    if (this.coolant < 100) this.warned.delete('hot');

    // ---------- Зарядка ----------
    const altDrive = this.running && store.installed('drive_belt');
    this.chargeOk = altDrive && store.installed('alternator') && store.defect('alternator') !== 'no_charge' && n.ig2feed > 6;
    if (this.chargeOk) this.soc += (12.65 - this.soc) * dt * 0.05;
    else if (this.running) this.soc -= 0.006 * dt * wf * 0.3;
    else if (this.cranking) this.soc -= 0.004 * dt;
    else if (n.igOn) this.soc -= 0.0002 * dt;
    this.soc = clamp(this.soc, 9.5, 12.7);

    // ---------- Коды ошибок ----------
    if (n.ecuOn) {
      this.setDtc('P0118', !ectOk, 1, dt);
      this.setDtc('P0102', !store.live('maf'), 1.5, dt);
      this.setDtc('P0113', !iatOk, 1.5, dt);
      this.setDtc('P0120', !tpsOk, 0.5, dt);
      this.setDtc('P2135', !tpsOk, 0.5, dt);
      this.setDtc('P2102', tpsOk && n.etcs < 8, 0.5, dt);
      this.setDtc('P0010', !store.live('ocv_in'), 1, dt);
      this.setDtc('P0013', !store.live('ocv_ex'), 1, dt);
      this.setDtc('P0335', this.cranking && !ckpOk && (cmpInOk || cmpExOk) && this.crankTime > 2, 0, dt);
      this.setDtc('P0340', turning && !cmpInOk && ckpOk, 2, dt);
      this.setDtc('P0365', turning && !cmpExOk && ckpOk, 2, dt);
      this.setDtc('P0011', this.running && this.vvtInA - this.vvtInT > 10, 5, dt);
      this.setDtc('P0014', this.running && this.vvtExA - this.vvtExT > 10, 5, dt);
      this.setDtc('P0101', this.running && dirty && this.coolant > 60 && rpmShown > 2000, 3, dt);
      this.setDtc('P0171', closedLoop && err > 24, 8, dt);
      this.setDtc('P0327', this.running && !store.live('knock'), 5, dt);
      this.setDtc('P0130', this.running && this.runTime > 20 && !store.live('o2_up'), 3, dt);
      this.setDtc('P0135', this.running && (!store.live('o2_up') || n.efi2 < 8), 10, dt);
      this.setDtc('P0136', this.running && this.runTime > 30 && !store.live('o2_down'), 3, dt);
      this.setDtc('P0141', this.running && (!store.live('o2_down') || n.efi2 < 8), 15, dt);
      let mis = 0;
      for (let i = 0; i < 4; i++) {
        const c = `coil_${i + 1}`;
        this.setDtc(`P035${i + 1}`, turning && !store.live(c), 1.5, dt);
        const m = this.running && !this.cylOk[i];
        if (m) { mis++; this.misfires[i] += (rpmShown / 120) * dt; }
        this.setDtc(`P030${i + 1}`, m, 3, dt);
      }
      this.setDtc('P0300', this.running && mis >= 2, 3, dt);
    }

    // ---------- Лампы ----------
    const ig = n.igOn;
    const anyMil = [...this.dtcs.values()].some((d) => d.mil);
    const misfireActive = this.running && working < 4;
    this.lamps.mil = ig && n.ecuOn && (!this.running || anyMil || misfireActive);
    this.lamps.milBlink = this.lamps.mil && misfireActive;
    this.lamps.batt = ig && !this.chargeOk;
    this.lamps.oil = ig && store.live('oil_press') && this.oilPressure < 30;
    this.lamps.hot = ig && this.coolant > 115;
    this.rpmOut = this.running || this.cranking ? (ckpSignal || this.running ? rpmShown : 0) : 0;
    // Тахометр работает от сигнала ЭБУ: без датчика коленвала стрелка стоит
    if (!n.ecuOn || !ckpOk) this.rpmOut = 0;
    this.rpmVisual = rpmShown;
  }
  /** Обороты для тахометра (по сигналу ЭБУ). */
  rpmOut = 0;
  /** Физические обороты вала (для анимации). */
  rpmVisual = 0;
}

export const sim = new Sim();

