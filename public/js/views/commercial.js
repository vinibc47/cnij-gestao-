import { S, api, html, el, toHTML, icon, money, date, badge, label, openForm, drawer, modal, toast, fail, list, attachments, table, pct, today, addDays, deleteRow, duplicateRow, relDay, refOptions, combo, confirmDialog, openPdf, failProblems, datetime, menu, archiveRow, parseNum, round2, brl2, dirtyTracker, $$ } from '../lib.js';
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
      { key: 'title', label: 'Proposta', render: (p) => html`<div class="cell-title">${p.title}</div><div class="cell-sub">${p.client_name || '—'}${p.is_prospect ? ' (interessado)' : ''}${p.services ? ' · ' + (JSON.parse(p.services || '[]').map((x) => svcLabel(x.type)).join(' + ') || svcLabel(p.service_type)) : p.service_type ? ' · ' + svcLabel(p.service_type) : ''}</div>` },
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

// Serviços disponíveis (um ou vários por proposta)
const SVC = () => S.meta.lists.SERVICE_TYPES;
const isProjectSvc = (t) => PROJECT_TYPES.includes(t);

async function newProposal(ctx, initial = {}) {
  const body = el(html`<div class="form-grid">
    <div class="field wide"><div class="btn-group" data-who><button type="button" class="on" data-w="novo">Novo interessado</button><button type="button" data-w="cliente">Cliente cadastrado</button></div>
      <span class="hint">A proposta pode ser feita antes do cadastro. O interessado só vira cliente quando você converter, após o aceite.</span></div>
    <div class="wide form-grid" data-w-box="novo">
      <div class="field wide"><label>Nome do interessado <span class="req">*</span></label><input id="np-pn" placeholder="Nome da pessoa ou empresa"></div>
      <div class="field"><label>Telefone / WhatsApp</label><input id="np-pp" type="tel" inputmode="tel"></div><div class="field"><label>E-mail</label><input id="np-pe" type="email"></div></div>
    <div class="field wide hidden" data-w-box="cliente"><label>Cliente <span class="req">*</span></label><div data-cli></div></div>
    <div class="field wide"><label>Projeto / serviço <span class="req">*</span></label><input id="np-t" data-sentence placeholder="Ex.: Projeto de interiores — escritório corporativo" value="${initial.title || ''}"></div>
    <div class="field wide"><label>Serviços da proposta <span class="req">*</span></label><div class="checks" data-svcs>${SVC().map((o) => html`<label><input type="checkbox" value="${o.value}" ${o.value === 'interiores' ? 'checked' : ''}>${o.label}</label>`)}</div><span class="hint">Selecione um ou mais. Você pode adicionar ou remover serviços depois.</span></div>
    <div class="field"><label>Tipo de obra</label><select id="np-w"><option value="">—</option>${S.meta.lists.WORK_TYPES.map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select></div></div>`);
  const cli = combo({ name: 'client_id', options: refOptions('clients'), value: initial.client_id, allowEmpty: false });
  body.querySelector('[data-cli]').appendChild(cli);
  let who = initial.client_id ? 'cliente' : 'novo';
  const setWho = (w) => { who = w; $$('[data-w]', body).forEach((x) => x.classList.toggle('on', x.dataset.w === w)); $$('[data-w-box]', body).forEach((x) => x.classList.toggle('hidden', x.dataset.wBox !== w)); };
  setWho(who);
  body.querySelector('[data-who]').onclick = (e) => { const b = e.target.closest('[data-w]'); if (b) setWho(b.dataset.w); };
  const m = modal({ title: 'Nova proposta — Orçamento de obra', body, actions: [{ label: 'Cancelar' }, { label: 'Criar rascunho', primary: true, fn: async () => {
    const title = body.querySelector('#np-t').value.trim();
    const services = $$('[data-svcs] input:checked', body).map((i) => ({ type: i.value }));
    const data = { title, services, work_type: body.querySelector('#np-w').value };
    if (who === 'cliente') { data.client_id = cli.combo.get(); if (!data.client_id) { toast('Selecione o cliente.', { error: true }); return false; } }
    else { data.prospect_name = body.querySelector('#np-pn').value.trim(); data.prospect_phone = body.querySelector('#np-pp').value.trim(); data.prospect_email = body.querySelector('#np-pe').value.trim(); if (!data.prospect_name) { toast('Informe o nome do interessado.', { error: true }); return false; } }
    if (!title) { toast('Informe o projeto ou serviço.', { error: true }); return false; }
    if (!services.length) { toast('Selecione ao menos um serviço.', { error: true }); return false; }
    const p = await api.post('/honorarios', data);
    toast(`Proposta ${p.number} criada.`); ctx.go(`#/propostas/orcamento/${p.id}`);
  } }] });
  m.el.style.width = 'min(640px, calc(100vw - 32px))';
}

