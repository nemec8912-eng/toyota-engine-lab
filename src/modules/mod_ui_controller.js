// ============================================================================
// МОДУЛЬ 5: КОНТРОЛЛЕР ИНТЕРФЕЙСА (ПК + АДАПТАЦИЯ ПОД iPHONE / iOS SAFARI),
// TOUCH-УПРАВЛЕНИЕ ЩУПАМИ И 3D-КАМЕРОЙ, ЭЛЕКТРОСХЕМА, СКЛАД И LOCALSTORAGE
// ============================================================================

window.simState = null;
window.oscTimeAcc = 0;
window.mobileActivePane = "all"; // "center" | "left" | "right" | "all"
window.touchActiveProbe = "red"; // "red" | "black" — для подключения щупа одним касанием на iPhone

window.saveSimProgress = function() {
  if (!window.simState) return;
  try {
    const payload = {
      difficulty: window.simState.difficulty,
      activeFaultIds: window.simState.activeFaultIds,
      faultRevealedHintLevel: window.simState.faultRevealedHintLevel,
      fuses: window.simState.fuses,
      relays: window.simState.relays,
      components: window.simState.components,
      wireFaults: window.simState.wireFaults,
      activeDtcs: window.simState.activeDtcs,
      FreezeFrame: window.simState.FreezeFrame
    };
    localStorage.setItem("toyota_engine_lab_1zr_v1", JSON.stringify(payload));
  } catch (e) {}
};

window.loadSimProgress = function(state) {
  try {
    const raw = localStorage.getItem("toyota_engine_lab_1zr_v1");
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && data.components && data.fuses) {
      state.difficulty = data.difficulty || "novice";
      state.activeFaultIds = data.activeFaultIds || [];
      state.faultRevealedHintLevel = data.faultRevealedHintLevel || 0;
      Object.assign(state.fuses, data.fuses);
      Object.assign(state.relays, data.relays || {});
      Object.assign(state.components, data.components);
      state.wireFaults = data.wireFaults || {};
      state.activeDtcs = data.activeDtcs || [];
      state.FreezeFrame = data.FreezeFrame || null;
    }
  } catch (e) {}
};

window.setMobilePane = function(pane) {
  window.mobileActivePane = pane;
  const leftSec = document.getElementById("section-left-instruments");
  const centerSec = document.getElementById("section-center-3d");
  const rightSec = document.getElementById("section-right-cards");
  const isMobile = window.innerWidth < 1024;

  if (leftSec && centerSec && rightSec) {
    if (!isMobile || pane === "all") {
      leftSec.classList.remove("hidden");
      centerSec.classList.remove("hidden");
      rightSec.classList.remove("hidden");
    } else {
      leftSec.classList.toggle("hidden", pane !== "left");
      centerSec.classList.toggle("hidden", pane !== "center");
      rightSec.classList.toggle("hidden", pane !== "right");
    }
  }

  document.querySelectorAll("[data-action='set-mobile-pane']").forEach(btn => {
    const p = btn.getAttribute("data-pane");
    if (p === pane) {
      btn.classList.add("bg-sky-600", "text-white", "border-sky-400");
      btn.classList.remove("bg-slate-900", "text-slate-300");
    } else {
      btn.classList.remove("bg-sky-600", "text-white", "border-sky-400");
      btn.classList.add("bg-slate-900", "text-slate-300");
    }
  });

  if (window.Engine3DScene && window.Engine3DScene.renderer) {
    setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
  }
};

window.setUiMode = function(mode) {
  if (!window.simState) return;
  window.simState.uiMode = mode;
  if (mode === "cutaway") {
    window.simState.cutawayEnabled = true;
    window.simState.transparencyLevel = 0.65;
  } else if (mode === "assembled") {
    window.simState.cutawayEnabled = false;
    window.simState.transparencyLevel = 0.0;
  }
  if (window.innerWidth < 1024 && window.mobileActivePane !== "all") {
    window.setMobilePane("center");
  }
  window.renderAllPanels();
};

window.selectComponent = function(compId, focusCamera) {
  if (!window.simState) return;
  window.simState.selectedComponentId = compId;
  if (focusCamera && window.Engine3DScene) {
    window.Engine3DScene.focusComponent(compId);
  }
  const badge = document.getElementById("mobile-selected-comp-label"); // id="mobile-selected-comp-label"
  const reg = window.COMPONENT_REGISTRY.find(c => c.id === compId);
  if (badge && reg) {
    badge.textContent = reg.shortName + " (" + reg.oem.split(" ")[0] + ")";
  }
  window.renderRightPanel();
  window.renderCenterOverlay();
};

window.attachProbe = function(color, pinId) {
  if (!window.simState) return;
  if (color === "red") {
    window.simState.probeRed = pinId;
    window.logSimAction(window.simState, "probe", "Красный щуп (+) подключён к контакту: " + pinId);
  } else {
    window.simState.probeBlack = pinId;
    window.logSimAction(window.simState, "probe", "Чёрный щуп (-) подключён к контакту: " + pinId);
  }
  window.renderLeftInstrumentPanel();
  window.renderCenterOverlay();
};


window.downloadIndexHtmlForGithub = function() {
  try {
    const modal = document.getElementById("github-deploy-modal"); // id="github-deploy-modal"
    const wasHidden = modal ? modal.classList.contains("hidden") : true;
    if (modal) modal.classList.add("hidden");
    const htmlContent = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
    if (modal && !wasHidden) modal.classList.remove("hidden");
    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "index.html";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  } catch (e) {}
};

window.toggleGithubModal = function(show) {
  const modal = document.getElementById("github-deploy-modal"); // id="github-deploy-modal"
  if (!modal) return;
  if (show) modal.classList.remove("hidden");
  else modal.classList.add("hidden");
};

