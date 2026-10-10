// _tools/check-graph.js - 模块导入一致性检查（只读）
// 扫描 uniapp 下所有 .js 与 .vue <script> 的 import，校验：
//  1) 相对路径目标文件存在（补 .js 后缀重试）
//  2) 具名导入在目标模块中确有对应导出（namespace import 跳过）
//  3) 检测 utils/services/data 之间的循环依赖
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../uniapp');
// 新增的领域层（TypeScript）：db / repositories / 部分 utils、services
const SCAN_DIRS = ['services', 'utils', 'data', 'db', 'repositories', 'pages', 'pkgStudy', 'pkgManage', 'components', 'App.vue', 'main.js'];

function listFiles(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) listFiles(p, out);
    else if (/\.(vue|js|ts)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [];
SCAN_DIRS.forEach(d => {
  const p = path.join(ROOT, d);
  if (fs.existsSync(p)) {
    if (fs.statSync(p).isDirectory()) listFiles(p, files);
    else files.push(p);
  }
});

// 解析目标模块导出的名字
const exportCache = new Map();
function exportsOf(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  exportCache.set(file, new Set(['<self>'])); // 防循环
  const src = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')  // 块注释
    .replace(/^\s*\/\/.*$/gm, '');      // 行注释
  const names = new Set();
  // export const/let/function/class X
  let m;
  // TS：interface / type 也算导出（页面只会 import type 它们，但列出来便于校验）
  const re1 = /export\s+(?:async\s+)?(?:const|let|var|function\*?|class|interface|type)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = re1.exec(src))) names.add(m[1]);
  // export { a, b as c }
  const re2 = /export\s+(?:type\s+)?\{([^}]*)\}/g;
  while ((m = re2.exec(src))) {
    m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(seg => {
      const parts = seg.split(/\s+as\s+/);
      names.add((parts[1] || parts[0]).trim());
    });
  }
  // export default
  if (/export\s+default/.test(src)) names.add('default');
  // export * from '...'（透传，标记为通配）
  if (/export\s*\*\s*from/.test(src)) names.add('*');
  exportCache.set(file, names);
  return names;
}

let fail = 0;
function bad(msg) { fail++; console.error('  ✗ ' + msg); }
function ok(msg) { console.log('  ✓ ' + msg); }

// 图（用于环检测）
const graph = new Map(); // file -> Set(.depFile)
const IMPORT_RE = /import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?(?:\*\s+as\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)|\{([^}]*)\})?\s*(?:from\s*)?['"]([^'"]+)['"]/g;

for (const f of files) {
  const rel = path.relative(ROOT, f);
  const src = fs.readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const deps = new Set();
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    const spec = m[5];
    if (!spec) continue;
    if (!spec.startsWith('.')) continue; // 仅查相对路径
    let target = path.resolve(path.dirname(f), spec);
    // 无后缀 → 依次补 .js / .ts；指向目录 → 找 index.js / index.ts
    if (!fs.existsSync(target)) {
      if (fs.existsSync(target + '.js')) target += '.js';
      else if (fs.existsSync(target + '.ts')) target += '.ts';
    }
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      const idx = ['index.js', 'index.ts'].map((n) => path.join(target, n)).find((p) => fs.existsSync(p));
      if (idx) target = idx;
    }
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) { bad(rel + ' → 找不到模块 ' + spec); continue; }
    deps.add(target);
    const named = m[4]; // { a, b }
    if (named) {
      const exports = exportsOf(target);
      named.split(',').map(s => s.trim()).filter(Boolean).forEach(seg => {
        const parts = seg.split(/\s+as\s+/);
        // TS 内联类型导入：`import { type Foo }` → 去掉 type 前缀再比对
        const name = parts[0].trim().replace(/^type\s+/, '');
        if (name === 'default') return;
        if (!exports.has(name) && !exports.has('*')) {
          bad(rel + " → '" + name + "' 不存在于 " + path.relative(ROOT, target) + ' 的导出中');
        }
      });
    }
  }
  graph.set(f, deps);
}

// 循环依赖检测（utils/services/data 内部）
const coreFiles = files.filter(f => /[/\\](services|utils|data|db|repositories)[/\\]/.test(f));
const state = new Map(); // 0=未访问 1=栈中 2=完成
let cycleFound = false;
function dfs(f, stack) {
  state.set(f, 1);
  stack.push(f);
  for (const d of (graph.get(f) || [])) {
    if (!coreFiles.includes(d)) continue;
    const s = state.get(d) || 0;
    if (s === 1) {
      cycleFound = true;
      const idx = stack.indexOf(d);
      console.error('  ✗ 循环依赖: ' + stack.slice(idx).concat([d]).map(x => path.relative(ROOT, x)).join(' → '));
    } else if (s === 0) {
      dfs(d, stack);
    }
  }
  stack.pop();
  state.set(f, 2);
}
for (const f of coreFiles) {
  if (!state.get(f)) dfs(f, []);
}

console.log('');
console.log('扫描文件数: ' + files.length);
if (!fail && !cycleFound) ok('所有相对导入均可解析，具名导入均存在，无循环依赖');
else console.error(fail ? '导入检查失败 ' + fail + ' 项' : '');
if (cycleFound && !fail) process.exitCode = 1;
else if (fail) process.exitCode = 1;
