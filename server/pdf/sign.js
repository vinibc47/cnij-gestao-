// =====================================================================
// Placa de obra: composição em SVG (unidades em milímetros) usada tanto
// na prévia do site quanto no PDF em tamanho físico (vetorial: textos,
// logo e QR Code; a foto entra com a resolução original, sem distorção).
// Referência: Placa_prova_visual.pdf (composição e hierarquia mantidas; tamanhos proporcionais).
// =====================================================================
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const INSTAGRAM_URL = 'https://www.instagram.com/irineujuniorarquiteto/';
const INSTAGRAM_HANDLE = '@irineujuniorarquiteto';
const SIZES = {
  '150x100': { w: 1500, h: 1000, label: '1,50 × 1,00 m', large: true }, '120x80': { w: 1200, h: 800, label: '1,20 × 0,80 m', large: true }, '100x70': { w: 1000, h: 700, label: '1,00 × 0,70 m', large: true },
  A4: { w: 210, h: 297, label: 'A4', series: true }, A3: { w: 297, h: 420, label: 'A3', series: true }, A2: { w: 420, h: 594, label: 'A2', series: true }, A1: { w: 594, h: 841, label: 'A1', series: true },
};
function dims(size, orientation) {
  const s = SIZES[size] || SIZES['150x100'];
  if (!s.series) return { w: s.w, h: s.h, ...s };
  const land = orientation === 'paisagem';
  return { ...s, w: land ? s.h : s.w, h: land ? s.w : s.h };
}
const THEMES = {
  escuro: { bg: '#111111', text: '#f2efeb', label: '#a39d96', line: '#3a3632', accent: '#8a7560', panel: '#1c1b1a' },
  claro: { bg: '#ffffff', text: '#1a1a1a', label: '#77716b', line: '#dcd8d2', accent: '#8a7560', panel: '#f3f1ee' },
};

const LOGO_SVG = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'img', 'logo-vetor.svg'), 'utf8');
const LOGO_VB = (LOGO_SVG.match(/viewBox="([^"]+)"/) || [])[1].split(/\s+/).map(Number);
const LOGO_INNER = LOGO_SVG.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const LOGO_RATIO = LOGO_VB[2] / LOGO_VB[3];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const up = (s) => String(s || '').toLocaleUpperCase('pt-BR');
const n2 = (v) => Math.round(v * 100) / 100;

// Quebra de linha aproximada pela largura média dos caracteres
function wrap(text, width, size, factor = 0.56) {
  const words = String(text || '').split(/\s+/).filter(Boolean); const lines = []; let cur = '';
  const max = Math.max(4, Math.floor(width / (size * factor)));
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (t.length > max && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}
function textBlock(x, y, lines, { size, fill, font = 'Inter', weight = 400, spacing = 0, lh = 1.2, anchor = 'start' }) {
  return lines.map((l, i) => `<text x="${n2(x)}" y="${n2(y + size + i * size * lh)}" font-family="${font}" font-size="${n2(size)}" font-weight="${weight}" fill="${fill}" letter-spacing="${n2(spacing)}" text-anchor="${anchor}">${esc(l)}</text>`).join('');
}
// divide em linhas de tamanho equilibrado (ex.: IRINEU GARCIA / MARTINS JUNIOR)
function wrapBalanced(text, width, size, factor) {
  const l = wrap(text, width, size, factor);
  if (l.length !== 2) return l;
  const words = String(text).split(/\s+/).filter(Boolean); let best = l; let bestMax = Math.max(...l.map((x) => x.length));
  for (let i = 1; i < words.length; i++) { const a = words.slice(0, i).join(' '); const b = words.slice(i).join(' '); const mx = Math.max(a.length, b.length); if (mx < bestMax && wrap(a, width, size, factor).length === 1 && wrap(b, width, size, factor).length === 1) { best = [a, b]; bestMax = mx; } }
  return best;
}
const blockH = (n, size, lh = 1.2) => (n ? size + (n - 1) * size * lh : 0);

function logo(cx, y, width) {
  const h = width / LOGO_RATIO; const s = width / LOGO_VB[2];
  return { svg: `<g transform="translate(${n2(cx - width / 2)} ${n2(y)}) scale(${s})">${LOGO_INNER}</g>`, h };
}
function qr(x, y, size, theme) {
  const q = QRCode.create(INSTAGRAM_URL, { errorCorrectionLevel: 'M' });
  const n = q.modules.size; const quiet = 4; const cell = size / (n + quiet * 2);
  let rects = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (q.modules.get(r, c)) { let e = c; while (e + 1 < n && q.modules.get(r, e + 1)) e++; rects += `<rect x="${n2(x + (quiet + c) * cell)}" y="${n2(y + (quiet + r) * cell)}" width="${n2((e - c + 1) * cell + 0.01)}" height="${n2(cell + 0.01)}"/>`; c = e + 1; } else c++;
    }
  }
  // fundo branco com área livre (quiet zone) para leitura em qualquer tema
  return `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(size)}" height="${n2(size)}" fill="#ffffff" rx="${n2(cell)}"/><g fill="#111111">${rects}</g>`;
}
const igIcon = (x, y, s, color) => `<g fill="none" stroke="${color}" stroke-width="${n2(s * 0.09)}"><rect x="${n2(x)}" y="${n2(y)}" width="${n2(s)}" height="${n2(s)}" rx="${n2(s * 0.28)}"/><circle cx="${n2(x + s / 2)}" cy="${n2(y + s / 2)}" r="${n2(s * 0.22)}"/></g><circle cx="${n2(x + s * 0.76)}" cy="${n2(y + s * 0.24)}" r="${n2(s * 0.055)}" fill="${color}"/>`;

