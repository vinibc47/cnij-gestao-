// =====================================================================
// Definição declarativa dos cadastros (recursos). Cada recurso descreve
// tabela, campos, busca, filtros, permissões e automações (hooks).
// O CRUD genérico (crud.js) e o frontend (via /api/meta) usam estas
// definições — para criar um novo módulo basta adicionar um recurso aqui.
// =====================================================================
const { get, run, all } = require('./db');
const { today, HttpError } = require('./util');
const P = require('./permissions');
const finance = require('./services/finance');
const proj = require('./services/projects');

const managers = (u) => P.isManager(u);
const fin = (u) => P.canFinance(u);
const staff = (u) => P.isStaff(u);
const scopeBy = (col) => (u) => P.projectScope(u, col);
const projOk = (u, data, row) => {
  const pid = (data && data.project_id) || (row && row.project_id);
  return P.isManager(u) || (pid && P.canAccessProject(u, pid));
};
const workProject = (workId) => (get('SELECT project_id FROM works WHERE id = ?', workId) || {}).project_id;

const F = (name, label, type = 'text', extra = {}) => ({ name, label, type, ...extra });

const R = {};

R.clients = {
  table: 'clients', alias: 'c', label: 'Clientes', singular: 'Cliente', module: 'clientes', title: 'name',
  select: `SELECT c.*, (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS projects_count,
           (SELECT COALESCE(SUM(amount),0) FROM incomes i WHERE i.client_id = c.id AND i.status='recebido') AS total_paid,
           (SELECT COALESCE(SUM(amount),0) FROM incomes i WHERE i.client_id = c.id AND i.status='vencido') AS total_overdue
           FROM clients c`,
  search: ['c.name', 'c.email', 'c.doc', 'c.phone', 'c.whatsapp', 'c.city', 'c.profession'],
  sort: 'c.name ASC', archivable: true,
  fields: [
    F('name', 'Nome', 'text', { required: true, list: true }),
    F('person_type', 'Tipo', 'select', { list: 'PERSON_TYPE', default: 'PF' }),
    F('doc', 'CPF / CNPJ', 'text', { list: true, sensitive: true }),
    F('phone', 'Telefone', 'phone'), F('whatsapp', 'WhatsApp', 'phone', { list: true }),
    F('email', 'E-mail', 'email', { list: true }),
    F('address', 'Endereço', 'text', { wide: true }), F('city', 'Cidade', 'text', { list: true }), F('state', 'UF', 'text'), F('zip', 'CEP', 'text'),
    F('profession', 'Profissão / empresa'), F('origin', 'Origem do cliente', 'option', { opt: 'origem_cliente', filter: true }),
    F('birthday', 'Aniversário', 'date'),
    F('notes', 'Observações', 'textarea', { wide: true }),
  ],
  columns: ['name', 'whatsapp', 'email', 'city', 'origin', 'projects_count', 'total_overdue'],
  read: managers, write: managers,
};

R.client_interactions = {
  table: 'client_interactions', alias: 'ci', label: 'Histórico de relacionamento', singular: 'Registro', module: 'clientes',
  select: `SELECT ci.*, u.name AS user_name, p.name AS project_name FROM client_interactions ci
           LEFT JOIN users u ON u.id = ci.user_id LEFT JOIN projects p ON p.id = ci.project_id`,
  search: ['ci.description'], sort: 'ci.date DESC',
  fields: [
    F('client_id', 'Cliente', 'ref', { ref: 'clients', required: true }), F('project_id', 'Projeto', 'ref', { ref: 'projects' }),
    F('date', 'Data', 'date', { required: true, default: '$today' }), F('type', 'Tipo', 'select', { list: 'INTERACTION_TYPES' }),
    F('description', 'Descrição', 'textarea', { required: true, wide: true }),
  ],
  read: managers, write: managers,
  beforeCreate: (d, u) => { d.user_id = u.id; },
};

R.projects = {
  table: 'projects', alias: 'p', label: 'Projetos', singular: 'Projeto', module: 'projetos', title: 'name',
  select: `SELECT p.*, c.name AS client_name, u.name AS manager_name,
           (SELECT name FROM project_phases ph WHERE ph.project_id = p.id AND ph.status NOT IN ('concluido','aprovado') ORDER BY position LIMIT 1) AS current_phase,
           (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status <> 'concluida' AND t.archived = 0) AS open_tasks,
           (SELECT COUNT(*) FROM works w WHERE w.project_id = p.id) AS works_count,
           CASE WHEN p.due_date < date('now','localtime') AND p.status NOT IN ('encerrado','cancelado') THEN 1 ELSE 0 END AS is_late
           FROM projects p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = p.manager_id`,
  search: ['p.name', 'p.code', 'c.name', 'p.city', 'p.address'], sort: 'p.due_date IS NULL, p.due_date ASC', archivable: true,
  fields: [
    F('name', 'Nome do projeto', 'text', { required: true }), F('code', 'Código', 'text', { readonly: true }),
    F('client_id', 'Cliente', 'ref', { ref: 'clients', filter: true }),
    F('type', 'Tipo de projeto', 'option', { opt: 'projeto_tipo', filter: true }),
    F('status', 'Status', 'select', { list: 'PROJECT_STATUS', default: 'ativo', filter: true }),
    F('address', 'Endereço', 'text', { wide: true }), F('city', 'Cidade'),
    F('area', 'Área (m²)', 'number'), F('contract_value', 'Valor contratado', 'money', { finance: true }),
    F('contracted_at', 'Data de contratação', 'date', { default: '$today' }), F('start_date', 'Início', 'date'),
    F('due_date', 'Previsão de entrega', 'date'),
    F('manager_id', 'Responsável', 'ref', { ref: 'users', filter: true }),
    F('member_ids', 'Equipe envolvida', 'users', { virtual: true, wide: true }),
    F('progress', 'Andamento (%)', 'percent', { readonly: true }),
    F('portal_message', 'Mensagem para o cliente (portal)', 'textarea', { wide: true }),
    F('notes', 'Observações internas', 'textarea', { wide: true }),
  ],
  columns: ['name', 'client_name', 'type', 'current_phase', 'progress', 'due_date', 'manager_name', 'status'],
  read: staff, scope: scopeBy('p.id'),
  write: (u, row) => managers(u) || (row && row.manager_id === u.id),
  create: managers,
  remove: (u) => u.role === 'admin',
  beforeCreate: (d, u) => { d.code = proj.nextCode('projects', 'P'); d.created_by = u.id; if (!d.manager_id) d.manager_id = u.id; },
  beforeUpdate: (d, row) => {
    if (d.status === 'encerrado' && row.status !== 'encerrado') d.closed_at = today();
    if (d.status && d.status !== 'encerrado' && row.status === 'encerrado') d.closed_at = null;
  },
  afterSave: (id, d, u, created, body) => {
    if (created && !body.skip_phases) proj.createPhasesFromTemplate(id, d.start_date || d.contracted_at);
    if (Array.isArray(body.member_ids)) {
      run('DELETE FROM project_members WHERE project_id = ?', id);
      body.member_ids.forEach((uid) => run('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES (?,?)', id, uid));
    }
    const p = get('SELECT manager_id FROM projects WHERE id = ?', id);
    if (p && p.manager_id) run('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES (?,?)', id, p.manager_id);
  },
  loadVirtual: (row) => { row.member_ids = all('SELECT user_id FROM project_members WHERE project_id = ?', row.id).map((r) => r.user_id); },
};

