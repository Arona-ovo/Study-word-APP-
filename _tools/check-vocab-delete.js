// _tools/check-vocab-delete.js - 词汇明细「长按多选删除」校验
//
// 核心验证：
//  A. wordbook 层
//   1) 自定义词：从 customWords[bookId] 真删，bookWords / bookVocab 不再出现
//   2) 内置词：记入 removedBookWords[bookId] 黑名单，bookWords 过滤（语料数据不动）
//   3) 混合批量返回 { removed, hidden } 计数正确；幂等（重复删不重复计数）
//   4) 脏 id（不属于本书 / 不存在）被忽略，不进黑名单
//   5) restoreBookWords 能恢复被隐藏的内置词
//   6) deleteUserBook 顺手清掉该书黑名单
//  B. 页面契约（library-detail.vue）
//   - word-item 有 @longpress；多选态 tap 切换选中、普通态进详情
//   - sel-bar 有 全选/删除/取消 三个入口；删除走统一确认弹窗 action='deleteWords'
//   - onConfirmYes 真调 wordbook.removeWordsFromBook 并 refresh；setTab 退出多选
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
const lemmaMod = load('utils/lemma.js');
const words = load('data/words.js');
const wordbooks = load('data/wordbooks.js', { WORDS: words.WORDS });
const store = load('utils/store.js');
const wordbook = load('utils/wordbook.js', {
  store, WORDBOOKS: wordbooks.WORDBOOKS, getBook: wordbooks.getBook,
  wordIdsOfBook: wordbooks.wordIdsOfBook, setUserBookProvider: wordbooks.setUserBookProvider,
  WORDS: words.WORDS, streak: () => 0, dateStr: () => '2026-10-09'
});

const BID = 'fj_zsb_core';

// ---------- A. wordbook 层 ----------
console.log('\n== A1. 自定义词真删 ==');
(function () {
  const st = store.get();
  st.customWords = st.customWords || {};
  st.customWords[BID] = [
    { id: 'cw-t1', word: 'zeta', pos: 'n.', meaning: '测试词1', lv: 1 },
    { id: 'cw-t2', word: 'yoyo', pos: 'v.', meaning: '测试词2', lv: 1 }
  ];
  store.save(st); store.flush();

  const before = wordbook.bookWords(BID);
  assert(before.some(x => x.id === 'cw-t1'), '删除前自定义词在列表里');

  const r = wordbook.removeWordsFromBook(BID, ['cw-t1']);
  eq(r.removed, 1, 'removed 计数');
  eq(r.hidden, 0, 'hidden 计数');
  const after = wordbook.bookWords(BID);
  assert(!after.some(x => x.id === 'cw-t1'), '删除后列表不再出现');
  assert(after.some(x => x.id === 'cw-t2'), '别的自定义词不受牵连');
  const bucket = (store.get().customWords || {})[BID] || [];
  eq(bucket.length, 1, 'customWords 数组真删了');
})();

console.log('\n== A2. 内置词黑名单隐藏 ==');
(function () {
  const bid0 = wordbook.bookWords(BID).find(x => !x.custom);
  assert(!!bid0, '书里有内置词');
  const totalBefore = wordbook.bookWords(BID).length;
  const idsBefore = wordbooks.wordIdsOfBook(BID);

  const r = wordbook.removeWordsFromBook(BID, [bid0.id]);
  eq(r.hidden, 1, 'hidden = 1');
  eq(r.removed, 0, 'removed = 0');
  assert(!wordbook.bookWords(BID).some(x => x.id === bid0.id), 'bookWords 过滤了它');
  eq(wordbook.bookWords(BID).length, totalBefore - 1, '总数 -1');
  // 语料数据没动：删除只写 removedBookWords 黑名单，批次的词 id 列表一个不少
  // （专升本词书现在是 640 个旧核心词 + 追加的考纲词，断言写成"条数不变"而不是死数字）
  eq(wordbooks.wordIdsOfBook(BID).length, idsBefore.length, '语料数据原封不动');
  eq(wordbooks.wordIdsOfBook(BID).indexOf(bid0.id) >= 0, true, '被删的词仍在语料里（只是被该书过滤）');
})();

console.log('\n== A3. 混合批量 + 幂等 ==');
(function () {
  const st = store.get();
  st.customWords[BID] = (st.customWords[BID] || []).concat([
    { id: 'cw-m1', word: 'alpha', pos: 'n.', meaning: '混测1', lv: 1 },
    { id: 'cw-m2', word: 'bravo', pos: 'n.', meaning: '混测2', lv: 1 }
  ]);
  store.save(st); store.flush();

  const all = wordbook.bookWords(BID);
  const builtinId = all.find(x => !x.custom).id;
  const r1 = wordbook.removeWordsFromBook(BID, ['cw-m1', 'cw-m2', builtinId]);
  eq(r1.removed, 2, '混合：removed=2');
  eq(r1.hidden, 1, '混合：hidden=1');

  // 幂等：重复删同一批 → 全 0，黑名单不重复记
  const listLenBefore = ((store.get().removedBookWords || {})[BID] || []).length;
  const r2 = wordbook.removeWordsFromBook(BID, ['cw-m1', 'cw-m2', builtinId]);
  eq(r2.removed + r2.hidden, 0, '重复删除计数为 0');
  eq(((store.get().removedBookWords || {})[BID] || []).length, listLenBefore, '黑名单没有重复条目');
})();

