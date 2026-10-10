// _tools/check-ai-features.js - AI 分项开关（省 token）校验（只读）
//
// 只做静态扫描守不住这个功能的**核心价值**：开关关掉后，那个 AI 调用到底有没有真的不发生。
// 这里全部实跑 —— 每个受影响的函数都拿假的模型层喂一遍，计数「模型被调用了几次」。
//
// 覆盖：
//   1. 元数据：8 项都有中文名/说明/开销档位，key 唯一
//   2. 默认全开；**未登记的 key 也算开启**（以后加功能不会把老用户静默降级）
//   3. 落盘：setFeature / setAll / offCount 读写一致
//   4. 守卫真的守住了：关掉哪一项，哪一项就不调模型（逐个验，含最费的 wordbook）
//   5. 缓存不受影响：关掉查词后，**已缓存的结果仍然返回**（缓存不花钱，没理由挡）
//   6. 报错是可降级的：调用方已有的 try/catch 与本地兜底照常生效
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
const eq = (a, b, label) => {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
};

const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  request: (o) => { (o.fail || (() => {}))({ statusCode: 0, errMsg: 'mock' }); },
  showToast: () => {},
  $emit: () => {}, $on: () => {}, $off: () => {}
};

const settings = load('utils/settings.js');
settings.init();
const http = load('services/http.js');

/* ---------- 1. 元数据 ---------- */
console.log('== 1. AI 功能清单 ==');
// ServiceError 必须显式注入：vvm 沙箱不解析 ESM import，
// 漏了它 ensureFeature 抛的就是 ReferenceError —— 那时"没调模型"只是因为崩了，
// 第 4/6 组会假绿（看起来守住了，实际错误形态全错）
const gate = load('services/ai-gate.js', { settings, ServiceError: http.ServiceError });
const list = gate.AI_FEATURES || [];
assert(list.length >= 6, '已登记 ' + list.length + ' 项 AI 功能');
const keys = list.map((f) => f.key);
eq(new Set(keys).size, keys.length, 'key 无重复');
const badMeta = list.filter((f) => !f.name || !f.desc || !f.level || !f.levelLabel);
eq(badMeta.length, 0, '每项都有名称 / 说明 / 开销档位');
const badLevel = list.filter((f) => ['low', 'mid', 'high', 'max'].indexOf(f.level) < 0);
eq(badLevel.length, 0, '开销档位取值合法（class 用，必须是英文）');

/* ---------- 2. 默认全开 + 未登记即开启 ---------- */
console.log('== 2. 默认状态 ==');
// 复位要用 gate 自己的 API：settings.set 是深合并，塞一个空 features 清不掉旧的 false
gate.setAll(true);
assert(keys.every((k) => gate.featureOn(k)), '全部功能默认开启');
eq(gate.offCount(), 0, '关闭数 0');
assert(gate.featureOn('查无此项'), '未登记的 key 视为开启（老用户不会被静默降级）');

/* ---------- 3. 落盘读写 ---------- */
console.log('== 3. 开关读写 ==');
gate.setFeature('chat', false);
eq(gate.featureOn('chat'), false, '关掉 chat 后读到 false');
eq(gate.offCount(), 1, '关闭数 1');
gate.setFeature('chat', true);
eq(gate.featureOn('chat'), true, '再打开回到 true');
eq(gate.offCount(), 0, '关闭数回到 0');
gate.setAll(false);
eq(gate.offCount(), list.length, '全关后关闭数 = ' + list.length);
gate.setAll(true);
eq(gate.offCount(), 0, '全开后关闭数 0');
// 未知 key 不该污染存储
eq(gate.setFeature('查无此项', false), false, '未知 key 写入被拒绝');

/* ---------- 4. 守卫真的守住了（逐个实跑） ---------- */
console.log('== 4. 关掉哪项就哪项不调模型 ==');

// 计数型假模型层：任何一次误调用都会被记下来
let calls = 0;
const llmState = { behavior: 'ok' };
function fakeChat() {
  calls++;
  if (llmState.behavior === 'garbage') return Promise.resolve({ content: 'not json at all' });
  return Promise.resolve({
    content: JSON.stringify({
      kind: 'word', word: 'gumption', pos: 'n.', meaningZh: '进取心',
      examples: [{ en: 'It takes gumption.', zh: '这需要进取心。' }]
    })
  });
}

const aiCache = load('utils/ai-cache.js', { settings });
const config = load('services/config.js', { settings });

const ac = load('services/ai-content.js', {
  aiCache,
  chatCompletion: fakeChat,
  chatCompletionStream: () => Promise.resolve({ content: '', onDelta: null }),
  isAIEnabled: () => true,
  getAIConfig: () => ({ baseURL: 'https://x/v1', apiKey: 'k', model: 'm' }),
  chatEndpoint: () => 'https://x/v1/chat/completions',
  ServiceError: http.ServiceError,
  breakerKeyOf: (u) => String(u || ''),
  resetBreaker: () => {},
  request: http.request,
  aiFeature: gate.ensureFeature
});

settings.set({ ai: { enabled: true, baseURL: 'https://x/v1', apiKey: 'k', model: 'm', features: {} } });

