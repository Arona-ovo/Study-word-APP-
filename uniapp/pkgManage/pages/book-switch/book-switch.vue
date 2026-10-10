<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('更换词书')" />

    <view class="tip">{{ $t('选择要学习的词书，切换后首页与练习将按新词书进行。') }}</view>

    <view class="new-book" @tap="createBook">{{ $t('＋ 新建空白词书') }}</view>

    <!-- 按类别分组：内置词书有 6 本，平铺一列很难挑。 -->
    <view v-for="g in groups" :key="g.name" class="group">
      <view class="group-title">{{ g.name }}</view>

      <view
        v-for="b in g.list"
        :key="b.id"
        class="card book-item"
        :class="{ current: b.current }"
        @tap="choose(b)"
        @longpress="askDelete(b)"
      >
        <view class="bi-head">
          <view class="bi-name-row">
            <text class="bi-name">{{ b.name }}</text>
            <text v-if="b.note" class="bi-badge tip-badge">{{ b.note }}</text>
            <text v-if="b.userBook" class="bi-badge self">{{ $t('自建') }}</text>
            <text v-if="b.current" class="bi-badge">{{ $t('当前') }}</text>
          </view>
          <text class="bi-radio" :class="{ on: b.current }">{{ b.current ? '✓' : '' }}</text>
        </view>
        <view class="bi-desc">{{ b.desc }}</view>
        <view class="bi-meta">
          <text class="bi-meta-item">{{ b.wordCount }} 词</text>
          <text class="bi-meta-item" v-if="b.batchless">{{ $t('自定义词书') }}</text>
          <text class="bi-meta-item" v-else>共 {{ b.batchCount }} 批</text>
          <text class="bi-meta-item">已学 {{ b.touched }} 词</text>
        </view>
        <view class="progress-track bi-track">
          <view class="progress-fill" :style="{ width: b.pct + '%' }"></view>
        </view>
      </view>
    </view>

    <view v-if="books.length === 0" class="empty">{{ $t('暂无词书') }}</view>
    <view v-if="hasUserBook" class="tip-bottom">{{ $t('长按自建词书可重命名 / 删除') }}</view>

    <!-- 全 App 统一弹窗：确认框 / 操作菜单 / 输入框共用一张玻璃卡片 -->
    <app-dialog
      :show="dlg.show"
      :mode="dlg.mode"
      :btn-mode="dlg.btnMode"
      :title="dlg.title"
      :content="dlg.content"
      :confirm-text="dlg.confirmText"
      :cancel-text="dlg.cancelText"
      :danger="dlg.danger"
      :items="dlg.items"
      :value="dlg.value"
      :placeholder="dlg.placeholder"
      :error="dlg.error"
      @confirm="onDlgConfirm"
      @cancel="closeDlg"
      @input="onDlgInput"
    />
  </view>
</template>

<script>
import { t } from '../../../utils/i18n.js';
import * as wordbook from '../../../utils/wordbook'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../../components/app-dialog/app-dialog.vue'

// 最近一次长按的时间戳。部分端长按抬起后还会补发一次 tap，
// 用它把紧跟的 tap 吃掉，避免「长按弹菜单 → 松手又弹切换确认框」。
let lastLongPress = 0

