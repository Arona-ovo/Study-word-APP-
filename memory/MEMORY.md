# 项目记忆（浓缩版，2026-10-09 整理）

## 概览 / 结构
- `uniapp/` = 主力（uni-app Vue3 + TS，HBuilderX）；`fujian-english-trainer/` 小程序原版已定稿不再同步
- **主战场 = Android APK**；小程序 / H5 顺带 → 别再为 2MB 主包限制砍功能
- `C:/Users/33156/PWstudy`（工作区外）：从 uniapp 克隆的骨架，`__UNI__A7E4C21` / `com.pwstudy.app`，
  key 前缀仍 `fj_`
- `pages/` 18 页 + tabBar 4 项；`data/`：words 640 + lexicon-data 3893 + bookdata + sentences 626 +
  wordbooks 6 本 + common-words 986（生成流水线在**项目外** `_vocab/build.js`，改词表前必读 `_vocab/README.md`）
- `utils/`：engine / wordbook / home-layout(.ts) / session / judge / theme / settings / tab-slide /
  checkin / sqlite / page-schema / page-doc / page-command / intent / chat-store
- `services/`：config(PROVIDER_PRESETS) / llm / http / ai-content / page-agent / image-gen / ai-gate / voice
- 校验脚本在**项目外** `_tools/`（63 个 check-*.js；全量 `bash _tools/_run-all.bash`，约 1.5 分钟）
- 默认昵称 `arona`（**settings.js 与 profile.vue 各存一份**，改要改两处）

## 设计令牌
- 背景默认 `sky` 浅蓝渐变（老用户存档优先，load 是 deepMerge）
- 主色 #2E6BFF / #1D4FD8 / #EBF1FF；错误 #E5484D；琥珀 #F79009；紫 #7C3AED；
  ink #17201A / #5A6560 / #98A19B；字重仅 400/500/600
- 英文（题干/单词/弹窗）Georgia 衬线；卡片发丝边 + 极浅投影；按钮 flex 居中 + text-indent 补字距
- 底栏图标 CSS mask 上色（`--ink-3` / 选中 `--brand`），小程序无 DOM 时退回 `<image>` 两张图
- 弹窗样式唯一来源 App.vue：`.pop-mask/.pop-card/.dlg-*`

## 硬约束
1. 背景层 `.app-root::before/::after`（fixed, z -2/-1）；需 `.app-root{position:relative;z-index:0}`；**别改不透明**
2. 窗体毛玻璃：`rgba(var(--surface-rgb),α)` + `backdrop-filter: blur(12px) saturate(180%)`
3. transform 只加 `.page-slide`，绝不加页面根节点；4. fixed 浮层放 `.page-slide` 之外
5. 禁止 `import * as ai from 'services/index.js'`（H5 丢成员）→ 叶子模块具名直连
6. tab 页常驻 → 跨页状态存模块级；7. manifest 需 `"vueVersion":"3"`
8. pages.json 末尾 HBuilderX 写 JSON5 `condition`，严格 parse 失败属正常
9. WXML 不支持函数调用 → JS 预计算；10. theme.js 常量声明在 `BACKGROUNDS` 之上（TDZ）
11. 深色模式别硬写黑底，每个预设要有 `darkCss`
12. 取消异步用 `shouldStop()` + await onProgress，别抛异常
13. CSS 变量只向下继承：消费方必须写在 `.app-root`/`.container`/`.cover`，写 `page{}` 取不到值
14. **`settings.set()` 是深合并**：别用「删掉 key」表示恢复默认，一律显式写目标值
15. 开关/守卫功能光测"关掉后没调用"不够 —— **崩了也是没调用**，必须配套测错误形态
16. **入口类 UI 一律置灰，不用 v-if 藏**（藏了用户当功能被删）
17. **失败文案两层**：`reason` 直接给用户看，`rawReason` 才带内部细节（只进 console）

## Vue 响应式（2026-10-09 真机踩坑）
- **push 进响应式数组的对象是裸对象**：改它的属性不触发渲染。必须
  `const i = arr.length; arr.push({...}); const item = arr[i]` 拿回代理再改
- 若列表是 **computed 且 map 出新对象**，缓存不会因裸对象改动失效 → 界面永远停在旧值。
  配一个版本号字段（如 `streamTick`）`void this.streamTick` + 每次改动 `++`，双保险
- uni 模板引用 data 里不存在的字段**不报错、只渲染空白**
- **`scroll-into-view` 只在值变化时才滚**：写死同一个锚点 id 连赋两次端上不动（表现为"要手动下滑"）。
  底部放两个锚点轮流指；并在 `$nextTick` 里切（等新内容渲染出来）
- **input 挂 `:disabled` 会抢走焦点 → 软键盘收起**。要留键盘：别禁用它，加 `:hold-keyboard="true"`，
  必要时 `inputFocus` false→true 重新抢焦（先判焦点是不是真丢了，否则会闪）
- **下划线缓存字段（如 `this._styleMap`）不进 data 是对的**（避免额外渲染），但**必须在 `created()` 里
  先挂到实例上**，否则 Vue 3 渲染期访问会告警「was accessed during render but is not defined」

