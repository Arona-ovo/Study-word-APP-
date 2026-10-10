# 首页 AI 指令输入框 —— 设计文档

> 状态：**待确认**，确认后再写代码。
> 目标：把首页顶部搜索框升级为「AI 指令输入框」，保留原有关键词搜索，
> 同时允许用自然语言实时改动首页的内容与样式。

---

## 0. 一句话结论

**页面 = `pageDoc` 的纯函数渲染。AI 不碰 DOM、不碰源码，只输出「指令序列」；
指令经白名单校验 + 取值夹取后，被翻译成对 `pageDoc` 的不可变更新。**

这是一条硬边界。DOM 是渲染结果，不是操作对象；源码是静态资产，不是运行时可变物。
AI 与页面之间只有一条窄管道：结构化指令。

---

## 1. 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│ 首页输入框（home.vue）                                     │
│   · 意图识别 → 搜索 / 指令                                  │
│   · 加载态 / 结果说明 / 错误提示                            │
└──────────────────┬──────────────────────────────────────────┘
                 │ 自然语言
┌────────────────▼────────────────────────────────────────────┐
│ services/page-agent.js                                    │
│   · system prompt =「指令手册」(由 schema 自动生成)          │
│   · LLM → JSON 指令序列；解析失败带 feedback 重试 ≤2 次      │
└────────────────┬────────────────────────────────────────────┘
                 │ Command[]
┌────────────────▼────────────────────────────────────────────┐
│ utils/page-command.js（受控变更接口）                     │
│   · COMMANDS：指令注册表（op → schema + apply）            │
│   · normalize(cmd)：类型校验 + 枚举校验 + 数值夹取          │
│   · run(doc, cmds)：原子执行（失败整体回滚）                │
│   · 只读写入 pageDoc 的纯数据，不接触任何节点 / 样式字符串拼接 │
└────────────────┬──────────────────────────────────────────┘
                 │ newDoc
┌────────────────▼──────────────────────────────────────────┐
│ pageDoc（存在 settings.home.doc，与学习进度隔离）          │
└───────────────────────────────────────────────────────────┘
```

**为什么不让 AI 直接写 CSS？**
因为「任意 CSS」= 任意破坏力（把内容顶出屏幕、写死 `#000` 让深色模式失效、
`position:fixed` 盖住导航）。受控接口把可变量收敛成**几十个有名字、有边界的旋钮**，
既能玩出花，又不会把页面搞崩。

---

## 2. `pageDoc` 数据模型

```js
// settings.home.doc
{
  version: 1,
  background: {
    preset: 'default',   // 见 theme.BACKGROUNDS
    image: '',           // 本地路径，空则用预设
    mask: 0.35,          // 0 - 0.8
    blur: 0,             // 0 - 24
    // AI 生成背景：不调图像 API，本地用渐变渲染（省费用、零延迟）
    gradient: null       // { from:'#RRGGBB', to:'#RRGGBB', angle:165 } | null
  },
  theme: {
    accent: 'blue',      // 见 theme.ACCENTS
    dark: false,
    followSystem: false,
    font: 'system',      // system | serif | rounded
    radius: 22,          // 卡片圆角 0 - 32
    density: 'cozy'      // compact | cozy | relaxed（卡片内边距/间距）
  },
  cards: [
    // id 稳定，便于 move / remove / undo
    { id: 'book', type: 'book', visible: true, title: '', text: '', image: '', style: {} },
    { id: 'action', type: 'action', visible: true, title: '', text: '', image: '', style: {} },
    ...
  ]
}
```

`pageDoc` 与 `home-layout.ts` 的关系：
- `home-layout.layout` 仍是**模块顺序的唯一真相**（已有拖拽/收纳逻辑，不动）
- `pageDoc.cards` 是**展示层的覆盖** —— 标题改了、隐藏了、样式变了，都记在这里
- 合并规则：`layout` 决定有哪些 `id` 和顺序；`pageDoc.cards` 按 `id` 提供覆盖

