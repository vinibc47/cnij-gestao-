// Testes do fluxo de documentos: proposta de honorários → aprovação → contrato
// (modelo, emissão versionada) → parcelas no financeiro (sem duplicidade) →
// lembrete de cobrança no vencimento → PDFs.   node scripts/test-docs.js
process.env.TZ = 'America/Campo_Grande';
const fs = require('fs'); const os = require('os'); const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cnij-docs-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite'); process.env.BACKUP_DIR = path.join(tmp, 'bk'); process.env.UPLOAD_DIR = path.join(tmp, 'up');
const OUT = process.env.PDF_OUT || path.join(tmp, 'pdf'); fs.mkdirSync(OUT, { recursive: true });
const origLog = console.log; console.log = (...a) => { if (!String(a[0]).includes('e-mail não enviado')) origLog(...a); };
const app = require('../server');
const automation = require('../server/services/automation');
const { run, get } = require('../server/db');
const client = require('./client');

const pad = (n) => String(n).padStart(2, '0');
const D = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
let pass = 0; let failN = 0;
const ok = (cond, msg) => { if (cond) { pass++; origLog('  ✓', msg); } else { failN++; origLog('  ✗', msg); } };
const rejects = async (p, status, msg) => { try { await p; ok(false, msg + ' (deveria falhar)'); } catch (e) { ok(!status || e.status === status, `${msg} → ${e.status}${e.data && e.data.problems ? ' (' + e.data.problems.length + ' pendência[s])' : ''}`); return e; } };

