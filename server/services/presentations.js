// =====================================================================
// Apresentações: cadastro, versões, imagens e geração do PDF real.
// O desenho de cada slide vem de public/js/slides-core.js — o mesmo usado
// na prévia do editor —, então o PDF reproduz exatamente o que foi visto.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { all, get, run, insert, update, tx, getSetting } = require('../db');
const { HttpError, nowIso } = require('../util');
const S = require('../../public/js/slides-core.js');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
const J = (v, d) => { try { return JSON.parse(v); } catch { return d; } };
const pad = S.num2;

function project(id) {
  const p = get('SELECT p.id, p.name, p.code, p.client_id, c.name client_name, c.phone, c.whatsapp FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = ?', id);
  if (!p) throw new HttpError(404, 'Projeto não encontrado.');
  return p;
}
function nextNumber(projectId) { return (get('SELECT MAX(number) n FROM presentations WHERE project_id = ?', projectId).n || 0) + 1; }

// dados padrão de uma apresentação nova: capa + planta (pendente) — os ambientes entram conforme as imagens
function blank(p, number, withPlanta = false) {
  const coverDoc = defaultCoverDoc() || 'padrao';
  return { format: '4:3', code: p.code || '', project_name: p.name, number,
    cover: { image: { doc_id: coverDoc, fy: 85, zoom: 1.05 }, veil: 0.7, title: 'Apresentação', subtitle: p.name },
    slides: S.defaultSlides(withPlanta) };
}
// foto de capa padrão (definida em Configurações › Escritório ou a última usada)
function defaultCoverDoc() {
  const id = Number(getSetting('presentation_cover_doc', '')) || null;
  return id && get('SELECT 1 FROM documents WHERE id = ? AND archived = 0', id) ? id : null;
}

function out(r) {
  const data = J(r.data, {});
  return { id: r.id, project_id: r.project_id, number: r.number, title: r.title || `Apresentação ${pad(r.number)}`, status: r.status, rev: r.rev, archived: r.archived,
    published_version: r.published_version, published_doc_id: r.published_doc_id, published_at: r.published_at,
    has_unpublished: r.status === 'publicada' && r.published_rev !== r.rev, updated_at: r.updated_at, created_at: r.created_at, data };
}
function load(id) { const r = get('SELECT * FROM presentations WHERE id = ?', id); if (!r) throw new HttpError(404, 'Apresentação não encontrada.'); return r; }

function create(user, projectId, { duplicateOf, structure } = {}) {
  const p = project(projectId);
  return tx(() => {
    const number = nextNumber(p.id);
    let data = blank(p, number, structure === 'com_layout'); let from = null; // padrão: capa + imagens do projeto
    if (duplicateOf) {
      const src = load(duplicateOf); if (src.project_id !== p.id) throw new HttpError(400, 'Apresentação de outro projeto.');
      data = { ...J(src.data, {}), number }; from = src.id; // cópia independente (nada é compartilhado com a original)
    }
    const id = insert('presentations', { project_id: p.id, number, title: `Apresentação ${pad(number)}`, data: JSON.stringify(data), rev: 1, status: 'rascunho', duplicated_from: from,
      created_by: user.id, updated_by: user.id, created_at: nowIso(), updated_at: nowIso() });
    return out(load(id));
  });
}
function clean(d) {
  const fmt = S.FORMATS[d.format] ? d.format : '4:3';
  // a capa é sempre a primeira página; nenhuma outra página é recriada automaticamente
  let slides = Array.isArray(d.slides) ? d.slides.slice(0, 300).filter((x) => x && typeof x === 'object') : S.defaultSlides();
  const cap = slides.findIndex((x) => x.kind === 'capa');
  if (cap > 0) slides = [slides[cap], ...slides.filter((_, i) => i !== cap)]; else if (cap < 0) slides = [{ id: 'capa', kind: 'capa' }, ...slides];
  return { ...d, format: fmt, slides };
}
// salvar com controle de conflito: rev precisa ser a mesma que o editor carregou
function save(user, id, body) {
  const r = load(id);
  if (body.rev !== undefined && Number(body.rev) !== r.rev) throw Object.assign(new HttpError(409, 'Esta apresentação foi alterada em outro aparelho ou aba. Recarregue para ver a versão mais recente.'), { expose: true });
  const set = { updated_by: user.id, updated_at: nowIso(), rev: r.rev + 1 };
  if (body.data) { const d = clean(body.data); set.data = JSON.stringify(d); }
  if (body.title !== undefined) set.title = String(body.title || '').trim().slice(0, 120) || `Apresentação ${pad(r.number)}`;
  if (body.number !== undefined) {
    const n = parseInt(body.number, 10); if (!(n > 0 && n < 1000)) throw new HttpError(400, 'Número inválido.');
    if (n !== r.number && get('SELECT 1 FROM presentations WHERE project_id = ? AND number = ? AND archived = 0 AND id <> ?', r.project_id, n, r.id)) throw new HttpError(400, `Já existe a Apresentação ${pad(n)} neste projeto.`);
    set.number = n; const d = set.data ? J(set.data, {}) : J(r.data, {}); d.number = n; set.data = JSON.stringify(d);
    if (!body.title && (r.title || '') === `Apresentação ${pad(r.number)}`) set.title = `Apresentação ${pad(n)}`;
  }
  update('presentations', r.id, set);
  return out(load(r.id));
}

