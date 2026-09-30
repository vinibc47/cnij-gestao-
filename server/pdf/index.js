// =====================================================================
// Padrão visual dos PDFs do sistema (pdfmake): A4, fundo branco, logo
// pequena no canto superior direito, título, texto de finalidade,
// identificação do cliente/projeto, conteúdo, rodapé com escritório,
// data de emissão e paginação. Texto selecionável (não é captura de tela).
// =====================================================================
const fs = require('fs');
const path = require('path');
const PdfPrinter = require('pdfmake');
const { getSetting, DB_FILE } = require('../db');
const docs = require('../services/docs');
const { today } = require('../util');

const F = path.join(__dirname, 'fonts');
const printer = new PdfPrinter({
  Inter: { normal: path.join(F, 'inter-latin-400-normal.ttf'), bold: path.join(F, 'inter-latin-600-normal.ttf'), italics: path.join(F, 'inter-latin-400-normal.ttf'), bolditalics: path.join(F, 'inter-latin-600-normal.ttf') },
  InterMedium: { normal: path.join(F, 'inter-latin-500-normal.ttf'), bold: path.join(F, 'inter-latin-600-normal.ttf'), italics: path.join(F, 'inter-latin-500-normal.ttf'), bolditalics: path.join(F, 'inter-latin-600-normal.ttf') },
  Jost: { normal: path.join(F, 'jost-latin-400-normal.ttf'), bold: path.join(F, 'jost-latin-400-normal.ttf'), italics: path.join(F, 'jost-latin-400-normal.ttf'), bolditalics: path.join(F, 'jost-latin-400-normal.ttf') },
  JostLight: { normal: path.join(F, 'jost-latin-300-normal.ttf'), bold: path.join(F, 'jost-latin-300-normal.ttf'), italics: path.join(F, 'jost-latin-300-normal.ttf'), bolditalics: path.join(F, 'jost-latin-300-normal.ttf') },
  Serif: { normal: path.join(F, 'cormorant-garamond-latin-500-normal.ttf'), bold: path.join(F, 'cormorant-garamond-latin-600-normal.ttf'), italics: path.join(F, 'cormorant-garamond-latin-500-normal.ttf'), bolditalics: path.join(F, 'cormorant-garamond-latin-600-normal.ttf') },
});

const INK = '#1a1a1a'; const MUTED = '#77716b'; const SOFT = '#a39d96'; const LINE = '#dcd8d2'; const ACCENT = '#8a7560'; const FILL = '#f7f5f2';
const M = { l: 56, r: 56, t: 92, b: 74 };
const PAGE_W = 595.28; const CONTENT_W = PAGE_W - M.l - M.r;

const BRANDING_DIR = path.join(path.dirname(DB_FILE), 'branding');
function logoPath() {
  const custom = getSetting('office_logo', '');
  if (custom) { const p = path.join(BRANDING_DIR, path.basename(custom)); if (fs.existsSync(p)) return p; }
  return path.join(__dirname, '..', '..', 'public', 'img', 'logo.png');
}
function logoData() {
  const p = logoPath(); const ext = path.extname(p).toLowerCase();
  return `data:image/${ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : 'png'};base64,${fs.readFileSync(p).toString('base64')}`;
}

// ------------------------------ texto com **negrito** ------------------------------
function rich(text, base = {}) {
  const parts = String(text ?? '').split(/(\*\*[^*]+\*\*)/g).filter((s) => s !== '');
  if (parts.length <= 1 && !/^\*\*/.test(parts[0] || '')) return { text: String(text ?? ''), ...base };
  return { text: parts.map((s) => (/^\*\*[^*]+\*\*$/.test(s) ? { text: s.slice(2, -2), bold: true, color: INK } : s)), ...base };
}

// ------------------------------ blocos padrão ------------------------------
const rule = (w = CONTENT_W, color = LINE, width = 0.7) => ({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: w, y2: 0, lineWidth: width, lineColor: color }] });
// headlineLevel fica no texto (nós do tipo stack não têm posição para o controle de quebra de página)
const sectionTitle = (t, { keep = true } = {}) => ({ stack: [{ text: String(t).toUpperCase(), style: 'h1', headlineLevel: keep ? 1 : undefined }, { ...rule(), margin: [0, 3, 0, 7] }] });
const subTitle = (t) => ({ text: t, style: 'h2' });
const para = (t, justify) => rich(t, { style: 'p', alignment: justify ? 'justify' : 'left' });
const note = (t) => ({ text: t, style: 'note' });
const bullet = (t, justify) => ({ columns: [{ text: '•', width: 12, color: ACCENT, fontSize: 10, margin: [2, -0.5, 0, 0] }, { ...rich(t), style: 'li', alignment: justify ? 'justify' : 'left', width: '*' }], columnGap: 2, margin: [6, 0, 0, 3] });
const numbered = (n, t, justify, clause) => ({ columns: [{ text: clause ? n : `${n}.`, width: clause ? 38 : 18, bold: !!clause, style: 'li', color: clause ? INK : MUTED }, { ...rich(t), style: 'li', alignment: justify ? 'justify' : 'left', width: '*' }], columnGap: 4, margin: [clause ? 0 : 8, 0, 0, clause ? 5 : 3] });
const spacer = (h = 6) => ({ text: '', margin: [0, h / 2, 0, h / 2] });
const muted = (t) => ({ text: t, style: 'muted' });

