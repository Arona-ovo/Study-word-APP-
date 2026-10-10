// 一次性脚本：给每个页面的根节点挂上外观 class / style（深色模式在 App 端只能这样生效）
// 只改根级 <view>（缩进 2 空格，紧跟 <template> 或与第一个根互斥的 v-else 根）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
const ADD = ' :class="appTheme" :style="appBgStyle"';

function walk(dir, out) {
  fs.readdirSync(dir).forEach((name) => {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.vue$/.test(name)) out.push(p);
  });
  return out;
}

const files = [];
['pages', 'pkgStudy/pages', 'pkgManage/pages'].forEach(d => { const p = path.join(ROOT, d); if (fs.existsSync(p)) walk(p, files); });

let changed = 0;
files.forEach((file) => {
  const src = fs.readFileSync(file, 'utf8');
  if (src.indexOf('appTheme') >= 0) return;

  const lines = src.split('\n');
  let hit = 0;
  for (let i = 0; i < lines.length; i++) {
    const prev = (lines[i - 1] || '').trim();
    const isRoot = prev === '<template>' || prev === '</view>' || prev === '';
    if (!isRoot) continue;
    const m = lines[i].match(/^(  <view\s+(?:v-else\s+)?class="[^"]*")(.*)$/);
    if (!m) continue;
    if (lines[i].indexOf('appTheme') >= 0) continue;
    lines[i] = m[1] + ADD + m[2];
    hit++;
  }
  if (!hit) return;
  const next = lines.join('\n');
  if (next !== src) {
    fs.writeFileSync(file, next);
    changed++;
  }
});

console.log('改写文件 ' + changed + ' 个');