## 功能要点
- 答题：选择 + 手动输入（judge.js 汉译英=关键词55%+编辑距离45%；英译汉=中文 n-gram）；i+1：m≥3 熟词 / m≤2 新词
- **不背单词机制**：①「记错了」= 答对后反悔，`engine.revokePass`+`iplus1.revokeMastery` 改判
  （m 净 -3、total 不变 correct-1、进错题本，**别复用 recordAnswer fail 分支**会 total+1）；
  ② 多次确认 = `word-session.createConfirmSession`（连对 CONFIRM_TIMES=2 才 done+1，
  隔 2 词重入队；**复习首答对即算记住、答错升级 need=2**）；practice 的确认题 =
  `wordSession.toItem` 本地四选一（句子答对先不落账，确认期**必须藏参考答案与词义 chips**防泄题）
- 语音：整句=原生/speechSynthesis→有道整句→有道逐词；单词=有道→原生
- 首页自定义：注册表 `utils/home-layout.ts` + 拖拽/收纳；默认走 `defaultLayout()`（def:true，
  **check-home.js 写死了默认顺序**，改注册表要同步）；pageDoc.cards 是渲染唯一真相
- 词书：批次 70% 解锁；掌握度按 bookId 隔离；导入 = `utils/import-task.js` 后台任务
- **作答方式"选了就固定"**：存 `settings.study.{drillMode,practiceMode}`，读走 `settings.studyMode()`
- AI 缓存 `utils/ai-cache.js`（`fj_ai_cache_v1`，TTL 7 天）；每日目标 `wordbook.getGoal/setGoal/goalProgress`
- **「学会」口径（两口径分家）**：`days[d].mastered` 才是"会了多少"，`total/correct` 是"做了多少/答对多少"
  （正确率、连续天数、历史曲线仍用后者，**别一起改口径**）。记账走 `engine.addMasteredToday(±1)`：
  word-drill 确认达标 +1 / `session.markWrong` 返回 `rolledBack` 时 -1；practice `commit('pass')` +1 /
  `markWrong` -1（确认没认出来走 fail，不记）。`goalProgress().practice` 读 mastered
- **顶部双进度条**：上面「已做」= 累计作答次数，**无上限、不带分母**（改判也不回退），
  进度条按"每做完一轮（= 本组题量/词数）"循环填充，超过一轮时数值后带「第 N 轮」；
  下面「会了/记住」= 确认达标的题(词)数，有分母。百分比一律 JS 预计算（answerPct/donePct）；
  **别复用全局 `.topbar`**（横排会把两条并一行）
- **进度条配色**：`settings.theme.progressSync`（唯一读取口 `theme.barsSyncColors()`，
  只有显式 false 才算"分开"）+ 页面根 class `sync / split`：
  sync = 已做 `rgba(var(--brand-rgb),.38)` 浅版 + 已会 `var(--brand)`；
  split = 已做 `var(--brand)` + 已会绿色 #2f9e6e。**颜色一律走 CSS 变量**，换主题色/深色模式自动跟随。
  设置页「外观 → 练习进度条」有开关 + 同款配色预览（看到的即练到的）
- **首页卡片跳转**：卡片要么整卡可点（`@tap` 挂根 + 右上角那颗用 `@tap.stop`），要么别指望用户找那颗
  22rpx 小字；进词库详情用 `navigateTo library-detail?tab=vocab|goal`，**switchTab 只到 tab 就停住**
  （"点不进详情"的根因）。tab 页常驻的小组件必须订阅 `uni.$on('home:refresh', this.refresh)` + $off

## 内置词书（共享词表）
- 6 本：福建专升本（默认 `fj_zsb_core`）/四/六/考研/高考/中考；考试词书数取 `BOOK_INDEX` 键（6），
  `WORDBOOKS` 是 7 项（多 `custom_inbox`）；**词数一律动态取**
- 释义只存一份在 `lexicon-data.js`，`BOOK_INDEX` 存 3 位 base36 行号；**行序 = 用户进度，别动**
- id 分区：words.js 占 1..640，共享表从 `LEX_START=10001`
- `session.js` wordsFor/takeWords **先查本书导入词再查全局表**（反序会把掌握度写到错 id 上）
- 体积护栏：源码 ≤1600KB（粗）；真指标由 `check-builtin-books.js` 守（装载 ≤800ms、堆 ≤8MB）

## AI 指令链路
- `intent.js` → `page-agent.js`（NL→JSON，重试≤3，超时30s）→ `page-schema.js`（19 条 op 白名单）
  → `page-command.js`（不可变执行）→ 新 pageDoc → Vue 渲染；设计文档 `docs/page-command-design.md`
- 硬边界：无 eval / new Function / innerHTML / DOM 操作；定心机制：失败回原 doc / 20 步 undo / 直接执行
- pageDoc 存 `settings.home.doc`；AI 卡 13 种块，渲染器 `app-card-blocks.vue`
- **卡片上限 12 张，只数显示中的**（收纳不占位）；`docDigest()` 必须把"显示中 n / 上限 m"写进 prompt
- 坑：`normalizeCommand` 对象型参数(target/blocks/style/to)先摘；`theme.set` 用 `vBoolTri()`；
  `card.hide/show` 幂等；`vEnum` 是唯一"没听懂就整条判死"的校验器；归一化必须**幂等**
