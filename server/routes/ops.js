// Visões consolidadas (projeto, cliente, fornecedor, obra), ações de negócio,
// checklists, comentários e arquivos.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { all, get, run, val, insert, tx } = require('../db');
const { wrap, HttpError, audit, today, round2, nowIso, addDays } = require('../util');
const P = require('../permissions');
const { R } = require('../resources');
const { fetchOne, list } = require('../crud');
const finance = require('../services/finance');
const proj = require('../services/projects');
const automation = require('../services/automation');

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const L = (key, u, q) => (R[key].read(u) ? list(R[key], u, { limit: 1000, archived: 'all', ...q }).rows : []);

// ------------------------------ PROJETO ------------------------------
router.get('/projects/:id/overview', wrap((req, res) => {
  const u = req.user; const id = Number(req.params.id);
  const project = fetchOne(R.projects, u, id);
  const fin = P.canFinance(u);
  const docs = L('documents', u, { f_project_id: id, archived: '0' });
  const out = {
    project,
    client: project.client_id ? get('SELECT id, name, phone, whatsapp, email, city FROM clients WHERE id = ?', project.client_id) : null,
    members: all('SELECT u.id, u.name, u.color, u.job_title FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY u.name', id),
    phases: L('project_phases', u, { f_project_id: id, sort: 'position' }),
    tasks: L('tasks', u, { f_project_id: id }),
    works: L('works', u, { f_project_id: id }),
    quotes: R.quotes.read(u) ? L('quotes', u, { f_project_id: id }) : [],
    contracts: P.isManager(u) ? L('contracts', u, { f_project_id: id }) : [],
    proposals: P.isManager(u) ? L('proposals', u, { f_project_id: id }) : [],
    events: L('events', u, { f_project_id: id, sort: 'start_at', dir: 'desc' }),
    documents: docs.filter((d) => !(d.mime || '').startsWith('image/')),
    images: docs.filter((d) => (d.mime || '').startsWith('image/')),
    time: all('SELECT u.name, SUM(t.hours) hours FROM time_entries t JOIN users u ON u.id = t.user_id WHERE t.project_id = ? GROUP BY t.user_id ORDER BY 2 DESC', id),
    decisions: all(`SELECT wl.date, wl.decisions text, u.name user_name, 'Obra' source FROM work_logs wl JOIN works w ON w.id = wl.work_id LEFT JOIN users u ON u.id = wl.user_id
                    WHERE w.project_id = ? AND wl.decisions IS NOT NULL AND wl.decisions <> '' ORDER BY wl.date DESC`, id),
    suppliers: all(`SELECT DISTINCT s.id, s.company, s.category FROM suppliers s WHERE s.id IN (
                      SELECT supplier_id FROM quotes WHERE project_id = ? UNION SELECT supplier_id FROM expenses WHERE project_id = ?
                      UNION SELECT wp.supplier_id FROM work_phases wp JOIN works w ON w.id = wp.work_id WHERE w.project_id = ?) ORDER BY s.company`, id, id, id),
    all_phases_done: proj.allPhasesDone(id),
    history: all(`SELECT a.*, u.name user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
                  WHERE (a.entity = 'projects' AND a.entity_id = ?) OR (a.entity = 'project_phases' AND a.entity_id IN (SELECT id FROM project_phases WHERE project_id = ?))
                  OR (a.entity = 'tasks' AND a.entity_id IN (SELECT id FROM tasks WHERE project_id = ?)) ORDER BY a.id DESC LIMIT 60`, id, id, id),
  };
  if (fin) {
    out.incomes = L('incomes', u, { f_project_id: id, sort: 'due_date' });
    out.expenses = L('expenses', u, { f_project_id: id, sort: 'due_date' });
    out.profitability = proj.profitability(id);
  }
  res.json(out);
}));

