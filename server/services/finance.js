const crypto = require('crypto');
const { all, get, run, val, insert, tx, getSetting } = require('../db');
const { today, addMonths, monthKey, monthStart, monthEnd, round2, splitAmount, HttpError } = require('../util');

const PAID = { incomes: 'recebido', expenses: 'pago' };
const OPEN = { incomes: 'a_receber', expenses: 'a_pagar' };

// Contratos ainda não assinados mantêm suas parcelas como "previsto"
const UNSIGNED = "(contract_id IS NOT NULL AND contract_id IN (SELECT id FROM contracts WHERE status IN ('elaboracao','aguardando_assinatura')))";

// Automação: atualiza status conforme datas (vencido / a receber / previsto)
function refreshStatuses() {
  const t = today(); const me = monthEnd(t);
  run(`UPDATE incomes SET status='vencido' WHERE status IN ('previsto','a_receber') AND paid_at IS NULL AND due_date < ? AND NOT ${UNSIGNED}`, t);
  run(`UPDATE incomes SET status='a_receber' WHERE status='previsto' AND due_date <= ? AND NOT ${UNSIGNED}`, me);
  run(`UPDATE incomes SET status='a_receber' WHERE status='vencido' AND due_date >= ?`, t);
  run(`UPDATE expenses SET status='vencido' WHERE status IN ('previsto','a_pagar') AND paid_at IS NULL AND due_date < ?`, t);
  run(`UPDATE expenses SET status='a_pagar' WHERE status='previsto' AND due_date <= ?`, me);
  run(`UPDATE expenses SET status='a_pagar' WHERE status='vencido' AND due_date >= ?`, t);
}

// Regras aplicadas ao salvar uma receita/despesa
function normalize(table, data, existing = {}) {
  const paid = PAID[table];
  if ('amount' in data) data.amount = round2(data.amount);
  if ('paid_at' in data && !data.paid_at) data.paid_at = null;
  const merged = { ...existing, ...data };
  if (merged.status === 'cancelado') return data;
  if (data.paid_at) { data.status = paid; return data; }
  if (merged.status === paid) { if (!merged.paid_at) data.paid_at = today(); return data; }
  // não pago
  if (existing.status === paid) data.paid_at = null;
  if (merged.due_date && merged.due_date < today()) data.status = 'vencido';
  else if (merged.status === 'previsto') data.status = 'previsto';
  else data.status = OPEN[table];
  return data;
}

// Gera N parcelas (receitas ou despesas) a partir de um total
function generateInstallments(table, base, { total, count, first_due, interval = 1, first_paid = false }) {
  const n = Math.max(1, Math.min(120, parseInt(count, 10) || 1));
  if (!first_due) throw new HttpError(400, 'Informe a data do primeiro vencimento.');
  if (!(Number(total) > 0)) throw new HttpError(400, 'Informe o valor total.');
  const values = splitAmount(total, n);
  const group = crypto.randomBytes(6).toString('hex');
  const day = Number(first_due.slice(8, 10));
  const ids = [];
  tx(() => {
    values.forEach((amount, i) => {
      const row = {
        ...base, amount, due_date: addMonths(first_due, i * (parseInt(interval, 10) || 1), day),
        installment_no: i + 1, installment_total: n, group_key: n > 1 ? group : null,
        description: n > 1 ? `${base.description} (${i + 1}/${n})` : base.description,
      };
      row.status = base.status === 'previsto' ? 'previsto' : OPEN[table];
      row.paid_at = null;
      if (i === 0 && first_paid) { row.status = PAID[table]; row.paid_at = base.paid_at || row.due_date; }
      normalize(table, row);
      ids.push(insert(table, row));
    });
  });
  return ids;
}

// Automação: cria os lançamentos das despesas recorrentes para os próximos meses
function generateRecurring() {
  const ahead = parseInt(getSetting('recurring_months_ahead', '3'), 10) || 3;
  const limit = monthKey(addMonths(today(), ahead));
  const earliest = monthKey(addMonths(today(), -12));
  let created = 0;
  for (const r of all('SELECT * FROM recurring_expenses WHERE active = 1')) {
    let cursor = monthStart(r.start_date);
    if (monthKey(cursor) < earliest) cursor = earliest + '-01';
    while (monthKey(cursor) <= limit) {
      const ref = monthKey(cursor);
      if (r.end_date && ref > monthKey(r.end_date)) break;
      const due = addMonths(cursor, 0, r.day);
      if (due >= r.start_date.slice(0, 10) || ref === monthKey(r.start_date)) {
        const exists = get('SELECT 1 FROM expenses WHERE recurring_id = ? AND recurring_ref = ?', r.id, ref);
        if (!exists) {
          const row = { description: r.description, supplier_id: r.supplier_id, category: r.category, amount: r.amount, due_date: due,
            method: r.method, recurring_id: r.id, recurring_ref: ref, status: 'a_pagar', notes: r.notes };
          normalize('expenses', row);
          if (due > monthEnd()) row.status = 'previsto';
          insert('expenses', row); created++;
        }
      }
      cursor = addMonths(cursor, 1, 1);
    }
  }
  return created;
}

