import { S, api, html, el, toHTML, icon, money, date, dateShort, relDay, badge, label, prio, progress, avatar, user, openForm, drawer, checklist, comments, attachments, dropzone, fileRow, fileUrl, toast, fail, menu, confirmDialog, datetime, today, isManager, can, table, pct, num, deleteRow, $$, esc, archiveRow, modal, copyText } from '../lib.js';
import { listPage, rowActions } from './common.js';
import { quotesPanel } from './quotes.js';
import { newEntry, entryDrawer } from './finance.js';
import { taskDrawer } from './tasks.js';

export default async function (ctx) {
  if (ctx.params[0]) return detail(ctx, Number(ctx.params[0]));
  return listView(ctx);
}

export const phaseTrack = (phases) => {
  if (!phases || !phases.length) return '';
  const cur = phases.findIndex((p) => !['concluido', 'aprovado'].includes(p.status));
  return html`<div class="phase-track">${phases.map((p, i) => html`<i class="${['concluido', 'aprovado'].includes(p.status) ? 'done' : ['aguardando_cliente', 'aguardando_fornecedor'].includes(p.status) ? 'wait' : ['em_andamento', 'revisao'].includes(p.status) ? 'doing' : ''}" title="${p.name}: ${label('PHASE_STATUS', p.status)}"></i>`)}</div>
    <div class="phase-labels desktop-only">${phases.map((p, i) => html`<span class="${i === cur ? 'cur' : ''}" title="${p.name}">${p.name}</span>`)}</div>`;
};

// ------------------------------ Lista ------------------------------
async function listView(ctx) {
  const page = await listPage({
    root: ctx.root, res: 'projects', title: 'Projetos', sub: 'Todos os projetos do escritório, suas fases e prazos', query: ctx.query,
    presets: [{ key: 'ativos', label: 'Ativos' }, { key: 'aguardando_cliente', label: 'Aguardando cliente' }, { key: 'atrasados', label: 'Atrasados' }, { key: 'em_obra', label: 'Em obra' }, { key: 'meus', label: 'Meus projetos' }, { key: 'encerrados', label: 'Encerrados (arquivo)' }, { key: '', label: 'Todos' }],
    filters: ['client_id', 'type', 'manager_id'],
    modes: [{ key: 'cards', label: 'Cartões', icon: 'grid' }, { key: 'lista', label: 'Lista', icon: 'list' }],
    columns: [
      { key: 'name', label: 'Projeto', render: (r) => html`<div class="cell-title">${r.name}</div><div class="cell-sub">${r.code || ''}${r.city ? ' · ' + r.city : ''}</div>` },
      { key: 'client_name', label: 'Cliente' }, { key: 'type', label: 'Tipo' },
      { key: 'current_phase', label: 'Fase atual', render: (r) => r.current_phase || (r.progress === 100 ? 'Concluído' : '—') },
      { key: 'progress', label: 'Andamento', render: (r) => progress(r.progress, r.is_late ? 'danger' : '') },
      { key: 'due_date', label: 'Entrega', render: (r) => html`<span class="${r.is_late ? 'late' : ''}">${date(r.due_date)}</span>`, csv: (r) => date(r.due_date) },
      { key: 'manager_name', label: 'Responsável' },
      { key: 'status', label: 'Status', render: (r) => badge('PROJECT_STATUS', r.status), csv: (r) => label('PROJECT_STATUS', r.status) },
    ],
    onRow: (r) => ctx.go('#/projetos/' + r.id),
    actions: (r, reload) => rowActions('projects', r, { onChange: reload }),
    onNew: isManager() ? (reload) => openForm('projects', { onSaved: (p) => ctx.go('#/projetos/' + p.id) }) : false,
    render: (rows, state) => {
      if (state.mode === 'lista') return null;
      if (!rows.length) return el(html`<div class="empty">${icon('folder')}<div>Nenhum projeto encontrado.</div></div>`);
      return el(html`<div class="pcards">${rows.map((p) => html`<a class="pcard" href="#/projetos/${p.id}">
        <div class="row between"><span class="eyebrow">${p.type || 'Projeto'}</span>${badge('PROJECT_STATUS', p.status)}</div>
        <div><h3>${p.name}</h3><div class="muted small mt-8">${p.client_name || ''}${p.city ? ' · ' + p.city : ''}</div></div>
        <div><div class="row between small"><span>${p.current_phase || (p.progress === 100 ? 'Todas as etapas concluídas' : '—')}</span><span class="muted">${p.progress}%</span></div><div class="progress mt-8 ${p.is_late ? 'danger' : ''}"><span style="width:${p.progress}%"></span></div></div>
        <div class="row between small muted"><span class="${p.is_late ? 'late' : ''}">${icon('clock', 'sm')} ${p.due_date ? date(p.due_date) + ' · ' + relDay(p.due_date) : 'Sem prazo'}</span><span class="row gap-8">${p.open_tasks ? html`<span>${p.open_tasks} tarefa(s)</span>` : ''}${avatar(user(p.manager_id), 'sm')}</span></div></a>`)}</div>`);
    },
  });
}

