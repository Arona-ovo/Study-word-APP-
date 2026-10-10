<template>
  <view class="card wdg-card">
    <view class="wdg-head">
      <text class="wdg-title">{{ $t('今日停留') }}</text>
    </view>

    <view class="us-body">
      <!-- 圆环：两半各自旋转，父级窗口负责裁掉超出半圆的部分。
           不用 Canvas / SVG（各端支持不一致，且原生组件脱离 CSS transform），
           也不用 conic-gradient（老 WebView 没有）—— 纯 transform + border，最稳。 -->
      <view class="ring">
        <view class="ring-track"></view>
        <view class="ring-win"><view class="ring-arc" :style="arcL"></view></view>
        <view class="ring-win win-r"><view class="ring-arc" :style="arcR"></view></view>
        <view class="ring-mid">
          <text class="us-num">{{ numText }}</text>
          <text class="us-unit">{{ unitText }}</text>
        </view>
      </view>

      <!-- 中间大数字已经是"今日"，右侧就不再重复它：给日均与近 7 天累计 -->
      <view class="us-side">
        <view class="us-line">
          <text class="us-k">{{ $t('日均') }}</text>
          <text class="us-v">{{ avgText }}</text>
        </view>
        <view class="us-line">
          <text class="us-k">{{ $t('近 7 天') }}</text>
          <text class="us-v">{{ weekText }}</text>
        </view>
      </view>
    </view>

    <text class="wdg-foot">{{ $t('满圈 = 1 小时 · 时间只记在本机') }}</text>
  </view>
</template>

<script>
import { t } from '../../utils/i18n.js';
import * as usage from '../../utils/usage.js';

// 首页小组件：今日在 App 里待了多久（圆环 + 中间数字）
// 一整圈 = 60 分钟；超过一小时就是满圈，中间的数字照常继续往上走。
export default {
  name: 'WidgetUsage',
  data() {
    return {
      minutes: 0,
      avg: 0,
      week: 0,
      alpha: 0,      // 圆环转过的角度（0-360），进场时从 0 过渡到目标值
      ready: false,  // true 之后才允许更新 alpha —— 否则进场动画会被跳过
      tick: 0
    };
  },
  computed: {
    // 60 分钟 = 一整圈
    targetAlpha() {
      return Math.max(0, Math.min(1, this.minutes / 60)) * 360;
    },
    /**
     * 两半各转多少度。上半环元素本身盖住 [180°, 360°]（左 → 顶 → 右），
     * 窗口把它裁成左右两半，旋转让需要的那部分进入窗口：
     *   右窗（[270°,90°]）：φR = α - 90   （α ≤ 180），超过半圈后钉在 90°（整半填满）
     *   左窗（[90°,270°]） ：φL = α - 450（α > 180），不到半圈时钉在 -270°（完全不露）
     */
    arcL() {
      const d = this.alpha > 180 ? this.alpha - 450 : -270;
      return { transform: 'rotate(' + d + 'deg)' };
    },
    arcR() {
      const d = this.alpha <= 180 ? this.alpha - 90 : 90;
      return { transform: 'rotate(' + d + 'deg)' };
    },
    numText() {
      // 不到一小时显示分钟；超过显示小时（1 位小数，整点自动去掉小数）
      return this.minutes < 60 ? String(this.minutes) : String(Math.round(this.minutes / 6) / 10);
    },
    unitText() {
      void this.__lang;
      return this.minutes < 60 ? t('分钟') : t('小时');
    },
    avgText() {
      void this.__lang;
      return this.fmt(this.avg);
    },
    weekText() {
      void this.__lang;
      return this.fmt(this.week);
    }
  },
  created() {
    this.pull();
    try { uni.$on('home:refresh', this.pull); } catch (e) { /* 端不支持就算了 */ }
  },
  mounted() {
    // 等一帧再上目标角度：CSS transition 才能画出"圆环自己长出来"的过程
    setTimeout(() => { this.ready = true; this.pull(); }, 60);
    // 停留时长是要走的：首页是常驻 tab 页，一分钟自刷一次即可
    this.tick = setInterval(this.pull, 60000);
  },
  beforeUnmount() { this.off(); },
  beforeDestroy() { this.off(); },
  methods: {
    off() {
      if (this.tick) { clearInterval(this.tick); this.tick = 0; }
      try { uni.$off('home:refresh', this.pull); } catch (e) { /* 同上 */ }
    },
    pull() {
      // 先结算"进入前台到现在"这段，数字才是实时的（不是上一次落盘的值）
      try { usage.flush(); } catch (e) { /* 计时不可用就按 0 显示 */ }
      this.minutes = usage.todayMinutes();
      this.avg = usage.avgMinutes(7);
      this.week = usage.totalMinutes(7);
      if (this.ready) this.alpha = this.targetAlpha;
    },
    /** 分钟 → "1 h 23 min" / "23 min" */
    fmt(m) {
      const n = Math.max(0, Math.floor(Number(m) || 0));
      if (n < 60) return n + ' ' + t('分钟');
      const h = Math.floor(n / 60);
      const r = n % 60;
      return r ? (h + ' ' + t('小时') + ' ' + r + ' ' + t('分钟')) : (h + ' ' + t('小时'));
    }
  }
};
</script>