window.downloadStandaloneHtmlForIphone = function() {
  try {
    const htmlContent = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Toyota_Engine_Lab_1ZR_iPhone.html";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  } catch (e) {}
};

// Отрисовка левой панели диагностических приборов и генератора неисправностей
window.renderLeftInstrumentPanel = function() {
  const s = window.simState;
  const host = document.getElementById("left-instrument-host");
  if (!host || !s) return;

  const reading = window.computeInstrumentReading(s);

  const probeOptionsHtml = (selectedPin) =>
    window.PROBE_POINTS.map(p =>
      `<option value="${p.id}" ${p.id === selectedPin ? "selected" : ""}>[${p.category}] ${p.label}</option>`
    ).join("");

  let toolBodyHtml = "";

  if (s.activeTool === "multimeter") {
    toolBodyHtml = `
      <div class="bg-slate-950 border border-slate-700 rounded-lg p-3 mb-3">
        <div class="flex items-center justify-between text-[11px] text-slate-400 mb-1">
          <span>ЦИФРОВОЙ МУЛЬТИМЕТР (TRUE RMS)</span>
          <span class="px-1.5 py-0.5 rounded bg-slate-800 text-amber-400 font-mono">${s.dmmMode}</span>
        </div>
        <div class="bg-[#1b261e] border-2 border-slate-700 rounded p-2.5 flex items-baseline justify-between font-mono">
          <span class="text-2xl font-bold tracking-wider ${reading.overload ? "text-red-400" : "text-emerald-300"}">${reading.displayValue}</span>
          <span class="text-xs text-emerald-400 font-semibold">${reading.unit}</span>
        </div>
        <div class="grid grid-cols-3 gap-1.5 mt-2">
          ${[
            ["DC_V", "V DC (Пост.)"],
            ["AC_V", "V AC (Перем.)"],
            ["OHM", "Ω (Сопрот.)"],
            ["CONT", "🔊 Прозвонка"],
            ["DIODE", "➔| Диод"],
            ["DC_A", "A (Ток АКБ)"]
          ].map(([m, lbl]) => `
            <button type="button" data-action="set-dmm-mode" data-mode="${m}"
              class="px-2 py-2 text-xs font-medium rounded border transition ${s.dmmMode === m ? "bg-amber-500/20 border-amber-400 text-amber-200" : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800"}">
              ${lbl}
            </button>
          `).join("")}
        </div>
      </div>
    `;
  } else if (s.activeTool === "testlight") {
    const absV = Math.abs(reading.diffDcV);
    const lit = s.testLightType === "LED" ? absV >= 1.8 : absV >= 8.5;
    const pol = reading.diffDcV >= 0 ? "Плюс на красном щупе" : "Плюс на чёрном щупе";
    toolBodyHtml = `
      <div class="bg-slate-950 border border-slate-700 rounded-lg p-3 mb-3">
        <div class="text-[11px] text-slate-400 mb-2 font-semibold">КОНТРОЛЬНАЯ ЛАМПА (КОНТРОЛЬКА)</div>
        <div class="grid grid-cols-2 gap-1.5 mb-2.5">
          <button type="button" data-action="set-testlight-type" data-tltype="LED"
            class="px-2 py-2 text-xs rounded border ${s.testLightType === "LED" ? "bg-emerald-500/20 border-emerald-400 text-emerald-200" : "bg-slate-900 border-slate-700 text-slate-300"}">
            Малотоковая LED (Безопасная)
          </button>
          <button type="button" data-action="set-testlight-type" data-tltype="LOAD_21W"
            class="px-2 py-2 text-xs rounded border ${s.testLightType === "LOAD_21W" ? "bg-amber-500/20 border-amber-400 text-amber-200" : "bg-slate-900 border-slate-700 text-slate-300"}">
            Нагрузочная 21 Вт (Силовая)
          </button>
        </div>
        <div class="flex items-center gap-3 p-2.5 rounded bg-slate-900 border border-slate-800">
          <div class="w-8 h-8 rounded-full flex items-center justify-center border-2 ${lit ? (s.testLightType === "LED" ? "bg-emerald-400 border-emerald-200 shadow-[0_0_16px_#34d399]" : "bg-amber-400 border-amber-200 shadow-[0_0_18px_#fbbf24]") : "bg-slate-800 border-slate-600"}">
            💡
          </div>
          <div class="text-xs">
            <div class="font-bold ${lit ? "text-white" : "text-slate-400"}">${lit ? "ИНДИКАТОР СВЕТИТСЯ (" + absV.toFixed(1) + " В)" : "НЕ ГОРИТ (" + absV.toFixed(2) + " В)"}</div>
            <div class="text-[11px] text-slate-400">${lit ? pol : "Недостаточная разность потенциалов"}</div>
          </div>
        </div>
      </div>
    `;
  } else if (s.activeTool === "continuity") {
    const energized = Math.abs(reading.diffDcV) > 1.5;
    const isClosed = !energized && isFinite(reading.measuredOhm) && reading.measuredOhm < 35;
    toolBodyHtml = `
      <div class="bg-slate-950 border border-slate-700 rounded-lg p-3 mb-3">
        <div class="text-[11px] text-slate-400 mb-1.5 font-semibold">РЕЖИМ ПРОЗВОНКИ ЦЕПЕЙ (ПРИ ОТКЛ. ПИТАНИИ)</div>
        <div class="p-2.5 rounded bg-slate-900 border border-slate-800 text-xs">
          ${energized
            ? `<div class="text-red-400 font-bold">⚡ ЦЕПЬ ПОД НАПРЯЖЕНИЕМ (${Math.abs(reading.diffDcV).toFixed(1)} В)!</div>
               <div class="text-slate-400 text-[11px] mt-1">Отключите зажигание (OFF) или отсоедините разъём/АКБ для достоверной прозвонки.</div>`
            : `<div class="flex items-center justify-between">
                 <span class="font-bold ${isClosed ? "text-emerald-400" : "text-amber-300"}">${isClosed ? "🔊 ЦЕПЬ ЗАМКНУТА (ЕСТЬ КОНТАКТ)" : "ЦЕПЬ РАЗОМКНУТА / ОБРЫВ"}</span>
                 <span class="font-mono text-sm font-bold text-white">${isFinite(reading.measuredOhm) ? reading.measuredOhm.toFixed(2) + " Ω" : "OL (∞ Ω)"}</span>
               </div>`
          }
        </div>
      </div>
    `;
  } else if (s.activeTool === "oscilloscope") {
    toolBodyHtml = `
      <div class="bg-slate-950 border border-slate-700 rounded-lg p-2.5 mb-3">
        <div class="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
          <span class="font-semibold text-cyan-300">2-КАНАЛЬНЫЙ ОСЦИЛЛОГРАФ</span>
          <button type="button" data-action="toggle-osc-pause" class="px-2.5 py-1 rounded bg-slate-800 text-xs text-slate-200 hover:bg-slate-700">
            ${s.oscPaused ? "▶ Пуск" : "⏸ Стоп-кадр"}
          </button>
        </div>
        <canvas id="osc-canvas" width="290" height="145" class="w-full h-36 bg-[#071118] border border-slate-700 rounded mb-2"></canvas>
        <div class="grid grid-cols-2 gap-1.5 text-[11px]">
          <div>
            <label class="text-cyan-400 font-semibold block mb-0.5">CH1 (Голубой):</label>
            <select id="osc-ch1-select" class="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1.5 text-slate-200 text-xs">
              ${probeOptionsHtml(s.oscCh1Pin)}
            </select>
          </div>
          <div>
            <label class="text-amber-400 font-semibold block mb-0.5">CH2 (Жёлтый):</label>
            <select id="osc-ch2-select" class="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1.5 text-slate-200 text-xs">
              ${probeOptionsHtml(s.oscCh2Pin)}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-1 mt-2 text-xs">
          <button type="button" data-action="osc-preset" data-preset="ckp_cmp" class="px-1.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800">ДПКВ + ДПРВ</button>
          <button type="button" data-action="osc-preset" data-preset="igt_igf" class="px-1.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800">IGT1 + IGF1</button>
          <button type="button" data-action="osc-preset" data-preset="inj_af" class="px-1.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800">Форс.#1 + ДК2</button>
        </div>
      </div>
    `;
  } else if (s.activeTool === "obd2") {
    const dlcPwr = window.getPinElectricalState(s, "DLC3-16_BAT").dcV > 9.0;
    const canOk = window.getPinElectricalState(s, "DLC3-6_CANH").dcV > 1.0 && window.getPinElectricalState(s, "A50-2_+B").dcV > 8.0;
    toolBodyHtml = `
      <div class="bg-slate-950 border border-slate-700 rounded-lg p-2.5 mb-3">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[11px] font-bold text-sky-400">СКАНЕР TOYOTA GTS / OBD-II (DLC3)</span>
          <button type="button" data-action="toggle-obd-connect" class="px-2.5 py-1 rounded text-xs font-semibold ${s.obdConnected ? "bg-emerald-600 text-white" : "bg-sky-600 text-white"}">
            ${s.obdConnected ? "Подключён" : "Подключить DLC3"}
          </button>
        </div>
        ${!s.obdConnected
          ? `<div class="text-xs text-slate-400 p-2 bg-slate-900 rounded">Нажмите «Подключить DLC3» для связи с ЭБУ по шине CAN (контакты 6, 14, 16 разъёма OBD2).</div>`
          : !dlcPwr
          ? `<div class="text-xs text-red-400 font-semibold p-2 bg-red-950/40 border border-red-700/50 rounded">ОШИБКА ПИТАНИЯ DLC3: На контакте 16 (BAT) разъёма OBD2 отсутствует +12 В! Проверьте предохранитель OBD (7.5A) и АКБ.</div>`
          : !canOk
          ? `<div class="text-xs text-amber-300 font-semibold p-2 bg-amber-950/40 border border-amber-700/50 rounded">НЕТ СВЯЗИ С ECM (No Communication): Включите зажигание (IG ON) и проверьте питание ЭБУ (+B, реле EFI MAIN) и линию CAN.</div>`
          : `
            <div class="grid grid-cols-4 gap-1 mb-2 text-[11px]">
              ${[
                ["dtc", "DTC (" + s.activeDtcs.length + ")"],
                ["livedata", "Live Data"],
                ["freezeframe", "Freeze"],
                ["monitors", "Мониторы"]
              ].map(([tab, lbl]) => `
                <button type="button" data-action="set-obd-tab" data-tab="${tab}"
                  class="py-1.5 rounded border font-semibold ${s.obdTab === tab ? "bg-sky-500/20 border-sky-400 text-sky-200" : "bg-slate-900 border-slate-700 text-slate-400"}">
                  ${lbl}
                </button>
              `).join("")}
            </div>
            ${s.obdTab === "dtc" ? `
              <div class="max-h-36 overflow-y-auto space-y-1 mb-2">
                ${s.activeDtcs.length === 0
                  ? `<div class="text-xs text-emerald-400 p-2 bg-slate-900 rounded">Коды неисправностей (DTC) в блоке Engine & ECT отсутствуют.</div>`
                  : s.activeDtcs.map(d => `
                    <div class="p-1.5 rounded bg-red-950/40 border border-red-800/60 text-[11px]">
                      <div class="font-bold text-red-300">${d.code} — <span class="text-amber-300">${d.status}</span></div>
                      <div class="text-slate-300">${d.desc}</div>
                    </div>
                  `).join("")
                }
              </div>
              <button type="button" data-action="clear-dtcs" class="w-full py-2 rounded bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-semibold">
                Стереть коды DTC и Freeze Frame
              </button>
            ` : s.obdTab === "livedata" ? `
              <div class="max-h-48 overflow-y-auto text-xs divide-y divide-slate-800 bg-slate-900 rounded p-1.5 font-mono">
                <div class="py-1 flex justify-between"><span>Engine Speed (NE):</span><span class="text-cyan-300">${ (s.components.ckp_sensor.condition === "good" && s.wireFaults["B31-122_NE+"] !== "open") ? Math.round(s.rpm) + " rpm" : "0 rpm" }</span></div>
                <div class="py-1 flex justify-between"><span>Coolant Temp (THW):</span><span class="text-cyan-300">${ (s.components.ect_sensor.condition === "good" && s.wireFaults["B31-97_THW"] !== "open") ? s.coolantTempC.toFixed(1) + " °C" : "-40.0 °C" }</span></div>
                <div class="py-1 flex justify-between"><span>MAF Air Flow (VG):</span><span class="text-cyan-300">${s.mafGramsPerSec.toFixed(2)} g/s</span></div>
                <div class="py-1 flex justify-between"><span>Intake Air Temp (THA):</span><span class="text-cyan-300">${s.intakeAirTempC.toFixed(1)} °C</span></div>
                <div class="py-1 flex justify-between"><span>Throttle Sensor VTA1:</span><span class="text-cyan-300">${window.getPinElectricalState(s, "B31-115_VTA1").dcV.toFixed(2)} V (${s.throttleAngleDeg.toFixed(1)}°)</span></div>
                <div class="py-1 flex justify-between"><span>Accel Pos VPA1 / VPA2:</span><span class="text-cyan-300">${window.getPinElectricalState(s, "A50-55_VPA").dcV.toFixed(2)}V / ${window.getPinElectricalState(s, "A50-56_VPA2").dcV.toFixed(2)}V</span></div>
                <div class="py-1 flex justify-between"><span>Short FT #1 / Long FT #1:</span><span class="${Math.abs(s.stftPct + s.ltftPct) > 15 ? "text-red-400 font-bold" : "text-emerald-300"}">${s.stftPct > 0 ? "+" : ""}${s.stftPct.toFixed(1)}% / ${s.ltftPct > 0 ? "+" : ""}${s.ltftPct.toFixed(1)}%</span></div>
                <div class="py-1 flex justify-between"><span>AFS Voltage B1S1:</span><span class="text-cyan-300">${window.getPinElectricalState(s, "B31-112_A1A+").dcV.toFixed(2)} V</span></div>
                <div class="py-1 flex justify-between"><span>O2S B1S2 (OX1B):</span><span class="text-cyan-300">${window.getPinElectricalState(s, "B31-64_OX1B").dcV.toFixed(2)} V</span></div>
                <div class="py-1 flex justify-between"><span>Ignition Advance:</span><span class="text-cyan-300">${s.ignitionAdvanceDeg.toFixed(1)}° BTDC</span></div>
                <div class="py-1 flex justify-between"><span>VVT-i In / Ex Angle:</span><span class="text-cyan-300">${s.vvtIntakeAngleDeg.toFixed(1)}° / ${s.vvtExhaustAngleDeg.toFixed(1)}°</span></div>
                <div class="py-1 flex justify-between"><span>Battery Voltage (+B):</span><span class="text-cyan-300">${s.systemVoltage.toFixed(2)} V</span></div>
                <div class="py-1 flex justify-between"><span>Stop Light Switch:</span><span class="text-cyan-300">${s.brakePedalPressed ? "ON" : "OFF"}</span></div>
              </div>
            ` : s.obdTab === "freezeframe" ? `
              <div class="max-h-40 overflow-y-auto text-xs bg-slate-900 rounded p-2 font-mono">
                ${!s.FreezeFrame
                  ? `<div class="text-slate-400 font-sans">Нет сохранённого стоп-кадра (Freeze Frame записывается в момент регистрации DTC).</div>`
                  : `
                    <div class="text-amber-300 font-bold mb-1">Стоп-кадр для DTC: ${s.FreezeFrame.dtc}</div>
                    <div>Engine Speed: ${s.FreezeFrame.rpm} rpm</div>
                    <div>Coolant Temp: ${s.FreezeFrame.coolantTempC} °C</div>
                    <div>Calculate Load: ${s.FreezeFrame.calcLoadPct} %</div>
                    <div>MAF: ${s.FreezeFrame.mafGps} g/s</div>
                    <div>Short FT #1 + Long FT #1: ${(s.FreezeFrame.stftPct + s.FreezeFrame.ltftPct).toFixed(1)} %</div>
                    <div>AFS Voltage B1S1: ${s.FreezeFrame.afsVoltageV} V</div>
                    <div>Closed Throttle SW: ${s.FreezeFrame.closedThrottleSw}</div>
                    <div>Stop Light SW: ${s.FreezeFrame.stopLightSw}</div>
                  `
                }
              </div>
            ` : `
              <div class="text-xs bg-slate-900 rounded p-2 space-y-1">
                ${Object.entries(s.readinessMonitors).map(([k, val]) => `
                  <div class="flex justify-between">
                    <span class="text-slate-300 capitalize">${k} Monitor:</span>
                    <span class="font-mono font-semibold ${val === "COMPLETE" ? "text-emerald-400" : "text-amber-400"}">${val}</span>
                  </div>
                `).join("")}
              </div>
            `}
          `
        }
      </div>
    `;
  }

  // Блок выбираемых и перетаскиваемых щупов (адаптировано для касания пальцем на iPhone!)
  const probesHtml = `
    <div class="bg-slate-900/90 border border-slate-700 rounded-lg p-2.5 mb-3">
      <div class="text-[11px] font-bold text-slate-300 mb-1.5 flex items-center justify-between">
        <span>ЩУПЫ ПРИБОРА (ВЫБЕРИТЕ КОНТАКТ ИЛИ ТАПНИТЕ)</span>
      </div>
      <div class="space-y-2">
        <div>
          <div class="flex items-center justify-between text-xs mb-1">
            <span draggable="true" id="drag-probe-red" class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-600 text-white font-bold cursor-grab shadow">
              🔴 Щуп (+) Красный
            </span>
            <span class="font-mono text-red-300 text-xs">${s.probeRed}</span>
          </div>
          <select id="probe-red-select" class="w-full bg-slate-950 border border-red-800/70 rounded px-2 py-1.5 text-xs text-slate-200">
            ${probeOptionsHtml(s.probeRed)}
          </select>
        </div>
        <div>
          <div class="flex items-center justify-between text-xs mb-1">
            <span draggable="true" id="drag-probe-black" class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-700 border border-slate-400 text-white font-bold cursor-grab shadow">
              ⚫ Щуп (-) Чёрный
            </span>
            <span class="font-mono text-slate-300 text-xs">${s.probeBlack}</span>
          </div>
          <select id="probe-black-select" class="w-full bg-slate-950 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-200">
            ${probeOptionsHtml(s.probeBlack)}
          </select>
        </div>
      </div>
      ${reading.warning ? `
        <div class="mt-2 p-2 rounded bg-red-950/80 border border-red-500 text-xs text-red-200 font-medium leading-snug">
          ⚠️ ${reading.warning}
        </div>
      ` : ""}
    </div>
  `;

  // Блок генератора неисправностей, 5-уровневых подсказок и кнопки «Проверить двигатель»
  const activeFaultDefs = s.activeFaultIds.map(fid => window.FAULT_CATALOG.find(f => f.id === fid)).filter(Boolean);
  const hintLabels = [
    "1 — Подозрительная система",
    "2 — Какой прибор использовать",
    "3 — Нужные контакты и нормативы",
    "4 — Пошаговая процедура проверки",
    "5 — Точная причина и метод ремонта"
  ];

  const faultAndHintsHtml = `
    <div class="bg-slate-900/90 border border-slate-700 rounded-lg p-2.5">
      <div class="flex items-center justify-between mb-2">
        <span class="text-[11px] font-bold text-amber-400 uppercase">Генератор неисправностей</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded ${s.activeFaultIds.length > 0 ? "bg-rose-500/20 text-rose-300 border border-rose-500/40" : "bg-emerald-500/20 text-emerald-300"}">
          ${s.activeFaultIds.length > 0 ? "Активна задача" : "Штатный режим"}
        </span>
      </div>
      <div class="grid grid-cols-3 gap-1 mb-2 text-xs">
        ${[
          ["novice", "Новичок (1)"],
          ["master", "Мастер (1)"],
          ["expert", "Эксперт (2)"]
        ].map(([diff, lbl]) => `
          <button type="button" data-action="set-difficulty" data-diff="${diff}"
            class="py-1.5 rounded border font-medium ${s.difficulty === diff ? "bg-amber-500/20 border-amber-400 text-amber-200" : "bg-slate-950 border-slate-800 text-slate-400"}">
            ${lbl}
          </button>
        `).join("")}
      </div>
      <div class="grid grid-cols-2 gap-1.5 mb-2">
        <button type="button" data-action="random-fault"
          class="py-2 px-2 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs shadow">
          🎲 Случайная неиспр.
        </button>
        <button type="button" data-action="verify-engine"
          class="py-2 px-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow">
          ✔ Проверить ДВС
        </button>
      </div>
      <button type="button" data-action="reset-healthy"
        class="w-full py-1.5 mb-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700">
        Сбросить все неисправности (Исправный ДВС)
      </button>

      ${s.verificationResult ? `
        <div class="p-2 mb-2 rounded border text-xs ${s.verificationResult.ok ? "bg-emerald-950/70 border-emerald-500 text-emerald-200" : "bg-rose-950/70 border-rose-500 text-rose-200"}">
          <div class="font-bold">${s.verificationResult.title}</div>
          <div class="text-[11px] mt-0.5 opacity-90">${s.verificationResult.details}</div>
        </div>
      ` : ""}

      <div class="border-t border-slate-800 pt-2 mt-1">
        <div class="flex items-center justify-between text-xs text-slate-400 mb-1.5">
          <span>ПОДСКАЗКИ (1–5):</span>
          <span class="font-mono text-amber-300">Уровень ${s.faultRevealedHintLevel}/5</span>
        </div>
        <div class="flex gap-1 mb-2">
          ${[1, 2, 3, 4, 5].map(lvl => `
            <button type="button" data-action="reveal-hint" data-level="${lvl}"
              class="flex-1 py-1.5 rounded text-xs font-bold border ${s.faultRevealedHintLevel >= lvl ? "bg-sky-600 border-sky-400 text-white" : "bg-slate-950 border-slate-700 text-slate-400 hover:bg-slate-800"}"
              title="${hintLabels[lvl - 1]}">
              ${lvl}
            </button>
          `).join("")}
          <button type="button" data-action="reveal-hint" data-level="0"
            class="px-2 py-1.5 rounded text-xs bg-slate-950 border border-slate-700 text-slate-400 hover:bg-slate-800">
            Скрыть
          </button>
        </div>
        ${s.faultRevealedHintLevel > 0 ? (
          activeFaultDefs.length === 0
            ? `<div class="text-xs text-slate-400 bg-slate-950 p-2 rounded">Скрытая неисправность не сгенерирована. Нажмите «Случайная неиспр.» для начала кейса.</div>`
            : `<div class="space-y-1.5 max-h-44 overflow-y-auto bg-slate-950 p-2 rounded border border-slate-800 text-xs">
                ${activeFaultDefs.map((fd, idx) => `
                  <div class="text-amber-300 font-semibold">${activeFaultDefs.length > 1 ? "Неисправность #" + (idx + 1) + ":" : "Пошаговая подсказка:"}</div>
                  ${fd.hints.slice(0, s.faultRevealedHintLevel).map((h, hi) => `
                    <div class="text-slate-200 leading-snug"><span class="text-sky-400 font-semibold">[Шаг ${hi + 1}]</span> ${h}</div>
                  `).join("")}
                `).join("<hr class='border-slate-800 my-1'/>")}
               </div>`
        ) : ""}
      </div>
    </div>
  `;

  host.innerHTML = toolBodyHtml + probesHtml + faultAndHintsHtml;

  const redSel = document.getElementById("probe-red-select");
  if (redSel) redSel.addEventListener("change", (e) => window.attachProbe("red", e.target.value));
  const blkSel = document.getElementById("probe-black-select");
  if (blkSel) blkSel.addEventListener("change", (e) => window.attachProbe("black", e.target.value));

  const ch1Sel = document.getElementById("osc-ch1-select");
  if (ch1Sel) ch1Sel.addEventListener("change", (e) => { s.oscCh1Pin = e.target.value; });
  const ch2Sel = document.getElementById("osc-ch2-select");
  if (ch2Sel) ch2Sel.addEventListener("change", (e) => { s.oscCh2Pin = e.target.value; });

  const dragRed = document.getElementById("drag-probe-red");
  if (dragRed) dragRed.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", "red"));
  const dragBlk = document.getElementById("drag-probe-black");
  if (dragBlk) dragBlk.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", "black"));
};


