// _tools/check-bookscope.js - 校验「词汇明细严格按当前词书」的口径（只读）
// 核心断言：
//   - 词书内的词 = 内置词（批次 wordIds）+ 该书导入词
//   - 掌握度读 state.books[bookId].mastery，词书之间互不串味
//   - 空词书（无内置词、无导入词）明细必然为空；未知/新建词书 id 不回退到核心词书
const { load } = require('./lib/load');

// mock uni 存储
const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(actual, expect, label) {
  if (actual === expect) ok(label + ' = ' + expect);
  else bad(label + ' 期望 ' + expect + '，实际 ' + actual);
}

// ---------- 装载真实模块 ----------
const lemma = load('utils/lemma.js');
const words = load('data/words.js');
const sentences = load('data/sentences.js');
const common = load('data/common-words.js');
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
const iplus1 = load('utils/iplus1.js', {
  WORDS: words.WORDS, getBook: wb.getBook, wordbook, lemma: lemma.lemma
});
const aiCache = load('utils/ai-cache.js');
const api = load('utils/sentence-api.js', {
  // AI 分项开关：测试里一律放行（默认全开），省 token 那条链路另有脚本验证
  featureOn: () => true,
  aiCache,
  SENTENCES: sentences.SENTENCES, iplus1, store, sentenceIndex, lemma: lemma.lemma,
  chatCompletion: () => Promise.reject(new Error('no ai in test'))
});
const dict = load('utils/dict.js', {
  WORDS: words.WORDS, COMMON_RAW: common.COMMON_RAW, store,
  lemmaCandidates: lemma.lemmaCandidates, lemma: lemma.lemma
});
const importer = load('utils/importer.js', {
  WORDS: words.WORDS, WORDBOOKS: wb.WORDBOOKS, getBook: wb.getBook,
  store, iplus1, generateBatch: api.generateBatch, dict
});

const CORE = 'fj_zsb_core';
const INBOX = 'custom_inbox';
const sum = (c) => c.new + c.learning + c.familiar + c.mastered;
// 专升本词书 = 旧版核心 640 词 + 追加的考纲词，数量随组合数据表变化，别写死
const CORE_TOTAL = wb.wordIdsOfBook(CORE).length;
const BOOK0_NAME = wb.WORDBOOKS[0].name;   // 内置词书名可能因运营调整而改变，取实时值

console.log('== 1. getBook：未知/新建词书 id 不回退到核心词书 ==');
eq(wb.getBook(CORE).batches.length > 0, true, 'getBook(核心) 有批次');
eq(wb.getBook('brand_new_empty').batches.length, 0, 'getBook(未登记 id).batches.length');
eq(wb.getBook(undefined).id, CORE, 'getBook(undefined).id（兼容旧调用）');

console.log('== 2. 核心词书：明细 = 全书内置词 ==');
const core = wordbook.bookVocab(CORE, 'all');
eq(core.total, CORE_TOTAL, '核心词书 明细总数');
eq(core.list.length, sum(core.counts), '明细条数 = 各状态之和');
eq(core.list.every(x => x.custom === false), true, '核心词书明细无导入词标记');
eq(core.counts.new + core.counts.learning + core.counts.familiar + core.counts.mastered, core.total, '状态分布覆盖全部');

console.log('== 3. 空词书：明细为空（用户诉求） ==');
const empty0 = wordbook.bookVocab(INBOX, 'all');
eq(empty0.total, 0, '「我的导入词书」初始明细总数');
eq(empty0.list.length, 0, '「我的导入词书」初始明细条数');
const unknown = wordbook.bookVocab('brand_new_empty', 'all');
eq(unknown.total, 0, '未登记词书 明细总数（新建词书天然为空）');
eq(unknown.list.length, 0, '未登记词书 明细条数');

