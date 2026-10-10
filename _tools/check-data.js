// _tools/check-data.js - 词库 / 句库数据校验（只读）
const path = require('path');
const { load } = require('./lib/load');

const WORDS = load('data/words.js').WORDS;
const SENTENCES = load('data/sentences.js').SENTENCES;
const baseline = require('./baseline-words-64.json');

let fail = 0;
function bad(msg) { fail++; console.error('  ✗ ' + msg); }
function good(msg) { console.log('  ✓ ' + msg); }

console.log('— 词库 —');
console.log('  总词数：' + WORDS.length);

const byId = {};
const byWord = {};
WORDS.forEach(w => {
  if (byId[w.id]) bad('id 重复：' + w.id);
  byId[w.id] = w;
  const k = w.w.toLowerCase();
  if (byWord[k]) bad('单词重复：' + w.w);
  byWord[k] = w;
  if (!w.w || !w.m || !w.pos) bad('字段缺失：' + JSON.stringify(w));
  if ([1, 2, 3, 4].indexOf(w.lv) < 0) bad('lv 非法（应为 1-4）：' + w.w + ' → ' + w.lv);
  if (/[^\x00-\x7F]/.test(w.w)) bad('单词含非 ASCII：' + w.w);
});

baseline.forEach(b => {
  const w = byId[b.id];
  if (!w) bad('基线词缺失 id=' + b.id + ' (' + b.w + ')');
  else if (w.w !== b.w) bad('基线词被改动 id=' + b.id + '：' + b.w + ' → ' + w.w);
});
if (!fail) good('前 64 词（id 与词形）与基线完全一致');

const lvCount = { 1: 0, 2: 0, 3: 0, 4: 0 };
WORDS.forEach(w => { lvCount[w.lv]++; });
console.log('  分档：Lv1=' + lvCount[1] + ' Lv2=' + lvCount[2] + ' Lv3=' + lvCount[3] + ' Lv4=' + lvCount[4]);

console.log('— 句库 —');
console.log('  总句数：' + SENTENCES.length);
const sById = {};
SENTENCES.forEach(s => {
  if (sById[s.id]) bad('句 id 重复：' + s.id);
  sById[s.id] = s;
  if (!s.en || !s.zh) bad('句 ' + s.id + ' 缺少 en/zh');
  if (/[a-zA-Z]{4,}/.test(s.zh)) bad('句 ' + s.id + ' 中文含英文串：' + s.zh);
  const len = s.en.split(/\s+/).filter(Boolean).length;
  if (len < 8 || len > 30) bad('句 ' + s.id + ' 长度 ' + len + ' 不在 8-30：' + s.en);
  (s.w || []).forEach(id => { if (!byId[id]) bad('句 ' + s.id + ' 引用了不存在的词 id：' + id); });
  if (!(s.w || []).length) bad('句 ' + s.id + ' 未关联任何词');
});

// 覆盖：每个词至少被一句引用
const covered = {};
SENTENCES.forEach(s => (s.w || []).forEach(id => { covered[id] = (covered[id] || 0) + 1; }));
const noSentence = WORDS.filter(w => !covered[w.id]).map(w => w.w);
if (noSentence.length) bad('没有例句的词 ' + noSentence.length + ' 个：' + noSentence.slice(0, 20).join(', ') + (noSentence.length > 20 ? ' …' : ''));
else good('每个词都至少有 1 句例句');

const dist = {};
Object.keys(covered).forEach(id => { const n = Math.min(covered[id], 5); dist[n] = (dist[n] || 0) + 1; });
console.log('  每词例句数分布：' + JSON.stringify(dist));
const avgLen = (SENTENCES.reduce((a, s) => a + s.en.split(/\s+/).filter(Boolean).length, 0) / SENTENCES.length).toFixed(1);
console.log('  平均句长：' + avgLen + ' 词');

console.log(fail === 0 ? '\n全部通过' : '\n失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
