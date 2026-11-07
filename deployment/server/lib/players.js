'use strict';
/**
 * 档案：昵称 + 9 位档案号。
 * 这是四个游戏**共用**的东西 —— 一份档案走遍所有游戏，所以它不属于任何单个游戏。
 */
const crypto = require('node:crypto');

const ID_HEAD = '0123456789';
const ID_BODY = '23456789ABCDEFGHJKMNPQRSTVWXYZ';   // 去掉 0/1/I/L/O/U，避免手输看错
const ID_RE   = /^[0-9]{3}[A-Z0-9]{6}$/;

const now = () => new Date().toISOString();

function createPlayers(store) {
  const all = () => store.data.players;

  function newId() {
    let id;
    do {
      id = '';
      for (let i = 0; i < 3; i++) id += ID_HEAD[crypto.randomInt(ID_HEAD.length)];
      for (let i = 0; i < 6; i++) id += ID_BODY[crypto.randomInt(ID_BODY.length)];
    } while (all()[id]);
    return id;
  }

  function cleanName(v) {
    return String(v == null ? '' : v)
      .replace(/[\u0000-\u001f\u007f\u200b-\u200f]/g, '')
      .trim()
      .slice(0, 12);
  }

  return {
    newId,
    cleanName,
    isId: v => ID_RE.test(String(v || '').toUpperCase()),

    get: id => all()[id],
    nameOf: id => (all()[id] && all()[id].name) || '匿名',
    count: () => Object.keys(all()).length,

    create(id, name) {
      all()[id] = { name, created_at: now(), last_seen: now() };
      store.touch();
    },
    rename(id, name) {
      all()[id].name = name;
      store.touch();
    },
    touch(id) {
      if (all()[id]) all()[id].last_seen = now();
    }
  };
}

module.exports = { createPlayers };
