// _tools/dedupe-common.js - 去掉 data/common-words.js 里的重复词条（保留首次出现）
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../uniapp/data/common-words.js');
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const seen = new Set();
const removed = [];
const out = lines.filter(line => {
  const m = /^\s*'([a-zA-Z'-]+)\|/.exec(line);
  if (!m) return true;
  const key = m[1].toLowerCase();
  if (seen.has(key)) { removed.push(line.trim()); return false; }
  seen.add(key);
  return true;
});

fs.writeFileSync(file, out.join('\n'), 'utf8');
console.log('删除重复 ' + removed.length + ' 条：');
removed.forEach(r => console.log('  - ' + r));
console.log('剩余词条 ' + seen.size + ' 条');