async function expectCalls(label, keyOff, fn, n) {
  gate.setFeature(keyOff, false);
  const before = calls;
  let threw = null;
  try { await fn(); } catch (e) { threw = e; }
  gate.setFeature(keyOff, true);
  const used = calls - before;
  if (n === 0) {
    assert(used === 0, label + '：关闭后没有调用模型（实际 ' + used + ' 次）');
  } else {
    assert(used > 0, label + '：打开时确实调用了模型（实际 ' + used + ' 次）');
  }
  return threw;
}

(async () => {
  await expectCalls('explainWord / 查词', 'lookup', () => ac.explainWord('gumption'), 0);
  await expectCalls('critiqueTranslation / 点评', 'critique',
    () => ac.critiqueTranslation({ source: 's', userAnswer: 'a', reference: 'r', dir: 'e2c' }), 0);
  await expectCalls('generateDrill / 专练', 'drill', () => ac.generateDrill([{ word: 'abandon', meaning: '放弃' }]), 0);
  await expectCalls('chat / 聊天', 'chat', () => ac.chat([{ role: 'user', content: 'hi' }]), 0);
  await expectCalls('generateWordbook / 生成词书', 'wordbook',
    () => ac.generateWordbook({ topic: 'environment', count: 5 }), 0);

  // 反过来：开着的时候必须真的去调用，否则说明守卫写反了 / 打到了别的地方
  console.log('== 5. 打开时正常调模型 ==');
  const before = calls;
  try { await ac.explainWord('resolve-again'); } catch (e) { /* 只看调用次数 */ }
  assert(calls - before > 0, '查词开启时确实调用了模型（' + (calls - before) + ' 次）');

  /* ---------- 6. 报错必须是可降级的 ---------- */
  console.log('== 6. 关闭时的错误形态 ==');
  gate.setFeature('lookup', false);
  let err = null;
  try { await ac.explainWord('brand-new-word'); } catch (e) { err = e; }
  gate.setFeature('lookup', true);
  assert(err !== null, '关闭时会抛错（调用方靠 catch 兜底）');
  // degradable 是唯一真正有人消费的标记：调用方靠它决定"走本地兜底"还是"真报错"
  assert(err && err.degradable === true, '标记为可降级（degradable），本地兜底照常生效');
  // notConfigured 在这里是有意的：http/llm 用它跳过熔断器失败计数与用量失败记录
  // ——功能被主动关掉不是服务故障，不该算进"AI 又挂了"里把整条链路熔断
  assert(err && err.notConfigured === true, '带 notConfigured，不计入熔断器失败');
  // featureOff 是给以后 UI 区分"去配置"还是"去开启"用的，目前没有调用方，留在 extra 里
  assert(err && err.extra && err.extra.featureOff === true, 'extra.featureOff 标记区分"没配"与"主动关"');
  assert(err && /已在设置里关闭/.test(String(err.message || '')),
    '错误文案指明去哪里开（不是让用户对着技术报错发呆）');

  /* ---------- 7. 缓存不受影响（缓存不花钱） ---------- */
  console.log('== 7. 关闭后仍读得到缓存 ==');
  aiCache.rememberWord({ word: 'gumption', pos: 'n.', meaning: '进取心', src: 'ai', q: 'gumption' });
  gate.setFeature('lookup', false);
  const before7 = calls;
  const cached = await ac.explainWord('gumption');
  gate.setFeature('lookup', true);
  eq(cached.fromCache, true, '缓存命中照常返回（fromCache）');
  eq(calls - before7, 0, '而且没偷偷去问模型');

  /* ---------- 8. AI 例句：关闭后回落本地语料 ---------- */
  console.log('== 8. AI 例句 closed → 走本地句库 ==');
  const sentencesMod = load('data/sentences.js');
  const lemmaMod = load('utils/lemma.js');
  const sentenceIndexMod = load('utils/sentence-index.js', {
    SENTENCES: sentencesMod.SENTENCES, lemmaCandidates: lemmaMod.lemmaCandidates
  });
  const iplus1Mod = load('utils/iplus1.js', { getBook: () => null, wordbook: null, lemma: lemmaMod.lemma });
  let taCalls = 0;
  const api = load('utils/sentence-api.js', {
    SENTENCES: sentencesMod.SENTENCES,
    iplus1: iplus1Mod,
    sentenceIndex: sentenceIndexMod,
    lemma: lemmaMod.lemma,
    chatCompletion: () => { taCalls++; return Promise.resolve({ content: 'nope' }); },
    aiCache,
    featureOn: gate.featureOn
  });
  gate.setFeature('sentence', false);
  const s = await api.generateSentence({
    bookId: 'cet4', level: 1, scene: '日常',
    newWords: [{ word: 'abandon', pos: 'v.', meaning: '放弃' }],
    knownWords: ['time', 'people']
  });
  gate.setFeature('sentence', true);
  eq(taCalls, 0, '例句关闭后一次模型都没调');
  assert(s && s.en, '仍然拿到了句子（来自本地语料或缓存：' + (s && s.source) + '）');

  console.log('');
  console.log(fail === 0 ? 'AI 分项开关全部通过' : '失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
