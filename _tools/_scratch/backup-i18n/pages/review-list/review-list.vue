<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="待复习" />

    <view v-if="list.length === 0" class="empty">
      <text class="empty-text">暂时没有待复习的内容</text>
      <text class="empty-hint">练习中答错的题会自动进到这里</text>
      <button class="btn-primary empty-btn" @tap="goHome">回首页</button>
    </view>

    <block v-else>
      <view class="card sum-card">
        <text class="sum-text">共 <text class="sum-strong">{{ list.length }}</text> 道待复习 · 答对后自动移出</text>
      </view>

      <view
        v-for="(item, i) in list"
        :key="i"
        class="card wrong-card"
        :data-text="item.speakText"
        @tap="speak"
      >
        <view class="wr-head">
          <text class="wr-tag" :class="item.dir">{{ item.dirText }}</text>
          <text class="wr-time">{{ item.timeStr }}</text>
        </view>
        <text class="wr-line en">{{ item.prompt }}</text>
        <text class="wr-line ref">{{ item.answer }}</text>
        <text class="wr-line mine" v-if="item.userAnswer">你的答案：{{ item.userAnswer }}</text>
      </view>

      <button class="btn-primary start-btn" @tap="goPractice">开始复习</button>
    </block>
  </view>
</template>

<script>
// 待复习列表（首页「待复习」进入）
// 数据：engine.wrongList()（含原文，错题重练答对后自动移出）
import * as engine from '../../utils/engine'
import { speakSentence } from '../../services/voice.js'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'

export default {
  components: { FloatNavbar },
  data() {
    return { list: [] }
  },
  onShow() {
    this.refresh();
  },
  methods: {
    refresh() {
      const raw = engine.wrongList() || []
      this.list = raw.map(it => {
        const isEn = engine.isEnglish ? engine.isEnglish(it.prompt) : /^[\x00-\x7F\s]+$/.test(it.prompt)
        return Object.assign({}, it, {
          dirText: it.dir === 'e2c' ? '英译中' : '中译英',
          speakText: isEn ? it.prompt : it.answer
        })
      })
    },
    speak(e) {
      const t = e.currentTarget.dataset.text
      if (t) speakSentence(t)
    },
    goPractice() {
      uni.navigateTo({ url: '/pages/practice/practice?source=review' })
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

.sum-card { padding: 24rpx 30rpx; margin-bottom: 20rpx; }

.sum-text { font-size: 25rpx; color: #5a6560; }
.sum-text { font-size: 25rpx; color: var(--ink-2, #5a6560); }

.sum-strong { color: #2e6bff; font-weight: 600; }
.sum-strong { color: var(--brand, #2e6bff); font-weight: 600; }

.wrong-card { margin-bottom: 18rpx; }

.wr-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12rpx; }

.wr-tag {
  font-size: 19rpx;
  border-radius: 999rpx;
  padding: 3rpx 14rpx;
  background: rgba(46, 107, 255, 0.12);
  color: #1d4fd8;
  font-weight: 600;
}

.wr-tag.c2e { background: rgba(124, 58, 237, 0.12); color: #7c3aed; }

.wr-time { font-size: 21rpx; color: #98a19b; }
.wr-time { font-size: 21rpx; color: var(--ink-3, #98a19b); }

.wr-line { display: block; line-height: 1.6; }

.wr-line.en {
  font-size: 27rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.wr-line.ref { margin-top: 8rpx; font-size: 24rpx; color: #5a6560; }
.wr-line.ref { margin-top: 8rpx; font-size: 24rpx; color: var(--ink-2, #5a6560); }

.wr-line.mine { margin-top: 8rpx; font-size: 22rpx; color: #98a19b; }
.wr-line.mine { margin-top: 8rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.start-btn { margin-top: 24rpx; height: 88rpx; font-size: 30rpx; }
</style>
