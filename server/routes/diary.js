// =====================================================================
// Diário de obra: registrar e publicar atualizações com poucos toques.
// Um único registro (work_logs) é usado pela obra, pelo menu "Diário de obra"
// e pela Área do Cliente. Fotos são documentos ligados ao registro (e à obra).
// Nada aqui marca pagamento, aprovação ou conclusão financeira.
// =====================================================================
const express = require('express');
const { all, get, run, insert, update, tx } = require('../db');
const { wrap, HttpError, audit, nowIso, today } = require('../util');
const P = require('../permissions');
const { R } = require('../resources');
const { fetchOne } = require('../crud');
const proj = require('../services/projects');

const router = express.Router();
router.use('/diary', P.requireModule('obras'));
const J = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
const S_STATUS = ['iniciado', 'em_andamento', 'concluido', 'impedido'];
const work = (req, id) => { if (!Number(id)) throw new HttpError(400, 'Selecione a obra.'); return fetchOne(R.works, req.user, Number(id)); };
const canWrite = (u, w) => P.isManager(u) || P.canAccessProject(u, w.project_id);

// obras que o usuário pode ver (seletor)
router.get('/diary/works', wrap((req, res) => {
  const ps = P.projectScope(req.user, 'p.id');
  res.json(all(`SELECT w.id, COALESCE(w.name, 'Obra') name, w.status, w.progress, w.project_id, p.name project_name, p.code, c.name client_name, c.id client_id,
      (SELECT MAX(date) FROM work_logs l WHERE l.work_id = w.id) last_log,
      (SELECT COUNT(*) FROM work_logs l WHERE l.work_id = w.id AND l.status = 'rascunho') drafts
    FROM works w JOIN projects p ON p.id = w.project_id LEFT JOIN clients c ON c.id = p.client_id
    WHERE w.archived = 0 AND ${ps.sql} ORDER BY w.status = 'concluida', last_log IS NULL, last_log DESC, p.name`, ...ps.params));
}));

// lista de registros (mais recentes primeiro), com filtros
router.get('/diary', wrap((req, res) => {
  const q = req.query || {}; const w = []; const p = [];
  const ps = P.projectScope(req.user, 'wk.project_id'); w.push(ps.sql); p.push(...ps.params);
  if (q.work_id) { w.push('l.work_id = ?'); p.push(Number(q.work_id)); }
  if (q.from) { w.push('l.date >= ?'); p.push(q.from); }
  if (q.to) { w.push('l.date <= ?'); p.push(q.to); }
  if (q.status === 'publicado' || q.status === 'rascunho') { w.push('l.status = ?'); p.push(q.status); }
  const rows = all(`SELECT l.id, l.work_id, l.date, l.kind, l.title, l.description, l.status, l.services, l.published_at, l.updated_at, l.created_at, u.name user_name,
      COALESCE(wk.name,'Obra') work_name, wk.project_id, pr.name project_name, c.name client_name,
      (SELECT COUNT(*) FROM documents d WHERE d.entity = 'work_logs' AND d.entity_id = l.id AND d.archived = 0) photos
    FROM work_logs l JOIN works wk ON wk.id = l.work_id JOIN projects pr ON pr.id = wk.project_id LEFT JOIN clients c ON c.id = pr.client_id LEFT JOIN users u ON u.id = l.user_id
    WHERE ${w.join(' AND ')} ORDER BY l.date DESC, l.id DESC LIMIT 300`, ...p);
  rows.forEach((r) => { r.services = J(r.services, []); r.thumbs = all("SELECT id FROM documents WHERE entity = 'work_logs' AND entity_id = ? AND archived = 0 AND mime LIKE 'image/%' ORDER BY id LIMIT 4", r.id).map((x) => x.id); });
  res.json(rows);
}));

