<template>
  <view
    class="container page-tabbar page-nav"
    :class="appTheme"
    :style="appBgStyle"
    @touchstart="onSlideStart"
    @touchmove="onSlideMove"
    @touchend="onSlideEnd"
    @touchcancel="onSlideEnd"
  >
    <float-navbar :title="$t('错题回顾')" />

    <!-- 内容区：切 tab 时整体左右滑动 -->
    <view class="page-slide" :class="slideCls" :style="slideStyle">
    <view class="card head-card" v-if="list.length > 0">
      <view class="head-text">共 {{ list.length }} 道错题，重练答对后自动移出</view>
      <button class="btn-primary head-btn" @tap="startReview">{{ $t('开始错题重练') }}</button>
    </view>

    <view v-if="list.length === 0" class="empty">
      <view class="empty-title">{{ $t('暂无错题') }}</view>
      <view class="empty-sub">{{ $t('答错的题目会自动收录到这里') }}</view>
    </view>

    <view v-for="item in list" :key="item.sid + item.dir" class="card wrong-item" @tap="openDetail(item)">
      <view class="wrong-meta">
        <text class="tag dir-tag">{{ item.dir === 'e2c' ? $t('英译汉') : $t('汉译英') }}</text>
        <text class="wrong-time">{{ item.timeStr }}</text>
      </view>
      <view class="wrong-prompt">{{ item.prompt }}</view>
      <view class="wrong-answer-row" v-if="item.userAnswer">
        <text class="wrong-label">{{ $t('你的答案') }}</text>
        <text class="wrong-user">{{ item.userAnswer }}</text>
      </view>
      <view class="wrong-answer-row">
        <text class="wrong-label">{{ $t('参考答案') }}</text>
        <text class="wrong-ref">{{ item.answer }}</text>
      </view>
    </view>
    </view>

    <!-- 悬浮磨砂玻璃标签栏（原生 tabBar 已隐藏） -->
    <float-tabbar ref="tabbar" current="review" />
  </view>
</template>

<script>
import * as engine from '../../utils/engine'
import { hideNativeTabBar, syncTabbar } from '../../utils/nav.js'
import tabSlideMixin from '../../utils/tab-slide-mixin.js'
import FloatTabbar from '../../components/float-tabbar/float-tabbar.vue'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'

export default {
  components: { FloatTabbar, FloatNavbar },
  mixins: [tabSlideMixin('review')],
  data() {
    return { list: [] }
  },
  onShow() {
    hideNativeTabBar()
    syncTabbar(this)
    this.list = engine.wrongList()
  },
  methods: {
    startReview() {
      uni.navigateTo({ url: '/pkgStudy/pages/practice/practice?source=review' })
    },
    // 点错题进详情：只传 sid + dir，原文由详情页自己回 engine 查（长句不走 URL 传参）
    openDetail(item) {
      uni.navigateTo({
        url: '/pkgStudy/pages/wrong-detail/wrong-detail?sid=' + encodeURIComponent(item.sid) + '&dir=' + item.dir
      })
    }
  }
}
</script>

<style>
.head-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24rpx;
}

.head-text {
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  flex: 1;
  margin-right: 20rpx;
  line-height: 1.5;
}

.head-btn {
  flex-shrink: 0;
  font-size: 26rpx;
  padding: 0 36rpx;
  height: 76rpx;
}

.empty { padding: 200rpx 0; text-align: center; }

.empty-title { font-size: 36rpx; font-weight: 700; color: #5a6560; }
.empty-title { font-size: 36rpx; font-weight: 700; color: var(--ink-2, #5a6560); }

.empty-sub { font-size: 26rpx; color: #98a19b; margin-top: 14rpx; }
.empty-sub { font-size: 26rpx; color: var(--ink-3, #98a19b); margin-top: 14rpx; }

.wrong-item { margin-bottom: 20rpx; }

.wrong-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16rpx;
}

.dir-tag { background: rgba(46, 107, 255, 0.12); color: #1d4fd8; font-weight: 600; }
.dir-tag { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); color: var(--brand-strong, #1d4fd8); font-weight: 600; }

.wrong-time { font-size: 22rpx; color: #98a19b; }
.wrong-time { font-size: 22rpx; color: var(--ink-3, #98a19b); }

.wrong-prompt {
  font-size: 32rpx;
  font-weight: 600;
  line-height: 1.6;
  margin-bottom: 16rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.wrong-answer-row { display: flex; flex-direction: column; margin-bottom: 12rpx; }

.wrong-label { font-size: 22rpx; color: #98a19b; margin-bottom: 4rpx; }
.wrong-label { font-size: 22rpx; color: var(--ink-3, #98a19b); margin-bottom: 4rpx; }

.wrong-user { font-size: 28rpx; color: #e5484d; line-height: 1.55; }

.wrong-ref { font-size: 28rpx; color: #1d4fd8; font-weight: 600; line-height: 1.55; }
.wrong-ref { font-size: 28rpx; color: var(--brand-strong, #1d4fd8); font-weight: 600; line-height: 1.55; }
</style>
