// =====================================================================
// Aprovações do cliente: o que depende de decisão dele para a obra seguir.
// Decisões podem vir do portal (login do cliente) ou ser registradas pelo
// escritório quando confirmadas por WhatsApp, telefone, reunião ou e-mail.
// Aprovar NÃO registra pagamento, NÃO contrata fornecedor e NÃO conclui serviço.
// =====================================================================
const { all, get, run, insert, update, tx } = require('../db');
const { HttpError, nowIso, today } = require('../util');

const ORIGINS = { portal: 'Área do Cliente', whatsapp: 'WhatsApp', reuniao: 'reunião', telefone: 'telefone', email: 'e-mail', outro: 'outro meio' };
const STATUS = { aberta: 'Aguardando decisão', ajustes: 'Ajustes solicitados', aprovada: 'Aprovada', cancelada: 'Cancelada' };
const KINDS = ['orcamento', 'documento', 'material', 'outro'];

const lines = (t) => String(t || '').split(/\r?\n/).map((x) => x.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
function quoteRow(id) {
  return id ? get('SELECT q.*, s.company supplier FROM quotes q LEFT JOIN suppliers s ON s.id = q.supplier_id WHERE q.id = ?', id) : null;
}
// resumo congelado no momento da decisão
function snapshot(q) {
  if (!q) return null;
  return { quote_id: q.id, version: q.version || 1, item: q.item, supplier: q.supplier || null, amount: q.amount > 0 ? q.amount : null, scope: q.scope || null,
    included: lines(q.included), excluded: lines(q.excluded), payment_terms: q.payment_terms || null, deadline_days: q.deadline_days || null };
}
const J = (s) => { try { return JSON.parse(s); } catch { return null; } };

function addEvent(approvalId, e) {
  return insert('approval_events', { approval_id: approvalId, action: e.action, actor: e.actor, user_id: e.user_id || null, origin: e.origin || null, confirmed_at: e.confirmed_at || null,
    quote_id: e.quote_id || null, quote_version: e.quote_version || null, snapshot: e.snapshot ? JSON.stringify(e.snapshot) : null, comment: e.comment || null,
    attachment_doc_id: e.attachment_doc_id || null, corrects_event_id: e.corrects_event_id || null, created_at: nowIso() });
}

function officeUsers(projectId) {
  const p = get('SELECT manager_id FROM projects WHERE id = ?', projectId) || {};
  const ids = new Set(all("SELECT id FROM users WHERE active = 1 AND role IN ('admin','gestor')").map((u) => u.id));
  if (p.manager_id) ids.add(p.manager_id);
  return [...ids];
}
function notifyOffice(projectId, { title, body, severity = 'info', approvalId }) {
  const automation = require('./automation');
  officeUsers(projectId).forEach((uid) => automation.notify(uid, { kind: 'aprovacao_cliente', severity, title, body, link: `#/projetos/${projectId}?tab=cliente`, key: `appr_${approvalId}_${Date.now()}_${uid}` }));
}
function interaction(projectId, text, userId, type = 'feedback') {
  const p = get('SELECT client_id FROM projects WHERE id = ?', projectId);
  if (p && p.client_id) run('INSERT INTO client_interactions(client_id, project_id, date, type, description, user_id) VALUES (?,?,?,?,?,?)', p.client_id, projectId, today(), type, text, userId || null);
}

// opções que o cliente pode escolher nesta pendência (somente orçamentos liberados)
function optionsFor(a, { onlyVisible = true } = {}) {
  if (a.quote_id) { const q = quoteRow(a.quote_id); return q && (!onlyVisible || q.client_visible) ? [q] : []; }
  if (a.quote_item) return all(`SELECT q.*, s.company supplier FROM quotes q LEFT JOIN suppliers s ON s.id = q.supplier_id WHERE q.project_id = ? AND q.item = ? ${onlyVisible ? 'AND q.client_visible = 1' : ''} ORDER BY q.amount`, a.project_id, a.quote_item);
  return [];
}

function decide(a, { action, actor, user_id, origin, confirmed_at, quote_id, comment, attachment_doc_id, corrects_event_id, onlyVisible }) {
  if (!['aprovada', 'ajustes'].includes(action)) throw new HttpError(400, 'Decisão inválida.');
  if (a.status === 'cancelada') throw new HttpError(400, 'Esta pendência foi cancelada.');
  let q = null;
  if (action === 'aprovada') {
    const opts = optionsFor(a, { onlyVisible });
    if (opts.length) {
      q = opts.find((o) => o.id === Number(quote_id)) || (opts.length === 1 && !quote_id ? opts[0] : null);
      if (!q) throw new HttpError(400, 'Selecione qual opção foi aprovada.');
    }
  } else if (!String(comment || '').trim()) throw new HttpError(400, 'Descreva os ajustes solicitados.');
  return tx(() => {
    const ev = addEvent(a.id, { action, actor, user_id, origin, confirmed_at, quote_id: q && q.id, quote_version: q && (q.version || 1), snapshot: snapshot(q), comment, attachment_doc_id, corrects_event_id });
    if (action === 'aprovada') {
      update('approvals', a.id, { status: 'aprovada', decided_quote_id: q ? q.id : null, decided_version: q ? q.version || 1 : null, decided_at: nowIso(), updated_at: nowIso() });
      if (q) { // indica a escolha do cliente no orçamento — sem contratar nem lançar pagamento
        run('UPDATE quotes SET client_selected = 0, client_selected_at = NULL WHERE project_id = ? AND item = ? AND id <> ?', q.project_id, q.item, q.id);
        run('UPDATE quotes SET client_selected = 1, client_selected_at = ? WHERE id = ?', nowIso(), q.id);
      }
    } else update('approvals', a.id, { status: 'ajustes', updated_at: nowIso() });
    return { event_id: ev, quote: q };
  });
}

// cliente decide pelo portal
function clientDecision(user, approvalId, body) {
  const a = get('SELECT a.*, p.client_id, p.name project_name FROM approvals a JOIN projects p ON p.id = a.project_id WHERE a.id = ? AND a.client_visible = 1 AND a.archived = 0', approvalId);
  if (!a || a.client_id !== user.client_id) throw new HttpError(404, 'Pendência não encontrada.');
  if (a.status === 'aprovada') throw new HttpError(400, 'Esta decisão já foi registrada.');
  const action = body.action === 'ajustes' ? 'ajustes' : 'aprovada';
  const r = decide(a, { action, actor: 'cliente', user_id: user.id, origin: 'portal', confirmed_at: nowIso(), quote_id: body.quote_id, comment: String(body.comment || '').slice(0, 2000), onlyVisible: true });
  const what = r.quote ? `${r.quote.item} — ${r.quote.supplier || 'fornecedor'} (versão ${r.quote.version || 1})` : a.title;
  if (action === 'aprovada') {
    notifyOffice(a.project_id, { title: `Cliente aprovou: ${what}`, body: a.project_name, severity: 'success', approvalId: a.id });
    interaction(a.project_id, `Cliente aprovou pela Área do Cliente: ${what}`, user.id);
  } else {
    notifyOffice(a.project_id, { title: `Cliente pediu ajustes: ${a.title}`, body: `${a.project_name} — ${String(body.comment).slice(0, 140)}`, severity: 'warning', approvalId: a.id });
    interaction(a.project_id, `Cliente solicitou ajustes em "${a.title}": ${String(body.comment).slice(0, 300)}`, user.id);
  }
  return r;
}

// escritório registra decisão confirmada fora do portal (ou corrige um registro anterior)
function officeDecision(user, approvalId, body) {
  const a = get('SELECT * FROM approvals WHERE id = ?', approvalId);
  if (!a) throw new HttpError(404, 'Pendência não encontrada.');
  const origin = ORIGINS[body.origin] && body.origin !== 'portal' ? body.origin : null;
  if (!origin) throw new HttpError(400, 'Informe por onde o cliente confirmou (WhatsApp, reunião, telefone, e-mail ou outro).');
  const confirmed = String(body.confirmed_at || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(confirmed)) throw new HttpError(400, 'Informe a data da confirmação.');
  if (confirmed > today()) throw new HttpError(400, 'A data da confirmação não pode estar no futuro.');
  let corrects = null;
  if (body.corrects_event_id) {
    corrects = get('SELECT * FROM approval_events WHERE id = ? AND approval_id = ?', body.corrects_event_id, a.id);
    if (!corrects) throw new HttpError(400, 'Registro a corrigir não encontrado.');
    if (!String(body.reason || '').trim()) throw new HttpError(400, 'Informe o motivo da correção.');
  } else if (a.status === 'aprovada') throw new HttpError(400, 'Esta pendência já está aprovada. Para alterar, use "Corrigir registro" informando o motivo.');
  const comment = [body.comment, corrects ? `Correção do registro de ${String(corrects.created_at).slice(0, 10).split('-').reverse().join('/')}: ${body.reason}` : null].filter(Boolean).join('\n');
  const action = body.action === 'ajustes' ? 'ajustes' : 'aprovada';
  const r = decide(a, { action, actor: 'escritorio', user_id: user.id, origin, confirmed_at: confirmed, quote_id: body.quote_id, comment, attachment_doc_id: body.attachment_doc_id ? Number(body.attachment_doc_id) : null, corrects_event_id: corrects ? corrects.id : null, onlyVisible: false });
  interaction(a.project_id, `Decisão registrada pelo escritório (${ORIGINS[origin]}): ${a.title}${r.quote ? ` — ${r.quote.supplier || ''}` : ''}`, user.id, origin === 'whatsapp' ? 'whatsapp' : 'outro');
  return r;
}

// orçamento revisado depois de aprovado: a aprovação antiga fica na versão original e uma nova é solicitada
function quoteRevised(quoteId, version) {
  const q = quoteRow(quoteId); if (!q) return;
  for (const a of all("SELECT * FROM approvals WHERE decided_quote_id = ? AND status = 'aprovada' AND COALESCE(decided_version, 1) < ?", quoteId, version)) {
    update('approvals', a.id, { status: 'aberta', updated_at: nowIso() });
    addEvent(a.id, { action: 'reaberta', actor: 'sistema', quote_id: quoteId, quote_version: version, snapshot: snapshot(q),
      comment: `O orçamento de ${q.supplier || 'fornecedor'} foi revisado (versão ${version}). A aprovação anterior continua registrada para a versão ${a.decided_version || 1}; é necessária nova aprovação.` });
    notifyOffice(a.project_id, { title: `Nova aprovação necessária: ${a.title}`, body: `Orçamento revisado para a versão ${version}.`, severity: 'warning', approvalId: a.id });
  }
}

function eventOut(e, { forClient } = {}) {
  const u = e.user_id ? get('SELECT name FROM users WHERE id = ?', e.user_id) : null;
  const via = ORIGINS[e.origin] || '';
  let label;
  if (e.action === 'criada') label = 'Pendência publicada pelo escritório';
  else if (e.action === 'reaberta') label = 'Nova aprovação necessária';
  else if (e.action === 'cancelada') label = 'Pendência cancelada pelo escritório';
  else if (e.actor === 'cliente') label = e.action === 'aprovada' ? 'Aprovado pelo cliente na Área do Cliente' : 'Ajustes solicitados pelo cliente na Área do Cliente';
  else label = `${e.action === 'aprovada' ? 'Decisão registrada pelo escritório' : 'Pedido de ajustes registrado pelo escritório'} — confirmação recebida por ${via}`;
  if (e.corrects_event_id) label = `Correção: ${label}`;
  return { id: e.id, action: e.action, actor: e.actor, origin: e.origin, label, created_at: e.created_at, confirmed_at: e.confirmed_at, comment: e.comment,
    snapshot: J(e.snapshot), quote_version: e.quote_version, corrects_event_id: e.corrects_event_id, attachment_doc_id: forClient ? null : e.attachment_doc_id,
    by: forClient ? (e.actor === 'cliente' ? 'Você' : e.actor === 'escritorio' ? 'Escritório' : null) : u ? u.name : e.actor === 'cliente' ? 'Cliente' : null };
}
function approvalOut(a, { forClient } = {}) {
  const ev = all('SELECT * FROM approval_events WHERE approval_id = ? ORDER BY id', a.id).map((e) => eventOut(e, { forClient }));
  const q = a.decided_quote_id ? quoteRow(a.decided_quote_id) : null;
  return { id: a.id, project_id: a.project_id, title: a.title, kind: a.kind, quote_item: a.quote_item, quote_id: a.quote_id, document_id: a.document_id, reason: a.reason,
    blocks_stage: a.blocks_stage, due_date: a.due_date, status: a.status, status_label: STATUS[a.status] || a.status, client_visible: a.client_visible, archived: a.archived,
    decided_quote_id: a.decided_quote_id, decided_version: a.decided_version, decided_at: a.decided_at, decided: q ? { supplier: q.supplier, item: q.item, version: a.decided_version, current_version: q.version || 1 } : null,
    options: optionsFor(a, { onlyVisible: !!forClient }).map((o) => ({ id: o.id, supplier: o.supplier || 'Fornecedor', amount: o.amount > 0 ? o.amount : null, version: o.version || 1 })),
    events: ev, created_at: a.created_at, updated_at: a.updated_at };
}

module.exports = { ORIGINS, STATUS, KINDS, addEvent, decide, clientDecision, officeDecision, quoteRevised, approvalOut, eventOut, snapshot, optionsFor, notifyOffice, quoteRow };
