// Automações do sistema: status financeiros, recorrências, propostas expiradas,
// alertas/notificações e backups automáticos.
const fs = require('fs');
const path = require('path');
const { db, all, get, run, getSetting, DATA_DIR } = require('../db');
const { today, addDays, nowIso } = require('../util');
const finance = require('./finance');
const proj = require('./projects');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, '..', 'backups');
const brl = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const br = (d) => d ? d.slice(0, 10).split('-').reverse().join('/') : '';

let collecting = null; // chaves geradas na rodada atual (para limpar alertas que deixaram de valer)
const AUTO_KINDS = ['tarefa_atrasada', 'tarefa_vencendo', 'cliente_inadimplente', 'recebimento_proximo', 'pagamento_vencendo', 'proposta_expirando', 'entrega_proxima', 'reuniao_proxima', 'contrato_pendente', 'documento_vencendo', 'projeto_concluido'];
function notify(userId, { kind, severity = 'info', title, body, link, key }) {
  if (!userId) return;
  if (collecting && key) collecting.add(`${userId}|${key}`);
  run('INSERT OR IGNORE INTO notifications(user_id, kind, severity, title, body, link, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?,?)',
    userId, kind, severity, title, body || null, link || null, key || null, nowIso());
}
const financeUsers = () => all("SELECT id FROM users WHERE active = 1 AND (role = 'admin' OR (role = 'gestor' AND can_finance = 1))").map((u) => u.id);
const managerUsers = () => all("SELECT id FROM users WHERE active = 1 AND role IN ('admin','gestor')").map((u) => u.id);
const days = (k, d) => parseInt(getSetting(k, d), 10) || Number(d);

