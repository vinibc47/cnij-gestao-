// =====================================================================
// Separação financeira
//   CAIXA DO ESCRITÓRIO: só o que entra ou sai de fato das contas do escritório
//     · entradas = receitas recebidas (honorários, recursos para repasse, reembolsos)
//     · saídas   = despesas pagas PELO ESCRITÓRIO (próprias ou de obra, com repasse/adiantamento)
//   FINANCEIRO DAS OBRAS: custos e pagamentos de cada obra, inclusive os pagos
//     diretamente pelo cliente ao fornecedor — que nunca movimentam o caixa.
// A origem e o destino reais vêm de campos próprios (flow, paid_by, funding, nature),
// e não da categoria. Um mesmo registro aparece nas duas áreas quando for o caso.
// =====================================================================
const { all, get, run, val, insert, update, tx, getSetting } = require('../db');
const { HttpError, today, nowIso, round2, addDays } = require('../util');
const finance = require('./finance');

const PAID = { incomes: 'recebido', expenses: 'pago' };
const OPEN_ST = "('previsto','a_receber','a_pagar','vencido')";
const NATURE = { honorarios: 'Honorários e receitas próprias', repasse: 'Recurso de cliente para repasse', reembolso: 'Reembolso de adiantamento' };
const FUNDING = { repasse: 'com recurso do cliente (repasse)', adiantamento: 'adiantamento do escritório — a reembolsar', proprio: 'custo do escritório' };
const DEFAULT_ACCOUNT = () => (get("SELECT name FROM options WHERE kind = 'conta' AND archived = 0 ORDER BY position, name") || {}).name || 'Conta principal';
const ymd = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);

function event(table, id, action, { user, actor = 'escritorio', summary, data, reason } = {}) {
  insert('finance_events', { table_name: table, record_id: id, action, user_id: user ? user.id : null, actor, summary: summary || null, data: data ? JSON.stringify(data) : null, reason: reason || null, created_at: nowIso() });
}
function history(table, id) {
  return all('SELECT e.*, u.name user_name FROM finance_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.table_name = ? AND e.record_id = ? ORDER BY e.id', table, id)
    .map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : null }));
}

// ---------------------------------------------------------------------
// Situação legível de uma parcela de obra
function obraStatus(e) {
  if (e.status === 'cancelado') return { key: 'cancelado', label: 'Cancelado' };
  if (e.status === 'pago') return e.paid_by === 'cliente' ? { key: 'pago_cliente', label: 'Pago diretamente pelo cliente' } : { key: 'pago_escritorio', label: 'Pago pelo escritório' };
  if (e.informed_at) return { key: 'informado', label: 'Pagamento informado — aguardando conferência' };
  if (!e.due_date) return { key: 'sem_data', label: 'Aguardando pagamento', due_label: 'Na finalização — data a definir' };
  if (e.status === 'vencido') return { key: 'vencido', label: 'Aguardando pagamento — vencido' };
  return { key: 'aguardando', label: 'Aguardando pagamento' };
}

