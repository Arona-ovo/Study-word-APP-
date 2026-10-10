// _tools/check-tab-slide.js - tab 切换的"内容左右滑动"校验
// 模型（2026-10-09 二次重做）：动画只做在**当前可见的那一页**上
//   · 切走前：本页播离场（轻移 + 淡出到 0）→ 可靠，因为此刻它看得见
//   · 切过来：目标页从"上次离场留下的状态"淡入归位 → 起始帧是它自己可见时画好的
//   · 首次进入：data 初值就是离场态（透明），首屏渲染即透明 → 也不会凭空一闪
// 覆盖：方向判定、意图一次性消费、手势阈值与阻尼、边缘、离场/进场、手势推出屏幕
const { load } = require('./lib/load');

// uni 要在 load 之前注入（load.js 的沙箱会把 global.uni 拷进上下文）
const navCalls = [];
global.uni = { switchTab: (o) => navCalls.push(o && o.url) };

// 受控定时器：enter() 的"等一帧再归位"依赖 setTimeout（rAF 在 vm 沙箱里不存在，
// afterPaint 自动退回 setTimeout），这里接管它，flush 到指定毫秒再驱动，才能确定性地验。
let timers = [];
let tid = 0;
const fakeSetTimeout = (fn, ms) => { const id = ++tid; timers.push({ id, fn: fn, ms: ms || 0 }); return id; };
const fakeClearTimeout = (id) => { timers = timers.filter(t => t.id !== id); };
function flushUntil(ms) {
  const run = timers.filter(t => t.ms <= ms).sort((a, b) => a.ms - b.ms);
  timers = timers.filter(t => t.ms > ms);
  run.forEach(t => t.fn());
}

const ts = load('utils/tab-slide.js');
const mixinFactory = load('utils/tab-slide-mixin.js', { tabSlide: ts, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout });
const mixin = mixinFactory.default || mixinFactory;

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + b);
  else bad(label + ' 期望 ' + b + '，实际 ' + a);
}

console.log('== 1. tab 次序是唯一来源 ==');
eq(ts.TABS.map(t => t.key).join(','), 'home,library,review,profile', 'tab 次序');
eq(ts.tabIndex('library'), 1, 'library 下标');
eq(ts.tabIndex('nope'), -1, '未知 key');

console.log('== 2. 方向：按索引大小决定 ==');
ts.clearPending();
eq(ts.markSwitch('home', 'review'), 'right', '索引变大 → right');
eq(ts.takeEnter('review'), 'right', 'review 取到 right');
eq(ts.takeEnter('review'), '', '只能取一次（不会重复播）');
ts.clearPending();
eq(ts.markSwitch('profile', 'home'), 'left', '索引变小 → left');
eq(ts.takeEnter('home'), 'left', 'home 取到 left');
ts.clearPending();
eq(ts.markSwitch('home', 'home'), '', '同一个 tab 不记方向');
eq(ts.takeEnter('home'), '', '没有意图时不播动画');

console.log('== 3. 非目标页 / 过期意图都不得播放 ==');
ts.clearPending();
ts.markSwitch('home', 'library');
eq(ts.takeEnter('review'), '', '不是目标页 → 不播');
ts.clearPending();
ts.markSwitch('home', 'review');
const realNow = Date.now;
Date.now = () => realNow() + 5000;      // 假装过了 5 秒
eq(ts.takeEnter('review'), '', '过期意图不播（避免误播）');
Date.now = realNow;

console.log('== 4. 手势：阻尼与阈值 ==');
eq(ts.dampOffset(60), 60, '阈值以内原样跟手');
eq(ts.dampOffset(-60), -60, '负方向同样跟手');
const damped = ts.dampOffset(300);
if (damped > 120 && damped < 200) ok('超出上限后加阻尼 = ' + damped);
else bad('阻尼异常：' + damped);
eq(Math.sign(ts.dampOffset(-300)), -1, '阻尼保持方向');
eq(ts.dampOffset(160, 375 * ts.DRAG.MAX_RATIO), 160, '跟手区间放宽到屏宽 45%（160px 仍 1:1）');
eq(ts.neighbor('home', -1), null, '首页再往左没有相邻页');
eq(ts.neighbor('home', 1).key, 'library', '首页往右是词库');
eq(ts.neighbor('profile', 1), null, '末页再往右没有相邻页');

console.log('== 4b. 离场参数：轻移 + 淡出，不做整屏飞行 ==');
if (ts.LEAVE.DX > 0 && ts.LEAVE.DX <= 60) ok('离场位移很小 = ' + ts.LEAVE.DX + 'px（主体交给淡出）');
else bad('离场位移过大：' + ts.LEAVE.DX);
if (ts.LEAVE.SWITCH_AT < ts.LEAVE.DUR) ok('先播离场 ' + ts.LEAVE.SWITCH_AT + 'ms 后才 switchTab（旧内容已淡掉）');
else bad('SWITCH_AT 应早于离场结束：' + JSON.stringify(ts.LEAVE));
const od = ts.outDuration(-100, -375);
if (od >= ts.LEAVE.OUT_MIN && od <= ts.LEAVE.OUT_MAX) ok('手势推出屏幕时长夹在区间内 = ' + od + 'ms');
else bad('手势推出时长越界：' + od);