- target：字符串（last/第N张/裸数字/all/标题）+ 对象别名；空形态 ""/null/{} = 未提供
- API 报错必须人话+服务商名+解决办法（401/402/404/429/5xx）；`lastError` 回喂模型前过 `humanizeError()`
- llm.js 新增 import → `check-services.js` 依赖袋要同步；**"修过还复现"先查包是不是旧的**（版本 1.0 Beta）

## AI 分项开关 / 流式
- `services/ai-gate.js` 唯一登记表：8 项 lookup/sentence/critique/drill/wordbook/chat/command/image；
  `featureOn(k)=map[k]!==false`（未登记算开启）；守卫放在"去模型那一步"且**排在缓存命中之后**
- 流式 `http.streamRequest`：App/小程序 `enableChunked+onChunkReceived`，H5 `fetch`；
  不支持 → `streamUnsupported` → `ai-content.chat()` 回退整块
- **首字节看门狗**（默认 8s，llm.js `FIRST_BYTE_MS`）：迟迟收不到字节就认输回退，别干等 20s
- 回退白名单：`streamUnsupported` / 超时 / 5xx；401/402/404/422/429 不重试直接报错
- `streamUnsupported` **不计入熔断**（它不是服务故障）
- 端不支持分块但 `success` 给了整段文本 → 直接喂解析器，省一次重发

## 对话陪练（pkgManage/pages/chat + utils/chat-store.js）
- 独立存档 key `fj_chat_v1`；**system 提示词不落盘**（每次按当前词书重生成）；
  `cleanMsg` 只留 user/assistant，空气泡与 `[object Object]` 垃圾剔除
- 发一句存一句；`onUnload` 强制 `persist()` + `flush()`（写盘 800ms 合并）
- 收藏的句子走 `settings.addFavorite({type:'sentence'})`，与词库页例句同仓

## 其他模块速记
- 打卡走势：`BASE=100`，有背 `+min(题量,24)` / 没背 `-6`，红涨绿跌；**不用 Canvas/SVG**，
  容器 padding-bottom 锁比例 + 绝对定位 view + rotate
- 刷单词（word-drill）：独立页面 + 首页 `worddrill` 模块；零 AI 组牌，三种作答
- 画质六档（`utils/perf.js`）：high→clear→balanced→lite→eco→minimal，自动档有**像素封顶**
  （>3.0M 最高 lite）；低档 backdrop-filter 置 none → 半透明是唯一遮挡手段
- 版本号唯一来源 `data/build-info.js`（`1.0 Beta`，versionCode 101 只涨不跌）；彩蛋连点 7 下

## 工具备忘
- managed node：`C:/Users/33156/.workbuddy/binaries/node/versions/22.22.2-6/node.exe`
- `_tools/lib/load.js`：`load(路径)` / `loadCode(src, deps, filename)`；支持 `export default`，
  不支持 `export {X} from`；`data/` 相对导入自动递归
- **漏注入依赖 = 假绿**（崩了也算"没调用"）→ 必须再加一组验错误形态
- 需真实 ESM（含 .ts）用 `await import('file:///...')`；断言别写死内置模块 id 列表
- 扫源码契约前剥**两种**注释：`/*...*/` 与 `^//`
- 新增首页模块注册表项 → `i18n-en.js` 必须同步 name/desc 译文（check-i18n 第 5 组守）

## 原生打包（APK）资源
- **图标唯一正确层级 = `app-plus.distribute.icons.android.{mdpi48,hdpi72,xhdpi96,xxhdpi144,xxxhdpi192}`**。
  写成 `distribute.android.icons` 时 HBuilderX **不报错**，云打包静默回退 DCloud 默认绿色 H 图标
  （且默认「通用启动界面」= 图标+应用名 → 开屏一起变绿 H）。`check-native-assets.js` 现在守这条。
- 启动图 = `distribute.splashscreen.{androidStyle:'default', android:{hdpi 480x762, xhdpi 720x1242, xxhdpi 1080x1882}}`；
  **只能是静态 png**（不支持 gif/动画）→ cover 页动画（`pages/cover/cover.vue`）必然在启动图之后才播。
  两者要"无缝"，就让启动图复刻 cover 首屏：`_tools/gen-splash.py` 按 750rpx 设计稿生成（改 cover 底色要重跑）。
- 顶层 `app-plus.splashscreen` 只管关闭策略（alwaysShowBeforeRender/autoclose/waiting/delay），
  与 `distribute.splashscreen`（放图）是两处，**别配错地方**。自定义启动图时 `waiting:false` 免叠加载圈。
- 这些改动**只有云打包/自定义基座生效**，标准基座真机运行永远显示默认图标；覆盖安装后图标还有 ROM 缓存 → 卸载重装。
- manifest.json 是**严格 JSON**（check-version-egg 直接 JSON.parse）→ 别加注释。
