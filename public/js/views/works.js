import { S, api, html, el, toHTML, icon, money, date, badge, label, progress, openForm, drawer, dropzone, fileRow, fileUrl, toast, fail, menu, today, table, deleteRow, can, $$ } from '../lib.js';
import { listPage, rowActions } from './common.js';
import { quotesPanel } from './quotes.js';
import { newEntry, entryDrawer } from './finance.js';
import { taskDrawer } from './tasks.js';
import { hbars } from '../charts.js';
import { addVisToggle } from './projects.js';

export default async function (ctx) {
  if (ctx.params[0]) return detail(ctx, Number(ctx.params[0]));
  await listPage({
    root: ctx.root, res: 'works', title: 'Obras', sub: 'Acompanhamento de obras, diário, fases, orçamentos e gastos', query: ctx.query,
    presets: [{ key: 'andamento', label: 'Em andamento' }, { key: 'concluidas', label: 'Concluídas' }, { key: '', label: 'Todas' }],
    filters: ['responsible_id', 'project_id'],
    modes: [{ key: 'cards', label: 'Cartões', icon: 'grid' }, { key: 'lista', label: 'Lista', icon: 'list' }],
    columns: [
      { key: 'name', label: 'Obra', render: (w) => html`<div class="cell-title">${w.name}</div><div class="cell-sub">${w.address || ''}</div>` },
      { key: 'client_name', label: 'Cliente' },
      { key: 'progress', label: 'Executado', render: (w) => progress(w.progress) },
      { key: 'budget', label: 'Orçamento', align: 'right', render: (w) => money(w.budget) },
      { key: 'spent', label: 'Gasto', align: 'right', render: (w) => money(w.spent) },
      { key: 'available', label: 'Saldo', align: 'right', render: (w) => html`<span class="${w.available < 0 ? 'danger-text' : ''}">${money(w.available)}</span>` },
      { key: 'due_date', label: 'Previsão', render: (w) => date(w.due_date) },
      { key: 'status', label: 'Status', render: (w) => badge('WORK_STATUS', w.status) },
    ],
    onRow: (w) => ctx.go('#/obras/' + w.id),
    actions: (w, reload) => rowActions('works', w, { onChange: reload }),
    render: (rows, state) => {
      if (state.mode === 'lista') return null;
      if (!rows.length) return el(html`<div class="empty">${icon('helmet')}<div>Nenhuma obra encontrada.</div></div>`);
      return el(html`<div class="pcards">${rows.map((w) => html`<a class="pcard" href="#/obras/${w.id}"><div class="row between"><span class="eyebrow">${w.client_name || ''}</span>${badge('WORK_STATUS', w.status)}</div>
        <h3>${w.name}</h3><div>${progress(w.progress)}</div>
        <div class="row between small muted"><span>Gasto ${money(w.spent)}${w.budget ? ' de ' + money(w.budget) : ''}</span><span>${w.due_date ? 'até ' + date(w.due_date) : ''}</span></div>
        <div class="small muted">${w.last_log ? `Último registro no diário: ${date(w.last_log)}` : 'Sem registros no diário'}</div></a>`)}</div>`);
    },
  });
}

