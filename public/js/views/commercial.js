import { S, api, html, el, toHTML, icon, money, date, badge, label, openForm, drawer, modal, toast, fail, list, attachments, table, pct, today, addDays, deleteRow, duplicateRow, relDay, $$ } from '../lib.js';
import { listPage, rowActions } from './common.js';
import { entryDrawer } from './finance.js';

export default async function (ctx) {
  if (ctx.base === 'contratos') return contracts(ctx);
  return proposals(ctx);
}

// ------------------------------ PROPOSTAS ------------------------------
async function proposals(ctx) {
  const all = (await list('proposals', { limit: 1000, archived: 'all' })).rows;
  const yr = today().slice(0, 4);
  const decided = all.filter((p) => ['aprovada', 'recusada', 'expirada'].includes(p.status));
  const approved = all.filter((p) => p.status === 'aprovada');
  const open = all.filter((p) => ['enviada', 'visualizada', 'negociacao'].includes(p.status));
  const withContract = approved.filter((p) => p.project_id).length;
  const stats = el(html`<div class="grid g4 mb-24">
    <div class="card kpi"><span class="label">Em negociação</span><span class="value">${money(open.reduce((s, p) => s + p.amount, 0))}</span><span class="foot">${open.length} proposta(s) aguardando</span></div>
    <div class="card kpi"><span class="label">Taxa de conversão</span><span class="value">${decided.length ? pct(Math.round((approved.length / decided.length) * 1000) / 10) : '—'}</span><span class="foot">${approved.length} aprovadas de ${decided.length} decididas</span></div>
    <div class="card kpi"><span class="label">Aprovado em ${yr}</span><span class="value">${money(approved.filter((p) => (p.decided_at || '').startsWith(yr)).reduce((s, p) => s + p.amount, 0))}</span><span class="foot">${withContract} convertida(s) em projeto</span></div>
    <div class="card kpi"><span class="label">Ticket médio (aprovadas)</span><span class="value">${approved.length ? money(approved.reduce((s, p) => s + p.amount, 0) / approved.length) : '—'}</span></div></div>`);
  const page = await listPage({
    root: ctx.root, res: 'proposals', title: 'Propostas', sub: 'Controle comercial: envio, negociação, aprovação e conversão em projetos', query: ctx.query,
    presets: [{ key: 'abertas', label: 'Em aberto' }, { key: 'aguardando', label: 'Aguardando cliente' }, { key: '', label: 'Todas' }],
    filters: ['status', 'client_id'], beforeTable: true,
    columns: [
      { key: 'number', label: 'Nº', render: (p) => html`<span class="muted">${p.number}</span>` },
      { key: 'title', label: 'Proposta', render: (p) => html`<div class="cell-title">${p.title}</div><div class="cell-sub">${p.client_name}</div>` },
      { key: 'amount', label: 'Valor', align: 'right', render: (p) => money(p.amount) },
      { key: 'sent_at', label: 'Envio', render: (p) => date(p.sent_at) },
      { key: 'valid_until', label: 'Validade', render: (p) => html`<span class="${p.is_expired ? 'late' : ''}">${date(p.valid_until)}</span>` },
      { key: 'status', label: 'Status', render: (p) => html`${badge('PROPOSAL_STATUS', p.status)}${p.project_id ? html` <a class="badge plain" href="#/projetos/${p.project_id}">projeto</a>` : ''}`, csv: (p) => label('PROPOSAL_STATUS', p.status) },
    ],
    onRow: (p) => proposalDrawer(p.id, () => page.load()),
    actions: (p, reload) => rowActions('proposals', p, { onChange: reload }),
    totals: (rows) => `Total ${money(rows.reduce((s, p) => s + p.amount, 0))}`,
  });
  ctx.root.querySelector('[data-before]').appendChild(stats);
  if (ctx.params[0]) proposalDrawer(Number(ctx.params[0]), () => page.load());
}

