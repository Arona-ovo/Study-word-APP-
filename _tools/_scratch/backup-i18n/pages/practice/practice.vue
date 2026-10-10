<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle" v-if="!empty">
    <float-navbar title="翻译练习" />

    <!-- 答题流程 -->
    <block v-if="!finished">
      <view class="topbar">
        <text class="progress-text">{{ idx + 1 }} / {{ questions.length }}</text>
        <view class="progress-track topbar-track">
          <view class="progress-fill" :style="{ width: ((idx + 1) / questions.length * 100) + '%' }"></view>
        </view>
      </view>

      <!-- 题干（英文题干支持点读） -->
      <view class="card q-card">
        <view class="q-meta">
          <text class="tag dir-tag">{{ q.dir === 'e2c' ? '英译汉' : '汉译英' }}</text>
          <text class="tag lv-tag">难度 Lv{{ q.lv }}</text>
          <text class="tag src-tag" v-if="source === 'review'">错题重练</text>
          <text class="tag src-tag drill-tag" v-else-if="source === 'drill'">AI 专练</text>
          <view class="replay-btn" :data-text="q.prompt" @tap="replay">重听</view>
        </view>
        <view class="prompt" v-if="promptIsEn">
          <text
            v-for="(item, index) in promptTokens"
            :key="index"
            :class="item.w ? 'tok' : 'pun'"
            :data-w="item.t"
            :data-isw="item.w"
            @tap.stop="tapWord"
          >{{ item.t }}</text>
        </view>
        <view class="prompt" v-else>{{ q.prompt }}</view>
        <view class="prompt-tip" v-if="promptIsEn">点击单词可查看词义并听发音</view>
      </view>

      <!-- 作答方式切换 -->
      <view class="mode-switch" :class="{ locked: answered }">
        <view class="mode-item" :class="{ active: mode === 'choice' }" data-m="choice" @tap="switchMode">选择题</view>
        <view class="mode-item" :class="{ active: mode === 'input' }" data-m="input" @tap="switchMode">手动输入</view>
      </view>

      <!-- 选择题模式 -->
      <view class="options" v-if="mode === 'choice'">
        <view
          v-for="(item, index) in options"
          :key="index"
          class="option"
          :class="{
            correct: answered && index === q.answerIndex,
            wrong: answered && selected === index && index !== q.answerIndex
          }"
          :data-i="index"
          @tap="choose"
          hover-class="option-hover"
        >
          <text class="option-label">{{ labels[index] }}</text>
          <!-- 中文选项整段渲染 -->
          <text v-if="!optionIsEn[index]" class="option-text">{{ item }}</text>
          <!-- 英文选项按单词拆分，支持点读（作答后点单词看词义/发音，未作答点单词=选中该项） -->
          <text v-else class="option-text">
            <text
              v-for="(tk, k) in optionTokens[index]"
              :key="k"
              :class="tk.w ? 'tok' : 'pun'"
              :data-w="tk.t"
              :data-isw="tk.w"
              :data-opt="index"
              @tap.stop="onOptionTokenTap"
            >{{ tk.t }}</text>
          </text>
        </view>
      </view>

      <!-- 手动输入模式 -->
      <view class="card input-card" v-else>
        <textarea
          class="answer-input"
          placeholder="请输入你的完整翻译..."
          :value="input"
          @input="onInput"
          :disabled="answered"
          auto-height
          maxlength="300"
        />
        <button v-if="!answered" class="btn-primary submit-btn" @tap="submitInput" :disabled="!canSubmit">提交答案</button>
      </view>

      <!-- 结果与解析 -->
      <view v-if="answered" class="card result-card">
        <view class="result-title" :class="result.pass ? 'ok' : (result.partial ? 'mid' : 'bad')">
          {{ result.pass ? '回答正确' : (result.partial ? '基本正确，继续打磨' : '回答有误') }}
          <text class="result-score" v-if="mode === 'input'">匹配度 {{ result.score }}%</text>
        </view>
        <view class="result-row" v-if="mode === 'input'">
          <text class="result-label">你的答案</text>
          <text class="result-value">{{ userAnswer }}</text>
        </view>
        <view class="result-row">
          <view class="result-label-row">
            <text class="result-label">参考答案</text>
            <view class="replay-btn small" :data-text="q.answer" @tap="replay">{{ speaking ? '播放中…' : '重听' }}</view>
          </view>
          <view class="result-value ref" v-if="answerIsEn">
            <text
              v-for="(item, index) in answerTokens"
              :key="index"
              :class="item.w ? 'tok' : 'pun'"
              :data-w="item.t"
              :data-isw="item.w"
              @tap.stop="tapWord"
            >{{ item.t }}</text>
          </view>
          <text class="result-value ref" v-else>{{ q.answer }}</text>
        </view>
        <view class="note" v-if="q.note">解析：{{ q.note }}</view>
        <view class="word-chips">
          <view class="chip" v-for="item in q.words" :key="item.id" :data-text="item.w" @tap="replay">{{ item.w }} {{ item.pos }}{{ item.m }}</view>
        </view>
        <view class="fav-row" @tap="toggleFav">
          <text class="fav-star" :class="{ on: favOn }">{{ favOn ? '★ 已收藏' : '☆ 收藏本题' }}</text>
        </view>
        <view class="ai-block" :class="{ disabled: !aiEnabled }">
          <view class="ai-head" @tap="toggleCritique">
            <text class="ai-title">AI 点评</text>
            <text class="ai-sub">{{ aiEnabled ? '基于你本次作答' : aiReason }}</text>
            <text class="ai-chevron">{{ critiqueOpen ? '收起 ›' : '展开 ›' }}</text>
          </view>
          <view v-if="critiqueOpen" class="ai-body">
            <view v-if="critiqueLoading" class="ai-loading">
              <view class="loading-spinner small"></view>
              <text class="ai-loading-text">AI 正在点评…</text>
            </view>
            <block v-else-if="critique">
              <view class="ai-comment">{{ critique.comment }}</view>
              <view class="ai-improved" v-if="critique.improved">改进译文：{{ critique.improved }}</view>
            </block>
            <view v-else-if="critiqueError" class="ai-error">{{ critiqueError }}</view>
          </view>
        </view>
        <button class="btn-primary next-btn" @tap="next">{{ idx + 1 === questions.length ? '查看结果' : '下一题' }}</button>
      </view>
    </block>

    <!-- 本组总结 -->
    <view v-else class="summary">
      <view class="card summary-card">
        <view class="summary-title">本组练习完成</view>
        <view class="summary-score">{{ correctCount }}<text class="summary-total"> / {{ questions.length }}</text></view>
        <view class="summary-sub">正确率 {{ accuracy }}% · 掌握度已更新</view>
        <button class="btn-primary summary-btn" @tap="restart">再练一组</button>
        <button class="btn-ghost summary-btn" @tap="goHome">返回首页</button>
      </view>
    </view>

    <!-- 例句生成加载态（AI 生成可能有 1-3 秒延迟） -->
    <view class="loading-mask" v-if="loading">
      <view class="loading-card">
        <view class="loading-spinner"></view>
        <text class="loading-text">正在按 i+1 规则生成例句…</text>
      </view>
    </view>

    <!-- 点读单词弹窗 -->
    <view class="pop-mask" v-if="pop.show" @tap="closePop">
      <view class="pop-card" @tap.stop="noop">
        <view class="pop-word">{{ pop.word }}</view>
        <view class="pop-ph" v-if="pop.phonetic">/{{ pop.phonetic }}/</view>
        <view class="pop-meaning" v-if="pop.found">{{ pop.pos }} {{ pop.meaning }}</view>
        <view class="pop-meaning none" v-else>未收录（仍可发音）</view>
        <view class="pop-meta" v-if="pop.found">
          <text class="pop-src">{{ pop.srcLabel }}</text>
          <text class="pop-lemma" v-if="pop.inflected">原形 {{ pop.lemma }}</text>
        </view>
        <view class="pop-replay" :data-text="pop.word" @tap="replay">再听一次</view>
      </view>
    </view>
  </view>

  <!-- 空状态 -->
  <view v-else class="empty page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="翻译练习" />
    <view class="empty-text">{{ emptyText }}</view>
    <button class="btn-primary empty-btn" @tap="goHome">返回首页</button>
  </view>
