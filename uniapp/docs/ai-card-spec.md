# AI 卡片自定义规格（Card Design Spec v2）

给"通过 API 接入的 AI"看的卡片设计契约。AI 输出一份 **JSON 配置**，App 渲染它。
本文同时明确两件事：**AI 能自由决定什么**，以及 **AI 绝不可能碰到什么**。

- 实现：`utils/card-spec.js`（规格定义 + 归一化 + 红线）、`components/card-canvas.vue`（渲染器）
- 指令：`card.design`（新增 / 整卡替换）
- 校验：`node _tools/check-card-spec.js`

---

## 1. 设计原则

| 原则 | 说明 |
| --- | --- |
| **自由优先** | 布局、样式、数据、交互、内容全部开放，只要不碰红线就没有"不允许的设计" |
| **能救就救** | AI 给越界 / 非法 / 拼错的值，一律**夹取、截断、取默认值**，而不是让整张卡失败 |
| **失败唯一理由** | 只有"整张卡一个可渲染的节点都没有"才算失败 |
| **红线是做不到，不是不推荐** | 归一化层结构上就生产不出违规产物，不依赖模型自觉 |
| **与实现同源** | 给模型的手册由 `card-spec.promptSpec()` 从同一份 schema 推导，改实现即改手册 |

数据流（单向、可审计）：

```
AI ──JSON──▶ page-schema.normalizeCommand
             └─▶ card-spec.normalizeDesign   ← 夹取 / 截断 / 丢弃（红线在这层）
                    └─▶ page-command.COMMANDS['card.design']
                          └─▶ pageDoc（不可变，失败即不写入）
                                └─▶ card-canvas 渲染（只读，不执行任何副作用）
```

---

## 2. 可自定义范围（AI 的自由）

### 2.1 布局
- 卡片分 **1–6 个区（section）**，顺序自定
- 每区 `layout`：`stack` 竖排 / `row` 横排 / `grid` 网格（`cols` 2–4 列）
- 区的 `gap`（0–32rpx）、`align`（left/center/right）、`valign`（start/center/end/stretch）
- 节点的横向占比 `style.grow`（0–6）；固定宽 `style.w`（rpx 或 `"full"`）；固定高 `style.h`

### 2.2 视觉样式
任何节点和任何分区都可以带 `style`，写几个生效几个：

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `bg` | `#RGB` / `#RRGGBB` / 令牌名 / `{from,to,angle}` | 底色：纯色、主题令牌、渐变 |
| `fg` | 颜色 | 文字色 |
| `tone` | normal/muted/strong/brand/danger/warn/ok | 文字色的语义快捷方式 |
| `radius` | 0–48rpx | 圆角 |
| `pad` | 0–40rpx | 内边距 |
| `border` | `{w:0-4, c:颜色}` | 描边 |
| `shadow` | none/soft/lifted | 投影 |
| `size` | 18–52rpx | 字号 |
| `weight` | 400/500/600 | 字重 |
| `lh` | 1–2.2 | 行高 |
| `serif` / `italic` / `deco` | 布尔 / none/underline/through | 字体与修饰 |
| `align` / `valign` | 见上 | 对齐 |
| `grow` / `w` / `h` | 见上 | 尺寸 |
| `opacity` | 0.2–1 | 透明度 |

颜色令牌（给名字会跟随主题，给 `#hex` 是固定色）：
`brand` `brand-strong` `ink` `ink-2` `ink-3` `surface` `danger` `warn` `ok` `clear`

### 2.3 数据字段
- **绑定真实学习数据**：任何文案里写 `{{live.字段}}`
- **自定义字段**：`design.data` 里定义，用 `{{data.键}}` 引用（≤12 个）
- **卡片状态**：`design.state` 定义初值，用 `{{state.键}}` 引用，可被交互改写（≤16 个）
- **条件显示**：节点 / 分区的 `when`

可绑定的 `live` 字段（**全部是学习统计，没有任何身份信息**）：

```
todayTotal  todayCorrect  accuracy  wrongCount  streak  longestStreak
mastered  wordCount  bookPct  bookName
batchName  batchDone  batchTotal  batchPct
newWordsDone  newWordsTarget  practiceDone  practiceTarget
usageToday  usageAvg
```

