// =====================================================================
// Apresentações — desenho dos slides (compartilhado entre o editor no
// navegador e o PDF gerado no servidor). Cada slide vira um SVG com a
// mesma geometria nos dois lugares: a prévia é exatamente o que sai no PDF.
//
// Coordenadas em pontos (1/72 pol.). 4:3 = 768 × 576 (igual ao modelo do
// escritório) e 16:9 = 1024 × 576. Anotações ficam em coordenadas relativas
// (0–1) à imagem desenhada, para continuarem alinhadas ao trocar o formato.
// =====================================================================
(function (root) {
  const FORMATS = { '4:3': { w: 768, h: 576, label: 'Horizontal 4:3' }, '16:9': { w: 1024, h: 576, label: 'Horizontal 16:9' } };
  const C = { band: '#C9C9C9', line: '#9E9E9E', ink: '#232323', soft: '#3F3F3F', paper: '#FFFFFF', empty: '#F1F1F1', emptyInk: '#8A8A8A' };
  const HEAD = 40; const FOOT = 42; const GAP = 3.2; const THIN = 1.1; const PAD = 22; // medidas do cabeçalho/rodapé
  const n2 = (v) => Math.round(v * 100) / 100;
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const up = (s) => String(s || '').toLocaleUpperCase('pt-BR');
  const num2 = (n) => String(n || 1).padStart(2, '0');
  const fmt = (p) => FORMATS[p && p.format] || FORMATS['4:3'];
  const FONT = "Jost, sans-serif"; const FONT_L = "JostLight, Jost, sans-serif";

  // quebra de linha aproximada (mesma regra no navegador e no PDF)
  function wrap(text, width, size, factor = 0.5) {
    const max = Math.max(4, Math.floor(width / (size * factor)));
    const out = [];
    String(text || '').split(/\n/).forEach((para) => {
      let line = '';
      para.split(/\s+/).filter(Boolean).forEach((w) => { const t = line ? `${line} ${w}` : w; if (t.length > max && line) { out.push(line); line = w; } else line = t; });
      out.push(line);
    });
    return out;
  }
  function text(x, y, str, { size = 12, fill = C.ink, font = FONT, weight = 400, anchor = 'start', spacing = 0 } = {}) {
    return `<text x="${n2(x)}" y="${n2(y)}" font-family="${font}" font-weight="${weight}" font-size="${n2(size)}" fill="${fill}" text-anchor="${anchor}"${spacing ? ` letter-spacing="${n2(spacing)}"` : ''}>${esc(str)}</text>`;
  }
  const rect = (x, y, w, h, fill, extra = '') => `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(Math.max(0, w))}" height="${n2(Math.max(0, h))}" fill="${fill}" ${extra}/>`;

  // imagem com orientação EXIF aplicada pelo desenho (sem reprocessar a foto)
  function imageTag(img, x, y, dw, dh) {
    const o = img.oriented ? img.orientation || 1 : 1;
    const M = {
      1: [dw, dh, `matrix(1 0 0 1 ${n2(x)} ${n2(y)})`], 2: [dw, dh, `matrix(-1 0 0 1 ${n2(x + dw)} ${n2(y)})`],
      3: [dw, dh, `matrix(-1 0 0 -1 ${n2(x + dw)} ${n2(y + dh)})`], 4: [dw, dh, `matrix(1 0 0 -1 ${n2(x)} ${n2(y + dh)})`],
      5: [dh, dw, `matrix(0 1 1 0 ${n2(x)} ${n2(y)})`], 6: [dh, dw, `matrix(0 1 -1 0 ${n2(x + dw)} ${n2(y)})`],
      7: [dh, dw, `matrix(0 -1 -1 0 ${n2(x + dw)} ${n2(y + dh)})`], 8: [dh, dw, `matrix(0 -1 1 0 ${n2(x)} ${n2(y + dh)})`],
    }[o] || [dw, dh, `matrix(1 0 0 1 ${n2(x)} ${n2(y)})`];
    return `<image x="0" y="0" width="${n2(M[0])}" height="${n2(M[1])}" preserveAspectRatio="none" href="${img.href}" xlink:href="${img.href}" transform="${M[2]}"/>`;
  }
  // posiciona uma imagem numa caixa: "inteira" (contain, padrão para plantas) ou "preencher" (cover, com foco e zoom)
  function placeImage(box, img, o = {}) {
    const fit = o.fit || 'contain'; const z = Math.max(1, Math.min(5, Number(o.zoom) || 1));
    // contain = imagem inteira · cover = preenche a caixa · height = altura total (capa, como no modelo)
    const s = (fit === 'cover' ? Math.max(box.w / img.w, box.h / img.h) : fit === 'height' ? box.h / img.h : Math.min(box.w / img.w, box.h / img.h)) * z;
    const dw = img.w * s; const dh = img.h * s;
    const fx = o.fx === undefined ? 50 : Math.max(0, Math.min(100, Number(o.fx))); const fy = o.fy === undefined ? 50 : Math.max(0, Math.min(100, Number(o.fy)));
    const x = box.x + (box.w - dw) * (fx / 100); const y = box.y + (box.h - dh) * (fy / 100);
    return { x, y, w: dw, h: dh, scale: s };
  }
  let clipN = 0;
  function drawImage(box, img, o, id) {
    if (!img) return { svg: rect(box.x, box.y, box.w, box.h, C.empty) + text(box.x + box.w / 2, box.y + box.h / 2 + 4, o && o.placeholder ? o.placeholder : 'Adicionar imagem', { size: 13, fill: C.emptyInk, anchor: 'middle' }), rect: null };
    const r = placeImage(box, img, o);
    const cid = `c${id || ++clipN}`;
    const clip = r.w > box.w + 0.5 || r.h > box.h + 0.5;
    const tag = imageTag(img, r.x, r.y, r.w, r.h);
    // rect visível = interseção da imagem com a caixa (referência das anotações)
    const vis = { x: Math.max(r.x, box.x), y: Math.max(r.y, box.y), w: Math.min(r.x + r.w, box.x + box.w) - Math.max(r.x, box.x), h: Math.min(r.y + r.h, box.y + box.h) - Math.max(r.y, box.y) };
    return { svg: clip ? `<defs><clipPath id="${cid}"><rect x="${n2(box.x)}" y="${n2(box.y)}" width="${n2(box.w)}" height="${n2(box.h)}"/></clipPath></defs><g clip-path="url(#${cid})">${tag}</g>` : tag, rect: r, vis, ppi: Math.round(img.w / (r.w / 72)) };
  }
  function logoTag(logo, cx, y, h) {
    if (!logo) return '';
    const w = h * (logo.w / logo.h);
    return `<image x="${n2(cx - w / 2)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" preserveAspectRatio="none" href="${logo.href}" xlink:href="${logo.href}"/>`;
  }

  // ---------------------------------------------------------------- capa
  function cover(p, A) {
    const { w: W, h: H } = fmt(p); const c = p.cover || {};
    let s = rect(0, 0, W, H, C.paper);
    const img = c.image && A.images[c.image.doc_id];
    if (img) {
      // foto inteira na altura da página (como no modelo), centralizada; enquadramento ajustável
      const box = { x: 0, y: 0, w: W, h: H };
      const r = drawImage(box, img, { fit: c.image.fit || 'height', fx: c.image.fx, fy: c.image.fy, zoom: c.image.zoom }, 'cv');
      s += r.svg;
    }
    const veil = c.veil === undefined ? 0.7 : Math.max(0, Math.min(0.95, Number(c.veil)));
    s += rect(0, 0, W, H, '#FFFFFF', `fill-opacity="${veil}"`);
    // faixa cinza com linhas finas acima e abaixo
    const y1 = H * 0.588; const t = H * 0.0095; const g = H * 0.012; const bandY = y1 + t + g; const bandH = H * 0.168;
    s += rect(0, y1, W, t, C.band) + rect(0, bandY, W, bandH, C.band) + rect(0, bandY + bandH + g, W, t, C.band);
    const title = up(c.title || 'Apresentação');
    s += text(W / 2, bandY + bandH * 0.64, title, { size: H * 0.112, font: FONT, weight: 400, anchor: 'middle', spacing: H * 0.002 });
    if (c.subtitle !== '') s += text(W / 2, bandY + bandH * 0.93, up(c.subtitle || p.project_name || ''), { size: H * 0.038, font: FONT, weight: 400, anchor: 'middle', spacing: H * 0.0018, fill: C.ink });
    const lh = H * 0.118; s += logoTag(A.logo, W / 2, H - lh - H * 0.022, lh);
    // número da apresentação (canto inferior direito)
    const nb = num2(p.number); const bs = H * 0.032;
    s += rect(W - bs * 2.6 - 8, H - bs * 2.1 - 8, bs * 2.6, bs * 2.1, '#D2D2D2') + text(W - bs * 1.3 - 8, H - 8 - bs * 0.6, nb, { size: bs * 1.15, anchor: 'middle', fill: C.ink });
    return s;
  }

  // ---------------------------------------------------------------- slides internos
  function frame(p, A, slide) {
    const { w: W, h: H } = fmt(p);
    let s = rect(0, 0, W, H, C.paper);
    // cabeçalho: faixa cinza, código à esquerda, logo ao centro, "Apresentação 0X" à direita, linha fina abaixo
    s += rect(0, 0, W, HEAD, C.band) + rect(0, HEAD + GAP, W, THIN, C.band) + `<line x1="0" y1="${HEAD}" x2="${W}" y2="${HEAD}" stroke="${C.line}" stroke-width="0.6"/>`;
    s += text(PAD, HEAD / 2 + 3.4, up(p.code || ''), { size: 9.5, fill: C.soft, spacing: 0.8 });
    s += text(W - PAD, HEAD / 2 + 3.4, up(`Apresentação ${num2(p.number)}`), { size: 9.5, fill: C.soft, anchor: 'end', spacing: 0.8 });
    s += logoTag(A.logoDark || A.logo, W / 2, 4.5, HEAD - 9);
    // rodapé: linha divisória, faixa cinza e nome do ambiente centralizado
    const fy = H - FOOT;
    s += rect(0, fy - GAP - THIN, W, THIN, C.band) + rect(0, fy, W, FOOT, C.band) + `<line x1="0" y1="${fy}" x2="${W}" y2="${fy}" stroke="${C.line}" stroke-width="0.6"/>`;
    const room = slide.kind === 'planta' ? (slide.room || 'Planta de layout') : slide.room;
    s += text(W / 2, fy + FOOT / 2 + 6.5, up(room || ''), { size: 18.5, anchor: 'middle', spacing: 0.6, fill: C.ink });
    return s;
  }
  // caixas de imagem conforme o layout (área entre cabeçalho e rodapé)
  function boxes(p, slide) {
    const { w: W, h: H } = fmt(p);
    const top = HEAD + GAP + THIN + 9; const bottom = H - FOOT - GAP - THIN - 9; const x0 = 24; const ww = W - 48; const hh = bottom - top;
    if (slide.layout === '2') { const g = 10; const w2 = (ww - g) / 2; return [{ x: x0, y: top, w: w2, h: hh }, { x: x0 + w2 + g, y: top, w: w2, h: hh }]; }
    if (slide.layout === 'texto') { const tw = Math.min(250, ww * 0.32); return [{ x: x0, y: top, w: ww - tw - 18, h: hh }, { x: x0 + ww - tw, y: top, w: tw, h: hh, text: true }]; }
    return [{ x: x0, y: top, w: ww, h: hh }];
  }
  function inner(p, A, slide, opts) {
    const bx = boxes(p, slide); const placed = [];
    let s = '';
    bx.forEach((b, i) => {
      if (b.text) {
        const lines = wrap(slide.text || '', b.w, 12.5, 0.5);
        s += `<line x1="${n2(b.x)}" y1="${n2(b.y + 4)}" x2="${n2(b.x)}" y2="${n2(b.y + b.h - 4)}" stroke="${C.band}" stroke-width="1"/>`;
        lines.forEach((l, k) => { s += text(b.x + 14, b.y + 22 + k * 18, l, { size: 12.5, fill: C.soft }); });
        if (!slide.text && opts.preview) s += text(b.x + 14, b.y + 22, 'Escreva a observação desta página', { size: 12, fill: C.emptyInk });
        return;
      }
      const im = (slide.images || [])[i];
      const img = im && A.images[im.doc_id];
      const def = slide.layout === '2' ? 'cover' : 'contain';
      const r = drawImage(b, img, { fit: (im && im.fit) || def, fx: im && im.fx, fy: im && im.fy, zoom: im && im.zoom, placeholder: slide.kind === 'planta' ? 'Planta de layout pendente' : 'Adicionar imagem' }, `s${opts.idx || 0}i${i}`);
      s += r.svg; placed.push({ box: b, rect: r.vis || null, ppi: r.ppi || null, doc_id: im && im.doc_id });
    });
    s += annotations(slide.notes_layer || slide.annotations || [], placed, opts);
    return { svg: s, placed };
  }

  // ---------------------------------------------------------------- anotações (medida, seta, observação, texto)
  const P = (r, x, y) => ({ x: r.x + r.w * x, y: r.y + r.h * y });
  function arrowHead(a, b, size, color) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x); const s = size;
    const p1 = { x: b.x - s * Math.cos(ang - 0.42), y: b.y - s * Math.sin(ang - 0.42) }; const p2 = { x: b.x - s * Math.cos(ang + 0.42), y: b.y - s * Math.sin(ang + 0.42) };
    return `<path d="M ${n2(b.x)} ${n2(b.y)} L ${n2(p1.x)} ${n2(p1.y)} L ${n2(p2.x)} ${n2(p2.y)} Z" fill="${color}"/>`;
  }
  function labelBox(cx, cy, str, size, color, bg = '#FFFFFF') {
    const w = str.length * size * 0.56 + size * 0.9; const h = size * 1.45;
    return rect(cx - w / 2, cy - h / 2, w, h, bg, 'fill-opacity="0.9" rx="2"') + text(cx, cy + size * 0.36, str, { size, anchor: 'middle', fill: color, weight: 500 });
  }
  const halo = (a, b, sw) => `<line x1="${n2(a.x)}" y1="${n2(a.y)}" x2="${n2(b.x)}" y2="${n2(b.y)}" stroke="#FFFFFF" stroke-opacity="0.75" stroke-width="${n2(sw + 2.2)}" stroke-linecap="round"/>`;
  function annotations(list, placed, opts) {
    let s = '';
    (list || []).forEach((a, i) => {
      const pl = placed[a.img || 0]; if (!pl || !pl.rect) return;
      const r = pl.rect; const color = a.color || '#1F1F1F'; const sw = Number(a.stroke) || 1.4; const fs = Number(a.size) || 11;
      const sel = opts.selected === i;
      const g = (inner) => `<g data-ann="${i}">${inner}</g>`;
      if (a.type === 'medida' || a.type === 'seta') {
        const p1 = P(r, a.x1, a.y1); const p2 = P(r, a.x2, a.y2);
        // contorno claro por baixo: a linha continua legível sobre fotos escuras
        let t = halo(p1, p2, sw) + `<line x1="${n2(p1.x)}" y1="${n2(p1.y)}" x2="${n2(p2.x)}" y2="${n2(p2.y)}" stroke="${color}" stroke-width="${sw}"${a.type === 'medida' && a.dashed ? ' stroke-dasharray="4 3"' : ''}/>`;
        if (a.type === 'medida') {
          const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x); const k = 5 + sw; const dx = -Math.sin(ang) * k; const dy = Math.cos(ang) * k;
          [p1, p2].forEach((q) => { t += `<line x1="${n2(q.x - dx)}" y1="${n2(q.y - dy)}" x2="${n2(q.x + dx)}" y2="${n2(q.y + dy)}" stroke="${color}" stroke-width="${sw}"/>`; });
          const lbl = `${String(a.value ?? '').trim()}${a.value !== '' && a.value != null ? ' ' + (a.unit || 'm') : ''}`.trim();
          if (lbl) t += labelBox((p1.x + p2.x) / 2 + (a.lx || 0), (p1.y + p2.y) / 2 + (a.ly === undefined ? -fs * 1.1 : a.ly), lbl, fs, color);
        } else t += arrowHead(p1, p2, 6 + sw * 2.2, color);
        if (sel && opts.preview) t += [p1, p2].map((q, k) => `<rect data-h="${k}" x="${n2(q.x - 4)}" y="${n2(q.y - 4)}" width="8" height="8" fill="#FFFFFF" stroke="#2A6BD8" stroke-width="1.2"/>`).join('');
        s += g(t);
      } else if (a.type === 'observacao' || a.type === 'texto') {
        const p = P(r, a.x, a.y); const wbox = Math.max(40, (Number(a.w) || 0.28) * r.w);
        const lines = wrap(a.text || (opts.preview ? 'Observação' : ''), wbox - (a.type === 'observacao' ? 16 : 0), fs, 0.5);
        const hbox = lines.length * fs * 1.32 + (a.type === 'observacao' ? 14 : 2);
        let t = '';
        if (a.type === 'observacao') {
          if (a.ax !== undefined && a.ay !== undefined) { const q = P(r, a.ax, a.ay); const cx = Math.max(p.x, Math.min(p.x + wbox, q.x)); const cy = q.y < p.y ? p.y : q.y > p.y + hbox ? p.y + hbox : p.y + hbox / 2; t += halo({ x: cx, y: cy }, q, sw * 0.8) + `<line x1="${n2(cx)}" y1="${n2(cy)}" x2="${n2(q.x)}" y2="${n2(q.y)}" stroke="${color}" stroke-width="${sw * 0.8}"/><circle cx="${n2(q.x)}" cy="${n2(q.y)}" r="${n2(2 + sw * 0.6)}" fill="${color}"/>`; }
          t += rect(p.x, p.y, wbox, hbox, '#FFFFFF', `stroke="${a.border || '#BDBDBD'}" stroke-width="0.7" fill-opacity="0.96"`);
          lines.forEach((l, k) => { t += text(p.x + 8, p.y + 7 + fs * 0.95 + k * fs * 1.32, l, { size: fs, fill: color }); });
        } else lines.forEach((l, k) => { t += text(p.x, p.y + fs * 0.95 + k * fs * 1.32, l, { size: fs, fill: color, weight: a.bold ? 500 : 400 }); });
        if (sel && opts.preview) {
          t += rect(p.x - 3, p.y - 3, wbox + 6, hbox + 6, 'none', 'stroke="#2A6BD8" stroke-width="1" stroke-dasharray="3 2"');
          t += `<rect data-h="w" x="${n2(p.x + wbox - 4)}" y="${n2(p.y + hbox / 2 - 4)}" width="8" height="8" fill="#FFFFFF" stroke="#2A6BD8" stroke-width="1.2"/>`;
          if (a.type === 'observacao' && a.ax !== undefined) { const q = P(r, a.ax, a.ay); t += `<circle data-h="a" cx="${n2(q.x)}" cy="${n2(q.y)}" r="5" fill="#FFFFFF" stroke="#2A6BD8" stroke-width="1.2"/>`; }
        }
        s += g(t);
      }
    });
    return s;
  }

  // ---------------------------------------------------------------- slide completo
  function slideSvg(p, idx, A, opts = {}) {
    const { w: W, h: H } = fmt(p); const slide = (p.slides || [])[idx];
    let body = ''; let placed = [];
    if (!slide) return '';
    if (slide.kind === 'capa') body = cover(p, A);
    else { body = frame(p, A, slide); const r = inner(p, A, slide, { ...opts, idx }); body += r.svg; placed = r.placed; }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
    return opts.withLayout ? { svg, placed, W, H } : svg;
  }
  // sequência padrão: capa, planta e ambientes
  function defaultSlides() { return [{ id: 'capa', kind: 'capa' }, { id: 'planta', kind: 'planta', room: 'Planta de layout', layout: '1', images: [] }]; }
  function pendencies(p) {
    const out = [];
    const sl = p.slides || [];
    if (!sl.some((s) => s.kind === 'planta' && (s.images || []).some((i) => i && i.doc_id))) out.push('Planta de layout ainda não adicionada');
    sl.forEach((s, i) => { if (s.kind !== 'capa' && s.kind !== 'planta' && !(s.images || []).some((x) => x && x.doc_id)) out.push(`Página ${num2(i + 1)} sem imagem`); if (s.kind === 'ambiente' && !s.room) out.push(`Página ${num2(i + 1)} sem nome de ambiente`); });
    return out;
  }

  const api = { FORMATS, slideSvg, defaultSlides, pendencies, boxes, placeImage, num2, wrap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SlidesCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
