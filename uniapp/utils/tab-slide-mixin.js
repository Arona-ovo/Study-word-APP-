// utils/tab-slide-mixin.js - tab 页的"内容左右滑动"（局部 mixin）
//
// 用法（四个 tab 页各自引入，参数 = 本页的 tab key）：
//   import tabSlideMixin from '../../utils/tab-slide-mixin.js'
//   export default { mixins: [tabSlideMixin('home')], ... }
// 模板：把"内容区"包一层（顶栏与底栏留在外面，它们不该跟着滑）：
//   <view class="page-slide" :class="slideCls" :style="slideStyle"
//         @touchstart="onSlideStart" @touchmove="onSlideMove"
//         @touchend="onSlideEnd" @touchcancel="onSlideEnd"> ... </view>
//
// 注意：滑动的 transform 只能加在**内容包裹层**上，不能加在页面根节点上 ——
// 根节点上有 fixed 的背景层（.app-root::before/::after），一旦根节点被 transform，
// fixed 会改以它为参照，背景就会跟着内容一起跑。
//
// ===== 为什么是"离场 + 淡入"，而不是"新页滑进来" =====
// tab 页在 App 端是独立 webview，切走之后处于隐藏状态。往隐藏页下发样式**并不保证
// 被画上去**（实测就是画不上）：页面一显示先闪一下最终位置，再被推回起点滑进来 ——
// 也就是用户说的"一闪一闪"。所以整套动画只做在**当前看得见的那一页**上：
//   1) 切走前：本页（可见）播离场 → 轻移 40px + 淡出到 0；可靠、可控；
//   2) 切过来：目标页的起始状态就是它上次离场时留下的（透明 + 轻微偏移），那是它
//      自己可见时画好的，显示时第一帧必然是它 → onShow 只需淡入归位，不存在跳变；
//   3) 首次进入的页面 data 初值就是"离场态"（透明），首屏渲染即透明 → onShow 淡入，
//      同样不会"内容凭空一闪"。
// 手势松手时多一步：先把内容沿手指方向推出屏幕（可见、跟手连续），推出去之后内容
// 已经在屏幕外，此时再无过渡复位到离场态 —— 这次复位用户看不见。

import * as tabSlide from './tab-slide.js';

// ---------- 等浏览器真的画过一帧 ----------
// 背景：CSS 过渡需要"起点帧"和"终点帧"两次绘制才看得见。uni 在 App 端的页面常常是先
// 把页面显示出来、再由 Vue 挂载 —— onShow 可能早于首屏的第一次绘制。此时 data 里的离场态
// （透明）和 enter() 写下的归位值会被 Vue 合并进**同一批** patch，浏览器从来没画过透明
// 那一帧，过渡就没有起点，内容是"啪"一下蹦出来的（也就是用户说的"闪一下"）。
// 只在冷启动后第一次切到某个 tab 时明显：那之后页面常驻，离场帧早在切走之前就画过了。
//
// 为什么是两层 rAF：rAF 的回调跑在"这一帧的绘制之前"。只有一层的话，回调里改完值，
// 浏览器紧接着画的还是新值 —— 旧值依旧没被画过。第一层确认"这帧会按旧值画"，第二层才动手。
// 没有 rAF（小程序逻辑层 / 老 WebView）退回 setTimeout，并额外留一个更长的兜底定时器：
// 页面不在前台时 rAF 不会来，不能让内容永远停在透明。
function waitClear(list) {
  (list || []).forEach(w => {
    try {
      if (w.t === 0) { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(w.id); }
      else clearTimeout(w.id);
    } catch (e) { /* 句柄已失效：忽略 */ }
  });
}

function afterPaint(vm, done) {
  const list = [];
  const raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : null;
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    waitClear(list);
    list.length = 0;
    done();
  };
  if (raf) {
    list.push({ t: 0, id: raf(function () { list.push({ t: 0, id: raf(fire) }); }) });
  } else {
    list.push({ t: 1, id: setTimeout(fire, 32) });
  }
  list.push({ t: 1, id: setTimeout(fire, 280) });   // 兜底：rAF 不来时也别永远停在透明
  return list;
}

