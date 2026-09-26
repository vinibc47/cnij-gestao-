// Componentes compartilhados entre os módulos: página de listagem padrão
// (busca, filtros rápidos, filtros por campo, ordenação, exportação) e
// ações padrão de registro (editar, duplicar, arquivar, excluir).
import { S, api, html, el, toHTML, icon, list, table, exportCSV, openForm, duplicateRow, archiveRow, deleteRow, debounce, fail, label, L, refOptions, $, $$ } from '../lib.js';

export function rowActions(resKey, row, { onChange, edit = true, editOpts = {}, extra = [], title } = {}) {
  const meta = S.meta.resources[resKey];
  const name = title || row[meta.title] || row.description || row.name;
  return [
    ...extra,
    edit ? { label: 'Editar', icon: 'edit', fn: () => openForm(resKey, { id: row.id, onSaved: onChange, ...editOpts }) } : null,
    meta.canCreate ? { label: 'Duplicar', icon: 'copy', fn: async () => { try { await duplicateRow(resKey, row); onChange && onChange(); } catch (e) { fail(e); } } } : null,
    meta.archivable ? { label: row.archived ? 'Restaurar' : 'Arquivar', icon: 'archive', fn: async () => { try { await archiveRow(resKey, row, row.archived ? 0 : 1); onChange && onChange(); } catch (e) { fail(e); } } } : null,
    '-',
    { label: 'Excluir', icon: 'trash', danger: true, fn: async () => { try { if (await deleteRow(resKey, row, name)) onChange && onChange(); } catch (e) { fail(e); } } },
  ];
}

