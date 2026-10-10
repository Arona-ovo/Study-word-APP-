// _tools/check-wordbook-task.js - AI 生成词书「后台任务 + 暂停/停止」校验（只读）
//
// 核心验证：
//  1) 任务模块与页面解耦：subscribe / get / pause / resume / stop / reset 齐全
//  2) 全流程跑通：生成 → 去重 → 写库 → 补例句，结束时状态 done
//  3) 暂停真的会把流程挂住（在下一个检查点），继续后能跑完
//  4) 停止真的会终止（抛出 CANCEL → status=stopped），且已写入的词保留
//  5) 生成阶段就停止 → 回收新建的空词书，不留垃圾
//  6) 页面契约：退出页面只取消订阅不停止任务；onShow 重新同步状态
const { load } = require('./lib/load');

const mem = {};
let toastCount = 0;
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => { toastCount++ },
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 定位用：未处理的 Promise 拒绝打印堆栈，避免直接崩掉看不到上下文
process.on('unhandledRejection', (e) => {
  console.error('UNHANDLED REJECTION:', e && e.stack ? e.stack : JSON.stringify(e))
})

// ---- 真实模块 ----
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
const commonWords = load('data/common-words.js');
const dict = load('utils/dict.js', {
  WORDS: words.WORDS, COMMON_RAW: commonWords.COMMON_RAW, store,
  lemmaCandidates: lemmaMod.lemmaCandidates, lemma: lemmaMod.lemma
});
const config = load('services/config.js', { settings });
const http = load('services/http.js');

// ---- 可控的 LLM mock ----
// behavior: (n) => Promise<{content}>；每轮返回一批唯一的新词
let seq = 0;
let perRound = 5;      // 每轮给几个词（造多轮，制造出"检查点"）
let maxRounds = 99;
// 纯小写字母（词形校验 [a-z][a-z'-]{1,19} 不接受数字，也不接受单字母）
function letterCode(n) {
  let s = '';
  let x = n;
  do { s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26) - 1 } while (x >= 0)
  return s
}
function mkWords(k) {
  const out = [];
  for (let i = 0; i < k; i++) {
    seq++
    out.push({ word: 'z' + letterCode(seq), pos: 'n.', meaning: '测试词' + seq })
  }
  return out
}
let behavior = (n) => {
  if (n > maxRounds) return Promise.resolve({ content: '{"bookName":"B","words":[]}' })
  return Promise.resolve({ content: JSON.stringify({ bookName: 'B', words: mkWords(perRound) }) })
}
// 流式版本：整块结果分两片喂 onDelta，再按非流式的约定返回，
// 这样"词书生成走流式"这条新路径也能被现有用例覆盖
const llm = {
  chatCompletion: () => behavior(seqCalls++),
  chatCompletionStream: async (messages, opts) => {
    const r = await behavior(seqCalls++);
    const content = (r && r.content) || '';
    if (opts && typeof opts.onDelta === 'function') {
      const half = Math.ceil(content.length / 2);
      opts.onDelta(content.slice(0, half));
      opts.onDelta(content.slice(half));
    }
    return { content: content };
  },
  LLMError: http.ServiceError
}
let seqCalls = 1

const aiContent = load('services/ai-content.js', {
  chatCompletion: llm.chatCompletion,
  chatCompletionStream: llm.chatCompletionStream,
  isAIEnabled: config.isAIEnabled,
  getAIConfig: config.getAIConfig,
  chatEndpoint: config.chatEndpoint,
  ServiceError: http.ServiceError,
  // AI 分项开关：这里一律放行（默认全开），本脚本不测省 token 那条链路
  aiFeature: () => {},
  breakerKeyOf: (u) => String(u || ''),
  resetBreaker: () => {},
  request: () => Promise.reject(new Error('no net'))
});

// 例句生成：不打网络，直接走本地语料兜底（sentence-api 会自动降级）
// 但请求前先睡一下 —— 补例句改成并发之后，不模拟往返耗时会瞬间跑完，
// 「在补例句阶段停止」这类用例就抓不到中间态了。
const EX_DELAY = 150;
const iplus1 = load('utils/iplus1.js', {
  WORDS: words.WORDS, getBook: wordbooks.getBook, wordbook, lemma: lemmaMod.lemma
});
const api = load('utils/sentence-api.js', {
  // AI 分项开关：测试里一律放行（默认全开），省 token 那条链路另有脚本验证
  featureOn: () => true,
  aiCache,
  SENTENCES: sentences.SENTENCES, iplus1, store, sentenceIndex, lemma: lemmaMod.lemma,
  chatCompletion: async () => { await sleep(EX_DELAY); throw new Error('no ai') }
});
const importer = load('utils/importer.js', {
  WORDS: words.WORDS, WORDBOOKS: wordbooks.WORDBOOKS, getBook: wordbooks.getBook,
  store, iplus1, generateBatch: api.generateBatch, dict
});

