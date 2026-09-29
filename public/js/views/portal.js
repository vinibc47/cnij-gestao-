// ÁREA DO CLIENTE — visão exclusiva e simplificada para o cliente
import { api, html, el, toHTML, icon, money, date, datetime, time, label, confirmDialog, toast, fail, relDay, fileExt, bytes, $$ } from '../lib.js';

const url = (d, inline) => `/api/portal/files/${d.id}${inline ? '?inline=1' : ''}`;
const PH = { nao_iniciado: 'A iniciar', em_andamento: 'Em andamento', aguardando_cliente: 'Aguardando sua aprovação', aguardando_fornecedor: 'Aguardando fornecedor', revisao: 'Em revisão', aprovado: 'Aprovado', concluido: 'Concluído' };
const IN = { previsto: 'Previsto', a_receber: 'A vencer', recebido: 'Pago', vencido: 'Vencido', cancelado: 'Cancelado' };
const INT = { previsto: 'neutral', a_receber: 'info', recebido: 'success', vencido: 'danger' };

export default async function portal(root) {
  let d;
  try { d = await api.get('/portal/overview'); } catch (e) { root.innerHTML = toHTML(html`<div class="empty" style="padding-top:20vh">${e.message}</div>`); return; }
  // O cliente precisa de um mínimo de metadados para a formatação
  const { S } = await import('../lib.js'); S.meta = S.meta || { lists: {}, users: [], resources: {}, options: {} };
  let pid = Number(sessionStorage.getItem('portal_pid')) || (d.projects[0] && d.projects[0].id);
  if (!d.projects.find((p) => p.id === pid) && d.projects[0]) pid = d.projects[0].id;
  let tab = null;
  const render = () => {
    const p = d.projects.find((x) => x.id === pid);
    const inst = d.finance.installments.filter((i) => !p || !i.project_id || i.project_id === p.id);
    // abas aparecem somente quando há conteúdo liberado ao cliente
    const decisions = p ? [...(p.minutes || []), ...p.works.flatMap((w) => w.updates.filter((u) => u.decisions))] : [];
    const tabs = !p ? [] : [
      p.phases.length ? ['andamento', 'Andamento'] : null,
      decisions.length ? ['decisoes', 'Decisões e atas'] : null,
      p.images.length || p.presentations.length ? ['imagens', 'Imagens e apresentações'] : null,
      p.works.length ? ['obra', 'Obra'] : null,
      p.quotes.length ? ['orcamentos', 'Orçamentos'] : null,
      inst.length ? ['pagamentos', 'Pagamentos'] : null,
      p.documents.length ? ['documentos', 'Documentos'] : null,
    ].filter(Boolean);
    if (!tabs.find((t) => t[0] === tab)) tab = tabs[0] ? tabs[0][0] : null;
    root.innerHTML = toHTML(html`<div class="portal">
      <div class="portal-top"><img class="portal-logo" src="/logo" alt="Carla Nogueira & Irineu Junior — Arquitetura | Interiores">
        <div class="row portal-user"><span class="small muted desktop-only">${d.client.name}</span><button class="btn sm" data-out>${icon('logout', 'sm')} Sair</button></div></div>
      <div class="portal-hero"><div class="eyebrow">Área do Cliente</div><h1 class="mt-8">Olá, ${d.client.name.split(' ')[0]}.</h1>
        ${d.projects.length > 1 ? html`<div class="chips mt-16">${d.projects.map((x) => html`<button class="chip ${x.id === pid ? 'on' : ''}" data-p="${x.id}">${x.name}</button>`)}</div>` : ''}</div>
      ${!p ? html`<div class="empty">Nenhum projeto disponível no momento.</div>` : html`
        <div class="card" style="padding:28px 30px"><div class="row between wrap top gap-16"><div><div class="eyebrow">${p.type || 'Projeto'}${p.city ? ' · ' + p.city : ''}</div><h2 class="serif mt-8" style="font-size:34px">${p.name}</h2></div>
          <div class="right"><div class="eyebrow">Fase atual</div><div class="serif" style="font-size:24px">${p.current_phase || '—'}</div></div></div>
          <div class="row between small mt-24"><span>Andamento do projeto</span><b>${p.progress}%</b></div><div class="progress mt-8" style="height:8px"><span style="width:${p.progress}%"></span></div>
          ${p.due_date ? html`<div class="small muted mt-8">Previsão de entrega: ${date(p.due_date)}</div>` : ''}
          ${p.portal_message ? html`<div class="card flat mt-24 notes">${p.portal_message}</div>` : ''}</div>
        ${tabs.length ? html`<div class="tabs mt-32">${tabs.map(([k, l]) => html`<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`)}</div>` : html`<div class="empty mt-32">As informações do projeto serão disponibilizadas aqui pelo escritório.</div>`}
        <div data-body></div>`}
    </div>`);
    root.querySelector('[data-out]').onclick = async () => { await api.post('/auth/logout'); location.reload(); };
    $$('[data-p]', root).forEach((b) => (b.onclick = () => { pid = +b.dataset.p; sessionStorage.setItem('portal_pid', pid); render(); }));
    $$('[data-t]', root).forEach((b) => (b.onclick = () => { tab = b.dataset.t; render(); }));
    if (!p || !tab) return;
    const body = root.querySelector('[data-body]');
    body.appendChild(el(toHTML(TABS[tab](p, d, inst))));
    body.onclick = async (e) => {
      const b = e.target.closest('[data-sel]'); if (!b) return;
      if (!(await confirmDialog('Confirmar a escolha deste orçamento? O escritório será avisado para dar andamento.', { title: 'Aprovar orçamento', ok: 'Aprovar' }))) return;
      try { await api.post(`/portal/quotes/${b.dataset.sel}/select`); toast('Obrigado! Sua escolha foi enviada ao escritório.'); d = await api.get('/portal/overview'); render(); } catch (err) { fail(err); }
    };
  };
  render();
}

