// services/http.js - 统一请求封装：超时、错误归一化、可降级标记、熔断
// 屏蔽 uni.request / fetch 差异，供 llm / voice / image-gen / ai-content 复用。

// 归一化错误：携带 degradable / notConfigured 标记，调用方可据此决定回退本地方案或提示配置
export class ServiceError extends Error {
  constructor(message, extra) {
    super(message);
    this.name = 'ServiceError';
    this.extra = extra || {};
    // 常用字段提到顶层，调用方不用翻 extra
    this.degradable = !!this.extra.degradable;
    this.notConfigured = !!this.extra.notConfigured;
    this.status = this.extra.status || 0;
    this.detail = this.extra.detail || '';
    this.timeout = !!this.extra.timeout;
    this.retryable = !!this.extra.retryable;
  }
}

// 服务商错误详情：OpenAI 兼容接口的标准形态是 { error:{ message } }，
// 也有 { message } / { msg } / 纯文本；HTML 错误页不搬给用户。
export function apiErrorDetail(data) {
  if (!data) return '';
  if (typeof data === 'string') {
    const s = data.trim();
    if (!s || s.charAt(0) === '<') return '';
    return s.length > 160 ? s.slice(0, 160) : s;
  }
  const m = (data.error && data.error.message) || data.message || data.msg || '';
  return m ? String(m).slice(0, 160) : '';
}

/* ============================================================
 * 断路器
 * ============================================================
 * AI 挂掉之后最难受的不是"这一句没生成出来"，而是之后每个搜索 / 出题
 * 都要实打实发一次请求、干等 15-20s 超时才回落本地。连续失败几次之后
 * 直接判定服务不可用，冷却期内新请求立刻失败（调用方本就要降级）。
 *
 * 按 origin 隔离：自定义服务商挂了不该连累别的地址；改配置后调
 * resetBreaker() 立即恢复，不用等冷却结束。
 */
const BREAK_FAILS = 3;        // 连续失败几次才跳开
const BREAK_COOLDOWN = 60000; // 冷却多久（ms）

const breakers = {};

/** 从 URL 取服务标识：同源的所有接口共用一个断路器 */
export function breakerKeyOf(url) {
  const s = String(url || '');
  const m = /^(https?:\/\/[^/?#]+)/i.exec(s);
  return m ? m[1] : s.slice(0, 40);
}

export function breakerState(key) {
  const b = breakers[key];
  if (!b) return { open: false, fails: 0, until: 0 };
  if (b.openUntil && Date.now() < b.openUntil) {
    return { open: true, fails: b.fails, until: b.openUntil };
  }
  return { open: false, fails: b.openUntil ? 0 : b.fails, until: 0 };
}

/** 记一次成功：连续失败计数清零 */
export function noteSuccess(key) {
  if (!key) return;
  const b = breakers[key];
  if (b) { b.fails = 0; b.openUntil = 0; }
}

/**
 * 记一次失败（不经过 request 的也能量，比如模型返回了 200 但结构不对）
 * @returns {boolean} 这次是否把断路器打跳了
 */
export function noteFailure(key) {
  if (!key) return false;
  const b = breakers[key] || (breakers[key] = { fails: 0, openUntil: 0 });
  b.fails++;
  if (b.fails >= BREAK_FAILS) {
    b.openUntil = Date.now() + BREAK_COOLDOWN;
    b.fails = 0;
    return true;
  }
  return false;
}

/** 复位：改了 API 配置 / 用户手动重试时调用。不传 key 则全部复位 */
export function resetBreaker(key) {
  if (key) delete breakers[key];
  else Object.keys(breakers).forEach(k => { delete breakers[k]; });
}

/** 调试 / 校验脚本用 */
export function breakerSnapshot() {
  const out = {};
  Object.keys(breakers).forEach(k => {
    const st = breakerState(k);
    out[k] = { open: st.open, fails: st.fails, until: st.until };
  });
  return out;
}

// 统一判定：非 2xx 一律算失败（401/429/500 都该降级并计入熔断）
function isBadStatus(code) {
  return typeof code === 'number' && code > 0 && (code < 200 || code >= 300);
}

// opts: { url, method, headers, data, timeout, force, breakerKey }
// 返回 { statusCode, data }；失败抛 ServiceError
function send(opts) {
  const url = opts.url;
  const method = (opts.method || 'POST').toUpperCase();
  const headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
  const timeout = opts.timeout || 15000;
  const data = opts.data;
  const respType = opts.responseType || 'json'; // voice 用 'arraybuffer'

  // 1) uni-app 环境优先用 uni.request（App / 小程序 / H5 统一）
  if (typeof uni !== 'undefined' && uni && uni.request) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new ServiceError('请求超时', { timeout: true, degradable: true }));
      }, timeout);
      uni.request({
        url,
        method,
        header: headers,
        data,
        responseType: respType,
        timeout,
        success: (res) => {
          clearTimeout(timer);
          if (isBadStatus(res.statusCode)) {
            // 把服务商返回的错误详情一起带走（401/402/429 的具体原因都在响应体里）
            reject(new ServiceError('HTTP ' + res.statusCode, {
              status: res.statusCode,
              detail: apiErrorDetail(res.data),
              degradable: true
            }));
            return;
          }
          resolve(res);
        },
        fail: (err) => {
          clearTimeout(timer);
          reject(new ServiceError(err && err.errMsg ? err.errMsg : '请求失败', { degradable: true, raw: err }));
        }
      });
    });
  }

  // 2) Node / 浏览器兜底（测试与 H5 无 uni 时）
  if (typeof fetch !== 'undefined') {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : setTimeout(() => {}, timeout);
    const body = (data != null)
      ? (typeof data === 'string' ? data : JSON.stringify(data))
      : undefined;
    const init = { method, headers, body, signal: ctrl ? ctrl.signal : undefined };
    return Promise.resolve()
      .then(() => fetch(url, init))
      .then(async (res) => {
        clearTimeout(timer);
        if (isBadStatus(res.status)) {
          const text = await res.text().catch(() => '');
          let body = null;
          try { body = JSON.parse(text); } catch (e) { body = text; }
          throw new ServiceError('HTTP ' + res.status, {
            status: res.status,
            detail: apiErrorDetail(body),
            degradable: true
          });
        }
        if (respType === 'arraybuffer') {
          const buf = await res.arrayBuffer();
          return { statusCode: res.status, data: buf };
        }
        const text = await res.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
        return { statusCode: res.status, data: parsed };
      })
      .catch((e) => {
        clearTimeout(timer);
        if (e instanceof ServiceError) throw e;
        throw new ServiceError(e && e.message ? e.message : '请求失败', { degradable: true, raw: e });
      });
  }

  return Promise.reject(new ServiceError('运行环境不支持网络请求', { degradable: true }));
}

