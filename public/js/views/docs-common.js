// Componentes compartilhados pelos editores de proposta e contrato:
// campos, plano de parcelas com conferência, editor de texto do modelo.
import { html, raw, el, toHTML, esc, icon, money, date, rowsEditor, round2, parseNum, brl2, addDays, today, S, applySentence } from '../lib.js';

export const PROJECT_TYPES = ['arquitetonico', 'interiores', 'arq_interiores'];
export const svcLabel = (v) => ((S.meta.lists.SERVICE_TYPES_ALL || S.meta.lists.SERVICE_TYPES).find((x) => x.value === v) || {}).label || '—';

// Campo simples (texto, data, número, área de texto, seleção, dinheiro)
export function fld(name, label, value, { type = 'text', wide, hint, options, req, placeholder = '', rows = 3, list, attrs = '' } = {}) {
  const v = value ?? '';
  let input;
  if (type === 'textarea') input = html`<textarea name="${name}" rows="${rows}" placeholder="${placeholder}">${v}</textarea>`;
  else if (type === 'select') input = html`<select name="${name}"><option value="">—</option>${options.map((o) => html`<option value="${o.value}" ${String(o.value) === String(v) ? 'selected' : ''}>${o.label}</option>`)}</select>`;
  else if (type === 'money') input = html`<div class="money-input"><span>R$</span><input name="${name}" type="text" inputmode="decimal" data-money value="${v === '' || v === null ? '' : brl2(v)}" placeholder="0,00"></div>`;
  else input = html`<input name="${name}" type="${type}" value="${type === 'date' ? String(v).slice(0, 10) : v}" placeholder="${placeholder}" ${list ? html`list="${list}"` : ''} ${type === 'number' ? html`step="any" inputmode="decimal"` : ''} ${attrs ? raw(attrs) : ''}>`;
  return html`<div class="field ${wide ? 'wide' : ''}" data-f="${name}"><label>${label}${req ? html` <span class="req">*</span>` : ''}</label>${input}${hint ? html`<span class="hint">${hint}</span>` : ''}</div>`;
}
// Lê os campos [name] de um container (dinheiro vem formatado em pt-BR)
export function readFields(root) {
  const out = {};
  root.querySelectorAll('input[name], select[name], textarea[name]').forEach((i) => {
    if (i.closest('[data-skip]') || i.disabled) return;
    if (i.type === 'checkbox') out[i.name] = i.checked ? 1 : 0;
    else if (i.hasAttribute('data-money')) out[i.name] = i.value.trim() === '' ? null : parseNum(i.value);
    else { applySentence(i); out[i.name] = i.value; }
  });
  return out;
}
export function bindMoney(root) {
  root.addEventListener('change', (e) => { const i = e.target.closest('[data-money]'); if (i && i.value.trim() !== '') i.value = brl2(parseNum(i.value)); });
}