R.project_phases = {
  table: 'project_phases', alias: 'ph', label: 'Etapas do projeto', singular: 'Etapa', module: 'projetos',
  select: `SELECT ph.*, u.name AS responsible_name, p.name AS project_name,
           (SELECT COUNT(*) FROM checklist_items ci WHERE ci.entity='project_phases' AND ci.entity_id = ph.id) AS check_total,
           (SELECT COUNT(*) FROM checklist_items ci WHERE ci.entity='project_phases' AND ci.entity_id = ph.id AND done = 1) AS check_done
           FROM project_phases ph LEFT JOIN users u ON u.id = ph.responsible_id LEFT JOIN projects p ON p.id = ph.project_id`,
  search: ['ph.name'], sort: 'ph.position ASC',
  fields: [
    F('project_id', 'Projeto', 'ref', { ref: 'projects', required: true }), F('name', 'Etapa', 'text', { required: true }),
    F('status', 'Status', 'select', { list: 'PHASE_STATUS', default: 'nao_iniciado' }),
    F('start_date', 'Início', 'date'), F('due_date', 'Prazo', 'date'), F('responsible_id', 'Responsável', 'ref', { ref: 'users' }),
    F('position', 'Ordem', 'number'), F('client_visible', 'Visível para o cliente', 'bool', { default: 1 }),
    F('notes', 'Observações', 'textarea', { wide: true }),
  ],
  read: staff, scope: scopeBy('ph.project_id'),
  write: (u, row, d) => projOk(u, d, row),
  beforeCreate: (d) => { if (d.position == null) d.position = (get('SELECT MAX(position) m FROM project_phases WHERE project_id = ?', d.project_id).m ?? -1) + 1; },
  beforeUpdate: (d, row) => {
    if (d.status && proj.DONE_PHASE.includes(d.status) && !proj.DONE_PHASE.includes(row.status)) d.completed_at = today();
    if (d.status && !proj.DONE_PHASE.includes(d.status)) d.completed_at = null;
  },
  afterSave: (id, d, u, created, body, row) => proj.recomputeProjectProgress(d.project_id || row.project_id),
  afterDelete: (row) => proj.recomputeProjectProgress(row.project_id),
};

R.works = {
  table: 'works', alias: 'w', label: 'Obras', singular: 'Obra', module: 'obras', title: 'name',
  select: `SELECT w.*, p.name AS project_name, p.client_id, c.name AS client_name, u.name AS responsible_name,
           (SELECT COALESCE(SUM(amount),0) FROM expenses e WHERE e.work_id = w.id AND e.status <> 'cancelado') AS spent,
           w.budget - (SELECT COALESCE(SUM(amount),0) FROM expenses e WHERE e.work_id = w.id AND e.status <> 'cancelado') AS available,
           (SELECT MAX(date) FROM work_logs l WHERE l.work_id = w.id) AS last_log
           FROM works w JOIN projects p ON p.id = w.project_id LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = w.responsible_id`,
  search: ['w.name', 'p.name', 'c.name', 'w.address'], sort: 'w.status, w.due_date', archivable: true,
  fields: [
    F('project_id', 'Projeto', 'ref', { ref: 'projects', required: true, filter: true }), F('name', 'Nome da obra', 'text'),
    F('status', 'Status', 'select', { list: 'WORK_STATUS', default: 'em_andamento', filter: true }),
    F('address', 'Endereço da obra', 'text', { wide: true }),
    F('start_date', 'Data de início', 'date'), F('due_date', 'Previsão de conclusão', 'date'),
    F('responsible_id', 'Responsável', 'ref', { ref: 'users', filter: true }),
    F('budget', 'Orçamento previsto', 'money'), F('progress', 'Percentual executado', 'percent'),
    F('notes', 'Observações', 'textarea', { wide: true }),
  ],
  columns: ['name', 'project_name', 'client_name', 'progress', 'budget', 'spent', 'available', 'due_date', 'status'],
  read: staff, scope: scopeBy('w.project_id'),
  write: (u, row, d) => managers(u) || (row && row.responsible_id === u.id) || projOk(u, d, row),
  create: (u, d) => managers(u) || projOk(u, d),
  beforeCreate: (d) => {
    const p = get('SELECT name, address FROM projects WHERE id = ?', d.project_id);
    if (p) { if (!d.name) d.name = `Obra — ${p.name}`; if (!d.address) d.address = p.address; }
  },
  afterSave: (id, d, u, created, body) => {
    if (created) {
      if (!body.skip_phases) proj.createWorkPhasesFromTemplate(id);
      run("UPDATE projects SET status = 'em_obra' WHERE id = ? AND status IN ('ativo','aguardando_cliente')", d.project_id);
    }
  },
};

R.work_phases = {
  table: 'work_phases', alias: 'wp', label: 'Fases da obra', singular: 'Fase', module: 'obras',
  select: `SELECT wp.*, s.company AS supplier_name, w.project_id FROM work_phases wp JOIN works w ON w.id = wp.work_id LEFT JOIN suppliers s ON s.id = wp.supplier_id`,
  search: ['wp.name'], sort: 'wp.position',
  fields: [
    F('work_id', 'Obra', 'ref', { ref: 'works', required: true }), F('name', 'Fase', 'text', { required: true }),
    F('status', 'Status', 'select', { list: 'PHASE_STATUS', default: 'nao_iniciado' }), F('progress', 'Executado (%)', 'percent'),
    F('start_date', 'Início', 'date'), F('due_date', 'Término previsto', 'date'),
    F('supplier_id', 'Fornecedor', 'ref', { ref: 'suppliers' }), F('responsible', 'Responsável pela etapa', 'text'),
    F('position', 'Ordem', 'number'),
    F('pending', 'Pendências da etapa', 'textarea', { wide: true }), F('next_action', 'Próxima ação', 'textarea', { wide: true }),
    F('notes', 'Observações', 'textarea', { wide: true }),
  ],
  read: staff, scope: scopeBy('w.project_id'),
  write: (u, row, d) => projOk(u, { project_id: workProject((d && d.work_id) || (row && row.work_id)) }),
  beforeCreate: (d) => { if (d.position == null) d.position = (get('SELECT MAX(position) m FROM work_phases WHERE work_id = ?', d.work_id).m ?? -1) + 1; },
  beforeSave: (d, row) => {
    if (d.progress != null) { d.progress = Math.max(0, Math.min(100, Math.round(d.progress))); if (d.progress === 100 && !d.status) d.status = 'concluido'; else if (d.progress > 0 && !d.status && (!row || row.status === 'nao_iniciado')) d.status = 'em_andamento'; }
    if (d.status === 'concluido' && d.progress == null) d.progress = 100;
  },
  afterSave: (id, d, u, c, b, row) => proj.recomputeWorkProgress(d.work_id || row.work_id),
  afterDelete: (row) => proj.recomputeWorkProgress(row.work_id),
};

