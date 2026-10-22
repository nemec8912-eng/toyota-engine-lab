// ============================================================================
// МОДУЛЬ 4: 3D-МОДЕЛЬ ДВИГАТЕЛЯ 1ZR-FE (THREE.JS r128), ДВУХКАНАЛЬНЫЙ
// ОСЦИЛЛОГРАФ (ОСЦИЛЛОГРАММЫ RM04F1RU №1–15), ЭЛЕКТРОСХЕМА И ИНТЕРФЕЙС СТЕНДА
// ============================================================================

window.Engine3DScene = {
  scene: null,
  camera: null,
  renderer: null,
  rootGroup: null,
  meshMap: {},
  animParts: {
    crankshaft: null,
    pistons: [],
    conrods: [],
    camIntake: null,
    camExhaust: null,
    valvesIn: [],
    valvesEx: [],
    fanBlades: null,
    pulleys: [],
    sparkFlashes: []
  },
  camSpherical: { radius: 4.1, theta: -0.45, phi: 1.18 },
  camTarget: { x: 0, y: 0.15, z: 0 },
  desiredCamTarget: { x: 0, y: 0.15, z: 0 },
  isDraggingOrbit: false,
  lastMouse: { x: 0, y: 0 },
  crankAngleRad: 0,

  init(containerId) {
    const container = document.getElementById(containerId);
    if (!container || typeof THREE === "undefined") return;
    container.innerHTML = "";

    const w = container.clientWidth || 800;
    const h = container.clientHeight || 520;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f141c);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(this.renderer.domElement);

    // Освещение моторного стенда
    const amb = new THREE.AmbientLight(0xdbeafe, 0.65);
    this.scene.add(amb);
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
    keyLight.position.set(4, 7, 5);
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x60a5fa, 0.45);
    fillLight.position.set(-5, -2, -4);
    this.scene.add(fillLight);

    // Сетка стенда
    const grid = new THREE.GridHelper(6, 24, 0x334155, 0x1e293b);
    grid.position.y = -1.18;
    this.scene.add(grid);

    this.rootGroup = new THREE.Group();
    this.scene.add(this.rootGroup);

    this.build1ZREngineGeometry();
    this.setupOrbitAndRaycast(container);
    this.updateCameraPosition();

    window.addEventListener("resize", () => {
      if (!container || !this.renderer) return;
      const nw = container.clientWidth || 800;
      const nh = container.clientHeight || 520;
      this.camera.aspect = nw / nh;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(nw, nh);
    });
  },

  mat(color, metalness = 0.45, roughness = 0.4, opacity = 1.0) {
    return new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness,
      transparent: opacity < 1.0,
      opacity
    });
  },

  registerMesh(compId, mesh, groupCategory) {
    mesh.userData.compId = compId;
    mesh.userData.groupCategory = groupCategory || "core";
    mesh.userData.baseColor = mesh.material.color.getHex();
    if (!this.meshMap[compId]) this.meshMap[compId] = [];
    this.meshMap[compId].push(mesh);
    this.rootGroup.add(mesh);
  },

  build1ZREngineGeometry() {
    this.meshMap = {};
    this.animParts = { crankshaft: null, pistons: [], conrods: [], camIntake: null, camExhaust: null, valvesIn: [], valvesEx: [], fanBlades: null, pulleys: [], sparkFlashes: [] };

    // 1. Блок цилиндров 1ZR-FE (алюминиевый сплав) и масляный поддон
    const blockGeo = new THREE.BoxGeometry(1.36, 0.85, 0.68);
    const blockMesh = new THREE.Mesh(blockGeo, this.mat(0x64748b, 0.6, 0.35));
    blockMesh.position.set(0, -0.22, 0);
    this.registerMesh("block_crank_pistons", blockMesh, "shell");

    const panGeo = new THREE.BoxGeometry(1.32, 0.32, 0.64);
    const panMesh = new THREE.Mesh(panGeo, this.mat(0x1e293b, 0.5, 0.5));
    panMesh.position.set(0, -0.80, 0);
    this.registerMesh("block_crank_pistons", panMesh, "shell");

    // 2. Головка блока цилиндров (ГБЦ 16V DOHC) и клапанная крышка
    const headGeo = new THREE.BoxGeometry(1.36, 0.46, 0.72);
    const headMesh = new THREE.Mesh(headGeo, this.mat(0x94a3b8, 0.55, 0.35));
    headMesh.position.set(0, 0.44, 0);
    this.registerMesh("head_valvetrain_timing", headMesh, "shell");

    const coverGeo = new THREE.BoxGeometry(1.34, 0.22, 0.70);
    const coverMesh = new THREE.Mesh(coverGeo, this.mat(0x1f2937, 0.3, 0.55));
    coverMesh.position.set(0, 0.78, 0);
    this.registerMesh("head_valvetrain_timing", coverMesh, "valve_cover");

    // 3. КШМ: Коленвал с ротором 36-2, 4 шатуна и 4 поршня (порядок работы 1-3-4-2: углы КВ 0°, 180°, 180°, 0°)
    const crankGroup = new THREE.Group();
    crankGroup.position.set(0, -0.52, 0);
    const mainJournal = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.48, 20), this.mat(0xd97706, 0.8, 0.25));
    mainJournal.rotation.z = Math.PI / 2;
    crankGroup.add(mainJournal);

    // Задающий диск ДПКВ 36-2 на заднем конце коленвала
    const reluctor = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.03, 34), this.mat(0xf59e0b, 0.85, 0.2));
    reluctor.rotation.z = Math.PI / 2;
    reluctor.position.x = 0.58;
    crankGroup.add(reluctor);
    this.rootGroup.add(crankGroup);
    this.animParts.crankshaft = crankGroup;

    const cylX = [-0.48, -0.16, 0.16, 0.48];
    const phaseOffsets = [0, Math.PI, Math.PI, 0]; // 1 и 4 в фазе, 2 и 3 в противофазе
    for (let i = 0; i < 4; i++) {
      const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.16, 24), this.mat(0xe2e8f0, 0.85, 0.2));
      piston.position.set(cylX[i], -0.15, 0);
      piston.userData.compId = "block_crank_pistons";
      piston.userData.phase = phaseOffsets[i];
      this.rootGroup.add(piston);
      this.animParts.pistons.push(piston);

      const rod = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.34, 0.04), this.mat(0x94a3b8, 0.75, 0.3));
      rod.position.set(cylX[i], -0.34, 0);
      rod.userData.compId = "block_crank_pistons";
      this.rootGroup.add(rod);
      this.animParts.conrods.push(rod);
    }

    // 4. Распредвалы впуска и выпуска с муфтами Dual VVT-i и цепь ГРМ
    const camInGroup = new THREE.Group();
    camInGroup.position.set(0, 0.60, 0.20);
    const camInShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.38, 16), this.mat(0x38bdf8, 0.7, 0.25));
    camInShaft.rotation.z = Math.PI / 2;
    const vvtInPhaser = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 20), this.mat(0x0284c7, 0.8, 0.2));
    vvtInPhaser.rotation.z = Math.PI / 2;
    vvtInPhaser.position.x = -0.70;
    camInGroup.add(camInShaft, vvtInPhaser);
    this.rootGroup.add(camInGroup);
    this.animParts.camIntake = camInGroup;

    const camExGroup = new THREE.Group();
    camExGroup.position.set(0, 0.60, -0.20);
    const camExShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.38, 16), this.mat(0xfb923c, 0.7, 0.25));
    camExShaft.rotation.z = Math.PI / 2;
    const vvtExPhaser = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 20), this.mat(0xea580c, 0.8, 0.2));
    vvtExPhaser.rotation.z = Math.PI / 2;
    vvtExPhaser.position.x = -0.70;
    camExGroup.add(camExShaft, vvtExPhaser);
    this.rootGroup.add(camExGroup);
    this.animParts.camExhaust = camExGroup;

    // Цепь ГРМ (слева X = -0.72)
    const chainMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.24, 0.52), this.mat(0x475569, 0.8, 0.3));
    chainMesh.position.set(-0.72, 0.04, 0);
    this.registerMesh("head_valvetrain_timing", chainMesh, "core");

    // 5. Индивидуальные катушки зажигания B26–B29 и свечи 1–4
    for (let i = 0; i < 4; i++) {
      const cid = "coil_" + (i + 1);
      const sid = "spark_" + (i + 1);
      const coilMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.28, 16), this.mat(0x111827, 0.3, 0.4));
      coilMesh.position.set(cylX[i], 0.98, 0);
      this.registerMesh(cid, coilMesh, "core");

      const coilCap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.14), this.mat(0x2563eb, 0.4, 0.4));
      coilCap.position.set(cylX[i], 1.12, 0);
      this.registerMesh(cid, coilCap, "core");

      const sparkMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 12), this.mat(0xf8fafc, 0.2, 0.2));
      sparkMesh.position.set(cylX[i], 0.72, 0);
      this.registerMesh(sid, sparkMesh, "core");
    }

    // 6. Топливная рампа и форсунки №1–4
    const railMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1.22, 16), this.mat(0xcbd5e1, 0.8, 0.2));
    railMesh.rotation.z = Math.PI / 2;
    railMesh.position.set(0, 0.70, 0.38);
    this.registerMesh("intake_manifold_pcv", railMesh, "intake");

    for (let i = 0; i < 4; i++) {
      const iid = "inj_" + (i + 1);
      const injMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.024, 0.16, 14), this.mat(0x0ea5e9, 0.5, 0.3));
      injMesh.rotation.x = -0.35;
      injMesh.position.set(cylX[i], 0.62, 0.35);
      this.registerMesh(iid, injMesh, "core");
    }

    // 7. Впускной коллектор, электронный дроссель ETCS-i, ДМРВ и воздушный фильтр
    const intakeMesh = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.42, 0.32), this.mat(0x1e293b, 0.25, 0.6));
    intakeMesh.position.set(0, 0.28, 0.54);
    this.registerMesh("intake_manifold_pcv", intakeMesh, "intake");

    const throttleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.16, 20), this.mat(0x94a3b8, 0.7, 0.3));
    throttleMesh.rotation.z = Math.PI / 2;
    throttleMesh.position.set(-0.82, 0.50, 0.45);
    this.registerMesh("throttle_body", throttleMesh, "intake");

    const tpsCap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.16), this.mat(0x0f172a, 0.3, 0.5));
    tpsCap.position.set(-0.86, 0.56, 0.54);
    this.registerMesh("tps_sensor", tpsCap, "intake");

    const airboxMesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.42), this.mat(0x111827, 0.2, 0.7));
    airboxMesh.position.set(-1.45, 0.58, 0.65);
    this.registerMesh("maf_sensor", airboxMesh, "intake");

    const mafPlug = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), this.mat(0xf59e0b, 0.5, 0.3));
    mafPlug.position.set(-1.22, 0.68, 0.62);
    this.registerMesh("maf_sensor", mafPlug, "intake");

    // 8. Выпускной коллектор, катализатор и датчики состава смеси B1S1 (A/F) и B1S2 (HO2S)
    const exhaustMesh = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.34, 0.26), this.mat(0x78350f, 0.6, 0.55));
    exhaustMesh.position.set(0, 0.26, -0.52);
    this.registerMesh("exhaust_catalyst", exhaustMesh, "exhaust");

    const catMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.52, 20), this.mat(0x9ca3af, 0.65, 0.4));
    catMesh.position.set(0.18, -0.25, -0.78);
    this.registerMesh("exhaust_catalyst", catMesh, "exhaust");

    const afMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.16, 12), this.mat(0x22c55e, 0.6, 0.3));
    afMesh.rotation.x = Math.PI / 3;
    afMesh.position.set(0.12, 0.14, -0.68);
    this.registerMesh("af_sensor_b1s1", afMesh, "exhaust");

    const ho2sMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.16, 12), this.mat(0x10b981, 0.6, 0.3));
    ho2sMesh.rotation.x = Math.PI / 3;
    ho2sMesh.position.set(0.28, -0.55, -0.92);
    this.registerMesh("ho2s_b1s2", ho2sMesh, "exhaust");

    // 9. Датчики ДПКВ, ДПРВ Впуск/Выпуск, Клапаны OCV, ДТОЖ, Детонация, EVAP
    const ckpMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 14), this.mat(0xef4444, 0.5, 0.3));
    ckpMesh.position.set(0.45, -0.62, -0.42);
    this.registerMesh("ckp_sensor", ckpMesh, "core");

    const cmpInMesh = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.10), this.mat(0x38bdf8, 0.5, 0.3));
    cmpInMesh.position.set(-0.55, 0.88, 0.36);
    this.registerMesh("cmp_intake", cmpInMesh, "core");

    const cmpExMesh = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.10), this.mat(0xf97316, 0.5, 0.3));
    cmpExMesh.position.set(-0.55, 0.88, -0.36);
    this.registerMesh("cmp_exhaust", cmpExMesh, "core");

    const ocvInMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.18, 14), this.mat(0x06b6d4, 0.7, 0.25));
    ocvInMesh.rotation.z = Math.PI / 2;
    ocvInMesh.position.set(-0.72, 0.74, 0.32);
    this.registerMesh("ocv_intake", ocvInMesh, "core");

    const ocvExMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.18, 14), this.mat(0xea580c, 0.7, 0.25));
    ocvExMesh.rotation.z = Math.PI / 2;
    ocvExMesh.position.set(-0.72, 0.74, -0.32);
    this.registerMesh("ocv_exhaust", ocvExMesh, "core");

    const ectMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.15, 14), this.mat(0xeab308, 0.6, 0.3));
    ectMesh.rotation.z = Math.PI / 2;
    ectMesh.position.set(0.72, 0.48, 0.15);
    this.registerMesh("ect_sensor", ectMesh, "core");

    const knockMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 16), this.mat(0xa855f7, 0.5, 0.3));
    knockMesh.rotation.x = Math.PI / 2;
    knockMesh.position.set(0.0, -0.15, 0.38);
    this.registerMesh("knock_sensor", knockMesh, "core");

    const evapMesh = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), this.mat(0x14b8a6, 0.4, 0.4));
    evapMesh.position.set(-0.62, 0.72, 0.56);
    this.registerMesh("evap_purge_vsv", evapMesh, "intake");

    // 10. Навесное: Генератор, Стартер, Помпа и термостат, Радиатор и Вентилятор
    const altMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 20), this.mat(0x94a3b8, 0.75, 0.25));
    altMesh.rotation.z = Math.PI / 2;
    altMesh.position.set(-0.98, 0.15, -0.45);
    this.registerMesh("alternator", altMesh, "accessories");

    const starterMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.36, 18), this.mat(0x334155, 0.65, 0.35));
    starterMesh.rotation.z = Math.PI / 2;
    starterMesh.position.set(0.55, -0.48, 0.44);
    this.registerMesh("starter", starterMesh, "accessories");

    const wpMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 18), this.mat(0x64748b, 0.7, 0.3));
    wpMesh.rotation.z = Math.PI / 2;
    wpMesh.position.set(-0.90, -0.10, 0.32);
    this.registerMesh("thermostat_water_pump", wpMesh, "accessories");

    const radMesh = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.88, 0.10), this.mat(0x334155, 0.6, 0.45));
    radMesh.position.set(0, -0.05, -1.42);
    this.registerMesh("thermostat_water_pump", radMesh, "accessories");

    const fanGroup = new THREE.Group();
    fanGroup.position.set(0, -0.05, -1.32);
    const fanHub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 16), this.mat(0x0f172a, 0.4, 0.5));
    fanHub.rotation.x = Math.PI / 2;
    fanGroup.add(fanHub);
    for (let b = 0; b < 5; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.02), this.mat(0x38bdf8, 0.4, 0.4));
      blade.rotation.z = (b * Math.PI * 2) / 5;
      fanGroup.add(blade);
    }
    this.registerMesh("cooling_fan", fanHub, "accessories");
    this.rootGroup.add(fanGroup);
    this.animParts.fanBlades = fanGroup;

    // 11. АКБ, ЭБУ (ECM A50/B31), Блок предохранителей и реле, Точки массы, Вынесенная секция стенда (Педали, OBD2, Бензонасос)
    const batMesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.38, 0.32), this.mat(0x1e3a8a, 0.3, 0.5));
    batMesh.position.set(-1.55, 0.15, -0.38);
    this.registerMesh("battery", batMesh, "harness");

    const ecmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.38), this.mat(0xcbd5e1, 0.8, 0.25));
    ecmMesh.position.set(-1.48, 0.45, 0.12);
    this.registerMesh("ecm", ecmMesh, "harness");

    const fuseBoxMesh = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.26, 0.48), this.mat(0x0f172a, 0.25, 0.6));
    fuseBoxMesh.position.set(-1.55, 0.12, 0.45);
    this.registerMesh("fuse_relay_box", fuseBoxMesh, "harness");

    const gndMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 16), this.mat(0xfacc15, 0.85, 0.2));
    gndMesh.position.set(-0.92, -0.45, -0.12);
    this.registerMesh("ground_points", gndMesh, "harness");

    // Вынесенная стойка стенда (справа X = +1.55): Педаль газа APP, Тормоз STP, Вход SPD, Разъём DLC3 OBD2, Модуль бензонасоса
    const appMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, 0.12), this.mat(0x475569, 0.5, 0.4));
    appMesh.position.set(1.55, -0.25, 0.85);
    this.registerMesh("app_sensor", appMesh, "harness");

    const stopMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.12), this.mat(0xdc2626, 0.5, 0.4));
    stopMesh.position.set(1.55, -0.25, 0.48);
    this.registerMesh("stop_switch", stopMesh, "harness");

    const spdMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.16), this.mat(0x8b5cf6, 0.5, 0.4));
    spdMesh.position.set(1.55, -0.25, 0.12);
    this.registerMesh("spd_input", spdMesh, "harness");

    const obdMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.18), this.mat(0xffffff, 0.3, 0.3));
    obdMesh.position.set(1.55, -0.25, -0.32);
    this.registerMesh("dlc3_obd", obdMesh, "harness");

    const fpTankMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.42, 20), this.mat(0x0284c7, 0.45, 0.35));
    fpTankMesh.position.set(1.55, -0.68, -0.82);
    this.registerMesh("fuel_pump", fpTankMesh, "harness");
  },

  setupOrbitAndRaycast(container) {
    const dom = this.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let downPos = { x: 0, y: 0 };

    dom.addEventListener("pointerdown", (e) => {
      this.isDraggingOrbit = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      downPos = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener("pointermove", (e) => {
      if (!this.isDraggingOrbit) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.camSpherical.theta -= dx * 0.0075;
      this.camSpherical.phi = Math.max(0.25, Math.min(Math.PI - 0.25, this.camSpherical.phi - dy * 0.0075));
      this.updateCameraPosition();
    });

    window.addEventListener("pointerup", (e) => {
      if (!this.isDraggingOrbit) return;
      this.isDraggingOrbit = false;
      const moveDist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      if (moveDist < 6) {
        const rect = dom.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, this.camera);
        const allMeshes = [];
        Object.values(this.meshMap).forEach(arr => arr.forEach(m => { if (m.visible) allMeshes.push(m); }));
        const hits = raycaster.intersectObjects(allMeshes, false);
        if (hits.length > 0 && hits[0].object.userData.compId) {
          window.selectComponent(hits[0].object.userData.compId, false);
        }
      }
    });

    
    // Поддержка жеста двумя пальцами (Pinch-to-Zoom) на iPhone / iOS Safari
    let lastPinchDist = 0;
    dom.addEventListener("touchstart", (e) => {
      if (e.touches && e.touches.length === 2) {
        this.isDraggingOrbit = false;
        lastPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });
    dom.addEventListener("touchmove", (e) => {
      if (e.touches && e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (lastPinchDist > 0) {
          const delta = lastPinchDist - dist;
          this.camSpherical.radius = Math.max(1.5, Math.min(8.0, this.camSpherical.radius + delta * 0.012));
          this.updateCameraPosition();
        }
        lastPinchDist = dist;
      }
    }, { passive: false });

    dom.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.camSpherical.radius = Math.max(1.5, Math.min(8.0, this.camSpherical.radius + e.deltaY * 0.0025));
      this.updateCameraPosition();
    }, { passive: false });
  },

  focusComponent(compId) {
    const reg = window.COMPONENT_REGISTRY.find(c => c.id === compId);
    if (!reg || !reg.pos3d) return;
    this.desiredCamTarget = { x: reg.pos3d[0], y: reg.pos3d[1], z: reg.pos3d[2] };
    this.camSpherical.radius = 2.35;
  },

  resetCamera() {
    this.desiredCamTarget = { x: 0, y: 0.15, z: 0 };
    this.camSpherical = { radius: 4.1, theta: -0.45, phi: 1.18 };
    this.updateCameraPosition();
  },

  updateCameraPosition() {
    if (!this.camera) return;
    const r = this.camSpherical.radius;
    const sinPhi = Math.sin(this.camSpherical.phi);
    this.camera.position.set(
      this.camTarget.x + r * sinPhi * Math.sin(this.camSpherical.theta),
      this.camTarget.y + r * Math.cos(this.camSpherical.phi),
      this.camTarget.z + r * sinPhi * Math.cos(this.camSpherical.theta)
    );
    this.camera.lookAt(this.camTarget.x, this.camTarget.y, this.camTarget.z);
  },

  renderTick(state, dt) {
    if (!this.renderer || !this.scene || !this.camera) return;

    // Плавное наведение камеры
    this.camTarget.x += (this.desiredCamTarget.x - this.camTarget.x) * 0.12;
    this.camTarget.y += (this.desiredCamTarget.y - this.camTarget.y) * 0.12;
    this.camTarget.z += (this.desiredCamTarget.z - this.camTarget.z) * 0.12;
    this.updateCameraPosition();

    // Вращение КШМ и ГРМ с учётом slowMotionFactor
    const angularVel = (state.rpm / 60) * Math.PI * 2 * state.slowMotionFactor;
    this.crankAngleRad = (this.crankAngleRad + angularVel * dt) % (Math.PI * 4);

    if (this.animParts.crankshaft) {
      this.animParts.crankshaft.rotation.x = this.crankAngleRad;
    }
    if (this.animParts.camIntake) {
      this.animParts.camIntake.rotation.x = this.crankAngleRad * 0.5 + (state.vvtIntakeAngleDeg * Math.PI / 180);
    }
    if (this.animParts.camExhaust) {
      this.animParts.camExhaust.rotation.x = this.crankAngleRad * 0.5 - (state.vvtExhaustAngleDeg * Math.PI / 180);
    }
    this.animParts.pistons.forEach((p, idx) => {
      const strokeY = Math.cos(this.crankAngleRad + p.userData.phase) * 0.14;
      p.position.y = -0.14 + strokeY;
      if (this.animParts.conrods[idx]) {
        this.animParts.conrods[idx].position.y = -0.34 + strokeY * 0.6;
        this.animParts.conrods[idx].rotation.x = Math.sin(this.crankAngleRad + p.userData.phase) * 0.18;
      }
    });
    if (this.animParts.fanBlades && state.coolingFanRunning) {
      this.animParts.fanBlades.rotation.z += dt * 18.0 * state.slowMotionFactor;
    }

    // Обновление прозрачности, разреза, скрытия групп и подсветки выбранного узла
    const shellOpacity = state.cutawayEnabled ? 0.22 : (1.0 - state.transparencyLevel);
    Object.keys(this.meshMap).forEach(cid => {
      const compState = state.components[cid];
      const isSelected = state.selectedComponentId === cid;
      this.meshMap[cid].forEach(mesh => {
        const gCat = mesh.userData.groupCategory;
        const hiddenByGroup = state.hiddenGroups[gCat] === true;
        const removedPart = compState && !compState.installed;
        mesh.visible = !hiddenByGroup && !removedPart;

        if (gCat === "shell" || gCat === "valve_cover") {
          mesh.material.transparent = shellOpacity < 0.99;
          mesh.material.opacity = shellOpacity;
        }
        if (isSelected) {
          mesh.material.emissive = new THREE.Color(0x0284c7);
          mesh.material.emissiveIntensity = 0.55;
        } else if (compState && (!compState.connectorPlugged || !compState.boltsFastened)) {
          mesh.material.emissive = new THREE.Color(0xd97706);
          mesh.material.emissiveIntensity = 0.35;
        } else {
          mesh.material.emissive = new THREE.Color(0x000000);
          mesh.material.emissiveIntensity = 0;
        }
      });
    });

    this.renderer.render(this.scene, this.camera);
  }
};

