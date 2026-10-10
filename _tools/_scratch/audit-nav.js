// 一次性审计：跳转目标是否注册、tabBar 页是否误用 navigateTo
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', 'uniapp');

const raw = fs.readFileSync(path.join(ROOT, 'pages.json'), 'utf8');
const pj = JSON.parse(raw.replace(/\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
const reg = new Set();
pj.pages.forEach(p => reg.add(p.path));
const tabs = new Set((pj.tabBar && pj.tabBar.list || []).map(x => x.pagePath));

const files = [];
(function walk(d) {
  fs.readdirSync(d).forEach(n => {
    const fp = path.join(d, n);
    if (fs.statSync(fp).isDirectory()) {
      if (['node_modules', 'unpackage', '.hbuilderx'].includes(n)) return;
      walk(fp);
    } else files.push(fp);
  });
})(ROOT);

const bad = [];
['pages', 'utils', 'components', 'services'].forEach(dir => {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) return;
  (function walk2(x) {
    fs.readdirSync(x).forEach(n => {
      const fp = path.join(x, n);
      if (fs.statSync(fp).isDirectory()) return walk2(fp);
      if (!/\.(vue|js|ts)$/.test(fp)) return;
      const s = fs.readFileSync(fp, 'utf8');
      const re = /(navigateTo|redirectTo|switchTab)\s*\(\s*\{[^}]*url:\s*['"](\/[^'"?]+)/g;
      let m;
      while ((m = re.exec(s))) {
        const p = m[2].replace(/^\//, '');
        const rel = path.relative(ROOT, fp).replace(/\\/g, '/');
        if (!reg.has(p)) bad.push('未注册页面 ' + p + '  <- ' + rel);
        if (m[1] === 'navigateTo' && tabs.has(p)) bad.push('navigateTo 跳 tabBar 页 ' + p + '  <- ' + rel);
      }
    });
  })(d);
});

console.log(bad.length ? bad.join('\n') : '跳转审计通过：目标均已注册，无 tabBar 误用');
console.log('tabBar:', [...tabs].join(', '));
console.log('已注册页面数:', reg.size);
