// check-subpackage.js - 分包配置完整性
// 防的是分包改造最经典的事故：跳了一个没注册的页面，线上点击没反应。

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');

let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
};

const pj = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'pages.json'), 'utf8')
    .replace(/\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1')
);

const mainPages = pj.pages.map(p => p.path);
const subPkgs = pj.subPackages || [];
const subPages = [];
subPkgs.forEach(sp => (sp.pages || []).forEach(p => subPages.push(sp.root + '/' + p.path)));
const all = mainPages.concat(subPages);

// ---------- 1. 启动页与 tabBar 必须在主包 ----------
console.log('== 1. 主包约束 ==');
ok(mainPages[0] === 'pages/cover/cover', '启动页 cover 在主包首位');
const tabs = ((pj.tabBar && pj.tabBar.list) || []).map(x => x.pagePath);
ok(tabs.length === 4, 'tabBar 4 项');
ok(tabs.every(t => mainPages.indexOf(t) >= 0), 'tabBar 页全部在主包（' + tabs.join(', ') + '）');
ok(tabs.every(t => subPages.indexOf(t) < 0), 'tabBar 页不在分包');

// ---------- 2. 声明的页面文件都存在 ----------
console.log('== 2. 页面文件存在 ==');
let missing = 0;
all.forEach(p => {
  const f = path.join(ROOT, p + '.vue');
  if (!fs.existsSync(f)) { missing++; console.log('    缺文件: ' + p); }
});
ok(missing === 0, all.length + ' 个页面全部有对应 .vue');

// ---------- 3. 分包 root 目录存在且无重复注册 ----------
console.log('== 3. 分包结构 ==');
subPkgs.forEach(sp => {
  ok(fs.existsSync(path.join(ROOT, sp.root)), '分包目录存在 ' + sp.root);
});
const dup = all.filter((p, i) => all.indexOf(p) !== i);
ok(dup.length === 0, '无重复注册' + (dup.length ? '：' + dup.join(', ') : ''));

// ---------- 4. 代码里的跳转目标全部已注册 ----------
console.log('== 4. 跳转目标注册 ==');
function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (d.name === 'unpackage' || d.name === 'node_modules') return;
      walk(p, out);
    } else if (/\.(vue|js|ts)$/.test(d.name) && !d.name.endsWith('.bak')) out.push(p);
  });
  return out;
}
const reg = new Set(all);
const bad = [];
walk(ROOT, []).forEach(f => {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const re = /['"](\/(?:pkgStudy\/|pkgManage\/)?pages\/[a-z0-9-]+\/[a-z0-9-]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const target = m[1].slice(1); // 去前导 '/'
    if (!reg.has(target)) bad.push(rel + ' → ' + m[1]);
  }
});
ok(bad.length === 0, '全部跳转目标已注册' + (bad.length ? '\n    ' + bad.slice(0, 5).join('\n    ') : ''));

// ---------- 5. 主包代码不引用分包页面文件 ----------
console.log('== 5. 主包不依赖分包 ==');
const crossRefs = [];
['pages', 'utils', 'services', 'components'].forEach(dir => {
  walk(path.join(ROOT, dir), []).forEach(f => {
    const src = fs.readFileSync(f, 'utf8');
    if (/\.\.\/\.\.\/(pkgStudy|pkgManage)\//.test(src) || /import\s.*from\s+['"][^'"]*(pkgStudy|pkgManage)\//.test(src)) {
      crossRefs.push(path.relative(ROOT, f).replace(/\\/g, '/'));
    }
  });
});
ok(crossRefs.length === 0, '主包模块不 import 分包文件' + (crossRefs.length ? '：' + crossRefs.join(', ') : ''));

// ---------- 6. preloadRule 引用的包存在 ----------
console.log('== 6. 预载规则 ==');
const pkgNames = new Set(subPkgs.map(sp => sp.name || sp.root));
const pre = pj.preloadRule || {};
let preBad = 0;
Object.keys(pre).forEach(page => {
  (pre[page].packages || []).forEach(name => {
    if (!pkgNames.has(name)) { preBad++; console.log('    预载了不存在的包: ' + name); }
  });
  if (!reg.has(page)) { preBad++; console.log('    预载规则挂在未注册页面: ' + page); }
});
ok(preBad === 0, 'preloadRule 引用的包与页面都有效');

console.log('');
console.log('== 汇总 ==');
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) { console.error('FAILED'); process.exit(1); }
console.log('OK');
