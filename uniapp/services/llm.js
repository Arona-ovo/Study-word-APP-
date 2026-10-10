// services/llm.js - 统一大模型调用接口（OpenAI 兼容）
// 屏蔽服务商差异：只需 baseURL + apiKey 即可对接任意 OpenAI 兼容服务。
// 失败时抛 LLMError（可降级），由 sentence-api 回退本地语料，绝不阻断主流程。

import { request, streamRequest, ServiceError, noteFailure, breakerState, breakerKeyOf } from './http.js';
import { getAIConfig, isAIEnabled, chatEndpoint, PROVIDER_PRESETS } from './config.js';
import * as apiUsage from '../utils/api-usage.js';

export class LLMError extends ServiceError {}

/* ============================================================
 * 报错人话化：把 HTTP 状态码翻译成「哪里错了 + 怎么办」。
 * 用户只看到"HTTP 401"是没法自救的 —— 密钥错、余额空、地址歪要分清楚。
 * ============================================================ */
function providerName(v) {
  // 校验脚本用 load() 注入依赖时可能没带 PROVIDER_PRESETS，别让报错翻译本身炸掉
  const list = (typeof PROVIDER_PRESETS !== 'undefined' && PROVIDER_PRESETS) ? PROVIDER_PRESETS : [];
  const p = list.find(x => x.value === v);
  return (p && p.name) || v || 'AI 服务商';
}

// 导出给校验脚本做报错文案契约测试
export function friendlyStatusError(e, name) {
  const st = e.status;
  const d = e.detail || '';
  const tail = d ? '（服务商说明：' + d + '）' : '';
  if (st === 401) return name + ' 返回 401：API 密钥无效或已过期，请到「我的 → 设置 → AI 服务」检查密钥是否填对' + tail;
  if (st === 402) return name + ' 返回 402：账户余额不足，请到服务商控制台充值后重试' + tail;
  if (st === 404) return name + ' 返回 404：接口地址不对，请检查 API 地址（一般应以 /v1 结尾）' + tail;
  if (st === 422) return name + ' 返回 422：请求参数被拒绝，请检查模型名是否正确' + tail;
  if (st === 429) return name + ' 返回 429：请求太频繁或超出配额，请稍等几秒再试' + tail;
  if (st >= 500) return name + ' 服务器故障（HTTP ' + st + '），请稍后再试' + tail;
  return name + ' 请求失败（HTTP ' + st + '）' + tail;
}

// 把底层 ServiceError 翻译成带上下文的 LLMError；retryable 标记供调用方决定要不要再试
function normalizeHttpError(e, cfg, timeoutMs) {
  const name = providerName(cfg.provider);
  if (e && e.notConfigured) return e;
  if (e && e.timeout) {
    return new LLMError(name + ' 请求超时（' + Math.round((timeoutMs || 15000) / 1000) + ' 秒无响应），网络不佳或服务商繁忙，可重试', {
      degradable: true, retryable: true
    });
  }
  if (e && e.status) {
    const retryable = e.status === 429 || e.status >= 500;
    return new LLMError(friendlyStatusError(e, name), { degradable: true, status: e.status, retryable: retryable });
  }
  // 纯网络错误（域名解析失败 / 断网）：errMsg 或 message 已经比较直白，补一个前缀
  const msg = (e && e.message) || '网络请求失败';
  if (/request:fail|网络|network|fetch failed|ECONN|ENOTFOUND/i.test(msg)) {
    return new LLMError('网络连接失败（' + msg + '），请检查网络后重试', { degradable: true, retryable: true });
  }
  return e;
}

// messages: [{ role:'system'|'user'|'assistant', content:string }]
// opts: { temperature, timeout, params }
// 返回 { content, raw }
export async function chatCompletion(messages, opts = {}) {
  try {
    return await chatOnce(messages, opts);
  } catch (e) {
    // 没配置不算"调用失败"，那种是用户还没填，不是服务出问题
    if (!(e && e.notConfigured)) apiUsage.recordFailure();
    throw e;
  }
}

