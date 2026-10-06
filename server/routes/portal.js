// ÁREA DO CLIENTE — cada cliente enxerga SOMENTE os próprios projetos e apenas
// informações liberadas pelo escritório. Nada de custos, margens ou notas internas.
const express = require('express');
const { all, get, run } = require('../db');
const { wrap, HttpError, audit, today, nowIso, round2 } = require('../util');
const { sendFile } = require('./ops');

const router = express.Router();

router.use((req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'Sessão expirada.'));
  if (req.user.role !== 'cliente' || !req.user.client_id) return next(new HttpError(403, 'Área exclusiva para clientes.'));
  next();
});

const DOC_COLS = 'd.id, d.title, d.category, d.file_name, d.mime, d.size, d.created_at, d.project_id';

const A = require('../services/approvals');
const { getSetting } = require('../db');
const J = (v, d) => { try { return JSON.parse(v); } catch { return d; } };
const lines = (t) => String(t || '').split(/\r?\n/).map((x) => x.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
const kindOf = (d) => ((d.mime || '').startsWith('image/') ? 'imagem' : (d.mime || '').startsWith('video/') ? 'video' : /pdf$/i.test(d.mime || '') ? 'pdf' : 'arquivo');
const QUOTE_CLIENT_STATUS = (q) => (q.status === 'contratado' ? 'Contratado pelo escritório' : q.client_selected ? 'Escolhido por você' : q.status === 'recusado' ? 'Não selecionado' : 'Em análise');
// contato do escritório para o atalho "Fale com o escritório"
function officeContact() {
  const wa = getSetting('portal_whatsapp', '') || (String(getSetting('office_phone', '')).match(/\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}/) || [])[0] || '';
  const digits = wa.replace(/\D/g, '');
  return { phone: wa || null, whatsapp: digits.length >= 10 ? `55${digits.replace(/^55/, '')}` : null, email: getSetting('office_email', '') || null, name: getSetting('office_name', '') };
}