这样既有拖拽的既有能力，又有 AI 的自由改动，两者不打架。

---

## 3. 指令 Schema

### 3.1 信封（envelope）

模型输出的顶层必须是：

```json
{
  "summary": "一句话说明要做什么",
  "commands": [ { "op": "...", "args": { ... } }, ... ]
}
```

- `commands` 必须是数组，长度 **1-8**（超出截断，防止模型失控狂发指令）
- 每条 `op` 必须命中白名单，否则整条跳过并计入失败原因

### 3.2 卡片引用 `ref`

绝大对数指令都要定位卡片，统一用 `ref`：

```json
{ "id": "book" }              // 精确（推荐）
{ "index": 0 }                // 位置（0 起）
{ "type": "goal" }            // 按类型找第一个
{ "last": true }              // 最后一张
```

解析优先级：`id` > `index` > `type` > `last`。找不到 → 该条失败。
内置卡片 `id` 固定为 `book / action / stats / goal / chart / progress / favorites / streak`，
AI 新增的卡片 `id` 形如 `c-3f2a`。

### 3.3 指令全集

| op | 组 | 关键参数 | 说明 |
|---|---|---|---|
| `card.add` | layout | `type`* `title?` `text?` `image?` `to?` | 新增卡片（当前仅 `note` / `countdown` 两种可增类型） |
| `card.remove` | layout | `target`* | 删除卡片（内置卡也可删，可恢复） |
| `card.move` | layout | `target`* `to`* | 移动到指定位置 / `top` / `bottom` |
| `card.hide` | layout | `target`* | 隐藏（保留数据） |
| `card.show` | layout | `target`* | 显示 |
| `card.restore` | layout | `id`* | 恢复已删除的内置卡片 |
| `card.reset` | layout | — | 恢复默认首页 |
| `text.set` | content | `target`* `value`* | 直接改文案（≤120 字） |
| `text.rewrite` | content | `target`* `tone`* `instruction?` | **二次 LLM** 按语气改写 |
| `image.set` | content | `target`* `url`? / `clear`? | 换图 / 清图（url 走协议白名单） |
| `style.card` | style | `target`* `patch`* | 卡片背景/透明度/圆角/内边距 |
| `style.text` | style | `target`* `patch`* | 字号/字重/颜色/对齐/字距 |
| `theme.set` | theme | `accent?` `dark?` `font?` `motion?` | 主题色 / 深浅 / 字体 / 动效 |
| `bg.set` | background | `preset?` `image?` `mask?` `blur?` `gradient?` | 背景整体设置 |
| `macro.run` | macro | `name`* | 运行已保存的场景宏 |

> 说明：`card.*` 与 `style.*`、`text.*` 分开，是为了让「结构变更」和「外观变更」
> 走不同的校验强度 —— 结构变更更严格（涉及持久化），外观变更可放宽一点（可随时撤销）。

### 3.4 参数类型系统

自定义一套极简校验器，避免引入依赖。支持：

| 类型 | 校验 | 越界处理 |
|---|---|---|
| `enum` | 必须在 `values` 内 | 报错 → 该指令失败 |
| `int` | 整数且 `min ≤ v ≤ max` | **夹取**到边界 |
| `number` | 数值且 `min ≤ v ≤ max` | **夹取**到边界 |
| `string` | 字符串，长度 `≤ max` | **截断** |
| `color` | `key`（调色板）或 `#RGB` / `#RRGGBB` | 不合法 → 失败 |
| `bool` | 布尔 | — |
| `url` | 协议白名单 `https:` / `file:` / `data:image` | 不合法 → 失败 |

**原则：能救就救（夹取/截断），救不了才失败。**
AI 输出 `opacity: 5` 不该让整批指令挂掉，夹到 1 就行。

### 3.5 硬性红线（无法被指令绕过）

