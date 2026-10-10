<template>
  <view
    class="container page-tabbar page-nav"
    :class="appTheme"
    :style="appBgStyle"
    @touchstart="onSlideStart"
    @touchmove="onSlideMove"
    @touchend="onSlideEnd"
    @touchcancel="onSlideEnd"
  >
    <!-- 悬浮磨砂玻璃顶栏（原生导航栏已改为 custom） -->
    <float-navbar title="词库" />

    <!-- 内容区：切 tab 时整体左右滑动 -->
    <view class="page-slide" :class="slideCls" :style="slideStyle">
    <!-- 词书 + 当前批次进度（紧凑，点击进子页看全部批次） -->
    <view class="card book-card" @tap="goDetail('batch')">
      <view class="book-row">
        <view class="book-info">
          <view class="book-name">{{ bookName }}</view>
          <view class="book-desc">{{ touched }}/{{ wordCount }} 词 · 共 {{ batchTotal }} 批</view>
        </view>
        <text class="switch-hint" @tap.stop="goSwitch">换词书 ›</text>
      </view>
      <view class="batch-compact" v-if="!batchless">
        <view class="batch-line">
          <text class="batch-label">{{ currentBatchName }}</text>
          <text class="batch-num">{{ currentBatchMastered }}/{{ currentBatchTotal }}</text>
        </view>
        <view class="progress-track">
          <view class="progress-fill" :style="{ width: currentBatchPct + '%' }"></view>
        </view>
        <view class="batch-hint">已完成 {{ doneBatches }}/{{ batchTotal }} 批 · 点击查看全部批次 ›</view>
      </view>
      <!-- 自建/导入词书没有批次，按整本口径展示 -->
      <view class="batch-compact" v-else>
        <view class="batch-line">
          <text class="batch-label">全部词汇</text>
          <text class="batch-num">{{ touched }}/{{ wordCount }}</text>
        </view>
        <view class="progress-track">
          <view class="progress-fill" :style="{ width: bookPct + '%' }"></view>
        </view>
        <view class="batch-hint">自建词书 · 点击查看词汇明细 ›</view>
      </view>
    </view>

    <!-- 词汇掌握概览（点击进子页看明细） -->
    <view class="card overview-card" @tap="goDetail('vocab')">
      <view class="ov-item">
        <text class="ov-num">{{ counts.mastered }}</text>
        <text class="ov-label">已掌握</text>
      </view>
      <view class="ov-item">
        <text class="ov-num">{{ counts.familiar }}</text>
        <text class="ov-label">熟悉</text>
      </view>
      <view class="ov-item">
        <text class="ov-num">{{ counts.learning }}</text>
        <text class="ov-label">学习中</text>
      </view>
      <view class="ov-item">
        <text class="ov-num">{{ counts.new }}</text>
        <text class="ov-label">新词</text>
      </view>
    </view>
    <view class="ov-hint" @tap="goDetail('vocab')">查看词汇明细 ›</view>

    <!-- 导入单词入口 -->
    <view class="card link-card" @tap="goDetail('import')">
      <text class="link-title">导入单词</text>
      <text class="link-desc">粘贴 JSON / CSV / 逐行文本，自动生成例句</text>
      <text class="link-arrow">›</text>
    </view>
    </view>

    <!-- 悬浮磨砂玻璃标签栏（原生 tabBar 已隐藏） -->
    <float-tabbar ref="tabbar" current="library" />
  </view>
</template>

<script>
import * as wordbook from '../../utils/wordbook'
import { hideNativeTabBar, syncTabbar } from '../../utils/nav.js'
import tabSlideMixin from '../../utils/tab-slide-mixin.js'
import FloatTabbar from '../../components/float-tabbar/float-tabbar.vue'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'

