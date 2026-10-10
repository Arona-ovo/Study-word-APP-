<template>
  <view class="cb" :class="shadowClass + ' ' + borderClass" :style="rootStyle">
    <!-- 卡片配图（image.set 换的就是它） -->
    <image v-if="card.image" class="cb-banner" :src="card.image" mode="aspectFill" />

    <view class="cb-body" :style="bodyStyle">
      <block v-for="(b, i) in items" :key="i">
        <!-- 标题 -->
        <text v-if="b.kind === 'title'" class="cbk-title" :class="{ 'is-serif': b.serif }" :style="titleStyle(b)">{{ b.text }}</text>

        <!-- 正文 -->
        <text v-else-if="b.kind === 'text'" class="cbk-text" :class="['tone-' + b.tone, { 'is-serif': b.serif }]" :style="textStyle(b)">{{ b.text }}</text>

        <!-- 数字组 -->
        <view v-else-if="b.kind === 'stat'" class="cbk-stats">
          <view class="cbk-stat">
            <text class="cbk-stat-num">{{ b._value }}<text v-if="b.unit" class="cbk-stat-unit">{{ b.unit }}</text></text>
            <text v-if="b.label" class="cbk-stat-label">{{ b.label }}</text>
          </view>
        </view>

        <!-- 键值对 -->
        <view v-else-if="b.kind === 'kv'" class="cbk-kv">
          <view v-for="(it, k) in b.items" :key="k" class="cbk-kv-row">
            <text class="cbk-kv-k">{{ it.k }}</text>
            <text class="cbk-kv-v">{{ it.v }}</text>
          </view>
        </view>

        <!-- 列表 -->
        <view v-else-if="b.kind === 'list'" class="cbk-list">
          <view v-for="(it, k) in b.items" :key="k" class="cbk-li">
            <text class="cbk-li-dot">{{ b.ordered ? (k + 1) + '.' : '·' }}</text>
            <text class="cbk-li-text">{{ it }}</text>
          </view>
        </view>

        <!-- 可勾选清单：点一下就划掉，状态写回 pageDoc -->
        <view v-else-if="b.kind === 'checklist'" class="cbk-check">
          <view
            v-for="(it, k) in b.items"
            :key="k"
            class="cbk-ci"
            @tap="toggleCheck(b, k)"
          >
            <view class="cbk-box" :class="{ 'is-done': it.done }">
              <text v-if="it.done" class="cbk-tick">✓</text>
            </view>
            <text class="cbk-ci-text" :class="{ 'is-done': it.done }">{{ it.text }}</text>
          </view>
        </view>

        <!-- 进度条 -->
        <view v-else-if="b.kind === 'progress'" class="cbk-prog">
          <view class="cbk-prog-head">
            <text class="cbk-prog-label">{{ b.label }}</text>
            <text class="cbk-prog-num">{{ b._pct }}%</text>
          </view>
          <view class="progress-track">
            <view class="progress-fill" :style="{ width: b._pct + '%' }"></view>
          </view>
        </view>

        <!-- 倒计时 -->
        <view v-else-if="b.kind === 'countdown'" class="cbk-count">
          <view class="cbk-count-num">{{ b._days }}</view>
          <view class="cbk-count-side">
            <text class="cbk-count-unit">天</text>
            <text class="cbk-count-title">{{ b.title }}</text>
          </view>
        </view>

        <!-- 引言 -->
        <view v-else-if="b.kind === 'quote'" class="cbk-quote">
          <text class="cbk-quote-text" :class="{ 'is-serif': b.serif !== false }">{{ b.text }}</text>
          <text v-if="b.author" class="cbk-quote-author">— {{ b.author }}</text>
        </view>

        <!-- 标签 -->
        <view v-else-if="b.kind === 'tags'" class="cbk-tags">
          <text v-for="(it, k) in b.items" :key="k" class="cbk-tag" :class="'tone-' + b.tone">{{ it }}</text>
        </view>

        <!-- 图片块 -->
        <view v-else-if="b.kind === 'image'" class="cbk-img" :style="{ paddingBottom: b.ratio * 100 + '%' }">
          <image class="cbk-img-el" :src="b.url" mode="aspectFill" />
          <text v-if="b.caption" class="cbk-img-cap">{{ b.caption }}</text>
        </view>

        <!-- 分隔线 -->
        <view v-else-if="b.kind === 'divider'" class="cbk-divider"></view>

        <!-- 按钮 -->
        <view
          v-else-if="b.kind === 'button'"
          class="cbk-btn"
          @tap="onAction(b)"
        >{{ b.text }}</view>
      </block>

      <!-- 兜底：卡片既没有块也没有文案时给个提示，避免渲染成空白 -->
      <text v-if="!items.length" class="cbk-empty">{{ card.title || '空卡片' }}</text>
    </view>

    <text v-if="removable" class="cb-remove" @tap.stop="onRemove">移除</text>
  </view>
