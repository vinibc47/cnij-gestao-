// Testes: proposta para interessado sem cadastro, vários serviços, conversão em cliente,
// atas, recibos (rascunho × emitido), placas de obra (PDF e QR), comparativo de orçamentos,
// aviso de atualização do portal e visibilidade no portal.   node scripts/test-extra.js
process.env.TZ = 'America/Campo_Grande';
const fs = require('fs'); const os = require('os'); const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cnij-extra-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite'); process.env.BACKUP_DIR = path.join(tmp, 'bk'); process.env.UPLOAD_DIR = path.join(tmp, 'up');
const OUT = process.env.PDF_OUT || path.join(tmp, 'pdf'); fs.mkdirSync(OUT, { recursive: true });
const origLog = console.log; console.log = (...a) => { if (!String(a[0]).includes('e-mail não enviado')) origLog(...a); };
const app = require('../server');
const { get, all } = require('../server/db');
const client = require('./client');
const pad = (n) => String(n).padStart(2, '0');
const D = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
let pass = 0; let failN = 0;
const ok = (c, m) => { if (c) { pass++; origLog('  ✓', m); } else { failN++; origLog('  ✗', m); } };
const rejects = async (p, st, m) => { try { await p; ok(false, m + ' (deveria falhar)'); } catch (e) { ok(!st || e.status === st, `${m} → ${e.status}`); return e; } };

