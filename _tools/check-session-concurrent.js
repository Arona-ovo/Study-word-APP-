// _tools/check-session-concurrent.js - 出题并发化 + 写盘节流 校验（只读，不改源码）
//
// 覆盖三件事：
//   ① buildSession / buildDrillSession 是分批并发的（并发度受控，不是全并发，也不是串行）
//   ② 并发没有破坏去重：一组题里 sid 不重复、目标词轮换正常
//   ③ store / ai-cache 的落盘节流：连续 save 合并成一次写，flush 立即写
const { load } = require('./lib/load');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');

const mem = {};
let writes = 0;
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { writes++; mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- 依赖装配（与 check-pick.js 同一套） ----------
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

let aiCalls = 0;
const chatCompletion = async () => {
  aiCalls++;
  // 故意不含目标词：走"校验不通过 → 重试"路径，用来验证重试次数在并发下不会翻倍
  return { content: '{"en":"This is a simple practice sentence for you.","zh":"这是一个给你练习的简单句子。","scene":"校园生活"}' };
};

const api = load('utils/sentence-api.js', {
  // AI 分项开关：测试里一律放行（默认全开），省 token 那条链路另有脚本验证
  featureOn: () => true,
  aiCache,
  SENTENCES: sentences.SENTENCES, iplus1, store, sentenceIndex, lemma: lemmaMod.lemma,
  chatCompletion
});

// 给 api 套一层探针：统计"同时在飞的请求数"峰值
let inflight = 0;
let peak = 0;
let total = 0;
// 取消探针：发出第 stopAt 个请求时把 stop 置 true，用来模拟"用户中途退出页面"
let stop = false;
let stopAt = -1;
const probedApi = {
  generateSentence: async (req) => {
    inflight++;
    total++;
    if (inflight > peak) peak = inflight;
    if (stopAt > 0 && total >= stopAt) stop = true;
    try {
      await sleep(15);              // 模拟一次网络往返
      return await api.generateSentence(req);
    } finally {
      inflight--;
    }
  }
};

const session = load('utils/session.js', {
  iplus1, wordbook, api: probedApi, sentenceIndex, SENTENCES: sentences.SENTENCES, WORDS: words.WORDS
});

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function is(cond, m, extra) { cond ? ok(m + (extra ? ' = ' + extra : '')) : bad(m + (extra ? ' = ' + extra : '')); }

function resetProbe() { inflight = 0; peak = 0; total = 0; }

async function main() {
  store.init();
  aiCache.init();
  wordbook.ensureShape();

  console.log('== 1. buildSession：分批并发 ==');
  resetProbe();
  const qs = await session.buildSession(10, wordbook.currentBookId());
  is(qs.length === 10, '题目数量正确', qs.length);
  is(peak > 1, '确实并发了（峰值 > 1）', peak);
  is(peak <= 3, '并发度受控（峰值 ≤ 3）', peak);
  // 不能写死 === 10：批内并发时可能撞到同一句，设计内会再串行补一次（见 buildSession 的 retry），
  // 约十分之一的概率出现 11。真正要盯的是"有没有翻倍" —— 那才是并发化失败的实锤。
  is(total >= 10 && total <= 13, '请求次数没变多（并发没有造成重复请求）', total);

  console.log('== 2. 并发不能破坏去重 ==');
  const sids = qs.map(q => q.sid);
  is(new Set(sids).size === sids.length, '一组题 sid 无重复', new Set(sids).size + '/' + sids.length);
  const allWords = [];
  qs.forEach(q => (q.wordIds || []).forEach(id => allWords.push(id)));
  const uniqWords = new Set(allWords);
  is(uniqWords.size >= 8, '目标词保持轮换（不同词数 ≥ 8）', uniqWords.size);
  const prompts = new Set(qs.map(q => q.prompt));
  is(prompts.size === qs.length, '题干无重复', prompts.size + '/' + qs.length);

  console.log('== 3. buildDrillSession：同样并发，且不崩 ==');
  resetProbe();
  const drill = await session.buildDrillSession(6, wordbook.currentBookId());
  is(drill.length === 6, '薄弱点专练题量正确', drill.length);
  is(peak <= 3, '薄弱点专练并发度受控（峰值 ≤ 3）', peak);

  console.log('== 4. 同签名的并发请求只发一次 ==');
  aiCache.clearSentences();
  aiCalls = 0;
  const req1 = iplus1.buildRequest(wordbook.currentBookId(), { newCount: 1 });
  await api.generateSentence(req1);
  const callsAlone = aiCalls;

  aiCache.clearSentences();
  aiCalls = 0;
  await Promise.all([
    api.generateSentence(req1),
    api.generateSentence(req1),
    api.generateSentence(req1)
  ]);
  const callsTogether = aiCalls;
  is(callsAlone > 0, '单独一次确实打了 AI', callsAlone);
  is(callsTogether === callsAlone, '三次同签名并发只发一次请求', callsTogether + ' vs ' + callsAlone);

  console.log('== 5. store 落盘节流 ==');
  store.flush();
  await sleep(900);
  const st = store.get();
  // 一次作答会连着写两次（engine.recordAnswer + wordbook.setMastery）→ 应合并成一次落盘
  writes = 0;
  store.save(st);
  store.save(st);
  await sleep(60);
  is(writes === 1, '一次作答的两次 save 合并成一次写', writes);

  // 高频连写（导入 / 批量场景）：200ms 内 20 次 save，不应该写 20 次
  writes = 0;
  for (let i = 0; i < 20; i++) {
    store.save(st);
    await sleep(10);
  }
  is(writes <= 2, '200ms 内 20 次 save 最多写 2 次', writes);
  await sleep(900);

  store.flush();
  writes = 0;
  store.save(st);
  const beforeGet = store.get();
  is(beforeGet === st, '改内存后立即能读到（get 不受节流影响）');
  store.flush();
  is(writes === 1, 'flush 立即落盘', writes);
  writes = 0;
  store.flush();
  is(writes === 0, '没脏数据时 flush 不写（空转保护）', writes);

  console.log('== 6. ai-cache 落盘节流 ==');
  await sleep(900);
  writes = 0;
  aiCache.rememberWord({ word: 'throttle', meaning: '节流', src: 'ai' });
  aiCache.rememberWord({ word: 'debounce', meaning: '防抖', src: 'ai' });
  is(writes === 0, '连续 remember 不立刻写盘', writes);
  await sleep(900);
  is(writes === 1, '窗口结束合并成一次写', writes);

  writes = 0;
  aiCache.clearWords();
  is(writes === 1, 'clearWords 立即落盘（清了就不能复活）', writes);
  is(aiCache.stats().words === 0, '清空后条数为 0', aiCache.stats().words);

  // 用户点「开始背单词」后立刻退出：出题必须能半路收手。
  // 不只是为了不朗读 —— AI 生成是要花钱的，退出后还把 10 题全生成完等于白烧 token。
  console.log('== 7. 中途取消：shouldStop 生效 ==');
  resetProbe();
  stop = false;
  stopAt = 3;                       // 第一批（3 路并发）发出后就"退出页面"
  const partial = await session.buildSession(10, wordbook.currentBookId(), () => stop);
  is(partial.length < 10, '提前收尾，没有把 10 题全生成完', partial.length);
  is(total < 10, '后续请求被省掉了（不再继续烧 AI）', total);
  is(peak <= 3, '取消过程里并发度仍未失控', peak);
  stopAt = -1;

  resetProbe();
  stop = false;
  const full = await session.buildSession(10, wordbook.currentBookId(), () => false);
  is(full.length === 10, '不取消时行为不变（仍是完整 10 题）', full.length);
  // 同上：允许 retry 带来的小幅上浮，只盯"有没有明显变多"
  is(total >= 10 && total <= 13, '不取消时请求次数正常', total);

  resetProbe();
  const immediate = await session.buildSession(10, wordbook.currentBookId(), () => true);
  is(immediate.length === 0, '一开始就取消 → 一题都不该生成', immediate.length);
  is(total === 0, '一开始就取消 → 一个请求都不发', total);

  // shouldStop 自己抛异常也不能把出题搞崩（页面状态可能已经半销毁）
  resetProbe();
  let threw = false;
  try {
    await session.buildSession(6, wordbook.currentBookId(), () => { throw new Error('boom'); });
  } catch (e) {
    threw = true;
  }
  is(!threw, 'shouldStop 抛异常时静默当作"不取消"，不向上冒泡');

  console.log('== 8. 句子尽量含词书词 ==');
  // 8a. buildRequest 带 learningWords（书中未掌握的词），且不含本题目标词
  const rq = iplus1.buildRequest(wordbook.currentBookId(), { newCount: 1 });
  is(Array.isArray(rq.learningWords) && rq.learningWords.length > 0,
    'buildRequest 返回非空 learningWords（书里有未掌握的词）', Array.isArray(rq.learningWords) ? rq.learningWords.length : 'N/A');
  is(!rq.learningWords.includes(rq.newWords[0].word), 'learningWords 不含本题目标词');
  // 8b. validateSentence：词书学习词按"允许的词"算，不算生词堆砌
  {
    const reqM = {
      newWords: [{ word: 'college' }],
      knownWords: ['the', 'of', 'this', 'enjoy', 'and', 'students', 'campus', 'life'],
      learningWords: ['degree']
    };
    const base = 'The students of this college enjoy campus life and';
    const v1 = iplus1.validateSentence(base + ' programs here.', '这些学生喜欢这所学院的校园生活。', reqM);
    is(v1.ok, '基准句通过（1 个陌生词允许）', v1.ok);
    const v2 = iplus1.validateSentence(base + ' programs majors here.', '这些学生喜欢这所学院的校园生活。', reqM);
    is(!v2.ok, '两个陌生词仍会被拒（生词堆砌规则没被放宽破坏）');
    const v3 = iplus1.validateSentence(base + ' degree programs here.', '这些学生喜欢这所学院的校园生活。', reqM);
    is(v3.ok, '词书学习词 degree 不算陌生词（句子能带书里的词）');
  }
  // 8c. AI prompt 鼓励行 + 本地兜底排序契约
  const apiSrc = fs.readFileSync(path.join(ROOT, 'utils/sentence-api.js'), 'utf8');
  is(apiSrc.indexOf('尽量自然地用上这些词书里正在学的词') >= 0, 'AI prompt 有鼓励使用词书学习词的一行');
  is(apiSrc.indexOf('(b.bookHits - a.bookHits)') >= 0, '本地兜底按词书词命中数加分排序');

  console.log(fail === 0 ? '\n出题并发化 + 落盘节流 校验全部通过 ✓' : '\n有 ' + fail + ' 项未通过 ✗');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('脚本异常：', e);
  process.exit(1);
});
