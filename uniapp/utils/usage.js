// utils/usage.js - 停留时长：按天累计「App 在前台」的时间
//
// 只做一件事：App 在前台待了多久。数据按天存本机（fj_usage_v1），
// 不上传、不和学习进度混在一起 —— 它只是给首页那张圆环卡提供数字。
//
// 计时口径：App.vue 的 onShow / onHide 之间算"在前台"。
// onHide 在部分端可能不来（直接杀进程），所以前台期间每 30s 自己落一次盘，
// 最多丢半分钟。单次间隔超过 6 小时的按异常处理（时钟跳变 / 后台计时器），直接丢掉。

const KEY = 'fj_usage_v1';
const KEEP_DAYS = 14;      // 只保留最近 14 天，别让这个对象无限长
const FLUSH_MS = 30000;    // 前台期间的落盘间隔
const MAX_SPAN = 6 * 3600 * 1000;

let days = {};
let loaded = false;
let enterAt = 0;
let timer = 0;

function pad(n) { return n < 10 ? '0' + n : String(n); }

/** 本地日期键 YYYY-MM-DD（用本地时区，跨零点自然换一天） */
export function dayKey(d) {
  const x = d || new Date();
  return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
}

function read() {
  if (loaded) return days;
  loaded = true;
  try {
    const raw = uni.getStorageSync(KEY);
    const o = raw ? JSON.parse(raw) : null;
    days = (o && o.days && typeof o.days === 'object') ? o.days : {};
  } catch (e) {
    days = {};
  }
  return days;
}

function persist() {
  try {
    uni.setStorageSync(KEY, JSON.stringify({ v: 1, days: days }));
  } catch (e) { /* 存不下不影响任何功能 */ }
}

// 老数据自动淘汰：只留最近 KEEP_DAYS 天
function trim() {
  const keys = Object.keys(days).sort();
  if (keys.length <= KEEP_DAYS) return;
  keys.slice(0, keys.length - KEEP_DAYS).forEach(k => { delete days[k]; });
}

/** 累加一段时长（ms），返回当天累计 ms */
export function addMs(ms) {
  const n = Math.max(0, Math.floor(Number(ms) || 0));
  if (!n) return todayMs();
  const k = dayKey();
  read();
  days[k] = (Number(days[k]) || 0) + n;
  trim();
  persist();
  return days[k];
}

/** 把"进入前台到现在"这段结算掉（前台每 30s 调一次，切后台/退出也调） */
export function flush() {
  if (!enterAt) return todayMs();
  const now = Date.now();
  const span = now - enterAt;
  enterAt = now;
  if (span <= 0) return todayMs();
  if (span > MAX_SPAN) return todayMs();   // 异常跨度：宁可不记，也别记成几十小时
  return addMs(span);
}

function stopTimer() {
  if (timer) { clearInterval(timer); timer = 0; }
}

/** 进入前台（App.vue onShow） */
export function start() {
  read();
  // 保险：某些端 onShow 会连着来两次而中间没有 onHide。
  // 先结掉上一段（没在计时则 flush 直接返回），再重新起表 —— 否则中间那截会被吞掉。
  flush();
  enterAt = Date.now();
  stopTimer();
  // 前台期间定时落盘：onHide 没来（直接杀进程）时最多丢 30s
  timer = setInterval(() => { flush(); }, FLUSH_MS);
}

/**
 * 离开前台（App.vue onHide）：结算 + 停表。
 * 必须把 enterAt 归零 —— 首页小组件也会调 flush() 自刷，
 * 留着时间戳的话，切后台之后那段时间会被当成"在前台"继续累加。
 */
export function stop() {
  flush();
  enterAt = 0;
  stopTimer();
}

export function todayMs() {
  read();
  return Number(days[dayKey()]) || 0;
}

export function todayMinutes() {
  return Math.floor(todayMs() / 60000);
}

/** 最近 n 天（含今天）每天的分钟数，按时间升序 */
export function recentMinutes(n) {
  const count = Math.max(1, Number(n) || 7);
  const out = [];
  const base = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86400000);
    out.push(Math.floor((Number(read()[dayKey(d)]) || 0) / 60000));
  }
  return out;
}

/**
 * 日均分钟：只按"真的有记录的天"平均。
 * 除以 7 会让刚装上的人看到"日均 1 分钟"（今天 5 分钟 ÷ 7），那是误导；
 * 除以活跃天数才是"我一般一次用多久"。
 */
export function avgMinutes(n) {
  const list = recentMinutes(n).filter(m => m > 0);
  if (!list.length) return 0;
  return Math.floor(list.reduce((a, b) => a + b, 0) / list.length);
}

/** 近 n 天累计分钟 */
export function totalMinutes(n) {
  return recentMinutes(n).reduce((a, b) => a + b, 0);
}

/** 清空（仅供调试 / 以后可能的"清除数据"） */
export function clear() {
  days = {};
  loaded = true;
  persist();
}

/** 原始数据（调试 / 校验脚本用） */
export function raw() {
  return read();
}
