// utils/importer.js - 外部单词接入管道：解析 → 清洗 → 校验 → 去重 → 归书 → 生成例句
//
// 支持的输入形态：
// 1) JSON：[{word, pos, meaning}] 或 {words:[...]}
// 2) CSV：word,pos,meaning（首行可为表头）
// 3) 逐行文本：word | pos | meaning、word\tmeaning、word 释义、word - 释义
// 4) 常见背单词 App 分享文本（含"单词 / 音标 / 释义"混排）
import { WORDS } from '../data/words.mjs'
import { WORDBOOKS, getBook } from '../data/wordbooks.mjs'
import * as store from './store.mjs'
import * as iplus1 from './iplus1.mjs'
import { generateBatch, } from './sentence-api.mjs'
import * as dict from './dict.mjs'

const WORD_RE = /^[a-zA-Z][a-zA-z'-]{1,19}$/

// ---------- 1. 解析 ----------
export function parseSharedText(text) {
  if (!text || !text.trim()) return []
  const raw = text.trim()
  let parsed = tryJSON(raw)
  if (parsed) return parsed
  parsed = tryCSV(raw)
  if (parsed && parsed.length) return parsed
  return parseLines(raw)
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
      return normalizeItem({ word: parts[0], pos: parts[1], meaning: parts.slice(1).join(' ') })
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
  return { word: word.toLowerCase(), pos, meaning }
}

// ---------- 2. 校验 + 去重 ----------
export function validateAndDedupe(list, bookId) {
  const existing = new Set(WORDS.map(w => w.w.toLowerCase()))
  const custom = ((store.get().customWords || {})[bookId] || [])
  custom.forEach(w => existing.add(w.word.toLowerCase()))

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
    bucket.push({
      id: 'cw-' + Date.now() + '-' + i,
      word: it.word,
      pos: it.pos || guessPos(it.word),
      meaning: it.meaning,
      lv: 1,
      addedAt: Date.now()
    })
  })
  store.save(st)
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

// ---------- 4. 导入后按 i+1 自动生成例句 ----------
export async function generateForImported(bookId, onProgress) {
  const words = customWordsOf(bookId).filter(w => !w.exampleSid)
  const reqs = words.map(w => ({
    bookId,
    level: 'custom',
    scene: '日常场景',
    newWords: [{ word: w.word, pos: w.pos, meaning: w.meaning }],
    knownWords: iplus1.knownPool(bookId, 100),
    constraints: { newWordCount: 1, maxNewWords: 3, sentenceLength: [8, 30], style: ['idiomatic', 'daily'], forbid: ['translation tone'] },
    excludeSids: []
  }))
  const results = await generateBatch(reqs, (s) => {
    if (onProgress) onProgress(s)
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
  return results
}

// ---------- 5. 完整管道 ----------
export async function importPipeline(text, bookId, onStep) {
  const step = (k, v) => { if (onStep) onStep(k, v); }
  const parsed = parseSharedText(text)
  step('parsed', parsed.length)
  const { accepted, rejected } = validateAndDedupe(parsed, bookId)
  step('validated', { accepted: accepted.length, rejected: rejected })
  const res = importIntoBook(accepted, bookId)
  step('imported', res)
  const examples = await generateForImported(bookId)
  step('generated', examples.length)
  return { parsed: parsed.length, accepted, rejected, ...res, examples }
}

export function bookOptions() {
  return WORDBOOKS.map(b => ({ id: b.id, name: b.name }))
}

export { getBook }
