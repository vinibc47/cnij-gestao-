// Listas de status fixas (a lógica do sistema depende delas).
// Listas editáveis pelo escritório ficam na tabela `options`.
const S = (pairs) => pairs.map(([value, label, tone]) => ({ value, label, tone: tone || 'neutral' }));

module.exports = {
  ROLES: S([
    ['admin', 'Administrador'], ['gestor', 'Gestor'], ['colaborador', 'Colaborador'],
    ['estagiario', 'Estagiário'], ['cliente', 'Cliente'],
  ]),
  INCOME_STATUS: S([
    ['previsto', 'Previsto', 'neutral'], ['a_receber', 'A receber', 'info'], ['recebido', 'Recebido', 'success'],
    ['vencido', 'Vencido', 'danger'], ['cancelado', 'Cancelado', 'muted'],
  ]),
  EXPENSE_STATUS: S([
    ['previsto', 'Previsto', 'neutral'], ['a_pagar', 'A pagar', 'info'], ['pago', 'Pago', 'success'],
    ['vencido', 'Vencido', 'danger'], ['cancelado', 'Cancelado', 'muted'],
  ]),
  PAID_BY: S([['escritorio', 'Escritório'], ['cliente', 'Cliente (direto ao fornecedor)']]),
  PAYMENT_METHODS: S([
    ['pix', 'PIX'], ['boleto', 'Boleto'], ['transferencia', 'Transferência'], ['cartao_credito', 'Cartão de crédito'],
    ['cartao_debito', 'Cartão de débito'], ['dinheiro', 'Dinheiro'], ['cheque', 'Cheque'], ['debito_auto', 'Débito automático'],
  ]),
  PROJECT_STATUS: S([
    ['ativo', 'Ativo', 'info'], ['aguardando_cliente', 'Aguardando cliente', 'warning'], ['em_obra', 'Em obra', 'accent'],
    ['pausado', 'Pausado', 'muted'], ['encerrado', 'Encerrado', 'success'], ['cancelado', 'Cancelado', 'muted'],
  ]),
  PHASE_STATUS: S([
    ['nao_iniciado', 'Não iniciado', 'neutral'], ['em_andamento', 'Em andamento', 'info'],
    ['aguardando_cliente', 'Aguardando cliente', 'warning'], ['aguardando_fornecedor', 'Aguardando fornecedor', 'warning'],
    ['revisao', 'Revisão', 'accent'], ['aprovado', 'Aprovado', 'success'], ['concluido', 'Concluído', 'success'],
  ]),
  WORK_STATUS: S([
    ['planejada', 'Planejada', 'neutral'], ['em_andamento', 'Em andamento', 'info'], ['pausada', 'Pausada', 'warning'],
    ['concluida', 'Concluída', 'success'], ['cancelada', 'Cancelada', 'muted'],
  ]),
  WORK_LOG_KIND: S([
    ['registro', 'Registro', 'neutral'], ['visita', 'Visita técnica', 'info'], ['problema', 'Problema', 'danger'],
    ['decisao', 'Decisão', 'accent'], ['medicao', 'Medição', 'neutral'],
  ]),
  TASK_PRIORITY: S([
    ['baixa', 'Baixa', 'muted'], ['normal', 'Normal', 'neutral'], ['alta', 'Alta', 'warning'], ['urgente', 'Urgente', 'danger'],
  ]),
  TASK_STATUS: S([
    ['pendente', 'Pendente', 'neutral'], ['em_andamento', 'Em andamento', 'info'], ['aguardando', 'Aguardando', 'warning'],
    ['concluida', 'Concluída', 'success'],
  ]),
  PROPOSAL_STATUS: S([
    ['elaboracao', 'Rascunho', 'neutral'], ['enviada', 'Enviada', 'info'], ['aprovada', 'Aprovada', 'success'],
    ['recusada', 'Recusada', 'danger'], ['expirada', 'Expirada', 'muted'],
  ]),
  // Tipos de serviço das propostas de honorários e dos modelos de contrato
  // Serviços que podem ser adicionados (um ou vários) em cada proposta
  SERVICE_TYPES: S([
    ['arquitetonico', 'Projeto arquitetônico'], ['interiores', 'Projeto de interiores'],
    ['acompanhamento', 'Acompanhamento de obra'], ['visita', 'Visita técnica avulsa'],
  ]),
  // Inclui a opção conjunta antiga, mantida apenas para exibir documentos já existentes
  SERVICE_TYPES_ALL: S([
    ['arquitetonico', 'Projeto arquitetônico'], ['interiores', 'Projeto de interiores'],
    ['arq_interiores', 'Projeto arquitetônico e de interiores'], ['acompanhamento', 'Acompanhamento de obra'],
    ['visita', 'Visita técnica avulsa'],
  ]),
  RECEIPT_STATUS: S([['rascunho', 'Rascunho', 'neutral'], ['emitido', 'Emitido', 'success'], ['cancelado', 'Cancelado', 'muted']]),
  REFERENCE_PREP: S([['à', 'à'], ['a', 'a'], ['às', 'às'], ['ao', 'ao'], ['aos', 'aos']]),
  SIGN_SIZES: S([
    ['150x100', '1,50 × 1,00 m'], ['120x80', '1,20 × 0,80 m'], ['100x70', '1,00 × 0,70 m'],
    ['A4', 'A4 — 210 × 297 mm'], ['A3', 'A3 — 297 × 420 mm'], ['A2', 'A2 — 420 × 594 mm'], ['A1', 'A1 — 594 × 841 mm'],
  ]),
  WORK_TYPES: S([
    ['residencial', 'Residencial'], ['comercial', 'Comercial'], ['corporativo', 'Corporativo / escritório'], ['clinica', 'Clínica'],
    ['reforma', 'Reforma'], ['construcao_nova', 'Construção nova'], ['outro', 'Outro'],
  ]),
  SITE_SITUATION: S([
    ['nao_iniciada', 'Não iniciada', 'neutral'], ['em_andamento', 'Em andamento', 'info'], ['aguardando_cliente', 'Aguardando cliente', 'warning'],
    ['aguardando_fornecedor', 'Aguardando fornecedor', 'warning'], ['pausada', 'Pausada', 'muted'], ['finalizacao', 'Em finalização', 'accent'],
    ['concluida', 'Concluída', 'success'],
  ]),
  EXECUTIVES_STATUS: S([['nao_entregues', 'Não entregues', 'danger'], ['parcial', 'Parcialmente entregues', 'warning'], ['entregues', 'Entregues', 'success']]),
  EXECUTIVE_ITEM_STATUS: S([['nao_entregue', 'Não entregue', 'neutral'], ['em_elaboracao', 'Em elaboração', 'info'], ['em_revisao', 'Em revisão', 'warning'], ['entregue', 'Entregue', 'success']]),
  PENDING_STATUS: S([['aberta', 'Em aberto', 'warning'], ['resolvida', 'Resolvida', 'success']]),
  APPROVAL_STATUS: S([['pendente', 'Aguardando cliente', 'warning'], ['aprovado', 'Aprovado', 'success'], ['recusado', 'Não aprovado', 'danger']]),
  REMINDER_STATUS: S([['pendente', 'A enviar', 'warning'], ['enviado', 'Enviado', 'success']]),
  CONTRACT_STATUS: S([
    ['elaboracao', 'Em elaboração', 'neutral'], ['aguardando_assinatura', 'Aguardando assinatura', 'warning'],
    ['ativo', 'Ativo', 'info'], ['concluido', 'Concluído', 'success'], ['cancelado', 'Cancelado', 'muted'],
  ]),
  QUOTE_STATUS: S([
    ['recebido', 'Recebido', 'neutral'], ['negociacao', 'Em negociação', 'warning'], ['aprovado', 'Aprovado', 'success'],
    ['recusado', 'Recusado', 'danger'], ['contratado', 'Contratado', 'accent'],
  ]),
  EVENT_TYPES: S([
    ['reuniao', 'Reunião', 'info'], ['visita_tecnica', 'Visita técnica', 'accent'], ['apresentacao', 'Apresentação', 'success'],
    ['entrega', 'Entrega', 'warning'], ['vencimento', 'Vencimento', 'danger'], ['pagamento', 'Pagamento', 'danger'],
    ['interno', 'Compromisso interno', 'neutral'],
  ]),
  EVENT_STATUS: S([['agendado', 'Agendado', 'info'], ['realizado', 'Realizado', 'success'], ['cancelado', 'Cancelado', 'muted']]),
  INTERACTION_TYPES: S([
    ['contato', 'Contato'], ['reuniao', 'Reunião'], ['ligacao', 'Ligação'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail'],
    ['visita', 'Visita'], ['briefing', 'Briefing'], ['feedback', 'Feedback'], ['outro', 'Outro'],
  ]),
  PERSON_TYPE: S([['PF', 'Pessoa física'], ['PJ', 'Pessoa jurídica']]),

  // Valores padrão das listas editáveis (tabela options)
  DEFAULT_OPTIONS: {
    despesa: ['Aluguel', 'Salários', 'Pró-labore', 'Softwares', 'Impostos', 'Fornecedores', 'Obra', 'Material', 'Impressão',
      'Marketing', 'Viagem', 'Transporte', 'Alimentação', 'Serviços', 'Contabilidade', 'Internet e telefone', 'Taxas bancárias',
      'RRT / ART', 'Outras despesas'],
    receita: ['Projeto de arquitetura', 'Projeto de interiores', 'Acompanhamento de obra', 'Consultoria',
      'Reserva técnica (RT)', 'Gerenciamento de obra', 'Reembolso', 'Outras receitas'],
    projeto_tipo: ['Arquitetura', 'Interiores', 'Reforma', 'Residencial', 'Comercial', 'Corporativo', 'Clínica',
      'Acompanhamento de obra', 'Consultoria', 'Outros'],
    fornecedor: ['Marcenaria', 'Marmoraria', 'Iluminação', 'Gesso', 'Elétrica', 'Hidráulica', 'Vidraçaria', 'Serralheria',
      'Mobiliário', 'Cortinas', 'Papel de parede', 'Revestimentos', 'Mão de obra', 'Impressão', 'Ar-condicionado',
      'Automação', 'Paisagismo', 'Outros'],
    documento: ['Contratos', 'Propostas', 'RRT', 'ART', 'Projetos', 'Apresentações', 'Imagens / renders', 'Fotos de obra',
      'Orçamentos', 'Notas fiscais', 'Comprovantes', 'Atas', 'Documentos de condomínio', 'Documentos de fornecedores',
      'Alvarás e licenças', 'Outros'],
    origem_cliente: ['Indicação de cliente', 'Indicação de fornecedor', 'Instagram', 'Site', 'Google', 'Parceiro / corretor',
      'Evento / mostra', 'Cliente recorrente', 'Outro'],
  },
  DEFAULT_PROJECT_PHASES: ['Briefing', 'Levantamento', 'Estudo preliminar', 'Anteprojeto', 'Projeto executivo', 'Detalhamento',
    'Orçamentos', 'Aprovação do cliente', 'Compatibilização', 'Obra', 'Finalizado'],
  DEFAULT_WORK_PHASES: ['Demolição', 'Alvenaria', 'Elétrica', 'Hidráulica', 'Gesso', 'Iluminação', 'Revestimentos', 'Pintura',
    'Marcenaria', 'Marmoraria', 'Serralheria', 'Vidros', 'Mobiliário', 'Decoração', 'Limpeza', 'Entrega'],
};
