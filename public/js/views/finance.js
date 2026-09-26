import { S, api, html, el, toHTML, icon, money, date, monthLabel, badge, label, list, drawer, modal, buildForm, readForm, validate, toast, fail, today, attachments, openForm, invalidateRefs, csvMoney, $, $$, isManager } from '../lib.js';
import { barChart, lineChart } from '../charts.js';
import { listPage, rowActions } from './common.js';

const TABS = [['', 'Visão geral'], ['entradas', 'Entradas'], ['saidas', 'Saídas'], ['recorrentes', 'Despesas recorrentes'], ['fluxo', 'Fluxo de caixa']];

export default async function (ctx) {
  const sec = ctx.params[0] || '';
  const tabs = html`<div class="tabs">${TABS.map(([k, l]) => html`<a href="#/financeiro${k ? '/' + k : ''}" class="${k === sec ? 'on' : ''}">${l}</a>`)}</div>`;
  const wrap = el('<div></div>'); ctx.root.appendChild(wrap);
  if (sec === 'entradas' || sec === 'saidas') return entries(ctx, wrap, sec === 'entradas' ? 'incomes' : 'expenses', tabs);
  if (sec === 'recorrentes') return recurring(ctx, wrap, tabs);
  return overview(ctx, wrap, tabs, sec === 'fluxo');
}