// ---------------------------------------------------------------------
// CAIXA DO ESCRITÓRIO
// filtros: from, to, account, client_id, project_id, status (realizado | aberto | vencido | informado | todos)
function cashMovements(f = {}) {
  const from = ymd(f.from) || today().slice(0, 8) + '01'; const to = ymd(f.to) || today();
  const acc = f.account || '';
  const defAcc = DEFAULT_ACCOUNT();
  const accSql = (al) => (acc ? ` AND COALESCE(${al}.account, '${defAcc.replace(/'/g, "''")}') = ?` : '');
  const accP = acc ? [acc] : [];
  const cliSqlI = f.client_id ? ' AND i.client_id = ?' : ''; const cliP = f.client_id ? [Number(f.client_id)] : [];
  const cliSqlE = f.client_id ? ' AND p.client_id = ?' : '';
  const prjSqlI = f.project_id ? ' AND i.project_id = ?' : ''; const prjSqlE = f.project_id ? ' AND e.project_id = ?' : ''; const prjP = f.project_id ? [Number(f.project_id)] : [];
  const st = f.status || 'realizado';
  const inc = all(`SELECT i.id, 'incomes' tbl, 'entrada' dir, COALESCE(i.paid_at, i.due_date) date, i.paid_at, i.due_date, i.description, c.name party, i.client_id, p.name project_name, i.project_id,
      i.category, i.nature, i.amount, COALESCE(i.account, ?) account, i.status, i.informed_at, i.method,
      (SELECT COUNT(*) FROM documents d WHERE d.entity = 'incomes' AND d.entity_id = i.id AND d.archived = 0) docs
    FROM incomes i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.status <> 'cancelado' ${accSql('i')} ${cliSqlI} ${prjSqlI}`, defAcc, ...accP, ...cliP, ...prjP);
  const exp = all(`SELECT e.id, 'expenses' tbl, 'saida' dir, COALESCE(e.paid_at, e.due_date) date, e.paid_at, e.due_date, e.description, COALESCE(e.payee, s.company) party, p.client_id, p.name project_name, e.project_id,
      e.category, e.flow, e.funding, e.amount, COALESCE(e.account, ?) account, e.status, e.informed_at, e.method,
      (SELECT COUNT(*) FROM documents d WHERE d.entity = 'expenses' AND d.entity_id = e.id AND d.archived = 0) docs
    FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id LEFT JOIN projects p ON p.id = e.project_id
    WHERE e.status <> 'cancelado' AND e.paid_by = 'escritorio' ${accSql('e')} ${cliSqlE} ${prjSqlE}`, defAcc, ...accP, ...cliP, ...prjP);
  const rows = [...inc, ...exp].map((r) => ({ ...r, kind: kindOf(r), realized: r.status === PAID[r.tbl] }));
  const inPeriod = (d) => d && d >= from && d <= to;
  const realizedIn = rows.filter((r) => r.realized && inPeriod(r.paid_at));
  const openRows = rows.filter((r) => !r.realized && (!r.due_date || r.due_date <= to));
  // saldo inicial: saldo cadastrado (quando o filtro abrange a conta principal) + movimentações realizadas antes do período
  const opening = Number(getSetting('opening_balance', '0')) || 0; const openingDate = getSetting('opening_balance_date', '1900-01-01');
  const useOpening = !f.client_id && !f.project_id && (!acc || acc === defAcc);
  const before = rows.filter((r) => r.realized && r.paid_at < from && r.paid_at >= openingDate);
  const net = (list) => round2(list.reduce((s, r) => s + (r.dir === 'entrada' ? r.amount : -r.amount), 0));
  const startBal = round2((useOpening && openingDate < from ? opening : 0) + net(before) + (useOpening && openingDate >= from && openingDate <= to ? 0 : 0));
  const ins = realizedIn.filter((r) => r.dir === 'entrada'); const outs = realizedIn.filter((r) => r.dir === 'saida');
  const sum = (list) => round2(list.reduce((s, r) => s + r.amount, 0));
  const periodOpening = useOpening && openingDate >= from && openingDate <= to ? opening : 0;
  const kpis = {
    period: { from, to }, account: acc || 'Todas as contas',
    saldo_inicial: round2(startBal + periodOpening), opening_note: useOpening ? `inclui saldo inicial cadastrado de ${opening.toFixed(2)} em ${openingDate}` : 'movimentações do filtro antes do período',
    entradas: sum(ins), saidas: sum(outs), saldo: round2(startBal + periodOpening + sum(ins) - sum(outs)),
    a_receber: sum(openRows.filter((r) => r.dir === 'entrada')), a_pagar: sum(openRows.filter((r) => r.dir === 'saida')),
    vencido_receber: sum(openRows.filter((r) => r.dir === 'entrada' && r.status === 'vencido')), vencido_pagar: sum(openRows.filter((r) => r.dir === 'saida' && r.status === 'vencido')),
    // separação visual: honorários × recursos de clientes × reembolsos; despesas próprias × pagamentos de obra
    entradas_por_tipo: { honorarios: sum(ins.filter((r) => r.nature === 'honorarios')), repasse: sum(ins.filter((r) => r.nature === 'repasse')), reembolso: sum(ins.filter((r) => r.nature === 'reembolso')) },
    saidas_por_tipo: { proprias: sum(outs.filter((r) => r.flow !== 'obra')), obra_repasse: sum(outs.filter((r) => r.flow === 'obra' && r.funding === 'repasse')),
      obra_adiantamento: sum(outs.filter((r) => r.flow === 'obra' && r.funding === 'adiantamento')), obra_proprio: sum(outs.filter((r) => r.flow === 'obra' && !['repasse', 'adiantamento'].includes(r.funding))) },
    informados: rows.filter((r) => r.informed_at && !r.realized).length,
  };
  let list;
  if (st === 'realizado') list = realizedIn;
  else if (st === 'aberto') list = openRows;
  else if (st === 'vencido') list = openRows.filter((r) => r.status === 'vencido');
  else if (st === 'informado') list = rows.filter((r) => r.informed_at && !r.realized);
  else list = [...realizedIn, ...openRows];
  list.sort((a, b) => String(b.date || '9999').localeCompare(String(a.date || '9999')));
  return { kpis, rows: list.slice(0, 1000), accounts: all("SELECT name FROM options WHERE kind = 'conta' AND archived = 0 ORDER BY position, name").map((x) => x.name) };
}
function kindOf(r) {
  if (r.tbl === 'incomes') return NATURE[r.nature] || NATURE.honorarios;
  if (r.flow !== 'obra') return 'Despesa do escritório';
  return `Pagamento de obra ${FUNDING[r.funding] || 'pelo escritório'}`;
}

