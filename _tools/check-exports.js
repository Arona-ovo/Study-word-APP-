// _tools/check-exports.js - 跨模块「具名导入」必须真实存在
//
// 回归点：pkgStudy/pages/review-list 曾写成取 engine.isEnglish（命名空间成员），
// 而 utils/engine.js 压根没导出它。H5 端只是拿到 undefined、勉强能跑，
// **App 端却会整个白屏**（createInstanceContext failed），表现是"底部导航不见了"。
// 打包器只是 warn，不会阻断编译，所以必须在这里显式挡住。
//
// 本脚本扫描所有源码的 import { ... } from '...'，逐个核对目标模块是否真的导出了这个名字。
// import * as ns / import ns from 不检查成员（命名空间成员访问由打包器负责）。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'uniapp');
const SKIP = new Set(['node_modules', 'unpackage', 'dist', '.git', '.hbuilderx']);

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }

// ---------- 收集源码文件 ----------
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

// 注释里常常写着用法示例（// import { repos } from '@/repositories'），
// 不剥掉就会被当成真实 import 而误报。保留 http:// 这类前缀，避免误伤 URL。
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const files = walk(ROOT, []);

// ---------- 取 .vue 里的 script 块（其余部分可能含 {{ }} 干扰正则） ----------
function scriptOf(file, raw) {
  const isVue = file.endsWith('.vue');
  if (!isVue) return stripComments(raw);
  const m = raw.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
  return stripComments(m ? m[1] : '');
}

// ---------- 提取某文件对外导出的名字 ----------
const exportCache = new Map();
function exportsOf(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  const set = new Set();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const src = scriptOf(file, raw);
    // export function/const/let/interface/type/... 的名字
    const reDecl = /^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
    let m;
    while ((m = reDecl.exec(src))) set.add(m[1]);
    // export { a, b as c } —— 对外名取 as 之后的那一个
    const reBlock = /export\s*\{([\s\S]*?)\}/g;
    while ((m = reBlock.exec(src))) {
      m[1].split(',').forEach(part => {
        const s = part.trim();
        if (!s) return;
        const seg = s.split(/\s+as\s+/);
        const name = (seg[1] || seg[0]).trim();
        // 跳过 export { x } from '...' 的纯粹转发（这类由打包器导入链负责）
        set.add(name);
      });
    }
    // 单个声明多行 export { a,\n b }：正则已支持跨行（[\s\S]）
  } catch (e) { /* 读不到就当没有导出 */ }
  exportCache.set(file, set);
  return set;
}

// ---------- 解析模块路径 ----------
function resolveTarget(fromFile, spec) {
  if (spec.startsWith('@/')) {
    spec = path.join(ROOT, spec.slice(2));
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    spec = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null; // 裸包名（npm 依赖），不归本脚本管
  }
  const cands = [
    spec, spec + '.js', spec + '.ts', spec + '.vue',
    path.join(spec, 'index.js'), path.join(spec, 'index.ts')
  ];
  for (const c of cands) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

// ---------- 扫描 ----------
console.log('== 1. 具名导入是否真实导出 ==');
let checked = 0;
const missing = [];
const unresolved = [];

files.forEach(file => {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return; }
  const src = scriptOf(file, raw);
  // import { a, b as c } from '...'（也兼容一行多个 import）
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean)
      // TS 的 import { type Foo } 要剥掉 type 前缀，否则会被当成名字叫 "type Foo"
      .map(s => s.replace(/^type\s+/, '').trim())
      .filter(Boolean)
      .map(s => s.split(/\s+as\s+/)[0].trim());   // 引入侧用原名
    const specRaw = m[2];
    const isBare = !/^[.@]/.test(specRaw);
    const target = resolveTarget(file, specRaw);
    if (!target) {
      // 裸包名（vue / hash-wasm 等 npm 依赖）不归本脚本管，只对相对/别名路径报错
      if (!isBare) unresolved.push(path.relative(ROOT, file) + ' → ' + specRaw);
      continue;
    }
    const available = exportsOf(target);
    names.forEach(n => {
      checked++;
      // .vue 默认导出（components）若被具名解构，另行放宽：具名必须是 script 里 export 的
      if (!available.has(n)) {
        missing.push(path.relative(ROOT, file) + ' → ' + n + ' （from ' + m[2] + '）');
      }
    });
  }
});

console.log('  共核对 ' + checked + ' 处具名导入，涉及 ' + files.length + ' 个源文件');
if (missing.length === 0) ok('没有指向不存在导出的具名导入');
else missing.forEach(x => bad('目标模块没有导出这个名字：' + x));

console.log('== 2. 相对路径能否解析到真实文件 ==');
if (unresolved.length === 0) ok('所有相对路径都能解析到文件');
else [...new Set(unresolved)].forEach(x => bad('路径解析不到：' + x));

console.log('== 3. engine.js 不要转发外部依赖（避免踩 load.js 剥 import 的坑）==');
const engineSrc = fs.readFileSync(path.join(ROOT, 'utils', 'engine.js'), 'utf8');
if (!/\bfrom\s+'\.\/tokenize\.js'/.test(engineSrc)) {
  ok('engine.js 未引入 tokenize（转发导出会让十几个校验脚本 ReferenceError）');
} else bad('engine.js 引入了 tokenize —— 所有加载 engine 的校验脚本都会挂');

console.log('');
console.log(fail === 0 ? '模块导出一致性全部通过' : '失败 ' + fail + ' 项');
process.exitCode = fail ? 1 : 0;
