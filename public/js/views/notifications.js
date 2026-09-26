import { api, html, el, toHTML, icon, datetime, toast } from '../lib.js';
import { refreshBadges } from '../app.js';

export default async function (ctx) {
  const { rows, unread } = await api.get('/notifications');
  const kinds = { tarefa_atrasada: 'Tarefa atrasada', tarefa_vencendo: 'Tarefa vencendo', cliente_inadimplente: 'Cliente inadimplente', recebimento_proximo: 'Recebimento', pagamento_vencendo: 'Pagamento', proposta_expirando: 'Proposta expirando', entrega_proxima: 'Entrega', reuniao_proxima: 'Reunião', contrato_pendente: 'Contrato pendente', documento_vencendo: 'Documento', projeto_concluido: 'Projeto', comentario: 'Comentário', orcamento_cliente: 'Área do cliente' };
  ctx.root.innerHTML = toHTML(html`<div class="page-head"><div><h1>Notificações</h1><div class="sub">${unread} não lida(s)</div></div><button class="btn" data-all>${icon('check')} Marcar todas como lidas</button></div>
    <div class="card" style="padding:0">${rows.length ? rows.map((n) => html`<a class="notif ${n.read_at ? '' : 'unread'}" href="${n.link || '#/notificacoes'}" data-id="${n.id}"><span class="sev ${n.severity}"></span><div class="grow"><div class="tiny muted">${kinds[n.kind] || n.kind} · ${datetime(n.created_at)}</div><div class="li-title" style="white-space:normal">${n.title}</div>${n.body ? html`<div class="li-sub" style="white-space:normal">${n.body}</div>` : ''}</div></a>`) : html`<div class="empty">Nenhuma notificação.</div>`}</div>`);
  ctx.root.querySelector('[data-all]').onclick = async () => { await api.post('/notifications/read', {}); toast('Tudo marcado como lido.'); refreshBadges(); ctx.rerender(); };
  ctx.root.querySelector('.card').onclick = (e) => { const a = e.target.closest('[data-id]'); if (a) api.post('/notifications/read', { ids: [+a.dataset.id] }).then(refreshBadges); };
}