1. 指令只能命中 `pageDoc` 上**已声明的可写字段**，没有「任意 key/任意值」通道
2. 不接受任何可执行字符串：无 `new Function` / `eval` / `setTimeout(字符串)`
3. 图片 URL 走协议白名单，禁止 `javascript:` / `vbscript:`
4. 卡片数量 ≤ 12，文案 ≤ 120 字，指令数 ≤ 8
5. 主题色只能取 `theme.ACCENTS` 里的 key，不存在"任意颜色"入口
6. 所有变更走不可变更新 + 历史栈，**任何时刻都能撤销**

---

## 4. 执行引擎

### 4.1 三阶段

```
parse（1 次 LLM）  →  preview（0 次）  →  apply（0~n 次 LLM，仅 text.rewrite）
```

**为什么不直接执行？**
因为 LLM 会误解。让用户在执行前看到「AI 打算改什么」，是这类功能唯一可信的形态。

### 4.2 原子性与回退

```js
run(doc, cmds) {
  const snapshot = doc            // 当前版本（不可变，天然是快照）
  let cur = doc, applied = []
  for (const c of cmds) {
    const r = normalize(c)        // 校验
    if (!r.ok) {
      return { ok: false, applied, failed: c, reason: r.reason, doc: snapshot }
    }
    cur = COMMANDS[c.op].apply(cur, r.args)
    applied.push(...)
  }
  return { ok: true, applied, doc: cur }
}
```

不可变更新让「失败回退」变成**不做事** —— 只要不写入新 doc，页面就还在旧版本上。

### 4.3 历史栈与撤销

```js
history = [{ doc, at, summary }]   // 上限 20
undo()  → 弹出上一步，恢复到上一个 doc
```

首页顶部（或指令条下方）出现一条可交互的「变更摘要条」：
```
已应用 3 项改动 · 2 秒前        [撤销] [查看]
```

---

## 5. 意图识别（搜索 / 指令）

### 5.1 规则优先（零成本）

```js
const CMD_HINTS = [
  /^(把|将|让|帮我把|请)/,
  /(改成|换成|改为|调整为|设置成|调到)/,
  /(添加|新增|加上|加一个|加个)/,
  /(删除|移除|去掉|隐藏|显示)/,
  /(背景|主题|配色|字体|动效|圆角|透明度)/,
  /(整理|排序|重置|恢复默认)/
]
```

命中 → `command`。

### 5.2 兜底规则

- 纯 ASCII 单词 / 长度 ≤ 12 且无空格 → `search`
- 含中文且无祈使动词、长度 ≤ 10 → `search`

### 5.3 不确定时

默认走 `search`（更便宜、更安全），并在结果卡底部给一个「当作指令执行」的入口。

### 5.4 手动切换

输入框左侧胶囊：`🔍 搜索` / `⌘ 指令`，点击切换；回车 = 执行当前模式。

---

## 6. 交互状态机

```
idle ──输入──> classified(搜索|指令)
                 │
      ┌──────────┴──────────┐
   搜索                    指令
      │                      │
  localSearch            parse(LLM)
      │                      │
   有结果 ──> 展示         preview(指令列表)
   无结果 ──> 缓存?             │
                │          [执行] / [取消]
              无 ─> AI 补充        │
                                apply
                                  │
                          摘要 + 撤销
```

加载态：输入框内右侧一个旋转小环 + 文案「AI 正在理解你的指令…」
错误态：红色提示条 + 具体原因（如「指令 'xxx' 不存在，支持的指令：…」）

---

## 7. 典型指令示例

### 结构类

| 自然语言 | 指令序列 |
|---|---|
| 把收藏速览放到最上面 | `[{op:'card.move', args:{target:{id:'favorites'}, to:'top'}}]` |
| 首页太乱了，去掉掌握度概览 | `[{op:'card.hide', args:{target:{id:'progress'}}}]` |
| 加一张便签卡，写"今天也要开心" | `[{op:'card.add', args:{type:'note', text:'今天也要开心', to:'bottom'}}]` |
| 加个倒计时卡片，距离考试还有 30 天 | `[{op:'card.add', args:{type:'countdown', title:'距离考试', date:'+30d'}}]` |
| 恢复默认首页 | `[{op:'card.reset'}]` |

