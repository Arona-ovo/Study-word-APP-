<template>
  <!-- 新手引导遮罩：全屏模态层。
       点遮罩 / 点按钮 = 下一步；「跳过」直接结束。
       touch 事件全部截断，避免引导期间把底下的页面横滑切走。 -->
  <view
    v-if="step"
    class="gd-root"
    :class="{ 'gd-dark': dark }"
    @tap="onNext"
    @touchstart.stop
    @touchmove.stop.prevent
    @touchend.stop
    @touchcancel.stop
  >
    <!-- 高亮挖洞：巨大 spread 的 box-shadow 在框外铺满遮罩色，中间自然镂空。
         各端（H5/小程序/App webview）都支持 box-shadow，比四块矩形拼接稳。 -->
    <view v-if="box" class="gd-hole" :style="holeStyle" @tap.stop="onNext"></view>

    <!-- 气泡：有高亮时贴着目标（上下自适应），无高亮（欢迎步骤）时整屏居中 -->
    <view v-if="box" class="gd-tip" :style="tipStyle" @tap.stop="onNext">
      <view class="gd-head">
        <text class="gd-step-no">{{ stepNo }}</text>
        <text class="gd-skip" @tap.stop="onSkip">{{ $t('跳过') }}</text>
      </view>
      <text class="gd-title">{{ $t(step.title) }}</text>
      <text class="gd-body">{{ $t(step.body) }}</text>
      <view class="gd-foot">
        <view class="gd-dots">
          <view v-for="n in total" :key="n" class="gd-dot" :class="{ on: n - 1 <= index }"></view>
        </view>
        <view class="gd-btn" @tap.stop="onNext">{{ isLast ? $t('开始使用') : $t('下一步') }}</view>
      </view>
    </view>

    <!-- 欢迎步骤：没有挖洞，整层半透明，气泡垂直居中 -->
    <view v-else class="gd-center" @tap.stop="onNext">
      <view class="gd-tip gd-tip-center" @tap.stop="onNext">
        <view class="gd-head">
          <text class="gd-step-no">{{ stepNo }}</text>
          <text class="gd-skip" @tap.stop="onSkip">{{ $t('跳过') }}</text>
        </view>
        <text class="gd-title">{{ $t(step.title) }}</text>
        <text class="gd-body">{{ $t(step.body) }}</text>
        <view class="gd-foot">
          <view class="gd-dots">
            <view v-for="n in total" :key="n" class="gd-dot" :class="{ on: n - 1 <= index }"></view>
          </view>
          <view class="gd-btn" @tap.stop="onNext">{{ isLast ? $t('开始使用') : $t('下一步') }}</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
// components/onboarding-mask.vue - 新手引导的遮罩层（纯展示组件）
// 步骤文案与状态在 utils/onboarding.js，测量与推进在 pages/home/home.vue。
// 这里只负责：画挖洞、画气泡（上下自适应 / 居中两态）、把 next/skip 抛回给页面。
//
// 用大 spread box-shadow 实现"遮罩挖洞"而不是四块矩形拼接：
//   - 一次渲染一个元素，位置变化不会露出接缝
//   - H5 / 小程序 / App webview 对 box-shadow 支持一致
//
// 深浅色不依赖 CSS 变量：模态层要保证任何背景下都可读，
// 由页面传 dark 直接切两套固定配色（与主题切换解耦）。

