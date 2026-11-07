'use strict';
/**
 * 专注力训练馆 · 后端
 *
 * 这个文件只做三件事：起服务、托管静态文件、把身份接口挂上。
 * 具体每个游戏的榜单、校验、排序都在 games/<id>/index.js 里，
 * 各自的成绩存在 data/<id>.json —— 删掉一个游戏目录，它就下线了。
 *
 *   node server.js
 *   PORT=8090 HOST=127.0.0.1 ALLOW_ORIGIN=https://你的站点 node server.js
 *
 * 接口：
 *   POST  /api/register        {name}               建档案
 *   POST  /api/login           {id}                 用档案号换回档案
 *   PATCH /api/player          {id, name}           改昵称
 *   GET   /api/games                                游戏列表
 *   GET   /api/health                               自检
 *   GET   /api/<game>/scores   ?mode=&size=&rev=&limit=
 *   POST  /api/<game>/scores   {id, mode, size, rev, t, s}
 *   GET   /api/<game>/stats                         某个游戏的整体情况
 */

const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');

const { createStore }   = require('./lib/store');
const { createPlayers } = require('./lib/players');
const { loadGames }     = require('./games');
const { migrateLegacy } = require('./lib/migrate');
const H = require('./lib/http');

const PORT         = Number(process.env.PORT || 8090);
const HOST         = process.env.HOST || '127.0.0.1';
const DATA_FILE    = process.env.DATA_FILE || path.join(__dirname, 'data', 'scores.json');
const DATA_DIR     = process.env.DATA_DIR  || path.dirname(DATA_FILE);
const STATIC_DIR   = process.env.STATIC_DIR || path.resolve(__dirname, '..');
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

const now = () => new Date().toISOString();

/* ------------------------------------------------------------------ 装配 */

const playersStore = createStore(path.join(DATA_DIR, 'players.json'), { v: 1, players: {} });

const games = loadGames(path.join(__dirname, 'games')).map(mod => ({
  mod,
  store: createStore(path.join(DATA_DIR, mod.id + '.json'), { v: 1, rows: [] })
}));

const byId = new Map(games.map(g => [g.mod.id, g]));

playersStore.load();
for (const g of games) g.store.load();

const migrated = migrateLegacy(DATA_DIR, games, playersStore);
const players  = createPlayers(playersStore);

process.on('SIGINT',  () => { playersStore.save(); games.forEach(g => g.store.save()); process.exit(0); });
process.on('SIGTERM', () => { playersStore.save(); games.forEach(g => g.store.save()); process.exit(0); });

/* ------------------------------------------------------------------ 榜单 */

function boardOf(g, b) {
  return g.store.data.rows
    .filter(r => r.mode === b.mode && r.size === b.size && r.rev === b.rev)
    .sort(g.mod.cmp);
}

function trimBoard(g, b) {
  const max = g.mod.maxBoard || 200;
  const board = boardOf(g, b);
  if (board.length <= max) return;
  const drop = new Set(board.slice(max).map(r => r.id));
  // 只删这张榜里的行，别把同一玩家别的榜一起删掉
  g.store.data.rows = g.store.data.rows.filter(r =>
    !(r.mode === b.mode && r.size === b.size && r.rev === b.rev && drop.has(r.id)));
}

/* ------------------------------------------------------------------ 静态 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

function sendFile(res, file, st) {
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(file).pipe(res);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404');
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); return res.end('bad request'); }
  if (rel === '/' || rel === '') rel = '/index.html';

  const file = path.normalize(path.join(STATIC_DIR, rel));
  if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + path.sep)) {
    res.writeHead(403); return res.end('forbidden');
  }

  fs.stat(file, (err, st) => {
    // 目录 → 目录下的 index.html。/schulte/ 和 /schulte 都会落到这里
    if (!err && st.isDirectory()) {
      const idx = path.join(file, 'index.html');
      return fs.stat(idx, (e2, s2) => (e2 || !s2.isFile()) ? notFound(res) : sendFile(res, idx, s2));
    }
    if (err || !st.isFile()) return notFound(res);
    sendFile(res, file, st);
  });
}

/* ------------------------------------------------------------------ 接口 */

async function handleIdentity(p, req, res) {
  /* ---- 建档 ---- */
  if (p === '/api/register' && req.method === 'POST') {
    if (H.rateLimited(H.ipOf(req))) return H.send(res, 429, { error: 'too many requests' });
    try {
      const d = JSON.parse((await H.readBody(req, H.MAX_BODY)) || '{}');
      const name = players.cleanName(d.name);
      if (!name) return H.send(res, 400, { error: 'name required' });
      const id = players.newId();
      players.create(id, name);
      return H.send(res, 201, { id, name });
    } catch (e) {
      return H.send(res, 400, { error: 'bad request' });
    }
  }

  /* ---- 登录 ---- */
  if (p === '/api/login' && req.method === 'POST') {
    if (H.rateLimited(H.ipOf(req))) return H.send(res, 429, { error: 'too many requests' });
    try {
      const d = JSON.parse((await H.readBody(req, H.MAX_BODY)) || '{}');
      const id = String(d.id || '').toUpperCase();
      if (!players.isId(id)) return H.send(res, 400, { error: 'invalid id' });
      const pl = players.get(id);
      if (!pl) return H.send(res, 404, { error: 'not found' });
      players.touch(id); playersStore.touch();
      return H.send(res, 200, { id, name: pl.name });
    } catch (e) {
      return H.send(res, 400, { error: 'bad request' });
    }
  }

  /* ---- 改昵称 ---- */
  if (p === '/api/player' && req.method === 'PATCH') {
    try {
      const d = JSON.parse((await H.readBody(req, H.MAX_BODY)) || '{}');
      const id = String(d.id || '').toUpperCase();
      if (!players.isId(id) || !players.get(id)) return H.send(res, 404, { error: 'not found' });
      const name = players.cleanName(d.name);
      if (!name) return H.send(res, 400, { error: 'name required' });
      players.rename(id, name);
      players.touch(id); playersStore.touch();
      return H.send(res, 200, { id, name });
    } catch (e) {
      return H.send(res, 400, { error: 'bad request' });
    }
  }

  /* ---- 游戏列表 ---- */
  if (p === '/api/games' && req.method === 'GET') {
    return H.send(res, 200, {
      games: games.map(g => ({
        id: g.mod.id,
        label: g.mod.label,
        desc: g.mod.desc,
        variants: g.mod.variants,
        rows: g.store.data.rows.length
      }))
    });
  }

  /* ---- 自检 ---- */
  if (p === '/api/health' && req.method === 'GET') {
    return H.send(res, 200, {
      ok: true,
      players: players.count(),
      games: games.map(g => ({ id: g.mod.id, rows: g.store.data.rows.length }))
    });
  }

  return false;
}