// Orientação EXIF (1 a 8) de um JPEG
function jpegOrientation(buf) {
  let i = 2;
  while (i + 4 < buf.length && buf[i] === 0xff) {
    const mk = buf[i + 1]; const len = buf.readUInt16BE(i + 2);
    if (mk === 0xe1 && buf.slice(i + 4, i + 10).toString('latin1') === 'Exif\0\0') {
      const t = i + 10; const le = buf.slice(t, t + 2).toString('latin1') === 'II';
      const r16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)); const r32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      const ifd = t + r32(t + 4); const n = r16(ifd);
      for (let k = 0; k < n; k++) { const e = ifd + 2 + k * 12; if (r16(e) === 0x0112) return r16(e + 8) || 1; }
      return 1;
    }
    if (mk === 0xda) break;
    i += 2 + len;
  }
  return 1;
}
// Cópia do JPEG com a orientação EXIF zerada (=1): no PDF a rotação é aplicada pelo próprio desenho,
// garantindo o mesmo enquadramento da prévia sem reprocessar (nem recomprimir) a foto
function resetOrientation(buf) {
  const out = Buffer.from(buf); let i = 2;
  while (i + 4 < out.length && out[i] === 0xff) {
    const mk = out[i + 1]; const len = out.readUInt16BE(i + 2);
    if (mk === 0xe1 && out.slice(i + 4, i + 10).toString('latin1') === 'Exif\0\0') {
      const t = i + 10; const le = out.slice(t, t + 2).toString('latin1') === 'II';
      const r16 = (o) => (le ? out.readUInt16LE(o) : out.readUInt16BE(o)); const r32 = (o) => (le ? out.readUInt32LE(o) : out.readUInt32BE(o));
      const ifd = t + r32(t + 4); const n = r16(ifd);
      for (let k = 0; k < n; k++) { const e = ifd + 2 + k * 12; if (r16(e) === 0x0112) { if (le) out.writeUInt16LE(1, e + 8); else out.writeUInt16BE(1, e + 8); } }
      return out;
    }
    if (mk === 0xda) break;
    i += 2 + len;
  }
  return out;
}
// Dimensões da imagem (PNG ou JPEG) sem dependências externas
function imageSize(buf) {
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), mime: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const mk = buf[i + 1]; const len = buf.readUInt16BE(i + 2);
      if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) {
        const h = buf.readUInt16BE(i + 5); const w = buf.readUInt16BE(i + 7); const o = jpegOrientation(buf);
        // fotos de celular giradas pelo EXIF: largura/altura efetivas trocam (igual ao navegador e ao PDF)
        return o >= 5 && o <= 8 ? { w: h, h: w, mime: 'image/jpeg', orientation: o } : { w, h, mime: 'image/jpeg', orientation: o };
      }
      i += 2 + len;
    }
  }
  return null;
}

