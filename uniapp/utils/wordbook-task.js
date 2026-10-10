// utils/wordbook-task.js - AI 生成词书的后台任务（模块级单例）
//
// 为什么抽成模块级：
//   生成耗时可能几十秒到几分钟（多轮问模型 + 逐词补例句）。原来这段逻辑写在页面组件里，
//   用户一退出页面，虽然 JS 还在跑，但状态无处可写、进度看不见、也没法暂停/停止。
//   放在模块里后，任务生命周期与页面解耦：页面只负责订阅状态 + 发指令，
//   退出页面后任务继续跑，回到页面（或任何页面）都能看到进度并继续控制。
//
// 暂停 / 停止的实现：
//   不是粗暴中断（网络请求没法中途掐断），而是**协作式检查点**——
//   在"每轮问模型之前"和"每生成一条例句之前" await 一个闸门：
//     · 暂停：闸门挂起（每 200ms 轮询一次），当前这次请求跑完就停住
//     · 停止：闸门抛 CANCEL，任务立刻进入清理流程
//   所以暂停/停止在最多"一次请求"的粒度内生效，不会丢数据。
import { generateWordbook, WORDBOOK_COUNT } from '../services/ai-content.js'
import * as importer from './importer.js'
import * as wordbook from './wordbook.js'

const CANCEL = { cancelled: true }
// 补例句的并发度：例句请求体不小，压在 3 条既能提速又不至于被限流
const EXAMPLE_CONCURRENCY = 3
const IDLE = {
  status: 'idle',      // idle | running | paused | done | stopped | error
  phase: '',           // gen（问模型）| import（写入本地）| examples（补例句）
  topic: '',
  count: 0,
  auto: false,
  mode: 'new',         // new 新建词书 | merge 并入现有
  bookId: '',
  bookName: '',
  got: 0,
  target: 0,
  round: 0,
  exDone: 0,
  exTotal: 0,
  parsed: 0,
  added: 0,
  dup: 0,              // 生成阶段被查重丢掉的词数（已自动补足，仅作解释用）
  rejected: 0,
  examples: 0,
  message: '',
  error: '',
  resultText: '',
  resultBookId: ''
}

let task = null
const listeners = []

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function snapshot() {
  if (!task) return Object.assign({}, IDLE, { status: 'idle' })
  return Object.assign({}, IDLE, task)
}

function notify() {
  const s = snapshot()
  listeners.slice().forEach(fn => {
    try { fn(s) } catch (e) { /* 页面已销毁则忽略 */ }
  })
}

function set(patch) {
  if (!task) return
  Object.assign(task, patch)
  notify()
}

// 协作式闸门：暂停时挂起，停止时抛出
async function gate() {
  if (!task) throw CANCEL
  // 100ms 轮询：点「继续」后能较快恢复，又不至于空转太狠
  while (task.paused) {
    if (task.cancel) throw CANCEL
    await sleep(100)
  }
  if (task.cancel) throw CANCEL
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
  return !!task && (task.status === 'running' || task.status === 'paused')
}

export function isRunning() { return !!task && task.status === 'running' }
export function isPaused() { return !!task && task.status === 'paused' }

export function pause() {
  if (!task || task.status !== 'running') return false
  task.paused = true
  task.status = 'paused'
  notify()
  return true
}

export function resume() {
  if (!task || task.status !== 'paused') return false
  task.paused = false
  task.status = 'running'
  notify()
  return true
}

// 停止：只打标记，具体在某个检查点生效（不会丢已写入的词）
export function stop() {
  if (!isBusy()) return false
  task.cancel = true
  task.paused = false
  notify()
  return true
}

// 重置（看完结果后清掉，让按钮回到初始态）
export function reset() {
  if (isBusy()) return false
  task = null
  notify()
  return true
}

// ---------- 启动 ----------
// opts: { topic, count, mode:'new'|'merge', bookId, bookName }
export async function start(opts) {
  if (isBusy()) return false
  const o = opts || {}
  const topic = String(o.topic || '').trim()
  if (!topic) return false

  task = Object.assign({}, IDLE, {
    status: 'running',
    phase: 'gen',
    topic,
    count: o.count || 0,
    auto: !o.count,
    mode: o.mode === 'merge' ? 'merge' : 'new',
    bookId: String(o.bookId || ''),
    bookName: String(o.bookName || ''),
    paused: false,
    cancel: false,
    createdId: '',
    message: '准备中…'
  })
  notify()

  try {
    await run()
  } catch (e) {
    if (e === CANCEL) {
      finishStopped()
    } else {
      // 出错：新建的空词书要回收，避免留一本空书
      try { if (task.createdId) wordbook.deleteUserBook(task.createdId) } catch (err) {}
      set({ status: 'error', error: (e && e.message) || '生成失败' })
      uni.showToast({ title: '生成失败：' + ((e && e.message) || '请检查 AI 设置'), icon: 'none' })
    }
  }
  notify()
  return true
}

