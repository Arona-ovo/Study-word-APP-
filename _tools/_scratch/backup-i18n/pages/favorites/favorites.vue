<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="我的收藏" />

    <view v-if="list.length === 0" class="empty">还没有收藏，去词库页点单词旁的 ☆ 收藏吧</view>

    <view
      v-for="(item, i) in list"
      :key="item.type + '-' + item.id"
      class="card fav-item"
      hover-class="fav-hover"
      hover-start-time="0"
      hover-stay-time="70"
      @tap="openItem(item)"
    >
      <view class="fav-head">
        <text class="fav-tag" :class="item.type">{{ item.type === 'word' ? '单词' : '例句' }}</text>
        <text class="fav-remove" @tap.stop="remove(i)">移除</text>
      </view>
      <view v-if="item.type === 'word'" class="fav-main">
        <text class="fav-word">{{ item.word }}</text>
        <text class="fav-meaning">{{ item.meaning }}</text>
      </view>
      <view v-else class="fav-main">
        <text class="fav-en">{{ item.en }}</text>
        <text class="fav-zh">{{ item.zh }}</text>
        <text class="fav-more">点按查看详情与点读 ›</text>
      </view>
    </view>
  </view>
</template>

<script>
import * as settings from '../../utils/settings'
import * as sync from '../../services/account-sync'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'

export default {
  components: { FloatNavbar },
  data() {
    return { list: [] }
  },
  onShow() {
    this.refresh()
  },
  methods: {
    refresh() {
      this.list = settings.favorites().slice().reverse()
    },
    // 点卡片：例句进详情页（点读 / 整句朗读 / 取消收藏），单词收藏保持原样
    openItem(item) {
      if (!item || item.type !== 'sentence') return
      uni.navigateTo({
        url: '/pages/sentence-detail/sentence-detail?id=' + encodeURIComponent(item.id)
      })
    },
    remove(i) {
      const item = this.list[i]
      settings.removeFavorite(item.type, item.id)
      // 已登录：word_favorite 表同步软删除（未登录时空操作）
      sync.unmirrorFavorite(item.type, item.id)
      this.refresh()
    }
  }
}
</script>

<style>
.empty { text-align: center; color: #98a19b; padding: 120rpx 0; font-size: 28rpx; }
.empty { text-align: center; color: var(--ink-3, #98a19b); padding: 120rpx 0; font-size: 28rpx; }

.fav-item { margin-bottom: 18rpx; }

.fav-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14rpx; }

.fav-tag {
  font-size: 20rpx;
  border-radius: 999rpx;
  padding: 4rpx 16rpx;
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  font-weight: 600;
}

.fav-tag.sentence { background: rgba(124, 58, 237, 0.12); color: #7c3aed; }

.fav-remove { font-size: 24rpx; color: #98a19b; }
.fav-remove { font-size: 24rpx; color: var(--ink-3, #98a19b); }

.fav-main { display: flex; flex-direction: column; }

.fav-word {
  font-size: 34rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.fav-meaning { margin-top: 8rpx; font-size: 26rpx; color: #5a6560; }
.fav-meaning { margin-top: 8rpx; font-size: 26rpx; color: var(--ink-2, #5a6560); }

.fav-en {
  font-size: 28rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
  line-height: 1.6;
}

.fav-zh { margin-top: 8rpx; font-size: 24rpx; color: #5a6560; }
.fav-zh { margin-top: 8rpx; font-size: 24rpx; color: var(--ink-2, #5a6560); }

/* 例句卡的点按反馈与详情引导 */
.fav-hover { opacity: 0.85; transform: scale(0.995); }

.fav-more {
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
