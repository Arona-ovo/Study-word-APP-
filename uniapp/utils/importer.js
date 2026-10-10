// utils/importer.js - 外部单词接入管道：解析 → 清洗 → 校验 → 去重 → 归书 → 生成例句
//
// 支持的输入形态：
// 1) JSON：[{word, pos, meaning}] 或 {words:[...]}
// 2) 竖线表：word|pos|meaning|例句|例句翻译（首行可为表头）—— 外部 AI 提示词默认格式，
//    例句里必然有逗号，所以不用 CSV；一行一个词，整段复制一次粘贴即可
// 3) CSV：word,pos,meaning（首行可为表头）
// 4) 逐行文本：word | pos | meaning、word\tmeaning、word 释义、word - 释义
// 5) 常见背单词 App 分享文本（含"单词 / 音标 / 释义"混排）
import { WORDS } from '../data/words.js'
import { WORDBOOKS, getBook } from '../data/wordbooks.js'
import * as store from './store.js'
import * as iplus1 from './iplus1.js'
import { generateBatch, } from './sentence-api.js'
import * as dict from './dict.js'

const WORD_RE = /^[a-zA-Z][a-zA-z'-]{1,19}$/

// ---------- 1. 解析 ----------
export function parseSharedText(text) {
  if (!text || !text.trim()) return []
  const raw = text.trim()
  let parsed = tryJSON(raw)
  if (parsed) return parsed
  // 竖线表要先于 CSV 判：例句里有逗号，落到 CSV 分支会被切碎
  parsed = tryPiped(raw)
  if (parsed && parsed.length) return parsed
  parsed = tryCSV(raw)
  if (parsed && parsed.length) return parsed
  return parseLines(raw)
}

// 外部 AI 提示词的标准输出：word|pos|meaning|例句|例句翻译
// 判定要严：只有"第一行（跳过表头后）确实是 单词|词性|释义"才走这条分支，
// 否则普通分享文本里偶尔出现的竖线会把整段误判成表格。
function tryPiped(raw) {
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  if (!lines.length) return null
  let start = 0
  if (/^word\s*\|/i.test(lines[0])) start = 1
  const first = (lines[start] || '').split('|')
  if (first.length < 3 || !WORD_RE.test(String(first[0] || '').trim())) return null

  const out = []
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split('|').map(s => s.trim())
    if (parts.length < 3) continue
    const item = normalizeItem({
      word: parts[0],
      pos: parts[1],
      meaning: parts[2],
      exampleEn: parts[3] || '',
      // 翻译列之后还有多余竖线就并回翻译里，不丢字
      exampleZh: parts.length > 5 ? parts.slice(4).join(' ') : (parts[4] || '')
    })
    if (item) out.push(item)
  }
  return out.length ? out : null
}

function tryJSON(raw) {
  if (!(raw.startsWith('[') || raw.startsWith('{'))) return null
  try {
    const obj = JSON.parse(raw)
    const arr = Array.isArray(obj) ? obj : (obj.words || obj.list || [])
    return arr.map(normalizeItem).filter(Boolean)
  } catch (e) { return null }
}

function tryCSV(raw) {
  if (!raw.includes(',')) return null
  const lines = raw.split(/\r?\n/)
  const isHeader = /word|单词/i.test(lines[0] || '')
  return lines.slice(isHeader ? 1 : 0)
    .map(line => {
      const parts = line.split(',').map(s => s.trim())
      // 三列（word,pos,meaning）时词性单独取第二列，释义从第三列起；
      // 两列（word,meaning）时没有词性，释义取第二列 —— 兼容两种常见导出格式
      const hasPos = parts.length >= 3
      return normalizeItem({
        word: parts[0],
        pos: hasPos ? parts[1] : '',
        meaning: hasPos ? parts.slice(2).join(' ') : parts.slice(1).join(' ')
      })
    })
    .filter(Boolean)
}

