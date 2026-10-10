<template>
  <view
    class="container page-tabbar page-nav"
    :class="appTheme"
    :style="appBgStyle"
    @touchstart="onSlideStart"
    @touchmove="onSlideMove"
    @touchend="onSlideEnd"
    @touchcancel="onSlideEnd"
  >
    <!-- 悬浮顶栏：首页是「搜索 + AI 指令」双模式输入框 -->
    <float-navbar
      ref="navbar"
      search
      :mode="inputMode"
      :busy="cmdBusy"
      :locked="modeLocked"
      switchable
      :placeholder="navPlaceholder"
      :value="keyword"
      @input="onSearchInput"
      @search="onSubmit"
      @focus="onInputFocus"
      @blur="onInputBlur"
      @clear="clearSearch"
      @mode-toggle="toggleMode"
    />

    <!-- 内容区：切 tab 时整体左右滑动（顶栏与底栏留在外面，不跟着滑） -->
    <view class="page-slide" :class="slideCls" :style="slideStyle">
    <!-- AI 指令：加载态 / 执行结果 / 错误提示 / 撤销 -->
    <view v-if="cmdBar" class="cmd-bar" :class="'is-' + cmdState">
      <view v-if="cmdBusy" class="cmd-spin"></view>
      <text class="cmd-text">{{ cmdBarText }}</text>
      <text v-if="cmdState === 'done' && cmdCanUndo" class="cmd-undo" @tap="undoLast">撤销</text>
      <!-- 判错的兜底：这条本来是想查词 → 一键按原文重搜 -->
      <text v-if="cmdState === 'error' && lastCmdText" class="cmd-undo" @tap="retryAsSearch">当成查词</text>
      <text v-if="!cmdBusy" class="cmd-close" @tap="closeCmdBar">×</text>
    </view>

    <!-- 指令模式的快捷示例：聚焦且还没输入时出现 -->
    <scroll-view v-if="showSuggest" class="cmd-sug" scroll-x>
      <text v-for="s in suggestions" :key="s" class="cmd-chip" @tap="useSuggestion(s)">{{ s }}</text>
    </scroll-view>

    <!-- 搜索结果 -->
    <view v-if="searching && !editing" class="card search-card">
      <view class="sr-head">
        <text class="sr-title">{{ searchTitle }}</text>
        <text class="sr-close" @tap="clearSearch">收起</text>
      </view>

      <!-- 本地命中 -->
      <block v-if="results.length">
        <view v-for="(it, i) in results" :key="i" class="sr-item" @tap="openWord(it)">
          <view class="sr-line">
            <text class="sr-word">{{ it.w }}</text>
            <text v-if="it.pos" class="sr-pos">{{ it.pos }}</text>
            <text class="tag sr-src">{{ it.fromText }}</text>
          </view>
          <text class="sr-mean">{{ it.m }}</text>
        </view>
        <text class="sr-tip">点击任意词条查看详情</text>
      </block>

      <!-- 底层缓存命中：之前生成过，离线也能直接看 -->
      <block v-else-if="cached">
        <!-- 缓存里的词同样点得开：要不要收进词书在单词页决定 -->
        <view class="sr-item" @tap="openWord({ w: cached.word })">
          <view class="sr-line">
            <text class="sr-word">{{ cached.word }}</text>
            <text v-if="cached.pos" class="sr-pos">{{ cached.pos }}</text>
          </view>
          <text class="sr-mean">{{ cached.meaning }}</text>
          <view v-for="(ex, i) in cached.examples" :key="i" class="sr-ex">
            <text class="sr-ex-en">{{ ex.en }}</text>
            <text class="sr-ex-zh">{{ ex.zh }}</text>
          </view>
        </view>
        <text class="sr-tip">来自本机缓存，不消耗 AI 额度 · 点开词条可加入词书</text>
      </block>

      <!-- AI 补充中 -->
      <view v-else-if="aiLoading" class="sr-state">
        <view class="sr-spinner"></view>
        <text class="sr-state-text">本地词库没有「{{ lastQuery }}」，正在用 AI 补充…</text>
      </view>

      <!-- AI 已补充：只进本机缓存，不进任何词书（收不收进词书由用户在单词页决定） -->
      <view v-else-if="aiResult" class="sr-ai" @tap="openWord({ w: aiResult.word })">
        <view class="sr-line">
          <text class="sr-word">{{ aiResult.word }}</text>
          <text v-if="aiResult.pos" class="sr-pos">{{ aiResult.pos }}</text>
        </view>
        <text class="sr-mean">{{ aiResult.meaning }}</text>
        <view v-for="(ex, i) in aiResult.examples" :key="i" class="sr-ex">
          <text class="sr-ex-en">{{ ex.en }}</text>
          <text class="sr-ex-zh">{{ ex.zh }}</text>
        </view>
        <view class="sr-foot">
          <text class="sr-badge">{{ aiBadge }}</text>
          <text class="sr-speak" :data-w="aiResult.word" @tap.stop="speakResult">发音</text>
        </view>
        <text class="sr-tip">点开词条可加入词书</text>
      </view>

      <!-- 没有结果 -->
      <view v-else class="sr-state">
        <text class="sr-state-text">本地词库没有「{{ lastQuery }}」</text>
        <text class="sr-state-hint">{{ aiEnabled ? 'AI 也未能补充这个词，换个拼写试试' : '接入 AI 后，搜不到的词会自动补充到本机缓存' }}</text>
        <view class="sr-actions">
          <text v-if="aiEnabled" class="sr-retry" @tap="aiLookup(lastQuery)">再试一次</text>
          <!-- 反向兜底：这句其实是想让 AI 改页面 → 一键按指令重跑 -->
          <text class="sr-retry sr-retry-cmd" @tap="retryAsCommand">当成指令试试</text>
        </view>
      </view>
    </view>

    <!-- 首页模块：按用户保存的顺序渲染；编辑态显示拖拽手柄与收纳按钮 -->
    <view
      class="mod-list"
      @touchmove="dragMove"
      @touchend="dragEnd"
      @touchcancel="dragEnd"
    >
      <view
        v-for="(c, i) in renderCards"
        :key="c.id"
        class="mod-wrap"
        :class="{ 'is-drag': dragIndex === i, 'is-editing': editing }"
        :style="wrapStyle(i)"
      >
        <!-- 编辑态遮罩：屏蔽模块内部点击（换词书 / 主按钮 / 小组件链接），只留手柄与收纳可点 -->
        <view v-if="editing" class="mod-shield"></view>

        <!-- 编辑态：整行都是拖动把手（触摸 + H5 鼠标都支持），收纳按钮除外 -->
        <view
          v-if="editing"
          class="mod-bar"
          @touchstart="dragStart(i, $event)"
          @mousedown="dragStartMouse(i, $event)"
        >
          <view class="mod-grip">
            <view class="grip-lines">
              <view class="grip-line"></view>
              <view class="grip-line"></view>
              <view class="grip-line"></view>
            </view>
            <text class="grip-text">拖动</text>
          </view>
          <text class="mod-name">{{ nameOf(c.id) }}</text>
          <text class="mod-hide" @touchstart.stop="noop" @mousedown.stop="noop" @tap="stashModule(c.id)">收纳</text>
        </view>

        <!-- AI 造的卡片：统一走块渲染器（13 种块，schema 之外画不出来） -->
        <view v-if="!c.builtin" class="mod-widget">
          <app-card-blocks
            :card="c"
            :live="live"
            removable
            @toggle="onCardToggle"
            @action="onCardAction"
            @remove="onCardRemove"
          />
        </view>

        <!-- 模块 A：当前词书 -->
        <view v-else-if="c.type === 'book'" class="card book-head-card" :style="cardStyle(c)">
          <view class="book-info">
            <view class="book-name">{{ bookName }}</view>
            <!-- 主进度展示"当前批次"，总进度作为次要信息（640 词时整本进度条几乎为 0） -->
            <view class="book-progress-text" v-if="batchTotal > 0">
              {{ batchName }} · 已学 {{ batchTouched }} / {{ batchTotal }} 词
            </view>
            <view class="book-progress-text" v-else-if="batchless">该词书还没有词汇，去「词库」添加</view>
            <view class="book-progress-text" v-else>尚未开始</view>
            <view class="progress-track book-track">
              <view class="progress-fill" :style="{ width: batchPct + '%' }"></view>
            </view>
            <view class="book-sub" v-if="wordCount > 0">全书已学 {{ touched }} / {{ wordCount }} 词</view>
          </view>
          <view class="switch-link" @tap="goBooks">换词书 ›</view>
        </view>

        <!-- 模块 B：主行动区 -->
        <view v-else-if="c.type === 'action'" class="action-area" :style="cardStyle(c)">
          <button class="btn-primary start-btn" @tap="startPractice">{{ today.total > 0 ? '继续学习' : '开始背单词' }}</button>
          <view class="mini-row">
            <button v-if="wrongCount > 0" class="btn-mini" @tap="goReview">复习 {{ wrongCount }} 道错题</button>
            <button class="btn-mini" :class="{ 'entry-disabled': !aiEnabled }" @tap="goDrill">AI 薄弱点专练</button>
          </view>
          <view class="action-tip">每次 {{ sessionSize }} 题 · 中英互译 · 难度随掌握情况调整</view>
        </view>

        <!-- 模块 C：今日数据条（三项分别跳详情） -->
        <view v-else-if="c.type === 'stats'" class="card stats-row" :style="cardStyle(c)">
          <view class="stat-item" @tap="goHistory">
            <text class="stat-num">{{ today.total }}</text>
            <text class="stat-label">已练(题)</text>
          </view>
          <view class="stat-item" @tap="goReviewList">
            <text class="stat-num" :class="{ warn: wrongCount > 0 }">{{ wrongCount }}</text>
            <text class="stat-label">待复习</text>
          </view>
          <view class="stat-item" @tap="goStreak">
            <text class="stat-num">{{ streak }}</text>
            <text class="stat-label">连续(天)</text>
          </view>
        </view>

        <!-- 可选小组件：掌握度概览 / 收藏速览 / 打卡周历 / 打卡走势 / 每日目标 -->
        <view v-else-if="c.type === 'progress'" class="mod-widget"><widget-progress /></view>
        <view v-else-if="c.type === 'favorites'" class="mod-widget"><widget-favorites /></view>
        <view v-else-if="c.type === 'streak'" class="mod-widget"><widget-streak /></view>
        <view v-else-if="c.type === 'chart'" class="mod-widget"><widget-chart /></view>
        <view v-else-if="c.type === 'goal'" class="mod-widget"><widget-goal /></view>

        <!-- AI 给内置卡加的配图与批注文案 -->
        <image v-if="c.builtin && c.image" class="mod-image" :src="c.image" mode="aspectFill" />
        <text v-if="c.builtin && c.text" class="mod-note">{{ c.text }}</text>
      </view>

      <!-- 空态兜底：理论上 normalize() 不会给出空布局 -->
      <view v-if="!renderCards.length" class="home-empty">
        <text class="home-empty-text">首页空空如也</text>
        <text class="home-empty-link" @tap="toggleEdit">编辑首页，把组件加回来</text>
      </view>
    </view>

    <!-- 底部操作行：非编辑态只留一个入口，保持简洁 -->
    <view class="home-foot">
      <block v-if="editing">
        <view class="foot-btn ghost" @tap="openSheet">＋ 添加组件</view>
        <view class="foot-btn primary" @tap="finishEdit">完成</view>
      </block>
      <view v-else class="foot-link" @tap="toggleEdit">编辑首页</view>
    </view>
    </view>

    <!-- 收纳区：从首页移出的模块，可一键加回（放在 page-slide 之外，fixed 参照不受滑动动画影响） -->
    <view v-if="sheetShow" class="sheet-mask" @tap="closeSheet">
      <view class="sheet" @tap.stop="">
        <view class="sheet-head">
          <text class="sheet-title">添加组件</text>
          <text class="sheet-close" @tap="closeSheet">关闭</text>
        </view>
        <scroll-view class="sheet-body" scroll-y>
          <view
            v-for="m in sheetList"
            :key="m.id"
            class="sheet-item"
            @tap="restoreModule(m.id)"
          >
            <view class="sheet-info">
              <text class="sheet-name">{{ m.name }}</text>
              <text class="sheet-desc">{{ m.desc }}</text>
            </view>
            <text class="sheet-add">添加</text>
          </view>
          <view v-if="!sheetList.length" class="sheet-empty">
            <text class="sheet-empty-text">所有组件都已在首页上</text>
          </view>
        </scroll-view>
      </view>
    </view>

    <!-- 悬浮磨砂玻璃标签栏（原生 tabBar 已隐藏） -->
    <float-tabbar ref="tabbar" current="home" />
  </view>