// Converte o interessado em cliente (conferindo duplicidades) — usado após o aceite
export async function convertClientFlow(p) {
  const r = await api.get(`/honorarios/${p.id}/client-matches`);
  return new Promise((resolve) => {
    const pr = r.prospect;
    modal({ title: 'Converter interessado em cliente', body: html`<p class="small muted" style="margin-top:0">Os dados preenchidos na proposta serão reaproveitados. Nenhum acesso à Área do Cliente é liberado automaticamente.</p>
      <dl class="kv tight mb-16"><dt>Nome</dt><dd>${pr.name || '—'}</dd><dt>CPF/CNPJ</dt><dd>${pr.doc || 'não informado'}</dd><dt>Telefone</dt><dd>${pr.phone || 'não informado'}</dd><dt>E-mail</dt><dd>${pr.email || 'não informado'}</dd></dl>
      ${r.matches.length ? html`<div class="card flat small mb-16"><div class="row gap-8 mb-8 warning-text">${icon('alert', 'sm')}<b>Possível cadastro existente</b></div><div class="list">${r.matches.map((c) => html`<div class="list-item"><div class="grow"><div class="li-title">${c.name}${c.archived ? ' (arquivado)' : ''}</div><div class="li-sub">${c.why.join(', ')} · ${[c.doc, c.whatsapp || c.phone, c.email].filter(Boolean).join(' · ')}</div></div><button class="btn xs primary" data-link="${c.id}">Vincular a este cliente</button></div>`)}</div></div>` : html`<p class="small success-text">Nenhum cadastro parecido encontrado.</p>`}`,
    actions: [{ label: 'Cancelar', value: null }, { label: r.matches.length ? 'Criar novo cadastro mesmo assim' : 'Criar cliente', primary: !r.matches.length, fn: async () => { const x = await api.post(`/honorarios/${p.id}/convert-client`, { force: true }); toast('Cliente cadastrado a partir da proposta.'); resolve(x.client_id); } }],
    onClose: (v) => { if (v === null || v === false) resolve(null); } }).el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-link]'); if (!b) return;
      try { const x = await api.post(`/honorarios/${p.id}/convert-client`, { client_id: +b.dataset.link }); toast('Proposta vinculada ao cliente.'); document.querySelectorAll('.modal').forEach((m) => m.remove()); document.querySelectorAll('.overlay').forEach((o) => o.remove()); resolve(x.client_id); } catch (err) { fail(err); }
    });
  });
}
// Executa uma ação que exige cliente cadastrado, convertendo o interessado antes se necessário
async function withClient(p, action) {
  try { return await action(); } catch (e) {
    if (!(e.data && e.data.need_client)) throw e;
    const cid = await convertClientFlow(p); if (!cid) return null;
    return action();
  }
}

