// utils/nav.js - 底部导航相关的小工具
//
// 本项目底部导航改为「悬浮磨砂玻璃」自绘组件（components/float-tabbar）。
// 各端的原生 tabBar 处理方式不同：
//   H5  ：由 App.vue 全局样式 uni-tabbar { display: none } 隐藏（零闪烁）
//   App ：原生 tabBar 无法用 CSS 隐藏，必须调 uni.hideTabBar()
// 因此每个 tab 页 onShow 都调用一次 hideNativeTabBar()，
// 避免 App 端 switchTab 后原生 tabBar 重新出现。

// App 端痛点：原生 tabBar 隐藏后，承载页面的 webview 有时**高度不重排**，
// 仍然按"底部被 tabBar 占掉一块"的旧高度布局。自绘 tabBar 是这台 webview 里的
// fixed bottom:0 元素，于是就跟着沉到真实屏幕之外 —— 表现就是"底部导航不见了"。
// uni.hideTabBar() 本身没失败（重复调用也只是走 fail），缺的是让 webview 重新量高度，
// 所以这里显式把当前 webview 按回全屏来触发一次重排。
// plus 是否可用。必须在动任何原生 API 之前判一下：
// App.vue 的 onLaunch 里就会走到本模块，那一刻 plus 常常还在初始化，
// 对着半成品对象调 setStyle 会让整个 App 起不来（createInstanceContext failed → 白屏）。
function plusReady() {
  try {
    // eslint-disable-next-line no-undef
    if (typeof plus === 'undefined') return false
    // eslint-disable-next-line no-undef
    if (typeof plus.isReady === 'boolean') return plus.isReady
    // eslint-disable-next-line no-undef
    return !!(plus.webview && plus.webview.currentWebview)
  } catch (e) {
    return false
  }
}

function reflowAppWebview() {
  try {
    if (!plusReady()) return
    // eslint-disable-next-line no-undef
    const wv = plus.webview.currentWebview()
    if (!wv || typeof wv.setStyle !== 'function') return
    wv.setStyle({ bottom: '0px' })
  } catch (e) {
    /* plus 未就绪 / 非 App 环境：忽略，不影响其它兜底手段 */
  }
}

function hideOnce() {
  try {
    uni.hideTabBar({ animation: false, fail: () => {} })
  } catch (e) {
    /* 非 tab 页调用会失败，忽略即可 */
  }
}

export function hideNativeTabBar() {
  // #ifdef APP-PLUS
  try {
    // 关键：这里**绝不能同步动 webview**。本函数由 App.vue 的 onLaunch 同步调用，
    // 那一刻 plus 还在初始化；同步 setStyle 会让 App 端直接白屏
    // （createInstanceContext failed —— 具体坑见 reflowAppWebview 的注释）。
    // hideOnce 是 uni API，可以立刻做；原生的 webview 重排一律延后。
    hideOnce()
    // 冷启动 / switchTab / 后台回前台都可能让原生 tabBar 复现，且 hide 之后
    // webview 未必立刻重排 —— 于多个时间点补做"隐藏 + 重排"。
    // hideTabBar 是幂等的（已隐藏时走 fail），多做几次没有副作用。
    [200, 600, 1200, 2000].forEach(ms => {
      setTimeout(() => {
        hideOnce()
        reflowAppWebview()
      }, ms)
    })
  } catch (e) {
    /* 非 tab 页调用会失败，忽略即可 */
  }
  // #endif
}

// 确认"当前页面就是当前 tab"：让悬浮底栏的高亮与胶囊归位到本页。
// 在页面 onShow 里调用：syncTabbar(this)
// 组件未挂载（首次 onShow 早于 mounted）时静默跳过，mounted 里会自己补一次。
export function syncTabbar(vm) {
  try {
    const ref = vm && vm.$refs && vm.$refs.tabbar
    if (ref && typeof ref.sync === 'function') ref.sync()
  } catch (e) {
    /* 兜底：拿不到组件就跳过动画，不影响导航 */
  }
}
