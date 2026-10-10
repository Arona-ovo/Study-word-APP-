// _tools/check-app-compat.js - App 端 JS 引擎兼容性（防白屏）
//
// 回归点：home.vue 模块顶层写过
//     const WORDISH = /^[\p{L}\p{N}]...$/u
// App 端的 app-service.js **不是**跑在系统 WebView 里，而是跑在 uni-app 自带的 JS 引擎。
// 老一点的引擎不认 Unicode 属性转义（\p{...}），于是**模块解析阶段**就 SyntaxError：
// 整个页面模块没执行完 → 页面实例建不起来 →
//     reportJSException: white screen cause createInstanceContext failed
// 现象是「安卓基座白屏、内置浏览器(H5)一切正常」—— 内置浏览器是新版 Chrome，认 \p{}。
// 打包器不会报错，编译照样「成功」，只有跑起来才炸，所以必须有专门的检查。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'uniapp');
const SKIP = new Set(['node_modules', 'unpackage', 'dist', '.git', '.hbuilderx']);

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }

function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  entries.forEach(en => {
    if (SKIP.has(en.name)) return;
    const p = path.join(dir, en.name);
    if (en.isDirectory()) walk(p, out);
    else if (/\.(js|ts|vue)$/.test(en.name)) out.push(p);
  });
  return out;
}

const files = walk(ROOT, []);
console.log('== 1. 扫描 ' + files.length + ' 个源文件里的 App 端高危语法 ==');

// 高危项：[名称, 正则, 说明]
const RULES = [
  {
    name: 'Unicode 属性转义 \\p{...}',
    re: /\\p\{[A-Za-z]/,
    tip: '老引擎不认，会在模块顶层直接 SyntaxError → 白屏。改用显式 \\uXXXX 码点区间'
  },
  {
    name: '正则的后行断言 (?<= / (?<!',
    re: /\(\?<[=!]/,
    tip: 'Safari 与部分 App 端引擎长期不支持，同样导致解析失败'
  },
  {
    name: '具名捕获组 (?<name>',
    re: /\(\?<[A-Za-z_$][\w$]*>/,
    tip: '与后行断言同源的老引擎兼容问题'
  }
];

// 注释里往往会写明"别再写回 \\p{...}"这类警示语，不剥掉就会自己告自己。
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

RULES.forEach(rule => {
  const hits = [];
  files.forEach(f => {
    let src;
    try { src = fs.readFileSync(f, 'utf8'); } catch (e) { return; }
    stripComments(src).split('\n').forEach((line, i) => {
      if (rule.re.test(line)) {
        hits.push(path.relative(ROOT, f) + ':' + (i + 1) + '  ' + line.trim().slice(0, 90));
      }
    });
  });
  if (hits.length === 0) ok('没有 ' + rule.name);
  else {
    hits.forEach(h => bad(rule.name + ' → ' + h));
    console.error('       修法：' + rule.tip);
  }
});

console.log('== 2. 编译产物交叉验证（若已编译则顺带查一遍）==');
// 产物是 uni-app 处理之后真正跑到手机上的 JS，扫它能捞到"源码看着没事、编译后出事"的情况
const ART = path.join(ROOT, 'unpackage', 'dist', 'dev', 'app-plus', 'app-service.js');
if (fs.existsSync(ART)) {
  const src = fs.readFileSync(ART, 'utf8');
  if (/\\p\{[A-Za-z]/.test(src)) bad('编译产物里仍存在 \\p{...} —— 手机上必白屏，先改源码再重编');
  else ok('编译产物里没有 \\p{...}');
  if (/#ifdef|#endif/.test(src)) bad('编译产物里残留条件编译注释 —— 平台条件没处理干净');
  else ok('编译产物里条件编译已全部展开');
} else {
  console.log('  （尚未编译 App 端产物，跳过）');
}

console.log('');
console.log(fail === 0 ? 'App 端兼容性全部通过' : '失败 ' + fail + ' 项');
process.exitCode = fail ? 1 : 0;
