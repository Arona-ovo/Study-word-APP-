// utils/tts.js - 文本转语音（单词 / 整句）统一入口
//
// 供给链（2026-10 二次重构，解决"一段一段"的听感）：
//   整句：平台原生 TTS（Android TextToSpeech / H5 speechSynthesis）
//         → 有道整句 → 有道逐词连读
//   单词：有道单词（词典音更准）→ 失败再兜底一次原生 TTS
//
// 为什么要有原生这一层：有道 dictvoice 只对"词典里有条目"的文本返回音频，
// 单词可用（200）但多数完整句子返回 HTTP 500 JSON，只能逐词播 → 单元间有网络等待 → 一词一顿。
// 原生 TTS 一次合成整句，中间没有网络请求，听起来是连贯的一句话。
//
// 其余设计（一次重构保留）：
// 2. 每个有道播放单元新建 InnerAudioContext，播完立即 destroy()，避免复用实例切 src 报错（-99）
//    以及 H5 端 <audio> DOM 堆积。
// 3. gen 代际 token：stop() 后所有在途回调失效，防止打断后误触发下一单元。
// 4. 失败不再静默：全部失败 toast 提示，部分失败提示"N 个词暂无发音"。
// 5. 去重只在"自动朗读且同文本正在播"时生效；用户主动点击（重听 / 点词）永不节流。
//
// 回滚：把下面 USE_NATIVE_TTS 改成 false，即 100% 回到"纯有道"行为。
//
// 注意：微信小程序正式版需在后台把 https://dict.youdao.com 加入 downloadFile 合法域名；
// 开发期勾选"不校验合法域名"，真机预览可在预览页右上角菜单打开"调试模式"。

// #ifdef APP-PLUS
import * as nativeTts from './tts-native.js'
// #endif
// #ifdef H5
import * as webTts from './tts-web.js'
// #endif

import * as settings from './settings.js'

const USE_NATIVE_TTS = true       // 一键回滚开关：false = 只用有道
const WORD_NATIVE_FALLBACK = true // 单词有道失败后是否兜底一次原生

// 整句朗读引擎（设置页可选）：
//   auto   = 系统语音优先，不可用再走在线（在线会退化成逐词，听感一顿一顿）
//   native = 只用系统语音，不可用就不念（宁可静音也不要一顿一顿）
//   online = 只用在线发音（系统语音在该机上有问题时选这个）
function enginePref() {
  try {
    const v = (settings.get() && settings.get().voice) || {};
    return v.engine || 'auto';
  } catch (e) {
    return 'auto';
  }
}

const UNIT_TIMEOUT = 8000;   // 单个单元播不完的看门狗
const TOTAL_TIMEOUT = 45000; // 整句总时长看门狗
const MAX_UNITS = 30;        // 单个句子最多播放的单元数（防止超长文本）

let current = null;   // 当前 InnerAudioContext
let gen = 0;          // 代际 token
let playing = false;
let lastText = '';
let unitTimer = null;
let totalTimer = null;
let seq = null;       // 当前播放序列描述
let preload = null;   // 预连接的下一个单元（缩短单元间隔）
let preloadUnit = '';
let autoplayBlocked = false; // H5 自动播放被浏览器策略拦截过

function detectLang(text) {
  return /[\u4e00-\u9fa5]/.test(text) ? 'zh' : 'en';
}

function ttsUrl(text, lang) {
  const q = encodeURIComponent(text);
  return lang === 'zh'
    ? 'https://dict.youdao.com/dictvoice?le=zh&audio=' + q
    : 'https://dict.youdao.com/dictvoice?type=1&audio=' + q; // type=1 英音 type=2 美音
}

// 弯撇号统一为直撇号，避免与页面 token 清洗不一致
function normalize(text) {
  return String(text == null ? '' : text).replace(/[’‘`]/g, "'");
}

// 英文拆词（丢标点与空白）；中文按字拆（有道中文整句不可用，单字可用）
function buildUnits(text, lang) {
  const s = normalize(text);
  if (lang === 'zh') {
    return s.split('').filter(c => /[\u4e00-\u9fa5]/.test(c)).slice(0, MAX_UNITS);
  }
  const words = s
    .split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/g)
    .filter(t => t && /[A-Za-z]/.test(t))
    .map(t => t.replace(/[’‘`]/g, "'"));
  return words.length ? words.slice(0, MAX_UNITS) : [s.trim()].filter(Boolean);
}

