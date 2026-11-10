'use strict';
// Exporta TODO o banco (exceto sessões e senhas) para um JSON local: node scripts/backup.js [arquivo.json]
const fs = require('fs'), db = require('../db');
(async () => {
  await db.ready(); const out = { created_at: Date.now() };
  for (const t of ['paths', 'potions', 'content_versions', 'content_blobs', 'game_settings', 'campaigns', 'members', 'sheets', 'inventory', 'admin_log'])
    out[t] = await db.query(`SELECT * FROM ${t}`);
  out.users = (await db.query('SELECT id,username,email,role,avatar_v,created_at FROM users'));
  const f = process.argv[2] || `backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  fs.writeFileSync(f, JSON.stringify(out)); console.log('Backup salvo em', f); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
