// =====================================================================
// Controles internos da Área do Cliente, por projeto: capa, materiais de
// "Veja seu projeto", próxima etapa, pendências de aprovação e decisões.
// Tudo o que é publicado aqui é o que o portal mostra (mesmos registros).
// =====================================================================
const fs = require('fs');
const path = require('path');
const express = require('express');
const { all, get, run, insert, update, tx } = require('../db');
const { wrap, HttpError, audit, nowIso, today } = require('../util');
const P = require('../permissions');
const { R } = require('../resources');
const { fetchOne } = require('../crud');
const A = require('../services/approvals');
const { optimizeImage } = require('../services/media');
const { UPLOAD_DIR, sendFile } = require('./ops');

const router = express.Router();
const str = (v, n = 300) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim().slice(0, n));
const date = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v).slice(0, 10)) ? String(v).slice(0, 10) : null);
const clamp = (v, a, b, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; };
const isMedia = (d) => /^(image|video)\//.test(d.mime || '') || /pdf$/i.test(d.mime || '') || /apresenta/i.test(d.category || '');

function project(u, id, write) {
  const p = fetchOne(R.projects, u, Number(id));
  if (write && !P.isManager(u) && !P.canAccessProject(u, p.id)) throw new HttpError(403, 'Sem permissão para alterar este projeto.');
  return p;
}
function docOf(p, id) {
  const d = get('SELECT * FROM documents WHERE id = ? AND project_id = ? AND archived = 0', Number(id), p.id);
  if (!d) throw new HttpError(404, 'Arquivo não encontrado neste projeto.');
  return d;
}
function nextPhase(projectId) {
  return get("SELECT name, due_date FROM project_phases WHERE project_id = ? AND client_visible = 1 AND status NOT IN ('concluido','aprovado') ORDER BY position LIMIT 1 OFFSET 1", projectId)
    || null;
}
const DOC_FIELDS = 'id, title, category, file_name, mime, size, client_visible, showcase, portal_title, portal_desc, portal_group, portal_order, replaced_by, published_at, created_at, entity';

router.get('/projects/:id/client-area', wrap((req, res) => {
  const p = project(req.user, req.params.id);
  const media = all(`SELECT ${DOC_FIELDS} FROM documents WHERE project_id = ? AND archived = 0 AND COALESCE(entity,'') NOT IN ('incomes','expenses','work_logs','quotes') ORDER BY COALESCE(portal_order, 9999), created_at DESC`, p.id).filter(isMedia);
  const cover = p.cover_doc_id ? get(`SELECT ${DOC_FIELDS} FROM documents WHERE id = ?`, p.cover_doc_id) : null;
  const approvals = all('SELECT * FROM approvals WHERE project_id = ? AND archived = 0 ORDER BY status = \'aprovada\', status = \'cancelada\', COALESCE(due_date, \'9999\'), id DESC', p.id).map((a) => A.approvalOut(a));
  const quotes = all('SELECT item, COUNT(*) n, SUM(client_visible) visible, SUM(client_selected) selected FROM quotes WHERE project_id = ? GROUP BY item ORDER BY item', p.id);
  const phases = all('SELECT name, status, due_date FROM project_phases WHERE project_id = ? ORDER BY position', p.id);
  const cur = phases.find((ph) => !['concluido', 'aprovado'].includes(ph.status));
  const derivedNext = phases.filter((ph) => !['concluido', 'aprovado'].includes(ph.status))[1] || null;
  const history = all(`SELECT e.*, a.title approval_title FROM approval_events e JOIN approvals a ON a.id = e.approval_id WHERE a.project_id = ? ORDER BY e.id DESC LIMIT 60`, p.id)
    .map((e) => ({ ...A.eventOut(e), approval_title: e.approval_title, approval_id: e.approval_id }));
  res.json({
    project: { id: p.id, name: p.name, code: p.code, client_id: p.client_id, client_name: p.client_name, progress: p.progress, portal_message: p.portal_message,
      next_step: p.next_step, next_step_due: p.next_step_due, current_phase: cur ? cur.name : null, derived_next: derivedNext,
      cover: cover ? { doc: cover, x: p.cover_x ?? 50, y: p.cover_y ?? 50, zoom: p.cover_zoom ?? 1, optimized: !!p.cover_display } : null },
    media, approvals, quotes, phases: phases.map((x) => x.name), history,
    groups: [...new Set(media.map((m) => m.portal_group).filter(Boolean))],
    has_portal_user: p.client_id ? !!get("SELECT 1 FROM users WHERE role = 'cliente' AND client_id = ? AND active = 1", p.client_id) : false,
    origins: A.ORIGINS,
  });
}));