const EMPTY_DLG = {
  show: false,
  mode: 'confirm',   // confirm | sheet | input
  btnMode: 'confirm', // confirm | alert
  title: '',
  content: '',
  confirmText: t('确定'),
  cancelText: t('取消'),
  danger: false,
  items: [],
  value: '',
  placeholder: '',
  error: '',
  action: '',        // 派发用：switch | menu | delete | create | rename
  target: null       // 当前操作的词书对象
}

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      books: [],
      dlg: Object.assign({}, EMPTY_DLG)
    }
  },
  computed: {
    hasUserBook() {
      return this.books.some(b => b.userBook)
    },
    // 按 group 归并，保持词书原有顺序（组内顺序即 WORDBOOKS 的顺序：专升本 → 四六级 → 考研 …）
    groups() {
      const out = []
      this.books.forEach(b => {
        const name = b.group || this.$t('其他')
        let slot = null
        for (let i = 0; i < out.length; i++) if (out[i].name === name) { slot = out[i]; break }
        if (!slot) { slot = { name: name, list: [] }; out.push(slot) }
        slot.list.push(b)
      })
      return out
    }
  },
  onShow() {
    this.refresh()
  },
  methods: {
    refresh() {
      const list = wordbook.listBooks()
      this.books = list.map(b => {
        // 按词书口径统计（内置词 + 该书导入词），空词书即 0 词
        const v = wordbook.bookVocab(b.id, 'all')
        let touched = 0
        v.list.forEach(x => { if ((x.seen || 0) > 0 || (x.mastery || 0) > 0) touched++ })
        const total = v.total
        return {
          id: b.id,
          name: b.name,
          desc: b.desc,
          group: b.group,
          note: b.note,
          current: b.current,
          userBook: !!b.userBook,
          batchless: wordbook.bookMode(b.id) === 'custom',
          wordCount: total,
          batchCount: b.batchCount,
          touched,
          pct: total ? Math.round((touched / total) * 100) : 0
        }
      })
    },
    choose(b) {
      // 部分端长按抬起后还会补一次 tap，这里吃掉，否则会紧跟弹出切换确认框
      if (Date.now() - lastLongPress < 700) return
      if (b.current) return
      this.openDlg({
        title: t('切换词书'),
        content: t('确定切换到「') + b.name + t('」？学习进度按词书分别保存，不会丢失。'),
        confirmText: t('切换'),
        target: b,
        action: 'switch'
      })
    },

    // ---------- 统一弹窗（components/app-dialog） ----------
    // payload 语义随 mode 变化：sheet → 选中下标，input → 输入文本，confirm → true
    openDlg(patch) {
      // items 要新建一份：EMPTY_DLG 里的是共享引用，被 push 过就会污染后续弹窗
      const base = Object.assign({}, EMPTY_DLG, { items: [] })
      this.dlg = Object.assign(base, patch, { show: true, seq: (this.dlg.seq || 0) + 1 })
    },

    closeDlg() {
      this.dlg = Object.assign({}, EMPTY_DLG)
    },

    onDlgInput(v) {
      this.dlg.value = String(v || '')
      // 输入时清掉旧错误，重名校验在「确定」时统一做
      if (this.dlg.error) this.dlg.error = ''
    },

    onDlgConfirm(payload) {
      const act = this.dlg.action
      if (act === 'menu') {
        const b = this.dlg.target
        // 菜单 → 输入框/确认框 是同一个组件，直接换 mode 即可，不用先关再开
        if (payload === 0) {
          this.openDlg({
            mode: 'input',
            title: t('重命名词书'),
            value: b.name,
            placeholder: t('输入新名称'),
            confirmText: t('保存'),
            target: b,
            action: 'rename'
          })
        } else if (payload === 1) {
          this.openDlg({
            mode: 'confirm',
            title: t('删除词书'),
            content: this.deleteHint(b),
            confirmText: t('删除'),
            danger: true,
            target: b,
            action: 'delete'
          })
        }
        return
      }

      if (act === 'switch') {
        const b = this.dlg.target
        this.closeDlg()
        wordbook.switchBook(b.id)
        this.refresh()
        uni.showToast({ title: t('已切换'), icon: 'success' })
        setTimeout(() => { uni.navigateBack() }, 500)
        return
      }

      if (act === 'create') {
        const name = String(payload || '').trim()
        const err = this.validateName(name, '')
        if (err) { this.dlg.error = err; return }
        try {
          wordbook.createUserBook(name, t('空白词书'))
          this.closeDlg()
          this.refresh()
          uni.showToast({ title: t('已新建（可去词库导入单词）'), icon: 'none' })
        } catch (e) {
          this.dlg.error = (e && e.message) || t('操作失败')
        }
        return
      }

      if (act === 'rename') {
        const b = this.dlg.target
        const name = String(payload || '').trim()
        const err = this.validateName(name, b.id)
        if (err) { this.dlg.error = err; return }
        try {
          wordbook.renameUserBook(b.id, name)
          this.closeDlg()
          this.refresh()
          uni.showToast({ title: t('已重命名'), icon: 'success' })
        } catch (e) {
          this.dlg.error = (e && e.message) || t('操作失败')
        }
        return
      }

      if (act === 'delete') {
        const b = this.dlg.target
        this.closeDlg()
        wordbook.deleteUserBook(b.id)
        this.refresh()
        uni.showToast({ title: t('已删除'), icon: 'success' })
      }
    },

    // 长按任意词书都要有反馈；内置词书说明原因，不再静默无响应
    askDelete(b) {
      lastLongPress = Date.now()
      if (!b.userBook) {
        uni.showToast({ title: t('内置词书不支持重命名 / 删除'), icon: 'none' })
        return
      }
      this.openDlg({
        mode: 'sheet',
        title: b.name,
        items: [{ label: t('重命名') }, { label: t('删除词书'), danger: true }],
        target: b,
        action: 'menu'
      })
    },

    createBook() {
      this.openDlg({
        mode: 'input',
        title: t('新建词书'),
        value: '',
        placeholder: t('输入词书名称'),
        confirmText: t('创建'),
        action: 'create'
      })
    },

    validateName(name, exceptId) {
      if (!name) return t('名称不能为空')
      if (wordbook.isNameTaken(name, exceptId || '')) {
        return t('词书名「') + name + t('」已存在，换一个名字')
      }
      return ''
    },

    // 删除提示文案：正在使用的词书要说明「删完自动切到哪本」，避免用户以为会卡在空状态
    deleteHint(b) {
      let s = t('将删除「{name}」及其中的 {n} 个词和掌握度，且无法恢复。', { name: b.name, n: b.wordCount })
      if (b.current) {
        const nx = wordbook.listBooks().filter(x => x.id !== b.id)[0]
        if (nx) s += t('当前正在使用，删除后会自动切换到「') + nx.name + '」。'
      }
      return s
    }
  }
}
</script>

