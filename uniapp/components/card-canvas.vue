<template>
  <!--
    card-canvas：AI 卡片设计规格 v2 的渲染器。

    结构只有两层且是**静态**的：卡片 → 分区(section) → 节点(node)。
    不做递归组件（小程序 WXML 不支持递归模板），节点数在上游就被夹死，
    所以这里永远是"两层 v-for"，不存在深递归 / 栈溢出。
    所有样式都由 utils/card-spec.js 在 JS 里算成字符串（纯函数、可单测），
    模板只负责把算好的串挂上去 —— 没有动态 CSS、没有原始 HTML 注入、没有表达式求值。
  -->
  <view class="cc">
    <view
      v-for="(sec, si) in view"
      :key="'s' + si"
      class="cc-sec"
      :style="sec._cell"
      @tap="onTap(sec, si, -1)"
    >
      <!-- 分区的"盒子"：底色 / 圆角 / 内边距都画在这一层，里面才是真正的排布 -->
      <view class="cc-secbox" :style="sec._box">
      <view
        v-for="(it, ii) in sec.items"
        :key="'n' + si + '-' + ii"
        class="cc-node"
        :style="it._cell"
      >
        <view :style="it._box" @tap.stop="onTap(it, si, ii)">

          <!-- 标题 -->
          <text v-if="it.kind === 'title'" class="cc-title" :class="'lv' + it.level">{{ it.text }}</text>

          <!-- 正文 -->
          <text v-else-if="it.kind === 'text'" class="cc-text" :class="'tone-' + toneOf(it)">{{ it.text }}</text>

          <!-- 数字 -->
          <view v-else-if="it.kind === 'metric'" class="cc-metric" :class="'sz-' + (it.size || 'md')">
            <text class="cc-metric-val">{{ it.value }}<text v-if="it.unit" class="cc-metric-unit">{{ it.unit }}</text></text>
            <text v-if="it.label" class="cc-metric-label">{{ it.label }}</text>
            <text v-if="it.caption" class="cc-metric-cap">{{ it.caption }}</text>
          </view>

          <!-- 进度条 -->
          <view v-else-if="it.kind === 'progress'" class="cc-prog">
            <view v-if="it.label || it.showPct" class="cc-prog-head">
              <text class="cc-prog-label">{{ it.label }}</text>
              <text v-if="it.showPct" class="cc-prog-num">{{ it._pct }}%</text>
            </view>
            <view class="progress-track">
              <view class="progress-fill" :style="{ width: it._pct + '%' }"></view>
            </view>
          </view>

          <!-- 圆环：与首页停留时长卡同一套画法（纯 transform + border，不用 Canvas / SVG） -->
          <view v-else-if="it.kind === 'ring'" class="cc-ring-row">
            <view class="cc-ring" :style="ringBox(it)">
              <view class="cc-ring-track" :style="ringTrack(it)"></view>
              <view class="cc-ring-win" :style="ringWin(it)">
                <view class="cc-ring-arc" :style="ringArcL(it)"></view>
              </view>
              <view class="cc-ring-win" :style="ringWinR(it)">
                <view class="cc-ring-arc" :style="ringArcR(it)"></view>
              </view>
              <view class="cc-ring-mid">
                <text class="cc-ring-num" :style="{ fontSize: ringSize(it) * 0.34 + 'rpx' }">{{ it._pct }}</text>
                <text class="cc-ring-pct" :style="{ fontSize: ringSize(it) * 0.16 + 'rpx' }">%</text>
              </view>
            </view>
            <view class="cc-ring-side">
              <text v-if="it.label" class="cc-ring-label">{{ it.label }}</text>
              <text v-if="it.caption" class="cc-ring-cap">{{ it.caption }}</text>
            </view>
          </view>

          <!-- 清单（可点选，状态写回文档） -->
          <view v-else-if="it.kind === 'checklist'" class="cc-check">
            <view
              v-for="(x, k) in it.items"
              :key="k"
              class="cc-ci"
              @tap.stop="onCheck(si, ii, k)"
            >
              <view class="cc-box" :class="{ 'is-done': x.done }">
                <text v-if="x.done" class="cc-tick">✓</text>
              </view>
              <text class="cc-ci-text" :class="{ 'is-done': x.done }">{{ x.text }}</text>
            </view>
          </view>

          <!-- 列表 -->
          <view v-else-if="it.kind === 'list'" class="cc-list">
            <view v-for="(x, k) in it.items" :key="k" class="cc-li">
              <text class="cc-li-dot">{{ it.ordered ? (k + 1) + '.' : '·' }}</text>
              <text class="cc-li-text">{{ x }}</text>
            </view>
          </view>

          <!-- 键值对 -->
          <view v-else-if="it.kind === 'kv'" class="cc-kv">
            <view v-for="(x, k) in it.items" :key="k" class="cc-kv-row">
              <text class="cc-kv-k">{{ x.k }}</text>
              <text class="cc-kv-v">{{ x.v }}</text>
            </view>
          </view>

          <!-- 引言 -->
          <view v-else-if="it.kind === 'quote'" class="cc-quote">
            <text class="cc-quote-text">{{ it.text }}</text>
            <text v-if="it.author" class="cc-quote-author">— {{ it.author }}</text>
          </view>

          <!-- 标签 -->
          <view v-else-if="it.kind === 'tags'" class="cc-tags">
            <text v-for="(x, k) in it.items" :key="k" class="cc-tag" :class="'tone-' + it.tone">{{ x }}</text>
          </view>

          <!-- 可切换的分片（点了把 value 写进卡片 state，配合 when 做"页签"） -->
          <view v-else-if="it.kind === 'chips'" class="cc-chips">
            <text
              v-for="(x, k) in it.items"
              :key="k"
              class="cc-chip"
              :class="{ 'is-on': it.bind && String(stateOf(it.bind)) === String(x.value) }"
              @tap.stop="onChip(it, x)"
            >{{ x.text }}</text>
          </view>

          <!-- 开关 -->
          <view v-else-if="it.kind === 'toggle'" class="cc-toggle" @tap.stop="onToggle(it)">
            <text class="cc-toggle-label">{{ it.label }}</text>
            <view class="cc-switch" :class="{ 'is-on': !!stateOf(it.bind) }">
              <view class="cc-knob"></view>
            </view>
          </view>

          <!-- 输入框（内容只存进这张卡的 state，不外发） -->
          <view v-else-if="it.kind === 'field'" class="cc-field">
            <text v-if="it.label" class="cc-field-label">{{ it.label }}</text>
            <input
              class="cc-field-input"
              :value="String(stateOf(it.bind) || '')"
              :placeholder="it.placeholder"
              placeholder-class="cc-field-ph"
              maxlength="40"
              @input="onField(it, $event)"
            />
          </view>

          <!-- 图片 -->
          <view v-else-if="it.kind === 'image'" class="cc-img" :style="{ paddingBottom: it.ratio * 100 + '%' }">
            <image v-if="it.url" class="cc-img-el" :src="it.url" mode="aspectFill" />
            <text v-if="it.caption" class="cc-img-cap">{{ it.caption }}</text>
          </view>

          <!-- 倒计时 -->
          <view v-else-if="it.kind === 'countdown'" class="cc-count">
            <text class="cc-count-num">{{ it._days }}</text>
            <view class="cc-count-side">
              <text class="cc-count-unit">{{ $t('天') }}</text>
              <text class="cc-count-title">{{ it.title }}</text>
            </view>
          </view>

          <!-- 按钮 -->
          <view v-else-if="it.kind === 'button'" class="cc-btn" :class="'v-' + (it.variant || 'primary')" @tap.stop="onTap(it, si, ii)">
            {{ it.text }}
          </view>

          <!-- 分隔线 -->
          <view v-else-if="it.kind === 'divider'" class="cc-divider"></view>

          <!-- 留白 -->
          <view v-else-if="it.kind === 'spacer'" :style="{ height: it.h + 'rpx' }"></view>
        </view>
      </view>
      </view>
    </view>
  </view>