// ---------------------------------------------------------------- imagens
// dimensões guardadas no documento (lidas uma vez do arquivo original)
const DEFAULT_COVER = path.join(__dirname, '..', '..', 'public', 'img', 'capa-apresentacao.jpg');
function docInfo(docId) {
  if (docId === 'padrao') { // foto dos arquitetos (padrão da capa)
    const sz = require('../pdf/sign').imageSize(fs.readFileSync(DEFAULT_COVER));
    return { id: 'padrao', w: sz.w, h: sz.h, orientation: sz.orientation || 1, path: DEFAULT_COVER, title: 'Foto dos arquitetos', project_id: null };
  }
  const d = get('SELECT id, file_path, mime, img_w, img_h, img_orient, project_id, title, file_name, archived FROM documents WHERE id = ?', docId);
  if (!d || !d.file_path || !/^image\/(jpeg|png)$/.test(d.mime || '')) return null;
  if (!d.img_w) {
    try {
      const full = path.join(UPLOAD_DIR, d.file_path);
      const fd = fs.openSync(full, 'r'); const head = Buffer.alloc(256 * 1024); const n = fs.readSync(fd, head, 0, head.length, 0); fs.closeSync(fd);
      let sz = require('../pdf/sign').imageSize(head.slice(0, n));
      if (!sz) sz = require('../pdf/sign').imageSize(fs.readFileSync(full));
      if (sz) { run('UPDATE documents SET img_w = ?, img_h = ?, img_orient = ? WHERE id = ?', sz.w, sz.h, sz.orientation || 1, d.id); Object.assign(d, { img_w: sz.w, img_h: sz.h, img_orient: sz.orientation || 1 }); }
    } catch { return null; }
  }
  return d.img_w ? { id: d.id, w: d.img_w, h: d.img_h, orientation: d.img_orient || 1, path: path.join(UPLOAD_DIR, d.file_path), title: d.title, project_id: d.project_id } : null;
}
function docIds(data) {
  const ids = new Set();
  const key = (v) => (v === 'padrao' ? 'padrao' : Number(v));
  if (data.cover && data.cover.image && data.cover.image.doc_id) ids.add(key(data.cover.image.doc_id));
  (data.slides || []).forEach((s) => (s.images || []).forEach((i) => i && i.doc_id && ids.add(key(i.doc_id))));
  return [...ids];
}
function assetsFor(data) { const m = {}; docIds(data).forEach((id) => { const i = docInfo(id); if (i) m[id] = { w: i.w, h: i.h, orientation: i.orientation }; }); return m; }

