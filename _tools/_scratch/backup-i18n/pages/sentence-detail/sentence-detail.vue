<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="例句详情" />

    <!-- 收藏可能已被移除 / 传参缺失 -->
    <view v-if="!en" class="empty">该例句不存在或已取消收藏</view>

    <block v-else>
      <view class="card detail-card">
        <view class="detail-head">
          <text class="detail-tag">例句</text>
          <text class="detail-remove" @tap="unfavorite">取消收藏</text>
        </view>

        <!-- 英文原文：逐词拆分，点词查词义 + 发音 -->
        <view class="detail-en">
          <text
            v-for="(item, index) in tokens"
            :key="index"
            :class="item.w ? 'tok' : 'pun'"
            :data-w="item.t"
            :data-isw="item.w"
            @tap.stop="tapWord"
          >{{ item.t }}</text>
        </view>
        <view class="detail-tip">点击单词可查看词义并听发音</view>

        <!-- 整句翻译 -->
        <view class="detail-zh">{{ zh }}</view>
      </view>

      <!-- 发音 / 收藏操作 -->
      <view class="detail-actions">
        <button class="btn-primary detail-btn" @tap="speakSentence">{{ speaking ? '播放中…' : '朗读整句' }}</button>
        <button class="btn-ghost detail-btn" @tap="unfavorite">取消收藏</button>
      </view>
    </block>

    <!-- 点读单词弹窗（与练习页同一套视觉） -->
    <view class="pop-mask" v-if="pop.show" @tap="closePop">
      <view class="pop-card" @tap.stop="noop">
        <view class="pop-word">{{ pop.word }}</view>
        <view class="pop-ph" v-if="pop.phonetic">/{{ pop.phonetic }}/</view>
        <view class="pop-meaning" v-if="pop.found">{{ pop.pos }} {{ pop.meaning }}</view>
        <view class="pop-meaning none" v-else>未收录（仍可发音）</view>
        <view class="pop-meta" v-if="pop.found">
          <text class="pop-src">{{ pop.srcLabel }}</text>
          <text class="pop-lemma" v-if="pop.inflected">原形 {{ pop.lemma }}</text>
        </view>
        <view class="pop-replay" :data-text="pop.word" @tap="replayWord">再听一次</view>
      </view>
    </view>
  </view>
</template>

<script>
// 例句详情（我的收藏 → 点例句进入）
// 职责：展示收藏例句的原文与整句翻译；逐词点读（词义弹窗 + 发音）；整句朗读；取消收藏
// 数据来源：只传收藏 id，页面自己回 settings 里查原文 —— 避免长句走 URL 传参的编码坑
import * as settings from '../../utils/settings'
import * as dict from '../../utils/dict'
import * as tts from '../../services/voice'
import { tokenize } from '../../utils/tokenize'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'

const EMPTY_POP = { show: false, word: '', pos: '', meaning: '', phonetic: '', srcLabel: '', found: false, lemma: '', inflected: '' }

