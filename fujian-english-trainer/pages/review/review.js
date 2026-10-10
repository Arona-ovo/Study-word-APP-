const engine = require('../../utils/engine');

Page({
  data: {
    list: []
  },
  onShow() {
    this.setData({ list: engine.wrongList() });
  },
  startReview() {
    wx.navigateTo({ url: '/pages/practice/practice?source=review' });
  }
});
