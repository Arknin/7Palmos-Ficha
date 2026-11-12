'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), { promisify } = require('util');
const db = require('./db'), content = require('./content'), mail = require('./mail');
const { HttpError, bad, forbid, nf, conflict, now, uid, sha, str, int, obj, image, cleanSheet } = require('./lib');
const scrypt = promisify(crypto.scrypt);
const PUB = path.join(__dirname, 'public');
const PROD = process.env.NODE_ENV === 'production';
const Q = (sql, p) => db.query(sql, p);

// ---------- senhas (scrypt, parâmetros versionados no próprio hash; hashes antigos são atualizados no login) ----------
const KDF = { N: 32768, r: 8, p: 3 }, MAXMEM = 128 * 1024 * 1024;
async function hashPw(pw) { const salt = crypto.randomBytes(16), h = await scrypt(pw, salt, 64, { ...KDF, maxmem: MAXMEM }); return `s2$${KDF.N}$${KDF.r}$${KDF.p}$${salt.toString('hex')}$${h.toString('hex')}`; }
async function checkPw(pw, stored) {
  const a = stored.split('$'); let x, hex, upgrade = true;
  if (a[0] === 's2') { x = await scrypt(pw, Buffer.from(a[4], 'hex'), 64, { N: +a[1], r: +a[2], p: +a[3], maxmem: MAXMEM }); hex = a[5]; upgrade = +a[1] < KDF.N || +a[2] < KDF.r || +a[3] < KDF.p; }
  else if (a[0] === 's1') { x = await scrypt(pw, Buffer.from(a[1], 'hex'), 64); hex = a[2]; }
  else return { ok: false };
  const y = Buffer.from(hex, 'hex'); return { ok: x.length === y.length && crypto.timingSafeEqual(x, y), upgrade };
}
const DUMMY = hashPw('senha-falsa-para-igualar-o-tempo');
const normEmail = v => String(v || '').trim().toLowerCase();
const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const RESERVED = ['dev', 'admin', 'administrador', 'administrator', 'root', 'system', 'sistema', 'suporte', 'support', 'moderador'];
function checkPassword(pw, u, e) {
  if (typeof pw !== 'string' || pw.length < 8) throw bad('A senha precisa ter ao menos 8 caracteres'); if (pw.length > 128) throw bad('Senha longa demais (máximo 128)');
  if (u && pw.toLowerCase() === String(u).toLowerCase() || e && pw.toLowerCase() === e) throw bad('A senha não pode ser igual ao usuário ou e-mail');
}
function checkUsername(u) {
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(u)) throw bad('Usuário: 3 a 24 caracteres (letras, números, _ . -)');
  if (RESERVED.includes(u.toLowerCase())) throw bad('Este nome de usuário é reservado');
}
const dupError = e => /unique|duplicate/i.test(String(e && e.message));

// ---------- sessões e limitação de tentativas (no banco: valem para várias instâncias) ----------
const secure = req => PROD || req.headers['x-forwarded-proto'] === 'https';
const setCookie = (res, req, val, age) => res.setHeader('Set-Cookie', `sid=${val}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${secure(req) ? '; Secure' : ''}`);
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split(/=(.*)/s).slice(0, 2)).filter(a => a[0] && a[1]));
const DAY = 864e5, TTL = 30 * DAY, MAXLIFE = 90 * DAY;
async function startSession(req, res, userId) {
  const tok = crypto.randomBytes(32).toString('hex'), t = now();
  await Q('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES($1,$2,$3,$4)', [sha(tok), userId, t + TTL, t]); setCookie(res, req, tok, TTL / 1000);
}
const publicUser = r => ({ id: r.id, username: r.username, email: r.email || null, role: r.role, has_avatar: !!r.has_avatar, avatar_v: r.avatar_v });
async function authUser(req, res) {
  const t = cookies(req).sid; if (!t) return null;
  const r = (await Q('SELECT u.id,u.username,u.email,u.role,u.avatar_v,CASE WHEN u.avatar IS NULL THEN 0 ELSE 1 END AS has_avatar,s.token_hash,s.expires_at,s.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2', [sha(t), now()]))[0];
  if (!r) return null; const born = r.created_at || r.expires_at - TTL;
  if (now() - born > MAXLIFE) { await Q('DELETE FROM sessions WHERE token_hash=$1', [r.token_hash]); return null; }
  if (r.expires_at - now() < TTL - DAY) { const exp = Math.min(now() + TTL, born + MAXLIFE); await Q('UPDATE sessions SET expires_at=$1 WHERE token_hash=$2', [exp, r.token_hash]); if (res) setCookie(res, req, t, Math.floor((exp - now()) / 1000)); }
  return publicUser(r);
}
async function hit(key, max, win) {
  const t = now(), r = (await Q('INSERT INTO rate_limits(key,count,reset_at) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<$3 THEN 1 ELSE rate_limits.count+1 END, reset_at=CASE WHEN rate_limits.reset_at<$3 THEN $2 ELSE rate_limits.reset_at END RETURNING count', [key, t + win, t]))[0];
  if (r.count > max) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
}
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// ---------- tempo real (Server-Sent Events) ----------
const clients = new Map(); // campaignId -> Set<{res,uid}>
function broadcast(cid, data) { const s = clients.get(cid); if (!s) return; const m = `event: changed\ndata: ${JSON.stringify(data)}\n\n`; for (const c of s) c.res.write(m); }
const broadcastAll = data => { for (const cid of clients.keys()) broadcast(cid, data); };
function kick(cid, userId) { const s = clients.get(cid); if (!s) return; for (const c of [...s]) if (c.uid === userId) { c.res.write('event: kicked\ndata: {}\n\n'); c.res.end(); s.delete(c); } }
setInterval(() => { for (const s of clients.values()) for (const c of s) c.res.write(': ping\n\n'); }, 25000).unref();

