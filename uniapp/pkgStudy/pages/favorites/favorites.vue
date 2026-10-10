<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('我的收藏')" />

    <!-- 单词和句子是两套东西，各有各的详情页：
         收藏的句子（陪练里收的、词库例句点的 ☆）都归在「例句」这一档，
         点进去能逐词点读、朗读整句，还能把整句存进词书。 -->
    <view class="seg">
      <text
        v-for="s in segs"
        :key="s.key"
        class="seg-item"
        :class="{ active: tab === s.key }"
        :data-k="s.key"
        @tap="setTab"
      >{{ $t(s.name) }} {{ counts[s.key] }}</text>
    </view>

    <view v-if="list.length === 0" class="empty">{{ emptyText }}</view>

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
        <text class="fav-tag" :class="item.type">{{ item.type === 'word' ? $t('单词') : $t('例句') }}</text>
        <text class="fav-remove" @tap.stop="remove(i)">{{ $t('移除') }}</text>
      </view>
      <view v-if="item.type === 'word'" class="fav-main">
        <text class="fav-word">{{ item.word }}</text>
        <text class="fav-meaning">{{ item.meaning }}</text>
      </view>
      <view v-else class="fav-main">
        <text class="fav-en">{{ item.en }}</text>
        <text class="fav-zh">{{ item.zh }}</text>
        <text class="fav-more">{{ $t('点按查看详情与点读 ›') }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import * as settings from '../../../utils/settings'
import * as sync from '../../../services/account-sync'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

export default {
  components: { FloatNavbar },
  data() {
    return {
      tab: 'all',
      segs: [
        { key: 'all', name: '全部' },
        { key: 'word', name: '单词' },
        { key: 'sentence', name: '例句' }
      ],
      counts: { all: 0, word: 0, sentence: 0 },
      list: []
    }
  },
  computed: {
    emptyText() {
      if (this.tab === 'sentence') return this.$t('还没有收藏的句子，去「AI 对话陪练」里长按气泡就能收一句')
      if (this.tab === 'word') return this.$t('还没有收藏的单词，去词库页点单词旁的 ☆ 收藏吧')
      return this.$t('还没有收藏，去词库页点单词旁的 ☆ 收藏吧')
    }
  },
  onLoad(opt) {
    // 首页卡与陪练页的「我的句子」直接落到例句这一档
    if (opt && opt.tab === 'sentence') this.tab = 'sentence'
  },
  onShow() {
    this.refresh()
  },
  methods: {
    setTab(e) {
      const k = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.k
      if (!k) return
      this.tab = k
      this.refresh()
    },
    refresh() {
      const all = settings.favorites().slice().reverse()
      const n = { all: all.length, word: 0, sentence: 0 }
      all.forEach(f => { if (n[f.type] != null) n[f.type]++ })
      this.counts = n
      this.list = this.tab === 'all' ? all : all.filter(f => f.type === this.tab)
    },
    // 点卡片：例句进详情页（点读 / 整句朗读 / 取消收藏），单词收藏保持原样
    openItem(item) {
      if (!item || item.type !== 'sentence') return
      uni.navigateTo({
        url: '/pkgStudy/pages/sentence-detail/sentence-detail?id=' + encodeURIComponent(item.id)
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

/* 分段：与词库页 / 词书详情的胶囊同一套观感 */
.seg {
  display: flex;
  margin-bottom: 20rpx;
  padding: 6rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
}

.seg-item {
  flex: 1;
  text-align: center;
  font-size: 26rpx;
  padding: 12rpx 0;
  border-radius: 999rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.seg-item.active {
  color: #ffffff;
  font-weight: 600;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
}

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