router.get('/overview', wrap((req, res) => {
  const cid = req.user.client_id;
  const client = get('SELECT id, name, email FROM clients WHERE id = ?', cid);
  const projects = all(`SELECT id, code, name, type, address, city, area, status, progress, contract_value, start_date, due_date, portal_message, cover_doc_id, cover_x, cover_y, cover_zoom, next_step, next_step_due FROM projects
                        WHERE client_id = ? AND status <> 'cancelado' AND archived = 0 ORDER BY status = 'encerrado', due_date`, cid);
  for (const p of projects) {
    p.phases = all('SELECT id, name, position, status, start_date, due_date, completed_at FROM project_phases WHERE project_id = ? AND client_visible = 1 ORDER BY position', p.id);
    const open = p.phases.filter((ph) => !['concluido', 'aprovado'].includes(ph.status));
    p.current_phase = open[0] ? open[0].name : (p.phases.length ? 'Concluído' : null);
    p.next_phases = open.slice(0, 3);
    // próxima etapa: a definida pelo escritório ou, se vazia, a etapa seguinte do cronograma
    const nx = open[1] || null;
    p.next = p.next_step ? { name: p.next_step, due: p.next_step_due || null, after: p.current_phase } : nx ? { name: nx.name, due: nx.due_date || null, after: open[0] ? open[0].name : null } : null;
    p.cover = p.cover_doc_id && get('SELECT 1 FROM documents WHERE id = ? AND archived = 0', p.cover_doc_id) ? { url: `/api/portal/projects/${p.id}/cover`, x: p.cover_x ?? 50, y: p.cover_y ?? 50, zoom: p.cover_zoom ?? 1 } : null;
    ['cover_doc_id', 'cover_x', 'cover_y', 'cover_zoom', 'next_step', 'next_step_due'].forEach((k) => delete p[k]);
    p.works = all('SELECT id, name, status, progress, start_date, due_date FROM works WHERE project_id = ? AND archived = 0', p.id).map((w) => ({
      ...w,
      phases: all('SELECT name, status, progress FROM work_phases WHERE work_id = ? ORDER BY position', w.id),
      updates: all("SELECT id, date, kind, description, decisions FROM work_logs WHERE work_id = ? AND client_visible = 1 ORDER BY date DESC LIMIT 20", w.id)
        .map((l) => ({ ...l, photos: all("SELECT id, title, mime FROM documents WHERE entity = 'work_logs' AND entity_id = ? AND mime LIKE 'image/%' AND archived = 0", l.id) })),
    }));
    const docs = all(`SELECT d.id, d.title, d.category, d.file_name, d.mime, d.size, d.created_at, d.published_at, d.showcase, d.portal_title, d.portal_desc, d.portal_group, d.portal_order, d.replaced_by
                      FROM documents d WHERE d.project_id = ? AND d.client_visible = 1 AND d.archived = 0 AND COALESCE(d.entity,'') NOT IN ('work_logs','incomes','expenses','quotes')
                      ORDER BY COALESCE(d.portal_order, 9999), d.created_at DESC`, p.id);
    // "Veja seu projeto": somente materiais publicados pelo escritório
    p.showcase = docs.filter((d) => d.showcase).map((d) => ({ id: d.id, title: d.portal_title || d.title, desc: d.portal_desc, group: d.portal_group, kind: kindOf(d), mime: d.mime, size: d.size,
      file_name: d.file_name, date: (d.published_at || d.created_at).slice(0, 10), previous: !!(d.replaced_by && docs.find((x) => x.id === d.replaced_by)) }));
    p.documents = docs.filter((d) => !d.showcase).map((d) => ({ ...d, title: d.portal_title || d.title }));
    p.images = p.showcase.filter((d) => d.kind === 'imagem'); // compatibilidade
    const quotes = all(`SELECT q.id, q.item, q.amount, q.status, q.deadline_days, q.client_notes, q.client_selected, q.client_selected_at, q.scope, q.included, q.excluded, q.payment_terms, q.valid_until, q.version, q.received_at, q.published_at, s.company supplier
                        FROM quotes q LEFT JOIN suppliers s ON s.id = q.supplier_id WHERE q.project_id = ? AND q.client_visible = 1 ORDER BY q.item, q.amount`, p.id)
      .map((q) => ({ ...q, supplier: q.supplier || 'Fornecedor não informado', amount: q.amount > 0 ? q.amount : null, included: lines(q.included), excluded: lines(q.excluded), version: q.version || 1,
        status_label: QUOTE_CLIENT_STATUS(q), files: all("SELECT id, title, file_name, mime, size FROM documents WHERE entity = 'quotes' AND entity_id = ? AND archived = 0", q.id) }));
    const byItem = {};
    quotes.forEach((q) => { (byItem[q.item] = byItem[q.item] || []).push(q); });
    p.quotes = Object.entries(byItem).map(([item, options]) => ({ item, options, selected: options.find((o) => o.client_selected) || null, locked: options.some((o) => o.status === 'contratado') }));
    p.approvals = all("SELECT * FROM approvals WHERE project_id = ? AND client_visible = 1 AND archived = 0 AND status <> 'cancelada' ORDER BY status = 'aprovada', COALESCE(due_date, '9999'), id", p.id)
      .map((a) => A.approvalOut(a, { forClient: true }));
    p.minutes = all("SELECT id, number, date, title, content, next_steps FROM meeting_minutes WHERE project_id = ? AND client_visible = 1 AND archived = 0 ORDER BY date DESC", p.id)
      .map((a) => ({ ...a, next_steps: J(a.next_steps || '[]', []) }));
    // últimas atualizações: somente o que o cliente pode ver, com o destino de cada item
    const kindTxt = { imagem: 'Nova imagem', video: 'Novo vídeo', pdf: 'Nova apresentação', arquivo: 'Novo material' };
    const ups = [
      ...p.showcase.map((d) => ({ date: d.date, text: `${kindTxt[d.kind]} disponível: ${d.title}`, tab: 'projeto', ref: `doc-${d.id}` })),
      ...p.documents.map((d) => ({ date: (d.published_at || d.created_at).slice(0, 10), text: `Novo documento: ${d.title}`, tab: 'documentos', ref: `doc-${d.id}` })),
      ...Object.values(quotes.reduce((m, q) => { const k = `${q.item}|${(q.published_at || q.received_at || '').slice(0, 10)}`; (m[k] = m[k] || { item: q.item, date: (q.published_at || q.received_at || '').slice(0, 10), n: 0 }).n++; return m; }, {}))
        .filter((g) => g.date).map((g) => ({ date: g.date, text: `Orçamento${g.n > 1 ? 's' : ''} de ${g.item} para avaliação`, tab: 'financeiro', sub: 'orcamentos', ref: `cat-${g.item}` })),
      ...p.approvals.map((a) => ({ date: a.created_at.slice(0, 10), text: a.status === 'aprovada' ? `Decisão registrada: ${a.title}` : `Sua decisão é necessária: ${a.title}`, tab: 'financeiro', sub: 'aprovacoes', ref: `apr-${a.id}` })),
      ...p.phases.filter((ph) => ph.completed_at).map((ph) => ({ date: ph.completed_at.slice(0, 10), text: `Etapa concluída: ${ph.name}`, tab: 'andamento' })),
      ...p.works.flatMap((w) => w.updates.map((l) => ({ date: l.date, text: `Atualização da obra: ${String(l.description || '').slice(0, 90)}`, tab: 'obra' }))),
      ...p.minutes.map((a) => ({ date: a.date, text: `Ata de reunião: ${a.title || 'Reunião'}`, tab: 'andamento', ref: `ata-${a.id}` })),
    ];
    p.updates = ups.filter((u) => u.date).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
  }
  const incomes = all(`SELECT i.id, i.description, i.amount, i.due_date, i.paid_at, i.status, i.installment_no, i.installment_total, i.project_id, i.method
                       FROM incomes i WHERE i.client_id = ? AND i.status <> 'cancelado' AND COALESCE(i.category,'') <> 'Reserva técnica (RT)' ORDER BY i.due_date`, cid)
    .map((i) => ({ ...i, receipts: all("SELECT id, title, file_name FROM documents WHERE entity = 'incomes' AND entity_id = ? AND client_visible = 1 AND archived = 0", i.id) }));
  const receipts = all("SELECT id, number, amount, paid_at, income_id, project_id FROM receipts WHERE client_id = ? AND status = 'emitido' AND archived = 0 ORDER BY paid_at DESC", cid);
  incomes.forEach((i) => { i.receipt_docs = receipts.filter((r) => r.income_id === i.id); });
  const contracts = all("SELECT id, number, amount, signed_at, start_date, end_date, installments, status, project_id FROM contracts WHERE client_id = ? AND status <> 'cancelado'", cid);
  const events = all(`SELECT id, title, type, start_at, end_at, all_day, location, project_id FROM events WHERE client_id = ? AND client_visible = 1 AND status = 'agendado' AND substr(start_at,1,10) >= ? ORDER BY start_at LIMIT 10`, cid, today());
  const sum = (f) => round2(incomes.filter(f).reduce((s, i) => s + i.amount, 0));
  res.json({
    client, projects, events, contracts, receipts, contact: officeContact(),
    finance: {
      contracted: round2(contracts.reduce((s, c) => s + c.amount, 0)) || round2(projects.reduce((s, p) => s + (p.contract_value || 0), 0)),
      paid: sum((i) => i.status === 'recebido'), pending: sum((i) => ['a_receber', 'previsto'].includes(i.status)), overdue: sum((i) => i.status === 'vencido'),
      installments: incomes,
    },
  });
}));

