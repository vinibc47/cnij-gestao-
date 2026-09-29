import { S, api, html, el, toHTML, icon, money, date, badge, label, openForm, drawer, modal, toast, fail, list, attachments, table, pct, today, addDays, deleteRow, duplicateRow, relDay, refOptions, combo, confirmDialog, openPdf, failProblems, datetime, menu, archiveRow, parseNum, round2, dirtyTracker, $$ } from '../lib.js';
import { listPage, rowActions, tabsBar } from './common.js';
import { entryDrawer } from './finance.js';
import { fld, readFields, bindMoney, planEditor, bodyEditor, problemsBox, PROJECT_TYPES, svcLabel } from './docs-common.js';

export default async function (ctx) {
  if (ctx.base === 'contratos') {
    if (ctx.params[0] === 'editor' && ctx.params[1]) return contractEditor(ctx, Number(ctx.params[1]));
    return contracts(ctx);
  }
  if (ctx.params[0] === 'orcamento' && ctx.params[1]) return proposalEditor(ctx, Number(ctx.params[1]));
  if (ctx.params[0] === 'outras') return proposals(ctx, 'outras');
  if (ctx.params[0] && /^\d+$/.test(ctx.params[0])) {
    try { const p = await api.get(`/r/proposals/${ctx.params[0]}`); if (p.kind === 'honorarios') return ctx.go(`#/propostas/orcamento/${p.id}`); } catch { /* segue */ }
    return proposals(ctx, 'outras', Number(ctx.params[0]));
  }
  return proposals(ctx, 'orcamento');
}

const FOLDERS = (f) => html`<div class="tabs folder-tabs"><a href="#/propostas" class="${f === 'orcamento' ? 'on' : ''}">${icon('folder', 'sm')} Orçamento de obra</a><a href="#/propostas/outras" class="${f === 'outras' ? 'on' : ''}">${icon('folder', 'sm')} Outras propostas</a></div>`;

// ------------------------------ PROPOSTAS (listas) ------------------------------
async function proposals(ctx, folder, openId) {
  const hon = folder === 'orcamento';
  const all = (await list('proposals', { limit: 1000, archived: 'all', preset: hon ? 'honorarios' : 'simples' })).rows;
  const yr = today().slice(0, 4);
  const decided = all.filter((p) => ['aprovada', 'recusada', 'expirada'].includes(p.status));
  const approved = all.filter((p) => p.status === 'aprovada');
  const open = all.filter((p) => p.status === 'enviada');
  const stats = el(html`<div class="grid g4 mb-24">
    <div class="card kpi"><span class="label">Aguardando o cliente</span><span class="value">${money(open.reduce((s, p) => s + p.amount, 0))}</span><span class="foot">${open.length} proposta(s) enviada(s)</span></div>
    <div class="card kpi"><span class="label">Taxa de conversão</span><span class="value">${decided.length ? pct(Math.round((approved.length / decided.length) * 1000) / 10) : '—'}</span><span class="foot">${approved.length} aprovadas de ${decided.length} decididas</span></div>
    <div class="card kpi"><span class="label">Aprovado em ${yr}</span><span class="value">${money(approved.filter((p) => (p.decided_at || '').startsWith(yr)).reduce((s, p) => s + p.amount, 0))}</span><span class="foot">${approved.filter((p) => p.project_id).length} com projeto criado</span></div>
    <div class="card kpi"><span class="label">Rascunhos</span><span class="value">${all.filter((p) => p.status === 'elaboracao').length}</span><span class="foot">em elaboração</span></div></div>`);
  const page = await listPage({
    root: ctx.root, res: 'proposals', title: 'Propostas', query: ctx.query,
    sub: hon ? 'Orçamento de obra: propostas de honorários dos serviços do escritório, com modelo, parcelas e PDF' : 'Propostas registradas antes do modelo de orçamento de obra',
    presets: hon ? [{ key: 'honorarios_abertas', label: 'Em aberto' }, { key: 'honorarios', label: 'Todas' }] : [{ key: 'simples_abertas', label: 'Em aberto' }, { key: 'simples', label: 'Todas' }],
    filters: ['status', 'client_id'], beforeTable: true, newLabel: hon ? 'Nova proposta' : 'Nova proposta simples',
    columns: [
      { key: 'number', label: 'Nº', render: (p) => html`<span class="muted">${p.number}</span>` },
      { key: 'title', label: 'Proposta', render: (p) => html`<div class="cell-title">${p.title}</div><div class="cell-sub">${p.client_name}${p.service_type ? ' · ' + svcLabel(p.service_type) : ''}</div>` },
      { key: 'amount', label: 'Valor', align: 'right', render: (p) => money(p.amount) },
      { key: hon ? 'issue_date' : 'sent_at', label: hon ? 'Data' : 'Envio', render: (p) => date(hon ? p.issue_date : p.sent_at) },
      { key: 'valid_until', label: 'Validade', render: (p) => html`<span class="${p.is_expired ? 'late' : ''}">${date(p.valid_until)}</span>` },
      { key: 'status', label: 'Status', render: (p) => html`${badge('PROPOSAL_STATUS', p.status)}${p.project_id ? html` <a class="badge plain" href="#/projetos/${p.project_id}">projeto</a>` : ''}`, csv: (p) => label('PROPOSAL_STATUS', p.status) },
    ],
    onRow: (p) => (hon ? ctx.go(`#/propostas/orcamento/${p.id}`) : proposalDrawer(p.id, () => page.load())),
    actions: (p, reload) => (hon ? [
      { label: 'Abrir', icon: 'edit', fn: () => ctx.go(`#/propostas/orcamento/${p.id}`) },
      { label: 'Gerar PDF', icon: 'print', fn: () => openPdf(`/pdf/proposal/${p.id}`, { draftUrl: `/pdf/proposal/${p.id}?draft=1` }) },
      { label: 'Duplicar', icon: 'copy', fn: async () => { try { const d = await api.post(`/honorarios/${p.id}/duplicate`); toast(`Proposta duplicada como ${d.number}.`); ctx.go(`#/propostas/orcamento/${d.id}`); } catch (e) { fail(e); } } },
      { label: p.archived ? 'Restaurar' : 'Arquivar', icon: 'archive', fn: async () => { await archiveRow('proposals', p, p.archived ? 0 : 1); reload(); } },
      '-', { label: 'Excluir', icon: 'trash', danger: true, fn: async () => { try { if (await deleteRow('proposals', p, p.number)) reload(); } catch (e) { fail(e); } } },
    ] : [{ label: 'Converter para orçamento de obra', icon: 'repeat', fn: async () => { const r = await api.post(`/honorarios/${p.id}/upgrade`); ctx.go(`#/propostas/orcamento/${r.id}`); } }, ...rowActions('proposals', p, { onChange: reload })]),
    onNew: hon ? () => newProposal(ctx) : undefined,
    totals: (rows) => `Total ${money(rows.reduce((s, p) => s + p.amount, 0))}`,
  });
  ctx.root.querySelector('.page-head').insertAdjacentElement('afterend', el(FOLDERS(folder)));
  ctx.root.querySelector('[data-before]').appendChild(stats);
  if (openId) proposalDrawer(openId, () => page.load());
  if (hon && ctx.query.nova) { history.replaceState(null, '', '#/propostas'); newProposal(ctx); }
}

async function newProposal(ctx, initial = {}) {
  const body = el(html`<div class="form-grid">
    <div class="field wide"><label>Cliente <span class="req">*</span></label><div data-cli></div><span class="hint">Não encontrou? Digite o nome e escolha “Criar”.</span></div>
    <div class="field wide"><label>Projeto / serviço <span class="req">*</span></label><input id="np-t" placeholder="Ex.: Projeto de interiores — Escritório corporativo" value="${initial.title || ''}"></div>
    <div class="field"><label>Tipo de serviço</label><select id="np-s">${S.meta.lists.SERVICE_TYPES.map((o) => html`<option value="${o.value}" ${o.value === (initial.service_type || 'interiores') ? 'selected' : ''}>${o.label}</option>`)}</select></div>
    <div class="field"><label>Tipo de obra</label><select id="np-w"><option value="">—</option>${S.meta.lists.WORK_TYPES.map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select></div>
    <p class="wide small muted" style="margin:0">A proposta é criada como rascunho com o texto do modelo do tipo de serviço, a chave Pix do escritório e a validade padrão. Tudo pode ser editado em seguida.</p></div>`);
  const cli = combo({ name: 'client_id', options: refOptions('clients'), value: initial.client_id, allowEmpty: false,
    onCreate: async (name) => { try { const c = await api.post('/r/clients', { name }); toast('Cliente cadastrado.'); return { id: c.id, label: c.name }; } catch (e) { fail(e); return null; } } });
  body.querySelector('[data-cli]').appendChild(cli);
  const m = modal({ title: 'Nova proposta — Orçamento de obra', body, actions: [{ label: 'Cancelar' }, { label: 'Criar rascunho', primary: true, fn: async () => {
    const client_id = cli.combo.get(); const title = body.querySelector('#np-t').value.trim();
    if (!client_id) { toast('Selecione o cliente.', { error: true }); return false; }
    if (!title) { toast('Informe o projeto ou serviço.', { error: true }); return false; }
    const p = await api.post('/honorarios', { client_id, title, service_type: body.querySelector('#np-s').value, work_type: body.querySelector('#np-w').value });
    toast(`Proposta ${p.number} criada.`); ctx.go(`#/propostas/orcamento/${p.id}`);
  } }] });
  m.el.style.width = 'min(620px, calc(100vw - 32px))';
}

