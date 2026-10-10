// _tools/check-coverage.js - 句库 token 的词义覆盖率（只读）
// 输出未收录 token 的频次 Top，直接照着补 data/common-words.js
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
const common = load('data/common-words.js');
const sentences = load('data/sentences.js');
const store = load('utils/store.js');
const dict = load('utils/dict.js', {
  WORDS: words.WORDS,
  COMMON_RAW: common.COMMON_RAW,
  store,
  lemmaCandidates: lemmaMod.lemmaCandidates,
  lemma: lemmaMod.lemma
});

const freq = {};
sentences.SENTENCES.forEach(s => {
  const toks = String(s.en || '').toLowerCase().match(/[a-z']+/g) || [];
  const seen = new Set();
  toks.forEach(t => {
    if (seen.has(t)) return;
    seen.add(t);
    freq[t] = (freq[t] || 0) + 1;
  });
});

const keys = Object.keys(freq);
let typeHit = 0, instTotal = 0, instHit = 0;
const missing = [];
keys.forEach(k => {
  const r = dict.lookup(k);
  const n = freq[k];
  instTotal += n;
  if (r.found) { typeHit++; instHit += n; }
  else missing.push([k, n]);
});
missing.sort((a, b) => b[1] - a[1]);

console.log('句库 token 类型数：' + keys.length + '，实例数：' + instTotal);
console.log('类型覆盖率：' + Math.round(typeHit / keys.length * 100) + '%（' + typeHit + '/' + keys.length + '）');
console.log('实例覆盖率：' + Math.round(instHit / instTotal * 100) + '%（' + instHit + '/' + instTotal + '）');
console.log('未收录类型数：' + missing.length);
console.log('未收录 Top 80（按出现句数降序）：');
console.log(missing.slice(0, 80).map(m => m[0] + '(' + m[1] + ')').join(' '));

process.exit(0);