R.work_logs = {
  table: 'work_logs', alias: 'wl', label: 'Diário de obra', singular: 'Registro do diário', module: 'obras',
  select: `SELECT wl.*, u.name AS user_name, w.project_id, w.name AS work_name FROM work_logs wl JOIN works w ON w.id = wl.work_id LEFT JOIN users u ON u.id = wl.user_id`,
  search: ['wl.description', 'wl.decisions', 'wl.pending', 'wl.problems'], sort: 'wl.date DESC, wl.id DESC',
  fields: [
    F('work_id', 'Obra', 'ref', { ref: 'works', required: true }), F('date', 'Data', 'date', { required: true, default: '$today' }),
    F('kind', 'Tipo', 'select', { list: 'WORK_LOG_KIND', default: 'registro' }), F('user_id', 'Responsável', 'ref', { ref: 'users', default: '$me' }),
    F('description', 'Descrição', 'textarea', { required: true, wide: true }),
    F('decisions', 'Decisões tomadas', 'textarea', { wide: true }), F('problems', 'Problemas encontrados', 'textarea', { wide: true }),
    F('pending', 'Pendências', 'textarea', { wide: true }), F('suppliers_present', 'Fornecedores presentes', 'suppliers', { wide: true }),
    F('client_visible', 'Mostrar na área do cliente', 'bool', { default: 0 }),
  ],
  read: staff, scope: scopeBy('w.project_id'),
  write: (u, row, d) => projOk(u, { project_id: workProject((d && d.work_id) || (row && row.work_id)) }),
  beforeSave: (d) => { if (Array.isArray(d.suppliers_present)) d.suppliers_present = JSON.stringify(d.suppliers_present); },
};

R.tasks = {
  table: 'tasks', alias: 't', label: 'Tarefas', singular: 'Tarefa', module: 'tarefas', title: 'title',
  select: `SELECT t.*, p.name AS project_name, COALESCE(c.name, pc.name) AS client_name, u.name AS assignee_name, u.color AS assignee_color,
           cb.name AS creator_name,
           (SELECT COUNT(*) FROM checklist_items ci WHERE ci.entity='tasks' AND ci.entity_id = t.id) AS check_total,
           (SELECT COUNT(*) FROM checklist_items ci WHERE ci.entity='tasks' AND ci.entity_id = t.id AND done = 1) AS check_done,
           (SELECT COUNT(*) FROM comments co WHERE co.entity='tasks' AND co.entity_id = t.id) AS comments_count,
           CASE WHEN t.due_date < date('now','localtime') AND t.status <> 'concluida' THEN 1 ELSE 0 END AS is_late
           FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN clients c ON c.id = t.client_id
           LEFT JOIN clients pc ON pc.id = p.client_id LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN users cb ON cb.id = t.created_by`,
  search: ['t.title', 't.description', 'p.name', 'c.name'],
  sort: "CASE t.status WHEN 'concluida' THEN 1 ELSE 0 END, t.due_date IS NULL, t.due_date, CASE t.priority WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END",
  archivable: true,
  fields: [
    F('title', 'Título', 'text', { required: true, wide: true }), F('description', 'Descrição', 'textarea', { wide: true }),
    F('project_id', 'Projeto', 'ref', { ref: 'projects', filter: true }), F('client_id', 'Cliente', 'ref', { ref: 'clients' }),
    F('work_id', 'Obra', 'ref', { ref: 'works' }), F('phase_id', 'Etapa do projeto', 'ref', { ref: 'project_phases', dependsOn: 'project_id' }),
    F('assignee_id', 'Responsável', 'ref', { ref: 'users', filter: true, default: '$me' }),
    F('priority', 'Prioridade', 'select', { list: 'TASK_PRIORITY', default: 'normal', filter: true }),
    F('status', 'Status', 'select', { list: 'TASK_STATUS', default: 'pendente', filter: true }),
    F('due_date', 'Data limite', 'date'),
  ],
  columns: ['title', 'project_name', 'assignee_name', 'priority', 'due_date', 'status'],
  read: staff,
  scope: (u) => {
    if (P.isManager(u)) return { sql: '1=1', params: [] };
    const s = P.projectScope(u, 't.project_id');
    return { sql: `(t.assignee_id = ? OR t.created_by = ? OR ${s.sql})`, params: [u.id, u.id, ...s.params] };
  },
  write: (u, row, d) => managers(u) || !row || row.assignee_id === u.id || row.created_by === u.id || projOk(u, d, row),
  create: (u, d) => managers(u) || !d.project_id || projOk(u, d),
  beforeCreate: (d, u) => { d.created_by = u.id; },
  beforeSave: (d, row) => {
    if (d.status === 'concluida' && (!row || row.status !== 'concluida')) d.completed_at = today();
    if (d.status && d.status !== 'concluida') d.completed_at = null;
    if (d.project_id && !d.client_id && (!row || !row.client_id)) { const p = get('SELECT client_id FROM projects WHERE id = ?', d.project_id); if (p) d.client_id = p.client_id; }
  },
};

R.suppliers = {
  table: 'suppliers', alias: 's', label: 'Fornecedores', singular: 'Fornecedor', module: 'fornecedores', title: 'company',
  select: `SELECT s.*, (SELECT ROUND(AVG(rating),1) FROM supplier_reviews r WHERE r.supplier_id = s.id) AS rating,
           (SELECT COUNT(*) FROM supplier_reviews r WHERE r.supplier_id = s.id) AS reviews_count,
           (SELECT COUNT(DISTINCT project_id) FROM quotes q WHERE q.supplier_id = s.id) AS projects_count
           FROM suppliers s`,
  search: ['s.company', 's.contact', 's.email', 's.cnpj', 's.category', 's.city'], sort: 's.company', archivable: true,
  fields: [
    F('company', 'Empresa', 'text', { required: true }), F('contact', 'Responsável'),
    F('category', 'Categoria', 'option', { opt: 'fornecedor', filter: true }),
    F('phone', 'Telefone', 'phone'), F('whatsapp', 'WhatsApp', 'phone'), F('email', 'E-mail', 'email'),
    F('cnpj', 'CNPJ / CPF'), F('city', 'Cidade'), F('pix', 'Chave PIX / dados bancários', 'text', { finance: true }),
    F('rt_percent', 'Reserva técnica (%)', 'number', { finance: true }),
    F('notes', 'Observações', 'textarea', { wide: true }),
  ],
  columns: ['company', 'category', 'contact', 'whatsapp', 'city', 'rating', 'projects_count'],
  read: (u) => P.hasModule(u, 'fornecedores'), write: managers,
};

