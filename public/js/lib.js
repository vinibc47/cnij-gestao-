// =====================================================================
// Biblioteca base do frontend: API, formatação, componentes de interface
// (drawer, modal, menu, toast), formulários dinâmicos, tabelas e anexos.
// =====================================================================
export const S = { meta: null, user: null, refs: {} };

// ------------------------------ API ------------------------------
export async function api(path, { method = 'GET', body, raw } = {}) {
  const opt = { method, headers: { 'X-Requested-With': 'cnij' }, credentials: 'same-origin' };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch('/api' + path, opt); }
  catch { throw Object.assign(new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.'), { status: 0 }); }
  if (raw) return r;
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  if (!r.ok) {
    if (r.status === 401 && !path.startsWith('/auth')) { window.dispatchEvent(new CustomEvent('auth:expired')); }
    const byStatus = { 413: `Arquivo grande demais para o servidor (limite de ${(S.meta && S.meta.max_upload_mb) || 200} MB por arquivo).`, 502: 'O servidor está reiniciando ou não respondeu. Aguarde alguns segundos e tente de novo.', 503: 'O servidor está ocupado ou reiniciando. Tente de novo em instantes.', 504: 'O servidor demorou demais para responder. Tente de novo.' };
    const e = new Error((data && data.error) || byStatus[r.status] || `Falha na comunicação com o servidor (erro ${r.status}).`); e.status = r.status; e.data = data; throw e;
  }
  return data;
}
api.get = (p) => api(p);
api.post = (p, b = {}) => api(p, { method: 'POST', body: b });
api.put = (p, b = {}) => api(p, { method: 'PUT', body: b });
api.del = (p) => api(p, { method: 'DELETE' });
export const qs = (o) => { const p = new URLSearchParams(); Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); }); const s = p.toString(); return s ? '?' + s : ''; };
export const list = (res, params) => api.get(`/r/${res}${qs(params)}`);

// ------------------------------ HTML seguro ------------------------------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => (s === null || s === undefined ? '' : String(s).replace(/[&<>"']/g, (c) => ESC[c]));
export const raw = (s) => ({ __raw: String(s ?? '') });
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += val2html(vals[i]);
  });
  return raw(out);
}
function val2html(v) {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(val2html).join('');
  if (typeof v === 'object' && '__raw' in v) return v.__raw;
  return esc(v);
}
export const toHTML = (v) => val2html(v);
// `el` aceita marcação confiável (string literal do código) ou o resultado de html``
export function el(markup) { const t = document.createElement('template'); t.innerHTML = (typeof markup === 'string' ? markup : toHTML(markup)).trim(); return t.content.firstElementChild; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export function on(root, event, selector, fn) { root.addEventListener(event, (e) => { const t = e.target.closest(selector); if (t && root.contains(t)) fn(e, t); }); }

// ------------------------------ Formatação ------------------------------
const nf = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (n) => (n === null || n === undefined || n === '' ? '—' : nf.format(Number(n) || 0));
export const moneyShort = (n) => { n = Number(n) || 0; const a = Math.abs(n); if (a >= 1e6) return 'R$ ' + (n / 1e6).toFixed(1).replace('.', ',') + ' mi'; if (a >= 1e3) return 'R$ ' + (n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace('.', ',') + ' mil'; return 'R$ ' + n.toFixed(0); };
export const num = (n, d = 0) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const pct = (n) => (n === null || n === undefined ? '—' : `${num(n, Number(n) % 1 ? 1 : 0)}%`);
export const date = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
export const dateShort = (d) => (d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) : '—');
export const time = (d) => (d && String(d).length > 10 ? String(d).slice(11, 16) : '');
export const datetime = (d) => (d ? `${date(d)}${time(d) ? ' ' + time(d) : ''}` : '—');
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const MONTHS_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const monthLabel = (ym, full) => { const [y, m] = ym.split('-'); return full ? `${MONTHS_FULL[+m - 1]} ${y}` : `${MONTHS[+m - 1]}/${y.slice(2)}`; };
export const monShort = (d) => MONTHS[+String(d).slice(5, 7) - 1];
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
export const daysFrom = (s) => { if (!s) return null; const [y, m, d] = s.slice(0, 10).split('-').map(Number); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(y, m - 1, d) - t) / 86400000); };
export function relDay(s) {
  const n = daysFrom(s); if (n === null) return '';
  if (n === 0) return 'hoje'; if (n === 1) return 'amanhã'; if (n === -1) return 'ontem';
  return n > 0 ? `em ${n} dias` : `há ${-n} dias`;
}
export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
export const fileExt = (n) => (String(n || '').split('.').pop() || '').slice(0, 4);
export const bytes = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((b || 0) / 1024)) + ' KB');
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ------------------------------ Listas / status ------------------------------
export const L = (key) => (S.meta.lists[key] || []);
export const label = (key, v) => (L(key).find((x) => x.value === v) || {}).label || v || '—';
export const tone = (key, v) => (L(key).find((x) => x.value === v) || {}).tone || 'neutral';
export const badge = (key, v, extra = '') => html`<span class="badge ${tone(key, v)} ${extra}">${label(key, v)}</span>`;
export const user = (id) => S.meta.users.find((u) => u.id === id);
export const avatar = (u, cls = '') => (u ? html`<span class="avatar ${cls}" style="background:${u.color || '#111'}" title="${u.name}">${initials(u.name)}</span>` : '');
export const prio = (p) => html`<span class="prio ${p}"><i></i>${label('TASK_PRIORITY', p)}</span>`;
export const progress = (v, cls = '') => html`<div class="pcell"><div class="progress ${cls}"><span style="width:${Math.max(0, Math.min(100, v || 0))}%"></span></div><span class="n">${Math.round(v || 0)}%</span></div>`;
export const can = (m) => S.user && S.user.modules.includes(m);
export const isManager = () => S.user && ['admin', 'gestor'].includes(S.user.role);
export const isAdmin = () => S.user && S.user.role === 'admin';