(async () => {
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const A = client(base); const PW = 'Teste1234';
  const savePdf = async (url, name) => {
    const r = await A.file(url); const buf = Buffer.from(await r.arrayBuffer());
    ok(r.status === 200 && r.headers.get('content-type') === 'application/pdf' && buf.slice(0, 5).toString() === '%PDF-', `PDF gerado: ${name} (${Math.round(buf.length / 1024)} KB)`);
    fs.writeFileSync(path.join(OUT, name), buf); return buf;
  };
  await A.post('/setup', { name: 'Irineu', email: 'admin@t.com', password: PW });
  await A.post('/auth/login', { email: 'admin@t.com', password: PW });

  origLog('\nConfigurações do escritório');
  await A.put('/admin/settings', { office_pix_key: '00.000.000/0001-00', office_pix_type: 'CNPJ', office_pix_name: 'Escritório Exemplo', office_pix_bank: 'Banco Exemplo',
    contractor_name: 'Contratado Exemplo', contractor_doc: '000.000.000-00', contractor_address: 'Rua Exemplo, 100, Campo Grande – MS', contractor_registry: 'Arquiteto – CAU BR A000000-0' });
  const tpls = await A.get('/doc-templates');
  ok(tpls.rows.length === 10, '10 modelos criados (5 propostas + 5 contratos)');
  ok(tpls.rows.find((t) => t.kind === 'contrato' && t.service_type === 'interiores').status === 'configurado', 'contrato de interiores configurado a partir do modelo enviado');
  ok(tpls.rows.find((t) => t.kind === 'contrato' && t.service_type === 'acompanhamento').status === 'pendente', 'contrato de acompanhamento marcado como pendente');

  origLog('\nProposta de honorários (Orçamento de obra)');
  const cli = await A.post('/r/clients', { name: 'Cliente Exemplo Ltda', person_type: 'PJ', doc: '11.222.333/0001-44', whatsapp: '(67) 99999-0000', address: 'Rua das Flores, 10', city: 'Campo Grande', state: 'MS', zip: '79000-000' });
  let pr = await A.post('/honorarios', { client_id: cli.id, title: 'Projeto de interiores corporativo', service_type: 'interiores', contact_name: 'Sr. Exemplo', work_type: 'corporativo', area: 65,
    summary: 'Desenvolvimento de projeto de interiores para escritório corporativo com área aproximada de 65 m².', scope: 'Desenvolvimento de layout\nReadequação da recepção\nProjeto luminotécnico' });
  ok(/^\d{3}_\d{4}$/.test(pr.number) && pr.status === 'elaboracao', `proposta criada como rascunho nº ${pr.number}`);
  ok(pr.body.includes('Estudo volumétrico 3D') && pr.stages.length === 6, 'texto e prazos padrão do modelo de interiores aplicados');
  ok(pr.pix_key === '00.000.000/0001-00', 'chave Pix reaproveitada das configurações');
  await rejects(A.get(`/pdf/proposal/${pr.id}`), 400, 'PDF bloqueado sem valor e parcelas');
  pr = await A.put(`/honorarios/${pr.id}`, { amount: 8000, down_payment: 3000, payment_plan: [{ label: 'Entrada', due_date: D(0), amount: 3000 }, { label: 'Parcela', due_date: D(30), amount: 2500 }, { label: 'Parcela', due_date: D(60), amount: 2400 }] });
  ok(!pr.plan_check.ok && Math.abs(pr.plan_check.diff - 100) < 0.01, 'conferência aponta diferença de R$ 100,00 entre total e parcelas');
  const chk = await A.get(`/pdf/proposal/${pr.id}?check=1`);
  ok(!chk.ok && chk.problems.some((p) => /não confere/.test(p)), 'validação lista a diferença antes da emissão');
  await savePdf(`/pdf/proposal/${pr.id}?draft=1`, 'proposta-rascunho.pdf');
  pr = await A.put(`/honorarios/${pr.id}`, { payment_plan: [{ label: 'Entrada', due_date: D(0), amount: 3000 }, { label: 'Parcela', due_date: D(30), amount: 2500 }, { label: 'Parcela', due_date: D(60), amount: 2500 }] });
  ok(pr.plan_check.ok && pr.installments === 3, 'parcelas ajustadas conferem com o total');
  await savePdf(`/pdf/proposal/${pr.id}`, 'proposta.pdf');
  const dup = await A.post(`/honorarios/${pr.id}/duplicate`);
  ok(dup.number !== pr.number && dup.status === 'elaboracao' && dup.amount === 8000, `proposta duplicada como ${dup.number}`);
  await A.post(`/honorarios/${pr.id}/status`, { status: 'enviada' });
  await rejects(A.post(`/honorarios/${pr.id}/status`, { status: 'aprovada' }), 400, 'aprovação exige informar quem aprovou');
  pr = await A.post(`/honorarios/${pr.id}/status`, { status: 'aprovada', approved_by: 'Sr. Exemplo (WhatsApp)', approved_at: D(0) });
  ok(pr.status === 'aprovada' && pr.approved_user_id, 'aprovação registrada com data, responsável e usuário');

  origLog('\nParcelas no financeiro (proposta aprovada)');
  const prev = await A.post('/plan-receivables', { source: 'proposal', id: pr.id });
  ok(prev.to_create === 3 && prev.already === 0, 'prévia: 3 parcelas a cadastrar');
  const cr = await A.post('/plan-receivables', { source: 'proposal', id: pr.id, confirm: true });
  ok(cr.created === 3, '3 parcelas cadastradas em Entradas');
  const again = await A.post('/plan-receivables', { source: 'proposal', id: pr.id, confirm: true });
  ok(again.created === 0 && again.already === 3, 'segunda tentativa não duplica as parcelas');

  origLog('\nContrato a partir da proposta');
  const proj = await A.post(`/honorarios/${pr.id}/project`);
  ok(proj.project_id > 0, 'projeto criado a partir da proposta');
  const { id: ctId } = await A.post(`/honorarios/${pr.id}/contract`);
  let ct = await A.get(`/contract-docs/${ctId}`);
  ok(ct.amount === 8000 && ct.payment_plan.length === 3 && ct.data.contratante_nome === 'Cliente Exemplo Ltda' && ct.data.contratado_nome === 'Contratado Exemplo', 'contrato reaproveita cliente, escritório, valores e parcelas');
  ok(ct.receivables === 3 && ct.project_id === proj.project_id, 'parcelas já cadastradas vinculadas ao contrato, sem duplicar');
  await rejects(A.post(`/honorarios/${pr.id}/contract`), 409, 'segundo contrato para a mesma proposta pede confirmação');
  const issue0 = await rejects(A.post(`/contract-docs/${ctId}/issue`), 400, 'emissão bloqueada sem data de entrega (campo do modelo)');
  ok(issue0 && issue0.data.problems.some((p) => /Data de entrega/.test(p)), 'pendência aponta o campo "Data de entrega (prazo)"');
  await savePdf(`/pdf/contract/${ctId}`, 'contrato-rascunho.pdf');
  ct = await A.put(`/contract-docs/${ctId}`, { data: { prazo_data: D(30), objeto: 'Prestação de serviços de arquitetura de interiores para escritório corporativo com área aproximada de 65 m².' } });
  const iss = await A.post(`/contract-docs/${ctId}/issue`);
  ok(iss.version === 1, 'contrato emitido — versão 1');
  const pdf1 = await savePdf(`/pdf/contract-issue/${iss.issue_id}`, 'contrato-v1.pdf');
  const tInt = tpls.rows.find((t) => t.kind === 'contrato' && t.service_type === 'interiores');
  const full = await A.get(`/doc-templates/${tInt.id}`);
  await A.put(`/doc-templates/${tInt.id}`, { body: full.body.replace('7.1.4. O projeto será entregue em arquivos salvos em **PDF**.', '7.1.4. TEXTO ALTERADO NO MODELO.') });
  const pdf1b = await savePdf(`/pdf/contract-issue/${iss.issue_id}`, 'contrato-v1-depois-do-modelo.pdf');
  ok(pdf1.length === pdf1b.length, 'emissão anterior não muda quando o modelo é alterado');
  ct = await A.get(`/contract-docs/${ctId}`);
  ok(ct.template_outdated && !ct.body.includes('TEXTO ALTERADO'), 'contrato mantém o texto da versão usada e avisa que há versão nova do modelo');
  const iss2 = await A.post(`/contract-docs/${ctId}/issue`);
  ok(iss2.version === 2 && (await A.get(`/contract-docs/${ctId}`)).issues.length === 2, 'nova emissão gera versão 2, mantendo a 1');
  const gen = await A.post('/plan-receivables', { source: 'contract', id: ctId, confirm: true });
  ok(gen.created === 0 && gen.already === 3, 'gerar parcelas pelo contrato reconhece as existentes');
  const { id: ct2 } = await A.post('/contracts/from-template', { service_type: 'acompanhamento', client_id: cli.id });
  await A.put(`/contract-docs/${ct2}`, { amount: 1000, payment_plan: [{ label: 'Parcela única', due_date: D(5), amount: 1000 }], data: { objeto: 'Acompanhamento', localizacao: 'Rua X', periodicidade: 'Quinzenal', visitas: '4', periodo_inicio: D(0), periodo_fim: D(60), cobranca: 'Mensal' } });
  const pend = await rejects(A.post(`/contract-docs/${ct2}/issue`), 400, 'modelo pendente não pode ser emitido');
  ok(pend && pend.data.problems.some((p) => /PENDENTE/.test(p)), 'mensagem indica texto [PENDENTE] do modelo');

  origLog('\nLembretes de cobrança (WhatsApp)');
  automation.runAutomations(true);
  let rem = await A.get('/reminders');
  ok(rem.open.length === 1 && rem.open[0].due_date === D(0), 'lembrete criado para a parcela que vence hoje');
  const m = rem.open[0].message;
  ok(m.includes('Olá, Cliente Exemplo Ltda!') && m.includes(`hoje, ${D(0).split('-').reverse().join('/')}`) && m.includes('parcela 1/3') && m.includes('R$ 3.000,00') && m.includes('Chave: 00.000.000/0001-00') && m.includes('Favorecido: Escritório Exemplo'), 'mensagem com cliente, data, parcela, valor, chave e favorecido');
  ok(rem.open[0].phone === '5567999990000', 'telefone do cliente pronto para o WhatsApp (55 + DDD)');
  automation.runAutomations(true); automation.runAutomations(true);
  ok((await A.get('/reminders')).open.length === 1, 'sem lembretes duplicados para a mesma parcela');
  const edited = await A.put(`/reminders/${rem.open[0].id}`, { message: 'Mensagem editada' });
  ok(edited.message === 'Mensagem editada' && edited.edited, 'mensagem editável');
  const sent = await A.post(`/reminders/${rem.open[0].id}/sent`);
  ok(sent.status === 'enviado', 'marcado como enviado pelo usuário');
  const inc = get('SELECT status FROM incomes WHERE id = ?', rem.open[0].income_id);
  ok(inc.status !== 'recebido', 'marcar como enviado não baixa a parcela como paga');
  // parcela vencida: texto sem "vence hoje"
  const late = await A.post('/r/incomes', { description: 'Honorários antigos', client_id: cli.id, amount: 500, due_date: D(-3) });
  automation.runAutomations(true);
  rem = await A.get('/reminders');
  const lr = rem.open.find((r) => r.income_id === late.id);
  ok(lr && lr.overdue && !lr.message.includes('vence a parcela') && !/hoje/.test(lr.message) && lr.message.includes(`vencimento em ${D(-3).split('-').reverse().join('/')}`), 'lembrete vencido informa a data de vencimento, sem "vence hoje"');
  await A.post(`/finance/incomes/${late.id}/pay`, {});
  automation.runAutomations(true);
  ok(!(await A.get('/reminders')).open.find((r) => r.income_id === late.id), 'parcela paga deixa de ter lembrete pendente');
  const canc = await A.post('/r/incomes', { description: 'Cancelada', client_id: cli.id, amount: 200, due_date: D(-1), status: 'cancelado' });
  automation.runAutomations(true);
  ok(!(await A.get('/reminders')).open.find((r) => r.income_id === canc.id), 'parcela cancelada não gera lembrete');
  const fut = await A.post('/r/incomes', { description: 'Futura', client_id: cli.id, amount: 200, due_date: D(10) });
  automation.runAutomations(true);
  ok(!(await A.get('/reminders')).open.find((r) => r.income_id === fut.id), 'parcela futura ainda não gera lembrete');

  origLog('\nInformações gerais da obra, orçamento e etapas');
  const pid = proj.project_id;
  const si0 = await A.get(`/projects/${pid}/site-info`);
  ok(si0.info._new && si0.client.name === 'Cliente Exemplo Ltda', 'ficha nova com cliente e projeto do cadastro');
  await rejects(A.get(`/pdf/site-info/${pid}`), 400, 'relatório exige salvar a ficha antes');
  const si = await A.put(`/projects/${pid}/site-info`, { address: 'Rua das Flores, 10', responsible_id: 1, updated_on: D(0), situation: 'em_andamento', summary: 'Obra em andamento.\nDemolição concluída.',
    executives: [{ nome: 'Planta layout', situacao: 'entregue', revisao: 'R01', entrega: D(-5) }, { nome: 'Planta elétrica', situacao: 'em_elaboracao', revisao: 'R00', entrega: '' }],
    pending_project: [{ descricao: 'Detalhe da marcenaria da recepção', responsavel: 'Escritório', prazo: D(7), situacao: 'aberta' }],
    pending_execution: [{ descricao: 'Instalar pontos elétricos', responsavel: 'Eletricista', prazo: D(10), situacao: 'aberta' }],
    approvals: [{ descricao: 'Aprovar revestimento do piso', responsavel: 'Cliente', prazo: D(3), situacao: 'pendente' }],
    next_steps: [{ descricao: 'Gesso e iluminação', inicio: D(12), conclusao: D(25), responsavel: 'Gesseiro' }], notes: 'Sem observações.' });
  ok(si.info.executives_status === 'parcial' && si.info.executives.length === 2, 'situação dos executivos calculada: parcialmente entregues');
  await savePdf(`/pdf/site-info/${pid}`, 'relatorio-obra.pdf');
  const work = await A.post('/r/works', { project_id: pid, name: 'Obra Exemplo', address: 'Rua das Flores, 10' });
  const b = await A.put(`/works/${work.id}/budget`, { items: [{ group_name: 'Marcenaria', item: 'Painel ripado', description: 'MDF freijó', qty: 12.5, unit: 'm²', unit_price: 380 }, { group_name: 'Marcenaria', item: 'Balcão', qty: 1, unit: 'un', unit_price: 5200 },
    { group_name: 'Iluminação', item: 'Perfil de LED', qty: 20, unit: 'm', unit_price: 95.5 }], budget_notes: 'Valores sujeitos a confirmação dos fornecedores.', apply_total: true });
  ok(b.total === 11860 && (await A.get(`/r/works/${work.id}`)).budget === 11860, 'orçamento de execução com subtotais e total aplicado à obra');
  await savePdf(`/pdf/work-budget/${work.id}`, 'orcamento-execucao.pdf');
  const ph = (await A.get(`/r/work_phases?f_work_id=${work.id}`)).rows[0];
  await A.put(`/r/work_phases/${ph.id}`, { responsible: 'Construtora', pending: 'Retirada de entulho', next_action: 'Iniciar alvenaria', progress: 50 });
  await savePdf(`/pdf/work-phases/${work.id}`, 'etapas-obra.pdf');

  origLog('\nPermissões');
  const col = await A.post('/admin/users', { name: 'Colab', email: 'col@t.com', role: 'colaborador', password: PW });
  const B = client(base); await B.post('/auth/login', { email: 'col@t.com', password: PW });
  await rejects(B.get(`/honorarios/${pr.id}`), 403, 'colaborador não acessa propostas');
  await rejects(B.get('/reminders'), 403, 'colaborador não acessa lembretes de cobrança');
  await rejects(B.get(`/pdf/contract-issue/${iss.issue_id}`), 403, 'colaborador não acessa contratos');
  const pc = await A.post('/admin/users', { name: 'Portal', email: 'cli@t.com', role: 'cliente', client_id: cli.id, password: PW });
  const Cc = client(base); await Cc.post('/auth/login', { email: 'cli@t.com', password: PW });
  await rejects(Cc.get(`/pdf/proposal/${pr.id}`), 403, 'cliente (portal) não acessa PDFs internos');
  const portal = await Cc.get('/portal/overview');
  ok(!JSON.stringify(portal).includes('contract_issues') && !(portal.documents || []).length, 'nada publicado automaticamente no portal do cliente');

  server.close();
  origLog(`\n${pass} testes ok, ${failN} falha(s). PDFs em ${OUT}\n`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { origLog(e); process.exit(1); });
