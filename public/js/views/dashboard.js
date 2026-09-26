import { S, api, html, el, toHTML, icon, money, moneyShort, date, dateShort, monthLabel, relDay, time, label, badge, prio, can, isManager, monShort, today, esc } from '../lib.js';
import { barChart, lineChart, donut, hbars, PALETTE } from '../charts.js';

export default async function ({ root }) {
  const d = await api.get('/dashboard');
  const f = d.finance;
  const c = d.counts;
  const h = new Date().getHours();
  const greet = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const first = S.user.name.split(' ')[0];
  const fullDate = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const todayEvents = d.events.filter((e) => e.start_at.slice(0, 10) === d.today);

  const kpi = (lbl, value, foot, link, cls = '') => html`<a class="card kpi ${cls}" href="${link || '#/'}"><span class="label">${lbl}</span><span class="value ${String(value).length > 11 ? 'sm' : ''}">${value}</span>${foot ? html`<span class="foot">${foot}</span>` : ''}</a>`;

  root.innerHTML = toHTML(html`
    <div class="page-head"><div><div class="eyebrow">${fullDate}</div><h1 class="mt-8">${greet}, ${first}.</h1></div>
      <div class="row desktop-only"><a class="btn" href="#/agenda">${icon('calendar')} Agenda</a><a class="btn" href="#/tarefas?view=minhas">${icon('tasks')} Minhas tarefas</a></div></div>

    <div class="mobile-only"><div class="eyebrow mb-8">Resumo de hoje</div>
      <div class="grid g6 mb-16">
        ${kpi('Tarefas p/ hoje', c.tasks_today, c.tasks_late ? html`<span class="danger-text">${c.tasks_late} atrasada(s)</span>` : 'em dia', '#/tarefas?view=hoje')}
        ${kpi('Compromissos hoje', todayEvents.length, todayEvents[0] ? `${time(todayEvents[0].start_at)} ${todayEvents[0].title}` : 'agenda livre', '#/agenda')}
        ${f ? kpi('Pagamentos (7 dias)', f.due_soon.count, money(f.due_soon.amount), '#/financeiro/saidas?preset=abertas') : ''}
        ${kpi('Projetos ativos', c.projects_active, c.projects_late ? html`<span class="danger-text">${c.projects_late} atrasado(s)</span>` : '', '#/projetos')}
      </div></div>

    <div class="attention mb-24"><div class="attention-head"><h3>Atenção hoje</h3><span class="small muted">${d.attention.length ? `${d.attention.length} ${d.attention.length === 1 ? 'item' : 'itens'}` : ''}</span></div>
      ${d.attention.length ? html`<div class="attention-grid">${d.attention.slice(0, 18).map((a) => html`<a class="att" href="${a.link}"><span class="sev ${a.severity}"></span><div style="min-width:0"><div class="t">${a.type}</div><div class="h">${a.title}</div><div class="d">${a.detail}</div></div></a>`)}</div>`
        : html`<div class="empty sm">${icon('check')}<div>Tudo em ordem por hoje. Nenhuma pendência urgente.</div></div>`}</div>

    ${f ? html`<div class="section-title">Financeiro</div>
    <div class="grid g6">
      ${kpi('Saldo atual', money(f.balance), 'em caixa', '#/financeiro', f.balance < 0 ? 'alert' : '')}
      ${kpi('Recebido no mês', money(f.received_month), '', '#/financeiro/entradas?preset=recebidas')}
      ${kpi('A receber no mês', money(f.receivable_month), '', '#/financeiro/entradas?preset=mes')}
      ${kpi('Despesas do mês', money(f.expenses_month), `${money(f.expenses_paid_month)} pagos`, '#/financeiro/saidas?preset=mes')}
      ${kpi('Contas vencidas', f.overdue_in.count + f.overdue_out.count, html`${f.overdue_in.count ? html`<span class="danger-text">${money(f.overdue_in.amount)} a receber</span>` : ''}${f.overdue_in.count && f.overdue_out.count ? ' · ' : ''}${f.overdue_out.count ? `${money(f.overdue_out.amount)} a pagar` : ''}${!f.overdue_in.count && !f.overdue_out.count ? 'nenhuma' : ''}`, '#/financeiro/entradas?preset=vencidas', f.overdue_in.count + f.overdue_out.count ? 'alert' : '')}
      ${kpi('Vencem em 7 dias', f.due_soon.count, money(f.due_soon.amount), '#/financeiro/saidas?preset=abertas')}
    </div>` : ''}

    <div class="section-title">Escritório</div>
    <div class="grid g6">
      ${kpi('Projetos ativos', c.projects_active, c.projects_late ? html`<span class="danger-text">${c.projects_late} com prazo vencido</span>` : 'dentro do prazo', '#/projetos')}
      ${can('obras') ? kpi('Obras em andamento', c.works_active, '', '#/obras') : ''}
      ${kpi('Tarefas pendentes', c.tasks_pending, isManager() ? 'de toda a equipe' : 'suas', '#/tarefas?view=abertas')}
      ${kpi('Tarefas atrasadas', c.tasks_late, '', '#/tarefas?view=atrasadas', c.tasks_late ? 'alert' : '')}
      ${c.proposals_waiting !== null ? kpi('Propostas aguardando', c.proposals_waiting, money(c.proposals_waiting_value), '#/propostas?preset=aguardando') : ''}
      ${c.contracts_waiting !== null ? kpi('Contratos p/ assinatura', c.contracts_waiting, '', '#/contratos?preset=aguardando') : ''}
    </div>

    ${f ? html`<div class="grid g3 mt-24">
      <div class="card span2"><div class="card-head"><h3>Entradas × saídas por mês</h3><a class="link" href="#/financeiro/fluxo">Fluxo de caixa →</a></div><div id="c-io"></div></div>
      <div class="card"><div class="card-head"><h3>Previsão financeira</h3></div><div id="c-fc"></div></div>
      <div class="card span2"><div class="card-head"><h3>Evolução do faturamento</h3><span class="small muted">recebido por mês · 12 meses</span></div><div id="c-rev"></div></div>
      <div class="card"><div class="card-head"><h3>Despesas do mês</h3><a class="link" href="#/financeiro/saidas?preset=mes">Ver →</a></div><div id="c-exp"></div></div>
    </div>` : ''}

    <div class="grid g3 mt-16">
      <div class="card"><div class="card-head"><h3>Projetos por fase</h3><a class="link" href="#/projetos">Ver →</a></div><div id="c-ph"></div></div>
      <div class="card"><div class="card-head"><h3>Tarefas por responsável</h3><a class="link" href="#/tarefas?view=abertas&mode=kanban">Kanban →</a></div><div id="c-tu"></div></div>
      <div class="card"><div class="card-head"><h3>Minhas tarefas</h3><a class="link" href="#/tarefas?view=minhas">Ver →</a></div>
        <div class="list">${d.my_tasks.length ? d.my_tasks.map((t) => html`<a class="list-item" href="#/tarefas/${t.id}"><div class="grow" style="min-width:0"><div class="li-title">${t.title}</div><div class="li-sub">${t.project_name || 'Sem projeto'}</div></div><div class="right"><div class="small ${t.due_date && t.due_date < d.today ? 'late' : 'muted'}">${t.due_date ? dateShort(t.due_date) : ''}</div>${prio(t.priority)}</div></a>`) : html`<div class="empty sm">Nenhuma tarefa atribuída a você.</div>`}</div></div>
    </div>

    <div class="grid g3 mt-16">
      <div class="card"><div class="card-head"><h3>Próximos compromissos</h3><a class="link" href="#/agenda">Agenda →</a></div>
        <div class="list">${d.events.length ? d.events.map((e) => html`<a class="list-item" href="#/agenda?data=${e.start_at.slice(0, 10)}"><div class="li-date"><b>${e.start_at.slice(8, 10)}</b><span>${monShort(e.start_at)}</span></div><div class="grow" style="min-width:0"><div class="li-title">${e.title}</div><div class="li-sub">${e.all_day ? 'Dia inteiro' : time(e.start_at)} · ${label('EVENT_TYPES', e.type)}${e.client_name ? ' · ' + e.client_name : ''}</div></div></a>`) : html`<div class="empty sm">Nenhum compromisso nos próximos 14 dias.</div>`}</div></div>
      <div class="card"><div class="card-head"><h3>Próximas entregas</h3></div>
        <div class="list">${d.deliveries.length ? d.deliveries.map((x) => html`<a class="list-item" href="#/projetos/${x.project_id}"><div class="li-date"><b>${x.due_date.slice(8, 10)}</b><span>${monShort(x.due_date)}</span></div><div class="grow" style="min-width:0"><div class="li-title">${x.phase || 'Entrega final'}</div><div class="li-sub">${x.title}</div></div><span class="small ${x.due_date < d.today ? 'late' : 'muted'}">${relDay(x.due_date)}</span></a>`) : html`<div class="empty sm">Sem entregas nos próximos 30 dias.</div>`}</div></div>
      ${f ? html`<div class="card"><div class="card-head"><h3>Pagamentos próximos</h3><a class="link" href="#/financeiro/saidas?preset=abertas">Ver →</a></div>
        <div class="list">${f.payments_next.length ? f.payments_next.map((x) => html`<a class="list-item" href="#/financeiro/saidas?id=${x.id}"><div class="grow" style="min-width:0"><div class="li-title">${x.description}</div><div class="li-sub">${x.supplier_name || ''} ${x.supplier_name ? '·' : ''} <span class="${x.status === 'vencido' ? 'late' : ''}">${date(x.due_date)}</span></div></div><b class="num" style="font-weight:500">${money(x.amount)}</b></a>`) : html`<div class="empty sm">Nenhum pagamento nos próximos 15 dias.</div>`}</div></div>`
        : html`<div class="card"><div class="card-head"><h3>Alertas</h3><a class="link" href="#/notificacoes">Ver →</a></div>${notifList(d.notifications)}</div>`}
    </div>

    ${f ? html`<div class="grid g2 mt-16">
      <div class="card"><div class="card-head"><h3>Contas a receber</h3><a class="link" href="#/financeiro/entradas?preset=abertas">Ver →</a></div>
        <div class="list">${f.receivables.length ? f.receivables.map((x) => html`<a class="list-item" href="#/financeiro/entradas?id=${x.id}"><div class="grow" style="min-width:0"><div class="li-title">${x.client_name || x.description}</div><div class="li-sub">${x.description}</div></div><div class="right"><b class="num" style="font-weight:500">${money(x.amount)}</b><div class="small ${x.status === 'vencido' ? 'late' : 'muted'}">${date(x.due_date)}</div></div></a>`) : html`<div class="empty sm">Nada a receber.</div>`}</div></div>
      <div class="card"><div class="card-head"><h3>Alertas importantes</h3><a class="link" href="#/notificacoes">Central de notificações →</a></div>${notifList(d.notifications)}</div>
    </div>` : ''}
  `);

  // gráficos
  if (f) {
    const m = f.months; const cur = d.today.slice(0, 7);
    const idx = m.findIndex((x) => x.month === cur);
    const last = m.slice(Math.max(0, idx - 5), idx + 4);
    root.querySelector('#c-io').appendChild(barChart({
      labels: last.map((x) => monthLabel(x.month)),
      series: [
        { name: 'Entradas', values: last.map((x) => (x.month < cur ? x.in_real : x.in_total)), color: '#111' },
        { name: 'Saídas', values: last.map((x) => (x.month < cur ? x.out_real : x.out_total)), color: '#b9a489' },
      ], height: 230,
    }));
    const fc = root.querySelector('#c-fc');
    fc.appendChild(el(html`<div class="col gap-16">${f.horizons.map((hz) => html`<div><div class="row between"><span class="small muted">Próximos ${hz.months} meses</span><b class="num serif" style="font-size:22px;font-weight:500">${money(hz.saldo)}</b></div>
      <div class="row between tiny muted mt-8"><span>+ ${money(hz.entradas)}</span><span>− ${money(hz.saidas)}</span></div><div class="progress thin mt-8 ${hz.saldo < 0 ? 'danger' : ''}"><span style="width:${Math.min(100, (hz.entradas / Math.max(1, hz.entradas + hz.saidas)) * 100)}%"></span></div></div>`)}
      <div class="tiny muted">Saldo projetado = saldo atual + entradas previstas − saídas previstas (inclui valores vencidos).</div></div>`));
    const rev = m.slice(0, idx + 1).slice(-12);
    root.querySelector('#c-rev').appendChild(lineChart({ labels: rev.map((x) => monthLabel(x.month)), series: [{ name: 'Faturamento', values: rev.map((x) => x.in_real) }], height: 210 }));
    root.querySelector('#c-exp').appendChild(f.expenses_by_category.length ? donut({ items: f.expenses_by_category.slice(0, 6), center: moneyShort(f.expenses_by_category.reduce((s, x) => s + x.value, 0)).replace('R$ ', ''), size: 150 }) : el('<div class="empty sm">Sem despesas no mês.</div>'));
  }
  root.querySelector('#c-ph').appendChild(hbars(d.projects_by_phase, { format: (v) => `${v}` }));
  root.querySelector('#c-tu').appendChild(hbars(d.tasks_by_user.map((t) => ({ label: t.label, value: t.value, extra: t.late ? `${t.late} atrasada(s)` : '', color: t.color || '#111' })), { format: (v) => `${v}` }));
}

function notifList(rows) {
  return rows && rows.length ? html`<div class="list">${rows.map((n) => html`<a class="list-item" href="${n.link || '#/notificacoes'}"><span class="sev ${n.severity}"></span><div class="grow" style="min-width:0"><div class="li-title">${n.title}</div>${n.body ? html`<div class="li-sub">${n.body}</div>` : ''}</div></a>`)}</div>` : html`<div class="empty sm">Nenhum alerta pendente.</div>`;
}
