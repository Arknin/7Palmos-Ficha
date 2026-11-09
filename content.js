'use strict';
// ÚNICO módulo autorizado a escrever no conteúdo global (caminhos, poções, imagens, configurações, versões).
// Toda escrita: transação + comparação de revisão (sem sobrescrita silenciosa) + versão no histórico + checksum de integridade.
// `npm run safety` falha se qualquer outro arquivo tentar escrever nessas tabelas.
const fs = require('fs'), path = require('path'), db = require('./db');
const { bad, nf, conflict, HttpError, now, uid, sha, str, int, image, cleanLayerData } = require('./lib');
const Q = (s, p) => db.query(s, p);
const T = { path: 'paths', potion: 'potions' };
const SETTINGS = { game_title: 80, game_description: 2000 };
const DEFAULTS = { game_title: 'Ficha Virtual', game_description: '' };
const state = { protected: false, reason: '' };
const PROTECTED_MSG = 'PROTEÇÃO ATIVA: o conteúdo global no banco foi alterado fora dos mecanismos administrativos da aplicação (SQL direto, script, migration ou deploy). Edições foram bloqueadas para não sobrescrever dados. Um DEV deve revisar o conteúdo e usar "Aceitar estado atual" (ou restaurar um backup).';

// ---------- integridade ----------
async function checksum(q) {
  const P = await q('SELECT id,slug,name,description,image,position,status,rev FROM paths ORDER BY id');
  const O = await q('SELECT id,path_id,layer,name,description,image,data,status,rev FROM potions ORDER BY id');
  const G = await q('SELECT key,value,rev FROM game_settings ORDER BY key');
  return sha(JSON.stringify([P, O, G]));
}
const setSum = (q, v) => q('INSERT INTO app_meta(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value', ['content_checksum', v]);
const getSum = async q => ((await q('SELECT value FROM app_meta WHERE key=$1', ['content_checksum']))[0] || {}).value;
async function check() {
  const cur = await checksum(Q), saved = await getSum(Q);
  if (!saved) { await setSum(Q, cur); state.protected = false; return { ok: true, adopted: true }; }
  state.protected = saved !== cur; state.reason = state.protected ? PROTECTED_MSG : '';
  return { ok: !state.protected };
}
const integrityState = () => ({ ...state });
async function logAdmin(q, actor, action, detail) { await q('INSERT INTO admin_log(id,actor_id,action,detail,created_at) VALUES($1,$2,$3,$4,$5)', [uid(), actor, action, JSON.stringify(detail), now()]); }

async function mutate(actor, fn) {
  return db.tx(async q => {
    const saved = await getSum(q);
    if (saved && saved !== await checksum(q)) { state.protected = true; state.reason = PROTECTED_MSG; throw new HttpError(423, PROTECTED_MSG); }
    const res = await fn(q);
    await setSum(q, await checksum(q));
    return res;
  });
}
async function ver(q, type, id, action, snap, actor, note = '') {
  const v = (await q('SELECT COALESCE(MAX(version),0)+1 AS n FROM content_versions WHERE entity_type=$1 AND entity_id=$2', [type, id]))[0].n;
  await q('INSERT INTO content_versions(id,entity_type,entity_id,version,action,snapshot,actor_id,note,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [uid(), type, id, v, action, JSON.stringify(snap), actor, note, now()]);
}
async function putBlob(q, dataUrl) {
  if (!dataUrl) return '';
  image(dataUrl, 4e5, 'imagem'); const h = sha(dataUrl);
  await q('INSERT INTO content_blobs(hash,data,created_at) VALUES($1,$2,$3) ON CONFLICT(hash) DO NOTHING', [h, dataUrl, now()]);
  return h;
}
async function edit(q, actor, type, id, baseRev, changes, action, note = '') {
  if (!Number.isInteger(baseRev)) throw bad('base_rev é obrigatório');
  const tb = T[type], cur = (await q(`SELECT * FROM ${tb} WHERE id=$1`, [id]))[0]; if (!cur) throw nf();
  if (cur.rev !== baseRev) throw conflict('Este conteúdo foi alterado por outra pessoa. Recarregue antes de salvar.');
  const keys = Object.keys(changes), n = keys.length; if (!n) throw bad('Nada para alterar');
  const vals = keys.map(k => changes[k]).concat([now(), actor, id, baseRev]);
  const r = await q(`UPDATE ${tb} SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')}, rev=rev+1, updated_at=$${n + 1}, updated_by=$${n + 2} WHERE id=$${n + 3} AND rev=$${n + 4} RETURNING *`, vals);
  if (!r[0]) throw conflict('Conflito de edição simultânea. Recarregue.');
  await ver(q, type, id, action, r[0], actor, note); return r[0];
}
const slugify = n => (n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14)) || 'caminho';
async function freeSlug(q, name) { const base = slugify(name); let s = base; while ((await q('SELECT 1 AS x FROM paths WHERE slug=$1', [s])).length) s = base + Math.floor(Math.random() * 1e5); return s.slice(0, 20); }

