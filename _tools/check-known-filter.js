// _tools/check-known-filter.js - 熟词过滤（词汇量估算）校验
//
// 核心验证：
//  A. 模块层（utils/known-filter.js）
//   1) basis：只取内置词、按词书原序（词频从易到难）；removedBookWords 黑名单生效
//   2) createTest 纯逻辑：测试全程零写入（store 修订号不变）
//   3) 二分行为：
//      · 全认识 → 覆盖全本（lastPassed = 最后一段）
//      · 全不认识 → 一个不标（lastPassed = -1）
//      · 只认识前 K% → markIds 全部来自词书前部，且不超过 K% + 一段容差
//   4) apply：m=5；已有记录保留 seen/correct；fs 永不写今天（不污染每日新词）；
//      filterRun 备份完整；bookVocab「已掌握」计数增加；批次解锁因此推进
//   5) undo：精确还原（含"原本没记录"的词），lastRun 清空
//  B. 页面契约（known-filter.vue / library.vue / pages.json）
//   - 四阶段 intro/test/result/done；认识 → 释义二次确认
//   - 应用 / 撤销都走统一确认弹窗，confirm 后才调 kf.apply / kf.undo
//   - 词库页有入口卡片，跳转目标已注册
//   - 新增中文文案全部有英文译文（i18n-en.js）
const { load } = require('./lib/load');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'uniapp');

const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {},
  vibrateShort: () => {}
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
const eq = (a, b, label) => {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
};

process.on('unhandledRejection', (e) => {
  console.error('UNHANDLED REJECTION:', e && e.stack ? e.stack : JSON.stringify(e));
});

// ---- 真实模块 ----
const settings = load('utils/settings.js'); settings.init();
const words = load('data/words.js');
const wordbooks = load('data/wordbooks.js', { WORDS: words.WORDS });
const store = load('utils/store.js');

function p2(n) { return n < 10 ? '0' + n : '' + n }
function fmt(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) }
const TODAY = fmt(new Date());

const wordbook = load('utils/wordbook.js', {
  store, WORDBOOKS: wordbooks.WORDBOOKS, getBook: wordbooks.getBook,
  wordIdsOfBook: wordbooks.wordIdsOfBook, setUserBookProvider: wordbooks.setUserBookProvider,
  streak: () => 0, dateStr: () => TODAY
});
const kf = load('utils/known-filter.js', { wordbook, store });

const BID = 'fj_zsb_core';

// ---------- A1. basis ----------
console.log('\n== A1. basis：内置词、词书原序、黑名单 ==');
(function () {
  const list = kf.basis(BID);
  assert(list.length > 500, '默认词书 basis 有词（' + list.length + ' 个）');
  const bookInternal = wordbook.bookWords(BID).filter(x => !x.custom);
  eq(list.length, bookInternal.length, 'basis 与 bookWords 内置部分同口径');

  // 黑名单：模拟删除前 3 个内置词
  const st = store.get();
  st.removedBookWords = st.removedBookWords || {};
  st.removedBookWords[BID] = list.slice(0, 3).map(x => x.id);
  store.save(st);
  const list2 = kf.basis(BID);
  eq(list2.length, list.length - 3, '黑名单里的词不进测试基准');
  delete st.removedBookWords[BID];
  store.save(st);
})();

// ---------- A2. createTest 纯逻辑 + 二分行为 ----------
console.log('\n== A2. createTest：零写入 + 三种作答形态 ==');
function runTest(answerFn) {
  const test = kf.createTest(BID);
  let guard = 0;
  while (test.current() && guard++ < 200) {
    const c = test.current();
    test.answer(answerFn(c));
  }
  assert(guard < 200, '二分必然收敛（实际 ' + guard + ' 次作答）');
  return { test, asked: guard };
}

(function () {
  const rev0 = store.revision();
  const all = runTest(() => true);   // 全认识
  eq(store.revision(), rev0, '测试过程零写入（修订号不变）');
  assert(all.asked >= 12 && all.asked <= 60, '全认识作答次数合理（' + all.asked + '，约 12 段 × 5 词内）');

  const rAll = all.test.result();
  assert(rAll.ok, '全认识 → 估算有效');
  eq(rAll.lastPassed, kf.SEGMENT_COUNT - 1, '全认识 → 覆盖最后一段');
  eq(rAll.markCount, rAll.total, '全认识 → 标记全本');
  assert(rAll.markCount > 500, '全认识 → 标记数 = 词书词量（' + rAll.markCount + '）');
})();

