// _tools/check-pick.js - 抽题质量校验（只读）：10 题是否命中目标新词、是否重复
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
  setUserBookProvider: wordbooks.setUserBookProvider,
  WORDS: words.WORDS, streak: engine.streak, dateStr: engine.dateStr
});
const iplus1 = load('utils/iplus1.js', {
  WORDS: words.WORDS, getBook: wordbooks.getBook, wordbook, lemma: lemmaMod.lemma
});
const api = load('utils/sentence-api.js', {
  // AI 分项开关：测试里一律放行（默认全开），省 token 那条链路另有脚本验证
  featureOn: () => true,
  aiCache,
  SENTENCES: sentences.SENTENCES, iplus1, store, sentenceIndex, lemma: lemmaMod.lemma,
  // AI 未配置（测试环境）→ chatCompletion 抛错 → 自动降级本地语料
  chatCompletion: () => Promise.reject(new Error('AI 未配置'))
});
const session = load('utils/session.js', {
  iplus1, wordbook, api, sentenceIndex, SENTENCES: sentences.SENTENCES, WORDS: words.WORDS
});

let fail = 0;
function bad(m) { fail++; console.error('  ✗ ' + m); }

async function main() {
  console.log('索引规模：' + JSON.stringify(sentenceIndex.size()));

  const qs = await session.buildSession(10, 'fj_zsb_core');
  console.log('出题数：' + qs.length);

  const sids = new Set();
  let hitCount = 0;
  qs.forEach((q, i) => {
    if (sids.has(q.sid)) bad('第 ' + (i + 1) + ' 题 sid 重复：' + q.sid);
    sids.add(q.sid);
    if (!q.options || q.options.length !== 4) bad('第 ' + (i + 1) + ' 题选项数不是 4');
    if (q.options[q.answerIndex] !== q.answer) bad('第 ' + (i + 1) + ' 题正确答案下标不匹配');
    if (!q.en && !q.prompt) bad('第 ' + (i + 1) + ' 题缺少题干');
    // 目标新词是否真的出现在题干/答案里
    const text = (String(q.prompt) + ' ' + String(q.answer)).toLowerCase();
    const textLemmas = (text.match(/[a-z']+/g) || []).map(t => lemmaMod.lemma(t));
    const targets = (q.wordIds || []).map(id => (words.WORDS.find(w => w.id === id) || {}).w).filter(Boolean);
    const hit = targets.some(t => {
      const tl = lemmaMod.lemma(String(t).toLowerCase());
      return textLemmas.indexOf(tl) >= 0 || text.indexOf(String(t).toLowerCase()) >= 0;
    });
    if (hit) hitCount++;
    console.log('  ' + (i + 1) + '. [' + (hit ? '命中' : '未命中') + '] ' + (targets.join(',') || '-') + ' → ' + String(q.prompt).slice(0, 46));
  });

  console.log('命中目标新词的题数：' + hitCount + ' / ' + qs.length);
  if (hitCount < qs.length * 0.8) bad('命中率过低（' + hitCount + '/' + qs.length + '），抽题仍未硬性命中新词');
  if (sids.size !== qs.length) bad('存在重复题目');

  // 单会话内目标词应尽量轮换，不要 10 题围着同一个词
  const wordSet = new Set();
  qs.forEach(q => (q.wordIds || []).forEach(id => wordSet.add(id)));
  console.log('本组涉及的不同目标词：' + wordSet.size + ' 个');
  if (wordSet.size < 5) bad('目标词过于集中（仅 ' + wordSet.size + ' 个）');

  console.log(fail === 0 ? '\n全部通过' : '\n失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
