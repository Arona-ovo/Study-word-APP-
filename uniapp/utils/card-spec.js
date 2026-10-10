// utils/card-spec.js - AI 卡片设计规格 v2（唯一真相来源 + 安全边界）
//
// 上一层（page-schema / page-command）管的是"首页长什么样"，
// 这一层管的是"一张卡片里面长什么样"——把这个交给 AI 自由设计。
//
// ── AI 能自由决定的（只要不碰红线，怎么设计都行）────────────────────
//   布局：分几个区、每区是竖排 / 横排 / 几列网格、间距、对齐、伸缩比例
//   样式：底色（纯色 / 渐变）、圆角、内边距、描边、投影、字号字重行高、
//         字体（衬线 / 无衬线）、斜体、下划线、透明度、宽高
//   数据：定义自己的字段、绑定 App 的真实学习数据、做条件显示
//   交互：点击跳转、开始练习、朗读、复制、弹提示、改卡片内的状态
//   内容：任何文案、清单、标签、引言、倒计时、图片
//
// ── 红线（任何一条都不可能通过归一化，不是"不推荐"是"做不到"）────────
//   R1 不执行代码：全链路没有 eval、没有函数构造、没有模板求值、没有原始 HTML 注入；
//      字符串里的 {{...}} 只按白名单键做值替换，绝不是表达式求值。
//   R2 不碰系统：读不到文件、数据库、剪贴板历史、设备信息；
//      写只能写"自己这张卡"的那份 doc，不能改学习进度 / 词库 / 账号。
//   R3 不碰凭据：数据目录里没有任何 token / 密钥 / 手机号 / 账号名，
//      也拿不到 AI 的 API Key 与任何网络请求能力。
//   R4 不越权跳转：navigate 的 page 必须在 PAGE_ROUTES 白名单里；
//      没有任何"打开任意 URL / 调起别的 App / 跳外链"的动作。
//   R5 不泄漏：图片地址只放行 https 与本地文件，禁 data:image/svg（SVG 能夹脚本）。
//   R6 不崩溃：层数、节点数、文本长度、列表长度全部有硬上限，
//      渲染是"展平后一层循环"，不存在深递归 / 栈溢出 / 内存爆掉。
//   R7 不阻塞：规格里没有任何网络请求、没有同步大写入、没有定时器。
//
// 归一化的性格：**能救就救**。AI 给 oversized / 非法 / 拼写错的值，
// 一律夹取、截断、取默认值，而不是让整张卡片失败 —— 只有"一个可渲染的
// 节点都没有"才算失败。这样模型的自由度很高，但产物永远可渲染。

/* ============================================================
 * 1. 上限（硬编码，指令无法绕过）
 * ============================================================ */
export const LIMITS = {
  MAX_SECTIONS: 6,        // 一张卡最多几个区
  MAX_ITEMS: 6,           // 一个区最多几个节点
  MAX_NODES: 28,          // 整张卡节点总数
  MAX_TEXT: 200,          // 单段正文
  MAX_TITLE: 40,          // 标题
  MAX_SHORT: 40,          // 短文本（标签 / 单位 / 说明）
  MAX_LIST: 12,           // 列表 / 清单 / 标签项
  MAX_KV: 8,              // 键值对行数
  MAX_DATA: 12,           // 自定义数据字段数
  MAX_STATE: 16,          // 卡片状态键数
  MIN_FONT: 18,           // 字号 rpx
  MAX_FONT: 52,
  MIN_RADIUS: 0,
  MAX_RADIUS: 48,
  MIN_PAD: 0,
  MAX_PAD: 40,
  MIN_GAP: 0,
  MAX_GAP: 32,
  MIN_OPACITY: 0.2,
  MAX_OPACITY: 1,
  MIN_WIDTH: 40,
  MAX_WIDTH: 750,
  MAX_HEIGHT: 600,
  MAX_COLS: 4,
  MAX_BY: 100             // state.inc 单次步进
};

/* ============================================================
 * 2. 取值域
 * ============================================================ */
export const LAYOUTS = ['stack', 'row', 'grid'];
export const SHADOWS = ['none', 'soft', 'lifted'];
export const ALIGNS = ['left', 'center', 'right'];
export const VALIGNS = ['start', 'center', 'end', 'stretch'];
export const WEIGHTS = ['400', '500', '600'];
export const DECOS = ['none', 'underline', 'through'];
export const TONES = ['normal', 'muted', 'strong', 'brand', 'danger', 'warn', 'ok'];
export const BUTTON_VARIANTS = ['primary', 'ghost', 'danger', 'plain'];
export const TAG_TONES = ['brand', 'neutral', 'warn'];
export const METRIC_SIZES = ['sm', 'md', 'lg'];

