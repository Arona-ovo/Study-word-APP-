// _tools/check-dialog.js - 「全 App 弹窗统一」校验（只读）
//
// 背景：App 里一度并存两套弹窗 —— 系统原生（uni.showModal / showActionSheet）与
// 各页面自绘的玻璃卡片，宽高圆角各不相同，且系统弹窗在 App 端 CSS 完全管不到。
// 统一收敛为 components/app-dialog/app-dialog.vue 之后，本脚本守住三条底线：
//   1) 页面不再直接调用系统弹窗
//   2) 弹窗视觉只在 App.vue 全局样式里定义一份（页面不许再各抄一份）
//   3) 组件自身三种模式（确认 / 菜单 / 输入）契约完整
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
// 主包 + 两个分包的页面目录（页面物理位置随 pages.json 的 subPackages）
const PAGES_DIRS = ['pages', 'pkgStudy/pages', 'pkgManage/pages'].map(d => path.join(ROOT, d));
const PAGES = PAGES_DIRS[0]; // 兼容下方少量单文件拼接（book-switch 在 pkgManage）
function walkPages(ext) {
  const out = [];
  PAGES_DIRS.forEach(d => { if (fs.existsSync(d)) walk(d, ext).forEach(f => out.push(f)); });
  return out;
}
const DIALOG = path.join(ROOT, 'components', 'app-dialog', 'app-dialog.vue');
const APPVUE = path.join(ROOT, 'App.vue');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
const eq = (a, b, label) => {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
};

const read = (p) => fs.readFileSync(p, 'utf8');
const walk = (dir, ext) => {
  const out = [];
  fs.readdirSync(dir).forEach((n) => {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (n.endsWith(ext)) out.push(p);
  });
  return out;
};

console.log('== 1. 统一弹窗组件存在 ==');
assert(fs.existsSync(DIALOG), 'components/app-dialog/app-dialog.vue 存在');
const dlg = read(DIALOG);

console.log('== 2. 三种模式齐备 ==');
assert(/mode:\s*\{[^}]*default:\s*'confirm'/.test(dlg), '默认模式 = confirm');
["mode === 'input'", "mode === 'sheet'"].forEach((s) =>
  assert(dlg.indexOf(s) >= 0, '模板按 mode 分支渲染：' + s));
