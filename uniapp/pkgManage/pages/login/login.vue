<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('登录')" />

    <view class="card auth-card">
      <!-- 模式切换 -->
      <view class="mode-switch">
        <view class="mode-item" :class="{ active: mode === 'login' }" data-m="login" @tap="switchMode">{{ $t('登录') }}</view>
        <view class="mode-item" :class="{ active: mode === 'register' }" data-m="register" @tap="switchMode">{{ $t('注册') }}</view>
      </view>

      <view class="field">
        <text class="field-label">{{ $t('用户名') }}</text>
        <input
          class="field-input"
          :value="username"
          maxlength="20"
          :placeholder="$t('2-20 个字符')"
          placeholder-style="color:#a8b0ab;font-size:26rpx"
          @input="e => username = e.detail.value"
        />
      </view>

      <view class="field">
        <text class="field-label">{{ $t('密码') }}</text>
        <input
          class="field-input"
          :value="password"
          password
          maxlength="72"
          :placeholder="$t('至少 8 位')"
          placeholder-style="color:#a8b0ab;font-size:26rpx"
          @input="e => password = e.detail.value"
        />
      </view>

      <view class="field" v-if="mode === 'register'">
        <text class="field-label">{{ $t('确认密码') }}</text>
        <input
          class="field-input"
          :value="password2"
          password
          maxlength="72"
          :placeholder="$t('再输入一次')"
          placeholder-style="color:#a8b0ab;font-size:26rpx"
          @input="e => password2 = e.detail.value"
        />
      </view>

      <button class="btn-primary submit-btn" :disabled="submitting" @tap="submit">
        {{ submitting ? $t('处理中…') : (mode === 'login' ? $t('登录') : $t('注册并登录')) }}
      </button>

      <view class="tip" v-if="mode === 'register'">
        {{ $t('注册只在') }}<text class="tip-strong">{{ $t('本机') }}</text>{{ $t('创建账号：密码经单向哈希后存进本地数据库，任何地方都不保存明文。') }}
      </view>
      <view class="tip" v-else>
        {{ $t('忘记密码无法找回（数据只在本机），可重新注册一个账号。') }}
      </view>
    </view>

    <!-- 存储方式说明：如实告诉用户当前落在哪里 -->
    <view class="card env-card">
      <view class="env-row">
        <text class="env-label">{{ $t('数据库') }}</text>
        <text class="env-value">{{ backendText }}</text>
      </view>
      <view class="env-row">
        <text class="env-label">{{ $t('会话存储') }}</text>
        <text class="env-value" :class="{ warn: !secureOk }">{{ storageText }}</text>
      </view>
      <view class="env-row">
        <text class="env-label">{{ $t('口令哈希') }}</text>
        <text class="env-value">{{ algoText }}</text>
      </view>
      <view class="env-note">{{ $t('账号体系为纯本地实现，现阶段不发起任何网络请求。') }}</view>
    </view>
  </view>
</template>

<script>
import { t } from '../../../utils/i18n.js';
// 登录 / 注册（本地账号）
// 领域层：services/auth.ts → repositories（抽象）→ SQLite / KV
// 会话 token 存 plus 安全存储，密码只留单向哈希。
import * as settings from '../../../utils/settings'
import * as auth from '../../../services/auth'
import * as sync from '../../../services/account-sync'
import { currentAlgo, isArgon2Enabled } from '../../../utils/hash'
import { backend } from '../../../repositories/index.ts'
import { supportsSecure, lastBackend } from '../../../utils/secure-storage'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

