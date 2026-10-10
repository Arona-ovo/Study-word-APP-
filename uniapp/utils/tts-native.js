// utils/tts-native.js - Android 原生 TTS（Native.js 直调 android.speech.tts.TextToSpeech）
//
// 仅被 utils/tts.js 在 // #ifdef APP-PLUS 分支中 import，H5 / 小程序不会打包本文件。
//
// 踩坑记录（勿改）：
// 1. plus.android.implements 只能实现 Java 接口，不能实现/继承抽象类。
//    UtteranceProgressListener 是 abstract class → 不能用！
//    完成信号改用「TextToSpeech$OnUtteranceCompletedListener（接口）+ isSpeaking() 轮询」双保险。
// 2. 嵌套类用 '$' 连接：android.speech.tts.TextToSpeech$OnInitListener
// 3. implements 第二参数是 JSON 对象字面量：{ 方法名: function(...){} }
// 4. Android 11(targetSdk>=30) 必须在 AndroidManifest.xml 声明 TTS_SERVICE 的 <queries>，
//    否则绑不到引擎、onInit 返回 ERROR —— 见项目根目录 AndroidManifest.xml。
// 5. 常量值硬编码（避免静态字段读取失败），全程用 newObject + invoke，不用 importClass。

const K = {
  SUCCESS: 0,
  ERROR: -1,
  QUEUE_FLUSH: 0,
  QUEUE_ADD: 1
}

const USE_UTTERANCE_CALLBACK = true // 关掉则纯轮询（某些机型 OnUtteranceCompletedListener 不回调）
const INIT_TIMEOUT = 4000           // 等 onInit 的最长时间
const PLUS_RETRY_DELAY = 300        // plus 未就绪时的重试间隔
const PLUS_RETRY_MAX = 20
const START_GRACE = 1500            // speak 后允许"尚未开始"的宽限窗口
const POLL_INTERVAL = 200           // isSpeaking 轮询间隔
const MAX_DURATION = 60000          // 单句硬看门狗
const COOLDOWN = 60 * 1000          // 初始化失败后的重试冷却（原为 5 分钟，太长：一次抖动就哑很久）
const LANG_COOLDOWN = 10 * 60 * 1000 // 语言不可用缓存的有效期（原来是永久，一旦误判整场都降级）

// setLanguage 的兜底顺序：有些引擎只认 zh / zh-TW，对 zh-CN 报 LANG_MISSING_DATA(-1)。
// 逐个试，第一个返回 >=0 的就用。
const LANG_TRIES = {
  zh: [['zh', 'CN'], ['zh', ''], ['zh', 'TW'], ['zh', 'HK']],
  en: [['en', 'US'], ['en', ''], ['en', 'GB']]
}

let tts = null        // TextToSpeech 实例
let ready = false     // onInit(SUCCESS) 已完成
let initing = false
let waiters = []      // 初始化完成前的待播回调队列
let plusWait = 0
let failedAt = 0      // 上次初始化失败时间戳（可用性缓存）
let langBad = {}      // { en:ts / zh:ts } 语言级不可用缓存（带有效期，过期自动重试）
let langReason = {}   // 语言不可用的原因，排障用
let job = null        // { id, onDone, onFail, timer, signaled }
let uid = 0
let rate = 0.95       // 语速（设置页可调，1.0 = 正常；学习场景默认略放慢）

function hasPlus() {
  return typeof plus !== 'undefined' && plus && plus.android && plus.android.runtimeMainActivity
}

function log() {
  try { console.log.apply(console, ['[tts-native]'].concat([].slice.call(arguments))) } catch (e) {}
}

// ---------- 初始化 ----------

function release() {
  if (tts) {
    try { plus.android.invoke(tts, 'stop') } catch (e) {}
    try { plus.android.invoke(tts, 'shutdown') } catch (e) {}
  }
  tts = null
}

