// data/wordbooks.js - 词书定义：内置考试词书（专升本 / 四六级 / 考研 / 高考 / 中考）+ 我的导入词书
//
// 词条从哪来：
//   ① 核心 640 词  —— data/words.js（id 1..640，手写的老词库，位置与编号保持不变）
//   ② 词书共享表  —— data/lexicon.js（id 10001 起，由 _vocab/build.js 从开源词表生成）
//   每本书只记录「用哪些词条」（data/bookdata.js 里的序号），释义在所有书之间共享一份。
//
// 分批规则：
//   每本书内部按「综合词频 + 命中考试词表数」排好序（见 _vocab/build.js），高频在前；
//   再均摊切成若干批（每批 20 或 30 词），越往后越难；掌握 70% 解锁下一批。
//
// 硬约束：默认词书 id 为 fj_zsb_core，它的前 32 批必须是旧版那 640 个核心词、每批 20 词、
//   顺序与分组都不能动 —— 学习进度是按词 id 记在用户本地的，动了就对不上。
import { WORDS } from './words.js'
import { lexWords } from './lexicon.js'
import { BOOK_INDEX, IDX_LEN } from './bookdata.js'

const LEVEL_NAMES = ['入门高频词', '基础高频词', '进阶高频词', '冲刺高频词']

// 旧版核心词书的分批：640 词、每批 20 词 → 前 32 批。这两个数改不得。
const CORE_BATCH_SIZE = 20
const CORE_COUNT = WORDS.length

// ---------------- 序号 → 词条 ----------------

// bookdata.js 里每本书存的是「定长 base36 序号串」，解码成行号数组
function decodeIndex(raw) {
  if (!raw) return []
  const out = []
  for (let i = 0; i + IDX_LEN <= raw.length; i += IDX_LEN) {
    const n = parseInt(raw.substr(i, IDX_LEN), 36)
    if (!isNaN(n)) out.push(n)
  }
  return out
}

// 取一本书的词条。顺带说明时机：EXT_BOOKS 在模块加载时就建好了全部 6 本书的批次，
// 所以共享表是启动时解析一次的（实测 6ms / +0.59MB），之后全是缓存，不需要改成异步加载。
function wordsOf(bookId) {
  const all = lexWords()
  const out = []
  decodeIndex(BOOK_INDEX[bookId]).forEach(n => {
    const w = all[n]
    if (w) out.push(w)
  })
  return out
}

// 核心 640 词：先按 lv 升序再按 id 升序 —— 与旧版 buildBatches() 完全一致，不要改
function coreWords() {
  return WORDS.slice().sort((a, b) => (a.lv - b.lv) || (a.id - b.id))
}

// 均摊切块：把 list 切成若干块，每块尽量接近 size 个。
// 不用固定步长切片的原因 —— 那样最后一块常常只剩几个词（专升本追加 1800 词按 20 切，尾巴只剩 5 个），
// 用户会看到一组莫名其妙的"迷你批"。均摊后每块之间只差 1 个词。
function evenChunks(list, size) {
  const out = []
  const n = Math.max(1, Math.round(list.length / size))
  const base = Math.floor(list.length / n)
  const extra = list.length % n
  let pos = 0
  for (let i = 0; i < n; i++) {
    const take = base + (i < extra ? 1 : 0)
    out.push(list.slice(pos, pos + take))
    pos += take
  }
  return out
}

// 批次命名：按「这一批在本册中的位置」四等分，而不是按词条在全局词频里的档位。
//
// 为什么不用全局 lv：每本书挑的都是该范围内最常用的一批词，直接拿全局档位命名的话，
// 「中考」40 批里会有 36 批叫「入门高频词」，专升本也会在冲刺档之后又跳回入门档，
// 看名字完全判断不出学到哪儿了。按册内进度切四档，每本书都是 入门 → 冲刺 的完整曲线。
function makeBatches(chunks, prefix) {
  const total = chunks.length
  const counter = {}
  return chunks.map((chunk, i) => {
    const lv = Math.min(4, 1 + Math.floor((i / total) * 4))
    counter[lv] = (counter[lv] || 0) + 1
    return {
      id: prefix + '-' + (i + 1),
      index: i,
      name: LEVEL_NAMES[lv - 1] + ' · 第 ' + counter[lv] + ' 组',
      level: lv,
      wordIds: chunk.map(w => w.id)
    }
  })
}

// 生成一本书的批次。
// appendCore 的书（目前只有专升本）= 旧版核心 640 词 + 追加的新词：
//   头部必须固定按 20 词一批切成前 32 批，和旧版一一对齐，老用户的学习记录才不会错位；
//   头部之后的追加部分再走均摊。
function batchesOfBook(meta, list) {
  const prefix = meta.id === 'fj_zsb_core' ? 'batch' : meta.id
  const size = meta.batchSize
  const chunks = []
  if (meta.appendCore) {
    const head = CORE_COUNT
    for (let i = 0; i < head; i += CORE_BATCH_SIZE) chunks.push(list.slice(i, i + CORE_BATCH_SIZE))
    evenChunks(list.slice(head), size).forEach(c => chunks.push(c))
  } else {
    evenChunks(list, size).forEach(c => chunks.push(c))
  }
  return makeBatches(chunks, prefix)
}