export async function proposalDrawer(id, onChange) {
  const p = await api.get(`/r/proposals/${id}`);
  const flow = ['elaboracao', 'enviada', 'visualizada', 'negociacao', 'aprovada', 'recusada'];
  const body = el(html`<div>
    <div class="row between wrap mb-16"><div class="serif" style="font-size:34px">${money(p.amount)}</div>${badge('PROPOSAL_STATUS', p.status)}</div>
    <div class="eyebrow mb-8">Alterar status</div>
    <div class="btn-group mb-24" style="flex-wrap:wrap" data-st>${flow.map((s) => html`<button class="${s === p.status ? 'on' : ''}" data-v="${s}">${label('PROPOSAL_STATUS', s)}</button>`)}</div>
    <dl class="kv"><dt>Cliente</dt><dd><a href="#/clientes/${p.client_id}">${p.client_name}</a></dd><dt>Tipo</dt><dd>${p.project_type || '—'}</dd>
      <dt>Área</dt><dd>${p.area ? p.area + ' m²' : '—'}</dd><dt>Imóvel</dt><dd>${[p.address, p.city].filter(Boolean).join(' — ') || '—'}</dd>
      <dt>Parcelas previstas</dt><dd>${p.installments || 1}x de ${money(p.amount / (p.installments || 1))}</dd>
      <dt>Enviada em</dt><dd>${date(p.sent_at)}</dd><dt>Validade</dt><dd>${date(p.valid_until)}${p.valid_until ? ` (${relDay(p.valid_until)})` : ''}</dd>
      <dt>Responsável</dt><dd>${p.responsible_name || '—'}</dd>${p.refusal_reason ? html`<dt>Motivo da recusa</dt><dd>${p.refusal_reason}</dd>` : ''}
      ${p.project_id ? html`<dt>Projeto gerado</dt><dd><a href="#/projetos/${p.project_id}">${p.project_name}</a></dd>` : ''}
      ${p.notes ? html`<dt>Observações</dt><dd class="notes">${p.notes}</dd>` : ''}</dl>
    ${p.status === 'aprovada' && !p.project_id ? html`<div class="card flat mt-24 row between wrap"><span>Proposta aprovada. Gere o projeto com os dados já preenchidos.</span><button class="btn primary sm" data-conv>Gerar projeto</button></div>` : ''}
    <div class="mt-24" data-att></div></div>`);
  body.querySelector('[data-att]').appendChild(attachments('proposals', p.id, { title: 'Arquivo da proposta', extraMeta: { category: 'Propostas', client_id: p.client_id } }));
  const d = drawer({ title: `${p.number} — ${p.title}`, sub: 'Proposta', body, onClose: onChange });
  body.querySelector('[data-st]').onclick = async (e) => {
    const b = e.target.closest('[data-v]'); if (!b || b.dataset.v === p.status) return;
    let extra = {};
    if (b.dataset.v === 'recusada') { const r = prompt('Motivo da recusa (opcional):'); if (r === null) return; extra.refusal_reason = r; }
    try { await api.put(`/r/proposals/${p.id}`, { status: b.dataset.v, ...extra }); toast('Status atualizado.'); d.close();
      if (b.dataset.v === 'aprovada' && !p.project_id) convertModal(p, onChange); else proposalDrawer(p.id, onChange); } catch (err) { fail(err); }
  };
  const cv = body.querySelector('[data-conv]'); if (cv) cv.onclick = () => { d.close(); convertModal(p, onChange); };
  d.foot.classList.remove('hidden');
  d.foot.innerHTML = toHTML(html`<button class="btn danger" data-del>${icon('trash')}</button><button class="btn" data-dup>${icon('copy')} Duplicar</button><span class="grow"></span><button class="btn primary" data-edit>${icon('edit')} Editar</button>`);
  d.foot.querySelector('[data-edit]').onclick = () => { d.close(); openForm('proposals', { id: p.id, onSaved: onChange }); };
  d.foot.querySelector('[data-dup]').onclick = async () => { await duplicateRow('proposals', p); d.close(); };
  d.foot.querySelector('[data-del]').onclick = async () => { if (await deleteRow('proposals', p, p.number)) d.close(); };
}

