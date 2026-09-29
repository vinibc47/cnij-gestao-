import { S, api, html, el, toHTML, icon, date, datetime, bytes, modal, toast, fail, table, avatar, label, refOptions, confirmDialog, isAdmin, badge, dirtyTracker, $$ } from '../lib.js';

const SECS = [['escritorio', 'Escritório'], ['modelos', 'Modelos de documentos'], ['cobranca', 'Cobrança (WhatsApp)'], ['usuarios', 'Usuários e permissões'], ['listas', 'Categorias e listas'], ['etapas', 'Modelos de etapas'], ['alertas', 'Alertas e automações'], ['backup', 'Backup e dados'], ['auditoria', 'Registro de alterações']];
const ROLE_DESC = { admin: 'Acesso completo ao sistema.', gestor: 'Projetos, obras, clientes, tarefas, comercial. Financeiro somente se autorizado.', colaborador: 'Projetos e obras em que participa e tarefas atribuídas.', estagiario: 'Somente projetos autorizados e suas tarefas.', cliente: 'Área do Cliente.' };

export default async function (ctx) {
  const sec = ctx.params[0] || 'escritorio';
  ctx.root.innerHTML = toHTML(html`<div class="page-head"><div><h1>Configurações</h1><div class="sub">Parâmetros do escritório, equipe, permissões, listas e segurança</div></div></div>
    <div class="tabs">${SECS.map(([k, l]) => html`<a href="#/configuracoes/${k}" class="${k === sec ? 'on' : ''}">${l}</a>`)}</div><div data-body></div>`);
  const body = ctx.root.querySelector('[data-body]');
  await (T[sec] || T.escritorio)(body, ctx);
}

const settingsForm = async (body, keys, ctx) => {
  const s = await api.get('/admin/settings');
  const form = el(html`<form class="card"><div class="form-grid">${keys.map(([k, l, type = 'text', hint]) => html`<div class="field ${type === 'wide' ? 'wide' : ''}"><label>${l}</label><input name="${k}" type="${type === 'wide' ? 'text' : type}" value="${s[k] || ''}" ${type === 'number' ? 'step="any"' : ''}>${hint ? html`<span class="hint">${hint}</span>` : ''}</div>`)}</div>
    <div class="form-actions mt-16"><button class="btn primary">Salvar</button></div></form>`);
  form.onsubmit = async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(form)); try { await api.put('/admin/settings', data); toast('Configurações salvas.'); } catch (err) { fail(err); } };
  body.appendChild(form);
};

