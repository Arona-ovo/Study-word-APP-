// utils/i18n.js - 极简国际化
//
// 设计取舍：**key 就是中文原文**。
//   · 中文态直接把 key 显示出来，所以不需要再维护一份中文表 —— 省掉一半体积，
//     也永远不会出现"中文表和模板对不上"的问题
//   · 英文表（i18n-en.js）里查不到就回退显示中文 —— 可以增量翻译，
//     没翻到的地方不会变成空白或 undefined
//   · 已有代码里模板的中文原文保持不变（只是外面套了 $t()），
//     所以校验脚本里那些"断言中文文案"的用例一条都不用改
//
// 用法：
//   模板   {{ $t('加入词书') }}        :placeholder="$t('搜索')"
//   脚本   t('已加入「{name}」', { name })
//   切换   setLocale('en')            （内部会落盘 + 广播 i18n:change）

import * as settings from './settings.js';
import EN from './i18n-en.js';

export const LOCALES = [
  { key: 'zh', name: '简体中文' },
  { key: 'en', name: 'English' }
];

// 当前语言（模块级单例）：页面数量多，没必要每个实例各存一份
let locale = 'zh';

// 查找用的归一化：模板里换行缩进过的长文案，与字典里写成一行的 key 要能对上
function normKey(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function normalize(v) {
  const k = String(v || '').toLowerCase();
  return LOCALES.some(l => l.key === k) ? k : 'zh';
}

export function init() {
  try {
    locale = normalize(settings.get().locale);
  } catch (e) {
    locale = 'zh';
  }
  return locale;
}

export function current() {
  return locale;
}

export function isEn() {
  return locale === 'en';
}

// 主入口。vars 支持 {name} 占位符
export function t(zh, vars) {
  const raw = String(zh == null ? '' : zh);
  if (locale !== 'en') return fill(raw, vars);
  const en = EN[normKey(raw)];
  // 没翻到的回退中文，保证界面永远有字
  return fill(en || raw, vars);
}

function fill(s, vars) {
  if (!vars) return s;
  return String(s).replace(/\{(\w+)\}/g, (m, k) =>
    vars[k] === undefined || vars[k] === null ? m : String(vars[k]));
}

export function setLocale(key) {
  const next = normalize(key);
  if (next === locale) return locale;
  locale = next;
  try { settings.set({ locale: next }); } catch (e) { /* 存不下也要能切 */ }
  syncNativeTabBar();
  try {
    if (typeof uni !== 'undefined' && typeof uni.$emit === 'function') uni.$emit('i18n:change', next);
  } catch (e) {}
  return locale;
}

// 原生 tabBar（小程序端 / 没被隐藏时）的文案要单独推一次 —— 它不走 Vue 渲染
function syncNativeTabBar() {
  try {
    if (typeof uni === 'undefined' || typeof uni.setTabBarItem !== 'function') return;
    const texts = locale === 'en'
      ? ['Home', 'Library', 'Wrong', 'Me']
      : ['首页', '词库', '错题', '我的'];
    texts.forEach((text, i) => uni.setTabBarItem({ index: i, text }));
  } catch (e) { /* 原生 tabBar 不存在时忽略 */ }
}

// 星期简称：中日韩单字与英文三字母长度差太多，用表而不是 t() 逐字翻译
const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function weekdays() {
  return locale === 'en' ? WEEK_EN : WEEK_ZH;
}

export function weekday(date) {
  return weekdays()[(date instanceof Date ? date : new Date()).getDay()];
}

// 日期：中文 10月8日 · 周三，英文 Oct 8 · Wed
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dateLabel(date) {
  const d = date instanceof Date ? date : new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (locale === 'en') return MONTH_EN[m - 1] + ' ' + day + ' · ' + weekday(d);
  return m + '月' + day + '日 · ' + weekday(d);
}

// 覆盖率：已翻 / 总 key，用于设置页显示进度（也便于回归脚本断言"没有漏翻"）
export function coverage() {
  const total = Object.keys(EN).length;
  let missing = 0;
  Object.keys(EN).forEach(k => { if (!EN[k]) missing++; });
  return { total, missing };
}