R.supplier_reviews = {
  table: 'supplier_reviews', alias: 'r', label: 'Avaliações internas', singular: 'Avaliação', module: 'fornecedores',
  select: `SELECT r.*, u.name AS user_name, p.name AS project_name FROM supplier_reviews r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN projects p ON p.id = r.project_id`,
  search: ['r.comment'], sort: 'r.created_at DESC',
  fields: [
    F('supplier_id', 'Fornecedor', 'ref', { ref: 'suppliers', required: true }), F('project_id', 'Projeto', 'ref', { ref: 'projects' }),
    F('rating', 'Nota (1 a 5)', 'rating', { required: true, default: 5 }), F('comment', 'Comentário', 'textarea', { wide: true }),
  ],
  read: (u) => P.hasModule(u, 'fornecedores'), write: (u, row) => managers(u) || !row || row.user_id === u.id,
  beforeCreate: (d, u) => { d.user_id = u.id; },
};

R.quotes = {
  table: 'quotes', alias: 'q', label: 'Orçamentos de obra', singular: 'Orçamento', module: 'obras',
  select: `SELECT q.*, s.company AS supplier_name, p.name AS project_name, w.name AS work_name FROM quotes q
           LEFT JOIN suppliers s ON s.id = q.supplier_id JOIN projects p ON p.id = q.project_id LEFT JOIN works w ON w.id = q.work_id`,
  search: ['q.item', 's.company', 'p.name'], sort: 'q.item, q.amount',
  fields: [
    F('project_id', 'Projeto', 'ref', { ref: 'projects', required: true, filter: true }), F('work_id', 'Obra', 'ref', { ref: 'works' }),
    F('item', 'Item (ex.: Marcenaria)', 'option', { opt: 'fornecedor', free: true, required: true, filter: true }),
    F('supplier_id', 'Fornecedor', 'ref', { ref: 'suppliers', filter: true }), F('amount', 'Valor', 'money'),
    F('scope', 'Descrição do escopo', 'textarea', { wide: true }),
    F('status', 'Status', 'select', { list: 'QUOTE_STATUS', default: 'recebido', filter: true }),
    F('received_at', 'Recebido em', 'date', { default: '$today' }), F('valid_until', 'Validade', 'date'),
    F('deadline_days', 'Prazo de execução (dias)', 'number'),
    F('payment_terms', 'Condições de pagamento', 'text', { wide: true }),
    F('included', 'Itens incluídos (um por linha)', 'textarea', { wide: true }),
    F('excluded', 'Itens não incluídos (um por linha)', 'textarea', { wide: true }),
    F('client_visible', 'Liberar para o cliente', 'bool', { default: 0 }),
    F('client_notes', 'Observações para o cliente', 'textarea', { wide: true }),
    F('notes', 'Observações internas', 'textarea', { wide: true }),
  ],
  columns: ['item', 'supplier_name', 'project_name', 'amount', 'status', 'client_visible', 'client_selected'],
  read: (u) => P.hasModule(u, 'obras'), scope: scopeBy('q.project_id'), write: (u, row, d) => managers(u) || projOk(u, d, row),
  beforeSave: (d, row) => {
    if ('amount' in d && d.amount == null) d.amount = 0; if (!row && d.amount == null) d.amount = 0;
    if (d.client_visible == 1 && (!row || !row.client_visible)) d.published_at = require('./util').nowIso();
    // orçamento já aprovado que muda de valor ou escopo vira nova versão (a aprovação anterior fica ligada à versão original)
    if (row) {
      const KEYS = ['amount', 'scope', 'included', 'excluded', 'payment_terms', 'deadline_days', 'supplier_id'];
      const changed = KEYS.some((k) => k in d && String(d[k] ?? '') !== String(row[k] ?? ''));
      if (changed && get("SELECT 1 FROM approval_events e JOIN approvals a ON a.id = e.approval_id WHERE e.quote_id = ? AND e.quote_version = ? AND e.action = 'aprovada' AND a.status = 'aprovada' AND a.decided_quote_id = ?", row.id, row.version || 1, row.id)) {
        d.version = (row.version || 1) + 1; d.client_selected = 0; d.client_selected_at = null;
      }
    }
  },
  afterSave: (id, d, u, created, body, row) => {
    if (!row || !d.version || d.version === row.version) return;
    require('./services/approvals').quoteRevised(id, d.version, u);
  },
};

R.proposals = {
  table: 'proposals', alias: 'pr', label: 'Propostas', singular: 'Proposta', module: 'propostas', title: 'title',
  select: `SELECT pr.*, COALESCE(c.name, pr.prospect_name) AS client_name, CASE WHEN pr.client_id IS NULL THEN 1 ELSE 0 END AS is_prospect, u.name AS responsible_name, p.name AS project_name,
           CASE WHEN pr.valid_until < date('now','localtime') AND pr.status IN ('enviada','visualizada','negociacao') THEN 1 ELSE 0 END AS is_expired
           FROM proposals pr LEFT JOIN clients c ON c.id = pr.client_id LEFT JOIN users u ON u.id = pr.responsible_id LEFT JOIN projects p ON p.id = pr.project_id`,
  search: ['pr.title', 'pr.number', 'c.name', 'pr.prospect_name', 'pr.contact_name', 'pr.address'], sort: 'pr.created_at DESC', archivable: true,
  fields: [
    F('number', 'Número', 'text', { readonly: true }), F('client_id', 'Cliente', 'ref', { ref: 'clients', required: true, filter: true }),
    F('title', 'Projeto / escopo', 'text', { required: true }), F('project_type', 'Tipo de projeto', 'option', { opt: 'projeto_tipo' }),
    F('area', 'Área (m²)', 'number'), F('address', 'Endereço do imóvel', 'text'), F('city', 'Cidade'),
    F('amount', 'Valor', 'money', { required: true }), F('installments', 'Parcelas previstas', 'number', { default: 1 }),
    F('sent_at', 'Data de envio', 'date'), F('valid_until', 'Validade', 'date'),
    F('status', 'Status', 'select', { list: 'PROPOSAL_STATUS', default: 'elaboracao', filter: true }),
    F('responsible_id', 'Responsável', 'ref', { ref: 'users', default: '$me' }),
    F('refusal_reason', 'Motivo da recusa', 'text', { wide: true, showIf: { status: ['recusada'] } }),
    F('notes', 'Observações', 'textarea', { wide: true }),
  ],
  columns: ['number', 'client_name', 'title', 'amount', 'sent_at', 'valid_until', 'status'],
  read: managers, write: managers,
  beforeCreate: (d) => { d.number = proj.nextCode('proposals', 'PR'); },
  beforeSave: (d, row) => {
    if (d.status && ['aprovada', 'recusada', 'expirada'].includes(d.status) && (!row || row.status !== d.status)) d.decided_at = today();
    if (d.status === 'enviada' && !d.sent_at && (!row || !row.sent_at)) d.sent_at = today();
  },
  afterSave: (id, d, u, created, body, row) => {
    if (d.status && (!row || row.status !== d.status)) {
      const pr = get('SELECT * FROM proposals WHERE id = ?', id);
      const label = { enviada: 'Proposta enviada', aprovada: 'Proposta aprovada', recusada: 'Proposta recusada', negociacao: 'Proposta em negociação' }[d.status];
      if (label) run('INSERT INTO client_interactions(client_id, date, type, description, user_id) VALUES (?,?,?,?,?)', pr.client_id, today(), 'feedback', `${label} — ${pr.number} ${pr.title}`, u.id);
    }
  },
};