const T = {
  async escritorio(body, ctx) {
    const s = await api.get('/admin/settings');
    const f = (k, l, { type = 'text', wide, hint, ph = '' } = {}) => html`<div class="field ${wide ? 'wide' : ''}"><label>${l}</label><input name="${k}" type="${type}" value="${s[k] || ''}" placeholder="${ph}" ${type === 'number' ? html`step="any"` : ''}>${hint ? html`<span class="hint">${hint}</span>` : ''}</div>`;
    const form = el(html`<form class="col" style="gap:16px">
      <p class="small muted" style="margin:0">Estes dados são cadastrados uma única vez e reaproveitados nas propostas, contratos, PDFs e lembretes de cobrança.</p>
      <div class="grid g2">
        <div class="card"><div class="card-head"><h3>Dados do escritório</h3></div><div class="form-grid">
          ${f('office_name', 'Nome do escritório', { wide: true })}${f('office_tagline', 'Assinatura', { wide: true })}
          ${f('office_doc', 'CNPJ')}${f('office_email', 'E-mail')}${f('office_phone', 'Telefones', { wide: true })}${f('office_address', 'Endereço', { wide: true })}
          ${f('office_city', 'Cidade para documentos', { ph: 'Campo Grande – MS', hint: 'Usada em “local e data” dos contratos.' })}
          <div class="field"><label>Fuso horário do escritório</label><select name="office_timezone">${s._timezones.map((z) => html`<option ${z === (s.office_timezone || 'America/Campo_Grande') ? 'selected' : ''}>${z}</option>`)}</select><span class="hint">Define “hoje” para vencimentos, lembretes e datas dos PDFs.</span></div>
        </div></div>
        <div class="col" style="gap:16px">
          <div class="card"><div class="card-head"><h3>Logo</h3></div>
            <div class="logo-prev"><img src="/logo?v=${Date.now()}" alt="Logo atual"></div>
            <div class="row wrap gap-8 mt-16"><label class="btn sm">${icon('upload', 'sm')} Enviar nova logo<input type="file" accept="image/png,image/jpeg" class="hidden" data-logo></label>${s.office_logo ? html`<button type="button" class="btn sm ghost" data-logo-reset>Voltar para a logo original</button>` : ''}</div>
            <p class="small muted mt-8" style="margin-bottom:0">PNG com fundo transparente (ou JPG). A mesma logo aparece no menu, na tela de acesso e no canto superior direito dos PDFs, mantendo as proporções.</p></div>
          <div class="card"><div class="card-head"><h3>Pix para pagamentos</h3></div><div class="form-grid">
            ${f('office_pix_key', 'Chave Pix', { wide: true, hint: 'Usada nas propostas, contratos e lembretes. Não é preenchida automaticamente.' })}
            <div class="field"><label>Tipo da chave</label><select name="office_pix_type">${['', 'CPF', 'CNPJ', 'E-mail', 'Telefone', 'Chave aleatória'].map((t) => html`<option value="${t}" ${t === (s.office_pix_type || '') ? 'selected' : ''}>${t || '—'}</option>`)}</select></div>
            ${f('office_pix_bank', 'Banco (opcional)')}${f('office_pix_name', 'Nome do favorecido', { wide: true })}</div></div>
        </div>
        <div class="card"><div class="card-head"><h3>Contratado (para os contratos)</h3></div><div class="form-grid">
          ${f('contractor_name', 'Nome do contratado', { wide: true, ph: 'Nome completo ou razão social' })}${f('contractor_doc', 'CPF / CNPJ')}${f('contractor_registry', 'Registro profissional', { ph: 'Arquiteto – CAU BR …' })}
          ${f('contractor_address', 'Endereço completo', { wide: true })}${f('sign_display_name', 'Nome exibido na placa de obra', { ph: 'Ex.: Irineu Junior', hint: 'Se ficar vazio, a placa usa o primeiro e o último nome do contratado. O cadastro mantém o nome completo.' })}</div></div>
        <div class="card"><div class="card-head"><h3>Propostas e caixa</h3></div><div class="form-grid">
          ${f('proposal_validity_days', 'Validade padrão da proposta (dias)', { type: 'number' })}<div></div>
          ${f('opening_balance', 'Saldo inicial do caixa (R$)', { type: 'number', hint: 'Saldo em conta na data ao lado. O saldo atual = saldo inicial + recebimentos − pagamentos a partir desta data.' })}${f('opening_balance_date', 'Data do saldo inicial', { type: 'date' })}</div></div>
      </div>
      <div class="form-actions"><button class="btn primary">Salvar dados do escritório</button></div></form>`);
    form.onsubmit = async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(form)); delete data.file; try { await api.put('/admin/settings', data); toast('Dados do escritório salvos.'); } catch (err) { fail(err); } };
    form.querySelector('[data-logo]').onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const fd = new FormData(); fd.append('file', file);
      try { await api('/office/logo', { method: 'POST', body: fd }); toast('Logo atualizada.'); document.querySelectorAll('.brand-logo, .auth-logo').forEach((i) => { i.src = '/logo?v=' + Date.now(); }); body.innerHTML = ''; T.escritorio(body, ctx); } catch (err) { fail(err); }
    };
    const lr = form.querySelector('[data-logo-reset]'); if (lr) lr.onclick = async () => { await api.del('/office/logo'); toast('Logo original restaurada.'); document.querySelectorAll('.brand-logo').forEach((i) => { i.src = '/logo?v=' + Date.now(); }); body.innerHTML = ''; T.escritorio(body, ctx); };
    body.appendChild(form);
  },
  async modelos(body) {
    const { rows, fields, blocks } = await api.get('/doc-templates');
    const group = (kind, title, hint) => html`<div class="card"><div class="card-head"><h3>${title}</h3></div><p class="small muted" style="margin-top:0">${hint}</p><div class="list tpl-list">${rows.filter((t) => t.kind === kind).map((t) => html`<div class="list-item" data-t="${t.id}"><div class="grow" style="min-width:0"><div class="li-title">${t.service_label}</div><div class="li-sub">versão ${t.version}${t.updated_at ? ' · ' + datetime(t.updated_at) : ''}${t.source ? ' · ' + t.source : ''}</div></div>${t.status === 'pendente' ? html`<span class="badge danger plain">texto pendente</span>` : html`<span class="badge success plain">configurado</span>`}${icon('chevron', 'sm')}</div>`)}</div></div>`;
    const box = el(html`<div><div class="grid g2">${group('proposta', 'Propostas de honorários', 'Texto inicial de cada nova proposta. Cada proposta guarda a sua cópia, que pode ser editada antes do PDF.')}${group('contrato', 'Contratos', 'Texto inicial de cada contrato. Alterar um modelo não modifica contratos existentes nem emissões já feitas.')}</div>
      <p class="small muted mt-16">Modelos marcados como <b>texto pendente</b> contêm trechos <code>[PENDENTE: …]</code> que precisam dos seus modelos oficiais. Enquanto houver pendências, o contrato não é emitido — nenhuma cláusula foi inventada.</p></div>`);
    box.onclick = (e) => { const it = e.target.closest('[data-t]'); if (it) templateEditor(+it.dataset.t, fields, blocks, () => { body.innerHTML = ''; T.modelos(body); }); };
    body.appendChild(box);
  },
  async cobranca(body) {
    const s = await api.get('/admin/settings');
    const form = el(html`<form class="col" style="gap:16px">
      <p class="small muted" style="margin:0">No dia do vencimento de cada parcela em aberto, o sistema prepara a mensagem em Financeiro › Lembretes de cobrança. Nada é enviado automaticamente: você revisa, abre o WhatsApp e marca como enviado.</p>
      <div class="card flat small">Use os marcadores: <code>[nome do cliente]</code> <code>[data]</code> <code>[número/total]</code> <code>[projeto/serviço]</code> <code>[valor]</code> <code>[chave Pix]</code> <code>[nome do favorecido]</code>. Linhas com marcador sem dado cadastrado (ex.: favorecido) são omitidas.</div>
      ${!s.office_pix_key ? html`<div class="card flat small warning-text">${icon('alert', 'sm')} A chave Pix ainda não foi cadastrada em Configurações › Escritório.</div>` : ''}
      <div class="grid g2">
        <div class="card"><div class="card-head"><h3>Mensagem no dia do vencimento</h3><button type="button" class="btn xs" data-def="whatsapp_template">Restaurar texto inicial</button></div><div class="field"><textarea name="whatsapp_template" rows="16" data-raw>${s.whatsapp_template || s._wa_defaults.today}</textarea></div></div>
        <div class="card"><div class="card-head"><h3>Mensagem para parcela vencida</h3><button type="button" class="btn xs" data-def="whatsapp_template_overdue">Restaurar texto inicial</button></div><div class="field"><textarea name="whatsapp_template_overdue" rows="16" data-raw>${s.whatsapp_template_overdue || s._wa_defaults.overdue}</textarea></div><span class="hint">Usada quando o lembrete fica para depois do vencimento: informa a data em que venceu, sem dizer “vence hoje”.</span></div>
      </div><div class="form-actions"><button class="btn primary">Salvar mensagens</button></div></form>`);
    form.onclick = (e) => { const b = e.target.closest('[data-def]'); if (b) form.querySelector(`[name="${b.dataset.def}"]`).value = b.dataset.def === 'whatsapp_template' ? s._wa_defaults.today : s._wa_defaults.overdue; };
    form.onsubmit = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(form)); if (d.whatsapp_template === s._wa_defaults.today) d.whatsapp_template = ''; if (d.whatsapp_template_overdue === s._wa_defaults.overdue) d.whatsapp_template_overdue = ''; try { await api.put('/admin/settings', d); toast('Mensagens salvas.'); } catch (err) { fail(err); } };
    body.appendChild(form);
  },
  async usuarios(body, ctx) {
    const users = await api.get('/admin/users');
    const box = el(html`<div><div class="row between mb-16"><div class="small muted">${Object.entries(ROLE_DESC).filter(([k]) => k !== 'cliente').map(([k, v]) => html`<div><b>${label('ROLES', k)}:</b> ${v}</div>`)}</div><button class="btn primary" data-new>${icon('plus')} Novo usuário</button></div></div>`);
    box.appendChild(table({ rows: users, onRow: (u) => userModal(u, ctx), columns: [
      { key: 'name', label: 'Usuário', render: (u) => html`<div class="row gap-8">${avatar(u, 'sm')}<div><div class="cell-title">${u.name}</div><div class="cell-sub">${u.email}</div></div></div>` },
      { key: 'role', label: 'Nível', render: (u) => html`${label('ROLES', u.role)}${u.role === 'gestor' && u.can_finance ? html`<div class="cell-sub">com financeiro</div>` : ''}${u.role === 'cliente' ? html`<div class="cell-sub">${u.client_name || ''}</div>` : ''}` },
      { key: 'job_title', label: 'Cargo' }, { key: 'projects_count', label: 'Projetos', align: 'right' },
      { key: 'last_login', label: 'Último acesso', render: (u) => (u.last_login ? datetime(u.last_login) : 'nunca') },
      { key: 'active', label: 'Status', render: (u) => (u.active ? html`<span class="badge success">Ativo</span>` : html`<span class="badge muted">Inativo</span>`) }] }));
    box.querySelector('[data-new]').onclick = () => userModal(null, ctx);
    body.appendChild(box);
  },
  async listas(body, ctx) {
    const opts = await api.get('/admin/options');
    const kinds = [['despesa', 'Categorias de despesa'], ['receita', 'Categorias de receita'], ['projeto_tipo', 'Tipos de projeto'], ['fornecedor', 'Categorias de fornecedor / itens de orçamento'], ['documento', 'Categorias de documento'], ['origem_cliente', 'Origem do cliente']];
    const box = el(html`<div class="grid g3">${kinds.map(([k, l]) => html`<div class="card"><div class="card-head"><h3>${l}</h3></div>
      <div class="list">${opts.filter((o) => o.kind === k).map((o) => html`<div class="list-item" style="padding:7px 0"><span class="grow ${o.archived ? 'muted-2' : ''}" style="${o.archived ? 'text-decoration:line-through' : ''}">${o.name}</span>
        <button class="icon-btn" data-ren="${o.id}" title="Renomear">${icon('edit', 'sm')}</button><button class="icon-btn" data-arc="${o.id}" data-v="${o.archived ? 0 : 1}" title="${o.archived ? 'Reativar' : 'Desativar'}">${icon(o.archived ? 'refresh' : 'archive', 'sm')}</button></div>`)}</div>
      <form class="row mt-8" data-kind="${k}"><input class="input" name="n" placeholder="Nova opção…"><button class="btn sm">Adicionar</button></form></div>`)}</div>`);
    const refresh = async () => { S.meta = await api.get('/meta'); body.innerHTML = ''; T.listas(body, ctx); };
    box.addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; const n = f.n.value.trim(); if (!n) return; try { await api.post('/admin/options', { kind: f.dataset.kind, name: n }); refresh(); } catch (err) { fail(err); } });
    box.onclick = async (e) => {
      const r = e.target.closest('[data-ren]'); const a = e.target.closest('[data-arc]');
      if (r) { const o = opts.find((x) => x.id == r.dataset.ren); const n = prompt('Novo nome (os registros existentes também serão atualizados):', o.name); if (n && n.trim() && n !== o.name) { await api.put(`/admin/options/${o.id}`, { name: n.trim() }); refresh(); } }
      if (a) { await api.put(`/admin/options/${a.dataset.arc}`, { archived: +a.dataset.v }); refresh(); }
    };
    body.appendChild(box);
  },
  async etapas(body) {
    const tpl = await api.get('/admin/phase-templates');
    const box = el(html`<div class="grid g2">${[['projeto', 'Etapas padrão de projeto', 'Criadas automaticamente em cada novo projeto. Prazo em dias corridos a partir do início (opcional).'], ['obra', 'Fases padrão de obra', 'Criadas automaticamente em cada nova obra.']].map(([k, t, h]) => html`<div class="card" data-k="${k}"><div class="card-head"><h3>${t}</h3></div><p class="small muted" style="margin-top:0">${h}</p>
      <div data-items>${tpl.filter((x) => x.kind === k).map((x) => row(x))}</div><div class="row mt-16"><button class="btn sm" data-add>${icon('plus', 'sm')} Adicionar</button><span class="grow"></span><button class="btn sm primary" data-save>Salvar</button></div></div>`)}</div>`);
    function row(x = {}) { return html`<div class="row gap-8 mb-8" data-row><span class="muted small" style="width:18px">⋮</span><input class="input" data-n value="${x.name || ''}" placeholder="Nome da etapa">${''}<input class="input" data-d type="number" min="0" value="${x.default_days || ''}" placeholder="dias" style="width:90px"><button class="icon-btn" data-up>${icon('out', 'sm')}</button><button class="icon-btn" data-rm>${icon('x', 'sm')}</button></div>`; }
    box.onclick = async (e) => {
      const card = e.target.closest('[data-k]'); if (!card) return;
      if (e.target.closest('[data-add]')) card.querySelector('[data-items]').appendChild(el(toHTML(row())));
      if (e.target.closest('[data-rm]')) e.target.closest('[data-row]').remove();
      if (e.target.closest('[data-up]')) { const r = e.target.closest('[data-row]'); if (r.previousElementSibling) r.parentNode.insertBefore(r, r.previousElementSibling); }
      if (e.target.closest('[data-save]')) {
        const items = $$('[data-row]', card).map((r) => ({ name: r.querySelector('[data-n]').value, default_days: r.querySelector('[data-d]').value }));
        try { await api.put(`/admin/phase-templates/${card.dataset.k}`, { items }); toast('Modelo salvo. Vale para os próximos projetos/obras.'); } catch (err) { fail(err); }
      }
    };
    body.appendChild(box);
  },
  async alertas(body, ctx) {
    body.appendChild(el(html`<p class="muted small">As automações rodam continuamente: parcelas vencidas mudam para “Vencida”, despesas recorrentes geram os próximos vencimentos, propostas expiram, e notificações são enviadas aos responsáveis.</p>`));
    await settingsForm(body, [['alert_days_payments', 'Avisar pagamentos/recebimentos com antecedência de (dias)', 'number'], ['alert_days_tasks', 'Avisar tarefas com antecedência de (dias)', 'number'],
      ['alert_days_deliveries', 'Avisar entregas de projeto/etapas com antecedência de (dias)', 'number'], ['alert_days_proposals', 'Avisar propostas expirando com antecedência de (dias)', 'number'],
      ['alert_days_documents', 'Avisar documentos vencendo com antecedência de (dias)', 'number'], ['recurring_months_ahead', 'Gerar despesas recorrentes com quantos meses de antecedência', 'number']], ctx);
  },
  async backup(body) {
    const list = await api.get('/admin/backups');
    const box = el(html`<div class="grid g3"><div class="card span2"><div class="card-head"><h3>Backups do banco de dados</h3><button class="btn sm primary" data-now>${icon('download', 'sm')} Gerar backup agora</button></div>
      <p class="small muted" style="margin-top:0">Um backup automático é criado todos os dias (mantidos os últimos 30). Guarde cópias fora do servidor periodicamente. A pasta <code>uploads/</code> contém os arquivos anexados e também deve ser copiada.</p>
      ${list.length ? html`<div class="list">${list.map((b) => html`<div class="list-item"><div class="grow"><div class="li-title">${b.name}</div><div class="li-sub">${datetime(new Date(b.date).toISOString().replace('T', ' '))} · ${bytes(b.size)}</div></div><a class="btn xs" href="/api/admin/backups/${encodeURIComponent(b.name)}">${icon('download', 'sm')} Baixar</a></div>`)}</div>` : html`<div class="empty sm">Nenhum backup ainda.</div>`}</div>
      <div class="card"><div class="card-head"><h3>Exportar dados</h3></div><p class="small muted" style="margin-top:0">Exporta todas as informações do sistema em formato JSON (sem senhas), para arquivo ou migração.</p><a class="btn" href="/api/admin/export">${icon('download')} Exportar tudo (JSON)</a>
      <div class="eyebrow mt-24 mb-8">Segurança</div><ul class="small muted" style="padding-left:18px;margin:0;line-height:1.8"><li>Senhas criptografadas (bcrypt)</li><li>Sessões com cookie seguro (HttpOnly)</li><li>Bloqueio após tentativas de login</li><li>Permissões por nível e por projeto</li><li>Área do cliente isolada dos dados internos</li><li>Registro de todas as alterações</li></ul></div></div>`);
    box.querySelector('[data-now]').onclick = async () => { const r = await api.post('/admin/backups'); toast('Backup gerado.'); location.href = `/api/admin/backups/${encodeURIComponent(r.name)}`; setTimeout(() => { body.innerHTML = ''; T.backup(body); }, 800); };
    body.appendChild(box);
  },
  async auditoria(body) {
    const rows = await api.get('/admin/audit');
    const act = { create: 'Criação', update: 'Alteração', delete: 'Exclusão', archive: 'Arquivamento', unarchive: 'Restauração', login: 'Login', pay: 'Baixa financeira', unpay: 'Estorno', upload: 'Upload', convert: 'Conversão', backup: 'Backup', export: 'Exportação', generate: 'Geração automática', password_change: 'Senha', password_reset: 'Senha', reset_link: 'Senha', client_select: 'Cliente', setup: 'Configuração', download: 'Download' };
    body.appendChild(table({ rows, cls: 'compact', columns: [
      { key: 'created_at', label: 'Data', render: (a) => datetime(a.created_at) }, { key: 'user_name', label: 'Usuário', render: (a) => a.user_name || 'Sistema' },
      { key: 'action', label: 'Ação', render: (a) => act[a.action] || a.action }, { key: 'summary', label: 'Descrição', render: (a) => html`${a.summary}${a.changes && a.action === 'update' ? html`<div class="cell-sub">${Object.entries(JSON.parse(a.changes)).slice(0, 5).map(([k, v]) => `${k}: ${v[0] ?? '—'} → ${v[1] ?? '—'}`).join(' · ')}</div>` : ''}` },
      { key: 'ip', label: 'IP' }], empty: 'Nenhum registro.' }));
  },
};