// ------------------------------ Ícones ------------------------------
const I = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  wallet: '<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><path d="M16 14h.01"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  helmet: '<path d="M4 17h16"/><path d="M5 17a7 7 0 0 1 14 0"/><path d="M10 10V6.5a2 2 0 0 1 4 0V10"/><path d="M3 17v2h18v-2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  tasks: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  proposal: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
  contract: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="m8 17 2-2 2 2 4-4"/>',
  truck: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  docs: '<path d="M15 3H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7z"/><path d="M15 3v4h4"/><path d="M4 7v12a2 2 0 0 0 2 2h9"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>', chevronL: '<path d="m15 18-6-6 6-6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  kanban: '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  clip: '<path d="m21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  in: '<path d="M12 5v14M19 12l-7 7-7-7"/>', out: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  repeat: '<path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  flow: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  sign: '<rect x="3" y="3" width="18" height="12" rx="1.5"/><path d="M8 15v6M16 15v6M7 8h6M7 11h10"/>',
  diary: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/><path d="M9 7h7M9 11h5"/>',
};
export const icon = (name, cls = '') => raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[name] || I.more}</svg>`);

// ------------------------------ Toast ------------------------------
export function toast(msg, opts = {}) {
  let box = $('.toasts'); if (!box) { box = el('<div class="toasts"></div>'); document.body.appendChild(box); }
  const t = el(html`<div class="toast ${opts.error ? 'error' : ''}">${msg}${opts.action ? html`<button>${opts.action.label}</button>` : ''}</div>`);
  if (opts.action) t.querySelector('button').onclick = () => { opts.action.fn(); t.remove(); };
  box.appendChild(t);
  setTimeout(() => t.remove(), opts.ms || (opts.error ? 5000 : 3000));
}
export const fail = (e) => toast(e.message || String(e), { error: true });

// ------------------------------ Overlay / drawer / modal ------------------------------
const stack = [];
function overlay(onClick) { const o = el('<div class="overlay"></div>'); o.onclick = onClick; document.body.appendChild(o); requestAnimationFrame(() => o.classList.add('show')); return o; }
export function drawer({ title, sub, body, foot, wide, onClose, head }) {
  const d = el(html`<aside class="drawer ${wide ? 'wide' : ''}" role="dialog">
    <div class="drawer-head"><div class="grow">${sub ? html`<div class="eyebrow mb-8">${sub}</div>` : ''}<h2>${title || ''}</h2>${head || ''}</div>
      <button class="icon-btn" data-close>${icon('x')}</button></div>
    <div class="drawer-body"></div>${foot !== false ? html`<div class="drawer-foot hidden"></div>` : ''}</aside>`);
  const bodyEl = d.querySelector('.drawer-body');
  if (body instanceof Node) bodyEl.appendChild(body); else if (body) bodyEl.innerHTML = toHTML(body);
  let closed = false;
  const close = () => { if (closed) return; closed = true; o.classList.remove('show'); d.classList.remove('show'); setTimeout(() => { o.remove(); d.remove(); }, 220); stack.splice(stack.indexOf(api_), 1); onClose && onClose(); };
  const o = overlay(close);
  d.querySelector('[data-close]').onclick = close;
  document.body.appendChild(d); requestAnimationFrame(() => d.classList.add('show'));
  const api_ = { el: d, body: bodyEl, foot: d.querySelector('.drawer-foot'), close, setTitle: (t) => { d.querySelector('.drawer-head h2').textContent = t; } };
  stack.push(api_);
  return api_;
}
export function modal({ title, body, actions = [], onClose }) {
  const m = el(html`<div class="modal" role="dialog"><div class="m-head"><h3>${title || ''}</h3></div><div class="m-body"></div><div class="m-foot"></div></div>`);
  const b = m.querySelector('.m-body'); if (body instanceof Node) b.appendChild(body); else b.innerHTML = toHTML(body || '');
  let closed = false;
  const close = (v) => { if (closed) return; closed = true; o.classList.remove('show'); m.classList.remove('show'); setTimeout(() => { o.remove(); m.remove(); }, 200); stack.splice(stack.indexOf(api_), 1); onClose && onClose(v); };
  const o = overlay(() => close(null)); o.style.zIndex = 102;
  m.style.zIndex = 103;
  const f = m.querySelector('.m-foot');
  actions.forEach((a) => { const btn = el(html`<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}">${a.label}</button>`); btn.onclick = async () => { if (a.fn) { btn.disabled = true; try { const r = await a.fn(m); if (r === false) { btn.disabled = false; return; } } catch (e) { fail(e); btn.disabled = false; return; } } close(a.value ?? true); }; f.appendChild(btn); });
  document.body.appendChild(m); requestAnimationFrame(() => m.classList.add('show'));
  const api_ = { el: m, body: b, close }; stack.push(api_);
  setTimeout(() => { const i = m.querySelector('input,select,textarea'); if (i) i.focus(); }, 50);
  return api_;
}
export const confirmDialog = (msg, { title = 'Confirmar', ok = 'Confirmar', danger } = {}) => new Promise((res) => {
  modal({ title, body: html`<p class="muted" style="margin:0">${msg}</p>`, actions: [{ label: 'Cancelar', value: false }, { label: ok, primary: !danger, danger, value: true }], onClose: (v) => res(!!v) });
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close(); });

