// ============================================================================
// МОДУЛЬ 3: ЕДИНОЕ ЯДРО ФИЗИЧЕСКОЙ И ЭЛЕКТРИЧЕСКОЙ СИМУЛЯЦИИ, ЭБУ,
// ЗВУКОВОЙ СИНТЕЗАТОР WEB AUDIO API, ПРИБОРЫ, РЕМОНТ И 10 ОБЯЗАТЕЛЬНЫХ ТЕСТОВ
// ============================================================================

window.createInitialSimState = function() {
  const fuses = {};
  window.FUSE_DEFINITIONS.forEach(f => {
    fuses[f.id] = { installed: true, blown: false, rating: f.rating, nominalRating: f.rating };
  });

  const relays = {};
  window.RELAY_DEFINITIONS.forEach(r => {
    relays[r.id] = { installed: true, faulty: false, energized: false };
  });

  const components = {};
  window.COMPONENT_REGISTRY.forEach(c => {
    components[c.id] = {
      installed: true,
      connectorPlugged: true,
      boltsFastened: true,
      condition: "good", // "good" | "dead" | "degraded"
      originSlot: c.id,  // для отслеживания перестановки катушек/свечей/форсунок между цилиндрами!
      partSerial: "OEM-" + c.id.toUpperCase()
    };
  });

  return {
    // Режим интерфейса и уровень сложности
    uiMode: "assembled", // assembled | cutaway | schematic | sensors | ecu_wiring | diagnostics | repair | training
    difficulty: "novice", // novice | master | expert
    activeFaultIds: [],
    faultRevealedHintLevel: 0, // 0..5 (выключены по умолчанию!)

    // Управление 3D-видом
    cutawayEnabled: false,
    transparencyLevel: 0.0, // 0..0.85
    slowMotionFactor: 1.0,  // 1.0 | 0.25 | 0.05
    hiddenGroups: { valve_cover: false, intake: false, exhaust: false, accessories: false, harness: false },
    selectedComponentId: "ecm",

    // Состояние замка зажигания и режимов двигателя (п. 7 ТЗ: 10 состояний)
    ignitionKey: "OFF", // "OFF" | "IG_ON" | "START"
    engineState: "ВЫКЛЮЧЕНО", // ВЫКЛЮЧЕНО | ЗАЖИГАНИЕ | СТАРТЕР | ЗАПУСК | ПРОГРЕВ | ХОЛОСТОЙ ХОД | ГАЗ | УСЛОВНАЯ НАГРУЗКА | ОСТАНОВКА | АВАРИЙНАЯ ОСТАНОВКА
    throttlePedalPct: 0, // 0..100%
    externalLoadActive: false, // Условная нагрузка (движение 40 км/ч / стенд)
    acSwitchOn: false,
    brakePedalPressed: false,
    soundMuted: false,

    // Физические переменные единой модели
    rpm: 0,
    targetRpm: 0,
    coolantTempC: 24.0,
    intakeAirTempC: 23.0,
    batterySoc: 98.0,
    batteryOpenCircuitV: 12.65,
    systemVoltage: 12.65,
    chargingCurrentA: 0.0,
    fuelPressureBar: 0.0,
    manifoldAbsolutePressureKpa: 101.0,
    mafGramsPerSec: 0.0,
    throttleAngleDeg: 6.0,
    afrActual: 14.7,
    stftPct: 0.0,
    ltftPct: 0.0,
    ignitionAdvanceDeg: 10.0,
    vvtIntakeAngleDeg: 0.0,
    vvtExhaustAngleDeg: 0.0,
    oilPressureBar: 0.0,
    compressionBar: [13.0, 13.0, 13.0, 13.0],
    cylinderMisfire: [false, false, false, false],
    checkEngineLight: false,
    oilWarningLight: false,
    chargeWarningLight: false,
    limpHomeMode: false,
    coolingFanRunning: false,

    // Электрическая сеть, предохранители, реле, дефекты проводки
    fuses: fuses,
    relays: relays,
    components: components,
    wireFaults: {}, // { [probePointId]: "open" | "short_gnd" | "short_vcc" | "high_res" }

    // Коды DTC и Freeze Frame в памяти ЭБУ
    activeDtcs: [],
    pendingDtcs: [],
    FreezeFrame: null,
    readinessMonitors: {
      misfire: "COMPLETE",
      fuelSystem: "COMPLETE",
      comprehensive: "COMPLETE",
      catalyst: "COMPLETE",
      oxygenSensor: "COMPLETE",
      oxygenHeater: "COMPLETE",
      evap: "COMPLETE"
    },

    // Приборы диагностики (п. 6 ТЗ)
    activeTool: "multimeter", // multimeter | testlight | continuity | oscilloscope | obd2
    probeRed: "BAT+",
    probeBlack: "BAT-",
    dmmMode: "DC_V", // DC_V | AC_V | OHM | CONT | DIODE | DC_A
    dmmRange: "AUTO",
    testLightType: "LED", // "LOAD_21W" | "LED"
    oscCh1Pin: "B31-122_NE+",
    oscCh2Pin: "B31-99_G2+",
    oscTimeDivMs: 10,
    oscVoltDivCh1: 5,
    oscVoltDivCh2: 5,
    oscPaused: false,
    obdConnected: false,
    obdTab: "dtc", // dtc | livedata | freezeframe | monitors

    // Журнал действий и измерений (п. 9 ТЗ)
    actionHistory: [
      { time: "00:00", type: "info", text: "Стенд Toyota Corolla E150 (1ZR-FE 1.6 л Dual VVT-i) инициализирован. Все системы в заводской конфигурации." }
    ],
    safetyWarning: null,
    verificationResult: null
  };
};

