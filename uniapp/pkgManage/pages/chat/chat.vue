<template>
  <view class="container chat-container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('AI 对话陪练')" />

    <!-- 未开启 AI：引导 -->
    <view v-if="!aiEnabled" class="guide">
      <view class="guide-emoji">🤖</view>
      <view class="guide-title">{{ $t('AI 对话陪练未开启') }}</view>
      <view class="guide-sub">{{ $t('在「设置 → AI 与语音」中填入服务商地址与密钥后，即可用英文和 AI 聊天练习。') }}</view>
      <button class="btn-primary guide-btn" @tap="goSettings">{{ $t('去设置开启') }}</button>
    </view>

    <block v-else>
      <!-- 会话工具条：历史 / 新对话 / 我收的句子。
           存档是自动的（发一句存一句），这里只给"换一场"和"回看"的入口。 -->
      <view class="chat-bar">
        <text class="cb-btn" @tap="openList">{{ $t('历史') }}</text>
        <text class="cb-btn" @tap="newChat">{{ $t('新对话') }}</text>
        <text class="cb-btn cb-right" @tap="goSentences">{{ $t('我的句子') }}</text>
      </view>

      <scroll-view class="msg-list" scroll-y :scroll-into-view="scrollTarget" :scroll-with-animation="true">
        <view v-for="(m, i) in viewMessages" :key="i" class="msg-row" :class="m.role">
          <view class="msg-col">
            <!-- 长按气泡 = 收藏这句（和点的效果一样，只是更快） -->
            <view class="bubble" :class="m.role" @longpress="saveMsg(m)">{{ m.content }}</view>
            <view class="msg-acts">
              <text class="msg-act" :class="{ on: m.saved }" @tap="saveMsg(m)">
                {{ m.saved ? '★ ' + $t('已收藏') : '☆ ' + $t('收藏这句') }}
              </text>
              <text class="msg-act" @tap="speak(m.content)">{{ $t('朗读') }}</text>
            </view>
          </view>
        </view>
        <view v-if="thinking" class="msg-row assistant">
          <view class="bubble assistant typing"><view class="dot"></view><view class="dot"></view><view class="dot"></view></view>
        </view>
        <!-- 两个锚点轮流用：scroll-into-view 只在**值变化**时才会滚，
             同一个 id 连赋两次端上纹丝不动（结果就是回复落在屏幕外，得手动往下滑） -->
        <view id="mb-a"></view>
        <view id="mb-b"></view>
      </scroll-view>

      <view class="input-bar">
        <input
          class="chat-input"
          :value="draft"
          @input="e => draft = e.detail.value"
          :focus="inputFocus"
          :hold-keyboard="true"
          @focus="kbOn = true"
          @blur="kbOn = false"
          :placeholder="$t('用英语和 AI 聊点什么…')"
          confirm-type="send"
          @confirm="send"
        />
        <button class="send-btn" @tap="send" :disabled="!draft.trim() || thinking">
          {{ thinking ? '…' : $t('发送') }}
        </button>
      </view>
    </block>

    <!-- 历史对话：点一条切过去；删除只删那一条 -->
    <view v-if="listShow" class="cb-mask" @tap="closeList">
      <view class="cb-sheet" @tap.stop="noop">
        <view class="cb-head">
          <text class="cb-title">{{ $t('历史对话') }}</text>
          <text class="cb-close" @tap="closeList">{{ $t('关闭') }}</text>
        </view>
        <scroll-view class="cb-body" scroll-y>
          <view
            v-for="(s, i) in sessions"
            :key="s.id"
            class="cb-item"
            :class="{ cur: s.id === sessionId }"
            @tap="openSession(s.id)"
          >
            <view class="cb-line">
              <text class="cb-name">{{ chatTitle(s, i) }}</text>
              <text class="cb-del" @tap.stop="delSession(s.id)">{{ $t('删除') }}</text>
            </view>
            <text class="cb-sub">{{ whenText(s.updatedAt) }} · {{ $t('{n} 条消息', { n: s.messages.length }) }}</text>
          </view>
          <view v-if="!sessions.length" class="cb-empty">{{ $t('还没有历史对话') }}</view>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<script>
import { t } from '../../../utils/i18n.js';
import { isAIEnabled } from '../../../services/config.js'
import { featureOn } from '../../../services/ai-gate.js'
import { tutorSystemPrompt, chat as chatTutor, explainWord } from '../../../services/ai-content.js'
import * as wordbook from '../../../utils/wordbook'
import * as chatStore from '../../../utils/chat-store.js'
import * as tts from '../../../services/voice'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