export function menu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const m = el(html`<div class="menu">${items.filter(Boolean).map((it, i) => (it === '-' ? html`<hr>` : it.header ? html`<div class="mh">${it.header}</div>` : html`<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon, 'sm') : ''}${it.label}</button>`))}</div>`);
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth; const h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
  m.style.top = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
  const list_ = items.filter(Boolean);
  m.onclick = (e) => { const b = e.target.closest('button[data-i]'); if (!b) return; m.remove(); const it = list_[+b.dataset.i]; it.fn && it.fn(); };
  setTimeout(() => document.addEventListener('click', function h(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', h); } }), 0);
}

// ------------------------------ Referências (selects de relacionamento) ------------------------------
const REF = {
  clients: { res: 'clients', label: (r) => r.name, sub: (r) => r.city },
  projects: { res: 'projects', label: (r) => r.name, sub: (r) => r.client_name, params: { archived: 'all' } },
  suppliers: { res: 'suppliers', label: (r) => r.company, sub: (r) => r.category },
  works: { res: 'works', label: (r) => r.name, sub: (r) => r.client_name },
  contracts: { res: 'contracts', label: (r) => r.number, sub: (r) => r.client_name },
  proposals: { res: 'proposals', label: (r) => `${r.number} — ${r.title}`, sub: (r) => r.client_name },
  tasks: { res: 'tasks', label: (r) => r.title, sub: (r) => r.project_name, params: { preset: 'abertas' } },
  project_phases: { res: 'project_phases', label: (r) => r.name, sub: (r) => r.project_name },
};
export async function refOptions(ref, params = {}) {
  if (ref === 'users') return S.meta.users.map((u) => ({ id: u.id, label: u.name, sub: u.job_title }));
  const def = REF[ref]; if (!def || !S.meta.resources[def.res]) return [];
  const key = ref + JSON.stringify(params);
  if (!S.refs[key]) S.refs[key] = list(def.res, { limit: 1000, ...(def.params || {}), ...params }).then((d) => d.rows.map((r) => ({ id: r.id, label: def.label(r), sub: def.sub(r), row: r })));
  return S.refs[key];
}
export const invalidateRefs = (res) => { Object.keys(S.refs).forEach((k) => { if (!res || k.startsWith(res) || (res === 'projects' && k.startsWith('project'))) delete S.refs[k]; }); };

// Combo pesquisável
export function combo({ name, options, value, placeholder = 'Selecionar…', onChange, allowEmpty = true, onCreate }) {
  const wrap = el(html`<div class="combo"><input type="hidden" name="${name}"><button type="button" class="combo-btn empty">${placeholder}</button></div>`);
  const hidden = wrap.querySelector('input'); const btn = wrap.querySelector('button');
  let opts = []; let pop = null;
  const set = (v, silent) => {
    hidden.value = v ?? '';
    const o = opts.find((x) => String(x.id) === String(v));
    btn.textContent = o ? o.label : placeholder; btn.classList.toggle('empty', !o);
    if (!silent && onChange) onChange(v, o);
  };
  const close = () => { if (pop) { pop.remove(); pop = null; } };
  btn.onclick = () => {
    if (pop) return close();
    pop = el(html`<div class="combo-pop"><input class="input" placeholder="Pesquisar…"><div class="opts"></div></div>`);
    wrap.appendChild(pop);
    const inp = pop.querySelector('input'); const box = pop.querySelector('.opts');
    const render = () => {
      const q = inp.value.trim().toLowerCase();
      const f = opts.filter((o) => !q || (o.label + ' ' + (o.sub || '')).toLowerCase().includes(q)).slice(0, 200);
      box.innerHTML = toHTML(html`${allowEmpty ? html`<div class="opt" data-v=""><span class="muted">— nenhum —</span></div>` : ''}
        ${f.map((o) => html`<div class="opt ${String(o.id) === hidden.value ? 'sel' : ''}" data-v="${o.id}">${o.label}${o.sub ? html`<small>${o.sub}</small>` : ''}</div>`)}
        ${onCreate && q ? html`<div class="opt" data-create="1">${icon('plus', 'sm')} Criar “${inp.value.trim()}”</div>` : ''}`);
    };
    render(); inp.focus();
    inp.oninput = render;
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const first = box.querySelector('.opt[data-v]:not([data-v=""])'); if (first) first.click(); } };
    box.onclick = async (e) => {
      const o = e.target.closest('.opt'); if (!o) return;
      if (o.dataset.create) { const created = await onCreate(inp.value.trim()); if (created) { opts.push(created); set(created.id); } close(); return; }
      set(o.dataset.v); close();
    };
  };
  document.addEventListener('click', (e) => { if (pop && !wrap.contains(e.target)) close(); });
  const setOptions = (o) => { opts = o; set(hidden.value || value, true); };
  Promise.resolve(options).then(setOptions);
  wrap.combo = { set, setOptions, get: () => hidden.value };
  if (value) hidden.value = value;
  return wrap;
}

// ------------------------------ Formulários dinâmicos ------------------------------
export function fieldInput(f, v, ctx = {}) {
  const req = f.required ? 'required' : '';
  const name = f.name;
  const vv = v ?? '';
  switch (f.type) {
    case 'textarea': return el(html`<textarea name="${name}" ${req} rows="3" ${f.raw ? raw('data-raw') : ''}>${vv}</textarea>`);
    case 'money': return el(html`<div class="money-input"><span>R$</span><input type="number" step="0.01" name="${name}" value="${vv}" ${req} inputmode="decimal"></div>`);
    case 'number': return el(html`<input type="number" step="any" name="${name}" value="${vv}" ${req} inputmode="decimal">`);
    case 'percent': return el(html`<div class="row"><input type="range" min="0" max="100" step="5" name="${name}" value="${vv || 0}"><span class="small muted" style="width:40px">${vv || 0}%</span></div>`);
    case 'date': return el(html`<input type="date" name="${name}" value="${String(vv).slice(0, 10)}" ${req}>`);
    case 'datetime': return el(html`<input type="datetime-local" name="${name}" value="${String(vv).replace(' ', 'T').slice(0, 16)}" ${req}>`);
    case 'email': return el(html`<input type="email" name="${name}" value="${vv}" ${req}>`);
    case 'phone': return el(html`<input type="tel" name="${name}" value="${vv}" ${req} inputmode="tel">`);
    case 'bool': return el(html`<label class="toggle"><input type="checkbox" name="${name}" ${Number(vv) ? 'checked' : ''}><span class="sw"></span><span class="muted small">${Number(vv) ? 'Sim' : 'Não'}</span></label>`);
    case 'rating': {
      const w = el(html`<div class="stars"><input type="hidden" name="${name}" value="${vv || 5}">${[1, 2, 3, 4, 5].map((i) => html`<button type="button" data-v="${i}" class="${i <= (vv || 5) ? 'on' : ''}">★</button>`)}</div>`);
      w.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; w.querySelector('input').value = b.dataset.v; $$('button', w).forEach((x) => x.classList.toggle('on', +x.dataset.v <= +b.dataset.v)); };
      return w;
    }
    case 'select': return el(html`<select name="${name}" ${req}>${f.required ? '' : html`<option value="">—</option>`}${L(f.list).map((o) => html`<option value="${o.value}" ${o.value === vv ? 'selected' : ''}>${o.label}</option>`)}</select>`);
    case 'option': {
      const opts = (S.meta.options[f.opt] || []).map((n) => ({ id: n, label: n }));
      if (vv && !opts.find((o) => o.id === vv)) opts.push({ id: vv, label: vv });
      return combo({ name, options: opts, value: vv, allowEmpty: !f.required,
        onCreate: async (n) => { if (!f.free && !isManager()) { toast('Somente gestores podem criar categorias.', { error: true }); return null; } if (!f.free) { await api.post('/admin/options', { kind: f.opt, name: n }); (S.meta.options[f.opt] = S.meta.options[f.opt] || []).push(n); } return { id: n, label: n }; } });
    }
    case 'ref': {
      const params = f.dependsOn && ctx.values && ctx.values[f.dependsOn] ? { ['f_' + f.dependsOn]: ctx.values[f.dependsOn] } : {};
      const c = combo({ name, options: f.dependsOn && !params['f_' + f.dependsOn] ? [] : refOptions(f.ref, params), value: vv, onChange: (val, o) => ctx.onRefChange && ctx.onRefChange(name, val, o) });
      return c;
    }
    case 'users': case 'suppliers': {
      let ids = Array.isArray(vv) ? vv : (() => { try { return JSON.parse(vv || '[]'); } catch { return []; } })();
      const w = el(html`<div class="checks" data-multi="${name}"></div>`);
      Promise.resolve(f.type === 'users' ? refOptions('users') : refOptions('suppliers')).then((opts) => {
        w.innerHTML = toHTML(opts.length ? opts.map((o) => html`<label><input type="checkbox" value="${o.id}" ${ids.includes(o.id) ? 'checked' : ''}>${o.label}</label>`) : html`<span class="muted small">Nenhum cadastrado</span>`);
      });
      return w;
    }
    default: return el(html`<input type="text" name="${name}" value="${vv}" ${req} ${f.readonly ? raw('readonly') : ''} ${f.sentence ? raw('data-sentence') : ''}>`);
  }
}