// ------------------------------ EDITOR DA PROPOSTA DE HONORÁRIOS ------------------------------
async function proposalEditor(ctx, id) {
  const root = ctx.root;
  let p; let off;
  try { [p, off] = await Promise.all([api.get(`/honorarios/${id}`), api.get('/office')]); } catch (e) { root.innerHTML = toHTML(html`<div class="empty">${icon('alert')}<div>${e.message}</div></div>`); return; }
  const L = S.meta.lists; const ex = p.extra || {};
  const reload = () => proposalEditor(ctx, id);
  const locked = p.status === 'aprovada';
  root.innerHTML = toHTML(html`
    <div class="hero doc-hero"><div class="crumbs"><a href="#/propostas">Propostas</a> ${icon('chevron', 'sm')} <a href="#/propostas">Orçamento de obra</a> ${icon('chevron', 'sm')} <span>${p.number}</span></div>
      <div class="row between top wrap gap-16"><div style="min-width:0"><h1>Proposta ${p.number}</h1>
        <div class="info-row mt-8"><span>${icon('users', 'sm')}<a href="#/clientes/${p.client_id}">${p.client_name}</a></span><span>${icon('proposal', 'sm')}${svcLabel(p.service_type)}</span>${badge('PROPOSAL_STATUS', p.status)}${p.archived ? html`<span class="badge muted">Arquivada</span>` : ''}<span class="dirty-flag">alterações não salvas</span></div></div>
        <div class="row wrap"><button class="btn" data-save>${icon('check')} Salvar</button><button class="btn primary" data-pdf>${icon('print')} Gerar PDF</button><button class="icon-btn" data-more title="Mais ações">${icon('more')}</button></div></div>
      <div class="status-bar mt-16" data-status></div></div>
    <div class="doc-grid mt-24">
      <div class="col" style="gap:16px">
        <section class="card"><div class="card-head"><h3>Identificação</h3></div><div class="form-grid" data-sec="id">
          ${fld('number', 'Número da proposta', p.number, { req: true })}${fld('issue_date', 'Data', p.issue_date, { type: 'date', req: true })}
          ${fld('valid_until', 'Validade', p.valid_until, { type: 'date', req: true, hint: `Padrão: ${off.office.validity_days} dias` })}${fld('contact_name', 'Contato (A/C)', p.contact_name, { placeholder: 'Ex.: Sr. Heitor Matos' })}
          <div class="field wide"><label>Cliente <span class="req">*</span></label><div data-client></div></div>
          ${fld('title', 'Projeto / serviço', p.title, { wide: true, req: true })}
          ${fld('address', 'Endereço do projeto / obra', p.address, { wide: true })}${fld('city', 'Cidade', p.city)}${fld('area', 'Área aproximada (m²)', p.area, { type: 'number' })}
          <div class="field"><label>Tipo de serviço <span class="req">*</span></label><select name="service_type">${L.SERVICE_TYPES.map((o) => html`<option value="${o.value}" ${o.value === p.service_type ? 'selected' : ''}>${o.label}</option>`)}</select></div>
          ${fld('work_type', 'Tipo de obra', p.work_type, { type: 'select', options: L.WORK_TYPES })}
          <div class="field wide"><label>Projeto vinculado no sistema</label><div data-project></div><span class="hint">Opcional. Após a aprovação, você pode criar o projeto automaticamente.</span></div>
        </div></section>

        <section class="card"><div class="card-head"><h3>Escopo</h3></div><div class="form-grid">
          ${fld('summary', 'Resumo do projeto ou serviço', p.summary, { type: 'textarea', wide: true, rows: 4, placeholder: 'Ex.: Desenvolvimento de projeto de interiores para escritório corporativo com área aproximada de 65 m²…' })}
          ${fld('scope', 'Escopo e entregas incluídas', p.scope, { type: 'textarea', wide: true, rows: 6, hint: 'Um item por linha — aparecem como lista no PDF.' })}
          ${fld('excluded', 'Serviços não incluídos', p.excluded, { type: 'textarea', wide: true, rows: 3, hint: 'Um item por linha.' })}
        </div></section>

        <section class="card" data-type="projeto"><div class="card-head"><h3>Etapas, entregas e prazos</h3></div>
          <div class="field mb-16"><label>Etapas e prazos</label><div data-stages></div></div>
          <div class="form-grid">${fld('deliverables', 'Produtos a serem entregues', p.deliverables, { type: 'textarea', wide: true, rows: 6, hint: 'Um item por linha.' })}
          ${fld('deadline_text', 'Prazo estimado (texto livre)', p.deadline_text, { wide: true, placeholder: 'Ex.: Projeto completo em até 45 dias úteis após o briefing' })}</div></section>

        <section class="card" data-type="acompanhamento"><div class="card-head"><h3>Acompanhamento de obra</h3></div><div class="form-grid" data-extra>
          ${fld('periodicidade', 'Periodicidade', ex.periodicidade, { list: 'dl-period', placeholder: 'Semanal, quinzenal, mensal…' })}${fld('visitas', 'Visitas incluídas', ex.visitas, { type: 'number' })}
          ${fld('periodo_inicio', 'Início do período', ex.periodo_inicio, { type: 'date' })}${fld('periodo_fim', 'Fim do período', ex.periodo_fim, { type: 'date' })}
          ${fld('cobranca', 'Forma de cobrança', ex.cobranca, { list: 'dl-cobranca', placeholder: 'Mensal fixo, por visita…' })}${fld('valor_visita', 'Valor por visita (opcional)', ex.valor_visita, { type: 'money' })}
        </div><div class="form-grid mt-16">${fld('deadline_text', 'Prazo estimado', p.deadline_text, { wide: true, attrs: 'data-mirror="deadline_text"' })}</div></section>

        <section class="card" data-type="visita"><div class="card-head"><h3>Visita técnica avulsa</h3></div><div class="form-grid" data-extra>
          ${fld('visita_local', 'Local', ex.visita_local, { wide: true })}${fld('visita_finalidade', 'Finalidade', ex.visita_finalidade, { type: 'textarea', wide: true, rows: 3 })}
          ${fld('visita_data', 'Data prevista', ex.visita_data, { type: 'date' })}${fld('visita_duracao', 'Duração prevista', ex.visita_duracao, { placeholder: 'Ex.: até 2 horas' })}
        </div><p class="small muted mb-0">O valor da visita é o valor total informado em Investimento.</p></section>

        <section class="card"><div class="card-head"><h3>Investimento e pagamento</h3></div><div class="form-grid">
          ${fld('amount', 'Valor total', p.amount, { type: 'money', req: true })}${fld('down_payment', 'Entrada (se houver)', p.down_payment, { type: 'money' })}
          ${fld('payment_method', 'Forma de pagamento', p.payment_method, { type: 'select', options: L.PAYMENT_METHODS })}<div></div>
          ${fld('pix_key', 'Chave Pix', p.pix_key, { hint: off.office.pix_key ? 'Cadastrada em Configurações › Escritório.' : 'Cadastre a chave em Configurações › Escritório para reaproveitar.' })}${fld('pix_name', 'Favorecido', p.pix_name)}
        </div><div class="field mt-16"><label>Entrada, parcelas e vencimentos</label><div data-plan></div></div></section>

        <section class="card"><div class="card-head"><h3>Observações e condições</h3></div><div class="form-grid">
          ${fld('conditions', 'Observações e condições adicionais (aparecem no PDF)', p.conditions, { type: 'textarea', wide: true, rows: 3 })}
          ${fld('notes', 'Observações internas (não aparecem no PDF)', p.notes, { type: 'textarea', wide: true, rows: 2 })}</div></section>

        <section class="card"><div class="card-head"><h3>Texto da proposta</h3><div class="row gap-8">${p.template_outdated ? html`<button class="btn xs" data-tplnew>Usar versão ${p.template.version} do modelo</button>` : ''}<button class="btn xs" data-draft>${icon('eye', 'sm')} Rascunho em PDF</button></div></div>
          <p class="small muted" style="margin-top:0">Texto baseado no modelo “${p.template ? p.template.name : svcLabel(p.service_type)}”${p.template_version ? ` (versão ${p.template_version})` : ''}. Edite livremente para esta proposta — o modelo não é alterado.</p>
          <div data-body></div></section>
      </div>
      <aside class="col doc-side" style="gap:16px">
        <div class="card"><div class="card-head"><h3>Resumo</h3></div><dl class="kv tight"><dt>Valor total</dt><dd class="serif" style="font-size:24px" data-sum-total>${money(p.amount)}</dd>
          <dt>Parcelas</dt><dd data-sum-n>${p.payment_plan.length || '—'}</dd><dt>Validade</dt><dd>${date(p.valid_until)}${p.valid_until ? ` (${relDay(p.valid_until)})` : ''}</dd>
          ${p.sent_at ? html`<dt>Enviada em</dt><dd>${date(p.sent_at)}</dd>` : ''}${p.approved_at ? html`<dt>Aprovação</dt><dd>${date(p.approved_at)} · ${p.approved_by}${p.approval_notes ? html`<div class="small muted">${p.approval_notes}</div>` : ''}</dd>` : ''}
          ${p.refusal_reason ? html`<dt>Motivo da recusa</dt><dd>${p.refusal_reason}</dd>` : ''}
          ${p.project_id ? html`<dt>Projeto</dt><dd><a href="#/projetos/${p.project_id}">${p.project_name}</a></dd>` : ''}
          ${p.contracts.length ? html`<dt>Contrato</dt><dd>${p.contracts.map((c) => html`<a href="#/contratos/editor/${c.id}">${c.number}</a> ${badge('CONTRACT_STATUS', c.status)} `)}</dd>` : ''}
          ${S.user.finance ? html`<dt>Financeiro</dt><dd>${p.receivables ? `${p.receivables} parcela(s) cadastrada(s)` : 'parcelas ainda não cadastradas'}</dd>` : ''}</dl></div>
        <div data-problems></div>
        <div data-att></div>
      </aside></div>
    <datalist id="dl-period"><option>Semanal</option><option>Quinzenal</option><option>Mensal</option><option>Conforme cronograma da obra</option></datalist>
    <datalist id="dl-cobranca"><option>Valor mensal fixo</option><option>Por visita realizada</option><option>Valor fechado pelo período</option></datalist>`);

  const tracker = dirtyTracker(root.querySelector('.doc-grid'));
  bindMoney(root);
  const cli = combo({ name: 'client_id', options: refOptions('clients'), value: p.client_id, allowEmpty: false, onChange: () => tracker.mark() });
  root.querySelector('[data-client]').appendChild(cli);
  const prj = combo({ name: 'project_id', options: refOptions('projects'), value: p.project_id, onChange: () => tracker.mark() });
  root.querySelector('[data-project]').appendChild(prj);
  const { rowsEditor } = await import('../lib.js');
  const stages = rowsEditor({ columns: [{ key: 'etapa', label: 'Etapa', w: '1.4fr' }, { key: 'prazo', label: 'Prazo', w: '1fr' }], rows: p.stages, addLabel: 'Adicionar etapa', empty: 'Nenhuma etapa.', onChange: () => tracker.mark() });
  root.querySelector('[data-stages]').appendChild(stages);
  const val = (n) => root.querySelector(`[name="${n}"]`);
  const plan = planEditor({ plan: p.payment_plan, getTotal: () => parseNum(val('amount').value), getDown: () => parseNum(val('down_payment').value), onChange: () => { tracker.mark(); summary(); } });
  root.querySelector('[data-plan]').appendChild(plan);
  const bodyEd = bodyEditor({ value: p.body, fields: off.fields, blocks: off.blocks, onChange: () => tracker.mark() });
  root.querySelector('[data-body]').appendChild(bodyEd);
  root.querySelector('[data-att]').appendChild(el(html`<div class="card"></div>`)).appendChild(attachments('proposals', p.id, { title: 'Arquivos da proposta', extraMeta: { category: 'Propostas', client_id: p.client_id } }));
  const summary = () => { root.querySelector('[data-sum-total]').textContent = money(parseNum(val('amount').value)); root.querySelector('[data-sum-n]').textContent = plan.plan.get().length || '—'; };
  root.addEventListener('input', (e) => { if (e.target.name === 'amount' || e.target.name === 'down_payment') { summary(); plan.plan.check(); } });
  // campos por tipo de serviço
  const showType = () => {
    const st = val('service_type').value;
    $$('[data-type]', root).forEach((s) => s.classList.toggle('hidden', !(s.dataset.type === 'projeto' ? PROJECT_TYPES.includes(st) : s.dataset.type === st)));
  };
  showType();
  val('service_type').addEventListener('change', async (e) => {
    showType();
    if (await confirmDialog(`Deseja substituir o texto da proposta pelo modelo “${svcLabel(e.target.value)}”? O texto atual será descartado.`, { title: 'Aplicar modelo do novo serviço', ok: 'Aplicar modelo' })) { collected.apply_template = true; await save(); }
  });
  // "Prazo estimado" aparece em dois lugares (projetos/acompanhamento): mantém sincronizado
  root.addEventListener('input', (e) => { if (e.target.name === 'deadline_text') $$('[name="deadline_text"]', root).forEach((i) => { if (i !== e.target) i.value = e.target.value; }); });

  const collected = {};
  const gather = () => {
    const v = readFields(root.querySelector('.doc-grid'));
    const extra = {}; ['periodicidade', 'visitas', 'periodo_inicio', 'periodo_fim', 'cobranca', 'valor_visita', 'visita_local', 'visita_finalidade', 'visita_data', 'visita_duracao'].forEach((k) => { extra[k] = v[k] ?? ''; delete v[k]; });
    return { ...v, client_id: cli.combo.get(), project_id: prj.combo.get() || null, extra, stages: stages.rows.get(), payment_plan: plan.plan.get(), body: bodyEd.body.get(), ...collected };
  };
  const save = async ({ quiet } = {}) => {
    const data = gather();
    if (!data.client_id) { toast('Selecione o cliente.', { error: true }); return false; }
    if (!String(data.title || '').trim()) { toast('Informe o projeto ou serviço.', { error: true }); return false; }
    const b = root.querySelector('[data-save]'); b.disabled = true;
    try { await api.put(`/honorarios/${id}`, data); tracker.clean(); if (!quiet) toast('Proposta salva.'); delete collected.apply_template; reload(); return true; } catch (e) { fail(e); b.disabled = false; return false; }
  };
  root.querySelector('[data-save]').onclick = () => save();
  const pdfUrl = `/pdf/proposal/${id}`;
  root.querySelector('[data-pdf]').onclick = () => openPdf(pdfUrl, { dirty: tracker.dirty, save: () => save({ quiet: true }), draftUrl: `${pdfUrl}?draft=1` });
  root.querySelector('[data-draft]').onclick = () => openPdf(`${pdfUrl}?draft=1`, { dirty: tracker.dirty, save: () => save({ quiet: true }) });
  const tn = root.querySelector('[data-tplnew]'); if (tn) tn.onclick = async () => { if (await confirmDialog('Substituir o texto desta proposta pela versão mais recente do modelo? As edições feitas no texto desta proposta serão perdidas.', { title: 'Atualizar texto', ok: 'Atualizar' })) { await api.post(`/honorarios/${id}/reload-template`); toast('Texto atualizado.'); reload(); } };
  root.querySelector('[data-more]').onclick = (e) => menu(e.currentTarget, [
    { label: 'Visualizar rascunho em PDF', icon: 'eye', fn: () => openPdf(`${pdfUrl}?draft=1`, { dirty: tracker.dirty, save: () => save({ quiet: true }) }) },
    { label: 'Baixar PDF', icon: 'download', fn: () => openPdf(`${pdfUrl}?download=1`, { dirty: tracker.dirty, save: () => save({ quiet: true }), draftUrl: `${pdfUrl}?draft=1` }) },
    { label: 'Duplicar proposta', icon: 'copy', fn: async () => { const d = await api.post(`/honorarios/${id}/duplicate`); toast(`Proposta duplicada como ${d.number}.`); ctx.go(`#/propostas/orcamento/${d.id}`); } },
    { label: 'Restaurar texto do modelo', icon: 'refresh', fn: async () => { if (await confirmDialog('Substituir o texto desta proposta pelo modelo atual do tipo de serviço?', { title: 'Restaurar texto', ok: 'Restaurar' })) { await api.post(`/honorarios/${id}/reload-template`); reload(); } } },
    { label: p.archived ? 'Restaurar do arquivo' : 'Arquivar', icon: 'archive', fn: async () => { await archiveRow('proposals', p, p.archived ? 0 : 1); reload(); } },
    '-', { label: 'Excluir proposta', icon: 'trash', danger: true, fn: async () => { try { if (await deleteRow('proposals', p, p.number)) ctx.go('#/propostas'); } catch (err) { fail(err); } } },
  ]);

  // barra de status e próximos passos
  const bar = root.querySelector('[data-status]');
  const st = p.status;
  bar.innerHTML = toHTML(html`<div class="steps">${['elaboracao', 'enviada', 'aprovada'].map((s, i) => html`<span class="step ${s === st || (st === 'aprovada' && i < 2) || (st === 'enviada' && i < 1) ? 'on' : ''}">${label('PROPOSAL_STATUS', s)}</span>`)}${['recusada', 'expirada'].includes(st) ? html`<span class="step bad on">${label('PROPOSAL_STATUS', st)}</span>` : ''}</div>
    <div class="row wrap gap-8">
      ${st === 'elaboracao' ? html`<button class="btn sm" data-st="enviada">${icon('mail', 'sm')} Marcar como enviada</button>` : ''}
      ${['enviada', 'elaboracao', 'expirada'].includes(st) ? html`<button class="btn sm primary" data-approve>${icon('check', 'sm')} Registrar aprovação</button>` : ''}
      ${st === 'enviada' ? html`<button class="btn sm" data-refuse>Recusada</button><button class="btn sm" data-st="expirada">Expirada</button>` : ''}
      ${st === 'aprovada' ? html`<button class="btn sm primary" data-contract>${icon('contract', 'sm')} Gerar contrato a partir da proposta</button>${S.user.finance ? html`<button class="btn sm" data-recv>${icon('in', 'sm')} Cadastrar parcelas no financeiro</button>` : ''}${!p.project_id ? html`<button class="btn sm" data-proj>${icon('folder', 'sm')} Criar projeto</button>` : ''}` : ''}
      ${st !== 'elaboracao' ? html`<button class="btn sm ghost" data-st="elaboracao">Voltar para rascunho</button>` : ''}</div>`);
  const setStatus = async (status, extra = {}) => { if (tracker.dirty && !(await save({ quiet: true }))) return; try { await api.post(`/honorarios/${id}/status`, { status, ...extra }); toast(`Status: ${label('PROPOSAL_STATUS', status)}.`); reload(); } catch (e) { fail(e); } };
  bar.onclick = async (e) => {
    const b = e.target.closest('[data-st]'); if (b) return setStatus(b.dataset.st);
    if (e.target.closest('[data-refuse]')) return modal({ title: 'Proposta recusada', body: html`<div class="field"><label>Motivo da recusa (opcional)</label><input id="rr"></div>`, actions: [{ label: 'Cancelar' }, { label: 'Registrar recusa', danger: true, fn: (m) => setStatus('recusada', { refusal_reason: m.querySelector('#rr').value }) }] });
    if (e.target.closest('[data-approve]')) return approveModal(p, async (data) => { if (tracker.dirty && !(await save({ quiet: true }))) return false; await api.post(`/honorarios/${id}/status`, { status: 'aprovada', ...data }); toast('Aprovação registrada.'); afterApproval(ctx, id); });
    if (e.target.closest('[data-contract]')) return contractFromProposal(ctx, p);
    if (e.target.closest('[data-recv]')) return receivablesModal('proposal', id, reload);
    if (e.target.closest('[data-proj]')) { const r = await api.post(`/honorarios/${id}/project`); toast('Projeto criado a partir da proposta.'); ctx.go(`#/projetos/${r.project_id}`); }
  };
  if (locked) root.querySelector('.doc-hero').appendChild(el(html`<div class="small muted mt-8">Proposta aprovada. Alterações continuam possíveis, mas o que já foi aprovado pelo cliente deve ser preservado.</div>`));
  // pendências para emissão (conferidas no servidor)
  api.get(`${pdfUrl}?check=1`).then((r) => { root.querySelector('[data-problems]').innerHTML = toHTML(problemsBox(r.problems)); }).catch(() => {});
}

