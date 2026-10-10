// _tools/check-word-mark.js - 翻译练习「句子里标出词库词」校验
//
// A. utils/word-mark.js
//   1) bookWordSet：核心语料 + 该书导入词都在集合里
//   2) targetWordSet：本题目标词（q.words）进集合
//   3) inBook：原形命中；屈折也要命中（improved → improve，否则句子里大半标不出来）
//   4) markTokens：目标词 / 词库词 / 标点三态正确，且不改原数组
//   5) countMarked 统计正确
// B. practice.vue 契约
//   - 题干 / 参考答案 / 英文选项三处都按标记上样式
//   - setupQuestion 里算 bookSet + markTokens + 计数 + 提示语
//   - 图例存在（目标词 / 词库已收 / 含 N 个词库词），样式类齐全
const { load } = require('./lib/load');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'uniapp');

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
const mark = load('utils/word-mark.js', { wordbook, lemmaCandidates: lemmaMod.lemmaCandidates });
const { tokenize } = load('utils/tokenize.js');

const BID = 'fj_zsb_core';

(async () => {
  console.log('\n== A1. bookWordSet：核心语料 + 导入词 ==');
  const st = store.get();
  st.customWords = st.customWords || {};
  st.customWords[BID] = [{ id: 'cw-mark-1', word: 'zzbookword', pos: 'n.', meaning: '词书里的自造词', lv: 1 }];
  store.save(st); store.flush();

  const set = mark.bookWordSet(BID);
  assert(!!set['zzbookword'], '包含该书导入词');
  assert(Object.keys(set).length > 100, '包含核心语料（共 ' + Object.keys(set).length + ' 词）');
  assert(!set['zzznotaword'], '不在词书里的词不在集合里');

  console.log('\n== A2. targetWordSet：本题目标词 ==');
  const tset = mark.targetWordSet([{ w: 'inevitable', pos: 'adj.', m: '不可避免的' }, { w: 'Negotiate' }]);
  assert(!!tset['inevitable'], '目标词入集合');
  assert(!!tset['negotiate'], '大小写不敏感');
  eq(Object.keys(mark.targetWordSet([])).length, 0, '空数组 → 空集合');
  eq(Object.keys(mark.targetWordSet(null)).length, 0, 'null 安全');

  console.log('\n== A3. inBook：原形 + 屈折都要命中 ==');
  const mini = { improve: true, study: true };
  assert(mark.inBook('improve', mini), '原形命中');
  assert(mark.inBook('IMPROVE', mini), '大写也命中');
  assert(mark.inBook('improved', mini), '屈折命中（improved → improve）');
  assert(mark.inBook('studies', mini), '屈折命中（studies → study）');
  assert(!mark.inBook('banana', mini), '词书里没有的词不命中');
  assert(!mark.inBook('', mini), '空串不命中');
  assert(!mark.inBook('improve', null), '集合为空时安全返回 false');
  assert(!mark.inBook(null, mini), 'token 为空时安全');

  console.log('\n== A4. markTokens：三态正确、不改原数组 ==');
  const raw = tokenize('I improved my study habits, and it worked.');
  const marked = mark.markTokens(raw, mini, { habits: true });
  eq(marked.length, raw.length, '条数一致');
  const byText = {};
  marked.forEach(t => { byText[t.t] = t });
  assert(byText['improved'] && byText['improved'].book && !byText['improved'].target, 'improved → 词库词');
  assert(byText['study'] && byText['study'].book, 'study → 词库词');
  assert(byText['habits'] && byText['habits'].target && byText['habits'].book, 'habits → 目标词（同时也是词库词）');
  assert(byText['and'] && !byText['and'].book, '普通词不标');
  const puns = marked.filter(t => !t.w);
  assert(puns.length > 0 && puns.every(t => t.book === false && t.target === false),
    '标点 / 空格一律不标（' + puns.length + ' 个非词片段）');
  assert(raw.every(t => t.book === undefined), '原数组未被修改（返回新数组）');

  console.log('\n== A5. countMarked ==');
  const c = mark.countMarked(marked);
  eq(c.target, 1, '目标词数');
  assert(c.book >= 3, '词库词数（含目标词）' + c.book);
  eq(mark.countMarked([]).book, 0, '空数组统计为 0');

  console.log('\n== A6. 端到端：真实句子能标出词书词 ==');
  {
    const sent = 'We should improve our service.';
    const st2 = store.get();
    st2.customWords[BID] = [{ id: 'cw-mark-2', word: 'improve', pos: 'v.', meaning: '改进', lv: 1 }];
    store.save(st2); store.flush();
    const set2 = mark.bookWordSet(BID);
    const tk = mark.markTokens(tokenize(sent), set2, { improve: true });
    const hit = tk.filter(t => t.book).map(t => t.t);
    assert(hit.indexOf('improve') >= 0, '句子里的 improve 被标出来（' + hit.join(', ') + '）');
    assert(tk.filter(t => t.target).length === 1, '目标词只有 1 个');
  }

  console.log('\n== B. practice.vue 契约 ==');
  const page = fs.readFileSync(path.join(ROOT, 'pkgStudy/pages/practice/practice.vue'), 'utf8');
  assert(/from '\.\.\/\.\.\/\.\.\/utils\/word-mark'/.test(page), '页面引入 word-mark');
  assert(/bookWordSet/.test(page) && /markTokens/.test(page) && /countMarked/.test(page), '用到三个能力');
  // 三处渲染：题干 / 参考答案带标记样式；英文选项【必须不带】标记 ——
  // 汉译英时选项就是候选答案，标出来等于把正确答案高亮（泄题）
  const clsExpr = "item.w ? (item.target ? 'tok tg' : (item.book ? 'tok bk' : 'tok')) : 'pun'";
  assert(page.split(clsExpr).length - 1 >= 2, '题干 / 参考答案都按标记上样式');
  assert(page.indexOf("tk.w ? 'tok' : 'pun'") >= 0, '英文选项只分词不上标记（防泄题）');
  assert(page.split(clsExpr).length - 1 === 2, '标记样式只出现在题干 / 参考答案两处');
  {
    const fn = page.match(/setupQuestion\(i\) \{[\s\S]*?\n    \}/);
    assert(!!fn, '定位到 setupQuestion');
    assert(fn && /bookWordSet\(/.test(fn[0]), '出题时算词书集合');
    assert(fn && /targetWordSet\(q\.words\)/.test(fn[0]), '目标词取本题 q.words');
    assert(fn && /markCount = countMarked/.test(fn[0]), '统计词库词数');
    assert(fn && /markNote = /.test(fn[0]), '提示语在 JS 里算好');
    assert(fn && /promptIsEn \? this\.promptTokens : this\.answerTokens/.test(fn[0]), '汉译英时统计参考答案那一侧');
    assert(fn && /optionTokens = \(q\.options \|\| \[\]\)\.map\(t => \(isEnglish\(t\) \? tokenize\(t\) : \[\]\)\)/.test(fn[0]),
      '选项生成走纯分词（不带 markTokens）');
  }
  assert(/class="mark-legend"/.test(page), '图例容器存在');
  assert(/class="lg tg"/.test(page) && /class="lg bk"/.test(page), '图例两档（目标词 / 词库已收）');
  assert(/v-if="markCount\.book"/.test(page), '没有词库词时不显示图例');
  assert(/\.tok\.bk/.test(page) && /\.tok\.tg/.test(page), '两种标记样式齐全');
  assert(/\.lg\.tg/.test(page) && /\.lg\.bk/.test(page), '图例样式齐全');

  console.log('');
  if (fail) { console.error('FAILED: ' + fail + ' 项不过'); process.exit(1); }
  console.log('ALL PASS');
})().catch(e => { console.error(e); process.exit(1); });
