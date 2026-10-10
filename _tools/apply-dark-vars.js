// 一次性迁移脚本：把样式里写死的「中性色」换成 CSS 变量（带原值兜底）
// 只处理 <style> 区块，不动 template / script。
// 输出两行：先写原值（老 webview / 未定义变量时生效），再写 var()（深色模式覆盖）。
//
//   --ink-1 / --ink-2 / --ink-3   文本三档（主 / 次 / 弱）
//   --surface-rgb                 白色半透明面板（卡片、玻璃、内嵌面板）
//   --hairline                    发丝描边（浅色下是白，深色下要改成极淡的白）
//   --neutral-rgb                 中性描边 / 凹槽（深色下翻成白）
//   --shadow-rgb                  投影（深色下翻成黑）
//   --solid                       纯白面板（弹窗等），深色下改成深灰
//
// 幂等：某条规则产出的变量名已经在行里出现时，该行不再改写。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
const TARGETS = ['App.vue', 'pages', 'pkgStudy/pages', 'pkgManage/pages', 'components'];

const WHITE = /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([0-9.]+)\s*\)/gi;
const INK = /rgba\(\s*23\s*,\s*32\s*,\s*26\s*,\s*([0-9.]+)\s*\)/gi;

function walk(dir, out) {
  fs.readdirSync(dir).forEach((name) => {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.vue$/.test(name)) out.push(p);
  });
  return out;
}

// 单行转换：返回 null 表示无需改写
function convert(line) {
  const src = line;
  let out = line;

  // 1) 文本三档
  if (!/var\(--ink-1/.test(out)) out = out.replace(/#17201a/gi, 'var(--ink-1, #17201a)');
  if (!/var\(--ink-2/.test(out)) out = out.replace(/#5a6560/gi, 'var(--ink-2, #5a6560)');
  if (!/var\(--ink-3/.test(out)) out = out.replace(/#98a19b/gi, 'var(--ink-3, #98a19b)');

  // 2) 白色半透明：描边走 --hairline，其余走 --surface-rgb
  if (!/var\(--hairline/.test(out) && /border/.test(out)) {
    out = out.replace(WHITE, 'var(--hairline, rgba(255, 255, 255, $1))');
  }
  if (!/var\(--surface-rgb/.test(out)) {
    out = out.replace(WHITE, 'rgba(var(--surface-rgb, 255, 255, 255), $1)');
  }

  // 3) 中性色：投影走 --shadow-rgb，其余走 --neutral-rgb
  if (!/var\(--shadow-rgb/.test(out) && /box-shadow/.test(out)) {
    out = out.replace(INK, 'rgba(var(--shadow-rgb, 23, 32, 26), $1)');
  }
  if (!/var\(--neutral-rgb/.test(out)) {
    out = out.replace(INK, 'rgba(var(--neutral-rgb, 23, 32, 26), $1)');
  }

  // 4) 纯白面板（只改背景，不能动 color: #ffffff，否则按钮文字在深色下会变黑）
  if (!/var\(--solid/.test(out) && /background/.test(out)) {
    out = out.replace(/#ffffff/gi, 'var(--solid, #ffffff)');
  }

  return out === src ? null : out;
}

let files = [];
TARGETS.forEach((t) => {
  const p = path.join(ROOT, t);
  if (!fs.existsSync(p)) return;
  if (fs.statSync(p).isDirectory()) walk(p, files);
  else files.push(p);
});

let changed = 0;
let lines = 0;

files.forEach((file) => {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('<style');
  if (start < 0) return;
  const openEnd = src.indexOf('>', start);
  const end = src.lastIndexOf('</style>');
  if (openEnd < 0 || end < 0) return;

  const head = src.slice(0, openEnd + 1);
  const body = src.slice(openEnd + 1, end);
  const tail = src.slice(end);

  const out = [];
  body.split('\n').forEach((line) => {
    const converted = convert(line);
    if (converted !== null) {
      out.push(line);       // 兜底行
      out.push(converted);  // 变量行
      lines++;
    } else {
      out.push(line);
    }
  });

  const next = head + out.join('\n') + tail;
  if (next !== src) {
    fs.writeFileSync(file, next);
    changed++;
  }
});

console.log('处理文件 ' + files.length + ' 个，改写 ' + changed + ' 个，新增兜底行 ' + lines + ' 行');
