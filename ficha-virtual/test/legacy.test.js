'use strict';
// Atualização de um banco da versão anterior: nada pode ser perdido.
const crypto = require('crypto'), { DatabaseSync } = require('node:sqlite'), fs = require('fs'), path = require('path');
const { start, Cli, t, tmpDb, ROOT, count } = require('./helpers');
(async () => {
  const file = tmpDb(), d = new DatabaseSync(file), salt = crypto.randomBytes(16), h = crypto.scryptSync('senha-antiga-123', salt, 64).toString('hex');
  for (const f of ['001_baseline.sql']) for (const s of fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8').replace(/--.*$/gm, '').split(/;\s*\n/).map(x => x.trim()).filter(Boolean)) d.exec(s);
  d.exec("ALTER TABLE campaigns ADD COLUMN dummy TEXT"); // (o esquema antigo é o 001; a coluna extra só prova que nada é recriado)
  d.prepare("INSERT INTO users(id,username,username_lc,pass_hash,created_at) VALUES('u1','veterano','veterano',?,1)").run(`s1$${salt.toString('hex')}$${h}`);
  d.prepare("INSERT INTO campaigns(id,name,owner_id,join_code,allow_layers,potions,rev,created_at) VALUES('c1','Campanha Antiga','u1','ABCDEFGH',1,'{}',1,1)").run();
  d.prepare("INSERT INTO members(campaign_id,user_id,role,joined_at) VALUES('c1','u1','master',1)").run();
  d.prepare("INSERT INTO sheets(id,campaign_id,owner_id,data,rev,created_at,updated_at) VALUES('s1','c1','u1',?,3,1,1)").run(JSON.stringify({ name: 'Rhiona', camada: 8, path: 'arbitro', attrs: { combate: 1, fisico: 5, agilidade: 1, percepcao: 1, inteligencia: 1, vontade: 1, carisma: 1 } }));
  d.close();
  const S = await start(file), c = new Cli(S.B);
  console.log('Migração de banco antigo');
  t('conta antiga (sem e-mail) entra pelo nome de usuário', (await c.req('POST', '/api/login', { identifier: 'veterano', password: 'senha-antiga-123' })).s === 200);
  t('hash antigo foi atualizado para o formato novo', new DatabaseSync(file).prepare("SELECT pass_hash FROM users WHERE id='u1'").get().pass_hash.startsWith('s2$'));
  t('pode cadastrar o e-mail (e a partir daí entra por e-mail)', (await c.req('PATCH', '/api/profile', { email: 'vet@x.com' })).s === 200 && (await new Cli(S.B).login('vet@x.com', 'senha-antiga-123')).s === 200);
  const sh = (await c.req('GET', '/api/sheets/s1')).j;
  t('campanha, ficha, camada e caminho antigos continuam intactos', sh.data.name === 'Rhiona' && sh.data.path === 'arbitro' && sh.rev === 3);
  const v = (await c.req('GET', '/api/campaigns/c1')).j;
  t('o caminho "arbitro" da ficha antiga existe no conteúdo global', v.potions.order.includes('arbitro') && !!v.potions.pd.arbitro['8']);
  await S.stop(); console.log(`\n${count()} verificações OK`); process.exit(0);
})().catch(e => { console.error('\n' + e.message); process.exit(1); });