export default function tabSlideMixin(key) {
  return {
    data() {
      return {
        slideDx: 0,        // 位移(px)
        slideOp: 0,        // 不透明度：首屏从透明开始，onShow 淡入（避免凭空一闪）
        slideDrag: false,  // 无过渡（跟手中 / 屏幕外复位）
        slideDur: 0,       // 过渡时长(ms)，>0 表示正在过渡
        slideLeft: true    // 是否处于"离场态"（透明 + 轻移），onShow 时要归位
      };
    },
    computed: {
      slideCls() {
        if (this.slideDrag) return ['dragging'];
        return this.slideDur ? ['slide-enter'] : [];
      },
      slideStyle() {
        const s = { transform: 'translateX(' + this.slideDx + 'px)', opacity: this.slideOp };
        // 过渡只在这两个时刻关掉：跟手（要即时）与屏幕外复位（不能被看见）
        if (this.slideDrag) s.transition = 'none';
        else if (this.slideDur) s.transitionDuration = this.slideDur + 'ms';
        return s;
      }
    },
    created() {
      // 登记离场回调：底栏点击后由 tab-slide.requestLeave 触发（本页此刻还是可见的）
      tabSlide.onLeave(key, dir => this.leave(dir));
    },
    unmounted() {
      tabSlide.offLeave(key);
      this.clearTimers();
    },
    onShow() {
      // 每次回到本页先复位手势状态（防止上一次拖拽的位移残留）
      this.slideDrag = false;
      this.__axis = 0;
      this.__tracking = false;
      this.__moves = 0;
      this.clearTimers();
      tabSlide.takeEnterInfo(key);   // 消费切换意图（不用于动画，只防止残留）
      // 处于离场态 → 淡入归位；已经是正常态（比如从子页面返回）→ 只要把残留的
      // 跟手位移收掉（拖到一半被切走的情况），靠默认过渡弹回原位
      if (this.slideLeft) this.enter();
      else { this.slideDx = 0; this.slideOp = 1; this.slideDur = 0; }
    },
    onHide() {
      // 切走了：离场态保持不动（它就是下次进场的起点），只收掉兜底定时器
      if (this.__guard) { clearTimeout(this.__guard); this.__guard = 0; }
    },
    methods: {
    // 进场：从离场态淡入归位
    // 归位值必须等"离场那一帧"真的被画出去之后再下发（理由见 afterPaint 的注释）。
    // 这段等待只有一个真实帧（~16ms），观感上察觉不到；但没有它，冷启动第一次切到某个
    // tab 时内容会直接蹦出来，而不是淡入。
    enter() {
      this.clearTimers();
      this.slideDrag = false;
      this.slideDur = 0;      // 先把离场态锁住（值不动）
      this.slideLeft = false; // 立刻提交"进入中"：这期间若用户又点了别的 tab，leave() 才接得住
      const self = this;
      this.__wait = afterPaint(this, function () {
        self.__wait = null;
        self.slideDrag = false;
        self.slideDx = 0;
        self.slideOp = 1;
        self.slideDur = tabSlide.LEAVE.ENTER_DUR;
        self.__timer = setTimeout(function () { self.slideDur = 0; self.__timer = 0; }, tabSlide.LEAVE.ENTER_DUR + 60);
      });
    },
      // 离场（底栏点击）：本页可见，轻移 + 淡出
      leave(dir) {
        if (this.slideLeft) return;      // 已经在离场态（连点），不重复播
        this.clearTimers();
        this.slideDrag = false;
        this.slideDx = dir === 'right' ? -tabSlide.LEAVE.DX : tabSlide.LEAVE.DX;
        this.slideOp = 0;
        this.slideLeft = true;
        this.slideDur = tabSlide.LEAVE.DUR;
        // 兜底：万一 switchTab 没发生（被打断），1.5s 后自己淡回来，别停在透明状态
        this.__guard = setTimeout(() => { this.__guard = 0; this.recover(); }, 1500);
      },
      // 离场（手势）：先把内容推出屏幕，再在屏幕外复位到离场态，最后才切页
      leaveByDrag(dir, target) {
        const w = tabSlide.screenWidth();
        const from = this.slideDx;
        const to = dir === 'right' ? -w : w;
        const dur = tabSlide.outDuration(from, to);
        this.clearTimers();
        this.slideDrag = false;
        this.slideOp = 1;
        this.slideDx = to;
        this.slideDur = dur;
        this.__out = setTimeout(() => {
          this.__out = 0;
          // 内容已完全滑出屏幕：这次复位用户看不见，所以关掉过渡直接跳
          this.slideDrag = true;
          this.slideDur = 0;
          this.slideDx = dir === 'right' ? -tabSlide.LEAVE.DX : tabSlide.LEAVE.DX;
          this.slideOp = 0;
          this.slideLeft = true;
          this.__out = setTimeout(() => {
            this.__out = 0;
            this.slideDrag = false;
            uni.switchTab({ url: target.path });
          }, 30);
        }, dur + 20);
      },
      // 兜底恢复：切页没发生时把内容淡回来
      recover() {
        this.clearTimers();
        this.slideDrag = false;
        this.slideDx = 0;
        this.slideOp = 1;
        this.slideLeft = false;
        this.slideDur = 220;
        this.__timer = setTimeout(() => { this.slideDur = 0; this.__timer = 0; }, 280);
      },
      clearTimers() {
        if (this.__timer) { clearTimeout(this.__timer); this.__timer = 0; }
        if (this.__out) { clearTimeout(this.__out); this.__out = 0; }
        if (this.__guard) { clearTimeout(this.__guard); this.__guard = 0; }
        // 等"离场那一帧"画出去的等待也可能还在排队（afterPaint 的 rAF / setTimeout）：
        // 它一旦被接管（再次 leave / 切走 / 收起）就必须撤掉，否则内容会在不该出现时蹦出来
        if (this.__wait) { waitClear(this.__wait); this.__wait = null; }
      },
      onSlideStart(e) {
        const t = e && e.touches && e.touches[0];
        if (!t) return;
        this.__sx = t.clientX;
        this.__sy = t.clientY;
        this.__axis = 0;          // 0 未判定 / 1 横向 / -1 纵向
        this.__tracking = true;
        this.__dx = 0;
        this.__last = 0;          // 上一次真正下发位移的时间戳（节流用）
        this.__moves = 0;         // 已采样的移动次数（至少 2 次才谈速度）
        this.__pvx = t.clientX;   // 上上次的采样（算速度用）
        this.__pvt = Date.now();
        this.__vx = t.clientX;
        this.__vt = this.__pvt;
      },
      onSlideMove(e) {
        if (!this.__tracking) return;
        const t = e && e.touches && e.touches[0];
        if (!t) return;
        const dx = t.clientX - this.__sx;
        const dy = t.clientY - this.__sy;
        if (!this.__axis) {
          const ax = Math.abs(dx);
          const ay = Math.abs(dy);
          if (ax < tabSlide.DRAG.AXIS && ay < tabSlide.DRAG.AXIS) return;
          // 纵向为主 → 交给页面正常滚动，本次手势作废
          if (ax < ay * tabSlide.DRAG.RATIO) {
            this.__axis = -1;
            this.__tracking = false;
            return;
          }
          this.__axis = 1;
        }
        if (this.__axis !== 1) return;
        // 节流到每帧最多一次：touchmove 在 App 端可以到 120Hz，每来一次就改 data
        // 就是一次"逻辑层 → 视图层"通信，首页节点多时直接把帧预算吃光。
        // 方向判定放在节流之前 —— 它不改 data，必须保持灵敏。
        const now = Date.now();
        if (now - (this.__last || 0) < 16) return;
        this.__last = now;
        // 边缘（没有相邻 tab）时只给一点位移，提示"到头了"
        const edge = !(dx < 0 ? tabSlide.neighbor(key, 1) : tabSlide.neighbor(key, -1));
        const max = tabSlide.screenWidth() * tabSlide.DRAG.MAX_RATIO;
        this.__dx = tabSlide.dampOffset(dx, max) * (edge ? tabSlide.DRAG.EDGE : 1);
        this.slideDrag = true;
        this.slideDur = 0;
        this.slideOp = 1;
        this.slideDx = Math.round(this.__dx);
        // 速度采样：用于"轻轻一甩也能切页"（至少两个采样点才作数）
        this.__moves = (this.__moves || 0) + 1;
        this.__pvx = this.__vx;
        this.__pvt = this.__vt;
        this.__vx = t.clientX;
        this.__vt = now;
      },
      onSlideEnd() {
        if (!this.__tracking) return;
        this.__tracking = false;
        if (!this.slideDrag) return;
        const dx = this.__dx;
        const adx = Math.abs(dx);
        // 手指往左 → 看下一个（索引更大）；往右 → 看上一个
        const target = dx < 0 ? tabSlide.neighbor(key, 1) : tabSlide.neighbor(key, -1);
        if (target) {
          const dt = Math.max(1, (this.__vt || 0) - (this.__pvt || 0));
          const v = Math.abs((this.__vx || 0) - (this.__pvx || 0)) / dt;   // px/ms
          const flick = (this.__moves || 0) >= 2 &&
            adx >= tabSlide.DRAG.V_MIN_DX && v >= tabSlide.DRAG.V_TRIGGER;
          if (adx >= tabSlide.DRAG.TRIGGER || flick) {
            // 先把内容沿手指方向推出去（可见、连续），再切页 —— 全程都在本页完成
            const dir = dx < 0 ? 'right' : 'left';
            tabSlide.markSwitch(key, target.key);
            // 同时告诉底栏目标：指示胶囊与内容一起动，别等新页显示后才追
            tabSlide.notifyPreview(key, target.key);
            this.leaveByDrag(dir, target);
            return;
          }
        }
        // 没过阈值 / 边缘：松手弹回
        this.slideDrag = false;
        this.slideDx = 0;
        this.slideDur = 200;
        this.slideOp = 1;
      }
    }
  };
}
