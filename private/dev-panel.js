/* Painel DEV — entregue SOMENTE pelo endpoint /api/dev/panel.js (exige conta DEV validada no servidor).
   Todas as operações passam por /api/dev/*, que reconferem o papel no banco a cada requisição. */
(function () {
  const DV = { view: 'home', path: null, potion: null, hist: null, paths: [], integ: {}, settings: {}, backups: [], log: [] };
  const btn = (label, fn, cls = 'btn') => { const b = mk('button', cls, esc(label)); b.onclick = fn; return b; };
  const BADGE = { active: ['ATIVO', '#2f7d4f'], hidden: ['OCULTO', '#8a6d1f'], deleted: ['EXCLUÍDO', '#9a2f35'] };
  const badge = s => `<span class="tag" style="background:${BADGE[s][1]}">${BADGE[s][0]}</span>`;
  const when = t => new Date(t).toLocaleString('pt-BR');
  async function load() {
    const [c, i, s, b, l] = await Promise.all([api('GET', '/api/dev/content'), api('GET', '/api/dev/integrity'), api('GET', '/api/settings'), api('GET', '/api/dev/backups'), api('GET', '/api/dev/log')]);
    DV.paths = c.paths; DV.integ = i; DV.settings = s; DV.backups = b.backups; DV.log = l.log;
  }
  async function act(fn, ok) { try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message); } await load(); draw(); }
  const pathById = id => DV.paths.find(p => p.id === id);
  function imgField(cur, onSet) {
    const w = mk('div', 'imgf', ''), im = document.createElement('img'), f = document.createElement('input');
    im.className = 'limg'; im.alt = ''; if (cur) im.src = cur; im.hidden = !cur; f.type = 'file'; f.accept = 'image/*';
    f.onchange = e => readImg(e, d => { im.src = d; im.hidden = false; onSet(d); }, 480);
    w.append(im, f, btn('Remover imagem', () => { im.hidden = true; onSet(''); }, 'link')); return w;
  }
  const field = (label, el) => { const l = mk('label', 'fld', `<span>${esc(label)}</span>`); l.append(el); return l; };
  const input = (v, ph, max) => { const e = document.createElement('input'); e.value = v || ''; e.placeholder = ph || ''; e.maxLength = max || 200; return e; };
  const area = (v, ph, rows = 3) => { const e = document.createElement('textarea'); e.value = v || ''; e.placeholder = ph || ''; e.rows = rows; return e; };

  function pathsHome(b) {
    b.append(mk('h2', '', 'Caminhos'));
    const g = mk('div', 'paths', '');
    for (const p of DV.paths) {
      const n = p.potions.filter(x => x.status !== 'deleted').length;
      const c = mk('div', 'pc' + (p.status === 'deleted' ? ' off' : ''), `<div class="pi">${p.image ? `<img src="${p.image}" alt="">` : ''}</div><b>${esc(p.name)}</b>${badge(p.status)}<small>${n} poção(ões)</small>`);
      c.append(btn('Editar', () => { DV.view = 'path'; DV.path = p.id; draw(); }));
      c.append(...statusButtons('path', p));
      c.append(btn('Histórico', () => showHist('path', p.id, p.rev), 'link')); g.append(c);
    }
    b.append(g);
    const nm = input('', 'Nome do novo caminho', 60), ds = area('', 'Descrição (opcional)', 2); let im = '';
    const f = mk('div', 'cfg', ''); f.append(nm, ds, imgField('', d => im = d), btn('Criar caminho', () => act(async () => { await api('POST', '/api/dev/paths', { name: nm.value, description: ds.value, image: im || undefined }); }, 'Caminho criado')));
    b.append(mk('h2', '', 'Novo caminho'), f);
  }
  function statusButtons(type, x) {
    const url = `/api/dev/${type === 'path' ? 'paths' : 'potions'}/${x.id}/status`, go = (s, ask) => () => { if (!ask || confirm(ask)) act(() => api('POST', url, { base_rev: x.rev, status: s }), 'Status atualizado'); };
    if (x.status === 'active') return [btn('Ocultar', go('hidden'), 'link'), btn('Excluir', go('deleted', 'Excluir? O item é arquivado (exclusão lógica) e inventários antigos continuam íntegros.'), 'link')];
    if (x.status === 'hidden') return [btn('Reexibir', go('active'), 'link'), btn('Excluir', go('deleted', 'Excluir? O item é arquivado (exclusão lógica) e inventários antigos continuam íntegros.'), 'link')];
    return [btn('Restaurar (como oculto)', go('hidden'), 'link')];
  }
  function pathEditor(b) {
    const p = pathById(DV.path); if (!p) { DV.view = 'home'; return draw(); }
    b.append(btn('‹ Todos os caminhos', () => { DV.view = 'home'; draw(); }, 'nav'), mk('h2', '', `Caminho · ${esc(p.name)} ${badge(p.status)}`));
    const nm = input(p.name, '', 60), ds = area(p.description, '', 4); let im;
    const f = mk('div', 'cfg', ''); f.append(field('Nome', nm), field('Descrição', ds), imgField(p.image, d => im = d),
      btn('Salvar caminho', () => act(async () => { const body = { base_rev: p.rev, name: nm.value, description: ds.value }; if (im !== undefined) body.image = im; await api('PATCH', '/api/dev/paths/' + p.id, body); }, 'Caminho salvo')));
    b.append(f, mk('h2', '', 'Poções por camada'));
    for (let n = 9; n >= 0; n--) {
      const x = p.potions.find(o => o.layer === n && o.status !== 'deleted') || null, gone = p.potions.filter(o => o.layer === n && o.status === 'deleted');
      const r = mk('div', 'mrow', `<span><b>Camada ${n}</b> · ${x ? esc(x.name) + ' ' + badge(x.status) : '<i class="mut">vazia</i>'}</span>`);
      r.append(btn(x ? 'Editar' : 'Criar', () => { DV.view = 'potion'; DV.potion = { id: x && x.id, layer: n, path: p.id }; draw(); }, 'btn'));
      if (x) { r.append(...statusButtons('potion', x), btn('Histórico', () => showHist('potion', x.id, x.rev), 'link')); }
      b.append(r);
      for (const o of gone) { const rr = mk('div', 'mrow', `<span class="mut">&nbsp;&nbsp;↳ arquivada: ${esc(o.name)} ${badge('deleted')}</span>`); rr.append(...statusButtons('potion', o), btn('Histórico', () => showHist('potion', o.id, o.rev), 'link')); b.append(rr); }
    }
  }
  function potionEditor(b) {
    const p = pathById(DV.potion.path), cur = p.potions.find(o => o.id === DV.potion.id), layer = DV.potion.layer; let im;
    b.append(btn('‹ ' + esc(p.name), () => { DV.view = 'path'; draw(); }, 'nav'), mk('h2', '', `${cur ? 'Editar' : 'Nova'} poção · camada ${layer}`));
    const data = JSON.parse(JSON.stringify(cur ? cur.data : { bon: '', ch: [], hab: [], mel: [] })), nm = input(cur && cur.name, 'Nome da poção', 80), ds = area(cur && cur.description, 'Descrição', 4), bon = input(data.bon, 'Bônus da camada: Físico+2; Investigar+2; teste:Carisma+2; mestre:Demolição', 300);
    const f = mk('div', 'cfg', ''); f.append(field('Nome', nm), field('Descrição', ds), imgField(cur && cur.image, d => im = d), field('Bônus automáticos da camada', bon));
    for (const [k, label] of [['ch', 'Características'], ['hab', 'Novas Habilidades'], ['mel', 'Habilidades Melhoradas']]) {
      const box = mk('div', 'sec', `<h4>${label}</h4>`), list = mk('div', '', ''); box.append(list);
      const paint = () => { list.innerHTML = ''; data[k].forEach((it, i) => {
        const w = mk('div', 'it', ''), t = input(it.t, 'Título', 120), d = area(it.d, 'Descrição', 2), h = area(it.h, 'Texto oculto (um parágrafo por linha)', 2);
        t.oninput = () => it.t = t.value; d.oninput = () => it.d = d.value; h.oninput = () => it.h = h.value;
        const on = mk('label', 'tgl', `<input type="checkbox" ${it.hoff ? '' : 'checked'}> Texto oculto ativo`); on.firstChild.onchange = e => { it.hoff = e.target.checked ? 0 : 1; };
        const x = btn('×', () => { data[k].splice(i, 1); paint(); }, 'x'); w.append(t, x, d, on, h, bwidget(it.bon, v => it.bon = v)); list.append(w); }); };
      paint(); box.append(btn('Adicionar item', () => { data[k].push({ t: '', d: '', h: '', bon: '' }); paint(); })); f.append(box);
    }
    f.append(btn('Salvar poção', () => act(async () => {
      data.bon = bon.value; const body = { name: nm.value, description: ds.value, data };
      if (im !== undefined) body.image = im;
      if (cur) { body.base_rev = cur.rev; await api('PATCH', '/api/dev/potions/' + cur.id, body); }
      else { body.path_id = p.id; body.layer = layer; await api('POST', '/api/dev/potions', body); }
      DV.view = 'path';
    }, 'Poção salva')));
    b.append(f);
  }
  async function showHist(type, id, rev) { try { DV.hist = { type, id, rev, list: (await api('GET', `/api/dev/history?type=${type}&id=${encodeURIComponent(id)}`)).versions, view: null }; draw(); } catch (e) { toast(e.message); } }
  function histPanel(b) {
    const H = DV.hist; b.append(mk('h2', '', `Histórico de versões (${H.type})`)); b.append(btn('Fechar histórico', () => { DV.hist = null; draw(); }, 'link'));
    H.list.forEach(v => {
      const r = mk('div', 'mrow', `<span>v${v.version} · <b>${esc(v.action)}</b> · ${esc(v.actor || 'sistema')} · ${when(v.created_at)} <i class="mut">${esc(v.note)}</i></span>`);
      r.append(btn('Ver', async () => { H.view = (await api('GET', '/api/dev/history/' + v.id)).snapshot; draw(); }, 'link'),
        btn('Restaurar', () => { if (confirm('Restaurar esta versão? Uma nova versão será criada; o histórico é preservado.')) act(async () => { const cur = H.type === 'setting' ? (DV.settings.settings_rev[H.id] || 0) : H.rev; await api('POST', '/api/dev/restore', { version_id: v.id, base_rev: cur }); DV.hist = null; }, 'Versão restaurada'); }, 'link'));
      b.append(r);
    });
    if (H.view) { const pre = mk('pre', 'jsonbox', ''); pre.textContent = JSON.stringify(H.view, null, 2); b.append(pre); }
  }
  function settingsPanel(b) {
    b.append(mk('h2', '', 'Configurações globais'));
    const t = input(DV.settings.game_title, '', 80), d = area(DV.settings.game_description, '', 3), f = mk('div', 'cfg', '');
    f.append(field('Título do jogo', t), field('Descrição / boas-vindas', d), btn('Salvar configurações', () => act(async () => {
      const R = DV.settings.settings_rev || {};
      if (t.value !== DV.settings.game_title) await api('PUT', '/api/dev/settings', { key: 'game_title', value: t.value, base_rev: R.game_title || 0 });
      if (d.value !== DV.settings.game_description) await api('PUT', '/api/dev/settings', { key: 'game_description', value: d.value, base_rev: R.game_description || 0 });
    }, 'Configurações salvas')), btn('Histórico do título', () => showHist('setting', 'game_title', 0), 'link'));
    b.append(f);
  }
  function safetyPanel(b) {
    b.append(mk('h2', '', 'Backups e integridade'));
    b.append(mk('p', DV.integ.protected ? 'err' : 'mut', DV.integ.protected ? esc(DV.integ.reason) : 'Integridade: o conteúdo global está exatamente como a aplicação o deixou.'));
    if (DV.integ.protected) b.append(btn('Revisei — aceitar estado atual', () => { if (confirm('Aceitar o conteúdo atual do banco como oficial? Um backup é gravado antes.')) act(() => api('POST', '/api/dev/integrity', {}), 'Estado aceito'); }));
    b.append(btn('Criar backup agora', () => act(() => api('POST', '/api/dev/backups', { reason: 'backup manual' }), 'Backup criado')));
    DV.backups.forEach(k => { const r = mk('div', 'mrow', `<span>${when(k.created_at)} · ${esc(k.reason)} <i class="mut">${esc(k.actor || 'sistema')}</i></span>`); const a = mk('a', 'link', 'baixar'); a.href = '/api/dev/backups/' + k.id; r.append(a); b.append(r); });
    b.append(mk('h2', '', 'Registro administrativo'));
    DV.log.slice(0, 15).forEach(l => b.append(mk('div', 'mrow', `<span>${when(l.created_at)} · <b>${esc(l.action)}</b> · ${esc(l.actor || 'sistema')} <i class="mut">${esc(l.detail)}</i></span>`)));
  }
  function draw() {
    const v = $('v-app'); v.innerHTML = `<header><a class="nav" href="#camps">‹ Voltar</a><h2 style="margin:0;font-size:30px;flex:1">Painel DEV</h2><span class="tag">DEV</span></header><div class="rule"></div><div id="dv"></div>`;
    const b = v.querySelector('#dv'); if (DV.integ.protected && DV.view !== 'home') b.append(mk('p', 'err', esc(DV.integ.reason)));
    if (DV.view === 'home') { pathsHome(b); settingsPanel(b); safetyPanel(b); } else if (DV.view === 'path') pathEditor(b); else potionEditor(b);
    if (DV.hist) histPanel(b);
  }
  window.renderDev = async function () { DV.view = 'home'; DV.hist = null; $('v-app').innerHTML = '<p class="mut">Carregando…</p>'; await load(); draw(); };
  window.devRefresh = async function () { if (CUR === 'dev' && !document.activeElement.closest('#dv input,#dv textarea')) { await load(); draw(); } };
  const st = document.createElement('style'); st.textContent = '.fld{display:flex;flex-direction:column;gap:4px;width:100%}.fld span{color:var(--mut);font-size:13px}.cfg input,.cfg textarea{width:100%}.sec{width:100%;border-left:2px solid var(--gold);padding-left:12px}.imgf{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.limg{max-width:140px;max-height:140px;border-radius:6px}.jsonbox{background:var(--panel);padding:10px;overflow:auto;max-height:320px;font-size:12px}.cfg .it{background:var(--panel);padding:8px;margin:8px 0;border-radius:4px;position:relative}.cfg .it input,.cfg .it textarea{background:transparent;border:1px solid var(--line);padding:4px 8px;border-radius:3px;margin:3px 0;display:block}'; document.head.append(st);
})();
