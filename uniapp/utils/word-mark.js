// utils/word-mark.js - 句子里「哪些词是词书里的」标注
//
// 翻译练习的句子来自语料 / AI，光看句子分不清：
//   · 哪个词是我词书里收着的（背过的，看见了应该想得起来）
//   · 哪个词是这一题要练的目标词（i+1 生词 / AI 专练指定的词）
// 这里给 tokenize() 的分词结果打两个布尔标记：
//   book   = 该词（或其还原形）在当前词书里
//   target = 该词还是本题的目标词
//
// 只做标记不做排版：样式由页面决定（练习页用「底色 = 目标词 / 蓝色 = 词库词」）。
import * as wordbook from './wordbook.js'
import { lemmaCandidates } from './lemma.js'

// 词书词汇集合（小写）。做题期间词书不变，页面算一次就够。
export function bookWordSet(bookId) {
  const set = {}
  try {
    wordbook.bookWords(bookId).forEach(w => {
      const k = String((w && w.w) || '').toLowerCase()
      if (k) set[k] = true
    })
  } catch (e) { /* 词书读不出来就不标，不影响做题 */ }
  return set
}

// 本题目标词集合：q.words = [{ w, pos, m }]
export function targetWordSet(words) {
  const set = {}
  ;(words || []).forEach(w => {
    const k = String((w && (w.w || w.word)) || '').toLowerCase()
    if (k) set[k] = true
  })
  return set
}

// 命中判定：原形先比；比不中再把屈折形式还原后比（improved → improve / studies → study）
export function inBook(token, set) {
  const raw = String(token || '').toLowerCase()
  if (!raw || !set) return false
  if (set[raw]) return true
  let cands = []
  try { cands = lemmaCandidates(raw) || [] } catch (e) { return false }
  for (let i = 0; i < cands.length; i++) {
    if (set[String(cands[i] || '').toLowerCase()]) return true
  }
  return false
}

// 给 tokenize() 的结果打标记（返回新数组，不动原数据）
export function markTokens(tokens, bookSet, targetSet) {
  return (tokens || []).map(tk => {
    const out = { t: tk.t, w: tk.w, book: false, target: false }
    if (!tk.w) return out
    const low = String(tk.t || '').toLowerCase()
    // 目标词一定是词书里的词：两个标记同时为真，页面按更强的样式画
    if (targetSet && targetSet[low]) {
      out.target = true
      out.book = true
    } else if (inBook(low, bookSet)) {
      out.book = true
    }
    return out
  })
}

// 一句话里有多少个词书词（给"本句含 N 个词库词"这类提示用）
export function countMarked(tokens) {
  let book = 0
  let target = 0
  ;(tokens || []).forEach(t => {
    if (t.book) book++
    if (t.target) target++
  })
  return { book, target }
}
