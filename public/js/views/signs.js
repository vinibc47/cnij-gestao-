// CRIAR PLACA DE OBRA — editor com prévia em escala, foto/render com enquadramento sem distorção,
// QR Code para o Instagram @irineujuniorarquiteto e PDF nas dimensões físicas da placa.
import { S, api, html, el, toHTML, icon, date, toast, fail, refOptions, combo, openPdf, modal, dirtyTracker, archiveRow, deleteRow, menu, L, rowsEditor, uploadFiles, debounce } from '../lib.js';
import { listPage } from './common.js';

const SERIES = ['A4', 'A3', 'A2', 'A1'];
const sizeLabel = (s) => (L('SIGN_SIZES').find((x) => x.value === s) || {}).label || s;

export default async function (ctx) {
  if (ctx.params[0]) return editor(ctx, Number(ctx.params[0]));
  await listPage({
    root: ctx.root, res: 'site_signs', title: 'Criar placa de obra', sub: 'Placas de obra por projeto, com prévia em escala e PDF nas medidas reais para impressão', query: ctx.query,
    filters: ['client_id', 'project_id'], newLabel: 'Nova placa',
    columns: [
      { key: 'title', label: 'Placa', render: (s) => html`<div class="cell-title">${s.title}</div><div class="cell-sub">atualizada em ${date(s.updated_at)}</div>` },
      { key: 'client_name', label: 'Cliente' },
      { key: 'project_name', label: 'Projeto', render: (s) => html`${s.project_name || '—'}${s.project_code ? html`<div class="cell-sub">${s.project_code}</div>` : ''}` },
      { key: 'size', label: 'Tamanho', render: (s) => html`${sizeLabel(s.size)}${SERIES.includes(s.size) ? html`<div class="cell-sub">${s.orientation}</div>` : ''}` },
    ],
    onRow: (s) => ctx.go(`#/placas/${s.id}`),
    actions: (s, reload) => [
      { label: 'Editar', icon: 'edit', fn: () => ctx.go(`#/placas/${s.id}`) },
      { label: 'Exportar PDF', icon: 'print', fn: () => openPdf(`/pdf/sign/${s.id}`) },
      { label: s.archived ? 'Restaurar' : 'Arquivar', icon: s.archived ? 'refresh' : 'archive', fn: async () => { await archiveRow('site_signs', s, s.archived ? 0 : 1); reload(); } },
      '-', { label: 'Excluir definitivamente', icon: 'trash', danger: true, fn: async () => { if (await deleteRow('site_signs', s, s.title)) reload(); } },
    ],
    onNew: () => newSign(ctx),
  });
}

function newSign(ctx) {
  const body = el(html`<div class="form-grid">
    <div class="field wide"><label>Projeto</label><div data-p></div><span class="hint">Nome da obra, endereço e cliente são puxados do projeto.</span></div>
    <div class="field wide"><label>Tamanho</label><select name="size">${L('SIGN_SIZES').map((s) => html`<option value="${s.value}">${s.label}</option>`)}</select></div>
  </div>`);
  const prj = combo({ name: 'project_id', options: refOptions('projects') });
  body.querySelector('[data-p]').appendChild(prj);
  modal({ title: 'Nova placa de obra', body, actions: [{ label: 'Cancelar' }, { label: 'Criar placa', primary: true, fn: async () => {
    const size = body.querySelector('[name=size]').value;
    try { const s = await api.post('/signs', { project_id: prj.combo.get() || null, size, orientation: SERIES.includes(size) ? 'retrato' : 'paisagem' }); ctx.go(`#/placas/${s.id}`); } catch (e) { fail(e); return false; }
  } }] });
}