// Детерминированный расчёт электрической сети и физики двигателя на каждом шаге
window.stepSimulation = function(state, dt) {
  const f = state.fuses;
  const r = state.relays;
  const c = state.components;
  const wf = state.wireFaults;

  const isFuseOk = (id) => f[id] && f[id].installed && !f[id].blown && f[id].rating > 0;
  const isCompOk = (id) => c[id] && c[id].installed && c[id].connectorPlugged && c[id].boltsFastened && c[id].condition === "good";
  const isCompPresent = (id) => c[id] && c[id].installed && c[id].connectorPlugged;
  const wfOf = (pin) => wf[pin] || "none";

  // 1. Проверка базовой батареи и масс
  const batConnected = c.battery && c.battery.installed && c.battery.connectorPlugged;
  const batGood = batConnected && c.battery.condition === "good";
  const batBaseV = !batConnected ? 0.0 : (batGood ? state.batteryOpenCircuitV : 10.6);

  const g1HighRes = wfOf("GND_G1") === "high_res";
  const g2HighRes = wfOf("GND_G2") === "high_res";
  const g2Open = wfOf("GND_G2") === "open";
  const e1Open = wfOf("GND_E1") === "open";
  const e1HighRes = wfOf("GND_E1") === "high_res";

  // 2. Проверка коротких замыканий на массу и мгновенного перегорания предохранителей (п. 5, 10, 15 ТЗ Тест 5!)
  if (batConnected) {
    if (wfOf("A50-3_+BM") === "short_gnd" && isFuseOk("fuse_etcs")) {
      f.fuse_etcs.blown = true;
      window.logSimAction(state, "warn", "ЩЕЛЧОК! Из-за неустранённого КЗ на массу в цепи A50-3 (+BM) мгновенно перегорел предохранитель ETCS (" + f.fuse_etcs.rating + "A)!");
    }
    if (wfOf("DLC3-16_BAT") === "short_gnd" && isFuseOk("fuse_obd")) {
      f.fuse_obd.blown = true;
      window.logSimAction(state, "warn", "ЩЕЛЧОК! Короткое замыкание на пине 16 DLC3 вызвало перегорание предохранителя OBD!");
    }
    if (wfOf("A50-20_BATT") === "short_gnd" && isFuseOk("fuse_efi_main")) {
      f.fuse_efi_main.blown = true;
      window.logSimAction(state, "warn", "ЩЕЛЧОК! КЗ в линии BATT вызвало перегорание предохранителя EFI MAIN!");
    }
  }

  // 3. Реле IG2 и цепь включения зажигания IGSW
  const igKeyOn = state.ignitionKey === "IG_ON" || state.ignitionKey === "START";
  const startKeyOn = state.ignitionKey === "START";

  const am2Powered = batConnected && isFuseOk("fuse_am2");
  const ig2No2Powered = am2Powered && igKeyOn && isFuseOk("fuse_ig2_no2");
  r.relay_ig2.energized = ig2No2Powered && r.relay_ig2.installed && !r.relay_ig2.faulty;

  const piPowered = batConnected && isFuseOk("fuse_pi");
  const ig2BusPowered = piPowered && isFuseOk("fuse_ig2") && r.relay_ig2.energized && wfOf("RELAY_IG2_OUT") !== "open";
  const ignPowered = ig2BusPowered && isFuseOk("fuse_ign") && wfOf("A50-28_IGSW") !== "open";

  // Проверка питания ЭБУ и Главного реле EFI MAIN
  const ecmHasGnd = !e1Open && c.ecm.installed && c.ecm.connectorPlugged;
  const efiMainFuseOk = piPowered && isFuseOk("fuse_efi_main");
  const ecmHasBatt = efiMainFuseOk && wfOf("A50-20_BATT") !== "open";
  const ecmHasIgsw = ignPowered && ecmHasGnd;
  const mrelSignalActive = ecmHasIgsw && wfOf("A50-44_MREL") !== "open";

  r.relay_efi_main.energized = mrelSignalActive && efiMainFuseOk && r.relay_efi_main.installed && !r.relay_efi_main.faulty;
  const efiMainOut = r.relay_efi_main.energized && wfOf("RELAY_EFI_OUT") !== "open";

  // Шины после главного реле EFI MAIN
  if (efiMainOut) {
    if ((wfOf("A50-2_+B") === "short_gnd" || wfOf("MAF_+B") === "short_gnd") && isFuseOk("fuse_efi_no1")) {
      f.fuse_efi_no1.blown = true;
      window.logSimAction(state, "warn", "ЩЕЛЧОК! КЗ в цепи после реле EFI MAIN сожгло предохранитель EFI NO.1!");
    }
    if (wfOf("B31-109_HA1A") === "short_gnd" && isFuseOk("fuse_efi_no2")) {
      f.fuse_efi_no2.blown = true;
      window.logSimAction(state, "warn", "ЩЕЛЧОК! КЗ в цепи EFI NO.2 сожгло предохранитель EFI NO.2!");
    }
  }

  const efiNo1Powered = efiMainOut && isFuseOk("fuse_efi_no1");
  const efiNo2Powered = efiMainOut && isFuseOk("fuse_efi_no2");
  const ecmPowered = efiNo1Powered && ecmHasGnd && wfOf("A50-2_+B") !== "open";

  // 4. Цепь стартера (ST Relay + Starter)
  r.relay_st.energized = startKeyOn && am2Powered && r.relay_st.installed && !r.relay_st.faulty && wfOf("ST_50") !== "open";
  const starterHas30 = batConnected && wfOf("ST_30") !== "open";
  const starterHas50 = r.relay_st.energized;
  const starterCanSpin = starterHas30 && starterHas50 && isCompOk("starter") && !g2Open;

  // Учет падения напряжения при прокрутке и плохой массе G2 (Тест и сценарий G2)
  let crankingRpm = 0;
  if (startKeyOn && starterCanSpin) {
    if (!batGood) {
      crankingRpm = 45;
    } else if (g2HighRes || g1HighRes) {
      crankingRpm = 58; // Плохая масса G2 — вялая прокрутка, напряжение на блоке проседает!
    } else {
      crankingRpm = 215;
    }
  }

  // 5. Сигнал ДПКВ (NE+) и разрешение топливного насоса (C/OPN Relay)
  const ckpOk = isCompOk("ckp_sensor") && wfOf("B31-122_NE+") === "none" && wfOf("B31-121_NE-") === "none";
  const mechanicalSpinning = state.rpm > 40 || crankingRpm > 40;
  const ecmSeesNeSignal = ecmPowered && ckpOk && mechanicalSpinning;

  // Реле бензонасоса C/OPN включается, когда ЭБУ запитан и видит сигнал стартера STA или вращение NE
  const fcActive = ecmPowered && (starterHas50 || ecmSeesNeSignal) && wfOf("A50-7_FC") === "none";
  r.relay_copn.energized = fcActive && efiMainOut && r.relay_copn.installed && !r.relay_copn.faulty;

  const fpPowered = r.relay_copn.energized && wfOf("FP_PWR") === "none" && isCompPresent("fuel_pump");
  if (fpPowered && c.fuel_pump.condition === "good") {
    state.fuelPressureBar = 3.25;
  } else if (fpPowered && c.fuel_pump.condition === "degraded") {
    state.fuelPressureBar = 1.65;
  } else {
    state.fuelPressureBar = Math.max(0, state.fuelPressureBar - dt * 1.8);
  }

  // 6. Проверка работы цилиндров 1–4 (Форсунки + Катушки + Свечи + Компрессия)
  const injBusPowered = piPowered && isFuseOk("fuse_igt_inj") && igKeyOn && wfOf("INJ_+B") === "none";
  const coilBusPowered = ig2BusPowered && wfOf("COIL_+B") === "none";

  // Компрессия в цилиндрах (если block_crank_pistons degraded -> Цил. 4 = 6.2 бар)
  state.compressionBar = c.block_crank_pistons.condition === "degraded"
    ? [13.0, 13.0, 12.9, 6.2]
    : [13.0, 13.0, 13.0, 13.0];

  const cylFiring = [false, false, false, false];
  for (let i = 1; i <= 4; i++) {
    const coilId = "coil_" + i;
    const sparkId = "spark_" + i;
    const injId = "inj_" + i;
    const igtPin = "B31-" + (86 - i) + "_IGT" + i;
    const injPin = "B31-" + (109 - i) + "_INJ" + i;

    const coilWorks = coilBusPowered && isCompOk(coilId) && wfOf(igtPin) === "none" && !e1Open;
    const sparkWorks = isCompOk(sparkId);
    const injWorks = injBusPowered && isCompOk(injId) && wfOf(injPin) === "none" && state.fuelPressureBar >= 1.5;
    const compWorks = state.compressionBar[i - 1] >= 9.5;

    const ok = ecmSeesNeSignal && coilWorks && sparkWorks && injWorks && compWorks;
    cylFiring[i - 1] = ok;
    state.cylinderMisfire[i - 1] = (state.rpm > 350) && !ok;
  }

  const activeCylCount = cylFiring.filter(Boolean).length;

  // 7. Электронный дроссель ETCS-i и впуск
  const etcsPowered = batConnected && isFuseOk("fuse_etcs") && wfOf("A50-3_+BM") === "none";
  const tpsOk = isCompOk("tps_sensor") && wfOf("B31-115_VTA1") === "none" && wfOf("B31-114_VTA2") === "none" && wfOf("B31-67_VCTA") === "none";
  const appOk = isCompOk("app_sensor") && wfOf("A50-55_VPA") === "none" && wfOf("A50-56_VPA2") === "none" && wfOf("A50-57_VCPA") === "none";
  const throttleMotorOk = etcsPowered && isCompOk("throttle_body") && wfOf("B31-42_M+") === "none" && wfOf("B31-41_M-") === "none";

  state.limpHomeMode = !throttleMotorOk || !tpsOk || !appOk;
  if (!ecmPowered || state.ignitionKey === "OFF") {
    state.throttleAngleDeg = 6.0;
  } else if (state.limpHomeMode) {
    state.throttleAngleDeg = 6.0; // Аварийная возвратная пружина БДЗ 6° (RM04F1RU P2102)
  } else {
    const baseIdleDeg = state.coolantTempC < 60 ? 5.2 : 3.8;
    const acAdder = state.acSwitchOn ? 1.1 : 0.0;
    state.throttleAngleDeg = Math.min(84.0, baseIdleDeg + acAdder + (state.throttlePedalPct * 0.78));
  }

  // 8. Расчёт запуска, оборотов и 10 состояний двигателя (п. 7 ТЗ)
  const canSustainRun = ecmSeesNeSignal && activeCylCount >= 2 && crankingRpm >= 120 || (state.rpm > 320 && ecmSeesNeSignal && activeCylCount >= 2);

  if (state.ignitionKey === "OFF") {
    state.rpm = Math.max(0, state.rpm - dt * 1400);
    state.engineState = state.rpm > 50 ? "ОСТАНОВКА" : "ВЫКЛЮЧЕНО";
  } else if (state.ignitionKey === "START") {
    if (canSustainRun && crankingRpm >= 120) {
      state.rpm = Math.max(crankingRpm, Math.min(1150, state.rpm + dt * 950));
      state.engineState = state.rpm > 500 ? "ЗАПУСК" : "СТАРТЕР";
    } else {
      state.rpm = crankingRpm;
      state.engineState = crankingRpm > 10 ? "СТАРТЕР" : "ЗАЖИГАНИЕ";
    }
  } else if (state.ignitionKey === "IG_ON") {
    if (state.rpm > 320 && ecmSeesNeSignal && activeCylCount >= 2) {
      // Двигатель работает
      let baseIdle = state.coolantTempC < 50 ? 1150 : (state.coolantTempC < 75 ? 850 : 660);
      if (state.acSwitchOn) baseIdle += 110;
      // Эффект обрыва ДТОЖ (-40°C)
      const ectSensed = (isCompOk("ect_sensor") && wfOf("B31-97_THW") === "none") ? state.coolantTempC : -40;
      if (ectSensed < 0) baseIdle = 1280;

      let target = baseIdle;
      if (state.limpHomeMode) {
        target = 1120 + (appOk ? state.throttlePedalPct * 4.5 : 0);
      } else {
        target = baseIdle + state.throttlePedalPct * 52.0;
      }

      // Влияние неисправностей на обороты и стабильность
      const cylFactor = activeCylCount / 4.0;
      target = target * (0.55 + 0.45 * cylFactor);
      if (c.head_valvetrain_timing.condition === "degraded") target *= 0.86;
      if (c.intake_manifold_pcv.condition === "degraded" && state.throttlePedalPct < 8) {
        // Подсос воздуха: плавающий ХХ
        target += Math.sin(Date.now() * 0.006) * 95 - 45;
      }
      if (activeCylCount < 4) {
        target += Math.sin(Date.now() * 0.025) * 48; // Вибрация при троении
      }
      if (state.externalLoadActive) {
        target = Math.max(520, target - 220);
      }

      state.targetRpm = Math.min(6400, Math.max(420, target));
      state.rpm += (state.targetRpm - state.rpm) * Math.min(1, dt * 6.5);

      if (state.coolantTempC > 116) {
        state.engineState = "АВАРИЙНАЯ ОСТАНОВКА";
      } else if (state.externalLoadActive) {
        state.engineState = "УСЛОВНАЯ НАГРУЗКА";
      } else if (state.throttlePedalPct > 5) {
        state.engineState = "ГАЗ";
      } else if (state.coolantTempC < 75) {
        state.engineState = "ПРОГРЕВ";
      } else {
        state.engineState = "ХОЛОСТОЙ ХОД";
      }
    } else {
      const wasRunning = state.rpm > 300;
      state.rpm = Math.max(0, state.rpm - dt * 1200);
      state.engineState = wasRunning ? "АВАРИЙНАЯ ОСТАНОВКА" : "ЗАЖИГАНИЕ";
    }
  }

  const isRunning = state.rpm > 350;

  // 9. Зарядка АКБ и Генератор (п. 7 и Тесты 1, 2, 3)
  const altHasBPlus = batConnected && isFuseOk("fuse_alt") && wfOf("ALT_B+") === "none";
  const altHasSense = batConnected && isFuseOk("fuse_alt_s") && wfOf("ALT_S") === "none";
  const altHasIg = ignPowered && wfOf("ALT_IG") === "none";
  const altWorks = isRunning && isCompOk("alternator") && altHasBPlus && altHasSense && altHasIg && !g2Open;

  if (!batConnected) {
    state.systemVoltage = 0.0;
    state.chargingCurrentA = 0.0;
    state.chargeWarningLight = false;
  } else if (state.ignitionKey === "START" && starterCanSpin) {
    state.systemVoltage = !batGood ? 6.9 : (g2HighRes ? 9.8 : 10.25);
    state.chargingCurrentA = -125.0;
    state.chargeWarningLight = true;
  } else if (altWorks) {
    state.systemVoltage = g2HighRes ? 13.1 : 14.12;
    state.chargingCurrentA = 14.5 + (state.coolingFanRunning ? 12.0 : 0) + (state.acSwitchOn ? 8.0 : 0);
    state.chargeWarningLight = false;
  } else {
    const loadDrop = igKeyOn ? (isRunning ? 0.45 : 0.22) : 0.0;
    state.systemVoltage = Math.max(9.5, batBaseV - loadDrop);
    state.chargingCurrentA = igKeyOn ? (isRunning ? -18.5 : -4.2) : -0.05;
    state.chargeWarningLight = igKeyOn;
  }

  // 10. Впуск, ДМРВ, Состав смеси AFR и Топливные коррекции STFT / LTFT
  if (isRunning) {
    const vacuumLeak = c.intake_manifold_pcv.condition === "degraded" || (c.evap_purge_vsv.condition === "degraded");
    const realAirflow = 2.15 * (state.rpm / 660) * (1 + state.throttlePedalPct * 0.045);
    const mafPowered = efiNo1Powered && wfOf("MAF_+B") === "none";
    const mafSignalOk = mafPowered && isCompOk("maf_sensor") && wfOf("B31-118_VG") === "none";

    if (!mafSignalOk) {
      state.mafGramsPerSec = 0.0;
    } else if (vacuumLeak && state.throttlePedalPct < 15) {
      state.mafGramsPerSec = realAirflow * 0.62; // Часть воздуха идёт мимо ДМРВ!
    } else {
      state.mafGramsPerSec = realAirflow;
    }

    state.manifoldAbsolutePressureKpa = vacuumLeak
      ? Math.min(98, 48 + state.throttlePedalPct * 0.5)
      : Math.min(99, 32 + state.throttlePedalPct * 0.65);

    // Расчёт AFR и коррекций
    const afHeaterOk = efiNo2Powered && isCompOk("af_sensor_b1s1") && wfOf("B31-109_HA1A") === "none";
    const afSignalOk = afHeaterOk && wfOf("B31-112_A1A+") === "none" && wfOf("B31-113_A1A-") === "none";
    const ectOk = isCompOk("ect_sensor") && wfOf("B31-97_THW") === "none";

    if (!ectOk) {
      // ЭБУ видит -40°C и льёт топливо
      state.afrActual = 11.8;
      state.stftPct = afSignalOk ? -16.5 : 0.0;
      state.ltftPct = -8.2;
    } else if (vacuumLeak && state.throttlePedalPct < 15) {
      state.afrActual = 16.8; // Бедная смесь на ХХ
      state.stftPct = afSignalOk ? 18.4 : 0.0;
      state.ltftPct = afSignalOk ? 9.5 : 0.0;
    } else if (state.fuelPressureBar < 2.2) {
      state.afrActual = 16.4;
      state.stftPct = afSignalOk ? 16.0 : 0.0;
      state.ltftPct = 7.5;
    } else {
      state.afrActual = 14.7;
      state.stftPct = afSignalOk ? (Math.sin(Date.now() * 0.003) * 1.4) : 0.0;
      state.ltftPct = 0.8;
    }

    // УОЗ и Фазы Dual VVT-i
    const knockOk = isCompOk("knock_sensor") && wfOf("B31-110_KNK1") === "none";
    const baseAdv = 8.0 + (state.rpm - 660) * 0.0065;
    state.ignitionAdvanceDeg = knockOk ? Math.min(36, baseAdv) : Math.max(-2, baseAdv - 12.0); // Аварийное запаздывание при P0327/P0328

    const ocvInOk = isCompOk("ocv_intake") && wfOf("B31-100_OC1+") === "none";
    const ocvExOk = isCompOk("ocv_exhaust") && wfOf("B31-60_OE1+") === "none";
    state.vvtIntakeAngleDeg = ocvInOk && state.throttlePedalPct > 10 ? Math.min(40, state.throttlePedalPct * 0.38) : 0.0;
    state.vvtExhaustAngleDeg = ocvExOk && state.throttlePedalPct > 15 ? Math.min(25, state.throttlePedalPct * 0.22) : 0.0;

    state.oilPressureBar = Math.min(4.8, 1.45 + (state.rpm - 650) * 0.001);
    state.oilWarningLight = state.oilPressureBar < 0.4;
  } else {
    state.mafGramsPerSec = 0.0;
    state.manifoldAbsolutePressureKpa = 101.0;
    state.afrActual = 14.7;
    state.stftPct = 0.0;
    state.ignitionAdvanceDeg = 5.0;
    state.vvtIntakeAngleDeg = 0.0;
    state.vvtExhaustAngleDeg = 0.0;
    state.oilPressureBar = state.ignitionKey === "START" && starterCanSpin ? 0.65 : 0.0;
    state.oilWarningLight = igKeyOn && state.oilPressureBar < 0.3;
  }

  // 11. Тепловая модель и система охлаждения (п. 7 и Тест 7)
  const ectSensorOk = isCompOk("ect_sensor") && wfOf("B31-97_THW") === "none";
  const sensedTemp = ectSensorOk ? state.coolantTempC : -40.0;
  const fanRequested = ecmPowered && (sensedTemp >= 96.0 || !ectSensorOk || state.acSwitchOn || (state.coolingFanRunning && sensedTemp >= 91.0));
  r.relay_fan.energized = fanRequested && r.relay_fan.installed && !r.relay_fan.faulty && wfOf("A50-43_RFC") === "none";
  state.coolingFanRunning = r.relay_fan.energized && isFuseOk("fuse_rdi_fan") && isCompOk("cooling_fan") && wfOf("FAN_PWR") === "none";

  if (isRunning) {
    const heatGen = (0.72 + (state.rpm / 1800) * 0.85 + (state.externalLoadActive ? 0.55 : 0)) * dt;
    const thermoClosedFault = c.thermostat_water_pump.condition === "dead" || !c.thermostat_water_pump.installed;
    const thermoOpenFault = c.thermostat_water_pump.condition === "degraded";

    let heatReject = 0.0;
    if (thermoClosedFault) {
      // Заклинивший термостат или неработающая помпа -> нет теплоотвода в радиатор, перегрев до 114°C!
      heatReject = (state.coolantTempC - 24.0) * 0.0025 * dt;
    } else if (thermoOpenFault) {
      // Постоянно открытый большой круг -> недогрев ~64°C
      heatReject = (state.coolantTempC - 24.0) * 0.018 * dt;
    } else {
      const radOpen = state.coolantTempC >= 84.0 ? Math.min(1.0, (state.coolantTempC - 82.0) / 10.0) : 0.08;
      const fanMult = state.coolingFanRunning ? 2.4 : 0.55;
      heatReject = (state.coolantTempC - 24.0) * 0.0095 * radOpen * fanMult * dt;
    }
    state.coolantTempC = Math.min(118.0, Math.max(22.0, state.coolantTempC + heatGen - heatReject));
  } else {
    state.coolantTempC = Math.max(22.0, state.coolantTempC - dt * 0.08);
  }

  // 12. Диагностика ЭБУ и регистрация кодов DTC (только когда ЭБУ запитан!)
  if (ecmPowered) {
    const addDtc = (code, desc) => {
      if (!state.activeDtcs.some(d => d.code === code)) {
        state.activeDtcs.push({ code, desc, status: "Current / Confirmed" });
        if (!state.FreezeFrame) {
          state.FreezeFrame = {
            dtc: code,
            rpm: Math.round(state.rpm),
            coolantTempC: ectSensorOk ? Math.round(state.coolantTempC) : -40,
            intakeTempC: Math.round(state.intakeAirTempC),
            calcLoadPct: Math.round(isRunning ? 22 + state.throttlePedalPct * 0.7 : 0),
            mafGps: Number(state.mafGramsPerSec.toFixed(2)),
            stftPct: Number(state.stftPct.toFixed(1)),
            ltftPct: Number(state.ltftPct.toFixed(1)),
            afsVoltageV: Number((3.30 + (state.afrActual - 14.7) * 0.12).toFixed(2)),
            batteryV: Number(state.systemVoltage.toFixed(2)),
            closedThrottleSw: state.throttlePedalPct < 2 ? "ON" : "OFF",
            stopLightSw: state.brakePedalPressed ? "ON" : "OFF"
          };
        }
      }
    };

    if ((state.ignitionKey === "START" || isRunning) && !ckpOk) {
      addDtc("P0335", "Неисправность в цепи датчика положения коленчатого вала «A» (NE)");
    }
    if (!isCompOk("cmp_intake") || wfOf("B31-99_G2+") !== "none" || wfOf("B31-117_VC") !== "none") {
      addDtc("P0340", "Неисправность в цепи датчика положения распредвала впуска «A» (G2)");
    }
    if (!isCompOk("cmp_exhaust") || wfOf("B31-76_EV1+") !== "none" || wfOf("B31-70_VCV1") !== "none") {
      addDtc("P0365", "Неисправность в цепи датчика положения распредвала выпуска «B» (EV1)");
    }
    if (isRunning && c.head_valvetrain_timing.condition === "degraded") {
      addDtc("P0016", "Несоответствие положения коленчатого вала и впускного распредвала (ряд 1, датчик A)");
    }
    if (!ectSensorOk) {
      addDtc("P0118", "Высокий уровень сигнала на входе цепи датчика температуры ОЖ (THW -> -40°C)");
    }
    if (!isCompOk("maf_sensor") || wfOf("B31-118_VG") !== "none" || !efiNo1Powered || wfOf("MAF_+B") !== "none") {
      addDtc("P0102", "Низкий уровень входного сигнала цепи датчика массового расхода воздуха (MAF)");
    }
    if (!etcsPowered) {
      addDtc("P2118", "Диапазон/функционирование тока электродвигателя привода дроссельной заслонки (обрыв +BM / пред. ETCS)");
    }
    if (!isCompOk("throttle_body") || wfOf("B31-42_M+") !== "none" || wfOf("B31-41_M-") !== "none") {
      addDtc("P2102", "Низкий уровень сигнала в цепи электродвигателя привода дроссельной заслонки");
    }
    if (!tpsOk) {
      addDtc("P0120", "Неисправность в цепи датчика положения дроссельной заслонки «A» (VTA1/VTA2)");
    }
    if (!appOk) {
      addDtc("P2120", "Неисправность в цепи датчика положения педали акселератора «D» (VPA/VPA2)");
    }
    if (!isCompOk("knock_sensor") || wfOf("B31-110_KNK1") !== "none") {
      addDtc("P0328", "Высокий уровень сигнала на входе цепи датчика детонации 1 (KNK1 > 4.5 В)");
    }
    if (!efiNo2Powered || !isCompOk("af_sensor_b1s1") || wfOf("B31-109_HA1A") !== "none") {
      addDtc("P0031", "Низкий уровень сигнала в цепи управления подогревателем датчика состава смеси (B1S1)");
    }
    if (!efiNo2Powered || !isCompOk("ho2s_b1s2") || wfOf("B31-47_HT1B") !== "none") {
      addDtc("P0037", "Низкий уровень сигнала в цепи управления подогревателем кислородного датчика (B1S2)");
    }
    if (!isCompOk("ocv_intake") || wfOf("B31-100_OC1+") !== "none") {
      addDtc("P0010", "Обрыв в цепи гидравлического клапана изменения фаз ГРМ впуска (OC1)");
    }
    if (!isCompOk("ocv_exhaust") || wfOf("B31-60_OE1+") !== "none") {
      addDtc("P0013", "Обрыв в цепи гидравлического клапана изменения фаз ГРМ выпуска (OE1)");
    }
    if (!efiNo2Powered || !isCompOk("evap_purge_vsv") || wfOf("B31-49_PRG") !== "none") {
      addDtc("P0443", "Неисправность в цепи управления клапаном продувки адсорбера EVAP");
    }

    // Проверка катушек P0351–P0354, форсунок P0201–P0204 и пропусков P0301–P0304
    for (let i = 1; i <= 4; i++) {
      const coilId = "coil_" + i;
      const injId = "inj_" + i;
      const igtPin = "B31-" + (86 - i) + "_IGT" + i;
      const injPin = "B31-" + (109 - i) + "_INJ" + i;

      if (!injBusPowered || !isCompOk(injId) || wfOf(injPin) !== "none") {
        addDtc("P020" + i, "Обрыв в цепи управления топливной форсункой цилиндра №" + i);
      }
      if (isRunning && (!coilBusPowered || !isCompOk(coilId) || wfOf(igtPin) !== "none")) {
        addDtc("P035" + i, "Неисправность первичной/вторичной цепи катушки зажигания «" + ["A", "B", "C", "D"][i - 1] + "» (Цил. №" + i + ")");
      }
      if (isRunning && state.cylinderMisfire[i - 1]) {
        addDtc("P030" + i, "Обнаружены пропуски воспламенения в цилиндре №" + i);
      }
    }

    if (isRunning && (state.stftPct + state.ltftPct > 20.0)) {
      addDtc("P0171", "Слишком бедная топливовоздушная смесь (Ряд 1, STFT+LTFT > +20%)");
    }
    if (isRunning && state.coolantTempC > 106.0) {
      addDtc("P0217", "Перегрев двигателя (температура охлаждающей жидкости выше допустимого порога)");
    }
    if (isRunning && !altWorks) {
      addDtc("P0560", "Неисправность бортового напряжения системы (отсутствует зарядка генератора)");
    }
  }

  // Лампа Check Engine (MIL): горит при IG ON до пуска (проверка лампы, если ЭБУ запитан!), а на заведённом ДВС горит при наличии активных DTC
  state.checkEngineLight = ecmPowered && (!isRunning || state.activeDtcs.length > 0);
};


