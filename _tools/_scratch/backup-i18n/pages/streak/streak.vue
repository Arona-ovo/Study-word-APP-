<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="连续打卡" />

    <view class="card hero-card">
      <view class="hero-num">{{ streak }}<text class="hero-unit">天</text></view>
      <view class="hero-sub">当前连续打卡</view>
      <view class="hero-foot">
        <text class="hero-cell">最长 {{ longest }} 天</text>
        <text class="hero-sep">·</text>
        <text class="hero-cell">累计 {{ daysCount }} 天</text>
        <text class="hero-sep">·</text>
        <text class="hero-cell">{{ total }} 题</text>
      </view>
    </view>

    <view class="card cal-card">
      <view class="card-title">近 30 天</view>
      <view class="cal-grid">
        <view
          v-for="(d, i) in grid"
          :key="i"
          class="cal-cell"
          :class="{ on: d.total > 0, today: d.isToday }"
        ></view>
      </view>
      <view class="cal-legend">
        <text class="lg-text">方格亮起 = 当天有练习</text>
      </view>
    </view>

    <view class="card tip-card">
      <text class="tip-text">连续天数按自然日计算：当天任意一题即算打卡，隔天未练则归零。</text>
    </view>
  </view>
</template>

<script>
// 连续打卡详情（首页「连续天数」进入）
// 数据：engine.history() / engine.streak()
import * as engine from '../../utils/engine'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

export default {
  components: { FloatNavbar },
  data() {
    return {
      streak: 0,
      longest: 0,
      daysCount: 0,
      total: 0,
      grid: []
    };
  },
  onShow() {
    this.refresh();
  },
  methods: {
    refresh() {
      const his = engine.history ? engine.history() : []
      const map = {}
      his.forEach(r => { map[r.date] = r })
      const todayKey = engine.dateStr()
      const out = []
      for (let i = 29; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const key = engine.dateStr(d)
        const rec = map[key] || { total: 0, correct: 0 }
        out.push({ key, label: WEEK[d.getDay()], total: rec.total || 0, isToday: key === todayKey })
      }
      this.grid = out
      this.streak = engine.streak()
      this.longest = engine.longestStreak ? engine.longestStreak() : this.streak
      this.daysCount = his.length
      this.total = his.reduce((s, r) => s + (r.total || 0), 0)
    }
  }
}
</script>

<style>
.hero-card { padding: 44rpx 0 34rpx; text-align: center; margin-bottom: 20rpx; }

.hero-num {
  font-size: 84rpx;
  font-weight: 700;
  color: #2e6bff;
  line-height: 1.1;
  color: var(--brand, #2e6bff);
}

.hero-unit { font-size: 30rpx; font-weight: 600; margin-left: 8rpx; }

.hero-sub { font-size: 24rpx; color: #5a6560; margin-top: 10rpx; }
.hero-sub { font-size: 24rpx; color: var(--ink-2, #5a6560); margin-top: 10rpx; }

.hero-foot { margin-top: 22rpx; }

.hero-cell { font-size: 23rpx; color: #5a6560; }
.hero-cell { font-size: 23rpx; color: var(--ink-2, #5a6560); }

.hero-sep { margin: 0 10rpx; color: #98a19b; }
.hero-sep { margin: 0 10rpx; color: var(--ink-3, #98a19b); }

.cal-card { padding: 28rpx 30rpx; margin-bottom: 20rpx; }

.card-title {
  font-size: 26rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
  margin-bottom: 22rpx;
}

.cal-grid { display: flex; flex-wrap: wrap; }

.cal-cell {
  width: 48rpx;
  height: 48rpx;
  margin: 0 10rpx 10rpx 0;
  border-radius: 12rpx;
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.cal-cell.on { background: #2e6bff; }
.cal-cell.on { background: var(--brand, #2e6bff); }

.cal-cell.today {
  border: 3rpx solid #1d4fd8;
  border: 3rpx solid var(--brand-strong, #1d4fd8);
  box-sizing: border-box;
}

.cal-legend { margin-top: 10rpx; }

.lg-text { font-size: 21rpx; color: #98a19b; }
.lg-text { font-size: 21rpx; color: var(--ink-3, #98a19b); }

.tip-card { padding: 26rpx 30rpx; }

.tip-text { font-size: 23rpx; color: #5a6560; line-height: 1.7; }
.tip-text { font-size: 23rpx; color: var(--ink-2, #5a6560); line-height: 1.7; }
</style>
