// RECIBOS — recibo de prestação de serviço vinculado a cliente › projeto › contrato › parcela.
// Selecionar uma cobrança só preenche os dados: o recibo só é emitido quando o pagamento consta como recebido
// no financeiro (ou, sem parcela vinculada, com confirmação expressa do recebimento).
import { S, api, html, el, toHTML, icon, date, money, toast, fail, today, refOptions, combo, openPdf, modal, confirmDialog, dirtyTracker, archiveRow, deleteRow, menu, badge, L, parseNum, brl2, pdfProblems } from '../lib.js';
import { listPage } from './common.js';

export default async function (ctx) {
  if (ctx.params[0]) return editor(ctx, Number(ctx.params[0]));
  await listPage({
    root: ctx.root, res: 'receipts', title: 'Recibos', sub: 'Recibos de prestação de serviço gerados a partir dos pagamentos registrados no financeiro', query: ctx.query,
    filters: ['status', 'client_id'], newLabel: 'Novo recibo',
    columns: [
      { key: 'number', label: 'Nº', render: (r) => html`<div class="cell-title">${r.number || 'Rascunho'}</div><div class="cell-sub">${date(r.issue_date)}</div>` },
      { key: 'payer_name', label: 'Pagador', render: (r) => html`<div>${r.payer_name || '—'}</div><div class="cell-sub">${[r.project_name, r.project_code].filter(Boolean).join(' · ')}</div>` },
      { key: 'description', label: 'Referente a', render: (r) => html`${r.description || '—'}${r.installment_label ? html`<div class="cell-sub">${r.installment_label}</div>` : ''}` },
      { key: 'amount', label: 'Valor', cls: 'num', render: (r) => money(r.amount), csv: (r) => r.amount },
      { key: 'paid_at', label: 'Pago em', render: (r) => date(r.paid_at) },
      { key: 'status', label: 'Status', render: (r) => badge('RECEIPT_STATUS', r.status) },
    ],
    onRow: (r) => ctx.go(`#/recibos/${r.id}`),
    actions: (r, reload) => [
      { label: 'Abrir', icon: 'edit', fn: () => ctx.go(`#/recibos/${r.id}`) },
      { label: r.status === 'rascunho' ? 'Visualizar rascunho' : 'Baixar PDF', icon: 'print', fn: () => openPdf(`/pdf/receipt/${r.id}`) },
      { label: r.archived ? 'Restaurar' : 'Arquivar', icon: r.archived ? 'refresh' : 'archive', fn: async () => { await archiveRow('receipts', r, r.archived ? 0 : 1); reload(); } },
      ...(r.status === 'rascunho' ? ['-', { label: 'Excluir rascunho', icon: 'trash', danger: true, fn: async () => { if (await deleteRow('receipts', r, 'este rascunho')) reload(); } }] : []),
    ],
    onNew: () => newReceipt(ctx),
  });
}

function newReceipt(ctx) {
  const body = el(html`<div class="col" style="gap:12px">
    <p class="muted small" style="margin:0">Escolha o cliente para puxar projeto, contrato e parcelas, ou informe um pagador avulso.</p>
    <div class="btn-group" data-who><button type="button" class="on" data-v="cliente">Cliente cadastrado</button><button type="button" data-v="avulso">Pagador avulso</button></div>
    <div class="field" data-cli><label>Cliente</label></div>
    <div class="field hidden" data-av><label>Nome de quem pagou</label><input name="payer_name"></div>
  </div>`);
  const cli = combo({ name: 'client_id', options: refOptions('clients') });
  body.querySelector('[data-cli]').appendChild(cli);
  let who = 'cliente';
  body.querySelector('[data-who]').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; who = b.dataset.v; body.querySelectorAll('[data-who] button').forEach((x) => x.classList.toggle('on', x === b)); body.querySelector('[data-cli]').classList.toggle('hidden', who !== 'cliente'); body.querySelector('[data-av]').classList.toggle('hidden', who === 'cliente'); };
  modal({ title: 'Novo recibo', body, actions: [{ label: 'Cancelar' }, { label: 'Criar rascunho', primary: true, fn: async () => {
    const data = who === 'cliente' ? { client_id: cli.combo.get() || null } : { payer_name: body.querySelector('[name=payer_name]').value.trim() };
    if (!data.client_id && !data.payer_name) { toast(who === 'cliente' ? 'Selecione o cliente.' : 'Informe quem pagou.', { error: true }); return false; }
    try { const r = await api.post('/receipts', data); ctx.go(`#/recibos/${r.id}`); } catch (e) { fail(e); return false; }
  } }] });
}

