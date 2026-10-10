// utils/settings.js - 应用设置 / 个人资料 / 收藏 的本地状态
// 独立于学习进度（store.js），单独存一个 storage key，互不干扰。
// 所有 AI 相关密钥仅存于此处（或部署环境变量），源码不出现任何字面量密钥。

const KEY = 'fj_app_settings_v1';
let cache = null;

function defaults() {
  return {
    // 个人资料（纯本地，无后端）
    profile: { avatar: '', nickname: '学习者', account: '', bio: '' },
    // 收藏：{ type:'word'|'sentence', id, word?, en?, zh? }
    favorites: [],
    // 通知
    notifications: { daily: false, time: '20:00' },
    // 隐私
    privacy: { storeLocal: true },
    // 朗读偏好
    voice: {
      chineseRead: true,   // 自动朗读中文
      englishRead: true,   // 自动朗读英文
      speed: 1.0,          // 本地语音语速（原生/有道）
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
      ttsSpeed: 1.0        // 云端语速
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
    if (v && typeof v === 'object') return deepMerge(defaults(), v);
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
