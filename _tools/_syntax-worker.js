// _tools/_syntax-worker.js - check-syntax.js 的批量解析工人（被 spawn 一次）
//
// 为什么要有它：主进程跑在 --experimental-strip-types 下，拿不到 vm.SourceTextModule
// （ESM 解析器要 --experimental-vm-modules）。而逐个文件 spawn `node --check`
// 在 Windows 上会撞 EBUSY —— 一次全量 84 次 spawn，杀软/句柄一抖就整轮假红。
// 这里改成：spawn 一次，在带 flag 的进程里把 84 个文件全解析完，只回传结果。
//
// 输入：argv[2] = 清单 JSON 路径 [{file, ts}]
// 输出：stdout JSON [{file, err}]（err 为 null 表示通过）
const fs = require('fs');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const list = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = [];

list.forEach(({ file, ts }) => {
  let code = fs.readFileSync(file, 'utf8');
  let err = null;
  try {
    // .ts / <script lang="ts"> 要先剥类型标注，否则 interface / 类型标注会被当语法错误
    if (ts) code = stripTypeScriptTypes(code, { mode: 'strip' });
    // 只构造不执行：SourceTextModule 的构造过程就是一次完整的模块语法解析
    new vm.SourceTextModule(code, { identifier: file });
  } catch (e) {
    err = String((e && e.message) || e);
  }
  out.push({ file: file, err: err });
});

process.stdout.write(JSON.stringify(out));
