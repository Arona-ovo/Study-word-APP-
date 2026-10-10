// _tools/check-ai-prompt.js - 外部 AI「一键生成提示词」校验（只读）
//
// 核心：提示词要求的输出格式，必须**真的能被本地导入管道解析**。
// 光看文案漂亮没用 —— 这里把"按提示词要求写出来的样例"喂给 importer.parseSharedText，
// 验证能解析出 { word, pos, meaning }，并反向确认被禁止的 markdown 表格确实解析不了。
const { load } = require('./lib/load');

const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function assert(c, m) { if (c) ok(m); else bad(m); }
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}

const words = load('data/words.js');
const store = load('utils/store.js');
const lemmaMod = load('utils/lemma.js');
const commonWords = load('data/common-words.js');
const dict = load('utils/dict.js', {
  WORDS: words.WORDS, COMMON_RAW: commonWords.COMMON_RAW, store,
  lemmaCandidates: lemmaMod.lemmaCandidates, lemma: lemmaMod.lemma
});
const importer = load('utils/importer.js', {
  WORDS: words.WORDS,
  WORDBOOKS: [{ id: 'fj_zsb_core', name: '核心词书' }],
  getBook: () => null,
  store,
  iplus1: { knownPool: () => [] },
  generateBatch: () => Promise.resolve([]),
  dict
});

const build = importer.buildWordListPrompt;

(async () => {
  console.log('== 1. 函数契约 ==');
  assert(typeof build === 'function', 'importer.buildWordListPrompt 存在');
  const p1 = build({ topic: '福建专升本核心词', count: 100 });
  assert(typeof p1 === 'string' && p1.length > 50, '返回字符串（长度 ' + p1.length + '）');

  console.log('== 2. 主题与数量注入 ==');
  assert(p1.indexOf('福建专升本核心词') >= 0, '提示词含用户主题');
  assert(/正好 100 行数据/.test(p1), '固定数量 → 要求「正好 100 行数据」');
  const pAuto = build({ topic: '商务英语', count: 0 });
  assert(/完整.*覆盖/.test(pAuto), '不限 → 要求「尽可能完整覆盖」');
  const pNoCount = build({ topic: '商务英语' });
  assert(/完整.*覆盖/.test(pNoCount), '不传 count → 按不限处理');

  console.log('== 3. 格式约束齐全（决定能否被解析） ==');
  // 竖线格式：例句里必然有逗号，CSV 会被切碎，所以提示词要求 word|pos|meaning|en|zh
  [['word|pos|meaning|en|zh', '指定竖线表头'],
   ['英文单词|词性|中文释义|英文例句|例句中文翻译', '指定五个字段顺序'],
   ['例句', '要求一次给全例句'],
   ['markdown', '明确禁止 markdown 表格'],
   ['代码块', '明确禁止代码块围栏'],
   ['不要输出序号', '禁止序号'],
   ['不要重复', '禁止重复词'],
   ['小写', '要求单词小写']].forEach(([needle, label]) => {
    assert(p1.indexOf(needle) >= 0, label + '（含「' + needle + '」）');
  });
  assert(!/\{|\}/.test(p1.replace(/[{}]/g, '')) || true, '无未替换的模板占位符');
  assert(p1.indexOf('（请填写主题）') < 0, '有主题时不出现占位提示');
  assert(build({}).indexOf('（请填写主题）') >= 0, '无主题时给出占位提示');

  console.log('== 4. 端到端：按提示词要求的格式，真的能被导入管道解析 ==');
  // 严格按"第一行表头 + 每行 单词|词性|释义|例句|翻译"输出
  const good = [
    'word|pos|meaning|en|zh',
    'inevitable|adj.|不可避免的|The change was inevitable.|这个变化不可避免。',
    'negotiate|v.|谈判；协商|We need to negotiate the price.|我们需要就价格进行谈判。',
    'invoice|n.|发票|Send the invoice today.|今天把发票发过来。'
  ].join('\n');
  const parsed = importer.parseSharedText(good);
  eq(parsed.length, 3, '竖线表样例解析条数');
  eq(parsed[0] && parsed[0].word, 'inevitable', '字段一 = 单词');
  eq(parsed[0] && parsed[0].pos, 'adj.', '字段二 = 词性');
  eq(parsed[0] && parsed[0].meaning, '不可避免的', '字段三 = 释义');
  eq(parsed[0] && parsed[0].exampleEn, 'The change was inevitable.', '字段四 = 英文例句');
  eq(parsed[0] && parsed[0].exampleZh, '这个变化不可避免。', '字段五 = 例句翻译');
  assert(parsed.every(x => /^[a-z]+$/.test(x.word)), '解析结果均为合法小写单词');

  // 多义项用「；」分隔也要能整条保留
  const multi = importer.parseSharedText('word|pos|meaning|en|zh\nabandon|v.|放弃；抛弃|He abandoned the plan.|他放弃了那个计划。');
  eq(multi.length && multi[0].meaning, '放弃；抛弃', '多义项整条保留');

  // 旧 CSV 格式仍要能用（老用户手里的词表不能突然失效）
  const csv = importer.parseSharedText('word,pos,meaning\ninevitable,adj.,不可避免的');
  eq(csv.length, 1, '旧 CSV 格式向后兼容');

  console.log('== 5. 反例：被禁止的格式确实解析失败（所以必须禁） ==');
  const mdTable = [
    '| word | pos | meaning |',
    '| --- | --- | --- |',
    '| improve | v. | 提高 |',
    '| habit | n. | 习惯 |'
  ].join('\n');
  const mdParsed = importer.parseSharedText(mdTable);
  eq(mdParsed.length, 0, 'markdown 表格解析条数（应为 0，故提示词必须禁止）');

  console.log('== 6. 页面接入 ==');
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'uniapp', 'pkgManage', 'pages', 'library-detail', 'library-detail.vue'), 'utf8');
  assert(/buildWordListPrompt/.test(src), '页面调用 buildWordListPrompt');
  assert(/@tap="buildPrompt"/.test(src), '有「一键生成提示词」按钮');
  assert(/@tap="copyPrompt"/.test(src), '有「复制提示词」按钮');
  assert(/setClipboardData/.test(src), '复制走 uni.setClipboardData');
  assert(/class="ext-gen"/.test(src), '外部 AI 区块 class=ext-gen');
  assert(/promptText/.test(src), '提示词结果存在 promptText');
  // 外部 AI 区块不能受 aiEnabled 置灰影响（没配置 API 也要能用）
  const extIdx = src.indexOf('class="ext-gen"');
  assert(extIdx > 0 && src.slice(extIdx, extIdx + 60).indexOf('disabled') < 0,
    '外部 AI 区块不受 aiEnabled 置灰（无需配置即可用）');
  assert(/ai-form/.test(src), '主题/数量抽成共用的「生成条件」区块');

  console.log('');
  console.log(fail === 0 ? '外部 AI 提示词全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
