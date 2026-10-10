// services/voice.js - 统一朗读入口（云端 AI 语音 + 本地兜底）
//
// 决策链：
//   若 设置.voice.useAI 且 AI 已配置  → 调 OpenAI 兼容 /audio/speech 取音频播放（更自然、接近真人）
//   否则 / 任何失败                    → 委托 utils/tts（原生 TTS → 有道）本地链路
//
// 兼容性：默认 useAI=false，且未配置密钥时，本条链路 100% 不走网络，行为与改造前一致。
// 所有失败都降级到本地，绝不阻断主流程（出题、答题、点词）。

import { request, ServiceError } from './http.mjs';
import { getAIConfig, isAIEnabled, getVoicePrefs, speechEndpoint, providerSupportsTTS } from './config.mjs';
import * as localTts from '../utils/tts.mjs';

const audioCache = new Map(); // key -> 本地路径 / blob url
let currentAI = null;          // 当前云端音频播放句柄（用于 stop）
let appliedSpeed = null;       // 已应用到本地 TTS 的语速（变化才重设）

// 把设置页的本地语速同步给底层 provider（只在实际变化时调用）
function applyLocalSpeed(vp) {
  if (vp.speed == null || appliedSpeed === vp.speed) return;
  appliedSpeed = vp.speed;
  try { if (localTts.setVoiceOptions) localTts.setVoiceOptions({ speed: vp.speed }); } catch (e) {}
}

function detectLang(text) {
  return /[\u4e00-\u9fa5]/.test(text || '') ? 'zh' : 'en';
}

function cacheKey(text, lang, cfg) {
  return [lang, text, cfg.ttsVoice, cfg.ttsSpeed].join('|');
}

// ---------- 云端音频获取 ----------
async function fetchSpeech(text, lang, cfg) {
  const url = speechEndpoint(cfg.baseURL);
  if (!url) throw new ServiceError('语音服务地址无效', { degradable: true });
  const res = await request({
    url,
    method: 'POST',
    headers: { 'authorization': 'Bearer ' + cfg.apiKey, 'content-type': 'application/json' },
    data: {
      model: cfg.ttsModel || 'tts-1',
      input: text,
      voice: cfg.ttsVoice || 'alloy',
      speed: cfg.ttsSpeed || 1.0,
      response_format: 'mp3'
    },
    responseType: 'arraybuffer',
    timeout: 20000
  });
  if (!res.data) throw new ServiceError('语音返回为空', { degradable: true });
  return res.data; // ArrayBuffer（uni.request responseType:arraybuffer / fetch.arrayBuffer）
}