// Decisão do cliente: aprovar uma opção ou pedir ajustes (registrado com data, horário, item e versão)
router.post('/approvals/:id/decide', wrap((req, res) => {
  const r = A.clientDecision(req.user, Number(req.params.id), req.body || {});
  audit(req, 'client_decision', 'approvals', Number(req.params.id), `${req.body.action === 'ajustes' ? 'Ajustes solicitados' : 'Aprovação'} pelo cliente na Área do Cliente`);
  res.json({ ok: true, event_id: r.event_id });
}));
// capa do projeto (versão otimizada; o original fica preservado)
router.get('/projects/:id/cover', wrap((req, res) => {
  const p = get('SELECT * FROM projects WHERE id = ? AND client_id = ?', Number(req.params.id), req.user.client_id);
  if (!p) throw new HttpError(404, 'Projeto não encontrado.');
  const f = require('./clientarea').coverFile(p); if (!f) throw new HttpError(404, 'Sem capa.');
  res.setHeader('Cache-Control', 'private, max-age=300');
  sendFile(res, f, true, req);
}));

// Compatibilidade: escolha direta de um orçamento (versões antigas da tela) passa pelo mesmo registro de aprovações
router.post('/quotes/:id/select', wrap((req, res) => {
  const q = get('SELECT q.*, p.client_id FROM quotes q JOIN projects p ON p.id = q.project_id WHERE q.id = ? AND q.client_visible = 1', req.params.id);
  if (!q || q.client_id !== req.user.client_id) throw new HttpError(404, 'Orçamento não encontrado.');
  let a = get("SELECT * FROM approvals WHERE project_id = ? AND quote_item = ? AND client_visible = 1 AND archived = 0 AND status IN ('aberta','ajustes') ORDER BY id DESC", q.project_id, q.item);
  if (!a) {
    const id = require('../db').insert('approvals', { project_id: q.project_id, title: `Escolha do orçamento de ${q.item}`, kind: 'orcamento', quote_item: q.item, status: 'aberta', client_visible: 1, created_at: nowIso(), updated_at: nowIso() });
    A.addEvent(id, { action: 'criada', actor: 'sistema', comment: 'Criada a partir da escolha feita pelo cliente.' });
    a = get('SELECT * FROM approvals WHERE id = ?', id);
  }
  A.clientDecision(req.user, a.id, { action: 'aprovada', quote_id: q.id });
  res.json({ ok: true });
}));