function ensureInit(cb) {
  if (ready && tts) { cb(true); return }

  // App 启动早期 plus 可能尚未注入，延后重试（不计入失败冷却）
  if (!hasPlus()) {
    if (plusWait < PLUS_RETRY_MAX) {
      plusWait++
      setTimeout(function () { ensureInit(cb) }, PLUS_RETRY_DELAY)
      return
    }
    cb(false)
    return
  }
  if (failedAt && Date.now() - failedAt < COOLDOWN) { cb(false); return }

  waiters.push(cb)
  if (initing) return
  initing = true

  let settled = false
  let timer = null

  function settle(ok, reason) {
    if (settled) return
    settled = true
    if (timer) { clearTimeout(timer); timer = null }
    initing = false
    ready = !!ok
    if (ok) {
      log('init 成功')
      attachUtteranceListener()
    } else {
      failedAt = Date.now()
      log('init 失败:', reason || 'unknown')
      release()
    }
    const ws = waiters.slice()
    waiters = []
    for (let i = 0; i < ws.length; i++) {
      try { ws[i](ready) } catch (e) {}
    }
  }

  timer = setTimeout(function () { settle(false, 'timeout') }, INIT_TIMEOUT)

  try {
    const main = plus.android.runtimeMainActivity()
    let ctx = null
    try { ctx = main ? (plus.android.invoke(main, 'getApplicationContext') || main) : null } catch (e) { ctx = main }
    if (!ctx) { settle(false, 'no-context'); return }

    const listener = plus.android.implements('android.speech.tts.TextToSpeech$OnInitListener', {
      onInit: function (status) {
        if (Number(status) === K.SUCCESS && tts) {
          try { plus.android.invoke(tts, 'setSpeechRate', rate) } catch (e) {} // 学习场景略放慢
          try { plus.android.invoke(tts, 'setPitch', 1.0) } catch (e) {}
          settle(true)
        } else {
          settle(false, 'onInit status=' + status)
        }
      }
    })
    if (!listener) { settle(false, 'implements 返回 null'); return }

    tts = plus.android.newObject('android.speech.tts.TextToSpeech', ctx, listener)
    if (!tts) settle(false, 'newObject 返回 null')
  } catch (e) {
    settle(false, 'exception: ' + ((e && e.message) || e))
  }
}

// OnUtteranceCompletedListener 是 **接口**（虽已废弃但 AOSP 仍保留）→ implements 可用
function attachUtteranceListener() {
  if (!USE_UTTERANCE_CALLBACK || !tts) return
  try {
    const li = plus.android.implements(
      'android.speech.tts.TextToSpeech$OnUtteranceCompletedListener',
      {
        onUtteranceCompleted: function (utteranceId) {
          log('onUtteranceCompleted:', utteranceId)
          if (job && job.id === String(utteranceId)) {
            job.signaled = true
            endJob(true)
          }
        }
      }
    )
    if (!li) { log('完成回调 implements 返回 null，退化为纯轮询'); return }
    plus.android.invoke(tts, 'setOnUtteranceCompletedListener', li)
  } catch (e) {
    log('完成回调注册失败（退化为纯轮询）:', (e && e.message) || e)
  }
}

// ---------- 语言 ----------

// 系统默认语言（zh / en / ...）：setLanguage 全失败时的最后兜底依据
function deviceLang() {
  try {
    const L = plus.android.importClass('java.util.Locale')
    const d = L.getDefault ? L.getDefault() : plus.android.invoke(L, 'getDefault')
    return String(plus.android.invoke(d, 'getLanguage') || '')
  } catch (e) {
    return ''
  }
}

// 逐个尝试 Locale；都失败再看"引擎默认语言是不是就要的这门"，
// 是的话允许用默认语言播（很多国产引擎对 zh-CN 报错，但实际能读中文）。
function applyLang(lang) {
  if (!tts) return false
  if (langBad[lang] && Date.now() - langBad[lang] < LANG_COOLDOWN) return false

  const tries = LANG_TRIES[lang] || [[lang, '']]
  for (let i = 0; i < tries.length; i++) {
    let loc = null
    try {
      loc = tries[i][1]
        ? plus.android.newObject('java.util.Locale', tries[i][0], tries[i][1])
        : plus.android.newObject('java.util.Locale', tries[i][0])
    } catch (e) { loc = null }
    if (!loc) continue
    let r = null
    try { r = plus.android.invoke(tts, 'setLanguage', loc) } catch (e) { r = null }
    // >=0 可用；-1 缺语音数据；-2 不支持
    if (r !== null && r !== undefined && Number(r) >= 0) {
      delete langBad[lang]
      delete langReason[lang]
      log('语言就绪:', lang, tries[i].join('-'), '->', r)
      return true
    }
    log('setLanguage 失败:', lang, tries[i].join('-'), '->', r)
  }

  // 最后兜底：设备/引擎默认语言正好是这门语言时，直接用默认语言播
  const dl = deviceLang()
  if (dl && lang.indexOf(dl) === 0) {
    log('setLanguage 全部失败，改用引擎默认语言:', dl)
    delete langBad[lang]
    return true
  }

  langBad[lang] = Date.now()
  langReason[lang] = 'setLanguage<0, device=' + (dl || '?')
  log('语言不可用:', lang, langReason[lang])
  return false
}

