// =====================================================================
// Documentos e cobranças: propostas de honorários (Orçamento de obra),
// contratos com modelos e emissões versionadas, parcelas no financeiro
// (sem duplicidade), informações gerais da obra, orçamento de execução,
// lembretes de cobrança (WhatsApp), modelos de texto, logo e PDFs.
// =====================================================================
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { all, get, run, val, insert, update, tx, getSetting, setSetting } = require('../db');
const { wrap, HttpError, audit, today, round2, nowIso, addDays } = require('../util');
const P = require('../permissions');
const C = require('../constants');
const { R } = require('../resources');
const { fetchOne } = require('../crud');
const docs = require('../services/docs');
const finance = require('../services/finance');
const proj = require('../services/projects');
const pdf = require('../pdf');

const router = express.Router();
const J = docs.json;
const str = (v, max = 20000) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number.isFinite(Number(String(v).replace(',', '.'))) ? Number(String(v).replace(',', '.')) : null);
const dateOrNull = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const needManager = (u) => { if (!P.isManager(u)) throw new HttpError(403, 'Apenas administradores e gestores.'); };
const needFinance = (u) => { if (!P.canFinance(u)) throw new HttpError(403, 'Sem acesso ao financeiro.'); };
const needAdmin = (u) => { if (!u || u.role !== 'admin') throw new HttpError(403, 'Apenas administradores.'); };
const cleanList = (arr, keys) => (Array.isArray(arr) ? arr : J(arr, []) || []).filter((r) => r && keys.some((k) => String(r[k] ?? '').trim())).map((r) => Object.fromEntries(keys.map((k) => [k, r[k] === undefined || r[k] === null ? '' : String(r[k]).trim().slice(0, 2000)])));
const svcLabel = (v) => docs.label('SERVICE_TYPES_ALL', v);
const problemsResponse = (res, list) => res.status(400).json({ error: list.length === 1 ? list[0] : `Há ${list.length} pendências antes de gerar o documento.`, problems: list });

// ====================================================================
// ESCRITÓRIO, LOGO E MODELOS
// ====================================================================
router.get('/office', wrap((req, res) => {
  needManager(req.user);
  const o = docs.office();
  res.json({ office: o, defaults: docs.PROPOSAL_DEFAULTS, fields: docs.FIELDS, blocks: docs.BLOCKS, lists: { SERVICE_TYPES: C.SERVICE_TYPES, WORK_TYPES: C.WORK_TYPES } });
}));

const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
router.post('/office/logo', logoUpload.single('file'), wrap((req, res) => {
  needAdmin(req.user);
  const f = req.file; if (!f) throw new HttpError(400, 'Selecione a imagem da logo.');
  const png = f.buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = f.buffer[0] === 0xff && f.buffer[1] === 0xd8;
  if (!png && !jpg) throw new HttpError(400, 'Envie a logo em PNG (de preferência com fundo transparente) ou JPG.');
  fs.mkdirSync(pdf.BRANDING_DIR, { recursive: true });
  const name = `logo-${Date.now()}.${png ? 'png' : 'jpg'}`;
  fs.writeFileSync(path.join(pdf.BRANDING_DIR, name), f.buffer);
  const old = getSetting('office_logo', '');
  setSetting('office_logo', name);
  if (old && old !== name) fs.unlink(path.join(pdf.BRANDING_DIR, path.basename(old)), () => {});
  audit(req, 'update', 'settings', null, 'Logo do escritório atualizada');
  res.json({ ok: true });
}));
router.delete('/office/logo', wrap((req, res) => {
  needAdmin(req.user);
  const old = getSetting('office_logo', '');
  setSetting('office_logo', '');
  if (old) fs.unlink(path.join(pdf.BRANDING_DIR, path.basename(old)), () => {});
  audit(req, 'update', 'settings', null, 'Logo do escritório restaurada para a original');
  res.json({ ok: true });
}));

router.get('/doc-templates', wrap((req, res) => {
  needManager(req.user);
  const rows = all('SELECT t.*, u.name updated_by_name FROM doc_templates t LEFT JOIN users u ON u.id = t.updated_by ORDER BY t.kind DESC, t.id')
    .map((t) => ({ ...t, status: docs.templateStatus(t), service_label: svcLabel(t.service_type) }));
  res.json({ rows, fields: docs.FIELDS, blocks: docs.BLOCKS });
}));
router.get('/doc-templates/:id', wrap((req, res) => {
  needManager(req.user);
  const t = get('SELECT * FROM doc_templates WHERE id = ?', req.params.id); if (!t) throw new HttpError(404, 'Modelo não encontrado.');
  const versions = all('SELECT v.version, v.created_at, u.name created_by_name FROM doc_template_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.template_id = ? ORDER BY v.version DESC', t.id);
  res.json({ ...t, status: docs.templateStatus(t), service_label: svcLabel(t.service_type), versions });
}));
router.get('/doc-templates/:id/versions/:v', wrap((req, res) => {
  needManager(req.user);
  const v = get('SELECT * FROM doc_template_versions WHERE template_id = ? AND version = ?', req.params.id, req.params.v);
  if (!v) throw new HttpError(404, 'Versão não encontrada.');
  res.json(v);
}));
router.put('/doc-templates/:id', wrap((req, res) => {
  needAdmin(req.user);
  const t = docs.saveTemplate(Number(req.params.id), req.body.body, req.user);
  audit(req, 'update', 'doc_templates', t.id, `Modelo alterado: ${t.name} (versão ${t.version})`);
  res.json({ ...t, status: docs.templateStatus(t) });
}));
router.post('/doc-templates/:id/restore-default', wrap((req, res) => {
  needAdmin(req.user);
  const t = get('SELECT * FROM doc_templates WHERE id = ?', req.params.id); if (!t) throw new HttpError(404, 'Modelo não encontrado.');
  const body = (t.kind === 'proposta' ? docs.TPL_PROPOSTA : docs.TPL_CONTRATO)[t.service_type];
  const n = docs.saveTemplate(t.id, body, req.user);
  audit(req, 'update', 'doc_templates', t.id, `Modelo restaurado ao texto original: ${t.name} (versão ${n.version})`);
  res.json({ ...n, status: docs.templateStatus(n) });
}));

// ====================================================================
// PROPOSTAS DE HONORÁRIOS (Propostas › Orçamento de obra)
// ====================================================================
function nextProposalNumber() {
  const y = today().slice(0, 4);
  const nums = all('SELECT number FROM proposals WHERE number IS NOT NULL').map((r) => String(r.number).match(new RegExp(`^(\\d+)_${y}$`))).filter(Boolean).map((m) => parseInt(m[1], 10));
  let n = (nums.length ? Math.max(...nums) : 0) + 1;
  while (get('SELECT 1 FROM proposals WHERE number = ?', `${String(n).padStart(3, '0')}_${y}`)) n++;
  return `${String(n).padStart(3, '0')}_${y}`;
}
function loadProposal(u, id) {
  needManager(u);
  const p = get(`SELECT pr.*, COALESCE(c.name, pr.prospect_name) client_name, c.name registered_client_name, c.doc client_doc, c.whatsapp client_whatsapp, c.phone client_phone, c.email client_email, c.address client_address, c.city client_city,
    p.name project_name, u.name responsible_name FROM proposals pr LEFT JOIN clients c ON c.id = pr.client_id LEFT JOIN projects p ON p.id = pr.project_id LEFT JOIN users u ON u.id = pr.responsible_id WHERE pr.id = ?`, id);
  if (!p) throw new HttpError(404, 'Proposta não encontrada.');
  return p;
}
function proposalOut(p) {
  const tpl = p.template_id ? get('SELECT id, name, version FROM doc_templates WHERE id = ?', p.template_id) : null;
  const contracts = all('SELECT id, number, status, amount FROM contracts WHERE proposal_id = ? ORDER BY id DESC', p.id);
  const plan = docs.normalizePlan(p.payment_plan);
  return {
    ...p, extra: J(p.extra, {}) || {}, stages: J(p.stages, []) || [], payment_plan: plan, plan_check: docs.planCheck(p.amount, plan),
    services: docs.proposalServices(p), is_prospect: !p.client_id,
    template: tpl, template_outdated: !!(tpl && p.template_version && tpl.version > p.template_version), contracts,
    receivables: val("SELECT COUNT(*) FROM incomes WHERE group_key = ? AND status <> 'cancelado'", `prop-${p.id}`) || 0,
  };
}
const PROPOSAL_FIELDS = ['services', 'prospect_name', 'prospect_doc', 'prospect_phone', 'prospect_email', 'prospect_address', 'prospect_city', 'number', 'client_id', 'title', 'project_id', 'service_type', 'work_type', 'issue_date', 'valid_until', 'contact_name', 'address', 'city', 'area', 'summary', 'scope', 'excluded',
  'deliverables', 'stages', 'deadline_text', 'amount', 'down_payment', 'payment_plan', 'payment_method', 'pix_key', 'pix_name', 'conditions', 'extra', 'body', 'notes', 'responsible_id'];
