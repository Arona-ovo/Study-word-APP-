// _tools/check-checkin.js - 校验「打卡走势折线图」与「词书每日目标」（只读源码 + 真实模块）
// 运行：node _tools/check-checkin.js
//
// 覆盖：
//  1) utils/checkin.js 序列生成：天数、正序、今日标记、空态
//  2) 指数规则：有背 → 按练习量上涨；没背 → 按遗忘系数回落
//  3) geometry()：点数、x 单调递增、y 落在 0-100
//  4) segments()：长度恒正、角度与两点关系一致（右端上扬 = 负角）
//  5) formatChange()：符号与小数位
//  6) wordbook.getGoal / setGoal / goalProgress（按词书隔离 + 夹取）
//  7) setMastery 写入 fs（首次接触日期）
//  8) home-layout 注册 chart / goal；home.vue 导入注册与渲染分支
//  9) widget-chart / widget-goal 模板与样式契约（aspect box / 红涨绿跌变量）

const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load');

const ROOT = path.join(__dirname, '..', 'uniapp');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------------- mock：uni 存储 ---------------- */
const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + b);
  else bad(label + ' 期望 ' + b + '，实际 ' + a);
}
const near = (a, b, tol, label) =>
  (Math.abs(a - b) <= tol ? ok(label + ' ≈ ' + b) : bad(label + ' 期望 ≈' + b + '，实际 ' + a));

/* ---------------- 装载真实模块 ---------------- */
const words = load('data/words.js');
const sentences = load('data/sentences.js');
const common = load('data/common-words.js');
const lemma = load('utils/lemma.js');
const wb = load('data/wordbooks.js', { WORDS: words.WORDS });
const store = load('utils/store.js');
const sentenceIndex = load('utils/sentence-index.js', {
  SENTENCES: sentences.SENTENCES, WORDS: words.WORDS, lemmaCandidates: lemma.lemmaCandidates
});
const engine = load('utils/engine.js', {
  WORDS: words.WORDS, SENTENCES: sentences.SENTENCES, store, sentenceIndex
});
const wordbook = load('utils/wordbook.js', {
  store, WORDBOOKS: wb.WORDBOOKS, getBook: wb.getBook, wordIdsOfBook: wb.wordIdsOfBook,
  setUserBookProvider: wb.setUserBookProvider,
  WORDS: words.WORDS, streak: engine.streak, dateStr: engine.dateStr
});
const checkin = load('utils/checkin.js', { engine });

const CORE = 'fj_zsb_core';

/* ---------------- 1. 序列生成 ---------------- */
console.log('== 1. checkin.series 序列 ==');
let s = checkin.series(7);
eq(s.days.length, 7, '7 天区间点数');
assert(s.days[s.days.length - 1].isToday === true, '最后一天标记为今天');
assert(s.days.filter(d => d.isToday).length === 1, '今天只出现一次');
assert(/^\d{1,2}\/\d{2}$/.test(s.days[0].label), '日期标签格式 M/DD（' + s.days[0].label + '）');
eq(checkin.series(30).days.length, 30, '30 天区间点数');
eq(checkin.series(2).days.length, 2, '最小区间夹取 = 2');
eq(checkin.series(999).days.length, 90, '超长区间夹取 = 90');
eq(checkin.series(0).days.length, 30, '非法值回落默认 30');
// 正序（最早在前）
const ds = s.days.map(d => d.date);
eq(JSON.stringify(ds), JSON.stringify(ds.slice().sort()), '日期按正序排列');

/* ---------------- 2. 指数规则 ---------------- */
console.log('== 2. 学习指数：有背则涨、没背则跌 ==');
eq(s.empty, true, '无练习记录 → empty = true');
// 无记录：每天都在退步（累积 -DECAY）
let expect = checkin.BASE;
let allDown = true;
s.days.forEach((d, i) => {
  expect -= checkin.DECAY;
  if (Math.abs(d.value - expect) > 0.001) allDown = false;
});
assert(allDown, '无记录时逐日回落 DECAY=' + checkin.DECAY);
eq(s.up, false, '无记录 → 整体下跌（up = false）');

