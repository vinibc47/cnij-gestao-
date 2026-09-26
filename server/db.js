const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const C = require('./constants');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'cnij.sqlite');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const norm = (params) => (params || []).map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const all = (sql, ...p) => db.prepare(sql).all(...norm(p.flat()));
const get = (sql, ...p) => db.prepare(sql).get(...norm(p.flat()));
const run = (sql, ...p) => db.prepare(sql).run(...norm(p.flat()));
const val = (sql, ...p) => { const r = get(sql, ...p); return r ? Object.values(r)[0] : undefined; };

let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) return fn();
  txDepth++;
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  finally { txDepth--; }
}

function insert(table, data) {
  const keys = Object.keys(data);
  const r = run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map((k) => data[k]));
  return Number(r.lastInsertRowid);
}
function update(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => data[k]), id]);
}

function getSetting(key, def = null) { const r = get('SELECT value FROM settings WHERE key = ?', key); return r ? r.value : def; }
function setSetting(key, value) { run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value == null ? null : String(value)); }

// ---------- Dados iniciais (somente configuração, nunca dados fictícios) ----------
function seedDefaults() {
  tx(() => {
    for (const [kind, names] of Object.entries(C.DEFAULT_OPTIONS)) {
      if (val('SELECT COUNT(*) FROM options WHERE kind = ?', kind) > 0) continue;
      names.forEach((name, i) => run('INSERT OR IGNORE INTO options(kind, name, position) VALUES (?,?,?)', kind, name, i));
    }
    if (!val("SELECT COUNT(*) FROM phase_templates WHERE kind='projeto'"))
      C.DEFAULT_PROJECT_PHASES.forEach((n, i) => run("INSERT INTO phase_templates(kind,name,position) VALUES('projeto',?,?)", n, i));
    if (!val("SELECT COUNT(*) FROM phase_templates WHERE kind='obra'"))
      C.DEFAULT_WORK_PHASES.forEach((n, i) => run("INSERT INTO phase_templates(kind,name,position) VALUES('obra',?,?)", n, i));
    const defaults = {
      office_name: 'Carla Nogueira & Irineu Junior',
      office_tagline: 'Arquitetura | Interiores',
      opening_balance: '0', opening_balance_date: new Date().toISOString().slice(0, 10),
      alert_days_payments: '5', alert_days_tasks: '2', alert_days_deliveries: '7', alert_days_documents: '30',
      alert_days_proposals: '5', recurring_months_ahead: '3', backup_keep: '30',
      office_doc: '', office_address: '', office_phone: '', office_email: '',
    };
    for (const [k, v] of Object.entries(defaults)) if (getSetting(k) === null) setSetting(k, v);
  });
}
seedDefaults();

module.exports = { db, all, get, run, val, tx, insert, update, getSetting, setSetting, DB_FILE, DATA_DIR };
