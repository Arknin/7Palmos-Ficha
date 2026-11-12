'use strict';
// "Substituir o repositório pelo novo": um banco criado pela versão ANTERIOR, com edições da conta DEV,
// precisa continuar exatamente igual quando o código novo sobe. (fixture gerada pelo código v3.0)
const fs = require('fs'), path = require('path'), { DatabaseSync } = require('node:sqlite');
const { start, Cli, t, tmpDb, ROOT, count } = require('./helpers');
(async () => {
  const file = tmpDb(); fs.copyFileSync(path.join(__dirname, 'fixtures', 'dev-edits-v3.sqlite'), file);
  const raw = q => { const d = new DatabaseSync(file); const r = d.prepare(q).all(); d.close(); return r; };
  const before = { versions: raw('SELECT COUNT(*) AS n FROM content_versions')[0].n, backups: raw('SELECT COUNT(*) AS n FROM content_backups')[0].n };
  const S = await start(file), d = new Cli(S.B), p = new Cli(S.B);
  console.log('Novo código sobre o banco com edições do DEV');
  t('servidor novo sobe sem erro e sem alarme de integridade', !/PROTEÇÃO ATIVA|OPERAÇÃO INTERROMPIDA|Error/.test(S.out()));
  t('o seed NÃO foi reaplicado (conteúdo existente preservado)', /Semeadura inicial do conteúdo: ja-semeado/.test(S.out()));
  t('conta DEV continua DEV', (await d.login('dev@x.com')).s === 200 && (await d.req('GET', '/api/me')).j.user.role === 'dev');
  const ct = (await d.req('GET', '/api/dev/content')).j.paths, by = s => ct.find(x => x.slug === s), arb = by('arbitro');
  t('texto do caminho editado pelo DEV permanece', arb.description === 'Texto oficial editado pelo DEV');
  t('edição (texto e imagem) da poção da camada 9 permanece', arb.potions.find(x => x.layer === 9).description === 'Descrição editada pelo DEV na camada 9' && !!arb.potions.find(x => x.layer === 9).image);
  t('o caminho criado pelo DEV e sua poção permanecem', by('caminhodol') !== undefined || ct.some(x => x.name === 'Caminho do Ladino' && x.potions.length === 1 && x.potions[0].name === 'Poção do Ladino'));
  t('o caminho oculto continua oculto', by('saqueador').status === 'hidden');
  t('título global do jogo permanece', (await d.req('GET', '/api/settings')).j.game_title === 'Meu TTRPG');
  t('histórico de versões e backups anteriores permanecem', raw('SELECT COUNT(*) AS n FROM content_versions')[0].n >= before.versions && raw('SELECT COUNT(*) AS n FROM content_backups')[0].n >= before.backups);
  t('integridade segue "ok" (nada foi tratado como adulteração)', (await d.req('GET', '/api/dev/integrity')).j.protected === false);
  await p.login('jogador@x.com'); const cid = (await p.req('GET', '/api/campaigns')).j.campaigns[0].id, v = (await p.req('GET', '/api/campaigns/' + cid)).j;
  t('jogador vê o conteúdo do DEV (Ladino visível, Saqueador oculto)', v.potions.order.includes('arbitro') && !v.potions.order.includes('saqueador') && v.potions.order.length === 3);
  t('campanha, ficha e dados de jogadores permanecem', v.campaign.name === 'Mesa Antiga' && v.sheets.length === 1 && v.sheets[0].name === 'Rhiona');
  t('inventário antigo permanece no banco (nenhuma tabela foi apagada)', raw('SELECT COUNT(*) AS n FROM inventory')[0].n === 1);
  S.file = file; await require('./upgrade-extra')({ d, p, v, cid, raw, S, t });
  await S.stop(); console.log(`\n${count()} verificações OK`); process.exit(0);
})().catch(e => { console.error('\n' + e.message); process.exit(1); });
