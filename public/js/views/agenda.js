import { S, api, html, el, toHTML, icon, money, date, time, badge, label, tone, openForm, list, today, drawer, toast, deleteRow, MONTHS_FULL, WEEKDAYS, $$ } from '../lib.js';
import { monthGrid, monthTitle, shiftMonth } from './common.js';
import { taskDrawer } from './tasks.js';
import { entryDrawer } from './finance.js';

export default async function (ctx) {
  const root = ctx.root;
  let month = (ctx.query.data || today()).slice(0, 7);
  let selected = ctx.query.data || today();
  const layers = { eventos: true, tarefas: true, entregas: true, financeiro: !!S.user.finance };
  root.innerHTML = toHTML(html`<div class="page-head"><div><h1>Agenda</h1><div class="sub">Reuniões, visitas técnicas, apresentações, entregas, vencimentos e compromissos</div></div>
    <button class="btn primary" data-new>${icon('plus')} Novo compromisso</button></div>
    <div class="toolbar"><button class="btn sm" data-pm>‹</button><b class="serif" style="font-size:24px;min-width:200px;text-align:center" data-title></b><button class="btn sm" data-nm>›</button><button class="btn sm" data-today>Hoje</button><span class="grow"></span>
      <div class="chips" data-layers>${[['eventos', 'Compromissos'], ['tarefas', 'Prazos de tarefas'], ['entregas', 'Entregas de projeto'], S.user.finance ? ['financeiro', 'Vencimentos financeiros'] : null].filter(Boolean).map(([k, l]) => html`<button class="chip ${layers[k] ? 'on' : ''}" data-l="${k}">${l}</button>`)}</div></div>
    <div class="grid g3"><div class="span2" data-cal></div><div class="card" data-day></div></div>`);
  let items = [];
  const load = async () => {
    const [y, m] = month.split('-').map(Number);
    const from = `${month}-01`; const to = `${month}-${new Date(y, m, 0).getDate()}`;
    const from2 = new Date(y, m - 1, 1); from2.setDate(1 - from2.getDay()); const fromG = from2.toISOString().slice(0, 10);
    const toG = new Date(y, m, 14).toISOString().slice(0, 10);
    const reqs = [list('events', { from: fromG, to: toG, limit: 1000 }), list('tasks', { date_field: 'due_date', from: fromG, to: toG, limit: 1000, preset: 'abertas' }), list('project_phases', { date_field: 'due_date', from: fromG, to: toG, limit: 1000 })];
    if (S.user.finance) reqs.push(list('incomes', { from: fromG, to: toG, limit: 1000, preset: 'abertas' }), list('expenses', { from: fromG, to: toG, limit: 1000, preset: 'abertas' }));
    const [ev, tk, ph, inc, exp] = await Promise.all(reqs);
    items = [
      ...ev.rows.map((e) => ({ layer: 'eventos', date: e.start_at.slice(0, 10), id: 'e' + e.id, label: `${e.all_day ? '' : time(e.start_at) + ' '}${e.title}`, title: e.title, cls: tone('EVENT_TYPES', e.type) + (e.status === 'cancelado' ? ' done' : ''), row: e, kind: 'event' })),
      ...tk.rows.map((t) => ({ layer: 'tarefas', date: t.due_date, id: 't' + t.id, label: t.title, title: t.title, cls: 'task', row: t, kind: 'task' })),
      ...ph.rows.filter((p) => !['concluido', 'aprovado'].includes(p.status)).map((p) => ({ layer: 'entregas', date: p.due_date, id: 'p' + p.id, label: `Entrega: ${p.name}`, title: `${p.name} — ${p.project_name}`, cls: 'warning', row: p, kind: 'phase' })),
      ...(inc ? inc.rows.map((i) => ({ layer: 'financeiro', date: i.due_date, id: 'i' + i.id, label: `+ ${money(i.amount)}`, title: i.description, cls: 'success', row: i, kind: 'income' })) : []),
      ...(exp ? exp.rows.map((i) => ({ layer: 'financeiro', date: i.due_date, id: 'x' + i.id, label: `− ${money(i.amount)} ${i.description}`, title: i.description, cls: 'danger', row: i, kind: 'expense' })) : []),
    ];
    draw();
  };
  const visible = () => items.filter((i) => layers[i.layer]);
  const draw = () => {
    root.querySelector('[data-title]').textContent = monthTitle(month);
    const cal = root.querySelector('[data-cal]'); cal.innerHTML = '';
    cal.appendChild(monthGrid({ month, selected, itemsFor: (d) => visible().filter((i) => i.date === d), onDay: (d, id) => { selected = d; if (id) open(items.find((i) => i.id === id)); draw(); } }));
    drawDay();
  };
  const drawDay = () => {
    const day = visible().filter((i) => i.date === selected).sort((a, b) => (a.row.start_at || '').localeCompare(b.row.start_at || ''));
    const [y, m, dd] = selected.split('-').map(Number); const dt = new Date(y, m - 1, dd);
    const box = root.querySelector('[data-day]');
    box.innerHTML = toHTML(html`<div class="card-head"><div><div class="eyebrow">${WEEKDAYS[dt.getDay()]}</div><h3 class="serif" style="font-size:26px">${dd} de ${MONTHS_FULL[m - 1].toLowerCase()}</h3></div><button class="btn sm" data-add>${icon('plus', 'sm')}</button></div>
      ${day.length ? html`<div class="list">${day.map((i) => html`<div class="list-item" data-open="${i.id}" style="cursor:pointer"><span class="sev ${i.cls.split(' ')[0] === 'task' ? '' : i.cls.split(' ')[0]}"></span><div class="grow" style="min-width:0"><div class="li-title">${i.kind === 'event' ? i.row.title : i.title}</div>
        <div class="li-sub">${i.kind === 'event' ? `${i.row.all_day ? 'Dia inteiro' : time(i.row.start_at) + (i.row.end_at ? '–' + time(i.row.end_at) : '')} · ${label('EVENT_TYPES', i.row.type)}${i.row.location ? ' · ' + i.row.location : ''}` : i.kind === 'task' ? `Prazo de tarefa · ${i.row.assignee_name || ''}` : i.kind === 'phase' ? 'Entrega de etapa' : i.kind === 'income' ? `Recebimento · ${money(i.row.amount)}` : `Pagamento · ${money(i.row.amount)}`}</div></div></div>`)}</div>` : html`<div class="empty sm">Nada agendado para este dia.</div>`}`);
    box.querySelector('[data-add]').onclick = () => openForm('events', { values: { start_at: `${selected}T09:00`, end_at: `${selected}T10:00` }, onSaved: load });
    box.onclick = (e) => { const a = e.target.closest('[data-open]'); if (a) { e.preventDefault(); open(items.find((i) => i.id === a.dataset.open)); } };
  };
  const open = (it) => {
    if (!it) return;
    if (it.kind === 'event') return eventDrawer(it.row, load);
    if (it.kind === 'task') return taskDrawer(it.row.id, load);
    if (it.kind === 'phase') return ctx.go('#/projetos/' + it.row.project_id + '?tab=etapas');
    if (it.kind === 'income') return entryDrawer('incomes', it.row.id, load);
    if (it.kind === 'expense') return entryDrawer('expenses', it.row.id, load);
  };
  root.querySelector('[data-pm]').onclick = () => { month = shiftMonth(month, -1); load(); };
  root.querySelector('[data-nm]').onclick = () => { month = shiftMonth(month, 1); load(); };
  root.querySelector('[data-today]').onclick = () => { month = today().slice(0, 7); selected = today(); load(); };
  root.querySelector('[data-new]').onclick = () => openForm('events', { values: { start_at: `${selected}T09:00`, end_at: `${selected}T10:00` }, onSaved: load });
  root.querySelector('[data-layers]').onclick = (e) => { const b = e.target.closest('[data-l]'); if (!b) return; layers[b.dataset.l] = !layers[b.dataset.l]; b.classList.toggle('on'); draw(); };
  await load();
}

