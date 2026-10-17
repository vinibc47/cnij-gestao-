// =====================================================================
// Apresentações — editor visual no padrão do escritório.
// Fluxo: projeto → apresentação (01, 02…) → capa, planta e imagens → ambientes
// → conferir, salvar, exportar PDF ou publicar no portal.
// A prévia usa o mesmo desenho do PDF (slides-core.js).
// =====================================================================
import { S, api, html, raw, el, toHTML, icon, toast, fail, modal, menu, combo, refOptions, confirmDialog, datetime, date, isManager, $$, debounce } from '../lib.js';
import '../slides-core.js';
const SC = globalThis.SlidesCore;

const pad = (n) => String(n || 1).padStart(2, '0');
const clone = (o) => JSON.parse(JSON.stringify(o));
const COLORS = [['#1F1F1F', 'Grafite'], ['#FFFFFF', 'Branco'], ['#B23A2E', 'Vermelho'], ['#2A6BD8', 'Azul'], ['#C28A2C', 'Dourado'], ['#5F7A4A', 'Verde']];
const TOOLS = [['select', 'Selecionar', 'cursor'], ['medida', 'Medida', 'ruler'], ['observacao', 'Observação', 'msg'], ['texto', 'Texto', 'text'], ['seta', 'Seta', 'arrow']];
const TOOL_ICON = {
  cursor: '<path d="M5 3l14 8-6 2-3 6z"/>', ruler: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  msg: '<path d="M4 5h16v11H9l-5 4z"/>', text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>', arrow: '<path d="M5 19L19 5M10 5h9v9"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', up: '<path d="M12 19V5M5 12l7-7 7 7"/>', down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
};
const ti = (k, cls = 'sm') => raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${TOOL_ICON[k]}</svg>`);

export default async function (ctx) {
  const root = el('<div class="apr"></div>'); ctx.root.appendChild(root);
  const pid = Number(ctx.query.projeto) || null; const presId = Number(ctx.params[0]) || null;
  let projectId = pid;
  if (presId && !projectId) { try { projectId = (await api.get(`/presentations/${presId}`)).project_id; } catch (e) { fail(e); } }
  if (!projectId) return landing(ctx, root);
  return editor(ctx, root, projectId, presId);
}

// ------------------------------------------------------------------ início: escolher o projeto
async function landing(ctx, root) {
  const recent = await api.get('/presentations');
  root.innerHTML = toHTML(html`<div class="page-head"><div><h1>Apresentações</h1><div class="sub">Capa, planta e imagens dos ambientes no padrão do escritório — com medidas, observações, PDF e publicação no portal.</div></div></div>
    <div class="card apr-pick"><label class="small muted">Projeto</label><span data-p></span><p class="small muted" style="margin:8px 0 0">Escolha o projeto para ver ou criar as apresentações (01, 02, 03…).</p></div>
    ${recent.length ? html`<div class="section-title">Editadas recentemente</div><div class="grid g3">${recent.slice(0, 12).map((r) => html`<a class="card click apr-recent" href="#/apresentacoes/${r.id}?projeto=${r.project_id}">
      <div class="cell-title">${r.title}</div><div class="cell-sub">${r.project_name}${r.client_name ? ' · ' + r.client_name : ''}</div>
      <div class="row between mt-8 small"><span class="badge ${r.status === 'publicada' ? 'success' : 'muted'}">${r.status === 'publicada' ? 'Publicada' : 'Rascunho'}</span><span class="muted">${datetime(r.updated_at)}</span></div></a>`)}</div>` : ''}`);
  root.querySelector('[data-p]').appendChild(combo({ name: 'p', options: refOptions('projects'), placeholder: 'Escolher projeto…', onChange: (v) => v && ctx.go(`#/apresentacoes?projeto=${v}`) }));
}

