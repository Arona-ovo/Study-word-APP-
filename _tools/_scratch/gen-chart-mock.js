// 生成 widget-chart / widget-goal 的静态预览 HTML（等价 CSS + 真实几何数据）
// 运行：node _tools/_scratch/gen-chart-mock.js
const fs = require('fs');
const path = require('path');
const { load } = require('../lib/load');

const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

const words = load('data/words.js');
const sentences = load('data/sentences.js');
const lemma = load('utils/lemma.js');
const wb = load('data/wordbooks.js', { WORDS: words.WORDS });
const store = load('utils/store.js');
const sentenceIndex = load('utils/sentence-index.js', {
  SENTENCES: sentences.SENTENCES, WORDS: words.WORDS, lemmaCandidates: lemma.lemmaCandidates
});
const engine = load('utils/engine.js', {
  WORDS: words.WORDS, SENTENCES: sentences.SENTENCES, store, sentenceIndex
});
const checkin = load('utils/checkin.js', { engine });

// 造一段真实感的 30 天历史（0 = 没背）
const st = store.get();
st.days = {};
const plan = [12, 15, 0, 20, 18, 0, 0, 10, 22, 16, 14, 0, 8, 13, 19, 11, 0, 0, 25, 17, 12, 14, 0, 16, 9, 21, 13, 15, 0, 11];
plan.forEach((total, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (plan.length - 1 - i));
  if (total > 0) st.days[engine.dateStr(d)] = { total: total, correct: Math.round(total * 0.7) };
});
store.save(st);

// 造一段 30 天全空的历史，验证空态
const emptySeries = checkin.series(30);

const s = checkin.series(30);
const g = checkin.geometry(s);
const segs = checkin.segments(g.pts, checkin.RATIO / 100);
const f = checkin.formatChange(s);
const dirCls = s.up === false ? 'down' : 'up';