// ------------------------------ EDITOR DA PROPOSTA DE HONORÁRIOS ------------------------------
async function proposalEditor(ctx, id) {
  const root = ctx.root;
  let p; let off;
  try { [p, off] = await Promise.all([api.get(`/honorarios/${id}`), api.get('/office')]); } catch (e) { root.innerHTML = toHTML(html`<div class="empty">${icon('alert')}<div>${e.message}</div></div>`); return; }
  const L = S.meta.lists; const ex = p.extra || {};
  const reload = () => proposalEditor(ctx, id);
  const locked = p.status === 'aprovada';
  const svcNames = (list) => list.map((x) => svcLabel(x.type)).join(' + ') || 'sem serviço';
  root.innerHTML = toHTML(html`
    <div class="hero doc-hero"><div class="crumbs"><a href="#/propostas">Propostas</a> ${icon('chevron', 'sm')} <a href="#/propostas">Orçamento de obra</a> ${icon('chevron', 'sm')} <span>${p.number}</span></div>
      <div class="row between top wrap gap-16"><div style="min-width:0"><h1>Proposta ${p.number}</h1>
        <div class="info-row mt-8"><span>${icon('users', 'sm')}${p.client_id ? html`<a href="#/clientes/${p.client_id}">${p.client_name}</a>` : html`${p.client_name || 'Interessado'} <span class="badge warning plain">interessado</span>`}</span><span>${icon('proposal', 'sm')}${svcNames(p.services)}</span>${badge('PROPOSAL_STATUS', p.status)}${p.archived ? html`<span class="badge muted">Arquivada</span>` : ''}<span class="dirty-flag">alterações não salvas</span></div></div>
        <div class="row wrap"><button class="btn" data-save>${icon('check')} Salvar</button><button class="btn primary" data-pdf>${icon('print')} Gerar PDF</button><button class="icon-btn" data-more title="Mais ações">${icon('more')}</button></div></div>
      <div class="status-bar mt-16" data-status></div></div>
    <div class="doc-grid mt-24">
      <div class="col" style="gap:16px">
        <section class="card"><div class="card-head"><h3>Identificação</h3></div><div class="form-grid" data-sec="id">
          ${fld('number', 'Número da proposta', p.number, { req: true })}${fld('issue_date', 'Data', p.issue_date, { type: 'date', req: true })}
          ${fld('valid_until', 'Validade', p.valid_until, { type: 'date', req: true, hint: `Padrão: ${off.office.validity_days} dias` })}${fld('contact_name', 'Contato (A/C)', p.contact_name, { placeholder: 'Ex.: Sr. Heitor Matos' })}
          <div class="field wide"><label>Para quem é a proposta</label><div class="btn-group" data-who><button type="button" data-w="novo" class="${p.client_id ? '' : 'on'}">Interessado (sem cadastro)</button><button type="button" data-w="cliente" class="${p.client_id ? 'on' : ''}">Cliente cadastrado</button></div></div>
          <div class="wide form-grid ${p.client_id ? 'hidden' : ''}" data-w-box="novo">
            ${fld('prospect_name', 'Nome do interessado', p.prospect_name, { wide: true, req: true })}${fld('prospect_phone', 'Telefone / WhatsApp', p.prospect_phone, { type: 'tel' })}${fld('prospect_email', 'E-mail', p.prospect_email, { type: 'email' })}
            ${fld('prospect_doc', 'CPF / CNPJ (opcional)', p.prospect_doc)}${fld('prospect_city', 'Cidade', p.prospect_city)}${fld('prospect_address', 'Endereço do interessado', p.prospect_address, { wide: true })}
            <p class="wide small muted" style="margin:0">Os dados ficam guardados só nesta proposta. ${p.status === 'aprovada' ? html`<button type="button" class="btn xs primary" data-convert>Converter em cliente</button>` : 'Após o aceite, use “Converter em cliente”.'}</p></div>
          <div class="field wide ${p.client_id ? '' : 'hidden'}" data-w-box="cliente"><label>Cliente <span class="req">*</span></label><div data-client></div></div>
          ${fld('title', 'Projeto / serviço', p.title, { wide: true, req: true, attrs: 'data-sentence' })}
          ${fld('address', 'Endereço do projeto / obra', p.address, { wide: true })}${fld('city', 'Cidade', p.city)}${fld('area', 'Área aproximada (m²)', p.area, { type: 'number' })}
          ${fld('work_type', 'Tipo de obra', p.work_type, { type: 'select', options: L.WORK_TYPES })}<div></div>
          <div class="field wide"><label>Projeto vinculado no sistema</label><div data-project></div><span class="hint">Opcional. Após a aprovação, você pode criar o projeto automaticamente.</span></div>
        </div></section>

        <section class="card"><div class="card-head"><h3>Serviços da proposta</h3><button type="button" class="btn sm" data-add-svc>${icon('plus', 'sm')} Adicionar serviço</button></div>
          <p class="small muted" style="margin-top:0">Adicione um ou vários serviços. Se informar o valor de cada serviço, o valor total da proposta é a soma deles.</p>
          <div data-svcs></div></section>

        <section class="card"><div class="card-head"><h3>Resumo e condições do serviço</h3></div><div class="form-grid">
          ${fld('summary', 'Resumo do projeto ou serviço', p.summary, { type: 'textarea', wide: true, rows: 4, placeholder: 'Ex.: desenvolvimento de projeto de interiores para escritório corporativo com área aproximada de 65 m²…' })}
          ${p.scope ? fld('scope', 'Escopo (registrado antes da atualização do modelo)', p.scope, { type: 'textarea', wide: true, rows: 4, hint: 'Campo mantido apenas nesta proposta antiga. As novas propostas usam a seção “Projetos e entregas”.' }) : ''}
          ${fld('excluded', 'Serviços não incluídos', p.excluded, { type: 'textarea', wide: true, rows: 3, hint: 'Um item por linha.' })}
        </div></section>

        <section class="card" data-type="projeto"><div class="card-head"><h3>Projetos e entregas</h3><span class="small muted" data-svc-hint></span></div>
          <div class="form-grid">${fld('deliverables', 'Produtos a serem entregues', p.deliverables, { type: 'textarea', wide: true, rows: 7, hint: 'Um item por linha. É a referência das entregas no PDF — acompanha os serviços escolhidos, sem repetir itens.' })}</div>
          <div class="field mt-16 mb-16"><label>Etapas e prazos</label><div data-stages></div></div>
          <div class="form-grid">${fld('deadline_text', 'Prazo estimado (texto livre)', p.deadline_text, { wide: true, placeholder: 'Ex.: projeto completo em até 45 dias úteis após o briefing' })}</div></section>

        <section class="card" data-type="acompanhamento"><div class="card-head"><h3>Acompanhamento de obra</h3></div><div class="form-grid" data-extra>
          ${fld('periodicidade', 'Periodicidade', ex.periodicidade, { list: 'dl-period', placeholder: 'Semanal, quinzenal, mensal…' })}${fld('visitas', 'Visitas incluídas', ex.visitas, { type: 'number' })}
          ${fld('periodo_inicio', 'Início do período', ex.periodo_inicio, { type: 'date' })}${fld('periodo_fim', 'Fim do período', ex.periodo_fim, { type: 'date' })}
          ${fld('cobranca', 'Forma de cobrança', ex.cobranca, { list: 'dl-cobranca', placeholder: 'Mensal fixo, por visita…' })}${fld('valor_visita', 'Valor por visita (opcional)', ex.valor_visita, { type: 'money' })}
        </div><div class="form-grid mt-16 hidden" data-deadline-acomp>${fld('deadline_text', 'Prazo estimado', p.deadline_text, { wide: true })}</div></section>

        <section class="card" data-type="visita"><div class="card-head"><h3>Visita técnica avulsa</h3></div><div class="form-grid" data-extra>
          ${fld('visita_local', 'Local', ex.visita_local, { wide: true })}${fld('visita_finalidade', 'Finalidade', ex.visita_finalidade, { type: 'textarea', wide: true, rows: 3 })}
          ${fld('visita_data', 'Data prevista', ex.visita_data, { type: 'date' })}${fld('visita_duracao', 'Duração prevista', ex.visita_duracao, { placeholder: 'Ex.: até 2 horas' })}
        </div></section>

        <section class="card"><div class="card-head"><h3>Investimento e pagamento</h3></div><div class="form-grid">
          ${fld('amount', 'Valor total', p.amount, { type: 'money', req: true, hint: 'Calculado pela soma dos serviços quando eles têm valor.' })}${fld('down_payment', 'Entrada (se houver)', p.down_payment, { type: 'money' })}
          ${fld('payment_method', 'Forma de pagamento', p.payment_method, { type: 'select', options: L.PAYMENT_METHODS })}<div></div>
          ${fld('pix_key', 'Chave Pix', p.pix_key, { hint: off.office.pix_key ? 'Cadastrada em Configurações › Escritório.' : 'Cadastre a chave em Configurações › Escritório para reaproveitar.' })}${fld('pix_name', 'Favorecido', p.pix_name)}
        </div><div class="field mt-16"><label>Entrada, parcelas e vencimentos</label><div data-plan></div></div></section>

        <section class="card"><div class="card-head"><h3>Observações e condições</h3></div><div class="form-grid">
          ${fld('conditions', 'Observações e condições adicionais (aparecem no PDF)', p.conditions, { type: 'textarea', wide: true, rows: 3 })}
          ${fld('notes', 'Observações internas (não aparecem no PDF)', p.notes, { type: 'textarea', wide: true, rows: 2 })}</div></section>

        <section class="card"><div class="card-head"><h3>Texto da proposta</h3><div class="row gap-8">${p.template_outdated ? html`<button class="btn xs" data-tplnew>Usar versão ${p.template.version} do modelo</button>` : ''}<button class="btn xs" data-draft>${icon('eye', 'sm')} Rascunho em PDF</button></div></div>
          <p class="small muted" style="margin-top:0">Texto baseado no modelo “${p.template ? p.template.name : '—'}”${p.template_version ? ` (versão ${p.template_version})` : ''}. Trechos entre <code>[[se …]]</code> e <code>[[fim]]</code> aparecem só quando o serviço correspondente está na proposta. Edite livremente — o modelo não é alterado.</p>
          <div data-body></div></section>
      </div>
      <aside class="col doc-side" style="gap:16px">
        <div class="card"><div class="card-head"><h3>Resumo</h3></div><dl class="kv tight"><dt>Valor total</dt><dd class="serif" style="font-size:24px" data-sum-total>${money(p.amount)}</dd>
          <dt>Serviços</dt><dd data-sum-svc>${svcNames(p.services)}</dd>
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
  const val = (n) => root.querySelector(`[name="${n}"]`);
  let who = p.client_id ? 'cliente' : 'novo';
  const cli = combo({ name: 'client_id', options: refOptions('clients'), value: p.client_id, allowEmpty: false, onChange: () => tracker.mark() });
  root.querySelector('[data-client]').appendChild(cli);
  root.querySelector('[data-who]').onclick = (e) => { const b = e.target.closest('[data-w]'); if (!b) return; who = b.dataset.w; $$('[data-w]', root).forEach((x) => x.classList.toggle('on', x === b)); $$('[data-w-box]', root).forEach((x) => x.classList.toggle('hidden', x.dataset.wBox !== who)); tracker.mark(); };
  const prj = combo({ name: 'project_id', options: refOptions('projects'), value: p.project_id, onChange: () => tracker.mark() });
  root.querySelector('[data-project]').appendChild(prj);
  const { rowsEditor } = await import('../lib.js');
  const stages = rowsEditor({ columns: [{ key: 'etapa', label: 'Etapa', w: '1.4fr', sentence: true }, { key: 'prazo', label: 'Prazo', w: '1fr' }], rows: p.stages, addLabel: 'Adicionar etapa', empty: 'Nenhuma etapa.', onChange: () => tracker.mark() });
  root.querySelector('[data-stages]').appendChild(stages);

  // ---- serviços (adicionar / remover) ----
  let services = p.services.map((x) => ({ ...x }));
  const svcBox = root.querySelector('[data-svcs]');
  const renderSvcs = () => {
    svcBox.innerHTML = toHTML(services.length ? html`<div class="svc-list">${services.map((x, i) => html`<div class="svc-row" data-i="${i}">
      <div class="svc-name"><span class="badge accent plain">${i + 1}</span><b>${svcLabel(x.type)}</b></div>
      <input class="input" data-k="description" placeholder="Descrição (opcional)" value="${x.description || ''}" data-sentence>
      <div class="money-input"><span>R$</span><input class="input" data-k="amount" inputmode="decimal" placeholder="valor (opcional)" value="${x.amount == null || x.amount === '' ? '' : brl2(x.amount)}"></div>
      <button type="button" class="icon-btn" data-rm-svc="${i}" title="Remover serviço">${icon('x', 'sm')}</button></div>`)}</div>
      <div class="small mt-8 ${services.some((x) => x.amount != null && x.amount !== '') ? '' : 'muted'}" data-svc-total></div>` : html`<div class="empty sm">Nenhum serviço. Use “Adicionar serviço”.</div>`);
    svcTotals(); showType(); updateSummary();
  };
  const svcTotals = () => {
    const t = root.querySelector('[data-svc-total]'); if (!t) return;
    const withV = services.filter((x) => x.amount != null && x.amount !== '');
    if (withV.length) { const sum = round2(withV.reduce((a_, x) => a_ + Number(x.amount), 0)); t.textContent = `Soma dos serviços: ${money(sum)}${withV.length < services.length ? ' (há serviço sem valor — some-o manualmente se necessário)' : ''}`; if (withV.length === services.length || !parseNum(val('amount').value)) { val('amount').value = brl2(sum); plan.plan.check(); summary(); } }
    else t.textContent = 'Informe o valor total da proposta em “Investimento”.';
  };
  svcBox.addEventListener('input', (e) => { const r = e.target.closest('[data-i]'); const k = e.target.dataset.k; if (!r || !k) return; services[+r.dataset.i][k] = k === 'amount' ? (e.target.value.trim() === '' ? null : parseNum(e.target.value)) : e.target.value; tracker.mark(); if (k === 'amount') svcTotals(); });
  svcBox.addEventListener('change', (e) => { if (e.target.dataset.k === 'amount' && e.target.value.trim() !== '') e.target.value = brl2(parseNum(e.target.value)); });
  // entregas, etapas e não incluídos acompanham os serviços, sem repetir itens
  const linesOf = (name) => String(val(name).value || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const same = (a_, b_) => a_.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() === b_.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const syncDefaults = (type, add) => {
    const def = off.defaults[type] || {}; const others = services.filter((x) => x.type !== type).flatMap((x) => [x.type]);
    const keepByOthers = (item, key) => others.some((t) => ((off.defaults[t] || {})[key] || []).some((y) => same(typeof y === 'string' ? y : y.etapa, item)));
    for (const key of ['deliverables', 'excluded']) {
      let cur = linesOf(key);
      if (add) (def[key] || []).forEach((it) => { if (!cur.some((c) => same(c, it))) cur.push(it); });
      else cur = cur.filter((c) => !(def[key] || []).some((it) => same(it, c)) || keepByOthers(c, key));
      if (key === 'excluded' && services.some((x) => x.type === 'acompanhamento')) cur = cur.filter((c) => !/^acompanhamento de obra/i.test(c));
      val(key).value = cur.join('\n');
    }
    let st = stages.rows.get();
    if (add) (def.stages || []).forEach((it) => { if (!st.some((c) => same(c.etapa || '', it.etapa))) st.push({ ...it }); });
    else st = st.filter((c) => !(def.stages || []).some((it) => same(it.etapa, c.etapa || '') && it.prazo === c.prazo) || keepByOthers(c.etapa || '', 'stages'));
    stages.rows.set(st);
  };
  root.querySelector('[data-add-svc]').onclick = (e) => {
    const avail = SVC().filter((o) => !services.some((x) => x.type === o.value));
    if (!avail.length) return toast('Todos os serviços já foram adicionados.');
    menu(e.currentTarget, [{ header: 'Adicionar serviço' }, ...avail.map((o) => ({ label: o.label, fn: () => { services.push({ type: o.value, description: '', amount: null }); syncDefaults(o.value, true); renderSvcs(); tracker.mark(); } }))]);
  };
  svcBox.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rm-svc]'); if (!b) return;
    const x = services[+b.dataset.rmSvc];
    if (services.length === 1) return toast('A proposta precisa de ao menos um serviço.', { error: true });
    if (!(await confirmDialog(`Remover “${svcLabel(x.type)}” da proposta? As entregas e etapas sugeridas para ele (e não usadas por outro serviço) também serão retiradas.`, { title: 'Remover serviço', ok: 'Remover' }))) return;
    services.splice(+b.dataset.rmSvc, 1); syncDefaults(x.type, false); renderSvcs(); tracker.mark();
  });

  const plan = planEditor({ plan: p.payment_plan, getTotal: () => parseNum(val('amount').value), getDown: () => parseNum(val('down_payment').value), onChange: () => { tracker.mark(); summary(); } });
  root.querySelector('[data-plan]').appendChild(plan);
  const bodyEd = bodyEditor({ value: p.body, fields: off.fields, blocks: off.blocks, onChange: () => tracker.mark() });
  root.querySelector('[data-body]').appendChild(bodyEd);
  root.querySelector('[data-att]').appendChild(el(html`<div class="card"></div>`)).appendChild(attachments('proposals', p.id, { title: 'Arquivos da proposta', extraMeta: { category: 'Propostas', client_id: p.client_id } }));
  const summary = () => { root.querySelector('[data-sum-total]').textContent = money(parseNum(val('amount').value)); root.querySelector('[data-sum-n]').textContent = plan.plan.get().length || '—'; };
  const updateSummary = () => { const e_ = root.querySelector('[data-sum-svc]'); if (e_) e_.textContent = svcNames(services); };
  root.addEventListener('input', (e) => { if (e.target.name === 'amount' || e.target.name === 'down_payment') { summary(); plan.plan.check(); } });
  // seções por serviço
  function showType() {
    const types = services.map((x) => x.type);
    $$('[data-type]', root).forEach((s_) => s_.classList.toggle('hidden', !(s_.dataset.type === 'projeto' ? types.some(isProjectSvc) : types.includes(s_.dataset.type))));
    const acompOnly = types.includes('acompanhamento') && !types.some(isProjectSvc);
    const da = root.querySelector('[data-deadline-acomp]'); if (da) { da.classList.toggle('hidden', !acompOnly); da.querySelector('input').disabled = !acompOnly; }
    const pd = root.querySelector('[data-type="projeto"] [name="deadline_text"]'); if (pd) pd.disabled = !types.some(isProjectSvc);
    const h = root.querySelector('[data-svc-hint]'); if (h) h.textContent = types.filter(isProjectSvc).map((t) => svcLabel(t)).join(' + ');
  }
  renderSvcs();
  root.addEventListener('input', (e) => { if (e.target.name === 'deadline_text') $$('[name="deadline_text"]', root).forEach((i) => { if (i !== e.target) i.value = e.target.value; }); });

  const gather = () => {
    const v = readFields(root.querySelector('.doc-grid'));
    const extra = {}; ['periodicidade', 'visitas', 'periodo_inicio', 'periodo_fim', 'cobranca', 'valor_visita', 'visita_local', 'visita_finalidade', 'visita_data', 'visita_duracao'].forEach((k) => { extra[k] = v[k] ?? ''; delete v[k]; });
    $$('[data-svcs] input[data-sentence]', root).forEach((i, idx) => { if (services[idx]) services[idx].description = i.value; });
    const out = { ...v, client_id: who === 'cliente' ? cli.combo.get() || null : null, project_id: prj.combo.get() || null, extra, services, stages: stages.rows.get(), payment_plan: plan.plan.get(), body: bodyEd.body.get() };
    if (who === 'cliente') ['prospect_name', 'prospect_phone', 'prospect_email', 'prospect_doc', 'prospect_city', 'prospect_address'].forEach((k) => delete out[k]);
    return out;
  };
  const save = async ({ quiet } = {}) => {
    const data = gather();
    if (who === 'cliente' && !data.client_id) { toast('Selecione o cliente.', { error: true }); return false; }
    if (who === 'novo' && !String(data.prospect_name || '').trim()) { toast('Informe o nome do interessado.', { error: true }); return false; }
    if (!String(data.title || '').trim()) { toast('Informe o projeto ou serviço.', { error: true }); return false; }
    if (!services.length) { toast('Adicione ao menos um serviço.', { error: true }); return false; }
    const b = root.querySelector('[data-save]'); b.disabled = true;
    try { await api.put(`/honorarios/${id}`, data); tracker.clean(); if (!quiet) toast('Proposta salva.'); reload(); return true; } catch (e) { fail(e); b.disabled = false; return false; }
  };
  root.querySelector('[data-save]').onclick = () => save();
  const pdfUrl = `/pdf/proposal/${id}`;
  root.querySelector('[data-pdf]').onclick = () => openPdf(pdfUrl, { dirty: tracker.dirty, save: () => save({ quiet: true }), draftUrl: `${pdfUrl}?draft=1` });
  root.querySelector('[data-draft]').onclick = () => openPdf(`${pdfUrl}?draft=1`, { dirty: tracker.dirty, save: () => save({ quiet: true }) });
  const tn = root.querySelector('[data-tplnew]'); if (tn) tn.onclick = async () => { if (await confirmDialog('Substituir o texto desta proposta pela versão mais recente do modelo? As edições feitas no texto desta proposta serão perdidas.', { title: 'Atualizar texto', ok: 'Atualizar' })) { await api.post(`/honorarios/${id}/reload-template`); toast('Texto atualizado.'); reload(); } };
  const cv = root.querySelector('[data-convert]'); if (cv) cv.onclick = async () => { if (tracker.dirty && !(await save({ quiet: true }))) return; if (await convertClientFlow(p)) reload(); };
  root.querySelector('[data-more]').onclick = (e) => menu(e.currentTarget, [
    { label: 'Visualizar rascunho em PDF', icon: 'eye', fn: () => openPdf(`${pdfUrl}?draft=1`, { dirty: tracker.dirty, save: () => save({ quiet: true }) }) },
    { label: 'Baixar PDF', icon: 'download', fn: () => openPdf(`${pdfUrl}?download=1`, { dirty: tracker.dirty, save: () => save({ quiet: true }), draftUrl: `${pdfUrl}?draft=1` }) },
    { label: 'Duplicar proposta', icon: 'copy', fn: async () => { const d = await api.post(`/honorarios/${id}/duplicate`); toast(`Proposta duplicada como ${d.number}.`); ctx.go(`#/propostas/orcamento/${d.id}`); } },
    !p.client_id ? { label: 'Converter interessado em cliente', icon: 'users', fn: async () => { if (await convertClientFlow(p)) reload(); } } : null,
    { label: 'Restaurar texto do modelo', icon: 'refresh', fn: async () => { if (await confirmDialog('Substituir o texto desta proposta pelo modelo atual?', { title: 'Restaurar texto', ok: 'Restaurar' })) { await api.post(`/honorarios/${id}/reload-template`); reload(); } } },
    { label: p.archived ? 'Restaurar do arquivo' : 'Arquivar', icon: p.archived ? 'refresh' : 'archive', fn: async () => { await archiveRow('proposals', p, p.archived ? 0 : 1); reload(); } },
    '-', { label: 'Excluir definitivamente', icon: 'trash', danger: true, fn: async () => { try { if (await deleteRow('proposals', p, p.number)) ctx.go('#/propostas'); } catch (err) { fail(err); } } },
  ]);

  // barra de status e próximos passos
  const bar = root.querySelector('[data-status]');
  const st = p.status;
  bar.innerHTML = toHTML(html`<div class="steps">${['elaboracao', 'enviada', 'aprovada'].map((s_, i) => html`<span class="step ${s_ === st || (st === 'aprovada' && i < 2) || (st === 'enviada' && i < 1) ? 'on' : ''}">${label('PROPOSAL_STATUS', s_)}</span>`)}${['recusada', 'expirada'].includes(st) ? html`<span class="step bad on">${label('PROPOSAL_STATUS', st)}</span>` : ''}</div>
    <div class="row wrap gap-8">
      ${st === 'elaboracao' ? html`<button class="btn sm" data-st="enviada">${icon('mail', 'sm')} Marcar como enviada</button>` : ''}
      ${['enviada', 'elaboracao', 'expirada'].includes(st) ? html`<button class="btn sm primary" data-approve>${icon('check', 'sm')} Registrar aprovação</button>` : ''}
      ${st === 'enviada' ? html`<button class="btn sm" data-refuse>Recusada</button><button class="btn sm" data-st="expirada">Expirada</button>` : ''}
      ${st === 'aprovada' && !p.client_id ? html`<button class="btn sm primary" data-convert2>${icon('users', 'sm')} Converter interessado em cliente</button>` : ''}
      ${st === 'aprovada' ? html`<button class="btn sm ${p.client_id ? 'primary' : ''}" data-contract>${icon('contract', 'sm')} Gerar contrato a partir da proposta</button>${S.user.finance ? html`<button class="btn sm" data-recv>${icon('in', 'sm')} Cadastrar parcelas no financeiro</button>` : ''}${!p.project_id ? html`<button class="btn sm" data-proj>${icon('folder', 'sm')} Criar projeto</button>` : ''}` : ''}
      ${st !== 'elaboracao' ? html`<button class="btn sm ghost" data-st="elaboracao">Voltar para rascunho</button>` : ''}</div>`);
  const setStatus = async (status, extra = {}) => { if (tracker.dirty && !(await save({ quiet: true }))) return; try { await api.post(`/honorarios/${id}/status`, { status, ...extra }); toast(`Status: ${label('PROPOSAL_STATUS', status)}.`); reload(); } catch (e) { fail(e); } };
  bar.onclick = async (e) => {
    const b = e.target.closest('[data-st]'); if (b) return setStatus(b.dataset.st);
    try {
      if (e.target.closest('[data-refuse]')) return modal({ title: 'Proposta recusada', body: html`<div class="field"><label>Motivo da recusa (opcional)</label><input id="rr" data-sentence></div>`, actions: [{ label: 'Cancelar' }, { label: 'Registrar recusa', danger: true, fn: (m) => setStatus('recusada', { refusal_reason: m.querySelector('#rr').value }) }] });
      if (e.target.closest('[data-approve]')) return approveModal(p, async (data) => { if (tracker.dirty && !(await save({ quiet: true }))) return false; await api.post(`/honorarios/${id}/status`, { status: 'aprovada', ...data }); toast('Aprovação registrada.'); afterApproval(ctx, id); });
      if (e.target.closest('[data-convert2]')) { if (await convertClientFlow(p)) reload(); return; }
      if (e.target.closest('[data-contract]')) return contractFromProposal(ctx, p);
      if (e.target.closest('[data-recv]')) return withClient(p, () => receivablesModal('proposal', id, reload, true));
      if (e.target.closest('[data-proj]')) { const r = await withClient(p, () => api.post(`/honorarios/${id}/project`)); if (r) { toast('Projeto criado a partir da proposta.'); ctx.go(`#/projetos/${r.project_id}`); } }
    } catch (err) { fail(err); }
  };
  if (locked) root.querySelector('.doc-hero').appendChild(el(html`<div class="small muted mt-8">Proposta aprovada. Alterações continuam possíveis, mas o que já foi aprovado pelo cliente deve ser preservado.</div>`));
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
  let p = await api.get(`/honorarios/${id}`);
  if (!p.client_id) {
    const cid = await convertClientFlow(p);
    if (!cid) { toast('Proposta aprovada. Converta o interessado em cliente quando quiser gerar contrato, projeto ou parcelas.'); return proposalEditor(ctx, id); }
    p = await api.get(`/honorarios/${id}`);
  }
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
  try { const r = await withClient(p, () => api.post(`/honorarios/${p.id}/contract`)); if (!r) return; toast('Contrato criado a partir da proposta.'); ctx.go(`#/contratos/editor/${r.id}`); }
  catch (e) {
    if (e.status !== 409) return fail(e);
    const cid = e.data && e.data.contract_id;
    modal({ title: 'Contrato já existe', body: html`<p class="muted" style="margin:0">${e.message} Deseja abrir o contrato existente ou criar um novo?</p>`,
      actions: [{ label: 'Criar outro', fn: async () => { const r = await api.post(`/honorarios/${p.id}/contract`, { force: true }); ctx.go(`#/contratos/editor/${r.id}`); } }, { label: 'Abrir existente', primary: true, fn: () => ctx.go(`#/contratos/editor/${cid}`) }] });
  }
}

