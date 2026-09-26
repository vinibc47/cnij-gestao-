// Gráficos minimalistas em SVG (sem dependências)
import { el, esc, toHTML, html, money, moneyShort } from './lib.js';

export const PALETTE = ['#111111', '#b9a489', '#9a9a9a', '#5f7a6e', '#4d6a86', '#d9cfc1', '#7a6150', '#c7c7c7'];

let tipEl;
function tip(e, text) {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
  if (!text) { tipEl.style.display = 'none'; return; }
  tipEl.innerHTML = text; tipEl.style.display = 'block';
  const x = Math.min(window.innerWidth - tipEl.offsetWidth - 8, e.clientX + 12);
  tipEl.style.left = x + 'px'; tipEl.style.top = (e.clientY - tipEl.offsetHeight - 10) + 'px';
}
function bindTips(svg) {
  svg.addEventListener('mousemove', (e) => { const t = e.target.closest('[data-tip]'); tip(e, t ? t.dataset.tip : null); });
  svg.addEventListener('mouseleave', (e) => tip(e, null));
}
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }

export function barChart({ labels, series, height = 240, format = moneyShort, fullFormat = money, highlight }) {
  const W = 720; const H = height; const pl = 56; const pr = 8; const pt = 12; const pb = 28;
  const all = series.flatMap((s) => s.values);
  const minV = Math.min(0, ...all); const maxV = niceMax(Math.max(...all, 0));
  const range = maxV - (minV < 0 ? -niceMax(-minV) : 0); const base = minV < 0 ? -niceMax(-minV) : 0;
  const y = (v) => pt + (H - pt - pb) * (1 - (v - base) / (range || 1));
  const gw = (W - pl - pr) / labels.length; const bw = Math.min(22, (gw * 0.7) / series.length);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = base + (range * i) / 4; const yy = y(v); g += `<line x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}" stroke="#f0f0f0"/><text x="${pl - 8}" y="${yy + 4}" text-anchor="end">${esc(format(v))}</text>`; }
  labels.forEach((l, i) => {
    const cx = pl + gw * i + gw / 2;
    const tot = series.length * bw + (series.length - 1) * 3;
    series.forEach((s, si) => {
      const v = s.values[i] || 0; const x = cx - tot / 2 + si * (bw + 3);
      const y0 = y(Math.max(0, v)); const h = Math.max(v ? 1.5 : 0, Math.abs(y(v) - y(0)));
      const op = highlight !== undefined && highlight !== i ? 0.35 : 1;
      g += `<rect x="${x}" y="${v >= 0 ? y0 : y(0)}" width="${bw}" height="${h}" rx="3" fill="${s.color || PALETTE[si]}" opacity="${s.opacity ?? op}" data-tip="${esc(`<b>${l}</b><br>${s.name}: ${fullFormat(v)}`)}"/>`;
    });
    g += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`;
  });
  const wrap = el(html`<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">${{ __raw: g }}</svg>
    ${series.length > 1 ? html`<div class="legend">${series.map((s, i) => html`<span><i style="background:${s.color || PALETTE[i]};opacity:${s.opacity ?? 1}"></i>${s.name}</span>`)}</div>` : ''}</div>`);
  bindTips(wrap.querySelector('svg'));
  return wrap;
}

export function lineChart({ labels, series, height = 220, format = moneyShort, fullFormat = money, area = true, markFrom }) {
  const W = 720; const H = height; const pl = 56; const pr = 12; const pt = 14; const pb = 28;
  const all = series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined));
  const mn = Math.min(0, ...all); const mx = niceMax(Math.max(...all, 1));
  const base = mn < 0 ? -niceMax(-mn) : 0; const range = mx - base;
  const x = (i) => pl + ((W - pl - pr) * i) / Math.max(1, labels.length - 1);
  const y = (v) => pt + (H - pt - pb) * (1 - (v - base) / (range || 1));
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = base + (range * i) / 4; const yy = y(v); g += `<line x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}" stroke="#f0f0f0"/><text x="${pl - 8}" y="${yy + 4}" text-anchor="end">${esc(format(v))}</text>`; }
  if (markFrom !== undefined && markFrom >= 0) g += `<rect x="${x(markFrom)}" y="${pt}" width="${W - pr - x(markFrom)}" height="${H - pt - pb}" fill="#fafaf9"/><text x="${x(markFrom) + 6}" y="${pt + 12}" style="fill:#aaa">previsão</text>`;
  const step = Math.ceil(labels.length / 12);
  labels.forEach((l, i) => { if (i % step === 0) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`; });
  if (base < 0) g += `<line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" stroke="#ddd"/>`;
  series.forEach((s, si) => {
    const c = s.color || PALETTE[si];
    const pts = s.values.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)]));
    const segs = []; let cur = [];
    pts.forEach((p) => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }); if (cur.length) segs.push(cur);
    segs.forEach((sg) => {
      const d = sg.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
      if (area && si === 0) g += `<path d="${d}L${sg[sg.length - 1][0]},${y(Math.max(0, base))}L${sg[0][0]},${y(Math.max(0, base))}Z" fill="${c}" opacity=".06"/>`;
      g += `<path d="${d}" fill="none" stroke="${c}" stroke-width="${s.width || 2}" ${s.dash ? 'stroke-dasharray="5 5"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    pts.forEach((p, i) => { if (p) g += `<circle cx="${p[0]}" cy="${p[1]}" r="${labels.length > 16 ? 2.5 : 3.5}" fill="#fff" stroke="${c}" stroke-width="1.6"/><circle cx="${p[0]}" cy="${p[1]}" r="12" fill="transparent" data-tip="${esc(`<b>${labels[i]}</b><br>${s.name}: ${fullFormat(s.values[i])}`)}"/>`; });
  });
  const wrap = el(html`<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">${{ __raw: g }}</svg>
    ${series.length > 1 ? html`<div class="legend">${series.map((s, i) => html`<span><i style="background:${s.color || PALETTE[i]}"></i>${s.name}</span>`)}</div>` : ''}</div>`);
  bindTips(wrap.querySelector('svg'));
  return wrap;
}

export function donut({ items, format = money, size = 170, center }) {
  const total = items.reduce((s, i) => s + (Number(i.value) || 0), 0);
  const r = 70; const C = 2 * Math.PI * r; let off = 0; let g = '';
  if (!total) g = `<circle cx="90" cy="90" r="${r}" fill="none" stroke="#f0f0f0" stroke-width="18"/>`;
  items.forEach((it, i) => {
    const frac = (Number(it.value) || 0) / (total || 1); const len = frac * C;
    g += `<circle cx="90" cy="90" r="${r}" fill="none" stroke="${it.color || PALETTE[i % PALETTE.length]}" stroke-width="18" stroke-dasharray="${Math.max(0, len - 1.5)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)" data-tip="${esc(`<b>${it.label}</b><br>${format(it.value)} · ${(frac * 100).toFixed(0)}%`)}"/>`;
    off += len;
  });
  const wrap = el(html`<div class="row gap-24 wrap" style="align-items:center"><svg viewBox="0 0 180 180" style="width:${size}px;height:${size}px;flex:none">${{ __raw: g }}
      <text x="90" y="86" text-anchor="middle" style="font-family:var(--serif);font-size:24px;fill:#111">${center ?? total}</text><text x="90" y="104" text-anchor="middle" style="font-size:10px;fill:#999;letter-spacing:.1em">TOTAL</text></svg>
    <div class="col grow" style="gap:8px;min-width:150px">${items.map((it, i) => html`<div class="row between small"><span class="row gap-8" style="min-width:0"><i style="width:9px;height:9px;border-radius:3px;flex:none;background:${it.color || PALETTE[i % PALETTE.length]}"></i><span class="ellipsis">${it.label}</span></span><b class="num" style="font-weight:500">${format(it.value)}</b></div>`)}</div></div>`);
  bindTips(wrap.querySelector('svg'));
  return wrap;
}

export function hbars(items, { format = money, color = '#111', max } = {}) {
  const m = max || Math.max(1, ...items.map((i) => Number(i.value) || 0));
  return el(html`<div class="hbars">${items.length ? items.map((it) => html`<div class="hbar"><div class="top"><span>${it.label}</span><span class="num muted">${format(it.value)}${it.extra ? html` · <span class="danger-text">${it.extra}</span>` : ''}</span></div>
    <div class="bar"><i style="width:${((Number(it.value) || 0) / m) * 100}%;background:${it.color || color}"></i></div></div>`) : html`<div class="muted small">Sem dados no período.</div>`}</div>`);
}