console.log('== 4. 导入词后：只出现在所属词书 ==');
const vd = importer.validateAndDedupe([
  { word: 'gumption', pos: 'n.', meaning: '进取心' },
  { word: 'zephyr', pos: 'n.', meaning: '西风；微风' }
], INBOX);
eq(vd.accepted.length, 2, '校验通过条数');
importer.importIntoBook(vd.accepted, INBOX);
const inbox = wordbook.bookVocab(INBOX, 'all');
eq(inbox.total, 2, '导入后 inbox 明细总数');
eq(inbox.list.every(x => x.custom === true), true, '导入词 custom 标记');
eq(inbox.list.every(x => x.status === 'new'), true, '导入词初始状态为新词');
const coreAfter = wordbook.bookVocab(CORE, 'all');
eq(coreAfter.total, CORE_TOTAL, '核心词书未受 inbox 导入影响');

console.log('== 5. 导入词排在明细最前（导入后立刻可见） ==');
eq(inbox.list[0].w, 'gumption', '第 1 条为最新导入词');
eq(inbox.list[1].w, 'zephyr', '第 2 条为最新导入词');

console.log('== 6. 掌握度按词书隔离，互不串味 ==');
// 把「核心词书」里的某个词标成已掌握，inbox 的统计不应变化
const coreFirstId = wb.wordIdsOfBook(CORE)[0];
wordbook.setMastery(CORE, coreFirstId, { m: 5, seen: 9, correct: 9 });
const core2 = wordbook.bookVocab(CORE, 'all');
eq(core2.counts.mastered, 1, '核心词书 已掌握 = 1');
const inbox2 = wordbook.bookVocab(INBOX, 'all');
eq(inbox2.counts.mastered, 0, 'inbox 已掌握不受核心词书影响');
eq(inbox2.counts.new, 2, 'inbox 新词仍为 2');

console.log('== 7. 同一 wordId 在两个词书里可各自独立 ==');
wordbook.setMastery(INBOX, coreFirstId, { m: 5, seen: 3, correct: 3 });
const core3 = wordbook.bookVocab(CORE, 'all');
eq(core3.counts.mastered, 1, '核心词书 已掌握仍 = 1');
const inbox3 = wordbook.bookVocab(INBOX, 'all');
eq(inbox3.counts.mastered, 0, 'inbox 未收录该 id，已掌握仍 = 0');

console.log('== 8. 筛选：按状态过滤只返回该状态 ==');
const masteredOnly = wordbook.bookVocab(CORE, 'mastered');
eq(masteredOnly.list.length, core3.counts.mastered, 'mastered 筛选条数 = counts.mastered');
eq(masteredOnly.list.every(x => x.status === 'mastered'), true, 'mastered 筛选结果状态一致');
const newOnly = wordbook.bookVocab(INBOX, 'new');
eq(newOnly.list.length, 2, 'inbox 新词筛选条数');
eq(wordbook.bookVocab(INBOX, 'mastered').list.length, 0, 'inbox 无已掌握词');

console.log('== 9. 切换词书后口径跟随 ==');
wordbook.switchBook(INBOX);
eq(wordbook.currentBookId(), INBOX, 'switchBook 生效');
const cur = wordbook.bookVocab('', 'all');
eq(cur.bookId, INBOX, '空 bookId 时取当前词书');
eq(cur.total, 2, '当前词书(inbox) 明细总数');
wordbook.switchBook(CORE);

// ---------- 自建词书（AI 生成 / 手动新建）全流程 ----------
const session = load('utils/session.js', {
  iplus1, wordbook, api, sentenceIndex, SENTENCES: sentences.SENTENCES, WORDS: words.WORDS,
  aiContent: { generateDrill: () => Promise.reject(new Error('no ai in test')) }
});

