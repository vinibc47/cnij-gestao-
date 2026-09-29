// CRUD genérico: listar, pesquisar, filtrar, ordenar, paginar, criar,
// editar, duplicar, arquivar e excluir — para todos os recursos declarados.
const express = require('express');
const { all, get, run, insert, update, tx } = require('./db');
const { HttpError, wrap, audit, today, nowIso } = require('./util');
const P = require('./permissions');
const { R } = require('./resources');

const router = express.Router();

function res(key) { const r = R[key]; if (!r) throw new HttpError(404, 'Recurso inexistente.'); return r; }

function coerce(f, v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return f.type === 'bool' ? 0 : null;
  switch (f.type) {
    case 'money': case 'number': case 'percent': case 'rating': { const n = Number(String(v).replace(',', '.')); if (Number.isNaN(n)) throw new HttpError(400, `Valor inválido em "${f.label}".`); return n; }
    case 'ref': { const n = parseInt(v, 10); return Number.isNaN(n) ? null : n; }
    case 'bool': return v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0;
    case 'date': { const s = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, `Data inválida em "${f.label}".`); return s; }
    case 'datetime': return String(v).replace(' ', 'T').slice(0, 16);
    case 'suppliers': case 'users': return Array.isArray(v) ? v.map(Number) : v;
    case 'json': return typeof v === 'string' ? v.slice(0, 50000) : JSON.stringify(v).slice(0, 50000);
    default: return String(v).trim().slice(0, 20000);
  }
}

function pick(r, body, creating, user) {
  const d = {};
  for (const f of r.fields) {
    if (f.virtual || f.readonly) continue;
    if (f.finance && !P.canFinance(user)) continue;
    if (!(f.name in body)) {
      if (creating && f.default !== undefined) d[f.name] = f.default === '$today' ? today() : f.default === '$me' ? user.id : f.default;
      continue;
    }
    d[f.name] = coerce(f, body[f.name]);
  }
  if (creating) for (const f of r.fields) {
    if (f.required && (d[f.name] === null || d[f.name] === undefined || d[f.name] === '')) throw new HttpError(400, `Preencha o campo "${f.label}".`);
  }
  if (!creating) for (const f of r.fields) {
    if (f.required && f.name in d && (d[f.name] === null || d[f.name] === '')) throw new HttpError(400, `O campo "${f.label}" é obrigatório.`);
  }
  return d;
}

function scoped(r, u) { return r.scope ? r.scope(u) : { sql: '1=1', params: [] }; }

function sanitize(r, u, row) {
  if (!row) return row;
  if (!P.canFinance(u)) for (const f of r.fields) if (f.finance) delete row[f.name];
  return row;
}

function fetchOne(r, u, id) {
  const s = scoped(r, u);
  const row = get(`${r.select} WHERE ${r.alias}.id = ? AND ${s.sql}`, id, ...s.params);
  if (!row) throw new HttpError(404, `${r.singular} não encontrado(a) ou sem permissão.`);
  if (r.loadVirtual) r.loadVirtual(row);
  return sanitize(r, u, row);
}

