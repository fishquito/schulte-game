'use strict';
/**
 * 一个 JSON 文件一个小库。
 * 写入是原子的：先写 .tmp，再 rename 覆盖 —— 断电也不会留下半个文件。
 */
const fs   = require('node:fs');
const path = require('node:path');

function createStore(file, initial) {
  const store = {
    file,
    data: clone(initial),
    dirty: false,
    writing: false
  };

  store.load = function () {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j && typeof j === 'object') {
        store.data = j;
        return store.data;
      }
    } catch (e) { /* 文件不存在 / 内容坏了 → 用空库 */ }
    store.data = clone(initial);
    return store.data;
  };

  store.save = function () {
    if (!store.dirty) return;
    store.dirty = false;
    store.writing = true;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(store.data));
      fs.renameSync(tmp, file);
    } catch (e) {
      console.error('[store] 写入失败 ' + file + ':', e.message);
      store.dirty = true;
    }
    store.writing = false;
    if (store.dirty) setTimeout(store.save, 500);
  };

  store.touch = function () {
    store.dirty = true;
    if (!store.writing) store.save();
  };

  return store;
}

const clone = v => JSON.parse(JSON.stringify(v));

module.exports = { createStore };