// ------------------------------ Visão geral / fluxo de caixa ------------------------------
async function overview(ctx, root, tabs, detailed) {
  const [cf, d] = await Promise.all([api.get(`/finance/cashflow?back=${detailed ? 12 : 6}&ahead=12`), api.get('/dashboard')]);
  const f = d.finance;
  const cur = today().slice(0, 7);
  const curRow = cf.months.find((m) => m.month === cur) || {};
  root.innerHTML = toHTML(html`
    <div class="page-head"><div><h1>Financeiro</h1><div class="sub">Entradas, saídas, recorrências e fluxo de caixa do escritório</div></div>
      <div class="row wrap"><button class="btn" data-new="expenses">${icon('out')} Nova despesa</button><button class="btn primary" data-new="incomes">${icon('in')} Nova receita</button></div></div>
    ${tabs}
    <div class="grid g4">
      <div class="card kpi"><span class="label">Saldo atual</span><span class="value ${cf.balance < 0 ? 'danger-text' : ''}">${money(cf.balance)}</span><span class="foot">receitas recebidas − despesas pagas</span></div>
      <div class="card kpi"><span class="label">Entradas previstas no mês</span><span class="value">${money(curRow.in_prev)}</span><span class="foot">${money(curRow.in_real)} já recebidos</span></div>
      <div class="card kpi"><span class="label">Saídas previstas no mês</span><span class="value">${money(curRow.out_prev)}</span><span class="foot">${money(curRow.out_real)} já pagos</span></div>
      <div class="card kpi"><span class="label">Saldo projetado (fim do mês)</span><span class="value ${curRow.projected_balance < 0 ? 'danger-text' : ''}">${money(curRow.projected_balance)}</span><span class="foot">inclui vencidos em aberto</span></div>
    </div>
    <div class="grid g3 mt-16">${cf.horizons.map((h) => html`<div class="card"><div class="eyebrow">Previsão ${h.months} meses</div>
      <div class="serif mt-8" style="font-size:30px">${money(h.saldo)}</div>
      <div class="row between small mt-8"><span class="success-text">+ ${money(h.entradas)}</span><span class="danger-text">− ${money(h.saidas)}</span></div></div>`)}</div>
    ${cf.overdue_in || cf.overdue_out ? html`<div class="card flat mt-16 row wrap between"><div class="row gap-8">${icon('alert')}<span>Valores vencidos: <b class="danger-text">${money(cf.overdue_in)}</b> a receber e <b>${money(cf.overdue_out)}</b> a pagar.</span></div><div class="row gap-8"><a class="btn sm" href="#/financeiro/entradas?preset=vencidas">Recebimentos vencidos</a><a class="btn sm" href="#/financeiro/saidas?preset=vencidas">Pagamentos vencidos</a></div></div>` : ''}
    <div class="grid g2 mt-16">
      <div class="card"><div class="card-head"><h3>Fluxo de caixa mensal</h3><span class="small muted">realizado + previsto</span></div><div data-c1></div></div>
      <div class="card"><div class="card-head"><h3>Saldo projetado</h3><span class="small muted">próximos 12 meses</span></div><div data-c2></div></div>
    </div>
    <div class="section-title">Fluxo de caixa detalhado</div>
    <div class="table-wrap"><table class="t compact"><thead><tr><th>Mês</th><th class="right">Entradas realizadas</th><th class="right">Entradas previstas</th><th class="right">Saídas realizadas</th><th class="right">Saídas previstas</th><th class="right">Resultado</th><th class="right">Saldo projetado</th></tr></thead>
      <tbody>${cf.months.map((m) => html`<tr class="${m.month === cur ? '' : ''}" style="${m.month === cur ? 'background:#fafaf9;font-weight:500' : ''}"><td>${monthLabel(m.month, true)}${m.month === cur ? html` <span class="badge plain">atual</span>` : ''}</td>
        <td class="right num">${m.in_real ? money(m.in_real) : '—'}</td><td class="right num muted">${m.in_prev ? money(m.in_prev) : '—'}</td>
        <td class="right num">${m.out_real ? money(m.out_real) : '—'}</td><td class="right num muted">${m.out_prev ? money(m.out_prev) : '—'}</td>
        <td class="right num ${m.in_total - m.out_total < 0 ? 'danger-text' : ''}">${money(m.in_total - m.out_total)}</td>
        <td class="right num">${m.projected_balance !== undefined ? money(m.projected_balance) : ''}</td></tr>`)}</tbody></table></div>
    ${f ? html`<div class="grid g2 mt-16">
      <div class="card"><div class="card-head"><h3>A receber (próximos)</h3><a class="link" href="#/financeiro/entradas?preset=abertas">Ver todas →</a></div>
        <div class="list">${f.receivables.map((x) => html`<a class="list-item" href="#/financeiro/entradas?id=${x.id}"><div class="grow" style="min-width:0"><div class="li-title">${x.client_name || x.description}</div><div class="li-sub">${x.description}</div></div><div class="right"><b class="num" style="font-weight:500">${money(x.amount)}</b><div class="small ${x.status === 'vencido' ? 'late' : 'muted'}">${date(x.due_date)}</div></div></a>`)}</div></div>
      <div class="card"><div class="card-head"><h3>A pagar (próximos 15 dias)</h3><a class="link" href="#/financeiro/saidas?preset=abertas">Ver todas →</a></div>
        <div class="list">${f.payments_next.length ? f.payments_next.map((x) => html`<a class="list-item" href="#/financeiro/saidas?id=${x.id}"><div class="grow" style="min-width:0"><div class="li-title">${x.description}</div><div class="li-sub">${x.supplier_name || ''}</div></div><div class="right"><b class="num" style="font-weight:500">${money(x.amount)}</b><div class="small ${x.status === 'vencido' ? 'late' : 'muted'}">${date(x.due_date)}</div></div></a>`) : html`<div class="empty sm">Nada a pagar nos próximos dias.</div>`}</div></div></div>` : ''}`);
  const past = cf.months.filter((m) => m.month <= cur).slice(-6); const fut = cf.months.filter((m) => m.month > cur).slice(0, 6);
  const rng = [...past, ...fut];
  root.querySelector('[data-c1]').appendChild(barChart({ labels: rng.map((m) => monthLabel(m.month)), series: [
    { name: 'Entradas', values: rng.map((m) => m.in_total), color: '#111' }, { name: 'Saídas', values: rng.map((m) => m.out_total), color: '#b9a489' }] }));
  const proj = cf.months.filter((m) => m.projected_balance !== undefined);
  root.querySelector('[data-c2]').appendChild(lineChart({ labels: proj.map((m) => monthLabel(m.month)), series: [{ name: 'Saldo projetado', values: proj.map((m) => m.projected_balance) }] }));
  $$('[data-new]', root).forEach((b) => (b.onclick = () => newEntry(b.dataset.new, {}, ctx.rerender)));
}

