// check-intent-route.js - 指令意图路由：子集合法性、瘦身幅度、安全回退

const pa = await import('file:///C:/Users/33156/WorkBuddy/2026-10-06-17-27-44/uniapp/services/page-agent.js');
const schema = await import('file:///C:/Users/33156/WorkBuddy/2026-10-06-17-27-44/uniapp/utils/page-schema.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' => ' + JSON.stringify(extra) : '')); }
}

// ---------- 1. 无参 / 空子集 = 全量（行为兼容） ----------
console.log('== 1. 全量兼容 ==');
const full = schema.promptManual();
const viaEmpty = schema.promptManual([]);
ok(full === viaEmpty, '空子集等价全量');
ok(schema.COMMAND_OPS.every(op => full.indexOf('- ' + op + '：') >= 0), '全量含全部 ' + schema.COMMAND_OPS.length + ' 条 op');

// ---------- 2. 子集合法性 ----------
console.log('== 2. 子集合法 ==');
const sub = schema.promptManual(['bg.set']);
ok(sub.indexOf('- bg.set：') >= 0, '含目标 op');
ok(sub.indexOf('card.design') < 0, '不带无关 op');
ok(sub.indexOf('preset=') >= 0, 'bg.set 子集含背景说明');
ok(sub.length < full.length * 0.4, '明显瘦身', sub.length + ' vs ' + full.length);

const subDesign = schema.promptManual(['card.design', 'card.add']);
ok(subDesign.indexOf('card.design') >= 0, 'design 子集含 op');
// design spec 的特征行（card-spec.promptSpec 的内容）
const specFull = (await import('file:///C:/Users/33156/WorkBuddy/2026-10-06-17-27-44/uniapp/utils/card-spec.js')).promptSpec();
const specMarker = specFull.split('\n').find(l => l.trim().length > 10) || '';
ok(specMarker && subDesign.indexOf(specMarker.trim()) >= 0, 'design 子集含设计说明书');

// ---------- 3. 路由判定 ----------
console.log('== 3. 路由判定 ==');
const cases = [
  ['把背景换成海边', true, ['bg.set']],
  ['主题换成深色', true, ['theme.set']],
  ['把第2张卡片删掉', true, ['card.remove']],
  ['把每日目标设成30个词', true, ['goal.set']],
  ['保存一个叫晨间的快照', true, ['skin.save']],
  ['给我做一张今日统计卡', true, ['card.design']],
  ['背景换成森林，顺便把错题卡删了', false, null],   // 复合 → 全量
  ['随便搞点什么', false, null],                        // 无匹配 → 全量
  ['', false, null]
];
cases.forEach(([text, expectSub, mustOps]) => {
  const r = pa.routeOps(text);
  if (!expectSub) {
    ok(r.ops === null, '「' + text + '」→ 全量');
    return;
  }
  const hit = r.ops && mustOps.every(op => r.ops.indexOf(op) >= 0);
  ok(!!hit, '「' + text + '」→ 子集含 ' + mustOps.join(','), r.ops);
});

// ---------- 4. 造卡意图必带 design spec ----------
console.log('== 4. 造卡带说明书 ==');
const r4 = pa.routeOps('给我做一张倒计时卡片');
ok(r4.ops && r4.ops.indexOf('card.design') >= 0, 'ops 含 card.design');
const manual4 = schema.promptManual(r4.ops);
ok(manual4.indexOf(specMarker.trim()) >= 0, '手册含设计说明书');

console.log('');
console.log('== 汇总 ==');
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) { console.error('FAILED'); process.exit(1); }
console.log('OK');