R.contracts = {
  table: 'contracts', alias: 'ct', label: 'Contratos', singular: 'Contrato', module: 'contratos', title: 'number',
  select: `SELECT ct.*, c.name AS client_name, p.name AS project_name, pr.number AS proposal_number,
           (SELECT COALESCE(SUM(amount),0) FROM incomes i WHERE i.contract_id = ct.id AND i.status = 'recebido') AS received,
           (SELECT COUNT(*) FROM documents d WHERE d.entity='contracts' AND d.entity_id = ct.id) AS docs_count
           FROM contracts ct LEFT JOIN clients c ON c.id = ct.client_id LEFT JOIN projects p ON p.id = ct.project_id LEFT JOIN proposals pr ON pr.id = ct.proposal_id`,
  search: ['ct.number', 'c.name', 'p.name'], sort: 'ct.created_at DESC', archivable: true,
  fields: [
    F('number', 'Número', 'text', { readonly: true }), F('client_id', 'Cliente', 'ref', { ref: 'clients', required: true, filter: true }),
    F('project_id', 'Projeto', 'ref', { ref: 'projects' }), F('proposal_id', 'Proposta de origem', 'ref', { ref: 'proposals' }),
    F('amount', 'Valor contratado', 'money', { required: true }),
    F('status', 'Status', 'select', { list: 'CONTRACT_STATUS', default: 'aguardando_assinatura', filter: true }),
    F('signed_at', 'Data de assinatura', 'date'), F('start_date', 'Início', 'date'), F('end_date', 'Término', 'date'),
    F('payment_method', 'Forma de pagamento', 'select', { list: 'PAYMENT_METHODS' }),
    F('installments', 'Quantidade de parcelas', 'number', { default: 1 }), F('first_due_date', '1º vencimento', 'date'),
    F('notes', 'Observações', 'textarea', { wide: true }),
  ],
  columns: ['number', 'client_name', 'project_name', 'amount', 'installments', 'signed_at', 'status'],
  read: managers, write: managers,
  beforeCreate: (d) => { d.number = proj.nextCode('contracts', 'CT'); },
  beforeSave: (d, row) => { if (d.status === 'ativo' && !d.signed_at && (!row || !row.signed_at)) d.signed_at = today(); },
  afterSave: (id, d, u, created, body, row) => {
    const c = get('SELECT * FROM contracts WHERE id = ?', id);
    if (created && body.generate_receivables !== false && c.amount > 0 && c.installments > 0) proj.generateContractReceivables(id);
    if (!created && d.status && row.status !== d.status) {
      if (['ativo', 'concluido'].includes(d.status)) { run("UPDATE incomes SET status='a_receber' WHERE contract_id = ? AND status = 'previsto'", id); finance.refreshStatuses(); }
      if (d.status === 'cancelado' && body.cancel_receivables) run("UPDATE incomes SET status='cancelado' WHERE contract_id = ? AND status IN ('previsto','a_receber','vencido')", id);
      if (d.status === 'ativo') run('INSERT INTO client_interactions(client_id, project_id, date, type, description, user_id) VALUES (?,?,?,?,?,?)', c.client_id, c.project_id, c.signed_at || today(), 'feedback', `Contrato ${c.number} assinado`, u.id);
    }
    if (c.project_id && c.proposal_id) run('UPDATE proposals SET project_id = COALESCE(project_id, ?) WHERE id = ?', c.project_id, c.proposal_id);
  },
};

const financeRead = fin;
R.incomes = {
  table: 'incomes', alias: 'i', label: 'Entradas', singular: 'Entrada', module: 'financeiro',
  select: `SELECT i.*, c.name AS client_name, p.name AS project_name, ct.number AS contract_number, s.company AS supplier_name
           FROM incomes i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN projects p ON p.id = i.project_id
           LEFT JOIN contracts ct ON ct.id = i.contract_id LEFT JOIN suppliers s ON s.id = i.supplier_id`,
  search: ['i.description', 'c.name', 'p.name', 'i.category'], sort: 'i.due_date ASC', dateField: 'due_date',
  fields: [
    F('description', 'Descrição', 'text', { required: true, wide: true }),
    F('client_id', 'Cliente', 'ref', { ref: 'clients', filter: true }), F('project_id', 'Projeto relacionado', 'ref', { ref: 'projects', filter: true }),
    F('contract_id', 'Contrato', 'ref', { ref: 'contracts' }),
    F('category', 'Categoria', 'option', { opt: 'receita', filter: true }),
    F('supplier_id', 'Fornecedor (se RT/comissão)', 'ref', { ref: 'suppliers' }),
    F('amount', 'Valor', 'money', { required: true }), F('due_date', 'Vencimento', 'date', { required: true, default: '$today' }),
    F('paid_at', 'Data do pagamento', 'date'), F('method', 'Forma de pagamento', 'select', { list: 'PAYMENT_METHODS' }),
    F('installment_no', 'Parcela nº', 'number', { default: 1 }), F('installment_total', 'Total de parcelas', 'number', { default: 1 }),
    F('status', 'Status', 'select', { list: 'INCOME_STATUS', default: 'a_receber', filter: true }),
    F('notes', 'Observações', 'textarea', { wide: true }),
  ],
  columns: ['due_date', 'description', 'client_name', 'project_name', 'installment_no', 'amount', 'paid_at', 'status'],
  read: financeRead, write: financeRead,
  beforeCreate: (d, u) => { d.created_by = u.id; },
  beforeSave: (d, row) => {
    finance.normalize('incomes', d, row || {});
    if (d.project_id && !d.client_id && !(row && row.client_id)) { const p = get('SELECT client_id FROM projects WHERE id = ?', d.project_id); if (p) d.client_id = p.client_id; }
  },
};

