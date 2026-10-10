<template>
  <view class="card wdg-card">
    <view class="wdg-head">
      <text class="wdg-title">{{ $t('AI 对话陪练') }}</text>
      <text class="wdg-link" @tap="goChat">{{ $t('继续 ›') }}</text>
    </view>

    <view class="ch-meta">
      <text class="ch-num">{{ saved }}</text>
      <text class="ch-unit">{{ $t('句已收藏') }}</text>
      <text class="ch-dot">·</text>
      <text class="ch-when">{{ lastText }}</text>
    </view>

    <!-- AI 没配好：入口照常摆在这儿并置灰，绝不 v-if 藏掉（藏了用户会当成功能被删）。
         点了给一句人话，指到该去哪儿开。 -->
    <button class="ch-main" :class="{ 'entry-disabled': !aiOk }" @tap="goChat">{{ $t('开始对话') }}</button>

    <view class="ch-row">
      <button class="ch-mini" @tap="goSentences">{{ $t('我的句子 ›') }}</button>
      <button class="ch-mini" :class="{ 'entry-disabled': !sessCount }" @tap="goHistory">{{ $t('历史对话 ›') }}</button>
    </view>

    <text class="wdg-foot">{{ aiOk ? $t('用英文和 AI 自由聊，长按气泡可把句子收进收藏') : offText }}</text>
  </view>
</template>

<script>
import { isAIEnabled } from '../../services/config.js'
import { featureOn, offHint } from '../../services/ai-gate.js'
import * as chatStore from '../../utils/chat-store.js'

// 首页「AI 对话陪练」卡：对话入口 + 已收藏的句子数。
// 会话存档不存首页状态里（那是另一个 key，见 utils/chat-store.js），
// 这里只负责把"聊过几次 / 收了几句"读出来给人看。
export default {
  name: 'WidgetChat',
  data() {
    return {
      saved: 0,
      sessCount: 0,
      lastAt: 0,
      aiOk: false
    }
  },
  computed: {
    lastText() {
      if (!this.lastAt) return this.$t('还没有聊过')
      const d = Date.now() - this.lastAt
      // 整句 + {n} 占位符：英文里 "3 minutes ago" 的数量位置不一样，拼接会把语序搞反
      if (d < 60 * 1000) return this.$t('刚刚')
      if (d < 3600 * 1000) return this.$t('{n} 分钟前', { n: Math.floor(d / 60000) })
      if (d < 24 * 3600 * 1000) return this.$t('{n} 小时前', { n: Math.floor(d / 3600000) })
      return this.$t('{n} 天前', { n: Math.floor(d / 86400000) })
    },
    offText() {
      try { return isAIEnabled() ? offHint('chat') : this.$t('在「设置 → AI 与语音」里填入服务商与密钥后可用') } catch (e) { return '' }
    }
  },
  created() {
    this.refresh()
    // tab 页常驻，created 只跑一次；从陪练页回来靠这个事件把数字刷过来
    try { uni.$on('home:refresh', this.refresh) } catch (e) {}
  },
  beforeDestroy() {
    try { uni.$off('home:refresh', this.refresh) } catch (e) {}
  },
  methods: {
    refresh() {
      try {
        const list = chatStore.sessions()
        this.sessCount = list.length
        this.lastAt = list.length ? (list[0].updatedAt || 0) : 0
        this.saved = chatStore.savedCount()
      } catch (e) { /* 读不出来就保持原样，不影响首页 */ }
      try {
        this.aiOk = !!isAIEnabled() && featureOn('chat')
      } catch (e) { this.aiOk = false }
    },
    goChat() {
      if (!this.aiOk) {
        uni.showToast({ title: this.offText || this.$t('请先接入 AI'), icon: 'none' })
        return
      }
      uni.navigateTo({ url: '/pkgManage/pages/chat/chat' })
    },
    goSentences() {
      uni.navigateTo({ url: '/pkgStudy/pages/favorites/favorites?tab=sentence' })
    },
    goHistory() {
      if (!this.sessCount) {
        uni.showToast({ title: this.$t('还没有历史对话'), icon: 'none' })
        return
      }
      uni.navigateTo({ url: '/pkgManage/pages/chat/chat?list=1' })
    }
  }
}
</script>

<style scoped>
.wdg-card { margin-bottom: 20rpx; }

.wdg-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14rpx; }

.wdg-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

.wdg-link { font-size: 22rpx; color: #1d4fd8; }
.wdg-link { font-size: 22rpx; color: var(--brand-strong, #1d4fd8); }

.ch-meta { display: flex; align-items: baseline; margin-bottom: 18rpx; }

.ch-num {
  font-size: 40rpx;
  font-weight: 600;
  line-height: 1.2;
  color: #7c3aed;
}

.ch-unit { margin-left: 8rpx; font-size: 24rpx; color: #5a6560; }
.ch-unit { margin-left: 8rpx; font-size: 24rpx; color: var(--ink-2, #5a6560); }

.ch-dot { margin: 0 12rpx; font-size: 22rpx; color: #98a19b; }
.ch-dot { margin: 0 12rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.ch-when { font-size: 22rpx; color: #98a19b; }
.ch-when { font-size: 22rpx; color: var(--ink-3, #98a19b); }

.ch-main {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  height: 88rpx;
  font-size: 30rpx;
  font-weight: 500;
  letter-spacing: 2rpx;
  text-indent: 2rpx;
  color: #ffffff;
  background: #7c3aed;
  border-radius: 999rpx;
}

.ch-main::after { border: none; }
.ch-main:active { opacity: 0.88; }

/* 置灰而不是隐藏：入口消失了用户会以为功能被删 */
.ch-main.entry-disabled { opacity: 0.45; }

.ch-row { display: flex; margin-top: 16rpx; }

/* 与「刷单词」卡的 .wb-mini 保持完全同款 */
.ch-mini {
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

.ch-mini:first-child { margin-left: 0; }
.ch-mini:last-child { margin-right: 0; }
.ch-mini::after { border: none; }
.ch-mini:active { background: rgba(46, 107, 255, 0.12); }
.ch-mini:active { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }
.ch-mini.entry-disabled { opacity: 0.45; }

.wdg-foot {
  display: block;
  margin-top: 16rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
