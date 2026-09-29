// ATA DE REUNIÃO — registro de participantes, assuntos, decisões e próximos passos,
// sempre vinculada a cliente e projeto cadastrados, com PDF para impressão.
import { S, api, html, el, toHTML, icon, date, toast, fail, today, refOptions, combo, openPdf, rowsEditor, dirtyTracker, archiveRow, deleteRow, menu, readForm } from '../lib.js';
import { listPage } from './common.js';

export default async function (ctx) {
  if (ctx.params[0]) return editor(ctx, ctx.params[0] === 'nova' ? null : Number(ctx.params[0]));
  await listPage({
    root: ctx.root, res: 'meeting_minutes', title: 'Ata de Reunião', sub: 'Registros de reuniões vinculados ao cliente e ao projeto, com PDF para impressão', query: ctx.query,
    filters: ['client_id', 'project_id'], newLabel: 'Nova ata',
    columns: [
      { key: 'date', label: 'Data', render: (a) => date(a.date) },
      { key: 'title', label: 'Reunião', render: (a) => html`<div class="cell-title">${a.title || 'Reunião'}</div><div class="cell-sub">${a.number || ''}${a.client_visible ? ' · visível ao cliente' : ''}</div>` },
      { key: 'client_name', label: 'Cliente' },
      { key: 'project_name', label: 'Projeto', render: (a) => html`${a.project_name || '—'}${a.project_code ? html`<div class="cell-sub">${a.project_code}</div>` : ''}` },
    ],
    onRow: (a) => ctx.go(`#/atas/${a.id}`),
    actions: (a, reload) => [
      { label: 'Abrir', icon: 'edit', fn: () => ctx.go(`#/atas/${a.id}`) },
      { label: 'Gerar PDF', icon: 'print', fn: () => openPdf(`/pdf/minutes/${a.id}`) },
      { label: a.archived ? 'Restaurar' : 'Arquivar', icon: a.archived ? 'refresh' : 'archive', fn: async () => { await archiveRow('meeting_minutes', a, a.archived ? 0 : 1); reload(); } },
      '-', { label: 'Excluir definitivamente', icon: 'trash', danger: true, fn: async () => { if (await deleteRow('meeting_minutes', a, a.title)) reload(); } },
    ],
    onNew: () => ctx.go('#/atas/nova'),
  });
}