// Grade de identificação (rótulo pequeno em cima, valor embaixo)
function identGrid(items, cols = 3) {
  const cells = items.filter((x) => x && x[1] !== undefined && x[1] !== null && String(x[1]).trim() !== '').map(([k, v, span]) => ({ k, v, span: span || 1 }));
  if (!cells.length) return spacer(2);
  const rows = []; let row = []; let used = 0;
  for (const c of cells) {
    if (used + c.span > cols) { while (used < cols) { row.push({ text: '' }); used++; } rows.push(row); row = []; used = 0; }
    row.push({ stack: [{ text: c.k.toUpperCase(), style: 'label' }, { text: String(c.v), style: 'value' }], colSpan: c.span });
    for (let i = 1; i < c.span; i++) row.push({});
    used += c.span;
  }
  if (row.length) { while (used < cols) { row.push({ text: '' }); used++; } rows.push(row); }
  return {
    table: { widths: Array(cols).fill('*'), body: rows, dontBreakRows: true },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => FILL, paddingLeft: () => 10, paddingRight: () => 10, paddingTop: (i) => (i === 0 ? 10 : 4), paddingBottom: (i, node) => (i === node.table.body.length - 1 ? 10 : 4) },
    margin: [0, 0, 0, 16],
  };
}

// Tabela de dados: cabeçalho repetido em cada página, linhas não são cortadas
function dataTable({ headers, rows, widths, align = [], foot, fontSize = 8.6, empty = 'Nenhum item registrado.' }) {
  if (!rows.length) return { ...muted(empty), margin: [0, 0, 0, 10] };
  const cell = (v, i, extra = {}) => (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length ? v : v && typeof v === 'object' && !Array.isArray(v) ? { alignment: align[i] || 'left', ...v, ...extra } : { text: v === null || v === undefined || v === '' ? '—' : String(v), alignment: align[i] || 'left', ...extra });
  const body = [headers.map((h, i) => cell(h, i, { style: 'th' })), ...rows.map((r) => r.map((v, i) => cell(v, i, { fontSize })))];
  if (foot) body.push(foot.map((v, i) => cell(v, i, { bold: true, fontSize, fillColor: FILL })));
  return {
    table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: widths || headers.map(() => '*'), body },
    layout: {
      hLineWidth: (i, node) => (i === 0 ? 0 : i === 1 || (foot && i === node.table.body.length - 1) ? 0.8 : i === node.table.body.length ? 0.8 : 0.35),
      hLineColor: (i) => (i === 1 ? '#c9c3bb' : LINE), vLineWidth: () => 0,
      fillColor: (i) => (i === 0 ? '#f1eee9' : null),
      paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 5, paddingBottom: () => 5,
    },
    margin: [0, 2, 0, 12],
  };
}

function signatures({ signers = [], witnesses = [] }) {
  const sig = (s) => ({ stack: [{ ...rule(230, '#8f8a84', 0.6), alignment: 'center', margin: [0, 34, 0, 4] }, { text: `${s.name || ' '} – ${s.role}`, bold: true, fontSize: 9, alignment: 'center' }, s.doc ? { text: s.doc, fontSize: 8.5, alignment: 'center', color: MUTED } : '', s.extra ? { text: s.extra, fontSize: 8, alignment: 'center', color: MUTED } : ''], width: 230 });
  const center = (s) => ({ columns: [{ text: '', width: '*' }, sig(s), { text: '', width: '*' }] });
  const out = signers.map(center);
  if (witnesses.length) out.push({ columns: witnesses.map((w) => ({ ...sig(w), width: '*' })), columnGap: 24, margin: [0, 10, 0, 0] });
  return { stack: out, unbreakable: true, margin: [0, 8, 0, 0] };
}