/* ============================================================
 * 流式（SSE）：边收边吐给调用方
 * ============================================================
 * 端上支持情况不一致：App / 小程序走 uni.request 的 enableChunked + onChunkReceived，
 * H5 走 fetch 的 ReadableStream。两端都不支持时一个字节都收不到，
 * 调用方据此回退到整块返回 —— 慢一点，但功能不丢。
 */

// 增量解码器：UTF-8 一个汉字可能横跨两个 chunk，必须带 stream 状态
function makeDecoder() {
  if (typeof TextDecoder !== 'undefined') {
    const d = new TextDecoder('utf-8');
    return (chunk) => (chunk ? d.decode(chunk, { stream: true }) : d.decode());
  }
  return (chunk) => {
    if (!chunk) return '';
    const bytes = new Uint8Array(chunk);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  };
}

/**
 * @param {object} opts { url, method, headers, data, timeout, firstByteTimeout }
 *    firstByteTimeout：等第一个字节的耐心（ms）。这个端如果根本不会回调 onChunkReceived，
 *    靠它能早点判定"不支持流式"并让调用方回退整块，不用白等满 timeout。
 * @param {(text:string)=>void} onText 每收到一段文本回调一次
 * @returns {Promise<{received:number}>} received 为收到的字符数（0 表示该端不支持流式）
 */