// ---------- 主流程 ----------
async function run() {
  // 阶段 1：问模型拿词表（每轮之前都会过一次闸门）
  set({ message: 'AI 生成中…' })
  // 目标词书里已有的词先算出来：模型别再给，给了也当重复丢掉、额度不减，
  // 于是"要 5 个、撞上 2 个重复"会继续生成到凑够 5 个新的为止（总产出 7 个）
  let banned = []
  try { banned = importer.existingWords(task.mode === 'new' ? '' : task.bookId) } catch (e) {}
  const g = await generateWordbook({
    topic: task.topic,
    count: task.count,
    banned,
    // 停止：下一轮开始就跳出（onProgress 里抛出的取消会被 ai-content 吞掉，故用显式协议）
    shouldStop: () => !!(task && task.cancel),
    onProgress: async (p) => {
      // 流式心跳：只刷"接收中"的文案，不能 await gate() ——
      // onDelta 是高频同步回调，在这里挂起会叠出一堆并发闸门
      if (p.streaming) {
        set({
          message: p.auto
            ? 'AI 生成中… 已获取 ' + p.got + ' 词（第 ' + p.round + ' 轮 · 接收中 ' + p.streamed + ' 字）'
            : 'AI 生成中… ' + p.got + '/' + p.target + '（接收中 ' + p.streamed + ' 字）'
        })
        return
      }
      // 查重丢掉的词会在下一轮补上，但仍要让用户看见"为什么进度没动"
      const dupNote = p.dup ? ' · 去重跳过 ' + p.dup + ' 个（继续补足）' : ''
      set({
        got: p.got,
        target: p.target,
        round: p.round,
        auto: p.auto,
        dup: p.dup || 0,
        message: p.auto
          ? 'AI 生成中… 已获取 ' + p.got + ' 词（第 ' + p.round + ' 轮）' + dupNote
          : 'AI 生成中… ' + p.got + '/' + p.target + dupNote
      })
      await gate()
    }
  })
  await gate()

  // 阶段 2：落地（新建词书 / 并入现有）+ 去重 + 写库
  set({ phase: 'import', message: '写入本地…' })

  let target = task.bookId
  let bookLabel = ''
  let createdId = ''
  if (task.mode === 'new') {
    bookLabel = task.bookName || g.bookName || task.topic
    createdId = wordbook.createUserBook(bookLabel, 'AI 生成 · ' + task.topic)
    target = createdId
    task.createdId = createdId
  } else {
    try {
      const b = wordbook.listBooks().find(x => x.id === target)
      bookLabel = b ? b.name : target
    } catch (e) {
      bookLabel = target
    }
  }

  const { accepted, rejected } = importer.validateAndDedupe(g.words, target)
  if (!accepted.length) {
    if (createdId) wordbook.deleteUserBook(createdId)
    set({
      status: 'done',
      phase: '',
      bookId: target,
      bookName: bookLabel,
      parsed: g.words.length,
      added: 0,
      rejected: rejected.length,
      resultText: 'AI 生成的词都已存在，未新增（换个主题试试）'
    })
    uni.showToast({ title: '生成完成：没有新词', icon: 'none' })
    return
  }

  const res = importer.importIntoBook(accepted, target)

  // 阶段 3：逐词补例句（每条之前过闸门，所以暂停/停止在这里也能生效）
  set({
    phase: 'examples',
    message: '生成例句…',
    parsed: g.words.length,
    added: res.added,
    dup: g.dup || 0,
    rejected: rejected.length,
    exDone: 0,
    exTotal: accepted.length
  })

  // 只补本次进来的词：否则这一轮会把整本书历史欠下的例句一起还，越用越慢
  const ex = await importer.generateForImported(target, async (p) => {
    set({
      exDone: p.done,
      exTotal: p.total,
      message: '生成例句… ' + p.done + '/' + p.total
    })
    await gate()
  }, {
    only: accepted.map(w => w.word),
    concurrency: EXAMPLE_CONCURRENCY,
    gap: 0,
    shouldStop: () => !!(task && task.cancel)
  })

  const exCount = (ex || []).filter(x => x && x.en).length
  set({
    status: 'done',
    phase: '',
    bookId: target,
    bookName: bookLabel,
    examples: exCount,
    resultText: (task.mode === 'new' ? '已新建词书「' + bookLabel + '」' : '已并入「' + bookLabel + '」')
      + ' · 新增 ' + res.added + ' 词' + (rejected.length ? '（跳过 ' + rejected.length + '）' : '')
      + (g.dup ? ' · 查重丢掉 ' + g.dup + ' 个，已自动补足' : '')
      + (task.auto ? (g.complete ? ' · 该主题已覆盖完整' : ' · 已达 ' + WORDBOOK_COUNT.MAX + ' 词上限') : ''),
    resultBookId: task.mode === 'new' ? createdId : ''
  })
  uni.showToast({ title: '生成完成：新增 ' + res.added + ' 词', icon: 'success' })
}

// 停止后的收尾：已经写进词书的部分保留（例句没补完也没关系，
// generateForImported 只处理缺例句的词，以后可以续做）
function finishStopped() {
  const added = task.added || 0
  // 一个词都还没写进词书就停止 → 回收新建的空词书，不留垃圾；
  // 已经写进去的部分则完整保留（例句没补完也没关系，以后可以续做）
  if (!added && task.createdId) {
    try { wordbook.deleteUserBook(task.createdId) } catch (e) {}
  }
  set({
    status: 'stopped',
    phase: '',
    message: '',
    resultText: added
      ? '已停止：已导入 ' + added + ' 词，例句可稍后继续补'
      : '已停止，未导入任何词'
  })
  uni.showToast({ title: '已停止生成', icon: 'none' })
}
