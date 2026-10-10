// app.js - 应用入口：初始化本地学习数据存储
const store = require('./utils/store');

App({
  onLaunch() {
    store.init();
  },
  globalData: {
    dailyGoal: 10 // 每日练习默认题量
  }
});
