// Envio de e-mail. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS e SMTP_FROM no .env.
// Sem SMTP configurado, a mensagem é registrada no console do servidor (e o administrador
// também pode gerar o link de redefinição em Configurações › Usuários).
let transporter = null;
function getTransport() {
  if (transporter || !process.env.SMTP_HOST) return transporter;
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}
async function send(to, subject, text) {
  const t = getTransport();
  if (!t) { console.log(`\n[e-mail não enviado — SMTP não configurado]\nPara: ${to}\nAssunto: ${subject}\n${text}\n`); return false; }
  try { await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text }); return true; }
  catch (e) { console.error('Falha no envio de e-mail:', e.message); return false; }
}
module.exports = { send };
