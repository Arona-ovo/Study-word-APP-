<template>
  <view class="card wdg-card">
    <view class="wdg-head">
      <text class="wdg-title">打卡周历</text>
      <text class="wdg-link" @tap="goStats">统计 ›</text>
    </view>

    <view class="wk-row">
      <view class="wk-col" v-for="(d, i) in days" :key="i">
        <text class="wk-label">{{ d.label }}</text>
        <view class="wk-dot" :class="{ on: d.total > 0, today: d.isToday }"></view>
      </view>
    </view>

    <text class="wdg-foot">当前连续 {{ streak }} 天 · 累计练习 {{ totalDone }} 题</text>
  </view>
</template>

<script lang="ts">
// 首页小组件：近 7 天打卡圆点
import * as engine from '../../utils/engine.js'

function pad(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

export default {
  name: 'WidgetStreak',
  data() {
    return {
      days: [] as Array<{ label: string; total: number; isToday: boolean }>,
      streak: 0,
      totalDone: 0
    };
  },
  created() {
    this.refresh();
    // tab 页常驻，created 只跑一次；答题后回首页靠这个事件刷新圆点
    try { uni.$on('home:refresh', this.refresh) } catch (e) {}
  },
  beforeDestroy() {
    try { uni.$off('home:refresh', this.refresh) } catch (e) {}
  },
  methods: {
    refresh() {
      const his: any[] = (engine as any).history ? (engine as any).history() : [];
      const map: any = {};
      his.forEach((r: any) => {
        map[r.date] = r.total;
      });
      const todayKey = engine.dateStr();
      const out: Array<{ label: string; total: number; isToday: boolean }> = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = engine.dateStr(d);
        out.push({
          label: ['日', '一', '二', '三', '四', '五', '六'][d.getDay()],
          total: map[key] || 0,
          isToday: key === todayKey
        });
      }
      this.days = out;
      this.streak = engine.streak();
      this.totalDone = his.reduce((s: number, r: any) => s + (r.total || 0), 0);
    },
    goStats() {
      uni.navigateTo({ url: '/pages/stats/stats' })
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

.wk-row { display: flex; justify-content: space-between; padding: 6rpx 0 4rpx; }

.wk-col { flex: 1; display: flex; flex-direction: column; align-items: center; }

.wk-label { font-size: 20rpx; color: #98a19b; }
.wk-label { font-size: 20rpx; color: var(--ink-3, #98a19b); }

.wk-dot {
  width: 34rpx;
  height: 34rpx;
  margin-top: 10rpx;
  border-radius: 50%;
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.wk-dot.on { background: #2e6bff; }
.wk-dot.on { background: var(--brand, #2e6bff); }

.wk-dot.today { border: 3rpx solid #ffffff; }
.wk-dot.today { border: 3rpx solid var(--surface-rgb, #ffffff); }

.wdg-foot {
  display: block;
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
