// _tools/check-i18n.js - 界面语言（中 / 英）校验
// 覆盖：
//  1) 引擎：key = 中文原文、英文回退、占位符、切语言广播 + 落盘
//  2) 字典：英文表自身完整（无空值 / 无重复键）、key 与代码里用到的对得上
//  3) 覆盖：模板与脚本里"静态中文串"必须已套 $t()（漏网之鱼会被列出来）
//  4) 接入：main.js 挂了全局 mixin、底栏 / 星期 / 日期走的是 i18n
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load');

const ROOT = path.join(__dirname, '..', 'uniapp');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const HAN = /[\u4e00-\u9fa5]/;

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const eq = (a, b, label) => {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
};
const assert = (c, m) => (c ? ok(m) : bad(m));

/* ---------- 1. 引擎 ---------- */
console.log('== 1. i18n 引擎 ==');
const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {},
  $emit: () => {}, $on: () => {}, $off: () => {}
};

const settings = load('utils/settings.js');
settings.init();
const en = load('utils/i18n-en.js').default;
const i18n = load('utils/i18n.js', { settings, EN: en });
i18n.init();

eq(i18n.current(), 'zh', '默认语言');
eq(i18n.t('加入词书'), '加入词书', '中文态直接显示 key（不用另存中文表）');
eq(i18n.t('这条根本没翻的文案'), '这条根本没翻的文案', '英文表查不到 → 回退中文（不会空白）');

i18n.setLocale('en');
eq(i18n.current(), 'en', 'setLocale 生效');
eq(i18n.t('加入词书'), 'Add to wordbook', '英文态取译文');
eq(i18n.t('没翻的'), '没翻的', '英文态缺译 → 回退中文');
eq(i18n.t('已加入「{name}」', { name: '核心词书' }), 'Added to “核心词书”', '占位符 {name} 生效');
eq(settings.get().locale, 'en', '语言已落盘');
// 未翻译的 key 回退到中文时，占位符也要替换
eq(i18n.t('随便一句 {n}', { n: 3 }), '随便一句 3', '回退中文时占位符同样生效');
i18n.setLocale('zh');
eq(settings.get().locale, 'zh', '切回中文也落盘');
eq(i18n.weekdays().length, 7, 'weekdays 7 项');
i18n.setLocale('en');
eq(i18n.weekday(new Date(2026, 9, 8)), 'Thu', 'weekday(2026-10-08)');
assert(/\d+ · [A-Z]/.test(i18n.dateLabel(new Date(2026, 9, 8))) ||
       /[A-Z][a-z]{2} \d+ ·/.test(i18n.dateLabel(new Date(2026, 9, 8))), '英文日期 = ' + i18n.dateLabel(new Date(2026, 9, 8)));
i18n.setLocale('zh');
assert(/月.*日 ·/.test(i18n.dateLabel(new Date(2026, 9, 8))), '中文日期 = ' + i18n.dateLabel(new Date(2026, 9, 8)));
eq(i18n.LOCALES.length, 2, '两档语言');

/* ---------- 2. 英文表自身 ---------- */
console.log('== 2. 英文表 ==');
const keys = Object.keys(en);
assert(keys.length > 200, '英文表 ' + keys.length + ' 条');
const empty = keys.filter(k => !en[k]);
eq(empty.length, 0, '没有空译文' + (empty.length ? '（空：' + empty.slice(0, 5).join(' / ') + '）' : ''));
// 重复键（对象字面量里后者覆盖前者，容易悄悄丢译文）
const rawEn = R('utils/i18n-en.js');
const dup = {};
(rawEn.match(/^\s*'[^']*':/gm) || []).forEach(m => {
  const k = m.trim().replace(/:$/, '');
  dup[k] = (dup[k] || 0) + 1;
});
const dups = Object.keys(dup).filter(k => dup[k] > 1);
eq(dups.length, 0, '没有重复键' + (dups.length ? '（' + dups.join(' / ') + '）' : ''));