function readProposal(b, existing) {
  const d = {};
  for (const k of PROPOSAL_FIELDS) {
    if (!(k in b)) continue;
    const v = b[k];
    if (['client_id', 'project_id', 'responsible_id'].includes(k)) d[k] = v ? Number(v) : null;
    else if (['area', 'amount', 'down_payment'].includes(k)) d[k] = numOrNull(v);
    else if (['issue_date', 'valid_until'].includes(k)) d[k] = dateOrNull(v);
    else if (k === 'stages') d[k] = JSON.stringify(cleanList(v, ['etapa', 'prazo']));
    else if (k === 'payment_plan') d[k] = JSON.stringify(docs.normalizePlan(v));
    else if (k === 'extra') { const e = typeof v === 'object' && v ? v : J(v, {}); d[k] = JSON.stringify(Object.fromEntries(Object.entries(e || {}).map(([kk, vv]) => [kk, vv === null ? '' : String(vv).slice(0, 2000)]))); }
    else if (k === 'body') d[k] = v === null ? null : String(v).replace(/\r\n/g, '\n').slice(0, 100000);
    else if (k === 'services') {
      const list = (Array.isArray(v) ? v : J(v, []) || []).filter((x) => x && C.SERVICE_TYPES.some((t) => t.value === x.type));
      const seen = new Set(); const clean = [];
      for (const x of list) { if (seen.has(x.type)) continue; seen.add(x.type); clean.push({ type: x.type, description: str(x.description, 1000) || '', amount: numOrNull(x.amount) }); }
      d.services = JSON.stringify(clean);
      d.service_type = clean.length ? docs.primaryService(clean) : null;
      // com valores por serviço, o total é a soma (sem contar duas vezes)
      if (clean.some((x) => x.amount != null)) d.amount = round2(clean.reduce((sum, x) => sum + (x.amount || 0), 0));
    }
    else d[k] = str(v);
  }
  if (d.service_type && !C.SERVICE_TYPES_ALL.some((s) => s.value === d.service_type)) throw new HttpError(400, 'Tipo de serviço inválido.');
  const merged = { ...(existing || {}), ...d };
  if (!merged.client_id && !merged.prospect_name) throw new HttpError(400, 'Informe o nome do interessado ou selecione um cliente cadastrado.');
  if (merged.client_id && 'client_id' in d) { d.prospect_name = d.prospect_name ?? null; }
  if (!merged.title) throw new HttpError(400, 'Informe o projeto ou serviço da proposta.');
  if (d.number) { const dup = get('SELECT id FROM proposals WHERE number = ? AND id <> ?', d.number, existing ? existing.id : 0); if (dup) throw new HttpError(400, `Já existe uma proposta com o número ${d.number}.`); }
  if (d.payment_plan) { const plan = J(d.payment_plan, []); d.installments = plan.length || 1; }
  if ('amount' in d && d.amount === null) d.amount = 0;
  if ('amount' in d && !('services' in d) && existing) { const sv = docs.proposalServices(existing); if (sv.some((x) => x.amount != null)) d.amount = round2(sv.reduce((sum, x) => sum + (x.amount || 0), 0)); }
  return d;
}
// Valores iniciais das entregas, etapas e itens não incluídos para os serviços escolhidos (sem repetir itens)
function mergedDefaults(services) {
  const types = services.map((x) => x.type);
  const uniq = (arr, key) => { const seen = new Set(); return arr.filter((x) => { const k = String(key ? x[key] : x).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const def = (t) => docs.PROPOSAL_DEFAULTS[t] || {};
  let excluded = uniq(types.flatMap((t) => def(t).excluded || []));
  if (types.includes('acompanhamento')) excluded = excluded.filter((x) => !/^acompanhamento de obra/i.test(x));
  return { deliverables: uniq(types.flatMap((t) => def(t).deliverables || [])), stages: uniq(types.flatMap((t) => def(t).stages || []), 'etapa'), excluded };
}
router.post('/honorarios', wrap((req, res) => {
  needManager(req.user);
  const b = { ...(req.body || {}) };
  let services = Array.isArray(b.services) ? b.services.filter((x) => x && x.type) : [];
  if (!services.length) services = [{ type: C.SERVICE_TYPES.some((x) => x.value === b.service_type) ? b.service_type : 'interiores' }];
  delete b.service_type;
  const st = docs.primaryService(services);
  const tpl = docs.templateFor('proposta', st);
  const o = docs.office();
  const def = mergedDefaults(services);
  const base = {
    issue_date: today(), valid_until: addDays(today(), o.validity_days), payment_method: 'pix', pix_key: o.pix_key, pix_name: o.pix_name,
    deliverables: def.deliverables.join('\n'), excluded: def.excluded.join('\n'), stages: def.stages, body: tpl ? tpl.body : '', ...b, services,
  };
  const d = readProposal(base, null);
  d.kind = 'honorarios'; d.status = 'elaboracao'; d.number = d.number || nextProposalNumber(); d.responsible_id = d.responsible_id || req.user.id;
  if (tpl) { d.template_id = tpl.id; d.template_version = tpl.version; }
  if (!d.address && d.client_id) { const c = get('SELECT address, city FROM clients WHERE id = ?', d.client_id); if (c) { d.address = c.address; d.city = c.city; } }
  if (!d.address && d.prospect_address) { d.address = d.prospect_address; d.city = d.city || d.prospect_city; }
  d.created_at = nowIso(); d.updated_at = nowIso();
  const id = insert('proposals', d);
  audit(req, 'create', 'proposals', id, `Proposta de honorários criada: ${d.number} — ${d.title}${d.client_id ? '' : ' (interessado sem cadastro)'}`);
  res.status(201).json(proposalOut(loadProposal(req.user, id)));
}));
router.get('/proposal-defaults', wrap((req, res) => { needManager(req.user); res.json(mergedDefaults(String(req.query.types || '').split(',').filter(Boolean).map((type) => ({ type })))); }));

// ------------------------------ Interessado → cliente ------------------------------
const digits = (v) => String(v || '').replace(/\D/g, '');
function clientMatches(p) {
  const rows = all('SELECT id, name, doc, phone, whatsapp, email, city, archived FROM clients');
  const nm = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const pn = nm(p.prospect_name); const pd = digits(p.prospect_doc); const pp = digits(p.prospect_phone).slice(-9); const pe = String(p.prospect_email || '').trim().toLowerCase();
  return rows.map((c) => {
    const why = [];
    if (pd && digits(c.doc) === pd) why.push('mesmo CPF/CNPJ');
    if (pe && String(c.email || '').trim().toLowerCase() === pe) why.push('mesmo e-mail');
    if (pp && pp.length >= 8 && [c.phone, c.whatsapp].some((x) => digits(x).slice(-9) === pp)) why.push('mesmo telefone');
    if (pn && nm(c.name) === pn) why.push('mesmo nome');
    else if (pn && pn.length > 3 && (nm(c.name).includes(pn) || pn.includes(nm(c.name)))) why.push('nome parecido');
    return why.length ? { ...c, why } : null;
  }).filter(Boolean);
}
router.get('/honorarios/:id/client-matches', wrap((req, res) => {
  const p = loadProposal(req.user, Number(req.params.id));
  res.json({ prospect: { name: p.prospect_name, doc: p.prospect_doc, phone: p.prospect_phone, email: p.prospect_email, address: p.prospect_address, city: p.prospect_city }, matches: p.client_id ? [] : clientMatches(p) });
}));
router.post('/honorarios/:id/convert-client', wrap((req, res) => {
  const p = loadProposal(req.user, Number(req.params.id));
  if (p.client_id) return res.json({ client_id: p.client_id, already: true });
  const b = req.body || {};
  let cid = b.client_id ? Number(b.client_id) : null;
  if (cid) { if (!get('SELECT 1 FROM clients WHERE id = ?', cid)) throw new HttpError(404, 'Cliente não encontrado.'); }
  else {
    if (!p.prospect_name) throw new HttpError(400, 'Informe o nome do interessado na proposta.');
    const m = clientMatches(p).filter((x) => x.why.some((w) => w !== 'nome parecido'));
    if (m.length && !b.force) return res.status(409).json({ error: 'Já existe cadastro com dados iguais. Vincule ao cliente existente ou confirme a criação de um novo cadastro.', matches: m });
    const d = digits(p.prospect_doc);
    cid = insert('clients', { name: p.prospect_name, person_type: d.length === 14 ? 'PJ' : 'PF', doc: p.prospect_doc || null, whatsapp: p.prospect_phone || null, phone: p.prospect_phone || null,
      email: p.prospect_email || null, address: p.prospect_address || null, city: p.prospect_city || null, origin: null, created_by: req.user.id, created_at: nowIso() });
    audit(req, 'create', 'clients', cid, `Cliente criado a partir da proposta ${p.number}: ${p.prospect_name}`);
  }
  update('proposals', p.id, { client_id: cid, client_converted_at: nowIso(), updated_at: nowIso() });
  run('INSERT INTO client_interactions(client_id, project_id, date, type, description, user_id) VALUES (?,?,?,?,?,?)', cid, p.project_id, today(), 'feedback', `Proposta ${p.number} (${p.title}) vinculada ao cadastro do cliente${p.status === 'aprovada' ? ' — aprovada' : ''}`, req.user.id);
  audit(req, 'update', 'proposals', p.id, `Interessado da proposta ${p.number} convertido em cliente`);
  res.json({ client_id: cid });
}));
const needClient = (p) => { if (!p.client_id) { const e = new HttpError(409, 'Esta proposta é de um interessado ainda sem cadastro. Converta o interessado em cliente para continuar.'); e.needClient = true; throw e; } };
router.get('/honorarios/:id', wrap((req, res) => res.json(proposalOut(loadProposal(req.user, Number(req.params.id))))));
router.put('/honorarios/:id', wrap((req, res) => {
  const p = loadProposal(req.user, Number(req.params.id));
  const d = readProposal(req.body || {}, p);
  if (d.service_type && d.service_type !== p.service_type && req.body.apply_template) {
    const tpl = docs.templateFor('proposta', d.service_type);
    if (tpl) { d.body = tpl.body; d.template_id = tpl.id; d.template_version = tpl.version; }
  }
  d.updated_at = nowIso();
  update('proposals', p.id, d);
  audit(req, 'update', 'proposals', p.id, `Proposta de honorários alterada: ${p.number}`);
  res.json(proposalOut(loadProposal(req.user, p.id)));
}));
router.post('/honorarios/:id/reload-template', wrap((req, res) => {
  const p = loadProposal(req.user, Number(req.params.id));
  const tpl = docs.templateFor('proposta', p.service_type || 'interiores'); if (!tpl) throw new HttpError(404, 'Modelo não encontrado.');
  update('proposals', p.id, { body: tpl.body, template_id: tpl.id, template_version: tpl.version, updated_at: nowIso() });
  audit(req, 'update', 'proposals', p.id, `Texto da proposta ${p.number} atualizado para o modelo versão ${tpl.version}`);
  res.json(proposalOut(loadProposal(req.user, p.id)));
}));
router.post('/honorarios/:id/duplicate', wrap((req, res) => {
  const p = loadProposal(req.user, Number(req.params.id));
  const copy = {};
  for (const k of [...PROPOSAL_FIELDS, 'kind', 'template_id', 'template_version', 'installments']) if (k !== 'number' && k !== 'project_id') copy[k] = p[k];
  Object.assign(copy, { number: nextProposalNumber(), status: 'elaboracao', title: `${p.title} (cópia)`, issue_date: today(), valid_until: addDays(today(), docs.office().validity_days), created_at: nowIso(), updated_at: nowIso(), responsible_id: req.user.id });
  const id = insert('proposals', copy);
  audit(req, 'create', 'proposals', id, `Proposta ${copy.number} duplicada de ${p.number}`);
  res.status(201).json(proposalOut(loadProposal(req.user, id)));
}));
// Converte uma proposta simples antiga para o formato de orçamento de obra
router.post('/honorarios/:id/upgrade', wrap((req, res) => {
  const p = loadProposal(req.user, Number(req.params.id));
  if (p.kind === 'honorarios') return res.json(proposalOut(p));
  const st = /interior/i.test(p.project_type || '') ? 'interiores' : 'arquitetonico';
  const tpl = docs.templateFor('proposta', st); const o = docs.office(); const def = docs.PROPOSAL_DEFAULTS[st] || {};
  update('proposals', p.id, {
    kind: 'honorarios', service_type: st, services: JSON.stringify([{ type: st, description: '', amount: null }]), issue_date: p.issue_date || (p.created_at || today()).slice(0, 10), body: tpl ? tpl.body : '', template_id: tpl && tpl.id, template_version: tpl && tpl.version,
    payment_method: p.payment_method || 'pix', pix_key: p.pix_key || o.pix_key, pix_name: p.pix_name || o.pix_name, deliverables: (def.deliverables || []).join('\n'), excluded: (def.excluded || []).join('\n'),
    stages: JSON.stringify(def.stages || []), payment_plan: JSON.stringify(docs.buildPlan({ total: p.amount, count: p.installments || 1, first_due: addDays(today(), 7) })), updated_at: nowIso(),
  });
  audit(req, 'update', 'proposals', p.id, `Proposta ${p.number} convertida para orçamento de obra`);
  res.json(proposalOut(loadProposal(req.user, p.id)));
}));

router.post('/honorarios/:id/status', wrap((req, res) => {
  const p = loadProposal(req.user, Number(req.params.id));
  const b = req.body || {}; const st = b.status;
  if (!C.PROPOSAL_STATUS.some((s) => s.value === st)) throw new HttpError(400, 'Status inválido.');
  const d = { status: st, updated_at: nowIso() };
  if (st === 'enviada') { d.sent_at = dateOrNull(b.sent_at) || p.sent_at || today(); d.decided_at = null; }
  if (st === 'aprovada') {
    if (!str(b.approved_by)) throw new HttpError(400, 'Informe quem aprovou a proposta (ex.: nome do cliente).');
    d.approved_by = str(b.approved_by, 200); d.approved_at = dateOrNull(b.approved_at) || today(); d.approval_notes = str(b.approval_notes, 2000); d.approved_user_id = req.user.id; d.decided_at = d.approved_at;
  }
  if (st === 'recusada') { d.refusal_reason = str(b.refusal_reason, 500); d.decided_at = today(); }
  if (st === 'expirada') d.decided_at = today();
  if (st === 'elaboracao') { d.decided_at = null; }
  if (st !== 'aprovada' && p.status === 'aprovada') { d.approved_by = null; d.approved_at = null; d.approval_notes = null; d.approved_user_id = null; }
  update('proposals', p.id, d);
  const lbl = { enviada: 'Proposta enviada', aprovada: `Proposta aprovada por ${d.approved_by}`, recusada: 'Proposta recusada', expirada: 'Proposta expirada' }[st];
  if (lbl && p.client_id) run('INSERT INTO client_interactions(client_id, project_id, date, type, description, user_id) VALUES (?,?,?,?,?,?)', p.client_id, p.project_id, d.approved_at || today(), 'feedback', `${lbl} — ${p.number} ${p.title}`, req.user.id);
  audit(req, 'update', 'proposals', p.id, `Proposta ${p.number}: status ${docs.label('PROPOSAL_STATUS', st)}${st === 'aprovada' ? ` (aprovação registrada: ${d.approved_by}, ${docs.brDate(d.approved_at)})` : ''}`);
  res.json(proposalOut(loadProposal(req.user, p.id)));
}));

// Cria o projeto a partir da proposta aprovada (reaproveita cliente, endereço, área e valor)
router.post('/honorarios/:id/project', wrap((req, res) => {
  const p = loadProposal(req.user, Number(req.params.id));
  if (p.project_id) throw new HttpError(400, 'Esta proposta já está vinculada a um projeto.');
  needClient(p);
  const type = { interiores: 'Interiores', arquitetonico: 'Arquitetura', arq_interiores: 'Arquitetura', acompanhamento: 'Acompanhamento de obra', visita: 'Consultoria' }[p.service_type] || null;
  // (com vários serviços, o tipo do projeto segue o serviço principal da proposta)
  const id = tx(() => {
    const pid = insert('projects', { code: proj.nextCode('projects', 'P'), name: p.title, client_id: p.client_id, address: p.address, city: p.city, type, area: p.area, contract_value: p.amount,
      contracted_at: p.approved_at || today(), start_date: today(), manager_id: p.responsible_id || req.user.id, status: 'ativo', proposal_id: p.id, created_by: req.user.id, created_at: nowIso() });
    proj.createPhasesFromTemplate(pid, today());
    run('INSERT OR IGNORE INTO project_members(project_id, user_id) VALUES (?,?)', pid, p.responsible_id || req.user.id);
    run('UPDATE proposals SET project_id = ? WHERE id = ?', pid, p.id);
    run("UPDATE incomes SET project_id = ? WHERE group_key = ? AND project_id IS NULL", pid, `prop-${p.id}`);
    run('UPDATE contracts SET project_id = ? WHERE proposal_id = ? AND project_id IS NULL', pid, p.id);
    return pid;
  });
  audit(req, 'convert', 'proposals', p.id, `Projeto criado a partir da proposta ${p.number}`);
  res.json({ project_id: id });
}));

// ====================================================================
// CONTRATOS COM MODELOS
// ====================================================================
function contractDataDefaults({ client, office, proposal, project }) {
  const ex = proposal ? J(proposal.extra, {}) || {} : {};
  const addr = (x) => [x.address, x.city, x.state].filter(Boolean).join(', ') + (x.zip ? `, CEP ${x.zip}` : '');
  return {
    contratante_nome: client ? client.name : '', contratante_doc: client ? client.doc || '' : '', contratante_endereco: client ? addr(client) : '',
    contratante_representante: '', contratante_rep_doc: '',
    contratado_nome: office.contractor_name || '', contratado_doc: office.contractor_doc || '', contratado_endereco: office.contractor_address || '', contratado_registro: office.contractor_registry || '',
    projeto_nome: proposal ? proposal.title : project ? project.name : '',
    objeto: proposal ? proposal.summary || '' : '', localizacao: proposal ? [proposal.address, proposal.city].filter(Boolean).join(' – ') : project ? [project.address, project.city].filter(Boolean).join(' – ') : '',
    area: proposal && proposal.area ? String(proposal.area) : project && project.area ? String(project.area) : '',
    escopo: proposal ? proposal.scope || proposal.deliverables || '' : '', nao_incluidos: proposal ? proposal.excluded || '' : '', entregas: proposal ? proposal.deliverables || '' : '',
    etapas: proposal ? proposal.stages || '[]' : '[]', condicoes: proposal ? proposal.conditions || '' : '',
    prazo_data: '', prazo_texto: proposal ? proposal.deadline_text || '' : '',
    periodicidade: ex.periodicidade || '', visitas: ex.visitas || '', periodo_inicio: ex.periodo_inicio || '', periodo_fim: ex.periodo_fim || '', cobranca: ex.cobranca || '', valor_visita: ex.valor_visita || '',
    visita_local: ex.visita_local || '', visita_finalidade: ex.visita_finalidade || '', visita_data: ex.visita_data || '', visita_duracao: ex.visita_duracao || '',
    local_assinatura: office.city || '', data_assinatura: today(),
    pix_key: proposal ? proposal.pix_key || office.pix_key : office.pix_key, pix_name: proposal ? proposal.pix_name || office.pix_name : office.pix_name,
    testemunha1_nome: '', testemunha1_doc: '', testemunha2_nome: '', testemunha2_doc: '',
  };
}
function createContract({ serviceType, clientId, projectId, proposal, user }) {
  const tpl = docs.templateFor('contrato', serviceType);
  if (!tpl) throw new HttpError(400, 'Modelo de contrato não encontrado para este serviço.');
  const client = get('SELECT * FROM clients WHERE id = ?', clientId); if (!client) throw new HttpError(400, 'Selecione o cliente.');
  const project = projectId ? get('SELECT * FROM projects WHERE id = ?', projectId) : null;
  const data = contractDataDefaults({ client, office: docs.office(), proposal, project });
  const plan = proposal ? docs.normalizePlan(proposal.payment_plan) : [];
  const id = insert('contracts', {
    number: proj.nextCode('contracts', 'CT'), client_id: client.id, project_id: projectId || null, proposal_id: proposal ? proposal.id : null,
    amount: proposal ? proposal.amount || 0 : 0, installments: plan.length || 1, first_due_date: plan[0] ? plan[0].due_date : null, payment_method: proposal ? proposal.payment_method : 'pix',
    status: 'elaboracao', service_type: serviceType, template_id: tpl.id, template_version: tpl.version, body: tpl.body, data: JSON.stringify(data), payment_plan: JSON.stringify(plan),
    start_date: today(), created_at: nowIso(), updated_at: nowIso(),
  });
  // parcelas já cadastradas a partir da proposta passam a pertencer ao contrato
  if (proposal) {
    const n = run("UPDATE incomes SET contract_id = ? WHERE group_key = ? AND contract_id IS NULL", id, `prop-${proposal.id}`).changes;
    if (n) run('UPDATE contracts SET receivables_generated = 1 WHERE id = ?', id);
  }
  audit({ user, ip: null }, 'create', 'contracts', id, `Contrato criado com o modelo "${tpl.name}" (versão ${tpl.version})${proposal ? ` a partir da proposta ${proposal.number}` : ''}`);
  return id;
}
router.post('/contracts/from-template', wrap((req, res) => {
  needManager(req.user);
  const b = req.body || {};
  if (!C.SERVICE_TYPES_ALL.some((s) => s.value === b.service_type)) throw new HttpError(400, 'Selecione o modelo de contrato.');
  const id = createContract({ serviceType: b.service_type, clientId: Number(b.client_id), projectId: b.project_id ? Number(b.project_id) : null, user: req.user });
  res.status(201).json({ id });
}));
router.post('/honorarios/:id/contract', wrap((req, res) => {
  const p = loadProposal(req.user, Number(req.params.id));
  needClient(p);
  const existing = get("SELECT id, number FROM contracts WHERE proposal_id = ? AND status <> 'cancelado' ORDER BY id DESC", p.id);
  if (existing && !req.body.force) return res.status(409).json({ error: `Já existe o contrato ${existing.number} gerado a partir desta proposta.`, contract_id: existing.id });
  // com projeto arquitetônico e de interiores na mesma proposta, usa o modelo de contrato conjunto
  const types = docs.proposalServices(p).map((x) => x.type);
  const ctType = types.includes('arquitetonico') && types.includes('interiores') ? 'arq_interiores' : p.service_type || 'interiores';
  const id = createContract({ serviceType: ctType, clientId: p.client_id, projectId: p.project_id, proposal: p, user: req.user });
  res.status(201).json({ id });
}));

function loadContract(u, id) {
  needManager(u);
  const c = get(`SELECT ct.*, c.name client_name, p.name project_name, pr.number proposal_number FROM contracts ct LEFT JOIN clients c ON c.id = ct.client_id
    LEFT JOIN projects p ON p.id = ct.project_id LEFT JOIN proposals pr ON pr.id = ct.proposal_id WHERE ct.id = ?`, id);
  if (!c) throw new HttpError(404, 'Contrato não encontrado.');
  return c;
}
function contractOut(c) {
  const tpl = c.template_id ? get('SELECT id, name, version, body FROM doc_templates WHERE id = ?', c.template_id) : null;
  const plan = docs.normalizePlan(c.payment_plan);
  return {
    ...c, data: J(c.data, {}) || {}, payment_plan: plan, plan_check: docs.planCheck(c.amount, plan),
    template: tpl ? { id: tpl.id, name: tpl.name, version: tpl.version, status: docs.templateStatus(tpl) } : null,
    template_outdated: !!(tpl && c.template_version && tpl.version > c.template_version),
    issues: all('SELECT i.id, i.version, i.issued_at, i.template_version, i.notes, u.name issued_by_name FROM contract_issues i LEFT JOIN users u ON u.id = i.issued_by WHERE i.contract_id = ? ORDER BY i.version DESC', c.id),
    receivables: val("SELECT COUNT(*) FROM incomes WHERE contract_id = ? AND status <> 'cancelado'", c.id) || 0,
  };
}
router.get('/contract-docs/:id', wrap((req, res) => res.json(contractOut(loadContract(req.user, Number(req.params.id))))));
const CONTRACT_DATA_KEYS = ['contratante_nome', 'contratante_doc', 'contratante_endereco', 'contratante_representante', 'contratante_rep_doc', 'contratado_nome', 'contratado_doc', 'contratado_endereco', 'contratado_registro',
  'projeto_nome', 'objeto', 'localizacao', 'area', 'escopo', 'nao_incluidos', 'entregas', 'etapas', 'condicoes', 'prazo_data', 'prazo_texto', 'periodicidade', 'visitas', 'periodo_inicio', 'periodo_fim', 'cobranca', 'valor_visita',
  'visita_local', 'visita_finalidade', 'visita_data', 'visita_duracao', 'local_assinatura', 'data_assinatura', 'pix_key', 'pix_name', 'testemunha1_nome', 'testemunha1_doc', 'testemunha2_nome', 'testemunha2_doc'];
router.put('/contract-docs/:id', wrap((req, res) => {
  const c = loadContract(req.user, Number(req.params.id));
  const b = req.body || {}; const d = {};
  if (b.data) {
    const cur = J(c.data, {}) || {};
    for (const k of CONTRACT_DATA_KEYS) if (k in b.data) cur[k] = k === 'etapas' ? JSON.stringify(cleanList(b.data[k], ['etapa', 'prazo'])) : b.data[k] === null ? '' : String(b.data[k]).slice(0, 20000);
    d.data = JSON.stringify(cur);
  }
  if ('body' in b) d.body = String(b.body || '').replace(/\r\n/g, '\n').slice(0, 150000);
  if ('amount' in b) d.amount = round2(numOrNull(b.amount) || 0);
  if ('payment_method' in b) d.payment_method = str(b.payment_method, 40);
  if ('notes' in b) d.notes = str(b.notes);
  if ('project_id' in b) d.project_id = b.project_id ? Number(b.project_id) : null;
  if ('service_type' in b && C.SERVICE_TYPES_ALL.some((s) => s.value === b.service_type)) d.service_type = b.service_type;
  if ('payment_plan' in b) { const plan = docs.normalizePlan(b.payment_plan); d.payment_plan = JSON.stringify(plan); d.installments = plan.length || 1; d.first_due_date = plan[0] ? plan[0].due_date : null; }
  if (d.service_type && d.service_type !== c.service_type && b.apply_template) {
    const tpl = docs.templateFor('contrato', d.service_type); if (tpl) { d.body = tpl.body; d.template_id = tpl.id; d.template_version = tpl.version; }
  }
  d.updated_at = nowIso();
  update('contracts', c.id, d);
  audit(req, 'update', 'contracts', c.id, `Contrato ${c.number} alterado`);
  res.json(contractOut(loadContract(req.user, c.id)));
}));
router.post('/contract-docs/:id/reload-template', wrap((req, res) => {
  const c = loadContract(req.user, Number(req.params.id));
  const st = C.SERVICE_TYPES_ALL.some((s) => s.value === req.body.service_type) ? req.body.service_type : c.service_type || 'interiores';
  const tpl = docs.templateFor('contrato', st); if (!tpl) throw new HttpError(404, 'Modelo não encontrado.');
  const d = { body: tpl.body, template_id: tpl.id, template_version: tpl.version, service_type: st, updated_at: nowIso() };
  // contratos antigos (sem ficha): preenche os dados das partes a partir dos cadastros
  if (!c.data) {
    const proposal = c.proposal_id ? get('SELECT * FROM proposals WHERE id = ?', c.proposal_id) : null;
    d.data = JSON.stringify(contractDataDefaults({ client: get('SELECT * FROM clients WHERE id = ?', c.client_id), office: docs.office(), proposal, project: c.project_id ? get('SELECT * FROM projects WHERE id = ?', c.project_id) : null }));
    if (!c.payment_plan) {
      const plan = proposal && proposal.payment_plan ? docs.normalizePlan(proposal.payment_plan) : c.amount > 0 ? docs.buildPlan({ total: c.amount, count: c.installments || 1, first_due: c.first_due_date || today() }) : [];
      d.payment_plan = JSON.stringify(plan);
    }
  }
  update('contracts', c.id, d);
  audit(req, 'update', 'contracts', c.id, `Texto do contrato ${c.number} atualizado para o modelo versão ${tpl.version}`);
  res.json(contractOut(loadContract(req.user, c.id)));
}));
function contractProblems(c) {
  const ctx = docs.contractContext(c); const d = ctx.data;
  const base = [];
  if (!d.contratante_nome) base.push('Preencha: Contratante — nome / razão social.');
  if (!d.contratante_doc) base.push('Preencha: Contratante — CPF/CNPJ.');
  if (!d.contratante_endereco) base.push('Preencha: Contratante — endereço.');
  if (!d.contratado_nome) base.push('Preencha: Contratado — nome (cadastre em Configurações › Escritório para reaproveitar).');
  if (!(c.amount > 0)) base.push('Informe o valor total do contrato.');
  const chk = docs.planCheck(c.amount, c.payment_plan);
  if (!docs.normalizePlan(c.payment_plan).length) base.push('Cadastre as parcelas e os vencimentos.');
  else if (!chk.ok) base.push(Math.abs(chk.diff) >= 0.005 ? `A soma das parcelas (${docs.brl(chk.sum)}) não confere com o valor total (${docs.brl(c.amount)}). Diferença: ${docs.brl(chk.diff)}.` : 'Todas as parcelas precisam de data de vencimento e valor.');
  if (/pix/i.test(c.payment_method || '') && !(d.pix_key ?? docs.office().pix_key)) base.push('Informe a chave Pix (Configurações › Escritório) ou altere a forma de pagamento.');
  return { ctx, list: docs.problems(c.body, ctx, base) };
}
router.get('/contract-docs/:id/check', wrap((req, res) => {
  const c = loadContract(req.user, Number(req.params.id));
  const { list } = contractProblems(c);
  res.json({ ok: !list.length, problems: list });
}));
function contractPdfMeta(c, ctx, versionLabel) {
  const svc = svcLabel(c.service_type);
  return {
    title: 'Contrato de prestação de serviço',
    purpose: `Instrumento particular de prestação de serviços${svc ? ' de ' + svc.toLowerCase() : ''} entre as partes qualificadas abaixo, com objeto, valores, forma de pagamento, prazos e condições.`,
    ident: [['Contrato nº', c.number], ['Versão', versionLabel], ['Serviço', svc], ['Contratante', ctx.vars['contratante.nome'] || c.client_name, 2], ['Valor total', ctx.vars.valor_total], ['Projeto', ctx.vars['projeto.nome'] || c.project_name, 2], ['Parcelas', ctx.plan.length ? `${ctx.plan.length}x` : '']],
  };
}
router.post('/contract-docs/:id/issue', wrap((req, res) => {
  const c = loadContract(req.user, Number(req.params.id));
  const { ctx, list } = contractProblems(c);
  if (list.length) return problemsResponse(res, list);
  const version = (val('SELECT MAX(version) FROM contract_issues WHERE contract_id = ?', c.id) || 0) + 1;
  const issuedAt = nowIso();
  const meta = contractPdfMeta(c, ctx, `${version}ª emissão`);
  const snapshot = { meta, tokens: docs.resolve(c.body, ctx), vars: ctx.vars, plan: ctx.plan, body: c.body, data: ctx.data, amount: c.amount, number: c.number, template: { id: c.template_id, version: c.template_version }, issued_at: issuedAt };
  const id = insert('contract_issues', { contract_id: c.id, version, template_id: c.template_id, template_version: c.template_version, snapshot: JSON.stringify(snapshot), notes: str(req.body.notes, 500), issued_by: req.user.id, issued_at: issuedAt });
  if (c.status === 'elaboracao') run("UPDATE contracts SET status = 'aguardando_assinatura' WHERE id = ?", c.id);
  audit(req, 'generate', 'contracts', c.id, `Contrato ${c.number} emitido — versão ${version}`);
  res.status(201).json({ issue_id: id, version });
}));

// ====================================================================
// PARCELAS NO FINANCEIRO (a partir da proposta aprovada ou do contrato)
// ====================================================================
function planReceivables(source, id, user, confirm) {
  needFinance(user);
  let rec; let plan; let contractId = null; let groupKey; let projectId; let clientId; let title; let unsigned = false; let proposalId = null;
  if (source === 'contract') {
    rec = loadContract(user, id); plan = docs.normalizePlan(rec.payment_plan); contractId = rec.id; projectId = rec.project_id; clientId = rec.client_id; proposalId = rec.proposal_id;
    groupKey = `ct-${rec.id}`; title = rec.project_name || (J(rec.data, {}) || {}).projeto_nome || `Contrato ${rec.number}`; unsigned = ['elaboracao', 'aguardando_assinatura'].includes(rec.status);
  } else {
    rec = loadProposal(user, id); plan = docs.normalizePlan(rec.payment_plan); projectId = rec.project_id; clientId = rec.client_id; groupKey = `prop-${rec.id}`; title = rec.title; proposalId = rec.id;
    if (rec.status !== 'aprovada') throw new HttpError(400, 'Registre a aprovação da proposta antes de cadastrar as parcelas.');
    needClient(rec);
  }
  const chk = docs.planCheck(rec.amount, plan);
  if (!plan.length) throw new HttpError(400, 'Cadastre as parcelas e os vencimentos antes.');
  if (!chk.ok) throw new HttpError(400, `A soma das parcelas (${docs.brl(chk.sum)}) não confere com o valor total (${docs.brl(rec.amount)}).`);
  // lançamentos já existentes: vinculados ao contrato, ou cadastrados a partir da proposta de origem
  const linked = all(`SELECT id, description, amount, due_date, status, contract_id, group_key FROM incomes WHERE status <> 'cancelado' AND (${contractId ? 'contract_id = ? OR ' : ''}group_key = ? ${proposalId ? 'OR group_key = ?' : ''})`,
    ...(contractId ? [contractId] : []), groupKey, ...(proposalId ? [`prop-${proposalId}`] : []));
  const similar = all("SELECT id, description, amount, due_date, status, contract_id, group_key FROM incomes WHERE client_id = ? AND status <> 'cancelado'", clientId);
  const n = plan.length;
  const rows = plan.map((r, i) => {
    const same = (x) => Math.abs(x.amount - r.amount) < 0.01 && x.due_date === r.due_date;
    const match = linked.find(same) || similar.find(same);
    return { n: i + 1, total: n, label: r.label, due_date: r.due_date, amount: r.amount, existing: match ? { id: match.id, description: match.description, status: match.status, linked: !!linked.find((x) => x.id === match.id) } : null };
  });
  const out = { rows, to_create: rows.filter((r) => !r.existing).length, already: rows.filter((r) => r.existing).length, linked_other: linked.filter((x) => !rows.some((r) => r.existing && r.existing.id === x.id)).length };
  if (!confirm) return out;
  const cat = { interiores: 'Projeto de interiores', arquitetonico: 'Projeto de arquitetura', arq_interiores: 'Projeto de arquitetura', acompanhamento: 'Acompanhamento de obra', visita: 'Consultoria' }[rec.service_type] || 'Projeto de arquitetura';
  const created = tx(() => {
    const ids = [];
    if (contractId) for (const r of rows) if (r.existing && !r.existing.linked && !get('SELECT contract_id FROM incomes WHERE id = ?', r.existing.id).contract_id && String(get('SELECT group_key FROM incomes WHERE id = ?', r.existing.id).group_key || '').startsWith('prop-'))
      run('UPDATE incomes SET contract_id = ? WHERE id = ?', contractId, r.existing.id);
    for (const r of rows) {
      if (r.existing) continue;
      const row = {
        client_id: clientId, project_id: projectId || null, contract_id: contractId, category: cat, method: rec.payment_method || null,
        description: `${title} — ${r.label || 'Parcela'} (${r.n}/${n})`, amount: r.amount, due_date: r.due_date, installment_no: r.n, installment_total: n,
        group_key: groupKey, status: unsigned ? 'previsto' : 'a_receber', created_by: user.id, created_at: nowIso(),
        notes: source === 'contract' ? `Gerada a partir do contrato ${rec.number}` : `Gerada a partir da proposta ${rec.number}`,
      };
      finance.normalize('incomes', row);
      if (unsigned) row.status = 'previsto';
      ids.push(insert('incomes', row));
    }
    if (contractId) run('UPDATE contracts SET receivables_generated = 1 WHERE id = ?', contractId);
    if (projectId && rec.amount) run('UPDATE projects SET contract_value = ? WHERE id = ? AND (contract_value IS NULL OR contract_value = 0)', rec.amount, projectId);
    return ids;
  });
  finance.refreshStatuses();
  return { ...out, created: created.length, ids: created };
}
router.post('/plan-receivables', wrap((req, res) => {
  const b = req.body || {};
  const r = planReceivables(b.source === 'contract' ? 'contract' : 'proposal', Number(b.id), req.user, !!b.confirm);
  if (b.confirm) audit(req, 'generate', b.source === 'contract' ? 'contracts' : 'proposals', Number(b.id), `${r.created} parcela(s) cadastrada(s) no financeiro (${r.already} já existiam)`);
  res.json(r);
}));

// ====================================================================
// INFORMAÇÕES GERAIS DA OBRA (dentro do projeto)
// ====================================================================
const SITE_LISTS = {
  executives: ['nome', 'situacao', 'revisao', 'entrega'],
  pending_project: ['descricao', 'responsavel', 'prazo', 'situacao'],
  pending_execution: ['descricao', 'responsavel', 'prazo', 'situacao'],
  approvals: ['descricao', 'responsavel', 'prazo', 'situacao'],
  next_steps: ['descricao', 'inicio', 'conclusao', 'responsavel'],
};
function siteInfo(u, projectId) {
  const project = fetchOne(R.projects, u, projectId);
  const row = get('SELECT s.*, u.name updated_by_name, r.name responsible_user FROM project_site_info s LEFT JOIN users u ON u.id = s.updated_by LEFT JOIN users r ON r.id = s.responsible_id WHERE s.project_id = ?', project.id);
  const work = get("SELECT * FROM works WHERE project_id = ? ORDER BY archived, CASE status WHEN 'em_andamento' THEN 0 ELSE 1 END, id DESC", project.id);
  const info = row ? { ...row } : { project_id: project.id, address: (work && work.address) || [project.address, project.city].filter(Boolean).join(' – '), responsible_id: (work && work.responsible_id) || project.manager_id, updated_on: today(), situation: work ? { em_andamento: 'em_andamento', pausada: 'pausada', concluida: 'concluida', planejada: 'nao_iniciada' }[work.status] || '' : '', _new: true };
  for (const k of Object.keys(SITE_LISTS)) info[k] = J(info[k], []) || [];
  const client = project.client_id ? get('SELECT id, name FROM clients WHERE id = ?', project.client_id) : null;
  return { info, project: { id: project.id, name: project.name, code: project.code, address: project.address, city: project.city, manager_id: project.manager_id }, client, work: work ? { id: work.id, name: work.name, progress: work.progress, status: work.status } : null };
}
router.get('/projects/:id/site-info', wrap((req, res) => res.json(siteInfo(req.user, Number(req.params.id)))));
router.put('/projects/:id/site-info', wrap((req, res) => {
  const project = fetchOne(R.projects, req.user, Number(req.params.id));
  if (!R.project_phases.write(req.user, null, { project_id: project.id })) throw new HttpError(403, 'Sem permissão para editar este projeto.');
  const b = req.body || {};
  const d = {
    address: str(b.address, 500), responsible_id: b.responsible_id ? Number(b.responsible_id) : null, responsible_name: str(b.responsible_name, 200), updated_on: dateOrNull(b.updated_on) || today(),
    situation: C.SITE_SITUATION.some((s) => s.value === b.situation) ? b.situation : null, summary: str(b.summary), notes: str(b.notes),
    executives_status: C.EXECUTIVES_STATUS.some((s) => s.value === b.executives_status) ? b.executives_status : null,
    updated_by: req.user.id, updated_at: nowIso(),
  };
  for (const [k, keys] of Object.entries(SITE_LISTS)) d[k] = JSON.stringify(cleanList(b[k], keys).slice(0, 300));
  const ex = J(d.executives, []);
  if (ex.length && !b.executives_status_manual) d.executives_status = ex.every((x) => x.situacao === 'entregue') ? 'entregues' : ex.some((x) => x.situacao === 'entregue') ? 'parcial' : 'nao_entregues';
  const cur = get('SELECT id FROM project_site_info WHERE project_id = ?', project.id);
  if (cur) update('project_site_info', cur.id, d); else insert('project_site_info', { project_id: project.id, ...d, created_at: nowIso() });
  audit(req, 'update', 'projects', project.id, `Informações gerais da obra atualizadas — ${project.name}`);
  res.json(siteInfo(req.user, project.id));
}));

// ====================================================================
// ORÇAMENTO DE EXECUÇÃO DA OBRA
// ====================================================================
function budget(u, workId) {
  const work = fetchOne(R.works, u, workId);
  const items = all('SELECT * FROM work_budget_items WHERE work_id = ? ORDER BY position, id', work.id);
  const total = round2(items.reduce((s, i) => s + round2(i.qty * i.unit_price), 0));
  const quotes = all("SELECT q.id, q.item, q.amount, q.status, s.company supplier_name FROM quotes q LEFT JOIN suppliers s ON s.id = q.supplier_id WHERE q.project_id = ? AND q.status IN ('aprovado','contratado') ORDER BY q.item", work.project_id);
  return { work: { id: work.id, name: work.name, budget: work.budget, budget_notes: work.budget_notes, project_id: work.project_id, project_name: work.project_name, client_name: work.client_name, address: work.address, responsible_name: work.responsible_name }, items, total, quotes };
}
router.get('/works/:id/budget', wrap((req, res) => res.json(budget(req.user, Number(req.params.id)))));
router.put('/works/:id/budget', wrap((req, res) => {
  const work = fetchOne(R.works, req.user, Number(req.params.id));
  if (!R.works.write(req.user, work, work)) throw new HttpError(403, 'Sem permissão para editar esta obra.');
  const items = (Array.isArray(req.body.items) ? req.body.items : []).filter((i) => i && String(i.item || '').trim()).slice(0, 1000);
  tx(() => {
    run('DELETE FROM work_budget_items WHERE work_id = ?', work.id);
    items.forEach((i, pos) => insert('work_budget_items', { work_id: work.id, position: pos, group_name: str(i.group_name, 200), item: String(i.item).trim().slice(0, 500), description: str(i.description, 4000),
      qty: numOrNull(i.qty) ?? 1, unit: str(i.unit, 20), unit_price: round2(numOrNull(i.unit_price) || 0), notes: str(i.notes, 2000) }));
    if ('budget_notes' in req.body) run('UPDATE works SET budget_notes = ?, updated_at = ? WHERE id = ?', str(req.body.budget_notes), nowIso(), work.id);
    if (req.body.apply_total) run('UPDATE works SET budget = ? WHERE id = ?', round2(items.reduce((s, i) => s + (numOrNull(i.qty) ?? 1) * (numOrNull(i.unit_price) || 0), 0)), work.id);
  });
  audit(req, 'update', 'works', work.id, `Orçamento de execução atualizado — ${items.length} item(ns)`);
  res.json(budget(req.user, work.id));
}));

// ====================================================================
// LEMBRETES DE COBRANÇA (WhatsApp) — o envio é sempre feito pelo usuário
// ====================================================================
const REMINDER_SQL = `SELECT br.*, i.description, i.amount, i.installment_no, i.installment_total, i.status income_status, i.client_id, i.project_id,
  c.name client_name, c.whatsapp client_whatsapp, c.phone client_phone, p.name project_name, u.name sent_by_name
  FROM billing_reminders br JOIN incomes i ON i.id = br.income_id LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN projects p ON p.id = i.project_id LEFT JOIN users u ON u.id = br.sent_by`;
router.get('/reminders', wrap((req, res) => {
  needFinance(req.user);
  require('../services/automation').syncReminders();
  const t = today();
  const open = all(`${REMINDER_SQL} WHERE br.status = 'pendente' AND i.status IN ('a_receber','vencido') ORDER BY br.due_date DESC, c.name`).map((r) => docs.reminderView(r, t));
  const sent = all(`${REMINDER_SQL} WHERE br.status = 'enviado' AND (i.status IN ('a_receber','vencido') OR br.sent_at >= ?) ORDER BY br.sent_at DESC LIMIT 100`, addDays(t, -45)).map((r) => docs.reminderView(r, t));
  res.json({ today: t, open, sent, pix_missing: !docs.office().pix_key, templates: docs.waTemplates() });
}));
function loadReminder(u, id) { needFinance(u); const r = get(`${REMINDER_SQL} WHERE br.id = ?`, id); if (!r) throw new HttpError(404, 'Lembrete não encontrado.'); return r; }
router.put('/reminders/:id', wrap((req, res) => {
  const r = loadReminder(req.user, Number(req.params.id));
  const msg = req.body.message === null || req.body.reset ? null : String(req.body.message || '').trim().slice(0, 4000) || null;
  run('UPDATE billing_reminders SET custom_message = ?, edited_at = ? WHERE id = ?', msg, msg ? nowIso() : null, r.id);
  res.json(docs.reminderView(get(`${REMINDER_SQL} WHERE br.id = ?`, r.id)));
}));
router.post('/reminders/:id/sent', wrap((req, res) => {
  const r = loadReminder(req.user, Number(req.params.id));
  run("UPDATE billing_reminders SET status = 'enviado', sent_at = ?, sent_by = ? WHERE id = ?", nowIso(), req.user.id, r.id);
  if (r.client_id) run('INSERT INTO client_interactions(client_id, project_id, date, type, description, user_id) VALUES (?,?,?,?,?,?)', r.client_id, r.project_id, today(), 'whatsapp',
    `Lembrete de cobrança enviado pelo WhatsApp — ${r.description} (${docs.brl(r.amount)}, vencimento ${docs.brDate(r.due_date)})`, req.user.id);
  run("DELETE FROM notifications WHERE kind = 'lembrete_cobranca' AND dedupe_key = ? AND read_at IS NULL", `remind_${r.income_id}_${r.due_date}`);
  audit(req, 'update', 'incomes', r.income_id, `Lembrete de cobrança marcado como enviado: ${r.description}`);
  res.json(docs.reminderView(get(`${REMINDER_SQL} WHERE br.id = ?`, r.id)));
}));
router.post('/reminders/:id/unsent', wrap((req, res) => {
  const r = loadReminder(req.user, Number(req.params.id));
  run("UPDATE billing_reminders SET status = 'pendente', sent_at = NULL, sent_by = NULL WHERE id = ?", r.id);
  audit(req, 'update', 'incomes', r.income_id, `Lembrete de cobrança voltou para "a enviar": ${r.description}`);
  res.json(docs.reminderView(get(`${REMINDER_SQL} WHERE br.id = ?`, r.id)));
}));

// ====================================================================
// PDFs  (?check=1 apenas confere; ?draft=1 gera rascunho com marca d'água)
// ====================================================================
const draftVars = (ctx) => { for (const [k, lbl] of Object.entries(docs.FIELDS)) if (!ctx.vars[k] && !['cliente.contato', 'pix.favorecido', 'obra.tipo', 'area', 'entrada', 'cliente.documento', 'contratante.representacao', 'local_data'].includes(k)) ctx.vars[k] = `[${lbl}]`; return ctx; };
const fileName = (...parts) => parts.filter(Boolean).join(' - ') + '.pdf';

function proposalProblems(p) {
  const ctx = docs.proposalContext(p);
  const base = [];
  if (!p.number) base.push('Informe o número da proposta.');
  if (!p.issue_date) base.push('Informe a data da proposta.');
  if (!p.valid_until) base.push('Informe a validade da proposta.');
  else if (p.issue_date && p.valid_until < p.issue_date) base.push('A validade não pode ser anterior à data da proposta.');
  if (!docs.proposalServices(p).length) base.push('Adicione ao menos um serviço à proposta.');
  if (!p.client_id && !p.prospect_name) base.push('Informe o interessado ou selecione um cliente cadastrado.');
  if (!(p.amount > 0)) base.push('Informe o valor total.');
  const plan = docs.normalizePlan(p.payment_plan); const chk = docs.planCheck(p.amount, plan);
  if (!plan.length) base.push('Cadastre as parcelas e os vencimentos.');
  else if (!chk.ok) base.push(Math.abs(chk.diff) >= 0.005 ? `A soma da entrada e das parcelas (${docs.brl(chk.sum)}) não confere com o valor total (${docs.brl(p.amount)}). Diferença: ${docs.brl(chk.diff)}.` : 'Todas as parcelas precisam de data de vencimento e valor.');
  if (p.down_payment > 0 && plan[0] && Math.abs(plan[0].amount - p.down_payment) > 0.009) base.push(`A primeira parcela (${docs.brl(plan[0].amount)}) não corresponde à entrada informada (${docs.brl(p.down_payment)}).`);
  if (p.payment_method === 'pix' && !p.pix_key) base.push('Informe a chave Pix da proposta (ou cadastre em Configurações › Escritório).');
  return { ctx, list: docs.problems(p.body, ctx, base) };
}
router.get('/pdf/proposal/:id', wrap(async (req, res) => {
  const p = loadProposal(req.user, Number(req.params.id));
  const draft = req.query.draft === '1';
  const { ctx, list } = proposalProblems(p);
  if (req.query.check === '1') return res.json({ ok: !list.length, problems: list });
  if (list.length && !draft) return problemsResponse(res, list);
  if (draft) draftVars(ctx);
  const svc = docs.servicesLabel(docs.proposalServices(p));
  const doc = pdf.build({
    title: 'Proposta de honorários', draft,
    purpose: `Proposta de prestação de serviços${svc ? ' de ' + svc.toLowerCase() : ''} elaborada para ${ctx.vars['cliente.nome'] || 'o cliente'}. Reúne escopo, etapas, prazos, investimento e condições para análise e aprovação.`,
    ident: [['Proposta nº', p.number], ['Data', docs.brDate(p.issue_date)], ['Validade', docs.brDate(p.valid_until)], ['Cliente', ctx.vars['cliente.nome'], 2], ['A/C', p.contact_name],
      ['Projeto / serviço', p.title, 3], ['Serviços', svc, 3], ['Endereço', ctx.vars['projeto.endereco'], 2], ['Tipo de obra', ctx.vars['obra.tipo']], ['Área aproximada', ctx.vars.area]],
    content: pdf.tokensToContent(docs.resolve(p.body, ctx)),
    info: { title: `Proposta ${p.number} — ${p.title}` },
  });
  await pdf.send(res, doc, fileName(`Proposta ${p.number}`, ctx.vars['cliente.nome']), req.query.download === '1');
}));
router.get('/pdf/contract/:id', wrap(async (req, res) => {
  const c = loadContract(req.user, Number(req.params.id));
  const { ctx, list } = contractProblems(c);
  if (req.query.check === '1') return res.json({ ok: !list.length, problems: list });
  draftVars(ctx);
  const meta = contractPdfMeta(c, ctx, 'Rascunho (não emitido)');
  await pdf.send(res, pdf.build({ ...meta, draft: true, content: pdf.tokensToContent(docs.resolve(c.body, ctx), { justify: true }) }), fileName(`Contrato ${c.number} (rascunho)`, c.client_name), req.query.download === '1');
}));
router.get('/pdf/contract-issue/:id', wrap(async (req, res) => {
  needManager(req.user);
  const i = get('SELECT i.*, ct.number, c.name client_name FROM contract_issues i JOIN contracts ct ON ct.id = i.contract_id LEFT JOIN clients c ON c.id = ct.client_id WHERE i.id = ?', Number(req.params.id));
  if (!i) throw new HttpError(404, 'Emissão não encontrada.');
  const s = JSON.parse(i.snapshot);
  await pdf.send(res, pdf.build({ ...s.meta, issuedAt: i.issued_at, content: pdf.tokensToContent(s.tokens, { justify: true }) }), fileName(`Contrato ${i.number} v${i.version}`, i.client_name), req.query.download === '1');
}));

router.get('/pdf/site-info/:projectId', wrap(async (req, res) => {
  const { info, project, client, work } = siteInfo(req.user, Number(req.params.projectId));
  const list = [];
  if (info._new) list.push('Salve as informações gerais da obra antes de gerar o relatório.');
  if (!info.situation) list.push('Informe a situação atual da obra.');
  if (!info.responsible_id && !info.responsible_name) list.push('Informe o responsável pelo acompanhamento.');
  if (req.query.check === '1') return res.json({ ok: !list.length, problems: list });
  if (list.length) return problemsResponse(res, list);
  const L = (key, v) => docs.label(key, v);
  const resp = info.responsible_name || info.responsible_user || '';
  const tbl = (rows, headers, map, widths) => pdf.dataTable({ headers, rows: rows.map(map), widths });
  const content = [
    pdf.sectionTitle('Resumo do andamento'), ...(info.summary ? String(info.summary).split(/\r?\n/).filter(Boolean).map((l) => pdf.para(l)) : [pdf.muted('Nenhum resumo registrado.')]), pdf.spacer(4),
    pdf.sectionTitle('Projetos executivos'),
    info.executives_status ? pdf.para(`**Situação geral:** ${L('EXECUTIVES_STATUS', info.executives_status)}`) : '',
    tbl(info.executives, ['Projeto executivo', 'Situação', 'Revisão', 'Entrega'], (r) => [r.nome, L('EXECUTIVE_ITEM_STATUS', r.situacao), r.revisao, docs.brDate(r.entrega)], ['*', 96, 62, 70]),
    pdf.sectionTitle('Pendências de projeto'), tbl(info.pending_project, ['Pendência', 'Responsável', 'Prazo', 'Situação'], (r) => [r.descricao, r.responsavel, docs.brDate(r.prazo), L('PENDING_STATUS', r.situacao)], ['*', 110, 62, 70]),
    pdf.sectionTitle('Pendências de execução'), tbl(info.pending_execution, ['Pendência', 'Responsável', 'Prazo', 'Situação'], (r) => [r.descricao, r.responsavel, docs.brDate(r.prazo), L('PENDING_STATUS', r.situacao)], ['*', 110, 62, 70]),
    pdf.sectionTitle('Aprovações necessárias do cliente'), tbl(info.approvals, ['Item para aprovação', 'Responsável', 'Prazo', 'Situação'], (r) => [r.descricao, r.responsavel, docs.brDate(r.prazo), L('APPROVAL_STATUS', r.situacao)], ['*', 110, 62, 80]),
    pdf.sectionTitle('Próximas etapas e planejamento'), tbl(info.next_steps, ['Etapa / serviço previsto', 'Previsão de início', 'Previsão de conclusão', 'Responsável'], (r) => [r.descricao, docs.brDate(r.inicio), docs.brDate(r.conclusao), r.responsavel], ['*', 70, 76, 110]),
    info.next_steps.length ? pdf.note('Previsões informadas pelo escritório na data de atualização deste relatório.') : '',
    pdf.sectionTitle('Observações gerais'), ...(info.notes ? String(info.notes).split(/\r?\n/).filter(Boolean).map((l) => pdf.para(l)) : [pdf.muted('Sem observações.')]),
  ].filter(Boolean);
  const doc = pdf.build({
    title: 'Relatório geral da obra',
    purpose: 'Registro do andamento da obra, da entrega dos projetos executivos, das pendências, das aprovações necessárias e do planejamento das próximas etapas, conforme as informações atualizadas pelo escritório.',
    ident: [['Cliente', client ? client.name : '', 2], ['Data de atualização', docs.brDate(info.updated_on)], ['Projeto', project.name, 2], ['Situação atual', L('SITE_SITUATION', info.situation)], ['Endereço da obra', info.address, 2], ['Responsável pelo acompanhamento', resp]],
    content,
  });
  await pdf.send(res, doc, fileName('Relatorio da obra', project.name, docs.brDate(info.updated_on).replace(/\//g, '-')), req.query.download === '1');
}));

router.get('/pdf/work-budget/:id', wrap(async (req, res) => {
  const b = budget(req.user, Number(req.params.id));
  const list = [];
  if (!b.items.length) list.push('Cadastre ao menos um item no orçamento de execução.');
  if (req.query.check === '1') return res.json({ ok: !list.length, problems: list });
  if (list.length) return problemsResponse(res, list);
  const w = b.work; const rows = [];
  const groups = [...new Set(b.items.map((i) => i.group_name || ''))];
  const multi = groups.length > 1 || (groups[0] || '') !== '';
  for (const g of groups) {
    const its = b.items.filter((i) => (i.group_name || '') === g);
    if (multi) rows.push([{ text: (g || 'Outros itens').toUpperCase(), colSpan: 5, fontSize: 7.6, bold: true, characterSpacing: 0.6, fillColor: pdf.FILL, margin: [0, 1, 0, 0] }, {}, {}, {}, {}]);
    for (const i of its) rows.push([{ stack: [{ text: i.item, bold: true, fontSize: 8.8 }, i.description ? { text: i.description, fontSize: 8, color: pdf.MUTED, margin: [0, 1, 0, 0] } : '', i.notes ? { text: i.notes, fontSize: 7.6, color: pdf.MUTED, italics: true } : ''] },
      String(i.qty).replace('.', ','), i.unit || '', docs.brl(i.unit_price), docs.brl(round2(i.qty * i.unit_price))]);
    if (multi) rows.push([{ text: `Subtotal ${g || 'outros itens'}`, colSpan: 4, alignment: 'right', fontSize: 8, color: pdf.MUTED }, {}, {}, {}, { text: docs.brl(round2(its.reduce((s, i) => s + i.qty * i.unit_price, 0))), alignment: 'right', fontSize: 8.4, bold: true }]);
  }
  const content = [
    pdf.sectionTitle('Itens do orçamento'),
    pdf.dataTable({ headers: ['Item / descrição', 'Qtd.', 'Un.', 'Valor unitário', 'Subtotal'], rows, widths: ['*', 40, 34, 78, 82], align: ['left', 'right', 'center', 'right', 'right'],
      foot: [{ text: 'TOTAL DO ORÇAMENTO', colSpan: 4, alignment: 'right', characterSpacing: 0.6 }, {}, {}, {}, { text: docs.brl(b.total), alignment: 'right', fontSize: 10.5 }] }),
    pdf.para(`Valor total estimado: **${docs.brl(b.total)}** (${docs.extenso(b.total)}).`),
    w.budget_notes ? pdf.sectionTitle('Observações') : '', ...(w.budget_notes ? String(w.budget_notes).split(/\r?\n/).filter(Boolean).map((l) => pdf.para(l)) : []),
  ].filter(Boolean);
  const doc = pdf.build({
    title: 'Orçamento de execução da obra',
    purpose: 'Estimativa dos itens, quantidades e valores para a execução da obra, organizada por etapa, para conferência e aprovação do cliente.',
    ident: [['Cliente', w.client_name, 2], ['Data', docs.brDate(today())], ['Projeto', w.project_name, 2], ['Obra', w.name], ['Endereço da obra', w.address, 2], ['Responsável', w.responsible_name]],
    content,
  });
  await pdf.send(res, doc, fileName('Orcamento de execucao', w.project_name), req.query.download === '1');
}));

router.get('/pdf/work-phases/:id', wrap(async (req, res) => {
  const work = fetchOne(R.works, req.user, Number(req.params.id));
  const phases = all('SELECT wp.*, s.company supplier_name FROM work_phases wp LEFT JOIN suppliers s ON s.id = wp.supplier_id WHERE wp.work_id = ? ORDER BY wp.position, wp.id', work.id);
  const list = [];
  if (!phases.length) list.push('Cadastre as etapas da obra antes de gerar o PDF.');
  if (req.query.check === '1') return res.json({ ok: !list.length, problems: list });
  if (list.length) return problemsResponse(res, list);
  const logs = all("SELECT date, pending FROM work_logs WHERE work_id = ? AND pending IS NOT NULL AND pending <> '' ORDER BY date DESC, id DESC LIMIT 12", work.id);
  const pend = phases.filter((p) => p.pending || p.next_action);
  const L = (v) => docs.label('PHASE_STATUS', v);
  const content = [
    pdf.sectionTitle('Etapas'),
    pdf.dataTable({ headers: ['Etapa', 'Situação', 'Exec.', 'Responsável', 'Início', 'Término'], widths: ['*', 78, 34, 100, 54, 54], align: ['left', 'left', 'right', 'left', 'center', 'center'],
      rows: phases.map((p) => [{ text: p.name, bold: true }, L(p.status), `${p.progress || 0}%`, p.responsible || p.supplier_name || '', docs.brDate(p.start_date), docs.brDate(p.due_date)]) }),
    pdf.sectionTitle('Pendências e próximas ações'),
    pdf.dataTable({ headers: ['Etapa', 'Pendências', 'Próxima ação'], widths: [110, '*', '*'], rows: pend.map((p) => [{ text: p.name, bold: true }, p.pending || '', p.next_action || '']), empty: 'Nenhuma pendência ou próxima ação registrada nas etapas.' }),
    logs.length ? pdf.sectionTitle('Pendências registradas no diário de obra') : '',
    logs.length ? pdf.dataTable({ headers: ['Data', 'Pendência'], widths: [60, '*'], rows: logs.map((l) => [docs.brDate(l.date), l.pending]) }) : '',
  ].filter(Boolean);
  const doc = pdf.build({
    title: 'Etapas da obra',
    purpose: 'Situação de cada etapa da obra, com responsáveis, datas, pendências e próximas ações, para acompanhamento entre escritório, cliente e fornecedores.',
    ident: [['Cliente', work.client_name, 2], ['Data', docs.brDate(today())], ['Projeto', work.project_name, 2], ['Executado', `${work.progress || 0}%`], ['Endereço da obra', work.address, 2], ['Responsável', work.responsible_name],
      ['Início', docs.brDate(work.start_date)], ['Previsão de conclusão', docs.brDate(work.due_date)], ['Situação', docs.label('WORK_STATUS', work.status)]],
    content,
  });
  await pdf.send(res, doc, fileName('Etapas da obra', work.project_name), req.query.download === '1');
}));

module.exports = { router, planReceivables };
