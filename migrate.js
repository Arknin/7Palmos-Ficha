'use strict';
// Executor de migrations com PROTEÇÃO DO CONTEÚDO.
// - Aplica migrations/*.sql em ordem, cada uma em transação, registrando o checksum.
// - Recusa rodar se uma migration já aplicada foi modificada.
// - Recusa migrations pendentes que apaguem/alterem/insiram dados em tabelas protegidas
//   (poções, caminhos, versões, contas, fichas...), exceto com aprovação explícita dupla.
// - Antes de aplicar qualquer migration, grava um backup do conteúdo global dentro do banco.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const db = require('./db');
const DIR = process.env.MIGRATIONS_DIR || path.join(__dirname, 'migrations');

const { PROTECTED, lint, explain, checksum, statements } = require('./lint');
class MigrationBlocked extends Error { constructor(report) { super('Migração bloqueada'); this.report = report; } }
const approved = (id, sql) => /--\s*@destructive-approved:\s*\S+/.test(sql) && (process.env.ALLOW_DESTRUCTIVE_MIGRATIONS || '').split(',').map(s => s.trim()).includes(id);

function readFiles() { return fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort().map(f => ({ id: f.replace(/\.sql$/, ''), sql: fs.readFileSync(path.join(DIR, f), 'utf8') })) : []; }

async function run() {
  await db.ready();
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at BIGINT NOT NULL)');
  const done = Object.fromEntries((await db.query('SELECT id,checksum FROM schema_migrations')).map(r => [r.id, r.checksum]));
  const files = readFiles();
  for (const f of files) if (done[f.id] && done[f.id] !== checksum(f.sql))
    throw new MigrationBlocked(`\n⛔ OPERAÇÃO INTERROMPIDA: a migration já aplicada "${f.id}" foi MODIFICADA.\n• Alteração planejada: mudar o histórico do esquema do banco.\n• Conteúdo afetado: estrutura de todo o banco (inclusive conteúdo global).\n• Conflito: migrations aplicadas são imutáveis; o banco de produção não reflete a nova versão do arquivo.\n• Consequências: esquema divergente entre ambientes e risco de corrupção de dados.\n• Alternativa segura: restaure o arquivo original e crie uma NOVA migration com a mudança desejada.\n`);
  const pending = files.filter(f => !done[f.id]);
  for (const f of pending) { const found = lint(f.sql); if (found.length && !approved(f.id, f.sql)) throw new MigrationBlocked(explain(f.id, found)); }
  if (!pending.length) return [];
  try { await require('./content').createBackup(null, 'antes das migrations: ' + pending.map(p => p.id).join(', ')); } catch { /* tabelas de conteúdo ainda não existem */ }
  for (const f of pending) {
    await db.tx(async q => { for (const st of statements(f.sql)) await q(st); await q('INSERT INTO schema_migrations(id,checksum,applied_at) VALUES($1,$2,$3)', [f.id, checksum(f.sql), Date.now()]); });
    console.log('Migration aplicada:', f.id);
  }
  return pending.map(p => p.id);
}
module.exports = { run, lint, explain, PROTECTED, MigrationBlocked, readFiles };
