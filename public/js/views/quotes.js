// Orçamentos de obra: vários orçamentos por item, comparativo e liberação ao cliente
import { S, api, html, el, toHTML, icon, money, date, badge, openForm, modal, toast, fail, menu, today, can } from '../lib.js';
import { rowActions } from './common.js';

export function quotesPanel(quotes, { projectId, workId, onChange }) {
  const box = el('<div></div>');
  const groups = {};
  quotes.forEach((q) => (groups[q.item] = groups[q.item] || []).push(q));
  box.innerHTML = toHTML(html`<div class="row between wrap mb-16"><div class="muted small">Cadastre vários orçamentos para o mesmo item e compare. Libere para o cliente escolher na Área do Cliente.</div>
    <button class="btn primary sm" data-new>${icon('plus')} Novo orçamento</button></div>
    ${Object.keys(groups).length ? html`<div class="grid g2">${Object.entries(groups).map(([item, qs]) => {
      const valid = qs.filter((q) => q.status !== 'recusado');
      const min = Math.min(...valid.map((q) => q.amount)); const max = Math.max(...qs.map((q) => q.amount), 1);
      const chosen = qs.find((q) => q.client_selected); const contracted = qs.find((q) => q.status === 'contratado');
      return html`<div class="card"><div class="card-head"><div><h3 class="serif" style="font-size:22px">${item}</h3><div class="small muted">${qs.length} orçamento(s)${valid.length > 1 ? ` · diferença de ${money(Math.max(...valid.map((q) => q.amount)) - min)}` : ''}</div></div>
        <div class="row gap-8">${chosen ? html`<span class="badge success">Cliente escolheu</span>` : ''}${contracted ? html`<span class="badge accent">Contratado</span>` : ''}</div></div>
        <div class="compare">${qs.sort((a, b) => a.amount - b.amount).map((q) => html`<div class="opt ${q.amount === min && q.status !== 'recusado' && valid.length > 1 ? 'best' : ''} ${q.client_selected ? 'chosen' : ''}">
          <div><div class="cell-title">${q.supplier_name || 'Fornecedor não informado'}</div><div class="cell-sub">${[q.received_at ? 'recebido ' + date(q.received_at) : null, q.deadline_days ? q.deadline_days + ' dias' : null, q.valid_until ? 'válido até ' + date(q.valid_until) : null].filter(Boolean).join(' · ')}</div></div>
          <div class="right"><div class="serif num" style="font-size:22px">${money(q.amount)}</div><div class="row gap-8" style="justify-content:flex-end">${badge('QUOTE_STATUS', q.status)}${q.client_visible ? html`<span class="badge info plain" title="Liberado na Área do Cliente">${icon('eye', 'sm')}</span>` : ''}<button class="icon-btn" data-q="${q.id}">${icon('more')}</button></div></div>
          <div class="bar"><i style="width:${(q.amount / max) * 100}%"></i></div>
          ${q.client_selected ? html`<div class="tiny success-text" style="grid-column:1/-1">✓ Escolhido pelo cliente em ${date(q.client_selected_at)}</div>` : ''}
        </div>`)}</div>
        <div class="row mt-16 gap-8"><button class="btn xs" data-add="${item}">${icon('plus', 'sm')} Adicionar opção</button><button class="btn xs" data-share="${item}">${icon('eye', 'sm')} ${qs.every((q) => q.client_visible) ? 'Ocultar do cliente' : 'Liberar ao cliente'}</button></div></div>`;
    })}</div>` : html`<div class="empty">${icon('money')}<div>Nenhum orçamento cadastrado.</div></div>`}`);
  const newQ = (item) => openForm('quotes', { values: { project_id: projectId, work_id: workId, item }, onSaved: onChange });
  box.querySelector('[data-new]').onclick = () => newQ();
  box.onclick = async (e) => {
    const a = e.target.closest('[data-add]'); if (a) return newQ(a.dataset.add);
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