function approveModal(p, onOk) {
  modal({ title: 'Registrar aprovação', body: html`<p class="small muted" style="margin-top:0">Registre como o cliente aprovou a proposta ${p.number}. A aprovação fica no histórico do cliente.</p><div class="form-grid">
    <div class="field wide"><label>Aprovada por <span class="req">*</span></label><input id="ap-by" value="${p.contact_name || p.client_name || ''}" placeholder="Nome de quem aprovou"></div>
    <div class="field"><label>Data da aprovação</label><input id="ap-at" type="date" value="${today()}"></div><div class="field"><label>Meio</label><select id="ap-via"><option>WhatsApp</option><option>E-mail</option><option>Reunião</option><option>Assinatura</option><option>Telefone</option><option>Outro</option></select></div>
    <div class="field wide"><label>Observações</label><input id="ap-n" placeholder="Opcional"></div></div>`,
  actions: [{ label: 'Cancelar' }, { label: 'Registrar aprovação', primary: true, fn: async (m) => {
    const by = m.querySelector('#ap-by').value.trim(); if (!by) { toast('Informe quem aprovou.', { error: true }); return false; }
    const r = await onOk({ approved_by: `${by} (${m.querySelector('#ap-via').value})`, approved_at: m.querySelector('#ap-at').value, approval_notes: m.querySelector('#ap-n').value });
    return r;
  } }] });
}
async function afterApproval(ctx, id) {
  const p = await api.get(`/honorarios/${id}`);
  modal({ title: 'Proposta aprovada', body: html`<p class="muted" style="margin-top:0">O que deseja fazer agora? Todas as opções reaproveitam os dados da proposta.</p>
    <label class="toggle"><input type="checkbox" id="aa-c" checked><span class="sw"></span><span>Gerar o contrato a partir da proposta</span></label>
    ${!p.project_id ? html`<label class="toggle"><input type="checkbox" id="aa-p" checked><span class="sw"></span><span>Criar o projeto (com etapas padrão)</span></label>` : ''}
    ${S.user.finance ? html`<label class="toggle"><input type="checkbox" id="aa-r"><span class="sw"></span><span>Cadastrar as ${p.payment_plan.length} parcela(s) no financeiro agora</span></label><p class="tiny muted" style="margin:0 0 0 46px">O sistema confere se já existem lançamentos iguais para não duplicar. Você também pode cadastrar depois, pelo contrato.</p>` : ''}`,
  actions: [{ label: 'Agora não', fn: () => proposalEditor(ctx, id) }, { label: 'Continuar', primary: true, fn: async (m) => {
    const q = (s) => m.querySelector(s) && m.querySelector(s).checked;
    try {
      if (q('#aa-p')) await api.post(`/honorarios/${id}/project`);
      if (q('#aa-r')) { const r = await api.post('/plan-receivables', { source: 'proposal', id, confirm: true }); toast(`${r.created} parcela(s) cadastrada(s)${r.already ? `, ${r.already} já existia(m)` : ''}.`); }
      if (q('#aa-c')) { const c = await api.post(`/honorarios/${id}/contract`); toast('Contrato criado. Confira os dados e emita o PDF.'); ctx.go(`#/contratos/editor/${c.id}`); return; }
      proposalEditor(ctx, id);
    } catch (e) { fail(e); }
  } }] });
}
async function contractFromProposal(ctx, p) {
  try { const r = await api.post(`/honorarios/${p.id}/contract`); toast('Contrato criado a partir da proposta.'); ctx.go(`#/contratos/editor/${r.id}`); }
  catch (e) {
    if (e.status !== 409) return fail(e);
    const cid = e.data && e.data.contract_id;
    modal({ title: 'Contrato já existe', body: html`<p class="muted" style="margin:0">${e.message} Deseja abrir o contrato existente ou criar um novo?</p>`,
      actions: [{ label: 'Criar outro', fn: async () => { const r = await api.post(`/honorarios/${p.id}/contract`, { force: true }); ctx.go(`#/contratos/editor/${r.id}`); } }, { label: 'Abrir existente', primary: true, fn: () => ctx.go(`#/contratos/editor/${cid}`) }] });
  }
}