// ---------- caminhos ----------
const pathFields = async (q, b, partial) => {
  const o = {};
  if (!partial || b.name !== undefined) { o.name = str(String(b.name || '').trim(), 60, 'nome'); if (!o.name) throw bad('Informe o nome'); }
  if (!partial || b.description !== undefined) o.description = str(String(b.description || ''), 4000, 'descrição');
  if (b.image !== undefined) o.image = b.image === '' ? '' : await putBlob(q, b.image);
  return o;
};
const createPath = (actor, b) => mutate(actor, async q => {
  const f = await pathFields(q, b, false), id = uid(), slug = await freeSlug(q, f.name), pos = (await q('SELECT COALESCE(MAX(position),0)+1 AS n FROM paths'))[0].n, t = now();
  await q('INSERT INTO paths(id,slug,name,description,image,position,status,rev,created_at,updated_at,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$8,$9,$9)', [id, slug, f.name, f.description, f.image || '', pos, 'active', t, actor]);
  await ver(q, 'path', id, 'create', (await q('SELECT * FROM paths WHERE id=$1', [id]))[0], actor); return { id, slug };
});
const updatePath = (actor, id, b) => mutate(actor, async q => { const r = await edit(q, actor, 'path', id, b.base_rev, await pathFields(q, b, true), 'update'); return { rev: r.rev }; });

// ---------- poções ----------
const potionFields = async (q, b, partial) => {
  const o = {};
  if (!partial || b.name !== undefined) { o.name = str(String(b.name || '').trim(), 80, 'nome'); if (!o.name) throw bad('Informe o nome'); }
  if (!partial || b.description !== undefined) o.description = str(String(b.description || ''), 5000, 'descrição');
  if (b.image !== undefined) o.image = b.image === '' ? '' : await putBlob(q, b.image);
  if (!partial || b.data !== undefined) o.data = JSON.stringify(cleanLayerData(b.data || {}));
  return o;
};
const layerBusy = async (q, pathId, layer, exceptId) => (await q(`SELECT id FROM potions WHERE path_id=$1 AND layer=$2 AND status<>'deleted' AND id<>$3`, [pathId, layer, exceptId || '']))[0];
const createPotion = (actor, b) => mutate(actor, async q => {
  const p = (await q('SELECT id,status FROM paths WHERE id=$1', [String(b.path_id || '')]))[0]; if (!p || p.status === 'deleted') throw bad('Caminho inválido');
  const layer = int(b.layer, 0, 9, 'camada'); if (await layerBusy(q, p.id, layer)) throw conflict('Esta camada já possui uma poção neste caminho');
  const f = await potionFields(q, b, false), id = uid(), t = now();
  await q('INSERT INTO potions(id,path_id,layer,name,description,image,data,status,rev,created_at,updated_at,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9,$10,$10)', [id, p.id, layer, f.name, f.description, f.image || '', f.data, 'active', t, actor]);
  await ver(q, 'potion', id, 'create', (await q('SELECT * FROM potions WHERE id=$1', [id]))[0], actor); return { id };
});
const updatePotion = (actor, id, b) => mutate(actor, async q => { const r = await edit(q, actor, 'potion', id, b.base_rev, await potionFields(q, b, true), 'update'); return { rev: r.rev }; });

// ---------- ocultar / reexibir / excluir (exclusão lógica) ----------
const FLOW = { active: { hidden: 'hide', deleted: 'delete' }, hidden: { active: 'show', deleted: 'delete' }, deleted: { hidden: 'restore' } };
const setStatus = (actor, type, id, baseRev, status) => mutate(actor, async q => {
  const cur = (await q(`SELECT * FROM ${T[type]} WHERE id=$1`, [id]))[0]; if (!cur) throw nf();
  const action = (FLOW[cur.status] || {})[status]; if (!action) throw bad(`Transição inválida: ${cur.status} → ${status}`);
  if (type === 'potion' && cur.status === 'deleted' && await layerBusy(q, cur.path_id, cur.layer, id)) throw conflict('Esta camada já foi ocupada por outra poção');
  const r = await edit(q, actor, type, id, baseRev, { status }, action); return { rev: r.rev, status: r.status };
});

