// _tools/check-dict.js - 校验词形还原 + 查词典优先级（只读）
const { load } = require('./lib/load');

// mock uni 存储（store.js 用到）
const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

const lemma = load('utils/lemma.js');
const words = load('data/words.js');
const common = load('data/common-words.js');
const storeMod = load('utils/store.js');
const dict = load('utils/dict.js', {
  WORDS: words.WORDS,
  COMMON_RAW: common.COMMON_RAW,
  store: storeMod,
  lemmaCandidates: lemma.lemmaCandidates,
  lemma: lemma.lemma
});

let fail = 0;
function assert(cond, msg) {
  if (!cond) { fail++; console.error('  ✗ ' + msg); }
  else console.log('  ✓ ' + msg);
}

console.log('— 词形还原 —');
[
  ['improving', 'improve'],
  ['studies', 'study'],
  ['carried', 'carry'],
  ['children', 'child'],
  ['went', 'go'],
  ['bigger', 'big'],
  ['happier', 'happy'],
  ['quickly', 'quick'],
  ['possibly', 'possible'],
  ['lived', 'live'],
  ['stopped', 'stop'],
  ['running', 'run'],
  ['knives', 'knife'],
  ['is', 'be'],
  ['making', 'make'],
  ['larger', 'large']
].forEach(([w, want]) => {
  const cands = lemma.lemmaCandidates(w);
  assert(cands.indexOf(want) >= 0 || lemma.lemma(w) === want, w + ' → ' + want + '（候选：' + cands.slice(0, 3).join('/') + '）');
});

console.log('— 查词 —');
const cases = [
  ['improve', 'core'],
  ['is', 'common'],
  ['the', 'common'],
  ['improving', 'core'],
  ['practices', 'core'],
  ['happier', 'common'],
  ['English', 'common'],
  ['zzzzz', 'none']
];
cases.forEach(([w, src]) => {
  const r = dict.lookup(w);
  assert(r.src === src, w + ' → ' + src + '（实际 ' + r.src + '，释义：' + (r.meaning || '-') + '）');
});

// 用户导入词应能被命中
const st = storeMod.get();
// 用一个确定不在核心词书里的词，验证导入词优先级
st.customWords = { custom_inbox: [{ word: 'gumption', pos: 'n.', meaning: '进取心；魄力' }] };
storeMod.save(st);
dict.invalidateCache();
const r2 = dict.lookup('gumption');
assert(r2.src === 'custom' && r2.meaning === '进取心；魄力', '导入词 gumption → custom（实际 ' + r2.src + '）');

console.log('— 常用词典规模 —');
console.log('  词条数：' + common.COMMON_RAW.length);
const dupCheck = {};
let dup = 0;
common.COMMON_RAW.forEach(line => {
  const k = line.split('|')[0].toLowerCase();
  if (dupCheck[k]) { dup++; console.error('  ✗ 重复词条：' + k); }
  dupCheck[k] = 1;
  if (line.split('|').length < 3) { fail++; console.error('  ✗ 格式错误：' + line); }
});
assert(dup === 0, '无重复词条');

console.log(fail === 0 ? '\n全部通过' : '\n失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
