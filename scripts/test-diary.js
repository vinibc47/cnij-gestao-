// Testes do Diário de obra: vínculo com a obra, rascunho × publicado, fotos e pendências sem duplicar,
// etapas personalizadas por obra, conflitos e isolamento na Área do Cliente.
//   node scripts/test-diary.js
process.env.TZ = 'America/Campo_Grande';
const fs = require('fs'); const os = require('os'); const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cnij-diary-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite'); process.env.BACKUP_DIR = path.join(tmp, 'bk'); process.env.UPLOAD_DIR = path.join(tmp, 'up');
const origLog = console.log; console.log = (...a) => { if (!String(a[0]).includes('e-mail não enviado')) origLog(...a); };
const app = require('../server');
const { get } = require('../server/db');
const client = require('./client');
let pass = 0; let failN = 0;
const ok = (c, m) => { if (c) { pass++; origLog('  ✓', m); } else { failN++; origLog('  ✗', m); } };
const rejects = async (p, st, m) => { try { await p; ok(false, m + ' (deveria falhar)'); } catch (e) { ok(!st || e.status === st, `${m} → ${e.status}`); } };
const IMG = fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'socios.jpg'));

(async () => {
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const A = client(base); const PW = 'Teste1234';
  await A.post('/setup', { name: 'Irineu', email: 'a@t.com', password: PW }); await A.post('/auth/login', { email: 'a@t.com', password: PW });
  const c1 = await A.post('/r/clients', { name: 'Heitor' }); const c2 = await A.post('/r/clients', { name: 'Outra' });
  const p1 = await A.post('/r/projects', { name: 'Canton Matos', client_id: c1.id }); const p2 = await A.post('/r/projects', { name: 'Casa Alheia', client_id: c2.id });
  const w1 = await A.post('/r/works', { project_id: p1.id, name: 'Sala 706' }); const w2 = await A.post('/r/works', { project_id: p2.id, name: 'Casa' });
  await A.post('/admin/users', { name: 'Heitor', email: 'h@t.com', role: 'cliente', client_id: c1.id, password: PW });
  await A.post('/admin/users', { name: 'Outra', email: 'o@t.com', role: 'cliente', client_id: c2.id, password: PW });
  await A.post('/admin/users', { name: 'Colab', email: 'c@t.com', role: 'colaborador', password: PW });
  const C1 = client(base); await C1.post('/auth/login', { email: 'h@t.com', password: PW });
  const C2 = client(base); await C2.post('/auth/login', { email: 'o@t.com', password: PW });
  const CO = client(base); await CO.post('/auth/login', { email: 'c@t.com', password: PW });
  const sup = await A.post('/r/suppliers', { company: 'Amaral Reformas' });

  origLog('\nCausa do erro "Preencha o campo Obra"');
  await rejects(A.post('/r/work_logs', { date: '2026-10-17', description: 'Teste sem obra' }), 400, 'a validação da obra continua obrigatória no servidor');
  const viaForm = await A.post('/r/work_logs', { work_id: w1.id, date: '2026-10-17', description: 'Enviado com o vínculo da obra' });
  ok(viaForm.id && viaForm.work_id === w1.id, 'com o vínculo enviado (correção do formulário), o registro é salvo na obra certa');
  const lib = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lib.js'), 'utf8');
  ok(/vínculos de contexto/.test(lib) && /if \(!id\) Object\.entries\(values/.test(lib), 'formulário passa a enviar os vínculos de contexto ocultos (obra, projeto, cliente, fornecedor)');

  origLog('\nContexto da obra');
  const ph = (await A.get(`/diary/context/${w1.id}`)).phases;
  ok(ph.length > 0, `etapas da obra carregadas (${ph.length})`);
  const ctx = await A.get(`/diary/context/${w1.id}`);
  ok(ctx.client.name === 'Heitor' && ctx.project.name === 'Canton Matos', 'cliente e projeto vêm da obra selecionada');
  await rejects(CO.get(`/diary/context/${w1.id}`), 404, 'colaborador sem acesso à obra não abre');

  origLog('\nRascunho, fotos, pendências e nova tentativa sem duplicar');
  const key = 'k-' + Date.now();
  const body = { client_key: key, save_key: 's1', work_id: w1.id, date: '2026-10-16', kind: 'visita', title: 'Início das intervenções', description: 'Iniciada a remoção das divisórias.',
    services: [{ phase_id: ph[0].id, status: 'iniciado' }, { name: 'Retirada de portas', status: 'concluido' }],
    participants: [{ kind: 'supplier', id: sup.id, name: 'Amaral Reformas' }], internal_notes: 'Conferir vão da porta', problems: 'Faltou argamassa', client_note: 'Semana que vem começa o gesso.',
    pendencies: { new: [{ key: 'p1', text: 'Entregar argamassa', responsible: 'Amaral', due_date: '2026-10-20' }, { key: 'p2', text: 'Medir vão interno', client_visible: 0 }] } };
  const l1 = await A.post('/diary/logs', body);
  ok(l1.id && l1.status === 'rascunho' && l1.services.length === 2 && l1.services[0].name === ph[0].name, 'rascunho salvo com serviços (nome da etapa preenchido)');
  const again = await A.post('/diary/logs', body);
  ok(again.id === l1.id && get('SELECT COUNT(*) n FROM work_logs WHERE client_key = ?', key).n === 1, 'repetir a gravação (falha de conexão) não cria outro registro');
  ok(get('SELECT COUNT(*) n FROM work_pendencies WHERE work_id = ?', w1.id).n === 2, 'pendências não se duplicam na nova tentativa');
  const up = async (k, name = 'foto.jpg') => { const fd = new FormData(); fd.append('files', new Blob([IMG], { type: 'image/jpeg' }), name); fd.append('entity', 'work_logs'); fd.append('entity_id', String(l1.id)); fd.append('upload_key', k); fd.append('title', 'Divisórias'); return A.upload('/files', fd); };
  const f1 = await up(`${key}:a`); const f1b = await up(`${key}:a`); await up(`${key}:b`);
  ok(f1.ids[0] === f1b.ids[0] && get("SELECT COUNT(*) n FROM documents WHERE entity = 'work_logs' AND entity_id = ?", l1.id).n === 2, 'reenviar a mesma foto não duplica (2 fotos, não 3)');
  ok(get('SELECT work_id, project_id FROM documents WHERE id = ?', f1.ids[0]).work_id === w1.id, 'fotos do diário ficam também nos arquivos da obra (sem novo envio)');
  const ov0 = await C1.get('/portal/overview');
  ok(!ov0.projects[0].works[0].updates.length, 'rascunho não aparece para o cliente');
  ok(get('SELECT progress, status FROM work_phases WHERE id = ?', ph[0].id).status === 'nao_iniciado', 'serviço registrado não altera a etapa sem confirmação');

  origLog('\nPublicar');
  await A.post(`/diary/logs/${l1.id}/publish`);
  const ov = await C1.get('/portal/overview'); const u = ov.projects[0].works[0].updates[0];
  ok(u && u.title === 'Início das intervenções' && u.photos.length === 2 && u.services.length === 2, 'publicado: cliente vê título, serviços e fotos');
  ok(u.next.length === 1 && u.next[0].text === 'Entregar argamassa', 'só a pendência marcada como visível aparece ao cliente');
  const js = JSON.stringify(ov);
  ok(!js.includes('Conferir vão da porta') && !js.includes('Faltou argamassa') && !js.includes('Medir vão interno'), 'observação interna, problemas e pendência interna ficam privados');
  ok(u.client_note === 'Semana que vem começa o gesso.', 'observação para o cliente aparece');
  const ph1 = (await C1.file(`/portal/files/${f1.ids[0]}`)); ok(ph1.status === 200, 'cliente abre as fotos do registro publicado');
  ok((await C2.file(`/portal/files/${f1.ids[0]}`)).status === 404 && !JSON.stringify(await C2.get('/portal/overview')).includes('Início das intervenções'), 'outro cliente não vê o registro nem as fotos');

  origLog('\nEditar, conflito e etapas');
  const cur = await A.get(`/diary/logs/${l1.id}`);
  await rejects(A.put(`/diary/logs/${l1.id}`, { ...body, rev: '2000-01-01 00:00:00', save_key: 'outro' }), 409, 'edição desatualizada (outro aparelho) é barrada');
  const ed = await A.put(`/diary/logs/${l1.id}`, { ...body, rev: cur.updated_at, save_key: 's2', title: 'Início das intervenções (revisado)', services: [{ phase_id: ph[0].id, status: 'concluido' }], phase_changes: [{ phase_id: ph[0].id, status: 'concluido' }] });
  ok(ed.title.endsWith('(revisado)') && ed.status === 'publicado', 'edição salva e continua publicada');
  ok(get('SELECT status, progress FROM work_phases WHERE id = ?', ph[0].id).progress === 100, 'etapa concluída só porque foi confirmada explicitamente');
  ok(get('SELECT COUNT(*) n FROM work_pendencies WHERE work_id = ?', w1.id).n === 2, 'editar não duplica pendências');
  const pend = get("SELECT id FROM work_pendencies WHERE text = 'Entregar argamassa'").id;
  const l2 = await A.post('/diary/logs', { client_key: 'k2-' + Date.now(), work_id: w1.id, date: '2026-10-18', kind: 'registro', services: [{ phase_id: ph[1].id, status: 'em_andamento' }], pendencies: { resolved: [pend] } });
  ok(get('SELECT status, resolved_log_id FROM work_pendencies WHERE id = ?', pend).resolved_log_id === l2.id, 'pendência resolvida em uma visita seguinte (mesmo registro de pendência)');
  ok(get('SELECT status FROM work_phases WHERE id = ?', ph[1].id).status === 'nao_iniciado', 'serviço em andamento não muda a etapa sem confirmação');

  origLog('\nEtapas personalizadas por obra');
  const before2 = (await A.get(`/diary/context/${w2.id}`)).phases.map((p) => p.name).join('|');
  const list = (await A.get(`/diary/context/${w1.id}`)).phases;
  const edited = list.map((p, i) => ({ id: p.id, name: i === 2 ? 'Gesso e forro' : p.name, applicable: i === 3 ? 0 : 1 })).filter((_, i) => i !== 0 && i !== 4);
  edited.unshift({ name: 'Remoção de divisórias' });
  const r = await A.put(`/diary/works/${w1.id}/phases`, { phases: edited });
  ok(r.phases.find((p) => p.name === 'Gesso e forro') && r.phases[0].name === 'Remoção de divisórias', 'renomear, adicionar e reordenar');
  ok(r.archived_with_history.includes(list[0].name) && get('SELECT archived FROM work_phases WHERE id = ?', list[0].id).archived === 1, 'etapa com histórico removida da lista é arquivada (não apagada)');
  ok(!get('SELECT 1 FROM work_phases WHERE id = ?', list[4].id), 'etapa sem histórico é removida');
  ok((await A.get(`/diary/context/${w2.id}`)).phases.map((p) => p.name).join('|') === before2, 'etapas de outra obra não mudam');
  const act = r.phases.filter((p) => !p.archived && p.applicable);
  const avg = Math.round(act.reduce((s, p) => s + p.progress, 0) / act.length);
  ok(get('SELECT progress FROM works WHERE id = ?', w1.id).progress === avg, `progresso considera só etapas aplicáveis (${avg}%)`);
  const tpl = await A.post('/diary/templates', { work_id: w1.id, name: 'Reforma de sala' });
  ok(tpl.phases.includes('Gesso e forro') && !tpl.phases.includes(list[3].name), 'modelo salvo copia só a estrutura das etapas aplicáveis');
  ok((await A.get('/diary/templates')).some((t) => t.name === 'Reforma de sala'), 'modelo disponível para outras obras');
  const ovp = await C1.get('/portal/overview');
  ok(!ovp.projects[0].works[0].phases.some((p) => p.name === list[0].name || p.name === list[3].name), 'portal mostra só etapas ativas e aplicáveis');

  origLog('\nLista do diário');
  const all = await A.get(`/diary?work_id=${w1.id}`);
  ok(all.length === 3 && all[0].date >= all[1].date, 'registros mais recentes primeiro');
  ok((await A.get(`/diary?work_id=${w1.id}&status=publicado`)).length === 1 && (await A.get(`/diary?status=rascunho&work_id=${w1.id}`)).length === 2, 'filtro por situação (publicado × rascunho)');
  ok((await A.get('/diary?from=2026-10-18')).every((x) => x.date >= '2026-10-18'), 'filtro por período');
  await A.post(`/diary/logs/${l1.id}/unpublish`);
  ok(!(await C1.get('/portal/overview')).projects[0].works[0].updates.length, 'retirar do portal esconde do cliente novamente');

  server.close();
  origLog(`\n${pass} testes ok, ${failN} falha(s).`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { origLog(e); process.exit(1); });