console.log('== 4c. 离场回调登记在"当前可见页"上 ==');
let leaveGot = null;
ts.onLeave('home', dir => { leaveGot = dir; });
eq(ts.requestLeave('home', 'right'), true, 'requestLeave 找到当前页');
eq(leaveGot, 'right', '当前页收到离场方向');
ts.offLeave('home');
eq(ts.requestLeave('home', 'right'), false, '未登记时返回 false（调用方立刻切页，不空等）');

console.log('== 5. mixin：首屏透明 → onShow 淡入（不会凭空一闪）==');
function ctxOf(key) {
  const m = mixin(key);
  const ctx = Object.assign({}, m.data(), m.methods);
  ctx.onShow = m.onShow;
  ctx.onHide = m.onHide;
  if (m.created) m.created.call(ctx);
  Object.defineProperty(ctx, 'slideCls', { get: () => m.computed.slideCls.call(ctx), configurable: true });
  Object.defineProperty(ctx, 'slideStyle', { get: () => m.computed.slideStyle.call(ctx), configurable: true });
  return ctx;
}
// onShow 的归位值要"等浏览器画过离场那一帧"才下发（冷启动第一次切页不闪的关键）。
// flush(32) 把那一层等待驱动完（rAF 在 vm 沙箱里不存在 → afterPaint 走 setTimeout 32）。
function settleEnter(c) { flushUntil(32); }

ts.clearPending();
const home = ctxOf('home');
eq(home.slideOp, 0, '首屏初始不透明度 = 0（首帧就是透明的）');
eq(home.slideLeft, true, '初始处于离场态');
home.onShow();
eq(home.slideOp, 0, 'onShow 当下还没归位（要等一帧 —— 这正是避免"闪一下"的所在）');
eq(home.slideLeft, false, 'onShow 立刻提交"进入中"（这期间再点别的 tab 也能接得住）');
settleEnter(home);
eq(home.slideOp, 1, '画过离场帧后淡入到 1');
eq(home.slideDx, 0, '位移归零');
eq(home.slideDur, ts.LEAVE.ENTER_DUR, '下发淡入时长 = ' + ts.LEAVE.ENTER_DUR + 'ms');
eq(home.slideStyle.transitionDuration, ts.LEAVE.ENTER_DUR + 'ms', 'inline 下发时长');
eq(home.slideCls.join(','), 'slide-enter', '归位中挂 slide-enter（只要 will-change）');
// 已经是正常态时再次 onShow：不应该再播动画（比如从子页面返回）
home.slideDur = 0;
home.onShow();
eq(home.slideDur, 0, '已是正常态 → 不重复播进场');
eq(home.slideOp, 1, '保持不透明');

console.log('== 5b. 离场：底栏点击 → 本页淡出让位 ==');
const home2 = ctxOf('home');
home2.onShow();                                  // 先进入正常态
settleEnter(home2);
home2.slideDur = 0;
home2.leave('right');                            // 切到索引更大的 tab → 本页往左让位
eq(home2.slideDx, -ts.LEAVE.DX, '往左轻移 = -' + ts.LEAVE.DX + 'px');
eq(home2.slideOp, 0, '淡出到 0');
eq(home2.slideLeft, true, '标记为离场态（下次 onShow 从这个状态淡入）');
eq(home2.slideDur, ts.LEAVE.DUR, '离场时长 = ' + ts.LEAVE.DUR + 'ms');
home2.leave('right');
eq(home2.slideDur, ts.LEAVE.DUR, '连点不重复播离场');
// 离场后切走 → 回来时从离场态淡入
home2.onHide();
home2.onShow();
settleEnter(home2);
eq(home2.slideOp, 1, '切回来：从离场态淡入到 1');
eq(home2.slideLeft, false, '不再是离场态');

console.log('== 5c. 兜底：离场后没切走要自己淡回来 ==');
const home3 = ctxOf('home');
home3.onShow();
settleEnter(home3);
home3.slideDur = 0;
home3.leave('left');
eq(home3.slideOp, 0, '已淡出');
home3.recover();
eq(home3.slideOp, 1, '兜底恢复：淡回来（不会永远停在透明）');
eq(home3.slideLeft, false, '恢复为正常态');

console.log('== 6. 手势：内容跟手 ==');
const home4 = ctxOf('home');
home4.onShow();
home4.slideDur = 0;
home4.onSlideStart({ touches: [{ clientX: 200, clientY: 300 }] });
home4.onSlideMove({ touches: [{ clientX: 150, clientY: 305 }] });   // 往左 50px
eq(home4.slideDrag, true, '判定为横向拖拽');
eq(home4.slideDx, -50, '内容跟手位移 = -50px');
eq(home4.slideCls.join(','), 'dragging', '跟手时挂 dragging（关掉过渡）');
eq(home4.slideStyle.transform, 'translateX(-50px)', 'inline transform');
eq(home4.slideOp, 1, '跟手时保持不透明');