// 注入练习量：第 2 天 12 题、第 4 天 30 题（触发涨幅上限）、第 6 天 3 题、今天 6 题
const st = store.get();
const todayKey = engine.dateStr();
const mk = (i) => {
  const d = new Date();
  d.setDate(d.getDate() - (6 - i));
  return engine.dateStr(d);
};
st.days[mk(1)] = { total: 12, correct: 9 };
st.days[mk(3)] = { total: 30, correct: 20 };
st.days[mk(5)] = { total: 3, correct: 1 };
// mastered = 今日「学会」计数（确认通过才 +1），每日目标数的是它，不是 correct
st.days[todayKey] = { total: 8, correct: 6, mastered: 6 };
store.save(st);

s = checkin.series(7);
eq(s.empty, false, '有记录后 empty = false');
eq(s.days[1].total, 12, '第 2 天练习量');
eq(s.days[3].total, 30, '第 4 天练习量');
eq(s.checked, 4, '打卡天数 = 4（含今天）');
eq(s.totalDone, 53, '累计题数 = 53');

let v = checkin.BASE;
const seen = [];
s.days.forEach((d, i) => {
  if (d.total > 0) v += Math.min(d.total, checkin.GAIN_CAP);
  else v -= checkin.DECAY;
  seen.push(v);
});
eq(s.days.map(d => Math.round(d.value * 100) / 100).join(','),
   seen.map(x => Math.round(x * 100) / 100).join(','), '指数逐日累加与预期一致');
eq(s.days[3].value - s.days[2].value, checkin.GAIN_CAP, '单日涨幅被 GAIN_CAP 夹住');
eq(s.days[4].up, false, '没背 → 当天为跌');
eq(s.days[1].up, true, '练 12 题 → 当天为涨');
assert(s.days[5].value > s.days[4].value, '只练 3 题也算"有背"，仍为涨');
assert((s.days[1].value - s.days[0].value) > (s.days[5].value - s.days[4].value), '练得多涨得多');
eq(s.up, true, '整体上涨（up = true）');
near(s.changePct, ((s.last - s.first) / s.first) * 100, 0.001, '涨跌幅换算');

/* ---------------- 3. geometry ---------------- */
console.log('== 3. geometry 归一化映射 ==');
const g = checkin.geometry(s);
eq(g.pts.length, s.days.length, '点数 = 天数');
let mono = true;
for (let i = 1; i < g.pts.length; i++) if (!(g.pts[i].x > g.pts[i - 1].x)) mono = false;
assert(mono, 'x 单调递增（从左到右）');
assert(g.pts.every(p => p.y >= 0 && p.y <= 100), '所有 y 落在 0-100');
assert(g.baseY >= 0 && g.baseY <= 100, '基准线落在 0-100（' + g.baseY.toFixed(2) + '）');
assert(checkin.RATIO > 0 && checkin.RATIO < 100, 'RATIO 是合法百分比 = ' + checkin.RATIO);
// 最高点应比最低点更靠上（y 更小）
const ys = g.pts.map(p => p.y);
assert(Math.min.apply(null, ys) < Math.max.apply(null, ys), '存在起伏（非一条水平线）');
// 空序列不炸
const g0 = checkin.geometry({ days: [], first: 100 });
eq(g0.pts.length, 0, '空序列 → 返回空点集');
// 全平序列：不能被压成 0 或贴边
const gf = checkin.geometry({
  first: 100,
  days: [{ value: 100 }, { value: 100 }, { value: 100 }]
});
assert(gf.pts.every(p => p.y > 0 && p.y < 100), '全平序列：y 不贴边（自动撑开）');
assert(gf.pts[0].y === gf.pts[1].y && gf.pts[1].y === gf.pts[2].y, '全平序列：三点同高');
eq(checkin.segments(gf.pts, checkin.RATIO / 100).every(s2 => Math.abs(s2.ang) < 1e-9), true,
   '全平序列：所有段角度为 0');

