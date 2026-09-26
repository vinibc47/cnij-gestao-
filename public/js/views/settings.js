import { S, api, html, el, toHTML, icon, date, datetime, bytes, modal, toast, fail, table, avatar, label, refOptions, confirmDialog, isAdmin, $$ } from '../lib.js';

const SECS = [['escritorio', 'Escritório'], ['usuarios', 'Usuários e permissões'], ['listas', 'Categorias e listas'], ['etapas', 'Modelos de etapas'], ['alertas', 'Alertas e automações'], ['backup', 'Backup e dados'], ['auditoria', 'Registro de alterações']];
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
    await settingsForm(body, [['office_name', 'Nome do escritório', 'wide'], ['office_tagline', 'Assinatura', 'wide'], ['office_doc', 'CNPJ'], ['office_phone', 'Telefone'], ['office_email', 'E-mail'], ['office_address', 'Endereço', 'wide'],
      ['opening_balance', 'Saldo inicial do caixa (R$)', 'number', 'Saldo em conta na data abaixo. O saldo atual = saldo inicial + recebimentos − pagamentos a partir desta data.'], ['opening_balance_date', 'Data do saldo inicial', 'date']], ctx);
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
