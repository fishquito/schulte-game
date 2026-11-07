'use strict';
/**
 * N-back · 后端
 * 变体：1 / 2 / 3-back
 * 排序：答对越多越好，同分看谁平均反应更快
 * 数据：data/nback.json
 */

const SIZES = [1, 2, 3];

module.exports = {
  id: 'nback',
  label: 'N-back',
  desc: '判断当前和 n 步前是否相同，练工作记忆',

  variants: { modes: ['num'], sizes: SIZES, rev: false },

  cmp: (a, b) => (b.s - a.s) || (a.t - b.t),

  parseBoard(q) {
    const mode = String(q.mode || 'num');
    if (mode !== 'num') return { error: 'invalid mode' };
    const size = Number(q.size);
    if (!SIZES.includes(size)) return { error: 'invalid size' };
    return { mode, size, rev: false };
  },

  // t 是平均反应时（秒），s 是答对题数（上限 36 个刺激）
  parseScore(t, s) {
    const tt = Number(t);
    if (!Number.isFinite(tt) || tt < 0.15 || tt > 8) return { error: 'invalid score' };
    const ss = Math.round(Number(s));
    if (!Number.isFinite(ss) || ss < 0 || ss > 60) return { error: 'invalid score' };
    return { t: tt, s: ss };
  }
};