export function buildForm(resKey, values = {}, { only, exclude = [], hide = [] } = {}) {
  const meta = S.meta.resources[resKey];
  const form = el('<form class="form-grid" novalidate></form>');
  const fields = meta.fields.filter((f) => (!only || only.includes(f.name)) && !exclude.includes(f.name) && !(f.readonly && !values[f.name]));
  const ctx = { values: { ...values } };
  const defaults = (f) => (f.default === '$today' ? today() : f.default === '$me' ? S.user.id : f.default);
  const isNew = !values.id;
  fields.forEach((f) => {
    const v = values[f.name] !== undefined ? values[f.name] : (isNew ? defaults(f) : undefined);
    const wrap = el(html`<div class="field ${f.wide || f.type === 'textarea' ? 'wide' : ''} ${hide.includes(f.name) ? 'hidden' : ''}" data-field="${f.name}"><label>${f.label}${f.required ? html` <span class="req">*</span>` : ''}</label></div>`);
    const input = fieldInput(f, v, ctx);
    if (f.readonly) input.setAttribute?.('disabled', '');
    wrap.appendChild(input);
    form.appendChild(wrap);
  });
  // dependências (ex.: etapa depende do projeto) e visibilidade condicional
  ctx.onRefChange = (name, val) => {
    ctx.values[name] = val;
    fields.filter((f) => f.dependsOn === name).forEach((f) => {
      const c = form.querySelector(`[data-field="${f.name}"] .combo`);
      if (c) c.combo.setOptions([]), val && refOptions(f.ref, { ['f_' + name]: val }).then((o) => c.combo.setOptions(o));
    });
    form.dispatchEvent(new CustomEvent('refchange', { detail: { name, val } }));
  };
  const applyShowIf = () => {
    const cur = readForm(form);
    fields.filter((f) => f.showIf).forEach((f) => {
      const ok = Object.entries(f.showIf).every(([k, vals]) => vals.includes(cur[k]));
      form.querySelector(`[data-field="${f.name}"]`)?.classList.toggle('hidden', !ok);
    });
  };
  form.addEventListener('input', (e) => { if (e.target.type === 'range' && e.target.nextElementSibling) e.target.nextElementSibling.textContent = e.target.value + '%'; });
  form.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox' && e.target.closest('.toggle')) e.target.closest('.toggle').querySelector('.small').textContent = e.target.checked ? 'Sim' : 'Não';
    applyShowIf();
  });
  applyShowIf();
  form.fields = fields;
  return form;
}
export function readForm(form) {
  const out = {};
  $$('input[name], select[name], textarea[name]', form).forEach((i) => {
    if (i.closest('[data-multi]')) return;
    if (i.type === 'checkbox') out[i.name] = i.checked ? 1 : 0;
    else { applySentence(i); out[i.name] = i.value; }
  });
  $$('[data-multi]', form).forEach((w) => { out[w.dataset.multi] = $$('input:checked', w).map((i) => Number(i.value)); });
  return out;
}
export function validate(form) {
  for (const f of form.fields || []) {
    if (!f.required) continue;
    const box = form.querySelector(`[data-field="${f.name}"]`); if (!box || box.classList.contains('hidden')) continue;
    const i = box.querySelector('[name]');
    if (i && !String(i.value).trim()) { toast(`Preencha o campo "${f.label}".`, { error: true }); (box.querySelector('input:not([type=hidden]),select,textarea,button') || i).focus(); return false; }
  }
  return true;
}

// Abre um formulário (novo ou edição) em um drawer
export function openForm(resKey, { id, values = {}, title, onSaved, only, exclude, hide, before, after, extra, transform, saveLabel } = {}) {
  const meta = S.meta.resources[resKey];
  return new Promise(async (resolve) => {
    let row = values;
    if (id) { try { row = { ...(await api.get(`/r/${resKey}/${id}`)), ...values }; } catch (e) { fail(e); return resolve(null); } }
    const form = buildForm(resKey, row, { only, exclude, hide });
    const body = el('<div></div>');
    if (before) body.appendChild(before instanceof Node ? before : el(toHTML(before)));
    body.appendChild(form);
    if (after) body.appendChild(after instanceof Node ? after : el(toHTML(after)));
    const d = drawer({ title: title || (id ? `Editar ${meta.singular.toLowerCase()}` : `Novo(a) ${meta.singular.toLowerCase()}`), sub: meta.label, body, onClose: () => resolve(null) });
    d.foot.classList.remove('hidden');
    d.foot.innerHTML = toHTML(html`<button class="btn" data-cancel>Cancelar</button><button class="btn primary" data-save>${saveLabel || 'Salvar'}</button>`);
    d.foot.querySelector('[data-cancel]').onclick = d.close;
    if (extra) extra(form, d, row);
    const save = async () => {
      if (!validate(form)) return;
      let data = readForm(form);
      if (transform) data = (await transform(data, form)) || data;
      if (data === false) return;
      const b = d.foot.querySelector('[data-save]'); b.disabled = true;
      try {
        const saved = id ? await api.put(`/r/${resKey}/${id}`, data) : await api.post(`/r/${resKey}`, data);
        invalidateRefs(resKey);
        toast(id ? 'Alterações salvas.' : `${meta.singular} criado(a).`);
        d.close(); resolve(saved); onSaved && onSaved(saved);
      } catch (e) { fail(e); b.disabled = false; }
    };
    d.foot.querySelector('[data-save]').onclick = save;
    form.onsubmit = (e) => { e.preventDefault(); save(); };
    setTimeout(() => { const i = form.querySelector('input:not([type=hidden]):not([readonly]),textarea'); if (i && window.innerWidth > 720) i.focus(); }, 80);
  });
}