async function detail(ctx, id) {
  const root = ctx.root;
  let d;
  try { d = await api.get(`/works/${id}/overview`); } catch (e) { root.innerHTML = toHTML(html`<div class="empty">${e.message}</div>`); return; }
  const w = d.work; const fin = !!d.expenses;
  let active = ctx.query.tab || 'fases';
  const reload = () => detail({ ...ctx, query: { ...ctx.query, tab: active } }, id);
  const tabs = [['fases', 'Fases', d.phases.length], ['diario', 'Diário de obra', d.logs.length], ['execucao', 'Orçamento de execução'], ['orcamentos', 'Orçamentos de fornecedores', d.quotes.length], ['gastos', 'Gastos'], ['fotos', 'Fotos', d.photos.length], ['documentos', 'Documentos', d.documents.length], ['tarefas', 'Tarefas', d.tasks.filter((t) => t.status !== 'concluida').length]];
  root.innerHTML = toHTML(html`
    <div class="hero"><div class="crumbs"><a href="#/obras">Obras</a> ${icon('chevron', 'sm')} <a href="#/projetos/${w.project_id}">${w.project_name}</a></div>
      <div class="row between top wrap gap-16"><div><h1>${w.name}</h1><div class="info-row mt-8"><span>${icon('users', 'sm')}${w.client_name || '—'}</span>${w.address ? html`<span>${icon('pin', 'sm')}${w.address}</span>` : ''}<span>${icon('users', 'sm')}Resp.: ${w.responsible_name || '—'}</span>${badge('WORK_STATUS', w.status)}</div></div>
        <div class="row wrap"><button class="btn" data-edit>${icon('edit')} Editar</button><button class="btn primary" data-log>${icon('diary')} Registrar no diário</button><button class="icon-btn" data-more>${icon('more')}</button></div></div>
      <div class="stat-strip mt-24">
        <div><div class="l">Executado</div><div class="v">${w.progress}%</div><div class="progress thin mt-8"><span style="width:${w.progress}%"></span></div></div>
        <div><div class="l">Orçamento previsto</div><div class="v">${money(w.budget)}</div></div>
        <div><div class="l">Valor gasto</div><div class="v">${money(w.spent)}</div></div>
        <div><div class="l">Saldo disponível</div><div class="v ${w.available < 0 ? 'danger-text' : ''}">${money(w.available)}</div></div>
        <div><div class="l">Início → previsão</div><div class="v" style="font-size:18px;margin-top:6px">${date(w.start_date)} → ${date(w.due_date)}</div></div>
      </div></div>
    <div class="tabs mt-24">${tabs.map(([k, l, n]) => html`<button data-tab="${k}">${l}${n ? html`<span class="n">${n}</span>` : ''}</button>`)}</div><div data-body></div>`);
  const body = root.querySelector('[data-body]');
  const show = (k) => { active = k; $$('[data-tab]', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === k)); body.innerHTML = ''; (T[k] || T.fases)(body, d, { reload, fin, ctx }); history.replaceState(null, '', `#/obras/${id}${k !== 'fases' ? '?tab=' + k : ''}`); };
  root.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); };
  root.querySelector('[data-edit]').onclick = () => openForm('works', { id, onSaved: reload });
  root.querySelector('[data-log]').onclick = () => newLog(w, reload);
  root.querySelector('[data-more]').onclick = (e) => menu(e.currentTarget, [
    { label: 'Nova visita técnica (agenda)', icon: 'calendar', fn: () => openForm('events', { values: { type: 'visita_tecnica', work_id: w.id, project_id: w.project_id, client_id: w.client_id, location: w.address }, onSaved: reload }) },
    { label: 'Informações gerais da obra', icon: 'docs', fn: () => ctx.go(`#/projetos/${w.project_id}?tab=infoobra`) },
    { label: 'PDF das etapas da obra', icon: 'print', fn: async () => (await import('../lib.js')).openPdf(`/pdf/work-phases/${w.id}`) },
    { label: 'Nova tarefa da obra', icon: 'tasks', fn: () => openForm('tasks', { values: { work_id: w.id, project_id: w.project_id }, onSaved: reload }) },
    fin ? { label: 'Registrar gasto', icon: 'out', fn: () => newEntry('expenses', { work_id: w.id, project_id: w.project_id, category: 'Obra' }, reload) } : null,
    w.status !== 'concluida' ? { label: 'Marcar obra como concluída', icon: 'check', fn: async () => { await api.put(`/r/works/${w.id}`, { status: 'concluida', progress: 100 }); toast('Obra concluída.'); reload(); } } : null,
    '-', ...rowActions('works', w, { onChange: () => ctx.go('#/obras'), edit: false }),
  ]);
  show(tabs.find((t) => t[0] === active) ? active : 'fases');
}

