// Testes automatizados das regras de negócio e das permissões (banco temporário)
//   npm test
process.env.TZ = 'America/Cuiaba';
const fs = require('fs'); const os = require('os'); const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cnij-test-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite'); process.env.BACKUP_DIR = path.join(tmp, 'bk'); process.env.UPLOAD_DIR = path.join(tmp, 'up');
const origLog = console.log; console.log = (...a) => { if (!String(a[0]).includes('e-mail não enviado')) origLog(...a); };
const app = require('../server');
const automation = require('../server/services/automation');
const client = require('./client');

const pad = (n) => String(n).padStart(2, '0');
const D = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
let pass = 0; let failN = 0;
const ok = (cond, msg) => { if (cond) { pass++; origLog('  ✓', msg); } else { failN++; origLog('  ✗', msg); } };
const rejects = async (p, status, msg) => { try { await p; ok(false, msg + ' (deveria falhar)'); } catch (e) { ok(!status || e.status === status, `${msg} → ${e.status}`); } };

(async () => {
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const A = client(base); const PW = 'Teste1234';
  origLog('\nAutenticação');
  await rejects(A.post('/r/clients', { name: 'x' }), 401, 'escrita sem sessão bloqueada');
  const csrf = await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok(csrf.status === 403, 'requisição sem cabeçalho anti-CSRF bloqueada → 403');
  await A.post('/setup', { name: 'Admin', email: 'admin@t.com', password: PW });
  await rejects(A.post('/setup', { name: 'B', email: 'b@t.com', password: PW }), 400, 'setup só funciona uma vez');
  await rejects(A.post('/auth/login', { email: 'admin@t.com', password: 'errada123' }), 401, 'senha errada recusada');
  await A.post('/auth/login', { email: 'admin@t.com', password: PW });
  ok((await A.get('/auth/me')).user.role === 'admin', 'login do administrador');

  origLog('\nCadastros e parcelamento');
  const c = await A.post('/r/clients', { name: 'Cliente Teste', email: 'c@t.com' });
  const p = await A.post('/r/projects', { name: 'Projeto Teste', client_id: c.id, contract_value: 30000 });
  const phases = (await A.get(`/r/project_phases?f_project_id=${p.id}`)).rows;
  ok(phases.length === 11, 'projeto criado com 11 etapas do modelo');
  const inst = await A.post('/finance/installments', { table: 'incomes', description: 'Projeto de arquitetura', project_id: p.id, category: 'Projeto de arquitetura', total: 30000, count: 6, first_due: D(-40) });
  ok(inst.ids.length === 6, '6 parcelas geradas automaticamente');
  const incs = (await A.get(`/r/incomes?f_project_id=${p.id}&sort=due_date`)).rows;
  ok(incs.every((i) => i.amount === 5000) && incs[0].client_id === c.id, 'parcelas de R$ 5.000 com cliente herdado do projeto');
  ok(incs[0].status === 'vencido', 'parcela vencida marcada automaticamente como "vencido"');
  const odd = await A.post('/finance/installments', { table: 'incomes', description: 'Arredondamento', total: 1000, count: 3, first_due: D(10) });
  const oddRows = await Promise.all(odd.ids.map((id) => A.get(`/r/incomes/${id}`)));
  ok(Math.round(oddRows.reduce((s, r) => s + r.amount, 0) * 100) === 100000, 'soma das parcelas fecha exatamente o total (centavos)');

  origLog('\nPagamentos, saldo e fluxo de caixa');
  const before = (await A.get('/dashboard')).finance.balance;
  await A.post(`/finance/incomes/${incs[0].id}/pay`, { paid_at: D(0) });
  const after = (await A.get('/dashboard')).finance;
  ok(after.balance === before + 5000, 'recebimento atualiza o saldo do dashboard');
  ok(after.received_month >= 5000, 'recebimento aparece em "recebido no mês"');
  await A.post(`/finance/incomes/${incs[1].id}/pay`, { paid_at: D(0), amount: 2000 });
  const rest = (await A.get(`/r/incomes?f_project_id=${p.id}&q=saldo`)).rows;
  ok(rest.length === 1 && rest[0].amount === 3000, 'pagamento parcial gera lançamento com o saldo restante');
  const cf = await A.get('/finance/cashflow');
  ok(cf.horizons.length === 3 && cf.horizons[0].months === 3, 'previsão de 3, 6 e 12 meses');

  origLog('\nDespesas, obra e rentabilidade');
  const w = await A.post('/r/works', { project_id: p.id, budget: 100000 });
  ok((await A.get(`/r/projects/${p.id}`)).status === 'em_obra', 'criar obra muda o projeto para "em obra"');
  await A.post('/r/expenses', { description: 'Gesso', amount: 4000, due_date: D(-1), paid_at: D(-1), work_id: w.id, category: 'Obra' });
  await A.post('/r/expenses', { description: 'Plotagem', amount: 500, due_date: D(0), project_id: p.id, category: 'Impressão' });
  await A.post('/r/expenses', { description: 'Pago pelo cliente', amount: 9000, due_date: D(0), work_id: w.id, paid_by: 'cliente' });
  const ov = await A.get(`/projects/${p.id}/overview`);
  ok(ov.profitability.work_costs === 4000 && ov.profitability.direct_costs === 500, 'despesas entram na rentabilidade (obra × diretas)');
  ok(ov.profitability.result === 30000 - 4500, 'resultado = contratado − custos do escritório (pagamento do cliente não conta)');
  const wk = await A.get(`/r/works/${w.id}`);
  ok(wk.spent === 13000 && wk.available === 87000, 'valor gasto e saldo da obra calculados');
  const wph = (await A.get(`/r/work_phases?f_work_id=${w.id}`)).rows;
  await A.put(`/r/work_phases/${wph[0].id}`, { progress: 100 });
  ok((await A.get(`/r/works/${w.id}`)).progress === Math.round(100 / wph.length), 'percentual da obra = média das fases');

  origLog('\nRecorrência');
  const rec = await A.post('/r/recurring_expenses', { description: 'Adobe', amount: 290, day: 12, start_date: D(-5) });
  const recRows = (await A.get(`/r/expenses?q=Adobe&limit=50`)).rows;
  ok(recRows.length >= 3, `despesa recorrente gerou ${recRows.length} vencimentos`);
  await A.put(`/r/recurring_expenses/${rec.id}`, { amount: 310 });
  ok((await A.get(`/r/expenses?q=Adobe&preset=abertas&limit=50`)).rows.filter((e) => e.due_date >= D(0)).every((e) => e.amount === 310), 'alterar recorrência atualiza vencimentos futuros');

  origLog('\nProposta → projeto → contrato → contas a receber');
  const pr = await A.post('/r/proposals', { client_id: c.id, title: 'Interiores Apto', amount: 42000, installments: 6, status: 'enviada', valid_until: D(10) });
  await A.put(`/r/proposals/${pr.id}`, { status: 'aprovada' });
  const conv = await A.post(`/proposals/${pr.id}/convert`, { create_contract: true, first_due_date: D(5) });
  const np = await A.get(`/r/projects/${conv.project_id}`);
  ok(np.name === 'Interiores Apto' && np.contract_value === 42000, 'projeto gerado com dados da proposta');
  const ci = (await A.get(`/r/incomes?f_contract_id=${conv.contract_id}`)).rows;
  ok(ci.length === 6 && ci.every((i) => i.status === 'previsto'), 'contrato gerou 6 parcelas "previstas" (aguardando assinatura)');
  await A.put(`/r/contracts/${conv.contract_id}`, { status: 'ativo' });
  const ci2 = (await A.get(`/r/incomes?f_contract_id=${conv.contract_id}&sort=due_date`)).rows;
  ok(ci2[0].status === 'a_receber', 'assinatura libera parcelas como "a receber"');
  await rejects(A.post(`/proposals/${pr.id}/convert`, {}), 400, 'proposta não gera projeto duas vezes');

  origLog('\nEtapas e encerramento');
  for (const ph of phases) await A.put(`/r/project_phases/${ph.id}`, { status: 'concluido' });
  const pov = await A.get(`/projects/${p.id}/overview`);
  ok(pov.project.progress === 100 && pov.all_phases_done, 'todas as etapas concluídas → 100% e sugestão de encerrar');
  automation.runAutomations(true);
  ok((await A.get('/notifications')).rows.some((n) => n.kind === 'projeto_concluido'), 'notificação sugerindo encerrar o projeto');
  await A.put(`/r/projects/${p.id}`, { status: 'encerrado' });
  await rejects(A.del(`/r/projects/${p.id}`), 400, 'projeto encerrado não pode ser excluído (arquivo)');

  origLog('\nTarefas e alertas');
  const t = await A.post('/r/tasks', { title: 'Atrasada', due_date: D(-1), project_id: conv.project_id });
  automation.runAutomations(true);
  ok((await A.get('/notifications')).rows.some((n) => n.kind === 'tarefa_atrasada'), 'alerta de tarefa atrasada');
  await A.put(`/r/tasks/${t.id}`, { status: 'concluida' });
  ok(!!(await A.get(`/r/tasks/${t.id}`)).completed_at, 'conclusão registra a data');
  automation.runAutomations(true);
  ok(!(await A.get('/notifications')).rows.some((n) => n.kind === 'tarefa_atrasada' && !n.read_at), 'alerta some quando a tarefa é concluída');

  origLog('\nPermissões');
  await A.post('/admin/users', { name: 'Colab', email: 'colab@t.com', role: 'colaborador', password: PW });
  const g = await A.post('/admin/users', { name: 'Gestor', email: 'gestor@t.com', role: 'gestor', password: PW });
  const colabId = (await A.get('/admin/users')).find((u) => u.email === 'colab@t.com').id;
  await A.post(`/admin/users/${colabId}/projects`, { project_ids: [conv.project_id] });
  const CO = client(base); await CO.post('/auth/login', { email: 'colab@t.com', password: PW });
  await rejects(CO.get('/r/incomes'), 403, 'colaborador não acessa financeiro');
  await rejects(CO.get('/r/clients'), 403, 'colaborador não acessa CRM de clientes');
  const cp = (await CO.get('/r/projects?archived=all')).rows;
  ok(cp.length === 1 && cp[0].id === conv.project_id, 'colaborador vê somente os projetos autorizados');
  ok(cp[0].contract_value === undefined, 'valor contratado oculto para quem não tem financeiro');
  await rejects(CO.get(`/r/projects/${p.id}`), 404, 'colaborador não abre projeto não autorizado');
  const ct = await CO.post('/r/tasks', { title: 'Tarefa do colaborador', project_id: conv.project_id });
  ok(ct.id > 0, 'colaborador cria tarefa em projeto autorizado');
  await rejects(CO.post('/r/tasks', { title: 'x', project_id: p.id }), 403, 'colaborador não cria tarefa em projeto não autorizado');
  const GE = client(base); await GE.post('/auth/login', { email: 'gestor@t.com', password: PW });
  await rejects(GE.get('/r/expenses'), 403, 'gestor sem autorização não vê financeiro');
  await A.put(`/admin/users/${g.id}`, { can_finance: 1 });
  await GE.post('/auth/login', { email: 'gestor@t.com', password: PW });
  ok(Array.isArray((await GE.get('/r/expenses')).rows), 'gestor autorizado passa a ver o financeiro');
  await rejects(GE.get('/admin/audit'), 403, 'gestor não acessa auditoria');

  origLog('\nÁrea do cliente');
  const c2 = await A.post('/r/clients', { name: 'Outro Cliente' });
  await A.post('/r/projects', { name: 'Projeto de outro cliente', client_id: c2.id });
  const q = await A.post('/r/quotes', { project_id: conv.project_id, item: 'Marcenaria', amount: 100000, client_visible: 1, notes: 'margem interna' });
  await A.post('/r/quotes', { project_id: conv.project_id, item: 'Marcenaria', amount: 90000, client_visible: 0 });
  await A.post('/admin/users', { name: 'Cli', email: 'cli@t.com', role: 'cliente', client_id: c.id, password: PW });
  const CL = client(base); await CL.post('/auth/login', { email: 'cli@t.com', password: PW });
  await rejects(CL.get('/r/projects'), 403, 'cliente não acessa rotas internas');
  await rejects(CL.get('/dashboard'), 403, 'cliente não acessa dashboard interno');
  const po = await CL.get('/portal/overview');
  ok(po.projects.every((x) => x.name !== 'Projeto de outro cliente'), 'cliente vê somente seus projetos');
  const pq = po.projects.find((x) => x.id === conv.project_id).quotes[0];
  ok(pq.options.length === 1 && pq.options[0].notes === undefined, 'somente orçamentos liberados, sem observações internas');
  ok(JSON.stringify(po).indexOf('margem interna') === -1 && JSON.stringify(po).indexOf('expenses') === -1, 'nenhuma informação interna no portal');
  await CL.post(`/portal/quotes/${q.id}/select`);
  ok((await A.get(`/r/quotes/${q.id}`)).client_selected === 1, 'cliente aprova orçamento pelo portal');

  origLog('\nAuditoria, pesquisa e backup');
  ok((await A.get('/admin/audit')).some((a) => a.action === 'pay'), 'alterações registradas no histórico');
  ok((await A.get('/search?q=Interiores')).results.some((r) => r.type === 'Projeto'), 'pesquisa global encontra projeto');
  const bk = await A.post('/admin/backups');
  ok(fs.existsSync(path.join(process.env.BACKUP_DIR, bk.name)), 'backup gerado');

  origLog(`\n${pass} testes passaram, ${failN} falharam.\n`);
  server.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(failN ? 1 : 0);
})().catch((e) => { origLog(e); process.exit(1); });