</template>

<script>
import * as wordbook from '../../utils/wordbook'
import * as dict from '../../utils/dict'
import * as search from '../../utils/search'
import { aiGateReason } from '../../services/config.js'
import { speakWord } from '../../services/voice.js'
import { explainWord } from '../../services/ai-content.js'
import { hideNativeTabBar, syncTabbar } from '../../utils/nav.js'
import * as aiCache from '../../utils/ai-cache.js'
import tabSlideMixin from '../../utils/tab-slide-mixin.js'
import FloatTabbar from '../../components/float-tabbar/float-tabbar.vue'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'
import WidgetProgress from '../../components/home-widgets/widget-progress.vue'
import WidgetFavorites from '../../components/home-widgets/widget-favorites.vue'
import WidgetStreak from '../../components/home-widgets/widget-streak.vue'
import WidgetChart from '../../components/home-widgets/widget-chart.vue'
import WidgetGoal from '../../components/home-widgets/widget-goal.vue'
import AppCardBlocks from '../../components/app-card-blocks.vue'
import * as homeLayout from '../../utils/home-layout.ts'
import * as pageDoc from '../../utils/page-doc.js'
import * as pageCommand from '../../utils/page-command.js'
import * as intent from '../../utils/intent.js'
import * as pageAgent from '../../services/page-agent.js'
import { speak as speakAny } from '../../services/voice.js'

