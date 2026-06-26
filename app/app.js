import {
  initDb,
  createAnalysis,
  updateAnalysis,
  upsertMeasurement,
  clearAll,
  getAnalysis,
  getAnalysisWheels,
  listAnalyses,
  countAnalyses
} from "./db.js";

const DEFAULT_CONFIG = {
  bridgeUrl: "ws://localhost:8765",
  namePrefix: "FACOM_SCANDIAG_",
  serviceUuid: "",
  characteristicUuid: ""
};

// Roues, dans l'ordre d'affichage du plan vu de dessus.
const WHEELS = [
  { code: "FL", label: "Av. gauche", short: "Av. G" },
  { code: "FR", label: "Av. droite", short: "Av. D" },
  { code: "RL", label: "Ar. gauche", short: "Ar. G" },
  { code: "RR", label: "Ar. droite", short: "Ar. D" }
];
const WHEEL_CODES = WHEELS.map(w => w.code);

const DEFAULT_SCANNERS = [
  { id: "SC1", wheel: "FL" },
  { id: "SC2", wheel: "FR" },
  { id: "SC3", wheel: "RL" },
  { id: "SC4", wheel: "RR" }
];

const THRESHOLDS = {
  tireCritical: 3,
  tireWarning: 4,
  diskCritical: 1.5,
  diskWarning: 1.8
};

const STATUS_RANK = { CONFORME: 0, VIGILANCE: 1, CRITIQUE: 2 };

const STATUS_CHIP_LABELS = {
  idle: "En attente",
  ready: "Prêt au scan",
  CONFORME: "Conforme",
  VIGILANCE: "Vigilance",
  CRITIQUE: "Critique"
};

const PLATE_PATTERN = /^[A-Z]{2}-\d{3}-[A-Z]{2}$/;
const PAGE_SIZE = 8;

const state = {
  device: null,
  characteristic: null,
  bridgeSocket: null,
  simulationIndex: 0,
  activePlate: null,
  currentAnalysisId: null,
  scanners: [],
  wheels: emptyWheels(),
  view: "measure",
  dash: { search: "", status: "", sortKey: "updated_at", sortDir: "desc", page: 1 }
};

function emptyWheels() {
  return Object.fromEntries(WHEEL_CODES.map(code => [code, null]));
}

const elements = {
  scanCard: document.querySelector("#scanCard"),
  scannerDot: document.querySelector("#scannerDot"),
  scannerLabel: document.querySelector("#scannerLabel"),
  alertPanel: document.querySelector("#alertPanel"),
  alertTitle: document.querySelector("#alertTitle"),
  alertText: document.querySelector("#alertText"),
  statusChip: document.querySelector("#statusChip"),
  currentPlate: document.querySelector("#currentPlate"),
  connectionStatus: document.querySelector("#connectionStatus"),
  connectionStatusMirror: document.querySelector("#connectionStatusMirror"),
  wheelCount: document.querySelector("#wheelCount"),
  lastScan: document.querySelector("#lastScan"),
  connectButton: document.querySelector("#connectButton"),
  simulateButton: document.querySelector("#simulateButton"),
  disconnectButton: document.querySelector("#disconnectButton"),
  clearButton: document.querySelector("#clearButton"),
  configForm: document.querySelector("#configForm"),
  bridgeUrl: document.querySelector("#bridgeUrl"),
  namePrefix: document.querySelector("#namePrefix"),
  serviceUuid: document.querySelector("#serviceUuid"),
  characteristicUuid: document.querySelector("#characteristicUuid"),
  scannerRows: document.querySelector("#scannerRows"),
  addScannerButton: document.querySelector("#addScannerButton"),
  plateGate: document.querySelector("#plateGate"),
  plateForm: document.querySelector("#plateForm"),
  plateInput: document.querySelector("#plateInput"),
  plateError: document.querySelector("#plateError"),
  changeVehicleButton: document.querySelector("#changeVehicleButton"),
  viewMeasure: document.querySelector("#viewMeasure"),
  viewDashboard: document.querySelector("#viewDashboard"),
  viewTabs: [...document.querySelectorAll(".view-tab")],
  dashSearch: document.querySelector("#dashSearch"),
  dashStatus: document.querySelector("#dashStatus"),
  dashRows: document.querySelector("#dashRows"),
  dashPrev: document.querySelector("#dashPrev"),
  dashNext: document.querySelector("#dashNext"),
  dashPageInfo: document.querySelector("#dashPageInfo"),
  sortButtons: [...document.querySelectorAll(".th-sort")],
  detailOverlay: document.querySelector("#detailOverlay"),
  detailPlate: document.querySelector("#detailPlate"),
  detailTime: document.querySelector("#detailTime"),
  detailChip: document.querySelector("#detailChip"),
  detailClose: document.querySelector("#detailClose")
};

