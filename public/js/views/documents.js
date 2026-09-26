import { S, api, html, el, toHTML, icon, date, bytes, fileExt, fileUrl, openForm, modal, uploadFiles, toast, fail, relDay, daysFrom, isManager, refOptions, combo, $$ } from '../lib.js';
import { listPage, rowActions } from './common.js';

export default async function (ctx) {
  const page = await listPage({
    root: ctx.root, res: 'documents', title: 'Documentos', sub: 'Central de documentos — contratos, RRT, ART, projetos, notas fiscais, comprovantes, atas e mais', query: ctx.query,
    presets: [{ key: '', label: 'Todos' }, { key: 'vencendo', label: 'Vencidos / a vencer (30 dias)' }, { key: 'cliente', label: 'Liberados ao cliente' }],
    filters: ['category', 'project_id', 'client_id', 'supplier_id'],
    newLabel: 'Enviar documentos', onNew: (reload) => uploadModal(reload),
    columns: [
      { key: 'title', label: 'Documento', render: (d) => html`<div class="row gap-8"><div class="file-ico">${(d.mime || '').startsWith('image/') ? icon('image', 'sm') : fileExt(d.file_name) || '—'}</div><div style="min-width:0"><div class="cell-title">${d.title}</div><div class="cell-sub">${[d.file_name, d.size ? bytes(d.size) : null].filter(Boolean).join(' · ')}</div></div></div>` },
      { key: 'category', label: 'Categoria' },
      { key: 'project_name', label: 'Vínculo', render: (d) => html`${d.project_name ? html`<a href="#/projetos/${d.project_id}">${d.project_name}</a>` : ''}${d.client_name && !d.project_name ? d.client_name : ''}${d.supplier_name ? html`<div class="cell-sub">${d.supplier_name}</div>` : ''}${!d.project_name && !d.client_name && !d.supplier_name ? '—' : ''}` },
      { key: 'expires_at', label: 'Validade', render: (d) => (d.expires_at ? html`<span class="${d.is_expired ? 'late' : daysFrom(d.expires_at) <= 30 ? 'warning-text' : ''}">${date(d.expires_at)}</span><div class="cell-sub">${relDay(d.expires_at)}</div>` : '—'), csv: (d) => date(d.expires_at) },
      { key: 'client_visible', label: 'Cliente', render: (d) => (d.client_visible ? html`<span class="badge info plain">liberado</span>` : html`<span class="muted small">interno</span>`) },
      { key: 'created_at', label: 'Enviado', render: (d) => html`${date(d.created_at)}<div class="cell-sub">${d.uploaded_by_name || ''}</div>`, csv: (d) => date(d.created_at) },
    ],
    onRow: (d) => (d.file_path ? window.open(fileUrl(d, true), '_blank', 'noopener') : openForm('documents', { id: d.id, onSaved: () => page.load() })),
    actions: (d, reload) => rowActions('documents', d, { onChange: reload, extra: [
      d.file_path ? { label: 'Baixar', icon: 'download', fn: () => { location.href = fileUrl(d); } } : null,
      { label: d.client_visible ? 'Ocultar do cliente' : 'Liberar ao cliente', icon: 'eye', fn: async () => { await api.put(`/r/documents/${d.id}`, { client_visible: d.client_visible ? 0 : 1 }); reload(); } }, '-'] }),
  });
  if (ctx.query.id) openForm('documents', { id: Number(ctx.query.id), onSaved: () => page.load() });
}

function uploadModal(reload) {
  const body = el(html`<div class="form-grid">
    <div class="field wide"><label>Arquivos</label><input type="file" multiple id="uf"></div>
    <div class="field wide"><label>Título (opcional, para um único arquivo)</label><input id="ut"></div>
    <div class="field"><label>Categoria</label><select id="uc"><option value="">—</option>${(S.meta.options.documento || []).map((c) => html`<option>${c}</option>`)}</select></div>
    <div class="field"><label>Validade (opcional)</label><input type="date" id="ue"></div>
    <div class="field" data-p><label>Projeto</label></div><div class="field" data-c><label>Cliente</label></div>
    ${S.meta.resources.suppliers ? html`<div class="field" data-s><label>Fornecedor</label></div>` : ''}
    <div class="field"><label class="toggle"><input type="checkbox" id="uv"><span class="sw"></span><span class="small">Liberar na Área do Cliente</span></label></div></div>`);
  const pc = combo({ name: 'project_id', options: refOptions('projects') }); body.querySelector('[data-p]').appendChild(pc);
  const cc = combo({ name: 'client_id', options: S.meta.resources.clients ? refOptions('clients') : [] }); body.querySelector('[data-c]').appendChild(cc);
  const sb = body.querySelector('[data-s]'); const sc = sb ? combo({ name: 'supplier_id', options: refOptions('suppliers') }) : null; if (sb) sb.appendChild(sc);
  modal({ title: 'Enviar documentos', body, actions: [{ label: 'Cancelar' }, { label: 'Enviar', primary: true, fn: async () => {
    const files = body.querySelector('#uf').files; if (!files.length) { toast('Selecione ao menos um arquivo.', { error: true }); return false; }
    await uploadFiles(files, { title: body.querySelector('#ut').value, category: body.querySelector('#uc').value, expires_at: body.querySelector('#ue').value, project_id: pc.combo.get(), client_id: cc.combo.get(), supplier_id: sc ? sc.combo.get() : '', client_visible: body.querySelector('#uv').checked ? '1' : '' });
    toast('Documentos enviados.'); reload();
  } }] });
}