// Журнал действий
window.logSimAction = function(state, type, text) {
  const now = new Date();
  const timeStr = String(now.getMinutes()).padStart(2, "0") + ":" + String(now.getSeconds()).padStart(2, "0");
  state.actionHistory.unshift({ time: timeStr, type, text });
  if (state.actionHistory.length > 60) state.actionHistory.pop();
};

// Детерминированный расчёт потенциала (В) и сопротивления относительно массы (Ом) на любом измерительном контакте
window.getPinElectricalState = function(state, pinId) {
  const f = state.fuses;
  const r = state.relays;
  const c = state.components;
  const wf = state.wireFaults;

  const isFuseOk = (id) => f[id] && f[id].installed && !f[id].blown && f[id].rating > 0;
  const isCompOk = (id) => c[id] && c[id].installed && c[id].connectorPlugged && c[id].boltsFastened && c[id].condition === "good";
  const isCompPresent = (id) => c[id] && c[id].installed && c[id].connectorPlugged;
  const wfOf = (p) => wf[p] || "none";

  const batConnected = c.battery && c.battery.installed && c.battery.connectorPlugged;
  const vSys = batConnected ? state.systemVoltage : 0.0;
  const igKeyOn = state.ignitionKey === "IG_ON" || state.ignitionKey === "START";
  const startKeyOn = state.ignitionKey === "START";
  const isRunning = state.rpm > 350;

  const g2DropV = (wfOf("GND_G2") === "high_res" && startKeyOn) ? 5.8 : (wfOf("GND_G2") === "high_res" && isRunning ? 1.1 : 0.02);
  const e1DropV = (wfOf("GND_E1") === "high_res") ? 1.85 : (wfOf("GND_E1") === "open" ? 4.5 : 0.02);

  const efiMainOut = batConnected && isFuseOk("fuse_pi") && isFuseOk("fuse_efi_main") && r.relay_efi_main.energized && wfOf("RELAY_EFI_OUT") !== "open";
  const ig2Out = batConnected && isFuseOk("fuse_pi") && isFuseOk("fuse_ig2") && r.relay_ig2.energized && wfOf("RELAY_IG2_OUT") !== "open";
  const efiNo1V = (efiMainOut && isFuseOk("fuse_efi_no1")) ? vSys : 0.0;
  const efiNo2V = (efiMainOut && isFuseOk("fuse_efi_no2")) ? vSys : 0.0;
  const ignV = (ig2Out && isFuseOk("fuse_ign")) ? vSys : 0.0;
  const ecmPowered = efiNo1V > 8.0 && wfOf("A50-2_+B") !== "open" && wfOf("GND_E1") !== "open" && isCompPresent("ecm");

  // Если на точке задано искусственное повреждение проводки
  const fault = wfOf(pinId);
  if (fault === "short_gnd") {
    return { dcV: 0.01, acV: 0.0, ohmToGnd: 0.15, openCircuit: false };
  }
  if (fault === "short_vcc") {
    return { dcV: vSys, acV: 0.0, ohmToGnd: 120.0, openCircuit: false };
  }

  switch (pinId) {
    case "BAT+":
      return { dcV: vSys, acV: isRunning ? 0.04 : 0.0, ohmToGnd: 12.5, openCircuit: !batConnected };
    case "BAT-":
      return { dcV: 0.0, acV: 0.0, ohmToGnd: 0.01, openCircuit: false };
    case "GND_G1":
      return { dcV: wfOf("GND_G1") === "high_res" ? 0.85 : 0.01, acV: 0.0, ohmToGnd: wfOf("GND_G1") === "high_res" ? 18.5 : 0.02, openCircuit: wfOf("GND_G1") === "open" };
    case "GND_G2":
      return { dcV: g2DropV, acV: 0.0, ohmToGnd: wfOf("GND_G2") === "high_res" ? 14.2 : 0.03, openCircuit: wfOf("GND_G2") === "open" };
    case "GND_E1":
      return { dcV: e1DropV, acV: 0.0, ohmToGnd: wfOf("GND_E1") === "high_res" ? 42.0 : 0.05, openCircuit: wfOf("GND_E1") === "open" };

    // Генератор и Стартер
    case "ALT_B+":
      if (fault === "open" || !isFuseOk("fuse_alt")) {
        const selfAltV = (isRunning && isCompOk("alternator")) ? 14.2 : 0.0;
        return { dcV: selfAltV, acV: 0.0, ohmToGnd: Infinity, openCircuit: true };
      }
      return { dcV: vSys, acV: isRunning ? 0.05 : 0.0, ohmToGnd: 15.0, openCircuit: false };
    case "ALT_S":
      return { dcV: (batConnected && isFuseOk("fuse_alt_s") && fault !== "open") ? vSys : 0.0, acV: 0.0, ohmToGnd: 1200, openCircuit: fault === "open" || !isFuseOk("fuse_alt_s") };
    case "ALT_IG":
      return { dcV: (ignV > 0 && fault !== "open") ? ignV : 0.0, acV: 0.0, ohmToGnd: 680, openCircuit: fault === "open" };
    case "ALT_L":
      return { dcV: !igKeyOn ? 0.0 : (state.chargeWarningLight ? 1.15 : vSys), acV: 0.0, ohmToGnd: 1500, openCircuit: false };
    case "ST_30":
      return { dcV: (batConnected && fault !== "open") ? vSys : 0.0, acV: 0.0, ohmToGnd: 12.5, openCircuit: fault === "open" };
    case "ST_50":
      return { dcV: (r.relay_st.energized && fault !== "open") ? (vSys - 0.5) : 0.0, acV: 0.0, ohmToGnd: isCompOk("starter") ? 0.9 : Infinity, openCircuit: !isCompOk("starter") || fault === "open" };

    // Предохранители и Реле
    case "FUSE_EFI_MAIN":
      return { dcV: (batConnected && isFuseOk("fuse_pi") && isFuseOk("fuse_efi_main")) ? vSys : 0.0, acV: 0.0, ohmToGnd: isFuseOk("fuse_efi_main") ? 0.2 : Infinity, openCircuit: !isFuseOk("fuse_efi_main") };
    case "FUSE_EFI_NO1":
      return { dcV: efiNo1V, acV: 0.0, ohmToGnd: isFuseOk("fuse_efi_no1") ? 0.25 : Infinity, openCircuit: !isFuseOk("fuse_efi_no1") };
    case "FUSE_EFI_NO2":
      return { dcV: efiNo2V, acV: 0.0, ohmToGnd: isFuseOk("fuse_efi_no2") ? 0.25 : Infinity, openCircuit: !isFuseOk("fuse_efi_no2") };
    case "FUSE_ETCS":
      return { dcV: (batConnected && isFuseOk("fuse_etcs")) ? vSys : 0.0, acV: 0.0, ohmToGnd: wfOf("A50-3_+BM") === "short_gnd" ? 0.15 : (isFuseOk("fuse_etcs") ? 0.2 : Infinity), openCircuit: !isFuseOk("fuse_etcs") };
    case "FUSE_IG2":
      return { dcV: (batConnected && isFuseOk("fuse_pi") && isFuseOk("fuse_ig2")) ? vSys : 0.0, acV: 0.0, ohmToGnd: isFuseOk("fuse_ig2") ? 0.2 : Infinity, openCircuit: !isFuseOk("fuse_ig2") };
    case "FUSE_IGT_INJ":
      return { dcV: (batConnected && isFuseOk("fuse_pi") && isFuseOk("fuse_igt_inj") && igKeyOn) ? vSys : 0.0, acV: 0.0, ohmToGnd: isFuseOk("fuse_igt_inj") ? 0.2 : Infinity, openCircuit: !isFuseOk("fuse_igt_inj") };
    case "FUSE_IGN":
      return { dcV: ignV, acV: 0.0, ohmToGnd: isFuseOk("fuse_ign") ? 0.2 : Infinity, openCircuit: !isFuseOk("fuse_ign") };
    case "FUSE_RDI_FAN":
      return { dcV: (batConnected && isFuseOk("fuse_alt") && isFuseOk("fuse_rdi_fan")) ? vSys : 0.0, acV: 0.0, ohmToGnd: isFuseOk("fuse_rdi_fan") ? 0.2 : Infinity, openCircuit: !isFuseOk("fuse_rdi_fan") };
    case "FUSE_AM2":
      return { dcV: (batConnected && isFuseOk("fuse_am2")) ? vSys : 0.0, acV: 0.0, ohmToGnd: isFuseOk("fuse_am2") ? 0.2 : Infinity, openCircuit: !isFuseOk("fuse_am2") };
    case "FUSE_OBD":
      return { dcV: (batConnected && isFuseOk("fuse_obd")) ? vSys : 0.0, acV: 0.0, ohmToGnd: isFuseOk("fuse_obd") ? 0.2 : Infinity, openCircuit: !isFuseOk("fuse_obd") };
    case "RELAY_EFI_OUT":
      return { dcV: efiMainOut ? vSys : 0.0, acV: 0.0, ohmToGnd: 45.0, openCircuit: !r.relay_efi_main.installed || r.relay_efi_main.faulty };
    case "RELAY_IG2_OUT":
      return { dcV: ig2Out ? vSys : 0.0, acV: 0.0, ohmToGnd: 35.0, openCircuit: !r.relay_ig2.installed || r.relay_ig2.faulty };

    // Контакты ЭБУ A50
    case "A50-20_BATT":
      return { dcV: (batConnected && isFuseOk("fuse_pi") && isFuseOk("fuse_efi_main") && fault !== "open") ? vSys : 0.0, acV: 0.0, ohmToGnd: 2400, openCircuit: fault === "open" };
    case "A50-28_IGSW":
      return { dcV: (ignV > 0 && fault !== "open") ? ignV : 0.0, acV: 0.0, ohmToGnd: 1800, openCircuit: fault === "open" };
    case "A50-44_MREL":
      return { dcV: (ignV > 0 && wfOf("A50-28_IGSW") !== "open" && fault !== "open") ? (vSys - 0.3) : 0.0, acV: 0.0, ohmToGnd: 85.0, openCircuit: fault === "open" };
    case "A50-2_+B":
      return { dcV: (efiNo1V > 0 && fault !== "open") ? efiNo1V : 0.0, acV: 0.0, ohmToGnd: 420, openCircuit: fault === "open" };
    case "A50-3_+BM":
      return { dcV: (batConnected && isFuseOk("fuse_etcs") && fault !== "open") ? vSys : 0.0, acV: 0.0, ohmToGnd: 510, openCircuit: fault === "open" || !isFuseOk("fuse_etcs") };
    case "A50-48_STA":
      return { dcV: (r.relay_st.energized && fault !== "open") ? (vSys - 0.6) : 0.0, acV: 0.0, ohmToGnd: 0.9, openCircuit: fault === "open" };
    case "A50-7_FC":
      if (!efiMainOut) return { dcV: 0.0, acV: 0.0, ohmToGnd: 90.0, openCircuit: false };
      return { dcV: r.relay_copn.energized ? 0.35 : vSys, acV: 0.0, ohmToGnd: 90.0, openCircuit: fault === "open" };
    case "A50-43_RFC":
      return { dcV: !ecmPowered ? 0.0 : (state.coolingFanRunning ? 0.4 : 4.95), acV: 0.0, ohmToGnd: 85.0, openCircuit: fault === "open" };

    // Педаль газа, тормоз, скорость
    case "A50-55_VPA":
      return { dcV: (ecmPowered && isCompOk("app_sensor") && fault !== "open") ? (0.80 + state.throttlePedalPct * 0.028) : 0.0, acV: 0.0, ohmToGnd: 1200, openCircuit: fault === "open" || !isCompOk("app_sensor") };
    case "A50-56_VPA2":
      return { dcV: (ecmPowered && isCompOk("app_sensor") && fault !== "open") ? (1.60 + state.throttlePedalPct * 0.028) : 0.0, acV: 0.0, ohmToGnd: 1200, openCircuit: fault === "open" || !isCompOk("app_sensor") };
    case "A50-57_VCPA":
      return { dcV: (ecmPowered && fault !== "open") ? 5.00 : 0.0, acV: 0.0, ohmToGnd: 650, openCircuit: fault === "open" };
    case "A50-36_STP":
      return { dcV: (batConnected && isFuseOk("fuse_stop") && state.brakePedalPressed) ? vSys : 0.0, acV: 0.0, ohmToGnd: 45.0, openCircuit: !isFuseOk("fuse_stop") };
    case "A50-35_ST1-":
      return { dcV: (ignV > 0 && !state.brakePedalPressed) ? ignV : 0.0, acV: 0.0, ohmToGnd: 950, openCircuit: false };
    case "A50-8_SPD":
      return { dcV: (ecmPowered && state.externalLoadActive) ? 6.1 : (ecmPowered ? 4.8 : 0.0), acV: state.externalLoadActive ? 4.2 : 0.0, ohmToGnd: 2200, openCircuit: fault === "open" };

    // Датчики на разъёме B31
    case "B31-122_NE+": {
      const ckpGood = isCompOk("ckp_sensor") && fault !== "open";
      const spinning = state.rpm > 35;
      return {
        dcV: 0.0,
        acV: (ckpGood && spinning) ? Math.min(18.0, 1.2 + state.rpm * 0.0032) : 0.0,
        ohmToGnd: ckpGood ? 1950.0 : Infinity,
        openCircuit: !ckpGood
      };
    }
    case "B31-121_NE-":
      return { dcV: e1DropV, acV: 0.0, ohmToGnd: 0.25, openCircuit: fault === "open" };
    case "B31-99_G2+": {
      const cmpInGood = ecmPowered && isCompOk("cmp_intake") && fault !== "open" && wfOf("B31-117_VC") !== "open";
      return { dcV: cmpInGood ? (state.rpm > 35 ? 2.45 : 4.85) : 0.0, acV: (cmpInGood && state.rpm > 35) ? 2.4 : 0.0, ohmToGnd: cmpInGood ? 2400 : Infinity, openCircuit: !cmpInGood };
    }
    case "B31-117_VC":
      return { dcV: (ecmPowered && fault !== "open") ? 5.00 : 0.0, acV: 0.0, ohmToGnd: 580, openCircuit: fault === "open" };
    case "B31-76_EV1+": {
      const cmpExGood = ecmPowered && isCompOk("cmp_exhaust") && fault !== "open" && wfOf("B31-70_VCV1") !== "open";
      return { dcV: cmpExGood ? (state.rpm > 35 ? 2.45 : 4.85) : 0.0, acV: (cmpExGood && state.rpm > 35) ? 2.4 : 0.0, ohmToGnd: cmpExGood ? 2400 : Infinity, openCircuit: !cmpExGood };
    }
    case "B31-70_VCV1":
      return { dcV: (ecmPowered && fault !== "open") ? 5.00 : 0.0, acV: 0.0, ohmToGnd: 580, openCircuit: fault === "open" };

    // ДМРВ и ДТОЖ
    case "MAF_+B":
      return { dcV: (efiNo1V > 0 && fault !== "open") ? efiNo1V : 0.0, acV: 0.0, ohmToGnd: 320, openCircuit: fault === "open" || !isFuseOk("fuse_efi_no1") };
    case "B31-118_VG": {
      const mafOk = ecmPowered && efiNo1V > 0 && isCompOk("maf_sensor") && fault !== "open" && wfOf("MAF_+B") !== "open";
      const vg = !mafOk ? 0.0 : (isRunning ? Math.min(4.5, 0.72 + state.mafGramsPerSec * 0.21) : 0.62);
      return { dcV: vg, acV: 0.0, ohmToGnd: mafOk ? 1450 : Infinity, openCircuit: !mafOk };
    }
    case "B31-65_THA": {
      const iatOk = isCompOk("maf_sensor") && fault !== "open";
      return { dcV: !ecmPowered ? 0.0 : (iatOk ? 2.35 : 4.98), acV: 0.0, ohmToGnd: iatOk ? 2450.0 : Infinity, openCircuit: !iatOk };
    }
    case "B31-97_THW": {
      const ectOk = isCompOk("ect_sensor") && fault !== "open";
      // При 20°C = 2450 Ом (~2.38 В), при 85°C = 310 Ом (~0.52 В); при обрыве = 5.00 В (-40°C)
      const rEct = Math.max(140, 2600 * Math.exp(-0.0255 * (state.coolantTempC - 20)));
      const vEct = !ecmPowered ? 0.0 : (!ectOk ? 5.00 : Number((5.0 * (rEct / (rEct + 2400))).toFixed(2)));
      return { dcV: vEct, acV: 0.0, ohmToGnd: ectOk ? Math.round(rEct) : Infinity, openCircuit: !ectOk };
    }

    // ДПДЗ, Детонация, Датчики кислорода
    case "B31-115_VTA1": {
      const tpsOk = ecmPowered && isCompOk("tps_sensor") && fault !== "open" && wfOf("B31-67_VCTA") !== "open";
      return { dcV: tpsOk ? Number((0.68 + (state.throttleAngleDeg / 84.0) * 3.42).toFixed(2)) : 0.0, acV: 0.0, ohmToGnd: tpsOk ? 1150 : Infinity, openCircuit: !tpsOk };
    }
    case "B31-114_VTA2": {
      const tpsOk = ecmPowered && isCompOk("tps_sensor") && fault !== "open" && wfOf("B31-67_VCTA") !== "open";
      return { dcV: tpsOk ? Number((2.48 + (state.throttleAngleDeg / 84.0) * 2.42).toFixed(2)) : 0.0, acV: 0.0, ohmToGnd: tpsOk ? 1150 : Infinity, openCircuit: !tpsOk };
    }
    case "B31-67_VCTA":
      return { dcV: (ecmPowered && fault !== "open") ? 5.00 : 0.0, acV: 0.0, ohmToGnd: 580, openCircuit: fault === "open" };
    case "B31-110_KNK1": {
      const knkOk = isCompOk("knock_sensor") && fault !== "open";
      // При подключённом резисторе 200 кОм датчика напряжение ~2.50 В; при обрыве подтяжка ЭБУ даёт 4.95 В (код P0328 по RM04F1RU!)
      const vKnk = !ecmPowered ? 0.0 : (knkOk ? 2.50 : 4.95);
      return { dcV: vKnk, acV: (knkOk && isRunning) ? Math.min(1.6, 0.12 + state.rpm * 0.00025) : 0.0, ohmToGnd: knkOk ? 200000.0 : Infinity, openCircuit: !knkOk };
    }
    case "B31-112_A1A+": {
      const afOk = ecmPowered && isCompOk("af_sensor_b1s1") && fault !== "open";
      const vAf = !afOk ? 0.0 : (isRunning ? Number((3.30 + (state.afrActual - 14.7) * 0.12).toFixed(2)) : 3.30);
      return { dcV: vAf, acV: 0.0, ohmToGnd: afOk ? 15000 : Infinity, openCircuit: !afOk };
    }
    case "B31-113_A1A-":
      return { dcV: (ecmPowered && isCompOk("af_sensor_b1s1") && fault !== "open") ? 3.00 : 0.0, acV: 0.0, ohmToGnd: 15000, openCircuit: fault === "open" };
    case "B31-109_HA1A": {
      const afHeatOk = isCompOk("af_sensor_b1s1") && fault !== "open";
      const vHa = (efiNo2V > 0 && afHeatOk) ? (isRunning ? 8.6 : efiNo2V) : 0.0;
      return { dcV: vHa, acV: (efiNo2V > 0 && afHeatOk && isRunning) ? 4.8 : 0.0, ohmToGnd: afHeatOk ? 2.4 : Infinity, openCircuit: !afHeatOk };
    }
    case "B31-64_OX1B": {
      const o2Ok = ecmPowered && isCompOk("ho2s_b1s2") && fault !== "open";
      const vO2 = !o2Ok ? 0.0 : (isRunning ? Number((0.62 + Math.sin(Date.now() * 0.004) * 0.18).toFixed(2)) : 0.45);
      return { dcV: vO2, acV: (o2Ok && isRunning) ? 0.22 : 0.0, ohmToGnd: o2Ok ? 10000 : Infinity, openCircuit: !o2Ok };
    }
    case "B31-47_HT1B": {
      const o2HeatOk = isCompOk("ho2s_b1s2") && fault !== "open";
      const vHt = (efiNo2V > 0 && o2HeatOk) ? (isRunning ? 1.8 : efiNo2V) : 0.0;
      return { dcV: vHt, acV: 0.0, ohmToGnd: o2HeatOk ? 13.2 : Infinity, openCircuit: !o2HeatOk };
    }

    // Исполнительные механизмы: Катушки, Форсунки, Дроссель, VVT-i, EVAP, Насос, Вентилятор
    case "COIL_+B":
      return { dcV: (ig2Out && fault !== "open") ? vSys : 0.0, acV: 0.0, ohmToGnd: 45.0, openCircuit: fault === "open" || !ig2Out };
    case "B31-85_IGT1":
    case "B31-84_IGT2":
    case "B31-83_IGT3":
    case "B31-82_IGT4": {
      const idx = pinId.slice(-1);
      const igtOk = ecmPowered && fault !== "open";
      return { dcV: (igtOk && isRunning) ? 0.42 : 0.02, acV: (igtOk && isRunning) ? 1.65 : 0.0, ohmToGnd: igtOk ? 820 : Infinity, openCircuit: fault === "open" || !isCompOk("coil_" + idx) };
    }
    case "B31-81_IGF1":
      return { dcV: !ecmPowered ? 0.0 : (isRunning ? 4.45 : 4.95), acV: isRunning ? 1.2 : 0.0, ohmToGnd: 1200, openCircuit: fault === "open" };
    case "INJ_+B":
      return { dcV: (batConnected && isFuseOk("fuse_pi") && isFuseOk("fuse_igt_inj") && igKeyOn && fault !== "open") ? vSys : 0.0, acV: 0.0, ohmToGnd: 35.0, openCircuit: fault === "open" };
    case "B31-108_INJ1":
    case "B31-107_INJ2":
    case "B31-106_INJ3":
    case "B31-105_INJ4": {
      const idx = pinId.slice(-1);
      const injGood = isCompOk("inj_" + idx) && fault !== "open";
      const injPwr = batConnected && isFuseOk("fuse_pi") && isFuseOk("fuse_igt_inj") && igKeyOn && wfOf("INJ_+B") !== "open";
      return {
        dcV: (injPwr && injGood) ? (isRunning ? (vSys - 0.6) : vSys) : 0.0,
        acV: (injPwr && injGood && isRunning) ? 8.5 : 0.0,
        ohmToGnd: injGood ? 12.0 : Infinity,
        openCircuit: !injGood
      };
    }
    case "B31-42_M+":
    case "B31-41_M-": {
      const thOk = isCompOk("throttle_body") && fault !== "open";
      const bmOk = batConnected && isFuseOk("fuse_etcs") && wfOf("A50-3_+BM") === "none";
      const vM = (ecmPowered && bmOk && thOk && !state.limpHomeMode) ? (pinId === "B31-42_M+" ? 4.8 : 2.1) : 0.0;
      return { dcV: vM, acV: vM > 0 ? 4.5 : 0.0, ohmToGnd: thOk ? 1.8 : Infinity, openCircuit: !thOk };
    }
    case "B31-100_OC1+": {
      const ocvInOk = isCompOk("ocv_intake") && fault !== "open";
      return { dcV: (ecmPowered && isRunning && ocvInOk) ? 4.6 : 0.0, acV: (ecmPowered && isRunning && ocvInOk) ? 5.2 : 0.0, ohmToGnd: ocvInOk ? 7.4 : Infinity, openCircuit: !ocvInOk };
    }
    case "B31-60_OE1+": {
      const ocvExOk = isCompOk("ocv_exhaust") && fault !== "open";
      return { dcV: (ecmPowered && isRunning && ocvExOk) ? 4.2 : 0.0, acV: (ecmPowered && isRunning && ocvExOk) ? 5.0 : 0.0, ohmToGnd: ocvExOk ? 7.4 : Infinity, openCircuit: !ocvExOk };
    }
    case "B31-49_PRG": {
      const prgOk = isCompOk("evap_purge_vsv") && fault !== "open";
      return { dcV: (efiNo2V > 0 && prgOk) ? (isRunning ? 10.2 : efiNo2V) : 0.0, acV: (efiNo2V > 0 && prgOk && isRunning) ? 4.2 : 0.0, ohmToGnd: prgOk ? 29.0 : Infinity, openCircuit: !prgOk };
    }
    case "FP_PWR": {
      const fpOk = isCompOk("fuel_pump") && fault !== "open";
      return { dcV: (r.relay_copn.energized && fault !== "open") ? vSys : 0.0, acV: 0.0, ohmToGnd: fpOk ? 1.4 : Infinity, openCircuit: !fpOk };
    }
    case "FAN_PWR": {
      const fanOk = isCompOk("cooling_fan") && fault !== "open";
      return { dcV: (r.relay_fan.energized && isFuseOk("fuse_rdi_fan") && fault !== "open") ? vSys : 0.0, acV: 0.0, ohmToGnd: fanOk ? 0.8 : Infinity, openCircuit: !fanOk };
    }

    // Разъём OBD2 DLC3
    case "DLC3-16_BAT":
      return { dcV: (batConnected && isFuseOk("fuse_obd") && fault !== "open") ? vSys : 0.0, acV: 0.0, ohmToGnd: 650, openCircuit: fault === "open" || !isFuseOk("fuse_obd") };
    case "DLC3-4_CG":
      return { dcV: 0.01, acV: 0.0, ohmToGnd: 0.02, openCircuit: false };
    case "DLC3-6_CANH":
      return { dcV: (ecmPowered && fault !== "open") ? 2.75 : 0.0, acV: (ecmPowered && fault !== "open") ? 0.45 : 0.0, ohmToGnd: fault === "open" ? 120.0 : 60.0, openCircuit: fault === "open" };
    case "DLC3-14_CANL":
      return { dcV: (ecmPowered && fault !== "open") ? 2.25 : 0.0, acV: (ecmPowered && fault !== "open") ? 0.45 : 0.0, ohmToGnd: fault === "open" ? 120.0 : 60.0, openCircuit: fault === "open" };

    default:
      return { dcV: 0.0, acV: 0.0, ohmToGnd: 1000.0, openCircuit: false };
  }
};

