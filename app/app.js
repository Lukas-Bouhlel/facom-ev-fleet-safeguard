const DEFAULT_CONFIG = {
  bridgeUrl: "ws://localhost:8765",
  namePrefix: "FACOM_SCANDIAG_",
  serviceUuid: "",
  characteristicUuid: ""
};

const SIMULATED_SCANS = [
  { plate: "AY-389-IM", tire: 4.8, disk: 1.7 },
  { plate: "JV-524-OE", tire: 5.6, disk: 2.4 },
  { plate: "OW-134-EU", tire: 5.7, disk: 1.3 },
  { plate: "EV-706-ZR", tire: 3.2, disk: 1.6 },
  { plate: "QA-912-VE", tire: 2.7, disk: 2.1 }
];

const THRESHOLDS = {
  tireCritical: 3,
  tireWarning: 4,
  diskCritical: 1.5,
  diskWarning: 1.8
};

const state = {
  device: null,
  characteristic: null,
  bridgeSocket: null,
  scans: [],
  simulationIndex: 0
};

const elements = {
  scanCard: document.querySelector("#scanCard"),
  scannerDot: document.querySelector("#scannerDot"),
  scannerLabel: document.querySelector("#scannerLabel"),
  alertPanel: document.querySelector("#alertPanel"),
  alertTitle: document.querySelector("#alertTitle"),
  alertText: document.querySelector("#alertText"),
  currentPlate: document.querySelector("#currentPlate"),
  currentTire: document.querySelector("#currentTire"),
  currentDisk: document.querySelector("#currentDisk"),
  scanRows: document.querySelector("#scanRows"),
  connectionStatus: document.querySelector("#connectionStatus"),
  lastScan: document.querySelector("#lastScan"),
  connectButton: document.querySelector("#connectButton"),
  simulateButton: document.querySelector("#simulateButton"),
  disconnectButton: document.querySelector("#disconnectButton"),
  clearButton: document.querySelector("#clearButton"),
  configForm: document.querySelector("#configForm"),
  bridgeUrl: document.querySelector("#bridgeUrl"),
  namePrefix: document.querySelector("#namePrefix"),
  serviceUuid: document.querySelector("#serviceUuid"),
  characteristicUuid: document.querySelector("#characteristicUuid")
};

loadConfig();
render();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js").catch(() => undefined);
}

elements.connectButton.addEventListener("click", connectBridge);
elements.simulateButton.addEventListener("click", simulateScan);
elements.disconnectButton.addEventListener("click", disconnect);
elements.clearButton.addEventListener("click", clearScans);

elements.configForm.addEventListener("submit", event => {
  event.preventDefault();
  saveConfig(getConfig());
  setConnection("Configuration BLE sauvegardee");
});

