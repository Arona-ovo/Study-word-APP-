<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="学习统计" />

    <!-- 核心指标 -->
    <view class="metrics">
      <view class="card metric">
        <text class="metric-num">{{ total }}</text>
        <text class="metric-label">累计答题</text>
      </view>
      <view class="card metric">
        <text class="metric-num">{{ accuracy }}%</text>
        <text class="metric-label">总正确率</text>
      </view>
      <view class="card metric">
        <text class="metric-num">{{ streak }}</text>
        <text class="metric-label">连续学习(天)</text>
      </view>
      <view class="card metric">
        <text class="metric-num">Lv{{ level }}</text>
        <text class="metric-label">{{ levelName }}阶段</text>
      </view>
    </view>

    <!-- 近 7 天练习量 -->
    <view class="card section">
      <view class="section-title">近 7 天练习量</view>
      <view class="chart">
        <view v-for="item in days" :key="item.label" class="bar-col">
          <view class="bar-wrap">
            <view class="bar" :class="{ 'bar-empty': item.total === 0 }" :style="{ height: item.h + '%' }"></view>
          </view>
          <text class="bar-num">{{ item.total || '' }}</text>
          <text class="bar-label">{{ item.label }}</text>
        </view>
      </view>
    </view>

    <!-- 词汇掌握分布（当前词书口径） -->
    <view class="card section">
      <view class="section-title">词汇掌握分布 · {{ bookName }}（共 {{ wordTotal }} 词）</view>
      <view class="dist-row">
        <text class="dist-label">已掌握</text>
        <view class="progress-track dist-track">
          <view class="progress-fill" :style="{ width: (counts.mastered / distBase * 100) + '%' }"></view>
        </view>
        <text class="dist-num">{{ counts.mastered }}</text>
      </view>
      <view class="dist-row">
        <text class="dist-label">熟悉</text>
        <view class="progress-track dist-track">
          <view class="progress-fill familiar" :style="{ width: (counts.familiar / distBase * 100) + '%' }"></view>
        </view>
        <text class="dist-num">{{ counts.familiar }}</text>
      </view>
      <view class="dist-row">
        <text class="dist-label">学习中</text>
        <view class="progress-track dist-track">
          <view class="progress-fill learning" :style="{ width: (counts.learning / distBase * 100) + '%' }"></view>
        </view>
        <text class="dist-num">{{ counts.learning }}</text>
      </view>
      <view class="dist-row">
        <text class="dist-label">新词</text>
        <view class="progress-track dist-track">
          <view class="progress-fill neww" :style="{ width: (counts.new / distBase * 100) + '%' }"></view>
        </view>
        <text class="dist-num">{{ counts.new }}</text>
      </view>
      <view v-if="wordTotal === 0" class="dist-empty">当前词书暂无词汇</view>
    </view>

    <view class="reset" @tap="resetData">重置学习数据</view>

    <!-- 重置确认（统一弹窗，替代系统 showModal） -->
    <app-dialog
      :show="confirm.show"
      :title="confirm.title"
      :content="confirm.content"
      :confirm-text="confirm.confirmText"
      :danger="true"
      @confirm="onConfirmYes"
      @cancel="confirm.show = false"
    />
  </view>
</template>

