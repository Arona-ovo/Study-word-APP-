// 一次性脚本：把 settings.vue 里 sec-body 的闭合标签对齐到它的起始缩进（6 空格）
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'uniapp', 'pkgManage', 'pages', 'settings', 'settings.vue');
const lines = fs.readFileSync(FILE, 'utf8').split('\n');

let fixed = 0;
for (let i = 0; i < lines.length - 1; i++) {
  if (lines[i] === '        </view>' && lines[i + 1] === '    </view>') {
    lines[i] = '      </view>';
    fixed++;
  }
}

fs.writeFileSync(FILE, lines.join('\n'));
console.log('对齐 sec-body 闭合标签 ' + fixed + ' 处');