// Cadastrar parcelas no financeiro com conferência de duplicidade
export async function receivablesModal(source, id, onDone) {
  let prev;
  try { prev = await api.post('/plan-receivables', { source, id }); } catch (e) { return fail(e); }
  modal({ title: 'Cadastrar parcelas no financeiro', body: html`<p class="small muted" style="margin-top:0">${prev.to_create ? `${prev.to_create} parcela(s) serão cadastradas em Financeiro › Entradas.` : 'Todas as parcelas já estão cadastradas no financeiro.'}${prev.already ? ` ${prev.already} já existem e não serão duplicadas.` : ''}</p>
    <div class="table-wrap"><table class="t compact"><thead><tr><th>Parcela</th><th>Vencimento</th><th class="right">Valor</th><th>Situação</th></tr></thead><tbody>
    ${prev.rows.map((r) => html`<tr><td>${r.n}/${r.total} ${r.label ? html`<span class="muted small">${r.label}</span>` : ''}</td><td>${date(r.due_date)}</td><td class="right">${money(r.amount)}</td><td>${r.existing ? html`<span class="badge success plain">já cadastrada</span><div class="tiny muted">${r.existing.description}</div>` : html`<span class="badge info plain">será cadastrada</span>`}</td></tr>`)}</tbody></table></div>`,
  actions: [{ label: prev.to_create ? 'Cancelar' : 'Fechar' }, ...(prev.to_create ? [{ label: `Cadastrar ${prev.to_create} parcela(s)`, primary: true, fn: async () => { const r = await api.post('/plan-receivables', { source, id, confirm: true }); toast(`${r.created} parcela(s) cadastrada(s).`); onDone && onDone(); } }] : [])] });
}