</template>

<script>
// components/app-card-blocks.vue - AI 卡片的块渲染器
//
// 只认 utils/page-schema 定义好的 13 种块，AI 造不出这之外的东西。
// 所有数值在渲染前都已夹取过，这里只负责"画出来"，不做任何二次解释。

const DAY = 86400000;

function todayStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 倒计时：支持 YYYY-MM-DD 与 +Nd 两种写法 */
export function daysLeft(date) {
  const s = String(date || '').trim();
  if (!s) return 0;
  if (/^\+\d{1,4}d$/.test(s)) return parseInt(s.slice(1, -1), 10);
  const p = s.split('-');
  if (p.length !== 3) return 0;
  const t = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getTime();
  if (!isFinite(t)) return 0;
  return Math.max(0, Math.round((t - todayStart()) / DAY));
}

export default {
  name: 'AppCardBlocks',
  props: {
    card: { type: Object, default: () => ({}) },
    // 真实学习数据（pageDoc.liveValues()），用于 live 绑定
    live: { type: Object, default: () => ({}) },
    removable: { type: Boolean, default: false }
  },
  computed: {
    shadowClass() {
      const s = (this.card.style && this.card.style.shadow) || 'soft';
      return 'shadow-' + s;
    },
    borderClass() {
      const b = (this.card.style && this.card.style.border) || 'hairline';
      return 'border-' + b;
    },
    rootStyle() {
      const st = this.card.style || {};
      const out = [];
      const bg = st.bg ? st.bg : 'rgba(var(--surface-rgb, 255,255,255), ' + (st.opacity || 0.72) + ')';
      out.push('background:' + bg + ';');
      out.push('border-radius:' + (st.radius == null ? 22 : st.radius) + 'rpx;');
      return out.join('');
    },
    bodyStyle() {
      const st = this.card.style || {};
      const out = [];
      out.push('padding:' + (st.padding == null ? 24 : st.padding) + 'rpx;');
      if (st.fontSize) out.push('font-size:' + st.fontSize + 'rpx;');
      if (st.fontWeight) out.push('font-weight:' + st.fontWeight + ';');
      if (st.color) out.push('color:' + st.color + ';');
      if (st.align) out.push('text-align:' + st.align + ';');
      if (st.serif) out.push('font-family:Georgia,"Times New Roman","PingFang SC",serif;');
      return out.join('');
    },
    /** 把 live 绑定 / 倒计时在渲染前算成普通字符串（模板里不放表达式） */
    items() {
      const lv = this.live || {};
      const list = (this.card && this.card.blocks) || [];
      return list.map(b => {
        const o = Object.assign({}, b);
        if (b.live && b.live !== 'none' && lv[b.live] !== undefined) {
          o._value = String(lv[b.live]);
        } else {
          o._value = String(b.value == null ? '' : b.value);
        }
        if (b.kind === 'progress') {
          const cur = Number(b.live && b.live !== 'none' ? lv[b.live] : b.value) || 0;
          const target = Number(b.target) || 100;
          const pct = Math.round(Math.max(0, Math.min(1, cur / target)) * 100);
          o._pct = pct;
        }
        if (b.kind === 'countdown') o._days = daysLeft(b.date);
        return o;
      });
    }
  },
  methods: {
    titleStyle(b) {
      return 'font-size:' + (b.size || 30) + 'rpx;text-align:' + (b.align || 'left') + ';';
    },
    textStyle(b) {
      return 'font-size:' + (b.size || 26) + 'rpx;text-align:' + (b.align || 'left') + ';';
    },
    toggleCheck(b, k) {
      this.$emit('toggle', { id: this.card.id, index: k });
    },
    onAction(b) {
      this.$emit('action', { action: b.action, speak: b.speak || '' });
    },
    onRemove() {
      this.$emit('remove', { id: this.card.id });
    }
  }
}
</script>

<style scoped>
.cb {
  position: relative;
  overflow: hidden;
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  backdrop-filter: blur(12px) saturate(180%);
}

.cb.shadow-none { box-shadow: none; }
.cb.shadow-soft {
  box-shadow: 0 8rpx 24rpx rgba(23, 32, 26, 0.06), 0 2rpx 6rpx rgba(23, 32, 26, 0.04);
  box-shadow: 0 8rpx 24rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.06), 0 2rpx 6rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.04);
}
.cb.shadow-lifted {
  box-shadow: 0 18rpx 44rpx rgba(23, 32, 26, 0.14), 0 4rpx 10rpx rgba(23, 32, 26, 0.06);
  box-shadow: 0 18rpx 44rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.14), 0 4rpx 10rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.06);
}
.cb.border-none { border: none; }
.cb.border-hairline {
  border: 2rpx solid rgba(255, 255, 255, 0.75);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.75));
}
.cb.border-bold {
  border: 4rpx solid rgba(46, 107, 255, 0.3);
  border: 4rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.3);
}

