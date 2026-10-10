<template>
  <view class="card wdg-card">
    <view class="wdg-head">
      <text class="wdg-title">{{ $t('刷单词') }}</text>
      <text class="wdg-link" @tap="goDefault">{{ $t('再来一组 ›') }}</text>
    </view>

    <view class="wb-grid">
      <view class="wb-cell" :class="{ hot: c.new > 0 }" @tap="goSource" data-s="new">
        <text class="wb-num new">{{ c.new }}</text>
        <text class="wb-label">{{ $t('新词') }}</text>
      </view>
      <view class="wb-cell" @tap="goSource" data-s="review">
        <text class="wb-num weak">{{ c.learning }}</text>
        <text class="wb-label">{{ $t('待巩固') }}</text>
      </view>
      <view class="wb-cell" @tap="goSource" data-s="review">
        <text class="wb-num done">{{ c.mastered }}</text>
        <text class="wb-label">{{ $t('已掌握') }}</text>
      </view>
    </view>

    <button class="wb-main" @tap="goDefault">{{ $t('开始刷词 · 每组 {n} 词', { n: deckSize }) }}</button>

    <view class="wb-row">
      <button class="wb-mini" @tap="goSource" data-s="new">{{ $t('只刷新词') }}</button>
      <button class="wb-mini" @tap="goSource" data-s="review">{{ $t('复习薄弱词') }}</button>
    </view>

    <text class="wdg-foot">{{ footText }}</text>
  </view>
</template>

<script>
import * as wordbook from '../../utils/wordbook.js'
import * as wordSession from '../../utils/word-session.js'

// 首页「刷单词」卡：专属入口 + 词档分布。
// 与「学习入口」是两张不同的卡 —— 那边从句出发练翻译，这边对着词表刷认知。
export default {
  name: 'WidgetWorddrill',
  data() {
    return {
      c: { total: 0, new: 0, learning: 0, familiar: 0, mastered: 0 },
      pct: 0,
      // 今天到期该巩固的词数（utils/srs.js 的跨天阶梯排出来的）。
      // 这是"按计划今天该回来确认几个" —— 和上面「待巩固」那格不是一回事：
      // 那格是掌握度 m 还在 0-2 的薄弱词，这里是到了复习日的词（可能 m 并不低）。
      due: 0,
      footText: '',
      deckSize: wordSession.DECK_SIZE.def
    }
  },
  created() {
    this.refresh()
    // tab 页常驻，created 只跑一次；刷完一组回首页靠这个事件把数字刷过来
    try { uni.$on('home:refresh', this.refresh) } catch (e) {}
  },
  beforeDestroy() {
    try { uni.$off('home:refresh', this.refresh) } catch (e) {}
  },
  methods: {
    refresh() {
      try {
        const bid = wordbook.currentBookId()
        this.c = wordSession.counts(bid)
        this.pct = this.c.total ? Math.round((this.c.mastered / this.c.total) * 100) : 0
        this.due = wordSession.dueStats(bid)
      } catch (e) { /* 词书读不出来就不刷新，不影响首页 */ }
      // 脚注把"今天该巩固几个"摆出来：间隔重复调度只有被看见才有人去做
      const base = this.$t('全书 {t} 词 · 已掌握 {m} 个（{p}%）', { t: this.c.total, m: this.c.mastered, p: this.pct })
      this.footText = this.due > 0
        ? base + ' · ' + this.$t('今天该巩固 {d} 词', { d: this.due })
        : base
    },
    goDefault() {
      this.open('daily')
    },
    goSource(e) {
      this.open(e.currentTarget.dataset.s)
    },
    open(src) {
      const s = src === 'review' ? 'review' : (src === 'new' ? 'new' : 'daily')
      uni.navigateTo({ url: '/pkgStudy/pages/word-drill/word-drill?source=' + s })
    }
  }
}
</script>

<style scoped>
.wdg-card { margin-bottom: 20rpx; }

.wdg-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18rpx; }

.wdg-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

.wdg-link { font-size: 22rpx; color: #1d4fd8; }
.wdg-link { font-size: 22rpx; color: var(--brand-strong, #1d4fd8); }

.wb-grid { display: flex; }

.wb-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12rpx 0 16rpx;
  border-radius: 18rpx;
}

.wb-cell:active { background: rgba(46, 107, 255, 0.08); }
.wb-cell:active { background: rgba(var(--brand-rgb, 46, 107, 255), 0.08); }

.wb-num {
  font-size: 40rpx;
  font-weight: 600;
  line-height: 1.2;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.wb-num.new { color: #2e6bff; }
.wb-num.new { color: var(--brand, #2e6bff); }
.wb-cell.hot .wb-num.new { color: #1d4fd8; }
.wb-cell.hot .wb-num.new { color: var(--brand-strong, #1d4fd8); }
.wb-num.weak { color: #f79009; }
.wb-num.done { color: #2f9e6e; }

.wb-label {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.wb-main {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin-top: 6rpx;
  height: 88rpx;
  font-size: 30rpx;
  font-weight: 500;
  letter-spacing: 2rpx;
  text-indent: 2rpx;
  color: #ffffff;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  border-radius: 999rpx;
}

.wb-main::after { border: none; }
.wb-main:active { opacity: 0.88; }

.wb-row { display: flex; margin-top: 16rpx; }

/* 与首页「学习入口」的 .btn-mini 保持完全同款：
   等分撑满一行、26rpx / 72rpx、品牌色 34% 描边。改一处就要改另一处。 */
.wb-mini {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0 8rpx;
  height: 72rpx;
  font-size: 26rpx;
  white-space: nowrap;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.34);
  border-radius: 999rpx;
}

.wb-mini:first-child { margin-left: 0; }
.wb-mini:last-child { margin-right: 0; }
.wb-mini::after { border: none; }
.wb-mini:active { background: rgba(46, 107, 255, 0.12); }
.wb-mini:active { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }

.wdg-foot {
  display: block;
  margin-top: 16rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
