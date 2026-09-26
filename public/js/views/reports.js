import { S, api, html, el, toHTML, icon, money, moneyShort, pct, num, date, monthLabel, label, table, exportCSV, csvMoney, $$ } from '../lib.js';
import { barChart, lineChart, donut, hbars } from '../charts.js';

export default async function (ctx) {
  const root = ctx.root;
  const year = Number(ctx.query.ano) || new Date().getFullYear();
  const r = await api.get(`/reports?year=${year}`);
  const years = []; for (let y = new Date().getFullYear() + 1; y >= new Date().getFullYear() - 5; y--) years.push(y);
  const sec = ctx.query.sec || (r.finance ? 'financeiro' : 'projetos');
  const secs = [r.finance ? ['financeiro', 'Financeiro'] : null, r.finance ? ['rentabilidade', 'Rentabilidade'] : null, ['projetos', 'Projetos'], ['comercial', 'Comercial'], ['clientes', 'Clientes'], ['equipe', 'Equipe']].filter(Boolean);
  root.innerHTML = toHTML(html`<div class="page-head"><div><h1>Relatórios</h1><div class="sub">Indicadores automáticos do escritório — ${year}</div></div>
    <div class="row"><select class="input" data-year style="width:auto">${years.map((y) => html`<option ${y === year ? 'selected' : ''}>${y}</option>`)}</select><button class="btn" data-print>${icon('print')} Imprimir / PDF</button></div></div>
    <div class="tabs">${secs.map(([k, l]) => html`<button data-s="${k}" class="${k === sec ? 'on' : ''}">${l}</button>`)}</div><div data-body></div>`);
  root.querySelector('[data-year]').onchange = (e) => ctx.go(`#/relatorios?ano=${e.target.value}&sec=${sec}`);
  root.querySelector('[data-print]').onclick = () => window.print();
  const body = root.querySelector('[data-body]');
  const show = (k) => { $$('[data-s]', root).forEach((b) => b.classList.toggle('on', b.dataset.s === k)); body.innerHTML = ''; R[k](body, r, year); history.replaceState(null, '', `#/relatorios?ano=${year}&sec=${k}`); };
  root.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) show(b.dataset.s); };
  if (!r.projects && !r.finance) { body.innerHTML = '<div class="empty">Relatórios disponíveis para gestores e administradores.</div>'; return; }
  show(secs.find((s) => s[0] === sec) ? sec : secs[0][0]);
}

const kpi = (l, v, f, cls = '') => html`<div class="card kpi ${cls}"><span class="label">${l}</span><span class="value">${v}</span>${f ? html`<span class="foot">${f}</span>` : ''}</div>`;
const card = (t, id, extra = '') => html`<div class="card ${extra}"><div class="card-head"><h3>${t}</h3></div><div data-x="${id}"></div></div>`;
const put = (body, id, node) => body.querySelector(`[data-x="${id}"]`).appendChild(node);