// AI 功能清单里的名称 / 说明是**变量**传给 $t() 的，第 3 组那种"扫静态中文串"的方式
// 覆盖不到它们 —— 缺译文不会报错，只会在英文模式下悄悄露中文。这里显式补上。
console.log('== 2b. AI 功能清单动态文案 ==');
const gate = load('services/ai-gate.js', { settings });
const missing = [];
(gate.AI_FEATURES || []).forEach(f => {
  ['name', 'desc', 'levelLabel'].forEach(field => {
    const v = f[field];
    if (v && !en[v]) missing.push(f.key + '.' + field + ' = ' + v);
  });
});
assert((gate.AI_FEATURES || []).length >= 6, 'AI 功能已登记 ' + (gate.AI_FEATURES || []).length + ' 项');
eq(missing.length, 0, '每项功能都有英文译文' + (missing.length ? '（缺：' + missing.slice(0, 4).join(' / ') + '）' : ''));

/* ---------- 3. 代码里的静态中文必须已套 $t ---------- */
console.log('== 3. 未国际化的静态中文（漏网） ==');
function walk(dir, ext) {
  const out = [];
  fs.readdirSync(dir).forEach(n => {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (n.endsWith(ext)) out.push(p);
  });
  return out;
}
const files = walk(path.join(ROOT, 'pages'), '.vue').concat(walk(path.join(ROOT, 'pkgStudy/pages'), '.vue')).concat(walk(path.join(ROOT, 'pkgManage/pages'), '.vue')).concat(walk(path.join(ROOT, 'components'), '.vue'));
const left = [];
files.forEach(f => {
  const src = fs.readFileSync(f, 'utf8');
  const cut = src.indexOf('\n</template>');
  const tpl = cut > 0 ? src.slice(0, cut) : '';
  const rest = cut > 0 ? src.slice(cut) : src;
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');

  // 模板：属性值 / 文本节点
  (tpl.match(/\s[a-zA-Z_][\w:.-]*="[^"\n{}]*"/g) || []).forEach(m => {
    const v = m.slice(m.indexOf('="') + 2, -1);
    if (HAN.test(v) && !/class|style|src|mode|type|name|id/.test(m)) left.push(rel + ' 属性 ' + v);
  });
  (tpl.match(/>[^<>{}]*</g) || []).forEach(m => {
    const v = m.slice(1, -1).trim();
    if (HAN.test(v)) left.push(rel + ' 文本 ' + v);
  });
  // 脚本：字符串字面量（跳过注释行）
  rest.split('\n').forEach(line => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (/^\s*import /.test(line)) return;
    (line.match(/'[^'\n]*'/g) || []).forEach(m => {
      const v = m.slice(1, -1);
      const i = line.indexOf(m);
      const pre = line.slice(Math.max(0, i - 3), i + 1);
      if (HAN.test(v) && !pre.includes('t(')) left.push(rel + ' 脚本 ' + v);
    });
  });
});
// 允许少量"刻意保留中文"的地方（学习内容是中文、日期单位等），阈值卡住不让它变多
const LIMIT = 40;
if (left.length) {
  left.slice(0, 15).forEach(l => console.log('    · ' + l));
  console.log('    共 ' + left.length + ' 处（阈值 ' + LIMIT + '）');
}
assert(left.length <= LIMIT, '漏网的静态中文 ' + left.length + ' 处 ≤ ' + LIMIT + '（新增文案记得套 $t）');

