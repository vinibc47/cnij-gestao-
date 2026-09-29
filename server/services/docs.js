// =====================================================================
// Documentos do escritório: modelos de proposta e contrato, campos
// preenchíveis ({{campo}}), valores por extenso, conferência de parcelas
// e validação antes da emissão.
//
// Marcação dos modelos (uma linha por parágrafo):
//   # Título de seção        ## Subtítulo          > nota discreta
//   - item de lista          1. item numerado      7.1.1. cláusula
//   **negrito**              {{campo}}             {{bloco}} sozinho na linha
// =====================================================================
const { all, get, run, insert, getSetting, tx } = require('../db');
const { today, round2, nowIso, addMonths, HttpError } = require('../util');
const C = require('../constants');

// ------------------------------ Formatação ------------------------------
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const brDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const longDate = (d) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number); return `${dd} de ${MONTHS[m - 1]} de ${y}`; };
const brl = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num2 = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad2 = (n) => String(n).padStart(2, '0');
const label = (list, v) => ((C[list] || []).find((x) => x.value === v) || {}).label || v || '';
const lines = (t) => String(t || '').split(/\r?\n/).map((l) => l.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean);
const json = (t, def) => { if (t == null || t === '') return def; if (typeof t !== 'string') return t; try { return JSON.parse(t); } catch { return def; } };

