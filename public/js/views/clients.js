import { S, api, html, el, toHTML, icon, money, date, datetime, badge, label, progress, openForm, modal, toast, fail, menu, table, dropzone, fileRow, deleteRow, waLink, isAdmin, $$ } from '../lib.js';
import { listPage, rowActions } from './common.js';
import { newEntry, entryDrawer } from './finance.js';
import { taskDrawer } from './tasks.js';

export default async function (ctx) {
  if (ctx.params[0]) return profile(ctx, Number(ctx.params[0]));
  await listPage({
    root: ctx.root, res: 'clients', title: 'Clientes', sub: 'Relacionamento, histórico e financeiro de cada cliente', query: ctx.query,
    filters: ['origin'],
    columns: [
      { key: 'name', label: 'Cliente', render: (c) => html`<div class="cell-title">${c.name}</div><div class="cell-sub">${c.profession || ''}</div>` },
      { key: 'whatsapp', label: 'WhatsApp', render: (c) => (c.whatsapp || c.phone ? html`<a href="${waLink(c.whatsapp || c.phone)}" target="_blank" rel="noopener">${c.whatsapp || c.phone}</a>` : '—') },
      { key: 'email', label: 'E-mail' }, { key: 'city', label: 'Cidade' }, { key: 'origin', label: 'Origem' },
      { key: 'projects_count', label: 'Projetos', align: 'right' },
      S.user.finance ? { key: 'total_overdue', label: 'Em atraso', align: 'right', render: (c) => (c.total_overdue ? html`<span class="danger-text">${money(c.total_overdue)}</span>` : '—') } : null,
    ].filter(Boolean),
    onRow: (c) => ctx.go('#/clientes/' + c.id),
    actions: (c, reload) => rowActions('clients', c, { onChange: reload }),
    onNew: () => openForm('clients', { onSaved: (c) => ctx.go('#/clientes/' + c.id) }),
  });
}

async function profile(ctx, id) {
  const root = ctx.root;
  const d = await api.get(`/clients/${id}/overview`);
  const c = d.client; const fin = !!d.incomes;
  let active = ctx.query.tab || 'timeline';
  const reload = () => profile({ ...ctx, query: { ...ctx.query, tab: active } }, id);
  const tabs = [['timeline', 'Linha do tempo'], ['projetos', 'Projetos', d.projects.length], ['comercial', 'Propostas e contratos', d.proposals.length + d.contracts.length],
    fin ? ['financeiro', 'Pagamentos'] : null, ['reunioes', 'Reuniões', d.events.length], ['tarefas', 'Tarefas', d.tasks.filter((t) => t.status !== 'concluida').length], ['arquivos', 'Arquivos', d.documents.length], ['dados', 'Dados cadastrais']].filter(Boolean);
  root.innerHTML = toHTML(html`
    <div class="hero"><div class="crumbs"><a href="#/clientes">Clientes</a></div>
      <div class="row between top wrap gap-16"><div><h1>${c.name}</h1>
        <div class="info-row mt-8">${c.whatsapp || c.phone ? html`<a href="${waLink(c.whatsapp || c.phone)}" target="_blank" rel="noopener"><span>${icon('chat', 'sm')}${c.whatsapp || c.phone}</span></a>` : ''}${c.email ? html`<a href="mailto:${c.email}"><span>${icon('mail', 'sm')}${c.email}</span></a>` : ''}${c.city ? html`<span>${icon('pin', 'sm')}${c.city}</span>` : ''}${c.origin ? html`<span>Origem: ${c.origin}</span>` : ''}</div></div>
        <div class="row wrap"><button class="btn" data-edit>${icon('edit')} Editar</button><button class="btn" data-int>${icon('msg')} Registrar contato</button><button class="btn primary" data-new>${icon('plus')} Novo</button></div></div>
      ${fin ? html`<div class="stat-strip mt-24"><div><div class="l">Projetos</div><div class="v">${d.projects.length}</div></div><div><div class="l">Total contratado</div><div class="v">${money(d.summary.contracted)}</div></div>
        <div><div class="l">Pago</div><div class="v">${money(d.summary.paid)}</div></div><div><div class="l">A receber</div><div class="v">${money(d.summary.pending)}</div></div>
        <div><div class="l">Vencido</div><div class="v ${d.summary.overdue ? 'danger-text' : ''}">${money(d.summary.overdue)}</div></div></div>` : ''}
    </div>
    <div class="tabs mt-24">${tabs.map(([k, l, n]) => html`<button data-tab="${k}">${l}${n ? html`<span class="n">${n}</span>` : ''}</button>`)}</div><div data-body></div>`);
  const body = root.querySelector('[data-body]');
  const show = (k) => { active = k; $$('[data-tab]', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === k)); body.innerHTML = ''; T[k](body, d, { reload, ctx }); history.replaceState(null, '', `#/clientes/${id}${k !== 'timeline' ? '?tab=' + k : ''}`); };
  root.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); };
  root.querySelector('[data-edit]').onclick = () => openForm('clients', { id, onSaved: reload });
  root.querySelector('[data-int]').onclick = () => openForm('client_interactions', { values: { client_id: id }, exclude: ['client_id'], onSaved: reload });
  root.querySelector('[data-new]').onclick = (e) => menu(e.currentTarget, [
    { label: 'Nova proposta', icon: 'proposal', fn: () => openForm('proposals', { values: { client_id: id, city: c.city }, onSaved: reload }) },
    { label: 'Novo projeto', icon: 'folder', fn: () => openForm('projects', { values: { client_id: id, city: c.city }, onSaved: (p) => ctx.go('#/projetos/' + p.id) }) },
    { label: 'Nova reunião', icon: 'calendar', fn: () => openForm('events', { values: { client_id: id, type: 'reuniao' }, onSaved: reload }) },
    { label: 'Nova tarefa', icon: 'tasks', fn: () => openForm('tasks', { values: { client_id: id }, onSaved: reload }) },
    fin ? { label: 'Nova receita', icon: 'in', fn: () => newEntry('incomes', { client_id: id }, reload) } : null,
    '-', { label: 'Acesso à Área do Cliente', icon: 'lock', fn: () => portalAccess(c, d.portal_users, reload) },
  ]);
  show(tabs.find((t) => t[0] === active) ? active : 'timeline');
}

