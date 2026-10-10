// _tools/i18n-extract.js - 扫描 .vue，抽出所有"静态中文串"（可作为 i18n key 的那些）
//
// 只抽静态串：模板里的纯文本节点与静态属性值、脚本里的普通字符串字面量。
// 带 {{}} 插值 / 模板字符串 ${} 的不抽（那种要手工改成带 {var} 占位的一条 key）。
// 输出：_tools/_scratch/i18n-keys.json  （{ 文案: 出现次数 }）
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');

const HAN = /[\u4e00-\u9fa5]/;
function walk(dir, ext) {
  const out = [];
  fs.readdirSync(dir).forEach(n => {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (n.endsWith(ext)) out.push(p);
  });
  return out;
}

const counts = {};
const add = (s) => {
  // 已经套过 $t() 的要把壳剥掉，只留文案本身
  let k = String(s).trim().replace(/^\$?t\(/, '').replace(/\)$/, '');
  k = k.trim().replace(/^['"]/, '').replace(/['"]$/, '').trim();
  if (!k || !HAN.test(k)) return;
  counts[k] = (counts[k] || 0) + 1;
};

walk(path.join(ROOT, 'pages'), '.vue').concat(walk(path.join(ROOT, 'pkgStudy/pages'), '.vue')).concat(walk(path.join(ROOT, 'pkgManage/pages'), '.vue')).concat(walk(path.join(ROOT, 'components'), '.vue')).forEach(f => {
  const src = fs.readFileSync(f, 'utf8');
  const cut = src.indexOf('\n</template>');
  const tpl = cut > 0 ? src.slice(0, cut) : '';
  const rest = cut > 0 ? src.slice(cut) : src;

  // 1) 静态属性值：title="中文" placeholder="中文"
  (tpl.match(/\s[a-zA-Z_:][\w:.-]*="[^"{}]*"/g) || []).forEach(m => {
    const v = m.slice(m.indexOf('="') + 2, -1);
    if (HAN.test(v)) add(v);
  });

  // 2) 纯文本节点：>中文<
  (tpl.match(/>[^<>{}]*</g) || []).forEach(m => {
    add(m.slice(1, -1));
  });

  // 3) 脚本里的字符串字面量（跳过整行注释与模板字符串）
  rest.split('\n').forEach(line => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    (line.match(/'[^'\n$]*'/g) || []).forEach(m => add(m.slice(1, -1)));
    (line.match(/"[^"\n$]*"/g) || []).forEach(m => add(m.slice(1, -1)));
  });
});

const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
const out = path.join(__dirname, '_scratch', 'i18n-keys.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(counts, null, 2), 'utf8');
console.log('唯一文案条数 =', keys.length, ' 总出现次数 =', keys.reduce((s, k) => s + counts[k], 0));
keys.slice(0, 40).forEach(k => console.log(String(counts[k]).padStart(3), k));
