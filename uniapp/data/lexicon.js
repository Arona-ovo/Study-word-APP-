// data/lexicon.js - 内置词书「共享词条表」的读取层（手写；数据本身在 lexicon-data.js，由 _vocab/build.js 生成）
//
// 背景：多本内置词书（专升本 / 四级 / 六级 / 考研 …）之间重复词条极多，
// 释义如果每本书各存一份，体积会翻倍。所以做法是：
//   词条只存一份（lexicon-data.js），每本书只存「词条序号」（bookdata.js），
//   本文件负责把两者解码成 [{id,w,pos,m,lv}]，并提供 id / 单词两种索引。
//
// 解析时机：全部懒解析 + 单例缓存。
//   首次真正用到（切换词书、出题、查词）才 parse；没切到那些词书就不占内存。
//
// id 规则：核心词书 words.js 占用 1..640；这里从 LEX_START(10001) 起，两者永不相撞。
// 所以 「allById()」 是全局唯一的 id → 词条映射，其他模块查词一律走它。
import { WORDS } from './words.js'
import { LEX_START, LEX_COUNT, LEX_RAW } from './lexicon-data.js'

// lv 不占文件体积：行已按词频排好序，按「行号 / 总行数」四等分即 1-4 档
function lvOf(i) {
  const r = LEX_COUNT ? i / LEX_COUNT : 0
  return r < 0.3 ? 1 : r < 0.6 ? 2 : r < 0.85 ? 3 : 4
}

let _lex = null

// 共享词条表：[{ id, w, pos, m, lv }]，顺序即词频顺序（越靠前越常用）
export function lexWords() {
  if (_lex) return _lex
  const lines = LEX_RAW.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i]
    if (!row) continue
    const a = row.indexOf('|')
    if (a < 0) continue
    const b = row.indexOf('|', a + 1)
    if (b < 0) continue
    const idx = out.length
    out.push({
      id: LEX_START + idx,
      w: row.slice(0, a),
      pos: row.slice(a + 1, b),
      m: row.slice(b + 1),
      lv: lvOf(idx)
    })
  }
  _lex = out
  return out
}

// ---------- 全局（核心词书 + 共享表）合并视图 ----------
// words.js 的 640 词仍是 id 1..640，形状一致，直接拼起来即可
let _all = null
let _byId = null
let _byText = null

export function allWords() {
  if (!_all) _all = WORDS.concat(lexWords())
  return _all
}

export function allById() {
  if (_byId) return _byId
  const map = {}
  allWords().forEach(w => { map[w.id] = w })
  _byId = map
  return map
}

export function allByText() {
  if (_byText) return _byText
  const map = {}
  allWords().forEach(w => { map[String(w.w).toLowerCase()] = w })
  _byText = map
  return map
}

// id 是否在共享表范围内（区分"核心词"与"词书新增词"，目前暂无差异化需求，留个口子）
export function isLexId(id) {
  return Number(id) >= LEX_START
}
