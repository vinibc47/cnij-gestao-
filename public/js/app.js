// =====================================================================
// Shell do aplicativo: autenticação, roteamento, layout, pesquisa global,
// notificações, ações rápidas (+) e navegação mobile.
// =====================================================================
import { S, api, html, el, $, $$, icon, toHTML, avatar, toast, fail, menu, debounce, can, datetime, esc, openForm, invalidateRefs } from './lib.js';

const NAV = [
  ['dashboard', '', 'Dashboard', 'dashboard'],
  ['financeiro', 'financeiro', 'Financeiro', 'wallet'],
  ['projetos', 'projetos', 'Projetos', 'folder'],
  ['obras', 'obras', 'Obras', 'helmet'],
  ['tarefas', 'tarefas', 'Tarefas', 'tasks'],
  ['clientes', 'clientes', 'Clientes', 'users'],
  ['propostas', 'propostas', 'Propostas', 'proposal'],
  ['contratos', 'contratos', 'Contratos', 'contract'],
  ['fornecedores', 'fornecedores', 'Fornecedores', 'truck'],
  ['agenda', 'agenda', 'Agenda', 'calendar'],
  ['documentos', 'documentos', 'Documentos', 'docs'],
  ['relatorios', 'relatorios', 'Relatórios', 'chart'],
  ['configuracoes', 'configuracoes', 'Configurações', 'settings'],
];
const VIEWS = {
  '': () => import('./views/dashboard.js'), financeiro: () => import('./views/finance.js'), projetos: () => import('./views/projects.js'),
  obras: () => import('./views/works.js'), tarefas: () => import('./views/tasks.js'), clientes: () => import('./views/clients.js'),
  propostas: () => import('./views/commercial.js'), contratos: () => import('./views/commercial.js'), fornecedores: () => import('./views/suppliers.js'),
  agenda: () => import('./views/agenda.js'), documentos: () => import('./views/documents.js'), relatorios: () => import('./views/reports.js'),
  configuracoes: () => import('./views/settings.js'), notificacoes: () => import('./views/notifications.js'),
};
const MODULE_OF = { '': 'dashboard', notificacoes: 'dashboard' };

const root = document.getElementById('root');
let current = null;

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, q] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { base: parts[0] || '', params: parts.slice(1), query: Object.fromEntries(new URLSearchParams(q || '')) };
}
export const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
window.__go = go;

// ------------------------------ Boot ------------------------------
async function boot() {
  const { base, query } = parseHash();
  if (base === 'redefinir-senha') { const m = await import('./views/auth.js'); return m.reset(root, query.token); }
  try {
    const setup = await api.get('/setup');
    if (setup.needed) { const m = await import('./views/auth.js'); return m.setup(root, boot); }
    const me = await api.get('/auth/me');
    if (!me.user) { const m = await import('./views/auth.js'); return m.login(root, boot, me.office); }
    S.user = me.user;
    if (S.user.role === 'cliente') { const m = await import('./views/portal.js'); return m.default(root); }
    S.meta = await api.get('/meta');
    S.user = S.meta.user;
    renderShell();
    route();
    if (S.user.must_change_pw) { const m = await import('./views/auth.js'); m.changePassword(true); }
  } catch (e) { root.innerHTML = toHTML(html`<div class="empty" style="padding-top:20vh">${icon('alert')}<div>Não foi possível carregar o sistema.</div><div class="small mt-8">${e.message}</div><button class="btn mt-16" id="retry">Tentar novamente</button></div>`); const b = document.getElementById('retry'); if (b) b.onclick = () => location.reload(); }
}
window.addEventListener('auth:expired', () => { if (S.user) { S.user = null; toast('Sua sessão expirou. Entre novamente.', { error: true }); boot(); } });

