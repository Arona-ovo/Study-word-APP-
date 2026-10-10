// utils/judge.js - 手动输入模式的自动判分
// 纯本地实现，无需后端/AI：
// - 汉译英：关键词覆盖率（55%）+ 与参考答案的编辑距离相似度（45%）
// - 英译汉：参考答案中文 n-gram 覆盖率
// 评分 >= 通过线为全对，>= 半对线为"基本正确"（不进错题本、掌握度不变），其余判错。

const STOPWORDS = ['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'is', 'are', 'was', 'were', 'be', 'we', 'you', 'he', 'she', 'it', 'they', 'our', 'your', 'his', 'her', 'their', 'my'];

function normEn(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = [];
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

// 汉译英判分
function judgeEn(input, reference) {
  const a = normEn(input);
  const b = normEn(reference);
  if (!a) return { score: 0, pass: false, partial: false };

  // 1) 关键词覆盖率：参考答案中的实词，有多少出现在用户答案里
  const keywords = b.split(' ').filter(w => w.length > 2 && STOPWORDS.indexOf(w) < 0);
  let hit = 0;
  const userWords = a.split(' ');
  keywords.forEach(k => {
    // 允许简单词形变化：子串匹配（如 improve / improving）
    if (userWords.some(u => u.indexOf(k.slice(0, Math.max(3, k.length - 2))) === 0 || k.indexOf(u) === 0)) hit++;
  });
  const coverage = keywords.length ? hit / keywords.length : 1;

  // 2) 整句编辑距离相似度
  const dist = levenshtein(a, b);
  const sim = 1 - dist / Math.max(a.length, b.length, 1);

  const score = 0.55 * coverage + 0.45 * Math.max(0, sim);
  return {
    score: Math.min(1, score),
    pass: score >= 0.82,
    partial: score >= 0.6
  };
}

// 英译汉判分：参考答案的二字/三字片段覆盖率
function judgeZh(input, reference) {
  const clean = s => (s || '').replace(/[\s，。！？、；：“”‘’.,!?;:'"()（）]/g, '');
  const a = clean(input);
  const b = clean(reference);
  if (!a) return { score: 0, pass: false, partial: false };

  const grams = [];
  for (let size = 2; size <= 3; size++) {
    for (let i = 0; i + size <= b.length; i++) grams.push(b.substr(i, size));
  }
  if (!grams.length) grams.push(b);

  let hit = 0;
  const used = {};
  grams.forEach(g => {
    if (!used[g] && a.indexOf(g) >= 0) {
      hit++;
      used[g] = true;
    }
  });
  const score = hit / grams.length;
  return {
    score: score,
    pass: score >= 0.75,
    partial: score >= 0.55
  };
}

module.exports = { judgeEn, judgeZh };
