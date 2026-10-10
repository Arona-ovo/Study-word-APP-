// _tools/check-tabbar.js - 悬浮底栏的滑动过渡校验（只读，把 .vue 的 script 抽出来跑）
//
// 模型（2026-10-10 重构）：胶囊位置 / 选中态的唯一真相在 utils/tab-slide.js 的共享状态里，
// 每个 tab 页的实例只订阅它。这样被切走的实例也会同步更新 —— 显示出来的第一帧就是对的，
// 不再需要"回来再修一次"的事后纠偏（那正是连点动画错乱的根因）。
//
// 回归点：
//  1) 点击瞬间高亮 + 胶囊同步动到目标（不等页面挂载）
//  2) 所有实例（含隐藏的）都跟着共享状态变 —— 连点也不会出现"从旧位置再滑一次"
//  3) 排队中的切页可被"改主意"覆盖：连点不同 tab 只切到最后那个、且只切一次
//  4) 连点同一个 tab 不重复导航
//  5) 页面回来（mounted / onShow → settle）幂等，不会产生多余的滑动
//  6) 手势 preview 只动胶囊、不动高亮，且幂等
//  7) 不再需要 .no-anim（所有实例共享位置，不存在"先画一帧旧的"）
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'uniapp', 'components', 'float-tabbar', 'float-tabbar.vue');
const src = fs.readFileSync(FILE, 'utf8');
// 去掉 import（new Function 不支持），依赖改为注入
const script = src.slice(src.indexOf('<script>') + 8, src.lastIndexOf('</script>'))
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '');

// export default {...} → const COMP = {...}
const code = script.replace('export default', 'const COMP =') + '\n; return { COMP: COMP };';

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + b);
  else bad(label + ' 期望 ' + b + '，实际 ' + a);
}
function truthy(a, label) { if (a) ok(label); else bad(label + ' 期望真，实际 ' + a); }

// ---------- 受控定时器（可被 flush 精确驱动，cancel 真生效） ----------
let timers = [];
let tid = 0;
const fakeSetTimeout = (fn, ms) => { const id = ++tid; timers.push({ id, fn: fn, ms: ms || 0 }); return id; };
const fakeClearTimeout = (id) => { timers = timers.filter(t => t.id !== id); };
function flushUntil(ms) {
  const run = timers.filter(t => t.ms <= ms).sort((a, b) => a.ms - b.ms);
  timers = timers.filter(t => t.ms > ms);
  run.forEach(t => t.fn());
}

const navCalls = [];
const uniMock = { switchTab: (o) => navCalls.push(o && o.url) };

// 注入真实的 utils/tab-slide.js（带受控定时器）—— 它的 watchTabUI / moveIndicator /
// highlightTab / settleTab / scheduleNav 共用同一份共享状态，正好用来验证"所有实例同步"。
const { load } = require('./lib/load');
const tabSlide = load('utils/tab-slide.js', { setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout });
const switchCalls = [];
const slideMock = Object.assign({}, tabSlide, {
  markSwitch: (from, to) => { const d = tabSlide.markSwitch(from, to); switchCalls.push({ from, to, dir: d }); return d; }
});

const api = new Function(
  'uni', 'setTimeout', 'clearTimeout',
  'TABS', 'tabIndex', 'markSwitch', 'requestLeave', 'LEAVE', 'onPreview', 'offPreview',
  'watchTabUI', 'moveIndicator', 'highlightTab', 'settleTab', 'scheduleNav',
  code
)(uniMock, fakeSetTimeout, fakeClearTimeout,
  tabSlide.TABS, tabSlide.tabIndex, slideMock.markSwitch, slideMock.requestLeave, tabSlide.LEAVE,
  tabSlide.onPreview, tabSlide.offPreview, tabSlide.watchTabUI, tabSlide.moveIndicator,
  tabSlide.highlightTab, tabSlide.settleTab, tabSlide.scheduleNav);

