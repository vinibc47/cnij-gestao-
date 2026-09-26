// =====================================================================
// Dados de DEMONSTRAÇÃO (opcional) — para conhecer o sistema antes de
// cadastrar os dados reais. Use em um banco separado:
//   DB_FILE=data/demo.sqlite npm run demo
// Todos os nomes são fictícios. Senha de todos os usuários: Demo1234
// =====================================================================
process.env.TZ = process.env.TZ || 'America/Cuiaba';
const path = require('path');
if (!process.env.DB_FILE) process.env.DB_FILE = path.join(__dirname, '..', 'data', 'demo.sqlite');
const app = require('../server');
const { val } = require('../server/db');
const client = require('./client');

const pad = (n) => String(n).padStart(2, '0');
const D = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const M = (months, day = 10) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + months); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(Math.min(day, last))}`; };

(async () => {
  if (val('SELECT COUNT(*) FROM users') > 0 && !process.argv.includes('--force')) {
    console.log(`O banco ${process.env.DB_FILE} já possui usuários. Use outro DB_FILE ou --force.`); process.exit(1);
  }
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const api = client(base);
  const PW = 'Demo1234';
  await api.post('/setup', { name: 'Irineu Junior', email: 'irineu@demo.com.br', password: PW });
  await api.post('/auth/login', { email: 'irineu@demo.com.br', password: PW });
  const me = (await api.get('/auth/me')).user;
  await api.put('/admin/settings', { opening_balance: 95000, opening_balance_date: M(-7, 1), office_email: 'contato@demo.com.br', office_phone: '(65) 3000-0000' });
  await api.put(`/admin/users/${me.id}`, { job_title: 'Arquiteto · sócio', hourly_cost: 180, color: '#111111' });
  const U = {};
  for (const [k, name, email, role, extra] of [
    ['carla', 'Carla Nogueira', 'carla@demo.com.br', 'admin', { job_title: 'Arquiteta · sócia', hourly_cost: 180, color: '#8a7560' }],
    ['marina', 'Marina Azevedo', 'marina@demo.com.br', 'gestor', { job_title: 'Coordenadora de projetos', can_finance: 1, hourly_cost: 95, color: '#5f7a6e' }],
    ['pedro', 'Pedro Lacerda', 'pedro@demo.com.br', 'colaborador', { job_title: 'Arquiteto', hourly_cost: 70, color: '#4f6b85' }],
    ['julia', 'Júlia Moraes', 'julia@demo.com.br', 'estagiario', { job_title: 'Estagiária', hourly_cost: 25, color: '#9a6b5b' }],
  ]) { const r = await api.post('/admin/users', { name, email, role, password: PW, ...extra }); U[k] = r.id; }
  U.irineu = me.id;

  // Fornecedores
  const S = {};
  for (const [k, company, category, contact, city] of [
    ['marc1', 'Atelier Madeira Nobre', 'Marcenaria', 'Rogério', 'Cuiabá'], ['marc2', 'Marcenaria Linha Reta', 'Marcenaria', 'Fábio', 'Várzea Grande'], ['marc3', 'Studio Móveis Planejados', 'Marcenaria', 'Tânia', 'Cuiabá'],
    ['marm', 'Marmoraria Pedra Viva', 'Marmoraria', 'Sérgio', 'Cuiabá'], ['ilu', 'Luce Iluminação', 'Iluminação', 'Paula', 'Cuiabá'], ['gesso', 'Gesso & Forma', 'Gesso', 'Antônio', 'Cuiabá'],
    ['ele', 'Voltz Instalações Elétricas', 'Elétrica', 'Marcos', 'Cuiabá'], ['vid', 'Vidraçaria Cristal', 'Vidraçaria', 'Luciana', 'Cuiabá'], ['cort', 'Casa das Cortinas', 'Cortinas', 'Renata', 'Cuiabá'], ['imp', 'Plotagem Express', 'Impressão', 'Diego', 'Cuiabá'],
  ]) { S[k] = (await api.post('/r/suppliers', { company, category, contact, city, whatsapp: '(65) 9' + Math.floor(1000 + Math.random() * 8999) + '-' + Math.floor(1000 + Math.random() * 8999), rt_percent: category === 'Marcenaria' ? 10 : null })).id; }

  // Clientes
  const C = {};
  for (const [k, name, profession, origin, city] of [
    ['helena', 'Helena e Ricardo Prado', 'Médicos', 'Indicação de cliente', 'Cuiabá'], ['bruno', 'Bruno Carvalho', 'Empresário', 'Instagram', 'Cuiabá'],
    ['clinica', 'Clínica Sorriso Pleno', 'Odontologia', 'Indicação de fornecedor', 'Cuiabá'], ['ana', 'Ana Beatriz Lemos', 'Advogada', 'Instagram', 'Chapada dos Guimarães'],
    ['grupo', 'Grupo Horizonte Participações', 'Holding', 'Site', 'Cuiabá'], ['lucas', 'Lucas e Fernanda Tavares', 'Engenheiro / Designer', 'Indicação de cliente', 'Várzea Grande'],
  ]) { C[k] = (await api.post('/r/clients', { name, profession, origin, city, whatsapp: '(65) 99' + Math.floor(100 + Math.random() * 899) + '-' + Math.floor(1000 + Math.random() * 8999), email: `${k}@exemplo.com`, person_type: k === 'clinica' || k === 'grupo' ? 'PJ' : 'PF' })).id; }

  // Propostas
  const prop = async (client_id, title, project_type, area, amount, installments, sent, status, extra = {}) => (await api.post('/r/proposals', { client_id, title, project_type, area, amount, installments, sent_at: sent, valid_until: sent ? D(sent === D(-3) ? 12 : 20) : null, status, responsible_id: U.carla, city: 'Cuiabá', ...extra })).id;
  const pHelena = await prop(C.helena, 'Residência Prado — arquitetura e interiores', 'Residencial', 420, 96000, 8, M(-6, 5), 'enviada');
  const pBruno = await prop(C.bruno, 'Apartamento Carvalho — interiores', 'Interiores', 180, 42000, 6, M(-4, 3), 'enviada');
  const pClin = await prop(C.clinica, 'Clínica Sorriso Pleno — reforma', 'Clínica', 260, 58000, 5, M(-3, 12), 'enviada');
  const pAna = await prop(C.ana, 'Casa de campo Lemos', 'Arquitetura', 310, 72000, 6, D(-3), 'negociacao');
  await prop(C.grupo, 'Escritório corporativo Horizonte', 'Corporativo', 650, 138000, 10, D(-9), 'enviada');
  await prop(C.lucas, 'Área gourmet Tavares', 'Reforma', 60, 14500, 2, M(-2, 2), 'recusada', { refusal_reason: 'Orçamento acima do previsto' });
  await prop(C.bruno, 'Consultoria de decoração — escritório', 'Consultoria', 40, 6800, 1, null, 'elaboracao');

  // Aprovar e converter 3 propostas em projeto + contrato (gera parcelas)
  const conv = async (id, firstDue) => { await api.put(`/r/proposals/${id}`, { status: 'aprovada' }); return api.post(`/proposals/${id}/convert`, { create_contract: true, first_due_date: firstDue, payment_method: 'pix', manager_id: U.carla }); };
  const rHelena = await conv(pHelena, M(-5, 10));
  const rBruno = await conv(pBruno, M(-3, 15));
  const rClin = await conv(pClin, M(-2, 5));
  // Assinar contratos
  for (const r of [rHelena, rBruno]) await api.put(`/r/contracts/${r.contract_id}`, { status: 'ativo', signed_at: M(-5, 8) });
  await api.put(`/r/contracts/${rClin.contract_id}`, { status: 'ativo', signed_at: M(-2, 3) });

  // Ajustes nos projetos
  await api.put(`/r/projects/${rHelena.project_id}`, { due_date: D(40), start_date: M(-5, 10), address: 'Rua das Palmeiras, 180 — Jardim Itália', member_ids: [U.carla, U.pedro, U.julia], manager_id: U.carla, status: 'em_obra' });
  await api.put(`/r/projects/${rBruno.project_id}`, { due_date: D(5), start_date: M(-3, 15), address: 'Av. Miguel Sutil, 3200 — ap. 1402', member_ids: [U.irineu, U.pedro], manager_id: U.irineu });
  await api.put(`/r/projects/${rClin.project_id}`, { due_date: D(-4), start_date: M(-2, 5), address: 'Av. Historiador Rubens de Mendonça, 1500', member_ids: [U.marina, U.julia], manager_id: U.marina, status: 'aguardando_cliente' });
  const pAnt = (await api.post('/r/projects', { name: 'Loja Conceito Vértice', client_id: C.grupo, type: 'Comercial', area: 140, contract_value: 38000, contracted_at: M(-10, 4), start_date: M(-10, 4), due_date: M(-3, 20), manager_id: U.irineu, member_ids: [U.irineu, U.marina], city: 'Cuiabá' })).id;

  // Etapas: avança conforme o projeto
  const advance = async (projectId, doneCount, currentStatus = 'em_andamento') => {
    const { rows } = await api.get(`/r/project_phases?f_project_id=${projectId}&sort=position`);
    for (const [i, ph] of rows.entries()) {
      const due = D(-60 + i * 12);
      if (i < doneCount) await api.put(`/r/project_phases/${ph.id}`, { status: 'concluido', due_date: due, responsible_id: U.pedro });
      else if (i === doneCount) await api.put(`/r/project_phases/${ph.id}`, { status: currentStatus, due_date: D(3), responsible_id: U.pedro });
      else await api.put(`/r/project_phases/${ph.id}`, { due_date: D(10 + i * 7) });
    }
    return rows;
  };
  const phH = await advance(rHelena.project_id, 9);
  await advance(rBruno.project_id, 4, 'revisao');
  await advance(rClin.project_id, 3, 'aguardando_cliente');
  const phAnt = await api.get(`/r/project_phases?f_project_id=${pAnt}`);
  for (const ph of phAnt.rows) await api.put(`/r/project_phases/${ph.id}`, { status: 'concluido' });
  await api.put(`/r/projects/${pAnt}`, { status: 'encerrado' });

  // Checklist em uma etapa
  const ex = phH[4];
  for (const t of ['Plantas de layout', 'Planta de forro', 'Pontos elétricos', 'Detalhamento de marcenaria', 'Paginação de piso']) await api.post(`/checklist/project_phases/${ex.id}`, { text: t });

  // Recebimentos: marca parcelas antigas como pagas (uma fica vencida)
  const inc = (await api.get('/r/incomes?limit=500&sort=due_date')).rows;
  const today = D(0);
  let leftOverdue = 0;
  for (const i of inc) {
    if (i.due_date < today) {
      if (i.project_id === rClin.project_id && leftOverdue < 1) { leftOverdue++; continue; }
      await api.post(`/finance/incomes/${i.id}/pay`, { paid_at: i.due_date, method: 'pix' });
    }
  }
  // Recebimentos avulsos (anteprojeto antigo, RT)
  for (let m = -9; m <= -6; m++) await api.post('/r/incomes', { description: `Loja Conceito Vértice — parcela ${m + 10}/4`, client_id: C.grupo, project_id: pAnt, category: 'Projeto de arquitetura', amount: 9500, due_date: M(m, 10), paid_at: M(m, 10), method: 'transferencia' });
  await api.post('/r/incomes', { description: 'RT — Atelier Madeira Nobre (Residência Prado)', supplier_id: S.marc1, project_id: rHelena.project_id, category: 'Reserva técnica (RT)', amount: 10500, due_date: D(-8), paid_at: D(-8), method: 'pix' });
  await api.post('/finance/installments', { table: 'incomes', description: 'Acompanhamento de obra — Residência Prado', client_id: C.helena, project_id: rHelena.project_id, category: 'Acompanhamento de obra', method: 'boleto', total: 18000, count: 6, first_due: M(0, 20) });

  // Despesas recorrentes
  for (const [description, category, amount, day] of [['Aluguel do escritório', 'Aluguel', 6800, 5], ['Adobe Creative Cloud', 'Softwares', 290, 12], ['SketchUp Pro', 'Softwares', 210, 15], ['Autodesk AutoCAD', 'Softwares', 480, 15], ['Internet e telefone', 'Internet e telefone', 390, 20], ['Contabilidade', 'Contabilidade', 1200, 10], ['Servidor e backup em nuvem', 'Softwares', 160, 25], ['Salários da equipe', 'Salários', 9800, 5]]) {
    await api.post('/r/recurring_expenses', { description, category, amount, day, method: 'debito_auto', start_date: M(-7, 1) });
  }
  // Marca recorrências passadas como pagas
  const exps = (await api.get('/r/expenses?limit=1000')).rows;
  for (const e of exps) if (e.due_date < today) await api.post(`/finance/expenses/${e.id}/pay`, { paid_at: e.due_date });

  // Obra
  const work = await api.post('/r/works', { project_id: rHelena.project_id, name: 'Obra Residência Prado', start_date: M(-2, 1), due_date: D(75), responsible_id: U.pedro, budget: 420000, status: 'em_andamento' });
  const wph = (await api.get(`/r/work_phases?f_work_id=${work.id}&sort=position`)).rows;
  const prog = [100, 100, 90, 80, 60, 30, 20, 0, 10, 0, 0, 0, 0, 0, 0, 0];
  for (const [i, p] of wph.entries()) await api.put(`/r/work_phases/${p.id}`, { progress: prog[i] || 0, supplier_id: p.name === 'Elétrica' ? S.ele : p.name === 'Gesso' ? S.gesso : p.name === 'Marcenaria' ? S.marc1 : p.name === 'Iluminação' ? S.ilu : null });
  // Orçamentos de marcenaria e marmoraria
  const q1 = await api.post('/r/quotes', { project_id: rHelena.project_id, work_id: work.id, item: 'Marcenaria', supplier_id: S.marc1, amount: 120000, deadline_days: 45, client_visible: 1, client_notes: 'Inclui cozinha, closet e painéis da sala.' });
  await api.post('/r/quotes', { project_id: rHelena.project_id, work_id: work.id, item: 'Marcenaria', supplier_id: S.marc2, amount: 105000, deadline_days: 60, client_visible: 1 });
  await api.post('/r/quotes', { project_id: rHelena.project_id, work_id: work.id, item: 'Marcenaria', supplier_id: S.marc3, amount: 112000, deadline_days: 50, client_visible: 1, status: 'negociacao' });
  await api.post('/r/quotes', { project_id: rHelena.project_id, work_id: work.id, item: 'Marmoraria', supplier_id: S.marm, amount: 38500, deadline_days: 20 });
  const qIlu = await api.post('/r/quotes', { project_id: rHelena.project_id, work_id: work.id, item: 'Iluminação', supplier_id: S.ilu, amount: 27800, status: 'aprovado' });
  await api.post(`/quotes/${qIlu.id}/to-expense`, { total: 27800, count: 2, first_due: D(-15), paid_by: 'cliente' });
  // Gastos da obra pagos pelo escritório
  for (const [description, supplier_id, amount, due, paid] of [['Gesso — forro e sancas (sinal)', S.gesso, 8400, D(-20), true], ['Elétrica — mão de obra etapa 1', S.ele, 12600, D(-12), true], ['Material elétrico complementar', S.ele, 2350, D(2), false], ['Plotagem de pranchas executivas', S.imp, 480, D(-30), true]]) {
    const e = await api.post('/r/expenses', { description, supplier_id, amount, due_date: due, project_id: rHelena.project_id, work_id: supplier_id === S.imp ? null : work.id, category: supplier_id === S.imp ? 'Impressão' : 'Obra', responsible_id: U.pedro });
    if (paid) await api.post(`/finance/expenses/${e.id}/pay`, { paid_at: due });
  }
  await api.post('/r/expenses', { description: 'Plotagem — apresentação clínica', supplier_id: S.imp, amount: 320, due_date: D(0), project_id: rClin.project_id, category: 'Impressão' });
  await api.post('/r/expenses', { description: 'Taxa RRT — Residência Prado', amount: 119.61, due_date: D(-40), paid_at: D(-40), project_id: rHelena.project_id, category: 'RRT / ART' });
  // Diário de obra
  const log1 = await api.post('/r/work_logs', { work_id: work.id, date: D(-10), kind: 'visita', user_id: U.pedro, description: 'Visita técnica com o eletricista. Conferidos pontos da cozinha e suíte master.', decisions: 'Cliente aprovou mudança do ponto da TV da sala para a parede oposta.', pending: 'Enviar novo detalhamento do painel da sala.', suppliers_present: [S.ele], client_visible: 1 });
  await api.post('/r/work_logs', { work_id: work.id, date: D(-3), kind: 'problema', user_id: U.carla, description: 'Identificada infiltração na laje do banheiro social.', problems: 'Infiltração próxima ao shaft hidráulico.', decisions: 'Construtora fará impermeabilização antes do gesso.', pending: 'Reagendar equipe de gesso.', suppliers_present: [S.gesso] });
  await api.post('/r/work_logs', { work_id: work.id, date: D(-1), kind: 'registro', user_id: U.pedro, description: 'Gesso da área social finalizado. Início do forro dos quartos.', client_visible: 1 });

  // Tarefas
  const T = [
    ['Revisar detalhamento do painel da sala', rHelena.project_id, U.pedro, 'alta', D(-2), 'em_andamento'],
    ['Enviar prancha de marcenaria para orçamento', rHelena.project_id, U.julia, 'normal', D(1), 'pendente'],
    ['Apresentação do anteprojeto — clínica', rClin.project_id, U.marina, 'urgente', D(0), 'em_andamento'],
    ['Aguardar aprovação do layout pelo cliente', rClin.project_id, U.marina, 'normal', D(3), 'aguardando'],
    ['Compatibilizar projeto elétrico', rBruno.project_id, U.pedro, 'alta', D(-5), 'pendente'],
    ['Especificar revestimentos dos banheiros', rBruno.project_id, U.julia, 'normal', D(4), 'pendente'],
    ['Emitir RRT do projeto executivo', rBruno.project_id, U.irineu, 'alta', D(2), 'pendente'],
    ['Visita de medição — casa de campo', null, U.carla, 'normal', D(6), 'pendente'],
    ['Atualizar portfólio no site', null, U.julia, 'baixa', D(14), 'pendente'],
    ['Conferir notas fiscais do mês', null, U.marina, 'normal', D(5), 'pendente'],
    ['Renderizar sala de estar', rHelena.project_id, U.julia, 'normal', D(-12), 'concluida'],
    ['Reunião de alinhamento com a construtora', rHelena.project_id, U.carla, 'alta', D(-6), 'concluida'],
  ];
  for (const [title, project_id, assignee_id, priority, due_date, status] of T) {
    const t = await api.post('/r/tasks', { title, project_id, assignee_id, priority, due_date, status });
    if (title.startsWith('Revisar')) { for (const c of ['Ajustar cotas', 'Rever nicho da TV', 'Enviar ao cliente']) await api.post(`/checklist/tasks/${t.id}`, { text: c }); await api.post(`/comments/tasks/${t.id}`, { body: 'Cliente pediu para manter o ripado em freijó.' }); }
  }
  // Agenda
  const ev = async (title, type, day, hh, extra = {}) => api.post('/r/events', { title, type, start_at: `${D(day)}T${hh}`, end_at: `${D(day)}T${String(Number(hh.slice(0, 2)) + 1).padStart(2, '0')}${hh.slice(2)}`, ...extra });
  await ev('Apresentação do anteprojeto', 'apresentacao', 0, '15:00', { client_id: C.clinica, project_id: rClin.project_id, location: 'Escritório', user_ids: [U.marina, U.carla] });
  await ev('Visita técnica — obra Prado', 'visita_tecnica', 1, '09:00', { project_id: rHelena.project_id, work_id: work.id, location: 'Rua das Palmeiras, 180', user_ids: [U.pedro, U.carla], client_visible: 1 });
  await ev('Reunião de briefing — casa de campo', 'reuniao', 3, '10:30', { client_id: C.ana, location: 'Chapada dos Guimarães', user_ids: [U.carla, U.irineu] });
  await ev('Entrega do executivo — Apto Carvalho', 'entrega', 5, '14:00', { client_id: C.bruno, project_id: rBruno.project_id, user_ids: [U.irineu] });
  await ev('Reunião interna de planejamento', 'interno', 7, '08:30', { user_ids: [U.irineu, U.carla, U.marina, U.pedro, U.julia] });
  const past = await ev('Reunião de apresentação do estudo', 'reuniao', -20, '16:00', { client_id: C.bruno, project_id: rBruno.project_id, user_ids: [U.irineu], minutes: 'Cliente aprovou o estudo preliminar com ajustes na cozinha.' });
  await api.put(`/r/events/${past.id}`, { status: 'realizado' });
  // Horas
  for (const [user_id, project_id, hours, d] of [[U.pedro, rHelena.project_id, 42, -20], [U.julia, rHelena.project_id, 30, -15], [U.carla, rHelena.project_id, 26, -10], [U.irineu, rBruno.project_id, 18, -12], [U.pedro, rBruno.project_id, 34, -8], [U.marina, rClin.project_id, 22, -6], [U.julia, rClin.project_id, 16, -4]]) {
    await api.post('/r/time_entries', { user_id, project_id, hours, date: D(d), description: 'Desenvolvimento do projeto' });
  }
  // Avaliações
  await api.post('/r/supplier_reviews', { supplier_id: S.marc1, project_id: pAnt, rating: 5, comment: 'Acabamento impecável e prazo cumprido.' });
  await api.post('/r/supplier_reviews', { supplier_id: S.gesso, project_id: rHelena.project_id, rating: 4, comment: 'Bom trabalho, atrasou 3 dias.' });
  // Interações
  await api.post('/r/client_interactions', { client_id: C.helena, date: D(-2), type: 'whatsapp', description: 'Cliente pediu opções de puxadores para a cozinha.' });
  await api.post('/r/client_interactions', { client_id: C.ana, date: D(-5), type: 'ligacao', description: 'Primeiro contato — indicação da Helena.' });
  // Acesso à área do cliente
  await api.post('/admin/users', { name: 'Helena Prado', email: 'helena@exemplo.com', role: 'cliente', client_id: C.helena, password: PW });
  await api.put(`/r/projects/${rHelena.project_id}`, { portal_message: 'Olá, Helena e Ricardo! A obra segue dentro do cronograma. Nesta semana finalizamos o gesso da área social. Os orçamentos de marcenaria já estão disponíveis para sua escolha.' });
  require('../server/db').run('UPDATE users SET must_change_pw = 0');
  console.log(`\nDemonstração criada em ${process.env.DB_FILE}\nUsuários (senha ${PW}): irineu@demo.com.br (admin), carla@demo.com.br (admin), marina@demo.com.br (gestor), pedro@demo.com.br (colaborador), julia@demo.com.br (estagiária), helena@exemplo.com (cliente)\n`);
  server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