function convertModal(p, onChange) {
  modal({ title: 'Proposta aprovada', body: html`<p class="muted" style="margin-top:0">Deseja gerar o projeto <b>${p.title}</b> automaticamente, com cliente, tipo, área, endereço e valor já preenchidos e as etapas padrão criadas?</p>
    <label class="toggle"><input type="checkbox" id="mc" checked><span class="sw"></span><span>Criar também o contrato (aguardando assinatura) com ${p.installments || 1} parcela(s)</span></label>
    <div class="form-grid mt-16"><div class="field"><label>1º vencimento</label><input type="date" id="fd" value="${addDays(today(), 7)}"></div>
    <div class="field"><label>Forma de pagamento</label><select id="pm">${S.meta.lists.PAYMENT_METHODS.map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select></div></div>`,
  actions: [{ label: 'Agora não' }, { label: 'Gerar projeto', primary: true, fn: async (m) => {
    const r = await api.post(`/proposals/${p.id}/convert`, { create_contract: m.querySelector('#mc').checked, first_due_date: m.querySelector('#fd').value, payment_method: m.querySelector('#pm').value });
    toast('Projeto criado a partir da proposta.'); location.hash = '#/projetos/' + r.project_id;
  } }], onClose: () => onChange && onChange() });
}

// ------------------------------ CONTRATOS ------------------------------
async function contracts(ctx) {
  const page = await listPage({
    root: ctx.root, res: 'contracts', title: 'Contratos', sub: 'Contratos com clientes — parcelas geram automaticamente as contas a receber', query: ctx.query,
    presets: [{ key: 'aguardando', label: 'Aguardando assinatura' }, { key: 'ativos', label: 'Ativos' }, { key: '', label: 'Todos' }],
    filters: ['status', 'client_id'],
    columns: [
      { key: 'number', label: 'Nº', render: (c) => html`<span class="cell-title">${c.number}</span>` },
      { key: 'client_name', label: 'Cliente', render: (c) => html`<div class="cell-title">${c.client_name}</div><div class="cell-sub">${c.project_name || ''}</div>` },
      { key: 'amount', label: 'Valor', align: 'right', render: (c) => money(c.amount) },
      { key: 'installments', label: 'Parcelas', render: (c) => `${c.installments || 1}x` },
      S.user.finance ? { key: 'received', label: 'Recebido', align: 'right', render: (c) => money(c.received) } : null,
      { key: 'signed_at', label: 'Assinatura', render: (c) => date(c.signed_at) },
      { key: 'docs_count', label: 'Documento', render: (c) => (c.docs_count ? html`<span class="badge success plain">${icon('clip', 'sm')} anexado</span>` : html`<span class="muted small">—</span>`) },
      { key: 'status', label: 'Status', render: (c) => badge('CONTRACT_STATUS', c.status), csv: (c) => label('CONTRACT_STATUS', c.status) },
    ].filter(Boolean),
    onRow: (c) => contractDrawer(c.id, () => page.load()),
    actions: (c, reload) => rowActions('contracts', c, { onChange: reload }),
    onNew: (reload) => openForm('contracts', { onSaved: reload, after: html`<p class="small muted mt-16">Ao salvar, as parcelas são geradas automaticamente em Financeiro › Entradas (como “previsto” até a assinatura).</p>` }),
    totals: (rows) => `Total ${money(rows.filter((c) => c.status !== 'cancelado').reduce((s, c) => s + c.amount, 0))}`,
  });
  if (ctx.params[0]) contractDrawer(Number(ctx.params[0]), () => page.load());
}

