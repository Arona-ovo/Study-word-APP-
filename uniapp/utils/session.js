// utils/session.js - 出题会话：把 i+1 生成链路接进练习流程
// 流程：buildRequest(选 1-3 个新词 + 熟词池) → generateSentence(AI/缓存/语料) → 组装题目(干扰项/方向/考点词)
import * as iplus1 from './iplus1.js'
import * as wordbook from './wordbook.js'
import * as api from './sentence-api.js'
import * as aiContent from '../services/ai-content.js'
import * as sentenceIndex from './sentence-index.js'
import { SENTENCES } from '../data/sentences.js'
import { allByText, allById } from '../data/lexicon.js'
import { wordIdsOfBook } from '../data/wordbooks.js'

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  return a
}

// 出题并发度：一批同时生成几道题。
// 串行时 10 题 = 10 次串行往返（配了 AI 且缓存未命中约 15-30s），是练习页最大的等待来源。
// 取 3 而不是全并发，两个原因：
//   ① 去重集合（used / usedWords）只能在批与批之间更新，全并发会让一批题目选中同样的新词
//   ② 一次打十几路请求容易撞服务商限流，3 路对任何一家 OpenAI 兼容服务都安全
const CONCURRENCY = 3

// 取消判定：调用方传一个"该停了吗"的回调，出题在批次边界检查它。
// 用显式回调而不是抛异常 —— 抛异常会把已经生成好的题目一起丢掉，
// 而且调用方（页面）在 await 前后还要各判一次，抛出去的时机很难对齐。
// 返回 true 表示立即停止，已攒到的题目照常返回（可能是不完整的一组，由调用方决定用不用）。
function stopped(shouldStop) {
  try {
    return typeof shouldStop === 'function' && shouldStop() === true
  } catch (e) {
    return false
  }
}

// 把 req 里的目标词记进排除集合：批内每造一个请求就要立刻记账，
// 否则同批的下一个请求会选中同一批词（pickNewWords 是按掌握度确定性排序的，不带随机）
// 同 wordsFor：导入词优先。两边解析口径必须一致，否则记进 taken 的是内置词 id、
// pickNewWords 排除的却是导入词 id，同一批里会重复选中同一个词。
function takeWords(req, taken, bid) {
  let customMap = null
  ;(req.newWords || []).forEach(w => {
    const key = String(w && w.word ? w.word : w).toLowerCase()
    const core = allByText()[key]
    if (core && !customMap) {
      customMap = {}
      wordbook.bookWords(bid).forEach(x => {
        if (x.custom) customMap[String(x.w).toLowerCase()] = x
      })
    }
    const own = customMap && customMap[key]
    const id = own ? own.id : (core ? core.id : null)
    if (id) taken.add(id)
  })
}

// 新词数量随水平提升：1 → 2 → 3
// 阈值按「当前词书的词量」比例算 —— 以前用 WORDS.length（写死 640），
// 换到 2600 词的专升本词书后，30% 的门槛高到一辈子跨不过去，永远停在每句 1 个新词。
function newCountFor(bookId) {
  const m = wordbook.masteryMap(bookId)
  let mastered = 0
  Object.keys(m).forEach(k => { if (m[k].m >= 4) mastered++ })
  const t = wordIdsOfBook(bookId).length || 640
  if (mastered >= t * 0.3) return 3
  if (mastered >= t * 0.1) return 2
  return 1
}

// 把句子里的目标词（可能是内置词，也可能是该书导入词）解析成统一词对象。
// 顺序必须是「该书导入词 → 全局词表」而不是反过来：共享词表里有 invoice / ledger 这类商务词，
// 先查全局表会把用户自己导入的那条吞掉 —— 目标词 id 变成内置词 id，
// 写掌握度时记到了一个不在该书词列表里的 id 上，用户在词汇明细里就看不到任何练习记录。
function wordsFor(sentence, bookId) {
  const texts = sentence.newWords || []
  if (!texts.length) return []
  let customMap = null
  const out = []
  texts.forEach(t => {
    const key = String(t).toLowerCase()
    if (!customMap) {
      customMap = {}
      wordbook.bookWords(bookId).forEach(w => {
        if (w.custom) customMap[String(w.w).toLowerCase()] = w
      })
    }
    if (customMap[key]) { out.push(customMap[key]); return }
    const core = allByText()[key]
    if (core) out.push(core)
  })
  return out
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
  const words = wordsFor(sentence, bookId)
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
  const names = (s.w || []).map(id => allById()[id]).filter(Boolean).map(w => w.w)
  return makeQuestion(
    { sid: 'corpus-' + s.id, en: s.en, zh: s.zh, lv: s.lv, note: s.note, newWords: names, source: 'corpus' },
    bookId,
    Math.random() < 0.5 ? 'e2c' : 'c2e'
  )
}

