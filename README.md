# CN·IJ Gestão
**Central de gestão do escritório Carla Nogueira & Irineu Junior — Arquitetura | Interiores**

Sistema web completo (computador, tablet e celular) com banco de dados, login individual, permissões, área do cliente, automações e relatórios. Substitui planilhas e controles espalhados: financeiro, projetos, obras, tarefas, CRM, propostas, contratos, fornecedores, agenda e documentos conversam entre si.

---

## 1. Como rodar (no computador ou servidor)

Requisito: **Node.js 22.13 ou superior** (https://nodejs.org). Não precisa instalar banco de dados — ele é um arquivo SQLite criado automaticamente.

```bash
npm install
npm start
```

Abra **http://localhost:3000**. No primeiro acesso o sistema pede para criar o **administrador** (ex.: Irineu). Depois, em *Configurações › Usuários*, cadastre a Carla, a equipe, os estagiários e defina os níveis de acesso.

### Quer ver o sistema funcionando com dados de exemplo?
```bash
npm run demo          # cria data/demo.sqlite com dados fictícios
npm run start:demo    # abre o sistema usando o banco de demonstração
```
Entre com `irineu@demo.com.br` / `Demo1234` (outros usuários de demonstração aparecem no terminal, inclusive um **cliente**: `helena@exemplo.com`). Os dados de demonstração ficam em um arquivo separado e nunca se misturam aos dados reais.

### Testes automatizados
```bash
npm test
```
50 verificações das regras de negócio e das permissões (parcelamento, vencimentos, saldo, fluxo de caixa, rentabilidade, proposta → projeto → contrato → contas a receber, isolamento da área do cliente etc.).

---

## 2. Colocar no ar (acesso pela internet)

Opção recomendada: um servidor pequeno (VPS de ~R$ 30–60/mês) com Docker.

```bash
cp .env.example .env      # ajuste APP_URL, COOKIE_SECURE=1, SMTP...
docker compose up -d --build
```
Os dados ficam na pasta `dados/` (banco, anexos e backups). Coloque um proxy com HTTPS na frente (Caddy ou Nginx + Let's Encrypt).

Também funciona em Railway, Render ou Fly.io — é essencial configurar um **disco persistente** e apontar `DB_FILE`, `UPLOAD_DIR` e `BACKUP_DIR` para ele.

**E-mail (recuperação de senha e convites):** preencha `SMTP_*` no `.env`. Sem SMTP, o administrador gera o link de redefinição em *Configurações › Usuários › Gerar link de senha*.

---

## 3. O que o sistema faz

| Módulo | Destaques |
|---|---|
| **Dashboard** | Saldo, recebido/a receber/despesas do mês, contas vencidas e a vencer, projetos, obras, tarefas, propostas e contratos pendentes; **ATENÇÃO HOJE**; gráficos de entradas × saídas, faturamento, despesas, previsão 3/6/12 meses, projetos por fase, tarefas por responsável; próximos compromissos, entregas e pagamentos. No celular mostra primeiro o **Resumo de hoje**. |
| **Financeiro** | Entradas e saídas com parcelamento automático (ex.: R$ 30.000 em 6× gera 6 parcelas com datas), baixa com pagamento parcial, estorno, comprovantes anexos, categorias editáveis, despesas **recorrentes** (Adobe, SketchUp, aluguel...) com vencimentos gerados sozinhos, **fluxo de caixa** realizado + previsto e saldo projetado. Despesas pagas diretamente pelo cliente ao fornecedor são controladas sem afetar o caixa. Reserva técnica (RT) de fornecedores como receita. |
| **Projetos** | Cadastro completo, equipe, etapas configuráveis com prazo, responsável, checklist, arquivos, comentários e status; barra de progresso calculada automaticamente; filtros (ativos, aguardando cliente, atrasados, em obra, encerrados); **arquivo** de encerrados com todo o histórico; aba **Financeiro com rentabilidade** (contratado − despesas − custos de obra − horas da equipe = resultado e margem). |
| **Obras** | Vinculadas ao projeto; fases com % executado (a obra calcula a média), orçamento previsto × gasto × saldo, **diário de obra** (visitas, decisões, problemas, pendências, fornecedores presentes, fotos), gastos por categoria/fornecedor, notas fiscais e orçamentos. |
| **Orçamentos de obra** | Vários orçamentos por item (Marcenaria: A, B, C), comparativo visual, status (recebido, negociação, aprovado, recusado, contratado), liberação ao cliente e **“contratar e lançar despesa”** em 1 clique. |
| **Tarefas** | Lista, **Kanban** (arrastar e soltar) e **calendário**; Minhas tarefas, Hoje, Esta semana, Atrasadas; prioridade, checklist, anexos, comentários (o responsável é notificado), lançamento de horas. |
| **Clientes (CRM)** | Perfil com projetos, propostas, contratos, pagamentos, parcelas pendentes, reuniões, arquivos, tarefas e **linha do tempo** automática; registro de contatos; aniversário; criação do acesso à Área do Cliente. |
| **Propostas** | Status do funil, validade, taxa de conversão e ticket médio; ao aprovar, **gera o projeto** (e opcionalmente o contrato) com os dados preenchidos. |
| **Contratos** | Documento anexado; parcelas geradas automaticamente como contas a receber (“previsto” até a assinatura, “a receber” depois); cancelamento com cancelamento das parcelas. |
| **Fornecedores** | Categorias, contatos, dados bancários, % de RT, histórico de projetos, serviços em obra, orçamentos, pagamentos e **avaliações internas** (estrelas). |
| **Agenda** | Calendário mensal com reuniões, visitas técnicas, apresentações, entregas e compromissos internos, somando automaticamente prazos de tarefas, entregas de etapas e vencimentos financeiros; ata de reunião; ao marcar “realizado”, entra no histórico do cliente. |
| **Documentos** | Central com busca e filtros (contratos, RRT, ART, projetos, NF, comprovantes, atas, condomínio...), validade com alertas, liberação ao cliente. |
| **Relatórios** | Financeiro (faturamento mensal/anual, despesas, lucro, fluxo, a receber, inadimplência por atraso), rentabilidade por projeto, projetos (ativos, concluídos, atrasados, prazo médio, entrega no prazo), comercial (enviadas, aprovadas, recusadas, conversão, ticket, motivos de recusa, conversão por origem), clientes (novos, recorrentes, faturamento por cliente) e equipe (tarefas e horas). Exportação CSV e impressão/PDF. |
| **Pesquisa global** | Barra no topo (atalho `/`) busca clientes, projetos, obras, fornecedores, tarefas, documentos, propostas, contratos e agenda. |
| **Notificações** | Tarefa atrasada/vencendo, pagamento vencendo, cliente inadimplente, proposta expirando, entrega próxima, reunião próxima, contrato pendente, documento vencendo, projeto com todas as etapas concluídas, comentário, cliente escolheu orçamento. Alertas que deixam de valer somem sozinhos. |
| **Área do Cliente** | Login próprio; cada cliente vê **somente** seus projetos: fase atual, %, cronograma, imagens, apresentações e documentos liberados, situação e diário da obra (registros liberados), próximas etapas, compromissos, **financeiro** (contratado, parcelas pagas/pendentes/vencidas, comprovantes) e **orçamentos liberados com botão para aprovar**. Nenhuma informação interna é enviada ao navegador do cliente. |

### Automações
- Parcela/conta sem pagamento após o vencimento → **Vencida** (e volta a “a receber” se a data for alterada).
- Parcelas “previstas” passam a “a receber” no mês do vencimento.
- Despesas recorrentes geram os próximos meses automaticamente.
- Propostas enviadas passam a **expirada** após a validade.
- Todas as etapas concluídas → sugestão de encerrar o projeto.
- Proposta aprovada → gera projeto (e contrato) com dados preenchidos.
- Contrato com parcelas → gera contas a receber; assinatura libera as parcelas.
- Criar obra → projeto passa a “Em obra”. Fases da obra → % executado da obra.
- Alertas de prazos (dias de antecedência configuráveis em *Configurações › Alertas*).
- Backup diário automático do banco (últimos 30).

### Níveis de acesso
| Nível | Acesso |
|---|---|
| Administrador | Tudo, incluindo configurações, usuários, auditoria e backups. |
| Gestor | Projetos, obras, clientes, tarefas, propostas, contratos, fornecedores, agenda, documentos e relatórios. Financeiro **somente se autorizado**. |
| Colaborador | Projetos/obras em que participa, tarefas atribuídas, agenda, documentos dos seus projetos, fornecedores (consulta). |
| Estagiário | Somente projetos autorizados e suas tarefas. |
| Cliente | Apenas a Área do Cliente. |

### Segurança
Senhas com bcrypt · sessão em cookie HttpOnly/SameSite (Secure em HTTPS) · bloqueio após tentativas de login · proteção CSRF · cabeçalhos de segurança (CSP, X-Frame-Options) · arquivos servidos somente com permissão (nunca públicos) · tipos de arquivo perigosos bloqueados · dados financeiros ocultos para quem não tem acesso · registro de alterações (quem, quando, o quê, antes → depois) · backups automáticos e manuais · exportação completa em JSON.

---

### Documentos, contratos e cobranças

- **Propostas › Orçamento de obra** — propostas de honorários com modelo por tipo de serviço (projeto arquitetônico, interiores, arquitetônico e interiores, acompanhamento de obra, visita técnica avulsa), campos adaptados ao serviço, entrada e parcelas com conferência do total, status (Rascunho, Enviada, Aprovada, Recusada, Expirada), registro de aprovação, duplicar e PDF.
- **Contratos** — modelos preenchíveis por serviço, “Gerar contrato a partir da proposta”, dados das partes, texto editável e **emissões versionadas** (cada PDF emitido guarda o texto e os dados usados; alterar o modelo não muda contratos já emitidos).
- **Parcelas no financeiro** — a partir da proposta aprovada ou do contrato, com conferência para não duplicar lançamentos.
- **Lembretes de cobrança (Financeiro › Lembretes)** — no dia do vencimento de cada parcela em aberto o servidor prepara a mensagem de WhatsApp (editar, copiar, abrir no WhatsApp, marcar como enviado). Nada é enviado automaticamente.
- **Projeto › Informações da obra** — ficha de acompanhamento (executivos, pendências, aprovações, próximas etapas) e relatório em PDF.
- **Obra › Orçamento de execução** e **PDF das etapas da obra**.
- **Configurações** — Escritório (dados, logo, Pix, contratado, fuso horário), Modelos de documentos (com histórico de versões) e Cobrança (texto das mensagens).
- PDFs em A4 gerados no servidor (pdfmake), com texto selecionável, logo, rodapé paginado e cabeçalhos de tabela repetidos.
- Testes: `npm test` (regras gerais + fluxo proposta → contrato → parcelas → lembrete → PDFs).

## 4. Backup
- Automático: um por dia em `backups/` (configurável).
- Manual: *Configurações › Backup e dados* ou `npm run backup`.
- Copie também a pasta `uploads/` (arquivos anexados). Recomenda-se guardar cópias fora do servidor (Google Drive, Dropbox, HD externo).
- Para restaurar: pare o sistema e substitua `data/cnij.sqlite` pelo arquivo de backup.

---

## 5. Estrutura (modular)
```
server/
  schema.sql          banco de dados (tabelas e relacionamentos)
  constants.js        status e listas padrão
  resources.js        definição declarativa de cada cadastro (campos, filtros, permissões, automações)
  crud.js             listar/pesquisar/filtrar/ordenar/criar/editar/duplicar/arquivar/excluir — genérico
  permissions.js      níveis de acesso e escopo por projeto
  auth.js             login, sessões, recuperação de senha
  services/           finance (parcelas, recorrência, fluxo de caixa), projects (progresso, rentabilidade,
                      conversões), automation (alertas, backups), mailer
  routes/             dashboard, visões consolidadas, relatórios, portal do cliente, administração
public/
  css/app.css         identidade visual
  js/lib.js           componentes (formulários dinâmicos, tabelas, anexos, checklist, comentários)
  js/views/*.js       uma tela por módulo
scripts/              demonstração, testes e backup
```
**Para adicionar um novo cadastro**, crie a tabela em `schema.sql` e descreva o recurso em `resources.js` (campos, permissões e automações). A API, os formulários, filtros, pesquisa, exportação e auditoria passam a funcionar automaticamente; basta criar a tela em `public/js/views/` se quiser uma visualização específica.