// ------------------------------ PROPOSTA SIMPLES (antiga) ------------------------------
export async function proposalDrawer(id, onChange) {
  const p = await api.get(`/r/proposals/${id}`);
  const flow = ['elaboracao', 'enviada', 'aprovada', 'recusada', 'expirada'];
  const body = el(html`<div>
    <div class="row between wrap mb-16"><div class="serif" style="font-size:34px">${money(p.amount)}</div>${badge('PROPOSAL_STATUS', p.status)}</div>
    <div class="card flat mb-16 row between wrap small"><span>Esta proposta foi registrada no formato simples. Converta para usar o modelo de orçamento de obra, parcelas e PDF.</span><button class="btn xs primary" data-up>Converter</button></div>
    <div class="eyebrow mb-8">Alterar status</div>
    <div class="btn-group mb-24" style="flex-wrap:wrap" data-st>${flow.map((s) => html`<button class="${s === p.status ? 'on' : ''}" data-v="${s}">${label('PROPOSAL_STATUS', s)}</button>`)}</div>
    <dl class="kv"><dt>Cliente</dt><dd><a href="#/clientes/${p.client_id}">${p.client_name}</a></dd><dt>Tipo</dt><dd>${p.project_type || '—'}</dd>
      <dt>Área</dt><dd>${p.area ? p.area + ' m²' : '—'}</dd><dt>Imóvel</dt><dd>${[p.address, p.city].filter(Boolean).join(' — ') || '—'}</dd>
      <dt>Parcelas previstas</dt><dd>${p.installments || 1}x de ${money(p.amount / (p.installments || 1))}</dd>
      <dt>Enviada em</dt><dd>${date(p.sent_at)}</dd><dt>Validade</dt><dd>${date(p.valid_until)}${p.valid_until ? ` (${relDay(p.valid_until)})` : ''}</dd>
      <dt>Responsável</dt><dd>${p.responsible_name || '—'}</dd>${p.refusal_reason ? html`<dt>Motivo da recusa</dt><dd>${p.refusal_reason}</dd>` : ''}
      ${p.project_id ? html`<dt>Projeto gerado</dt><dd><a href="#/projetos/${p.project_id}">${p.project_name}</a></dd>` : ''}
      ${p.notes ? html`<dt>Observações</dt><dd class="notes">${p.notes}</dd>` : ''}</dl>
    ${p.status === 'aprovada' && !p.project_id ? html`<div class="card flat mt-24 row between wrap"><span>Proposta aprovada. Gere o projeto com os dados já preenchidos.</span><button class="btn primary sm" data-conv>Gerar projeto</button></div>` : ''}
    <div class="mt-24" data-att></div></div>`);
  body.querySelector('[data-att]').appendChild(attachments('proposals', p.id, { title: 'Arquivo da proposta', extraMeta: { category: 'Propostas', client_id: p.client_id } }));
  const d = drawer({ title: `${p.number} — ${p.title}`, sub: 'Proposta', body, onClose: onChange });
  body.querySelector('[data-up]').onclick = async () => { const r = await api.post(`/honorarios/${p.id}/upgrade`); d.close(); location.hash = `#/propostas/orcamento/${r.id}`; };
  body.querySelector('[data-st]').onclick = async (e) => {
    const b = e.target.closest('[data-v]'); if (!b || b.dataset.v === p.status) return;
    let extra = {};
    if (b.dataset.v === 'recusada') { const r = prompt('Motivo da recusa (opcional):'); if (r === null) return; extra.refusal_reason = r; }
    try { await api.put(`/r/proposals/${p.id}`, { status: b.dataset.v, ...extra }); toast('Status atualizado.'); d.close();
      if (b.dataset.v === 'aprovada' && !p.project_id) convertModal(p, onChange); else proposalDrawer(p.id, onChange); } catch (err) { fail(err); }
  };
  const cv = body.querySelector('[data-conv]'); if (cv) cv.onclick = () => { d.close(); convertModal(p, onChange); };
  d.foot.classList.remove('hidden');
  d.foot.innerHTML = toHTML(html`<button class="btn danger" data-del>${icon('trash')}</button><button class="btn" data-dup>${icon('copy')} Duplicar</button><span class="grow"></span><button class="btn primary" data-edit>${icon('edit')} Editar</button>`);
  d.foot.querySelector('[data-edit]').onclick = () => { d.close(); openForm('proposals', { id: p.id, onSaved: onChange }); };
  d.foot.querySelector('[data-dup]').onclick = async () => { await duplicateRow('proposals', p); d.close(); };
  d.foot.querySelector('[data-del]').onclick = async () => { if (await deleteRow('proposals', p, p.number)) d.close(); };
}

function convertModal(p, onChange) {
  modal({ title: 'Proposta aprovada', body: html`<p class="muted" style="margin-top:0">Deseja gerar o projeto <b>${p.title}</b> automaticamente, com cliente, tipo, área, endereço e valor já preenchidos e as etapas padrão criadas?</p>
    <label class="toggle"><input type="checkbox" id="mc" checked><span class="sw"></span><span>Criar também o contrato (aguardando assinatura) com ${p.installments || 1} parcela(s)</span></label>
    <div class="form-grid mt-16"><div class="field"><label>1º vencimento</label><input type="date" id="fd" value="${addDays(today(), 7)}"></div>
    <div class="field"><label>Forma de pagamento</label><select id="pm">${S.meta.lists.PAYMENT_METHODS.map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select></div></div>`,
  actions: [{ label: 'Agora não' }, { label: 'Gerar projeto', primary: true, fn: async (m) => {
    const r = await api.post(`/proposals/${p.id}/convert`, { create_contract: m.querySelector('#mc').checked, first_due_date: m.querySelector('#fd').value, payment_method: m.querySelector('#pm').value });
    toast('Projeto criado a partir da proposta.'); location.hash = '#/projetos/' + r.project_id;
  } }], onClose: () => onChange && onChange() });
}

