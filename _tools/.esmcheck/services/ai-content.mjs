// services/ai-content.js - 基于统一大模型层的高层 AI 内容能力
// 全部走 services/llm（OpenAI 兼容），未配置 / 失败一律抛可降级错误，由调用方兜底。
// 密钥零硬编码：地址与密钥仅来自 settings / 环境变量，见 config.js。
import { chatCompletion } from './llm.mjs'
import { isAIEnabled, getAIConfig, chatEndpoint } from './config.mjs'
import { request, ServiceError } from './http.mjs'

const CACHE_PREFIX = 'fj_ai_content_'
const CACHE_TTL = 7 * 24 * 3600 * 1000

function cacheGet(key) {
  try {
    const raw = uni.getStorageSync(CACHE_PREFIX + key)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (Date.now() - obj.ts > CACHE_TTL) return null
    return obj.data
  } catch (e) { return null }
}

function cacheSet(key, data) {
  try { uni.setStorageSync(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data })) } catch (e) {}
}

// 从模型返回里抽取第一个 JSON 对象（容忍 ```json 代码块与前后多余文本）
function extractJSON(raw) {
  if (!raw) return null
  let s = String(raw).trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end < 0 || end < start) return null
  try { return JSON.parse(s.slice(start, end + 1)) } catch (e) { return null }
}

function ensureEnabled() {
  if (!isAIEnabled()) {
    throw new ServiceError('AI 服务未启用或缺少配置', { degradable: true, notConfigured: true })
  }
}

// ---------- 1. 单词释义 + 例句 ----------
// 返回 { word, pos, meaningZh, examples:[{en,zh}], fromCache }
export async function explainWord(word) {
  ensureEnabled()
  const w = String(word || '').trim()
  if (!w) throw new ServiceError('单词为空', { degradable: true })
  const cached = cacheGet('explain_' + w.toLowerCase())
  if (cached) return Object.assign({ fromCache: true }, cached)

  const sys = [
    'You are an English-Chinese dictionary assistant for Chinese students.',
    'Given an English word, return ONLY strict JSON: {"word":"...","pos":"...","meaningZh":"中文释义","examples":[{"en":"简单英文例句","zh":"中文翻译"}]}.',
    'Use CEFR A2-B1 level examples, exactly 2 examples.',
    'No markdown, no code fences, no extra text.'
  ].join(' ')
  const r = await chatCompletion([
    { role: 'system', content: sys },
    { role: 'user', content: 'Word: ' + w }
  ], { temperature: 0.3, timeout: 15000 })

  const obj = extractJSON(r.content)
  if (!obj || !obj.meaningZh) throw new ServiceError('模型返回异常', { degradable: true })
  const out = {
    word: obj.word || w,
    pos: obj.pos || '',
    meaningZh: obj.meaningZh,
    examples: Array.isArray(obj.examples) ? obj.examples.slice(0, 4) : []
  }
  cacheSet('explain_' + w.toLowerCase(), out)
  return Object.assign({ fromCache: false }, out)
}

// ---------- 2. 翻译点评 ----------
// params: { source(待翻译原文), userAnswer(学生译文), reference(参考答案), dir('e2c'|'c2e') }
// 返回 { hasError, comment, improved }
export async function critiqueTranslation(p) {
  ensureEnabled()
  if (!p || !p.userAnswer) throw new ServiceError('缺少学生译文', { degradable: true })
  const dir = p.dir === 'e2c' ? 'e2c' : 'c2e'
  const sys = [
    'You are a patient translation tutor for Chinese English learners.',
    'Given the source text, the student\'s translation and the reference translation,',
    'evaluate the student\'s translation in Chinese. Point out concrete errors (if any) and give an improved version.',
    'Return ONLY strict JSON: {"hasError":true/false,"comment":"中文点评","improved":"改进后的译文"}.',
    'Be encouraging. If the translation is good, say so and still offer a slightly better phrasing.',
    'No markdown, no code fences.'
  ].join(' ')
  const user = [
    '翻译方向：' + (dir === 'e2c' ? '英译汉' : '汉译英'),
    '原文：' + (p.source || ''),
    '学生译文：' + (p.userAnswer || ''),
    '参考答案：' + (p.reference || ''),
    '请输出 JSON 点评。'
  ].join('\n')
  const r = await chatCompletion([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], { temperature: 0.4, timeout: 15000 })
  const obj = extractJSON(r.content)
  if (!obj) throw new ServiceError('点评生成失败', { degradable: true })
  return {
    hasError: !!obj.hasError,
    comment: obj.comment || '',
    improved: obj.improved || ''
  }
}