// ---------------- 内置词书清单 ----------------
// group 用于词书列表的分组标题；level 会随请求一起给 AI 生成例句时当难度标签
// appendCore:true 表示这本书 = 核心 640 词（前 32 批）+ 共享表里挑出的新词（后续批次）
const EXT_META = [
  {
    id: 'fj_zsb_core',
    name: '福建专升本',
    group: '升学考试',
    level: 'zsb',
    batchSize: 20,
    appendCore: true,
    desc: '专升本考纲核心词，含 640 个基础高频词，逐批解锁',
    note: '默认词书'
  },
  {
    id: 'cet4',
    name: '大学英语四级',
    group: '大学英语',
    level: 'cet4',
    batchSize: 30,
    desc: 'CET-4 大纲词汇，按词频排序，先搞定高频词'
  },
  {
    id: 'cet6',
    name: '大学英语六级',
    group: '大学英语',
    level: 'cet6',
    batchSize: 30,
    desc: 'CET-6 大纲词汇，建议在四级之后刷'
  },
  {
    id: 'kaoyan',
    name: '考研英语',
    group: '升学考试',
    level: 'kaoyan',
    batchSize: 30,
    desc: '考研英语高频与核心词，含大量书面语与熟词僻义'
  },
  {
    id: 'gao_kao',
    name: '高考英语',
    group: '中学词汇',
    level: 'gk',
    batchSize: 20,
    desc: '高中 / 高考必备词汇，打基础用这本'
  },
  {
    id: 'junior_core',
    name: '中考英语',
    group: '中学词汇',
    level: 'zk',
    batchSize: 20,
    desc: '初中 / 中考必备词汇，起步或者补基础用'
  }
]

function countOf(batches) {
  return batches.reduce((a, b) => a + b.wordIds.length, 0)
}

const EXT_BOOKS = EXT_META.map(meta => {
  const list = meta.appendCore ? coreWords().concat(wordsOf(meta.id)) : wordsOf(meta.id)
  const batches = batchesOfBook(meta, list)
  const total = countOf(batches)
  return {
    id: meta.id,
    name: meta.name,
    desc: meta.desc + '，共 ' + total + ' 词 / ' + batches.length + ' 批',
    group: meta.group,
    level: meta.level,
    note: meta.note || '',
    batches: batches
  }
})

export const WORDBOOKS = EXT_BOOKS.concat([
  {
    id: 'custom_inbox',
    name: '我的导入词书',
    desc: '从其他软件分享导入的单词自动归入此书',
    group: '我的',
    level: 'custom',
    note: '',
    batches: [
      { id: 'batch-custom-0', index: 0, name: '导入批次 1', level: 1, wordIds: [] }
    ]
  }
])

// ---------- 用户自建词书（AI 生成 / 手动新建） ----------
// data 层不直接依赖 utils（避免反向依赖），改由 utils/wordbook.js 在加载时
// 注入一个「读取自建词书列表」的函数。未注入时自建词书视为不存在。
let userBookProvider = null
export function setUserBookProvider(fn) {
  userBookProvider = typeof fn === 'function' ? fn : null
}
function userBooks() {
  if (!userBookProvider) return []
  try { return userBookProvider() || [] } catch (e) { return [] }
}

export function isBuiltinBook(bookId) {
  return WORDBOOKS.some(b => b.id === bookId)
}

// 未登记的词书 id（用户新建的空词书等）也返回真实书对象（批次为空）；
// 只有在既非内置、也非自建时才返回占位空书。
// 注意：不要悄悄回退到核心词书——否则空词书会显示出核心词书的全部词。
export function getBook(bookId) {
  if (!bookId) return WORDBOOKS[0]
  const builtin = WORDBOOKS.find(b => b.id === bookId)
  if (builtin) return builtin
  const user = userBooks().find(b => b.id === bookId)
  if (user) return user
  return {
    id: bookId,
    name: '空词书',
    desc: '该词书暂无内置词汇',
    group: '我的',
    level: 'custom',
    batches: []
  }
}

export function getBatch(bookId, batchIndex) {
  const book = getBook(bookId)
  return book.batches[batchIndex] || book.batches[book.batches.length - 1]
}

// 全书的词 id 列表：延迟构建后缓存（批次是静态数据，不会变，缓存不需要失效）
const IDS_CACHE = {}
export function wordIdsOfBook(bookId) {
  const bid = bookId || WORDBOOKS[0].id
  if (IDS_CACHE[bid]) return IDS_CACHE[bid]
  const list = getBook(bid).batches.reduce((a, b) => a.concat(b.wordIds), [])
  IDS_CACHE[bid] = list
  return list
}