(function () {
  const none = runTest(() => false);  // 全不认识
  const r = none.test.result();
  assert(r.ok, '全不认识 → 估算有效');
  eq(r.lastPassed, -1, '全不认识 → 没有通过段');
  eq(r.markCount, 0, '全不认识 → 一个不标');
  eq(r.estimate, 0, '全不认识 → 估算 0');
})();

(function () {
  // 只认识前 60%：按词在 basis 里的位置作答（词频序 = 由易到难的单调假设）
  const list = kf.basis(BID);
  const posOf = {};
  list.forEach((w, i) => { posOf[w.w] = i });
  const cutoff = Math.floor(list.length * 0.6);

  const half = runTest(c => posOf[c.word] < cutoff);
  const r = half.test.result();
  assert(r.ok, '认识前 60% → 估算有效');
  assert(r.markCount > 0, '认识前 60% → 有词可标（' + r.markCount + '）');
  const segSize = Math.ceil(list.length / kf.SEGMENT_COUNT);
  assert(r.markCount <= cutoff + segSize,
    '标记数不超过 60% + 一段容差（' + r.markCount + ' ≤ ' + (cutoff + segSize) + '）');
  // markIds 必须全部来自词书前部：标记段内不得出现 cutoff 之后的词
  const markSet = {};
  r.markIds.forEach(id => { markSet[id] = true });
  const lateHit = list.slice(cutoff + segSize).filter(w => markSet[w.id]);
  eq(lateHit.length, 0, '标记的词全部来自词书前部（无越过容差的词）');
  // 估算值与真实认识数同量级
  assert(r.estimate > cutoff * 0.5 && r.estimate <= cutoff + segSize,
    '估算值在合理区间（' + r.estimate + '，真实 ' + cutoff + '）');
})();

// ---------- A3. apply ----------
console.log('\n== A3. apply：标记 + 备份 + 不污染统计 ==');
(function () {
  const list = kf.basis(BID);
  const posOf = {};
  list.forEach((w, i) => { posOf[w.w] = i });
  const cutoff = Math.floor(list.length * 0.6);
  const half = runTest(c => posOf[c.word] < cutoff);
  const r = half.test.result();

  // 预置一条学习记录：验证 apply 保留 seen/correct、fs 不落今天
  const midId = r.markIds[Math.floor(r.markIds.length / 2)];
  wordbook.setMastery(BID, midId, { m: 2, seen: 7, correct: 5 });

  const res = kf.apply(BID, r);
  assert(res.marked === r.markCount && res.marked > 0, 'apply 返回标记数（' + res.marked + '）');

  const m = wordbook.masteryMap(BID);
  let allFive = true, fsToday = 0;
  r.markIds.forEach(id => {
    const rec = m[id];
    if (!rec || rec.m !== 5) allFive = false;
    if (rec && rec.fs === TODAY) fsToday++;
  });
  assert(allFive, '所有被标记的词 m=5');
  eq(fsToday, 0, '没有任何词的 fs 写成今天（每日新词不被污染）');
  eq(m[midId].seen, 7, '已有学习记录 seen 保留');
  eq(m[midId].correct, 5, '已有学习记录 correct 保留');

  // goalProgress：今日新词 fresh 不因批量标记暴涨
  const gp = wordbook.goalProgress(BID);
  eq(gp.newWords.done, 0, '今日新词完成数 = 0（标记不计入）');

  // bookVocab：已掌握计数增加
  const v = wordbook.bookVocab(BID, 'all');
  assert(v.counts.mastered >= r.markCount, '词汇明细「已掌握」≥ 标记数（' + v.counts.mastered + '）');

  // 批次解锁推进：第 2 批应已解锁（第 1 批被整体掌握）
  const bp = wordbook.batchProgress(BID, 1);
  assert(bp.unlocked, '前段被标掌握 → 下一批解锁');

  // lastRun 摘要
  const lr = kf.lastRun(BID);
  assert(lr && lr.marked === r.markCount, 'lastRun 摘要正确（' + (lr && lr.marked) + '）');

  // 备份完整：filterRun.ids 与 markIds 一致
  const st = store.get();
  const fr = st.books[BID].filterRun;
  eq(fr.ids.length, r.markIds.length, 'filterRun 备份 id 数一致');
  eq(fr.backup[midId].seen, 7, '备份里存着 apply 前的旧记录');
})();

