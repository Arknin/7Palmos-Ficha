'use strict';
const { spawn } = require('child_process'), assert = require('assert'), path = require('path'), os = require('os'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';
const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ficha-')), 'test.sqlite');
let ok = 0; const t = (name, cond) => { assert.ok(cond, 'FALHOU: ' + name); ok++; console.log('  ✓', name); };
async function start(file, env = {}) {
  const port = 4000 + Math.floor(Math.random() * 900);
  const proc = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'server.js')], { cwd: ROOT, env: { ...process.env, PORT: port, SQLITE_PATH: file, DATABASE_URL: '', NODE_ENV: 'test', MAIL_MODE: 'console', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; proc.stdout.on('data', d => out += d); proc.stderr.on('data', d => out += d);
  const B = `http://localhost:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(B + '/healthz'); break; } catch { await sleep(100); } if (proc.exitCode !== null) break; }
  return { B, proc, out: () => out, stop: async () => { proc.kill(); await sleep(250); } };
}
let ipn = 1;
class Cli {
  constructor(B) { this.B = B; this.c = ''; this.ip = '10.1.' + Math.floor(ipn / 250) + '.' + (ipn++ % 250); }
  async req(m, u, body) {
    const r = await fetch(this.B + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', 'X-Forwarded-For': this.ip, Cookie: this.c }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) this.c = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const ct = r.headers.get('content-type') || ''; let j = {}; if (ct.includes('json')) { try { j = await r.json(); } catch {} } else { j = Buffer.from(await r.arrayBuffer()); }
    return { s: r.status, j, ct };
  }
  async reg(email, username, pw = 'senha-forte-123', extra = {}) { return this.req('POST', '/api/register', { email, username, password: pw, ...extra }); }
  async login(email, pw = 'senha-forte-123') { return this.req('POST', '/api/login', { email, password: pw }); }
}
module.exports = { sleep, start, Cli, t, PNG, GIF, tmpDb, ROOT, count: () => ok };
