// _tools/check-wordbook-topup.js - 两件事的回归守卫
//
// A. AI 生成词书「查重补足」
//   用户口径：要 5 个，撞上 2 个词书里已有的 → 应该再生成 2 个（共问出 7 个），
//            而不是直接少给 2 个。
//   1) ai-content.generateWordbook 收到 banned（词书已有词）后，重复词不占额度：
//      继续问下一轮，最终凑够 5 个新词，dup 计数 = 2
//   2) 不传 banned 时同样的模型表现 → 一轮就够，dup = 0（说明确实是 banned 在起作用）
//   3) banned 会作为 exclude 真的发给模型（少问也少撞）
//   4) wordbook-task 把目标词书的已有词算出来传给 generateWordbook
//
// B. 外部 AI 提示词「一次给全单词 + 例句」
//   1) 提示词要求 word|pos|meaning|en|zh 竖线格式（例句有逗号，CSV 会碎，故禁用 CSV）
//   2) 严格按提示词写出来的样例能被 parseSharedText 解析，例句/翻译都在
//   3) 兼容旧的 CSV 格式；markdown 表格仍然解析不了（所以必须禁）
//   4) 自带例句的词入库后带 exampleSid → generateForImported 一个请求都不发（省时间）
const { load } = require('./lib/load');

const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {},
  showModal: (o) => { if (o && o.success) o.success({ confirm: true }) }
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

// ---------- 真实模块 ----------
const settings = load('utils/settings.js'); settings.init();
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
  store, WORDBOOKS: wordbooks.WORDBOOKS, getBook: wordbooks.getBook,
  wordIdsOfBook: wordbooks.wordIdsOfBook, setUserBookProvider: wordbooks.setUserBookProvider,
  WORDS: words.WORDS, streak: engine.streak, dateStr: engine.dateStr
});
const config = load('services/config.js', { settings });
const http = load('services/http.js');

// 可控 LLM：每轮先吐 2 个"词书里已有的词"，其余是新词
let seq = 0;
let totalReturned = 0;      // 模型一共给了多少个词（用来验证"共问出 7 个"）
let lastTexts = [];
const BANNED = ['alphaexists', 'betaexists'];

