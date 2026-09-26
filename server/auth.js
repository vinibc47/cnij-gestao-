const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const { get, run, insert, getSetting } = require('./db');
const { HttpError, wrap, audit, nowIso } = require('./util');
const { modulesFor, canFinance } = require('./permissions');
const mailer = require('./services/mailer');

const COOKIE = 'cnij_sid';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SESSION_HOURS = 12;
const REMEMBER_DAYS = 30;

function sqlTs(d) { return d.toISOString().replace('T', ' ').slice(0, 19); }

function validatePassword(pw) {
  if (!pw || pw.length < 8) throw new HttpError(400, 'A senha deve ter pelo menos 8 caracteres.');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new HttpError(400, 'A senha deve conter letras e números.');
}
const hashPassword = (pw) => bcrypt.hashSync(pw, 11);

// Limite simples de tentativas de login (por IP + e-mail)
const attempts = new Map();
function checkRate(key) {
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(key, a);
  if (a.length >= 8) throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos e tente novamente.');
}
function failRate(key) { (attempts.get(key) || attempts.set(key, []).get(key)).push(Date.now()); }

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, can_finance: !!u.can_finance, client_id: u.client_id,
    color: u.color, job_title: u.job_title, must_change_pw: !!u.must_change_pw,
    modules: modulesFor(u), finance: canFinance(u),
  };
}

function authenticate(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  if (token) {
    const s = get(`SELECT s.id sid, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
                   WHERE s.token_hash = ? AND u.active = 1`, sha(token));
    if (s && s.expires_at > sqlTs(new Date())) {
      req.user = s; req.sessionId = s.sid;
      delete req.user.password_hash;
    }
  }
  next();
}
function requireAuth(req, res, next) { return req.user ? next() : next(new HttpError(401, 'Sessão expirada. Faça login novamente.')); }
function requireStaff(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Sessão expirada.'));
  if (req.user.role === 'cliente') return next(new HttpError(403, 'Acesso restrito à equipe do escritório.'));
  next();
}

function createSession(req, res, user, remember) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + (remember ? REMEMBER_DAYS * 24 : SESSION_HOURS) * 3600 * 1000);
  insert('sessions', { token_hash: sha(token), user_id: user.id, expires_at: sqlTs(exp), ip: req.ip, ua: String(req.headers['user-agent'] || '').slice(0, 200) });
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1',
    expires: remember ? exp : undefined, path: '/',
  });
}

const router = express.Router();

router.post('/login', wrap((req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const key = `${req.ip}|${email}`;
  checkRate(key);
  const u = get('SELECT * FROM users WHERE email = ? AND active = 1', email);
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) {
    failRate(key);
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }
  attempts.delete(key);
  run('DELETE FROM sessions WHERE expires_at < ?', sqlTs(new Date()));
  createSession(req, res, u, !!req.body.remember);
  run('UPDATE users SET last_login = ? WHERE id = ?', nowIso(), u.id);
  req.user = u; audit(req, 'login', 'users', u.id, `Login de ${u.name}`);
  res.json({ user: publicUser(u) });
}));

router.post('/logout', (req, res) => {
  const token = req.cookies && req.cookies[COOKIE];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user), office: { name: getSetting('office_name'), tagline: getSetting('office_tagline') } });
});

router.post('/forgot', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  checkRate('forgot|' + req.ip); failRate('forgot|' + req.ip);
  const u = get('SELECT * FROM users WHERE email = ? AND active = 1', email);
  if (u) {
    const link = createResetLink(u.id, req);
    await mailer.send(u.email, 'Redefinição de senha', `Olá, ${u.name}.\n\nPara criar uma nova senha, acesse:\n${link}\n\nO link expira em 2 horas. Se você não solicitou, ignore esta mensagem.`);
  }
  // Resposta sempre igual para não revelar e-mails cadastrados
  res.json({ ok: true, message: 'Se o e-mail estiver cadastrado, enviaremos as instruções de redefinição.' });
}));

function createResetLink(userId, req) {
  const token = crypto.randomBytes(24).toString('hex');
  insert('password_resets', { user_id: userId, token_hash: sha(token), expires_at: sqlTs(new Date(Date.now() + 2 * 3600 * 1000)) });
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/#/redefinir-senha?token=${token}`;
}

router.post('/reset', wrap((req, res) => {
  const r = get('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0', sha(String(req.body.token || '')));
  if (!r || r.expires_at < sqlTs(new Date())) throw new HttpError(400, 'Link inválido ou expirado. Solicite um novo.');
  validatePassword(req.body.password);
  run('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?', hashPassword(req.body.password), r.user_id);
  run('UPDATE password_resets SET used = 1 WHERE id = ?', r.id);
  run('DELETE FROM sessions WHERE user_id = ?', r.user_id);
  audit({ user: { id: r.user_id }, ip: req.ip }, 'password_reset', 'users', r.user_id, 'Senha redefinida por link');
  res.json({ ok: true });
}));

router.post('/change-password', requireAuth, wrap((req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!bcrypt.compareSync(String(req.body.current || ''), u.password_hash)) throw new HttpError(400, 'Senha atual incorreta.');
  validatePassword(req.body.password);
  run('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?', hashPassword(req.body.password), u.id);
  run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', u.id, req.sessionId);
  audit(req, 'password_change', 'users', u.id, 'Senha alterada');
  res.json({ ok: true });
}));

module.exports = { router, authenticate, requireAuth, requireStaff, hashPassword, validatePassword, publicUser, createResetLink, sha };
