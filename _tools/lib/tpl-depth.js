// _tools/lib/tpl-depth.js - 严格嵌套检查：栈式扫描，抓闭合顺序错误
// 要点：
//   · 先剥离 HTML 注释（<!-- -->），避免注释代码干扰
//   · 整段扫描（不按行），支持属性换行的多行标签
//   · 行号按换行符计数还原，方便定位
// 返回 { depth, unclosed, negative }
//   depth = 扫描结束后仍留在栈里的标签数（应为 0）
//   unclosed = 没被闭合的开始标签
//   negative = 闭合顺序错误（why: 'mismatch'）或多余的结束标签（why: 'no-open'）
function lineOf(str, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < str.length; i++) {
    if (str.charCodeAt(i) === 10) n++;
  }
  return n;
}

function scanTemplate(tpl) {
  const clean = String(tpl).replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const negative = [];
  // 属性值允许跨行（引号内可以有换行与 >）
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*?)>/g;
  let m;
  while ((m = re.exec(clean))) {
    const closing = !!m[1];
    const tag = m[2];
    const attrs = m[3] || '';
    const self = /\/\s*$/.test(attrs); // <xxx ... /> 自闭合
    if (self) continue;
    const line = lineOf(clean, m.index);
    if (!closing) {
      stack.push({ tag, line });
    } else if (!stack.length) {
      negative.push({ line, tag, why: 'no-open' });
    } else {
      const top = stack.pop();
      if (top.tag !== tag) {
        negative.push({ line, tag, why: 'mismatch', expected: top.tag, at: top.line });
      }
    }
  }
  return { depth: stack.length, unclosed: stack.slice(), negative };
}

module.exports = { scanTemplate };
