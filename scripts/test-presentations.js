// Testes do gerador de apresentações: numeração, duplicação, capa/planta/ambientes, anotações,
// salvamento e conflito, PDF real (páginas, formato, imagens originais), publicação e portal.
//   node scripts/test-presentations.js
process.env.TZ = 'America/Campo_Grande';
const fs = require('fs'); const os = require('os'); const path = require('path'); const zlib = require('zlib');
const { execFileSync } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cnij-apr-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite'); process.env.BACKUP_DIR = path.join(tmp, 'bk'); process.env.UPLOAD_DIR = path.join(tmp, 'up');
const origLog = console.log; console.log = (...a) => { if (!String(a[0]).includes('e-mail não enviado')) origLog(...a); };
const app = require('../server');
const { get } = require('../server/db');
const client = require('./client');
let pass = 0; let failN = 0;
const ok = (c, m) => { if (c) { pass++; origLog('  ✓', m); } else { failN++; origLog('  ✗', m); } };
const rejects = async (p, st, m) => { try { await p; ok(false, m + ' (deveria falhar)'); } catch (e) { ok(!st || e.status === st, `${m} → ${e.status}`); } };
const has = (cmd) => { try { execFileSync('which', [cmd]); return true; } catch { return false; } };

// imagem PNG de teste com tamanho conhecido
function png(w, h, rgb = [180, 150, 120]) {
  const { PNG } = require('pngjs'); const p = new PNG({ width: w, height: h });
  for (let i = 0; i < p.data.length; i += 4) { p.data[i] = rgb[0]; p.data[i + 1] = rgb[1]; p.data[i + 2] = rgb[2]; p.data[i + 3] = 255; }
  return PNG.sync.write(p);
}