<script>
import * as engine from '../../utils/engine'
import * as wordbook from '../../utils/wordbook'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../components/app-dialog/app-dialog.vue'

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      confirm: { show: false, title: '', content: '', confirmText: '确定', action: '' },
      total: 0,
      correct: 0,
      accuracy: 0,
      streak: 0,
      level: 1,
      levelName: '入门',
      counts: { new: 0, learning: 0, familiar: 0, mastered: 0 },
      wordTotal: 0,
      bookName: '',
      days: []
    }
  },
  computed: {
    // 分母保护：空词书时为 1，避免 NaN（此时不渲染任何比例条）
    distBase() {
      return this.wordTotal || 1
    }
  },
  onShow() {
    this.refresh()
  },
  methods: {
    refresh() {
      Object.assign(this, engine.stats())
      // 词汇掌握分布改为「当前词书」口径，与词库页 / 首页保持一致
      const bid = wordbook.currentBookId()
      const v = wordbook.bookVocab(bid, 'all')
      this.counts = v.counts
      this.wordTotal = v.total
      const cur = wordbook.listBooks().find(b => b.id === bid)
      this.bookName = cur ? cur.name : ''
    },
    resetData() {
      this.confirm = {
        show: true,
        title: '重置学习数据',
        content: '将清空全部掌握度、错题本和练习记录，且无法恢复。确定继续吗？',
        confirmText: '确定重置',
        action: 'reset'
      }
    },

    onConfirmYes() {
      const act = this.confirm.action
      this.confirm.show = false
      if (act === 'reset') {
        engine.resetAll()
        this.refresh()
        uni.showToast({ title: '已重置', icon: 'success' })
      }
    }
  }
}
</script>

<style>
.metrics { display: flex; flex-wrap: wrap; justify-content: space-between; }

.metric { width: 48.5%; margin-bottom: 20rpx; text-align: center; padding: 36rpx 0; }

.metric-num {
  display: block;
  font-size: 48rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #2e6bff;
  color: var(--brand, #2e6bff);
}

.metric-label { display: block; font-size: 24rpx; color: #5a6560; margin-top: 10rpx; }
.metric-label { display: block; font-size: 24rpx; color: var(--ink-2, #5a6560); margin-top: 10rpx; }

.section { margin-bottom: 24rpx; }

.section-title { font-size: 32rpx; font-weight: 600; letter-spacing: 1rpx; margin-bottom: 32rpx; }

.chart { display: flex; align-items: flex-end; height: 280rpx; }

.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }

.bar-wrap { flex: 1; width: 44rpx; display: flex; align-items: flex-end; }

.bar {
  width: 100%;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  border-radius: 999rpx;
  min-height: 6rpx;
}

.bar-empty { background: rgba(23, 32, 26, 0.09); }
.bar-empty { background: rgba(var(--neutral-rgb, 23, 32, 26), 0.09); }

.bar-num { font-size: 20rpx; color: #5a6560; margin-top: 10rpx; height: 28rpx; }
.bar-num { font-size: 20rpx; color: var(--ink-2, #5a6560); margin-top: 10rpx; height: 28rpx; }

.bar-label { font-size: 20rpx; color: #98a19b; }
.bar-label { font-size: 20rpx; color: var(--ink-3, #98a19b); }

.dist-row { display: flex; align-items: center; margin-bottom: 24rpx; }

.dist-label { width: 100rpx; font-size: 26rpx; color: #5a6560; flex-shrink: 0; }
.dist-label { width: 100rpx; font-size: 26rpx; color: var(--ink-2, #5a6560); flex-shrink: 0; }

.dist-track { flex: 1; margin-right: 20rpx; }

.dist-num { width: 60rpx; text-align: right; font-size: 26rpx; font-weight: 600; color: #17201a; flex-shrink: 0; }
.dist-num { width: 60rpx; text-align: right; font-size: 26rpx; font-weight: 600; color: var(--ink-1, #17201a); flex-shrink: 0; }

.dist-empty { text-align: center; font-size: 24rpx; color: #98a19b; padding: 20rpx 0 8rpx; }
.dist-empty { text-align: center; font-size: 24rpx; color: var(--ink-3, #98a19b); padding: 20rpx 0 8rpx; }

.progress-fill.familiar { background: #7c3aed; }
.progress-fill.learning { background: #f79009; }
.progress-fill.neww { background: #c7cfc9; }

.reset { text-align: center; font-size: 26rpx; color: #98a19b; padding: 32rpx 0 64rpx; }
.reset { text-align: center; font-size: 26rpx; color: var(--ink-3, #98a19b); padding: 32rpx 0 64rpx; }
</style>
