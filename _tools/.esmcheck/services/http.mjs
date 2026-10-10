// services/http.js - 统一请求封装：超时、错误归一化、可降级标记
// 屏蔽 uni.request / fetch 差异，供 llm / voice 复用。

// 归一化错误：携带 degradable / notConfigured 标记，调用方可据此决定回退本地方案或提示配置
export class ServiceError extends Error {
  constructor(message, extra) {
    super(message);
    this.name = 'ServiceError';
    this.extra = extra || {};
    this.degradable = !!this.extra.degradable;
    this.notConfigured = !!this.extra.notConfigured;
  }
}

// opts: { url, method, headers, data, timeout }
// 返回 { statusCode, data }；失败抛 ServiceError
export function request(opts) {
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
        if (respType === 'arraybuffer') {
          const buf = await res.arrayBuffer();
          if (!res.ok) throw new ServiceError('HTTP ' + res.status, { status: res.status, degradable: true });
          return { statusCode: res.status, data: buf };
        }
        const text = await res.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
        if (!res.ok) throw new ServiceError('HTTP ' + res.status, { status: res.status, degradable: true });
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