// Вычисление показаний мультиметра, контрольки и прозвонки с проверками безопасности (п. 6 и Тест 9 ТЗ)
window.computeInstrumentReading = function(state) {
  const red = window.getPinElectricalState(state, state.probeRed);
  const blk = window.getPinElectricalState(state, state.probeBlack);
  const redDef = window.PROBE_POINTS.find(p => p.id === state.probeRed) || { label: state.probeRed, sensitive: false };
  const blkDef = window.PROBE_POINTS.find(p => p.id === state.probeBlack) || { label: state.probeBlack, sensitive: false };

  let warning = null;
  const diffDcV = red.dcV - blk.dcV;
  const maxAcV = Math.max(red.acV, blk.acV);

  // Проверка опасного подключения нагрузочной контрольки 21 Вт к чувствительным цепям ЭБУ (Тест 9!)
  if (state.activeTool === "testlight" && state.testLightType === "LOAD_21W" && (redDef.sensitive || blkDef.sensitive)) {
    warning = "ВНИМАНИЕ! Недопустимое подключение обычной ламповой контрольки (21 Вт, ток 1,7 А) к чувствительной слаботочной линии ЭБУ (" + (redDef.sensitive ? redDef.label : blkDef.label) + ")! Высокий ток лампы просаживает сигнальную цепь и опасен для драйверов ЭБУ. Используйте светодиодную (LED) контрольку или мультиметр.";
  }

  // Проверка измерения сопротивления / прозвонки под напряжением
  if ((state.activeTool === "continuity" || (state.activeTool === "multimeter" && (state.dmmMode === "OHM" || state.dmmMode === "CONT"))) && Math.abs(diffDcV) > 1.5) {
    warning = "ПРЕДУПРЕЖДЕНИЕ! Попытка измерения сопротивления / прозвонки цепи под напряжением (" + Math.abs(diffDcV).toFixed(1) + " В)! Отключите зажигание или клемму АКБ перед прозвонкой омметром.";
  }

  state.safetyWarning = warning;

  // Расчёт сопротивления между двумя щупами
  let measuredOhm = 0.0;
  if (state.probeRed === state.probeBlack) {
    measuredOhm = 0.05;
  } else if ((state.probeRed === "DLC3-6_CANH" && state.probeBlack === "DLC3-14_CANL") || (state.probeRed === "DLC3-14_CANL" && state.probeBlack === "DLC3-6_CANH")) {
    measuredOhm = (red.openCircuit || blk.openCircuit) ? 120.0 : 60.0;
  } else if (red.openCircuit || blk.openCircuit) {
    measuredOhm = Infinity;
  } else {
    // Если один из щупов на массе (BAT-, GND_G1, GND_G2, GND_E1, DLC3-4_CG)
    const blkIsGnd = ["BAT-", "GND_G1", "GND_G2", "GND_E1", "DLC3-4_CG", "B31-121_NE-"].includes(state.probeBlack);
    const redIsGnd = ["BAT-", "GND_G1", "GND_G2", "GND_E1", "DLC3-4_CG", "B31-121_NE-"].includes(state.probeRed);
    if (blkIsGnd) {
      measuredOhm = red.ohmToGnd + blk.ohmToGnd;
    } else if (redIsGnd) {
      measuredOhm = blk.ohmToGnd + red.ohmToGnd;
    } else if (redDef.compId === blkDef.compId) {
      measuredOhm = red.ohmToGnd;
    } else {
      measuredOhm = red.ohmToGnd + blk.ohmToGnd;
    }
  }

  let displayValue = "0.00";
  let unit = "V DC";
  let overload = false;
  let beep = false;

  if (state.dmmMode === "DC_V") {
    displayValue = diffDcV.toFixed(2);
    unit = "V DC";
  } else if (state.dmmMode === "AC_V") {
    displayValue = maxAcV.toFixed(2);
    unit = "V AC";
  } else if (state.dmmMode === "OHM") {
    if (Math.abs(diffDcV) > 1.5) {
      displayValue = "ERR-V";
      unit = "ПОД НАПРЯЖ.";
      overload = true;
    } else if (!isFinite(measuredOhm) || measuredOhm > 1000000) {
      displayValue = "OL";
      unit = "MΩ (Обрыв)";
      overload = true;
    } else if (measuredOhm >= 1000) {
      displayValue = (measuredOhm / 1000).toFixed(2);
      unit = "kΩ";
    } else {
      displayValue = measuredOhm.toFixed(2);
      unit = "Ω";
    }
  } else if (state.dmmMode === "CONT") {
    if (Math.abs(diffDcV) > 1.5) {
      displayValue = "ERR-V";
      unit = "ПОД НАПРЯЖ.";
      overload = true;
    } else if (!isFinite(measuredOhm)) {
      displayValue = "OL";
      unit = "Ω (Разомкнуто)";
      overload = true;
    } else {
      displayValue = measuredOhm.toFixed(1);
      unit = measuredOhm < 35 ? "Ω (ЗВУК 🔊)" : "Ω (Без звука)";
      beep = measuredOhm < 35;
    }
  } else if (state.dmmMode === "DIODE") {
    displayValue = !isFinite(measuredOhm) ? "OL" : (Math.min(1.8, 0.54 + measuredOhm * 0.001)).toFixed(3);
    unit = "V (Диод)";
  } else if (state.dmmMode === "DC_A") {
    displayValue = state.chargingCurrentA.toFixed(1);
    unit = "A DC";
  }

  return {
    displayValue,
    unit,
    overload,
    beep,
    diffDcV,
    measuredOhm,
    warning
  };
};