// <image> na caixa exibida. Com img.oriented (PDF), a foto vem sem a marca EXIF e a rotação é aplicada aqui.
function imageTag(img, x, y, dw, dh) {
  const tag = (w, h, tr) => `<image x="0" y="0" width="${n2(w)}" height="${n2(h)}" preserveAspectRatio="none" href="${img.href}" xlink:href="${img.href}" transform="${tr}"/>`;
  const o = img.oriented ? img.orientation || 1 : 1;
  const M = {
    1: [dw, dh, `matrix(1 0 0 1 ${n2(x)} ${n2(y)})`], 2: [dw, dh, `matrix(-1 0 0 1 ${n2(x + dw)} ${n2(y)})`],
    3: [dw, dh, `matrix(-1 0 0 -1 ${n2(x + dw)} ${n2(y + dh)})`], 4: [dw, dh, `matrix(1 0 0 -1 ${n2(x)} ${n2(y + dh)})`],
    5: [dh, dw, `matrix(0 1 1 0 ${n2(x)} ${n2(y)})`], 6: [dh, dw, `matrix(0 1 -1 0 ${n2(x + dw)} ${n2(y)})`],
    7: [dh, dw, `matrix(0 -1 -1 0 ${n2(x + dw)} ${n2(y + dh)})`], 8: [dh, dw, `matrix(0 -1 1 0 ${n2(x)} ${n2(y + dh)})`],
  }[o] || [dw, dh, `matrix(1 0 0 1 ${n2(x)} ${n2(y)})`];
  return tag(...M);
}
// Foto enquadrada (cobre a área sem distorcer; foco e zoom ajustáveis)
function photo(box, img, { fx = 50, fy = 50, zoom = 1 }, t, id, preview) {
  if (!img) return { svg: `<rect x="${n2(box.x)}" y="${n2(box.y)}" width="${n2(box.w)}" height="${n2(box.h)}" fill="${t.panel}"/>${preview ? textBlock(box.x + box.w / 2, box.y + box.h / 2 - box.h * 0.03, ['Foto ou render do projeto'], { size: box.h * 0.04, fill: t.label, anchor: 'middle' }) : ''}`, ppi: null };
  const z = Math.max(1, Math.min(4, Number(zoom) || 1));
  const s = Math.max(box.w / img.w, box.h / img.h) * z;
  const dw = img.w * s; const dh = img.h * s;
  const x = box.x + (box.w - dw) * (Math.max(0, Math.min(100, fx)) / 100); const y = box.y + (box.h - dh) * (Math.max(0, Math.min(100, fy)) / 100);
  const ppi = img.w / (dw / 25.4);
  return {
    svg: `<defs><clipPath id="${id}"><rect x="${n2(box.x)}" y="${n2(box.y)}" width="${n2(box.w)}" height="${n2(box.h)}"/></clipPath></defs><g clip-path="url(#${id})">${imageTag(img, x, y, dw, dh)}</g>`,
    ppi: Math.round(ppi),
  };
}

