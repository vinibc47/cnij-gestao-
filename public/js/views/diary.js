// =====================================================================
// Diário de obra — lista de registros e tela "Atualizar obra".
// Mais toque, menos digitação: serviços, equipe, fotos e pendências por seleção.
// O mesmo registro aparece na obra, aqui e (se publicado) na Área do Cliente.
// =====================================================================
import { S, api, html, raw, el, toHTML, icon, toast, fail, modal, menu, combo, refOptions, confirmDialog, date, datetime, today, isManager, label, $$, debounce } from '../lib.js';

const SV = [['iniciado', 'Iniciado'], ['em_andamento', 'Em andamento'], ['concluido', 'Concluído'], ['impedido', 'Impedido']];
const SVL = Object.fromEntries(SV);
const KINDS = [['visita', 'Visita técnica'], ['registro', 'Atualização da obra'], ['problema', 'Ocorrência'], ['outro', 'Outro']];
const rid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const longDate = (d) => { const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${Number(dd)} de ${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][Number(m) - 1]} de ${y}`; };
const cleanImg = (svg) => raw(`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`);
const ICONS = { camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', check: '<path d="M20 6 9 17l-5-5"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>' };
// ícone do serviço pelo nome (só visual)
const svcIcon = (n) => {
  const s = String(n || '').toLowerCase();
  const k = /demol|remo|retir/.test(s) ? 'hammer' : /el[eé]tr|ilumin/.test(s) ? 'sun' : /hidr|banh|lou[cç]/.test(s) ? 'refresh' : /pint/.test(s) ? 'edit' : /gesso|forro/.test(s) ? 'grid' : /piso|revest|porcel/.test(s) ? 'kanban' : /marcen|m[oó]ve/.test(s) ? 'frame' : /limp/.test(s) ? 'star' : 'helmet';
  return icon(k);
};

export default async function (ctx) {
  const sec = ctx.params[0] || '';
  const root = el('<div class="dy"></div>'); ctx.root.appendChild(root);
  if (sec === 'novo' || Number(sec)) return form(ctx, root, sec === 'novo' ? null : Number(sec));
  return listView(ctx, root);
}

// ------------------------------------------------------------------ lista
async function listView(ctx, root) {
  const q = ctx.query; const f = { work_id: q.obra || '', from: q.de || '', to: q.ate || '', status: q.situacao || '' };
  const works = await api.get('/diary/works');
  root.innerHTML = toHTML(html`<div class="page-head"><div><h1>Diário de obra</h1><div class="sub">Visitas, serviços, fotos e próximos passos de cada obra — publique para o cliente quando quiser.</div></div>
      <div class="row wrap"><button class="btn primary" data-new>${icon('plus')} Atualizar obra</button></div></div>
    <div class="card dy-filters"><span data-w></span>
      <label>De <input type="date" data-k="from" value="${f.from}"></label><label>Até <input type="date" data-k="to" value="${f.to}"></label>
      <div class="chips" data-st>${[['', 'Todos'], ['rascunho', 'Rascunhos'], ['publicado', 'Publicados']].map(([k, l]) => html`<button class="chip ${f.status === k ? 'on' : ''}" data-v="${k}">${l}</button>`)}</div></div>
    <div data-out><div class="empty sm">Carregando…</div></div>`);
  root.querySelector('[data-w]').appendChild(combo({ name: 'w', options: works.map((w) => ({ id: w.id, label: `${w.client_name || w.project_name} · ${w.name}`, sub: w.project_name })), value: f.work_id, placeholder: 'Todas as obras', onChange: (v) => { f.work_id = v || ''; load(); } }));
  $$('[data-k]', root).forEach((i) => (i.onchange = () => { f[i.dataset.k] = i.value; load(); }));
  root.querySelector('[data-st]').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; f.status = b.dataset.v; $$('[data-st] .chip', root).forEach((x) => x.classList.toggle('on', x === b)); load(); };
  root.querySelector('[data-new]').onclick = () => ctx.go(`#/diario/novo${f.work_id ? '?obra=' + f.work_id : ''}`);
  const out = root.querySelector('[data-out]');
  async function load() {
    history.replaceState(null, '', `#/diario?${new URLSearchParams(Object.entries({ obra: f.work_id, de: f.from, ate: f.to, situacao: f.status }).filter(([, v]) => v)).toString()}`);
    let rows; try { rows = await api.get(`/diary?${new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString()}`); } catch (e) { return fail(e); }
    out.innerHTML = toHTML(rows.length ? html`<div class="dy-list">${rows.map((r) => html`<article class="card dy-item" data-id="${r.id}">
        <div class="dy-item-h"><div style="min-width:0"><div class="dy-date">${icon('calendar', 'sm')} ${longDate(r.date)} · ${label('WORK_LOG_KIND', r.kind) || r.kind}</div>
          <div class="cell-title">${r.title || String(r.description || '').slice(0, 90)}</div><div class="cell-sub">${r.client_name || ''} · ${r.project_name} · ${r.work_name}${r.user_name ? ' · ' + r.user_name : ''}</div></div>
          <span class="badge ${r.status === 'publicado' ? 'success' : 'muted'}">${r.status === 'publicado' ? 'Publicado para o cliente' : 'Rascunho · interno'}</span></div>
        ${r.services.length ? html`<div class="dy-svcs">${r.services.map((s) => html`<span class="dy-svc ${s.status}">${s.name} · ${SVL[s.status] || ''}</span>`)}</div>` : ''}
        ${r.thumbs.length ? html`<div class="dy-thumbs">${r.thumbs.map((id) => html`<img src="/api/files/${id}?inline=1" loading="lazy" alt="">`)}${r.photos > r.thumbs.length ? html`<span>+${r.photos - r.thumbs.length}</span>` : ''}</div>` : ''}
        <div class="row wrap gap-8"><a class="btn sm" href="#/diario/${r.id}">${icon('edit', 'sm')} Abrir / editar</a><a class="btn sm ghost" href="#/obras/${r.work_id}?tab=diario">${icon('helmet', 'sm')} Abrir obra</a>
          ${r.status === 'publicado' ? html`<button class="btn sm ghost" data-unpub="${r.id}">Retirar do portal</button>` : html`<button class="btn sm ghost" data-pub="${r.id}">Publicar para o cliente</button>`}</div></article>`)}</div>`
      : html`<div class="empty">${icon('diary')}<div>Nenhum registro ${f.work_id || f.status || f.from ? 'com estes filtros' : 'ainda'}.</div><button class="btn primary mt-16" data-new2>${icon('plus')} Atualizar obra</button></div>`);
    const n2 = out.querySelector('[data-new2]'); if (n2) n2.onclick = () => ctx.go(`#/diario/novo${f.work_id ? '?obra=' + f.work_id : ''}`);
  }
  out.onclick = async (e) => {
    const p = e.target.closest('[data-pub]'); const u = e.target.closest('[data-unpub]');
    try {
      if (p) { await api.post(`/diary/logs/${p.dataset.pub}/publish`); toast('Publicado para o cliente.'); load(); }
      if (u && (await confirmDialog('Retirar este registro da Área do Cliente? Ele continua salvo no diário interno.', { ok: 'Retirar' }))) { await api.post(`/diary/logs/${u.dataset.unpub}/unpublish`); toast('Retirado do portal.'); load(); }
    } catch (err) { fail(err); }
  };
  load();
}