// Cadastrar parcelas no financeiro com conferência de duplicidade
export async function receivablesModal(source, id, onDone, rethrow) {
  let prev;
  try { prev = await api.post('/plan-receivables', { source, id }); } catch (e) { if (rethrow && e.data && e.data.need_client) throw e; return fail(e); }
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
    <div class="field"><label>Modelo de contrato</label><select id="pl-s">${S.meta.lists.SERVICE_TYPES_ALL.map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select></div>`,
  actions: [{ label: 'Cancelar' }, { label: 'Aplicar modelo', primary: true, fn: async (m) => { await api.post(`/contract-docs/${c.id}/reload-template`, { service_type: m.querySelector('#pl-s').value }); ctx.go(`#/contratos/editor/${c.id}`); } }] });
}
async function newContract(ctx) {
  const props = (await list('proposals', { preset: 'honorarios', limit: 500 })).rows.filter((p) => ['aprovada', 'enviada'].includes(p.status));
  const body = el(html`<div>
    <div class="btn-group mb-16" data-mode><button class="on" data-m="prop">A partir de uma proposta</button><button data-m="tpl">A partir de um modelo</button></div>
    <div data-p="prop"><div class="field"><label>Proposta (aprovadas e enviadas)</label>${props.length ? html`<select id="nc-p">${props.map((p) => html`<option value="${p.id}">${p.number} — ${p.client_name} — ${p.title} (${label('PROPOSAL_STATUS', p.status)})</option>`)}</select>` : html`<div class="small muted">Nenhuma proposta aprovada ou enviada no Orçamento de obra.</div>`}</div>
      <p class="small muted">Reaproveita cliente, escritório, projeto, endereço, serviço, escopo, prazos, valores, parcelas, forma de pagamento e Pix.</p></div>
    <div data-p="tpl" class="hidden"><div class="form-grid"><div class="field wide"><label>Cliente</label><div data-cli></div></div>
      <div class="field"><label>Modelo de contrato</label><select id="nc-s">${S.meta.lists.SERVICE_TYPES_ALL.map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select></div>
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
          <div class="field"><label>Tipo de serviço / modelo</label><select name="service_type">${L.SERVICE_TYPES_ALL.map((o) => html`<option value="${o.value}" ${o.value === c.service_type ? 'selected' : ''}>${o.label}</option>`)}</select></div>
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