.cb-banner {
  display: block;
  width: 100%;
  height: 200rpx;
}

.cb-body { display: block; }

.cbk-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

.is-serif { font-family: Georgia, "Times New Roman", "PingFang SC", serif; }

.cbk-text {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 1.6;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
.cbk-text.tone-muted { color: #98a19b; color: var(--ink-3, #98a19b); }
.cbk-text.tone-strong { color: #17201a; color: var(--ink-1, #17201a); font-weight: 500; }

.cbk-stats {
  display: flex;
  margin-top: 16rpx;
}

.cbk-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.cbk-stat-num {
  font-size: 36rpx;
  font-weight: 600;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.cbk-stat-unit { font-size: 22rpx; margin-left: 4rpx; }

.cbk-stat-label {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.cbk-kv { margin-top: 14rpx; }

.cbk-kv-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 10rpx 0;
  border-top: 2rpx solid rgba(23, 32, 26, 0.06);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
}

.cbk-kv-k {
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.cbk-kv-v {
  font-size: 26rpx;
  font-weight: 500;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.cbk-list { margin-top: 14rpx; }

.cbk-li { display: flex; padding: 8rpx 0; }

.cbk-li-dot {
  width: 34rpx;
  flex-shrink: 0;
  font-size: 24rpx;
  color: #2e6bff;
  color: var(--brand, #2e6bff);
}

.cbk-li-text {
  flex: 1;
  font-size: 26rpx;
  line-height: 1.55;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.cbk-check { margin-top: 14rpx; }

.cbk-ci { display: flex; align-items: center; padding: 12rpx 0; }

.cbk-box {
  width: 34rpx;
  height: 34rpx;
  flex-shrink: 0;
  margin-right: 14rpx;
  border-radius: 10rpx;
  border: 3rpx solid rgba(23, 32, 26, 0.18);
  border: 3rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
}

.cbk-box.is-done {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  border-color: #2e6bff;
  border-color: var(--brand, #2e6bff);
}

.cbk-tick { font-size: 22rpx; color: #ffffff; line-height: 1; }

.cbk-ci-text {
  flex: 1;
  font-size: 26rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  line-height: 1.5;
}

.cbk-ci-text.is-done {
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  text-decoration: line-through;
}

.cbk-prog { margin-top: 16rpx; }

.cbk-prog-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10rpx;
}

.cbk-prog-label {
  font-size: 24rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.cbk-prog-num {
  font-size: 24rpx;
  font-weight: 600;
  color: #2e6bff;
  color: var(--brand, #2e6bff);
}

.cbk-count {
  display: flex;
  align-items: center;
  margin-top: 10rpx;
}

.cbk-count-num {
  font-size: 72rpx;
  font-weight: 600;
  line-height: 1;
  color: #2e6bff;
  color: var(--brand, #2e6bff);
  font-family: Georgia, "Times New Roman", serif;
}

.cbk-count-side { margin-left: 18rpx; }

.cbk-count-unit {
  display: block;
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.cbk-count-title {
  display: block;
  margin-top: 6rpx;
  font-size: 26rpx;
  font-weight: 500;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.cbk-quote {
  margin-top: 14rpx;
  padding: 18rpx 22rpx;
  border-left: 6rpx solid rgba(46, 107, 255, 0.5);
  border-left: 6rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.5);
  background: rgba(46, 107, 255, 0.06);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.06);
  border-radius: 0 14rpx 14rpx 0;
}

.cbk-quote-text {
  display: block;
  font-size: 28rpx;
  line-height: 1.7;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.cbk-quote-author {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.cbk-tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: 14rpx;
}

.cbk-tag {
  font-size: 22rpx;
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  margin: 0 12rpx 12rpx 0;
}

.cbk-tag.tone-brand {
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
}

.cbk-tag.tone-neutral {
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.cbk-tag.tone-warn {
  color: #b25e00;
  background: rgba(247, 144, 9, 0.16);
}

.cbk-img {
  position: relative;
  width: 100%;
  margin-top: 14rpx;
  border-radius: 16rpx;
  overflow: hidden;
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
}

.cbk-img-el {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}

.cbk-img-cap {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12rpx 18rpx;
  font-size: 22rpx;
  color: #ffffff;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0));
}

.cbk-divider {
  height: 2rpx;
  margin: 20rpx 0;
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.cbk-btn {
  margin-top: 18rpx;
  height: 76rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 27rpx;
  font-weight: 500;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  color: #ffffff;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  border-radius: 999rpx;
}

.cbk-btn:active { opacity: 0.86; }

.cbk-empty {
  display: block;
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.cb-remove {
  position: absolute;
  right: 16rpx;
  top: 16rpx;
  font-size: 22rpx;
  color: #e5484d;
  padding: 6rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.8);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.8);
}
</style>
