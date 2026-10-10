<template>
  <view class="cover" :class="appTheme" :style="appBgStyle" @tap="enter">
    <view class="deco deco-1"></view>
    <view class="deco deco-2"></view>
    <view class="deco deco-3"></view>

    <view class="stage">
      <view class="ring"></view>
      <view class="mascot-wrap">
        <image class="mascot" src="/static/mascot.jpg" mode="aspectFill" />
      </view>
    </view>

    <view class="brand">
      <view class="app-name anim" style="animation-delay:.25s">ENGLISH TRAINER</view>
      <view class="divider anim" style="animation-delay:.55s"></view>
      <view class="app-en anim" style="animation-delay:.75s">FUJIAN · TRANSLATION PRACTICE</view>
    </view>

    <view class="footer anim" style="animation-delay:1s">
      <view class="load-track"><view class="load-fill"></view></view>
      <view class="hint">TAP TO START</view>
    </view>
  </view>
</template>

<script>
export default {
  onLoad() {
    // 2.4 秒后自动进入首页，与底部进度条动画同步
    this.timer = setTimeout(() => this.enter(), 2400)
  },
  onUnload() {
    clearTimeout(this.timer)
  },
  methods: {
    enter() {
      if (this.entered) return
      this.entered = true
      clearTimeout(this.timer)
      uni.switchTab({ url: '/pages/home/home' })
    }
  }
}
</script>

<style>
/* 浅蓝封面：底色贴近全局背景的浅蓝调，避免启动时出现深色大色块 */
.cover {
  position: relative;
  min-height: 100vh;
  background: linear-gradient(165deg, #f2f7ff 0%, #e0ecff 52%, #cfe0ff 100%);
  background: linear-gradient(165deg, rgba(var(--brand-rgb, 46, 107, 255), 0.06) 0%, rgba(var(--brand-rgb, 46, 107, 255), 0.13) 52%, rgba(var(--brand-rgb, 46, 107, 255), 0.22) 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  padding: 180rpx 48rpx 100rpx;
  overflow: hidden;
}

/* 深色模式下的封面：避免夜里启动时闪一下亮屏 */
.app-dark.cover {
  background: linear-gradient(165deg, rgba(var(--brand-rgb, 46, 107, 255), 0.14) 0%, rgba(8, 10, 9, 0.6) 52%, #121513 100%);
}

.deco { position: absolute; border-radius: 50%; }
.deco-1 {
  width: 420rpx; height: 420rpx; right: -160rpx; top: -140rpx;
  background: radial-gradient(circle, rgba(46, 107, 255, 0.18), rgba(46, 107, 255, 0));
  background: radial-gradient(circle, rgba(var(--brand-rgb, 46, 107, 255), 0.18), rgba(var(--brand-rgb, 46, 107, 255), 0));
}
.deco-2 {
  width: 300rpx; height: 300rpx; left: -120rpx; top: 46%;
  background: radial-gradient(circle, rgba(46, 107, 255, 0.12), rgba(46, 107, 255, 0));
  background: radial-gradient(circle, rgba(var(--brand-rgb, 46, 107, 255), 0.12), rgba(var(--brand-rgb, 46, 107, 255), 0));
}
.deco-3 {
  width: 200rpx; height: 200rpx; right: 8%; bottom: 14%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0));
  background: radial-gradient(circle, rgba(var(--surface-rgb, 255, 255, 255), 0.75), rgba(var(--surface-rgb, 255, 255, 255), 0));
}

.stage {
  position: relative;
  width: 340rpx; height: 340rpx;
  display: flex; align-items: center; justify-content: center;
}

.ring {
  position: absolute;
  width: 340rpx; height: 340rpx;
  border-radius: 50%;
  border: 3rpx solid rgba(46, 107, 255, 0.4);
  border: 3rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.4);
  animation: ringPulse 2.4s ease-out infinite;
}

.mascot-wrap {
  width: 320rpx; height: 320rpx;
  border-radius: 50%;
  background: #ffffff;
  background: var(--solid, #ffffff);
  border: 8rpx solid rgba(255, 255, 255, 0.95);
  border: 8rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.95));
  box-shadow: 0 16rpx 56rpx rgba(46, 107, 255, 0.22);
  box-shadow: 0 16rpx 56rpx rgba(var(--brand-rgb, 46, 107, 255), 0.22);
  overflow: hidden;
  animation: float 3.2s ease-in-out infinite;
}

.mascot { width: 100%; height: 100%; }

.brand {
  display: flex; flex-direction: column; align-items: center;
  margin-top: 72rpx;
}

.app-name {
  font-size: 46rpx;
  font-weight: 500;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  letter-spacing: 10rpx;
  text-indent: 10rpx;
  font-family: Georgia, "Times New Roman", serif;
}

.app-en {
  margin-top: 32rpx;
  font-size: 20rpx;
  letter-spacing: 5rpx;
  text-indent: 5rpx;
  color: rgba(29, 79, 216, 0.62);
  font-family: Georgia, "Times New Roman", serif;
}

.divider {
  width: 64rpx; height: 2rpx;
  background: rgba(46, 107, 255, 0.38);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.38);
  margin-top: 36rpx;
}

.footer {
  position: absolute; left: 0; right: 0; bottom: 100rpx;
  display: flex; flex-direction: column; align-items: center;
}

.load-track {
  width: 240rpx; height: 4rpx;
  border-radius: 999rpx;
  background: rgba(46, 107, 255, 0.18);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.18);
  overflow: hidden;
}

.load-fill {
  height: 100%; width: 0;
  border-radius: 999rpx;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  animation: load 2.4s linear forwards;
}

.hint {
  margin-top: 24rpx;
  font-size: 20rpx;
  letter-spacing: 4rpx;
  text-indent: 4rpx;
  color: rgba(29, 79, 216, 0.6);
}

.anim { opacity: 0; animation: fadeUp 0.7s ease forwards; }

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(36rpx); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-14rpx); }
}
@keyframes ringPulse {
  0% { transform: scale(1); opacity: 0.6; }
  100% { transform: scale(1.45); opacity: 0; }
}
@keyframes load {
  from { width: 0; }
  to { width: 100%; }
}
</style>
