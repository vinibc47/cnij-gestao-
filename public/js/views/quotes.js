// Orçamentos de obra: vários orçamentos por item, comparativo e liberação ao cliente
import { S, api, html, el, toHTML, icon, money, date, badge, openForm, modal, toast, fail, menu, today, can, drawer, openPdf } from '../lib.js';
import { rowActions } from './common.js';

export function quotesPanel(quotes, { projectId, workId, onChange }) {
  const box = el('<div></div>');
  const groups = {};
  quotes.forEach((q) => (groups[q.item] = groups[q.item] || []).push(q));
  box.innerHTML = toHTML(html`<div class="row between wrap mb-16"><div class="muted small">Cadastre vários orçamentos para o mesmo item e compare. Libere para o cliente escolher na Área do Cliente.</div>
    <div class="row gap-8">${quotes.length > 1 ? html`<button class="btn sm" data-cmp>${icon('grid')} Comparar orçamentos</button>` : ''}<button class="btn primary sm" data-new>${icon('plus')} Novo orçamento</button></div></div>
    ${Object.keys(groups).length ? html`<div class="grid g2">${Object.entries(groups).map(([item, qs]) => {
      const valid = qs.filter((q) => q.status !== 'recusado');
      const min = Math.min(...valid.filter((q) => q.amount > 0).map((q) => q.amount)); const max = Math.max(...qs.map((q) => q.amount), 1);
      const chosen = qs.find((q) => q.client_selected); const contracted = qs.find((q) => q.status === 'contratado');
      return html`<div class="card"><div class="card-head"><div><h3 class="serif" style="font-size:22px">${item}</h3><div class="small muted">${qs.length} orçamento(s)${valid.length > 1 ? ` · diferença de ${money(Math.max(...valid.map((q) => q.amount)) - min)}` : ''}</div></div>
        <div class="row gap-8">${chosen ? html`<span class="badge success">Cliente escolheu</span>` : ''}${contracted ? html`<span class="badge accent">Contratado</span>` : ''}</div></div>
        <div class="compare">${qs.sort((a, b) => a.amount - b.amount).map((q) => html`<div class="opt ${q.amount === min && q.status !== 'recusado' && valid.length > 1 ? 'best' : ''} ${q.client_selected ? 'chosen' : ''}">
          <div><div class="cell-title">${q.supplier_name || 'Fornecedor não informado'}</div><div class="cell-sub">${[q.received_at ? 'recebido ' + date(q.received_at) : null, q.deadline_days ? q.deadline_days + ' dias' : null, q.valid_until ? 'válido até ' + date(q.valid_until) : null].filter(Boolean).join(' · ')}</div></div>
          <div class="right"><div class="serif num" style="font-size:22px">${q.amount > 0 ? money(q.amount) : html`<span class="muted small">Valor não informado</span>`}</div><div class="row gap-8" style="justify-content:flex-end">${badge('QUOTE_STATUS', q.status)}${q.client_visible ? html`<span class="badge info plain" title="Liberado na Área do Cliente">${icon('eye', 'sm')}</span>` : ''}<button class="icon-btn" data-q="${q.id}">${icon('more')}</button></div></div>
          <div class="bar"><i style="width:${(q.amount / max) * 100}%"></i></div>
          ${q.payment_terms || q.included ? html`<div class="tiny muted" style="grid-column:1/-1">${q.payment_terms ? html`Pagamento: ${q.payment_terms}` : ''}${q.payment_terms && q.included ? ' · ' : ''}${q.included ? `${String(q.included).split(/\n/).filter((x) => x.trim()).length} item(ns) incluído(s)` : ''}</div>` : ''}
          ${q.client_selected ? html`<div class="tiny success-text" style="grid-column:1/-1">✓ Escolhido pelo cliente em ${date(q.client_selected_at)}</div>` : ''}
        </div>`)}</div>
        <div class="row mt-16 gap-8 wrap">${qs.length > 1 ? html`<button class="btn xs" data-cmpi="${item}">${icon('grid', 'sm')} Comparar</button>` : ''}<button class="btn xs" data-add="${item}">${icon('plus', 'sm')} Adicionar opção</button><button class="btn xs" data-share="${item}">${icon('eye', 'sm')} ${qs.every((q) => q.client_visible) ? 'Ocultar do cliente' : 'Liberar ao cliente'}</button></div></div>`;
    })}</div>` : html`<div class="empty">${icon('money')}<div>Nenhum orçamento cadastrado.</div></div>`}`);
  const newQ = (item) => openForm('quotes', { values: { project_id: projectId, work_id: workId, item }, onSaved: onChange });
  box.querySelector('[data-new]').onclick = () => newQ();
  box.onclick = async (e) => {
    const a = e.target.closest('[data-add]'); if (a) return newQ(a.dataset.add);
    if (e.target.closest('[data-cmp]')) { const big = Object.values(groups).sort((x, y) => y.length - x.length)[0]; return compareDrawer(projectId, quotes, big.length > 1 ? big.map((q) => q.id) : []); }
    const ci = e.target.closest('[data-cmpi]'); if (ci) return compareDrawer(projectId, quotes, groups[ci.dataset.cmpi].map((q) => q.id));
    const s = e.target.closest('[data-share]');
    if (s) { const qs = groups[s.dataset.share]; const v = qs.every((q) => q.client_visible) ? 0 : 1; await Promise.all(qs.map((q) => api.put(`/r/quotes/${q.id}`, { client_visible: v }))); toast(v ? 'Orçamentos liberados na Área do Cliente.' : 'Orçamentos ocultados.'); return onChange(); }
    const b = e.target.closest('[data-q]'); if (!b) return;
    const q = quotes.find((x) => x.id == b.dataset.q);
    const setStatus = (st) => async () => { await api.put(`/r/quotes/${q.id}`, { status: st }); toast('Status atualizado.'); onChange(); };
    menu(b, [
      { header: 'Status' },
      ...S.meta.lists.QUOTE_STATUS.filter((o) => o.value !== q.status).map((o) => ({ label: o.label, fn: setStatus(o.value) })),
      '-',
      S.user.finance ? { label: 'Contratar e lançar despesa', icon: 'wallet', fn: () => toExpense(q, onChange) } : null,
      { label: q.client_visible ? 'Ocultar do cliente' : 'Liberar ao cliente', icon: 'eye', fn: async () => { await api.put(`/r/quotes/${q.id}`, { client_visible: q.client_visible ? 0 : 1 }); onChange(); } },
      ...rowActions('quotes', q, { onChange, title: `${q.item} — ${q.supplier_name || ''}` }),
    ]);
  };
  return box;
}

