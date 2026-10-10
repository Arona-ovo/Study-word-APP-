// _tools/check-cover-mascot.js - 校验启动页阿罗娜表情按学习状态切换（只读）
// 断言：
//   1. cover.vue 圆框绑定的 mascotSrc 来自 MASCOTS 映射（不再写死单图）
//   2. pickMood 调真实 engine 的 history/streak/overview/dateStr，按 9 种状态选 7 种表情
//   3. 七张表情图真实存在于 static/mascot/，体积可控（<120KB）
//   4. 各学习状态下引擎读数与预期表情一致（用真实 engine 计算）
const { load } = require('./lib/load');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(actual, expect, label) {
  if (actual === expect) ok(label + ' = ' + expect);
  else bad(label + ' 期望 ' + expect + '，实际 ' + actual);
}

// ---------- 第 1 组：cover.vue 源码契约 ----------
console.log('[1] cover.vue 源码契约');
const src = fs.readFileSync(path.join(ROOT, 'pages', 'cover', 'cover.vue'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '');
if (/:src="mascotSrc"/.test(src)) ok('圆框 image 绑定 mascotSrc');
else bad('圆框 image 未绑定 mascotSrc');
if (!/src="\/static\/mascot\.jpg"/.test(src)) ok('不再写死 /static/mascot.jpg');
else bad('仍写死 /static/mascot.jpg');
if (/pickMood/.test(src)) ok('存在 pickMood');
else bad('缺少 pickMood');
for (const call of ['history(0)', 'dateStr()', 'streak()', 'overview()']) {
  if (src.includes(call)) ok('pickMood 调用 engine.' + call.replace('()', ''));
  else bad('pickMood 未调用 ' + call);
}
for (const mood of ['smile', 'tongue', 'hi', 'nervous', 'sad', 'angry', 'shocked']) {
  // MASCOTS 键 + pickMood 逻辑里都要出现（部分走三目表达式，不强制 return 形式）
  if (new RegExp(mood + '\\s*:').test(src) && src.includes("'" + mood + "'")) ok('映射覆盖 ' + mood);
  else bad('映射缺少 ' + mood);
}
if (/catch \(e\)/.test(src)) ok('pickMood 有异常兜底');
else bad('pickMood 缺异常兜底（存储异常不能卡启动页）');

// ---------- 第 2 组：七张表情图存在且体积可控 ----------
console.log('[2] static/mascot 表情图');
const EXPECT = {
  smile: 'arona-smile.jpg', tongue: 'arona-tongue.jpg', hi: 'arona-hi.jpg',
  nervous: 'arona-nervous.jpg', sad: 'arona-sad.jpg',
  angry: 'arona-angry.jpg', shocked: 'arona-shocked.jpg'
};
for (const k of Object.keys(EXPECT)) {
  const p = path.join(ROOT, 'static', 'mascot', EXPECT[k]);
  if (!fs.existsSync(p)) { bad('缺少 ' + EXPECT[k]); continue; }
  const kb = Math.round(fs.statSync(p).size / 1024);
  if (kb > 0 && kb < 120) ok(EXPECT[k] + ' 存在（' + kb + 'KB）');
  else bad(EXPECT[k] + ' 体积异常（' + kb + 'KB，应在 1-120KB）');
  if (src.includes('/static/mascot/' + EXPECT[k])) ok('cover.vue 引用 ' + EXPECT[k]);
  else bad('cover.vue 未引用 ' + EXPECT[k]);
}

// ---------- 第 3 组：真实 engine 九态读数 ----------
console.log('[3] 学习状态 → 表情（真实 engine）');
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
const store = load('utils/store.js');
const sentenceIndex = load('utils/sentence-index.js', {
  SENTENCES: sentences.SENTENCES, WORDS: words.WORDS, lemmaCandidates: lemma.lemmaCandidates
});
const engine = load('utils/engine.js', {
  WORDS: words.WORDS, SENTENCES: sentences.SENTENCES, store, sentenceIndex
});

// 与 cover.vue pickMood 相同的判定（源码契约在第 1 组已锁，这里跑行为）
function mood() {
  const days = engine.history(0);
  if (!days.length) return 'hi';
  const byDate = {};
  days.forEach(d => { byDate[d.date] = d });
  const today = byDate[engine.dateStr()];
  if (today && today.total > 0) {
    const perfect = today.total >= 5 && today.correct >= today.total;
    return (perfect || engine.streak() >= 7) ? 'tongue' : 'smile';
  }
  let gap = 0;
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (gap < 365) {
    const rec = byDate[engine.dateStr(d)];
    if (rec && rec.total > 0) break;
    gap++;
    d.setDate(d.getDate() - 1);
  }
  if (gap === 0) return engine.overview().wrongCount >= 20 ? 'nervous' : 'hi';
  if (gap >= 14) return 'shocked';
  if (gap >= 3) return 'angry';
  return 'sad';
}
function setDay(offset, total, correct) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const st = store.get();
  st.days[engine.dateStr(d)] = { total: total, correct: correct };
  store.save(st);
}
function addWrong(n) {
  const st = store.get();
  for (let i = 0; i < n; i++) st.wrong.push({ sid: 's' + i, dir: 'e2c', ts: Date.now() });
  store.save(st);
}

// 新用户：无任何记录
eq(mood(), 'hi', '新用户（无记录）');
// 今天练过：全对 ≥5 题 → 吐舌；有错 → 笑
setDay(0, 12, 12);
eq(mood(), 'tongue', '今天全对 12 题');
setDay(0, 10, 8);
eq(mood(), 'smile', '今天练了但有错');
// 连击满 7 天（哪怕今天有错）→ 吐舌
store.reset();
for (let i = 1; i <= 7; i++) setDay(i, 10, 6);
setDay(0, 10, 8);
eq(mood(), 'tongue', '连击 7 天 + 今天练过');
// 今天没练、连击未断：错题少 → 惊讶；错题 ≥20 → 紧张
store.reset();
setDay(1, 10, 6);
eq(mood(), 'hi', '连击未断（昨天练了）');
addWrong(20);
eq(mood(), 'nervous', '连击未断 + 错题 20');
// 断签：1-2 天委屈、3-13 天生气、14 天以上震惊
store.reset();
setDay(2, 10, 6);
eq(mood(), 'sad', '断签 1 天（最近一次是前天）');
store.reset();
setDay(4, 10, 6);
eq(mood(), 'angry', '断签 3 天');
store.reset();
setDay(15, 10, 6);
eq(mood(), 'shocked', '断签 14 天');

process.exit(fail ? 1 : 0);
