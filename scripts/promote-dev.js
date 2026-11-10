'use strict';
// Uso: node scripts/promote-dev.js email@exemplo.com [dev|player]   (precisa de DATABASE_URL; no Render use o Shell do serviço)
const { run } = require('../migrate'), { setRole } = require('../admin');
const [email, role = 'dev'] = process.argv.slice(2);
if (!email) { console.error('Uso: node scripts/promote-dev.js email@exemplo.com [dev|player]'); process.exit(1); }
run().then(() => setRole(email, role)).then(u => { console.log(`Conta "${u}" agora é ${role}.`); process.exit(0); }).catch(e => { console.error(e.report || e.message); process.exit(1); });