// 当前平台的原生 provider（没有则返回 null）
function provider() {
  if (!USE_NATIVE_TTS) return null
  if (enginePref() === 'online') return null
  let p = null
  // #ifdef APP-PLUS
  p = nativeTts
  // #endif
  // #ifdef H5
  p = webTts.isAvailable() ? webTts : null
  // #endif
  return p
}

// 停止时无条件停原生（防止开关切换后残留发声）
function stopProvider() {
  // #ifdef APP-PLUS
  try { if (nativeTts && nativeTts.stop) nativeTts.stop() } catch (e) {}
  // #endif
  // #ifdef H5
  try { if (webTts && webTts.stop) webTts.stop() } catch (e) {}
  // #endif
}

function destroyCurrent() {
  if (current) {
    try { current.stop(); } catch (e) {}
    try { current.destroy(); } catch (e) {}
    current = null;
  }
}

// 预连接下一个单元：逐词连读时，单元之间不再等一次网络往返，
// 这是"读得一顿一顿"最直接的原因（每个词都要现发起一次 HTTP 请求）。
function destroyPreload() {
  if (preload) {
    try { preload.stop(); } catch (e) {}
    try { preload.destroy(); } catch (e) {}
    preload = null;
    preloadUnit = '';
  }
}

function preloadNextUnit() {
  destroyPreload();
  if (!seq || seq.i >= seq.units.length) return;
  const unit = seq.units[seq.i];
  try {
    const ctx = uni.createInnerAudioContext();
    ctx.src = ttsUrl(unit, seq.lang);
    preload = ctx;
    preloadUnit = unit;
  } catch (e) {
    preload = null;
    preloadUnit = '';
  }
}

function clearTimers() {
  if (unitTimer) { clearTimeout(unitTimer); unitTimer = null; }
  if (totalTimer) { clearTimeout(totalTimer); totalTimer = null; }
}

function stop() {
  gen++;
  playing = false;
  clearTimers();
  destroyCurrent();
  destroyPreload();
  stopProvider();
  const s = seq;
  seq = null;
  if (s && s.onDone) {
    try { s.onDone({ cancelled: true }); } catch (e) {}
  }
}

function start(units, opts) {
  const o = opts || {};
  const raw = o.raw != null ? o.raw : units.join(' ');
  if (!units.length) return;

  const force = o.force === true || (o.force !== false && o.auto !== true);
  // 自动朗读：同文本正在播则跳过；用户主动点击永不节流
  if (!force && playing && raw === lastText) return;

  stop();
  lastText = raw;
  playing = true;
  seq = {
    raw: raw,
    lang: o.lang || detectLang(raw),
    units: units.slice(),
    i: 0,
    total: units.length,
    failed: 0,
    tryWhole: !!o.tryWhole,
    kind: o.kind || 'sentence',
    silent: !!o.silent,
    autoPlay: o.auto === true,
    preferNative: o.preferNative === true,
    mode: 'youdao',      // 'native' | 'youdao'
    nativeTried: false,
    onDone: o.onDone || null
  };
  totalTimer = setTimeout(() => { if (seq) finish(); }, TOTAL_TIMEOUT);

  if (seq.preferNative && canUseNative(seq)) playNative()
  else playNext()
}

// 原生 TTS 是否可用于当前这次播放
function canUseNative(s) {
  const p = provider()
  if (!p) return false
  // #ifdef H5
  // H5 未获得用户激活时，自动朗读直接放弃（<audio> 同样会被拦，降级无意义）
  try { if (s.autoPlay && !webTts.isActivated()) return false } catch (e) { return false }
  // #endif
  return true
}

