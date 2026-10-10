<template>
  <view class="card wdg-card">
    <view class="wdg-head">
      <text class="wdg-title">{{ $t('收藏速览') }}</text>
      <text class="wdg-link" @tap="goAll">{{ $t('全部 ›') }}</text>
    </view>

    <block v-if="recent.length">
      <view class="fv-item" v-for="(it, i) in recent" :key="i" :data-w="it.word" @tap="speak">
        <view class="fv-line">
          <text class="fv-word">{{ it.word }}</text>
          <text class="fv-tag">{{ it.tag }}</text>
        </view>
        <text class="fv-mean">{{ it.mean }}</text>
      </view>
      <text class="wdg-foot">共 {{ total }} 条 · 点击朗读</text>
    </block>

    <view v-else class="fv-empty">
      <text class="fv-empty-text">{{ $t('还没有收藏') }}</text>
      <text class="fv-empty-hint">{{ $t('词库页点单词旁的 ☆，练习页点「收藏本题」') }}</text>
    </view>
  </view>
</template>

<script lang="ts">
import { t } from '../../utils/i18n.js';
// 首页小组件：收藏速览（最近 5 条，点读发音）
import * as settings from '../../utils/settings';
import { speakWord } from '../../services/voice.js';

export default {
  name: 'WidgetFavorites',
  data() {
    return { total: 0, recent: [] as Array<{ word: string; mean: string; tag: string }> };
  },
  created() {
    this.refresh();
  },
  methods: {
    refresh() {
      const list: any[] = settings.favorites() || [];
      this.total = list.length;
      this.recent = list
        .slice(-5)
        .reverse()
        .map((it: any) => ({
          word: it.type === 'sentence' ? it.en || it.id : it.word || it.id,
          mean: it.type === 'sentence' ? it.zh || '' : it.meaning || '',
          tag: it.type === 'sentence' ? t('例句') : t('单词')
        }));
    },
    speak(e: any) {
      const w = e.currentTarget.dataset.w
      if (w) speakWord(w)
    },
    goAll() {
      uni.navigateTo({ url: '/pkgStudy/pages/favorites/favorites' })
    }
  }
}
</script>

<style scoped>
.wdg-card { margin-bottom: 20rpx; }

.wdg-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18rpx; }

.wdg-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

.wdg-link { font-size: 22rpx; color: #1d4fd8; }
.wdg-link { font-size: 22rpx; color: var(--brand-strong, #1d4fd8); }

.fv-item { padding: 14rpx 0; border-bottom: 2rpx solid rgba(23, 32, 26, 0.06); }
.fv-item:last-child { border-bottom: none; }

.fv-line { display: flex; align-items: center; }

.fv-word {
  font-size: 27rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.fv-tag {
  margin-left: 12rpx;
  font-size: 18rpx;
  border-radius: 999rpx;
  padding: 2rpx 12rpx;
  background: rgba(124, 58, 237, 0.12);
  color: #7c3aed;
}

.fv-mean {
  display: block;
  margin-top: 4rpx;
  font-size: 23rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.wdg-foot {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.fv-empty { padding: 24rpx 0 8rpx; }

.fv-empty-text {
  display: block;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.fv-empty-hint {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