function toExpense(q, onChange) {
  modal({ title: 'Contratar orçamento', body: html`<p class="small muted" style="margin-top:0">${q.item} · ${q.supplier_name || ''} · ${money(q.amount)}. Serão criadas as contas a pagar vinculadas ao projeto/obra.</p>
    <div class="form-grid"><div class="field"><label>Valor total</label><input type="number" step="0.01" id="t" value="${q.amount}"></div>
    <div class="field"><label>Parcelas</label><input type="number" id="n" value="1" min="1"></div>
    <div class="field"><label>1º vencimento</label><input type="date" id="d" value="${today()}"></div>
    <div class="field"><label>Quem paga</label><select id="pb"><option value="escritorio">Escritório</option><option value="cliente">Cliente (direto ao fornecedor)</option></select></div></div>`,
  actions: [{ label: 'Cancelar' }, { label: 'Contratar', primary: true, fn: async (m) => {
    const r = await api.post(`/quotes/${q.id}/to-expense`, { total: m.querySelector('#t').value, count: m.querySelector('#n').value, first_due: m.querySelector('#d').value, paid_by: m.querySelector('#pb').value });
    toast(`Contratado · ${r.ids.length} lançamento(s) criado(s).`); onChange();
  } }] });
}

// Comparativo lado a lado: dados vêm dos orçamentos cadastrados; o que faltar aparece como "Não informado"
export function compareDrawer(projectId, quotes, preselect) {
  const sel = new Set(preselect.length ? preselect : quotes.filter((q) => q.status !== 'recusado').map((q) => q.id));
  const body = el(html`<div><div class="small muted mb-12">Selecione os orçamentos que deseja comparar.</div>
    <div class="cmp-pick">${quotes.map((q) => html`<label class="check"><input type="checkbox" value="${q.id}" ${sel.has(q.id) ? 'checked' : ''}> <span>${q.item} — ${q.supplier_name || 'Fornecedor não informado'}${q.amount > 0 ? ` · ${money(q.amount)}` : ''}</span></label>`)}</div>
    <div data-out class="mt-16"></div></div>`);
  const NI = html`<span class="muted ni">Não informado</span>`;
  const list = (a) => (a && a.length ? html`<ul class="cmp-ul">${a.map((x) => html`<li>${x}</li>`)}</ul>` : NI);
  const val = (v) => (v === null || v === undefined || v === '' ? NI : v);
  const load = async () => {
    const out = body.querySelector('[data-out]');
    const ids = [...sel];
    if (ids.length < 2) { out.innerHTML = toHTML(html`<div class="empty sm">Selecione ao menos dois orçamentos.</div>`); return; }
    try {
      const c = await api.get(`/projects/${projectId}/quotes-compare?ids=${ids.join(',')}`);
      const rows = [
        ['Categoria / serviço', (q) => val(q.category)],
        ['Valor', (q) => (q.amount ? html`<b>${money(q.amount)}</b>${q.amount === c.min ? html` <span class="badge success">menor</span>` : ''}` : NI)],
        ['Prazo de execução', (q) => val(q.deadline)],
        ['Condições de pagamento', (q) => val(q.payment_terms)],
        ['Itens incluídos', (q) => list(q.included)],
        ['Não incluídos', (q) => list(q.excluded)],
        ['Itens que outros incluem e este não', (q) => (q.missing.length ? html`<ul class="cmp-ul warning-text">${q.missing.map((x) => html`<li>${x}</li>`)}</ul>` : q.scope_informed ? '—' : NI)],
        ['Observações', (q) => val(q.notes)],
        ['Situação', (q) => badge('QUOTE_STATUS', q.status)],
      ];
      out.innerHTML = toHTML(html`${c.warnings.map((w) => html`<div class="callout warn mb-8">${w}</div>`)}
        <div class="table-wrap"><table class="t cmp-table"><thead><tr><th></th>${c.quotes.map((q) => html`<th>${q.supplier}</th>`)}</tr></thead>
        <tbody>${rows.map(([l, f]) => html`<tr><th scope="row">${l}</th>${c.quotes.map((q) => html`<td>${f(q)}</td>`)}</tr>`)}</tbody></table></div>`);
    } catch (e) { fail(e); }
  };
  body.addEventListener('change', (e) => { const i = e.target.closest('input[type=checkbox]'); if (!i) return; if (i.checked) sel.add(Number(i.value)); else sel.delete(Number(i.value)); load(); });
  const foot = el(html`<div class="row gap-8"><span class="grow"></span><button class="btn primary" data-pdf>${icon('print')} Gerar PDF do comparativo</button></div>`);
  foot.querySelector('[data-pdf]').onclick = () => openPdf(`/pdf/quotes-compare/${projectId}?ids=${[...sel].join(',')}`);
  const dr = drawer({ title: 'Comparativo de orçamentos', sub: 'Valores só são equivalentes quando o escopo é o mesmo', body, wide: true });
  dr.foot.appendChild(foot); dr.foot.classList.remove('hidden');
  load();
}
