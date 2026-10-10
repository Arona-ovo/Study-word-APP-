// 折线图几何冒烟测试：把 30 天的曲线在终端画成 ASCII，肉眼确认"有背则涨、没背则跌"
const path = require('path');
const { load } = require('../lib/load');

const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

const words = load('data/words.js');
const sentences = load('data/sentences.js');
const lemma = load('utils/lemma.js');
const wb = load('data/wordbooks.js', { WORDS: words.WORDS });
const store = load('utils/store.js');
const sentenceIndex = load('utils/sentence-index.js', {
  SENTENCES: sentences.SENTENCES, WORDS: words.WORDS, lemmaCandidates: lemma.lemmaCandidates
});
const engine = load('utils/engine.js', {
  WORDS: words.WORDS, SENTENCES: sentences.SENTENCES, store, sentenceIndex
});
const checkin = load('utils/checkin.js', { engine });

// 造一段真实感的历史：多数天练习 10-20 题，中间断几天
const st = store.get();
st.days = {};
const plan = [12, 15, 0, 20, 18, 0, 0, 10, 22, 16, 14, 0, 8, 13, 19, 11, 0, 0, 25, 17, 12, 14, 0, 16, 9, 21, 13, 15, 0, 11];
plan.forEach((total, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (plan.length - 1 - i));
  if (total > 0) st.days[engine.dateStr(d)] = { total: total, correct: Math.round(total * 0.7) };
});
store.save(st);

const s = checkin.series(30);
const g = checkin.geometry(s);
const segs = checkin.segments(g.pts, checkin.RATIO / 100);

console.log('天数 =', s.days.length, '| 打卡 =', s.checked, '| 连续 =', s.streak,
  '| 指数', s.first.toFixed(1), '→', s.last.toFixed(1),
  '| 涨跌', checkin.formatChange(s).text);
console.log('点数 =', g.pts.length, '| 段数 =', segs.length,
  '| x 首/末 =', g.pts[0].x.toFixed(2), '/', g.pts[g.pts.length - 1].x.toFixed(2),
  '| y 范围 =', Math.min.apply(null, g.pts.map(p => p.y)).toFixed(1),
  '~', Math.max.apply(null, g.pts.map(p => p.y)).toFixed(1));

// ASCII 预览（22 行 × 30 列）
const ROWS = 22;
const COLS = 30;
const grid = [];
for (let r = 0; r < ROWS; r++) grid.push(new Array(COLS).fill(' '));
for (let c = 0; c < COLS; c++) {
  const p = g.pts[c];
  const r = Math.round((p.y / 100) * (ROWS - 1));
  grid[r][c] = p.up ? '+' : '-';
}
// 基准线
const br = Math.round((g.baseY / 100) * (ROWS - 1));
for (let c = 0; c < COLS; c++) if (grid[br][c] === ' ') grid[br][c] = '.';
grid.forEach(row => console.log('  |' + row.join('')));
console.log('  +' + new Array(COLS).fill('-').join(''));
console.log('   首日' + new Array(COLS - 6).fill(' ').join('') + '今天');
console.log('   （+ = 当天在涨，- = 当天在跌，. = 基准线）');