// 颜色令牌：AI 给令牌名就能跟着主题走，给 #hex 就是固定色
export const PAINT_TOKENS = {
  brand: 'var(--brand, #2e6bff)',
  'brand-strong': 'var(--brand-strong, #1d4fd8)',
  ink: 'var(--ink-1, #17201a)',
  'ink-2': 'var(--ink-2, #5a6560)',
  'ink-3': 'var(--ink-3, #98a19b)',
  surface: 'rgba(var(--surface-rgb, 255,255,255), 0.72)',
  danger: '#e5484d',
  warn: '#f79009',
  ok: '#2f9e6e',
  clear: ''
};
export const PAINT_NAMES = Object.keys(PAINT_TOKENS);

// 页面白名单（R4）：AI 只能跳这些已存在的页面，tab 页自动走 switchTab
export const PAGE_ROUTES = {
  home: { url: '/pages/home/home', tab: true },
  library: { url: '/pages/library/library', tab: true },
  review: { url: '/pages/review/review', tab: true },
  profile: { url: '/pages/profile/profile', tab: true },
  practice: { url: '/pkgStudy/pages/practice/practice', tab: false },
  wordDrill: { url: '/pkgStudy/pages/word-drill/word-drill', tab: false },
  history: { url: '/pkgStudy/pages/history/history', tab: false },
  streak: { url: '/pkgStudy/pages/streak/streak', tab: false },
  bookSwitch: { url: '/pkgManage/pages/book-switch/book-switch', tab: false },
  settings: { url: '/pkgManage/pages/settings/settings', tab: false },
  favorites: { url: '/pkgStudy/pages/favorites/favorites', tab: false },
  stats: { url: '/pkgStudy/pages/stats/stats', tab: false },
  reviewList: { url: '/pkgStudy/pages/review-list/review-list', tab: false },
  donate: { url: '/pkgManage/pages/donate/donate', tab: false }
};
export const PAGE_NAMES = Object.keys(PAGE_ROUTES);

// 动作白名单（R2 / R4）：没有"打开任意链接"、没有"发起请求"
export const ACTION_KINDS = [
  'none', 'navigate', 'practice', 'speak', 'toast', 'copy', 'refresh',
  'state.set', 'state.toggle', 'state.inc'
];

// 数据目录（R3）：只有这些字段能被绑定，且全是"学习统计"，没有任何身份信息
export const LIVE_FIELDS = [
  'todayTotal', 'todayCorrect', 'wrongCount', 'streak', 'longestStreak',
  'mastered', 'wordCount', 'accuracy',
  'newWordsDone', 'newWordsTarget', 'practiceDone', 'practiceTarget',
  'bookName', 'batchName', 'batchDone', 'batchTotal', 'batchPct', 'bookPct',
  'usageToday', 'usageAvg'
];

/* ============================================================
 * 3. 校验器（自给自足，零依赖 —— 安全边界不该依赖别的东西）
 * ============================================================ */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const KEY = /^[A-Za-z0-9_]{1,24}$/;
const TOKEN_REF = /\{\{\s*(live|state|data)\.([A-Za-z0-9_]{1,24})\s*\}\}/g;

function fail(reason) { return { ok: false, value: undefined, reason: reason }; }
function pass(v) { return { ok: true, value: v }; }

function num(v, min, max, def) {
  if (v === undefined || v === null || v === '') return pass(def);
  const n = Number(v);
  if (!isFinite(n)) return pass(def);
  return pass(Math.max(min, Math.min(max, n)));
}
function int(v, min, max, def) { return pass(Math.round(num(v, min, max, def).value)); }

function str(v, max, def) {
  if (v === undefined || v === null) return pass(def === undefined ? '' : def);
  // 去掉控制字符：它们不会显示，但会污染持久化与日志
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
  return pass(s);
}

function bool(v, def) {
  if (v === undefined || v === null) return pass(!!def);
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'on', '开', '打开'].indexOf(s) >= 0) return pass(true);
    if (['false', '0', 'no', 'off', '关', '关闭'].indexOf(s) >= 0) return pass(false);
    return pass(!!def);
  }
  return pass(!!v);
}

function pick(v, values, def) {
  if (v === undefined || v === null || v === '') return pass(def);
  const s = String(v).trim();
  const hit = values.find(x => String(x).toLowerCase() === s.toLowerCase());
  if (!hit) return pass(def);          // 枚举不命中 → 取默认，不失败（能救就救）
  return pass(hit);
}

/** 颜色：#hex / 令牌名 / 'clear'。绝不接收 url()、rgb( 等任意字符串 */
function paint(v, def) {
  if (v === undefined || v === null || v === '') return pass(def === undefined ? '' : def);
  const s = String(v).trim();
  if (s === 'clear' || s === 'none' || s === 'transparent') return pass('');
  if (HEX.test(s)) return pass(s.toLowerCase());
  if (PAINT_TOKENS[s] !== undefined) return pass(s);
  return pass(def === undefined ? '' : def);
}