console.log('== 7. 纵向为主时不抢滚动 ==');
const home5 = ctxOf('home');
home5.onShow();
home5.onSlideStart({ touches: [{ clientX: 200, clientY: 300 }] });
home5.onSlideMove({ touches: [{ clientX: 195, clientY: 380 }] });
eq(home5.slideDrag, false, '纵向手势不触发横滑');

console.log('== 8. 松手：没过阈值弹回，过了阈值先推出屏幕再切页 ==');
navCalls.length = 0;
home4.onSlideEnd();
eq(home4.slideDrag, false, '50px < 60px 阈值 → 松手');
eq(home4.slideDx, 0, '位移归零（靠 CSS 过渡弹回）');
eq(navCalls.length, 0, '未切页');
ts.clearPending();
navCalls.length = 0;
const home6 = ctxOf('home');
home6.onShow();
home6.slideDur = 0;
home6.onSlideStart({ touches: [{ clientX: 300, clientY: 300 }] });
home6.onSlideMove({ touches: [{ clientX: 220, clientY: 302 }] });  // 往左 80px
home6.onSlideEnd();
eq(home6.slideDx, -ts.screenWidth(), '先把内容推出屏幕（-屏宽）');
eq(home6.slideOp, 1, '推出过程中保持不透明（跟手连续）');
eq(navCalls.length, 0, '推完之前不切页（切页排在推出动画之后）');
eq(ts.takeEnter('library'), 'right', '意图已记下：目标页从右');

console.log('== 8b. 轻扫：位移不到 60px 但速度快也要切 ==');
ts.clearPending();
navCalls.length = 0;
const home7 = ctxOf('home');
home7.onShow();
home7.slideDur = 0;
home7.onSlideStart({ touches: [{ clientX: 300, clientY: 300 }] });
home7.onSlideMove({ touches: [{ clientX: 280, clientY: 301 }] });  // 第一次采样
home7.__last = 0;                                 // 绕过每帧节流（测试里两次 move 同一毫秒）
home7.onSlideMove({ touches: [{ clientX: 260, clientY: 302 }] });  // 40px，两次采样
home7.__pvt = home7.__vt - 40;                    // 最后一次 20px 用 20ms → 1px/ms
home7.__pvx = 280; home7.__vx = 260;
home7.onSlideEnd();
eq(Math.abs(home7.slideDx), ts.screenWidth(), '快速轻扫 40px 也切页（推出屏幕）');
// 慢速小幅拖动不该被当成轻扫
ts.clearPending();
navCalls.length = 0;
const home8 = ctxOf('home');
home8.onShow();
home8.slideDur = 0;
home8.onSlideStart({ touches: [{ clientX: 300, clientY: 300 }] });
home8.onSlideMove({ touches: [{ clientX: 280, clientY: 301 }] });
home8.__last = 0;
home8.onSlideMove({ touches: [{ clientX: 260, clientY: 302 }] });  // 40px
home8.__pvt = home8.__vt - 500;                   // 20px 用 500ms → 0.04px/ms
home8.__pvx = 280; home8.__vx = 260;
home8.onSlideEnd();
eq(home8.slideDx, 0, '慢慢挪 40px 不切页（弹回）');

console.log('== 9. 边缘：首尾页不越界 ==');
navCalls.length = 0;
const home9 = ctxOf('home');
home9.onShow();
home9.slideDur = 0;
home9.onSlideStart({ touches: [{ clientX: 100, clientY: 300 }] });
home9.onSlideMove({ touches: [{ clientX: 300, clientY: 302 }] });  // 往右 200px（首页左边没有页）
if (Math.abs(home9.slideDx) < 60) ok('边缘只给一点位移 = ' + home9.slideDx + 'px');
else bad('边缘位移过大：' + home9.slideDx);
home9.__pvt = home9.__vt - 500;   // 排除轻扫干扰
home9.onSlideEnd();
eq(home9.slideDx, 0, '边缘不切页（弹回）');

console.log('== 10. 拖到一半切走再回来：位移必须复位 ==');
const home10 = ctxOf('home');
home10.onShow();
home10.slideDur = 0;
home10.onSlideStart({ touches: [{ clientX: 300, clientY: 300 }] });
home10.onSlideMove({ touches: [{ clientX: 200, clientY: 300 }] });
ts.clearPending();
home10.onShow();                       // 再次回到本页
eq(home10.slideDrag, false, '拖拽态已复位');
eq(home10.slideDx, 0, '位移已复位（不会残留偏移）');
eq(home10.slideOp, 1, '不透明度正常');

console.log('');
console.log(fail === 0 ? 'tab 滑动全部通过' : '失败 ' + fail + ' 项');
process.exitCode = fail ? 1 : 0;