// 任务模块（注入它依赖的模块，与页面无关 —— 这正是"能后台跑"的前提）
const task = load('utils/wordbook-task.js', {
  generateWordbook: aiContent.generateWordbook,
  WORDBOOK_COUNT: aiContent.WORDBOOK_COUNT,
  importer,
  wordbook
});

(async () => {
  settings.set({ ai: { enabled: true, baseURL: 'https://x/v1', apiKey: 'k12345678', model: 'm' } });

  console.log('== 1. 模块接口 ==');
  ['get', 'subscribe', 'pause', 'resume', 'stop', 'start', 'reset', 'isBusy', 'isRunning', 'isPaused']
    .forEach(fn => assert(typeof task[fn] === 'function', '导出 ' + fn));
  eq(task.get().status, 'idle', '初始状态');
  eq(task.isBusy(), false, '初始 isBusy');
  eq(task.pause(), false, '空闲时 pause 无效');
  eq(task.stop(), false, '空闲时 stop 无效');

  console.log('== 2. 全流程跑通（生成 → 去重 → 写库 → 补例句） ==');
  perRound = 4; maxRounds = 2; seqCalls = 1;
  const events = []
  const unsub = task.subscribe(s => events.push(s.status + ':' + s.phase))
  const p = task.start({ topic: '测试主题', count: 8, mode: 'new', bookId: '', bookName: '任务测试书' })
  eq(task.isBusy(), true, 'start 后 isBusy')
  await p
  const s1 = task.get()
  eq(s1.status, 'done', '结束状态')
  eq(s1.added > 0, true, '新增词数 > 0（实际 ' + s1.added + '）')
  eq(!!s1.resultText, true, '有结果文案')
  eq(!!s1.resultBookId, true, '返回新建词书 id（可一键切换）')
  eq(s1.phase, '', '结束后 phase 清空')
  eq(events.length > 2, true, '订阅者收到 ' + events.length + ' 次状态推送')
  eq(wordbook.isUserBook(s1.resultBookId), true, '词书确实建出来了')
  unsub()
  task.reset()
  eq(task.get().status, 'idle', 'reset 后回到 idle')

  console.log('== 3. 暂停：挂在检查点，继续后能跑完 ==');
  // 用"不限"制造多轮抓取；每轮延迟 120ms，让暂停能落在轮与轮之间
  perRound = 3; maxRounds = 99; seqCalls = 1;
  let delay = 120;
  const slow = (n) => new Promise(res =>
    setTimeout(() => res({ content: JSON.stringify({ bookName: 'B', words: mkWords(perRound) }) }), delay))
  behavior = slow;
  const p3 = task.start({ topic: '暂停测试', count: 0, mode: 'merge', bookId: wordbooks.WORDBOOKS[1].id, bookName: '' })
  // 等到至少跑完第一轮
  for (let i = 0; i < 100 && task.get().round < 1; i++) await sleep(5)
  eq(task.pause(), true, 'pause 成功')
  const paused = task.get()
  eq(paused.status, 'paused', '状态 = paused')
  eq(task.isPaused(), true, 'isPaused')
  eq(task.isBusy(), true, '暂停中仍算 busy（不能重复 start）')
  eq(await task.start({ topic: '再开一个' }), false, '暂停中不允许再开新任务')
  // 暂停是"协作式"的：当前这一次请求会跑完，然后在下一轮的检查点挂住。
  // 所以必须等到"在飞的那批落地 + 闸门挂起"之后再取基线，否则基线会取早。
  // 用轮询等进度稳定（连续 3 次采样不变），比写死 sleep 稳。
  let stable = 0, prev = -1
  for (let i = 0; i < 200 && stable < 3; i++) {
    await sleep(30)
    const g = task.get().got
    if (g === prev) stable++
    else { stable = 0; prev = g }
  }
  const gotAtPause = task.get().got
  eq(stable >= 3, true, '进度已稳定（说明在检查点挂住了）')
  eq(gotAtPause > 0, true, '暂停前已有进度（基线 ' + gotAtPause + ' 词）')
  await sleep(400)
  eq(task.get().got, gotAtPause, '暂停期间进度不再增长（真的挂住了，基线 ' + gotAtPause + '）')
  eq(task.resume(), true, 'resume 成功')
  // 给足时间跑到下一轮（gate 轮询 100ms + 请求往返）
  await sleep(500)
  eq(task.get().got > gotAtPause, true, '继续后进度恢复增长（' + gotAtPause + ' → ' + task.get().got + '）')
  // 让它结束（停止）
  task.stop()
  await p3
  eq(task.get().status === 'stopped' || task.get().status === 'done', true, '最终状态 = ' + task.get().status)
  task.reset()

  console.log('== 4a. 停止（问模型阶段）：立刻结束，什么都没写 ==');
  // 「不限」模式下抓取不会自己结束，此时停止 = 在生成阶段中断，尚未写库
  perRound = 5; maxRounds = 99; seqCalls = 1;
  const p4a = task.start({ topic: '生成期停止', count: 0, mode: 'new', bookId: '', bookName: '不该留下的书A' })
  for (let i = 0; i < 200 && task.get().got < 5; i++) await sleep(10)
  eq(task.stop(), true, 'stop 成功')
  await p4a
  const s4a = task.get()
  eq(s4a.status, 'stopped', '状态 = stopped')
  eq(s4a.added, 0, '生成阶段停止 → 未写入任何词')
  eq(wordbook.listBooks().some(b => b.name === '不该留下的书A'), false, '空词书已回收')
  task.reset()

  console.log('== 4b. 停止（补例句阶段）：已导入的词保留 ==');
  // 用固定数量（会很快抓完），等进入「补例句」阶段再停 —— 这时词已经写进词书了
  perRound = 3; maxRounds = 99; seqCalls = 1;
  const targetBook = wordbooks.WORDBOOKS[1].id
  const beforeCount = importer.customWordsOf(targetBook).length
  const p4b = task.start({ topic: '例句期停止', count: 6, mode: 'merge', bookId: targetBook, bookName: '' })
  // 等到真的写库完成（added > 0 且进入 examples 阶段）；
  // 并发后这段很短，条件里带上 isBusy，跑完了就别空转
  for (let i = 0; i < 300 && task.get().phase !== 'examples' && task.isBusy(); i++) await sleep(10)
  eq(task.get().phase, 'examples', '已进入补例句阶段')
  eq(task.get().added, 6, '词已导入 ' + task.get().added + ' 个')
  // 让它至少补完一条，验证停止在例句阶段同样生效
  for (let i = 0; i < 300 && task.get().exDone < 1; i++) await sleep(10)
  eq(task.stop(), true, 'stop 成功')
  await p4b
  const s4b = task.get()
  eq(s4b.status, 'stopped', '状态 = stopped')
  eq(!!s4b.resultText, true, '有停止提示文案')
  eq(s4b.resultText.indexOf('已导入') >= 0, true, '停止文案说明已导入的词数')
  const afterCount = importer.customWordsOf(targetBook).length
  eq(afterCount, beforeCount + 6, '已导入的词完整保留（' + beforeCount + ' → ' + afterCount + '）')
  eq(s4b.exDone < s4b.exTotal, true, '例句确实没补完（' + s4b.exDone + '/' + s4b.exTotal + '）')
  task.reset()

  console.log('== 5. 停止后不留空词书 ==');
  // 新建词书模式下，若在写库前被停止，连空书都不该留下
  perRound = 5; maxRounds = 99; seqCalls = 1;
  const booksBefore = wordbook.listBooks().length;
  const p5 = task.start({ topic: '空书测试', count: 0, mode: 'new', bookId: '', bookName: '会被回收的书' });
  await sleep(80);
  task.stop();
  await p5;
  const s5 = task.get();
  eq(s5.status, 'stopped', '状态 = stopped');
  eq(s5.added, 0, '停止时未写入任何词');
  eq(wordbook.listBooks().length, booksBefore, '词书数量未增加（没留下空词书）');
  eq(wordbook.listBooks().some(b => b.name === '会被回收的书'), false, '没有留下空词书');
  task.reset();
  console.log('== 6. 页面契约（退出页面不杀任务） ==');
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'uniapp', 'pkgManage', 'pages', 'library-detail', 'library-detail.vue'), 'utf8');
  assert(/utils\/wordbook-task/.test(src), '页面引入 wordbook-task');
  assert(/@tap="togglePause"/.test(src), '有「暂停/继续」按钮');
  assert(/@tap="stopGen"/.test(src), '有「停止生成」按钮');
  assert(/task\.subscribe\(/.test(src), 'onShow 订阅任务状态');
  assert(/onUnload\(\)[\s\S]{0,200}__unsub\(\)/.test(src), 'onUnload 只取消订阅');
  // 关键：onUnload / onHide 里不能出现 stop / cancel
  const unloadBody = src.slice(src.indexOf('onUnload('), src.indexOf('onUnload(') + 300)
  eq(/task\.stop|task\.reset|task\.cancel/.test(unloadBody), false, 'onUnload 不停止任务（后台继续跑）')
  assert(/taskBusy/.test(src) && /taskProgress/.test(src), '页面有 taskBusy / taskProgress 状态')
  assert(/gen-progress/.test(src), '有进度展示区块')

  console.log('');
  console.log(fail === 0 ? '后台生成任务全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
