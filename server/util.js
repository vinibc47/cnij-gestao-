const { run } = require('./db');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

const pad = (n) => String(n).padStart(2, '0');
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function today() { return ymd(new Date()); }
function addDays(dateStr, n) { const d = parseDate(dateStr); d.setDate(d.getDate() + n); return ymd(d); }
function parseDate(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
function addMonths(dateStr, n, day) {
  const d = parseDate(dateStr);
  const targetDay = day || d.getDate();
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return ymd(new Date(first.getFullYear(), first.getMonth(), Math.min(targetDay, last)));
}
function monthKey(dateStr) { return String(dateStr).slice(0, 7); }
function monthStart(dateStr = today()) { return monthKey(dateStr) + '-01'; }
function monthEnd(dateStr = today()) { const d = parseDate(monthStart(dateStr)); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function nowIso() { const d = new Date(); return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }

function audit(req, action, entity, entityId, summary, changes) {
  try {
    run('INSERT INTO audit_log(user_id, action, entity, entity_id, summary, changes, ip, created_at) VALUES (?,?,?,?,?,?,?,?)',
      req && req.user ? req.user.id : null, action, entity, entityId || null, summary || null,
      changes ? JSON.stringify(changes) : null, req ? req.ip : null, nowIso());
  } catch (e) { console.error('audit', e.message); }
}

const wrap = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } };

// Divide um total em N parcelas, jogando a diferença de centavos na última
function splitAmount(total, n) {
  n = Math.max(1, parseInt(n, 10) || 1);
  const base = Math.floor((Number(total) * 100) / n) / 100;
  const arr = Array(n).fill(base);
  arr[n - 1] = round2(Number(total) - base * (n - 1));
  return arr;
}

module.exports = { HttpError, ymd, today, addDays, addMonths, parseDate, monthKey, monthStart, monthEnd, daysBetween, round2, nowIso, audit, wrap, splitAmount };