// Converte as linhas resolvidas do modelo (docs.resolve) em conteúdo do PDF
function tokensToContent(tokens, { justify = false } = {}) {
  const nodes = [];
  for (const tk of tokens) {
    switch (tk.t) {
      case 'h1': nodes.push({ ...sectionTitle(tk.text, { keep: false }), _h: true }); break;
      case 'h2': nodes.push({ ...subTitle(tk.text), _h: true }); break;
      case 'note': nodes.push(note(tk.text)); break;
      case 'p': nodes.push(para(tk.text, justify)); break;
      case 'li': nodes.push(bullet(tk.text, justify)); break;
      case 'ol': nodes.push(numbered(tk.num, tk.text, justify)); break;
      case 'clause': nodes.push(numbered(tk.num, tk.text, justify, true)); break;
      case 'right': nodes.push({ text: tk.text, alignment: 'right', style: 'p', margin: [0, 18, 0, 6], _right: true }); break;
      case 'blank': if (nodes.length && !nodes[nodes.length - 1]._blank) nodes.push({ ...spacer(5), _blank: true }); break;
      case 'block': {
        const d = tk.data;
        if (tk.name === 'etapas_prazos') nodes.push({ ...dataTable({ headers: ['Etapa', 'Prazo'], rows: (d || []).map((r) => [r.etapa || '', r.prazo || '']), widths: ['*', 180] }), _table: true });
        else if (tk.name === 'assinaturas') {
          // local e data ficam na mesma página das assinaturas
          const sg = signatures(d || {}); let k = nodes.length - 1;
          while (k >= 0 && nodes[k]._blank) k--;
          if (k >= 0 && nodes[k]._right) { const r = nodes.splice(k); sg.stack.unshift(...r.filter((x) => x._right).map((x) => { delete x._right; return x; })); }
          nodes.push(sg);
        }
        else if (tk.name === 'servicos') {
          const list = d || [];
          if (list.some((x) => x.amount != null)) {
            const all_ = list.every((x) => x.amount != null);
            nodes.push({ ...dataTable({ headers: ['Serviço', 'Descrição', 'Valor'], widths: [150, '*', 90], align: ['left', 'left', 'right'],
              rows: list.map((x) => [{ text: x.label, bold: true }, x.description || '', x.amount != null ? docs.brl(x.amount) : 'a combinar']),
              foot: all_ && list.length > 1 ? [{ text: 'TOTAL DOS SERVIÇOS', colSpan: 2, alignment: 'right', characterSpacing: 0.6 }, {}, { text: docs.brl(list.reduce((a, x) => a + x.amount, 0)), alignment: 'right' }] : null }), _table: true });
          } else list.forEach((x) => nodes.push(bullet(x.description ? `**${x.label}** — ${x.description}` : `**${x.label}**`, justify)));
        }
        else if (tk.name === 'condicoes') (d || []).forEach((l) => nodes.push(/^[-•]\s+/.test(l) ? bullet(l.replace(/^[-•]\s+/, ''), justify) : para(l, justify)));
        else (d || []).forEach((l) => nodes.push(bullet(l, justify)));
        break;
      }
      default: break;
    }
  }
  // títulos nunca ficam sozinhos no fim da página: agrupa com o bloco seguinte
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n._h) {
      const group = [n]; let j = i + 1;
      while (j < nodes.length && (nodes[j]._h || nodes[j]._blank)) { group.push(nodes[j]); j++; }
      if (j < nodes.length && !nodes[j]._table && !nodes[j].unbreakable) { group.push(nodes[j]); i = j; } else { i = j - 1; if (j < nodes.length && nodes[j]._table && group[0].stack) group[0].stack[0].headlineLevel = 1; }
      out.push(group.length > 1 ? { stack: group, unbreakable: true } : n);
    } else out.push(n);
  }
  return out.map((n) => { delete n._h; delete n._blank; delete n._table; delete n._right; return n; });
}