export default {
  components: { FloatNavbar },
  data() {
    return {
      id: '',
      en: '',
      zh: '',
      tokens: [],
      speaking: false,
      pop: Object.assign({}, EMPTY_POP)
    }
  },

  onLoad(opt) {
    const id = (opt && opt.id) || ''
    this.id = id
    const fav = settings.favorites().find(f => f.type === 'sentence' && f.id === id)
    if (fav) {
      this.en = fav.en || ''
      this.zh = fav.zh || ''
    }
    this.tokens = tokenize(this.en)
  },

  onHide() { this.stopAll() },
  onUnload() { this.stopAll() },

  methods: {
    stopAll() {
      this.speaking = false
      tts.stop()
    },

    // 点读单词：查词（核心词书 → 导入词 → 常用词典 → 词形还原）+ 弹窗 + 发音
    // 弹窗大字展示「点到的词形」（保留大小写，如 I / English），
    // 词义/音标/词性来自同一次 lookup —— 分词结果与释义一一对应；
    // 只有当点到的词是变形（如 signed → sign）时才显示「原形」行
    tapWord(e) {
      const d = e.currentTarget.dataset
      if (!d.isw) return
      const raw = d.w || ''
      if (!raw.trim()) return
      const entry = dict.lookup(raw)
      this.pop = {
        show: true,
        word: raw,
        pos: entry.pos || '',
        meaning: entry.meaning || '',
        phonetic: entry.phonetic || '',
        srcLabel: dict.SRC_LABEL[entry.src] || '',
        found: !!entry.found,
        lemma: entry.lemma || '',
        inflected: entry.inflected || ''
      }
      // 未收录的单词仍走有道单词级发音
      tts.speakWord(dict.speakForm(raw))
    },

    closePop() {
      this.pop = Object.assign({}, EMPTY_POP)
    },

    noop() {},

    // 弹窗里的"再听一次"：用户主动触发，force 语义由 tts 层保证不被节流吞掉
    replayWord(e) {
      const text = e.currentTarget.dataset.text
      if (!text) return
      tts.speakWord(text)
    },

    // 整句朗读：先发起播放再置位（speakSentence 内部 stop 会触发上一次 onDone）
    speakSentence() {
      if (!this.en) return
      tts.speakSentence(this.en, {
        onDone: () => { this.speaking = false }
      })
      this.speaking = true
    },

    // 取消收藏：软提示后返回列表（列表 onShow 会自动刷新）
    unfavorite() {
      if (!this.id) return
      settings.removeFavorite('sentence', this.id)
      this.stopAll()
      uni.showToast({ title: '已取消收藏', icon: 'none' })
      setTimeout(() => {
        uni.navigateBack()
      }, 300)
    }
  }
}
</script>

<style>
.empty { text-align: center; color: #98a19b; color: var(--ink-3, #98a19b); padding: 120rpx 0; font-size: 28rpx; }

.detail-card { margin-bottom: 24rpx; }

.detail-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18rpx; }

.detail-tag {
  font-size: 20rpx;
  border-radius: 999rpx;
  padding: 4rpx 16rpx;
  background: rgba(124, 58, 237, 0.12);
  color: #7c3aed;
  font-weight: 600;
}

.detail-remove { font-size: 24rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

/* 英文原文：Georgia 衬线，逐词可点（虚线下划线提示可点读） */
.detail-en {
  font-size: 32rpx;
  line-height: 1.7;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
  font-weight: 500;
}

.pun { color: #17201a; color: var(--ink-1, #17201a); }

.tok { border-bottom: 2rpx dashed #bfd4ff; }

.tok:active { color: #1d4fd8; background: rgba(46, 107, 255, 0.12); border-radius: 6rpx; }
.tok:active { color: var(--brand-strong, #1d4fd8); background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); border-radius: 6rpx; }

.detail-tip {
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.detail-zh {
  margin-top: 20rpx;
  padding-top: 20rpx;
  border-top: 2rpx solid #eff2f5;
  font-size: 28rpx;
  line-height: 1.7;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.detail-actions { display: flex; flex-direction: column; }

.detail-btn { width: 100%; }

.detail-btn + .detail-btn { margin-top: 20rpx; }

/* ---------- 点读弹窗：.pop-mask / .pop-card 统一见 App.vue 全局样式 ---------- */

.pop-word {
  font-size: 48rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.pop-meaning { margin-top: 18rpx; font-size: 30rpx; color: #5a6560; }
.pop-meaning { margin-top: 18rpx; font-size: 30rpx; color: var(--ink-2, #5a6560); }

.pop-meaning.none { color: #98a19b; }
.pop-meaning.none { color: var(--ink-3, #98a19b); }

.pop-ph { margin-top: 8rpx; font-size: 26rpx; color: #98a19b; }
.pop-ph { margin-top: 8rpx; font-size: 26rpx; color: var(--ink-3, #98a19b); }

.pop-meta { margin-top: 12rpx; display: flex; justify-content: center; }

.pop-src {
  font-size: 22rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  border-radius: 999rpx;
  padding: 4rpx 16rpx;
}

.pop-lemma { margin-left: 12rpx; font-size: 22rpx; color: #98a19b; }
.pop-lemma { margin-left: 12rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.pop-replay {
  display: inline-block;
  margin-top: 36rpx;
  font-size: 28rpx;
  font-weight: 600;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  border: 2rpx solid #2e6bff;
  border: 2rpx solid var(--brand, #2e6bff);
  border-radius: 999rpx;
  padding: 12rpx 48rpx;
}
</style>
