// ÁREA DO CLIENTE — cada cliente enxerga SOMENTE os próprios projetos e apenas
// informações liberadas pelo escritório. Nada de custos, margens ou notas internas.
const express = require('express');
const { all, get, run } = require('../db');
const { wrap, HttpError, audit, today, nowIso, round2 } = require('../util');
const automation = require('../services/automation');
const { sendFile } = require('./ops');

const router = express.Router();

router.use((req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'Sessão expirada.'));
  if (req.user.role !== 'cliente' || !req.user.client_id) return next(new HttpError(403, 'Área exclusiva para clientes.'));
  next();
});

const DOC_COLS = 'd.id, d.title, d.category, d.file_name, d.mime, d.size, d.created_at, d.project_id';

router.get('/overview', wrap((req, res) => {
  const cid = req.user.client_id;
  const client = get('SELECT id, name, email FROM clients WHERE id = ?', cid);
  const projects = all(`SELECT id, code, name, type, address, city, area, status, progress, contract_value, start_date, due_date, portal_message FROM projects
                        WHERE client_id = ? AND status <> 'cancelado' ORDER BY status = 'encerrado', due_date`, cid);
  for (const p of projects) {
    p.phases = all('SELECT id, name, position, status, start_date, due_date, completed_at FROM project_phases WHERE project_id = ? AND client_visible = 1 ORDER BY position', p.id);
    const cur = p.phases.find((ph) => !['concluido', 'aprovado'].includes(ph.status));
    p.current_phase = cur ? cur.name : (p.phases.length ? 'Concluído' : null);
    p.next_phases = p.phases.filter((ph) => !['concluido', 'aprovado'].includes(ph.status)).slice(0, 3);
    p.works = all('SELECT id, name, status, progress, start_date, due_date FROM works WHERE project_id = ? AND archived = 0', p.id).map((w) => ({
      ...w,
      phases: all('SELECT name, status, progress FROM work_phases WHERE work_id = ? ORDER BY position', w.id),
      updates: all("SELECT id, date, kind, description, decisions, pending FROM work_logs WHERE work_id = ? AND client_visible = 1 ORDER BY date DESC LIMIT 20", w.id)
        .map((l) => ({ ...l, photos: all("SELECT id, title, mime FROM documents WHERE entity = 'work_logs' AND entity_id = ? AND mime LIKE 'image/%'", l.id) })),
    }));
    const docs = all(`SELECT ${DOC_COLS} FROM documents d WHERE d.project_id = ? AND d.client_visible = 1 AND d.archived = 0 ORDER BY d.created_at DESC`, p.id);
    p.images = docs.filter((d) => (d.mime || '').startsWith('image/'));
    p.presentations = docs.filter((d) => !(d.mime || '').startsWith('image/') && /apresenta/i.test(d.category || ''));
    p.documents = docs.filter((d) => !(d.mime || '').startsWith('image/') && !/apresenta/i.test(d.category || ''));
    const quotes = all(`SELECT q.id, q.item, q.amount, q.status, q.deadline_days, q.client_notes, q.client_selected, q.client_selected_at, s.company supplier
                        FROM quotes q LEFT JOIN suppliers s ON s.id = q.supplier_id WHERE q.project_id = ? AND q.client_visible = 1 ORDER BY q.item, q.amount`, p.id);
    const byItem = {};
    quotes.forEach((q) => { (byItem[q.item] = byItem[q.item] || []).push({ ...q, supplier: q.supplier || 'Fornecedor' }); });
    p.quotes = Object.entries(byItem).map(([item, options]) => ({ item, options, selected: options.find((o) => o.client_selected) || null, locked: options.some((o) => o.status === 'contratado') }));
    p.updates = [
      ...p.phases.filter((ph) => ph.completed_at).map((ph) => ({ date: ph.completed_at, text: `Etapa concluída: ${ph.name}` })),
      ...p.works.flatMap((w) => w.updates.map((l) => ({ date: l.date, text: l.description }))),
      ...docs.map((d) => ({ date: d.created_at.slice(0, 10), text: `Novo arquivo disponível: ${d.title}` })),
    ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);
  }
  const incomes = all(`SELECT i.id, i.description, i.amount, i.due_date, i.paid_at, i.status, i.installment_no, i.installment_total, i.project_id, i.method
                       FROM incomes i WHERE i.client_id = ? AND i.status <> 'cancelado' AND COALESCE(i.category,'') <> 'Reserva técnica (RT)' ORDER BY i.due_date`, cid)
    .map((i) => ({ ...i, receipts: all("SELECT id, title, file_name FROM documents WHERE entity = 'incomes' AND entity_id = ? AND client_visible = 1", i.id) }));
  const contracts = all("SELECT id, number, amount, signed_at, start_date, end_date, installments, status, project_id FROM contracts WHERE client_id = ? AND status <> 'cancelado'", cid);
  const events = all(`SELECT id, title, type, start_at, end_at, all_day, location FROM events WHERE client_id = ? AND client_visible = 1 AND status = 'agendado' AND substr(start_at,1,10) >= ? ORDER BY start_at LIMIT 10`, cid, today());
  const sum = (f) => round2(incomes.filter(f).reduce((s, i) => s + i.amount, 0));
  res.json({
    client, projects, events, contracts,
    finance: {
      contracted: round2(contracts.reduce((s, c) => s + c.amount, 0)) || round2(projects.reduce((s, p) => s + (p.contract_value || 0), 0)),
      paid: sum((i) => i.status === 'recebido'), pending: sum((i) => ['a_receber', 'previsto'].includes(i.status)), overdue: sum((i) => i.status === 'vencido'),
      installments: incomes,
    },
  });
}));

