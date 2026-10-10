// _tools/live-page-agent.js - AI 指令链路「真实 DeepSeek 联测」（不进回归套件，需要密钥）
//
// 运行：
//   DEEPSEEK_API_KEY=sk-xxx node --experimental-strip-types _tools/live-page-agent.js
//   或  node --experimental-strip-types _tools/live-page-agent.js --key sk-xxx
//
// 跑法：真实模块（settings / page-schema / page-command / page-agent）+ 真实 DeepSeek API，
// 逐条发送用户会说的原话，断言 plan() → applyCommands() 全链路成功且页面真的变了。
// 这是为了抓住「mock 模型测不出」的问题：模型输出形态千奇百怪，只有真打才知道。
//
// 用例来源：2026-10-09 用户截图报错「增加一个有趣的卡片。」+ 搜索框下全部推荐语。

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');
const P = (rel) => 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');

// ---------- 密钥 ----------
let KEY = process.env.DEEPSEEK_API_KEY || '';
const keyArg = process.argv.indexOf('--key');
if (keyArg >= 0 && process.argv[keyArg + 1]) KEY = process.argv[keyArg + 1];
if (!KEY) {
  console.error('缺少密钥：请设置环境变量 DEEPSEEK_API_KEY 或传 --key sk-xxx');
  process.exit(2);
}

/* ---------- mock：只给存储，不给 uni.request（网络走 Node 原生 fetch，打真接口） ---------- */
const kv = {};
global.uni = {
  getStorageSync: (k) => (k in kv ? kv[k] : ''),
  setStorageSync: (k, v) => { kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; },
  showToast: () => {},
  hideKeyboard: () => {},
  getSystemInfoSync: () => ({ statusBarHeight: 20 })
};

let pass = 0;
let fail = 0;

(async () => {
  const settings = await import(P('utils/settings.js'));
  const pageDoc = await import(P('utils/page-doc.js'));
  const pageCommand = await import(P('utils/page-command.js'));
  const pageAgent = await import(P('services/page-agent.js'));
  const intent = await import(P('utils/intent.js'));

  settings.set({
    ai: { enabled: true, provider: 'deepseek', baseURL: 'https://api.deepseek.com/v1', apiKey: KEY, model: 'deepseek-chat' }
  });

  const CASES = [
    // ① 用户截图里报「card.design：缺少卡片定位」的原话
    '增加一个有趣的卡片。',
    // ② 搜索框下全部推荐语（用户说其中两条也翻过车）
    ...intent.SUGGESTIONS,
    // ③ 补充的高频说法
    '把所有卡片圆角调大一点',
    '让首页文案更活泼一点'
  ];

  console.log('用例 ' + CASES.length + ' 条，模型 deepseek-chat，开始联测…\n');

  for (const text of CASES) {
    const label = '「' + text + '」';
    let r;
    try {
      r = await pageAgent.plan(text, pageDoc.get(), { timeout: 60000 });
    } catch (e) {
      fail++;
      console.log('✗ ' + label + ' → plan 抛异常：' + (e && e.message));
      continue;
    }
    if (!r.ok) {
      fail++;
      console.log('✗ ' + label + ' → ' + (r.error || '(无报错信息)') + '  [尝试 ' + r.attempts + ' 次]');
      continue;
    }
    // 指令真的要能落到页面上
    const res = pageCommand.applyCommands(pageDoc.get(), r.commands, {});
    if (!res.ok) {
      fail++;
      console.log('✗ ' + label + ' → 指令解析成功但执行失败：' + res.reason);
      continue;
    }
    pageCommand.commit(res.doc, r.say || '');
    pass++;
    console.log('✓ ' + label + ' → ' + (r.say || pageCommand.summaryOf(res.applied)) +
      '  [' + r.commands.map(c => c.op).join(' + ') + ']');
  }

  console.log('\n通过 ' + pass + ' / ' + CASES.length + '，失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('联测脚本异常：', e && e.message);
  process.exit(1);
});
