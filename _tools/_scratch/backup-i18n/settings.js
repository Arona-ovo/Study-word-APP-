// utils/settings.js - 应用设置 / 个人资料 / 收藏 的本地状态
// 独立于学习进度（store.js），单独存一个 storage key，互不干扰。
// 所有 AI 相关密钥仅存于此处（或部署环境变量），源码不出现任何字面量密钥。

const KEY = 'fj_app_settings_v1';
let cache = null;

// 未设置昵称时的默认显示（与 pages/profile/profile.vue 的 DEFAULT_NICKNAME 保持一致）
const DEFAULT_NICKNAME = 'arona';
// 老版本沿用过的默认昵称，仅用于一次性迁移
const LEGACY_NICKNAME = '学习者';

function defaults() {
  return {
    // 界面语言：'zh' | 'en'（见 utils/i18n.js）。
    // zh 态直接显示中文原文，en 态查 utils/i18n-en.js —— 查不到就回退中文。
    locale: 'zh',
    // 个人资料（纯本地，无后端）；改默认值时记得同步 pages/profile/profile.vue 的 DEFAULT_NICKNAME
    profile: { avatar: '', nickname: DEFAULT_NICKNAME, account: '', bio: '' },
    // 收藏：{ type:'word'|'sentence', id, word?, en?, zh? }
    favorites: [],
    // 首页模块顺序（可自定义 / 收纳），id 见 utils/home-layout.ts 的 MODULES。
    // 默认留空 → 由 home-layout 的 defaultLayout() 决定，保证新增模块能自动出现在首页。
    home: { layout: [] },
    // 通知
    notifications: { daily: false, time: '20:00' },
    // 隐私
    privacy: { storeLocal: true },
    // 外观：主题色 / 背景（key 见 utils/theme.js 的 ACCENTS 与 BACKGROUNDS）
    theme: {
      accent: 'blue',      // 主题色
      background: 'default', // 背景预设
      bgImage: '',         // 自定义背景图（本地路径，空则用预设）
      bgMask: 0.35,        // 背景图上的蒙版强度（0-0.8；浅色叠白、深色叠黑）
      bgBlur: 0,           // 背景模糊半径（px，0-24）
      dark: false,         // 深色模式（followSystem 为 true 时被系统值覆盖）
      followSystem: false, // 跟随系统深色模式
      font: 'system',      // 字体：system | serif | rounded（AI 指令 theme.set 可改）
      density: 'cozy'      // 密度：compact | cozy | relaxed（AI 指令 theme.set 可改）
    },
    // 性能：流畅模式（关闭毛玻璃模糊与过渡动效）—— 低端机的退路，
    // 只影响观感，不改变任何功能与数据。
    // probed/auto/cpu/px/tier 由 utils/perf.js 的首次性能探测写入；
    // manual 表示用户亲手拨过开关 —— 置 true 后自动检测不再改这个值。
    performance: { smooth: false, probed: false, auto: false, manual: false, cpu: 0, px: 0, tier: '' },
    // 朗读偏好
    voice: {
      chineseRead: true,   // 自动朗读中文
      englishRead: true,   // 自动朗读英文
      speed: 1.0,          // 本地语音语速（原生/有道）
      engine: 'auto',      // 整句朗读引擎：auto 系统优先 / native 只用系统 / online 只用在线
      useAI: false         // 是否启用云端 AI 朗读
    },
    // AI 服务配置（统一服务层读取）
    ai: {
      enabled: false,
      provider: 'openai',  // openai | custom（均为 OpenAI 兼容接口）
      baseURL: '',
      apiKey: '',
      model: '',           // 大模型（例句生成），空则用环境变量默认
      ttsModel: '',        // 语音模型，空则默认 tts-1
      ttsVoice: 'alloy',   // 音色
      ttsSpeed: 1.0,       // 云端语速
      customTTS: false     // 仅 provider=custom 时生效：用户声明该地址提供 /audio/speech
    }
  };
}

function deepMerge(base, over) {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base)) return Array.isArray(over) ? over.slice() : base;
  if (typeof base === 'object' && base !== null && typeof over === 'object' && over !== null) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(over).forEach(k => {
      out[k] = (k in base) ? deepMerge(base[k], over[k]) : over[k];
    });
    return out;
  }
  return over;
}

function load() {
  try {
    const v = uni.getStorageSync(KEY);
    if (v && typeof v === 'object') {
      const st = deepMerge(defaults(), v);
      // 迁移：老版本把默认昵称写死成「学习者」，改默认值后老数据不会自动跟着变，
      // 所以读档时兜一次 —— 只动"从没改过昵称 / 昵称为空"的那批，
      // 用户自己设过的名字一律不动。
      const nick = st.profile && typeof st.profile.nickname === 'string'
        ? st.profile.nickname.trim() : '';
      if (!nick || nick === LEGACY_NICKNAME) {
        st.profile = Object.assign({}, st.profile, { nickname: DEFAULT_NICKNAME });
        cache = st;
        save();
      }
      return st;
    }
  } catch (e) {
    console.error('读取设置失败', e);
  }
  return defaults();
}

function init() {
  cache = load();
  if (!cache.profile.account) {
    cache.profile.account = 'local_' + Math.random().toString(36).slice(2, 10);
    save();
  }
}

function get() {
  if (!cache) cache = load();
  return cache;
}

function save() {
  try { uni.setStorageSync(KEY, cache); } catch (e) { console.error('保存设置失败', e); }
}

// patch 形式更新（浅层合并即可，调用方传完整子对象）
function set(patch) {
  const next = deepMerge(get(), patch);
  cache = next;
  save();
  return next;
}

function reset() {
  cache = defaults();
  try { uni.removeStorageSync(KEY); } catch (e) {}
  // 重置后补一个本地账号
  init();
  return cache;
}

// ---------- 收藏 ----------
function favorites() {
  return get().favorites || [];
}

function isFavorite(type, id) {
  return favorites().some(f => f.type === type && f.id === id);
}

function addFavorite(item) {
  const list = favorites();
  if (list.some(f => f.type === item.type && f.id === item.id)) return list;
  list.push(item);
  set({ favorites: list });
  return list;
}

function removeFavorite(type, id) {
  const list = favorites().filter(f => !(f.type === type && f.id === id));
  set({ favorites: list });
  return list;
}

function toggleFavorite(item) {
  return isFavorite(item.type, item.id) ? removeFavorite(item.type, item.id) : addFavorite(item);
}

export {
  init, get, set, save, reset,
  defaults,
  favorites, isFavorite, addFavorite, removeFavorite, toggleFavorite
};
