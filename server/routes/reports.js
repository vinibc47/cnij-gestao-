// Relatórios gerenciais automáticos
const express = require('express');
const { all, get, val } = require('../db');
const { wrap, today, addDays, round2, daysBetween } = require('../util');
const P = require('../permissions');
const proj = require('../services/projects');
const finance = require('../services/finance');

const router = express.Router();
const r2 = (rows) => rows.map((r) => ({ ...r, value: round2(r.value) }));

router.get('/', wrap((req, res) => {
  const u = req.user;
  const year = Number(req.query.year) || new Date().getFullYear();
  const from = req.query.from || `${year}-01-01`;
  const to = req.query.to || `${year}-12-31`;
  const t = today();
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const out = { year, from, to };

  if (P.canFinance(u)) {
    const inc = Object.fromEntries(all("SELECT substr(paid_at,1,7) m, SUM(amount) v FROM incomes WHERE status='recebido' AND substr(paid_at,1,4) = ? GROUP BY m", String(year)).map((r) => [r.m, r.v]));
    const exp = Object.fromEntries(all("SELECT substr(paid_at,1,7) m, SUM(amount) v FROM expenses WHERE status='pago' AND paid_by='escritorio' AND substr(paid_at,1,4) = ? GROUP BY m", String(year)).map((r) => [r.m, r.v]));
    const monthly = months.map((m) => ({ month: m, revenue: round2(inc[m] || 0), expenses: round2(exp[m] || 0), profit: round2((inc[m] || 0) - (exp[m] || 0)) }));
    const tot = monthly.reduce((a, m) => ({ revenue: a.revenue + m.revenue, expenses: a.expenses + m.expenses }), { revenue: 0, expenses: 0 });
    const overdue = all(`SELECT i.id, i.description, i.amount, i.due_date, c.name client_name, c.id client_id FROM incomes i LEFT JOIN clients c ON c.id = i.client_id WHERE i.status = 'vencido' ORDER BY i.due_date`);
    const aging = { '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    overdue.forEach((o) => { const d = daysBetween(o.due_date, t); aging[d <= 30 ? '1-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+'] += o.amount; });
    const receivedTotal = val("SELECT COALESCE(SUM(amount),0) FROM incomes WHERE status='recebido' AND due_date BETWEEN ? AND ?", from, to);
    const dueTotal = val("SELECT COALESCE(SUM(amount),0) FROM incomes WHERE status IN ('recebido','vencido') AND due_date BETWEEN ? AND ?", from, to);
    const overdueInPeriod = val("SELECT COALESCE(SUM(amount),0) FROM incomes WHERE status='vencido' AND due_date BETWEEN ? AND ?", from, to);
    out.finance = {
      monthly, total_revenue: round2(tot.revenue), total_expenses: round2(tot.expenses), profit: round2(tot.revenue - tot.expenses),
      margin: tot.revenue ? round2(((tot.revenue - tot.expenses) / tot.revenue) * 100) : null,
      yearly: r2(all("SELECT substr(paid_at,1,4) label, SUM(amount) value FROM incomes WHERE status='recebido' AND paid_at IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 6")).reverse(),
      revenue_by_category: r2(all("SELECT COALESCE(category,'Sem categoria') label, SUM(amount) value FROM incomes WHERE status='recebido' AND paid_at BETWEEN ? AND ? GROUP BY 1 ORDER BY 2 DESC", from, to)),
      expenses_by_category: r2(all("SELECT COALESCE(category,'Sem categoria') label, SUM(amount) value FROM expenses WHERE status='pago' AND paid_by='escritorio' AND paid_at BETWEEN ? AND ? GROUP BY 1 ORDER BY 2 DESC", from, to)),
      receivables_open: round2(val("SELECT COALESCE(SUM(amount),0) FROM incomes WHERE status IN ('previsto','a_receber')")),
      receivables_next: r2(all("SELECT substr(due_date,1,7) label, SUM(amount) value FROM incomes WHERE status IN ('previsto','a_receber','vencido') GROUP BY 1 ORDER BY 1 LIMIT 12")),
      overdue_total: round2(overdue.reduce((s, o) => s + o.amount, 0)), overdue_list: overdue,
      aging: Object.entries(aging).map(([label, value]) => ({ label, value: round2(value) })),
      default_rate: dueTotal ? round2((overdueInPeriod / dueTotal) * 100) : 0,
      received_in_period: round2(receivedTotal),
      cashflow: finance.cashflow(6, 12),
      profitability: all("SELECT id, name, status FROM projects WHERE archived = 0 OR status = 'encerrado' ORDER BY name").map((p) => ({ ...proj.profitability(p.id), name: p.name, status: p.status }))
        .filter((p) => p.contracted > 0 || p.total_costs > 0).sort((a, b) => (b.margin ?? -999) - (a.margin ?? -999)),
    };
  }

  if (P.isManager(u)) {
    const closed = all("SELECT contracted_at, start_date, closed_at, due_date FROM projects WHERE status = 'encerrado' AND closed_at IS NOT NULL");
    const durations = closed.map((p) => daysBetween(p.contracted_at || p.start_date || p.closed_at, p.closed_at)).filter((d) => d >= 0);
    const onTime = closed.filter((p) => p.due_date && p.closed_at <= p.due_date).length;
    out.projects = {
      total: val('SELECT COUNT(*) FROM projects'),
      active: val("SELECT COUNT(*) FROM projects WHERE status IN ('ativo','aguardando_cliente','em_obra') AND archived = 0"),
      closed: val("SELECT COUNT(*) FROM projects WHERE status = 'encerrado'"),
      closed_in_period: val("SELECT COUNT(*) FROM projects WHERE status = 'encerrado' AND closed_at BETWEEN ? AND ?", from, to),
      started_in_period: val('SELECT COUNT(*) FROM projects WHERE COALESCE(contracted_at, substr(created_at,1,10)) BETWEEN ? AND ?', from, to),
      late: val("SELECT COUNT(*) FROM projects WHERE status NOT IN ('encerrado','cancelado') AND due_date < ?", t),
      avg_days: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      on_time_rate: closed.length ? round2((onTime / closed.length) * 100) : null,
      by_type: all("SELECT COALESCE(type,'Sem tipo') label, COUNT(*) value FROM projects GROUP BY 1 ORDER BY 2 DESC"),
      by_status: all('SELECT status label, COUNT(*) value FROM projects GROUP BY 1 ORDER BY 2 DESC'),
      area_total: round2(val("SELECT COALESCE(SUM(area),0) FROM projects WHERE status <> 'cancelado'")),
      late_list: all("SELECT p.id, p.name, p.due_date, c.name client_name, p.progress FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.status NOT IN ('encerrado','cancelado') AND p.due_date < ? ORDER BY p.due_date", t),
    };
    const pr = (st) => val(`SELECT COUNT(*) FROM proposals WHERE status IN (${st}) AND COALESCE(sent_at, substr(created_at,1,10)) BETWEEN ? AND ?`, from, to);
    const sent = pr("'enviada','visualizada','negociacao','aprovada','recusada','expirada'");
    const approved = pr("'aprovada'"); const refused = pr("'recusada'"); const expired = pr("'expirada'");
    const decided = approved + refused + expired;
    const decisionDays = all("SELECT sent_at, decided_at FROM proposals WHERE sent_at IS NOT NULL AND decided_at IS NOT NULL AND sent_at BETWEEN ? AND ?", from, to).map((p) => daysBetween(p.sent_at, p.decided_at));
    out.commercial = {
      sent, approved, refused, expired, open: pr("'enviada','visualizada','negociacao'"),
      conversion: decided ? round2((approved / decided) * 100) : null,
      conversion_contracts: sent ? round2((val("SELECT COUNT(DISTINCT proposal_id) FROM contracts WHERE proposal_id IN (SELECT id FROM proposals WHERE COALESCE(sent_at, substr(created_at,1,10)) BETWEEN ? AND ?) AND status <> 'cancelado'", from, to) / sent) * 100) : null,
      ticket: round2(val("SELECT COALESCE(AVG(amount),0) FROM contracts WHERE status <> 'cancelado' AND COALESCE(signed_at, substr(created_at,1,10)) BETWEEN ? AND ?", from, to)),
      approved_value: round2(val("SELECT COALESCE(SUM(amount),0) FROM proposals WHERE status = 'aprovada' AND COALESCE(decided_at, sent_at) BETWEEN ? AND ?", from, to)),
      pipeline_value: round2(val("SELECT COALESCE(SUM(amount),0) FROM proposals WHERE status IN ('enviada','visualizada','negociacao')")),
      avg_decision_days: decisionDays.length ? Math.round(decisionDays.reduce((a, b) => a + b, 0) / decisionDays.length) : null,
      by_status: all("SELECT status label, COUNT(*) value FROM proposals WHERE COALESCE(sent_at, substr(created_at,1,10)) BETWEEN ? AND ? GROUP BY 1", from, to),
      refusal_reasons: all("SELECT COALESCE(NULLIF(refusal_reason,''),'Não informado') label, COUNT(*) value FROM proposals WHERE status = 'recusada' GROUP BY 1 ORDER BY 2 DESC"),
      by_origin: all(`SELECT COALESCE(c.origin,'Não informado') label, COUNT(*) value, SUM(CASE WHEN pr.status='aprovada' THEN 1 ELSE 0 END) approved
                      FROM proposals pr JOIN clients c ON c.id = pr.client_id GROUP BY 1 ORDER BY 2 DESC`),
    };
    out.clients = {
      total: val('SELECT COUNT(*) FROM clients WHERE archived = 0'),
      new_in_period: val('SELECT COUNT(*) FROM clients WHERE substr(created_at,1,10) BETWEEN ? AND ?', from, to),
      new_by_month: months.map((m) => ({ label: m, value: val('SELECT COUNT(*) FROM clients WHERE substr(created_at,1,7) = ?', m) })),
      recurring: val('SELECT COUNT(*) FROM (SELECT client_id FROM projects GROUP BY client_id HAVING COUNT(*) > 1)'),
      recurring_list: all('SELECT c.id, c.name, COUNT(p.id) projects FROM clients c JOIN projects p ON p.client_id = c.id GROUP BY c.id HAVING COUNT(p.id) > 1 ORDER BY 3 DESC'),
      by_origin: all("SELECT COALESCE(origin,'Não informado') label, COUNT(*) value FROM clients GROUP BY 1 ORDER BY 2 DESC"),
    };
    if (P.canFinance(u)) out.clients.revenue = r2(all("SELECT c.id, c.name label, SUM(i.amount) value FROM incomes i JOIN clients c ON c.id = i.client_id WHERE i.status = 'recebido' AND i.paid_at BETWEEN ? AND ? GROUP BY c.id ORDER BY 3 DESC LIMIT 15", from, to));
    out.team = {
      tasks_done: all("SELECT COALESCE(u.name,'Sem responsável') label, COUNT(*) value FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.status = 'concluida' AND t.completed_at BETWEEN ? AND ? GROUP BY 1 ORDER BY 2 DESC", from, to),
      tasks_open: all("SELECT COALESCE(u.name,'Sem responsável') label, COUNT(*) value, SUM(CASE WHEN t.due_date < ? THEN 1 ELSE 0 END) late FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.status <> 'concluida' AND t.archived = 0 GROUP BY 1 ORDER BY 2 DESC", t),
      hours: r2(all('SELECT u.name label, SUM(te.hours) value FROM time_entries te JOIN users u ON u.id = te.user_id WHERE te.date BETWEEN ? AND ? GROUP BY 1 ORDER BY 2 DESC', from, to)),
      hours_by_project: r2(all('SELECT p.name label, SUM(te.hours) value FROM time_entries te JOIN projects p ON p.id = te.project_id WHERE te.date BETWEEN ? AND ? GROUP BY 1 ORDER BY 2 DESC LIMIT 12', from, to)),
    };
  }
  res.json(out);
}));

module.exports = router;
