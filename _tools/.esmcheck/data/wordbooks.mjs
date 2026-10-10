// data/wordbooks.js - 词书定义：通用高频英语词，固定每批 20 词，批次内难度递进
import { WORDS } from './words.mjs'

const BATCH_SIZE = 20   // 落在 12-20 区间上限；改词库也不会让批次失衡

// 固定切片分批：先按 lv 升序、再按 id 升序，保证批次内难度递进
function buildBatches() {
  const sorted = WORDS.slice().sort((a, b) => (a.lv - b.lv) || (a.id - b.id))
  const names = ['入门高频词', '基础高频词', '进阶高频词', '冲刺高频词']
  const batches = []
  const counter = {}
  for (let i = 0; i < sorted.length; i += BATCH_SIZE) {
    const chunk = sorted.slice(i, i + BATCH_SIZE)
    const idx = batches.length
    const lv = chunk[chunk.length - 1].lv
    counter[lv] = (counter[lv] || 0) + 1
    batches.push({
      id: 'batch-' + (idx + 1),
      index: idx,
      name: (names[lv - 1] || '高频词') + ' · 第 ' + counter[lv] + ' 组',
      level: lv,
      wordIds: chunk.map(w => w.id)
    })
  }
  return batches
}

const BATCHES = buildBatches()

export const WORDBOOKS = [
  {
    id: 'fj_zsb_core',
    name: '核心词书',
    desc: WORDS.length + ' 个高频词，分 ' + BATCHES.length + ' 批，每批 ' + BATCH_SIZE + ' 词，逐批解锁',
    level: 'zsb',
    batches: BATCHES
  },
  {
    id: 'custom_inbox',
    name: '我的导入词书',
    desc: '从其他软件分享导入的单词自动归入此书',
    level: 'custom',
    batches: [
      { id: 'batch-custom-0', index: 0, name: '导入批次 1', level: 1, wordIds: [] }
    ]
  }
]

export function getBook(bookId) {
  return WORDBOOKS.find(b => b.id === bookId) || WORDBOOKS[0]
}

export function getBatch(bookId, batchIndex) {
  const book = getBook(bookId)
  return book.batches[batchIndex] || book.batches[book.batches.length - 1]
}

export function wordIdsOfBook(bookId) {
  return getBook(bookId).batches.reduce((a, b) => a.concat(b.wordIds), [])
}
