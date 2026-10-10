// utils/sentence-index.js - 例句倒排索引（惰性构建，一次性 ~20-40ms）
// 词库扩充到 640 词 / 600+ 句后，避免每次出题都对全表做正则分词扫描。
//
// 索引：
//   byLemma：词（原形或句中出现的任意词形）→ 例句数组
//   byLv   ：难度档 → 例句数组
//   byId   ：句 id → 例句
import { SENTENCES } from '../data/sentences.mjs'
import { WORDS } from '../data/words.mjs'
import { lemmaCandidates } from './lemma.mjs'

let mapLemma = null
let mapLv = null
let mapId = null
const WORD_BY_ID = {}
WORDS.forEach(w => { WORD_BY_ID[w.id] = w })

function push(map, key, s) {
  if (!key) return
  const arr = map.get(key)
  if (arr) { if (arr.indexOf(s) < 0) arr.push(s) } else map.set(key, [s])
}

export function ensure() {
  if (mapLemma) return
  mapLemma = new Map()
  mapLv = {}
  mapId = new Map()
  SENTENCES.forEach(s => {
    mapId.set(s.id, s)
    if (!mapLv[s.lv]) mapLv[s.lv] = []
    mapLv[s.lv].push(s)
    const seen = new Set()
    const keys = []
    // 1) 句子标注的核心词（按 id 取词形，命中率最高）
    ;(s.w || []).forEach(id => {
      const w = WORD_BY_ID[id]
      if (w) keys.push(w.w.toLowerCase())
    })
    // 2) 句中实际出现的每个词（原形 + 词形）
    const tokens = String(s.en || '').toLowerCase().match(/[a-z']+/g) || []
    tokens.forEach(t => {
      keys.push(t)
      lemmaCandidates(t).forEach(c => keys.push(c))
    })
    keys.forEach(k => {
      if (seen.has(k)) return
      seen.add(k)
      push(mapLemma, k, s)
    })
  })
}

export function candidates(word) {
  ensure()
  return mapLemma.get(String(word || '').toLowerCase()) || []
}

export function byLevel(lv) {
  ensure()
  return (lv && mapLv[lv]) || []
}

export function byId(id) {
  ensure()
  return mapId.get(id)
}

// 相邻难度档的例句（抽干扰项用）
export function neighbours(lv) {
  ensure()
  const out = []
  if (mapLv[lv]) out.push.apply(out, mapLv[lv])
  if (mapLv[lv - 1]) out.push.apply(out, mapLv[lv - 1])
  if (mapLv[lv + 1]) out.push.apply(out, mapLv[lv + 1])
  return out
}

export function size() {
  ensure()
  return { sentences: SENTENCES.length, keys: mapLemma.size }
}
