import { S, api, html, el, toHTML, icon, money, date, badge, label, openForm, table, dropzone, fileRow, deleteRow, waLink, isManager, $$ } from '../lib.js';
import { listPage, rowActions } from './common.js';
import { entryDrawer, newEntry } from './finance.js';

const stars = (n) => (n ? html`<span style="color:var(--accent);letter-spacing:1px">${'★'.repeat(Math.round(n))}<span style="color:#ddd">${'★'.repeat(5 - Math.round(n))}</span></span> <span class="small muted">${n}</span>` : html`<span class="muted small">sem avaliação</span>`);

export default async function (ctx) {
  if (ctx.params[0]) return profile(ctx, Number(ctx.params[0]));
  await listPage({
    root: ctx.root, res: 'suppliers', title: 'Fornecedores', sub: 'Parceiros, prestadores e lojas — histórico, orçamentos, pagamentos e avaliações', query: ctx.query,
    filters: ['category'],
    columns: [
      { key: 'company', label: 'Empresa', render: (s) => html`<div class="cell-title">${s.company}</div><div class="cell-sub">${s.contact || ''}</div>` },
      { key: 'category', label: 'Categoria' },
      { key: 'whatsapp', label: 'WhatsApp', render: (s) => (s.whatsapp || s.phone ? html`<a href="${waLink(s.whatsapp || s.phone)}" target="_blank" rel="noopener">${s.whatsapp || s.phone}</a>` : '—') },
      { key: 'city', label: 'Cidade' },
      { key: 'rating', label: 'Avaliação', render: (s) => stars(s.rating) },
      { key: 'projects_count', label: 'Projetos', align: 'right' },
    ],
    onRow: (s) => ctx.go('#/fornecedores/' + s.id),
    actions: isManager() ? (s, reload) => rowActions('suppliers', s, { onChange: reload }) : null,
    onNew: isManager() ? () => openForm('suppliers', { onSaved: (s) => ctx.go('#/fornecedores/' + s.id) }) : false,
  });
}

async function profile(ctx, id) {
  const root = ctx.root;
  const d = await api.get(`/suppliers/${id}/overview`);
  const s = d.supplier; const fin = !!d.expenses;
  let active = ctx.query.tab || 'historico';
  const reload = () => profile({ ...ctx, query: { ...ctx.query, tab: active } }, id);
  const tabs = [['historico', 'Histórico'], ['orcamentos', 'Orçamentos', d.quotes.length], fin ? ['pagamentos', 'Pagamentos', d.expenses.length] : null, ['avaliacoes', 'Avaliações internas', d.reviews.length], ['documentos', 'Documentos', d.documents.length]].filter(Boolean);
  root.innerHTML = toHTML(html`<div class="hero"><div class="crumbs"><a href="#/fornecedores">Fornecedores</a></div>
    <div class="row between top wrap gap-16"><div><div class="eyebrow">${s.category || ''}</div><h1 class="mt-8">${s.company}</h1>
      <div class="info-row mt-8">${s.contact ? html`<span>${icon('users', 'sm')}${s.contact}</span>` : ''}${s.whatsapp || s.phone ? html`<a href="${waLink(s.whatsapp || s.phone)}" target="_blank" rel="noopener"><span>${icon('chat', 'sm')}${s.whatsapp || s.phone}</span></a>` : ''}${s.email ? html`<a href="mailto:${s.email}"><span>${icon('mail', 'sm')}${s.email}</span></a>` : ''}${s.cnpj ? html`<span>CNPJ ${s.cnpj}</span>` : ''}${s.city ? html`<span>${icon('pin', 'sm')}${s.city}</span>` : ''}<span>${stars(s.rating)}</span></div></div>
      <div class="row wrap">${isManager() ? html`<button class="btn" data-edit>${icon('edit')} Editar</button>` : ''}<button class="btn primary" data-rev>${icon('star')} Avaliar</button></div></div>
    <div class="stat-strip mt-24"><div><div class="l">Projetos</div><div class="v">${d.projects.length}</div></div><div><div class="l">Orçamentos enviados</div><div class="v">${d.quotes.length}</div></div>
      <div><div class="l">Orçamentos contratados</div><div class="v">${d.quotes.filter((q) => ['contratado', 'aprovado'].includes(q.status)).length}</div></div>
      ${fin ? html`<div><div class="l">Total pago</div><div class="v">${money(d.total_paid)}</div></div>` : ''}${s.rt_percent ? html`<div><div class="l">Reserva técnica</div><div class="v">${s.rt_percent}%</div></div>` : ''}</div></div>
    <div class="tabs mt-24">${tabs.map(([k, l, n]) => html`<button data-tab="${k}">${l}${n ? html`<span class="n">${n}</span>` : ''}</button>`)}</div><div data-body></div>`);
  const body = root.querySelector('[data-body]');
  const show = (k) => { active = k; $$('[data-tab]', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === k)); body.innerHTML = ''; T[k](body, d, { reload }); };
  root.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); };
  const e = root.querySelector('[data-edit]'); if (e) e.onclick = () => openForm('suppliers', { id, onSaved: reload });
  root.querySelector('[data-rev]').onclick = () => openForm('supplier_reviews', { values: { supplier_id: id }, exclude: ['supplier_id'], onSaved: reload });
  show(tabs.find((t) => t[0] === active) ? active : 'historico');
}

