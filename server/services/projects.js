const { all, get, run, val, insert, tx } = require('../db');
const { today, round2, HttpError, addDays } = require('../util');
const finance = require('./finance');

const DONE_PHASE = ['concluido', 'aprovado'];

function nextCode(table, prefix) {
  const year = new Date().getFullYear();
  const n = val(`SELECT COUNT(*) FROM ${table} WHERE created_at >= ?`, `${year}-01-01`) + 1;
  let code = `${prefix}-${year}-${String(n).padStart(3, '0')}`;
  const col = table === 'projects' ? 'code' : 'number';
  let i = n;
  while (get(`SELECT 1 FROM ${table} WHERE ${col} = ?`, code)) { i++; code = `${prefix}-${year}-${String(i).padStart(3, '0')}`; }
  return code;
}

function createPhasesFromTemplate(projectId, startDate) {
  const tpl = all("SELECT * FROM phase_templates WHERE kind='projeto' ORDER BY position");
  let cursor = startDate || today();
  tpl.forEach((t, i) => {
    const due = t.default_days ? addDays(cursor, t.default_days) : null;
    insert('project_phases', { project_id: projectId, name: t.name, position: i, due_date: due, status: 'nao_iniciado' });
    if (due) cursor = due;
  });
}
function createWorkPhasesFromTemplate(workId) {
  all("SELECT * FROM phase_templates WHERE kind='obra' ORDER BY position")
    .forEach((t, i) => insert('work_phases', { work_id: workId, name: t.name, position: i }));
}

function recomputeProjectProgress(projectId) {
  const phases = all('SELECT status FROM project_phases WHERE project_id = ?', projectId);
  if (!phases.length) return;
  const score = phases.reduce((s, p) => s + (DONE_PHASE.includes(p.status) ? 1 : ['em_andamento', 'revisao', 'aguardando_cliente', 'aguardando_fornecedor'].includes(p.status) ? 0.5 : 0), 0);
  run('UPDATE projects SET progress = ? WHERE id = ?', Math.round((score / phases.length) * 100), projectId);
}
function allPhasesDone(projectId) {
  const total = val('SELECT COUNT(*) FROM project_phases WHERE project_id = ?', projectId);
  const done = val(`SELECT COUNT(*) FROM project_phases WHERE project_id = ? AND status IN ('concluido','aprovado')`, projectId);
  return total > 0 && total === done;
}
function recomputeWorkProgress(workId) {
  const r = get('SELECT COUNT(*) n, AVG(progress) avg FROM work_phases WHERE work_id = ?', workId);
  if (r && r.n) run('UPDATE works SET progress = ? WHERE id = ?', Math.round(r.avg), workId);
}

// ------------------ Rentabilidade do projeto ------------------
function profitability(projectId) {
  const p = get('SELECT id, name, contract_value FROM projects WHERE id = ?', projectId);
  if (!p) return null;
  const contracted = Number(p.contract_value) || Number(val("SELECT COALESCE(SUM(amount),0) FROM contracts WHERE project_id = ? AND status <> 'cancelado'", projectId)) || 0;
  const received = val("SELECT COALESCE(SUM(amount),0) FROM incomes WHERE project_id = ? AND status = 'recebido'", projectId);
  const receivable = val("SELECT COALESCE(SUM(amount),0) FROM incomes WHERE project_id = ? AND status IN ('previsto','a_receber','vencido')", projectId);
  const overdue = val("SELECT COALESCE(SUM(amount),0) FROM incomes WHERE project_id = ? AND status = 'vencido'", projectId);
  const rt = val("SELECT COALESCE(SUM(amount),0) FROM incomes WHERE project_id = ? AND status='recebido' AND category = 'Reserva técnica (RT)'", projectId);
  // Custos contabilizados: despesas pagas ou a pagar pelo escritório (exceto canceladas)
  const base = "FROM expenses WHERE project_id = ? AND paid_by = 'escritorio' AND status <> 'cancelado'";
  const workCosts = val(`SELECT COALESCE(SUM(amount),0) ${base} AND (work_id IS NOT NULL OR category IN ('Obra','Material'))`, projectId);
  const directCosts = val(`SELECT COALESCE(SUM(amount),0) ${base} AND work_id IS NULL AND COALESCE(category,'') NOT IN ('Obra','Material')`, projectId);
  const hours = get('SELECT COALESCE(SUM(t.hours),0) h, COALESCE(SUM(t.hours * COALESCE(u.hourly_cost,0)),0) c FROM time_entries t JOIN users u ON u.id = t.user_id WHERE t.project_id = ?', projectId);
  const clientPaidWork = val("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE project_id = ? AND paid_by = 'cliente' AND status <> 'cancelado'", projectId);
  const revenue = round2(contracted + rt);
  const totalCosts = round2(workCosts + directCosts + hours.c);
  const result = round2(revenue - totalCosts);
  const byCat = all(`SELECT COALESCE(category,'Sem categoria') category, SUM(amount) total ${base} GROUP BY 1 ORDER BY 2 DESC`, projectId);
  return {
    project_id: p.id, contracted: round2(contracted), rt_received: round2(rt), revenue, received: round2(received), receivable: round2(receivable),
    overdue: round2(overdue), direct_costs: round2(directCosts), work_costs: round2(workCosts), hours: round2(hours.h), hours_cost: round2(hours.c),
    other_costs: round2(hours.c), total_costs: totalCosts, result, margin: revenue > 0 ? round2((result / revenue) * 100) : null,
    cash_result: round2(received - val(`SELECT COALESCE(SUM(amount),0) ${base} AND status = 'pago'`, projectId)),
    client_paid_work: round2(clientPaidWork), costs_by_category: byCat,
  };
}

