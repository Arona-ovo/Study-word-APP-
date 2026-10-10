// _tools/check-wrong-detail.js - 校验「错题 → 错题详情页」这条链路（只读）
// 核心断言：
//   - engine.wrongDetail(sid, dir) 能唯一定位一条错题，字段方向正确（英译汉/汉译英）
//   - 答对后置移出错题本 → 查不到；查不到要有空态文案
//   - 错题页卡片可点进详情，只传 sid + dir（长文本不进 URL）
//   - 页面已注册，英文词典补齐新文案
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./lib/load');

const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(actual, expect, label) {
  if (actual === expect) ok(label + ' = ' + expect);
  else bad(label + ' 期望 ' + expect + '，实际 ' + actual);
}
function assert(cond, label) { if (cond) ok(label); else bad(label); }
function group(name) { console.log('\n[' + name + ']'); }

const readFile = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---------- 装载真实模块 ----------
const lemma = load('utils/lemma.js');
const words = load('data/words.js');
const sentences = load('data/sentences.js');
const common = load('data/common-words.js');
const wb = load('data/wordbooks.js', { WORDS: words.WORDS });
const store = load('utils/store.js');
const sentenceIndex = load('utils/sentence-index.js', {
  SENTENCES: sentences.SENTENCES, WORDS: words.WORDS, lemmaCandidates: lemma.lemmaCandidates
});
const engine = load('utils/engine.js', {
  WORDS: words.WORDS, SENTENCES: sentences.SENTENCES, store, sentenceIndex
});
const dict = load('utils/dict.js', {
  WORDS: words.WORDS, COMMON_RAW: common.COMMON_RAW, store,
  lemmaCandidates: lemma.lemmaCandidates, lemma: lemma.lemma
});
// 详情页自己用的 helper（dict / voice / tokenize）必须存在，否则页面跑不起来
const tokenizeMod = load('utils/tokenize.js');

const reviewSrc = readFile('pages/review/review.vue');
const detailSrc = readFile('pkgStudy/pages/wrong-detail/wrong-detail.vue');
const pagesJson = readFile('pages.json');
const enSrc = readFile('utils/i18n-en.js');

// ---------- 1. engine.wrongDetail 基本语义 ----------
group('1. wrongDetail 定位与字段');
assert(typeof engine.wrongDetail === 'function', 'engine 导出 wrongDetail');
eq(engine.wrongDetail('nope', 'e2c'), null, '查不到的 sid 返回 null');

const q = engine.dailyQuestions(1)[0];
assert(!!q, '能抽到一道题用于造错题');
engine.recordAnswer(q, 'fail', 'choice', '我答的句子');
const item = engine.wrongDetail(q.sid, q.dir);
assert(!!item, '答错后能查到这条错题');
eq(item.sid, q.sid, 'sid 一致');
eq(item.dir, q.dir, 'dir 一致');
eq(item.mode, 'choice', '答题方式原样带回');
eq(item.userAnswer, '我答的句子', '你的答案原样带回');
assert(/^\d{1,2}月\d{1,2}日 \d{2}:\d{2}$/.test(item.timeStr), '时间是「月日 时:分」格式（' + item.timeStr + '）');

// ---------- 2. 方向：哪边是 prompt、哪边是 answer ----------
group('2. 方向');
// 造指定方向的题目：换 dir 时必须把 prompt / answer 一起翻过来，
// 否则等于造了一条"自相矛盾"的假记录（真实的 buildQuestion 不会这样）
function flipDir(q, dir) {
  if (q.dir === dir) return q;
  return Object.assign({}, q, { dir: dir, prompt: q.answer, answer: q.prompt });
}
const qE = engine.dailyQuestions(1)[0];
const e2c = flipDir(qE, 'e2c');
const c2e = flipDir(qE, 'c2e');
engine.recordAnswer(c2e, 'fail', 'input', 'my wrong answer');
const dc2e = engine.wrongDetail(qE.sid, 'c2e');
assert(!!dc2e, '汉译英记录可查');
assert(/[\u4e00-\u9fff]/.test(dc2e.prompt), '汉译英：题目是中文');
assert(!/[\u4e00-\u9fff]/.test(dc2e.answer), '汉译英：参考答案是英文');
assert(!/[\u4e00-\u9fff]/.test(dc2e.en), 'en 字段始终是英文原文');
assert(/[\u4e00-\u9fff]/.test(dc2e.zh), 'zh 字段始终是中文译文');

engine.recordAnswer(e2c, 'fail', 'choice', '不对的译文');
const de2c = engine.wrongDetail(qE.sid, 'e2c');
assert(!!de2c, '英译汉记录可查');
assert(!/[\u4e00-\u9fff]/.test(de2c.prompt), '英译汉：题目是英文');
assert(/[\u4e00-\u9fff]/.test(de2c.answer), '英译汉：参考答案是中文');
assert(!/[\u4e00-\u9fff]/.test(de2c.en), 'en 字段始终是英文原文');
assert(/[\u4e00-\u9fff]/.test(de2c.zh), 'zh 字段始终是中文译文');
eq(de2c.mode, 'choice', 'mode 原样带回');

