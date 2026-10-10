// 一次性修正：迁移脚本把「同一行里既有 background 又有 color:#ffffff」的文字也转成了 --solid，
// 这里把 color 还原成固定白色（按钮/标签上的白字在任何主题下都应是白的）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
const TARGETS = ['App.vue', 'pages', 'pkgStudy/pages', 'pkgManage/pages', 'components'];

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

const RE = /color:\s*var\(--solid,\s*#ffffff\)/gi;
let changed = 0;
files.forEach((f) => {
  const s = fs.readFileSync(f, 'utf8');
  const next = s.replace(RE, 'color: #ffffff');
  if (next !== s) { fs.writeFileSync(f, next); changed++; }
});
console.log('修正文件 ' + changed + ' 个');