// Coluna de dados, como na prova visual: traço, serviço, obra, responsável, registros e contato,
// distribuídos na altura disponível (a escala reduz só se o conteúdo não couber)
function infoGroups(d) {
  const g = [{ kind: 'rule' }];
  if (d.service_line) g.push({ kind: 'svc', text: d.service_line });
  if (d.obra_nome || d.endereco) g.push({ kind: 'obra', value: d.obra_nome || '', sub: d.endereco || '' });
  (d.people || []).filter((p) => p && (p.nome || p.funcao)).forEach((p) => {
    g.push({ kind: 'person', name: p.nome || '', role: p.funcao || '' });
    if (p.registro) g.push({ kind: 'field', label: up(p.registro_label || 'CAU'), value: p.registro });
    if (p.rrt_label || p.rrt) g.push({ kind: 'field', label: up(p.rrt_label || 'RRT'), value: p.rrt || '' });
  });
  (d.extra_fields || []).filter((f) => f && (f.label || f.value)).forEach((f) => g.push({ kind: 'field', label: up(f.label), value: f.value || '' }));
  if (d.contato) g.push({ kind: 'field', label: up(d.contato_label || 'Contato'), value: d.contato });
  return g;
}
function drawGroup(it, x, y, w, sz, t) {
  let svg = ''; let h = 0;
  if (it.kind === 'rule') return { svg: `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(sz.value * 1.9)}" height="${n2(Math.max(sz.value * 0.06, 0.4))}" fill="${t.label}"/>`, h: sz.value * 0.06 };
  if (it.kind === 'svc') { const l = wrap(up(it.text), w, sz.svc, 0.72); return { svg: textBlock(x, y, l, { size: sz.svc, fill: t.text, spacing: sz.svc * 0.08 }), h: blockH(l.length, sz.svc, 1.3) }; }
  if (it.kind === 'person') {
    const l = wrapBalanced(up(it.name), w, sz.name, 0.64); svg += textBlock(x, y, l, { size: sz.name, fill: t.text, lh: 1.28 }); h += blockH(l.length, sz.name, 1.28);
    if (it.role) { const r = wrap(up(it.role), w, sz.role, 0.74); h += sz.role * 1.2; svg += textBlock(x, y + h, r, { size: sz.role, fill: t.label, spacing: sz.role * 0.12 }); h += blockH(r.length, sz.role); }
    return { svg, h };
  }
  if (it.kind === 'obra') {
    svg += textBlock(x, y, ['OBRA'], { size: sz.label, fill: t.label, spacing: sz.label * 0.14 }); h += sz.label * 1.8;
    if (it.value) { const l = wrap(it.value, w, sz.obra); svg += textBlock(x, y + h, l, { size: sz.obra, fill: t.text }); h += blockH(l.length, sz.obra); }
    if (it.sub) { const l = wrap(it.sub, w, sz.role, 0.6); h += sz.role * 0.55; svg += textBlock(x, y + h, l, { size: sz.role, fill: t.label }); h += blockH(l.length, sz.role); }
    return { svg, h };
  }
  svg += textBlock(x, y, [it.label], { size: sz.label, fill: t.label, spacing: sz.label * 0.14 }); h += sz.label * 1.8;
  const l = it.value ? wrap(it.value, w, sz.value) : [];
  svg += textBlock(x, y + h, l, { size: sz.value, fill: t.text }); h += Math.max(blockH(l.length, sz.value), sz.value);
  return { svg, h };
}
function renderInfo(x, y, w, maxH, d, t, u, cols = 1) {
  const groups = infoGroups(d);
  const gapX = 6 * u; const cw = cols === 2 ? (w - gapX) / 2 : w;
  let last = '';
  for (let step = 0; step <= 14; step++) {
    const k = 1 - step * 0.05;
    const sz = { svc: 1.75 * u * k, name: 2.75 * u * k, role: 1.4 * u * k, label: 1.35 * u * k, value: 2.5 * u * k, obra: 2.0 * u * k };
    const minGap = 2.6 * u * k; const maxGap = 9 * u;
    // colunas: na placa em retrato os registros e o contato vão para a 2ª coluna
    const colsG = cols === 2 ? [groups.filter((g) => g.kind !== 'field'), groups.filter((g) => g.kind === 'field')] : [groups];
    const measured = colsG.map((list) => list.map((g) => ({ g, ...drawGroup(g, 0, 0, cw, sz, t) })));
    const natural = measured.map((list) => list.reduce((a, m) => a + m.h, 0));
    const fits = measured.every((list, i) => natural[i] + minGap * Math.max(0, list.length - 1) <= maxH);
    if (!fits && step < 14) continue;
    last = measured.map((list, i) => {
      const gap = list.length > 1 ? Math.max(minGap, Math.min(maxGap, (maxH - natural[i]) / (list.length - 1))) : 0;
      let cy = y; const cx = x + i * (cw + gapX);
      return list.map((m, j) => { const r = drawGroup(m.g, cx, cy, cw, sz, t); cy += r.h + (m.g.kind === 'rule' ? Math.min(gap, 3.5 * u) : gap); return r.svg; }).join('');
    }).join('');
    return last;
  }
  return last;
}
// Largura real dos textos (métricas da fonte Inter usada no PDF), para posicionar sem sobreposição
let FONT = null;
function textW(str, size, spacing = 0) {
  try {
    if (!FONT) FONT = require('@foliojs-fork/fontkit').openSync(path.join(__dirname, 'fonts', 'inter-latin-400-normal.ttf'));
    return (FONT.layout(String(str)).advanceWidth / FONT.unitsPerEm) * size + spacing * String(str).length;
  } catch { return String(str).length * size * 0.56 + spacing * String(str).length; }
}
// Bloco dos perfis do Instagram: tamanhos fixos, retorna largura/altura reais e o desenho
function handlesBlock(d, { hs, rowH }) {
  const list = (d.handles || []).filter((x_) => x_ && x_.handle).slice(0, 4).map((it) => ({ ...it, handle: it.handle.startsWith('@') ? it.handle : '@' + it.handle }));
  const ds = hs * 0.72; const tx = hs * 1.65;
  const w = list.length ? tx + Math.max(...list.map((it) => Math.max(textW(it.handle, hs), it.desc ? textW(it.desc, ds) : 0))) : 0;
  const h = list.length * rowH;
  const draw = (x, y, t) => list.map((it, i) => {
    const cy = y + i * rowH + rowH * 0.12;
    return `${igIcon(x, cy + hs * 0.02, hs * 1.02, t.text)}${textBlock(x + tx, cy - hs * 0.14, [it.handle], { size: hs, fill: t.text })}${it.desc ? textBlock(x + tx, cy + hs * 1.25, [it.desc], { size: ds, fill: t.label }) : ''}`;
  }).join('');
  return { w, h, draw, n: list.length };
}
// tamanho dos perfis: cabe na altura da faixa e, se preciso, na largura disponível
function handleSize(d, h, u, maxW) {
  const n = Math.max(1, (d.handles || []).filter((x_) => x_ && x_.handle).slice(0, 4).length);
  const rowH = Math.min(h / n, 7.7 * u);
  let hs = Math.min(2.3 * u, rowH * 0.34);
  if (maxW) { const b = handlesBlock(d, { hs, rowH }); if (b.w > maxW) hs *= maxW / b.w; }
  return { hs, rowH };
}
// QR Code com "SIGA NO INSTAGRAM" acima e o perfil abaixo; retorna a largura/altura do conjunto
function qrBlock(size) {
  const hs = size * 0.095; const top = hs * 0.78;
  const w = Math.max(size, textW('SIGA NO INSTAGRAM', top, hs * 0.1), textW(INSTAGRAM_HANDLE, hs));
  const above = hs * 1.75; const below = hs * 0.35 + hs * 1.25;
  return { w, h: above + size + below, above,
    draw: (cx, qrY, t) => `${textBlock(cx, qrY - above, ['SIGA NO INSTAGRAM'], { size: top, fill: t.label, spacing: hs * 0.1, anchor: 'middle' })}${qr(cx - size / 2, qrY, size, t)}${textBlock(cx, qrY + size + hs * 0.35, [INSTAGRAM_HANDLE], { size: hs, fill: t.text, anchor: 'middle' })}` };
}
// logo encaixada numa caixa, sem alterar proporções
function logoFit(x, y, w, h, align = 'start') {
  let lw = w; if (lw / LOGO_RATIO > h) lw = h * LOGO_RATIO;
  const lh = lw / LOGO_RATIO;
  const lx = align === 'middle' ? x + (w - lw) / 2 : x;
  return logo(lx + lw / 2, y + (h - lh) / 2, lw).svg;
}

