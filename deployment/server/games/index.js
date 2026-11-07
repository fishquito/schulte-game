'use strict';
/**
 * 游戏注册表：扫 games 下每个子目录的 index.js，谁在里面谁就上线。
 * 加一个游戏 = 加一个目录，不用动 server.js。
 */
const fs   = require('node:fs');
const path = require('node:path');

function loadGames(dir) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return out; }

  for (const name of names) {
    const file = path.join(dir, name, 'index.js');
    if (!fs.existsSync(file)) continue;          // 跳过 games/index.js 自己

    let mod;
    try {
      mod = require(file);
    } catch (e) {
      console.error('[games] 加载失败 ' + name + ':', e.message);
      continue;
    }
    if (!mod || !mod.id) { console.error('[games] ' + name + ' 缺少 id，跳过'); continue; }
    if (typeof mod.parseBoard !== 'function' || typeof mod.parseScore !== 'function' || typeof mod.cmp !== 'function') {
      console.error('[games] ' + name + ' 缺少 parseBoard / parseScore / cmp，跳过');
      continue;
    }
    out.push(mod);
  }

  out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return out;
}

module.exports = { loadGames };