function buildNotifications() {
  collecting = new Set();
  try { buildInner(); } finally {
    // remove alertas automáticos não lidos cuja condição não existe mais (ex.: parcela já paga)
    const stale = all(`SELECT id, user_id, dedupe_key FROM notifications WHERE read_at IS NULL AND kind IN (${AUTO_KINDS.map(() => '?').join(',')})`, ...AUTO_KINDS)
      .filter((n) => !collecting.has(`${n.user_id}|${n.dedupe_key}`)).map((n) => n.id);
    for (let i = 0; i < stale.length; i += 500) { const chunk = stale.slice(i, i + 500); run(`DELETE FROM notifications WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk); }
    collecting = null;
  }
}
function buildInner() {
  const t = today();
  const fin = financeUsers(); const mgr = managerUsers();

  for (const x of all("SELECT t.*, p.name pname FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.status <> 'concluida' AND t.archived = 0 AND t.due_date IS NOT NULL AND t.due_date <= ?", addDays(t, days('alert_days_tasks', 2)))) {
    const late = x.due_date < t;
    notify(x.assignee_id || x.created_by, {
      kind: late ? 'tarefa_atrasada' : 'tarefa_vencendo', severity: late ? 'danger' : 'warning',
      title: late ? `Tarefa atrasada: ${x.title}` : `Tarefa vence ${x.due_date === t ? 'hoje' : 'em ' + br(x.due_date)}: ${x.title}`,
      body: x.pname ? `Projeto ${x.pname}` : null, link: `#/tarefas/${x.id}`, key: `${late ? 'task_late' : 'task_due'}_${x.id}_${x.due_date}`,
    });
  }
  for (const x of all("SELECT i.*, c.name cname FROM incomes i LEFT JOIN clients c ON c.id = i.client_id WHERE i.status = 'vencido'")) {
    fin.forEach((u) => notify(u, { kind: 'cliente_inadimplente', severity: 'danger', title: `Parcela vencida — ${x.cname || x.description}`,
      body: `${brl(x.amount)} venceu em ${br(x.due_date)} · ${x.description}`, link: `#/financeiro/entradas?id=${x.id}`, key: `inc_late_${x.id}_${x.due_date}` }));
  }
  for (const x of all("SELECT i.*, c.name cname FROM incomes i LEFT JOIN clients c ON c.id = i.client_id WHERE i.status IN ('a_receber') AND i.due_date BETWEEN ? AND ?", t, addDays(t, days('alert_days_payments', 5)))) {
    fin.forEach((u) => notify(u, { kind: 'recebimento_proximo', severity: 'info', title: `Recebimento ${x.due_date === t ? 'hoje' : 'em ' + br(x.due_date)} — ${x.cname || ''}`,
      body: `${brl(x.amount)} · ${x.description}`, link: `#/financeiro/entradas?id=${x.id}`, key: `inc_due_${x.id}_${x.due_date}` }));
  }
  for (const x of all("SELECT e.*, s.company sname FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id WHERE e.paid_by = 'escritorio' AND e.status IN ('a_pagar','vencido','previsto') AND e.due_date <= ?", addDays(t, days('alert_days_payments', 5)))) {
    const late = x.due_date < t;
    fin.forEach((u) => notify(u, { kind: 'pagamento_vencendo', severity: late ? 'danger' : x.due_date === t ? 'warning' : 'info',
      title: late ? `Pagamento em atraso: ${x.description}` : `Pagamento ${x.due_date === t ? 'vence hoje' : 'vence em ' + br(x.due_date)}: ${x.description}`,
      body: `${brl(x.amount)}${x.sname ? ' · ' + x.sname : ''}`, link: `#/financeiro/saidas?id=${x.id}`, key: `exp_${late ? 'late' : 'due'}_${x.id}_${x.due_date}` }));
  }
  for (const x of all("SELECT pr.*, c.name cname FROM proposals pr LEFT JOIN clients c ON c.id = pr.client_id WHERE pr.status IN ('enviada','visualizada','negociacao') AND pr.valid_until BETWEEN ? AND ?", t, addDays(t, days('alert_days_proposals', 5)))) {
    mgr.forEach((u) => notify(u, { kind: 'proposta_expirando', severity: 'warning', title: `Proposta expira em ${br(x.valid_until)} — ${x.cname}`,
      body: `${x.number} · ${x.title} · ${brl(x.amount)}`, link: `#/propostas/${x.id}`, key: `prop_exp_${x.id}_${x.valid_until}` }));
  }
  for (const x of all("SELECT p.* FROM projects p WHERE p.status NOT IN ('encerrado','cancelado') AND p.archived = 0 AND p.due_date BETWEEN ? AND ?", addDays(t, -30), addDays(t, days('alert_days_deliveries', 7)))) {
    const late = x.due_date < t;
    const users = new Set([x.manager_id, ...all('SELECT user_id FROM project_members WHERE project_id = ?', x.id).map((r) => r.user_id)]);
    users.forEach((u) => notify(u, { kind: 'entrega_proxima', severity: late ? 'danger' : 'warning',
      title: late ? `Projeto com entrega atrasada: ${x.name}` : `Entrega do projeto em ${br(x.due_date)}: ${x.name}`, link: `#/projetos/${x.id}`, key: `proj_due_${x.id}_${x.due_date}` }));
  }
  for (const x of all("SELECT ph.*, p.name pname FROM project_phases ph JOIN projects p ON p.id = ph.project_id WHERE ph.status NOT IN ('concluido','aprovado') AND p.status NOT IN ('encerrado','cancelado') AND ph.due_date BETWEEN ? AND ?", addDays(t, -30), addDays(t, days('alert_days_deliveries', 7)))) {
    notify(x.responsible_id, { kind: 'entrega_proxima', severity: x.due_date < t ? 'danger' : 'warning', title: `Etapa "${x.name}" ${x.due_date < t ? 'atrasada' : 'vence em ' + br(x.due_date)}`,
      body: x.pname, link: `#/projetos/${x.project_id}`, key: `phase_due_${x.id}_${x.due_date}` });
  }
  const tomorrow = addDays(t, 1);
  for (const x of all("SELECT * FROM events WHERE status = 'agendado' AND substr(start_at,1,10) BETWEEN ? AND ?", t, tomorrow)) {
    const users = all('SELECT user_id FROM event_users WHERE event_id = ?', x.id).map((r) => r.user_id);
    if (!users.length) users.push(x.created_by);
    const when = x.start_at.slice(0, 10) === t ? 'hoje' : 'amanhã';
    users.forEach((u) => notify(u, { kind: 'reuniao_proxima', severity: 'info', title: `${when === 'hoje' ? 'Hoje' : 'Amanhã'} ${x.all_day ? '' : 'às ' + x.start_at.slice(11, 16)} — ${x.title}`,
      body: x.location || null, link: `#/agenda?data=${x.start_at.slice(0, 10)}`, key: `ev_${x.id}_${x.start_at}` }));
  }
  for (const x of all("SELECT ct.*, c.name cname FROM contracts ct LEFT JOIN clients c ON c.id = ct.client_id WHERE ct.status = 'aguardando_assinatura' AND ct.created_at <= ?", addDays(t, -2) + ' 23:59:59')) {
    mgr.forEach((u) => notify(u, { kind: 'contrato_pendente', severity: 'warning', title: `Contrato aguardando assinatura — ${x.cname}`,
      body: `${x.number} · ${brl(x.amount)}`, link: `#/contratos/${x.id}`, key: `ct_pend_${x.id}_${t.slice(0, 7)}` }));
  }
  for (const x of all('SELECT * FROM documents WHERE archived = 0 AND expires_at IS NOT NULL AND expires_at <= ?', addDays(t, days('alert_days_documents', 30)))) {
    mgr.forEach((u) => notify(u, { kind: 'documento_vencendo', severity: x.expires_at < t ? 'danger' : 'warning',
      title: `${x.expires_at < t ? 'Documento vencido' : 'Documento vence em ' + br(x.expires_at)}: ${x.title}`, link: `#/documentos?id=${x.id}`, key: `doc_exp_${x.id}_${x.expires_at}` }));
  }
  for (const x of all("SELECT * FROM projects WHERE status NOT IN ('encerrado','cancelado') AND archived = 0")) {
    if (proj.allPhasesDone(x.id)) notify(x.manager_id, { kind: 'projeto_concluido', severity: 'success', title: `Todas as etapas de "${x.name}" foram concluídas`,
      body: 'Sugestão: alterar o status do projeto para Encerrado.', link: `#/projetos/${x.id}`, key: `proj_done_${x.id}` });
  }
  // limpa notificações lidas com mais de 90 dias
  run("DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < datetime('now','-90 days')");
}

let lastRun = 0;
function runAutomations(force = false) {
  if (!force && Date.now() - lastRun < 60 * 1000) return;
  lastRun = Date.now();
  try {
    finance.refreshStatuses();
    finance.generateRecurring();
    run("UPDATE proposals SET status = 'expirada', decided_at = ? WHERE status IN ('enviada','visualizada') AND valid_until < ?", today(), today());
    buildNotifications();
  } catch (e) { console.error('Automação falhou:', e); }
}

function backupNow(label) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `cnij-${label || today()}.sqlite`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const keep = parseInt(getSetting('backup_keep', '30'), 10) || 30;
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => /^cnij-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort();
  while (files.length > keep) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  return file;
}
function dailyBackup() {
  const file = path.join(BACKUP_DIR, `cnij-${today()}.sqlite`);
  if (!fs.existsSync(file)) { try { backupNow(); console.log('Backup diário criado:', file); } catch (e) { console.error('Backup falhou:', e.message); } }
}

function start() {
  runAutomations(true);
  dailyBackup();
  setInterval(() => { runAutomations(true); dailyBackup(); }, 10 * 60 * 1000).unref();
}

module.exports = { start, runAutomations, notify, backupNow, BACKUP_DIR, managerUsers, financeUsers };
