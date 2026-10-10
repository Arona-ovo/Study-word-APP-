// services/config.js - 中心化配置：屏蔽密钥与部署差异
// 读取优先级：用户本地设置（settings） > 编译期环境变量（VITE_*/process.env） > 内置默认
// 关键：源码中绝不出现任何真实密钥字面量，全部来自运行期存储或部署环境。

import * as settings from '../utils/settings.mjs';

// 在 uni-app（H5/Vite）运行时可拿到 import.meta.env；App（webpack）与 Node 测试环境可能没有。
// 用 try 包裹，缺失即回退，绝不抛错。
function envVal(key, fallback) {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key] != null) {
      return import.meta.env[key];
    }
  } catch (e) {}
  try {
    if (typeof process !== 'undefined' && process.env && process.env[key] != null) {
      return process.env[key];
    }
  } catch (e) {}
  return fallback;
}

// 大模型（例句生成）配置
export function getAIConfig() {
  const s = (settings.get() && settings.get().ai) || {};
  return {
    enabled: !!s.enabled,
    provider: s.provider || 'openai',
    baseURL: s.baseURL || envVal('VITE_AI_BASE_URL', ''),
    apiKey: s.apiKey || envVal('VITE_AI_API_KEY', ''),
    model: s.model || envVal('VITE_AI_MODEL', 'gpt-4o-mini'),
    ttsModel: s.ttsModel || envVal('VITE_AI_TTS_MODEL', 'tts-1'),
    ttsVoice: s.ttsVoice || envVal('VITE_AI_TTS_VOICE', 'alloy'),
    ttsSpeed: s.ttsSpeed || 1.0
  };
}

// 是否真正可用：开关打开 + 地址 + 密钥 三者齐备
export function isAIEnabled() {
  const c = getAIConfig();
  return c.enabled && !!c.baseURL && !!c.apiKey;
}

// AI 是否可用的统一判定：返回 '' 表示可用；否则返回不可用原因（供入口置灰 + 提示）
// 顺序：先看密钥（用户最关心），再看地址与总开关。
export function aiGateReason() {
  const c = getAIConfig();
  if (!c.apiKey) return '未填写 API 密钥';
  if (!c.baseURL) return '未填写 API 地址';
  if (!c.enabled) return 'AI 服务未开启';
  return '';
}

export function isAIUsable() {
  return aiGateReason() === '';
}

// 朗读偏好（语种开关、语速、是否走 AI 语音）
export function getVoicePrefs() {
  const s = (settings.get() && settings.get().voice) || {};
  return {
    chineseRead: s.chineseRead !== false,
    englishRead: s.englishRead !== false,
    speed: s.speed || 1.0,
    useAI: !!s.useAI
  };
}

// 把 baseURL 归一为「完整的 chat/completions 地址」
// 约定：用户填 https://api.openai.com/v1 或自定义代理根地址；
// 若已包含 /chat/completions 则原样使用（兼容直接贴全路径）。
export function chatEndpoint(baseURL) {
  const base = String(baseURL || '').replace(/\/+$/, '');
  if (!base) return '';
  if (/\/chat\/completions$/i.test(base)) return base;
  return base + (base.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions');
}

// 归一为「完整的 audio/speech 地址」
export function speechEndpoint(baseURL) {
  const base = String(baseURL || '').replace(/\/+$/, '');
  if (!base) return '';
  if (/\/audio\/speech$/i.test(base)) return base;
  return base + '/audio/speech';
}

// 服务商预设：全部为 OpenAI 兼容接口，仅默认值不同。
// supportsTTS=true 表示该服务同时提供 /audio/speech（如 OpenAI）；
// 仅做文本大模型的服务（DeepSeek / Kimi / 通义等）不支持云端语音，朗读会自动用本地方案。
export const PROVIDER_PRESETS = [
  { value: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', ttsModel: 'tts-1', supportsTTS: true },
  { value: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat', ttsModel: '', supportsTTS: false },
  { value: 'moonshot', name: 'Kimi', baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', ttsModel: '', supportsTTS: false },
  { value: 'qwen', name: '通义千问', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', ttsModel: '', supportsTTS: false },
  { value: 'custom', name: '自定义', baseURL: '', model: '', ttsModel: '', supportsTTS: false }
];

export function providerPreset(value) {
  return PROVIDER_PRESETS.find(p => p.value === value) || null;
}

// 当前服务商是否支持云端语音（/audio/speech）
export function providerSupportsTTS(value) {
  const p = providerPreset(value);
  return !!(p && p.supportsTTS);
}