// contexto da obra: vínculos, etapas, equipe, fornecedores, pendências abertas e último registro
router.get('/diary/context/:workId', wrap((req, res) => {
  const w = work(req, req.params.workId);
  const pj = get('SELECT p.id, p.name, p.code, p.client_id, p.manager_id, c.name client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = ?', w.project_id);
  const phases = all('SELECT wp.id, wp.name, wp.status, wp.progress, wp.position, wp.due_date, wp.responsible, wp.applicable, wp.archived, wp.supplier_id, s.company supplier_name FROM work_phases wp LEFT JOIN suppliers s ON s.id = wp.supplier_id WHERE wp.work_id = ? ORDER BY wp.position, wp.id', w.id);
  const team = all(`SELECT DISTINCT u.id, u.name, u.job_title FROM users u WHERE u.active = 1 AND u.role <> 'cliente' AND (u.id IN (SELECT user_id FROM project_members WHERE project_id = ?) OR u.id = ? OR u.id = ?) ORDER BY u.name`, pj.id, pj.manager_id || 0, w.responsible_id || 0);
  const suppliers = all(`SELECT DISTINCT s.id, s.company name, s.category FROM suppliers s WHERE s.id IN (
      SELECT supplier_id FROM work_phases WHERE work_id = ? UNION SELECT supplier_id FROM quotes WHERE project_id = ? AND (status = 'contratado' OR client_selected = 1)
      UNION SELECT supplier_id FROM expenses WHERE project_id = ? AND flow = 'obra') ORDER BY s.company`, w.id, pj.id, pj.id);
  // fornecedores já registrados como presentes em visitas anteriores também aparecem
  const seen = new Set(suppliers.map((s) => s.id));
  all('SELECT participants FROM work_logs WHERE work_id = ? ORDER BY id DESC LIMIT 20', w.id).forEach((l) => J(l.participants, []).forEach((x) => { if (x.kind === 'supplier' && x.id && !seen.has(x.id)) { const s = get('SELECT id, company name, category FROM suppliers WHERE id = ?', x.id); if (s) { seen.add(s.id); suppliers.push(s); } } }));
  const pendencies = all("SELECT * FROM work_pendencies WHERE work_id = ? AND status = 'aberta' ORDER BY COALESCE(due_date, '9999'), id", w.id);
  const last = get('SELECT id, date, title, services FROM work_logs WHERE work_id = ? ORDER BY date DESC, id DESC', w.id);
  res.json({ work: { id: w.id, name: w.name || 'Obra', status: w.status, progress: w.progress }, project: pj, client: pj.client_id ? { id: pj.client_id, name: pj.client_name } : null,
    phases, team, suppliers, pendencies, last: last ? { id: last.id, date: last.date, title: last.title, services: J(last.services, []) } : null,
    portal_user: pj.client_id ? !!get("SELECT 1 FROM users WHERE role = 'cliente' AND client_id = ? AND active = 1", pj.client_id) : false, me: { id: req.user.id, name: req.user.name } });
}));

function logOut(l) {
  return { ...l, services: J(l.services, []), participants: J(l.participants, []), phase_changes: J(l.phase_changes, []), next_steps: J(l.next_steps, []),
    photos: all("SELECT id, title, mime, file_name, upload_key, created_at FROM documents WHERE entity = 'work_logs' AND entity_id = ? AND archived = 0 ORDER BY id", l.id),
    pendencies: all('SELECT * FROM work_pendencies WHERE created_log_id = ? OR resolved_log_id = ? OR id IN (SELECT value FROM json_each(COALESCE(?, \'[]\')))', l.id, l.id, l.next_steps || '[]') };
}
router.get('/diary/logs/:id', wrap((req, res) => {
  const l = get('SELECT l.*, u.name user_name FROM work_logs l LEFT JOIN users u ON u.id = l.user_id WHERE l.id = ?', Number(req.params.id));
  if (!l) throw new HttpError(404, 'Registro não encontrado.');
  work(req, l.work_id);
  res.json(logOut(l));
}));