// Генератор осциллограмм RM04F1RU (№1–15) на двухканальном осциллографе
window.sampleOscilloscopeVoltage = function(state, pinId, timeSec) {
  const f = state.fuses;
  const c = state.components;
  const wf = state.wireFaults;
  const isCompOk = (id) => c[id] && c[id].installed && c[id].connectorPlugged && c[id].boltsFastened && c[id].condition === "good";
  const wfOf = (p) => wf[p] || "none";

  if (wfOf(pinId) === "open") return 0.0;
  if (wfOf(pinId) === "short_gnd") return 0.0;

  const rpm = state.rpm;
  const freqRev = Math.max(0.5, rpm / 60.0);
  const angleDeg = ((timeSec * freqRev * 360.0) % 720.0 + 720.0) % 720.0;
  const crankDeg = angleDeg % 360.0;

  switch (pinId) {
    // Осциллограмма №2: ДПКВ 36-2 (34 зуба + пропуск 2 зубьев)
    case "B31-122_NE+": {
      if (rpm < 30 || !isCompOk("ckp_sensor")) return 0.0;
      const toothIdx = Math.floor(crankDeg / 10.0); // 36 секторов по 10 градусов
      if (toothIdx >= 34) return 0.0; // Пропуск 2 зубьев (36-2)!
      const amp = Math.min(14.0, 2.2 + rpm * 0.0025);
      return Math.sin((crankDeg / 10.0) * Math.PI * 2) * amp;
    }
    // Осциллограмма №2: ДПРВ Впуск G2+ и Выпуск EV1+ (3 зубца за 720° КВ; при перескоке цепи смещение +18°)
    case "B31-99_G2+":
    case "B31-76_EV1+": {
      const compId = pinId === "B31-99_G2+" ? "cmp_intake" : "cmp_exhaust";
      if (!isCompOk(compId)) return 0.0;
      if (rpm < 30) return 4.8;
      const chainShift = c.head_valvetrain_timing.condition === "degraded" ? 22.0 : 0.0;
      const a = (angleDeg - chainShift + 720.0) % 720.0;
      const pulse = (a > 40 && a < 110) || (a > 260 && a < 350) || (a > 500 && a < 560);
      return pulse ? 4.85 : 0.15;
    }
    // Осциллограмма №1: Сигналы зажигания IGT1..4 и подтверждения IGF1 (2 В/дел., 20 мс/дел.)
    case "B31-85_IGT1":
    case "B31-84_IGT2":
    case "B31-83_IGT3":
    case "B31-82_IGT4": {
      if (rpm < 30) return 0.0;
      const idx = Number(pinId.slice(-1));
      const fireCenters = { 1: 90, 3: 270, 4: 450, 2: 630 };
      const center = fireCenters[idx] || 90;
      return Math.abs(angleDeg - center) < 16 ? 4.9 : 0.1;
    }
    case "B31-81_IGF1": {
      if (rpm < 30) return 4.9;
      const centers = [
        { cyl: 1, deg: 96 },
        { cyl: 3, deg: 276 },
        { cyl: 4, deg: 456 },
        { cyl: 2, deg: 636 }
      ];
      for (const item of centers) {
        if (Math.abs(angleDeg - item.deg) < 10) {
          // Если катушка данного цилиндра мертва — импульс подтверждения IGF пропадает!
          if (!isCompOk("coil_" + item.cyl)) return 4.9;
          return 0.2;
        }
      }
      return 4.9;
    }
    // Осциллограмма №3: Форсунки #10..#40 (20 В/дел., 20 мс/дел. — импульс в 0 В + индуктивный пик до 58 В)
    case "B31-108_INJ1":
    case "B31-107_INJ2":
    case "B31-106_INJ3":
    case "B31-105_INJ4": {
      const idx = Number(pinId.slice(-1));
      if (!isCompOk("inj_" + idx)) return 0.0;
      if (rpm < 30) return state.systemVoltage;
      const centers = { 1: 45, 3: 225, 4: 405, 2: 585 };
      const diff = angleDeg - centers[idx];
      if (diff >= 0 && diff < 18) return 0.2; // Открытие форсунки на массу
      if (diff >= 18 && diff < 23) return 56.0; // Индуктивный пик закрытия
      return state.systemVoltage;
    }
    // Осциллограмма №4/5: Задний кислородный датчик OX1B (0.1–0.85 В)
    case "B31-64_OX1B":
      if (!isCompOk("ho2s_b1s2")) return 0.0;
      return rpm > 300 ? (0.48 + Math.sin(timeSec * 4.5) * 0.34) : 0.45;
    // Осциллограмма №5/6: Датчик детонации KNK1
    case "B31-110_KNK1":
      if (!isCompOk("knock_sensor")) return 4.95;
      return 2.50 + (rpm > 300 ? Math.sin(timeSec * 850) * Math.cos(timeSec * 190) * 0.85 : 0.0);
    // Осциллограммы №7/8/11/14/15: ШИМ дросселя M+/M-, клапанов VVT-i OC1+/OE1+ и подогревателя HA1A
    case "B31-42_M+":
    case "B31-100_OC1+":
    case "B31-60_OE1+":
    case "B31-109_HA1A": {
      if (rpm < 30) return 0.0;
      const pwmPhase = (timeSec * 250) % 1.0;
      return pwmPhase < 0.38 ? state.systemVoltage : 0.2;
    }
    // Осциллограммы №12 и №13: Шина CANH и CANL
    case "DLC3-6_CANH": {
      const bit = Math.sin(timeSec * 1200) > 0;
      return bit ? 3.5 : 2.5;
    }
    case "DLC3-14_CANL": {
      const bit = Math.sin(timeSec * 1200) > 0;
      return bit ? 1.5 : 2.5;
    }
    default:
      return window.getPinElectricalState(state, pinId).dcV;
  }
};
