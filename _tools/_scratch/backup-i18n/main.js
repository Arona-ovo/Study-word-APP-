import { createSSRApp } from 'vue'
import App from './App.vue'
import themeMixin from './utils/theme-mixin.js'
import i18nMixin from './utils/i18n-mixin.js'
import * as i18n from './utils/i18n.js'

export function createApp() {
  // 读档：语言要在任何页面渲染前定下来
  try { i18n.init(); } catch (e) {}
  const app = createSSRApp(App)
  // 全局注入外观：页面根节点用 :class="appTheme" :style="appBgStyle" 即可跟随深色模式 / 背景
  app.mixin(themeMixin)
  // 全局注入 $t：模板里 {{ $t('中文原文') }}，切语言后自动重画
  app.mixin(i18nMixin)
  // 全局错误兜底：任何页面生命周期/渲染错误都打到控制台，避免只表现为"内容空白"
  app.config.errorHandler = (err, instance, info) => {
    console.error('[全局错误]', info, err)
  }
  return { app }
}