export function eventDrawer(e, onChange) {
  const body = el(html`<div><div class="row wrap gap-8 mb-16">${badge('EVENT_TYPES', e.type)}${badge('EVENT_STATUS', e.status)}</div>
    <dl class="kv"><dt>Quando</dt><dd>${e.all_day ? date(e.start_at) + ' · dia inteiro' : `${date(e.start_at)} ${time(e.start_at)}${e.end_at ? ' – ' + time(e.end_at) : ''}`}</dd>
      <dt>Local</dt><dd>${e.location || '—'}</dd><dt>Cliente</dt><dd>${e.client_name ? html`<a href="#/clientes/${e.client_id}">${e.client_name}</a>` : '—'}</dd>
      <dt>Projeto</dt><dd>${e.project_name ? html`<a href="#/projetos/${e.project_id}">${e.project_name}</a>` : '—'}</dd><dt>Participantes</dt><dd>${e.attendees || '—'}</dd>
      ${e.notes ? html`<dt>Pauta</dt><dd class="notes">${e.notes}</dd>` : ''}${e.minutes ? html`<dt>Ata</dt><dd class="notes">${e.minutes}</dd>` : ''}</dl></div>`);
  const d = drawer({ title: e.title, sub: 'Agenda', body });
  d.foot.classList.remove('hidden');
  d.foot.innerHTML = toHTML(html`<button class="btn danger" data-del>${icon('trash')}</button><span class="grow"></span>${e.status === 'agendado' ? html`<button class="btn" data-done>${icon('check')} Marcar como realizado</button>` : ''}<button class="btn primary" data-edit>${icon('edit')} Editar / registrar ata</button>`);
  d.foot.querySelector('[data-edit]').onclick = () => { d.close(); openForm('events', { id: e.id, onSaved: onChange }); };
  d.foot.querySelector('[data-del]').onclick = async () => { if (await deleteRow('events', e, e.title)) { d.close(); onChange(); } };
  const dn = d.foot.querySelector('[data-done]'); if (dn) dn.onclick = async () => { await api.put(`/r/events/${e.id}`, { status: 'realizado' }); toast('Registrado como realizado — incluído no histórico do cliente.'); d.close(); onChange(); };
}
