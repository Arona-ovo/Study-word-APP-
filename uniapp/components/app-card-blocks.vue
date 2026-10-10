<template>
  <!--
    app-card-blocks：AI 卡片的"外壳"（配图 / 卡片级样式 / 换图入口 / 事件出口）。
    收纳与删除不在这里 —— 统一走「编辑首页 → 添加组件」，卡片表面保持干净。

    里面画什么已经全部交给 card-canvas（新设计规格 v2）。
    这里只做兼容：老卡片没有 design、只有 13 种块的扁平数组，
    现转成一份 design 再交给同一个渲染器 —— 老卡片一份不改，继续照常显示。
  -->
  <view class="cb" :class="shadowClass + ' ' + borderClass" :style="rootStyle">
    <!-- 卡片配图（image.set 换的就是它）；
         非编辑态给一个明确的「换图」按钮 —— 整张图都做成点击区会抢掉卡片内按钮的交互空间 -->
    <view v-if="card.image" class="cb-banner-wrap">
      <image class="cb-banner" :src="card.image" mode="aspectFill" lazy-load />
      <text v-if="editable" class="cb-img-edit" @tap.stop="onEditImage">{{ $t('换图') }}</text>
    </view>

    <view class="cb-body" :style="bodyStyle">
      <card-canvas
        v-if="design"
        :design="design"
        :live="live"
        :state="state"
        @act="onAct"
        @toggle="onToggle"
      />
      <!-- 兜底：既没有 design 也转不出块，别渲染成空白 -->
      <text v-else class="cbk-empty">{{ card.title || $t('空卡片') }}</text>
    </view>
  </view>
</template>

<script>
// components/app-card-blocks.vue - AI 卡片外壳（内容渲染见 components/card-canvas.vue）
//
// 这一层不做任何"解释"：它不认识节点类型，也不拼样式，
// 只把卡片自己的那份设计（或老块转出来的设计）交给渲染器。

import CardCanvas from './card-canvas.vue';
import { designOf } from '../utils/card-spec.js';

export default {
  name: 'AppCardBlocks',
  components: { CardCanvas },
  props: {
    card: { type: Object, default: () => ({}) },
    // 真实学习数据（pageDoc.liveValues()），用于 {{live.x}} 绑定
    live: { type: Object, default: () => ({}) },
    // 换图按钮的显隐：只在非编辑态出现（编辑态整卡被遮罩挡住，由页面统一管理）
    // 「移除」不在这里 —— 收纳 / 删除统一走「编辑首页 → 添加组件」，卡片表面保持干净
    editable: { type: Boolean, default: false }
  },
  computed: {
    design() {
      return designOf(this.card);
    },
    state() {
      const d = this.design;
      return (d && d.state) || {};
    },
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
    }
  },
  methods: {
    /**
     * 卡片内的点击 → 一个动作描述丢给页面，由页面去执行跳转 / 朗读 / 写状态。
     * 渲染器自己不执行任何副作用（不跳转、不发请求、不改数据）。
     */
    onAct(act) {
      const a = act || {};
      if (a.do === 'state.set') {
        this.$emit('state', { id: this.card.id, patch: patchOf(a.key, a.value) });
        return;
      }
      if (a.do === 'state.toggle') {
        this.$emit('state', { id: this.card.id, patch: patchOf(a.key, !this.state[a.key]) });
        return;
      }
      if (a.do === 'state.inc') {
        const cur = Number(this.state[a.key]);
        this.$emit('state', { id: this.card.id, patch: patchOf(a.key, (isFinite(cur) ? cur : 0) + (a.by || 1)) });
        return;
      }
      this.$emit('action', {
        kind: a.do || '',
        page: a.page || '',
        source: a.source || '',
        text: a.text || '',
        // 旧按钮块（action:"practice" 那种）继续沿用老的字段，页面侧不用改
        action: a.do === 'navigate' ? pageAlias(a.page) : (a.do || ''),
        speak: a.do === 'speak' ? (a.text || '') : ''
      });
    },
    /** 清单勾选：把"第几个区的第几个节点的第几项"交给页面改文档 */
    onToggle(e) {
      this.$emit('toggle', {
        id: this.card.id,
        si: e && e.si,
        ii: e && e.ii,
        index: e && e.index
      });
    },
    /** 非编辑态换图：只发事件，选图与落盘由页面做（组件不碰系统相册） */
    onEditImage() {
      this.$emit('image', { id: this.card.id });
    }
  }
};

function patchOf(key, value) {
  const o = {};
  if (key) o[key] = value;
  return o;
}

/** navigate 的 page 名 → 老动作名（practice/review/library…），让旧处理逻辑也能认 */
function pageAlias(page) {
  const m = {
    library: 'library', history: 'history', stats: 'stats', streak: 'streak',
    bookSwitch: 'wordbook', practice: 'practice', review: 'review', favorites: 'library'
  };
  return m[page] || '';
}
</script>

<style scoped>
.cb {
  position: relative;
  overflow: hidden;
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
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

.cb-banner-wrap { position: relative; }

.cb-img-edit {
  position: absolute;
  right: 14rpx;
  bottom: 14rpx;
  font-size: 22rpx;
  color: #17201a;
  color: var(--ink, #17201a);
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.88);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.88);
  border: 2rpx solid rgba(255, 255, 255, 0.75);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.75));
}

.cb-body { display: block; }

.cbk-empty {
  display: block;
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
