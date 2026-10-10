// utils/srs.js - 词级间隔重复调度器（跨天巩固）
//
// ---------- 为什么要单独建这个模块 ----------
// 改它之前，"学会一个词"是这样判定的：同一场次里连对 2 次就算会了。
// 问题在于这 2 次前后只隔几十秒（隔两个词再回头），考的是**短时记忆** ——
// 隔天再问，大概率又不会了。次数从 2 提到 4 只是把同样的短时记忆多刷两遍，
// 治不了根。
//
// 认知科学里真正管用的是三件事，缺一不可：
//   ① 分散练习（spacing effect）：Cepeda 等 2006 年《Psychological Bulletin》
//      的元分析（317 个实验）确认，分散练习显著优于集中练习，而且
//      **要记多久，间隔就得有多长**（短间隔只适合短期应试）。
//   ② 间隔逐次拉长：Leitner 卡片盒 / SM-2 / Pimsleur 阶梯都是这个形状
//      （Pimsleur 给语言学习的阶梯是 5秒→25秒→2分→10分→1小时→5小时→
//        1天→5天→25天→4个月→2年）。
//   ③ 换提取方式：识别（recognition）< 回忆（recall）< 产出（production）。
//      这条由 word-session.js 的三种题型负责，不归本模块管。
//
// 本模块只负责 ①②：**这个词下一次该在什么时候回来**。
//
// ---------- 阶梯取值 ----------
// STEPS 是"完成第 n 次巩固后，再隔多少天来第 n+1 次"。
// 取 1 / 3 / 7 / 15 / 30 / 60 / 100 天：
//   · 首档 1 天：对齐不背单词"首次复习安排在学习完成后的 1~2 天"，也贴合
//     艾宾浩斯曲线最陡的那一段（不复习的话 24 小时内就忘掉大半）。
//   · 末档 100 天：对齐不背单词"复习间隔超过 100 天即判定已掌握、停止安排"。
//   · 中间按约 2 倍扩张，是通用词汇阶梯（1→3→7→15→30→60）的常见取法。
//
// ---------- 与既有掌握度 m 的分工 ----------
// m（0-5，iplus1 在写）是"这个词现在有多熟"，是**强度**；
// st/due（本模块）是"这个词下次什么时候该回来"，是**时间**。
// 两个维度不互相推导：m 高不代表不需要复习（不复习它就会掉回去），
// due 到了也不代表 m 一定低。别把它们合成一个字段。

// 完成第 n 次巩固后，再隔多少天来下一次（下标 = 已完成的巩固次数）
export const STEPS = [1, 3, 7, 15, 30, 60, 100];

// 毕业线：完成的巩固次数达到这个值，就不再主动安排复习
export const GRADUATED = STEPS.length;

// ---------- 日期工具（纯字符串运算，不依赖其它模块，方便单测） ----------
function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** 取 'YYYY-MM-DD'；传了 Date/字符串就用它，没传用今天 */
export function dateStr(d) {
  const x = d instanceof Date ? d : (d ? new Date(d) : new Date());
  return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
}

/** 日期加 n 天，返回 'YYYY-MM-DD'（n 可以是负数） */
export function addDays(s, n) {
  const p = String(s || '').split('-');
  const d = new Date(Number(p[0]) || 1970, (Number(p[1]) || 1) - 1, Number(p[2]) || 1);
  d.setDate(d.getDate() + (Number(n) || 0));
  return dateStr(d);
}

/**
 * 两个日期相差几天（b - a）。
 * 走 UTC 毫秒差而不是逐月算天数 —— 2 月、跨年、夏令时都交给 Date 处理。
 */
export function diffDays(a, b) {
  const pa = String(a || '').split('-');
  const pb = String(b || '').split('-');
  const da = Date.UTC(Number(pa[0]) || 1970, (Number(pa[1]) || 1) - 1, Number(pa[2]) || 1);
  const db = Date.UTC(Number(pb[0]) || 1970, (Number(pb[1]) || 1) - 1, Number(pb[2]) || 1);
  return Math.round((db - da) / 86400000);
}

// ---------- 调度 ----------

/**
 * 当场第一次学会（连过 3 关确认）→ 进入巩固队列。
 * 注意：当场**不**算第 1 次巩固。刚刷完就订明天才是间隔的起点；
 * 如果把当场算成第 1 次，首档间隔会被吃掉一档。
 */
export function learn(today) {
  return { st: 0, due: addDays(dateStr(today), STEPS[0]) };
}

/**
 * 巩固一次。
 *   ok=true  → 进一阶，间隔按阶梯拉长；走完阶梯就毕业（due 清空，不再安排）
 *   ok=false → 退回第 0 阶，明天重来，并记一次遗忘（Leitner：答错回第 1 格）
 * 返回的是**补丁**，调用方自己合并进掌握度记录（本模块不碰存储）。
 */
export function review(rec, ok, today) {
  const r = rec || {};
  const t = dateStr(today);
  const done = Math.max(0, Math.min(GRADUATED, Number(r.st) || 0));
  const lp = Math.max(0, Number(r.lp) || 0);
  if (!ok) {
    return { st: 0, due: addDays(t, STEPS[0]), lp: lp + 1 };
  }
  const st = Math.min(GRADUATED, done + 1);
  if (st >= GRADUATED) return { st: GRADUATED, due: '', lp: lp };
  return { st: st, due: addDays(t, STEPS[st]), lp: lp };
}

/** 毕业了吗（不再主动安排复习） */
export function graduated(rec) {
  return (Number((rec || {}).st) || 0) >= GRADUATED;
}

/** 到日子了吗：毕业的永远不到期；没写 due 的按"新词"处理，不算到期 */
export function isDue(rec, today) {
  const r = rec || {};
  if (graduated(r)) return false;
  const due = String(r.due || '');
  if (!due) return false;
  return diffDays(due, dateStr(today)) >= 0;
}

/** 距下次复习还有几天（负数 = 还没到期，正数 = 已逾期几天） */
export function overdueDays(rec, today) {
  const r = rec || {};
  const due = String(r.due || '');
  if (!due || graduated(r)) return 0;
  return diffDays(due, dateStr(today));
}

/** 下次复习日；毕业返回 '' */
export function nextDue(rec) {
  return graduated(rec) ? '' : String((rec || {}).due || '');
}

/** 在一份掌握度表里挑出到期的词 id（按逾期天数降序：欠得越久越靠前） */
export function dueIds(map, today) {
  const m = map || {};
  const t = dateStr(today);
  const out = Object.keys(m).filter(id => isDue(m[id], t));
  out.sort((a, b) => overdueDays(m[b], t) - overdueDays(m[a], t));
  return out;
}

/** 一份掌握度表里到期的词数 */
export function dueCount(map, today) {
  return dueIds(map, today).length;
}

/**
 * 巩固进度：已完成几次 / 总共几次，以及下一次隔多久。
 * 给界面用（"已巩固 2/7 · 下次 7 天后"）。
 */
export function stageText(rec) {
  const r = rec || {};
  const st = Math.max(0, Math.min(GRADUATED, Number(r.st) || 0));
  return {
    done: st,
    total: GRADUATED,
    graduated: st >= GRADUATED,
    nextGap: st >= GRADUATED ? 0 : STEPS[st]
  };
}