// ---------- histórico e restauração ----------
const history = async (type, id) => Q('SELECT v.id,v.version,v.action,v.note,v.created_at,u.username AS actor FROM content_versions v LEFT JOIN users u ON u.id=v.actor_id WHERE v.entity_type=$1 AND v.entity_id=$2 ORDER BY v.version DESC LIMIT 200', [type, id]);
const getVersion = async vid => { const r = (await Q('SELECT * FROM content_versions WHERE id=$1', [vid]))[0]; if (!r) throw nf(); return { ...r, snapshot: JSON.parse(r.snapshot) }; };
const restoreVersion = (actor, vid, baseRev) => mutate(actor, async q => {
  const v = (await q('SELECT * FROM content_versions WHERE id=$1', [vid]))[0]; if (!v) throw nf(); const s = JSON.parse(v.snapshot);
  if (v.entity_type === 'setting') return setSettingTx(q, actor, s.key, s.value, baseRev, 'restore', `restaurado da versão ${v.version}`);
  const ch = v.entity_type === 'path' ? { name: s.name, description: s.description, image: s.image, position: s.position, status: s.status } : { name: s.name, description: s.description, image: s.image, data: s.data, status: s.status };
  if (v.entity_type === 'potion' && s.status !== 'deleted' && await layerBusy(q, s.path_id, s.layer, v.entity_id)) throw conflict('A camada desta poção está ocupada');
  const r = await edit(q, actor, v.entity_type, v.entity_id, baseRev, ch, 'restore', `restaurado da versão ${v.version}`); return { rev: r.rev };
});

// ---------- configurações globais ----------
async function getSettings() { const o = { ...DEFAULTS }, rev = {}; for (const r of await Q('SELECT key,value,rev FROM game_settings')) { o[r.key] = JSON.parse(r.value); rev[r.key] = r.rev; } return { values: o, rev }; }
async function setSettingTx(q, actor, key, value, baseRev, action = 'update', note = '') {
  if (!(key in SETTINGS)) throw bad('Configuração desconhecida'); const v = str(String(value ?? ''), SETTINGS[key], key); if (key === 'game_title' && !v.trim()) throw bad('Título vazio');
  const cur = (await q('SELECT rev FROM game_settings WHERE key=$1', [key]))[0], rev = cur ? cur.rev : 0;
  if (rev !== baseRev) throw conflict('Esta configuração foi alterada por outra pessoa. Recarregue.');
  await q('INSERT INTO game_settings(key,value,rev,updated_at,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(key) DO UPDATE SET value=excluded.value, rev=excluded.rev, updated_at=excluded.updated_at, updated_by=excluded.updated_by', [key, JSON.stringify(v), rev + 1, now(), actor]);
  await ver(q, 'setting', key, action, { key, value: v }, actor, note); return { rev: rev + 1 };
}
const setSetting = (actor, key, value, baseRev) => mutate(actor, q => setSettingTx(q, actor, key, value, baseRev));

// ---------- leitura ----------
const blobUrl = h => (h ? '/api/blob/' + h : '');
// Visão para jogadores: só o que está ATIVO; textos ocultos desativados nunca saem do servidor.
async function clientContent({ minLayer = 0 } = {}) {
  const paths = await Q(`SELECT * FROM paths WHERE status='active' ORDER BY position,created_at`), potions = await Q(`SELECT * FROM potions WHERE status='active' ORDER BY layer DESC`);
  const out = { order: [], paths: {}, pimgs: {}, pd: {} }, byId = {};
  for (const p of paths) { byId[p.id] = p; out.order.push(p.slug); out.paths[p.slug] = { name: p.name, description: p.description }; if (p.image) out.pimgs[p.slug] = blobUrl(p.image); out.pd[p.slug] = {}; }
  for (const t of potions) {
    const p = byId[t.path_id]; if (!p || t.layer < minLayer) continue; const d = JSON.parse(t.data || '{}');
    const y = { id: t.id, n: t.name, d: t.description, bon: d.bon || '' }; if (t.image) y.img = blobUrl(t.image);
    for (const k of ['ch', 'hab', 'mel']) y[k] = (d[k] || []).map(it => { const o = { ...it }; if (o.hoff) delete o.h; return o; });
    out.pd[p.slug][t.layer] = y;
  }
  return out;
}
async function devContent() {
  const paths = await Q(`SELECT * FROM paths WHERE 1=1 ORDER BY position,created_at`), potions = await Q('SELECT * FROM potions ORDER BY layer DESC,created_at');
  return paths.map(p => ({ id: p.id, slug: p.slug, name: p.name, description: p.description, image: blobUrl(p.image), position: p.position, status: p.status, rev: p.rev, updated_at: p.updated_at,
    potions: potions.filter(t => t.path_id === p.id).map(t => ({ id: t.id, layer: t.layer, name: t.name, description: t.description, image: blobUrl(t.image), data: JSON.parse(t.data || '{}'), status: t.status, rev: t.rev, updated_at: t.updated_at })) }));
}
async function getBlob(hash) { const r = (await Q('SELECT data FROM content_blobs WHERE hash=$1', [hash]))[0]; if (!r) throw nf(); const m = /^data:(image\/\w+);base64,(.*)$/.exec(r.data); return { type: m[1], bytes: Buffer.from(m[2], 'base64') }; }

