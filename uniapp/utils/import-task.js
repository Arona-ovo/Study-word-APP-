// utils/import-task.js - 粘贴导入的后台任务（模块级单例）
//
// 为什么要有它：
//   导入 = 「本地解析 + 写库」（毫秒级）+ 「给每个新词补例句」（每个词一次模型请求，几十秒起步）。
//   以前第二段写在页面方法里：退出页面后 async 链还活着、请求照发、token 照烧，
//   但进度没人看得到、想停停不掉、跑完的结果也没地方写（this 已经没了）。
//   挪到模块级之后，生命周期跟页面解耦：
//     · 退出页面 → 任务继续跑（这是有意的），回到页面照样能看到进度和结果
//     · 暂停 / 停止随时可用，已入库的词一律保留
//
// 与 wordbook-task 的关系：同构但独立。
//   wordbook-task 负责「AI 生成整本词书」，这里负责「把粘贴进来的词表落到指定词书」，
//   两者不会互相顶掉（各自一个单例，互不 isBusy 互斥）。
import * as importer from './importer.js'
import { t } from './i18n.js'

const CANCEL = { cancelled: true }
// 补例句并发度：与 wordbook-task 保持一致，3 条并发 + 无限流间隔
const EXAMPLE_CONCURRENCY = 3

const IDLE = {
  status: 'idle',      // idle | running | paused | done | stopped | error
  phase: '',           // parse（解析校验）| import（写库）| examples（补例句）
  bookId: '',
  withExamples: true,
  parsed: 0,
  added: 0,
  rejected: 0,
  rejectedList: [],   // 跳过的前若干条（word + reason），给用户看"为什么没进去"
  exDone: 0,
  exTotal: 0,
  examples: 0,
  message: '',
  error: '',
  resultText: ''
}

let job = null
const listeners = []

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function snapshot() {
  if (!job) return Object.assign({}, IDLE, { status: 'idle' })
  return Object.assign({}, IDLE, job)
}

function notify() {
  const s = snapshot()
  listeners.slice().forEach(fn => {
    try { fn(s) } catch (e) { /* 页面已销毁则忽略 */ }
  })
}

function set(patch) {
  if (!job) return
  Object.assign(job, patch)
  notify()
}

function toast(title) {
  try { uni.showToast({ title, icon: 'none' }) } catch (e) { /* 无 UI 环境忽略 */ }
}

// 协作式闸门：暂停时挂起，停止时抛出
async function gate() {
  if (!job) throw CANCEL
  while (job.paused) {
    if (job.cancel) throw CANCEL
    await sleep(100)
  }
  if (job.cancel) throw CANCEL
}

// ---------- 对外接口 ----------
export function get() { return snapshot() }

export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {}
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i >= 0) listeners.splice(i, 1)
  }
}

export function isBusy() {
  return !!job && (job.status === 'running' || job.status === 'paused')
}

export function isRunning() { return !!job && job.status === 'running' }
export function isPaused() { return !!job && job.status === 'paused' }

export function pause() {
  if (!job || job.status !== 'running') return false
  job.paused = true
  job.status = 'paused'
  notify()
  return true
}

export function resume() {
  if (!job || job.status !== 'paused') return false
  job.paused = false
  job.status = 'running'
  notify()
  return true
}

// 停止：只打标记，在下一个检查点生效。已经写进词书的词完整保留。
export function stop() {
  if (!isBusy()) return false
  job.cancel = true
  job.paused = false
  notify()
  return true
}

// 重置（看完结果后清掉，让按钮回到初始态）
export function reset() {
  if (isBusy()) return false
  job = null
  notify()
  return true
}

// ---------- 启动 ----------
// opts: { text, bookId, withExamples = true }
// 返回 Promise<boolean>：false = 没启动（内容为空 / 已有任务在跑）
export async function start(opts) {
  if (isBusy()) return false
  const o = opts || {}
  const text = String(o.text || '')
  if (!text.trim()) return false

  job = Object.assign({}, IDLE, {
    status: 'running',
    phase: 'parse',
    bookId: String(o.bookId || ''),
    withExamples: o.withExamples !== false,
    paused: false,
    cancel: false,
    message: t('解析中…')
  })
  notify()

  try {
    await run(text)
  } catch (e) {
    if (e === CANCEL) finishStopped()
    else {
      set({ status: 'error', phase: '', error: (e && e.message) || '导入失败', message: '' })
      toast(t('导入失败：{m}', { m: (e && e.message) || '请稍后重试' }))
    }
  }
  notify()
  return true
}