const files = (list) => (list.length ? html`<div class="files">${list.map((f) => html`<div class="file"><div class="file-ico">${fileExt(f.file_name)}</div><div class="grow"><a class="li-title" href="${url(f, true)}" target="_blank" rel="noopener">${f.title}</a><div class="li-sub">${[f.category, f.size ? bytes(f.size) : null, date(f.created_at)].filter(Boolean).join(' · ')}</div></div><a class="icon-btn" href="${url(f)}">${icon('download', 'sm')}</a></div>`)}</div>` : html`<div class="muted small">Nenhum arquivo liberado ainda.</div>`);

const TABS = {
  andamento: (p, d) => html`<div class="grid g3"><div class="card span2"><div class="card-head"><h3>Cronograma</h3></div><div class="phase-list">${p.phases.map((ph, i) => {
      const done = ['concluido', 'aprovado'].includes(ph.status); const doing = !done && ph.status !== 'nao_iniciado';
      return html`<div class="ph ${done ? 'done' : doing ? 'doing' : ''}"><div class="ph-num">${done ? '✓' : i + 1}</div><div><div class="cell-title">${ph.name}</div><div class="cell-sub">${PH[ph.status]}${ph.due_date && !done ? ` · previsto para ${date(ph.due_date)}` : ''}${done && ph.completed_at ? ` · concluído em ${date(ph.completed_at)}` : ''}</div></div><span></span></div>`;
    })}</div></div>
    <div class="col" style="gap:16px"><div class="card"><div class="card-head"><h3>Próximas etapas</h3></div>${p.next_phases.length ? html`<div class="list">${p.next_phases.map((x) => html`<div class="list-item"><div class="grow"><div class="li-title">${x.name}</div><div class="li-sub">${x.due_date ? date(x.due_date) : 'a definir'}</div></div></div>`)}</div>` : html`<div class="muted small">Todas as etapas concluídas.</div>`}</div>
      <div class="card"><div class="card-head"><h3>Últimas atualizações</h3></div>${p.updates.length ? html`<div class="timeline">${p.updates.map((u) => html`<div class="tl"><div class="d">${date(u.date)}</div><div class="x">${u.text}</div></div>`)}</div>` : html`<div class="muted small">Sem atualizações recentes.</div>`}</div>
      ${d.events.length ? html`<div class="card"><div class="card-head"><h3>Próximos compromissos</h3></div><div class="list">${d.events.map((e) => html`<div class="list-item"><div class="grow"><div class="li-title">${e.title}</div><div class="li-sub">${date(e.start_at)}${e.all_day ? '' : ' às ' + time(e.start_at)}${e.location ? ' · ' + e.location : ''}</div></div></div>`)}</div></div>` : ''}</div></div>`,
  imagens: (p) => html`<div class="col" style="gap:16px"><div class="card"><div class="card-head"><h3>Imagens do projeto</h3></div>${p.images.length ? html`<div class="gallery">${p.images.map((i) => html`<a href="${url(i, true)}" target="_blank" rel="noopener"><img src="${url(i, true)}" alt="${i.title}" loading="lazy"></a>`)}</div>` : html`<div class="muted small">As imagens serão disponibilizadas pelo escritório.</div>`}</div>
    <div class="card"><div class="card-head"><h3>Apresentações</h3></div>${files(p.presentations)}</div></div>`,
  obra: (p) => (p.works.length ? html`<div class="col" style="gap:16px">${p.works.map((w) => html`<div class="card"><div class="row between wrap"><h3 class="serif" style="font-size:24px">${w.name}</h3><span class="badge ${w.status === 'concluida' ? 'success' : 'info'}">${{ planejada: 'Planejada', em_andamento: 'Em andamento', pausada: 'Pausada', concluida: 'Concluída' }[w.status] || w.status}</span></div>
      <div class="row between small mt-16"><span>Execução</span><b>${w.progress}%</b></div><div class="progress mt-8"><span style="width:${w.progress}%"></span></div>
      <div class="small muted mt-8">${w.start_date ? 'Início ' + date(w.start_date) : ''}${w.due_date ? ' · previsão ' + date(w.due_date) : ''}</div>
      <div class="grid g3 mt-24">${w.phases.map((ph) => html`<div><div class="row between small"><span>${ph.name}</span><span class="muted">${ph.progress}%</span></div><div class="progress thin mt-8"><span style="width:${ph.progress}%"></span></div></div>`)}</div>
      ${w.updates.length ? html`<div class="eyebrow mt-32 mb-16">Diário da obra</div><div class="timeline">${w.updates.map((u) => html`<div class="tl"><div class="d">${date(u.date)}</div><div class="x notes">${u.description}</div>${u.decisions ? html`<div class="small mt-8"><b>Decisões:</b> ${u.decisions}</div>` : ''}
        ${u.photos.length ? html`<div class="gallery mt-8">${u.photos.map((f) => html`<a href="${url(f, true)}" target="_blank" rel="noopener"><img src="${url(f, true)}" loading="lazy" alt=""></a>`)}</div>` : ''}</div>`)}</div>` : ''}</div>`)}</div>` : html`<div class="empty">A obra deste projeto ainda não foi iniciada.</div>`),
  orcamentos: (p) => (p.quotes.length ? html`<div><p class="muted small">Compare as opções e indique qual orçamento você aprova. O escritório será notificado automaticamente.</p><div class="grid g2">${p.quotes.map((g) => {
      const min = Math.min(...g.options.map((o) => o.amount));
      return html`<div class="card"><div class="card-head"><h3 class="serif" style="font-size:24px">${g.item}</h3>${g.selected ? html`<span class="badge success">Aprovado por você</span>` : html`<span class="badge warning">Aguardando sua escolha</span>`}</div>
        <div class="compare">${g.options.map((o) => html`<div class="opt ${o.client_selected ? 'chosen' : ''}"><div><div class="cell-title">${o.supplier}</div><div class="cell-sub">${o.deadline_days ? `prazo ${o.deadline_days} dias` : ''}${o.amount === min && g.options.length > 1 ? ' · menor valor' : ''}</div>${o.client_notes ? html`<div class="small mt-8">${o.client_notes}</div>` : ''}</div>
          <div class="right"><div class="serif" style="font-size:24px">${money(o.amount)}</div>${o.client_selected ? html`<span class="small success-text">✓ escolhido</span>` : !g.locked ? html`<button class="btn xs primary" data-sel="${o.id}">Aprovar este</button>` : ''}</div></div>`)}</div></div>`;
    })}</div></div>` : html`<div class="empty">Nenhum orçamento liberado no momento.</div>`),
  decisoes: (p) => html`<div class="col" style="gap:16px">${(p.minutes || []).length ? html`<div class="card"><div class="card-head"><h3>Atas de reunião</h3></div><div class="timeline">${p.minutes.map((a) => html`<div class="tl"><div class="row between wrap"><div class="d">${date(a.date)} · ${a.title || 'Reunião'}</div><a class="btn xs" href="/api/portal/minutes/${a.id}/pdf" target="_blank" rel="noopener">${icon('download', 'sm')} PDF</a></div><div class="x notes">${a.content || ''}</div>
      ${a.next_steps && a.next_steps.length ? html`<div class="small mt-8"><b>Próximos passos:</b><ul style="margin:4px 0 0 18px;padding:0">${a.next_steps.map((n) => html`<li>${n.acao}${n.responsavel ? ' — ' + n.responsavel : ''}${n.prazo ? ' · até ' + date(n.prazo) : ''}</li>`)}</ul></div>` : ''}</div>`)}</div></div>` : ''}
    ${p.works.flatMap((w) => w.updates.filter((u) => u.decisions)).length ? html`<div class="card"><div class="card-head"><h3>Decisões registradas na obra</h3></div><div class="timeline">${p.works.flatMap((w) => w.updates.filter((u) => u.decisions)).map((u) => html`<div class="tl"><div class="d">${date(u.date)}</div><div class="x notes">${u.decisions}</div></div>`)}</div></div>` : ''}</div>`,
  pagamentos: (p, d, inst) => TABS.financeiro(p, d, inst),
  financeiro: (p, d, inst) => {
    const sum = (f) => inst.filter(f).reduce((s, i) => s + i.amount, 0);
    return html`<div><div class="grid g4"><div class="card kpi"><span class="label">Valor contratado</span><span class="value">${money(p.contract_value || d.finance.contracted)}</span></div>
      <div class="card kpi"><span class="label">Pago</span><span class="value">${money(sum((i) => i.status === 'recebido'))}</span></div>
      <div class="card kpi"><span class="label">A vencer</span><span class="value">${money(sum((i) => ['a_receber', 'previsto'].includes(i.status)))}</span></div>
      <div class="card kpi ${sum((i) => i.status === 'vencido') ? 'alert' : ''}"><span class="label">Vencido</span><span class="value">${money(sum((i) => i.status === 'vencido'))}</span></div></div>
      <div class="table-wrap mt-16"><table class="t responsive"><thead><tr><th>Parcela</th><th>Descrição</th><th>Vencimento</th><th class="right">Valor</th><th>Pagamento</th><th>Situação</th><th></th></tr></thead><tbody>
        ${inst.length ? inst.map((i) => html`<tr><td data-l="Parcela">${i.installment_total > 1 ? `${i.installment_no}/${i.installment_total}` : 'Única'}</td><td data-l="Descrição">${i.description}</td><td data-l="Vencimento">${date(i.due_date)}</td><td class="right" data-l="Valor">${money(i.amount)}</td><td data-l="Pago em">${i.paid_at ? date(i.paid_at) : '—'}</td>
          <td data-l="Situação"><span class="badge ${INT[i.status] || ''}">${IN[i.status] || i.status}</span></td><td class="actions">${i.receipts.map((r) => html`<a class="btn xs" href="${url(r)}">${icon('download', 'sm')} Comprovante</a>`)}${(i.receipt_docs || []).map((r) => html`<a class="btn xs" href="/api/portal/receipts/${r.id}/pdf" target="_blank" rel="noopener">${icon('download', 'sm')} Recibo ${r.number}</a>`)}</td></tr>`) : html`<tr><td colspan="7" class="empty sm">Nenhuma parcela.</td></tr>`}</tbody></table></div></div>`;
  },
  documentos: (p) => html`<div class="card"><div class="card-head"><h3>Documentos liberados</h3></div>${files(p.documents)}</div>`,
};
