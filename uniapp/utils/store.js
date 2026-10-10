// utils/store.js - 本地存储封装（学习进度全部保存在本地，无需后端）
// 数据结构：{ mastery: {wordId: {m, seen, correct}}, wrong: [...], days: {'YYYY-MM-DD': {total, correct}} }
//
// 落盘策略（2026-10 改）：节流写，不再每次 save 都同步落盘。
// 原因：一次作答会连着写两次（engine.recordAnswer + wordbook.setMastery），
// 每组 10-50 题就是 10-50 次把整个 state（掌握度 + 200 条错题 + 全部日期）序列化并同步写盘。
// 现在改成：改内存立即生效（get() 永远读到最新），落盘合并到时间窗里统一做一次。
// 安全性：窗口最多 800ms，切后台（App.vue onHide）与关键节点强制 flush，
// 所以最坏只丢"最后一次作答后不到 1 秒"的数据；真掉电也只掉这一瞬。
const KEY = 'fj_eng_state_v1';
const SAVE_GAP = 800;   // 两次落盘之间的最小间隔(ms)

let cache = null;
let dirty = false;      // 内存与磁盘不一致
let timer = 0;
// 数据修订号：每 save 一次 +1。派生数据（首页总览等）用它判断"要不要重算"，
// 避免每次切回首页都把整本词的掌握度遍历一遍。
let rev = 0;
// 初始值取当前时间：否则第一次 save 会算出"距上次写入已过了 50 年"而立刻落盘，
// 把本该合并的窗口白白浪费掉
let lastWriteAt = Date.now();

function blank() {
  return { mastery: {}, wrong: [], days: {} };
}

function load() {
  try {
    const v = uni.getStorageSync(KEY);
    if (v && v.mastery && v.days && v.wrong) return v;
  } catch (e) {
    console.error('读取学习数据失败', e);
  }
  return blank();
}

function init() {
  cache = load();
}

function get() {
  if (!cache) cache = load();
  return cache;
}

// 真正的写盘：没脏就不动，写完清标记
function writeNow() {
  if (!dirty || !cache) return;
  dirty = false;
  lastWriteAt = Date.now();
  try {
    uni.setStorageSync(KEY, cache);
  } catch (e) {
    console.error('保存学习数据失败', e);
  }
}

// 排一次落盘：距上次写入不足 SAVE_GAP 就顺延到窗口末尾（多次 save 合并成一次）
function schedule() {
  if (timer) return;
  const wait = Math.max(0, SAVE_GAP - (Date.now() - lastWriteAt));
  timer = setTimeout(() => {
    timer = 0;
    writeNow();
  }, wait);
}

function save(state) {
  cache = state;
  dirty = true;
  rev++;
  schedule();
}

/** 当前数据修订号：只读，派生缓存据此失效 */
function revision() {
  return rev;
}

// 立即落盘（切后台 / 退出 / 导入完成时调用）：把待写的那一次提前，不等待窗口
function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = 0;
  }
  writeNow();
}

function reset() {
  if (timer) {
    clearTimeout(timer);
    timer = 0;
  }
  dirty = false;
  rev++;
  cache = blank();
  try {
    uni.removeStorageSync(KEY);
  } catch (e) {}
}

export { init, get, save, flush, reset, revision };
