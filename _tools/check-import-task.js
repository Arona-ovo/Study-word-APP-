// _tools/check-import-task.js - 「粘贴导入」三条老毛病的回归校验（只读）
//
//   A. 粘贴上限：输入框不能再用 5000 这种小 maxlength 把长词表悄悄截断
//   B. 导入变慢：补例句只能补「本次导入的词」，不能顺手还掉整本书的历史例句债；
//      且批量生成必须支持并发（原来串行 + 每条约 0.3s 间隔，100 词要几分钟）
//   C. 退出页面：导入任务必须在模块级后台活着 —— 能看进度、能暂停、能停止，
//      已入库的词一律保留（页面 onUnload 只退订，绝不 stop）
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load');

const ROOT = path.resolve(__dirname, '..', 'uniapp');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const mem = {};
const toasts = [];
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: (o) => { toasts.push((o && o.title) || '') },
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
const iplus1 = load('utils/iplus1.js', {
  WORDS: words.WORDS, getBook: wordbooks.getBook, wordbook, lemma: lemmaMod.lemma
});

// 例句请求 mock：固定延迟，用来量并发收益；内容故意不合格 → 走本地语料兜底
let delay = 120;
let calls = 0;
let inFlight = 0;
let maxInFlight = 0;
const api = load('utils/sentence-api.js', {
  // AI 分项开关：测试里一律放行（默认全开），省 token 那条链路另有脚本验证
  featureOn: () => true,
  aiCache,
  SENTENCES: sentences.SENTENCES, iplus1, store, sentenceIndex, lemma: lemmaMod.lemma,
  chatCompletion: async () => {
    calls++
    inFlight++
    if (inFlight > maxInFlight) maxInFlight = inFlight
    await sleep(delay)
    inFlight--
    return { content: '{"en":"nope","zh":"不合格","scene":"x"}' }
  }
});
const importer = load('utils/importer.js', {
  WORDS: words.WORDS, WORDBOOKS: wordbooks.WORDBOOKS, getBook: wordbooks.getBook,
  store, iplus1, generateBatch: api.generateBatch, dict
});
// 任务文案走 i18n：模块里是具名导入，沙箱要显式注入 t
const i18n = load('utils/i18n.js');
const importTask = load('utils/import-task.js', { importer, t: i18n.t });

// 造词：小写字母串，避开核心词典（否则会被判为"已存在"）
function mk(n) {
  let s = ''; let x = n;
  do { s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26) - 1 } while (x >= 0)
  return 'z' + s + 'q'
}
function csv(k, start) {
  const out = ['word,pos,meaning'];
  for (let i = 0; i < k; i++) {
    const w = mk((start || 0) + i);
    out.push(w + ',n.,测试词' + ((start || 0) + i));
  }
  return out.join('\n');
}

