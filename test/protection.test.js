'use strict';
// Testes da PROTEÇÃO do conteúdo global: migrations destrutivas, migrations adulteradas, escrita indevida no código,
// edição direta no banco (adulteração) e backups automáticos.
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { sleep, start, Cli, t, tmpDb, ROOT, count } = require('./helpers');
const run = (args, env) => spawnSync(process.execPath, ['--no-warnings', ...args], { cwd: ROOT, env: { ...process.env, DATABASE_URL: '', ...env }, encoding: 'utf8' });
const sql = (file, q) => { const d = new DatabaseSync(file); const r = d.prepare(q).all(); d.close(); return r; };
const exec = (file, q) => { const d = new DatabaseSync(file); d.exec(q); d.close(); };
(async () => {
  const file = tmpDb(); let S = await start(file); await S.stop();      // banco já migrado e semeado
  const potions = () => sql(file, 'SELECT COUNT(*) AS n FROM potions')[0].n, md = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  for (const f of fs.readdirSync(path.join(ROOT, 'migrations'))) fs.copyFileSync(path.join(ROOT, 'migrations', f), path.join(md, f));
  const migrate = () => run(['scripts/migrate.js'], { SQLITE_PATH: file, MIGRATIONS_DIR: md });
  const before = potions();

  console.log('Migrations');
  fs.writeFileSync(path.join(md, '003_extra.sql'), '-- apenas adiciona uma tabela\nCREATE TABLE IF NOT EXISTS extra_notes(id TEXT PRIMARY KEY);\n');
  let r = migrate();
  t('migration que só adiciona estrutura é aplicada', r.status === 0 && sql(file, "SELECT name FROM sqlite_master WHERE name='extra_notes'").length === 1);
  t('backup do conteúdo é gravado no banco ANTES de migrar', sql(file, "SELECT reason FROM content_backups WHERE reason LIKE 'antes das migrations%'").length === 1);
  t('executar de novo não repete nada (idempotente)', /já está atualizado/.test(migrate().stdout));

  fs.writeFileSync(path.join(md, '004_ruim.sql'), 'DELETE FROM potions;\n'); r = migrate();
  t('migration que apaga poções é BLOQUEADA (código de saída ≠ 0)', r.status === 1);
  const msg = r.stderr;
  t('a mensagem explica alteração, conteúdo afetado, motivo, consequências e alternativa segura', ['Alteração planejada', 'Conteúdo que poderá ser afetado', 'Por que há conflito', 'Possíveis consequências', 'Alternativa segura'].every(x => msg.includes(x)) && msg.includes('potions'));
  t('nenhum dado foi tocado e a migration não foi registrada', potions() === before && sql(file, "SELECT id FROM schema_migrations WHERE id LIKE '004%'").length === 0);
  fs.writeFileSync(path.join(md, '004_ruim.sql'), "-- @destructive-approved: teste\nDELETE FROM potions;\n");
  t('marcador no arquivo SEM a variável de ambiente continua bloqueado', migrate().status === 1 && potions() === before);
  fs.writeFileSync(path.join(md, '004_ruim.sql'), 'DELETE FROM potions;\n');
  t('variável de ambiente SEM o marcador continua bloqueado', run(['scripts/migrate.js'], { SQLITE_PATH: file, MIGRATIONS_DIR: md, ALLOW_DESTRUCTIVE_MIGRATIONS: '004_ruim' }).status === 1 && potions() === before);
  for (const sub of ["UPDATE paths SET name='x'", "DROP TABLE paths", "INSERT INTO potions(id) VALUES('x')", "TRUNCATE potions", "ALTER TABLE potions DROP COLUMN data", "DELETE FROM users"]) {
    fs.writeFileSync(path.join(md, '004_ruim.sql'), sub + ';\n'); if (migrate().status !== 1) { t('bloqueia: ' + sub, false); }
  }
  t('UPDATE/DROP/INSERT/TRUNCATE/ALTER…DROP em tabelas protegidas também são bloqueados', true);
  fs.unlinkSync(path.join(md, '004_ruim.sql'));
  fs.appendFileSync(path.join(md, '001_baseline.sql'), '-- alterada depois de aplicada\n'); r = migrate();
  t('migration JÁ APLICADA que foi modificada é recusada', r.status === 1 && r.stderr.includes('MODIFICADA'));
  fs.copyFileSync(path.join(ROOT, 'migrations', '001_baseline.sql'), path.join(md, '001_baseline.sql'));

  console.log('Verificação estática (build / assistentes de IA)');
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-')); fs.cpSync(ROOT, copy, { recursive: true, filter: s => !/node_modules|\.sqlite/.test(s) });
  const safety = () => run(['scripts/safety-check.js'], { SAFETY_ROOT: copy });
  t('projeto limpo passa na verificação', safety().status === 0);
  fs.writeFileSync(path.join(copy, 'rogue.js'), "module.exports=db=>db.query(\"UPDATE potions SET name='Restaurado do código'\");\n"); r = safety();
  t('código que escreve direto nas poções é BLOQUEADO com explicação', r.status === 1 && r.stderr.includes('rogue.js') && r.stderr.includes('Alternativa segura'));
  fs.writeFileSync(path.join(copy, 'rogue.js'), "const s=require('./seed/content.json');\n");
  t('código que reaplica o seed fora do content.js é BLOQUEADO', safety().status === 1);
  fs.unlinkSync(path.join(copy, 'rogue.js')); fs.writeFileSync(path.join(copy, 'migrations', '009_x.sql'), 'DELETE FROM paths;\n');
  t('migration destrutiva nova é BLOQUEADA no build', safety().status === 1);

  console.log('Adulteração direta do banco (integridade)');
  const file2 = tmpDb(); S = await start(file2); const reg = new Cli(S.B); await reg.reg('dev@x.com', 'criadora'); const pl = new Cli(S.B); await pl.reg('p@x.com', 'jogador'); await S.stop();
  S = await start(file2, { DEV_EMAIL: 'dev@x.com' }); const d = new Cli(S.B); await d.login('dev@x.com');
  const arb = (await d.req('GET', '/api/dev/content')).j.paths.find(p => p.slug === 'arbitro');
  t('DEV edita normalmente com o conteúdo íntegro', (await d.req('PATCH', '/api/dev/paths/' + arb.id, { base_rev: arb.rev, description: 'Texto oficial do DEV' })).s === 200);
  t('integridade reporta "ok"', (await d.req('GET', '/api/dev/integrity')).j.protected === false);
  await S.stop();
  exec(file2, "UPDATE paths SET description='RESTAURADO POR ATUALIZAÇÃO TÉCNICA' WHERE slug='arbitro'; UPDATE potions SET name='HACK' WHERE layer=9;");
  S = await start(file2); const d2 = new Cli(S.B), p2 = new Cli(S.B); await d2.login('dev@x.com'); await p2.login('p@x.com');
  t('ao subir, o servidor detecta a alteração fora da aplicação e avisa', S.out().includes('PROTEÇÃO ATIVA') && (await d2.req('GET', '/api/dev/integrity')).j.protected === true);
  const cur = (await d2.req('GET', '/api/dev/content')).j.paths.find(p => p.slug === 'arbitro');
  const w = await d2.req('PATCH', '/api/dev/paths/' + cur.id, { base_rev: cur.rev, description: 'tentativa' });
  t('edições ficam BLOQUEADAS (423) em vez de sobrescrever/misturar dados', w.s === 423 && /PROTEÇÃO ATIVA/.test(w.j.error));
  t('os dados existentes permanecem exatamente como estavam', sql(file2, "SELECT description FROM paths WHERE slug='arbitro'")[0].description === 'RESTAURADO POR ATUALIZAÇÃO TÉCNICA');
  t('jogadores continuam conseguindo ler o jogo (somente leitura)', (await p2.req('GET', '/api/settings')).s === 200);
  const ac = await d2.req('POST', '/api/dev/integrity', {});
  t('DEV revisa e aceita o estado atual (gera backup + registro administrativo)', ac.s === 200 && sql(file2, "SELECT id FROM content_backups WHERE reason LIKE 'antes de aceitar%'").length === 1 && sql(file2, "SELECT id FROM admin_log WHERE action='integrity.accept'").length === 1);
  const cur2 = (await d2.req('GET', '/api/dev/content')).j.paths.find(p => p.slug === 'arbitro');
  t('depois de aceito, as edições do DEV voltam a funcionar', (await d2.req('PATCH', '/api/dev/paths/' + cur2.id, { base_rev: cur2.rev, description: 'Texto corrigido' })).s === 200);
  await S.stop(); console.log(`\n${count()} verificações OK`); process.exit(0);
})().catch(e => { console.error('\n' + e.message); process.exit(1); });