loadConfig();
loadScanners();
renderScannerRows();
openPlateGate();
render();

initDb()
  .then(() => {
    render();
    if (state.view === "dashboard") {
      renderDashboard();
    }
  })
  .catch(error => {
    console.warn("SQLite indisponible, historique non persistant", error);
    setConnection("Historique non persistant");
  });

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js").catch(() => undefined);
}

elements.connectButton.addEventListener("click", connectBridge);
elements.simulateButton.addEventListener("click", simulateScan);
elements.disconnectButton.addEventListener("click", disconnect);
elements.clearButton.addEventListener("click", clearHistory);
elements.changeVehicleButton.addEventListener("click", openPlateGate);
elements.addScannerButton.addEventListener("click", addScanner);

elements.plateForm.addEventListener("submit", event => {
  event.preventDefault();
  submitPlate();
});

elements.plateInput.addEventListener("input", () => {
  elements.plateInput.value = formatPlate(elements.plateInput.value);
  elements.plateError.hidden = true;
});

elements.configForm.addEventListener("submit", event => {
  event.preventDefault();
  saveConfig(getConfig());
  setConnection("Configuration BLE sauvegardée");
});

// --- Navigation entre vues ---

for (const tab of elements.viewTabs) {
  tab.addEventListener("click", () => setView(tab.dataset.view));
}

elements.dashSearch.addEventListener("input", () => {
  state.dash.search = elements.dashSearch.value.trim();
  state.dash.page = 1;
  renderDashboard();
});

elements.dashStatus.addEventListener("change", () => {
  state.dash.status = elements.dashStatus.value;
  state.dash.page = 1;
  renderDashboard();
});

for (const button of elements.sortButtons) {
  button.addEventListener("click", () => toggleSort(button.dataset.sort));
}

elements.dashPrev.addEventListener("click", () => changePage(-1));
elements.dashNext.addEventListener("click", () => changePage(1));
elements.detailClose.addEventListener("click", closeDetail);
elements.detailOverlay.addEventListener("click", event => {
  if (event.target === elements.detailOverlay) {
    closeDetail();
  }
});

function setView(view) {
  state.view = view;
  const isMeasure = view === "measure";
  elements.viewMeasure.hidden = !isMeasure;
  elements.viewDashboard.hidden = isMeasure;
  for (const tab of elements.viewTabs) {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  }
  if (!isMeasure) {
    renderDashboard();
  }
}

// --- Plaque ---

// Insertion auto des tirets au format SIV : 2 lettres, 3 chiffres, 2 lettres.
function formatPlate(raw) {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
  const parts = [compact.slice(0, 2), compact.slice(2, 5), compact.slice(5, 7)];
  return parts.filter(Boolean).join("-");
}

function openPlateGate() {
  elements.plateError.hidden = true;
  elements.plateInput.value = state.activePlate || "";
  elements.plateGate.classList.add("visible");
  setScanControls(false);
  requestAnimationFrame(() => elements.plateInput.focus());
}

function submitPlate() {
  const plate = formatPlate(elements.plateInput.value);

  if (!PLATE_PATTERN.test(plate)) {
    elements.plateError.hidden = false;
    elements.plateInput.focus();
    return;
  }

  // Nouvelle selection = nouvelle analyse (creee a la premiere mesure).
  state.activePlate = plate;
  state.wheels = emptyWheels();
  state.currentAnalysisId = null;
  elements.plateGate.classList.remove("visible");
  setView("measure");
  setScanControls(true);
  setConnection(`Véhicule ${plate} prêt au scan`);
  render();
}

function setScanControls(enabled) {
  elements.connectButton.disabled = !enabled;
  elements.simulateButton.disabled = !enabled;
}