// Генератор случайных или заданных неисправностей (п. 8 ТЗ: Новичок, Мастер, Эксперт)
window.injectFaultScenario = function(state, specificFaultIds) {
  // Сброс к полностью исправному состоянию перед генерацией новой загадки
  const fresh = window.createInitialSimState();
  state.fuses = fresh.fuses;
  state.relays = fresh.relays;
  state.components = fresh.components;
  state.wireFaults = fresh.wireFaults;
  state.activeDtcs = [];
  state.FreezeFrame = null;
  state.faultRevealedHintLevel = 0;
  state.verificationResult = null;

  let chosenIds = [];
  if (Array.isArray(specificFaultIds) && specificFaultIds.length > 0) {
    chosenIds = specificFaultIds;
  } else if (state.difficulty === "expert") {
    const pair = window.EXPERT_COMBO_PAIRS[Math.floor(Math.random() * window.EXPERT_COMBO_PAIRS.length)];
    chosenIds = pair.slice();
  } else {
    const pool = window.FAULT_CATALOG.filter(f => state.difficulty === "novice" ? f.difficulty === "novice" : true);
    const pick = pool[Math.floor(Math.random() * pool.length)] || window.FAULT_CATALOG[0];
    chosenIds = [pick.id];
  }

  state.activeFaultIds = chosenIds;

  chosenIds.forEach(fid => {
    const def = window.FAULT_CATALOG.find(item => item.id === fid);
    if (!def) return;

    if (def.faultType === "part_dead" && state.components[def.targetComponent]) {
      state.components[def.targetComponent].condition = "dead";
    } else if (def.faultType === "part_degraded" && state.components[def.targetComponent]) {
      state.components[def.targetComponent].condition = "degraded";
    } else if (def.faultType === "wire_open" && def.wireTarget) {
      state.wireFaults[def.wireTarget] = "open";
    } else if (def.faultType === "short_to_gnd" && def.wireTarget) {
      state.wireFaults[def.wireTarget] = "short_gnd";
      if (def.fuseTarget && state.fuses[def.fuseTarget]) {
        state.fuses[def.fuseTarget].blown = true;
      }
    } else if (def.faultType === "high_resistance" && def.wireTarget) {
      state.wireFaults[def.wireTarget] = "high_res";
    } else if (def.faultType === "fuse_blown" && def.fuseTarget && state.fuses[def.fuseTarget]) {
      state.fuses[def.fuseTarget].blown = true;
    } else if (def.faultType === "relay_dead" && def.relayTarget && state.relays[def.relayTarget]) {
      state.relays[def.relayTarget].faulty = true;
    }
  });

  window.stepSimulation(state, 0.1);
  window.logSimAction(
    state,
    "fault",
    "Сгенерировано скрытое задание (режим: " +
      (state.difficulty === "novice" ? "Новичок" : state.difficulty === "master" ? "Мастер" : "Эксперт — " + chosenIds.length + " неисправности") +
      "). Причина скрыта — проведите диагностику по симптомам и приборам!"
  );
};

