// utils/i18n-mixin.js - 全局注入 $t（main.js 里 app.mixin）
//
// 关键：模板里 {{ $t('加入词书') }} 只是个方法调用，本身不产生响应式依赖 ——
// 切语言后界面不会自己重画。所以 $t 里读一下 this.__lang（一个响应式 data），
// 让每次渲染都把"当前语言"登记为依赖；语言一变，__lang 变了，视图就重算。

import * as i18n from './i18n.js';

function off(vm) {
  if (!vm.__i18nOn) return;
  try {
    if (typeof uni !== 'undefined' && typeof uni.$off === 'function') {
      uni.$off('i18n:change', vm.__i18nOn);
    }
  } catch (e) {}
  vm.__i18nOn = null;
}

export default {
  data() {
    return { __lang: i18n.current() };
  },
  created() {
    this.__i18nOn = () => { this.__lang = i18n.current(); };
    try {
      if (typeof uni !== 'undefined' && typeof uni.$on === 'function') {
        uni.$on('i18n:change', this.__i18nOn);
      }
    } catch (e) {}
  },
  // 组件走 beforeUnmount；页面（tab 页常驻）走 onUnload，两条都挂上才不会漏
  beforeUnmount() { off(this); },
  onUnload() { off(this); },
  methods: {
    $t(zh, vars) {
      void this.__lang;           // 建立渲染依赖：语言一变就重画
      return i18n.t(zh, vars);
    }
  }
};