// imagens disponíveis no projeto para escolher sem novo envio
function projectImages(projectId) {
  return all(`SELECT d.id, d.title, d.category, d.mime, d.created_at, d.entity FROM documents d
    WHERE d.project_id = ? AND d.archived = 0 AND d.mime IN ('image/jpeg','image/png') ORDER BY d.created_at DESC LIMIT 500`, projectId);
}

// ---------------------------------------------------------------- PDF
function logoAssets() {
  const pdf = require('../pdf');
  const lg = pdf.trimmedLogo(); if (!lg) return {};
  const buf = Buffer.from(lg.uri.split(',')[1], 'base64');
  const { PNG } = require('pngjs'); const png = PNG.sync.read(buf);
  const orig = { buf, w: png.width, h: png.height };
  // versão grafite (mesma logo, só escurecida) para o cabeçalho cinza
  const dark = new PNG({ width: png.width, height: png.height }); png.data.copy(dark.data);
  for (let i = 0; i < dark.data.length; i += 4) { dark.data[i] = 0x33; dark.data[i + 1] = 0x33; dark.data[i + 2] = 0x33; }
  return { logo: orig, logoDark: { buf: PNG.sync.write(dark), w: png.width, h: png.height } };
}
function buildJob(pres, { title } = {}) {
  const data = clean(J(pres.data, {})); data.number = pres.number;
  const F = S.FORMATS[data.format];
  const imgs = {}; const files = {};
  docIds(data).forEach((id) => { const i = docInfo(id); if (!i) return; imgs[id] = { href: `img:${id}`, w: i.w, h: i.h, orientation: i.orientation, oriented: true }; files[`img:${id}`] = { path: i.path, reset: i.orientation > 1 }; });
  const L = logoAssets();
  const A = { images: imgs, logo: L.logo ? { href: 'img:logo', w: L.logo.w, h: L.logo.h } : null, logoDark: L.logoDark ? { href: 'img:logoDark', w: L.logoDark.w, h: L.logoDark.h } : null };
  const pages = data.slides.map((_, i) => S.slideSvg(data, i, A));
  const inline = {}; if (L.logo) { inline['img:logo'] = L.logo.buf.toString('base64'); inline['img:logoDark'] = L.logoDark.buf.toString('base64'); }
  return { pages, w: F.w, h: F.h, files, inline, title: title || `${data.code || ''} Apresentação ${pad(pres.number)}`.trim() };
}
function filename(pres) { const d = J(pres.data, {}); const code = String(d.code || '').replace(/[^\w.-]+/g, '_') || 'Projeto'; return `${code}_Apresentacao_${pad(pres.number)}.pdf`; }