// --- Scanners / mapping ---

function loadScanners() {
  const saved = JSON.parse(localStorage.getItem("scandiag-scanners") || "null");
  state.scanners = Array.isArray(saved) && saved.length
    ? saved.filter(s => s && s.id)
    : DEFAULT_SCANNERS.map(s => ({ ...s }));
  if (!state.scanners.length) {
    state.scanners = [{ id: "SC1", wheel: "FL" }];
  }
}

function saveScanners() {
  localStorage.setItem("scandiag-scanners", JSON.stringify(state.scanners));
}

function renderScannerRows() {
  elements.scannerRows.replaceChildren(
    ...state.scanners.map((scanner, index) => buildScannerRow(scanner, index))
  );
}

function buildScannerRow(scanner, index) {
  const row = document.createElement("div");
  row.className = "scanner-row";

  const id = document.createElement("input");
  id.value = scanner.id;
  id.placeholder = "Identifiant scanner";
  id.setAttribute("aria-label", "Identifiant du scanner");
  id.addEventListener("input", () => {
    state.scanners[index].id = id.value.trim();
    saveScanners();
  });

  const select = document.createElement("select");
  select.setAttribute("aria-label", "Roue associée");
  for (const wheel of WHEELS) {
    const option = document.createElement("option");
    option.value = wheel.code;
    option.textContent = wheel.label;
    option.selected = wheel.code === scanner.wheel;
    select.append(option);
  }
  select.addEventListener("change", () => {
    state.scanners[index].wheel = select.value;
    saveScanners();
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn btn-small scanner-remove";
  remove.textContent = "Retirer";
  remove.disabled = state.scanners.length <= 1;
  remove.addEventListener("click", () => removeScanner(index));

  row.append(id, select, remove);
  return row;
}

function addScanner() {
  const used = new Set(state.scanners.map(s => s.wheel));
  const nextWheel = WHEEL_CODES.find(code => !used.has(code)) || "FL";
  state.scanners.push({ id: `SC${state.scanners.length + 1}`, wheel: nextWheel });
  saveScanners();
  renderScannerRows();
}

function removeScanner(index) {
  if (state.scanners.length <= 1) {
    return;
  }
  state.scanners.splice(index, 1);
  saveScanners();
  renderScannerRows();
}

// Determine la roue cible d'une mesure entrante.
function resolveWheel(scan) {
  if (scan.wheel && WHEEL_CODES.includes(scan.wheel)) {
    return scan.wheel;
  }
  if (scan.scanner != null) {
    const match = state.scanners.find(s => s.id === String(scan.scanner));
    if (match) {
      return match.wheel;
    }
  }
  if (state.scanners.length === 1) {
    return state.scanners[0].wheel;
  }
  return null;
}

// --- Connexion BLE / pont local ---

async function connect() {
  const config = getConfig();
  saveConfig(config);

  if (!navigator.bluetooth) {
    setConnection("Web Bluetooth indisponible");
    showAlert("API Web Bluetooth absente", "Utiliser Chrome ou Edge en HTTPS/localhost pour le SCANDIAG réel.");
    return;
  }

  elements.connectButton.disabled = true;
  setConnection("Scan Bluetooth...");
  setScannerState("Scanner FACOM SCANDIAG · sélection appareil", "waiting");

  try {
    const requestOptions = {
      filters: [{ namePrefix: config.namePrefix || DEFAULT_CONFIG.namePrefix }]
    };

    if (config.serviceUuid) {
      requestOptions.optionalServices = [config.serviceUuid];
    }

    const device = await navigator.bluetooth.requestDevice(requestOptions);

    state.device = device;
    state.device.addEventListener("gattserverdisconnected", handleDisconnected);

    if (!config.serviceUuid || !config.characteristicUuid) {
      setConnection("SCANDIAG détecté");
      setScannerState(`Scanner FACOM SCANDIAG · ${device.name || "appareil trouvé"}`, "live");
      showAlert(
        "Appareil détecté",
        "Le navigateur a trouvé le SCANDIAG. Mapper ensuite le service UUID et la caractéristique UUID pour lire les mesures."
      );
      return;
    }

    setConnection("Connexion GATT...");

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(config.serviceUuid);
    const characteristic = await service.getCharacteristic(config.characteristicUuid);

    state.characteristic = characteristic;
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", handleNotification);

    setConnection("Connecté (BLE)");
    setScannerState("Scanner FACOM SCANDIAG · en attente de tronçon", "live");
  } catch (error) {
    setConnection("Erreur BLE");
    showAlert("Connexion impossible", error.message || String(error));
    disconnect();
  } finally {
    elements.connectButton.disabled = false;
  }
}

function connectBridge() {
  const config = getConfig();
  saveConfig(config);

  if (state.bridgeSocket && state.bridgeSocket.readyState === WebSocket.OPEN) {
    setConnection("Connecté (logiciel local)");
    return;
  }

  setConnection("Connexion logiciel...");
  setScannerState("Scanner FACOM SCANDIAG · pont local", "waiting");

  const socket = new WebSocket(config.bridgeUrl || DEFAULT_CONFIG.bridgeUrl);
  state.bridgeSocket = socket;

  socket.addEventListener("open", () => {
    setConnection("Connecté (logiciel local)");
    setScannerState("Scanner FACOM SCANDIAG · en attente de mesure", "live");
  });

  socket.addEventListener("message", event => {
    handleBridgeMessage(event.data);
  });

  socket.addEventListener("close", () => {
    if (state.bridgeSocket === socket) {
      state.bridgeSocket = null;
    }
    setConnection("Logiciel déconnecté");
    setScannerState("Scanner FACOM SCANDIAG · pont local absent", "waiting");
  });

  socket.addEventListener("error", () => {
    setConnection("Logiciel introuvable");
    showAlert("Pont local indisponible", "Lancer le logiciel SCANDIAG Bridge, puis reconnecter l'interface.");
  });
}

function handleBridgeMessage(rawMessage) {
  let message;

  try {
    message = JSON.parse(rawMessage);
  } catch {
    showAlert("Message local invalide", rawMessage);
    return;
  }

  if (message.type === "status") {
    setConnection(message.label || "Logiciel local");
    if (message.detail) {
      setScannerState(`Scanner FACOM SCANDIAG · ${message.detail}`, "live");
    }
    return;
  }

  if (message.type === "error") {
    showAlert(message.title || "Erreur logiciel local", message.detail || "Erreur inconnue.");
    return;
  }

  if (message.type === "scan") {
    const scan = normalizeScan(message);
    if (scan) {
      recordMeasurement({ ...scan, source: message.source || "Logiciel local" });
    }
  }
}

function disconnect() {
  if (state.characteristic) {
    state.characteristic.removeEventListener("characteristicvaluechanged", handleNotification);
  }

  if (state.device?.gatt?.connected) {
    state.device.gatt.disconnect();
  }

  state.characteristic = null;
  state.device = null;

  if (state.bridgeSocket) {
    state.bridgeSocket.close();
    state.bridgeSocket = null;
  }

  setConnection("En attente");
  render();
}

function handleDisconnected() {
  state.characteristic = null;
  state.device = null;
  setConnection("Déconnecté");
  setScannerState("Scanner FACOM SCANDIAG · connexion perdue", "waiting");
}

function handleNotification(event) {
  const frame = decodeFrame(event.target.value);
  const scan = normalizeScan(frame.payload);

  if (!scan) {
    showAlert("Trame non reconnue", frame.hex || "Aucune donnée exploitable.");
    return;
  }

  recordMeasurement(scan);
}

function simulateScan() {
  if (!state.scanners.length) {
    return;
  }
  const scanner = state.scanners[state.simulationIndex % state.scanners.length];
  state.simulationIndex += 1;
  recordMeasurement({
    scanner: scanner.id,
    wheel: scanner.wheel,
    tire: randomBetween(2.4, 6.6),
    disk: randomBetween(1.2, 2.7),
    source: "Simulation"
  });
  setConnection(state.characteristic ? "Connecté (BLE)" : "Simulation active");
}

// --- Enregistrement d'une mesure ---

function recordMeasurement(scan) {
  if (!state.activePlate) {
    showAlert("Aucun véhicule actif", "Saisir une plaque avant de lancer une mesure.");
    return;
  }

  const wheel = resolveWheel(scan);
  if (!wheel) {
    showAlert(
      "Scanner non associé",
      `Aucune roue n'est associée au scanner « ${scan.scanner ?? "inconnu"} ». Vérifier la configuration.`
    );
    return;
  }

  const tire = Number(scan.tire);
  const disk = Number(scan.disk);
  const status = getStatus({ tire, disk });
  const ts = scan.time ? new Date(scan.time).toISOString() : new Date().toISOString();

  state.wheels[wheel] = { tire, disk, status, scannerId: scan.scanner ?? null, ts };

  // Cree l'analyse a la premiere mesure de la session.
  if (!state.currentAnalysisId) {
    state.currentAnalysisId = createAnalysis(state.activePlate, ts);
  }

  upsertMeasurement(state.currentAnalysisId, {
    plate: state.activePlate,
    wheel,
    tire,
    disk,
    status,
    scannerId: scan.scanner ?? null,
    ts
  });

  const overall = overallStatus(measuredWheels());
  if (state.currentAnalysisId) {
    updateAnalysis(state.currentAnalysisId, overall, ts);
  }

  elements.scannerLabel.textContent =
    `Scanner FACOM SCANDIAG · ${scan.source || "FACOM SCANDIAG"} · ${shortLabel(wheel)}`;
  render();
  if (state.view === "dashboard") {
    renderDashboard();
  }
}

// --- Rendu vue Mesure ---

function render() {
  const measured = measuredWheels();
  const overall = overallStatus(measured);

  elements.currentPlate.textContent = state.activePlate || "--";
  elements.lastScan.textContent = state.activePlate || "--";
  elements.wheelCount.textContent = `${measured.length} / 4`;

  paintWheels("wheel", state.wheels);

  if (!state.activePlate) {
    applyChip(elements.statusChip, "idle");
    hideAlert();
    setScannerState("Scanner FACOM SCANDIAG · en attente de tronçon", "waiting");
    return;
  }

  if (!measured.length) {
    applyChip(elements.statusChip, "ready");
    hideAlert();
    elements.scanCard.className = "scan-card";
    elements.scannerDot.className = "scanner-dot live";
    return;
  }

  applyChip(elements.statusChip, overall);

  if (overall === "CRITIQUE") {
    elements.scanCard.className = "scan-card critical";
    elements.scannerDot.className = "scanner-dot critical";
    showAlert(
      "Alerte critique · surveillance EV 2026",
      `${state.activePlate} : au moins une roue présente une usure incompatible avec la surveillance renforcée.`
    );
  } else if (overall === "VIGILANCE") {
    elements.scanCard.className = "scan-card";
    elements.scannerDot.className = "scanner-dot live";
    showAlert("Vigilance", `${state.activePlate} : marge réduite sur une roue, contrôle atelier recommandé.`, "warn");
  } else {
    elements.scanCard.className = "scan-card";
    elements.scannerDot.className = "scanner-dot live";
    hideAlert();
  }
}

// Remplit les cellules de roue d'un plan (prefixe d'id : "wheel" ou "dWheel").
function paintWheels(prefix, wheels) {
  for (const code of WHEEL_CODES) {
    const cell = document.querySelector(`#${prefix}${code}`);
    if (!cell) {
      continue;
    }
    const data = wheels[code];
    const tireField = cell.querySelector('[data-field="tire"]');
    const diskField = cell.querySelector('[data-field="disk"]');

    if (!data) {
      cell.dataset.status = "idle";
      tireField.textContent = "—";
      diskField.textContent = "—";
      continue;
    }

    cell.dataset.status = String(data.status).toLowerCase();
    tireField.textContent = `${formatNumber(data.tire)} mm`;
    diskField.textContent = `${formatNumber(data.disk)} mm`;
  }
}

function measuredWheels() {
  return WHEEL_CODES.map(code => state.wheels[code]).filter(Boolean);
}

function overallStatus(measured) {
  if (!measured.length) {
    return "CONFORME";
  }
  return measured.reduce(
    (worst, wheel) => (STATUS_RANK[wheel.status] > STATUS_RANK[worst] ? wheel.status : worst),
    "CONFORME"
  );
}

function getStatus(scan) {
  if (scan.tire < THRESHOLDS.tireCritical || scan.disk < THRESHOLDS.diskCritical) {
    return "CRITIQUE";
  }
  if (scan.tire < THRESHOLDS.tireWarning || scan.disk < THRESHOLDS.diskWarning) {
    return "VIGILANCE";
  }
  return "CONFORME";
}

function applyChip(chip, status) {
  const key = status in STATUS_CHIP_LABELS ? status : "idle";
  chip.textContent = STATUS_CHIP_LABELS[key];
  chip.dataset.status = key === "idle" || key === "ready" ? key : key.toLowerCase();
}

function shortLabel(code) {
  return (WHEELS.find(w => w.code === code) || {}).short || code;
}

// --- Dashboard ---

function renderDashboard() {
  const filter = { search: state.dash.search, status: state.dash.status };
  const total = countAnalyses(filter);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  state.dash.page = Math.min(Math.max(state.dash.page, 1), pages);
  const offset = (state.dash.page - 1) * PAGE_SIZE;

  const analyses = listAnalyses({
    ...filter,
    sortKey: state.dash.sortKey,
    sortDir: state.dash.sortDir,
    limit: PAGE_SIZE,
    offset
  });

  if (!analyses.length) {
    elements.dashRows.innerHTML = '<tr class="empty-row"><td colspan="3">Aucune analyse</td></tr>';
  } else {
    elements.dashRows.replaceChildren(...analyses.map(buildDashRow));
  }

  elements.dashPageInfo.textContent =
    `Page ${state.dash.page} / ${pages} · ${total} analyse${total > 1 ? "s" : ""}`;
  elements.dashPrev.disabled = state.dash.page <= 1;
  elements.dashNext.disabled = state.dash.page >= pages;

  for (const button of elements.sortButtons) {
    const active = button.dataset.sort === state.dash.sortKey;
    button.classList.toggle("is-active", active);
    button.dataset.dir = active ? state.dash.sortDir : "";
  }
}

function buildDashRow(analysis) {
  const row = document.createElement("tr");
  row.className = "dash-row";
  row.tabIndex = 0;
  row.setAttribute("role", "button");

  const plateCell = document.createElement("td");
  plateCell.className = "dash-plate";
  plateCell.textContent = analysis.plate;

  const statusCell = document.createElement("td");
  statusCell.append(statusBadge(analysis.status));

  const timeCell = document.createElement("td");
  timeCell.className = "dash-time";
  timeCell.textContent = formatDateTime(analysis.updated_at);

  row.append(plateCell, statusCell, timeCell);
  row.addEventListener("click", () => openDetail(analysis.id));
  row.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail(analysis.id);
    }
  });
  return row;
}