// ------------------------------ CONTRATOS ------------------------------
async function contracts(ctx) {
  const page = await listPage({
    root: ctx.root, res: 'contracts', title: 'Contratos', sub: 'Contratos com modelos por tipo de serviço, emissões em PDF e parcelas no financeiro', query: ctx.query,
    presets: [{ key: 'aguardando', label: 'Aguardando assinatura' }, { key: 'ativos', label: 'Ativos' }, { key: '', label: 'Todos' }],
    filters: ['status', 'client_id'],
    columns: [
      { key: 'number', label: 'Nº', render: (c) => html`<span class="cell-title">${c.number}</span>` },
      { key: 'client_name', label: 'Cliente', render: (c) => html`<div class="cell-title">${c.client_name}</div><div class="cell-sub">${[c.project_name, c.service_type ? svcLabel(c.service_type) : null].filter(Boolean).join(' · ')}</div>` },
      { key: 'amount', label: 'Valor', align: 'right', render: (c) => money(c.amount) },
      { key: 'installments', label: 'Parcelas', render: (c) => `${c.installments || 1}x` },
      S.user.finance ? { key: 'received', label: 'Recebido', align: 'right', render: (c) => money(c.received) } : null,
      { key: 'signed_at', label: 'Assinatura', render: (c) => date(c.signed_at) },
      { key: 'status', label: 'Status', render: (c) => badge('CONTRACT_STATUS', c.status), csv: (c) => label('CONTRACT_STATUS', c.status) },
    ].filter(Boolean),
    onRow: (c) => (c.template_id ? ctx.go(`#/contratos/editor/${c.id}`) : contractDrawer(c.id, () => page.load())),
    actions: (c, reload) => [c.template_id ? { label: 'Abrir editor', icon: 'edit', fn: () => ctx.go(`#/contratos/editor/${c.id}`) } : { label: 'Preparar documento pelo modelo', icon: 'contract', fn: () => prepareLegacy(ctx, c) }, ...rowActions('contracts', c, { onChange: reload, edit: !c.template_id })],
    onNew: () => newContract(ctx), newLabel: 'Novo contrato',
    totals: (rows) => `Total ${money(rows.filter((c) => c.status !== 'cancelado').reduce((s, c) => s + c.amount, 0))}`,
  });
  if (ctx.params[0] && /^\d+$/.test(ctx.params[0])) {
    const c = await api.get(`/r/contracts/${ctx.params[0]}`).catch(() => null);
    if (c && c.template_id) return ctx.go(`#/contratos/editor/${c.id}`);
    contractDrawer(Number(ctx.params[0]), () => page.load());
  }
}
async function prepareLegacy(ctx, c) {
  modal({ title: 'Preparar contrato pelo modelo', body: html`<p class="small muted" style="margin-top:0">O texto do modelo será aplicado a este contrato e os dados das partes serão preenchidos a partir dos cadastros. Nada no financeiro é alterado.</p>
    <div class="field"><label>Modelo de contrato</label><select id="pl-s">${S.meta.lists.SERVICE_TYPES.map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select></div>`,
  actions: [{ label: 'Cancelar' }, { label: 'Aplicar modelo', primary: true, fn: async (m) => { await api.post(`/contract-docs/${c.id}/reload-template`, { service_type: m.querySelector('#pl-s').value }); ctx.go(`#/contratos/editor/${c.id}`); } }] });
}
async function newContract(ctx) {
  const props = (await list('proposals', { preset: 'honorarios', limit: 500 })).rows.filter((p) => ['aprovada', 'enviada'].includes(p.status));
  const body = el(html`<div>
    <div class="btn-group mb-16" data-mode><button class="on" data-m="prop">A partir de uma proposta</button><button data-m="tpl">A partir de um modelo</button></div>
    <div data-p="prop"><div class="field"><label>Proposta (aprovadas e enviadas)</label>${props.length ? html`<select id="nc-p">${props.map((p) => html`<option value="${p.id}">${p.number} — ${p.client_name} — ${p.title} (${label('PROPOSAL_STATUS', p.status)})</option>`)}</select>` : html`<div class="small muted">Nenhuma proposta aprovada ou enviada no Orçamento de obra.</div>`}</div>
      <p class="small muted">Reaproveita cliente, escritório, projeto, endereço, serviço, escopo, prazos, valores, parcelas, forma de pagamento e Pix.</p></div>
    <div data-p="tpl" class="hidden"><div class="form-grid"><div class="field wide"><label>Cliente</label><div data-cli></div></div>
      <div class="field"><label>Modelo de contrato</label><select id="nc-s">${S.meta.lists.SERVICE_TYPES.map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select></div>
      <div class="field"><label>Projeto (opcional)</label><div data-prj></div></div></div></div></div>`);
  const cli = combo({ name: 'client_id', options: refOptions('clients'), allowEmpty: false }); body.querySelector('[data-cli]').appendChild(cli);
  const prj = combo({ name: 'project_id', options: refOptions('projects') }); body.querySelector('[data-prj]').appendChild(prj);
  let mode = 'prop';
  body.querySelector('[data-mode]').onclick = (e) => { const b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m; $$('[data-m]', body).forEach((x) => x.classList.toggle('on', x === b)); $$('[data-p]', body).forEach((x) => x.classList.toggle('hidden', x.dataset.p !== mode)); };
  const m = modal({ title: 'Novo contrato', body, actions: [{ label: 'Cancelar' }, { label: 'Criar contrato', primary: true, fn: async () => {
    if (mode === 'prop') { const s = body.querySelector('#nc-p'); if (!s) { toast('Selecione uma proposta.', { error: true }); return false; } const pp = props.find((x) => x.id == s.value); await contractFromProposal(ctx, pp); return; }
    if (!cli.combo.get()) { toast('Selecione o cliente.', { error: true }); return false; }
    const r = await api.post('/contracts/from-template', { service_type: body.querySelector('#nc-s').value, client_id: cli.combo.get(), project_id: prj.combo.get() || null });
    toast('Contrato criado. Complete os dados e emita o PDF.'); ctx.go(`#/contratos/editor/${r.id}`);
  } }] });
  m.el.style.width = 'min(640px, calc(100vw - 32px))';
}

