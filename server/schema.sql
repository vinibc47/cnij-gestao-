-- =====================================================================
-- CN&IJ Gestão — Esquema do banco de dados (SQLite)
-- Todas as tabelas se relacionam por chaves estrangeiras; nenhuma
-- informação é duplicada (ex.: o cliente de uma obra vem do projeto).
-- =====================================================================
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','gestor','colaborador','estagiario','cliente')),
  can_finance INTEGER NOT NULL DEFAULT 0,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  phone TEXT,
  job_title TEXT,
  hourly_cost REAL DEFAULT 0,
  color TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_pw INTEGER NOT NULL DEFAULT 0,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  ip TEXT, ua TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Listas configuráveis (categorias de receita/despesa, tipos de projeto,
-- categorias de fornecedor/documento, origens de cliente...)
CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  UNIQUE(kind, name)
);

CREATE TABLE IF NOT EXISTS phase_templates (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('projeto','obra')),
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  default_days INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  person_type TEXT DEFAULT 'PF',
  doc TEXT,
  phone TEXT, whatsapp TEXT, email TEXT,
  address TEXT, city TEXT, state TEXT, zip TEXT,
  profession TEXT,
  origin TEXT,
  birthday TEXT,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS client_interactions (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'contato',
  description TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  code TEXT,
  name TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE RESTRICT,
  address TEXT, city TEXT,
  type TEXT,
  area REAL,
  contract_value REAL DEFAULT 0,
  contracted_at TEXT,
  start_date TEXT,
  due_date TEXT,
  manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ativo',
  progress INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  portal_message TEXT,
  proposal_id INTEGER REFERENCES proposals(id) ON DELETE SET NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS project_phases (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  start_date TEXT,
  due_date TEXT,
  responsible_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'nao_iniciado',
  notes TEXT,
  client_visible INTEGER NOT NULL DEFAULT 1,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT,
  address TEXT,
  start_date TEXT,
  due_date TEXT,
  responsible_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  budget REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planejada',
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS work_phases (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'nao_iniciado',
  start_date TEXT, due_date TEXT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS work_logs (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'registro',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  decisions TEXT,
  pending TEXT,
  problems TEXT,
  suppliers_present TEXT,
  client_visible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  company TEXT NOT NULL,
  contact TEXT,
  phone TEXT, whatsapp TEXT, email TEXT,
  cnpj TEXT,
  category TEXT,
  city TEXT,
  pix TEXT,
  rt_percent REAL,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS supplier_reviews (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_id INTEGER REFERENCES works(id) ON DELETE SET NULL,
  item TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'recebido',
  received_at TEXT,
  valid_until TEXT,
  deadline_days INTEGER,
  notes TEXT,
  client_notes TEXT,
  client_visible INTEGER NOT NULL DEFAULT 0,
  client_selected INTEGER NOT NULL DEFAULT 0,
  client_selected_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY,
  number TEXT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  project_type TEXT,
  area REAL,
  address TEXT, city TEXT,
  amount REAL NOT NULL DEFAULT 0,
  installments INTEGER DEFAULT 1,
  sent_at TEXT,
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'elaboracao',
  decided_at TEXT,
  refusal_reason TEXT,
  notes TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  responsible_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY,
  number TEXT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  proposal_id INTEGER REFERENCES proposals(id) ON DELETE SET NULL,
  amount REAL NOT NULL DEFAULT 0,
  signed_at TEXT,
  start_date TEXT,
  end_date TEXT,
  payment_method TEXT,
  installments INTEGER DEFAULT 1,
  first_due_date TEXT,
  status TEXT NOT NULL DEFAULT 'elaboracao',
  notes TEXT,
  receivables_generated INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS incomes (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  category TEXT,
  amount REAL NOT NULL,
  due_date TEXT NOT NULL,
  paid_at TEXT,
  method TEXT,
  installment_no INTEGER DEFAULT 1,
  installment_total INTEGER DEFAULT 1,
  group_key TEXT,
  status TEXT NOT NULL DEFAULT 'a_receber',
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  category TEXT,
  amount REAL NOT NULL,
  day INTEGER NOT NULL DEFAULT 10,
  method TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  work_id INTEGER REFERENCES works(id) ON DELETE SET NULL,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  category TEXT,
  amount REAL NOT NULL,
  due_date TEXT NOT NULL,
  paid_at TEXT,
  method TEXT,
  responsible_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  paid_by TEXT NOT NULL DEFAULT 'escritorio',
  status TEXT NOT NULL DEFAULT 'a_pagar',
  recurring_id INTEGER REFERENCES recurring_expenses(id) ON DELETE SET NULL,
  recurring_ref TEXT,
  installment_no INTEGER DEFAULT 1,
  installment_total INTEGER DEFAULT 1,
  group_key TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  UNIQUE (recurring_id, recurring_ref)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  work_id INTEGER REFERENCES works(id) ON DELETE SET NULL,
  phase_id INTEGER REFERENCES project_phases(id) ON DELETE SET NULL,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'pendente',
  due_date TEXT,
  completed_at TEXT,
  position INTEGER DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'reuniao',
  start_at TEXT NOT NULL,
  end_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  work_id INTEGER REFERENCES works(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'agendado',
  notes TEXT,
  minutes TEXT,
  client_visible INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS event_users (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  work_id INTEGER REFERENCES works(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  entity TEXT,
  entity_id INTEGER,
  file_path TEXT,
  file_name TEXT,
  mime TEXT,
  size INTEGER,
  issued_at TEXT,
  expires_at TEXT,
  client_visible INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  hours REAL NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  dedupe_key TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  summary TEXT,
  changes TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Índices
CREATE INDEX IF NOT EXISTS ix_projects_client ON projects(client_id);
CREATE INDEX IF NOT EXISTS ix_phases_project ON project_phases(project_id);
CREATE INDEX IF NOT EXISTS ix_works_project ON works(project_id);
CREATE INDEX IF NOT EXISTS ix_wphases_work ON work_phases(work_id);
CREATE INDEX IF NOT EXISTS ix_wlogs_work ON work_logs(work_id);
CREATE INDEX IF NOT EXISTS ix_tasks_assignee ON tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS ix_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS ix_incomes_due ON incomes(due_date, status);
CREATE INDEX IF NOT EXISTS ix_incomes_project ON incomes(project_id);
CREATE INDEX IF NOT EXISTS ix_incomes_client ON incomes(client_id);
CREATE INDEX IF NOT EXISTS ix_expenses_due ON expenses(due_date, status);
CREATE INDEX IF NOT EXISTS ix_expenses_project ON expenses(project_id);
CREATE INDEX IF NOT EXISTS ix_expenses_work ON expenses(work_id);
CREATE INDEX IF NOT EXISTS ix_events_start ON events(start_at);
CREATE INDEX IF NOT EXISTS ix_docs_entity ON documents(entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_docs_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS ix_check_entity ON checklist_items(entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_comments_entity ON comments(entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_quotes_project ON quotes(project_id);
CREATE INDEX IF NOT EXISTS ix_time_project ON time_entries(project_id);