// ------------------------------ Detalhe ------------------------------
async function detail(ctx, id) {
  const root = ctx.root;
  let d;
  try { d = await api.get(`/projects/${id}/overview`); } catch (e) { root.innerHTML = toHTML(html`<div class="empty">${icon('lock')}<div>${e.message}</div></div>`); return; }
  const p = d.project; const fin = !!d.profitability; const mgr = isManager() || p.manager_id === S.user.id;
  const reload = () => detail({ ...ctx, query: { ...ctx.query, tab: activeTab } }, id);
  const cur = d.phases.find((ph) => !['concluido', 'aprovado'].includes(ph.status));
  const openTasks = d.tasks.filter((t) => t.status !== 'concluida');
  const tabs = [
    ['geral', 'Visão geral'], ['etapas', 'Etapas', d.phases.length], ['tarefas', 'Tarefas', openTasks.length], ['obra', 'Obra', d.works.length], ['infoobra', 'Informações da obra'],
    can('obras') || d.quotes.length ? ['orcamentos', 'Orçamentos', d.quotes.length] : null, fin ? ['financeiro', 'Financeiro'] : null,
    ['documentos', 'Documentos e imagens', d.documents.length + d.images.length], ['agenda', 'Agenda', d.events.length], ['horas', 'Horas'], ['historico', 'Histórico'],
  ].filter(Boolean);
  let activeTab = ctx.query.tab || 'geral';

  root.innerHTML = toHTML(html`
    <div class="hero"><div class="crumbs"><a href="#/projetos">Projetos</a> ${icon('chevron', 'sm')} <span>${p.code || ''}</span></div>
      <div class="row between top wrap gap-16"><div style="min-width:0"><h1>${p.name}</h1>
        <div class="info-row mt-8">${d.client ? html`<span>${icon('users', 'sm')}<a href="${can('clientes') ? '#/clientes/' + d.client.id : '#'}">${d.client.name}</a></span>` : ''}${p.type ? html`<span>${icon('folder', 'sm')}${p.type}</span>` : ''}${p.city ? html`<span>${icon('pin', 'sm')}${p.city}</span>` : ''}${p.area ? html`<span>${num(p.area)} m²</span>` : ''}<span>${badge('PROJECT_STATUS', p.status)}</span>${p.archived ? html`<span class="badge muted">Arquivado</span>` : ''}</div></div>
        <div class="row wrap">${mgr ? html`<button class="btn" data-edit>${icon('edit')} Editar</button>` : ''}<button class="btn primary" data-task>${icon('plus')} Tarefa</button><button class="icon-btn" data-more>${icon('more')}</button></div></div>
      ${d.all_phases_done && !['encerrado', 'cancelado'].includes(p.status) ? html`<div class="card flat mt-16 row between wrap"><div class="row gap-8">${icon('check')}<span><b>Todas as etapas foram concluídas.</b> Deseja encerrar o projeto e movê-lo para o arquivo?</span></div>${mgr ? html`<button class="btn sm primary" data-close>Encerrar projeto</button>` : ''}</div>` : ''}
      <div class="stat-strip mt-24">
        <div><div class="l">Andamento</div><div class="v">${p.progress}%</div><div class="progress thin mt-8"><span style="width:${p.progress}%"></span></div></div>
        <div><div class="l">Fase atual</div><div class="v" style="font-size:19px;margin-top:6px">${cur ? cur.name : d.phases.length ? 'Concluído' : '—'}</div></div>
        <div><div class="l">Entrega prevista</div><div class="v ${p.is_late ? 'danger-text' : ''}" style="font-size:20px;margin-top:5px">${p.due_date ? date(p.due_date) : '—'}</div><div class="tiny muted">${p.due_date ? relDay(p.due_date) : ''}</div></div>
        <div><div class="l">Tarefas abertas</div><div class="v">${openTasks.length}</div></div>
        ${fin ? html`<div><div class="l">Valor contratado</div><div class="v">${money(d.profitability.contracted)}</div></div>
        <div><div class="l">Recebido</div><div class="v">${money(d.profitability.received)}</div>${d.profitability.overdue ? html`<div class="tiny danger-text">${money(d.profitability.overdue)} vencido</div>` : ''}</div>
        <div><div class="l">Resultado</div><div class="v ${d.profitability.result < 0 ? 'danger-text' : ''}">${pct(d.profitability.margin)}</div><div class="tiny muted">${money(d.profitability.result)}</div></div>` : ''}
      </div>
      <div class="mt-16">${phaseTrack(d.phases)}</div>
    </div>
    <div class="tabs mt-24">${tabs.map(([k, l, n]) => html`<button data-tab="${k}">${l}${n ? html`<span class="n">${n}</span>` : ''}</button>`)}</div>
    <div data-body></div>`);

  const body = root.querySelector('[data-body]');
  const showTab = (k) => {
    activeTab = k; $$('[data-tab]', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
    body.innerHTML = ''; const fn = TABS[k] || TABS.geral; fn(body, d, { ctx, reload, mgr, fin });
    history.replaceState(null, '', `#/projetos/${id}${k !== 'geral' ? '?tab=' + k : ''}`);
  };
  root.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); };
  const eb = root.querySelector('[data-edit]'); if (eb) eb.onclick = () => openForm('projects', { id, onSaved: reload });
  root.querySelector('[data-task]').onclick = () => openForm('tasks', { values: { project_id: id, client_id: p.client_id }, onSaved: reload });
  const cb = root.querySelector('[data-close]'); if (cb) cb.onclick = () => closeProject(p, reload);
  root.querySelector('[data-more]').onclick = (e) => menu(e.currentTarget, [
    mgr && !['encerrado'].includes(p.status) ? { label: 'Encerrar projeto', icon: 'check', fn: () => closeProject(p, reload) } : null,
    p.status === 'encerrado' && mgr ? { label: 'Reabrir projeto', icon: 'refresh', fn: async () => { await api.put(`/r/projects/${id}`, { status: 'ativo' }); reload(); } } : null,
    !d.works.length && can('obras') ? { label: 'Iniciar obra', icon: 'helmet', fn: () => openForm('works', { values: { project_id: id }, onSaved: (w) => ctx.go('#/obras/' + w.id) }) } : null,
    { label: 'Aviso de atualização do portal', icon: 'chat', fn: () => portalNotice(p) },
    can('atas') ? { label: 'Nova ata de reunião', icon: 'diary', fn: () => ctx.go(`#/atas/nova?projeto=${id}`) } : null,
    can('placas') ? { label: 'Criar placa de obra', icon: 'sign', fn: async () => { try { const sg = await api.post('/signs', { project_id: id }); ctx.go(`#/placas/${sg.id}`); } catch (er) { fail(er); } } } : null,
    { label: 'Nova reunião', icon: 'calendar', fn: () => openForm('events', { values: { project_id: id, client_id: p.client_id, type: 'reuniao' }, onSaved: reload }) },
    { label: 'Lançar horas', icon: 'clock', fn: () => openForm('time_entries', { values: { project_id: id }, onSaved: reload }) },
    fin ? { label: 'Nova receita do projeto', icon: 'in', fn: () => newEntry('incomes', { project_id: id, client_id: p.client_id }, reload) } : null,
    fin ? { label: 'Nova despesa do projeto', icon: 'out', fn: () => newEntry('expenses', { project_id: id }, reload) } : null,
    '-',
    ...(mgr ? rowActions('projects', p, { onChange: () => ctx.go('#/projetos'), edit: false }) : []),
  ]);
  showTab(tabs.find((t) => t[0] === activeTab) ? activeTab : 'geral');
}

