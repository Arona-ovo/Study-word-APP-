// check-api-usage.js - API 用量统计：分类计数、月汇总、节流落盘、brief 文案

let writes = 0;
const mem = {};
globalThis.uni = {
  getStorageSync: (k) => mem[k] || '',
  setStorageSync: (k, v) => { mem[k] = v; writes++; },
  removeStorageSync: (k) => { delete mem[k]; }
};

const m = await import('file:///C:/Users/33156/WorkBuddy/2026-10-06-17-27-44/uniapp/utils/api-usage.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' => ' + JSON.stringify(extra) : '')); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- 1. 分类计数 ----------
console.log('== 1. 分类计数 ==');
m.clear(); writes = 0;
m.record('llm', 100, 50);
m.record('llm', 200, 80);
m.record('tts');
m.record('image');
m.recordFailure();
const t = m.today();
ok(t.calls === 4, 'calls=4', t);
ok(t.llm === 2 && t.tts === 1 && t.image === 1, '分类正确', t);
ok(t.inTok === 300 && t.outTok === 130, 'token 累加', t);
ok(t.fail === 1, '失败单独记', t.fail);

// ---------- 2. 月汇总 ----------
console.log('== 2. 月汇总 ==');
const mon = m.monthTotal();
ok(mon.calls === 4 && mon.llm === 2, '本月累计', mon);
const s = m.summary();
ok(s.month.calls === 4 && s.lastMonth.calls === 0, 'summary 含上月对比', s.lastMonth);

// ---------- 3. 节流落盘 ----------
console.log('== 3. 节流落盘 ==');
m.flush(); writes = 0;
for (let i = 0; i < 8; i++) m.record('llm', 1, 1);
ok(writes <= 1, '8 次 record 最多 1 次写盘', writes);
await sleep(2300);
ok(writes === 1, '窗口结束后合并写一次', writes);

// ---------- 4. brief 文案 ----------
console.log('== 4. brief 文案 ==');
const b = m.brief();
ok(/本月 \d+ 次/.test(b) && b.indexOf('文本') >= 0, '含本月次数与分类', b);
ok(b.indexOf('失败') >= 0, '含失败计数', b);
m.clear();
ok(m.brief() === '本月还没有调用', '空态文案');

// ---------- 5. fmtTok ----------
console.log('== 5. 格式化 ==');
ok(m.fmtTok(500) === '500', '<1k 原样');
ok(m.fmtTok(3200) === '3.2k', 'k 级', m.fmtTok(3200));
ok(m.fmtTok(2500000) === '2.5M', 'M 级', m.fmtTok(2500000));

// ---------- 6. 估算 ----------
console.log('== 6. 估算 ==');
ok(m.estimateTokens('hello world') > 0, '英文估算');
ok(m.estimateTokens('你好世界') === 2, '中文约 2.2 字/token', m.estimateTokens('你好世界'));
ok(m.estimateMessages([{ content: 'ab' }, { content: 'cdef' }]) === m.estimateTokens('ab') + m.estimateTokens('cdef'), 'messages 求和');

console.log('');
console.log('== 汇总 ==');
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) { console.error('FAILED'); process.exit(1); }
console.log('OK');
