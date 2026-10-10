// utils/iplus1.js - 可理解输入（i+1）核心：新词挑选 + 例句质量校验
//
// 规则：
// 1) 例句主干只用已掌握基础词（m >= KNOWN_M），每句最多嵌入 1-3 个新词；
// 2) 句中除新词外的实词，>= 70% 必须命中熟词池（保证可理解）；
// 3) 不允许"生词堆砌"：非熟词池且非指定新词的实词 <= 1 个（功能词不计入）；
// 4) 长度 8-30 词；英文语法由生成端保证，此处做结构校验 + 中文释义非空校验。
import { WORDS } from '../data/words.mjs'
import { getBook } from '../data/wordbooks.mjs'
import * as wordbook from './wordbook.mjs'
import { lemma } from './lemma.mjs'

const KNOWN_M = 3          // m >= 3 视为可理解的主干词汇
const NEW_M = 2            // m <= 2 视为待学新词
const MAX_NEW = 3
const MIN_NEW = 1

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'but', 'is', 'am', 'are',
  'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had', 'it',
  'its', 'we', 'you', 'he', 'she', 'they', 'i', 'my', 'your', 'his', 'her', 'their', 'our',
  'this', 'that', 'these', 'those', 'as', 'at', 'by', 'with', 'from', 'about', 'into',
  'than', 'then', 'so', 'not', 'no', 'if', 'can', 'could', 'will', 'would', 'should', 'must',
  'there', 'here', 'what', 'when', 'where', 'how', 'who', 'which', 'because', 'up', 'out', 'over'
])

const WORD_BY_ID = {}
const WORD_BY_TEXT = {}
WORDS.forEach(w => {
  WORD_BY_ID[w.id] = w
  WORD_BY_TEXT[w.w.toLowerCase()] = w
})

export function wordById(id) { return WORD_BY_ID[id] }
export function wordByText(t) { return WORD_BY_TEXT[(t || '').toLowerCase()] }

// ---------- 1. 选词 ----------
// 从当前词书的"活动批次"挑选待学新词：优先未学过 → 学过但未掌握 → 按批次顺序
export function pickNewWords(bookId, count = 1, excludeIds) {
  const bid = bookId || wordbook.currentBookId()
  const book = getBook(bid)
  const idx = wordbook.activeBatchIndex(bid)
  const batch = book.batches[idx]
  const m = wordbook.masteryMap(bid)
  const skip = new Set(excludeIds || [])

  const scored = batch.wordIds.filter(id => !skip.has(id)).map(id => {
    const r = m[id]
    const mastery = r ? r.m : 0
    return { id, mastery, seen: r ? r.seen : 0 }
  }).filter(Boolean)

// 未接触最优先；其次掌握度低的；同分按批次顺序（难度由易到难）
  scored.sort((a, b) => (a.mastery - b.mastery) || (a.seen - b.seen))
  const level = scored.filter(x => x.mastery <= NEW_M)
  const pool = level.length ? level : scored
  const n = Math.max(MIN_NEW, Math.min(MAX_NEW, count))
  return {
    batchIndex: idx,
    batchName: batch.name,
    wordIds: pool.slice(0, n).map(x => x.id),
    words: pool.slice(0, n).map(x => WORD_BY_ID[x.id])
  }
}

// 熟词池：掌握度达标的基础词，用于生成例句主干
export function knownPool(bookId, limit = 120) {
  const bid = bookId || wordbook.currentBookId()
  const m = wordbook.masteryMap(bid)
  const known = []
  getBook(bid).batches.forEach(b => b.wordIds.forEach(id => {
    const r = m[id]
    if (r && r.m >= KNOWN_M) known.push(WORD_BY_ID[id].w)
  }))
  // 熟词不足时冷启动兜底：只补 Lv1 里最基础的一小段，避免覆盖率虚高导致 i+1 失效
  if (known.length < 30) {
    WORDS.filter(w => w.lv === 1).slice(0, 40 - known.length).forEach(w => {
      if (!known.includes(w.w)) known.push(w.w)
    })
  }
  return known.slice(0, limit)
}