async function editor(ctx, id) {
  const root = ctx.root;
  let a = { date: today(), client_id: null, project_id: null, next_steps: '[]', client_visible: 0 };
  if (id) { try { a = await api.get(`/r/meeting_minutes/${id}`); } catch (e) { root.innerHTML = toHTML(html`<div class="empty">${e.message}</div>`); return; } }
  else if (ctx.query.projeto) { const p = await api.get(`/r/projects/${ctx.query.projeto}`).catch(() => null); if (p) { a.project_id = p.id; a.client_id = p.client_id; a.project_code = p.code; } }
  let steps = []; try { steps = JSON.parse(a.next_steps || '[]'); } catch { steps = []; }
  root.innerHTML = toHTML(html`
    <div class="hero doc-hero"><div class="crumbs"><a href="#/atas">Ata de Reunião</a> ${icon('chevron', 'sm')} <span>${a.number || 'Nova ata'}</span></div>
      <div class="row between top wrap gap-16"><div><h1>${id ? a.title || 'Reunião' : 'Nova ata de reunião'}</h1><div class="info-row mt-8">${a.number ? html`<span>${a.number}</span>` : ''}<span class="dirty-flag">alterações não salvas</span></div></div>
        <div class="row wrap"><button class="btn" data-save>${icon('check')} Salvar</button><button class="btn primary" data-pdf>${icon('print')} Gerar PDF</button>${id ? html`<button class="icon-btn" data-more>${icon('more')}</button>` : ''}</div></div></div>
    <div class="col mt-24" style="gap:16px" data-f>
      <section class="card"><div class="card-head"><h3>Reunião</h3></div><form class="form-grid" onsubmit="return false">
        <div class="field"><label>Data da reunião <span class="req">*</span></label><input type="date" name="date" value="${a.date || today()}"><span class="hint">Preenchida com hoje; altere para registrar reuniões anteriores.</span></div>
        <div class="field"><label>Local</label><input name="location" value="${a.location || ''}" placeholder="Ex.: escritório, obra, videochamada"></div>
        <div class="field"><label>Cliente</label><div data-client></div></div>
        <div class="field"><label>Projeto do cliente</label><div data-project></div></div>
        <div class="field"><label>Código do projeto</label><input data-code value="${a.project_code || ''}" disabled placeholder="preenchido pelo projeto"></div>
        <div class="field"><label>Assunto</label><input name="title" data-sentence value="${a.title || ''}" placeholder="Ex.: apresentação do anteprojeto"></div>
        <div class="field wide"><label>Participantes</label><textarea name="participants" rows="3" data-raw placeholder="Um participante por linha">${a.participants || ''}</textarea></div>
        <div class="field wide"><label>Assuntos e decisões <span class="req">*</span></label><textarea name="content" rows="14" placeholder="Registre os assuntos tratados e o que foi decidido.">${a.content || ''}</textarea></div>
        <div class="field wide"><label class="toggle"><input type="checkbox" name="client_visible" ${a.client_visible ? 'checked' : ''}><span class="sw"></span><span class="small">Mostrar esta ata na Área do Cliente (decisões)</span></label></div>
      </form></section>
      <section class="card"><div class="card-head"><h3>Próximos passos</h3><span class="small muted">opcional</span></div><div data-steps></div></section>
    </div>`);
  const tracker = dirtyTracker(root.querySelector('[data-f]'));
  const cli = combo({ name: 'client_id', options: refOptions('clients'), value: a.client_id, onChange: (v) => { tracker.mark(); prj.combo.setOptions([]); prj.combo.set('', true); setCode(null); if (v) refOptions('projects', { f_client_id: v }).then((o) => prj.combo.setOptions(o)); } });
  const prj = combo({ name: 'project_id', options: a.client_id ? refOptions('projects', { f_client_id: a.client_id }) : refOptions('projects'), value: a.project_id,
    onChange: (v, o) => { tracker.mark(); setCode(o && o.row); if (o && o.row && o.row.client_id && !cli.combo.get()) cli.combo.set(o.row.client_id, true); } });
  root.querySelector('[data-client]').appendChild(cli); root.querySelector('[data-project]').appendChild(prj);
  const setCode = (row) => { root.querySelector('[data-code]').value = row ? row.code || '' : ''; };
  const st = rowsEditor({ columns: [{ key: 'acao', label: 'Próximo passo', w: '2fr', type: 'textarea' }, { key: 'responsavel', label: 'Responsável', w: '1fr' }, { key: 'prazo', label: 'Prazo', type: 'date', w: '.9fr' }], rows: steps, addLabel: 'Adicionar próximo passo', empty: 'Nenhum próximo passo registrado.', onChange: () => tracker.mark() });
  root.querySelector('[data-steps]').appendChild(st);
  const save = async (quiet) => {
    const f = readForm(root.querySelector('form'));
    if (!f.date) { toast('Informe a data da reunião.', { error: true }); return false; }
    const data = { ...f, client_id: cli.combo.get() || null, project_id: prj.combo.get() || null, next_steps: JSON.stringify(st.rows.get()) };
    try {
      const r = id ? await api.put(`/r/meeting_minutes/${id}`, data) : await api.post('/r/meeting_minutes', data);
      tracker.clean(); if (!quiet) toast(id ? 'Ata salva.' : `Ata ${r.number} criada.`);
      if (!id) { ctx.go(`#/atas/${r.id}`); return r.id; }
      editor(ctx, id); return true;
    } catch (e) { fail(e); return false; }
  };
  root.querySelector('[data-save]').onclick = () => save();
  root.querySelector('[data-pdf]').onclick = async () => {
    if (!id) { const nid = await save(true); if (!nid) return; return openPdf(`/pdf/minutes/${nid}`); }
    openPdf(`/pdf/minutes/${id}`, { dirty: tracker.dirty, save: () => save(true) });
  };
  const mb = root.querySelector('[data-more]');
  if (mb) mb.onclick = (e) => menu(e.currentTarget, [
    a.project_id ? { label: 'Abrir projeto', icon: 'folder', fn: () => ctx.go(`#/projetos/${a.project_id}`) } : null,
    { label: a.archived ? 'Restaurar' : 'Arquivar', icon: a.archived ? 'refresh' : 'archive', fn: async () => { await archiveRow('meeting_minutes', a, a.archived ? 0 : 1); ctx.go('#/atas'); } },
    '-', { label: 'Excluir definitivamente', icon: 'trash', danger: true, fn: async () => { if (await deleteRow('meeting_minutes', a, a.title)) ctx.go('#/atas'); } },
  ]);
}
