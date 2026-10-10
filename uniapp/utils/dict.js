// utils/dict.js - 点读查词统一入口（离线，无网络请求）
// 查词优先级：核心词书 → 用户导入词 → 内置常用词典 → 词形还原后再走一遍 → 未收录
// 未收录时仍返回 { found:false }，调用方可继续用 tts.speakWord() 发音（有道单词级可用）。
import { WORDS } from '../data/words.js';
import { COMMON_RAW } from '../data/common-words.js';
import { allByText } from '../data/lexicon.js';
import * as store from './store.js';
import { lemmaCandidates, lemma } from './lemma.js';

export const SRC_LABEL = {
  core: '核心词书',
  book: '内置词书',
  custom: '我的导入',
  common: '常用词',
  none: '未收录'
};

const CORE = {};    // 'improve' -> { w, pos, meaning, lv, phonetic }
const COMMON = {};
const cache = {};

WORDS.forEach(function (w) {
  CORE[w.w.toLowerCase()] = {
    w: w.w,
    pos: w.pos || '',
    meaning: w.m || '',
    lv: w.lv || 1,
    phonetic: w.ph || '',
    src: 'core'
  };
});

COMMON_RAW.forEach(function (line) {
  const i = line.indexOf('|');
  if (i < 0) return;
  const j = line.indexOf('|', i + 1);
  if (j < 0) return;
  const key = line.slice(0, i).toLowerCase();
  COMMON[key] = {
    w: line.slice(0, i),
    pos: line.slice(i + 1, j),
    meaning: line.slice(j + 1),
    src: 'common'
  };
});

function normalize(raw) {
  return String(raw == null ? '' : raw)
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z'-]/g, '');
}

// 用户导入的词（按词书分桶存放：state.customWords[bookId] = [{ word, pos, meaning }]）
function customGet(key) {
  try {
    const st = store.get();
    const cw = st && st.customWords;
    if (!cw) return null;
    for (const bid in cw) {
      const list = cw[bid] || [];
      for (let i = 0; i < list.length; i++) {
        if (String(list[i].word || '').toLowerCase() === key) {
          return { w: list[i].word, pos: list[i].pos || '', meaning: list[i].meaning || '', src: 'custom' };
        }
      }
    }
  } catch (e) {}
  return null;
}

function hit(key) {
  return CORE[key] || customGet(key) || COMMON[key] || bookGet(key) || null;
}

// 内置词书共享词条（data/lexicon.js）：排在 core / 导入词 / 常用词之后，
// 只作为"前三层都没收录"时的最后一道兜底 —— 让点读在任何内置考试词书的词汇上也能出释义。
// 复用同一份 allByText 索引，不额外建表 —— 覆盖率提升不需要额外内存。
function bookGet(key) {
  try {
    const w = allByText()[key];
    if (!w) return null;
    return { w: w.w, pos: w.pos || '', meaning: w.m || '', lv: w.lv || 0, phonetic: '', src: 'book' };
  } catch (e) { return null; }
}

// 查词：返回 { w, pos, meaning, phonetic, src, found, lemma, inflected }
export function lookup(raw) {
  const key = normalize(raw);
  if (!key) return { w: raw, pos: '', meaning: '', phonetic: '', src: 'none', found: false };
  if (cache[key]) return cache[key];

  let out = hit(key);
  let inflected = '';
  let lemmaForm = '';

  if (out) {
    lemmaForm = key;
  } else {
    const cands = lemmaCandidates(key);
    for (let i = 0; i < cands.length; i++) {
      const h = hit(cands[i]);
      if (h) {
        out = h;
        lemmaForm = cands[i];
        inflected = key;
        break;
      }
    }
  }

  const res = out
    ? {
        w: out.w,
        pos: out.pos || '',
        meaning: out.meaning || '',
        phonetic: out.phonetic || '',
        src: out.src,
        lv: out.lv || 0,
        found: true,
        lemma: lemmaForm || key,
        inflected: inflected
      }
    : { w: raw, pos: '', meaning: '', phonetic: '', src: 'none', found: false, lemma: key, inflected: '' };

  cache[key] = res;
  return res;
}

// 取单词的"最佳发音形式"：优先原形（词典收录形式）
export function speakForm(raw) {
  const r = lookup(raw);
  return r.found && r.lemma ? r.lemma : normalize(raw);
}

// 导入新词 / 切换词书后清空缓存
export function invalidateCache() {
  for (const k in cache) delete cache[k];
}

export { lemma };