// ---------- campanhas e fichas ----------
const roleOf = async (cid, u, q = Q) => ((await q('SELECT role FROM members WHERE campaign_id=$1 AND user_id=$2', [cid, u]))[0] || {}).role || null;
const needMember = async (cid, u, q) => { const r = await roleOf(cid, u, q); if (!r) throw nf(); return r; };
const needMaster = async (cid, u, q) => { if ((await needMember(cid, u, q)) !== 'master') throw forbid('Apenas o mestre pode fazer isso'); };
const getSheet = async (sid, q = Q, lock = '') => { const s = (await q('SELECT * FROM sheets WHERE id=$1' + lock, [sid]))[0]; if (!s) throw nf(); return s; };
const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(8), b => CODE[b % CODE.length]).join('');
const summary = d => ({ name: d.name || '', img: d.img || '', attrs: d.attrs || {} }); // única parte visível a outros jogadores
const aptOk = async (q, apt) => !apt || (await q(`SELECT 1 AS x FROM aptitudes WHERE slug=$1 AND status='active'`, [apt])).length > 0;
const itemsOf = (q, sid) => q(`SELECT id,name,description,quantity,CASE WHEN image='' THEN 0 ELSE 1 END AS has_image,updated_at FROM sheet_items WHERE sheet_id=$1 ORDER BY position,created_at`, [sid]).then(r => r.map(x => ({ ...x, has_image: !!x.has_image })));
async function itemAccess(q, itemId, user, lock = '') {
  const it = (await q('SELECT * FROM sheet_items WHERE id=$1', [itemId]))[0]; if (!it) throw nf();
  const s = await getSheet(it.sheet_id, q, lock), role = await needMember(s.campaign_id, user.id, q);
  if (role !== 'master' && s.owner_id !== user.id) throw nf(); return { it, s };
}
const itemFields = (b, partial) => {
  const o = {};
  if (!partial || b.name !== undefined) { o.name = str(String(b.name || '').trim(), 80, 'nome'); if (!o.name) throw bad('Informe o nome do item'); }
  if (b.description !== undefined) o.description = str(String(b.description || ''), 2000, 'descrição');
  if (b.image !== undefined) o.image = b.image === '' ? '' : image(b.image, 4e5, 'foto do item');
  if (b.quantity !== undefined) o.quantity = int(b.quantity, 0, 9999, 'quantidade');
  return o;
};
async function touchSheet(q, s) { const rev = s.rev + 1; await q('UPDATE sheets SET rev=$1, updated_at=$2 WHERE id=$3', [rev, now(), s.id]); return rev; }
async function campaignView(cid, user) {
  const c = (await Q('SELECT * FROM campaigns WHERE id=$1', [cid]))[0]; if (!c) throw nf();
  const role = await needMember(cid, user.id);
  const members = await Q('SELECT m.user_id,m.role,u.username,u.avatar_v,CASE WHEN u.avatar IS NULL THEN 0 ELSE 1 END AS has_avatar FROM members m JOIN users u ON u.id=m.user_id WHERE m.campaign_id=$1 ORDER BY m.role,u.username', [cid]);
  const rows = await Q('SELECT s.id,s.owner_id,s.rev,s.updated_at,s.data,u.username AS owner_name FROM sheets s JOIN users u ON u.id=s.owner_id WHERE s.campaign_id=$1 ORDER BY s.created_at', [cid]);
  const parsed = rows.map(r => ({ r, d: JSON.parse(r.data) }));
  const sheets = parsed.map(({ r, d }) => ({ id: r.id, owner_id: r.owner_id, owner_name: r.owner_name, rev: r.rev, updated_at: r.updated_at, ...summary(d) }));
  let minLayer = 0;
  if (role !== 'master') { const mine = parsed.filter(x => x.r.owner_id === user.id).map(x => Number.isInteger(x.d.camada) ? x.d.camada : 9); minLayer = mine.length ? Math.min(...mine) : 10; }
  const potions = await content.clientContent({ minLayer }), aptitudes = await content.clientAptitudes(); // conteúdo GLOBAL, igual para todas as campanhas
  return { campaign: { id: c.id, name: c.name, owner_id: c.owner_id, allow_layers: !!c.allow_layers, rev: c.rev, join_code: role === 'master' ? c.join_code : undefined }, role, me: user.id, members: members.map(m => ({ ...m, has_avatar: !!m.has_avatar })), sheets, potions, aptitudes };
}

