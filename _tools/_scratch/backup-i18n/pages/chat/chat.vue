<template>
  <view class="container chat-container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="AI 对话陪练" />

    <!-- 未开启 AI：引导 -->
    <view v-if="!aiEnabled" class="guide">
      <view class="guide-emoji">🤖</view>
      <view class="guide-title">AI 对话陪练未开启</view>
      <view class="guide-sub">在「设置 → AI 与语音」中填入服务商地址与密钥后，即可用英文和 AI 聊天练习。</view>
      <button class="btn-primary guide-btn" @tap="goSettings">去设置开启</button>
    </view>

    <block v-else>
      <scroll-view class="msg-list" scroll-y :scroll-into-view="scrollTarget" :scroll-with-animation="true">
        <view v-for="(m, i) in messages" :key="i" class="msg-row" :class="m.role">
          <view class="bubble" :class="m.role">{{ m.content }}</view>
        </view>
        <view v-if="thinking" class="msg-row assistant">
          <view class="bubble assistant typing"><view class="dot"></view><view class="dot"></view><view class="dot"></view></view>
        </view>
        <view id="msg-bottom"></view>
      </scroll-view>

      <view class="input-bar">
        <input
          class="chat-input"
          :value="draft"
          @input="e => draft = e.detail.value"
          placeholder="用英语和 AI 聊点什么…"
          confirm-type="send"
          :disabled="thinking"
          @confirm="send"
        />
        <button class="send-btn" @tap="send" :disabled="!draft.trim() || thinking">
          {{ thinking ? '…' : '发送' }}
        </button>
      </view>
    </block>
  </view>
</template>

<script>
import { isAIEnabled } from '../../services/config.js'
import { tutorSystemPrompt, chat as chatTutor } from '../../services/ai-content.js'
import * as wordbook from '../../utils/wordbook'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'

export default {
  components: { FloatNavbar },
  data() {
    return {
      aiEnabled: false,
      messages: [],
      draft: '',
      thinking: false,
      scrollTarget: ''
    }
  },
  onLoad() {
    this.aiEnabled = isAIEnabled()
    if (!this.aiEnabled) return
    const learned = this.learnedWords()
    this.messages = [
      { role: 'system', content: tutorSystemPrompt(learned) },
      { role: 'assistant', content: "Hi! I'm your English partner. Let's chat — how are you today?" }
    ]
  },
  methods: {
    learnedWords() {
      try {
        // 按当前词书口径取词（内置词 + 该书导入词），自建词书同样适用
        const bid = wordbook.currentBookId()
        const m = wordbook.masteryMap(bid)
        const all = wordbook.bookWords(bid)
        // 优先取「学习中/新词」作为陪练用词提示
        const weak = all.filter(w => ((m[w.id] || {}).m || 0) < 3).slice(0, 12)
        const pick = weak.length ? weak : all.slice(0, 12)
        return pick.map(w => w.w).filter(Boolean)
      } catch (e) { return [] }
    },
    goSettings() {
      uni.navigateTo({ url: '/pages/settings/settings' })
    },
    async send() {
      const text = String(this.draft || '').trim()
      if (!text || this.thinking) return
      this.messages.push({ role: 'user', content: text })
      this.draft = ''
      this.thinking = true
      this.scrollTarget = 'msg-bottom'
      // 仅把 system + 历史 + 当前问题发给模型（去掉用于展示的 assistant 欢迎语也会被一起发，但 system 在最前）
      const payload = this.messages.map(m => ({ role: m.role, content: m.content }))
      try {
        const r = await chatTutor(payload)
        const reply = (r && r.content) ? r.content.trim() : ''
        this.messages.push({ role: 'assistant', content: reply || '（AI 没有返回内容）' })
      } catch (e) {
        this.messages.push({ role: 'assistant', content: '抱歉，我暂时无法回应（请检查 AI 服务设置或网络）。' })
      } finally {
        this.thinking = false
        this.$nextTick(() => { this.scrollTarget = 'msg-bottom' })
      }
    }
  }
}
</script>

<style>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  /* 不要写死背景：根节点同时承担深色底 / 背景图（.app-dark 与 inline style） */
}

.guide {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 60rpx;
  text-align: center;
}

.guide-emoji { font-size: 96rpx; }

.guide-title { font-size: 34rpx; font-weight: 600; color: #17201a; margin-top: 24rpx; }
.guide-title { font-size: 34rpx; font-weight: 600; color: var(--ink-1, #17201a); margin-top: 24rpx; }

.guide-sub { font-size: 26rpx; color: #5a6560; line-height: 1.7; margin: 18rpx 0 40rpx; }
.guide-sub { font-size: 26rpx; color: var(--ink-2, #5a6560); line-height: 1.7; margin: 18rpx 0 40rpx; }

.guide-btn { width: 60%; }

.msg-list {
  flex: 1;
  padding: 24rpx;
  box-sizing: border-box;
}

.msg-row {
  display: flex;
  margin-bottom: 20rpx;
}

.msg-row.user { justify-content: flex-end; }

.msg-row.assistant { justify-content: flex-start; }

.bubble {
  max-width: 76%;
  padding: 20rpx 26rpx;
  border-radius: 24rpx;
  font-size: 30rpx;
  line-height: 1.6;
  word-break: break-word;
}

.bubble.user {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  color: #ffffff;
  border-bottom-right-radius: 6rpx;
}

.bubble.assistant {
  background: rgba(255, 255, 255, 0.74);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.74);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  backdrop-filter: blur(12px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  color: #17201a;
  color: var(--ink-1, #17201a);
  border-bottom-left-radius: 6rpx;
  box-shadow: 0 6rpx 18rpx rgba(23, 32, 26, 0.05);
  box-shadow: 0 6rpx 18rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
}

.bubble.typing { display: flex; align-items: center; }

.dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: #c8cdc9;
  margin: 0 4rpx;
  animation: blink 1.2s infinite both;
}

.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes blink {
  0%, 80%, 100% { opacity: 0.3; }
  40% { opacity: 1; }
}

/* 底部输入条：与悬浮导航同一套磨砂玻璃，形成上下呼应 */
.input-bar {
  display: flex;
  align-items: center;
  padding: 16rpx 20rpx;
  padding-bottom: calc(16rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  backdrop-filter: blur(12px) saturate(180%);
  border-top: 2rpx solid rgba(255, 255, 255, 0.7);
  border-top: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
}

.chat-input {
  flex: 1;
  height: 76rpx;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 999rpx;
  padding: 0 28rpx;
  font-size: 28rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.send-btn {
  flex-shrink: 0;
  margin-left: 16rpx;
  height: 76rpx;
  line-height: 76rpx;
  padding: 0 36rpx;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  color: #ffffff;
  font-size: 28rpx;
  border-radius: 999rpx;
}

.send-btn[disabled] { opacity: 0.5; }
</style>
