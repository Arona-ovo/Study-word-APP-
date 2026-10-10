// services/llm.js - 统一大模型调用接口（OpenAI 兼容）
// 屏蔽服务商差异：只需 baseURL + apiKey 即可对接任意 OpenAI 兼容服务。
// 失败时抛 LLMError（可降级），由 sentence-api 回退本地语料，绝不阻断主流程。

import { request, ServiceError } from './http.mjs';
import { getAIConfig, isAIEnabled, chatEndpoint } from './config.mjs';

export class LLMError extends ServiceError {}

// messages: [{ role:'system'|'user'|'assistant', content:string }]
// opts: { temperature, timeout, params }
// 返回 { content, raw }
export async function chatCompletion(messages, opts = {}) {
  if (!isAIEnabled()) {
    throw new LLMError('AI 服务未启用或缺少配置', { degradable: true, notConfigured: true });
  }
  const cfg = getAIConfig();
  const url = chatEndpoint(cfg.baseURL);
  if (!url) throw new LLMError('AI 服务地址无效', { degradable: true, notConfigured: true });

  const res = await request({
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
    timeout: opts.timeout || 15000
  });

  const data = res.data;
  const choices = data && data.choices;
  if (!choices || !choices.length) {
    throw new LLMError('模型返回格式异常', { degradable: true });
  }
  const msg = choices[0].message;
  return {
    content: (msg && msg.content) ? msg.content : '',
    raw: data
  };
}

// 便捷：直接问一句，返回字符串内容
export async function complete(prompt, opts = {}) {
  const r = await chatCompletion([{ role: 'user', content: prompt }], opts);
  return r.content;
}
