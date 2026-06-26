// Persistance SQLite cote client via sql.js (WebAssembly).
// La base vit en memoire puis est exportee dans IndexedDB apres chaque ecriture.
//
// Modele : une `analysis` = une inspection d'un vehicule (les 4 roues a un
// instant). Chaque `measurement` (une roue) se rattache a une analyse.

const IDB_NAME = "scandiag";
const IDB_STORE = "kv";
const DB_KEY = "sqlite-db";
const SAVE_DEBOUNCE_MS = 400;

// Creation des tables uniquement. Les index sont crees dans migrate() une fois
// la colonne analysis_id garantie (les anciennes bases ne l'ont pas).
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plate TEXT NOT NULL,
    status TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS measurement (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id INTEGER,
    plate TEXT,
    wheel TEXT NOT NULL,
    tire REAL,
    disk REAL,
    status TEXT,
    scanner_id TEXT,
    ts TEXT NOT NULL,
    day TEXT
  );
`;

const STATUS_ORDER = { CONFORME: 0, VIGILANCE: 1, CRITIQUE: 2 };

// Tri du dashboard : etat trie par severite, pas alphabetiquement.
const SORT_COLUMNS = {
  plate: "plate",
  status: "CASE status WHEN 'CRITIQUE' THEN 2 WHEN 'VIGILANCE' THEN 1 WHEN 'CONFORME' THEN 0 ELSE -1 END",
  updated_at: "updated_at"
};

let db = null;
let saveTimer = null;

// Jour local (AAAA-MM-JJ) deduit d'un timestamp ISO.
function localDay(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function worstStatus(list) {
  return list.reduce(
    (worst, status) => ((STATUS_ORDER[status] ?? -1) > (STATUS_ORDER[worst] ?? -1) ? status : worst),
    "CONFORME"
  );
}

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
  migrate();
  return db;
}

// Migre les bases anterieures : supprime la contrainte 1 mesure/roue/jour et
// regroupe les anciennes mesures isolees en analyses (par plaque + jour).
function migrate() {
  const columns = rows(db.exec("PRAGMA table_info(measurement)")).map(c => c.name);

  if (!columns.includes("analysis_id")) {
    db.run("ALTER TABLE measurement ADD COLUMN analysis_id INTEGER");
  }
  if (!columns.includes("day")) {
    db.run("ALTER TABLE measurement ADD COLUMN day TEXT");
  }

  // Ancienne contrainte 1/roue/jour : retiree.
  db.run("DROP INDEX IF EXISTS idx_meas_unique");
  db.run("UPDATE measurement SET day = substr(ts, 1, 10) WHERE day IS NULL");

  const orphans = rows(db.exec("SELECT COUNT(*) AS n FROM measurement WHERE analysis_id IS NULL"));
  if (orphans.length && orphans[0].n > 0) {
    const groups = rows(
      db.exec(
        `SELECT plate, COALESCE(day, substr(ts, 1, 10)) AS d, MIN(ts) AS started, MAX(ts) AS updated
         FROM measurement WHERE analysis_id IS NULL
         GROUP BY plate, d`
      )
    );

    for (const group of groups) {
      const statuses = rows(
        db.exec(
          "SELECT status FROM measurement WHERE analysis_id IS NULL AND plate = ? AND COALESCE(day, substr(ts, 1, 10)) = ?",
          [group.plate, group.d]
        )
      ).map(r => r.status);

      db.run("INSERT INTO analysis (plate, status, started_at, updated_at) VALUES (?, ?, ?, ?)", [
        group.plate,
        worstStatus(statuses),
        group.started,
        group.updated
      ]);
      const analysisId = lastInsertId();
      db.run(
        "UPDATE measurement SET analysis_id = ? WHERE analysis_id IS NULL AND plate = ? AND COALESCE(day, substr(ts, 1, 10)) = ?",
        [analysisId, group.plate, group.d]
      );
    }
  }

  // Index crees apres garantie de la colonne analysis_id.
  db.run("CREATE INDEX IF NOT EXISTS idx_meas_analysis ON measurement (analysis_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_analysis_plate ON analysis (plate, updated_at)");
  // Une valeur courante par roue dans une analyse (re-mesure = ecrasement).
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_meas_aw ON measurement (analysis_id, wheel)");
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

// --- Helpers ---

// Convertit le resultat d'un exec sql.js en tableau d'objets.
function rows(result) {
  if (!result.length) {
    return [];
  }
  const { columns, values } = result[0];
  return values.map(row => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
}

function lastInsertId() {
  const result = db.exec("SELECT last_insert_rowid() AS id");
  return result.length ? result[0].values[0][0] : null;
}

// --- Ecritures ---

export function createAnalysis(plate, ts) {
  if (!db) {
    return null;
  }
  db.run("INSERT INTO analysis (plate, status, started_at, updated_at) VALUES (?, ?, ?, ?)", [
    plate,
    null,
    ts,
    ts
  ]);
  scheduleSave();
  return lastInsertId();
}

export function updateAnalysis(id, status, ts) {
  if (!db) {
    return;
  }
  db.run("UPDATE analysis SET status = ?, updated_at = ? WHERE id = ?", [status, ts, id]);
  scheduleSave();
}

// Upsert d'une roue dans une analyse : 1 valeur courante par roue.
export function upsertMeasurement(analysisId, measurement) {
  if (!db) {
    return;
  }
  db.run(
    `INSERT INTO measurement (analysis_id, plate, wheel, tire, disk, status, scanner_id, ts, day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (analysis_id, wheel) DO UPDATE SET
       tire = excluded.tire,
       disk = excluded.disk,
       status = excluded.status,
       scanner_id = excluded.scanner_id,
       ts = excluded.ts`,
    [
      analysisId,
      measurement.plate,
      measurement.wheel,
      measurement.tire,
      measurement.disk,
      measurement.status,
      measurement.scannerId ?? null,
      measurement.ts,
      localDay(measurement.ts)
    ]
  );
  scheduleSave();
}

export function clearAll() {
  if (!db) {
    return;
  }
  db.run("DELETE FROM measurement");
  db.run("DELETE FROM analysis");
  scheduleSave();
}

// --- Lectures ---

export function getAnalysis(id) {
  if (!db) {
    return null;
  }
  const result = rows(db.exec("SELECT id, plate, status, started_at, updated_at FROM analysis WHERE id = ?", [id]));
  return result[0] || null;
}

export function getAnalysisWheels(analysisId) {
  if (!db) {
    return [];
  }
  return rows(
    db.exec(
      "SELECT wheel, tire, disk, status, scanner_id, ts FROM measurement WHERE analysis_id = ?",
      [analysisId]
    )
  );
}

// Liste filtree / triee / paginee pour le dashboard.
export function listAnalyses({ search = "", status = "", sortKey = "updated_at", sortDir = "desc", limit = 10, offset = 0 } = {}) {
  if (!db) {
    return [];
  }
  const { where, params } = buildFilter(search, status);
  const column = SORT_COLUMNS[sortKey] || SORT_COLUMNS.updated_at;
  const direction = sortDir === "asc" ? "ASC" : "DESC";
  return rows(
    db.exec(
      `SELECT id, plate, status, started_at, updated_at FROM analysis
       ${where} ORDER BY ${column} ${direction}, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
  );
}

export function countAnalyses({ search = "", status = "" } = {}) {
  if (!db) {
    return 0;
  }
  const { where, params } = buildFilter(search, status);
  const result = rows(db.exec(`SELECT COUNT(*) AS n FROM analysis ${where}`, params));
  return result.length ? result[0].n : 0;
}

function buildFilter(search, status) {
  const clauses = [];
  const params = [];
  if (search) {
    clauses.push("plate LIKE ?");
    params.push(`%${search.toUpperCase()}%`);
  }
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}
