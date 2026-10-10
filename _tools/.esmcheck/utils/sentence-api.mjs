// utils/sentence-api.js - 例句生成统一入口
// 三级供给：AI 生成（统一服务层 services/llm）→ 本地缓存 → 本地句库兜底
// 所有出口都经过 validateSentence 校验，不合规即降级/重试，保证 i+1 可理解输入。
import { SENTENCES } from '../data/sentences.mjs'
import * as iplus1 from './iplus1.mjs'
import * as store from './store.mjs'
import * as sentenceIndex from './sentence-index.mjs'
import { lemma } from './lemma.mjs'
// 直接走叶子模块（不走 services/index.js 门面，避免 utils→门面 的模块环）
import { chatCompletion } from '../services/llm.mjs'

const MAX_RETRY = 2
const CACHE_KEY = 'fj_sentence_cache'

// ---------- 对外主接口 ----------
// 输入 request：{
//   bookId, level, scene, newWords:[{word,pos,meaning}] (1-3 个), knownWords:[string],
//   constraints:{newWordCount,maxNewWords,sentenceLength,style,forbid}, excludeSids:[]
// }
// 返回 sentence：{
//   sid, en, zh, newWords:[], scene, source:'ai'|'cache'|'corpus', metrics
// }
export async function generateSentence(req) {
  const sig = signature(req)
  const cached = readCache(sig)
  if (cached) return { ...cached, source: 'cache' }

  let lastReason = ''
  for (let i = 0; i < MAX_RETRY; i++) {
    let ai = null
    try {
      ai = await callAIService(req, i)
    } catch (e) {
      lastReason = '生成服务不可用：' + (e && e.message ? e.message : e)
      break
    }
    if (ai && ai.en && ai.zh) {
      const v = iplus1.validateSentence(ai.en, ai.zh, req)
      if (v.ok) {
        const out = {
          sid: 'ai-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          en: ai.en.trim(),
          zh: ai.zh.trim(),
          newWords: req.newWords.map(w => w.word || w),
          scene: ai.scene || req.scene,
          source: 'ai',
          metrics: v.metrics
        }
        writeCache(sig, out)
        return out
      }
      lastReason = v.reasons.join('；')
      // 校验不通过：把失败原因回传给生成端，作为下一轮的修正提示
      req = { ...req, _feedback: v.reasons }
    }
  }

  // 兜底：本地句库按 i+1 规则筛选（熟词为主 + 新词命中）
  const fallback = pickFromCorpus(req)
  if (fallback) return { ...fallback, source: 'corpus' }

  return { sid: '', en: '', zh: '', newWords: [], source: 'none', error: lastReason || '无可用例句' }
}

// ---------- AI 服务调用（统一服务层：services/llm） ----------
// 走 OpenAI 兼容接口，服务商差异由 services 层屏蔽；
// 未配置 / 超时 / 报错一律抛错，由 generateSentence 降级到本地语料。
const SYSTEM_PROMPT = [
  'You generate example sentences for Chinese students learning English.',
  'Output ONLY strict JSON with keys "en", "zh", "scene".',
  'No markdown, no code fences, no explanations.'
].join(' ')

async function callAIService(req, retryIndex) {
  const r = await chatCompletion(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(req, retryIndex) }
    ],
    { temperature: 0.8, timeout: 15000 }
  )
  return normalizeAIPayload(r.content)
}

function buildPrompt(req, retryIndex) {
  const c = req.constraints || {}
  const lines = []
  lines.push('场景：' + (req.scene || '日常学习'))
  lines.push('难度等级：' + (req.level || 1) + '（1 最简单，5 较难）')
  lines.push('必须用到的目标词：' + req.newWords.map(w => (w.word || w) + (w.meaning ? '(' + w.meaning + ')' : '')).join(', '))
  lines.push('句长：' + (c.sentenceLength || '8-30 个英文单词'))
  lines.push('除目标词外，只使用这些熟词：' + (req.knownWords || []).slice(0, 80).join(', '))
  if (c.forbid) lines.push('禁止：' + c.forbid)
  if (c.style) lines.push('风格：' + c.style)
  if (req._feedback && req._feedback.length) {
    lines.push('上一稿未通过校验，原因：' + req._feedback.join('；') + '。请修正后重新输出 JSON。')
  }
  lines.push('第 ' + (retryIndex + 1) + ' 次生成。只输出 JSON：{"en":"...","zh":"...","scene":"..."}')
  return lines.join('\n')
}