const R = {
  financeiro(body, r, year) {
    const f = r.finance;
    body.appendChild(el(html`<div><div class="grid g4">${kpi('Faturamento ' + year, money(f.total_revenue), 'recebido no ano')}${kpi('Despesas ' + year, money(f.total_expenses), 'pagas pelo escritório')}
      ${kpi('Lucro', money(f.profit), f.margin !== null ? `margem ${pct(f.margin)}` : '', f.profit < 0 ? 'alert' : '')}${kpi('Inadimplência', money(f.overdue_total), `${pct(f.default_rate)} dos vencimentos do período`, f.overdue_total ? 'alert' : '')}</div>
      <div class="grid g3 mt-16">${card('Faturamento, despesas e lucro por mês', 'm', 'span2')}${card('Faturamento anual', 'y')}
      ${card('Receitas por categoria', 'rc')}${card('Despesas por categoria', 'ec')}${card('Contas a receber por mês', 'ar')}
      ${card('Inadimplência por atraso', 'ag')}${card('Parcelas vencidas', 'ol', 'span2')}</div>
      <div class="section-title">Fluxo de caixa</div><div class="grid g4">${f.cashflow.horizons.map((h) => kpi(`Saldo projetado em ${h.months} meses`, money(h.saldo), `+ ${money(h.entradas)} · − ${money(h.saidas)}`))}${kpi('Saldo atual', money(f.cashflow.balance))}</div>
      <div class="row between mt-24 mb-8"><h3>Resumo mensal</h3><button class="btn sm" data-csv>${icon('download', 'sm')} CSV</button></div><div data-x="t"></div></div>`));
    put(body, 'm', barChart({ labels: f.monthly.map((m) => monthLabel(m.month)), series: [{ name: 'Faturamento', values: f.monthly.map((m) => m.revenue), color: '#111' }, { name: 'Despesas', values: f.monthly.map((m) => m.expenses), color: '#b9a489' }, { name: 'Lucro', values: f.monthly.map((m) => m.profit), color: '#5f7a6e' }] }));
    put(body, 'y', f.yearly.length ? barChart({ labels: f.yearly.map((y) => y.label), series: [{ name: 'Faturamento', values: f.yearly.map((y) => y.value) }], height: 200 }) : el('<div class="empty sm">Sem dados.</div>'));
    put(body, 'rc', f.revenue_by_category.length ? donut({ items: f.revenue_by_category, center: moneyShort(f.total_revenue).replace('R$ ', ''), size: 140 }) : el('<div class="empty sm">Sem dados.</div>'));
    put(body, 'ec', f.expenses_by_category.length ? donut({ items: f.expenses_by_category.slice(0, 8), center: moneyShort(f.total_expenses).replace('R$ ', ''), size: 140 }) : el('<div class="empty sm">Sem dados.</div>'));
    put(body, 'ar', hbars(f.receivables_next.map((x) => ({ label: monthLabel(x.label, true), value: x.value }))));
    put(body, 'ag', hbars(f.aging.map((x) => ({ label: `${x.label} dias`, value: x.value, color: '#b0473b' }))));
    put(body, 'ol', table({ rows: f.overdue_list, cls: 'compact', empty: 'Nenhuma parcela vencida.', onRow: (x) => (location.hash = `#/financeiro/entradas?id=${x.id}`), columns: [
      { key: 'client_name', label: 'Cliente' }, { key: 'description', label: 'Descrição' }, { key: 'due_date', label: 'Vencimento', render: (x) => html`<span class="late">${date(x.due_date)}</span>` }, { key: 'amount', label: 'Valor', align: 'right', render: (x) => money(x.amount) }] }));
    const cols = [{ key: 'month', label: 'Mês', render: (m) => monthLabel(m.month, true), csv: (m) => m.month }, { key: 'revenue', label: 'Faturamento', align: 'right', render: (m) => money(m.revenue), csv: (m) => csvMoney(m.revenue) },
      { key: 'expenses', label: 'Despesas', align: 'right', render: (m) => money(m.expenses), csv: (m) => csvMoney(m.expenses) }, { key: 'profit', label: 'Lucro', align: 'right', render: (m) => html`<span class="${m.profit < 0 ? 'danger-text' : ''}">${money(m.profit)}</span>`, csv: (m) => csvMoney(m.profit) }];
    put(body, 't', table({ rows: f.monthly, columns: cols, cls: 'compact', foot: html`<td>Total</td><td class="right">${money(f.total_revenue)}</td><td class="right">${money(f.total_expenses)}</td><td class="right">${money(f.profit)}</td>` }));
    body.querySelector('[data-csv]').onclick = () => exportCSV(`financeiro-${year}`, cols, f.monthly);
  },
  rentabilidade(body, r) {
    const rows = r.finance.profitability;
    const cols = [
      { key: 'name', label: 'Projeto', render: (p) => html`<div class="cell-title">${p.name}</div><div class="cell-sub">${label('PROJECT_STATUS', p.status)}</div>` },
      { key: 'contracted', label: 'Contratado', align: 'right', render: (p) => money(p.contracted), csv: (p) => csvMoney(p.contracted) },
      { key: 'direct_costs', label: 'Despesas', align: 'right', render: (p) => money(p.direct_costs), csv: (p) => csvMoney(p.direct_costs) },
      { key: 'work_costs', label: 'Custos de obra', align: 'right', render: (p) => money(p.work_costs), csv: (p) => csvMoney(p.work_costs) },
      { key: 'hours_cost', label: 'Horas', align: 'right', render: (p) => html`${money(p.hours_cost)}<div class="cell-sub">${num(p.hours, 1)} h</div>`, csv: (p) => csvMoney(p.hours_cost) },
      { key: 'result', label: 'Resultado', align: 'right', render: (p) => html`<b class="${p.result < 0 ? 'danger-text' : ''}">${money(p.result)}</b>`, csv: (p) => csvMoney(p.result) },
      { key: 'margin', label: 'Margem', align: 'right', render: (p) => html`<span class="${p.margin < 0 ? 'danger-text' : p.margin >= 50 ? 'success-text' : ''}">${pct(p.margin)}</span>`, csv: (p) => p.margin },
      { key: 'received', label: 'Recebido', align: 'right', render: (p) => money(p.received), csv: (p) => csvMoney(p.received) }];
    body.appendChild(el(html`<div><div class="row between mb-16"><p class="muted small" style="margin:0">Resultado = valor contratado − despesas do projeto − custos de obra pagos pelo escritório − custo das horas da equipe.</p><button class="btn sm" data-csv>${icon('download', 'sm')} CSV</button></div><div data-x="t"></div></div>`));
    put(body, 't', table({ rows, columns: cols, onRow: (p) => (location.hash = `#/projetos/${p.project_id}?tab=financeiro`), empty: 'Nenhum projeto com valores.' }));
    body.querySelector('[data-csv]').onclick = () => exportCSV('rentabilidade-projetos', cols, rows);
  },
  projetos(body, r) {
    const p = r.projects;
    body.appendChild(el(html`<div><div class="grid g6">${kpi('Projetos (total)', p.total)}${kpi('Ativos', p.active)}${kpi('Concluídos', p.closed, `${p.closed_in_period} no período`)}${kpi('Atrasados', p.late, '', p.late ? 'alert' : '')}${kpi('Prazo médio de execução', p.avg_days !== null ? `${p.avg_days} dias` : '—')}${kpi('Entregues no prazo', pct(p.on_time_rate))}</div>
      <div class="grid g3 mt-16">${card('Por tipo', 'ty')}${card('Por status', 'st')}${card('Novos no período', 'np')}${card('Projetos atrasados', 'lt', 'span3')}</div></div>`));
    put(body, 'ty', donut({ items: p.by_type, format: (v) => v, size: 140 }));
    put(body, 'st', hbars(p.by_status.map((x) => ({ label: label('PROJECT_STATUS', x.label), value: x.value })), { format: (v) => v }));
    put(body, 'np', el(html`<div><div class="serif" style="font-size:44px">${p.started_in_period}</div><div class="small muted">projetos iniciados · ${num(p.area_total)} m² projetados no total</div></div>`));
    put(body, 'lt', table({ rows: p.late_list, cls: 'compact', empty: 'Nenhum projeto atrasado.', onRow: (x) => (location.hash = '#/projetos/' + x.id), columns: [{ key: 'name', label: 'Projeto' }, { key: 'client_name', label: 'Cliente' }, { key: 'due_date', label: 'Prazo', render: (x) => html`<span class="late">${date(x.due_date)}</span>` }, { key: 'progress', label: 'Andamento', render: (x) => `${x.progress}%` }] }));
  },
  comercial(body, r) {
    const c = r.commercial;
    body.appendChild(el(html`<div><div class="grid g6">${kpi('Propostas enviadas', c.sent)}${kpi('Aprovadas', c.approved, money(c.approved_value))}${kpi('Recusadas', c.refused)}${kpi('Taxa de conversão', pct(c.conversion), `em contratos: ${pct(c.conversion_contracts)}`)}${kpi('Ticket médio', money(c.ticket), 'por contrato')}${kpi('Em negociação', money(c.pipeline_value), `${c.open} proposta(s)`)}</div>
      <div class="grid g3 mt-16">${card('Propostas por status', 'st')}${card('Conversão por origem do cliente', 'or')}${card('Motivos de recusa', 'rf')}</div>
      ${c.avg_decision_days !== null ? html`<p class="small muted mt-16">Tempo médio entre envio e decisão: <b>${c.avg_decision_days} dias</b>.</p>` : ''}</div>`));
    put(body, 'st', hbars(c.by_status.map((x) => ({ label: label('PROPOSAL_STATUS', x.label), value: x.value })), { format: (v) => v }));
    put(body, 'or', hbars(c.by_origin.map((x) => ({ label: x.label, value: x.value, extra: `${x.approved} aprovada(s)` })), { format: (v) => `${v}` }));
    put(body, 'rf', hbars(c.refusal_reasons, { format: (v) => v, color: '#b0473b' }));
  },
  clientes(body, r) {
    const c = r.clients;
    body.appendChild(el(html`<div><div class="grid g4">${kpi('Clientes ativos', c.total)}${kpi('Novos no período', c.new_in_period)}${kpi('Clientes recorrentes', c.recurring, 'mais de um projeto')}${c.revenue ? kpi('Maior faturamento', c.revenue[0] ? c.revenue[0].label : '—', c.revenue[0] ? money(c.revenue[0].value) : '') : ''}</div>
      <div class="grid g3 mt-16">${card('Novos clientes por mês', 'nm', 'span2')}${card('Origem dos clientes', 'or')}${c.revenue ? card('Faturamento por cliente', 'rv', 'span2') : ''}${card('Clientes recorrentes', 'rc')}</div></div>`));
    put(body, 'nm', barChart({ labels: c.new_by_month.map((m) => monthLabel(m.label)), series: [{ name: 'Novos clientes', values: c.new_by_month.map((m) => m.value) }], format: (v) => Math.round(v), fullFormat: (v) => v, height: 200 }));
    put(body, 'or', donut({ items: c.by_origin, format: (v) => v, size: 140 }));
    if (c.revenue) put(body, 'rv', hbars(c.revenue));
    put(body, 'rc', c.recurring_list.length ? el(html`<div class="list">${c.recurring_list.map((x) => html`<a class="list-item" href="#/clientes/${x.id}"><div class="grow li-title">${x.name}</div><span class="small muted">${x.projects} projetos</span></a>`)}</div>`) : el('<div class="empty sm">Nenhum cliente recorrente.</div>'));
  },
  equipe(body, r) {
    const t = r.team;
    body.appendChild(el(html`<div class="grid g2">${card('Tarefas concluídas no período', 'td')}${card('Tarefas em aberto', 'to')}${card('Horas lançadas por pessoa', 'hp')}${card('Horas por projeto', 'hj')}</div>`));
    put(body, 'td', hbars(t.tasks_done, { format: (v) => v }));
    put(body, 'to', hbars(t.tasks_open.map((x) => ({ ...x, extra: x.late ? `${x.late} atrasada(s)` : '' })), { format: (v) => v }));
    put(body, 'hp', hbars(t.hours, { format: (v) => `${num(v, 1)} h` }));
    put(body, 'hj', hbars(t.hours_by_project, { format: (v) => `${num(v, 1)} h` }));
  },
};
