const Database = require('better-sqlite3');
function initDatabase(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS targets (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, url TEXT NOT NULL, domain TEXT NOT NULL, label TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id,url));
    CREATE TABLE IF NOT EXISTS project_settings (project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, allowed_domains TEXT NOT NULL DEFAULT '[]', request_delay_ms INTEGER NOT NULL DEFAULT 1500, max_pages INTEGER NOT NULL DEFAULT 20, max_depth INTEGER NOT NULL DEFAULT 1, max_response_bytes INTEGER NOT NULL DEFAULT 2000000, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS extraction_runs (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, target_id INTEGER REFERENCES targets(id) ON DELETE SET NULL, url TEXT NOT NULL, page_title TEXT DEFAULT '', http_status INTEGER, content_hash TEXT NOT NULL, fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, selector_config TEXT NOT NULL DEFAULT '[]', records_json TEXT NOT NULL DEFAULT '[]', error TEXT);
    CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, run_id INTEGER NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE, row_index INTEGER NOT NULL, source_url TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_targets_project ON targets(project_id);
    CREATE INDEX IF NOT EXISTS idx_runs_project ON extraction_runs(project_id, fetched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_records_project ON records(project_id, id DESC);
  `);
  return db;
}
module.exports = { initDatabase };