function list(r, u, q) {
  const s = scoped(r, u);
  const where = [s.sql]; const params = [...s.params];
  if (r.archivable && q.archived !== 'all') { where.push(`${r.alias}.archived = ?`); params.push(q.archived === '1' ? 1 : 0); }
  if (q.q && r.search) {
    const terms = String(q.q).trim().split(/\s+/).slice(0, 5);
    for (const t of terms) { where.push(`(${r.search.map((c) => `${c} LIKE ?`).join(' OR ')})`); r.search.forEach(() => params.push(`%${t}%`)); }
  }
  const outer = []; const oparams = [];
  for (const [k, v] of Object.entries(q)) {
    if (!k.startsWith('f_') || v === '' || v == null) continue;
    const col = k.slice(2);
    if (!/^[a-z_]+$/.test(col)) continue;
    if (v === 'null') { outer.push(`x.${col} IS NULL`); continue; }
    const vals = String(v).split(',');
    outer.push(`x.${col} IN (${vals.map(() => '?').join(',')})`); oparams.push(...vals);
  }
  const df = q.date_field && /^[a-z_]+$/.test(q.date_field) ? q.date_field : r.dateField;
  if (q.from && df) { outer.push(`substr(x.${df},1,10) >= ?`); oparams.push(q.from); }
  if (q.to && df) { outer.push(`substr(x.${df},1,10) <= ?`); oparams.push(q.to); }
  if (q.preset && r.presets && r.presets[q.preset]) {
    const p = r.presets[q.preset]; const pp = typeof p === 'function' ? p(u) : { sql: p, params: [] };
    outer.push(pp.sql); oparams.push(...pp.params);
  }
  let order = r.sort ? r.sort.replace(/\b[a-z]+\.(?=[a-z_]+)/g, 'x.') : 'x.id DESC';
  if (q.sort && /^[a-z_]+$/.test(q.sort)) order = `x.${q.sort} IS NULL, x.${q.sort} ${q.dir === 'desc' ? 'DESC' : 'ASC'}, x.id DESC`;
  const limit = Math.min(1000, parseInt(q.limit, 10) || 200);
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);
  const base = `SELECT * FROM (${r.select} WHERE ${where.join(' AND ')}) x ${outer.length ? 'WHERE ' + outer.join(' AND ') : ''}`;
  const rows = all(`${base} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, ...params, ...oparams);
  const total = get(`SELECT COUNT(*) n FROM (${base})`, ...params, ...oparams).n;
  return { rows: rows.map((row) => sanitize(r, u, row)), total };
}

function diff(before, after) {
  const ch = {};
  for (const k of Object.keys(after)) if (String(before[k] ?? '') !== String(after[k] ?? '')) ch[k] = [before[k] ?? null, after[k] ?? null];
  return ch;
}

function create(r, u, body, req) {
  const d = pick(r, body, true, u);
  if (!(r.create ? r.create(u, d) : r.write(u, null, d))) throw new HttpError(403, 'Sem permissão para criar este registro.');
  return tx(() => {
    if (r.beforeCreate) r.beforeCreate(d, u, body);
    if (r.beforeSave) r.beforeSave(d, null, u, body);
    for (const k of Object.keys(d)) if (Array.isArray(d[k])) d[k] = JSON.stringify(d[k]);
    const id = insert(r.table, d);
    if (r.afterSave) r.afterSave(id, d, u, true, body, null);
    audit(req, 'create', r.table, id, `${r.singular} criado(a): ${d[r.title] || d.description || d.name || d.title || id}`);
    return id;
  });
}

function updateRow(r, u, id, body, req) {
  const row = fetchOne(r, u, id);
  const d = pick(r, body, false, u);
  if (!r.write(u, row, { ...row, ...d })) throw new HttpError(403, 'Sem permissão para editar este registro.');
  return tx(() => {
    if (r.beforeUpdate) r.beforeUpdate(d, row, u, body);
    if (r.beforeSave) r.beforeSave(d, row, u, body);
    for (const k of Object.keys(d)) if (Array.isArray(d[k])) d[k] = JSON.stringify(d[k]);
    const cols = new Set(all(`PRAGMA table_info(${r.table})`).map((c) => c.name));
    if (cols.has('updated_at')) d.updated_at = nowIso();
    update(r.table, id, d);
    if (r.afterSave) r.afterSave(id, d, u, false, body, row);
    const ch = diff(row, d); delete ch.updated_at;
    if (Object.keys(ch).length) audit(req, 'update', r.table, id, `${r.singular} alterado(a): ${row[r.title] || row.description || row.name || row.title || id}`, ch);
    return id;
  });
}

router.get('/:res', wrap((req, rs) => {
  const r = res(req.params.res);
  if (!r.read(req.user)) throw new HttpError(403, 'Sem permissão.');
  rs.json(list(r, req.user, req.query));
}));

router.get('/:res/:id', wrap((req, rs) => {
  const r = res(req.params.res);
  if (!r.read(req.user)) throw new HttpError(403, 'Sem permissão.');
  rs.json(fetchOne(r, req.user, Number(req.params.id)));
}));

router.post('/:res', wrap((req, rs) => {
  const r = res(req.params.res);
  if (!r.read(req.user)) throw new HttpError(403, 'Sem permissão.');
  const id = create(r, req.user, req.body || {}, req);
  rs.status(201).json(fetchOne(r, req.user, id));
}));

router.put('/:res/:id', wrap((req, rs) => {
  const r = res(req.params.res);
  if (!r.read(req.user)) throw new HttpError(403, 'Sem permissão.');
  const id = updateRow(r, req.user, Number(req.params.id), req.body || {}, req);
  rs.json(fetchOne(r, req.user, id));
}));

router.post('/:res/:id/duplicate', wrap((req, rs) => {
  const r = res(req.params.res);
  const row = fetchOne(r, req.user, Number(req.params.id));
  const body = {};
  for (const f of r.fields) if (!f.readonly && row[f.name] !== undefined) body[f.name] = row[f.name];
  if (row.member_ids) body.member_ids = row.member_ids;
  if (row.user_ids) body.user_ids = row.user_ids;
  const t = r.title || (r.fields.find((f) => f.name === 'description') ? 'description' : null);
  if (t && body[t]) body[t] = `${body[t]} (cópia)`;
  ['paid_at', 'completed_at', 'signed_at', 'client_selected'].forEach((k) => delete body[k]);
  if (r.table === 'incomes') body.status = 'a_receber';
  if (r.table === 'expenses') body.status = 'a_pagar';
  if (r.table === 'tasks') body.status = 'pendente';
  if (r.table === 'contracts') body.generate_receivables = false;
  if (r.table === 'projects') body.skip_phases = true;
  const id = create(r, req.user, body, req);
  if (r.table === 'projects') {
    all('SELECT * FROM project_phases WHERE project_id = ? ORDER BY position', row.id)
      .forEach((ph) => insert('project_phases', { project_id: id, name: ph.name, position: ph.position, responsible_id: ph.responsible_id, client_visible: ph.client_visible }));
  }
  const ck = all('SELECT text, position FROM checklist_items WHERE entity = ? AND entity_id = ?', r.table, row.id);
  ck.forEach((c) => insert('checklist_items', { entity: r.table, entity_id: id, text: c.text, position: c.position }));
  rs.status(201).json(fetchOne(r, req.user, id));
}));

router.post('/:res/:id/archive', wrap((req, rs) => {
  const r = res(req.params.res);
  if (!r.archivable) throw new HttpError(400, 'Este registro não pode ser arquivado.');
  const row = fetchOne(r, req.user, Number(req.params.id));
  if (!r.write(req.user, row, row)) throw new HttpError(403, 'Sem permissão.');
  const v = req.body && req.body.archived === 0 ? 0 : 1;
  run(`UPDATE ${r.table} SET archived = ? WHERE id = ?`, v, row.id);
  audit(req, v ? 'archive' : 'unarchive', r.table, row.id, `${r.singular} ${v ? 'arquivado(a)' : 'restaurado(a)'}: ${row[r.title] || row.id}`);
  rs.json({ ok: true });
}));

router.delete('/:res/:id', wrap((req, rs) => {
  const r = res(req.params.res);
  const row = fetchOne(r, req.user, Number(req.params.id));
  const allowed = r.remove ? r.remove(req.user, row) : r.write(req.user, row, row);
  if (!allowed) throw new HttpError(403, r.archivable ? 'Sem permissão para excluir. Utilize "Arquivar".' : 'Sem permissão para excluir.');
  if (r.table === 'projects' && (row.status === 'encerrado' || get('SELECT 1 FROM incomes WHERE project_id = ? UNION SELECT 1 FROM expenses WHERE project_id = ? LIMIT 1', row.id, row.id)))
    throw new HttpError(400, 'Projetos encerrados ou com lançamentos financeiros não são excluídos — utilize "Arquivar" para manter o histórico.');
  try {
    tx(() => {
      run(`DELETE FROM ${r.table} WHERE id = ?`, row.id);
      run('DELETE FROM checklist_items WHERE entity = ? AND entity_id = ?', r.table, row.id);
      run('DELETE FROM comments WHERE entity = ? AND entity_id = ?', r.table, row.id);
      if (r.afterDelete) r.afterDelete(row, req.user);
    });
  } catch (e) {
    if (/FOREIGN KEY/i.test(e.message)) throw new HttpError(400, 'Existem registros vinculados a este item. Arquive-o em vez de excluir.');
    throw e;
  }
  audit(req, 'delete', r.table, row.id, `${r.singular} excluído(a): ${row[r.title] || row.description || row.id}`, row);
  rs.json({ ok: true });
}));

module.exports = { router, list, fetchOne, create, updateRow, res };
