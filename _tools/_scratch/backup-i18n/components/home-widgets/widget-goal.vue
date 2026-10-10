<template>
  <view class="card wdg-card">
    <view class="wdg-head">
      <text class="wdg-title">每日目标</text>
      <text class="wdg-link" @tap="goSetting">设置 ›</text>
    </view>

    <view class="go-row">
      <view class="go-line">
        <text class="go-name">新词</text>
        <text class="go-num" :class="{ ok: gp.newWords.reached }">
          {{ gp.newWords.done }} / {{ gp.newWords.target }}
        </text>
      </view>
      <view class="progress-track go-track">
        <view class="progress-fill" :class="{ full: gp.newWords.reached }" :style="{ width: gp.newWords.pct + '%' }"></view>
      </view>
    </view>

    <view class="go-row">
      <view class="go-line">
        <text class="go-name">练习通过</text>
        <text class="go-num" :class="{ ok: gp.practice.reached }">
          {{ gp.practice.done }} / {{ gp.practice.target }}
        </text>
      </view>
      <view class="progress-track go-track">
        <view class="progress-fill" :class="{ full: gp.practice.reached }" :style="{ width: gp.practice.pct + '%' }"></view>
      </view>
    </view>

    <text class="wdg-foot">{{ footText }}</text>
  </view>
</template>

<script>
// 首页小组件：今日目标完成度（目标按词书维度设置，见词库详情 → 每日目标）
import * as wordbook from '../../utils/wordbook.js'

const EMPTY = {
  newWords: { done: 0, target: 20, pct: 0, reached: false },
  practice: { done: 0, target: 10, pct: 0, reached: false },
  today: { total: 0, correct: 0 },
  enabled: true
}

export default {
  name: 'WidgetGoal',
  data() {
    return { gp: EMPTY }
  },
  computed: {
    footText() {
      const t = this.gp.today || { total: 0, correct: 0 }
      if (!this.gp.enabled) return '每日目标已关闭 · 今日已练 ' + (t.total || 0) + ' 题'
      const a = this.gp.newWords.reached
      const b = this.gp.practice.reached
      const tip = a && b ? '今日目标已达成' : (a || b ? '还差一项就达标' : '继续加油')
      return tip + ' · 今日已练 ' + (t.total || 0) + ' 题 · 正确 ' + (t.correct || 0) + ' 题'
    }
  },
  created() {
    this.refresh()
    try { uni.$on('home:refresh', this.refresh) } catch (e) {}
  },
  beforeDestroy() {
    try { uni.$off('home:refresh', this.refresh) } catch (e) {}
  },
  methods: {
    refresh() {
      try {
        this.gp = wordbook.goalProgress()
      } catch (e) {
        this.gp = EMPTY
      }
    },
    goSetting() {
      uni.navigateTo({ url: '/pages/library-detail/library-detail?tab=goal' })
    }
  }
}
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

.wdg-link { font-size: 22rpx; color: #1d4fd8; }
.wdg-link { font-size: 22rpx; color: var(--brand-strong, #1d4fd8); }

.go-row { margin-bottom: 18rpx; }
.go-row:last-of-type { margin-bottom: 10rpx; }

.go-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10rpx;
}

.go-name {
  font-size: 24rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.go-num {
  font-size: 26rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.go-num.ok { color: #2e6bff; }
.go-num.ok { color: var(--brand, #2e6bff); }

.go-track { height: 10rpx; }

.wdg-foot {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