console.log('\n== A4. 脏 id 忽略 ==');
(function () {
  const r = wordbook.removeWordsFromBook(BID, ['cw-不存在', 'not-a-word-id', '']);
  eq(r.removed + r.hidden, 0, '脏 id 不产生任何删除');
  const list = (store.get().removedBookWords || {})[BID] || [];
  assert(!list.includes('not-a-word-id'), '黑名单里没有脏 id');
  eq(wordbook.removeWordsFromBook(BID, []).removed + 0, 0, '空数组安全');
})();

console.log('\n== A5. bookVocab 口径一致 ==');
(function () {
  const v = wordbook.bookVocab(BID, 'all');
  const ids = {};
  v.list.forEach(x => { ids[x.id] = true });
  const bw = wordbook.bookWords(BID);
  eq(v.total, bw.length, 'bookVocab.total 与 bookWords 一致');
  assert(!bw.some(x => ids[x.id] === undefined), '两路列表 id 完全对齐');
})();

console.log('\n== A6. restoreBookWords 恢复内置词 ==');
(function () {
  const hiddenBefore = ((store.get().removedBookWords || {})[BID] || []).length;
  assert(hiddenBefore > 0, '当前有被隐藏的内置词');
  const n = wordbook.restoreBookWords(BID);
  eq(n, hiddenBefore, '恢复条数正确');
  assert(!((store.get().removedBookWords || {})[BID]), '黑名单已清');
})();

console.log('\n== A7. deleteUserBook 清黑名单 ==');
(function () {
  const newId = wordbook.createUserBook('多选删除测试书' + Date.now() % 1000, '');
  const st = store.get();
  st.removedBookWords = st.removedBookWords || {};
  st.removedBookWords[newId] = ['w1', 'w2'];
  store.save(st); store.flush();

  assert(wordbook.deleteUserBook(newId), '删除自建词书成功');
  assert(!((store.get().removedBookWords || {})[newId]), '黑名单跟着清掉');
})();

// ---------- B. 页面契约 ----------
console.log('\n== B. 页面契约 ==');
const page = fs.readFileSync(path.join(ROOT, 'pkgManage/pages/library-detail/library-detail.vue'), 'utf8');

assert(/@longpress="onWordLongPress\(item\)"/.test(page), 'word-item 绑定了 @longpress');
assert(/@tap="onWordTap\(item\)"/.test(page), 'word-item 的 tap 走 onWordTap');
{
  const fn = page.match(/onWordTap\(item\) \{[\s\S]*?\n    \}/);
  assert(!!fn, '定位到 onWordTap');
  assert(fn && /this\.selMode/.test(fn[0]) && /toggleSel/.test(fn[0]) && /openWord/.test(fn[0]),
    'onWordTap：多选态切换选中，普通态进详情');
}
assert(/sel-bar/.test(page) && /toggleSelAll/.test(page) && /askDeleteSelected/.test(page) && /exitSel/.test(page),
  '多选操作条三入口齐全（全选 / 删除 / 取消）');
// selCount / allPicked 必须是 computed：模板按属性取（{ n: selCount }），
// 放 methods 里会把函数对象渲染成 "已选 function () { [native code] } 个词"
{
  const iC = page.indexOf('computed: {');
  const iM = page.indexOf('methods: {');
  assert(iC >= 0 && iM > iC, '定位到 computed / methods 区块');
  const computedBlk = page.slice(iC, iM);
  const methodsBlk = page.slice(iM);
  assert(/\bselCount\(\)\s*\{/.test(computedBlk), 'selCount 定义在 computed');
  assert(/\ballPicked\(\)\s*\{/.test(computedBlk), 'allPicked 定义在 computed');
  assert(!/\bselCount\s*\(/.test(methodsBlk) && !/\ballPicked\s*\(/.test(methodsBlk),
    'selCount / allPicked 不允许再出现在 methods（避免重名遮蔽）');
}
// 返回手势 / 返回键：多选态 = 退出多选；确认弹窗开着 = 先关弹窗，都不离开页面
{
  const bp = page.match(/onBackPress\(\) \{[\s\S]*?\n  \},/);
  assert(!!bp, '存在 onBackPress 拦截');
  assert(bp && bp[0].indexOf('this.exitSel()') >= 0 && /return true/.test(bp[0]),
    '多选态下返回先退出多选（return true 拦住默认返回）');
  assert(bp && bp[0].indexOf('confirm.show = false') >= 0,
    '确认弹窗开着时返回先关弹窗');
}
assert(/action: 'deleteWords'/.test(page), '删除走统一确认弹窗');
{
  const fn = page.match(/if \(act === 'deleteWords'\) \{[\s\S]*?\n      \}/);
  assert(!!fn, '定位到 deleteWords 执行分支');
  assert(fn && /removeWordsFromBook\(this\.curBookId/.test(fn[0]), '真调 wordbook.removeWordsFromBook');
  assert(fn && /this\.refresh\(\)/.test(fn[0]), '删完刷新列表');
  assert(fn && /this\.exitSel\(\)/.test(fn[0]), '删完退出多选');
}
{
  const fn = page.match(/setTab\(e\) \{[\s\S]*?\n    \}/);
  assert(fn && /exitSel/.test(fn[0]), '切 tab 退出多选');
}
assert(/selMode: false,\n      selMap: \{\}/.test(page), 'data 里有 selMode / selMap');
{
  // 进入多选必须由长按触发，tap 不能触发（防止误入多选）
  const fn = page.match(/onWordLongPress\(item\) \{[\s\S]*?\n    \}/);
  assert(fn && /this\.selMode = true/.test(fn[0]), '长按进入多选');
}

console.log('');
if (fail) {
  console.error('FAILED: ' + fail + ' 项不过');
  process.exit(1);
} else {
  console.log('ALL PASS');
}