// ---------- API ----------
async function api(req, res, url) {
  const m = req.method, P = url.pathname.split('/').filter(Boolean).slice(1);
  if (m !== 'GET') {
    const o = req.headers.origin; if (o && new URL(o).host !== req.headers.host) throw forbid('Origem não permitida');
    if (req.headers['x-requested-with'] !== 'fetch') throw forbid('Cabeçalho obrigatório ausente');
  }
  const body = ['POST', 'PUT', 'PATCH'].includes(m) ? await readBody(req) : {};
  const ip = ipOf(req);

  // ----- públicas -----
  if (m === 'GET' && P[0] === 'settings') { const s = await content.getSettings(); return [200, { game_title: s.values.game_title, game_description: s.values.game_description, recovery: mail.enabled(), settings_rev: s.rev }]; }
  if (m === 'POST' && P[0] === 'register') {
    await hit('reg:' + ip, 10, 3600e3);
    const email = normEmail(body.email), u = str(String(body.username || '').trim(), 24, 'usuário'), pw = body.password;
    if (!EMAIL.test(email) || email.length > 254) throw bad('E-mail inválido'); checkUsername(u); checkPassword(pw, u, email);
    let av = null; if (body.avatar) av = image(body.avatar, 4e5, 'foto de perfil');
    if ((await Q('SELECT 1 AS x FROM users WHERE email_lc=$1', [email])).length) throw conflict('Este e-mail já está cadastrado');
    if ((await Q('SELECT 1 AS x FROM users WHERE username_lc=$1', [u.toLowerCase()])).length) throw conflict('Este nome de usuário já está em uso');
    const id = uid(), t = now();
    try { await Q(`INSERT INTO users(id,username,username_lc,email,email_lc,pass_hash,role,avatar,avatar_v,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'player',$7,$8,$9,$9)`, [id, u, u.toLowerCase(), email, email, await hashPw(pw), av, av ? 1 : 0, t]); }
    catch (e) { if (dupError(e)) throw conflict('E-mail ou nome de usuário já cadastrado'); throw e; }
    await startSession(req, res, id); return [201, { user: publicUser({ id, username: u, email, role: 'player', has_avatar: !!av, avatar_v: av ? 1 : 0 }) }];
  }
  if (m === 'POST' && P[0] === 'login') {
    const idf = normEmail(body.identifier || body.email); await hit('login:ip:' + ip, 40, 600e3); await hit('login:acct:' + idf, 8, 600e3);
    const r = (await Q('SELECT * FROM users WHERE email_lc=$1 OR (email_lc IS NULL AND username_lc=$1)', [idf]))[0];
    const chk = r ? await checkPw(String(body.password || ''), r.pass_hash) : (await checkPw(String(body.password || ''), await DUMMY), { ok: false });
    if (!r || !chk.ok) throw new HttpError(401, 'E-mail ou senha incorretos');
    if (chk.upgrade) await Q('UPDATE users SET pass_hash=$1 WHERE id=$2', [await hashPw(String(body.password)), r.id]);
    await Q('DELETE FROM rate_limits WHERE key=$1', ['login:acct:' + idf]); await startSession(req, res, r.id);
    return [200, { user: publicUser({ ...r, has_avatar: !!r.avatar }) }];
  }
  if (m === 'POST' && P[0] === 'logout') { const t = cookies(req).sid; if (t) await Q('DELETE FROM sessions WHERE token_hash=$1', [sha(t)]); setCookie(res, req, '', 0); return [200, {}]; }
  if (m === 'POST' && P[0] === 'password' && P[1] === 'forgot') {
    const email = normEmail(body.email); await hit('forgot:ip:' + ip, 5, 3600e3); await hit('forgot:mail:' + email, 3, 3600e3);
    const u = EMAIL.test(email) ? (await Q('SELECT id,username FROM users WHERE email_lc=$1', [email]))[0] : null;
    if (u && mail.enabled()) {
      const tok = crypto.randomBytes(32).toString('hex'); await Q('INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [sha(tok), u.id, now() + 3600e3]);
      const base = process.env.APP_URL || `${secure(req) ? 'https' : 'http'}://${req.headers.host}`;
      await mail.sendMail(email, 'Redefinição de senha', `Olá, ${u.username}.\n\nPara criar uma nova senha, abra o link (válido por 1 hora, uso único):\n${base}/#reset/${tok}\n\nSe não foi você, ignore este e-mail.`).catch(e => console.error(e.message));
    }
    return [200, { ok: true }]; // resposta idêntica exista ou não a conta
  }
  if (m === 'POST' && P[0] === 'password' && P[1] === 'reset') {
    await hit('reset:ip:' + ip, 10, 3600e3);
    const th = sha(String(body.token || '')), r = (await Q('SELECT * FROM password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at>$2', [th, now()]))[0]; if (!r) throw bad('Link inválido ou expirado');
    const u = (await Q('SELECT username,email_lc FROM users WHERE id=$1', [r.user_id]))[0]; checkPassword(body.password, u.username, u.email_lc);
    await db.tx(async q => { await q('UPDATE users SET pass_hash=$1, updated_at=$2 WHERE id=$3', [await hashPw(body.password), now(), r.user_id]); await q('UPDATE password_resets SET used_at=$1 WHERE token_hash=$2', [now(), th]); await q('DELETE FROM sessions WHERE user_id=$1', [r.user_id]); await q('DELETE FROM rate_limits WHERE key=$1', ['login:acct:' + u.email_lc]); });
    return [200, { ok: true }];
  }
  const user = await authUser(req, res); if (!user) throw new HttpError(401, 'Faça login');
  if (m === 'GET' && P[0] === 'me') return [200, { user }];

  // ----- perfil -----
  if (P[0] === 'profile') {
    if (m === 'PATCH' && P.length === 1) {
      const sets = [], p = [];
      if (body.username !== undefined) { const u = str(String(body.username).trim(), 24, 'usuário'); checkUsername(u); if ((await Q('SELECT 1 AS x FROM users WHERE username_lc=$1 AND id<>$2', [u.toLowerCase(), user.id])).length) throw conflict('Este nome de usuário já está em uso'); p.push(u, u.toLowerCase()); sets.push(`username=$${p.length - 1}`, `username_lc=$${p.length}`); }
      if (body.email !== undefined) {
        const e = normEmail(body.email); if (!EMAIL.test(e) || e.length > 254) throw bad('E-mail inválido');
        const cur = (await Q('SELECT pass_hash,email_lc FROM users WHERE id=$1', [user.id]))[0];
        if (cur.email_lc) { await hit('chg:' + user.id, 8, 600e3); if (!(await checkPw(String(body.current_password || ''), cur.pass_hash)).ok) throw forbid('Senha atual incorreta'); }
        if ((await Q('SELECT 1 AS x FROM users WHERE email_lc=$1 AND id<>$2', [e, user.id])).length) throw conflict('Este e-mail já está cadastrado'); p.push(e, e); sets.push(`email=$${p.length - 1}`, `email_lc=$${p.length}`);
      }
      if (!sets.length) throw bad('Nada para alterar'); p.push(now(), user.id);
      try { await Q(`UPDATE users SET ${sets.join(',')}, updated_at=$${p.length - 1} WHERE id=$${p.length}`, p); } catch (e) { if (dupError(e)) throw conflict('Nome de usuário ou e-mail já em uso'); throw e; }
      return [200, { user: publicUser({ ...(await Q('SELECT *, CASE WHEN avatar IS NULL THEN 0 ELSE 1 END AS has_avatar FROM users WHERE id=$1', [user.id]))[0] }) }];
    }
    if (m === 'PUT' && P[1] === 'avatar') { const img = image(body.image, 4e5, 'foto de perfil'); await Q('UPDATE users SET avatar=$1, avatar_v=avatar_v+1, updated_at=$2 WHERE id=$3', [img, now(), user.id]); return [200, {}]; }
    if (m === 'DELETE' && P[1] === 'avatar') { await Q('UPDATE users SET avatar=NULL, avatar_v=avatar_v+1, updated_at=$1 WHERE id=$2', [now(), user.id]); return [200, {}]; }
    if (m === 'POST' && P[1] === 'password') {
      await hit('chg:' + user.id, 8, 600e3); const cur = (await Q('SELECT * FROM users WHERE id=$1', [user.id]))[0];
      if (!(await checkPw(String(body.current_password || ''), cur.pass_hash)).ok) throw forbid('Senha atual incorreta'); checkPassword(body.new_password, cur.username, cur.email_lc);
      await Q('UPDATE users SET pass_hash=$1, updated_at=$2 WHERE id=$3', [await hashPw(body.new_password), now(), user.id]); await Q('DELETE FROM sessions WHERE user_id=$1', [user.id]); await startSession(req, res, user.id); return [200, {}];
    }
  }
  if (m === 'GET' && P[0] === 'avatar') {
    const r = (await Q('SELECT avatar FROM users WHERE id=$1', [P[1] || '']))[0]; if (!r || !r.avatar) throw nf(); const x = /^data:(image\/\w+);base64,(.*)$/.exec(r.avatar);
    return [200, Buffer.from(x[2], 'base64'), { raw: 1, headers: { 'Content-Type': x[1], 'Cache-Control': 'private, max-age=86400' } }];
  }
  if (m === 'GET' && P[0] === 'blob') { const b = await content.getBlob(P[1] || ''); return [200, b.bytes, { raw: 1, headers: { 'Content-Type': b.type, 'Cache-Control': 'private, max-age=31536000, immutable' } }]; }

  // ----- administração DEV (autorização SEMPRE conferida aqui, com o papel vindo do banco) -----
  if (P[0] === 'dev') {
    if (user.role !== 'dev') throw forbid('Acesso restrito à conta DEV');
    const a = user.id, sub = P[1], id = P[2];
    if (m === 'GET' && sub === 'panel.js') return [200, fs.readFileSync(path.join(__dirname, 'private', 'dev-panel.js')), { raw: 1, headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' } }];
    if (m === 'GET' && sub === 'content') return [200, { paths: await content.devContent(), aptitudes: await content.devAptitudes() }];
    const done = async r => { broadcastAll({ t: 'content' }); return [200, r]; };
    if (m === 'POST' && sub === 'paths' && !id) return [201, await content.createPath(a, body).then(async r => { broadcastAll({ t: 'content' }); return r; })];
    if (m === 'PATCH' && sub === 'paths') return done(await content.updatePath(a, id, body));
    if (m === 'POST' && sub === 'paths' && P[3] === 'status') return done(await content.setStatus(a, 'path', id, body.base_rev, body.status));
    if (m === 'POST' && sub === 'potions' && !id) return [201, await content.createPotion(a, body).then(async r => { broadcastAll({ t: 'content' }); return r; })];
    if (m === 'PATCH' && sub === 'potions') return done(await content.updatePotion(a, id, body));
    if (m === 'POST' && sub === 'potions' && P[3] === 'status') return done(await content.setStatus(a, 'potion', id, body.base_rev, body.status));
    if (m === 'POST' && sub === 'aptitudes' && !id) return [201, await content.createAptitude(a, body).then(async r => { broadcastAll({ t: 'content' }); return r; })];
    if (m === 'PATCH' && sub === 'aptitudes') return done(await content.updateAptitude(a, id, body));
    if (m === 'POST' && sub === 'aptitudes' && P[3] === 'status') return done(await content.setStatus(a, 'aptitude', id, body.base_rev, body.status));
    if (m === 'GET' && sub === 'history' && !id) return [200, { versions: await content.history(String(url.searchParams.get('type')), String(url.searchParams.get('id'))) }];
    if (m === 'GET' && sub === 'history') return [200, await content.getVersion(id)];
    if (m === 'POST' && sub === 'restore') return done(await content.restoreVersion(a, String(body.version_id || ''), body.base_rev));
    if (m === 'PUT' && sub === 'settings') return done(await content.setSetting(a, String(body.key || ''), body.value, body.base_rev));
    if (m === 'GET' && sub === 'backups' && !id) return [200, { backups: await content.listBackups() }];
    if (m === 'POST' && sub === 'backups') return [201, { id: await content.createBackup(a, String(body.reason || 'backup manual').slice(0, 200)) }];
    if (m === 'GET' && sub === 'backups') return [200, Buffer.from(await content.getBackup(id)), { raw: 1, headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="backup-${id.slice(0, 8)}.json"` } }];
    if (m === 'GET' && sub === 'integrity') { await content.check(); return [200, content.integrityState()]; }
    if (m === 'POST' && sub === 'integrity') return done(await content.acceptState(a));
    if (m === 'GET' && sub === 'log') return [200, { log: await Q('SELECT l.id,l.action,l.detail,l.created_at,u.username AS actor FROM admin_log l LEFT JOIN users u ON u.id=l.actor_id ORDER BY l.created_at DESC LIMIT 100') }];
    throw nf('Rota não encontrada');
  }

  // ----- eventos em tempo real -----
  if (m === 'GET' && P[0] === 'events') {
    const cid = url.searchParams.get('campaign') || ''; await needMember(cid, user.id);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.write('retry: 3000\n\n');
    const c = { res, uid: user.id }; if (!clients.has(cid)) clients.set(cid, new Set()); clients.get(cid).add(c);
    req.on('close', () => { const s = clients.get(cid); if (s) { s.delete(c); if (!s.size) clients.delete(cid); } }); return null;
  }

  // ----- campanhas -----
  if (P[0] === 'campaigns') {
    if (m === 'GET' && P.length === 1) {
      const rows = await Q(`SELECT c.id,c.name,m.role,c.join_code,(SELECT COUNT(*) FROM members x WHERE x.campaign_id=c.id) AS players FROM members m JOIN campaigns c ON c.id=m.campaign_id WHERE m.user_id=$1 ORDER BY c.created_at`, [user.id]);
      return [200, { campaigns: rows.map(r => ({ id: r.id, name: r.name, role: r.role, players: r.players, join_code: r.role === 'master' ? r.join_code : undefined })) }];
    }
    if (m === 'POST' && P.length === 1) {
      const name = str(String(body.name || '').trim(), 60, 'nome'); if (!name) throw bad('Informe o nome da campanha');
      if ((await Q(`SELECT COUNT(*) AS n FROM members WHERE user_id=$1 AND role='master'`, [user.id]))[0].n >= 30) throw bad('Limite de campanhas atingido');
      const id = uid(); let code; do { code = newCode(); } while ((await Q('SELECT 1 AS x FROM campaigns WHERE join_code=$1', [code])).length);
      await db.tx(async q => {
        await q('INSERT INTO campaigns(id,name,owner_id,join_code,allow_layers,potions,rev,created_at) VALUES($1,$2,$3,$4,0,$5,1,$6)', [id, name, user.id, code, '{}', now()]);
        await q(`INSERT INTO members(campaign_id,user_id,role,joined_at) VALUES($1,$2,'master',$3)`, [id, user.id, now()]);
      });
      return [201, { id }];
    }
    if (m === 'POST' && P[1] === 'join') {
      await hit('join:' + ip, 30, 600e3);
      const c = (await Q('SELECT id FROM campaigns WHERE join_code=$1', [String(body.code || '').trim().toUpperCase()]))[0]; if (!c) throw nf('Código de campanha inválido');
      if (!(await roleOf(c.id, user.id))) await Q(`INSERT INTO members(campaign_id,user_id,role,joined_at) VALUES($1,$2,'player',$3)`, [c.id, user.id, now()]);
      broadcast(c.id, { t: 'members' }); return [200, { id: c.id }];
    }
    const cid = P[1];
    if (m === 'GET' && P.length === 2) return [200, await campaignView(cid, user)];
    if (m === 'PATCH' && P.length === 2) {
      await needMaster(cid, user.id); const sets = [], p = [];
      if (body.name !== undefined) { const n = str(String(body.name).trim(), 60, 'nome'); if (!n) throw bad('Nome vazio'); p.push(n); sets.push(`name=$${p.length}`); }
      if (body.allow_layers !== undefined) { p.push(body.allow_layers ? 1 : 0); sets.push(`allow_layers=$${p.length}`); }
      if (!sets.length) throw bad('Nada para alterar'); p.push(cid);
      await Q(`UPDATE campaigns SET ${sets.join(',')}, rev=rev+1 WHERE id=$${p.length}`, p); broadcast(cid, { t: 'campaign' }); return [200, {}];
    }
    if (m === 'DELETE' && P.length === 2) { await needMaster(cid, user.id); await Q('DELETE FROM campaigns WHERE id=$1', [cid]); const s = clients.get(cid); if (s) for (const c of [...s]) kick(cid, c.uid); return [200, {}]; }
    if (m === 'PUT' && P[2] === 'potions') throw new HttpError(410, 'Poções agora são conteúdo global, gerenciado exclusivamente pela conta DEV.');
    if (m === 'DELETE' && P[2] === 'members') {
      const target = P[3], role = await needMember(cid, user.id);
      if (target !== user.id && role !== 'master') throw forbid();
      const tr = await roleOf(cid, target); if (!tr) throw nf(); if (tr === 'master') throw bad('O mestre não pode ser removido');
      await Q('DELETE FROM members WHERE campaign_id=$1 AND user_id=$2', [cid, target]); kick(cid, target); broadcast(cid, { t: 'members' }); return [200, {}];
    }
    if (m === 'POST' && P[2] === 'sheets') {
      const role = await needMember(cid, user.id); let owner = user.id;
      if (body.owner_id && body.owner_id !== user.id) { if (role !== 'master') throw forbid('Você só pode criar fichas para si mesmo'); if (!(await roleOf(cid, body.owner_id))) throw bad('O dono precisa participar da campanha'); owner = body.owner_id; }
      if ((await Q('SELECT COUNT(*) AS n FROM sheets WHERE campaign_id=$1', [cid]))[0].n >= 200) throw bad('Limite de fichas atingido');
      const data = body.data === undefined ? {} : cleanSheet(body.data), id = uid(), t = now();
      if (data.apt && !(await aptOk(Q, data.apt))) data.apt = '';
      await Q('INSERT INTO sheets(id,campaign_id,owner_id,data,rev,created_at,updated_at) VALUES($1,$2,$3,$4,1,$5,$5)', [id, cid, owner, JSON.stringify(data), t]);
      broadcast(cid, { t: 'sheets' }); return [201, { id }];
    }
  }

  // ----- itens de inventário (privados: dono da ficha e mestre) -----
  if (P[0] === 'items' && P[1]) {
    const iid = P[1];
    if (m === 'GET' && P[2] === 'image') {
      const { it } = await itemAccess(Q, iid, user); if (!it.image) throw nf(); const x = /^data:(image\/\w+);base64,(.*)$/.exec(it.image);
      return [200, Buffer.from(x[2], 'base64'), { raw: 1, headers: { 'Content-Type': x[1], 'Cache-Control': 'private, max-age=86400' } }];
    }
    if (m === 'PATCH' || m === 'DELETE') {
      const f = m === 'PATCH' ? itemFields(body, true) : null;
      const out = await db.tx(async q => {
        const { it, s } = await itemAccess(q, iid, user, db.fu);
        if (m === 'DELETE') await q('DELETE FROM sheet_items WHERE id=$1', [iid]);
        else { const keys = Object.keys(f); if (!keys.length) throw bad('Nada para alterar'); await q(`UPDATE sheet_items SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map(k => f[k]), now(), it.id]); }
        return { rev: await touchSheet(q, s), cid: s.campaign_id, sid: s.id, items: await itemsOf(q, s.id) };
      });
      broadcast(out.cid, { t: 'sheet', id: out.sid, rev: out.rev }); return [200, { rev: out.rev, items: out.items }];
    }
  }

  // ----- fichas -----
  if (P[0] === 'sheets' && P[1]) {
    const sid = P[1];
    if (m === 'GET' && P.length === 2) {
      const s = await getSheet(sid), role = await needMember(s.campaign_id, user.id), d = JSON.parse(s.data);
      const base = { id: s.id, campaign_id: s.campaign_id, owner_id: s.owner_id, rev: s.rev };
      if (role === 'master' || s.owner_id === user.id) return [200, { ...base, data: d, items: await itemsOf(Q, sid) }];
      return [200, { ...base, summaryOnly: true, summary: summary(d) }];
    }
    if (m === 'PATCH' && P.length === 2) {
      const patch = cleanSheet(obj(body.patch, 'patch')), out = await db.tx(async q => {
        const s = await getSheet(sid, q, db.fu), role = await needMember(s.campaign_id, user.id, q);
        if (role !== 'master' && s.owner_id !== user.id) throw forbid('Esta ficha pertence a outro jogador');
        if (patch.apt !== undefined && patch.apt !== (JSON.parse(s.data).apt || '') && !(await aptOk(q, patch.apt))) throw bad('Esta aptidão não está disponível');
        if (role !== 'master' && patch.camada !== undefined) { const c = (await q('SELECT allow_layers FROM campaigns WHERE id=$1', [s.campaign_id]))[0]; if (!c.allow_layers) throw forbid('O mestre não permitiu alterar as camadas'); }
        const data = { ...JSON.parse(s.data), ...patch }, rev = s.rev + 1;
        await q('UPDATE sheets SET data=$1, rev=$2, updated_at=$3 WHERE id=$4', [JSON.stringify(data), rev, now(), sid]); return { rev, cid: s.campaign_id };
      });
      broadcast(out.cid, { t: 'sheet', id: sid, rev: out.rev }); return [200, { rev: out.rev }];
    }
    if (m === 'POST' && P[2] === 'items') {
      const f = itemFields(body, false), id = uid(), out = await db.tx(async q => {
        const s = await getSheet(sid, q, db.fu), role = await needMember(s.campaign_id, user.id, q); if (role !== 'master' && s.owner_id !== user.id) throw forbid();
        if ((await q('SELECT COUNT(*) AS n FROM sheet_items WHERE sheet_id=$1', [sid]))[0].n >= 200) throw bad('Limite de itens atingido');
        const pos = (await q('SELECT COALESCE(MAX(position),0)+1 AS n FROM sheet_items WHERE sheet_id=$1', [sid]))[0].n, t = now();
        await q('INSERT INTO sheet_items(id,sheet_id,name,description,image,quantity,position,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)', [id, sid, f.name, f.description || '', f.image || '', f.quantity ?? 1, pos, t]);
        return { rev: await touchSheet(q, s), cid: s.campaign_id, items: await itemsOf(q, sid) };
      });
      broadcast(out.cid, { t: 'sheet', id: sid, rev: out.rev }); return [201, { id, rev: out.rev, items: out.items }];
    }
    if (m === 'DELETE' && P.length === 2) {
      const s = await getSheet(sid), role = await needMember(s.campaign_id, user.id);
      if (role !== 'master' && s.owner_id !== user.id) throw forbid();
      await Q('DELETE FROM sheets WHERE id=$1', [sid]); broadcast(s.campaign_id, { t: 'sheets' }); return [200, {}];
    }
    if (m === 'PATCH' && P[2] === 'owner') {
      const s = await getSheet(sid); await needMaster(s.campaign_id, user.id);
      if (!(await roleOf(s.campaign_id, String(body.owner_id || '')))) throw bad('O dono precisa participar da campanha');
      await Q('UPDATE sheets SET owner_id=$1, rev=rev+1 WHERE id=$2', [body.owner_id, sid]); broadcast(s.campaign_id, { t: 'sheets' }); return [200, {}];
    }
  }
  throw nf('Rota não encontrada');
}