// ------------------------------ Entradas / Saídas ------------------------------
async function entries(ctx, root, res, tabs) {
  const inc = res === 'incomes';
  const lst = inc ? 'INCOME_STATUS' : 'EXPENSE_STATUS';
  const paidLabel = inc ? 'Receber' : 'Pagar';
  const holder = el('<div></div>');
  root.innerHTML = '';
  const page = await listPage({
    root: holder, res, title: 'Financeiro', sub: inc ? 'Entradas — receitas, parcelas de clientes e reservas técnicas' : 'Saídas — despesas, fornecedores e custos de obra', query: ctx.query,
    presets: inc ? [{ key: 'abertas', label: 'Em aberto' }, { key: 'vencidas', label: 'Vencidas' }, { key: 'mes', label: 'Vencem neste mês' }, { key: 'recebidas', label: 'Recebidas' }, { key: '', label: 'Todas' }]
      : [{ key: 'abertas', label: 'Em aberto' }, { key: 'vencidas', label: 'Vencidas' }, { key: 'mes', label: 'Vencem neste mês' }, { key: 'pagas', label: 'Pagas' }, { key: '', label: 'Todas' }],
    filters: inc ? ['client_id', 'project_id', 'category'] : ['supplier_id', 'category', 'project_id'],
    newLabel: inc ? 'Nova receita' : 'Nova despesa', onNew: (reload) => newEntry(res, {}, reload), csvName: inc ? 'entradas' : 'saidas',
    columns: [
      { key: 'due_date', label: 'Vencimento', cls: 'nw', render: (r) => html`<span class="${r.status === 'vencido' ? 'late' : ''}">${date(r.due_date)}</span>`, csv: (r) => date(r.due_date) },
      { key: 'description', label: 'Descrição', render: (r) => html`<div class="cell-title">${r.description}</div><div class="cell-sub">${r.category || ''}</div>` },
      inc ? { key: 'client_name', label: 'Cliente' } : { key: 'supplier_name', label: 'Fornecedor' },
      { key: 'project_name', label: 'Projeto / obra', render: (r) => r.project_name ? html`<a href="#/projetos/${r.project_id}">${r.project_name}</a>${r.work_name ? html`<div class="cell-sub">${r.work_name}</div>` : ''}` : '—' },
      { key: 'installment_no', label: 'Parcela', render: (r) => (r.installment_total > 1 ? `${r.installment_no}/${r.installment_total}` : '—'), csv: (r) => `${r.installment_no}/${r.installment_total}` },
      { key: 'amount', label: 'Valor', align: 'right', render: (r) => html`<span class="num">${money(r.amount)}</span>${!inc && r.paid_by === 'cliente' ? html`<div class="cell-sub">pago pelo cliente</div>` : ''}`, csv: (r) => csvMoney(r.amount) },
      { key: 'paid_at', label: inc ? 'Recebido em' : 'Pago em', render: (r) => (r.paid_at ? date(r.paid_at) : '—'), csv: (r) => date(r.paid_at) },
      { key: 'status', label: 'Status', cls: 'nw', render: (r) => html`${badge(lst, r.status)}${!['recebido', 'pago', 'cancelado'].includes(r.status) ? html` <button class="btn xs" data-pay="${r.id}">${paidLabel}</button>` : ''}`, csv: (r) => label(lst, r.status) },
    ],
    onRow: (r) => entryDrawer(res, r.id, () => page.load()),
    actions: (r, reload) => rowActions(res, r, { onChange: reload, editOpts: { after: attachments(res, r.id, { title: 'Comprovantes e anexos' }) },
      extra: [!['recebido', 'pago', 'cancelado'].includes(r.status) ? { label: inc ? 'Registrar recebimento' : 'Registrar pagamento', icon: 'check', fn: () => payModal(res, r, reload) } : { label: 'Estornar baixa', icon: 'refresh', fn: async () => { await api.post(`/finance/${res}/${r.id}/unpay`); toast('Baixa estornada.'); reload(); } }, '-'] }),
    totals: (rows) => {
      const tot = rows.filter((r) => r.status !== 'cancelado').reduce((s, r) => s + r.amount, 0);
      const open = rows.filter((r) => !['recebido', 'pago', 'cancelado'].includes(r.status)).reduce((s, r) => s + r.amount, 0);
      return `Total ${money(tot)} · em aberto ${money(open)}`;
    },
    afterRender: (rows, state, reload) => {
      holder.querySelectorAll('[data-pay]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); payModal(res, rows.find((r) => r.id == b.dataset.pay), reload); }));
    },
  });
  const head = holder.querySelector('.page-head'); head.after(el(toHTML(tabs)));
  root.appendChild(holder);
  if (ctx.query.id) entryDrawer(res, Number(ctx.query.id), () => page.load());
}

export async function entryDrawer(res, id, onChange) {
  const inc = res === 'incomes';
  let r;
  try { r = await api.get(`/r/${res}/${id}`); } catch (e) { return fail(e); }
  const lst = inc ? 'INCOME_STATUS' : 'EXPENSE_STATUS';
  const open = !['recebido', 'pago', 'cancelado'].includes(r.status);
  const body = el(html`<div>
    <div class="row between wrap mb-24"><div class="serif" style="font-size:34px">${money(r.amount)}</div>${badge(lst, r.status)}</div>
    <dl class="kv">
      <dt>Vencimento</dt><dd>${date(r.due_date)}</dd>
      <dt>${inc ? 'Recebido em' : 'Pago em'}</dt><dd>${r.paid_at ? date(r.paid_at) : '—'}</dd>
      <dt>Categoria</dt><dd>${r.category || '—'}</dd>
      ${inc ? html`<dt>Cliente</dt><dd>${r.client_name ? html`<a href="#/clientes/${r.client_id}">${r.client_name}</a>` : '—'}</dd>` : html`<dt>Fornecedor</dt><dd>${r.supplier_name ? html`<a href="#/fornecedores/${r.supplier_id}">${r.supplier_name}</a>` : '—'}</dd>`}
      <dt>Projeto</dt><dd>${r.project_name ? html`<a href="#/projetos/${r.project_id}">${r.project_name}</a>` : '—'}</dd>
      ${!inc ? html`<dt>Obra</dt><dd>${r.work_name ? html`<a href="#/obras/${r.work_id}">${r.work_name}</a>` : '—'}</dd><dt>Quem paga</dt><dd>${label('PAID_BY', r.paid_by)}</dd><dt>Responsável</dt><dd>${r.responsible_name || '—'}</dd>` : ''}
      ${inc && r.contract_number ? html`<dt>Contrato</dt><dd><a href="#/contratos/${r.contract_id}">${r.contract_number}</a></dd>` : ''}
      <dt>Parcela</dt><dd>${r.installment_total > 1 ? `${r.installment_no} de ${r.installment_total}` : 'Única'}</dd>
      <dt>Forma de pagamento</dt><dd>${label('PAYMENT_METHODS', r.method)}</dd>
      ${r.notes ? html`<dt>Observações</dt><dd class="notes">${r.notes}</dd>` : ''}
    </dl>
    <div class="mt-24" data-att></div></div>`);
  body.querySelector('[data-att]').appendChild(attachments(res, r.id, { title: inc ? 'Comprovantes (marque “visível ao cliente” em Documentos para liberar)' : 'Comprovante / nota fiscal' }));
  const d = drawer({ title: r.description, sub: inc ? 'Entrada' : 'Saída', body });
  d.foot.classList.remove('hidden');
  d.foot.innerHTML = toHTML(html`<button class="btn danger" data-del>${icon('trash')}</button><span class="grow"></span><button class="btn" data-dup>${icon('copy')} Duplicar</button><button class="btn" data-edit>${icon('edit')} Editar</button>
    ${open ? html`<button class="btn primary" data-pay>${icon('check')} ${inc ? 'Registrar recebimento' : 'Registrar pagamento'}</button>` : r.status !== 'cancelado' ? html`<button class="btn" data-unpay>${icon('refresh')} Estornar</button>` : ''}`);
  const done = () => { d.close(); onChange && onChange(); };
  d.foot.querySelector('[data-edit]').onclick = () => { d.close(); openForm(res, { id: r.id, onSaved: onChange }); };
  d.foot.querySelector('[data-dup]').onclick = async () => { await api.post(`/r/${res}/${r.id}/duplicate`); toast('Duplicado.'); done(); };
  d.foot.querySelector('[data-del]').onclick = async () => { const { deleteRow } = await import('../lib.js'); if (await deleteRow(res, r, r.description)) done(); };
  const p = d.foot.querySelector('[data-pay]'); if (p) p.onclick = () => payModal(res, r, done);
  const u = d.foot.querySelector('[data-unpay]'); if (u) u.onclick = async () => { await api.post(`/finance/${res}/${r.id}/unpay`); toast('Baixa estornada.'); done(); };
}

export function payModal(res, r, onDone) {
  const inc = res === 'incomes';
  modal({ title: inc ? 'Registrar recebimento' : 'Registrar pagamento',
    body: html`<p class="muted small" style="margin-top:0">${r.description} · ${money(r.amount)}</p><div class="form-grid">
      <div class="field"><label>Data</label><input type="date" id="pd" value="${today()}"></div>
      <div class="field"><label>Forma de pagamento</label><select id="pm"><option value="">—</option>${S.meta.lists.PAYMENT_METHODS.map((o) => html`<option value="${o.value}" ${o.value === r.method ? 'selected' : ''}>${o.label}</option>`)}</select></div>
      <div class="field wide"><label>Valor ${inc ? 'recebido' : 'pago'}</label><div class="money-input"><span>R$</span><input type="number" step="0.01" id="pa" value="${r.amount}"></div><span class="hint">Se for menor que o valor total, o saldo restante vira um novo lançamento em aberto.</span></div></div>`,
    actions: [{ label: 'Cancelar' }, { label: 'Confirmar', primary: true, fn: async (m) => {
      await api.post(`/finance/${res}/${r.id}/pay`, { paid_at: m.querySelector('#pd').value, method: m.querySelector('#pm').value || null, amount: m.querySelector('#pa').value });
      toast(inc ? 'Recebimento registrado.' : 'Pagamento registrado.'); onDone && onDone();
    } }] });
}

// Novo lançamento com opção de parcelamento automático
export function newEntry(res, values = {}, onDone) {
  const inc = res === 'incomes';
  const form = buildForm(res, values, { exclude: ['installment_no', 'installment_total', 'paid_at', 'status'] });
  const inst = el(html`<div class="card flat mt-16"><label class="toggle"><input type="checkbox" data-split><span class="sw"></span><span>Pagamento parcelado</span></label>
    <div class="form-grid mt-16 hidden" data-opts>
      <div class="field"><label>Quantidade de parcelas</label><input type="number" min="2" max="120" value="6" data-n></div>
      <div class="field"><label>Intervalo entre parcelas (meses)</label><input type="number" min="1" max="12" value="1" data-int></div>
      <div class="field wide"><label>O valor informado acima é</label><select data-mode><option value="total">o valor total (será dividido)</option><option value="each">o valor de cada parcela</option></select></div>
      <div class="field wide"><label class="toggle"><input type="checkbox" data-first><span class="sw"></span><span class="small">1ª parcela já ${inc ? 'recebida' : 'paga'}</span></label></div>
      <div class="wide small muted" data-preview></div>
    </div>
    <label class="toggle" data-paidnow><input type="checkbox" data-paid><span class="sw"></span><span>Já foi ${inc ? 'recebido' : 'pago'}</span></label></div>`);
  const body = el('<div></div>'); body.appendChild(form); body.appendChild(inst);
  const d = drawer({ title: inc ? 'Nova receita' : 'Nova despesa', sub: 'Financeiro', body });
  const q = (s) => inst.querySelector(s);
  const preview = () => {
    const v = readForm(form); const n = Math.max(2, +q('[data-n]').value || 2); const amt = +v.amount || 0;
    const each = q('[data-mode]').value === 'total' ? amt / n : amt; const total = q('[data-mode]').value === 'total' ? amt : amt * n;
    q('[data-preview]').textContent = amt ? `${n} parcelas de ${money(each)} · total ${money(total)} · 1º vencimento em ${date(v.due_date)}` : '';
  };
  q('[data-split]').onchange = (e) => { q('[data-opts]').classList.toggle('hidden', !e.target.checked); q('[data-paidnow]').classList.toggle('hidden', e.target.checked); preview(); };
  inst.oninput = preview; form.addEventListener('input', preview);
  d.foot.classList.remove('hidden');
  d.foot.innerHTML = toHTML(html`<button class="btn" data-c>Cancelar</button><button class="btn primary" data-s>Salvar</button>`);
  d.foot.querySelector('[data-c]').onclick = d.close;
  d.foot.querySelector('[data-s]').onclick = async (e) => {
    if (!validate(form)) return;
    const v = readForm(form); e.target.disabled = true;
    try {
      if (q('[data-split]').checked) {
        const n = Math.max(2, +q('[data-n]').value || 2);
        const total = q('[data-mode]').value === 'total' ? +v.amount : +v.amount * n;
        const r = await api.post('/finance/installments', { ...v, table: res, total, count: n, first_due: v.due_date, interval: +q('[data-int]').value || 1, first_paid: q('[data-first]').checked });
        toast(`${r.ids.length} parcelas geradas.`);
      } else {
        if (q('[data-paid]').checked) v.paid_at = v.due_date <= today() ? v.due_date : today();
        await api.post(`/r/${res}`, v); toast(inc ? 'Receita cadastrada.' : 'Despesa cadastrada.');
      }
      invalidateRefs(res); d.close(); onDone && onDone();
    } catch (err) { fail(err); e.target.disabled = false; }
  };
}

// ------------------------------ Despesas recorrentes ------------------------------
async function recurring(ctx, root, tabs) {
  const holder = el('<div></div>');
  await listPage({
    root: holder, res: 'recurring_expenses', title: 'Financeiro', sub: 'Despesas mensais recorrentes — os próximos vencimentos são criados automaticamente', query: ctx.query, archived: false,
    newLabel: 'Nova recorrência',
    columns: [
      { key: 'description', label: 'Descrição', render: (r) => html`<div class="cell-title">${r.description}</div><div class="cell-sub">${r.supplier_name || ''}</div>` },
      { key: 'category', label: 'Categoria' },
      { key: 'amount', label: 'Valor mensal', align: 'right', render: (r) => money(r.amount), csv: (r) => csvMoney(r.amount) },
      { key: 'day', label: 'Vencimento', render: (r) => `todo dia ${r.day}` },
      { key: 'start_date', label: 'Vigência', render: (r) => `${date(r.start_date)}${r.end_date ? ' → ' + date(r.end_date) : ' → indeterminado'}` },
      { key: 'active', label: 'Status', render: (r) => (r.active ? html`<span class="badge success">Ativa</span>` : html`<span class="badge muted">Pausada</span>`) },
    ],
    onRow: (r) => openForm('recurring_expenses', { id: r.id, onSaved: ctx.rerender }),
    actions: (r, reload) => rowActions('recurring_expenses', r, { onChange: reload, extra: [{ label: 'Ver lançamentos gerados', icon: 'list', fn: () => ctx.go(`#/financeiro/saidas?preset=&q=${encodeURIComponent(r.description)}`) }, '-'] }),
    totals: (rows) => `Total mensal ativo: ${money(rows.filter((r) => r.active).reduce((s, r) => s + r.amount, 0))}`,
  });
  holder.querySelector('.page-head').after(el(toHTML(tabs)));
  root.appendChild(holder);
}
