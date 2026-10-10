// utils/checkin.js - 打卡走势：把每天的练习量折算成一条「学习指数」曲线
//
// 读法与股票分时图完全一致：
//   · 纵轴 = 学习指数（基点 100）
//   · 当天背了 → 按当天练习量上涨（练得越多涨得越猛）
//   · 当天没背 → 按遗忘系数回落（跌）
//   · 虚线 = 基准线（区间首日指数），线在上方即"跑赢基准"
//   · 红涨绿跌（A 股习惯，与本项目区域约定一致）
//
// 纯计算 + 纯几何映射，不依赖任何图表库，也不碰 DOM，方便单测。
// 折线的"画线"交给页面用 view 旋转实现（uni-app 各端都没有可用的内联 SVG / Canvas 保证）。

import * as engine from './engine.js';

// ---------- 指数参数 ----------
export const BASE = 100;        // 指数基点
export const DECAY = 6;         // 未打卡当天的回落幅度（遗忘惩罚）
export const GAIN_CAP = 24;     // 单日涨幅上限，避免一次刷很多题把曲线拉爆
export const RANGES = [7, 30];  // 可选区间（天）

// SVG 画布坐标系（只用于算比例，最终按容器等比缩放）
const VW = 660;
const VH = 200;
const PAD = { l: 8, r: 8, t: 18, b: 24 };

/** 容器高宽比：padding-bottom 用这个百分比锁死比例，保证旋转角度算得准 */
export const RATIO = Math.round((VH / VW) * 100000) / 1000;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function dateKey(d) {
  return engine.dateStr ? engine.dateStr(d) : '';
}

/**
 * 近 n 天的打卡序列（正序：最早在前）。
 * 返回 { days, first, last, change, changePct, up, checked, totalDone, todayTotal, empty }
 */
export function series(n) {
  const days = Math.round(clamp(Number(n) || 30, 2, 90));
  const his = engine.history ? engine.history() : [];
  const map = {};
  (his || []).forEach(r => {
    if (r && r.date) map[r.date] = r.total || 0;
  });

  const todayKey = dateKey();
  const list = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    const total = map[key] || 0;
    list.push({
      date: key,
      total: total,
      isToday: key === todayKey,
      label: (d.getMonth() + 1) + '/' + pad2(d.getDate())
    });
  }

  // 累积成指数：有背 → +练习量；没背 → -遗忘惩罚
  let v = BASE;
  let checked = 0;
  let totalDone = 0;
  list.forEach(day => {
    if (day.total > 0) {
      v += Math.min(day.total, GAIN_CAP);
      checked++;
      totalDone += day.total;
    } else {
      v -= DECAY;
    }
    day.value = v;
  });

  // 涨跌：与"前一天"比；首日无前值 → 记为平，随后沿用上一次方向，保证折线颜色连续
  let prev = null;
  let lastDir = true;
  list.forEach(day => {
    if (prev == null) {
      day.up = lastDir;
    } else if (day.value > prev) {
      day.up = true;
      lastDir = true;
    } else if (day.value < prev) {
      day.up = false;
      lastDir = false;
    } else {
      day.up = lastDir;
    }
    prev = day.value;
  });

  const first = list.length ? list[0].value : BASE;
  const last = list.length ? list[list.length - 1].value : BASE;
  const change = last - first;

  return {
    days: list,
    first: first,
    last: last,
    hi: list.length ? Math.max.apply(null, vals0(list)) : BASE,
    lo: list.length ? Math.min.apply(null, vals0(list)) : BASE,
    change: change,
    changePct: first ? (change / first) * 100 : 0,
    up: change > 0 ? true : (change < 0 ? false : null),
    checked: checked,
    totalDone: totalDone,
    todayTotal: (list.length && list[list.length - 1].total) || 0,
    streak: engine.streak ? engine.streak() : 0,
    // 一条练习记录都没有 → 页面显示空态引导，而不是画一条一路向下的直线
    empty: !his.length
  };
}

function vals0(list) {
  return list.map(d => d.value);
}

/**
 * 几何映射：把序列折算成"相对绘图盒"的百分比坐标。
 * x/y ∈ [0,100]，可直接写进 :style 的 left/top 百分比。
 * baseY = 基准线（首日指数）所在位置。
 */
export function geometry(s) {
  const days = (s && s.days) || [];
  if (!days.length) return { pts: [], baseY: 50, lo: 0, hi: 0 };

  const vals = days.map(d => d.value);
  let mn = Math.min.apply(null, vals);
  let mx = Math.max.apply(null, vals);
  if (!(mx > mn)) { mn -= 1; mx += 1; }        // 全平也要撑开一点，避免压成一条线
  const padY = (mx - mn) * 0.14;
  const lo = mn - padY;
  const hi = mx + padY;
  const span = hi - lo || 1;

  const iw = VW - PAD.l - PAD.r;
  const ih = VH - PAD.t - PAD.b;
  const n = days.length;

  const pts = days.map((d, i) => ({
    x: ((PAD.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)) / VW) * 100,
    y: ((PAD.t + (1 - (d.value - lo) / span) * ih) / VH) * 100,
    up: d.up,
    total: d.total,
    date: d.date,
    isToday: d.isToday,
    label: d.label
  }));

  const baseY = ((PAD.t + (1 - (s.first - lo) / span) * ih) / VH) * 100;
  return { pts: pts, baseY: baseY, lo: lo, hi: hi };
}

/**
 * 折线段：给定相邻两点与容器高宽比，算出长度(%) 与旋转角(deg)。
 *
 * 单位统一到"容器宽的百分比"：x 本来就是这个单位；y 是"容器高的百分比"，
 * 乘上高宽比 r 才换算过来。因为容器用 padding-bottom 锁死了比例，r 恒定，
 * 所以角度和长度都能在渲染前算准（不需要等 DOM 测量）。
 */
export function segments(pts, ratio) {
  const r = Number(ratio) || RATIO / 100;
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = (b.y - a.y) * r;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    out.push({
      x: a.x, y: a.y,
      w: len,
      // 角度保留 2 位小数，避免 style 字符串过长
      ang: Math.round(ang * 100) / 100,
      up: b.up
    });
  }
  return out;
}

/** 涨跌文案（模板里不能直接调 toFixed） */
export function formatChange(s) {
  const c = (s && s.change) || 0;
  const pct = (s && s.changePct) || 0;
  const sign = c > 0 ? '+' : (c < 0 ? '-' : '');
  const psign = pct > 0 ? '+' : (pct < 0 ? '-' : '');
  return {
    value: (s ? s.last : BASE).toFixed(1),
    change: sign + Math.abs(c).toFixed(1),
    pct: psign + Math.abs(pct).toFixed(1) + '%',
    text: sign + Math.abs(c).toFixed(1) + '  ' + psign + Math.abs(pct).toFixed(1) + '%'
  };
}

export { VW, VH, PAD };