const T = {
  historico(body, d) {
    body.appendChild(el(html`<div class="grid g2"><div class="card"><div class="card-head"><h3>Projetos</h3></div>${d.projects.length ? html`<div class="list">${d.projects.map((p) => html`<a class="list-item" href="#/projetos/${p.id}"><div class="grow"><div class="li-title">${p.name}</div><div class="li-sub">${p.client_name || ''}</div></div>${badge('PROJECT_STATUS', p.status)}</a>`)}</div>` : html`<div class="empty sm">Nenhum projeto vinculado.</div>`}</div>
      <div class="card"><div class="card-head"><h3>Serviços em obra</h3></div>${d.phases.length ? html`<div class="list">${d.phases.map((p) => html`<a class="list-item" href="#/obras/${p.work_id}"><div class="grow"><div class="li-title">${p.name} — ${p.project_name}</div><div class="li-sub">${label('PHASE_STATUS', p.status)} · ${p.progress}% executado</div></div></a>`)}</div>` : html`<div class="empty sm">Nenhuma fase de obra vinculada.</div>`}
      ${d.supplier.notes ? html`<div class="eyebrow mt-24 mb-8">Observações</div><div class="notes">${d.supplier.notes}</div>` : ''}${d.supplier.pix ? html`<div class="eyebrow mt-16 mb-8">Dados bancários</div><div class="notes">${d.supplier.pix}</div>` : ''}</div></div>`));
  },
  orcamentos(body, d) {
    body.appendChild(table({ rows: d.quotes, empty: 'Nenhum orçamento.', onRow: (q) => (location.hash = `#/projetos/${q.project_id}?tab=orcamentos`), columns: [
      { key: 'received_at', label: 'Data', render: (q) => date(q.received_at) }, { key: 'item', label: 'Item' }, { key: 'project_name', label: 'Projeto' },
      { key: 'amount', label: 'Valor', align: 'right', render: (q) => money(q.amount) }, { key: 'status', label: 'Status', render: (q) => badge('QUOTE_STATUS', q.status) }] }));
  },
  pagamentos(body, d, { reload }) {
    const box = el(html`<div><div class="row between mb-16"><span class="small">Total pago: <b>${money(d.total_paid)}</b>${d.rt.length ? html` · Reserva técnica recebida: <b>${money(d.rt.filter((r) => r.status === 'recebido').reduce((s, r) => s + r.amount, 0))}</b>` : ''}</span><button class="btn sm primary" data-add>${icon('plus')} Nova despesa</button></div></div>`);
    box.appendChild(table({ rows: d.expenses, empty: 'Nenhum pagamento.', onRow: (r) => entryDrawer('expenses', r.id, reload), columns: [
      { key: 'due_date', label: 'Vencimento', render: (r) => date(r.due_date) }, { key: 'description', label: 'Descrição' }, { key: 'project_name', label: 'Projeto' },
      { key: 'amount', label: 'Valor', align: 'right', render: (r) => money(r.amount) }, { key: 'status', label: 'Status', render: (r) => badge('EXPENSE_STATUS', r.status) }] }));
    box.querySelector('[data-add]').onclick = () => newEntry('expenses', { supplier_id: d.supplier.id, category: d.supplier.category === 'Impressão' ? 'Impressão' : 'Fornecedores' }, reload);
    body.appendChild(box);
  },
  avaliacoes(body, d, { reload }) {
    body.appendChild(d.reviews.length ? el(html`<div class="grid g2">${d.reviews.map((r) => html`<div class="card"><div class="row between"><span>${stars(r.rating)}</span><span class="small muted">${date(r.created_at)}</span></div>
      <div class="notes mt-8">${r.comment || ''}</div><div class="small muted mt-8">${r.user_name || ''}${r.project_name ? ' · ' + r.project_name : ''}</div></div>`)}</div>`) : el('<div class="empty">Nenhuma avaliação interna ainda.</div>'));
  },
  documentos(body, d, { reload }) {
    const box = el(html`<div class="grid g3"><div class="card span2 files" data-l></div><div data-z></div></div>`);
    const l = box.querySelector('[data-l]'); if (!d.documents.length) l.innerHTML = '<div class="muted small">Nenhum documento.</div>';
    d.documents.forEach((doc) => l.appendChild(fileRow(doc, { onDelete: async (x) => { if (await deleteRow('documents', x, x.title)) reload(); } })));
    box.querySelector('[data-z]').appendChild(dropzone({ supplier_id: d.supplier.id, category: 'Documentos de fornecedores' }, reload));
    body.appendChild(box);
  },
};
