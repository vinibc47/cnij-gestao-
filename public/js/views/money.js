// =====================================================================
// Separação financeira (escritório)
//   CAIXA DO ESCRITÓRIO  — entradas e saídas reais das contas do escritório
//   FINANCEIRO DAS OBRAS — custos e pagamentos de cada obra; pagamentos diretos
//                          do cliente ao fornecedor não movimentam o caixa
// =====================================================================
import { S, api, html, raw, el, toHTML, icon, money, date, datetime, badge, label, drawer, modal, toast, fail, today, combo, refOptions, menu, uploadFiles, fileUrl,
  confirmDialog, openForm, invalidateRefs, draftKey, draftGet, draftClear, draftWatch, draftBanner, $$ } from '../lib.js';

export const AREAS = [
  { key: 'caixa', href: '#/financeiro', title: 'Caixa do escritório', sub: 'Entradas e saídas reais das contas do escritório.' },
  { key: 'obras', href: '#/financeiro/obras', title: 'Financeiro das obras', sub: 'Custos e pagamentos de cada obra. Pagamentos diretos do cliente ao fornecedor não movimentam o caixa do escritório.' },
];
export const CASH_TABS = [['', 'Extrato'], ['entradas', 'Entradas'], ['saidas', 'Saídas'], ['lembretes', 'Lembretes de cobrança'], ['recorrentes', 'Recorrentes'], ['fluxo', 'Fluxo de caixa'], ['conferir', 'Conferir lançamentos antigos']];

export function areaHead(active, { actions = '', tab = '', review = 0 } = {}) {
  const a = AREAS.find((x) => x.key === active);
  return html`<div class="page-head"><div><div class="crumbs">Financeiro</div><h1>${a.title}</h1><div class="sub">${a.sub}</div></div><div class="row wrap">${actions}</div></div>
    <div class="fin-areas">${AREAS.map((x) => html`<a href="${x.href}" class="${x.key === active ? 'on' : ''}"><b>${x.title}</b><span>${x.key === 'caixa' ? 'Dinheiro que entra e sai das contas do escritório' : 'Serviços, fornecedores e parcelas de cada obra'}</span></a>`)}</div>
    ${active === 'caixa' ? html`<div class="tabs">${CASH_TABS.map(([k, l]) => html`<a href="#/financeiro${k ? '/' + k : ''}" class="${k === tab ? 'on' : ''}">${l}${k === 'conferir' && review ? html`<span class="n">${review}</span>` : ''}</a>`)}</div>` : ''}`;
}

const accounts = () => (S.meta.options.conta && S.meta.options.conta.length ? S.meta.options.conta : ['Conta principal']);
const accSelect = (id, v) => html`<select id="${id}">${accounts().map((a) => html`<option ${a === v ? 'selected' : ''}>${a}</option>`)}</select>`;
const methodSelect = (id, v) => html`<select id="${id}"><option value="">—</option>${S.meta.lists.PAYMENT_METHODS.map((o) => html`<option value="${o.value}" ${o.value === v ? 'selected' : ''}>${o.label}</option>`)}</select>`;
const FUND = [['repasse', 'Com recurso do cliente (repasse)'], ['adiantamento', 'Adiantamento do escritório — a reembolsar'], ['proprio', 'Custo do próprio escritório']];
const isPaid = (res, r) => r.status === (res === 'incomes' ? 'recebido' : 'pago');

