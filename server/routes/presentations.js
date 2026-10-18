// Rotas do gerador de apresentações (painel interno). O cliente vê apenas o PDF publicado,
// pelos documentos liberados do portal ("Veja seu projeto").
const express = require('express');
const { all, get, run } = require('../db');
const { wrap, HttpError, audit, nowIso, today } = require('../util');
const P = require('../permissions');
const { R } = require('../resources');
const { fetchOne } = require('../crud');
const PR = require('../services/presentations');
const pdf = require('../pdf');

const router = express.Router();
router.use('/presentations', P.requireModule('apresentacoes'));
const proj = (req, id) => fetchOne(R.projects, req.user, Number(id)); // garante acesso ao projeto
const pres = (req, id) => { const r = PR.load(Number(id)); proj(req, r.project_id); return r; };

router.get('/presentations', wrap((req, res) => {
  const pid = Number(req.query.project_id);
  if (pid) { proj(req, pid); return res.json(all(`SELECT * FROM presentations WHERE project_id = ? ${req.query.archived === '1' ? '' : 'AND archived = 0'} ORDER BY number`, pid).map((r) => { const o = PR.out(r); delete o.data; return o; })); }
  const ps = P.projectScope(req.user, 'p.id');
  res.json(all(`SELECT pr.id, pr.number, pr.title, pr.status, pr.updated_at, pr.project_id, p.name project_name, p.code, c.name client_name FROM presentations pr JOIN projects p ON p.id = pr.project_id LEFT JOIN clients c ON c.id = p.client_id
    WHERE pr.archived = 0 AND ${ps.sql} ORDER BY pr.updated_at DESC LIMIT 200`, ...ps.params));
}));
router.get('/presentations/logo/assets', wrap((req, res) => {
  const L = PR.logoAssets(); res.setHeader('Cache-Control', 'private, max-age=600');
  res.json(L.logo ? { logo: { uri: `data:image/png;base64,${L.logo.buf.toString('base64')}`, w: L.logo.w, h: L.logo.h }, logoDark: { uri: `data:image/png;base64,${L.logoDark.buf.toString('base64')}`, w: L.logoDark.w, h: L.logoDark.h } } : {});
}));
router.get('/presentations/meta/:projectId', wrap((req, res) => {
  const p = proj(req, req.params.projectId);
  res.json({ project: { id: p.id, name: p.name, code: p.code, client_name: p.client_name }, images: PR.projectImages(p.id), rooms: PR.rooms(p.id), next_number: PR.nextNumber(p.id) });
}));
router.post('/presentations', wrap((req, res) => {
  const p = proj(req, (req.body || {}).project_id);
  const r = PR.create(req.user, p.id, { structure: (req.body || {}).structure === 'com_layout' ? 'com_layout' : 'sem_layout' });
  audit(req, 'create', 'presentations', r.id, `${r.title} criada — ${p.name} (${(req.body || {}).structure === 'com_layout' ? 'capa + planta + imagens' : 'capa + imagens'})`);
  res.status(201).json(r);
}));
router.get('/presentations/:id', wrap((req, res) => {
  const r = pres(req, req.params.id); const o = PR.out(r);
  res.json({ ...o, assets: PR.assetsFor(o.data) });
}));
router.put('/presentations/:id', wrap((req, res) => {
  const r = pres(req, req.params.id);
  const o = PR.save(req.user, r.id, req.body || {});
  res.json({ ...o, assets: PR.assetsFor(o.data) });
}));
router.post('/presentations/:id/duplicate', wrap((req, res) => {
  const r = pres(req, req.params.id);
  const o = PR.create(req.user, r.project_id, { duplicateOf: r.id });
  audit(req, 'create', 'presentations', o.id, `${o.title} criada como cópia da Apresentação ${String(r.number).padStart(2, '0')}`);
  res.status(201).json(o);
}));
router.post('/presentations/:id/archive', wrap((req, res) => {
  const r = pres(req, req.params.id); const v = req.body && req.body.archived === 0 ? 0 : 1;
  if (!v && get('SELECT 1 FROM presentations WHERE project_id = ? AND number = ? AND archived = 0 AND id <> ?', r.project_id, r.number, r.id)) throw new HttpError(400, `Já existe outra Apresentação ${String(r.number).padStart(2, '0')} ativa. Renumere antes de restaurar.`);
  run('UPDATE presentations SET archived = ?, updated_at = ? WHERE id = ?', v, nowIso(), r.id);
  audit(req, v ? 'archive' : 'unarchive', 'presentations', r.id, `${r.title} ${v ? 'arquivada' : 'restaurada'}`);
  res.json({ ok: true });
}));
router.get('/presentations/:id/images/:docId', wrap((req, res) => {
  const r = pres(req, req.params.id); const i = PR.docInfo(Number(req.params.docId));
  if (!i) throw new HttpError(400, 'Use imagens JPEG ou PNG.');
  if (i.project_id && i.project_id !== r.project_id && !get('SELECT 1 FROM documents WHERE id = ? AND category = ?', i.id, 'Capa de apresentação')) proj(req, i.project_id);
  res.json({ w: i.w, h: i.h, orientation: i.orientation });
}));
// PDF do rascunho atual (download) — mesmo desenho da prévia
router.get('/presentations/:id/pdf', wrap(async (req, res) => {
  const r = pres(req, req.params.id);
  const buf = await PR.renderPdf(r);
  audit(req, 'export', 'presentations', r.id, `PDF exportado — ${r.title}`);
  await pdf.sendBuffer(res, buf, PR.filename(r), req.query.download !== '0');
}));
router.post('/presentations/:id/publish', wrap(async (req, res) => {
  if (!P.isManager(req.user)) throw new HttpError(403, 'Somente gestores publicam no portal do cliente.');
  const r = pres(req, req.params.id);
  const o = await PR.publish(req.user, r.id, req.body || {});
  audit(req, 'publish', 'presentations', r.id, `${r.title} publicada no portal (versão ${o.version})`);
  res.json(o);
}));
router.post('/presentations/:id/unpublish', wrap((req, res) => {
  if (!P.isManager(req.user)) throw new HttpError(403, 'Somente gestores.');
  const r = pres(req, req.params.id); const o = PR.unpublish(req.user, r.id);
  audit(req, 'unpublish', 'presentations', r.id, `${r.title} retirada do portal`);
  res.json(o);
}));
router.get('/presentations/:id/versions', wrap((req, res) => { const r = pres(req, req.params.id); res.json(PR.versions(r.id)); }));
router.post('/presentations/:id/versions/:vid/restore', wrap((req, res) => {
  const r = pres(req, req.params.id); const o = PR.restoreVersion(req.user, r.id, Number(req.params.vid));
  audit(req, 'update', 'presentations', r.id, `${r.title}: versão anterior restaurada como rascunho`);
  res.json({ ...o, assets: PR.assetsFor(o.data) });
}));
// mensagem pronta para o WhatsApp (o envio é feito pela pessoa, no WhatsApp)
router.get('/presentations/:id/share', wrap((req, res) => {
  const r = pres(req, req.params.id); const p = PR.project(r.project_id);
  if (r.status !== 'publicada' || !r.published_doc_id) throw new HttpError(400, 'Publique a apresentação no portal antes de compartilhar o link.');
  const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const link = `${base}/?abrir=doc-${r.published_doc_id}`;
  const first = String(p.client_name || '').split(' ')[0];
  const digits = String(p.whatsapp || p.phone || '').replace(/\D/g, '');
  const phone = digits.length >= 10 ? `55${digits.replace(/^55/, '')}` : '';
  const hasUser = p.client_id ? !!get("SELECT 1 FROM users WHERE role = 'cliente' AND client_id = ? AND active = 1", p.client_id) : false;
  res.json({ link, phone, has_portal_user: hasUser,
    message: `Olá${first ? ', ' + first : ''}! A ${r.title || 'apresentação'} do projeto ${p.name} já está disponível na sua Área do Cliente, em “Veja seu projeto”:\n${link}\n\nQualquer dúvida, estamos à disposição.` });
}));
router.post('/presentations/:id/shared', wrap((req, res) => {
  const r = pres(req, req.params.id); const p = PR.project(r.project_id);
  if (p.client_id) run('INSERT INTO client_interactions(client_id, project_id, date, type, description, user_id) VALUES (?,?,?,?,?,?)', p.client_id, p.id, today(), 'whatsapp', `${r.title} — link preparado para envio pelo WhatsApp`, req.user.id);
  res.json({ ok: true });
}));

module.exports = { router };