// 同一句子两个方向互不覆盖
assert(!!engine.wrongDetail(qE.sid, 'c2e') && !!engine.wrongDetail(qE.sid, 'e2c'),
  '同一句子的英译汉 / 汉译英各自独立');

// ---------- 3. 答对后自动移出 → 详情页要有空态 ----------
group('3. 答对后移出');
assert(!!engine.wrongDetail(q.sid, q.dir), '答错后一直留在错题本里');
engine.recordAnswer(q, 'pass', 'choice', '');
eq(engine.wrongDetail(q.sid, q.dir), null, '答对后错题被移出，查不到');
assert(detailSrc.indexOf("v-if=\"!d\"") >= 0 && detailSrc.indexOf('该错题已不存在或已移出错题本') >= 0,
  '查不到时页面显示空态文案');

// ---------- 4. 错题页 → 详情页的入口与传参 ----------
group('4. 入口与传参');
assert(/v-for="item in list"[\s\S]{0,200}@tap="openDetail\(item\)"/.test(reviewSrc), '错题卡片可点');
assert(/openDetail\(item\)[\s\S]{0,300}encodeURIComponent\(item\.sid\)/.test(reviewSrc), 'sid 走 URL 编码');
assert(/\/pages\/wrong-detail\/wrong-detail\?sid=/.test(reviewSrc), '跳转目标是错题详情页');
assert(!/wrong-detail\?[^'"]*prompt=/.test(reviewSrc), '长文本不进 URL 传参');
assert(/wrongList\(\)/.test(reviewSrc), '列表仍有 sid / dir（来自 wrongList）');

// ---------- 5. 页面注册与依赖 ----------
group('5. 页面注册与依赖');
assert(/pages\/wrong-detail\/wrong-detail/.test(pagesJson), 'pages.json 已注册详情页');
assert(/"navigationStyle": "custom"/.test(readFile('pkgStudy/pages/wrong-detail/wrong-detail.vue'))
  || /pages\/wrong-detail[\s\S]{0,120}navigationStyle/.test(pagesJson), '详情页走自定义导航');
assert(/engine\.wrongDetail\(/.test(detailSrc), '详情页自己回 engine 查记录');
assert(/from '\.\.\/(?:\.\.\/)+utils\/tokenize'/.test(detailSrc) && typeof tokenizeMod.tokenize === 'function',
  'tokenize 可用（逐词点读）');
assert(typeof dict.lookup === 'function' && typeof dict.SRC_LABEL === 'object', 'dict.lookup / SRC_LABEL 可用');

// ---------- 6. 页面实现红线 ----------
group('6. 实现约束');
assert(detailSrc.indexOf('v-html') < 0, '没有原始 HTML 注入');
assert(!/\bnew Function\b/.test(detailSrc) && !/\beval\(/.test(detailSrc), '没有函数构造 / 动态求值');
// 局部变量不能遮蔽 i18n 的 t（踩过：const t = ... 会让 t() 报错）
const shadow = /const\s+t\s*=/.test(detailSrc);
assert(!shadow, '没有遮蔽 i18n 的 t 变量');
assert(/onHide\(\)[\s\S]{0,80}stopAll|onUnload\(\)[\s\S]{0,80}stopAll/.test(detailSrc), '离页停止发音');
// 所有事件绑定的方法都要真实存在
const handlers = Array.from(detailSrc.matchAll(/@tap(?:\.stop)?="(\w+)"/g)).map(m => m[1]);
const uniq = Array.from(new Set(handlers));
const missing = uniq.filter(h => new RegExp('(^|\\n)\\s{4}' + h + '\\s*\\(').test(detailSrc) === false);
eq(missing.join(',') || '-', '-', '事件方法都已实现（' + uniq.join('/') + '）');

// ---------- 7. 英文词典 ----------
group('7. 英文词典');
['错题详情', '该错题已不存在或已移出错题本', '题目', '未填写', '朗读英文'].forEach(k => {
  assert(enSrc.indexOf("'" + k + "'") >= 0, 'EN 词典收录「' + k + '」');
});
// 页面里用到的所有中文 key 都要有英文条目
const keys = Array.from(detailSrc.matchAll(/\$t\('([^']+)'\)/g)).map(m => m[1]);
const noEn = Array.from(new Set(keys)).filter(k => enSrc.indexOf("'" + k + "'") < 0);
eq(noEn.join(',') || '-', '-', '页面中文文案都有英文对照');

// ---------- 8. 与既有页面一致 ----------
group('8. 与既有页面一致');
const sentSrc = readFile('pkgStudy/pages/sentence-detail/sentence-detail.vue');
assert(sentSrc.indexOf('pop-card') >= 0, '例句详情仍用同一套弹窗（样式来源 App.vue）');
assert(detailSrc.indexOf('pop-mask') >= 0 && detailSrc.indexOf('pop-card') >= 0,
  '本页沿用同样的点读弹窗结构');
assert(/border-bottom: 2rpx dashed/.test(detailSrc), '可点单词有虚线下划线提示');
assert(typeof engine.wrongList === 'function', 'wrongList 未被破坏（列表页仍在用）');

console.log('\n' + (fail === 0 ? '全部通过 ✓' : '失败 ' + fail + ' 项 ✗'));
process.exit(fail === 0 ? 0 : 1);
