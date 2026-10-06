// Configurações: usuários, parâmetros, listas, modelos de etapas, auditoria e backups
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { all, get, run, insert, update, getSetting, setSetting, val } = require('../db');
const { wrap, HttpError, audit, nowIso } = require('../util');
const P = require('../permissions');
const { hashPassword, validatePassword, createResetLink } = require('../auth');
const automation = require('../services/automation');
const mailer = require('../services/mailer');

const router = express.Router();
const COLORS = ['#111111', '#8a7560', '#5f7a6e', '#6d6a8a', '#9a6b5b', '#4f6b85', '#7d7d7d', '#a08c5b'];

// ------------------------------ USUÁRIOS ------------------------------
function canManageUser(u, role) { return u.role === 'admin' || (P.isManager(u) && role === 'cliente'); }
router.get('/users', wrap((req, res) => {
  if (!P.isManager(req.user)) throw new HttpError(403, 'Sem permissão.');
  const where = req.user.role === 'admin' ? '' : "WHERE u.role = 'cliente'";
  res.json(all(`SELECT u.id, u.name, u.email, u.role, u.can_finance, u.client_id, u.phone, u.job_title, u.hourly_cost, u.color, u.active, u.last_login, u.created_at,
    c.name client_name, (SELECT COUNT(*) FROM project_members m WHERE m.user_id = u.id) projects_count
    FROM users u LEFT JOIN clients c ON c.id = u.client_id ${where} ORDER BY u.active DESC, u.role = 'cliente', u.name`));
}));
router.post('/users', wrap(async (req, res) => {
  const b = req.body || {};
  if (!canManageUser(req.user, b.role)) throw new HttpError(403, 'Sem permissão para criar este tipo de usuário.');
  if (!b.name || !b.email) throw new HttpError(400, 'Informe nome e e-mail.');
  if (get('SELECT 1 FROM users WHERE email = ?', b.email.trim())) throw new HttpError(400, 'Já existe um usuário com este e-mail.');
  if (b.role === 'cliente' && !b.client_id) throw new HttpError(400, 'Selecione o cliente vinculado ao acesso.');
  let temp = b.password;
  if (temp) validatePassword(temp); else temp = 'Cn' + crypto.randomBytes(4).toString('hex') + '9';
  const id = insert('users', {
    name: b.name.trim(), email: b.email.trim().toLowerCase(), password_hash: hashPassword(temp), role: b.role || 'colaborador',
    can_finance: b.can_finance ? 1 : 0, client_id: b.role === 'cliente' ? Number(b.client_id) : null, phone: b.phone || null, job_title: b.job_title || null,
    hourly_cost: Number(b.hourly_cost) || 0, color: b.color || COLORS[val('SELECT COUNT(*) FROM users') % COLORS.length], must_change_pw: 1,
  });
  audit(req, 'create', 'users', id, `Usuário criado: ${b.name} (${b.role})`);
  const link = createResetLink(id, req);
  await mailer.send(b.email, 'Seu acesso ao sistema', `Olá, ${b.name}.\n\nSeu acesso foi criado.\nE-mail: ${b.email}\nSenha provisória: ${temp}\n\nOu defina sua senha pelo link: ${link}`);
  res.status(201).json({ id, temp_password: temp, reset_link: link });
}));
router.put('/users/:id', wrap((req, res) => {
  const target = get('SELECT * FROM users WHERE id = ?', req.params.id); if (!target) throw new HttpError(404, 'Usuário não encontrado.');
  const b = req.body || {};
  if (!canManageUser(req.user, target.role) || (b.role && !canManageUser(req.user, b.role))) throw new HttpError(403, 'Sem permissão.');
  if (target.id === req.user.id && (b.role && b.role !== 'admin' || b.active === 0)) throw new HttpError(400, 'Você não pode remover seu próprio acesso de administrador.');
  const d = {};
  ['name', 'phone', 'job_title', 'color', 'role'].forEach((k) => { if (k in b) d[k] = b[k]; });
  if ('email' in b) { const e = String(b.email).trim().toLowerCase(); if (get('SELECT 1 FROM users WHERE email = ? AND id <> ?', e, target.id)) throw new HttpError(400, 'E-mail já utilizado.'); d.email = e; }
  if ('can_finance' in b) d.can_finance = b.can_finance ? 1 : 0;
  if ('active' in b) d.active = b.active ? 1 : 0;
  if ('hourly_cost' in b) d.hourly_cost = Number(b.hourly_cost) || 0;
  if ('client_id' in b) d.client_id = b.client_id ? Number(b.client_id) : null;
  if (b.password) { validatePassword(b.password); d.password_hash = hashPassword(b.password); d.must_change_pw = 1; }
  d.updated_at = nowIso();
  update('users', target.id, d);
  if (d.active === 0 || d.password_hash || d.role) run('DELETE FROM sessions WHERE user_id = ?', target.id);
  const ch = { ...d }; delete ch.password_hash; delete ch.updated_at;
  audit(req, 'update', 'users', target.id, `Usuário alterado: ${target.name}`, ch);
  res.json({ ok: true });
}));
router.post('/users/:id/reset-link', wrap((req, res) => {
  const target = get('SELECT * FROM users WHERE id = ?', req.params.id); if (!target) throw new HttpError(404, 'Usuário não encontrado.');
  if (!canManageUser(req.user, target.role)) throw new HttpError(403, 'Sem permissão.');
  audit(req, 'reset_link', 'users', target.id, `Link de redefinição gerado para ${target.name}`);
  res.json({ link: createResetLink(target.id, req) });
}));
router.post('/users/:id/projects', wrap((req, res) => {
  if (!P.isManager(req.user)) throw new HttpError(403, 'Sem permissão.');
  const ids = (req.body.project_ids || []).map(Number);
  run('DELETE FROM project_members WHERE user_id = ?', req.params.id);
  ids.forEach((pid) => run('INSERT OR IGNORE INTO project_members(project_id, user_id) VALUES (?,?)', pid, req.params.id));
  audit(req, 'update', 'users', Number(req.params.id), `Projetos autorizados atualizados (${ids.length})`);
  res.json({ ok: true });
}));
router.get('/users/:id/projects', wrap((req, res) => {
  if (!P.isManager(req.user)) throw new HttpError(403, 'Sem permissão.');
  res.json(all('SELECT project_id FROM project_members WHERE user_id = ?', req.params.id).map((r) => r.project_id));
}));