// 纯导入词词书出题：直接用该书的词 + 其已生成的例句；缺例句则走统一生成链路
async function buildCustomSession(n, bid, shouldStop) {
  const pool = wordbook.bookWords(bid).filter(w => w.custom)
  if (!pool.length) return []
  const m = wordbook.masteryMap(bid)
  // 未掌握优先，让新导入的词先练到
  const ordered = pool.slice().sort((a, b) => (((m[a.id] || {}).m || 0) - ((m[b.id] || {}).m || 0)))
  const known = iplus1.knownPool(bid, 100)
  const questions = []
  const used = new Set()
  // 分批并发：批内 CONCURRENCY 道题同时生成，批间串行更新去重集合
  for (let start = 0; start < n; start += CONCURRENCY) {
    if (stopped(shouldStop)) return questions
    const size = Math.min(CONCURRENCY, n - start)
    const jobs = []
    for (let k = 0; k < size; k++) {
      const w = ordered[(start + k) % ordered.length]
      // 导入词自带例句 → 本地直出，不发请求
      if (w.exampleEn && w.exampleZh) {
        jobs.push(Promise.resolve({
          sid: 'cw-' + w.id,
          en: w.exampleEn,
          zh: w.exampleZh,
          lv: w.lv || 1,
          note: '',
          newWords: [w.w],
          source: 'custom'
        }))
        continue
      }
      jobs.push(api.generateSentence({
        bookId: bid,
        level: 'custom',
        scene: SCENES_FOR_CUSTOM[(Math.random() * SCENES_FOR_CUSTOM.length) | 0],
        newWords: [{ word: w.w, pos: w.pos, meaning: w.m }],
        knownWords: known,
        constraints: { newWordCount: 1, maxNewWords: 3, sentenceLength: [8, 30], style: ['idiomatic', 'daily'], forbid: ['translation tone'] },
        excludeSids: Array.from(used)
      }).catch(() => null))
    }
    const sentences = await Promise.all(jobs)
    // 批内撞车（并发时彼此看不到对方的 sid）的题先记下来，批后串行重生成一次
    const retry = []
    sentences.forEach((s, k) => {
      if (!s || !s.en) { retry.push(start + k); return }
      // 导入词自带例句（sid 以 cw- 开头）：一个词只有这一句，题量大于词数时必然复用。
      // 这里允许复用 —— 重复一道"针对目标词"的题，好过塞一句和本词无关的语料句。
      if (String(s.sid).indexOf('cw-') === 0) {
        used.add(s.sid)
        questions.push(makeQuestion(s, bid, Math.random() < 0.5 ? 'e2c' : 'c2e'))
        return
      }
      if (used.has(s.sid)) { retry.push(start + k); return }
      used.add(s.sid)
      questions.push(makeQuestion(s, bid, Math.random() < 0.5 ? 'e2c' : 'c2e'))
    })
    for (const i of retry) {
      if (stopped(shouldStop)) return questions
      const w = ordered[i % ordered.length]
      let s = null
      if (w.exampleEn && w.exampleZh) {
        // 导入词自带例句：同一个词只能出这一句，撞了就没有第二句 → 只能兜底
        s = {
          sid: 'cw-' + w.id, en: w.exampleEn, zh: w.exampleZh, lv: w.lv || 1,
          note: '', newWords: [w.w], source: 'custom'
        }
      } else {
        s = await api.generateSentence({
          bookId: bid,
          level: 'custom',
          scene: SCENES_FOR_CUSTOM[(Math.random() * SCENES_FOR_CUSTOM.length) | 0],
          newWords: [{ word: w.w, pos: w.pos, meaning: w.m }],
          knownWords: known,
          constraints: { newWordCount: 1, maxNewWords: 3, sentenceLength: [8, 30], style: ['idiomatic', 'daily'], forbid: ['translation tone'] },
          excludeSids: Array.from(used)
        }).catch(() => null)
      }
      // 重生成仍撞车 / 失败 → 兜底句补足，保证题量恒定
      if (!s || !s.en || used.has(s.sid)) {
        const q = fallbackQuestion(bid, Array.from(used))
        used.add(q.sid)
        questions.push(q)
        continue
      }
      used.add(s.sid)
      questions.push(makeQuestion(s, bid, Math.random() < 0.5 ? 'e2c' : 'c2e'))
    }
  }
  return questions
}

const SCENES_FOR_CUSTOM = ['日常场景', '校园生活', '兼职与工作', '出行交通', '购物消费', '健康与运动']

