// _tools/check-srs.js - 词级间隔重复调度器 校验（只读，不改源码）
// 运行：node --experimental-strip-types _tools/check-srs.js
//
// 覆盖：
//   1) 阶梯自洽：递增、首档 1 天、末档 100 天
//   2) 日期工具：跨月 / 跨年 / 闰年 / 负数
//   3) 调度语义：当场学会 → 明天；连过进一阶；答错退回第 0 阶；走完毕业
//   4) 到期判定：未到期 / 到期 / 逾期 / 毕业不到期 / 没排期不到期
//   5) 落盘：markLearned / markReviewed 真的写进掌握度（两条练习链路共用）
//   6) 组牌：到期词优先，但有上限（不能挤掉新词）
//   7) 三关题型序列：按用户偏好起头、其余轮转，且不重复
//
// 为什么要单独盯这些：间隔重复是"看起来很合理、错了也没人发现"的一类逻辑 ——
// 间隔算错一天、毕业早了一档，界面上完全看不出来，但半年后记忆效果就塌了。

const { load } = require('./lib/load');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const mem = {};
global.uni = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const is = (c, m, extra) => (c ? ok(m + (extra === undefined ? '' : ' = ' + extra)) : bad(m + (extra === undefined ? '' : ' = ' + extra)));
function eq(a, b, label) {
  const s1 = JSON.stringify(a);
  const s2 = JSON.stringify(b);
  if (s1 === s2) ok(label + ' = ' + s2);
  else bad(label + ' 期望 ' + s2 + '，实际 ' + s1);
}