// Cliente indica o orçamento aprovado
router.post('/quotes/:id/select', wrap((req, res) => {
  const q = get('SELECT q.*, p.client_id, p.name pname, p.manager_id FROM quotes q JOIN projects p ON p.id = q.project_id WHERE q.id = ? AND q.client_visible = 1', req.params.id);
  if (!q || q.client_id !== req.user.client_id) throw new HttpError(404, 'Orçamento não encontrado.');
  if (get("SELECT 1 FROM quotes WHERE project_id = ? AND item = ? AND status = 'contratado'", q.project_id, q.item)) throw new HttpError(400, 'Este item já foi contratado pelo escritório.');
  run('UPDATE quotes SET client_selected = 0, client_selected_at = NULL WHERE project_id = ? AND item = ?', q.project_id, q.item);
  run('UPDATE quotes SET client_selected = 1, client_selected_at = ? WHERE id = ?', nowIso(), q.id);
  run('INSERT INTO client_interactions(client_id, project_id, date, type, description, user_id) VALUES (?,?,?,?,?,?)',
    q.client_id, q.project_id, today(), 'feedback', `Cliente aprovou orçamento de ${q.item} pela área do cliente`, req.user.id);
  audit(req, 'client_select', 'quotes', q.id, `Cliente escolheu orçamento: ${q.item}`);
  const notifyTo = new Set([q.manager_id, ...automation.managerUsers()]);
  notifyTo.forEach((uid) => automation.notify(uid, { kind: 'orcamento_cliente', severity: 'success', title: `Cliente aprovou orçamento de ${q.item}`,
    body: q.pname, link: `#/projetos/${q.project_id}?tab=orcamentos`, key: `quote_sel_${q.id}_${Date.now()}` }));
  res.json({ ok: true });
}));

router.get('/files/:id', wrap((req, res) => {
  const d = get(`SELECT d.* FROM documents d LEFT JOIN projects p ON p.id = d.project_id WHERE d.id = ? AND (p.client_id = ? OR d.client_id = ?)`, req.params.id, req.user.client_id, req.user.client_id);
  if (!d) throw new HttpError(404, 'Arquivo não encontrado.');
  // liberado explicitamente, ou foto de registro de diário liberado, ou comprovante liberado
  const ok = d.client_visible === 1 || (d.entity === 'work_logs' && get('SELECT 1 FROM work_logs WHERE id = ? AND client_visible = 1', d.entity_id));
  if (!ok) throw new HttpError(404, 'Arquivo não encontrado.');
  sendFile(res, d, req.query.inline === '1');
}));

module.exports = router;