### 外观类

| 自然语言 | 指令序列 |
|---|---|
| 背景换成薄荷绿 | `[{op:'bg.set', args:{preset:'mint'}}]` |
| 来个日落渐变的背景 | `[{op:'bg.set', args:{gradient:{from:'#FF9A8B', to:'#FF6A88', angle:165}}}]` |
| 卡片再透一点 | `[{op:'style.card', args:{target:{last:true}, patch:{opacity:0.55}}}]` |
| 标题大一号，用衬线字体 | `[{op:'style.text', args:{target:{id:'book'}, patch:{size:34, serif:true}}}]` |
| 换成深色模式 | `[{op:'theme.set', args:{dark:true}}]` |
| 主题色改成紫色，开启动效 | `[{op:'theme.set', args:{accent:'purple', motion:true}}]` |

### 文案类（二次 LLM）

| 自然语言 | 指令序列 |
|---|---|
| 把今天的问候语写得温柔一点 | `[{op:'text.rewrite', args:{target:{id:'book'}, tone:'温柔'}}]` |
| 给我一句鼓励的话放在最上面 | `[{op:'text.rewrite', args:{target:{id:'book'}, tone:'鼓励', instruction:'一句话鼓励正在背单词的我'}}]` |

### 组合指令（多步）

> 「进入考试冲刺模式：把错题复习和 AI 专练放最上面，隐藏收藏速览，每天目标 30 个词，背景换成沉静的蓝色」

```json
[
  { "op": "card.move",  "args": { "target": {"id":"action"}, "to": "top" } },
  { "op": "card.hide",  "args": { "target": {"id":"favorites"} } },
  { "op": "theme.set", "args": { "accent": "blue" } },
  { "op": "bg.set",    "args": { "gradient": {"from":"#1E3A5F","to":"#0F1B2D","angle":165} } },
  { "op": "goal.set",  "args": { "newWords": 30 } }
]
```

---

## 8. 我额外提的几个趣味能力（挑几个做）

下面这些都不需要图像生成 API，纯文本 LLM + 本地渲染即可，成本可控。

### ★ ① 心情换肤 `bg.mood`
> 「今天下雨，来点沉静的」 / 「周五了，来点活泼的」

模型返回 `{ preset|gradient, accent, radius, opacity }` 一组值，一次性换掉背景 +
主题色 + 卡片圆角 + 透明度。**一条指令改四个维度**，视觉冲击明显，很适合演示。

### ★ ② 倒计时卡片 `card.add type=countdown`
> 「加个倒计时，距离考试还有 30 天」

新增一张卡，每天自动更新剩余天数；到 0 天时文案变成「就是今天」。
有"养成感"，而且实现极简（存目标日期，渲染时算差值）。

### ★ ③ 首页快照 `skin.save / skin.apply`
> 「把现在的首页存成'夜间模式'」 / 「回到'夜间模式'」

把当前 `pageDoc` 序列化后按名字存进 settings；随时一键还原。
和历史栈配合：**自动保留最近 3 次执行的快照**，等于"后悔药"。

### ★ ④ 场景宏 `macro.run`
> 「进入考试冲刺模式」

内置 3 个宏（`exam` / `commute` / `bedtime`），每个宏展开成一组固定指令。
比让模型自由发挥更稳、更省额度，而且"一句话切换整页"的观感很强。

### ★ ⑤ 卡片口播 `page.announce`
> 「念一下今天的进度」

把当前首页数据（已练/待复习/连续天数）拼成一句话，走 TTS 朗读出来。
复用现有语音链路，零新增依赖，交互趣味直接拉满。

