// =====================================================================
// Cópia de segurança FORA do servidor: Google Drive do escritório.
// O envio usa um pequeno "Apps Script" criado na conta Google do escritório
// (sem senha do Google no servidor e sem projeto no Google Cloud).
//   · todo dia: banco de dados compactado → pasta "banco" (mantém N dias + o dia 1º de cada mês)
//   · arquivos anexados (PDFs, fotos…) → pasta "arquivos", cada um enviado uma única vez
// =====================================================================
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { all, get, run, getSetting, setSetting, DB_FILE } = require('../db');
const { today, nowIso } = require('../util');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
const BRANDING_DIR = path.join(path.dirname(DB_FILE), 'branding');
const MAX_FILE = 20 * 1024 * 1024; // limite seguro por envio ao Apps Script
const MAX_RUN = 150 * 1024 * 1024; // volume máximo por rodada (o restante vai nas próximas)
let running = null;
const ageMs = (s) => Date.now() - new Date(String(s).replace(' ', 'T')).getTime(); // datas locais do sistema

run(`CREATE TABLE IF NOT EXISTS drive_sync (path TEXT PRIMARY KEY, size INTEGER, status TEXT NOT NULL, sent_at TEXT NOT NULL)`);

function secret() {
  let s = getSetting('drive_secret', '');
  if (!s) { s = crypto.randomBytes(24).toString('base64url'); setSetting('drive_secret', s); }
  return s;
}

// Código que o escritório cola no Google Apps Script (já com a chave deste servidor)
function appsScript() {
  return `// Cópias de segurança do CN&IJ Gestão — cole este código inteiro no Apps Script
const CHAVE = '${secret()}';
const PASTA = 'CN&IJ Gestão — cópias de segurança';

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.secret !== CHAVE) return saida_({ ok: false, error: 'Chave inválida' });
    const raiz = pasta_(DriveApp.getRootFolder(), PASTA);
    if (b.action === 'ping') return saida_({ ok: true, folder: raiz.getUrl() });
    if (b.action === 'put') {
      const partes = String(b.path).split('/'); const nome = partes.pop();
      let p = raiz; partes.forEach(function (x) { p = pasta_(p, x); });
      const antigos = p.getFilesByName(nome); while (antigos.hasNext()) antigos.next().setTrashed(true);
      p.createFile(Utilities.newBlob(Utilities.base64Decode(b.data), b.mime || 'application/octet-stream', nome));
      return saida_({ ok: true });
    }
    if (b.action === 'prune') {
      const p = pasta_(raiz, 'banco'); const limite = Date.now() - b.keepDays * 864e5; let n = 0;
      const it = p.getFiles();
      while (it.hasNext()) { const f = it.next(); if (/-01\\.sqlite\\.gz$/.test(f.getName())) continue; if (f.getDateCreated().getTime() < limite) { f.setTrashed(true); n++; } }
      return saida_({ ok: true, removed: n });
    }
    return saida_({ ok: false, error: 'Ação desconhecida' });
  } catch (err) { return saida_({ ok: false, error: String(err) }); }
}
function pasta_(pai, nome) { const it = pai.getFoldersByName(nome); return it.hasNext() ? it.next() : pai.createFolder(nome); }
function saida_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
`;
}

async function call(action, body = {}, url = getSetting('drive_url', '')) {
  if (!url) throw new Error('Google Drive não configurado.');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5 * 60 * 1000);
  try {
    const r = await fetch(url, { method: 'POST', redirect: 'follow', signal: ctl.signal, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, action, secret: secret() }) });
    const txt = await r.text();
    let d; try { d = JSON.parse(txt); } catch { throw new Error(/<html/i.test(txt) ? 'O Google respondeu com uma página em vez de dados. Confira se a implantação está como “Qualquer pessoa” e se o endereço termina em /exec.' : `Resposta inesperada do Google (${r.status}).`); }
    if (!d.ok) throw new Error(d.error || 'Falha no Google Drive.');
    return d;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('O Google demorou demais para responder.');
    throw e;
  } finally { clearTimeout(t); }
}
const put = (p, buf, mime) => call('put', { path: p, data: buf.toString('base64'), mime });

function walk(dir, base, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const n of fs.readdirSync(dir)) {
    const full = path.join(dir, n); const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, `${base}/${n}`, out); else out.push({ full, rel: `${base}/${n}`, size: st.size });
  }
  return out;
}

