<template>
  <view class="card wdg-card">
    <view class="wdg-head">
      <text class="wdg-title">{{ $t('打卡走势') }}</text>
      <view class="ck-rng">
        <text
          v-for="n in RANGES"
          :key="n"
          class="ck-rng-item"
          :class="{ on: range === n }"
          :data-n="n"
          @tap="setRange"
        >{{ $t('{n}天', { n: n }) }}</text>
      </view>
    </view>

    <!-- 报价行：指数 + 涨跌（与股票分时同一套排布） -->
    <view class="ck-quote">
      <text class="ck-val" :class="dirCls">{{ fmt.value }}</text>
      <text class="ck-chg" :class="dirCls">{{ fmt.change }} {{ fmt.pct }}</text>
    </view>

    <!-- 折线图 -->
    <view
      v-if="!empty"
      class="ck-box"
      :style="{ paddingBottom: boxRatio }"
      @tap="goStats"
    >
      <view class="ck-grid">
        <view v-for="g in 3" :key="g" class="ck-gline" :style="{ top: (g * 25) + '%' }"></view>
      </view>
      <view class="ck-base" :style="{ top: baseY + '%' }"></view>
      <view
        v-for="(sg, i) in segs"
        :key="'s' + i"
        class="ck-seg"
        :class="sg.up ? 'up' : 'down'"
        :style="{ left: sg.x + '%', top: sg.y + '%', width: sg.w + '%', transform: 'rotate(' + sg.ang + 'deg)' }"
      ></view>
      <view
        v-for="(p, i) in dots"
        :key="'p' + i"
        class="ck-dot"
        :class="[p.up ? 'up' : 'down', { today: p.isToday, zero: p.total === 0 }]"
        :style="{ left: p.x + '%', top: p.y + '%' }"
      ></view>
      <text class="ck-side hi">{{ hiText }}</text>
      <text class="ck-side lo">{{ loText }}</text>
    </view>
    <view v-else class="ck-empty">{{ $t('还没有练习记录，做完一组题这里就会出现走势') }}</view>

    <view v-if="!empty" class="ck-axis">
      <text class="ck-ax">{{ startLabel }}</text>
      <text class="ck-ax mid">{{ midLabel }}</text>
      <text class="ck-ax last">{{ $t('今天') }}</text>
    </view>

    <text class="wdg-foot">{{ $t('打卡 {a} / {b} 天 · 连续 {s} 天 · 今日 {t} 题 · 累计 {c} 题', { a: checked, b: range, s: streak, t: todayTotal, c: totalDone }) }}</text>
  </view>
</template>

<script>
import { t } from '../../utils/i18n.js';
// 首页小组件：打卡走势（股票式折线图）
//
// 画法：容器用 padding-bottom 锁死高宽比（见 utils/checkin.js 的 RATIO），
// 于是每两个数据点之间的"长度 + 旋转角"可以在渲染前算好，
// 用一个个绝对定位 + rotate 的 view 首尾相接拼出折线。
// 不做 Canvas / SVG：uni-app 各端对它们的支持不一致，且原生组件会脱离
// CSS transform（首页切 tab 时内容是要整体滑动的）。
import * as checkin from '../../utils/checkin.js'

export default {
  name: 'WidgetChart',
  data() {
    return {
      range: checkin.RANGES[checkin.RANGES.length - 1],
      RANGES: checkin.RANGES,
      s: null
    }
  },
  computed: {
    empty() {
      return !this.s || !!this.s.empty
    },
    boxRatio() {
      return checkin.RATIO + '%'
    },
    geo() {
      return this.s && !this.s.empty ? checkin.geometry(this.s) : { pts: [], baseY: 50, lo: 0, hi: 0 }
    },
    pts() {
      return this.geo.pts
    },
    // 只给"打过卡"的日子画点（末点始终画），否则 30 个点会把折线糊住
    dots() {
      const p = this.pts
      if (!p.length) return []
      const out = p.filter((x, i) => x.total > 0 && i < p.length - 1)
      out.push(p[p.length - 1])
      return out
    },
    baseY() {
      return this.geo.baseY
    },
    segs() {
      return checkin.segments(this.pts, checkin.RATIO / 100)
    },
    fmt() {
      return checkin.formatChange(this.s || {})
    },
    dirCls() {
      const u = this.s ? this.s.up : null
      return u === null || u === undefined ? 'flat' : (u ? 'up' : 'down')
    },
    checked() {
      return this.s ? this.s.checked : 0
    },
    totalDone() {
      return this.s ? this.s.totalDone : 0
    },
    todayTotal() {
      return this.s ? this.s.todayTotal : 0
    },
    streak() {
      return this.s ? this.s.streak : 0
    },
    hiText() {
      return this.s ? t('高 {v}', { v: this.s.hi.toFixed(1) }) : ''
    },
    loText() {
      return this.s ? t('低 {v}', { v: this.s.lo.toFixed(1) }) : ''
    },
    startLabel() {
      return this.s && this.s.days.length ? this.s.days[0].label : ''
    },
    midLabel() {
      const d = this.s ? this.s.days : []
      return d.length > 2 ? d[Math.floor((d.length - 1) / 2)].label : ''
    }
  },
  created() {
    this.refresh()
    // tab 页常驻，created 只跑一次；答题后回首页靠这个事件把曲线刷新
    try { uni.$on('home:refresh', this.refresh) } catch (e) {}
  },
  beforeDestroy() {
    try { uni.$off('home:refresh', this.refresh) } catch (e) {}
  },
  methods: {
    refresh() {
      try {
        this.s = checkin.series(this.range)
      } catch (e) {
        this.s = null
      }
    },
    setRange(e) {
      const n = Number(e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.n : 0) || 7
      if (n === this.range) return
      this.range = n
      this.refresh()
    },
    goStats() {
      uni.navigateTo({ url: '/pkgStudy/pages/stats/stats' })
    }
  }
}
</script>

