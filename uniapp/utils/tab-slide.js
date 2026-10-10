// utils/tab-slide.js - 底部 tab 的次序、切换方向与"内容左右滑动"
import * as i18n from './i18n.js';
//
// 两个职责：
//  1) 记录"从哪个 tab 切到哪个 tab"，让目标页进场时知道该从左还是从右滑入
//     （索引变大 → 从右滑入；索引变小 → 从左滑入）
//  2) 手势拖拽的参数与阻尼：内容跟手位移，松手超过阈值才切页，否则弹回
//
// tab 页在 uni-app 里是常驻的（switchTab 不销毁），所以"上一次停留的 tab"
// 这类跨页状态必须放模块级，不能放组件实例里。

// 唯一的 tab 次序来源：底栏组件、切换方向、手势都读它
export const TABS = [
  { key: 'home', text: '首页', path: '/pages/home/home', icon: '/static/tabbar/home.png', active: '/static/tabbar/home-active.png' },
  { key: 'library', text: '词库', path: '/pages/library/library', icon: '/static/tabbar/library.png', active: '/static/tabbar/library-active.png' },
  { key: 'review', text: '错题', path: '/pages/review/review', icon: '/static/tabbar/wrong.png', active: '/static/tabbar/wrong-active.png' },
  { key: 'profile', text: '我的', path: '/pages/profile/profile', icon: '/static/tabbar/profile.png', active: '/static/tabbar/profile-active.png' }
];

export const TAB_TEXT_EN = {
  home: 'Home',
  library: 'Library',
  review: 'Wrong',
  profile: 'Me'
};

export function tabIndex(key) {
  for (let i = 0; i < TABS.length; i++) if (TABS[i].key === key) return i;
  return -1;
}

// 底栏文案：zh 用 TABS 里的中文，en 用 TAB_TEXT_EN（底栏空间小，英文要短）
export function tabText(key) {
  const t = TABS.filter(x => x.key === key)[0];
  if (!t) return '';
  try {
    if (typeof i18n !== 'undefined' && i18n.isEn && i18n.isEn()) return TAB_TEXT_EN[key] || t.text;
  } catch (e) {}
  return t.text;
}

export function tabAt(i) {
  return i >= 0 && i < TABS.length ? TABS[i] : null;
}

// ---------- 切换意图 ----------
// 点击底栏或手势松手都会先写这里，目标页 onShow 时取走（取走即失效，只播一次）
let pending = null;
const PENDING_TTL = 1500;   // 超过这个时间没被取走就当废弃（防止误播）

// ---------- 离场回调：key → fn ----------
// 关键设计（2026-10-09 二次重做）：**动画只做在"当前看得见的那一页"上**。
// tab 页在 App 端是独立 webview，切走之后它处于隐藏状态 —— 往隐藏页下发样式
// 能不能被画上去并不可靠（实测就是画不上：页面一显示先闪一下最终位置，再被
// 推回起点，也就是用户说的"一闪一闪"）。所以：
//   · 切走前：当前页（可见）播「离场」—— 轻移 + 淡出到 0，可靠可控；
//   · 切过来：目标页的起始状态就是它上次离场时留下的（透明 + 轻微偏移），
//     那是它自己可见时画好的，显示时第一帧必然是它 → 只需淡入归位，不会跳变。
// 因此这里登记的是"离场"，不再是"进场预备"。
const leaves = {};

export function onLeave(key, fn) { leaves[key] = fn; }
export function offLeave(key) { delete leaves[key]; }

// 由底栏在 switchTab 之前调用：让当前页先让位。返回是否真的播了离场
export function requestLeave(key, dir) {
  const fn = leaves[key];
  if (!fn) return false;
  fn(dir);
  return true;
}

// ---------- 手势切页时通知底栏：key → fn ----------
// 手势路径里底栏是"旁观者"：不通知的话，它要等新页显示（内容推出屏幕之后）才开始
// 追，和手指动作差出 200ms，看起来就是底栏慢半拍 / 来回追。这里让页面刚决定切页
// 时就告诉底栏目标，两者同时开始动。
const previews = {};