// ---------- A4. undo：精确还原（apply 前快照 vs undo 后快照） ----------
console.log('\n== A4. undo：精确还原 ==');
(function () {
  store.reset();
  wordbook.ensureShape();

  const list = kf.basis(BID);
  const posOf = {};
  list.forEach((w, i) => { posOf[w.w] = i });
  const cutoff = Math.floor(list.length * 0.6);

  const half = runTest(c => posOf[c.word] < cutoff);
  const r = half.test.result();

  // 预置两条学习记录：idA 会被标记，idB 在标记范围之外
  const idA = r.markIds[Math.floor(r.markIds.length / 2)];
  const idB = list[list.length - 1].id;
  wordbook.setMastery(BID, idA, { m: 1, seen: 3, correct: 1 });
  wordbook.setMastery(BID, idB, { m: 2, seen: 9, correct: 4 });

  const beforeSnap = JSON.stringify(store.get().books[BID].mastery);

  kf.apply(BID, r);
  assert(store.get().books[BID].mastery[idA].m === 5, 'apply 后目标词 m=5');

  kf.undo(BID);
  const afterSnap = JSON.stringify(store.get().books[BID].mastery);
  eq(afterSnap, beforeSnap, 'undo 后掌握度与 apply 前逐字节一致');
  eq(kf.lastRun(BID), null, 'undo 后 lastRun 清空');
  eq(store.get().books[BID].mastery[idB].seen, 9, '未标记词不受影响');
})();

// ---------- B. 页面契约 ----------
console.log('\n== B. 页面契约 ==');
const pageSrc = fs.readFileSync(path.join(ROOT, 'pkgManage/pages/known-filter/known-filter.vue'), 'utf8');
const libSrc = fs.readFileSync(path.join(ROOT, 'pages/library/library.vue'), 'utf8');
const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages.json'), 'utf8').replace(/\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
const enSrc = fs.readFileSync(path.join(ROOT, 'utils/i18n-en.js'), 'utf8');

assert(pageSrc.includes("phase: 'intro'") && pageSrc.includes("phase === 'test'") && pageSrc.includes("phase === 'result'") && pageSrc.includes("phase === 'done'"), '四阶段：intro / test / result / done');
assert(pageSrc.includes('verify') && pageSrc.includes('ask-mean'), '「认识」→ 亮释义二次确认');
assert(/action: 'apply'/.test(pageSrc) && /action: 'undo'/.test(pageSrc), '应用 / 撤销走统一确认弹窗');
assert(/kf\.apply\(/.test(pageSrc) && /kf\.undo\(/.test(pageSrc), '确认后才调 kf.apply / kf.undo');
assert(/onBackPress/.test(pageSrc), '测试中返回键有拦截确认');
assert(/:disabled="!hasBasis"/.test(pageSrc), '无内置词书时开始按钮置灰（不 v-if 藏掉）');

assert(libSrc.includes('goKnownFilter') && libSrc.includes('known-filter/known-filter'), '词库页有熟词过滤入口');

const registered = [];
(pj.subPackages || []).forEach(sp => sp.pages.forEach(p => registered.push(sp.root + '/' + p.path)));
assert(registered.indexOf('pkgManage/pages/known-filter/known-filter') >= 0, '页面已注册到 pkgManage 分包');

// 新增文案的英文译文齐全（提取 t('...') / $t('...') 的 key，查 i18n-en.js）
const keys = new Set();
[pageSrc, libSrc].forEach(src => {
  (src.match(/(?:\$t|\bt)\(\s*'([^']+)'/g) || []).forEach(m => {
    const k = m.slice(m.indexOf("'") + 1, -1);
    if (k) keys.add(k);
  });
});
const missing = [];
keys.forEach(k => {
  if (!new RegExp("(^|\\n)\\s*'" + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "\\'") + "':").test(enSrc)) missing.push(k);
});
eq(missing.length, 0, '新页面文案都有英文译文' + (missing.length ? '（缺：' + missing.slice(0, 5).join(' / ') + '）' : '（共 ' + keys.size + ' 条）'));

console.log('\n' + (fail ? '✗ FAIL ' + fail : '✓ ALL PASS'));
process.exitCode = fail ? 1 : 0;
