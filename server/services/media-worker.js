// Gera a versão otimizada de uma imagem para exibição (capa do portal) em processo separado.
// O arquivo original nunca é alterado: aqui só se cria uma cópia reduzida em JPEG.
const fs = require('fs');
process.on('message', (job) => {
  try {
    const buf = fs.readFileSync(job.src);
    let img; let orientation = 1;
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      img = require('jpeg-js').decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 120 });
      orientation = require('../pdf/sign').jpegOrientation(buf);
    } else if (buf.slice(1, 4).toString('latin1') === 'PNG') img = require('pngjs').PNG.sync.read(buf);
    else throw new Error('Formato não suportado para otimização (use JPG ou PNG).');
    let { width: W, height: H, data } = img;
    // aplica a rotação do EXIF (fotos de celular) para a cópia ficar igual ao que o navegador mostra
    if ([3, 6, 8].includes(orientation)) {
      const nw = orientation === 3 ? W : H; const nh = orientation === 3 ? H : W; const out = Buffer.alloc(nw * nh * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let nx; let ny;
        if (orientation === 3) { nx = W - 1 - x; ny = H - 1 - y; } else if (orientation === 6) { nx = H - 1 - y; ny = x; } else { nx = y; ny = W - 1 - x; }
        const s = (y * W + x) * 4; const t = (ny * nw + nx) * 4; out[t] = data[s]; out[t + 1] = data[s + 1]; out[t + 2] = data[s + 2]; out[t + 3] = data[s + 3];
      }
      data = out; W = nw; H = nh;
    }
    const k = Math.min(1, job.max / Math.max(W, H));
    const w = Math.max(1, Math.round(W * k)); const h = Math.max(1, Math.round(H * k));
    const out = Buffer.alloc(w * h * 4);
    // redução por média de área (sem serrilhado); fundo branco onde houver transparência
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y / k); const y1 = Math.min(H, Math.max(y0 + 1, Math.floor((y + 1) / k)));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x / k); const x1 = Math.min(W, Math.max(x0 + 1, Math.floor((x + 1) / k)));
        let r = 0; let g = 0; let b = 0; let n = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * W + xx) * 4; const a = data[i + 3] / 255; r += data[i] * a + 255 * (1 - a); g += data[i + 1] * a + 255 * (1 - a); b += data[i + 2] * a + 255 * (1 - a); n++; }
        const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
      }
    }
    const jpg = require('jpeg-js').encode({ data: out, width: w, height: h }, 86);
    fs.writeFileSync(job.dest, jpg.data);
    process.send({ ok: true, w, h, src_w: W, src_h: H });
  } catch (e) { process.send({ ok: false, error: String((e && e.message) || e) }); }
});
