// utils/sentence-api.js - 例句生成统一入口
// 三级供给：AI 生成（统一服务层 services/llm）→ 本地缓存 → 本地句库兜底
// 所有出口都经过 validateSentence 校验，不合规即降级/重试，保证 i+1 可理解输入。
import { SENTENCES } from '../data/sentences.js'
import * as iplus1 from './iplus1.js'
import * as sentenceIndex from './sentence-index.js'
import { lemma } from './lemma.js'
// 直接走叶子模块（不走 services/index.js 门面，避免 utils→门面 的模块环）
import { chatCompletion } from '../services/llm.js'
// 底层缓存：生成的句子落在这里，与词书 / 学习进度分离，设置页可一键清空
import * as aiCache from './ai-cache.js'
import { featureOn } from '../services/ai-gate.js'

const MAX_RETRY = 2

// 在途请求表：sig -> Promise
// 出题改成并发之后，同一批里可能有两个请求算出一样的签名（同词书 + 同场景 + 同目标词）。
// 不加这层就会对同一个句子发两次请求、花两份 token，回来还是同一句。
const inflight = new Map()

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

  // 同签名的请求已经在飞了 → 等它，别再发一次
  const running = inflight.get(sig)
  if (running) {
    const s = await running
    if (s && s.en) return { ...s }
    return s || { sid: '', en: '', zh: '', newWords: [], source: 'none' }
  }

  const p = resolveSentence(req, sig)
  inflight.set(sig, p)
  try {
    const s = await p
    return s
  } finally {
    // 只在"自己就是发起者"时清表：并发方可能刚拿到这个 Promise
    if (inflight.get(sig) === p) inflight.delete(sig)
  }
}

// 真正的生成逻辑（AI → 重试 → 本地语料兜底），从不抛错
async function resolveSentence(req, sig) {
  let lastReason = ''
  // 用户在设置里关掉「AI 例句」→ 一次模型都不调，直接走下面的本地语料兜底。
  // 这是全 App 调用最频繁的 AI 入口（每次出题都可能触发），也是最容易把额度烧穿的一处。
  if (!featureOn('sentence')) lastReason = 'AI 例句已在设置里关闭'
  for (let i = 0; i < MAX_RETRY && !lastReason; i++) {
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
  // 兜底结果同样落缓存：它是"这次给到用户的例句"，
  // 之后同一个词 / 同一个请求能直接复用，不用再走一遍筛选。
  const fallback = pickFromCorpus(req)
  if (fallback) {
    const out = { ...fallback, source: 'corpus' }
    writeCache(sig, out)
    return out
  }

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
  if ((req.learningWords || []).length) {
    lines.push('尽量自然地用上这些词书里正在学的词（1-2 个即可，允许变形，不要硬塞）：' + req.learningWords.slice(0, 60).join(', '))
  }
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
  // 词书词汇表（熟词 + 正在学的词）：命中越多越优先 —— 练习句子尽量出现词书里的单词
  const bookSet = new Set(known)
  ;(req.learningWords || []).forEach(w => bookSet.add(String(w).toLowerCase()))
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
    const bookHits = lemmas.filter(t => bookSet.has(t) && !newTexts.some(n => n === t || lemma(n) === t)).length
    return {
      s,
      hits: hits.length,
      cov: cov,
      bookHits,
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
      .sort((a, b) => (b.hits - a.hits) || (b.bookHits - a.bookHits) || (b.cov - a.cov) || (b.note - a.note))
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

// 缓存读写统一走 utils/ai-cache.js：
//   这样「清缓存」只需动一个 key，不会漏掉藏在 store 里的那一坨。
function readCache(sig) {
  return aiCache.sentenceBySig(sig)
}

function writeCache(sig, data) {
  aiCache.rememberSentence(data, sig)
}

// 空句子占位：并发 + 提前收手时，未跑到的位置用它填坑。
// 这样 results[i] 永远和 reqList[i] 对齐，调用方的 filter(x => x.en) 也不会踩到 undefined。
const EMPTY_SENTENCE = { sid: '', en: '', zh: '', newWords: [], source: 'none' }

// 批量生成（导入新词后使用）
//
// 默认是「串行 + 300ms 限速」的老行为；导入场景传 concurrency 提速：
//   100 个词串行要 100×(请求耗时 + 0.3s)，并发 3 之后墙钟时间大约除以 3。
//   并发数刻意压在 1~6：例句请求体不小，打太满容易被服务商限流 / 触发熔断。
//
// onItem(sentence, index, total)：每完成一条回调一次，调用方可拿它刷进度；
//   支持 async —— 会被 await，因此可以在这里插入「暂停 / 取消」检查点。
//   并发下回调按**完成顺序**触发，index 仍是该请求在 reqList 里的原始下标。
// opts: { concurrency = 1, gap = 300, shouldStop }
//   gap：每个 worker 两条之间的间隔；并发已经起到限速作用，调用方通常传 0。
export async function generateBatch(reqList, onItem, opts) {
  const o = opts || {}
  const total = (reqList || []).length
  const out = new Array(total)
  for (let i = 0; i < total; i++) out[i] = EMPTY_SENTENCE

  const gap = typeof o.gap === 'number' ? o.gap : 300
  const conc = Math.max(1, Math.min(6, Math.floor(Number(o.concurrency) || 1)))
  const stop = typeof o.shouldStop === 'function' ? o.shouldStop : null

  let next = 0
  async function worker() {
    for (;;) {
      if (stop && stop()) return
      const i = next++
      if (i >= total) return
      const s = await generateSentence(reqList[i])
      out[i] = s || EMPTY_SENTENCE
      if (onItem) await onItem(out[i], i, total)
      // 并发下这个间隔落在单个 worker 上：既压住单条速率，又不拖慢整体吞吐
      if (gap > 0 && next < total) await sleep(gap)
    }
  }

  const pool = []
  const n = Math.min(conc, total)
  for (let k = 0; k < n; k++) pool.push(worker())
  await Promise.all(pool)
  return out
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
