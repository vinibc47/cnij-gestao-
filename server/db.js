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

// ---------- Migrações: novas colunas em bancos já existentes (nunca apagam dados) ----------
const MIGRATIONS = {
  proposals: {
    kind: "TEXT NOT NULL DEFAULT 'simples'", service_type: 'TEXT', work_type: 'TEXT', issue_date: 'TEXT', contact_name: 'TEXT',
    summary: 'TEXT', scope: 'TEXT', excluded: 'TEXT', deliverables: 'TEXT', stages: 'TEXT', deadline_text: 'TEXT',
    down_payment: 'REAL', payment_plan: 'TEXT', payment_method: 'TEXT', pix_key: 'TEXT', pix_name: 'TEXT', conditions: 'TEXT',
    extra: 'TEXT', body: 'TEXT', template_id: 'INTEGER', template_version: 'INTEGER', approved_by: 'TEXT', approved_at: 'TEXT',
    approval_notes: 'TEXT', approved_user_id: 'INTEGER',
    services: 'TEXT', prospect_name: 'TEXT', prospect_doc: 'TEXT', prospect_phone: 'TEXT', prospect_email: 'TEXT', prospect_address: 'TEXT', prospect_city: 'TEXT',
    client_converted_at: 'TEXT',
  },
  quotes: { included: 'TEXT', excluded: 'TEXT', payment_terms: 'TEXT' },
  contracts: { service_type: 'TEXT', template_id: 'INTEGER', template_version: 'INTEGER', body: 'TEXT', data: 'TEXT', payment_plan: 'TEXT' },
  works: { budget_notes: 'TEXT' },
  work_phases: { responsible: 'TEXT', pending: 'TEXT', next_action: 'TEXT' },
};
// Propostas podem existir antes do cadastro do cliente (interessado): client_id deixa de ser obrigatório.
// O SQLite não altera restrições de coluna, então a tabela é recriada preservando todos os dados.
function relaxProposalClient() {
  const col = all('PRAGMA table_info(proposals)').find((c) => c.name === 'client_id');
  if (!col || !col.notnull) return;
  const sql = get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'proposals'").sql;
  const newSql = sql.replace(/client_id\s+INTEGER\s+NOT\s+NULL/i, 'client_id INTEGER').replace(/CREATE TABLE\s+(IF NOT EXISTS\s+)?"?proposals"?/i, 'CREATE TABLE proposals_mig');
  const cols = all('PRAGMA table_info(proposals)').map((c) => c.name).join(', ');
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(newSql);
    db.exec(`INSERT INTO proposals_mig (${cols}) SELECT ${cols} FROM proposals`);
    db.exec('DROP TABLE proposals');
    db.exec('ALTER TABLE proposals_mig RENAME TO proposals');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA foreign_keys = ON'); }
}
function migrate() {
  for (const [table, cols] of Object.entries(MIGRATIONS)) {
    const have = new Set(all(`PRAGMA table_info(${table})`).map((c) => c.name));
    for (const [col, def] of Object.entries(cols)) if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
  relaxProposalClient();
  // status de proposta simplificados: Rascunho, Enviada, Aprovada, Recusada, Expirada
  run("UPDATE proposals SET status = 'enviada' WHERE status IN ('visualizada','negociacao')");
}
migrate();

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
      office_city: 'Campo Grande – MS', office_timezone: 'America/Campo_Grande',
      office_pix_key: '', office_pix_type: '', office_pix_name: '', office_pix_bank: '', office_logo: '',
      contractor_name: '', contractor_doc: '', contractor_address: '', contractor_registry: '',
      proposal_validity_days: '15', whatsapp_template: '', whatsapp_template_overdue: '',
    };
    for (const [k, v] of Object.entries(defaults)) if (getSetting(k) === null) setSetting(k, v);
    // contatos comerciais que já constam nas propostas do escritório (preenchidos só se estiverem vazios)
    if (getSetting('seed_contacts_v2') === null) {
      const fill = { office_address: 'Rua Pernambuco, 3080 – Campo Grande/MS', office_phone: 'Carla: (67) 99963-5802 · Irineu: (67) 98207-7556', office_email: 'contatocarlaeirineu@gmail.com' };
      for (const [k, v] of Object.entries(fill)) if (!getSetting(k)) setSetting(k, v);
      setSetting('seed_contacts_v2', '1');
    }
  });
}
seedDefaults();

module.exports = { db, all, get, run, val, tx, insert, update, getSetting, setSetting, DB_FILE, DATA_DIR };