assert(/props:\s*\{[\s\S]*items:/.test(dlg), 'sheet 模式需要 items 属性');
assert(/props:\s*\{[\s\S]*value:/.test(dlg) && /props:\s*\{[\s\S]*placeholder:/.test(dlg),
  'input 模式需要 value / placeholder 属性');

console.log('== 3. 事件契约 ==');
assert(/this\.\$emit\('confirm'/.test(dlg), 'emit confirm');
assert(/this\.\$emit\('cancel'/.test(dlg), 'emit cancel');
assert(/this\.\$emit\('input'/.test(dlg), 'emit input');
// 载荷随 mode 变化：sheet → 下标，input → 文本，confirm → true
assert(/mode === 'input' \? String\(this\.draft/.test(dlg), 'input 模式回传文本');
// 非多选菜单：点按即回传下标；多选菜单（multi）：点按只切换勾选，确认时回传下标数组
assert(/pick\(i\)[\s\S]{0,400}emit\('confirm', i\)/.test(dlg), 'sheet 模式回传下标');
assert(/multi:\s*\{\s*type:\s*Boolean/.test(dlg), '有 multi 属性（多选菜单形态）');
assert(/syncPicked/.test(dlg) && /checked/.test(dlg), '弹开时按 items[].checked 重置勾选态');
assert(/emit\('confirm', sel\)/.test(dlg), 'multi 确认回传选中下标数组');
assert(/mode === 'sheet' && !this\.multi/.test(dlg), '单选菜单仍保留"点按即回传"行为（multi 不劫持老用法）');

console.log('== 4. 弹出时同步输入框 ==');
// 组件用 v-if 挂载：从「菜单」直接切「输入框」不会重新挂载，
// 光靠 show 的 watch 同步不到 —— 必须有 seq 兜底
assert(/seq:\s*\{[^}]*Number/.test(dlg), '有 seq 数字属性');
assert(/watch:\s*\{[\s\S]*seq\(\)/.test(dlg), 'watch seq 时同步 draft');

console.log('== 5. 样式唯一来源：App.vue 全局 ==');
const app = read(APPVUE);
['.pop-mask', '.pop-card', '.dlg-title', '.dlg-input', '.dlg-err', '.dlg-btns', '.dlg-btn']
  .forEach((c) => assert(new RegExp('\\' + c + ' \\{').test(app), 'App.vue 定义 ' + c));
assert(/@supports not[\s\S]{0,200}\.pop-card/.test(app), 'pop-card 有 backdrop-filter 回退');

console.log('== 6. 页面不再各抄一份弹窗样式 ==');
walkPages('.vue').forEach((f) => {
  const s = read(f);
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  eq(/\n\.pop-mask \{/.test(s), false, rel + ' 未重复定义 .pop-mask');
  eq(/\n\.pop-card \{/.test(s), false, rel + ' 未重复定义 .pop-card');
  eq(/\n\.dlg-btn \{/.test(s), false, rel + ' 未重复定义 .dlg-btn');
});

console.log('== 7. 页面不再调用系统弹窗 ==');
walkPages('.vue').forEach((f) => {
  const s = read(f);
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  eq(/uni\.showModal|uni\.showActionSheet/.test(s), false, rel + ' 未调用系统弹窗');
});

console.log('== 8. 危险操作用统一 danger 样式 ==');
assert(/\.dlg-btn\.danger/.test(app), 'App.vue 定义 .dlg-btn.danger');
assert(/background:\s*#e5484d/.test(app), '危险色沿用 #e5484d');

console.log('== 9. 页面弹窗派发（真实执行 book-switch 脚本） ==');
const { loadCode } = require('./lib/load');
const bsRaw = read(path.join(ROOT, 'pkgManage', 'pages', 'book-switch', 'book-switch.vue'));
const bsScript = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(bsRaw) || [])[1] || '';

const calls = [];
const toasts = [];
const sheets = [];
const stub = {
  listBooks: () => [
    { id: 'core', name: '核心词书', desc: '', current: true, batchCount: 32, userBook: false },
    { id: 'ub-1', name: '我的词书', desc: '', current: false, batchCount: 0, userBook: true }
  ],
  bookVocab: (id) => ({
    list: id === 'core' ? new Array(640).fill(0).map((_, i) => ({ seen: i < 10 ? 1 : 0, mastery: 0 })) : [],
    total: id === 'core' ? 640 : 0,
    counts: { new: 0, learning: 0, familiar: 0, mastered: 0 }
  }),
  bookMode: (id) => (id === 'core' ? 'batch' : 'custom'),
  currentBookId: () => 'core',
  switchBook: (id) => { calls.push('switch:' + id); return true },
  createUserBook: (n) => { calls.push('create:' + n); return 'ub-new' },
  renameUserBook: (id, n) => { calls.push('rename:' + id + ':' + n); return true },
  deleteUserBook: (id) => { calls.push('delete:' + id); return true },
  isNameTaken: (n) => n === '核心词书'
};

global.uni = Object.assign({}, global.uni, {
  showToast: (o) => toasts.push(String((o && o.title) || '')),
  showModal: () => { calls.push('sys-modal') },
  showActionSheet: (o) => { sheets.push(o); if (o && o.success) o.success({ tapIndex: 1 }) },
  navigateBack: () => calls.push('back')
});

// 组件 import 会被 load.js 剥掉，这里补两个占位（页面只用到注册，不实例化）
const comp = loadCode(bsScript, {
  wordbook: stub,
  FloatNavbar: { name: 'FloatNavbar' },
  AppDialog: { name: 'AppDialog' },
  // 脚本里的 t()（i18n，见 utils/i18n.js）：中文态桩 = 原文 + 填占位符。
  // 必须真的填 {name} / {n}：整句带占位符的写法要拼出来的文案里能看到词书名，
  // 光返回原文的话 "将删除「{name}」…" 里就没有书名，断言会假失败。
  t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m))
}, 'book-switch.vue').default;
const vm = Object.assign({}, comp.data ? comp.data() : {}, comp.methods || {});
// 让 refresh() 里的 this.xxx = ... 生效：把返回值挂回
vm.refresh = function () { const d = comp.methods.refresh.call(vm); Object.assign(vm, { books: d }) }

assert(typeof comp.methods.openDlg === 'function', 'openDlg 存在');
assert(typeof comp.methods.closeDlg === 'function', 'closeDlg 存在');
assert(typeof comp.methods.onDlgConfirm === 'function', 'onDlgConfirm 存在');

// 长按内置词书：给出提示而不是静默
toasts.length = 0; calls.length = 0; sheets.length = 0;
comp.methods.askDelete.call(vm, { id: 'core', name: '核心词书', userBook: false, current: true });
assert(toasts.length === 1, '长按内置词书 → 弹出提示（实际 ' + toasts.length + ' 条）');
eq(vm.dlg.show, false, '长按内置词书 → 不弹确认框');

// 长按自建词书：弹操作菜单
comp.methods.askDelete.call(vm, { id: 'ub-1', name: '我的词书', userBook: true, current: false, wordCount: 3 });
eq(vm.dlg.mode, 'sheet', '长按自建词书 → sheet 模式');
eq(vm.dlg.items.length, 2, '菜单 2 项（重命名 / 删除）');
eq(vm.dlg.items[1].danger, true, '「删除词书」标为危险项');

// 菜单 → 删除 → 确认框
comp.methods.onDlgConfirm.call(vm, 1);
eq(vm.dlg.mode, 'confirm', '选「删除词书」→ confirm 模式');
eq(vm.dlg.danger, true, '删除确认框用 danger 样式');
assert(/我的词书/.test(vm.dlg.content), '确认文案带上词书名');
assert(/自动切换/.test(vm.dlg.content) === false, '非当前词书 → 不提自动切换');

// 确认 → 真正删除
comp.methods.onDlgConfirm.call(vm, true);
assert(calls.indexOf('delete:ub-1') >= 0, '确认后调用 deleteUserBook');
eq(vm.dlg.show, false, '删除后弹窗关闭');

// 当前词书删除提示要说明自动切到哪本（重新走一次「长按 → 菜单 → 删除」）
calls.length = 0;
const currentBook = { id: 'ub-1', name: '我的词书', userBook: true, current: true, wordCount: 3 };
comp.methods.askDelete.call(vm, currentBook);
comp.methods.onDlgConfirm.call(vm, 1);
assert(/自动切换到/.test(vm.dlg.content), '当前词书 → 提示会自动切换到「核心词书」');
assert(vm.dlg.action === 'delete', '删除确认框 action = delete（实际 ' + vm.dlg.action + '）');

// 菜单 → 重命名 → 输入框（重新长按一次）
calls.length = 0;
comp.methods.askDelete.call(vm, currentBook);
comp.methods.onDlgConfirm.call(vm, 0);
eq(vm.dlg.mode, 'input', '选「重命名」→ input 模式');
eq(vm.dlg.value, '我的词书', '输入框带出旧名字');
assert(vm.dlg.seq > 0, 'seq 递增（保证组件同步 draft）');

// 重命名重名 → 报错且不落库
comp.methods.onDlgConfirm.call(vm, '核心词书');
assert(!!vm.dlg.error, '重名 → 弹窗内报错');
eq(calls.length, 0, '重名 → 不调用 renameUserBook');

// 换成合法名字 → 落库
comp.methods.onDlgConfirm.call(vm, '新名字');
assert(calls.indexOf('rename:ub-1:新名字') >= 0, '合法名字 → 调用 renameUserBook');
eq(vm.dlg.show, false, '重命名成功后关闭弹窗');

console.log('');
console.log(fail === 0 ? '统一弹窗校验全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);
