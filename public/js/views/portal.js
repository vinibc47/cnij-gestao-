// ÁREA DO CLIENTE — visão do cliente, somente com o que o escritório publicou.
// Todos os dados vêm do servidor (/api/portal/overview), que filtra por cliente e por projeto.
import { api, html, el, toHTML, icon, money, date, datetime, time, toast, fail, fileExt, bytes, modal, $$, esc } from '../lib.js';

const url = (d, inline) => `/api/portal/files/${d.id}${inline ? '?inline=1' : ''}`;
const PH = { nao_iniciado: 'A iniciar', em_andamento: 'Em andamento', aguardando_cliente: 'Aguardando sua aprovação', aguardando_fornecedor: 'Aguardando fornecedor', revisao: 'Em revisão', aprovado: 'Aprovado', concluido: 'Concluído' };
const IN = { previsto: 'Previsto', a_receber: 'A vencer', recebido: 'Pago', vencido: 'Vencido', cancelado: 'Cancelado' };
const INT = { previsto: 'neutral', a_receber: 'info', recebido: 'success', vencido: 'danger' };
const APR_TONE = { aberta: 'warning', ajustes: 'info', aprovada: 'success', cancelada: 'muted' };
const NI = html`<span class="ni">Não informado</span>`;
const val = (v) => (v === null || v === undefined || v === '' ? NI : v);
const ul = (a) => (a && a.length ? html`<ul>${a.map((x) => html`<li>${x}</li>`)}</ul>` : NI);
const TABS = [['visao', 'Visão geral', 'home'], ['projeto', 'Veja seu projeto', 'frame'], ['andamento', 'Andamento', 'bars'], ['obra', 'Obra', 'hammer'], ['documentos', 'Documentos', 'folder'], ['financeiro', 'Financeiro', 'card']];
const norm = (x) => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

