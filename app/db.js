// Persistance SQLite cote client via sql.js (WebAssembly).
// La base vit en memoire puis est exportee dans IndexedDB apres chaque ecriture.

const IDB_NAME = "scandiag";
const IDB_STORE = "kv";
const DB_KEY = "sqlite-db";
const SAVE_DEBOUNCE_MS = 400;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS measurement (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plate TEXT NOT NULL,
    wheel TEXT NOT NULL,
    tire REAL,
    disk REAL,
    status TEXT,
    scanner_id TEXT,
    ts TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_meas_plate ON measurement (plate, ts);
`;

let db = null;
let saveTimer = null;

// --- IndexedDB minimal key/value ---

function idbOpen() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(IDB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  const store = (await idbOpen()).transaction(IDB_STORE, "readonly").objectStore(IDB_STORE);
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(key, value) {
  const store = (await idbOpen()).transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE);
  return new Promise((resolve, reject) => {
    const request = store.put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// --- Init / persistance ---

export async function initDb() {
  const SQL = await window.initSqlJs({ locateFile: file => `./vendor/sqljs/${file}` });
  const saved = await idbGet(DB_KEY);
  db = saved ? new SQL.Database(new Uint8Array(saved)) : new SQL.Database();
  db.run(SCHEMA);
  return db;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, SAVE_DEBOUNCE_MS);
}

async function persist() {
  if (!db) {
    return;
  }
  try {
    await idbPut(DB_KEY, db.export());
  } catch (error) {
    console.warn("Sauvegarde SQLite impossible", error);
  }
}

// --- Requetes ---

// Convertit le resultat d'un exec sql.js en tableau d'objets.
function rows(result) {
  if (!result.length) {
    return [];
  }
  const { columns, values } = result[0];
  return values.map(row => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
}

export function insertMeasurement(measurement) {
  if (!db) {
    return;
  }
  db.run(
    "INSERT INTO measurement (plate, wheel, tire, disk, status, scanner_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      measurement.plate,
      measurement.wheel,
      measurement.tire,
      measurement.disk,
      measurement.status,
      measurement.scannerId ?? null,
      measurement.ts
    ]
  );
  scheduleSave();
}

// Derniere mesure connue pour chaque roue d'un vehicule.
export function getLatestPerWheel(plate) {
  if (!db) {
    return [];
  }
  return rows(
    db.exec(
      `SELECT m.wheel, m.tire, m.disk, m.status, m.scanner_id, m.ts
       FROM measurement m
       JOIN (SELECT wheel, MAX(id) AS mid FROM measurement WHERE plate = ? GROUP BY wheel) last
         ON m.id = last.mid`,
      [plate]
    )
  );
}

// Historique chronologique (plus recent d'abord).
export function getVehicleHistory(plate, limit = 20) {
  if (!db) {
    return [];
  }
  return rows(
    db.exec(
      "SELECT ts, wheel, tire, disk, status FROM measurement WHERE plate = ? ORDER BY id DESC LIMIT ?",
      [plate, limit]
    )
  );
}

export function countMeasurements(plate) {
  if (!db) {
    return 0;
  }
  const result = rows(db.exec("SELECT COUNT(*) AS n FROM measurement WHERE plate = ?", [plate]));
  return result.length ? result[0].n : 0;
}

export function clearVehicle(plate) {
  if (!db) {
    return;
  }
  db.run("DELETE FROM measurement WHERE plate = ?", [plate]);
  scheduleSave();
}

export function clearAll() {
  if (!db) {
    return;
  }
  db.run("DELETE FROM measurement");
  scheduleSave();
}

export function listVehicles() {
  if (!db) {
    return [];
  }
  return rows(
    db.exec(
      "SELECT plate, MAX(ts) AS last_ts, COUNT(*) AS n FROM measurement GROUP BY plate ORDER BY last_ts DESC"
    )
  );
}
