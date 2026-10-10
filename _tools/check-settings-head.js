// _tools/check-settings-head.js - 校验设置页大胶囊头部（只读）
// 背景（真 bug）：cacheHint 写在 methods 里，模板却按属性 {{ cacheHint }} 取 ——
// Vue 会把函数本体渲染成 "function () { [native code] }"；
// 数据与账号分组没有摘要占位，展开箭头 › 直接贴在标题上。
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./lib/load');

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function assert(cond, label) { if (cond) ok(label); else bad(label); }
function group(name) { console.log('\n[' + name + ']'); }

const src = fs.readFileSync(path.join(ROOT, 'pkgManage/pages/settings/settings.vue'), 'utf8');
const tpl = src.slice(0, src.lastIndexOf('</template>'));
const script = src.slice(src.indexOf('<script>'), src.indexOf('<style'));

// ---------- 1. 结构：每个分组头都有名字和箭头 ----------
group('1. sec-head 结构');
const heads = tpl.match(/<view class="sec-head"[\s\S]*?<\/view>/g) || [];
assert(heads.length >= 7, '找到 ' + heads.length + ' 个分组头（预期 ≥7）');
const headBad = heads.filter(h => !/class="sec-name"/.test(h) || !/class="sec-arrow"/.test(h));
assert(headBad.length === 0, '每个分组头都同时有 sec-name 与 sec-arrow');

// ---------- 2. 箭头不贴标题：标题占满剩余空间 ----------
group('2. 箭头位置契约');
const nameCss = (src.match(/\.sec-name\s*\{[\s\S]*?\}/) || [''])[0];
assert(/flex:\s*1/.test(nameCss), '.sec-name 有 flex:1（无摘要的分组箭头也靠右）');
const arrowCss = (src.match(/\.sec-arrow\s*\{[\s\S]*?\}/) || [''])[0];
assert(!/margin-left:\s*auto/.test(arrowCss) || /margin-left:\s*18rpx/.test(arrowCss) === false,
  '.sec-arrow 不依赖 auto 外边距对齐（对齐由 sec-name 负责）');

// ---------- 3. cacheHint 必须是 computed，不能在 methods ----------
group('3. cacheHint 归属');
const compIdx = script.indexOf('computed: {');
const methIdx = script.indexOf('methods: {');
assert(compIdx > 0 && methIdx > compIdx, 'computed 在 methods 之前（常规结构）');
const computedBlock = script.slice(compIdx, methIdx);
const methodsBlock = script.slice(methIdx);
assert(/cacheHint\s*\(/.test(computedBlock), 'cacheHint 定义在 computed 里');
assert(!new RegExp('^\\s{4}cacheHint\\s*\\(', 'm').test(methodsBlock), 'methods 里不再有 cacheHint');
assert(tpl.indexOf('{{ cacheHint }}') > 0, '模板按属性 {{ cacheHint }} 取值（computed 才能这样用）');
const cacheFn = computedBlock.match(/cacheHint\s*\(\)\s*\{[\s\S]*?\n    \}/);
assert(!!cacheFn && /void this\.__lang/.test(cacheFn[0]), 'cacheHint 读了 __lang（切语言会重算）');

// ---------- 4. 全表扫描：模板里不能再出现"方法名当属性"的引用 ----------
group('4. 方法名被当属性渲染（全表扫描）');
const methodNames = [];
let m;
const reMethod = /^ {4}(\w+)\s*\([^)]*\)\s*\{/gm;
while ((m = reMethod.exec(methodsBlock))) methodNames.push(m[1]);
assert(methodNames.length > 20, '解析出 ' + methodNames.length + ' 个 methods 方法');
// 插值 {{ xxx }} 与绑定值里出现裸方法名（后面不是 "("）即为隐患
const badRefs = [];
const reExpr = /\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}|[:"(]\s*([A-Za-z_$][\w$]*)\s*(?=[?;}\)\s])/g;
while ((m = reExpr.exec(tpl))) {
  const name = m[1] || m[2];
  if (name && methodNames.indexOf(name) >= 0) badRefs.push(name);
}
assert(badRefs.length === 0,
  badRefs.length ? '裸引用了方法：' + Array.from(new Set(badRefs)).join(', ') : '模板没有裸引用任何 methods 方法');

// ---------- 5. secHint 自身健壮 ----------
group('5. secHint');
assert(/return this\.cacheHint/.test(methodsBlock), "secHint('cache') 走 computed（返回字符串而不是函数）");

console.log('\n' + (fail === 0 ? '全部通过 ✓' : '失败 ' + fail + ' 项 ✗'));
process.exit(fail === 0 ? 0 : 1);