function statusBadge(status) {
  const span = document.createElement("span");
  span.className = "status-chip status-chip-sm";
  applyChip(span, status || "idle");
  return span;
}

function toggleSort(key) {
  if (state.dash.sortKey === key) {
    state.dash.sortDir = state.dash.sortDir === "asc" ? "desc" : "asc";
  } else {
    state.dash.sortKey = key;
    state.dash.sortDir = key === "plate" ? "asc" : "desc";
  }
  state.dash.page = 1;
  renderDashboard();
}

function changePage(delta) {
  state.dash.page += delta;
  renderDashboard();
}

// --- Detail d'une analyse ---

function openDetail(id) {
  const analysis = getAnalysis(id);
  if (!analysis) {
    return;
  }

  const wheels = emptyWheels();
  for (const row of getAnalysisWheels(id)) {
    if (WHEEL_CODES.includes(row.wheel)) {
      wheels[row.wheel] = { tire: row.tire, disk: row.disk, status: row.status, ts: row.ts };
    }
  }

  elements.detailPlate.textContent = analysis.plate;
  elements.detailTime.textContent = formatDateTime(analysis.updated_at);
  applyChip(elements.detailChip, analysis.status || "idle");
  paintWheels("dWheel", wheels);

  elements.detailOverlay.hidden = false;
  elements.detailClose.focus();
}

