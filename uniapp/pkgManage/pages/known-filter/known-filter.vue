<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('熟词过滤')" />

    <!-- ============ 阶段一：说明 / 开始 ============ -->
    <block v-if="phase === 'intro'">
      <view class="card intro-card">
        <view class="intro-title">{{ $t('先花一分钟，跳过你已经会的词') }}</view>
        <view class="intro-desc">
          {{ $t('从当前词书里抽 20~30 个词让你认一认，估算你大概认识多少；前面的词按词频从易到难排列，认识的部分会整体标记为「已掌握」，练习和刷单词自动跳过，把时间留给不会的词。') }}
        </view>
        <view class="intro-meta">
          <text class="meta-tag">{{ $t('当前词书') }}</text>
          <text class="meta-name">{{ bookName }}</text>
          <text class="meta-count">{{ $t('内置 {n} 词', { n: basisCount }) }}</text>
        </view>
        <view v-if="!hasBasis" class="intro-warn">
          {{ $t('当前词书没有内置词表（自建 / 导入词书），暂不支持估算') }}
        </view>

        <!-- 上次结果：可撤销，也可重测覆盖 -->
        <view v-if="last" class="lastrun">
          <view class="lastrun-line">
            {{ $t('上次已标记 {n} 个词为已掌握', { n: last.marked }) }}
          </view>
          <view class="lastrun-time">{{ lastText }}</view>
          <view class="lastrun-acts">
            <text class="lastrun-undo" @tap="askUndo">{{ $t('撤销过滤') }}</text>
          </view>
        </view>

        <button
          class="btn-primary intro-btn"
          :class="{ disabled: !hasBasis }"
          :disabled="!hasBasis"
          @tap="start"
        >{{ $t('开始测试') }}</button>
      </view>
    </block>

    <!-- ============ 阶段二：测试 ============ -->
    <block v-if="phase === 'test'">
      <view class="test-meta">
        <text class="test-seg">{{ $t('第 {n} 段', { n: segIndex + 1 }) }} / {{ segmentCount }}</text>
        <text class="test-count">{{ $t('已测 {a} 段 · 第 {b} 词', { a: segDone, b: segPos + 1 }) }}</text>
      </view>
      <view class="progress-track test-track">
        <view class="progress-fill" :style="{ width: testPct + '%' }"></view>
      </view>

      <view class="card word-card">
        <view class="ask-line">{{ verify ? $t('认识它吗？看看释义') : $t('认识这个词吗？') }}</view>
        <view class="ask-word">{{ cur.w }}</view>
        <view class="ask-pos" v-if="cur.pos">{{ cur.pos }}</view>
        <!-- 认识 → 先亮释义确认，防止「脸熟当认识」 -->
        <view v-if="verify" class="ask-mean">{{ cur.m }}</view>
        <view v-else class="ask-hint">{{ $t('先凭印象作答，选「认识」后再用释义确认') }}</view>
      </view>

      <view class="test-acts">
        <block v-if="!verify">
          <button class="btn-primary test-btn" @tap="onKnow">{{ $t('认识') }}</button>
          <button class="btn-ghost test-btn" @tap="onDont">{{ $t('不认识') }}</button>
        </block>
        <block v-else>
          <button class="btn-primary test-btn" @tap="confirmKnow">{{ $t('确认认识') }}</button>
          <button class="btn-ghost test-btn" @tap="onDont">{{ $t('改成不认识') }}</button>
        </block>
      </view>
    </block>

    <!-- ============ 阶段三：结果 ============ -->
    <block v-if="phase === 'result'">
      <view class="card result-card">
        <view class="result-title">{{ $t('估算完成') }}</view>
        <view class="result-big">{{ $t('约认识 {n} 词', { n: result.estimate }) }}</view>
        <view class="result-sub">{{ $t('全书 {t} 词 · 约占 {p}%', { t: result.total, p: estPct }) }}</view>

        <view class="divider"><text class="divider-text">{{ $t('接下来') }}</text></view>

        <block v-if="result.markCount > 0 && result.markCount < result.total">
          <view class="result-line">
            {{ $t('将把前 {n} 个较简单的词标记为「已掌握」', { n: result.markCount }) }}
          </view>
          <view class="result-note">
            {{ $t('练习出题、刷单词与批次解锁都会跳过它们；标记过多可以随时撤销。') }}
          </view>
          <button class="btn-primary result-btn" @tap="askApply">
            {{ $t('标记 {n} 个词为已掌握', { n: result.markCount }) }}
          </button>
          <button class="btn-ghost result-btn" @tap="start">{{ $t('重新测试') }}</button>
        </block>
        <block v-else-if="result.markCount >= result.total">
          <view class="result-line">{{ $t('你几乎认识整本词书') }}</view>
          <view class="result-note">{{ $t('建议换一本更有挑战的词书，或直接开始练习巩固。') }}</view>
          <button class="btn-primary result-btn" @tap="askApply">
            {{ $t('标记 {n} 个词为已掌握', { n: result.markCount }) }}
          </button>
          <button class="btn-ghost result-btn" @tap="goSwitch">{{ $t('换个词书') }}</button>
        </block>
        <block v-else>
          <view class="result-line">{{ $t('一个都不用跳过，从头开始背') }}</view>
          <view class="result-note">{{ $t('估算认为当前词书对你基本都是新词，直接开练即可。') }}</view>
          <button class="btn-primary result-btn" @tap="goPractice">{{ $t('去背单词') }}</button>
          <button class="btn-ghost result-btn" @tap="start">{{ $t('重新测试') }}</button>
        </block>
      </view>
    </block>

    <!-- ============ 阶段四：已应用 ============ -->
    <block v-if="phase === 'done'">
      <view class="card result-card">
        <view class="result-title">{{ $t('已应用过滤') }}</view>
        <view class="result-big">{{ $t('已标记 {n} 词为已掌握', { n: appliedCount }) }}</view>
        <view class="result-note">{{ $t('练习与刷单词将跳过这些词。标多了？现在就撤销最方便。') }}</view>
        <button class="btn-primary result-btn" @tap="finish">{{ $t('完成') }}</button>
        <button class="btn-ghost result-btn" @tap="askUndo">{{ $t('撤销过滤') }}</button>
      </view>
    </block>

    <!-- 应用确认 / 撤销确认（统一弹窗） -->
    <app-dialog
      :show="confirm.show"
      :title="confirm.title"
      :content="confirm.content"
      :confirm-text="confirm.confirmText"
      :danger="confirm.danger"
      @confirm="onConfirmYes"
      @cancel="confirm.show = false"
    />
  </view>