</template>

<script>
// components/card-canvas.vue - AI 卡片设计规格 v2 的渲染器
//
// 输入是一份已经过 utils/card-spec.js 归一化的 design；
// 这里只做三件事：算样式串、解析数据绑定、把点击翻译成一个动作描述丢给父级。
// 它自己不改任何数据、不发请求、不碰 DOM。

import {
  cssOf, layoutCss, shadowCss, interpolate, testWhen, LIMITS
} from '../utils/card-spec.js';

const DAY = 86400000;

function todayStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 倒计时：支持 YYYY-MM-DD 与 +Nd */
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

const TEXT_KEYS = ['text', 'label', 'unit', 'caption', 'author', 'placeholder', 'title', 'value'];

export default {
  name: 'CardCanvas',
  props: {
    design: { type: Object, default: () => ({}) },
    // 真实学习数据（pageDoc.liveValues()）
    live: { type: Object, default: () => ({}) },
    // 卡片运行时状态（design.state + 用户交互产生的改动）
    state: { type: Object, default: () => ({}) }
  },
  computed: {
    ctx() {
      const d = this.design || {};
      return {
        live: this.live || {},
        state: this.state || {},
        data: d.data || {}
      };
    },
    /** 渲染视图：把 design 解析成"可直接画"的两层结构（样式串已算好） */
    view() {
      const d = this.design || {};
      const ctx = this.ctx;
      const out = [];
      const secs = Array.isArray(d.sections) ? d.sections : [];
      for (let si = 0; si < secs.length && out.length < LIMITS.MAX_SECTIONS; si++) {
        const sec = secs[si] || {};
        if (!testWhen(sec.when, ctx)) continue;
        const items = [];
        const list = Array.isArray(sec.items) ? sec.items : [];
        for (let ii = 0; ii < list.length; ii++) {
          const it = list[ii];
          if (!it || !testWhen(it.when, ctx)) continue;
          items.push(this.build(it, ii, sec, ctx));
        }
        if (!items.length) continue;
        out.push({
          layout: sec.layout || 'stack',
          _cell: layoutCss(sec.style),
          _box: cssOf(sec.style) + shadowCss(sec.style && sec.style.shadow) + this.flexCss(sec),
          on: sec.on || null,
          items: items
        });
      }
      return out;
    }
  },
  methods: {
    /** 单个节点：插值 + 绑值 + 算样式 */
    build(it, ii, sec, ctx) {
      const o = Object.assign({}, it);
      TEXT_KEYS.forEach(k => {
        if (typeof o[k] === 'string') o[k] = interpolate(o[k], ctx);
      });
      // 数字类节点：bind 命中活数据就显示真值，否则用写死的 value（也做插值）
      if (o.bind && ctx.live[o.bind] !== undefined) o.value = String(ctx.live[o.bind]);
      else if (typeof o.value === 'string') o.value = interpolate(o.value, ctx);
      if (Array.isArray(o.items)) {
        o.items = o.items.map(x => {
          if (typeof x === 'string') return interpolate(x, ctx);
          if (x && typeof x === 'object') {
            return Object.assign({}, x, {
              text: typeof x.text === 'string' ? interpolate(x.text, ctx) : x.text,
              k: typeof x.k === 'string' ? interpolate(x.k, ctx) : x.k,
              v: typeof x.v === 'string' ? interpolate(x.v, ctx) : x.v
            });
          }
          return x;
        });
      }
      if (o.kind === 'progress' || o.kind === 'ring') o._pct = pctOf(o);
      if (o.kind === 'countdown') o._days = daysLeft(o.date);
      o._cell = layoutCss(o.style) + this.cellCss(ii, sec);
      o._box = cssOf(o.style) + shadowCss(o.style && o.style.shadow);
      return o;
    },

    /** 格子布局：竖排靠 margin-top，横排 / 网格靠百分比宽 + 内缩 gutter */
    cellCss(ii, sec) {
      const g = sec.gap || 0;
      let s = '';
      if (sec.layout === 'stack') {
        s += 'width:100%;';
        if (ii > 0) s += 'margin-top:' + g + 'rpx;';
      } else if (sec.layout === 'grid') {
        const cols = sec.cols || 2;
        s += 'width:' + (100 / cols).toFixed(3) + '%;';
        s += 'padding-left:' + (g / 2) + 'rpx;padding-right:' + (g / 2) + 'rpx;box-sizing:border-box;';
      } else {
        if (ii > 0) s += 'margin-left:' + g + 'rpx;';
      }
      return s;
    },

    /** 分区怎么排：方向 / 对齐 / 换行 / 网格的负边距（配合格子的 padding 留出缝） */
    flexCss(sec) {
      const layout = sec.layout || 'stack';
      let s = 'display:flex;';
      s += layout === 'stack' ? 'flex-direction:column;' : 'flex-direction:row;';
      const va = sec.valign || (layout === 'stack' ? 'stretch' : 'center');
      s += 'align-items:' + (va === 'start' ? 'flex-start' : va === 'end' ? 'flex-end' : va === 'center' ? 'center' : 'stretch') + ';';
      if (layout === 'grid') {
        const g = (sec.gap || 0) / 2;
        s += 'flex-wrap:wrap;margin-left:-' + g + 'rpx;margin-right:-' + g + 'rpx;';
      }
      return s;
    },

    toneOf(it) {
      return ((it.style || {}).tone) || 'normal';
    },

    stateOf(key) {
      if (!key) return '';
      const v = (this.state || {})[key];
      return v === undefined || v === null ? '' : v;
    },

    /* ---------- 圆环（size 可随节点缩放，默认 140rpx） ---------- */
    ringSize(it) {
      const h = (it.style || {}).h;
      const n = Number(h);
      return (isFinite(n) && n >= 80 && n <= 320) ? n : 140;
    },
    ringBox(it) {
      const s = this.ringSize(it);
      return 'width:' + s + 'rpx;height:' + s + 'rpx;';
    },
    ringTrack(it) {
      const s = this.ringSize(it);
      const w = Math.max(6, Math.round(s * 0.09));
      return 'width:' + s + 'rpx;height:' + s + 'rpx;border:' + w + 'rpx solid rgba(var(--neutral-rgb,23,32,26),0.1);';
    },
    ringWin(it) {
      const s = this.ringSize(it);
      return 'width:' + (s / 2) + 'rpx;height:' + s + 'rpx;';
    },
    ringWinR(it) {
      const s = this.ringSize(it);
      return 'width:' + (s / 2) + 'rpx;height:' + s + 'rpx;left:' + (s / 2) + 'rpx;';
    },
    ringArcBase(it) {
      const s = this.ringSize(it);
      const w = Math.max(6, Math.round(s * 0.09));
      return 'width:' + s + 'rpx;height:' + (s / 2) + 'rpx;border:' + w +
        'rpx solid var(--brand,#2e6bff);border-top-left-radius:' + (s / 2) +
        'rpx;border-top-right-radius:' + (s / 2) + 'rpx;';
    },
    ringArcL(it) {
      const a = Number(it._pct) * 3.6;           // 0-100% → 0-360°
      const d = a > 180 ? a - 450 : -270;
      return this.ringArcBase(it) + 'transform:rotate(' + d + 'deg);';
    },
    ringArcR(it) {
      const a = Number(it._pct) * 3.6;
      const d = a <= 180 ? a - 90 : 90;
      return this.ringArcBase(it) + 'transform:rotate(' + d + 'deg);left:' + (-this.ringSize(it) / 2) + 'rpx;';
    },

    /* ---------- 交互：一律翻译成一个动作描述交给父级，自己不执行任何副作用 ---------- */
    onTap(node, si, ii) {
      const act = node && node.on && node.on.tap;
      if (!act) return;
      this.$emit('act', Object.assign({}, act));
    },
    onCheck(si, ii, k) {
      this.$emit('toggle', { si: si, ii: ii, index: k });
    },
    onChip(it, x) {
      if (!it.bind) return;
      this.$emit('act', { do: 'state.set', key: it.bind, value: String(x.value === undefined ? x.text : x.value) });
    },
    onToggle(it) {
      if (!it.bind) return;
      this.$emit('act', { do: 'state.toggle', key: it.bind });
    },
    onField(it, e) {
      if (!it.bind) return;
      const v = e && e.detail ? e.detail.value : '';
      this.$emit('act', { do: 'state.set', key: it.bind, value: String(v || '').slice(0, 40) });
    }
  }
};