// AI 补充的触发延迟：避免边打字边请求
const AI_DELAY = 700

// 把对象 String() 出来的垃圾（"[object Object]" 之类）。
// 以前它会被当成正经搜索词：AI 去解释它、把结果写进词库，
// 于是搜索里就冒出一个莫名其妙的 "Object"。现在一律拦掉。
const JUNK_TEXT = /^\[object\s/i
// 一个"像样的待查词"：字母/数字起头，只允许字母、数字、空格、撇号、连字符，≤40 字。
// 中英文单词、词组都过；"[object Object]"、整段句子、JSON 碎片都不过。
const WORDISH = /^[\p{L}\p{N}][\p{L}\p{N}\s'’\-·]{0,39}$/u

// tabBar 页：只能用 switchTab 打开（AI 卡的按钮动作也要遵守）
const TAB_PAGES = ['/pages/home/home', '/pages/library/library', '/pages/review/review', '/pages/profile/profile']

export default {
  components: {
    FloatTabbar,
    FloatNavbar,
    WidgetProgress,
    WidgetFavorites,
    WidgetStreak,
    WidgetChart,
    WidgetGoal,
    AppCardBlocks
  },
  mixins: [tabSlideMixin('home')],
  data() {
    return {
      bookId: '',
      bookName: '',
      touched: 0,
      mastered: 0,
      wordCount: 0,
      bookPct: 0,
      batchIndex: 0,
      batchName: '',
      batchTouched: 0,
      batchMastered: 0,
      batchTotal: 0,
      batchPct: 0,
      batchless: false,
      today: { total: 0, correct: 0 },
      streak: 0,
      wrongCount: 0,
      // 每组题量 = 当前词书的「每日练习通过」目标（词库详情 → 每日目标 可调）
      sessionSize: 10,
      aiEnabled: false,
      aiReason: '',
      // 顶部搜索
      keyword: '',
      lastQuery: '',
      searching: false,
      results: [],
      // 底层缓存命中的历史结果（离线可看，不发请求）
      cached: null,
      aiResult: null,
      aiLoading: false,
      searchTimer: 0,
      // ---------- 首页布局（顺序 / 编辑态 / 拖拽） ----------
      layout: [],
      editing: false,
      sheetShow: false,
      sheetList: [],
      dragIndex: -1,
      dragDy: 0,
      dragStartY: 0,
      dragHeights: [],
      // ---------- 页面文档（AI 指令唯一能改的东西） ----------
      doc: null,
      live: {},
      // ---------- AI 指令输入框 ----------
      inputMode: 'search',       // search | command
      // 模式是否被手动锁定：锁了之后打字不再自动改判，清空输入才解锁
      modeLocked: false,
      // 上一次提交的原文：指令失败时用它"当成查词"重跑，不要求用户重新输入
      lastCmdText: '',
      inputFocused: false,
      cmdState: '',              // '' | thinking | running | done | error
      cmdSay: '',
      cmdSummary: '',
      cmdError: '',
      cmdCanUndo: false,
      cmdRunning: false,
      suggestions: intent.SUGGESTIONS
    }
  },
  computed: {
    /** 双模式输入框：指令态给不同的 placeholder 与提示 */
    navPlaceholder() {
      return this.inputMode === 'command'
        ? '说句话改首页，例如「背景换成安静的蓝」'
        : '搜索单词或中文释义（/ @ 开头下指令）'
    },
    cmdBusy() {
      return this.cmdState === 'thinking' || this.cmdState === 'running'
    },
    cmdBar() {
      return !!this.cmdState
    },
    cmdBarText() {
      if (this.cmdState === 'thinking') return '正在理解你的指令…'
      if (this.cmdState === 'running') return '正在应用改动…'
      if (this.cmdState === 'error') return this.cmdError || '这条指令没能执行'
      return this.cmdSay || this.cmdSummary || '已应用'
    },
    showSuggest() {
      return this.inputMode === 'command' && this.inputFocused && !this.keyword && !this.cmdBusy
    },
    /** 渲染用的卡片列表：编辑态只排内置卡（AI 卡可单独移除），平时看所有可见卡 */
    renderCards() {
      const cs = (this.doc && this.doc.cards) || []
      if (!this.editing) return cs.filter(c => c.visible !== false)
      return cs.filter(c => c.builtin && c.visible !== false)
    },
    searchTitle() {
      if (this.results.length) return '本地词库 · 命中 ' + this.results.length + ' 条'
      if (this.cached) return '缓存结果'
      if (this.aiLoading) return 'AI 补充中'
      if (this.aiResult) return 'AI 补充结果'
      return '没有找到'
    },
    /** AI 补充结果的角标：以前会顺手写进词书，现在只落本机缓存 */
    aiBadge() {
      return '本机缓存 · 未加入词书'
    }
  },
  onLoad() {
    this.refreshDoc()
  },
  onShow() {
    hideNativeTabBar()
    syncTabbar(this)
    // 词书在词库页切换后，回到首页自动刷新
    Object.assign(this, wordbook.homeOverview())
    this.sessionSize = this.loadSessionSize()
    const r = aiGateReason()
    this.aiReason = r
    this.aiEnabled = !r
    // 布局可能被「添加组件」改过，回到首页重新读一次
    this.refreshDoc()
    // 小组件（每日目标 / 打卡走势）是常驻实例，靠这个事件重新取数
    try { uni.$emit('home:refresh') } catch (e) {}
  },
  onHide() {
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = 0 }
    // 离开首页一律退出编辑态，保证回来时界面是简洁的
    this.editing = false
    this.sheetShow = false
    this.dragIndex = -1
    this.dragDy = 0
  },
  methods: {
    // ---------- 首页布局：顺序 / 收纳 / 拖拽 ----------
    // 唯一真相是 pageDoc.cards；homeLayout 只是模块注册表 + 老设置的兼容镜像
    refreshDoc() {
      try {
        this.doc = pageDoc.get()
      } catch (e) {
        this.doc = null
      }
      try {
        this.live = pageDoc.liveValues()
      } catch (e) {
        this.live = {}
      }
      this.layout = this.builtinIds()
      this.cmdCanUndo = pageCommand.canUndo()
    },
    builtinIds() {
      return ((this.doc && this.doc.cards) || []).filter(c => c.builtin).map(c => c.id)
    },
    /**
     * 内置卡在 doc.cards 里的下标序列：编辑态的拖拽下标要换算回真实下标。
     * 必须和 renderCards 的编辑态口径一致（只算可见的内置卡），否则收纳过卡片后会错位。
     */
    builtinIndexes() {
      const out = []
      ;((this.doc && this.doc.cards) || []).forEach((c, i) => {
        if (c.builtin && c.visible !== false) out.push(i)
      })
      return out
    },
    /** 内置结构的任何改动都要落盘，并回写 homeLayout 让老入口保持一致 */
    persistDoc(doc) {
      this.doc = doc
      pageDoc.save(doc)
      try { homeLayout.saveLayout(pageDoc.builtinOrder(doc)) } catch (e) { /* 兼容镜像写失败无碍 */ }
      this.layout = this.builtinIds()
    },
    has(id) {
      return this.layout.indexOf(id) >= 0
    },
    /** 每组题量：与练习页同源，均取当前词书的「每日练习通过」目标 */
    loadSessionSize() {
      try {
        const g = wordbook.getGoal(this.bookId || wordbook.currentBookId())
        const n = Number(g && g.practice) || 10
        return Math.max(5, Math.min(50, n))
      } catch (e) {
        return 10
      }
    },
    nameOf(id) {
      const m = homeLayout.moduleOf(id)
      return m ? m.name : id
    },
    toggleEdit() {
      this.editing = !this.editing
      if (!this.editing) this.sheetShow = false
      this.dragIndex = -1
      this.dragDy = 0
    },
    finishEdit() {
      this.editing = false
      this.sheetShow = false
      this.dragIndex = -1
      this.dragDy = 0
    },
    // 收纳区 = 注册表里「不在首页 / 已隐藏」的模块
    openSheet() {
      const cs = (this.doc && this.doc.cards) || []
      this.sheetList = homeLayout.MODULES.filter(m => {
        const hit = cs.find(c => c.id === m.id)
        return !hit || hit.visible === false
      })
      this.sheetShow = true
    },
    closeSheet() {
      this.sheetShow = false
    },
    stashModule(id) {
      const name = this.nameOf(id)
      const visible = ((this.doc && this.doc.cards) || []).filter(c => c.visible !== false)
      if (visible.length <= 1) {
        uni.showToast({ title: '至少保留一个组件', icon: 'none' })
        return
      }
      this.persistDoc(pageDoc.setVisible(this.doc, id, false))
      uni.showToast({ title: '已收纳「' + name + '」', icon: 'none' })
    },
    restoreModule(id) {
      const name = this.nameOf(id)
      const cards = (this.doc && this.doc.cards) || []
      if (cards.some(c => c.id === id)) {
        this.persistDoc(pageDoc.setVisible(this.doc, id, true))
      } else {
        // 从未上过首页的模块：补一张内置卡进去
        const next = Object.assign({}, this.doc, {
          cards: cards.concat([pageDoc.__builtin(id)])
        })
        this.persistDoc(next)
      }
      uni.showToast({ title: '已添加「' + name + '」', icon: 'none' })
    },
    // 拖拽：把"记录起点 + 量各模块高度"抽成公共入口，触摸 / 鼠标两条路共用
    beginDrag(i, clientY) {
      this.dragIndex = i
      this.dragStartY = typeof clientY === 'number' ? clientY : 0
      this.dragDy = 0
      this.dragHeights = []
      try {
        const q = uni.createSelectorQuery().in(this)
        q.selectAll('.mod-wrap').boundingClientRect()
        q.exec(res => {
          const arr = (res && res[0]) || []
          this.dragHeights = arr.map(r => (r && r.height) || 0)
        })
      } catch (err) {
        this.dragHeights = []
      }
    },
    dragStart(i, e) {
      if (!this.editing) return
      const t = (e && e.touches && e.touches[0]) || {}
      this.beginDrag(i, t.clientY)
    },
    // H5 桌面浏览器没有 touch 事件（用户用鼠标），补一条 mouse 路径；
    // App 端逻辑层没有 document，自动跳过
    dragStartMouse(i, e) {
      if (!this.editing) return
      if (typeof document === 'undefined') return
      if (e && e.preventDefault) e.preventDefault()
      this.beginDrag(i, e ? e.clientY : 0)
      const mm = (ev) => {
        this.dragDy = (ev && typeof ev.clientY === 'number' ? ev.clientY : 0) - this.dragStartY
      }
      const mu = () => {
        document.removeEventListener('mousemove', mm)
        document.removeEventListener('mouseup', mu)
        this.dragEnd()
      }
      document.addEventListener('mousemove', mm)
      document.addEventListener('mouseup', mu)
    },
    dragMove(e) {
      if (this.dragIndex < 0) return
      const t = (e && e.touches && e.touches[0]) || {}
      const y = typeof t.clientY === 'number' ? t.clientY : 0
      const dy = y - this.dragStartY
      // 只在同一屏内做小幅位移，避免拖出可视区
      this.dragDy = dy
    },
    dragEnd() {
      if (this.dragIndex < 0) return
      const from = this.dragIndex
      const hs = this.dragHeights
      const dy = this.dragDy
      const to = homeLayout.dropIndex(from, dy, hs)
      this.dragIndex = -1
      this.dragDy = 0
      this.dragStartY = 0
      if (to !== from) {
        // 编辑态渲染的是「内置卡子集」，下标要换算回 doc.cards 的真实下标
        const idx = this.builtinIndexes()
        const realFrom = idx[from]
        const realTo = idx[Math.max(0, Math.min(idx.length - 1, to))]
        if (realFrom != null && realTo != null && realFrom !== realTo) {
          this.persistDoc(pageDoc.moveCard(this.doc, realFrom, realTo))
        }
      }
    },
    wrapStyle(i) {
      if (this.dragIndex !== i) return ''
      return 'transform: translateY(' + this.dragDy + 'px); z-index: 30;'
    },
    /** 卡片样式覆盖：把 style.card / style.text 的结果转成 inline style */
    cardStyle(c) {
      const st = (c && c.style) || null
      if (!st) return ''
      const out = []
      if (st.bg) out.push('background:' + st.bg + ';')
      else if (st.opacity != null) out.push('background:rgba(var(--surface-rgb, 255,255,255), ' + st.opacity + ');')
      if (st.radius != null) out.push('border-radius:' + st.radius + 'rpx;')
      if (st.padding != null) out.push('padding:' + st.padding + 'rpx;')
      if (st.fontSize) out.push('font-size:' + st.fontSize + 'rpx;')
      if (st.fontWeight) out.push('font-weight:' + st.fontWeight + ';')
      if (st.color) out.push('color:' + st.color + ';')
      if (st.align) out.push('text-align:' + st.align + ';')
      if (st.serif) out.push('font-family:Georgia,"Times New Roman","PingFang SC",serif;')
      if (st.shadow === 'none') out.push('box-shadow:none;')
      if (st.shadow === 'lifted') out.push('box-shadow:0 18rpx 44rpx rgba(var(--shadow-rgb, 23,32,26), 0.14);')
      if (st.border === 'none') out.push('border:none;')
      if (st.border === 'bold') out.push('border:4rpx solid rgba(var(--brand-rgb, 46,107,255), 0.3);')
      return out.join('')
    },
    // 空处理：给 .stop 修饰符占位用（收纳按钮要挡住把手区的拖拽启动）
    noop() {},

    // ---------- 三个数据块 → 详情页 ----------
    goHistory() {
      if (this.editing) return
      uni.navigateTo({ url: '/pages/history/history' })
    },
    goReviewList() {
      if (this.editing) return
      uni.navigateTo({ url: '/pages/review-list/review-list' })
    },
    goStreak() {
      if (this.editing) return
      uni.navigateTo({ url: '/pages/streak/streak' })
    },

    startPractice() {
      if (this.editing) return
      uni.navigateTo({ url: '/pages/practice/practice?source=daily' })
    },
    goReview() {
      if (this.editing) return
      uni.navigateTo({ url: '/pages/practice/practice?source=review' })
    },
    goDrill() {
      if (this.editing) return
      if (!this.aiEnabled) {
        uni.showToast({ title: '请先在设置中完成 AI 配置（' + this.aiReason + '）', icon: 'none' })
        return
      }
      uni.navigateTo({ url: '/pages/practice/practice?source=drill' })
    },
    goBooks() {
      if (this.editing) return
      // 直接进入「更换词书」页（词库 tab 内也保留同款入口）
      uni.navigateTo({ url: '/pages/book-switch/book-switch' })
    },

    // ---------- 顶部输入：搜索 / 指令双模式 ----------
    onInputFocus() {
      this.inputFocused = true
    },
    onInputBlur() {
      this.inputFocused = false
    },

    /**
     * 模式键：手动在「搜 / AI」之间切换，并锁定。
     * 锁定后打字不再自动改判 —— 自动判定再准也有看走眼的时候，
     * 而"想查词却真的改了首页"比"想改首页却只搜了一下"难受得多。
     * 清空输入（clearSearch）即解锁，回到自动判定。
     */
    toggleMode(next) {
      const want = next === 'command' || next === 'search'
        ? next
        : (this.inputMode === 'command' ? 'search' : 'command')
      this.modeLocked = true
      this.inputMode = want
      // 切走的时候把另一侧的状态收干净，避免"搜索结果"和"指令结果"同时占屏
      if (want === 'command') {
        if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = 0 }
        this.searching = false
        this.results = []
        this.cached = null
        this.aiResult = null
        this.aiLoading = false
      } else {
        this.closeCmdBar()
      }
    },

    /**
     * 指令失败时的兜底：这句其实只是想查词 → 按原文重跑一次搜索。
     * 不要求用户重新输入，也不用手动切模式。
     */
    retryAsSearch() {
      const t = this.lastCmdText || this.keyword
      this.closeCmdBar()
      this.modeLocked = true
      this.inputMode = 'search'
      this.runSearch(t)
    },

    /** 反向兜底：搜索没结果 → 这句话其实是想让 AI 改页面 */
    retryAsCommand() {
      const t = this.lastQuery || this.keyword
      this.modeLocked = true
      this.inputMode = 'command'
      this.runCommand(t)
    },

    /**
     * 把任意来源的"输入值"抠成字符串。
     * 键盘回车在某些端给的不是字符串（可能是事件、可能是 { value }），
     * 以前直接 String(v) 就变成 "[object Object]" 被拿去搜索 —— 见 WORDISH 的注释。
     */
    pickText(v) {
      if (typeof v === 'string') return v
      if (v && typeof v === 'object') {
        if (typeof v.detail === 'string') return v.detail
        if (v.detail && typeof v.detail.value === 'string') return v.detail.value
        if (typeof v.value === 'string') return v.value
        if (typeof v.text === 'string') return v.text
      }
      if (typeof v === 'number') return String(v)
      return String(this.keyword || '')
    },

    // 回车 / 点左侧图标：走**界面上显示的那个**模式（所见即所得），
    // 只有显式前缀（/ : @ #）能盖过它 —— 前缀是用户当下最明确的表达
    onSubmit(v) {
      const raw = this.pickText(v)
      const d = intent.detect(raw)
      if (d.forced) this.inputMode = d.mode   // 前缀说了算，同时把界面同步过去
      const mode = this.inputMode
      if (mode === 'command') {
        this.lastCmdText = d.text
        this.runCommand(d.text)
      } else {
        this.runSearch(d.text || raw)
      }
    },
    useSuggestion(s) {
      this.keyword = s
      this.inputMode = 'command'
      this.modeLocked = true
      this.lastCmdText = s
      this.runCommand(s)
    },

    /**
     * 执行一条自然语言指令：
     *   模型 → 指令序列 → schema 校验 → 原子执行 → 落盘 → 撤销栈
     * 任一步失败都保持原页面不变（不可变对象的天然回退）。
     */
    async runCommand(text) {
      const input = String(text || '').trim()
      if (!input) return
      if (this.cmdRunning) return
      this.cmdRunning = true
      this.cmdState = 'thinking'
      // 走指令就把搜索结果收起来，别让两块内容同时占着屏幕
      if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = 0 }
      this.searching = false
      this.results = []
      this.cached = null
      this.aiResult = null
      this.aiLoading = false
      this.cmdSay = ''
      this.cmdSummary = ''
      this.cmdError = ''
      // doc 理论上 onLoad 就准备好了；万一为空就用当前存储值兜底，避免整条链路崩掉
      const base = this.doc || pageDoc.get()
      try {
        const r = await pageAgent.plan(input, base, { live: this.live })
        if (!r.ok || !r.commands.length) {
          this.cmdState = 'error'
          this.cmdError = r.error || r.say || '这个我还改不了'
          return
        }
        this.cmdState = 'running'
        const res = pageCommand.applyCommands(this.doc || pageDoc.get(), r.commands, { live: this.live })
        if (!res.ok) {
          // 原子回退：applyCommands 失败时返回的仍是原 doc，页面一个字节都没变
          this.cmdState = 'error'
          this.cmdError = res.reason || '指令没能应用'
          return
        }
        const summary = r.say || pageCommand.summaryOf(res.applied)
        this.doc = pageCommand.commit(res.doc, summary)
        this.cmdState = 'done'
        this.cmdSay = summary
        this.cmdSummary = pageCommand.summaryOf(res.applied)
        this.cmdError = res.error || ''
        this.cmdCanUndo = pageCommand.canUndo()
        this.layout = this.builtinIds()
        this.runEffects(res.effects)
      } catch (e) {
        this.cmdState = 'error'
        this.cmdError = (e && e.message) || '执行出错，已保持原样'
      } finally {
        this.cmdRunning = false
      }
    },

    /** effects 是"需要发请求 / 需要朗读"的二次动作，由页面侧异步完成 */
    async runEffects(effects) {
      const list = effects || []
      let needTheme = false
      for (const ef of list) {
        if (ef.kind === 'theme' || ef.kind === 'bg' || ef.kind === 'resetTheme') needTheme = true
        if (ef.kind === 'goal') this.sessionSize = this.loadSessionSize()
        if (ef.kind === 'speak' && ef.text) {
          try { speakAny(ef.text) } catch (e) { /* 朗读失败不影响其它 */ }
        }
        if (ef.kind === 'rewrite') await this.doRewrite(ef)
      }
      if (needTheme) {
        try { this.refreshAppTheme() } catch (e) { /* 全局 mixin 未挂载时忽略 */ }
      }
    },

    /** text.rewrite：再问一次模型，拿到文案后走一条 text.set 补上 */
    async doRewrite(ef) {
      const out = await pageAgent.rewrite(ef.origin, ef.tone, ef.instruction)
      if (!out) return
      const target = ef.targetId ? { id: ef.targetId } : { last: true }
      const res = pageCommand.applyCommands(this.doc, [
        { op: 'text.set', args: { target: target, value: out } }
      ], { live: this.live })
      if (!res.ok) return
      this.doc = pageCommand.commit(res.doc, '改写文案')
      this.cmdSummary = pageCommand.summaryOf(res.applied)
      this.cmdCanUndo = pageCommand.canUndo()
    },

    /** 撤销上一步：直接换回历史栈里最近的 pageDoc */
    undoLast() {
      const last = pageCommand.lastUndo()
      const d = pageCommand.undo()
      if (!d) { this.cmdCanUndo = false; return }
      this.doc = d
      this.layout = this.builtinIds()
      this.sessionSize = this.loadSessionSize()
      try { this.refreshAppTheme() } catch (e) { /* ignore */ }
      this.cmdState = 'done'
      this.cmdSay = '已撤销：' + ((last && last.summary) || '上一步改动')
      this.cmdSummary = ''
      this.cmdCanUndo = pageCommand.canUndo()
    },
    closeCmdBar() {
      this.cmdState = ''
      this.cmdSay = ''
      this.cmdSummary = ''
      this.cmdError = ''
    },

    // ---------- AI 造的卡片：交互回写 ----------
    onCardToggle(e) {
      const id = e && e.id
      const idx = e && e.index
      if (!id || idx == null) return
      const cards = ((this.doc && this.doc.cards) || []).map(c => {
        if (c.id !== id) return Object.assign({}, c)
        let touched = false
        const blocks = (c.blocks || []).map(b => {
          // e.index 是清单内的项下标：定位到第一个 checklist 块，改对应项
          if (touched || b.kind !== 'checklist' || !(b.items || [])[idx]) return Object.assign({}, b)
          touched = true
          return Object.assign({}, b, {
            items: b.items.map((it, j) => (j === idx ? Object.assign({}, it, { done: !it.done }) : it))
          })
        })
        return Object.assign({}, c, { blocks: blocks })
      })
      this.persistDoc(Object.assign({}, this.doc, { cards: cards }))
    },
    onCardRemove(e) {
      const id = e && e.id
      if (!id) return
      this.persistDoc(pageDoc.removeCard(this.doc, id))
      uni.showToast({ title: '已移除卡片', icon: 'none' })
    },
    onCardAction(e) {
      if (!e) return
      if (e.speak) {
        try { speakAny(e.speak) } catch (err) { /* ignore */ }
      }
      const map = {
        practice: '/pages/practice/practice?source=daily',
        review: '/pages/practice/practice?source=review',
        drill: '/pages/practice/practice?source=drill',
        library: '/pages/library/library',
        stats: '/pages/history/history',
        history: '/pages/history/history',
        streak: '/pages/streak/streak',
        wordbook: '/pages/book-switch/book-switch',
        speak: ''
      }
      const url = map[e.action]
      if (!url) return
      // 词库是 tabBar 页，navigateTo 打不开，必须走 switchTab
      if (TAB_PAGES.indexOf(url) >= 0) uni.switchTab({ url })
      else uni.navigateTo({ url })
    },

    // ---------- 顶部搜索 ----------
    onSearchInput(v) {
      const kw = this.pickText(v).trim()
      // 拦掉 "[object Object]" 这类把对象 String() 出来的垃圾：
      // 拿去搜会搜出怪东西，交给 AI 还会被写进词库
      if (!kw || JUNK_TEXT.test(kw)) { this.clearSearch(); return }
      this.keyword = kw
      if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = 0 }
      // 边打字边判意图：命中指令词就把输入框切成指令态，不再走查词。
      // 手动锁定后不再自动改判，但显式前缀（/ : @ #）依然能盖过锁定。
      const d = intent.detect(kw)
      if (d.forced || !this.modeLocked) this.inputMode = d.mode
      // 后面一律以「最终生效的模式」为准：手动锁定后 d.mode 可能和界面上的不一样
      const mode = this.inputMode
      if (mode === 'command') {
        this.searching = false
        this.results = []
        this.cached = null
        this.aiResult = null
        this.aiLoading = false
        return
      }
      this.searching = true
      this.lastQuery = kw
      this.cached = null
      this.aiResult = null
      this.aiLoading = false
      this.results = search.localSearch(this.bookId, kw)
      // 底层缓存里有这个词的话，即便没配 AI 也能离线翻出来看（不联网、不发请求）
      this.cached = this.results.length ? null : this.cacheHitFor(kw)
      // 本地没有 + 缓存也没有 + 已接入 AI → 稍等一下再自动补充（避免边打字边请求）
      if (!this.results.length && !this.cached && this.aiEnabled) {
        this.searchTimer = setTimeout(() => { this.aiLookup(kw) }, AI_DELAY)
      }
    },
    runSearch(v) {
      this.onSearchInput(this.pickText(v))
    },
    clearSearch() {
      if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = 0 }
      // 收起结果时让输入框失焦 → 顶栏胶囊动画还原成铺满态
      const nb = this.$refs && this.$refs.navbar
      if (nb && nb.blurInput) nb.blurInput()
      this.keyword = ''
      this.lastQuery = ''
      this.searching = false
      this.results = []
      this.cached = null
      this.aiResult = null
      this.aiLoading = false
      // 清空即解锁：下一次输入重新交给自动判定
      this.inputMode = 'search'
      this.modeLocked = false
      this.inputFocused = false
    },
    // 底层缓存命中：把之前生成过的释义 / 例句原样翻出来，不联网
    cacheHitFor(kw) {
      try {
        const w = aiCache.findWord(kw)
        if (!w) return null
        const ex = aiCache.sentencesOf(w.word)
        return {
          word: w.word,
          pos: w.pos || '',
          meaning: w.meaning || '',
          examples: ex.slice(0, 4).map(s => ({ en: s.en, zh: s.zh })),
          cached: true
        }
      } catch (e) {
        return null
      }
    },

    // AI 补充：拿到释义 → 只落本机缓存（explainWord 内部已写入）→ 展示给用户。
    // 不再自动写进任何词书：临时查一个词就被塞进核心词书，词库很快就脏了。
    async aiLookup(kw) {
      const q = this.pickText(kw).trim()
      if (!q) return
      // 最后一道闸：不像单词就不问 AI。
      // 否则 "[object Object]"、整段句子这类东西也会被送去生成，
      // 生成结果还会被写进词库 —— 词库里就会多一个莫名其妙的 "Object"
      if (!WORDISH.test(q)) return
      const hasCache = !!aiCache.findWord(q)
      // 没配 AI 且缓存也没有 → 直接放弃（不弹错误、不转圈）
      if (!this.aiEnabled && !hasCache) return
      this.aiLoading = true
      this.aiResult = null
      try {
        const r = await explainWord(q)
        const meaning = (r && r.meaningZh) || ''
        if (!meaning) throw new Error('empty')
        const examples = (r && r.examples) || []
        // 只展示、不入库：explainWord 内部已经把释义与例句写进 aiCache（本机缓存），
        // 词书是用户自己的地盘 —— 要不要收进去，由他在单词详情页点「加入词书」决定。
        // 以前这里会顺手 addWordToBook，导致搜过一次的词全塞进核心词书。
        this.aiResult = {
          word: (r && r.word) || q,
          pos: (r && r.pos) || '',
          meaning,
          examples
        }
      } catch (e) {
        this.aiResult = null
      } finally {
        this.aiLoading = false
      }
    },
    speakResult(e) {
      const w = e.currentTarget.dataset && e.currentTarget.dataset.w
      if (!w) return
      try { speakWord(dict.speakForm(w)) } catch (err) { speakWord(w) }
    },
    // 搜索结果 → 单词详情（与词库「词汇明细」共用同一页面）
    // 搜索命中的是"单词本身"，没有词条 id，所以只传 w + 当前词书
    openWord(it) {
      const w = String((it && it.w) || '').trim().toLowerCase()
      if (!w) return
      const url = '/pages/word-detail/word-detail?w=' + encodeURIComponent(w) +
        '&book=' + encodeURIComponent(String(this.bookId || ''))
      uni.navigateTo({ url })
    }
  }
}
</script>

