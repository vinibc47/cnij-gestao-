// Testes da cópia de segurança: envio ao Google Drive (Apps Script simulado) e cópia completa em .zip
//   node scripts/test-backup.js
process.env.TZ = 'America/Campo_Grande';
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http'); const zlib = require('zlib');
const { execFileSync } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cnij-bk-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite'); process.env.BACKUP_DIR = path.join(tmp, 'bk'); process.env.UPLOAD_DIR = path.join(tmp, 'up');
const origLog = console.log; console.log = (...a) => { if (!String(a[0]).includes('e-mail não enviado')) origLog(...a); };
const app = require('../server');
const { setSetting, getSetting, get } = require('../server/db');
const client = require('./client');
let pass = 0; let failN = 0;
const ok = (c, m) => { if (c) { pass++; origLog('  ✓', m); } else { failN++; origLog('  ✗', m); } };
const rejects = async (p, st, m) => { try { await p; ok(false, m + ' (deveria falhar)'); } catch (e) { ok(!st || e.status === st, `${m} → ${e.status}`); } };

(async () => {
  // "Apps Script" simulado: guarda o que recebe
  const drive = new Map(); let calls = []; let failNext = false;
  const mock = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const d = JSON.parse(b); calls.push(d.action);
    const secret = getSetting('drive_secret', '');
    let out = { ok: true };
    if (failNext) { out = { ok: false, error: 'Cota excedida' }; failNext = false; }
    else if (d.secret !== secret) out = { ok: false, error: 'Chave inválida' };
    else if (d.action === 'put') drive.set(d.path, Buffer.from(d.data, 'base64'));
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(out)); }); }).listen(0);
  const mockUrl = `http://127.0.0.1:${mock.address().port}/exec`;

  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const A = client(base); const PW = 'Teste1234';
  await A.post('/setup', { name: 'Irineu', email: 'a@t.com', password: PW }); await A.post('/auth/login', { email: 'a@t.com', password: PW });
  const c = await A.post('/r/clients', { name: 'Cliente Backup' }); const p = await A.post('/r/projects', { name: 'Projeto Backup', client_id: c.id });
  const up = async (name, buf) => { const fd = new FormData(); fd.append('files', new Blob([buf], { type: 'application/pdf' }), name); fd.append('project_id', String(p.id)); return A.upload('/files', fd); };
  await up('planta.pdf', Buffer.from('%PDF-1.4 planta'));
  await up('grande.pdf', Buffer.alloc(21 * 1024 * 1024, 1));

  origLog('\nConfiguração');
  const st = await A.get('/admin/drive');
  ok(!st.url && st.script.includes(getSetting('drive_secret')) && st.script.includes('function doPost'), 'código do Apps Script vem pronto, com a chave deste servidor');
  await rejects(A.put('/admin/drive', { url: 'https://exemplo.com/x' }), 400, 'endereço que não é do Apps Script é recusado');
  await A.post('/admin/users', { name: 'Col', email: 'c@t.com', role: 'colaborador', password: PW });
  const C = client(base); await C.post('/auth/login', { email: 'c@t.com', password: PW });
  await rejects(C.get('/admin/drive'), 403, 'só administrador vê a configuração');
  await rejects(C.file('/admin/backup-full').then((r) => { if (!r.ok) { const e = new Error(); e.status = r.status; throw e; } }), 403, 'só administrador baixa a cópia completa');

  origLog('\nEnvio ao Google Drive');
  setSetting('drive_url', mockUrl); // (o teste usa um servidor local no lugar do Google)
  let r = await A.post('/admin/drive/sync');
  const dbKey = [...drive.keys()].find((k) => k.startsWith('banco/'));
  ok(dbKey && /banco\/cnij-\d{4}-\d{2}-\d{2}\.sqlite\.gz$/.test(dbKey), `banco enviado compactado (${dbKey})`);
  const restored = path.join(tmp, 'restaurado.sqlite'); fs.writeFileSync(restored, zlib.gunzipSync(drive.get(dbKey)));
  const { DatabaseSync } = require('node:sqlite'); const rdb = new DatabaseSync(restored);
  ok(rdb.prepare("SELECT name FROM projects WHERE id = ?").get(p.id).name === 'Projeto Backup', 'cópia do banco abre e contém os dados');
  rdb.close();
  ok([...drive.keys()].some((k) => k.startsWith('arquivos/') && drive.get(k).toString().includes('planta')), 'arquivo anexado enviado');
  ok(r.files_big.length === 1 && ![...drive.keys()].some((k) => drive.get(k).length > 20 * 1024 * 1024), 'arquivo acima de 20 MB fica fora do Drive e é listado');
  ok(calls.includes('prune') && r.last_ok && !r.last_error, 'limpeza das cópias antigas e status de sucesso');
  calls = [];
  await A.post('/admin/drive/sync');
  ok(calls.filter((x) => x === 'put').length === 1, 'na segunda vez só o banco é reenviado (arquivos não se repetem)');
  failNext = true;
  await rejects(A.post('/admin/drive/sync'), 502, 'falha do Google aparece para o usuário');
  ok((await A.get('/admin/drive')).last_error.includes('Cota'), 'erro fica registrado no status');
  setSetting('drive_secret', 'outra');
  const st2 = await A.post('/admin/drive/new-key');
  ok(st2.script.includes(getSetting('drive_secret')) && getSetting('drive_secret') !== 'outra', 'nova chave pode ser gerada');
  await A.put('/admin/drive', { url: '' }); ok(!getSetting('drive_url'), 'desativar remove a configuração');

  origLog('\nCópia completa para baixar');
  const res = await A.file('/admin/backup-full');
  const zipPath = path.join(tmp, 'copia.zip'); fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  ok(res.status === 200 && /copia-completa-cnij/.test(res.headers.get('content-disposition')), 'download do .zip');
  let list = '';
  try { list = execFileSync('unzip', ['-l', zipPath]).toString(); execFileSync('unzip', ['-tq', zipPath]); ok(true, 'zip íntegro (unzip -t)'); } catch (e) { ok(false, 'zip íntegro: ' + e.message); }
  ok(list.includes('cnij.sqlite') && list.includes('LEIA-ME.txt') && (list.match(/arquivos\//g) || []).length >= 2, 'zip contém banco, leia-me e todos os arquivos (inclusive os grandes)');
  ok(get("SELECT COUNT(*) n FROM audit_log WHERE summary LIKE 'Download da cópia completa%'").n === 1, 'download fica registrado no histórico');

  server.close(); mock.close();
  origLog(`\n${pass} testes ok, ${failN} falha(s).`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { origLog(e); process.exit(1); });