export default {
  components: { FloatTabbar, FloatNavbar },
  mixins: [tabSlideMixin('library')],
  data() {
    return {
      bookName: '',
      bookDesc: '',
      touched: 0,
      wordCount: 0,
      batchTotal: 0,
      doneBatches: 0,
      currentBatchName: '',
      currentBatchMastered: 0,
      currentBatchTotal: 0,
      currentBatchPct: 0,
      bookPct: 0,
      batchless: false,
      counts: { new: 0, learning: 0, familiar: 0, mastered: 0 }
    }
  },
  onShow() {
    hideNativeTabBar()
    syncTabbar(this)
    this.refresh()
  },
  methods: {
    goDetail(tab) {
      uni.navigateTo({ url: '/pages/library-detail/library-detail?tab=' + tab })
    },
    goSwitch() {
      uni.navigateTo({ url: '/pages/book-switch/book-switch' })
    },
    refresh() {
      const ov = wordbook.homeOverview()
      this.bookName = ov.bookName
      this.touched = ov.touched
      this.wordCount = ov.wordCount
      this.bookPct = ov.bookPct
      this.batchless = ov.batchless

      const books = wordbook.listBooks()
      const cur = books.find(b => b.current) || books[0]
      const batches = cur ? (wordbook.getBookBatches(cur.id) || []) : []
      this.batchTotal = batches.length
      this.doneBatches = batches.filter(b => b.ratio >= 1).length
      // 当前批次 = 第一个未完成的已解锁批次；全部完成则取最后一批
      const active = batches.find(b => b.unlocked && b.ratio < 1) || batches[batches.length - 1]
      if (active) {
        this.currentBatchName = active.name
        this.currentBatchMastered = active.mastered
        this.currentBatchTotal = active.total
        this.currentBatchPct = Math.round((active.ratio || 0) * 100)
      }

      const v = wordbook.bookVocab(cur ? cur.id : '', 'all')
      this.counts = v.counts
    }
  }
}
</script>

<style>
.book-card { margin-bottom: 24rpx; }

.book-row { display: flex; justify-content: space-between; align-items: flex-start; }

.book-name { font-size: 34rpx; font-weight: 600; color: #17201a; letter-spacing: 1rpx; }
.book-name { font-size: 34rpx; font-weight: 600; color: var(--ink-1, #17201a); letter-spacing: 1rpx; }

.book-desc { margin-top: 8rpx; font-size: 24rpx; color: #5a6560; }
.book-desc { margin-top: 8rpx; font-size: 24rpx; color: var(--ink-2, #5a6560); }

.switch-hint { font-size: 26rpx; color: #1d4fd8; flex-shrink: 0; }
.switch-hint { font-size: 26rpx; color: var(--brand-strong, #1d4fd8); flex-shrink: 0; }

.batch-compact { margin-top: 28rpx; }

.batch-line { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14rpx; }

.batch-label { font-size: 26rpx; font-weight: 600; color: #17201a; }
.batch-label { font-size: 26rpx; font-weight: 600; color: var(--ink-1, #17201a); }

.batch-num { font-size: 24rpx; color: #5a6560; }
.batch-num { font-size: 24rpx; color: var(--ink-2, #5a6560); }

.batch-hint { margin-top: 14rpx; font-size: 22rpx; color: #98a19b; }
.batch-hint { margin-top: 14rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.overview-card { display: flex; padding: 32rpx 0; margin-bottom: 12rpx; }

.ov-item { flex: 1; display: flex; flex-direction: column; align-items: center; }

.ov-num { font-size: 40rpx; font-weight: 700; color: #2e6bff; }
.ov-num { font-size: 40rpx; font-weight: 700; color: var(--brand, #2e6bff); }

.ov-item:nth-child(2) .ov-num { color: #7c3aed; }
.ov-item:nth-child(3) .ov-num { color: #f79009; }
.ov-item:nth-child(4) .ov-num { color: #98a19b; }
.ov-item:nth-child(4) .ov-num { color: var(--ink-3, #98a19b); }

.ov-label { font-size: 22rpx; color: #5a6560; margin-top: 6rpx; }
.ov-label { font-size: 22rpx; color: var(--ink-2, #5a6560); margin-top: 6rpx; }

.ov-hint {
  text-align: right;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  padding: 0 12rpx 8rpx;
}

.link-card {
  display: flex;
  align-items: center;
  margin-bottom: 18rpx;
}

.link-title { font-size: 30rpx; font-weight: 600; color: #17201a; }
.link-title { font-size: 30rpx; font-weight: 600; color: var(--ink-1, #17201a); }

.link-desc { flex: 1; font-size: 22rpx; color: #98a19b; margin-left: 20rpx; }
.link-desc { flex: 1; font-size: 22rpx; color: var(--ink-3, #98a19b); margin-left: 20rpx; }

.link-arrow { font-size: 32rpx; color: #1d4fd8; flex-shrink: 0; }
.link-arrow { font-size: 32rpx; color: var(--brand-strong, #1d4fd8); flex-shrink: 0; }
</style>