function closeDetail() {
  elements.detailOverlay.hidden = true;
}

// --- Decodage trames ---

function decodeFrame(dataView) {
  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(" ").toUpperCase();
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\0/g, "").trim();

  if (text.startsWith("{")) {
    try {
      return { hex, payload: JSON.parse(text) };
    } catch {
      return { hex, payload: null };
    }
  }

  const payload = parseTextPayload(text);

  if (payload) {
    return { hex, payload };
  }

  if (dataView.byteLength === 4) {
    return {
      hex,
      payload: {
        tire: dataView.getUint16(0, true) / 10,
        disk: dataView.getUint16(2, true) / 10
      }
    };
  }

  return { hex, payload: null };
}

function parseTextPayload(text) {
  if (!text) {
    return null;
  }

  if (text.startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  const tire = readNumber(text, /(?:pneu|tire|depth|value)\D*(-?\d+(?:[.,]\d+)?)/i);
  const disk = readNumber(text, /(?:disque|disk|brake)\D*(-?\d+(?:[.,]\d+)?)/i);
  const plate = (text.match(/[A-Z]{2}-\d{3}-[A-Z]{2}/i) || [])[0];
  const scanner = (text.match(/(?:scanner|capteur)\s*[:=]?\s*(\w+)/i) || [])[1];
  const wheel = (text.match(/\b(FL|FR|RL|RR)\b/i) || [])[1];

  if (Number.isFinite(tire) || Number.isFinite(disk)) {
    return { plate, tire, disk, scanner, wheel: wheel ? wheel.toUpperCase() : undefined };
  }

  return null;
}

function normalizeScan(payload) {
  if (!payload) {
    return null;
  }

  const tire = toNumber(payload.tire ?? payload.pneu ?? payload.depth ?? payload.value);
  const disk = toNumber(payload.disk ?? payload.disque ?? payload.brake ?? payload.brakeDisk);

  if (!Number.isFinite(tire) && !Number.isFinite(disk)) {
    return null;
  }

  return {
    plate: payload.plate ?? payload.immat ?? payload.registration,
    tire: Number.isFinite(tire) ? tire : 4.8,
    disk: Number.isFinite(disk) ? disk : 1.7,
    scanner: payload.scanner ?? payload.scannerId ?? payload.capteur,
    wheel: payload.wheel ?? payload.roue
  };
}

function readNumber(text, pattern) {
  const match = text.match(pattern);
  return match ? Number.parseFloat(match[1].replace(",", ".")) : Number.NaN;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return Number.NaN;
  }
  return Number(value);
}