// ------------------------------ REGISTRAR PAGAMENTO / RECEBIMENTO ------------------------------
// Pede só valor, data e quem pagou; o resto é opcional em "Mais detalhes".
export function payDialog(res, r, onDone) {
  const inc = res === 'incomes';
  const obra = !inc && r.flow === 'obra';
  const inf = r.informed_at ? { amount: r.informed_amount, date: r.informed_date, payer: r.informed_payer, note: r.informed_note, doc: r.informed_doc_id, at: r.informed_at } : (r.informed || null);
  const amount = inf && inf.amount ? inf.amount : r.amount;
  const payer0 = (inf && inf.payer) || r.planned_payer || r.paid_by || 'cliente';
  const title = inc ? 'Registrar recebimento' : obra ? 'Registrar pagamento da obra' : 'Registrar pagamento';
  const body = el(html`<div class="pay-dlg">
    <div class="pay-ctx"><div class="cell-title">${r.description}</div><div class="cell-sub">${[r.stage || r.stage_label, r.supplier_name || r.payee, r.due_date ? 'vence ' + date(r.due_date) : obra ? 'Na finalização — data a definir' : null].filter(Boolean).join(' · ')}</div>
      <div class="serif" style="font-size:22px">${money(r.amount)}</div></div>
    ${inf ? html`<div class="note-box info">${icon('alert', 'sm')}<div><b>Pagamento informado pelo cliente</b> em ${datetime(inf.at)} — ${money(inf.amount)} pago em ${date(inf.date)}${inf.note ? html`<br><span class="muted">“${inf.note}”</span>` : ''}${inf.doc ? html`<br><a href="${fileUrl({ id: inf.doc }, true)}" target="_blank" rel="noopener">${icon('clip', 'sm')} Ver comprovante enviado</a>` : ''}<div class="small muted mt-4">Confira no extrato antes de confirmar.</div></div></div>` : ''}
    ${obra ? html`<div class="field"><label>Quem pagou?</label><div class="seg" data-payer>
        <button type="button" data-v="cliente" class="${payer0 === 'cliente' ? 'on' : ''}">Cliente pagou ao fornecedor</button>
        <button type="button" data-v="escritorio" class="${payer0 === 'escritorio' ? 'on' : ''}">Escritório pagou ao fornecedor</button></div>
      <span class="hint" data-payer-hint></span></div>
      <div class="field" data-fund-box><label>Com qual dinheiro?</label><select id="pf">${FUND.map(([v, l]) => html`<option value="${v}" ${v === (r.funding || 'adiantamento') ? 'selected' : ''}>${l}</option>`)}</select></div>` : ''}
    <div class="form-grid">
      <div class="field"><label>Valor ${inc ? 'recebido' : 'pago'}</label><div class="money-input"><span>R$</span><input type="number" step="0.01" id="pa" value="${amount}" inputmode="decimal"></div></div>
      <div class="field"><label>Data ${inc ? 'do recebimento' : 'do pagamento'}</label><input type="date" id="pd" value="${(inf && inf.date) || today()}" max="${today()}"></div>
      <div class="field wide" data-acc-box><label>${inc ? 'Entrou na conta' : 'Saiu da conta'}</label>${accSelect('pc', r.account)}</div>
      <div class="wide hint" data-partial></div>
    </div>
    <details class="more-details"><summary>Mais detalhes <span class="muted small">(forma, comprovante, observação)</span></summary><div class="form-grid">
      <div class="field"><label>Forma de pagamento</label>${methodSelect('pm', r.method)}</div>
      ${!inc ? html`<div class="field"><label>Quem recebeu</label><input id="pp" value="${r.payee || r.supplier_name || ''}" placeholder="Ex.: Marcenaria Silva"></div>` : html`<div></div>`}
      <div class="field wide"><label>Comprovante</label><input type="file" id="pfile" accept="image/*,application/pdf"></div>
      <div class="field wide"><label>Observação</label><input id="pn" placeholder="Ex.: pago via Pix no WhatsApp"></div></div></details>
  </div>`);
  const q = (s) => body.querySelector(s);
  let payer = payer0;
  const sync = () => {
    if (obra) {
      $$('[data-payer] button', body).forEach((b) => b.classList.toggle('on', b.dataset.v === payer));
      q('[data-fund-box]').classList.toggle('hidden', payer !== 'escritorio');
      q('[data-acc-box]').classList.toggle('hidden', payer !== 'escritorio');
      q('[data-payer-hint]').textContent = payer === 'cliente' ? 'Fica registrado na obra. Não movimenta o caixa do escritório.' : 'Sai do caixa do escritório e fica ligado a esta obra.';
    }
    const v = Number(q('#pa').value) || 0;
    q('[data-partial]').textContent = v && v < r.amount - 0.009 ? `Pagamento parcial: o restante de ${money(r.amount - v)} continua em aberto nesta mesma parcela.` : inc ? 'O valor entra no caixa do escritório na data informada.' : !obra ? 'O valor sai do caixa do escritório na data informada.' : '';
  };
  if (obra) q('[data-payer]').onclick = (e) => { const b = e.target.closest('button'); if (b) { payer = b.dataset.v; sync(); } };
  q('#pa').oninput = sync; sync();
  const actions = [{ label: 'Cancelar' }];
  if (inf) actions.unshift({ label: 'Não confere', fn: async () => { await rejectInformed(res, r, onDone); } });
  actions.push({ label: inf ? 'Confirmar pagamento' : 'Registrar', primary: true, fn: async () => {
    const data = { amount: q('#pa').value, paid_at: q('#pd').value, method: q('#pm').value || null, notes: q('#pn').value || null };
    if (obra) { data.payer = payer; if (payer === 'escritorio') { data.funding = q('#pf').value; data.account = q('#pc').value; } } else data.account = q('#pc').value;
    if (!inc && q('#pp') && q('#pp').value) data.payee = q('#pp').value;
    const out = await api.post(`/finance/${res}/${r.id}/pay`, data);
    const f = q('#pfile').files; if (f && f.length) { try { await uploadFiles(f, { entity: res, entity_id: r.id, category: 'Comprovantes' }); } catch (e) { fail(e); } }
    invalidateRefs(res);
    toast(out.rest_id ? `Pagamento parcial registrado. O restante continua em aberto.` : inc ? 'Recebimento registrado.' : obra && payer === 'cliente' ? 'Registrado na obra como pago diretamente pelo cliente.' : 'Pagamento registrado.');
    onDone && onDone();
  } });
  const m = modal({ title, body, actions });
  m.el.style.width = 'min(560px, calc(100vw - 24px))';
  return m;
}
async function rejectInformed(res, r, onDone) {
  return new Promise((resolve) => {
    modal({ title: 'Pagamento não confere', body: html`<p class="small muted" style="margin-top:0">O aviso do cliente sai da fila de conferência e a parcela continua em aberto. O motivo fica no histórico.</p><div class="field"><label>Motivo</label><textarea id="rr" rows="3" placeholder="Ex.: valor não identificado no extrato"></textarea></div>`,
      actions: [{ label: 'Voltar' }, { label: 'Registrar', primary: true, fn: async (m) => { await api.post(`/finance/${res}/${r.id}/reject-informed`, { reason: m.querySelector('#rr').value }); toast('Aviso de pagamento recusado.'); onDone && onDone(); } }], onClose: resolve });
  });
}
export function reverseDialog(res, r, onDone) {
  modal({ title: 'Estornar registro de pagamento', body: html`<p class="small muted" style="margin-top:0">${r.description} · ${money(r.amount)} em ${date(r.paid_at)}.<br>A parcela volta a ficar em aberto. Nada é apagado: o registro anterior e o motivo ficam no histórico.</p>
    <div class="field"><label>Motivo do estorno</label><textarea id="rv" rows="3" placeholder="Ex.: lançado na parcela errada"></textarea></div>`,
  actions: [{ label: 'Cancelar' }, { label: 'Estornar', danger: true, fn: async (m) => { await api.post(`/finance/${res}/${r.id}/unpay`, { reason: m.querySelector('#rv').value }); invalidateRefs(res); toast('Registro estornado — a parcela voltou a ficar em aberto.'); onDone && onDone(); } }] });
}
export function historyBox(res, id) {
  const box = el(html`<div><div class="eyebrow mb-8">Histórico</div><div class="hist small muted">Carregando…</div></div>`);
  api.get(`/finance/${res}/${id}/history`).then((h) => {
    box.querySelector('.hist').innerHTML = toHTML(h.length ? html`<ul class="hist-list">${h.map((e) => html`<li><span class="muted">${datetime(e.created_at)}${e.user_name ? ' · ' + e.user_name : e.actor === 'cliente' ? ' · cliente' : ''}</span><div>${e.summary || e.action}</div>${e.reason ? html`<div class="muted">Motivo: ${e.reason}</div>` : ''}</li>`)}</ul>` : 'Sem alterações registradas.');
  }).catch(() => { box.querySelector('.hist').textContent = '—'; });
  return box;
}

// ------------------------------ CAIXA DO ESCRITÓRIO: EXTRATO ------------------------------
const PERIODS = () => {
  const t = today(); const y = +t.slice(0, 4); const m = +t.slice(5, 7);
  const ms = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  const me = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  const pm = m === 1 ? [y - 1, 12] : [y, m - 1];
  const m3 = new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 10);
  return [['mes', 'Este mês', ms(y, m), t], ['anterior', 'Mês passado', ms(...pm), me(...pm)], ['3m', 'Últimos 3 meses', m3, t], ['ano', 'Este ano', `${y}-01-01`, t]];
};
const ST = [['realizado', 'Realizado'], ['aberto', 'Em aberto (previsto)'], ['vencido', 'Vencido'], ['informado', 'Informado pelo cliente'], ['todos', 'Tudo']];