(async () => {
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const A = client(base); const PW = 'Teste1234';
  await A.post('/setup', { name: 'Irineu', email: 'a@t.com', password: PW }); await A.post('/auth/login', { email: 'a@t.com', password: PW });
  const c1 = await A.post('/r/clients', { name: 'Heitor Canton', whatsapp: '(67) 99999-1234' }); const c2 = await A.post('/r/clients', { name: 'Outra Cliente' });
  const p1 = await A.post('/r/projects', { name: 'Escritório Canton Matos', client_id: c1.id });
  await A.put(`/r/projects/${p1.id}`, { code: 'AP_2026_006' });
  const p2 = await A.post('/r/projects', { name: 'Casa Alheia', client_id: c2.id });
  await A.post('/admin/users', { name: 'Heitor', email: 'h@t.com', role: 'cliente', client_id: c1.id, password: PW });
  await A.post('/admin/users', { name: 'Outra', email: 'o@t.com', role: 'cliente', client_id: c2.id, password: PW });
  await A.post('/admin/users', { name: 'Colab', email: 'c@t.com', role: 'colaborador', password: PW });
  const C1 = client(base); await C1.post('/auth/login', { email: 'h@t.com', password: PW });
  const C2 = client(base); await C2.post('/auth/login', { email: 'o@t.com', password: PW });
  const CO = client(base); await CO.post('/auth/login', { email: 'c@t.com', password: PW });
  const up = async (name, buf, type = 'image/png', pid = p1.id) => { const fd = new FormData(); fd.append('files', new Blob([buf], { type }), name); fd.append('project_id', String(pid)); fd.append('category', 'Imagens / renders'); return (await A.upload('/files', fd)).ids[0]; };
  const plantaId = await up('planta.png', png(2400, 1800, [90, 80, 70]));
  const recId = await up('recepcao.png', png(3000, 2000));
  const reuId = await up('reuniao.png', png(2000, 3000, [120, 130, 140]));
  const tiny = await up('pequena.png', png(300, 200));

  origLog('\nApresentações 01 e 02 no mesmo projeto');
  const a1 = await A.post('/presentations', { project_id: p1.id });
  const a2 = await A.post('/presentations', { project_id: p1.id });
  ok(a1.number === 1 && a2.number === 2 && a1.title === 'Apresentação 01' && a2.title === 'Apresentação 02', 'numeração sugerida: 01 e 02');
  ok(a1.data.slides[0].kind === 'capa' && a1.data.slides[1].kind === 'planta', 'sequência padrão: capa e planta de layout');
  ok(a1.data.code === 'AP_2026_006' && a1.data.cover.subtitle === 'Escritório Canton Matos' && a1.data.cover.image.doc_id === 'padrao', 'cliente/código/nome vêm do projeto; capa com a foto dos arquitetos');
  let full = await A.get(`/presentations/${a1.id}`);
  ok(full.assets.padrao && full.assets.padrao.w > 0, 'dimensões da foto da capa disponíveis para a prévia');
  await rejects(A.put(`/presentations/${a2.id}`, { rev: a2.rev, number: 1 }), 400, 'número repetido no mesmo projeto é recusado');

  origLog('\nEdição: planta, ambientes, ordem e anotações');
  const d = full.data;
  d.slides[1].images = [{ doc_id: plantaId }];
  d.slides[1].annotations = [{ type: 'medida', img: 0, x1: 0.2, y1: 0.5, x2: 0.6, y2: 0.5, value: '3,20', unit: 'm', color: '#1F1F1F' },
    { type: 'observacao', img: 0, x: 0.65, y: 0.1, w: 0.3, text: 'Conferir posição da mesa', ax: 0.4, ay: 0.3 }, { type: 'seta', img: 0, x1: 0.8, y1: 0.8, x2: 0.6, y2: 0.6, color: '#B23A2E' }];
  d.slides.push({ kind: 'ambiente', room: 'Sala de reuniões', layout: '1', images: [{ doc_id: reuId }] });
  d.slides.push({ kind: 'ambiente', room: 'Recepção', layout: '2', images: [{ doc_id: recId }, { doc_id: reuId }] });
  // reordenar: recepção antes da sala de reuniões
  const [x] = d.slides.splice(3, 1); d.slides.splice(2, 0, x);
  let s = await A.put(`/presentations/${a1.id}`, { rev: full.rev, data: d });
  ok(s.rev === full.rev + 1 && s.assets[plantaId] && s.assets[plantaId].w === 2400, 'salvo; dimensões das imagens lidas do arquivo original');
  full = await A.get(`/presentations/${a1.id}`);
  ok(full.data.slides[2].room === 'Recepção' && full.data.slides[3].room === 'Sala de reuniões', 'ordem das páginas preservada ao reabrir');
  const an = full.data.slides[1].annotations;
  ok(an.length === 3 && an[0].value === '3,20' && an[1].text === 'Conferir posição da mesa' && an[2].type === 'seta', 'medida, observação e seta salvas e reabertas');
  await rejects(A.put(`/presentations/${a1.id}`, { rev: full.rev - 1, data: d }), 409, 'edição em outro aparelho: conflito detectado (não sobrescreve)');

  origLog('\nDuplicar');
  const dup = await A.post(`/presentations/${a1.id}/duplicate`);
  ok(dup.number === 3 && dup.data.slides.length === full.data.slides.length && dup.data.number === 3, 'cópia vira Apresentação 03 com o mesmo conteúdo');
  const dd = dup.data; dd.slides[1].annotations = []; dd.slides.pop();
  await A.put(`/presentations/${dup.id}`, { rev: dup.rev, data: dd });
  ok((await A.get(`/presentations/${a1.id}`)).data.slides[1].annotations.length === 3 && (await A.get(`/presentations/${a1.id}`)).data.slides.length === 4, 'alterar a cópia não muda a original');

  origLog('\nPDF real');
  const res = await A.file(`/presentations/${a1.id}/pdf`);
  const buf = Buffer.from(await res.arrayBuffer());
  ok(res.status === 200 && buf.slice(0, 5).toString() === '%PDF-', 'PDF gerado pelo servidor (sem impressão do navegador)');
  ok(/AP_2026_006_Apresentacao_01\.pdf/.test(decodeURIComponent(res.headers.get('content-disposition'))), 'nome organizado: AP_2026_006_Apresentacao_01.pdf');
  const pdfFile = path.join(tmp, 'a1.pdf'); fs.writeFileSync(pdfFile, buf);
  if (has('pdfinfo')) {
    const info = execFileSync('pdfinfo', [pdfFile]).toString();
    ok(/Pages:\s+4/.test(info), 'uma página por slide (4: capa, planta e 2 ambientes)');
    ok(/Page size:\s+768 x 576 pts/.test(info), 'formato 4:3 (768 × 576 pt, igual ao modelo)');
    const imgs = execFileSync('pdfimages', ['-list', pdfFile]).toString();
    ok(/\s2400\s+1800\s/.test(imgs) && /\s3000\s+2000\s/.test(imgs), 'imagens originais embutidas (2400×1800 e 3000×2000, sem miniaturas)');
    const fonts = execFileSync('pdffonts', [pdfFile]).toString();
    ok(/Jost/i.test(fonts) && /yes\s+yes/.test(fonts), 'fontes incorporadas');
    if (has('pdftotext')) { const txt = execFileSync('pdftotext', [pdfFile, '-']).toString(); ok(/APRESENTAÇÃO/.test(txt) && /PLANTA DE LAYOUT/.test(txt) && /3,20 m/.test(txt) && /Conferir posição da mesa/.test(txt) && /APRESENTAÇÃO 01/.test(txt) && /AP_2026_006/.test(txt), 'textos vetoriais: capa, planta, medida, observação, código e número'); }
  } else origLog('  (pdfinfo não instalado — conferências de página puladas)');
  const d169 = (await A.get(`/presentations/${a1.id}`)); d169.data.format = '16:9';
  await A.put(`/presentations/${a1.id}`, { rev: d169.rev, data: d169.data });
  const b169 = Buffer.from(await (await A.file(`/presentations/${a1.id}/pdf`)).arrayBuffer()); fs.writeFileSync(path.join(tmp, 'a169.pdf'), b169);
  if (has('pdfinfo')) ok(/Page size:\s+1024 x 576 pts/.test(execFileSync('pdfinfo', [path.join(tmp, 'a169.pdf')]).toString()), 'formato 16:9 (1024 × 576 pt)');
  const back = await A.get(`/presentations/${a1.id}`); back.data.format = '4:3'; await A.put(`/presentations/${a1.id}`, { rev: back.rev, data: back.data });
  // a geometria compartilhada mantém as anotações presas à imagem em qualquer formato
  const SC = require('../public/js/slides-core.js');
  const L43 = SC.slideSvg({ ...back.data, format: '4:3' }, 1, { images: { [plantaId]: { href: 'x', w: 2400, h: 1800 } } }, { withLayout: true });
  const L169 = SC.slideSvg({ ...back.data, format: '16:9' }, 1, { images: { [plantaId]: { href: 'x', w: 2400, h: 1800 } } }, { withLayout: true });
  const r43 = L43.placed[0].rect; const r169 = L169.placed[0].rect;
  ok(Math.abs(r43.w / r43.h - 2400 / 1800) < 0.01 && Math.abs(r169.w / r169.h - 2400 / 1800) < 0.01, 'planta inteira sem distorção nos dois formatos');

  origLog('\nRascunho × publicado (portal do cliente)');
  let ov = await C1.get('/portal/overview');
  ok(!ov.projects[0].showcase.some((m) => m.group === 'Apresentações'), 'rascunho não aparece para o cliente');
  await rejects(CO.post(`/presentations/${a1.id}/publish`), 403, 'colaborador não publica no portal');
  const pub = await A.post(`/presentations/${a1.id}/publish`);
  ok(pub.status === 'publicada' && pub.version === 1 && pub.doc_id, 'publicada (versão 1)');
  ov = await C1.get('/portal/overview'); let item = ov.projects[0].showcase.find((m) => m.id === pub.doc_id);
  ok(item && item.title === 'Apresentação 01' && item.kind === 'pdf' && item.group === 'Apresentações', 'cliente vê a Apresentação 01 em “Veja seu projeto”');
  const cf = await C1.file(`/portal/files/${pub.doc_id}?inline=1`);
  ok(cf.status === 200 && /pdf/.test(cf.headers.get('content-type')), 'cliente abre/baixa o PDF publicado');
  ok((await C2.file(`/portal/files/${pub.doc_id}`)).status === 404 && !(await C2.get('/portal/overview')).projects.some((p) => p.showcase.some((m) => m.id === pub.doc_id)), 'outro cliente não vê nem baixa');
  // alteração depois de publicar: o cliente continua vendo a versão publicada
  const ed = await A.get(`/presentations/${a1.id}`); ed.data.slides[2].room = 'Recepção principal';
  const ed2 = await A.put(`/presentations/${a1.id}`, { rev: ed.rev, data: ed.data });
  ok(ed2.has_unpublished && ed2.status === 'publicada', 'alteração fica em rascunho, sinalizada como não publicada');
  ov = await C1.get('/portal/overview'); ok(ov.projects[0].showcase.filter((m) => m.group === 'Apresentações' && !m.previous).length === 1 && ov.projects[0].showcase.find((m) => m.id === pub.doc_id), 'cliente continua com a versão publicada');
  const pub2 = await A.post(`/presentations/${a1.id}/publish`);
  ov = await C1.get('/portal/overview');
  const cur = ov.projects[0].showcase.find((m) => m.id === pub2.doc_id); const old = ov.projects[0].showcase.find((m) => m.id === pub.doc_id);
  ok(pub2.version === 2 && cur && !cur.previous && old && old.previous, 'nova publicação: versão 2 atual e versão 1 como anterior (histórico preservado)');
  const vs = await A.get(`/presentations/${a1.id}/versions`); ok(vs.length === 2 && vs[0].version === 2, 'versões listadas');
  const rs = await A.post(`/presentations/${a1.id}/versions/${vs[1].id}/restore`);
  ok(rs.data.slides[2].room === 'Recepção' && rs.status === 'publicada', 'versão anterior restaurada como rascunho sem mudar o que está publicado');

  origLog('\nCompartilhar pelo WhatsApp');
  const sh = await A.get(`/presentations/${a1.id}/share`);
  ok(sh.phone === '5567999991234' && sh.link.includes(`abrir=doc-${pub2.doc_id}`) && /Apresentação 01/.test(sh.message) && sh.has_portal_user, 'mensagem editável com link da versão publicada e telefone do cliente');
  await rejects(A.get(`/presentations/${a2.id}/share`), 400, 'rascunho não gera link para o cliente');

  origLog('\nAcesso e organização');
  await rejects(CO.get(`/presentations/${a1.id}`), 404, 'colaborador sem acesso ao projeto não abre');
  await rejects(C1.get(`/presentations/${a1.id}`), 403, 'cliente não acessa o editor');
  await A.post(`/presentations/${a2.id}/archive`, { archived: 1 });
  ok(!(await A.get(`/presentations?project_id=${p1.id}`)).some((x) => x.id === a2.id), 'arquivada sai da lista (sem apagar)');
  const a4 = await A.post('/presentations', { project_id: p1.id });
  ok(a4.number === 4, 'nova apresentação não reaproveita número arquivado (sem duplicidade confusa)');
  const other = await up('alheia.png', png(800, 600), 'image/png', p2.id);
  ok(!(await A.get(`/presentations/meta/${p1.id}`)).images.some((i) => i.id === other), 'seleção de imagens mostra só as do projeto');
  const low = await A.get(`/presentations/${a4.id}`); low.data.slides[1].images = [{ doc_id: tiny }];
  const L = SC.slideSvg(low.data, 1, { images: { [tiny]: { href: 'x', w: 300, h: 200 } } }, { withLayout: true });
  ok(L.placed[0].ppi < 110, `imagem pequena detectada como pouca resolução (${L.placed[0].ppi} ppi)`);
  ok(SC.pendencies(a4.data).some((x) => /Planta/.test(x)), 'planta pendente indicada no editor');

  server.close();
  origLog(`\n${pass} testes ok, ${failN} falha(s).`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { origLog(e); process.exit(1); });
