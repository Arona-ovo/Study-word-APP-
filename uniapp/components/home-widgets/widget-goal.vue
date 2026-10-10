<template>
  <!-- 整张卡可点：目标卡除了"看进度"就是"改目标"，藏一个只在右上角的小字入口，
       用户根本找不到（上一版的反馈就是"卡片点不进"）。右上角那颗也留着，两处都通。 -->
  <view class="card wdg-card tappable" @tap="goSetting">
    <view class="wdg-head">
      <text class="wdg-title">{{ $t('每日目标') }}</text>
      <text class="wdg-link" @tap.stop="goSetting">{{ $t('设置 ›') }}</text>
    </view>

    <view class="go-row">
      <view class="go-line">
        <text class="go-name">{{ $t('新词') }}</text>
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
        <text class="go-name">{{ $t('学会') }}</text>
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
import { t } from '../../utils/i18n.js';
// 首页小组件：今日目标完成度（目标按词书维度设置，见词库详情 → 每日目标）
import * as wordbook from '../../utils/wordbook.js'

const EMPTY = {
  newWords: { done: 0, target: 20, pct: 0, reached: false },
  practice: { done: 0, target: 10, pct: 0, reached: false },
  today: { total: 0, correct: 0, mastered: 0 },
  enabled: true
}

export default {
  name: 'WidgetGoal',
  data() {
    return { gp: EMPTY }
  },
  computed: {
    footText() {
      void this.__lang   // 切语言后 computed 重算（否则脚注卡在旧语言）
      // 局部变量不能叫 t —— 它会遮蔽 i18n 的 t()，于是 t('…') 变成"调用一个对象"直接抛错。
      // 整句 + 占位符而不是拼接：中文"今日已练 12 题"在英文里是"12 done today"，
      // 把「 题」这种碎片单独翻再拼起来，语序就是错的。
      const d = this.gp.today || { total: 0, correct: 0, mastered: 0 }
      if (!this.gp.enabled) return t('每日目标已关闭 · 今日已练 {n} 题', { n: d.total || 0 })
      const a = this.gp.newWords.reached
      const b = this.gp.practice.reached
      const tip = a && b ? t('今日目标已达成') : (a || b ? t('还差一项就达标') : t('继续加油'))
      // 口径跟着目标一起改：目标是"学会了多少"，脚注就说"做了多少、学会多少"，
      // 不再报"正确多少题"（那是答对口径，一遍蒙对也算，跟目标不是一回事）
      return t('{tip} · 今日已做 {a} 题 · 学会 {b} 题', {
        tip: tip, a: d.total || 0, b: this.gp.practice.done || 0
      })
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
      uni.navigateTo({ url: '/pkgManage/pages/library-detail/library-detail?tab=goal' })
    }
  }
}
</script>

<style scoped>
.wdg-card { margin-bottom: 20rpx; }

.wdg-card.tappable:active { background: rgba(46, 107, 255, 0.05); }
.wdg-card.tappable:active { background: rgba(var(--brand-rgb, 46, 107, 255), 0.05); }

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