</template>

<script>
import * as engine from '../../utils/engine'
import * as session from '../../utils/session'
import * as iplus1 from '../../utils/iplus1'
import * as wordbook from '../../utils/wordbook'
import * as judge from '../../utils/judge'
import * as tts from '../../services/voice'
import { aiGateReason } from '../../services/config.js'
import { critiqueTranslation } from '../../services/ai-content.js'
import * as dict from '../../utils/dict'
import * as settings from '../../utils/settings'
import * as sync from '../../services/account-sync'
import { tokenize, isEnglish } from '../../utils/tokenize'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'

export default {
  components: { FloatNavbar },
  data() {
    return {
      labels: ['A', 'B', 'C', 'D'],
      source: 'daily',
      questions: [],
      idx: 0,
      q: { dir: '', lv: 1, prompt: '', answer: '', options: [], answerIndex: 0, note: '', words: [] },
      options: [],
      mode: 'choice',
      selected: -1,
      input: '',
      canSubmit: false,
      answered: false,
      result: null,
      userAnswer: '',
      correctCount: 0,
      accuracy: 0,
      finished: false,
      empty: false,
      emptyText: '',
      promptIsEn: false,
      promptTokens: [],
      answerIsEn: false,
      answerTokens: [],
      optionIsEn: [],
      optionTokens: [],
      pop: { show: false, word: '', pos: '', meaning: '', phonetic: '', srcLabel: '', found: false, lemma: '', inflected: '' },
      loading: false,
      bookId: '',
      answerTimer: 0,
      speaking: false,
      favOn: false,
      aiEnabled: false,
      aiReason: '',
      critiqueOpen: false,
      critiqueLoading: false,
      critique: null,
      critiqueError: ''
    }
  },

  async onLoad(opt) {
    try {
      this.bookId = wordbook.currentBookId()
      const r = aiGateReason()
      this.aiReason = r
      this.aiEnabled = !r
      const src = opt && opt.source
      await this.start(src === 'review' ? 'review' : (src === 'drill' ? 'drill' : 'daily'))
    } catch (e) {
      // 出错可见化：不再无声空白，方便定位（正常情况不会走到这里）
      console.error('[practice onLoad]', e)
      this.loading = false
      this.empty = true
      this.emptyText = '页面加载失败：' + String((e && e.message) || e)
    }
  },

  onHide() { this.clearAnswerTimer(); tts.stop() },
  onUnload() { this.clearAnswerTimer(); tts.stop() },

  methods: {
    // 清理"作答后延迟朗读参考答案"的定时器，避免切题后仍触发上一题的语音
    clearAnswerTimer() {
      if (this.answerTimer) {
        clearTimeout(this.answerTimer)
        this.answerTimer = 0
      }
    },

    /** 每组题量：取当前词书的每日练习目标，夹在 5-50 之间防止极端值 */
    sessionSize() {
      try {
        const g = wordbook.getGoal(this.bookId)
        const n = Number(g && g.practice) || 10
        return Math.max(5, Math.min(50, n))
      } catch (e) {
        return 10
      }
    },

    async start(source) {
      // 当前词书一个词都没有（如刚新建的自建词书）→ 明确提示，避免空转
      if (source !== 'review' && !wordbook.bookWords(this.bookId).length) {
        this.empty = true
        this.finished = false
        this.emptyText = '当前词书还没有词汇，请到「词库 → 导入单词」粘贴单词或用 AI 生成'
        return
      }
      // 每组题量 = 该词书的「每日练习通过」目标（词库详情 → 每日目标 可调）
      const size = this.sessionSize()
      let qs = []
      if (source === 'review') {
        qs = engine.reviewQuestions()
      } else if (source === 'drill') {
        // AI 薄弱点专练：围绕未掌握词生成（失败回落到通用链路）
        this.loading = true
        try {
          qs = await session.buildDrillSession(size, this.bookId)
        } catch (e) {
          qs = []
        }
        this.loading = false
        if (!qs.length) {
          // 兜底：没有可生成的内容时退回日常练习
          this.loading = true
          try { qs = await session.buildSession(size, this.bookId) } catch (e) { qs = engine.dailyQuestions(size) }
          this.loading = false
        }
      } else {
        // 走 i+1 链路：AI 生成 → 缓存 → 本地语料（可能耗时，展示加载态）
        this.loading = true
        try {
          qs = await session.buildSession(size, this.bookId)
        } catch (e) {
          qs = engine.dailyQuestions(size)
        }
        this.loading = false
      }
      if (!qs.length) {
        this.empty = true
        this.finished = false
        this.emptyText = source === 'review' ? '太棒了，当前没有错题！' : '暂时没有可练习的题目'
        return
      }
      this.source = source
      this.questions = qs
      this.correctCount = 0
      this.accuracy = 0
      this.finished = false
      this.empty = false
      this.setupQuestion(0)
    },

    setupQuestion(i) {
      const q = this.questions[i]
      const promptIsEn = isEnglish(q.prompt)
      const answerIsEn = isEnglish(q.answer)
      this.clearAnswerTimer()
      this.idx = i
      this.q = q
      this.options = q.options
      this.mode = 'choice'
      this.selected = -1
      this.input = ''
      this.canSubmit = false
      this.answered = false
      this.result = null
      this.userAnswer = ''
      this.promptIsEn = promptIsEn
      this.promptTokens = promptIsEn ? tokenize(q.prompt) : []
      this.answerIsEn = answerIsEn
      this.answerTokens = answerIsEn ? tokenize(q.answer) : []
      // 选项是否英文需在 JS 里预判断（模板不支持表达式调用），英文选项按单词拆分以支持点读
      this.optionIsEn = (q.options || []).map(t => isEnglish(t))
      this.optionTokens = (q.options || []).map(t => (isEnglish(t) ? tokenize(t) : []))
      this.pop = { show: false, word: '', pos: '', meaning: '', phonetic: '', srcLabel: '', found: false, lemma: '', inflected: '' }
      this.speaking = false
      // 收藏状态随题刷新
      this.favOn = settings.isFavorite('sentence', q.sid)
      // AI 点评状态随题重置
      this.critiqueOpen = false
      this.critiqueLoading = false
      this.critique = null
      this.critiqueError = ''
      // 题目加载后自动朗读题干（自动朗读失败静默，不打扰用户）
      tts.speakAuto(q.prompt)
    },

    switchMode(e) {
      if (this.answered) return
      this.mode = e.currentTarget.dataset.m
    },

    choose(e) {
      if (this.answered) return
      this.doChoose(Number(e.currentTarget.dataset.i))
    },

    // 实际作答逻辑（选项整项点击 与 选项内单词点击 共用）
    doChoose(sel) {
      if (this.answered || !(sel >= 0)) return
      const pass = sel === this.q.answerIndex
      this.selected = sel
      this.finish(pass ? 'pass' : 'fail', pass ? 1 : 0, this.q.options[sel])
    },

    // 选项内的单词被点击：未作答 = 选中该选项；已作答 = 查词义并发音
    onOptionTokenTap(e) {
      const d = e.currentTarget.dataset
      if (!d.isw) return
      if (!this.answered) {
        this.doChoose(Number(d.opt))
        return
      }
      this.tapWord(e)
    },

    onInput(e) {
      const v = e.detail.value
      this.input = v
      this.canSubmit = !!v.trim()
    },

    submitInput() {
      if (this.answered || !this.input.trim()) return
      const q = this.q
      const r = q.dir === 'e2c'
        ? judge.judgeZh(this.input, q.answer)
        : judge.judgeEn(this.input, q.answer)
      const status = r.pass ? 'pass' : (r.partial ? 'partial' : 'fail')
      this.finish(status, r.score, this.input.trim())
    },

    finish(status, score, userAnswer) {
      engine.recordAnswer(this.q, status, this.mode, userAnswer)
      // 同步回写到词书维度的掌握度，作为下一轮 i+1 选词依据
      if (this.q.wordIds && this.q.wordIds.length) {
        iplus1.recordMastery(this.bookId || this.q.bookId, this.q.wordIds, status)
      }
      this.correctCount = this.correctCount + (status === 'pass' ? 1 : 0)
      this.answered = true
      this.userAnswer = userAnswer
      this.result = {
        pass: status === 'pass',
        partial: status === 'partial',
        score: Math.round(score * 100)
      }
      this.accuracy = Math.round((this.correctCount / this.questions.length) * 100)
      // 已登录：写一行 study_records（未登录时空操作，不影响练习流程）
      sync.recordStudy({
        bookId: this.bookId || q.bookId || '',
        sentenceId: q.sid || '',
        wordId: (q.words && q.words[0] && (q.words[0].id || q.words[0].w)) || (q.wordIds && q.wordIds[0]) || '',
        direction: q.dir || '',
        mode: this.mode || '',
        result: status,
        score: Math.round(score * 100),
        userAnswer: userAnswer || '',
        reference: q.answer || ''
      })
      // 作答后朗读参考答案，强化记忆（定时器由 clearAnswerTimer 统一清理）
      this.clearAnswerTimer()
      this.answerTimer = setTimeout(() => {
        this.answerTimer = 0
        tts.speakAuto(this.q.answer)
      }, 400)
    },

    // 点读单词：查词义（核心词书 → 导入词 → 常用词典 → 词形还原）+ 发音
    tapWord(e) {
      const d = e.currentTarget.dataset
      if (!d.isw) return
      const raw = d.w || ''
      if (!raw.trim()) return
      const entry = dict.lookup(raw)
      this.pop = {
        show: true,
        word: entry.w || raw,
        pos: entry.pos || '',
        meaning: entry.meaning || '',
        phonetic: entry.phonetic || '',
        srcLabel: dict.SRC_LABEL[entry.src] || '',
        found: !!entry.found,
        lemma: entry.lemma || '',
        inflected: entry.inflected || ''
      }
      // 未收录的单词仍走有道单词级发音（实测可用）
      tts.speakWord(dict.speakForm(raw))
    },

    closePop() {
      this.pop = { show: false, word: '', pos: '', meaning: '', phonetic: '', srcLabel: '', found: false, lemma: '', inflected: '' }
    },

    noop() {},

    // 重听：用户主动触发，force=true 永不被节流吞掉
    replay(e) {
      const text = e.currentTarget.dataset.text
      if (!text) { this.speaking = false; return }
      // 先发起播放再置位：speakSentence 内部 stop() 会触发上一次的 onDone（置 false）
      tts.speakSentence(text, {
        onDone: () => { this.speaking = false }
      })
      this.speaking = true
    },

    // 收藏当前题（例句），个人页「我的收藏」可查看
    toggleFav() {
      const q = this.q
      if (!q || !q.sid) return
      const wasOn = this.favOn
      const fav = { type: 'sentence', id: q.sid, en: q.prompt || '', zh: q.answer || '' }
      settings.toggleFavorite(fav)
      // 已登录：word_favorite 表同步（收藏→upsert，取消→软删除）
      if (wasOn) sync.unmirrorFavorite('sentence', q.sid)
      else sync.mirrorFavorite(fav)
      this.favOn = settings.isFavorite('sentence', q.sid)
    },

    // AI 点评：展开即按需调用，命中失败/未配置则提示，不阻断主流程
    toggleCritique() {
      if (!this.aiEnabled) {
        uni.showToast({ title: '请先在设置中完成 AI 配置（' + this.aiReason + '）', icon: 'none' })
        return
      }
      this.critiqueOpen = !this.critiqueOpen
      if (this.critiqueOpen && !this.critique && !this.critiqueError && !this.critiqueLoading) {
        this.loadCritique()
      }
    },
    async loadCritique() {
      if (!this.aiEnabled || !this.userAnswer) return
      this.critiqueLoading = true
      this.critiqueError = ''
      try {
        const r = await critiqueTranslation({
          source: this.q.prompt,
          userAnswer: this.userAnswer,
          reference: this.q.answer,
          dir: this.q.dir
        })
        this.critique = { comment: r.comment || '', improved: r.improved || '' }
      } catch (e) {
        this.critiqueError = 'AI 点评暂不可用（请检查 AI 服务设置）'
      } finally {
        this.critiqueLoading = false
      }
    },

    next() {
      const n = this.idx + 1
      this.clearAnswerTimer()
      if (n >= this.questions.length) {
        tts.stop()
        this.finished = true
      } else {
        this.setupQuestion(n)
      }
    },

    restart() {
      this.clearAnswerTimer()
      this.start('daily')
    },

    goHome() {
      uni.switchTab({ url: '/pages/home/home' })
    }
  }
}
</script>

