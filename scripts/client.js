// Pequeno cliente HTTP para scripts (demo e testes)
module.exports = function client(base) {
  let cookie = '';
  async function call(method, path, body) {
    const r = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'cnij', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const data = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error(`${method} ${path} → ${r.status} ${data && data.error}`); e.status = r.status; e.data = data; throw e; }
    return data;
  }
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b || {}), put: (p, b) => call('PUT', p, b || {}), del: (p) => call('DELETE', p), raw: call, reset: () => { cookie = ''; } };
};