// Ações padrão de registro
export async function archiveRow(resKey, row, archived = 1) {
  await api.post(`/r/${resKey}/${row.id}/archive`, { archived });
  invalidateRefs(resKey); toast(archived ? 'Arquivado.' : 'Restaurado.');
}
export async function deleteRow(resKey, row, name) {
  const arch = S.meta && S.meta.resources[resKey] && S.meta.resources[resKey].archivable;
  if (!(await confirmDialog(`Excluir definitivamente ${name ? `"${name}"` : 'este registro'}? Esta ação não pode ser desfeita.${arch ? ' Para apenas retirar das listas e manter o histórico, use “Arquivar”.' : ''}`, { title: 'Excluir definitivamente', ok: 'Excluir definitivamente', danger: true }))) return false;
  await api.del(`/r/${resKey}/${row.id}`); invalidateRefs(resKey); toast('Excluído.'); return true;
}
export async function duplicateRow(resKey, row) {
  const r = await api.post(`/r/${resKey}/${row.id}/duplicate`); invalidateRefs(resKey); toast('Registro duplicado.'); return r;
}

// ------------------------------ Tabela ------------------------------
export function table({ columns, rows, onRow, actions, sort, onSort, empty = 'Nenhum registro encontrado.', foot, cls = '' }) {
  if (!rows.length) return el(html`<div class="table-wrap"><div class="empty">${icon('folder')}<div>${empty}</div></div></div>`);
  const t = el(html`<div class="table-wrap"><table class="t responsive ${cls}"><thead><tr>
    ${columns.map((c) => html`<th class="${c.sort !== false && onSort ? 'sortable' : ''} ${c.align || ''}" data-k="${c.key}">${c.label}${sort && sort.key === c.key ? html`<span class="arr">${sort.dir === 'desc' ? '↓' : '↑'}</span>` : ''}</th>`)}
    ${actions ? html`<th></th>` : ''}</tr></thead>
    <tbody>${rows.map((r, i) => html`<tr data-i="${i}" class="${onRow ? 'click' : ''} ${r._muted ? 'muted-row' : ''}">
      ${columns.map((c, ci) => html`<td class="${c.align || ''} ${c.cls || ''} ${ci === 0 ? 'primary' : ''}" data-l="${c.label}">${c.render ? c.render(r) : r[c.key] ?? '—'}</td>`)}
      ${actions ? html`<td class="actions"><button class="icon-btn" data-act="${i}">${icon('more')}</button></td>` : ''}</tr>`)}</tbody>
    ${foot ? html`<tfoot><tr>${foot}</tr></tfoot>` : ''}</table></div>`);
  t.onclick = (e) => {
    const th = e.target.closest('th.sortable');
    if (th && onSort) { const k = th.dataset.k; onSort({ key: k, dir: sort && sort.key === k && sort.dir === 'asc' ? 'desc' : 'asc' }); return; }
    const a = e.target.closest('[data-act]');
    if (a) { e.stopPropagation(); menu(a, actions(rows[+a.dataset.act])); return; }
    if (e.target.closest('a,button,input,label')) return;
    const tr = e.target.closest('tr[data-i]'); if (tr && onRow) onRow(rows[+tr.dataset.i]);
  };
  return t;
}