---

## 9. 落地文件清单

| 文件 | 作用 | 新增/改 |
|---|---|---|
| `utils/page-command.js` | 指令注册表 + schema + 校验 + 原子执行 | 新增 |
| `utils/page-command-schema.js` | 指令元信息（供生成 prompt 与校验复用） | 新增 |
| `utils/intent.js` | 搜索 / 指令 意图识别（纯函数） | 新增 |
| `services/page-agent.js` | 自然语言 → 指令序列（带重试与降级） | 新增 |
| `pages/home/home.vue` | 输入框重构：意图标签 / 加载态 / 结果说明 / 错误提示 | 改 |
| `components/app-command-preview.vue` | 执行前预览 + 变更摘要 | 新增 |
| `utils/settings.js` | 存 `home.doc`（pageDoc 持久化） | 改 |
| `_tools/check-page-command.js` | 校验 schema / 校验器 / 执行引擎 / 意图 | 新增 |

---

## 10. 确认结果与最终落地

用户答复：**1 全做 · 2 直接执行 + 可撤销（顺滑） · 3 能出图的 API 就真出图，不能就 AI 描述颜色本地渲染渐变 · 4 够用 · 5 持久化**，
并追加「卡片方面的权限可以给大一点，让它生成用户想要的卡片」。

据此定稿：

| 确认项 | 最终做法 |
|---|---|
| 趣味能力 | ①~⑤ 全做，另加场景宏 / 心情换肤 / 每日目标 / 首页快照 / 语音播报 |
| 执行方式 | **直接执行**，不弹预览；结果条上常驻「撤销」，历史栈 20 步 |
| 背景生成 | `services/image-gen.js` 探测 `/images/generations`：支持 → 真出图落本地；不支持/失败 → 模型给两个颜色 → 本地渐变 |
| 字段上限 | 字号 20-44rpx、圆角 0-32rpx、透明度 0.3-1、蒙版 0-0.8、模糊 0-24，全部**夹取而非报错** |
| 持久化 | `settings.home.doc`，重启保留；`card.reset` 一键回默认 |
| 卡片权限 | `card.add` 支持 6 种形态 + 13 种块自由组合，单卡 8 块、首页 12 卡、单次 8 条指令 |

### 实际文件清单（与上面第 9 节的差异）

| 文件 | 作用 | 新增/改 |
|---|---|---|
| `utils/page-schema.js` | 指令契约 + 校验器 + 块 schema + `promptManual()`（唯一真相） | 新增 |
| `utils/page-doc.js` | pageDoc 模型与持久化、卡片定位、活数据绑定 | 新增 |
| `utils/page-command.js` | 19 条指令实现 + 原子执行 + 历史栈 + 场景宏 | 新增 |
| `utils/intent.js` | 搜索 / 指令 意图识别（纯函数，规则优先） | 新增 |
| `services/page-agent.js` | 自然语言 → JSON 信封（最多 3 次重试）+ 文案改写 + 配色描述 | 新增 |
| `services/image-gen.js` | 出图能力探测、图片生成与本地落地 | 新增 |
| `components/app-card-blocks.vue` | 13 种块的渲染器（AI 卡片专用） | 新增 |
| `components/float-navbar/float-navbar.vue` | 新增 `mode` / `busy`，指令态描边与魔杖图标 | 改 |
| `pages/home/home.vue` | 按 pageDoc 渲染 + 双模式输入 + 状态条 + 撤销 + effects 执行 | 改 |
| `pages/settings/settings.vue` | 「地址支持出图」开关 + 出图模型选择 | 改 |
| `_tools/check-page-command.js` | 10 组、150+ 断言的全链路回归（含红线扫描） | 新增 |

> 未做 `app-command-preview.vue`：既然选了"直接执行"，预览弹层就没有存在意义，
> 变更说明改由结果条上的 `say` + 摘要文案承担。
