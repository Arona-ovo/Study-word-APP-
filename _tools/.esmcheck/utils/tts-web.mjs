// utils/tts-web.js - H5 端 window.speechSynthesis 整句朗读
//
// 仅被 utils/tts.js 在 // #ifdef H5 分支中 import。
//
// 已知限制：
// 1. Chrome 要求首次 speechSynthesis.speak() 必须在用户手势的同步调用栈内，
//    否则静默失败（不报错）→ 提供 unlock()：首次任意 touchend/click 时用空 utterance 解锁。
//    未解锁时自动朗读（speakAuto）由 tts.js 直接静默跳过（降级有道同样会被拦，无意义）。
// 2. getVoices() 首次可能为空，必须监听 voiceschanged。
// 3. 云端 voice 的 onend 不可靠 → 必须加时长估算看门狗。

let voices = []
let activated = false   // 是否已获得用户激活
let timer = null
let baseRate = 1.0      // 设置页可调的基础语速

function synth() {
  return (typeof window !== 'undefined' && window.speechSynthesis) ? window.speechSynthesis : null
}

function isAvailable() { return !!synth() }

function loadVoices() {
  const s = synth()
  if (!s) return
  try { voices = s.getVoices() || [] } catch (e) { voices = [] }
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  loadVoices()
  try {
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices)
  } catch (e) {
    try { window.speechSynthesis.onvoiceschanged = loadVoices } catch (e2) {}
  }
  // 首次任意用户手势即解锁（capture + once，任何页面都生效）
  if (typeof document !== 'undefined') {
    const unlockOnce = function () { unlock() }
    try {
      document.addEventListener('touchend', unlockOnce, { once: true, capture: true })
      document.addEventListener('click', unlockOnce, { once: true, capture: true })
    } catch (e) {}
  }
}

function unlock() {
  const s = synth()
  if (!s || activated) return
  try {
    const u = new window.SpeechSynthesisUtterance(' ')
    u.volume = 0
    s.speak(u)
    activated = true
  } catch (e) {}
}

function isActivated() { return activated }

function pickVoice(lang) {
  if (!voices || !voices.length) return null
  const re = lang === 'zh' ? /^zh/i : /^en/i
  const list = voices.filter(v => re.test(v.lang || ''))
  if (!list.length) return null
  // 优先本地语音（离线、事件回调更可靠），再优先 en-US / zh-CN
  const local = list.filter(v => v.localService)
  const pool = local.length ? local : list
  const exact = lang === 'zh' ? /zh[-_]CN/i : /en[-_]US/i
  for (let i = 0; i < pool.length; i++) {
    if (exact.test(pool[i].lang || '')) return pool[i]
  }
  return pool[0]
}

function clearT() {
  if (timer) { clearTimeout(timer); timer = null }
}

function speak(text, lang, opts) {
  const o = opts || {}
  const s = synth()
  if (!s) { if (o.onFail) o.onFail('unsupported'); return }
  loadVoices()
  try { s.cancel() } catch (e) {} // 防止 Chrome 队列堆积

  let u
  try {
    u = new window.SpeechSynthesisUtterance(String(text))
  } catch (e) {
    if (o.onFail) o.onFail('unsupported')
    return
  }
  u.lang = lang === 'zh' ? 'zh-CN' : 'en-US'
  const v = pickVoice(lang)
  if (v) u.voice = v
  u.rate = baseRate * (lang === 'zh' ? 0.95 : 0.9)   // 学习场景略慢，可被设置页语速调节
  u.pitch = 1
  u.volume = 1

  let ended = false
  const finish = function (ok, reason) {
    if (ended) return
    ended = true
    clearT()
    if (ok) { if (o.onDone) o.onDone() }
    else { if (o.onFail) o.onFail(reason || 'error') }
  }
  u.onend = function () { finish(true) }
  u.onerror = function (e) { finish(false, (e && e.error) || 'error') }

  try {
    s.speak(u)
  } catch (e) {
    finish(false, 'exception')
    return
  }
  activated = true

  // 看门狗：云端 voice 常不触发 onend
  const est = Math.min(60000, Math.max(3000, String(text).length * 220))
  clearT()
  timer = setTimeout(function () { finish(true, 'watchdog') }, est)
}

function stop() {
  clearT()
  try {
    const s = synth()
    if (s) s.cancel()
  } catch (e) {}
}

function isSpeaking() {
  try {
    const s = synth()
    return !!(s && (s.speaking || s.pending))
  } catch (e) { return false }
}

function warmup() { loadVoices() }

function voiceCount() { return voices ? voices.length : 0 }

// 设置基础语速（设置页可调）
function setRate(r) {
  const v = Number(r)
  if (!isFinite(v) || v <= 0) return
  baseRate = Math.min(3, Math.max(0.25, v))
}

const name = 'web-speech'

export { name, warmup, speak, stop, isSpeaking, isAvailable, isActivated, unlock, voiceCount, setRate }
