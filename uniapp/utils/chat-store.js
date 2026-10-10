// utils/chat-store.js - AI 对话陪练的会话存档（独立于词书、独立于设置）
//
// 为什么单独一层：
//   陪练的对话是"过程"，不是"学习进度"——它不该写进 fj_eng_state_v1（掌握度/错题），
//   也不该写进 settings（偏好）。混进去的后果是：清缓存会丢对话、导进度会带上一堆聊天。
//   独立 key fj_chat_v1，想清就清，互不影响。
//
// 存什么：多条会话（每条 = id + 标题 + 消息数组）。用户可以开新对话，也可以接着上次的聊。
// 不存什么：① system 提示词 —— 它每次都由当前词书重新生成，存下来只会越来越旧；
//           ② 空消息 / 流式中断留下的空气泡 / "[object Object]" 这类垃圾。
//
// 保存的句子走 settings.addFavorite({type:'sentence'})，和词库页收藏的例句同仓，
// 这样「我的收藏」里单词和句子是一套界面（见 favorites.vue / sentence-detail.vue）。

const KEY = 'fj_chat_v1';
const MAX_SESSIONS = 20;        // 会话条数上限：老的自动淘汰
const MAX_MSGS = 200;           // 单会话消息上限：只留最近这些，防止无限膨胀
const MSG_MAX = 4000;           // 单条消息字符上限
const TITLE_MAX = 24;

let mem = null;
let writeTimer = 0;

// 把对象 String() 出来的垃圾（"[object Object]" 之类）挡在存档外
const JUNK = /^\[object\s/i;

function blank() {
  return { v: 1, sessions: [], activeId: '' };
}

function nowId() {
  return 'cs-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36);
}

function read() {
  if (mem) return mem;
  let o = null;
  try {
    const raw = uni.getStorageSync(KEY);
    o = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) { o = null }
  mem = normalize(o);
  return mem;
}

/** 存档可能来自老版本、也可能被手改脏 —— 一律按 shape 重建，脏数据直接丢弃 */
function normalize(o) {
  if (!o || typeof o !== 'object') return blank();
  const sessions = Array.isArray(o.sessions) ? o.sessions : [];
  const out = [];
  sessions.forEach(s => {
    if (!s || typeof s !== 'object') return;
    const msgs = Array.isArray(s.messages) ? s.messages.map(cleanMsg).filter(Boolean) : [];
    if (!msgs.length) return;             // 空会话没有保留价值
    out.push({
      id: String(s.id || nowId()),
      title: String(s.title || '').slice(0, TITLE_MAX),
      createdAt: Number(s.createdAt) || Date.now(),
      updatedAt: Number(s.updatedAt) || Number(s.createdAt) || Date.now(),
      messages: msgs.slice(-MAX_MSGS)
    });
  });
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  const trimmed = out.slice(0, MAX_SESSIONS);
  const ids = {};
  trimmed.forEach(s => { ids[s.id] = true });
  return {
    v: 1,
    sessions: trimmed,
    activeId: ids[o.activeId] ? o.activeId : (trimmed[0] ? trimmed[0].id : '')
  };
}

/**
 * 句子的收藏 id：同一句永远算出同一个 id，重复收藏只会有一条。
 * 32 位滚动哈希 + 长度兜底 —— 收藏量最多几百条，碰撞概率可忽略；
 * 真撞了也只是少收一句，不会把 A 句的内容串到 B 句上。
 */
export function sentenceIdOf(en) {
  // 归一化后再算 id：大小写不同、多打几个空格，都该算同一句
  // （否则同一句话能收两次，列表里出现两条一模一样的例句）
  const s = String(en || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return '';
  return 'csen-' + hash(s);
}

function cleanMsg(m) {
  if (!m || typeof m !== 'object') return null;
  // 只留 user / assistant：system 提示词每次按当前词书重新生成，存下来只会越来越旧；
  // 角色字段脏了（老存档 / 手改过）的也一并丢掉。
  // ⚠️ 这里曾经写成 `const role = …; if (!role) role = 'assistant'` ——
  //    给 const 赋值在任何模式下都是 TypeError，而消息里必然带着 system，
  //    结果每次存盘都抛错（真机表现：发完一句话界面就永远转圈）。
  const role = m.role === 'user' ? 'user' : (m.role === 'assistant' ? 'assistant' : '');
  if (!role) return null;
  const content = String(m.content == null ? '' : m.content);
  const c = content.trim().slice(0, MSG_MAX);
  if (!c || JUNK.test(c)) return null;          // 空气泡 / 垃圾不落盘
  return { role: role, content: c, at: Number(m.at) || 0 };
}

// 写盘节流：流式输出期间每来一个字都会改内存，逐字序列化整份存档太贵。
// 800ms 合并一次；真正需要立刻落盘（切后台 / 关页面）时调 flush()。
function scheduleWrite() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => { writeTimer = 0; flush(); }, 800);
}