<style scoped>
.wdg-card { margin-bottom: 20rpx; }

.wdg-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16rpx; }

.wdg-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

.us-body {
  display: flex;
  align-items: center;
  padding: 6rpx 0 2rpx;
}

/* ===== 圆环 =====
   尺寸写死 rpx：ring 200 × 200，环宽 16，半宽 100。
   上半环元素是 200 × 100 的半圆（上圆角 100rpx + 去掉下边框），
   旋转中心在「底边中点」= 整个圆环的圆心。 */
.ring {
  position: relative;
  width: 200rpx;
  height: 200rpx;
  flex-shrink: 0;
}

.ring-track {
  position: absolute;
  left: 0;
  top: 0;
  width: 200rpx;
  height: 200rpx;
  box-sizing: border-box;
  border: 16rpx solid rgba(23, 32, 26, 0.1);
  border: 16rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.1);
  border-radius: 50%;
}

/* 左右两个裁切窗口：只显示落在自己这半边的那截弧 */
.ring-win {
  position: absolute;
  top: 0;
  left: 0;
  width: 100rpx;
  height: 200rpx;
  overflow: hidden;
}

.ring-win.win-r { left: 100rpx; }

.ring-arc {
  position: absolute;
  top: 0;
  width: 200rpx;
  height: 100rpx;
  box-sizing: border-box;
  border: 16rpx solid #2e6bff;
  border: 16rpx solid var(--brand, #2e6bff);
  /* 下边框去掉：否则半圆底边会横着多出一条线 */
  border-bottom: none;
  border-top-left-radius: 100rpx;
  border-top-right-radius: 100rpx;
  transform-origin: 50% 100%;
  transition: transform 900ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.ring-win .ring-arc { left: 0; }
.ring-win.win-r .ring-arc { left: -100rpx; }

.ring-mid {
  position: absolute;
  left: 0;
  top: 0;
  width: 200rpx;
  height: 200rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* 数字走衬线体（项目里英文 / 数字统一 Georgia） */
.us-num {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 46rpx;
  font-weight: 600;
  line-height: 1;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.us-unit {
  margin-top: 8rpx;
  font-size: 20rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* ===== 右侧两行 ===== */
.us-side {
  flex: 1;
  min-width: 0;
  margin-left: 30rpx;
}

.us-line {
  display: flex;
  align-items: baseline;
  margin-bottom: 16rpx;
}

.us-line:last-child { margin-bottom: 0; }

.us-k {
  width: 72rpx;
  flex-shrink: 0;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.us-v {
  flex: 1;
  min-width: 0;
  font-size: 26rpx;
  font-weight: 500;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.wdg-foot {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* 关掉动效偏好：圆环直接到位（系统设置 / 流畅模式下的常规做法） */
@media (prefers-reduced-motion: reduce) {
  .ring-arc { transition: none; }
}
</style>
