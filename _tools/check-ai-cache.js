// _tools/check-ai-cache.js - AI 底层缓存校验（只读）
//
// 目标（用户原话转需求）：
//   · 搜索 / 练习里生成过的句子、临时看过的 AI 例句，要存在 APP 底层，
//     **不是存进词书** —— 不污染"我要背什么"
//   · 之后再搜 / 再看同一个词，能直接翻出这些内容（离线也行）
//   · 设置页能清，但只能**按类别整体清**：缓存单词 / 缓存例句，不做逐条删
//
// 本脚本守三条契约：
//   1) 缓存模块自身：写入 / 命中 / 去重 / 过期 / 分类清空
//   2) 与生成链路打通：sentence-api 生成 → 落缓存；explainWord → 落缓存
//   3) 离线可读：未配置 AI 时，只要缓存里有就能看到（不联网、不抛错）
const { load } = require('./lib/load');

const mem = {};
const toasts = [];

// 可控时钟：用来验证 7 天过期
let NOW = 1700000000000;
const RealDate = Date;
function FakeDate(...a) {
  return a.length ? new RealDate(...a) : new RealDate(NOW);
}
FakeDate.now = () => NOW;
FakeDate.parse = RealDate.parse;
FakeDate.UTC = RealDate.UTC;
FakeDate.prototype = RealDate.prototype;

global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: (o) => toasts.push(String((o && o.title) || ''))
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
const eq = (a, b, label) => {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
};

