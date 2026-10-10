// utils/search.js - 首页顶部搜索的检索与入库逻辑（与页面解耦，便于单测）
//
// 检索顺序：当前词书（内置词 + 该书导入词）→ 常用词典 / 词形还原（dict.lookup）
// 入库：复用导入管道 importer.validateAndDedupe + importIntoBook，
//      保证与「词库 → 导入单词」完全一致（去重校验、id 规则、点读缓存失效）。

import * as wordbook from './wordbook.js';
import * as dict from './dict.js';
import * as importer from './importer.js';

const DEFAULT_LIMIT = 20;

// 本地检索：命中词形或中文释义
export function localSearch(bookId, kw, limit) {
  const q = String(kw || '').trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const max = limit || DEFAULT_LIMIT;
  const out = [];

  try {
    const bid = bookId || wordbook.currentBookId();
    wordbook.bookWords(bid).forEach((w) => {
      if (out.length >= max) return;
      const hit = String(w.w || '').toLowerCase().indexOf(lower) >= 0 ||
        String(w.m || '').indexOf(q) >= 0;
      if (hit) out.push({ w: w.w, pos: w.pos || '', m: w.m || '', fromText: '当前词书' });
    });
  } catch (e) {
    /* 词书读取失败则跳过，继续走词典兜底 */
  }

  if (!out.length) {
    try {
      const e = dict.lookup(q);
      // 只回落到「内置词 + 常用词典 + 词形还原」：
      // 其他词书里的导入词（src=custom）不算当前词书的命中，
      // 否则用户会以为词已在本词书里，同时也会挡掉 AI 补词路径。
      if (e && e.found && e.src !== 'custom') {
        out.push({
          w: e.w || q,
          pos: e.pos || '',
          m: e.meaning || '',
          fromText: (dict.SRC_LABEL && dict.SRC_LABEL[e.src]) || '词典'
        });
      }
    } catch (e) {
      /* 查词失败视为未命中 */
    }
  }

  return out;
}

// 把一个词写进词书（本地）
// item: { word, pos, meaning, example?: { en, zh } }
// opts: { allowKnown?: boolean } —— true 表示「核心词典里已有也不算重复」，
//       用于单词详情页的「加入词书」（同一个词可以收进多本书）。
// 返回 { added, reason } —— added=false 时 reason 说明原因（已存在 / 词形非法 …）
export function addWordToBook(bookId, item, opts) {
  const bid = bookId || wordbook.currentBookId();
  const word = String((item && item.word) || '').trim();
  if (!word) return { added: false, reason: '词形为空' };

  const { accepted, rejected } = importer.validateAndDedupe(
    [{ word, pos: (item && item.pos) || '', meaning: (item && item.meaning) || '' }],
    bid,
    opts
  );
  if (!accepted.length) {
    const r = rejected && rejected[0];
    return { added: false, reason: (r && r.reason) || '未能加入词库' };
  }
  try {
    const res = importer.importIntoBook(accepted, bid);
    // 例句：直接复用 AI 释义里带的例句，省掉一次生成请求
    const ex = item && item.example;
    if (ex && ex.en) {
      try { importer.attachExampleTo(bid, word, ex.en, ex.zh || '') } catch (e) { /* 例句写入失败不影响入库 */ }
    }
    return { added: !!(res && res.added), reason: '' };
  } catch (e) {
    return { added: false, reason: '写入失败' };
  }
}
