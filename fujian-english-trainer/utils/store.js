// utils/store.js - 本地存储封装（学习进度全部保存在本地，无需后端）
// 数据结构：{ mastery: {wordId: {m, seen, correct}}, wrong: [...], days: {'YYYY-MM-DD': {total, correct}} }
const KEY = 'fj_eng_state_v1';

let cache = null;

function blank() {
  return { mastery: {}, wrong: [], days: {} };
}

function load() {
  try {
    const v = wx.getStorageSync(KEY);
    if (v && v.mastery && v.days && v.wrong) return v;
  } catch (e) {
    console.error('读取学习数据失败', e);
  }
  return blank();
}

function init() {
  cache = load();
}

function get() {
  if (!cache) cache = load();
  return cache;
}

function save(state) {
  cache = state;
  try {
    wx.setStorageSync(KEY, state);
  } catch (e) {
    console.error('保存学习数据失败', e);
  }
}

function reset() {
  cache = blank();
  try {
    wx.removeStorageSync(KEY);
  } catch (e) {}
}

module.exports = { init, get, save, reset };