export default {
  name: 'OnboardingMask',
  props: {
    // 当前步骤（utils/onboarding.js 的 STEPS 项）；null 时不渲染
    step: { type: Object, default: null },
    index: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    // 目标元素的视口矩形 { left, top, width, height }（px）；null = 欢迎步骤
    box: { type: Object, default: null },
    dark: { type: Boolean, default: false }
  },
  emits: ['next', 'skip'],
  data() {
    return {
      sw: 375,  // 视口宽（px）
      sh: 667   // 视口高（px）
    };
  },
  created() {
    try {
      const info = uni.getSystemInfoSync();
      this.sw = info.windowWidth || 375;
      this.sh = info.windowHeight || 667;
    } catch (e) { /* 用默认值兜底 */ }
  },
  computed: {
    isLast() {
      return this.index >= this.total - 1;
    },
    stepNo() {
      return (this.index + 1) + ' / ' + this.total;
    },
    // 挖洞位置：直接用测量到的视口矩形
    holeStyle() {
      const b = this.box;
      if (!b) return '';
      return 'left:' + b.left + 'px;top:' + b.top + 'px;width:' + b.width + 'px;height:' + b.height + 'px;';
    },
    // 气泡位置：默认贴目标下方；下方放不下（估算高 190px）则贴上方。
    // 用 bottom 定位避免依赖气泡实际高度（内容自适应，渲染前未知）。
    tipStyle() {
      const b = this.box;
      if (!b) return '';
      const w = Math.min(this.sw - 32, 320);
      const left = Math.max(12, Math.min(b.left - 8, this.sw - w - 12));
      const below = b.top + b.height + 14;
      if (below + 190 <= this.sh) {
        return 'left:' + left + 'px;top:' + below + 'px;width:' + w + 'px;';
      }
      return 'left:' + left + 'px;bottom:' + (this.sh - b.top + 14) + 'px;width:' + w + 'px;';
    }
  },
  methods: {
    onNext() {
      this.$emit('next');
    },
    onSkip() {
      this.$emit('skip');
    }
  }
};
</script>

<style scoped>
/* 层级：要压过悬浮 tabBar（z-index 500）与悬浮顶栏（400） */
.gd-root {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 950;
}

/* 挖洞：本体透明，只有 box-shadow 往外铺遮罩色 + 白描边呼吸提示可点 */
.gd-hole {
  position: fixed;
  border-radius: 16px;
  border: 2px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 0 9999px rgba(10, 14, 12, 0.62);
  animation: gd-breath 1.6s ease-in-out infinite;
}

@keyframes gd-breath {
  0%, 100% { border-color: rgba(255, 255, 255, 0.85); }
  50% { border-color: rgba(255, 255, 255, 0.3); }
}

/* 欢迎步骤：整屏半透明（没有挖洞），气泡居中 */
.gd-center {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(10, 14, 12, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 气泡卡片：固定浅色系，保证任何背景上可读 */
.gd-tip {
  position: fixed;
  box-sizing: border-box;
  padding: 16px 16px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.25);
}

.gd-tip-center {
  position: relative;
  width: 300px;
  max-width: calc(100vw - 48px);
}

.gd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.gd-step-no {
  font-size: 12px;
  font-weight: 600;
  color: #2e6bff;
  letter-spacing: 1px;
}

.gd-skip {
  font-size: 12px;
  color: #98a19b;
  padding: 4px 0 4px 12px;
}

.gd-title {
  display: block;
  font-size: 17px;
  font-weight: 600;
  color: #17201a;
  line-height: 1.35;
}

.gd-body {
  display: block;
  margin-top: 6px;
  font-size: 13px;
  color: #5a6560;
  line-height: 1.6;
}

.gd-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}

.gd-dots {
  display: flex;
  align-items: center;
}

.gd-dot {
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background: rgba(23, 32, 26, 0.14);
  margin-right: 5px;
  transition: background 160ms ease, width 160ms ease;
}

.gd-dot.on {
  width: 14px;
  background: #2e6bff;
}

.gd-btn {
  padding: 8px 18px;
  border-radius: 999px;
  background: #2e6bff;
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
}

.gd-btn:active {
  opacity: 0.85;
}

/* 深色模式：固定深色配色（不跟主题变量，模态层要稳定可读） */
.gd-dark .gd-tip {
  background: rgba(30, 34, 32, 0.97);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
}

.gd-dark .gd-title {
  color: #eaf0ed;
}

.gd-dark .gd-body {
  color: #a7b3ae;
}

.gd-dark .gd-skip {
  color: #74807b;
}

.gd-dark .gd-dot {
  background: rgba(234, 240, 237, 0.18);
}

/* 流畅模式：关掉呼吸动画（与全局 perf-smooth 约定一致） */
.perf-smooth .gd-hole {
  animation: none;
}
</style>
