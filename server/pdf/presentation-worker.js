// Gera o PDF da apresentação em um processo separado (imagens grandes não derrubam o site).
// Cada slide é um SVG (mesmo desenho da prévia) com as imagens ORIGINAIS embutidas, sem recompressão.
const fs = require('fs');
process.on('message', async (job) => {
  try {
    const pdf = require('./index'); const sign = require('./sign');
    const bufs = {};
    for (const [k, f] of Object.entries(job.files || {})) { let b = fs.readFileSync(f.path); if (f.reset) b = sign.resetOrientation(b); bufs[k] = b; }
    for (const [k, b64] of Object.entries(job.inline || {})) bufs[k] = Buffer.from(b64, 'base64');
    const content = job.pages.map((svg, i) => ({ svg, width: job.w, height: job.h, font: 'Jost', pageBreak: i ? 'before' : undefined, options: { imageCallback: (l) => bufs[l] || l } }));
    const office = require('../services/docs').office();
    const out = await pdf.render({ pageSize: { width: job.w, height: job.h }, pageMargins: [0, 0, 0, 0], content, defaultStyle: { font: 'Jost' },
      info: { title: job.title, author: office.name, creator: 'CN&IJ Gestão', producer: 'CN&IJ Gestão' } });
    fs.writeFileSync(job.out, out);
    process.send({ ok: true, size: out.length });
  } catch (e) { process.send({ ok: false, error: String((e && e.message) || e) }); }
});