<style>
.tip {
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  line-height: 1.6;
  padding: 4rpx 8rpx 20rpx;
}

/* 新建词书：虚线玻璃块，圆角与卡片一致 */
.new-book {
  text-align: center;
  font-size: 26rpx;
  font-weight: 600;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.55);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.55);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx dashed rgba(46, 107, 255, 0.4);
  border: 2rpx dashed rgba(var(--brand-rgb, 46, 107, 255), 0.4);
  border-radius: 28rpx;
  padding: 26rpx 0;
  margin-bottom: 24rpx;
}

/* 分组标题：内置词书 6 本 + 自建若干，没有分组标题很难扫 */
.group { margin-bottom: 8rpx; }

.group-title {
  font-size: 22rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  padding: 8rpx 8rpx 12rpx;
}

/* 补充说明型标签（如"默认词书"）：与"自建/当前"区分，用中性灰 */
.tip-badge {
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(23, 32, 26, 0.06);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
}

.book-item {
  position: relative;
  margin-bottom: 20rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
}

.book-item.current {
  border-color: #2e6bff;
  border-color: var(--brand, #2e6bff);
  background: rgba(46, 107, 255, 0.08);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.08);
}

.bi-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bi-name-row { display: flex; align-items: center; }

.bi-name {
  font-size: 32rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.bi-badge {
  margin-left: 14rpx;
  font-size: 20rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  border-radius: 999rpx;
  padding: 2rpx 16rpx;
}

.bi-badge.self { color: #7c3aed; background: rgba(124, 58, 237, 0.12); }

.bi-radio {
  width: 44rpx;
  height: 44rpx;
  line-height: 44rpx;
  text-align: center;
  border-radius: 50%;
  border: 3rpx solid rgba(23, 32, 26, 0.14);
  border: 3rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.14);
  color: #ffffff;
  font-size: 26rpx;
  flex-shrink: 0;
}

.bi-radio.on {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  border-color: #2e6bff;
  border-color: var(--brand, #2e6bff);
}

.bi-desc {
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  line-height: 1.6;
}

.bi-meta {
  display: flex;
  margin-top: 18rpx;
}

.bi-meta-item {
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  margin-right: 28rpx;
}

.bi-track { margin-top: 16rpx; }

.empty { text-align: center; color: #98a19b; padding: 120rpx 0; font-size: 28rpx; }
.empty { text-align: center; color: var(--ink-3, #98a19b); padding: 120rpx 0; font-size: 28rpx; }

.tip-bottom {
  text-align: center;
  font-size: 22rpx;
  color: #b0b7b2;
  padding: 20rpx 0 40rpx;
}

/* 弹窗：.pop-mask / .pop-card / .dlg-* 统一见 App.vue 全局样式与 components/app-dialog */
</style>