export function exportCSV(filename, columns, rows) {
  const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [columns.map((c) => cell(c.label)).join(';'), ...rows.map((r) => columns.map((c) => cell(c.csv ? c.csv(r) : r[c.key])).join(';'))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename.endsWith('.csv') ? filename : filename + '.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const csvMoney = (n) => (n === null || n === undefined ? '' : Number(n).toFixed(2).replace('.', ','));

// ------------------------------ Anexos, checklist, comentários ------------------------------
export const fileUrl = (d, inline) => `/api/files/${d.id}${inline ? '?inline=1' : ''}`;
export function uploadFiles(files, meta = {}) {
  const max = ((S.meta && S.meta.max_upload_mb) || 200) * 1024 * 1024;
  const big = Array.from(files).filter((f) => f.size > max);
  if (big.length) return Promise.reject(new Error(`${big.map((f) => `“${f.name}” (${bytes(f.size)})`).join(', ')} passa do limite de ${bytes(max)} por arquivo. Reduza o PDF (exportar com imagens comprimidas) ou divida em partes.`));
  const fd = new FormData();
  Array.from(files).forEach((f) => fd.append('files', f));
  Object.entries(meta).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') fd.append(k, v); });
  return api('/files', { method: 'POST', body: fd });
}
export function dropzone(meta, onDone, { label = 'Arraste arquivos aqui ou clique para enviar', accept = '', compact = false } = {}) {
  const z = el(html`<div class="dropzone ${compact ? 'compact' : ''}">${icon('upload')}<div class="mt-8">${label}</div><input type="file" multiple ${accept ? raw(`accept="${accept}"`) : ''} class="hidden"></div>`);
  const inp = z.querySelector('input');
  const send = async (files) => { if (!files.length) return; z.classList.add('over'); try { const r = await uploadFiles(files, typeof meta === 'function' ? meta() : meta); toast(`${files.length} arquivo(s) enviado(s).`); onDone && onDone(r); } catch (e) { fail(e); } z.classList.remove('over'); inp.value = ''; };
  z.onclick = () => inp.click(); inp.onchange = () => send(inp.files);
  z.ondragover = (e) => { e.preventDefault(); z.classList.add('over'); }; z.ondragleave = () => z.classList.remove('over');
  z.ondrop = (e) => { e.preventDefault(); z.classList.remove('over'); send(e.dataTransfer.files); };
  return z;
}
export function fileRow(d, { onDelete, onArchive } = {}) {
  const isImg = (d.mime || '').startsWith('image/');
  const r = el(html`<div class="file"><div class="file-ico">${isImg ? icon('image', 'sm') : fileExt(d.file_name)}</div>
    <div class="grow"><a class="li-title" href="${fileUrl(d, true)}" target="_blank" rel="noopener">${d.title}</a>
    <div class="li-sub">${[d.category, d.size ? bytes(d.size) : null, d.created_at ? date(d.created_at) : null, d.uploaded_by_name].filter(Boolean).join(' · ')}${d.client_visible ? ' · visível ao cliente' : ''}${d.expires_at ? ` · validade ${date(d.expires_at)}` : ''}</div></div>
    <a class="icon-btn" href="${fileUrl(d)}" title="Baixar">${icon('download', 'sm')}</a>${onArchive ? html`<button class="icon-btn" data-arc title="${d.archived ? 'Restaurar' : 'Arquivar (retira da lista, mantém o histórico)'}">${icon(d.archived ? 'refresh' : 'archive', 'sm')}</button>` : ''}${onDelete ? html`<button class="icon-btn" data-del title="Excluir definitivamente">${icon('trash', 'sm')}</button>` : ''}</div>`);
  if (onDelete) r.querySelector('[data-del]').onclick = () => onDelete(d);
  if (onArchive) r.querySelector('[data-arc]').onclick = () => onArchive(d);
  return r;
}
export function attachments(entity, id, { extraMeta = {}, title = 'Anexos' } = {}) {
  const box = el(html`<div><div class="eyebrow mb-8">${title}</div><div class="files"></div><div class="mt-8"></div></div>`);
  const listEl = box.querySelector('.files');
  let showArch = false;
  const load = async () => {
    const all_ = await api.get(`/attachments/${entity}/${id}`);
    const rows = all_.filter((d) => showArch || !d.archived); const nArch = all_.filter((d) => d.archived).length;
    listEl.innerHTML = '';
    if (!rows.length) listEl.appendChild(el('<div class="muted small">Nenhum arquivo anexado.</div>'));
    rows.forEach((d) => listEl.appendChild(fileRow(d, { onArchive: async (doc) => { await archiveRow('documents', doc, doc.archived ? 0 : 1); load(); } })));
    if (nArch) { const b = el(html`<button type="button" class="btn xs ghost mt-8">${showArch ? 'Ocultar arquivados' : `Mostrar ${nArch} arquivado(s)`}</button>`); b.onclick = () => { showArch = !showArch; load(); }; listEl.appendChild(b); }
  };
  box.lastElementChild.appendChild(dropzone({ entity, entity_id: id, ...extraMeta }, load, { label: 'Anexar arquivo', compact: true }));
  load().catch(fail);
  return box;
}
export function checklist(entity, id) {
  const box = el(html`<div class="checklist"><div class="row between mb-8"><div class="eyebrow">Checklist</div><span class="small muted" data-count></span></div><div data-items></div>
    <form class="row mt-8"><input class="input" placeholder="Adicionar item…" name="t"><button class="btn sm">Adicionar</button></form></div>`);
  const items = box.querySelector('[data-items]');
  const render = (rows) => {
    items.innerHTML = toHTML(rows.map((c) => html`<label class="ci ${c.done ? 'done' : ''}"><input type="checkbox" data-id="${c.id}" ${c.done ? 'checked' : ''}><span>${c.text}</span><button type="button" class="icon-btn del" data-del="${c.id}">${icon('x', 'sm')}</button></label>`));
    box.querySelector('[data-count]').textContent = rows.length ? `${rows.filter((r) => r.done).length}/${rows.length}` : '';
  };
  let rows = [];
  const load = async () => { rows = await api.get(`/checklist/${entity}/${id}`); render(rows); };
  items.onchange = async (e) => { const i = e.target.closest('input[data-id]'); if (!i) return; await api.put(`/checklist/item/${i.dataset.id}`, { done: i.checked }); rows.find((r) => r.id == i.dataset.id).done = i.checked ? 1 : 0; render(rows); };
  items.onclick = async (e) => { const b = e.target.closest('[data-del]'); if (!b) return; e.preventDefault(); await api.del(`/checklist/item/${b.dataset.del}`); rows = rows.filter((r) => r.id != b.dataset.del); render(rows); };
  box.querySelector('form').onsubmit = async (e) => { e.preventDefault(); const t = e.target.t.value.trim(); if (!t) return; rows.push(await api.post(`/checklist/${entity}/${id}`, { text: t })); e.target.t.value = ''; render(rows); };
  load().catch(fail);
  return box;
}
export function comments(entity, id) {
  const box = el(html`<div><div class="eyebrow mb-8">Comentários</div><div data-items></div>
    <form class="col mt-8" style="gap:8px"><textarea class="input" name="b" rows="2" placeholder="Escreva um comentário…" style="height:auto;padding:10px 12px"></textarea><div class="row" style="justify-content:flex-end"><button class="btn sm primary">Comentar</button></div></form></div>`);
  const items = box.querySelector('[data-items]');
  const add = (c) => items.appendChild(el(html`<div class="comment">${avatar({ name: c.user_name, color: c.color }, 'sm')}<div class="grow"><div class="small"><b>${c.user_name}</b> <span class="muted">${datetime(c.created_at)}</span></div><div class="b">${c.body}</div></div></div>`));
  api.get(`/comments/${entity}/${id}`).then((rows) => { if (!rows.length) items.innerHTML = '<div class="muted small">Nenhum comentário ainda.</div>'; rows.forEach(add); }).catch(fail);
  box.querySelector('form').onsubmit = async (e) => { e.preventDefault(); const b = e.target.b.value.trim(); if (!b) return; const c = await api.post(`/comments/${entity}/${id}`, { body: b }); if (items.querySelector('.muted')) items.innerHTML = ''; add(c); e.target.b.value = ''; };
  return box;
}

export function emptyState(text, action) { return html`<div class="empty sm">${text}${action ? html`<div class="mt-8">${action}</div>` : ''}</div>`; }
export const waLink = (n) => (n ? `https://wa.me/55${String(n).replace(/\D/g, '').replace(/^55/, '')}` : null);

// ------------------------------ PDFs e utilidades de documentos ------------------------------
// Abre o PDF numa nova aba (visualizar, baixar ou imprimir). Antes confere pendências no servidor
// e, se houver alterações não salvas, oferece salvá-las primeiro.
export async function openPdf(url, { dirty = false, save, draftUrl } = {}) {
  if (dirty && save) {
    const choice = await new Promise((res) => modal({ title: 'Alterações não salvas', body: html`<p class="muted" style="margin:0">Existem alterações que ainda não foram salvas. O PDF é gerado com os dados salvos.</p>`,
      actions: [{ label: 'Cancelar', value: 'cancel' }, { label: 'Usar versão salva', value: 'saved' }, { label: 'Salvar e gerar PDF', primary: true, value: 'save' }], onClose: (v) => res(v || 'cancel') }));
    if (choice === 'cancel') return;
    if (choice === 'save') { const okSave = await save(); if (okSave === false) return; }
  }
  const w = window.open('', '_blank');
  if (w) { try { w.document.title = 'Gerando PDF…'; w.document.body.innerHTML = '<p style="font:14px system-ui,sans-serif;color:#777;padding:32px">Gerando PDF…</p>'; } catch { /* aba bloqueada */ } }
  try {
    const sep = url.includes('?') ? '&' : '?';
    const r = await api.get(`${url}${sep}check=1`);
    if (r && r.ok === false) { if (w) w.close(); return pdfProblems(r.problems, draftUrl); }
    if (w) w.location.href = '/api' + url; else location.href = '/api' + url;
  } catch (e) { if (w) w.close(); fail(e); }
}
export function pdfProblems(problems, draftUrl) {
  modal({ title: 'Complete antes de gerar', body: html`<p class="muted small" style="margin-top:0">O documento não foi gerado porque há informações pendentes:</p>
    <ul class="problems">${(problems || []).map((p) => html`<li>${p}</li>`)}</ul>${draftUrl ? html`<p class="small muted">Você pode visualizar um rascunho (com marca d'água) para conferir o texto.</p>` : ''}`,
  actions: [...(draftUrl ? [{ label: 'Ver rascunho', fn: () => { window.open('/api' + draftUrl, '_blank'); } }] : []), { label: 'Entendi', primary: true }] });
}
// Trata erros 400 com lista de pendências vindas do servidor
export function failProblems(e) { if (e && e.data && e.data.problems) pdfProblems(e.data.problems); else fail(e); }
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
    let okc = false; try { okc = document.execCommand('copy'); } catch { okc = false; } t.remove(); return okc;
  }
}
export const brl2 = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const parseNum = (v) => { if (v === '' || v === null || v === undefined) return 0; const s = String(v).trim(); const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); return Number.isFinite(n) ? n : 0; };

