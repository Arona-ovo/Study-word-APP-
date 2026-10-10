// services/image-gen.js - 「AI 生成图片」能力探测与落地
//
// 原则（对应用户确认的第 3 条）：
//   · 配的服务商**能**出图 → 真的调图片接口，下载到本地，用 bg.set 的 image 换上
//   · 配的服务商**不能**出图 → 直接返回 null，由 page-agent 走「AI 描述颜色 + 本地渐变」
//   · 任何一步失败都返回 null，绝不让首页卡在加载态
//
// 生成的图同样走 pageDoc，所以撤销/回退与其它指令完全一致。
//
// 密钥零硬编码：地址与密钥只来自 settings / 环境变量，见 config.js。

import { request } from './http.js';
import * as apiUsage from '../utils/api-usage.js';
import { getAIConfig, isAIEnabled, providerPreset } from './config.js';
import * as settings from '../utils/settings.js';
import { featureOn } from './ai-gate.js';

// 常见 OpenAI 兼容出图模型（dall-e-3 质量最好但慢；gpt-image-1 较新）
export const IMAGE_MODELS = ['gpt-image-1', 'dall-e-3', 'dall-e-2'];
export const IMAGE_SIZES = ['1024x1024', '1024x1536', '1536x1024', '512x512', '256x256'];

// 归一为完整的 images/generations 地址
export function imageEndpoint(baseURL) {
  const base = String(baseURL || '').replace(/\/+$/, '');
  if (!base) return '';
  if (/\/images\/generations$/i.test(base)) return base;
  return base + '/images/generations';
}

/**
 * 当前配置是否支持出图。
 * 判定顺序：总开关 → 服务商预设 → 用户在设置里对「自定义」的显式声明。
 */
export function supportsImage() {
  if (!isAIEnabled()) return false;
  const cfg = getAIConfig();
  const p = providerPreset(cfg.provider);
  if (!p) return false;
  if (p.value === 'openai') return true;
  if (p.value === 'custom') {
    try {
      const s = (settings.get() && settings.get().ai) || {};
      return !!s.customImage;
    } catch (e) {
      return false;
    }
  }
  // 其余服务商（DeepSeek / Kimi / 通义等）只做文本，明确不支持
  return false;
}

/** 不可用时给用户的解释（用于提示条） */
export function imageGateReason() {
  if (!isAIEnabled()) return 'AI 服务未配置';
  const cfg = getAIConfig();
  const p = providerPreset(cfg.provider);
  const name = (p && p.name) || cfg.provider || '当前服务商';
  if (p && p.value === 'custom') return name + '需在设置里勾选「支持出图」';
  return name + '不支持出图，已改用本地渐变';
}

function hash32(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// ---------- 落地：远程 url → 本地文件 ----------
function downloadToLocal(url) {
  return new Promise((resolve) => {
    if (!url) return resolve('');
    uni.downloadFile({
      url: url,
      timeout: 20000,
      success: (res) => {
        const temp = res && res.tempFilePath;
        if (!temp) return resolve('');
        // saveFile 在 App / 小程序可用，把临时文件转成本地持久文件
        try {
          uni.saveFile({
            tempFilePath: temp,
            success: (s) => resolve((s && s.savedFilePath) || temp),
            fail: () => resolve(temp)   // 存不下就用临时路径，本次可用
          });
        } catch (e) {
          resolve(temp);
        }
      },
      fail: () => resolve('')
    });
  });
}

// ---------- 落地：base64 → 本地文件 ----------
function base64ToLocal(b64, name) {
  return new Promise((resolve) => {
    // H5：直接塞 data URL，<image src> 支持
    // eslint-disable-next-line no-undef
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      return resolve('data:image/png;base64,' + b64);
    }
    try {
      const fs = uni.getFileSystemManager && uni.getFileSystemManager();
      if (fs && fs.writeFile) {
        // eslint-disable-next-line no-undef
        const root = (typeof wx !== 'undefined' && wx.env && wx.env.USER_DATA_PATH) || '';
        const path = (root ? root + '/' : '') + name;
        fs.writeFile({
          filePath: path,
          data: b64,
          encoding: 'base64',
          success: () => resolve(path),
          fail: () => resolve('')
        });
        return;
      }
    } catch (e) { /* 落到下面 */ }
    resolve('');
  });
}

/**
 * 出图主入口。
 * @param {string} prompt 画面描述（英文效果最好，调用方已处理）
 * @param {object} opts { size, model }
 * @returns {Promise<{path:string, model:string, prompt:string} | null>}
 *   不支持 / 失败一律 null —— 调用方据此回退本地渐变。
 */
export async function generate(prompt, opts) {
  const p = String(prompt || '').trim();
  if (!p) return null;
  if (!featureOn('image')) return null;
  if (!supportsImage()) return null;

  const o = opts || {};
  const cfg = getAIConfig();
  const url = imageEndpoint(cfg.baseURL);
  if (!url) return null;

  const model = o.model || imageModel();
  const size = IMAGE_SIZES.indexOf(o.size) >= 0 ? o.size : '1024x1024';

  let data;
  try {
    const res = await request({
      url: url,
      method: 'POST',
      headers: {
        'authorization': 'Bearer ' + cfg.apiKey,
        'content-type': 'application/json'
      },
      data: { model: model, prompt: p, n: 1, size: size },
      timeout: o.timeout || 60000
    });
    data = res && res.data;
  } catch (e) {
    return null;
  }

  const item = data && data.data && data.data[0];
  if (!item) return null;
  apiUsage.record('image', 0, 0);

  let path = '';
  if (item.url) path = await downloadToLocal(item.url);
  else if (item.b64_json) path = await base64ToLocal(item.b64_json, 'bg_' + hash32(p) + '.png');
  if (!path) return null;

  return { path: path, model: model, prompt: p };
}

/** 用户在设置里选的出图模型（没选就用第一个） */
export function imageModel() {
  try {
    const s = (settings.get() && settings.get().ai) || {};
    if (s.imageModel && IMAGE_MODELS.indexOf(s.imageModel) >= 0) return s.imageModel;
  } catch (e) { /* ignore */ }
  return IMAGE_MODELS[0];
}

/**
 * 「要不要生成真图」的粗判：用户明确说了"生成/画/来张图/背景图"之类。
 * 只用于决定要不要先跑一次图片接口，不影响安全性。
 */
export function wantsImage(raw) {
  const s = String(raw || '');
  const hit = ['生成一张', '生成个', '生成图片', '画一张', '画个', '来张图', '来一张图',
    '配图', '背景图', '壁纸', '换成图', '图片背景', 'generate', 'draw', 'image'];
  for (let i = 0; i < hit.length; i++) {
    if (s.indexOf(hit[i]) >= 0) return true;
  }
  return false;
}