// ---------- 3. AI 薄弱点专练（针对指定词生成练习句） ----------
// words: [{ word, meaning }]；返回 { en, zh, targetWords, note, level }
export async function generateDrill(words) {
  ensureEnabled()
  const list = (words || []).filter(x => x && x.word).map(x => (x.word + (x.meaning ? '(' + x.meaning + ')' : '')))
  if (!list.length) throw new ServiceError('未指定目标词', { degradable: true })
  const sys = [
    'You create English-Chinese translation practice sentences for Chinese students.',
    'Use the given target words naturally in ONE English sentence (8-30 words).',
    'Return ONLY strict JSON: {"en":"英文句子","zh":"中文翻译","targetWords":["目标词"],"note":"一句中文考点说明","level":1}.',
    'Level 1-5 by difficulty. Keep vocabulary at CEFR A2-B1 except the target words.',
    'No markdown, no code fences.'
  ].join(' ')
  const user = '目标词（必须用到）：' + list.join('，') + '\n请输出 JSON。'
  const r = await chatCompletion([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], { temperature: 0.8, timeout: 15000 })
  const obj = extractJSON(r.content)
  if (!obj || !obj.en || !obj.zh) throw new ServiceError('生成失败', { degradable: true })
  return {
    en: String(obj.en).trim(),
    zh: String(obj.zh).trim(),
    targetWords: Array.isArray(obj.targetWords) ? obj.targetWords : list.map(x => x.split('(')[0]),
    note: obj.note || '',
    level: obj.level || 1
  }
}

// ---------- 4. 对话陪练 ----------
export function tutorSystemPrompt(learnedWords) {
  const hint = (learnedWords && learnedWords.length)
    ? ('The student is currently learning these words, try to use them naturally: ' + learnedWords.slice(0, 12).join(', ') + '.')
    : ''
  return [
    'You are a friendly English conversation partner for a Chinese student learning English.',
    'Always reply in simple English (CEFR A2-B1).',
    'Gently correct the student\'s grammar or wording when needed, and encourage them.',
    'Keep each reply short (1-3 sentences).',
    hint
  ].filter(Boolean).join(' ')
}

export async function chat(messages, opts) {
  ensureEnabled()
  if (!messages || !messages.length) throw new ServiceError('对话为空', { degradable: true })
  return chatCompletion(messages, Object.assign({ temperature: 0.7, timeout: 20000 }, opts || {}))
}

// ---------- 5. 配置校验 + 连通性测试（设置页用） ----------
// 纯格式校验，不发网络请求。返回 { ok, reason }
export function validateKeyFormat(cfg) {
  const c = cfg || {}
  const url = String(c.baseURL || '').trim()
  const key = String(c.apiKey || '').trim()
  const model = String(c.model || '').trim()
  if (!url) return { ok: false, reason: '未填写 API 地址' }
  if (!/^https?:\/\/\S+$/i.test(url)) return { ok: false, reason: 'API 地址需以 http:// 或 https:// 开头' }
  if (!key) return { ok: false, reason: '未填写 API 密钥' }
  if (/\s/.test(key)) return { ok: false, reason: '密钥不能包含空格' }
  if (key.length < 8) return { ok: false, reason: '密钥长度过短（至少 8 位）' }
  if (!/^[\x21-\x7E]+$/.test(key)) return { ok: false, reason: '密钥含非法字符' }
  if (!model) return { ok: false, reason: '未填写模型名（如 gpt-4o-mini / deepseek-chat）' }
  return { ok: true, reason: '' }
}

// 真实连通性测试：发一条最小请求（max_tokens=8）验证密钥确实可用。
// 不依赖 enabled 开关（设置页可能还没打开总开关），只要有地址+密钥即可测。
// 成功返回 { ok:true, latencyMs, reply }；失败抛 ServiceError（带友好中文原因）。
export async function testAIConnection() {
  const cfg = getAIConfig()
  const fmt = validateKeyFormat(cfg)
  if (!fmt.ok) throw new ServiceError(fmt.reason, { degradable: true, notConfigured: true })
  const url = chatEndpoint(cfg.baseURL)
  const t0 = Date.now()
  try {
    const res = await request({
      url,
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + cfg.apiKey, 'content-type': 'application/json' },
      data: {
        model: cfg.model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 8,
        temperature: 0
      },
      timeout: 12000
    })
    const data = res && res.data
    const choices = data && data.choices
    if (!choices || !choices.length) {
      throw new ServiceError('接口返回结构异常，请确认地址是 OpenAI 兼容接口', { degradable: true })
    }
    const reply = ((choices[0] && choices[0].message) || {}).content || ''
    return { ok: true, latencyMs: Date.now() - t0, reply: String(reply).trim().slice(0, 40) }
  } catch (e) {
    const st = e && e.extra && e.extra.status
    let msg
    if (st === 401 || st === 403) msg = '密钥无效或无权限（HTTP ' + st + '）'
    else if (st === 404) msg = '接口地址不正确（HTTP 404）'
    else if (st === 429) msg = '请求过于频繁，稍后重试（HTTP 429）'
    else if (e && e.extra && e.extra.timeout) msg = '连接超时，请检查网络或地址'
    else if (e instanceof ServiceError && e.message.indexOf('HTTP ') === 0) msg = '连接失败（' + e.message + '）'
    else if (e && e.extra && e.extra.notConfigured) msg = e.message
    else msg = '网络错误或地址不可达，请检查配置（浏览器预览还可能受跨域限制）'
    throw new ServiceError(msg, { degradable: true, status: st })
  }
}
