<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="词库详情" />

    <!-- 分段切换 -->
    <view class="seg-bar">
      <view
        v-for="t in tabs"
        :key="t.key"
        class="seg-item"
        :class="{ active: tab === t.key }"
        :data-k="t.key"
        @tap="setTab"
      >{{ t.name }}</view>
    </view>

    <!-- 批次进度 -->
    <view v-if="tab === 'batch'">
      <view v-for="b in batches" :key="b.batchId" class="card batch-card">
        <view class="batch-head">
          <text class="batch-name">{{ b.name }}</text>
          <text class="batch-num">{{ b.mastered }}/{{ b.total }}</text>
        </view>
        <view class="progress-track">
          <view class="progress-fill" :style="{ width: batchPct(b) + '%' }"></view>
        </view>
        <view class="batch-foot">
          <text v-if="b.unlocked">已掌握 {{ batchPct(b) }}%</text>
          <text v-else class="locked">完成上一批 70% 后解锁</text>
        </view>
      </view>
      <view v-if="batches.length === 0" class="empty">
        {{ batchless ? '自建词书没有批次概念，词汇请见「词汇明细」' : '暂无批次' }}
      </view>
    </view>

    <!-- 词汇明细（仅当前词书） -->
    <view v-if="tab === 'vocab'">
      <view class="scope-line">
        <text class="scope-tag">当前词书</text>
        <text class="scope-name">{{ curBookName }}</text>
        <text class="scope-count">共 {{ bookWordTotal }} 词</text>
      </view>

      <!-- 空词书：不展示搜索/筛选/列表，直接引导去导入 -->
      <view v-if="bookWordTotal === 0" class="empty-block">
        <text class="empty-title">当前词书还没有词汇</text>
        <text class="empty-desc">到「导入单词」粘贴内容，或用 AI 生成</text>
        <button class="btn-primary empty-go" @tap="goImport">去导入单词</button>
      </view>

      <block v-else>
        <view class="search-box">
          <input
            class="search-input"
            placeholder="搜索单词或释义"
            :value="keyword"
            @input="onSearch"
            confirm-type="search"
          />
          <text v-if="keyword" class="search-clear" @tap="clearSearch">清除</text>
        </view>

        <scroll-view scroll-x class="filter-bar" enhanced :show-scrollbar="false">
          <view
            v-for="item in filters"
            :key="item.key"
            class="filter-item"
            :class="{ active: filter === item.key }"
            :data-k="item.key"
            @tap="setFilter"
          >{{ item.name }}</view>
        </scroll-view>

        <view v-if="list.length === 0" class="empty">该分类下暂无词汇</view>
        <view
          v-for="item in pagedList"
          :key="item.id"
          class="card word-item"
          @tap="openWord(item)"
        >
          <view class="word-head">
            <view class="word-main">
              <text class="word-text">{{ item.w }}</text>
              <text class="word-pos">{{ item.pos }}</text>
            </view>
            <text class="tag lv-tag">Lv{{ item.lv }}</text>
            <text class="tag status-tag" :class="'s-' + item.status">{{ item.statusName }}</text>
            <text class="ai-explain" :class="{ disabled: !aiEnabled }" :data-w="item.w" @tap.stop="explainWord">AI 释义</text>
            <text class="fav-star" :class="{ on: isFav(item) }" @tap.stop="toggleFav(item)">{{ isFav(item) ? '★' : '☆' }}</text>
          </view>
          <view class="word-mean">{{ item.m }}</view>
          <view class="word-foot">
            <view class="progress-track word-track">
              <view class="progress-fill" :style="{ width: item.pct + '%' }"></view>
            </view>
            <text class="word-times">{{ item.seen ? '练' + item.seen + '次 · 对' + item.correct + '次' : '尚未练习' }}</text>
          </view>
        </view>

        <view v-if="hasMore" class="more-btn" @tap="loadMore">加载更多（剩余 {{ restCount }} 个）</view>
      </block>
    </view>

    <!-- 导入单词 -->
    <view v-if="tab === 'import'" class="card import-card">
      <view class="target-row">
        <text class="target-label">归入词书</text>
        <view class="chips">
          <view
            v-for="o in bookOptions"
            :key="o.id"
            class="chip"
            :class="{ active: targetBook === o.id }"
            @tap="targetBook = o.id"
          >{{ o.name }}</view>
        </view>
      </view>

      <!-- 生成条件：主题 + 数量（下面两种生成方式共用） -->
      <view class="ai-form">
        <view class="form-title">生成条件</view>
        <view class="ai-gen-row">
          <input
            class="ai-gen-input"
            :value="aiTopic"
            placeholder="输入主题，如：商务英语高频词 / 福建专升本核心词"
            @input="e => aiTopic = e.detail.value"
          />
        </view>

        <!-- 数量：自定义输入 + 预设胶囊 / 不限（分两行，避免窄屏挤掉输入框） -->
        <view class="cnt-head">
          <text class="cnt-label">数量</text>
          <view class="cnt-custom">
            <input
              class="cnt-input"
              type="number"
              :value="aiCountInput"
              placeholder="自定义"
              maxlength="4"
              @input="onCountInput"
              @blur="normalizeCountInput"
            />
            <text class="cnt-unit">词</text>
          </view>
        </view>
        <view class="cnt-chips">
          <view
            v-for="n in countPresets"
            :key="n"
            class="cnt-chip"
            :class="{ active: aiCountMode === 'fixed' && aiCount === n }"
            :data-n="n"
            @tap="setCountPreset"
          >{{ n }}</view>
          <view
            class="cnt-chip"
            :class="{ active: aiCountMode === 'auto' }"
            @tap="setCountAuto"
          >不限</view>
        </view>
        <view class="cnt-hint">{{ countHint }}</view>
      </view>

      <!-- 方式一：App 内 AI 直接生成（需已配置 AI，否则置灰） -->
      <view class="ai-gen" :class="{ disabled: !aiEnabled }">
        <view class="ai-gen-head">
          <text class="ai-gen-title">AI 生成词书</text>
          <text class="ai-gen-badge" :class="aiEnabled ? 'on' : 'off'">{{ aiEnabled ? '可用' : aiReason }}</text>
        </view>

        <!-- 落地方式：新建一本独立词书 / 并入现有词书 -->
        <view class="gen-modes">
          <view
            class="gen-mode"
            :class="{ active: genMode === 'new' }"
            data-m="new"
            @tap="setGenMode"
          >新建词书</view>
          <view
            class="gen-mode"
            :class="{ active: genMode === 'merge' }"
            data-m="merge"
            @tap="setGenMode"
          >并入现有词书</view>
        </view>

        <view class="ai-gen-row" v-if="genMode === 'new'">
          <input
            class="ai-gen-input"
            :value="aiBookName"
            placeholder="词书名称（留空则用 AI 起的名字）"
            @input="e => aiBookName = e.detail.value"
          />
        </view>

        <view class="ai-gen-target">{{ genTargetText }}</view>

        <!-- 生成中：进度 + 暂停 / 停止；空闲：原来的生成按钮 -->
        <view v-if="taskBusy" class="gen-progress">
          <view class="gp-line">{{ task.message || '处理中…' }}</view>
          <view class="progress-track gp-track" v-if="taskProgress > 0">
            <view class="progress-fill" :style="{ width: taskProgress + '%' }"></view>
          </view>
          <view class="gp-hint">可离开本页，生成会在后台继续</view>
        </view>

        <view class="gen-actions">
          <button
            v-if="taskBusy"
            class="btn-primary ai-gen-btn"
            @tap="togglePause"
          >{{ taskPaused ? '继续生成' : '暂停' }}</button>
          <button
            v-if="taskBusy"
            class="btn-ghost gen-btn-stop"
            @tap="stopGen"
          >停止生成</button>
          <button
            v-else
            class="btn-primary ai-gen-btn"
            :class="{ disabled: !canGen }"
            :disabled="!canGen"
            @tap="aiGenerate"
          >{{ genBtnText }}</button>
        </view>
        <view class="ai-gen-note">{{ genNoteText }}</view>

        <!-- 生成结果（来自后台任务快照，在别的页面跑完回来也能看到） -->
        <view v-if="task.resultText" class="gen-result">
          <view class="gen-result-line">{{ task.resultText }}</view>
          <view class="gen-switch" v-if="task.resultBookId" @tap="switchToBook(task.resultBookId)">立即切换到该词书 ›</view>
          <view class="gen-reset" v-if="!taskBusy" @tap="resetTask">知道了</view>
        </view>
      </view>

      <!-- 方式二：外部 AI（豆包 / DeepSeek / 网页版）—— 一键生成提示词，无需任何配置 -->
      <view class="ext-gen">
        <view class="ai-gen-head">
          <text class="ai-gen-title">用外部 AI 生成</text>
          <text class="ai-gen-badge on">无需配置</text>
        </view>
        <view class="ext-desc">
          没配置 API 也能用：生成提示词 → 粘贴到豆包 / DeepSeek / 网页版 ChatGPT →
          把返回的词表粘回下方输入框 → 点「解析并导入」。
        </view>

        <button class="btn-ghost ext-btn" @tap="buildPrompt">一键生成提示词</button>

        <block v-if="promptText">
          <textarea
            class="prompt-box"
            :value="promptText"
            placeholder=""
            auto-height
            maxlength="2000"
            :show-confirm-bar="false"
          />
          <view class="ext-actions">
            <button class="btn-ghost ext-btn" @tap="copyPrompt">复制提示词</button>
            <text class="ext-tip">复制后粘贴到任意 AI 对话里即可</text>
          </view>
        </block>
      </view>

      <view class="divider"><text class="divider-text">粘贴词表</text></view>

      <textarea
        class="import-input"
        placeholder="粘贴从其他背单词软件分享的内容，支持 JSON / CSV / 逐行文本（如：inevitable /ɪnˈevɪtəbl/ adj. 不可避免的）"
        :value="importText"
        @input="e => importText = e.detail.value"
        auto-height
        maxlength="5000"
      />
      <view class="import-actions">
        <button class="btn-ghost paste-btn" @tap="pasteFromClipboard">粘贴</button>
        <button class="btn-primary import-btn" @tap="runImport" :disabled="!importText.trim() || importing">
          {{ importing ? '处理中…' : '解析并导入' }}
        </button>
      </view>
      <view v-if="result" class="result-box">
        <view class="result-line">解析 {{ result.parsed }} 条 · 新增 {{ result.added }} 词 · 跳过 {{ result.rejected.length }} 条</view>
        <view v-for="(r, i) in result.rejected.slice(0, 6)" :key="i" class="result-reason">{{ r.word }}：{{ r.reason }}</view>
        <view class="result-line" v-if="result.examples">已自动生成例句 {{ result.examples.filter(x => x.en).length }} 条</view>
      </view>
    </view>

    <!-- 每日目标（按词书维度，切书互不干扰） -->
    <view v-if="tab === 'goal'" class="card goal-card">
      <view class="goal-head">
        <view class="goal-info">
          <text class="goal-title">每日目标</text>
          <text class="goal-sub">{{ curBookName }} · 与其他词书互不影响</text>
        </view>
        <switch :checked="goal.enabled" color="#2e6bff" @change="onGoalEnabled" />
      </view>

      <view class="goal-body" :class="{ off: !goal.enabled }">
        <view class="gi-head">
          <text class="gi-name">每日新词</text>
          <text class="gi-hint">当天首次接触即计入</text>
        </view>
        <view class="gi-ctrl">
          <text class="gi-step" data-k="newWords" data-d="-5" @tap="stepGoal">−</text>
          <input
            class="gi-input"
            type="number"
            :value="goalInput.newWords"
            data-k="newWords"
            @input="onGoalInput"
            @blur="commitGoal"
          />
          <text class="gi-step" data-k="newWords" data-d="5" @tap="stepGoal">＋</text>
        </view>
        <view class="gi-chips">
          <text
            v-for="n in goalPresets"
            :key="n"
            class="gi-chip"
            :class="{ on: goal.newWords === n }"
            data-k="newWords"
            :data-n="n"
            @tap="setGoalPreset"
          >{{ n }}</text>
        </view>
        <view class="progress-track gi-track">
          <view class="progress-fill" :class="{ full: gp.newWords.reached }" :style="{ width: gp.newWords.pct + '%' }"></view>
        </view>
        <text class="gi-foot">今天新词 {{ gp.newWords.done }} / {{ gp.newWords.target }}</text>

        <view class="gi-head gi-head-2">
          <text class="gi-name">每日练习通过</text>
          <text class="gi-hint">答对即通过，错题重练也算</text>
        </view>
        <view class="gi-ctrl">
          <text class="gi-step" data-k="practice" data-d="-5" @tap="stepGoal">−</text>
          <input
            class="gi-input"
            type="number"
            :value="goalInput.practice"
            data-k="practice"
            @input="onGoalInput"
            @blur="commitGoal"
          />
          <text class="gi-step" data-k="practice" data-d="5" @tap="stepGoal">＋</text>
        </view>
        <view class="gi-chips">
          <text
            v-for="n in goalPresets"
            :key="n"
            class="gi-chip"
            :class="{ on: goal.practice === n }"
            data-k="practice"
            :data-n="n"
            @tap="setGoalPreset"
          >{{ n }}</text>
        </view>
        <view class="progress-track gi-track">
          <view class="progress-fill" :class="{ full: gp.practice.reached }" :style="{ width: gp.practice.pct + '%' }"></view>
        </view>
        <text class="gi-foot">今天通过 {{ gp.practice.done }} / {{ gp.practice.target }} 题</text>
      </view>

      <view class="goal-note">
        目标只对当前词书生效；首页的「每日目标」组件会实时显示完成度。
      </view>
    </view>

    <!-- AI 释义弹窗 -->
    <view class="pop-mask" v-if="explain.show" @tap="closeExplain">
      <view class="pop-card" @tap.stop="noop">
        <view class="ex-head">
          <view class="ex-word">{{ explain.word }}</view>
          <text class="ex-pos" v-if="explain.pos">{{ explain.pos }}</text>
        </view>
        <view v-if="explain.loading" class="ex-loading">
          <view class="loading-spinner small"></view>
          <text class="ex-loading-text">AI 正在生成释义…</text>
        </view>
        <block v-else-if="explain.error">
          <view class="ex-error">{{ explain.error }}</view>
        </block>
        <block v-else>
          <view class="ex-mean">{{ explain.meaning }}</view>
          <view class="ex-examples" v-if="explain.examples.length">
            <view v-for="(ex, i) in explain.examples" :key="i" class="ex-item">
              <text class="ex-en">{{ ex.en }}</text>
              <text class="ex-zh">{{ ex.zh }}</text>
            </view>
          </view>
          <view class="ex-cache" v-if="explain.fromCache">（已缓存，免联网）</view>
        </block>
        <view class="pop-replay" @tap="closeExplain">关闭</view>
      </view>
    </view>

    <!-- 停止生成确认（统一弹窗，替代系统 showModal） -->
    <app-dialog
      :show="confirm.show"
      :title="confirm.title"
      :content="confirm.content"
      :confirm-text="confirm.confirmText"
      :danger="true"
      @confirm="onConfirmYes"
      @cancel="confirm.show = false"
    />
  </view>