// ------------------------------ Layout ------------------------------
function renderShell() {
  const nav = NAV.filter(([m]) => can(m));
  const u = S.user;
  root.innerHTML = toHTML(html`<div class="app">
    <aside class="sidebar">
      <a class="brand" href="#/" title="Início"><img class="brand-logo" src="/logo" width="1016" height="353" alt="Carla Nogueira & Irineu Junior — Arquitetura | Interiores"></a>
      <nav class="nav">${nav.map(([m, path, label, ic], i) => html`${i === 10 ? html`<div class="sep"></div>` : ''}<a href="#/${path}" data-nav="${path}" title="${label}">${icon(ic)}<span class="lbl">${label}</span><span class="count hidden" data-count="${path}"></span></a>`)}</nav>
      <div class="side-user">${avatar(u)}<div class="who"><b class="ellipsis">${u.name}</b><span class="small muted">${({ admin: 'Administrador', gestor: 'Gestor', colaborador: 'Colaborador', estagiario: 'Estagiário' })[u.role]}</span></div>
        <button class="icon-btn" data-user title="Minha conta">${icon('more')}</button></div>
    </aside>
    <div class="main">
      <header class="topbar">
        <a class="m-brand mobile-only" href="#/"><img class="brand-logo" src="/logo" width="1016" height="353" alt="Carla Nogueira & Irineu Junior"></a>
        <div class="search">${icon('search')}<input id="gsearch" placeholder="Pesquisar clientes, projetos, fornecedores, tarefas…" autocomplete="off"><kbd>/</kbd><div class="search-results hidden"></div></div>
        <div class="top-actions">
          <button class="icon-btn" data-notif title="Notificações">${icon('bell')}<span class="dot hidden"></span></button>
          <button class="fab desktop-only" data-quick title="Ações rápidas">${icon('plus')}</button>
          <button class="icon-btn mobile-only" data-user>${avatar(u, 'sm')}</button>
        </div>
      </header>
      <main class="content" id="view"></main>
    </div>
    <nav class="mobile-nav">
      <a href="#/" data-mnav="">${icon('home')}Hoje</a>
      <a href="#/tarefas" data-mnav="tarefas">${icon('tasks')}Tarefas</a>
      <button data-quick><span class="plus">${icon('plus')}</span></button>
      <a href="#/agenda" data-mnav="agenda">${icon('calendar')}Agenda</a>
      <button data-more>${icon('menu')}Menu</button>
    </nav></div>`);
  $$('[data-user]').forEach((b) => (b.onclick = () => userMenu(b)));
  $$('[data-quick]').forEach((b) => (b.onclick = () => quickMenu(b)));
  $('[data-notif]').onclick = notifPanel;
  $('[data-more]').onclick = (e) => menu(e.currentTarget, nav.map(([m, path, label, ic]) => ({ label, icon: ic, fn: () => go('#/' + path) })));
  setupSearch();
  refreshBadges();
  setInterval(refreshBadges, 120000);
}

export async function refreshBadges() {
  try {
    const n = await api.get('/notifications?unread=1');
    const dot = $('[data-notif] .dot');
    if (dot) { dot.textContent = n.unread > 99 ? '99+' : n.unread; dot.classList.toggle('hidden', !n.unread); }
    const d = await api.get('/dashboard');
    const set = (k, v, soft) => { const c = $(`[data-count="${k}"]`); if (c) { c.textContent = v; c.classList.toggle('hidden', !v); c.classList.toggle('soft', !!soft); } };
    set('tarefas', d.counts.tasks_late, true);
    if (d.finance) set('financeiro', d.finance.overdue_in.count + d.finance.overdue_out.count + (d.finance.reminders || 0), true);
    set('contratos', d.counts.contracts_waiting);
    set('propostas', d.counts.proposals_waiting);
  } catch { /* silencioso */ }
}

function userMenu(anchor) {
  menu(anchor, [
    { header: S.user.email },
    { label: 'Alterar senha', icon: 'lock', fn: async () => (await import('./views/auth.js')).changePassword() },
    S.user.modules.includes('configuracoes') ? { label: 'Configurações', icon: 'settings', fn: () => go('#/configuracoes') } : null,
    { label: 'Notificações', icon: 'bell', fn: () => go('#/notificacoes') },
    '-',
    { label: 'Sair', icon: 'logout', danger: true, fn: async () => { await api.post('/auth/logout'); location.hash = ''; location.reload(); } },
  ]);
}

// ------------------------------ Ações rápidas ------------------------------
export function quickMenu(anchor) {
  const items = [];
  const R = S.meta.resources;
  if (R.projects && R.projects.canCreate) items.push({ label: 'Novo projeto', icon: 'folder', fn: () => openForm('projects', { onSaved: (p) => go('#/projetos/' + p.id) }) });
  if (R.clients) items.push({ label: 'Novo cliente', icon: 'users', fn: () => openForm('clients', { onSaved: (c) => go('#/clientes/' + c.id) }) });
  if (R.tasks) items.push({ label: 'Nova tarefa', icon: 'tasks', fn: () => openForm('tasks', { onSaved: rerender }) });
  if (R.incomes) items.push({ label: 'Nova receita', icon: 'in', fn: async () => (await import('./views/finance.js')).newEntry('incomes', {}, rerender) });
  if (R.expenses) items.push({ label: 'Nova despesa', icon: 'out', fn: async () => (await import('./views/finance.js')).newEntry('expenses', {}, rerender) });
  if (R.events) items.push({ label: 'Nova reunião', icon: 'calendar', fn: () => openForm('events', { values: { type: 'reuniao' }, onSaved: rerender }) });
  if (R.proposals) items.push({ label: 'Nova proposta (orçamento de obra)', icon: 'proposal', fn: () => go('#/propostas?nova=1') });
  if (R.work_logs) items.push({ label: 'Registro no diário de obra', icon: 'diary', fn: () => openForm('work_logs', { onSaved: rerender }) });
  if (R.time_entries) items.push({ label: 'Lançar horas', icon: 'clock', fn: () => openForm('time_entries', { onSaved: rerender }) });
  menu(anchor, [{ header: 'Ações rápidas' }, ...items]);
}

