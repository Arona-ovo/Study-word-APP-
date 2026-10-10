// cloudfunctions/generateSentence - 例句生成云函数
// 职责：把 i+1 请求翻译成严格的大模型 Prompt，拿到 JSON 后在服务端二次校验，
// 不合规则本地重试一次；仍不合规返回空，由客户端降级到本地语料。
'use strict'

const MODEL_URL = process.env.MODEL_API_URL || ''
const MODEL_KEY = process.env.MODEL_API_KEY || ''
const MODEL_NAME = process.env.MODEL_NAME || 'gpt-4o-mini'

exports.main = async function (event = {}) {
  const scene = event.scene || '日常场景'
  const newWords = (event.newWords || []).slice(0, 3)
  const knownWords = (event.knownWords || []).slice(0, 120)
  const constraints = event.constraints || {}
  const feedback = event.feedback || ''

  if (!newWords.length) return { code: 400, message: '缺少新词' }
  if (!MODEL_URL || !MODEL_KEY) return { code: 501, message: '未配置大模型服务' }

  const prompt = buildPrompt({ scene, newWords, knownWords, constraints, feedback })

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callModel(prompt + (attempt ? '\n\n上次被拒原因：' + feedback : ''))
    const parsed = safeParse(raw)
    if (!parsed || !parsed.en || !parsed.zh) continue
    const v = validate(parsed.en, parsed.zh, { newWords, knownWords })
    if (v.ok) {
      return { code: 0, data: { en: parsed.en, zh: parsed.zh, scene, metrics: v.metrics } }
    }
    if (attempt === 0) continue // 带上校验原因再试一次
    return { code: 422, message: '生成内容未通过 i+1 校验', reasons: v.reasons }
  }
  return { code: 502, message: '生成失败，请降级到本地语料' }
}

// ---------- Prompt：把"地道、口语化、无翻译腔"写成硬约束 ----------
function buildPrompt({ scene, newWords, knownWords, constraints }) {
  const newList = newWords.map(w => `${w.word}(${w.pos || ''} ${w.meaning || ''})`).join('、')
  const len = constraints.sentenceLength || [8, 30]
  return [
    '你是资深英语教师，为中国的专升本考生生成例句。严格遵守以下要求：',
    `1. 场景：${scene}。句子必须地道、口语化或贴近真实日常，使用词典中的原生搭配（collocation）。`,
    `2. 必须自然包含这 ${newWords.length} 个目标词：${newList}（可用合理的词形变化）。`,
    `3. 句中其余实词只能使用下面这份"已掌握词表"里的词：${knownWords.slice(0, 120).join(', ')}。`,
    '4. 严禁：直译中文句式、翻译腔、中式英语；严禁在一句话里堆砌多个生词；语法必须正确。',
    `5. 长度控制在 ${len[0]}-${len[1]} 个单词之内。`,
    '6. 中文释义要自然通顺，符合中文表达习惯，不要逐字对译。',
    '7. 只输出如下 JSON，不要任何解释、markdown 或代码块：',
    '{"en":"英文例句","zh":"自然中文释义","scene":"场景"}'
  ].join('\n')
}

async function callModel(prompt) {
  const https = require('https')
  const body = JSON.stringify({
    model: MODEL_NAME,
    temperature: 0.7,
    messages: [
      { role: 'system', content: 'You are a precise English teaching assistant. Output strict JSON only.' },
      { role: 'user', content: prompt }
    ]
  })
  const url = new URL(MODEL_URL)
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        authorization: 'Bearer ' + MODEL_KEY
      }
    }, res => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => resolve(extractText(data)))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function extractText(data) {
  try {
    const j = JSON.parse(data)
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ''
  } catch (e) { return '' }
}

function safeParse(raw) {
  if (!raw) return null
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch (e) { return null }
}

// ---------- 服务端校验（与客户端 iplus1.validateSentence 同规则） ----------
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'do', 'does', 'did', 'have', 'has', 'had', 'it', 'we', 'you', 'he', 'she', 'they', 'i', 'my', 'your', 'this', 'that', 'as', 'at', 'by', 'with', 'from', 'about', 'not', 'can', 'will', 'should', 'there'])
const stem = w => w.replace(/(ing|ed|es|s|ly|er|est)$/, '')

function validate(en, zh, { newWords, knownWords }) {
  const reasons = []
  const tokens = (en || '').toLowerCase().replace(/[^a-z'\s-]/g, ' ').split(/\s+/).filter(Boolean)
  const news = newWords.map(w => (w.word || '').toLowerCase())
  const known = new Set(knownWords.map(w => String(w).toLowerCase()))

  if (tokens.length < 8 || tokens.length > 30) reasons.push('长度不在 8-30 词')
  news.forEach(n => {
    if (!tokens.some(t => stem(t) === stem(n) || stem(t).startsWith(stem(n)))) reasons.push('缺少目标词 ' + n)
  })
  const content = tokens.filter(t => !STOP.has(t) && !news.some(n => stem(t).startsWith(stem(n))))
  const cov = content.length ? content.filter(t => known.has(t) || known.has(stem(t))).length / content.length : 1
  if (cov < 0.7) reasons.push('主干熟词覆盖率 ' + Math.round(cov * 100) + '% < 70%')
  const strangers = content.filter(t => !known.has(t) && !known.has(stem(t)))
  if (strangers.length > 1) reasons.push('生词堆砌：' + strangers.slice(0, 3).join(','))
  if (!zh || zh.length < 6) reasons.push('中文释义缺失或过短')
  return { ok: !reasons.length, reasons, metrics: { length: tokens.length, knownCoverage: Math.round(cov * 100), strangers: strangers.length } }
}