(async () => {
  console.log('== A. 粘贴上限（输入框不能被小 maxlength 截断） ==');
  const page = read('pkgManage/pages/library-detail/library-detail.vue');
  // 逐个 textarea 找（页面里还有一个是"提示词"展示框，别串台）
  // 注意：属性值里有 "e => ..."，所以不能拿第一个 ">" 当结束，必须匹配自闭合 "/>"
  const tas = page.match(/<textarea[\s\S]*?\/>/g) || [];
  const ta = tas.filter(x => x.indexOf('import-input') >= 0)[0];
  assert(!!ta, '定位到导入输入框');
  const ml = ta && ta.match(/maxlength="(-?\d+)"/);
  assert(!!ml, '输入框显式声明了 maxlength');
  const mlv = ml ? Number(ml[1]) : 0;
  // -1 = 不限；或者给一个明显够用的大值（5000 只能装 200 来行，AI 一次给几百词必被截）
  assert(mlv === -1 || mlv >= 100000, 'maxlength 不再是小上限（实际 ' + mlv + '）');
  assert(!/maxlength="5000"/.test(page), '旧的 5000 上限已移除');
  assert(/pasteFromClipboard/.test(page), '保留「粘贴」按钮（JS 赋值，天然不受 maxlength 影响）');

  console.log('== B1. 模块接口 ==');
  ['get', 'subscribe', 'pause', 'resume', 'stop', 'start', 'reset', 'isBusy', 'isRunning', 'isPaused']
    .forEach(fn => assert(typeof importTask[fn] === 'function', '导出 ' + fn));
  eq(importTask.get().status, 'idle', '初始状态');
  eq(importTask.isBusy(), false, '初始 isBusy');
  eq(importTask.pause(), false, '空闲时 pause 无效');
  eq(importTask.stop(), false, '空闲时 stop 无效');
  eq(await importTask.start({ text: '   ', bookId: 'b1' }), false, '空内容不启动');

  console.log('== B2. 全文入库：解析 → 落库 → 补例句 ==');
  const events = [];
  const unsub = importTask.subscribe(s => events.push(s.status + ':' + s.phase));
  const p = importTask.start({ text: csv(6, 100), bookId: 'bk_import' });
  eq(importTask.isBusy(), true, 'start 后 isBusy');
  await p;
  const s1 = importTask.get();
  eq(s1.status, 'done', '结束状态');
  eq(s1.added, 6, '新增词数');
  eq(s1.parsed, 6, '解析条数');
  eq(s1.phase, '', '结束后 phase 清空');
  assert(s1.examples > 0, '补到例句 ' + s1.examples + ' 条（本地语料兜底）');
  assert(!!s1.resultText, '有结果文案');
  assert(events.length > 2, '订阅者收到 ' + events.length + ' 次状态推送');
  eq(importer.customWordsOf('bk_import').length, 6, '词确实进了词书');
  unsub();
  importTask.reset();
  eq(importTask.get().status, 'idle', 'reset 后回到 idle');

  console.log('== B2b. 粘贴自带例句 → 不再逐个问模型，直接收工 ==');
  {
    const bkEx = 'bk_withex';
    const st = store.get();
    st.customWords = st.customWords || {};
    st.customWords[bkEx] = [];
    store.save(st); store.flush();
    const piped = [
      'word|pos|meaning|en|zh',
      'zebraone|n.|斑马一|A zebra ran across the road.|一只斑马跑过了马路。',
      'zebratwo|n.|斑马二|Two zebras rested under the tree.|两只斑马在树下休息。'
    ].join('\n');
    const p2 = importTask.start({ text: piped, bookId: bkEx });
    await p2;
    const s2 = importTask.get();
    eq(s2.status, 'done', '结束状态');
    eq(s2.added, 2, '新增词数');
    eq(s2.exTotal, 0, '例句阶段条数（无需生成）');
    assert(/粘贴自带/.test(s2.resultText || ''), '结果文案说明例句是粘贴自带的：' + s2.resultText);
    const bucket = importer.customWordsOf(bkEx);
    assert(bucket.every(w => !!w.exampleSid), '每条都带 exampleSid（以后不会再被判成缺例句）');
    assert(bucket[0] && /ran across/.test(bucket[0].exampleEn), '例句原文落库');
    importTask.reset();
  }

  console.log('== B3. 只补本次导入的词（不再还历史例句债） ==');
  const bk2 = 'bk_only';
  importer.importIntoBook([
    { word: mk(200), pos: 'n.', meaning: '旧词甲' },
    { word: mk(201), pos: 'n.', meaning: '旧词乙' },
    { word: mk(202), pos: 'n.', meaning: '旧词丙' }
  ], bk2);
  eq(importer.customWordsOf(bk2).filter(w => !w.exampleSid).length, 3, '先备 3 个缺例句的词');
  let seenTotal = -1;
  await importer.generateForImported(bk2, async (p) => { seenTotal = p.total }, {
    only: [mk(200)], concurrency: 1, gap: 0
  });
  eq(seenTotal, 1, '传 only 时只处理 1 个词（不带入另外 2 个）');
  let fullTotal = -1;
  await importer.generateForImported(bk2, async (p) => { fullTotal = p.total }, { concurrency: 1, gap: 0 });
  eq(fullTotal, 2, '不传 only 会补掉剩下 2 个（老行为保留，供"续补"使用）');

  console.log('== B4. 批量生成支持并发 ==');
  const reqs = [0, 1, 2, 3, 4, 5].map(i => ({
    bookId: bk2, level: 'custom', scene: 's',
    newWords: [{ word: mk(300 + i), pos: 'n.', meaning: 'm' + i }],
    knownWords: [], constraints: { newWordCount: 1 }, excludeSids: []
  }));
  delay = 100; calls = 0; maxInFlight = 0;
  let t0 = Date.now();
  const serial = await api.generateBatch(reqs.map(r => Object.assign({}, r, { scene: 'serial' })), null, { concurrency: 1, gap: 0 });
  const serialMs = Date.now() - t0;
  const serialInFlight = maxInFlight;

  calls = 0; maxInFlight = 0;
  t0 = Date.now();
  const par = await api.generateBatch(reqs.map(r => Object.assign({}, r, { scene: 'par' })), null, { concurrency: 3, gap: 0 });
  const parMs = Date.now() - t0;
  eq(serial.length, 6, '串行返回 6 条');
  eq(par.length, 6, '并发返回 6 条');
  assert(serial.every(x => x && typeof x === 'object'), '串行结果无 undefined 空洞');
  assert(par.every(x => x && typeof x === 'object'), '并发结果无 undefined 空洞');
  eq(serialInFlight, 1, '串行时在途请求最多 1 个');
  assert(maxInFlight >= 2, '并发时在途请求达到 ' + maxInFlight + ' 个（>=2）');
  assert(parMs * 2 < serialMs, '并发明显更快：串行 ' + serialMs + 'ms vs 并发 ' + parMs + 'ms');
  eq(par[5] && par[5].newWords && par[5].newWords[0], mk(305), '结果按原始下标对齐（不被完成顺序打乱）');

  console.log('== B5. 提前收手：取消后剩下的位置是空句子，不是 undefined ==');
  let doneN = 0;
  const stopped = await api.generateBatch(
    reqs.map(r => Object.assign({}, r, { scene: 'stop' })),
    async () => { doneN++ },
    { concurrency: 1, gap: 0, shouldStop: () => doneN >= 2 }
  );
  eq(stopped.length, 6, '长度仍与请求数一致');
  assert(stopped.every(x => !!x), '没有 undefined 空洞');
  assert(stopped.filter(x => x.en).length <= 3, '取消后不再继续发请求（有效句 ' + stopped.filter(x => x.en).length + ' 条）');

  console.log('== B6. 关掉例句：纯落库，不碰例句生成 ==');
  delay = 0;
  const before = calls;
  await importTask.start({ text: csv(3, 400), bookId: 'bk_noex', withExamples: false });
  const s2 = importTask.get();
  eq(s2.status, 'done', '关例句也能正常结束');
  eq(s2.added, 3, '词照样入库');
  eq(s2.examples, 0, '没有生成例句');
  eq(calls, before, '一次例句请求都没发');
  eq(importer.customWordsOf('bk_noex').filter(w => !w.exampleSid).length, 3, '3 个词都还没例句');
  importTask.reset();

  console.log('== C1. 暂停：挂在检查点，继续后能跑完 ==');
  delay = 120;
  const pp = importTask.start({ text: csv(6, 500), bookId: 'bk_pause' });
  await sleep(60);
  eq(importTask.isBusy(), true, '任务在跑');
  importTask.pause();
  // 暂停是"协作式"的：已经在飞的那一批（并发 3 条）会跑完，之后停住。
  // 所以先等一会儿让在途批落地，再验证"彻底不动了"。
  await sleep(500);
  const midEx = importTask.get().exDone;
  eq(importTask.get().status, 'paused', '已进入暂停');
  await sleep(400);
  eq(importTask.get().exDone, midEx, '暂停期间进度彻底停住（停在 ' + midEx + ' 条）');
  assert(midEx < 6, '暂停时还没跑完（不是跑完才停）');
  importTask.resume();
  await pp;
  const s3 = importTask.get();
  eq(s3.status, 'done', '继续后跑完');
  eq(s3.added, 6, '暂停不影响最终词数');
  importTask.reset();

  console.log('== C2. 停止：已入库的词保留，任务进入 stopped ==');
  const sp = importTask.start({ text: csv(6, 600), bookId: 'bk_stop' });
  await sleep(80);
  eq(importTask.stop(), true, 'stop 返回 true');
  await sp;
  const s4 = importTask.get();
  eq(s4.status, 'stopped', '结束状态 stopped');
  eq(s4.added, 6, '停止前已入库的词保留');
  assert(/已停止/.test(s4.resultText), '结果文案说明已停止（' + s4.resultText + '）');
  eq(importer.customWordsOf('bk_stop').length, 6, '词确实留在词书里');
  importTask.reset();

  console.log('== C3. 页面契约：退出页面只退订，不停止 ==');
  assert(/import \* as importTask from '\.\.\/\.\.\/\.\.\/utils\/import-task'/.test(page), '页面引入 import-task');
  const unload = page.match(/onUnload\(\)\s*\{[\s\S]*?\n  \}/);
  assert(!!unload, '定位到 onUnload');
  assert(!/importTask\.stop/.test(unload[0]), 'onUnload 里没有 importTask.stop（后台继续跑）');
  assert(/__unsubImp\(\)/.test(unload[0]), 'onUnload 里退订了 importTask');
  const onShow = page.match(/onShow\(\)\s*\{[\s\S]*?\n  \}/);
  assert(!!onShow, '定位到 onShow');
  assert(/importTask\.subscribe/.test(onShow[0]), 'onShow 重新订阅（回到页面能看到进度）');
  assert(/this\.impTask = importTask\.get\(\)/.test(onShow[0]), 'onShow 先同步一次快照');
  ['runImport', 'toggleImpPause', 'askStopImport', 'resetImpTask', 'pasteFromClipboard']
    .forEach(m => assert(new RegExp('\\n {4}(?:async )?' + m + '\\(').test(page), '存在方法 ' + m));
  assert(/action: 'stopImport'/.test(page), '停止走确认弹窗');
  assert(/act === 'stopImport'/.test(page), '确认回调里处理 stopImport');
  assert(/toggleImpPause/.test(page) && /askStopImport/.test(page), '模板里有暂停 / 停止入口');

  console.log('== C4. 任务侧：只补本次 + 并发（源码锚点） ==');
  const itSrc = read('utils/import-task.js');
  assert(/only: accepted\.map\(w => w\.word\)/.test(itSrc), 'import-task 补例句时传 only（不牵连历史词）');
  assert(/concurrency: EXAMPLE_CONCURRENCY/.test(itSrc), 'import-task 走并发补例句');
  assert(/shouldStop:/.test(itSrc), 'import-task 给批量生成传了取消信号');

  console.log('');
  console.log(fail === 0 ? 'ALL PASS (' + 'check-import-task' + ')' : fail + ' FAILED');
  process.exit(fail === 0 ? 0 : 1)
})();
