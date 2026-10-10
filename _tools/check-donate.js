// _tools/check-donate.js - 打赏入口校验（只读）
//
// 用户明确要求：打赏要挂在设置页**最外层底部**，不要塞进「关于」折叠分组
// —— 分组收起就看不见了，而打赏是希望常驻的入口。这里守住这条。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

console.log('== 1. 页面与路由 ==');
const pj = R('pages.json');
assert(pj.indexOf('"pages/donate/donate"') >= 0, 'pages.json 已注册 pages/donate/donate');
const seg = pj.slice(pj.indexOf('"pages/donate/donate"'));
assert(/navigationStyle"\s*:\s*"custom"/.test(seg.slice(0, 200)), 'custom 导航（float-navbar 提供返回）');
assert(fs.existsSync(path.join(ROOT, 'pkgManage/pages/donate/donate.vue')), '页面文件存在');

console.log('== 2. 二维码资源 ==');
['static/donate/alipay-qr.png', 'static/donate/wechat-qr.png'].forEach(p => {
  const f = path.join(ROOT, p);
  assert(fs.existsSync(f), p + ' 存在');
  if (fs.existsSync(f)) {
    const kb = Math.round(fs.statSync(f).size / 1024);
    assert(kb > 5 && kb < 800, p + ' 体积合理（' + kb + 'KB）');
  }
});
const dp = R('pkgManage/pages/donate/donate.vue');
assert(/alipay-qr\.png/.test(dp) && /wechat-qr\.png/.test(dp), '页面引用两张二维码');
assert(/previewImage/.test(dp), '点二维码可放大预览（长按可识别）');
assert(/saveImageToPhotosAlbum/.test(dp), '有「保存到相册」');

console.log('== 3. 入口位置：设置页最外层，不在「关于」里 ==');
const sv = R('pkgManage/pages/settings/settings.vue');
const tpl = sv.slice(0, sv.indexOf('\n<script'));

// 「关于」分组的区间：从它的 sec 开始到下一个 </view> 结束的 sec（按文本切片近似）
const aboutAt = tpl.indexOf("openSec === 'about'");
assert(aboutAt > 0, '存在「关于」分组');
const donateAt = tpl.indexOf('donate-card');
assert(donateAt > 0, '打赏入口使用独立的 donate-card');

// 关键：打赏块必须出现在「关于」分组**之后**（= 挂在页面最外层底部）
assert(donateAt > aboutAt, '打赏块在「关于」分组之后（最外层底部）');
// 且它自己不能被包进任何 sec-body
const donateBlock = tpl.slice(donateAt - 200, donateAt + 400);
assert(!/openSec/.test(donateBlock), '打赏块不受任何折叠分组的 openSec 控制');

// 「关于」分组里不再有打赏行
const aboutHead = tpl.indexOf("openSec === 'about' }");
const aboutBody = tpl.slice(tpl.indexOf("v-if=\"openSec === 'about'\""));
const aboutEnd = aboutBody.indexOf('\n    </view>');
const aboutSec = aboutBody.slice(0, aboutEnd > 0 ? aboutEnd : aboutBody.length);
assert(!/支持 AWword/.test(aboutSec), '「关于」分组里已没有打赏入口');
assert(/openDonate/.test(tpl), 'openDonate 仍绑定在页面上');

console.log('== 4. 跳转方式 ==');
assert(/uni\.navigateTo\(\{ url: '\/pkgManage\/pages\/donate\/donate' \}\)/.test(sv), '用 navigateTo 打开（非 tabBar 页）');
assert(!/switchTab[\s\S]{0,40}donate/.test(sv), '没有误用 switchTab');

console.log('');
console.log(fail === 0 ? '打赏入口校验全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);
