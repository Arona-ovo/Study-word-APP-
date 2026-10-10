// 一次性迁移脚本：把样式里的写死主色换成 CSS 变量（带原值兜底）
// 只处理 <style> 区块，不动 template / script。
// 输出两行：先写原值（老 webview 用），再写 var()（支持变量的浏览器覆盖）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
const TARGETS = ['App.vue', 'pages', 'pkgStudy/pages', 'pkgManage/pages', 'components'];

const RULES = [
  [/rgba\(\s*46\s*,\s*107\s*,\s*255\s*,/gi, 'rgba(var(--brand-rgb, 46, 107, 255),'],
  [/#2e6bff/gi, 'var(--brand, #2e6bff)'],
  [/#1d4fd8/gi, 'var(--brand-strong, #1d4fd8)']
];

function walk(dir, out) {
  fs.readdirSync(dir).forEach((name) => {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.vue$/.test(name)) out.push(p);
  });
  return out;
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
    let converted = line;
    RULES.forEach((r) => { converted = converted.replace(r[0], r[1]); });
    if (converted !== line) {
      out.push(line);        // 兜底行（不支持 CSS 变量时生效）
      out.push(converted);   // 变量行（支持时覆盖）
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