export default {
  components: { FloatNavbar },
  data() {
    return {
      mode: 'login',
      username: '',
      password: '',
      password2: '',
      submitting: false,
      backendText: '',
      storageText: '',
      secureOk: true,
      algoText: ''
    }
  },
  onShow() {
    this.refreshEnv()
  },
  methods: {
    refreshEnv() {
      this.backendText = backend() === 'sqlite' ? t('SQLite（本机）') : t('本地存储（当前环境无 SQLite）')
      const ok = supportsSecure()
      this.secureOk = ok
      this.storageText = ok ? t('系统安全存储') : (lastBackend() ? t('普通存储（降级）') : t('系统安全存储'))
      this.algoText = isArgon2Enabled() ? 'argon2id' : (currentAlgo() === 'argon2id' ? 'argon2id' : 'PBKDF2-SHA256')
    },
    switchMode(e) {
      const m = e.currentTarget.dataset.m
      if (m === this.mode) return
      this.mode = m
      this.password2 = ''
    },
    async submit() {
      if (this.submitting) return
      const username = String(this.username || '').trim()
      const password = String(this.password || '')

      const uErr = auth.validateUsername(username)
      if (uErr) { uni.showToast({ title: uErr, icon: 'none' }); return }
      const pErr = auth.validatePassword(password)
      if (pErr) { uni.showToast({ title: pErr, icon: 'none' }); return }
      if (this.mode === 'register' && password !== String(this.password2 || '')) {
        uni.showToast({ title: t('两次输入的密码不一致'), icon: 'none' })
        return
      }

      this.submitting = true
      try {
        if (this.mode === 'register') {
          await auth.register(username, password)
        } else {
          await auth.login(username, password)
        }
        // 登录成功：把本地已有的收藏导入账号维度（后台做，不阻塞跳转）
        try {
          sync.importFavorites(settings.favorites())
        } catch (e) { /* ignore */ }
        this.refreshEnv()
        uni.showToast({ title: this.mode === 'register' ? t('注册成功') : t('登录成功'), icon: 'success' })
        setTimeout(() => {
          if (getCurrentPages().length > 1) uni.navigateBack()
          else uni.switchTab({ url: '/pages/profile/profile' })
        }, 500)
      } catch (e) {
        const msg = (e && e.message) || t('操作失败')
        uni.showToast({ title: msg, icon: 'none' })
      } finally {
        this.submitting = false
      }
    }
  }
}
</script>

<style>
.auth-card { margin-bottom: 20rpx; }

.mode-switch {
  display: flex;
  margin-bottom: 32rpx;
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
  border-radius: 999rpx;
  padding: 6rpx;
}

.mode-item {
  flex: 1;
  text-align: center;
  font-size: 28rpx;
  font-weight: 500;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  padding: 16rpx 0;
  border-radius: 999rpx;
}

.mode-item.active {
  color: #ffffff;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
}

.field { display: flex; align-items: center; margin-bottom: 24rpx; }

.field-label { width: 150rpx; font-size: 26rpx; color: #5a6560; flex-shrink: 0; }
.field-label { width: 150rpx; font-size: 26rpx; color: var(--ink-2, #5a6560); flex-shrink: 0; }

.field-input {
  flex: 1;
  min-width: 0;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 18rpx 20rpx;
  font-size: 28rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.submit-btn { margin-top: 12rpx; height: 88rpx; font-size: 30rpx; }

.tip {
  margin-top: 24rpx;
  font-size: 22rpx;
  line-height: 1.7;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.tip-strong { color: #1d4fd8; font-weight: 600; }
.tip-strong { color: var(--brand-strong, #1d4fd8); font-weight: 600; }

.env-card { padding: 28rpx 36rpx; }

.env-row { display: flex; align-items: center; justify-content: space-between; padding: 12rpx 0; }

.env-label { font-size: 26rpx; color: #5a6560; }
.env-label { font-size: 26rpx; color: var(--ink-2, #5a6560); }

.env-value { font-size: 26rpx; color: #17201a; font-weight: 500; }
.env-value { font-size: 26rpx; color: var(--ink-1, #17201a); font-weight: 500; }

.env-value.warn { color: #f79009; }

.env-note {
  margin-top: 16rpx;
  padding-top: 16rpx;
  border-top: 2rpx solid rgba(23, 32, 26, 0.07);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
