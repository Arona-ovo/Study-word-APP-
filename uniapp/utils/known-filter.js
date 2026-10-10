// utils/known-filter.js - 熟词过滤：词汇量估算 + 批量标记已掌握
//
// 原理（对标扇贝的「熟词过滤」）：
//   内置词书在生成时就按「综合词频 + 考试命中率」排好序 —— 前面的简单、后面的难。
//   把词书切成 SEGMENT_COUNT 段，二分探测：每段随机抽几个词问用户认不认识，
//   认识占比达标 → 往更难的段找，不达标 → 往更简单的段找。
//   走完二分就知道用户「大致认识到第几段」，把之前的词整体标成已掌握，
//   练习出题（i+1 选新词）、刷单词（needScore 排队）、批次解锁（70% 掌握）都会自动跳过它们。
//
// 三条设计约束：
//   1) 测试过程零写入：createTest() 是纯逻辑，只有 apply() 才动存储；
//   2) 应用可撤销：apply() 前把每个词的旧掌握度记录备份进 filterRun，undo() 原样还原；
//   3) 不污染「今日新词」统计：批量标记时不把 fs 写成今天
//      （wordbook.setMastery 对新记录会补 fs=今天，几百个词会让每日目标的
//       "今天新词"瞬间爆表 —— 所以这里绕开 setMastery，直接写 books[bid].mastery，
//       没学过的词 fs 补成昨天）。
//
// 口径：只估算「内置词」（wordIdsOfBook，词频序）。导入词 / 自建词书不参与 ——
//   那些是用户自己挑的"要学的词"，先验上就不该被跳过。
import * as wordbook from './wordbook.js'
import * as store from './store.js'
import { wordIdsOfBook } from '../data/wordbooks.js'
import { allById } from '../data/lexicon.js'

export const SEGMENT_COUNT = 12      // 词书切段数（专升本 3893 词 → 每段约 324 词）
export const SAMPLE_PER_SEGMENT = 5  // 每段抽问的词数
export const PASS_RATIO = 0.6        // 认识占比 ≥ 60% 视为「这段基本认识」

const KNOWN_M = 5   // 标记的掌握度：满级（MASTERED_M=4 即算已掌握，取 5 留出衰减余量）

// ---------- 日期（避免引入 engine.js 的一串依赖，这里只要两个字符串） ----------
function fmtDate(d) {
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
function todayStr() { return fmtDate(new Date()) }
function yesterdayStr() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return fmtDate(d)
}

// ---------- 测试基准：当前词书的内置词（词书原序 = 从易到难） ----------
// 与 wordbook.bookWords() 的口径差别：不掺导入词、不掺自建词书；
// 「删除」过的内置词（removedBookWords 黑名单）同样不测 —— 测了也会被明细页过滤，口径要对齐。
export function basis(bookId) {
  const bid = bookId || wordbook.currentBookId()
  const st = store.get()
  const rm = {}
  ;((st.removedBookWords || {})[bid] || []).forEach(id => { rm[id] = true })
  return wordIdsOfBook(bid)
    .map(id => allById()[id])
    .filter(w => w && !rm[w.id])
}

// 段边界：把 basis 均摊切成 SEGMENT_COUNT 段（每段词数至多差 1）
function segmentBounds(n) {
  const total = Math.max(1, SEGMENT_COUNT)
  const base = Math.floor(n / total)
  const extra = n % total
  const bounds = []
  let pos = 0
  for (let i = 0; i < total; i++) {
    const size = base + (i < extra ? 1 : 0)
    bounds.push([pos, pos + size])
    pos += size
  }
  return bounds
}

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  return a
}