const GREETING = "Hi! I'm your English partner. Let's chat — how are you today?";

export default {
  components: { FloatNavbar },
  data() {
    return {
      aiEnabled: false,
      sessionId: '',
      messages: [],
      draft: '',
      thinking: false,
      scrollTarget: '',
      lastScrollAt: 0,    // 滚到底的节流（流式逐字来，别一个字滚一次）
      inputFocus: false,  // 发完一句后把焦点抢回来（键盘不收，聊天是连续的）
      kbOn: false,        // input 当前有没有焦点：没丢就别做多余的 false→true（会闪）
      savedSig: 0,        // 收藏状态变了要重算 viewMessages
      streamTick: 0,      // 流式每来一段就 +1：viewMessages 是计算属性，靠它失效重算
      listShow: false,
      sessions: []
    }
  },
  computed: {
    // 展示用：去掉 system（它每次都按当前词书重新生成，不该出现在屏幕上），
    // 另外把"这句收过没有"提前算好 —— 小程序端模板里不能写函数调用。
    viewMessages() {
      // 这两个是"手动失效开关"：收藏状态变了 / 流式又吐了几个字，都要重算。
      // ⚠️ 少了 streamTick 这一行，AI 的回复会一直停在空气泡上（计算属性缓存不失效）。
      void this.savedSig
      void this.streamTick
      return this.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role,
          content: m.content,
          saved: chatStore.isSentenceSaved(m.content)
        }))
    }
  },
  onLoad(opt) {
    this.aiEnabled = !!isAIEnabled() && featureOn('chat')
    if (!this.aiEnabled) return
    this.loadSession(chatStore.active())
    if (opt && opt.list === '1') this.openList()
  },
  onUnload() {
    // 关页面前一定落盘：写盘是 800ms 合并的，直接退出可能丢最后一句
    this.persist()
    chatStore.flush()
    tts.stop()
  },
  onBackPress() {
    // 历史面板开着 → 返回键先关它，而不是直接离开页面
    if (this.listShow) { this.closeList(); return true }
    return false
  },
  methods: {
    // ---------- 会话 ----------
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
    // system 提示词不落盘：每次按当前词书重新生成，存下来只会越来越旧
    systemMsg() {
      return { role: 'system', content: tutorSystemPrompt(this.learnedWords()) }
    },
    loadSession(s) {
      if (!s) return
      this.sessionId = s.id
      const history = (s.messages || []).map(m => ({ role: m.role, content: m.content }))
      this.messages = [this.systemMsg()].concat(
        history.length ? history : [{ role: 'assistant', content: GREETING }]
      )
      this.savedSig++
      this.scrollToEnd(true)
    },
    persist() {
      if (!this.sessionId) return
      // 存档是附属功能：写盘炸了也绝不能把"发一句话"这个主流程带崩
      try { chatStore.saveMessages(this.sessionId, this.messages) } catch (e) { /* 存不下就算了，聊天继续 */ }
    },
    newChat() {
      this.persist()
      const s = chatStore.create()
      this.messages = [this.systemMsg(), { role: 'assistant', content: GREETING }]
      this.sessionId = s.id
      this.savedSig++
      this.closeList()
      uni.showToast({ title: t('已开一场新对话'), icon: 'none' })
    },
    openList() {
      this.sessions = chatStore.sessions()
      this.listShow = true
    },
    closeList() { this.listShow = false },
    openSession(id) {
      this.persist()
      const s = chatStore.open(id)
      this.closeList()
      if (s) this.loadSession(s)
    },
    delSession(id) {
      chatStore.remove(id)
      this.sessions = chatStore.sessions()
      // 删掉的正是当前这场 → 切到剩下最近的一场（没有就新开）
      if (id === this.sessionId) {
        const s = chatStore.active()
        this.loadSession(s)
      }
    },
    noop() {},

    // ---------- 滚到底 / 键盘 ----------
    /**
     * 滚到最新一条。
     * ⚠️ scroll-into-view 只在**值发生变化**时才滚动 —— 写死同一个 id 连赋两次，
     *    端上不会有任何反应（真机表现：发完一句话，AI 的回复在屏幕外面，得手动往下滑）。
     *    所以两个锚点轮流指，保证每次都是一次真实的变化。
     */
    scrollToEnd(force) {
      const now = Date.now()
      if (!force && now - this.lastScrollAt < 150) return   // 流式逐字来，别一个字滚一次
      this.lastScrollAt = now
      // 等新内容先渲染出来再滚，否则滚的是上一帧的底部
      this.$nextTick(() => {
        this.scrollTarget = this.scrollTarget === 'mb-a' ? 'mb-b' : 'mb-a'
      })
    },
    // 发完一句键盘要留着：聊天是连续的，每句都收起来就得重新点一下输入框。
    // 只有焦点真被抢走了才抢回来（false→true 会闪一下，没丢就别动）
    keepKeyboard() {
      if (this.kbOn) return
      this.inputFocus = false
      this.$nextTick(() => { this.inputFocus = true })
    },

    // ---------- 收藏句子 ----------
    // 聊天里冒出来的好句子，一键收进「我的收藏」，和词库页收藏的例句是同一套：
    // 之后在收藏列表里能点开逐词点读、也能把这整句存进词书（见 sentence-detail）。
    async saveMsg(m) {
      const en = String((m && m.content) || '').trim()
      if (!en) return
      if (chatStore.isSentenceSaved(en)) {
        try {
          const id = 'csen-' + chatStore.sentenceIdOf(en)
          chatStore.removeSentence(id)
          this.savedSig++
          uni.showToast({ title: t('已取消收藏'), icon: 'none' })
        } catch (e) {}
        return
      }
      // 译文：有 AI 就顺手问一句（结果进 aiCache，同一句不会问第二次）。
      // 没配 AI / 关了释义开关也不拦着收藏 —— 句子先存下来，译文以后再补。
      let zh = ''
      if (this.aiEnabled) {
        uni.showToast({ title: t('正在补充译文…'), icon: 'none', duration: 1200 })
        try {
          const r = await explainWord(en)
          if (r) zh = String(r.meaningZh || '').trim()
        } catch (e) { zh = '' }
      }
      const res = chatStore.saveSentence(en, zh, { from: 'chat' })
      this.savedSig++
      if (res && res.ok) uni.showToast({ title: t('已收进「我的收藏」'), icon: 'none' })
      else if (res && res.dup) uni.showToast({ title: t('这句已经收过了'), icon: 'none' })
      else uni.showToast({ title: t('这句收不进来'), icon: 'none' })
    },
    speak(text) {
      const s = String(text || '').trim()
      if (!s) return
      try { tts.speakSentence(s) } catch (e) {}
    },

    goSettings() {
      uni.navigateTo({ url: '/pkgManage/pages/settings/settings' })
    },
    goSentences() {
      uni.navigateTo({ url: '/pkgStudy/pages/favorites/favorites?tab=sentence' })
    },

    async send() {
      const text = String(this.draft || '').trim()
      if (!text || this.thinking) return
      this.messages.push({ role: 'user', content: text })
      this.draft = ''
      this.thinking = true
      this.scrollToEnd(true)
      this.keepKeyboard()
      this.persist()
      // 仅把 system + 历史 + 当前问题发给模型（去掉用于展示的 assistant 欢迎语也会被一起发，但 system 在最前）
      const payload = this.messages.map(m => ({ role: m.role, content: m.content }))
      // 先占一个空气泡：流式时逐字往里灌，体验像真人打字；
      // 端不支持流式时 onDelta 一次都不会被调，chat() 内部自动回退整块返回，
      // 最后这里还是会拿到完整内容 —— 两条路径在同一处收口。
      //
      // ⚠️ 必须拿「push 进数组之后」的那个对象来改：Vue 3 里 push 进去的是裸对象，
      //    直接改裸对象不会触发响应式，而 viewMessages 是计算属性（结果会被缓存），
      //    于是回复明明已经拿到、界面却停在空气泡上 —— 只有退出重进才看得到。
      const idx = this.messages.length
      this.messages.push({ role: 'assistant', content: '' })
      const bubble = this.messages[idx]
      const bump = () => { this.streamTick++ }
      try {
        const r = await chatTutor(payload, {
          onDelta: (piece) => {
            bubble.content += String(piece || '')
            bump()                  // 哪怕代理失效，也能靠它把字刷到屏幕上
            this.thinking = false   // 第一个字到了就不再"思考中"
            this.scrollToEnd()      // 字一个一个来，跟着往下滚
          }
        })
        const reply = (r && r.content) ? r.content.trim() : ''
        bubble.content = reply || t('（AI 没有返回内容）')
        bump()
      } catch (e) {
        bubble.content = t('抱歉，我暂时无法回应（请检查 AI 服务设置或网络）。')
        bump()
      } finally {
        this.thinking = false
        this.persist()
        chatStore.flush()
        this.scrollToEnd(true)
      }
    },

    // ---------- 展示用小工具 ----------
    chatTitle(s, i) {
      try { return chatStore.titleOf(s, i) } catch (e) { return '' }
    },
    whenText(at) {
      const ms = Date.now() - (Number(at) || 0)
      if (!(ms >= 0) || !at) return ''
      if (ms < 60 * 1000) return t('刚刚')
      if (ms < 3600 * 1000) return t('{n} 分钟前', { n: Math.floor(ms / 60000) })
      if (ms < 24 * 3600 * 1000) return t('{n} 小时前', { n: Math.floor(ms / 3600000) })
      return t('{n} 天前', { n: Math.floor(ms / 86400000) })
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

/* ---------- 会话工具条 ---------- */
.chat-bar {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 24rpx 12rpx;
}

.cb-btn {
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.34);
  border-radius: 999rpx;
  padding: 8rpx 24rpx;
  margin-right: 16rpx;
}

.cb-btn:active { background: rgba(46, 107, 255, 0.12); }
.cb-btn:active { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }

.cb-right { margin-right: 0; margin-left: auto; }

.msg-list {
  flex: 1;
  padding: 0 24rpx 24rpx;
  box-sizing: border-box;
}

.msg-row {
  display: flex;
  margin-bottom: 16rpx;
}

.msg-row.user { justify-content: flex-end; }

.msg-row.assistant { justify-content: flex-start; }

/* 气泡 + 操作行竖排：操作行跟着气泡对齐，不会跑到屏幕另一头 */
.msg-col { display: flex; flex-direction: column; max-width: 78%; }

.msg-row.user .msg-col { align-items: flex-end; }

.bubble {
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
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  color: #17201a;
  color: var(--ink-1, #17201a);
  border-bottom-left-radius: 6rpx;
  box-shadow: 0 6rpx 18rpx rgba(23, 32, 26, 0.05);
  box-shadow: 0 6rpx 18rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
}

.bubble.typing { display: flex; align-items: center; }

/* 气泡下面的小操作：收藏 / 朗读。字号压到 20rpx，不抢正文 */
.msg-acts {
  display: flex;
  align-items: center;
  margin-top: 8rpx;
  padding: 0 6rpx;
}

.msg-act {
  font-size: 20rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  margin-right: 20rpx;
}

.msg-act.on { color: #7c3aed; font-weight: 600; }

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
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border-top: 2rpx solid rgba(255, 255, 255, 0.7);
  border-top: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
}

.chat-input {
  flex: 1;
  height: 76rpx;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
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

/* ---------- 历史对话面板 ---------- */
.cb-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 60;
  background: rgba(23, 32, 26, 0.34);
  display: flex;
  align-items: flex-end;
}

.cb-sheet {
  width: 100%;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.96);
  border-radius: 28rpx 28rpx 0 0;
  padding: 28rpx 28rpx calc(28rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.cb-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20rpx; }

.cb-title { font-size: 30rpx; font-weight: 600; color: #17201a; }
.cb-title { font-size: 30rpx; font-weight: 600; color: var(--ink-1, #17201a); }

.cb-close { font-size: 24rpx; color: #98a19b; }
.cb-close { font-size: 24rpx; color: var(--ink-3, #98a19b); }

.cb-body { max-height: 56vh; }

.cb-item {
  padding: 20rpx 0;
  border-top: 2rpx solid rgba(23, 32, 26, 0.07);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.cb-item.cur { }

.cb-line { display: flex; align-items: center; justify-content: space-between; }

.cb-name {
  flex: 1;
  font-size: 28rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cb-item.cur .cb-name { font-weight: 600; color: #1d4fd8; }
.cb-item.cur .cb-name { color: var(--brand-strong, #1d4fd8); }

.cb-del { flex-shrink: 0; margin-left: 20rpx; font-size: 24rpx; color: #e5484d; }

.cb-sub { display: block; margin-top: 8rpx; font-size: 22rpx; color: #98a19b; }
.cb-sub { display: block; margin-top: 8rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.cb-empty { padding: 60rpx 0; text-align: center; font-size: 26rpx; color: #98a19b; }
.cb-empty { padding: 60rpx 0; text-align: center; font-size: 26rpx; color: var(--ink-3, #98a19b); }
</style>