const PREPS = ['à', 'a', 'às', 'ao', 'aos'];

async function editor(ctx, id) {
  const root = ctx.root;
  let r;
  try { r = await api.get(`/receipts/${id}`); } catch (e) { root.innerHTML = toHTML(html`<div class="empty">${e.message}</div>`); return; }
  const opts = await api.get(`/receipts/options${r.client_id ? `?client_id=${r.client_id}` : ''}`);
  const locked = r.status !== 'rascunho';
  const dis = locked ? 'disabled' : '';
  const inc = r.income;
  const incOpen = inc && inc.status !== 'recebido';
  const incLabel = (i) => `${i.description}${i.installment_total > 1 && !/\(\d+\/\d+\)/.test(i.description) ? ` (${i.installment_no}/${i.installment_total})` : ''} — ${money(i.amount)} · ${i.status === 'recebido' ? `recebido em ${date(i.paid_at)}` : `em aberto, vence ${date(i.due_date)}`}${i.receipts ? ` · recibo ${i.receipts}` : ''}`;
  root.innerHTML = toHTML(html`
    <div class="hero doc-hero"><div class="crumbs"><a href="#/recibos">Recibos</a> ${icon('chevron', 'sm')} <span>${r.number || 'Rascunho'}</span></div>
      <div class="row between top wrap gap-16"><div><h1>Recibo ${r.number || '(rascunho)'}</h1>
        <div class="info-row mt-8">${badge('RECEIPT_STATUS', r.status)}<span>${r.payer_name || ''}</span><span>${money(r.amount)}</span><span class="dirty-flag">alterações não salvas</span></div></div>
        <div class="row wrap">
          ${!locked ? html`<button class="btn" data-save>${icon('check')} Salvar rascunho</button><button class="btn" data-preview>${icon('eye')} Visualizar</button><button class="btn primary" data-emit>${icon('receipt')} Emitir recibo</button>`
            : html`<button class="btn primary" data-pdf>${icon('download')} Baixar PDF</button>`}
          <button class="icon-btn" data-more>${icon('more')}</button></div></div></div>
    ${locked ? html`<div class="callout mt-16">${r.status === 'emitido' ? `Recibo emitido em ${date(r.issued_at)}. Os dados ficam congelados; para corrigir, cancele e emita um novo.` : 'Recibo cancelado. Mantido apenas para histórico.'}</div>` : ''}
    ${r.other_receipts && r.other_receipts.length ? html`<div class="callout warn mt-16">Já existe recibo emitido para este pagamento: ${r.other_receipts.map((x) => x.number).join(', ')}.</div>` : ''}
    <div class="col mt-24" style="gap:16px" data-f>
      <section class="card"><div class="card-head"><h3>Vínculos</h3><span class="small muted">cliente › projeto › contrato › pagamento</span></div>
        <div class="form-grid">
          <div class="field"><label>Cliente</label><div data-client></div></div>
          <div class="field"><label>Projeto</label><select name="project_id" ${dis}><option value="">—</option>${opts.projects.map((p) => html`<option value="${p.id}" ${p.id === r.project_id ? 'selected' : ''}>${p.name}${p.code ? ` · ${p.code}` : ''}</option>`)}</select></div>
          <div class="field"><label>Contrato</label><select name="contract_id" ${dis}><option value="">—</option>${opts.contracts.map((c) => html`<option value="${c.id}" data-p="${c.project_id || ''}" ${c.id === r.contract_id ? 'selected' : ''}>${c.number} · ${money(c.amount)}</option>`)}</select></div>
          <div class="field wide"><label>Pagamento / parcela</label><select name="income_id" ${dis}><option value="">— sem parcela vinculada —</option>${opts.incomes.map((i) => html`<option value="${i.id}" data-p="${i.project_id || ''}" data-c="${i.contract_id || ''}" ${i.id === r.income_id ? 'selected' : ''}>${incLabel(i)}</option>`)}</select>
            <span class="hint">Ao escolher a parcela, valor, descrição e data do pagamento são preenchidos a partir do financeiro. Uma cobrança em aberto não é tratada como recebida.</span></div>
        </div>
        ${incOpen && !locked ? html`<div class="callout warn mt-12"><b>Este pagamento ainda não consta como recebido.</b> O recibo só pode ser emitido depois que o recebimento for registrado.
          <div class="row wrap mt-8"><input type="date" data-rp-date value="${today()}" style="max-width:170px"><select data-rp-method style="max-width:200px">${L('PAYMENT_METHODS').map((m) => html`<option value="${m.value}" ${m.value === (r.payment_method || inc.method) ? 'selected' : ''}>${m.label}</option>`)}</select>
          <button class="btn sm" data-register>${icon('check', 'sm')} Registrar recebimento no financeiro</button></div></div>` : ''}
      </section>
      <section class="card"><div class="card-head"><h3>Recibo</h3></div><form class="form-grid" onsubmit="return false" data-main>
        <div class="field"><label>Valor <span class="req">*</span></label><div class="money-input"><span>R$</span><input name="amount" inputmode="decimal" value="${r.amount ? brl2(r.amount) : ''}" ${dis}></div></div>
        <div class="field"><label>Nº do recibo</label><input name="number" value="${r.number || ''}" placeholder="automático na emissão" ${dis}></div>
        <div class="field"><label>Recebi(emos) de <span class="req">*</span></label><input name="payer_name" value="${r.payer_name || ''}" ${dis}></div>
        <div class="field"><label>CPF / CNPJ do pagador</label><input name="payer_doc" value="${r.payer_doc || ''}" placeholder="opcional" ${dis}></div>
        <div class="field wide"><label>Referente</label><div class="btn-group" data-prep>${PREPS.map((p) => html`<button type="button" data-v="${p}" class="${(r.reference_prep || 'ao') === p ? 'on' : ''}" ${dis}>${p}</button>`)}</div></div>
        <div class="field wide"><label>Descrição do serviço / referência <span class="req">*</span></label><input name="description" data-sentence value="${r.description || ''}" placeholder="Ex.: honorários do projeto de interiores" ${dis}></div>
        <div class="field"><label>Parcela</label><input name="installment_label" value="${r.installment_label || ''}" placeholder="Ex.: parcela 2/4" ${dis}></div>
        <div class="field"><label>Forma de pagamento <span class="req">*</span></label><select name="payment_method" ${dis}><option value="">—</option>${L('PAYMENT_METHODS').map((m) => html`<option value="${m.value}" ${m.value === r.payment_method ? 'selected' : ''}>${m.label}</option>`)}</select></div>
        <div class="field"><label>Data efetiva do pagamento <span class="req">*</span></label><input type="date" name="paid_at" value="${r.paid_at || ''}" ${dis || (r.income_id ? 'disabled' : '')}>${r.income_id ? html`<span class="hint">Vem do financeiro.</span>` : ''}</div>
        <div class="field"><label>Cidade <span class="req">*</span></label><input name="city" value="${r.city || ''}" ${dis}></div>
        <div class="field"><label>Data de emissão</label><input type="date" name="issue_date" value="${r.issue_date || today()}" ${dis}></div>
      </form></section>
      <section class="card"><div class="card-head"><h3>Dados do prestador (recebedor)</h3></div><form class="form-grid" onsubmit="return false" data-rec>
        <div class="field"><label>Preencher com</label><select data-recv ${dis}><option value="">—</option><option value="office">Escritório / contratado (Configurações)</option>${S.meta.users.map((u) => html`<option value="${u.id}" ${u.id === r.receiver_user_id ? 'selected' : ''}>${u.name}</option>`)}</select></div>
        <div class="field"><label>Nome <span class="req">*</span></label><input name="receiver_name" value="${r.receiver_name || ''}" ${dis}></div>
        <div class="field"><label>CPF / CNPJ</label><input name="receiver_doc" value="${r.receiver_doc || ''}" placeholder="não informado" ${dis}></div>
        <div class="field"><label>Telefone</label><input name="receiver_phone" value="${r.receiver_phone || ''}" ${dis}></div>
        <div class="field wide"><label>Endereço (CEP, rua, número, bairro, complemento, cidade/UF)</label><input name="receiver_address" value="${r.receiver_address || ''}" ${dis}></div>
      </form></section>
      <section class="card"><div class="card-head"><h3>Opções</h3></div><form class="form-grid" onsubmit="return false" data-opt>
        <div class="field"><label class="toggle"><input type="checkbox" name="two_copies" ${r.two_copies ? 'checked' : ''} ${dis}><span class="sw"></span><span class="small">Gerar duas vias</span></label></div>
        ${!r.income_id ? html`<div class="field wide"><label class="toggle"><input type="checkbox" name="manual_confirmed" ${r.manual_confirmed ? 'checked' : ''} ${dis}><span class="sw"></span><span class="small">Confirmo que este valor foi efetivamente recebido (recibo sem parcela vinculada)</span></label></div>` : ''}
        <div class="field wide"><label>Observações internas</label><textarea name="notes" rows="2" ${dis}>${r.notes || ''}</textarea><span class="hint">Não saem no recibo.</span></div>
      </form></section>
    </div>`);
  const tracker = dirtyTracker(root.querySelector('[data-f]'));
  const cli = combo({ name: 'client_id', options: refOptions('clients'), value: r.client_id, onChange: async (v) => { await put({ client_id: v || null, project_id: null, contract_id: null, income_id: null }); } });
  if (locked) cli.querySelector('button').disabled = true;
  root.querySelector('[data-client]').appendChild(cli);
  const q = (s) => root.querySelector(s);
  let prep = r.reference_prep || 'ao';
  const segP = q('[data-prep]');
  segP.onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b || locked) return; prep = b.dataset.v; segP.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); tracker.mark(); };

  const collect = () => {
    const d = { reference_prep: prep };
    root.querySelectorAll('[data-main] [name], [data-rec] [name], [data-opt] [name]').forEach((i) => {
      if (i.type === 'checkbox') d[i.name] = i.checked ? 1 : 0;
      else if (i.name === 'amount') d.amount = parseNum(i.value);
      else if (i.name === 'paid_at' && r.income_id) { /* vem do financeiro */ }
      else d[i.name] = i.value.trim();
    });
    d.project_id = q('[name=project_id]').value || null; d.contract_id = q('[name=contract_id]').value || null;
    const rv = q('[data-recv]').value; d.receiver_user_id = rv && rv !== 'office' ? Number(rv) : null;
    if (!d.number) delete d.number;
    return d;
  };
  const put = async (d, reload = true) => {
    try { await api.put(`/receipts/${id}`, d); tracker.clean(); if (reload) editor(ctx, id); return true; } catch (e) { fail(e); return false; }
  };
  const save = async (quiet) => { const okk = await put(collect(), !quiet); if (okk && !quiet) toast('Rascunho salvo.'); return okk; };
  if (!locked) {
    // parcela escolhida: preenche a partir do financeiro (sem marcar como recebida)
    q('[name=income_id]').onchange = async (e) => { const v = e.target.value; const o = e.target.selectedOptions[0]; await put({ ...collect(), income_id: v || null, fill_from_income: !!v, ...(v ? { project_id: o.dataset.p || null, contract_id: o.dataset.c || null } : {}) }); };
    q('[name=contract_id]').onchange = (e) => { const o = e.target.selectedOptions[0]; if (o && o.dataset.p && !q('[name=project_id]').value) q('[name=project_id]').value = o.dataset.p; };
    q('[data-recv]').onchange = (e) => {
      const v = e.target.value; if (!v) return;
      const set = (n, x) => { q(`[name=${n}]`).value = x || ''; };
      if (v === 'office') { set('receiver_name', opts.office.name); set('receiver_doc', opts.office.doc); set('receiver_address', opts.office.address); set('receiver_phone', ''); }
      else { const u = S.meta.users.find((x) => x.id === Number(v)); set('receiver_name', u ? u.name : ''); set('receiver_doc', ''); set('receiver_address', ''); set('receiver_phone', ''); toast('CPF/CNPJ e endereço do usuário não estão cadastrados: preencha manualmente, se necessário.'); }
      tracker.mark();
    };
    q('[data-save]').onclick = () => save();
    q('[data-preview]').onclick = async () => { if (tracker.dirty && !(await save(true))) return; openPdf(`/pdf/receipt/${id}`); };
    const reg = q('[data-register]');
    if (reg) reg.onclick = async () => {
      if (!(await confirmDialog(`Registrar no financeiro que ${money(inc.amount)} foram recebidos em ${date(q('[data-rp-date]').value)}? Use somente se o valor já entrou na conta.`, { title: 'Registrar recebimento', ok: 'Registrar' }))) return;
      if (tracker.dirty && !(await save(true))) return;
      try { await api.post(`/receipts/${id}/register-payment`, { paid_at: q('[data-rp-date]').value, method: q('[data-rp-method]').value }); toast('Recebimento registrado no financeiro.'); editor(ctx, id); } catch (e) { fail(e); }
    };
    q('[data-emit]').onclick = async () => {
      if (!(await save(true))) return;
      const chk = await api.get(`/receipts/${id}/check`).catch((e) => { fail(e); return null; });
      if (!chk) return;
      if (!chk.ok) return pdfProblems(chk.problems, `/pdf/receipt/${id}`);
      if (!(await confirmDialog('Depois de emitido, o recibo recebe número e não pode mais ser alterado. Emitir agora?', { title: 'Emitir recibo', ok: 'Emitir' }))) return;
      const emit = async (force) => {
        try { const x = await api.post(`/receipts/${id}/emit`, { force }); toast(`Recibo ${x.number} emitido.`); editor(ctx, id); }
        catch (e) {
          if (e.status === 409 || (e.data && e.data.duplicate)) { if (await confirmDialog(`${e.message} Emitir outro mesmo assim?`, { title: 'Recibo já emitido', ok: 'Emitir outro', danger: true })) emit(true); }
          else if (e.data && e.data.problems) pdfProblems(e.data.problems); else fail(e);
        }
      };
      emit(false);
    };
  } else q('[data-pdf]').onclick = () => openPdf(`/pdf/receipt/${id}`);
  q('[data-more]').onclick = (e) => menu(e.currentTarget, [
    r.project_id ? { label: 'Abrir projeto', icon: 'folder', fn: () => ctx.go(`#/projetos/${r.project_id}`) } : null,
    r.status === 'emitido' ? { label: 'Cancelar recibo', icon: 'x', danger: true, fn: async () => {
      if (!(await confirmDialog('Cancelar este recibo? Ele continua no histórico marcado como cancelado. O pagamento no financeiro não é alterado.', { title: 'Cancelar recibo', ok: 'Cancelar recibo', danger: true }))) return;
      try { await api.post(`/receipts/${id}/cancel`, {}); toast('Recibo cancelado.'); editor(ctx, id); } catch (er) { fail(er); }
    } } : null,
    { label: r.archived ? 'Restaurar' : 'Arquivar', icon: r.archived ? 'refresh' : 'archive', fn: async () => { await archiveRow('receipts', r, r.archived ? 0 : 1); ctx.go('#/recibos'); } },
    r.status === 'rascunho' ? '-' : null,
    r.status === 'rascunho' ? { label: 'Excluir rascunho', icon: 'trash', danger: true, fn: async () => { if (await deleteRow('receipts', r, 'este rascunho')) ctx.go('#/recibos'); } } : null,
  ].filter(Boolean));
}