// 模拟一个页面里的组件实例：created 会订阅共享状态，settle 上报"当前是我"
function mount(curIndex, keep) {
  const ctx = Object.assign({}, api.COMP.data(), api.COMP.methods, keep || {});
  ctx.current = tabSlide.TABS[curIndex].key;
  Object.defineProperty(ctx, 'indX', { get: () => api.COMP.computed.indX.call(ctx), configurable: true });
  Object.defineProperty(ctx, 'curIndex', { get: () => api.COMP.computed.curIndex.call(ctx), configurable: true });
  if (api.COMP.created) api.COMP.created.call(ctx);   // 订阅共享状态（立刻拿到当前值）
  return ctx;
}

console.log('== 1. tab 次序与页面路径 ==');
eq(tabSlide.TABS.length, 4, 'tab 数量');
eq(tabSlide.tabIndex('review'), 2, 'review 下标');
eq(tabSlide.tabAt(9), null, '越界返回 null');

console.log('== 2. 冷启动：共享状态初始 ind=-1，active 空（由首个页面 settle 落位）==');
const home = mount(0);
eq(home.indIndex, -1, '初始胶囊位置 = -1（未落位）');
eq(home.activeKey, '', '初始高亮为空');
home.settle();
eq(home.indIndex, 0, '首个页面上报后胶囊落到首页');
eq(home.activeKey, 'home', '首个页面上报后高亮 = home');

console.log('== 3. 点击：高亮 + 胶囊立刻同步到全局（所有订阅实例一起变）==');
const lib = mount(1);
const rev = mount(2);
home.go({ currentTarget: { dataset: { k: 'library' } } });
eq(home.activeKey, 'library', '点击方：高亮立刻变（不等页面挂载）');
eq(home.indIndex, 1, '点击方：胶囊立刻动到 library');
eq(lib.indIndex, 1, '隐藏的 library 实例也同步到了 1（不再停在旧位置）');
eq(lib.activeKey, 'library', '隐藏的 library 实例高亮也同步了');
eq(rev.indIndex, 1, '连未触碰的 review 实例也跟着同步到了 1（共享状态，隐藏实例不再停在旧值）');
flushUntil(tabSlide.LEAVE.SWITCH_AT);
eq(navCalls[0], '/pages/library/library', '切页发生在离场之后');

console.log('== 4. 回归点：mounted + 页面 onShow 重复上报幂等（不产生多余滑动）==');
const lib2 = mount(1);
lib2.sync();                 // mounted
lib2.sync();                 // 页面 onShow 再调一次
eq(lib2.indIndex, 1, '重复 sync 位置不变');
eq(lib2.activeKey, 'library', '重复 sync 高亮不变');

console.log('== 5. 连点不同 tab：改目的地，只切最后一次、且只切一次 ==');
navCalls.length = 0;
switchCalls.length = 0;
const me = mount(3);
me.go({ currentTarget: { dataset: { k: 'home' } } });     // 先点 home
me.go({ currentTarget: { dataset: { k: 'library' } } });  // 立刻改主意点 library（同一页面实例，都可见）
eq(me.activeKey, 'library', '高亮落到最后一次点的 library');
eq(me.indIndex, 1, '胶囊落到 library');
flushUntil(tabSlide.LEAVE.SWITCH_AT);
eq(navCalls.length, 1, '只切了一次（没有被排两次）');
eq(navCalls[0], '/pages/library/library', '目的地是最后一次点的 library');
eq(switchCalls.length, 2, '记了两次方向（第一次被改主意覆盖）');

console.log('== 6. 连点同一个 tab：不重复导航 ==');
navCalls.length = 0;
const me2 = mount(3);
me2.go({ currentTarget: { dataset: { k: 'home' } } });
me2.go({ currentTarget: { dataset: { k: 'home' } } });   // 再点同一格（activeKey 已是 home）
flushUntil(tabSlide.LEAVE.SWITCH_AT);
eq(navCalls.length, 1, '点到同一个 tab 不重复切页');

console.log('== 7. 页面回来（settle）不会把高亮指到别人身上 ==');
// home 实例之前高亮被改成 library（见第 3 组），现在 home 重新成为可见页
home.settle();
eq(home.activeKey, 'home', 'home 上报后高亮归位到 home（不残留 library）');
eq(home.indIndex, 0, '胶囊也回到 home');