// 主入口：异步生成一组题目
export async function buildSession(n = 10, bookId, shouldStop) {
  const bid = bookId || wordbook.currentBookId()
  // 纯导入词词书（自建词书 / 我的导入词书）没有批次语料，走导入词出题
  if (wordbook.bookMode(bid) === 'custom') return buildCustomSession(n, bid, shouldStop)
  const questions = []
  const used = new Set()
  // 同一组内避免一直围着同一个新词出题：每题轮换目标词
  const usedWords = new Set()
  for (let start = 0; start < n; start += CONCURRENCY) {
    // 页面已经退出：不再发起下一批（剩下的 AI 请求全省掉，也省 token）
    if (stopped(shouldStop)) return questions
    const size = Math.min(CONCURRENCY, n - start)
    // 批内同步构造请求，逐个把目标词记进 taken —— 同批的下一个请求据此避开已选走的词
    const taken = new Set(usedWords)
    const reqs = []
    for (let k = 0; k < size; k++) {
      const req = iplus1.buildRequest(bid, {
        newCount: newCountFor(bid),
        excludeSids: Array.from(used),
        excludeWordIds: Array.from(taken)
      })
      takeWords(req, taken, bid)
      reqs.push(req)
    }
    const sentences = await Promise.all(reqs.map(r => api.generateSentence(r).catch(() => null)))
    const retry = []
    sentences.forEach((s, k) => {
      // 批内可能撞到同一句（并发时彼此看不到对方的 sid）：先记下来，批后重新选词生成
      if (!s || !s.en || used.has(s.sid)) { retry.push(1); return }
      used.add(s.sid)
      const q = makeQuestion(s, bid, Math.random() < 0.5 ? 'e2c' : 'c2e')
      ;(q.wordIds || []).forEach(id => usedWords.add(id))
      questions.push(q)
    })
    // 串行补：此时 used / usedWords 已含本批成功项，重新选词能拿到新的目标词与新句子
    for (let k = 0; k < retry.length; k++) {
      if (stopped(shouldStop)) return questions
      const req = iplus1.buildRequest(bid, {
        newCount: newCountFor(bid),
        excludeSids: Array.from(used),
        excludeWordIds: Array.from(usedWords)
      })
      const s = await api.generateSentence(req).catch(() => null)
      if (!s || !s.en || used.has(s.sid)) {
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
  }
  return questions
}

// 错题重练（复用旧错题本，题目结构保持一致）
export async function reviewSession() {
  const engine = await import('./engine.js')
  return engine.reviewQuestions()
}

// AI 薄弱点专练：围绕用户当前词书里「掌握度偏低」的词生成练习
// 优先走 ai-content.generateDrill（更贴合目标词），失败则回落到通用 i+1 生成链路。
export async function buildDrillSession(n = 10, bookId, shouldStop) {
  const bid = bookId || wordbook.currentBookId()
  const all = wordbook.bookWords(bid)
  const m = wordbook.masteryMap(bid)

  // 薄弱词：m<3，越少越优先；不足则用全部词兜底
  let weak = all
    .map(w => ({ w, m: (m[w.id] || {}).m || 0 }))
    .filter(x => x.m < 3)
    .sort((a, b) => a.m - b.m)
    .map(x => x.w)
  if (!weak.length) weak = all.slice()
  if (!weak.length) return []

  // 熟词池（用于让生成句主干可理解）
  const mastered = all
    .filter(w => (m[w.id] || {}).m >= 4)
    .map(w => w.w)

  const questions = []
  const usedWords = new Set()
  for (let start = 0; start < n; start += CONCURRENCY) {
    if (stopped(shouldStop)) return questions
    const size = Math.min(CONCURRENCY, n - start)
    const taken = new Set(usedWords)
    const excludeSids = questions.map(q => q.sid)
    const jobs = []
    for (let k = 0; k < size; k++) {
      // 批内逐个占词：picks 用的是 taken（含本批已占走的），保证同批目标词不重
      const picks = weak.filter(w => !taken.has(w.id)).slice(0, 3)
      const use = picks.length ? picks : weak.slice(0, 3)
      use.forEach(w => taken.add(w.id))
      jobs.push(drillOne(use.map(w => ({ word: w.w, meaning: w.m })), bid, mastered, excludeSids))
    }
    const sentences = await Promise.all(jobs)
    sentences.forEach(s => {
      if (!s || !s.en) {
        questions.push(fallbackQuestion(bid, excludeSids))
        return
      }
      questions.push(makeQuestion(s, bid, Math.random() < 0.5 ? 'e2c' : 'c2e'))
    })
    // 本批占走的词并入全局，下一批不再选
    taken.forEach(id => usedWords.add(id))
  }
  return questions
}

// 单道薄弱点专练：优先 generateDrill（更贴合目标词），失败回落通用 i+1 生成链路
async function drillOne(pairs, bid, mastered, excludeSids) {
  try {
    const d = await aiContent.generateDrill(pairs)
    if (d && d.en) {
      return {
        sid: 'ai-drill-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        en: d.en, zh: d.zh, lv: d.level || 1, note: d.note || '',
        newWords: pairs.map(p => p.word), source: 'ai'
      }
    }
  } catch (e) { /* 落到下面的通用链路 */ }

  try {
    return await api.generateSentence({
      bookId: bid,
      level: 1,
      scene: '薄弱点专练',
      newWords: pairs,
      knownWords: mastered,
      constraints: { sentenceLength: '8-30 个英文单词', style: '简单日常，CEFR A2-B1' },
      excludeSids
    })
  } catch (e) {
    return null
  }
}
