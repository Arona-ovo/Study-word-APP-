const engine = require('../../utils/engine');

Page({
  data: {
    level: 1,
    levelName: '入门',
    today: { total: 0, correct: 0 },
    todayPct: 0,
    streak: 0,
    mastered: 0,
    total: 0,
    wrongCount: 0
  },
  onShow() {
    this.setData(engine.overview());
  },
  startPractice() {
    wx.navigateTo({ url: '/pages/practice/practice?source=daily' });
  },
  goTab(e) {
    wx.switchTab({ url: e.currentTarget.dataset.url });
  }
});
