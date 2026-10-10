// _tools/check-wrong.js - 错题本回归（记录 → 列表 → 重练）
// 回归点：i+1 / AI / 导入词生成的句子 sid 带前缀（corpus- / ai- / cw-），
// 不在语料表里。错题若只存 sid，列表与重练都会反查不到 → 显示为空。
const { load } = require('./lib/load');

const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

const lemmaMod = load('utils/lemma.js');
const words = load('data/words.js');
const sentences = load('data/sentences.js');
const wordbooks = load('data/wordbooks.js', { WORDS: words.WORDS });
const store = load('utils/store.js');
const aiCache = load('utils/ai-cache.js');
const sentenceIndex = load('utils/sentence-index.js', {
  SENTENCES: sentences.SENTENCES, WORDS: words.WORDS, lemmaCandidates: lemmaMod.lemmaCandidates
});
const engine = load('utils/engine.js', {
  WORDS: words.WORDS, SENTENCES: sentences.SENTENCES, store, sentenceIndex
});
const wordbook = load('utils/wordbook.js', {
  store, WORDBOOKS: wordbooks.WORDBOOKS, getBook: wordbooks.getBook, wordIdsOfBook: wordbooks.wordIdsOfBook,
  setUserBookProvider: wordbooks.setUserBookProvider, WORDS: words.WORDS, streak: engine.streak, dateStr: engine.dateStr
});
const iplus1 = load('utils/iplus1.js', {
  WORDS: words.WORDS, getBook: wordbooks.getBook, wordbook, lemma: lemmaMod.lemma
});
const api = load('utils/sentence-api.js', {
  // AI 分项开关：测试里一律放行（默认全开），省 token 那条链路另有脚本验证
  featureOn: () => true,
  aiCache,
  SENTENCES: sentences.SENTENCES, iplus1, store, sentenceIndex, lemma: lemmaMod.lemma,
  chatCompletion: () => Promise.reject(new Error('AI 未配置'))
});
const session = load('utils/session.js', {
  iplus1, wordbook, api, sentenceIndex, SENTENCES: sentences.SENTENCES, WORDS: words.WORDS
});

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + b);
  else bad(label + ' 期望 ' + b + '，实际 ' + a);
}

(async () => {
  console.log('== 1. i+1 会话里答错：必须进错题本并能在列表里看到 ==');
  const qs = await session.buildSession(3, 'fj_zsb_core');
  if (!qs.length) { bad('出题为空，无法验证'); process.exit(1); }
  const q = qs[0];
  if (!/^(corpus|ai|cw)-/.test(String(q.sid))) bad('sid 应带前缀（本用例的前提），实际 ' + q.sid);
  else ok('题目 sid = ' + q.sid + '（不在语料表里）');

  engine.recordAnswer(q, 'fail', 'choice', '我的错误答案');
  const st = store.get();
  eq(st.wrong.length, 1, '错题本条数');
  if (st.wrong[0] && st.wrong[0].en && st.wrong[0].zh) ok('错题记录带上原文（en / zh）');
  else bad('错题记录没存原文：' + JSON.stringify(st.wrong[0]));

  const list = engine.wrongList();
  eq(list.length, 1, '错题列表条数');
  if (list.length) {
    const it = list[0];
    const wantPrompt = q.dir === 'e2c' ? q.prompt : q.answer;   // 列表里 prompt 固定是"题干"
    if (it.prompt === q.prompt && it.answer === q.answer) ok('题干 / 参考答案与出题一致');
    else bad('题干或答案不一致：' + JSON.stringify(it));
    eq(it.userAnswer, '我的错误答案', '保留了用户答案');
    if (it.timeStr) ok('时间格式 = ' + it.timeStr);
    else bad('缺少时间');
  }

  console.log('== 2. 错题重练能出到题 ==');
  const rq = engine.reviewQuestions();
  eq(rq.length, 1, '错题重练题数');
  if (rq.length) {
    const r = rq[0];
    if (r.sid === q.sid && r.dir === q.dir) ok('重练题目 = 原错题（sid/dir 一致）');
    else bad('重练题目不匹配：' + JSON.stringify({ sid: r.sid, dir: r.dir }));
    if (r.options && r.options.length === 4 && r.options[r.answerIndex] === r.answer) ok('选项与正确答案下标正常');
    else bad('选项异常');
  }

  console.log('== 3. 重练答对 → 自动移出错题本 ==');
  engine.recordAnswer(q, 'pass', 'choice', q.answer);
  eq(store.get().wrong.length, 0, '错题本已清空');
  eq(engine.wrongList().length, 0, '列表为空');

  console.log('== 4. 半对（输入模式）不进错题本，也不移出 ==');
  engine.recordAnswer(q, 'fail', 'input', '半吊子');
  engine.recordAnswer(q, 'partial', 'input', '半吊子2');
  eq(store.get().wrong.length, 1, '半对不会把已有错题清掉');

  console.log('== 5. 兼容老记录：只有 sid、没有原文 ==');
  const st2 = store.get();
  st2.wrong = [
    { sid: 'corpus-' + sentences.SENTENCES[2].id, dir: 'e2c', answer: 'x', ts: Date.now() },  // 前缀 + 无原文
    { sid: sentences.SENTENCES[4].id, dir: 'c2e', answer: 'y', ts: Date.now() }               // 纯数字 + 无原文
  ];
  store.save(st2);
  const old = engine.wrongList();
  eq(old.length, 2, '老记录也能解析（前缀剥离 + 数字 id）');
  if (old.length === 2) {
    if (old[0].prompt === sentences.SENTENCES[2].en) ok('corpus- 前缀记录还原正确');
    else bad('前缀记录还原错误：' + old[0].prompt);
    if (old[1].prompt === sentences.SENTENCES[4].zh) ok('数字 id 记录还原正确（c2e 题干是中文）');
    else bad('数字 id 记录还原错误：' + old[1].prompt);
  }

  console.log('== 6. 完全查不到的脏记录被跳过，不影响其它条目 ==');
  const st3 = store.get();
  st3.wrong = [
    { sid: 'ai-not-exist', dir: 'e2c', answer: '', ts: Date.now() },
    { sid: 'cw-2', dir: 'e2c', answer: '', ts: Date.now(), en: 'Hello', zh: '你好' }
  ];
  store.save(st3);
  const mixed = engine.wrongList();
  eq(mixed.length, 1, '脏记录被过滤，正常记录保留');
  if (mixed.length) eq(mixed[0].prompt, 'Hello', '保留的是有原文的那条');

  console.log('');
  console.log(fail === 0 ? '错题本全部通过' : '失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