export default async function portal(root) {
  let d;
  const load = async () => { d = await api.get('/portal/overview'); };
  try { await load(); } catch (e) { root.innerHTML = toHTML(html`<div class="empty" style="padding-top:20vh">${e.message}</div>`); return; }
  const { S } = await import('../lib.js'); S.meta = S.meta || { lists: {}, users: [], resources: {}, options: {} };
  const st = { pid: Number(sessionStorage.getItem('portal_pid')) || null, tab: sessionStorage.getItem('portal_tab') || 'visao', sub: 'orcamentos', focus: null, cmpItem: null, cmpSel: null };
  if (!d.projects.find((p) => p.id === st.pid)) st.pid = d.projects[0] ? d.projects[0].id : null;
  if (!TABS.find((t) => t[0] === st.tab)) st.tab = 'visao';

  const go = (tab, sub, focus) => { st.tab = tab; if (sub) st.sub = sub; st.focus = focus || null; sessionStorage.setItem('portal_tab', tab); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const render = () => {
    const p = d.projects.find((x) => x.id === st.pid);
    const first = d.client.name.split(' ')[0];
    root.innerHTML = toHTML(html`<div class="pt-top"><img class="portal-logo" src="/logo" alt="Carla Nogueira & Irineu Junior — Arquitetura | Interiores">
        <div class="pt-user"><span class="nm">Olá, ${first}</span><span class="sep"></span><button data-out>${icon('users', 'sm')} Sair</button></div></div>
      <div class="pt">
      ${!p ? html`<div class="pt-empty">Nenhum projeto disponível no momento.</div>` : html`
        <div class="pt-head"><div><div class="eyebrow">Área do cliente</div><h1>${p.name}</h1></div>
          ${d.projects.length > 1 ? html`<label class="small muted">Projeto&nbsp; <select data-proj>${d.projects.map((x) => html`<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${x.name}</option>`)}</select></label>` : ''}</div>
        <div class="pt-tabs" role="tablist">${TABS.map(([k, l, ic]) => html`<button role="tab" data-t="${k}" class="${k === st.tab ? 'on' : ''}" aria-selected="${k === st.tab}">${icon(ic)}<span>${l}</span></button>`)}</div>
        <div data-body></div>
        <div class="pt-help"><span>${d.contact.whatsapp || d.contact.email ? html`<a href="${d.contact.whatsapp ? `https://wa.me/${d.contact.whatsapp}?text=${encodeURIComponent(`Olá! Sou ${d.client.name}, cliente do projeto ${p.name}.`)}` : `mailto:${d.contact.email}`}" target="_blank" rel="noopener">${icon('chat', 'sm')} Precisa de ajuda? Fale com o escritório</a>` : ''}</span>
          <span class="muted">${d.contact.name || ''}</span></div>`}
    </div>`);
    root.querySelector('[data-out]').onclick = async () => { await api.post('/auth/logout'); location.reload(); };
    if (!p) return;
    const ps = root.querySelector('[data-proj]'); if (ps) ps.onchange = () => { st.pid = Number(ps.value); sessionStorage.setItem('portal_pid', st.pid); st.cmpItem = null; render(); };
    $$('[data-t]', root).forEach((b) => (b.onclick = () => go(b.dataset.t)));
    const body = root.querySelector('[data-body]');
    body.appendChild(el(toHTML(VIEWS[st.tab](p, d, st))));
    bind(body, p);
    if (st.focus) { const f = body.querySelector(`[data-ref="${CSS.escape(st.focus)}"]`); if (f) { f.classList.add('pt-focus'); setTimeout(() => f.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60); } st.focus = null; }
  };

  const bind = (body, p) => {
    body.addEventListener('click', async (e) => {
      const g = e.target.closest('[data-go]');
      if (g) { e.preventDefault(); return go(g.dataset.go, g.dataset.sub, g.dataset.ref); }
      const s = e.target.closest('[data-sub]:not([data-go])'); if (s) { st.sub = s.dataset.sub; return render(); }
      const it = e.target.closest('[data-media]'); if (it) return openMedia(p, Number(it.dataset.media));
      const ap = e.target.closest('[data-approve]'); if (ap) return approve(p, Number(ap.dataset.approve), body);
      const aj = e.target.closest('[data-adjust]'); if (aj) return adjust(p, Number(aj.dataset.adjust));
    });
    const ci = body.querySelector('[data-cmp-item]'); if (ci) ci.onchange = () => { st.cmpItem = ci.value; st.cmpSel = null; render(); };
    $$('[data-cmp-q]', body).forEach((c) => (c.onchange = () => { st.cmpSel = $$('[data-cmp-q]', body).filter((x) => x.checked).map((x) => Number(x.value)); render(); }));
  };

  // aprovação: mostra o resumo do que está sendo aprovado antes de confirmar
  const approve = async (p, id, body) => {
    const a = p.approvals.find((x) => x.id === id); if (!a) return;
    let opt = null;
    if (a.options.length) {
      const sel = body.querySelector(`input[name="opt-${id}"]:checked`);
      if (!sel && a.options.length > 1) return toast('Selecione a opção que deseja aprovar.', { error: true });
      const oid = sel ? Number(sel.value) : a.options[0].id;
      opt = p.quotes.flatMap((g) => g.options).find((q) => q.id === oid) || a.options.find((o) => o.id === oid);
    }
    const summary = opt ? html`<div class="pt-meta" style="margin-bottom:12px"><div><span class="k">Fornecedor</span>${opt.supplier}</div><div><span class="k">Valor</span>${opt.amount ? money(opt.amount) : NI}</div>
        <div><span class="k">Versão do orçamento</span>${opt.version || 1}</div>${opt.deadline_days ? html`<div><span class="k">Prazo</span>${opt.deadline_days} dias</div>` : ''}</div>
        ${opt.scope ? html`<div class="small"><b>Escopo:</b> ${opt.scope}</div>` : ''}
        ${opt.included ? html`<div class="small mt-8"><b>Inclui:</b> ${opt.included.length ? opt.included.join('; ') : 'não informado'}</div><div class="small mt-8"><b>Não inclui:</b> ${opt.excluded && opt.excluded.length ? opt.excluded.join('; ') : 'não informado'}</div>` : ''}` : html`<p class="small" style="margin:0 0 8px">${a.title}</p>`;
    modal({ title: 'Confirmar aprovação', body: html`${summary}<p class="small muted" style="margin:14px 0 0">Ao confirmar, o escritório recebe sua aprovação com data e horário. A aprovação não é pagamento nem contratação: o escritório dará os próximos passos.</p>`,
      actions: [{ label: 'Voltar' }, { label: 'Confirmar aprovação', primary: true, fn: async () => {
        try { await api.post(`/portal/approvals/${id}/decide`, { action: 'aprovada', quote_id: opt ? opt.id : null }); toast('Aprovação registrada e enviada ao escritório.'); await load(); render(); } catch (err) { fail(err); return false; }
      } }] });
  };
  const adjust = (p, id) => {
    const a = p.approvals.find((x) => x.id === id); if (!a) return;
    const b = el(html`<div><p class="small muted" style="margin-top:0">${a.title}</p><div class="field"><label>O que precisa ser ajustado?</label><textarea rows="5" data-c data-raw placeholder="Descreva o ajuste que você precisa"></textarea></div></div>`);
    modal({ title: 'Solicitar ajustes', body: b, actions: [{ label: 'Cancelar' }, { label: 'Enviar ao escritório', primary: true, fn: async () => {
      const c = b.querySelector('[data-c]').value.trim(); if (!c) { toast('Descreva o ajuste solicitado.', { error: true }); return false; }
      try { await api.post(`/portal/approvals/${id}/decide`, { action: 'ajustes', comment: c }); toast('Pedido de ajustes enviado ao escritório.'); await load(); render(); } catch (err) { fail(err); return false; }
    } }] });
  };
  render();
}

// ---------- visualização de imagens e vídeos ----------
function openMedia(p, id) {
  const list = p.showcase.filter((m) => m.kind === 'imagem' || m.kind === 'video');
  const m0 = p.showcase.find((m) => m.id === id); if (!m0) return;
  if (m0.kind === 'pdf' || m0.kind === 'arquivo') { window.open(url(m0, true), '_blank', 'noopener'); return; }
  let i = list.findIndex((m) => m.id === id);
  const lb = el('<div class="lightbox" role="dialog" aria-modal="true"></div>');
  const show = () => {
    const m = list[i];
    lb.innerHTML = toHTML(html`<div class="lb-bar"><span>${m.title}${m.desc ? html` <span style="opacity:.7">— ${m.desc}</span>` : ''}</span><span class="row gap-8"><a class="btn sm" href="${url(m)}" style="background:rgba(255,255,255,.12);color:#fff;border:0">${icon('download', 'sm')}</a><button data-x aria-label="Fechar">${icon('x')}</button></span></div>
      <div class="lb-body">${m.kind === 'video' ? html`<video src="${url(m, true)}" controls playsinline preload="metadata"></video>` : html`<img src="${url(m, true)}" alt="${m.title}">`}</div>
      ${list.length > 1 ? html`<button class="nav-l" data-p aria-label="Anterior">${icon('chevronL')}</button><button class="nav-r" data-n aria-label="Próxima">${icon('chevron')}</button>` : ''}`);
  };
  const close = () => { lb.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') { i = (i + 1) % list.length; show(); } if (e.key === 'ArrowLeft') { i = (i - 1 + list.length) % list.length; show(); } };
  lb.onclick = (e) => { if (e.target.closest('[data-x]') || e.target === lb.querySelector('.lb-body')) return close(); if (e.target.closest('[data-n]')) { i = (i + 1) % list.length; show(); } if (e.target.closest('[data-p]')) { i = (i - 1 + list.length) % list.length; show(); } };
  document.addEventListener('keydown', key);
  show(); document.body.appendChild(lb);
}

const files = (list) => (list.length ? html`<div class="files">${list.map((f) => html`<div class="file" data-ref="doc-${f.id}"><div class="file-ico">${fileExt(f.file_name)}</div><div class="grow"><a class="li-title" href="${url(f, true)}" target="_blank" rel="noopener">${f.title}</a><div class="li-sub">${[f.category, f.size ? bytes(f.size) : null, date(f.published_at || f.created_at)].filter(Boolean).join(' · ')}</div></div><a class="icon-btn" href="${url(f)}" aria-label="Baixar">${icon('download', 'sm')}</a></div>`)}</div>` : html`<div class="muted small">Nenhum arquivo liberado ainda.</div>`);
const coverImg = (p) => (p.cover ? html`<img src="${p.cover.url}" alt="${p.name}" style="object-position:${p.cover.x}% ${p.cover.y}%;transform:scale(${p.cover.zoom});--fx:${p.cover.x}%;--fy:${p.cover.y}%">` : '');
const pending = (p) => p.approvals.filter((a) => a.status === 'aberta');

const VIEWS = {
  visao: (p, d) => {
    const pend = pending(p);
    const waiting = p.approvals.filter((a) => a.status === 'ajustes');
    return html`<div>
      <div class="pt-hello"><h2>Olá, ${d.client.name.split(' ')[0]}.</h2><p>Acompanhe seu projeto e veja o que precisa da sua atenção.</p></div>
      ${p.portal_message ? html`<div class="pt-note notes">${p.portal_message}</div>` : ''}
      <div class="pt-card pt-phase">${icon('bars')}<span class="lbl">Fase atual:<b>${p.current_phase || 'a definir'}</b></span><div class="progress"><span style="width:${p.progress || 0}%"></span></div><span class="pct">${p.progress || 0}%</span></div>
      <div class="pt-main">
        <div class="pt-card pt-cover"><div class="frame ${p.cover ? '' : 'empty'}">${p.cover ? coverImg(p) : html`<div><div class="eyebrow">Projeto</div><div class="nm">${p.name}</div></div>`}</div>
          <div class="foot"><div><h3>Veja seu projeto</h3><div class="pt-sub">Imagens, vídeos e apresentações em um só lugar.</div></div><button class="btn primary" data-go="projeto" style="height:44px;padding:0 34px">Abrir projeto</button></div></div>
        <div class="pt-side">
          <div class="pt-card ${pend.length ? 'soft' : ''}"><span class="ic ${pend.length ? 'dark' : ''}">${icon(pend.length ? 'excl' : 'check')}</span><div class="grow">
            <h3>Sua participação</h3>
            ${pend.length ? html`<div class="big">${pend.length === 1 ? '1 decisão aguarda você' : `${pend.length} decisões aguardam você`}</div><div class="pt-sub">${pend.slice(0, 3).map((a) => a.title).join(' · ')}</div>
              <div class="right mt-16"><button class="btn primary" data-go="financeiro" data-sub="aprovacoes" data-ref="apr-${pend[0].id}">Revisar agora</button></div>`
              : html`<div class="pt-sub" style="margin-top:8px">Nenhuma decisão pendente no momento.${waiting.length ? ` O escritório está analisando ${waiting.length === 1 ? 'o ajuste que você pediu' : 'os ajustes que você pediu'}.` : ''}</div>`}</div></div>
          <div class="pt-card"><span class="ic">${icon('calendar')}</span><div class="grow"><h3>Próxima etapa</h3>
            ${p.next ? html`<div class="big">${p.next.name}</div>${p.next.after ? html`<div class="pt-sub">Após a conclusão de ${p.next.after}</div>` : ''}` : html`<div class="pt-sub" style="margin-top:8px">A definir pelo escritório.</div>`}
            <div class="due">${icon('calendar', 'sm')} ${p.next && p.next.due ? `Previsão: ${date(p.next.due)}` : 'Prazo a definir'}</div></div></div>
        </div>
      </div>
      <div class="pt-quicks">
        <div class="pt-card pt-quick">${icon('bars')}<div><h3>Andamento</h3><div class="pt-sub">Veja as etapas do seu projeto</div><button class="pt-link" data-go="andamento">Ver cronograma ${icon('arrow', 'sm')}</button></div></div>
        <div class="pt-card pt-quick">${icon('card')}<div><h3>Financeiro</h3><div class="pt-sub">Orçamentos e comparativos</div><button class="pt-link" data-go="financeiro" data-sub="orcamentos">Consultar orçamentos ${icon('arrow', 'sm')}</button></div></div>
        <div class="pt-card pt-quick">${icon('folder')}<div><h3>Documentos</h3><div class="pt-sub">Contratos e arquivos disponíveis</div><button class="pt-link" data-go="documentos">Acessar documentos ${icon('arrow', 'sm')}</button></div></div>
      </div>
      <div class="pt-card pt-updates"><div class="row gap-8" style="margin-bottom:6px">${icon('clock')}<h3 class="serif" style="font-size:22px;font-weight:500">Últimas atualizações</h3></div>
        ${p.updates.length ? p.updates.map((u) => html`<div class="row-u" data-go="${u.tab}" ${u.sub ? html`data-sub="${u.sub}"` : ''} ${u.ref ? html`data-ref="${u.ref}"` : ''} role="link" tabindex="0">${icon('docs', 'sm')}<span>${u.text}</span><span class="dt">${date(u.date)} · ${(TABS.find((t) => t[0] === u.tab) || [])[1] || ''}</span>${icon('arrow', 'sm')}</div>`)
          : html`<div class="muted small" style="padding:8px 0">As novidades do projeto aparecerão aqui.</div>`}</div>
    </div>`;
  },
  projeto: (p) => {
    if (!p.showcase.length) return html`<div class="pt-empty">O escritório ainda não publicou imagens, vídeos ou apresentações deste projeto.</div>`;
    const groups = {};
    p.showcase.forEach((m) => { (groups[m.group || ''] = groups[m.group || ''] || []).push(m); });
    const keys = Object.keys(groups).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : 0));
    const tile = (m) => html`<button class="pt-item" data-media="${m.id}" data-ref="doc-${m.id}" type="button">
      <div class="th">${m.kind === 'imagem' ? html`<img src="${url(m, true)}" alt="${m.title}" loading="lazy">` : m.kind === 'video' ? html`<video src="${url(m, true)}#t=0.5" preload="metadata" muted playsinline></video><span class="play">${icon('play')}</span>` : html`<span class="ext">${(fileExt(m.file_name) || 'PDF').toUpperCase()}</span>`}</div>
      <div class="tx"><b>${m.title}${m.previous ? html`<span class="pt-prev">Versão anterior</span>` : ''}</b><span>${m.desc || { imagem: 'Imagem', video: 'Vídeo', pdf: 'Apresentação em PDF', arquivo: 'Arquivo' }[m.kind]} · ${date(m.date)}</span></div></button>`;
    return html`<div class="col" style="gap:20px">${keys.map((k) => {
      const cur = groups[k].filter((m) => !m.previous); const old = groups[k].filter((m) => m.previous);
      return html`<div>${keys.length > 1 || k ? html`<div class="pt-group">${k || 'Outros materiais'}</div>` : ''}<div class="pt-gal">${cur.map(tile)}</div>
        ${old.length ? html`<details class="mt-16"><summary class="small muted">Versões anteriores (${old.length})</summary><div class="pt-gal mt-8">${old.map(tile)}</div></details>` : ''}</div>`;
    })}</div>`;
  },
  andamento: (p, d) => html`<div class="grid g3"><div class="pt-card span2"><h3 class="serif" style="font-size:22px;font-weight:500;margin-bottom:12px">Cronograma</h3>${p.phases.length ? html`<div class="phase-list">${p.phases.map((ph, i) => {
      const done = ['concluido', 'aprovado'].includes(ph.status); const doing = !done && ph.status !== 'nao_iniciado';
      return html`<div class="ph ${done ? 'done' : doing ? 'doing' : ''}"><div class="ph-num">${done ? '✓' : i + 1}</div><div><div class="cell-title">${ph.name}</div><div class="cell-sub">${PH[ph.status] || ph.status}${ph.due_date && !done ? ` · previsto para ${date(ph.due_date)}` : ''}${done && ph.completed_at ? ` · concluído em ${date(ph.completed_at)}` : ''}</div></div><span></span></div>`;
    })}</div>` : html`<div class="muted small">O cronograma será publicado pelo escritório.</div>`}</div>
    <div class="col" style="gap:14px"><div class="pt-card"><h3 class="serif" style="font-size:20px;font-weight:500;margin-bottom:8px">Próximas etapas</h3>${p.next_phases.length ? html`<div class="list">${p.next_phases.map((x) => html`<div class="list-item"><div class="grow"><div class="li-title">${x.name}</div><div class="li-sub">${x.due_date ? date(x.due_date) : 'Prazo a definir'}</div></div></div>`)}</div>` : html`<div class="muted small">Sem etapas pendentes.</div>`}</div>
      ${d.events.filter((e) => !e.project_id || e.project_id === p.id).length ? html`<div class="pt-card"><h3 class="serif" style="font-size:20px;font-weight:500;margin-bottom:8px">Próximos compromissos</h3><div class="list">${d.events.filter((e) => !e.project_id || e.project_id === p.id).map((e) => html`<div class="list-item"><div class="grow"><div class="li-title">${e.title}</div><div class="li-sub">${date(e.start_at)}${e.all_day ? '' : ' às ' + time(e.start_at)}${e.location ? ' · ' + e.location : ''}</div></div></div>`)}</div></div>` : ''}
      ${(p.minutes || []).length ? html`<div class="pt-card"><h3 class="serif" style="font-size:20px;font-weight:500;margin-bottom:8px">Atas de reunião</h3><div class="timeline">${p.minutes.map((a) => html`<div class="tl" data-ref="ata-${a.id}"><div class="row between wrap"><div class="d">${date(a.date)} · ${a.title || 'Reunião'}</div><a class="btn xs" href="/api/portal/minutes/${a.id}/pdf" target="_blank" rel="noopener">${icon('download', 'sm')} PDF</a></div>
        ${a.next_steps && a.next_steps.length ? html`<div class="small mt-8"><b>Próximos passos:</b><ul style="margin:4px 0 0 18px;padding:0">${a.next_steps.map((n) => html`<li>${n.acao}${n.responsavel ? ' — ' + n.responsavel : ''}${n.prazo ? ' · até ' + date(n.prazo) : ''}</li>`)}</ul></div>` : ''}</div>`)}</div></div>` : ''}</div></div>`,
  obra: (p) => (p.works.length ? html`<div class="col" style="gap:14px">${p.works.map((w) => html`<div class="pt-card"><div class="row between wrap"><h3 class="serif" style="font-size:24px;font-weight:500">${w.name || 'Obra'}</h3><span class="badge ${w.status === 'concluida' ? 'success' : 'info'}">${{ planejada: 'Planejada', em_andamento: 'Em andamento', pausada: 'Pausada', concluida: 'Concluída' }[w.status] || w.status}</span></div>
      <div class="row between small mt-16"><span>Execução</span><b>${w.progress}%</b></div><div class="progress mt-8"><span style="width:${w.progress}%"></span></div>
      <div class="small muted mt-8">${w.start_date ? 'Início ' + date(w.start_date) : ''}${w.due_date ? ' · previsão ' + date(w.due_date) : ''}</div>
      ${w.phases.length ? html`<div class="grid g3 mt-24">${w.phases.map((ph) => html`<div><div class="row between small"><span>${ph.name}</span><span class="muted">${ph.progress}%</span></div><div class="progress thin mt-8"><span style="width:${ph.progress}%"></span></div></div>`)}</div>` : ''}
      ${w.updates.length ? html`<div class="eyebrow mt-32 mb-16">Diário da obra</div><div class="timeline">${w.updates.map((u) => html`<div class="tl"><div class="d">${date(u.date)}</div><div class="x notes">${u.description}</div>${u.decisions ? html`<div class="small mt-8"><b>Decisões:</b> ${u.decisions}</div>` : ''}
        ${u.photos.length ? html`<div class="gallery mt-8">${u.photos.map((f) => html`<a href="${url(f, true)}" target="_blank" rel="noopener"><img src="${url(f, true)}" loading="lazy" alt=""></a>`)}</div>` : ''}</div>`)}</div>` : ''}</div>`)}</div>` : html`<div class="pt-empty">A obra deste projeto ainda não foi iniciada.</div>`),
  documentos: (p) => html`<div class="col" style="gap:14px"><div class="pt-card"><h3 class="serif" style="font-size:22px;font-weight:500;margin-bottom:10px">Documentos liberados</h3>${files(p.documents)}</div>
    ${(p.minutes || []).length ? html`<div class="pt-card"><h3 class="serif" style="font-size:22px;font-weight:500;margin-bottom:10px">Atas de reunião</h3><div class="files">${p.minutes.map((a) => html`<div class="file"><div class="file-ico">PDF</div><div class="grow"><a class="li-title" href="/api/portal/minutes/${a.id}/pdf" target="_blank" rel="noopener">${a.title || 'Reunião'}</a><div class="li-sub">${date(a.date)}${a.number ? ' · ' + a.number : ''}</div></div></div>`)}</div></div>` : ''}</div>`,
  financeiro: (p, d, st) => {
    const inst = d.finance.installments.filter((i) => !i.project_id || i.project_id === p.id);
    const subs = [['orcamentos', 'Orçamentos'], ['comparativo', 'Comparativo de orçamentos'], ['aprovacoes', `Aprovações${pending(p).length ? ` (${pending(p).length})` : ''}`], inst.length ? ['pagamentos', 'Pagamentos ao escritório'] : null].filter(Boolean);
    if (!subs.find((s) => s[0] === st.sub)) st.sub = 'orcamentos';
    return html`<div><div class="pt-subtabs">${subs.map(([k, l]) => html`<button data-sub="${k}" class="${k === st.sub ? 'on' : ''}">${l}</button>`)}</div>${FIN[st.sub](p, d, st, inst)}</div>`;
  },
};

const quoteFiles = (q) => (q.files.length ? q.files.map((f) => html`<a class="btn xs" href="${url(f, true)}" target="_blank" rel="noopener">${icon('eye', 'sm')} Ver proposta</a>`) : '');
const FIN = {
  orcamentos: (p) => (!p.quotes.length ? html`<div class="pt-empty">Nenhum orçamento de fornecedor liberado no momento.</div>` : html`<div>
    <div class="pt-note">Orçamentos de fornecedores para a obra, enviados pelo escritório para sua avaliação. Eles não incluem os honorários do escritório.</div>
    <div class="col" style="gap:14px">${p.quotes.map((g) => html`<div class="pt-card" data-ref="cat-${g.item}"><div class="row between wrap" style="margin-bottom:6px"><h3 class="serif" style="font-size:24px;font-weight:500">${g.item}</h3>
      <span class="small muted">${g.options.length} ${g.options.length > 1 ? 'opções' : 'opção'}${g.options.length > 1 ? html` · <button class="pt-link" style="margin:0" data-go="financeiro" data-sub="comparativo" data-ref="cmp">Comparar</button>` : ''}</span></div>
      ${g.options.map((q) => html`<div class="pt-q"><div><b>${q.supplier}</b><div class="small muted">${q.status_label}${q.version > 1 ? ` · versão ${q.version}` : ''}${q.valid_until ? ` · válido até ${date(q.valid_until)}` : ''}</div></div>
        <div><span class="k">Valor</span>${q.amount ? money(q.amount) : NI}</div><div><span class="k">Prazo</span>${q.deadline_days ? `${q.deadline_days} dias` : NI}</div><div><span class="k">Pagamento</span>${val(q.payment_terms)}</div>
        <div class="row gap-8">${quoteFiles(q)}</div>
        <details><summary>Escopo, itens incluídos e não incluídos</summary><div class="pt-meta mt-8"><div><span class="k">Escopo</span>${val(q.scope)}</div><div><span class="k">Itens incluídos</span>${ul(q.included)}</div><div><span class="k">Não incluídos</span>${ul(q.excluded)}</div><div><span class="k">Observações</span>${val(q.client_notes)}</div></div></details></div>`)}
    </div>`)}</div></div>`),
  comparativo: (p, d, st) => {
    const cats = p.quotes.filter((g) => g.options.length);
    if (!cats.length) return html`<div class="pt-empty">Nenhum orçamento liberado para comparação.</div>`;
    const g = cats.find((c) => c.item === st.cmpItem) || cats.find((c) => c.options.length > 1) || cats[0]; st.cmpItem = g.item;
    const sel = st.cmpSel && st.cmpSel.length ? g.options.filter((o) => st.cmpSel.includes(o.id)) : g.options;
    // itens que um fornecedor inclui e outro não (evidencia diferença de escopo)
    const all_ = []; const seen = new Set(); sel.forEach((q) => q.included.forEach((i) => { const k = norm(i); if (!seen.has(k)) { seen.add(k); all_.push([k, i]); } }));
    const missing = (q) => { const mine = new Set(q.included.map(norm)); return q.included.length ? all_.filter(([k]) => !mine.has(k)).map(([, t]) => t) : null; };
    const rows = [['Valor', (q) => (q.amount ? html`<b>${money(q.amount)}</b>` : NI)], ['Prazo', (q) => (q.deadline_days ? `${q.deadline_days} dias` : NI)], ['Condições de pagamento', (q) => val(q.payment_terms)],
      ['Itens incluídos', (q) => ul(q.included)], ['Não incluídos', (q) => ul(q.excluded)],
      ['Inclusos em outra opção e não nesta', (q) => { const m = missing(q); return m === null ? NI : m.length ? html`<ul class="pt-miss">${m.map((x) => html`<li>${x}</li>`)}</ul>` : '—'; }],
      ['Observações', (q) => val(q.client_notes)], ['Proposta', (q) => quoteFiles(q) || html`<button class="btn xs" data-go="financeiro" data-sub="orcamentos" data-ref="cat-${q.item}">Ver detalhes</button>`]];
    const diff = sel.some((q) => { const m = missing(q); return m && m.length; });
    return html`<div data-ref="cmp"><div class="row wrap gap-16" style="margin-bottom:14px"><label class="small">Categoria&nbsp; <select data-cmp-item style="height:36px;border-radius:8px;border:1px solid var(--g-line);padding:0 10px">${cats.map((c) => html`<option ${c.item === g.item ? 'selected' : ''}>${c.item}</option>`)}</select></label>
      <div class="chips">${g.options.map((o) => html`<label class="chip ${sel.includes(o) ? 'on' : ''}"><input type="checkbox" value="${o.id}" data-cmp-q ${sel.includes(o) ? 'checked' : ''} style="display:none">${o.supplier}</label>`)}</div></div>
      <div class="pt-note">${diff ? 'Atenção: os orçamentos não têm o mesmo escopo. Compare os itens incluídos antes de comparar os valores — o menor valor não é necessariamente a melhor escolha.' : 'O menor valor não é necessariamente a melhor escolha: compare escopo, prazo e condições.'}</div>
      <div class="pt-card pt-cmp-table" style="padding:0;overflow:auto"><table class="pt-cmp"><thead><tr><th>Fornecedor</th>${sel.map((q) => html`<th>${q.supplier}${q.version > 1 ? html` <span class="small muted">v${q.version}</span>` : ''}</th>`)}</tr></thead>
        <tbody>${rows.map(([l, f]) => html`<tr><th scope="row">${l}</th>${sel.map((q) => html`<td>${f(q)}</td>`)}</tr>`)}</tbody></table></div>
      <div class="pt-cmp-cards">${sel.map((q) => html`<div class="pt-card"><h4 class="serif" style="font-size:20px;font-weight:500;margin-bottom:8px">${q.supplier}</h4><div class="pt-meta">${rows.map(([l, f]) => html`<div><span class="k">${l}</span>${f(q)}</div>`)}</div></div>`)}</div></div>`;
  },
  aprovacoes: (p) => (!p.approvals.length ? html`<div class="pt-empty">Nenhuma decisão pendente no momento.</div>` : html`<div class="col" style="gap:14px">
    <div class="pt-note">Aqui ficam as decisões que dependem de você. Aprovar uma opção não é pagamento nem contratação: o escritório cuida dos próximos passos.</div>
    ${p.approvals.map((a) => {
      const open = a.status === 'aberta';
      const q = (id) => p.quotes.flatMap((g) => g.options).find((x) => x.id === id);
      return html`<div class="pt-card pt-apr" data-ref="apr-${a.id}"><div class="hd"><h4>${a.title}</h4><span class="badge ${APR_TONE[a.status] || ''}">${a.status === 'ajustes' ? 'Ajustes solicitados — com o escritório' : a.status_label}</span></div>
        <div class="pt-meta">${a.reason ? html`<div><span class="k">Por que é necessária</span>${a.reason}</div>` : ''}${a.blocks_stage ? html`<div><span class="k">Etapa que depende desta decisão</span>${a.blocks_stage}</div>` : ''}
          <div><span class="k">Prazo para resposta</span>${a.due_date ? date(a.due_date) : 'Sem prazo definido'}</div>
          ${a.quote_item ? html`<div><span class="k">Categoria</span>${a.quote_item} · <button class="pt-link" style="margin:0" data-go="financeiro" data-sub="orcamentos" data-ref="cat-${a.quote_item}">ver orçamentos</button></div>` : ''}
          ${a.document_id ? html`<div><span class="k">Material para revisar</span><a class="pt-link" style="margin:0" href="/api/portal/files/${a.document_id}?inline=1" target="_blank" rel="noopener">abrir arquivo</a></div>` : ''}</div>
        ${a.status === 'aprovada' && a.decided ? html`<div class="small success-text">Aprovado: ${a.decided.supplier || a.decided.item || ''} — versão ${a.decided.version || 1}${a.decided_at ? ` · ${datetime(a.decided_at)}` : ''}</div>` : ''}
        ${open && a.options.length ? html`<div><div class="small muted" style="margin-bottom:6px">Escolha a opção que deseja aprovar</div><div class="pt-opts">${a.options.map((o, i) => html`<label><input type="radio" name="opt-${a.id}" value="${o.id}" ${a.options.length === 1 ? 'checked' : ''}> <span class="grow">${o.supplier}${o.version > 1 ? ` (versão ${o.version})` : ''}</span><span>${o.amount ? money(o.amount) : 'valor não informado'}</span></label>`)}</div></div>` : ''}
        ${open ? html`<div class="row wrap gap-8"><button class="btn primary" data-approve="${a.id}">${icon('check', 'sm')} Aprovar${a.options.length ? ' opção selecionada' : ''}</button><button class="btn" data-adjust="${a.id}">Solicitar ajustes</button></div>` : ''}
        ${a.events.length ? html`<details><summary class="small muted">Histórico da decisão (${a.events.length})</summary><div class="pt-hist mt-8">${a.events.map((e) => html`<div><div class="d">${datetime(e.created_at)}${e.by ? ` · ${e.by}` : ''}${e.confirmed_at && e.actor === 'escritorio' ? ` · confirmado em ${date(e.confirmed_at)}` : ''}</div><div>${e.label}</div>
          ${e.snapshot ? html`<div class="small muted">${[e.snapshot.supplier, e.snapshot.amount ? money(e.snapshot.amount) : null, `versão ${e.snapshot.version}`].filter(Boolean).join(' · ')}</div>` : ''}${e.comment ? html`<div class="small">${e.comment}</div>` : ''}</div>`)}</div></details>` : ''}</div>`;
    })}</div>`),
  pagamentos: (p, d, st, inst) => {
    const sum = (f) => inst.filter(f).reduce((s, i) => s + i.amount, 0);
    return html`<div><div class="pt-note">Parcelas dos honorários do escritório (diferentes dos orçamentos de fornecedores).</div><div class="grid g4"><div class="card kpi"><span class="label">Valor contratado</span><span class="value">${money(p.contract_value || d.finance.contracted)}</span></div>
      <div class="card kpi"><span class="label">Pago</span><span class="value">${money(sum((i) => i.status === 'recebido'))}</span></div>
      <div class="card kpi"><span class="label">A vencer</span><span class="value">${money(sum((i) => ['a_receber', 'previsto'].includes(i.status)))}</span></div>
      <div class="card kpi ${sum((i) => i.status === 'vencido') ? 'alert' : ''}"><span class="label">Vencido</span><span class="value">${money(sum((i) => i.status === 'vencido'))}</span></div></div>
      <div class="table-wrap mt-16"><table class="t responsive"><thead><tr><th>Parcela</th><th>Descrição</th><th>Vencimento</th><th class="right">Valor</th><th>Pagamento</th><th>Situação</th><th></th></tr></thead><tbody>
        ${inst.map((i) => html`<tr><td data-l="Parcela">${i.installment_total > 1 ? `${i.installment_no}/${i.installment_total}` : 'Única'}</td><td data-l="Descrição">${i.description}</td><td data-l="Vencimento">${date(i.due_date)}</td><td class="right" data-l="Valor">${money(i.amount)}</td><td data-l="Pago em">${i.paid_at ? date(i.paid_at) : '—'}</td>
          <td data-l="Situação"><span class="badge ${INT[i.status] || ''}">${IN[i.status] || i.status}</span></td><td class="actions">${i.receipts.map((r) => html`<a class="btn xs" href="${url(r)}">${icon('download', 'sm')} Comprovante</a>`)}${(i.receipt_docs || []).map((r) => html`<a class="btn xs" href="/api/portal/receipts/${r.id}/pdf" target="_blank" rel="noopener">${icon('download', 'sm')} Recibo ${r.number}</a>`)}</td></tr>`)}</tbody></table></div></div>`;
  },
};
