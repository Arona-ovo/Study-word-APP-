// _tools/check-services.js - 统一服务层逻辑校验（只读）
// 验证：默认关闭不联网、AI 开启失败时回退本地、密钥不硬编码。
const { load } = require('./lib/load');

const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {},
  createInnerAudioContext: () => ({ play(){}, stop(){}, destroy(){}, onEnded(){}, onError(){} })
};

const settings = load('utils/settings.js');
settings.init();

const config = load('services/config.js', { settings });
const http = load('services/http.js');

// ---- 本地 TTS mock：记录是否真的被调用（验证降级/默认委托） ----
const localCalls = [];
const localTts = {
  speak: (t, o) => { localCalls.push({ t, o }); },
  stop: () => {},
  isPlaying: () => false,
  warmup: () => {}
};

const voice = load('services/voice.js', {
  localTts,
  request: http.request,
  ServiceError: http.ServiceError,
  getAIConfig: config.getAIConfig,
  isAIEnabled: config.isAIEnabled,
  getVoicePrefs: config.getVoicePrefs,
  speechEndpoint: config.speechEndpoint,
  providerSupportsTTS: config.providerSupportsTTS
});

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }

(async () => {
  console.log('== 1. 默认配置：AI 关闭，无硬编码密钥 ==');
  const c0 = config.getAIConfig();
  if (c0.enabled === false && c0.baseURL === '' && c0.apiKey === '') ok('默认 enabled=false 且无 baseURL/apiKey');
  else bad('默认配置异常：' + JSON.stringify(c0));
  if (config.isAIEnabled() === false) ok('isAIEnabled()=false');
  else bad('isAIEnabled 应为 false');

  console.log('== 2. 默认情况下 voice.speak 直接委托本地 TTS（不走网络） ==');
  localCalls.length = 0;
  voice.speak('Hello world', { auto: true });
  if (localCalls.length === 1 && localCalls[0].t === 'Hello world') ok('已委托本地 TTS 朗读');
  else bad('未委托本地 TTS：' + JSON.stringify(localCalls));

  console.log('== 3. 语种自动朗读开关：关闭英文则不自动播 ==');
  settings.set({ voice: { englishRead: false } });
  localCalls.length = 0;
  voice.speak('Hello again', { auto: true });
  if (localCalls.length === 0) ok('英文自动朗读已关闭（auto 模式跳过）');
  else bad('英文应被跳过，却调用了本地 TTS');
  // 用户主动点击（非 auto）不受开关限制
  voice.speak('Hello again', { force: true });
  if (localCalls.length === 1) ok('非 auto（用户点击）仍朗读');
  else bad('用户主动点击应朗读');
  settings.set({ voice: { englishRead: true } }); // 复位

  console.log('== 4. AI 开启但请求失败 → 回退本地 TTS（不阻断） ==');
  settings.set({
    ai: { enabled: true, baseURL: 'https://fake.example/v1', apiKey: 'test-key', model: 'x' },
    voice: { useAI: true }
  });
  if (config.isAIEnabled() === true) ok('isAIEnabled()=true（已配置）');
  else bad('isAIEnabled 应为 true');
  // 让 request 失败
  const voiceFail = load('services/voice.js', {
    localTts,
    request: () => Promise.reject(new Error('network down')),
    ServiceError: http.ServiceError,
    getAIConfig: config.getAIConfig,
    isAIEnabled: config.isAIEnabled,
    getVoicePrefs: config.getVoicePrefs,
    speechEndpoint: config.speechEndpoint,
    providerSupportsTTS: config.providerSupportsTTS
  });
  localCalls.length = 0;
  voiceFail.speak('AI test sentence', {});
  await new Promise(r => setTimeout(r, 50)); // 等异步回退
  if (localCalls.length === 1) ok('请求失败后已回退本地 TTS');
  else bad('失败后未回退本地，调用次数=' + localCalls.length);

  console.log('== 5. LLM 未配置时抛可降级错误 ==');
  const llm = load('services/llm.js', {
    request: http.request, ServiceError: http.ServiceError,
    getAIConfig: config.getAIConfig, isAIEnabled: config.isAIEnabled, chatEndpoint: config.chatEndpoint,
    PROVIDER_PRESETS: config.PROVIDER_PRESETS,
    apiUsage: { record(){}, recordFailure(){}, estimateMessages(){return 0}, estimateTokens(){return 0} },
    noteFailure(){}, breakerKeyOf:(u)=>String(u||''), resetBreaker(){},
  });
  let threw = false, degradable = false;
  try { await llm.chatCompletion([{ role: 'user', content: 'hi' }]); }
  catch (e) { threw = true; degradable = !!(e && e.degradable); }
  if (threw && degradable) ok('未配置时抛可降级错误（sentence-api 可接住）');
  else bad('未配置时未抛可降级错误：threw=' + threw);

  console.log('== 6. LLM 配置后返回模型内容 ==');
  const llmOk = load('services/llm.js', {
    request: () => Promise.resolve({ data: { choices: [{ message: { content: '生成结果' } }] } }),
    ServiceError: http.ServiceError,
    getAIConfig: config.getAIConfig, isAIEnabled: config.isAIEnabled, chatEndpoint: config.chatEndpoint,
    PROVIDER_PRESETS: config.PROVIDER_PRESETS,
    apiUsage: { record(){}, recordFailure(){}, estimateMessages(){return 0}, estimateTokens(){return 0} },
    noteFailure(){}, breakerKeyOf:(u)=>String(u||''), resetBreaker(){},
  });
  const r = await llmOk.chatCompletion([{ role: 'user', content: 'hi' }]);
  if (r && r.content === '生成结果') ok('大模型返回内容正确');
  else bad('大模型返回异常：' + JSON.stringify(r));

  console.log('== 7. 不支持云端语音的服务商（如 DeepSeek）直接走本地，不发起网络请求 ==');
  settings.set({
    ai: { enabled: true, provider: 'deepseek', baseURL: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat' },
    voice: { useAI: true }
  });
  const voiceNoTTS = load('services/voice.js', {
    localTts,
    request: () => Promise.reject(new Error('should-not-be-called')),
    ServiceError: http.ServiceError,
    getAIConfig: config.getAIConfig,
    isAIEnabled: config.isAIEnabled,
    getVoicePrefs: config.getVoicePrefs,
    speechEndpoint: config.speechEndpoint,
    providerSupportsTTS: config.providerSupportsTTS
  });
  localCalls.length = 0;
  voiceNoTTS.speak('中文句子测试', { auto: true });
  if (localCalls.length === 1) ok('DeepSeek 不支持 TTS，直接走本地（无网络请求）');
  else bad('DeepSeek 应直接走本地，调用次数=' + localCalls.length);

  console.log('== 8. 自定义服务商可声明支持 /audio/speech ==');
  settings.set({ ai: { provider: 'custom', customTTS: false } });
  if (config.providerSupportsTTS('custom') === false) ok('custom 默认不支持云端语音');
  else bad('custom 默认应为 false');
  settings.set({ ai: { provider: 'custom', customTTS: true } });
  if (config.providerSupportsTTS('custom') === true) ok('custom 声明后支持云端语音（可用云端中文音色）');
  else bad('custom 声明后应为 true');
  settings.set({ ai: { provider: 'openai', customTTS: false } });
  if (config.providerSupportsTTS('openai') === true) ok('openai 始终支持云端语音');
  else bad('openai 应为 true');

  console.log('\n' + (fail === 0 ? '服务层全部通过' : '服务层失败 ' + fail + ' 项'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
