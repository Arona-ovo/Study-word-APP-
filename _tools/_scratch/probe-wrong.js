// 临时探针：确认错题记录与展示链路
const { load } = require('../lib/load');
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
  SENTENCES: sentences.SENTENCES, iplus1, store, sentenceIndex, lemma: lemmaMod.lemma,
  chatCompletion: () => Promise.reject(new Error('AI 未配置'))
});
const session = load('utils/session.js', {
  iplus1, wordbook, api, sentenceIndex, SENTENCES: sentences.SENTENCES, WORDS: words.WORDS
});

(async () => {
  const qs = await session.buildSession(3, 'fj_zsb_core');
  console.log('题目 sid:', qs.map(q => q.sid));
  engine.recordAnswer(qs[0], 'fail', 'choice', '我的错误答案');
  const st = store.get();
  console.log('st.wrong 条数:', st.wrong.length, JSON.stringify(st.wrong[0]));
  console.log('wrongList():', JSON.stringify(engine.wrongList()));
  console.log('reviewQuestions():', engine.reviewQuestions().length);
  console.log('homeOverview().wrongCount:', load('utils/wordbook.js', {
    store, WORDBOOKS: wordbooks.WORDBOOKS, getBook: wordbooks.getBook, wordIdsOfBook: wordbooks.wordIdsOfBook,
    setUserBookProvider: wordbooks.setUserBookProvider, WORDS: words.WORDS, streak: engine.streak, dateStr: engine.dateStr
  }).homeOverview().wrongCount);
})();