// 原生整句：建模为 units 长度 1 的"原子序列"，由 provider 回调驱动结束
function playNative() {
  const s = seq
  const myGen = gen
  const p = provider()
  if (!s || !p) { playNext(); return }

  s.mode = 'native'
  s.units = [s.raw]
  s.total = 1
  s.i = 1
  s.nativeTried = true

  p.speak(s.raw, s.lang, {
    onDone: () => {
      if (myGen !== gen || seq !== s) return
      autoplayBlocked = false
      finish(0)   // 成功，无 toast
    },
    onFail: (reason) => {
      if (myGen !== gen || seq !== s) return
      onNativeFail(reason)
    }
  })
}

// 原生不可用 → 回退"有道整句 → 有道逐词"现有链路
function onNativeFail(reason) {
  const s = seq
  if (!s) return
  console.warn('[tts] 原生 TTS 不可用，降级有道：', reason)
  // 用户选了"只用系统语音"：不降级到在线逐词（那正是"一顿一顿"的来源）
  if (enginePref() === 'native') { finish(s.total || 1); return }
  s.mode = 'youdao'
  s.units = [s.raw]
  s.i = 0
  s.total = 1
  s.tryWhole = true
  s.failed = 0
  playNext()
}

function playNext() {
  if (unitTimer) { clearTimeout(unitTimer); unitTimer = null; }
  if (!seq) return;
  if (seq.i >= seq.units.length) { finish(); return; }

  const unit = seq.units[seq.i++];
  const myGen = gen;
  destroyCurrent();

  let ctx = null;
  if (preload && preloadUnit === unit) {
    ctx = preload;              // 已预连接，直接播，省掉一次网络往返
    preload = null;
    preloadUnit = '';
  } else {
    destroyPreload();
    try {
      ctx = uni.createInnerAudioContext();
    } catch (e) {
      onUnitFail('create');
      return;
    }
    current = ctx;
    ctx.src = ttsUrl(unit, seq.lang);
  }
  current = ctx;
  ctx.onEnded(() => { if (myGen === gen) onUnitOk(); });
  ctx.onError((err) => {
    if (myGen !== gen) return;
    console.warn('[tts] 单元播放失败:', unit, err);
    onUnitFail('error');
  });
  unitTimer = setTimeout(() => { if (myGen === gen) onUnitFail('timeout'); }, UNIT_TIMEOUT);
  try {
    ctx.play();
    preloadNextUnit();          // 播当前的同时预连接下一个
  } catch (e) {
    onUnitFail('play');
  }
}

function onUnitOk() {
  if (!seq) return;
  autoplayBlocked = false;
  playNext();
}

function onUnitFail(reason) {
  if (!seq) return;
  if (reason === 'error' || reason === 'play') autoplayBlocked = true;

  // 整句请求失败 → 降级为逐词（中文为逐字）连读
  if (seq.tryWhole) {
    seq.tryWhole = false;
    const units = buildUnits(seq.raw, seq.lang);
    if (units.length > 1) {
      seq.units = units;
      seq.i = 0;
      seq.total = units.length;
      seq.failed = 0;
      playNext();
      return;
    }
  }

  // 单词点读：有道失败后兜底一次原生（断网也能发声），成功不计失败、不 toast
  if (WORD_NATIVE_FALLBACK && !seq.nativeTried && seq.kind === 'word' && canUseNative(seq)) {
    const p = provider()
    const myGen = gen
    const me = seq
    me.nativeTried = true
    p.speak(me.raw, me.lang, {
      onDone: () => {
        if (myGen !== gen || seq !== me) return
        me.failed = 0
        finish(0)
      },
      onFail: () => {
        if (myGen !== gen || seq !== me) return
        me.failed++
        finish()
      }
    })
    return
  }

  seq.failed++;
  playNext();
}

function finish(forceFailed) {
  clearTimers();
  destroyCurrent();
  destroyPreload();
  stopProvider();
  playing = false;
  const s = seq;
  seq = null;
  if (!s) return;
  if (forceFailed != null) s.failed = forceFailed;

  if (!s.silent && s.failed > 0) {
    if (s.failed >= s.total) {
      // 有原生兜底时，"请检查网络"已不准确
      const title = provider()
        ? '发音不可用，请检查网络或系统语音设置'
        : '发音服务不可用，请检查网络';
      uni.showToast({ title: title, icon: 'none', duration: 1800 });
    } else {
      uni.showToast({ title: s.failed + ' 个词暂无发音', icon: 'none', duration: 1500 });
    }
  }
  if (s.onDone) {
    try { s.onDone({ total: s.total, failed: s.failed }); } catch (e) {}
  }
}