function flush() {
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = 0 }
  if (!mem) return;
  try { uni.setStorageSync(KEY, JSON.stringify(mem)) } catch (e) { /* 存不下就算了，内存里还在 */ }
}

// ---------- 对外接口 ----------

/** 全部会话（最近聊过的在前） */
export function sessions() {
  return read().sessions.slice();
}

export function activeId() {
  return read().activeId || '';
}

/** 当前会话：没有就开一条新的（首次进入也是这条路径） */
export function active() {
  const st = read();
  let s = st.sessions.filter(x => x.id === st.activeId)[0];
  if (!s) { s = create(); }
  return s;
}

/** 开一条新会话并设为当前 */
export function create() {
  const st = read();
  const s = {
    id: nowId(),
    title: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };
  st.sessions.unshift(s);
  st.activeId = s.id;
  trim(st);
  scheduleWrite();
  return s;
}

/** 切到某条会话（历史列表点进来） */
export function open(id) {
  const st = read();
  if (!st.sessions.some(s => s.id === id)) return null;
  st.activeId = id;
  scheduleWrite();
  return st.sessions.filter(s => s.id === id)[0];
}

export function get(id) {
  return read().sessions.filter(s => s.id === id)[0] || null;
}

/**
 * 写回一整段消息（聊天页每次发完 / 收完都调一次）。
 * 过滤掉 system 与空气泡，标题取第一条用户发言。
 */
export function saveMessages(id, messages) {
  const st = read();
  const s = st.sessions.filter(x => x.id === id)[0];
  if (!s) return null;
  const list = (Array.isArray(messages) ? messages : []).map(cleanMsg).filter(Boolean);
  s.messages = list.slice(-MAX_MSGS);
  if (!s.title) {
    const first = s.messages.filter(m => m.role === 'user')[0];
    if (first) s.title = first.content.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  }
  s.updatedAt = Date.now();
  scheduleWrite();
  return s;
}

/** 追加一条（保留给以后逐条落盘的场景） */
export function pushMessage(id, msg) {
  const s = get(id);
  if (!s) return null;
  return saveMessages(id, s.messages.concat([msg]));
}

export function remove(id) {
  const st = read();
  st.sessions = st.sessions.filter(s => s.id !== id);
  if (st.activeId === id) st.activeId = st.sessions[0] ? st.sessions[0].id : '';
  scheduleWrite();
  return st.sessions;
}

export function clearAll() {
  mem = blank();
  flush();
  return sessions();
}

/** 会话标题：没取到就用「第 n 条对话」，界面上永远不会是空白 */
export function titleOf(s, i) {
  if (!s) return '';
  if (s.title) return s.title;
  return '对话 ' + ((i || 0) + 1);
}

function trim(st) {
  st.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  st.sessions = st.sessions.slice(0, MAX_SESSIONS);
}

// ---------- 保存的句子（复用 settings 的收藏仓，和词库页收藏的例句同一套） ----------
import * as settings from './settings.js';

/**
 * 收一句进「我的收藏」。id 按句子内容生成，同一句重复收藏只会有一条。
 * @returns {{ok:boolean, dup:boolean, id:string}}
 */
export function saveSentence(en, zh, meta) {
  const text = String(en || '').trim();
  if (!text || JUNK.test(text)) return { ok: false, dup: false, id: '' };
  const id = sentenceIdOf(text);
  const hit = settings.favorites().filter(f => f.type === 'sentence' && f.id === id)[0];
  if (hit) {
    // 已收过：只补译文（当时没配 AI 或翻译失败，这次补上）
    if (!hit.zh && zh) {
      settings.removeFavorite('sentence', id);
      settings.addFavorite(Object.assign({}, hit, { zh: zh }));
      return { ok: true, dup: true, id: id };
    }
    return { ok: false, dup: true, id: id };
  }
  const item = Object.assign({
    type: 'sentence',
    id: id,
    en: text.slice(0, MSG_MAX),
    zh: String(zh || '').slice(0, MSG_MAX),
    at: Date.now()
  }, meta || {});
  settings.addFavorite(item);
  return { ok: true, dup: false, id: id };
}

/** 这句已收了吗（气泡上的 ☆ 要显示实心还是空心） */
export function isSentenceSaved(en) {
  const id = sentenceIdOf(en);
  if (!id) return false;
  return settings.isFavorite('sentence', id);
}

/** 取消收藏一句（聊天页气泡上再点一下 ☆） */
export function removeSentence(id) {
  if (!id) return [];
  return settings.removeFavorite('sentence', id);
}

/** 收了多少句（首页卡片用） */
export function savedCount() {
  return settings.favorites().filter(f => f.type === 'sentence').length;
}

// 同一句 → 同一个 id：不引入依赖，用 32 位滚动哈希 + 长度兜底，
// 句子收藏量最多几百条，碰撞概率可忽略；真撞了也只是少收一句，不会串内容。
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) & 0xffffffff;
  }
  return (h >>> 0).toString(36) + '-' + s.length.toString(36);
}

export { flush, KEY, MAX_SESSIONS, MAX_MSGS };