(async () => {
  const aiCache = load('utils/ai-cache.js', { Date: FakeDate });

  console.log('== 1. 模块接口 ==');
  ['init', 'raw', 'stats', 'findWord', 'rememberWord', 'words',
    'sentenceBySig', 'rememberSentence', 'sentences', 'sentencesOf',
    'clearWords', 'clearSentences', 'clearAll'].forEach(fn =>
      assert(typeof aiCache[fn] === 'function', '导出 ' + fn));

  aiCache.init();
  eq(aiCache.stats().words, 0, '初始缓存单词数');
  eq(aiCache.stats().sentences, 0, '初始缓存例句数');

  console.log('== 2. 单词缓存：写入 → 命中（忽略大小写与首尾空格）==');
  aiCache.rememberWord({ word: 'Resilient', pos: 'adj.', meaning: '有韧性的', src: 'ai' });
  const w1 = aiCache.findWord('resilient');
  assert(!!w1, 'findWord 命中');
  eq(w1.word, 'resilient', '单词归一化为小写');
  eq(w1.meaning, '有韧性的', '释义保留');
  assert(!!aiCache.findWord('  RESILIENT '), '忽略大小写与空格也能命中');
  eq(aiCache.findWord('unknownword'), null, '未缓存的词返回 null');

  console.log('== 3. 单词缓存去重：同一个词只留最新一条 ==');
  aiCache.rememberWord({ word: 'resilient', pos: 'adj.', meaning: '新释义' });
  eq(aiCache.words().length, 1, '条数仍为 1');
  eq(aiCache.findWord('resilient').meaning, '新释义', '内容更新为最新');

  console.log('== 4. 例句缓存：写入 → 按词捞回 ==');
  aiCache.rememberSentence({ sid: 's1', en: 'She is resilient.', zh: '她很有韧性。', word: 'resilient', source: 'ai' });
  aiCache.rememberSentence({ sid: 's2', en: 'He bounced back.', zh: '他重新振作。', word: 'resilient', source: 'ai' });
  aiCache.rememberSentence({ sid: 's3', en: 'Other word here.', zh: '别的词。', word: 'other', source: 'ai' });
  eq(aiCache.sentencesOf('resilient').length, 2, 'resilient 有 2 条例句');
  eq(aiCache.sentencesOf('Resilient').length, 2, '大小写不敏感');
  eq(aiCache.sentencesOf('none').length, 0, '未缓存的词返回空');
  eq(aiCache.sentences().length, 3, '缓存例句总数 3');
  // 同一 sid 重写不产生重复
  aiCache.rememberSentence({ sid: 's1', en: 'She is resilient!', zh: '她很有韧性！', word: 'resilient', source: 'ai' });
  eq(aiCache.sentences().length, 3, '重写同一 sid 不新增条数');

  console.log('== 5. 签名缓存（供 sentence-api 复用）==');
  const sig = 'book|scene|alpha'
  aiCache.rememberSentence({ sid: 'sx', en: 'Alpha sentence.', zh: '阿尔法句子。', word: 'alpha', source: 'ai' }, sig);
  const bySig = aiCache.sentenceBySig(sig)
  assert(!!bySig && bySig.en === 'Alpha sentence.', '按签名命中缓存');
  eq(aiCache.sentenceBySig('nope'), null, '未知签名返回 null');

  console.log('== 6. 过期淘汰（7 天）==');
  aiCache.rememberWord({ word: 'stale', meaning: '旧词' });
  assert(!!aiCache.findWord('stale'), '刚写入可命中');
  NOW += 7 * 24 * 3600 * 1000 + 1000;
  eq(aiCache.findWord('stale'), null, '超过 7 天 → 淘汰');
  eq(aiCache.sentenceBySig(sig), null, '签名缓存同样过期');

  console.log('== 7. 分类整体清空 ==');
  aiCache.rememberWord({ word: 'keep', meaning: '保留' });
  aiCache.rememberSentence({ sid: 'k1', en: 'Keep sentence.', zh: '保留例句。', word: 'keep', source: 'ai' });
  eq(aiCache.stats().words >= 1, true, '清空前有单词');
  aiCache.clearWords();
  eq(aiCache.stats().words, 0, '清空缓存单词后为 0');
  eq(aiCache.stats().sentences >= 1, true, '清空单词不影响例句');
  aiCache.clearSentences();
  eq(aiCache.stats().sentences, 0, '清空缓存例句后为 0');
  eq(aiCache.sentenceBySig(sig), null, '清例句后签名索引一并失效');

  console.log('== 8. 容量上限（防本地存储膨胀）==');
  for (let i = 0; i < 2050; i++) aiCache.rememberWord({ word: 'w' + i, meaning: 'm' + i });
  assert(aiCache.words().length <= 2000, '单词缓存不超过 2000 条（实际 ' + aiCache.words().length + '）');
  eq(aiCache.findWord('w2049').meaning, 'm2049', '最新写入仍在（旧的被挤掉）');

  console.log('== 9. 与生成链路打通 ==');
  aiCache.clearAll();
  const store = load('utils/store.js');
  const lemmaMod = load('utils/lemma.js');
  const words = load('data/words.js');
  const sentences = load('data/sentences.js');
  const wordbooks = load('data/wordbooks.js', { WORDS: words.WORDS });
  const sentenceIndex = load('utils/sentence-index.js', {
    SENTENCES: sentences.SENTENCES, WORDS: words.WORDS, lemmaCandidates: lemmaMod.lemmaCandidates
  });
  const iplus1 = load('utils/iplus1.js', {
    WORDS: words.WORDS, getBook: wordbooks.getBook, wordbook: {}, lemma: lemmaMod.lemma
  });
  let aiOn = true;
  const http = load('services/http.js');
  const aiContent = load('services/ai-content.js', {
    aiCache,
    chatCompletion: () => Promise.resolve({
      content: JSON.stringify({
        word: 'gumption', pos: 'n.', meaningZh: '进取心',
        examples: [{ en: 'It takes gumption.', zh: '这需要进取心。' }]
      })
    }),
  isAIEnabled: () => aiOn,
  getAIConfig: () => ({}),
  chatEndpoint: () => 'https://x/v1/chat/completions',
  ServiceError: http.ServiceError,
  // AI 分项开关：这里一律放行（默认全开），本脚本不测省 token 那条链路
  aiFeature: () => {},
  request: () => Promise.reject(new Error('no net'))
  });
  const api = load('utils/sentence-api.js', {
  // AI 分项开关：测试里一律放行（默认全开），省 token 那条链路另有脚本验证
  featureOn: () => true,
    aiCache,
    SENTENCES: sentences.SENTENCES, iplus1, store, sentenceIndex, lemma: lemmaMod.lemma,
    chatCompletion: () => Promise.reject(new Error('no ai in test'))
  });

  const ex = await aiContent.explainWord('gumption');
  eq(ex.fromCache, false, '首次走模型');
  eq(aiCache.stats().words, 1, '释义写入底层缓存');
  eq(aiCache.stats().sentences >= 1, true, '例句也写入底层缓存');

  // 关掉 AI：缓存里有的话，照样能看（离线可读）
  aiOn = false;
  const ex2 = await aiContent.explainWord('gumption');
  eq(ex2.fromCache, true, '关掉 AI 后仍命中缓存');
  eq(ex2.meaningZh, '进取心', '缓存释义正确');
  eq(ex2.examples.length >= 1, true, '缓存例句也一并返回');

  // 真没缓存又没 AI → 抛可降级错误，不静默
  let threw = null;
  try { await aiContent.explainWord('never-seen-before') } catch (e) { threw = e }
  assert(!!threw && threw.notConfigured === true, '无缓存且未配置 → notConfigured（可降级）');

  // sentence-api 生成的句子也落缓存
  aiCache.clearAll();
  const s = await api.generateSentence({
    bookId: 'fj_zsb_core', level: 'lv1', scene: '日常',
    newWords: [{ word: 'improve', pos: 'v.', meaning: '改善' }],
    knownWords: ['we', 'must', 'it'], constraints: {}, excludeSids: []
  });
  assert(!!s && !!s.en, '语料兜底能产出句子');
  eq(aiCache.stats().sentences >= 1, true, '生成的句子进入底层缓存');

  console.log('== 10. 存储隔离：独立 key，不与学习进度混 ==');
  const keys = Object.keys(mem);
  assert(keys.indexOf('fj_ai_cache_v1') >= 0, '使用独立 key fj_ai_cache_v1');
  eq(keys.indexOf('fj_sentence_cache'), -1, '不再往学习进度里塞缓存');
  // 清缓存不能动学习数据
  store.init();
  const st = store.get();
  st.mastery['probe'] = { m: 4, seen: 9, correct: 9 };
  store.save(st);
  aiCache.clearAll();
  eq(!!store.get().mastery['probe'], true, '清缓存后掌握度仍在');

  console.log('');
  console.log(fail === 0 ? 'AI 底层缓存校验全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