function parseLines(raw) {
  const out = []
  raw.split(/\r?\n/).forEach(line => {
    const t = line.trim()
    if (!t) return
    // 去掉行序号、音标、例句片段
    const clean = t.replace(/^\d+[.、)]\s*/, '').replace(/\/[^\/]{2,}\//g, ' ').trim()
    let m = clean.split(/\s*\|\s*|\s*-\s+|\t/)
    let word = (m[0] || '').trim()
    let meaning = (m.slice(1).join(' ') || '').trim()
    if (!meaning) {
      const mm = clean.match(/^([a-zA-Z][a-zA-Z'-]*)\s+(.+)$/)
      if (mm) { word = mm[1]; meaning = mm[2] }
    }
    const item = normalizeItem({ word, meaning })
    if (item) out.push(item)
  })
  return out
}

function normalizeItem(it) {
  if (!it || typeof it !== 'object') return null
  const word = String(it.word || it.w || it.term || '').trim()
  const meaning = String(it.meaning || it.m || it.def || it.translation || '').trim()
  const pos = String(it.pos || it.p || '').trim()
  if (!WORD_RE.test(word)) return null
  const item = { word: word.toLowerCase(), pos, meaning }
  // 例句：外部 AI 一次性给全（word|pos|meaning|en|zh），存下来就不用再逐个去问模型了
  // 只认 exampleEn/exampleZh/sentence 这几个键 —— 不用 en/zh，JSON 里 en 常被用作英文释义
  const en = String(it.exampleEn || it.sentence || '').trim()
  const zh = String(it.exampleZh || '').trim()
  if (en) item.exampleEn = en
  if (zh) item.exampleZh = zh
  return item
}

// 目标词书里「已经有了」的词（默认去重口径：核心语料 + 该书导入词）
// AI 生成前拿它做排除项：既告诉模型别再给，也让它给出来的重复词被就地丢掉并继续补
export function existingWords(bookId) {
  const out = []
  const push = (w) => { const s = String(w || '').trim().toLowerCase(); if (s) out.push(s) }
  WORDS.forEach(w => push(w.w))
  ;((store.get().customWords || {})[bookId] || []).forEach(w => push(w.word))
  return out
}

// ---------- 2. 校验 + 去重 ----------
// opts.allowKnown = true：只按目标词书自身去重，不把「核心词典里已有」当成重复。
// 用于单词详情页的「加入词书」—— 核心词收进另一本书（导入词书 / 自建词书）是合理诉求，
// 但默认导入管道仍然保持全局去重（否则批量导入会把核心词重复变成导入词）。
export function validateAndDedupe(list, bookId, opts) {
  const o = opts || {}
  const existing = new Set()
  if (!o.allowKnown) WORDS.forEach(w => existing.add(w.w.toLowerCase()))
  const custom = ((store.get().customWords || {})[bookId] || [])
  custom.forEach(w => existing.add(String(w.word || '').toLowerCase()))
  if (o.allowKnown) {
    // 目标词书的内置批次词也算「已有」，避免把核心词重复塞回核心词书
    const byId = {}
    WORDS.forEach(w => { byId[w.id] = w })
    const book = getBook(bookId)
    ;((book && book.batches) || []).forEach(b => {
      (b.wordIds || []).forEach(id => {
        const w = byId[id]
        if (w) existing.add(String(w.w || '').toLowerCase())
      })
    })
  }

  const seen = new Set()
  const accepted = []
  const rejected = []
  list.forEach(it => {
    if (!it.word) return rejected.push({ ...it, reason: '词形非法' })
    if (existing.has(it.word)) return rejected.push({ ...it, reason: '词库中已存在（去重）' })
    if (seen.has(it.word)) return rejected.push({ ...it, reason: '本次导入内重复' })
    if (!it.meaning || it.meaning.length < 2) return rejected.push({ ...it, reason: '缺少中文释义' })
    if (/[\u4e00-\u9fa5]/.test(it.word)) return rejected.push({ ...it, reason: '非英文单词' })
    seen.add(it.word)
    accepted.push(it)
  })
  return { accepted, rejected, dupCount: rejected.length }
}

// ---------- 3. 归入词书 ----------
export function importIntoBook(list, bookId) {
  const st = store.get()
  st.customWords = st.customWords || {}
  const target = bookId || 'custom_inbox'
  const bucket = st.customWords[target] || (st.customWords[target] = [])

  list.forEach((it, i) => {
    const rec = {
      id: 'cw-' + Date.now() + '-' + i,
      word: it.word,
      pos: it.pos || guessPos(it.word),
      meaning: it.meaning,
      lv: 1,
      addedAt: Date.now()
    }
    // 粘贴时自带例句就直接落库，并打上 exampleSid ——
    // generateForImported 只挑缺例句的词，这样一次请求都不用发
    if (it.exampleEn) {
      rec.exampleEn = it.exampleEn
      rec.exampleZh = it.exampleZh || ''
      rec.exampleSid = 'cwex-' + String(it.word).toLowerCase()
    }
    bucket.push(rec)
  })
  store.save(st)
  // 导入是一次性重要写入，不走节流窗口：立刻落盘，导完就杀进程也不丢
  store.flush()
  // 让导入的单词立刻能被练习页点读命中
  dict.invalidateCache()
  return { bookId: target, added: list.length, total: bucket.length }
}

function guessPos(word) {
  if (/(ize|ise|ify|ate|en)$/.test(word)) return 'v.'
  if (/(ous|ful|ive|able|ible|al|ic|less|ant|ent)$/.test(word)) return 'adj.'
  if (/(tion|sion|ment|ness|ity|ance|ence|ship|ism)$/.test(word)) return 'n.'
  return ''
}

export function customWordsOf(bookId) {
  return ((store.get().customWords || {})[bookId] || [])
}

// 给已入库的自定义词补一条例句（搜索补充走这条路：直接复用 AI 返回的例句，不额外发请求）
export function attachExampleTo(bookId, word, en, zh) {
  if (!word || !en) return false
  const target = String(word).toLowerCase()
  const st = store.get()
  const bucket = ((st.customWords || {})[bookId] || [])
  const hit = bucket.filter(w => String(w.word || '').toLowerCase() === target)[0]
  if (!hit) return false
  hit.exampleEn = en
  hit.exampleZh = zh || ''
  if (!hit.exampleSid) hit.exampleSid = 'cwex-' + target
  store.save(st)
  store.flush()
  return true
}

// ---------- 4. 导入后按 i+1 自动生成例句 ----------
//
// 从前这里默认「把整本词书里所有缺例句的词一起补掉」——
// 于是第 N 次导入要把前 N-1 次欠下的例句债一起还，越用越慢。
// 现在加 opts.only：只补本次导入的这些词（word-task / import-task 都传），
// 不传才退回全量补债（兼容老调用）。
//
// opts: { only: [word], limit, concurrency, gap, shouldStop }
export async function generateForImported(bookId, onProgress, opts) {
  const o = opts || {}
  let words = customWordsOf(bookId).filter(w => !w.exampleSid)
  if (o.only && o.only.length) {
    const set = {}
    o.only.forEach(w => { set[String(w || '').toLowerCase()] = true })
    words = words.filter(w => set[String(w.word || '').toLowerCase()])
  }
  if (o.limit > 0) words = words.slice(0, o.limit)
  // 一个都不缺（粘贴时就自带了例句）→ 直接收工：别再空跑一次批量请求
  if (!words.length) return []
  // 熟词池只算一次：它跟具体哪个词无关，放进 map 里会白算 N 遍
  const known = iplus1.knownPool(bookId, 100)
  const reqs = words.map(w => ({
    bookId,
    level: 'custom',
    scene: '日常场景',
    newWords: [{ word: w.word, pos: w.pos, meaning: w.meaning }],
    knownWords: known,
    constraints: { newWordCount: 1, maxNewWords: 3, sentenceLength: [8, 30], style: ['idiomatic', 'daily'], forbid: ['translation tone'] },
    excludeSids: []
  }))
  // 必须 await：onProgress 可能是 async（后台任务靠它插入"暂停/停止"检查点），
  // 不 await 的话回调变成游离 Promise —— 暂停挂不住，取消信号还会变成未处理拒绝
  const results = await generateBatch(reqs, async (s, i, len) => {
    if (onProgress) await onProgress({ done: i + 1, total: len, en: !!(s && s.en) })
  }, {
    concurrency: o.concurrency || 1,
    gap: typeof o.gap === 'number' ? o.gap : 300,
    shouldStop: o.shouldStop
  })
  // 回写例句到自定义词
  const st = store.get()
  words.forEach((w, i) => {
    if (results[i] && results[i].en) {
      w.exampleEn = results[i].en
      w.exampleZh = results[i].zh
      w.exampleSid = results[i].sid
    }
  })
  store.save(st)
  store.flush()
  return results
}

// ---------- 4.5 外部 AI 提示词（豆包 / DeepSeek / 网页版 ChatGPT 等） ----------
//
// 场景：没有配置 App 内的 API，或想用免费网页版大模型。
// 生成一段可直接粘贴的提示词，用户把模型返回的词表粘回导入框即可入库。
//
// 格式为什么定成 CSV（word,pos,meaning）：
//   本地解析管道支持 JSON / CSV / 逐行文本，但**不支持 markdown 表格** ——
//   `| improve | v. | 提高 |` 按 `|` 切分后首列是空串，整行会被判为非法词丢弃。
//   所以提示词里明确禁止表格、序号、音标、代码块围栏，只认最稳的 CSV。
// count: >0 固定数量；0 / 负数 / 非法 = 不限
// 外部 AI 提示词：一次把「单词 + 例句 + 例句翻译」全要回来。
// 为什么改成竖线分隔的一行式：用户是纯复制粘贴 —— 整段一次复制、粘贴框一次粘，
// 单词和例句同批落地，App 这边一个例句请求都不用发（原来要逐词再问一遍模型，最耗时）。
// 例句里必然有逗号，所以不能用 CSV；表格 / markdown 解析不了，所以明令禁止。
export function buildWordListPrompt(opts) {
  const o = opts || {}
  const topic = String(o.topic || '').trim() || '（请填写主题）'
  const n = Math.floor(Number(o.count) || 0)
  const countLine = n > 0
    ? '9. 一共正好 ' + n + ' 行数据（不含表头那一行）'
    : '9. 尽可能完整地覆盖该主题，直到确实没有更多常用词为止'

  const lines = [
    '你是英语词表助手。请列出「' + topic + '」这一主题下最常用、最值得先背的英语单词，并为每个单词配一个例句。',
    '',
    '【输出格式】必须严格遵守，否则无法被程序解析：',
    '1. 只输出纯文本，一行一个单词，五个字段用竖线 | 分隔，顺序固定：',
    '   英文单词|词性|中文释义|英文例句|例句中文翻译',
    '2. 第一行固定为表头：word|pos|meaning|en|zh',
    '3. 单词一律小写；词性用 n. / v. / adj. / adv. / prep. / conj. / pron. 等标准缩写',
    '4. 中文释义简洁，多个义项用「；」分隔',
    '5. 英文例句：8~30 个词，地道自然、贴合主题，必须包含该单词；不要出现竖线 |',
    '6. 例句中文翻译简洁通顺，不要逐字直译',
    '7. 不要输出序号、音标、markdown 表格、代码块围栏，也不要任何开头或结尾的说明文字',
    '8. 同一单词不要重复',
    countLine,
    '',
    '示例（照着这个格式写，整段可直接被程序读取）：',
    'improve|v.|改进|We should improve our service.|我们应该改进我们的服务。',
    'invoice|n.|发票|Please send me the invoice by email.|请用邮件把发票发给我。',
    '',
    '主题：' + topic
  ]
  return lines.join('\n')
}

// ---------- 5. 完整管道 ----------
// opts 透传给 generateForImported（only / concurrency / gap / shouldStop）。
// 默认只给本次导入的词补例句 —— 不再顺手还掉整本书的历史例句债。
export async function importPipeline(text, bookId, onStep, opts) {
  const step = (k, v) => { if (onStep) onStep(k, v); }
  const parsed = parseSharedText(text)
  step('parsed', parsed.length)
  const { accepted, rejected } = validateAndDedupe(parsed, bookId)
  step('validated', { accepted: accepted.length, rejected: rejected })
  const res = importIntoBook(accepted, bookId)
  step('imported', res)
  const o = Object.assign({ only: accepted.map(w => w.word) }, opts || {})
  const examples = await generateForImported(bookId, undefined, o)
  step('generated', examples.length)
  return { parsed: parsed.length, accepted, rejected, ...res, examples }
}

export function bookOptions() {
  return WORDBOOKS.map(b => ({ id: b.id, name: b.name }))
}

export { getBook }