/** 图片地址（R5）：https 或本地文件；禁 data:image/svg+xml（SVG 里能夹脚本） */
function imageUrl(v) {
  if (v === undefined || v === null || v === '') return pass('');
  const s = String(v).trim();
  if (/^data:image\/svg/i.test(s)) return pass('');
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(s)) return pass(s);
  if (/^https:\/\/\S+$/i.test(s)) return pass(s);
  if (/^(_doc|_www)\//i.test(s)) return pass(s);
  if (/^(_doc:\/\/|untrusted:\/)/i.test(s)) return pass(s);
  // file:// 只放行 uni 沙箱目录（_doc / _www）；别的形式可能是设备上的任意文件
  if (/^file:\/\/\//i.test(s) && /(_doc|_www)\//i.test(s)) return pass(s);
  if (/^[a-z]:[\\/]/i.test(s)) return pass(s);
  if (/^\/?(storage|data|user)\//i.test(s)) return pass(s);
  return pass('');
}

function keyName(v, def) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  return pass(KEY.test(s) ? s : (def === undefined ? '' : def));
}

function dateValue(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return pass('');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return pass(s);
  if (/^\+\d{1,4}d$/.test(s)) return pass(s);
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) {
    const p = s.split('/');
    const pad = (x) => (x.length < 2 ? '0' + x : x);
    return pass(p[0] + '-' + pad(p[1]) + '-' + pad(p[2]));
  }
  return pass('');
}

function toArray(v) {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(/[、,，\n|]/).map(x => x.trim()).filter(Boolean);
  return [];
}

function objOf(v) {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}

/* ============================================================
 * 4. 样式（节点与分区共用一套）
 * ============================================================ */