router.post('/projects/:id/phases/reorder', wrap((req, res) => {
  const p = fetchOne(R.projects, req.user, Number(req.params.id));
  if (!R.project_phases.write(req.user, null, { project_id: p.id })) throw new HttpError(403, 'Sem permissão.');
  (req.body.ids || []).forEach((pid, i) => run('UPDATE project_phases SET position = ? WHERE id = ? AND project_id = ?', i, pid, p.id));
  res.json({ ok: true });
}));
router.post('/projects/:id/apply-template', wrap((req, res) => {
  const p = fetchOne(R.projects, req.user, Number(req.params.id));
  if (!P.isManager(req.user)) throw new HttpError(403, 'Sem permissão.');
  if (val('SELECT COUNT(*) FROM project_phases WHERE project_id = ?', p.id)) throw new HttpError(400, 'O projeto já possui etapas.');
  proj.createPhasesFromTemplate(p.id, p.start_date || p.contracted_at); proj.recomputeProjectProgress(p.id);
  res.json({ ok: true });
}));
router.post('/works/:id/phases/reorder', wrap((req, res) => {
  const w = fetchOne(R.works, req.user, Number(req.params.id));
  (req.body.ids || []).forEach((pid, i) => run('UPDATE work_phases SET position = ? WHERE id = ? AND work_id = ?', i, pid, w.id));
  res.json({ ok: true });
}));

