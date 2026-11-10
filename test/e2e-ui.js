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
  await P.waitForFunction(() => document.querySelectorAll('#inv select option').length >= 2, { timeout: 8000 });
  await P.evaluate(() => document.querySelector('#inv .add .btn').click()); await waitText(P, 'Árbitro'); await P.waitForFunction(() => /1/.test(document.querySelector('#inv .mrow .ch')?.textContent || ''));
  t('jogador guarda uma poção do catálogo global no inventário', true);

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

  console.log('Layout das setas (Tenacidade/Sanidade)');
  for (const [w, h, nome] of [[1280, 900, 'computador'], [375, 800, 'celular']]) {
    await P.setViewport({ width: w, height: h }); await P.goto(B + '/#s/' + sheetId); await P.waitForSelector('#stt .arw'); await sleep(300);
    const r = await P.evaluate(() => { const g = id => [...document.querySelectorAll(id + ' .arw')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), Math.round(r.height)]; }); return { t: g('#stt'), s: g('#sts') }; });
    t(`setas de TN e SN alinhadas no ${nome}: ${JSON.stringify(r.t)}`, JSON.stringify(r.t) === JSON.stringify(r.s));
  }
  console.log(`\n${count()} verificações OK`); console.log('Erros de console/JS:', errors.length ? errors : 'nenhum');
  await br.close(); await S.stop(); process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('\n' + e.message, errors); process.exit(1); });
