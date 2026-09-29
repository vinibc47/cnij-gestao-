// =====================================================================
// Atas de reunião, recibos, placas de obra, comparativo de orçamentos e
// avisos de atualização do portal (mensagem para copiar — nunca enviada
// automaticamente).
// =====================================================================
const fs = require('fs');
const path = require('path');
const express = require('express');
const { all, get, run, val, insert, update, tx, getSetting } = require('../db');
const { wrap, HttpError, audit, today, round2, nowIso, addDays } = require('../util');
const P = require('../permissions');
const C = require('../constants');
const { R } = require('../resources');
const { fetchOne } = require('../crud');
const docs = require('../services/docs');
const pdf = require('../pdf');
const sign = require('../pdf/sign');
const { UPLOAD_DIR } = require('./ops');

const router = express.Router();
const J = docs.json;
const str = (v, max = 20000) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
const num = (v) => { if (v === '' || v === null || v === undefined) return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const dateOrNull = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const L = (list, v) => docs.label(list, v);
const fileName = (...parts) => parts.filter(Boolean).join(' - ') + '.pdf';
const problemsResponse = (res, list) => res.status(400).json({ error: list.length === 1 ? list[0] : `Há ${list.length} pendências antes de gerar o documento.`, problems: list });
const paras = (t) => String(t || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// ====================================================================
// ATA DE REUNIÃO — PDF
// ====================================================================
function minutesDoc(a) {
  const steps = (J(a.next_steps, []) || []).filter((s) => s && (s.acao || s.responsavel || s.prazo));
  const content = [
    pdf.sectionTitle('Participantes'), ...(paras(a.participants).length ? paras(a.participants).map((l) => pdf.bullet(l)) : [pdf.muted('Não informado.')]), pdf.spacer(4),
    pdf.sectionTitle('Assuntos e decisões'), ...paras(a.content).map((l) => (/^[-•]\s+/.test(l) ? pdf.bullet(l.replace(/^[-•]\s+/, '')) : pdf.para(l, true))),
    steps.length ? pdf.sectionTitle('Próximos passos') : '',
    steps.length ? pdf.dataTable({ headers: ['Ação', 'Responsável', 'Prazo'], widths: ['*', 130, 70], rows: steps.map((s) => [s.acao || '', s.responsavel || '', docs.brDate(s.prazo) || s.prazo || '']) }) : '',
    { text: `Registrado por ${a.created_by_name || '—'}${a.updated_at ? ` · última alteração em ${docs.brDate(a.updated_at)}` : ''}.`, style: 'muted', margin: [0, 18, 0, 0] },
  ].filter(Boolean);
  return pdf.build({
    title: 'Ata de reunião',
    purpose: 'Registro dos participantes, dos assuntos tratados, das decisões tomadas e dos próximos passos combinados na reunião.',
    ident: [['Data', docs.brDate(a.date)], ['Ata nº', a.number], ['Local', a.location], ['Cliente', a.client_name, 2], ['Código do projeto', a.project_code], ['Projeto', a.project_name, 2], ['Assunto', a.title]],
    content, info: { title: `Ata ${a.number || ''} — ${a.title || ''}` },
  });
}
router.get('/pdf/minutes/:id', wrap(async (req, res) => {
  const a = fetchOne(R.meeting_minutes, req.user, Number(req.params.id));
  const list = [];
  if (!a.date) list.push('Informe a data da reunião.');
  if (!String(a.content || '').trim()) list.push('Registre os assuntos e as decisões da reunião.');
  if (req.query.check === '1') return res.json({ ok: !list.length, problems: list });
  if (list.length) return problemsResponse(res, list);
  await pdf.send(res, minutesDoc(a), fileName(`Ata ${a.number || ''}`.trim(), a.project_name || a.client_name, docs.brDate(a.date).replace(/\//g, '-')), req.query.download === '1');
}));

// ====================================================================
// RECIBOS
// ====================================================================
const needFin = (u) => { if (!P.canFinance(u)) throw new HttpError(403, 'Sem acesso ao financeiro.'); };
const RECEIPT_FIELDS = ['client_id', 'project_id', 'contract_id', 'income_id', 'payer_name', 'payer_doc', 'amount', 'reference_prep', 'description', 'installment_label', 'payment_method',
  'paid_at', 'city', 'issue_date', 'receiver_user_id', 'receiver_name', 'receiver_doc', 'receiver_address', 'receiver_phone', 'two_copies', 'manual_confirmed', 'notes', 'number'];
function loadReceipt(u, id) {
  needFin(u);
  const r = get(`${R.receipts.select} WHERE rc.id = ?`, id);
  if (!r) throw new HttpError(404, 'Recibo não encontrado.');
  return r;
}
function receiptOut(r) {
  const inc = r.income_id ? get('SELECT id, description, amount, due_date, paid_at, status, method, installment_no, installment_total FROM incomes WHERE id = ?', r.income_id) : null;
  const others = r.income_id ? all("SELECT id, number FROM receipts WHERE income_id = ? AND status = 'emitido' AND id <> ?", r.income_id, r.id) : [];
  return { ...r, snapshot: undefined, income: inc, other_receipts: others };
}
function readReceipt(b) {
  const d = {};
  for (const k of RECEIPT_FIELDS) {
    if (!(k in b)) continue;
    const v = b[k];
    if (['client_id', 'project_id', 'contract_id', 'income_id', 'receiver_user_id'].includes(k)) d[k] = v ? Number(v) : null;
    else if (k === 'amount') d[k] = round2(num(v) || 0);
    else if (['paid_at', 'issue_date'].includes(k)) d[k] = dateOrNull(v);
    else if (['two_copies', 'manual_confirmed'].includes(k)) d[k] = v === true || v === 1 || v === '1' ? 1 : 0;
    else if (k === 'reference_prep') d[k] = C.REFERENCE_PREP.some((x) => x.value === v) ? v : 'ao';
    else d[k] = str(v, 2000);
  }
  // vínculos coerentes: projeto e contrato precisam ser do mesmo cliente
  if (d.project_id) { const p = get('SELECT client_id FROM projects WHERE id = ?', d.project_id); if (p && d.client_id && p.client_id !== d.client_id) throw new HttpError(400, 'O projeto selecionado não pertence a este cliente.'); }
  if (d.contract_id) { const c = get('SELECT client_id FROM contracts WHERE id = ?', d.contract_id); if (c && d.client_id && c.client_id !== d.client_id) throw new HttpError(400, 'O contrato selecionado não pertence a este cliente.'); }
  if (d.income_id) { const i = get('SELECT client_id FROM incomes WHERE id = ?', d.income_id); if (i && d.client_id && i.client_id && i.client_id !== d.client_id) throw new HttpError(400, 'O pagamento selecionado não pertence a este cliente.'); }
  return d;
}
// Dados que vêm do pagamento selecionado (somente preenchimento; não confirma recebimento)
function fromIncome(incomeId) {
  const i = get(`SELECT i.*, p.name project_name, p.code project_code, ct.number contract_number, c.name client_name, c.doc client_doc FROM incomes i LEFT JOIN projects p ON p.id = i.project_id
    LEFT JOIN contracts ct ON ct.id = i.contract_id LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ?`, incomeId);
  if (!i) throw new HttpError(404, 'Pagamento não encontrado.');
  const parcel = i.installment_total > 1 ? `parcela ${i.installment_no}/${i.installment_total}` : '';
  const desc = String(i.description || '').replace(/\s*\(\d+\/\d+\)\s*$/, '');
  return { client_id: i.client_id, project_id: i.project_id, contract_id: i.contract_id, income_id: i.id, amount: i.amount, description: desc, installment_label: parcel,
    payment_method: i.method || null, paid_at: i.status === 'recebido' ? i.paid_at : null, payer_name: i.client_name || null, payer_doc: i.client_doc || null };
}
router.get('/receipts/options', wrap((req, res) => {
  needFin(req.user);
  const cid = Number(req.query.client_id) || null;
  const out = { projects: [], contracts: [], incomes: [] };
  if (cid) {
    out.projects = all('SELECT id, name, code FROM projects WHERE client_id = ? ORDER BY archived, name', cid);
    out.contracts = all("SELECT id, number, project_id, amount, status FROM contracts WHERE client_id = ? AND status <> 'cancelado' ORDER BY id DESC", cid);
    out.incomes = all(`SELECT i.id, i.description, i.amount, i.due_date, i.paid_at, i.status, i.method, i.installment_no, i.installment_total, i.project_id, i.contract_id,
      (SELECT GROUP_CONCAT(number, ', ') FROM receipts r WHERE r.income_id = i.id AND r.status = 'emitido') receipts
      FROM incomes i WHERE i.client_id = ? AND i.status <> 'cancelado' ORDER BY i.status = 'recebido' DESC, COALESCE(i.paid_at, i.due_date) DESC LIMIT 300`, cid);
  }
  const o = docs.office();
  res.json({ ...out, office: { name: o.contractor_name || o.name, doc: o.contractor_doc || o.doc, address: o.contractor_address || o.address, phone: o.phone, city: o.city } });
}));
router.get('/receipts/:id', wrap((req, res) => res.json(receiptOut(loadReceipt(req.user, Number(req.params.id))))));
router.post('/receipts', wrap((req, res) => {
  needFin(req.user);
  const b = req.body || {};
  const o = docs.office();
  const base = { reference_prep: 'ao', city: o.city, issue_date: today(), receiver_name: o.contractor_name || o.name, receiver_doc: o.contractor_doc || o.doc || null, receiver_address: o.contractor_address || o.address || null, receiver_phone: null };
  const auto = b.income_id ? fromIncome(Number(b.income_id)) : {};
  const d = readReceipt({ ...base, ...auto, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== '' && v !== null && v !== undefined)) });
  if (!d.client_id && !d.payer_name) throw new HttpError(400, 'Selecione o cliente ou informe quem pagou.');
  if (!d.payer_name && d.client_id) { const c = get('SELECT name, doc FROM clients WHERE id = ?', d.client_id); if (c) { d.payer_name = c.name; d.payer_doc = d.payer_doc || c.doc; } }
  d.status = 'rascunho'; d.created_by = req.user.id; d.created_at = nowIso(); d.updated_at = nowIso();
  const id = insert('receipts', d);
  audit(req, 'create', 'receipts', id, `Recibo (rascunho) criado — ${d.payer_name || ''} ${docs.brl(d.amount)}`);
  res.status(201).json(receiptOut(loadReceipt(req.user, id)));
}));
router.put('/receipts/:id', wrap((req, res) => {
  const r = loadReceipt(req.user, Number(req.params.id));
  if (r.status !== 'rascunho') throw new HttpError(400, 'Recibo emitido não pode ser alterado. Cancele e emita um novo, se necessário.');
  const b = req.body || {};
  let d = readReceipt({ client_id: r.client_id, ...b });
  if (b.fill_from_income && d.income_id) d = { ...d, ...readReceipt(fromIncome(d.income_id)) };
  d.updated_at = nowIso();
  update('receipts', r.id, d);
  res.json(receiptOut(loadReceipt(req.user, r.id)));
}));
function receiptProblems(r) {
  const list = [];
  if (!(r.amount > 0)) list.push('Informe o valor recebido.');
  if (!r.payer_name) list.push('Informe quem pagou.');
  if (!r.description) list.push('Informe a descrição / referência do pagamento.');
  if (!r.paid_at) list.push('Informe a data efetiva do pagamento.');
  if (!r.payment_method) list.push('Selecione a forma de pagamento.');
  if (!r.receiver_name) list.push('Informe o responsável pelo recebimento (prestador do serviço).');
  if (!r.city) list.push('Informe a cidade de emissão.');
  if (r.income_id) {
    const i = get('SELECT status, amount, paid_at FROM incomes WHERE id = ?', r.income_id);
    if (!i || i.status !== 'recebido') list.push('O pagamento selecionado ainda não consta como recebido no financeiro. Registre o recebimento antes de emitir o recibo.');
    else if (Math.abs(i.amount - r.amount) > 0.009) list.push(`O valor do recibo (${docs.brl(r.amount)}) é diferente do valor recebido no financeiro (${docs.brl(i.amount)}).`);
  } else if (!r.manual_confirmed) list.push('Recibo sem pagamento vinculado: confirme que o valor foi efetivamente recebido.');
  return list;
}
function nextReceiptNumber() {
  const y = today().slice(0, 4);
  const nums = all('SELECT number FROM receipts WHERE number IS NOT NULL').map((x) => String(x.number).match(new RegExp(`^(\\d+)/${y}$`))).filter(Boolean).map((m) => parseInt(m[1], 10));
  let n = (nums.length ? Math.max(...nums) : 0) + 1;
  while (get('SELECT 1 FROM receipts WHERE number = ?', `${String(n).padStart(3, '0')}/${y}`)) n++;
  return `${String(n).padStart(3, '0')}/${y}`;
}
// Registra no financeiro o recebimento confirmado pelo usuário (a mesma baixa do módulo Financeiro)
router.post('/receipts/:id/register-payment', wrap((req, res) => {
  const r = loadReceipt(req.user, Number(req.params.id));
  if (!r.income_id) throw new HttpError(400, 'Selecione a parcela antes.');
  const i = get('SELECT * FROM incomes WHERE id = ?', r.income_id);
  if (i.status === 'recebido') return res.json(receiptOut(r));
  const b = req.body || {};
  const paidAt = dateOrNull(b.paid_at) || today(); const method = str(b.method, 40) || i.method;
  run('UPDATE incomes SET status = ?, paid_at = ?, method = ?, updated_at = ? WHERE id = ?', 'recebido', paidAt, method, nowIso(), i.id);
  run('UPDATE receipts SET paid_at = ?, payment_method = COALESCE(?, payment_method), amount = ?, updated_at = ? WHERE id = ?', paidAt, method, i.amount, nowIso(), r.id);
  audit(req, 'pay', 'incomes', i.id, `Recebimento registrado pelo recibo: ${i.description} — ${docs.brl(i.amount)}`);
  res.json(receiptOut(loadReceipt(req.user, r.id)));
}));
router.get('/receipts/:id/check', wrap((req, res) => { const r = loadReceipt(req.user, Number(req.params.id)); const l = receiptProblems(r); res.json({ ok: !l.length, problems: l }); }));
router.post('/receipts/:id/emit', wrap((req, res) => {
  const r = loadReceipt(req.user, Number(req.params.id));
  if (r.status !== 'rascunho') throw new HttpError(400, 'Este recibo já foi emitido.');
  const list = receiptProblems(r);
  if (list.length) return problemsResponse(res, list);
  const dup = r.income_id ? get("SELECT number FROM receipts WHERE income_id = ? AND status = 'emitido' AND id <> ?", r.income_id, r.id) : null;
  if (dup && !req.body.force) return res.status(409).json({ error: `Já existe o recibo ${dup.number} emitido para este pagamento.`, duplicate: dup.number });
  const number = r.number || nextReceiptNumber();
  if (get('SELECT 1 FROM receipts WHERE number = ? AND id <> ?', number, r.id)) throw new HttpError(400, `Já existe um recibo com o número ${number}.`);
  const o = docs.office();
  const snapshot = { ...r, number, office: { name: o.name, tagline: o.tagline }, issued_at: nowIso() };
  update('receipts', r.id, { number, status: 'emitido', issued_at: snapshot.issued_at, issued_by: req.user.id, snapshot: JSON.stringify(snapshot), issue_date: r.issue_date || today() });
  if (r.client_id) run('INSERT INTO client_interactions(client_id, project_id, date, type, description, user_id) VALUES (?,?,?,?,?,?)', r.client_id, r.project_id, today(), 'outro', `Recibo ${number} emitido — ${docs.brl(r.amount)}`, req.user.id);
  audit(req, 'generate', 'receipts', r.id, `Recibo ${number} emitido — ${r.payer_name} ${docs.brl(r.amount)}`);
  res.json(receiptOut(loadReceipt(req.user, r.id)));
}));
router.post('/receipts/:id/cancel', wrap((req, res) => {
  const r = loadReceipt(req.user, Number(req.params.id));
  if (r.status !== 'emitido') throw new HttpError(400, 'Somente recibos emitidos podem ser cancelados.');
  update('receipts', r.id, { status: 'cancelado', notes: [r.notes, `Cancelado em ${docs.brDate(today())}${req.body.reason ? ': ' + String(req.body.reason).slice(0, 300) : ''}`].filter(Boolean).join('\n'), updated_at: nowIso() });
  audit(req, 'update', 'receipts', r.id, `Recibo ${r.number} cancelado`);
  res.json(receiptOut(loadReceipt(req.user, r.id)));
}));
function receiptDoc(r, { draft, cancelled }) {
  const s = r.status === 'rascunho' ? r : { ...r, ...(J(r.snapshot, {}) || {}), status: r.status };
  const prep = s.reference_prep || 'ao';
  const docTxt = s.payer_doc ? `, inscrito(a) sob ${docs.docType(s.payer_doc)} ${s.payer_doc}` : '';
  const ref = [s.description, s.installment_label].filter(Boolean).join(' — ');
  const proj = s.project_name ? `, do projeto ${s.project_name}${s.project_code ? ` (código ${s.project_code})` : ''}` : '';
  const via = (n) => [
    n ? { text: n, style: 'muted', alignment: 'right', margin: [0, -6, 0, 6] } : '',
    pdf.para(`Recebi(emos) de **${s.payer_name || '[pagador]'}**${docTxt}, a importância de **${docs.brl(s.amount)}** (${docs.extenso(s.amount)}), referente ${prep} ${ref || '[descrição]'}${proj}.`, true),
    pdf.para(`Forma de pagamento: **${L('PAYMENT_METHODS', s.payment_method) || '[forma de pagamento]'}**. Data do pagamento: **${docs.brDate(s.paid_at) || '[data]'}**.`),
    pdf.para('Para maior clareza, firmo(amos) o presente recibo, dando plena e geral quitação do valor acima.'),
    { text: `${s.city || '[cidade]'}, ${docs.longDate(s.issue_date || today())}.`, alignment: 'right', style: 'p', margin: [0, 16, 0, 0] },
    pdf.signatures({ signers: [{ name: s.receiver_name || '[responsável]', role: 'RECEBEDOR', doc: s.receiver_doc ? `${docs.docType(s.receiver_doc)} ${s.receiver_doc}` : '', extra: [s.receiver_address, s.receiver_phone].filter(Boolean).join(' · ') }] }),
  ].filter(Boolean);
  const ident = [['Recibo nº', s.number || 'Rascunho'], ['Valor', docs.brl(s.amount)], ['Data do pagamento', docs.brDate(s.paid_at)], ['Pagador', s.payer_name, 2], ['Forma de pagamento', L('PAYMENT_METHODS', s.payment_method)],
    ['Projeto', s.project_name, 2], ['Código do projeto', s.project_code], ['Contrato', s.contract_number]];
  const content = s.two_copies ? [...via('1ª via'), { text: '', pageBreak: 'after' }, { text: 'Recibo de prestação de serviço', style: 'title' }, pdf.identGrid(ident), ...via('2ª via')] : via('');
  if (cancelled) content.unshift({ text: 'RECIBO CANCELADO', color: '#b0473b', bold: true, alignment: 'center', margin: [0, 0, 0, 8] });
  return pdf.build({ title: 'Recibo de prestação de serviço', draft: draft || cancelled, issuedAt: s.issued_at || today(),
    purpose: 'Comprovante de recebimento de valor referente a serviços prestados pelo escritório.', ident, content, info: { title: `Recibo ${s.number || ''}` } });
}
router.get('/pdf/receipt/:id', wrap(async (req, res) => {
  const r = loadReceipt(req.user, Number(req.params.id));
  if (req.query.check === '1') { const l = r.status === 'rascunho' ? [] : []; return res.json({ ok: !l.length, problems: l }); }
  await pdf.send(res, receiptDoc(r, { draft: r.status === 'rascunho', cancelled: r.status === 'cancelado' }), fileName(`Recibo ${(r.number || 'rascunho').replace('/', '-')}`, r.payer_name), req.query.download === '1');
}));

// ====================================================================
// PLACA DE OBRA
// ====================================================================
const needSign = (u) => { if (!P.hasModule(u, 'placas')) throw new HttpError(403, 'Sem acesso às placas de obra.'); };
function signRow(u, id) { needSign(u); const s = get(`${R.site_signs.select} WHERE sg.id = ?`, id); if (!s) throw new HttpError(404, 'Placa não encontrada.'); return s; }
function photoFor(s, inlineData) {
  if (!s.photo_doc_id) return null;
  const d = get('SELECT * FROM documents WHERE id = ?', s.photo_doc_id); if (!d || !d.file_path) return null;
  const full = path.join(UPLOAD_DIR, d.file_path); if (!full.startsWith(UPLOAD_DIR) || !fs.existsSync(full)) return null;
  const buf = fs.readFileSync(full); const sz = sign.imageSize(buf); if (!sz) return null;
  return { ...sz, doc: d, href: inlineData ? `data:${sz.mime};base64,${buf.toString('base64')}` : `/api/files/${d.id}?inline=1` };
}
function signOut(s) {
  const data = J(s.data, {}) || {};
  const img = photoFor(s, false);
  const r = sign.buildSvg({ ...s, data }, { img, preview: true });
  return { ...s, data, photo: img ? { id: img.doc.id, w: img.w, h: img.h, name: img.doc.file_name } : null, svg: r.svg, dims: { w: r.w, h: r.h }, ppi: r.ppi, low_res: r.lowRes, min_ppi: r.minPpi,
    qr: { url: sign.INSTAGRAM_URL, handle: sign.INSTAGRAM_HANDLE } };
}
// Nome exibido na placa: o definido em Configurações ou, se vazio, primeiro e último nome do contratado
// (ex.: Irineu Garcia Martins Junior → Irineu Junior). O cadastro mantém o nome completo.
function signName(o) {
  const set = getSetting('sign_display_name', '');
  if (set) return set;
  const p = String(o.contractor_name || '').trim().split(/\s+/).filter(Boolean);
  return p.length > 2 ? `${p[0]} ${p[p.length - 1]}` : p.join(' ');
}
function signDefaults(projectId, clientId) {
  const o = docs.office();
  const p = projectId ? get('SELECT * FROM projects WHERE id = ?', projectId) : null;
  const w = projectId ? get('SELECT address FROM works WHERE project_id = ? ORDER BY id DESC', projectId) : null;
  const reg = String(o.contractor_registry || '').match(/CAU(?:\s*\/?\s*BR)?\s*(?:n\s*[º°o.]\s*)?[:\-–]?\s*([A-Z]?\d[\d.\-]*)/i);
  const svc = p && p.type ? (/interior/i.test(p.type) ? 'Projeto de interiores' : /arquitet/i.test(p.type) ? 'Projeto arquitetônico' : p.type) : '';
  return {
    service_line: svc, obra_nome: p ? p.name : '', endereco: (w && w.address) || (p ? [p.address, p.city].filter(Boolean).join(' – ') : ''),
    people: [{ nome: signName(o), funcao: 'Responsável Técnico - Projeto', registro_label: 'CAU', registro: reg ? reg[1] : '', rrt_label: 'RRT', rrt: '' }],
    extra_fields: [], contato_label: 'Contato', contato: '(67) 98207-7556',
    handles: [{ handle: '@carlanogueirabarbosa', desc: 'Carla Nogueira | Designer de Interiores' }, { handle: '@irineujuniorarquiteto', desc: 'Irineu Junior | Arquiteto' }, { handle: '@carlaeirineuarquitetura', desc: 'Perfil empresa' }],
    client_id: clientId || (p && p.client_id) || null,
  };
}
function readSign(b) {
  const d = {};
  if ('title' in b) d.title = str(b.title, 200) || 'Placa de obra';
  if ('client_id' in b) d.client_id = b.client_id ? Number(b.client_id) : null;
  if ('project_id' in b) d.project_id = b.project_id ? Number(b.project_id) : null;
  if ('size' in b) { if (!sign.SIZES[b.size]) throw new HttpError(400, 'Tamanho inválido.'); d.size = b.size; }
  if ('orientation' in b) d.orientation = b.orientation === 'retrato' ? 'retrato' : 'paisagem';
  if ('theme' in b) d.theme = b.theme === 'claro' ? 'claro' : 'escuro';
  if ('photo_doc_id' in b) d.photo_doc_id = b.photo_doc_id ? Number(b.photo_doc_id) : null;
  for (const k of ['photo_x', 'photo_y']) if (k in b) d[k] = Math.max(0, Math.min(100, num(b[k]) ?? 50));
  if ('photo_zoom' in b) d.photo_zoom = Math.max(1, Math.min(4, num(b.photo_zoom) ?? 1));
  if ('data' in b) {
    const x = b.data || {};
    const clean = (v, m = 300) => (v === undefined || v === null ? '' : String(v).slice(0, m));
    d.data = JSON.stringify({
      service_line: clean(x.service_line), obra_nome: clean(x.obra_nome), endereco: clean(x.endereco, 400), contato_label: clean(x.contato_label, 40) || 'Contato', contato: clean(x.contato, 120),
      people: (x.people || []).slice(0, 4).map((p) => ({ nome: clean(p.nome), funcao: clean(p.funcao), registro_label: clean(p.registro_label, 20), registro: clean(p.registro, 60), rrt_label: clean(p.rrt_label, 20), rrt: clean(p.rrt, 60) })),
      extra_fields: (x.extra_fields || []).slice(0, 4).map((f) => ({ label: clean(f.label, 40), value: clean(f.value, 200) })),
      handles: (x.handles || []).slice(0, 4).map((h) => ({ handle: clean(h.handle, 60), desc: clean(h.desc, 80) })),
    });
  }
  if (d.project_id && d.client_id) { const p = get('SELECT client_id FROM projects WHERE id = ?', d.project_id); if (p && p.client_id !== d.client_id) throw new HttpError(400, 'O projeto selecionado não pertence a este cliente.'); }
  return d;
}
router.get('/signs/defaults', wrap((req, res) => { needSign(req.user); res.json(signDefaults(Number(req.query.project_id) || null, Number(req.query.client_id) || null)); }));
router.get('/signs/:id', wrap((req, res) => res.json(signOut(signRow(req.user, Number(req.params.id))))));
router.post('/signs', wrap((req, res) => {
  needSign(req.user);
  const b = req.body || {};
  const def = signDefaults(b.project_id ? Number(b.project_id) : null, b.client_id ? Number(b.client_id) : null);
  const p = b.project_id ? get('SELECT name, client_id FROM projects WHERE id = ?', b.project_id) : null;
  const d = readSign({ title: b.title || (p ? `Placa — ${p.name}` : 'Placa de obra'), client_id: b.client_id || def.client_id, project_id: b.project_id || null, size: b.size || '150x100', orientation: b.orientation || 'paisagem', theme: b.theme || 'escuro', data: b.data || def });
  d.created_by = req.user.id; d.created_at = nowIso(); d.updated_at = nowIso();
  const id = insert('site_signs', d);
  audit(req, 'create', 'site_signs', id, `Placa de obra criada: ${d.title}`);
  res.status(201).json(signOut(signRow(req.user, id)));
}));
router.put('/signs/:id', wrap((req, res) => {
  const s = signRow(req.user, Number(req.params.id));
  const d = readSign({ client_id: s.client_id, ...req.body }); d.updated_at = nowIso();
  update('site_signs', s.id, d);
  res.json(signOut(signRow(req.user, s.id)));
}));
router.post('/signs/:id/preview', wrap((req, res) => {
  // prévia com valores ainda não salvos (nada é gravado)
  const s = signRow(req.user, Number(req.params.id));
  const d = readSign({ client_id: s.client_id, ...req.body });
  const merged = { ...s, ...d, data: d.data ? JSON.parse(d.data) : J(s.data, {}) };
  const img = photoFor(merged, false);
  const r = sign.buildSvg(merged, { img, preview: true });
  res.json({ svg: r.svg, ppi: r.ppi, low_res: r.lowRes, min_ppi: r.minPpi, dims: { w: r.w, h: r.h } });
}));
router.get('/pdf/sign/:id', wrap(async (req, res) => {
  const s = signRow(req.user, Number(req.params.id));
  const data = J(s.data, {}) || {};
  if (req.query.check === '1') return res.json({ ok: true, problems: [] });
  const img = photoFor(s, true);
  const r = sign.buildSvg({ ...s, data }, { img });
  const D = sign.dims(s.size, s.orientation);
  await pdf.send(res, pdf.signDoc(r.svg, r.w, r.h, s.title), fileName(s.title, `${D.label}${D.series ? ' ' + s.orientation : ''}`), req.query.download === '1');
}));

// ====================================================================
// COMPARATIVO DE ORÇAMENTOS DE FORNECEDORES
// ====================================================================
const NI = 'Não informado';
function compare(u, projectId, ids) {
  const p = fetchOne(R.projects, u, projectId);
  if (!R.quotes.read(u)) throw new HttpError(403, 'Sem permissão.');
  const list = ids.length ? all(`SELECT q.*, s.company supplier_name, s.category supplier_category FROM quotes q LEFT JOIN suppliers s ON s.id = q.supplier_id WHERE q.project_id = ? AND q.id IN (${ids.map(() => '?').join(',')}) ORDER BY q.item, q.amount`, p.id, ...ids) : [];
  const norm = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  const inc = list.map((q) => docs.lines(q.included));
  const allItems = []; const seen = new Set();
  inc.flat().forEach((i) => { const k = norm(i); if (!seen.has(k)) { seen.add(k); allItems.push({ key: k, text: i }); } });
  const quotes = list.map((q, i) => {
    const mine = new Set(inc[i].map(norm));
    return {
      id: q.id, supplier: q.supplier_name || NI, category: q.item || NI, amount: q.amount > 0 ? q.amount : null, status: q.status, deadline: q.deadline_days ? `${q.deadline_days} dias` : null,
      payment_terms: q.payment_terms || null, included: inc[i], excluded: docs.lines(q.excluded), notes: q.client_notes || q.notes || null, valid_until: q.valid_until, received_at: q.received_at,
      missing: allItems.filter((it) => !mine.has(it.key)).map((it) => it.text), scope_informed: inc[i].length > 0,
    };
  });
  const cats = [...new Set(quotes.map((q) => q.category))];
  const withAmount = quotes.filter((q) => q.amount);
  const warnings = [];
  if (cats.length > 1) warnings.push(`Os orçamentos selecionados são de serviços diferentes (${cats.join(', ')}). Os valores não são equivalentes.`);
  if (quotes.some((q) => q.missing.length)) warnings.push('Há diferenças de escopo: alguns fornecedores não incluem itens que outros incluem. Compare os itens antes de comparar os valores.');
  if (quotes.some((q) => !q.scope_informed)) warnings.push('Nem todos os orçamentos têm os itens incluídos cadastrados.');
  return { project: { id: p.id, name: p.name, code: p.code, client_name: p.client_name }, quotes, items: allItems.map((i) => i.text), warnings, min: withAmount.length > 1 && cats.length === 1 ? Math.min(...withAmount.map((q) => q.amount)) : null };
}
router.get('/projects/:id/quotes-compare', wrap((req, res) => res.json(compare(req.user, Number(req.params.id), String(req.query.ids || '').split(',').map(Number).filter(Boolean)))));
router.get('/pdf/quotes-compare/:projectId', wrap(async (req, res) => {
  const c = compare(req.user, Number(req.params.projectId), String(req.query.ids || '').split(',').map(Number).filter(Boolean));
  const list = c.quotes.length < 2 ? ['Selecione ao menos dois orçamentos para comparar.'] : [];
  if (req.query.check === '1') return res.json({ ok: !list.length, problems: list });
  if (list.length) return problemsResponse(res, list);
  const cell = (v) => (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) ? { text: NI, color: '#a39d96', italics: true } : Array.isArray(v) ? { ul: v, fontSize: 8 } : String(v));
  const rows = [
    ['Categoria / serviço', ...c.quotes.map((q) => cell(q.category))],
    ['Valor', ...c.quotes.map((q) => (q.amount ? { text: docs.brl(q.amount) + (q.amount === c.min && c.quotes.length > 1 ? '  (menor)' : ''), bold: true } : cell(null)))],
    ['Prazo de execução', ...c.quotes.map((q) => cell(q.deadline))],
    ['Condições de pagamento', ...c.quotes.map((q) => cell(q.payment_terms))],
    ['Itens incluídos', ...c.quotes.map((q) => cell(q.included))],
    ['Não incluídos', ...c.quotes.map((q) => cell(q.excluded))],
    ['Itens que outros incluem e este não', ...c.quotes.map((q) => (q.missing.length ? { ul: q.missing, fontSize: 8, color: '#a97a26' } : q.scope_informed ? '—' : cell(null)))],
    ['Observações', ...c.quotes.map((q) => cell(q.notes))],
  ];
  const content = [
    ...c.warnings.map((w) => ({ text: `Atenção: ${w}`, color: '#a97a26', fontSize: 8.8, margin: [0, 0, 0, 5] })),
    pdf.dataTable({ headers: ['', ...c.quotes.map((q) => q.supplier)], rows: rows.map((r) => [{ text: r[0], bold: true, fontSize: 8 }, ...r.slice(1)]), widths: [110, ...c.quotes.map(() => '*')], fontSize: 8.4 }),
  ];
  const doc = pdf.build({ landscape: true, title: 'Comparativo de orçamentos', purpose: 'Comparação lado a lado das propostas de fornecedores, com itens incluídos e não incluídos, para que valores de escopos diferentes não pareçam equivalentes.',
    ident: [['Cliente', c.project.client_name, 2], ['Data', docs.brDate(today())], ['Projeto', c.project.name, 2], ['Código', c.project.code]], content });
  await pdf.send(res, doc, fileName('Comparativo de orcamentos', c.project.name), req.query.download === '1');
}));

// ====================================================================
// AVISO DE ATUALIZAÇÃO DO PORTAL (texto para copiar)
// ====================================================================
router.get('/projects/:id/portal-updates', wrap((req, res) => {
  const p = fetchOne(R.projects, req.user, Number(req.params.id));
  if (!P.isManager(req.user) && !P.canAccessProject(req.user, p.id)) throw new HttpError(403, 'Sem permissão.');
  const last = get('SELECT n.created_at, u.name user_name FROM portal_notices n LEFT JOIN users u ON u.id = n.created_by WHERE n.project_id = ? ORDER BY n.id DESC', p.id);
  const since = dateOrNull(req.query.since) || (last ? last.created_at.slice(0, 10) : addDays(today(), -15));
  const client = p.client_id ? get('SELECT id, name, whatsapp, phone FROM clients WHERE id = ?', p.client_id) : null;
  const items = [];
  // somente conteúdo liberado ao cliente (nada de notas internas)
  all("SELECT id, title, category, mime, created_at FROM documents WHERE project_id = ? AND client_visible = 1 AND archived = 0 AND substr(created_at,1,10) >= ? ORDER BY created_at DESC", p.id, since)
    .forEach((d) => items.push({ key: `doc_${d.id}`, kind: (d.mime || '').startsWith('image/') ? 'imagem' : /projeto|revis/i.test(d.category || '') ? 'revisao' : 'arquivo', label: d.title, date: d.created_at.slice(0, 10) }));
  all("SELECT wl.id, wl.date FROM work_logs wl JOIN works w ON w.id = wl.work_id WHERE w.project_id = ? AND wl.client_visible = 1 AND wl.date >= ? ORDER BY wl.date DESC", p.id, since)
    .forEach((l) => items.push({ key: `log_${l.id}`, kind: 'obra', label: `Atualização da obra de ${docs.brDate(l.date)}`, date: l.date }));
  all("SELECT item, COUNT(*) n, MAX(COALESCE(received_at, substr(created_at,1,10))) d FROM quotes WHERE project_id = ? AND client_visible = 1 AND client_selected = 0 AND status IN ('recebido','negociacao') AND COALESCE(received_at, substr(created_at,1,10)) >= ? GROUP BY item", p.id, since)
    .forEach((q) => items.push({ key: `quote_${q.item}`, kind: 'orcamento', label: `${q.item} (${q.n} ${q.n > 1 ? 'opções' : 'opção'})`, date: q.d }));
  all("SELECT id, name, completed_at FROM project_phases WHERE project_id = ? AND client_visible = 1 AND completed_at IS NOT NULL AND completed_at >= ? ORDER BY completed_at DESC", p.id, since)
    .forEach((ph) => items.push({ key: `phase_${ph.id}`, kind: 'etapa', label: ph.name, date: ph.completed_at }));
  all("SELECT id, date, title FROM meeting_minutes WHERE project_id = ? AND client_visible = 1 AND archived = 0 AND date >= ? ORDER BY date DESC", p.id, since)
    .forEach((a) => items.push({ key: `ata_${a.id}`, kind: 'ata', label: `${a.title || 'Reunião'} (${docs.brDate(a.date)})`, date: a.date }));
  const o = docs.office();
  const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  res.json({ project: { id: p.id, name: p.name }, client, since, last_notice: last, items, portal_url: base + '/', office: { name: o.name, tagline: o.tagline }, has_portal_user: client ? !!get("SELECT 1 FROM users WHERE role = 'cliente' AND client_id = ? AND active = 1", client.id) : false });
}));
router.post('/projects/:id/portal-notice', wrap((req, res) => {
  const p = fetchOne(R.projects, req.user, Number(req.params.id));
  const msg = String(req.body.message || '').trim(); if (!msg) throw new HttpError(400, 'Mensagem vazia.');
  insert('portal_notices', { project_id: p.id, message: msg.slice(0, 5000), items: JSON.stringify(req.body.items || []), created_by: req.user.id, created_at: nowIso() });
  if (p.client_id) run('INSERT INTO client_interactions(client_id, project_id, date, type, description, user_id) VALUES (?,?,?,?,?,?)', p.client_id, p.id, today(), 'whatsapp', 'Aviso de atualização do portal preparado para envio pelo WhatsApp', req.user.id);
  res.json({ ok: true });
}));

module.exports = { router, receiptDoc, minutesDoc };
