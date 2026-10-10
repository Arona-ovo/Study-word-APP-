// utils/iplus1.js - 可理解输入（i+1）核心：新词挑选 + 例句质量校验
//
// 规则：
// 1) 例句主干只用已掌握基础词（m >= KNOWN_M），每句最多嵌入 1-3 个新词；
// 2) 句中除新词外的实词，>= 70% 必须命中熟词池（保证可理解）；
// 3) 不允许"生词堆砌"：非熟词池且非指定新词的实词 <= 1 个（功能词不计入）；
// 4) 长度 8-30 词；英文语法由生成端保证，此处做结构校验 + 中文释义非空校验。
import { allByText, allById, allWords } from '../data/lexicon.js'
import { getBook } from '../data/wordbooks.js'
import * as wordbook from './wordbook.js'
import { lemma } from './lemma.js'

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

// 词索引统一走 data/lexicon.js 的全局表：核心 640 词 + 所有内置词书共享词条都在里面。
// 早先这里只用 words.js 建表，切到新词书后 batch.wordIds 解析不出词对象，出题会退化成空组。
export function wordById(id) { return allById()[id] }
export function wordByText(t) { return allByText()[(t || '').toLowerCase()] }

// ---------- 1. 选词 ----------
// 从当前词书挑选待学新词：优先未学过 → 学过但未掌握 → 按批次顺序
// 有内置批次 → 在"活动批次"里选；纯导入词词书（自建词书 / 我的导入词书）→ 在该书导入词里选
export function pickNewWords(bookId, count = 1, excludeIds) {
  const bid = bookId || wordbook.currentBookId()
  const book = getBook(bid)
  const m = wordbook.masteryMap(bid)
  const skip = new Set(excludeIds || [])
  const n = Math.max(MIN_NEW, Math.min(MAX_NEW, count))

  const idx = book.batches.length ? wordbook.activeBatchIndex(bid) : 0
  const batch = book.batches[idx]
  const source = (batch && batch.wordIds.length)
    ? batch.wordIds.map(id => allById()[id]).filter(Boolean)
    : wordbook.bookWords(bid).filter(w => w.custom)

  const scored = source.filter(w => w && !skip.has(w.id)).map(w => {
    const r = m[w.id]
    return { w, mastery: r ? r.m : 0, seen: r ? r.seen : 0 }
  })

  // 未接触最优先；其次掌握度低的；同分按批次顺序（难度由易到难）
  scored.sort((a, b) => (a.mastery - b.mastery) || (a.seen - b.seen))
  const level = scored.filter(x => x.mastery <= NEW_M)
  const pool = level.length ? level : scored
  const picked = pool.slice(0, n).map(x => x.w)
  return {
    batchIndex: idx,
    batchName: batch ? batch.name : (book.name || '词书'),
    wordIds: picked.map(w => w.id),
    words: picked
  }
}

// 熟词池：掌握度达标的基础词，用于生成例句主干
export function knownPool(bookId, limit = 120) {
  const bid = bookId || wordbook.currentBookId()
  const m = wordbook.masteryMap(bid)
  const known = []
  wordbook.bookWords(bid).forEach(w => {
    const r = m[w.id]
    if (r && r.m >= KNOWN_M && !w.custom) known.push(w.w)
  })
  // 熟词不足时冷启动兜底：先用「当前词书里最简单的词」补（刚换词书时不至于拿别书的词当熟词），
  // 仍不够才退到全局最基础的 Lv1 词。只补到 40 个，避免覆盖率虚高导致 i+1 失效。
  if (known.length < 30) {
    const pool = []
    wordbook.bookWords(bid).forEach(w => { if (!w.custom && w.lv === 1) pool.push(w.w) })
    allWords().forEach(w => { if (w.lv === 1) pool.push(w.w) })
    for (let i = 0; i < pool.length && known.length < 40; i++) {
      if (known.indexOf(pool[i]) < 0) known.push(pool[i])
    }
  }
  return known.slice(0, limit)
}

// AI 生成例句的难度：按「当前批次在词书里的相对位置」给 1-4。
// 以前这里写死 'zsb'，而 sentence-api 会把它当数字拼进提示词（"难度等级：zsb"），对模型是噪声。
function bookLevel(bid) {
  try {
    const book = getBook(bid)
    if (!book.batches.length) return 2
    const i = Math.min(book.batches.length - 1, wordbook.activeBatchIndex(bid))
    const lv = book.batches[i] && book.batches[i].level
    return lv ? Math.max(1, Math.min(4, lv)) : 2
  } catch (e) { return 2 }
}

// ---------- 2. 构造生成请求 ----------
export function buildRequest(bookId, opts = {}) {
  const bid = bookId || wordbook.currentBookId()
  const picked = pickNewWords(bid, opts.newCount || 1, opts.excludeWordIds)
  const known = knownPool(bid, opts.knownLimit || 120)
  // 词书里还没掌握的词：让句子尽量自然带上一两个 —— 用户要求"练习里尽量出现词书里的单词"。
  // 校验时它们按"允许的词"处理（不算额外生词），AI prompt 里单独一行鼓励使用
  const m = wordbook.masteryMap(bid)
  const pickedWords = {}
  picked.words.forEach(w => { pickedWords[w.w] = true })
  const learningWords = wordbook.bookWords(bid)
    .filter(w => !(m[w.id] && m[w.id].m >= KNOWN_M) && !pickedWords[w.w] && !known.includes(w.w))
    .map(w => w.w)
    .slice(0, 80)
  return {
    bookId: bid,
    level: opts.level || bookLevel(bid),
    scene: opts.scene || SCENES[(Math.random() * SCENES.length) | 0],
    newWords: picked.words.map(w => ({ word: w.w, pos: w.pos, meaning: w.m })),
    knownWords: known,
    learningWords,
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
  // 熟词 + 词书中正在学的词都算"允许的词"：句子带词书词是加分项，不是生词堆砌
  const known = new Set([
    ...(req.knownWords || []).map(w => w.toLowerCase()),
    ...(req.learningWords || []).map(w => w.toLowerCase())
  ])

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

// 撤销一次 pass 并改判为 fail（「记错了」）：与 engine.revokePass 同一套净效果（m -3）。
// 页面两处都要调 —— engine 管全局 mastery / 今日统计 / 错题本，这里管词书维度掌握度。
export function revokeMastery(bookId, wordIds) {
  const bid = bookId || wordbook.currentBookId()
  wordIds.forEach(id => {
    const cur = { ...(wordbook.masteryMap(bid)[id] || { m: 0, seen: 0, correct: 0 }) }
    cur.correct = Math.max(0, (cur.correct || 0) - 1)
    cur.m = Math.max(0, (Number(cur.m) || 0) - 3)
    wordbook.setMastery(bid, id, cur)
  })
  return true
}