// ---------------------------------------------------------------------
// FINANCEIRO DAS OBRAS
function approvedQuoteIds(projectId) {
  return new Set(all(`SELECT id FROM quotes WHERE project_id = ? AND (status = 'contratado' OR client_selected = 1
      OR id IN (SELECT decided_quote_id FROM approvals WHERE status = 'aprovada' AND decided_quote_id IS NOT NULL))`, projectId).map((q) => q.id));
}
function worksFinance(projectId, { forClient = false } = {}) {
  const p = get('SELECT p.id, p.name, p.code, p.client_id, c.name client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = ?', projectId);
  if (!p) throw new HttpError(404, 'Projeto não encontrado.');
  const approved = approvedQuoteIds(p.id);
  const items = all(`SELECT e.*, s.company supplier_name, q.item quote_item, q.amount quote_amount, q.version quote_version, w.name work_name,
      (SELECT COUNT(*) FROM documents d WHERE d.entity = 'expenses' AND d.entity_id = e.id AND d.archived = 0 ${forClient ? 'AND d.client_visible = 1' : ''}) docs
    FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id LEFT JOIN quotes q ON q.id = e.quote_id LEFT JOIN works w ON w.id = e.work_id
    WHERE e.project_id = ? AND e.flow = 'obra' AND e.status <> 'cancelado' ${forClient ? 'AND e.client_visible = 1' : ''}
    ORDER BY COALESCE(e.quote_id, 0), e.installment_no, e.id`, p.id);
  // agrupa por serviço contratado (orçamento) ou, sem orçamento, por grupo de parcelas / descrição
  const groups = new Map();
  for (const e of items) {
    const key = e.quote_id ? `q${e.quote_id}` : e.group_key ? `g${e.group_key}` : `e${e.split_from ? rootOf(e, items) : e.id}`;
    if (!groups.has(key)) groups.set(key, { key, quote_id: e.quote_id, service: e.quote_item || serviceOf(e), supplier: e.supplier_name || e.payee || null, supplier_id: e.supplier_id, parcels: [] });
    const st = obraStatus(e);
    groups.get(key).parcels.push({ id: e.id, description: e.description, stage: e.stage_label || (e.installment_total > 1 ? `Parcela ${e.installment_no}/${e.installment_total}` : 'Parcela única'),
      amount: e.amount, due_date: e.due_date, due_label: e.due_date ? null : 'Na finalização — data a definir', paid_at: e.paid_at, paid_by: e.status === 'pago' ? e.paid_by : null, planned_payer: e.paid_by,
      payee: e.payee || e.supplier_name || null, status: st.key, status_label: st.label, method: e.method, docs: e.docs, notes: forClient ? null : e.notes, funding: forClient ? null : e.funding,
      informed: e.informed_at ? { at: e.informed_at, amount: e.informed_amount, date: e.informed_date, payer: e.informed_payer, note: e.informed_note, doc_id: e.informed_doc_id } : null, client_visible: e.client_visible, quote_amount: e.quote_amount,
      files: e.docs ? all(`SELECT id, title, file_name, mime FROM documents WHERE entity = 'expenses' AND entity_id = ? AND archived = 0 ${forClient ? 'AND client_visible = 1' : ''} ORDER BY id`, e.id) : [],
      split: !!e.split_from, quote_id: e.quote_id, supplier_id: e.supplier_id });
  }
  const list = [...groups.values()].map((g) => {
    const paid = round2(g.parcels.filter((x) => x.status.startsWith('pago')).reduce((s, x) => s + x.amount, 0));
    const scheduled = round2(g.parcels.reduce((s, x) => s + x.amount, 0));
    const quoteAmt = g.parcels[0] && g.parcels[0].quote_amount;
    const total = round2(quoteAmt > 0 ? Math.max(quoteAmt, scheduled) : scheduled);
    return { ...g, total, paid, remaining: round2(total - paid), unscheduled: round2(Math.max(0, total - scheduled)) };
  });
  // orçamentos aprovados ainda sem parcelas lançadas: compõem os compromissos
  const withItems = new Set(items.map((e) => e.quote_id).filter(Boolean));
  const approvedNoParcels = all(`SELECT q.id, q.item, q.amount, s.company supplier FROM quotes q LEFT JOIN suppliers s ON s.id = q.supplier_id WHERE q.project_id = ? ${forClient ? 'AND q.client_visible = 1' : ''}`, p.id)
    .filter((q) => approved.has(q.id) && !withItems.has(q.id)).map((q) => ({ quote_id: q.id, service: q.item, supplier: q.supplier, total: q.amount > 0 ? q.amount : 0 }));
  // aguardando aprovação: apresentados à parte e NUNCA somados aos compromissos
  const pending = all(`SELECT q.id, q.item, q.amount, q.status, s.company supplier FROM quotes q LEFT JOIN suppliers s ON s.id = q.supplier_id
      WHERE q.project_id = ? AND q.status NOT IN ('recusado','contratado') ${forClient ? 'AND q.client_visible = 1' : ''} ORDER BY q.item, q.amount`, p.id)
    .filter((q) => !approved.has(q.id) && !withItems.has(q.id));
  const open = items.filter((e) => e.status !== 'pago');
  const totals = {
    contratado: round2(list.reduce((s, g) => s + g.total, 0) + approvedNoParcels.reduce((s, q) => s + q.total, 0)),
    pago: round2(list.reduce((s, g) => s + g.paid, 0)),
    pago_cliente: round2(items.filter((e) => e.status === 'pago' && e.paid_by === 'cliente').reduce((s, e) => s + e.amount, 0)),
    pago_escritorio: round2(items.filter((e) => e.status === 'pago' && e.paid_by === 'escritorio').reduce((s, e) => s + e.amount, 0)),
  };
  totals.a_pagar = round2(totals.contratado - totals.pago);
  const overdue = open.filter((e) => e.status === 'vencido').map((e) => ({ id: e.id, description: e.description, amount: e.amount, due_date: e.due_date, supplier: e.supplier_name }));
  const next = open.filter((e) => e.due_date && e.status !== 'vencido').sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 6)
    .map((e) => ({ id: e.id, description: e.description, amount: e.amount, due_date: e.due_date, supplier: e.supplier_name }));
  const out = { project: p, groups: list, approved_without_parcels: approvedNoParcels, pending_quotes: pending.map((q) => ({ ...q, amount: q.amount > 0 ? q.amount : null })), totals, overdue, next };
  if (!forClient) {
    // repasses e adiantamentos do projeto (mesmos registros do caixa)
    const repIn = val("SELECT COALESCE(SUM(amount),0) FROM incomes WHERE project_id = ? AND nature = 'repasse' AND status = 'recebido'", p.id);
    const repOut = val("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE project_id = ? AND paid_by = 'escritorio' AND funding = 'repasse' AND status = 'pago'", p.id);
    const adv = val("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE project_id = ? AND paid_by = 'escritorio' AND funding = 'adiantamento' AND status = 'pago'", p.id);
    const reimb = val("SELECT COALESCE(SUM(amount),0) FROM incomes WHERE project_id = ? AND nature = 'reembolso' AND status = 'recebido'", p.id);
    out.pass_through = { repasse_recebido: round2(repIn), repasse_usado: round2(repOut), repasse_saldo: round2(repIn - repOut), adiantado: round2(adv), reembolsado: round2(reimb), a_reembolsar: round2(adv - reimb) };
    out.informed = items.filter((e) => e.informed_at && e.status !== 'pago').map((e) => ({ id: e.id, description: e.description, amount: e.amount, informed_amount: e.informed_amount, informed_date: e.informed_date, informed_payer: e.informed_payer, informed_note: e.informed_note, doc: e.informed_doc_id }));
  }
  return out;
}
function serviceOf(e) {
  let d = String(e.description || '').replace(/\s*\(saldo\)$/, '').replace(/\s*\(\d+\/\d+\)\s*$/, '');
  if (e.stage_label) d = d.replace(new RegExp(`\\s*\\(${e.stage_label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`), '');
  if (e.supplier_name) d = d.replace(new RegExp(`\\s*—\\s*${e.supplier_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
  return d || e.category || 'Serviço';
}
function rootOf(e, items) { let cur = e; const seen = new Set(); while (cur && cur.split_from && !seen.has(cur.id)) { seen.add(cur.id); const nx = items.find((x) => x.id === cur.split_from); if (!nx) return cur.split_from; cur = nx; } return cur.id; }

// ---------------------------------------------------------------------
// REGISTRAR PAGAMENTO / RECEBIMENTO (com pagamento parcial, sem duplicar)
function registerPayment(user, table, id, b = {}) {
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Lançamento não encontrado.');
  if (row.status === 'cancelado') throw new HttpError(400, 'Lançamento cancelado.');
  if (row.status === PAID[table]) throw new HttpError(409, 'Este lançamento já está registrado como pago. Para corrigir, use “Estornar” e registre novamente.');
  const paidAt = ymd(b.paid_at) || today();
  if (paidAt > today()) throw new HttpError(400, 'A data do pagamento não pode estar no futuro.');
  const amount = round2(b.amount !== undefined && b.amount !== '' ? Number(b.amount) : row.amount);
  if (!(amount > 0)) throw new HttpError(400, 'Informe o valor pago.');
  if (amount > row.amount + 0.009) throw new HttpError(400, `O valor informado é maior que o valor em aberto (${row.amount.toFixed(2)}). Ajuste o valor da parcela antes.`);
  const set = { paid_at: paidAt, status: PAID[table], method: b.method || row.method || null, paid_registered_by: user ? user.id : null, paid_registered_at: nowIso(), updated_at: nowIso() };
  if (table === 'expenses') {
    const payer = b.payer === 'cliente' ? 'cliente' : b.payer === 'escritorio' ? 'escritorio' : row.paid_by;
    set.paid_by = payer;
    if (row.flow === 'obra') {
      set.funding = payer === 'escritorio' ? (['repasse', 'adiantamento', 'proprio'].includes(b.funding) ? b.funding : row.funding || 'adiantamento') : null;
      if (payer === 'escritorio' && set.funding === 'repasse' && b.funding_income_id) set.funding_income_id = Number(b.funding_income_id);
    }
    if (payer === 'escritorio') set.account = b.account || row.account || DEFAULT_ACCOUNT();
    else set.account = null; // pagamento direto do cliente não passa por conta do escritório
    if (b.payee) set.payee = String(b.payee).slice(0, 160);
  } else set.account = b.account || row.account || DEFAULT_ACCOUNT();
  if (b.notes) set.notes = [row.notes, String(b.notes).slice(0, 600)].filter(Boolean).join('\n');
  if (row.informed_at) { set.confirmed_by = user ? user.id : null; set.confirmed_at = nowIso(); }
  set.informed_at = null; set.informed_amount = null; set.informed_date = null; set.informed_payer = null; set.informed_note = null;
  return tx(() => {
    let restId = null;
    if (amount < row.amount - 0.009) {
      // pagamento parcial: o restante continua em aberto como parte da mesma parcela
      const rest = { ...row }; delete rest.id; delete rest.created_at;
      Object.assign(rest, { amount: round2(row.amount - amount), paid_at: null, status: 'a_pagar', split_from: row.id, description: /\(saldo\)$/.test(row.description) ? row.description : `${row.description} (saldo)`,
        informed_at: null, informed_amount: null, informed_date: null, informed_payer: null, informed_note: null, informed_doc_id: null, paid_registered_by: null, paid_registered_at: null, confirmed_by: null, confirmed_at: null, updated_at: nowIso() });
      if (table === 'incomes') rest.status = 'a_receber';
      finance.normalize(table, rest);
      restId = insert(table, rest);
    }
    update(table, row.id, { ...set, amount });
    event(table, row.id, row.informed_at ? 'confirmado' : 'pago', { user, summary: `${table === 'incomes' ? 'Recebimento' : 'Pagamento'} de ${amount.toFixed(2)} em ${paidAt}${table === 'expenses' ? ` — ${set.paid_by === 'cliente' ? 'pago diretamente pelo cliente' : 'pago pelo escritório'}` : ''}${restId ? ` (parcial; restante ${round2(row.amount - amount).toFixed(2)} em aberto)` : ''}`,
      data: { amount, paid_at: paidAt, payer: set.paid_by, funding: set.funding, account: set.account, informed: row.informed_at ? { at: row.informed_at, by: row.informed_by, amount: row.informed_amount, date: row.informed_date } : null, rest_id: restId } });
    return { id: row.id, rest_id: restId };
  });
}

// estorno: desfaz o registro de pagamento com histórico (nada é apagado)
function reversePayment(user, table, id, reason) {
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Lançamento não encontrado.');
  if (row.status !== PAID[table]) throw new HttpError(400, 'Este lançamento não está registrado como pago.');
  if (!String(reason || '').trim()) throw new HttpError(400, 'Informe o motivo do estorno.');
  return tx(() => {
    // se houver saldo aberto gerado deste pagamento parcial, reúne de volta na parcela original
    const rest = get(`SELECT * FROM ${table} WHERE split_from = ? AND status NOT IN ('cancelado', ?) ORDER BY id DESC`, row.id, PAID[table]);
    let amount = row.amount;
    if (rest) { amount = round2(row.amount + rest.amount); update(table, rest.id, { status: 'cancelado', notes: [rest.notes, `Reunido à parcela original no estorno de ${today()}.`].filter(Boolean).join('\n'), updated_at: nowIso() }); event(table, rest.id, 'reunido', { user, summary: 'Saldo reunido à parcela original após estorno', reason }); }
    const d = { amount, paid_at: null, status: table === 'incomes' ? 'a_receber' : 'a_pagar', updated_at: nowIso(), paid_registered_by: null, paid_registered_at: null };
    finance.normalize(table, d, row);
    update(table, row.id, d);
    event(table, row.id, 'estornado', { user, summary: `Registro de ${table === 'incomes' ? 'recebimento' : 'pagamento'} de ${row.amount.toFixed(2)} em ${row.paid_at} estornado`, reason, data: { previous: { amount: row.amount, paid_at: row.paid_at, paid_by: row.paid_by, account: row.account } } });
    return { id: row.id };
  });
}

// cliente informa um pagamento (fica aguardando conferência; não marca como pago)
function informPayment(clientUser, table, id, b = {}, docId = null) {
  const row = table === 'incomes'
    ? get('SELECT i.* FROM incomes i WHERE i.id = ? AND i.client_id = ?', id, clientUser.client_id)
    : get("SELECT e.* FROM expenses e JOIN projects p ON p.id = e.project_id WHERE e.id = ? AND p.client_id = ? AND e.flow = 'obra' AND e.client_visible = 1", id, clientUser.client_id);
  if (!row || row.status === 'cancelado') throw new HttpError(404, 'Parcela não encontrada.');
  if (row.status === PAID[table]) throw new HttpError(409, 'Esta parcela já consta como paga.');
  if (row.informed_at) throw new HttpError(409, 'Este pagamento já foi informado e está aguardando conferência do escritório.');
  const date = ymd(b.date) || today(); if (date > today()) throw new HttpError(400, 'A data do pagamento não pode estar no futuro.');
  const amount = round2(Number(b.amount) || row.amount);
  if (amount > row.amount + 0.009) throw new HttpError(400, 'O valor informado é maior que o valor da parcela.');
  update(table, row.id, { informed_at: nowIso(), informed_by: clientUser.id, informed_amount: amount, informed_date: date, informed_payer: table === 'incomes' ? 'cliente' : (b.payer === 'escritorio' ? 'escritorio' : 'cliente'), informed_note: b.note ? String(b.note).slice(0, 500) : null, informed_doc_id: docId, updated_at: nowIso() });
  event(table, row.id, 'informado', { actor: 'cliente', user: clientUser, summary: `Cliente informou pagamento de ${amount.toFixed(2)} em ${date}`, data: { amount, date, doc: docId } });
  const automation = require('./automation');
  const p = row.project_id ? get('SELECT name, manager_id FROM projects WHERE id = ?', row.project_id) : null;
  new Set([...(automation.financeUsers ? automation.financeUsers() : []), p && p.manager_id].filter(Boolean)).forEach((uid) => automation.notify(uid, {
    kind: 'pagamento_informado', severity: 'warning', title: 'Pagamento informado pelo cliente — conferir', body: `${row.description} · ${amount.toFixed(2)}${p ? ' · ' + p.name : ''}`,
    link: table === 'incomes' ? `#/financeiro/caixa?status=informado` : `#/financeiro/obras?projeto=${row.project_id}`, key: `inf_${table}_${row.id}_${Date.now()}` }));
  return { ok: true };
}
function rejectInformed(user, table, id, reason) {
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row || !row.informed_at) throw new HttpError(400, 'Não há pagamento informado para conferir.');
  if (!String(reason || '').trim()) throw new HttpError(400, 'Informe o motivo.');
  update(table, row.id, { informed_at: null, informed_amount: null, informed_date: null, informed_payer: null, informed_note: null, updated_at: nowIso() });
  event(table, row.id, 'informe_recusado', { user, summary: 'Pagamento informado pelo cliente não confirmado na conferência', reason });
}

// ---------------------------------------------------------------------
// CONFERÊNCIA DOS LANÇAMENTOS ANTIGOS
// Despesas do escritório com sinais de serem pagamentos de obra (orçamento, obra ou fornecedor ligados a um projeto).
// Nada é presumido: quem pagou fica "a conferir" até a decisão.
function reviewCandidates() {
  const exp = all(`SELECT e.*, s.company supplier_name, p.name project_name, w.name work_name, q.item quote_item,
      (SELECT COUNT(*) FROM documents d WHERE d.entity = 'expenses' AND d.entity_id = e.id AND d.archived = 0) docs
    FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN works w ON w.id = e.work_id LEFT JOIN quotes q ON q.id = e.quote_id
    WHERE e.flow = 'escritorio' AND e.paid_by = 'escritorio' AND e.status <> 'cancelado'
      AND (e.quote_id IS NOT NULL OR e.work_id IS NOT NULL OR (e.project_id IS NOT NULL AND COALESCE(e.category,'') IN ('Obra','Material','Mão de obra','Marcenaria','Fornecedores')))
      AND NOT EXISTS (SELECT 1 FROM finance_events f WHERE f.table_name = 'expenses' AND f.record_id = e.id AND f.action IN ('reclassificado','revisado'))
    ORDER BY COALESCE(e.paid_at, e.due_date) DESC`).map((e) => {
    const ev = [];
    if (e.quote_id) ev.push(`gerada ao contratar o orçamento “${e.quote_item}”`);
    if (e.work_id) ev.push(`lançada na obra “${e.work_name}”`);
    if (e.supplier_name && e.project_id) ev.push(`fornecedor ${e.supplier_name} no projeto ${e.project_name}`);
    if (['Obra', 'Material'].includes(e.category)) ev.push(`categoria “${e.category}”`);
    const rep = e.project_id ? val("SELECT COALESCE(SUM(amount),0) FROM incomes WHERE project_id = ? AND (nature = 'repasse' OR lower(COALESCE(category,'')||description) LIKE '%repasse%')", e.project_id) : 0;
    return { table: 'expenses', id: e.id, date: e.paid_at || e.due_date, description: e.description, supplier: e.supplier_name, project: e.project_name, amount: e.amount, status: e.status, docs: e.docs,
      current: 'Despesa do escritório (sai do caixa)', proposed: 'Item da obra — quem pagou: a conferir', evidence: ev,
      hint: rep > 0 ? 'Há recurso de cliente para repasse neste projeto: pode ter sido pago pelo escritório com esse recurso.' : 'Sem registro de repasse neste projeto: verifique se o cliente pagou diretamente ao fornecedor.' };
  });
  const inc = all(`SELECT i.*, c.name client_name, p.name project_name FROM incomes i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.nature = 'honorarios' AND i.status <> 'cancelado' AND (lower(COALESCE(i.category,'') || ' ' || i.description) LIKE '%repasse%' OR lower(COALESCE(i.category,'') || ' ' || i.description) LIKE '%reembolso%')
      AND NOT EXISTS (SELECT 1 FROM finance_events f WHERE f.table_name = 'incomes' AND f.record_id = i.id AND f.action IN ('reclassificado','revisado'))`).map((i) => {
    const isR = /reembolso/i.test(`${i.category} ${i.description}`);
    return { table: 'incomes', id: i.id, date: i.paid_at || i.due_date, description: i.description, client: i.client_name, project: i.project_name, amount: i.amount, status: i.status,
      current: 'Honorários e receitas próprias', proposed: isR ? NATURE.reembolso : NATURE.repasse, proposed_value: isR ? 'reembolso' : 'repasse', evidence: [`categoria/descrição menciona “${isR ? 'reembolso' : 'repasse'}”`] };
  });
  return { expenses: exp, incomes: inc };
}
// decisões: expenses → cliente | escritorio_repasse | escritorio_adiantamento | escritorio_proprio | manter
//           incomes  → repasse | reembolso | manter
function applyReview(user, decisions, backupFile) {
  const done = [];
  tx(() => {
    for (const d of decisions || []) {
      const table = d.table === 'incomes' ? 'incomes' : 'expenses';
      const row = get(`SELECT * FROM ${table} WHERE id = ?`, Number(d.id)); if (!row) continue;
      let set = null; let summary = '';
      if (d.decision === 'manter') { event(table, row.id, 'revisado', { user, summary: 'Conferido: classificação mantida', reason: d.note, data: { backup: backupFile } }); done.push({ ...d, ok: true }); continue; }
      if (table === 'expenses') {
        if (d.decision === 'cliente') { set = { flow: 'obra', paid_by: 'cliente', funding: null, account: null }; summary = 'Reclassificado: item da obra pago diretamente pelo cliente (sai do caixa do escritório)'; }
        else if (/^escritorio_(repasse|adiantamento|proprio)$/.test(d.decision)) { const f = d.decision.split('_')[1]; set = { flow: 'obra', paid_by: 'escritorio', funding: f }; summary = `Reclassificado: item da obra pago pelo escritório ${FUNDING[f]}`; }
      } else if (['repasse', 'reembolso'].includes(d.decision)) { set = { nature: d.decision }; summary = `Reclassificado: ${NATURE[d.decision]}`; }
      if (!set) continue;
      const before = Object.fromEntries(Object.keys(set).map((k) => [k, row[k]]));
      update(table, row.id, { ...set, updated_at: nowIso() }); // valores, datas, comprovantes e histórico preservados
      event(table, row.id, 'reclassificado', { user, summary, reason: d.note, data: { before, after: set, backup: backupFile } });
      done.push({ ...d, ok: true });
    }
  });
  return done;
}

// ---------------------------------------------------------------------
// LANÇAR ITEM DA OBRA (serviço/fornecedor) em parcela única, N parcelas ou etapas
// stages: [{ label, amount | percent, due_date | null }]  — sem data = "na finalização, data a definir"
function createObraItems(user, b = {}) {
  const projectId = Number(b.project_id) || (b.work_id ? (get('SELECT project_id FROM works WHERE id = ?', Number(b.work_id)) || {}).project_id : null);
  if (!projectId) throw new HttpError(400, 'Escolha o projeto/obra.');
  const q = b.quote_id ? get('SELECT q.*, s.company supplier_name FROM quotes q LEFT JOIN suppliers s ON s.id = q.supplier_id WHERE q.id = ?', Number(b.quote_id)) : null;
  const supplierId = Number(b.supplier_id) || (q && q.supplier_id) || null;
  const supplier = supplierId ? (get('SELECT company FROM suppliers WHERE id = ?', supplierId) || {}).company : null;
  const service = String(b.service || b.description || (q && q.item) || '').trim();
  if (!service) throw new HttpError(400, 'Informe o serviço.');
  const total = round2(Number(b.total) || (q && q.amount) || 0);
  if (!(total > 0)) throw new HttpError(400, 'Informe o valor total contratado.');
  const payer = b.paid_by === 'escritorio' ? 'escritorio' : 'cliente';
  const funding = payer === 'escritorio' ? (['repasse', 'adiantamento', 'proprio'].includes(b.funding) ? b.funding : 'adiantamento') : null;
  let stages = [];
  if (b.mode === 'etapas' && Array.isArray(b.stages) && b.stages.length) {
    stages = b.stages.map((s) => ({ label: String(s.label || '').trim() || 'Etapa', amount: s.amount !== undefined && s.amount !== '' ? round2(Number(s.amount)) : round2(total * (Number(s.percent) || 0) / 100), due: ymd(s.due_date) }));
    const sum = round2(stages.reduce((a, s) => a + s.amount, 0));
    if (Math.abs(sum - total) > 0.05) throw new HttpError(400, `A soma das etapas (${sum.toFixed(2)}) é diferente do total (${total.toFixed(2)}).`);
  } else {
    const n = b.mode === 'parcelas' ? Math.max(1, Math.min(60, parseInt(b.count, 10) || 1)) : 1;
    const { splitAmount, addMonths } = require('../util');
    const first = ymd(b.first_due);
    const parts = splitAmount(total, n);
    stages = parts.map((amount, i) => ({ label: n > 1 ? (i === 0 ? 'Entrada' : `Parcela ${i + 1}/${n}`) : 'Parcela única', amount, due: first ? addMonths(first, i * (parseInt(b.interval, 10) || 1), Number(first.slice(8, 10))) : null }));
    if (n > 1) stages[0].label = b.first_label || `Parcela 1/${n}`;
  }
  const group = require('crypto').randomBytes(6).toString('hex');
  const ids = tx(() => stages.map((s, i) => {
    const row = { flow: 'obra', paid_by: payer, funding, project_id: projectId, work_id: b.work_id ? Number(b.work_id) : (q && q.work_id) || null, quote_id: q ? q.id : null,
      supplier_id: supplierId, category: b.category || 'Obra', description: `${service}${supplier ? ' — ' + supplier : ''}${stages.length > 1 ? ` (${s.label})` : ''}`,
      amount: s.amount, due_date: s.due, stage_label: s.label, installment_no: i + 1, installment_total: stages.length, group_key: stages.length > 1 ? group : null,
      client_visible: b.client_visible === 0 || b.client_visible === '0' ? 0 : 1, method: b.method || null, responsible_id: user ? user.id : null, created_by: user ? user.id : null, status: 'a_pagar', notes: b.notes || null };
    finance.normalize('expenses', row);
    const id = insert('expenses', row);
    event('expenses', id, 'criado', { user, summary: `Item da obra lançado: ${row.description} · ${s.amount.toFixed(2)}${s.due ? ' · vence ' + s.due : ' · na finalização (data a definir)'} · ${payer === 'cliente' ? 'cliente paga direto ao fornecedor' : 'escritório paga ' + FUNDING[funding]}` });
    return id;
  }));
  if (q && q.status !== 'contratado') run("UPDATE quotes SET status = 'contratado' WHERE id = ?", q.id);
  return ids;
}

// lista de projetos com movimento de obra (para o seletor)
function worksList() {
  return all(`SELECT p.id, p.name, p.code, p.status, c.name client_name, c.id client_id,
      (SELECT COUNT(*) FROM expenses e WHERE e.project_id = p.id AND e.flow = 'obra' AND e.status <> 'cancelado') items,
      (SELECT COALESCE(SUM(amount),0) FROM expenses e WHERE e.project_id = p.id AND e.flow = 'obra' AND e.status = 'pago') pago,
      (SELECT COALESCE(SUM(amount),0) FROM expenses e WHERE e.project_id = p.id AND e.flow = 'obra' AND e.status IN ('previsto','a_pagar','vencido')) aberto,
      (SELECT COUNT(*) FROM expenses e WHERE e.project_id = p.id AND e.flow = 'obra' AND e.status = 'vencido') vencidas,
      (SELECT COUNT(*) FROM expenses e WHERE e.project_id = p.id AND e.flow = 'obra' AND e.informed_at IS NOT NULL AND e.status <> 'pago') informados,
      (SELECT COUNT(*) FROM quotes q WHERE q.project_id = p.id) quotes
    FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.status <> 'cancelado'
    ORDER BY (items > 0) DESC, p.archived, p.status = 'encerrado', p.name`).map((r) => ({ ...r, pago: round2(r.pago), aberto: round2(r.aberto) }));
}

// fila de pagamentos informados pelos clientes (aguardando conferência)
function informedQueue() {
  const inc = all(`SELECT 'incomes' tbl, i.id, i.description, i.amount, i.informed_at, i.informed_amount, i.informed_date, i.informed_note, i.informed_doc_id, i.nature, c.name client_name, p.name project_name, i.project_id, u.name informed_by_name
    FROM incomes i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN projects p ON p.id = i.project_id LEFT JOIN users u ON u.id = i.informed_by WHERE i.informed_at IS NOT NULL AND i.status NOT IN ('recebido','cancelado')`);
  const exp = all(`SELECT 'expenses' tbl, e.id, e.description, e.amount, e.informed_at, e.informed_amount, e.informed_date, e.informed_note, e.informed_doc_id, e.informed_payer, c.name client_name, p.name project_name, e.project_id, u.name informed_by_name, s.company supplier_name
    FROM expenses e LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = e.informed_by LEFT JOIN suppliers s ON s.id = e.supplier_id
    WHERE e.informed_at IS NOT NULL AND e.status NOT IN ('pago','cancelado')`);
  return [...inc, ...exp].sort((a, b) => String(a.informed_at).localeCompare(String(b.informed_at)));
}

module.exports = { createObraItems, worksList, informedQueue, NATURE, FUNDING, DEFAULT_ACCOUNT, cashMovements, worksFinance, registerPayment, reversePayment, informPayment, rejectInformed, reviewCandidates, applyReview, history, event, obraStatus };