export async function cashPage(ctx, root, { newEntry, entryDrawer }) {
  const qy = ctx.query;
  const per = PERIODS();
  const f = { from: qy.from || per[0][2], to: qy.to || per[0][3], account: qy.conta || '', client_id: qy.cliente || '', project_id: qy.projeto || '', status: qy.status || 'realizado' };
  const [review] = await Promise.all([api.get('/finance/review').catch(() => ({ expenses: [], incomes: [] }))]);
  const nReview = review.expenses.length + review.incomes.length;
  root.innerHTML = toHTML(html`${areaHead('caixa', { tab: '', review: nReview, actions: html`<button class="btn" data-new="expenses">${icon('out')} Nova despesa</button><button class="btn primary" data-new="incomes">${icon('in')} Nova entrada</button>` })}
    <div class="card fin-filters">
      <div class="chips" data-per>${per.map(([k, l, a, b]) => html`<button class="chip ${f.from === a && f.to === b ? 'on' : ''}" data-a="${a}" data-b="${b}">${l}</button>`)}</div>
      <div class="fin-frow">
        <label>De <input type="date" data-k="from" value="${f.from}"></label><label>Até <input type="date" data-k="to" value="${f.to}"></label>
        <select data-k="account"><option value="">Todas as contas</option>${accounts().map((a) => html`<option ${a === f.account ? 'selected' : ''}>${a}</option>`)}</select>
        <span data-cli></span><span data-prj></span>
        <select data-k="status">${ST.map(([v, l]) => html`<option value="${v}" ${v === f.status ? 'selected' : ''}>${l}</option>`)}</select>
      </div></div>
    <div data-out><div class="empty sm">Carregando…</div></div>`);
  const cli = combo({ name: 'cliente', options: refOptions('clients'), value: f.client_id, placeholder: 'Cliente: todos', onChange: (v) => { f.client_id = v || ''; load(); } });
  const prj = combo({ name: 'projeto', options: refOptions('projects'), value: f.project_id, placeholder: 'Projeto: todos', onChange: (v) => { f.project_id = v || ''; load(); } });
  root.querySelector('[data-cli]').appendChild(cli); root.querySelector('[data-prj]').appendChild(prj);
  $$('[data-k]', root).forEach((i) => (i.onchange = () => { f[i.dataset.k] = i.value; $$('[data-per] .chip', root).forEach((c) => c.classList.toggle('on', c.dataset.a === f.from && c.dataset.b === f.to)); load(); }));
  root.querySelector('[data-per]').onclick = (e) => { const c = e.target.closest('.chip'); if (!c) return; f.from = c.dataset.a; f.to = c.dataset.b; root.querySelector('[data-k="from"]').value = f.from; root.querySelector('[data-k="to"]').value = f.to; $$('[data-per] .chip', root).forEach((x) => x.classList.toggle('on', x === c)); load(); };
  $$('[data-new]', root).forEach((b) => (b.onclick = () => newEntry(b.dataset.new, {}, load)));
  const out = root.querySelector('[data-out]');
  async function load() {
    const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/financeiro?${new URLSearchParams(Object.entries({ from: f.from, to: f.to, conta: f.account, cliente: f.client_id, projeto: f.project_id, status: f.status }).filter(([, v]) => v)).toString()}`);
    let d; try { d = await api.get(`/finance/cash?${p}`); } catch (e) { return fail(e); }
    const k = d.kpis;
    const per = `${date(k.period.from)} a ${date(k.period.to)} · ${k.account}`;
    out.innerHTML = toHTML(html`
      <div class="small muted mb-8">${per}${f.client_id || f.project_id ? ' · filtrado por cliente/projeto' : ''}</div>
      <div class="grid g6 fin-kpis">
        <div class="card kpi"><span class="label">Saldo inicial do período</span><span class="value sm">${money(k.saldo_inicial)}</span><span class="foot">em ${date(k.period.from)}</span></div>
        <div class="card kpi"><span class="label">${icon('in', 'sm')} Entradas recebidas</span><span class="value sm">${money(k.entradas)}</span><span class="foot">realizado no período</span></div>
        <div class="card kpi"><span class="label">${icon('out', 'sm')} Saídas pagas</span><span class="value sm">${money(k.saidas)}</span><span class="foot">realizado no período</span></div>
        <div class="card kpi strong"><span class="label">Saldo atual</span><span class="value sm ${k.saldo < 0 ? 'danger-text' : ''}">${money(k.saldo)}</span><span class="foot">em ${date(k.period.to)}</span></div>
        <div class="card kpi"><span class="label">A receber</span><span class="value sm">${money(k.a_receber)}</span><span class="foot">previsto · ${k.vencido_receber ? html`<span class="danger-text">${money(k.vencido_receber)} vencido</span>` : 'nada vencido'}</span></div>
        <div class="card kpi"><span class="label">A pagar</span><span class="value sm">${money(k.a_pagar)}</span><span class="foot">previsto · ${k.vencido_pagar ? html`<span class="danger-text">${money(k.vencido_pagar)} vencido</span>` : 'nada vencido'}</span></div>
      </div>
      <div class="grid g2 mt-16">
        <div class="card"><div class="card-head"><h3>De onde veio o dinheiro</h3><span class="small muted">entradas realizadas</span></div>
          <div class="split-rows"><div><span>Honorários e receitas próprias</span><b>${money(k.entradas_por_tipo.honorarios)}</b></div><div><span>Recursos de clientes para repasse</span><b>${money(k.entradas_por_tipo.repasse)}</b></div><div><span>Reembolsos de adiantamentos</span><b>${money(k.entradas_por_tipo.reembolso)}</b></div></div></div>
        <div class="card"><div class="card-head"><h3>Para onde foi o dinheiro</h3><span class="small muted">saídas realizadas</span></div>
          <div class="split-rows"><div><span>Despesas do escritório</span><b>${money(k.saidas_por_tipo.proprias)}</b></div><div><span>Obras — com recurso do cliente (repasse)</span><b>${money(k.saidas_por_tipo.obra_repasse)}</b></div><div><span>Obras — adiantado pelo escritório (a reembolsar)</span><b>${money(k.saidas_por_tipo.obra_adiantamento)}</b></div>${k.saidas_por_tipo.obra_proprio ? html`<div><span>Obras — custo do escritório</span><b>${money(k.saidas_por_tipo.obra_proprio)}</b></div>` : ''}</div></div>
      </div>
      ${d.informed ? html`<div class="card flat mt-16 row between wrap"><span class="row gap-8">${icon('bell', 'sm')} <b>${d.informed}</b> pagamento(s) informado(s) por clientes aguardando conferência.</span><button class="btn sm" data-inf>Conferir agora</button></div>` : ''}
      ${nReview ? html`<div class="card flat mt-8 row between wrap"><span class="row gap-8">${icon('alert', 'sm')} ${nReview} lançamento(s) antigo(s) podem estar classificados como despesa do escritório sem ser.</span><a class="btn sm" href="#/financeiro/conferir">Conferir</a></div>` : ''}
      <div class="section-title row between"><span>Extrato — ${ST.find((x) => x[0] === f.status)[1]}</span><span class="small muted">${d.rows.length} lançamento(s)</span></div>
      <div data-t></div>`);
    const t = el(html`<div class="table-wrap"><table class="t responsive compact extrato"><thead><tr><th>Data efetiva</th><th>Descrição</th><th>Cliente / favorecido</th><th>Projeto</th><th>Categoria</th><th>Tipo</th><th class="right">Valor</th><th>Conta</th><th>Situação</th><th>Comprov.</th><th></th></tr></thead>
      <tbody>${d.rows.length ? d.rows.map((r, i) => html`<tr class="click" data-i="${i}">
        <td class="primary nw" data-l="Data efetiva">${r.paid_at ? date(r.paid_at) : html`<span class="muted">${r.due_date ? 'vence ' + date(r.due_date) : 'sem data'}</span>`}</td>
        <td data-l="Descrição"><div class="cell-title">${r.description}</div></td>
        <td data-l="Cliente / favorecido">${r.party || '—'}</td>
        <td data-l="Projeto">${r.project_name || '—'}</td>
        <td data-l="Categoria"><div>${r.kind}</div>${r.category ? html`<div class="cell-sub">${r.category}</div>` : ''}</td>
        <td data-l="Tipo">${r.dir === 'entrada' ? html`<span class="io in">Entrada</span>` : html`<span class="io out">Saída</span>`}</td>
        <td class="right num nw" data-l="Valor"><b class="${r.dir === 'entrada' ? 'success-text' : ''}">${r.dir === 'entrada' ? '+ ' : '− '}${money(r.amount)}</b></td>
        <td data-l="Conta">${r.account}</td>
        <td data-l="Situação">${r.informed_at && !r.realized ? html`<span class="badge warning">Informado — conferir</span>` : badge(r.tbl === 'incomes' ? 'INCOME_STATUS' : 'EXPENSE_STATUS', r.status)}</td>
        <td data-l="Comprovante">${r.docs ? html`<span class="row gap-4">${icon('clip', 'sm')}${r.docs}</span>` : html`<span class="muted">—</span>`}</td>
        <td class="actions"><button class="icon-btn" data-act="${i}">${icon('more')}</button></td></tr>`) : html`<tr><td colspan="11"><div class="empty sm">Nenhum lançamento neste filtro.</div></td></tr>`}</tbody></table></div>`);
    out.querySelector('[data-t]').appendChild(t);
    t.onclick = async (e) => {
      const a = e.target.closest('[data-act]'); const tr = e.target.closest('tr[data-i]'); if (!tr) return;
      const r = d.rows[tr.dataset.i]; const res = r.tbl;
      if (!a) return entryDrawer(res, r.id, load);
      e.stopPropagation();
      const full = await api.get(`/r/${res}/${r.id}`);
      menu(a, [
        !isPaid(res, full) && full.status !== 'cancelado' ? { label: full.informed_at ? 'Conferir pagamento informado' : res === 'incomes' ? 'Registrar recebimento' : 'Registrar pagamento', icon: 'check', fn: () => payDialog(res, full, load) } : null,
        isPaid(res, full) ? { label: 'Estornar', icon: 'refresh', fn: () => reverseDialog(res, full, load) } : null,
        { label: 'Editar', icon: 'edit', fn: () => openForm(res, { id: r.id, onSaved: load }) },
        { label: 'Ver detalhes e histórico', icon: 'list', fn: () => entryDrawer(res, r.id, load) },
      ]);
    };
    const ib = out.querySelector('[data-inf]'); if (ib) ib.onclick = () => informedDrawer(load);
  }
  await load();
  if (qy.status === 'informado') informedDrawer(load);
}

// fila de pagamentos informados pelos clientes
export async function informedDrawer(onChange) {
  const body = el('<div><div class="empty sm">Carregando…</div></div>');
  const d = drawer({ title: 'Pagamentos informados pelos clientes', sub: 'Aguardando conferência', body });
  const load = async () => {
    const rows = await api.get('/finance/informed');
    body.innerHTML = toHTML(rows.length ? html`<p class="small muted" style="margin-top:0">Confira cada valor no extrato bancário (ou com o fornecedor) antes de confirmar. Nada é marcado como pago automaticamente.</p>
      <div class="list">${rows.map((r, i) => html`<div class="list-item top"><div class="grow" style="min-width:0"><div class="li-title">${r.description}</div>
        <div class="li-sub">${[r.client_name, r.project_name, r.tbl === 'expenses' ? 'obra' : 'honorários'].filter(Boolean).join(' · ')}</div>
        <div class="small mt-4">Informado por ${r.informed_by_name || 'cliente'} em ${datetime(r.informed_at)} · ${money(r.informed_amount)} pago em ${date(r.informed_date)}${r.tbl === 'expenses' ? ` · ${r.informed_payer === 'escritorio' ? 'pelo escritório' : 'pelo cliente'}` : ''}</div>
        ${r.informed_note ? html`<div class="small muted">“${r.informed_note}”</div>` : ''}
        ${r.informed_doc_id ? html`<a class="small" href="${fileUrl({ id: r.informed_doc_id }, true)}" target="_blank" rel="noopener">${icon('clip', 'sm')} Comprovante</a>` : html`<span class="small muted">Sem comprovante anexado</span>`}</div>
        <div class="col" style="gap:6px"><button class="btn sm primary" data-ok="${i}">Conferir</button></div></div>`)}</div>` : html`<div class="empty">Nenhum pagamento aguardando conferência.</div>`);
    body.onclick = async (e) => { const b = e.target.closest('[data-ok]'); if (!b) return; const r = rows[b.dataset.ok]; const full = await api.get(`/r/${r.tbl}/${r.id}`); payDialog(r.tbl, full, () => { load(); onChange && onChange(); }); };
  };
  load().catch(fail);
  return d;
}

// ------------------------------ FINANCEIRO DAS OBRAS ------------------------------
export async function worksPage(ctx, root, { newEntry, entryDrawer }) {
  const pid = Number(ctx.query.projeto) || null;
  const list = await api.get('/finance/works');
  root.innerHTML = toHTML(html`${areaHead('obras', { actions: pid ? html`<button class="btn primary" data-item>${icon('plus')} Lançar item da obra</button>` : '' })}
    <div class="card fin-filters"><div class="fin-frow"><span class="small muted">Obra</span><span data-sel style="min-width:min(420px,100%)"></span>${pid ? html`<a class="btn sm ghost" href="#/projetos/${pid}">Abrir projeto</a>` : ''}</div></div>
    <div data-out></div>`);
  const opts = list.map((p) => ({ id: p.id, label: `${p.name}${p.client_name ? ' — ' + p.client_name : ''}`, sub: p.items ? `${p.items} parcela(s) · ${money(p.aberto)} em aberto` : 'sem itens lançados' }));
  root.querySelector('[data-sel]').appendChild(combo({ name: 'projeto', options: opts, value: pid || '', placeholder: 'Escolha o projeto ou cliente…', onChange: (v) => ctx.go(v ? `#/financeiro/obras?projeto=${v}` : '#/financeiro/obras') }));
  const out = root.querySelector('[data-out]');
  if (!pid) {
    const act = list.filter((p) => p.items || p.quotes);
    out.innerHTML = toHTML(act.length ? html`<div class="section-title">Obras com movimento</div><div class="grid g3">${act.map((p) => html`<a class="card click obra-card" href="#/financeiro/obras?projeto=${p.id}">
        <div class="cell-title">${p.name}</div><div class="cell-sub">${p.client_name || ''}</div>
        <div class="row between mt-8 small"><span>Pago</span><b>${money(p.pago)}</b></div><div class="row between small"><span>Em aberto</span><b>${money(p.aberto)}</b></div>
        ${p.vencidas ? html`<div class="small danger-text mt-4">${p.vencidas} parcela(s) vencida(s)</div>` : ''}${p.informados ? html`<div class="small warning-text">${p.informados} pagamento(s) informado(s) — conferir</div>` : ''}</a>`)}</div>`
      : html`<div class="empty">Nenhuma obra com itens lançados. Escolha um projeto acima para começar.</div>`);
    return;
  }
  const reload = () => ctx.rerender();
  let w; try { w = await api.get(`/finance/works/${pid}`); } catch (e) { return fail(e); }
  const T = w.totals; const pt = w.pass_through;
  const venc = w.overdue.reduce((s, x) => s + x.amount, 0);
  out.innerHTML = toHTML(html`
    <div class="grid g4 fin-kpis">
      <div class="card kpi"><span class="label">Total aprovado / contratado</span><span class="value sm">${money(T.contratado)}</span><span class="foot">somente orçamentos aprovados</span></div>
      <div class="card kpi"><span class="label">Total pago</span><span class="value sm">${money(T.pago)}</span><span class="foot">cliente direto ${money(T.pago_cliente)} · escritório ${money(T.pago_escritorio)}</span></div>
      <div class="card kpi strong"><span class="label">Saldo a pagar</span><span class="value sm">${money(T.a_pagar)}</span><span class="foot">contratado − pago</span></div>
      <div class="card kpi ${w.overdue.length ? 'alert' : ''}"><span class="label">Parcelas vencidas</span><span class="value sm">${w.overdue.length}</span><span class="foot">${w.overdue.length ? money(venc) : 'nenhuma'}</span></div>
    </div>
    ${w.informed && w.informed.length ? html`<div class="card flat mt-16"><div class="row gap-8 mb-8">${icon('bell', 'sm')} <b>Pagamentos informados pelo cliente — aguardando conferência</b></div>
      ${w.informed.map((x) => html`<div class="row between wrap small mt-4"><span>${x.description} · ${money(x.informed_amount)} em ${date(x.informed_date)}${x.informed_note ? ` · “${x.informed_note}”` : ''}</span><button class="btn xs primary" data-conf="${x.id}">Conferir</button></div>`)}</div>` : ''}
    <div class="grid g2 mt-16">
      <div class="card"><div class="card-head"><h3>Próximos vencimentos</h3></div>${w.next.length ? html`<div class="list">${w.next.map((x) => html`<div class="list-item"><div class="grow" style="min-width:0"><div class="li-title">${x.description}</div><div class="li-sub">${x.supplier || ''}</div></div><div class="right"><b class="num">${money(x.amount)}</b><div class="small muted">${date(x.due_date)}</div></div></div>`)}</div>` : html`<div class="empty sm">Nenhum vencimento futuro com data.</div>`}</div>
      <div class="card"><div class="card-head"><h3>Vencidas</h3></div>${w.overdue.length ? html`<div class="list">${w.overdue.map((x) => html`<div class="list-item"><div class="grow" style="min-width:0"><div class="li-title">${x.description}</div><div class="li-sub">${x.supplier || ''}</div></div><div class="right"><b class="num">${money(x.amount)}</b><div class="small late">${date(x.due_date)}</div></div></div>`)}</div>` : html`<div class="empty sm">Nada vencido.</div>`}</div>
    </div>
    <div class="section-title">Serviços contratados e pagamentos</div>
    <div data-groups class="col" style="gap:16px">${w.groups.length ? '' : html`<div class="empty sm">Nenhum item lançado nesta obra.</div>`}</div>
    ${w.approved_without_parcels.length ? html`<div class="section-title">Aprovados sem parcelas lançadas</div><div class="card"><div class="list">${w.approved_without_parcels.map((q) => html`<div class="list-item"><div class="grow"><div class="li-title">${q.service}</div><div class="li-sub">${q.supplier || 'Fornecedor não informado'}</div></div><b class="num">${money(q.total)}</b><button class="btn xs" data-fromq="${q.quote_id}">Lançar parcelas</button></div>`)}</div></div>` : ''}
    ${w.pending_quotes.length ? html`<div class="section-title">Orçamentos aguardando aprovação <span class="small muted">— não somados aos valores acima</span></div><div class="card"><div class="list">${w.pending_quotes.map((q) => html`<div class="list-item"><div class="grow"><div class="li-title">${q.item}</div><div class="li-sub">${q.supplier || 'Fornecedor não informado'}</div></div><span class="muted num">${q.amount ? money(q.amount) : 'sem valor'}</span><span class="badge muted">Aguardando aprovação</span></div>`)}</div></div>` : ''}
    ${pt ? html`<div class="section-title">Recursos do cliente e adiantamentos <span class="small muted">— mesmos lançamentos do caixa do escritório</span></div>
      <div class="grid g2"><div class="card"><div class="card-head"><h3>Recurso de cliente para repasse</h3><button class="btn xs" data-rep>${icon('plus', 'sm')} Registrar recurso recebido</button></div>
        <div class="split-rows"><div><span>Recebido do cliente</span><b>${money(pt.repasse_recebido)}</b></div><div><span>Usado para pagar fornecedores</span><b>${money(pt.repasse_usado)}</b></div><div><span>Saldo do cliente em poder do escritório</span><b class="${pt.repasse_saldo < 0 ? 'danger-text' : ''}">${money(pt.repasse_saldo)}</b></div></div></div>
      <div class="card"><div class="card-head"><h3>Adiantamentos do escritório</h3><button class="btn xs" data-reb>${icon('plus', 'sm')} Registrar reembolso</button></div>
        <div class="split-rows"><div><span>Adiantado pelo escritório</span><b>${money(pt.adiantado)}</b></div><div><span>Reembolsado pelo cliente</span><b>${money(pt.reembolsado)}</b></div><div><span>A reembolsar</span><b class="${pt.a_reembolsar > 0 ? 'warning-text' : ''}">${money(pt.a_reembolsar)}</b></div></div></div></div>` : ''}`);
  const gbox = out.querySelector('[data-groups]');
  w.groups.forEach((g) => gbox.appendChild(groupCard(g, w, { reload, entryDrawer })));
  const project = { id: w.project.id, name: w.project.name, client_id: w.project.client_id };
  const ib = root.querySelector('[data-item]'); if (ib) ib.onclick = () => obraItemDrawer(project, {}, reload);
  $$('[data-fromq]', out).forEach((b) => (b.onclick = () => obraItemDrawer(project, { quote_id: Number(b.dataset.fromq) }, reload)));
  $$('[data-conf]', out).forEach((b) => (b.onclick = async () => payDialog('expenses', await api.get(`/r/expenses/${b.dataset.conf}`), reload)));
  const rb = out.querySelector('[data-rep]'); if (rb) rb.onclick = () => newEntry('incomes', { project_id: project.id, client_id: project.client_id, nature: 'repasse', category: 'Repasse de cliente' }, reload);
  const eb = out.querySelector('[data-reb]'); if (eb) eb.onclick = () => newEntry('incomes', { project_id: project.id, client_id: project.client_id, nature: 'reembolso', category: 'Reembolso' }, reload);
  if (ctx.query.item) { const it = Number(ctx.query.item); const g = w.groups.find((x) => x.parcels.some((p) => p.id === it)); if (g) payDialog('expenses', await api.get(`/r/expenses/${it}`), reload); }
}

function groupCard(g, w, { reload, entryDrawer }) {
  const pct = g.total ? Math.min(100, (g.paid / g.total) * 100) : 0;
  const card = el(html`<div class="card obra-group">
    <div class="row between wrap top gap-8"><div style="min-width:0"><div class="cell-title" style="font-size:15px">${g.service}</div><div class="cell-sub">${g.supplier || 'Fornecedor não informado'}</div></div>
      <div class="obra-sum"><div><span>Contratado</span><b>${money(g.total)}</b></div><div><span>Pago</span><b>${money(g.paid)}</b></div><div><span>Falta</span><b>${money(g.remaining)}</b></div></div></div>
    <div class="progress mt-8"><span style="width:${pct}%"></span></div>
    ${g.unscheduled > 0.009 ? html`<div class="small warning-text mt-8">${money(g.unscheduled)} do valor contratado ainda não tem parcela lançada.</div>` : ''}
    <div class="table-wrap mt-12"><table class="t responsive compact"><thead><tr><th>Parcela / etapa</th><th class="right">Valor</th><th>Vencimento</th><th>Pagamento</th><th>Pago por → recebido por</th><th>Situação</th><th>Comprov.</th><th></th></tr></thead>
    <tbody>${g.parcels.map((p, i) => html`<tr data-i="${i}" class="click">
      <td class="primary" data-l="Parcela / etapa">${p.stage}${p.split ? html`<div class="cell-sub">saldo de pagamento parcial</div>` : ''}${p.notes ? html`<div class="cell-sub">${p.notes}</div>` : ''}</td>
      <td class="right num nw" data-l="Valor">${money(p.amount)}</td>
      <td data-l="Vencimento" class="${p.status === 'vencido' ? 'late' : ''}">${p.due_date ? date(p.due_date) : html`<span class="muted">Na finalização — data a definir</span>`}</td>
      <td data-l="Pagamento">${p.paid_at ? date(p.paid_at) : '—'}${p.method ? html`<div class="cell-sub">${label('PAYMENT_METHODS', p.method)}</div>` : ''}</td>
      <td data-l="Pago por → recebido por">${p.paid_by === 'cliente' ? 'Cliente' : p.paid_by === 'escritorio' ? 'Escritório' : html`<span class="muted">${p.planned_payer === 'escritorio' ? 'previsto: escritório' : 'previsto: cliente'}</span>`} → ${p.payee || '—'}${p.paid_by === 'escritorio' && p.funding ? html`<div class="cell-sub">${p.funding === 'repasse' ? 'com recurso do cliente' : p.funding === 'adiantamento' ? 'adiantamento a reembolsar' : 'custo do escritório'}</div>` : ''}</td>
      <td data-l="Situação">${statusBadge(p)}</td>
      <td data-l="Comprovante">${p.files && p.files.length ? p.files.map((f) => html`<a href="${fileUrl(f, true)}" target="_blank" rel="noopener" title="${f.title}" class="icon-link">${icon('clip', 'sm')}</a>`) : html`<span class="muted">—</span>`}</td>
      <td class="actions nw">${!p.status.startsWith('pago') ? html`<button class="btn xs ${p.status === 'informado' ? '' : 'primary'}" data-pay="${i}">${p.status === 'informado' ? 'Conferir' : 'Registrar pagamento'}</button>` : ''}<button class="icon-btn" data-act="${i}">${icon('more')}</button></td></tr>`)}</tbody></table></div></div>`);
  card.onclick = async (e) => {
    const tr = e.target.closest('tr[data-i]'); if (!tr) return; const p = g.parcels[tr.dataset.i];
    const pay = e.target.closest('[data-pay]'); const act = e.target.closest('[data-act]');
    if (e.target.closest('a')) return;
    if (pay) { e.stopPropagation(); return payDialog('expenses', { ...(await api.get(`/r/expenses/${p.id}`)), stage: p.stage, planned_payer: p.planned_payer }, reload); }
    if (act) {
      e.stopPropagation(); const full = await api.get(`/r/expenses/${p.id}`);
      return menu(act, [
        p.status.startsWith('pago') ? { label: 'Estornar pagamento', icon: 'refresh', fn: () => reverseDialog('expenses', full, reload) } : { label: 'Registrar pagamento', icon: 'check', fn: () => payDialog('expenses', { ...full, stage: p.stage }, reload) },
        { label: 'Editar parcela', icon: 'edit', fn: () => openForm('expenses', { id: p.id, onSaved: reload }) },
        { label: 'Anexar comprovante', icon: 'clip', fn: () => attachProof(p.id, reload) },
        { label: full.client_visible ? 'Ocultar do cliente' : 'Mostrar ao cliente', icon: 'eye', fn: async () => { await api.put(`/r/expenses/${p.id}`, { client_visible: full.client_visible ? 0 : 1 }); reload(); } },
        { label: 'Detalhes e histórico', icon: 'list', fn: () => entryDrawer('expenses', p.id, reload) },
      ]);
    }
    entryDrawer('expenses', p.id, reload);
  };
  return card;
}
export const statusBadge = (p) => {
  const cls = { pago_cliente: 'success', pago_escritorio: 'success', informado: 'warning', vencido: 'danger', sem_data: 'muted', aguardando: 'info', cancelado: 'muted' }[p.status] || 'info';
  return html`<span class="badge ${cls}">${p.status_label}</span>`;
};
function attachProof(id, onDone) {
  const inp = el('<input type="file" accept="image/*,application/pdf" class="hidden">'); document.body.appendChild(inp);
  inp.onchange = async () => { try { await uploadFiles(inp.files, { entity: 'expenses', entity_id: id, category: 'Comprovantes' }); toast('Comprovante anexado.'); onDone && onDone(); } catch (e) { fail(e); } inp.remove(); };
  inp.click();
}

// ------------------------------ LANÇAR ITEM DA OBRA ------------------------------
// Serviço + fornecedor + total; parcela única, N parcelas ou etapas (Entrada / Intermediária / Finalização).
const TEMPLATES = [
  ['Entrada + Finalização', [['Entrada', 50], ['Finalização', 50]]],
  ['Entrada + Intermediária + Finalização', [['Entrada', 30], ['Intermediária', 40], ['Finalização', 30]]],
  ['Sinal 50% + 2 parcelas', [['Entrada', 50], ['Intermediária', 25], ['Finalização', 25]]],
];
export async function obraItemDrawer(project, preset = {}, onDone) {
  const quotes = (await api.get(`/r/quotes?f_project_id=${project.id}&limit=500`).catch(() => ({ rows: [] }))).rows.filter((q) => q.status !== 'recusado');
  const dk = draftKey('obra-item', { p: project.id, q: preset.quote_id }); const draft = draftGet(dk) || {};
  const q0 = quotes.find((q) => q.id === preset.quote_id);
  const v = { service: q0 ? q0.item : '', supplier_id: q0 ? q0.supplier_id : '', total: q0 && q0.amount > 0 ? q0.amount : '', mode: 'etapas', paid_by: 'cliente', funding: 'adiantamento', first_due: today(), count: 3, interval: 1, client_visible: 1, quote_id: preset.quote_id || '', ...draft, ...preset };
  let stages = draft.stages || TEMPLATES[0][1].map(([l, p]) => ({ label: l, percent: p, due_date: l === 'Entrada' ? today() : '' }));
  const body = el(html`<div class="obra-form">
    <p class="small muted" style="margin-top:0">${project.name}. O item fica no <b>financeiro da obra</b>; só passa pelo caixa do escritório quando o escritório pagar.</p>
    <form class="form-grid" novalidate>
      ${quotes.length ? html`<div class="field wide"><label>A partir de um orçamento <span class="muted small">(opcional)</span></label><select name="quote_id"><option value="">— lançar sem orçamento —</option>${quotes.map((q) => html`<option value="${q.id}" ${String(q.id) === String(v.quote_id) ? 'selected' : ''}>${q.item} — ${q.supplier_name || 'sem fornecedor'}${q.amount > 0 ? ' · ' + money(q.amount) : ''}${q.status === 'contratado' ? ' (contratado)' : ''}</option>`)}</select><span class="hint">Preenche serviço, fornecedor e valor automaticamente.</span></div>` : ''}
      <div class="field wide"><label>Serviço <span class="req">*</span></label><input name="service" value="${v.service}" placeholder="Ex.: Marcenaria da cozinha"></div>
      <div class="field"><label>Fornecedor</label><span data-sup></span></div>
      <div class="field"><label>Valor total contratado <span class="req">*</span></label><div class="money-input"><span>R$</span><input type="number" step="0.01" name="total" value="${v.total}" inputmode="decimal" placeholder="0,00"></div></div>
      <div class="field wide"><label>Como será pago</label><div class="seg" data-mode>${[['unica', 'Parcela única'], ['parcelas', 'Em parcelas'], ['etapas', 'Por etapas']].map(([k, l]) => html`<button type="button" data-v="${k}" class="${v.mode === k ? 'on' : ''}">${l}</button>`)}</div></div>
      <div class="wide" data-m="unica"><div class="form-grid"><div class="field"><label>Vencimento</label><input type="date" name="first_due_u" value="${v.first_due || ''}"></div>
        <div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" name="no_date_u" ${v.first_due ? '' : 'checked'}> Na finalização — data a definir</label></div></div></div>
      <div class="wide" data-m="parcelas"><div class="form-grid"><div class="field"><label>Quantidade de parcelas</label><input type="number" name="count" min="2" max="60" value="${v.count}"></div>
        <div class="field"><label>1º vencimento</label><input type="date" name="first_due" value="${v.first_due || today()}"></div>
        <div class="field"><label>Intervalo (meses)</label><input type="number" name="interval" min="1" max="12" value="${v.interval}"></div></div></div>
      <div class="wide" data-m="etapas"><div class="chips mb-8" data-tpl>${TEMPLATES.map(([l], i) => html`<button type="button" class="chip" data-t="${i}">${l}</button>`)}</div><div data-stages></div>
        <button type="button" class="btn xs mt-8" data-add-stage>${icon('plus', 'sm')} Adicionar etapa</button><div class="small muted mt-4">Deixe a data em branco quando for “na finalização — data a definir”.</div></div>
      <div class="wide small" data-preview></div>
      <div class="field wide"><label>Quem vai pagar o fornecedor?</label><div class="seg" data-payer>
        <button type="button" data-v="cliente" class="${v.paid_by === 'cliente' ? 'on' : ''}">Cliente paga direto ao fornecedor</button>
        <button type="button" data-v="escritorio" class="${v.paid_by === 'escritorio' ? 'on' : ''}">Escritório paga ao fornecedor</button></div><span class="hint" data-ph></span></div>
      <div class="field wide" data-fund><label>Com qual dinheiro?</label><select name="funding">${FUND.map(([k, l]) => html`<option value="${k}" ${k === v.funding ? 'selected' : ''}>${l}</option>`)}</select></div>
      <details class="more-details wide"><summary>Mais detalhes <span class="muted small">(categoria, portal do cliente, observação)</span></summary><div class="form-grid">
        <div class="field"><label>Categoria</label><input name="category" value="${v.category || 'Obra'}"></div>
        <div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" name="client_visible" ${v.client_visible ? 'checked' : ''}> Mostrar ao cliente no portal</label></div>
        <div class="field wide"><label>Observação</label><input name="notes" value="${v.notes || ''}" placeholder="Ex.: condições combinadas com o fornecedor"></div></div></details>
    </form></div>`);
  const form = body.querySelector('form'); const q = (s) => body.querySelector(s);
  if (Object.keys(draft).length) body.prepend(draftBanner(dk, () => { d.close(); obraItemDrawer(project, preset, onDone); }));
  const sup = combo({ name: 'supplier_id', options: refOptions('suppliers'), value: v.supplier_id || '', placeholder: 'Selecionar fornecedor…' }); q('[data-sup]').appendChild(sup);
  let mode = v.mode; let payer = v.paid_by;
  const total = () => Number(form.total.value) || 0;
  const renderStages = () => {
    q('[data-stages]').innerHTML = toHTML(html`<div class="stage-rows">${stages.map((s, i) => html`<div class="stage-row" data-r="${i}">
      <input class="input" data-f="label" value="${s.label}" placeholder="Etapa">
      <div class="money-input pct"><span>%</span><input type="number" class="input" data-f="percent" value="${s.percent ?? ''}" step="0.01"></div>
      <div class="money-input"><span>R$</span><input type="number" class="input" data-f="amount" value="${s.amount ?? (total() ? round(total() * (s.percent || 0) / 100) : '')}" step="0.01"></div>
      <input type="date" class="input" data-f="due_date" value="${s.due_date || ''}" title="Vazio = na finalização">
      <button type="button" class="icon-btn" data-rm="${i}" title="Remover">${icon('x', 'sm')}</button></div>`)}</div>`);
  };
  const round = (n) => Math.round(n * 100) / 100;
  const preview = () => {
    $$('[data-mode] button', body).forEach((b) => b.classList.toggle('on', b.dataset.v === mode));
    $$('[data-m]', body).forEach((x) => x.classList.toggle('hidden', x.dataset.m !== mode));
    $$('[data-payer] button', body).forEach((b) => b.classList.toggle('on', b.dataset.v === payer));
    q('[data-fund]').classList.toggle('hidden', payer !== 'escritorio');
    q('[data-ph]').textContent = payer === 'cliente' ? 'Os pagamentos ficam só no financeiro da obra — não movimentam o caixa do escritório.' : 'Cada pagamento sai do caixa do escritório e fica ligado a esta obra.';
    const t = total(); let txt = '';
    if (mode === 'etapas') { const sum = round(stages.reduce((a, s) => a + (Number(s.amount) || 0), 0)); txt = t ? (Math.abs(sum - t) > 0.05 ? html`<span class="danger-text">Soma das etapas ${money(sum)} — diferente do total ${money(t)}</span>` : html`<span class="success-text">Soma das etapas confere: ${money(sum)}</span>`) : ''; }
    else if (mode === 'parcelas') { const n = Math.max(2, +form.count.value || 2); txt = t ? `${n} parcelas de ${money(t / n)} · 1º vencimento ${date(form.first_due.value)}` : ''; }
    else txt = t ? `Parcela única de ${money(t)} · ${form.no_date_u.checked ? 'na finalização — data a definir' : 'vence ' + date(form.first_due_u.value)}` : '';
    q('[data-preview]').innerHTML = toHTML(txt);
  };
  const readStages = () => { $$('.stage-row', body).forEach((r) => { const s = stages[r.dataset.r]; $$('[data-f]', r).forEach((i) => { s[i.dataset.f] = i.value; }); }); };
  q('[data-stages]').addEventListener('input', (e) => {
    const r = e.target.closest('.stage-row'); if (!r) return; const s = stages[r.dataset.r]; s[e.target.dataset.f] = e.target.value;
    if (e.target.dataset.f === 'percent' && total()) { s.amount = round(total() * (Number(e.target.value) || 0) / 100); r.querySelector('[data-f="amount"]').value = s.amount; }
    if (e.target.dataset.f === 'amount' && total()) { s.percent = round((Number(e.target.value) || 0) / total() * 100); r.querySelector('[data-f="percent"]').value = s.percent; }
    preview();
  });
  q('[data-stages]').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; readStages(); stages.splice(+b.dataset.rm, 1); renderStages(); preview(); };
  q('[data-add-stage]').onclick = () => { readStages(); stages.push({ label: 'Etapa', percent: '', amount: '', due_date: '' }); renderStages(); preview(); };
  q('[data-tpl]').onclick = (e) => { const c = e.target.closest('[data-t]'); if (!c) return; stages = TEMPLATES[c.dataset.t][1].map(([l, p]) => ({ label: l, percent: p, amount: total() ? round(total() * p / 100) : '', due_date: l === 'Entrada' ? today() : '' })); renderStages(); preview(); };
  q('[data-mode]').onclick = (e) => { const b = e.target.closest('button'); if (b) { mode = b.dataset.v; preview(); } };
  q('[data-payer]').onclick = (e) => { const b = e.target.closest('button'); if (b) { payer = b.dataset.v; preview(); } };
  form.total.addEventListener('input', () => { stages.forEach((s) => { if (s.percent !== '' && s.percent !== undefined) s.amount = round(total() * Number(s.percent) / 100); }); renderStages(); preview(); });
  form.addEventListener('input', preview); form.addEventListener('change', preview);
  if (form.quote_id) form.quote_id.onchange = () => { const qq = quotes.find((x) => String(x.id) === form.quote_id.value); if (!qq) return; form.service.value = qq.item; sup.combo.set(qq.supplier_id || ''); if (qq.amount > 0) { form.total.value = qq.amount; form.total.dispatchEvent(new Event('input')); } };
  renderStages(); preview();
  const read = () => { readStages(); const f = Object.fromEntries(new FormData(form).entries()); return { ...f, supplier_id: sup.combo.get(), mode, paid_by: payer, stages, client_visible: form.client_visible.checked ? 1 : 0 }; };
  draftWatch(form, dk, read);
  const d = drawer({ title: 'Lançar item da obra', sub: 'Financeiro das obras', body });
  d.foot.classList.remove('hidden');
  d.foot.innerHTML = toHTML(html`<button class="btn" data-c>Cancelar</button><button class="btn primary" data-s>Lançar</button>`);
  d.foot.querySelector('[data-c]').onclick = d.close;
  d.foot.querySelector('[data-s]').onclick = async (e) => {
    const x = read();
    if (!x.service.trim()) return toast('Informe o serviço.', { error: true });
    if (!(Number(x.total) > 0)) return toast('Informe o valor total contratado.', { error: true });
    const payload = { service: x.service, supplier_id: x.supplier_id || null, quote_id: x.quote_id || null, total: x.total, mode, paid_by: payer, funding: payer === 'escritorio' ? x.funding : null,
      category: x.category, notes: x.notes, client_visible: x.client_visible, work_id: preset.work_id || null };
    if (mode === 'unica') payload.first_due = form.no_date_u.checked ? null : x.first_due_u;
    if (mode === 'parcelas') Object.assign(payload, { count: x.count, first_due: x.first_due, interval: x.interval });
    if (mode === 'etapas') payload.stages = stages.map((s) => ({ label: s.label, amount: s.amount, due_date: s.due_date || null }));
    e.target.disabled = true;
    try { const r = await api.post(`/finance/works/${project.id}/items`, payload); draftClear(dk); invalidateRefs('expenses'); toast(`${r.ids.length} parcela(s) lançada(s) na obra.`); d.close(); onDone && onDone(); }
    catch (err) { fail(err); e.target.disabled = false; }
  };
  return d;
}