const STYLE_SCHEMA = {
  bg: (v) => {
    // 三种形态：'#hex' / 令牌名 / { from, to, angle }
    const o = (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
    if (o) {
      const from = paint(o.from, '').value;
      const to = paint(o.to, '').value;
      if (!from || !to) return pass('');
      return pass({ from: from, to: to, angle: int(o.angle, 0, 360, 165).value });
    }
    return paint(v, '');
  },
  fg: (v) => paint(v, ''),
  tone: (v) => pick(v, TONES, ''),
  radius: (v) => int(v, LIMITS.MIN_RADIUS, LIMITS.MAX_RADIUS, null),
  pad: (v) => int(v, LIMITS.MIN_PAD, LIMITS.MAX_PAD, null),
  border: (v) => {
    const o = objOf(v);
    const w = int(o.w !== undefined ? o.w : v, 0, 4, 0).value;
    const c = paint(o.c, '').value;
    if (!w) return pass(null);
    return pass({ w: w, c: c || 'var(--hairline, rgba(255,255,255,0.75))' });
  },
  shadow: (v) => pick(v, SHADOWS, ''),
  align: (v) => pick(v, ALIGNS, ''),
  valign: (v) => pick(v, VALIGNS, ''),
  size: (v) => int(v, LIMITS.MIN_FONT, LIMITS.MAX_FONT, null),
  weight: (v) => pick(v, WEIGHTS, ''),
  lh: (v) => num(v, 1, 2.2, null),
  serif: (v) => bool(v, null),
  italic: (v) => bool(v, null),
  deco: (v) => pick(v, DECOS, ''),
  grow: (v) => int(v, 0, 6, null),
  w: (v) => {
    if (v === undefined || v === null || v === '') return pass(null);
    const s = String(v).trim().toLowerCase();
    if (s === 'full') return pass('full');
    if (s === 'auto' || s === '') return pass(null);
    return pass(int(v, LIMITS.MIN_WIDTH, LIMITS.MAX_WIDTH, null).value);
  },
  h: (v) => int(v, 0, LIMITS.MAX_HEIGHT, null),
  opacity: (v) => num(v, LIMITS.MIN_OPACITY, LIMITS.MAX_OPACITY, null)
};

export const STYLE_FIELDS = Object.keys(STYLE_SCHEMA);

/** 归一化样式：只保留真正给了的字段（稀疏对象，渲染时才叠默认值） */
export function normalizeStyle(raw) {
  const src = objOf(raw);
  const out = {};
  for (const k of STYLE_FIELDS) {
    if (src[k] === undefined || src[k] === null || src[k] === '') continue;
    const v = STYLE_SCHEMA[k](src[k]).value;
    if (v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return out;
}

/** 令牌 / hex → CSS 颜色值 */
function cssColor(name) {
  if (!name) return '';
  if (name[0] === '#') return name;
  return PAINT_TOKENS[name] || '';
}

/** 尺寸 / 伸缩：给外层"格子"用（与视觉样式分开，避免 padding 与宽度互相打架） */
export function layoutCss(style) {
  const s = objOf(style);
  const out = [];
  if (s.w === 'full') out.push('width:100%;');
  else if (typeof s.w === 'number') out.push('width:' + s.w + 'rpx;');
  if (typeof s.h === 'number' && s.h > 0) out.push('height:' + s.h + 'rpx;');
  if (s.grow) out.push('flex:' + s.grow + ' 1 0;min-width:0;');
  if (s.valign && s.valign !== 'stretch') {
    out.push('align-self:' + (s.valign === 'start' ? 'flex-start' : s.valign === 'end' ? 'flex-end' : 'center') + ';');
  }
  return out.join('');
}

/** 样式 → CSS 字符串（纯函数，可单测；渲染器只负责挂上去） */
export function cssOf(style) {
  const s = objOf(style);
  const out = [];
  if (s.bg) {
    if (typeof s.bg === 'object') {
      out.push('background:linear-gradient(' + s.bg.angle + 'deg,' + cssColor(s.bg.from) + ',' + cssColor(s.bg.to) + ');');
    } else {
      out.push('background:' + cssColor(s.bg) + ';');
    }
  }
  if (s.fg) out.push('color:' + cssColor(s.fg) + ';');
  if (s.radius != null) out.push('border-radius:' + s.radius + 'rpx;');
  if (s.pad != null) out.push('padding:' + s.pad + 'rpx;');
  if (s.border) out.push('border:' + s.border.w + 'rpx solid ' + (s.border.c || 'transparent') + ';');
  if (s.opacity != null) out.push('opacity:' + s.opacity + ';');
  if (s.size != null) out.push('font-size:' + s.size + 'rpx;');
  if (s.weight) out.push('font-weight:' + s.weight + ';');
  if (s.lh != null) out.push('line-height:' + s.lh + ';');
  if (s.serif) out.push('font-family:Georgia,"Times New Roman","PingFang SC",serif;');
  if (s.italic) out.push('font-style:italic;');
  if (s.deco === 'underline') out.push('text-decoration:underline;');
  if (s.deco === 'through') out.push('text-decoration:line-through;');
  if (s.align) out.push('text-align:' + s.align + ';');
  return out.join('');
}

/** 投影（独立一条：它是卡片/分区级效果，不是文字样式） */
export function shadowCss(name) {
  if (name === 'soft') return 'box-shadow:0 8rpx 24rpx rgba(var(--shadow-rgb,23,32,26),0.06);';
  if (name === 'lifted') return 'box-shadow:0 18rpx 44rpx rgba(var(--shadow-rgb,23,32,26),0.14);';
  return '';
}

/* ============================================================
 * 5. 条件与插值（R1：只做值替换，没有表达式求值）
 * ============================================================ */
export const WHEN_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'has'];

export function normalizeWhen(raw) {
  const o = objOf(raw);
  const k = String(o.k || o.key || '').trim();
  const m = /^(live|state|data)\.([A-Za-z0-9_]{1,24})$/.exec(k);
  if (!m) return null;
  const op = pick(o.op, WHEN_OPS, 'eq').value;
  let v = o.v;
  if (typeof v === 'object' && v !== null) v = '';
  if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
  return { k: m[1] + '.' + m[2], op: op, v: str(v, 40, '').value };
}

/** 读一个 "live.x" / "state.x" / "data.x" 的值 */
function readPath(path, ctx) {
  const m = /^(live|state|data)\.([A-Za-z0-9_]{1,24})$/.exec(String(path || ''));
  if (!m) return undefined;
  const bag = (ctx && ctx[m[1]]) || {};
  const v = bag[m[2]];
  return v === undefined || v === null ? '' : v;
}

/**
 * 字符串插值：把 {{live.x}} / {{state.x}} / {{data.x}} 换成值。
 * 只有这三种前缀、键名限 24 字符 —— 换不了值就原样保留，绝不求值。
 */
export function interpolate(text, ctx) {
  const s = String(text === undefined || text === null ? '' : text);
  if (s.indexOf('{{') < 0) return s;
  return s.replace(TOKEN_REF, (all, bag, key) => {
    const v = readPath(bag + '.' + key, ctx);
    return v === undefined ? '' : String(v);
  });
}

/** 条件求值：字符串按 == 比，两边都能转成数字就按数值比 */
export function testWhen(when, ctx) {
  if (!when || !when.k) return true;
  const left = readPath(when.k, ctx);
  const right = when.v;
  const ln = Number(left);
  const rn = Number(right);
  const numeric = left !== '' && right !== '' && isFinite(ln) && isFinite(rn);
  const cmp = numeric ? ln - rn : (String(left) === String(right) ? 0 : (String(left) < String(right) ? -1 : 1));
  switch (when.op) {
    case 'ne': return cmp !== 0;
    case 'gt': return cmp > 0;
    case 'gte': return cmp >= 0;
    case 'lt': return cmp < 0;
    case 'lte': return cmp <= 0;
    case 'in': return String(right).split(/[、,，|]/).map(x => x.trim()).indexOf(String(left)) >= 0;
    case 'has': return String(left).indexOf(String(right)) >= 0;
    default: return cmp === 0;
  }
}

/* ============================================================
 * 6. 动作（R2 / R4）
 * ============================================================ */
export function normalizeAction(raw) {
  if (raw === undefined || raw === null) return null;
  // 老块里动作常常就是一个字符串（action:"practice"），先补成对象再走同一套校验
  let o = typeof raw === 'string' ? { do: raw } : (typeof raw === 'object' ? raw : null);
  if (!o) return null;
  let kind = String(o.do || o.kind || o.action || '').trim().toLowerCase();
  // 旧指令里的动作名（practice / review / library…）映射过来，老卡片不用改
  const legacy = {
    review: { do: 'navigate', page: 'review' },
    drill: { do: 'practice', source: 'drill' },
    library: { do: 'navigate', page: 'library' },
    history: { do: 'navigate', page: 'history' },
    stats: { do: 'navigate', page: 'stats' },
    streak: { do: 'navigate', page: 'streak' },
    wordbook: { do: 'navigate', page: 'bookSwitch' }
  };
  if (legacy[kind]) {
    const mapped = legacy[kind];
    kind = mapped.do;
    if (mapped.page) o = Object.assign({}, o, { page: mapped.page });
    if (mapped.source) o = Object.assign({}, o, { source: mapped.source });
  }
  if (ACTION_KINDS.indexOf(kind) < 0) kind = 'none';
  if (kind === 'none') return null;

  const out = { do: kind };
  if (kind === 'navigate') {
    // 页面名不认识 → 整个动作作废。以前这里默认 'practice'，
    // 于是"到设置的快捷键"（AI 拼成 setting）点下去跳进了练习页 —— 看起来就是乱跳。
    const pv = pick(o.page, PAGE_NAMES, '');
    if (!pv.value) return null;
    out.page = pv.value;
  } else if (kind === 'practice') {
    out.source = pick(o.source, ['daily', 'review', 'drill'], 'daily').value;
  } else if (kind === 'speak' || kind === 'toast' || kind === 'copy') {
    out.text = str(o.text, 120, '').value;
    if (!out.text) return null;
  } else if (kind === 'state.set') {
    out.key = keyName(o.key, '').value;
    if (!out.key) return null;
    const v = o.value;
    out.value = (typeof v === 'number' && isFinite(v)) ? Math.max(-99999, Math.min(99999, v))
      : (typeof v === 'boolean' ? v : str(v, 40, '').value);
  } else if (kind === 'state.toggle') {
    out.key = keyName(o.key, '').value;
    if (!out.key) return null;
  } else if (kind === 'state.inc') {
    out.key = keyName(o.key, '').value;
    out.by = int(o.by, -LIMITS.MAX_BY, LIMITS.MAX_BY, 1).value;
    if (!out.key) return null;
  }
  return out;
}

/* ============================================================
 * 7. 节点（叶子）
 * ============================================================ */
function itemsOf(v, max, map) {
  return toArray(v).slice(0, max).map(map);
}

const NODE_SCHEMA = {
  title: (o) => ({ text: str(o.text, LIMITS.MAX_TITLE, '').value, level: pick(o.level, ['1', '2'], '1').value }),
  text: (o) => ({ text: str(o.text, LIMITS.MAX_TEXT, '').value }),
  metric: (o) => ({
    label: str(o.label, LIMITS.MAX_SHORT, '').value,
    value: str(o.value, 16, '').value,
    unit: str(o.unit, 8, '').value,
    // bind 与老块的 live 等价：老卡片（stat + live）转过来要继续绑得上真数据
    bind: pick(o.bind || o.live, LIVE_FIELDS, '').value,
    size: pick(o.size, METRIC_SIZES, 'md').value,
    caption: str(o.caption, LIMITS.MAX_SHORT, '').value
  }),
  progress: (o) => ({
    label: str(o.label, LIMITS.MAX_SHORT, '').value,
    value: int(o.value, 0, 100, 0).value,
    bind: pick(o.bind || o.live, LIVE_FIELDS, '').value,
    target: int(o.target, 1, 1000, 100).value,
    showPct: bool(o.showPct, true).value
  }),
  ring: (o) => ({
    label: str(o.label, LIMITS.MAX_SHORT, '').value,
    value: int(o.value, 0, 100, 0).value,
    bind: pick(o.bind || o.live, LIVE_FIELDS, '').value,
    target: int(o.target, 1, 1000, 100).value,
    caption: str(o.caption, LIMITS.MAX_SHORT, '').value
  }),
  checklist: (o) => ({
    items: itemsOf(o.items, LIMITS.MAX_LIST, (it) => {
      const x = objOf(it);
      return { text: str(x.text !== undefined ? x.text : it, 60, '').value, done: bool(x.done, false).value };
    })
  }),
  list: (o) => ({
    items: itemsOf(o.items, LIMITS.MAX_LIST, (x) => str(x, 80, '').value),
    ordered: bool(o.ordered, false).value
  }),
  kv: (o) => ({
    items: itemsOf(o.items, LIMITS.MAX_KV, (it) => {
      const x = objOf(it);
      return { k: str(x.k, 16, '').value, v: str(x.v, LIMITS.MAX_SHORT, '').value };
    })
  }),
  quote: (o) => ({ text: str(o.text, 160, '').value, author: str(o.author, 24, '').value }),
  tags: (o) => ({
    items: itemsOf(o.items, LIMITS.MAX_LIST, (x) => str(x, 20, '').value),
    tone: pick(o.tone, TAG_TONES, 'brand').value
  }),
  chips: (o) => ({
    items: itemsOf(o.items, LIMITS.MAX_LIST, (it) => {
      const x = objOf(it);
      return { text: str(x.text !== undefined ? x.text : it, 16, '').value, value: str(x.value !== undefined ? x.value : x.text, 24, '').value };
    }),
    bind: keyName(o.bind, '').value
  }),
  toggle: (o) => ({
    label: str(o.label, LIMITS.MAX_SHORT, '').value,
    bind: keyName(o.bind, '').value
  }),
  field: (o) => ({
    label: str(o.label, LIMITS.MAX_SHORT, '').value,
    placeholder: str(o.placeholder, LIMITS.MAX_SHORT, '').value,
    bind: keyName(o.bind, '').value
  }),
  image: (o) => ({
    url: imageUrl(o.url).value,
    ratio: num(o.ratio, 0.3, 2.5, 1.4).value,
    caption: str(o.caption, LIMITS.MAX_SHORT, '').value
  }),
  countdown: (o) => ({ title: str(o.title, LIMITS.MAX_SHORT, '').value, date: dateValue(o.date).value }),
  button: (o) => ({
    text: str(o.text, 20, '').value,
    variant: pick(o.variant, BUTTON_VARIANTS, 'primary').value,
    do: normalizeAction(o.do || o.action || o)
  }),
  divider: () => ({}),
  spacer: (o) => ({ h: int(o.h, 4, 80, 16).value })
};

// 别名：老块名 → 新节点名（老卡片一份不改就能继续渲染）
const NODE_ALIAS = { stat: 'metric', header: 'title', para: 'text' };

export const NODE_KINDS = Object.keys(NODE_SCHEMA);
export const ALL_NODE_KINDS = NODE_KINDS.concat(Object.keys(NODE_ALIAS));

/** 归一化一个节点 → 节点对象；救不回来返回 null（整张卡失败才算失败，单个节点不算） */
export function normalizeNode(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let kind = String(raw.kind || raw.type || '').trim().toLowerCase();
  if (NODE_ALIAS[kind]) kind = NODE_ALIAS[kind];
  const build = NODE_SCHEMA[kind];
  if (!build) return null;
  const src = (raw.args && typeof raw.args === 'object') ? raw.args : raw;
  const node = build(src);
  node.kind = kind;
  const style = normalizeStyle(src.style);
  if (Object.keys(style).length) node.style = style;
  const when = normalizeWhen(src.when);
  if (when) node.when = when;
  // 动作统一收在 on.tap 一处：三种写法都认 —— on:{tap:...}、do:{...}（button）、
  // 老块的 action:"practice"。渲染器只读 on.tap，所以 button 的 do 必须搬过来，
  // 否则按钮点了没反应。
  let act = normalizeAction(src.on && src.on.tap ? src.on.tap : src.on);
  if (!act && node.do) act = node.do;
  if (!act) act = normalizeAction(src.do);
  delete node.do;
  if (act) node.on = { tap: act };
  return node;
}

/* ============================================================
 * 8. 分区（容器）
 * ============================================================ */
export function normalizeSection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw;
  const layout = pick(o.layout, LAYOUTS, 'stack').value;
  const items = [];
  const budget = LIMITS.MAX_ITEMS;
  toArray(o.items || o.children).slice(0, budget).forEach(it => {
    const n = normalizeNode(it);
    if (n) items.push(n);
  });
  if (!items.length) return null;
  const sec = {
    layout: layout,
    gap: int(o.gap, LIMITS.MIN_GAP, LIMITS.MAX_GAP, layout === 'stack' ? 12 : 16).value,
    align: pick(o.align, ALIGNS, 'left').value,
    // 默认留空：渲染器按 layout 选（竖排 stretch、横排居中），AI 显式给了才用它的
    valign: pick(o.valign, VALIGNS, '').value,
    items: items
  };
  if (layout === 'grid') sec.cols = int(o.cols, 2, LIMITS.MAX_COLS, 2).value;
  const style = normalizeStyle(o.style);
  if (Object.keys(style).length) sec.style = style;
  const when = normalizeWhen(o.when);
  if (when) sec.when = when;
  const act = normalizeAction(o.on && o.on.tap ? o.on.tap : o.on);
  if (act) sec.on = { tap: act };
  return sec;
}

/* ============================================================
 * 9. 卡片规格总入口
 * ============================================================ */
function normalizeBag(raw, max, maxValueLen) {
  const src = objOf(raw);
  const out = {};
  Object.keys(src).slice(0, max).forEach(k => {
    const key = keyName(k, '').value;
    if (!key) return;
    const v = src[k];
    if (typeof v === 'number' && isFinite(v)) out[key] = Math.max(-999999, Math.min(999999, v));
    else if (typeof v === 'boolean') out[key] = v;
    else out[key] = str(v, maxValueLen, '').value;
  });
  return out;
}

/** 自定义数据字段 / 运行时状态：键名限 24 字符，值做长度与量程夹取 */
export function normalizeDataBag(raw) {
  return normalizeBag(raw, LIMITS.MAX_DATA, 80);
}
export function normalizeStateBag(raw) {
  return normalizeBag(raw, LIMITS.MAX_STATE, 40);
}

/**
 * 归一化整份卡片设计 → { ok, design, reason }
 * 失败的唯一理由：一个可渲染的节点都没有。
 */
export function normalizeDesign(raw) {
  const o = objOf(raw);
  const sections = [];
  let nodes = 0;
  toArray(o.sections || o.rows || o.body).slice(0, LIMITS.MAX_SECTIONS).forEach(s => {
    const sec = normalizeSection(s);
    if (!sec) return;
    if (nodes + sec.items.length > LIMITS.MAX_NODES) {
      // 超预算就截断这一区，而不是整张卡失败
      sec.items = sec.items.slice(0, Math.max(0, LIMITS.MAX_NODES - nodes));
      if (!sec.items.length) return;
    }
    nodes += sec.items.length;
    sections.push(sec);
  });
  if (!sections.length) return { ok: false, design: null, reason: '这份设计里没有可渲染的内容' };
  const design = { v: 2, sections: sections };
  const data = normalizeBag(o.data, LIMITS.MAX_DATA, 80);
  if (Object.keys(data).length) design.data = data;
  const state = normalizeBag(o.state, LIMITS.MAX_STATE, 40);
  if (Object.keys(state).length) design.state = state;
  return { ok: true, design: design, reason: '' };
}

/** 把老的 13 种块序列转成新设计（老卡片零改动继续渲染） */
export function fromLegacyBlocks(blocks) {
  const nodes = [];
  toArray(blocks).forEach(b => {
    const n = normalizeNode(b);
    if (n) nodes.push(n);
  });
  if (!nodes.length) return null;
  const sections = [];
  let statRun = -1;   // 正在累积的"数字组"所在分区下标
  nodes.slice(0, LIMITS.MAX_NODES).forEach(n => {
    // 连续的 stat 合成一行：老渲染器把它们横排等分，转过来也必须还是横排
    if (n.kind === 'metric' && statRun >= 0) {
      sections[statRun].items.push(n);
      return;
    }
    const sec = { layout: 'stack', gap: 0, align: 'left', valign: 'stretch', items: [n] };
    if (n.kind === 'metric') {
      // 补上老样式里"每个数字占一份、居中"的效果（老块本身不带这些参数）
      n.style = Object.assign({}, n.style, { grow: 1, align: 'center' });
      sec.layout = 'row';
      sec.valign = 'center';
      statRun = sections.length;
    } else {
      statRun = -1;
    }
    sections.push(sec);
  });
  return { v: 2, sections: sections };
}

/** 取一张卡真正该用的设计（新 design 优先，否则老 blocks 现转） */
export function designOf(card) {
  const c = card || {};
  if (c.design && Array.isArray(c.design.sections)) return c.design;
  if (Array.isArray(c.blocks) && c.blocks.length) return fromLegacyBlocks(c.blocks);
  return null;
}

/* ============================================================
 * 10. 给模型的规格手册（由 schema 推导，永远与实现一致）
 * ============================================================ */
export function promptSpec() {
  const L = LIMITS;
  return [
    '【卡片设计规格 card.design】想造一张自由设计的卡片时用它，比 card.add 的表达力强得多。',
    '注意：**新建**卡片时省略 target（写了 target:"" 或 null 会被当成错误）；只有改造某张现有卡片才给 target。',
    '结构：design = { sections: [ { layout, gap, align, valign, cols, style, when, items: [节点] } ], data:{}, state:{} }',
    '  layout：stack 竖排 / row 横排 / grid 网格（grid 用 cols 定 2-4 列）',
    '  gap ' + L.MIN_GAP + '-' + L.MAX_GAP + 'rpx，align left/center/right，valign start/center/end/stretch',
    '  节点横向占比用 style.grow（0-6）；固定宽用 style.w（rpx 或 "full"）；固定高 style.h',
    '  最多 ' + L.MAX_SECTIONS + ' 个区，每区最多 ' + L.MAX_ITEMS + ' 个节点，整卡最多 ' + L.MAX_NODES + ' 个节点',
    '',
    '可用节点 kind：' + NODE_KINDS.join(' / '),
    '  title{text,level}  text{text}  metric{label,value,unit,bind,size,caption}  progress{label,value,bind,target,showPct}',
    '  ring{label,value,bind,target,caption}  checklist{items:[{text,done}]}  list{items,ordered}  kv{items:[{k,v}]}',
    '  quote{text,author}  tags{items,tone}  chips{items:[{text,value}],bind}  toggle{label,bind}  field{label,placeholder,bind}',
    '  image{url,ratio,caption}  countdown{title,date}  button{text,variant,do}  divider{}  spacer{h}',
    '',
    '样式 style（节点与分区通用，写几个生效几个）：',
    '  bg(#hex 或 令牌名 或 {from,to,angle})  fg  tone(normal/muted/strong/brand/danger/warn/ok)',
    '  radius ' + L.MIN_RADIUS + '-' + L.MAX_RADIUS + '  pad ' + L.MIN_PAD + '-' + L.MAX_PAD + '  border{w,c}  shadow(none/soft/lifted)',
    '  align  valign  size ' + L.MIN_FONT + '-' + L.MAX_FONT + '  weight(400/500/600)  lh  serif  italic  deco  grow  w  h  opacity',
    '  颜色令牌：' + PAINT_NAMES.filter(x => x !== 'clear').join('/') + '（给令牌名会跟随主题，给 #hex 是固定色）',
    '',
    '数据绑定：任何文案里都能写 {{live.字段名}} / {{state.键}} / {{data.键}}，渲染时替换成真值。',
    '  可用 live 字段：' + LIVE_FIELDS.join(', '),
    '  data 是你在 design.data 里自己定义的字段（' + L.MAX_DATA + ' 个以内），state 是卡片运行时状态（可点击改变）。',
    '',
    '交互（节点的 on.tap 或 button 的 do）：',
    '  navigate{page:' + PAGE_NAMES.join('/') + '}  practice{source:daily/review/drill}',
    '  speak{text}  toast{text}  copy{text}  refresh{}',
    '  state.set{key,value}  state.toggle{key}  state.inc{key,by}',
    '',
    '条件显示（节点或分区的 when）：{ k:"live.streak"|"state.tab"|"data.x", op:eq/ne/gt/gte/lt/lte/in/has, v:"..." }',
    '',
    '红线（做不到，别试）：不能执行代码 / 不能发网络请求 / 不能读写文件或学习数据 /',
    '不能跳白名单以外的页面或外链 / 拿不到任何密钥与个人信息 / 图片地址只认 https 与本地文件。'
  ].join('\n');
}

/** 红线清单：给 UI 展示 + 给校验脚本对照 */
export const RED_LINES = [
  '不执行代码：没有 eval、没有函数构造、没有模板求值、没有原始 HTML 注入，{{}} 只做白名单键的值替换',
  '不碰系统：读不到文件、数据库、设备信息；写只能写自己这张卡的文档',
  '不碰凭据：数据目录只含学习统计，没有任何密钥 / 账号 / 手机号，也没有发起请求的能力',
  '不越权跳转：只能跳 PAGE_ROUTES 白名单内的页面，没有打开任意外链的动作',
  '不泄漏：图片地址只放行 https 与本地文件，禁 data:image/svg',
  '不崩溃：层数 / 节点数 / 文本长度 / 列表长度全部有硬上限，渲染是展平后的一层循环',
  '不阻塞：规格里没有网络请求、没有同步大写入、没有定时器'
];

/** 可自定义范围（给文档与 UI 展示） */
export const FREEDOM = [
  '布局：分区数量与顺序、每区竖排 / 横排 / 网格列数、间距、对齐、伸缩比例、固定宽高',
  '样式：底色（纯色 / 渐变 / 令牌）、圆角、内边距、描边、投影、字号字重行高、衬线 / 斜体 / 下划线、透明度',
  '数据：自定义字段、绑定真实学习数据、按条件显示',
  '交互：点击跳转 / 开始练习 / 朗读 / 复制 / 轻提示 / 改卡片内状态（开关、切换、累加）',
  '内容：任何文案、清单、键值对、标签、可切换 chip、开关、输入框、引言、倒计时、图片、分隔、留白'
];

export { num, int, str, bool, pick, paint, imageUrl, keyName, dateValue, toArray, objOf, HEX };
