// Cópias otimizadas para exibição (o original enviado é preservado sem cortes).
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');
function optimizeImage(src, dest, { max = 2000, timeoutMs = 120000 } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  return new Promise((resolve) => {
    const child = fork(path.join(__dirname, 'media-worker.js'), [], { execArgv: ['--disable-warning=ExperimentalWarning'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let done = false;
    const end = (r) => { if (done) return; done = true; clearTimeout(t); try { child.kill(); } catch { /* encerrado */ } resolve(r); };
    const t = setTimeout(() => end({ ok: false, error: 'tempo esgotado' }), timeoutMs);
    child.on('message', end);
    child.on('exit', () => end({ ok: false, error: 'memória insuficiente para otimizar a imagem' }));
    child.send({ src, dest, max });
  });
}
module.exports = { optimizeImage };