// ---------- 对外接口 ----------

// 兼容旧签名 speak(text) / speak(text, 'en')
function speak(text, opts) {
  if (!text || !String(text).trim()) return;
  const o = (typeof opts === 'string') ? { lang: opts } : Object.assign({}, opts || {});
  const lang = o.lang || detectLang(text);
  const units = buildUnits(text, lang);
  const tryWhole = units.length > 1;
  start(tryWhole ? [normalize(text).trim()] : units, {
    raw: normalize(text).trim(),
    lang: lang,
    tryWhole: tryWhole,
    kind: tryWhole ? 'sentence' : 'word',
    preferNative: tryWhole,   // 多词（整句）→ 原生 TTS 优先
    force: o.force,
    auto: o.auto,
    silent: o.silent,
    onDone: o.onDone
  });
}

// 单词发音：直连单词级接口（可用于未收录词）
function speakWord(word, opts) {
  if (!word || !String(word).trim()) return;
  const o = Object.assign({ force: true, lang: 'en' }, opts || {});
  start([normalize(word).trim()], {
    raw: normalize(word).trim(),
    lang: o.lang,
    tryWhole: false,
    kind: 'word',
    preferNative: false,      // 单词 → 有道优先（词典音更准），失败才兜底原生
    force: o.force,
    silent: o.silent,
    onDone: o.onDone
  });
}

// 整句朗读：原生 TTS → 有道整句 → 有道逐词
function speakSentence(text, opts) {
  speak(text, Object.assign({ force: true }, opts || {}));
}

// 自动朗读（进题 / 答后）：不打扰用户，失败静默
function speakAuto(text) {
  speak(text, { auto: true, silent: true });
}

function isPlaying() {
  return playing;
}

// 语速设置（设置页可调）：转发给平台原生 provider
function setVoiceOptions(opts) {
  const o = opts || {};
  if (o.speed != null) {
    // #ifdef APP-PLUS
    try { if (nativeTts && nativeTts.setRate) nativeTts.setRate(o.speed) } catch (e) {}
    // #endif
    // #ifdef H5
    try { if (webTts && webTts.setRate) webTts.setRate(o.speed) } catch (e) {}
    // #endif
  }
}

// 预热：提前绑定系统 TTS 引擎，消除首次点击的初始化延迟
function warmup() {
  // #ifdef APP-PLUS
  try { if (nativeTts && nativeTts.warmup) nativeTts.warmup() } catch (e) {}
  // #endif
  // #ifdef H5
  try { if (webTts && webTts.warmup) webTts.warmup() } catch (e) {}
  // #endif
}

// 排障用：云打包后确认当前走的是哪个引擎
function status() {
  const p = provider()
  const out = {
    useNative: USE_NATIVE_TTS,
    provider: p ? p.name : 'youdao-only',
    engine: enginePref(),
    playing: playing,
    blocked: autoplayBlocked
  }
  // #ifdef APP-PLUS
  try { out.nativeReady = nativeTts.isAvailable() } catch (e) { out.nativeReady = false }
  try { out.lang = nativeTts.langStatus() } catch (e) { out.lang = null }
  // #endif
  // #ifdef H5
  try {
    out.voices = webTts.voiceCount()
    out.activated = webTts.isActivated()
  } catch (e) {}
  // #endif
  return out
}

// 设置页"重新检测"：清掉系统语音的失败缓存并重新预热
function resetVoice() {
  // #ifdef APP-PLUS
  try { nativeTts.resetCache() } catch (e) {}
  try { nativeTts.warmup() } catch (e) {}
  // #endif
  return status()
}

export { speak, speakWord, speakSentence, speakAuto, stop, isPlaying, warmup, status, setVoiceOptions, resetVoice };
