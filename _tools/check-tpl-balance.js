// 校验 .vue 模板里 view / block / template 标签是否配平（忽略自闭合与非容器标签）
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'uniapp', 'pkgManage', 'pages', 'settings', 'settings.vue');
const src = fs.readFileSync(FILE, 'utf8');
// 页面里可能还有 <template v-if> 片段，所以外层结束标签要取最后一个 </template>
const tpl = src.slice(src.indexOf('<template>') + 10, src.lastIndexOf('</template>'));
const lines = tpl.split('\n');

// 把多行标签折叠成一行，避免换行导致漏计
const flat = lines.map((l) => l.replace(/\s+/g, ' ').trim()).join(' ');
const openView = (flat.match(/<view(?=[\s>/])/g) || []).length;
const closeView = (flat.match(/<\/view\s*>/g) || []).length;
const openBlock = (flat.match(/<block(?=[\s>/])/g) || []).length;
const closeBlock = (flat.match(/<\/block\s*>/g) || []).length;
const openTpl = (flat.match(/<template(?=[\s>/])/g) || []).length;
const closeTpl = (flat.match(/<\/template\s*>/g) || []).length;

console.log('文件：' + FILE);
console.log('  view    开 ' + openView + ' / 闭 ' + closeView + (openView === closeView ? '  ✓' : '  ✗ 差 ' + (openView - closeView)));
console.log('  block   开 ' + openBlock + ' / 闭 ' + closeBlock + (openBlock === closeBlock ? '  ✓' : '  ✗'));
console.log('  template开 ' + openTpl + ' / 闭 ' + closeTpl + (openTpl === closeTpl ? '  ✓' : '  ✗'));

// 逐行深度，找出最后未闭合的位置
let d = 0;
let min = 0;
let minLine = 0;
lines.forEach((l, i) => {
  const f = l.replace(/\s+/g, ' ');
  // 行尾的 <view 会被下一行的属性续写，这里也计入（否则会误报多出闭合标签）
  d += (f.match(/<view(?=[\s>/]|$)/g) || []).length;
  d -= (f.match(/<\/view\s*>/g) || []).length;
  if (d < min) { min = d; minLine = i + 1; }
});
console.log('  逐行最小深度 = ' + min + (min < 0 ? '（第 ' + minLine + ' 行附近多出闭合标签）' : ''));
console.log('  结束深度 = ' + d + (d === 0 ? '  ✓ 完全配平' : '  ✗'));
process.exitCode = (openView === closeView && d === 0 && min >= 0) ? 0 : 1;