// ------------------------------ CONFERIR LANÇAMENTOS ANTIGOS ------------------------------
const DEC_EXP = [['', 'A conferir — não alterar agora'], ['cliente', 'Cliente pagou direto ao fornecedor (sai do caixa)'], ['escritorio_repasse', 'Escritório pagou com recurso do cliente (repasse)'], ['escritorio_adiantamento', 'Escritório adiantou — a reembolsar'], ['escritorio_proprio', 'Escritório pagou como custo próprio da obra'], ['manter', 'Está certo: despesa do escritório']];
const DEC_INC = [['', 'A conferir — não alterar agora'], ['repasse', 'Recurso de cliente para repasse'], ['reembolso', 'Reembolso de adiantamento'], ['manter', 'Está certo: honorários']];
export async function reviewPage(ctx, root) {
  const d = await api.get('/finance/review');
  const rows = [...d.expenses, ...d.incomes];
  root.innerHTML = toHTML(html`${areaHead('caixa', { tab: 'conferir', review: rows.length })}
    <div class="card flat mb-16"><b>Como funciona</b><p class="small muted" style="margin:6px 0 0">Aqui aparecem lançamentos antigos que estão como <b>despesa do escritório</b> mas têm sinais de serem pagamentos de obra (ligados a orçamento, obra ou fornecedor de um projeto), e entradas que mencionam repasse ou reembolso.
      Nada é presumido: escolha a classificação certa só quando tiver certeza (extrato, comprovante, conversa com o cliente). Os valores, datas, comprovantes e o histórico são preservados — só muda a classificação.
      Antes de aplicar, o sistema faz automaticamente uma <b>cópia de segurança completa</b>. Nenhum pagamento é apagado e nenhuma movimentação nova é criada.</p></div>
    ${rows.length ? html`<div class="col review" style="gap:12px">${rows.map((r, i) => html`<div class="card rv-card">
        <div class="rv-main"><div class="row between wrap gap-8"><div style="min-width:0"><div class="cell-title">${r.description}</div><div class="cell-sub">${[date(r.date), r.supplier || r.client, r.project].filter(Boolean).join(' · ')}${r.docs ? ` · ${r.docs} comprovante(s)` : ''}</div></div>
            <div class="right"><b class="num">${money(r.amount)}</b><div class="cell-sub">${label(r.table === 'incomes' ? 'INCOME_STATUS' : 'EXPENSE_STATUS', r.status)}</div></div></div>
          <div class="rv-cls small"><span><span class="muted">Hoje:</span> ${r.current}</span><span class="muted">→</span><span><span class="muted">Proposta:</span> ${r.proposed}</span></div>
          <div class="small"><span class="muted">Evidências:</span> ${r.evidence.join('; ')}.${r.hint ? html` <span class="muted">${r.hint}</span>` : ''}</div></div>
        <div class="rv-dec"><label class="small muted">Decisão</label><select data-dec="${i}">${(r.table === 'incomes' ? DEC_INC : DEC_EXP).map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select><input class="input" data-note="${i}" placeholder="Como confirmou? (opcional)"></div></div>`)}</div>
      <div class="row between wrap mt-16"><span class="small muted" data-count>Nenhuma decisão selecionada.</span><button class="btn primary" data-apply disabled>Aplicar decisões</button></div>`
    : html`<div class="empty">Nenhum lançamento antigo pendente de conferência.</div>`}`);
  if (!rows.length) return;
  const sel = () => rows.map((r, i) => ({ table: r.table, id: r.id, decision: root.querySelector(`[data-dec="${i}"]`).value, note: root.querySelector(`[data-note="${i}"]`).value })).filter((x) => x.decision);
  root.addEventListener('change', () => { const n = sel().length; root.querySelector('[data-count]').textContent = n ? `${n} decisão(ões) selecionada(s). Os demais continuam “a conferir”.` : 'Nenhuma decisão selecionada.'; root.querySelector('[data-apply]').disabled = !n; });
  root.querySelector('[data-apply]').onclick = async () => {
    const dec = sel();
    if (!(await confirmDialog(`Aplicar ${dec.length} decisão(ões)? Antes de alterar, será criada uma cópia de segurança completa. Valores, datas e comprovantes não mudam — só a classificação.`, { title: 'Confirmar reclassificação', ok: 'Fazer backup e aplicar' }))) return;
    try { const r = await api.post('/finance/review/apply', { decisions: dec }); toast(`${r.done.length} lançamento(s) atualizado(s). Backup: ${r.backup}`, { ms: 7000 }); ctx.rerender(); } catch (e) { fail(e); }
  };
}
