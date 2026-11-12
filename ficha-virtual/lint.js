'use strict';
// Regras de proteção (sem dependência do banco): usadas pelo executor de migrations e pela verificação estática do build.
const crypto = require('crypto');
const PROTECTED = {
  paths: 'os caminhos do jogo (conteúdo global)', potions: 'as poções do jogo (conteúdo global)', content_versions: 'o histórico de versões do conteúdo',
  content_blobs: 'as imagens do conteúdo global', content_backups: 'os backups do conteúdo', game_settings: 'as configurações globais do jogo',
  app_meta: 'os metadados de integridade do conteúdo', admin_log: 'o histórico administrativo', users: 'as contas dos usuários', sessions: 'as sessões',
  campaigns: 'as campanhas', members: 'os participantes das campanhas', sheets: 'as fichas dos jogadores', inventory: 'os inventários de poções (legado)', sheet_items: 'os itens de inventário dos jogadores', aptitudes: 'as aptidões do jogo (conteúdo global)',
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
module.exports = { PROTECTED, lint, explain, checksum, statements };
