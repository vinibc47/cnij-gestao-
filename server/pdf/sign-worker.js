// Gera o PDF da placa em um processo separado: se uma foto muito pesada esgotar a memória,
// só este processo cai — o site continua no ar e o usuário recebe uma mensagem clara.
const fs = require('fs');
process.on('message', async (job) => {
  try {
    const pdf = require('./index');
    const sign = require('./sign');
    let images = {};
    if (job.photo) {
      let buf = fs.readFileSync(job.photo.path);
      if (job.photo.resetOrientation) buf = sign.resetOrientation(buf);
      images = { 'cnij-foto': buf };
    }
    const out = await pdf.render(pdf.signDoc(job.svg, job.w, job.h, job.title, { bleed: job.bleed, subject: job.subject, images }));
    fs.writeFileSync(job.out, out);
    process.send({ ok: true, size: out.length });
  } catch (e) {
    process.send({ ok: false, error: String((e && e.message) || e) });
  }
});
