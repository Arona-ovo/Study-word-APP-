// _tools/check-sentence-detail.js - 例句详情页（收藏 → 点读弹窗）校验（只读）
//
// 回归点：
//  1) 分词：单词/标点拆分可逆、弯撇号归一、连字符词不拆散、中文/空串不出单词片段
//  2) 分词结果与释义一一对应：每个单词片段查词后弹窗字段（词/音标/词性/释义/原形）一致
//  3) 发音链路：点词 = speakWord(speakForm)，整句 = speakSentence(onDone)，页面隐藏/卸载必 stop
//  4) 页面契约：只传收藏 id（长句不走 URL）、取消收藏回列表、pages.json 已注册
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load');

const ROOT = path.join(__dirname, '..', 'uniapp');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// mock uni 存储（store.js 用到）
const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

const lemma = load('utils/lemma.js');
const words = load('data/words.js');
const common = load('data/common-words.js');
const storeMod = load('utils/store.js');
const dict = load('utils/dict.js', {
  WORDS: words.WORDS,
  COMMON_RAW: common.COMMON_RAW,
  store: storeMod,
  lemmaCandidates: lemma.lemmaCandidates,
  lemma: lemma.lemma
});
const { tokenize, isEnglish } = load('utils/tokenize.js');

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function assert(cond, msg) { if (cond) ok(msg); else bad(msg); }
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}

console.log('== 1. 分词：拆分可逆 / 撇号归一 / 连字符不拆散 ==');
const SENT = 'I signed up for an online course to improve my spoken English.';
const toks = tokenize(SENT);
eq(toks.map(t => t.t).join(''), SENT, '片段拼回原句（无损）');
eq(toks.filter(t => t.w).length, 12, '单词片段数');
const contr = tokenize("Don’t stop—it's well-known.");
const words2 = contr.filter(t => t.w).map(t => t.t);
eq(words2[0], "Don't", '弯撇号归一为直撇号');
assert(words2.some(w => w === 'well-known'), '连字符词不拆散');
assert(words2.some(w => w === "it's"), '撇号词不拆散');
eq(tokenize('今天天气不错').filter(t => t.w).length, 0, '中文不出单词片段');
eq(tokenize('').length, 0, '空串无片段');
eq(isEnglish('hello world'), true, 'isEnglish 英文');
eq(isEnglish('hello 世界'), false, 'isEnglish 含中文');

console.log('== 2. 分词 ↔ 释义一一对应（真实词典） ==');
// 弹窗大字 = 点到的词形（保留大小写），词义/音标/词性/原形都来自同一次 lookup
let looked = 0;
let mismatch = 0;
for (const t of toks.filter(x => x.w)) {
  const entry = dict.lookup(t.t);
  looked++;
  if (!entry || typeof entry.found !== 'boolean') { mismatch++; continue; }
  if (!entry.found) {
    // 未收录也要给出可发音的词形
    if (!entry.w) mismatch++;
    continue;
  }
  if (!entry.meaning) mismatch++;                                    // 有命中却没释义
  if (entry.inflected) {
    if (!entry.lemma) mismatch++;                                    // 标了变形却没给原形
    if (entry.lemma === t.t.toLowerCase()) mismatch++;               // 变形词的原形不能是它自己
  }
}
eq(looked, 12, '逐词查词次数');
eq(mismatch, 0, '字段对应不一致数');
const hit = dict.lookup('spoken');
assert(hit.found, '核心词「spoken」可查到');
assert(hit.meaning && hit.phonetic !== undefined, '命中词条带释义/音标字段');
const cap = dict.lookup('English');
if (cap.found) assert(cap.lemma !== undefined, '大写词（English）也能命中并给出原形');
const miss = dict.lookup('zzzqqq');
eq(miss.found, false, '未收录词 found=false（弹窗走「未收录（仍可发音）」）');

console.log('== 3. 页面契约（sentence-detail.vue） ==');
const detail = read('pkgStudy/pages/sentence-detail/sentence-detail.vue');
assert(/opt && opt\.id/.test(detail), 'onLoad 只取收藏 id（长句不走 URL 传参）');
assert(/settings\.favorites\(\)\.find\(f => f\.type === 'sentence' && f\.id === id\)/.test(detail), '回 settings 查原文');
assert(/dict\.lookup\(raw\)/.test(detail), '点词查词义');
assert(/tts\.speakWord\(dict\.speakForm\(raw\)\)/.test(detail), '点词发音用词典最佳形式');
assert(/tts\.speakSentence\(this\.en,\s*\{\s*onDone/.test(detail), '整句朗读带 onDone 复位');
assert(/onHide\(\)\s*\{\s*this\.stopAll\(\)\s*\}/.test(detail) && /onUnload\(\)\s*\{\s*this\.stopAll\(\)\s*\}/.test(detail), '页面隐藏/卸载都停止语音');
assert(/stopAll\(\)\s*\{[\s\S]*?tts\.stop\(\)/.test(detail), 'stopAll 内部调用 tts.stop');
assert(/removeFavorite\('sentence', this\.id\)/.test(detail), '取消收藏走 removeFavorite');
assert(/uni\.navigateBack\(\)/.test(detail), '取消收藏后返回上一页');
assert(/showToast\(\{ title: t?\(?'已取消收藏'\)?/.test(detail), '取消收藏有提示');
assert(/pop\.phonetic/.test(detail), '弹窗含音标');
for (const key of ['phonetic', 'pos', 'meaning', 'srcLabel', 'lemma', 'inflected']) {
  assert(detail.indexOf(key) >= 0, '弹窗字段 ' + key);
}
assert(/word:\s*raw,/.test(detail), '弹窗大字展示点到的词形（保留大小写）');
assert(!/word:\s*entry\.w/.test(detail), '弹窗不直接用小写词头（I / English 不变小写）');
assert(/utils\/tokenize/.test(detail), '分词来自共享 utils/tokenize');

console.log('== 4. 收藏列表入口（favorites.vue） ==');
const fav = read('pkgStudy/pages/favorites/favorites.vue');
assert(/encodeURIComponent\(item\.id\)/.test(fav), '导航用 encodeURIComponent 包 id');
assert(/pages\/sentence-detail\/sentence-detail\?id=/.test(fav), '跳转详情页路径正确');
assert(/@tap\.stop="remove\(i\)"/.test(fav), '移除按钮阻断冒泡（不会同时打开详情）');
assert(/item\.type !== 'sentence'\)\s*return/.test(fav), '单词收藏不触发跳转');
assert(/fav-more/.test(fav), '例句卡有详情引导文案');

console.log('== 5. 与练习页共用同一分词实现 ==');
const practice = read('pkgStudy/pages/practice/practice.vue');
assert(!/function tokenize\(/.test(practice), 'practice.vue 不再有本地 tokenize（避免两处分叉）');
assert(/import \{ tokenize, isEnglish \} from '\.\.\/(?:\.\.\/)+utils\/tokenize'/.test(practice), 'practice.vue 改用共享实现');

console.log('== 6. pages.json 注册 ==');
const pagesJson = read('pages.json');
assert(/"path":\s*"pages\/sentence-detail\/sentence-detail"/.test(pagesJson), '页面已注册');
assert(/"path":\s*"pages\/sentence-detail\/sentence-detail"[\s\S]*?"navigationStyle":\s*"custom"/.test(pagesJson), '自定义导航（悬浮胶囊）');

console.log('');
console.log(fail === 0 ? '例句详情页全部通过' : '失败 ' + fail + ' 项');
process.exitCode = fail ? 1 : 0;
