// ÁREA DO CLIENTE — controles internos por projeto: capa, materiais publicados, próxima etapa,
// orçamentos liberados, pendências de aprovação e registro de decisões confirmadas fora do portal.
import { api, html, el, toHTML, icon, money, date, datetime, toast, fail, modal, confirmDialog, uploadFiles, fileExt, today, $$, debounce, esc } from '../lib.js';
import { compareDrawer } from './quotes.js';

const KIND = { orcamento: 'Escolha de orçamento', documento: 'Aprovação de documento/projeto', material: 'Escolha de material', outro: 'Outra decisão' };
const TONE = { aberta: 'warning', ajustes: 'info', aprovada: 'success', cancelada: 'muted' };
const isImg = (m) => /^image\//.test(m.mime || '');
const kindOf = (m) => (isImg(m) ? 'Imagem' : /^video\//.test(m.mime || '') ? 'Vídeo' : /pdf$/i.test(m.mime || '') ? 'PDF' : 'Arquivo');
const fileUrl = (id) => `/api/files/${id}?inline=1`;

export async function clientAreaPanel(body, projectId) {
  body.innerHTML = '<div class="empty sm">Carregando…</div>';
  let d;
  const load = async () => { d = await api.get(`/projects/${projectId}/client-area`); };
  try { await load(); } catch (e) { body.innerHTML = toHTML(html`<div class="empty">${e.message}</div>`); return; }
  const reload = async (msg) => { try { await load(); render(); if (msg) toast(msg); } catch (e) { fail(e); } };
  const cv = { doc_id: null, src: null, x: 50, y: 50, zoom: 1, dirty: false };
  const resetCover = () => { const c = d.project.cover; Object.assign(cv, c ? { doc_id: c.doc.id, src: `/api/projects/${projectId}/cover-image?v=${Date.now()}`, x: c.x, y: c.y, zoom: c.zoom } : { doc_id: null, src: null, x: 50, y: 50, zoom: 1 }, { dirty: false }); };
  resetCover();

  const render = () => {
    const P = d.project;
    const pend = d.approvals.filter((a) => a.status === 'aberta').length; const adj = d.approvals.filter((a) => a.status === 'ajustes').length;
    body.innerHTML = toHTML(html`<div class="col" style="gap:16px">
      ${!d.has_portal_user ? html`<div class="callout warn">O cliente ainda não tem acesso à Área do Cliente. O que for publicado aqui aparece para ele quando o acesso for criado (Clientes › Acesso ao portal).</div>` : ''}
      ${adj ? html`<div class="callout warn"><b>${adj} pedido(s) de ajuste do cliente</b> aguardam o escritório. Veja em “Pendências de aprovação”.</div>` : ''}
      <div class="grid g2">
        <section class="card"><div class="card-head"><h3>Capa do portal do cliente</h3>${P.cover ? html`<span class="small muted">${P.cover.optimized ? 'versão otimizada para exibição' : 'usando o arquivo original'}</span>` : ''}</div>
          <div class="ca-prev"><div><div class="tiny muted mb-8">Computador</div><div class="ca-frame desk" data-f="d"></div></div><div><div class="tiny muted mb-8">Celular</div><div class="ca-frame mob" data-f="m"></div></div></div>
          <div class="form-grid mt-16 ${cv.src ? '' : 'hidden'}" data-sliders>
            <div class="field"><label>Foco horizontal</label><input type="range" min="0" max="100" value="${cv.x}" data-cv="x"></div>
            <div class="field"><label>Foco vertical</label><input type="range" min="0" max="100" value="${cv.y}" data-cv="y"></div>
            <div class="field"><label>Aproximação</label><input type="range" min="1" max="2.5" step="0.05" value="${cv.zoom}" data-cv="zoom"></div></div>
          <div class="row wrap gap-8 mt-16"><button class="btn sm" data-pick>${icon('image', 'sm')} Escolher imagem do projeto</button><button class="btn sm" data-upcover>${icon('upload', 'sm')} Enviar nova imagem</button><input type="file" accept="image/jpeg,image/png" class="hidden" data-coverfile>
            <span class="grow"></span>${P.cover ? html`<button class="btn sm danger" data-rmcover>Remover capa</button>` : ''}<button class="btn sm primary" data-savecover ${cv.dirty ? '' : 'disabled'}>${icon('check', 'sm')} Salvar capa</button></div>
          <div class="hint mt-8">O arquivo original é preservado; o enquadramento é só visual. Novos envios não trocam a capa.</div></section>
        <section class="card"><div class="card-head"><h3>Visão geral do cliente</h3></div>
          <div class="pt-meta mb-16"><div><span class="k">Etapa atual (cronograma)</span>${P.current_phase || '—'}</div><div><span class="k">Progresso</span>${P.progress || 0}%</div><div><span class="k">Decisões aguardando o cliente</span>${pend}</div></div>
          <form class="form-grid" data-next onsubmit="return false">
            <div class="field"><label>Próxima etapa</label><input name="next_step" value="${P.next_step || ''}" placeholder="${P.derived_next ? P.derived_next.name + ' (do cronograma)' : 'Ex.: Projeto executivo'}"></div>
            <div class="field"><label>Prazo da próxima etapa</label><input type="date" name="next_step_due" value="${P.next_step_due || ''}"><span class="hint">Vazio: o cliente vê “Prazo a definir”.</span></div>
            <div class="field wide"><label>Mensagem do escritório na Área do Cliente</label><textarea name="portal_message" rows="3">${P.portal_message || ''}</textarea></div>
            <div class="field wide"><div class="row"><span class="grow"></span><button class="btn sm primary" data-savenext>${icon('check', 'sm')} Salvar</button></div></div></form></section>
      </div>

      <section class="card"><div class="card-head"><h3>“Veja seu projeto” — imagens, vídeos e apresentações</h3><div class="row gap-8"><button class="btn sm" data-upmedia>${icon('upload', 'sm')} Enviar arquivos</button><input type="file" multiple accept="image/*,video/*,application/pdf" class="hidden" data-mediafile></div></div>
        <div class="hint mb-16">Arquivos enviados ficam internos até você marcar “Publicado”. Retirar da visualização não apaga o arquivo nem o histórico.</div>
        ${d.media.length ? html`<datalist id="ca-groups">${[...new Set([...d.groups, ...d.phases])].map((g) => html`<option value="${g}">`)}</datalist><div class="ca-media">${d.media.map((m, i) => html`<div class="ca-row" data-m="${m.id}">
          <div class="ca-th">${isImg(m) ? html`<img src="${fileUrl(m.id)}" alt="" loading="lazy">` : html`<span>${fileExt(m.file_name).toUpperCase() || kindOf(m)}</span>`}</div>
          <div class="ca-fields"><input class="input" data-k="portal_title" value="${m.portal_title || ''}" placeholder="${m.title}" aria-label="Título para o cliente" data-sentence>
            <input class="input" data-k="portal_group" value="${m.portal_group || ''}" list="ca-groups" placeholder="Ambiente ou etapa" aria-label="Ambiente ou etapa">
            <input class="input" data-k="portal_desc" value="${m.portal_desc || ''}" placeholder="Descrição curta (opcional)" aria-label="Descrição" data-sentence>
            <select class="input" data-k="replaced_by" aria-label="Versão"><option value="">Versão atual</option>${d.media.filter((o) => o.id !== m.id).map((o) => html`<option value="${o.id}" ${m.replaced_by === o.id ? 'selected' : ''}>Versão anterior de: ${o.portal_title || o.title}</option>`)}</select></div>
          <div class="ca-pub"><label class="toggle"><input type="checkbox" data-pub ${m.client_visible ? 'checked' : ''}><span class="sw"></span><span class="small">${m.client_visible ? 'Publicado' : 'Interno'}</span></label>
            ${m.client_visible ? html`<select class="input" data-k="showcase" style="height:30px;font-size:12px"><option value="1" ${m.showcase ? 'selected' : ''}>em Veja seu projeto</option><option value="0" ${!m.showcase ? 'selected' : ''}>em Documentos</option></select>` : ''}
            <span class="tiny muted">${kindOf(m)} · ${m.published_at && m.client_visible ? 'publicado ' + date(m.published_at) : 'enviado ' + date(m.created_at)}</span>
            <div class="row gap-8"><button class="icon-btn" data-up="${i}" title="Subir" ${i ? '' : 'disabled'}>${icon('out', 'sm')}</button><a class="icon-btn" href="${fileUrl(m.id)}" target="_blank" rel="noopener" title="Abrir">${icon('eye', 'sm')}</a></div></div>
        </div>`)}</div>` : html`<div class="empty sm">Nenhuma imagem, vídeo ou apresentação neste projeto.</div>`}</section>

      <div class="grid g2">
        <section class="card"><div class="card-head"><h3>Orçamentos para o cliente</h3><a class="btn sm" href="#/projetos/${projectId}?tab=orcamentos">Abrir orçamentos</a></div>
          ${d.quotes.length ? html`<table class="t"><thead><tr><th>Categoria</th><th>Opções</th><th>Liberados</th><th></th></tr></thead><tbody>${d.quotes.map((q) => html`<tr><td>${q.item}</td><td>${q.n}</td><td>${q.visible || 0}${q.selected ? html` <span class="badge success plain">escolhido</span>` : ''}</td>
            <td class="actions">${q.n > 1 ? html`<button class="btn xs" data-cmp="${q.item}">Comparar</button>` : ''}<button class="btn xs" data-ask="${q.item}">Pedir aprovação</button></td></tr>`)}</tbody></table>
            <div class="hint mt-8">Para liberar um orçamento, abra-o em Orçamentos e ative “Liberar ao cliente”. O cliente vê valor, prazo, condições, escopo e o arquivo anexado.</div>` : html`<div class="empty sm">Nenhum orçamento cadastrado neste projeto.</div>`}</section>
        <section class="card"><div class="card-head"><h3>Histórico</h3></div>${d.history.length ? html`<div class="pt-hist" style="max-height:320px;overflow:auto">${d.history.slice(0, 30).map((e) => html`<div><div class="d">${datetime(e.created_at)}${e.by ? ` · ${e.by}` : ''}</div><div><b>${e.approval_title}</b> — ${e.label}</div>${e.comment ? html`<div class="small muted">${e.comment}</div>` : ''}</div>`)}</div>` : html`<div class="empty sm">Sem registros ainda.</div>`}</section>
      </div>

      <section class="card"><div class="card-head"><h3>Pendências de aprovação do cliente</h3><button class="btn sm primary" data-newapr>${icon('plus', 'sm')} Nova pendência</button></div>
        <div class="hint mb-16">Aprovar não registra pagamento, não contrata fornecedor e não conclui serviço — esses controles continuam separados.</div>
        ${d.approvals.length ? html`<div class="col" style="gap:12px">${d.approvals.map((a) => html`<div class="ca-apr" data-a="${a.id}"><div class="row between wrap gap-8"><div><b>${a.title}</b> <span class="badge ${TONE[a.status]}">${a.status === 'ajustes' ? 'Ajustes solicitados — ação do escritório' : a.status_label}</span>${a.client_visible ? '' : html` <span class="badge muted">oculta do cliente</span>`}</div>
            <div class="row gap-8 wrap">${['aberta', 'ajustes'].includes(a.status) ? html`<button class="btn xs primary" data-reg="${a.id}">Registrar decisão do cliente</button>` : ''}<button class="btn xs" data-edit="${a.id}">Editar</button>${['ajustes', 'aprovada', 'cancelada'].includes(a.status) ? html`<button class="btn xs" data-reopen="${a.id}">Reabrir para o cliente</button>` : html`<button class="btn xs" data-cancel="${a.id}">Cancelar</button>`}</div></div>
          <div class="pt-meta mt-8"><div><span class="k">Tipo</span>${KIND[a.kind] || a.kind}${a.quote_item ? ` · ${a.quote_item}` : ''}</div>${a.blocks_stage ? html`<div><span class="k">Etapa que depende</span>${a.blocks_stage}</div>` : ''}<div><span class="k">Prazo</span>${a.due_date ? date(a.due_date) : '—'}</div>
            ${a.decided ? html`<div><span class="k">Aprovado</span>${a.decided.supplier || a.decided.item} · versão ${a.decided.version || 1}${a.decided.current_version > (a.decided.version || 1) ? html` <span class="badge warning plain">orçamento já está na v${a.decided.current_version}</span>` : ''}</div>` : ''}</div>
          ${a.reason ? html`<div class="small mt-8 muted">${a.reason}</div>` : ''}
          <details class="mt-8"><summary class="small">Histórico (${a.events.length})</summary><div class="pt-hist mt-8">${a.events.map((e) => html`<div><div class="d">${datetime(e.created_at)}${e.by ? ` · ${e.by}` : ''}${e.confirmed_at && e.actor === 'escritorio' ? ` · confirmação em ${date(e.confirmed_at)}` : ''}</div><div>${e.label}</div>
            ${e.snapshot ? html`<div class="small muted">${[e.snapshot.supplier, e.snapshot.amount ? money(e.snapshot.amount) : null, `versão ${e.snapshot.version}`].filter(Boolean).join(' · ')}</div>` : ''}${e.comment ? html`<div class="small">${e.comment}</div>` : ''}
            ${e.attachment_doc_id ? html`<a class="small" href="${fileUrl(e.attachment_doc_id)}" target="_blank" rel="noopener">${icon('clip', 'sm')} comprovante</a>` : ''}
            ${['aprovada', 'ajustes'].includes(e.action) ? html`<button class="btn xs mt-8" data-fix="${a.id}:${e.id}">Corrigir registro</button>` : ''}</div>`)}</div></details></div>`)}</div>`
          : html`<div class="empty sm">Nenhuma pendência. Crie uma quando algo depender de decisão do cliente (ex.: escolher a marcenaria).</div>`}</section>
    </div>`);
    paintCover();
    bind();
  };

  const coverStyle = () => `object-position:${cv.x}% ${cv.y}%;transform:scale(${cv.zoom});transform-origin:${cv.x}% ${cv.y}%`;
  const paintCover = () => {
    $$('[data-f]', body).forEach((f) => { f.innerHTML = cv.src ? `<img src="${esc(cv.src)}" alt="" style="${coverStyle()}">` : `<div class="ca-empty">${esc(d.project.name)}</div>`; });
    const sb = body.querySelector('[data-savecover]'); if (sb) sb.disabled = !cv.dirty;
    const sl = body.querySelector('[data-sliders]'); if (sl) sl.classList.toggle('hidden', !cv.src);
  };
  const setCover = (doc) => { Object.assign(cv, { doc_id: doc.id, src: fileUrl(doc.id), x: 50, y: 50, zoom: 1, dirty: true }); paintCover(); };

  const bind = () => {
    const q = (s) => body.querySelector(s);
    $$('[data-cv]', body).forEach((r) => (r.oninput = () => { cv[r.dataset.cv] = Number(r.value); cv.dirty = true; $$('[data-f] img', body).forEach((i) => i.setAttribute('style', coverStyle())); const sb = q('[data-savecover]'); if (sb) sb.disabled = false; }));
    q('[data-pick]').onclick = () => {
      const imgs = d.media.filter(isImg);
      if (!imgs.length) return toast('Não há imagens neste projeto. Use “Enviar nova imagem”.', { error: true });
      const m = modal({ title: 'Escolher a capa', body: html`<div class="ca-pick">${imgs.map((i) => html`<button type="button" data-i="${i.id}"><img src="${fileUrl(i.id)}" alt="" loading="lazy"><span>${i.portal_title || i.title}</span></button>`)}</div>`, actions: [{ label: 'Fechar' }] });
      m.el.style.width = 'min(820px, calc(100vw - 32px))';
      m.body.onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; setCover(imgs.find((x) => x.id === Number(b.dataset.i))); m.close(); };
    };
    const cf = q('[data-coverfile]');
    q('[data-upcover]').onclick = () => cf.click();
    cf.onchange = async () => {
      if (!cf.files.length) return;
      try { const r = await uploadFiles(cf.files, { project_id: projectId, category: 'Imagens / renders' }); await load(); const doc = d.media.find((m) => m.id === r.ids[0]) || { id: r.ids[0] }; render(); setCover(doc); toast('Imagem enviada (interna). Ajuste o enquadramento e salve a capa.'); } catch (e) { fail(e); }
    };
    q('[data-savecover]').onclick = async (e) => {
      if (!cv.doc_id) return;
      const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span> Salvando…';
      try { const r = await api.put(`/projects/${projectId}/cover`, { doc_id: cv.doc_id, x: cv.x, y: cv.y, zoom: cv.zoom }); await load(); resetCover(); render(); toast(r.note || 'Capa salva. Ela já aparece na Área do Cliente.'); } catch (err) { fail(err); b.disabled = false; b.textContent = 'Salvar capa'; }
    };
    const rc = q('[data-rmcover]');
    if (rc) rc.onclick = async () => { if (!(await confirmDialog('Remover a capa? A imagem continua nos arquivos do projeto; o cliente passa a ver um cartão neutro com o nome do projeto.', { title: 'Remover capa', ok: 'Remover' }))) return; try { await api.del(`/projects/${projectId}/cover`); await load(); resetCover(); render(); toast('Capa removida.'); } catch (e) { fail(e); } };
    q('[data-savenext]').onclick = async () => {
      const f = q('[data-next]'); const v = Object.fromEntries(new FormData(f));
      try { await api.put(`/projects/${projectId}/next-step`, v); reload('Informações da visão geral salvas.'); } catch (e) { fail(e); }
    };
    // materiais
    const mf = q('[data-mediafile]');
    q('[data-upmedia]').onclick = () => mf.click();
    mf.onchange = async () => { if (!mf.files.length) return; try { await uploadFiles(mf.files, { project_id: projectId, category: 'Apresentações' }); reload(`${mf.files.length} arquivo(s) enviado(s) como internos. Marque “Publicado” para o cliente ver.`); } catch (e) { fail(e); } };
    const putDoc = async (id, data, msg) => { try { await api.put(`/documents/${id}/showcase`, data); toast(msg || 'Salvo.'); return true; } catch (e) { fail(e); return false; } };
    const saveField = debounce((id, k, v) => putDoc(id, { [k]: v }, 'Material atualizado.'), 500);
    $$('.ca-row', body).forEach((row) => {
      const id = Number(row.dataset.m);
      $$('[data-k]', row).forEach((inp) => {
        const k = inp.dataset.k;
        if (inp.tagName === 'SELECT') inp.onchange = async () => { const v = k === 'showcase' ? inp.value === '1' : inp.value || null; if (await putDoc(id, { [k]: v }, k === 'replaced_by' ? 'Versão atualizada.' : 'Local de exibição atualizado.')) reload(); };
        else inp.oninput = () => saveField(id, k, inp.value);
      });
      row.querySelector('[data-pub]').onchange = async (e) => { const on = e.target.checked; if (await putDoc(id, on ? { client_visible: 1, showcase: d.media.find((m) => m.id === id).client_visible ? undefined : 1 } : { client_visible: 0 }, on ? 'Publicado para o cliente.' : 'Retirado da visualização do cliente.')) reload(); };
    });
    $$('[data-up]', body).forEach((b) => (b.onclick = async () => {
      const i = Number(b.dataset.up); if (!i) return; const ids = d.media.map((m) => m.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
      try { await api.post(`/projects/${projectId}/showcase-order`, { ids }); reload('Ordem atualizada.'); } catch (e) { fail(e); }
    }));
    // orçamentos
    $$('[data-cmp]', body).forEach((b) => (b.onclick = async () => { const qs = (await api.get(`/r/quotes?f_project_id=${projectId}&limit=500`)).rows; compareDrawer(projectId, qs, qs.filter((x) => x.item === b.dataset.cmp).map((x) => x.id)); }));
    $$('[data-ask]', body).forEach((b) => (b.onclick = () => approvalForm(null, { kind: 'orcamento', quote_item: b.dataset.ask, title: `Escolha do orçamento de ${b.dataset.ask}` })));
    q('[data-newapr]').onclick = () => approvalForm(null, { kind: 'orcamento' });
    $$('[data-edit]', body).forEach((b) => (b.onclick = () => approvalForm(d.approvals.find((a) => a.id === Number(b.dataset.edit)))));
    $$('[data-reg]', body).forEach((b) => (b.onclick = () => registerForm(d.approvals.find((a) => a.id === Number(b.dataset.reg)))));
    $$('[data-fix]', body).forEach((b) => (b.onclick = () => { const [aid, eid] = b.dataset.fix.split(':').map(Number); registerForm(d.approvals.find((a) => a.id === aid), eid); }));
    $$('[data-reopen]', body).forEach((b) => (b.onclick = () => reasonAction(`/approvals/${b.dataset.reopen}/reopen`, 'Reabrir para o cliente', 'O que mudou? (opcional, aparece no histórico)', 'Pendência reaberta para o cliente.')));
    $$('[data-cancel]', body).forEach((b) => (b.onclick = () => reasonAction(`/approvals/${b.dataset.cancel}/cancel`, 'Cancelar pendência', 'Motivo do cancelamento (opcional)', 'Pendência cancelada.')));
  };

  const reasonAction = (url, title, label, ok) => {
    const b = el(html`<div class="field"><label>${label}</label><textarea rows="3" data-r></textarea></div>`);
    modal({ title, body: b, actions: [{ label: 'Voltar' }, { label: title, primary: true, fn: async () => { try { await api.post(url, { reason: b.querySelector('[data-r]').value }); reload(ok); } catch (e) { fail(e); return false; } } }] });
  };

  // criar / editar pendência
  const approvalForm = (a, pre = {}) => {
    const v = a || { client_visible: 1, ...pre };
    const cats = d.quotes.map((x) => x.item);
    const docs = d.media.concat([]);
    const b = el(html`<form class="form-grid" onsubmit="return false">
      <div class="field wide"><label>O que precisa ser decidido <span class="req">*</span></label><input name="title" value="${v.title || ''}" data-sentence placeholder="Ex.: Escolha da marcenaria"></div>
      <div class="field"><label>Tipo</label><select name="kind">${Object.entries(KIND).map(([k, l]) => html`<option value="${k}" ${v.kind === k ? 'selected' : ''}>${l}</option>`)}</select></div>
      <div class="field"><label>Categoria de orçamentos</label><select name="quote_item"><option value="">—</option>${cats.map((c) => html`<option ${v.quote_item === c ? 'selected' : ''}>${c}</option>`)}</select><span class="hint">O cliente escolhe entre os orçamentos liberados desta categoria.</span></div>
      <div class="field"><label>Documento relacionado</label><select name="document_id"><option value="">—</option>${docs.map((m) => html`<option value="${m.id}" ${v.document_id === m.id ? 'selected' : ''}>${m.portal_title || m.title}</option>`)}</select></div>
      <div class="field"><label>Prazo para resposta</label><input type="date" name="due_date" value="${v.due_date || ''}"></div>
      <div class="field wide"><label>Por que a decisão é necessária</label><textarea name="reason" rows="2" placeholder="Ex.: A escolha da marcenaria é necessária para iniciar a fabricação.">${v.reason || ''}</textarea></div>
      <div class="field"><label>Etapa que depende desta decisão</label><input name="blocks_stage" list="ca-phases" value="${v.blocks_stage || ''}" placeholder="Ex.: Fabricação da marcenaria"><datalist id="ca-phases">${d.phases.map((p) => html`<option value="${p}">`)}</datalist></div>
      <div class="field"><label class="toggle"><input type="checkbox" name="client_visible" ${v.client_visible ? 'checked' : ''}><span class="sw"></span><span class="small">Mostrar ao cliente</span></label></div></form>`);
    modal({ title: a ? 'Editar pendência' : 'Nova pendência de aprovação', body: b, actions: [{ label: 'Cancelar' }, { label: a ? 'Salvar' : 'Criar pendência', primary: true, fn: async () => {
      const f = Object.fromEntries(new FormData(b)); f.client_visible = b.querySelector('[name=client_visible]').checked ? 1 : 0;
      try { if (a) await api.put(`/approvals/${a.id}`, f); else await api.post(`/projects/${projectId}/approvals`, f); reload(a ? 'Pendência atualizada.' : 'Pendência criada' + (f.client_visible ? ' e visível ao cliente.' : '.')); } catch (e) { fail(e); return false; }
    } }] }).el.style.width = 'min(720px, calc(100vw - 32px))';
  };

  // registrar decisão confirmada fora do portal (ou corrigir um registro)
  const registerForm = (a, correctsId) => {
    if (!a) return;
    const b = el(html`<form class="form-grid" onsubmit="return false">
      <div class="field wide"><div class="small muted">${a.title}</div>${correctsId ? html`<div class="callout warn mt-8">Correção: o registro anterior continua no histórico, identificado como corrigido.</div>` : ''}</div>
      <div class="field"><label>Decisão confirmada</label><select name="action"><option value="aprovada">Aprovou</option><option value="ajustes">Pediu ajustes</option></select></div>
      ${a.options.length ? html`<div class="field"><label>Opção escolhida</label><select name="quote_id">${a.options.map((o) => html`<option value="${o.id}">${o.supplier} — ${o.amount ? money(o.amount) : 'valor não informado'} · versão ${o.version}</option>`)}</select><span class="hint">A versão atual do orçamento fica registrada.</span></div>` : ''}
      <div class="field"><label>Data da confirmação <span class="req">*</span></label><input type="date" name="confirmed_at" value="${today()}" max="${today()}"></div>
      <div class="field"><label>Origem <span class="req">*</span></label><select name="origin">${Object.entries(d.origins).filter(([k]) => k !== 'portal').map(([k, l]) => html`<option value="${k}">${l[0].toUpperCase() + l.slice(1)}</option>`)}</select></div>
      <div class="field wide"><label>Observação</label><textarea name="comment" rows="3" placeholder="Ex.: Cliente confirmou por mensagem às 14h"></textarea></div>
      ${correctsId ? html`<div class="field wide"><label>Motivo da correção <span class="req">*</span></label><input name="reason"></div>` : ''}
      <div class="field wide"><label>Comprovação (opcional)</label><input type="file" name="file" accept="image/*,application/pdf"><span class="hint">Print da conversa, e-mail ou ata. Fica interno.</span></div></form>`);
    modal({ title: correctsId ? 'Corrigir registro de decisão' : 'Registrar decisão do cliente', body: b, actions: [{ label: 'Cancelar' }, { label: 'Registrar', primary: true, fn: async () => {
      const f = Object.fromEntries(new FormData(b)); delete f.file;
      if (f.action === 'ajustes' && !String(f.comment || '').trim()) { toast('Descreva os ajustes pedidos pelo cliente.', { error: true }); return false; }
      try {
        const file = b.querySelector('[name=file]').files;
        if (file.length) { const up = await uploadFiles(file, { project_id: projectId, category: 'Comprovantes de decisão', title: `Comprovação — ${a.title}` }); f.attachment_doc_id = up.ids[0]; }
        if (correctsId) f.corrects_event_id = correctsId;
        await api.post(`/approvals/${a.id}/register`, f);
        reload('Decisão registrada. A pendência foi atualizada aqui e na Área do Cliente.');
      } catch (e) { fail(e); return false; }
    } }] }).el.style.width = 'min(680px, calc(100vw - 32px))';
  };

  render();
}