R.expenses = {
  table: 'expenses', alias: 'e', label: 'Saídas', singular: 'Saída', module: 'financeiro',
  select: `SELECT e.*, s.company AS supplier_name, p.name AS project_name, w.name AS work_name, u.name AS responsible_name,
           (SELECT COUNT(*) FROM documents d WHERE d.entity='expenses' AND d.entity_id = e.id) AS receipts_count
           FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id LEFT JOIN projects p ON p.id = e.project_id
           LEFT JOIN works w ON w.id = e.work_id LEFT JOIN users u ON u.id = e.responsible_id`,
  search: ['e.description', 's.company', 'p.name', 'e.category'], sort: 'e.due_date ASC', dateField: 'due_date',
  fields: [
    F('description', 'Descrição', 'text', { required: true, wide: true }),
    F('supplier_id', 'Fornecedor', 'ref', { ref: 'suppliers', filter: true }), F('category', 'Categoria', 'option', { opt: 'despesa', filter: true }),
    F('project_id', 'Projeto relacionado', 'ref', { ref: 'projects', filter: true }), F('work_id', 'Obra relacionada', 'ref', { ref: 'works' }),
    F('amount', 'Valor', 'money', { required: true }), F('due_date', 'Vencimento', 'date', { required: true, default: '$today' }),
    F('paid_at', 'Data do pagamento', 'date'), F('method', 'Forma de pagamento', 'select', { list: 'PAYMENT_METHODS' }),
    F('responsible_id', 'Responsável', 'ref', { ref: 'users', default: '$me' }),
    F('paid_by', 'Quem paga', 'select', { list: 'PAID_BY', default: 'escritorio' }),
    F('status', 'Status', 'select', { list: 'EXPENSE_STATUS', default: 'a_pagar', filter: true }),
    F('installment_no', 'Parcela nº', 'number', { default: 1 }), F('installment_total', 'Total de parcelas', 'number', { default: 1 }),
    F('notes', 'Observações', 'textarea', { wide: true }),
  ],
  columns: ['due_date', 'description', 'supplier_name', 'category', 'project_name', 'amount', 'paid_at', 'status'],
  read: financeRead, write: financeRead,
  beforeCreate: (d, u) => { d.created_by = u.id; },
  beforeSave: (d, row) => {
    finance.normalize('expenses', d, row || {});
    if (d.work_id && !d.project_id && !(row && row.project_id)) d.project_id = workProject(d.work_id);
  },
};

R.recurring_expenses = {
  table: 'recurring_expenses', alias: 'r', label: 'Despesas recorrentes', singular: 'Despesa recorrente', module: 'financeiro',
  select: `SELECT r.*, s.company AS supplier_name FROM recurring_expenses r LEFT JOIN suppliers s ON s.id = r.supplier_id`,
  search: ['r.description', 'r.category'], sort: 'r.active DESC, r.day',
  fields: [
    F('description', 'Descrição (ex.: Adobe, aluguel)', 'text', { required: true, wide: true }),
    F('supplier_id', 'Fornecedor', 'ref', { ref: 'suppliers' }), F('category', 'Categoria', 'option', { opt: 'despesa' }),
    F('amount', 'Valor mensal', 'money', { required: true }), F('day', 'Dia do vencimento', 'number', { required: true, default: 10 }),
    F('method', 'Forma de pagamento', 'select', { list: 'PAYMENT_METHODS' }),
    F('start_date', 'Início', 'date', { required: true, default: '$today' }), F('end_date', 'Término (opcional)', 'date'),
    F('active', 'Ativa', 'bool', { default: 1 }), F('notes', 'Observações', 'textarea', { wide: true }),
  ],
  columns: ['description', 'category', 'amount', 'day', 'start_date', 'active'],
  read: financeRead, write: financeRead,
  beforeSave: (d) => { if (d.day != null) d.day = Math.max(1, Math.min(31, parseInt(d.day, 10) || 1)); },
  afterSave: (id) => finance.syncRecurringFuture(id),
};

R.events = {
  table: 'events', alias: 'ev', label: 'Agenda', singular: 'Evento', module: 'agenda', title: 'title',
  select: `SELECT ev.*, c.name AS client_name, p.name AS project_name,
           (SELECT GROUP_CONCAT(u.name, ', ') FROM event_users eu JOIN users u ON u.id = eu.user_id WHERE eu.event_id = ev.id) AS attendees
           FROM events ev LEFT JOIN clients c ON c.id = ev.client_id LEFT JOIN projects p ON p.id = ev.project_id`,
  search: ['ev.title', 'ev.location', 'c.name', 'p.name'], sort: 'ev.start_at ASC', dateField: 'start_at',
  fields: [
    F('title', 'Título', 'text', { required: true, wide: true }), F('type', 'Tipo', 'select', { list: 'EVENT_TYPES', default: 'reuniao', filter: true }),
    F('start_at', 'Início', 'datetime', { required: true }), F('end_at', 'Fim', 'datetime'), F('all_day', 'Dia inteiro', 'bool'),
    F('location', 'Local', 'text', { wide: true }),
    F('client_id', 'Cliente', 'ref', { ref: 'clients', filter: true }), F('project_id', 'Projeto', 'ref', { ref: 'projects', filter: true }),
    F('work_id', 'Obra', 'ref', { ref: 'works' }), F('user_ids', 'Participantes', 'users', { virtual: true, wide: true }),
    F('status', 'Status', 'select', { list: 'EVENT_STATUS', default: 'agendado' }),
    F('client_visible', 'Mostrar na área do cliente', 'bool', { default: 0 }),
    F('notes', 'Pauta / observações', 'textarea', { wide: true }), F('minutes', 'Ata da reunião', 'textarea', { wide: true }),
  ],
  columns: ['start_at', 'title', 'type', 'client_name', 'project_name', 'attendees', 'status'],
  read: staff,
  scope: (u) => {
    if (P.isManager(u)) return { sql: '1=1', params: [] };
    const s = P.projectScope(u, 'ev.project_id');
    return { sql: `(ev.created_by = ? OR ev.id IN (SELECT event_id FROM event_users WHERE user_id = ?) OR ${s.sql})`, params: [u.id, u.id, ...s.params] };
  },
  write: (u, row) => managers(u) || !row || row.created_by === u.id || !!get('SELECT 1 FROM event_users WHERE event_id = ? AND user_id = ?', row.id, u.id),
  beforeCreate: (d, u) => { d.created_by = u.id; },
  beforeSave: (d) => { if (d.project_id && !d.client_id) { const p = get('SELECT client_id FROM projects WHERE id = ?', d.project_id); if (p) d.client_id = p.client_id; } },
  afterSave: (id, d, u, created, body) => {
    if (Array.isArray(body.user_ids)) {
      run('DELETE FROM event_users WHERE event_id = ?', id);
      body.user_ids.forEach((uid) => run('INSERT OR IGNORE INTO event_users(event_id,user_id) VALUES (?,?)', id, uid));
    } else if (created) run('INSERT OR IGNORE INTO event_users(event_id,user_id) VALUES (?,?)', id, u.id);
    const ev = get('SELECT * FROM events WHERE id = ?', id);
    if (ev.status === 'realizado' && ev.client_id && ['reuniao', 'apresentacao', 'visita_tecnica'].includes(ev.type)
      && !get("SELECT 1 FROM client_interactions WHERE client_id = ? AND description LIKE ?", ev.client_id, `%[ev${id}]%`)) {
      run('INSERT INTO client_interactions(client_id, project_id, date, type, description, user_id) VALUES (?,?,?,?,?,?)',
        ev.client_id, ev.project_id, ev.start_at.slice(0, 10), ev.type === 'reuniao' ? 'reuniao' : 'visita', `${ev.title} realizada [ev${id}]`, u.id);
    }
  },
  loadVirtual: (row) => { row.user_ids = all('SELECT user_id FROM event_users WHERE event_id = ?', row.id).map((r) => r.user_id); },
};

