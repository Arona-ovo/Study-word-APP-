// utils/session.js - 出题会话：把 i+1 生成链路接进练习流程
// 流程：buildRequest(选 1-3 个新词 + 熟词池) → generateSentence(AI/缓存/语料) → 组装题目(干扰项/方向/考点词)
import * as iplus1 from './iplus1.mjs'
import * as wordbook from './wordbook.mjs'
import * as api from './sentence-api.mjs'
import * as aiContent from '../services/ai-content.mjs'
import * as sentenceIndex from './sentence-index.mjs'
import { SENTENCES } from '../data/sentences.mjs'
import { WORDS } from '../data/words.mjs'
import { getBook } from '../data/wordbooks.mjs'

const WORD_BY_TEXT = {}
const WORD_BY_ID = {}
WORDS.forEach(w => { WORD_BY_TEXT[w.w.toLowerCase()] = w; WORD_BY_ID[w.id] = w })

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  return a
}

// 新词数量随水平提升：1 → 2 → 3
// 阈值按词库总量的比例计算（词库从 64 扩到 640 后，绝对值阈值会失效）
function newCountFor(bookId) {
  const m = wordbook.masteryMap(bookId)
  let mastered = 0
  Object.keys(m).forEach(k => { if (m[k].m >= 4) mastered++ })
  const t = WORDS.length || 640
  if (mastered >= t * 0.3) return 3
  if (mastered >= t * 0.1) return 2
  return 1
}

// 组装题目：方向随机 + 四选一干扰项（取相邻难度句的同侧文本）
export function makeQuestion(sentence, bookId, dir) {
  const isE2C = dir === 'e2c'
  const answer = isE2C ? sentence.zh : sentence.en
  const lv = sentence.lv || 1
  // 用索引取相邻难度档的候选，避免每道题对全部例句做两次全表 filter
  let pool = sentenceIndex.neighbours(lv).filter(x => (isE2C ? x.zh : x.en) !== answer)
  if (pool.length < 3) pool = SENTENCES.filter(x => (isE2C ? x.zh : x.en) !== answer)
  const distractors = shuffle(pool).slice(0, 3).map(x => (isE2C ? x.zh : x.en))
  const options = shuffle([answer].concat(distractors))
  const words = (sentence.newWords || []).map(t => WORD_BY_TEXT[String(t).toLowerCase()]).filter(Boolean)
  return {
    sid: sentence.sid,
    dir,
    prompt: isE2C ? sentence.en : sentence.zh,
    answer,
    options,
    answerIndex: options.indexOf(answer),
    lv,
    note: sentence.note || '',
    words: words.length ? words : [],
    wordIds: words.map(w => w.id),
    scene: sentence.scene || '',
    source: sentence.source || 'corpus',
    bookId
  }
}

// 兜底：语料也没有匹配时，随机取一句（排除本会话已用过的，保证不重复）
function fallbackQuestion(bookId, excludeSids) {
  const ex = new Set(excludeSids || [])
  let pool = SENTENCES.filter(s => !ex.has('corpus-' + s.id))
  if (!pool.length) pool = SENTENCES.slice()
  const s = pool[(Math.random() * pool.length) | 0]
  const names = (s.w || []).map(id => WORD_BY_ID[id]).filter(Boolean).map(w => w.w)
  return makeQuestion(
    { sid: 'corpus-' + s.id, en: s.en, zh: s.zh, lv: s.lv, note: s.note, newWords: names, source: 'corpus' },
    bookId,
    Math.random() < 0.5 ? 'e2c' : 'c2e'
  )
}

// 主入口：异步生成一组题目
export async function buildSession(n = 10, bookId) {
  const bid = bookId || wordbook.currentBookId()
  const questions = []
  const used = new Set()
  // 同一组内避免一直围着同一个新词出题：每题轮换目标词
  const usedWords = new Set()
  for (let i = 0; i < n; i++) {
    const req = iplus1.buildRequest(bid, {
      newCount: newCountFor(bid),
      excludeSids: Array.from(used),
      excludeWordIds: Array.from(usedWords)
    })
    const s = await api.generateSentence(req)
    if (!s || !s.en) {
      const q = fallbackQuestion(bid, Array.from(used))
      used.add(q.sid)
      questions.push(q)
      continue
    }
    used.add(s.sid)
    const q = makeQuestion(s, bid, Math.random() < 0.5 ? 'e2c' : 'c2e')
    ;(q.wordIds || []).forEach(id => usedWords.add(id))
    questions.push(q)
  }
  return questions
}

// 错题重练（复用旧错题本，题目结构保持一致）
export async function reviewSession() {
  const engine = await import('./engine.mjs')
  return engine.reviewQuestions()
}

// AI 薄弱点专练：围绕用户当前词书里「掌握度偏低」的词生成练习
// 优先走 ai-content.generateDrill（更贴合目标词），失败则回落到通用 i+1 生成链路。
export async function buildDrillSession(n = 10, bookId) {
  const bid = bookId || wordbook.currentBookId()
  const book = getBook(bid)
  const ids = book.batches.reduce((a, b) => a.concat(b.wordIds), [])
  const m = wordbook.masteryMap(bid)

  // 薄弱词：m<3，越少越优先；不足则用全部词兜底
  let weak = ids
    .map(id => ({ id, m: (m[id] || {}).m || 0 }))
    .filter(x => x.m < 3)
    .sort((a, b) => a.m - b.m)
    .map(x => WORD_BY_ID[x.id]).filter(Boolean)
  if (!weak.length) weak = ids.map(id => WORD_BY_ID[id]).filter(Boolean)
  if (!weak.length) return []

  // 熟词池（用于让生成句主干可理解）
  const mastered = ids
    .map(id => WORD_BY_ID[id]).filter(Boolean)
    .filter(w => (m[w.id] || {}).m >= 4)
    .map(w => w.w)

  const questions = []
  const usedWords = new Set()
  for (let i = 0; i < n; i++) {
    const picks = weak.filter(w => !usedWords.has(w.id)).slice(0, 3)
    const use = picks.length ? picks : weak.slice(0, 3)
    const pairs = use.map(w => ({ word: w.w, meaning: w.m }))
    const excludeSids = questions.map(q => q.sid)

    let s = null
    try {
      const d = await aiContent.generateDrill(pairs)
      if (d && d.en) {
        s = {
          sid: 'ai-drill-' + Date.now() + '-' + i,
          en: d.en, zh: d.zh, lv: d.level || 1, note: d.note || '',
          newWords: use.map(w => w.w), source: 'ai'
        }
      }
    } catch (e) { s = null }

    if (!s || !s.en) {
      const req = {
        bookId: bid,
        level: 1,
        scene: '薄弱点专练',
        newWords: pairs,
        knownWords: mastered,
        constraints: { sentenceLength: '8-30 个英文单词', style: '简单日常，CEFR A2-B1' },
        excludeSids
      }
      s = await api.generateSentence(req)
    }

    use.forEach(w => usedWords.add(w.id))

    if (!s || !s.en) {
      const q = fallbackQuestion(bid, excludeSids)
      questions.push(q)
      continue
    }
    questions.push(makeQuestion(s, bid, Math.random() < 0.5 ? 'e2c' : 'c2e'))
  }
  return questions
}