(async () => {
  console.log('== 10. 新建词书：初始词汇明细为空 + 可解析 + 可切换 ==');
  const newId = wordbook.createUserBook('商务英语高频词', 'AI 生成 · 商务英语');
  const listed = wordbook.listBooks().find(b => b.id === newId);
  if (listed && listed.userBook && listed.name === '商务英语高频词') ok('listBooks 含自建词书（userBook 标记 + 名称正确）');
  else bad('listBooks 未正确收录自建词书：' + JSON.stringify(listed));
  const gb = wb.getBook(newId);
  eq(gb.name, '商务英语高频词', 'getBook(自建 id).name');
  eq(gb.batches.length, 0, 'getBook(自建 id).batches.length');
  eq(wordbook.bookMode(newId), 'custom', 'bookMode(自建)');
  eq(wordbook.bookMode(CORE), 'batch', 'bookMode(核心)');
  const nb = wordbook.bookVocab(newId, 'all');
  eq(nb.total, 0, '新建词书 词汇明细总数（用户诉求：空）');
  eq(nb.list.length, 0, '新建词书 词汇明细条数');
  eq(wordbook.switchBook(newId), true, 'switchBook(自建) 允许');
  eq(wordbook.currentBookId(), newId, '当前词书已切到自建书');
  eq(typeof session.buildSession === 'function', true, 'session.buildSession 可用');

  console.log('== 11. 自建词书：空书练习不为崩、返回空组 ==');
  const emptyQs = await session.buildSession(5, newId);
  eq(emptyQs.length, 0, '空自建词书 buildSession 返回题数');

  console.log('== 12. 自建词书：导入词后出题走导入词链路 ==');
  const vd2 = importer.validateAndDedupe([
    { word: 'invoice', pos: 'n.', meaning: '发票' },
    { word: 'ledger', pos: 'n.', meaning: '账本' }
  ], newId);
  eq(vd2.accepted.length, 2, '自建书校验通过条数');
  importer.importIntoBook(vd2.accepted, newId);
  // 模拟导入后自动生成例句（真机由 importer.generateForImported 完成）
  const st2 = store.get();
  st2.customWords[newId].forEach(w => {
    w.exampleEn = 'They will ' + w.word + ' the terms before Friday.';
    w.exampleZh = '他们会在周五前处理' + w.meaning + '这件事。';
  });
  store.save(st2);
  const nb2 = wordbook.bookVocab(newId, 'all');
  eq(nb2.total, 2, '导入后自建书 明细总数');
  eq(nb2.customTotal, 2, '导入后自建书 导入词数');

  const qs = await session.buildSession(4, newId);
  eq(qs.length, 4, '自建词书 buildSession 题数');
  eq(qs.every(q => q.options.length === 4), true, '每题均为四选一');
  eq(qs.every(q => q.options[q.answerIndex] === q.answer), true, '答案下标正确');
  eq(qs.every(q => q.wordIds && q.wordIds.length === 1), true, '每题命中 1 个目标词');
  eq(qs.every(q => q.words[0] && q.words[0].custom === true), true, '目标词解析为该书导入词');
  eq(qs.every(q => String(q.wordIds[0]).indexOf('cw-') === 0), true, '目标词 id 为导入词 id');

  console.log('== 13. 自建词书：答题后掌握度写回该书 ==');
  qs.forEach(q => iplus1.recordMastery(newId, q.wordIds, 'pass'));
  const nb3 = wordbook.bookVocab(newId, 'all');
  eq(nb3.counts.learning + nb3.counts.familiar + nb3.counts.mastered, 2, '导入词已被练习记录覆盖');
  eq(nb3.counts.new, 0, '不再有未练习的新词');
  const coreUnchanged = wordbook.bookVocab(CORE, 'all');
  eq(coreUnchanged.counts.mastered, 1, '核心词书掌握度未受自建书影响');

  console.log('== 14. 自建词书：iplus1 选词不崩且只选自书内导入词 ==');
  const picked = iplus1.pickNewWords(newId, 3, []);
  eq(picked.wordIds.length > 0, true, 'pickNewWords 返回候选');
  eq(picked.words.every(w => w.custom === true), true, '候选均为该书导入词');
  eq(picked.batchName, '商务英语高频词', 'batchName 回退为词书名');

  console.log('== 15. 重命名 / 删除自建词书 ==');
  eq(wordbook.renameUserBook(newId, '商务词汇'), true, 'renameUserBook 返回');
  eq(wb.getBook(newId).name, '商务词汇', '重命名后 getBook 名称');
  eq(wordbook.deleteUserBook(newId), true, 'deleteUserBook 返回');
  eq(wordbook.listBooks().some(b => b.id === newId), false, '删除后 listBooks 不再含该书');
  eq(wordbook.currentBookId(), CORE, '删除当前词书后自动退回默认词书');
  eq(wordbook.bookVocab(newId, 'all').total, 0, '删除后该书词汇为空');
  eq(((store.get().customWords || {})[newId] || []).length, 0, '删除后该书导入词已清理');
  eq(wordbook.deleteUserBook(newId), false, '重复删除返回 false');

  console.log('== 16. 内置词书不可被删除 ==');
  eq(wordbook.deleteUserBook(CORE), false, 'deleteUserBook(核心) 拒绝');

  console.log('== 17. 复现页面流程：切到无词词书 → 词汇明细页必须为空 ==');
  // 模拟 library-detail.vue refresh()：listBooks() 找 current → bookVocab(cur.id, filter)
  const freshId = wordbook.createUserBook('导入词书', '空白词书');
  wordbook.switchBook(freshId);
  let books = wordbook.listBooks();
  let pageCur = books.find(b => b.current) || books[0];
  eq(pageCur.id, freshId, '页面解出的当前词书 = 自建词书');
  eq(pageCur.name, '导入词书', '页面解出的当前词书名');
  let pv = wordbook.bookVocab(pageCur.id, 'all');
  eq(pv.total, 0, '词汇明细总数（应为空）');
  eq(pv.list.length, 0, '词汇明细列表（应为空）');
  eq(pv.total === 0, true, '页面据此渲染"还没有词汇"引导块');
  // 导入 2 个词后，明细立刻出现且只属于该书
  const vd3 = importer.validateAndDedupe([
    { word: 'invoice', pos: 'n.', meaning: '发票' },
    { word: 'ledger', pos: 'n.', meaning: '账本' }
  ], freshId);
  importer.importIntoBook(vd3.accepted, freshId);
  pv = wordbook.bookVocab(pageCur.id, 'all');
  eq(pv.total, 2, '导入后该自建书明细总数');
  // 我的导入词书（内置无批次书）同样只显示自己的导入词
  eq(wordbook.bookVocab(INBOX, 'all').total, 2, '我的导入词书明细只含自己的 2 词');
  eq(wordbook.bookVocab(INBOX, 'all').list.every(x => x.custom), true, '我的导入词书明细无核心词');
  wordbook.deleteUserBook(freshId);
  wordbook.switchBook(CORE);

  console.log('== 18. 词书名唯一性（新建/重命名不可与现有词书重名） ==');
  // 与内置词书重名 → 拒绝
  let threw = false;
  try { wordbook.createUserBook(BOOK0_NAME, '空白词书'); } catch (e) { threw = /已存在/.test(e.message || ''); }
  eq(threw, true, 'createUserBook 与内置词书重名（' + BOOK0_NAME + '）→ 抛"已存在"');
  // 与自建词书重名 → 拒绝
  const dupId = wordbook.createUserBook('我的生词本', '空白词书');
  threw = false;
  try { wordbook.createUserBook('我的生词本', '空白词书'); } catch (e) { threw = /已存在/.test(e.message || ''); }
  eq(threw, true, 'createUserBook 与自建词书重名 → 抛"已存在"');
  // 忽略首尾空格与大小写
  threw = false;
  try { wordbook.createUserBook('  我的生词本 ', '空白词书'); } catch (e) { threw = /已存在/.test(e.message || ''); }
  eq(threw, true, '重名判定忽略首尾空格');
  threw = false;
  try { wordbook.createUserBook('MY WORDS', '空白词书'); } catch (e) { threw = /已存在/.test(e.message || ''); }
  eq(threw, false, '不同名字（大小写不同的其他词）不误伤');
  // isNameTaken 契约
  eq(wordbook.isNameTaken('我的生词本'), true, 'isNameTaken 命中');
  eq(wordbook.isNameTaken('我的生词本', dupId), false, 'isNameTaken 排除自身（重命名用）');
  eq(wordbook.isNameTaken('不存在的名字'), false, 'isNameTaken 未命中返回 false');
  eq(wordbook.isNameTaken(''), false, '空名不视为重名');
  // 重命名：改成别人的名字 → 抛错；改成自己的原名 → 放行
  threw = false;
  try { wordbook.renameUserBook(dupId, BOOK0_NAME); } catch (e) { threw = /已存在/.test(e.message || ''); }
  eq(threw, true, 'renameUserBook 与内置词书重名 → 抛"已存在"');
  const otherId = wordbook.createUserBook('另一本书', '空白词书');
  threw = false;
  try { wordbook.renameUserBook(otherId, '我的生词本'); } catch (e) { threw = /已存在/.test(e.message || ''); }
  eq(threw, true, 'renameUserBook 与其他自建书重名 → 抛"已存在"');
  eq(wordbook.renameUserBook(dupId, '我的生词本'), true, 'renameUserBook 保持自己原名 → 放行');
  wordbook.deleteUserBook(dupId);
  wordbook.deleteUserBook(otherId);

  console.log('== 19. 更换词书页契约：统一弹窗替代系统 showModal ==');
  const fs2 = require('fs');
  const path2 = require('path');
  const bsSrc = fs2.readFileSync(path2.join(__dirname, '..', 'uniapp', 'pkgManage', 'pages', 'book-switch', 'book-switch.vue'), 'utf8');
  const dlgSrc = fs2.readFileSync(path2.join(__dirname, '..', 'uniapp', 'components', 'app-dialog', 'app-dialog.vue'), 'utf8');
  // 页面不自己画弹窗了，统一引用 <app-dialog>
  eq(/components:\s*\{[^}]*AppDialog/.test(bsSrc), true, '页面注册 AppDialog 组件');
  eq(/<app-dialog/.test(bsSrc), true, '页面使用 <app-dialog>');
  eq(!/uni\.showModal|uni\.showActionSheet/.test(bsSrc), true, '页面不再调用系统弹窗');
  // 视觉本身（毛玻璃卡片 + 输入框）由组件统一提供
  eq(/pop-mask/.test(dlgSrc) && /dlg-input/.test(dlgSrc), true, '统一弹窗含项目风格卡片（pop-mask + dlg-input）');
  eq(/isNameTaken/.test(bsSrc), true, '确定前用 isNameTaken 预检重名');
  eq((bsSrc.match(/createUserBook/g) || []).length === 1, true, 'createUserBook 仅在弹窗确认时调用一次');
  eq(/onLoad[\s\S]{0,40}refresh|onShow\(\)\s*\{\s*[\s\S]*refresh\(\)/.test(bsSrc), true, 'onShow 刷新词书列表');

  console.log('== 20. 更换词书页：长按对所有词书有反馈 ==');
  // 旧实现里 askDelete 对内置词书直接 return，长按当前（内置）词书毫无反应
  eq(/askDelete\(b\)\s*\{[\s\S]{0,200}?lastLongPress\s*=/.test(bsSrc), true, '长按先记录时间戳（用于吃掉补发的 tap）');
  eq(/askDelete\(b\)\s*\{[\s\S]{0,400}?!b\.userBook[\s\S]{0,200}?showToast/.test(bsSrc), true, '内置词书长按给出提示而非静默');
  eq(!/askDelete\(b\)\s*\{\s*if\s*\(!b\.userBook\)\s*return\s*\}/.test(bsSrc), true, '长按不再对内置词书直接 return');
  eq(/@longpress="askDelete\(b\)"/.test(bsSrc), true, '列表项绑定 longpress');

  console.log('');
  console.log(fail === 0 ? '词书词汇口径全部通过' : '失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