R.documents = {
  table: 'documents', alias: 'd', label: 'Documentos', singular: 'Documento', module: 'documentos', title: 'title',
  select: `SELECT d.*, c.name AS client_name, p.name AS project_name, s.company AS supplier_name, u.name AS uploaded_by_name,
           CASE WHEN d.expires_at IS NOT NULL AND d.expires_at < date('now','localtime') THEN 1 ELSE 0 END AS is_expired
           FROM documents d LEFT JOIN clients c ON c.id = d.client_id LEFT JOIN projects p ON p.id = d.project_id
           LEFT JOIN suppliers s ON s.id = d.supplier_id LEFT JOIN users u ON u.id = d.uploaded_by`,
  search: ['d.title', 'd.file_name', 'd.category', 'c.name', 'p.name', 's.company', 'd.notes'], sort: 'd.created_at DESC', archivable: true,
  fields: [
    F('title', 'Título', 'text', { required: true, wide: true }), F('category', 'Categoria', 'option', { opt: 'documento', filter: true }),
    F('client_id', 'Cliente', 'ref', { ref: 'clients', filter: true }), F('project_id', 'Projeto', 'ref', { ref: 'projects', filter: true }),
    F('work_id', 'Obra', 'ref', { ref: 'works' }), F('supplier_id', 'Fornecedor', 'ref', { ref: 'suppliers', filter: true }),
    F('issued_at', 'Data de emissão', 'date'), F('expires_at', 'Validade', 'date'),
    F('client_visible', 'Liberar na área do cliente', 'bool', { default: 0 }),
    F('notes', 'Observações', 'textarea', { wide: true }),
  ],
  columns: ['title', 'category', 'client_name', 'project_name', 'expires_at', 'created_at'],
  read: staff,
  scope: (u) => {
    if (P.isManager(u)) return { sql: '1=1', params: [] };
    const s = P.projectScope(u, 'd.project_id');
    const hideFin = "COALESCE(d.entity,'') NOT IN ('incomes','expenses','contracts')";
    return { sql: `((d.uploaded_by = ? OR ${s.sql}) AND ${hideFin})`, params: [u.id, ...s.params] };
  },
  write: (u, row, d) => managers(u) || (row && row.uploaded_by === u.id) || projOk(u, d, row),
  beforeCreate: (d, u) => { d.uploaded_by = u.id; },
  beforeSave: (d, row) => { if (d.client_visible == 1 && (!row || !row.client_visible)) d.published_at = require('./util').nowIso(); },
  afterDelete: (row) => {
    if (!row.file_path) return;
    const fs = require('fs'); const path = require('path');
    const dir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
    fs.unlink(path.join(dir, row.file_path), () => {});
  },
};

R.time_entries = {
  table: 'time_entries', alias: 'te', label: 'Horas trabalhadas', singular: 'Registro de horas', module: 'projetos',
  select: `SELECT te.*, u.name AS user_name, p.name AS project_name, t.title AS task_title FROM time_entries te
           JOIN users u ON u.id = te.user_id JOIN projects p ON p.id = te.project_id LEFT JOIN tasks t ON t.id = te.task_id`,
  search: ['te.description', 'p.name'], sort: 'te.date DESC', dateField: 'date',
  fields: [
    F('project_id', 'Projeto', 'ref', { ref: 'projects', required: true, filter: true }), F('task_id', 'Tarefa', 'ref', { ref: 'tasks' }),
    F('user_id', 'Pessoa', 'ref', { ref: 'users', default: '$me', filter: true }), F('date', 'Data', 'date', { required: true, default: '$today' }),
    F('hours', 'Horas', 'number', { required: true }), F('description', 'Descrição', 'text', { wide: true }),
  ],
  columns: ['date', 'user_name', 'project_name', 'hours', 'description'],
  read: staff,
  scope: (u) => (P.isManager(u) ? { sql: '1=1', params: [] } : { sql: 'te.user_id = ?', params: [u.id] }),
  write: (u, row, d) => managers(u) || ((!row || row.user_id === u.id) && (!d || !d.user_id || d.user_id === u.id)),
  beforeCreate: (d, u) => { if (!d.user_id || !P.isManager(u)) d.user_id = d.user_id && P.isManager(u) ? d.user_id : u.id; },
};

R.meeting_minutes = {
  table: 'meeting_minutes', alias: 'mm', label: 'Atas de reunião', singular: 'Ata', module: 'atas', title: 'title',
  select: `SELECT mm.*, c.name AS client_name, p.name AS project_name, p.code AS project_code, u.name AS created_by_name FROM meeting_minutes mm
           LEFT JOIN clients c ON c.id = mm.client_id LEFT JOIN projects p ON p.id = mm.project_id LEFT JOIN users u ON u.id = mm.created_by`,
  search: ['mm.title', 'mm.participants', 'mm.content', 'c.name', 'p.name', 'p.code', 'mm.number'], sort: 'mm.date DESC, mm.id DESC', archivable: true, dateField: 'date',
  fields: [
    F('number', 'Número', 'text', { readonly: true }), F('date', 'Data da reunião', 'date', { required: true, default: '$today' }),
    F('client_id', 'Cliente', 'ref', { ref: 'clients', filter: true }), F('project_id', 'Projeto', 'ref', { ref: 'projects', filter: true, dependsOn: 'client_id' }),
    F('title', 'Assunto / título', 'text', { wide: true }), F('location', 'Local', 'text'),
    F('participants', 'Participantes', 'textarea', { wide: true }), F('content', 'Assuntos e decisões', 'textarea', { wide: true }),
    F('next_steps', 'Próximos passos', 'json', { wide: true }), F('client_visible', 'Mostrar na Área do Cliente', 'bool', { default: 0 }),
  ],
  columns: ['date', 'title', 'client_name', 'project_name'],
  read: (u) => P.hasModule(u, 'atas'),
  scope: (u) => { if (P.isManager(u)) return { sql: '1=1', params: [] }; const sc = P.projectScope(u, 'mm.project_id'); return { sql: `(mm.created_by = ? OR ${sc.sql})`, params: [u.id, ...sc.params] }; },
  write: (u, row, d) => managers(u) || !row || row.created_by === u.id || projOk(u, d, row),
  create: (u, d) => managers(u) || !d.project_id || projOk(u, d),
  beforeCreate: (d, u) => { d.created_by = u.id; d.number = proj.nextCode('meeting_minutes', 'ATA'); },
  beforeSave: (d, row) => {
    if (d.project_id) { const p = get('SELECT client_id FROM projects WHERE id = ?', d.project_id); if (p && p.client_id && !d.client_id && !(row && row.client_id)) d.client_id = p.client_id; const cid = d.client_id !== undefined ? d.client_id : row && row.client_id; if (p && cid && p.client_id !== cid) throw new HttpError(400, 'O projeto selecionado não pertence a este cliente.'); }
    if (!d.title && !(row && row.title)) d.title = 'Reunião';
  },
};