### 2.4 交互逻辑
点击动作写在节点的 `on.tap`（或 `button` 的 `do`）上：

| 动作 | 参数 | 效果 |
| --- | --- | --- |
| `navigate` | `page` | 跳页面（白名单内，tab 页自动用 switchTab） |
| `practice` | `source`: daily/review/drill | 开始练习 |
| `speak` | `text` | 朗读 |
| `toast` | `text` | 轻提示 |
| `copy` | `text` | 复制到剪贴板 |
| `refresh` | — | 刷新首页数据 |
| `state.set` | `key`, `value` | 改卡片状态 |
| `state.toggle` | `key` | 布尔取反 |
| `state.inc` | `key`, `by` | 数值累加（单次 ≤100） |

可跳转的页面（`PAGE_ROUTES` 白名单）：
`home` `library` `review` `profile`（以上 tab 页）、`practice` `history` `streak`
`bookSwitch` `settings` `favorites` `stats` `reviewList` `donate`

可交互的节点：`button`、`chips`（页签式切换）、`toggle`（开关）、`field`（输入框）、
`checklist`（勾选，状态写回文档）。

### 2.5 内容
任何文案、清单、键值对、标签、引言、倒计时、图片、分隔线、留白。

---

## 3. 红线（AI 做不到，也不用试）

| # | 红线 | 怎么保证的 |
| --- | --- | --- |
| R1 | **不执行代码** | 全链路没有 eval、没有函数构造、没有模板求值、没有原始 HTML 注入。`{{}}` 只对 `live.x` / `state.x` / `data.x` 三种白名单键做**值替换**，其他写法原样保留（显示出来而已），绝不求值 |
| R2 | **不碰系统** | 读不到文件、数据库、设备信息；写只能写"自己这张卡"的文档，改不动学习进度 / 词库 / 账号 |
| R3 | **不碰凭据** | 数据目录只有学习统计，没有 token / 密钥 / 手机号 / 账号；规格里没有任何发起网络请求的能力 |
| R4 | **不越权跳转** | `navigate` 的 `page` 必须在 `PAGE_ROUTES` 白名单；**没有**"打开任意 URL / 调起别的 App / 跳外链"这种动作 |
| R5 | **不泄漏** | 图片地址只放行 `https`、uni 沙箱（`_doc` / `_www`）与本地相对路径；`data:image/svg` 与 `javascript:` 一律丢弃（SVG 能夹脚本） |
| R6 | **不崩溃** | 层数固定两层、区数 ≤6、每区节点 ≤6、整卡节点 ≤28、列表 ≤12、正文 ≤200 字…… 渲染是展平后的静态 `v-for`，不存在深递归 / 栈溢出 / 内存爆掉 |
| R7 | **不阻塞** | 规格里没有网络请求、没有同步大写入、没有定时器 |

红线清单由 `card-spec.RED_LINES` 导出，可自定义范围由 `card-spec.FREEDOM` 导出 —— 文档、UI、校验脚本读的是同一份。

---

## 4. 规格参考

### 4.1 顶层

```jsonc
{
  "sections": [ /* 1-6 个分区 */ ],
  "data":  { "自定义键": "值" },   // 可选，≤12
  "state": { "状态键": "初值" }    // 可选，≤16
}
```

### 4.2 分区

```jsonc
{
  "layout": "stack",        // stack | row | grid
  "gap": 12,                // 0-32
  "align": "left",          // left | center | right
  "valign": "center",       // start | center | end | stretch
  "cols": 2,                // 仅 grid，2-4
  "style": { },             // 见 2.2
  "when": { },              // 见 4.5
  "items": [ /* 1-6 个节点 */ ]
}
```

### 4.3 节点

