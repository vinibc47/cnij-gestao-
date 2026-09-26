// Metadados, dashboard, pesquisa global e notificações
const express = require('express');
const { all, get, run, val, getSetting } = require('../db');
const { wrap, today, addDays, monthStart, monthEnd, round2, nowIso } = require('../util');
const C = require('../constants');
const P = require('../permissions');
const { R, metaFor } = require('../resources');
const finance = require('../services/finance');
const automation = require('../services/automation');
const { publicUser } = require('../auth');

const router = express.Router();

router.get('/meta', wrap((req, res) => {
  const opts = {};
  for (const o of all('SELECT kind, name FROM options WHERE archived = 0 ORDER BY kind, position, name')) (opts[o.kind] = opts[o.kind] || []).push(o.name);
  const lists = {};
  for (const [k, v] of Object.entries(C)) if (Array.isArray(v) && v[0] && v[0].value) lists[k] = v;
  res.json({
    user: publicUser(req.user),
    office: { name: getSetting('office_name'), tagline: getSetting('office_tagline') },
    lists, options: opts, resources: metaFor(req.user),
    users: all("SELECT id, name, color, role, job_title FROM users WHERE active = 1 AND role <> 'cliente' ORDER BY name"),
    today: today(),
  });
}));

// ------------------------------ DASHBOARD ------------------------------
router.get('/dashboard', wrap((req, res) => {
  automation.runAutomations();
  const u = req.user; const t = today(); const ms = monthStart(t); const me = monthEnd(t);
  const mgr = P.isManager(u);
  const ps = P.projectScope(u, 'p.id');
  const taskScope = mgr ? { sql: '1=1', params: [] } : { sql: '(t.assignee_id = ? OR t.created_by = ?)', params: [u.id, u.id] };
  const out = { today: t, finance: null };

  out.counts = {
    projects_active: val(`SELECT COUNT(*) FROM projects p WHERE p.archived = 0 AND p.status IN ('ativo','aguardando_cliente','em_obra') AND ${ps.sql}`, ...ps.params),
    projects_late: val(`SELECT COUNT(*) FROM projects p WHERE p.archived = 0 AND p.status NOT IN ('encerrado','cancelado') AND p.due_date < ? AND ${ps.sql}`, t, ...ps.params),
    works_active: val(`SELECT COUNT(*) FROM works w JOIN projects p ON p.id = w.project_id WHERE w.archived = 0 AND w.status = 'em_andamento' AND ${ps.sql}`, ...ps.params),
    tasks_pending: val(`SELECT COUNT(*) FROM tasks t WHERE t.archived = 0 AND t.status <> 'concluida' AND ${taskScope.sql}`, ...taskScope.params),
    tasks_late: val(`SELECT COUNT(*) FROM tasks t WHERE t.archived = 0 AND t.status <> 'concluida' AND t.due_date < ? AND ${taskScope.sql}`, t, ...taskScope.params),
    tasks_today: val(`SELECT COUNT(*) FROM tasks t WHERE t.archived = 0 AND t.status <> 'concluida' AND t.due_date = ? AND ${taskScope.sql}`, t, ...taskScope.params),
    proposals_waiting: mgr ? val("SELECT COUNT(*) FROM proposals WHERE archived = 0 AND status IN ('enviada','visualizada','negociacao')") : null,
    proposals_waiting_value: mgr ? round2(val("SELECT COALESCE(SUM(amount),0) FROM proposals WHERE archived = 0 AND status IN ('enviada','visualizada','negociacao')")) : null,
    contracts_waiting: mgr ? val("SELECT COUNT(*) FROM contracts WHERE archived = 0 AND status = 'aguardando_assinatura'") : null,
  };

  if (P.canFinance(u)) {
    const cf = finance.cashflow(11, 6);
    const sum = (sql, ...p) => round2(val(sql, ...p));
    out.finance = {
      balance: cf.balance,
      received_month: sum("SELECT COALESCE(SUM(amount),0) FROM incomes WHERE status='recebido' AND paid_at BETWEEN ? AND ?", ms, me),
      receivable_month: sum("SELECT COALESCE(SUM(amount),0) FROM incomes WHERE status IN ('previsto','a_receber','vencido') AND due_date BETWEEN ? AND ?", ms, me),
      expenses_month: sum("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE status <> 'cancelado' AND paid_by='escritorio' AND ((status='pago' AND paid_at BETWEEN ? AND ?) OR (status <> 'pago' AND due_date BETWEEN ? AND ?))", ms, me, ms, me),
      expenses_paid_month: sum("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE status='pago' AND paid_by='escritorio' AND paid_at BETWEEN ? AND ?", ms, me),
      overdue_in: { count: val("SELECT COUNT(*) FROM incomes WHERE status='vencido'"), amount: cf.overdue_in },
      overdue_out: { count: val("SELECT COUNT(*) FROM expenses WHERE status='vencido' AND paid_by='escritorio'"), amount: cf.overdue_out },
      due_soon: {
        count: val("SELECT COUNT(*) FROM expenses WHERE status IN ('a_pagar','previsto') AND paid_by='escritorio' AND due_date BETWEEN ? AND ?", t, addDays(t, 7)),
        amount: sum("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE status IN ('a_pagar','previsto') AND paid_by='escritorio' AND due_date BETWEEN ? AND ?", t, addDays(t, 7)),
      },
      months: cf.months, horizons: cf.horizons,
      expenses_by_category: all("SELECT COALESCE(category,'Sem categoria') label, ROUND(SUM(amount),2) value FROM expenses WHERE status <> 'cancelado' AND paid_by='escritorio' AND due_date BETWEEN ? AND ? GROUP BY 1 ORDER BY 2 DESC", ms, me),
      receivables: all(`SELECT i.id, i.description, i.amount, i.due_date, i.status, c.name client_name FROM incomes i LEFT JOIN clients c ON c.id = i.client_id
                        WHERE i.status IN ('a_receber','vencido','previsto') ORDER BY i.due_date LIMIT 8`),
      payments_next: all(`SELECT e.id, e.description, e.amount, e.due_date, e.status, s.company supplier_name FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
                          WHERE e.status IN ('a_pagar','vencido','previsto') AND e.paid_by='escritorio' AND e.due_date <= ? ORDER BY e.due_date LIMIT 8`, addDays(t, 15)),
    };
  }

  out.projects_by_phase = all(`SELECT COALESCE((SELECT name FROM project_phases ph WHERE ph.project_id = p.id AND ph.status NOT IN ('concluido','aprovado') ORDER BY position LIMIT 1), 'Sem etapas') label, COUNT(*) value
    FROM projects p WHERE p.archived = 0 AND p.status IN ('ativo','aguardando_cliente','em_obra') AND ${ps.sql} GROUP BY 1 ORDER BY MIN((SELECT position FROM project_phases ph WHERE ph.project_id = p.id AND ph.status NOT IN ('concluido','aprovado') ORDER BY position LIMIT 1))`, ...ps.params);
  out.tasks_by_user = all(`SELECT COALESCE(u.name,'Sem responsável') label, u.color, COUNT(*) value, SUM(CASE WHEN t.due_date < ? THEN 1 ELSE 0 END) late
    FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.archived = 0 AND t.status <> 'concluida' AND ${mgr ? '1=1' : 't.assignee_id = ' + Number(u.id)} GROUP BY t.assignee_id ORDER BY 3 DESC`, t);

  const evScope = mgr ? { sql: '1=1', params: [] } : { sql: '(ev.created_by = ? OR ev.id IN (SELECT event_id FROM event_users WHERE user_id = ?))', params: [u.id, u.id] };
  out.events = all(`SELECT ev.id, ev.title, ev.type, ev.start_at, ev.end_at, ev.all_day, ev.location, c.name client_name, p.name project_name FROM events ev
    LEFT JOIN clients c ON c.id = ev.client_id LEFT JOIN projects p ON p.id = ev.project_id
    WHERE ev.status = 'agendado' AND substr(ev.start_at,1,10) BETWEEN ? AND ? AND ${evScope.sql} ORDER BY ev.start_at LIMIT 8`, t, addDays(t, 14), ...evScope.params);
  out.deliveries = all(`SELECT * FROM (
      SELECT 'projeto' kind, p.id project_id, p.name title, NULL phase, p.due_date FROM projects p WHERE p.archived = 0 AND p.status NOT IN ('encerrado','cancelado') AND p.due_date IS NOT NULL AND ${ps.sql}
      UNION ALL
      SELECT 'etapa', p.id, p.name, ph.name, ph.due_date FROM project_phases ph JOIN projects p ON p.id = ph.project_id
      WHERE p.archived = 0 AND p.status NOT IN ('encerrado','cancelado') AND ph.status NOT IN ('concluido','aprovado') AND ph.due_date IS NOT NULL AND ${ps.sql}
    ) WHERE due_date BETWEEN ? AND ? ORDER BY due_date LIMIT 10`, ...ps.params, ...ps.params, addDays(t, -30), addDays(t, 30));
  out.my_tasks = all(`SELECT t.id, t.title, t.due_date, t.priority, t.status, p.name project_name FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.archived = 0 AND t.assignee_id = ? AND t.status <> 'concluida' ORDER BY t.due_date IS NULL, t.due_date, CASE t.priority WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 ELSE 2 END LIMIT 8`, u.id);

  // --------------- ATENÇÃO HOJE ---------------
  const A = [];
  const push = (severity, type, title, detail, link) => A.push({ severity, type, title, detail, link });
  if (P.canFinance(u)) {
    all("SELECT e.*, s.company sname FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id WHERE e.status IN ('a_pagar','previsto') AND e.paid_by='escritorio' AND e.due_date = ?", t)
      .forEach((x) => push('warning', 'Pagamento vence hoje', x.description, `${brl(x.amount)}${x.sname ? ' · ' + x.sname : ''}`, `#/financeiro/saidas?id=${x.id}`));
    all("SELECT i.*, c.name cname FROM incomes i LEFT JOIN clients c ON c.id = i.client_id WHERE i.status = 'a_receber' AND i.due_date = ?", t)
      .forEach((x) => push('info', 'Recebimento previsto hoje', x.cname || x.description, `${brl(x.amount)} · ${x.description}`, `#/financeiro/entradas?id=${x.id}`));
    all("SELECT i.*, c.name cname FROM incomes i LEFT JOIN clients c ON c.id = i.client_id WHERE i.status = 'vencido' ORDER BY i.due_date LIMIT 6")
      .forEach((x) => push('danger', 'Parcela de cliente atrasada', x.cname || x.description, `${brl(x.amount)} · venceu ${br(x.due_date)}`, `#/financeiro/entradas?id=${x.id}`));
    all("SELECT e.* FROM expenses e WHERE e.status = 'vencido' AND e.paid_by='escritorio' ORDER BY e.due_date LIMIT 4")
      .forEach((x) => push('danger', 'Conta em atraso', x.description, `${brl(x.amount)} · venceu ${br(x.due_date)}`, `#/financeiro/saidas?id=${x.id}`));
  }
  out.events.filter((e) => e.start_at.slice(0, 10) === t)
    .forEach((e) => push('info', C.EVENT_TYPES.find((x) => x.value === e.type)?.label || 'Compromisso', e.title, `${e.all_day ? 'Dia inteiro' : e.start_at.slice(11, 16)}${e.location ? ' · ' + e.location : ''}`, `#/agenda?data=${t}`));
  out.deliveries.filter((d) => d.due_date <= t)
    .forEach((d) => push(d.due_date < t ? 'danger' : 'warning', d.kind === 'projeto' ? (d.due_date < t ? 'Entrega de projeto atrasada' : 'Entrega de projeto hoje') : (d.due_date < t ? 'Etapa atrasada' : 'Etapa vence hoje'),
      d.phase ? `${d.phase} — ${d.title}` : d.title, br(d.due_date), `#/projetos/${d.project_id}`));
  all(`SELECT t.id, t.title, t.due_date, u.name uname FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.archived = 0 AND t.status <> 'concluida' AND t.due_date <= ? AND ${taskScope.sql} ORDER BY t.due_date LIMIT 6`, t, ...taskScope.params)
    .forEach((x) => push(x.due_date < t ? 'danger' : 'warning', x.due_date < t ? 'Tarefa atrasada' : 'Tarefa para hoje', x.title, `${x.uname || 'Sem responsável'} · ${br(x.due_date)}`, `#/tarefas/${x.id}`));
  if (mgr) {
    all("SELECT pr.*, c.name cname FROM proposals pr LEFT JOIN clients c ON c.id = pr.client_id WHERE pr.archived = 0 AND pr.status IN ('enviada','visualizada','negociacao') ORDER BY pr.valid_until LIMIT 4")
      .forEach((x) => push('neutral', 'Proposta aguardando aprovação', `${x.cname} — ${x.title}`, `${brl(x.amount)}${x.valid_until ? ' · válida até ' + br(x.valid_until) : ''}`, `#/propostas/${x.id}`));
    all("SELECT q.item, p.name pname, p.id pid, COUNT(*) n FROM quotes q JOIN projects p ON p.id = q.project_id WHERE q.client_visible = 1 AND q.status IN ('recebido','negociacao') AND NOT EXISTS (SELECT 1 FROM quotes q2 WHERE q2.project_id = q.project_id AND q2.item = q.item AND q2.client_selected = 1) GROUP BY q.project_id, q.item LIMIT 4")
      .forEach((x) => push('neutral', 'Orçamento aguardando aprovação do cliente', `${x.item} — ${x.pname}`, `${x.n} opções liberadas`, `#/projetos/${x.pid}?tab=orcamentos`));
    all("SELECT q.item, p.name pname, p.id pid, s.company FROM quotes q JOIN projects p ON p.id = q.project_id LEFT JOIN suppliers s ON s.id = q.supplier_id WHERE q.client_selected = 1 AND q.status IN ('recebido','negociacao')")
      .forEach((x) => push('success', 'Cliente escolheu orçamento', `${x.item} — ${x.pname}`, `Fornecedor: ${x.company || '-'}`, `#/projetos/${x.pid}?tab=orcamentos`));
    all("SELECT ct.*, c.name cname FROM contracts ct LEFT JOIN clients c ON c.id = ct.client_id WHERE ct.archived = 0 AND ct.status = 'aguardando_assinatura' LIMIT 4")
      .forEach((x) => push('warning', 'Contrato aguardando assinatura', `${x.cname} — ${x.number}`, brl(x.amount), `#/contratos/${x.id}`));
    all('SELECT * FROM documents WHERE archived = 0 AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at LIMIT 4', addDays(t, 15))
      .forEach((x) => push(x.expires_at < t ? 'danger' : 'warning', x.expires_at < t ? 'Documento vencido' : 'Documento próximo do vencimento', x.title, br(x.expires_at), `#/documentos?id=${x.id}`));
    all("SELECT id, name FROM clients WHERE archived = 0 AND birthday IS NOT NULL AND substr(birthday,6,5) = substr(?,6,5)", t)
      .forEach((x) => push('success', 'Aniversário de cliente', x.name, 'Que tal enviar uma mensagem?', `#/clientes/${x.id}`));
  }
  const order = { danger: 0, warning: 1, info: 2, neutral: 3, success: 4 };
  out.attention = A.sort((a, b) => order[a.severity] - order[b.severity]);
  out.notifications = all('SELECT * FROM notifications WHERE user_id = ? AND read_at IS NULL ORDER BY id DESC LIMIT 6', u.id);
  res.json(out);
}));
const brl = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const br = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');