// Página de listagem padrão
export async function listPage({ root, res, title, sub, crumbs, presets = [], columns, filters = [], onRow, actions, headActions, query = {}, csvName, totals, newLabel, onNew, render, afterRender, beforeTable, modes, archived = true }) {
  const meta = S.meta.resources[res];
  const state = { q: query.q || '', preset: query.preset ?? (presets[0] ? presets[0].key : ''), sort: null, filters: {}, archived: '0', mode: modes ? (query.mode || modes[0].key) : null };
  filters.forEach((f) => { if (query['f_' + f]) state.filters[f] = query['f_' + f]; });
  if (query.from) state.from = query.from; if (query.to) state.to = query.to;
  root.innerHTML = toHTML(html`
    <div class="page-head"><div>${crumbs ? html`<div class="crumbs">${crumbs}</div>` : ''}<h1>${title}</h1>${sub ? html`<div class="sub">${sub}</div>` : ''}</div>
      <div class="row wrap">${headActions || ''}${meta.canCreate !== false && (onNew !== false) ? html`<button class="btn primary" data-new>${icon('plus')} ${newLabel || 'Novo(a) ' + meta.singular.toLowerCase()}</button>` : ''}</div></div>
    ${presets.length ? html`<div class="chips mb-16" data-presets>${presets.map((p) => html`<button class="chip ${p.key === state.preset ? 'on' : ''}" data-p="${p.key}">${p.label}<span class="n" data-pc="${p.key}"></span></button>`)}</div>` : ''}
    <div class="toolbar">
      <div class="search-sm">${icon('search')}<input placeholder="Pesquisar…" value="${state.q}" data-q></div>
      <span data-filters class="row wrap gap-8"></span>
      ${meta.dateField ? html`<input type="date" data-from value="${state.from || ''}" title="De"><input type="date" data-to value="${state.to || ''}" title="Até">` : ''}
      ${meta.archivable && archived ? html`<select data-arch><option value="0">Ativos</option><option value="1">Arquivados</option><option value="all">Todos</option></select>` : ''}
      <span class="grow"></span>
      ${modes ? html`<div class="btn-group" data-modes>${modes.map((m) => html`<button class="${m.key === state.mode ? 'on' : ''}" data-m="${m.key}" title="${m.label}">${icon(m.icon, 'sm')}<span class="desktop-only">${m.label}</span></button>`)}</div>` : ''}
      <button class="btn" data-csv title="Exportar CSV">${icon('download')}<span class="desktop-only">Exportar</span></button>
    </div>
    ${beforeTable ? html`<div data-before></div>` : ''}
    <div data-table><div class="empty sm">Carregando…</div></div>
    <div class="table-foot" data-foot></div>`);
  const fbox = root.querySelector('[data-filters]');
  for (const fname of filters) {
    const f = meta.fields.find((x) => x.name === fname); if (!f) continue;
    let opts = [];
    if (f.type === 'select') opts = L(f.list).map((o) => [o.value, o.label]);
    else if (f.type === 'option') opts = (S.meta.options[f.opt] || []).map((o) => [o, o]);
    else if (f.type === 'ref') opts = (await refOptions(f.ref)).map((o) => [o.id, o.label]);
    const s = el(html`<select data-f="${fname}" style="max-width:190px"><option value="">${f.label}: todos</option>${opts.map(([v, l]) => html`<option value="${v}" ${String(state.filters[fname] || '') === String(v) ? 'selected' : ''}>${l}</option>`)}</select>`);
    fbox.appendChild(s);
  }
  let rows = [];
  const load = async () => {
    const params = { q: state.q, preset: state.preset, archived: state.archived, from: state.from, to: state.to, limit: 1000 };
    if (state.sort) { params.sort = state.sort.key; params.dir = state.sort.dir; }
    Object.entries(state.filters).forEach(([k, v]) => { if (v) params['f_' + k] = v; });
    try {
      const d = await list(res, params); rows = d.rows;
      const box = root.querySelector('[data-table]'); box.innerHTML = '';
      const r = render ? render(rows, state, load) : null;
      if (r) box.appendChild(r instanceof Node ? r : el(toHTML(r)));
      else box.appendChild(table({ columns, rows, onRow, actions: actions ? (r) => actions(r, load) : null, sort: state.sort, onSort: (s) => { state.sort = s; load(); } }));
      root.querySelector('[data-foot]').innerHTML = toHTML(html`<span>${d.total} registro(s)</span><span>${totals ? totals(rows) : ''}</span>`);
      if (afterRender) afterRender(rows, state, load);
    } catch (e) { fail(e); }
  };
  root.querySelector('[data-q]').oninput = debounce((e) => { state.q = e.target.value; load(); }, 250);
  on_(root, '[data-presets]', 'click', (e) => { const b = e.target.closest('[data-p]'); if (!b) return; state.preset = b.dataset.p; $$('[data-p]', root).forEach((x) => x.classList.toggle('on', x === b)); load(); });
  on_(root, '[data-modes]', 'click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; state.mode = b.dataset.m; $$('[data-m]', root).forEach((x) => x.classList.toggle('on', x === b)); load(); });
  fbox.onchange = (e) => { const s = e.target.closest('[data-f]'); if (!s) return; state.filters[s.dataset.f] = s.value; load(); };
  const fr = root.querySelector('[data-from]'); if (fr) fr.onchange = (e) => { state.from = e.target.value; load(); };
  const to = root.querySelector('[data-to]'); if (to) to.onchange = (e) => { state.to = e.target.value; load(); };
  const ar = root.querySelector('[data-arch]'); if (ar) ar.onchange = (e) => { state.archived = e.target.value; load(); };
  const nb = root.querySelector('[data-new]'); if (nb) nb.onclick = () => (onNew ? onNew(load) : openForm(res, { onSaved: load }));
  root.querySelector('[data-csv]').onclick = () => exportCSV(`${csvName || res}-${new Date().toISOString().slice(0, 10)}`, (columns || []).filter((c) => c.csv !== false).map((c) => ({ ...c, csv: typeof c.csv === 'function' ? c.csv : undefined })), rows);
  await load();
  return { load, state, get rows() { return rows; } };
}
function on_(root, sel, ev, fn) { const n = root.querySelector(sel); if (n) n.addEventListener(ev, fn); }

export const tabsBar = (tabs, active, base) => html`<div class="tabs">${tabs.filter(Boolean).map((t) => html`<a href="${base}${t.key ? (base.includes('?') ? '&' : '?') + 'tab=' + t.key : ''}" class="${t.key === active ? 'on' : ''}">${t.label}${t.n ? html`<span class="n">${t.n}</span>` : ''}</a>`)}</div>`;

// Calendário mensal reutilizável (agenda e tarefas)
import { WEEKDAYS, MONTHS_FULL, ymd } from '../lib.js';
export function monthGrid({ month, itemsFor, onDay, selected }) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1); const start = new Date(first); start.setDate(1 - first.getDay());
  const t = ymd(new Date());
  const days = []; for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
  const g = el(html`<div class="cal"><div class="cal-head">${WEEKDAYS.map((w) => html`<div>${w}</div>`)}</div><div class="cal-grid">${days.map((d) => {
    const ds = ymd(d); const items = itemsFor(ds) || [];
    return html`<div class="cal-day ${d.getMonth() !== m - 1 ? 'out' : ''} ${ds === t ? 'today' : ''} ${ds === selected ? 'sel' : ''}" data-d="${ds}"><span class="dn">${d.getDate()}</span>
      ${items.slice(0, 4).map((it) => html`<div class="ev ${it.cls || ''}" data-item="${it.id || ''}" title="${it.title}">${it.label}</div>`)}${items.length > 4 ? html`<div class="more-ev">+${items.length - 4}</div>` : ''}</div>`;
  })}</div></div>`);
  g.onclick = (e) => { const it = e.target.closest('[data-item]'); const day = e.target.closest('[data-d]'); if (day && onDay) onDay(day.dataset.d, it ? it.dataset.item : null); };
  return g;
}
export const monthTitle = (month) => { const [y, m] = month.split('-').map(Number); return `${MONTHS_FULL[m - 1]} ${y}`; };
export const shiftMonth = (month, n) => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