// ---------- capa ----------
async function buildCover(p, doc) {
  const src = path.join(UPLOAD_DIR, doc.file_path);
  const rel = path.join('derived', `capa-${p.id}-${doc.id}-${Date.now()}.jpg`);
  const r = await optimizeImage(src, path.join(UPLOAD_DIR, rel), { max: 2000 });
  return r.ok ? rel : null;
}
function dropDerived(rel) { if (rel && rel.startsWith('derived')) fs.rm(path.join(UPLOAD_DIR, rel), { force: true }, () => {}); }
router.put('/projects/:id/cover', wrap(async (req, res) => {
  const p = project(req.user, req.params.id, true);
  const b = req.body || {};
  const docId = b.doc_id ? Number(b.doc_id) : p.cover_doc_id;
  if (!docId) throw new HttpError(400, 'Escolha uma imagem para a capa.');
  const d = docOf(p, docId);
  if (!/^image\/(jpeg|png|webp)$/.test(d.mime || '')) throw new HttpError(400, 'A capa precisa ser uma imagem (JPG ou PNG).');
  const data = { cover_doc_id: d.id, cover_x: clamp(b.x, 0, 100, p.cover_x ?? 50), cover_y: clamp(b.y, 0, 100, p.cover_y ?? 50), cover_zoom: clamp(b.zoom, 1, 3, p.cover_zoom ?? 1), updated_at: nowIso() };
  let note = null;
  if (d.id !== p.cover_doc_id || !p.cover_display) {
    const rel = await buildCover(p, d);
    if (!rel) note = 'A capa foi salva com o arquivo original (não foi possível gerar a versão otimizada).';
    data.cover_display = rel; if (p.cover_display && p.cover_display !== rel) dropDerived(p.cover_display);
  }
  update('projects', p.id, data);
  audit(req, 'update', 'projects', p.id, `Capa do portal definida: ${d.title}`);
  res.json({ ok: true, note });
}));
router.delete('/projects/:id/cover', wrap((req, res) => {
  const p = project(req.user, req.params.id, true);
  update('projects', p.id, { cover_doc_id: null, cover_display: null, updated_at: nowIso() }); dropDerived(p.cover_display);
  audit(req, 'update', 'projects', p.id, 'Capa do portal removida');
  res.json({ ok: true });
}));
function coverFile(p) {
  if (!p.cover_doc_id) return null;
  const d = get('SELECT * FROM documents WHERE id = ? AND archived = 0', p.cover_doc_id); if (!d) return null;
  if (p.cover_display && fs.existsSync(path.join(UPLOAD_DIR, p.cover_display))) return { ...d, file_path: p.cover_display, mime: 'image/jpeg', file_name: 'capa.jpg' };
  return d;
}
router.get('/projects/:id/cover-image', wrap((req, res) => {
  const p = project(req.user, req.params.id);
  const f = coverFile(p); if (!f) throw new HttpError(404, 'Sem capa.');
  res.setHeader('Cache-Control', 'private, max-age=300'); sendFile(res, f, true, req);
}));

// ---------- próxima etapa e mensagem ----------
router.put('/projects/:id/next-step', wrap((req, res) => {
  const p = project(req.user, req.params.id, true);
  const b = req.body || {};
  update('projects', p.id, { next_step: str(b.next_step, 200), next_step_due: date(b.next_step_due), ...('portal_message' in b ? { portal_message: str(b.portal_message, 2000) } : {}), updated_at: nowIso() });
  res.json({ ok: true });
}));

// ---------- materiais de "Veja seu projeto" ----------
router.put('/documents/:id/showcase', wrap((req, res) => {
  const d0 = get('SELECT * FROM documents WHERE id = ?', Number(req.params.id)); if (!d0 || !d0.project_id) throw new HttpError(404, 'Arquivo não encontrado.');
  const p = project(req.user, d0.project_id, true);
  const b = req.body || {}; const d = {};
  if ('client_visible' in b) { d.client_visible = b.client_visible ? 1 : 0; if (d.client_visible && !d0.client_visible) d.published_at = nowIso(); }
  if ('showcase' in b) d.showcase = b.showcase ? 1 : 0;
  if ('portal_title' in b) d.portal_title = str(b.portal_title, 160);
  if ('portal_desc' in b) d.portal_desc = str(b.portal_desc, 400);
  if ('portal_group' in b) d.portal_group = str(b.portal_group, 80);
  if ('replaced_by' in b) {
    const r = b.replaced_by ? docOf(p, b.replaced_by) : null;
    if (r && r.id === d0.id) throw new HttpError(400, 'Escolha outro arquivo como versão atual.');
    d.replaced_by = r ? r.id : null;
  }
  d.updated_at = nowIso();
  update('documents', d0.id, d);
  audit(req, 'update', 'documents', d0.id, `Área do cliente: ${d.client_visible === 0 ? 'retirado da visualização' : d.client_visible === 1 ? 'publicado' : 'material atualizado'} — ${d0.title}`);
  res.json({ ok: true });
}));
router.post('/projects/:id/showcase-order', wrap((req, res) => {
  const p = project(req.user, req.params.id, true);
  const ids = (req.body.ids || []).map(Number).filter(Boolean);
  tx(() => ids.forEach((id, i) => run('UPDATE documents SET portal_order = ? WHERE id = ? AND project_id = ?', i + 1, id, p.id)));
  res.json({ ok: true });
}));