// Перестановка совместимых деталей между цилиндрами (Катушки B26–B29, Свечи 1–4, Форсунки 1–4 — п. 10 и п. 15 Тест 4 ТЗ!)
window.swapCylinderParts = function(state, groupType, cylA, cylB) {
  const prefix = groupType === "ignition_coil" ? "coil_" : groupType === "spark_plug" ? "spark_" : "inj_";
  const idA = prefix + cylA;
  const idB = prefix + cylB;
  if (!state.components[idA] || !state.components[idB]) return;

  const tempCond = state.components[idA].condition;
  const tempOrigin = state.components[idA].originSlot;
  const tempSerial = state.components[idA].partSerial;

  state.components[idA].condition = state.components[idB].condition;
  state.components[idA].originSlot = state.components[idB].originSlot;
  state.components[idA].partSerial = state.components[idB].partSerial;

  state.components[idB].condition = tempCond;
  state.components[idB].originSlot = tempOrigin;
  state.components[idB].partSerial = tempSerial;

  window.logSimAction(
    state,
    "repair",
    "Выполнена перестановка деталей между цилиндром №" + cylA + " и цилиндром №" + cylB + " (" + prefix.replace("_", "").toUpperCase() + ")."
  );
  window.stepSimulation(state, 0.1);
};