// criar ou atualizar (mesma chave = mesma gravação: uma nova tentativa não duplica)
function clean(b) {
  const str = (v, n = 4000) => (v == null ? null : String(v).trim().slice(0, n) || null);
  const services = (Array.isArray(b.services) ? b.services : []).filter((x) => x && (x.name || x.phase_id)).slice(0, 60).map((x) => ({
    phase_id: Number(x.phase_id) || null, name: str(x.name, 160), status: S_STATUS.includes(x.status) ? x.status : 'em_andamento', note: str(x.note, 300) }));
  const participants = (Array.isArray(b.participants) ? b.participants : []).filter((x) => x && (x.id || x.name)).slice(0, 60).map((x) => ({ kind: ['user', 'supplier'].includes(x.kind) ? x.kind : 'outro', id: Number(x.id) || null, name: str(x.name, 120) }));
  return { date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : today(), kind: str(b.kind, 30) || 'visita', user_id: Number(b.user_id) || null, title: str(b.title, 160),
    description: str(b.description, 8000), services, participants, internal_notes: str(b.internal_notes), client_note: str(b.client_note), decisions: str(b.decisions), problems: str(b.problems) };
}
function saveLog(req, b, existing) {
  const w = work(req, existing ? existing.work_id : b.work_id);
  if (!canWrite(req.user, w)) throw new HttpError(403, 'Sem permissão para registrar nesta obra.');
  const d = clean(b);
  if (!d.description && !d.services.length && !d.title) throw new HttpError(400, 'Selecione o que foi feito ou escreva um resumo.');
  if (!d.description) d.description = d.title || d.services.map((s) => s.name).join(', ');
  // conflito: outra pessoa salvou depois que este formulário foi aberto (uma nova tentativa da MESMA gravação não conta)
  if (existing && b.rev && existing.updated_at && b.rev !== existing.updated_at && !(b.save_key && b.save_key === existing.save_key)) throw Object.assign(new HttpError(409, 'Este registro foi alterado por outra pessoa. Recarregue para ver a versão atual.'), { expose: true });
  const phases = new Map(all('SELECT id, name, status, progress, work_id FROM work_phases WHERE work_id = ?', w.id).map((p) => [p.id, p]));
  d.services.forEach((s) => { if (s.phase_id && !phases.has(s.phase_id)) s.phase_id = null; if (!s.name && s.phase_id) s.name = phases.get(s.phase_id).name; });
  const row = { work_id: w.id, ...d, services: JSON.stringify(d.services), participants: JSON.stringify(d.participants),
    suppliers_present: JSON.stringify(d.participants.filter((x) => x.kind === 'supplier' && x.id).map((x) => x.id)), updated_at: nowIso(), save_key: b.save_key ? String(b.save_key).slice(0, 80) : null };
  return tx(() => {
    let id;
    if (existing) { update('work_logs', existing.id, row); id = existing.id; }
    else { id = insert('work_logs', { ...row, status: 'rascunho', client_visible: 0, client_key: b.client_key ? String(b.client_key).slice(0, 80) : null, created_by: req.user.id, created_at: nowIso() }); }
    // pendências / próximos passos: novas (com chave própria), selecionadas e resolvidas
    const pend = b.pendencies || {};
    const next = new Set((Array.isArray(pend.selected) ? pend.selected : []).map(Number).filter((pid) => get('SELECT 1 FROM work_pendencies WHERE id = ? AND work_id = ?', pid, w.id)));
    (Array.isArray(pend.new) ? pend.new : []).slice(0, 40).forEach((n) => {
      const text = String(n.text || '').trim().slice(0, 400); if (!text) return;
      const key = n.key ? String(n.key).slice(0, 80) : null;
      const prev = key ? get('SELECT id FROM work_pendencies WHERE client_key = ?', key) : null;
      const data = { text, kind: n.kind === 'proximo_passo' ? 'proximo_passo' : 'pendencia', phase_id: phases.has(Number(n.phase_id)) ? Number(n.phase_id) : null, responsible: n.responsible ? String(n.responsible).slice(0, 120) : null,
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(n.due_date || '') ? n.due_date : null, client_visible: n.client_visible === 0 || n.client_visible === false ? 0 : 1 };
      if (prev) { update('work_pendencies', prev.id, data); next.add(prev.id); }
      else next.add(insert('work_pendencies', { ...data, work_id: w.id, created_log_id: id, client_key: key, created_by: req.user.id, created_at: nowIso() }));
    });
    (Array.isArray(pend.resolved) ? pend.resolved : []).map(Number).forEach((pid) => { const p = get('SELECT * FROM work_pendencies WHERE id = ? AND work_id = ?', pid, w.id); if (p && p.status !== 'resolvida') { update('work_pendencies', p.id, { status: 'resolvida', resolved_log_id: id, resolved_at: nowIso() }); next.delete(p.id); } });
    update('work_logs', id, { next_steps: JSON.stringify([...next]) });
    // etapas: só mudam quando o usuário confirma explicitamente (serviço parcial não conclui a etapa)
    const applied = [];
    (Array.isArray(b.phase_changes) ? b.phase_changes : []).forEach((c) => {
      const ph = phases.get(Number(c.phase_id)); if (!ph) return;
      if (c.status === 'concluido' && ph.status !== 'concluido') { update('work_phases', ph.id, { status: 'concluido', progress: 100, completed_at: nowIso() }); applied.push({ phase_id: ph.id, name: ph.name, from: ph.status, to: 'concluido' }); }
      else if (c.status === 'em_andamento' && ph.status === 'nao_iniciado') { update('work_phases', ph.id, { status: 'em_andamento' }); applied.push({ phase_id: ph.id, name: ph.name, from: ph.status, to: 'em_andamento' }); }
    });
    if (applied.length) { const prevApplied = existing ? J(existing.phase_changes, []) : []; update('work_logs', id, { phase_changes: JSON.stringify([...prevApplied, ...applied]) }); proj.recomputeWorkProgress(w.id); }
    return id;
  });
}
router.post('/diary/logs', wrap((req, res) => {
  const b = req.body || {};
  const prev = b.client_key ? get('SELECT * FROM work_logs WHERE client_key = ?', String(b.client_key).slice(0, 80)) : null;
  if (prev) work(req, prev.work_id);
  const id = saveLog(req, b, prev);
  audit(req, prev ? 'update' : 'create', 'work_logs', id, `Diário de obra ${prev ? 'atualizado' : 'registrado'}`);
  res.status(prev ? 200 : 201).json(logOut(get('SELECT l.*, u.name user_name FROM work_logs l LEFT JOIN users u ON u.id = l.user_id WHERE l.id = ?', id)));
}));
router.put('/diary/logs/:id', wrap((req, res) => {
  const l = get('SELECT * FROM work_logs WHERE id = ?', Number(req.params.id)); if (!l) throw new HttpError(404, 'Registro não encontrado.');
  const id = saveLog(req, req.body || {}, l);
  audit(req, 'update', 'work_logs', id, 'Diário de obra atualizado');
  res.json(logOut(get('SELECT l.*, u.name user_name FROM work_logs l LEFT JOIN users u ON u.id = l.user_id WHERE l.id = ?', id)));
}));
router.post('/diary/logs/:id/publish', wrap((req, res) => {
  const l = get('SELECT * FROM work_logs WHERE id = ?', Number(req.params.id)); if (!l) throw new HttpError(404, 'Registro não encontrado.');
  const w = work(req, l.work_id); if (!canWrite(req.user, w)) throw new HttpError(403, 'Sem permissão.');
  update('work_logs', l.id, { status: 'publicado', client_visible: 1, published_at: l.published_at || nowIso(), published_by: req.user.id, updated_at: nowIso() });
  audit(req, 'publish', 'work_logs', l.id, 'Diário de obra publicado para o cliente');
  res.json(logOut(get('SELECT l.*, u.name user_name FROM work_logs l LEFT JOIN users u ON u.id = l.user_id WHERE l.id = ?', l.id)));
}));
router.post('/diary/logs/:id/unpublish', wrap((req, res) => {
  const l = get('SELECT * FROM work_logs WHERE id = ?', Number(req.params.id)); if (!l) throw new HttpError(404, 'Registro não encontrado.');
  const w = work(req, l.work_id); if (!canWrite(req.user, w)) throw new HttpError(403, 'Sem permissão.');
  update('work_logs', l.id, { status: 'rascunho', client_visible: 0, updated_at: nowIso() });
  audit(req, 'unpublish', 'work_logs', l.id, 'Diário de obra retirado da área do cliente');
  res.json({ ok: true });
}));
// legenda / remoção de foto do registro (remoção = arquivar, sem apagar o arquivo)
router.put('/diary/photos/:docId', wrap((req, res) => {
  const d = get("SELECT d.*, l.work_id FROM documents d JOIN work_logs l ON l.id = d.entity_id WHERE d.id = ? AND d.entity = 'work_logs'", Number(req.params.docId));
  if (!d) throw new HttpError(404, 'Foto não encontrada.');
  const w = work(req, d.work_id); if (!canWrite(req.user, w)) throw new HttpError(403, 'Sem permissão.');
  const set = {}; if ('caption' in req.body) set.title = String(req.body.caption || '').slice(0, 200) || d.file_name.replace(/\.[^.]+$/, ''); if (req.body.archived) set.archived = 1;
  update('documents', d.id, set); res.json({ ok: true });
}));