// ---------- 2. 构造生成请求 ----------
export function buildRequest(bookId, opts = {}) {
  const bid = bookId || wordbook.currentBookId()
  const picked = pickNewWords(bid, opts.newCount || 1, opts.excludeWordIds)
  const known = knownPool(bid, opts.knownLimit || 120)
  return {
    bookId: bid,
    level: opts.level || 'zsb',
    scene: opts.scene || SCENES[(Math.random() * SCENES.length) | 0],
    newWords: picked.words.map(w => ({ word: w.w, pos: w.pos, meaning: w.m })),
    knownWords: known,
    constraints: {
      newWordCount: picked.words.length,   // 1-3
      maxNewWords: MAX_NEW,
      sentenceLength: [8, 30],
      style: ['idiomatic', 'daily', 'colloquial'],
      forbid: ['translation tone', 'Chinglish', 'multiple new words in one clause']
    },
    excludeSids: opts.excludeSids || []
  }
}

export const SCENES = [
  '校园生活', '兼职与工作', '家庭日常', '出行交通', '购物消费',
  '健康与运动', '饮食', '社交媒体', '天气与计划', '考试与学习'
]

// ---------- 3. 例句校验（生成端与服务端共用） ----------
export function tokenizeWords(sentence) {
  return (sentence || '')
    .toLowerCase()
    .replace(/[^a-z'\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

// 词形还原（improving -> improve、studies -> study），复用 utils/lemma.js
function stem(w) {
  return lemma(w)
}

export function validateSentence(en, zh, req) {
  const reasons = []
  const tokens = tokenizeWords(en)
  const newWords = (req.newWords || []).map(w => (w.word || w).toLowerCase())
  const known = new Set((req.knownWords || []).map(w => w.toLowerCase()))

  if (!en || !zh) return { ok: false, reasons: ['缺少英文或中文释义'] }

  // 长度
  if (tokens.length < 8 || tokens.length > 30) reasons.push('句子长度需在 8-30 词之间')

  // 新词必须全部出现（允许词形变化）
  const hitNew = new Set()
  tokens.forEach(t => {
    const s = stem(t)
    newWords.forEach(n => { if (s === n || s.startsWith(stem(n))) hitNew.add(n) })
  })
  newWords.forEach(n => { if (!hitNew.has(n)) reasons.push('新词未出现在句中：' + n) })
  if (newWords.length < MIN_NEW || newWords.length > MAX_NEW) reasons.push('新词数量必须为 1-3 个')

  // 主干可理解性：非新词实词中，熟词占比 >= 70%
  const contentWords = tokens.filter(t => !STOPWORDS.has(t) && !newWords.some(n => stem(t).startsWith(stem(n))))
  const knownHit = contentWords.filter(t => known.has(t) || known.has(stem(t)))
  const coverage = contentWords.length ? knownHit.length / contentWords.length : 1
  if (coverage < 0.7) reasons.push('主干熟词覆盖率 ' + Math.round(coverage * 100) + '% < 70%，生词过多')

  // 生词堆砌检测：既非熟词也非指定新词的实词 <= 1
  const strangers = contentWords.filter(t => !known.has(t) && !known.has(stem(t)))
  if (strangers.length > 1) reasons.push('句中存在额外生词堆砌：' + strangers.slice(0, 3).join(', '))

  // 中文释义基本校验
  if (/[a-zA-Z]{4,}/.test(zh)) reasons.push('中文释义疑似含未翻译的英文')
  if (zh.length < 6) reasons.push('中文释义过短')

  return {
    ok: reasons.length === 0,
    reasons,
    metrics: {
      length: tokens.length,
      newWordHit: hitNew.size,
      knownCoverage: Math.round(coverage * 100),
      strangers: strangers.length
    }
  }
}

// 答题后回写掌握度（保持与 engine 相同的 +1/-2 规则，但按词书维度）
export function recordMastery(bookId, wordIds, status) {
  const bid = bookId || wordbook.currentBookId()
  wordIds.forEach(id => {
    const cur = { ...(wordbook.masteryMap(bid)[id] || { m: 0, seen: 0, correct: 0 }) }
    cur.seen++
    if (status === 'pass') { cur.correct++; cur.m = Math.min(5, cur.m + 1) }
    else if (status === 'fail') { cur.m = Math.max(0, cur.m - 2) }
    wordbook.setMastery(bid, id, cur)
  })
  return true
}