console.log('== 8. 手势 preview：只动胶囊、不动高亮，且幂等 ==');
const home3 = mount(0);
home3.settle();
home3.preview('library');
eq(home3.indIndex, 1, '手势一松手胶囊就跟着走（不等新页显示）');
eq(home3.activeKey, 'home', '胶囊动但不高亮跳过去（避免滑回来时被拽回 → 晃）');
home3.preview('library');
eq(home3.indIndex, 1, '重复 preview 幂等');

console.log('== 9. activeKey 是全局高亮的镜像（数据，非 computed）==');
const vm = { indIndex: 2, activeKey: 'review' };
eq(vm.activeKey, 'review', '高亮镜像 = review');
eq(api.COMP.computed.indX.call({ indIndex: 2 }), 200, 'indX 随 indIndex 换算（2 → 200%）');

console.log('== 10. 指示器用 transform 平移，时长落在"跟手"区间 ==');
const style = src.slice(src.lastIndexOf('<style'));
const m = style.match(/transition:\s*transform\s+(\d+)ms/);
if (m) {
  const ms = Number(m[1]);
  if (ms <= 260) ok('指示胶囊滑动 ' + ms + 'ms（transform，≤260ms）');
  else bad('滑动 ' + ms + 'ms 偏慢');
} else {
  bad('未找到指示胶囊的 transform transition');
}
if (/\.ftb-ind\s*\{[^}]*width:\s*25%/s.test(style)) ok('指示层宽度 25%（与 flex:1 的 item 对齐）');
else bad('指示层宽度不是 25%，滑到后面的 tab 会错位');
if (/left:\s*calc\(/.test(style)) bad('仍在用 left + calc 定位（应改 transform）');
else ok('不再用 left + calc（避免每帧重排）');

console.log('== 10b. 不再需要 .no-anim（所有实例共享位置，不存在"先画一帧旧的"）==');
if (/\.ftb-ind\.no-anim\b/.test(style)) bad('还存在 .no-anim —— 说明还在用"跳起点"的补丁');
else ok('已移除 .no-anim（连点不再靠关过渡来纠偏）');

// ---------------------------------------------------------------------------
// 11. 可见性锚点：「底部导航不见了」回归防线
console.log('== 11. 可见性锚点（防「底栏不见了」复发）==');
const wrapCss = style.slice(style.indexOf('.ftb-wrap'), style.indexOf('}', style.indexOf('.ftb-wrap')));
if (/position:\s*fixed/.test(wrapCss)) ok('外层 .ftb-wrap 是 fixed（贴视口底部）');
else bad('外层 .ftb-wrap 不是 fixed —— 底栏会随页面滚走');
if (/bottom:\s*0/.test(wrapCss)) ok('贴底 bottom: 0');
else bad('缺少 bottom: 0');
const mz = wrapCss.match(/z-index:\s*(\d+)/);
if (mz && Number(mz[1]) >= 500) ok('z-index ' + mz[1] + '（压过页面内容）');
else bad('z-index 过低或缺失 —— 会被其它浮层盖住');
const navSrc = fs.readFileSync(path.join(__dirname, '..', 'uniapp', 'utils', 'nav.js'), 'utf8');
if (/plus\.webview\.currentWebview\(\)/.test(navSrc) && /setStyle\(\{\s*bottom/.test(navSrc)) {
  ok('App 端 hide 之后强制 webview 重排（plus.webview.setStyle bottom）');
} else bad('缺少 webview 重排兜底 —— 原生 tabBar 隐藏后底栏会沉底');
const shotList = navSrc.match(/\[\s*\d+\s*(?:,\s*\d+\s*){2,}\]/g) || [];
const shots = shotList.reduce((n, s) => n + (s.match(/\d+/g) || []).length, 0);
if (shots >= 4) ok('补了 ' + shots + ' 个时间点的幂等 hide（冷启动 / switchTab / 回前台都不漏）');
else bad('补刀时间点不足（' + shots + ' 个）');
if (/probeVisible/.test(src)) ok('App 端有可见性自检日志（inspect 时直接看 lost 数值定性）');
else bad('缺少可见性自检 —— 下次再消失只能靠猜');

// ---------------------------------------------------------------------------
// 12. 图标颜色必须跟着主题色走
console.log('== 12. 图标跟随主题色 ==');
if (/function maskSupported\(\)/.test(script) && /CSS\.supports\(/.test(script)) {
  ok('用 CSS.supports 探测能否用 mask 上色（不支持就兜底）');
} else bad('缺少 mask 能力探测 —— 不支持的端会渲染出空方块');
if (/typeof CSS === 'undefined'/.test(script)) ok('无 DOM 环境（小程序逻辑层）判定为不支持 → 走兜底');
else bad('没有处理 CSS 全局不存在的情况');
const tplPart = src.slice(0, src.indexOf('</template>'));
if (/v-if="maskOk"[\s\S]{0,400}v-else/.test(tplPart)) ok('模板两路分支：mask 版 / 原图版');
else bad('模板没有 mask 与兜底两路');
if (/maskOk:\s*maskSupported\(\)/.test(script)) ok('maskOk 进 data（每个实例一次探测结果）');
else bad('maskOk 没进 data');

const maskCss = style.slice(style.indexOf('.ftb-icon-mask'));
const maskBlock = maskCss.slice(0, maskCss.indexOf('\n}'));
if (/background-color:\s*var\(--ink-3/.test(maskBlock)) ok('未选中图标色 = var(--ink-3)（深色模式自动变浅）');
else bad('未选中图标色没有用 --ink-3');
const activeMask = style.slice(style.indexOf('.ftb-item.active .ftb-icon-mask'));
if (/background-color:\s*var\(--brand/.test(activeMask.slice(0, activeMask.indexOf('\n}')))) ok('选中图标色 = var(--brand)（跟着主题色走）');
else bad('选中图标色没有用 --brand —— 换主题色图标还是不变');

tabSlide.TABS.forEach((t) => {
  const re = new RegExp('\\.ico-' + t.key + '\\s*\\{[^}]*mask-image:\\s*url\\([\'"]([^\'")]+)[\'"]\\)');
  const m2 = style.match(re);
  if (!m2) { bad('缺少 .ico-' + t.key + ' 的 mask-image'); return; }
  const rel = m2[1].replace(/^\//, '');
  if (fs.existsSync(path.join(__dirname, '..', 'uniapp', rel))) ok('ico-' + t.key + ' 蒙版指向真实文件 ' + rel);
  else bad('.ico-' + t.key + ' 指向的文件不存在：' + rel);
});
const icoCount = (style.match(/\.ico-[a-z]+\s*\{/g) || []).length;
if (icoCount === tabSlide.TABS.length) ok('蒙版类数量与 tab 数一致 = ' + icoCount);
else bad('蒙版类数量 ' + icoCount + ' ≠ tab 数 ' + tabSlide.TABS.length);
if (/v-else[\s\S]{0,200}:src="activeKey === t\.key \? t\.active : t\.icon"/.test(tplPart)) {
  ok('兜底分支仍是两张图切换（小程序行为不变）');
} else bad('兜底分支丢了 —— 不支持 mask 的端会没有图标');

// ---- 13. 胶囊不能太透 ----
console.log('== 13. 胶囊不透明度 ==');
const ftbBlock = style.slice(style.indexOf('\n.ftb {'));
const ftbAlpha = (ftbBlock.match(/rgba\(var\(--surface-rgb[^)]*\),\s*([0-9.]+)\)/) || [])[1];
if (ftbAlpha === undefined) bad('找不到 .ftb 的 rgba(var(--surface-rgb), α) 底色');
else if (Number(ftbAlpha) >= 0.8) ok('.ftb 底色不透明度 = ' + ftbAlpha + '（≥ 0.8，下面的文字不透出来）');
else bad('.ftb 底色太透（' + ftbAlpha + ' < 0.8）—— 滚动内容的大字会透出来');
if (/background:\s*rgba\(var\(--surface-rgb/.test(ftbBlock)) ok('.ftb 底色走 --surface-rgb（深色档自动变深）');
else bad('.ftb 底色写死了颜色 —— 深色模式下会是一块白');

console.log('');
console.log(fail === 0 ? '底栏过渡全部通过' : '失败 ' + fail + ' 项');
process.exitCode = fail ? 1 : 0;