// ------------------------------------------------------------------ formulário "Atualizar obra"
async function form(ctx, root, logId) {
  let log = null;
  if (logId) { try { log = await api.get(`/diary/logs/${logId}`); } catch (e) { return fail(e); } }
  const works = await api.get('/diary/works');
  const fromWork = Number(ctx.query.obra) || null;
  const st = {
    work_id: log ? log.work_id : fromWork || null, ctx: null, saving: false, result: null,
    clientKey: log ? log.client_key || rid() : rid(), saveKey: null,
    v: log ? { date: log.date, kind: log.kind, user_id: log.user_id, title: log.title || '', description: log.description || '', descTouched: true, services: log.services || [], participants: log.participants || [],
      pend_new: [], pend_selected: (log.next_steps || []).slice(), pend_resolved: [], internal_notes: log.internal_notes || '', client_note: log.client_note || '', decisions: log.decisions || '', problems: log.problems || '', phase_changes: [] }
      : { date: today(), kind: 'visita', user_id: S.user.id, title: '', description: '', descTouched: false, services: [], participants: [], pend_new: [], pend_selected: [], pend_resolved: [], internal_notes: '', client_note: '', decisions: '', problems: '', phase_changes: [] },
    photos: log ? log.photos.map((p) => ({ key: `doc${p.id}`, doc: p, caption: p.title, status: 'ok' })) : [], // {key, file, url, caption, status: novo|enviando|ok|erro, doc}
    removed: [], status: log ? log.status : 'novo', rev: log ? log.updated_at : null,
  };
  const DK = () => `diario-rascunho:${logId || 'novo'}:${st.work_id || 0}`;
  const saveDraft = debounce(() => { try { localStorage.setItem(DK(), JSON.stringify({ t: Date.now(), clientKey: st.clientKey, v: st.v, work_id: st.work_id })); } catch { /* */ } }, 500);
  const clearDraft = () => { try { localStorage.removeItem(DK()); } catch { /* */ } };
  let draftRestored = false;
  const tryDraft = () => { try { const d = JSON.parse(localStorage.getItem(DK()) || 'null'); if (d && Date.now() - d.t < 7 * 864e5 && d.work_id === st.work_id) { st.v = d.v; st.clientKey = d.clientKey || st.clientKey; draftRestored = true; } } catch { /* */ } };
  if (!logId) tryDraft();

  async function loadCtx() {
    if (!st.work_id) { st.ctx = null; return; }
    try { st.ctx = await api.get(`/diary/context/${st.work_id}`); } catch (e) { st.ctx = null; fail(e); }
  }
  await loadCtx();
  render();

  function render() {
    const c = st.ctx; const v = st.v;
    const phases = c ? c.phases.filter((p) => !p.archived && p.applicable) : [];
    const selSvc = (pid, name) => v.services.findIndex((s) => (pid ? s.phase_id === pid : !s.phase_id && s.name === name));
    root.innerHTML = toHTML(html`
      <div class="dy-head"><div class="crumbs"><a href="#/diario">Diário de obra</a>${c ? html` ${icon('chevron', 'sm')} <a href="#/obras/${c.work.id}">${c.work.name}</a>` : ''}</div>
        <div class="row between wrap gap-8"><h1>Atualizar obra</h1>${st.status === 'publicado' ? html`<span class="badge success">Publicado para o cliente</span>` : st.status === 'rascunho' ? html`<span class="badge muted">Rascunho · só o escritório vê</span>` : html`<span class="badge muted">Novo registro</span>`}</div>
        <div class="dy-top">
          <div class="dy-work ${!st.work_id ? 'need' : ''}" data-wbox><label>Obra</label><span data-wsel></span>${!st.work_id ? html`<span class="small danger-text">Escolha a obra deste registro.</span>` : ''}</div>
          <div class="dy-date-in"><label>Data</label><input type="date" class="input" data-v="date" value="${v.date}" max="${today()}"></div>
        </div>
        ${c ? html`<div class="dy-links small"><span>${icon('users', 'sm')} ${c.client ? c.client.name : 'Sem cliente'}</span><span>${icon('folder', 'sm')} ${c.project.name}${c.project.code ? ' · ' + c.project.code : ''}</span>
          <span class="grow"></span><button class="link" data-phases>${icon('list', 'sm')} Etapas</button><a class="link" href="#/obras/${c.work.id}?tab=fotos">${icon('image', 'sm')} Fotos e documentos</a>
          <a class="link" href="#/obras/${c.work.id}?tab=orcamentos">${icon('docs', 'sm')} Orçamentos e aprovações</a>${S.user.finance ? html`<a class="link" href="#/financeiro/obras?projeto=${c.project.id}">${icon('wallet', 'sm')} Pagamentos e comprovantes</a>` : ''}</div>` : ''}
      </div>
      ${draftRestored ? html`<div class="draft-note">${icon('edit', 'sm')}<span>Recuperamos o que você estava preenchendo neste aparelho.</span><button type="button" class="btn xs ghost" data-discard>Descartar</button></div>` : ''}
      ${!c ? html`<div class="card dy-empty">${icon('helmet')}<div>Escolha a obra acima para registrar a atualização.</div></div>` : html`
      <div class="dy-form">
        <section class="card dy-sec"><div class="dy-row2"><div><label class="dy-l">Tipo de registro</label><div class="seg sm" data-kind>${KINDS.map(([k, l]) => html`<button type="button" data-v="${k}" class="${v.kind === k ? 'on' : ''}">${l}</button>`)}</div></div>
          <div><label class="dy-l">Responsável</label><select class="input" data-v="user_id">${S.meta.users.map((u) => html`<option value="${u.id}" ${Number(v.user_id) === u.id ? 'selected' : ''}>${u.name}</option>`)}</select></div></div>
          ${c.last && !logId && !v.services.length ? html`<button type="button" class="btn xs ghost mt-8" data-base>${icon('copy', 'sm')} Usar o registro de ${date(c.last.date)} como base</button>` : ''}</section>

        <section class="card dy-sec"><h3>O que foi feito?</h3>
          <div class="dy-cards">${phases.map((p) => { const on = selSvc(p.id) >= 0; return html`<button type="button" class="dy-card ${on ? 'on' : ''}" data-ph="${p.id}">${svcIcon(p.name)}<span>${p.name}</span><i class="dy-ck">${on ? cleanImg(ICONS.check) : ''}</i>${p.status === 'concluido' ? html`<em>concluída</em>` : ''}</button>`; })}
            ${v.services.filter((s) => !s.phase_id).map((s) => html`<button type="button" class="dy-card on" data-free="${s.name}">${svcIcon(s.name)}<span>${s.name}</span><i class="dy-ck">${cleanImg(ICONS.check)}</i></button>`)}
            <button type="button" class="dy-card add" data-addsvc>${icon('plus')}<span>Adicionar serviço</span></button></div>
          ${!phases.length ? html`<p class="small muted">Esta obra ainda não tem etapas. <button class="link" data-phases>Montar etapas</button> ou use “Adicionar serviço”.</p>` : ''}
          ${v.services.length ? html`<div class="dy-svc-rows">${v.services.map((s, i) => html`<div class="dy-svc-row"><span class="nm">${svcIcon(s.name)} ${s.name}</span>
            <div class="seg sm" data-sst="${i}">${SV.map(([k, l]) => html`<button type="button" data-v="${k}" class="${s.status === k ? 'on' : ''}">${l}</button>`)}</div>
            <button type="button" class="icon-btn" data-rmsvc="${i}" title="Tirar da lista">${cleanImg(ICONS.trash)}</button></div>`)}</div>` : ''}
        </section>

        <section class="card dy-sec"><h3>Quem participou?</h3>
          <div class="chips dy-people">${c.team.map((u) => { const on = v.participants.some((x) => x.kind === 'user' && x.id === u.id); return html`<button type="button" class="chip ${on ? 'on' : ''}" data-pu="${u.id}">${on ? '✓ ' : ''}${u.name}</button>`; })}
            ${c.suppliers.map((s) => { const on = v.participants.some((x) => x.kind === 'supplier' && x.id === s.id); return html`<button type="button" class="chip ${on ? 'on' : ''}" data-ps="${s.id}">${on ? '✓ ' : ''}${s.name}</button>`; })}
            ${v.participants.filter((x) => x.kind === 'outro' || (x.kind === 'supplier' && !c.suppliers.some((s) => s.id === x.id)) || (x.kind === 'user' && !c.team.some((u) => u.id === x.id))).map((x) => html`<button type="button" class="chip on" data-px="${x.kind}:${x.id || ''}:${x.name}">✓ ${x.name}</button>`)}
            <button type="button" class="chip dashed" data-addp>${icon('plus', 'sm')} Adicionar</button></div>
          <p class="small muted" style="margin:6px 0 0">Marque só quem esteve presente.</p></section>

        <section class="card dy-sec"><h3>Fotos da obra</h3>
          <div class="dy-photos">${st.photos.map((p, i) => html`<figure class="dy-ph ${p.status}"><img src="${p.doc ? `/api/files/${p.doc.id}?inline=1` : p.url}" alt=""><button type="button" class="dy-x" data-rmph="${i}" title="Remover">×</button>
              ${p.status === 'enviando' ? html`<b><i style="width:${p.progress || 0}%"></i></b>` : ''}${p.status === 'erro' ? html`<span class="dy-err">Falhou — será reenviada</span>` : ''}
              <input class="dy-cap" data-cap="${i}" value="${p.caption || ''}" placeholder="Legenda (opcional)"></figure>`)}
            <div class="dy-phbtns"><label class="btn primary">${cleanImg(ICONS.camera)} Tirar foto<input type="file" accept="image/*" capture="environment" hidden data-cam></label>
              <label class="btn">${icon('image', 'sm')} Escolher fotos<input type="file" accept="image/*" multiple hidden data-pick></label></div></div></section>

        <section class="card dy-sec"><h3>Pendências e próximos passos</h3>
          ${c.pendencies.length ? html`<div class="dy-pends">${c.pendencies.map((p) => { const sel = v.pend_selected.includes(p.id); const res = v.pend_resolved.includes(p.id); return html`<div class="dy-pend ${res ? 'res' : sel ? 'on' : ''}"><div class="grow"><div>${p.text}</div><div class="small muted">${[p.kind === 'proximo_passo' ? 'Próximo passo' : 'Pendência', p.responsible, p.due_date ? 'até ' + date(p.due_date) : null, p.client_visible ? null : 'interna'].filter(Boolean).join(' · ')}</div></div>
              <div class="seg sm"><button type="button" data-psel="${p.id}" class="${sel ? 'on' : ''}">Continua</button><button type="button" data-pres="${p.id}" class="${res ? 'on' : ''}">Resolvida</button></div></div>`; })}</div>` : ''}
          ${v.pend_new.map((n, i) => html`<div class="dy-pend on"><div class="grow"><div>${n.text}</div><div class="small muted">${[n.kind === 'proximo_passo' ? 'Próximo passo' : 'Pendência', n.responsible, n.due_date ? 'até ' + date(n.due_date) : null, n.client_visible ? 'visível ao cliente' : 'interna'].filter(Boolean).join(' · ')} · nova</div></div><button type="button" class="icon-btn" data-rmpn="${i}">${cleanImg(ICONS.trash)}</button></div>`)}
          <div class="row wrap gap-8 mt-8">${phases.filter((p) => p.status !== 'concluido').slice(0, 6).map((p) => html`<button type="button" class="chip" data-phnext="${p.id}">${icon('plus', 'sm')} ${p.name}</button>`)}<button type="button" class="chip dashed" data-addpend>${icon('plus', 'sm')} Nova pendência</button></div></section>

        <section class="card dy-sec"><details ${v.client_note || v.internal_notes || v.decisions || v.problems ? 'open' : ''}><summary><h3 style="display:inline">Observações</h3> <span class="small muted">(opcional)</span></summary>
          <div class="form-grid mt-8"><div class="field wide"><label>Para o cliente</label><textarea class="input" rows="2" data-v="client_note" placeholder="Ex.: Na próxima semana começa a instalação do gesso.">${v.client_note}</textarea></div>
            <div class="field wide"><label>Interna — só o escritório vê</label><textarea class="input" rows="2" data-v="internal_notes" placeholder="Ex.: Conferir medida do vão da porta da suíte">${v.internal_notes}</textarea></div>
            <div class="field"><label>Decisões tomadas (cliente vê)</label><textarea class="input" rows="2" data-v="decisions">${v.decisions}</textarea></div>
            <div class="field"><label>Problemas encontrados (interno)</label><textarea class="input" rows="2" data-v="problems">${v.problems}</textarea></div></div></details></section>

        <section class="card dy-sec"><h3>Resumo da atualização</h3><p class="small muted" style="margin:0 0 8px">Montado a partir do que você marcou — pode ajustar. Nada é inventado: só aparece o que foi selecionado.</p>
          <div class="field"><label>Título</label><input class="input" data-v="title" value="${v.title}" placeholder="${suggestTitle(v) || 'Ex.: Início das intervenções'}"></div>
          <div class="field mt-8"><label>Texto para o cliente</label><textarea class="input" rows="4" data-v="description" placeholder="Marque os serviços acima para montar o texto">${v.description || (v.descTouched ? '' : buildDesc(v, c))}</textarea>
            ${v.descTouched ? html`<button type="button" class="link small" data-regen>Montar de novo a partir das seleções</button>` : ''}</div>
          ${phaseSuggestions(v, c).length ? html`<div class="dy-phch mt-8"><div class="small"><b>Atualizar etapas da obra?</b> <span class="muted">Só muda se você marcar — serviço parcial não conclui a etapa.</span></div>
            ${phaseSuggestions(v, c).map((s) => html`<label class="check small"><input type="checkbox" data-pch="${s.phase_id}:${s.to}" ${v.phase_changes.some((x) => x.phase_id === s.phase_id && x.status === s.to) ? 'checked' : ''}> ${s.label}</label>`)}</div>` : ''}
        </section>
        <div data-result></div>
      </div>
      <div class="dy-bar"><button class="btn" data-save>Salvar rascunho</button><button class="btn primary" data-publish>${st.status === 'publicado' ? html`Salvar<span class="desktop-only">&nbsp;e manter publicado</span>` : html`Salvar e publicar<span class="desktop-only">&nbsp;para o cliente</span>`}</button></div>`}`);
    bind();
    renderResult();
  }

  // ------------- textos sugeridos (só com o que foi selecionado)
  function suggestTitle(v) {
    if (!v.services.length) return '';
    const first = v.services[0];
    return v.services.length === 1 ? `${first.name} — ${SVL[first.status].toLowerCase()}` : `${first.name} e mais ${v.services.length - 1} serviço${v.services.length > 2 ? 's' : ''}`;
  }
  function buildDesc(v, c) {
    const parts = [];
    const by = (k) => v.services.filter((s) => s.status === k).map((s) => s.name);
    const join = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} e ${a[a.length - 1]}` : a[0]);
    if (by('concluido').length) parts.push(`Concluído: ${join(by('concluido'))}.`);
    if (by('em_andamento').length) parts.push(`Em andamento: ${join(by('em_andamento'))}.`);
    if (by('iniciado').length) parts.push(`Iniciado: ${join(by('iniciado'))}.`);
    if (by('impedido').length) parts.push(`Impedido no momento: ${join(by('impedido'))}.`);
    const team = v.participants.map((x) => x.name).filter(Boolean);
    if (team.length) parts.push(`Equipe presente: ${join(team)}.`);
    return parts.join('\n');
  }
  function phaseSuggestions(v, c) {
    if (!c) return [];
    const out = [];
    v.services.forEach((s) => {
      const ph = s.phase_id && c.phases.find((p) => p.id === s.phase_id); if (!ph) return;
      if (s.status === 'concluido' && ph.status !== 'concluido') out.push({ phase_id: ph.id, to: 'concluido', label: `Marcar a etapa “${ph.name}” como concluída (100%)` });
      if (['iniciado', 'em_andamento'].includes(s.status) && ph.status === 'nao_iniciado') out.push({ phase_id: ph.id, to: 'em_andamento', label: `Marcar a etapa “${ph.name}” como em andamento` });
    });
    return out;
  }

  // ------------- interações
  function upd(fn, rerender = true) { fn(st.v); if (!st.v.descTouched) st.v.description = ''; saveDraft(); if (rerender) { const y = window.scrollY; render(); window.scrollTo(0, y); } }
  function bind() {
    const $ = (s) => root.querySelector(s); const c = st.ctx;
    const wsel = combo({ name: 'w', options: works.map((w) => ({ id: w.id, label: `${w.name} · ${w.client_name || w.project_name}`, sub: w.project_name })), value: st.work_id || '', placeholder: 'Escolher obra…',
      onChange: async (val) => { const n = Number(val) || null; if (n === st.work_id) return; if (logId) { toast('Para mudar a obra de um registro salvo, crie um novo registro na obra correta.', { error: true }); render(); return; }
        st.work_id = n; st.v.services = []; st.v.participants = []; st.v.pend_selected = []; st.v.pend_resolved = []; st.v.phase_changes = []; await loadCtx(); draftRestored = false; tryDraft(); render(); } });
    if (logId) wsel.querySelector('button').disabled = true;
    $('[data-wsel]').appendChild(wsel);
    const dd = $('[data-discard]'); if (dd) dd.onclick = () => { clearDraft(); location.reload(); };
    $$('[data-v]', root).forEach((i) => { if (i.closest('[data-kind]')) return; i.addEventListener('input', () => { st.v[i.dataset.v] = i.value; if (i.dataset.v === 'description') st.v.descTouched = true; saveDraft(); }); });
    if (!c) return;
    const desc = $('[data-v="description"]'); if (desc && !st.v.descTouched) st.v.description = desc.value;
    $('[data-kind]').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) upd((v) => { v.kind = b.dataset.v; }); };
    const base = $('[data-base]'); if (base) base.onclick = () => upd((v) => { // estrutura do último registro: serviços (sem conclusões), sem fotos, datas, presenças ou pagamentos
      v.services = (c.last.services || []).map((s) => ({ phase_id: s.phase_id, name: s.name, status: s.status === 'concluido' ? 'em_andamento' : s.status })); toast('Serviços do registro anterior carregados. Confira a situação de cada um.'); });
    $$('[data-ph]', root).forEach((b) => (b.onclick = () => { const id = Number(b.dataset.ph); const ph = c.phases.find((p) => p.id === id); upd((v) => { const i = v.services.findIndex((s) => s.phase_id === id); if (i >= 0) v.services.splice(i, 1); else v.services.push({ phase_id: id, name: ph.name, status: ph.status === 'nao_iniciado' ? 'iniciado' : 'em_andamento' }); v.phase_changes = v.phase_changes.filter((x) => v.services.some((s) => s.phase_id === x.phase_id)); }); }));
    $$('[data-free]', root).forEach((b) => (b.onclick = () => upd((v) => { v.services = v.services.filter((s) => s.phase_id || s.name !== b.dataset.free); })));
    $$('[data-sst]', root).forEach((g) => (g.onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) upd((v) => { v.services[+g.dataset.sst].status = b.dataset.v; const s = v.services[+g.dataset.sst]; v.phase_changes = v.phase_changes.filter((x) => x.phase_id !== s.phase_id); }); }));
    $$('[data-rmsvc]', root).forEach((b) => (b.onclick = () => upd((v) => { const s = v.services.splice(+b.dataset.rmsvc, 1)[0]; v.phase_changes = v.phase_changes.filter((x) => x.phase_id !== s.phase_id); })));
    $$('[data-addsvc]', root).forEach((b) => (b.onclick = () => addService()));
    $$('[data-pu]', root).forEach((b) => (b.onclick = () => { const u = c.team.find((x) => x.id === Number(b.dataset.pu)); upd((v) => { const i = v.participants.findIndex((x) => x.kind === 'user' && x.id === u.id); if (i >= 0) v.participants.splice(i, 1); else v.participants.push({ kind: 'user', id: u.id, name: u.name }); }); }));
    $$('[data-ps]', root).forEach((b) => (b.onclick = () => { const s = c.suppliers.find((x) => x.id === Number(b.dataset.ps)); upd((v) => { const i = v.participants.findIndex((x) => x.kind === 'supplier' && x.id === s.id); if (i >= 0) v.participants.splice(i, 1); else v.participants.push({ kind: 'supplier', id: s.id, name: s.name }); }); }));
    $$('[data-px]', root).forEach((b) => (b.onclick = () => { const [k, id, ...n] = b.dataset.px.split(':'); upd((v) => { v.participants = v.participants.filter((x) => !(x.kind === k && String(x.id || '') === id && x.name === n.join(':'))); }); }));
    $('[data-addp]').onclick = addPerson;
    // fotos
    const addFiles = (files) => { Array.from(files || []).filter((f) => /^image\//.test(f.type)).forEach((f) => st.photos.push({ key: rid(), file: f, url: URL.createObjectURL(f), caption: '', status: 'novo' })); const y = window.scrollY; render(); window.scrollTo(0, y); };
    $('[data-cam]').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
    $('[data-pick]').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
    $$('[data-rmph]', root).forEach((b) => (b.onclick = () => { const p = st.photos.splice(+b.dataset.rmph, 1)[0]; if (p.doc) st.removed.push(p.doc.id); const y = window.scrollY; render(); window.scrollTo(0, y); }));
    $$('[data-cap]', root).forEach((i) => (i.oninput = () => { st.photos[+i.dataset.cap].caption = i.value; st.photos[+i.dataset.cap].capChanged = true; }));
    // pendências
    $$('[data-psel]', root).forEach((b) => (b.onclick = () => upd((v) => { const id = Number(b.dataset.psel); v.pend_resolved = v.pend_resolved.filter((x) => x !== id); v.pend_selected = v.pend_selected.includes(id) ? v.pend_selected.filter((x) => x !== id) : [...v.pend_selected, id]; })));
    $$('[data-pres]', root).forEach((b) => (b.onclick = () => upd((v) => { const id = Number(b.dataset.pres); v.pend_selected = v.pend_selected.filter((x) => x !== id); v.pend_resolved = v.pend_resolved.includes(id) ? v.pend_resolved.filter((x) => x !== id) : [...v.pend_resolved, id]; })));
    $$('[data-rmpn]', root).forEach((b) => (b.onclick = () => upd((v) => { v.pend_new.splice(+b.dataset.rmpn, 1); })));
    $$('[data-phnext]', root).forEach((b) => (b.onclick = () => { const ph = c.phases.find((p) => p.id === Number(b.dataset.phnext)); addPendency({ text: ph.name, phase_id: ph.id, kind: 'proximo_passo', responsible: ph.responsible || '', due_date: ph.due_date || '' }); }));
    $('[data-addpend]').onclick = () => addPendency({});
    $$('[data-phases]', root).forEach((b) => (b.onclick = () => phasesEditor(c, async () => { await loadCtx(); render(); })));
    $$('[data-pch]', root).forEach((i) => (i.onchange = () => { const [pid, to] = i.dataset.pch.split(':'); upd((v) => { v.phase_changes = v.phase_changes.filter((x) => !(x.phase_id === Number(pid) && x.status === to)); if (i.checked) v.phase_changes.push({ phase_id: Number(pid), status: to }); }, false); }));
    const rg = $('[data-regen]'); if (rg) rg.onclick = () => upd((v) => { v.descTouched = false; v.description = ''; });
    $('[data-save]').onclick = () => submit(false);
    $('[data-publish]').onclick = () => submit(true);
  }
  function addService() {
    const m = modal({ title: 'Adicionar serviço', body: html`<div class="field"><label>Serviço</label><input class="input" id="sn" placeholder="Ex.: Instalação de rodapés"></div>
      <label class="check small mt-8"><input type="checkbox" id="sp" checked> Adicionar também às etapas desta obra</label>`,
    actions: [{ label: 'Cancelar' }, { label: 'Adicionar', primary: true, fn: async (mm) => {
      const name = mm.querySelector('#sn').value.trim(); if (!name) { toast('Informe o serviço.', { error: true }); return false; }
      if (mm.querySelector('#sp').checked) {
        try { const cur = st.ctx.phases.map((p) => ({ id: p.id, name: p.name, applicable: p.applicable, archived: p.archived, responsible: p.responsible, due_date: p.due_date }));
          const r = await api.put(`/diary/works/${st.work_id}/phases`, { phases: [...cur, { name }] }); await loadCtx(); const np = r.phases.find((p) => p.name === name && !cur.some((x) => x.id === p.id));
          upd((v) => { v.services.push({ phase_id: np ? np.id : null, name, status: 'iniciado' }); }); toast('Serviço adicionado às etapas desta obra.'); } catch (e) { fail(e); return false; }
      } else upd((v) => { v.services.push({ phase_id: null, name, status: 'iniciado' }); });
    } }] });
    setTimeout(() => m.el.querySelector('#sn').focus(), 60);
  }
  function addPerson() {
    const box = el(html`<div><div class="field"><label>Fornecedor cadastrado</label><span data-sup></span></div><div class="field mt-8"><label>Ou o nome da pessoa</label><input class="input" id="pn" placeholder="Ex.: Roberto (eletricista)"></div></div>`);
    let sup = null;
    box.querySelector('[data-sup]').appendChild(combo({ name: 's', options: refOptions('suppliers'), placeholder: 'Procurar fornecedor…', onChange: (v, o) => { sup = v ? { id: Number(v), name: o ? o.label : '' } : null; } }));
    modal({ title: 'Quem participou', body: box, actions: [{ label: 'Cancelar' }, { label: 'Adicionar', primary: true, fn: (mm) => {
      const n = mm.querySelector('#pn').value.trim();
      if (!sup && !n) { toast('Escolha um fornecedor ou digite o nome.', { error: true }); return false; }
      upd((v) => { if (sup) v.participants.push({ kind: 'supplier', id: sup.id, name: sup.name }); if (n) v.participants.push({ kind: 'outro', id: null, name: n }); });
    } }] });
  }
  function addPendency(pre) {
    const c = st.ctx;
    const m = modal({ title: 'Pendência ou próximo passo', body: html`<div class="field"><label>O que precisa acontecer</label><input class="input" id="pt" value="${pre.text || ''}" placeholder="Ex.: Entregar argamassa para o 3º banheiro"></div>
      <div class="seg sm mt-8" id="pk"><button type="button" data-v="pendencia" class="${pre.kind !== 'proximo_passo' ? 'on' : ''}">Pendência</button><button type="button" data-v="proximo_passo" class="${pre.kind === 'proximo_passo' ? 'on' : ''}">Próximo passo</button></div>
      <div class="form-grid mt-8"><div class="field"><label>Responsável (opcional)</label><input class="input" id="pr" list="dy-team" value="${pre.responsible || ''}"><datalist id="dy-team">${[...c.team.map((u) => u.name), ...c.suppliers.map((s) => s.name)].map((n) => html`<option value="${n}">`)}</datalist></div>
        <div class="field"><label>Previsão (opcional)</label><input class="input" type="date" id="pd" value="${pre.due_date || ''}"></div></div>
      <label class="check small mt-8"><input type="checkbox" id="pv" checked> Mostrar ao cliente</label>`,
    actions: [{ label: 'Cancelar' }, { label: 'Adicionar', primary: true, fn: (mm) => {
      const text = mm.querySelector('#pt').value.trim(); if (!text) { toast('Descreva a pendência.', { error: true }); return false; }
      const kind = mm.querySelector('#pk .on').dataset.v;
      upd((v) => { v.pend_new.push({ key: rid(), text, kind, phase_id: pre.phase_id || null, responsible: mm.querySelector('#pr').value.trim(), due_date: mm.querySelector('#pd').value, client_visible: mm.querySelector('#pv').checked ? 1 : 0 }); });
    } }] });
    m.el.querySelector('#pk').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) $$('#pk button', m.el).forEach((x) => x.classList.toggle('on', x === b)); };
  }

  // ------------- salvar (rascunho / publicar) com etapas independentes e repetíveis
  function renderResult() {
    const box = root.querySelector('[data-result]'); if (!box) return; const r = st.result; if (!r) { box.innerHTML = ''; return; }
    const line = (ok, txt) => html`<li class="${ok === true ? 'ok' : ok === false ? 'err' : 'wait'}">${ok === true ? '✓' : ok === false ? '!' : '…'} ${txt}</li>`;
    const sent = st.photos.filter((p) => p.status === 'ok').length; const bad = st.photos.filter((p) => p.status === 'erro').length; const pendPh = st.photos.filter((p) => p.status !== 'ok').length;
    box.innerHTML = toHTML(html`<div class="card dy-res ${r.error || bad ? 'warn' : 'done'}"><ul>
      ${line(r.saved ? true : r.error && !r.saved ? false : null, r.saved ? 'Registro salvo no diário' : r.error && !r.saved ? `Registro não foi salvo: ${r.error}. Tudo o que você preencheu continua aqui.` : 'Salvando o registro…')}
      ${st.photos.length ? line(pendPh ? (bad ? false : null) : true, pendPh ? `${sent} de ${st.photos.length} fotos enviadas${bad ? ` — ${bad} com falha` : ''}` : `${sent} foto(s) salvas no diário e nos arquivos da obra`) : ''}
      ${r.publish ? line(r.published ? true : r.pubError || (r.saved && bad) ? false : null, r.published ? 'Publicado para o cliente (Obra › Diário)' : r.pubError ? `Publicação falhou: ${r.pubError}` : r.saved && bad ? 'Publicação aguardando as fotos que falharam' : 'Publicando…') : ''}
      ${r.phases && r.phases.length ? line(true, `Etapas atualizadas: ${r.phases.join(', ')}`) : ''}</ul>
      ${(r.error || bad || r.pubError) && !st.saving ? html`<div class="row wrap gap-8 mt-8"><button class="btn sm primary" data-retry>Tentar de novo só o que falhou</button>${r.publish && bad && r.saved ? html`<button class="btn sm" data-pubnow>Publicar sem as fotos que falharam</button>` : ''}</div>` : ''}</div>`);
    const rt = box.querySelector('[data-retry]'); if (rt) rt.onclick = () => submit(r.publish, { retry: true });
    const pn = box.querySelector('[data-pubnow]'); if (pn) pn.onclick = () => submit(true, { retry: true, skipFailed: true });
  }
  async function submit(publish, { retry = false, skipFailed = false } = {}) {
    if (st.saving) return;
    if (!st.work_id) { const b = root.querySelector('[data-wbox]'); b.classList.add('need', 'shake'); b.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => b.classList.remove('shake'), 600); toast('Escolha a obra antes de salvar.', { error: true }); return; }
    const v = st.v; const desc = v.description || (v.descTouched ? '' : buildDesc(v, st.ctx));
    if (!desc.trim() && !v.services.length && !v.title.trim()) { toast('Marque o que foi feito ou escreva um resumo.', { error: true }); return; }
    st.saving = true; if (!retry || !st.saveKey) st.saveKey = rid();
    st.result = { publish, saved: retry && st.result ? st.result.saved : false };
    $$('.dy-bar button', root).forEach((b) => (b.disabled = true)); renderResult();
    const payload = { client_key: st.clientKey, save_key: st.saveKey, rev: st.rev, work_id: st.work_id, date: v.date, kind: v.kind, user_id: v.user_id, title: v.title || suggestTitle(v), description: desc,
      services: v.services, participants: v.participants, internal_notes: v.internal_notes, client_note: v.client_note, decisions: v.decisions, problems: v.problems,
      pendencies: { new: v.pend_new, selected: v.pend_selected, resolved: v.pend_resolved }, phase_changes: v.phase_changes };
    // 1. registro (idempotente: mesma chave = mesmo registro)
    if (!st.result.saved || !logId) {
      try {
        const r = logId ? await api.put(`/diary/logs/${logId}`, payload) : await api.post('/diary/logs', payload);
        logId = r.id; st.rev = r.updated_at; st.status = r.status; st.result.saved = true;
        st.result.phases = (r.phase_changes || []).filter((x) => v.phase_changes.some((y) => y.phase_id === x.phase_id)).map((x) => `${x.name} → ${x.to === 'concluido' ? 'concluída' : 'em andamento'}`);
        v.phase_changes = []; history.replaceState(null, '', `#/diario/${logId}`);
      } catch (e) { st.result.error = e.status === 409 ? e.message : e.status ? e.message : 'sem conexão com o servidor'; st.saving = false; $$('.dy-bar button', root).forEach((b) => (b.disabled = false)); renderResult(); return; }
      renderResult();
    }
    // 2. fotos (cada uma com chave própria: reenviar não duplica)
    for (const p of st.photos) {
      if (p.status === 'ok' && !p.capChanged) continue;
      if (p.doc) { if (p.capChanged) { try { await api.put(`/diary/photos/${p.doc.id}`, { caption: p.caption }); p.capChanged = false; } catch { /* legenda tenta de novo depois */ } } continue; }
      if (skipFailed && p.status === 'erro') continue;
      p.status = 'enviando'; p.progress = 0; renderPhotoState();
      const ok = await uploadPhoto(p);
      p.status = ok ? 'ok' : 'erro'; renderPhotoState(); renderResult();
    }
    for (const id of st.removed.splice(0)) { try { await api.put(`/diary/photos/${id}`, { archived: 1 }); } catch { st.removed.push(id); } }
    const bad = st.photos.filter((p) => p.status === 'erro').length;
    // 3. publicação (só depois das fotos, ou se você pedir para publicar sem as que falharam)
    if (publish && (!bad || skipFailed)) {
      try { const r = await api.post(`/diary/logs/${logId}/publish`); st.status = r.status; st.rev = r.updated_at; st.result.published = true; st.result.pubError = null; } catch (e) { st.result.pubError = e.message || 'sem conexão'; }
    }
    st.saving = false;
    if (!bad && (!publish || st.result.published)) {
      clearDraft();
      toast(publish ? 'Salvo e publicado para o cliente.' : 'Rascunho salvo.');
      const keep = st.result; await reloadLog(); st.result = keep;
    }
    const y = window.scrollY; render(); window.scrollTo(0, y);
  }
  function renderPhotoState() { st.photos.forEach((p, i) => { const fig = root.querySelectorAll('.dy-ph')[i]; if (!fig) return; fig.className = `dy-ph ${p.status}`; let b = fig.querySelector('b'); if (p.status === 'enviando') { if (!b) { b = el('<b><i></i></b>'); fig.appendChild(b); } b.querySelector('i').style.width = `${p.progress || 0}%`; } else if (b) b.remove(); }); }
  function uploadPhoto(p) {
    return new Promise((resolve) => {
      const fd = new FormData(); fd.append('files', p.file, p.file.name || 'foto.jpg'); fd.append('entity', 'work_logs'); fd.append('entity_id', String(logId)); fd.append('category', 'Fotos de obra');
      fd.append('upload_key', `${st.clientKey}:${p.key}`); if (p.caption) fd.append('title', p.caption);
      const x = new XMLHttpRequest(); x.open('POST', '/api/files'); x.setRequestHeader('X-Requested-With', 'cnij');
      x.upload.onprogress = (e) => { if (e.lengthComputable) { p.progress = Math.round((e.loaded / e.total) * 100); renderPhotoState(); } };
      x.onload = () => { let d = null; try { d = JSON.parse(x.responseText); } catch { /* */ } if (x.status < 300 && d && d.rows) { p.doc = d.rows[0]; resolve(true); } else { p.error = (d && d.error) || 'falhou'; resolve(false); } };
      x.onerror = () => { p.error = 'sem conexão'; resolve(false); };
      x.send(fd);
    });
  }
  async function reloadLog() {
    try {
      const l = await api.get(`/diary/logs/${logId}`);
      st.status = l.status; st.rev = l.updated_at; st.clientKey = l.client_key || st.clientKey;
      st.photos = l.photos.map((p) => ({ key: `doc${p.id}`, doc: p, caption: p.title, status: 'ok' }));
      Object.assign(st.v, { pend_new: [], pend_selected: (l.next_steps || []).slice(), pend_resolved: [], phase_changes: [], descTouched: true, description: l.description || '', title: l.title || '' });
      await loadCtx();
    } catch { /* mantém o formulário */ }
  }
}