/* ---------------- 4. segments ---------------- */
console.log('== 4. segments 折线段 ==');
const segs = checkin.segments(g.pts, checkin.RATIO / 100);
eq(segs.length, g.pts.length - 1, '段数 = 点数 - 1');
assert(segs.every(s2 => s2.w > 0), '每段长度 > 0');
assert(segs.every(s2 => isFinite(s2.ang) && s2.ang > -90 && s2.ang < 90), '角度在 ±90° 内');
// 校验角度：atan2(dy*r, dx)，r = RATIO/100
let angOk = true;
for (let i = 1; i < g.pts.length; i++) {
  const dx = g.pts[i].x - g.pts[i - 1].x;
  const dy = (g.pts[i].y - g.pts[i - 1].y) * (checkin.RATIO / 100);
  const want = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (Math.abs(segs[i - 1].ang - want) > 0.02) angOk = false;
}
assert(angOk, '每段角度与 atan2 公式一致');
// 段首尾相接：第 i 段起点 = 第 i-1 点
let jointOk = segs.every((s2, i) => Math.abs(s2.x - g.pts[i].x) < 1e-6 && Math.abs(s2.y - g.pts[i].y) < 1e-6);
assert(jointOk, '每段起点与前一点重合（折线连续）');
eq(checkin.segments([], checkin.RATIO / 100).length, 0, '空点集 → 空段');

/* ---------------- 5. formatChange ---------------- */
console.log('== 5. formatChange 文案 ==');
let f = checkin.formatChange({ last: 126.04, change: 26.04, changePct: 20.6 });
eq(f.value, '126.0', '指数保留 1 位');
eq(f.change, '+26.0', '上涨带 +');
eq(f.pct, '+20.6%', '涨幅带 + 与 %');
f = checkin.formatChange({ last: 88, change: -12, changePct: -12 });
eq(f.change, '-12.0', '下跌带 -');
eq(f.pct, '-12.0%', '跌幅带 - 与 %');
f = checkin.formatChange({ last: 100, change: 0, changePct: 0 });
eq(f.change, '0.0', '持平无符号');
f = checkin.formatChange(null);
eq(f.value, '100.0', '空输入回落基点');

/* ---------------- 6. 每日目标 ---------------- */
console.log('== 6. wordbook 每日目标 ==');
const d0 = wordbook.getGoal(CORE);
eq(d0.enabled, true, '默认启用');
eq(d0.newWords, wordbook.GOAL.newWords.def, '默认每日新词');
eq(d0.practice, wordbook.GOAL.practice.def, '默认每日学会题量');

let g1 = wordbook.setGoal(CORE, { newWords: 40, practice: 15 });
eq(g1.newWords, 40, '设置每日新词');
eq(g1.practice, 15, '设置每日学会题量');
eq(wordbook.getGoal(CORE).newWords, 40, '设置已持久化');
// 只改一项，另一项保持
g1 = wordbook.setGoal(CORE, { practice: 25 });
eq(g1.newWords, 40, '只改 practice 时 newWords 不变');
eq(g1.practice, 25, 'practice 已更新');
// 夹取
eq(wordbook.setGoal(CORE, { newWords: 9999 }).newWords, wordbook.GOAL.newWords.max, '超上限夹到 max');
eq(wordbook.setGoal(CORE, { newWords: 0 }).newWords, wordbook.GOAL.newWords.min, '低于下限夹到 min');
eq(wordbook.setGoal(CORE, { practice: 'abc' }).practice, wordbook.GOAL.practice.def, '非法值回落默认值');
// 开关
eq(wordbook.setGoal(CORE, { enabled: false }).enabled, false, '可关闭目标');
eq(wordbook.getGoal(CORE).enabled, false, '关闭状态已持久化');
wordbook.setGoal(CORE, { enabled: true, newWords: 20, practice: 10 });

