'use strict';
// Teste de interface no Chrome (puppeteer-core): cadastro, perfil, painel DEV, sincronização e layout móvel.
const fs = require('fs'), os = require('os'), path = require('path');
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer-core');
const { start, Cli, t, tmpDb, PNG, sleep, count } = require('./helpers');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const errors = [];
const waitText = (p, x, to = 8000) => p.waitForFunction(s => document.body.innerText.toLowerCase().includes(s.toLowerCase()), { timeout: to }, x).catch(async e => { console.log('--- aguardando "' + x + '" falhou; página:', await p.evaluate(() => location.hash + ' | ' + CUR + ' | ' + document.body.innerText.replace(/\n+/g, ' / ').slice(0, 700))); throw e; });
const gone = (p, x, to = 8000) => p.waitForFunction(s => !document.body.innerText.toLowerCase().includes(s.toLowerCase()), { timeout: to }, x);
const clickText = (p, sel, text) => p.evaluate((sel, text) => { const e = [...document.querySelectorAll(sel)].find(x => x.offsetParent && x.textContent.trim() === text); if (!e) throw new Error('não achei: ' + text); e.click(); }, sel, text);
(async () => {
  const file = tmpDb(); let S = await start(file);
  const br = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true });
  const mk = async () => { const c = await br.createBrowserContext(), p = await c.newPage(); await p.setViewport({ width: 1280, height: 900 }); p.on('pageerror', e => errors.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/NAME_NOT_RESOLVED|401|403/.test(m.text())) errors.push('console: ' + m.text()); }); return p; };
  const A = await mk(), P = await mk(), D = await mk(); let B = S.B;
  const reg = async (p, email, user) => { await p.goto(B + '/'); await p.waitForSelector('#af'); await p.click('[data-m=register]'); await p.type('#f1', email); await p.type('#f3', user); await p.type('#f2', 'senha-forte-123'); await p.click('#af .btn'); await waitText(p, 'Campanhas'); };
  console.log('Cadastro e perfil');
  await reg(A, 'mestre@x.com', 'mestre'); await reg(P, 'jogador@x.com', 'jogador'); await reg(D, 'dev@x.com', 'criadora');
  t('contas criadas pela interface (e-mail, usuário e senha)', true);
  await P.goto(B + '/#perfil'); await waitText(P, 'jogador@x.com');
  const png = path.join(os.tmpdir(), 'foto.png'); fs.writeFileSync(png, Buffer.from(PNG.split(',')[1], 'base64'));
  await (await P.$('#pf input[type=file]')).uploadFile(png); await P.waitForSelector('#bar img.av', { timeout: 8000 }); t('foto de perfil enviada e exibida na barra', true);
  // reinício do servidor: sessões, contas e foto persistem
  await S.stop(); S = await start(file, { DEV_EMAIL: 'dev@x.com' }); B = S.B;
  for (const p of [A, P, D]) await p.goto(B + '/#camps');
  await waitText(P, 'Campanhas'); t('após reiniciar o servidor a sessão e a conta continuam válidas', true);
  await P.waitForSelector('#bar img.av'); t('a foto de perfil continua salva após o reinício', true);
  await D.reload(); await D.waitForSelector('#bar a[href="#dev"]', { timeout: 8000 }); t('conta DEV (papel do banco) vê o botão do Painel DEV', true);
  t('jogador e mestre NÃO veem o botão do painel', !(await P.$('#bar a[href="#dev"]')) && !(await A.$('#bar a[href="#dev"]')));
  await P.goto(B + '/#dev'); await waitText(P, 'Acesso restrito'); t('jogador que digita #dev é barrado (e o script do painel não é entregue)', !(await P.evaluate(() => !!window.renderDev)) && (await P.evaluate(async () => (await fetch('/api/dev/panel.js')).status)) === 403);

  console.log('Campanha, ficha e inventário');
  await A.goto(B + '/#camps'); await A.type('#cn', 'Mesa do Teste'); await A.click('#cc'); await waitText(A, 'Código de convite');
  const code = await A.$eval('.code', e => e.textContent.trim()); await P.goto(B + '/#camps'); await P.type('#cj', code); await P.click('#cjb'); await waitText(P, 'Mesa do Teste');
  await A.waitForFunction(() => document.querySelectorAll('#nown option').length >= 2, { timeout: 6000 }); await A.select('#nown', await A.$eval('#nown option:nth-child(2)', o => o.value)); await A.click('#nsh');
  await A.waitForFunction(() => CUR === 'sheet'); await A.$eval('#name', e => { e.focus(); e.select(); }); await A.type('#name', 'Rhiona'); await A.waitForFunction(() => document.getElementById('stat').textContent === 'Salvo');
  await A.$eval('#camada', e => { e.value = '8'; e.dispatchEvent(new Event('change')); }); await A.waitForFunction(() => BASE.camada === 8, { timeout: 6000 });
  await waitText(P, 'Rhiona'); await P.evaluate(() => document.querySelector('#v-app .pc a.btn').click()); await P.waitForFunction(() => CUR === 'sheet');
  const sheetId = await P.evaluate(() => SH.id);
  t('jogador abre a ficha que o mestre criou para ele', await P.$eval('#name', e => e.value) === 'Rhiona');
  t('menu lateral aparece dentro da ficha (Campanha, Ficha, Inventário)', await P.$eval('#rail', e => !e.hidden && ['Campanha', 'Ficha', 'Inventário'].every(x => e.innerText.includes(x))));
  const rail = await P.evaluate(() => { const r = document.getElementById('rail').getBoundingClientRect(); return { cy: r.top + r.height / 2, h: innerHeight, right: innerWidth - r.right, w: r.width, h2: r.height, br: getComputedStyle(document.getElementById('rail')).borderRadius }; });
  t('menu é um retângulo vertical, centralizado na altura, encostado à direita e bem arredondado', Math.abs(rail.cy - rail.h / 2) < 4 && rail.right < 30 && rail.h2 > rail.w && parseInt(rail.br) >= 24);
  await P.evaluate(() => [...document.querySelectorAll('#rail a')].find(a => a.title === 'Inventário').click()); await P.waitForFunction(() => CUR === 'inv');
  t('inventário: foto e descrição NÃO aparecem no formulário até serem escolhidas', !(await P.$('#invc .itemform input[type=file]')) && !(await P.$('#invc .itemform textarea')));
  await P.type('#invc .itemform input', 'Corda de seda'); await clickText(P, '#invc button', 'Criar item'); await waitText(P, 'Corda de seda');
  t('item criado só com nome não exibe foto nem descrição', !(await P.$('#invc .icard img')) && !(await P.$('#invc .icard .ldesc')));
  await P.type('#invc .itemform input', 'Amuleto'); await clickText(P, '#invc .itemform button', '+ Descrição'); await P.type('#invc .itemform textarea', 'Brilha no escuro');
  await clickText(P, '#invc .itemform button', '+ Foto'); await (await P.$('#invc .itemform input[type=file]')).uploadFile(png); await P.waitForSelector('#invc .itemform img.limg[src^="data:"]'); await clickText(P, '#invc button', 'Criar item');
  await waitText(P, 'Brilha no escuro'); t('item com descrição e foto exibe ambos', (await P.$$('#invc .icard img')).length === 1 && (await P.$$('#invc .icard .ldesc')).length === 1);
  await P.evaluate(() => [...document.querySelectorAll('#rail a')].find(a => a.title === 'Ficha').click()); await P.waitForFunction(() => CUR === 'sheet'); t('menu lateral leva de volta à ficha', true);
  await P.evaluate(() => [...document.querySelectorAll('#rail a')].find(a => a.title === 'Campanha').click()); await P.waitForFunction(() => CUR === 'camp'); t('fora da ficha (campanha) o menu lateral some', await P.$eval('#rail', e => e.hidden));

  console.log('Painel DEV (interface)');
  await D.goto(B + '/#dev'); await D.waitForFunction(() => CUR === 'dev' && !!document.querySelector('#dv .pc')); await waitText(D, 'Caminho do Árbitro');
  t('painel DEV lista caminhos com status', await D.evaluate(() => document.body.innerText.includes('ATIVO')));
  await P.goto(B + '/#c/' + (await P.evaluate(() => CAMP.id)) + '/pocao'); await P.waitForFunction(() => CUR === 'cpot'); await waitText(P, 'Caminho do Árbitro'); await P.evaluate(() => document.querySelector('#pick .pc .btn').click()); await waitText(P, 'Camada 8');
  await D.evaluate(() => document.querySelector('#dv .pc .btn').click()); await D.waitForSelector('#dv textarea'); await D.$eval('#dv textarea', e => { e.focus(); e.select(); }); await D.type('#dv textarea', 'Texto novo escrito pelo DEV no painel'); await clickText(D, '#dv button', 'Salvar caminho');
  await waitText(P, 'Texto novo escrito pelo DEV no painel'); t('edição do DEV aparece para o jogador em tempo real, sem recarregar', true);
  await clickText(D, '#dv button', 'Criar'); // primeira camada vazia (9..0) -> camada 6
  await D.waitForSelector('#dv input'); await D.type('#dv input', 'Poção Criada na Interface'); await clickText(D, '#dv button', 'Salvar poção'); await waitText(D, 'Poção Criada na Interface'); t('DEV cria uma poção pela interface', true);
  await D.evaluate(() => document.querySelector('#dv a.nav, #dv button.nav').click()); await waitText(D, 'Caminho do Saqueador');
  await clickText(P, '#layers button', 'Trocar caminho'); await waitText(P, 'Caminho do Saqueador');
  await D.evaluate(() => [...document.querySelectorAll('#dv .pc')].find(c => c.innerText.includes('Caminho do Saqueador')).querySelectorAll('button')[1].click()); await gone(P, 'Caminho do Saqueador'); t('DEV oculta um caminho → some para o jogador em tempo real', true);
  await D.evaluate(() => [...document.querySelectorAll('#dv .pc')].find(c => c.innerText.includes('Caminho do Saqueador')).querySelectorAll('button')[1].click()); await waitText(P, 'Caminho do Saqueador'); t('DEV reexibe → volta para o jogador', true);

  console.log('Aptidões e perícias definidas pelo DEV');
  await D.goto(B + '/#dev'); await D.waitForFunction(() => CUR === 'dev' && !!document.querySelector('#dv .pc')); await clickText(D, '#dv button', 'Nova aptidão'); await D.waitForSelector('#dv .skp');
  await D.type('#dv input', 'Médico'); await clickText(D, '#dv button', 'Adicionar talento'); await D.type('#dv .sec .it input', 'Primeiros Socorros');
  const medicina = () => D.evaluate(() => { const r = [...document.querySelectorAll('#dv .skp .sk')].find(x => x.innerText.startsWith('Medicina')); r.querySelector('button.die').click(); r.querySelector('button.die').click(); return r.innerText; });
  t('painel de perícias: 2 cliques no d20 = "Apto +2" (igual à ficha)', /Apto \+2/.test(await medicina()));
  await clickText(D, '#dv button', 'Salvar aptidão'); await waitText(D, '1 talento(s) · 1 perícia(s)'); t('DEV cria aptidão com talento e perícia pela interface', true);
  const sheetId2 = await P.evaluate(() => SH && SH.id) || sheetId; await P.goto(B + '/#s/' + sheetId2); await P.waitForFunction(() => CUR === 'sheet'); await P.waitForFunction(() => [...document.querySelectorAll('#apt option')].some(o => o.textContent === 'Médico'));
  await P.select('#apt', 'Médico'); await P.waitForFunction(() => document.querySelector('#tals').innerText.includes('Primeiros Socorros'));
  const ap = await P.evaluate(() => { const d = [...document.querySelectorAll('#sk1 .sk, #sk2 .sk')].find(x => x.innerText.startsWith('Medicina')).querySelector('.die'); return { ms: BN.ms.medicina, c: d.style.getPropertyValue('--c') }; });
  t('jogador escolhe a aptidão: talentos aparecem e a perícia concedida sobe para Apto (mínimo)', ap.ms === 2 && ap.c.includes('--l2'));
  const dir = await P.evaluate(() => { CP.pd.arbitro['8'].bon = 'aprendiz:Atletismo; apto:Furtividade; mestre:Corpo a Corpo Simples; graomestre:Medicina'; S.path = 'arbitro'; S.camada = 8; return JSON.stringify(bonus().ms); });
  t('diretivas aprendiz:/apto:/mestre:/graomestre: funcionam nas poções', JSON.parse(dir).atletismo === 1 && JSON.parse(dir).furtividade === 2 && JSON.parse(dir)['corpo a corpo simples'] === 3 && JSON.parse(dir).medicina === 4);
  await D.goto(B + '/#dev'); await D.waitForFunction(() => CUR === 'dev' && !!document.querySelector('#dv .pc')); await D.evaluate(() => document.querySelector('#dv .pc .btn').click()); await D.waitForSelector('#dv .mrow button');
  await clickText(D, '#dv button', 'Editar'); await D.waitForSelector('#dv .skp'); await D.evaluate(() => [...document.querySelectorAll('#dv .skp .sk')].find(x => x.innerText.startsWith('Atletismo')).querySelector('button.die').click()); await clickText(D, '#dv button', 'Salvar poção'); await sleep(600);
  const saved = await D.evaluate(async () => (await (await fetch('/api/dev/content')).json()).paths.find(p => p.slug === 'arbitro').potions.find(x => x.layer === 9).data.bon);
  t('na edição da poção, o seletor grava a diretiva (aprendiz:Atletismo)', /aprendiz:Atletismo/.test(saved));

  console.log('Layout das setas (Tenacidade/Sanidade)');
  for (const [w, h, nome] of [[1280, 900, 'computador'], [375, 800, 'celular']]) {
    await P.setViewport({ width: w, height: h }); await P.goto(B + '/#s/' + sheetId); await P.waitForSelector('#stt .arw'); await sleep(300);
    const r = await P.evaluate(() => { const g = id => [...document.querySelectorAll(id + ' .arw')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), Math.round(r.height)]; }); return { t: g('#stt'), s: g('#sts') }; });
    t(`setas de TN e SN alinhadas no ${nome}: ${JSON.stringify(r.t)}`, JSON.stringify(r.t) === JSON.stringify(r.s));
  }
  console.log(`\n${count()} verificações OK`); console.log('Erros de console/JS:', errors.length ? errors : 'nenhum');
  await br.close(); await S.stop(); process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('\n' + e.message, errors); process.exit(1); });
