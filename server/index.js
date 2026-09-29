// =====================================================================
// CN&IJ Gestão — Central de gestão do escritório
// Carla Nogueira & Irineu Junior · Arquitetura | Interiores
// =====================================================================
process.env.TZ = process.env.TZ || 'America/Cuiaba';
const fs = require('fs');
const path = require('path');
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

if (process.argv.includes('--demo') && !process.env.DB_FILE) process.env.DB_FILE = path.join(__dirname, '..', 'data', 'demo.sqlite');
const express = require('express');
const cookieParser = require('cookie-parser');
const { get, val, insert, getSetting } = require('./db');
// fuso horário configurado para o escritório (Configurações › Escritório)
{ const tz = getSetting('office_timezone', ''); if (tz && !process.env.TZ_LOCK) process.env.TZ = tz; }
require('./services/docs').seedTemplates();
const { HttpError, wrap, audit } = require('./util');
const auth = require('./auth');
const crud = require('./crud');
const automation = require('./services/automation');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

// Cabeçalhos de segurança
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Proteção CSRF: toda requisição de escrita precisa do cabeçalho enviado pelo app
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'cnij') return next(new HttpError(403, 'Requisição inválida.'));
  next();
});
app.use('/api', auth.authenticate);
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// Primeira configuração: cria o administrador inicial (somente quando não há usuários)
app.get('/api/setup', (req, res) => res.json({ needed: val('SELECT COUNT(*) FROM users') === 0 }));
app.post('/api/setup', wrap((req, res) => {
  if (val('SELECT COUNT(*) FROM users') > 0) throw new HttpError(400, 'O sistema já foi configurado.');
  const { name, email, password } = req.body || {};
  if (!name || !email) throw new HttpError(400, 'Informe nome e e-mail.');
  auth.validatePassword(password);
  const id = insert('users', { name, email: email.trim().toLowerCase(), password_hash: auth.hashPassword(password), role: 'admin', can_finance: 1, color: '#111111' });
  audit({ user: { id }, ip: req.ip }, 'setup', 'users', id, 'Administrador inicial criado');
  res.json({ ok: true });
}));

// Logo do escritório (cadastrada em Configurações › Escritório; usada no menu, no login e nos PDFs)
app.get('/logo', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(require('./pdf').logoPath()); });

app.use('/api/auth', auth.router);
app.use('/api/portal', require('./routes/portal'));
app.use('/api', auth.requireStaff);
app.use('/api', require('./routes/core'));
app.use('/api', require('./routes/ops').router);
app.use('/api', require('./routes/docs').router);
app.use('/api/reports', require('./routes/reports'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/r', crud.router);
app.use('/api', (req, res, next) => next(new HttpError(404, 'Rota não encontrada.')));

// Frontend
const PUBLIC = path.join(__dirname, '..', 'public');
// HTML/CSS/JS sempre revalidados (atualizações aparecem na hora); imagens e fontes ficam em cache
app.use(express.static(PUBLIC, { index: 'index.html', setHeaders(res, file) {
  if (/\.(html|css|js|webmanifest)$/i.test(file)) res.setHeader('Cache-Control', 'no-cache');
  else res.setHeader('Cache-Control', 'public, max-age=86400');
} }));
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

// Tratamento de erros
app.use((err, req, res, next) => {
  let status = err.status || 500;
  let msg = err.message;
  if (err.code === 'LIMIT_FILE_SIZE') { status = 400; msg = 'Arquivo muito grande.'; }
  if (/UNIQUE constraint/i.test(msg || '')) { status = 400; msg = 'Registro duplicado.'; }
  if (/FOREIGN KEY constraint/i.test(msg || '')) { status = 400; msg = 'Existem registros vinculados. Arquive em vez de excluir.'; }
  if (status >= 500) { console.error(err); msg = 'Erro interno. Tente novamente.'; }
  res.status(status).json({ error: msg });
});

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  automation.start();
  app.listen(PORT, () => console.log(`\n  CN&IJ Gestão rodando em http://localhost:${PORT}\n`));
}
module.exports = app;
