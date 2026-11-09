'use strict';
// Envio de e-mail (recuperação de senha). Provedor: Resend via HTTPS (sem dependências).
//   RESEND_API_KEY + MAIL_FROM  -> envia de verdade
//   MAIL_MODE=console           -> apenas imprime (desenvolvimento/testes)
//   (nada definido)             -> recuperação de senha DESATIVADA
const enabled = () => !!process.env.RESEND_API_KEY || process.env.MAIL_MODE === 'console';
async function sendMail(to, subject, text) {
  if (process.env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }) });
    if (!r.ok) throw new Error('Falha ao enviar e-mail: ' + r.status);
    return 'sent';
  }
  if (process.env.MAIL_MODE === 'console') { console.log(`[MAIL] para=${to} assunto=${subject}\n${text}\n[/MAIL]`); return 'console'; }
  return 'disabled';
}
module.exports = { sendMail, enabled };