// ------------------------------ Pesquisa global ------------------------------
function setupSearch() {
  const inp = $('#gsearch'); const box = $('.search-results');
  let results = []; let sel = -1;
  const render = () => {
    if (!inp.value.trim()) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = toHTML(results.length ? results.map((r, i) => html`<a href="${r.link}" class="${i === sel ? 'sel' : ''}"><span class="type">${r.type}</span><span class="grow" style="min-width:0"><div class="li-title">${r.title}${r.archived ? html` <span class="badge muted plain">arquivado</span>` : ''}</div><div class="li-sub">${r.sub || ''}</div></span></a>`)
      : html`<div class="empty sm">Nada encontrado para “${inp.value}”.</div>`);
  };
  const search = debounce(async () => {
    const q = inp.value.trim(); if (q.length < 2) { results = []; render(); return; }
    try { results = (await api.get('/search?q=' + encodeURIComponent(q))).results; sel = -1; render(); } catch (e) { fail(e); }
  }, 220);
  inp.oninput = search;
  inp.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(results.length - 1, sel + 1); render(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    if (e.key === 'Enter' && results[Math.max(0, sel)]) { go(results[Math.max(0, sel)].link); inp.value = ''; render(); inp.blur(); }
    if (e.key === 'Escape') { inp.value = ''; render(); inp.blur(); }
  };
  box.onclick = () => { inp.value = ''; setTimeout(render, 10); };
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) box.classList.add('hidden'); });
  inp.onfocus = () => inp.value && render();
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); inp.focus(); } });
}

// ------------------------------ Notificações ------------------------------
async function notifPanel() {
  const ex = $('.pop-panel'); if (ex) return ex.remove();
  const p = el(html`<div class="pop-panel"><div class="ph-head"><b>Notificações</b><div class="row gap-8"><button class="btn xs" data-all>Marcar todas como lidas</button><a class="btn xs" href="#/notificacoes">Ver todas</a></div></div><div data-list><div class="empty sm">Carregando…</div></div></div>`);
  document.body.appendChild(p);
  setTimeout(() => document.addEventListener('click', function h(e) { if (!p.contains(e.target) && !e.target.closest('[data-notif]')) { p.remove(); document.removeEventListener('click', h); } }), 0);
  const { rows } = await api.get('/notifications');
  const listEl = p.querySelector('[data-list]');
  listEl.innerHTML = toHTML(rows.length ? rows.slice(0, 30).map((n) => html`<a class="notif ${n.read_at ? '' : 'unread'}" href="${n.link || '#/notificacoes'}" data-id="${n.id}"><span class="sev ${n.severity}"></span><div class="grow"><div class="li-title" style="white-space:normal">${n.title}</div>${n.body ? html`<div class="li-sub" style="white-space:normal">${n.body}</div>` : ''}<div class="tiny muted-2 mt-8">${datetime(n.created_at)}</div></div></a>`) : html`<div class="empty sm">Nenhuma notificação.</div>`);
  listEl.onclick = (e) => { const a = e.target.closest('[data-id]'); if (a) { api.post('/notifications/read', { ids: [+a.dataset.id] }).then(refreshBadges); p.remove(); } };
  p.querySelector('[data-all]').onclick = async () => { await api.post('/notifications/read', {}); p.remove(); refreshBadges(); };
}

// ------------------------------ Roteador ------------------------------
export function rerender() { invalidateRefs(); route(true); }
async function route(keepScroll) {
  if (!S.meta) return;
  const { base, params, query } = parseHash();
  $$('.menu, .pop-panel').forEach((m) => m.remove());
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === base));
  $$('[data-mnav]').forEach((a) => a.classList.toggle('active', a.dataset.mnav === base));
  const view = $('#view'); if (!view) return;
  const loader = VIEWS[base];
  const mod = MODULE_OF[base] || base;
  if (!loader || (!can(mod) && !['notificacoes'].includes(base))) { view.innerHTML = toHTML(html`<div class="empty" style="padding-top:12vh">${icon('lock')}<div>Página não encontrada ou sem permissão.</div><a class="btn mt-16" href="#/">Voltar ao início</a></div>`); return; }
  const y = window.scrollY;
  const token = (current = {});
  try {
    const m = await loader();
    if (token !== current) return;
    view.innerHTML = '';
    await m.default({ root: view, base, params, query, rerender, go });
    if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
  } catch (e) { console.error(e); view.innerHTML = toHTML(html`<div class="empty">${icon('alert')}<div>${e.message}</div></div>`); }
}
window.addEventListener('hashchange', () => route());
boot();