// Aviso de atualização do portal: texto pronto para copiar e enviar (nunca é enviado automaticamente).
// Lista apenas o que já está liberado para o cliente; notas internas nunca entram.
const KIND_LABEL = { revisao: 'Revisão de projeto', arquivo: 'Arquivo', imagem: 'Imagem / render', obra: 'Atualização da obra', orcamento: 'Orçamento para aprovação', etapa: 'Etapa concluída', ata: 'Ata de reunião' };
async function portalNotice(p) {
  let info;
  try { info = await api.get(`/projects/${p.id}/portal-updates`); } catch (e) { return fail(e); }
  const body = el(html`<div class="col" style="gap:12px">
    ${!info.client ? html`<div class="callout warn">Este projeto não tem cliente vinculado.</div>` : !info.has_portal_user ? html`<div class="callout warn">O cliente ainda não tem acesso à Área do Cliente. Crie o acesso antes de enviar o aviso.</div>` : ''}
    <div class="row wrap gap-8"><label class="small muted">Novidades desde</label><input type="date" data-since value="${info.since}" style="max-width:170px">
      ${info.last_notice ? html`<span class="tiny muted">último aviso em ${datetime(info.last_notice.created_at)}${info.last_notice.user_name ? ' por ' + info.last_notice.user_name : ''}</span>` : ''}</div>
    <div data-items></div>
    <div class="field"><label>Mensagem (edite à vontade)</label><textarea data-raw data-msg rows="12"></textarea></div>
    <div class="tiny muted">Somente conteúdos liberados na Área do Cliente aparecem aqui. A mensagem não é enviada automaticamente.</div>
  </div>`);
  let items = info.items;
  const sel = new Set(items.map((i) => i.key));
  const first = (n) => String(n || '').split(/\s+/)[0];
  const compose = () => {
    const chosen = items.filter((i) => sel.has(i.key));
    const lines = chosen.map((i) => `• ${KIND_LABEL[i.kind] || 'Atualização'}: ${i.label}`);
    return [`Olá, ${first(info.client && info.client.name) || 'tudo bem'}! Tudo bem?`, '',
      `Passando para avisar que a Área do Cliente do projeto ${info.project.name} foi atualizada${chosen.length ? ' com:' : '.'}`,
      ...(lines.length ? [...lines, ''] : ['']),
      `Para conferir, acesse: ${info.portal_url}`, '',
      'Qualquer dúvida, estamos à disposição.', '', `${info.office.name}${info.office.tagline ? ' · ' + info.office.tagline : ''}`].join('\n');
  };
  const msg = body.querySelector('[data-msg]');
  let edited = false; msg.addEventListener('input', () => { edited = true; });
  const renderItems = () => {
    body.querySelector('[data-items]').innerHTML = toHTML(items.length ? html`<div class="eyebrow mb-8">O que foi disponibilizado</div><div class="col" style="gap:6px">${items.map((i) => html`<label class="check"><input type="checkbox" value="${i.key}" ${sel.has(i.key) ? 'checked' : ''}> <span>${KIND_LABEL[i.kind] || 'Atualização'}: ${i.label} <span class="tiny muted">${date(i.date)}</span></span></label>`)}</div>`
      : html`<div class="empty sm">Nenhum conteúdo novo liberado ao cliente neste período.</div>`);
    if (!edited) msg.value = compose();
  };
  renderItems();
  body.querySelector('[data-items]').addEventListener('change', (e) => { const c = e.target.closest('input'); if (!c) return; if (c.checked) sel.add(c.value); else sel.delete(c.value); if (!edited || confirm('Atualizar a mensagem com os itens selecionados? Suas edições serão substituídas.')) { edited = false; msg.value = compose(); } });
  body.querySelector('[data-since]').onchange = async (e) => { try { info = await api.get(`/projects/${p.id}/portal-updates?since=${e.target.value}`); items = info.items; sel.clear(); items.forEach((i) => sel.add(i.key)); edited = false; renderItems(); } catch (er) { fail(er); } };
  const wa = info.client && (info.client.whatsapp || info.client.phone);
  modal({ title: 'Aviso de atualização do portal', body, actions: [
    { label: 'Fechar' },
    ...(wa ? [{ label: 'Abrir no WhatsApp', fn: () => { const n = String(wa).replace(/\D/g, '').replace(/^55/, ''); window.open(`https://wa.me/55${n}?text=${encodeURIComponent(msg.value)}`, '_blank'); api.post(`/projects/${p.id}/portal-notice`, { message: msg.value, items: [...sel] }).catch(() => {}); return false; } }] : []),
    { label: 'Copiar mensagem', primary: true, fn: async () => {
      if (!msg.value.trim()) { toast('A mensagem está vazia.', { error: true }); return false; }
      const okc = await copyText(msg.value);
      if (!okc) { toast('Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.', { error: true }); msg.select(); return false; }
      toast('Mensagem copiada. Cole no WhatsApp do cliente.');
      api.post(`/projects/${p.id}/portal-notice`, { message: msg.value, items: [...sel] }).catch(() => {});
    } },
  ] });
}

async function closeProject(p, reload) {
  if (!(await confirmDialog('O projeto será marcado como Encerrado e ficará disponível no arquivo, com todo o histórico, pagamentos, documentos e tarefas preservados.', { title: 'Encerrar projeto', ok: 'Encerrar' }))) return;
  await api.put(`/r/projects/${p.id}`, { status: 'encerrado' }); toast('Projeto encerrado e arquivado no histórico.'); reload();
}

const card = (title, content, action) => html`<div class="card"><div class="card-head"><h3>${title}</h3>${action || ''}</div>${content}</div>`;