// ------------------------------ PARÂMETROS ------------------------------
const SETTINGS = ['office_name', 'office_tagline', 'office_doc', 'office_address', 'office_phone', 'office_email', 'opening_balance', 'opening_balance_date',
  'alert_days_payments', 'alert_days_tasks', 'alert_days_deliveries', 'alert_days_documents', 'alert_days_proposals', 'recurring_months_ahead', 'backup_keep',
  'office_city', 'office_timezone', 'office_pix_key', 'office_pix_type', 'office_pix_name', 'office_pix_bank', 'contractor_name', 'contractor_doc', 'contractor_address', 'contractor_registry', 'sign_display_name', 'portal_whatsapp',
  'proposal_validity_days', 'whatsapp_template', 'whatsapp_template_overdue'];
const TIMEZONES = ['America/Campo_Grande', 'America/Cuiaba', 'America/Sao_Paulo', 'America/Manaus', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Noronha'];
router.get('/settings', P.requireAdmin, (req, res) => res.json({ ...Object.fromEntries(SETTINGS.map((k) => [k, getSetting(k, '')])), office_logo: getSetting('office_logo', ''), _timezones: TIMEZONES, _wa_defaults: { today: require('../services/docs').WA_TODAY, overdue: require('../services/docs').WA_OVERDUE } }));
router.put('/settings', P.requireAdmin, wrap((req, res) => {
  const ch = {};
  if ('office_timezone' in req.body && req.body.office_timezone && !TIMEZONES.includes(req.body.office_timezone)) throw new HttpError(400, 'Fuso horário inválido.');
  for (const k of SETTINGS) if (k in req.body) { const v = typeof req.body[k] === 'string' ? req.body[k].replace(/\r\n/g, '\n').slice(0, 8000) : req.body[k]; ch[k] = [getSetting(k), v]; setSetting(k, v); }
  if (req.body.office_timezone && !process.env.TZ_LOCK) process.env.TZ = req.body.office_timezone;
  audit(req, 'update', 'settings', null, 'Configurações alteradas', ch);
  automation.runAutomations(true);
  res.json({ ok: true });
}));

// ------------------------------ LISTAS (categorias etc.) ------------------------------
const canLists = (u) => P.isManager(u);
router.get('/options', wrap((req, res) => res.json(all('SELECT * FROM options ORDER BY kind, position, name'))));
router.post('/options', wrap((req, res) => {
  if (!canLists(req.user)) throw new HttpError(403, 'Sem permissão.');
  const { kind, name } = req.body || {};
  if (!kind || !name || !String(name).trim()) throw new HttpError(400, 'Informe o nome.');
  const pos = (val('SELECT MAX(position) FROM options WHERE kind = ?', kind) ?? -1) + 1;
  run('INSERT INTO options(kind, name, position) VALUES (?,?,?) ON CONFLICT(kind,name) DO UPDATE SET archived = 0', kind, String(name).trim(), pos);
  audit(req, 'create', 'options', null, `Item adicionado à lista ${kind}: ${name}`);
  res.status(201).json(get('SELECT * FROM options WHERE kind = ? AND name = ?', kind, String(name).trim()));
}));
router.put('/options/:id', wrap((req, res) => {
  if (!canLists(req.user)) throw new HttpError(403, 'Sem permissão.');
  const o = get('SELECT * FROM options WHERE id = ?', req.params.id); if (!o) throw new HttpError(404, 'Item não encontrado.');
  const d = {};
  if (req.body.name) d.name = String(req.body.name).trim();
  if ('archived' in req.body) d.archived = req.body.archived ? 1 : 0;
  if ('position' in req.body) d.position = Number(req.body.position);
  update('options', o.id, d);
  // mantém os registros existentes coerentes quando uma categoria é renomeada
  if (d.name && d.name !== o.name) {
    const map = { despesa: [['expenses', 'category'], ['recurring_expenses', 'category']], receita: [['incomes', 'category']], projeto_tipo: [['projects', 'type'], ['proposals', 'project_type']],
      fornecedor: [['suppliers', 'category'], ['quotes', 'item']], documento: [['documents', 'category']], origem_cliente: [['clients', 'origin']] }[o.kind] || [];
    map.forEach(([t, c]) => run(`UPDATE ${t} SET ${c} = ? WHERE ${c} = ?`, d.name, o.name));
  }
  audit(req, 'update', 'options', o.id, `Lista ${o.kind}: ${o.name}`, d);
  res.json({ ok: true });
}));

// ------------------------------ MODELOS DE ETAPAS ------------------------------
router.get('/phase-templates', wrap((req, res) => res.json(all('SELECT * FROM phase_templates ORDER BY kind, position'))));
router.put('/phase-templates/:kind', P.requireAdmin, wrap((req, res) => {
  const kind = req.params.kind === 'obra' ? 'obra' : 'projeto';
  const items = (req.body.items || []).filter((i) => i && String(i.name || '').trim());
  run('DELETE FROM phase_templates WHERE kind = ?', kind);
  items.forEach((it, i) => insert('phase_templates', { kind, name: String(it.name).trim(), position: i, default_days: Number(it.default_days) || 0 }));
  audit(req, 'update', 'phase_templates', null, `Modelo de etapas (${kind}) atualizado`);
  res.json({ ok: true });
}));

// ------------------------------ AUDITORIA ------------------------------
router.get('/audit', P.requireAdmin, wrap((req, res) => {
  const w = []; const p = [];
  if (req.query.entity) { w.push('a.entity = ?'); p.push(req.query.entity); }
  if (req.query.user_id) { w.push('a.user_id = ?'); p.push(req.query.user_id); }
  if (req.query.q) { w.push('a.summary LIKE ?'); p.push(`%${req.query.q}%`); }
  res.json(all(`SELECT a.*, u.name user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY a.id DESC LIMIT 500`, ...p));
}));

// ------------------------------ BACKUPS ------------------------------
router.get('/backups', P.requireAdmin, wrap((req, res) => {
  const dir = automation.BACKUP_DIR; fs.mkdirSync(dir, { recursive: true });
  res.json(fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort().reverse().map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size, date: fs.statSync(path.join(dir, f)).mtime })));
}));
router.post('/backups', P.requireAdmin, wrap((req, res) => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = automation.backupNow('manual-' + stamp);
  audit(req, 'backup', null, null, 'Backup manual gerado');
  res.json({ name: path.basename(file) });
}));
router.get('/backups/:name', P.requireAdmin, wrap((req, res) => {
  const name = path.basename(req.params.name);
  const full = path.join(automation.BACKUP_DIR, name);
  if (!name.endsWith('.sqlite') || !fs.existsSync(full)) throw new HttpError(404, 'Backup não encontrado.');
  audit(req, 'download', null, null, `Download do backup ${name}`);
  res.download(full);
}));
router.get('/export', P.requireAdmin, wrap((req, res) => {
  const tables = all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('sessions','password_resets') AND name NOT LIKE 'sqlite_%'").map((t) => t.name);
  const out = { exported_at: nowIso(), tables: {} };
  tables.forEach((t) => { out.tables[t] = all(`SELECT * FROM ${t}`).map((r) => { delete r.password_hash; return r; }); });
  audit(req, 'export', null, null, 'Exportação completa de dados (JSON)');
  res.setHeader('Content-Disposition', `attachment; filename="cnij-dados-${nowIso().slice(0, 10)}.json"`);
  res.json(out);
}));

module.exports = router;
