// _tools/check-syntax.js - 只读语法检查：把 ESM 的 .js / .vue 的 <script> 当模块解析一遍
// 用法：node _tools/check-syntax.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'uniapp');
const TMP = path.join(__dirname, '.tmp');

function walk(dir, out) {
  fs.readdirSync(dir).forEach(name => {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'unpackage' || name === '.hbuilderx') return;
      walk(p, out);
    } else {
      out.push(p);
    }
  });
  return out;
}

// Windows 上 fs.rmSync 递归删目录偶发 EBUSY / EPERM（上一个 node 进程还没释放句柄、
// 或索引器短暂占用）。全量回归时这会表现为一次假红，掩盖真实回归 —— 所以重试几次。
function rmrf(d) {
  if (!fs.existsSync(d)) return;
  let last = null;
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 80 });
      return;
    } catch (e) {
      last = e;
      const until = Date.now() + 120;
      while (Date.now() < until) { /* 退避：等句柄释放 */ }
    }
  }
  console.error('  清理临时目录失败，继续（可能残留旧文件）：' + (last && last.message));
}

rmrf(TMP);
fs.mkdirSync(TMP, { recursive: true });

const files = walk(APP, []);
let fail = 0;
let ok = 0;
const targets = [];

files.forEach(f => {
  const rel = path.relative(APP, f);
  let code = null;
  let ts = false;
  if (f.endsWith('.js')) {
    code = fs.readFileSync(f, 'utf8');
  } else if (f.endsWith('.vue')) {
    const src = fs.readFileSync(f, 'utf8');
    const m = /<script([^>]*)>([\s\S]*?)<\/script>/.exec(src);
    if (!m) return;
    code = m[2];
    // <script lang="ts"> 的块要按 TypeScript 解析，否则类型标注会被当成语法错误
    if (/lang\s*=\s*["']ts["']/.test(m[1] || '')) ts = true;
  } else {
    return;
  }
  const target = path.join(TMP, rel.replace(/[\\/]/g, '_').replace(/\.(js|vue)$/, ts ? '.mts' : '.mjs'));
  fs.writeFileSync(target, code, 'utf8');
  targets.push({ file: target, rel: rel, ts: ts });
  ok++;
});

// 真的解析一遍。
// 以前这一步只生成临时文件、交给外部 bash 跑 node --check —— 结果回归循环里
// "check-syntax 通过"其实什么都没验。settings.vue 曾带着一个多余的 `if (...) {`
// （花括号不平衡）一路绿灯到 HBuilderX 才炸。现在自己跑、自己返回失败码。
// Windows 上创建子进程偶发 EBUSY / EAGAIN / EMFILE（杀软扫描、句柄未释放、进程数打满），
// 一次跑 80 多个文件时尤其容易撞上，表现为整轮"语法错误"——那是假红，不是真错。
// 只在这种情况退避重试；真正的语法错误立刻返回，不做任何掩盖。
// ---------- 批量解析 ----------
// 逐个文件 `node --check` 在这个项目上试过：84 次 spawn，Windows 上一抖就整轮 EBUSY，
// 表现为"语法错误 84 处"——全是假红，反而把真实回归盖住。
// 现在只 spawn 一次工人，在带 --experimental-vm-modules 的进程里用
// vm.SourceTextModule 把全部文件解析完（构造即解析，不执行）。
const WORKER = path.join(__dirname, '_syntax-worker.js');
const LIST = path.join(TMP, '_list.json');
fs.writeFileSync(LIST, JSON.stringify(targets.map(t => ({ file: t.file, ts: t.ts }))), 'utf8');

let results = null;
for (let i = 0; i < 3; i++) {
  try {
    const out = execFileSync(process.execPath, [
      '--experimental-vm-modules', '--experimental-strip-types', WORKER, LIST
    ], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
    results = JSON.parse(String(out).trim());
    break;
  } catch (e) {
    const until = Date.now() + 400 * (i + 1);
    while (Date.now() < until) { /* 退避后重试 */ }
  }
}

if (!results) {
  // 工人起不来（极端环境）：退回逐个 spawn，慢但不至于整轮假绿
  console.error('  ⚠ 批量解析工人启动失败，退回逐个 spawn（慢一些）');
  results = targets.map(t => {
    const args = t.ts
      ? ['--experimental-strip-types', '--check', t.file]
      : ['--check', t.file];
    let err = null;
    try {
      execFileSync(process.execPath, args, { stdio: 'pipe' });
    } catch (e) {
      err = String((e.stderr && e.stderr.toString()) || e.message || '');
    }
    return { file: t.file, err: err };
  });
}

const byFile = {};
results.forEach(r => { byFile[r.file] = r.err; });

targets.forEach(t => {
  const err = byFile[t.file];
  if (!err) return;
  fail++;
  console.error('  ✗ ' + t.rel);
  console.error(err.split('\n').filter(Boolean).slice(0, 6).map(s => '      ' + s).join('\n'));
});

// ---------- 模板里的 JS 表达式 ----------
// <script> 能解析 ≠ 页面能编译：{{ }} 插值与绑定属性同样是 JS 表达式。
// pages/donate/donate.vue 曾经写了一个跨行的字符串字面量（$t('…\n…')）——
// JS 里这是"未终止的字符串"，整页编译不过，跳过去就是"打不开"；
// 而只查 <script> 的旧版检查完全看不见它（和上次 settings.vue 那个多余花括号同一个洞）。
let tfail = 0;
let tok = 0;

function parseExpr(expr) {
  try {
    // 只解析不执行：new Function 会走一遍真正的解析器
    new Function('return (' + expr + ')');
    return null;
  } catch (e) {
    return String((e && e.message) || e);
  }
}

files.filter(f => f.endsWith('.vue')).forEach(f => {
  const src = fs.readFileSync(f, 'utf8');
  const si = src.indexOf('<script');
  const tpl = src.slice(0, si < 0 ? src.length : si);
  const rel = path.relative(APP, f);
  const lineOf = (idx) => tpl.slice(0, idx).split('\n').length;
  const report = (line, what, why) => {
    tfail++;
    console.error('  ✗ ' + rel + ':' + line + '  ' + what.slice(0, 70).replace(/\n/g, '⏎'));
    console.error('      ' + why);
  };
  let m;
  // 插值：可以跨行，所以正则要带 s（用 [\s\S] 代替）
  const reMust = /\{\{([\s\S]*?)\}\}/g;
  while ((m = reMust.exec(tpl))) {
    const expr = m[1].trim();
    if (!expr) continue;
    tok++;
    const why = parseExpr(expr);
    if (why) report(lineOf(m.index), '{{ ' + expr + ' }}', why);
  }
  // 绑定属性与事件（v-for="a in b" 不是独立表达式，跳过）
  const reAttr = /\s(:|@|v-)([A-Za-z0-9_.:-]+)\s*=\s*"([^"]*)"/g;
  while ((m = reAttr.exec(tpl))) {
    if (/^v-for/.test(m[1] + m[2])) continue;
    const expr = m[3].trim();
    if (!expr) continue;
    tok++;
    const why = parseExpr(expr);
    if (why) report(lineOf(m.index), (m[1] + m[2]) + '="' + expr + '"', why);
  }
});

const total = fail + tfail;
console.log('已解析 ' + ok + ' 个脚本 + ' + tok + ' 个模板表达式（临时文件 → ' + TMP + '）');
console.log(total === 0 ? '语法检查全部通过 ✓' : '语法错误 ' + total + ' 处 ✗');
process.exit(total === 0 ? 0 : 1);