// ------------------------------ EDITOR DO CONTRATO ------------------------------
async function contractEditor(ctx, id) {
  const root = ctx.root;
  let c; let off;
  try { [c, off] = await Promise.all([api.get(`/contract-docs/${id}`), api.get('/office')]); } catch (e) { root.innerHTML = toHTML(html`<div class="empty">${icon('alert')}<div>${e.message}</div></div>`); return; }
  const L = S.meta.lists; const d = c.data || {};
  const reload = () => contractEditor(ctx, id);
  let etapas = []; try { etapas = JSON.parse(d.etapas || '[]'); } catch { etapas = []; }
  root.innerHTML = toHTML(html`
    <div class="hero doc-hero"><div class="crumbs"><a href="#/contratos">Contratos</a> ${icon('chevron', 'sm')} <span>${c.number}</span></div>
      <div class="row between top wrap gap-16"><div style="min-width:0"><h1>Contrato ${c.number}</h1>
        <div class="info-row mt-8"><span>${icon('users', 'sm')}<a href="#/clientes/${c.client_id}">${c.client_name}</a></span>${c.proposal_id ? html`<span>${icon('proposal', 'sm')}<a href="#/propostas/orcamento/${c.proposal_id}">Proposta ${c.proposal_number}</a></span>` : ''}${c.project_id ? html`<span>${icon('folder', 'sm')}<a href="#/projetos/${c.project_id}">${c.project_name}</a></span>` : ''}${badge('CONTRACT_STATUS', c.status)}<span class="dirty-flag">alterações não salvas</span></div></div>
        <div class="row wrap"><button class="btn" data-save>${icon('check')} Salvar</button><button class="btn" data-draft>${icon('eye')} Pré-visualizar</button><button class="btn primary" data-issue>${icon('print')} Emitir contrato em PDF</button><button class="icon-btn" data-more>${icon('more')}</button></div></div></div>
    <div class="doc-grid mt-24">
      <div class="col" style="gap:16px">
        <section class="card"><div class="card-head"><h3>Modelo</h3></div><div class="form-grid">
          <div class="field"><label>Tipo de serviço / modelo</label><select name="service_type">${L.SERVICE_TYPES.map((o) => html`<option value="${o.value}" ${o.value === c.service_type ? 'selected' : ''}>${o.label}</option>`)}</select></div>
          <div class="field"><label>Versão do modelo usada</label><div class="small" style="padding-top:10px">${c.template ? html`${c.template.name} · versão ${c.template_version}${c.template_outdated ? html` <span class="badge warning plain">há versão ${c.template.version}</span>` : ''}${c.template.status === 'pendente' ? html` <span class="badge danger plain">modelo pendente</span>` : ''}` : '—'}</div></div>
          <div class="field wide"><label>Projeto vinculado</label><div data-project></div></div></div></section>

        <section class="card"><div class="card-head"><h3>Contratante</h3><button class="btn xs" data-fill-client>Usar dados do cadastro do cliente</button></div><div class="form-grid" data-d>
          ${fld('contratante_nome', 'Nome / razão social', d.contratante_nome, { wide: true, req: true })}${fld('contratante_doc', 'CPF / CNPJ', d.contratante_doc, { req: true })}<div></div>
          ${fld('contratante_endereco', 'Endereço completo', d.contratante_endereco, { wide: true, req: true })}
          ${fld('contratante_representante', 'Representante legal (se PJ)', d.contratante_representante)}${fld('contratante_rep_doc', 'CPF do representante', d.contratante_rep_doc)}</div></section>

        <section class="card"><div class="card-head"><h3>Contratado</h3><button class="btn xs" data-fill-office>Usar dados do escritório</button></div><div class="form-grid" data-d>
          ${fld('contratado_nome', 'Nome', d.contratado_nome, { wide: true, req: true })}${fld('contratado_doc', 'CPF / CNPJ', d.contratado_doc, { req: true })}${fld('contratado_registro', 'Registro profissional', d.contratado_registro, { placeholder: 'Arquiteto – CAU BR …' })}
          ${fld('contratado_endereco', 'Endereço', d.contratado_endereco, { wide: true })}</div></section>

        <section class="card"><div class="card-head"><h3>Serviço contratado</h3></div><div class="form-grid" data-d>
          ${fld('projeto_nome', 'Projeto / serviço', d.projeto_nome, { wide: true })}
          ${fld('objeto', 'Objeto do contrato', d.objeto, { type: 'textarea', wide: true, rows: 5 })}
          ${fld('localizacao', 'Localização / endereço do projeto', d.localizacao, { wide: true })}${fld('area', 'Área (m²)', d.area, { type: 'number' })}
          ${fld('prazo_data', 'Data de entrega (prazo)', d.prazo_data, { type: 'date', hint: 'Ex.: entrega do projeto 3D, usada no texto “DOS PRAZOS”.' })}
          ${fld('prazo_texto', 'Prazo (texto)', d.prazo_texto, { type: 'textarea', wide: true, rows: 2 })}
          ${fld('escopo', 'Escopo (um item por linha)', d.escopo, { type: 'textarea', wide: true, rows: 4 })}
          ${fld('entregas', 'Entregas (um item por linha)', d.entregas, { type: 'textarea', wide: true, rows: 3 })}
          ${fld('nao_incluidos', 'Serviços não incluídos (um por linha)', d.nao_incluidos, { type: 'textarea', wide: true, rows: 3 })}
          <div class="field wide"><label>Etapas e prazos</label><div data-etapas></div></div>
          <div class="wide form-grid" data-type="acompanhamento">${fld('periodicidade', 'Periodicidade', d.periodicidade)}${fld('visitas', 'Visitas incluídas', d.visitas, { type: 'number' })}${fld('periodo_inicio', 'Início', d.periodo_inicio, { type: 'date' })}${fld('periodo_fim', 'Fim', d.periodo_fim, { type: 'date' })}${fld('cobranca', 'Forma de cobrança', d.cobranca)}${fld('valor_visita', 'Valor por visita', d.valor_visita, { type: 'money' })}</div>
          <div class="wide form-grid" data-type="visita">${fld('visita_local', 'Local da visita', d.visita_local, { wide: true })}${fld('visita_finalidade', 'Finalidade', d.visita_finalidade, { type: 'textarea', wide: true, rows: 2 })}${fld('visita_data', 'Data prevista', d.visita_data, { type: 'date' })}${fld('visita_duracao', 'Duração prevista', d.visita_duracao)}</div>
          ${fld('condicoes', 'Condições adicionais', d.condicoes, { type: 'textarea', wide: true, rows: 3 })}</div></section>

        <section class="card"><div class="card-head"><h3>Valores e pagamento</h3></div><div class="form-grid">
          ${fld('amount', 'Valor total', c.amount, { type: 'money', req: true })}${fld('payment_method', 'Forma de pagamento', c.payment_method, { type: 'select', options: L.PAYMENT_METHODS })}
          <div class="wide form-grid" data-d>${fld('pix_key', 'Chave Pix', d.pix_key ?? off.office.pix_key)}${fld('pix_name', 'Favorecido', d.pix_name ?? off.office.pix_name)}</div></div>
          <div class="field mt-16"><label>Parcelas e vencimentos</label><div data-plan></div></div></section>

        <section class="card"><div class="card-head"><h3>Assinaturas</h3></div><div class="form-grid" data-d>
          ${fld('local_assinatura', 'Local', d.local_assinatura, { placeholder: 'Campo Grande – MS' })}${fld('data_assinatura', 'Data', d.data_assinatura, { type: 'date' })}
          ${fld('testemunha1_nome', 'Testemunha 1 (opcional)', d.testemunha1_nome)}${fld('testemunha1_doc', 'CPF da testemunha 1', d.testemunha1_doc)}
          ${fld('testemunha2_nome', 'Testemunha 2 (opcional)', d.testemunha2_nome)}${fld('testemunha2_doc', 'CPF da testemunha 2', d.testemunha2_doc)}</div></section>

        <section class="card"><div class="card-head"><h3>Texto do contrato</h3>${c.template_outdated ? html`<button class="btn xs" data-tplnew>Usar versão ${c.template.version} do modelo</button>` : ''}</div>
          <p class="small muted" style="margin-top:0">O texto é uma cópia do modelo feita para este contrato: alterações no modelo não mudam este contrato, e cada emissão guarda o texto e os dados usados.</p><div data-body></div></section>
      </div>
      <aside class="col doc-side" style="gap:16px">
        <div class="card"><div class="card-head"><h3>Emissões</h3></div>${c.issues.length ? html`<div class="list">${c.issues.map((i) => html`<div class="list-item"><div class="grow"><div class="li-title">Versão ${i.version}</div><div class="li-sub">${datetime(i.issued_at)} · ${i.issued_by_name || ''} · modelo v${i.template_version || '—'}</div></div><button class="btn xs" data-open-issue="${i.id}">${icon('print', 'sm')} PDF</button></div>`)}</div>` : html`<div class="empty sm">Nenhuma emissão ainda. Use “Emitir contrato em PDF”.</div>`}</div>
        <div class="card"><div class="card-head"><h3>Situação</h3></div><dl class="kv tight"><dt>Status</dt><dd>${badge('CONTRACT_STATUS', c.status)}</dd><dt>Assinatura</dt><dd>${date(c.signed_at)}</dd>
          ${S.user.finance ? html`<dt>Financeiro</dt><dd>${c.receivables ? `${c.receivables} parcela(s) cadastrada(s)` : 'parcelas não cadastradas'}</dd>` : ''}</dl>
          <div class="row wrap gap-8 mt-16">${S.user.finance ? html`<button class="btn sm" data-recv>${icon('in', 'sm')} Cadastrar parcelas no financeiro</button>` : ''}
          ${['elaboracao', 'aguardando_assinatura'].includes(c.status) ? html`<button class="btn sm" data-sign>${icon('check', 'sm')} Marcar como assinado</button>` : ''}</div></div>
        <div data-problems></div>
        <div class="card" data-att></div>
      </aside></div>`);

  const tracker = dirtyTracker(root.querySelector('.doc-grid'));
  bindMoney(root);
  const prj = combo({ name: 'project_id', options: refOptions('projects'), value: c.project_id, onChange: () => tracker.mark() });
  root.querySelector('[data-project]').appendChild(prj);
  const { rowsEditor } = await import('../lib.js');
  const et = rowsEditor({ columns: [{ key: 'etapa', label: 'Etapa', w: '1.4fr' }, { key: 'prazo', label: 'Prazo', w: '1fr' }], rows: etapas, addLabel: 'Adicionar etapa', empty: 'Nenhuma etapa (use {{etapas_prazos}} no texto para exibir).', onChange: () => tracker.mark() });
  root.querySelector('[data-etapas]').appendChild(et);
  const val = (n) => root.querySelector(`[name="${n}"]`);
  const plan = planEditor({ plan: c.payment_plan, getTotal: () => parseNum(val('amount').value), onChange: () => tracker.mark() });
  root.querySelector('[data-plan]').appendChild(plan);
  root.addEventListener('input', (e) => { if (e.target.name === 'amount') plan.plan.check(); });
  const bodyEd = bodyEditor({ value: c.body, fields: off.fields, blocks: off.blocks, onChange: () => tracker.mark(), rows: 26 });
  root.querySelector('[data-body]').appendChild(bodyEd);
  root.querySelector('[data-att]').appendChild(attachments('contracts', c.id, { title: 'Contrato assinado e anexos', extraMeta: { category: 'Contratos', client_id: c.client_id, project_id: c.project_id } }));
  const showType = () => { const st = val('service_type').value; $$('[data-type]', root).forEach((s) => s.classList.toggle('hidden', s.dataset.type !== st)); };
  showType();
  const extra = {};
  val('service_type').addEventListener('change', async (e) => { showType(); if (await confirmDialog(`Aplicar o texto do modelo “${svcLabel(e.target.value)}” a este contrato? O texto atual será substituído.`, { title: 'Trocar modelo', ok: 'Aplicar modelo' })) { extra.apply_template = true; save(); } });
  const gather = () => {
    const data = {}; $$('[data-d]', root).forEach((sec) => Object.assign(data, readFields(sec)));
    ['periodicidade', 'visitas', 'periodo_inicio', 'periodo_fim', 'cobranca', 'valor_visita', 'visita_local', 'visita_finalidade', 'visita_data', 'visita_duracao'].forEach((k) => { const i = val(k); if (i) data[k] = i.hasAttribute('data-money') ? (i.value.trim() === '' ? '' : parseNum(i.value)) : i.value; });
    data.etapas = et.rows.get();
    return { data, service_type: val('service_type').value, amount: parseNum(val('amount').value), payment_method: val('payment_method').value, project_id: prj.combo.get() || null, payment_plan: plan.plan.get(), body: bodyEd.body.get(), ...extra };
  };
  const save = async ({ quiet } = {}) => {
    const b = root.querySelector('[data-save]'); b.disabled = true;
    try { await api.put(`/contract-docs/${id}`, gather()); tracker.clean(); if (!quiet) toast('Contrato salvo.'); delete extra.apply_template; reload(); return true; } catch (e) { fail(e); b.disabled = false; return false; }
  };
  root.querySelector('[data-save]').onclick = () => save();
  root.querySelector('[data-draft]').onclick = () => openPdf(`/pdf/contract/${id}`, { dirty: tracker.dirty, save: () => save({ quiet: true }) });
  root.querySelector('[data-draft]').title = 'Rascunho com marca d’água, com os campos faltantes indicados';
  root.querySelector('[data-issue]').onclick = async () => {
    if (tracker.dirty && !(await save({ quiet: true }))) return;
    const chk = await api.get(`/contract-docs/${id}/check`);
    if (!chk.ok) { const { pdfProblems } = await import('../lib.js'); return pdfProblems(chk.problems, `/pdf/contract/${id}`); }
    modal({ title: 'Emitir contrato', body: html`<p class="muted" style="margin-top:0">Será emitida a <b>versão ${c.issues.length + 1}</b> do contrato ${c.number}. O texto e os dados desta emissão ficam guardados e não mudam, mesmo que o contrato ou o modelo sejam alterados depois.</p><div class="field"><label>Observação da emissão (opcional)</label><input id="is-n" placeholder="Ex.: versão enviada para assinatura"></div>`,
      actions: [{ label: 'Cancelar' }, { label: 'Emitir e abrir PDF', primary: true, fn: async (m) => {
        const w = window.open('', '_blank');
        try { const r = await api.post(`/contract-docs/${id}/issue`, { notes: m.querySelector('#is-n').value }); const url = `/api/pdf/contract-issue/${r.issue_id}`; if (w) w.location.href = url; else location.href = url; toast(`Contrato emitido — versão ${r.version}.`); setTimeout(reload, 300); }
        catch (e) { if (w) w.close(); failProblems(e); return false; }
      } }] });
  };
  root.addEventListener('click', async (e) => {
    const oi = e.target.closest('[data-open-issue]'); if (oi) window.open(`/api/pdf/contract-issue/${oi.dataset.openIssue}`, '_blank');
    if (e.target.closest('[data-recv]')) { if (tracker.dirty && !(await save({ quiet: true }))) return; receivablesModal('contract', id, reload); }
    if (e.target.closest('[data-sign]')) { await api.put(`/r/contracts/${id}`, { status: 'ativo', signed_at: today() }); toast('Contrato marcado como assinado. Parcelas previstas passam a “a receber”.'); reload(); }
    if (e.target.closest('[data-tplnew]')) { if (await confirmDialog('Substituir o texto deste contrato pela versão mais recente do modelo? Emissões já feitas não mudam.', { title: 'Atualizar texto', ok: 'Atualizar' })) { await api.post(`/contract-docs/${id}/reload-template`); reload(); } }
    if (e.target.closest('[data-fill-client]')) {
      const cl = await api.get(`/r/clients/${c.client_id}`);
      const setv = (n, v) => { const i = val(n); if (i && v) { i.value = v; tracker.mark(); } };
      setv('contratante_nome', cl.name); setv('contratante_doc', cl.doc); setv('contratante_endereco', [cl.address, cl.city, cl.state].filter(Boolean).join(', ') + (cl.zip ? `, CEP ${cl.zip}` : ''));
      toast('Dados do cliente aplicados. Salve para manter.');
    }
    if (e.target.closest('[data-fill-office]')) {
      const o = off.office; const setv = (n, v) => { const i = val(n); if (i) { i.value = v || ''; tracker.mark(); } };
      setv('contratado_nome', o.contractor_name); setv('contratado_doc', o.contractor_doc); setv('contratado_endereco', o.contractor_address); setv('contratado_registro', o.contractor_registry);
      if (!o.contractor_name) toast('Cadastre os dados do contratado em Configurações › Escritório.', { error: true });
    }
  });
  root.querySelector('[data-more]').onclick = (e) => menu(e.currentTarget, [
    { label: 'Restaurar texto do modelo', icon: 'refresh', fn: async () => { if (await confirmDialog('Substituir o texto deste contrato pelo modelo atual? Emissões já feitas não mudam.', { title: 'Restaurar texto', ok: 'Restaurar' })) { await api.post(`/contract-docs/${id}/reload-template`); reload(); } } },
    c.status !== 'cancelado' ? { label: 'Cancelar contrato', icon: 'x', fn: () => modal({ title: 'Cancelar contrato', body: html`<label class="toggle"><input type="checkbox" id="cr" checked><span class="sw"></span><span>Cancelar também as parcelas em aberto</span></label>`,
      actions: [{ label: 'Voltar' }, { label: 'Cancelar contrato', danger: true, fn: async (m) => { await api.put(`/r/contracts/${id}`, { status: 'cancelado', cancel_receivables: m.querySelector('#cr').checked }); toast('Contrato cancelado.'); reload(); } }] }) } : null,
    '-', { label: 'Excluir contrato', icon: 'trash', danger: true, fn: async () => { try { if (await deleteRow('contracts', c, c.number)) ctx.go('#/contratos'); } catch (err) { fail(err); } } },
  ]);
  api.get(`/contract-docs/${id}/check`).then((r) => { root.querySelector('[data-problems]').innerHTML = toHTML(problemsBox(r.problems)); }).catch(() => {});
}

