// Rotas da separação financeira: Caixa do escritório × Financeiro das obras,
// registro/estorno de pagamentos com histórico, conferência de pagamentos
// informados pelos clientes e revisão dos lançamentos antigos.
const express = require('express');
const { get } = require('../db');
const { wrap, HttpError, audit } = require('../util');
const P = require('../permissions');
const { R } = require('../resources');
const { fetchOne } = require('../crud');
const M = require('../services/money');
const automation = require('../services/automation');

const router = express.Router();
const finOnly = (req) => { if (!P.canFinance(req.user)) throw new HttpError(403, 'Sem acesso ao financeiro.'); };
const T = (t) => (t === 'expenses' ? 'expenses' : t === 'incomes' ? 'incomes' : null);

// ------------------------------ CAIXA DO ESCRITÓRIO ------------------------------
router.get('/finance/cash', wrap((req, res) => {
  finOnly(req); automation.runAutomations();
  res.json({ ...M.cashMovements(req.query || {}), informed: M.informedQueue().length });
}));

// ------------------------------ FINANCEIRO DAS OBRAS ------------------------------
router.get('/finance/works', wrap((req, res) => { finOnly(req); res.json(M.worksList()); }));
router.get('/finance/works/:id', wrap((req, res) => {
  finOnly(req); automation.runAutomations();
  const p = fetchOne(R.projects, req.user, Number(req.params.id));
  res.json(M.worksFinance(p.id));
}));
router.post('/finance/works/:id/items', wrap((req, res) => {
  finOnly(req);
  const p = fetchOne(R.projects, req.user, Number(req.params.id));
  const ids = M.createObraItems(req.user, { ...(req.body || {}), project_id: p.id });
  audit(req, 'create', 'expenses', ids[0], `Item da obra lançado em ${ids.length} parcela(s) — ${p.name}`);
  res.status(201).json({ ids });
}));

// ------------------------------ PAGAMENTOS ------------------------------
router.post('/finance/:table/:id/pay', wrap((req, res) => {
  finOnly(req); const table = T(req.params.table); if (!table) throw new HttpError(400, 'Tabela inválida.');
  const row = fetchOne(R[table], req.user, Number(req.params.id));
  const r = M.registerPayment(req.user, table, row.id, req.body || {});
  audit(req, 'pay', table, row.id, `${table === 'incomes' ? 'Recebimento' : 'Pagamento'} registrado: ${row.description}`);
  res.json({ ...fetchOne(R[table], req.user, row.id), rest_id: r.rest_id });
}));
router.post('/finance/:table/:id/unpay', wrap((req, res) => {
  finOnly(req); const table = T(req.params.table); if (!table) throw new HttpError(400, 'Tabela inválida.');
  const row = fetchOne(R[table], req.user, Number(req.params.id));
  M.reversePayment(req.user, table, row.id, (req.body || {}).reason);
  audit(req, 'unpay', table, row.id, `Registro de pagamento estornado: ${row.description}`);
  res.json(fetchOne(R[table], req.user, row.id));
}));
router.post('/finance/:table/:id/reject-informed', wrap((req, res) => {
  finOnly(req); const table = T(req.params.table); if (!table) throw new HttpError(400, 'Tabela inválida.');
  const row = fetchOne(R[table], req.user, Number(req.params.id));
  M.rejectInformed(req.user, table, row.id, (req.body || {}).reason);
  res.json({ ok: true });
}));
router.get('/finance/:table/:id/history', wrap((req, res) => {
  finOnly(req); const table = T(req.params.table); if (!table) throw new HttpError(400, 'Tabela inválida.');
  const row = fetchOne(R[table], req.user, Number(req.params.id));
  res.json(M.history(table, row.id));
}));
router.get('/finance/informed', wrap((req, res) => { finOnly(req); res.json(M.informedQueue()); }));

// ------------------------------ CONFERÊNCIA DOS LANÇAMENTOS ANTIGOS ------------------------------
router.get('/finance/review', wrap((req, res) => { finOnly(req); res.json(M.reviewCandidates()); }));
router.post('/finance/review/apply', wrap((req, res) => {
  finOnly(req);
  if (!P.isManager(req.user)) throw new HttpError(403, 'Somente gestores podem reclassificar lançamentos.');
  const decisions = (req.body || {}).decisions || [];
  if (!decisions.length) throw new HttpError(400, 'Nenhuma decisão enviada.');
  // cópia de segurança completa do banco ANTES de qualquer alteração
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const file = automation.backupNow(`antes-reclassificacao-${stamp}`);
  const done = M.applyReview(req.user, decisions, require('path').basename(file));
  audit(req, 'reclassify', 'expenses', null, `${done.length} lançamento(s) conferido(s)/reclassificado(s) — backup ${require('path').basename(file)}`);
  res.json({ done, backup: require('path').basename(file) });
}));

module.exports = { router };