// Atualiza lançamentos futuros não pagos quando a recorrência é alterada
function syncRecurringFuture(recId) {
  const r = get('SELECT * FROM recurring_expenses WHERE id = ?', recId);
  if (!r) return;
  const t = today();
  if (!r.active) {
    run("DELETE FROM expenses WHERE recurring_id = ? AND paid_at IS NULL AND due_date > ? AND status IN ('previsto','a_pagar')", recId, t);
    return;
  }
  for (const e of all("SELECT * FROM expenses WHERE recurring_id = ? AND paid_at IS NULL AND due_date >= ? AND status <> 'cancelado'", recId, t)) {
    run('UPDATE expenses SET description=?, supplier_id=?, category=?, amount=?, method=?, due_date=? WHERE id = ?',
      r.description, r.supplier_id, r.category, r.amount, r.method, addMonths(e.recurring_ref + '-01', 0, r.day), e.id);
  }
  if (r.end_date) run("DELETE FROM expenses WHERE recurring_id = ? AND paid_at IS NULL AND recurring_ref > ?", recId, monthKey(r.end_date));
  generateRecurring();
}

function balance() {
  const opening = Number(getSetting('opening_balance', '0')) || 0;
  const since = getSetting('opening_balance_date', '1900-01-01');
  const inc = val("SELECT COALESCE(SUM(amount),0) FROM incomes WHERE status='recebido' AND paid_at >= ?", since);
  const exp = val("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE status='pago' AND paid_by='escritorio' AND paid_at >= ?", since);
  return round2(opening + inc - exp);
}

// Fluxo de caixa mensal: realizado (pelo mês de pagamento) + previsto (pelo mês de vencimento)
function cashflow(back = 6, ahead = 12) {
  const t = today();
  const start = monthStart(addMonths(t, -back));
  const end = monthEnd(addMonths(t, ahead));
  const months = [];
  for (let i = -back; i <= ahead; i++) months.push(monthKey(addMonths(monthStart(t), i, 1)));
  const map = Object.fromEntries(months.map((m) => [m, { month: m, in_real: 0, out_real: 0, in_prev: 0, out_prev: 0 }]));
  const add = (rows, key) => rows.forEach((r) => { if (map[r.m]) map[r.m][key] = round2(r.v); });
  add(all("SELECT substr(paid_at,1,7) m, SUM(amount) v FROM incomes WHERE status='recebido' AND paid_at BETWEEN ? AND ? GROUP BY m", start, end), 'in_real');
  add(all("SELECT substr(paid_at,1,7) m, SUM(amount) v FROM expenses WHERE status='pago' AND paid_by='escritorio' AND paid_at BETWEEN ? AND ? GROUP BY m", start, end), 'out_real');
  add(all("SELECT substr(due_date,1,7) m, SUM(amount) v FROM incomes WHERE status IN ('previsto','a_receber') AND due_date BETWEEN ? AND ? GROUP BY m", monthStart(t), end), 'in_prev');
  add(all("SELECT substr(due_date,1,7) m, SUM(amount) v FROM expenses WHERE status IN ('previsto','a_pagar') AND paid_by='escritorio' AND due_date BETWEEN ? AND ? GROUP BY m", monthStart(t), end), 'out_prev');
  // Vencidos entram na previsão do mês corrente (ainda precisam ser recebidos/pagos)
  const overdueIn = val("SELECT COALESCE(SUM(amount),0) FROM incomes WHERE status='vencido'");
  const overdueOut = val("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE status='vencido' AND paid_by='escritorio'");
  const cur = map[monthKey(t)];
  cur.overdue_in = round2(overdueIn); cur.overdue_out = round2(overdueOut);

  let running = balance();
  const current = running;
  const rows = months.map((m) => map[m]);
  rows.forEach((r) => {
    r.in_total = round2(r.in_real + r.in_prev); r.out_total = round2(r.out_real + r.out_prev);
    if (r.month >= monthKey(t)) {
      running = round2(running + r.in_prev - r.out_prev + (r.month === monthKey(t) ? (overdueIn - overdueOut) : 0));
      r.projected_balance = running;
    }
  });
  const horizon = (n) => {
    const lim = monthKey(addMonths(t, n - 1));
    const slice = rows.filter((r) => r.month >= monthKey(t) && r.month <= lim);
    const ins = round2(slice.reduce((s, r) => s + r.in_prev, 0) + overdueIn);
    const outs = round2(slice.reduce((s, r) => s + r.out_prev, 0) + overdueOut);
    return { months: n, entradas: ins, saidas: outs, saldo: round2(current + ins - outs) };
  };
  return { balance: current, months: rows, horizons: [horizon(3), horizon(6), horizon(12)], overdue_in: round2(overdueIn), overdue_out: round2(overdueOut) };
}

module.exports = { refreshStatuses, normalize, generateInstallments, generateRecurring, syncRecurringFuture, balance, cashflow, PAID, OPEN };