// ------------------------------ documento ------------------------------
function build({ title, purpose, ident = [], content = [], issuedAt, draft = false, info = {}, landscape = false }) {
  const cw = landscape ? 841.89 - M.l - M.r : CONTENT_W;
  const o = docs.office();
  const issued = docs.brDate(String(issuedAt || today()).slice(0, 10));
  const contact = [o.address, o.phone, o.email].filter(Boolean).join('  ·  ');
  let logo = null; try { logo = logoData(); } catch { logo = null; }
  // a margem inferior do último bloco não pode criar uma página em branco no fim do documento
  const items = [...content];
  while (items.length && (items[items.length - 1] === '' || items[items.length - 1] == null)) items.pop();
  const last = items[items.length - 1];
  if (last && typeof last === 'object' && Array.isArray(last.margin) && last.margin.length === 4) items[items.length - 1] = { ...last, margin: [last.margin[0], last.margin[1], last.margin[2], 0] };
  return {
    pageSize: 'A4', pageOrientation: landscape ? 'landscape' : 'portrait', pageMargins: [M.l, M.t, M.r, M.b],
    info: { title: info.title || title, author: o.name, subject: purpose, creator: 'CN&IJ Gestão', producer: 'CN&IJ Gestão' },
    watermark: draft ? { text: 'RASCUNHO', color: '#b0473b', opacity: 0.06, bold: true, fontSize: 90 } : undefined,
    // logo oficial centralizada no topo de todas as páginas (proporções preservadas)
    header: () => (logo ? { image: logo, fit: [112, 40], alignment: 'center', margin: [M.l, 28, M.r, 0] } : null),
    footer: (page, pages) => ({
      margin: [M.l, 22, M.r, 0],
      stack: [rule(cw, LINE, 0.6),
        { columns: [{ text: `${o.name.toUpperCase()}  ·  ${o.tagline.toUpperCase()}`, fontSize: 6.8, characterSpacing: 0.6, color: MUTED, width: '*' }, { text: `Emitido em ${issued}`, fontSize: 7.2, color: MUTED, width: 'auto', margin: [0, 0, 18, 0] }, { text: `Página ${page} de ${pages}`, fontSize: 7.2, color: MUTED, width: 'auto' }], margin: [0, 7, 0, 0] },
        contact ? { text: contact, fontSize: 6.8, color: SOFT, margin: [0, 3, 0, 0] } : ''],
    }),
    content: [
      { text: title, style: 'title' },
      purpose ? { text: purpose, style: 'purpose' } : spacer(6),
      identGrid(ident),
      ...items,
    ],
    // títulos de seção não ficam sozinhos no pé da página: se começarem nos últimos ~85 pt úteis, vão para a próxima
    pageBreakBefore: (node) => node.headlineLevel === 1 && !!node.startPosition && node.startPosition.top > (landscape ? 595.28 : 841.89) - M.b - 85,
    defaultStyle: { font: 'Inter', fontSize: 9.4, color: INK, lineHeight: 1.32 },
    styles: {
      title: { font: 'Serif', fontSize: 27, color: INK, lineHeight: 1.05, margin: [0, 6, 0, 5] },
      purpose: { fontSize: 9.4, color: MUTED, lineHeight: 1.4, margin: [0, 0, 0, 16] },
      h1: { font: 'InterMedium', fontSize: 9, characterSpacing: 1.1, color: INK, margin: [0, 12, 0, 0] },
      h2: { font: 'Serif', fontSize: 14.5, color: INK, margin: [0, 6, 0, 3], lineHeight: 1.1 },
      p: { margin: [0, 0, 0, 5] }, li: { lineHeight: 1.3 },
      note: { fontSize: 8.4, color: ACCENT, margin: [0, -1, 0, 5] },
      label: { fontSize: 6.8, color: MUTED, characterSpacing: 0.8, margin: [0, 0, 0, 2] },
      value: { fontSize: 9.4, color: INK, lineHeight: 1.2 },
      th: { font: 'InterMedium', fontSize: 7, color: MUTED, characterSpacing: 0.6 },
      muted: { fontSize: 8.8, color: MUTED },
      total: { font: 'InterMedium', fontSize: 10.5 },
    },
  };
}

function render(docDef) {
  return new Promise((resolve, reject) => {
    try {
      const boxes = docDef._boxes; if (boxes) delete docDef._boxes;
      const d = printer.createPdfKitDocument(docDef, boxes ? { bufferPages: true } : {});
      if (boxes) { const r = d.bufferedPageRange(); for (let i = r.start; i < r.start + r.count; i++) { d.switchToPage(i); d.page.dictionary.data.TrimBox = boxes.trim; d.page.dictionary.data.BleedBox = boxes.bleed; } }
      const chunks = []; d.on('data', (c) => chunks.push(c)); d.on('end', () => resolve(Buffer.concat(chunks))); d.on('error', reject); d.end();
    } catch (e) { reject(e); }
  });
}
async function send(res, docDef, filename, download) {
  const buf = await render(docDef);
  const safe = String(filename || 'documento.pdf').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', buf.length);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${safe.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '')}"; filename*=UTF-8''${encodeURIComponent(safe)}`);
  res.end(buf);
}