function chartHtml(series, geo, segments, fmt, cls) {
  const grid = [1, 2, 3].map(k => '  <div class="ck-gline" style="top:' + (k * 25) + '%"></div>').join('\n');
  const base = '  <div class="ck-base" style="top:' + geo.baseY.toFixed(3) + '%"></div>';
  const line = segments.map(sg =>
    '  <div class="ck-seg ' + (sg.up ? 'up' : 'down') + '" style="left:' + sg.x.toFixed(3) +
    '%;top:' + sg.y.toFixed(3) + '%;width:' + sg.w.toFixed(3) + '%;transform:rotate(' +
    sg.ang + 'deg)"></div>').join('\n');
  const dots = geo.pts
    .filter((p, i) => p.total > 0 && i < geo.pts.length - 1)
    .concat([geo.pts[geo.pts.length - 1]])
    .map(p =>
      '  <div class="ck-dot ' + (p.up ? 'up' : 'down') + (p.isToday ? ' today' : '') +
      (p.total === 0 ? ' zero' : '') + '" style="left:' + p.x.toFixed(3) + '%;top:' +
      p.y.toFixed(3) + '%"></div>').join('\n');
  return `<div class="card">
  <div class="wdg-head"><span class="wdg-title">打卡走势</span>
    <div class="ck-rng"><span class="ck-rng-item">7天</span><span class="ck-rng-item on">30天</span></div></div>
  <div class="ck-quote"><span class="ck-val ${cls}">${fmt.value}</span><span class="ck-chg ${cls}">${fmt.change}  ${fmt.pct}</span></div>
  <div class="ck-box" style="padding-bottom:${checkin.RATIO}%">
${grid}
${base}
${line}
${dots}
  </div>
  <div class="ck-axis"><span class="ck-ax">${series.days[0].label}</span><span class="ck-ax mid">${series.days[Math.floor((series.days.length - 1) / 2)].label}</span><span class="ck-ax last">今天</span></div>
  <span class="wdg-foot">打卡 ${series.checked} / 30 天 · 连续 ${series.streak} 天 · 今日 ${series.todayTotal} 题 · 累计 ${series.totalDone} 题</span>
</div>`
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>打卡走势 / 每日目标 预览</title>
<style>
  :root{
    --brand:#2e6bff; --brand-strong:#1d4fd8; --brand-rgb:46,107,255;
    --ink-1:#17201a; --ink-2:#5a6560; --ink-3:#98a19b;
    --surface:#ffffff; --surface-rgb:255,255,255; --neutral-rgb:23,32,26;
    --shadow-rgb:23,32,26; --hairline:rgba(255,255,255,0.75);
    --ck-up:#e5484d; --ck-down:#16a34a;
  }
  *{box-sizing:border-box}
  body{margin:0;padding:24px 16px;background:#e9ecea;
       font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink-1)}
  .stage{max-width:420px;margin:0 auto}
  .card{background:rgba(var(--surface-rgb),.72);
        -webkit-backdrop-filter:blur(12px) saturate(180%);backdrop-filter:blur(12px) saturate(180%);
        border:1px solid #eff2f5;border-radius:22px;padding:24px 22px;
        box-shadow:0 6px 18px rgba(var(--shadow-rgb),.1),0 1px 4px rgba(var(--shadow-rgb),.05);
        margin-bottom:20px}
  .dark{--ink-1:#eaf0ed;--ink-2:#a7b3ae;--ink-3:#74807b;--surface-rgb:46,52,48;
        --shadow-rgb:0,0,0;--hairline:rgba(255,255,255,.09);--neutral-rgb:255,255,255;
        --ck-up:#ff7a7d;--ck-down:#4ade80}
  .wdg-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
  .wdg-title{font-size:15px;font-weight:600;letter-spacing:.5px}
  .wdg-link{font-size:12px;color:var(--brand-strong)}
  .ck-rng{display:flex;background:rgba(var(--surface-rgb),.62);
          -webkit-backdrop-filter:blur(8px) saturate(180%);backdrop-filter:blur(8px) saturate(180%);
          border:1px solid rgba(255,255,255,.7);border-radius:999px;padding:2px}
  .ck-rng-item{font-size:11px;color:var(--ink-2);padding:3px 11px;border-radius:999px}
  .ck-rng-item.on{background:var(--brand);color:#fff;font-weight:600}
  .ck-quote{display:flex;align-items:baseline;padding:1px 0 8px}
  .ck-val{font-size:26px;font-weight:600;letter-spacing:.5px;line-height:1.1}
  .ck-chg{margin-left:12px;font-size:13px;font-weight:500}
  .ck-val.up,.ck-chg.up{color:var(--ck-up)}
  .ck-val.down,.ck-chg.down{color:var(--ck-down)}
  .ck-val.flat,.ck-chg.flat{color:var(--ink-2)}
  .ck-box{position:relative;width:100%;height:0}
  .ck-grid{position:absolute;left:1.2%;right:1.2%;top:9%;bottom:12%}
  .ck-gline{position:absolute;left:0;right:0;height:0;border-top:1px solid rgba(var(--neutral-rgb),.09)}
  .ck-base{position:absolute;left:1.2%;right:1.2%;height:0;border-top:1px dashed rgba(var(--neutral-rgb),.28)}
  .ck-seg{position:absolute;height:3px;margin-top:-1.5px;border-radius:3px;transform-origin:0 50%}
  .ck-seg.up{background:var(--ck-up)}
  .ck-seg.down{background:var(--ck-down)}
  .ck-dot{position:absolute;width:5px;height:5px;margin-left:-2.5px;margin-top:-2.5px;border-radius:50%}
  .ck-dot.up{background:var(--ck-up)}
  .ck-dot.down{background:var(--ck-down)}
  .ck-dot.zero{background:rgba(var(--neutral-rgb),.18)}
  .ck-dot.today{width:11px;height:11px;margin-left:-5.5px;margin-top:-5.5px;
    border:2.5px solid var(--surface);box-sizing:border-box;
    box-shadow:0 0 0 4px rgba(var(--brand-rgb),.18)}
  .ck-side{position:absolute;left:0;font-size:10px;color:var(--ink-3);
    font-variant-numeric:tabular-nums}
  .ck-side.hi{top:0}.ck-side.lo{bottom:0}
  .ck-axis{display:flex;align-items:center;justify-content:space-between;padding:8px 0 0}
  .ck-ax{font-size:11px;color:var(--ink-3)}
  .wdg-foot{display:block;margin-top:8px;font-size:12px;color:var(--ink-3)}
  .cap{font-size:12px;color:var(--ink-2);margin:0 0 12px;line-height:1.7}
  /* 每日目标卡 */
  .go-row{margin-bottom:16px}.go-row:last-of-type{margin-bottom:10px}
  .go-line{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px}
  .go-name{font-size:14px;color:var(--ink-2)}
  .go-num{font-size:14px;font-weight:600;color:var(--ink-1);font-variant-numeric:tabular-nums}
  .go-num.ok{color:var(--brand)}
  .progress-track{background:rgba(var(--neutral-rgb),.08);border-radius:999px;overflow:hidden}
  .progress-fill{height:100%;background:var(--brand);border-radius:999px}
  /* 设置卡 */
  .goal-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;
             border-bottom:1px solid rgba(var(--neutral-rgb),.07)}
  .goal-title{display:block;font-size:16px;font-weight:600;letter-spacing:.5px}
  .goal-sub{display:block;margin-top:4px;font-size:12px;color:var(--ink-3)}
  .gi-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px}
  .gi-head-2{margin-top:26px}
  .gi-name{font-size:14px;font-weight:500}
  .gi-hint{font-size:11px;color:var(--ink-3)}
  .gi-ctrl{display:flex;align-items:center;justify-content:space-between}
  .gi-step{width:34px;height:34px;text-align:center;line-height:32px;font-size:18px;font-weight:600;
           color:var(--brand-strong);background:rgba(var(--surface-rgb),.66);
           border:1px solid rgba(var(--brand-rgb),.28);border-radius:999px;box-sizing:border-box}
  .gi-input{flex:1;margin:0 14px;text-align:center;height:38px;font-size:17px;font-weight:600;
           color:var(--ink-1);background:rgba(var(--surface-rgb),.72);
           border:1px solid rgba(255,255,255,.8);border-radius:10px;box-sizing:border-box}
  .gi-chips{display:flex;margin-top:12px}
  .gi-chip{flex:1;text-align:center;font-size:12px;color:var(--ink-2);
           background:rgba(var(--surface-rgb),.6);border:1px solid rgba(255,255,255,.7);
           border-radius:8px;padding:6px 0;margin-right:8px}
  .gi-chip:last-child{margin-right:0}
  .gi-chip.on{background:var(--brand);color:#fff;font-weight:600}
</style>
</head>
<body>
<div class="stage">

  <p class="cap">① 首页新模块「打卡走势」—— 股票式折线图（红涨绿跌，30 天 / 7 天）</p>
  __CHART30__
  __CHART7__

  <p class="cap">② 首页新模块「每日目标」—— 今日完成度，点「设置 ›」进词书改目标</p>
  __GOAL__

  <p class="cap">③ 词库 → 词库详情 → 新分段「每日目标」—— 按词书设置</p>
  __GOALSET__

</div>
</body>
</html>`

function chartHtmlOf(range) {
  const sr = checkin.series(range)
  const gr = checkin.geometry(sr)
  const sg = checkin.segments(gr.pts, checkin.RATIO / 100)
  const fm = checkin.formatChange(sr)
  const cls = sr.up === false ? 'down' : 'up'
  const grid = [1, 2, 3].map(k =>
    '    <div class="ck-gline" style="top:' + (k * 25) + '%"></div>').join('\n')
  const base = '    <div class="ck-base" style="top:' + gr.baseY.toFixed(3) + '%"></div>'
  const line = sg.map(x =>
    '    <div class="ck-seg ' + (x.up ? 'up' : 'down') + '" style="left:' + x.x.toFixed(3) +
    '%;top:' + x.y.toFixed(3) + '%;width:' + x.w.toFixed(3) + '%;transform:rotate(' +
    x.ang + 'deg)"></div>').join('\n')
  const dots = gr.pts
    .filter((p, i) => p.total > 0 && i < gr.pts.length - 1)
    .concat([gr.pts[gr.pts.length - 1]])
    .map(p =>
      '    <div class="ck-dot ' + (p.up ? 'up' : 'down') + (p.isToday ? ' today' : '') +
      (p.total === 0 ? ' zero' : '') + '" style="left:' + p.x.toFixed(3) + '%;top:' +
      p.y.toFixed(3) + '%"></div>').join('\n')
  return `<div class="card">
  <div class="wdg-head"><span class="wdg-title">打卡走势</span>
    <div class="ck-rng"><span class="ck-rng-item${range === 7 ? ' on' : ''}">7天</span><span class="ck-rng-item${range === 30 ? ' on' : ''}">30天</span></div></div>
  <div class="ck-quote"><span class="ck-val ${cls}">${fm.value}</span><span class="ck-chg ${cls}">${fm.change}  ${fm.pct}</span></div>
  <div class="ck-box" style="padding-bottom:${checkin.RATIO}%">
    <div class="ck-grid">
${grid}
    </div>
${base}
${line}
${dots}
  </div>
  <div class="ck-axis"><span class="ck-ax">${sr.days[0].label}</span><span class="ck-ax mid">${sr.days[Math.floor((sr.days.length - 1) / 2)].label}</span><span class="ck-ax last">今天</span></div>
  <span class="wdg-foot">打卡 ${sr.checked} / ${range} 天 · 连续 ${sr.streak} 天 · 今日 ${sr.todayTotal} 题 · 累计 ${sr.totalDone} 题</span>
</div>`
}

function goalHtml() {
  return `<div class="card">
  <div class="wdg-head"><span class="wdg-title">每日目标</span><span class="wdg-link">设置 ›</span></div>
  <div class="go-row">
    <div class="go-line"><span class="go-name">新词</span><span class="go-num">8 / 20</span></div>
    <div class="progress-track go-track"><div class="progress-fill" style="width:40%"></div></div>
  </div>
  <div class="go-row">
    <div class="go-line"><span class="go-name">练习通过</span><span class="go-num ok">12 / 10</span></div>
    <div class="progress-track go-track"><div class="progress-fill full" style="width:100%"></div></div>
  </div>
  <span class="wdg-foot">还差一项就达标 · 今日已练 18 题 · 正确 12 题</span>
</div>`
}

function goalSettingHtml() {
  return `<div class="card">
  <div class="goal-head">
    <div><span class="goal-title">每日目标</span><span class="goal-sub">核心词书 · 与其他词书互不影响</span></div>
    <span style="font-size:12px;color:var(--brand-strong)">［开关 开］</span>
  </div>
  <div style="padding-top:20px">
    <div class="gi-head"><span class="gi-name">每日新词</span><span class="gi-hint">当天首次接触即计入</span></div>
    <div class="gi-ctrl">
      <span class="gi-step">−</span><span class="gi-input">20</span><span class="gi-step">＋</span>
    </div>
    <div class="gi-chips">
      <span class="gi-chip">10</span><span class="gi-chip on">20</span><span class="gi-chip">30</span><span class="gi-chip">50</span>
    </div>
    <div class="progress-track gi-track"><div class="progress-fill" style="width:40%"></div></div>
    <span class="gi-foot">今天新词 8 / 20</span>

    <div class="gi-head gi-head-2"><span class="gi-name">每日练习通过</span><span class="gi-hint">答对即通过，错题重练也算</span></div>
    <div class="gi-ctrl">
      <span class="gi-step">−</span><span class="gi-input">10</span><span class="gi-step">＋</span>
    </div>
    <div class="gi-chips">
      <span class="gi-chip on">10</span><span class="gi-chip">20</span><span class="gi-chip">30</span><span class="gi-chip">50</span>
    </div>
    <div class="progress-track gi-track"><div class="progress-fill full" style="width:100%"></div></div>
    <span class="gi-foot">今天通过 12 / 10 题</span>

    <div style="margin-top:22px;font-size:12px;color:var(--ink-3);line-height:1.7">
      目标只对当前词书生效；首页的「每日目标」组件会实时显示完成度。
    </div>
  </div>`
}

const out = html
  .replace('__CHART30__', chartHtmlOf(30))
  .replace('__CHART7__', chartHtmlOf(7))
  .replace('__GOAL__', goalHtml())
  .replace('__GOALSET__', goalSettingHtml());
fs.writeFileSync(path.join(__dirname, 'chart-mock.html'), out, 'utf8');
console.log('已生成 _tools/_scratch/chart-mock.html');