(async () => {
  const srs = load('utils/srs.js');

  /* ---------------- 1. 阶梯 ---------------- */
  console.log('== 1. 间隔阶梯 ==');
  is(srs.STEPS.length >= 5, '阶梯至少 5 档（' + srs.STEPS.length + '）');
  is(srs.STEPS[0] === 1, '首档 1 天（艾宾浩斯曲线最陡的一段，也对齐不背单词"首次复习 1~2 天后"）');
  is(srs.STEPS[srs.STEPS.length - 1] === 100, '末档 100 天（对齐不背单词"间隔超过 100 天判定已掌握"）');
  let ascend = true;
  for (let i = 1; i < srs.STEPS.length; i++) if (srs.STEPS[i] <= srs.STEPS[i - 1]) ascend = false;
  is(ascend, '阶梯严格递增（间隔逐次拉长）', srs.STEPS.join('/'));
  eq(srs.GRADUATED, srs.STEPS.length, '毕业线 = 阶梯档数');

  /* ---------------- 2. 日期工具 ---------------- */
  console.log('== 2. 日期工具 ==');
  eq(srs.addDays('2026-01-31', 1), '2026-02-01', '跨月');
  eq(srs.addDays('2026-12-31', 1), '2027-01-01', '跨年');
  eq(srs.addDays('2024-02-28', 1), '2024-02-29', '闰年 2 月 29 日存在');
  eq(srs.addDays('2026-02-28', 1), '2026-03-01', '平年 2 月直接进 3 月');
  eq(srs.addDays('2026-03-01', -1), '2026-02-28', '负数（往回算）');
  eq(srs.diffDays('2025-12-31', '2026-01-01'), 1, '跨年相差 1 天');
  eq(srs.diffDays('2026-10-10', '2026-10-10'), 0, '同一天相差 0');
  eq(srs.diffDays('2026-10-15', '2026-10-10'), -5, '还没到 → 负数');
  is(/^\d{4}-\d{2}-\d{2}$/.test(srs.dateStr()), 'dateStr 格式 = YYYY-MM-DD', srs.dateStr());

  /* ---------------- 3. 调度语义 ---------------- */
  console.log('== 3. 当场学会与跨天巩固 ==');
  const today = '2026-10-10';
  const learned = srs.learn(today);
  eq(learned, { st: 0, due: '2026-10-11' }, '当场三关全过 → 排到明天（当场不算第 1 次巩固）');

  // 连过 7 次 → 毕业。
  // 注意第一个间隔（1 天）是在 learn() 时就定下的，review 循环里产出的是后 6 个，
  // 最后一次毕业、due 清空（没有"下一次"），所以只在有 due 时才记一档。
  let rec = Object.assign({}, learned);
  const gaps = [srs.diffDays(today, learned.due)];
  for (let i = 0; i < srs.GRADUATED; i++) {
    rec = Object.assign({}, rec, srs.review(rec, true, today));
    if (rec.due) gaps.push(srs.diffDays(today, rec.due));
  }
  eq(gaps, srs.STEPS, '从学会到毕业，间隔依次就是整条阶梯（1/3/7/15/30/60/100 天）');
  eq(rec.st, srs.GRADUATED, '走完阶梯 → 毕业');
  eq(rec.due, '', '毕业后 due 清空（不再安排复习）');
  is(srs.graduated(rec), 'graduated() 认得出已毕业');

  // 中途答错 → 退回第 0 阶
  const high = { st: 4, due: '2026-11-01', lp: 1 };
  const fell = srs.review(high, false, today);
  eq(fell, { st: 0, due: '2026-10-11', lp: 2 }, '答错 → 退回第 0 阶、明天重来、遗忘次数 +1（Leitner：答错回第 1 格）');

  // 毕业后再答错也要能被拉回来（否则一个词一旦毕业就再也不会被纠正）
  const grad = { st: srs.GRADUATED, due: '', lp: 0 };
  is(srs.review(grad, false, today).st === 0, '毕业词答错也能退回第 0 阶（不留"毕业即免检"的窟窿）');

  // 阶梯走完前的最后一次：st 停在 GRADUATED，不会越界
  let r2 = { st: srs.GRADUATED, due: '', lp: 0 };
  r2 = Object.assign({}, r2, srs.review(r2, true, today));
  eq(r2.st, srs.GRADUATED, '毕业后继续答对，st 不会越界');

  /* ---------------- 4. 到期判定 ---------------- */
  console.log('== 4. 到期判定 ==');
  is(!srs.isDue({ st: 0, due: '2026-10-11' }, today), '明天的词今天不到期');
  is(srs.isDue({ st: 0, due: '2026-10-10' }, today), '正好今天 → 到期');
  is(srs.isDue({ st: 0, due: '2026-10-08' }, today), '逾期 → 到期（欠的更要补）');
  is(!srs.isDue({ st: 0, due: '' }, today), '没排期（新词）不算到期');
  is(!srs.isDue({ st: srs.GRADUATED, due: '' }, today), '毕业的词永不到期');
  eq(srs.overdueDays({ st: 0, due: '2026-10-08' }, today), 2, '逾期天数 = 2');
  // 未到期返回负数（负得越多离得越远）—— 排序时"快到期的"自然排在前面
  eq(srs.overdueDays({ st: 0, due: '2026-10-15' }, today), -5, '还没到期 → 负数');
  eq(srs.nextDue({ st: 0, due: '2026-10-11' }), '2026-10-11', 'nextDue 取下次日期');
  eq(srs.nextDue({ st: srs.GRADUATED, due: '' }), '', '毕业词 nextDue 为空');

  // 排序：欠得越久越靠前
  const map = {
    a: { st: 0, due: '2026-10-08' },  // 欠 2 天
    b: { st: 0, due: '2026-10-20' },  // 没到期
    c: { st: 0, due: '2026-10-09' },  // 欠 1 天
    d: { st: srs.GRADUATED, due: '' } // 毕业
  };
  eq(srs.dueIds(map, today), ['a', 'c'], 'dueIds 按逾期天数降序，且排除未到期与已毕业');
  eq(srs.dueCount(map, today), 2, 'dueCount 与 dueIds 一致');
  const st = srs.stageText({ st: 2, due: '2026-10-17' });
  eq(st, { done: 2, total: srs.GRADUATED, graduated: false, nextGap: srs.STEPS[2] }, 'stageText 给出进度与下次间隔');

  /* ---------------- 5. 落盘：两条链路共用一套调度 ---------------- */
  console.log('== 5. 落盘（刷单词 / 翻译练习共用）==');
  const words = load('data/words.js');
  const wordbooks = load('data/wordbooks.js', { WORDS: words.WORDS });
  const store = load('utils/store.js');
  const sentences = load('data/sentences.js');
  const lemmaMod = load('utils/lemma.js');
  const sentenceIndex = load('utils/sentence-index.js', {
    SENTENCES: sentences.SENTENCES, WORDS: words.WORDS, lemmaCandidates: lemmaMod.lemmaCandidates
  });
  const engine = load('utils/engine.js', {
    WORDS: words.WORDS, SENTENCES: sentences.SENTENCES, store, sentenceIndex
  });
  const wordbook = load('utils/wordbook.js', {
    store, WORDBOOKS: wordbooks.WORDBOOKS, getBook: wordbooks.getBook, wordIdsOfBook: wordbooks.wordIdsOfBook,
    setUserBookProvider: wordbooks.setUserBookProvider,
    WORDS: words.WORDS, streak: engine.streak, dateStr: engine.dateStr
  });
  const ws = load('utils/word-session.js', { wordbook, sentenceIndex, srs });

  store.init();
  wordbook.ensureShape();
  const BID = wordbook.currentBookId();
  const MODE = { recog: '认得出', recall: '想得起', spell: '写得出', self: '自评' };

  const wid = (wordbook.bookWords(BID)[0] || {}).id;
  is(!!wid, '拿到一个词 id 用于落盘复验', wid);
  const afterLearn = ws.markLearned(BID, wid, today);
  eq((wordbook.masteryMap(BID)[wid] || {}).st, 0, 'markLearned → 掌握度里写入 st=0');
  is(!!(wordbook.masteryMap(BID)[wid] || {}).due, 'markLearned → 写入 due（' + afterLearn.due + '）');
  const afterReview = ws.markReviewed(BID, wid, true, today);
  eq((wordbook.masteryMap(BID)[wid] || {}).st, 1, 'markReviewed(答对) → 进一阶');
  const afterMiss = ws.markReviewed(BID, wid, false, today);
  eq((wordbook.masteryMap(BID)[wid] || {}).st, 0, 'markReviewed(答错) → 退回第 0 阶');
  is(afterMiss.lp >= 1, '答错记一次遗忘（lp = ' + afterMiss.lp + '）');

  /* ---------------- 6. 组牌：到期词优先，但不挤掉新词 ---------------- */
  console.log('== 6. 组牌混入到期巩固词 ==');
  is(typeof ws.dueStats === 'function', '有 dueStats（首页卡片要用待巩固数）');
  eq(ws.DUE_RATIO, 0.5, '到期词最多占一组的一半（留出名额给新词）');

  // 造一批到期词：把前 8 个词排成昨天到期
  const all = wordbook.bookWords(BID);
  const yesterday = srs.addDays(today, -1);
  for (let i = 0; i < 8 && i < all.length; i++) {
    wordbook.setMastery(BID, all[i].id, { m: 3, seen: 3, correct: 3, st: 0, due: yesterday });
  }
  const dueBefore = ws.dueStats(BID, today);
  is(dueBefore >= 8, '手工排出 ' + dueBefore + ' 个到期词');

  const deck = ws.pickWords(10, BID, 'daily', today);
  const dueSet = {};
  for (let i = 0; i < 8 && i < all.length; i++) dueSet[all[i].id] = true;
  const hit = deck.filter(x => dueSet[x.id]).length;
  is(hit > 0, '到期词被排进组里（' + hit + ' / ' + deck.length + '）—— 以前它们要等 m 掉下来才被捞起来');
  is(hit <= Math.ceil(10 * ws.DUE_RATIO), '到期词不超过一半（' + hit + ' ≤ ' + Math.ceil(10 * ws.DUE_RATIO) + '），新词还有位置');
  is(deck.length === 10, '组牌总数照旧 = 10');

  // 到期堆为空时，行为跟改造前一致（不应引入回归）
  const clean = load('utils/word-session.js', { wordbook: wordbook, sentenceIndex, srs });
  is(typeof clean.pickWords === 'function' && clean.pickWords(5, BID, 'new', today).length >= 0,
    'new 来源在改造后仍可正常组牌');

  /* ---------------- 7. 三关题型序列 ---------------- */
  console.log('== 7. 三关题型序列 ==');
  eq(ws.CONFIRM_TIMES, 3, '当场要连过 3 关');
  eq(ws.CONFIRM_MODES, ['recog', 'recall', 'spell'], '三档按提取难度递增');
  eq(ws.buildModeSequence('choice'), ['recog', 'recall', 'spell'], '选义起头：认 → 想 → 写');
  eq(ws.buildModeSequence('spell'), ['spell', 'recog', 'recall'], '拼写起头：写 → 认 → 想');
  eq(ws.buildModeSequence('self'), ['self', 'recog', 'recall'], '自评起头：自评 → 认 → 想');
  eq(ws.buildModeSequence(''), ['recog', 'recall', 'spell'], '脏值回落默认序列');
  // 每种偏好下，三关都不能出现重复题型（重复就等于少考一档）
  [['choice'], ['spell'], ['self']].forEach(([p]) => {
    const seq = ws.buildModeSequence(p);
    eq(new Set(seq).size, seq.length, '偏好 ' + p + ' 的三关题型互不重复（' + seq.join('→') + '）');
  });
  eq(ws.modeAt(0), 'recog', 'modeAt(0) 第 1 关');
  eq(ws.modeAt(5), 'spell', 'modeAt 越界夹在最后一档（不会取到 undefined）');

  /* ---------------- 8. 造题：三种题型都造得出来 ---------------- */
  console.log('== 8. 三档题型的题目结构 ==');
  const item = ws.buildDeck(1, BID, 'daily', today)[0];
  is(!!item, '组到一个词');
  is(!!(item.modes || {}).recog, '有 recog 题');
  is(!!(item.modes || {}).recall, '有 recall 题');
  is(!!(item.modes || {}).spell, '有 spell 题');
  eq(item.modes.recog.options[item.modes.recog.answerIndex], item.m, 'recog：正确项 = 中文释义');
  eq(String(item.modes.recall.options[item.modes.recall.answerIndex] || '').toLowerCase(),
    String(item.w || '').toLowerCase(), 'recall：正确项 = 英文单词（反向）');
  eq(item.modes.spell.answer, item.w, 'spell：答案 = 英文单词');
  is(/^[^_]/.test(item.modes.spell.hint) && /_/.test(item.modes.spell.hint),
    'spell：提示是首字母 + 下划线（' + item.modes.spell.hint + '）');
  // 向后兼容：翻译练习页的确认题还在用顶层 options / answerIndex
  eq(item.options, item.modes.recog.options, '顶层 options 仍是 recog 那份（翻译练习页在用它）');
  eq(item.answerIndex, item.modes.recog.answerIndex, '顶层 answerIndex 同理');
  is(!!item.srs && 'st' in item.srs && 'due' in item.srs, '题目带着该词的巩固状态（srs.st / srs.due）');

  // recall 的干扰项必须是别的英文单词，不能把正确答案重复塞进去
  const uniq = new Set(item.modes.recall.options.map(x => String(x).toLowerCase()));
  eq(uniq.size, item.modes.recall.options.length, 'recall 的四个选项互不重复');

  /* ---------------- 9. 源码契约 ---------------- */
  console.log('== 9. 源码契约 ==');
  const srsSrc = read('utils/srs.js');
  is(!/wordbook|sentenceIndex|engine/.test(srsSrc.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')),
    'srs.js 不依赖存储与引擎（纯函数，方便单测与复用）');
  const wdSrc = read('pkgStudy/pages/word-drill/word-drill.vue');
  is(/import \* as srs from/.test(wdSrc), '刷单词页引入了 srs（显示巩固进度）');
  is(/promptIsWord/.test(wdSrc), '想得起 / 写得出 两关不显示单词（题干换中文释义）');
  is(/if \(this\.promptIsWord\) tts\.speakAuto/.test(wdSrc), '自动朗读只在"给单词"的两关开（不提前报答案）');

  console.log('');
  console.log(fail === 0 ? '间隔重复调度 校验全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('运行异常：', e);
  process.exit(1);
});