function randomBetween(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

// --- UI utilitaires ---

function setConnection(label) {
  elements.connectionStatus.textContent = label;
  elements.connectionStatusMirror.textContent = label;
}

function setScannerState(label, mode) {
  elements.scannerLabel.textContent = label;
  elements.scanCard.className = mode === "waiting" ? "scan-card waiting" : "scan-card";
  elements.scannerDot.className = mode === "live" ? "scanner-dot live" : "scanner-dot";
}

function showAlert(title, text, severity = "crit") {
  elements.alertTitle.textContent = title;
  elements.alertText.textContent = text;
  elements.alertPanel.classList.toggle("warn", severity === "warn");
  elements.alertPanel.hidden = false;
}

function hideAlert() {
  elements.alertPanel.hidden = true;
}

function clearHistory() {
  clearAll();
  state.wheels = emptyWheels();
  state.currentAnalysisId = null;
  render();
  renderDashboard();
}

function getConfig() {
  return {
    bridgeUrl: elements.bridgeUrl.value.trim() || DEFAULT_CONFIG.bridgeUrl,
    namePrefix: elements.namePrefix.value.trim() || DEFAULT_CONFIG.namePrefix,
    serviceUuid: elements.serviceUuid.value.trim(),
    characteristicUuid: elements.characteristicUuid.value.trim()
  };
}

function saveConfig(config) {
  localStorage.setItem("scandiag-ble-config", JSON.stringify(config));
}

function loadConfig() {
  const saved = JSON.parse(localStorage.getItem("scandiag-ble-config") || "null") || DEFAULT_CONFIG;
  elements.bridgeUrl.value = saved.bridgeUrl || DEFAULT_CONFIG.bridgeUrl;
  elements.namePrefix.value = saved.namePrefix || DEFAULT_CONFIG.namePrefix;
  elements.serviceUuid.value = saved.serviceUuid || "";
  elements.characteristicUuid.value = saved.characteristicUuid || "";
}

function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

// Expose la connexion BLE reelle si besoin (bouton dedie eventuel).
window.scandiagConnectBle = connect;