// Placa de obra: página no tamanho físico escolhido, arte vetorial (SVG) ocupando a página inteira
// Placa: uma página no tamanho físico (corte + sangria), sem margens; tudo vetorial exceto a foto.
function signDoc(svg, wmm, hmm, title, { bleed = 0, subject = '' } = {}) {
  const pt = (mm) => (mm * 72) / 25.4;
  const W = pt(wmm + 2 * bleed); const H = pt(hmm + 2 * bleed);
  return { pageSize: { width: W, height: H }, pageMargins: [0, 0, 0, 0],
    info: { title, subject, author: docs.office().name, creator: 'CN&IJ Gestão', producer: 'CN&IJ Gestão' },
    content: [{ svg, width: W, height: H, font: 'Inter' }], defaultStyle: { font: 'Inter' },
    // caixas do PDF: TrimBox = tamanho final de corte; BleedBox = corte + sangria
    _boxes: { trim: [pt(bleed), pt(bleed), W - pt(bleed), H - pt(bleed)], bleed: [0, 0, W, H] } };
}

// Perfis de cor: mantém o perfil ICC embutido na foto (JPEG APP2 / PNG iCCP) como espaço de cor ICCBased,
// em vez de descartá-lo; sem perfil, a imagem continua em RGB do dispositivo (nada é convertido).
function iccFrom(buf) {
  try {
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      const parts = []; let i = 2;
      while (i + 4 < buf.length && buf[i] === 0xff) {
        const mk = buf[i + 1]; const len = buf.readUInt16BE(i + 2);
        if (mk === 0xe2 && buf.slice(i + 4, i + 16).toString('latin1') === 'ICC_PROFILE\0') parts.push({ n: buf[i + 16], data: buf.slice(i + 18, i + 2 + len) });
        if (mk === 0xda) break; i += 2 + len;
      }
      return parts.length ? Buffer.concat(parts.sort((a, b) => a.n - b.n).map((p) => p.data)) : null;
    }
    if (buf.slice(1, 4).toString('latin1') === 'PNG') {
      let i = 8;
      while (i + 8 < buf.length) {
        const len = buf.readUInt32BE(i); const type = buf.slice(i + 4, i + 8).toString('latin1');
        if (type === 'iCCP') { const c = buf.slice(i + 8, i + 8 + len); const z = c.indexOf(0); return require('zlib').inflateSync(c.slice(z + 2)); }
        if (type === 'IDAT') break; i += 12 + len;
      }
    }
  } catch { /* sem perfil legível */ }
  return null;
}
{
  const PDFDocument = require('@foliojs-fork/pdfkit');
  const orig = PDFDocument.prototype.openImage;
  PDFDocument.prototype.openImage = function (src) {
    const img = orig.call(this, src);
    if (img && !img._iccWrapped) {
      img._iccWrapped = true;
      const buf = Buffer.isBuffer(src) ? src : typeof src === 'string' && src.startsWith('data:') ? Buffer.from(src.slice(src.indexOf(',') + 1), 'base64') : null;
      const icc = buf && iccFrom(buf);
      if (icc) {
        const embed = img.embed.bind(img);
        img.embed = (doc) => {
          const ref = doc.ref; let done = false;
          doc.ref = (data) => {
            // 1ª imagem criada = a foto (máscaras de transparência vêm depois); JPEG define a cor na criação, PNG logo em seguida
            if (!done && data && data.Subtype === 'Image') {
              done = true; let cs = data.ColorSpace;
              const n = icc.length > 20 ? icc.slice(16, 20).toString('latin1') : 'RGB ';
              const alt = n === 'GRAY' ? 'DeviceGray' : 'DeviceRGB';
              // o perfil é gravado antes da imagem (nunca durante a escrita dela)
              const iccRef = ref.call(doc, { N: alt === 'DeviceRGB' ? 3 : 1, Alternate: alt }); iccRef.end(icc);
              const wrapCs = (v) => (v === alt ? ['ICCBased', iccRef] : v);
              Object.defineProperty(data, 'ColorSpace', { enumerable: true, configurable: true, get: () => (cs === undefined ? undefined : wrapCs(cs)), set: (v) => { cs = v; } });
            }
            return ref.call(doc, data);
          };
          try { return embed(doc); } finally { doc.ref = ref; }
        };
      }
    }
    return img;
  };
}
module.exports = { signDoc, build, render, send, tokensToContent, sectionTitle, subTitle, para, note, bullet, numbered, dataTable, identGrid, signatures, spacer, muted, rich, rule, logoPath, BRANDING_DIR, CONTENT_W, FILL, MUTED };
