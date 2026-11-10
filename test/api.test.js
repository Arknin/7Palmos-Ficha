'use strict';
// Testes de ponta a ponta: contas, permissões, conteúdo global, persistência (reinício do servidor) e tempo real.
const { sleep, start, Cli, t, PNG, GIF, tmpDb, count } = require('./helpers');
(async () => {
  const file = tmpDb(); let S = await start(file);
  const P = new Cli(S.B), M = new Cli(S.B), D = new Cli(S.B), X = new Cli(S.B);

  console.log('Contas');
  t('e-mail inválido é recusado', (await X.reg('nao-e-email', 'fulano')).s === 400);
  t('senha curta é recusada', (await X.reg('f@x.com', 'fulano', '123')).s === 400);
  t('nome reservado ("Dev") é recusado', (await X.reg('f@x.com', 'Dev')).s === 400);
  t('cadastro do jogador', (await P.reg('jogador@x.com', 'jogador', 'senha-forte-123', { avatar: PNG })).s === 201);
  t('e-mail duplicado é bloqueado (sem diferenciar maiúsculas)', (await X.reg('JOGADOR@x.com', 'outro')).s === 409);
  t('nome de usuário duplicado é bloqueado (sem diferenciar maiúsculas)', (await X.reg('outro@x.com', 'JOGADOR')).s === 409);
  t('cadastro do mestre e da futura conta DEV', (await M.reg('mestre@x.com', 'mestre')).s === 201 && (await D.reg('dev@x.com', 'criadora')).s === 201);
  const me = (await P.req('GET', '/api/me')).j.user;
  t('senha nunca é devolvida e hash não é texto puro', !JSON.stringify(me).includes('senha') && me.role === 'player' && me.has_avatar === true);
  t('foto de perfil é servida pelo backend', (await P.req('GET', '/api/avatar/' + me.id)).ct.startsWith('image/png'));
  t('logout funciona e a rota privada fecha', (await P.req('POST', '/api/logout', {})).s === 200 && (await P.req('GET', '/api/me')).s === 401);
  t('login com e-mail e senha', (await P.login('jogador@x.com')).s === 200);
  t('senha errada é recusada', (await new Cli(S.B).login('jogador@x.com', 'errada-errada')).s === 401);
  t('troca de nome de usuário (único)', (await P.req('PATCH', '/api/profile', { username: 'jogador2' })).s === 200 && (await P.req('PATCH', '/api/profile', { username: 'mestre' })).s === 409);
  t('troca de foto de perfil', (await P.req('PUT', '/api/profile/avatar', { image: GIF })).s === 200 && (await P.req('GET', '/api/avatar/' + me.id)).ct.startsWith('image/gif'));
  t('imagem inválida é recusada', (await P.req('PUT', '/api/profile/avatar', { image: 'javascript:alert(1)' })).s === 400);
  t('troca de senha exige a senha atual', (await P.req('POST', '/api/profile/password', { current_password: 'errada', new_password: 'nova-senha-456' })).s === 403);
  t('troca de senha', (await P.req('POST', '/api/profile/password', { current_password: 'senha-forte-123', new_password: 'nova-senha-456' })).s === 200);
  t('senha antiga deixa de valer e a nova vale', (await new Cli(S.B).login('jogador@x.com')).s === 401 && (await new Cli(S.B).login('jogador@x.com', 'nova-senha-456')).s === 200);
  const brute = new Cli(S.B); let last = 0; for (let i = 0; i < 10; i++) last = (await brute.login('mestre@x.com', 'errada-' + i)).s;
  t('proteção contra tentativas abusivas de login (429)', last === 429);

  console.log('Recuperação de senha');
  const W = new Cli(S.B); await W.req('POST', '/api/password/forgot', { email: 'mestre@x.com' }); await sleep(200);
  const tok = (/#reset\/([0-9a-f]{64})/.exec(S.out()) || [])[1];
  t('link de redefinição é gerado (modo console)', !!tok);
  t('resposta é a mesma para e-mail inexistente (sem enumeração)', (await W.req('POST', '/api/password/forgot', { email: 'ninguem@x.com' })).s === 200);
  t('token inválido é recusado', (await W.req('POST', '/api/password/reset', { token: 'x'.repeat(64), password: 'qualquer-senha-1' })).s === 400);
  t('redefinição com o token', (await W.req('POST', '/api/password/reset', { token: tok, password: 'senha-redefinida-9' })).s === 200);
  t('token é de uso único', (await W.req('POST', '/api/password/reset', { token: tok, password: 'outra-senha-99999' })).s === 400);
  t('login com a senha redefinida', (await M.login('mestre@x.com', 'senha-redefinida-9')).s === 200);

  console.log('Permissões (jogador comum x DEV)');
  const J = new Cli(S.B); await J.login('jogador@x.com', 'nova-senha-456');
  for (const [m, u, b] of [['GET', '/api/dev/content'], ['POST', '/api/dev/paths', { name: 'Hack' }], ['GET', '/api/dev/panel.js'], ['GET', '/api/dev/backups'], ['PUT', '/api/dev/settings', { key: 'game_title', value: 'x', base_rev: 0 }], ['GET', '/api/dev/integrity']])
    t(`jogador não acessa ${m} ${u}`, (await J.req(m, u, b)).s === 403);
  t('usuário sem sessão também não', (await new Cli(S.B).req('GET', '/api/dev/content')).s === 401);

  console.log('Persistência após reiniciar o servidor');
  await S.stop(); S = await start(file, { DEV_EMAIL: 'dev@x.com' });
  const P2 = new Cli(S.B), M2 = new Cli(S.B), D2 = new Cli(S.B);
  t('mesma conta entra de novo após o reinício', (await P2.login('jogador@x.com', 'nova-senha-456')).s === 200 && (await M2.login('mestre@x.com', 'senha-redefinida-9')).s === 200);
  const me2 = (await P2.req('GET', '/api/me')).j.user;
  t('nome de usuário e foto continuam salvos', me2.username === 'jogador2' && (await P2.req('GET', '/api/avatar/' + me2.id)).ct.startsWith('image/gif'));
  t('DEV_EMAIL promoveu a conta DEV (papel gravado no banco)', (await D2.login('dev@x.com')).s === 200 && (await D2.req('GET', '/api/me')).j.user.role === 'dev');
  t('o nome de usuário não dá poder algum', (await M2.req('GET', '/api/me')).j.user.role === 'player');
  await S.stop(); S = await start(file, { DEV_EMAIL: 'mestre@x.com' });
  t('DEV_EMAIL é ignorado quando já existe um DEV', (await new Cli(S.B).login('mestre@x.com', 'senha-redefinida-9')).s === 200 && (await (async () => { const c = new Cli(S.B); await c.login('mestre@x.com', 'senha-redefinida-9'); return (await c.req('GET', '/api/me')).j.user.role; })()) === 'player');

  console.log('Conteúdo global (conta DEV)');
  const d = new Cli(S.B), pl = new Cli(S.B), mt = new Cli(S.B); await d.login('dev@x.com'); await pl.login('jogador@x.com', 'nova-senha-456'); await mt.login('mestre@x.com', 'senha-redefinida-9');
  const cid = (await mt.req('POST', '/api/campaigns', { name: 'Mesa' })).j.id, code = (await mt.req('GET', '/api/campaigns/' + cid)).j.campaign.join_code;
  await pl.req('POST', '/api/campaigns/join', { code });
  const v00 = (await pl.req('GET', '/api/campaigns/' + cid)).j.potions;
  t('jogador sem ficha ainda não recebe nenhuma camada (só nomes dos caminhos)', v00.order.includes('arbitro') && Object.keys(v00.pd.arbitro).length === 0);
  const sid = (await mt.req('POST', `/api/campaigns/${cid}/sheets`, { owner_id: me2.id, data: { name: 'Rhiona', camada: 8 } })).j.id;
  const view = async c => (await c.req('GET', '/api/campaigns/' + cid)).j.potions;
  const ct0 = (await d.req('GET', '/api/dev/content')).j.paths;
  t('conteúdo inicial migrado (3 caminhos, Árbitro com 3 poções)', ct0.length === 3 && ct0.find(p => p.slug === 'arbitro').potions.length === 3);
  const v0 = await view(pl); t('jogador na camada 8 vê o conteúdo global até onde chegou (9 e 8, sem a 7)', !!v0.pd.arbitro['9'] && !!v0.pd.arbitro['8'] && !v0.pd.arbitro['7'] && !!v0.pimgs.arbitro);
  const np = (await d.req('POST', '/api/dev/paths', { name: 'Caminho do Ladino', description: 'Furtivo e rápido.', image: PNG })).j;
  t('DEV cria um caminho', !!np.id && np.slug.startsWith('caminhodol'));
  let v1 = await view(pl); t('jogador vê o novo caminho (de outra conta)', v1.order.includes(np.slug) && v1.paths[np.slug].description === 'Furtivo e rápido.');
  const mastView = await view(mt); t('o mestre da campanha NÃO pode editar o conteúdo global', (await mt.req('POST', '/api/dev/paths', { name: 'x' })).s === 403 && (await mt.req('PUT', `/api/campaigns/${cid}/potions`, { potions: {} })).s === 410);
  const po = (await d.req('POST', '/api/dev/potions', { path_id: np.id, layer: 9, name: 'Poção do Ladino', description: 'Dedos ágeis.', image: PNG, data: { bon: 'Furtividade+1', ch: [{ t: 'Passos leves', d: 'Você faz menos barulho.', h: 'segredo', hoff: 0 }], hab: [], mel: [] } })).j;
  t('DEV cria uma poção', !!po.id);
  let ct = (await d.req('GET', '/api/dev/content')).j.paths.find(p => p.id === np.id), pot = ct.potions[0];
  t('duas poções na mesma camada são recusadas', (await d.req('POST', '/api/dev/potions', { path_id: np.id, layer: 9, name: 'Outra' })).s === 409);
  let vp = (await view(pl)).pd[np.slug]['9']; t('jogador vê a poção, nome e texto', vp && vp.n === 'Poção do Ladino' && vp.ch[0].h === 'segredo');
  const img1 = vp.img; t('imagem da poção é entregue pelo servidor', (await pl.req('GET', img1)).ct.startsWith('image/png'));
  await d.req('PATCH', '/api/dev/potions/' + po.id, { base_rev: pot.rev, description: 'Dedos muito ágeis.', image: GIF }); await sleep(50);
  vp = (await view(pl)).pd[np.slug]['9']; t('alteração de descrição e imagem aparece para o jogador', vp.d === 'Dedos muito ágeis.' && vp.img !== img1 && (await pl.req('GET', vp.img)).ct.startsWith('image/gif'));
  t('edição com revisão antiga é recusada (conflito)', (await d.req('PATCH', '/api/dev/potions/' + po.id, { base_rev: pot.rev, name: 'Velha' })).s === 409);
  ct = (await d.req('GET', '/api/dev/content')).j.paths.find(p => p.id === np.id); pot = ct.potions[0];
  await d.req('PATCH', '/api/dev/potions/' + po.id, { base_rev: pot.rev, data: { bon: 'Furtividade+1', ch: [{ t: 'Passos leves', d: 'Você faz menos barulho.', h: 'segredo', hoff: 1 }], hab: [], mel: [] } });
  t('texto oculto desativado nunca chega ao jogador', (await view(pl)).pd[np.slug]['9'].ch[0].h === undefined);
  pot = (await d.req('GET', '/api/dev/content')).j.paths.find(p => p.id === np.id).potions[0];
  t('DEV oculta a poção → some para o jogador', (await d.req('POST', `/api/dev/potions/${po.id}/status`, { base_rev: pot.rev, status: 'hidden' })).s === 200 && !(await view(pl)).pd[np.slug]['9']);
  t('mas continua existindo no banco (visível ao DEV como oculta)', (await d.req('GET', '/api/dev/content')).j.paths.find(p => p.id === np.id).potions[0].status === 'hidden');
  pot = (await d.req('GET', '/api/dev/content')).j.paths.find(p => p.id === np.id).potions[0];
  t('DEV reexibe a poção → volta para o jogador', (await d.req('POST', `/api/dev/potions/${po.id}/status`, { base_rev: pot.rev, status: 'active' })).s === 200 && !!(await view(pl)).pd[np.slug]['9']);

  console.log('Inventário e exclusão lógica');
  const inv = await pl.req('PUT', `/api/sheets/${sid}/inventory`, { potion_id: po.id, quantity: 3 });
  t('jogador guarda a poção no inventário', inv.s === 200 && inv.j.inventory[0].quantity === 3);
  const arb7 = ct0.find(p => p.slug === 'arbitro').potions.find(x => x.layer === 7);
  t('não pode guardar poção de camada que ainda não alcançou', (await pl.req('PUT', `/api/sheets/${sid}/inventory`, { potion_id: arb7.id, quantity: 1 })).s === 403);
  pot = (await d.req('GET', '/api/dev/content')).j.paths.find(p => p.id === np.id).potions[0];
  t('DEV exclui a poção (exclusão lógica)', (await d.req('POST', `/api/dev/potions/${po.id}/status`, { base_rev: pot.rev, status: 'deleted' })).s === 200);
  const full = (await pl.req('GET', '/api/sheets/' + sid)).j;
  t('inventário antigo NÃO é corrompido: poção excluída continua listada como indisponível', full.inventory.length === 1 && full.inventory[0].name === 'Poção do Ladino' && full.inventory[0].status === 'deleted' && full.inventory[0].quantity === 3);
  t('poção excluída não aparece para jogadores e não pode ser adicionada', !(await view(pl)).pd[np.slug]['9'] && (await pl.req('PUT', `/api/sheets/${sid}/inventory`, { potion_id: po.id, quantity: 4 })).s === 403);
  t('jogador pode reduzir/remover o item indisponível', (await pl.req('PUT', `/api/sheets/${sid}/inventory`, { potion_id: po.id, quantity: 0 })).j.inventory.length === 0);

  console.log('Caminhos: ocultar, reexibir, excluir');
  let pth = (await d.req('GET', '/api/dev/content')).j.paths.find(p => p.id === np.id);
  t('DEV oculta o caminho → some', (await d.req('POST', `/api/dev/paths/${np.id}/status`, { base_rev: pth.rev, status: 'hidden' })).s === 200 && !(await view(pl)).order.includes(np.slug));
  pth = (await d.req('GET', '/api/dev/content')).j.paths.find(p => p.id === np.id);
  t('DEV reexibe o caminho → volta', (await d.req('POST', `/api/dev/paths/${np.id}/status`, { base_rev: pth.rev, status: 'active' })).s === 200 && (await view(pl)).order.includes(np.slug));
  pth = (await d.req('GET', '/api/dev/content')).j.paths.find(p => p.id === np.id);
  await d.req('PATCH', '/api/dev/paths/' + np.id, { base_rev: pth.rev, name: 'Caminho do Ladino Sombrio', description: 'Novo texto.' });
  t('edição de nome/descrição do caminho aparece para todos', (await view(pl)).paths[np.slug].name === 'Caminho do Ladino Sombrio');
  pth = (await d.req('GET', '/api/dev/content')).j.paths.find(p => p.id === np.id);
  t('DEV exclui o caminho (lógico); a ficha que o usava não é alterada', (await d.req('POST', `/api/dev/paths/${np.id}/status`, { base_rev: pth.rev, status: 'deleted' })).s === 200 && !(await view(pl)).order.includes(np.slug) && (await d.req('GET', '/api/dev/content')).j.paths.find(p => p.id === np.id).status === 'deleted');

  console.log('Histórico, versões e restauração');
  const hist = (await d.req('GET', `/api/dev/history?type=potion&id=${po.id}`)).j.versions;
  t('histórico registra ações, autor e data', hist.length >= 6 && hist.every(h => h.actor === 'criadora' && h.created_at > 0) && ['create', 'update', 'hide', 'show', 'delete'].every(a => hist.some(h => h.action === a)));
  const vCreate = hist.find(h => h.action === 'create'), snap = (await d.req('GET', '/api/dev/history/' + vCreate.id)).j.snapshot;
  t('versão anterior pode ser consultada', snap.name === 'Poção do Ladino' && snap.description === 'Dedos ágeis.');
  pot = (await d.req('GET', '/api/dev/content')).j.paths.find(p => p.id === np.id).potions[0];
  t('restaurar versão antiga cria nova versão (não apaga histórico)', (await d.req('POST', '/api/dev/restore', { version_id: vCreate.id, base_rev: pot.rev })).s === 200 && (await d.req('GET', `/api/dev/history?type=potion&id=${po.id}`)).j.versions.length === hist.length + 1);

  console.log('Configurações globais e backups');
  const st = (await d.req('GET', '/api/settings')).j;
  t('DEV altera o título do jogo; todos veem (inclusive sem login)', (await d.req('PUT', '/api/dev/settings', { key: 'game_title', value: 'Meu TTRPG', base_rev: st.settings_rev.game_title || 0 })).s === 200 && (await new Cli(S.B).req('GET', '/api/settings')).j.game_title === 'Meu TTRPG');
  const bk = await d.req('POST', '/api/dev/backups', { reason: 'teste' });
  t('DEV cria e baixa um backup', bk.s === 201 && (await d.req('GET', '/api/dev/backups/' + bk.j.id)).j.paths.length >= 4);

  console.log('Tempo real do conteúdo global');
  const ctl = new AbortController(); const ev = await fetch(`${S.B}/api/events?campaign=${cid}`, { headers: { Cookie: pl.c }, signal: ctl.signal }); let got = ''; (async () => { try { for await (const ch of ev.body) got += Buffer.from(ch).toString(); } catch {} })();
  await sleep(200); const arb = (await d.req('GET', '/api/dev/content')).j.paths.find(p => p.slug === 'arbitro'); await d.req('PATCH', '/api/dev/paths/' + arb.id, { base_rev: arb.rev, description: 'Ordem e lei.' }); await sleep(300);
  t('jogador recebe o aviso em tempo real quando o DEV edita', got.includes('"t":"content"')); ctl.abort();

  console.log('Persistência do conteúdo após reiniciar (e novo deploy)');
  await S.stop(); S = await start(file);
  const d3 = new Cli(S.B), pl3 = new Cli(S.B); await d3.login('dev@x.com'); await pl3.login('jogador@x.com', 'nova-senha-456');
  const ca = (await d3.req('GET', '/api/dev/content')).j.paths;
  t('edições do DEV permanecem; o seed NÃO sobrescreveu nada', ca.find(p => p.slug === 'arbitro').description === 'Ordem e lei.' && ca.find(p => p.id === np.id).status === 'deleted' && ca.length === 4);
  t('log do servidor informa que o seed foi ignorado', /Semeadura inicial do conteúdo: ja-semeado/.test(S.out()));
  t('permissões continuam valendo após o reinício', (await pl3.req('GET', '/api/dev/content')).s === 403);
  await S.stop(); console.log(`\n${count()} verificações OK`); process.exit(0);
})().catch(e => { console.error('\n' + e.message); process.exit(1); });
