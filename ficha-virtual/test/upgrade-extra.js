'use strict';
// Verificações específicas da v3.1 sobre o banco da v3.0 (aptidões globais, itens, checksum versionado)
const { start, Cli } = require('./helpers');
module.exports = async ({ d, p, v, cid, raw, S, t }) => {
  console.log('Migração v3.0 → v3.1');
  t('migration 003 aplicada (apenas adicionou tabelas)', raw("SELECT id FROM schema_migrations WHERE id LIKE '003%'").length === 1 && raw("SELECT name FROM sqlite_master WHERE name IN ('aptitudes','sheet_items')").length === 2);
  t('backup do conteúdo gravado antes de migrar', raw("SELECT id FROM content_backups WHERE reason LIKE 'antes das migrations%'").length >= 1);
  t('aptidões iniciais foram semeadas uma única vez', /Semeadura inicial das aptidões: semeado/.test(S.out()) && raw('SELECT COUNT(*) AS n FROM aptitudes')[0].n === 3);
  t('aptidões chegam ao jogador; talentos mantêm ids 0,1,2 (toggles antigos das fichas continuam valendo)', v.aptitudes.order.join() === 'Policial,Ladrão,Erudito' && v.aptitudes.map['Erudito'].talents.map(x => x.id).join() === '0,1,2');
  const sh = (await p.req('GET', '/api/sheets/' + v.sheets[0].id)).j;
  t('a ficha antiga mantém aptidão, caminho e o toggle de talento', sh.data.apt === 'Erudito' && sh.data.path === 'arbitro' && sh.data.toff.Erudito0 === true && Array.isArray(sh.items) && sh.items.length === 0);
  t('checksum migrou para a fórmula nova e segue íntegro', raw("SELECT value FROM app_meta WHERE key='content_checksum_v'")[0].value === '2' && (await d.req('GET', '/api/dev/integrity')).j.protected === false);
  await S.stop();
  const S2 = await start(S.file);
  const d2 = new Cli(S2.B); await d2.login('dev@x.com');
  t('reiniciar de novo não duplica nada e nada é tratado como adulteração', raw('SELECT COUNT(*) AS n FROM aptitudes')[0].n === 3 && (await d2.req('GET', '/api/dev/integrity')).j.protected === false && /ja-semeado/.test(S2.out()));
  await S2.stop();
  const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(S.file); db.exec("UPDATE aptitudes SET description='ALTERADO POR FORA' WHERE slug='Policial'"); db.close();
  const S3 = await start(S.file); const d3 = new Cli(S3.B); await d3.login('dev@x.com');
  t('a adulteração direta de aptidões também é detectada (proteção cobre o conteúdo novo)', S3.out().includes('PROTEÇÃO ATIVA') && (await d3.req('GET', '/api/dev/integrity')).j.protected === true);
  S.stop = S3.stop; S.proc = S3.proc;
};