function portalAccess(c, users, reload) {
  modal({ title: 'Área do Cliente', body: html`<p class="small muted" style="margin-top:0">O cliente acessa com e-mail e senha e vê somente os próprios projetos, cronograma, documentos liberados, situação da obra, parcelas e orçamentos liberados.</p>
    ${users.length ? html`<div class="list mb-16">${users.map((u) => html`<div class="list-item"><div class="grow"><div class="li-title">${u.email}</div><div class="li-sub">${u.active ? 'Ativo' : 'Desativado'} · último acesso ${u.last_login ? datetime(u.last_login) : 'nunca'}</div></div><button class="btn xs" data-link="${u.id}">Gerar link de senha</button></div>`)}</div>` : ''}
    <div class="form-grid"><div class="field"><label>Nome</label><input id="pn" value="${c.name}"></div><div class="field"><label>E-mail de acesso</label><input id="pe" type="email" value="${users.length ? '' : c.email || ''}"></div></div>`,
  actions: [{ label: 'Fechar' }, { label: 'Criar acesso', primary: true, fn: async (m) => {
    const r = await api.post('/admin/users', { name: m.querySelector('#pn').value, email: m.querySelector('#pe').value, role: 'cliente', client_id: c.id });
    modal({ title: 'Acesso criado', body: html`<p class="small">Envie ao cliente:</p><div class="card flat small" style="user-select:all">E-mail: ${m.querySelector('#pe').value}<br>Senha provisória: <b>${r.temp_password}</b><br><br>Ou link para definir a senha:<br>${r.reset_link}</div>`, actions: [{ label: 'OK', primary: true }] });
    reload();
  } }] }).el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-link]'); if (!b) return;
    const r = await api.post(`/admin/users/${b.dataset.link}/reset-link`);
    try { await navigator.clipboard.writeText(r.link); toast('Link copiado para a área de transferência (válido por 2 horas).'); } catch { modal({ title: 'Link de senha', body: html`<div class="card flat small" style="user-select:all;overflow-wrap:anywhere">${r.link}</div>`, actions: [{ label: 'OK', primary: true }] }); }
  });
}