// ------------------------------ ETAPAS DA OBRA (personalizadas por obra) ------------------------------
router.get('/diary/templates', wrap((req, res) => {
  res.json([{ id: 'padrao', name: 'Modelo padrão do escritório', phases: all("SELECT name FROM phase_templates WHERE kind = 'obra' ORDER BY position").map((x) => x.name) },
    ...all('SELECT * FROM work_templates ORDER BY name').map((t) => ({ id: t.id, name: t.name, phases: J(t.phases, []) }))]);
}));
// salva a lista inteira de etapas desta obra (somente desta obra)
router.put('/diary/works/:id/phases', wrap((req, res) => {
  const w = work(req, req.params.id); if (!canWrite(req.user, w)) throw new HttpError(403, 'Sem permissão.');
  const items = Array.isArray(req.body.phases) ? req.body.phases : [];
  const cur = new Map(all('SELECT * FROM work_phases WHERE work_id = ?', w.id).map((p) => [p.id, p]));
  const keep = new Set(); const blocked = [];
  tx(() => {
    items.forEach((it, i) => {
      const name = String(it.name || '').trim().slice(0, 120); if (!name) return;
      const data = { name, position: i, applicable: it.applicable === 0 || it.applicable === false ? 0 : 1, archived: it.archived ? 1 : 0, responsible: it.responsible ? String(it.responsible).slice(0, 120) : null, due_date: /^\d{4}-\d{2}-\d{2}$/.test(it.due_date || '') ? it.due_date : null };
      if (it.id && cur.has(Number(it.id))) { update('work_phases', Number(it.id), data); keep.add(Number(it.id)); }
      else keep.add(insert('work_phases', { ...data, work_id: w.id, status: 'nao_iniciado', progress: 0 }));
    });
    // removidas da lista: apagar só se não houver histórico; com histórico, arquivar
    for (const [id, p] of cur) {
      if (keep.has(id)) continue;
      const used = p.progress > 0 || p.status !== 'nao_iniciado' || get("SELECT 1 FROM work_logs WHERE work_id = ? AND services LIKE ?", w.id, `%"phase_id":${id},%`) || get('SELECT 1 FROM work_pendencies WHERE phase_id = ?', id);
      if (used) { update('work_phases', id, { archived: 1, position: 1000 + p.position }); blocked.push(p.name); } else run('DELETE FROM work_phases WHERE id = ?', id);
    }
    proj.recomputeWorkProgress(w.id);
  });
  audit(req, 'update', 'works', w.id, 'Etapas da obra atualizadas');
  res.json({ phases: all('SELECT * FROM work_phases WHERE work_id = ? ORDER BY position, id', w.id), archived_with_history: blocked });
}));
router.post('/diary/templates', wrap((req, res) => {
  const w = work(req, req.body.work_id);
  const name = String(req.body.name || '').trim().slice(0, 80); if (!name) throw new HttpError(400, 'Dê um nome ao modelo.');
  // copia só a estrutura (nomes e ordem) — sem execução, fotos, pagamentos ou aprovações
  const phases = all('SELECT name FROM work_phases WHERE work_id = ? AND archived = 0 AND applicable = 1 ORDER BY position, id', w.id).map((p) => p.name);
  if (!phases.length) throw new HttpError(400, 'A obra não tem etapas para salvar como modelo.');
  const id = insert('work_templates', { name, phases: JSON.stringify(phases), created_by: req.user.id, created_at: nowIso() });
  audit(req, 'create', 'work_templates', id, `Modelo de etapas “${name}” salvo a partir da obra`);
  res.status(201).json({ id, name, phases });
}));

module.exports = { router };