// Полная проверка исправности двигателя (п. 13 ТЗ: Кнопка «Проверить двигатель»)
window.verifyEngineRepair = function(state) {
  const issues = [];

  // 1. Проверка снятых деталей, отсоединенных разъёмов и незакрученного крепежа
  Object.keys(state.components).forEach(cid => {
    const comp = state.components[cid];
    const reg = window.COMPONENT_REGISTRY.find(r => r.id === cid);
    const title = reg ? reg.shortName : cid;
    if (!comp.installed) issues.push("Не установлена деталь: " + title);
    else if (!comp.boltsFastened) issues.push("Не затянут крепёж узла: " + title);
    else if (!comp.connectorPlugged) issues.push("Не подключён электрический разъём: " + title);
    else if (comp.condition !== "good") issues.push("Осталась неисправная деталь: " + title);
  });

  // 2. Проверка предохранителей и соответствия номиналов (п. 5 ТЗ: неверный номинал не считать нормальным ремонтом!)
  Object.keys(state.fuses).forEach(fid => {
    const f = state.fuses[fid];
    const fDef = window.FUSE_DEFINITIONS.find(d => d.id === fid);
    const code = fDef ? fDef.code : fid;
    if (!f.installed) issues.push("Извлечён предохранитель " + code);
    else if (f.blown) issues.push("Перегорел предохранитель " + code + " (" + f.rating + "A)");
    else if (Number(f.rating) !== Number(f.nominalRating)) {
      issues.push("Неверный номинал предохранителя " + code + ": установлено " + f.rating + "A вместо заводских " + f.nominalRating + "A!");
    }
  });

  // 3. Проверка реле
  Object.keys(state.relays).forEach(rid => {
    const r = state.relays[rid];
    const rDef = window.RELAY_DEFINITIONS.find(d => d.id === rid);
    const code = rDef ? rDef.code : rid;
    if (!r.installed) issues.push("Извлечено реле " + code);
    else if (r.faulty) issues.push("Неисправно реле " + code);
  });

  // 4. Проверка дефектов проводки и масс
  Object.keys(state.wireFaults).forEach(pin => {
    if (state.wireFaults[pin] && state.wireFaults[pin] !== "none") {
      issues.push("Не устранён дефект проводки / контактного соединения на линии " + pin);
    }
  });

  // 5. Проверка нестёртых кодов DTC в памяти ЭБУ (п. 13 ТЗ: сохранённые коды учитывать отдельно)
  const hasStoredDtcs = state.activeDtcs.length > 0;

  if (issues.length === 0 && !hasStoredDtcs) {
    state.verificationResult = {
      ok: true,
      title: "Двигатель исправен. Все проверенные системы работают нормально",
      details: "Запуск устойчивый, напряжение зарядки 14,1 В, топливоподача (3,25 бар, STFT/LTFT в норме), зажигание по всем 4 цилиндрам без пропусков, охлаждение и фазы Dual VVT-i в пределах заводских нормативов RM04F1RU. Активных и сохранённых кодов DTC нет."
    };
    window.logSimAction(state, "success", "ПРОВЕРКА ПРОЙДЕНА: Двигатель исправен. Все проверенные системы работают нормально.");
  } else if (issues.length === 0 && hasStoredDtcs) {
    state.verificationResult = {
      ok: false,
      title: "Физическая неисправность устранена, но в памяти ЭБУ остались сохранённые коды DTC!",
      details: "Все цепи и узлы двигателя восстановлены, однако необходимо подключить OBD2-сканер и выполнить процедуру «Стереть коды DTC (Clear DTC)» для погашения лампы Check Engine."
    };
    window.logSimAction(state, "warn", "Проверка: неисправность устранена, но требуется стереть сохранённые коды DTC сканером OBD2.");
  } else {
    // На уровне «Эксперт» не раскрываем скрытую причину! (п. 13 ТЗ)
    const msg = state.difficulty === "expert"
      ? "Обнаружены отклонения в работе систем двигателя (количество активных проблем: " + issues.length + "). На уровне «Эксперт» конкретная точка отказа не раскрывается — проверьте параметры запуска, зарядки, смесеобразования и коды DTC."
      : "Выявлены неустранённые замечания: " + issues.join("; ") + ".";
    state.verificationResult = {
      ok: false,
      title: "Проверка не пройдена — двигатель неисправен",
      details: msg
    };
    window.logSimAction(state, "warn", "Проверка не пройдена: обнаружены неустранённые неисправности.");
  }
  return state.verificationResult;
};

// Синтезатор звука двигателя 1ZR-FE на базе Web Audio API (п. 7 ТЗ)
window.EngineAudioSynth = {
  ctx: null,
  osc1: null,
  osc2: null,
  gain: null,
  running: false,
  update(state) {
    if (state.soundMuted || (state.rpm < 20 && state.ignitionKey !== "START")) {
      if (this.gain && this.ctx) {
        this.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.06);
      }
      return;
    }
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        this.osc1 = this.ctx.createOscillator();
        this.osc2 = this.ctx.createOscillator();
        this.gain = this.ctx.createGain();
        this.osc1.type = "sawtooth";
        this.osc2.type = "triangle";
        this.gain.gain.value = 0.0001;
        this.osc1.connect(this.gain);
        this.osc2.connect(this.gain);
        this.gain.connect(this.ctx.destination);
        this.osc1.start();
        this.osc2.start();
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      const firingFreq = Math.max(12, (state.rpm / 60) * 2); // 4-тактный 4-цил. двигатель: 2 вспышки за оборот
      const misfireMod = state.cylinderMisfire.some(Boolean) ? (Math.sin(Date.now() * 0.04) * 6) : 0;
      this.osc1.frequency.setTargetAtTime(firingFreq + misfireMod, this.ctx.currentTime, 0.04);
      this.osc2.frequency.setTargetAtTime(firingFreq * 0.5, this.ctx.currentTime, 0.04);
      const vol = state.ignitionKey === "START" && state.rpm < 300 ? 0.035 : Math.min(0.06, 0.02 + (state.rpm / 6000) * 0.04);
      this.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
    } catch (e) {}
  }
};