async function handleGame(g, kind, req, res, url) {
  const mod = g.mod;

  /* ---- 榜单 ---- */
  if (kind === 'scores' && req.method === 'GET') {
    const b = mod.parseBoard(Object.fromEntries(url.searchParams));
    if (b.error) return H.send(res, 400, { error: b.error });

    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
    const items = boardOf(g, b).slice(0, limit).map(r => ({
      id: r.id, name: players.nameOf(r.id), t: r.t, s: r.s, created_at: r.at
    }));
    return H.send(res, 200, { items });
  }

  /* ---- 提交成绩 ---- */
  if (kind === 'scores' && req.method === 'POST') {
    if (H.rateLimited(H.ipOf(req))) return H.send(res, 429, { error: 'too many requests' });
    try {
      const d = JSON.parse((await H.readBody(req, H.MAX_BODY)) || '{}');
      const id = String(d.id || '').toUpperCase();
      if (!players.get(id)) return H.send(res, 401, { error: 'unknown id' });

      const b = mod.parseBoard(d);
      if (b.error) return H.send(res, 400, { error: b.error });

      const sc = mod.parseScore(d.t, d.s);
      if (sc.error) return H.send(res, 400, { error: sc.error });

      const cand = { t: Math.round(sc.t * 100) / 100, s: sc.s };
      const rows = g.store.data.rows;
      const idx = rows.findIndex(r =>
        r.id === id && r.mode === b.mode && r.size === b.size && r.rev === b.rev);

      let improved = false;
      if (idx === -1) {
        rows.push({ id, mode: b.mode, size: b.size, rev: b.rev, t: cand.t, s: cand.s, at: now() });
        improved = true;
      } else if (mod.cmp(cand, rows[idx]) < 0) {
        Object.assign(rows[idx], cand, { at: now() });
        improved = true;
      }

      players.touch(id);
      trimBoard(g, b);
      g.store.touch();

      const board = boardOf(g, b);
      const rank = board.findIndex(r => r.id === id) + 1;
      const mine = board.find(r => r.id === id);
      return H.send(res, 201, {
        ok: true,
        rank,
        improved,
        best: mine ? { t: mine.t, s: mine.s } : null
      });
    } catch (e) {
      return H.send(res, 400, { error: 'bad request' });
    }
  }

  /* ---- 这个游戏的整体情况（大厅卡片用） ---- */
  if (kind === 'stats' && req.method === 'GET') {
    const rows = g.store.data.rows;
    const who = new Set(rows.map(r => r.id)).size;
    let top = null;
    for (const r of rows) if (!top || mod.cmp(r, top) < 0) top = r;

    return H.send(res, 200, {
      game: mod.id,
      players: who,
      runs: rows.length,
      top: top ? { score: top.s, t: top.t, name: players.nameOf(top.id) } : null
    });
  }

  return false;
}

/* ------------------------------------------------------------------ 服务 */

const server = http.createServer(async (req, res) => {
  H.cors(res, ALLOW_ORIGIN);
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // /api/<game>/<scores|stats>
  const m = p.match(/^\/api\/([a-z0-9_-]+)\/(scores|stats)$/);
  if (m) {
    const g = byId.get(m[1]);
    if (!g) return H.send(res, 404, { error: 'unknown game' });
    const done = await handleGame(g, m[2], req, res, url);
    if (done !== false) return;
    return H.send(res, 405, { error: 'method not allowed' });
  }

  const done = await handleIdentity(p, req, res);
  if (done !== false) return;

  if (p.startsWith('/api/')) return H.send(res, 404, { error: 'not found' });

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, p);
});

server.listen(PORT, HOST, () => {
  console.log(`专注力训练馆后端已启动: http://${HOST}:${PORT}`);
  console.log(`  静态目录: ${STATIC_DIR}`);
  console.log(`  数据目录: ${DATA_DIR}`);
  console.log(`  档案: ${players.count()} 位`);
  for (const g of games) {
    console.log(`  ${g.mod.id.padEnd(8)} ${String(g.store.data.rows.length).padStart(6)} 条  ${g.mod.label}`);
  }
  if (migrated && !migrated.skipped) {
    console.log(`  ✓ 已把旧的 scores.json 拆成每游戏一个文件（${migrated.rows} 条成绩 / ${migrated.players} 位档案）`);
    console.log(`    旧文件保留为 ${path.basename(migrated.backup)}`);
  }
  console.log(`  允许来源: ${ALLOW_ORIGIN}`);
});