</template>

<script>
import { t } from '../../../utils/i18n.js'
import * as wordbook from '../../../utils/wordbook'
import * as kf from '../../../utils/known-filter'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../../components/app-dialog/app-dialog.vue'

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      phase: 'intro',        // intro | test | result | done
      bookName: '',
      bookId: '',
      basisCount: 0,
      hasBasis: false,
      last: null,
      // 测试态
      segmentCount: kf.SEGMENT_COUNT,
      segIndex: 0,
      segDone: 0,
      segPos: 0,             // 本段第几词（1 起）
      testPct: 0,
      cur: { w: '', pos: '', m: '' },
      verify: false,
      // 结果态
      result: { ok: false, total: 0, estimate: 0, markCount: 0, markIds: [], lastPassed: -1 },
      estPct: 0,
      appliedCount: 0,
      // 统一确认弹窗
      confirm: { show: false, title: '', content: '', confirmText: t('确定'), danger: false, action: '' }
    }
  },
  computed: {
    lastText() {
      void this.__lang
      if (!this.last || !this.last.at) return ''
      const d = new Date(this.last.at)
      const p = (n) => (n < 10 ? '0' + n : '' + n)
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    }
  },
  onShow() {
    this.refresh()
  },
  onBackPress() {
    // 测试中按返回：先确认放弃（测试没写任何数据，只是别误触）
    if (this.phase === 'test') {
      this.confirm = {
        show: true,
        title: t('放弃测试'),
        content: t('测试不会保存任何结果，确定退出？'),
        confirmText: t('退出'),
        danger: true,
        action: 'quit'
      }
      return true
    }
    if (this.confirm && this.confirm.show) {
      this.confirm.show = false
      return true
    }
    return false
  },
  methods: {
    refresh() {
      const books = wordbook.listBooks()
      const cur = books.find(b => b.current) || books[0]
      this.bookId = cur ? cur.id : ''
      this.bookName = cur ? cur.name : ''
      const basis = kf.basis(this.bookId)
      this.basisCount = basis.length
      this.hasBasis = basis.length >= kf.SEGMENT_COUNT * 3
      this.last = kf.lastRun(this.bookId)
      if (this.phase === 'done') {
        // 撤销后回来：回引导页
        if (!this.last) this.phase = 'intro'
      }
    },
    start() {
      if (!this.hasBasis) return
      this.__test = kf.createTest(this.bookId)
      this.segDone = 0
      this.verify = false
      this.phase = 'test'
      this.pull()
    },
    // 从控制器取当前词 + 进度（模板不做函数调用，全部预计算进 data）
    pull() {
      const c = this.__test && this.__test.current()
      if (!c) {
        this.finishTest()
        return
      }
      this.cur = { w: c.word, pos: c.pos, m: c.meaning }
      this.segIndex = c.segIndex
      this.segPos = c.segNo
      const p = this.__test.progress()
      this.segDone = p.segments
      // 进度条：按「已判定段数」推进；最后一段答完自然到头
      this.testPct = Math.min(100, Math.round((p.segments / this.segmentCount) * 100))
    },
    onKnow() {
      this.verify = true
    },
    confirmKnow() {
      this.answer(true)
    },
    onDont() {
      this.answer(false)
    },
    answer(known) {
      if (!this.__test) return
      this.verify = false
      this.__test.answer(known)
      this.pull()
    },
    finishTest() {
      const r = this.__test ? this.__test.result() : null
      if (!r || !r.ok) {
        uni.showToast({ title: t('词书词量太少，无法估算'), icon: 'none' })
        this.phase = 'intro'
        return
      }
      this.result = r
      this.estPct = r.total ? Math.round((r.estimate / r.total) * 100) : 0
      this.phase = 'result'
    },
    askApply() {
      this.confirm = {
        show: true,
        title: t('应用熟词过滤'),
        content: t('将把前 {n} 个较简单的词标记为「已掌握」，练习与刷单词会跳过它们；标记过多可随时在本页或词库页撤销。', { n: this.result.markCount }),
        confirmText: t('标记'),
        danger: false,
        action: 'apply'
      }
    },
    askUndo() {
      this.confirm = {
        show: true,
        title: t('撤销过滤'),
        content: t('所有被标记的词会恢复原来的掌握度，确定撤销？'),
        confirmText: t('撤销'),
        danger: true,
        action: 'undo'
      }
    },
    onConfirmYes() {
      const act = this.confirm.action
      this.confirm.show = false
      if (act === 'apply') {
        const r = kf.apply(this.bookId, this.result)
        this.appliedCount = r.marked
        this.last = kf.lastRun(this.bookId)
        this.phase = 'done'
        uni.showToast({ title: t('已标记 {n} 词', { n: r.marked }), icon: 'none' })
      }
      if (act === 'undo') {
        const n = kf.undo(this.bookId)
        this.last = kf.lastRun(this.bookId)
        this.phase = 'intro'
        uni.showToast({ title: t('已撤销 {n} 词', { n }), icon: 'none' })
      }
      if (act === 'quit') {
        this.phase = 'intro'
      }
    },
    goSwitch() {
      uni.navigateTo({ url: '/pkgManage/pages/book-switch/book-switch' })
    },
    goPractice() {
      uni.switchTab({ url: '/pages/home/home' })
    },
    finish() {
      uni.navigateBack()
    }
  }
}
</script>