// Valor por extenso (reais e centavos)
const U = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const D = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const H = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function triple(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const h = Math.floor(n / 100); const r = n % 100; const parts = [];
  if (h) parts.push(H[h]);
  if (r) { if (r < 20) parts.push(U[r]); else { const d = Math.floor(r / 10); const u = r % 10; parts.push(u ? `${D[d]} e ${U[u]}` : D[d]); } }
  return parts.join(' e ');
}
function inteiroExtenso(n) {
  if (n === 0) return 'zero';
  const groups = []; let x = n;
  while (x > 0) { groups.push(x % 1000); x = Math.floor(x / 1000); }
  const names = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]; if (!g) continue;
    let s = i === 1 && g === 1 ? 'mil' : triple(g) + (i ? ' ' + (g === 1 ? names[i][0] : names[i][1]) : '');
    parts.push({ s, g, i });
  }
  return parts.map((p, k) => {
    if (k === 0) return p.s;
    const glue = p.i === 0 && (p.g < 100 || p.g % 100 === 0) ? ' e ' : p.i === 0 ? ' ' : ', ';
    return glue + p.s;
  }).join('');
}
function extenso(valor) {
  const cents = Math.round(Math.abs(Number(valor) || 0) * 100);
  const reais = Math.floor(cents / 100); const c = cents % 100;
  const out = [];
  if (reais) {
    const big = reais >= 1e6 && reais % 1e6 === 0;
    out.push(`${inteiroExtenso(reais)}${big ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (c) out.push(`${inteiroExtenso(c)} ${c === 1 ? 'centavo' : 'centavos'}`);
  return out.length ? out.join(' e ') : 'zero real';
}

// ------------------------------ Dados do escritório ------------------------------
function office() {
  const s = (k) => getSetting(k, '') || '';
  return {
    name: s('office_name') || 'Carla Nogueira & Irineu Junior', tagline: s('office_tagline') || 'Arquitetura | Interiores',
    doc: s('office_doc'), address: s('office_address'), phone: s('office_phone'), email: s('office_email'), city: s('office_city') || 'Campo Grande – MS',
    pix_key: s('office_pix_key'), pix_type: s('office_pix_type'), pix_name: s('office_pix_name'), pix_bank: s('office_pix_bank'),
    contractor_name: s('contractor_name'), contractor_doc: s('contractor_doc'), contractor_address: s('contractor_address'), contractor_registry: s('contractor_registry'),
    validity_days: parseInt(s('proposal_validity_days'), 10) || 15,
  };
}
const docType = (doc) => { const d = String(doc || '').replace(/\D/g, ''); return d.length === 14 ? 'CNPJ' : d.length === 11 ? 'CPF' : 'CPF/CNPJ'; };
function pixText(key, name, type, bank) {
  if (!key) return '';
  return [`PIX${type ? ' – ' + type : ''} ${key}`.trim(), name, bank].filter(Boolean).join(' – ');
}

// ------------------------------ Parcelas ------------------------------
// plano: [{ label, due_date, amount }]
function normalizePlan(plan) {
  return (json(plan, []) || []).filter((r) => r && (r.amount || r.due_date || r.label)).map((r) => ({
    label: String(r.label || '').trim(), due_date: r.due_date ? String(r.due_date).slice(0, 10) : '', amount: round2(r.amount),
  }));
}
function planCheck(total, plan) {
  const p = normalizePlan(plan);
  const sum = round2(p.reduce((s, r) => s + r.amount, 0));
  return { sum, diff: round2(round2(total) - sum), ok: p.length > 0 && Math.abs(round2(total) - sum) < 0.005 && p.every((r) => r.amount > 0 && r.due_date) };
}
// Sugere um plano: entrada (opcional) + N parcelas mensais, diferença de centavos na última
function buildPlan({ total, down_payment = 0, down_date, count = 1, first_due, interval = 1 }) {
  total = round2(total); const dp = round2(down_payment); const n = Math.max(0, parseInt(count, 10) || 0);
  const out = [];
  if (dp > 0) out.push({ label: 'Entrada', due_date: down_date || first_due || today(), amount: dp });
  const rest = round2(total - dp);
  if (n > 0 && rest > 0) {
    const base = Math.floor((rest * 100) / n) / 100;
    for (let i = 0; i < n; i++) {
      const amount = i === n - 1 ? round2(rest - base * (n - 1)) : base;
      const start = first_due || addMonths(down_date || today(), 1);
      out.push({ label: 'Parcela', due_date: addMonths(start, i * (parseInt(interval, 10) || 1), Number(String(start).slice(8, 10))), amount });
    }
  } else if (!dp && total > 0) out.push({ label: 'Parcela única', due_date: first_due || today(), amount: total });
  return out;
}
function planLines(plan) {
  const p = normalizePlan(plan); const n = p.length;
  return p.map((r, i) => `(${pad2(i + 1)}/${pad2(n)} – ${(r.label || 'parcela').toLowerCase()}) ${brDate(r.due_date)} – ${brl(r.amount)} (${extenso(r.amount)})${i === n - 1 ? '.' : ';'}`);
}
function planSentence(plan) {
  const p = normalizePlan(plan); const n = p.length;
  if (n <= 1) return 'em parcela única';
  const hasDown = /entrada/i.test(p[0].label);
  return hasDown ? `sendo entrada e ${n - 1} parcela${n - 1 > 1 ? 's' : ''}, conforme abaixo` : `parcelado em ${n}x, sendo`;
}

// ------------------------------ Campos disponíveis nos modelos ------------------------------
const FIELDS = {
  'cliente.nome': 'Nome do cliente', 'cliente.contato': 'Contato (A/C)', 'cliente.documento': 'CPF/CNPJ do cliente',
  'projeto.nome': 'Projeto / serviço', 'projeto.endereco': 'Endereço do projeto / obra', 'servico.tipo': 'Tipo de serviço', 'obra.tipo': 'Tipo de obra',
  area: 'Área aproximada (m²)', resumo: 'Resumo do projeto ou serviço', prazo: 'Prazo estimado', 'prazo.data': 'Data de entrega (prazo)',
  valor_total: 'Valor total', valor_total_extenso: 'Valor total por extenso', entrada: 'Valor da entrada', condicao_pagamento: 'Condição de pagamento',
  forma_pagamento: 'Forma de pagamento', pix: 'Dados do Pix (chave, favorecido, banco)', 'pix.chave': 'Chave Pix', 'pix.favorecido': 'Favorecido do Pix',
  'proposta.numero': 'Número da proposta', 'proposta.data': 'Data da proposta', 'proposta.validade': 'Validade da proposta', 'contrato.numero': 'Número do contrato',
  'escritorio.nome': 'Nome do escritório', 'escritorio.endereco': 'Endereço do escritório', 'escritorio.telefone': 'Telefone do escritório', 'escritorio.email': 'E-mail do escritório',
  'contratante.nome': 'Contratante — nome / razão social', 'contratante.documento': 'Contratante — CPF/CNPJ', 'contratante.tipo_doc': 'Contratante — tipo de documento',
  'contratante.endereco': 'Contratante — endereço', 'contratante.representacao': 'Contratante — representante (opcional)',
  'contratado.nome': 'Contratado — nome', 'contratado.documento': 'Contratado — CPF/CNPJ', 'contratado.tipo_doc': 'Contratado — tipo de documento',
  'contratado.endereco': 'Contratado — endereço', 'contratado.registro': 'Contratado — registro profissional (CAU)',
  objeto: 'Objeto do contrato', local_data: 'Local e data da assinatura',
  'acompanhamento.periodicidade': 'Acompanhamento — periodicidade', 'acompanhamento.visitas': 'Acompanhamento — visitas incluídas',
  'acompanhamento.periodo': 'Acompanhamento — período', 'acompanhamento.cobranca': 'Acompanhamento — forma de cobrança', 'acompanhamento.valor_visita': 'Acompanhamento — valor por visita',
  'visita.local': 'Visita — local', 'visita.finalidade': 'Visita — finalidade', 'visita.data': 'Visita — data prevista', 'visita.duracao': 'Visita — duração prevista',
};
const BLOCKS = {
  escopo: 'Escopo e entregas incluídas (lista)', nao_incluidos: 'Serviços não incluídos (lista)', entregas: 'Produtos a serem entregues (lista)',
  etapas_prazos: 'Tabela de etapas e prazos', servicos: 'Serviços propostos (lista)', parcelas: 'Parcelas e vencimentos (lista)', condicoes: 'Observações e condições adicionais', assinaturas: 'Campos de assinatura',
};
// campos que podem ficar vazios: a linha inteira some (ex.: "Att. {{cliente.contato}}")
const OPTIONAL_LINE = new Set(['cliente.contato', 'pix.favorecido', 'obra.tipo', 'area', 'entrada', 'cliente.documento', 'prazo', 'acompanhamento.valor_visita']);
const OPTIONAL_INLINE = new Set(['contratante.representacao']);
const OPTIONAL_BLOCKS = new Set(['condicoes', 'nao_incluidos']);
const PENDING_RX = /\[PENDENTE[^\]]*\]/i;

// ------------------------------ Serviços da proposta (um ou vários) ------------------------------
const PROJECT_SVC = ['arquitetonico', 'interiores'];
// lista de serviços; propostas antigas com a opção conjunta viram os dois serviços separados
function proposalServices(p) {
  const list = (json(p.services, []) || []).filter((x) => x && x.type);
  if (list.length) return list.map((x) => ({ type: x.type, description: x.description || '', amount: x.amount === '' || x.amount == null ? null : round2(x.amount) }));
  if (p.service_type === 'arq_interiores') return [{ type: 'arquitetonico', description: '', amount: null }, { type: 'interiores', description: '', amount: null }];
  return p.service_type ? [{ type: p.service_type, description: '', amount: null }] : [];
}
const servicesLabel = (list) => { const l = list.map((x) => label('SERVICE_TYPES_ALL', x.type)); return l.length <= 1 ? l[0] || '' : `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}`; };
function serviceConds(list) {
  const t = new Set(list.map((x) => x.type));
  const projeto = PROJECT_SVC.some((x) => t.has(x));
  return { projeto, arquitetonico: t.has('arquitetonico'), interiores: t.has('interiores'), acompanhamento: t.has('acompanhamento'), visita: t.has('visita'), projeto_sem_acompanhamento: projeto && !t.has('acompanhamento') };
}
// serviço que define o modelo de texto: o primeiro projeto escolhido; senão o primeiro serviço
const primaryService = (list) => (list.find((x) => PROJECT_SVC.includes(x.type)) || list[0] || {}).type || 'interiores';

// ------------------------------ Contexto de uma proposta ------------------------------
function proposalContext(p) {
  const o = office();
  const client = p.client_id ? get('SELECT * FROM clients WHERE id = ?', p.client_id) : null;
  const ex = json(p.extra, {}) || {};
  const plan = normalizePlan(p.payment_plan);
  const stages = (json(p.stages, []) || []).filter((r) => r && (r.etapa || r.prazo));
  const vars = {
    'cliente.nome': client ? client.name : p.prospect_name || '', 'cliente.contato': p.contact_name || '', 'cliente.documento': client ? client.doc || '' : p.prospect_doc || '',
    'projeto.nome': p.title || '', 'projeto.endereco': [p.address, p.city].filter(Boolean).join(' – '), 'servico.tipo': servicesLabel(proposalServices(p)),
    'obra.tipo': label('WORK_TYPES', p.work_type), area: p.area ? `${String(p.area).replace('.', ',')} m²` : '', resumo: p.summary || '', prazo: p.deadline_text || '',
    valor_total: p.amount ? brl(p.amount) : '', valor_total_extenso: p.amount ? extenso(p.amount) : '', entrada: p.down_payment ? brl(p.down_payment) : '',
    condicao_pagamento: plan.length ? planSentence(plan) : '', forma_pagamento: label('PAYMENT_METHODS', p.payment_method),
    pix: pixText(p.pix_key, p.pix_name, o.pix_type, o.pix_bank), 'pix.chave': p.pix_key || '', 'pix.favorecido': p.pix_name || '',
    'proposta.numero': p.number || '', 'proposta.data': brDate(p.issue_date), 'proposta.validade': brDate(p.valid_until),
    'escritorio.nome': o.name, 'escritorio.endereco': o.address, 'escritorio.telefone': o.phone, 'escritorio.email': o.email,
    'acompanhamento.periodicidade': ex.periodicidade || '', 'acompanhamento.visitas': ex.visitas ? `${ex.visitas} visita${Number(ex.visitas) > 1 ? 's' : ''}` : '',
    'acompanhamento.periodo': ex.periodo_inicio || ex.periodo_fim ? [ex.periodo_inicio ? 'de ' + brDate(ex.periodo_inicio) : '', ex.periodo_fim ? 'até ' + brDate(ex.periodo_fim) : ''].filter(Boolean).join(' ') : '',
    'acompanhamento.cobranca': ex.cobranca || '', 'acompanhamento.valor_visita': ex.valor_visita ? brl(ex.valor_visita) : '',
    'visita.local': ex.visita_local || '', 'visita.finalidade': ex.visita_finalidade || '', 'visita.data': brDate(ex.visita_data), 'visita.duracao': ex.visita_duracao || '',
  };
  const services = proposalServices(p);
  const blocks = {
    escopo: lines(p.scope), nao_incluidos: lines(p.excluded), entregas: lines(p.deliverables), etapas_prazos: stages,
    parcelas: planLines(plan), condicoes: String(p.conditions || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    servicos: services.map((x) => ({ label: label('SERVICE_TYPES_ALL', x.type), description: x.description || '', amount: x.amount || null })),
  };
  return { vars, blocks, client, office: o, plan, services, conds: serviceConds(services) };
}

// ------------------------------ Contexto de um contrato ------------------------------
function contractContext(c) {
  const o = office();
  const client = c.client_id ? get('SELECT * FROM clients WHERE id = ?', c.client_id) : null;
  const d = json(c.data, {}) || {};
  const plan = normalizePlan(c.payment_plan);
  const project = c.project_id ? get('SELECT name, address, city, area FROM projects WHERE id = ?', c.project_id) : null;
  const rep = d.contratante_representante ? `, neste ato representado(a) por ${d.contratante_representante}${d.contratante_rep_doc ? `, inscrito(a) sob CPF ${d.contratante_rep_doc}` : ''}` : '';
  const pixKey = d.pix_key ?? o.pix_key; const pixName = d.pix_name ?? o.pix_name;
  const vars = {
    'cliente.nome': client ? client.name : '', 'cliente.documento': d.contratante_doc || '',
    'projeto.nome': d.projeto_nome || (project && project.name) || '', 'projeto.endereco': d.localizacao || '',
    'servico.tipo': label('SERVICE_TYPES_ALL', c.service_type), area: d.area ? `${String(d.area).replace('.', ',')} m²` : '',
    resumo: d.objeto || '', objeto: d.objeto || '', prazo: d.prazo_texto || '', 'prazo.data': brDate(d.prazo_data),
    valor_total: c.amount ? brl(c.amount) : '', valor_total_extenso: c.amount ? extenso(c.amount) : '',
    entrada: plan[0] && /entrada/i.test(plan[0].label) ? brl(plan[0].amount) : '',
    condicao_pagamento: plan.length ? planSentence(plan) : '', forma_pagamento: label('PAYMENT_METHODS', c.payment_method),
    pix: pixText(pixKey, pixName, o.pix_type, o.pix_bank), 'pix.chave': pixKey || '', 'pix.favorecido': pixName || '',
    'contrato.numero': c.number || '',
    'escritorio.nome': o.name, 'escritorio.endereco': o.address, 'escritorio.telefone': o.phone, 'escritorio.email': o.email,
    'contratante.nome': d.contratante_nome || '', 'contratante.documento': d.contratante_doc || '', 'contratante.tipo_doc': docType(d.contratante_doc),
    'contratante.endereco': d.contratante_endereco || '', 'contratante.representacao': rep,
    'contratado.nome': d.contratado_nome || '', 'contratado.documento': d.contratado_doc || '', 'contratado.tipo_doc': docType(d.contratado_doc),
    'contratado.endereco': d.contratado_endereco || '', 'contratado.registro': d.contratado_registro || '',
    local_data: d.local_assinatura && d.data_assinatura ? `${d.local_assinatura}, ${longDate(d.data_assinatura)}.` : '',
    'acompanhamento.periodicidade': d.periodicidade || '', 'acompanhamento.visitas': d.visitas ? `${d.visitas} visita${Number(d.visitas) > 1 ? 's' : ''}` : '',
    'acompanhamento.periodo': d.periodo_inicio || d.periodo_fim ? [d.periodo_inicio ? 'de ' + brDate(d.periodo_inicio) : '', d.periodo_fim ? 'até ' + brDate(d.periodo_fim) : ''].filter(Boolean).join(' ') : '',
    'acompanhamento.cobranca': d.cobranca || '', 'acompanhamento.valor_visita': d.valor_visita ? brl(d.valor_visita) : '',
    'visita.local': d.visita_local || '', 'visita.finalidade': d.visita_finalidade || '', 'visita.data': brDate(d.visita_data), 'visita.duracao': d.visita_duracao || '',
  };
  const signers = [
    { name: d.contratante_nome || '', role: 'CONTRATANTE', doc: d.contratante_doc ? `${docType(d.contratante_doc)} ${d.contratante_doc}` : '', extra: d.contratante_representante ? `Representante: ${d.contratante_representante}` : '' },
    { name: d.contratado_nome || '', role: 'CONTRATADO', doc: d.contratado_registro || (d.contratado_doc ? `${docType(d.contratado_doc)} ${d.contratado_doc}` : ''), extra: '' },
  ];
  const witnesses = [[d.testemunha1_nome, d.testemunha1_doc], [d.testemunha2_nome, d.testemunha2_doc]].filter(([n]) => n).map(([n, doc]) => ({ name: n, role: 'TESTEMUNHA', doc: doc ? `CPF ${doc}` : '' }));
  const blocks = {
    escopo: lines(d.escopo), nao_incluidos: lines(d.nao_incluidos), entregas: lines(d.entregas),
    etapas_prazos: (json(d.etapas, []) || []).filter((r) => r && (r.etapa || r.prazo)),
    parcelas: planLines(plan), condicoes: String(d.condicoes || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    assinaturas: { signers, witnesses },
  };
  return { vars, blocks, client, office: o, plan, data: d };
}

// ------------------------------ Resolução e validação ------------------------------
const VAR_RX = /\{\{\s*([\w.]+)\s*\}\}/g;
function usedFields(body) { const s = new Set(); String(body || '').replace(VAR_RX, (m, k) => s.add(k)); return [...s]; }
// Trechos condicionais: linhas entre [[se projeto]] e [[fim]] só entram se a condição valer
// (projeto, arquitetonico, interiores, acompanhamento, visita, projeto_sem_acompanhamento)
const COND_RX = /^\s*\[\[\s*se\s+(nao\s+)?([\w]+)\s*\]\]\s*$/i; const END_RX = /^\s*\[\[\s*fim\s*\]\]\s*$/i;
function applyConditions(body, conds = {}) {
  const out = []; const stack = [];
  for (const line of String(body || '').split(/\r?\n/)) {
    const m = line.match(COND_RX);
    if (m) { stack.push(m[1] ? !conds[m[2].toLowerCase()] : !!conds[m[2].toLowerCase()]); continue; }
    if (END_RX.test(line)) { stack.pop(); continue; }
    if (stack.every(Boolean)) out.push(line);
  }
  return out.join('\n');
}
// Converte o texto do modelo em linhas tipadas, com os campos preenchidos
function resolve(body, { vars, blocks, conds }) {
  const out = [];
  for (const rawLine of applyConditions(body, conds).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    const only = line.trim().match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    if (only && only[1] in BLOCKS) { out.push({ t: 'block', name: only[1], data: blocks[only[1]] }); continue; }
    if (only && only[1] === 'local_data') { if (vars.local_data) out.push({ t: 'right', text: vars.local_data }); continue; }
    let drop = false;
    const text = line.replace(VAR_RX, (m, k) => {
      const v = vars[k];
      if ((v === undefined || v === '') && OPTIONAL_LINE.has(k)) drop = true;
      return v === undefined ? m : String(v);
    });
    if (drop) continue;
    const s = text.trim();
    if (!s) { out.push({ t: 'blank' }); continue; }
    let m;
    if ((m = s.match(/^##\s+(.*)$/))) out.push({ t: 'h2', text: m[1] });
    else if ((m = s.match(/^#\s+(.*)$/))) out.push({ t: 'h1', text: m[1] });
    else if ((m = s.match(/^>\s?(.*)$/))) out.push({ t: 'note', text: m[1] });
    else if ((m = s.match(/^[-•]\s+(.*)$/))) out.push({ t: 'li', text: m[1] });
    else if ((m = s.match(/^(\d+(?:\.\d+)+\.?)\s+(.*)$/))) out.push({ t: 'clause', num: m[1], text: m[2] });
    else if ((m = s.match(/^(\d+)\.\s+(.*)$/))) out.push({ t: 'ol', num: m[1], text: m[2] });
    else out.push({ t: 'p', text: s });
  }
  // seções sem conteúdo (ex.: lista opcional vazia) não deixam título solto
  const empty = (tk) => tk.t === 'blank' || (tk.t === 'block' && (!tk.data || (Array.isArray(tk.data) && !tk.data.length)));
  return out.filter((tk, i) => {
    if (tk.t !== 'h1') return !(tk.t === 'block' && empty(tk));
    let j = i + 1; while (j < out.length && empty(out[j])) j++;
    return j < out.length && out[j].t !== 'h1';
  });
}
// Lista de problemas que impedem a emissão
function problems(body, ctx, extra = []) {
  const errs = [...extra];
  if (!String(body || '').trim()) errs.push('O texto do documento está vazio.');
  if (PENDING_RX.test(body || '')) errs.push('O texto contém trechos marcados como [PENDENTE]. Complete o modelo em Configurações › Modelos de documentos ou edite o texto deste documento.');
  for (const k of usedFields(applyConditions(body, ctx.conds))) {
    if (k in BLOCKS) {
      const b = ctx.blocks[k];
      if (k === 'assinaturas') { if (!b || !b.signers.every((s) => s.name)) errs.push('Preencha os nomes do contratante e do contratado para os campos de assinatura.'); continue; }
      if ((!b || (Array.isArray(b) && !b.length)) && !OPTIONAL_BLOCKS.has(k)) errs.push(`Preencha: ${BLOCKS[k]}.`);
      continue;
    }
    if (!(k in FIELDS)) { errs.push(`Campo desconhecido no texto: {{${k}}}.`); continue; }
    if (OPTIONAL_LINE.has(k) || OPTIONAL_INLINE.has(k)) continue;
    if (!ctx.vars[k]) errs.push(`Preencha: ${FIELDS[k]}.`);
  }
  return [...new Set(errs)];
}

// ------------------------------ Modelos padrão ------------------------------
const PROJECT_STAGES_TEXT = `# Etapas do projeto
## 1. Briefing – reunião de alinhamento
> Início imediato após a contratação
Etapa realizada em reunião presencial.
Consiste em uma reunião detalhada, com duração normalmente de cerca de 2 a 3 horas, para entender suas necessidades, desejos, gostos, prioridades, orçamento e todas as informações que forem relevantes ao projeto.
Essa reunião é importante para que o projeto realmente atenda às suas expectativas e seja mais assertivo.
**Para essa reunião é necessário separar e levar todas as referências de projeto que representem o gosto dos usuários, pois elas serão analisadas com vocês nesse momento.**

## 2. Estudo volumétrico 3D
> Início após a aprovação da fase anterior
Após a aprovação de toda a parte funcional dos espaços na etapa anterior, damos início à fase do projeto em que vocês poderão visualizar todos os detalhes dos espaços em imagens realísticas, como se representassem fotos do espaço já pronto. Aqui poderão ver tudo de que gostam ou não gostam e fazer as modificações que acharem necessárias, até que tudo fique 100% a seu gosto.
**IMPORTANTE:** nessa etapa NÃO HÁ LIMITE DE MODIFICAÇÕES/REVISÕES DE PROJETO, para que ao final tudo fique ao seu gosto. Porém, todas essas alterações precisam acontecer dentro dessa fase, já que, após a aprovação completa dessa etapa pelo contratante, não serão mais realizadas modificações dentro deste pacote de projeto.
Essa fase garante que vocês partam para a execução da obra tendo 100% de certeza de como ficará o resultado final, o que diminui muito os custos de obra por conta de retrabalho e desperdício de material, que ocorrem quando não se tem certeza se o resultado será do agrado e acabam acontecendo modificações em obra, além de diminuir a frustração e a dor de cabeça que esses retrabalhos causam.
O projeto foi feito para ser como uma receita para a obra: com ele você já sabe o que fazer, não precisa testar e correr o risco de errar.

## 3. Projeto executivo
> Início apenas após a aprovação e finalização do estudo volumétrico
Após a aprovação completa do anteprojeto, e tendo todos os materiais e acabamentos sido escolhidos, damos início ao projeto executivo. Essa é uma etapa de projeto que não precisará de sua participação direta: trata-se apenas do detalhamento das decisões já tomadas na fase anterior.
Nessa fase fazemos todas as plantas e detalhamentos necessários à execução da obra, com todas as informações técnicas, especificações de materiais, dimensões, enfim, tudo o que for necessário para facilitar o entendimento da equipe de execução.
**IMPORTANTE:** essa etapa não permite modificações, pois, como explicado, consiste apenas no detalhamento das informações já definidas na etapa anterior. Portanto, quaisquer alterações deverão ser feitas nas etapas anteriores (de definição), cessando após a aprovação e o término do anteprojeto. Se ainda assim se fizerem necessárias, serão cobradas separadamente, por meio de aditivo de contrato.

# Produtos a serem entregues
> Relação de detalhamentos (checklist)
{{entregas}}

# Prazos
{{etapas_prazos}}
Para que os prazos descritos aqui permaneçam inalterados, o contratante deverá respeitar o prazo de avaliação e retorno das etapas e, após sua aprovação, deverá proceder com a assinatura do termo de aceite o quanto antes para liberar a próxima etapa.
Caso os prazos de avaliação não sejam respeitados pelo contratante, o contratado se reserva o direito de modificar os prazos de entrega das próximas etapas, para adequá-los à agenda do escritório, de modo que o trabalho não sofra prejuízos.

# Entrega do projeto
Todos os desenhos e manuais pertencentes à etapa de projeto serão entregues por meio digital, via e-mail, e impressos (conforme necessidade).
**Entrega:** projeto completo + lista de aquisições com especificações e quantitativos.`;

const PROPOSAL_INTRO = `Att. {{cliente.contato}}
Segue a proposta de prestação de serviço, objeto dos entendimentos mantidos com V. Sa.

# Serão fornecidos projetos com a seguinte finalidade
## {{servico.tipo}}
{{resumo}}

# Escopo do projeto
{{escopo}}
`;
const PROPOSAL_INVEST = `# Serviços não incluídos
{{nao_incluidos}}

# Investimento
Valor total de **{{valor_total}}** ({{valor_total_extenso}}), {{condicao_pagamento}}:
{{parcelas}}
Forma de pagamento: {{forma_pagamento}}.
**Dados para pagamento:** {{pix}}

# Informações importantes
{{condicoes}}
Orçamento válido apenas para os serviços acordados. Esta proposta é válida até {{proposta.validade}}.`;

const TPL_PROPOSTA_V1 = {
  interiores: `${PROPOSAL_INTRO}\n${PROJECT_STAGES_TEXT}\n\n# Acompanhamento de obra\n- Para o acompanhamento de obra, o valor é cobrado à parte do projeto, com orçamento separado.\n\n${PROPOSAL_INVEST}`,
  arquitetonico: `${PROPOSAL_INTRO}\n${PROJECT_STAGES_TEXT}\n\n# Acompanhamento de obra\n- Para o acompanhamento de obra, o valor é cobrado à parte do projeto, com orçamento separado.\n\n${PROPOSAL_INVEST}`,
  arq_interiores: `${PROPOSAL_INTRO}\n${PROJECT_STAGES_TEXT}\n\n# Acompanhamento de obra\n- Para o acompanhamento de obra, o valor é cobrado à parte do projeto, com orçamento separado.\n\n${PROPOSAL_INVEST}`,
  acompanhamento: `Att. {{cliente.contato}}
Segue a proposta de prestação de serviço de acompanhamento de obra, objeto dos entendimentos mantidos com V. Sa.

# Finalidade
## {{servico.tipo}}
{{resumo}}

# Escopo do acompanhamento
{{escopo}}

# Periodicidade e visitas
- Periodicidade: {{acompanhamento.periodicidade}}
- Visitas incluídas: {{acompanhamento.visitas}}
- Período: {{acompanhamento.periodo}}
- Forma de cobrança: {{acompanhamento.cobranca}}

# Prazo
{{prazo}}

${PROPOSAL_INVEST}`,
  visita: `Att. {{cliente.contato}}
Segue a proposta de visita técnica, objeto dos entendimentos mantidos com V. Sa.

# Finalidade da visita
{{visita.finalidade}}

# Local e data
- Local: {{visita.local}}
- Data prevista: {{visita.data}}
- Duração prevista: {{visita.duracao}}

# O que está incluído
{{escopo}}

${PROPOSAL_INVEST}`,
};

// Modelo v2: um único texto que se adapta aos serviços escolhidos na proposta
// (trechos [[se …]] … [[fim]]); a lista "Produtos a serem entregues" é a referência das entregas.
const PROPOSAL_V2 = (intro) => `Att. {{cliente.contato}}
${intro}

# Serviços propostos
{{servicos}}
{{resumo}}

[[se projeto]]
${PROJECT_STAGES_TEXT}
[[fim]]

[[se acompanhamento]]
# Acompanhamento de obra
- Periodicidade: {{acompanhamento.periodicidade}}
- Visitas incluídas: {{acompanhamento.visitas}}
- Período: {{acompanhamento.periodo}}
- Forma de cobrança: {{acompanhamento.cobranca}}
- Valor por visita: {{acompanhamento.valor_visita}}
- Prazo estimado: {{prazo}}
[[fim]]

[[se visita]]
# Visita técnica
- Local: {{visita.local}}
- Finalidade: {{visita.finalidade}}
- Data prevista: {{visita.data}}
- Duração prevista: {{visita.duracao}}
[[fim]]

[[se projeto_sem_acompanhamento]]
# Acompanhamento de obra
- Para o acompanhamento de obra, o valor é cobrado à parte do projeto, com orçamento separado.
[[fim]]

${PROPOSAL_INVEST}`;
const INTRO = 'Segue a proposta de prestação de serviço, objeto dos entendimentos mantidos com V. Sa.';
const TPL_PROPOSTA = { interiores: PROPOSAL_V2(INTRO), arquitetonico: PROPOSAL_V2(INTRO), arq_interiores: PROPOSAL_V2(INTRO), acompanhamento: PROPOSAL_V2(INTRO), visita: PROPOSAL_V2(INTRO) };

const CONTRACT_PARTIES = `De um lado, daqui por diante denominado **CONTRATANTE**, **{{contratante.nome}}**, inscrito(a) sob {{contratante.tipo_doc}} {{contratante.documento}}, situado(a) à {{contratante.endereco}}{{contratante.representacao}}.
De outro lado, daqui por diante simplesmente denominado **CONTRATADO**, **{{contratado.nome}}**, inscrito sob {{contratado.tipo_doc}} {{contratado.documento}}, situado à {{contratado.endereco}}.

## CLÁUSULAS
O **CONTRATANTE** e o **CONTRATADO** têm entre si justos e contratados o seguinte, que mutuamente aceitam e prometem cumprir.`;
const CONTRACT_VALUES = (n) => `# ${n}. VALOR DOS HONORÁRIOS
Será cobrado o valor de **{{valor_total}}** ({{valor_total_extenso}}) para a elaboração do serviço acima citado.

# ${n + 1}. FORMA DE PAGAMENTO
{{parcelas}}
**DADOS BANCÁRIOS PARA PAGAMENTO:** {{pix}}`;
const CONTRACT_PROJECT_CONSIDERATIONS = `# 7. CONSIDERAÇÕES
7.1.1. Caso o anteprojeto (3D) seja alterado pelo contratante **após sua aprovação**, o prazo de entrega do projeto executivo deverá ser alterado, e os **valores reajustados, sendo 10% do valor total do projeto, por cada alteração**.
7.1.2. A não execução da obra, tanto por parte de desistência do **CONTRATANTE**, como por qualquer outro motivo não explicitado, não implica a desobrigatoriedade de pagamento do **projeto** contratado.
7.1.3. O pagamento de mão de obra e decorações, bem como de materiais de construção e acabamento, fica por conta do **CONTRATANTE**.
7.1.4. O projeto será entregue em arquivos salvos em **PDF**.
7.1.5. **O pagamento de taxas do CAU-MS, se houver, corre por conta do CONTRATANTE, no valor, em média, de R$ 190,00.**
7.1.6. Em caso de inércia do projeto superior a 30 dias corridos, por falta de resposta ou aprovação de etapas por parte do **CONTRATANTE**, o projeto será considerado entregue e todas as etapas aprovadas e em desenvolvimento até o momento deverão ser pagas pelo **CONTRATANTE**. Caberá ao **CONTRATADO** decidir se dará continuidade ao contrato ou não, sem ônus ao **CONTRATADO**.
7.1.7. **Em caso de atraso no pagamento, incidirá multa de 2% sobre o valor da parcela em atraso, acrescida de juros de mora de 1% ao mês e correção monetária pelo IPCA.**
7.1.8. O **CONTRATADO** poderá suspender imediatamente os serviços em caso de atraso superior a 20 dias em qualquer parcela prevista neste contrato.
7.1.9. O **CONTRATADO** poderá utilizar imagens, renders, fotografias e demais materiais produzidos para divulgação em portfólio, redes sociais e publicações profissionais, preservando informações confidenciais do **CONTRATANTE**.
7.1.10. Para dirimir quaisquer controvérsias oriundas do CONTRATO, as partes elegem o foro da comarca de Campo Grande/MS.`;
const CONTRACT_END = `\n\n{{local_data}}\n\n{{assinaturas}}`;

const INTERIORES_SERVICES = `Considera-se incluído neste contrato:
1. Levantamento, maquete eletrônica e imagens realistas.
2. Planta layout e técnica (distribuição de móveis, marcenaria e demais itens que envolvem o projeto, especificados com medidas), caso necessário.
3. Projeto luminotécnico (distribuição de pontos de iluminação e especificação de luminárias), caso necessário.
4. Projeto elétrico e hidráulico (distribuição de pontos elétricos e hidráulicos que envolvem o projeto), caso necessário.
5. Projeto de forro e gesso (medidas gerais e alturas), caso necessário.
6. Projeto de marcenaria (detalhamentos com medidas, acabamentos e cores), caso necessário.
7. Projeto de serralheria (detalhamentos com medidas, acabamentos e cores), caso necessário.
8. Projeto de marmoraria (detalhamento com medidas, acabamentos e cores), caso necessário.
9. Projeto de tintas e papéis de parede (detalhamento com medidas e especificações), caso necessário.
10. Projeto de revestimentos (distribuição, especificação, paginação e quantitativo de revestimentos utilizados), caso necessário.
11. Projeto de cortinas, persianas e tapetes (distribuição e quantitativo para cortinas, persianas e tapetes), caso necessário.
12. Projeto de esquadrias (distribuição e detalhamento de portas e janelas), caso necessário.
13. Especificação de metais (chuveiros, duchas, ducha higiênica, torneiras e cubas que envolvem o projeto), caso necessário.
14. Especificação de eletrônicos e eletrodomésticos (distribuições e especificações de itens que envolvem o projeto), caso necessário.`;

const PROJECT_CONTRACT = (kindLabel, servicesText, stagesText) => `${CONTRACT_PARTIES}

# 1. DO OBJETO
{{objeto}}

## 1.1. LOCALIZAÇÃO
{{projeto.endereco}}

${stagesText}

# 2. SERVIÇOS DO ${kindLabel}
${servicesText}

${CONTRACT_VALUES(3)}

# 5. ADMINISTRAÇÃO DA OBRA
**O serviço de acompanhamento não consta neste contrato. Caso contratado, será feito em um contrato separado.**

# 6. DOS PRAZOS
O projeto 3D com visualização realística será entregue até **{{prazo.data}}, caso não sejam alteradas as opções propostas no layout.** Para a elaboração do projeto executivo pede-se um prazo de até 20 dias úteis **após** a aprovação do anteprojeto. Porém, serão enviados por partes, antes desse prazo, os projetos executivos para proporcionar maior agilidade ao andamento da obra. Esta etapa engloba todos os detalhes técnicos necessários para a obra.

${CONTRACT_PROJECT_CONSIDERATIONS}${CONTRACT_END}`;

const TPL_CONTRATO = {
  interiores: PROJECT_CONTRACT('PROJETO DE INTERIORES', INTERIORES_SERVICES, 'Será desenvolvido em duas etapas:\n- Anteprojeto de interiores;\n- Projeto executivo;'),
  arquitetonico: PROJECT_CONTRACT('PROJETO ARQUITETÔNICO', 'Considera-se incluído neste contrato:\n[PENDENTE: enviar a relação de serviços incluídos no contrato de projeto arquitetônico]', 'Será desenvolvido nas seguintes etapas:\n[PENDENTE: confirmar as etapas do projeto arquitetônico]'),
  arq_interiores: PROJECT_CONTRACT('PROJETO ARQUITETÔNICO E DE INTERIORES', 'Considera-se incluído neste contrato:\n[PENDENTE: enviar a relação de serviços incluídos no contrato de projeto arquitetônico e de interiores]', 'Será desenvolvido nas seguintes etapas:\n[PENDENTE: confirmar as etapas do projeto arquitetônico e de interiores]'),
  acompanhamento: `${CONTRACT_PARTIES}

# 1. DO OBJETO
{{objeto}}

## 1.1. LOCALIZAÇÃO
{{projeto.endereco}}

# 2. DO ACOMPANHAMENTO
- Periodicidade: {{acompanhamento.periodicidade}}
- Visitas incluídas: {{acompanhamento.visitas}}
- Período: {{acompanhamento.periodo}}
- Forma de cobrança: {{acompanhamento.cobranca}}
[PENDENTE: enviar o modelo de contrato de acompanhamento de obra com as responsabilidades e condições das visitas]

${CONTRACT_VALUES(3)}

# 5. CONSIDERAÇÕES
[PENDENTE: cláusulas específicas do contrato de acompanhamento de obra]
5.1. Para dirimir quaisquer controvérsias oriundas do CONTRATO, as partes elegem o foro da comarca de Campo Grande/MS.${CONTRACT_END}`,
  visita: `${CONTRACT_PARTIES}

# 1. DO OBJETO
{{objeto}}

# 2. DA VISITA TÉCNICA
- Local: {{visita.local}}
- Finalidade: {{visita.finalidade}}
- Data prevista: {{visita.data}}
- Duração prevista: {{visita.duracao}}
[PENDENTE: enviar o modelo de contrato de visita técnica avulsa com as condições do serviço]

${CONTRACT_VALUES(3)}

# 5. CONSIDERAÇÕES
[PENDENTE: cláusulas específicas do contrato de visita técnica avulsa]
5.1. Para dirimir quaisquer controvérsias oriundas do CONTRATO, as partes elegem o foro da comarca de Campo Grande/MS.${CONTRACT_END}`,
};

const SOURCES = {
  proposta: { interiores: 'Baseado em 11- ORÇAMENTO- HEITOR MATOS.pptx', arquitetonico: 'Adaptado do modelo de interiores — revise o texto', arq_interiores: 'Adaptado do modelo de interiores — revise o texto', acompanhamento: 'Estrutura inicial — revise o texto', visita: 'Estrutura inicial — revise o texto' },
  contrato: { interiores: 'Baseado em 2026_006- HEITOR MATOS.doc', arquitetonico: 'Cláusulas gerais do modelo de interiores — serviços pendentes', arq_interiores: 'Cláusulas gerais do modelo de interiores — serviços pendentes', acompanhamento: 'Modelo pendente de envio', visita: 'Modelo pendente de envio' },
};

// Valores iniciais dos campos da proposta por tipo de serviço (editáveis)
const PROPOSAL_DEFAULTS = {
  interiores: {
    deliverables: ['Imagens 3D', 'Planta layout', 'Planta técnica', 'Planta luminotécnica', 'Planta elétrica', 'Planta de pintura', 'Execução de mobiliário planejado para o ambiente citado', 'Memorial descritivo dos móveis escolhidos', 'Definição de detalhes decorativos'],
    stages: [{ etapa: 'Início', prazo: 'Imediato' }, { etapa: 'Reunião de definições', prazo: 'Imediata, conforme agenda' }, { etapa: 'Estudo volumétrico 3D', prazo: '10 dias úteis' }, { etapa: 'Avaliação do cliente', prazo: '5 dias' }, { etapa: 'Modificações de 3D', prazo: '8 dias úteis' }, { etapa: 'Projeto executivo', prazo: 'Até 10 dias úteis' }],
    excluded: ['Acompanhamento de obra (cobrado à parte, com orçamento separado)', 'Mão de obra, materiais de construção, acabamentos e decoração', 'Taxas do CAU-MS (RRT), quando houver'],
  },
  arquitetonico: { deliverables: [], stages: [{ etapa: 'Início', prazo: 'Imediato' }, { etapa: 'Reunião de definições', prazo: 'Imediata, conforme agenda' }], excluded: ['Acompanhamento de obra (cobrado à parte, com orçamento separado)', 'Taxas do CAU-MS (RRT), quando houver'] },
  arq_interiores: { deliverables: [], stages: [{ etapa: 'Início', prazo: 'Imediato' }, { etapa: 'Reunião de definições', prazo: 'Imediata, conforme agenda' }], excluded: ['Acompanhamento de obra (cobrado à parte, com orçamento separado)', 'Taxas do CAU-MS (RRT), quando houver'] },
  acompanhamento: { deliverables: [], stages: [], excluded: ['Mão de obra, materiais de construção, acabamentos e decoração'] },
  visita: { deliverables: [], stages: [], excluded: [] },
};

function seedTemplates() {
  tx(() => {
    // modelos de proposta ainda com o texto original (v1, sem edição do escritório) passam para o modelo por serviços
    for (const t of all("SELECT * FROM doc_templates WHERE kind = 'proposta'")) {
      if (TPL_PROPOSTA_V1[t.service_type] && t.body === TPL_PROPOSTA_V1[t.service_type] && t.body !== TPL_PROPOSTA[t.service_type]) {
        const v = t.version + 1;
        run('UPDATE doc_templates SET body = ?, version = ?, updated_at = ? WHERE id = ?', TPL_PROPOSTA[t.service_type], v, nowIso(), t.id);
        insert('doc_template_versions', { template_id: t.id, version: v, body: TPL_PROPOSTA[t.service_type], created_at: nowIso() });
      }
    }
    for (const [kind, set] of [['proposta', TPL_PROPOSTA], ['contrato', TPL_CONTRATO]]) {
      for (const st of C.SERVICE_TYPES_ALL) {
        if (get('SELECT 1 FROM doc_templates WHERE kind = ? AND service_type = ?', kind, st.value)) continue;
        const name = `${kind === 'proposta' ? 'Proposta' : 'Contrato'} — ${st.label}`;
        const id = insert('doc_templates', { kind, service_type: st.value, name, body: set[st.value], version: 1, source: SOURCES[kind][st.value], updated_at: nowIso() });
        insert('doc_template_versions', { template_id: id, version: 1, body: set[st.value], created_at: nowIso() });
      }
    }
  });
}
const templateFor = (kind, serviceType) => get('SELECT * FROM doc_templates WHERE kind = ? AND service_type = ?', kind, serviceType);
const templateStatus = (t) => (PENDING_RX.test(t.body || '') ? 'pendente' : 'configurado');

function saveTemplate(id, body, user) {
  const t = get('SELECT * FROM doc_templates WHERE id = ?', id);
  if (!t) throw new HttpError(404, 'Modelo não encontrado.');
  body = String(body || '').replace(/\r\n/g, '\n');
  if (body === t.body) return t;
  const unknown = usedFields(body).filter((k) => !(k in FIELDS) && !(k in BLOCKS));
  if (unknown.length) throw new HttpError(400, `Campo(s) desconhecido(s): ${unknown.map((k) => `{{${k}}}`).join(', ')}.`);
  const v = t.version + 1;
  tx(() => {
    run('UPDATE doc_templates SET body = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = ?', body, v, user.id, nowIso(), t.id);
    insert('doc_template_versions', { template_id: t.id, version: v, body, created_by: user.id, created_at: nowIso() });
  });
  return get('SELECT * FROM doc_templates WHERE id = ?', id);
}

// ------------------------------ Lembretes de cobrança (WhatsApp) ------------------------------
const WA_TODAY = `Olá, [nome do cliente]! Tudo bem?

Passando para lembrar que hoje, [data], vence a parcela [número/total] referente ao [projeto/serviço], no valor de R$ [valor].

Para pagamento via Pix:
Chave: [chave Pix]
Favorecido: [nome do favorecido]

Após o pagamento, por gentileza, encaminhe o comprovante para conferência.

Obrigado!
Carla Nogueira & Irineu Junior
Arquitetura | Interiores`;
const WA_OVERDUE = `Olá, [nome do cliente]! Tudo bem?

Passando para lembrar da parcela [número/total] referente ao [projeto/serviço], no valor de R$ [valor], com vencimento em [data], que ainda consta em aberto em nosso controle.

Para pagamento via Pix:
Chave: [chave Pix]
Favorecido: [nome do favorecido]

Após o pagamento, por gentileza, encaminhe o comprovante para conferência. Caso o pagamento já tenha sido feito, por favor desconsidere esta mensagem.

Obrigado!
Carla Nogueira & Irineu Junior
Arquitetura | Interiores`;
const waTemplates = () => ({ today: getSetting('whatsapp_template', '') || WA_TODAY, overdue: getSetting('whatsapp_template_overdue', '') || WA_OVERDUE });
const cleanDesc = (s) => String(s || '').replace(/\s*\(\d+\/\d+\)\s*$/, '').replace(/\s*\(saldo\)\s*$/, '').trim();
function fillReminder(template, v) {
  const map = {
    'nome do cliente': v.client, data: v.date, 'número/total': v.parcel, 'numero/total': v.parcel, 'projeto/serviço': v.project, 'projeto/servico': v.project,
    valor: v.value, 'chave pix': v.pix, 'nome do favorecido': v.favored,
  };
  const out = [];
  for (const line of template.split(/\r?\n/)) {
    let empty = false;
    const l = line.replace(/\[([^\]]+)\]/g, (m, k) => { const key = k.trim().toLowerCase(); if (!(key in map)) return m; const val = map[key]; if (!val) empty = true; return val || ''; });
    if (empty) continue; // linha sem dado cadastrado (ex.: favorecido) é omitida
    out.push(l);
  }
  // remove cabeçalhos que ficaram sem conteúdo (ex.: "Para pagamento via Pix:" sem chave)
  return out.filter((l, i) => !(/:\s*$/.test(l) && (i === out.length - 1 || !out[i + 1].trim()))).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function reminderView(r, t = today()) {
  const o = office();
  const overdue = r.due_date < t;
  const vals = {
    client: r.client_name || '', date: brDate(r.due_date), parcel: r.installment_total > 1 ? `${r.installment_no}/${r.installment_total}` : 'única',
    project: r.project_name || cleanDesc(r.description), value: num2(r.amount), pix: o.pix_key, favored: o.pix_name,
  };
  const tpl = waTemplates();
  const auto = fillReminder(overdue ? tpl.overdue : tpl.today, vals);
  const phone = String(r.client_whatsapp || r.client_phone || '').replace(/\D/g, '');
  const intl = phone ? (phone.length >= 12 && phone.startsWith('55') ? phone : '55' + phone.replace(/^0+/, '')) : '';
  return { ...r, overdue, days_late: overdue ? Math.round((new Date(t) - new Date(r.due_date)) / 86400000) : 0, message: r.custom_message || auto, auto_message: auto, edited: !!r.custom_message, phone: intl, pix_missing: !o.pix_key };
}

module.exports = {
  brDate, longDate, brl, extenso, office, docType, pixText, normalizePlan, planCheck, buildPlan, planLines, FIELDS, BLOCKS, PENDING_RX,
  proposalContext, contractContext, resolve, problems, usedFields, seedTemplates, templateFor, templateStatus, saveTemplate,
  PROPOSAL_DEFAULTS, TPL_PROPOSTA, TPL_CONTRATO, proposalServices, servicesLabel, serviceConds, primaryService, applyConditions, PROJECT_SVC, WA_TODAY, WA_OVERDUE, waTemplates, fillReminder, reminderView, json, lines, label,
};
