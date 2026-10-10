// utils/wordbook.js - 词书管理：切换词书、按批掌握度、批次解锁（i+1 的判定依据）
import * as store from './store.mjs'
import { WORDBOOKS, getBook } from '../data/wordbooks.mjs'
import { streak, dateStr } from './engine.mjs'

const DEFAULT_BOOK = 'fj_zsb_core'

// ---------- 存储结构（appended in store） ----------
// state.books = { [bookId]: { mastery: { wordId: {m, seen, correct} } } }
// state.currentBook = 'fj_zsb_core'
// 兼容旧的扁平 state.mastery：首次读取时迁入默认词书
export function ensureShape() {
  const st = store.get()
  if (!st.books) st.books = {}
  if (!st.currentBook) st.currentBook = DEFAULT_BOOK
  if (st.mastery && Object.keys(st.mastery).length && !st.books[DEFAULT_BOOK]) {
    st.books[DEFAULT_BOOK] = { mastery: st.mastery }
  }
  if (!st.books[st.currentBook]) st.books[st.currentBook] = { mastery: {} }
  store.save(st)
  return st
}

export function listBooks() {
  const st = ensureShape()
  return WORDBOOKS.map(b => ({
    id: b.id,
    name: b.name,
    desc: b.desc,
    current: b.id === st.currentBook,
    batchCount: b.batches.length,
    wordCount: b.batches.reduce((a, x) => a + x.wordIds.length, 0)
  }))
}

export function currentBookId() {
  return ensureShape().currentBook
}

export function switchBook(bookId) {
  const st = ensureShape()
  if (!WORDBOOKS.some(b => b.id === bookId)) return false
  st.currentBook = bookId
  if (!st.books[bookId]) st.books[bookId] = { mastery: {} }
  store.save(st)
  return true
}

export function masteryMap(bookId) {
  const st = ensureShape()
  return (st.books[bookId || st.currentBook] || {}).mastery || {}
}

export function setMastery(bookId, wordId, patch) {
  const st = ensureShape()
  const book = st.books[bookId] || (st.books[bookId] = { mastery: {} })
  const rec = book.mastery[wordId] || { m: 0, seen: 0, correct: 0 }
  Object.assign(rec, patch)
  book.mastery[wordId] = rec
  store.save(st)
  return rec
}

// ---------- 批次状态 ----------
const MASTERED_M = 4

export function batchProgress(bookId, batchIndex) {
  const book = getBook(bookId || currentBookId())
  const batch = book.batches[batchIndex]
  if (!batch) return null
  const m = masteryMap(bookId)
  let mastered = 0, touched = 0
  batch.wordIds.forEach(id => {
    const r = m[id]
    if (!r) return
    touched++
    if (r.m >= MASTERED_M) mastered++
  })
  return {
    batchId: batch.id,
    index: batch.index,
    name: batch.name,
    total: batch.wordIds.length,
    touched,
    mastered,
    ratio: batch.wordIds.length ? mastered / batch.wordIds.length : 0,
    // 上一批掌握 70% 才解锁下一批
    unlocked: batchIndex === 0
      ? true
      : (() => {
        const prev = book.batches[batchIndex - 1]
        if (!prev) return false
        let ok = 0
        prev.wordIds.forEach(id => { const r = m[id]; if (r && r.m >= MASTERED_M) ok++ })
        return prev.wordIds.length ? ok / prev.wordIds.length >= 0.7 : false
      })()
  }
}

// 词书下所有批次的状态（供词书页展示进度条）
export function getBookBatches(bookId) {
  const bid = bookId || currentBookId()
  const book = getBook(bid)
  return book.batches.map((b, i) => batchProgress(bid, i)).filter(Boolean)
}

// 首页聚合：词书进度（词书口径）+ 今日/连续/错题（全局 days/wrong 口径）
export function homeOverview() {
  const st = ensureShape()
  const bid = st.currentBook
  const book = getBook(bid)
  const ids = book.batches.reduce((a, b) => a.concat(b.wordIds), [])
  const m = masteryMap(bid)
  let touched = 0, mastered = 0
  ids.forEach(id => {
    const r = m[id]
    if (!r) return
    touched++
    if (r.m >= MASTERED_M) mastered++
  })
  const today = st.days[dateStr()] || { total: 0, correct: 0 }
  // 词库扩容后整本进度条几乎为 0（3/640），首页主进度改为展示"当前批次"进度
  const bi = activeBatchIndex(bid)
  const bp = batchProgress(bid, bi)
  return {
    bookId: bid,
    bookName: book.name,
    touched,
    mastered,
    wordCount: ids.length,
    bookPct: ids.length ? Math.round((touched / ids.length) * 100) : 0,
    batchIndex: bi,
    batchName: bp ? bp.name : '',
    batchTouched: bp ? bp.touched : 0,
    batchMastered: bp ? bp.mastered : 0,
    batchTotal: bp ? bp.total : 0,
    batchPct: bp && bp.total ? Math.round((bp.touched / bp.total) * 100) : 0,
    today,
    streak: streak(),
    wrongCount: st.wrong.length
  }
}

// 当前应学习的批次：第一个未解锁完成（掌握率未达 100%）的已解锁批次
export function activeBatchIndex(bookId) {
  const book = getBook(bookId || currentBookId())
  for (let i = 0; i < book.batches.length; i++) {
    const p = batchProgress(bookId, i)
    if (p && p.unlocked && p.ratio < 1) return i
  }
  return Math.max(0, book.batches.length - 1)
}
