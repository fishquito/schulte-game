'use strict';
/**
 * 色字冲突 · 后端
 * 变体：时长（30 / 60 秒）
 * 排序：答对越多越好，同分看谁平均反应更快
 * 数据：data/stroop.json
 */

const SIZES = [30, 60];

module.exports = {
  id: 'stroop',
  label: '色字冲突',
  desc: '点墨水的颜色，别念字面，练抑制控制',

  variants: { modes: ['std'], sizes: SIZES, rev: false },

  // 答对降序；同分看平均反应时（越小越好）
  cmp: (a, b) => (b.s - a.s) || (a.t - b.t),

  parseBoard(q) {
    const mode = String(q.mode || 'std');
    if (mode !== 'std') return { error: 'invalid mode' };
    const size = Number(q.size);
    if (!SIZES.includes(size)) return { error: 'invalid size' };
    return { mode, size, rev: false };
  },

  // t 是平均反应时（秒），s 是答对题数
  parseScore(t, s) {
    const tt = Number(t);
    if (!Number.isFinite(tt) || tt < 0.15 || tt > 30) return { error: 'invalid score' };
    const ss = Math.round(Number(s));
    if (!Number.isFinite(ss) || ss < 0 || ss > 300) return { error: 'invalid score' };
    return { t: tt, s: ss };
  }
};