// ------------------------------------------------------------------ etapas personalizadas da obra
export async function phasesEditor(c, onDone) {
  let list = c.phases.map((p) => ({ ...p }));
  const tpls = await api.get('/diary/templates').catch(() => []);
  const body = el('<div class="dy-phed"></div>');
  const draw = () => {
    const act = list.filter((p) => !p.archived); const arc = list.filter((p) => p.archived);
    body.innerHTML = toHTML(html`<p class="small muted" style="margin-top:0">Etapas só desta obra (${c.work.name}). Alterar aqui não muda outras obras. O progresso considera apenas as etapas que se aplicam.</p>
      <div class="dy-phlist">${act.map((p) => { const i = list.indexOf(p); return html`<div class="dy-phrow ${p.applicable ? '' : 'na'}" draggable="true" data-i="${i}">
        <span class="grip" title="Arraste para reordenar">⋮⋮</span>
        <input class="input" data-name="${i}" value="${p.name}">
        <div class="mv"><button type="button" data-up="${i}" title="Subir">↑</button><button type="button" data-down="${i}" title="Descer">↓</button></div>
        <label class="check small"><input type="checkbox" data-na="${i}" ${p.applicable ? '' : 'checked'}> Não se aplica</label>
        <button type="button" class="icon-btn" data-more="${i}" title="Mais">${icon('more', 'sm')}</button>
        ${p.more ? html`<div class="dy-phmore"><input class="input" data-resp="${i}" value="${p.responsible || ''}" placeholder="Responsável (opcional)"><input class="input" type="date" data-due="${i}" value="${p.due_date || ''}"><button type="button" class="btn xs ghost" data-rm="${i}">${p.id && (p.progress > 0 || p.status !== 'nao_iniciado') ? 'Arquivar' : 'Remover'}</button></div>` : ''}</div>`; })}</div>
      <div class="row wrap gap-8 mt-8"><input class="input grow" data-newname placeholder="Nova etapa — ex.: Instalação de rodapés"><button type="button" class="btn sm" data-add>${icon('plus', 'sm')} Adicionar</button></div>
      <details class="more-details mt-16"><summary>Usar um modelo</summary><div class="mt-8">${tpls.map((t, k) => html`<div class="dy-tpl"><b>${t.name}</b><div class="chips mt-4">${t.phases.map((n) => html`<label class="chip"><input type="checkbox" data-tp="${k}" value="${n}" ${list.some((p) => p.name.toLowerCase() === n.toLowerCase() && !p.archived) ? 'disabled' : ''}> ${n}</label>`)}</div><button type="button" class="btn xs mt-4" data-tpadd="${k}">Adicionar as marcadas</button></div>`)}</div></details>
      ${arc.length ? html`<details class="more-details mt-8"><summary>Arquivadas (${arc.length}) — mantêm o histórico</summary>${arc.map((p) => html`<div class="row between small mt-4"><span>${p.name}</span><button type="button" class="btn xs" data-restore="${list.indexOf(p)}">Restaurar</button></div>`)}</details>` : ''}`);
  };
  draw();
  const move = (i, d) => { const act = list.filter((p) => !p.archived); const k = act.indexOf(list[i]); const j = k + d; if (j < 0 || j >= act.length) return; [act[k], act[j]] = [act[j], act[k]]; list = [...act, ...list.filter((p) => p.archived)]; draw(); };
  body.addEventListener('input', (e) => { const t = e.target; if (t.dataset.name) list[+t.dataset.name].name = t.value; if (t.dataset.resp) list[+t.dataset.resp].responsible = t.value; if (t.dataset.due) list[+t.dataset.due].due_date = t.value; });
  body.addEventListener('change', (e) => { const t = e.target; if (t.dataset.na) { list[+t.dataset.na].applicable = t.checked ? 0 : 1; draw(); } });
  body.addEventListener('click', (e) => {
    const g = (k) => e.target.closest(`[data-${k}]`);
    if (g('up')) move(+g('up').dataset.up, -1); else if (g('down')) move(+g('down').dataset.down, 1);
    else if (g('more')) { const p = list[+g('more').dataset.more]; p.more = !p.more; draw(); }
    else if (g('rm')) { const i = +g('rm').dataset.rm; const p = list[i]; if (p.id && (p.progress > 0 || p.status !== 'nao_iniciado')) { p.archived = 1; } else list.splice(i, 1); draw(); }
    else if (g('restore')) { list[+g('restore').dataset.restore].archived = 0; draw(); }
    else if (g('add')) { const i = body.querySelector('[data-newname]'); const n = i.value.trim(); if (!n) return; list.push({ name: n, applicable: 1, archived: 0, status: 'nao_iniciado', progress: 0 }); draw(); body.querySelector('[data-newname]').focus(); }
    else if (g('tpadd')) { const k = g('tpadd').dataset.tpadd; $$(`[data-tp="${k}"]:checked`, body).forEach((x) => list.push({ name: x.value, applicable: 1, archived: 0, status: 'nao_iniciado', progress: 0 })); draw(); }
  });
  body.addEventListener('keydown', (e) => { if (e.target.dataset.newname !== undefined && e.key === 'Enter') { e.preventDefault(); body.querySelector('[data-add]').click(); } });
  let dragI = null;
  body.addEventListener('dragstart', (e) => { const r = e.target.closest('[data-i]'); if (r) dragI = +r.dataset.i; });
  body.addEventListener('dragover', (e) => { if (dragI !== null) e.preventDefault(); });
  body.addEventListener('drop', (e) => { e.preventDefault(); const r = e.target.closest('[data-i]'); if (r && dragI !== null) { const act = list.filter((p) => !p.archived); const a = act.indexOf(list[dragI]); const b = act.indexOf(list[+r.dataset.i]); const [x] = act.splice(a, 1); act.splice(b, 0, x); list = [...act, ...list.filter((p) => p.archived)]; } dragI = null; draw(); });
  const m = modal({ title: 'Etapas desta obra', body, actions: [
    { label: 'Salvar como modelo', fn: async () => { const name = prompt('Nome do modelo (só a estrutura de etapas é salva):', `Modelo — ${c.work.name}`); if (!name) return false; try { await save(); await api.post('/diary/templates', { work_id: c.work.id, name }); toast('Modelo salvo — disponível para outras obras.'); } catch (e) { fail(e); } return false; } },
    { label: 'Cancelar' }, { label: 'Salvar etapas', primary: true, fn: async () => { await save(); toast('Etapas desta obra atualizadas.'); onDone && onDone(); } }] });
  m.el.style.width = 'min(720px, calc(100vw - 24px))';
  async function save() {
    const r = await api.put(`/diary/works/${c.work.id}/phases`, { phases: list.filter((p) => String(p.name || '').trim()).map((p) => ({ id: p.id, name: p.name, applicable: p.applicable, archived: p.archived, responsible: p.responsible, due_date: p.due_date })) });
    if (r.archived_with_history.length) toast(`Arquivadas por terem histórico: ${r.archived_with_history.join(', ')}.`, { ms: 6000 });
    list = r.phases.map((p) => ({ ...p })); return r;
  }
}