async function userModal(u, ctx) {
  const isNew = !u; u = u || { role: 'colaborador', active: 1 };
  const clients = S.meta.resources.clients ? await refOptions('clients') : [];
  const projects = await refOptions('projects');
  const authorized = u.id ? await api.get(`/admin/users/${u.id}/projects`) : [];
  const body = el(html`<div class="form-grid">
    <div class="field"><label>Nome</label><input id="un" value="${u.name || ''}"></div><div class="field"><label>E-mail</label><input id="ue" type="email" value="${u.email || ''}"></div>
    <div class="field"><label>Nível de acesso</label><select id="ur">${S.meta.lists.ROLES.map((r) => html`<option value="${r.value}" ${r.value === u.role ? 'selected' : ''}>${r.label}</option>`)}</select></div>
    <div class="field"><label>Cargo / função</label><input id="uj" value="${u.job_title || ''}"></div>
    <div class="field"><label>Telefone</label><input id="up" value="${u.phone || ''}"></div>
    <div class="field"><label>Custo por hora (R$)</label><input id="uh" type="number" step="0.01" value="${u.hourly_cost || ''}"><span class="hint">Usado na rentabilidade dos projetos.</span></div>
    <div class="field"><label>Cor</label><input id="uc" type="color" value="${u.color || '#111111'}" style="padding:4px;height:40px"></div>
    <div class="field" data-fin><label class="toggle"><input type="checkbox" id="uf" ${u.can_finance ? 'checked' : ''}><span class="sw"></span><span class="small">Acesso ao financeiro (gestor)</span></label></div>
    <div class="field wide" data-cli><label>Cliente vinculado (Área do Cliente)</label><select id="ucl"><option value="">—</option>${clients.map((c) => html`<option value="${c.id}" ${c.id === u.client_id ? 'selected' : ''}>${c.label}</option>`)}</select></div>
    <div class="field wide" data-proj><label>Projetos autorizados</label><div class="checks" style="max-height:180px;overflow:auto">${projects.map((p) => html`<label><input type="checkbox" value="${p.id}" ${authorized.includes(p.id) ? 'checked' : ''}>${p.label}</label>`)}</div><span class="hint">Colaboradores e estagiários enxergam apenas estes projetos (e os que gerenciam).</span></div>
    ${!isNew ? html`<div class="field"><label class="toggle"><input type="checkbox" id="ua" ${u.active ? 'checked' : ''}><span class="sw"></span><span class="small">Usuário ativo</span></label></div>
      <div class="field"><label>Nova senha (opcional)</label><input id="upw" type="password" autocomplete="new-password"></div>` : html`<div class="field wide"><label>Senha inicial (opcional)</label><input id="upw" type="password" autocomplete="new-password"><span class="hint">Se vazio, uma senha provisória é gerada. O usuário troca no primeiro acesso.</span></div>`}
    <div class="wide small muted" data-desc></div></div>`);
  const sync = () => { const r = body.querySelector('#ur').value; body.querySelector('[data-fin]').classList.toggle('hidden', r !== 'gestor'); body.querySelector('[data-cli]').classList.toggle('hidden', r !== 'cliente'); body.querySelector('[data-proj]').classList.toggle('hidden', !['colaborador', 'estagiario'].includes(r)); body.querySelector('[data-desc]').textContent = ROLE_DESC[r]; };
  body.querySelector('#ur').onchange = sync; sync();
  const m = modal({ title: isNew ? 'Novo usuário' : u.name, body, actions: [
    ...(!isNew ? [{ label: 'Gerar link de senha', fn: async () => { const r = await api.post(`/admin/users/${u.id}/reset-link`); modal({ title: 'Link de redefinição', body: html`<p class="small muted">Válido por 2 horas. Envie ao usuário:</p><div class="card flat small" style="user-select:all;overflow-wrap:anywhere">${r.link}</div>`, actions: [{ label: 'OK', primary: true }] }); return false; } }] : []),
    { label: 'Cancelar' }, { label: 'Salvar', primary: true, fn: async () => {
      const v = (s) => body.querySelector(s)?.value;
      const data = { name: v('#un'), email: v('#ue'), role: v('#ur'), job_title: v('#uj'), phone: v('#up'), hourly_cost: v('#uh'), color: v('#uc'), can_finance: body.querySelector('#uf').checked, client_id: v('#ucl') || null };
      if (v('#upw')) data.password = v('#upw');
      if (!isNew) data.active = body.querySelector('#ua').checked ? 1 : 0;
      let id = u.id;
      if (isNew) { const r = await api.post('/admin/users', data); id = r.id; modal({ title: 'Usuário criado', body: html`<p class="small">Envie os dados de acesso:</p><div class="card flat small" style="user-select:all;overflow-wrap:anywhere">E-mail: ${data.email}<br>Senha provisória: <b>${r.temp_password}</b><br><br>Link para definir senha (2 horas):<br>${r.reset_link}</div>`, actions: [{ label: 'OK', primary: true }] }); }
      else await api.put(`/admin/users/${u.id}`, data);
      if (['colaborador', 'estagiario'].includes(data.role)) await api.post(`/admin/users/${id}/projects`, { project_ids: $$('[data-proj] input:checked', body).map((i) => +i.value) });
      toast('Usuário salvo.'); S.meta = await api.get('/meta'); ctx.rerender();
    } }] });
  m.el.style.width = 'min(640px, calc(100vw - 32px))';
}

