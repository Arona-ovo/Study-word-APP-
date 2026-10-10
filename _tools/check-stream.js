// check-stream.js - 流式链路：SSE 解析、逐字回调、不支持时回退标记
// 用 mock uni + mock fetch 走通 chatCompletionStream 全链路。

// ---------- mock uni（settings/config 需要） ----------
// 注意：uni.getStorageSync 存取的都是对象本身（不是 JSON 字符串）
const store = {
  'fj_app_settings_v1': {
    ai: { enabled: true, provider: 'custom', baseURL: 'https://api.test.com/v1', apiKey: 'sk-test-12345678', model: 'test-model', ttsModel: '', verify: { sig: '', ok: false, msg: '', latency: 0, ts: 0 } }
  }
};
globalThis.uni = {
  getStorageSync: (k) => store[k] || '',
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; }
};

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' => ' + JSON.stringify(extra) : '')); }
}

const enc = new TextEncoder();

// ---------- 可控流式 fetch ----------
let mode = 'sse';   // 'sse' | 'nostream' | 'error'
globalThis.fetch = async () => {
  if (mode === 'error') throw new Error('down');
  if (mode === 'nostream') {
    return { status: 200, ok: true, body: null };
  }
  // SSE：故意把一条 data 拆到两个 chunk 中间，验证半行缓存
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"con',
    'tent":"lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\n',
    'data: [DONE]\n\n'
  ];
  let i = 0;
  return {
    status: 200, ok: true,
    body: {
      getReader: () => ({
        read: async () => i < chunks.length
          ? { done: false, value: enc.encode(chunks[i++]) }
          : { done: true, value: undefined }
      })
    }
  };
};

const llm = await import('file:///C:/Users/33156/WorkBuddy/2026-10-06-17-27-44/uniapp/services/llm.js');
const http = await import('file:///C:/Users/33156/WorkBuddy/2026-10-06-17-27-44/uniapp/services/http.js');

// ---------- 1. SSE 逐字回调 ----------
console.log('== 1. 流式逐字 ==');
mode = 'sse';
http.resetBreaker();
const pieces = [];
const r = await llm.chatCompletionStream([{ role: 'user', content: 'hi' }], {
  onDelta: (p) => pieces.push(p)
});
ok(r.content === 'Hello world', '拼接完整', r.content);
ok(pieces.length === 3 && pieces[0] === 'Hel' && pieces[2] === ' world', '跨 chunk 半行正确解析', pieces);

// ---------- 2. 不支持流式 → streamUnsupported ----------
console.log('== 2. 不支持流式 ==');
mode = 'nostream';
http.resetBreaker();
let e2 = null;
try { await llm.chatCompletionStream([{ role: 'user', content: 'hi' }], {}); } catch (e) { e2 = e; }
ok(e2 && e2.extra && e2.extra.streamUnsupported === true, '抛 streamUnsupported 供调用方回退', e2 && e2.extra);

// ---------- 3. 失败计入熔断 ----------
console.log('== 3. 失败计熔断 ==');
mode = 'error';
http.resetBreaker();
for (let i = 0; i < 3; i++) {
  await llm.chatCompletionStream([{ role: 'user', content: 'hi' }], {}).catch(() => {});
}
ok(http.breakerState(http.breakerKeyOf('https://api.test.com/v1/chat/completions')).open === true, '流式连续失败也熔断');

// ---------- 4. ai-content.chat 的回退路径 ----------
console.log('== 4. chat 自动回退 ==');
const ac = await import('file:///C:/Users/33156/WorkBuddy/2026-10-06-17-27-44/uniapp/services/ai-content.js');
http.resetBreaker();
// 先 nostream：onDelta 存在 → 走流式 → streamUnsupported → 回退非流式（但 nostream 的 fetch 没 text()…）
// 非流式分支需要 res.text()，这里 mode 切回一个"整包 JSON"的假实现
mode = 'whole';
globalThis.fetch = async () => ({
  status: 200, ok: true,
  text: async () => JSON.stringify({ choices: [{ message: { content: '整块回复' } }] })
});
const rr = await ac.chat([{ role: 'user', content: 'hi' }], { onDelta: () => {} });
// 注意：走流式时 onDelta 会被调（假 fetch 不支持流 → 直接回退），最终内容应来自整块
ok(typeof rr.content === 'string' && rr.content.length > 0, '回退后有内容', rr.content && rr.content.slice(0, 20));

console.log('');
console.log('== 汇总 ==');
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) { console.error('FAILED'); process.exit(1); }
console.log('OK');
