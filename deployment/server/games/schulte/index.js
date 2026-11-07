'use strict';
/**
 * 舒尔特方格 · 后端
 * 变体：形状 × 尺寸 × 正序/倒序（3 × 6 × 2 = 36 条榜，前端只开放 18 条）
 * 排序：用时越短越好
 * 数据：data/schulte.json
 */

const MODES = ['square', 'radial', 'star'];
const SIZES = [3, 4, 5, 6, 7, 8];

module.exports = {
  id: 'schulte',
  label: '舒尔特方格',
  desc: '按顺序点数字，练视觉搜索',

  variants: { modes: MODES, sizes: SIZES, rev: true },

  // 用时升序
  cmp: (a, b) => a.t - b.t,

  // 榜单维度（GET 和 POST 共用）
  parseBoard(q) {
    const mode = String(q.mode || '');
    if (!MODES.includes(mode)) return { error: 'invalid mode' };
    const size = Number(q.size);
    if (!SIZES.includes(size)) return { error: 'invalid size' };
    const rev = ['1', 'true'].includes(String(q.rev || ''));
    return { mode, size, rev };
  },

  // 成绩：t 是本局用时（秒），s 是 0–150 的评分
  parseScore(t, s) {
    const tt = Number(t);
    if (!Number.isFinite(tt) || tt < 2 || tt > 900) return { error: 'invalid score' };
    const ss = Math.round(Number(s));
    if (!Number.isFinite(ss) || ss < 0 || ss > 150) return { error: 'invalid score' };
    return { t: tt, s: ss };
  }
};
