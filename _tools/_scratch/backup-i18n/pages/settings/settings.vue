<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="设置" />

    <!-- ===== 外观：深色 / 主题色 / 背景（大胶囊，默认收起） ===== -->
    <view class="sec" :class="{ open: openSec === 'appearance' }">
      <view class="sec-head" data-k="appearance" @tap="toggleSec">
        <text class="sec-name">外观</text>
        <text v-if="openSec !== 'appearance'" class="sec-hint">{{ secHint('appearance') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'appearance'">
        <view class="sub-title">深色模式</view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">深色模式</text>
            <text class="row-desc">{{ darkHint }}</text>
          </view>
          <switch
            :checked="darkOn"
            :disabled="followSystem"
            :color="brandMain"
            @change="e => toggleDark(e.detail.value)"
          />
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">跟随系统</text>
            <text class="row-desc">系统切换深浅时自动同步（当前系统：{{ systemDark ? '深色' : '浅色' }}）</text>
          </view>
          <switch :checked="followSystem" :color="brandMain" @change="e => toggleFollow(e.detail.value)" />
        </view>

        <view class="sub-title">主题色</view>
        <view class="accent-row">
          <view
            v-for="a in accents"
            :key="a.key"
            class="accent"
            :class="{ active: accentKey === a.key }"
            :data-k="a.key"
            @tap="pickAccent"
          >
            <view class="accent-dot" :style="{ background: a.main }"></view>
            <text class="accent-name">{{ a.name }}</text>
          </view>
        </view>

        <view class="sub-title">背景</view>
        <view class="bg-row">
          <view
            v-for="b in backgrounds"
            :key="b.key"
            class="bg-chip"
            :class="{ active: bgKey === b.key && !bgImage }"
            :style="{ background: bgSwatch(b) }"
            :data-k="b.key"
            @tap="pickBg"
          ><text class="bg-chip-name">{{ b.name }}</text></view>
          <view class="bg-chip pick" @tap="chooseBg"><text class="bg-chip-name">相册</text></view>
        </view>

        <view class="bg-actions" v-if="bgImage">
          <text class="bg-path">正在使用自定义图片</text>
          <text class="bg-clear" @tap="clearBg">恢复预设</text>
        </view>
        <view class="field slider-field">
          <text class="field-label">{{ bgImage ? '图片淡化' : '背景淡化' }}</text>
          <slider
            class="slider"
            :min="0"
            :max="0.7"
            :step="0.05"
            :value="mask"
            :active-color="brandMain"
            show-value
            @change="onMask"
          />
        </view>
        <view class="field slider-field">
          <text class="field-label">{{ bgImage ? '图片模糊' : '背景模糊' }}</text>
          <slider
            class="slider"
            :disabled="smooth"
            :min="0"
            :max="24"
            :step="1"
            :value="blur"
            :active-color="brandMain"
            show-value
            @change="onBlur"
          />
        </view>
        <view class="bg-hint">背景在最底层且固定不动：上下滑动时只有卡片、胶囊这些窗体在动。玻璃窗体透出背景的同时仍与背景分层；"淡化"在深色模式下叠的是黑色，用来给背景降亮度。</view>
      </view>
    </view>

    <!-- ===== 流畅模式（低端机退路） ===== -->
    <view class="sec" :class="{ open: openSec === 'perf' }">
      <view class="sec-head" data-k="perf" @tap="toggleSec">
        <text class="sec-name">流畅模式</text>
        <text v-if="openSec !== 'perf'" class="sec-hint">{{ secHint('perf') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'perf'">
        <view class="row">
          <view class="row-main">
            <text class="row-title">流畅模式</text>
            <text class="row-desc">关闭毛玻璃模糊、收小投影、缩短动效，滚动 / 切页更跟手</text>
          </view>
          <switch :checked="smooth" :color="brandMain" @change="onSmooth" />
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">设备性能检测</text>
            <text class="row-desc">{{ perfText }}</text>
          </view>
          <text class="row-action" @tap="reprobe">重新检测</text>
        </view>
        <view class="bg-hint">只改变观感：背景与卡片依然半透明、分层的玻璃质感保留，只是不再逐帧实时模糊。不影响任何功能，也不会清除学习数据。背景是渐变时卡片本来就不做实时模糊（渐变模糊前后的观感一致），这笔开销全省掉了。</view>
      </view>
    </view>

    <!-- ===== AI（大胶囊，连接参数默认收起） ===== -->
    <view class="sec" :class="{ open: openSec === 'ai' }">
      <view class="sec-head" data-k="ai" @tap="toggleSec">
        <text class="sec-name">AI</text>
        <text v-if="openSec !== 'ai'" class="sec-hint">{{ secHint('ai') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'ai'">
        <view class="row">
          <view class="row-main">
            <text class="row-title">启用 AI 服务</text>
            <text class="row-desc">开启后可用云端生成例句、点评与朗读</text>
          </view>
          <switch :checked="ai.enabled" :color="brandMain" @change="e => setAI('enabled', e.detail.value)" />
        </view>

        <template v-if="ai.enabled">
          <view class="field">
            <text class="field-label">服务商</text>
            <view class="chips">
              <view
                v-for="p in providers"
                :key="p.value"
                class="chip"
                :class="{ active: ai.provider === p.value }"
                @tap="selectProvider(p.value)"
              >{{ p.name }}</view>
            </view>
          </view>

          <!-- 状态校验 + 连通性测试：通过后明确显示"可正常使用" -->
          <view class="verify-box">
            <view class="verify-status" :class="status.cls">
              <text class="verify-dot"></text>
              <text class="verify-text">{{ status.text }}</text>
            </view>
            <button
              class="verify-btn"
              :class="{ disabled: !canTest }"
              :disabled="!canTest"
              @tap="runTest"
            >{{ testing ? '测试中…' : '测试连接' }}</button>
          </view>

          <view class="row adv-row" @tap="toggleAdv">
            <view class="row-main">
              <text class="row-title">连接参数</text>
              <text class="row-desc">地址 / 密钥 / 模型{{ aiAdvanced ? '' : '（已配置则无需改动）' }}</text>
            </view>
            <text class="adv-toggle">{{ aiAdvanced ? '收起' : '展开' }}</text>
          </view>

          <template v-if="aiAdvanced">
            <view class="field">
              <text class="field-label">API 地址</text>
              <input
                class="field-input"
                :value="ai.baseURL"
                placeholder="如 https://api.openai.com/v1"
                @blur="e => setAI('baseURL', e.detail.value)"
              />
            </view>
            <view class="field">
              <text class="field-label">API Key</text>
              <input
                class="field-input"
                :value="ai.apiKey"
                :password="!showKey"
                placeholder="仅保存在本机，不会上传"
                @blur="e => setAI('apiKey', e.detail.value)"
              />
              <text class="field-op" @tap="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</text>
            </view>
            <view class="field">
              <text class="field-label">模型</text>
              <input
                class="field-input"
                :value="ai.model"
                placeholder="例句生成用，如 gpt-4o-mini"
                @blur="e => setAI('model', e.detail.value)"
              />
            </view>
            <view class="field" v-if="ai.provider === 'custom'">
              <view class="row-main">
                <text class="row-title">地址支持语音</text>
                <text class="row-desc">若中转提供 /audio/speech，开启即可用云端音色（含中文）</text>
              </view>
              <switch :checked="ai.customTTS" :color="brandMain" @change="e => setAI('customTTS', e.detail.value)" />
            </view>
            <view class="field" v-if="ai.provider === 'custom'">
              <view class="row-main">
                <text class="row-title">地址支持出图</text>
                <text class="row-desc">若中转提供 /images/generations，首页指令就能真的生成背景图；不开则用本地渐变</text>
              </view>
              <switch :checked="ai.customImage" :color="brandMain" @change="e => setAI('customImage', e.detail.value)" />
            </view>
            <view class="field" v-if="imageSupported">
              <text class="field-label">出图模型</text>
              <view class="chips">
                <view
                  v-for="m in imageModels"
                  :key="m"
                  class="chip"
                  :class="{ active: (ai.imageModel || imageModels[0]) === m }"
                  @tap="setAI('imageModel', m)"
                >{{ m }}</view>
              </view>
            </view>
            <block v-if="ttsSupported">
              <view class="field">
                <text class="field-label">语音模型</text>
                <view class="chips">
                  <view
                    v-for="m in ttsModels"
                    :key="m"
                    class="chip"
                    :class="{ active: ai.ttsModel === m }"
                    @tap="setAI('ttsModel', m)"
                  >{{ m }}</view>
                </view>
              </view>
              <view class="field">
                <text class="field-label">或手填</text>
                <input
                  class="field-input"
                  :value="ai.ttsModel"
                  placeholder="默认 tts-1"
                  @blur="e => setAI('ttsModel', e.detail.value)"
                />
              </view>
            </block>
          </template>

          <view class="field-note" v-if="!ttsSupported">
            该服务商为文本大模型，不提供云端语音；朗读仍使用本地发音。
          </view>
          <view class="field-note" v-if="!imageSupported">
            该服务商不支持出图；首页「生成背景图」类指令会自动改成 AI 配色 + 本地渐变。
          </view>
        </template>
      </view>
    </view>

    <!-- ===== 语音（大胶囊） ===== -->
    <view class="sec" :class="{ open: openSec === 'voice' }">
      <view class="sec-head" data-k="voice" @tap="toggleSec">
        <text class="sec-name">语音</text>
        <text v-if="openSec !== 'voice'" class="sec-hint">{{ secHint('voice') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'voice'">
        <view class="row">
          <view class="row-main">
            <text class="row-title" :class="{ muted: !aiReady }">使用 AI 朗读</text>
            <text class="row-desc">{{ aiReady ? '更自然接近真人；失败自动回退本地发音' : '需先完成 AI 配置（地址 + 密钥）后才可使用' }}</text>
          </view>
          <switch :checked="voice.useAI && aiReady" :disabled="!aiReady" :color="brandMain" @change="e => setVoice('useAI', e.detail.value)" />
        </view>

        <template v-if="voice.useAI && aiReady">
          <block v-if="ttsSupported">
            <view class="field">
              <text class="field-label">音色</text>
              <view class="chips">
                <view
                  v-for="v in voices"
                  :key="v"
                  class="chip"
                  :class="{ active: ai.ttsVoice === v }"
                  @tap="setAI('ttsVoice', v)"
                >{{ v }}</view>
              </view>
            </view>
            <view class="field slider-field">
              <text class="field-label">语速</text>
              <slider
                class="slider"
                :min="0.5"
                :max="2"
                :step="0.1"
                :value="ai.ttsSpeed"
                :active-color="brandMain"
                show-value
                @change="e => setAI('ttsSpeed', e.detail.value)"
              />
            </view>
            <view class="field">
              <text class="field-label">试听音色</text>
              <view class="try-row">
                <view class="try-btn" @tap="tryVoice('zh')">中文示例</view>
                <view class="try-btn" @tap="tryVoice('en')">英文示例</view>
              </view>
            </view>
            <view class="field-note">云端音色对中文的自然度通常明显好于手机自带引擎；首次约 1-2 秒，之后同句走缓存。</view>
          </block>
          <view v-else class="field-note">当前服务商不支持云端语音，朗读将使用本地发音。</view>
        </template>

        <view class="row">
          <view class="row-main">
            <text class="row-title">英文朗读</text>
            <text class="row-desc">关闭后英文题干不再自动朗读（点击仍可发音）</text>
          </view>
          <switch :checked="voice.englishRead" :color="brandMain" @change="e => setVoice('englishRead', e.detail.value)" />
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">中文朗读</text>
            <text class="row-desc">关闭后中文内容不再自动朗读（点击仍可发音）</text>
          </view>
          <switch :checked="voice.chineseRead" :color="brandMain" @change="e => setVoice('chineseRead', e.detail.value)" />
        </view>
        <view class="field">
          <text class="field-label">整句朗读引擎</text>
          <view class="chips">
            <view
              v-for="e in engines"
              :key="e.key"
              class="chip"
              :class="{ active: engineKey === e.key }"
              :data-k="e.key"
              @tap="setEngine"
            >{{ e.name }}</view>
          </view>
          <view class="field-note">
            系统语音一次合成整句，中间没有网络请求，听感连贯；在线发音遇到整句取不到时会退化为逐词连读，听起来一顿一顿。
          </view>
        </view>

        <view class="row">
          <view class="row-main">
            <text class="row-title">系统语音状态</text>
            <text class="row-desc">{{ engineStatusText }}</text>
          </view>
          <view class="row-action" @tap="recheckEngine">重新检测</view>
        </view>

        <view class="field slider-field">
          <text class="field-label">本地语速</text>
          <slider
            class="slider"
            :min="0.5"
            :max="2"
            :step="0.1"
            :value="voice.speed"
            :active-color="brandMain"
            show-value
            @change="e => setVoice('speed', e.detail.value)"
          />
        </view>
      </view>
    </view>

    <!-- ===== 通知（大胶囊） ===== -->
    <view class="sec" :class="{ open: openSec === 'notify' }">
      <view class="sec-head" data-k="notify" @tap="toggleSec">
        <text class="sec-name">通知</text>
        <text v-if="openSec !== 'notify'" class="sec-hint">{{ secHint('notify') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'notify'">
        <view class="row">
          <view class="row-main">
            <text class="row-title">每日学习提醒</text>
            <text class="row-desc">仅在本机生效，不会推送服务器通知</text>
          </view>
          <switch :checked="notifications.daily" :color="brandMain" @change="e => setNotifications('daily', e.detail.value)" />
        </view>
        <view class="field" v-if="notifications.daily">
          <text class="field-label">提醒时间</text>
          <picker mode="time" :value="notifications.time" @change="e => setNotifications('time', e.detail.value)">
            <view class="picker-value">{{ notifications.time }}</view>
          </picker>
        </view>
      </view>
    </view>

    <!-- ===== AI 缓存（整体清除，不做逐条删除） ===== -->
    <view class="sec" :class="{ open: openSec === 'cache' }">
      <view class="sec-head" data-k="cache" @tap="toggleSec">
        <text class="sec-name">AI 缓存</text>
        <text v-if="openSec !== 'cache'" class="sec-hint">{{ cacheHint }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'cache'">
        <view class="row" @tap="askClear('words')">
          <view class="row-main">
            <text class="row-title danger">清空缓存单词</text>
            <text class="row-desc">搜索 / AI 释义缓存过的单词（{{ cacheStats.words }} 条）</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
        <view class="row" @tap="askClear('sentences')">
          <view class="row-main">
            <text class="row-title danger">清空缓存例句</text>
          <text class="row-desc">练习与释义生成过的 AI 例句（{{ cacheStats.sentences }} 条）</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
      </view>
    </view>

    <!-- ===== 数据与账号（原「隐私」+「账号安全」合并，大胶囊） ===== -->
    <view class="sec" :class="{ open: openSec === 'data' }">
      <view class="sec-head" data-k="data" @tap="toggleSec">
        <text class="sec-name">数据与账号</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'data'">
        <view class="row">
          <view class="row-main">
            <text class="row-title">本地存储学习数据</text>
            <text class="row-desc">学习进度仅保存在本机，卸载即清除</text>
          </view>
          <switch :checked="privacy.storeLocal" :color="brandMain" disabled />
        </view>
        <view class="row" @tap="clearLearningData">
          <view class="row-main">
            <text class="row-title danger">清除学习数据</text>
            <text class="row-desc">重置掌握度、错题与统计，不可恢复</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
        <view class="row" @tap="logout">
          <view class="row-main">
            <text class="row-title danger">退出登录</text>
            <text class="row-desc">重置个人资料与设置（学习数据保留）</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
      </view>
    </view>

    <!-- ===== 关于（大胶囊） ===== -->
    <view class="sec" :class="{ open: openSec === 'about' }">
      <view class="sec-head" data-k="about" @tap="toggleSec">
        <text class="sec-name">关于</text>
        <text v-if="openSec !== 'about'" class="sec-hint">{{ secHint('about') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'about'">
        <view class="row" @tap="openDonate">
          <view class="row-main">
            <text class="row-title">支持 AWword</text>
            <text class="row-desc">请作者喝一杯 · 支付宝 / 微信扫码</text>
          </view>
          <text class="row-action">打赏 ›</text>
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">版本</text>
          </view>
          <text class="row-value">{{ version }}</text>
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">介绍</text>
          </view>
          <text class="row-value">背单词 · 本地离线可用的翻译练习工具</text>
        </view>
      </view>
    </view>

    <!-- 危险操作确认（统一弹窗，替代系统 showModal） -->
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
import * as settings from '../../utils/settings'
import * as store from '../../utils/store'
import { stop as voiceStop, status as voiceStatus, resetVoice } from '../../services/voice.js'
import { validateKeyFormat, testAIConnection } from '../../services/ai-content.js'
import { PROVIDER_PRESETS, providerSupportsTTS, TTS_MODELS } from '../../services/config.js'
import { IMAGE_MODELS, supportsImage } from '../../services/image-gen.js'
import * as aiCache from '../../utils/ai-cache.js'
import { speakSentence as aiSpeak } from '../../services/voice.js'
import {
  BACKGROUNDS, ACCENTS,
  current as currentBg, setBackground,
  currentAccent, setAccent,
  currentBgImage, currentMask, setMask, currentBlur, setBlur,
  chooseBackgroundImage, clearBgImage,
  isDark, systemPrefersDark, currentDark, currentFollowSystem, setDark, setFollowSystem,
  currentSmooth, setSmooth
} from '../../utils/theme.js'
import * as perf from '../../utils/perf.js'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../components/app-dialog/app-dialog.vue'

const TRY_TEXT = {
  zh: '这个词的意思是不可避免的，中文发音应该更自然一些。',
  en: 'This sentence should sound much more natural.'
}

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      confirm: { show: false, title: '', content: '', confirmText: '确定', action: '' },
      // 外观
      accents: ACCENTS,
      accentKey: 'blue',
      backgrounds: BACKGROUNDS,
      bgKey: 'default',
      bgImage: '',
      mask: 0.35,
      blur: 0,
      // 大胶囊分组：一次只展开一个（'' 表示全部收起）
      openSec: '',
      darkOn: false,
      followSystem: false,
      systemDark: false,
      // AI
      ai: {},
      ttsModels: TTS_MODELS,
      imageModels: IMAGE_MODELS,
      showKey: false,
      aiAdvanced: false,
      providers: PROVIDER_PRESETS,
      voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
      testing: false,
      // 语音 / 通知 / 隐私
      voice: {},
      engines: [
        { key: 'auto', name: '自动（系统优先）' },
        { key: 'native', name: '只用系统语音' },
        { key: 'online', name: '只用在线发音' }
      ],
      engineStatus: null,
      notifications: {},
      privacy: {},
      // AI 缓存：只暴露条数，内容按类别整体清除
      cacheStats: { words: 0, sentences: 0, updatedAt: 0 },
      // 流畅模式：关闭毛玻璃模糊（低端机退路）
      smooth: false,
      perfText: '未检测',
      version: '1.0.0'
    }
  },
  computed: {
    // 当前主题色的十六进制（用于 switch / slider / modal 等只接受色值的组件属性）
    brandMain() {
      const a = ACCENTS.find(x => x.key === this.accentKey)
      return a ? a.main : '#2e6bff'
    },
    ttsSupported() {
      return providerSupportsTTS(this.ai.provider);
    },
    // 出图：只有明确支持的服务商才显示模型选择（其余走本地渐变兜底）
    // 先读 this.ai，保证切服务商 / 改开关后这个 computed 会重新求值
    imageSupported() {
      const p = this.ai && this.ai.provider;
      return !!p && supportsImage();
    },
    // AI 是否已具备基本可用条件（总开关 + 地址 + 密钥）
    aiReady() {
      return !!(this.ai.enabled && this.ai.baseURL && this.ai.apiKey);
    },
    // 输入格式校验（纯本地，不发请求）
    keyFormat() {
      return validateKeyFormat({
        baseURL: this.ai.baseURL,
        apiKey: this.ai.apiKey,
        model: this.ai.model
      });
    },
    canTest() {
      return !this.testing && !!this.ai.enabled && this.keyFormat.ok;
    },
    // 统一状态：idle（未验证）/ ok（可正常使用）/ warn（格式问题）/ fail（连接失败）
    status() {
      if (!this.ai.enabled) return { cls: 'idle', text: 'AI 服务已关闭' };
      if (!this.keyFormat.ok) return { cls: 'warn', text: this.keyFormat.reason };
      const v = this.ai.verify;
      if (v && v.sig === this.configSig()) {
        if (v.ok) {
          return { cls: 'ok', text: '可正常使用' + (v.latency ? '（' + v.latency + ' ms）' : '') };
        }
        return { cls: 'fail', text: v.msg || '连接失败' };
      }
      return { cls: 'idle', text: '格式校验通过，点击「测试连接」验证' };
    },
    // 跟随系统时，深色开关显示的是"系统当前值"，不允许手动改
    darkHint() {
      // 跟随系统时把读到的值直接摆出来：读不到就是配置/内核问题，一眼能看出来
      if (this.followSystem) return '已跟随系统 · 读取到' + (this.systemDark ? '深色' : '浅色');
      return this.darkOn ? '底色转深灰，文字转亮，背景图自动降亮度' : '当前为浅色';
    },
    engineKey() {
      return this.voice.engine || 'auto';
    },
    engineStatusText() {
      const s = this.engineStatus;
      if (!s) return '点击「重新检测」查看';
      if (!s.provider || s.provider === 'youdao-only') {
        return '未启用系统语音（当前设置只用在线发音）';
      }
      if (!s.nativeReady) return '系统语音未就绪，将回退在线发音';
      const l = s.lang || {};
      const zh = l.zh === false ? '中文不可用' : '中文可用';
      const en = l.en === false ? '英文不可用' : '英文可用';
      return '系统语音已就绪 · ' + zh + ' / ' + en + (l.device ? '（设备语言 ' + l.device + '）' : '');
    }
  },
  onShow() {
    this.refresh()
    this.accentKey = currentAccent()
    this.bgKey = currentBg()
    this.bgImage = currentBgImage()
    this.mask = currentMask()
    this.blur = currentBlur()
    this.darkOn = isDark()
    this.followSystem = currentFollowSystem()
    this.systemDark = systemPrefersDark()
    this.version = this.readVersion()
  },
  methods: {
    // 背景色块：深色模式下显示压暗变体，与实际背景一致、各预设之间也能区分开
    bgSwatch(b) {
      return this.darkOn ? (b.darkCss || b.css) : b.css
    },
    // ---------- 大胶囊分组 ----------
    toggleSec(e) {
      const k = e.currentTarget.dataset.k
      this.openSec = this.openSec === k ? '' : k
    },

    // 打赏页（设置 → 关于 → 支持 AWword）
    openDonate() {
      uni.navigateTo({ url: '/pages/donate/donate' })
    },
    // 收起时在胶囊右侧显示一行摘要，展开后由内容自己表达
    secHint(k) {
      if (k === 'appearance') {
        const a = ACCENTS.find(x => x.key === this.accentKey)
        return (a ? a.name : '') + ' · ' + (this.darkOn ? '深色' : '浅色')
      }
      if (k === 'ai') return this.ai.enabled ? (this.aiReady ? '已开启' : '待配置') : '未开启'
      if (k === 'voice') return this.voice.useAI && this.aiReady ? 'AI 朗读' : '本地发音'
      if (k === 'notify') return this.notifications.daily ? this.notifications.time : '已关闭'
      if (k === 'about') return 'v' + this.version
      if (k === 'cache') return this.cacheHint
      if (k === 'perf') return this.smooth ? '已开启' : '已关闭'
      return ''
    },

    // 收起时的缓存摘要：单词 / 例句 各多少条
    cacheHint() {
      const n = (this.cacheStats.words || 0) + (this.cacheStats.sentences || 0)
      return n ? n + ' 条' : '暂无'
    },

    // 设备性能检测：立刻跑一次，跑完把结果和"要不要开流畅模式"一起写回
    reprobe() {
      this.perfText = '检测中…'
      // 让"检测中"先渲染出来，再跑阻塞主线程约 60ms 的测算
      setTimeout(() => {
        try {
          const r = perf.autoDowngrade(true)
          this.smooth = !!r.smooth
          this.blur = this.smooth ? 0 : this.blur
        } catch (e) {}
        this.perfText = perf.summary().text
        try { this.refreshAppTheme() } catch (e) {}
      }, 60)
    },

    // 流畅模式：只影响观感（关掉毛玻璃模糊），不动任何数据
    onSmooth(e) {
      // 手动拨的开关：auto 置 false，之后自动检测不再覆盖这个选择
      this.smooth = setSmooth(e.detail.value, false)
      // 背景模糊在流畅模式下被强制归零，滑块要跟着回弹
      if (this.smooth) this.blur = 0
      // 根节点 class 变了要立刻重算，否则当前页要等下次 onShow 才生效
      try { this.refreshAppTheme() } catch (err) {}
    },

    // ---------- AI 缓存（按类别整体清除，不支持逐条删） ----------
    askClear(kind) {
      const isWord = kind === 'words'
      const n = isWord ? this.cacheStats.words : this.cacheStats.sentences
      if (!n) {
        uni.showToast({ title: isWord ? '暂无缓存单词' : '暂无缓存例句', icon: 'none' })
        return
      }
      this.confirm = {
        show: true,
        title: isWord ? '清空缓存单词' : '清空缓存例句',
        content: (isWord
          ? '将删除 ' + n + ' 条缓存单词的释义记录，'
          : '将删除 ' + n + ' 条缓存例句，')
          + '不会影响当前词书与学习进度。缓存内容无法逐条删除，只能按类别清空。',
        confirmText: '清空',
        action: isWord ? 'clear-words' : 'clear-sentences'
      }
    },

    doClear(kind) {
      if (kind === 'words') aiCache.clearWords()
      else aiCache.clearSentences()
      this.cacheStats = aiCache.stats()
      uni.showToast({
        title: kind === 'words' ? '已清空缓存单词' : '已清空缓存例句',
        icon: 'success'
      })
    },
    // ---------- 外观 ----------
    pickAccent(e) {
      const key = e.currentTarget.dataset.k
      this.accentKey = key
      setAccent(key)
      this.refreshAppTheme()
    },
    pickBg(e) {
      const key = e.currentTarget.dataset.k
      this.bgKey = key
      this.bgImage = ''
      setBackground(key)
      this.refreshAppTheme()
    },
    async chooseBg() {
      const p = await chooseBackgroundImage()
      if (p) {
        this.bgImage = p
        this.mask = currentMask()
        this.blur = currentBlur()
        this.refreshAppTheme()
        uni.showToast({ title: '已应用背景图', icon: 'success' })
      }
    },
    clearBg() {
      clearBgImage()
      this.bgImage = ''
      this.refreshAppTheme()
    },
    onMask(e) {
      const v = Number(e.detail.value) || 0
      this.mask = v
      setMask(v)
      this.refreshAppTheme()
    },
    onBlur(e) {
      const v = Number(e.detail.value) || 0
      this.blur = v
      setBlur(v)
      this.refreshAppTheme()
    },
    toggleDark(v) {
      if (this.followSystem) return
      setDark(!!v)
      this.darkOn = isDark()
      this.refreshAppTheme()
    },
    toggleFollow(v) {
      setFollowSystem(!!v)
      this.followSystem = currentFollowSystem()
      this.darkOn = isDark()
      this.systemDark = systemPrefersDark()
      this.refreshAppTheme()
    },
    // ---------- AI ----------
    toggleAdv() {
      this.aiAdvanced = !this.aiAdvanced
    },
    // 试听云端音色：直接用当前配置朗读一句中/英示例（未配置会自动降级本地）
    tryVoice(lang) {
      try { voiceStop() } catch (e) {}
      aiSpeak(TRY_TEXT[lang] || TRY_TEXT.en, { lang })
    },
    refresh() {
      const s = settings.get()
      this.ai = Object.assign({}, s.ai)
      this.voice = Object.assign({}, s.voice)
      this.notifications = Object.assign({}, s.notifications)
      this.privacy = Object.assign({}, s.privacy)
      this.cacheStats = aiCache.stats()
      this.smooth = currentSmooth()
      this.perfText = perf.summary().text
      this.readEngineStatus()
    },
    // 配置指纹：地址/模型/密钥任一变化即视为"未验证"
    configSig() {
      return [this.ai.baseURL || '', this.ai.model || '', this.ai.apiKey || ''].join('|')
    },
    setAI(key, value) {
      const patch = { [key]: value }
      // 影响可用性的字段变更后，清除上一次的验证结果
      if (key === 'baseURL' || key === 'apiKey' || key === 'model') {
        patch.verify = { sig: '', ok: false, msg: '', latency: 0, ts: 0 }
      }
      settings.set({ ai: patch })
      this.refresh()
      // 密钥填完（格式通过）时自动校验一次，让"可正常使用"自动出现
      if (key === 'apiKey' && this.canTest) {
        this.runTest()
      }
    },
    // 一键选择预设：自动填入该服务商的地址/模型（自定义除外，留给用户手填）
    selectProvider(value) {
      const preset = PROVIDER_PRESETS.find(p => p.value === value)
      const patch = { provider: value, verify: { sig: '', ok: false, msg: '', latency: 0, ts: 0 } }
      if (preset && preset.value !== 'custom') {
        patch.baseURL = preset.baseURL
        patch.model = preset.model
        patch.ttsModel = preset.ttsModel
      }
      settings.set({ ai: patch })
      this.refresh()
    },
    // 连通性测试：真实调用一次（max_tokens=8），成功即写入"可正常使用"
    async runTest() {
      if (!this.canTest) return
      this.testing = true
      const sig = this.configSig()
      try {
        const r = await testAIConnection()
        settings.set({ ai: { verify: { sig, ok: true, msg: '', latency: r.latencyMs || 0, ts: Date.now() } } })
        this.refresh()
        uni.showToast({ title: '可正常使用', icon: 'success' })
      } catch (e) {
        const msg = (e && e.message) ? e.message : '连接失败'
        settings.set({ ai: { verify: { sig, ok: false, msg, latency: 0, ts: Date.now() } } })
        this.refresh()
      } finally {
        this.testing = false
      }
    },
    setVoice(key, value) {
      settings.set({ voice: { [key]: value } })
      this.refresh()
      // 语速变化即时生效到本地 TTS
      if (key === 'speed') {
        try { voiceStop() } catch (e) {}
      }
    },
    setEngine(e) {
      const k = e && e.currentTarget ? e.currentTarget.dataset.k : ''
      if (!k) return
      settings.set({ voice: { engine: k } })
      try { voiceStop() } catch (err) {}
      this.refresh()
      this.readEngineStatus()
    },
    recheckEngine() {
      // 清掉"语言不可用 / 初始化失败"的缓存后重新预热，再读一次状态
      try { this.engineStatus = resetVoice() } catch (e) { this.readEngineStatus() }
      try { uni.showToast({ title: '已重新检测', icon: 'none', duration: 1200 }) } catch (e) {}
    },
    readEngineStatus() {
      try { this.engineStatus = voiceStatus ? voiceStatus() : null } catch (e) { this.engineStatus = null }
    },
    setNotifications(key, value) {
      settings.set({ notifications: { [key]: value } })
      this.refresh()
    },
    readVersion() {
      // #ifdef APP-PLUS
      try {
        const v = plus.runtime.version
        if (v) return v
      } catch (e) {}
      // #endif
      try {
        const info = uni.getSystemInfoSync()
        if (info && info.appVersion) return info.appVersion
      } catch (e) {}
      return '1.0.0'
    },
    clearLearningData() {
      this.confirm = {
        show: true,
        title: '清除学习数据',
        content: '将重置全部掌握度、错题与统计，且不可恢复。确定继续？',
        confirmText: '清除',
        action: 'clear'
      }
    },
    logout() {
      this.confirm = {
        show: true,
        title: '退出登录',
        content: '将重置个人资料与全部设置（AI 配置、朗读偏好等），学习数据保留。确定继续？',
        confirmText: '退出',
        action: 'logout'
      }
    },

    onConfirmYes() {
      const act = this.confirm.action
      this.confirm.show = false
      if (act === 'clear') {
        store.reset()
        uni.showToast({ title: '已清除', icon: 'success' })
      } else if (act === 'logout') {
        settings.reset()
        this.refresh()
        uni.showToast({ title: '已退出', icon: 'success' })
      } else if (act === 'clear-words') {
        this.doClear('words')
      } else if (act === 'clear-sentences') {
        this.doClear('sentences')
      }
    }
  }
}
</script>

<style>
/* ===== 大胶囊分组 ===== */
/* 收起时 = 只有名字的悬浮胶囊（和顶栏/底栏同一套玻璃语言）；
   展开后 = 一张可调的大卡片，圆角从"全圆"过渡到"大圆角"。 */
.sec {
  margin-bottom: 20rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  backdrop-filter: blur(12px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  box-shadow: 0 10rpx 30rpx rgba(23, 32, 26, 0.07), 0 2rpx 6rpx rgba(23, 32, 26, 0.04);
  box-shadow: 0 10rpx 30rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.07), 0 2rpx 6rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.04);
  box-sizing: border-box;
  /* 圆角不做过渡：内容一出现卡片就变高了，此时如果圆角还在 999rpx→32rpx 的中间态，
     会看到"已经很高但四个角还是巨圆"的畸形卡片。改成瞬间切换，展开感交给内容生长。 */
}


.sec.open { border-radius: 32rpx; }

.sec-head {
  display: flex;
  align-items: center;
  height: 96rpx;
  padding: 0 40rpx;
}

.sec-name {
  font-size: 30rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.sec-hint {
  margin-left: auto;
  margin-right: 18rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.sec-arrow {
  font-size: 34rpx;
  line-height: 1;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  transition: transform 220ms ease;
}

.sec.open .sec-arrow {
  transform: rotate(90deg);
  color: #2e6bff;
  color: var(--brand, #2e6bff);
}

/* 展开：内容从 0 高度长出来（max-height 动画，起点由 CSS 动画第一帧给出，不需要 JS 量高度）。
   用"起步快"的 ease-out，视觉上 200ms 左右就到位，剩下的时长只是把 max-height 推到上限，
   不再有可见变化——既有展开感又不拖沓。收起走 v-if 直接移除，零延迟、最跟手。 */
.sec-body {
  padding: 0 40rpx 40rpx;
  overflow: hidden;
  animation: sec-open 260ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

@keyframes sec-open {
  from {
    max-height: 0;
    padding-bottom: 0;
    opacity: 0;
    transform: translateY(-8rpx);
  }
  to {
    max-height: 4000rpx;
    padding-bottom: 40rpx;
    opacity: 1;
    transform: none;
  }
}

/* 系统开启"减少动效"时直接就位 */
@media (prefers-reduced-motion: reduce) {
  .sec-body { animation: none; }
}

.sec-body .row:last-child { border-bottom: none; }
.sec-body .field:last-child { border-bottom: none; }

.section-title {
  font-size: 32rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  margin: 32rpx 0 20rpx;
}

.group { padding: 8rpx 36rpx; }

.sub-title {
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  letter-spacing: 1rpx;
  padding: 24rpx 0 4rpx;
}

/* 主题色：一行小圆点 */
.accent-row {
  display: flex;
  flex-wrap: wrap;
  padding: 12rpx 0 8rpx;
}

.accent {
  width: 20%;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 18rpx;
}

.accent-dot {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(255, 255, 255, 0.9);
  border: 4rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.9));
  box-shadow: 0 4rpx 12rpx rgba(23, 32, 26, 0.1);
  box-shadow: 0 4rpx 12rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.1);
  transition: transform 180ms ease;
}

.accent.active .accent-dot { transform: scale(1.12); }

.accent-name {
  margin-top: 10rpx;
  font-size: 20rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.accent.active .accent-name {
  color: var(--brand-strong, #1d4fd8);
  font-weight: 600;
}

/* 背景：横向胶囊色板 + 相册入口 */
.bg-row {
  display: flex;
  flex-wrap: wrap;
  padding: 12rpx 0 8rpx;
}

.bg-chip {
  width: 30%;
  height: 88rpx;
  border-radius: 20rpx;
  margin: 0 3% 16rpx 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 3rpx solid rgba(255, 255, 255, 0.85);
  border: 3rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.85));
  box-shadow: 0 4rpx 14rpx rgba(23, 32, 26, 0.06);
  box-shadow: 0 4rpx 14rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.06);
  overflow: hidden;
}

.bg-chip:nth-child(3n) { margin-right: 0; }

.bg-chip.active {
  border-color: var(--brand, #2e6bff);
  box-shadow: 0 6rpx 18rpx rgba(var(--brand-rgb, 46, 107, 255), 0.24);
}

.bg-chip-name {
  font-size: 22rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  /* 深色模式下色块变深，给标签加一圈浅描边保持分离感 */
  border: 2rpx solid rgba(255, 255, 255, 0.35);
  border-radius: 999rpx;
  padding: 2rpx 16rpx;
}

.bg-chip.pick {
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border-style: dashed;
}

.bg-chip.pick .bg-chip-name {
  color: var(--brand-strong, #1d4fd8);
  background: transparent;
}

.bg-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4rpx 0 8rpx;
}

.bg-path { font-size: 22rpx; color: #5a6560; }
.bg-path { font-size: 22rpx; color: var(--ink-2, #5a6560); }

.bg-clear {
  font-size: 24rpx;
  color: var(--brand-strong, #1d4fd8);
}

.bg-hint {
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  line-height: 1.6;
  padding: 4rpx 0 24rpx;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.07);
  border-bottom: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.group .row:last-child { border-bottom: none; }

.row-main { flex: 1; min-width: 0; margin-right: 20rpx; }

.row-title { display: block; font-size: 30rpx; color: #17201a; }
.row-title { display: block; font-size: 30rpx; color: var(--ink-1, #17201a); }

.row-title.danger { color: #e5484d; }

.row-desc { display: block; margin-top: 6rpx; font-size: 22rpx; color: #98a19b; line-height: 1.5; }
.row-desc { display: block; margin-top: 6rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); line-height: 1.5; }

.row-value { font-size: 24rpx; color: #5a6560; flex-shrink: 0; text-align: right; }
.row-value { font-size: 24rpx; color: var(--ink-2, #5a6560); flex-shrink: 0; text-align: right; }

.row-arrow { font-size: 32rpx; color: #c8cdc9; flex-shrink: 0; }

/* 行内文字按钮（如"重新检测"） */
.row-action {
  flex-shrink: 0;
  font-size: 24rpx;
  font-weight: 500;
  letter-spacing: 1rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(46, 107, 255, 0.1);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.1);
}
.row-action:active { opacity: 0.6; }

.adv-row { border-top: 2rpx solid rgba(23, 32, 26, 0.07); }
.adv-row { border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07); }

.adv-toggle {
  font-size: 24rpx;
  color: var(--brand-strong, #1d4fd8);
  flex-shrink: 0;
}

.field {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.07);
  border-bottom: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.field:last-child { border-bottom: none; }

.field-note {
  font-size: 22rpx;
  color: #f79009;
  line-height: 1.5;
  padding: 4rpx 0 20rpx;
}

.row-title.muted { color: #b0b7b2; }

/* 状态校验 + 测试连接 */
.verify-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 0 8rpx;
}

.verify-status {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  margin-right: 20rpx;
}

.verify-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: #c8cdc9;
  flex-shrink: 0;
  margin-right: 12rpx;
}

.verify-text { font-size: 24rpx; color: #98a19b; line-height: 1.4; }
.verify-text { font-size: 24rpx; color: var(--ink-3, #98a19b); line-height: 1.4; }

.verify-status.ok .verify-dot { background: var(--brand-strong, #1d4fd8); }
.verify-status.ok .verify-text { color: var(--brand-strong, #1d4fd8); font-weight: 600; }

.verify-status.warn .verify-dot { background: #f79009; }
.verify-status.warn .verify-text { color: #b54708; }

.verify-status.fail .verify-dot { background: #e5484d; }
.verify-status.fail .verify-text { color: #e5484d; }

.verify-btn {
  flex-shrink: 0;
  height: 68rpx;
  line-height: 68rpx;
  padding: 0 32rpx;
  font-size: 24rpx;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.3);
  border-radius: 999rpx;
}

.verify-btn::after { border: none; }

.verify-btn.disabled {
  color: #b0b7b2;
  background: rgba(255, 255, 255, 0.4);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.4);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border-color: rgba(23, 32, 26, 0.1);
  border-color: rgba(var(--neutral-rgb, 23, 32, 26), 0.1);
}

.field-label { width: 150rpx; font-size: 26rpx; color: #5a6560; flex-shrink: 0; }
.field-label { width: 150rpx; font-size: 26rpx; color: var(--ink-2, #5a6560); flex-shrink: 0; }

/* 输入块 / 选择器：与卡片同一套玻璃语言 */
.field-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 14rpx 20rpx;
  font-size: 26rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.field-op { font-size: 24rpx; color: var(--brand, #2e6bff); margin-left: 16rpx; flex-shrink: 0; }

/* 试听按钮 */
.try-row { display: flex; flex: 1; }

.try-btn {
  flex: 1;
  text-align: center;
  font-size: 24rpx;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.3);
  border-radius: 999rpx;
  padding: 12rpx 0;
  margin-right: 16rpx;
}
.try-btn:last-child { margin-right: 0; }
.try-btn:active { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }

.slider-field { align-items: center; }

.slider { flex: 1; margin: 0; }

.chips { display: flex; flex-wrap: wrap; flex: 1; }

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

.chip.active {
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  color: #ffffff;
  font-weight: 600;
  border-color: #2e6bff;
  border-color: var(--brand, #2e6bff);
}

.picker-value {
  flex: 1;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: blur(8px) saturate(180%);
  backdrop-filter: blur(8px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 14rpx 20rpx;
  font-size: 26rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
</style>
