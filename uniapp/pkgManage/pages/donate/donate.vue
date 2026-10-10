<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('支持 AWword')" />

    <!-- 开场卡片 -->
    <view class="card hero-card">
      <view class="hero-title">{{ $t('请作者喝一杯 ☕') }}</view>
      <view class="hero-sub">
        {{ $t('AWword 一直免费、无广告、离线可用。如果它帮到了你， 扫码请作者喝杯咖啡就是最大的鼓励（金额随意，心意到了就行）。') }}
      </view>
    </view>

    <!-- 支付宝 -->
    <view class="card qr-card">
      <view class="qr-head">
        <text class="qr-name ali">{{ $t('支付宝') }}</text>
        <text class="qr-act" @tap="saveQr('alipay')">{{ $t('保存到相册') }}</text>
      </view>
      <image
        class="qr-img"
        src="/static/donate/alipay-qr.png"
        mode="widthFix"
        @tap="preview('alipay')"
      />
      <text class="qr-tip">{{ $t('点击二维码可放大 · 用支付宝「扫一扫」') }}</text>
    </view>

    <!-- 微信 -->
    <view class="card qr-card">
      <view class="qr-head">
        <text class="qr-name wx">{{ $t('微信支付') }}</text>
        <text class="qr-act" @tap="saveQr('wechat')">{{ $t('保存到相册') }}</text>
      </view>
      <image
        class="qr-img"
        src="/static/donate/wechat-qr.png"
        mode="widthFix"
        @tap="preview('wechat')"
      />
      <text class="qr-tip">{{ $t('点击二维码可放大 · 微信「扫一扫」') }}</text>
    </view>

    <view class="card tip-card">
      <text class="tip-text">{{ $t('打赏完全自愿，不影响任何功能。遇到问题或想提建议，随时找作者聊。') }}</text>
    </view>
  </view>
</template>

<script>
import { t } from '../../../utils/i18n.js';
// 支持作者（打赏）：设置 → 关于 → 「支持 AWword」
// 二维码是纯静态资源（static/donate），不进构建管线，替换图片即可换收款码
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

const QRS = {
  alipay: '/static/donate/alipay-qr.png',
  wechat: '/static/donate/wechat-qr.png'
}

export default {
  components: { FloatNavbar },
  methods: {
    // 放大预览（两端都自带「长按保存 / 识别二维码」）
    preview(key) {
      const urls = [QRS.alipay, QRS.wechat]
      uni.previewImage({ urls, current: QRS[key] })
    },

    // 存到系统相册：H5 不支持该 API，走失败兜底提示长按保存
    saveQr(key) {
      const filePath = QRS[key]
      const ok = () => uni.showToast({ title: t('已保存到相册'), icon: 'none' })
      const bad = () => uni.showToast({ title: t('没保存成功，可以长按图片保存'), icon: 'none' })
      try {
        uni.saveImageToPhotosAlbum({ filePath, success: ok, fail: bad })
      } catch (e) {
        bad()
      }
    }
  }
}
</script>

<style>
.hero-card { padding: 40rpx 34rpx 34rpx; margin-bottom: 24rpx; }

.hero-title {
  font-size: 36rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

.hero-sub {
  margin-top: 14rpx;
  font-size: 25rpx;
  line-height: 1.7;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

/* ---------- 二维码卡 ---------- */
.qr-card { padding: 30rpx; margin-bottom: 24rpx; }

.qr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.qr-name {
  font-size: 28rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.qr-name.ali { color: #1677ff; }

.qr-name.wx { color: #07c160; }

.qr-act {
  font-size: 23rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
}

.qr-img {
  display: block;
  width: 480rpx;
  margin: 0 auto;
  border-radius: 20rpx;
}

.qr-tip {
  display: block;
  margin-top: 18rpx;
  text-align: center;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* ---------- 底部说明 ---------- */
.tip-card { padding: 26rpx 30rpx; }

.tip-text {
  font-size: 23rpx;
  line-height: 1.7;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
</style>
