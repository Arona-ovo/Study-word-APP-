// utils/engine.js - 自适应学习引擎
// 核心机制：
// 1) 每个单词维护掌握度 m（0-5）：答对 +1，答错 -2，半对不变。
// 2) 抽题权重随掌握度衰减（WEIGHT），熟练词逐步减少出现直至接近淘汰。
// 3) 用户等级由已掌握词数决定（1-4），等级决定可选句子的最高难度与新词比例，
//    从而实现"以熟词为主、少量新词为辅，逐级递进"的难度曲线。
import { WORDS } from '../data/words.mjs';
import { SENTENCES } from '../data/sentences.mjs';
import * as store from './store.mjs';
import * as sentenceIndex from './sentence-index.mjs';

const WEIGHT = [6, 5, 4, 2.5, 1, 0.15]; // m=0..5 的出题权重
const LEVEL_NAMES = ['入门', '基础', '进阶', '冲刺'];

// ---------- 基础工具 ----------
function dateStr(d) {
  d = d || new Date();
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function masteryOf(wordId) {
  const rec = store.get().mastery[wordId];
  return rec ? rec.m : 0;
}

// ---------- 用户等级（难度递进） ----------
// 阈值按词库总量比例计算（64 词时代的 10/25/45 在 640 词下会失效）
function userLevel() {
  const st = store.get();
  let mastered = 0;
  WORDS.forEach(w => {
    const rec = st.mastery[w.id];
    if (rec && rec.m >= 4) mastered++;
  });
  const t = WORDS.length || 640;
  if (mastered >= t * 0.55) return 4;
  if (mastered >= t * 0.3) return 3;
  if (mastered >= t * 0.12) return 2;
  return 1;
}

// ---------- 题目构造 ----------
function buildQuestion(sen, dir) {
  const isE2C = dir === 'e2c';
  const answer = isE2C ? sen.zh : sen.en;
  // 干扰项：优先取相邻难度句子的译文（走索引，避免全表扫描）
  let pool = sentenceIndex.neighbours(sen.lv).filter(x => x.id !== sen.id);
  if (pool.length < 3) pool = SENTENCES.filter(x => x.id !== sen.id);
  const distractors = shuffle(pool).slice(0, 3).map(x => (isE2C ? x.zh : x.en));
  const options = shuffle([answer].concat(distractors));
  return {
    sid: sen.id,
    dir: dir,
    prompt: isE2C ? sen.en : sen.zh,
    answer: answer,
    options: options,
    answerIndex: options.indexOf(answer),
    lv: sen.lv,
    note: sen.note || '',
    words: sen.w.map(id => WORDS.find(w => w.id === id)).filter(Boolean)
  };
}

// 句子得分：熟词占比越高、含未掌握词越多（但不超出新词上限），越优先
function sentenceScore(sen, maxNew) {
  const ms = sen.w.map(masteryOf);
  const total = sen.w.length || 1;
  const known = ms.filter(m => m >= 2).length;
  const newCount = ms.filter(m => m === 0).length;
  const avgWeight = ms.reduce((a, b) => a + WEIGHT[b], 0) / total;
  const knownRatio = known / total;
  // 熟词为主：熟词占比不足一半时降权，保证可理解性
  const familiarity = knownRatio >= 0.5 ? 1 : 0.45;
  // 新词比例控制：超出当前等级允许的新词数则指数级惩罚
  const newPenalty = Math.pow(0.4, Math.max(0, newCount - maxNew));
  // 难度贴合：句子等级略加分，推动逐级爬坡
  const levelBonus = 1 + 0.08 * sen.lv;
  return avgWeight * familiarity * newPenalty * levelBonus;
}

// 每日练习抽题：n 道，方向随机
function dailyQuestions(n) {
  const lv = userLevel();
  const st = store.get();
  const seenCount = Object.keys(st.mastery).length;
  // 冷启动阶段放宽新词限制；之后随等级收紧（Lv1 每句至多1个新词 … Lv4 至多3个）
  const maxNew = seenCount < 20 ? 3 : Math.min(3, lv);
  const lvCap = Math.min(4, lv + 1); // 允许接触比当前等级高一档的句子，形成坡度

  // 按难度档从索引取候选（避免对全部例句做 filter）
  const raw = [];
  for (let l = 1; l <= lvCap; l++) raw.push.apply(raw, sentenceIndex.byLevel(l));
  const candidates = raw
    .map(s => ({ s, sc: sentenceScore(s, maxNew) }))
    .filter(x => x.sc > 0);

  // 按权重随机抽样（不放回）
  const picked = [];
  const pool = candidates.slice();
  while (picked.length < n && pool.length) {
    const totalSc = pool.reduce((a, x) => a + x.sc, 0);
    let r = Math.random() * totalSc;
    let i = 0;
    for (; i < pool.length; i++) {
      r -= pool[i].sc;
      if (r <= 0) break;
    }
    i = Math.min(i, pool.length - 1);
    picked.push(pool[i].s);
    pool.splice(i, 1);
  }
  return picked.map(s => buildQuestion(s, Math.random() < 0.5 ? 'e2c' : 'c2e'));
}

// 错题重练
function reviewQuestions() {
  const st = store.get();
  const seen = {};
  const list = [];
  for (let i = 0; i < st.wrong.length && list.length < 20; i++) {
    const item = st.wrong[i];
    if (seen[item.sid]) continue;
    seen[item.sid] = true;
    const sen = SENTENCES.find(s => s.id === item.sid);
    if (sen) list.push(buildQuestion(sen, item.dir));
  }
  return list;
}

// ---------- 答题记录（掌握度更新 + 错题本 + 每日统计） ----------
// status: 'pass' 全对 | 'partial' 半对（仅输入模式）| 'fail' 错误
function recordAnswer(q, status, mode, userAnswer) {
  const st = store.get();
  const pass = status === 'pass';

  q.words.forEach(w => {
    const rec = st.mastery[w.id] || { m: 0, seen: 0, correct: 0 };
    rec.seen++;
    if (pass) {
      rec.correct++;
      rec.m = Math.min(5, rec.m + 1);
    } else if (status === 'fail') {
      rec.m = Math.max(0, rec.m - 2);
    }
    st.mastery[w.id] = rec;
  });

  const d = dateStr();
  st.days[d] = st.days[d] || { total: 0, correct: 0 };
  st.days[d].total++;
  if (pass) st.days[d].correct++;

  if (status === 'fail') {
    st.wrong = st.wrong.filter(x => !(x.sid === q.sid && x.dir === q.dir));
    st.wrong.unshift({ sid: q.sid, dir: q.dir, answer: userAnswer || '', mode: mode, ts: Date.now() });
    if (st.wrong.length > 200) st.wrong.length = 200;
  } else if (pass) {
    // 答对（含错题重练答对）即移出错题本
    st.wrong = st.wrong.filter(x => !(x.sid === q.sid && x.dir === q.dir));
  }

  store.save(st);
}

// ---------- 各页面数据聚合 ----------
function overview() {
  const st = store.get();
  const lv = userLevel();
  const today = st.days[dateStr()] || { total: 0, correct: 0 };
  let mastered = 0;
  WORDS.forEach(w => {
    const rec = st.mastery[w.id];
    if (rec && rec.m >= 4) mastered++;
  });
  return {
    level: lv,
    levelName: LEVEL_NAMES[lv - 1],
    today: today,
    todayPct: Math.min(100, Math.round((today.total / 10) * 100)),
    streak: streak(),
    mastered: mastered,
    total: WORDS.length,
    wrongCount: st.wrong.length
  };
}

function streak() {
  const st = store.get();
  let n = 0;
  const d = new Date();
  for (let i = 0; i < 365; i++) {
    const rec = st.days[dateStr(d)];
    if (rec && rec.total > 0) {
      n++;
      d.setDate(d.getDate() - 1);
    } else if (i === 0) {
      d.setDate(d.getDate() - 1); // 今天还没练，不断签
    } else {
      break;
    }
  }
  return n;
}

function wrongList() {
  const st = store.get();
  return st.wrong.map(item => {
    const sen = SENTENCES.find(s => s.id === item.sid);
    if (!sen) return null;
    const t = new Date(item.ts);
    const p = n => (n < 10 ? '0' : '') + n;
    return {
      sid: item.sid,
      dir: item.dir,
      prompt: item.dir === 'e2c' ? sen.en : sen.zh,
      answer: item.dir === 'e2c' ? sen.zh : sen.en,
      userAnswer: item.answer,
      timeStr: (t.getMonth() + 1) + '月' + t.getDate() + '日 ' + p(t.getHours()) + ':' + p(t.getMinutes())
    };
  }).filter(Boolean);
}

function vocabList(filter) {
  const st = store.get();
  const counts = { new: 0, learning: 0, familiar: 0, mastered: 0 };
  const list = WORDS.map(w => {
    const rec = st.mastery[w.id];
    const m = rec ? rec.m : 0;
    let status = 'new', statusName = '新词';
    if (rec) {
      if (m >= 4) { status = 'mastered'; statusName = '已掌握'; }
      else if (m === 3) { status = 'familiar'; statusName = '熟悉'; }
      else { status = 'learning'; statusName = '学习中'; }
    }
    counts[status]++;
    return {
      id: w.id, w: w.w, pos: w.pos, m: w.m, lv: w.lv,
      mastery: m, pct: (m / 5) * 100,
      status: status, statusName: statusName,
      seen: rec ? rec.seen : 0,
      correct: rec ? rec.correct : 0
    };
  });
  return {
    counts: counts,
    list: filter && filter !== 'all' ? list.filter(x => x.status === filter) : list
  };
}

function stats() {
  const st = store.get();
  let total = 0, correct = 0;
  Object.keys(st.days).forEach(d => {
    total += st.days[d].total;
    correct += st.days[d].correct;
  });
  const v = vocabList('all');

  // 近 7 天练习量
  const days = [];
  const d = new Date();
  for (let i = 6; i >= 0; i--) {
    const dd = new Date(d);
    dd.setDate(d.getDate() - i);
    const rec = st.days[dateStr(dd)] || { total: 0, correct: 0 };
    days.push({ label: (dd.getMonth() + 1) + '/' + dd.getDate(), total: rec.total, correct: rec.correct });
  }
  const maxTotal = Math.max(1, ...days.map(x => x.total));
  days.forEach(x => { x.h = Math.round((x.total / maxTotal) * 100); });

  const lv = userLevel();
  return {
    total: total,
    correct: correct,
    accuracy: total ? Math.round((correct / total) * 100) : 0,
    streak: streak(),
    level: lv,
    levelName: LEVEL_NAMES[lv - 1],
    counts: v.counts,
    wordTotal: WORDS.length,
    days: days
  };
}

function resetAll() {
  store.reset();
}

export {
  dailyQuestions, reviewQuestions, recordAnswer,
  overview, wrongList, vocabList, stats, userLevel, resetAll,
  streak, dateStr
}