export function onPreview(key, fn) { previews[key] = fn; }
export function offPreview(key) { delete previews[key]; }

export function notifyPreview(key, toKey) {
  const fn = previews[key];
  if (!fn) return false;
  fn(toKey);
  return true;
}

// ---------- 底栏的共享状态（胶囊位置 + 选中态）----------
//
// 【为什么不放在组件实例里】
// tab 页常驻，每个页面各有**一个**底栏实例；而点击 / 手势都只通知"当前可见那一页"的实例
// （见上面的 previews）。被切走的实例收不到任何更新，它私有那份 indIndex / pending 就永远
// 停在切走那一刻。页面再次显示时浏览器先按那份**旧值**画一帧，Vue 随后才把新值贴上去 ——
// 于是胶囊会再从旧位置滑一次（明明早就在目标上），或者高亮先指在别人身上再被拽回来。
// 这就是"点快了动画就坏"。老实现用 clearStalePending + 20ms 跳帧事后纠偏，时序一乱就露馅。
// 根治办法：真相只有一份，放在这里；所有实例订阅它 —— 连那些暂时看不见的实例也同步跟着变，
// 显示出来时第一帧就是对的，不需要任何"回来再修一次"的机制。
const ui = { ind: -1, active: '' };
const watchers = [];

function notifyUI() {
  for (let i = 0; i < watchers.length; i++) {
    try { watchers[i](ui) } catch (e) { /* 某个实例坏了不能拖住别的页面 */ }
  }
}

// 订阅（返回退订函数）。订阅的当下先发一次当前值 —— 冷启动第一帧就能拿到真相。
export function watchTabUI(fn) {
  watchers.push(fn);
  try { fn(ui) } catch (e) {}
  return function () {
    const i = watchers.indexOf(fn);
    if (i >= 0) watchers.splice(i, 1);
  };
}

export function tabUI() { return ui; }

// 指示胶囊移到第 i 格（幂等：重复指到同一格不会再触发一次位移）
export function moveIndicator(i) {
  const n = (typeof i === 'number' && i >= 0) ? i : -1;
  if (n === ui.ind) return false;
  ui.ind = n;
  notifyUI();
  return true;
}

// 选中态：点击瞬间先把高亮给手指指着的那一格（页面还没切走）
export function highlightTab(key) {
  if (ui.active === key) return false;
  ui.active = key;
  notifyUI();
  return true;
}

// 某个 tab 页真的显示了：高亮归它，胶囊也必须在它的格子上。
// 这是唯一的"纠偏"入口，但它不猜时间 —— 由页面自己上报（onShow → nav.syncTabbar），
// 所以不存在"猜早了/猜晚了"那一类问题。
export function settleTab(key) {
  const i = tabIndex(key);
  if (i < 0) return false;
  let changed = moveIndicator(i);
  if (ui.active !== key) { ui.active = key; changed = true; }
  if (changed) notifyUI();
  return changed;
}

// ---------- 排队中的切页：可以被"改主意"覆盖 ----------
// 点底栏时先让当前页淡出（LEAVE.SWITCH_AT）再真切。在这段"已经决定了但还没走"的窗口里再点
// 一次，既不该被**吞掉**（旧实现是实例级 350ms 锁 —— 连点就像点了没反应），也不该**排两次**
// （两次 switchTab 会把两套动画搅在一起）。正确做法是改目的地：换掉排队中的那一次，
// 而且不延后原本的出发时间 —— 第一次点击时当前页已经开始让位了。
let navTimer = 0;
let navAt = 0;

export function scheduleNav(fn, delay) {
  cancelNav();
  const now = Date.now();
  if (!navAt) navAt = now + Math.max(0, delay || 0);
  const wait = Math.max(0, navAt - now);
  navTimer = setTimeout(function () {
    navTimer = 0;
    navAt = 0;
    try { fn() } catch (e) { /* 切页失败就算了：内容还在原处，离场有兜底恢复 */ }
  }, wait);
  return wait;
}

export function cancelNav() {
  if (navTimer) { try { clearTimeout(navTimer) } catch (e) {} }
  navTimer = 0;
}