| kind | 参数 |
| --- | --- |
| `title` | `text`, `level`(1/2) |
| `text` | `text` |
| `metric` | `label`, `value`, `unit`, `bind`, `size`(sm/md/lg), `caption` |
| `progress` | `label`, `value`, `bind`, `target`, `showPct` |
| `ring` | `label`, `value`, `bind`, `target`, `caption` |
| `checklist` | `items:[{text,done}]` |
| `list` | `items:[字符串]`, `ordered` |
| `kv` | `items:[{k,v}]` |
| `quote` | `text`, `author` |
| `tags` | `items:[字符串]`, `tone`(brand/neutral/warn) |
| `chips` | `items:[{text,value}]`, `bind`（写进哪个 state 键） |
| `toggle` | `label`, `bind` |
| `field` | `label`, `placeholder`, `bind` |
| `image` | `url`, `ratio`, `caption` |
| `countdown` | `title`, `date`（`YYYY-MM-DD` 或 `+Nd`） |
| `button` | `text`, `variant`(primary/ghost/danger/plain), `do` |
| `divider` | — |
| `spacer` | `h` |

别名（老块名继续可用）：`stat`→`metric`、`header`→`title`、`para`→`text`。

### 4.4 节点通用字段

```jsonc
{
  "kind": "text",
  "text": "…",
  "style": { },          // 见 2.2
  "when": { },           // 见 4.5
  "on": { "tap": { "do": "navigate", "page": "history" } }
}
```

### 4.5 条件显示

```jsonc
{ "k": "live.streak", "op": "gt", "v": "3" }
{ "k": "state.tab",   "op": "eq",  "v": "a" }
{ "k": "data.x",      "op": "has", "v": "油" }
```

`k` 只能是 `live.*` / `state.*` / `data.*`（键名 24 字符以内）；
`op` 支持 `eq ne gt gte lt lte in has`。两边都能转成数字就按数值比，否则按字符串比。

---

## 5. 可直接使用的示例

### 5.1 今日战报（三栏数字 + 进度条 + 按钮）

```json
{
  "op": "card.design",
  "args": {
    "title": "今日战报",
    "design": {
      "sections": [
        {
          "layout": "row", "gap": 12, "valign": "stretch",
          "items": [
            { "kind": "metric", "bind": "todayTotal", "label": "已练", "unit": "题", "size": "lg",
              "style": { "grow": 1, "bg": "surface", "radius": 20, "pad": 16, "align": "center" } },
            { "kind": "metric", "bind": "accuracy", "label": "正确率", "unit": "%", "size": "lg",
              "style": { "grow": 1, "bg": "surface", "radius": 20, "pad": 16, "align": "center" } },
            { "kind": "metric", "bind": "streak", "label": "连续", "unit": "天", "size": "lg",
              "style": { "grow": 1, "bg": "surface", "radius": 20, "pad": 16, "align": "center" } }
          ]
        },
        {
          "layout": "stack", "gap": 10,
          "items": [
            { "kind": "progress", "label": "每日练习", "bind": "practiceDone", "target": 20, "showPct": true },
            { "kind": "progress", "label": "当前批次", "bind": "batchPct", "target": 100, "showPct": true }
          ]
        },
        { "layout": "stack", "items": [
          { "kind": "button", "text": "开始背单词", "variant": "primary",
            "do": { "do": "practice", "source": "daily" } }
        ] }
      ]
    }
  }
}
```

### 5.2 带页签的卡片（chips + state + when）

```json
{
  "op": "card.design",
  "args": {
    "title": "我的进度",
    "design": {
      "state": { "tab": "book" },
      "sections": [
        { "layout": "row", "gap": 10, "items": [
          { "kind": "chips", "bind": "tab", "items": [
            { "text": "全书", "value": "book" },
            { "text": "批次", "value": "batch" },
            { "text": "今日", "value": "today" }
          ] }
        ] },
        { "layout": "stack", "when": { "k": "state.tab", "op": "eq", "v": "book" }, "items": [
          { "kind": "ring", "label": "全书进度", "bind": "bookPct", "target": 100,
            "caption": "{{live.mastered}} / {{live.wordCount}} 词" },
          { "kind": "text", "text": "当前词书：{{live.bookName}}", "style": { "tone": "muted", "size": 22 } }
        ] },
        { "layout": "stack", "when": { "k": "state.tab", "op": "eq", "v": "batch" }, "items": [
          { "kind": "progress", "label": "{{live.batchName}}", "bind": "batchPct", "target": 100 },
          { "kind": "kv", "items": [
            { "k": "已学", "v": "{{live.batchDone}} 词" },
            { "k": "总量", "v": "{{live.batchTotal}} 词" }
          ] }
        ] },
        { "layout": "grid", "cols": 2, "gap": 12,
          "when": { "k": "state.tab", "op": "eq", "v": "today" },
          "items": [
            { "kind": "metric", "bind": "usageToday", "unit": "分钟", "label": "今日停留",
              "style": { "bg": "surface", "radius": 18, "pad": 14 } },
            { "kind": "metric", "bind": "usageAvg", "unit": "分钟", "label": "日均",
              "style": { "bg": "surface", "radius": 18, "pad": 14 } },
            { "kind": "metric", "bind": "wrongCount", "unit": "题", "label": "待复习",
              "style": { "bg": "surface", "radius": 18, "pad": 14 } },
            { "kind": "metric", "bind": "longestStreak", "unit": "天", "label": "最长连续",
              "style": { "bg": "surface", "radius": 18, "pad": 14 } }
          ]
        }
      ]
    }
  }
}
```