function letterCode(n) {
  let s = '';
  let x = n;
  do {
    s = String.fromCharCode(97 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return s;
}

const llmState = { behavior: 'reject' };
const llm = {
  chatCompletion: (messages) => {
    const um = (messages || []).filter(m => m && m.role === 'user').pop();
    const text = (um && um.content) || '';
    lastTexts.push(text);
    if (typeof llmState.behavior !== 'function') return Promise.resolve({ content: String(llmState.behavior) });
    const m = /本次需要：(\d+) 个单词/.exec(text);
    const want = m ? Number(m[1]) : 0;
    return Promise.resolve(llmState.behavior(want || 20, text));
  },
  chatCompletionStream: async (messages, opts) => {
    const r = await llm.chatCompletion(messages, opts);
    const content = (r && r.content) || '';
    if (opts && typeof opts.onDelta === 'function') {
      for (let i = 0; i < content.length; i += 16) opts.onDelta(content.slice(i, i + 16));
    }
    return { content };
  },
  complete: () => Promise.resolve(''),
  LLMError: http.ServiceError
};

const aiContent = load('services/ai-content.js', {
  aiCache,
  chatCompletion: llm.chatCompletion,
  isAIEnabled: config.isAIEnabled,
  getAIConfig: config.getAIConfig,
  chatEndpoint: config.chatEndpoint,
  ServiceError: http.ServiceError,
  // AI 分项开关：这里一律放行（默认全开），本脚本不测省 token 那条链路
  aiFeature: () => {},
  breakerKeyOf: (u) => String(u || ''),
  resetBreaker: () => {},
  chatCompletionStream: llm.chatCompletionStream,
  request: () => Promise.reject(new Error('no net'))
});

// 模型每轮给 want 个词，其中前 2 个是"词书里已有"的（want<3 时全给新词，否则永远凑不够）
llmState.behavior = (want) => {
  const list = [];
  const dupCount = want >= 3 ? 2 : 0;
  for (let i = 0; i < want; i++) {
    if (i < dupCount) list.push({ word: BANNED[i], pos: 'n.', meaning: '已有词' });
    else list.push({ word: 'zq' + letterCode(seq++), pos: 'n.', meaning: '新词' });
  }
  totalReturned += want;
  return { content: JSON.stringify({ bookName: '测试词书', words: list }) };
};

const commonWords = load('data/common-words.js');
const dict = load('utils/dict.js', {
  WORDS: words.WORDS, COMMON_RAW: commonWords.COMMON_RAW, store,
  lemmaCandidates: lemmaMod.lemmaCandidates, lemma: lemmaMod.lemma
});
const iplus1 = load('utils/iplus1.js', {
  WORDS: words.WORDS, getBook: wordbooks.getBook, wordbook, lemma: lemmaMod.lemma
});
let genBatchCalls = 0;
const importer = load('utils/importer.js', {
  WORDS: words.WORDS, WORDBOOKS: wordbooks.WORDBOOKS, getBook: wordbooks.getBook,
  store, iplus1,
  generateBatch: (reqs) => { genBatchCalls++; return Promise.resolve((reqs || []).map(() => ({}))) },
  dict
});

(async () => {
  console.log('\n== A1. 查重补足：要 5 个、撞掉 2 个 → 继续问，凑够 5 个 ==');
  settings.set({ ai: { enabled: true, provider: 'deepseek', baseURL: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat' } });
  totalReturned = 0; lastTexts = []; seq = 0;
  const g = await aiContent.generateWordbook({ topic: '商务英语', count: 5, banned: BANNED });
  eq(g.words.length, 5, '最终拿到新词数');
  eq(g.dup, 2, '被查重丢掉的词数');
  eq(totalReturned, 7, '模型一共给出的词数（5 + 补足 2）');
  assert(!g.words.some(w => BANNED.indexOf(w.word) >= 0), '结果里不含词书已有的词');
  assert(g.rounds >= 2, '至少问了两轮（rounds=' + g.rounds + '）');

  console.log('\n== A2. 不传 banned：同样表现下一轮就够（说明是 banned 在起作用）==');
  totalReturned = 0; seq = 1000;
  const g0 = await aiContent.generateWordbook({ topic: '商务英语', count: 5 });
  eq(g0.words.length, 5, '无 banned 时也拿满 5 个');
  eq(g0.dup, 0, '无 banned 时没有重复（旧行为：直接入库）');

  console.log('\n== A3. banned 真的发给模型当排除项 ==');
  lastTexts = [];
  seq = 2000;
  await aiContent.generateWordbook({ topic: '商务英语', count: 5, banned: BANNED });
  const joined = lastTexts.join('\n');
  assert(joined.indexOf(BANNED[0]) >= 0, '请求里带上已有词（' + BANNED[0] + '）');

  console.log('\n== A4. wordbook-task 把目标词书已有词传进去 ==');
  {
    const BID = 'fj_zsb_core';
    const st = store.get();
    st.customWords = st.customWords || {};
    st.customWords[BID] = [{ id: 'cw-topup-1', word: 'zzmyword', pos: 'n.', meaning: '我导入过的词', lv: 1 }];
    store.save(st); store.flush();

    let captured = null;
    const fakeGen = async (opts) => {
      captured = opts;
      return { bookName: 'x', words: [], auto: false, complete: true, dup: 0, rounds: 1 };
    };
    const task = load('utils/wordbook-task.js', {
      generateWordbook: fakeGen, WORDBOOK_COUNT: aiContent.WORDBOOK_COUNT, importer, wordbook
    });
    await task.start({ topic: '商务英语', count: 5, mode: 'merge', bookId: BID });
    const bannedGot = (captured && captured.banned) || [];
    assert(Array.isArray(captured && captured.banned), 'generateWordbook 收到 banned 数组');
    assert(bannedGot.indexOf('zzmyword') >= 0, 'banned 含该书导入过的词 zzmyword');
    assert(bannedGot.length > 100, 'banned 也含核心语料（共 ' + bannedGot.length + ' 词）');
    task.reset();
    // 清理
    const st2 = store.get();
    st2.customWords[BID] = [];
    store.save(st2); store.flush();
  }

  console.log('\n== B1. 外部提示词要求「单词 + 例句 + 翻译」一次给全 ==');
  const p = importer.buildWordListPrompt({ topic: '商务英语', count: 30 });
  [['word|pos|meaning|en|zh', '指定竖线表头'],
   ['英文单词|词性|中文释义|英文例句|例句中文翻译', '指定五字段顺序'],
   ['例句', '要求给例句'],
   ['不要输出序号', '禁止序号'],
   ['markdown', '禁止 markdown 表格'],
   ['代码块', '禁止代码块围栏'],
   ['正好 30 行数据', '固定数量行']].forEach(([needle, label]) => {
    assert(p.indexOf(needle) >= 0, label + '（含「' + needle + '」）');
  });
  assert(importer.buildWordListPrompt({ topic: 'x', count: 0 }).indexOf('尽可能完整') >= 0, '不限数量 → 要求完整覆盖');

  console.log('\n== B2. 按提示词写出来的回复，真的能被解析（例句/翻译都在）==');
  const reply = [
    'word|pos|meaning|en|zh',
    'improve|v.|改进；改善|We should improve our service, and fast.|我们应该尽快改进我们的服务。',
    'invoice|n.|发票|Please send me the invoice by email.|请用邮件把发票发给我。'
  ].join('\n');
  const parsed = importer.parseSharedText(reply);
  eq(parsed.length, 2, '解析条数');
  eq(parsed[0] && parsed[0].word, 'improve', '字段一 = 单词');
  eq(parsed[0] && parsed[0].pos, 'v.', '字段二 = 词性');
  eq(parsed[0] && parsed[0].meaning, '改进；改善', '字段三 = 释义（多义项保留）');
  eq(parsed[0] && parsed[0].exampleEn,
    'We should improve our service, and fast.',
    '字段四 = 英文例句（含逗号也完整 —— 这就是不用 CSV 的原因）');
  eq(parsed[0] && parsed[0].exampleZh, '我们应该尽快改进我们的服务。', '字段五 = 例句翻译');

  console.log('\n== B3. 兼容旧格式 / 反例 ==');
  const csv = importer.parseSharedText('word,pos,meaning\ninevitable,adj.,不可避免的');
  eq(csv.length, 1, '旧 CSV 格式仍可解析');
  eq(csv[0] && csv[0].meaning, '不可避免的', 'CSV 释义正确');
  const mdTable = [
    '| word | pos | meaning |',
    '| --- | --- | --- |',
    '| improve | v. | 提高 |'
  ].join('\n');
  eq(importer.parseSharedText(mdTable).length, 0, 'markdown 表格解析不出（故提示词必须禁）');

  console.log('\n== B4. 自带例句 → 入库即带 exampleSid，不再逐词问模型 ==');
  {
    const BID = 'ub-topup-test';
    const st = store.get();
    st.customWords = st.customWords || {};
    st.customWords[BID] = [];
    store.save(st); store.flush();

    importer.importIntoBook(parsed, BID);
    const bucket = (store.get().customWords || {})[BID] || [];
    eq(bucket.length, 2, '入库条数');
    assert(bucket.every(w => !!w.exampleSid), '每条都打了 exampleSid');
    assert(bucket[0] && bucket[0].exampleEn.indexOf('and fast') >= 0, '例句原文落库');

    genBatchCalls = 0;
    const ex = await importer.generateForImported(BID, undefined, {
      only: parsed.map(x => x.word), concurrency: 3, gap: 0
    });
    eq(genBatchCalls, 0, '补例句请求数（自带例句 → 0 次）');
    eq((ex || []).length, 0, '无需再生成的条数');
  }

  console.log('');
  if (fail) { console.error('FAILED: ' + fail + ' 项不过'); process.exit(1); }
  console.log('ALL PASS');
})().catch(e => { console.error(e); process.exit(1); });