<style>
.topbar { display: flex; align-items: center; margin-bottom: 24rpx; }

.progress-text {
  font-size: 24rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  margin-right: 20rpx;
  flex-shrink: 0;
  font-weight: 600;
}

.topbar-track { flex: 1; }

.q-card { margin-bottom: 24rpx; }

.q-meta { display: flex; align-items: center; margin-bottom: 18rpx; }

.dir-tag { background: rgba(46, 107, 255, 0.12); color: #1d4fd8; font-weight: 600; }
.dir-tag { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); color: var(--brand-strong, #1d4fd8); font-weight: 600; }

.lv-tag { background: rgba(23, 32, 26, 0.07); color: #5a6560; margin-left: 12rpx; }
.lv-tag { background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07); color: var(--ink-2, #5a6560); margin-left: 12rpx; }

.src-tag { background: rgba(247, 144, 9, 0.14); color: #b54708; margin-left: 12rpx; }

.src-tag.drill-tag { background: rgba(46, 107, 255, 0.12); color: #1d4fd8; }
.src-tag.drill-tag { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); color: var(--brand-strong, #1d4fd8); }

/* AI 点评区块（与卡片同一套玻璃语言的内嵌面板） */
.ai-block {
  margin-top: 18rpx;
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 24rpx;
  padding: 8rpx 28rpx;
  box-shadow: 0 6rpx 18rpx rgba(23, 32, 26, 0.05);
  box-shadow: 0 6rpx 18rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
}

.ai-block.disabled {
  background: rgba(255, 255, 255, 0.4);
  background: #f7f8f7;
  box-shadow: none;
}

.ai-block.disabled .ai-title { color: #b0b7b2; }

.ai-block.disabled .ai-chevron { color: #c8cdc9; }

.ai-head {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
}

.ai-title { font-size: 28rpx; font-weight: 600; color: #17201a; }
.ai-title { font-size: 28rpx; font-weight: 600; color: var(--ink-1, #17201a); }

.ai-sub { font-size: 22rpx; color: #98a19b; margin-left: 16rpx; }
.ai-sub { font-size: 22rpx; color: var(--ink-3, #98a19b); margin-left: 16rpx; }

.ai-chevron { margin-left: auto; font-size: 24rpx; color: #1d4fd8; }
.ai-chevron { margin-left: auto; font-size: 24rpx; color: var(--brand-strong, #1d4fd8); }

.ai-body { padding: 4rpx 0 24rpx; border-top: 2rpx solid rgba(23, 32, 26, 0.07); }
.ai-body { padding: 4rpx 0 24rpx; border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07); }

.ai-loading { display: flex; align-items: center; padding: 20rpx 0; }

.ai-loading-text { margin-left: 16rpx; font-size: 24rpx; color: #98a19b; }
.ai-loading-text { margin-left: 16rpx; font-size: 24rpx; color: var(--ink-3, #98a19b); }

.loading-spinner.small {
  width: 36rpx;
  height: 36rpx;
  border-width: 4rpx;
  border-top-color: #2e6bff;
  border-top-color: var(--brand, #2e6bff);
}

.ai-comment { font-size: 28rpx; line-height: 1.7; color: #5a6560; }
.ai-comment { font-size: 28rpx; line-height: 1.7; color: var(--ink-2, #5a6560); }

.ai-improved {
  margin-top: 14rpx;
  padding: 16rpx 20rpx;
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border-left: 6rpx solid #2e6bff;
  border-left: 6rpx solid var(--brand, #2e6bff);
  border-radius: 16rpx;
  font-size: 28rpx;
  line-height: 1.6;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.ai-error { font-size: 24rpx; color: #f79009; padding: 16rpx 0; }

.prompt {
  font-size: 36rpx;
  line-height: 1.7;
  font-weight: 500;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.tok { border-bottom: 2rpx dashed #bfd4ff; }

.tok:active { color: #1d4fd8; background: rgba(46, 107, 255, 0.12); border-radius: 6rpx; }
.tok:active { color: var(--brand-strong, #1d4fd8); background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); border-radius: 6rpx; }

.prompt-tip { margin-top: 14rpx; font-size: 22rpx; color: #98a19b; }
.prompt-tip { margin-top: 14rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.replay-btn {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.62);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.62);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  backdrop-filter: blur(12px) saturate(180%);
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.34);
  border-radius: 999rpx;
  padding: 6rpx 24rpx;
}
.replay-btn:active { background: rgba(46, 107, 255, 0.12); }
.replay-btn:active { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }

.replay-btn.small { margin-left: 16rpx; font-size: 22rpx; padding: 2rpx 18rpx; }

.fav-row {
  display: flex;
  justify-content: center;
  padding: 10rpx 0 6rpx;
}

.fav-star { font-size: 26rpx; color: #98a19b; }
.fav-star { font-size: 26rpx; color: var(--ink-3, #98a19b); }

.fav-star.on { color: #f79009; }

/* 作答方式切换：胶囊轨道 + 玻璃滑块，与底部导航同一语言 */
.mode-switch {
  display: flex;
  background: rgba(255, 255, 255, 0.62);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.62);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 999rpx;
  padding: 6rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 6rpx 18rpx rgba(23, 32, 26, 0.05);
  box-shadow: 0 6rpx 18rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
}

.mode-switch.locked { opacity: 0.5; }

.mode-item {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  border-radius: 999rpx;
}

.mode-item.active {
  background: #ffffff;
  background: var(--solid, #ffffff);
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  font-weight: 700;
  box-shadow: 0 2rpx 8rpx rgba(23, 32, 26, 0.08);
  box-shadow: 0 2rpx 8rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.08);
  transition: background 200ms ease, color 200ms ease;
}

/* 选项：玻璃卡片，选中/错误态用边框与淡色底反馈 */
.option {
  display: flex;
  align-items: flex-start;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  backdrop-filter: blur(12px) saturate(180%);
  border-radius: 24rpx;
  padding: 28rpx;
  margin-bottom: 18rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  box-shadow: 0 8rpx 24rpx rgba(23, 32, 26, 0.05);
  box-shadow: 0 8rpx 24rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
  transition: transform 180ms ease, background 200ms ease, border-color 200ms ease;
}

.option-hover { background: rgba(46, 107, 255, 0.1); }
.option-hover { background: rgba(var(--brand-rgb, 46, 107, 255), 0.1); }

.option.correct { border-color: #2e6bff; background: rgba(46, 107, 255, 0.13); }
.option.correct { border-color: var(--brand, #2e6bff); background: rgba(var(--brand-rgb, 46, 107, 255), 0.13); }

.option.wrong { border-color: #e5484d; background: rgba(229, 72, 77, 0.1); }

.option-label {
  flex-shrink: 0;
  width: 48rpx; height: 48rpx;
  line-height: 48rpx;
  text-align: center;
  border-radius: 50%;
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  font-size: 24rpx;
  font-weight: 600;
  margin-right: 20rpx;
}

.option.correct .option-label { background: #2e6bff; color: #ffffff; }
.option.correct .option-label { background: #2e6bff; color: #ffffff; }
.option.correct .option-label { background: var(--brand, #2e6bff); color: #ffffff; }
.option.correct .option-label { background: var(--brand, #2e6bff); color: #ffffff; }

.option.wrong .option-label { background: #e5484d; color: #ffffff; }
.option.wrong .option-label { background: #e5484d; color: #ffffff; }

.option-text { flex: 1; font-size: 30rpx; line-height: 1.55; }

.input-card { margin-bottom: 24rpx; }

.answer-input {
  width: 100%;
  min-height: 160rpx;
  font-size: 30rpx;
  line-height: 1.6;
  box-sizing: border-box;
}

.submit-btn { margin-top: 24rpx; }

.result-card { margin-top: 6rpx; }

.result-title {
  font-size: 34rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  margin-bottom: 22rpx;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.result-title.ok { color: #1d4fd8; }
.result-title.ok { color: var(--brand-strong, #1d4fd8); }
.result-title.mid { color: #b54708; }
.result-title.bad { color: #e5484d; }

.result-score { font-size: 24rpx; font-weight: 400; color: #98a19b; }
.result-score { font-size: 24rpx; font-weight: 400; color: var(--ink-3, #98a19b); }

.result-row { margin-bottom: 16rpx; display: flex; flex-direction: column; }

.result-label-row { display: flex; align-items: center; margin-bottom: 6rpx; }

.result-label { font-size: 22rpx; color: #98a19b; margin-bottom: 6rpx; }
.result-label { font-size: 22rpx; color: var(--ink-3, #98a19b); margin-bottom: 6rpx; }

.result-label-row .result-label { margin-bottom: 0; }

.result-value { font-size: 30rpx; line-height: 1.6; }

.result-value.ref { color: #1d4fd8; font-weight: 600; }
.result-value.ref { color: var(--brand-strong, #1d4fd8); font-weight: 600; }

.note {
  margin-top: 14rpx;
  padding: 18rpx 22rpx;
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border-left: 6rpx solid #2e6bff;
  border-left: 6rpx solid var(--brand, #2e6bff);
  border-radius: 16rpx;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  line-height: 1.6;
}

.word-chips { display: flex; flex-wrap: wrap; margin-top: 18rpx; }

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
  padding: 10rpx 22rpx;
  margin: 0 12rpx 12rpx 0;
}

.next-btn { margin-top: 24rpx; }

.summary-card { text-align: center; padding: 72rpx 40rpx; }

.summary-title { font-size: 30rpx; color: #5a6560; }
.summary-title { font-size: 30rpx; color: var(--ink-2, #5a6560); }

.summary-score {
  font-size: 96rpx;
  font-weight: 600;
  color: #2e6bff;
  color: var(--brand, #2e6bff);
  margin-top: 24rpx;
  letter-spacing: 2rpx;
}

.summary-total { font-size: 42rpx; color: #98a19b; font-weight: 400; }
.summary-total { font-size: 42rpx; color: var(--ink-3, #98a19b); font-weight: 400; }

.summary-sub { font-size: 26rpx; color: #98a19b; margin: 18rpx 0 48rpx; }
.summary-sub { font-size: 26rpx; color: var(--ink-3, #98a19b); margin: 18rpx 0 48rpx; }

.summary-btn { margin-top: 20rpx; }

.loading-mask {
  position: fixed;
  left: 0; top: 0; right: 0; bottom: 0;
  background: rgba(244, 246, 244, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 90;
}

.loading-card {
  background: rgba(255, 255, 255, 0.78);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.78);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  backdrop-filter: blur(12px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 28rpx;
  padding: 48rpx 56rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: 0 16rpx 44rpx rgba(23, 32, 26, 0.12);
  box-shadow: 0 16rpx 44rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.12);
}

.loading-spinner {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  border: 6rpx solid #dfe6f5;
  border-top-color: #2e6bff;
  border-top-color: var(--brand, #2e6bff);
  animation: spin 0.9s linear infinite;
}

.loading-text {
  margin-top: 24rpx;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 点读弹窗：.pop-mask / .pop-card 统一见 App.vue 全局样式，这里只写内容类 */

.pop-word {
  font-size: 48rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
}

.pop-meaning { margin-top: 18rpx; font-size: 30rpx; color: #5a6560; }
.pop-meaning { margin-top: 18rpx; font-size: 30rpx; color: var(--ink-2, #5a6560); }

.pop-meaning.none { color: #98a19b; }
.pop-meaning.none { color: var(--ink-3, #98a19b); }

.pop-ph { margin-top: 8rpx; font-size: 26rpx; color: #98a19b; }
.pop-ph { margin-top: 8rpx; font-size: 26rpx; color: var(--ink-3, #98a19b); }

.pop-meta { margin-top: 12rpx; display: flex; justify-content: center; }

.pop-src {
  font-size: 22rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  border-radius: 999rpx;
  padding: 4rpx 16rpx;
}

.pop-lemma { margin-left: 12rpx; font-size: 22rpx; color: #98a19b; }
.pop-lemma { margin-left: 12rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.pop-replay {
  display: inline-block;
  margin-top: 36rpx;
  font-size: 28rpx;
  font-weight: 600;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  border: 2rpx solid #2e6bff;
  border: 2rpx solid var(--brand, #2e6bff);
  border-radius: 999rpx;
  padding: 12rpx 48rpx;
}

.empty { padding: 200rpx 60rpx; text-align: center; }

.empty-text { font-size: 30rpx; color: #98a19b; margin-bottom: 40rpx; }
.empty-text { font-size: 30rpx; color: var(--ink-3, #98a19b); margin-bottom: 40rpx; }

.empty-btn { width: 60%; }
</style>