function renderPdf(pres, { timeoutMs = 300000 } = {}) {
  const job = buildJob(pres);
  const { fork } = require('child_process'); const os = require('os');
  const outFile = path.join(os.tmpdir(), `apres-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, '..', 'pdf', 'presentation-worker.js'), [], { execArgv: ['--disable-warning=ExperimentalWarning'], env: process.env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let settled = false;
    const done = (err, buf) => { if (settled) return; settled = true; clearTimeout(timer); try { child.kill(); } catch { /* */ } fs.rm(outFile, { force: true }, () => {}); if (err) reject(err); else resolve(buf); };
    const timer = setTimeout(() => done(Object.assign(new Error('A geração do PDF demorou demais. Verifique se há imagens muito pesadas.'), { status: 503, expose: true })), timeoutMs);
    child.on('message', (m) => { if (m && m.ok) { try { done(null, fs.readFileSync(outFile)); } catch (e) { done(e); } } else done(Object.assign(new Error(`Não foi possível gerar o PDF: ${(m && m.error) || 'erro desconhecido'}.`), { status: 500, expose: true })); });
    child.on('exit', (code) => done(Object.assign(new Error('O servidor ficou sem memória ao montar o PDF. Use imagens em JPEG ou PNG menores (até ~8000 px).'), { status: 503, expose: true, detail: String(code) })));
    child.on('error', (e) => done(e));
    child.send({ ...job, out: outFile });
  });
}

// ---------------------------------------------------------------- publicação (versão imutável + PDF no portal)
async function publish(user, id, { note } = {}) {
  const r = load(id);
  const data = J(r.data, {});
  const pend = S.pendencies(data);
  const buf = await renderPdf(r);
  const p = project(r.project_id);
  const rel = path.join(new Date().toISOString().slice(0, 7), `apresentacao-${r.id}-${Date.now()}.pdf`);
  fs.mkdirSync(path.join(UPLOAD_DIR, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, rel), buf);
  return tx(() => {
    const version = (get('SELECT MAX(version) v FROM presentation_versions WHERE presentation_id = ?', r.id).v || 0) + 1;
    const docId = insert('documents', { title: `${r.title || 'Apresentação ' + pad(r.number)}`, category: 'Apresentações', project_id: p.id, client_id: p.client_id, entity: 'presentations', entity_id: r.id,
      file_path: rel, file_name: filename(r), mime: 'application/pdf', size: buf.length, client_visible: 1, showcase: 1, published_at: nowIso(),
      portal_title: r.title || `Apresentação ${pad(r.number)}`, portal_desc: version > 1 ? `Versão ${version}` : null, portal_group: 'Apresentações', portal_order: r.number,
      uploaded_by: user.id, created_at: nowIso() });
    // a publicação anterior continua acessível como "versão anterior" (não é apagada)
    if (r.published_doc_id) run('UPDATE documents SET replaced_by = ? WHERE id = ?', docId, r.published_doc_id);
    insert('presentation_versions', { presentation_id: r.id, version, data: r.data, doc_id: docId, note: note || null, created_by: user.id, created_at: nowIso() });
    update('presentations', r.id, { status: 'publicada', published_version: version, published_doc_id: docId, published_rev: r.rev, published_at: nowIso() });
    return { ...out(load(r.id)), version, doc_id: docId, warnings: pend };
  });
}
function unpublish(user, id) {
  const r = load(id);
  if (r.published_doc_id) run('UPDATE documents SET client_visible = 0, showcase = 0 WHERE entity = ? AND entity_id = ?', 'presentations', r.id);
  update('presentations', r.id, { status: 'rascunho', published_doc_id: null, published_rev: null });
  return out(load(r.id));
}
function versions(id) {
  return all('SELECT v.id, v.version, v.doc_id, v.note, v.created_at, u.name user_name FROM presentation_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.presentation_id = ? ORDER BY v.version DESC', id);
}
function restoreVersion(user, id, versionId) {
  const v = get('SELECT * FROM presentation_versions WHERE id = ? AND presentation_id = ?', versionId, id);
  if (!v) throw new HttpError(404, 'Versão não encontrada.');
  const r = load(id);
  update('presentations', r.id, { data: v.data, rev: r.rev + 1, updated_by: user.id, updated_at: nowIso() }); // volta como rascunho; a versão publicada não muda
  return out(load(r.id));
}

function rooms(projectId) {
  const base = all("SELECT name FROM options WHERE kind = 'ambiente' AND archived = 0 ORDER BY position, name").map((x) => x.name);
  const used = new Set();
  all('SELECT data FROM presentations WHERE project_id = ?', projectId).forEach((r) => (J(r.data, {}).slides || []).forEach((s) => s.room && s.kind === 'ambiente' && used.add(s.room)));
  return { project: [...used].sort((a, b) => a.localeCompare(b, 'pt-BR')), all: base };
}

module.exports = { project, create, save, load, out, assetsFor, docInfo, projectImages, renderPdf, publish, unpublish, versions, restoreVersion, rooms, filename, nextNumber, logoAssets };