// ---------- 播放 ----------

function speak(text, lang, opts) {
  const o = opts || {}
  ensureInit(function (ok) {
    if (!ok || !tts) { if (o.onFail) o.onFail('unavailable'); return }
    if (!applyLang(lang)) { if (o.onFail) o.onFail('lang'); return }

    const id = 'tts' + (++uid)

    let bundle = null
    try {
      bundle = plus.android.newObject('android.os.Bundle')
      plus.android.invoke(bundle, 'putString', 'utteranceId', id)
    } catch (e) { bundle = null }

    let ret = null
    try {
      // speak(CharSequence, int queueMode, Bundle params, String utteranceId)
      // QUEUE_FLUSH：清空队列立即播 —— 保证"重听"即时打断上一条
      ret = plus.android.invoke(tts, 'speak', String(text), K.QUEUE_FLUSH, bundle, id)
    } catch (e) {
      if (o.onFail) o.onFail('exception')
      return
    }
    if (Number(ret) !== K.SUCCESS) { if (o.onFail) o.onFail('reject:' + ret); return }

    log('speak 已入队 id=' + id + ' lang=' + lang + ' len=' + String(text).length)
    watch(id, o)
  })
}

function clearTimer() {
  if (job && job.timer) { clearTimeout(job.timer); job.timer = null }
}

function endJob(ok, reason) {
  const j = job
  if (!j) return
  clearTimer()
  job = null
  log((ok ? 'done' : 'fail') + ' id=' + j.id + (reason ? ' reason=' + reason : ''))
  if (ok) {
    if (j.onDone) { try { j.onDone() } catch (e) {} }
  } else {
    if (j.onFail) { try { j.onFail(reason || 'error') } catch (e) {} }
  }
}

// 轮询看门狗：① 从未开始 → 判失败；② 开始后转静 → 判完成；③ 硬超时 → 按完成收尾
function watch(id, o) {
  clearTimer()
  job = null
  const began = Date.now()
  let started = false
  job = { id: id, onDone: o.onDone || null, onFail: o.onFail || null, timer: null, signaled: false }

  const tick = function () {
    if (!job || job.id !== id) return
    const sp = isSpeaking()
    if (sp) started = true
    const el = Date.now() - began
    if (started && !sp) { endJob(true); return }
    if (el > MAX_DURATION) { endJob(true, 'max-duration'); return }
    if (!started && !job.signaled && el > START_GRACE && !sp) { endJob(false, 'no-start'); return }
    job.timer = setTimeout(tick, POLL_INTERVAL)
  }
  job.timer = setTimeout(tick, POLL_INTERVAL)
}

// ---------- 控制 ----------

function stop() {
  clearTimer()
  job = null // 不触发回调：tts.js 的 stop() 自己会走 cancelled 分支
  if (tts && ready) {
    try { plus.android.invoke(tts, 'stop') } catch (e) {}
  }
}

function isSpeaking() {
  if (!tts || !ready) return false
  try { return !!plus.android.invoke(tts, 'isSpeaking') } catch (e) { return false }
}

function shutdown() { stop(); release(); ready = false; failedAt = 0 }

// 预热 / 回到前台：清掉初始化失败的冷却（语言缓存保留，避免每句都重试）
function warmup() {
  failedAt = 0
  if (!ready) ensureInit(function () {})
}

function isAvailable() { return !!(tts && ready) }

function langOk(lang) {
  return !(langBad[lang] && Date.now() - langBad[lang] < LANG_COOLDOWN)
}

function langSupported(lang) { return isAvailable() && langOk(lang) }

// 手动重试入口（设置页"重新检测"）：把失败缓存全部清掉
function resetCache() { failedAt = 0; langBad = {}; langReason = {}; plusWait = 0 }

// 排障 / 设置页展示：当前引擎与语言可用情况
function langStatus() {
  return {
    ready: !!(tts && ready),
    failedIn: failedAt ? Math.max(0, COOLDOWN - (Date.now() - failedAt)) : 0,
    device: deviceLang(),
    zh: langOk('zh'),
    en: langOk('en'),
    reason: langReason || {}
  }
}

// 设置语速（设置页可调；已初始化则立即生效）
function setRate(r) {
  const v = Number(r)
  if (!isFinite(v) || v <= 0) return
  rate = Math.min(3, Math.max(0.25, v))
  try { if (tts && ready) plus.android.invoke(tts, 'setSpeechRate', rate) } catch (e) {}
}

const name = 'android-tts'

export { name, warmup, speak, stop, isSpeaking, isAvailable, langSupported, shutdown, resetCache, setRate, langStatus }