function pctOf(o) {
  const raw = Number(o.value);
  const cur = isFinite(raw) ? raw : 0;
  const target = Number(o.target) || 100;
  return Math.round(Math.max(0, Math.min(1, cur / target)) * 100);
}
</script>

<style scoped>
.cc { display: block; }

.cc-sec {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.cc-sec + .cc-sec { margin-top: 20rpx; }

.cc-node { display: block; min-width: 0; }

/* ---------- 文字 ---------- */
.cc-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.cc-title.lv2 { font-size: 26rpx; font-weight: 500; }

.cc-text {
  display: block;
  font-size: 26rpx;
  line-height: 1.6;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
.cc-text.tone-normal { color: #5a6560; color: var(--ink-2, #5a6560); }
.cc-text.tone-muted { color: #98a19b; color: var(--ink-3, #98a19b); }
.cc-text.tone-strong { color: #17201a; color: var(--ink-1, #17201a); font-weight: 500; }
.cc-text.tone-brand { color: #1d4fd8; color: var(--brand-strong, #1d4fd8); }
.cc-text.tone-danger { color: #e5484d; }
.cc-text.tone-warn { color: #b25e00; }
.cc-text.tone-ok { color: #2f9e6e; }

/* ---------- 数字 ---------- */
.cc-metric {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.cc-metric-val {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 40rpx;
  font-weight: 600;
  line-height: 1.1;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.cc-metric.sz-sm .cc-metric-val { font-size: 30rpx; }
.cc-metric.sz-lg .cc-metric-val { font-size: 56rpx; }
.cc-metric-unit { font-size: 22rpx; margin-left: 4rpx; }
.cc-metric-label {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
.cc-metric-cap {
  margin-top: 4rpx;
  font-size: 21rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* ---------- 进度 ---------- */
.cc-prog { display: block; width: 100%; }
.cc-prog-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10rpx;
}
.cc-prog-label { font-size: 24rpx; color: #5a6560; color: var(--ink-2, #5a6560); }
.cc-prog-num { font-size: 24rpx; font-weight: 600; color: #2e6bff; color: var(--brand, #2e6bff); }

/* ---------- 圆环 ---------- */
.cc-ring-row { display: flex; align-items: center; }
.cc-ring { position: relative; flex-shrink: 0; }
.cc-ring-track { position: absolute; left: 0; top: 0; box-sizing: border-box; border-radius: 50%; }
.cc-ring-win { position: absolute; top: 0; left: 0; overflow: hidden; }
.cc-ring-arc {
  position: absolute;
  top: 0;
  left: 0;
  box-sizing: border-box;
  border-bottom: none;
  transform-origin: 50% 100%;
  transition: transform 700ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
.cc-ring-mid {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: baseline;
  justify-content: center;
}
.cc-ring-num {
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 600;
  line-height: 1;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.cc-ring-pct { color: #98a19b; color: var(--ink-3, #98a19b); margin-left: 2rpx; }
.cc-ring-side { margin-left: 20rpx; flex: 1; min-width: 0; }
.cc-ring-label {
  display: block;
  font-size: 26rpx;
  font-weight: 500;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.cc-ring-cap {
  display: block;
  margin-top: 4rpx;
  font-size: 21rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* ---------- 清单 ---------- */
.cc-check { display: block; width: 100%; }
.cc-ci { display: flex; align-items: center; padding: 10rpx 0; }
.cc-box {
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
.cc-box.is-done {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  border-color: #2e6bff;
  border-color: var(--brand, #2e6bff);
}
.cc-tick { font-size: 22rpx; color: #ffffff; line-height: 1; }
.cc-ci-text { flex: 1; font-size: 26rpx; line-height: 1.5; color: #17201a; color: var(--ink-1, #17201a); }
.cc-ci-text.is-done { color: #98a19b; color: var(--ink-3, #98a19b); text-decoration: line-through; }

/* ---------- 列表 ---------- */
.cc-list { display: block; width: 100%; }
.cc-li { display: flex; padding: 6rpx 0; }
.cc-li-dot { width: 34rpx; flex-shrink: 0; font-size: 24rpx; color: #2e6bff; color: var(--brand, #2e6bff); }
.cc-li-text { flex: 1; font-size: 26rpx; line-height: 1.55; color: #17201a; color: var(--ink-1, #17201a); }

/* ---------- 键值对 ---------- */
.cc-kv { display: block; width: 100%; }
.cc-kv-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 10rpx 0;
  border-top: 2rpx solid rgba(23, 32, 26, 0.06);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
}
.cc-kv-k { font-size: 24rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
.cc-kv-v { font-size: 26rpx; font-weight: 500; color: #17201a; color: var(--ink-1, #17201a); }

/* ---------- 引言 ---------- */
.cc-quote {
  padding: 18rpx 22rpx;
  border-left: 6rpx solid rgba(46, 107, 255, 0.5);
  border-left: 6rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.5);
  background: rgba(46, 107, 255, 0.06);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.06);
  border-radius: 0 14rpx 14rpx 0;
}
.cc-quote-text {
  display: block;
  font-size: 28rpx;
  line-height: 1.7;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}
.cc-quote-author { display: block; margin-top: 10rpx; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

/* ---------- 标签 / 分片 ---------- */
.cc-tags { display: flex; flex-wrap: wrap; }
.cc-tag {
  font-size: 22rpx;
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  margin: 0 12rpx 12rpx 0;
}
.cc-tag.tone-brand {
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
}
.cc-tag.tone-neutral {
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}
.cc-tag.tone-warn { color: #b25e00; background: rgba(247, 144, 9, 0.16); }

.cc-chips { display: flex; flex-wrap: wrap; }
.cc-chip {
  font-size: 23rpx;
  padding: 12rpx 24rpx;
  border-radius: 999rpx;
  margin: 0 12rpx 12rpx 0;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(23, 32, 26, 0.06);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
}
.cc-chip.is-on {
  color: #ffffff;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  font-weight: 500;
}

/* ---------- 开关 ---------- */
.cc-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.cc-toggle-label { flex: 1; font-size: 26rpx; color: #17201a; color: var(--ink-1, #17201a); }
.cc-switch {
  width: 76rpx;
  height: 44rpx;
  flex-shrink: 0;
  border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.18);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.18);
  padding: 4rpx;
  box-sizing: border-box;
  transition: background 200ms ease;
}
.cc-switch.is-on { background: #2e6bff; background: var(--brand, #2e6bff); }
.cc-knob {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 200ms ease;
}
.cc-switch.is-on .cc-knob { transform: translateX(32rpx); }

/* ---------- 输入框 ---------- */
.cc-field { display: block; width: 100%; }
.cc-field-label {
  display: block;
  margin-bottom: 10rpx;
  font-size: 23rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
.cc-field-input {
  width: 100%;
  box-sizing: border-box;
  padding: 16rpx 20rpx;
  font-size: 26rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
}
.cc-field-ph { color: #98a19b; color: var(--ink-3, #98a19b); }

/* ---------- 图片 ---------- */
.cc-img {
  position: relative;
  width: 100%;
  border-radius: 16rpx;
  overflow: hidden;
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
}
.cc-img-el { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
.cc-img-cap {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12rpx 18rpx;
  font-size: 22rpx;
  color: #ffffff;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0));
}

/* ---------- 倒计时 ---------- */
.cc-count { display: flex; align-items: center; }
.cc-count-num {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 72rpx;
  font-weight: 600;
  line-height: 1;
  color: #2e6bff;
  color: var(--brand, #2e6bff);
}
.cc-count-side { margin-left: 18rpx; }
.cc-count-unit { display: block; font-size: 24rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
.cc-count-title { display: block; margin-top: 6rpx; font-size: 26rpx; font-weight: 500; color: #17201a; color: var(--ink-1, #17201a); }

/* ---------- 按钮 ---------- */
.cc-btn {
  height: 76rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 27rpx;
  font-weight: 500;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  border-radius: 999rpx;
}
.cc-btn.v-primary { color: #ffffff; background: #2e6bff; background: var(--brand, #2e6bff); }
.cc-btn.v-ghost {
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.34);
}
.cc-btn.v-danger { color: #ffffff; background: #e5484d; }
.cc-btn.v-plain {
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(23, 32, 26, 0.06);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
}
.cc-btn:active { opacity: 0.86; }

.cc-divider {
  height: 2rpx;
  width: 100%;
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

@media (prefers-reduced-motion: reduce) {
  .cc-ring-arc,
  .cc-switch,
  .cc-knob { transition: none; }
}
</style>
