const engine = require('../../utils/engine');

Page({
  data: {
    total: 0,
    correct: 0,
    accuracy: 0,
    streak: 0,
    level: 1,
    levelName: '入门',
    counts: { new: 0, learning: 0, familiar: 0, mastered: 0 },
    wordTotal: 0,
    days: []
  },
  onShow() {
    this.setData(engine.stats());
  },
  resetData() {
    wx.showModal({
      title: '重置学习数据',
      content: '将清空全部掌握度、错题本和练习记录，且无法恢复。确定继续吗？',
      confirmText: '确定重置',
      confirmColor: '#e6432d',
      success: (res) => {
        if (res.confirm) {
          engine.resetAll();
          this.setData(engine.stats());
          wx.showToast({ title: '已重置', icon: 'success' });
        }
      }
    });
  }
});
