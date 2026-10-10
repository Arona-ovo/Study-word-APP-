// 一次性脚本：把"半透明磨砂玻璃"改成"独立于背景的悬浮窗体"
//   1) 窗体级面板（卡片 / 胶囊 / 顶栏 / 底栏 / 按钮 / 气泡 / 弹层）→ 不透明 --surface
//   2) 内嵌小控件（标签 / 输入框 / 分段 / 例句块）          → 浅灰 --fill
//   3) 删掉所有 backdrop-filter（页面背景模糊那一处除外），以及它带来的 @supports 兜底块
//
// 只处理 <style> 区块，不动 template / script。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
const TARGETS = ['App.vue', 'pages', 'components'];

// 这些选择器算"窗体"，用不透明表面；其余算内嵌控件，用浅灰
const SURFACE = [
  /\.card\b/, /\.glass\b/, /\.sec\b/, /\.ftb\b/, /\.fnb\b/,
  /\.btn-ghost\b/, /\.btn-mini\b/, /\.pop-card\b/, /\.loading-card\b/,
  /\.option\b/, /\.bubble\b/, /\.input-bar\b/, /\.replay-btn\b/,
  /\.pop-replay\b/, /\.empty\b/
];

const RE_BG = /^(\s*)background:\s*rgba\(var\(--surface-rgb,\s*255,\s*255,\s*255\),\s*[0-9.]+\)(.*);\s*$/;

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
let bgCount = 0;
let blurCount = 0;
let supportsRemoved = 0;

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

  const lines = body.split('\n');
  const out = [];
  let cur = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 记录当前选择器（简单跟踪：含 { 且不含 } 的行）
    const sel = line.match(/^\s*([^{]+)\{/);
    if (sel) cur = sel[1];

    // 1) 删掉 backdrop-filter 兜底块（整块 @supports not (...)）
    if (/^\s*@supports\s+not\s+\(\(?(-webkit-)?backdrop-filter/.test(line)) {
      let depth = 0;
      let j = i;
      for (; j < lines.length; j++) {
        depth += (lines[j].match(/\{/g) || []).length;
        depth -= (lines[j].match(/\}/g) || []).length;
        if (depth <= 0 && j > i) break;
      }
      i = j;
      supportsRemoved++;
      continue;
    }

    // 2) 删掉 backdrop-filter（保留 page::before 上的背景模糊 --app-bg-blur）
    if (/^\s*-?(webkit-)?backdrop-filter\s*:/.test(line)) {
      if (line.indexOf('--app-bg-blur') >= 0) { out.push(line); continue; }
      blurCount++;
      continue;
    }

    // 3) 半透明面板底色 → 不透明表面 / 浅灰填充
    const m = line.match(RE_BG);
    if (m) {
      const isSurface = SURFACE.some((re) => re.test(cur));
      const value = isSurface ? 'var(--surface, #ffffff)' : 'var(--fill, #f2f4f2)';
      out.push(m[1] + 'background: ' + value + m[2] + ';');
      bgCount++;
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

console.log('改写文件 ' + changed + ' 个；底色 ' + bgCount + ' 处；移除 backdrop-filter ' + blurCount + ' 行；移除 @supports 兜底块 ' + supportsRemoved + ' 个');