// 按词书隔离
wordbook.setGoal(CORE, { newWords: 20, practice: 10 });
const uid = wordbook.createUserBook('目标隔离测试');
wordbook.setGoal(uid, { newWords: 60, practice: 30 });
eq(wordbook.getGoal(CORE).newWords, 20, '核心词书仍为 20');
eq(wordbook.getGoal(uid).newWords, 60, '自建词书为 60（互不影响）');
wordbook.deleteUserBook(uid);

/* ---------------- 7. 今日完成度 ---------------- */
console.log('== 7. goalProgress 今日完成度 ==');
// 首次接触 → 计入今日新词
wordbook.setMastery(CORE, words.WORDS[0].id, { m: 1, seen: 1, correct: 1 });
const rec0 = wordbook.masteryMap(CORE)[words.WORDS[0].id];
eq(rec0.fs, todayKey, 'setMastery 写入 fs = 今天');

let pg = wordbook.goalProgress(CORE);
eq(pg.newWords.done, 1, '今日新词计入 1 个');
eq(pg.newWords.target, 20, '新词目标 = 20');
eq(pg.newWords.pct, 5, '新词完成度 5%（1/20）');
eq(pg.practice.done, 6, '今日学会 = days[today].mastered');
eq(pg.practice.pct, 60, '学会完成度 60%（6/10）');
eq(typeof pg.today.total, 'number', 'today.total 为数字');

// 口径必须是"学会"而不是"答对"：把两个数错开，看 goalProgress 到底读了哪个
st.days[todayKey].correct = 6;
st.days[todayKey].mastered = 4;
store.save(st);
pg = wordbook.goalProgress(CORE);
eq(pg.today.correct, 6, '今日答对仍是 6（口径没被目标改动）');
eq(pg.practice.done, 4, '目标读的是 mastered，不是 correct（4 ≠ 6 才说明没读错字段）');
eq(pg.practice.pct, 40, '按学会数算完成度 40%（4/10）');
// 改判「记错了」→ 学会数要跟着退
engine.addMasteredToday(-2);
eq(wordbook.goalProgress(CORE).practice.done, 2, 'addMasteredToday(-2) 后学会数 = 2');
engine.addMasteredToday(-99);
eq(wordbook.goalProgress(CORE).practice.done, 0, '学会数夹在 0，不会变负');
engine.addMasteredToday(1);
// 还原回上面那一串断言依赖的 6
engine.addMasteredToday(5);
st.days[todayKey].mastered = 6;
store.save(st);
pg = wordbook.goalProgress(CORE);
eq(pg.practice.done, 6, 'addMasteredToday 加减正常（回到 6）');

// 同一个词再练一次 → 仍只算一个（fs 只记首次）
wordbook.setMastery(CORE, words.WORDS[0].id, { m: 2, seen: 2, correct: 2 });
pg = wordbook.goalProgress(CORE);
eq(pg.newWords.done, 1, '重复练习同一词不重复计入');
eq(wordbook.masteryMap(CORE)[words.WORDS[0].id].fs, todayKey, 'fs 不被后续更新覆盖');

// 达标判定（今日学会 6 题）
wordbook.setGoal(CORE, { practice: 10 });
pg = wordbook.goalProgress(CORE);
eq(pg.practice.reached, false, '目标 10 题时未达标');
eq(wordbook.setGoal(CORE, { practice: 4 }).practice, wordbook.GOAL.practice.min,
   '低于 min 的目标被夹到 ' + wordbook.GOAL.practice.min);
