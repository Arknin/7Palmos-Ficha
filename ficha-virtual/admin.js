'use strict';
// Promoção/rebaixamento de contas DEV. O papel fica no banco (users.role); nunca é deduzido do nome de usuário.
const db = require('./db'), { now } = require('./lib'), content = require('./content');
async function setRole(email, role) {
  if (!['dev', 'player'].includes(role)) throw new Error('Papel inválido');
  return db.tx(async q => {
    const u = (await q('SELECT id,username,role FROM users WHERE email_lc=$1', [String(email).trim().toLowerCase()]))[0]; if (!u) throw new Error('Nenhuma conta com este e-mail');
    if (u.role === 'dev' && role === 'player' && (await q(`SELECT COUNT(*) AS n FROM users WHERE role='dev'`))[0].n <= 1) throw new Error('Não é possível rebaixar o único DEV');
    await q('UPDATE users SET role=$1, updated_at=$2 WHERE id=$3', [role, now(), u.id]); await content.logAdmin(q, null, 'role.set', { user: u.username, from: u.role, to: role }); return u.username;
  });
}
// Variável DEV_EMAIL: promove uma conta JÁ EXISTENTE, e somente se ainda não houver nenhum DEV.
async function bootstrapDev() {
  const e = (process.env.DEV_EMAIL || '').trim().toLowerCase(); if (!e) return;
  if ((await db.query(`SELECT COUNT(*) AS n FROM users WHERE role='dev'`))[0].n > 0) { console.log('[DEV] Já existe uma conta DEV; DEV_EMAIL ignorado (pode remover a variável).'); return; }
  try { console.log(`[DEV] Conta "${await setRole(e, 'dev')}" promovida a DEV.`); } catch (x) { console.log(`[DEV] DEV_EMAIL definido, mas: ${x.message}. Crie a conta pelo site e reinicie o serviço.`); }
}
module.exports = { setRole, bootstrapDev };