// 只接受严格 JSON：{ en, zh, scene }
function normalizeAIPayload(raw) {
  if (!raw) return null
  let obj = raw
  if (typeof raw === 'string') {
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    try { obj = JSON.parse(m[0]) } catch (e) { return null }
  }
  return { en: obj.en || obj.sentence || '', zh: obj.zh || obj.translation || '', scene: obj.scene || '' }
}

// ---------- 本地语料兜底 ----------
// 关键改造（2026-10）：必须命中目标新词。
// 旧实现用"前缀模糊匹配 + score>0"筛选，熟词覆盖率单独就能让无关句子入选，
// 实测 10 题只有 3 题与新词相关。现改为倒排索引取候选 + 四级兜底，
// 前三级硬性要求 hits >= 1，只有最后一级（确实无候选）才放宽并标记 degraded。
function pickFromCorpus(req) {
  const newTexts = req.newWords.map(w => String(w.word || w).toLowerCase())
  const known = new Set((req.knownWords || []).map(w => String(w).toLowerCase()))
  const excluded = new Set(req.excludeSids || [])

  // 1) 倒排索引取候选（不再全表扫描）
  let cand = []
  const seenSid = new Set()
  newTexts.forEach(n => {
    sentenceIndex.candidates(n).forEach(s => {
      if (excluded.has('corpus-' + s.id) || seenSid.has(s.id)) return
      seenSid.add(s.id)
      cand.push(s)
    })
  })
  if (!cand.length) {
    cand = SENTENCES.filter(s => !excluded.has('corpus-' + s.id))
  }
  if (!cand.length) return null

  // 2) 打分：精确 / 原形命中才算 hit
  const scored = cand.map(s => {
    const tokens = iplus1.tokenizeWords(s.en)
    const lemmas = tokens.map(t => lemma(t))
    const hits = newTexts.filter(n => {
      const nl = lemma(n)
      return lemmas.some(l => l === nl || l === n)
    })
    const content = lemmas.filter(t => t.length > 3)
    const cov = content.length ? content.filter(t => known.has(t)).length / content.length : 0
    return {
      s,
      hits: hits.length,
      cov: cov,
      lenOk: tokens.length >= 8 && tokens.length <= 30,
      len: tokens.length,
      note: !!s.note
    }
  })

  // 3) 四级兜底，逐级放宽；每级内取 top8 随机一个（避免每次固定同一句）
  const tiers = [
    { fn: x => x.hits >= 1 && x.lenOk && x.cov >= 0.7, degraded: false },
    { fn: x => x.hits >= 1 && x.lenOk, degraded: false },
    { fn: x => x.hits >= 1, degraded: false },
    { fn: x => x.lenOk, degraded: true }
  ]
  for (const tier of tiers) {
    const pool = scored.filter(tier.fn)
      .sort((a, b) => (b.hits - a.hits) || (b.cov - a.cov) || (b.note - a.note))
    if (!pool.length) continue
    const top = pool.slice(0, 8)
    const pick = top[(Math.random() * top.length) | 0]
    return {
      sid: 'corpus-' + pick.s.id,
      en: pick.s.en,
      zh: pick.s.zh,
      newWords: newTexts,
      scene: req.scene,
      source: 'corpus',
      degraded: tier.degraded,
      metrics: {
        knownCoverage: Math.round(pick.cov * 100),
        hits: pick.hits,
        length: pick.len
      }
    }
  }
  return null
}

// ---------- 缓存 ----------
function signature(req) {
  const keys = req.newWords.map(w => (w.word || w).toLowerCase()).sort().join(',')
  return req.bookId + '|' + (req.scene || '') + '|' + keys
}

function readCache(sig) {
  const st = store.get()
  const cache = st[CACHE_KEY] || {}
  const hit = cache[sig]
  if (hit && Date.now() - hit.ts < 7 * 24 * 3600 * 1000) return hit.data
  return null
}

function writeCache(sig, data) {
  const st = store.get()
  st[CACHE_KEY] = st[CACHE_KEY] || {}
  const cache = st[CACHE_KEY]
  cache[sig] = { ts: Date.now(), data }
  // 控制容量，防止本地存储膨胀
  const keys = Object.keys(cache)
  if (keys.length > 200) keys.slice(0, keys.length - 200).forEach(k => delete cache[k])
  store.save(st)
}

// 批量生成（导入新词后使用）：串行限速，避免瞬间打满
export async function generateBatch(reqList, onItem) {
  const out = []
  for (const req of reqList) {
    const s = await generateSentence(req)
    out.push(s)
    if (onItem) onItem(s)
    await sleep(300)
  }
  return out
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