// ---------- 测试控制器（纯逻辑，不写存储） ----------
//
// 用法：
//   const test = createTest(bid)
//   while (test.current()) { 显示 test.current().word; test.answer(用户认不认识) }
//   const r = test.result()   // r.ok=false 表示词书太小学不出有效估算
export function createTest(bookId) {
  const bid = bookId || wordbook.currentBookId()
  const list = basis(bid)
  const bounds = segmentBounds(list.length)
  // 每段可用样本不足 3 个（书太小 / 段太碎）→ 估算没有意义
  const usable = bounds.every(b => (b[1] - b[0]) >= 3)

  const history = []   // [{ seg, known, total }]
  let lo = 0
  let hi = SEGMENT_COUNT - 1
  let queue = []       // 当前段待问的词（{entry, segIndex}）
  let curSeg = -1
  let segTotal = 0     // 本段抽到的总题数（不随作答缩小）
  let asked = 0

  function sampleSegment(seg) {
    const s = bounds[seg][0]
    const e = bounds[seg][1]
    const pool = []
    for (let i = s; i < e; i++) pool.push({ entry: list[i], segIndex: seg })
    return shuffle(pool).slice(0, SAMPLE_PER_SEGMENT)
  }

  // 二分推进：进入下一段（或结束）
  function advance() {
    queue = []
    curSeg = -1
    segTotal = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      // 该段已测过（二分区间收敛到重复段）→ 区间作废，结束
      if (history.some(h => h.seg === mid)) { lo = hi + 1; break }
      curSeg = mid
      queue = sampleSegment(mid)
      segTotal = queue.length
      if (queue.length) return
      // 段里抽不出词（理论上不会）→ 当作未通过，往简单方向找
      history.push({ seg: mid, known: 0, total: 0 })
      hi = mid - 1
    }
  }
  advance()

  return {
    bookId: bid,
    usable,
    total: list.length,

    /** 当前要问的词；null = 测试结束（或不可用） */
    current() {
      if (!usable) return null
      if (!queue.length) return null
      const it = queue[0]
      return {
        word: it.entry.w,
        pos: it.entry.pos || '',
        meaning: it.entry.m || '',
        lv: it.entry.lv || 1,
        id: it.entry.id,
        segIndex: it.segIndex,
        segTotal: segTotal,
        segNo: segTotal - queue.length + 1   // 本段第几题（1 起）
      }
    },

    /** 回答（true=认识）。本段样本答完 → 记账并二分收敛 */
    answer(known) {
      if (!queue.length) return
      queue.shift()
      asked++
      const rec = history.length && history[history.length - 1].seg === curSeg
        ? history[history.length - 1]
        : (history.push({ seg: curSeg, known: 0, total: 0 }), history[history.length - 1])
      rec.total++
      if (known) rec.known++
      if (queue.length) return
      // 本段答完：判定 + 收敛
      const ratio = rec.total ? rec.known / rec.total : 0
      if (ratio >= PASS_RATIO) lo = curSeg + 1
      else hi = curSeg - 1
      advance()
    },

    /** 进度信息（页面进度条用） */
    progress() {
      return { asked, segments: history.length, done: !queue.length, usable }
    },

    /**
     * 估算结果。
     * lastPassed = 认识占比达标的最高段（单调假设：比它简单的段大概率也认识）
     * markIds    = 段 0..lastPassed 的全部词 id（应用时要标已掌握的）
     * estimate   = 估算认识词数（测过的段按实际比例加权，没测过的通过段按全认识）
     */
    result() {
      const reports = history.map(h => ({
        seg: h.seg,
        known: h.known,
        total: h.total,
        ratio: h.total ? h.known / h.total : 0,
        passed: h.total ? (h.known / h.total) >= PASS_RATIO : false
      }))
      const bySeg = {}
      reports.forEach(r => { bySeg[r.seg] = r })
      let lastPassed = -1
      reports.forEach(r => { if (r.passed && r.seg > lastPassed) lastPassed = r.seg })

      const markIds = []
      let estimate = 0
      for (let s = 0; s <= lastPassed; s++) {
        const size = bounds[s][1] - bounds[s][0]
        const r = bySeg[s]
        estimate += r ? Math.round(r.ratio * size) : size
        for (let i = bounds[s][0]; i < bounds[s][1]; i++) markIds.push(list[i].id)
      }
      return {
        ok: usable && history.length > 0,
        total: list.length,
        lastPassed,
        passedSegs: lastPassed + 1,
        estimate,
        markCount: markIds.length,
        markIds,
        reports
      }
    }
  }
}

// ---------- 应用 / 撤销（唯一写存储的入口） ----------
//
// 应用：把 markIds 全部标为 m=5。已有学习记录的词保留 seen/correct（统计不造假），
// fs 只在缺失时补「昨天」—— 绝不写今天，理由见文件头。
// 备份：filterRun = { at, ids, backup: {id: 旧记录或null} }，undo 据此精确还原。
export function apply(bookId, result) {
  const bid = bookId || wordbook.currentBookId()
  const ids = (result && result.markIds) || []
  if (!ids.length) return { marked: 0 }

  const st = wordbook.ensureShape()
  const book = st.books[bid] || (st.books[bid] = { mastery: {} })
  const m = book.mastery
  const backup = {}
  const ys = yesterdayStr()

  ids.forEach(id => {
    backup[id] = m[id] || null
    const prev = m[id] || { m: 0, seen: 0, correct: 0 }
    const rec = {
      m: KNOWN_M,
      seen: prev.seen || 0,
      correct: prev.correct || 0,
      kf: true   // known-filter 标记：词汇明细可显示「来自熟词过滤」
    }
    // fs 语义 = 「首次接触日」。被过滤标记 = 今天之前就认识，所以一律不写今天：
    //   · 没学过 → 补昨天；· 学过且 fs 不是今天 → 保留；· 恰好今天首见 → 也改写成昨天
    //     （否则几百个标记词会让「每日新词」瞬间爆表，目标直接虚假完成）
    rec.fs = (prev.fs && prev.fs !== todayStr()) ? prev.fs : ys
    m[id] = rec
  })

  book.filterRun = {
    at: Date.now(),
    ids: ids.slice(),
    backup,
    estimate: result.estimate || 0,
    marked: ids.length
  }
  store.save(st)
  store.flush()
  return { marked: ids.length }
}

/** 上次过滤的摘要（页面 / 词库入口卡片显示用）；没跑过返回 null */
export function lastRun(bookId) {
  const bid = bookId || wordbook.currentBookId()
  const st = store.get()
  const fr = ((st.books || {})[bid] || {}).filterRun
  if (!fr || !fr.ids || !fr.ids.length) return null
  return { at: fr.at || 0, marked: fr.marked || fr.ids.length, estimate: fr.estimate || 0 }
}

/** 撤销：按备份还原所有词的掌握度，清掉 filterRun。返回还原的词数 */
export function undo(bookId) {
  const bid = bookId || wordbook.currentBookId()
  const st = store.get()
  const book = (st.books || {})[bid]
  const fr = book && book.filterRun
  if (!fr || !fr.ids || !fr.ids.length) return 0
  let n = 0
  fr.ids.forEach(id => {
    const prev = fr.backup ? fr.backup[id] : null
    if (prev) book.mastery[id] = prev
    else if (book.mastery) delete book.mastery[id]
    n++
  })
  delete book.filterRun
  store.save(st)
  store.flush()
  return n
}
