'use strict';
// Camada de banco de dados. Produção: PostgreSQL/Neon (DATABASE_URL). Desenvolvimento/testes: SQLite embutido do Node (>=22.5).
// O esquema NÃO é criado aqui: ver migrate.js e a pasta migrations/.
// O SQL abaixo usa apenas o subconjunto comum aos dois (placeholders $1,$2..., ON CONFLICT, RETURNING).
const path = require('path');


let impl;
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  console.error('ERRO: DATABASE_URL não definida em produção. O SQLite local é temporário no Render e não pode guardar dados permanentes.');
  process.exit(1);
}
if (process.env.DATABASE_URL) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, v => parseInt(v, 10)); // BIGINT -> number
  const host = new URL(process.env.DATABASE_URL).hostname;
  const ssl = process.env.PGSSL ? process.env.PGSSL !== 'disable' : host.includes('.') && !/^(localhost|127\.)/.test(host);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: ssl ? { rejectUnauthorized: process.env.PGSSL_INSECURE !== 'true' } : false, max: 10, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000 });
  pool.on('error', e => console.error('Erro no pool do banco:', e.message));
  impl = {
    kind: 'pg', fu: ' FOR UPDATE',
    query: async (sql, p = []) => (await pool.query(sql, p)).rows,
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const out = await fn(async (sql, p = []) => (await c.query(sql, p)).rows);
        await c.query('COMMIT');
        return out;
      } catch (e) { try { await c.query('ROLLBACK'); } catch {} throw e; }
      finally { c.release(); }
    },
    async ready() { for (let i = 1; ; i++) { try { await pool.query('SELECT 1'); return; } catch (e) { if (i >= 6) throw e; console.log(`Banco indisponível (tentativa ${i}/6): ${e.message}`); await new Promise(r => setTimeout(r, 3000)); } } },
  };
} else {
  const { DatabaseSync } = require('node:sqlite');
  const file = process.env.SQLITE_PATH || path.join(__dirname, 'data.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  const conv = s => s.replace(/\$(\d+)/g, '?$1');
  const run = (sql, p) => {
    const st = db.prepare(conv(sql));
    if (/^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql)) return st.all(...p).map(r => ({ ...r }));
    st.run(...p); return [];
  };
  let chain = Promise.resolve(); // serializa tudo: uma única conexão
  const enqueue = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
  impl = {
    kind: 'sqlite', fu: '',
    query: (sql, p = []) => enqueue(() => run(sql, p)),
    tx: fn => enqueue(async () => {
      db.exec('BEGIN IMMEDIATE');
      try { const out = await fn(async (sql, p = []) => run(sql, p)); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    }),
    async ready() {},
  };
}
module.exports = impl;