### 5.3 考前冲刺清单（checklist + 倒计时 + 引言）

```json
{
  "op": "card.design",
  "args": {
    "title": "考前七天",
    "design": {
      "sections": [
        { "layout": "row", "gap": 16, "valign": "center", "items": [
          { "kind": "countdown", "title": "距离考试", "date": "+7d" },
          { "kind": "ring", "label": "掌握度", "bind": "bookPct", "target": 100,
            "style": { "grow": 1, "h": 120 } }
        ] },
        { "layout": "stack", "gap": 6, "items": [
          { "kind": "checklist", "items": [
            { "text": "过一遍高频词", "done": false },
            { "text": "清掉全部错题", "done": false },
            { "text": "做两套模拟", "done": false },
            { "text": "早睡", "done": false }
          ] }
        ] },
        { "layout": "stack", "items": [
          { "kind": "quote", "text": "一天一点点，比一天一大口走得远。", "author": "AWword" }
        ] },
        { "layout": "row", "gap": 12, "items": [
          { "kind": "button", "text": "复习错题", "variant": "ghost",
            "do": { "do": "practice", "source": "review" }, "style": { "grow": 1 } },
          { "kind": "button", "text": "AI 专练", "variant": "primary",
            "do": { "do": "practice", "source": "drill" }, "style": { "grow": 1 } }
        ] }
      ]
    }
  }
}
```

### 5.4 最小可用（一行就够）

```json
{ "op": "card.design", "args": { "title": "提醒", "design": { "sections": [
  { "layout": "stack", "items": [ { "kind": "text", "text": "今天还没背单词，来 10 分钟？" } ] }
] } } }
```

---

## 6. 写错了会怎样（降级行为）

| AI 写了 | 实际结果 |
| --- | --- |
| `size: 9999` | 夹到 52（不失败） |
| `layout: "galaxy"` | 当 `stack` |
| `bg: "url(...)"` | 整个字段丢弃，用默认底色 |
| `kind: "iframe"` | 这个节点丢掉；整张卡还有其他节点就照常渲染 |
| 一个区里放 40 个节点 | 只留前 6 个 |
| 写了 20 个区 | 只留前 6 个，且总节点不超过 28 |
| `{{eval(1+1)}}` | 原样显示 `{{eval(1+1)}}`，不求值 |
| `page: "../../etc/passwd"` | 落到默认页 `practice` |
| 图片 `data:image/svg+xml;...` | 清空，图片块不显示 |
| 整个 design 一个可用节点都没有 | **这条指令失败**，报错"这份设计里没有可渲染的内容"，首页一个字节都不变 |

---

## 7. 与旧体系的兼容

- 老卡片（只有扁平 `blocks` 的 13 种块）**零改动继续渲染**：外壳
  `app-card-blocks.vue` 用 `card-spec.fromLegacyBlocks()` 现转成 design，
  连续的 `stat` 会合成横排，观感与原来一致。
- 老的 `live` 字段等价于新的 `bind`；老的 `action:"practice"` 等价 `do:{do:"practice"}`。
- `card.add` 等旧指令全部保留，AI 可以混用。
