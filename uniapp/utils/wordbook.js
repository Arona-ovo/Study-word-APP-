// utils/wordbook.js - 词书管理：切换词书、按批掌握度、批次解锁（i+1 的判定依据）
import * as store from './store.js'
import { WORDBOOKS, getBook, wordIdsOfBook, setUserBookProvider } from '../data/wordbooks.js'
import { allById } from '../data/lexicon.js'
import { streak, dateStr } from './engine.js'

const DEFAULT_BOOK = 'fj_zsb_core'

// ---------- 存储结构（appended in store） ----------
// state.books = { [bookId]: { mastery: { wordId: {m, seen, correct} } } }
// state.customWords = { [bookId]: [{ id, word, pos, meaning, exampleEn, exampleZh }] }
// state.userBooks  = [{ id, name, desc, createdAt }]   自建词书（AI 生成 / 手动新建）
// state.currentBook = 'fj_zsb_core'
// 兼容旧的扁平 state.mastery：首次读取时迁入默认词书
export function ensureShape() {
  const st = store.get()
  // 原来这里无条件 store.save()：它会被每个读路径（含 homeOverview）调到，
  // 于是修订号每次都 +1，派生缓存永远命中不了。改成"真的补了字段才写"。
  let changed = false
  if (!st.books) { st.books = {}; changed = true }
  if (!st.userBooks) { st.userBooks = []; changed = true }
  if (!st.currentBook) { st.currentBook = DEFAULT_BOOK; changed = true }
  if (st.mastery && Object.keys(st.mastery).length && !st.books[DEFAULT_BOOK]) {
    st.books[DEFAULT_BOOK] = { mastery: st.mastery }
    changed = true
  }
  if (!st.books[st.currentBook]) { st.books[st.currentBook] = { mastery: {} }; changed = true }
  if (changed) store.save(st)
  return st
}

// ---------- 自建词书 ----------
// 统一书对象形态（与 WORDBOOKS 元素同构：batches 为空数组）
function userBookObject(b) {
  return {
    id: b.id,
    name: b.name,
    desc: b.desc || '自建词书',
    level: 'custom',
    userBook: true,
    batches: []
  }
}

export function listUserBooks() {
  const st = ensureShape()
  return (st.userBooks || []).map(userBookObject)
}

export function isUserBook(bookId) {
  const st = ensureShape()
  return (st.userBooks || []).some(b => b.id === bookId)
}

// 词书名唯一性：与内置词书 + 所有自建词书比对（忽略首尾空格与大小写）。
// exceptId 用于重命名时排除自身。
export function isNameTaken(name, exceptId) {
  const n = String(name || '').trim().toLowerCase()
  if (!n) return false
  try {
    return listBooks().some(b =>
      String(b.name || '').trim().toLowerCase() === n && b.id !== exceptId)
  } catch (e) {
    return false
  }
}

export function createUserBook(name, desc) {
  const st = ensureShape()
  const finalName = (String(name || '').trim() || '我的词书').slice(0, 24)
  if (isNameTaken(finalName)) {
    throw new Error('词书名「' + finalName + '」已存在，换一个名字')
  }
  const id = 'ub-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36)
  st.userBooks.push({
    id,
    name: finalName,
    desc: String(desc || '').slice(0, 60) || '自建词书',
    createdAt: Date.now()
  })
  if (!st.books[id]) st.books[id] = { mastery: {} }
  store.save(st)
  return id
}

export function renameUserBook(bookId, name) {
  const st = ensureShape()
  const b = (st.userBooks || []).find(x => x.id === bookId)
  if (!b) return false
  const finalName = (String(name || '').trim() || b.name).slice(0, 24)
  if (isNameTaken(finalName, bookId)) {
    throw new Error('词书名「' + finalName + '」已存在，换一个名字')
  }
  b.name = finalName
  store.save(st)
  return true
}

// 删除自建词书：连同该书掌握度、导入词一并清除；若正被选中则退回默认词书
export function deleteUserBook(bookId) {
  const st = ensureShape()
  if (!(st.userBooks || []).some(b => b.id === bookId)) return false
  st.userBooks = st.userBooks.filter(b => b.id !== bookId)
  if (st.books) delete st.books[bookId]
  if (st.customWords) delete st.customWords[bookId]
  if (st.removedBookWords) delete st.removedBookWords[bookId]
  if (st.currentBook === bookId) st.currentBook = DEFAULT_BOOK
  store.save(st)
  return true
}

// 把自建词书读取能力注入 data 层，使 getBook() 也能解析自建 id
setUserBookProvider(listUserBooks)

