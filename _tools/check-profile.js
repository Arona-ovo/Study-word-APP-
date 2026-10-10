// _tools/check-profile.js - 校验「我的」页个人资料默认值与迁移（只读）
// 运行：node _tools/check-profile.js
//
// 覆盖：
//  1) 默认昵称必须是 arona（不再用「学习者」）
//  2) settings.js 与 profile.vue 两处默认值一致（两者各存一份，容易改漏一边）
//  3) 老存档迁移：昵称仍为「学习者」或为空 → 自动改成 arona
//  4) 用户自定义过的昵称不被迁移覆盖

const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load');

const ROOT = path.join(__dirname, '..', 'uniapp');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + b);
  else bad(label + ' 期望 ' + b + '，实际 ' + a);
}

/** 用给定的已存数据跑一次 settings 读档，返回最终昵称 */
function nicknameWith(stored) {
  const mem = {};
  global.uni = {
    getStorageSync: (k) => mem[k],
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: (k) => { delete mem[k]; },
    showToast: () => {}
  };
  if (stored) mem['fj_app_settings_v1'] = stored;
  const s = load('utils/settings.js');
  s.init();
  return s.get().profile.nickname;
}

console.log('== 1. 默认昵称 = arona ==');
eq(nicknameWith(null), 'arona', '全新安装（无存档）');

console.log('== 2. 老存档迁移 ==');
eq(nicknameWith({ profile: { avatar: '', nickname: '学习者', account: 'local_x', bio: '' } }),
  'arona', '昵称还是老默认值「学习者」→ 迁移为 arona');
eq(nicknameWith({ profile: { avatar: '', nickname: '', account: 'local_x', bio: '' } }),
  'arona', '昵称为空 → 兜底为 arona');

console.log('== 3. 用户自定义昵称不被覆盖 ==');
eq(nicknameWith({ profile: { avatar: '', nickname: '小明', account: 'local_x', bio: '' } }),
  '小明', '自定义昵称保持原样');
eq(nicknameWith({ profile: { avatar: '', nickname: 'arona', account: 'local_x', bio: '' } }),
  'arona', '恰好等于新默认值的昵称也保持原样');

console.log('== 4. 两处默认值一致 ==');
const setSrc = R('utils/settings.js');
const vueSrc = R('pages/profile/profile.vue');
const m1 = /const DEFAULT_NICKNAME = '([^']*)'/.exec(setSrc);
const m2 = /const DEFAULT_NICKNAME = '([^']*)'/.exec(vueSrc);
assert(m1 && m2, 'settings.js 与 profile.vue 都定义了 DEFAULT_NICKNAME 常量');
if (m1 && m2) eq(m1[1], m2[1], '两处常量取值一致');

// 迁移分支存在
assert(/LEGACY_NICKNAME/.test(setSrc), 'settings.js 定义了旧昵称常量 LEGACY_NICKNAME');
assert(/nick === LEGACY_NICKNAME/.test(setSrc), '读档时做一次性迁移');

console.log('');
console.log(fail === 0 ? '全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
process.exit(fail === 0 ? 0 : 1);