// ---------- 主流程 ----------
async function run(text) {
  set({ phase: 'parse', message: t('解析中…') })
  const parsed = importer.parseSharedText(text)
  const { accepted, rejected } = importer.validateAndDedupe(parsed, job.bookId)
  set({
    parsed: parsed.length,
    rejected: rejected.length,
    rejectedList: rejected.slice(0, 6).map(r => ({ word: r.word || '', reason: r.reason || '' }))
  })

  if (!accepted.length) {
    set({
      status: 'done',
      phase: '',
      added: 0,
      message: '',
      resultText: parsed.length
        ? t('解析到 {n} 条，但没有可导入的新词（可能都已存在，或缺少中文释义）', { n: parsed.length })
        : t('没解析出任何词条（请检查格式：每行 单词,词性,释义）')
    })
    toast(t('没有可导入的新词'))
    return
  }

  // 写库是同步的：这一步做完，词就已经在词书里了，后面例句阶段取消也不影响
  set({ phase: 'import', message: t('写入本地…') })
  const res = importer.importIntoBook(accepted, job.bookId)
  set({
    phase: 'examples',
    added: res.added,
    message: t('已入库 {n} 词', { n: res.added }),
    resultText: rejected.length
      ? t('已导入 {n} 词（跳过 {m} 条）', { n: res.added, m: rejected.length })
      : t('已导入 {n} 词', { n: res.added })
  })
  toast(t('已导入 {n} 词', { n: res.added }))

  if (!job.withExamples) {
    set({
      status: 'done',
      phase: '',
      message: '',
      resultText: t('已导入 {n} 词（未生成例句）', { n: res.added })
    })
    return
  }

  await gate()

  // 粘贴内容自带例句的词不用再问模型 —— 外部 AI「一次给全」就是图这个：
  // 这里直接收工，用户不用干等一轮例句生成
  const needEx = accepted.filter(w => !w.exampleEn).length
  if (!needEx) {
    set({
      status: 'done',
      phase: '',
      message: '',
      exDone: 0,
      exTotal: 0,
      examples: accepted.length,
      resultText: rejected.length
        ? t('已导入 {n} 词（跳过 {m} 条） · 例句 {k} 条（粘贴自带）', { n: res.added, m: rejected.length, k: accepted.length })
        : t('已导入 {n} 词 · 例句 {k} 条（粘贴自带）', { n: res.added, k: accepted.length })
    })
    toast(t('导入完成：{n} 词', { n: res.added }))
    return
  }

  set({ exDone: 0, exTotal: needEx, message: t('生成例句… {a}/{b}', { a: 0, b: needEx }) })

  const ex = await importer.generateForImported(job.bookId, async (p) => {
    set({
      exDone: p.done,
      exTotal: p.total,
      message: t('生成例句… {a}/{b}', { a: p.done, b: p.total })
    })
    await gate()
  }, {
    // 关键：只补本次导入的词。不传 only 的话，每次导入都会把这本词书
    // 历史上所有缺例句的词一起补掉 —— 那才是「越用越慢」的真正原因。
    only: accepted.map(w => w.word),
    concurrency: EXAMPLE_CONCURRENCY,
    gap: 0,
    shouldStop: () => !!(job && job.cancel)
  })

  const exCount = (ex || []).filter(x => x && x.en).length
  set({
    status: 'done',
    phase: '',
    examples: exCount,
    message: '',
    resultText: rejected.length
      ? t('已导入 {n} 词（跳过 {m} 条） · 例句 {k} 条', { n: res.added, m: rejected.length, k: exCount })
      : t('已导入 {n} 词 · 例句 {k} 条', { n: res.added, k: exCount })
  })
  toast(t('导入完成：{n} 词', { n: res.added }))
}

// 停止后的收尾：词已经入库，保留；例句没补完以后还能续
function finishStopped() {
  const added = job.added || 0
  set({
    status: 'stopped',
    phase: '',
    message: '',
    resultText: added
      ? t('已停止：{n} 个词已入库，例句可稍后继续补', { n: added })
      : t('已停止，未导入任何词')
  })
  toast(t('已停止导入'))
}