// Editor de linhas (tabela editável) — usado em parcelas, etapas, executivos, pendências, itens de orçamento.
// columns: [{ key, label, type: text|textarea|date|money|number|select, options:[{value,label}], w: '1fr', placeholder }]
export function rowsEditor({ columns, rows = [], onChange, addLabel = 'Adicionar linha', empty = 'Nenhum item.', total, reorder = true }) {
  let data = rows.map((r) => ({ ...r }));
  const box = el(html`<div class="rows-ed"><div class="re-head" style="grid-template-columns:${columns.map((c) => c.w || '1fr').join(' ')} 64px">${columns.map((c) => html`<span>${c.label}</span>`)}<span></span></div><div class="re-body"></div>
    <div class="re-foot"><button type="button" class="btn sm" data-add>${icon('plus', 'sm')} ${addLabel}</button><span class="grow"></span><span class="re-total small"></span></div></div>`);
  const body = box.querySelector('.re-body');
  const input = (c, v, i) => {
    const val = v ?? '';
    const attrs = `data-k="${c.key}" data-i="${i}" aria-label="${esc(c.label)}"`;
    switch (c.type) {
      case 'select': return `<select class="input" ${attrs}><option value="">—</option>${c.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      case 'date': return `<input class="input" type="date" ${attrs} value="${esc(String(val).slice(0, 10))}">`;
      case 'money': return `<div class="money-input"><span>R$</span><input class="input" type="text" inputmode="decimal" ${attrs} value="${val === '' ? '' : esc(brl2(val))}"></div>`;
      case 'number': return `<input class="input" type="text" inputmode="decimal" ${attrs} value="${esc(String(val).replace('.', ','))}">`;
      case 'textarea': return `<textarea class="input" rows="2" ${attrs} placeholder="${esc(c.placeholder || '')}">${esc(val)}</textarea>`;
      default: return `<input class="input" type="text" ${attrs} value="${esc(val)}" placeholder="${esc(c.placeholder || '')}" ${c.sentence ? 'data-sentence' : ''}>`;
    }
  };
  const render = () => {
    body.innerHTML = data.length ? data.map((r, i) => `<div class="re-row" style="grid-template-columns:${columns.map((c) => c.w || '1fr').join(' ')} 64px">${columns.map((c) => `<label class="re-cell"><span class="re-l">${esc(c.label)}</span>${c.render ? c.render(r, i) : input(c, r[c.key], i)}</label>`).join('')}
      <div class="re-act">${reorder ? `<button type="button" class="icon-btn" data-up="${i}" title="Subir">${toHTML(icon('out', 'sm'))}</button>` : ''}<button type="button" class="icon-btn" data-rm="${i}" title="Remover">${toHTML(icon('x', 'sm'))}</button></div></div>`).join('') : `<div class="muted small re-empty">${esc(empty)}</div>`;
    upd(false);
  };
  const upd = (notify = true) => { const t = box.querySelector('.re-total'); if (total) t.innerHTML = toHTML(total(data)); if (notify && onChange) onChange(data); };
  const read = (e) => {
    const t = e.target.closest('[data-k]'); if (!t) return;
    const c = columns.find((x) => x.key === t.dataset.k); const i = +t.dataset.i;
    data[i][c.key] = c.type === 'money' || c.type === 'number' ? (t.value.trim() === '' ? '' : parseNum(t.value)) : t.value;
    upd();
  };
  body.addEventListener('input', read); body.addEventListener('change', (e) => { read(e); const t = e.target.closest('[data-k]'); if (t) { const c = columns.find((x) => x.key === t.dataset.k); if (c.type === 'money' && t.value.trim() !== '') t.value = brl2(parseNum(t.value)); } });
  box.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]'); const up = e.target.closest('[data-up]');
    if (rm) { data.splice(+rm.dataset.rm, 1); render(); upd(); }
    if (up) { const i = +up.dataset.up; if (i > 0) { [data[i - 1], data[i]] = [data[i], data[i - 1]]; render(); upd(); } }
    if (e.target.closest('[data-add]')) { data.push(Object.fromEntries(columns.map((c) => [c.key, c.default !== undefined ? (typeof c.default === 'function' ? c.default(data) : c.default) : '']))); render(); upd(); const last = body.lastElementChild && body.lastElementChild.querySelector('input,select,textarea'); if (last) last.focus(); }
  });
  render();
  box.rows = { get: () => data.map((r) => ({ ...r })), set: (r) => { data = r.map((x) => ({ ...x })); render(); }, refresh: () => upd(false) };
  return box;
}

// Marca um formulário como "com alterações não salvas" e avisa ao sair da página
export function dirtyTracker(root) {
  const st = { dirty: false };
  const mark = () => { st.dirty = true; root.classList.add('is-dirty'); };
  root.addEventListener('input', mark); root.addEventListener('change', mark);
  const beforeUnload = (e) => { if (st.dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  const onHash = () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('hashchange', onHash); };
  window.addEventListener('hashchange', onHash);
  st.clean = () => { st.dirty = false; root.classList.remove('is-dirty'); };
  st.mark = mark;
  return st;
}

// ------------------------------ Padrão de escrita (1ª letra maiúscula, demais minúsculas) ------------------------------
// Aplicado a campos de texto livre de conteúdo (textareas e campos marcados com data-sentence) quando o usuário
// digita ou cola. Não altera senhas, e-mails, links, chaves Pix, códigos nem registros antigos que não foram editados.
const SENT_SEL = 'textarea:not([data-raw]):not(.body-ta), input[data-sentence]';
const PROTECT = /^(?:https?:\/\/|www\.)|@|\{\{|\}\}|\d|\//i;
// siglas mantidas em maiúsculas (quando o texto não está todo em caixa alta)
const ACRONYMS = new Set(['PDF', 'CAU', 'RRT', 'ART', 'CPF', 'CNPJ', 'CEP', 'PIX', 'MS', 'MT', 'SP', 'RJ', 'BR', 'UF', 'CREA', 'IPTU', 'LED', 'MDF', 'MDP', 'PVC', 'ABNT', 'NBR', 'WC', 'TV', 'AC', 'CAU-MS', 'CAU/MS', 'ISS', 'INSS', 'NF', 'NFS-E', 'DWG', 'RT', 'CEO', 'OK', 'EUA']);
// Nomes próprios escritos com inicial maiúscula no meio do texto são mantidos (ex.: "Casa Silva").
// Só se normaliza o que está em CAIXA ALTA, com maiúsculas soltas no meio da palavra, ou quando
// quase todas as palavras do texto começam com maiúscula ("Texto Digitado Assim").
const LOWER_WORDS = new Set(['a', 'o', 'e', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas', 'com', 'para', 'por', 'um', 'uma', 'ao', 'aos', 'à', 'às', 'ou', 'que', 'se']);
export function sentenceCase(text, { atStart = true } = {}) {
  if (!text) return text;
  let start = atStart;
  const words = text.split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, '')).filter((w) => w.length >= 3 && !LOWER_WORDS.has(w.toLocaleLowerCase('pt-BR')));
  const caps = words.filter((w) => /^\p{Lu}/u.test(w)).length;
  const titleText = words.length >= 3 && caps === words.length; // todas as palavras com inicial maiúscula: normaliza
  const keepName = (w) => !titleText && /^\p{Lu}[\p{Ll}]+(?:[-'’]\p{Lu}?[\p{Ll}]+)*$/u.test(w);
  return text.split(/(\r?\n)/).map((part) => {
    if (/^\r?\n$/.test(part)) { start = true; return part; }
    return part.split(/(\s+)/).map((w) => {
      if (!w || /^\s+$/.test(w)) return w;
      let out = w;
      const bare = w.replace(/[.,;:!?()]+/g, '');
      const acronym = ACRONYMS.has(bare.toLocaleUpperCase('pt-BR')) && bare === bare.toLocaleUpperCase('pt-BR');
      if (!PROTECT.test(w) && !acronym && !keepName(bare)) out = w.toLocaleLowerCase('pt-BR');
      if (start) { const i = out.search(/\p{L}/u); if (i >= 0) { out = out.slice(0, i) + out.charAt(i).toLocaleUpperCase('pt-BR') + out.slice(i + 1); start = false; } }
      if (/[.!?]["')\]]*$/.test(out)) start = true;
      return out;
    }).join('');
  }).join('');
}
const sentenceValue = (el_) => (el_.matches && el_.matches(SENT_SEL) && el_._sentOrig !== undefined && el_.value !== el_._sentOrig ? sentenceCase(el_.value) : el_.value);
export function applySentence(el_) { const v = sentenceValue(el_); if (v !== el_.value) { el_.value = v; el_.dispatchEvent(new Event('input', { bubbles: true })); } el_._sentOrig = el_.value; }
document.addEventListener('focusin', (e) => { const t = e.target; if (t.matches && t.matches(SENT_SEL) && t._sentOrig === undefined) t._sentOrig = t.value; });
document.addEventListener('focusout', (e) => { const t = e.target; if (t.matches && t.matches(SENT_SEL)) applySentence(t); });
document.addEventListener('keydown', (e) => { const t = e.target; if (e.key === 'Enter' && t.tagName === 'INPUT' && t.matches(SENT_SEL)) applySentence(t); }, true);
document.addEventListener('paste', (e) => {
  const t = e.target; if (!t.matches || !t.matches(SENT_SEL)) return;
  const txt = e.clipboardData && e.clipboardData.getData('text/plain'); if (txt == null || txt === '') return;
  e.preventDefault();
  if (t._sentOrig === undefined) t._sentOrig = t.value;
  const s = t.selectionStart ?? t.value.length; const en = t.selectionEnd ?? s; const before = t.value.slice(0, s);
  const atStart = !before.trim() || /[.!?]\s*$/.test(before) || /\n\s*$/.test(before);
  t.setRangeText(sentenceCase(txt, { atStart }), s, en, 'end');
  t.dispatchEvent(new Event('input', { bubbles: true }));
});
export { sentenceValue };