export function listBooks() {
  const st = ensureShape()
  const builtin = WORDBOOKS.map(b => ({
    id: b.id,
    name: b.name,
    desc: b.desc,
    group: b.group || '',
    note: b.note || '',
    current: b.id === st.currentBook,
    batchCount: b.batches.length,
    wordCount: b.batches.reduce((a, x) => a + x.wordIds.length, 0),
    userBook: false
  }))
  const user = (st.userBooks || []).map(b => ({
    id: b.id,
    name: b.name,
    desc: b.desc,
    group: '我的',
    note: '',
    current: b.id === st.currentBook,
    batchCount: 0,
    wordCount: 0,
    userBook: true
  }))
  return builtin.concat(user)
}

export function currentBookId() {
  return ensureShape().currentBook
}

export function switchBook(bookId) {
  const st = ensureShape()
  const known = WORDBOOKS.some(b => b.id === bookId) || (st.userBooks || []).some(b => b.id === bookId)
  if (!known) return false
  st.currentBook = bookId
  if (!st.books[bookId]) st.books[bookId] = { mastery: {} }
  store.save(st)
  return true
}

// 词书类型：'batch' = 有内置批次词（走 i+1 批次链路）；'custom' = 纯导入词词书
export function bookMode(bookId) {
  return wordIdsOfBook(bookId || currentBookId()).length ? 'batch' : 'custom'
}

export function masteryMap(bookId) {
  const st = ensureShape()
  return (st.books[bookId || st.currentBook] || {}).mastery || {}
}

export function setMastery(bookId, wordId, patch) {
  const st = ensureShape()
  const book = st.books[bookId] || (st.books[bookId] = { mastery: {} })
  const rec = book.mastery[wordId] || { m: 0, seen: 0, correct: 0 }
  // fs = first seen：首次接触日期，只写一次，供「每日新词目标」统计当日新词数
  if (!rec.fs) rec.fs = dateStr()
  Object.assign(rec, patch)
  book.mastery[wordId] = rec
  store.save(st)
  return rec
}

// ---------- 每日目标（按词书维度，切书互不干扰） ----------
// newWords：每天要"新认识"多少个词（当天首次接触即算一个）
// practice：每天要"通过"多少道练习（答对即通过）
export const GOAL = {
  newWords: { min: 5, max: 300, def: 20, step: 5 },
  practice: { min: 5, max: 300, def: 10, step: 5 }
}

function clampGoal(v, cfg) {
  const n = Math.floor(Number(v))
  if (!isFinite(n)) return cfg.def
  return Math.max(cfg.min, Math.min(cfg.max, n))
}

export function getGoal(bookId) {
  const st = ensureShape()
  const bid = bookId || st.currentBook
  const g = ((st.books[bid] || {}).goal) || {}
  return {
    enabled: g.enabled !== false,
    newWords: clampGoal(g.newWords, GOAL.newWords),
    practice: clampGoal(g.practice, GOAL.practice)
  }
}

export function setGoal(bookId, patch) {
  const st = ensureShape()
  const bid = bookId || st.currentBook
  const book = st.books[bid] || (st.books[bid] = { mastery: {} })
  const cur = getGoal(bid)
  const p = patch || {}
  const next = {
    enabled: p.enabled === undefined ? cur.enabled : !!p.enabled,
    newWords: p.newWords === undefined ? cur.newWords : clampGoal(p.newWords, GOAL.newWords),
    practice: p.practice === undefined ? cur.practice : clampGoal(p.practice, GOAL.practice)
  }
  book.goal = next
  store.save(st)
  return next
}

/**
 * 今日完成度：新词（按当前词书口径）/ 练习（全局当天口径）。
 *
 * practice 数的是「学会了多少」，不是「答对多少」：一遍答对不算会 ——
 * 刷单词要连续确认达标、练习要确认过目标词，才由 engine.addMasteredToday 记一笔
 * （days[d].mastered）。改判「记错了」会 -1，所以目标不会被蒙对的题刷上去。
 */
