// _tools/check-batches.js - 校验分批规则（只读）
const { load } = require('./lib/load');

const words = load('data/words.js');
// 核心 640 词 + 内置词书共享表：批次里两种 id 都可能出现
const lex = load('data/lexicon.js');
const ALL = lex.allWords();
const ALL_BY_ID = {};
ALL.forEach(w => { ALL_BY_ID[w.id] = w });
const wb = load('data/wordbooks.js');

let fail = 0;
function bad(m) { fail++; console.error('  ✗ ' + m); }

console.log('内置词书 ' + wb.WORDBOOKS.length + ' 本');
wb.WORDBOOKS.forEach(book => {
  const wordsInBook = book.batches.reduce((a, b) => a + b.wordIds.length, 0);
  if (!wordsInBook) return;   // 「我的导入词书」的占位批是空的，属于预期
  const seen = {};
  let sizes = { min: 99, max: 0 };
  book.batches.forEach((b) => {
    sizes.min = Math.min(sizes.min, b.wordIds.length);
    sizes.max = Math.max(sizes.max, b.wordIds.length);
    if (b.wordIds.length < 6) bad(book.id + ' 批次 ' + b.id + ' 词数过少：' + b.wordIds.length);
    b.wordIds.forEach(id => {
      if (seen[id]) bad(book.id + '：词 id ' + id + ' 重复出现在批次 ' + b.id);
      seen[id] = 1;
      if (!ALL_BY_ID[id]) bad(book.id + ' 批次 ' + b.id + ' 引用了不存在的词 id ' + id);
    });
  });
  console.log('  ✓ ' + book.id.padEnd(14) + book.batches.length + ' 批 / ' +
    book.batches.reduce((a, b) => a + b.wordIds.length, 0) + ' 词（每批 ' + sizes.min + '-' + sizes.max + '）');
});

console.log('');
const book = wb.WORDBOOKS[0];

// 核心词书（fj_zsb_core）= 旧版核心 640 词 + 后续追加批次。
// 前 32 批必须原样保留（词 id 与顺序都不能动），否则老用户本地的学习记录会对不上。
const LEGACY_COUNT = 32;
const legacy = book.batches.slice(0, LEGACY_COUNT);
legacy.forEach((b, i) => {
  if (b.index !== i) bad('批次 index 不连续：' + b.id);
  if (b.wordIds.length < 12 || b.wordIds.length > 20) bad('批次 ' + b.id + ' 词数 ' + b.wordIds.length + ' 不在 12-20');
});
console.log('  前 ' + LEGACY_COUNT + ' 批（旧版核心词）示例：' +
  legacy.slice(0, 3).map(b => b.name + '(' + b.wordIds.length + ')').join(' / '));

const seenCore = {};
legacy.forEach(b => b.wordIds.forEach(id => { seenCore[id] = 1 }));
const missingCore = words.WORDS.filter(w => !seenCore[w.id]);
if (missingCore.length) bad('核心 640 词里没进前 32 批的有 ' + missingCore.length + ' 个');
else console.log('  ✓ 核心 ' + words.WORDS.length + ' 词全部在前 ' + LEGACY_COUNT + ' 批里（老用户进度可复用）');

console.log(fail === 0 ? '\n全部通过' : '\n失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