// ---------- 播放 ArrayBuffer ----------
function playArrayBuffer(ab, onDone) {
  // App-PLUS：落 plus.io 临时文件后用 InnerAudioContext 播放
  if (typeof plus !== 'undefined' && plus.io) {
    return saveAndPlayApp(ab, onDone);
  }
  // H5 / 浏览器：blob url
  if (typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
    const blob = new Blob([ab], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    currentAI = a;
    a.onended = () => { try { URL.revokeObjectURL(url); } catch (e) {} currentAI = null; onDone && onDone(); };
    a.onerror = () => { try { URL.revokeObjectURL(url); } catch (e) {} currentAI = null; onDone && onDone({ error: true }); };
    a.play().catch(() => { currentAI = null; onDone && onDone({ error: true }); });
    return;
  }
  onDone && onDone({ error: true });
}

// App 端把 ArrayBuffer 写到 _doc/tts_cache 并播放
function saveAndPlayApp(ab, onDone) {
  const hash = String(Math.abs(hashCode(ab))).slice(0, 16);
  const name = 'tts_cache/' + hash + '.mp3';
  try {
    const fs = plus.io.requestFileSystem(plus.io.PRIVATE_DOC);
    fs.root.getDirectory('tts_cache', { create: true }, (dir) => {
      dir.getFile(hash + '.mp3', { create: true }, (fileEntry) => {
        fileEntry.createWriter((writer) => {
          writer.onwriteend = () => {
            const ctx = uni.createInnerAudioContext();
            currentAI = ctx;
            ctx.src = fileEntry.toURL();
            ctx.onEnded = () => { currentAI = null; onDone && onDone(); };
            ctx.onError = () => { currentAI = null; onDone && onDone({ error: true }); };
            ctx.play();
          };
          writer.onerror = () => { currentAI = null; onDone && onDone({ error: true }); };
          writer.write(ab);
        }, () => onDone && onDone({ error: true }));
      }, () => onDone && onDone({ error: true }));
    }, () => onDone && onDone({ error: true }));
  } catch (e) {
    onDone && onDone({ error: true });
  }
}

function hashCode(ab) {
  let h = 0;
  const u8 = new Uint8Array(ab);
  for (let i = 0; i < u8.length; i += 257) h = (h * 31 + u8[i]) | 0;
  return h;
}

// ---------- 对外主接口 ----------
// 签名与 utils/tts.speak 对齐：speak(text, opts)
// opts: { lang, force, auto, silent, onDone, kind }
export function speak(text, opts) {
  const o = opts || {};
  const raw = (text == null ? '' : String(text)).trim();
  if (!raw) return;
  const lang = o.lang || detectLang(raw);
  const vp = getVoicePrefs();
  applyLocalSpeed(vp);

  // 自动朗读按语种开关：关闭对应语种则不自动播（用户主动点击不受影响）
  if (o.auto && ((lang === 'zh' && !vp.chineseRead) || (lang === 'en' && !vp.englishRead))) {
    if (o.onDone) o.onDone({ skipped: true });
    return;
  }

  if (vp.useAI && isAIEnabled()) {
    const cfg = getAIConfig();
    // 仅当服务商明确支持云端语音时才打网络；否则直接走本地（避免无谓的失败请求）
    if (providerSupportsTTS(cfg.provider)) {
      const key = cacheKey(raw, lang, cfg);
      const cached = audioCache.get(key);
      if (cached) {
        playCached(cached, o);
        return;
      }
      // 异步取音频；失败一律兜底本地
      try {
        fetchSpeech(raw, lang, cfg)
          .then(ab => {
            audioCache.set(key, ab); // 缓存原始 ArrayBuffer，二次播放免网络
            playArrayBuffer(ab, (r) => {
              if (r && r.error) localTts.speak(raw, o); // 播放失败兜底
              else if (o.onDone) o.onDone(r);
            });
          })
          .catch(() => localTts.speak(raw, o));
        return;
      } catch (e) {
        // 同步异常极少，直接兜底
        return localTts.speak(raw, o);
      }
    }
  }

  // 默认 / 兜底：本地链路
  return localTts.speak(raw, o);
}

function playCached(ab, o) {
  playArrayBuffer(ab, (r) => {
    if (r && r.error) localTts.speak((o.raw != null ? o.raw : ''), o);
    else if (o.onDone) o.onDone(r);
  });
}

export function stop() {
  if (currentAI) {
    try {
      if (currentAI.stop) currentAI.stop();
      if (currentAI.pause) currentAI.pause();
    } catch (e) {}
    currentAI = null;
  }
  // 同时停止本地链路（原生 TTS / 有道）
  try { localTts.stop(); } catch (e) {}
}

// 整句朗读（重听按钮 / 点句子）：与 utils/tts.speakSentence 同签名
export function speakSentence(text, opts) {
  return speak(text, Object.assign({ force: true }, opts || {}));
}

// 自动朗读（进题 / 答后）：受语种开关控制，失败静默
export function speakAuto(text) {
  return speak(text, { auto: true, silent: true });
}

// 单词点读发音：用户决策「单词继续用有道词典音」，不走云端 AI
export function speakWord(word, opts) {
  applyLocalSpeed(getVoicePrefs());
  return localTts.speakWord(word, opts);
}

export function isPlaying() {
  try { return !!currentAI || localTts.isPlaying(); } catch (e) { return !!currentAI; }
}

// 预热：提前触发本地 TTS 引擎绑定（云端按需，无需预热）
export function warmup() {
  try { if (localTts.warmup) localTts.warmup(); } catch (e) {}
}

export function isAIEnabledExport() { return isAIEnabled(); }