function newLog(w, reload) {
  openForm('work_logs', { values: { work_id: w.id }, exclude: ['work_id'], title: 'Novo registro no diário', onSaved: (log) => {
    reload();
    const box = el('<div></div>');
    box.appendChild(dropzone({ entity: 'work_logs', entity_id: log.id, work_id: w.id, project_id: w.project_id, category: 'Fotos de obra' }, () => { reload(); }, { label: 'Adicionar fotos a este registro', accept: 'image/*' }));
    const dd = drawer({ title: 'Fotos do registro', sub: 'Diário de obra', body: box });
    dd.foot.classList.remove('hidden'); dd.foot.innerHTML = '<button class="btn primary">Concluir</button>'; dd.foot.querySelector('button').onclick = dd.close;
  } });
}

const T = {
  fases(body, d, { reload }) {
    const box = el(html`<div><div class="row between wrap mb-16"><div class="muted small">Atualize o percentual de cada fase — o percentual executado da obra é calculado automaticamente. Clique na fase para informar responsável, pendências e próxima ação.</div><div class="row gap-8"><button class="btn sm" data-pdf>${icon('print', 'sm')} Gerar PDF das etapas</button><button class="btn sm primary" data-add>${icon('plus')} Nova fase</button></div></div>
      <div class="card phase-list">${d.phases.length ? d.phases.map((p, i) => html`<div class="ph ${p.progress >= 100 ? 'done' : p.progress > 0 ? 'doing' : ''}" style="grid-template-columns:28px 1fr minmax(160px,260px)"><div class="ph-num">${p.progress >= 100 ? '✓' : i + 1}</div>
        <div style="min-width:0"><div class="cell-title" data-open="${p.id}" style="cursor:pointer">${p.name}</div><div class="cell-sub">${[p.responsible || p.supplier_name, p.due_date ? 'até ' + date(p.due_date) : null, label('PHASE_STATUS', p.status)].filter(Boolean).join(' · ')}</div>${p.pending || p.next_action ? html`<div class="cell-sub warning-text">${p.pending ? 'Pendência: ' + p.pending : ''}${p.pending && p.next_action ? ' · ' : ''}${p.next_action ? 'Próxima ação: ' + p.next_action : ''}</div>` : ''}</div>
        <div class="row gap-8"><input type="range" min="0" max="100" step="5" value="${p.progress}" data-pg="${p.id}"><span class="small muted" style="width:38px;text-align:right" data-pv="${p.id}">${p.progress}%</span></div></div>`) : html`<div class="empty">Nenhuma fase cadastrada.</div>`}</div></div>`);
    body.appendChild(box);
    box.addEventListener('input', (e) => { const r = e.target.closest('[data-pg]'); if (r) box.querySelector(`[data-pv="${r.dataset.pg}"]`).textContent = r.value + '%'; });
    box.addEventListener('change', async (e) => { const r = e.target.closest('[data-pg]'); if (!r) return; try { await api.put(`/r/work_phases/${r.dataset.pg}`, { progress: +r.value, status: +r.value >= 100 ? 'concluido' : +r.value > 0 ? 'em_andamento' : 'nao_iniciado' }); toast('Execução atualizada.'); reload(); } catch (err) { fail(err); } });
    box.onclick = (e) => { const o = e.target.closest('[data-open]'); if (o) openForm('work_phases', { id: +o.dataset.open, exclude: ['work_id'], onSaved: reload }); };
    box.querySelector('[data-add]').onclick = () => openForm('work_phases', { values: { work_id: d.work.id }, exclude: ['work_id', 'position'], onSaved: reload });
    box.querySelector('[data-pdf]').onclick = async () => (await import('../lib.js')).openPdf(`/pdf/work-phases/${d.work.id}`);
  },
  async execucao(body, d, { reload }) {
    const { rowsEditor, dirtyTracker, openPdf, round2 } = await import('../lib.js');
    const b = await api.get(`/works/${d.work.id}/budget`);
    const box = el(html`<div class="col" style="gap:16px">
      <div class="row between wrap gap-8"><div class="small muted">Itens, quantidades e valores estimados para a execução da obra. Agrupe por etapa (ex.: Marcenaria, Iluminação) para ver subtotais no PDF.</div>
        <div class="row gap-8"><span class="dirty-flag">alterações não salvas</span><button class="btn" data-save>${icon('check')} Salvar</button><button class="btn primary" data-pdf>${icon('print')} Gerar PDF do orçamento</button></div></div>
      <div class="card"><div data-items></div>
        <div class="budget-total"><span class="small muted">Orçamento previsto da obra: ${money(b.work.budget)}</span><span>Total do orçamento de execução <b class="serif" style="font-size:26px;font-weight:500" data-tot>${money(b.total)}</b></span></div>
        <div class="row wrap gap-8">${b.quotes.length ? html`<button class="btn sm" data-import>${icon('download', 'sm')} Importar orçamentos aprovados (${b.quotes.length})</button>` : ''}<label class="toggle"><input type="checkbox" data-apply><span class="sw"></span><span class="small">Ao salvar, usar este total como “orçamento previsto” da obra</span></label></div></div>
      <div class="card"><div class="card-head"><h3>Observações do orçamento</h3></div><div class="field"><textarea rows="3" data-notes placeholder="Ex.: valores sujeitos à confirmação dos fornecedores">${b.work.budget_notes || ''}</textarea></div></div></div>`);
    body.appendChild(box);
    const tracker = dirtyTracker(box);
    const sub = (r) => round2((Number(r.qty) || 0) * (Number(r.unit_price) || 0));
    const ed = rowsEditor({
      columns: [{ key: 'group_name', label: 'Etapa / grupo', w: '1fr' }, { key: 'item', label: 'Item', w: '1.3fr' }, { key: 'description', label: 'Descrição', w: '1.6fr', type: 'textarea' },
        { key: 'qty', label: 'Qtd.', type: 'number', w: '.55fr', default: 1 }, { key: 'unit', label: 'Un.', w: '.55fr', placeholder: 'm², un' }, { key: 'unit_price', label: 'Valor unitário', type: 'money', w: '1fr' },
        { key: 'sub', label: 'Subtotal', w: '.9fr', render: (r) => `<div class="small" style="padding-top:9px;text-align:right">${money(sub(r))}</div>` }],
      rows: b.items, addLabel: 'Adicionar item', empty: 'Nenhum item. Adicione itens ou importe os orçamentos aprovados de fornecedores.',
      default: {}, total: (rows) => html`${rows.length} item(ns)`,
      onChange: (rows) => { tracker.mark(); box.querySelector('[data-tot]').textContent = money(rows.reduce((s2, r) => s2 + sub(r), 0)); box.querySelectorAll('.re-row').forEach((row, i) => { const c = row.querySelectorAll('.re-cell')[6]; if (c && rows[i]) c.querySelector('div').textContent = money(sub(rows[i])); }); },
    });
    box.querySelector('[data-items]').appendChild(ed);
    const im = box.querySelector('[data-import]');
    if (im) im.onclick = () => { const cur = ed.rows.get(); b.quotes.forEach((q) => cur.push({ group_name: q.item, item: `${q.item}${q.supplier_name ? ' — ' + q.supplier_name : ''}`, description: '', qty: 1, unit: 'vb', unit_price: q.amount })); ed.rows.set(cur); tracker.mark(); box.querySelector('[data-tot]').textContent = money(cur.reduce((s2, r) => s2 + sub(r), 0)); toast('Orçamentos importados — revise e salve.'); };
    const save = async (quiet) => {
      try { await api.put(`/works/${d.work.id}/budget`, { items: ed.rows.get(), budget_notes: box.querySelector('[data-notes]').value, apply_total: box.querySelector('[data-apply]').checked }); tracker.clean(); if (!quiet) toast('Orçamento de execução salvo.'); reload(); return true; } catch (e) { fail(e); return false; }
    };
    box.querySelector('[data-save]').onclick = () => save();
    box.querySelector('[data-pdf]').onclick = () => openPdf(`/pdf/work-budget/${d.work.id}`, { dirty: tracker.dirty, save: () => save(true) });
  },
  diario(body, d, { reload }) {
    const box = el(html`<div><div class="row between mb-16"><div class="muted small">Registros de visitas, decisões, problemas, pendências e fornecedores presentes.</div><button class="btn sm primary" data-add>${icon('plus')} Novo registro</button></div>
      ${d.logs.length ? html`<div class="timeline">${d.logs.map((l) => html`<div class="tl"><div class="row between wrap"><div class="d">${date(l.date)} · ${l.user_name || ''} ${badge('WORK_LOG_KIND', l.kind)} ${l.client_visible ? html`<span class="badge info plain">visível ao cliente</span>` : ''}</div><button class="icon-btn" data-lm="${l.id}">${icon('more', 'sm')}</button></div>
        <div class="card mt-8"><div class="notes">${l.description}</div>
        ${l.decisions ? html`<div class="mt-16"><div class="eyebrow">Decisões</div><div class="notes">${l.decisions}</div></div>` : ''}
        ${l.problems ? html`<div class="mt-16"><div class="eyebrow danger-text">Problemas encontrados</div><div class="notes">${l.problems}</div></div>` : ''}
        ${l.pending ? html`<div class="mt-16"><div class="eyebrow warning-text">Pendências</div><div class="notes">${l.pending}</div></div>` : ''}
        ${l.suppliers.length ? html`<div class="mt-16 small muted">Fornecedores presentes: ${l.suppliers.map((s) => s.company).join(', ')}</div>` : ''}
        ${l.photos.length ? html`<div class="gallery mt-16">${l.photos.map((p) => html`<a href="${fileUrl(p, true)}" target="_blank" rel="noopener"><img src="${fileUrl(p, true)}" loading="lazy" alt=""></a>`)}</div>` : ''}
        <div class="mt-16" data-ph="${l.id}"></div></div></div>`)}</div>` : html`<div class="empty">${icon('diary')}<div>Nenhum registro no diário.</div></div>`}</div>`);
    body.appendChild(box);
    d.logs.forEach((l) => { const z = box.querySelector(`[data-ph="${l.id}"]`); if (z) { const dz = dropzone({ entity: 'work_logs', entity_id: l.id, work_id: d.work.id, project_id: d.work.project_id, category: 'Fotos de obra' }, reload, { label: 'Adicionar fotos', accept: 'image/*', compact: true }); z.appendChild(dz); } });
    box.querySelector('[data-add]').onclick = () => newLog(d.work, reload);
    box.onclick = (e) => { const b = e.target.closest('[data-lm]'); if (!b) return; const l = d.logs.find((x) => x.id == b.dataset.lm);
      menu(b, [{ label: 'Editar', icon: 'edit', fn: () => openForm('work_logs', { id: l.id, exclude: ['work_id'], onSaved: reload }) },
        { label: l.client_visible ? 'Ocultar do cliente' : 'Mostrar ao cliente', icon: 'eye', fn: async () => { await api.put(`/r/work_logs/${l.id}`, { client_visible: l.client_visible ? 0 : 1 }); reload(); } },
        { label: 'Excluir', icon: 'trash', danger: true, fn: async () => { if (await deleteRow('work_logs', l)) reload(); } }]); };
  },
  orcamentos(body, d, { reload }) { body.appendChild(quotesPanel(d.quotes, { projectId: d.work.project_id, workId: d.work.id, onChange: reload })); },
  gastos(body, d, { reload, fin }) {
    const box = el(html`<div class="grid g3"><div class="card"><div class="card-head"><h3>Por categoria</h3></div><div data-cat></div></div><div class="card"><div class="card-head"><h3>Por fornecedor</h3></div><div data-sup></div></div>
      <div class="card"><div class="card-head"><h3>Orçamento</h3></div><div class="serif" style="font-size:30px">${money(d.work.spent)}</div><div class="small muted">de ${money(d.work.budget)} previstos</div>
      <div class="progress mt-16 ${d.work.available < 0 ? 'danger' : ''}"><span style="width:${d.work.budget ? Math.min(100, (d.work.spent / d.work.budget) * 100) : 0}%"></span></div><div class="small mt-8 ${d.work.available < 0 ? 'danger-text' : 'muted'}">Saldo: ${money(d.work.available)}</div></div>
      ${fin ? html`<div class="span3"><div class="row between mb-16 mt-16"><h3>Lançamentos da obra</h3><button class="btn sm primary" data-add>${icon('plus')} Registrar gasto</button></div><div data-t></div></div>` : ''}</div>`);
    box.querySelector('[data-cat]').appendChild(hbars(d.spent_by_category));
    box.querySelector('[data-sup]').appendChild(hbars(d.spent_by_supplier));
    if (fin) {
      box.querySelector('[data-t]').appendChild(table({ rows: d.expenses, empty: 'Nenhum gasto registrado.', onRow: (r) => entryDrawer('expenses', r.id, reload), columns: [
        { key: 'due_date', label: 'Data', render: (r) => date(r.paid_at || r.due_date) }, { key: 'description', label: 'Descrição', render: (r) => html`<div class="cell-title">${r.description}</div><div class="cell-sub">${r.category || ''}${r.receipts_count ? ` · ${r.receipts_count} anexo(s)` : ''}</div>` },
        { key: 'supplier_name', label: 'Fornecedor' }, { key: 'paid_by', label: 'Pago por', render: (r) => label('PAID_BY', r.paid_by) },
        { key: 'amount', label: 'Valor', align: 'right', render: (r) => money(r.amount) }, { key: 'status', label: 'Status', render: (r) => badge('EXPENSE_STATUS', r.status) }] }));
      box.querySelector('[data-add]').onclick = () => newEntry('expenses', { work_id: d.work.id, project_id: d.work.project_id, category: 'Obra' }, reload);
    }
    body.appendChild(box);
  },
  fotos(body, d, { reload }) {
    const box = el(html`<div><div class="mb-16" data-drop></div>${d.photos.length ? html`<div class="gallery">${d.photos.map((p) => html`<a href="${fileUrl(p, true)}" target="_blank" rel="noopener"><img src="${fileUrl(p, true)}" loading="lazy" alt="${p.title}"></a>`)}</div>` : html`<div class="empty">Nenhuma foto.</div>`}</div>`);
    box.querySelector('[data-drop]').appendChild(dropzone({ work_id: d.work.id, project_id: d.work.project_id, category: 'Fotos de obra' }, reload, { label: 'Enviar fotos da obra', accept: 'image/*' }));
    body.appendChild(box);
  },
  documentos(body, d, { reload }) {
    const box = el(html`<div class="grid g3"><div class="card span2"><div class="card-head"><h3>Notas fiscais, orçamentos e documentos</h3></div><div class="files" data-l></div></div>
      <div class="card"><div class="field mb-16"><label>Categoria</label><select data-cat>${['Notas fiscais', 'Orçamentos', 'Alvarás e licenças', 'Documentos de condomínio', 'ART', 'RRT', 'Outros'].map((c) => html`<option>${c}</option>`)}</select></div><div data-drop></div></div></div>`);
    const l = box.querySelector('[data-l]');
    if (!d.documents.length) l.innerHTML = '<div class="muted small">Nenhum documento.</div>';
    d.documents.forEach((doc) => { const r = fileRow(doc, { onDelete: async (x) => { if (await deleteRow('documents', x, x.title)) reload(); } }); addVisToggle(r, doc, reload); l.appendChild(r); });
    box.querySelector('[data-drop]').appendChild(dropzone(() => ({ work_id: d.work.id, project_id: d.work.project_id, category: box.querySelector('[data-cat]').value }), reload));
    body.appendChild(box);
  },
  tarefas(body, d, { reload }) {
    const box = el(html`<div><div class="row between mb-16"><span></span><button class="btn sm primary" data-add>${icon('plus')} Nova tarefa</button></div></div>`);
    box.appendChild(table({ rows: d.tasks, empty: 'Nenhuma tarefa vinculada à obra.', onRow: (t) => taskDrawer(t.id, reload), columns: [
      { key: 'title', label: 'Tarefa' }, { key: 'assignee_name', label: 'Responsável' }, { key: 'due_date', label: 'Prazo', render: (t) => html`<span class="${t.is_late ? 'late' : ''}">${date(t.due_date)}</span>` }, { key: 'status', label: 'Status', render: (t) => badge('TASK_STATUS', t.status) }] }));
    box.querySelector('[data-add]').onclick = () => openForm('tasks', { values: { work_id: d.work.id, project_id: d.work.project_id }, onSaved: reload });
    body.appendChild(box);
  },
};