router.get('/receipts/:id/pdf', wrap(async (req, res) => {
  const r = get(`SELECT rc.*, p.name project_name, p.code project_code, ct.number contract_number FROM receipts rc LEFT JOIN projects p ON p.id = rc.project_id LEFT JOIN contracts ct ON ct.id = rc.contract_id
    WHERE rc.id = ? AND rc.client_id = ? AND rc.status = 'emitido' AND rc.archived = 0`, Number(req.params.id), req.user.client_id);
  if (!r) throw new HttpError(404, 'Recibo não encontrado.');
  const pdf = require('../pdf'); const { receiptDoc } = require('./extra');
  await pdf.send(res, receiptDoc(r, {}), `Recibo ${String(r.number).replace('/', '-')}.pdf`, req.query.download === '1');
}));
router.get('/minutes/:id/pdf', wrap(async (req, res) => {
  const a = get(`SELECT mm.*, c.name client_name, p.name project_name, p.code project_code, u.name created_by_name FROM meeting_minutes mm JOIN projects p ON p.id = mm.project_id LEFT JOIN clients c ON c.id = mm.client_id LEFT JOIN users u ON u.id = mm.created_by
    WHERE mm.id = ? AND p.client_id = ? AND mm.client_visible = 1 AND mm.archived = 0`, Number(req.params.id), req.user.client_id);
  if (!a) throw new HttpError(404, 'Ata não encontrada.');
  const { minutesDoc } = require('./extra'); const pdf = require('../pdf');
  await pdf.send(res, minutesDoc(a), `Ata ${a.number || ''}.pdf`, req.query.download === '1');
}));
router.get('/files/:id', wrap((req, res) => {
  const d = get(`SELECT d.* FROM documents d LEFT JOIN projects p ON p.id = d.project_id WHERE d.id = ? AND (p.client_id = ? OR d.client_id = ?)`, req.params.id, req.user.client_id, req.user.client_id);
  if (!d) throw new HttpError(404, 'Arquivo não encontrado.');
  // liberado explicitamente, ou foto de registro de diário liberado, ou comprovante liberado
  if (d.archived) throw new HttpError(404, 'Arquivo não encontrado.');
  const ok = d.client_visible === 1 || (d.entity === 'work_logs' && get('SELECT 1 FROM work_logs WHERE id = ? AND client_visible = 1', d.entity_id))
    || (d.entity === 'quotes' && get('SELECT 1 FROM quotes q JOIN projects p ON p.id = q.project_id WHERE q.id = ? AND q.client_visible = 1 AND p.client_id = ?', d.entity_id, req.user.client_id));
  if (!ok) throw new HttpError(404, 'Arquivo não encontrado.');
  sendFile(res, d, req.query.inline === '1', req);
}));

module.exports = router;
