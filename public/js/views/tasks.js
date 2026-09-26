import { S, api, html, el, toHTML, icon, date, badge, label, prio, avatar, user, openForm, drawer, checklist, comments, attachments, toast, fail, today, deleteRow, duplicateRow, datetime, relDay, $$ } from '../lib.js';
import { listPage, rowActions, monthGrid, monthTitle, shiftMonth } from './common.js';

const PRESETS = [
  { key: 'minhas', label: 'Minhas tarefas' }, { key: 'hoje', label: 'Hoje' }, { key: 'semana', label: 'Esta semana' },
  { key: 'atrasadas', label: 'Atrasadas' }, { key: 'abertas', label: 'Todas em aberto' }, { key: '', label: 'Todas' },
];

export default async function (ctx) {
  const q = { ...ctx.query };
  if (q.view !== undefined) q.preset = q.view === 'todas' ? '' : q.view;
  let calMonth = today().slice(0, 7);
  const page = await listPage({
    root: ctx.root, res: 'tasks', title: 'Tarefas', sub: 'Organize o trabalho da equipe — lista, kanban e calendário', query: q, presets: PRESETS,
    filters: ['assignee_id', 'project_id', 'priority'],
    modes: [{ key: 'lista', label: 'Lista', icon: 'list' }, { key: 'kanban', label: 'Kanban', icon: 'kanban' }, { key: 'calendario', label: 'Calendário', icon: 'calendar' }],
    newLabel: 'Nova tarefa',
    onNew: (reload) => openForm('tasks', { onSaved: reload }),
    columns: [
      { key: 'title', label: 'Tarefa', render: (t) => html`<div class="row gap-8"><input type="checkbox" data-done="${t.id}" ${t.status === 'concluida' ? 'checked' : ''} style="accent-color:#111;width:16px;height:16px"><div style="min-width:0"><div class="cell-title" style="${t.status === 'concluida' ? 'text-decoration:line-through;color:#aaa' : ''}">${t.title}</div>
        <div class="cell-sub">${[t.project_name, t.check_total ? `checklist ${t.check_done}/${t.check_total}` : null, t.comments_count ? `${t.comments_count} comentário(s)` : null].filter(Boolean).join(' · ')}</div></div></div>` },
      { key: 'assignee_name', label: 'Responsável', render: (t) => (t.assignee_id ? html`<span class="row gap-8">${avatar(user(t.assignee_id), 'sm')}${t.assignee_name}</span>` : '—') },
      { key: 'priority', label: 'Prioridade', render: (t) => prio(t.priority), csv: (t) => label('TASK_PRIORITY', t.priority) },
      { key: 'due_date', label: 'Prazo', render: (t) => html`<span class="${t.is_late ? 'late' : ''}">${date(t.due_date)}</span>${t.due_date && t.status !== 'concluida' ? html`<div class="cell-sub">${relDay(t.due_date)}</div>` : ''}`, csv: (t) => date(t.due_date) },
      { key: 'status', label: 'Status', render: (t) => badge('TASK_STATUS', t.status), csv: (t) => label('TASK_STATUS', t.status) },
    ],
    onRow: (t) => taskDrawer(t.id, () => page.load()),
    actions: (t, reload) => rowActions('tasks', t, { onChange: reload }),
    render: (rows, state, reload) => {
      if (state.mode === 'kanban') return kanban(rows, reload);
      if (state.mode === 'calendario') {
        const box = el('<div></div>');
        const draw = () => {
          box.innerHTML = toHTML(html`<div class="row between mb-16"><div class="row gap-8"><button class="btn sm" data-pm>‹</button><b class="serif" style="font-size:22px;min-width:180px;text-align:center">${monthTitle(calMonth)}</b><button class="btn sm" data-nm>›</button></div><span class="small muted">Tarefas pelo prazo</span></div>`);
          box.appendChild(monthGrid({ month: calMonth, itemsFor: (d) => rows.filter((t) => t.due_date === d).map((t) => ({ id: t.id, label: t.title, title: t.title, cls: `task ${t.status === 'concluida' ? 'done' : ''}` })),
            onDay: (d, id) => (id ? taskDrawer(+id, reload) : openForm('tasks', { values: { due_date: d }, onSaved: reload })) }));
          box.querySelector('[data-pm]').onclick = () => { calMonth = shiftMonth(calMonth, -1); draw(); };
          box.querySelector('[data-nm]').onclick = () => { calMonth = shiftMonth(calMonth, 1); draw(); };
        };
        draw(); return box;
      }
      return null;
    },
    afterRender: (rows, state, reload) => {
      $$('[data-done]', ctx.root).forEach((c) => (c.onchange = async (e) => { e.stopPropagation(); try { await api.put(`/r/tasks/${c.dataset.done}`, { status: c.checked ? 'concluida' : 'pendente' }); toast(c.checked ? 'Tarefa concluída.' : 'Tarefa reaberta.'); reload(); } catch (err) { fail(err); } }));
    },
  });
  if (ctx.params[0]) taskDrawer(Number(ctx.params[0]), () => page.load());
}

