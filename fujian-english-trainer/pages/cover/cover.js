Page({
  onLoad() {
    // 2.4 秒后自动进入首页，与底部进度条动画同步
    this.timer = setTimeout(() => this.enter(), 2400);
  },
  enter() {
    if (this.entered) return;
    this.entered = true;
    clearTimeout(this.timer);
    wx.switchTab({ url: '/pages/home/home' });
  },
  onUnload() {
    clearTimeout(this.timer);
  }
});