(async () => {
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const A = client(base); const PW = 'Teste1234';
  const pdfOk = async (url, name, check) => { const r = await A.file(url); const buf = Buffer.from(await r.arrayBuffer()); ok(r.status === 200 && buf.slice(0, 5).toString() === '%PDF-', `PDF: ${name}`); fs.writeFileSync(path.join(OUT, name), buf); if (check) check(buf); return buf; };
  await A.post('/setup', { name: 'Admin', email: 'a@t.com', password: PW }); await A.post('/auth/login', { email: 'a@t.com', password: PW });
  await A.put('/admin/settings', { office_pix_key: 'pix@exemplo.com', office_pix_name: 'Favorecido Exemplo', contractor_name: 'Contratado Exemplo', contractor_doc: '000.000.000-00', contractor_address: 'Rua A, 1' });

  origLog('\nProposta para interessado sem cadastro, com vários serviços');
  const nClients0 = (await A.get('/r/clients')).total;
  let pr = await A.post('/honorarios', { prospect_name: 'Maria Interessada', prospect_phone: '(67) 99999-1111', prospect_email: 'maria@ex.com', title: 'Casa de campo', services: [{ type: 'arquitetonico' }, { type: 'interiores' }] });
  ok(!pr.client_id && pr.client_name === 'Maria Interessada' && pr.is_prospect, 'proposta criada para interessado, sem cliente');
  ok((await A.get('/r/clients')).total === nClients0, 'nenhum cliente criado automaticamente');
  ok(pr.services.length === 2 && pr.services.map((x) => x.type).join() === 'arquitetonico,interiores', 'dois serviços separados na mesma proposta');
  const dl = pr.deliverables.split('\n'); ok(dl.length === new Set(dl.map((x) => x.toLowerCase())).size, 'entregas sem itens duplicados');
  ok(!pr.body.includes('{{escopo}}'), 'novo modelo sem “Escopo e entregas incluídas”');
  pr = await A.put(`/honorarios/${pr.id}`, { services: [{ type: 'arquitetonico', amount: 6000 }, { type: 'interiores', amount: 4000 }, { type: 'acompanhamento', amount: 2000 }],
    summary: 'Projeto completo', extra: { periodicidade: 'Quinzenal', visitas: '6', periodo_inicio: D(30), periodo_fim: D(120), cobranca: 'Mensal' },
    payment_plan: [{ label: 'Entrada', due_date: D(1), amount: 6000 }, { label: 'Parcela', due_date: D(31), amount: 6000 }] });
  ok(pr.amount === 12000, 'total = soma dos serviços (R$ 12.000), sem duplicar');
  await rejects(A.put(`/honorarios/${pr.id}`, { services: [{ type: 'arq_interiores' }] }).then((x) => { if (!x.services.length) throw Object.assign(new Error('vazio'), { status: 400 }); return x; }), 400, 'opção conjunta não é aceita em propostas novas');
  pr = await A.put(`/honorarios/${pr.id}`, { services: [{ type: 'arquitetonico', amount: 6000 }, { type: 'interiores', amount: 4000 }, { type: 'acompanhamento', amount: 2000 }] });
  const pdf1 = await pdfOk(`/pdf/proposal/${pr.id}`, 'proposta-interessado.pdf');
  const { execSync } = require('child_process');
  const txt = execSync(`pdftotext -layout ${path.join(OUT, 'proposta-interessado.pdf')} -`).toString();
  ok(/Maria Interessada/.test(txt) && /Projeto arquitetônico/.test(txt) && /Projeto de interiores/.test(txt) && /Acompanhamento de obra/.test(txt) && /R\$ 12\.000,00/.test(txt), 'PDF mostra interessado, os três serviços e o total');
  ok(/Periodicidade: Quinzenal/.test(txt) && !/cobrado à parte do projeto/.test(txt), 'trechos condicionais: acompanhamento incluído (sem a nota “cobrado à parte”)');
  // aprovação e conversão
  await A.post(`/honorarios/${pr.id}/status`, { status: 'aprovada', approved_by: 'Maria' });
  const e = await rejects(A.post(`/honorarios/${pr.id}/contract`), 409, 'contrato exige converter o interessado antes');
  ok(e && e.data.need_client, 'resposta indica conversão necessária');
  const dupCli = await A.post('/r/clients', { name: 'Outra', email: 'maria@ex.com' });
  const conflict = await rejects(A.post(`/honorarios/${pr.id}/convert-client`), 409, 'conversão avisa sobre cadastro com mesmo e-mail');
  ok(conflict && conflict.data.matches.some((m) => m.id === dupCli.id), 'duplicidade identificada');
  const cv = await A.post(`/honorarios/${pr.id}/convert-client`, { force: true });
  const cl = await A.get(`/r/clients/${cv.client_id}`);
  ok(cl.name === 'Maria Interessada' && cl.whatsapp === '(67) 99999-1111', 'cliente criado com os dados do interessado');
  ok(!get("SELECT 1 FROM users WHERE role = 'cliente' AND client_id = ?", cv.client_id), 'nenhum acesso ao portal liberado');
  const ct = await A.post(`/honorarios/${pr.id}/contract`);
  ok((await A.get(`/contract-docs/${ct.id}`)).service_type === 'arq_interiores', 'contrato usa o modelo conjunto quando há arquitetônico + interiores');
  const refused = await A.post('/honorarios', { prospect_name: 'Pedro Desistiu', title: 'Reforma', services: [{ type: 'interiores' }] });
  await A.post(`/honorarios/${refused.id}/status`, { status: 'recusada' });
  ok((await A.get('/r/proposals?preset=honorarios')).rows.some((x) => x.id === refused.id) && !(await A.get('/r/clients?q=Pedro')).total, 'proposta recusada fica no histórico e fora dos clientes');

  origLog('\nAta de reunião');
  const c1 = await A.post('/r/clients', { name: 'Cliente Ata' });
  const p1 = await A.post('/r/projects', { name: 'Projeto Ata', client_id: c1.id });
  const p2 = await A.post('/r/projects', { name: 'Projeto Outro' });
  await rejects(A.post('/r/meeting_minutes', { date: D(-3), client_id: c1.id, project_id: p2.id }), 400, 'projeto de outro cliente é recusado');
  const ata = await A.post('/r/meeting_minutes', { date: D(-3), client_id: c1.id, project_id: p1.id, title: 'Alinhamento', participants: 'Carla\nIrineu\nCliente', content: 'Definido o piso de madeira.\nAprovado o layout.', next_steps: JSON.stringify([{ acao: 'Enviar orçamento', responsavel: 'Carla', prazo: D(4) }]) });
  ok(ata.number && ata.number.startsWith('ATA-') && ata.project_code === p1.code && ata.date === D(-3), 'ata salva com número, código do projeto e data retroativa');
  await pdfOk(`/pdf/minutes/${ata.id}`, 'ata.pdf');
  ok((await A.get(`/r/meeting_minutes?f_project_id=${p1.id}`)).rows.length === 1, 'ata vinculada ao projeto');

  origLog('\nRecibos');
  const inc = await A.post('/r/incomes', { description: 'Projeto Ata (1/2)', client_id: c1.id, project_id: p1.id, amount: 1500, due_date: D(0), installment_no: 1, installment_total: 2 });
  const opts = await A.get(`/receipts/options?client_id=${c1.id}`);
  ok(opts.projects.length === 1 && opts.incomes.some((i) => i.id === inc.id), 'opções filtradas pelo cliente (projetos e pagamentos)');
  let rc = await A.post('/receipts', { client_id: c1.id, income_id: inc.id });
  ok(rc.status === 'rascunho' && rc.amount === 1500 && rc.project_id === p1.id && rc.installment_label === 'parcela 1/2' && !rc.paid_at, 'rascunho preenchido pelo pagamento (sem data de pagamento enquanto não recebido)');
  const pe = await rejects(A.post(`/receipts/${rc.id}/emit`), 400, 'parcela em aberto não gera recibo emitido');
  ok(pe && pe.data.problems.some((x) => /ainda não consta como recebido/.test(x)), 'motivo: recebimento não confirmado');
  await A.post(`/receipts/${rc.id}/register-payment`, { paid_at: D(0), method: 'pix' });
  rc = await A.get(`/receipts/${rc.id}`);
  ok(get('SELECT status FROM incomes WHERE id = ?', inc.id).status === 'recebido' && rc.paid_at === D(0), 'recebimento registrado na mesma parcela (sem nova receita)');
  ok(all('SELECT id FROM incomes WHERE client_id = ?', c1.id).length === 1, 'nenhuma receita duplicada');
  rc = await A.post(`/receipts/${rc.id}/emit`);
  ok(rc.status === 'emitido' && /^\d{3}\/\d{4}$/.test(rc.number), `recibo emitido nº ${rc.number}`);
  await rejects(A.put(`/receipts/${rc.id}`, { amount: 1 }), 400, 'recibo emitido não pode ser alterado');
  const rtxt = (await pdfOk(`/pdf/receipt/${rc.id}`, 'recibo.pdf'), execSync(`pdftotext ${path.join(OUT, 'recibo.pdf')} -`).toString());
  ok(/mil e quinhentos reais/.test(rtxt) && /Projeto Ata/.test(rtxt) && new RegExp(p1.code).test(rtxt) && /PIX/i.test(rtxt), 'PDF com valor por extenso, projeto, código e forma de pagamento');
  const rc2 = await A.post('/receipts', { client_id: c1.id, income_id: inc.id });
  const d2 = await rejects(A.post(`/receipts/${rc2.id}/emit`), 409, 'segundo recibo para o mesmo pagamento pede confirmação');
  const manual = await A.post('/receipts', { payer_name: 'Avulso', amount: 300, description: 'consultoria', paid_at: D(0), payment_method: 'dinheiro' });
  await rejects(A.post(`/receipts/${manual.id}/emit`), 400, 'recibo avulso exige confirmar o recebimento');

  origLog('\nPlaca de obra');
  let sg = await A.post('/signs', { project_id: p1.id, size: 'A3', orientation: 'retrato' });
  ok(sg.client_id === c1.id && sg.data.obra_nome === 'Projeto Ata' && sg.qr.url === 'https://www.instagram.com/irineujuniorarquiteto/', 'placa criada com dados do projeto e QR do perfil correto');
  ok(sg.data.handles.some((h) => h.handle === '@irineujuniorarquiteto') && sg.svg.includes('@irineujuniorarquiteto'), 'perfil @irineujuniorarquiteto junto ao QR');
  // foto
  const fd = new FormData(); fd.append('files', new Blob([fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'socios.jpg'))], { type: 'image/jpeg' }), 'render.jpg'); fd.append('entity', 'site_signs'); fd.append('entity_id', String(sg.id));
  const upd = await A.upload('/files', fd);
  sg = await A.put(`/signs/${sg.id}`, { photo_doc_id: upd.ids[0], photo_x: 40, photo_zoom: 1.2 });
  ok(sg.photo && sg.photo.w === 731 && sg.ppi > 0, `foto enviada e enquadrada (${sg.ppi} ppi no tamanho atual)`);
  const big = await A.put(`/signs/${sg.id}`, { size: '150x100' });
  ok(big.low_res === true, `aviso de resolução insuficiente em 1,50 × 1,00 m (${big.ppi} ppi, mínimo ${big.min_ppi})`);
  sg = await A.put(`/signs/${sg.id}`, { data: { ...sg.data, people: [{ nome: 'Responsável', funcao: 'Arquiteto', registro_label: 'CAU', registro: 'A000', rrt_label: 'RRT', rrt: '' }] }, size: '150x100', orientation: 'paisagem' });
  ok(sg.dims.w === 1500 && sg.dims.h === 1000, 'tamanho 1,50 × 1,00 m salvo');
  const sizes = { '150x100': [4251.97, 2834.65], '120x80': [3401.57, 2267.72], '100x70': [2834.65, 1984.25], A4: [595.28, 841.89], A3: [841.89, 1190.55], A2: [1190.55, 1683.78], A1: [1683.78, 2383.94] };
  for (const [size, [w, h]] of Object.entries(sizes)) {
    for (const o of size.startsWith('A') ? ['retrato', 'paisagem'] : ['paisagem']) {
      await A.put(`/signs/${sg.id}`, { size, orientation: o });
      const buf = await pdfOk(`/pdf/sign/${sg.id}`, `placa-${size}-${o}.pdf`);
      const info = execSync(`pdfinfo -`, { input: buf }).toString().match(/Page size:\s+([\d.]+) x ([\d.]+)/);
      const [pw, ph] = [Number(info[1]), Number(info[2])]; const [ew, eh] = o === 'paisagem' && size.startsWith('A') ? [h, w] : [w, h];
      ok(Math.abs(pw - ew) < 1 && Math.abs(ph - eh) < 1, `dimensão física ${size} ${o}: ${pw} × ${ph} pt`);
    }
  }
  // exportação para a gráfica: download direto, sangria, TrimBox, fonte embutida, foto original e QR
  const cur = await A.get(`/signs/${sg.id}`);
  await A.put(`/signs/${sg.id}`, { size: '150x100', orientation: 'paisagem', data: { ...cur.data, bleed_mm: 3 } });
  const ei = await A.get(`/signs/${sg.id}/export-info`);
  ok(ei.trim_mm.w === 1500 && ei.bleed_mm === 3 && ei.page_mm.w === 1506 && ei.photo && ei.ref_ppi === 300 && ei.below_ref === true, `conferência antes de exportar (${ei.photo && ei.photo.ppi} ppi efetivos, referência 300)`);
  const rdl = await A.file(`/pdf/sign/${sg.id}?download=1`);
  ok(/^attachment;/.test(rdl.headers.get('content-disposition') || '') && /1500x1000mm sangria 3mm/.test(decodeURIComponent(rdl.headers.get('content-disposition'))), 'download direto (attachment) com medidas no nome do arquivo');
  const bdl = Buffer.from(await rdl.arrayBuffer());
  const box = execSync('pdfinfo -box -', { input: bdl }).toString();
  const tb = box.match(/TrimBox:\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/).slice(1).map(Number); const mm = (v) => v * 25.4 / 72;
  ok(/Pages:\s+1\n/.test(box) && Math.abs(mm(tb[2] - tb[0]) - 1500) < 0.1 && Math.abs(mm(tb[3] - tb[1]) - 1000) < 0.1, `página única; corte ${mm(tb[2] - tb[0]).toFixed(1)} × ${mm(tb[3] - tb[1]).toFixed(1)} mm (TrimBox) com sangria`);
  ok(/yes\s+yes\s+yes/.test(execSync('pdffonts -', { input: bdl }).toString()), 'fonte Inter incorporada');
  const imgs = execSync('pdfimages -list -', { input: bdl }).toString().trim().split('\n').slice(2);
  ok(imgs.length === 1 && /\s731\s/.test(imgs[0]), 'única imagem é a foto original (logo, textos e QR vetoriais)');
  await A.put(`/signs/${sg.id}`, { data: { ...cur.data, bleed_mm: 0 } });

  { // logo: componente único, centro visual = centro da página (retrato e paisagem)
    const pdfm = require('../server/pdf'); const L = pdfm.trimmedLogo();
    const hp = pdfm.brandHeader(595.28); const hl = pdfm.brandHeader(841.89);
    ok(L && Math.abs(hp.absolutePosition.x + L.w / 2 - 595.28 / 2) < 0.01 && Math.abs(hl.absolutePosition.x + L.w / 2 - 841.89 / 2) < 0.01, `logo centralizada pela área visível (${L.w.toFixed(1)} × ${L.h.toFixed(1)} pt)`);
  }
  origLog('\nComparativo de orçamentos');
  const s1 = await A.post('/r/suppliers', { company: 'Marcenaria A' }); const s2 = await A.post('/r/suppliers', { company: 'Marcenaria B' });
  const q1 = await A.post('/r/quotes', { project_id: p1.id, item: 'Marcenaria', supplier_id: s1.id, amount: 20000, deadline_days: 30, payment_terms: '50% + 50%', included: 'Armários\nPainel\nInstalação' });
  const q2 = await A.post('/r/quotes', { project_id: p1.id, item: 'Marcenaria', supplier_id: s2.id, amount: 15000, included: 'Armários\nPainel' });
  const cmp = await A.get(`/projects/${p1.id}/quotes-compare?ids=${q1.id},${q2.id}`);
  const b2 = cmp.quotes.find((q) => q.id === q2.id);
  ok(b2.missing.includes('Instalação') && !b2.deadline && !b2.payment_terms, 'diferença de escopo apontada; campos ausentes ficam sem valor (Não informado)');
  ok(cmp.warnings.some((w) => /diferenças de escopo/.test(w)), 'aviso de diferença de escopo');
  await pdfOk(`/pdf/quotes-compare/${p1.id}?ids=${q1.id},${q2.id}`, 'comparativo.pdf');

  origLog('\nAviso de atualização do portal e visibilidade');
  await A.put(`/r/quotes/${q1.id}`, { client_visible: 1, notes: 'NOTA INTERNA SECRETA' }); await A.put(`/r/quotes/${q2.id}`, { client_visible: 1 });
  await A.put(`/r/meeting_minutes/${ata.id}`, { client_visible: 1 });
  const pu = await A.get(`/projects/${p1.id}/portal-updates?since=${D(-10)}`);
  ok(pu.items.some((i) => i.kind === 'orcamento') && pu.items.some((i) => i.kind === 'ata') && pu.portal_url.startsWith('http'), 'itens liberados ao cliente e link do portal');
  ok(!JSON.stringify(pu).includes('NOTA INTERNA'), 'aviso não inclui notas internas');
  await A.post(`/projects/${p1.id}/portal-notice`, { message: 'Olá!', items: pu.items.map((i) => i.key) });
  await A.post('/admin/users', { name: 'Cli', email: 'cli@t.com', role: 'cliente', client_id: c1.id, password: PW });
  const Cc = client(base); await Cc.post('/auth/login', { email: 'cli@t.com', password: PW });
  const po = await Cc.get('/portal/overview');
  const pp = po.projects.find((x) => x.id === p1.id);
  ok(pp.minutes.length === 1 && po.receipts.length === 1, 'portal mostra ata liberada e recibo emitido');
  ok(!JSON.stringify(po).includes('NOTA INTERNA') && !JSON.stringify(pp.works).includes('"pending"'), 'portal sem observações internas');
  const rpdf = await Cc.file(`/portal/receipts/${rc.id}/pdf`); ok(rpdf.status === 200, 'cliente baixa o próprio recibo');
  await rejects(Cc.get(`/receipts/${rc.id}`), 403, 'cliente não acessa a área administrativa de recibos');

  origLog('\nArquivamento');
  await A.post(`/r/projects/${p2.id}/archive`, { archived: 1 });
  ok(!(await A.get('/r/projects')).rows.some((x) => x.id === p2.id), 'projeto arquivado sai da lista ativa');
  await A.post(`/r/projects/${p2.id}/archive`, { archived: 0 });
  ok((await A.get('/r/projects')).rows.some((x) => x.id === p2.id), 'projeto restaurado');

  server.close();
  origLog(`\n${pass} testes ok, ${failN} falha(s). PDFs em ${OUT}\n`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { origLog(e); process.exit(1); });