<style>
/* ---------- AI 指令状态条 ---------- */
.cmd-bar {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
  padding: 18rpx 24rpx;
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  backdrop-filter: blur(12px) saturate(180%);
  border: 2rpx solid rgba(46, 107, 255, 0.28);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.28);
}

.cmd-bar.is-error {
  border-color: rgba(229, 72, 77, 0.3);
  border-color: rgba(229, 72, 77, 0.3);
}

.cmd-spin {
  width: 28rpx;
  height: 28rpx;
  flex-shrink: 0;
  margin-right: 16rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(23, 32, 26, 0.12);
  border: 4rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.12);
  border-top-color: #2e6bff;
  border-top-color: var(--brand, #2e6bff);
  animation: cmd-rotate 0.9s linear infinite;
}

@keyframes cmd-rotate {
  to { transform: rotate(360deg); }
}

.cmd-text {
  flex: 1;
  min-width: 0;
  font-size: 25rpx;
  line-height: 1.5;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.cmd-bar.is-error .cmd-text {
  color: #e5484d;
  color: var(--danger, #e5484d);
}

.cmd-undo {
  flex-shrink: 0;
  margin-left: 16rpx;
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.34);
  border-radius: 999rpx;
  padding: 6rpx 24rpx;
}

.cmd-undo:active { background: rgba(46, 107, 255, 0.12); background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }

.cmd-close {
  flex-shrink: 0;
  margin-left: 18rpx;
  font-size: 30rpx;
  line-height: 1;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  padding: 0 4rpx;
}

/* 指令示例胶囊：横向滚动，一行放得下就居中 */
.cmd-sug {
  white-space: nowrap;
  margin-bottom: 20rpx;
}

.cmd-chip {
  display: inline-block;
  margin-right: 14rpx;
  padding: 12rpx 26rpx;
  font-size: 23rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  backdrop-filter: blur(12px) saturate(180%);
  border: 2rpx solid rgba(46, 107, 255, 0.24);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.24);
  border-radius: 999rpx;
}

