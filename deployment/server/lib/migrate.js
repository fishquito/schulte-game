'use strict';
/**
 * 旧版只有一个 data/scores.json，档案和所有游戏的成绩混在一个数组里。
 * 这里把它拆成 players.json + 每个游戏一个文件，拆完把旧文件改名留档（不删）。
 */
const fs   = require('node:fs');
const path = require('node:path');

function migrateLegacy(DATA_DIR, games, playersStore) {
  const legacy = path.join(DATA_DIR, 'scores.json');
  if (!fs.existsSync(legacy)) return null;

  let j = null;
  try { j = JSON.parse(fs.readFileSync(legacy, 'utf8')); } catch (e) { return null; }
  if (!j || !j.players || !Array.isArray(j.scores)) return null;

  // 已经有新数据了就不再动，避免手滑把新数据冲掉
  const busy = games.some(g => fs.existsSync(g.store.file)) || fs.existsSync(playersStore.file);
  if (busy) return { skipped: true, legacy };

  playersStore.data = { v: 1, players: j.players };
  playersStore.touch();

  const ids = new Set(games.map(g => g.mod.id));
  const bucket = {};
  for (const id of ids) bucket[id] = [];

  let dropped = 0;
  for (const r of j.scores) {
    if (!r) { dropped++; continue; }
    const gid = ids.has(r.game) ? r.game : 'schulte';        // 老记录没有 game 字段
    bucket[gid].push({
      id: r.id, mode: r.mode, size: r.size, rev: !!r.rev,
      t: r.t, s: r.s, at: r.at
    });
  }

  for (const g of games) {
    g.store.data = { v: 1, rows: bucket[g.mod.id] };
    g.store.touch();
  }

  const backup = legacy + '.migrated';
  try { fs.renameSync(legacy, backup); } catch (e) {}

  return {
    players: Object.keys(j.players).length,
    rows: j.scores.length - dropped,
    backup
  };
}

module.exports = { migrateLegacy };
