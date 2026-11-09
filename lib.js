'use strict';
// Utilitários e validação compartilhados (o servidor é a fonte da verdade).
const crypto = require('crypto');
class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
const bad = m => new HttpError(400, m), forbid = (m = 'Sem permissão') => new HttpError(403, m), nf = (m = 'Não encontrado') => new HttpError(404, m), conflict = m => new HttpError(409, m);
const now = () => Date.now(), uid = () => crypto.randomUUID(), sha = t => crypto.createHash('sha256').update(t).digest('hex');
const ATT = ['combate', 'fisico', 'agilidade', 'percepcao', 'inteligencia', 'vontade', 'carisma'];
const ID = /^[a-z0-9]{1,20}$/, IMG = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const str = (v, max, k) => { if (typeof v !== 'string' || v.length > max) throw bad('Campo inválido: ' + k); return v; };
const int = (v, a, b, k) => { if (!Number.isInteger(v) || v < a || v > b) throw bad('Campo inválido: ' + k); return v; };
const arr = (v, max, k) => { if (!Array.isArray(v) || v.length > max) throw bad('Campo inválido: ' + k); return v; };
const obj = (v, k) => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('Campo inválido: ' + k); return v; };
const image = (v, max, k) => { if (typeof v !== 'string' || v.length > max || !IMG.test(v)) throw bad('Imagem inválida ou grande demais: ' + k); return v; };

// ----- ficha do jogador -----
const V = {
  name: v => str(v, 80, 'name'), apt: v => str(v, 30, 'apt'), camada: v => int(v, 0, 9, 'camada'), free: v => !!v,
  attrs: v => { obj(v, 'attrs'); const o = {}; for (const k of ATT) o[k] = int(v[k], 0, 20, 'attrs'); return o; },
  skills: v => arr(v, 150, 'skills').map(s => { obj(s, 'skills'); if (!ATT.includes(s.a)) throw bad('Campo inválido: skills'); return { n: str(s.n, 60, 'skills'), a: s.a, sp: s.sp ? 1 : 0, l: int(s.l ?? 0, 0, 4, 'skills'), c: s.c ? 1 : 0 }; }),
  tals: v => arr(v, 60, 'tals').map(t => { obj(t, 'tals'); const o = { t: str(t.t ?? '', 100, 'tals'), d: str(t.d ?? '', 4000, 'tals') }; if (t.bon) o.bon = str(t.bon, 80, 'tals'); if (t.off) o.off = 1; return o; }),
  img: v => { if (v === '') return ''; return image(v, 1.5e6, 'img'); },
  path: v => { if (typeof v !== 'string' || !/^[a-z0-9]{0,20}$/.test(v)) throw bad('Campo inválido: path'); return v; },
  toff: v => { obj(v, 'toff'); const e = Object.entries(v); if (e.length > 80) throw bad('Campo inválido: toff'); return Object.fromEntries(e.map(([k, x]) => [str(k, 60, 'toff'), !!x])); },
  ten: v => int(v, 0, 5, 'ten'), sn: v => int(v, 0, 5, 'sn'),
};
const cleanSheet = d => { obj(d, 'dados'); const o = {}; for (const k of Object.keys(V)) if (d[k] !== undefined) o[k] = V[k](d[k]); return o; };

// ----- conteúdo global: dados de uma poção -----
function cleanLayerData(d) {
  obj(d, 'data'); const y = { bon: str(String(d.bon || ''), 300, 'bon') };
  for (const k of ['ch', 'hab', 'mel']) {
    y[k] = arr(Array.isArray(d[k]) ? d[k] : [], 60, k).map(it => {
      obj(it, k); const o = { t: str(String(it.t || ''), 120, k), d: str(String(it.d || ''), 5000, k), h: str(String(it.h || ''), 10000, k), bon: str(String(it.bon || ''), 80, k) };
      if (it.hoff) o.hoff = 1; return o;
    });
  }
  return y;
}
module.exports = { HttpError, bad, forbid, nf, conflict, now, uid, sha, ATT, ID, IMG, str, int, arr, obj, image, cleanSheet, cleanLayerData };