<style scoped>
.wdg-card { margin-bottom: 20rpx; }

.wdg-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14rpx; }

.wdg-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

/* 区间切换：胶囊组，与分段控件同一语言 */
.ck-rng {
  display: flex;
  background: rgba(255, 255, 255, 0.62);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.62);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 999rpx;
  padding: 4rpx;
}

.ck-rng-item {
  font-size: 20rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  padding: 6rpx 20rpx;
  border-radius: 999rpx;
  transition: background 200ms ease, color 200ms ease;
}

.ck-rng-item.on {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  color: #ffffff;
  font-weight: 600;
}

/* 报价行 */
.ck-quote {
  display: flex;
  align-items: baseline;
  padding: 2rpx 0 10rpx;
}

.ck-val {
  font-size: 44rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  line-height: 1.1;
}

.ck-chg {
  margin-left: 18rpx;
  font-size: 24rpx;
  font-weight: 500;
}

/* 红涨绿跌（A 股习惯）。深色档由 App.vue 的 .app-dark 下发 */
.ck-val.up, .ck-chg.up { color: #e5484d; color: var(--ck-up, #e5484d); }
.ck-val.down, .ck-chg.down { color: #16a34a; color: var(--ck-down, #16a34a); }
.ck-val.flat, .ck-chg.flat { color: #5a6560; color: var(--ink-2, #5a6560); }

/* 绘图盒：padding-bottom 锁死高宽比（= checkin.RATIO），
   所以下面折线段的"长度% 与 角度"能提前算准，不用等 DOM 测量 */
.ck-box {
  position: relative;
  width: 100%;
  height: 0;
}

/* 网格：横向三等分线，内边距与 SVG 坐标系的 PAD 保持一致 */
.ck-grid {
  position: absolute;
  left: 1.2%;
  right: 1.2%;
  top: 9%;
  bottom: 12%;
}

.ck-gline {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  border-top: 2rpx solid rgba(23, 32, 26, 0.07);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

/* 基准线：区间首日的指数，线在上方 = 这段时间在"涨" */
.ck-base {
  position: absolute;
  left: 1.2%;
  right: 1.2%;
  height: 0;
  border-top: 2rpx dashed rgba(23, 32, 26, 0.18);
  border-top: 2rpx dashed rgba(var(--neutral-rgb, 23, 32, 26), 0.18);
}

.ck-seg {
  position: absolute;
  height: 4rpx;
  margin-top: -2rpx;
  border-radius: 4rpx;
  transform-origin: 0 50%;
}

.ck-seg.up { background: #e5484d; background: var(--ck-up, #e5484d); }
.ck-seg.down { background: #16a34a; background: var(--ck-down, #16a34a); }

/* 数据点：打卡过的日子才画点，今天加一圈白边 */
.ck-dot {
  position: absolute;
  width: 8rpx;
  height: 8rpx;
  margin-left: -4rpx;
  margin-top: -4rpx;
  border-radius: 50%;
}

.ck-dot.up { background: #e5484d; background: var(--ck-up, #e5484d); }
.ck-dot.down { background: #16a34a; background: var(--ck-down, #16a34a); }

.ck-dot.zero {
  background: rgba(23, 32, 26, 0.16);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.16);
}

.ck-dot.today {
  width: 18rpx;
  height: 18rpx;
  margin-left: -9rpx;
  margin-top: -9rpx;
  border: 4rpx solid #ffffff;
  border: 4rpx solid var(--surface, #ffffff);
  box-sizing: border-box;
}

.ck-side {
  position: absolute;
  left: 0;
  font-size: 18rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.ck-side.hi { top: 0; }
.ck-side.lo { bottom: 0; }

.ck-empty {
  padding: 56rpx 20rpx 40rpx;
  text-align: center;
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.ck-axis {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12rpx 0 0;
}

.ck-ax {
  font-size: 20rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.wdg-foot {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