// ------------------------------ PESQUISA GLOBAL ------------------------------
router.get('/search', wrap((req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const { list } = require('../crud');
  const groups = [
    ['clients', 'Cliente', (r) => ({ title: r.name, sub: [r.city, r.whatsapp || r.phone].filter(Boolean).join(' · '), link: `#/clientes/${r.id}` })],
    ['projects', 'Projeto', (r) => ({ title: r.name, sub: [r.client_name, r.code].filter(Boolean).join(' · '), link: `#/projetos/${r.id}` })],
    ['works', 'Obra', (r) => ({ title: r.name, sub: r.client_name, link: `#/obras/${r.id}` })],
    ['suppliers', 'Fornecedor', (r) => ({ title: r.company, sub: r.category, link: `#/fornecedores/${r.id}` })],
    ['tasks', 'Tarefa', (r) => ({ title: r.title, sub: [r.project_name, r.assignee_name].filter(Boolean).join(' · '), link: `#/tarefas/${r.id}` })],
    ['documents', 'Documento', (r) => ({ title: r.title, sub: [r.category, r.project_name].filter(Boolean).join(' · '), link: `#/documentos?id=${r.id}` })],
    ['proposals', 'Proposta', (r) => ({ title: `${r.number} — ${r.title}`, sub: r.client_name, link: `#/propostas/${r.id}` })],
    ['contracts', 'Contrato', (r) => ({ title: r.number, sub: [r.client_name, r.project_name].filter(Boolean).join(' · '), link: `#/contratos/${r.id}` })],
    ['events', 'Agenda', (r) => ({ title: r.title, sub: br(r.start_at), link: `#/agenda?data=${r.start_at.slice(0, 10)}` })],
  ];
  const results = [];
  for (const [key, label, fmt] of groups) {
    const r = R[key];
    if (!r.read(req.user)) continue;
    const { rows } = list(r, req.user, { q, limit: 6, archived: 'all' });
    rows.forEach((row) => results.push({ type: label, ...fmt(row), archived: !!row.archived }));
  }
  res.json({ results });
}));

// ------------------------------ NOTIFICAÇÕES ------------------------------
router.get('/notifications', wrap((req, res) => {
  automation.runAutomations();
  const rows = all(`SELECT * FROM notifications WHERE user_id = ? ${req.query.unread ? 'AND read_at IS NULL' : ''} ORDER BY read_at IS NOT NULL, id DESC LIMIT 100`, req.user.id);
  res.json({ rows, unread: val('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id) });
}));
router.post('/notifications/read', wrap((req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : null;
  if (ids && ids.length) run(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`, nowIso(), req.user.id, ...ids);
  else run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), req.user.id);
  res.json({ ok: true });
}));

module.exports = router;
