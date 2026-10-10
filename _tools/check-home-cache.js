// _tools/check-home-cache.js - 校验「首页总览按数据修订号缓存」的正确性（只读）
// 核心断言：
//   - 数据没变 → 不重算（不再每次切回首页都遍历整本词）
//   - 数据变了 → 必定重算，且读到的是新值（绝不返回陈旧快照）
//   - ensureShape() 不再无条件 save（否则修订号每次 +1，缓存永远命中不了）
const { load } = require('./lib/load');

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

// 探针：computeOverview() 末尾必然调一次 streak()，且这条链路上没有别的调用点，
// 所以计数就是「真正重算的次数」。（不能用 getBook —— 算批次时会反复调它）
let computes = 0;
const streakSpy = () => { computes++; return engine.streak(); };

const wordbook = load('utils/wordbook.js', {
  store, WORDBOOKS: wb.WORDBOOKS, getBook: wb.getBook, wordIdsOfBook: wb.wordIdsOfBook,
  setUserBookProvider: wb.setUserBookProvider,
  WORDS: words.WORDS, streak: streakSpy, dateStr: engine.dateStr
});

console.log('== 1. 首算与命中 ==');
store.init();
const ov1 = wordbook.homeOverview();
assert(computes === 1, '首次调用重算 1 次（实际 ' + computes + '）');
const ov2 = wordbook.homeOverview();
assert(computes === 1, '数据未变 → 命中缓存，不再重算（实际 ' + computes + '）');
assert(ov1 === ov2, '缓存返回同一份结果，语义与每次重算一致');

console.log('== 2. ensureShape 不再无条件写 ==');
const revBefore = store.revision();
wordbook.ensureShape();
wordbook.ensureShape();
eq(store.revision(), revBefore, '连续 ensureShape 不推高修订号');
assert(wordbook.homeOverview() === ov1, 'ensureShape 之后仍是缓存命中');

console.log('== 3. 学习进度变化必须失效 ==');
const bid = wordbook.currentBookId();
const list = wordbook.bookWords(bid);
assert(list.length > 0, '当前词书有词（' + list.length + '）');
const touchedBefore = wordbook.homeOverview().touched;
wordbook.setMastery(bid, list[0].id, { m: 1 });
assert(store.revision() > revBefore, 'setMastery 推高修订号');
const ov3 = wordbook.homeOverview();
assert(computes === 2, '写入后重算（实际 ' + computes + '）');
eq(ov3.touched, touchedBefore + 1, '重算结果反映新掌握度');
wordbook.homeOverview();
assert(computes === 2, '重算后再次调用仍命中缓存');

console.log('== 4. 掌握到 MASTERED 也要反映 ==');
wordbook.setMastery(bid, list[1].id, { m: 5 });
const ov4 = wordbook.homeOverview();
eq(ov4.mastered, ov3.mastered + 1, 'mastered 计数同步 +1');

console.log('== 5. 切词书必须失效 ==');
const other = wb.WORDBOOKS.find((b) => b.id !== bid && (b.batches || []).length);
if (other) {
  wordbook.switchBook(other.id);
  const ov5 = wordbook.homeOverview();
  eq(ov5.bookId, other.id, '总览跟到新词书');
  wordbook.switchBook(bid);
  assert(wordbook.homeOverview().bookId === bid, '切回来也跟着变');
} else {
  ok('（只有一本内置词书，跳过切书用例）');
}

console.log('== 6. force 强制重算 ==');
const c0 = computes;
wordbook.homeOverview(true);
assert(computes === c0 + 1, 'force=true 无视缓存重算');

console.log('== 7. 换一天必须失效 ==');
// 重新装一份 wordbook，dateStr 换成"明天"，验证日期进了缓存键
const wordbookTomorrow = load('utils/wordbook.js', {
  store, WORDBOOKS: wb.WORDBOOKS, getBook: wb.getBook, wordIdsOfBook: wb.wordIdsOfBook,
  setUserBookProvider: wb.setUserBookProvider,
  WORDS: words.WORDS, streak: streakSpy,
  dateStr: () => '2099-01-01'
});
const c1 = computes;
const ovT = wordbookTomorrow.homeOverview();
assert(computes === c1 + 1, '日期变化 → 重算（不返回昨天的 today 快照）');
assert(ovT.today && ovT.today.total === 0, '新一天的今日计数归零');

console.log('== 8. reset 清空进度也要失效 ==');
const c2 = computes;
store.reset();
wordbook.homeOverview();
assert(computes === c2 + 1, 'store.reset 后重算');

console.log(fail === 0 ? '\n全部通过' : '\n失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