// Отрисовка центрального режима (Электросхема, Предохранители и ЭБУ, Склад и Ремонт, Обучение и Автотесты)
window.renderCenterOverlay = function() {
  const s = window.simState;
  const overlay = document.getElementById("center-mode-overlay");
  if (!overlay || !s) return;

  if (s.uiMode === "assembled" || s.uiMode === "cutaway" || s.uiMode === "diagnostics") {
    overlay.classList.add("hidden");
    overlay.innerHTML = "";
    return;
  }

  overlay.classList.remove("hidden");
  const comp = window.COMPONENT_REGISTRY.find(c => c.id === s.selectedComponentId) || window.COMPONENT_REGISTRY[0];
  const highlightedNodes = new Set(comp.circuitNodes || []);

  if (s.uiMode === "schematic" || s.uiMode === "ecu_wiring") {
    // Режим «Электросхема» и «ЭБУ и проводка»: трассировка цепи выбранного компонента + интерактивные предохранители, реле и создание/устранение дефектов проводки
    overlay.innerHTML = `
      <div class="p-3 space-y-3 text-xs">
        <div class="flex flex-wrap items-center justify-between gap-2 bg-slate-900/95 border border-slate-700 rounded-lg p-2.5">
          <div>
            <div class="text-sky-400 font-bold text-sm">ИНТЕРАКТИВНАЯ ЭЛЕКТРОСХЕМА И СЕТЬ ЭБУ (TOYOTA EWD 1ZR-FE)</div>
            <div class="text-slate-400 text-[11px]">Выбран узел: <b class="text-white">${comp.name}</b> — подсвечена полная цепь от источника питания (+АКБ / предохранитель / реле) до потребителя и контактов ЭБУ A50/B31.</div>
          </div>
          <button type="button" data-action="set-ui-mode" data-uimode="assembled" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 text-xs">
            ✕ Вернуться к 3D-двигателю
          </button>
        </div>

        <!-- Визуальный граф трассировки цепи от АКБ до выбранного компонента и ЭБУ -->
        <div class="bg-slate-950 border border-slate-700 rounded-lg p-3">
          <div class="text-[11px] font-bold text-amber-300 mb-2 uppercase">Трассировка электрической цепи выбранного узла (${comp.shortName}):</div>
          <div class="flex flex-wrap items-center gap-1.5">
            ${(comp.circuitNodes || ["battery", comp.id, "ecm_b31"]).map((nid, idx, arr) => {
              const isFuse = nid.startsWith("fuse_");
              const isRelay = nid.startsWith("relay_");
              let statusOk = true;
              let label = nid.toUpperCase();
              if (isFuse && s.fuses[nid]) {
                const fd = window.FUSE_DEFINITIONS.find(x => x.id === nid);
                statusOk = s.fuses[nid].installed && !s.fuses[nid].blown;
                label = "Пред. " + (fd ? fd.code : nid) + " (" + s.fuses[nid].rating + "A)";
              } else if (isRelay && s.relays[nid]) {
                const rd = window.RELAY_DEFINITIONS.find(x => x.id === nid);
                statusOk = s.relays[nid].installed && !s.relays[nid].faulty;
                label = (rd ? rd.code : nid) + (s.relays[nid].energized ? " [ЗАМКНУТО]" : " [РАЗОМКН.]");
              } else if (s.components[nid]) {
                const cd = window.COMPONENT_REGISTRY.find(x => x.id === nid);
                statusOk = s.components[nid].installed && s.components[nid].connectorPlugged && s.components[nid].condition === "good";
                label = cd ? cd.shortName : nid;
              } else if (nid === "ecm_a50" || nid === "ecm_b31") {
                label = nid === "ecm_a50" ? "Разъём ЭБУ A50" : "Разъём ЭБУ B31";
              }
              return `
                <div class="px-2.5 py-1.5 rounded border font-semibold ${statusOk ? "bg-sky-950/80 border-sky-400 text-sky-200 shadow-[0_0_10px_rgba(56,189,248,0.25)]" : "bg-red-950/80 border-red-500 text-red-200"}">
                  ${label}
                </div>
                ${idx < arr.length - 1 ? `<span class="text-sky-400 font-bold">➔</span>` : ""}
              `;
            }).join("")}
          </div>
        </div>

        <!-- Интерактивный блок предохранителей с проверкой номиналов -->
        <div class="bg-slate-900/95 border border-slate-700 rounded-lg p-3">
          <div class="text-[11px] font-bold text-slate-200 mb-2 uppercase">Блок предохранителей (Моторный отсек и панель приборов Corolla E150):</div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
            ${window.FUSE_DEFINITIONS.map(fd => {
              const fst = s.fuses[fd.id];
              const inChain = highlightedNodes.has(fd.id);
              const wrongRating = Number(fst.rating) !== Number(fd.rating);
              return `
                <div class="p-2 rounded border ${inChain ? "border-sky-400 bg-sky-950/30" : "border-slate-700 bg-slate-950"}">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-white">${fd.code} <span class="text-amber-300">(норма ${fd.rating}A)</span></span>
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${!fst.installed ? "bg-slate-700 text-slate-300" : fst.blown ? "bg-red-600 text-white" : wrongRating ? "bg-amber-600 text-slate-950" : "bg-emerald-600/30 text-emerald-300 border border-emerald-500/40"}">
                      ${!fst.installed ? "ИЗВЛЕЧЁН" : fst.blown ? "СГОРЕЛ (∞ Ω)" : wrongRating ? "НЕВЕРНЫЙ НОМИНАЛ " + fst.rating + "A" : "ИСПРАВЕН (" + fst.rating + "A)"}
                    </span>
                  </div>
                  <div class="text-[10px] text-slate-400 mt-0.5">${fd.slot} — ${fd.circuit}</div>
                  <div class="flex items-center gap-1 mt-1.5">
                    <button type="button" data-action="toggle-fuse-install" data-fuse="${fd.id}"
                      class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 text-[10px]">
                      ${fst.installed ? "Извлечь" : "Вставить"}
                    </button>
                    <button type="button" data-action="replace-fuse" data-fuse="${fd.id}" data-rating="${fd.rating}"
                      class="px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-[10px]">
                      Заменить (${fd.rating}A штатн.)
                    </button>
                    <button type="button" data-action="replace-fuse" data-fuse="${fd.id}" data-rating="30"
                      class="px-1.5 py-0.5 rounded bg-amber-800/70 hover:bg-amber-700 text-amber-200 text-[10px]" title="Установить неверный номинал 30A (не считается корректным ремонтом по ТЗ п.5!)">
                      Поставить 30A
                    </button>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>

        <!-- Интерактивный блок реле и управление дефектами проводки (Обрыв, КЗ на массу, КЗ на плюс, Окисление) -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div class="bg-slate-900/95 border border-slate-700 rounded-lg p-3">
            <div class="text-[11px] font-bold text-slate-200 mb-2 uppercase">Интегрированное реле и блок реле моторного отсека:</div>
            <div class="space-y-2">
              ${window.RELAY_DEFINITIONS.map(rd => {
                const rst = s.relays[rd.id];
                return `
                  <div class="p-2 rounded bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                    <div>
                      <div class="font-bold text-white">${rd.code} <span class="text-[10px] ${rst.energized ? "text-emerald-400" : "text-slate-400"}">${rst.energized ? "● ВКЛЮЧЕНО" : "○ ВЫКЛ"}</span></div>
                      <div class="text-[10px] text-slate-400">${rd.pins}</div>
                    </div>
                    <div class="flex gap-1 shrink-0">
                      <button type="button" data-action="toggle-relay-install" data-relay="${rd.id}"
                        class="px-2 py-1 rounded bg-slate-800 text-slate-200 border border-slate-700 text-[10px]">
                        ${rst.installed ? "Вынуть" : "Вставить"}
                      </button>
                      <button type="button" data-action="replace-relay" data-relay="${rd.id}"
                        class="px-2 py-1 rounded ${rst.faulty ? "bg-amber-500 text-slate-950 font-bold" : "bg-emerald-700/70 text-white"} text-[10px]">
                        ${rst.faulty ? "Заменить (Неиспр.)" : "Исправно"}
                      </button>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>

          <div class="bg-slate-900/95 border border-slate-700 rounded-lg p-3">
            <div class="text-[11px] font-bold text-slate-200 mb-2 uppercase">Жгуты проводки, контакты A50/B31 и точки массы (Ремонт / Моделирование дефектов):</div>
            <div class="max-h-60 overflow-y-auto space-y-1.5 pr-1">
              ${window.PROBE_POINTS.map(pp => {
                const curWf = s.wireFaults[pp.id] || "none";
                const pState = window.getPinElectricalState(s, pp.id);
                return `
                  <div class="p-1.5 rounded bg-slate-950 border ${curWf !== "none" ? "border-rose-500 bg-rose-950/20" : "border-slate-800"} flex flex-wrap items-center justify-between gap-1"
                       data-drop-pin="${pp.id}">
                    <div class="min-w-[160px]">
                      <span class="font-mono font-bold text-sky-300">${pp.id}</span>
                      <span class="text-slate-300 text-[11px] ml-1">${pp.label}</span>
                      <span class="font-mono text-[10px] text-emerald-400 ml-1">(${pState.dcV.toFixed(2)} В)</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <button type="button" data-action="probe-red" data-pin="${pp.id}" class="px-1.5 py-0.5 rounded bg-red-600/80 text-white text-[10px] font-bold" title="Подключить красный щуп">+Щуп</button>
                      <button type="button" data-action="probe-black" data-pin="${pp.id}" class="px-1.5 py-0.5 rounded bg-slate-700 text-white text-[10px] font-bold" title="Подключить чёрный щуп">-Щуп</button>
                      <select data-action="set-wire-fault" data-pin="${pp.id}" class="bg-slate-900 border ${curWf !== "none" ? "border-rose-500 text-rose-300 font-bold" : "border-slate-700 text-slate-300"} rounded px-1 py-0.5 text-[10px]">
                        <option value="none" ${curWf === "none" ? "selected" : ""}>Провод: Норма</option>
                        <option value="open" ${curWf === "open" ? "selected" : ""}>Обрыв провода</option>
                        <option value="short_gnd" ${curWf === "short_gnd" ? "selected" : ""}>КЗ на массу</option>
                        <option value="short_vcc" ${curWf === "short_vcc" ? "selected" : ""}>КЗ на +12В</option>
                        <option value="high_res" ${curWf === "high_res" ? "selected" : ""}>Окисление / R↑</option>
                      </select>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (s.uiMode === "sensors") {
    // Сводная таблица всех датчиков и входов ЭБУ (отдельно от исполнительных механизмов, п. 4 ТЗ!)
    const sensors = window.COMPONENT_REGISTRY.filter(c => c.category === "sensor");
    const actuators = window.COMPONENT_REGISTRY.filter(c => c.category === "actuator");
    overlay.innerHTML = `
      <div class="p-3 space-y-3 text-xs">
        <div class="flex items-center justify-between bg-slate-900 border border-slate-700 rounded-lg p-2.5">
          <div>
            <div class="text-emerald-400 font-bold text-sm">РЕЕСТР ДАТЧИКОВ И ВХОДОВ ЭБУ (СТРОГО ОТДЕЛЁН ОТ ИСПОЛНИТЕЛЬНЫХ МЕХАНИЗМОВ)</div>
            <div class="text-slate-400 text-[11px]">Кликните на любой элемент для открытия паспорта распиновки или нажмите «Показать на двигателе» для наведения 3D-камеры.</div>
          </div>
          <button type="button" data-action="set-ui-mode" data-uimode="assembled" class="px-2.5 py-1 rounded bg-slate-800 text-slate-200 border border-slate-600">✕ К 3D-модели</button>
        </div>
        <div class="bg-slate-950 border border-slate-700 rounded-lg p-2.5">
          <div class="text-emerald-300 font-bold mb-2 uppercase">1. Датчики и входные сигналы ЭБУ (${sensors.length} узлов):</div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            ${sensors.map(sen => `
              <div class="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between gap-2">
                <div>
                  <div class="font-bold text-white">${sen.name}</div>
                  <div class="text-[10px] text-slate-400">OEM: ${sen.oem} | DTC: ${sen.dtcs.join(", ")}</div>
                  <div class="text-[10px] text-cyan-300 mt-0.5">${sen.normalParams.slice(0, 110)}...</div>
                </div>
                <button type="button" data-action="focus-comp" data-comp="${sen.id}" class="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold text-[10px] shrink-0">
                  🎯 На двигателе
                </button>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="bg-slate-950 border border-slate-700 rounded-lg p-2.5">
          <div class="text-amber-300 font-bold mb-2 uppercase">2. Исполнительные механизмы (${actuators.length} узлов — управляются от ЭБУ):</div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
            ${actuators.map(act => `
              <div class="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between gap-2">
                <div>
                  <div class="font-bold text-white">${act.shortName}</div>
                  <div class="text-[10px] text-slate-400">OEM: ${act.oem}</div>
                </div>
                <button type="button" data-action="focus-comp" data-comp="${act.id}" class="px-2 py-1 rounded bg-amber-600/80 hover:bg-amber-500 text-slate-950 font-bold text-[10px] shrink-0">
                  🎯 Показать
                </button>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  } else if (s.uiMode === "repair") {
    // Режим «Ремонт и виртуальный склад» (п. 10 ТЗ: разборка, склад, перестановка между цилиндрами, ремонт проводки и масс)
    overlay.innerHTML = `
      <div class="p-3 space-y-3 text-xs">
        <div class="flex items-center justify-between bg-slate-900 border border-slate-700 rounded-lg p-2.5">
          <div>
            <div class="text-amber-400 font-bold text-sm">ЦЕХ РАЗБОРКИ, ВИРТУАЛЬНЫЙ СКЛАД ЗАПЧАСТЕЙ И ПЕРЕСТАНОВКА МЕЖДУ ЦИЛИНДРАМИ</div>
            <div class="text-slate-400 text-[11px]">Замена исправной детали НЕ устраняет обрыв или КЗ в проводке! После ремонта обязательно сотрите DTC и нажмите «Проверить двигатель».</div>
          </div>
          <button type="button" data-action="set-ui-mode" data-uimode="assembled" class="px-2.5 py-1 rounded bg-slate-800 text-slate-200 border border-slate-600">✕ К 3D-модели</button>
        </div>

        <!-- Быстрая перестановка катушек, свечей и форсунок между цилиндрами 1–4 для локализации пропусков -->
        <div class="bg-slate-950 border border-slate-700 rounded-lg p-3">
          <div class="text-sky-300 font-bold mb-2 uppercase">Локализация пропусков перестановкой деталей между цилиндрами (Цил. 1–4):</div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div class="p-2 rounded bg-slate-900 border border-slate-800">
              <div class="font-bold text-white mb-1">Катушки зажигания (B26–B29)</div>
              <div class="flex flex-wrap gap-1">
                <button type="button" data-action="swap-parts" data-group="ignition_coil" data-cyla="1" data-cylb="2" class="px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white text-[11px]">Поменять КЗ 1 ↔ 2</button>
                <button type="button" data-action="swap-parts" data-group="ignition_coil" data-cyla="2" data-cylb="4" class="px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white text-[11px]">Поменять КЗ 2 ↔ 4</button>
                <button type="button" data-action="swap-parts" data-group="ignition_coil" data-cyla="3" data-cylb="1" class="px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white text-[11px]">Поменять КЗ 3 ↔ 1</button>
              </div>
            </div>
            <div class="p-2 rounded bg-slate-900 border border-slate-800">
              <div class="font-bold text-white mb-1">Свечи зажигания (SC20HR11)</div>
              <div class="flex flex-wrap gap-1">
                <button type="button" data-action="swap-parts" data-group="spark_plug" data-cyla="1" data-cylb="2" class="px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-white text-[11px]">Поменять Свечи 1 ↔ 2</button>
                <button type="button" data-action="swap-parts" data-group="spark_plug" data-cyla="3" data-cylb="4" class="px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-white text-[11px]">Поменять Свечи 3 ↔ 4</button>
              </div>
            </div>
            <div class="p-2 rounded bg-slate-900 border border-slate-800">
              <div class="font-bold text-white mb-1">Топливные форсунки (#10–#40)</div>
              <div class="flex flex-wrap gap-1">
                <button type="button" data-action="swap-parts" data-group="fuel_injector" data-cyla="1" data-cylb="2" class="px-2 py-1 rounded bg-teal-700 hover:bg-teal-600 text-white text-[11px]">Поменять Форс. 1 ↔ 2</button>
                <button type="button" data-action="swap-parts" data-group="fuel_injector" data-cyla="2" data-cylb="3" class="px-2 py-1 rounded bg-teal-700 hover:bg-teal-600 text-white text-[11px]">Поменять Форс. 2 ↔ 3</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Быстрое восстановление повреждённой проводки и чистка точек массы -->
        <div class="bg-slate-950 border border-slate-700 rounded-lg p-3">
          <div class="flex items-center justify-between mb-2">
            <span class="text-emerald-300 font-bold uppercase">Ремонт жгутов проводки, чистка контактов и восстановление масс:</span>
            <button type="button" data-action="repair-all-wires" class="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs">
              🔧 Отремонтировать все повреждённые провода и зачистить массы
            </button>
          </div>
          <div class="text-[11px] text-slate-300">
            ${Object.keys(s.wireFaults).filter(k => s.wireFaults[k] !== "none").length === 0
              ? `<span class="text-slate-400">Обрывов, коротких замыканий и окисленных масс в жгутах сейчас не зафиксировано (или проверьте цепи мультиметром в режиме «Электросхема»).</span>`
              : `<div class="flex flex-wrap gap-1.5">
                  ${Object.keys(s.wireFaults).filter(k => s.wireFaults[k] !== "none").map(pin => `
                    <button type="button" data-action="repair-single-wire" data-pin="${pin}" class="px-2 py-1 rounded bg-rose-900/80 hover:bg-emerald-700 border border-rose-500 text-white font-semibold">
                      Восстановить линию ${pin} (устранить дефект)
                    </button>
                  `).join("")}
                 </div>`
            }
          </div>
        </div>

        <!-- Виртуальный склад всех узлов и агрегатов -->
        <div class="bg-slate-900 border border-slate-700 rounded-lg p-3">
          <div class="text-slate-200 font-bold mb-2 uppercase">Ведомость узлов двигателя и виртуальный склад запчастей:</div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
            ${window.COMPONENT_REGISTRY.map(reg => {
              const st = s.components[reg.id];
              return `
                <div class="p-2 rounded bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div class="font-bold text-white">${reg.shortName} <span class="text-[10px] text-slate-400 font-mono">(${reg.oem.split(" ")[0]})</span></div>
                    <div class="text-[10px] text-slate-400">
                      Разъём: <b class="${st.connectorPlugged ? "text-emerald-400" : "text-amber-400"}">${st.connectorPlugged ? "Подкл." : "Отсоед."}</b> |
                      Крепёж: <b class="${st.boltsFastened ? "text-emerald-400" : "text-amber-400"}">${st.boltsFastened ? "Затянут" : "Откручен"}</b> |
                      Узел: <b class="${st.installed ? "text-sky-300" : "text-rose-400"}">${st.installed ? "На ДВС" : "Снят"}</b>
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-1">
                    ${reg.hasConnector ? `
                      <button type="button" data-action="toggle-connector" data-comp="${reg.id}" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 text-[10px]">
                        ${st.connectorPlugged ? "Снять фишку" : "Надеть фишку"}
                      </button>
                    ` : ""}
                    ${reg.hasBolts ? `
                      <button type="button" data-action="toggle-bolts" data-comp="${reg.id}" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 text-[10px]">
                        ${st.boltsFastened ? "Открутить" : "Закрутить"}
                      </button>
                    ` : ""}
                    <button type="button" data-action="replace-part-warehouse" data-comp="${reg.id}" class="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[10px]">
                      Заменить со склада (OEM)
                    </button>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      </div>
    `;
  } else if (s.uiMode === "training") {
    // Режим «Обучение, VIN-отличия и 10 обязательных интеграционных тестов» (п. 1, 11, 15 ТЗ)
    const testResults = window.runAllMandatoryTests();
    const allPassed = testResults.every(t => t.passed);
    overlay.innerHTML = `
      <div class="p-3 space-y-3 text-xs">
        <div class="flex items-center justify-between bg-slate-900 border border-slate-700 rounded-lg p-2.5">
          <div>
            <div class="text-sky-400 font-bold text-sm">СПРАВОЧНИК КОМПЛЕКТАЦИЙ ПО VIN (RM04F1RU) И АВТОМАТИЧЕСКИЕ ИНТЕГРАЦИОННЫЕ ТЕСТЫ (П. 15 ТЗ)</div>
            <div class="text-slate-400 text-[11px]">Все 10 обязательных сценариев из п. 15 Технического задания выполняются на живом ядре симуляции.</div>
          </div>
          <button type="button" data-action="set-ui-mode" data-uimode="assembled" class="px-2.5 py-1 rounded bg-slate-800 text-slate-200 border border-slate-600">✕ К 3D-модели</button>
        </div>

        <div class="bg-slate-950 border border-emerald-600/50 rounded-lg p-3">
          <div class="flex items-center justify-between mb-2">
            <span class="font-bold text-emerald-300 uppercase">Результаты выполнения 10 обязательных интеграционных тестов (п. 15 ТЗ):</span>
            <span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">
              ПРОЙДЕНО: ${testResults.filter(t => t.passed).length} / ${testResults.length} (${allPassed ? "100% OK" : "ЕСТЬ ОШИБКИ"})
            </span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            ${testResults.map(tr => `
              <div class="p-2 rounded bg-slate-900 border ${tr.passed ? "border-emerald-800/70" : "border-red-600"}">
                <div class="font-bold ${tr.passed ? "text-emerald-300" : "text-red-400"}">${tr.passed ? "✔ PASS:" : "✖ FAIL:"} ${tr.name}</div>
                <div class="text-[10px] text-slate-400 font-mono mt-0.5">${tr.detail}</div>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="bg-slate-950 border border-slate-700 rounded-lg p-3">
          <div class="font-bold text-amber-300 mb-2 uppercase">Зафиксированные отличия по VIN / комплектациям Toyota Corolla E150 (1ZR-FE) и учебные допущения (п. 1 ТЗ):</div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            ${window.VIN_DIFFERENCES.map(v => `
              <div class="p-2.5 rounded bg-slate-900 border border-slate-800">
                <div class="font-bold text-white">${v.title}</div>
                <div class="text-[10px] text-sky-400 mb-1">Рынок / модификация: ${v.market}</div>
                <div class="text-[11px] text-slate-300 leading-snug mb-1">${v.factoryFact}</div>
                <div class="text-[10px] text-amber-300"><b>Реализация в стенде:</b> ${v.simChoice}</div>
                <div class="text-[10px] text-slate-400 mt-0.5">Источник: ${v.source}</div>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="bg-slate-950 border border-slate-700 rounded-lg p-3">
          <div class="font-bold text-slate-200 mb-2 uppercase">Быстрый запуск любого учебного сценария неисправности из базы (${window.FAULT_CATALOG.length} кейсов):</div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-1.5">
            ${window.FAULT_CATALOG.map(fc => `
              <button type="button" data-action="load-specific-fault" data-faultid="${fc.id}"
                class="text-left p-2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 transition">
                <div class="font-bold text-amber-300 text-[11px]">${fc.title}</div>
                <div class="text-[10px] text-slate-400">${fc.category} | Уровень: ${fc.difficulty}</div>
              </button>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  // Поддержка перетаскивания щупов на элементы с data-drop-pin
  overlay.querySelectorAll("[data-drop-pin]").forEach(el => {
    el.addEventListener("dragover", (e) => e.preventDefault());
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const color = e.dataTransfer.getData("text/plain");
      const pinId = el.getAttribute("data-drop-pin");
      if ((color === "red" || color === "black") && pinId) {
        window.attachProbe(color, pinId);
      }
    });
  });
};

// Отрисовка правой панели: Поиск узла, Карточка детали по RM04F1RU, распиновка с подключением щупов, ремонт узла и журнал действий
window.renderRightPanel = function() {
  const s = window.simState;
  const host = document.getElementById("right-card-host");
  if (!host || !s) return;

  const comp = window.COMPONENT_REGISTRY.find(c => c.id === s.selectedComponentId) || window.COMPONENT_REGISTRY[0];
  const compState = s.components[comp.id] || { installed: true, connectorPlugged: true, boltsFastened: true, condition: "good" };

  const searchFilter = (document.getElementById("comp-search-input")?.value || "").trim().toLowerCase();
  const filteredList = window.COMPONENT_REGISTRY.filter(c =>
    !searchFilter ||
    c.name.toLowerCase().includes(searchFilter) ||
    c.shortName.toLowerCase().includes(searchFilter) ||
    c.oem.toLowerCase().includes(searchFilter) ||
    c.dtcs.some(d => d.toLowerCase().includes(searchFilter))
  );

  host.innerHTML = `
    <!-- Селектор и быстрый переход к любому узлу с фокусировкой 3D-камеры -->
    <div class="bg-slate-900 border border-slate-700 rounded-lg p-2.5 mb-2.5">
      <div class="flex items-center justify-between gap-1.5 mb-1.5">
        <select id="comp-quick-select" class="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white font-semibold">
          ${filteredList.map(c => `
            <option value="${c.id}" ${c.id === comp.id ? "selected" : ""}>[${c.roleLabel}] ${c.shortName} (${c.oem.split(" ")[0]})</option>
          `).join("")}
        </select>
        <button type="button" data-action="focus-comp" data-comp="${comp.id}"
          class="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs shrink-0 shadow" title="Сфокусировать 3D-камеру на выбранной детали">
          🎯 Показать на ДВС
        </button>
      </div>

      <!-- Бейджи классификации: Датчик vs Исполнительный механизм и Источник данных -->
      <div class="flex flex-wrap items-center gap-1 text-[10px]">
        <span class="px-2 py-0.5 rounded font-bold ${comp.category === "sensor" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : comp.category === "actuator" ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "bg-sky-500/20 text-sky-300 border border-sky-500/40"}">
          ${comp.roleLabel}
        </span>
        <span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">OEM: ${comp.oem}</span>
        <span class="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-700/50">${comp.source}</span>
      </div>
    </div>

    <!-- Технический паспорт узла (Назначение, Устройство, Нормативы, Осциллограмма, Проверка, DTC) -->
    <div class="bg-slate-900 border border-slate-700 rounded-lg p-2.5 mb-2.5 space-y-2 text-xs">
      <div class="font-bold text-white text-sm leading-snug">${comp.name}</div>
      <div class="text-[11px] text-slate-300"><b class="text-slate-400">Расположение:</b> ${comp.location}</div>
      <div class="text-[11px] text-slate-300"><b class="text-slate-400">Назначение:</b> ${comp.purpose}</div>
      <div class="text-[11px] text-slate-300"><b class="text-slate-400">Устройство:</b> ${comp.construction}</div>
      <div class="text-[11px] text-slate-300"><b class="text-slate-400">Питание и тип сигнала:</b> ${comp.power} | ${comp.signalType}</div>
      <div class="p-2 rounded bg-slate-950 border border-slate-800 text-[11px] text-cyan-200">
        <b class="text-cyan-400 block mb-0.5">Заводские нормативные параметры (RM04F1RU):</b>
        ${comp.normalParams}
      </div>
      <div class="p-2 rounded bg-slate-950 border border-slate-800 text-[11px] text-amber-200">
        <b class="text-amber-400 block mb-0.5">Эталонная осциллограмма:</b>
        ${comp.waveformDesc}
      </div>

      ${comp.id === "block_crank_pistons" ? `
        <div class="p-2 rounded bg-slate-950 border border-sky-700/60 text-[11px]">
          <div class="font-bold text-sky-300 mb-1">Замер компрессии по цилиндрам 1–4 (норма 13,0 бар, мин. 10,0 бар):</div>
          <div class="grid grid-cols-4 gap-1 text-center font-mono">
            ${s.compressionBar.map((bar, idx) => `
              <div class="p-1 rounded ${bar < 10 ? "bg-red-950 border border-red-500 text-red-300 font-bold" : "bg-slate-900 text-emerald-300"}">
                Цил.${idx + 1}: ${bar.toFixed(1)} бар
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <!-- Таблица контактов и распиновки с быстрым подключением щупов (+ / -) -->
      ${comp.pins && comp.pins.length > 0 ? `
        <div>
          <div class="text-[11px] font-bold text-slate-300 mb-1">Распиновка разъёма и связь с ЭБУ (клик или перетаскивание щупа):</div>
          <div class="space-y-1">
            ${comp.pins.map(p => {
              const matchingProbe = window.PROBE_POINTS.find(pp => pp.compId === comp.id && (pp.id.includes(p.symbol.split(" ")[0]) || pp.label.includes(p.symbol.split(" ")[0]))) || window.PROBE_POINTS.find(pp => pp.compId === comp.id);
              const targetPinId = matchingProbe ? matchingProbe.id : "BAT+";
              return `
                <div class="p-1.5 rounded bg-slate-950 border border-slate-800 text-[11px]" data-drop-pin="${targetPinId}">
                  <div class="flex items-center justify-between gap-1">
                    <span class="font-mono font-bold text-amber-300">Пин ${p.pin} [${p.symbol}] <span class="text-slate-400 font-normal">(${p.wireColor})</span> ➔ <span class="text-sky-300">${p.ecuPin}</span></span>
                    <div class="flex gap-1 shrink-0">
                      <button type="button" data-action="probe-red" data-pin="${targetPinId}" class="px-1.5 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold">+Щуп</button>
                      <button type="button" data-action="probe-black" data-pin="${targetPinId}" class="px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold">-Щуп</button>
                    </div>
                  </div>
                  <div class="text-slate-300 text-[10px] mt-0.5">${p.desc}</div>
                  <div class="text-emerald-400 font-mono text-[10px]">Норма V: ${p.normV} | Норма Ω: ${p.normOhm} ${p.sensitive ? " | ⚠️ Слаботочная цепь" : ""}</div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      ` : ""}

      <div class="text-[11px] text-slate-300"><b class="text-slate-400">Методика проверки:</b> ${comp.testMethod}</div>
      <div class="text-[11px] text-slate-300">
        <b class="text-slate-400">Характерные отказы и коды DTC (${comp.dtcs.join(", ") || "Без прямого DTC"}):</b>
        <ul class="list-disc list-inside text-[10px] text-slate-400 mt-0.5">
          ${comp.failures.map(fl => `<li>${fl}</li>`).join("")}
        </ul>
      </div>

      <!-- Операции разборки, замены со склада и ремонта непосредственно из карточки узла -->
      <div class="pt-2 border-t border-slate-800">
        <div class="text-[11px] font-bold text-amber-300 mb-1.5 uppercase">Операции разборки и ремонта узла:</div>
        <div class="flex flex-wrap gap-1.5">
          ${comp.hasConnector ? `
            <button type="button" data-action="toggle-connector" data-comp="${comp.id}"
              class="px-2 py-1 rounded border text-[11px] font-semibold ${compState.connectorPlugged ? "bg-slate-800 border-slate-600 text-slate-200" : "bg-amber-500/20 border-amber-400 text-amber-200"}">
              ${compState.connectorPlugged ? "🔌 Отсоединить разъём" : "🔌 Подсоединить разъём"}
            </button>
          ` : ""}
          ${comp.hasBolts ? `
            <button type="button" data-action="toggle-bolts" data-comp="${comp.id}"
              class="px-2 py-1 rounded border text-[11px] font-semibold ${compState.boltsFastened ? "bg-slate-800 border-slate-600 text-slate-200" : "bg-amber-500/20 border-amber-400 text-amber-200"}">
              ${compState.boltsFastened ? "🔩 Открутить крепёж" : "🔩 Затянуть крепёж"}
            </button>
          ` : ""}
          ${comp.removable ? `
            <button type="button" data-action="toggle-install" data-comp="${comp.id}"
              class="px-2 py-1 rounded border text-[11px] font-semibold ${compState.installed ? "bg-slate-800 border-slate-600 text-slate-200" : "bg-rose-600/30 border-rose-400 text-rose-200"}">
              ${compState.installed ? "🛠 Снять деталь" : "📥 Установить на место"}
            </button>
          ` : ""}
          <button type="button" data-action="replace-part-warehouse" data-comp="${comp.id}"
            class="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] shadow">
            📦 Заменить деталь на новую со склада
          </button>
        </div>
        ${comp.swappableGroup ? `
          <div class="mt-2 flex flex-wrap items-center gap-1">
            <span class="text-[10px] text-sky-300 font-semibold">Переставить с цилиндром:</span>
            ${[1, 2, 3, 4].filter(n => n !== comp.cylinderIndex).map(targetCyl => `
              <button type="button" data-action="swap-parts" data-group="${comp.swappableGroup}" data-cyla="${comp.cylinderIndex}" data-cylb="${targetCyl}"
                class="px-2 py-0.5 rounded bg-sky-800 hover:bg-sky-700 text-white text-[10px] font-semibold">
                Цил. ${comp.cylinderIndex} ↔ Цил. ${targetCyl}
              </button>
            `).join("")}
          </div>
        ` : ""}
      </div>
    </div>

    <!-- Журнал действий и измерений диагноста -->
    <div class="bg-slate-900 border border-slate-700 rounded-lg p-2.5">
      <div class="text-[11px] font-bold text-slate-300 mb-1 uppercase">Журнал диагностики и ремонта:</div>
      <div class="max-h-32 overflow-y-auto space-y-1 text-[10px] font-mono">
        ${s.actionHistory.slice(0, 18).map(item => `
          <div class="text-slate-300 leading-tight">
            <span class="text-slate-500">[${item.time}]</span>
            <span class="${item.type === "warn" || item.type === "fault" ? "text-amber-300" : item.type === "success" || item.type === "repair" ? "text-emerald-300" : "text-sky-300"}">${item.text}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  const quickSel = document.getElementById("comp-quick-select");
  if (quickSel) {
    quickSel.addEventListener("change", (e) => window.selectComponent(e.target.value, true));
  }

  host.querySelectorAll("[data-drop-pin]").forEach(el => {
    el.addEventListener("dragover", (e) => e.preventDefault());
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const color = e.dataTransfer.getData("text/plain");
      const pinId = el.getAttribute("data-drop-pin");
      if ((color === "red" || color === "black") && pinId) {
        window.attachProbe(color, pinId);
      }
    });
  });
};

// Обновление нижней приборной панели и 2-канального осциллографа в реальном времени
window.updateLiveTelemetryAndOscilloscope = function() {
  const s = window.simState;
  if (!s) return;

  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setTxt("tele-state", s.engineState);
  setTxt("tele-rpm", Math.round(s.rpm) + " об/мин");
  setTxt("tele-ect", s.coolantTempC.toFixed(1) + " °C");
  setTxt("tele-volt", s.systemVoltage.toFixed(2) + " В (" + (s.chargingCurrentA >= 0 ? "+" : "") + s.chargingCurrentA.toFixed(1) + " А)");
  setTxt("tele-fuelp", s.fuelPressureBar.toFixed(2) + " бар");
  setTxt("tele-afr", s.afrActual.toFixed(1) + " (STFT " + (s.stftPct >= 0 ? "+" : "") + s.stftPct.toFixed(1) + "%)");
  setTxt("tele-vvt", "Вп " + s.vvtIntakeAngleDeg.toFixed(0) + "° / Вып " + s.vvtExhaustAngleDeg.toFixed(0) + "°");

  const milEl = document.getElementById("lamp-mil");
  if (milEl) milEl.className = "px-2 py-0.5 rounded text-[11px] font-bold border " + (s.checkEngineLight ? "bg-amber-500 text-slate-950 border-amber-300 shadow-[0_0_12px_#f59e0b]" : "bg-slate-900 text-slate-600 border-slate-800");
  const chgEl = document.getElementById("lamp-chg");
  if (chgEl) chgEl.className = "px-2 py-0.5 rounded text-[11px] font-bold border " + (s.chargeWarningLight ? "bg-red-600 text-white border-red-300 shadow-[0_0_12px_#ef4444]" : "bg-slate-900 text-slate-600 border-slate-800");
  const oilEl = document.getElementById("lamp-oil");
  if (oilEl) oilEl.className = "px-2 py-0.5 rounded text-[11px] font-bold border " + (s.oilWarningLight ? "bg-red-600 text-white border-red-300" : "bg-slate-900 text-slate-600 border-slate-800");
  const limpEl = document.getElementById("lamp-limp");
  if (limpEl) limpEl.className = "px-2 py-0.5 rounded text-[11px] font-bold border " + (s.limpHomeMode ? "bg-rose-600 text-white border-rose-300" : "bg-slate-900 text-slate-600 border-slate-800");

  // Отрисовка 2-канального осциллографа, если он открыт
  const oscCanvas = document.getElementById("osc-canvas"); // id="osc-canvas"
  if (oscCanvas && !s.oscPaused) {
    const ctx = oscCanvas.getContext("2d");
    const w = oscCanvas.width;
    const h = oscCanvas.height;
    ctx.fillStyle = "#071118";
    ctx.fillRect(0, 0, w, h);

    // Сетка осциллографа
    ctx.strokeStyle = "#162a3a";
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 29) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += 29) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    const timeSpanSec = 0.08; // 80 мс на экран
    // Канал 1 (Голубой)
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let px = 0; px < w; px++) {
      const t = window.oscTimeAcc + (px / w) * timeSpanSec;
      const v1 = window.sampleOscilloscopeVoltage(s, s.oscCh1Pin, t);
      const scale1 = s.oscCh1Pin.includes("INJ") ? 20.0 : 5.0;
      const py = h * 0.42 - (v1 / scale1) * 24;
      if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Канал 2 (Жёлтый)
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let px = 0; px < w; px++) {
      const t = window.oscTimeAcc + (px / w) * timeSpanSec;
      const v2 = window.sampleOscilloscopeVoltage(s, s.oscCh2Pin, t);
      const scale2 = s.oscCh2Pin.includes("INJ") ? 20.0 : 5.0;
      const py = h * 0.80 - (v2 / scale2) * 20;
      if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
};

window.renderAllPanels = function() {
  const s = window.simState;
  if (!s) return;
  // Подсветка активной вкладки верхнего меню
  document.querySelectorAll("[data-action='set-ui-mode']").forEach(btn => {
    const m = btn.getAttribute("data-uimode");
    if (m === s.uiMode) {
      btn.classList.add("bg-sky-600", "text-white", "border-sky-400");
      btn.classList.remove("bg-slate-900", "text-slate-300");
    } else {
      btn.classList.remove("bg-sky-600", "text-white", "border-sky-400");
      btn.classList.add("bg-slate-900", "text-slate-300");
    }
  });
  // Подсветка выбранного прибора слева
  document.querySelectorAll("[data-action='select-tool']").forEach(btn => {
    const t = btn.getAttribute("data-tool");
    if (t === s.activeTool) {
      btn.classList.add("bg-sky-600", "text-white", "border-sky-400");
      btn.classList.remove("bg-slate-900", "text-slate-300");
    } else {
      btn.classList.remove("bg-sky-600", "text-white", "border-sky-400");
      btn.classList.add("bg-slate-900", "text-slate-300");
    }
  });

  window.renderLeftInstrumentPanel();
  window.renderCenterOverlay();
  window.renderRightPanel();
  window.updateLiveTelemetryAndOscilloscope();
};

// Инициализация приложения и глобального обработчика событий
window.initToyotaEngineLab = function() {
  window.simState = window.createInitialSimState();
  window.loadSimProgress(window.simState);
  window.stepSimulation(window.simState, 0.1);

  window.Engine3DScene.init("three-viewport-container");
  window.renderAllPanels();

  // Делегирование кликов по всем кнопкам управления
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || !window.simState) return;
    const action = btn.getAttribute("data-action");
    if (!action) return;
    const s = window.simState;

    switch (action) {
      case "set-ui-mode":
        window.setUiMode(btn.getAttribute("data-uimode"));
        break;
      case "set-mobile-pane":
        window.setMobilePane(btn.getAttribute("data-pane"));
        break;
      case "download-iphone-html":
        window.downloadStandaloneHtmlForIphone();
        break;
      case "download-github-index":
        window.downloadIndexHtmlForGithub();
        break;
      case "open-github-modal":
        window.toggleGithubModal(true);
        break;
      case "close-github-modal":
        window.toggleGithubModal(false);
        break;
      case "select-tool":
        s.activeTool = btn.getAttribute("data-tool");
        window.renderLeftInstrumentPanel();
        window.renderAllPanels();
        break;
      case "set-dmm-mode":
        s.dmmMode = btn.getAttribute("data-mode");
        window.renderLeftInstrumentPanel();
        break;
      case "set-testlight-type":
        s.testLightType = btn.getAttribute("data-tltype");
        window.renderLeftInstrumentPanel();
        break;
      case "toggle-osc-pause":
        s.oscPaused = !s.oscPaused;
        window.renderLeftInstrumentPanel();
        break;
      case "osc-preset": {
        const p = btn.getAttribute("data-preset");
        if (p === "ckp_cmp") { s.oscCh1Pin = "B31-122_NE+"; s.oscCh2Pin = "B31-99_G2+"; }
        else if (p === "igt_igf") { s.oscCh1Pin = "B31-85_IGT1"; s.oscCh2Pin = "B31-81_IGF1"; }
        else if (p === "inj_af") { s.oscCh1Pin = "B31-108_INJ1"; s.oscCh2Pin = "B31-64_OX1B"; }
        window.renderLeftInstrumentPanel();
        break;
      }
      case "toggle-obd-connect":
        s.obdConnected = !s.obdConnected;
        window.logSimAction(s, "info", s.obdConnected ? "Диагностический сканер подключён к разъёму DLC3 (OBD2)." : "Сканер отключён от DLC3.");
        window.renderLeftInstrumentPanel();
        break;
      case "set-obd-tab":
        s.obdTab = btn.getAttribute("data-tab");
        window.renderLeftInstrumentPanel();
        break;
      case "clear-dtcs":
        s.activeDtcs = [];
        s.FreezeFrame = null;
        window.logSimAction(s, "repair", "Коды неисправностей (DTC) и данные Freeze Frame в памяти ЭБУ стёрты по команде сканера.");
        window.stepSimulation(s, 0.1);
        window.saveSimProgress();
        window.renderAllPanels();
        break;
      case "set-difficulty":
        s.difficulty = btn.getAttribute("data-diff");
        window.saveSimProgress();
        window.renderLeftInstrumentPanel();
        break;
      case "random-fault":
        window.injectFaultScenario(s, null);
        window.saveSimProgress();
        window.renderAllPanels();
        break;
      case "load-specific-fault":
        window.injectFaultScenario(s, [btn.getAttribute("data-faultid")]);
        window.saveSimProgress();
        window.renderAllPanels();
        break;
      case "reset-healthy": {
        const fresh = window.createInitialSimState();
        fresh.uiMode = s.uiMode;
        fresh.difficulty = s.difficulty;
        window.simState = fresh;
        window.saveSimProgress();
        window.renderAllPanels();
        break;
      }
      case "verify-engine":
        window.verifyEngineRepair(s);
        window.renderLeftInstrumentPanel();
        window.renderRightPanel();
        break;
      case "reveal-hint":
        s.faultRevealedHintLevel = Number(btn.getAttribute("data-level"));
        window.saveSimProgress();
        window.renderLeftInstrumentPanel();
        break;
      case "focus-comp": {
        const cid = btn.getAttribute("data-comp");
        s.uiMode = "assembled";
        window.selectComponent(cid, true);
        window.renderAllPanels();
        break;
      }
      case "probe-red":
        window.attachProbe("red", btn.getAttribute("data-pin"));
        break;
      case "probe-black":
        window.attachProbe("black", btn.getAttribute("data-pin"));
        break;
      case "toggle-connector": {
        const cid = btn.getAttribute("data-comp");
        if (s.components[cid]) {
          s.components[cid].connectorPlugged = !s.components[cid].connectorPlugged;
          window.logSimAction(s, "repair", (s.components[cid].connectorPlugged ? "Подключён разъём: " : "Отсоединён разъём: ") + cid);
          window.stepSimulation(s, 0.1);
          window.saveSimProgress();
          window.renderAllPanels();
        }
        break;
      }
      case "toggle-bolts": {
        const cid = btn.getAttribute("data-comp");
        if (s.components[cid]) {
          s.components[cid].boltsFastened = !s.components[cid].boltsFastened;
          window.logSimAction(s, "repair", (s.components[cid].boltsFastened ? "Затянут крепёж узла: " : "Откручен крепёж узла: ") + cid);
          window.stepSimulation(s, 0.1);
          window.saveSimProgress();
          window.renderAllPanels();
        }
        break;
      }
      case "toggle-install": {
        const cid = btn.getAttribute("data-comp");
        if (s.components[cid]) {
          s.components[cid].installed = !s.components[cid].installed;
          if (s.components[cid].installed) {
            s.components[cid].boltsFastened = true;
            s.components[cid].connectorPlugged = true;
          }
          window.logSimAction(s, "repair", (s.components[cid].installed ? "Установлена деталь: " : "Демонтирована деталь: ") + cid);
          window.stepSimulation(s, 0.1);
          window.saveSimProgress();
          window.renderAllPanels();
        }
        break;
      }
      case "replace-part-warehouse": {
        const cid = btn.getAttribute("data-comp");
        if (s.components[cid]) {
          s.components[cid].installed = true;
          s.components[cid].boltsFastened = true;
          s.components[cid].connectorPlugged = true;
          s.components[cid].condition = "good";
          s.components[cid].partSerial = "NEW-OEM-" + Math.floor(1000 + Math.random() * 9000);
          window.logSimAction(s, "repair", "Установлена новая исправная деталь со склада: " + cid + " (Напоминание: если дефект в проводке, замена детали его не устранит!)");
          window.stepSimulation(s, 0.1);
          window.saveSimProgress();
          window.renderAllPanels();
        }
        break;
      }
      case "swap-parts": {
        const grp = btn.getAttribute("data-group");
        const ca = Number(btn.getAttribute("data-cyla"));
        const cb = Number(btn.getAttribute("data-cylb"));
        window.swapCylinderParts(s, grp, ca, cb);
        window.saveSimProgress();
        window.renderAllPanels();
        break;
      }
      case "toggle-fuse-install": {
        const fid = btn.getAttribute("data-fuse");
        if (s.fuses[fid]) {
          s.fuses[fid].installed = !s.fuses[fid].installed;
          window.logSimAction(s, "repair", (s.fuses[fid].installed ? "Установлен предохранитель: " : "Извлечён предохранитель: ") + fid);
          window.stepSimulation(s, 0.1);
          window.saveSimProgress();
          window.renderAllPanels();
        }
        break;
      }
      case "replace-fuse": {
        const fid = btn.getAttribute("data-fuse");
        const rating = Number(btn.getAttribute("data-rating"));
        if (s.fuses[fid]) {
          s.fuses[fid].installed = true;
          s.fuses[fid].blown = false;
          s.fuses[fid].rating = rating;
          window.logSimAction(s, "repair", "Установлен новый предохранитель " + fid + " номиналом " + rating + "A.");
          window.stepSimulation(s, 0.1);
          window.saveSimProgress();
          window.renderAllPanels();
        }
        break;
      }
      case "toggle-relay-install": {
        const rid = btn.getAttribute("data-relay");
        if (s.relays[rid]) {
          s.relays[rid].installed = !s.relays[rid].installed;
          window.stepSimulation(s, 0.1);
          window.saveSimProgress();
          window.renderAllPanels();
        }
        break;
      }
      case "replace-relay": {
        const rid = btn.getAttribute("data-relay");
        if (s.relays[rid]) {
          s.relays[rid].installed = true;
          s.relays[rid].faulty = false;
          window.logSimAction(s, "repair", "Заменено на исправное реле: " + rid);
          window.stepSimulation(s, 0.1);
          window.saveSimProgress();
          window.renderAllPanels();
        }
        break;
      }
      case "repair-single-wire": {
        const pin = btn.getAttribute("data-pin");
        delete s.wireFaults[pin];
        window.logSimAction(s, "repair", "Отремонтирован участок проводки / очищен контакт: " + pin);
        window.stepSimulation(s, 0.1);
        window.saveSimProgress();
        window.renderAllPanels();
        break;
      }
      case "repair-all-wires":
        s.wireFaults = {};
        window.logSimAction(s, "repair", "Восстановлена целостность всех жгутов проводки и зачищены точки массы G1/G2/E1.");
        window.stepSimulation(s, 0.1);
        window.saveSimProgress();
        window.renderAllPanels();
        break;

      // Управление запуском и режимами работы двигателя снизу
      case "key-off":
        s.ignitionKey = "OFF";
        window.logSimAction(s, "info", "Замок зажигания переведён в положение OFF (Двигатель остановлен).");
        window.stepSimulation(s, 0.1);
        window.renderAllPanels();
        break;
      case "key-ig":
        s.ignitionKey = "IG_ON";
        window.logSimAction(s, "info", "Замок зажигания: ВКЛЮЧЕНО ЗАЖИГАНИЕ (IG ON).");
        window.stepSimulation(s, 0.1);
        window.renderAllPanels();
        break;
      case "key-start":
        s.ignitionKey = "START";
        window.logSimAction(s, "info", "Включён стартер (прокрутка коленчатого вала)...");
        window.stepSimulation(s, 0.45);
        window.renderAllPanels();
        setTimeout(() => {
          if (window.simState && window.simState.ignitionKey === "START") {
            window.simState.ignitionKey = "IG_ON";
            window.stepSimulation(window.simState, 0.25);
            window.renderAllPanels();
          }
        }, 900);
        break;
      case "toggle-ac":
        s.acSwitchOn = !s.acSwitchOn;
        window.renderAllPanels();
        break;
      case "toggle-load":
        s.externalLoadActive = !s.externalLoadActive;
        window.renderAllPanels();
        break;
      case "toggle-brake":
        s.brakePedalPressed = !s.brakePedalPressed;
        window.renderAllPanels();
        break;
      case "toggle-mute":
        s.soundMuted = !s.soundMuted;
        window.renderAllPanels();
        break;

      // 3D-управление камерой, разрезом, замедлением и скрытием групп
      case "toggle-cutaway":
        s.cutawayEnabled = !s.cutawayEnabled;
        break;
      case "reset-cam":
        window.Engine3DScene.resetCamera();
        break;
      case "set-slowmo":
        s.slowMotionFactor = Number(btn.getAttribute("data-factor"));
        break;
      case "toggle-hide-group": {
        const g = btn.getAttribute("data-group");
        s.hiddenGroups[g] = !s.hiddenGroups[g];
        break;
      }
    }
  });

  // Делегирование изменений селектов дефектов проводки и ползунков
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (!el || !window.simState) return;
    if (el.getAttribute("data-action") === "set-wire-fault") {
      const pin = el.getAttribute("data-pin");
      const val = el.value;
      if (val === "none") delete window.simState.wireFaults[pin];
      else window.simState.wireFaults[pin] = val;
      window.logSimAction(window.simState, "fault", "Изменено состояние линии " + pin + " -> " + val);
      window.stepSimulation(window.simState, 0.1);
      window.saveSimProgress();
      window.renderAllPanels();
    }
  });

  const throttleSlider = document.getElementById("throttle-slider");
  if (throttleSlider) {
    throttleSlider.addEventListener("input", (e) => {
      window.simState.throttlePedalPct = Number(e.target.value);
      const lbl = document.getElementById("throttle-pct-label");
      if (lbl) lbl.textContent = window.simState.throttlePedalPct + "%";
    });
  }

  const transpSlider = document.getElementById("transparency-slider");
  if (transpSlider) {
    transpSlider.addEventListener("input", (e) => {
      window.simState.transparencyLevel = Number(e.target.value) / 100;
    });
  }

  const searchInput = document.getElementById("comp-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", () => window.renderRightPanel());
  }

  // Главный цикл симуляции и 3D-рендеринга (60 FPS)
  let lastTime = performance.now();
  function mainLoop(now) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    if (window.simState) {
      window.oscTimeAcc += dt * window.simState.slowMotionFactor;
      window.stepSimulation(window.simState, dt);
      window.Engine3DScene.renderTick(window.simState, dt);
      window.EngineAudioSynth.update(window.simState);
      window.updateLiveTelemetryAndOscilloscope();
    }
    requestAnimationFrame(mainLoop);
  }
  requestAnimationFrame(mainLoop);
};

window.addEventListener("load", window.initToyotaEngineLab);

  