// 一次性审计：模板里引用的事件方法与插值变量，是否在 <script> 里真的存在
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', 'uniapp');

const files = [];
(function walk(d) {
  fs.readdirSync(d).forEach(n => {
    const fp = path.join(d, n);
    if (fs.statSync(fp).isDirectory()) {
      if (['node_modules', 'unpackage', '.hbuilderx'].includes(n)) return;
      walk(fp);
    } else if (n.endsWith('.vue')) files.push(fp);
  });
})(ROOT);

const problems = [];

files.forEach(fp => {
  const src = fs.readFileSync(fp, 'utf8');
  const rel = path.relative(ROOT, fp).replace(/\\/g, '/');
  const tEnd = src.indexOf('\n<style');
  const tpl = src.slice(0, tEnd > 0 ? tEnd : src.length);
  const sStart = src.indexOf('\n<script');
  const script = sStart >= 0 ? src.slice(sStart, tEnd > sStart ? tEnd : src.length) : '';
  if (!script) return;

  // 收集 data / computed / methods / props 里定义过的名字
  const known = new Set();
  const block = (name) => {
    let i = script.indexOf(name + '(');
    if (i < 0) i = script.indexOf(name + ':');
    if (i < 0) return '';
    let depth = 0, j = script.indexOf('{', i);
    if (j < 0) return '';
    for (let k = j; k < script.length; k++) {
      if (script[k] === '{') depth++;
      else if (script[k] === '}') { depth--; if (depth === 0) return script.slice(j, k + 1); }
    }
    return '';
  };
  ['data', 'computed', 'methods', 'props', 'watch'].forEach(b => {
    const body = block(b);
    const re = /^\s{4,6}(?:'([^']+)'|"?([A-Za-z_$][\w$]*)"?)\s*[:(]/gm;
    let m;
    while ((m = re.exec(body))) known.add(m[1] || m[2]);
  });
  // setup 场景直接跳过
  if (/setup\s*\(/.test(script)) return;

  // 1) 事件处理器
  const evRe = /@(?:tap|click|change|confirm|input|blur|focus|touchstart|touchend|touchmove|mousedown|mouseup)\.[\w.]*="([A-Za-z_$][\w$]*)\s*\(?/g;
  let m;
  while ((m = evRe.exec(tpl))) {
    if (!known.has(m[1])) problems.push(rel + '：事件方法未定义 -> ' + m[1]);
  }

  // 2) 插值里的根标识符
  const mustRe = /\{\{\s*([A-Za-z_$][\w$]*)/g;
  while ((m = mustRe.exec(tpl))) {
    const name = m[1];
    if (['true', 'false', 'null', 'undefined', 'item', 'index'].includes(name)) continue;
    if (/^(v-|:|@)/.test(name)) continue;
    if (!known.has(name)) {
      // 可能是 v-for 的局部变量，只在没有 v-for 的同级出现时才算问题
      if (!/v-for=/.test(tpl)) problems.push(rel + '：插值变量未定义 -> ' + name);
    }
  }

  // 3) :prop 绑定的根标识符
  const bindRe = /:(?:class|style|value|checked|src|disabled|placeholder|type)="\s*([A-Za-z_$][\w$]*)\s*"/g;
  while ((m = bindRe.exec(tpl))) {
    if (!known.has(m[1]) && !/v-for=/.test(tpl)) {
      problems.push(rel + '：绑定变量未定义 -> ' + m[1]);
    }
  }
});

console.log(problems.length ? problems.join('\n') : '模板引用审计通过：未发现未定义的方法 / 变量');
console.log('扫描 .vue 文件：' + files.length);