// ------------------------------ OBRA ------------------------------
router.get('/works/:id/overview', wrap((req, res) => {
  const u = req.user; const id = Number(req.params.id);
  const work = fetchOne(R.works, u, id);
  const docs = L('documents', u, { f_work_id: id, archived: '0' });
  const logDocs = all("SELECT id, entity_id, title, file_name, mime FROM documents WHERE entity = 'work_logs' AND entity_id IN (SELECT id FROM work_logs WHERE work_id = ?)", id);
  const logs = L('work_logs', u, { f_work_id: id }).map((l) => ({
    ...l, photos: logDocs.filter((d) => d.entity_id === l.id),
    suppliers: (() => { try { const ids = JSON.parse(l.suppliers_present || '[]'); return ids.length ? all(`SELECT id, company FROM suppliers WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : []; } catch { return []; } })(),
  }));
  const out = {
    work, project: get('SELECT id, name, client_id, status FROM projects WHERE id = ?', work.project_id),
    phases: L('work_phases', u, { f_work_id: id, sort: 'position' }), logs,
    quotes: L('quotes', u, { f_project_id: work.project_id }),
    documents: docs.filter((d) => !(d.mime || '').startsWith('image/')), photos: [...docs.filter((d) => (d.mime || '').startsWith('image/')), ...logDocs.filter((d) => (d.mime || '').startsWith('image/'))],
    tasks: L('tasks', u, { f_work_id: id }),
    events: L('events', u, { f_work_id: id }),
    spent_by_category: all("SELECT COALESCE(category,'Sem categoria') label, ROUND(SUM(amount),2) value FROM expenses WHERE work_id = ? AND status <> 'cancelado' GROUP BY 1 ORDER BY 2 DESC", id),
    spent_by_supplier: all("SELECT COALESCE(s.company,'Sem fornecedor') label, ROUND(SUM(e.amount),2) value FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id WHERE e.work_id = ? AND e.status <> 'cancelado' GROUP BY 1 ORDER BY 2 DESC", id),
  };
  if (P.canFinance(u)) out.expenses = L('expenses', u, { f_work_id: id, sort: 'due_date' });
  res.json(out);
}));

// ------------------------------ CLIENTE ------------------------------
router.get('/clients/:id/overview', wrap((req, res) => {
  const u = req.user; const id = Number(req.params.id);
  const client = fetchOne(R.clients, u, id);
  const fin = P.canFinance(u);
  const out = {
    client,
    projects: L('projects', u, { f_client_id: id }),
    proposals: L('proposals', u, { f_client_id: id }),
    contracts: L('contracts', u, { f_client_id: id }),
    events: L('events', u, { f_client_id: id, sort: 'start_at', dir: 'desc' }),
    documents: L('documents', u, { f_client_id: id, archived: '0' }),
    tasks: L('tasks', u, { f_client_id: id }),
    interactions: L('client_interactions', u, { f_client_id: id }),
    portal_users: all("SELECT id, name, email, active, last_login FROM users WHERE role = 'cliente' AND client_id = ?", id),
  };
  if (fin) out.incomes = L('incomes', u, { f_client_id: id, sort: 'due_date' });
  // Linha do tempo consolidada
  const T = [];
  out.interactions.forEach((i) => T.push({ date: i.date, kind: i.type, text: i.description.replace(/\s*\[ev\d+\]/, ''), user: i.user_name }));
  out.proposals.forEach((p) => { if (p.sent_at) T.push({ date: p.sent_at, kind: 'proposta', text: `Proposta ${p.number} enviada — ${p.title}` }); });
  out.contracts.forEach((c) => { if (c.signed_at) T.push({ date: c.signed_at, kind: 'contrato', text: `Contrato ${c.number} assinado` }); });
  out.projects.forEach((p) => T.push({ date: (p.contracted_at || p.created_at).slice(0, 10), kind: 'projeto', text: `Projeto iniciado — ${p.name}` }));
  out.events.filter((e) => e.status === 'agendado').forEach((e) => T.push({ date: e.start_at.slice(0, 10), kind: e.type, text: `${e.title} (agendado)`, future: e.start_at.slice(0, 10) >= today() }));
  (out.incomes || []).filter((i) => i.status === 'recebido').forEach((i) => T.push({ date: i.paid_at, kind: 'pagamento', text: `Pagamento recebido — ${i.description}`, amount: i.amount }));
  const seen = new Set();
  out.timeline = T.filter((x) => x.date).filter((x) => { const k = x.date + x.text; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (fin) out.summary = {
    contracted: round2(out.contracts.filter((c) => c.status !== 'cancelado').reduce((s, c) => s + c.amount, 0)),
    paid: round2(out.incomes.filter((i) => i.status === 'recebido').reduce((s, i) => s + i.amount, 0)),
    pending: round2(out.incomes.filter((i) => ['a_receber', 'previsto'].includes(i.status)).reduce((s, i) => s + i.amount, 0)),
    overdue: round2(out.incomes.filter((i) => i.status === 'vencido').reduce((s, i) => s + i.amount, 0)),
  };
  res.json(out);
}));

// ------------------------------ FORNECEDOR ------------------------------
router.get('/suppliers/:id/overview', wrap((req, res) => {
  const u = req.user; const id = Number(req.params.id);
  const supplier = fetchOne(R.suppliers, u, id);
  const out = {
    supplier,
    quotes: L('quotes', u, { f_supplier_id: id }),
    reviews: L('supplier_reviews', u, { f_supplier_id: id }),
    documents: L('documents', u, { f_supplier_id: id, archived: '0' }),
    phases: all(`SELECT wp.name, wp.status, wp.progress, w.name work_name, w.id work_id, p.name project_name FROM work_phases wp JOIN works w ON w.id = wp.work_id JOIN projects p ON p.id = w.project_id WHERE wp.supplier_id = ?`, id),
  };
  out.projects = all(`SELECT DISTINCT p.id, p.name, p.status, c.name client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id IN (
      SELECT project_id FROM quotes WHERE supplier_id = ? UNION SELECT project_id FROM expenses WHERE supplier_id = ?
      UNION SELECT w.project_id FROM work_phases wp JOIN works w ON w.id = wp.work_id WHERE wp.supplier_id = ?)`, id, id, id);
  if (P.canFinance(u)) {
    out.expenses = L('expenses', u, { f_supplier_id: id, sort: 'due_date', dir: 'desc' });
    out.rt = L('incomes', u, { f_supplier_id: id });
    out.total_paid = round2(out.expenses.filter((e) => e.status === 'pago').reduce((s, e) => s + e.amount, 0));
  }
  res.json(out);
}));

// ------------------------------ AÇÕES DE NEGÓCIO ------------------------------
router.post('/proposals/:id/convert', wrap((req, res) => {
  if (!P.isManager(req.user)) throw new HttpError(403, 'Sem permissão.');
  const pr = fetchOne(R.proposals, req.user, Number(req.params.id));
  const r = proj.convertProposal(pr.id, req.user, req.body || {});
  audit(req, 'convert', 'proposals', pr.id, `Proposta ${pr.number} convertida em projeto`);
  automation.runAutomations(true);
  res.json(r);
}));

router.post('/contracts/:id/receivables', wrap((req, res) => {
  if (!P.canFinance(req.user)) throw new HttpError(403, 'Sem acesso ao financeiro.');
  const c = fetchOne(R.contracts, req.user, Number(req.params.id));
  const ids = proj.generateContractReceivables(c.id, { force: !!req.body.force });
  audit(req, 'generate', 'contracts', c.id, `Parcelas geradas para o contrato ${c.number} (${ids.length})`);
  res.json({ ids });
}));

router.post('/quotes/:id/to-expense', wrap((req, res) => {
  if (!P.canFinance(req.user)) throw new HttpError(403, 'Sem acesso ao financeiro.');
  const q = fetchOne(R.quotes, req.user, Number(req.params.id));
  const b = req.body || {};
  const ids = finance.generateInstallments('expenses', {
    supplier_id: q.supplier_id, project_id: q.project_id, work_id: q.work_id, quote_id: q.id, category: b.category || 'Obra',
    description: `${q.item} — ${q.supplier_name || 'fornecedor'}`, paid_by: b.paid_by || 'escritorio', responsible_id: req.user.id,
    method: b.method || null, created_by: req.user.id,
  }, { total: b.total || q.amount, count: b.count || 1, first_due: b.first_due || today() });
  run("UPDATE quotes SET status = 'contratado' WHERE id = ?", q.id);
  audit(req, 'generate', 'quotes', q.id, `Orçamento ${q.item} contratado — ${ids.length} lançamento(s)`);
  res.json({ ids });
}));

// ------------------------------ FINANCEIRO ------------------------------
router.post('/finance/installments', wrap((req, res) => {
  if (!P.canFinance(req.user)) throw new HttpError(403, 'Sem acesso ao financeiro.');
  const b = req.body || {};
  const table = b.table === 'expenses' ? 'expenses' : 'incomes';
  const r = R[table];
  const base = {};
  for (const f of r.fields) if (b[f.name] !== undefined && b[f.name] !== '' && !['amount', 'due_date', 'installment_no', 'installment_total', 'paid_at'].includes(f.name)) base[f.name] = b[f.name];
  if (!base.description) throw new HttpError(400, 'Informe a descrição.');
  base.created_by = req.user.id;
  if (table === 'incomes' && base.project_id && !base.client_id) base.client_id = (get('SELECT client_id FROM projects WHERE id = ?', base.project_id) || {}).client_id;
  if (table === 'expenses' && base.work_id && !base.project_id) base.project_id = (get('SELECT project_id FROM works WHERE id = ?', base.work_id) || {}).project_id;
  const ids = finance.generateInstallments(table, base, { total: b.total, count: b.count, first_due: b.first_due, interval: b.interval, first_paid: !!b.first_paid });
  audit(req, 'create', table, ids[0], `${ids.length} parcela(s) geradas: ${base.description}`);
  res.status(201).json({ ids });
}));

router.post('/finance/:table/:id/pay', wrap((req, res) => {
  if (!P.canFinance(req.user)) throw new HttpError(403, 'Sem acesso ao financeiro.');
  const table = req.params.table === 'expenses' ? 'expenses' : 'incomes';
  const row = fetchOne(R[table], req.user, Number(req.params.id));
  const paidAt = req.body.paid_at || today();
  const amount = req.body.amount ? round2(req.body.amount) : row.amount;
  tx(() => {
    if (amount < row.amount - 0.009) {
      // Pagamento parcial: o saldo restante vira um novo lançamento com o mesmo vencimento
      const rest = { ...row }; ['id', 'created_at', 'updated_at', 'client_name', 'project_name', 'contract_number', 'supplier_name', 'work_name', 'responsible_name', 'receipts_count'].forEach((k) => delete rest[k]);
      rest.amount = round2(row.amount - amount); rest.paid_at = null; rest.status = finance.OPEN[table];
      rest.description = `${row.description} (saldo)`; finance.normalize(table, rest);
      insert(table, rest);
    }
    run(`UPDATE ${table} SET amount = ?, paid_at = ?, status = ?, method = COALESCE(?, method), updated_at = ? WHERE id = ?`,
      amount, paidAt, finance.PAID[table], req.body.method || null, nowIso(), row.id);
  });
  audit(req, 'pay', table, row.id, `${table === 'incomes' ? 'Recebimento' : 'Pagamento'} registrado: ${row.description} — R$ ${amount.toFixed(2)}`);
  res.json(fetchOne(R[table], req.user, row.id));
}));
router.post('/finance/:table/:id/unpay', wrap((req, res) => {
  if (!P.canFinance(req.user)) throw new HttpError(403, 'Sem acesso ao financeiro.');
  const table = req.params.table === 'expenses' ? 'expenses' : 'incomes';
  const row = fetchOne(R[table], req.user, Number(req.params.id));
  const d = { status: finance.OPEN[table], paid_at: null }; finance.normalize(table, d, row);
  run(`UPDATE ${table} SET status = ?, paid_at = NULL WHERE id = ?`, d.status, row.id);
  audit(req, 'unpay', table, row.id, `Baixa estornada: ${row.description}`);
  res.json(fetchOne(R[table], req.user, row.id));
}));
router.get('/finance/cashflow', wrap((req, res) => {
  if (!P.canFinance(req.user)) throw new HttpError(403, 'Sem acesso ao financeiro.');
  automation.runAutomations();
  res.json(finance.cashflow(Math.min(24, Number(req.query.back) || 6), Math.min(24, Number(req.query.ahead) || 12)));
}));

// ------------------------------ CHECKLIST E COMENTÁRIOS ------------------------------
const PARENTS = ['tasks', 'project_phases', 'projects', 'works', 'work_phases', 'events'];
function parent(req, entity, id) {
  if (!PARENTS.includes(entity)) throw new HttpError(400, 'Entidade inválida.');
  return fetchOne(R[entity], req.user, Number(id));
}
router.get('/checklist/:entity/:id', wrap((req, res) => {
  parent(req, req.params.entity, req.params.id);
  res.json(all('SELECT * FROM checklist_items WHERE entity = ? AND entity_id = ? ORDER BY position, id', req.params.entity, req.params.id));
}));
router.post('/checklist/:entity/:id', wrap((req, res) => {
  const p = parent(req, req.params.entity, req.params.id);
  const text = String(req.body.text || '').trim(); if (!text) throw new HttpError(400, 'Informe o item.');
  const pos = (val('SELECT MAX(position) FROM checklist_items WHERE entity = ? AND entity_id = ?', req.params.entity, p.id) ?? -1) + 1;
  const id = insert('checklist_items', { entity: req.params.entity, entity_id: p.id, text, position: pos });
  res.status(201).json(get('SELECT * FROM checklist_items WHERE id = ?', id));
}));
router.put('/checklist/item/:itemId', wrap((req, res) => {
  const it = get('SELECT * FROM checklist_items WHERE id = ?', req.params.itemId); if (!it) throw new HttpError(404, 'Item não encontrado.');
  parent(req, it.entity, it.entity_id);
  if ('done' in req.body) run('UPDATE checklist_items SET done = ? WHERE id = ?', req.body.done ? 1 : 0, it.id);
  if (req.body.text) run('UPDATE checklist_items SET text = ? WHERE id = ?', String(req.body.text).trim(), it.id);
  res.json(get('SELECT * FROM checklist_items WHERE id = ?', it.id));
}));
router.delete('/checklist/item/:itemId', wrap((req, res) => {
  const it = get('SELECT * FROM checklist_items WHERE id = ?', req.params.itemId); if (!it) throw new HttpError(404, 'Item não encontrado.');
  parent(req, it.entity, it.entity_id);
  run('DELETE FROM checklist_items WHERE id = ?', it.id); res.json({ ok: true });
}));
router.get('/comments/:entity/:id', wrap((req, res) => {
  parent(req, req.params.entity, req.params.id);
  res.json(all('SELECT c.*, u.name user_name, u.color FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE entity = ? AND entity_id = ? ORDER BY c.id', req.params.entity, req.params.id));
}));
router.post('/comments/:entity/:id', wrap((req, res) => {
  const p = parent(req, req.params.entity, req.params.id);
  const body = String(req.body.body || '').trim(); if (!body) throw new HttpError(400, 'Escreva o comentário.');
  const id = insert('comments', { entity: req.params.entity, entity_id: p.id, user_id: req.user.id, body, created_at: nowIso() });
  // avisa o responsável pela tarefa
  if (req.params.entity === 'tasks' && p.assignee_id && p.assignee_id !== req.user.id)
    automation.notify(p.assignee_id, { kind: 'comentario', title: `${req.user.name} comentou em "${p.title}"`, body: body.slice(0, 140), link: `#/tarefas/${p.id}`, key: `comment_${id}` });
  res.status(201).json(get('SELECT c.*, u.name user_name, u.color FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?', id));
}));
router.delete('/comments/:cid', wrap((req, res) => {
  const c = get('SELECT * FROM comments WHERE id = ?', req.params.cid); if (!c) throw new HttpError(404, 'Comentário não encontrado.');
  if (c.user_id !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'Somente o autor pode excluir.');
  run('DELETE FROM comments WHERE id = ?', c.id); res.json({ ok: true });
}));

// ------------------------------ ARQUIVOS ------------------------------
const BLOCKED = /\.(exe|bat|cmd|sh|js|msi|com|scr|ps1|vbs|jar|html?|svg)$/i;
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { const d = path.join(UPLOAD_DIR, new Date().toISOString().slice(0, 7)); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase().slice(0, 10)),
  }),
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_MB) || 30) * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => (BLOCKED.test(file.originalname) ? cb(new HttpError(400, 'Tipo de arquivo não permitido.')) : cb(null, true)),
});
const ATTACHABLE = ['tasks', 'projects', 'project_phases', 'works', 'work_logs', 'expenses', 'incomes', 'contracts', 'proposals', 'quotes', 'suppliers', 'clients', 'events', 'site_signs', 'meeting_minutes', 'receipts'];

router.post('/files', upload.array('files', 20), wrap((req, res) => {
  const u = req.user; const b = req.body || {};
  const files = req.files || [];
  if (!files.length) throw new HttpError(400, 'Nenhum arquivo enviado.');
  const meta = { project_id: b.project_id ? Number(b.project_id) : null, client_id: b.client_id ? Number(b.client_id) : null,
    work_id: b.work_id ? Number(b.work_id) : null, supplier_id: b.supplier_id ? Number(b.supplier_id) : null };
  let entity = null; let entityId = null;
  try {
    if (b.entity) {
      if (!ATTACHABLE.includes(b.entity)) throw new HttpError(400, 'Entidade inválida.');
      const p = fetchOne(R[b.entity], u, Number(b.entity_id));
      entity = b.entity; entityId = p.id;
      if (b.entity === 'projects') meta.project_id = p.id;
      if (b.entity === 'clients') meta.client_id = p.id;
      if (b.entity === 'suppliers') meta.supplier_id = p.id;
      if (b.entity === 'works') meta.work_id = p.id;
      meta.project_id = meta.project_id || p.project_id || null;
      meta.work_id = meta.work_id || p.work_id || null;
      meta.client_id = meta.client_id || p.client_id || null;
      meta.supplier_id = meta.supplier_id || p.supplier_id || null;
    }
    if (meta.project_id && !meta.client_id) meta.client_id = (get('SELECT client_id FROM projects WHERE id = ?', meta.project_id) || {}).client_id || null;
    if (meta.project_id && !P.isManager(u) && !P.canAccessProject(u, meta.project_id)) throw new HttpError(403, 'Sem acesso a este projeto.');
    if (!P.isManager(u) && !meta.project_id && !entity) throw new HttpError(403, 'Vincule o documento a um projeto.');
  } catch (e) { files.forEach((f) => fs.unlink(f.path, () => {})); throw e; }
  const ids = files.map((f) => {
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
    return insert('documents', {
      title: files.length === 1 && b.title ? b.title : name.replace(/\.[^.]+$/, ''), category: b.category || (f.mimetype.startsWith('image/') ? 'Imagens / renders' : null),
      ...meta, entity, entity_id: entityId, file_path: path.relative(UPLOAD_DIR, f.path), file_name: name, mime: f.mimetype, size: f.size,
      expires_at: b.expires_at || null, issued_at: b.issued_at || null, client_visible: b.client_visible === '1' || b.client_visible === 'true' ? 1 : 0,
      notes: b.notes || null, uploaded_by: u.id, created_at: nowIso(),
    });
  });
  audit(req, 'upload', entity || 'documents', entityId || ids[0], `${ids.length} arquivo(s) enviado(s)`);
  res.status(201).json({ ids, rows: ids.map((id) => get('SELECT * FROM documents WHERE id = ?', id)) });
}));

function sendFile(res, doc, inline) {
  if (!doc.file_path) throw new HttpError(404, 'Documento sem arquivo anexado.');
  const full = path.join(UPLOAD_DIR, doc.file_path);
  if (!full.startsWith(UPLOAD_DIR) || !fs.existsSync(full)) throw new HttpError(404, 'Arquivo não encontrado.');
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.file_name || 'arquivo')}`);
  fs.createReadStream(full).pipe(res);
}
router.get('/files/:id', wrap((req, res) => {
  const doc = get('SELECT * FROM documents WHERE id = ?', Number(req.params.id));
  if (!doc) throw new HttpError(404, 'Documento não encontrado.');
  if (doc.entity && ATTACHABLE.includes(doc.entity)) fetchOne(R[doc.entity], req.user, doc.entity_id);
  else fetchOne(R.documents, req.user, doc.id);
  sendFile(res, doc, req.query.inline === '1');
}));
router.get('/attachments/:entity/:id', wrap((req, res) => {
  if (!ATTACHABLE.includes(req.params.entity)) throw new HttpError(400, 'Entidade inválida.');
  fetchOne(R[req.params.entity], req.user, Number(req.params.id));
  res.json(all('SELECT d.*, u.name uploaded_by_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE entity = ? AND entity_id = ? ORDER BY d.id DESC', req.params.entity, Number(req.params.id)));
}));

module.exports = { router, sendFile, UPLOAD_DIR };