async function editor(ctx, id) {
  const root = ctx.root;
  let s;
  try { s = await api.get(`/signs/${id}`); } catch (e) { root.innerHTML = toHTML(html`<div class="empty">${e.message}</div>`); return; }
  const d = s.data || {};
  const st = { size: s.size, orientation: s.orientation || 'paisagem', theme: s.theme || 'escuro', photo_doc_id: s.photo_doc_id, photo_x: s.photo_x ?? 50, photo_y: s.photo_y ?? 50, photo_zoom: s.photo_zoom ?? 1 };
  root.innerHTML = toHTML(html`
    <div class="hero doc-hero"><div class="crumbs"><a href="#/placas">Placas de obra</a> ${icon('chevron', 'sm')} <span>${s.title}</span></div>
      <div class="row between top wrap gap-16"><div><h1>${s.title}</h1><div class="info-row mt-8"><span data-dimlabel></span><span class="dirty-flag">alterações não salvas</span></div></div>
        <div class="row wrap"><button class="btn" data-save>${icon('check')} Salvar</button><button class="btn primary" data-pdf>${icon('download')} Exportar PDF</button><button class="icon-btn" data-more>${icon('more')}</button></div></div></div>
    <div class="sign-ed mt-24">
      <div class="col sign-form" style="gap:16px" data-f>
        <section class="card"><div class="card-head"><h3>Placa</h3></div><form class="form-grid" onsubmit="return false">
          <div class="field wide"><label>Nome da placa</label><input name="title" value="${s.title}"></div>
          <div class="field"><label>Cliente</label><div data-client></div></div>
          <div class="field"><label>Projeto</label><div data-project></div></div>
          <div class="field"><label>Tamanho</label><select data-st="size">${L('SIGN_SIZES').map((x) => html`<option value="${x.value}" ${x.value === st.size ? 'selected' : ''}>${x.label}</option>`)}</select></div>
          <div class="field" data-orient-f><label>Orientação</label><div class="btn-group" data-orient><button type="button" data-v="retrato">Retrato</button><button type="button" data-v="paisagem">Paisagem</button></div></div>
          <div class="field"><label>Fundo</label><div class="btn-group" data-theme><button type="button" data-v="escuro">Escuro</button><button type="button" data-v="claro">Claro</button></div></div>
        </form></section>
        <section class="card"><div class="card-head"><h3>Obra</h3></div><form class="form-grid" onsubmit="return false" data-obra>
          <div class="field wide"><label>Serviço (linha de destaque)</label><input name="service_line" value="${d.service_line || ''}" placeholder="Ex.: Projeto arquitetônico e de interiores"></div>
          <div class="field wide"><label>Nome da obra</label><input name="obra_nome" value="${d.obra_nome || ''}"></div>
          <div class="field wide"><label>Endereço</label><input name="endereco" value="${d.endereco || ''}"></div>
          <div class="field"><label>Rótulo do contato</label><input name="contato_label" value="${d.contato_label || 'Contato'}"></div>
          <div class="field"><label>Contato</label><input name="contato" value="${d.contato || ''}"></div>
        </form></section>
        <section class="card"><div class="card-head"><h3>Responsáveis técnicos</h3><span class="small muted">sem números inventados: deixe em branco o que não tiver</span></div><div data-people></div></section>
        <section class="card"><div class="card-head"><h3>Outras informações</h3><span class="small muted">opcional (ex.: alvará, construtora)</span></div><div data-extra></div></section>
        <section class="card"><div class="card-head"><h3>Foto / render</h3></div>
          <div class="col" style="gap:12px">
            <div class="row wrap"><button class="btn" data-upload>${icon('upload')} ${s.photo ? 'Substituir imagem' : 'Enviar imagem'}</button>${s.photo ? html`<span class="small muted">${s.photo.name} · ${s.photo.w}×${s.photo.h} px</span><button class="btn sm" data-rm-photo>${icon('x', 'sm')} Remover</button>` : ''}<input type="file" accept="image/png,image/jpeg" class="hidden" data-file></div>
            <div data-res></div>
            <div class="form-grid ${s.photo ? '' : 'hidden'}">
              <div class="field"><label>Posição horizontal</label><input type="range" min="0" max="100" data-st="photo_x" value="${st.photo_x}"></div>
              <div class="field"><label>Posição vertical</label><input type="range" min="0" max="100" data-st="photo_y" value="${st.photo_y}"></div>
              <div class="field"><label>Zoom</label><input type="range" min="1" max="3" step="0.05" data-st="photo_zoom" value="${st.photo_zoom}"></div>
            </div>
            <span class="hint">A imagem preenche a área da foto sem distorcer: ajuste a posição e o zoom para enquadrar.</span>
          </div></section>
        <section class="card"><div class="card-head"><h3>Instagram</h3></div>
          <div class="callout mb-12">O QR Code aponta sempre para <b>${s.qr.url}</b> e mostra <b>${s.qr.handle}</b> ao lado.</div>
          <div data-handles></div></section>
      </div>
      <div class="sign-prev-wrap"><div class="card sign-prev-card"><div class="card-head"><h3>Prévia</h3><span class="small muted" data-scale></span></div><div class="sign-prev" data-prev></div></div></div>
    </div>`);
  const q = (x) => root.querySelector(x);
  const tracker = dirtyTracker(q('.sign-ed'));
  const cli = combo({ name: 'client_id', options: refOptions('clients'), value: s.client_id, onChange: (v) => { tracker.mark(); prj.combo.set('', true); prj.combo.setOptions([]); if (v) refOptions('projects', { f_client_id: v }).then((o) => prj.combo.setOptions(o)); } });
  const prj = combo({ name: 'project_id', options: s.client_id ? refOptions('projects', { f_client_id: s.client_id }) : refOptions('projects'), value: s.project_id,
    onChange: (v, o) => { tracker.mark(); if (o && o.row && o.row.client_id && !cli.combo.get()) cli.combo.set(o.row.client_id, true); } });
  q('[data-client]').appendChild(cli); q('[data-project]').appendChild(prj);
  const people = rowsEditor({ columns: [{ key: 'nome', label: 'Nome', w: '1.4fr' }, { key: 'funcao', label: 'Função', w: '1.2fr', sentence: true }, { key: 'registro_label', label: 'Conselho', type: 'select', options: [{ value: 'CAU', label: 'CAU' }, { value: 'CREA', label: 'CREA' }, { value: 'CFT', label: 'CFT' }], w: '.7fr' }, { key: 'registro', label: 'Nº registro', w: '.9fr' }, { key: 'rrt_label', label: 'Doc.', type: 'select', options: [{ value: 'RRT', label: 'RRT' }, { value: 'ART', label: 'ART' }, { value: 'TRT', label: 'TRT' }], w: '.7fr' }, { key: 'rrt', label: 'Nº RRT/ART', w: '.9fr' }],
    rows: d.people || [], addLabel: 'Adicionar responsável', empty: 'Nenhum responsável informado.', onChange: () => changed() });
  q('[data-people]').appendChild(people);
  const extra = rowsEditor({ columns: [{ key: 'label', label: 'Informação', w: '1fr' }, { key: 'value', label: 'Conteúdo', w: '2fr' }], rows: d.extra_fields || [], addLabel: 'Adicionar informação', empty: 'Nenhuma.', onChange: () => changed() });
  q('[data-extra]').appendChild(extra);
  const handles = rowsEditor({ columns: [{ key: 'handle', label: 'Perfil (@)', w: '1fr' }, { key: 'desc', label: 'Descrição', w: '1.5fr' }], rows: d.handles || [], addLabel: 'Adicionar perfil', empty: 'Nenhum perfil listado.', onChange: () => changed() });
  q('[data-handles]').appendChild(handles);

  const seg = (sel, key) => {
    const g = q(sel);
    const paint = () => g.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === st[key]));
    paint(); g.onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; st[key] = b.dataset.v; paint(); tracker.mark(); changed(); };
  };
  seg('[data-orient]', 'orientation'); seg('[data-theme]', 'theme');
  const orientVis = () => { q('[data-orient-f]').classList.toggle('hidden', !SERIES.includes(st.size)); };
  orientVis();
  root.querySelectorAll('[data-st]').forEach((i) => i.addEventListener('input', () => { const k = i.dataset.st; st[k] = i.type === 'range' ? Number(i.value) : i.value; if (k === 'size') { if (!SERIES.includes(st.size)) st.orientation = 'paisagem'; orientVis(); seg('[data-orient]', 'orientation'); } changed(); }));
  q('[data-obra]').addEventListener('input', () => changed());

  const payload = () => {
    const o = {}; q('[data-obra]').querySelectorAll('[name]').forEach((i) => { o[i.name] = i.value.trim(); });
    return { title: q('[name=title]').value.trim() || 'Placa de obra', client_id: cli.combo.get() || null, project_id: prj.combo.get() || null, ...st,
      data: { ...o, people: people.rows.get(), extra_fields: extra.rows.get().filter((x) => x.label || x.value), handles: handles.rows.get().filter((x) => x.handle) } };
  };
  const showPrev = (r) => {
    q('[data-prev]').innerHTML = r.svg;
    const sv = q('[data-prev] svg'); if (sv) { sv.removeAttribute('width'); sv.removeAttribute('height'); sv.style.width = '100%'; sv.style.height = 'auto'; sv.style.display = 'block'; }
    const wmm = r.dims.w; const hmm = r.dims.h;
    q('[data-dimlabel]').textContent = SERIES.includes(st.size) ? `${st.size} · ${st.orientation} · ${wmm} × ${hmm} mm` : sizeLabel(st.size);
    q('[data-scale]').textContent = `proporção ${(wmm / hmm).toFixed(2).replace('.', ',')} : 1`;
    const res = q('[data-res]');
    res.innerHTML = r.ppi ? toHTML(r.low_res ? html`<div class="callout warn"><b>Resolução baixa para este tamanho:</b> ${Math.round(r.ppi)} ppi na impressão (recomendado a partir de ${r.min_ppi} ppi). A foto pode sair borrada; envie uma imagem maior.</div>`
      : html`<div class="small success-text">${icon('check', 'sm')} Resolução adequada: ${Math.round(r.ppi)} ppi na impressão.</div>`) : '';
  };
  showPrev({ svg: s.svg, dims: s.dims, ppi: s.ppi, low_res: s.low_res, min_ppi: s.min_ppi });
  const refresh = debounce(async () => { try { showPrev(await api.post(`/signs/${id}/preview`, payload())); } catch (e) { fail(e); } }, 350);
  function changed() { tracker.mark(); refresh(); }

  const save = async (quiet) => {
    try { await api.put(`/signs/${id}`, payload()); tracker.clean(); if (!quiet) { toast('Placa salva.'); editor(ctx, id); } return true; } catch (e) { fail(e); return false; }
  };
  q('[data-save]').onclick = () => save();
  q('[data-pdf]').onclick = () => openPdf(`/pdf/sign/${id}`, { dirty: tracker.dirty, save: () => save(true) });
  const file = q('[data-file]');
  q('[data-upload]').onclick = () => file.click();
  file.onchange = async () => {
    if (!file.files.length) return;
    try {
      if (tracker.dirty && !(await save(true))) return;
      const r = await uploadFiles(file.files, { entity: 'site_signs', entity_id: id, category: 'Imagens / renders', title: `Foto da placa — ${s.title}` });
      await api.put(`/signs/${id}`, { photo_doc_id: r.ids[0], photo_x: 50, photo_y: 50, photo_zoom: 1 });
      toast('Imagem aplicada à placa.'); editor(ctx, id);
    } catch (e) { fail(e); }
  };
  const rmp = q('[data-rm-photo]');
  if (rmp) rmp.onclick = async () => { try { await api.put(`/signs/${id}`, { photo_doc_id: null }); editor(ctx, id); } catch (e) { fail(e); } };
  q('[data-more]').onclick = (e) => menu(e.currentTarget, [
    s.project_id ? { label: 'Abrir projeto', icon: 'folder', fn: () => ctx.go(`#/projetos/${s.project_id}`) } : null,
    { label: s.archived ? 'Restaurar' : 'Arquivar', icon: s.archived ? 'refresh' : 'archive', fn: async () => { await archiveRow('site_signs', s, s.archived ? 0 : 1); ctx.go('#/placas'); } },
    '-', { label: 'Excluir definitivamente', icon: 'trash', danger: true, fn: async () => { if (await deleteRow('site_signs', s, s.title)) ctx.go('#/placas'); } },
  ].filter(Boolean));
}