/* ---------- 4. 接入点 ---------- */
console.log('== 4. 接入点 ==');
const main = R('main.js');
assert(/i18nMixin/.test(main) && /app\.mixin\(i18nMixin\)/.test(main), 'main.js 挂了全局 i18n mixin');
assert(/i18n\.init\(\)/.test(main), 'createApp 前先 init（读档决定语言）');
const mix = R('utils/i18n-mixin.js');
assert(/\$t\(zh, vars\)/.test(mix), 'mixin 提供 $t');
assert(/void this\.__lang/.test(mix), '$t 读 __lang 建立渲染依赖（切语言自动重画）');
assert(/uni\.\$on\('i18n:change'/.test(mix), '订阅语言变更');
assert(/beforeUnmount|onUnload/.test(mix), '有退订（组件 + 页面两条路）');

const st = R('utils/settings.js');
assert(/locale:\s*'zh'/.test(st), 'settings 默认值含 locale');

const sv = R('pkgManage/pages/settings/settings.vue');
assert(/@tap="pickLocale"/.test(sv), '设置页有语言入口');
assert(/setLocale\(/.test(sv), '调用 setLocale 切换');
assert(/localeName/.test(sv), '显示当前语言名');
assert(!/uni\.showActionSheet/.test(sv), '不用系统弹窗选语言');

/* ---------- 5. 首页动态拼接文案必须走 i18n（英文界面不得残留中文） ---------- */
console.log('== 5. 首页 / 小组件的动态拼接文案 ==');
const homeSrc = R('pages/home/home.vue');
// 这些位置曾直接把数字拼进中文句子里（"已学 8 / 20 词"），英文界面下整句裸奔
const bare = [
  [/已学 \{\{/, 'home.vue "已学 {{…}} 词" 拼接未套 $t'],
  [/全书已学 \{\{/, 'home.vue "全书已学 {{…}}" 拼接未套 $t'],
  [/复习 \{\{ wrongCount \}\} 道错题/, 'home.vue "复习 {{n}} 道错题" 拼接未套 $t'],
  [/每次 \{\{ sessionSize \}\} 题/, 'home.vue "每次 {{n}} 题…" 拼接未套 $t'],
  [/本地词库没有「\{\{ lastQuery \}\}」/, 'home.vue "本地词库没有…" 拼接未套 $t'],
  [/{{ batchName }} ·/, 'home.vue 批次名拼接未走展示层翻译']
];
let bareHit = bare.filter(([re]) => re.test(homeSrc));
eq(bareHit.length, 0, bareHit.length ? bareHit.map(b => b[1]).join('；') : 'home.vue 模板没有裸拼接的中文句子');
assert(/batchNameText\(\)/.test(homeSrc), '批次名有展示层翻译（batchNameText）');
const chartSrc = R('components/home-widgets/widget-chart.vue');
assert(!/打卡 \{\{ checked \}\}/.test(chartSrc) && /打卡 \{a\} \/ \{b\} 天/.test(chartSrc), '打卡走势脚注已走占位符文案');
const streakSrc = R('components/home-widgets/widget-streak.vue');
assert(/当前连续 \{s\} 天/.test(streakSrc), '连续天数脚注已走占位符文案');

// computed 里直接调 t() 不会建立渲染依赖：切语言后不重算（placeholder 卡在旧语言）
// 约定：这类 computed 开头 void this.__lang
const computedT = ['navPlaceholder', 'cmdBarText', 'searchTitle', 'aiBadge'];
computedT.forEach(fn => {
  const re = new RegExp(fn + '\\(\\)\\s*\\{\\s*void this\\.__lang');
  assert(re.test(homeSrc), 'computed ' + fn + '() 建立了语言依赖（void this.__lang）');
});

// 占位符引擎：多变量 + 英文语序重排（数字位置跟中文不同）
i18n.setLocale('en');
eq(i18n.t('已学 {t} / {n} 词', { t: 8, n: 20 }), '8 / 20 words learned', '占位符多变量（{t}/{n}）');
eq(i18n.t('第 {n} 组', { n: 1 }), 'Group 1', '批次"第 n 组"');
eq(i18n.t('入门高频词'), 'Starter high-freq', '批次级别名');
eq(i18n.t('复习 {n} 道错题', { n: 14 }), 'Review 14 mistakes', '复习脚注');
i18n.setLocale('zh');
eq(i18n.t('已学 {t} / {n} 词', { t: 8, n: 20 }), '已学 8 / 20 词', '中文态回退 key 本身');

const ts = R('utils/tab-slide.js');
assert(/export function tabText/.test(ts), '底栏文案走 i18n');
const ft = R('components/float-tabbar/float-tabbar.vue');
assert(/tabText\(t\)/.test(ft), '底栏渲染用 tabText()');
assert(/setTabBarItem/.test(R('utils/i18n.js')), '切语言时同步原生 tabBar 文案');

/* ---------- 5. 覆盖率：套了 $t 的 key 必须在英文表里有译文 ---------- */
// 回归点：以前只查"模板里有没有漏套 $t"，没查"套了 $t 的 key 有没有译文"。
// 于是 52 个 key 长期静默掉回中文 —— 英文态下「开始背单词」、小组件文案全是中文，
// 而这一项一直绿着。掉回中文不报错、不空白，只能靠人眼看出来，必须静态守。
console.log('== 5. 译文覆盖率（套了 $t 就必须有英文） ==');
function walkAll(dir, out) {
  fs.readdirSync(dir).forEach(n => {
    const p = path.join(dir, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (n === 'unpackage' || n === 'node_modules') return;
      walkAll(p, out);
    } else if (/\.(vue|js|ts)$/.test(n)) out.push(p);
  });
  return out;
}
const usedKeys = new Map();
const keyRe = /(?:\$t|\bt)\(\s*'([^'\n]*)'\s*(?:,|\))/g;
walkAll(ROOT, []).forEach(f => {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  const re = new RegExp(keyRe.source, 'g');
  let m;
  while ((m = re.exec(src))) {
    const key = m[1];
    if (!key || !HAN.test(key)) continue;          // 只关心中文原文（英文态才需要翻译）
    const line = src.slice(0, m.index).split('\n').length;
    if (!usedKeys.has(key)) usedKeys.set(key, []);
    usedKeys.get(key).push(rel + ':' + line);
  }
});
// 运行时 t() 查表前会 normKey（折叠空白 + trim），字典里带首尾空格的 key 永远命中不了。
// 这里必须照搬同一套归一化，否则会出现「脚本说翻了、界面还是中文」的假绿。
const normKey = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const missingKeys = [];
usedKeys.forEach((locs, key) => { if (!(normKey(key) in en)) missingKeys.push(key + '  ← ' + locs[0]); });
const paddedKeys = Object.keys(en).filter(k => k !== normKey(k));
if (paddedKeys.length === 0) ok('字典里没有带首尾空格 / 多余空白的 key');
else {
  bad(paddedKeys.length + ' 个字典 key 首尾带空白，运行时永远查不到：');
  paddedKeys.slice(0, 20).forEach(s => console.error('      ' + JSON.stringify(s)));
}
if (missingKeys.length === 0) ok(usedKeys.size + ' 个中文 key 全部有英文译文');
else {
  bad('缺 ' + missingKeys.length + ' 条译文（英文态会掉回中文）：');
  missingKeys.slice(0, 40).forEach(s => console.error('      ' + s));
}

// 首页模块注册表里的 name / desc 也是界面文案（编辑首页的卡片名、「添加组件」面板），
// 但它们是数据、不是 $t('…') 字面量，上面的覆盖率扫不到，单独守一条。
const hlSrc = R('utils/home-layout.ts');
const modNames = (hlSrc.match(/name:\s*'([^']+)'/g) || []).map(s => /'([^']+)'/.exec(s)[1]);
const modDescs = (hlSrc.match(/desc:\s*'([^']+)'/g) || []).map(s => /'([^']+)'/.exec(s)[1]);
const modMissing = modNames.concat(modDescs).filter(k => HAN.test(k) && !(k in en));
if (modMissing.length === 0) ok(modNames.length + ' 个模块名 + ' + modDescs.length + ' 条模块说明都有英文');
else bad('模块注册表缺译文：' + modMissing.join(' / '));

/* ---------- 6. 局部变量不能叫 t（会遮蔽 i18n 的 t()） ---------- */
// widget-goal.vue 里 `const t = this.gp.today` 把导入的 t() 顶掉了，
// 于是 t('…') 变成"调用一个对象"直接抛错，小组件整块挂掉。
// 这类碰撞只有真的渲染到才会炸，必须静态扫。
console.log('== 6. 局部变量不得遮蔽 i18n 的 t() ==');
const shadows = [];
walkAll(ROOT, []).forEach(f => {
  const src = fs.readFileSync(f, 'utf8');
  if (!/import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"][^'"]*i18n\.js['"]/.test(src)) return;
  const lines = src.split('\n');
  lines.forEach((ln, i) => {
    if (!/(^|[^A-Za-z0-9_$])(const|let|var)\s+t\s*=/.test(ln)) return;
    const indent = (ln.match(/^\s*/) || [''])[0].length;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const ind = (lines[j].match(/^\s*/) || [''])[0].length;
      if (ind <= indent && /^\s*\}/.test(lines[j])) { end = j; break; }
    }
    if (/\bt\(\s*['"`]/.test(lines.slice(i + 1, end).join('\n'))) {
      shadows.push(path.relative(ROOT, f) + ':' + (i + 1));
    }
  });
});
if (shadows.length === 0) ok('没有局部 t 与 t("…") 落在同一作用域');
else shadows.forEach(s => bad('局部 t 遮蔽了 i18n 的 t()：' + s));

console.log('');
console.log(fail === 0 ? 'i18n 校验全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);