// ------------------------------------------------------------------ editor
async function editor(ctx, root, projectId, presId) {
  let meta; let list; let logo;
  try { [meta, list, logo] = await Promise.all([api.get(`/presentations/meta/${projectId}`), api.get(`/presentations?project_id=${projectId}`), api.get('/presentations/logo/assets')]); } catch (e) { return fail(e); }
  const st = { pres: null, data: null, assets: {}, slide: 0, ann: null, tool: 'select', undo: [], redo: [], dirty: false, saving: false, savedAt: null, error: null, placed: [], ppi: [] };
  const go = (id) => ctx.go(`#/apresentacoes/${id}?projeto=${projectId}`);
  if (!list.length) return emptyProject();
  const cur = list.find((x) => x.id === presId) || list[list.length - 1];
  if (!presId || cur.id !== presId) return go(cur.id);
  try { const r = await api.get(`/presentations/${cur.id}`); st.pres = r; st.data = r.data; st.assets = r.assets || {}; } catch (e) { return fail(e); }
  // rascunho local não enviado (queda de conexão)
  const LK = `apr-unsaved-${st.pres.id}`;
  try { const loc = JSON.parse(localStorage.getItem(LK) || 'null'); if (loc && loc.rev === st.pres.rev && JSON.stringify(loc.data) !== JSON.stringify(st.data)) { st.data = loc.data; st.dirty = true; setTimeout(() => toast('Recuperamos alterações que ainda não tinham sido enviadas. Salvando…', { ms: 5000 }), 300); } } catch { /* */ }

  function emptyProject() {
    root.innerHTML = toHTML(html`${head()}<div class="empty" style="padding:60px 0">${icon('image')}<div>Nenhuma apresentação neste projeto ainda.</div><button class="btn primary mt-16" data-new>${icon('plus')} Criar Apresentação ${pad(meta.next_number)}</button></div>`);
    bindHead(); root.querySelector('[data-new]').onclick = newPres;
  }
  function head() {
    return html`<div class="apr-head"><div class="apr-title"><h1>Apresentações</h1><div class="apr-proj"><span data-proj></span><div class="apr-code"><span class="small muted">Código do projeto</span><b>${meta.project.code || '—'}</b></div></div></div>
      ${st.pres ? html`<div class="apr-actions"><span class="apr-save" data-status></span><button class="btn" data-save>${icon('check', 'sm')} Salvar</button><button class="btn" data-view>${ti('full')} Visualizar</button><button class="btn primary" data-pdf>${icon('download', 'sm')} Exportar PDF</button></div>` : ''}</div>
      <div class="apr-tabs">${list.map((p) => html`<a href="#/apresentacoes/${p.id}?projeto=${projectId}" class="${st.pres && p.id === st.pres.id ? 'on' : ''}">${p.title}${p.status === 'publicada' ? html`<span class="dot" title="Publicada"></span>` : ''}</a>`)}
        <button class="add" data-new>${icon('plus', 'sm')} Nova apresentação</button>
        ${st.pres ? html`<span class="grow"></span><button class="btn ghost sm" data-ren>${icon('edit', 'sm')} Renomear</button><button class="btn ghost sm" data-dup>${icon('copy', 'sm')} Duplicar</button><button class="btn ghost sm" data-more>${icon('more', 'sm')}</button>` : ''}</div>`;
  }
  function bindHead() {
    const pc = combo({ name: 'p', options: refOptions('projects'), value: projectId, onChange: (v) => v && Number(v) !== projectId && ctx.go(`#/apresentacoes?projeto=${v}`) });
    root.querySelector('[data-proj]').appendChild(pc);
    $$('[data-new]', root).forEach((b) => (b.onclick = newPres));
  }
  async function newPres() {
    await flush();
    try { const r = await api.post('/presentations', { project_id: projectId }); toast(`${r.title} criada.`); go(r.id); } catch (e) { fail(e); }
  }

  // ---------------- layout principal
  root.innerHTML = toHTML(html`${head()}
    <div class="apr-status" data-pub></div>
    <div class="apr-grid">
      <aside class="apr-pages card"><div class="apr-side-h"><b>Páginas</b><span class="small muted" data-count></span></div><div class="apr-thumbs" data-thumbs></div>
        <button class="btn apr-addpage" data-addpage>${icon('plus', 'sm')} Adicionar páginas</button></aside>
      <section class="apr-center">
        <div class="apr-tools">${TOOLS.map(([k, l, ic]) => html`<button data-tool="${k}" class="${k === 'select' ? 'on' : ''}" title="${l}">${ti(ic)}<span>${l}</span></button>`)}
          <span class="sep"></span><button data-undo title="Desfazer (Ctrl+Z)">${ti('undo')}<span>Desfazer</span></button><button data-redo title="Refazer (Ctrl+Y)">${ti('redo')}<span>Refazer</span></button></div>
        <div class="apr-hint small muted" data-hint></div>
        <div class="apr-stage card" data-stage></div>
        <div class="apr-pend" data-pend></div>
        <div class="apr-bottom"><div class="seg sm" data-format>${Object.entries(SC.FORMATS).map(([k, f]) => html`<button type="button" data-v="${k}">${k}</button>`)}</div><span class="grow"></span>
          ${isManager() ? html`<button class="btn primary" data-publish>${icon('upload', 'sm')} Publicar no portal</button>` : ''}<button class="btn" data-share>${icon('chat', 'sm')} Compartilhar</button></div>
      </section>
      <aside class="apr-panel card" data-panel></aside>
    </div>`);
  bindHead();
  const $ = (s) => root.querySelector(s);

  // assets para a prévia: imagens originais (o navegador aplica a orientação da foto)
  const A = () => {
    const images = {};
    Object.entries(st.assets).forEach(([id, a]) => { images[id] = { href: id === 'padrao' ? '/img/capa-apresentacao.jpg' : `/api/files/${id}?inline=1`, w: a.w, h: a.h, orientation: a.orientation, oriented: false }; });
    return { images, logo: logo.logo ? { href: logo.logo.uri, w: logo.logo.w, h: logo.logo.h } : null, logoDark: logo.logoDark ? { href: logo.logoDark.uri, w: logo.logoDark.w, h: logo.logoDark.h } : null };
  };
  const D = () => ({ ...st.data, number: st.pres.number });
  const slides = () => st.data.slides;
  const curSlide = () => slides()[st.slide];
  const slideLabel = (s, i) => (s.kind === 'capa' ? 'Capa' : s.kind === 'planta' ? (s.room || 'Planta de layout') : s.room || `Página ${pad(i + 1)}`);

  // ---------------- alterações (desfazer / refazer / salvar automático)
  function change(fn, { snapshot = true, render = 'all' } = {}) {
    if (snapshot) { st.undo.push(clone(st.data)); if (st.undo.length > 80) st.undo.shift(); st.redo = []; }
    fn(st.data); st.dirty = true; st.error = null;
    try { localStorage.setItem(LK, JSON.stringify({ rev: st.pres.rev, data: st.data })); } catch { /* */ }
    paint(render); scheduleSave();
  }
  const scheduleSave = debounce(() => save(), 1200);
  async function save(force) {
    if (st.saving) { st.again = true; return; }
    if (!st.dirty && !force) return;
    st.saving = true; status();
    const sent = clone(st.data);
    try {
      const r = await api.put(`/presentations/${st.pres.id}`, { rev: st.pres.rev, data: sent });
      Object.assign(st.pres, { rev: r.rev, status: r.status, has_unpublished: r.has_unpublished, published_version: r.published_version });
      Object.assign(st.assets, r.assets || {});
      if (JSON.stringify(sent) === JSON.stringify(st.data)) { st.dirty = false; try { localStorage.removeItem(LK); } catch { /* */ } }
      st.savedAt = new Date(); st.error = null;
    } catch (e) {
      st.error = e.status === 409 ? 'conflito' : navigator.onLine === false || !e.status || e.status >= 500 ? 'rede' : e.message;
      if (st.error === 'rede') setTimeout(() => save(), 10000);
    }
    st.saving = false; status(); pub();
    if (st.again) { st.again = false; save(); }
  }
  async function flush() { if (st.dirty) await save(true); }
  function status() {
    const b = $('[data-status]'); if (!b) return;
    b.className = 'apr-save';
    if (st.saving) b.innerHTML = 'Salvando…';
    else if (st.error === 'conflito') { b.classList.add('err'); b.innerHTML = toHTML(html`Alterada em outro aparelho · <button class="link" data-reload>recarregar</button>`); b.querySelector('[data-reload]').onclick = () => location.reload(); }
    else if (st.error === 'rede') { b.classList.add('err'); b.textContent = 'Sem conexão — alterações guardadas neste aparelho, tentando enviar…'; }
    else if (st.error) { b.classList.add('err'); b.textContent = `Não salvo: ${st.error}`; }
    else if (st.dirty) b.textContent = 'Alterações não salvas';
    else b.textContent = st.savedAt ? `Salvo às ${st.savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Tudo salvo';
  }
  const onLeave = (e) => { if (st.dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onLeave);
  const onHash = () => { if (!location.hash.startsWith('#/apresentacoes')) { window.removeEventListener('beforeunload', onLeave); window.removeEventListener('hashchange', onHash); document.removeEventListener('keydown', onKey); } flush(); };
  window.addEventListener('hashchange', onHash);

  // ---------------- desenho
  function paint(what = 'all') {
    if (st.slide >= slides().length) st.slide = slides().length - 1;
    if (what === 'all' || what === 'stage') stage();
    if (what === 'all' || what === 'thumbs') thumbs();
    if (what === 'all' || what === 'panel') panel();
    pend(); status(); pub();
    $$('[data-format] button', root).forEach((b) => b.classList.toggle('on', b.dataset.v === st.data.format));
    $$('[data-tool]', root).forEach((b) => b.classList.toggle('on', b.dataset.tool === st.tool));
    $('[data-undo]').disabled = !st.undo.length; $('[data-redo]').disabled = !st.redo.length;
  }
  function stage() {
    const r = SC.slideSvg(D(), st.slide, A(), { preview: true, selected: st.ann, withLayout: true });
    st.placed = r.placed || [];
    const box = $('[data-stage]'); box.innerHTML = r.svg;
    const svg = box.querySelector('svg'); svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.display = 'block';
    svg.classList.toggle('drawing', st.tool !== 'select'); box.classList.toggle('drawing', st.tool !== 'select'); box.classList.toggle('has-sel', st.ann !== null);
    $('[data-hint]').textContent = { select: curSlide().kind === 'capa' ? 'Capa: troque a foto, ajuste o enquadramento e a intensidade da camada branca no painel ao lado.' : 'Clique numa marcação para editar ou arrastar. Use as ferramentas para medir, observar, escrever ou apontar.',
      medida: 'Medida: clique e arraste entre dois pontos da imagem; depois informe o valor (a imagem não tem escala).', seta: 'Seta: clique e arraste do início até o ponto indicado.',
      observacao: 'Observação: clique no detalhe da imagem que quer comentar.', texto: 'Texto: clique onde o texto deve aparecer.' }[st.tool];
  }
  function thumbs() {
    const box = $('[data-thumbs]'); const a = A(); const d = D();
    $('[data-count]').textContent = `${slides().length}`;
    box.innerHTML = toHTML(html`${slides().map((s, i) => html`<div class="apr-thumb ${i === st.slide ? 'on' : ''}" data-i="${i}" draggable="${s.kind === 'capa' ? 'false' : 'true'}">
      <div class="apr-thumb-img">${raw(SC.slideSvg(d, i, a))}</div>
      <div class="apr-thumb-f"><span class="n">${pad(i + 1)}</span><span class="t">${slideLabel(s, i)}</span>
        ${s.kind !== 'capa' ? html`<span class="mv"><button data-up="${i}" title="Mover para cima" ${i <= 1 ? 'disabled' : ''}>${ti('up')}</button><button data-down="${i}" title="Mover para baixo" ${i >= slides().length - 1 ? 'disabled' : ''}>${ti('down')}</button><button data-pm="${i}" title="Mais">${icon('more', 'sm')}</button></span>` : ''}</div></div>`)}`);
    $$('.apr-thumb-img svg', box).forEach((svg) => { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.width = '100%'; svg.style.height = 'auto'; });
  }
  function move(from, to) { if (to < 1 || to >= slides().length || from < 1) return; change((d) => { const [x] = d.slides.splice(from, 1); d.slides.splice(to, 0, x); }); st.slide = to; paint(); }
  $('[data-thumbs]').addEventListener('click', (e) => {
    const up = e.target.closest('[data-up]'); const dn = e.target.closest('[data-down]'); const pm = e.target.closest('[data-pm]');
    if (up) return move(+up.dataset.up, +up.dataset.up - 1);
    if (dn) return move(+dn.dataset.down, +dn.dataset.down + 1);
    if (pm) { const i = +pm.dataset.pm; return menu(pm, [
      { label: 'Duplicar página', icon: 'copy', fn: () => { change((d) => d.slides.splice(i + 1, 0, { ...clone(d.slides[i]), id: rid() })); st.slide = i + 1; paint(); } },
      slides()[i].kind !== 'planta' ? { label: 'Excluir página', icon: 'trash', danger: true, fn: async () => { if (!(await confirmDialog('Excluir esta página da apresentação? (As imagens continuam nos arquivos do projeto.)', { ok: 'Excluir', danger: true }))) return; change((d) => d.slides.splice(i, 1)); st.slide = Math.max(0, i - 1); st.ann = null; paint(); } } : null]); }
    const t = e.target.closest('[data-i]'); if (t) { st.slide = +t.dataset.i; st.ann = null; paint(); }
  });
  // arrastar páginas para reordenar
  let dragFrom = null;
  $('[data-thumbs]').addEventListener('dragstart', (e) => { const t = e.target.closest('[data-i]'); if (!t) return; dragFrom = +t.dataset.i; e.dataTransfer.effectAllowed = 'move'; });
  $('[data-thumbs]').addEventListener('dragover', (e) => { if (dragFrom === null) return; e.preventDefault(); const t = e.target.closest('[data-i]'); $$('.apr-thumb', root).forEach((x) => x.classList.toggle('over', x === t)); });
  $('[data-thumbs]').addEventListener('drop', (e) => { e.preventDefault(); const t = e.target.closest('[data-i]'); if (t && dragFrom !== null) move(dragFrom, Math.max(1, +t.dataset.i)); dragFrom = null; });
  $('[data-thumbs]').addEventListener('dragend', () => { dragFrom = null; $$('.apr-thumb', root).forEach((x) => x.classList.remove('over')); });

  // ---------------- pendências (conferência antes de publicar)
  function warnings() {
    const w = SC.pendencies(D());
    slides().forEach((s, i) => { if (s.review) w.push(`Página ${pad(i + 1)}: imagem trocada — revise as marcações`); });
    st.placed.forEach((p, k) => { if (p.ppi && p.ppi < 110) w.push(`Página ${pad(st.slide + 1)}: imagem ${k + 1} com pouca resolução para este tamanho (${p.ppi} ppi) — pode ficar sem nitidez no PDF; ampliar não recupera detalhes`); });
    return w;
  }
  function pend() {
    const w = warnings();
    $('[data-pend]').innerHTML = toHTML(w.length ? html`<div class="note-box info">${icon('alert', 'sm')}<div><b>Para conferir</b><ul>${w.slice(0, 8).map((x) => html`<li>${x}</li>`)}</ul></div></div>` : '');
  }
  function pub() {
    const p = st.pres; const b = $('[data-pub]');
    b.innerHTML = toHTML(p.status === 'publicada' ? html`<span class="badge success">Publicada no portal · versão ${p.published_version}</span>${p.has_unpublished || st.dirty ? html` <span class="small">Há alterações em rascunho — o cliente continua vendo a versão publicada até você publicar de novo.</span>` : html` <span class="small muted">O cliente vê exatamente esta versão.</span>`}`
      : html`<span class="badge muted">Rascunho</span> <span class="small muted">Visível só para o escritório.</span>`);
  }

  // ---------------- painel lateral (contextual)
  function panel() {
    const P = $('[data-panel]'); const s = curSlide(); const a = st.ann !== null ? (s.annotations || [])[st.ann] : null;
    if (a) return annPanel(P, s, a);
    if (s.kind === 'capa') return coverPanel(P);
    return slidePanel(P, s);
  }
  const colorChips = (v) => html`<div class="apr-colors">${COLORS.map(([c, l]) => html`<button type="button" data-color="${c}" title="${l}" class="${(v || '#1F1F1F') === c ? 'on' : ''}" style="background:${c}"></button>`)}</div>`;
  function annPanel(P, s, a) {
    const T = { medida: 'Medida', observacao: 'Observação', seta: 'Seta', texto: 'Texto' };
    P.innerHTML = toHTML(html`<div class="apr-ph"><b>Editar ${T[a.type].toLowerCase()}</b><button class="icon-btn" data-close title="Fechar">${icon('x', 'sm')}</button></div>
      ${a.type === 'medida' ? html`<div class="form-grid"><div class="field"><label>Valor</label><input class="input" data-k="value" value="${a.value ?? ''}" placeholder="Ex.: 3,20" inputmode="decimal"></div>
        <div class="field"><label>Unidade</label><div class="seg sm" data-unit>${['m', 'cm', 'mm'].map((u) => html`<button type="button" data-v="${u}" class="${(a.unit || 'm') === u ? 'on' : ''}">${u}</button>`)}</div></div></div>
        <p class="small muted">${icon('alert', 'sm')} Marque dois pontos e informe a medida. O valor é digitado por você — a imagem não tem escala.</p>` : ''}
      ${a.type === 'observacao' || a.type === 'texto' ? html`<div class="field"><label>Texto</label><textarea class="input" rows="3" data-k="text" placeholder="${a.type === 'observacao' ? 'Ex.: Conferir posição da mesa' : 'Ex.: Painel ripado'}">${a.text || ''}</textarea></div>` : ''}
      <div class="field mt-8"><label>Cor</label>${colorChips(a.color)}</div>
      <div class="form-grid mt-8">${a.type !== 'texto' ? html`<div class="field"><label>Espessura</label><select class="input" data-k="stroke">${[0.8, 1.4, 2, 3].map((v) => html`<option value="${v}" ${(Number(a.stroke) || 1.4) === v ? 'selected' : ''}>${{ 0.8: 'Fina', 1.4: 'Média', 2: 'Grossa', 3: 'Extra' }[v]}</option>`)}</select></div>` : ''}
        ${a.type !== 'seta' ? html`<div class="field"><label>Tamanho do texto</label><select class="input" data-k="size">${[9, 11, 13, 16, 20].map((v) => html`<option value="${v}" ${(Number(a.size) || 11) === v ? 'selected' : ''}>${v}</option>`)}</select></div>` : ''}</div>
      ${a.type === 'observacao' ? html`<label class="check small mt-8"><input type="checkbox" data-leader ${a.ax !== undefined ? 'checked' : ''}> Linha de chamada apontando o detalhe</label>` : ''}
      <div class="row gap-8 mt-16"><button class="btn sm" data-dupa>${icon('copy', 'sm')} Duplicar</button><button class="btn sm danger" data-dela>${icon('trash', 'sm')} Excluir</button></div>`);
    const upd = (fn, snap = true) => change((d) => fn(d.slides[st.slide].annotations[st.ann]), { snapshot: snap, render: 'stage' });
    $$('[data-k]', P).forEach((i) => { let first = true; i.oninput = () => { upd((x) => { x[i.dataset.k] = ['stroke', 'size'].includes(i.dataset.k) ? Number(i.value) : i.value; }, first); first = false; }; });
    $$('[data-unit] button', P).forEach((b) => (b.onclick = () => { upd((x) => { x.unit = b.dataset.v; }); panel(); }));
    $$('[data-color]', P).forEach((b) => (b.onclick = () => { upd((x) => { x.color = b.dataset.color; }); panel(); }));
    const ld = P.querySelector('[data-leader]'); if (ld) ld.onchange = () => { upd((x) => { if (ld.checked) { x.ax = Math.max(0, x.x - 0.06); x.ay = Math.min(1, x.y + 0.12); } else { delete x.ax; delete x.ay; } }); };
    P.querySelector('[data-close]').onclick = () => { st.ann = null; paint(); };
    P.querySelector('[data-dupa]').onclick = () => { change((d) => { const l = d.slides[st.slide].annotations; const c = clone(l[st.ann]); ['x', 'x1', 'x2', 'ax'].forEach((k) => { if (c[k] !== undefined) c[k] = Math.min(0.98, c[k] + 0.03); }); ['y', 'y1', 'y2', 'ay'].forEach((k) => { if (c[k] !== undefined) c[k] = Math.min(0.98, c[k] + 0.03); }); l.push(c); st.ann = l.length - 1; }); };
    P.querySelector('[data-dela]').onclick = () => { change((d) => d.slides[st.slide].annotations.splice(st.ann, 1)); st.ann = null; paint(); };
    const v = P.querySelector('[data-k="value"], [data-k="text"]'); if (v && st.focusPanel) { v.focus(); v.select && v.select(); st.focusPanel = false; }
  }
  function coverPanel(P) {
    const c = st.data.cover || {}; const im = c.image || {};
    P.innerHTML = toHTML(html`<div class="apr-ph"><b>Capa</b></div>
      <div class="field"><label>Foto de fundo</label><div class="apr-slot">${im.doc_id ? html`<img src="${im.doc_id === 'padrao' ? '/img/capa-apresentacao.jpg' : `/api/files/${im.doc_id}?inline=1`}" alt="">` : html`<span class="muted small">Sem foto</span>`}
        <div class="col" style="gap:6px"><button class="btn sm" data-cphoto>${icon('image', 'sm')} Trocar foto</button>${im.doc_id !== 'padrao' ? html`<button class="btn sm ghost" data-cdef>Usar foto dos arquitetos</button>` : ''}</div></div>
        <span class="hint">A foto original não é alterada — só o enquadramento na capa.</span></div>
      <div class="field"><label>Camada branca sobre a foto <span class="muted" data-vv>${Math.round((c.veil ?? 0.7) * 100)}%</span></label><input type="range" min="0" max="90" step="1" value="${Math.round((c.veil ?? 0.7) * 100)}" data-veil></div>
      ${frameControls(im, 'height')}
      <div class="field mt-8"><label>Título</label><input class="input" data-ck="title" value="${c.title ?? 'Apresentação'}"></div>
      <div class="field"><label>Nome do projeto na capa</label><input class="input" data-ck="subtitle" value="${c.subtitle ?? st.data.project_name ?? ''}"><span class="hint">Muda só nesta apresentação — o cadastro do projeto continua igual.</span></div>
      ${advanced()}`);
    let first = true;
    P.querySelector('[data-veil]').oninput = (e) => { change((d) => { d.cover.veil = Number(e.target.value) / 100; }, { snapshot: first, render: 'stage' }); first = false; P.querySelector('[data-vv]').textContent = `${e.target.value}%`; };
    P.querySelector('[data-veil]').onchange = () => { first = true; thumbs(); };
    bindFrame(P, (fn, snap) => change((d) => { d.cover.image = d.cover.image || {}; fn(d.cover.image); }, { snapshot: snap, render: 'stage' }));
    $$('[data-ck]', P).forEach((i) => { let f = true; i.oninput = () => { change((d) => { d.cover[i.dataset.ck] = i.value; }, { snapshot: f, render: 'stage' }); f = false; }; i.onchange = () => { f = true; thumbs(); }; });
    P.querySelector('[data-cphoto]').onclick = () => pickImages({ single: true, title: 'Foto da capa', onPick: ([id]) => change((d) => { d.cover.image = { doc_id: id, fy: 50, zoom: 1 }; }) });
    const df = P.querySelector('[data-cdef]'); if (df) df.onclick = () => { change((d) => { d.cover.image = { doc_id: 'padrao', fy: 85, zoom: 1.05 }; }); ensureAsset('padrao'); };
    bindAdvanced(P);
  }
  function frameControls(im, defFit) {
    return html`<details class="more-details" ${im.zoom > 1 || (im.fx !== undefined && im.fx !== 50) ? 'open' : ''}><summary>Enquadramento</summary><div class="col mt-8" style="gap:10px">
      ${defFit !== 'height' ? html`<div class="seg sm" data-fit><button type="button" data-v="contain" class="${(im.fit || defFit) === 'contain' ? 'on' : ''}">Imagem inteira</button><button type="button" data-v="cover" class="${(im.fit || defFit) === 'cover' ? 'on' : ''}">Preencher a área</button></div>` : ''}
      <label class="small">Zoom <input type="range" min="1" max="3" step="0.01" value="${im.zoom || 1}" data-fr="zoom"></label>
      <label class="small">Horizontal <input type="range" min="0" max="100" step="1" value="${im.fx ?? 50}" data-fr="fx"></label>
      <label class="small">Vertical <input type="range" min="0" max="100" step="1" value="${im.fy ?? 50}" data-fr="fy"></label>
      <button class="btn xs ghost" type="button" data-frreset>Restaurar enquadramento</button></div></details>`;
  }
  function bindFrame(P, apply) {
    $$('[data-fr]', P).forEach((r) => { let f = true; r.oninput = () => { apply((im) => { im[r.dataset.fr] = Number(r.value); }, f); f = false; }; r.onchange = () => { f = true; thumbs(); }; });
    $$('[data-fit] button', P).forEach((b) => (b.onclick = () => { apply((im) => { im.fit = b.dataset.v; }, true); panel(); thumbs(); }));
    const rs = P.querySelector('[data-frreset]'); if (rs) rs.onclick = () => { apply((im) => { delete im.zoom; delete im.fx; delete im.fy; }, true); panel(); thumbs(); };
  }
  function slidePanel(P, s) {
    const slots = s.layout === '2' ? 2 : 1; const sel = st.slot || 0; const im = (s.images || [])[sel] || {};
    const rooms = [...new Set([...meta.rooms.project, ...meta.rooms.all])];
    P.innerHTML = toHTML(html`<div class="apr-ph"><b>${s.kind === 'planta' ? 'Planta de layout' : `Página ${pad(st.slide + 1)}`}</b></div>
      <div class="field"><label>${s.kind === 'planta' ? 'Texto do rodapé' : 'Ambiente'}</label><span data-room></span>${s.kind !== 'planta' ? html`<button class="btn xs ghost mt-4" data-newroom>${icon('plus', 'sm')} Adicionar ambiente</button>` : ''}</div>
      <div class="field"><label>Layout da página</label><div class="apr-layouts">${[['1', '1 imagem'], ['2', '2 imagens'], ['texto', 'Imagem + observação']].map(([k, l]) => html`<button type="button" data-layout="${k}" class="${(s.layout || '1') === k ? 'on' : ''}"><span class="lay lay-${k}"><i></i><i></i></span>${l}</button>`)}</div></div>
      <div class="field"><label>Imagem${slots > 1 ? 'ns' : ''}</label>${Array.from({ length: slots }, (_, k) => { const x = (s.images || [])[k]; return html`<div class="apr-slot ${k === sel && slots > 1 ? 'on' : ''}" data-slot="${k}">${x && x.doc_id ? html`<img src="/api/files/${x.doc_id}?inline=1" alt="">` : html`<span class="muted small">${s.kind === 'planta' ? 'Planta pendente' : 'Sem imagem'}</span>`}
        <div class="col" style="gap:6px"><button class="btn sm" data-pick="${k}">${icon('image', 'sm')} ${x && x.doc_id ? 'Substituir' : 'Escolher'}</button>${x && x.doc_id ? html`<button class="btn sm ghost" data-rm="${k}">Remover</button>` : ''}</div></div>`; })}
        ${(s.images || []).length > slots && (s.images || []).slice(slots).some((x) => x && x.doc_id) ? html`<p class="small muted">${(s.images || []).slice(slots).filter((x) => x && x.doc_id).length} imagem(ns) guardada(s) nesta página — voltam ao escolher “2 imagens”.</p>` : ''}</div>
      ${im.doc_id ? frameControls(im, s.layout === '2' ? 'cover' : 'contain') : ''}
      ${s.layout === 'texto' ? html`<div class="field mt-8"><label>Observação da página</label><textarea class="input" rows="4" data-text placeholder="Ex.: Painel em madeira freijó com iluminação indireta">${s.text || ''}</textarea></div>` : ''}
      ${s.review ? html`<div class="note-box info mt-8">${icon('alert', 'sm')}<div>A imagem foi trocada. Confira se as marcações continuam no lugar certo. <button class="btn xs mt-4" data-reviewed>Marcações conferidas</button></div></div>` : ''}
      ${(s.annotations || []).length ? html`<div class="field mt-8"><label>Marcações nesta página</label><div class="list">${s.annotations.map((a, i) => html`<button type="button" class="list-item apr-annrow" data-selann="${i}"><span>${{ medida: 'Medida', observacao: 'Observação', seta: 'Seta', texto: 'Texto' }[a.type]}</span><span class="muted small grow">${a.type === 'medida' ? `${a.value || '—'} ${a.unit || 'm'}` : a.text || ''}</span></button>`)}</div></div>` : ''}
      ${advanced()}`);
    const rc = combo({ name: 'room', options: rooms.map((r) => ({ id: r, label: r })).concat(s.room && !rooms.includes(s.room) ? [{ id: s.room, label: s.room }] : []), value: s.room || '', placeholder: 'Escolher ambiente…',
      onChange: (v) => { change((d) => { d.slides[st.slide].room = v || ''; }); } });
    if (s.kind === 'planta') { const i = el(html`<input class="input" value="${s.room || 'Planta de layout'}">`); let f = true; i.oninput = () => { change((d) => { d.slides[st.slide].room = i.value; }, { snapshot: f, render: 'stage' }); f = false; }; i.onchange = () => { f = true; thumbs(); }; P.querySelector('[data-room]').appendChild(i); }
    else P.querySelector('[data-room]').appendChild(rc);
    const nr = P.querySelector('[data-newroom]'); if (nr) nr.onclick = () => askRoom((name) => change((d) => { d.slides[st.slide].room = name; }));
    $$('[data-layout]', P).forEach((b) => (b.onclick = () => {
      const k = b.dataset.layout; const had = (s.images || []).filter((x) => x && x.doc_id).length;
      change((d) => { d.slides[st.slide].layout = k; });
      if (k !== '2' && had > 1) toast('A segunda imagem continua guardada nesta página e volta ao escolher “2 imagens”.', { ms: 5000 });
      st.slot = 0; panel();
    }));
    $$('[data-slot]', P).forEach((x) => (x.onclick = (e) => { if (e.target.closest('button')) return; st.slot = +x.dataset.slot; panel(); }));
    $$('[data-pick]', P).forEach((b) => (b.onclick = () => { const k = +b.dataset.pick; pickImages({ single: true, title: s.kind === 'planta' ? 'Planta de layout' : 'Imagem da página', onPick: ([id]) => change((d) => { const sl = d.slides[st.slide]; sl.images = sl.images || []; const had = sl.images[k] && sl.images[k].doc_id; sl.images[k] = { doc_id: id }; if (had && (sl.annotations || []).some((a) => (a.img || 0) === k)) sl.review = true; }) }); }));
    $$('[data-rm]', P).forEach((b) => (b.onclick = () => { const k = +b.dataset.rm; change((d) => { const sl = d.slides[st.slide]; sl.images[k] = null; }); panel(); }));
    if (im.doc_id) bindFrame(P, (fn, snap) => change((d) => { fn(d.slides[st.slide].images[sel]); }, { snapshot: snap, render: 'stage' }));
    const tx = P.querySelector('[data-text]'); if (tx) { let f = true; tx.oninput = () => { change((d) => { d.slides[st.slide].text = tx.value; }, { snapshot: f, render: 'stage' }); f = false; }; tx.onchange = () => { f = true; thumbs(); }; }
    const rv = P.querySelector('[data-reviewed]'); if (rv) rv.onclick = () => { change((d) => { delete d.slides[st.slide].review; }); };
    $$('[data-selann]', P).forEach((b) => (b.onclick = () => { st.ann = +b.dataset.selann; st.tool = 'select'; paint(); }));
    bindAdvanced(P);
  }
  function advanced() {
    return html`<details class="more-details mt-16"><summary>Mais detalhes da apresentação</summary><div class="form-grid mt-8">
      <div class="field"><label>Código no cabeçalho</label><input class="input" data-adv="code" value="${st.data.code || ''}"></div>
      <div class="field"><label>Número</label><input class="input" type="number" min="1" max="999" data-num value="${st.pres.number}"></div>
      <div class="field wide"><label>Nome do projeto (só nesta apresentação)</label><input class="input" data-adv="project_name" value="${st.data.project_name || ''}"></div></div>
      <p class="small muted">O número da apresentação é independente do número das páginas e do código do projeto.</p></details>`;
  }
  function bindAdvanced(P) {
    $$('[data-adv]', P).forEach((i) => { let f = true; i.oninput = () => { change((d) => { d[i.dataset.adv] = i.value; }, { snapshot: f, render: 'stage' }); f = false; }; i.onchange = () => { f = true; thumbs(); }; });
    const n = P.querySelector('[data-num]'); if (n) n.onchange = () => renumber(Number(n.value));
  }
  async function renumber(n) {
    await flush();
    try { const r = await api.put(`/presentations/${st.pres.id}`, { rev: st.pres.rev, number: n }); toast(`Agora é a ${r.title}.`); location.reload(); } catch (e) { fail(e); panel(); }
  }
  function askRoom(cb) {
    const m = modal({ title: 'Adicionar ambiente', body: html`<div class="field"><label>Nome do ambiente</label><input class="input" id="rn" placeholder="Ex.: Sala de TV"></div>${isManager() ? html`<label class="check small mt-8"><input type="checkbox" id="rs" checked> Guardar na lista de ambientes do escritório</label>` : ''}`,
      actions: [{ label: 'Cancelar' }, { label: 'Adicionar', primary: true, fn: async (mm) => {
        const name = mm.querySelector('#rn').value.trim(); if (!name) { toast('Informe o nome.', { error: true }); return false; }
        const keep = mm.querySelector('#rs'); if (keep && keep.checked) { try { await api.post('/admin/options', { kind: 'ambiente', name }); } catch (e) { /* lista é opcional */ } }
        meta.rooms.project.push(name); cb(name);
      } }] });
    return m;
  }

  // ---------------- escolher / enviar imagens (várias de uma vez)
  async function ensureAsset(id) { if (st.assets[id]) return; try { st.assets[id] = await api.get(`/presentations/${st.pres.id}/images/${id}`); } catch (e) { fail(e); } paint(); }
  function pickImages({ single = false, title = 'Adicionar imagens', onPick, bulk = false }) {
    let chosen = []; let room = ''; let perPage = true;
    const body = el(html`<div class="apr-picker">
      <div class="row wrap gap-8"><label class="btn primary">${icon('upload', 'sm')} Enviar do computador ou celular<input type="file" accept="image/jpeg,image/png" ${single ? '' : 'multiple'} hidden data-file></label>
        <span class="small muted">JPEG ou PNG. As imagens ficam guardadas nos arquivos do projeto.</span></div>
      <div data-up class="apr-uploads"></div>
      <div class="section-title" style="margin-top:14px">Imagens do projeto</div>
      <div class="apr-lib" data-lib>${meta.images.length ? meta.images.map((d) => html`<button type="button" data-doc="${d.id}" title="${d.title}"><img src="/api/files/${d.id}?inline=1" loading="lazy" alt=""><span>${d.title}</span></button>`) : html`<div class="muted small">Nenhuma imagem no projeto ainda.</div>`}</div>
      ${bulk ? html`<div class="form-grid mt-16"><div class="field"><label>Ambiente para estas imagens (opcional)</label><span data-broom></span></div>
        <div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" data-pp checked> Criar uma página por imagem</label></div></div>` : ''}
    </div>`);
    const lib = body.querySelector('[data-lib]');
    const toggle = (id) => { id = Number(id); if (single) chosen = [id]; else chosen = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]; $$('[data-doc]', lib).forEach((b) => { const k = chosen.indexOf(Number(b.dataset.doc)); b.classList.toggle('on', k >= 0); b.dataset.n = k >= 0 && !single ? k + 1 : ''; }); };
    lib.onclick = (e) => { const b = e.target.closest('[data-doc]'); if (b) toggle(b.dataset.doc); };
    if (bulk) { const rooms = [...new Set([...meta.rooms.project, ...meta.rooms.all])]; body.querySelector('[data-broom]').appendChild(combo({ name: 'br', options: rooms.map((r) => ({ id: r, label: r })), placeholder: 'Definir depois', onChange: (v) => { room = v || ''; } })); body.querySelector('[data-pp]').onchange = (e) => { perPage = e.target.checked; }; }
    // envio com progresso por arquivo; só os que falharem podem ser reenviados
    const upBox = body.querySelector('[data-up]');
    const send = (file, row) => new Promise((resolve) => {
      const fd = new FormData(); fd.append('files', file); fd.append('project_id', String(projectId)); fd.append('category', 'Imagens / renders');
      const x = new XMLHttpRequest(); x.open('POST', '/api/files'); x.setRequestHeader('X-Requested-With', 'cnij');
      x.upload.onprogress = (ev) => { if (ev.lengthComputable) row.querySelector('i').style.width = `${Math.round((ev.loaded / ev.total) * 100)}%`; };
      x.onload = () => { let d = null; try { d = JSON.parse(x.responseText); } catch { /* */ }
        if (x.status < 300 && d && d.ids) { row.classList.add('ok'); row.querySelector('em').textContent = 'Enviada'; resolve(d.rows[0]); }
        else { row.classList.add('err'); row.querySelector('em').innerHTML = toHTML(html`${(d && d.error) || 'Falhou'} · <button class="link" type="button">tentar de novo</button>`); row.querySelector('button').onclick = () => { row.classList.remove('err'); send(file, row).then(resolve); }; } };
      x.onerror = () => { row.classList.add('err'); row.querySelector('em').innerHTML = toHTML(html`Sem conexão · <button class="link" type="button">tentar de novo</button>`); row.querySelector('button').onclick = () => { row.classList.remove('err'); send(file, row).then(resolve); }; };
      x.send(fd);
    });
    body.querySelector('[data-file]').onchange = async (e) => {
      const files = Array.from(e.target.files || []); e.target.value = '';
      const ok = files.filter((f) => /image\/(jpeg|png)/.test(f.type)); if (ok.length < files.length) toast('Algumas imagens foram ignoradas: use JPEG ou PNG.', { error: true });
      await Promise.all(ok.map(async (f) => {
        const row = el(html`<div class="apr-uprow"><span>${f.name}</span><b><i></i></b><em>Enviando…</em></div>`); upBox.appendChild(row);
        const d = await send(f, row);
        if (d) { meta.images.unshift({ id: d.id, title: d.title, mime: d.mime }); const b = el(html`<button type="button" data-doc="${d.id}" title="${d.title}"><img src="/api/files/${d.id}?inline=1" alt=""><span>${d.title}</span></button>`); lib.querySelector('.muted') && lib.querySelector('.muted').remove(); lib.prepend(b); toggle(d.id); }
      }));
    };
    const m = modal({ title, body, actions: [{ label: 'Cancelar' }, { label: single ? 'Usar imagem' : 'Adicionar', primary: true, fn: async () => {
      if (!chosen.length) { toast('Escolha ao menos uma imagem.', { error: true }); return false; }
      await Promise.all(chosen.map((id) => (st.assets[id] ? null : api.get(`/presentations/${st.pres.id}/images/${id}`).then((a) => { st.assets[id] = a; }).catch(() => null))));
      const valid = chosen.filter((id) => st.assets[id]);
      if (valid.length < chosen.length) toast('Algumas imagens não puderam ser usadas (formato não suportado).', { error: true });
      if (valid.length) onPick(valid, { room, perPage });
    } }] });
    m.el.classList.add('wide'); m.el.style.width = 'min(860px, calc(100vw - 24px))';
  }
  $('[data-addpage]').onclick = () => pickImages({ bulk: true, title: 'Adicionar páginas', onPick: (ids, { room, perPage }) => {
    change((d) => {
      // se a planta ainda estiver vazia, a primeira imagem escolhida não é colocada nela automaticamente (pode não ser a planta)
      if (perPage) ids.forEach((id) => d.slides.push({ id: rid(), kind: 'ambiente', room, layout: '1', images: [{ doc_id: id }] }));
      else { const sl = d.slides[st.slide]; if (sl && sl.kind !== 'capa') { sl.images = sl.images || []; ids.forEach((id) => { const k = sl.images.findIndex((x) => !x || !x.doc_id); if (k >= 0) sl.images[k] = { doc_id: id }; else sl.images.push({ doc_id: id }); }); if (sl.images.filter((x) => x && x.doc_id).length > 1) sl.layout = '2'; } else ids.forEach((id) => d.slides.push({ id: rid(), kind: 'ambiente', room, layout: '1', images: [{ doc_id: id }] })); }
    });
    st.slide = perPage ? slides().length - 1 : st.slide; paint();
    toast(perPage ? `${ids.length} página(s) criada(s) no modelo do escritório.` : 'Imagens adicionadas à página.');
  } });

  // ---------------- ferramentas na imagem (medida, seta, observação, texto)
  const svgPt = (e) => { const svg = $('[data-stage] svg'); const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  const hit = (pt) => st.placed.findIndex((p) => p.rect && pt.x >= p.rect.x && pt.x <= p.rect.x + p.rect.w && pt.y >= p.rect.y && pt.y <= p.rect.y + p.rect.h);
  const rel = (pt, k) => { const r = st.placed[k].rect; return { x: Math.max(0, Math.min(1, (pt.x - r.x) / r.w)), y: Math.max(0, Math.min(1, (pt.y - r.y) / r.h)) }; };
  let drag = null;
  const stageEl = $('[data-stage]');
  stageEl.addEventListener('pointerdown', (e) => {
    if (curSlide().kind === 'capa' || !$('[data-stage] svg')) return;
    const pt = svgPt(e); const h = e.target.closest('[data-h]'); const g = e.target.closest('[data-ann]');
    if (st.tool === 'select') {
      if (h && st.ann !== null) { drag = { mode: 'handle', h: h.dataset.h, start: pt, snap: false }; }
      else if (g) { st.ann = +g.dataset.ann; drag = { mode: 'move', start: pt, snap: false }; paint(); }
      else { if (st.ann !== null) { st.ann = null; paint(); } return; }
      stageEl.setPointerCapture(e.pointerId); e.preventDefault(); return;
    }
    const k = hit(pt); if (k < 0) { toast('Clique dentro da imagem.', { error: true }); return; }
    const p = rel(pt, k);
    if (st.tool === 'medida' || st.tool === 'seta') {
      change((d) => { const sl = d.slides[st.slide]; sl.annotations = sl.annotations || []; sl.annotations.push(st.tool === 'medida' ? { type: 'medida', img: k, x1: p.x, y1: p.y, x2: p.x, y2: p.y, value: '', unit: 'm', color: '#1F1F1F', stroke: 1.4, size: 11 } : { type: 'seta', img: k, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: '#B23A2E', stroke: 1.4 }); st.ann = sl.annotations.length - 1; }, { render: 'stage' });
      drag = { mode: 'create', img: k }; stageEl.setPointerCapture(e.pointerId); e.preventDefault();
    } else {
      change((d) => { const sl = d.slides[st.slide]; sl.annotations = sl.annotations || [];
        sl.annotations.push(st.tool === 'observacao' ? { type: 'observacao', img: k, x: Math.min(0.7, p.x + 0.06), y: Math.max(0, p.y - 0.16), w: 0.28, text: '', ax: p.x, ay: p.y, color: '#1F1F1F', stroke: 1, size: 11 } : { type: 'texto', img: k, x: p.x, y: p.y, w: 0.3, text: '', color: '#1F1F1F', size: 13 });
        st.ann = sl.annotations.length - 1; });
      st.tool = 'select'; st.focusPanel = true; paint();
    }
  });
  stageEl.addEventListener('pointermove', (e) => {
    if (!drag) return; const sl = curSlide(); const a = sl.annotations && sl.annotations[st.ann]; if (!a) return;
    const pt = svgPt(e); const r = st.placed[a.img || 0] && st.placed[a.img || 0].rect; if (!r) return;
    const p = { x: Math.max(0, Math.min(1, (pt.x - r.x) / r.w)), y: Math.max(0, Math.min(1, (pt.y - r.y) / r.h)) };
    const snap = !drag.snap; drag.snap = true;
    if (drag.mode === 'create') change((d) => { const x = d.slides[st.slide].annotations[st.ann]; x.x2 = p.x; x.y2 = p.y; }, { snapshot: false, render: 'stage' });
    else if (drag.mode === 'handle') change((d) => { const x = d.slides[st.slide].annotations[st.ann]; if (drag.h === '0') { x.x1 = p.x; x.y1 = p.y; } else if (drag.h === '1') { x.x2 = p.x; x.y2 = p.y; } else if (drag.h === 'a') { x.ax = p.x; x.ay = p.y; } else if (drag.h === 'w') { x.w = Math.max(0.08, Math.min(1, p.x - x.x)); } }, { snapshot: snap, render: 'stage' });
    else if (drag.mode === 'move') {
      const dx = (pt.x - drag.start.x) / r.w; const dy = (pt.y - drag.start.y) / r.h; drag.start = pt;
      change((d) => { const x = d.slides[st.slide].annotations[st.ann]; const mv = (k, v) => { if (x[k] !== undefined) x[k] = Math.max(0, Math.min(1, x[k] + v)); }; ['x', 'x1', 'x2'].forEach((k) => mv(k, dx)); ['y', 'y1', 'y2'].forEach((k) => mv(k, dy)); }, { snapshot: snap, render: 'stage' });
    }
  });
  const endDrag = () => {
    if (!drag) return; const was = drag; drag = null;
    if (was.mode === 'create') {
      const a = curSlide().annotations[st.ann]; const r = st.placed[a.img || 0].rect; const len = Math.hypot((a.x2 - a.x1) * r.w, (a.y2 - a.y1) * r.h);
      if (len < 8) { change((d) => d.slides[st.slide].annotations.splice(st.ann, 1), { snapshot: false }); st.ann = null; toast('Arraste entre os dois pontos para criar a marcação.'); paint(); return; }
      st.tool = 'select'; st.focusPanel = a.type === 'medida';
    }
    paint();
  };
  stageEl.addEventListener('pointerup', endDrag); stageEl.addEventListener('pointercancel', endDrag);
  $$('[data-tool]', root).forEach((b) => (b.onclick = () => { if (curSlide().kind === 'capa' && b.dataset.tool !== 'select') { toast('As marcações são feitas nas páginas com imagem.'); return; } st.tool = b.dataset.tool; st.ann = null; paint(); }));
  const undo = () => { if (!st.undo.length) return; st.redo.push(clone(st.data)); st.data = st.undo.pop(); st.ann = null; st.dirty = true; paint(); scheduleSave(); };
  const redo = () => { if (!st.redo.length) return; st.undo.push(clone(st.data)); st.data = st.redo.pop(); st.ann = null; st.dirty = true; paint(); scheduleSave(); };
  $('[data-undo]').onclick = undo; $('[data-redo]').onclick = redo;
  const onKey = (e) => {
    if (!document.body.contains(root)) return;
    const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(true); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && st.ann !== null) { e.preventDefault(); change((d) => d.slides[st.slide].annotations.splice(st.ann, 1)); st.ann = null; paint(); }
    else if (e.key === 'Escape' && st.tool !== 'select') { st.tool = 'select'; paint(); }
  };
  document.addEventListener('keydown', onKey);

  // ---------------- formato, salvar, visualizar, PDF, publicar, compartilhar
  $$('[data-format] button', root).forEach((b) => (b.onclick = () => { if (st.data.format === b.dataset.v) return; change((d) => { d.format = b.dataset.v; }); toast(`Formato ${SC.FORMATS[b.dataset.v].label}: os elementos foram reorganizados sem esticar as imagens.`); }));
  $('[data-save]').onclick = async () => { await save(true); if (!st.error) toast('Apresentação salva.'); };
  $('[data-view]').onclick = () => slideshow();
  $('[data-pdf]').onclick = async (e) => {
    const b = e.currentTarget; await flush(); if (st.error) return toast('Salve as alterações antes de exportar.', { error: true });
    b.disabled = true; const old = b.innerHTML; b.innerHTML = 'Gerando PDF…';
    try {
      const r = await fetch(`/api/presentations/${st.pres.id}/pdf`, { headers: { 'X-Requested-With': 'cnij' }, credentials: 'same-origin' });
      if (!r.ok) { let m = 'Não foi possível gerar o PDF.'; try { m = (await r.json()).error || m; } catch { /* */ } throw new Error(m); }
      const blob = await r.blob(); const name = decodeURIComponent((r.headers.get('content-disposition') || '').match(/filename\*=UTF-8''([^;]+)/)?.[1] || 'apresentacao.pdf');
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      toast(`PDF baixado: ${name}`);
    } catch (err) { fail(err); }
    b.disabled = false; b.innerHTML = old;
  };
  const pb = $('[data-publish]'); if (pb) pb.onclick = async () => {
    await flush(); if (st.error) return toast('Salve as alterações antes de publicar.', { error: true });
    const w = warnings();
    if (!(await confirmDialog(`${w.length ? `Pendências: ${w.slice(0, 4).join('; ')}. ` : ''}Publicar a ${st.pres.title} no portal do cliente? Ela aparece em “Veja seu projeto” com PDF para visualizar e baixar.${st.pres.status === 'publicada' ? ' A versão anterior fica guardada no histórico.' : ''}`, { title: 'Publicar no portal', ok: 'Publicar' }))) return;
    pb.disabled = true; pb.textContent = 'Publicando…';
    try { const r = await api.post(`/presentations/${st.pres.id}/publish`); Object.assign(st.pres, { status: r.status, published_version: r.published_version, has_unpublished: false, published_doc_id: r.published_doc_id }); toast(`Publicada no portal (versão ${r.version}).`); const i = list.find((x) => x.id === st.pres.id); if (i) i.status = 'publicada'; }
    catch (err) { fail(err); }
    pb.disabled = false; pb.innerHTML = toHTML(html`${icon('upload', 'sm')} Publicar no portal`); pub();
  };
  $('[data-share]').onclick = async () => {
    let d; try { d = await api.get(`/presentations/${st.pres.id}/share`); } catch (e) { return fail(e); }
    const m = modal({ title: 'Compartilhar pelo WhatsApp', body: html`${!d.has_portal_user ? html`<div class="note-box info mb-8">${icon('alert', 'sm')}<div>Este cliente ainda não tem acesso à Área do Cliente. Crie o acesso em Clientes antes de enviar o link.</div></div>` : ''}
      <div class="field"><label>Mensagem (você pode editar)</label><textarea class="input" rows="7" id="wm" data-raw>${d.message}</textarea></div>
      <p class="small muted">O WhatsApp abre com a mensagem pronta para você conferir e enviar. O link leva à apresentação publicada, com login do cliente.</p>`,
    actions: [{ label: 'Cancelar' }, { label: 'Copiar mensagem', fn: async (mm) => { const { copyText } = await import('../lib.js'); toast((await copyText(mm.querySelector('#wm').value)) ? 'Mensagem copiada.' : 'Não foi possível copiar.'); return false; } },
      { label: 'Abrir WhatsApp', primary: true, fn: async (mm) => { window.open(`https://wa.me/${d.phone}?text=${encodeURIComponent(mm.querySelector('#wm').value)}`, '_blank', 'noopener'); api.post(`/presentations/${st.pres.id}/shared`).catch(() => {}); } }] });
    m.el.style.width = 'min(560px, calc(100vw - 24px))';
  };
  $('[data-ren]').onclick = () => {
    modal({ title: 'Renomear apresentação', body: html`<div class="field"><label>Nome</label><input class="input" id="rt" value="${st.pres.title}"></div><p class="small muted">O número (${pad(st.pres.number)}) continua o mesmo; para mudar o número, use “Mais detalhes da apresentação”.</p>`,
      actions: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, fn: async (mm) => { await flush(); const r = await api.put(`/presentations/${st.pres.id}`, { rev: st.pres.rev, title: mm.querySelector('#rt').value }); st.pres.rev = r.rev; st.pres.title = r.title; const i = list.find((x) => x.id === st.pres.id); if (i) i.title = r.title; toast('Nome atualizado.'); location.reload(); } }] });
  };
  $('[data-dup]').onclick = async () => { await flush(); try { const r = await api.post(`/presentations/${st.pres.id}/duplicate`); toast(`${r.title} criada como cópia independente.`); go(r.id); } catch (e) { fail(e); } };
  $('[data-more]').onclick = (e) => menu(e.currentTarget, [
    { label: 'Versões publicadas', icon: 'clock', fn: versionsDlg },
    st.pres.status === 'publicada' && isManager() ? { label: 'Retirar do portal', icon: 'eye', fn: async () => { if (!(await confirmDialog('Retirar esta apresentação do portal do cliente? O histórico de versões é mantido.', { ok: 'Retirar' }))) return; await api.post(`/presentations/${st.pres.id}/unpublish`); location.reload(); } } : null,
    '-', { label: 'Arquivar apresentação', icon: 'archive', fn: async () => { if (!(await confirmDialog('Arquivar esta apresentação? Ela sai da lista, mas nada é apagado.', { ok: 'Arquivar' }))) return; await flush(); await api.post(`/presentations/${st.pres.id}/archive`, { archived: 1 }); ctx.go(`#/apresentacoes?projeto=${projectId}`); } },
    { label: 'Ver arquivadas', icon: 'archive', fn: archivedDlg }]);
  async function versionsDlg() {
    const v = await api.get(`/presentations/${st.pres.id}/versions`);
    const m = modal({ title: 'Versões publicadas', body: v.length ? html`<div class="list">${v.map((x) => html`<div class="list-item"><div class="grow"><div class="li-title">Versão ${x.version}</div><div class="li-sub">${datetime(x.created_at)}${x.user_name ? ' · ' + x.user_name : ''}</div></div>
        ${x.doc_id ? html`<a class="btn xs" href="/api/files/${x.doc_id}?inline=1" target="_blank" rel="noopener">Ver PDF</a>` : ''}<button class="btn xs" data-rest="${x.id}">Restaurar como rascunho</button></div>`)}</div>` : html`<div class="muted small">Ainda não houve publicação. As versões aparecem a cada publicação no portal.</div>`, actions: [{ label: 'Fechar' }] });
    $$('[data-rest]', m.el).forEach((b) => (b.onclick = async () => { if (!(await confirmDialog('Trazer esta versão de volta para edição? O rascunho atual é substituído (a versão publicada não muda até você publicar).', { ok: 'Restaurar' }))) return; await flush(); await api.post(`/presentations/${st.pres.id}/versions/${b.dataset.rest}/restore`); location.reload(); }));
  }
  async function archivedDlg() {
    const all = await api.get(`/presentations?project_id=${projectId}&archived=1`); const arq = all.filter((x) => x.archived);
    const m = modal({ title: 'Apresentações arquivadas', body: arq.length ? html`<div class="list">${arq.map((x) => html`<div class="list-item"><div class="grow"><div class="li-title">${x.title}</div><div class="li-sub">${datetime(x.updated_at)}</div></div><button class="btn xs" data-unarch="${x.id}">Restaurar</button></div>`)}</div>` : html`<div class="muted small">Nenhuma apresentação arquivada.</div>`, actions: [{ label: 'Fechar' }] });
    $$('[data-unarch]', m.el).forEach((b) => (b.onclick = async () => { try { await api.post(`/presentations/${b.dataset.unarch}/archive`, { archived: 0 }); go(Number(b.dataset.unarch)); } catch (e) { fail(e); } }));
  }
  function slideshow() {
    let i = st.slide; const a = A(); const d = D();
    const ov = el('<div class="apr-show" tabindex="0"><div class="apr-show-s"></div><div class="apr-show-bar"><button data-p>‹</button><span data-n></span><button data-nx>›</button><button data-x>Fechar</button></div></div>');
    const draw = () => { ov.querySelector('.apr-show-s').innerHTML = SC.slideSvg(d, i, a); const svg = ov.querySelector('svg'); svg.removeAttribute('width'); svg.removeAttribute('height'); ov.querySelector('[data-n]').textContent = `${pad(i + 1)} / ${pad(slides().length)}`; };
    const close = () => { document.removeEventListener('keydown', k); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); ov.remove(); };
    const k = (e) => { if (e.key === 'ArrowRight' || e.key === ' ') { i = Math.min(slides().length - 1, i + 1); draw(); } if (e.key === 'ArrowLeft') { i = Math.max(0, i - 1); draw(); } if (e.key === 'Escape') close(); };
    ov.querySelector('[data-p]').onclick = () => { i = Math.max(0, i - 1); draw(); }; ov.querySelector('[data-nx]').onclick = () => { i = Math.min(slides().length - 1, i + 1); draw(); }; ov.querySelector('[data-x]').onclick = close;
    document.addEventListener('keydown', k); document.body.appendChild(ov); draw(); ov.requestFullscreen && ov.requestFullscreen().catch(() => {});
  }

  paint();
  if (st.dirty) scheduleSave();
}
const rid = () => Math.random().toString(36).slice(2, 10);