export async function contractDrawer(id, onChange) {
  const c = await api.get(`/r/contracts/${id}`);
  const fin = S.user.finance;
  const inc = fin ? (await list('incomes', { f_contract_id: id, sort: 'due_date', limit: 200 })).rows : [];
  const body = el(html`<div>
    <div class="row between wrap mb-16"><div class="serif" style="font-size:34px">${money(c.amount)}</div>${badge('CONTRACT_STATUS', c.status)}</div>
    <dl class="kv"><dt>Cliente</dt><dd><a href="#/clientes/${c.client_id}">${c.client_name}</a></dd>
      <dt>Projeto</dt><dd>${c.project_id ? html`<a href="#/projetos/${c.project_id}">${c.project_name}</a>` : '—'}</dd>
      ${c.proposal_number ? html`<dt>Proposta</dt><dd><a href="#/propostas/${c.proposal_id}">${c.proposal_number}</a></dd>` : ''}
      <dt>Assinatura</dt><dd>${date(c.signed_at)}</dd><dt>Vigência</dt><dd>${date(c.start_date)} → ${date(c.end_date)}</dd>
      <dt>Pagamento</dt><dd>${c.installments || 1}x · ${label('PAYMENT_METHODS', c.payment_method)} · 1º venc. ${date(c.first_due_date)}</dd>
      ${c.notes ? html`<dt>Observações</dt><dd class="notes">${c.notes}</dd>` : ''}</dl>
    ${fin ? html`<div class="row between mt-24 mb-8"><div class="eyebrow">Parcelas (contas a receber)</div>${!c.receivables_generated ? html`<button class="btn xs primary" data-gen>Gerar parcelas</button>` : ''}</div><div data-inc></div>` : ''}
    <div class="mt-24" data-att></div></div>`);
  if (fin) body.querySelector('[data-inc]').appendChild(table({ rows: inc, cls: 'compact', empty: 'Nenhuma parcela gerada.', onRow: (r) => entryDrawer('incomes', r.id, () => { d.close(); contractDrawer(id, onChange); }), columns: [
    { key: 'installment_no', label: 'Parcela', render: (r) => `${r.installment_no}/${r.installment_total}` }, { key: 'due_date', label: 'Vencimento', render: (r) => date(r.due_date) },
    { key: 'amount', label: 'Valor', align: 'right', render: (r) => money(r.amount) }, { key: 'status', label: 'Status', render: (r) => badge('INCOME_STATUS', r.status) }] }));
  body.querySelector('[data-att]').appendChild(attachments('contracts', c.id, { title: 'Documento do contrato', extraMeta: { category: 'Contratos', client_id: c.client_id, project_id: c.project_id } }));
  const d = drawer({ title: `Contrato ${c.number}`, sub: c.client_name, body, onClose: onChange });
  const g = body.querySelector('[data-gen]'); if (g) g.onclick = async () => { await api.post(`/contracts/${id}/receivables`); toast('Parcelas geradas.'); d.close(); contractDrawer(id, onChange); };
  d.foot.classList.remove('hidden');
  d.foot.innerHTML = toHTML(html`<button class="btn danger" data-del>${icon('trash')}</button><span class="grow"></span>
    ${c.status !== 'cancelado' && c.status !== 'concluido' ? html`<button class="btn" data-cancel>Cancelar contrato</button>` : ''}
    ${['elaboracao', 'aguardando_assinatura'].includes(c.status) ? html`<button class="btn" data-sign>${icon('check')} Marcar como assinado</button>` : ''}
    <button class="btn primary" data-edit>${icon('edit')} Editar</button>`);
  d.foot.querySelector('[data-edit]').onclick = () => { d.close(); openForm('contracts', { id, onSaved: onChange }); };
  d.foot.querySelector('[data-del]').onclick = async () => { if (await deleteRow('contracts', c, c.number)) d.close(); };
  const s = d.foot.querySelector('[data-sign]'); if (s) s.onclick = async () => { await api.put(`/r/contracts/${id}`, { status: 'ativo', signed_at: today() }); toast('Contrato ativo. Parcelas liberadas como “a receber”.'); d.close(); contractDrawer(id, onChange); };
  const x = d.foot.querySelector('[data-cancel]'); if (x) x.onclick = () => modal({ title: 'Cancelar contrato', body: html`<label class="toggle"><input type="checkbox" id="cr" checked><span class="sw"></span><span>Cancelar também as parcelas em aberto</span></label>`,
    actions: [{ label: 'Voltar' }, { label: 'Cancelar contrato', danger: true, fn: async (m) => { await api.put(`/r/contracts/${id}`, { status: 'cancelado', cancel_receivables: m.querySelector('#cr').checked }); toast('Contrato cancelado.'); d.close(); } }] });
}