// Contrato antigo (sem modelo) — mantém o painel anterior
export async function contractDrawer(id, onChange) {
  const c = await api.get(`/r/contracts/${id}`);
  const fin = S.user.finance;
  const inc = fin ? (await list('incomes', { f_contract_id: id, sort: 'due_date', limit: 200 })).rows : [];
  const body = el(html`<div>
    <div class="row between wrap mb-16"><div class="serif" style="font-size:34px">${money(c.amount)}</div>${badge('CONTRACT_STATUS', c.status)}</div>
    <div class="card flat mb-16 row between wrap small"><span>Para gerar o PDF, prepare este contrato com um dos modelos.</span><button class="btn xs primary" data-prep>Preparar documento</button></div>
    <dl class="kv"><dt>Cliente</dt><dd><a href="#/clientes/${c.client_id}">${c.client_name}</a></dd>
      <dt>Projeto</dt><dd>${c.project_id ? html`<a href="#/projetos/${c.project_id}">${c.project_name}</a>` : '—'}</dd>
      ${c.proposal_number ? html`<dt>Proposta</dt><dd><a href="#/propostas/${c.proposal_id}">${c.proposal_number}</a></dd>` : ''}
      <dt>Assinatura</dt><dd>${date(c.signed_at)}</dd><dt>Vigência</dt><dd>${date(c.start_date)} → ${date(c.end_date)}</dd>
      <dt>Pagamento</dt><dd>${c.installments || 1}x · ${label('PAYMENT_METHODS', c.payment_method)} · 1º venc. ${date(c.first_due_date)}</dd>
      ${c.notes ? html`<dt>Observações</dt><dd class="notes">${c.notes}</dd>` : ''}</dl>
    ${fin ? html`<div class="row between mt-24 mb-8"><div class="eyebrow">Parcelas (contas a receber)</div>${!c.receivables_generated ? html`<button class="btn xs primary" data-gen>Gerar parcelas</button>` : ''}</div><div data-inc></div>` : ''}
    <div class="mt-24" data-att></div></div>`);
  if (fin) body.querySelector('[data-inc]').appendChild(table({ rows: inc, cls: 'compact', empty: 'Nenhuma parcela gerada.', onRow: (r) => entryDrawer('incomes', r.id, () => { d.close(); contractDrawer(id, onChange); }), columns: [
    { key: 'installment_no', label: 'Parcela', render: (r) => `${r.installment_no}/${r.installment_total}` }, { key: 'due_date', label: 'Vencimento', render: (r) => date(r.due_date) },
    { key: 'amount', label: 'Valor', align: 'right', render: (r) => money(r.amount) }, { key: 'status', label: 'Status', render: (r) => badge('INCOME_STATUS', r.status) }] }));
  body.querySelector('[data-att]').appendChild(attachments('contracts', c.id, { title: 'Documento do contrato', extraMeta: { category: 'Contratos', client_id: c.client_id, project_id: c.project_id } }));
  const d = drawer({ title: `Contrato ${c.number}`, sub: c.client_name, body, onClose: onChange });
  body.querySelector('[data-prep]').onclick = () => { d.close(); prepareLegacy({ go: (h) => { location.hash = h; } }, c); };
  const g = body.querySelector('[data-gen]'); if (g) g.onclick = async () => { await api.post(`/contracts/${id}/receivables`); toast('Parcelas geradas.'); d.close(); contractDrawer(id, onChange); };
  d.foot.classList.remove('hidden');
  d.foot.innerHTML = toHTML(html`<button class="btn danger" data-del>${icon('trash')}</button><span class="grow"></span>
    ${['elaboracao', 'aguardando_assinatura'].includes(c.status) ? html`<button class="btn" data-sign>${icon('check')} Marcar como assinado</button>` : ''}
    <button class="btn primary" data-edit>${icon('edit')} Editar</button>`);
  d.foot.querySelector('[data-edit]').onclick = () => { d.close(); openForm('contracts', { id, onSaved: onChange }); };
  d.foot.querySelector('[data-del]').onclick = async () => { if (await deleteRow('contracts', c, c.number)) d.close(); };
  const s = d.foot.querySelector('[data-sign]'); if (s) s.onclick = async () => { await api.put(`/r/contracts/${id}`, { status: 'ativo', signed_at: today() }); toast('Contrato ativo. Parcelas liberadas como “a receber”.'); d.close(); contractDrawer(id, onChange); };
}
