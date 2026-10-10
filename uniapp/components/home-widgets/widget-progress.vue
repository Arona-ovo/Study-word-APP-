<template>
  <!-- 整张卡可点：以前只有右上角那颗「去词库 ›」有反应，而它做的是 switchTab ——
       跳到词库 tab 就停住了，不是用户想要的「词库详情」。
       现在整卡 + 右上那颗都直接进详情（tab=vocab，与词库页那张概览卡同一个落点）。 -->
  <view class="card wdg-card tappable" @tap="goLibrary">
    <view class="wdg-head">
      <text class="wdg-title">{{ $t('掌握度概览') }}</text>
      <text class="wdg-link" @tap.stop="goLibrary">{{ $t('去词库 ›') }}</text>
    </view>

    <view class="wdg-row">
      <view class="wdg-cell">
        <text class="wdg-num">{{ overview.touched }}</text>
        <text class="wdg-label">{{ $t('已学') }}</text>
      </view>
      <view class="wdg-cell">
        <text class="wdg-num">{{ overview.mastered }}</text>
        <text class="wdg-label">{{ $t('已掌握') }}</text>
      </view>
      <view class="wdg-cell">
        <text class="wdg-num">{{ overview.wordCount }}</text>
        <text class="wdg-label">{{ $t('全书') }}</text>
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
    // tab 页常驻，created 只跑一次；刷完一组回首页靠这个事件把数字刷过来
    // （以前没订阅，刷完 20 个词回首页，"已学 / 已掌握"还是上一轮的数）
    try { uni.$on('home:refresh', this.refresh); } catch (e) {}
  },
  beforeDestroy() {
    try { uni.$off('home:refresh', this.refresh); } catch (e) {}
  },
  methods: {
    refresh() {
      try {
        const ov: any = wordbook.homeOverview();
        this.overview = {
          touched: ov.touched || 0,
          mastered: ov.mastered || 0,
          wordCount: ov.wordCount || 0,
          bookPct: ov.bookPct || 0
        };
      } catch (e) { /* 词书读不出来就保留上一轮的数，不影响首页 */ }
    },
    // 进「词库详情 → 词汇明细」：和词库页里那张概览卡的落点一致
    goLibrary() {
      uni.navigateTo({ url: '/pkgManage/pages/library-detail/library-detail?tab=vocab' })
    }
  }
}
</script>

<style scoped>
.wdg-card { margin-bottom: 20rpx; }

.wdg-card.tappable:active { background: rgba(var(--brand-rgb, 46, 107, 255), 0.05); }

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