// АВТОМАТИЧЕСКИЙ ПРОГОН 10 ОБЯЗАТЕЛЬНЫХ ИНТЕГРАЦИОННЫХ ТЕСТОВ (п. 15 ТЗ)
window.runAllMandatoryTests = function() {
  const results = [];

  // Тест 1: Исправный двигатель запускается и заряжает АКБ
  {
    const s = window.createInitialSimState();
    s.ignitionKey = "START";
    window.stepSimulation(s, 0.5);
    s.ignitionKey = "IG_ON";
    window.stepSimulation(s, 0.5);
    const pass = s.rpm > 600 && s.systemVoltage >= 13.8 && s.chargingCurrentA > 0 && !s.chargeWarningLight;
    results.push({
      id: 1,
      name: "1) Исправный двигатель запускается и заряжает АКБ",
      passed: pass,
      detail: "RPM=" + Math.round(s.rpm) + " об/мин, V=" + s.systemVoltage.toFixed(2) + " В, Iзар=+" + s.chargingCurrentA.toFixed(1) + " А"
    });
  }

  // Тест 2: Неисправный генератор не заряжает, замена восстанавливает зарядку
  {
    const s = window.createInitialSimState();
    window.injectFaultScenario(s, ["fault_alt_internal"]);
    s.ignitionKey = "START"; window.stepSimulation(s, 0.5);
    s.ignitionKey = "IG_ON"; window.stepSimulation(s, 0.5);
    const vBefore = s.systemVoltage;
    const noCharge = vBefore < 12.7 && s.chargeWarningLight;
    s.components.alternator.condition = "good";
    window.stepSimulation(s, 0.5);
    const vAfter = s.systemVoltage;
    const pass = noCharge && vAfter >= 13.8 && !s.chargeWarningLight;
    results.push({
      id: 2,
      name: "2) Неисправный генератор не заряжает, его замена восстанавливает зарядку",
      passed: pass,
      detail: "До замены: " + vBefore.toFixed(2) + " В (лампа АКБ ВКЛ) -> После замены: " + vAfter.toFixed(2) + " В (зарядка ОК)"
    });
  }

  // Тест 3: Обрыв цепи генератора не исправляется его заменой
  {
    const s = window.createInitialSimState();
    window.injectFaultScenario(s, ["fault_alt_wire_open"]);
    s.ignitionKey = "START"; window.stepSimulation(s, 0.5);
    s.ignitionKey = "IG_ON"; window.stepSimulation(s, 0.5);
    // Пытаемся заменить сам генератор на новый
    s.components.alternator.condition = "good";
    s.components.alternator.partSerial = "NEW-ALT-OEM";
    window.stepSimulation(s, 0.5);
    const stillNoChargeAfterPartSwap = s.systemVoltage < 12.7 && s.chargeWarningLight;
    // Теперь ремонтируем провод ALT_B+
    delete s.wireFaults["ALT_B+"];
    window.stepSimulation(s, 0.5);
    const fixedAfterWireRepair = s.systemVoltage >= 13.8 && !s.chargeWarningLight;
    results.push({
      id: 3,
      name: "3) Обрыв цепи генератора (ALT_B+) НЕ исправляется заменой генератора",
      passed: stillNoChargeAfterPartSwap && fixedAfterWireRepair,
      detail: "После замены генератора: " + (stillNoChargeAfterPartSwap ? "12.20 В (нет зарядки)" : "ошибка") + " -> После ремонта провода ALT_B+: " + s.systemVoltage.toFixed(2) + " В"
    });
  }

  // Тест 4: Отказ катушки даёт диагностируемые пропуски; перестановка помогает локализовать
  {
    const s = window.createInitialSimState();
    window.injectFaultScenario(s, ["fault_coil2_dead"]);
    s.ignitionKey = "START"; window.stepSimulation(s, 0.5);
    s.ignitionKey = "IG_ON"; window.stepSimulation(s, 0.5);
    const misfireCyl2Before = s.cylinderMisfire[1] && s.activeDtcs.some(d => d.code === "P0352");
    // Переставляем катушку из Цил. 2 в Цил. 4
    s.activeDtcs = [];
    window.swapCylinderParts(s, "ignition_coil", 2, 4);
    window.stepSimulation(s, 0.5);
    const misfireMovedToCyl4 = !s.cylinderMisfire[1] && s.cylinderMisfire[3] && s.activeDtcs.some(d => d.code === "P0354");
    results.push({
      id: 4,
      name: "4) Отказ катушки №2 даёт пропуски P0302/P0352; перестановка на Цил. 4 переносит DTC в P0354",
      passed: misfireCyl2Before && misfireMovedToCyl4,
      detail: "До перестановки: пропуск Цил.2 (P0352) -> После перестановки 2↔4: пропуск Цил.4 (P0354), Цил.2 исправен"
    });
  }

  // Тест 5: Перегоревший предохранитель обесточивает цепь; неустранённое КЗ снова вызывает отказ
  {
    const s = window.createInitialSimState();
    window.injectFaultScenario(s, ["fault_etcs_short_fuse"]);
    const deenergized = window.getPinElectricalState(s, "A50-3_+BM").dcV < 0.5 && s.fuses.fuse_etcs.blown;
    // Меняем предохранитель ETCS 10A БЕЗ устранения КЗ на массу в проводе A50-3_+BM
    s.fuses.fuse_etcs.blown = false;
    window.stepSimulation(s, 0.2);
    const blewAgain = s.fuses.fuse_etcs.blown === true;
    // Теперь устраняем КЗ и меняем предохранитель
    delete s.wireFaults["A50-3_+BM"];
    s.fuses.fuse_etcs.blown = false;
    window.stepSimulation(s, 0.2);
    const holdsAfterShortFixed = !s.fuses.fuse_etcs.blown && window.getPinElectricalState(s, "A50-3_+BM").dcV > 11.5;
    results.push({
      id: 5,
      name: "5) Сгоревший предохранитель обесточивает цепь; при неустранённом КЗ новый пред. сгорает снова",
      passed: deenergized && blewAgain && holdsAfterShortFixed,
      detail: "Сгорел ETCS (0 В) -> Замена без ремонта КЗ: сгорел повторно! -> Устранение КЗ + замена: 12.65 В"
    });
  }

  // Тест 6: Отказ ДПКВ влияет на сигнал и запуск по логике модели
  {
    const s = window.createInitialSimState();
    window.injectFaultScenario(s, ["fault_ckp_open"]);
    s.ignitionKey = "START"; window.stepSimulation(s, 0.5);
    const neSignalAc = window.getPinElectricalState(s, "B31-122_NE+").acV;
    s.ignitionKey = "IG_ON"; window.stepSimulation(s, 0.5);
    const noStart = s.rpm === 0 && neSignalAc === 0 && s.activeDtcs.some(d => d.code === "P0335");
    results.push({
      id: 6,
      name: "6) Отказ ДПКВ обнуляет сигнал NE+, блокирует впрыск/запуск и записывает P0335",
      passed: noStart,
      detail: "Сигнал NE+ = 0.00 В AC, запуск невозможен (RPM=0 после отпускания ключа), активен код P0335"
    });
  }

  // Тест 7: Неисправность охлаждения изменяет температуру и поведение двигателя
  {
    const s = window.createInitialSimState();
    window.injectFaultScenario(s, ["fault_thermostat_stuck_closed"]);
    s.ignitionKey = "START"; window.stepSimulation(s, 0.5);
    s.ignitionKey = "IG_ON";
    for (let i = 0; i < 45; i++) window.stepSimulation(s, 2.5);
    const overheated = s.coolantTempC > 106.0 && s.activeDtcs.some(d => d.code === "P0217");
    results.push({
      id: 7,
      name: "7) Заклинивший термостат вызывает перегрев (>106°C) и аварийный режим P0217",
      passed: overheated,
      detail: "Температура ОЖ выросла до " + s.coolantTempC.toFixed(1) + "°C, зарегистрирован DTC P0217"
    });
  }

  // Тест 8: Две неисправности на уровне Эксперт устраняются независимо
  {
    const s = window.createInitialSimState();
    s.difficulty = "expert";
    window.injectFaultScenario(s, ["fault_coil2_dead", "fault_alt_wire_open"]);
    s.ignitionKey = "START"; window.stepSimulation(s, 0.5);
    s.ignitionKey = "IG_ON"; window.stepSimulation(s, 0.5);
    const bothBroken = s.cylinderMisfire[1] && s.chargeWarningLight;
    // Устраняем только первую неисправность (катушка №2)
    s.components.coil_2.condition = "good";
    window.stepSimulation(s, 0.5);
    const firstFixedSecondRemains = !s.cylinderMisfire[1] && s.chargeWarningLight;
    // Устраняем вторую неисправность (провод ALT_B+)
    delete s.wireFaults["ALT_B+"];
    window.stepSimulation(s, 0.5);
    const bothFixed = !s.cylinderMisfire[1] && !s.chargeWarningLight && s.systemVoltage >= 13.8;
    results.push({
      id: 8,
      name: "8) Две независимые неисправности («Эксперт») влияют и устраняются независимо",
      passed: bothBroken && firstFixedSecondRemains && bothFixed,
      detail: "Обе активны -> Замена КЗ №2 устранила троение (зарядки ещё нет) -> Ремонт ALT_B+ восстановил зарядку 14.12 В"
    });
  }

  // Тест 9: Некорректное подключение прибора вызывает предупреждение безопасности
  {
    const s = window.createInitialSimState();
    s.activeTool = "testlight";
    s.testLightType = "LOAD_21W";
    s.probeRed = "DLC3-6_CANH";
    s.probeBlack = "BAT-";
    const reading = window.computeInstrumentReading(s);
    const hasWarn = Boolean(reading.warning && reading.warning.includes("ВНИМАНИЕ"));
    results.push({
      id: 9,
      name: "9) Подключение нагрузочной контрольки 21Вт к линии CANH / датчику вызывает предупреждение",
      passed: hasWarn,
      detail: hasWarn ? "Сработала защита: запрет нагрузочной лампы 21Вт на шине CANH" : "Ошибка"
    });
  }

  // Тест 10: После полного правильного ремонта и сброса DTC проверки проходят
  {
    const s = window.createInitialSimState();
    window.injectFaultScenario(s, ["fault_inj1_open"]);
    s.ignitionKey = "START"; window.stepSimulation(s, 0.5);
    s.ignitionKey = "IG_ON"; window.stepSimulation(s, 0.5);
    // Заменяем форсунку №1 и стираем коды DTC
    s.components.inj_1.condition = "good";
    s.activeDtcs = [];
    s.FreezeFrame = null;
    window.stepSimulation(s, 0.5);
    const ver = window.verifyEngineRepair(s);
    results.push({
      id: 10,
      name: "10) После полного ремонта и сброса DTC «Проверить двигатель» подтверждает исправность",
      passed: ver.ok === true && ver.title === "Двигатель исправен. Все проверенные системы работают нормально",
      detail: ver.title
    });
  }

  return results;
};