async function connect() {
  const config = getConfig();
  saveConfig(config);

  if (!navigator.bluetooth) {
    setConnection("Web Bluetooth indisponible");
    showAlert("API Web Bluetooth absente", "Utiliser Chrome ou Edge en HTTPS/localhost pour le SCANDIAG reel.");
    return;
  }

  elements.connectButton.disabled = true;
  setConnection("Scan Bluetooth...");
  setScannerState("SCANNER FACOM SCANDIAG : SELECTION APPAREIL", "waiting");

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
      setConnection("SCANDIAG detecte");
      setScannerState(`SCANNER FACOM SCANDIAG : ${device.name || "APPAREIL TROUVE"}`, "live");
      showAlert(
        "Appareil detecte",
        "Le navigateur a trouve le SCANDIAG. Il faut maintenant mapper le service UUID et la caracteristique UUID pour lire les mesures."
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

    setConnection("Connecte (BLE)");
    setScannerState("SCANNER FACOM SCANDIAG : EN ATTENTE DE TRONCON", "live");
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
    setConnection("Connecte (logiciel local)");
    return;
  }

  setConnection("Connexion logiciel...");
  setScannerState("SCANNER FACOM SCANDIAG : PONT LOCAL", "waiting");

  const socket = new WebSocket(config.bridgeUrl || DEFAULT_CONFIG.bridgeUrl);
  state.bridgeSocket = socket;

  socket.addEventListener("open", () => {
    setConnection("Connecte (logiciel local)");
    setScannerState("SCANNER FACOM SCANDIAG : EN ATTENTE DE MESURE", "live");
  });

  socket.addEventListener("message", event => {
    handleBridgeMessage(event.data);
  });

  socket.addEventListener("close", () => {
    if (state.bridgeSocket === socket) {
      state.bridgeSocket = null;
    }
    setConnection("Logiciel deconnecte");
    setScannerState("SCANNER FACOM SCANDIAG : PONT LOCAL ABSENT", "waiting");
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
      setScannerState(`SCANNER FACOM SCANDIAG : ${message.detail}`, "live");
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
      addScan({ ...scan, source: message.source || "Logiciel local" });
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

  setConnection("En Attente");
  setScannerState("SCANNER FACOM SCANDIAG : EN ATTENTE DE TRONCON", "waiting");
}

function handleDisconnected() {
  state.characteristic = null;
  state.device = null;
  setConnection("Deconnecte");
  setScannerState("SCANNER FACOM SCANDIAG : CONNEXION PERDUE", "waiting");
}

function handleNotification(event) {
  const frame = decodeFrame(event.target.value);
  const scan = normalizeScan(frame.payload);

  if (!scan) {
    showAlert("Trame non reconnue", frame.hex || "Aucune donnee exploitable.");
    return;
  }

  addScan(scan);
}

function simulateScan() {
  const template = SIMULATED_SCANS[state.simulationIndex % SIMULATED_SCANS.length];
  state.simulationIndex += 1;
  addScan({ ...template, source: "Simulation" });
  setConnection(state.characteristic ? "Connecte (BLE)" : "Simulation active");
}

function addScan(scan) {
  const completedScan = {
    plate: scan.plate || generatePlate(),
    tire: Number(scan.tire),
    disk: Number(scan.disk),
    time: scan.time ? new Date(scan.time) : new Date(),
    source: scan.source || "FACOM SCANDIAG"
  };

  completedScan.status = getStatus(completedScan);
  state.scans.unshift(completedScan);
  state.scans = state.scans.slice(0, 8);
  render();
}

function render() {
  const latest = state.scans[0];

  if (!latest) {
    elements.currentPlate.textContent = "--";
    elements.currentTire.textContent = "-- mm";
    elements.currentDisk.textContent = "-- mm";
    elements.lastScan.textContent = "--";
    elements.scanRows.innerHTML = '<tr class="empty-row"><td colspan="5">Aucun scan recu</td></tr>';
    hideAlert();
    setScannerState("SCANNER FACOM SCANDIAG : EN ATTENTE DE TRONCON", "waiting");
    return;
  }

  elements.currentPlate.textContent = latest.plate;
  elements.currentTire.textContent = `${formatNumber(latest.tire)} mm`;
  elements.currentDisk.textContent = `${formatNumber(latest.disk)} mm`;
  elements.lastScan.textContent = latest.plate;
  elements.scanRows.replaceChildren(...state.scans.map(createRow));

  if (latest.status === "CRITIQUE") {
    elements.scanCard.className = "scan-card critical";
    elements.scannerDot.className = "scanner-dot critical";
    showAlert(
      "ALERTE CRITIQUE EV 2026",
      `${latest.plate} : usure incompatible avec la surveillance renforcee des vehicules electriques lourds.`
    );
  } else if (latest.status === "VIGILANCE") {
    elements.scanCard.className = "scan-card";
    elements.scannerDot.className = "scanner-dot live";
    showAlert("VIGILANCE", `${latest.plate} : marge reduite, controle atelier recommande.`);
  } else {
    elements.scanCard.className = "scan-card";
    elements.scannerDot.className = "scanner-dot live";
    hideAlert();
  }

  elements.scannerLabel.textContent = `SCANNER FACOM SCANDIAG : ${latest.source.toUpperCase()}`;
}

function createRow(scan) {
  const row = document.createElement("tr");
  const values = [
    scan.plate,
    formatTime(scan.time),
    formatNumber(scan.tire),
    formatNumber(scan.disk),
    scan.status
  ];

  for (const value of values) {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.append(cell);
  }

  row.lastElementChild.className = `status-${scan.status.toLowerCase()}`;
  return row;
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

  if (Number.isFinite(tire) || Number.isFinite(disk)) {
    return { plate, tire, disk };
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
    disk: Number.isFinite(disk) ? disk : 1.7
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

function setConnection(label) {
  elements.connectionStatus.textContent = label;
}

function setScannerState(label, mode) {
  elements.scannerLabel.textContent = label;
  elements.scanCard.className = mode === "waiting" ? "scan-card waiting" : "scan-card";
  elements.scannerDot.className = mode === "live" ? "scanner-dot live" : "scanner-dot";
}

function showAlert(title, text) {
  elements.alertTitle.textContent = title;
  elements.alertText.textContent = text;
  elements.alertPanel.hidden = false;
}

function hideAlert() {
  elements.alertPanel.hidden = true;
}

function clearScans() {
  state.scans = [];
  render();
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

function generatePlate() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const pick = () => letters[Math.floor(Math.random() * letters.length)];
  return `${pick()}${pick()}-${Math.floor(100 + Math.random() * 900)}-${pick()}${pick()}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value);
}

function formatTime(value) {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(value);
}