async function templateEditor(id, fields, blocks, onDone) {
  const t = await api.get(`/doc-templates/${id}`);
  const { bodyEditor } = await import('./docs-common.js');
  const { drawer } = await import('../lib.js');
  const box = el(html`<div><div class="row wrap gap-8 mb-16">${t.status === 'pendente' ? html`<span class="badge danger plain">texto pendente</span>` : html`<span class="badge success plain">configurado</span>`}<span class="badge plain">versão ${t.version}</span>${t.source ? html`<span class="small muted">${t.source}</span>` : ''}</div>
    ${!isAdmin() ? html`<div class="card flat small mb-16">Somente administradores podem alterar os modelos.</div>` : ''}<div data-ed></div>
    <div class="eyebrow mt-24 mb-8">Histórico de versões</div><div class="list">${t.versions.map((v) => html`<div class="list-item"><div class="grow"><div class="li-title">Versão ${v.version}</div><div class="li-sub">${datetime(v.created_at)}${v.created_by_name ? ' · ' + v.created_by_name : ''}</div></div><button class="btn xs" data-v="${v.version}">Ver texto</button></div>`)}</div></div>`);
  const ed = bodyEditor({ value: t.body, fields, blocks, rows: 30 });
  box.querySelector('[data-ed]').appendChild(ed);
  const d = drawer({ title: t.name, sub: 'Modelo de documento', body: box, wide: true });
  box.onclick = async (e) => { const b = e.target.closest('[data-v]'); if (!b) return; const v = await api.get(`/doc-templates/${id}/versions/${b.dataset.v}`); modal({ title: `Versão ${v.version}`, body: html`<pre class="notes" style="max-height:60vh;overflow:auto;font-size:12px">${v.body}</pre>`, actions: [{ label: 'Usar este texto no editor', fn: () => ed.body.set(v.body) }, { label: 'Fechar', primary: true }] }).el.style.width = 'min(760px, calc(100vw - 32px))'; };
  if (isAdmin()) {
    d.foot.classList.remove('hidden');
    d.foot.innerHTML = toHTML(html`<button class="btn" data-restore>Restaurar texto original</button><span class="grow"></span><button class="btn" data-close2>Fechar</button><button class="btn primary" data-save>Salvar nova versão</button>`);
    d.foot.querySelector('[data-close2]').onclick = d.close;
    d.foot.querySelector('[data-save]').onclick = async () => { try { const r = await api.put(`/doc-templates/${id}`, { body: ed.body.get() }); toast(`Modelo salvo — versão ${r.version}. Documentos já criados não mudam.`); d.close(); onDone(); } catch (err) { fail(err); } };
    d.foot.querySelector('[data-restore]').onclick = async () => { if (await confirmDialog('Restaurar o texto original deste modelo? Será criada uma nova versão.', { title: 'Restaurar', ok: 'Restaurar' })) { await api.post(`/doc-templates/${id}/restore-default`); toast('Texto original restaurado.'); d.close(); onDone(); } };
  }
}