// ---------- pendências de aprovação ----------
function readApproval(p, b) {
  const d = {};
  if ('title' in b) { d.title = str(b.title, 200); if (!d.title) throw new HttpError(400, 'Informe o que precisa ser decidido.'); }
  if ('kind' in b) d.kind = A.KINDS.includes(b.kind) ? b.kind : 'outro';
  if ('quote_item' in b) d.quote_item = str(b.quote_item, 120);
  if ('quote_id' in b) { d.quote_id = b.quote_id ? Number(b.quote_id) : null; if (d.quote_id && !get('SELECT 1 FROM quotes WHERE id = ? AND project_id = ?', d.quote_id, p.id)) throw new HttpError(400, 'Orçamento não pertence a este projeto.'); }
  if ('document_id' in b) { d.document_id = b.document_id ? docOf(p, b.document_id).id : null; }
  if ('reason' in b) d.reason = str(b.reason, 600);
  if ('blocks_stage' in b) d.blocks_stage = str(b.blocks_stage, 160);
  if ('due_date' in b) d.due_date = date(b.due_date);
  if ('client_visible' in b) d.client_visible = b.client_visible ? 1 : 0;
  return d;
}
function approvalRow(u, id, write) {
  const a = get('SELECT * FROM approvals WHERE id = ?', Number(id)); if (!a) throw new HttpError(404, 'Pendência não encontrada.');
  project(u, a.project_id, write); return a;
}
router.post('/projects/:id/approvals', wrap((req, res) => {
  const p = project(req.user, req.params.id, true);
  const d = readApproval(p, { client_visible: 1, kind: 'orcamento', ...req.body });
  if (!d.title) throw new HttpError(400, 'Informe o que precisa ser decidido.');
  if (d.kind === 'orcamento' && !d.quote_item && !d.quote_id) throw new HttpError(400, 'Escolha a categoria de orçamentos ou o orçamento relacionado.');
  const id = tx(() => {
    const nid = insert('approvals', { ...d, project_id: p.id, status: 'aberta', created_by: req.user.id, created_at: nowIso(), updated_at: nowIso() });
    A.addEvent(nid, { action: 'criada', actor: 'escritorio', user_id: req.user.id, comment: d.reason });
    return nid;
  });
  audit(req, 'create', 'approvals', id, `Pendência de aprovação: ${d.title}`);
  res.status(201).json(A.approvalOut(get('SELECT * FROM approvals WHERE id = ?', id)));
}));
router.put('/approvals/:id', wrap((req, res) => {
  const a = approvalRow(req.user, req.params.id, true);
  const p = get('SELECT * FROM projects WHERE id = ?', a.project_id);
  const d = readApproval(p, req.body || {}); d.updated_at = nowIso();
  update('approvals', a.id, d);
  res.json(A.approvalOut(get('SELECT * FROM approvals WHERE id = ?', a.id)));
}));
router.post('/approvals/:id/register', wrap((req, res) => {
  const a = approvalRow(req.user, req.params.id, true);
  A.officeDecision(req.user, a.id, req.body || {});
  audit(req, 'update', 'approvals', a.id, `Decisão do cliente registrada pelo escritório (${A.ORIGINS[req.body.origin] || ''}): ${a.title}`);
  res.json(A.approvalOut(get('SELECT * FROM approvals WHERE id = ?', a.id)));
}));
router.post('/approvals/:id/reopen', wrap((req, res) => {
  const a = approvalRow(req.user, req.params.id, true);
  if (a.status === 'aberta') throw new HttpError(400, 'A pendência já está aguardando o cliente.');
  tx(() => {
    update('approvals', a.id, { status: 'aberta', updated_at: nowIso() });
    A.addEvent(a.id, { action: 'reaberta', actor: 'escritorio', user_id: req.user.id, comment: str(req.body.reason, 600) || 'Reaberta pelo escritório para nova decisão do cliente.' });
  });
  res.json(A.approvalOut(get('SELECT * FROM approvals WHERE id = ?', a.id)));
}));
router.post('/approvals/:id/cancel', wrap((req, res) => {
  const a = approvalRow(req.user, req.params.id, true);
  tx(() => { update('approvals', a.id, { status: 'cancelada', updated_at: nowIso() }); A.addEvent(a.id, { action: 'cancelada', actor: 'escritorio', user_id: req.user.id, comment: str(req.body.reason, 600) }); });
  res.json(A.approvalOut(get('SELECT * FROM approvals WHERE id = ?', a.id)));
}));
router.post('/approvals/:id/archive', wrap((req, res) => {
  const a = approvalRow(req.user, req.params.id, true);
  update('approvals', a.id, { archived: req.body.archived === 0 ? 0 : 1, updated_at: nowIso() });
  res.json({ ok: true });
}));

module.exports = { router, coverFile, nextPhase };