// Plano de parcelas: gerador (entrada + N parcelas) + tabela editável + conferência com o total
export function planEditor({ plan = [], getTotal, getDown, onChange }) {
  const box = el(html`<div class="plan-ed">
    <div class="plan-gen">
      <div class="field"><label>Data da entrada</label><input type="date" data-g="down_date" value="${plan[0] && /entrada/i.test(plan[0].label) ? plan[0].due_date : today()}"></div>
      <div class="field"><label>Nº de parcelas (além da entrada)</label><input type="number" min="0" max="60" data-g="count" value="${Math.max(0, plan.length - (plan[0] && /entrada/i.test(plan[0].label) ? 1 : 0)) || 1}"></div>
      <div class="field"><label>1º vencimento das parcelas</label><input type="date" data-g="first_due" value="${(plan.find((p) => !/entrada/i.test(p.label)) || {}).due_date || addDays(today(), 30)}"></div>
      <div class="field"><label>Intervalo (meses)</label><input type="number" min="1" max="12" data-g="interval" value="1"></div>
      <div class="field" style="justify-content:flex-end"><button type="button" class="btn" data-gen>${icon('repeat', 'sm')} Gerar parcelas</button></div>
    </div>
    <div data-rows></div>
    <div class="plan-check" data-check></div></div>`);
  const check = () => {
    const total = round2(getTotal()); const rows = ed.rows.get(); const sum = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)); const diff = round2(total - sum);
    const down = round2(getDown ? getDown() : 0);
    const downBad = down > 0 && rows[0] && Math.abs(round2(rows[0].amount) - down) > 0.009;
    const missing = rows.some((r) => !r.due_date || !(Number(r.amount) > 0));
    const c = box.querySelector('[data-check]');
    const okc = rows.length && Math.abs(diff) < 0.005 && !missing && !downBad;
    c.className = `plan-check ${okc ? 'ok' : rows.length ? 'bad' : ''}`;
    c.innerHTML = toHTML(html`<span>${icon(okc ? 'check' : 'alert', 'sm')}</span><span class="grow">${!rows.length ? 'Nenhuma parcela cadastrada.' : okc ? html`Parcelas conferidas: soma ${money(sum)} = valor total.` : html`Soma das parcelas ${money(sum)} · valor total ${money(total)}${Math.abs(diff) >= 0.005 ? html` · <b>diferença ${money(diff)}</b>` : ''}${downBad ? html` · a 1ª parcela deve ser a entrada (${money(down)})` : ''}${missing ? ' · há parcela sem data ou valor' : ''}`}</span>
      ${rows.length && Math.abs(diff) >= 0.005 ? html`<button type="button" class="btn xs" data-fix>Ajustar diferença na última parcela</button>` : ''}`);
    return okc;
  };
  const ed = rowsEditor({
    columns: [{ key: 'label', label: 'Descrição', w: '1.2fr', placeholder: 'Entrada / Parcela' }, { key: 'due_date', label: 'Vencimento', type: 'date', w: '1fr' }, { key: 'amount', label: 'Valor', type: 'money', w: '1fr' }],
    rows: plan, addLabel: 'Adicionar parcela', empty: 'Nenhuma parcela. Use "Gerar parcelas" ou adicione manualmente.',
    total: (rows) => html`${rows.length} parcela(s)`, onChange: () => { check(); onChange && onChange(); },
  });
  box.querySelector('[data-rows]').appendChild(ed);
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-gen]')) {
      const g = (k) => box.querySelector(`[data-g="${k}"]`).value;
      const total = round2(getTotal()); const down = round2(getDown ? getDown() : 0);
      if (!(total > 0)) { alertMsg(box, 'Informe o valor total antes de gerar as parcelas.'); return; }
      const n = Math.max(0, parseInt(g('count'), 10) || 0); const rest = round2(total - down); const rows = [];
      if (down > 0) rows.push({ label: 'Entrada', due_date: g('down_date') || today(), amount: down });
      if (n > 0 && rest > 0) {
        const base = Math.floor((rest * 100) / n) / 100; const first = g('first_due') || addDays(today(), 30); const step = Math.max(1, parseInt(g('interval'), 10) || 1);
        for (let i = 0; i < n; i++) rows.push({ label: 'Parcela', due_date: addMonthsKeep(first, i * step), amount: i === n - 1 ? round2(rest - base * (n - 1)) : base });
      } else if (!down) rows.push({ label: 'Parcela única', due_date: g('first_due') || today(), amount: total });
      ed.rows.set(rows); check(); onChange && onChange();
    }
    if (e.target.closest('[data-fix]')) {
      const rows = ed.rows.get(); if (!rows.length) return;
      const sum = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)); const diff = round2(round2(getTotal()) - sum);
      rows[rows.length - 1].amount = round2((Number(rows[rows.length - 1].amount) || 0) + diff); ed.rows.set(rows); check(); onChange && onChange();
    }
  });
  box.addEventListener('change', (e) => { if (e.target.closest('[data-g]')) e.stopPropagation(); });
  setTimeout(check, 0);
  box.plan = { get: () => ed.rows.get().map((r) => ({ label: r.label || '', due_date: r.due_date || '', amount: round2(r.amount) })), check };
  return box;
}
function addMonthsKeep(s, n) {
  const [y, m, d] = s.split('-').map(Number); const first = new Date(y, m - 1 + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const dt = new Date(first.getFullYear(), first.getMonth(), Math.min(d, last));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function alertMsg(box, msg) { const c = box.querySelector('[data-check]'); c.className = 'plan-check bad'; c.textContent = msg; }

// Editor do texto do documento, com os campos disponíveis para inserir
export function bodyEditor({ value, fields, blocks, onChange, rows = 22 }) {
  const box = el(html`<div class="body-ed">
    <div class="body-help small muted">Marcação: <code># Título</code> · <code>## Subtítulo</code> · <code>- item</code> · <code>1. item</code> · <code>**negrito**</code> · <code>&gt; nota</code>. Campos entre chaves são preenchidos automaticamente com os dados salvos.</div>
    <textarea class="body-ta" rows="${rows}" spellcheck="true">${value || ''}</textarea>
    <details class="body-fields"><summary>Campos disponíveis para inserir no texto</summary>
      <div class="eyebrow mt-8 mb-8">Campos</div><div class="chips">${Object.entries(fields).map(([k, l]) => html`<button type="button" class="chip" data-ins="{{${k}}}" title="{{${k}}}">${l}</button>`)}</div>
      <div class="eyebrow mt-16 mb-8">Blocos (em linha própria)</div><div class="chips">${Object.entries(blocks).map(([k, l]) => html`<button type="button" class="chip" data-ins="\n{{${k}}}\n" title="{{${k}}}">${l}</button>`)}</div></details></div>`);
  const ta = box.querySelector('textarea');
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ins]'); if (!b) return;
    const s = ta.selectionStart ?? ta.value.length; const t = b.dataset.ins;
    ta.value = ta.value.slice(0, s) + t + ta.value.slice(ta.selectionEnd ?? s); ta.focus(); ta.selectionStart = ta.selectionEnd = s + t.length;
    ta.dispatchEvent(new Event('input', { bubbles: true })); onChange && onChange();
  });
  const pend = () => { const n = (ta.value.match(/\[PENDENTE[^\]]*\]/gi) || []).length; box.classList.toggle('has-pending', !!n); };
  ta.addEventListener('input', pend); pend();
  box.body = { get: () => ta.value, set: (v) => { ta.value = v; pend(); } };
  return box;
}

// Lista das pendências vindas do servidor, exibida no topo do editor
export function problemsBox(list) {
  if (!list || !list.length) return html`<div class="card flat small row gap-8 success-text">${icon('check', 'sm')} Pronto para gerar o PDF.</div>`;
  return html`<div class="card flat small"><div class="row gap-8 mb-8 warning-text">${icon('alert', 'sm')}<b>Pendências para gerar o documento</b></div><ul class="problems">${list.map((p) => html`<li>${p}</li>`)}</ul></div>`;
}
export { esc, date };