export function navPending() { return !!navTimer; }

export function markSwitch(fromKey, toKey) {
  const from = tabIndex(fromKey);
  const to = tabIndex(toKey);
  if (from < 0 || to < 0 || from === to) return '';
  const dir = to > from ? 'right' : 'left';
  pending = { from: from, to: to, at: Date.now(), dir: dir };
  return dir;
}

// 目标页调用：返回 { dir }（dir 为 '' 表示这次没有切换意图）
export function takeEnterInfo(key) {
  if (!pending) return { dir: '' };
  const p = pending;
  pending = null;                                  // 一次性消费
  if (tabIndex(key) !== p.to) return { dir: '' };           // 不是这次的目标页
  if (Date.now() - p.at > PENDING_TTL) return { dir: '' };  // 过期
  return { dir: p.dir };
}

// 目标页调用：返回 'left' | 'right' | ''（只要方向的简版）
export function takeEnter(key) {
  return takeEnterInfo(key).dir;
}

export function clearPending() {
  pending = null;
}

// ---------- 离场 / 进场参数 ----------
// 平级 tab 之间不做整屏飞行：整屏位移一旦起始帧没画准，跳变会非常明显。
// 现在位移只做"让位"的一点点，主体交给不透明度（淡出 → 淡入），
// 即便某一帧没赶上，也只是"淡一点的差别"，不会闪。
export const LEAVE = {
  DX: 40,          // 离场位移(px)：轻移一点示意方向，主体是淡出
  DUR: 130,        // 点击底栏：离场时长
  SWITCH_AT: 90,   // 离场播到 90ms 才真正 switchTab（此时旧内容基本已淡看不见）
  OUT_MIN: 110,    // 手势：继续把内容推出屏幕的最小时长
  OUT_MAX: 190,    // 手势：推屏最长时长
  ENTER_DUR: 220   // 目标页淡入归位时长
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

let _sw = 0;
export function screenWidth() {
  if (_sw) return _sw;
  try {
    const s = (typeof uni !== 'undefined' && uni.getSystemInfoSync) ? uni.getSystemInfoSync() : null;
    _sw = (s && s.windowWidth) || 375;
  } catch (e) { _sw = 375; }
  return _sw;
}

// 手势松手后把内容推出屏幕所需时长：按剩余距离算（约 0.55ms/px）
export function outDuration(from, to) {
  return Math.round(clamp(Math.abs(to - from) * 0.55, LEAVE.OUT_MIN, LEAVE.OUT_MAX));
}

// ---------- 手势参数 ----------
export const DRAG = {
  AXIS: 8,        // 判定方向所需的最小位移(px)
  RATIO: 1.2,     // 横向要明显大于纵向才认作横滑（否则让页面正常上下滚）
  MAX: 120,       // 兜底上限(px)：拿不到屏宽时用
  MAX_RATIO: 0.45,// 正常跟手区间 = 屏宽的 45%，超过才加阻尼（原来固定 120px，
                  //   手指一拖到底就撞墙，跟手区间太短是"不自然"的一大来源）
  TRIGGER: 60,    // 松手触发切页的位移阈值(px)
  V_MIN_DX: 36,   // 轻扫判定的最小位移
  V_TRIGGER: 0.45,// 轻扫判定的速度阈值(px/ms)：快速一甩不必拖满 60px
  EDGE: 0.3       // 首尾页（没有相邻页）只给 30% 位移，提示"到头了"
};

// 阻尼：越界后位移增速降到 1/4，手指拖再远也不会把内容甩出屏幕
// max 省略时用 DRAG.MAX 兜底（保持旧调用的行为）
export function dampOffset(dx, max) {
  const m = max || DRAG.MAX;
  const sign = dx < 0 ? -1 : 1;
  const a = Math.abs(dx);
  if (a <= m) return dx;
  return sign * (m + (a - m) * 0.25);
}

// 相邻 tab：step = -1 上一个，+1 下一个；没有就返回 null（边缘）
export function neighbor(key, step) {
  return tabAt(tabIndex(key) + step);
}
