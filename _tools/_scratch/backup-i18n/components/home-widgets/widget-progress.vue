<template>
  <view class="card wdg-card">
    <view class="wdg-head">
      <text class="wdg-title">掌握度概览</text>
      <text class="wdg-link" @tap="goLibrary">去词库 ›</text>
    </view>

    <view class="wdg-row">
      <view class="wdg-cell">
        <text class="wdg-num">{{ overview.touched }}</text>
        <text class="wdg-label">已学</text>
      </view>
      <view class="wdg-cell">
        <text class="wdg-num">{{ overview.mastered }}</text>
        <text class="wdg-label">已掌握</text>
      </view>
      <view class="wdg-cell">
        <text class="wdg-num">{{ overview.wordCount }}</text>
        <text class="wdg-label">全书</text>
      </view>
    </view>

    <view class="progress-track wdg-track">
      <view class="progress-fill" :style="{ width: overview.bookPct + '%' }"></view>
    </view>
    <text class="wdg-foot">全书进度 {{ overview.bookPct }}%</text>
  </view>
</template>

<script lang="ts">
// 首页小组件：掌握度概览（与「当前词书」同源，按整本书口径展示）
import * as wordbook from '../../utils/wordbook';

export default {
  name: 'WidgetProgress',
  data() {
    return {
      overview: { touched: 0, mastered: 0, wordCount: 0, bookPct: 0 }
    };
  },
  created() {
    this.refresh();
  },
  methods: {
    refresh() {
      const ov: any = wordbook.homeOverview();
      this.overview = {
        touched: ov.touched || 0,
        mastered: ov.mastered || 0,
        wordCount: ov.wordCount || 0,
        bookPct: ov.bookPct || 0
      };
    },
    goLibrary() {
      uni.switchTab({ url: '/pages/library/library' })
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

.wdg-row { display: flex; padding: 6rpx 0 18rpx; }

.wdg-cell { flex: 1; display: flex; flex-direction: column; align-items: center; }

.wdg-num { font-size: 38rpx; font-weight: 700; color: #2e6bff; }
.wdg-num { font-size: 38rpx; font-weight: 700; color: var(--brand, #2e6bff); }

.wdg-label { font-size: 22rpx; color: #5a6560; margin-top: 6rpx; }
.wdg-label { font-size: 22rpx; color: var(--ink-2, #5a6560); }

.wdg-track { margin-top: 4rpx; }

.wdg-foot {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