// Envia a cópia do dia e os arquivos novos. Pode ser chamada manualmente ("Enviar agora").
function syncNow({ manual = false } = {}) {
  if (running) return running;
  running = (async () => {
    setSetting('drive_last_try', nowIso());
    const res = { db: null, files: 0, pending: 0, big: 0 };
    try {
      // 1. banco de dados (cópia consistente, compactada)
      const automation = require('./automation');
      const tmp = automation.backupNow(`drive-${Date.now()}`);
      const gz = zlib.gzipSync(fs.readFileSync(tmp), { level: 9 }); fs.unlinkSync(tmp);
      if (gz.length > MAX_FILE * 2) throw new Error('Banco de dados grande demais para o envio pelo Apps Script.');
      const name = `banco/cnij-${today()}.sqlite.gz`;
      await put(name, gz, 'application/gzip'); res.db = name;
      // 2. arquivos anexados ainda não enviados
      const sent = new Set(all('SELECT path FROM drive_sync').map((r) => r.path));
      const files = [...walk(UPLOAD_DIR, 'arquivos'), ...walk(BRANDING_DIR, 'logo')].filter((f) => !sent.has(f.rel));
      let vol = 0;
      for (const f of files) {
        if (f.size > MAX_FILE) { run("INSERT OR REPLACE INTO drive_sync(path, size, status, sent_at) VALUES(?, ?, 'grande', ?)", f.rel, f.size, nowIso()); res.big++; continue; }
        if (vol + f.size > MAX_RUN) { res.pending++; continue; }
        await put(f.rel, fs.readFileSync(f.full)); vol += f.size; res.files++;
        run("INSERT OR REPLACE INTO drive_sync(path, size, status, sent_at) VALUES(?, ?, 'ok', ?)", f.rel, f.size, nowIso());
      }
      // 3. limpeza das cópias antigas do banco (mantém o dia 1º de cada mês)
      await call('prune', { keepDays: Math.max(7, parseInt(getSetting('drive_keep_days', '30'), 10) || 30) });
      setSetting('drive_last_ok', nowIso()); setSetting('drive_last_error', '');
      setSetting('drive_last_result', JSON.stringify(res));
      return res;
    } catch (e) {
      setSetting('drive_last_error', e.message);
      if (manual) throw e;
      return { error: e.message };
    } finally { running = null; }
  })();
  return running;
}

// Chamada pelas automações (a cada 10 min): envia uma vez por dia; se falhar, tenta de novo a cada hora.
function maybeDaily() {
  if (!getSetting('drive_url', '')) return;
  const ok = getSetting('drive_last_ok', ''); const pend = (() => { try { return JSON.parse(getSetting('drive_last_result', '{}')).pending > 0; } catch { return false; } })();
  if (ok.slice(0, 10) === today() && !pend) return;
  const tried = getSetting('drive_last_try', '');
  if (tried && ageMs(tried) < 55 * 60 * 1000) return;
  syncNow().then(() => alertIfStale()).catch(() => {});
}
function alertIfStale() {
  const ok = getSetting('drive_last_ok', '');
  const days = ok ? ageMs(ok) / 864e5 : 99;
  if (days < 2) return;
  const automation = require('./automation');
  all("SELECT id FROM users WHERE active = 1 AND role = 'admin'").forEach((u) => automation.notify(u.id, { kind: 'backup_drive', severity: 'danger', title: 'Cópia no Google Drive não está sendo enviada',
    body: getSetting('drive_last_error', '') || 'Verifique a configuração em Configurações › Backup e dados.', link: '#/configuracoes/backup', key: `drive_${today()}` }));
}

function status() {
  const st = { url: getSetting('drive_url', ''), keep_days: Number(getSetting('drive_keep_days', '30')) || 30, last_ok: getSetting('drive_last_ok', ''), last_try: getSetting('drive_last_try', ''),
    last_error: getSetting('drive_last_error', ''), running: !!running,
    files_sent: get("SELECT COUNT(*) n FROM drive_sync WHERE status = 'ok'").n, files_big: all("SELECT path, size FROM drive_sync WHERE status = 'grande' ORDER BY path") };
  try { st.last_result = JSON.parse(getSetting('drive_last_result', 'null')); } catch { st.last_result = null; }
  return st;
}

// ---------------------------------------------------------------------
// Cópia completa para baixar (banco + arquivos) em .zip — gerada sob demanda, em fluxo
const CRC = (() => { if (zlib.crc32) return (b) => zlib.crc32(b) >>> 0; const T = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }); return (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
function dosTime(d) { return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }
async function zipTo(res, entries) {
  // entries: [{ name, full | buffer }] — armazenado sem compressão (fotos e PDFs já são compactados)
  let offset = 0; const central = [];
  const write = (b) => new Promise((ok) => { if (res.write(b)) ok(); else res.once('drain', ok); });
  for (const e of entries) {
    const data = e.buffer || fs.readFileSync(e.full);
    const name = Buffer.from(e.name, 'utf8'); const crc = CRC(data); const dt = dosTime(new Date());
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt16LE(dt.time, 10); h.writeUInt16LE(dt.date, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    await write(h); await write(name); await write(data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(dt.time, 12); c.writeUInt16LE(dt.date, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42); central.push(Buffer.concat([c, name]));
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  await write(cd); await write(end); res.end();
}
function fullCopyEntries() {
  const automation = require('./automation');
  const tmp = automation.backupNow(`download-${Date.now()}`);
  const db = fs.readFileSync(tmp); fs.unlinkSync(tmp);
  const files = [...walk(UPLOAD_DIR, 'arquivos'), ...walk(BRANDING_DIR, 'logo')];
  const total = db.length + files.reduce((s, f) => s + f.size, 0);
  const readme = Buffer.from(`Cópia de segurança do CN&IJ Gestão — ${nowIso()}\r\n\r\ncnij.sqlite = banco de dados completo (clientes, projetos, financeiro, usuários...)\r\narquivos/   = documentos, fotos e comprovantes anexados\r\nlogo/       = logo usada nos PDFs\r\n\r\nGuarde este arquivo em local seguro: ele contém dados pessoais de clientes.\r\n`, 'utf8');
  return { entries: [{ name: 'LEIA-ME.txt', buffer: readme }, { name: 'cnij.sqlite', buffer: db }, ...files.map((f) => ({ name: f.rel, full: f.full }))], total };
}

module.exports = { appsScript, secret, call, syncNow, maybeDaily, status, zipTo, fullCopyEntries, walk };
