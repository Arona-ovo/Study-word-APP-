const engine = require('../../utils/engine');

Page({
  data: {
    filter: 'all',
    filters: [
      { key: 'all', name: '全部' },
      { key: 'new', name: '新词' },
      { key: 'learning', name: '学习中' },
      { key: 'familiar', name: '熟悉' },
      { key: 'mastered', name: '已掌握' }
    ],
    counts: { new: 0, learning: 0, familiar: 0, mastered: 0 },
    list: []
  },
  onShow() {
    this.refresh();
  },
  setFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.k }, () => this.refresh());
  },
  refresh() {
    const v = engine.vocabList(this.data.filter);
    this.setData({ list: v.list, counts: v.counts });
  }
});