pg = wordbook.goalProgress(CORE);
eq(pg.practice.reached, true, '目标降到 min 后达标');
eq(pg.practice.pct, 100, '完成度封顶 100%');
wordbook.setGoal(CORE, { newWords: 20, practice: 10 });

/* ---------------- 8. 首页注册 ---------------- */
console.log('== 8. 首页模块注册 ==');
const modSrc = R('utils/home-layout.ts');
['chart', 'goal'].forEach(id => {
  assert(modSrc.indexOf("{ id: '" + id + "'") >= 0, 'home-layout 注册模块 ' + id);
});
assert(/def:\s*true/.test(modSrc), '存在默认上首页的模块');
const homeSrc = R('pages/home/home.vue');
const homeSc = homeSrc.slice(homeSrc.indexOf('\n<script'), homeSrc.indexOf('\n<style'));
['WidgetChart', 'WidgetGoal'].forEach(c => {
  assert(new RegExp('import\\s+' + c + '\\s+from').test(homeSc), 'home.vue 导入 ' + c);
  assert(new RegExp('components:[\\s\\S]{0,400}' + c).test(homeSc), 'home.vue 注册 ' + c);
});
const homeTpl = homeSrc.slice(0, homeSrc.indexOf('\n<script'));
  ["c.type === 'chart'", "c.type === 'goal'"].forEach(x => {
    assert(homeTpl.indexOf(x) >= 0, 'home.vue 渲染分支 ' + x);
  });
assert(/uni\.\$emit\('home:refresh'\)/.test(homeSc), 'home.vue onShow 广播 home:refresh');
assert(/uni\.\$on\('home:refresh'/.test(R('components/home-widgets/widget-chart.vue')), 'widget-chart 订阅 home:refresh');
assert(/uni\.\$on\('home:refresh'/.test(R('components/home-widgets/widget-goal.vue')), 'widget-goal 订阅 home:refresh');

/* ---------------- 9. 组件样式契约 ---------------- */
console.log('== 9. 组件样式契约 ==');
const chart = R('components/home-widgets/widget-chart.vue');
assert(/:style="\{ paddingBottom: boxRatio \}"/.test(chart), '绘图盒用 padding-bottom 锁高宽比');
assert(/boxRatio\(\)\s*\{[\s\S]{0,120}RATIO/.test(chart), 'boxRatio 取 checkin.RATIO（与角度换算同源）');
assert(/transform-origin:\s*0 50%/.test(chart), '折线段绕左端中点旋转');
assert(/margin-top:\s*-2rpx/.test(chart), '折线段上半高补偿（让左端中点落在数据点上）');
assert(/var\(--ck-up/.test(chart) && /var\(--ck-down/.test(chart), '红涨绿跌走 CSS 变量');
const appSrc = R('App.vue');
assert(/--ck-up:/.test(appSrc), 'App.vue 提供 --ck-up 深色档');
assert(/--ck-down:/.test(appSrc), 'App.vue 提供 --ck-down 深色档');

// 词库详情：目标分段
const libSrc = R('pkgManage/pages/library-detail/library-detail.vue');
assert(/key: 'goal'/.test(libSrc), '词库详情新增「每日目标」分段');
assert(/tab === 'goal'/.test(libSrc), '存在 goal 分段渲染分支');
['refreshGoal', 'onGoalEnabled', 'onGoalInput', 'commitGoal', 'stepGoal', 'setGoalPreset', 'applyGoal']
  .forEach(m => assert(new RegExp('\\b' + m + '\\s*\\(').test(libSrc), '词库详情 method ' + m));

// 练习页题量跟着目标走
const praSrc = R('pkgStudy/pages/practice/practice.vue');
assert(/sessionSize\(\)/.test(praSrc), '练习页按 sessionSize() 出题');
assert(/buildSession\(size/.test(praSrc), 'buildSession 使用动态题量');

console.log('');
console.log(fail === 0 ? '全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
process.exit(fail === 0 ? 0 : 1);
