// 一次性脚本：把"不透明窗体"还原成"半透明磨砂玻璃"
//   1) background: var(--surface/--fill) → rgba(var(--surface-rgb), α)
//      α 从上一条兜底声明 background: rgba(255,255,255, α) 里取（迁移时保留了兜底行，所以能精确还原）
//   2) 重新补上 -webkit-backdrop-filter / backdrop-filter（窗体级 12px，内嵌控件 8px）
// 只处理 <style> 区块，不动 template / script。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
const TARGETS = ['App.vue', 'pages', 'components'];

const SURFACE = [
  /\.card\b/, /\.glass\b/, /\.sec\b/, /\.ftb\b/, /\.fnb\b/,
  /\.btn-ghost\b/, /\.btn-mini\b/, /\.pop-card\b/, /\.loading-card\b/,
  /\.option\b/, /\.bubble\b/, /\.input-bar\b/, /\.replay-btn\b/,
  /\.pop-replay\b/, /\.empty\b/
];

const RE_NEW = /^(\s*)background:\s*var\(--(surface|fill),\s*#[0-9a-fA-F]+\)(.*);\s*$/;
const RE_OLD = /background:\s*rgba\(\s*255,\s*255,\s*255,\s*([0-9.]+)\)/;

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
let bg = 0;
let blur = 0;

files.forEach((file) => {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('<style');
  if (start < 0) return;
  const openEnd = src.indexOf('>', start);
  const end = src.lastIndexOf('</style>');
  if (openEnd < 0 || end < 0) return;

  const head = src.slice(0, openEnd + 1);
  const lines = src.slice(openEnd + 1, end).split('\n');
  const tail = src.slice(end);

  const out = [];
  let cur = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sel = line.match(/^\s*([^{]+)\{/);
    if (sel) cur = sel[1];

    const m = line.match(RE_NEW);
    if (m) {
      // 往上找兜底行取原始透明度
      let alpha = null;
      for (let k = out.length - 1; k >= 0 && k >= out.length - 3; k--) {
        const mm = out[k].match(RE_OLD);
        if (mm) { alpha = mm[1]; break; }
      }
      if (alpha === null) alpha = '0.72';
      const isSurface = SURFACE.some((re) => re.test(cur));
      const value = 'rgba(var(--surface-rgb, 255, 255, 255), ' + alpha + ')';
      out.push(m[1] + 'background: ' + value + m[3] + ';');
      out.push(m[1] + '-webkit-backdrop-filter: blur(' + (isSurface ? 12 : 8) + 'px) saturate(180%);');
      out.push(m[1] + 'backdrop-filter: blur(' + (isSurface ? 12 : 8) + 'px) saturate(180%);');
      bg++;
      blur++;
      continue;
    }

    out.push(line);
  }

  const next = head + out.join('\n') + tail;
  if (next !== src) {
    fs.writeFileSync(file, next);
    changed++;
  }
});

console.log('还原文件 ' + changed + ' 个；底色 ' + bg + ' 处；补回 backdrop-filter ' + blur + ' 处');