const KIND_LABEL = { proposta: 'Proposta', contrato: 'Contrato', projeto: 'Projeto', pagamento: 'Pagamento', reuniao: 'Reunião', visita: 'Visita', ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail', briefing: 'Briefing', feedback: 'Atualização', contato: 'Contato', apresentacao: 'Apresentação', visita_tecnica: 'Visita técnica', entrega: 'Entrega' };
const T = {
  timeline(body, d) {
    body.appendChild(el(html`<div class="grid g3"><div class="card span2"><div class="card-head"><h3>Histórico de relacionamento</h3></div>
      ${d.timeline.length ? html`<div class="timeline">${d.timeline.map((t) => html`<div class="tl ${t.future ? 'future' : ''}"><div class="d">${date(t.date)} · ${KIND_LABEL[t.kind] || t.kind}${t.user ? ' · ' + t.user : ''}</div><div class="x">${t.text}${t.amount ? html` <b>${money(t.amount)}</b>` : ''}</div></div>`)}</div>` : html`<div class="empty sm">Nenhum registro ainda.</div>`}</div>
      <div class="card"><div class="card-head"><h3>Contato</h3></div><dl class="kv" style="grid-template-columns:90px 1fr">
        <dt>Telefone</dt><dd>${d.client.phone || '—'}</dd><dt>WhatsApp</dt><dd>${d.client.whatsapp || '—'}</dd><dt>E-mail</dt><dd>${d.client.email || '—'}</dd>
        <dt>Endereço</dt><dd>${[d.client.address, d.client.city, d.client.state].filter(Boolean).join(', ') || '—'}</dd><dt>Profissão</dt><dd>${d.client.profession || '—'}</dd>
        ${d.client.birthday ? html`<dt>Aniversário</dt><dd>${date(d.client.birthday).slice(0, 5)}</dd>` : ''}</dl>
        ${d.client.notes ? html`<div class="eyebrow mt-16 mb-8">Observações</div><div class="notes">${d.client.notes}</div>` : ''}</div></div>`));
  },
  projetos(body, d, { ctx }) {
    body.appendChild(d.projects.length ? el(html`<div class="pcards">${d.projects.map((p) => html`<a class="pcard" href="#/projetos/${p.id}"><div class="row between"><span class="eyebrow">${p.type || ''}</span>${badge('PROJECT_STATUS', p.status)}</div><h3>${p.name}</h3>
      <div>${progress(p.progress)}</div><div class="small muted">${p.current_phase || ''} · entrega ${date(p.due_date)}</div></a>`)}</div>`) : el('<div class="empty">Nenhum projeto.</div>'));
  },
  comercial(body, d, { reload }) {
    const box = el(html`<div><h3 class="mb-16">Propostas</h3><div data-p></div><h3 class="mb-16 mt-32">Contratos</h3><div data-c></div></div>`);
    box.querySelector('[data-p]').appendChild(table({ rows: d.proposals, empty: 'Nenhuma proposta.', onRow: (p) => (location.hash = '#/propostas/' + p.id), columns: [
      { key: 'number', label: 'Nº' }, { key: 'title', label: 'Escopo' }, { key: 'amount', label: 'Valor', align: 'right', render: (p) => money(p.amount) }, { key: 'sent_at', label: 'Envio', render: (p) => date(p.sent_at) }, { key: 'status', label: 'Status', render: (p) => badge('PROPOSAL_STATUS', p.status) }] }));
    box.querySelector('[data-c]').appendChild(table({ rows: d.contracts, empty: 'Nenhum contrato.', onRow: (c) => (location.hash = '#/contratos/' + c.id), columns: [
      { key: 'number', label: 'Nº' }, { key: 'project_name', label: 'Projeto' }, { key: 'amount', label: 'Valor', align: 'right', render: (c) => money(c.amount) }, { key: 'signed_at', label: 'Assinatura', render: (c) => date(c.signed_at) }, { key: 'status', label: 'Status', render: (c) => badge('CONTRACT_STATUS', c.status) }] }));
    body.appendChild(box);
  },
  financeiro(body, d, { reload }) {
    const rows = d.incomes;
    const box = el(html`<div><div class="row between mb-16"><div class="small">Parcelas pendentes: <b>${rows.filter((i) => ['a_receber', 'previsto', 'vencido'].includes(i.status)).length}</b></div><button class="btn sm primary" data-add>${icon('plus')} Nova receita</button></div></div>`);
    box.appendChild(table({ rows, empty: 'Nenhum lançamento.', onRow: (r) => entryDrawer('incomes', r.id, reload), columns: [
      { key: 'due_date', label: 'Vencimento', render: (r) => html`<span class="${r.status === 'vencido' ? 'late' : ''}">${date(r.due_date)}</span>` }, { key: 'description', label: 'Descrição' },
      { key: 'project_name', label: 'Projeto' }, { key: 'installment_no', label: 'Parcela', render: (r) => (r.installment_total > 1 ? `${r.installment_no}/${r.installment_total}` : '—') },
      { key: 'amount', label: 'Valor', align: 'right', render: (r) => money(r.amount) }, { key: 'paid_at', label: 'Pago em', render: (r) => date(r.paid_at) }, { key: 'status', label: 'Status', render: (r) => badge('INCOME_STATUS', r.status) }] }));
    box.querySelector('[data-add]').onclick = () => newEntry('incomes', { client_id: d.client.id }, reload);
    body.appendChild(box);
  },
  reunioes(body, d, { reload }) {
    const box = el(html`<div><div class="row between mb-16"><span></span><button class="btn sm primary" data-add>${icon('plus')} Nova reunião</button></div></div>`);
    box.appendChild(table({ rows: d.events, empty: 'Nenhuma reunião registrada.', onRow: (e) => openForm('events', { id: e.id, onSaved: reload }), columns: [
      { key: 'start_at', label: 'Data', render: (e) => datetime(e.start_at) }, { key: 'title', label: 'Título', render: (e) => html`<div class="cell-title">${e.title}</div>${e.minutes ? html`<div class="cell-sub">ata registrada</div>` : ''}` }, { key: 'type', label: 'Tipo', render: (e) => badge('EVENT_TYPES', e.type) }, { key: 'project_name', label: 'Projeto' }, { key: 'status', label: 'Status', render: (e) => badge('EVENT_STATUS', e.status) }] }));
    box.querySelector('[data-add]').onclick = () => openForm('events', { values: { client_id: d.client.id, type: 'reuniao' }, onSaved: reload });
    body.appendChild(box);
  },
  tarefas(body, d, { reload }) {
    body.appendChild(table({ rows: d.tasks, empty: 'Nenhuma tarefa.', onRow: (t) => taskDrawer(t.id, reload), columns: [
      { key: 'title', label: 'Tarefa' }, { key: 'project_name', label: 'Projeto' }, { key: 'assignee_name', label: 'Responsável' }, { key: 'due_date', label: 'Prazo', render: (t) => html`<span class="${t.is_late ? 'late' : ''}">${date(t.due_date)}</span>` }, { key: 'status', label: 'Status', render: (t) => badge('TASK_STATUS', t.status) }] }));
  },
  arquivos(body, d, { reload }) {
    const box = el(html`<div class="grid g3"><div class="card span2 files" data-l></div><div data-z></div></div>`);
    const l = box.querySelector('[data-l]'); if (!d.documents.length) l.innerHTML = '<div class="muted small">Nenhum arquivo.</div>';
    d.documents.forEach((doc) => l.appendChild(fileRow(doc, { onDelete: async (x) => { if (await deleteRow('documents', x, x.title)) reload(); } })));
    box.querySelector('[data-z]').appendChild(dropzone({ client_id: d.client.id }, reload));
    body.appendChild(box);
  },
  dados(body, d) {
    const c = d.client;
    body.appendChild(el(html`<div class="card"><dl class="kv">${S.meta.resources.clients.fields.map((f) => html`<dt>${f.label}</dt><dd>${f.type === 'date' ? date(c[f.name]) : f.type === 'select' ? label(f.list, c[f.name]) : c[f.name] || '—'}</dd>`)}
      <dt>Cadastrado em</dt><dd>${datetime(c.created_at)}</dd></dl></div>`));
  },
};