async function chatOnce(messages, opts = {}) {
  if (!isAIEnabled()) {
    throw new LLMError('AI 服务未启用或缺少配置', { degradable: true, notConfigured: true });
  }
  const cfg = getAIConfig();
  const url = chatEndpoint(cfg.baseURL);
  if (!url) throw new LLMError('AI 服务地址无效', { degradable: true, notConfigured: true });

  const key = breakerKeyOf(url);
  const timeoutMs = opts.timeout || 15000;
  let res;
  try {
    res = await request({
      url,
      method: 'POST',
      headers: {
        'authorization': 'Bearer ' + cfg.apiKey,
        'content-type': 'application/json'
      },
      data: {
        model: cfg.model || 'gpt-4o-mini',
        messages,
        temperature: opts.temperature != null ? opts.temperature : 0.7,
        ...(opts.params || {})
      },
      timeout: timeoutMs,
      breakerKey: key
    });
  } catch (e) {
    throw normalizeHttpError(e, cfg, timeoutMs);
  }

  const data = res.data;
  const choices = data && data.choices;
  if (!choices || !choices.length) {
    // HTTP 是 200 但结构不对（key 没权限 / 模型名写错 / 网关返回了错误页）。
    // 也要计入熔断，否则每个请求都要实打实等一轮才回落本地。
    noteFailure(key);
    const hint = data && data.error && data.error.message ? '：' + data.error.message : '';
    throw new LLMError('模型返回格式异常（请检查模型名是否填对，如 DeepSeek 应填 deepseek-chat）' + hint, { degradable: true });
  }
  const msg = choices[0].message;
  const content = (msg && msg.content) ? msg.content : '';
  // 用量：服务商给了 usage 就记真实值，没给就按字符数估个量级
  const u = data.usage || {};
  apiUsage.record(
    'llm',
    u.prompt_tokens != null ? u.prompt_tokens : apiUsage.estimateMessages(messages),
    u.completion_tokens != null ? u.completion_tokens : apiUsage.estimateTokens(content)
  );
  return {
    content: content,
    raw: data
  };
}

// 便捷：直接问一句，返回字符串内容
export async function complete(prompt, opts = {}) {
  const r = await chatCompletion([{ role: 'user', content: prompt }], opts);
  return r.content;
}

/* ============================================================
 * 流式：边收边吐
 * ============================================================
 * opts.onDelta(piece) 每来一小段就调一次，调用方可以边收边渲染。
 * 端不支持 / 网关不认 stream 时收不到任何字节 → 抛 streamUnsupported，
 * 由调用方回退到 chatCompletion（慢一点，但不至于聊不了天）。
 */
// 等第一个字节的耐心：这个端如果压根不会分块回调，早点认输换整块，
// 别让聊天界面干等到 20s 超时才动。
const FIRST_BYTE_MS = 8000;

export async function chatCompletionStream(messages, opts = {}) {
  if (!isAIEnabled()) {
    throw new LLMError('AI 服务未启用或缺少配置', { degradable: true, notConfigured: true });
  }
  const cfg = getAIConfig();
  const url = chatEndpoint(cfg.baseURL);
  if (!url) throw new LLMError('AI 服务地址无效', { degradable: true, notConfigured: true });

  const key = breakerKeyOf(url);
  const st = breakerState(key);
  if (st.open && !opts.force) {
    throw new LLMError('服务暂时不可用', { degradable: true, breaker: true, key: key });
  }

  const onDelta = typeof opts.onDelta === 'function' ? opts.onDelta : function () {};
  let buf = '';
  let full = '';

  const feed = (text) => {
    buf += text;
    const lines = buf.split('\n');
    buf = lines.pop() || '';   // 最后一段可能还没收全，留着等下一个 chunk
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i].trim();
      if (!s || s.indexOf('data:') !== 0) continue;
      const payload = s.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let o;
      try { o = JSON.parse(payload); } catch (e) { continue; }
      const ch = o && o.choices && o.choices[0];
      const piece = (ch && ch.delta && ch.delta.content) || (ch && ch.text) || '';
      if (piece) { full += piece; onDelta(piece); }
    }
  };

  try {
    const r = await streamRequest({
      url,
      method: 'POST',
      headers: {
        'authorization': 'Bearer ' + cfg.apiKey,
        'content-type': 'application/json'
      },
      data: Object.assign({
        model: cfg.model || 'gpt-4o-mini',
        messages,
        temperature: opts.temperature != null ? opts.temperature : 0.7
      }, opts.params || {}, { stream: true }),
      timeout: opts.timeout || 20000,
      firstByteTimeout: opts.firstByteTimeout != null ? opts.firstByteTimeout : FIRST_BYTE_MS
    }, feed);
    if (!r || !r.received) {
      // 一个字节都没收到：这一端没有真正的流式能力
      throw new LLMError('当前环境不支持流式输出', { degradable: true, streamUnsupported: true });
    }
  } catch (e) {
    // 端不支持流式只是能力问题，不是服务故障 —— 不该计入熔断，
    // 否则连续聊几轮就把后续整块请求也一起熔断了。
    const unsup = !!(e && e.extra && e.extra.streamUnsupported);
    if (!(e && e.notConfigured) && !unsup) noteFailure(key);
    throw normalizeHttpError(e, cfg, opts.timeout || 20000);
  }

  apiUsage.record('llm', apiUsage.estimateMessages(messages), apiUsage.estimateTokens(full));
  return { content: full, raw: null };
}