.cmd-chip:active { background: rgba(46, 107, 255, 0.12); background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }

/* 内置卡上 AI 加的批注与配图 */
.mod-note {
  display: block;
  margin-top: var(--app-gap, 12rpx);
  padding: 14rpx 18rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.08);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.08);
  border-radius: 14rpx;
}

.mod-image {
  display: block;
  width: 100%;
  height: 180rpx;
  margin-top: var(--app-gap, 12rpx);
  border-radius: 18rpx;
}

/* 搜索结果卡 */
.search-card { margin-bottom: 24rpx; }

.sr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18rpx;
}

.sr-title { font-size: 26rpx; font-weight: 600; color: #17201a; }
.sr-title { font-size: 26rpx; font-weight: 600; color: var(--ink-1, #17201a); }

.sr-close { font-size: 24rpx; color: #1d4fd8; color: var(--brand-strong, #1d4fd8); }

.sr-item {
  padding: 18rpx 0;
  border-top: 2rpx solid rgba(23, 32, 26, 0.07);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.sr-line { display: flex; align-items: baseline; }

.sr-word {
  font-size: 34rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.sr-pos { margin-left: 12rpx; font-size: 24rpx; color: #98a19b; }
.sr-pos { margin-left: 12rpx; font-size: 24rpx; color: var(--ink-3, #98a19b); }

.sr-src {
  margin-left: auto;
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.sr-mean {
  display: block;
  margin-top: 8rpx;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  line-height: 1.5;
}

.sr-tip {
  display: block;
  padding-top: 14rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.sr-state { padding: 24rpx 0 8rpx; text-align: center; }

.sr-state-text { display: block; font-size: 26rpx; color: #5a6560; }
.sr-state-text { display: block; font-size: 26rpx; color: var(--ink-2, #5a6560); }

.sr-state-hint {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  line-height: 1.6;
}

.sr-retry {
  display: inline-block;
  margin-top: 18rpx;
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.34);
  border-radius: 999rpx;
  padding: 8rpx 32rpx;
}

/* 没结果时的两个兜底动作：再试一次 AI 补充 / 当成指令重跑 */
.sr-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}

.sr-retry-cmd {
  margin-left: 16rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  border-color: rgba(23, 32, 26, 0.16);
  border-color: rgba(var(--neutral-rgb, 23, 32, 26), 0.16);
}

.sr-spinner {
  width: 40rpx;
  height: 40rpx;
  margin: 0 auto 16rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(23, 32, 26, 0.12);
  border: 4rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.12);
  border-top-color: #2e6bff;
  border-top-color: var(--brand, #2e6bff);
  animation: sr-spin 0.9s linear infinite;
}

@keyframes sr-spin {
  to { transform: rotate(360deg); }
}

.sr-ai { padding: 6rpx 0 4rpx; }

.sr-ex {
  margin-top: 14rpx;
  padding: 14rpx 18rpx;
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.75);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.75));
  border-radius: 16rpx;
}

.sr-ex-en {
  display: block;
  font-size: 28rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.5;
}

.sr-ex-zh { display: block; margin-top: 6rpx; font-size: 24rpx; color: #5a6560; }
.sr-ex-zh { display: block; margin-top: 6rpx; font-size: 24rpx; color: var(--ink-2, #5a6560); }

.sr-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18rpx;
}

.sr-badge {
  font-size: 22rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  border-radius: 999rpx;
  padding: 6rpx 20rpx;
}

.sr-speak {
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.34);
  border-radius: 999rpx;
  padding: 6rpx 26rpx;
}

/* 块 A：词书卡（已去掉看板娘头像，整体更简洁） */
.book-head-card {
  display: flex;
  align-items: center;
}

.book-info {
  flex: 1;
  min-width: 0;
}

.book-name {
  font-size: 32rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.book-progress-text {
  font-size: 24rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  margin-top: 6rpx;
}

.book-track {
  margin-top: 14rpx;
}

.book-sub {
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  margin-top: 8rpx;
}

.switch-link {
  flex-shrink: 0;
  font-size: 24rpx;
  color: #2e6bff;
  color: var(--brand, #2e6bff);
  padding-left: 20rpx;
}

/* 块 B：主行动区 */
.action-area {
  margin-top: 20rpx;
}

/* 主按钮略收一档，与次级按钮形成主次关系 */
.start-btn {
  height: 88rpx;
  font-size: 30rpx;
}

/* 次级按钮：并排的小胶囊，不再与主按钮等大 */
.mini-row {
  display: flex;
  margin-top: 14rpx;
}

.btn-mini {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  height: 72rpx;
  font-size: 26rpx;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  backdrop-filter: blur(12px) saturate(180%);
  border: 2rpx solid rgba(46, 107, 255, 0.28);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.28);
  border-radius: 999rpx;
  margin-right: 16rpx;
}

.btn-mini::after { border: none; }

.btn-mini:last-child { margin-right: 0; }

.btn-mini:active { background: rgba(46, 107, 255, 0.12); background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }

.entry-disabled {
  color: #b0b7b2 !important;
  border-color: rgba(23, 32, 26, 0.1) !important;
  border-color: rgba(var(--neutral-rgb, 23, 32, 26), 0.1) !important;
  background: rgba(255, 255, 255, 0.45) !important;
  background: #f7f8f7 !important;
}

.action-tip {
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  text-align: center;
}

/* 块 C：数据条 */
.stats-row {
  margin-top: 24rpx;
  display: flex;
  padding: 32rpx 0;
}

.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-num {
  font-size: 36rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.stat-num.warn {
  color: #f79009;
}

.stat-label {
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  margin-top: 6rpx;
}

/* 可点数据项：轻微按压反馈 */
.stat-item:active .stat-num { opacity: 0.6; }

/* ---------- 首页模块编辑（拖拽 / 收纳） ---------- */
.mod-list { position: relative; }

.mod-wrap { position: relative; }

.mod-wrap.is-editing {
  border-radius: 20rpx;
  background: rgba(46, 107, 255, 0.05);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.05);
  padding: 0 12rpx 12rpx;
  margin-bottom: 20rpx;
}

.mod-wrap.is-drag {
  opacity: 0.92;
  box-shadow: 0 12rpx 32rpx rgba(23, 32, 26, 0.16);
  box-shadow: 0 12rpx 32rpx rgba(var(--neutral-rgb, 23, 32, 26), 0.16);
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.86);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.86);
}

/* 编辑态：透明遮罩挡住模块内容，手柄行靠更高层级浮在它上面 */
.mod-shield {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 10;
}

.mod-bar {
  position: relative;
  z-index: 11;
  display: flex;
  align-items: center;
  padding: 14rpx 8rpx 12rpx;
  /* 把手区域内禁掉滚动手势，拖动时页面不会跟着滚；页面其他区域照常可滚 */
  touch-action: none;
  /* H5 桌面：鼠标提示可拖 */
  cursor: grab;
}

.mod-bar:active { cursor: grabbing; }

.mod-grip {
  display: flex;
  align-items: center;
  margin-right: 14rpx;
  flex-shrink: 0;
}

.grip-lines {
  display: flex;
  flex-direction: column;
  margin-right: 10rpx;
}

.grip-line {
  width: 30rpx;
  height: 4rpx;
  border-radius: 4rpx;
  background: #98a19b;
  background: var(--ink-3, #98a19b);
  margin: 4rpx 0;
}

.grip-text {
  font-size: 20rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  letter-spacing: 1rpx;
}

.mod-name {
  flex: 1;
  font-size: 24rpx;
  font-weight: 600;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  letter-spacing: 1rpx;
}

.mod-hide {
  font-size: 24rpx;
  color: #e5484d;
  padding: 8rpx 20rpx;
  border: 2rpx solid rgba(229, 72, 77, 0.3);
  border-radius: 999rpx;
}

.mod-hide:active { background: rgba(229, 72, 77, 0.1); }

/* 模块间距跟着「密度」走（theme.set{density} 下发 --app-gap） */
.mod-widget { margin-top: var(--app-gap, 24rpx); }

/* 底部操作行 */
.home-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 28rpx;
  margin-bottom: 40rpx;
}

.foot-btn {
  height: 76rpx;
  min-width: 220rpx;
  padding: 0 40rpx;
  margin: 0 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 27rpx;
  font-weight: 500;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  border-radius: 999rpx;
}

.foot-btn.primary {
  color: #ffffff;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
}

.foot-btn.primary:active { opacity: 0.86; }

.foot-btn.ghost {
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  backdrop-filter: blur(12px) saturate(180%);
  border: 2rpx solid rgba(46, 107, 255, 0.28);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.28);
}

.foot-btn.ghost:active {
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
}

.foot-link {
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  padding: 12rpx 32rpx;
}

.foot-link:active { opacity: 0.6; }

/* 空态 */
.home-empty { padding: 60rpx 0; text-align: center; }

.home-empty-text {
  display: block;
  font-size: 28rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.home-empty-link {
  display: inline-block;
  margin-top: 20rpx;
  font-size: 26rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

/* ---------- 收纳区面板 ---------- */
.sheet-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 900;
  background: rgba(23, 32, 26, 0.35);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.35);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.sheet {
  background: #ffffff;
  background: var(--surface, #ffffff);
  border-radius: 28rpx 28rpx 0 0;
  padding: 28rpx 32rpx 40rpx;
  max-height: 70vh;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}

.sheet-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

.sheet-close {
  font-size: 25rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.sheet-body { max-height: 54vh; }

.sheet-item {
  display: flex;
  align-items: center;
  padding: 24rpx 0;
  border-top: 2rpx solid rgba(23, 32, 26, 0.07);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.sheet-info { flex: 1; min-width: 0; }

.sheet-name {
  display: block;
  font-size: 28rpx;
  font-weight: 500;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.sheet-desc {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  line-height: 1.5;
}

.sheet-add {
  flex-shrink: 0;
  margin-left: 20rpx;
  font-size: 24rpx;
  color: #ffffff;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  border-radius: 999rpx;
  padding: 10rpx 28rpx;
}

.sheet-add:active { opacity: 0.86; }

.sheet-empty { padding: 48rpx 0; text-align: center; }

.sheet-empty-text {
  font-size: 25rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