</template>

<script>
import * as wordbook from '../../utils/wordbook'
import * as importer from '../../utils/importer'
import * as task from '../../utils/wordbook-task'
import * as settings from '../../utils/settings'
import * as sync from '../../services/account-sync'
import { aiGateReason } from '../../services/config.js'
import { explainWord, generateWordbook, WORDBOOK_COUNT } from '../../services/ai-content.js'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../components/app-dialog/app-dialog.vue'

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      tab: 'batch',
      tabs: [
        { key: 'batch', name: '批次进度' },
        { key: 'vocab', name: '词汇明细' },
        { key: 'import', name: '导入单词' },
        { key: 'goal', name: '每日目标' }
      ],
      // 批次
      batches: [],
      curBookId: '',
      curBookName: '',
      batchless: false,
      // 词汇
      filter: 'all',
      filters: [
        { key: 'all', name: '全部' },
        { key: 'new', name: '新词' },
        { key: 'learning', name: '学习中' },
        { key: 'familiar', name: '熟悉' },
        { key: 'mastered', name: '已掌握' }
      ],
      counts: { new: 0, learning: 0, familiar: 0, mastered: 0 },
      list: [],
      bookWordTotal: 0,
      keyword: '',
      page: 1,
      pageSize: 60,
      favSet: {},
      // 导入
      bookOptions: [],
      targetBook: '',
      importText: '',
      importing: false,
      result: null,
      // AI 生成词书
      aiTopic: '',
      aiBookName: '',
      genMode: 'new',
      genResult: null,
      // 数量选择：'fixed' 自定义 / 'auto' 不限（取到模型给不出新词为止）
      aiCountMode: 'fixed',
      aiCountInput: '20',
      countPresets: [20, 50, 100],
      aiGenerating: false,
      genStatus: '生成中…',
      // 后台生成任务的状态快照（由 utils/wordbook-task 推送）
      task: { status: 'idle', phase: '', message: '', got: 0, target: 0, exDone: 0, exTotal: 0, added: 0 },
      // 外部 AI：一键生成的提示词
      promptText: '',
      aiEnabled: false,
      aiReason: '',
      // 每日目标（当前词书）
      goal: { enabled: true, newWords: 20, practice: 10 },
      goalInput: { newWords: '20', practice: '10' },
      goalPresets: [10, 20, 30, 50],
      gp: {
        enabled: true,
        newWords: { done: 0, target: 20, pct: 0, reached: false },
        practice: { done: 0, target: 10, pct: 0, reached: false },
        today: { total: 0, correct: 0 }
      },
      // 统一确认弹窗
      confirm: { show: false, title: '', content: '', confirmText: '确定', action: '' },
      explain: { show: false, loading: false, word: '', pos: '', meaning: '', examples: [], error: '', fromCache: false }
    }
  },
  computed: {
    filtered() {
      const kw = String(this.keyword || '').trim().toLowerCase()
      if (!kw) return this.list
      return this.list.filter(it =>
        String(it.w).toLowerCase().indexOf(kw) >= 0 ||
        String(it.m).toLowerCase().indexOf(kw) >= 0
      )
    },
    pagedList() {
      return this.filtered.slice(0, this.page * this.pageSize)
    },
    hasMore() {
      return this.filtered.length > this.pagedList.length
    },
    restCount() {
      return this.filtered.length - this.pagedList.length
    },
    // 归一后的数量：不限时为 0（服务层约定 0 = 不限）
    aiCount() {
      if (this.aiCountMode === 'auto') return 0
      const raw = String(this.aiCountInput || '').replace(/[^\d]/g, '')
      const n = Math.floor(Number(raw))
      if (!isFinite(n) || n < 1) return 1
      return Math.min(500, n)
    },
    countHint() {
      if (this.aiCountMode === 'auto') {
        return '不限：持续生成，直到这个主题的词全部取完'
      }
      return '可直接输入任意数量'
    },
    canGen() {
      return this.aiEnabled && !!String(this.aiTopic || '').trim() && !this.taskBusy
    },
    targetBookName() {
      const o = this.bookOptions.find(x => x.id === this.targetBook)
      return o ? o.name : this.targetBook
    },
    // 后台任务（退出页面后仍在跑，回到页面按快照恢复 UI）
    taskBusy() {
      const s = this.task.status
      return s === 'running' || s === 'paused'
    },
    taskPaused() {
      return this.task.status === 'paused'
    },
    // 进度百分比：生成阶段按词数，例句阶段按例句条数
    taskProgress() {
      const t = this.task
      if (t.phase === 'gen') {
        const total = t.target || t.count || 0
        if (!total) return 0
        return Math.min(99, Math.round((t.got / total) * 100))
      }
      if (t.phase === 'examples') {
        if (!t.exTotal) return 0
        return Math.min(99, Math.round((t.exDone / t.exTotal) * 100))
      }
      return 0
    },
    genNoteText() {
      return this.aiCountMode === 'auto'
        ? '「不限」会分多轮持续生成，直到这个主题的词全部取完；词量越大耗时越长。生成后自动去重并补例句（本地保存）'
        : '生成后自动去重校验，并为每个词生成例句（本地保存，不依赖云端）'
    },
    genTargetText() {
      return this.genMode === 'new'
        ? '将新建一本独立词书，可在「更换词书」中切换'
        : '将并入上方的「' + this.targetBookName + '」'
    },
    genBtnText() {
      if (this.taskPaused) return '继续生成'
      if (this.taskBusy) return '生成中…'
      return this.genMode === 'new' ? 'AI 生成并新建词书' : 'AI 生成并存入本地'
    }
  },
  onLoad(opts) {
    const t = opts && opts.tab
    if (t === 'vocab' || t === 'import' || t === 'batch' || t === 'goal') this.tab = t
  },
  onShow() {
    this.refresh()
    const r = aiGateReason()
    this.aiReason = r
    this.aiEnabled = !r
    // 回到页面：立刻同步一次后台任务状态，并订阅后续变更
    this.task = task.get()
    if (this.__unsub) { this.__unsub(); this.__unsub = null }
    this.__unsub = task.subscribe((s) => {
      this.task = s
      // 任务在别的页面跑完，回来时也能看到最新列表
      if (s.status === 'done' || s.status === 'stopped' || s.status === 'error') this.refresh()
    })
  },
  onUnload() {
    // 只取消订阅，不停止任务 —— 生成继续在后台跑
    if (this.__unsub) { this.__unsub(); this.__unsub = null }
  },
  methods: {
    setTab(e) {
      this.tab = e.currentTarget.dataset.k
    },
    goImport() {
      this.tab = 'import'
    },
    batchPct(b) {
      return Math.round((b.ratio || 0) * 100)
    },
    refresh() {
      const books = wordbook.listBooks()
      const cur = books.find(b => b.current) || books[0]
      this.curBookId = cur ? cur.id : ''
      this.curBookName = cur ? cur.name : ''
      this.batches = cur ? wordbook.getBookBatches(cur.id) : []
      this.batchless = wordbook.bookMode(cur ? cur.id : '') === 'custom'
      this.bookOptions = importer.bookOptions().concat(wordbook.listUserBooks().map(b => ({ id: b.id, name: b.name })))
      if (!this.targetBook && cur) this.targetBook = cur.id

      // 词汇明细严格按当前词书口径（内置词 + 该书导入词），空词书即为空
      const v = wordbook.bookVocab(cur ? cur.id : '', this.filter)
      this.list = v.list
      this.counts = v.counts
      this.bookWordTotal = v.total
      this.page = 1

      // 收藏状态
      const set = {}
      settings.favorites().forEach(f => { if (f.type === 'word') set[f.id] = true })
      this.favSet = set

      this.refreshGoal()
    },

    // ---------- 每日目标 ----------
    refreshGoal() {
      try {
        this.goal = wordbook.getGoal(this.curBookId || '')
        this.goalInput = {
          newWords: String(this.goal.newWords),
          practice: String(this.goal.practice)
        }
        this.gp = wordbook.goalProgress(this.curBookId || '')
      } catch (e) {
        /* 目标读取失败不影响其他功能 */
      }
    },
    onGoalEnabled(e) {
      const v = !!(e && e.detail && e.detail.value)
      try { wordbook.setGoal(this.curBookId || '', { enabled: v }) } catch (err) {}
      this.refreshGoal()
    },
    onGoalInput(e) {
      const ds = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset : {}
      const k = ds.k
      if (k !== 'newWords' && k !== 'practice') return
      const raw = String((e && e.detail && e.detail.value) || '').replace(/[^\d]/g, '').slice(0, 3)
      const obj = Object.assign({}, this.goalInput)
      obj[k] = raw
      this.goalInput = obj
      return raw
    },
    commitGoal(e) {
      const ds = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset : {}
      const k = ds.k
      if (k !== 'newWords' && k !== 'practice') return
      this.applyGoal(k, this.goalInput[k])
    },
    stepGoal(e) {
      const ds = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset : {}
      const k = ds.k
      if (k !== 'newWords' && k !== 'practice') return
      const d = Number(ds.d) || 0
      this.applyGoal(k, this.goal[k] + d)
    },
    setGoalPreset(e) {
      const ds = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset : {}
      const k = ds.k
      if (k !== 'newWords' && k !== 'practice') return
      const n = Number(ds.n) || 0
      this.applyGoal(k, n)
    },
    applyGoal(k, v) {
      const cfg = wordbook.GOAL[k]
      let n = Math.floor(Number(v))
      if (!isFinite(n)) n = cfg.def
      n = Math.max(cfg.min, Math.min(cfg.max, n))
      const patch = {}
      patch[k] = n
      try { wordbook.setGoal(this.curBookId || '', patch) } catch (err) {}
      this.refreshGoal()
    },
    // 词汇
    setFilter(e) {
      this.filter = e.currentTarget.dataset.k
      this.page = 1
      this.refresh()
    },
    onSearch(e) {
      this.keyword = e.detail.value
      this.page = 1
    },
    clearSearch() {
      this.keyword = ''
      this.page = 1
    },
    loadMore() {
      this.page = this.page + 1
    },
    isFav(item) {
      return !!this.favSet[item.id]
    },
    toggleFav(item) {
      const on = !!this.favSet[item.id]
      settings.toggleFavorite({ type: 'word', id: item.id, word: item.w, meaning: item.m })
      // 已登录：word_favorite 表同步（收藏→upsert，取消→软删除）
      if (on) sync.unmirrorFavorite('word', item.id)
      else sync.mirrorFavorite({ type: 'word', id: item.id, word: item.w, meaning: item.m })
      const set = Object.assign({}, this.favSet)
      if (set[item.id]) delete set[item.id]
      else set[item.id] = true
      this.favSet = set
    },
    // 词汇明细 → 单词详情（与首页搜索结果共用同一个页面）
    openWord(item) {
      if (!item || !item.w) return
      const w = encodeURIComponent(String(item.w).toLowerCase())
      const id = encodeURIComponent(String(item.id || ''))
      const book = encodeURIComponent(String(this.curBookId || ''))
      uni.navigateTo({ url: '/pages/word-detail/word-detail?w=' + w + '&id=' + id + '&book=' + book })
    },
    // AI 释义：命中缓存免联网；失败/未配置提示，不阻断
    async explainWord(e) {
      if (!this.aiEnabled) {
        uni.showToast({ title: '请先在设置中完成 AI 配置（' + this.aiReason + '）', icon: 'none' })
        return
      }
      const w = (e.currentTarget.dataset && e.currentTarget.dataset.w) || ''
      if (!w) return
      this.explain = { show: true, loading: true, word: w, pos: '', meaning: '', examples: [], error: '', fromCache: false }
      try {
        const r = await explainWord(w)
        this.explain = {
          show: true, loading: false, word: r.word || w, pos: r.pos || '',
          meaning: r.meaningZh || '', examples: r.examples || [], error: '', fromCache: !!r.fromCache
        }
      } catch (err) {
        this.explain = { show: true, loading: false, word: w, pos: '', meaning: '', examples: [], error: 'AI 释义暂不可用（请检查 AI 服务设置）', fromCache: false }
      }
    },
    closeExplain() {
      this.explain = { show: false, loading: false, word: '', pos: '', meaning: '', examples: [], error: '', fromCache: false }
    },
    noop() {},
    // 外部 AI（豆包 / DeepSeek 等）：按上方「生成条件」生成一段可直接粘贴的提示词
    buildPrompt() {
      const topic = String(this.aiTopic || '').trim()
      if (!topic) {
        uni.showToast({ title: '请先输入主题', icon: 'none' })
        return
      }
      try {
        this.promptText = importer.buildWordListPrompt({ topic, count: this.aiCount })
        uni.showToast({ title: '已生成，点「复制提示词」', icon: 'none' })
      } catch (e) {
        uni.showToast({ title: '生成失败', icon: 'none' })
      }
    },
    copyPrompt() {
      if (!this.promptText) return
      uni.setClipboardData({
        data: this.promptText,
        success: () => {
          uni.showToast({ title: '已复制提示词', icon: 'success' })
        },
        fail: () => {
          uni.showToast({ title: '复制失败，请长按选择文本', icon: 'none' })
        }
      })
    },
    // 导入
    pasteFromClipboard() {
      uni.getClipboardData({
        success: (res) => {
          this.importText = res.data || ''
          if (!this.importText) uni.showToast({ title: '剪贴板为空', icon: 'none' })
        }
      })
    },
    async runImport() {
      if (!this.importText.trim() || this.importing) return
      this.importing = true
      try {
        this.result = await importer.importPipeline(this.importText, this.targetBook)
        this.importText = ''
        this.refresh()
        uni.showToast({ title: '导入完成', icon: 'success' })
      } catch (e) {
        uni.showToast({ title: '导入失败', icon: 'none' })
      }
      this.importing = false
    },
    // AI 生成词书：AI 生成词表 → 本地去重校验 → （新建词书 / 并入现有词书）→ 自动补例句
    setCountPreset(e) {
      const n = Number(e.currentTarget.dataset.n) || WORDBOOK_COUNT.MIN
      this.aiCountMode = 'fixed'
      this.aiCountInput = String(n)
    },
    setCountAuto() {
      this.aiCountMode = 'auto'
    },
    onCountInput(e) {
      // 只保留数字，避免 maxlength / 输入法带进奇怪字符
      const v = String((e && e.detail && e.detail.value) || '').replace(/[^\d]/g, '').slice(0, 3)
      this.aiCountMode = 'fixed'
      this.aiCountInput = v
      return v
    },
    // 失焦时夹取到 1 ~ 500
    normalizeCountInput() {
      const raw = String(this.aiCountInput || '').replace(/[^\d]/g, '')
      let n = Math.floor(Number(raw))
      if (!isFinite(n)) n = 20
      if (n < WORDBOOK_COUNT.MIN) n = WORDBOOK_COUNT.MIN
      if (n > WORDBOOK_COUNT.MAX) n = WORDBOOK_COUNT.MAX
      this.aiCountInput = String(n)
    },
    setGenMode(e) {
      this.genMode = e.currentTarget.dataset.m
    },
    // 生成后立即切到新词书（用户可选，不强制）
    switchToBook(bookId) {
      if (!wordbook.isUserBook(bookId)) return
      wordbook.switchBook(bookId)
      this.genResult = null
      this.refresh()
      uni.showToast({ title: '已切换', icon: 'success' })
    },
    // AI 生成词书：交给后台任务（utils/wordbook-task），页面只发指令 + 显示状态
    async aiGenerate() {
      if (!this.aiEnabled) {
        uni.showToast({ title: '请先在设置中完成 AI 配置（' + this.aiReason + '）', icon: 'none' })
        return
      }
      const topic = String(this.aiTopic || '').trim()
      if (!topic) {
        uni.showToast({ title: '请先输入主题', icon: 'none' })
        return
      }
      if (task.isBusy()) {
        uni.showToast({ title: '有任务正在生成中', icon: 'none' })
        return
      }
      this.genResult = null
      const started = await task.start({
        topic,
        count: this.aiCount,
        mode: this.genMode,
        bookId: this.targetBook,
        bookName: String(this.aiBookName || '').trim()
      })
      if (!started) return
      this.task = task.get()
      this.aiTopic = ''
      this.aiBookName = ''
    },

    // 暂停 / 继续：任务在后台仍受控，退出页面也不会丢控制
    togglePause() {
      if (this.taskPaused) {
        task.resume()
        uni.showToast({ title: '已继续', icon: 'none' })
      } else {
        task.pause()
        uni.showToast({ title: '已暂停', icon: 'none' })
      }
      this.task = task.get()
    },

    stopGen() {
      this.confirm = {
        show: true,
        title: '停止生成',
        content: '已导入的词会保留（例句可稍后继续补），确定停止？',
        confirmText: '停止',
        action: 'stop'
      }
    },

    onConfirmYes() {
      const act = this.confirm.action
      this.confirm.show = false
      if (act === 'stop') {
        task.stop()
        this.task = task.get()
      }
    },

    // 看完结果就清掉，按钮回到初始态
    resetTask() {
      task.reset()
      this.task = task.get()
      this.genResult = null
    }
  }
}
</script>

