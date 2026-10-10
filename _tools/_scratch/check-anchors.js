// 一次性：按 GitHub 的 slug 规则算真实锚点，核对 README 目录里的链接
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', '..', 'uniapp', 'README.md');
const src = fs.readFileSync(file, 'utf8');

// github-slugger：小写 → 去掉标点（保留字母/数字/空格/连字符/下划线）→ 空格转连字符
function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

const heads = (src.match(/^## .+$/gm) || []).map(h => h.replace(/^##\s+/, ''));
console.log('--- 实际锚点 ---');
heads.forEach(h => console.log(slug(h) + '   <=  ' + h));

console.log('\n--- 目录里的链接 ---');
const toc = src.match(/^- \[.+\]\(#.+\)$/gm) || [];
const used = toc.map(l => l.match(/\(#(.+)\)$/)[1]);
console.log(used.join('\n'));

console.log('\n--- 核对 ---');
const all = new Set(heads.map(slug));
let bad = 0;
used.forEach(u => {
  if (!all.has(u)) { bad++; console.log('✗ 目录链接无对应锚点: #' + u); }
});
console.log(bad === 0 ? '✓ 目录链接全部可跳转' : ('✗ ' + bad + ' 条链接对不上'));