<style>
.intro-card { padding: 36rpx 32rpx; }

.intro-title {
  font-size: 34rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

.intro-desc {
  margin-top: 16rpx;
  font-size: 26rpx;
  line-height: 1.7;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.intro-meta {
  display: flex;
  align-items: center;
  margin-top: 24rpx;
}

.meta-tag {
  font-size: 20rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
  border-radius: 999rpx;
  padding: 3rpx 16rpx;
  flex-shrink: 0;
}

.meta-name {
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

.meta-count { font-size: 22rpx; color: #98a19b; flex-shrink: 0; }
.meta-count { font-size: 22rpx; color: var(--ink-3, #98a19b); flex-shrink: 0; }

.intro-warn {
  margin-top: 20rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: #b54708;
  background: rgba(247, 144, 9, 0.12);
  border-radius: 16rpx;
  padding: 16rpx 20rpx;
}

.lastrun {
  margin-top: 22rpx;
  padding: 20rpx 24rpx;
  background: rgba(46, 107, 255, 0.07);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.07);
  border: 2rpx solid rgba(46, 107, 255, 0.16);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.16);
  border-radius: 18rpx;
}

.lastrun-line {
  font-size: 26rpx;
  font-weight: 500;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.lastrun-time { margin-top: 6rpx; font-size: 22rpx; color: #98a19b; }
.lastrun-time { margin-top: 6rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.lastrun-acts { margin-top: 10rpx; }

.lastrun-undo {
  font-size: 24rpx;
  font-weight: 600;
  color: #e5484d;
  color: var(--danger, #e5484d);
}

.intro-btn { margin-top: 30rpx; width: 100%; height: 84rpx; font-size: 28rpx; }

/* ---------- 测试 ---------- */
.test-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0 8rpx 14rpx;
}

.test-seg {
  font-size: 26rpx;
  font-weight: 600;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}

.test-count { font-size: 22rpx; color: #98a19b; }
.test-count { font-size: 22rpx; color: var(--ink-3, #98a19b); }

.test-track { margin-bottom: 24rpx; }

.word-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 70rpx 40rpx 60rpx;
}

.ask-line { font-size: 26rpx; color: #5a6560; }
.ask-line { font-size: 26rpx; color: var(--ink-2, #5a6560); }

.ask-word {
  margin-top: 26rpx;
  font-size: 76rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
  text-align: center;
  word-break: break-word;
}

.ask-pos { margin-top: 12rpx; font-size: 24rpx; color: #98a19b; }
.ask-pos { margin-top: 12rpx; font-size: 24rpx; color: var(--ink-3, #98a19b); }

.ask-mean {
  margin-top: 34rpx;
  font-size: 30rpx;
  line-height: 1.6;
  color: #17201a;
  color: var(--ink-1, #17201a);
  text-align: center;
  background: rgba(46, 107, 255, 0.07);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.07);
  border-radius: 18rpx;
  padding: 20rpx 28rpx;
  word-break: break-word;
}

.ask-hint {
  margin-top: 34rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  text-align: center;
}

.test-acts { display: flex; margin-top: 28rpx; }

.test-btn { flex: 1; height: 88rpx; font-size: 30rpx; }
.test-acts .test-btn + .test-btn { margin-left: 22rpx; }

/* ---------- 结果 / 完成 ---------- */
.result-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 44rpx 36rpx 36rpx;
}

.result-title {
  font-size: 26rpx;
  font-weight: 600;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  letter-spacing: 1rpx;
}

.result-big {
  margin-top: 18rpx;
  font-size: 44rpx;
  font-weight: 700;
  color: #2e6bff;
  color: var(--brand, #2e6bff);
  text-align: center;
}

.result-sub { margin-top: 12rpx; font-size: 24rpx; color: #98a19b; }
.result-sub { margin-top: 12rpx; font-size: 24rpx; color: var(--ink-3, #98a19b); }

.result-line {
  margin-top: 6rpx;
  font-size: 28rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  text-align: center;
  line-height: 1.6;
}

.result-note {
  margin-top: 14rpx;
  font-size: 24rpx;
  line-height: 1.7;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  text-align: center;
}

.result-btn { width: 100%; height: 84rpx; font-size: 28rpx; margin-top: 26rpx; }

.divider {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 34rpx 0 22rpx;
  width: 100%;
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
</style>