export function streamRequest(opts, onText) {
  const o = opts || {};
  const url = o.url;
  const method = (o.method || 'POST').toUpperCase();
  const headers = Object.assign({ 'content-type': 'application/json' }, o.headers || {});
  const timeout = o.timeout || 20000;
  const firstByte = Math.max(0, Number(o.firstByteTimeout) || 0);
  const body = (o.data != null) ? (typeof o.data === 'string' ? o.data : JSON.stringify(o.data)) : undefined;
  let received = 0;
  let stopWatch = null;              // 首字节看门狗的清理函数
  const push = (t) => {
    if (!t) return;
    if (stopWatch) { stopWatch(); stopWatch = null }
    received += t.length;
    onText(t);
  };
  // 起一个"多久收不到第一个字节就认输"的看门狗；收到第一个字节就自动撤掉
  const armWatch = (giveUp) => {
    if (!firstByte) return;
    const timer = setTimeout(giveUp, firstByte);
    stopWatch = () => clearTimeout(timer);
  };

  if (typeof uni !== 'undefined' && uni && uni.request) {
    return new Promise((resolve, reject) => {
      const dec = makeDecoder();
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (stopWatch) { stopWatch(); stopWatch = null }
        fn(arg);
      };
      const timer = setTimeout(() => {
        finish(reject, new ServiceError('请求超时', { timeout: true, degradable: true }));
      }, timeout);
      armWatch(() => finish(reject, new ServiceError('当前环境不支持流式输出', {
        degradable: true, streamUnsupported: true
      })));
      uni.request({
        url,
        method,
        header: headers,
        data: o.data,
        timeout,
        enableChunked: true,          // 不认识这个参数的端会直接忽略 → received 为 0 → 调用方回退
        responseType: 'text',
        onChunkReceived: (res) => {
          if (settled || !res || !res.data) return;
          // 小程序给 ArrayBuffer，App 端也可能给 ArrayBuffer
          push(dec(res.data));
        },
        success: (res) => {
          if (isBadStatus(res && res.statusCode)) {
            finish(reject, new ServiceError('HTTP ' + res.statusCode, {
              status: res.statusCode,
              detail: apiErrorDetail(res && res.data),
              degradable: true
            }));
            return;
          }
          push(dec(null));
          // 一个 chunk 都没回调、但整段响应一次性给了（端不支持分块却认 responseType:'text'）：
          // 直接把这段文本喂给解析器，能解析出来就当流式用，省掉一次整块重发。
          if (!received && res && typeof res.data === 'string' && res.data) push(res.data);
          finish(resolve, { received: received });
        },
        fail: (err) => {
          finish(reject, new ServiceError(err && err.errMsg ? err.errMsg : '请求失败', { degradable: true, raw: err }));
        }
      });
    });
  }

  if (typeof fetch !== 'undefined') {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : setTimeout(() => {}, timeout);
    const init = { method, headers, body, signal: ctrl ? ctrl.signal : undefined };
    // 首字节看门狗：迟迟收不到第一个字节就认输，让调用方早点回退整块
    const firstByteP = firstByte
      ? new Promise((_, rej) => armWatch(() => rej(new ServiceError('当前环境不支持流式输出', {
        degradable: true, streamUnsupported: true
      }))))
      : null;
    return (firstByteP ? Promise.race([fetch(url, init), firstByteP]) : fetch(url, init))
      .then(async (res) => {
        clearTimeout(timer);
        if (stopWatch) { stopWatch(); stopWatch = null }
        if (isBadStatus(res.status)) {
          const text = await res.text().catch(() => '');
          let body = null;
          try { body = JSON.parse(text); } catch (e) { body = text; }
          throw new ServiceError('HTTP ' + res.status, {
            status: res.status,
            detail: apiErrorDetail(body),
            degradable: true
          });
        }
        if (!res.body || typeof res.body.getReader !== 'function') {
          throw new ServiceError('当前环境不支持流式输出', { degradable: true, streamUnsupported: true });
        }
        const reader = res.body.getReader();
        const dec = makeDecoder();
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          push(dec(r.value));
        }
        push(dec(null));
        return { received: received };
      })
      .catch((e) => {
        clearTimeout(timer);
        if (stopWatch) { stopWatch(); stopWatch = null }
        if (e instanceof ServiceError) throw e;
        throw new ServiceError(e && e.message ? e.message : '请求失败', { degradable: true, raw: e });
      });
  }

  return Promise.reject(new ServiceError('运行环境不支持网络请求', { degradable: true }));
}

export function request(opts) {
  const o = opts || {};
  const key = o.breakerKey || breakerKeyOf(o.url);

  // 熔断中：不发请求，直接给一个可降级的失败。force 用于"用户明确要重试"
  if (!o.force) {
    const st = breakerState(key);
    if (st.open) {
      const left = Math.max(1, Math.ceil((st.until - Date.now()) / 1000));
      return Promise.reject(new ServiceError('AI 服务连续失败已熔断，' + left + ' 秒后自动恢复，也可重试', {
        degradable: true, breaker: true, key: key, retryAfter: left
      }));
    }
  }

  return send(o).then(
    (res) => { noteSuccess(key); return res; },
    (err) => {
      // 没配置 / 地址无效这类不算"服务挂了"，不该熔断
      if (!(err && err.notConfigured)) noteFailure(key);
      throw err;
    }
  );
}
