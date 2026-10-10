// utils/api-usage.js - API 用量统计：调用次数 + token 估算
//
// 只做计数，不参与任何业务逻辑：记了什么、花多少，全存在本机独立 key 里，
// 和学习进度、AI 缓存、停留时长都不相干。清缓存、清进度都不会影响它。
//
// 落盘用节流：答题时一分钟内可能打十几次接口，没必要每次都序列化一遍。
// 杀进程最多丢最后一两秒的计数 —— 这种统计丢一点无所谓。

const KEY = 'fj_api_usage_v1';
const KEEP_DAYS = 62;     // 留两个月：够对比"这个月 vs 上个月"
const WRITE_GAP = 2000;   // 节流窗口

let days = null;
let dirty = false;
let timer = 0;

function pad(n) { return n < 10 ? '0' + n : String(n); }

export function dayKey(d) {
  const x = d || new Date();
  return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
}

export function monthKey(d) {
  const x = d || new Date();
  return x.getFullYear() + '-' + pad(x.getMonth() + 1);
}

function blank() {
  return { calls: 0, inTok: 0, outTok: 0, llm: 0, tts: 0, image: 0, fail: 0 };
}

function read() {
  if (days) return days;
  days = {};
  try {
    const raw = uni.getStorageSync(KEY);
    const o = raw ? JSON.parse(raw) : null;
    if (o && o.days && typeof o.days === 'object') days = o.days;
  } catch (e) { days = {}; }
  return days;
}

function trim() {
  const keys = Object.keys(days).sort();
  if (keys.length <= KEEP_DAYS) return;
  keys.slice(0, keys.length - KEEP_DAYS).forEach(k => { delete days[k]; });
}

function writeNow() {
  if (!dirty) return;
  dirty = false;
  try { uni.setStorageSync(KEY, JSON.stringify({ v: 1, days: days })); } catch (e) {}
}

export function flush() {
  if (timer) { clearTimeout(timer); timer = 0; }
  writeNow();
}

function schedule() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => { timer = 0; writeNow(); }, WRITE_GAP);
}

/**
 * 记一次调用
 * @param {string} kind 'llm' | 'tts' | 'image'
 * @param {number} [tokensIn] 输入 token（没有就用字符数估）
 * @param {number} [tokensOut] 输出 token
 */
export function record(kind, tokensIn, tokensOut) {
  const k = dayKey();
  const d = read();
  const cur = d[k] || (d[k] = blank());
  cur.calls++;
  cur.inTok += Math.max(0, Math.round(Number(tokensIn) || 0));
  cur.outTok += Math.max(0, Math.round(Number(tokensOut) || 0));
  if (kind === 'tts') cur.tts++;
  else if (kind === 'image') cur.image++;
  else cur.llm++;
  trim();
  schedule();
  return cur;
}

/** 记一次失败（不含 token，只记次数，用来看"是不是一直在白试"） */
export function recordFailure() {
  const k = dayKey();
  const d = read();
  const cur = d[k] || (d[k] = blank());
  cur.fail++;
  schedule();
  return cur;
}

/** 粗估 token：中英混排取 ~2.2 字符 1 token，够看量级 */
export function estimateTokens(text) {
  const s = String(text == null ? '' : text);
  if (!s) return 0;
  return Math.max(1, Math.round(s.length / 2.2));
}

/** 一段 messages 的 token 估算 */
export function estimateMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let n = 0;
  list.forEach(m => { n += estimateTokens(m && m.content); });
  return n;
}

export function today() {
  return read()[dayKey()] || blank();
}

export function monthTotal(ym) {
  const prefix = ym || monthKey();
  const out = blank();
  const d = read();
  Object.keys(d).forEach(k => {
    if (k.slice(0, 7) !== prefix) return;
    const x = d[k];
    out.calls += x.calls || 0;
    out.inTok += x.inTok || 0;
    out.outTok += x.outTok || 0;
    out.llm += x.llm || 0;
    out.tts += x.tts || 0;
    out.image += x.image || 0;
    out.fail += x.fail || 0;
  });
  return out;
}

function prevMonth(ym) {
  const p = String(ym || monthKey()).split('-');
  let y = Number(p[0]);
  let m = Number(p[1]) - 1;
  if (m < 1) { m = 12; y--; }
  return y + '-' + pad(m);
}

export function summary() {
  const cur = monthTotal(monthKey());
  const last = monthTotal(prevMonth(monthKey()));
  return { today: today(), month: cur, lastMonth: last };
}

/**
 * 给设置页看的一行字。
 * token 只统计文本接口 —— 语音按字符计费、出图按张计费，
 * 混进同一个数字里反而看不出钱花在哪，所以分开报。
 */
export function brief() {
  const s = summary();
  if (!s.month.calls) return '本月还没有调用';
  const parts = [];
  if (s.month.llm) parts.push('文本 ' + s.month.llm);
  if (s.month.tts) parts.push('语音 ' + s.month.tts);
  if (s.month.image) parts.push('出图 ' + s.month.image);
  return '本月 ' + s.month.calls + ' 次（' + (parts.join(' / ') || '—') + '）' +
    (s.month.llm ? ' · 约 ' + fmtTok(s.month.inTok + s.month.outTok) + ' tokens' : '') +
    (s.month.fail ? ' · 失败 ' + s.month.fail + ' 次' : '');
}

export function fmtTok(n) {
  const x = Number(n) || 0;
  if (x < 1000) return String(x);
  if (x < 1000000) return (x / 1000).toFixed(x < 10000 ? 1 : 0) + 'k';
  return (x / 1000000).toFixed(1) + 'M';
}

export function clear() {
  days = {};
  dirty = true;
  flush();
}

/** 原始数据（调试 / 校验脚本用） */
export function raw() {
  return read();
}
