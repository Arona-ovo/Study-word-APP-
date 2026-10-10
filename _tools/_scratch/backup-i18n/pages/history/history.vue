<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="练习历史" />

    <view v-if="days.length === 0" class="empty">
      <text class="empty-text">还没有练习记录</text>
      <text class="empty-hint">回首页点「开始背单词」练一组就会出现在这里</text>
      <button class="btn-primary empty-btn" @tap="goHome">去练习</button>
    </view>

    <block v-else>
      <view class="card sum-card">
        <view class="sum-item">
          <text class="sum-num">{{ total }}</text>
          <text class="sum-label">累计题数</text>
        </view>
        <view class="sum-item">
          <text class="sum-num">{{ accuracy }}%</text>
          <text class="sum-label">总正确率</text>
        </view>
        <view class="sum-item">
          <text class="sum-num">{{ daysCount }}</text>
          <text class="sum-label">练习天数</text>
        </view>
      </view>

      <view class="card list-card">
        <view class="card-title">按日期</view>
        <view class="day-row" v-for="(d, i) in days" :key="i">
          <view class="day-main">
            <text class="day-date">{{ d.dateText }}</text>
            <text class="day-sub">{{ d.total }} 题 · 对 {{ d.correct }}</text>
          </view>
          <view class="day-right">
            <text class="day-pct">{{ d.accuracy }}%</text>
            <view class="progress-track day-track">
              <view class="progress-fill" :style="{ width: d.accuracy + '%' }"></view>
            </view>
          </view>
        </view>
      </view>

      <!-- 登录后：账号维度的明细 -->
      <view class="card list-card" v-if="recent.length">
        <view class="card-title">最近练过的句子</view>
        <view class="rec-row" v-for="(r, i) in recent" :key="i" @tap="speak(r)">
          <view class="rec-line">
            <text class="rec-en">{{ r.en }}</text>
            <text class="rec-tag" :class="r.result">{{ r.resultText }}</text>
          </view>
          <text class="rec-zh">{{ r.zh }}</text>
        </view>
      </view>
    </block>
  </view>
</template>

<script>
// 练习历史（首页「已练习」进入）
// 数据：本地进度 store 的 days 聚合；登录后额外读账号维度的 study_records 明细。
import * as engine from '../../utils/engine'
import { speakSentence } from '../../services/voice.js'
import { getRepositories } from '../../repositories/index.ts'
import { isLoggedIn, currentUserId } from '../../services/auth'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function dateTextOf(key) {
  // key: 'YYYY-MM-DD'
  const p = String(key || '').split('-');
  if (p.length !== 3) return String(key || '')
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
  const today = engine.dateStr()
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (key === today) return '今天'
  if (key === engine.dateStr(y)) return '昨天'
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + WEEK[d.getDay()]
}

export default {
  components: { FloatNavbar },
  data() {
    return {
      days: [],
      recent: [],
      total: 0,
      accuracy: 0
    }
  },
  computed: {
    daysCount() {
      return this.days.length
    }
  },
  onShow() {
    this.refresh()
  },
  onUnload() {
    try { require('../../services/voice.js').stop() } catch (e) {}
  },
  methods: {
    refresh() {
      const his = engine.history ? engine.history() : []
      const total = his.reduce((s, r) => s + (r.total || 0), 0)
      const correct = his.reduce((s, r) => s + (r.correct || 0), 0)
      this.total = total
      this.accuracy = total ? Math.round((correct / total) * 100) : 0
      this.days = his.map(r => ({ date: r.date, dateText: dateTextOf(r.date), total: r.total, correct: r.correct, accuracy: r.accuracy }))
      this.loadRecent()
    },
    async loadRecent() {
      this.recent = []
      if (!isLoggedIn()) return
      try {
        const repos = getRepositories()
        const rows = await repos.studyRecords.listByUser(currentUserId(), { limit: 20 })
        this.recent = (rows || []).map(r => ({
          en: r.reference || r.sentence_id || '',
          zh: r.user_answer || '',
          result: r.result || '',
          resultText: r.result === 'pass' ? '通过' : r.result === 'partial' ? '半对' : '错误'
        }))
      } catch (e) { /* 未登录 / 库不可用时静默 */ }
    },
    speak(row) {
      const t = String(row.en || '').trim()
      if (t) speakSentence(t)
    },
    goHome() {
      uni.switchTab({ url: '/pages/home/home' })
    }
  }
}
</script>

<style>
.empty { padding: 200rpx 60rpx; text-align: center; }

.empty-text { font-size: 30rpx; color: #98a19b; margin-bottom: 16rpx; display: block; }
.empty-text { font-size: 30rpx; color: var(--ink-3, #98a19b); margin-bottom: 16rpx; display: block; }

.empty-hint { font-size: 24rpx; color: #98a19b; margin-bottom: 40rpx; display: block; }
.empty-hint { font-size: 24rpx; color: var(--ink-3, #98a19b); margin-bottom: 40rpx; display: block; }

.sum-card { display: flex; padding: 30rpx 0; margin-bottom: 20rpx; }

.sum-item { flex: 1; display: flex; flex-direction: column; align-items: center; }

.sum-num { font-size: 40rpx; font-weight: 700; color: #2e6bff; }
.sum-num { font-size: 40rpx; font-weight: 700; color: var(--brand, #2e6bff); }

.sum-label { font-size: 22rpx; color: #5a6560; margin-top: 6rpx; }
.sum-label { font-size: 22rpx; color: var(--ink-2, #5a6560); margin-top: 6rpx; }

.list-card { margin-bottom: 20rpx; }

.card-title {
  font-size: 26rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
  margin-bottom: 8rpx;
}

.day-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.06);
}

.day-row:last-child { border-bottom: none; }

.day-main { flex: 1; min-width: 0; }

.day-date {
  font-size: 27rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.day-sub {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.day-right { width: 180rpx; flex-shrink: 0; text-align: right; }

.day-pct { font-size: 26rpx; font-weight: 600; color: #2e6bff; }
.day-pct { font-size: 26rpx; color: var(--brand, #2e6bff); font-weight: 600; }

.day-track { margin-top: 10rpx; }

.rec-row { padding: 18rpx 0; border-bottom: 2rpx solid rgba(23, 32, 26, 0.06); }
.rec-row:last-child { border-bottom: none; }

.rec-line { display: flex; align-items: center; }

.rec-en {
  flex: 1;
  min-width: 0;
  font-size: 25rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.rec-tag {
  margin-left: 12rpx;
  flex-shrink: 0;
  font-size: 18rpx;
  border-radius: 999rpx;
  padding: 2rpx 12rpx;
  background: rgba(23, 32, 26, 0.06);
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.rec-tag.pass { background: rgba(46, 107, 255, 0.12); color: #1d4fd8; }
.rec-tag.pass { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); color: var(--brand-strong, #1d4fd8); }

.rec-tag.partial { background: rgba(247, 144, 9, 0.14); color: #b25f00; }

.rec-tag.fail { background: rgba(229, 72, 77, 0.12); color: #e5484d; }

.rec-zh {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
</style>