const TABS = {
  geral(body, d, { ctx, reload }) {
    const p = d.project;
    const nextTasks = d.tasks.filter((t) => t.status !== 'concluida').slice(0, 6);
    const nextEvents = d.events.filter((e) => e.start_at.slice(0, 10) >= today() && e.status === 'agendado').slice(0, 4);
    body.appendChild(el(html`<div class="grid g3">
      <div class="col span2" style="gap:16px">
        ${card('Dados do projeto', html`<dl class="kv">
          <dt>Cliente</dt><dd>${d.client ? d.client.name : '—'}${d.client && d.client.whatsapp ? html` · <span class="muted">${d.client.whatsapp}</span>` : ''}</dd>
          <dt>Endereço</dt><dd>${[p.address, p.city].filter(Boolean).join(' — ') || '—'}</dd>
          <dt>Tipo</dt><dd>${p.type || '—'}</dd><dt>Área</dt><dd>${p.area ? num(p.area) + ' m²' : '—'}</dd>
          <dt>Contratação</dt><dd>${date(p.contracted_at)}</dd><dt>Início</dt><dd>${date(p.start_date)}</dd><dt>Entrega prevista</dt><dd>${date(p.due_date)}</dd>
          ${p.contract_value !== undefined ? html`<dt>Valor contratado</dt><dd>${money(p.contract_value)}</dd>` : ''}
          <dt>Responsável</dt><dd>${p.manager_name || '—'}</dd>
          <dt>Equipe</dt><dd>${d.members.length ? d.members.map((m) => html`<span class="row gap-8" style="display:inline-flex;margin-right:12px">${avatar(m, 'sm')}${m.name}</span>`) : '—'}</dd>
          ${p.closed_at ? html`<dt>Encerrado em</dt><dd>${date(p.closed_at)}</dd>` : ''}
        </dl>${p.notes ? html`<div class="eyebrow mt-24 mb-8">Observações</div><div class="notes">${p.notes}</div>` : ''}
          ${p.portal_message ? html`<div class="eyebrow mt-24 mb-8">Mensagem na Área do Cliente</div><div class="notes">${p.portal_message}</div>` : ''}`)}
        ${d.images.length ? card('Imagens', html`<div class="gallery">${d.images.slice(0, 8).map((i) => html`<a href="${fileUrl(i, true)}" target="_blank" rel="noopener"><img src="${fileUrl(i, true)}" alt="${i.title}" loading="lazy"></a>`)}</div>`) : ''}
        ${d.decisions.length ? card('Decisões registradas', html`<div class="timeline">${d.decisions.map((x) => html`<div class="tl"><div class="d">${date(x.date)} · ${x.source} · ${x.user_name || ''}</div><div class="x notes">${x.text}</div></div>`)}</div>`) : ''}
      </div>
      <div class="col" style="gap:16px">
        ${card('Próximas tarefas', nextTasks.length ? html`<div class="list">${nextTasks.map((t) => html`<a class="list-item" href="#/tarefas/${t.id}"><div class="grow" style="min-width:0"><div class="li-title">${t.title}</div><div class="li-sub">${t.assignee_name || 'Sem responsável'}</div></div><span class="small ${t.is_late ? 'late' : 'muted'}">${t.due_date ? dateShort(t.due_date) : ''}</span></a>`)}</div>` : html`<div class="empty sm">Nenhuma tarefa aberta.</div>`)}
        ${card('Próximos compromissos', nextEvents.length ? html`<div class="list">${nextEvents.map((e) => html`<div class="list-item"><div class="grow"><div class="li-title">${e.title}</div><div class="li-sub">${datetime(e.start_at)} · ${label('EVENT_TYPES', e.type)}</div></div></div>`)}</div>` : html`<div class="empty sm">Nenhum compromisso agendado.</div>`)}
        ${card('Fornecedores envolvidos', d.suppliers.length ? html`<div class="list">${d.suppliers.map((s) => html`<a class="list-item" href="#/fornecedores/${s.id}"><div class="grow"><div class="li-title">${s.company}</div><div class="li-sub">${s.category || ''}</div></div></a>`)}</div>` : html`<div class="empty sm">Nenhum fornecedor vinculado.</div>`)}
        ${d.contracts.length ? card('Contratos', html`<div class="list">${d.contracts.map((c) => html`<a class="list-item" href="#/contratos/${c.id}"><div class="grow"><div class="li-title">${c.number}</div><div class="li-sub">${c.amount !== undefined ? money(c.amount) : ''}</div></div>${badge('CONTRACT_STATUS', c.status)}</a>`)}</div>`) : ''}
      </div></div>`));
  },

  etapas(body, d, { reload, mgr }) {
    const canEdit = true;
    const box = el(html`<div><div class="row between wrap mb-16"><div class="muted small">Clique em uma etapa para definir prazo, responsável, checklist, arquivos e comentários. O andamento do projeto é calculado automaticamente.</div>
      <div class="row gap-8">${!d.phases.length && isManager() ? html`<button class="btn sm" data-tpl>Aplicar modelo padrão</button>` : ''}<button class="btn sm primary" data-add>${icon('plus')} Nova etapa</button></div></div>
      <div class="card phase-list">${d.phases.length ? d.phases.map((ph, i) => {
        const done = ['concluido', 'aprovado'].includes(ph.status); const doing = !done && ph.status !== 'nao_iniciado';
        const late = !done && ph.due_date && ph.due_date < today();
        return html`<div class="ph ${done ? 'done' : doing ? 'doing' : ''}" data-ph="${ph.id}" style="cursor:pointer"><div class="ph-num">${done ? '✓' : i + 1}</div>
          <div style="min-width:0"><div class="cell-title">${ph.name}</div><div class="cell-sub">${[ph.responsible_name, ph.due_date ? html`<span class="${late ? 'late' : ''}">prazo ${date(ph.due_date)}</span>` : null, ph.check_total ? `checklist ${ph.check_done}/${ph.check_total}` : null, ph.client_visible ? null : 'oculta do cliente'].filter(Boolean).map((x, j) => html`${j ? ' · ' : ''}${x}`)}</div></div>
          <div class="row gap-8"><select class="input" data-st="${ph.id}" style="height:32px;font-size:12.5px;width:auto">${S.meta.lists.PHASE_STATUS.map((o) => html`<option value="${o.value}" ${o.value === ph.status ? 'selected' : ''}>${o.label}</option>`)}</select>
          <button class="icon-btn desktop-only" data-up="${i}" title="Subir">${icon('out', 'sm')}</button></div></div>`;
      }) : html`<div class="empty">Nenhuma etapa. Aplique o modelo padrão ou crie etapas personalizadas.</div>`}</div></div>`);
    body.appendChild(box);
    box.onchange = async (e) => { const s = e.target.closest('[data-st]'); if (!s) return; try { await api.put(`/r/project_phases/${s.dataset.st}`, { status: s.value }); toast('Etapa atualizada.'); reload(); } catch (err) { fail(err); } };
    box.onclick = async (e) => {
      if (e.target.closest('select')) return;
      const up = e.target.closest('[data-up]');
      if (up) { const i = +up.dataset.up; if (!i) return; const ids = d.phases.map((x) => x.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; await api.post(`/projects/${d.project.id}/phases/reorder`, { ids }); return reload(); }
      const row = e.target.closest('[data-ph]'); if (row) return phaseDrawer(d.phases.find((x) => x.id == row.dataset.ph), reload);
    };
    box.querySelector('[data-add]').onclick = () => openForm('project_phases', { values: { project_id: d.project.id }, exclude: ['project_id', 'position'], onSaved: reload });
    const t = box.querySelector('[data-tpl]'); if (t) t.onclick = async () => { await api.post(`/projects/${d.project.id}/apply-template`); reload(); };
  },

  tarefas(body, d, { reload }) {
    const box = el(html`<div><div class="row between mb-16"><div class="chips"><span class="chip on">${d.tasks.filter((t) => t.status !== 'concluida').length} abertas</span><span class="chip">${d.tasks.filter((t) => t.status === 'concluida').length} concluídas</span></div><button class="btn sm primary" data-add>${icon('plus')} Nova tarefa</button></div></div>`);
    box.appendChild(table({ rows: d.tasks.map((t) => ({ ...t, _muted: t.status === 'concluida' })), columns: [
      { key: 'title', label: 'Tarefa', render: (t) => html`<div class="cell-title">${t.title}</div>${t.check_total ? html`<div class="cell-sub">checklist ${t.check_done}/${t.check_total}</div>` : ''}` },
      { key: 'assignee_name', label: 'Responsável' }, { key: 'priority', label: 'Prioridade', render: (t) => prio(t.priority) },
      { key: 'due_date', label: 'Prazo', render: (t) => html`<span class="${t.is_late ? 'late' : ''}">${date(t.due_date)}</span>` },
      { key: 'status', label: 'Status', render: (t) => badge('TASK_STATUS', t.status) }],
      onRow: (t) => taskDrawer(t.id, reload), empty: 'Nenhuma tarefa neste projeto.' }));
    body.appendChild(box);
    box.querySelector('[data-add]').onclick = () => openForm('tasks', { values: { project_id: d.project.id, client_id: d.project.client_id }, onSaved: reload });
  },

  obra(body, d, { ctx, reload }) {
    const box = el(html`<div><div class="row between mb-16"><div class="muted small">Acompanhamento de obra vinculado a este projeto.</div>${can('obras') ? html`<button class="btn sm primary" data-add>${icon('plus')} Nova obra</button>` : ''}</div>
      ${d.works.length ? html`<div class="grid g2">${d.works.map((w) => html`<a class="card" href="#/obras/${w.id}"><div class="row between"><h3 class="serif" style="font-size:22px">${w.name}</h3>${badge('WORK_STATUS', w.status)}</div>
        <div class="mt-16">${progress(w.progress)}</div>
        <div class="row between small muted mt-16"><span>${date(w.start_date)} → ${date(w.due_date)}</span><span>${w.responsible_name || ''}</span></div>
        ${w.budget ? html`<div class="row between small mt-8"><span>Orçado ${money(w.budget)}</span><span>Gasto ${money(w.spent)}</span><span class="${w.available < 0 ? 'danger-text' : ''}">Saldo ${money(w.available)}</span></div>` : ''}</a>`)}</div>`
        : html`<div class="empty">${icon('helmet')}<div>Nenhuma obra iniciada.</div></div>`}</div>`);
    body.appendChild(box);
    const a = box.querySelector('[data-add]'); if (a) a.onclick = () => openForm('works', { values: { project_id: d.project.id }, onSaved: (w) => ctx.go('#/obras/' + w.id) });
  },

  orcamentos(body, d, { reload }) { body.appendChild(quotesPanel(d.quotes, { projectId: d.project.id, onChange: reload })); },

  async infoobra(body, d, { reload }) {
    const { rowsEditor, dirtyTracker, openPdf, readForm } = await import('../lib.js');
    const r = await api.get(`/projects/${d.project.id}/site-info`);
    const i = r.info; const L = S.meta.lists;
    const opts = (k) => L[k].map((o) => ({ value: o.value, label: o.label }));
    const box = el(html`<div class="col" style="gap:16px">
      <div class="row between wrap gap-8"><div class="small muted">Ficha interna de acompanhamento da obra${i.updated_at ? html` · atualizada em ${datetime(i.updated_at)}${i.updated_by_name ? ' por ' + i.updated_by_name : ''}` : ' · ainda não preenchida'}. Não é publicada na Área do Cliente.</div>
        <div class="row gap-8"><span class="dirty-flag">alterações não salvas</span><button class="btn" data-save>${icon('check')} Salvar</button><button class="btn primary" data-pdf>${icon('print')} Gerar relatório da obra em PDF</button></div></div>
      <div class="card"><div class="card-head"><h3>Dados gerais</h3></div><form class="form-grid" data-f>
        <div class="field"><label>Cliente</label><input value="${r.client ? r.client.name : ''}" disabled></div><div class="field"><label>Projeto</label><input value="${r.project.name}" disabled></div>
        <div class="field wide"><label>Endereço da obra</label><input name="address" value="${i.address || ''}"></div>
        <div class="field"><label>Responsável pelo acompanhamento <span class="req">*</span></label><select name="responsible_id"><option value="">— outro (digite ao lado) —</option>${S.meta.users.map((u) => html`<option value="${u.id}" ${u.id === i.responsible_id ? 'selected' : ''}>${u.name}</option>`)}</select></div>
        <div class="field"><label>Responsável (se não for da equipe)</label><input name="responsible_name" value="${i.responsible_name || ''}" placeholder="Ex.: engenheiro da construtora"></div>
        <div class="field"><label>Data de atualização</label><input type="date" name="updated_on" value="${i.updated_on || today()}"></div>
        <div class="field"><label>Situação atual da obra <span class="req">*</span></label><select name="situation"><option value="">—</option>${L.SITE_SITUATION.map((o) => html`<option value="${o.value}" ${o.value === i.situation ? 'selected' : ''}>${o.label}</option>`)}</select></div>
        <div class="field wide"><label>Resumo do andamento</label><textarea name="summary" rows="4">${i.summary || ''}</textarea></div></form></div>
      <div class="card"><div class="card-head"><h3>Projetos executivos</h3><div class="row gap-8"><select class="input" data-exs style="height:32px;width:auto;font-size:12.5px"><option value="">Situação geral: automática</option>${L.EXECUTIVES_STATUS.map((o) => html`<option value="${o.value}" ${o.value === i.executives_status ? 'selected' : ''}>${o.label}</option>`)}</select>${!i.executives.length ? html`<button class="btn xs" data-suggest>Sugerir lista padrão</button>` : ''}</div></div>
        <p class="small muted" style="margin-top:0">Com a lista preenchida, a situação geral é calculada: não entregues, parcialmente entregues ou entregues.${i.executives_status ? html` Atual: <b>${label('EXECUTIVES_STATUS', i.executives_status)}</b>.` : ''}</p><div data-ex></div></div>
      <div class="grid g2"><div class="card"><div class="card-head"><h3>Pendências de projeto</h3></div><div data-pp></div></div><div class="card"><div class="card-head"><h3>Pendências de execução</h3></div><div data-pe></div></div></div>
      <div class="card"><div class="card-head"><h3>Aprovações necessárias do cliente</h3></div><div data-ap></div></div>
      <div class="card"><div class="card-head"><h3>Próximas etapas e planejamento</h3></div><p class="small muted" style="margin-top:0">Informe as próximas etapas e serviços previstos com as previsões definidas pelo escritório. O sistema não cria previsões automaticamente.</p><div data-ns></div></div>
      <div class="card"><div class="card-head"><h3>Observações gerais</h3></div><div class="field"><textarea name="notes" rows="3" data-notes>${i.notes || ''}</textarea></div></div></div>`);
    body.appendChild(box);
    const tracker = dirtyTracker(box);
    const mk = (sel, rows, columns, add) => { const ed = rowsEditor({ columns, rows, addLabel: add, onChange: () => tracker.mark() }); box.querySelector(sel).appendChild(ed); return ed; };
    const pendCols = [{ key: 'descricao', label: 'Pendência', w: '2fr', type: 'textarea' }, { key: 'responsavel', label: 'Responsável', w: '1fr' }, { key: 'prazo', label: 'Prazo', type: 'date', w: '1fr' }, { key: 'situacao', label: 'Situação', type: 'select', options: opts('PENDING_STATUS'), w: '1fr', default: 'aberta' }];
    const ex = mk('[data-ex]', i.executives, [{ key: 'nome', label: 'Projeto executivo', w: '2fr' }, { key: 'situacao', label: 'Situação', type: 'select', options: opts('EXECUTIVE_ITEM_STATUS'), w: '1.1fr', default: 'nao_entregue' }, { key: 'revisao', label: 'Revisão', w: '.7fr', placeholder: 'R00' }, { key: 'entrega', label: 'Data de entrega', type: 'date', w: '1fr' }], 'Adicionar executivo');
    const pp = mk('[data-pp]', i.pending_project, pendCols, 'Adicionar pendência');
    const pe = mk('[data-pe]', i.pending_execution, pendCols, 'Adicionar pendência');
    const ap = mk('[data-ap]', i.approvals, [{ key: 'descricao', label: 'Item para aprovação', w: '2fr', type: 'textarea' }, { key: 'responsavel', label: 'Responsável', w: '1fr' }, { key: 'prazo', label: 'Prazo', type: 'date', w: '1fr' }, { key: 'situacao', label: 'Situação', type: 'select', options: opts('APPROVAL_STATUS'), w: '1fr', default: 'pendente' }], 'Adicionar aprovação');
    const ns = mk('[data-ns]', i.next_steps, [{ key: 'descricao', label: 'Etapa / serviço previsto', w: '2fr', type: 'textarea' }, { key: 'inicio', label: 'Previsão de início', type: 'date', w: '1fr' }, { key: 'conclusao', label: 'Previsão de conclusão', type: 'date', w: '1fr' }, { key: 'responsavel', label: 'Responsável', w: '1fr' }], 'Adicionar etapa');
    const sg = box.querySelector('[data-suggest]');
    if (sg) sg.onclick = () => { ex.rows.set(['Planta layout', 'Planta técnica', 'Planta luminotécnica', 'Planta elétrica', 'Planta hidráulica', 'Planta de forro e gesso', 'Planta de pintura', 'Revestimentos e paginação', 'Marcenaria', 'Marmoraria', 'Serralheria', 'Esquadrias'].map((n) => ({ nome: n, situacao: 'nao_entregue', revisao: '', entrega: '' }))); tracker.mark(); toast('Lista sugerida adicionada — remova o que não se aplica.'); };
    const save = async (quiet) => {
      const f = readForm(box.querySelector('[data-f]'));
      const exs = box.querySelector('[data-exs]').value;
      const data = { ...f, notes: box.querySelector('[data-notes]').value, executives: ex.rows.get(), pending_project: pp.rows.get(), pending_execution: pe.rows.get(), approvals: ap.rows.get(), next_steps: ns.rows.get(), executives_status: exs, executives_status_manual: exs ? 1 : 0 };
      if (!data.responsible_id && !String(data.responsible_name || '').trim()) { toast('Informe o responsável pelo acompanhamento.', { error: true }); return false; }
      if (!data.situation) { toast('Informe a situação atual da obra.', { error: true }); return false; }
      try { await api.put(`/projects/${d.project.id}/site-info`, data); tracker.clean(); if (!quiet) toast('Informações da obra salvas.'); body.innerHTML = ''; TABS.infoobra(body, d, { reload }); return true; } catch (e) { fail(e); return false; }
    };
    box.querySelector('[data-save]').onclick = () => save();
    box.querySelector('[data-pdf]').onclick = () => openPdf(`/pdf/site-info/${d.project.id}`, { dirty: tracker.dirty || i._new, save: () => save(true) });
  },

  financeiro(body, d, { reload }) {
    const pr = d.profitability; const p = d.project;
    const box = el(html`<div class="grid g3">
      <div class="card"><div class="card-head"><h3>Rentabilidade do projeto</h3></div>
        <div class="profit">
          <div>Valor contratado</div><div>${money(pr.contracted)}</div>
          ${pr.rt_received ? html`<div>Reserva técnica recebida</div><div>${money(pr.rt_received)}</div>` : ''}
          <div class="muted">(−) Despesas relacionadas</div><div class="muted">${money(pr.direct_costs)}</div>
          <div class="muted">(−) Custos de obra pagos pelo escritório</div><div class="muted">${money(pr.work_costs)}</div>
          <div class="muted">(−) Outros custos · horas da equipe (${num(pr.hours, 1)} h)</div><div class="muted">${money(pr.hours_cost)}</div>
          <div class="total">Resultado do projeto</div><div class="total ${pr.result < 0 ? 'danger-text' : ''}">${money(pr.result)}</div>
        </div>
        <div class="row between mt-16"><span class="eyebrow">Margem</span><span class="serif ${pr.result < 0 ? 'danger-text' : ''}" style="font-size:34px">${pct(pr.margin)}</span></div>
        <div class="tiny muted mt-8">Custo de horas = horas lançadas × custo/hora de cada pessoa (Configurações › Usuários). ${pr.client_paid_work ? `Pagamentos feitos diretamente pelo cliente a fornecedores: ${money(pr.client_paid_work)} (não entram no resultado).` : ''}</div>
      </div>
      <div class="card span2"><div class="card-head"><h3>Recebimentos</h3><button class="btn xs" data-ni>${icon('plus', 'sm')} Receita</button></div>
        <div class="row gap-24 small mb-16"><span>Recebido <b>${money(pr.received)}</b></span><span>A receber <b>${money(pr.receivable)}</b></span>${pr.overdue ? html`<span class="danger-text">Vencido <b>${money(pr.overdue)}</b></span>` : ''}</div>
        <div data-inc></div></div>
      <div class="card span3"><div class="card-head"><h3>Despesas e custos do projeto</h3><button class="btn xs" data-ne>${icon('plus', 'sm')} Despesa</button></div><div data-exp></div></div>
    </div>`);
    const tbl = (rows, res) => table({ rows, cls: 'compact', empty: 'Nenhum lançamento.', onRow: (r) => entryDrawer(res, r.id, reload), columns: [
      { key: 'due_date', label: 'Vencimento', render: (r) => html`<span class="${r.status === 'vencido' ? 'late' : ''}">${date(r.due_date)}</span>` },
      { key: 'description', label: 'Descrição', render: (r) => html`<div class="cell-title">${r.description}</div><div class="cell-sub">${r.category || ''}${r.supplier_name ? ' · ' + r.supplier_name : ''}${r.paid_by === 'cliente' ? ' · pago pelo cliente' : ''}</div>` },
      { key: 'amount', label: 'Valor', align: 'right', render: (r) => money(r.amount) },
      { key: 'status', label: 'Status', render: (r) => badge(res === 'incomes' ? 'INCOME_STATUS' : 'EXPENSE_STATUS', r.status) }] });
    box.querySelector('[data-inc]').appendChild(tbl(d.incomes, 'incomes'));
    box.querySelector('[data-exp]').appendChild(tbl(d.expenses, 'expenses'));
    box.querySelector('[data-ni]').onclick = () => newEntry('incomes', { project_id: p.id, client_id: p.client_id }, reload);
    box.querySelector('[data-ne]').onclick = () => newEntry('expenses', { project_id: p.id }, reload);
    body.appendChild(box);
  },

  documentos(body, d, { reload }) {
    const p = d.project;
    const box = el(html`<div class="grid g3"><div class="col span2" style="gap:16px">
      <div class="card"><div class="card-head"><h3>Documentos</h3><span class="small muted">RRT, ART, contratos, projetos, apresentações…</span></div><div class="files" data-docs></div></div>
      <div class="card"><div class="card-head"><h3>Imagens</h3><span class="small muted">renders, referências e fotos</span></div><div data-imgs></div></div></div>
      <div class="col" style="gap:16px"><div class="card"><div class="card-head"><h3>Enviar arquivos</h3></div>
        <div class="field mb-16"><label>Categoria</label><select data-cat><option value="">Automática</option>${(S.meta.options.documento || []).map((c) => html`<option>${c}</option>`)}</select></div>
        <label class="toggle mb-16"><input type="checkbox" data-vis><span class="sw"></span><span class="small">Liberar na Área do Cliente</span></label><div data-drop></div></div></div></div>`);
    const docs = box.querySelector('[data-docs]');
    if (!d.documents.length) docs.innerHTML = '<div class="muted small">Nenhum documento.</div>';
    const del = async (doc) => { if (await deleteRow('documents', doc, doc.title)) reload(); };
    d.documents.forEach((doc) => { const r = fileRow(doc, { onArchive: async (x) => { await archiveRow('documents', x, 1); reload(); } }); addVisToggle(r, doc, reload); docs.appendChild(r); });
    const imgs = box.querySelector('[data-imgs]');
    imgs.appendChild(d.images.length ? el(html`<div class="gallery">${d.images.map((i) => html`<a href="${fileUrl(i, true)}" target="_blank" rel="noopener" title="${i.title}"><img src="${fileUrl(i, true)}" loading="lazy" alt="${i.title}">${i.client_visible ? html`<span class="badge info plain" style="position:absolute;left:6px;bottom:6px">cliente</span>` : ''}</a>`)}</div>`) : el('<div class="muted small">Nenhuma imagem.</div>'));
    box.querySelector('[data-drop]').appendChild(dropzone(() => ({ project_id: p.id, client_id: p.client_id, category: box.querySelector('[data-cat]').value, client_visible: box.querySelector('[data-vis]').checked ? '1' : '' }), reload));
    body.appendChild(box);
  },

  agenda(body, d, { reload }) {
    const box = el(html`<div><div class="row between mb-16"><div class="muted small">Reuniões, visitas, apresentações e entregas deste projeto.</div><button class="btn sm primary" data-add>${icon('plus')} Novo evento</button></div></div>`);
    box.appendChild(table({ rows: d.events, empty: 'Nenhum evento.', onRow: (e) => openForm('events', { id: e.id, onSaved: reload }), columns: [
      { key: 'start_at', label: 'Data', render: (e) => datetime(e.start_at) }, { key: 'title', label: 'Título', render: (e) => html`<div class="cell-title">${e.title}</div>${e.minutes ? html`<div class="cell-sub">ata registrada</div>` : ''}` },
      { key: 'type', label: 'Tipo', render: (e) => badge('EVENT_TYPES', e.type) }, { key: 'attendees', label: 'Participantes' }, { key: 'status', label: 'Status', render: (e) => badge('EVENT_STATUS', e.status) }] }));
    box.querySelector('[data-add]').onclick = () => openForm('events', { values: { project_id: d.project.id, client_id: d.project.client_id }, onSaved: reload });
    body.appendChild(box);
  },

  async horas(body, d, { reload }) {
    const { rows } = await api.get(`/r/time_entries?f_project_id=${d.project.id}&limit=500`);
    const total = rows.reduce((s, r) => s + r.hours, 0);
    const box = el(html`<div><div class="row between mb-16"><div class="small">Total lançado: <b>${num(total, 1)} h</b>${d.time.length ? html` · ${d.time.map((t) => `${t.name}: ${num(t.hours, 1)} h`).join(' · ')}` : ''}</div><button class="btn sm primary" data-add>${icon('plus')} Lançar horas</button></div></div>`);
    box.appendChild(table({ rows, empty: 'Nenhuma hora lançada. O registro de horas alimenta o cálculo de rentabilidade.', onRow: (r) => openForm('time_entries', { id: r.id, onSaved: reload }),
      columns: [{ key: 'date', label: 'Data', render: (r) => date(r.date) }, { key: 'user_name', label: 'Pessoa' }, { key: 'task_title', label: 'Tarefa' }, { key: 'hours', label: 'Horas', align: 'right', render: (r) => num(r.hours, 1) }, { key: 'description', label: 'Descrição' }] }));
    box.querySelector('[data-add]').onclick = () => openForm('time_entries', { values: { project_id: d.project.id }, onSaved: reload });
    body.appendChild(box);
  },

  historico(body, d) {
    const act = { create: 'criou', update: 'alterou', delete: 'excluiu', archive: 'arquivou', unarchive: 'restaurou', upload: 'enviou arquivos', pay: 'registrou pagamento', convert: 'converteu' };
    body.appendChild(el(html`<div class="grid g2"><div class="card"><div class="card-head"><h3>Registro de alterações</h3></div>
      ${d.history.length ? html`<div class="timeline">${d.history.map((h) => html`<div class="tl"><div class="d">${datetime(h.created_at)} · ${h.user_name || 'Sistema'} ${act[h.action] || h.action}</div><div class="x">${h.summary}</div>
        ${h.changes && h.action === 'update' ? html`<div class="tiny muted">${Object.entries(JSON.parse(h.changes)).slice(0, 4).map(([k, v]) => `${k}: ${v[0] ?? '—'} → ${v[1] ?? '—'}`).join(' · ')}</div>` : ''}</div>`)}</div>` : html`<div class="empty sm">Sem registros.</div>`}</div>
      <div class="col" style="gap:16px">${d.proposals.length ? html`<div class="card"><div class="card-head"><h3>Proposta de origem</h3></div>${d.proposals.map((p) => html`<a class="list-item" href="#/propostas/${p.id}"><div class="grow"><div class="li-title">${p.number} — ${p.title}</div><div class="li-sub">${money(p.amount)} · enviada ${date(p.sent_at)}</div></div>${badge('PROPOSAL_STATUS', p.status)}</a>`)}</div>` : ''}
      <div class="card"><div class="card-head"><h3>Decisões</h3></div>${d.decisions.length ? html`<div class="timeline">${d.decisions.map((x) => html`<div class="tl"><div class="d">${date(x.date)} · ${x.user_name || ''}</div><div class="x notes">${x.text}</div></div>`)}</div>` : html`<div class="empty sm">As decisões registradas no diário de obra aparecem aqui.</div>`}</div></div></div>`));
  },
};

function addVisToggle(row, doc, reload) {
  const b = el(html`<button class="icon-btn" title="${doc.client_visible ? 'Ocultar do cliente' : 'Liberar ao cliente'}" style="${doc.client_visible ? 'color:var(--info)' : ''}">${icon('eye', 'sm')}</button>`);
  b.onclick = async () => { await api.put(`/r/documents/${doc.id}`, { client_visible: doc.client_visible ? 0 : 1 }); toast(doc.client_visible ? 'Ocultado do cliente.' : 'Liberado na Área do Cliente.'); reload(); };
  row.insertBefore(b, row.querySelector('a.icon-btn'));
}
export { addVisToggle };

export async function phaseDrawer(ph, onChange) {
  const body = el(html`<div><div class="row wrap gap-8 mb-16">${badge('PHASE_STATUS', ph.status)}${ph.due_date ? html`<span class="badge plain ${ph.due_date < today() && !['concluido', 'aprovado'].includes(ph.status) ? 'danger' : ''}">prazo ${date(ph.due_date)}</span>` : ''}${ph.responsible_name ? html`<span class="badge plain">${ph.responsible_name}</span>` : ''}</div>
    ${ph.notes ? html`<div class="notes mb-24">${ph.notes}</div>` : ''}<div data-c class="mb-24"></div><div data-a class="mb-24"></div><div data-m></div></div>`);
  body.querySelector('[data-c]').appendChild(checklist('project_phases', ph.id));
  body.querySelector('[data-a]').appendChild(attachments('project_phases', ph.id, { extraMeta: { project_id: ph.project_id } }));
  body.querySelector('[data-m]').appendChild(comments('project_phases', ph.id));
  const d = drawer({ title: ph.name, sub: 'Etapa do projeto', body, onClose: onChange });
  d.foot.classList.remove('hidden');
  d.foot.innerHTML = toHTML(html`<button class="btn danger" data-del>${icon('trash')}</button><span class="grow"></span><button class="btn primary" data-edit>${icon('edit')} Editar etapa</button>`);
  d.foot.querySelector('[data-edit]').onclick = () => { d.close(); openForm('project_phases', { id: ph.id, exclude: ['project_id'], onSaved: onChange }); };
  d.foot.querySelector('[data-del]').onclick = async () => { if (await deleteRow('project_phases', ph, ph.name)) d.close(); };
}