// ---------- backups ----------
async function createBackup(actor, reason) {
  const data = { version: 1, created_at: now(), paths: await Q('SELECT * FROM paths'), potions: await Q('SELECT * FROM potions'), settings: await Q('SELECT * FROM game_settings'), versions: await Q('SELECT * FROM content_versions ORDER BY created_at'), blobs: await Q('SELECT * FROM content_blobs') };
  const id = uid(); await Q('INSERT INTO content_backups(id,reason,actor_id,data,created_at) VALUES($1,$2,$3,$4,$5)', [id, reason, actor, JSON.stringify(data), now()]);
  await Q('DELETE FROM content_backups WHERE id NOT IN (SELECT id FROM content_backups ORDER BY created_at DESC LIMIT 20)'); return id;
}
const listBackups = () => Q('SELECT b.id,b.reason,b.created_at,u.username AS actor FROM content_backups b LEFT JOIN users u ON u.id=b.actor_id ORDER BY b.created_at DESC');
const getBackup = async id => { const r = (await Q('SELECT data FROM content_backups WHERE id=$1', [id]))[0]; if (!r) throw nf(); return r.data; };
async function acceptState(actor) {
  await createBackup(actor, 'antes de aceitar o estado atual do conteúdo');
  return db.tx(async q => { const cur = await checksum(q); await setSum(q, cur); await logAdmin(q, actor, 'integrity.accept', { checksum: cur }); state.protected = false; state.reason = ''; return { checksum: cur }; });
}

// ---------- seed inicial (NUNCA sobrescreve) ----------
async function seedIfEmpty() {
  if (process.env.SEED_CONTENT === 'false') return 'desativado';
  return db.tx(async q => {
    if ((await q('SELECT value FROM app_meta WHERE key=$1', ['content_seeded']))[0]) return 'ja-semeado';
    if ((await q('SELECT COUNT(*) AS n FROM paths'))[0].n > 0) { await q('INSERT INTO app_meta(key,value) VALUES($1,$2)', ['content_seeded', 'existing']); return 'conteudo-existente'; }
    const dir = path.join(__dirname, 'seed'), seed = JSON.parse(fs.readFileSync(path.join(dir, 'content.json'), 'utf8')); let pos = 0;
    for (const p of seed.paths) {
      const id = uid(), t = now(); let img = ''; const f = path.join(dir, 'img', p.image || '');
      if (p.image && fs.existsSync(f)) img = await putBlob(q, 'data:image/webp;base64,' + fs.readFileSync(f).toString('base64'));
      await q('INSERT INTO paths(id,slug,name,description,image,position,status,rev,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$8)', [id, p.slug, p.name, '', img, ++pos, 'active', t]);
      await ver(q, 'path', id, 'create', (await q('SELECT * FROM paths WHERE id=$1', [id]))[0], null, 'seed inicial');
      for (const o of p.potions) {
        const pid = uid(); await q('INSERT INTO potions(id,path_id,layer,name,description,image,data,status,rev,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9)', [pid, id, o.layer, o.name, '', '', JSON.stringify(cleanLayerData(o.data)), 'active', t]);
        await ver(q, 'potion', pid, 'create', (await q('SELECT * FROM potions WHERE id=$1', [pid]))[0], null, 'seed inicial');
      }
    }
    await q('INSERT INTO app_meta(key,value) VALUES($1,$2)', ['content_seeded', String(now())]); await setSum(q, await checksum(q)); return 'semeado';
  });
}
module.exports = { check, integrityState, mutate, createPath, updatePath, createPotion, updatePotion, setStatus, history, getVersion, restoreVersion, getSettings, setSetting, clientContent, devContent, getBlob, createBackup, listBackups, getBackup, acceptState, seedIfEmpty, logAdmin };