export function goalProgress(bookId) {
  const st = ensureShape()
  const bid = bookId || st.currentBook
  const goal = getGoal(bid)
  const key = dateStr()
  const today = st.days[key] || { total: 0, correct: 0 }
  const learned = Number(today.mastered) || 0
  const m = masteryMap(bid)

  let fresh = 0
  bookWords(bid).forEach(w => {
    const r = m[w.id]
    if (r && r.fs === key) fresh++
  })

  const pctOf = (done, target) => (target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0)
  return {
    bookId: bid,
    enabled: goal.enabled,
    newWords: {
      done: fresh,
      target: goal.newWords,
      pct: pctOf(fresh, goal.newWords),
      reached: fresh >= goal.newWords
    },
    practice: {
      done: learned,
      target: goal.practice,
      pct: pctOf(learned, goal.practice),
      reached: learned >= goal.practice
    },
    today: today
  }
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
// 过滤掉 0 词的占位批次（如「我的导入词书」的占位批），避免出现 "0/0" 的空批次卡
export function getBookBatches(bookId) {
  const bid = bookId || currentBookId()
  const book = getBook(bid)
  return book.batches
    .map((b, i) => batchProgress(bid, i))
    .filter(x => x && x.total > 0)
}

// ---------- 首页总览缓存 ----------
// 首页聚合：词书进度（词书口径）+ 今日/连续/错题（全局 days/wrong 口径）
// homeOverview() 要遍历整本词（自建词书可能上千），而首页 onShow 每次切回来都调一次，
// 另外 widget-progress / library / profile / page-doc 也各调一次 —— 一天里能跑几十遍。
// 用「词书 + 今天 + 数据修订号 + 错题数」做键：变过才重算，没变直接复用上次结果。
// 修订号由 store.save() 递增，任何学习进度写入都会让它失效，不存在读到旧数据的可能。
let ovCache = { key: '', data: null }

function overviewKey(st) {
  return st.currentBook + '|' + dateStr() + '|' + store.revision() + '|' + st.wrong.length
}

/**
 * @param {boolean} [force] 传 true 强制重算（调试 / 校验脚本用）
 */
export function homeOverview(force) {
  const st = ensureShape()
  const key = overviewKey(st)
  if (!force && ovCache.data && ovCache.key === key) return ovCache.data
  const out = computeOverview(st)
  ovCache = { key: key, data: out }
  return out
}

function computeOverview(st) {
  const bid = st.currentBook
  const book = getBook(bid)
  const m = masteryMap(bid)
  const words = bookWords(bid)
  let touched = 0, mastered = 0
  words.forEach(w => {
    const r = m[w.id]
    if (!r) return
    touched++
    if (r.m >= MASTERED_M) mastered++
  })
  const today = st.days[dateStr()] || { total: 0, correct: 0 }

  // 有内置批次 → 主进度显示"当前批次"；纯导入词词书 → 整本即一批"全部词汇"
  const hasBatches = wordIdsOfBook(bid).length > 0
  const bi = hasBatches ? activeBatchIndex(bid) : 0
  const bp = hasBatches ? batchProgress(bid, bi) : null
  const batchName = bp ? bp.name : (words.length ? '全部词汇' : '')
  const batchTouched = bp ? bp.touched : touched
  const batchMastered = bp ? bp.mastered : mastered
  const batchTotal = bp ? bp.total : words.length
  const batchPct = batchTotal ? Math.round((batchTouched / batchTotal) * 100) : 0

  return {
    bookId: bid,
    bookName: book.name,
    bookDesc: book.desc,
    // 无内置批次的词书（自建词书 / 我的导入词书）：首页用"全部词汇"口径展示
    batchless: !hasBatches,
    touched,
    mastered,
    wordCount: words.length,
    bookPct: words.length ? Math.round((touched / words.length) * 100) : 0,
    batchIndex: bi,
    batchName: batchName,
    batchTouched: batchTouched,
    batchMastered: batchMastered,
    batchTotal: batchTotal,
    batchPct: batchPct,
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

// ---------- 词汇明细（严格按「当前词书」口径） ----------
// 组成 = 该词书导入词（state.customWords[bookId]）+ 内置词（批次 wordIds）
// 掌握度一律读 state.books[bookId].mastery，与首页/批次进度条同源。
// 因此：空词书（既无内置词、也无导入词）的明细必然为空；新建词书天然是空的。
// 查词走 data/lexicon.js 的全局索引：核心 640 词（id 1..640）与共享词条表（10001 起）都在里面。

// 词书内的词（统一形态 {id,w,pos,m,lv,custom}，供出题/选词/明细共用）
// 导入词排在前面，导入后能立刻看到；随后是词书内置词
export function bookWords(bookId) {
  const bid = bookId || currentBookId()
  const out = []
  const st0 = store.get()
  const custom = (st0.customWords || {})[bid] || []
  custom.forEach(c => {
    if (!c || !c.word) return
    out.push({
      id: c.id, w: c.word, pos: c.pos || '', m: c.meaning || '', lv: c.lv || 1,
      custom: true, exampleEn: c.exampleEn || '', exampleZh: c.exampleZh || ''
    })
  })
  // 内置词黑名单：词汇明细里「删除」的内置词不真删（语料固定），只是从这里过滤掉
  const rmSet = {}
  ;((st0.removedBookWords || {})[bid] || []).forEach(id => { rmSet[id] = true })
  wordIdsOfBook(bid).forEach(id => {
    if (rmSet[id]) return
    const w = allById()[id]
    if (w) out.push({ id: w.id, w: w.w, pos: w.pos, m: w.m, lv: w.lv, custom: false })
  })
  return out
}

// ---------- 删除词书里的词（词汇明细长按多选删除） ----------
//
// 两类词两种处理：
// - 自定义词（导入 / AI 生成）：从 customWords[bookId] 里真删
// - 内置词（640 词语料是数据，不是记录）：记入 removedBookWords[bookId] 黑名单，
//   bookWords() 统一过滤 —— 效果等同删除，且不必动语料数据
// 返回 { removed, hidden }：removed=真删的自定义词数，hidden=隐藏的内置词数
export function removeWordsFromBook(bookId, ids) {
  const bid = bookId || currentBookId()
  const want = {}
  ;(ids || []).forEach(id => { if (id) want[id] = true })
  const idList = Object.keys(want)
  if (!bid || !idList.length) return { removed: 0, hidden: 0 }
  const st = ensureShape()

  let removed = 0
  // 必须防御 st.customWords 不存在：ensureShape() 只补 books/userBooks/currentBook，
  // 一个从没导入过自建词的账号，customWords 是 undefined ——
  // 这里直接下标取值会抛 TypeError，被调用方的 try/catch 吞掉后表现成
  // "点了移出没反应 / 提示没改动"，而实际上内置词的删除路径本该走下面的黑名单。
  // bookWords() 用的是 (st.customWords || {})[bid]，两处口径要一致。
  const bucket = (st.customWords || {})[bid]
  if (Array.isArray(bucket)) {
    const kept = bucket.filter(c => !(c && c.id && want[c.id]))
    removed = bucket.length - kept.length
    if (removed) st.customWords[bid] = kept
  }

  // 没被当作自定义词删掉的，按内置词隐藏（只收确实属于这本书的 id，脏 id 直接忽略）
  let hidden = 0
  if (removed < idList.length) {
    const rm = st.removedBookWords || (st.removedBookWords = {})
    const list = rm[bid] || (rm[bid] = [])
    const have = {}
    list.forEach(x => { have[x] = true })
    wordIdsOfBook(bid).forEach(id => {
      if (want[id] && !have[id]) { list.push(id); hidden++ }
    })
  }

  if (removed || hidden) {
    store.save(st)
    store.flush()
  }
  return { removed, hidden }
}

// 恢复某本词书被隐藏的内置词（返回恢复条数；自定义词真删了，恢复不了）
export function restoreBookWords(bookId) {
  const st = ensureShape()
  if (!st.removedBookWords || !st.removedBookWords[bookId]) return 0
  const n = st.removedBookWords[bookId].length
  delete st.removedBookWords[bookId]
  store.save(st)
  return n
}

// 清理垃圾词条：把所有词书里 "[object Object]" 这类条目删掉（返回删除条数）
//
// 成因：搜索框在部分端拿到的不是字符串（键盘回车可能给事件对象 / { value }），
// 早先直接 String(v) 就变成 "[object Object]"，被当成待查词交给 AI，
// 生成结果又被写进词库 —— 于是词库里多出一个莫名其妙的词条。
// 判定只看「以 [object 开头」：正常单词不可能长这样（"object" 本身也不受影响），
// 所以不会误伤任何真实词条。每次启动跑一次，幂等且几乎零成本。
const JUNK_WORD = /^\s*\[object/i;

export function purgeJunkWords() {
  let removed = 0;
  try {
    const st = store.get();
    const books = st.customWords || {};
    let changed = false;
    Object.keys(books).forEach((bid) => {
      const list = books[bid];
      if (!Array.isArray(list)) return;
      const kept = list.filter((c) => !(c && JUNK_WORD.test(String(c.word == null ? '' : c.word))));
      if (kept.length !== list.length) {
        removed += list.length - kept.length;
        books[bid] = kept;
        changed = true;
      }
    });
    if (changed) store.save(st);
  } catch (e) {
    /* 读取失败就什么都不做，下次启动再试 */
  }
  return removed;
}

export function bookVocab(bookId, filter) {
  const bid = bookId || currentBookId()
  const m = masteryMap(bid)
  const all = bookWords(bid)
  const customTotal = all.filter(x => x.custom).length

  const counts = { new: 0, learning: 0, familiar: 0, mastered: 0 }
  const list = all.map(e => {
    const rec = m[e.id]
    const mv = rec ? rec.m : 0
    let status = 'new', statusName = '新词'
    if (rec) {
      if (mv >= MASTERED_M) { status = 'mastered'; statusName = '已掌握' }
      else if (mv === 3) { status = 'familiar'; statusName = '熟悉' }
      else { status = 'learning'; statusName = '学习中' }
    }
    counts[status]++
    return {
      id: e.id, w: e.w, pos: e.pos, m: e.m, lv: e.lv, custom: e.custom,
      mastery: mv, pct: (mv / 5) * 100,
      status, statusName,
      seen: rec ? rec.seen : 0,
      correct: rec ? rec.correct : 0
    }
  })
  return {
    bookId: bid,
    total: all.length,
    customTotal,
    counts,
    list: filter && filter !== 'all' ? list.filter(x => x.status === filter) : list
  }
}
