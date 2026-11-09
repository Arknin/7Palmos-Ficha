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

const PROTECTED = {
  paths: 'os caminhos do jogo (conteúdo global)', potions: 'as poções do jogo (conteúdo global)', content_versions: 'o histórico de versões do conteúdo',
  content_blobs: 'as imagens do conteúdo global', content_backups: 'os backups do conteúdo', game_settings: 'as configurações globais do jogo',
  app_meta: 'os metadados de integridade do conteúdo', admin_log: 'o histórico administrativo', users: 'as contas dos usuários', sessions: 'as sessões',
  campaigns: 'as campanhas', members: 'os participantes das campanhas', sheets: 'as fichas dos jogadores', inventory: 'os inventários dos jogadores',
};
const KINDS = [
  [t => `DROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?["\`]?${t}["\`]?\\b`, 'APAGAR a tabela'],
  [t => `TRUNCATE\\s+(TABLE\\s+)?["\`]?${t}["\`]?\\b`, 'ESVAZIAR a tabela'],
  [t => `DELETE\\s+FROM\\s+["\`]?${t}["\`]?\\b`, 'APAGAR linhas da tabela'],
  [t => `UPDATE\\s+["\`]?${t}["\`]?\\s+SET\\b`, 'SOBRESCREVER linhas da tabela'],
  [t => `(INSERT|REPLACE)\\s+(OR\\s+\\w+\\s+)?INTO\\s+["\`]?${t}["\`]?\\b`, 'INSERIR dados diretamente na tabela'],
  [t => `ALTER\\s+TABLE\\s+["\`]?${t}["\`]?\\s+(DROP|RENAME|ALTER)\\b`, 'REMOVER/RENOMEAR/ALTERAR colunas da tabela'],
];
const checksum = s => crypto.createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex');
const statements = sql => sql.replace(/--.*$/gm, '').split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);

function lint(sql) {
  const found = [];
  for (const st of statements(sql)) {
    if (/\bDROP\s+(DATABASE|SCHEMA)\b/i.test(st)) found.push({ st, table: '(banco inteiro)', what: 'APAGAR o banco/esquema inteiro', desc: 'TODOS os dados' });
    for (const [t, desc] of Object.entries(PROTECTED)) for (const [re, what] of KINDS) if (new RegExp(re(t), 'i').test(st)) found.push({ st, table: t, what, desc });
  }
  return found;
}
class MigrationBlocked extends Error { constructor(report) { super('Migração bloqueada'); this.report = report; } }
function explain(id, found) {
  const lines = [`\n⛔ OPERAÇÃO INTERROMPIDA: a migration "${id}" é potencialmente destrutiva e NÃO foi executada.\n`];
  for (const f of found) lines.push(
    `• Alteração planejada: ${f.what} "${f.table}"\n    SQL: ${f.st.replace(/\s+/g, ' ').slice(0, 160)}`,
    `• Conteúdo que poderá ser afetado: ${f.desc}`,
    `• Por que há conflito: conteúdo global e dados de jogadores só podem ser criados/alterados pelos mecanismos da própria aplicação (conta DEV, auditados e versionados). Migrations e deploys não podem escrever neles.`,
    `• Possíveis consequências: perda ou sobrescrita de poções, caminhos, imagens, textos, fichas ou contas; desfazer alterações feitas pela conta DEV; inventários apontando para conteúdo que não existe mais.\n`);
  lines.push('• Alternativa segura: use apenas migrations que ADICIONEM estruturas (CREATE TABLE, ADD COLUMN, CREATE INDEX). Para mudar conteúdo, use o painel DEV. Para mover dados, escreva uma migration em duas etapas (adicionar coluna nova, copiar via aplicação, só depois remover a antiga com aprovação).',
    `• Se a operação é realmente intencional: crie um backup, adicione ao arquivo a linha "-- @destructive-approved: <motivo>" e defina ALLOW_DESTRUCTIVE_MIGRATIONS=${id} no ambiente. Os DOIS são obrigatórios.\n`);
  return lines.join('\n');
}
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
