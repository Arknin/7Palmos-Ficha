'use strict';
// Verificação estática EXECUTADA NO BUILD (npm run safety). Falha se uma alteração técnica puder
// sobrescrever/apagar conteúdo global ou dados de jogadores. Também serve como trava para assistentes de IA.
const fs = require('fs'), path = require('path');
const { lint, explain, readFiles } = require('../migrate');
const ROOT = process.env.SAFETY_ROOT || path.join(__dirname, '..');
const WRITE = /\b(INSERT\s+(OR\s+\w+\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(\s+TABLE)?|DROP\s+TABLE(\s+IF\s+EXISTS)?|ALTER\s+TABLE)\s+["`]?(paths|potions|content_versions|content_blobs|content_backups|game_settings)\b/i;
const ALLOWED = new Set(['content.js']); // único módulo que pode escrever no conteúdo global
const SKIP = new Set(['node_modules', '.git', 'test', 'migrations', 'backups']);
let problems = [];

function walk(dir, out = []) { for (const f of fs.readdirSync(dir)) { if (SKIP.has(f)) continue; const p = path.join(dir, f), st = fs.statSync(p); if (st.isDirectory()) walk(p, out); else if (/\.(js|mjs|cjs|sql)$/.test(f)) out.push(p); } return out; }
for (const f of walk(ROOT)) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (ALLOWED.has(rel) || rel === 'migrate.js' || rel === 'scripts/safety-check.js') continue;
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (WRITE.test(line)) problems.push(`• ${rel}:${i + 1}\n    Alteração planejada: escrita direta em tabela de conteúdo global\n    SQL: ${line.trim().slice(0, 140)}\n    Conteúdo que poderá ser afetado: poções, caminhos, imagens, configurações ou histórico de versões\n    Conflito: o conteúdo global só pode ser escrito por content.js (conta DEV, com versionamento e transação)\n    Consequências: sobrescrever/apagar o que a conta DEV cadastrou, quebrar inventários e o histórico\n    Alternativa segura: chame as funções de content.js ou use o painel DEV`); });
  if (/require\(['"]\.\.?\/seed|seed\/content\.json/.test(fs.readFileSync(f, 'utf8'))) problems.push(`• ${rel}: lê os dados de seed fora de content.js. O seed só pode ser aplicado em banco vazio (content.seedIfEmpty).`);
}
const mdir = path.join(ROOT, 'migrations');
if (fs.existsSync(mdir)) for (const f of fs.readdirSync(mdir).filter(x => x.endsWith('.sql'))) {
  const sql = fs.readFileSync(path.join(mdir, f), 'utf8'), found = lint(sql);
  if (found.length && !/--\s*@destructive-approved:\s*\S+/.test(sql)) problems.push(explain(f.replace('.sql', ''), found));
}
if (problems.length) { console.error('\n⛔ VERIFICAÇÃO DE SEGURANÇA DO CONTEÚDO FALHOU\n\n' + problems.join('\n\n') + '\n\nNenhuma alteração destrutiva foi executada. Revise o plano antes de prosseguir.\n'); process.exit(1); }
console.log('Verificação de segurança do conteúdo: OK (nenhuma escrita indevida em conteúdo global).');
