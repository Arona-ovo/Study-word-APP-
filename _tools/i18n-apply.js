// _tools/i18n-apply.js - 把 .vue 里的静态中文串套上 $t()（幂等，可重复执行）
//
// 为什么让"中文原文当 key"：
//   · 中文态直接显示 key，不用再维护一份中文表
//   · 校验脚本里断言中文文案的用例（几十条）一条都不用改 —— 原文还在文件里
//   · 英文表查不到就回退中文，可以增量翻译
//
// 处理范围：
//   模板 · 静态属性值   title="中文"      → :title="$t('中文')"
//   模板 · 纯文本节点   <text>中文</text> → <text>{{ $t('中文') }}</text>
//   脚本 · 字符串字面量 '中文'            → t('中文')（并补 import）
//   脚本 · 已带 {{}} 插值 / 模板字符串 ${} / 注释行 / console / 对象键 → 跳过（这些要手工改）
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');

const HAN = /[\u4e00-\u9fa5]/;
// 这些属性不该被动化（样式/资源/私有约定）
const ATTR_SKIP = new Set(['class', 'style', 'src', 'mode', 'type', 'name', 'id', 'open-type', 'hover-class']);

function walk(dir, ext) {
  const out = [];
  fs.readdirSync(dir).forEach(n => {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (n.endsWith(ext)) out.push(p);
  });
  return out;
}

// 已经套过就不重复套
const already = (s, i) => s.slice(Math.max(0, i - 3), i + 1).indexOf('t(') >= 0;

function applyTemplate(tpl) {
  let s = tpl;
  let n = 0;

  // 1) 静态属性值
  s = s.replace(/(\s)([a-zA-Z_][\w:.-]*)="([^"\n{}]*)"/g, (m, sp, attr, val) => {
    if (attr.startsWith(':') || attr.startsWith('@') || attr.startsWith('v-')) return m;
    if (ATTR_SKIP.has(attr)) return m;
    if (!HAN.test(val)) return m;
    n++;
    return `${sp}:${attr}="$t('${val}')"`;
  });

  // 1.5) {{ }} 表达式里的中文串：thinking ? '…' : '发送' → thinking ? $t('…') : $t('发送')
  s = s.replace(/\{\{([^{}]*)\}\}/g, (m, expr) => {
    if (!HAN.test(expr)) return m;
    const out = expr.replace(/'([^'\n]*)'/g, (mm, val, i, whole) => {
      if (!HAN.test(val)) return mm;
      if (already(whole, i)) return mm;
      n++;
      return `$t('${val}')`;
    });
    return '{{' + out + '}}';
  });

  // 2) 纯文本节点（不含 {{}} 插值；保留首尾空白）
  s = s.replace(/>([^<>{}]*)</g, (m, inner) => {
    if (!HAN.test(inner)) return m;
    const lead = inner.match(/^\s*/)[0];
    const tail = inner.match(/\s*$/)[0];
    const body = inner.slice(lead.length, inner.length - tail.length);
    if (!HAN.test(body)) return m;
    if (/\{\{\s*\$t\(/.test(body)) return m;
    n++;
    return `>${lead}{{ \$t('${body}') }}${tail}<`;
  });

  return { text: s, n };
}

function applyScript(sc) {
  const lines = sc.split('\n');
  let n = 0;
  const out = lines.map(line => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return line;
    if (t.startsWith('import ')) return line;
    if (/(console\.|debugger)/.test(line)) return line;
    let s = line.replace(/'([^'\n]*)'/g, (m, val, i, whole) => {
      // 对象键 '中文': → 不翻译（多半是数据字段，翻了会查不到）。
      // 但三元 `a ? '中文' : 'x'` 后面也跟着 ' :'，得先排除（前面有 ?）
      const after = whole.slice(i + m.length);
      const before = whole.slice(Math.max(0, i - 4), i);
      if (/^\s*:/.test(after) && !/\?\s*$/.test(before)) return m;
      // 比较运算里的常量：翻了会和实际数据对不上
      if (/[!=<>]=+\s*$/.test(before)) return m;
      if (/^\s*[!=<>]=+/.test(after)) return m;
      if (!HAN.test(val)) return m;
      if (already(whole, i)) return m;
      n++;
      return `t('${val}')`;
    });
    return s;
  });
  return { text: out.join('\n'), n };
}

const files = walk(path.join(ROOT, 'pages'), '.vue').concat(walk(path.join(ROOT, 'pkgStudy/pages'), '.vue')).concat(walk(path.join(ROOT, 'pkgManage/pages'), '.vue')).concat(walk(path.join(ROOT, 'components'), '.vue'));
let total = 0;
const changed = [];
const needsImport = [];

files.forEach(f => {
  let src = fs.readFileSync(f, 'utf8');
  const cut = src.indexOf('\n</template>');
  if (cut < 0) return;
  const tpl = src.slice(0, cut);
  const rest = src.slice(cut);

  const a = applyTemplate(tpl);
  const b = applyScript(rest);
  if (!a.n && !b.n) return;

  let next = a.text + b.text;
  if (b.n) {
    // 补 import：放在 <script> 后第一行（最稳，不会有"import 不在顶层"的问题）
    const idx = next.indexOf('\n<script');
    if (idx >= 0) {
      const nl = next.indexOf('\n', idx + 1);
      const rel = f.includes(`${path.sep}components${path.sep}`) ? '../../utils/i18n.js' : '../../utils/i18n.js';
      // 已导入过就不重复加
      if (next.indexOf("utils/i18n.js") < 0) {
        next = next.slice(0, nl + 1) + `import { t } from '${rel}';\n` + next.slice(nl + 1);
      }
      needsImport.push(path.relative(ROOT, f).replace(/\\/g, '/'));
    }
  }
  fs.writeFileSync(f, next, 'utf8');
  total += a.n + b.n;
  changed.push(`${String(a.n + b.n).padStart(4)}  tpl ${a.n}  js ${b.n}  ${path.relative(ROOT, f).replace(/\\/g, '/')}`);
});

changed.forEach(l => console.log(l));
console.log('--- 套上 $t 的中文串:', total, ' 改动文件:', changed.length, ' 补 import:', needsImport.length);
