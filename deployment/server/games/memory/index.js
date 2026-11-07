'use strict';
/**
 * 记忆矩阵 · 后端
 * 变体：棋盘大小（3×3 / 4×4 / 5×5）
 * 排序：连续记住的格数越多越好，同分看谁用时更短
 * 数据：data/memory.json
 */

const SIZES = [3, 4, 5];

module.exports = {
  id: 'memory',
  label: '记忆矩阵',
  desc: '记住格子亮起的顺序，长度逐格递增',

  variants: { modes: ['grid'], sizes: SIZES, rev: false },

  cmp: (a, b) => (b.s - a.s) || (a.t - b.t),

  parseBoard(q) {
    const mode = String(q.mode || 'grid');
    if (mode !== 'grid') return { error: 'invalid mode' };
    const size = Number(q.size);
    if (!SIZES.includes(size)) return { error: 'invalid size' };
    return { mode, size, rev: false };
  },

  // t 是本局总用时（秒），s 是成功复现过的最长序列
  parseScore(t, s) {
    const tt = Number(t);
    if (!Number.isFinite(tt) || tt < 1.5 || tt > 3600) return { error: 'invalid score' };
    const ss = Math.round(Number(s));
    if (!Number.isFinite(ss) || ss < 0 || ss > 30) return { error: 'invalid score' };
    return { t: tt, s: ss };
  }
};