function readBody(req, max = 6e6) {
  return new Promise((ok, no) => {
    let n = 0; const a = [];
    req.on('data', c => { n += c.length; if (n > max) { no(new HttpError(413, 'Requisição grande demais')); req.destroy(); return; } a.push(c); });
    req.on('end', () => { try { ok(a.length ? JSON.parse(Buffer.concat(a).toString()) : {}); } catch { no(bad('JSON inválido')); } });
    req.on('error', no);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
function serveStatic(res, pathname) {
  let p; try { p = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); } catch { res.writeHead(400); return res.end(); }
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
    const ext = path.extname(f); res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400' }); res.end(b);
  });
}
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('Content-Security-Policy', CSP);
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname.startsWith('/api/')) {
      const out = await api(req, res, url); if (out === null) return;
      if (out[2] && out[2].raw) { res.writeHead(out[0], out[2].headers); return res.end(out[1]); }
      res.writeHead(out[0], { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(out[1]));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(res, url.pathname);
  } catch (e) {
    const s = e.status || 500; if (s === 500) console.error(e);
    if (!res.headersSent) { res.writeHead(s, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: s === 500 ? 'Erro interno' : e.message })); } else res.end();
  }
});
(async () => {
  await require('./migrate').run();                 // esquema (com proteção de conteúdo)
  console.log('Semeadura inicial do conteúdo:', await content.seedIfEmpty());
  const ic = await content.check(); if (!ic.ok) console.error('\n⚠️  ' + content.integrityState().reason + '\n');
  console.log('Semeadura inicial das aptidões:', await content.seedAptitudes());
  await require('./admin').bootstrapDev();
  setInterval(() => Q('DELETE FROM sessions WHERE expires_at<$1', [now()]).then(() => Q('DELETE FROM rate_limits WHERE reset_at<$1', [now()])).catch(() => {}), 3600e3).unref();
  server.listen(process.env.PORT || 3000, () => console.log(`Servidor em http://localhost:${server.address().port} (${db.kind})`));
})().catch(e => { console.error(e.report || e); process.exit(1); });