R.receipts = {
  table: 'receipts', alias: 'rc', label: 'Recibos', singular: 'Recibo', module: 'recibos', title: 'number',
  select: `SELECT rc.*, c.name AS client_name, p.name AS project_name, p.code AS project_code, ct.number AS contract_number, i.status AS income_status, i.description AS income_description
           FROM receipts rc LEFT JOIN clients c ON c.id = rc.client_id LEFT JOIN projects p ON p.id = rc.project_id LEFT JOIN contracts ct ON ct.id = rc.contract_id LEFT JOIN incomes i ON i.id = rc.income_id`,
  search: ['rc.number', 'rc.payer_name', 'rc.description', 'c.name', 'p.name'], sort: 'rc.id DESC', archivable: true, dateField: 'paid_at',
  fields: [F('number', 'Número', 'text', { readonly: true }), F('status', 'Status', 'select', { list: 'RECEIPT_STATUS', filter: true, readonly: true }), F('client_id', 'Cliente', 'ref', { ref: 'clients', filter: true }), F('project_id', 'Projeto', 'ref', { ref: 'projects', filter: true })],
  columns: ['number', 'payer_name', 'amount', 'paid_at', 'status'],
  read: fin, write: fin,
};

R.site_signs = {
  table: 'site_signs', alias: 'sg', label: 'Placas de obra', singular: 'Placa', module: 'placas', title: 'title',
  select: `SELECT sg.*, c.name AS client_name, p.name AS project_name, p.code AS project_code FROM site_signs sg LEFT JOIN clients c ON c.id = sg.client_id LEFT JOIN projects p ON p.id = sg.project_id`,
  search: ['sg.title', 'c.name', 'p.name'], sort: 'sg.updated_at DESC, sg.id DESC', archivable: true,
  fields: [F('title', 'Nome da placa', 'text', { required: true }), F('client_id', 'Cliente', 'ref', { ref: 'clients', filter: true }), F('project_id', 'Projeto', 'ref', { ref: 'projects', filter: true })],
  columns: ['title', 'client_name', 'project_name', 'size'],
  read: (u) => P.hasModule(u, 'placas'), write: (u) => P.hasModule(u, 'placas'),
};

// Filtros rápidos (presets) — aplicados sobre as colunas da consulta (alias x)
const T = "date('now','localtime')";
R.projects.presets = {
  ativos: "x.status IN ('ativo','aguardando_cliente','em_obra')",
  aguardando_cliente: "(x.status = 'aguardando_cliente' OR x.id IN (SELECT project_id FROM project_phases WHERE status = 'aguardando_cliente'))",
  atrasados: 'x.is_late = 1',
  em_obra: "x.status = 'em_obra'",
  encerrados: "x.status IN ('encerrado','cancelado')",
  meus: (u) => ({ sql: '(x.manager_id = ? OR x.id IN (SELECT project_id FROM project_members WHERE user_id = ?))', params: [u.id, u.id] }),
};
R.tasks.presets = {
  minhas: (u) => ({ sql: 'x.assignee_id = ?', params: [u.id] }),
  hoje: `x.status <> 'concluida' AND x.due_date = ${T}`,
  semana: `x.status <> 'concluida' AND x.due_date BETWEEN ${T} AND date('now','localtime','+7 days')`,
  atrasadas: 'x.is_late = 1',
  abertas: "x.status <> 'concluida'",
};
R.incomes.presets = {
  abertas: "x.status IN ('previsto','a_receber','vencido')", vencidas: "x.status = 'vencido'", recebidas: "x.status = 'recebido'",
  mes: `substr(x.due_date,1,7) = strftime('%Y-%m', ${T})`,
};
R.expenses.presets = {
  abertas: "x.status IN ('previsto','a_pagar','vencido')", vencidas: "x.status = 'vencido'", pagas: "x.status = 'pago'",
  mes: `substr(x.due_date,1,7) = strftime('%Y-%m', ${T})`,
};
R.proposals.presets = { abertas: "x.status IN ('elaboracao','enviada')", aguardando: "x.status = 'enviada'", honorarios: "x.kind = 'honorarios'", simples: "COALESCE(x.kind,'simples') <> 'honorarios'",
  honorarios_abertas: "x.kind = 'honorarios' AND x.status IN ('elaboracao','enviada')", simples_abertas: "COALESCE(x.kind,'simples') <> 'honorarios' AND x.status IN ('elaboracao','enviada')" };
R.contracts.presets = { aguardando: "x.status = 'aguardando_assinatura'", ativos: "x.status = 'ativo'" };
R.works.presets = { andamento: "x.status = 'em_andamento'", concluidas: "x.status = 'concluida'" };
R.documents.presets = {
  vencendo: `x.expires_at IS NOT NULL AND x.expires_at <= date('now','localtime','+30 days')`,
  cliente: 'x.client_visible = 1', central: 'x.entity IS NULL OR x.entity NOT IN (\'work_logs\')',
};
R.events.presets = { proximos: `substr(x.start_at,1,10) >= ${T} AND x.status = 'agendado'` };

// Monta o objeto `meta` enviado ao frontend
function metaFor(u) {
  const out = {};
  for (const [key, r] of Object.entries(R)) {
    if (!r.read(u)) continue;
    out[key] = {
      key, label: r.label, singular: r.singular, module: r.module, title: r.title, archivable: !!r.archivable,
      canCreate: !!(r.create ? r.create(u, {}) : r.write(u, null, {})), dateField: r.dateField,
      fields: r.fields.filter((f) => !f.finance || P.canFinance(u)), columns: r.columns,
    };
  }
  return out;
}

module.exports = { R, metaFor };