function kanban(rows, reload) {
  const cols = S.meta.lists.TASK_STATUS;
  const k = el(html`<div class="kanban">${cols.map((c) => {
    const items = rows.filter((t) => t.status === c.value);
    return html`<div class="kcol" data-col="${c.value}"><div class="kcol-head"><span>${c.label}</span><span class="muted">${items.length}</span></div>
      ${items.map((t) => html`<div class="kcard" draggable="true" data-id="${t.id}"><div class="kt">${t.title}</div>
        ${t.project_name ? html`<div class="small muted">${t.project_name}</div>` : ''}
        <div class="km">${prio(t.priority)}${t.due_date ? html`<span class="${t.is_late ? 'late' : ''}">${icon('clock', 'sm')} ${date(t.due_date).slice(0, 5)}</span>` : ''}${t.check_total ? html`<span>${icon('check', 'sm')} ${t.check_done}/${t.check_total}</span>` : ''}<span class="grow"></span>${avatar(user(t.assignee_id), 'sm')}</div></div>`)}
      <button class="btn ghost sm" data-addcol="${c.value}">${icon('plus', 'sm')} Adicionar</button></div>`;
  })}</div>`);
  let dragId = null;
  k.addEventListener('dragstart', (e) => { const c = e.target.closest('.kcard'); if (!c) return; dragId = c.dataset.id; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
  k.addEventListener('dragend', (e) => { const c = e.target.closest('.kcard'); if (c) c.classList.remove('dragging'); $$('.kcol', k).forEach((x) => x.classList.remove('over')); });
  k.addEventListener('dragover', (e) => { const col = e.target.closest('.kcol'); if (!col) return; e.preventDefault(); $$('.kcol', k).forEach((x) => x.classList.toggle('over', x === col)); });
  k.addEventListener('drop', async (e) => {
    const col = e.target.closest('.kcol'); if (!col || !dragId) return; e.preventDefault();
    const t = rows.find((r) => r.id == dragId); if (t.status === col.dataset.col) return;
    try { await api.put(`/r/tasks/${dragId}`, { status: col.dataset.col }); toast(`Movida para “${label('TASK_STATUS', col.dataset.col)}”.`); reload(); } catch (err) { fail(err); }
  });
  k.addEventListener('click', (e) => {
    const a = e.target.closest('[data-addcol]'); if (a) return openForm('tasks', { values: { status: a.dataset.addcol }, onSaved: reload });
    const c = e.target.closest('.kcard'); if (c) taskDrawer(+c.dataset.id, reload);
  });
  // mobile: toque longo abre menu de status
  return k;
}

export async function taskDrawer(id, onChange) {
  let t;
  try { t = await api.get(`/r/tasks/${id}`); } catch (e) { return fail(e); }
  const body = el(html`<div>
    <div class="row wrap gap-8 mb-16">${badge('TASK_STATUS', t.status)}${prio(t.priority)}${t.due_date ? html`<span class="badge plain ${t.is_late ? 'danger' : ''}">${icon('clock', 'sm')} ${date(t.due_date)} · ${relDay(t.due_date)}</span>` : ''}</div>
    <div class="btn-group mb-24" data-st>${S.meta.lists.TASK_STATUS.map((s) => html`<button class="${s.value === t.status ? 'on' : ''}" data-v="${s.value}">${s.label}</button>`)}</div>
    ${t.description ? html`<div class="notes mb-24">${t.description}</div>` : ''}
    <dl class="kv mb-24">
      <dt>Responsável</dt><dd>${t.assignee_name ? html`<span class="row gap-8">${avatar(user(t.assignee_id), 'sm')}${t.assignee_name}</span>` : '—'}</dd>
      <dt>Projeto</dt><dd>${t.project_name ? html`<a href="#/projetos/${t.project_id}">${t.project_name}</a>` : '—'}</dd>
      <dt>Cliente</dt><dd>${t.client_name || '—'}</dd>
      <dt>Criada por</dt><dd>${t.creator_name || '—'} em ${date(t.created_at)}</dd>
      ${t.completed_at ? html`<dt>Concluída em</dt><dd>${date(t.completed_at)}</dd>` : ''}
    </dl>
    <div data-c class="mb-24"></div><div data-a class="mb-24"></div><div data-m></div></div>`);
  body.querySelector('[data-c]').appendChild(checklist('tasks', t.id));
  body.querySelector('[data-a]').appendChild(attachments('tasks', t.id));
  body.querySelector('[data-m]').appendChild(comments('tasks', t.id));
  let changed = false;
  const d = drawer({ title: t.title, sub: 'Tarefa', body, onClose: () => { if (location.hash.startsWith('#/tarefas/')) history.replaceState(null, '', '#/tarefas'); onChange && onChange(); } });
  body.querySelector('[data-st]').onclick = async (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    try { await api.put(`/r/tasks/${t.id}`, { status: b.dataset.v }); $$('[data-v]', body).forEach((x) => x.classList.toggle('on', x === b)); toast('Status atualizado.'); changed = true; } catch (err) { fail(err); }
  };
  d.foot.classList.remove('hidden');
  d.foot.innerHTML = toHTML(html`<button class="btn danger" data-del>${icon('trash')}</button><button class="btn" data-dup>${icon('copy')}</button><span class="grow"></span>${t.project_id ? html`<button class="btn" data-h>${icon('clock')} Lançar horas</button>` : ''}<button class="btn primary" data-edit>${icon('edit')} Editar</button>`);
  d.foot.querySelector('[data-edit]').onclick = () => { d.close(); openForm('tasks', { id: t.id, onSaved: onChange }); };
  d.foot.querySelector('[data-dup]').onclick = async () => { await duplicateRow('tasks', t); d.close(); };
  d.foot.querySelector('[data-del]').onclick = async () => { if (await deleteRow('tasks', t, t.title)) d.close(); };
  const h = d.foot.querySelector('[data-h]'); if (h) h.onclick = () => openForm('time_entries', { values: { project_id: t.project_id, task_id: t.id } });
}