<style>
/* 分段切换：胶囊轨道 + 胶囊滑块，呼应底部悬浮导航 */
.seg-bar {
  display: flex;
  background: rgba(255, 255, 255, 0.62);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.62);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 999rpx;
  padding: 8rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 6rpx 18rpx rgba(23, 32, 26, 0.05);
  box-shadow: 0 6rpx 18rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
}

.seg-item {
  flex: 1;
  text-align: center;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  padding: 14rpx 0;
  border-radius: 999rpx;
  transition: background 220ms ease, color 220ms ease;
}

.seg-item.active {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 4rpx 12rpx rgba(46, 107, 255, 0.24);
  box-shadow: 0 4rpx 12rpx rgba(var(--brand-rgb, 46, 107, 255), 0.24);
}

.batch-card { margin-bottom: 18rpx; }

.batch-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16rpx; }

.batch-name { font-size: 28rpx; font-weight: 600; }

.batch-num { font-size: 24rpx; color: #5a6560; }
.batch-num { font-size: 24rpx; color: var(--ink-2, #5a6560); }

.batch-foot { margin-top: 14rpx; font-size: 22rpx; color: #98a19b; }
.batch-foot { margin-top: 14rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.batch-foot .locked { color: #f79009; }

/* 搜索框：胶囊玻璃 */
.search-box {
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 999rpx;
  padding: 18rpx 28rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 6rpx 18rpx rgba(23, 32, 26, 0.05);
  box-shadow: 0 6rpx 18rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
}

/* 词书口径提示 */
.scope-line {
  display: flex;
  align-items: center;
  padding: 0 8rpx 18rpx;
}

.scope-tag {
  font-size: 20rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
  border-radius: 999rpx;
  padding: 3rpx 16rpx;
  flex-shrink: 0;
}

.scope-name {
  margin-left: 14rpx;
  font-size: 26rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.scope-count { font-size: 22rpx; color: #98a19b; flex-shrink: 0; margin-left: 16rpx; }
.scope-count { font-size: 22rpx; color: var(--ink-3, #98a19b); flex-shrink: 0; margin-left: 16rpx; }

/* 空词书引导块 */
.empty-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 100rpx 40rpx 60rpx;
}

.empty-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.empty-desc {
  margin-top: 14rpx;
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  text-align: center;
  line-height: 1.6;
}

.empty-go {
  margin-top: 40rpx;
  width: 60%;
  height: 84rpx;
  font-size: 28rpx;
}

.search-input { flex: 1; font-size: 28rpx; color: #17201a; }
.search-input { flex: 1; font-size: 28rpx; color: var(--ink-1, #17201a); }

.search-clear { font-size: 26rpx; color: #2e6bff; margin-left: 16rpx; flex-shrink: 0; }
.search-clear { font-size: 26rpx; color: var(--brand, #2e6bff); margin-left: 16rpx; flex-shrink: 0; }

.filter-bar { white-space: nowrap; margin-bottom: 24rpx; }

.filter-item {
  display: inline-block;
  padding: 14rpx 36rpx;
  margin-right: 16rpx;
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 999rpx;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  box-shadow: 0 4rpx 14rpx rgba(23, 32, 26, 0.05);
  box-shadow: 0 4rpx 14rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
  transition: background 200ms ease, color 200ms ease;
}

.filter-item.active { background: #2e6bff; color: #ffffff; font-weight: 700; }
.filter-item.active { background: #2e6bff; color: #ffffff; font-weight: 700; }
.filter-item.active { background: var(--brand, #2e6bff); color: #ffffff; font-weight: 700; }
.filter-item.active { background: var(--brand, #2e6bff); color: #ffffff; font-weight: 700; }

.empty { text-align: center; color: #98a19b; padding: 120rpx 0; font-size: 28rpx; }
.empty { text-align: center; color: var(--ink-3, #98a19b); padding: 120rpx 0; font-size: 28rpx; }

.word-item { margin-bottom: 18rpx; }

.word-head { display: flex; align-items: center; }

.word-main { flex: 1; }

.word-text {
  font-size: 36rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.word-pos { font-size: 24rpx; color: #98a19b; margin-left: 12rpx; }
.word-pos { font-size: 24rpx; color: var(--ink-3, #98a19b); margin-left: 12rpx; }

.lv-tag { background: rgba(23, 32, 26, 0.07); color: #5a6560; margin-right: 10rpx; }
.lv-tag { background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07); color: var(--ink-2, #5a6560); margin-right: 10rpx; }

.status-tag.s-mastered { background: rgba(46, 107, 255, 0.12); color: #1d4fd8; font-weight: 600; }
.status-tag.s-mastered { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); color: var(--brand-strong, #1d4fd8); font-weight: 600; }
.status-tag.s-familiar { background: rgba(124, 58, 237, 0.12); color: #7c3aed; font-weight: 600; }
.status-tag.s-learning { background: rgba(247, 144, 9, 0.14); color: #b54708; font-weight: 600; }
.status-tag.s-new { background: rgba(23, 32, 26, 0.07); color: #5a6560; }
.status-tag.s-new { background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07); color: var(--ink-2, #5a6560); }

.fav-star {
  font-size: 36rpx;
  color: #c8cdc9;
  margin-left: 14rpx;
  flex-shrink: 0;
  padding: 0 6rpx;
}

.fav-star.on { color: #f79009; }

/* AI 释义入口 */
.ai-explain {
  font-size: 22rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  border-radius: 999rpx;
  padding: 4rpx 18rpx;
  margin-left: 12rpx;
  flex-shrink: 0;
}

.ai-explain.disabled {
  color: #b0b7b2;
  background: rgba(23, 32, 26, 0.06);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
}

/* AI 释义弹窗：.pop-mask / .pop-card 统一见 App.vue 全局样式，这里只写内容类 */

.ex-head { display: flex; align-items: baseline; justify-content: center; }

.ex-word {
  font-size: 44rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.ex-pos { font-size: 24rpx; color: #98a19b; margin-left: 12rpx; }
.ex-pos { font-size: 24rpx; color: var(--ink-3, #98a19b); margin-left: 12rpx; }

.ex-loading { display: flex; align-items: center; justify-content: center; margin-top: 28rpx; }

.ex-loading-text { margin-left: 16rpx; font-size: 24rpx; color: #98a19b; }
.ex-loading-text { margin-left: 16rpx; font-size: 24rpx; color: var(--ink-3, #98a19b); }

.loading-spinner.small { width: 36rpx; height: 36rpx; border-width: 4rpx; border-top-color: #2e6bff; }
.loading-spinner.small { width: 36rpx; height: 36rpx; border-width: 4rpx; border-top-color: var(--brand, #2e6bff); }

.ex-mean { margin-top: 20rpx; font-size: 30rpx; line-height: 1.6; color: #5a6560; }
.ex-mean { margin-top: 20rpx; font-size: 30rpx; line-height: 1.6; color: var(--ink-2, #5a6560); }

.ex-examples { margin-top: 22rpx; text-align: left; }

.ex-item {
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 18rpx;
  padding: 16rpx 20rpx;
  margin-bottom: 14rpx;
}

.ex-en { display: block; font-size: 28rpx; color: #17201a; font-family: Georgia, "Times New Roman", serif; }
.ex-en { display: block; font-size: 28rpx; color: var(--ink-1, #17201a); font-family: Georgia, "Times New Roman", serif; }

.ex-zh { display: block; margin-top: 6rpx; font-size: 24rpx; color: #5a6560; }
.ex-zh { display: block; margin-top: 6rpx; font-size: 24rpx; color: var(--ink-2, #5a6560); }

.ex-cache { margin-top: 12rpx; font-size: 22rpx; color: #98a19b; }
.ex-cache { margin-top: 12rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.ex-error { margin-top: 24rpx; font-size: 26rpx; color: #f79009; }

.pop-replay {
  display: inline-block;
  margin-top: 32rpx;
  font-size: 28rpx;
  font-weight: 600;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.62);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.62);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  backdrop-filter: blur(12px) saturate(180%);
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.34);
  border-radius: 999rpx;
  padding: 12rpx 48rpx;
}

.word-mean { font-size: 28rpx; color: #5a6560; margin: 12rpx 0 18rpx; }
.word-mean { font-size: 28rpx; color: var(--ink-2, #5a6560); margin: 12rpx 0 18rpx; }

.word-foot { display: flex; align-items: center; }

.word-track { flex: 1; margin-right: 20rpx; }

.word-times { font-size: 22rpx; color: #98a19b; flex-shrink: 0; }
.word-times { font-size: 22rpx; color: var(--ink-3, #98a19b); flex-shrink: 0; }

.more-btn {
  text-align: center;
  font-size: 26rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  padding: 28rpx 0;
  margin-bottom: 24rpx;
}

.import-card { padding-bottom: 36rpx; }

.target-row { display: flex; align-items: flex-start; margin-bottom: 20rpx; }

.target-label { font-size: 26rpx; color: #5a6560; margin-right: 20rpx; flex-shrink: 0; }
.target-label { font-size: 26rpx; color: var(--ink-2, #5a6560); margin-right: 20rpx; flex-shrink: 0; }

.chips { display: flex; flex-wrap: wrap; }

/* 胶囊标签：与底部导航同一圆角语言 */
.chip {
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  font-size: 22rpx;
  border-radius: 999rpx;
  padding: 8rpx 24rpx;
  margin: 0 12rpx 12rpx 0;
  transition: background 200ms ease, color 200ms ease;
}

.chip.active { background: #2e6bff; color: #ffffff; font-weight: 600; border-color: #2e6bff; }
.chip.active { background: #2e6bff; color: #ffffff; font-weight: 600; border-color: #2e6bff; }
.chip.active { background: var(--brand, #2e6bff); color: #ffffff; font-weight: 600; border-color: var(--brand, #2e6bff); }
.chip.active { background: var(--brand, #2e6bff); color: #ffffff; font-weight: 600; border-color: var(--brand, #2e6bff); }

/* 生成条件（两种生成方式共用的主题 / 数量输入） */
.ai-form {
  background: rgba(255, 255, 255, 0.5);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.5);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 24rpx;
  padding: 22rpx 24rpx 12rpx;
  margin-bottom: 20rpx;
}

.form-title {
  font-size: 26rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
  margin-bottom: 16rpx;
}

.ai-gen {
  background: rgba(46, 107, 255, 0.07);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.07);
  border: 2rpx solid rgba(46, 107, 255, 0.18);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.18);
  border-radius: 24rpx;
  padding: 24rpx 24rpx 22rpx;
  margin-bottom: 8rpx;
}

.ai-gen.disabled {
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
  border-color: rgba(23, 32, 26, 0.1);
  border-color: rgba(var(--neutral-rgb, 23, 32, 26), 0.1);
}

.ai-gen-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18rpx; }

.ai-gen-title { font-size: 28rpx; font-weight: 600; color: #17201a; }
.ai-gen-title { font-size: 28rpx; font-weight: 600; color: var(--ink-1, #17201a); }

.ai-gen-badge {
  font-size: 20rpx;
  border-radius: 999rpx;
  padding: 3rpx 16rpx;
  flex-shrink: 0;
  margin-left: 16rpx;
}

.ai-gen-badge.on { color: #1d4fd8; background: rgba(46, 107, 255, 0.12); }
.ai-gen-badge.on { color: var(--brand-strong, #1d4fd8); background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }
.ai-gen-badge.off { color: #98a19b; background: rgba(23, 32, 26, 0.07); }
.ai-gen-badge.off { color: var(--ink-3, #98a19b); background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07); }

.ai-gen-row { display: flex; align-items: center; margin-bottom: 18rpx; }

/* 数量：第一行「数量 + 自定义输入」，第二行预设胶囊 */
.cnt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14rpx;
}

.cnt-label {
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.cnt-chips { display: flex; margin-bottom: 10rpx; }

.cnt-chip {
  min-width: 80rpx;
  text-align: center;
  font-size: 22rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 999rpx;
  padding: 8rpx 16rpx;
  margin-right: 10rpx;
  transition: background 200ms ease, color 200ms ease;
}

.cnt-chip.active { background: #2e6bff; color: #ffffff; font-weight: 600; border-color: #2e6bff; }
.cnt-chip.active { background: var(--brand, #2e6bff); color: #ffffff; font-weight: 600; border-color: var(--brand, #2e6bff); }

.cnt-custom { display: flex; align-items: center; }

.cnt-input {
  width: 150rpx;
  text-align: center;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 12rpx 16rpx;
  font-size: 25rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.cnt-unit {
  margin-left: 10rpx;
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.cnt-hint {
  font-size: 21rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  line-height: 1.5;
  margin-bottom: 18rpx;
}

/* 落地方式：新建 / 并入 */
/* 落地方式：胶囊轨道 + 胶囊滑块 */
.gen-modes {
  display: flex;
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 999rpx;
  padding: 6rpx;
  margin-bottom: 18rpx;
}

.gen-mode {
  flex: 1;
  text-align: center;
  font-size: 24rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  padding: 12rpx 0;
  border-radius: 999rpx;
  transition: background 200ms ease, color 200ms ease;
}

.gen-mode.active { background: #2e6bff; color: #ffffff; font-weight: 600; }
.gen-mode.active { background: #2e6bff; color: #ffffff; font-weight: 600; }
.gen-mode.active { background: var(--brand, #2e6bff); color: #ffffff; font-weight: 600; }
.gen-mode.active { background: var(--brand, #2e6bff); color: #ffffff; font-weight: 600; }

.ai-gen-target {
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  line-height: 1.6;
  margin-bottom: 18rpx;
}

.gen-result {
  margin-top: 20rpx;
  padding-top: 18rpx;
  border-top: 2rpx solid rgba(23, 32, 26, 0.08);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.08);
}

.gen-result-line { font-size: 24rpx; color: #1d4fd8; line-height: 1.6; }
.gen-result-line { font-size: 24rpx; color: var(--brand-strong, #1d4fd8); line-height: 1.6; }

.gen-switch {
  margin-top: 12rpx;
  font-size: 24rpx;
  font-weight: 600;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.ai-gen-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 16rpx 20rpx;
  font-size: 26rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}


.ai-gen-btn { width: 100%; height: 80rpx; font-size: 28rpx; }

/* ---------- 生成中：进度条 + 暂停 / 停止 ---------- */
.gen-actions {
  display: flex;
}

.gen-actions .btn-primary,
.gen-actions .btn-ghost { flex: 1; }

.gen-actions .btn-ghost { margin-left: 18rpx; }

/* 停止：红色描边的幽灵按钮，与暂停的主按钮形成主次 */
.gen-btn-stop {
  color: #e5484d;
  border: 2rpx solid rgba(229, 72, 77, 0.4);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
}

.gen-progress {
  padding: 18rpx 20rpx;
  margin-bottom: 18rpx;
  background: rgba(46, 107, 255, 0.08);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.08);
  border-radius: 18rpx;
}

.gp-line {
  font-size: 25rpx;
  font-weight: 500;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  line-height: 1.5;
}

.gp-track { margin-top: 14rpx; }

.gp-hint {
  display: block;
  margin-top: 12rpx;
  font-size: 21rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.gen-reset {
  margin-top: 14rpx;
  font-size: 23rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* ---------- 外部 AI（豆包 / DeepSeek / 网页版）：一键生成提示词 ---------- */
.ext-gen {
  background: rgba(124, 58, 237, 0.06);
  border: 2rpx solid rgba(124, 58, 237, 0.18);
  border-radius: 24rpx;
  padding: 24rpx 24rpx 22rpx;
  margin-top: 20rpx;
  margin-bottom: 8rpx;
}

.ext-desc {
  font-size: 23rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  line-height: 1.7;
}

.ext-btn {
  width: 100%;
  height: 78rpx;
  font-size: 27rpx;
  margin-top: 20rpx;
}

.prompt-box {
  margin-top: 20rpx;
  width: 100%;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 18rpx 20rpx;
  font-size: 24rpx;
  line-height: 1.7;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.ext-actions {
  display: flex;
  align-items: center;
  margin-top: 16rpx;
}

.ext-actions .ext-btn {
  width: 240rpx;
  margin-top: 0;
  margin-right: 16rpx;
  flex-shrink: 0;
}

.ext-tip {
  flex: 1;
  font-size: 21rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  line-height: 1.5;
}

.ai-gen-note {
  margin-top: 16rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  line-height: 1.6;
}

.divider {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 30rpx 0 24rpx;
}

.divider-text {
  font-size: 22rpx;
  color: #b0b7b2;
  padding: 0 24rpx;
  position: relative;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 2rpx;
  background: rgba(23, 32, 26, 0.08);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.08);
}

/* 置灰态：AI 未配置时整体淡化 */
.ai-gen.disabled .ai-gen-title,
.ai-gen.disabled .cnt-label,
.ai-gen.disabled .cnt-chip,
.ai-gen.disabled .cnt-unit,
.ai-gen.disabled .ai-gen-target,
.ai-gen.disabled .ai-gen-note { color: #b0b7b2; }

.ai-gen.disabled .gen-modes { border-color: rgba(23, 32, 26, 0.1); }
.ai-gen.disabled .gen-modes { border-color: rgba(var(--neutral-rgb, 23, 32, 26), 0.1); }

.ai-gen.disabled .cnt-chip.active { background: #d7d9d8; color: #ffffff; border-color: #d7d9d8; }

.ai-gen.disabled .gen-mode.active { background: #d7d9d8; color: #ffffff; }
.ai-gen.disabled .gen-mode.active { background: #d7d9d8; color: #ffffff; }

.import-input {
  width: 100%;
  min-height: 200rpx;
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 20rpx;
  padding: 20rpx;
  font-size: 26rpx;
  line-height: 1.6;
  box-sizing: border-box;
}

.import-actions { display: flex; margin-top: 24rpx; }

.paste-btn { width: 30%; margin-right: 20rpx; height: 84rpx; font-size: 28rpx; }

.import-btn { flex: 1; height: 84rpx; font-size: 28rpx; }

.result-box {
  margin-top: 24rpx;
  padding-top: 20rpx;
  border-top: 2rpx solid rgba(23, 32, 26, 0.08);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.08);
}

.result-line { font-size: 26rpx; color: #5a6560; line-height: 1.8; }
.result-line { font-size: 26rpx; color: var(--ink-2, #5a6560); line-height: 1.8; }

.result-reason { font-size: 22rpx; color: #98a19b; line-height: 1.8; }
.result-reason { font-size: 22rpx; color: var(--ink-3, #98a19b); line-height: 1.8; }

/* ---------- 每日目标 ---------- */
.goal-card { padding-bottom: 24rpx; }

.goal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 18rpx;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.07);
  border-bottom: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.goal-info { flex: 1; min-width: 0; }

.goal-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

.goal-sub {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* 关闭时整体淡化，但仍可查看数值 */
.goal-body { padding-top: 22rpx; transition: opacity 200ms ease; }
.goal-body.off { opacity: 0.45; }

.gi-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12rpx;
}

.gi-head-2 { margin-top: 32rpx; }

.gi-name {
  font-size: 27rpx;
  font-weight: 500;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.gi-hint {
  font-size: 21rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* 步进器：− [ 数字 ] ＋，比纯输入框好按 */
.gi-ctrl {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.gi-step {
  width: 68rpx;
  height: 68rpx;
  text-align: center;
  line-height: 64rpx;
  font-size: 32rpx;
  font-weight: 600;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(46, 107, 255, 0.28);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.28);
  border-radius: 999rpx;
  box-sizing: border-box;
}

.gi-step:active {
  background: rgba(46, 107, 255, 0.14);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.14);
}

.gi-input {
  flex: 1;
  margin: 0 18rpx;
  text-align: center;
  height: 76rpx;
  font-size: 34rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 20rpx;
  box-sizing: border-box;
}

.gi-chips { display: flex; margin-top: 16rpx; }

.gi-chip {
  flex: 1;
  text-align: center;
  font-size: 23rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 16rpx;
  padding: 12rpx 0;
  margin-right: 12rpx;
  transition: background 200ms ease, color 200ms ease;
}

.gi-chip:last-child { margin-right: 0; }

.gi-chip.on {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  color: #ffffff;
  font-weight: 600;
  border-color: #2e6bff;
  border-color: var(--brand, #2e6bff);
}

.gi-track { margin-top: 20rpx; height: 12rpx; }

.gi-foot {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.goal-note {
  margin-top: 24rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  line-height: 1.6;
}
</style>