// ------------------ Proposta aprovada → projeto ------------------
function convertProposal(proposalId, user, opts = {}) {
  const pr = get('SELECT * FROM proposals WHERE id = ?', proposalId);
  if (!pr) throw new HttpError(404, 'Proposta não encontrada.');
  if (pr.project_id) throw new HttpError(400, 'Esta proposta já gerou um projeto.');
  return tx(() => {
    const projectId = insert('projects', {
      code: nextCode('projects', 'P'), name: pr.title, client_id: pr.client_id, address: pr.address, city: pr.city,
      type: pr.project_type, area: pr.area, contract_value: pr.amount, contracted_at: today(), start_date: today(),
      manager_id: opts.manager_id || pr.responsible_id || user.id, status: 'ativo', proposal_id: pr.id, created_by: user.id,
      notes: pr.notes,
    });
    createPhasesFromTemplate(projectId, today());
    run('INSERT OR IGNORE INTO project_members(project_id, user_id) VALUES (?,?)', projectId, opts.manager_id || pr.responsible_id || user.id);
    run("UPDATE proposals SET project_id = ?, status = 'aprovada', decided_at = COALESCE(decided_at, ?) WHERE id = ?", projectId, today(), pr.id);
    let contractId = null;
    if (opts.create_contract) {
      contractId = insert('contracts', {
        number: nextCode('contracts', 'CT'), client_id: pr.client_id, project_id: projectId, proposal_id: pr.id, amount: pr.amount,
        installments: pr.installments || 1, first_due_date: opts.first_due_date || addDays(today(), 7), status: 'aguardando_assinatura',
        start_date: today(), payment_method: opts.payment_method || 'pix',
      });
      generateContractReceivables(contractId);
    }
    run('INSERT INTO client_interactions(client_id, project_id, date, type, description, user_id) VALUES (?,?,?,?,?,?)',
      pr.client_id, projectId, today(), 'feedback', `Proposta ${pr.number || ''} aprovada — projeto criado`, user.id);
    return { project_id: projectId, contract_id: contractId };
  });
}

// ------------------ Contrato com parcelas → contas a receber ------------------
function generateContractReceivables(contractId, { force = false } = {}) {
  const c = get('SELECT * FROM contracts WHERE id = ?', contractId);
  if (!c) throw new HttpError(404, 'Contrato não encontrado.');
  if (c.receivables_generated && !force) throw new HttpError(400, 'As parcelas deste contrato já foram geradas.');
  if (!(c.amount > 0)) return [];
  const n = Math.max(1, c.installments || 1);
  const project = c.project_id ? get('SELECT name, type FROM projects WHERE id = ?', c.project_id) : null;
  const category = project && /interiores/i.test(project.type || '') ? 'Projeto de interiores' : 'Projeto de arquitetura';
  const ids = finance.generateInstallments('incomes', {
    client_id: c.client_id, project_id: c.project_id, contract_id: c.id, category, method: c.payment_method,
    description: `${project ? project.name : 'Contrato'} — ${c.number || 'contrato'}`,
    status: ['elaboracao', 'aguardando_assinatura'].includes(c.status) ? 'previsto' : 'a_receber',
  }, { total: c.amount, count: n, first_due: c.first_due_date || c.start_date || today() });
  run('UPDATE contracts SET receivables_generated = 1 WHERE id = ?', c.id);
  if (c.project_id) run('UPDATE projects SET contract_value = ? WHERE id = ? AND (contract_value IS NULL OR contract_value = 0)', c.amount, c.project_id);
  return ids;
}

module.exports = { nextCode, createPhasesFromTemplate, createWorkPhasesFromTemplate, recomputeProjectProgress, recomputeWorkProgress, allPhasesDone, profitability, convertProposal, generateContractReceivables, DONE_PHASE };