// Monta a placa completa — composição da Placa_prova_visual.pdf:
// dados à esquerda, foto grande à direita, faixa inferior com a logo à esquerda, perfis e QR Code.
function buildSvg(sign, { img, preview = false } = {}) {
  const D = dims(sign.size, sign.orientation); const W = D.w; const H = D.h;
  const t = THEMES[sign.theme] || THEMES.escuro;
  const d = sign.data || {};
  const land = W >= H;
  let body = ''; let ppi = null;
  const line = (y, x1, x2, u) => `<rect x="${n2(x1)}" y="${n2(y)}" width="${n2(x2 - x1)}" height="${n2(Math.max(0.12 * u, 0.3))}" fill="${t.line}"/>`;
  if (land) {
    const u = H / 100; const mx = W * 0.04; const mt = H * 0.045;
    const px = W * 0.333; const photoB = H * 0.69;
    const ph = photo({ x: px, y: mt, w: W - W * 0.034 - px, h: photoB - mt }, img, sign, t, 'ph', preview); body += ph.svg; ppi = ph.ppi;
    body += renderInfo(mx, H * 0.068, px - mx - 3 * u, photoB - H * 0.068 - 1 * u, d, t, u);
    const divY = H * 0.736; body += line(divY, mx, W - mx, u);
    const bandY = divY + 3.2 * u; const bandB = H - 3.4 * u; const bandH = bandB - bandY;
    body += logoFit(mx + W * 0.028, bandY, W * 0.37, bandH * 0.92);
    // perfis no tamanho atual; QR Code (mesmo tamanho) centralizado no espaço livre entre o fim dos perfis e a margem direita
    const qrS = Math.min(bandH * 0.66, 15 * u); const hx = W * 0.525;
    const hsz = handleSize(d, bandH, u, (W - mx - qrS) - 4 * u - hx);
    const hb = handlesBlock(d, hsz);
    body += hb.draw(hx, bandY + (bandH - hb.h) / 2, t);
    const qb = qrBlock(qrS); const clear = 3 * u;
    const freeL = hx + hb.w + clear; const freeR = W - mx;
    const cx = Math.max(freeL + qb.w / 2, Math.min(freeR - qb.w / 2, (hx + hb.w + freeR) / 2));
    body += qb.draw(cx, bandY + (bandH - qrS) / 2 + qrS * 0.03, t);
  } else {
    const u = W / 100; const m = 5 * u;
    const photoB = H * 0.43;
    const ph = photo({ x: m, y: m, w: W - 2 * m, h: photoB - m }, img, sign, t, 'ph', preview); body += ph.svg; ppi = ph.ppi;
    const divY = H * 0.745;
    body += renderInfo(m, photoB + 5 * u, W - 2 * m, divY - photoB - 9 * u, d, t, u * 1.12, 2);
    body += line(divY, m, W - m, u);
    const bandY = divY + 3.5 * u; const bandB = H - 4 * u; const bandH = bandB - bandY;
    // faixa inferior em uma linha: LOGO → PERFIS DO INSTAGRAM → QR CODE, centralizados na vertical,
    // margens externas simétricas e espaços iguais; perfis e QR mantêm o tamanho, só a logo cresce
    const qrS = Math.min(bandH * 0.52, 16 * u);
    const u2 = u * 1.45; const hsz = handleSize(d, bandH * 0.54, u2, (W - m - qrS) - 4 * u - m);
    const hb = handlesBlock(d, hsz); const qb = qrBlock(qrS);
    const cy = bandY + bandH / 2; const avail = W - 2 * m;
    const oldLogoW = Math.min(W * 0.5, bandH * 0.4 * LOGO_RATIO);
    const maxLogoW = bandH * 0.8 * LOGO_RATIO;
    let gap = 3 * u; let lw = avail - hb.w - qb.w - 2 * gap;
    if (lw < oldLogoW * 1.1) { gap = Math.max(1.8 * u, (avail - hb.w - qb.w - oldLogoW * 1.1) / 2); lw = avail - hb.w - qb.w - 2 * gap; }
    if (lw > maxLogoW) { lw = maxLogoW; gap = (avail - hb.w - qb.w - lw) / 2; }
    const lh = lw / LOGO_RATIO;
    body += logo(m + lw / 2, cy - lh / 2, lw).svg;
    const hxP = m + lw + gap; body += hb.draw(hxP, cy - hb.h / 2 - hsz.rowH * 0.06, t);
    const qcx = W - m - qb.w / 2; body += qb.draw(qcx, cy - qb.h / 2 + qb.above, t);
  }
  // sangria: só o fundo se estende além do corte; o layout continua medido no tamanho final
  const b = preview ? 0 : bleedOf(d);
  const VW = W + 2 * b; const VH = H + 2 * b;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${-b} ${-b} ${VW} ${VH}" width="${preview ? '100%' : VW + 'mm'}" ${preview ? '' : `height="${VH}mm"`}><rect x="${-b}" y="${-b}" width="${VW}" height="${VH}" fill="${t.bg}"/>${body}</svg>`;
  return { svg, w: W, h: H, bleed: b, ppi, lowRes: ppi !== null && ppi < REF_PPI, minPpi: REF_PPI };
}

const REF_PPI = 300; // referência de alta qualidade para a foto na impressão
const bleedOf = (d) => Math.max(0, Math.min(20, Number(d && d.bleed_mm) || 0));
module.exports = { resetOrientation, REF_PPI, bleedOf, jpegOrientation, buildSvg, dims, SIZES, imageSize, INSTAGRAM_URL, INSTAGRAM_HANDLE };
