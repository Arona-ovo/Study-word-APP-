// _tools/check-tpl-depth.js - 严格嵌套检查：栈式扫描所有 .vue 模板，抓闭合顺序错误
// 背景：check-tpl-balance.js 只数开/闭数量，遇到"总数相同但嵌套错位"会漏报
//       （本次 home.vue 多了一个 </view>，vite 报 Invalid end tag，就是这种）
const fs = require('fs');
const path = require('path');
const { scanTemplate } = require('./lib/tpl-depth');

const ROOT = path.resolve(__dirname, '..', 'uniapp');

function walk(dir, out) {
  fs.readdirSync(dir).forEach(name => {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'unpackage' || name === '.hbuilderx') return;
      walk(p, out);
    } else if (p.endsWith('.vue')) {
      out.push(p);
    }
  });
  return out;
}

const files = walk(ROOT, []);
let bad = 0;

files.forEach(f => {
  const src = fs.readFileSync(f, 'utf8');
  const start = src.indexOf('<template>');
  const lastEnd = src.lastIndexOf('</template>');
  if (start < 0 || lastEnd <= start) return;
  const tpl = src.slice(start, lastEnd + '</template>'.length);
  const r = scanTemplate(tpl);
  const rel = path.relative(ROOT, f);
  if (r.depth === 0 && r.negative.length === 0) return;
  bad++;
  console.error('✗ ' + rel);
  if (r.negative.length) {
    r.negative.slice(0, 3).forEach(x => {
      console.error('    第 ' + x.line + ' 行：</' + x.tag + '>' +
        (x.expected ? ' 但栈顶是 <' + x.expected + '>' : ' 没有可匹配的开始标签'));
    });
  }
  if (r.depth > 0) {
    r.unclosed.slice(-3).forEach(x => {
      console.error('    未闭合：<' + x.tag + '>（第 ' + x.line + ' 行开始）');
    });
  }
});

console.log('');
console.log(bad === 0
  ? ('嵌套检查通过 ✓（' + files.length + ' 个 .vue）')
  : ('发现 ' + bad + ' 个文件嵌套异常 ✗'));
process.exit(bad === 0 ? 0 : 1);
