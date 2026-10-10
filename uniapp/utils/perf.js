// utils/perf.js - 设备性能探测 + 画质档位（4 档）+ 自动推荐
//
// 为什么不用 requestAnimationFrame 测帧率：
//   uni-app 的 App 端逻辑层跑在独立 JS 引擎里（Android: V8 / iOS: JSCore），
//   没有 window、没有 rAF，测不到真实渲染帧率（renderjs 能测，但会为一次探测
//   引入一整套视图层代码，不划算）。所以这里改测两件"逻辑层能测、又和渲染开销
//   强相关"的量：
//     ① CPU 算力   —— 固定工作量跑完要多久，单位「每秒迭代数」
//     ② 光栅化面积 —— windowWidth × windowHeight × DPR²，即每帧要填多少物理像素
//
// 【2026-10-09 重构：从「布尔开关」到「四档画质」】
//   旧模型只回答一个问题：这机器弱不弱？—— 弱就把 128 处毛玻璃全关掉，一刀切。
//   问题是中端机被误杀：它明明扛得住顶栏/底栏那几块小玻璃，却被当成低端机处理。
//   新模型先算一个 0-100 的综合分，再映射到画质档位：
//     高画质  完整的毛玻璃层次
//     清透    比高画质淡一档，动效仍完整
//     均衡    玻璃保留但减淡 + 动效缩短 + 投影收窄（肉眼几乎看不出，成本降一半）
//     轻量    只留大面积的顶栏/底栏/弹窗玻璃，卡片表面调实
//     省电    玻璃同轻量，动效与投影全关
//     极简    全树不模糊、无动效、无投影
//   三个维度（毛玻璃 / 动效 / 阴影）还能在档位之上单独微调，改过的那一维会被标记。
//
// 【2026-10-09 二次修正：自动档为什么还会卡】
//   综合分里 CPU 占 60%，但毛玻璃的真正开销在 GPU 填充率 —— 一台 CPU 很强、
//   屏幕物理像素却接近上限的机器（实测 3.1M 像素）能拿 62 分被分到「均衡」，
//   滑起来仍然掉帧。所以自动推荐在综合分之外再加一条**像素封顶**：
//     物理像素 > 3.0M → 最高只给「轻量」；> 2.4M → 最高只给「均衡」。
//   分数再高也越不过这条线（用户手动选档不受限）。
//
// 只影响观感，不影响任何功能与学习数据。

import * as settings from './settings.js';
import * as theme from './theme.js';

// 采样时长(ms)：再短 JIT 没热起来，再长用户能感觉到卡一下
const CPU_SAMPLE_MS = 60;
// 判定阈值（保守：宁可不自动降级，也不误伤高端机。
// 因为中间多了"均衡"这一档，降级带来的观感损失很小，所以可以激进一点）
const LOW_CPU = 15e6;       // 每秒迭代数低于此 → CPU 明显偏弱
const GOOD_CPU = 60e6;      // 高于此 → CPU 充裕（拿满分）
const BIG_PIXELS = 3.2e6;   // 物理像素超过此 → 每帧填充量偏大
const SMALL_PIXELS = 1.5e6; // 低于此 → 填充量轻松（拿满分）

// ---------- 画质档位表 ----------
// blurSm/blurLg：卡片级(8px)与窗体级(12px)的高斯半径，0 表示不模糊
// glass 三种取值：full=所有窗体都模糊 / key=只有顶栏底栏弹窗 / off=全不模糊
// smooth：是否为"省电档"（== 旧模型的"流畅模式"，用于向下兼容 theme.currentSmooth）
export const QUALITY = {
  high: {
    key: 'high',
    name: '高画质',
    desc: '完整的毛玻璃层次与动效',
    glass: 'full', motion: 'full', shadow: 'full',
    blurSm: 8, blurLg: 12, maxBgBlur: 24, smooth: false
  },
  clear: {
    key: 'clear',
    name: '清透',
    desc: '玻璃更淡一档，动效仍然完整',
    glass: 'full', motion: 'full', shadow: 'slim',
    blurSm: 6, blurLg: 9, maxBgBlur: 20, smooth: false
  },
  balanced: {
    key: 'balanced',
    name: '均衡',
    desc: '玻璃减淡、动效缩短，观感几乎不变',
    glass: 'full', motion: 'reduced', shadow: 'slim',
    blurSm: 5, blurLg: 8, maxBgBlur: 16, smooth: false
  },
  lite: {
    key: 'lite',
    name: '轻量',
    desc: '只留大面积窗体的玻璃，卡片调实',
    glass: 'key', motion: 'reduced', shadow: 'slim',
    blurSm: 0, blurLg: 0, maxBgBlur: 0, smooth: true
  },
  eco: {
    key: 'eco',
    name: '省电',
    desc: '玻璃同轻量，动效与投影全关',
    glass: 'key', motion: 'off', shadow: 'none',
    blurSm: 0, blurLg: 0, maxBgBlur: 0, smooth: true
  },
  minimal: {
    key: 'minimal',
    name: '极简',
    desc: '全树不模糊，关闭动效与投影',
    glass: 'off', motion: 'off', shadow: 'none',
    blurSm: 0, blurLg: 0, maxBgBlur: 0, smooth: true
  }
};

export const QUALITY_KEYS = ['high', 'clear', 'balanced', 'lite', 'eco', 'minimal'];

// 参与微调的三个维度（改了就不跟随档位）
export const FX_PARTS = ['glass', 'motion', 'shadow'];

export const GLASS_OPTIONS = ['full', 'key', 'off'];
export const MOTION_OPTIONS = ['full', 'reduced', 'off'];
export const SHADOW_OPTIONS = ['full', 'slim', 'none'];

export function qualityOf(k) {
  return QUALITY[k] || QUALITY.high;
}

function now() {
  try {
    return Date.now();
  } catch (e) {
    return new Date().getTime();
  }
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// 整数 + 浮点混合，避免被 JIT 整体常量折叠掉；结果故意用掉，防止被优化删除
export function cpuScore() {
  const t0 = now();
  let acc = 0;
  let n = 0;
  const step = 20000;
  while (now() - t0 < CPU_SAMPLE_MS) {
    for (let i = 0; i < step; i++) {
      acc += (i * 31 + 7) % 977;
      acc = acc * 0.5 + i * 0.25;
    }
    n += step;
  }
  const el = Math.max(1, now() - t0);
  // acc 参与返回，编译器不敢把整个循环删掉；这个值本身没有意义
  if (acc === 12345.678901) return 0;
  return Math.round((n / el) * 1000);
}

// 每帧要填充的物理像素数（DPR 是平方项：横竖各放大一次）
export function pixelCount() {
  try {
    const i = uni.getSystemInfoSync() || {};
    const w = Number(i.windowWidth || i.screenWidth) || 360;
    const h = Number(i.windowHeight || i.screenHeight) || 640;
    const d = Number(i.pixelRatio || i.devicePixelRatio) || 2;
    return Math.round(w * h * d * d);
  } catch (e) {
    return 0;
  }
}

// 综合分 0-100：CPU 权重 60、光栅面积权重 40。
// 两者都用线性插值取 0-1，避免单一维度极端值直接决定结论
//   —— 一台 2K 屏的旗舰（面积大但 CPU 强）不该被判成低端机。
export function scoreOf(cpu, px) {
  const c = cpu > 0 ? clamp01((cpu - LOW_CPU) / (GOOD_CPU - LOW_CPU)) : 0;
  const p = px > 0 ? clamp01((BIG_PIXELS - px) / (BIG_PIXELS - SMALL_PIXELS)) : 1;
  return Math.round(c * 60 + p * 40);
}

// 分数 → 推荐档位（只看综合分；阈值整体收紧过 —— 用户实测「自动」在 62 分
// 机器上还有点卡，宁可给淡一档，用户想要亮的效果可以手动选回去）
export function recommendQuality(score) {
  const s = Number(score) || 0;
  if (s >= 82) return 'high';
  if (s >= 64) return 'clear';
  if (s >= 46) return 'balanced';
  if (s >= 28) return 'lite';
  if (s >= 12) return 'eco';
  return 'minimal';
}

// 物理像素封顶：分数再高也越不过这条线。
// 毛玻璃逐帧模糊的开销在 GPU 填充率，CPU 测分再强也代表不了它 ——
// 高分 + 高分辨率的机器按分数给档会「看起来分高、滑起来掉帧」。
export function pixelCap(px) {
  const p = Number(px) || 0;
  if (!(p > 0)) return 'high';          // 探测失败时不设限
  if (p > 3.0e6) return 'lite';         // 每帧填充量巨大 → 卡片玻璃必须让位
  if (p > 2.4e6) return 'balanced';
  return 'high';
}

// 取两档中更省的那一档（QUALITY_KEYS 越靠后越省）
function weakerOf(a, b) {
  const ia = QUALITY_KEYS.indexOf(a);
  const ib = QUALITY_KEYS.indexOf(b);
  if (ia < 0) return b;
  if (ib < 0) return a;
  return ia >= ib ? a : b;
}

// 取两档中更强的那一档（autoDowngrade 的 need 硬下限用）
function strongerOf(a, b) {
  const ia = QUALITY_KEYS.indexOf(a);
  const ib = QUALITY_KEYS.indexOf(b);
  if (ia < 0) return b;
  if (ib < 0) return a;
  return ia <= ib ? a : b;
}

// 自动档的最终推荐 = 综合分推荐 与 像素封顶 取更省的一档
export function pickAuto(score, px) {
  return weakerOf(recommendQuality(score), pixelCap(px));
}

// 判断已落盘的 fx 是否还等于"按当前档位解析出的 fx"。
// 自动档的解析结果会随版本演进变化（比如加了像素封顶）—— 老用户的 fx 停在
// 旧解析结果上，只有这里识别出"过期"，升级后才吃得到新档位。
const FX_KEYS = ['glass', 'motion', 'shadow', 'blurSm', 'blurLg', 'maxBgBlur'];
function fxMatches(p, want) {
  return FX_KEYS.every((k) => p.fx && p.fx[k] === want[k]);
}

// 探测一次（不写设置、不改模式，纯测量）
export function detect() {
  const cpu = cpuScore();
  const px = pixelCount();
  const lowCpu = cpu > 0 && cpu < LOW_CPU;
  const bigPixels = px > BIG_PIXELS;
  const need = lowCpu || bigPixels;
  // tier 是设备能力的粗粒度标签（对外兼容：只有 low / mid / high 三种）
  let tier = 'mid';
  if (need) tier = 'low';
  else if (cpu > 0 && cpu > LOW_CPU * 4 && px < BIG_PIXELS * 0.8) tier = 'high';
  const score = scoreOf(cpu, px);
  return {
    cpu: cpu,
    px: px,
    lowCpu: lowCpu,
    bigPixels: bigPixels,
    need: need,
    tier: tier,
    score: score,
    recommend: pickAuto(score, px)
  };
}

export function tierText(t) {
  return t === 'low' ? '偏弱' : (t === 'high' ? '充裕' : '中等');
}

export function qualityText(k) {
  return qualityOf(k).name;
}

export function glassText(v) {
  return v === 'key' ? '仅关键处' : (v === 'off' ? '关闭' : '全部');
}

export function motionText(v) {
  return v === 'reduced' ? '精简' : (v === 'off' ? '关闭' : '完整');
}

export function shadowText(v) {
  return v === 'slim' ? '收窄' : (v === 'off' || v === 'none' ? '无' : '完整');
}

// 用户保存在设置里的原始值（可能是 'auto'，不像 currentQualityKey 那样被解析过）
export function rawQuality() {
  try {
    return (settings.get().performance || {}).quality || 'auto';
  } catch (e) {
    return 'auto';
  }
}

// 是否有人为微调（设置页用来显示"已自定义"）。
// '' / null 都表示"改回默认值了"，不算自定义 —— 见 setFxPart 里关于 deepMerge 的说明
function liveOverride() {
  let p = {};
  try {
    p = (settings.get() || {}).performance || {};
  } catch (e) {
    return {};
  }
  const src = p.fxOverride || {};
  const out = {};
  Object.keys(src).forEach((k) => {
    if (src[k]) out[k] = src[k];
  });
  return out;
}

// ---------- 档位的读取与写入 ----------

// 没有探测过时不降级（宁可让用户觉得卡，也不要一上来就把观感砍了）
function autoKey() {
  let p = {};
  try {
    p = (settings.get() || {}).performance || {};
  } catch (e) {
    p = {};
  }
  if (!p.probed) return 'high';
  return pickAuto(scoreOf(p.cpu || 0, p.px || 0), p.px || 0);
}

// 当前实际生效的档位 key（'auto' 会被解析掉）
export function currentQualityKey() {
  let p = {};
  try {
    p = (settings.get() || {}).performance || {};
  } catch (e) {
    p = {};
  }
  const q = p.quality || 'auto';
  if (q === 'auto') return autoKey();
  return QUALITY[q] ? q : autoKey();
}

// 把"档位默认值"与"用户微调"合成一份最终 fx（写进 settings，theme 只读结果）
function composeFx(baseKey, override) {
  const base = qualityOf(baseKey);
  const o = override || {};
  const glass = o.glass || base.glass;
  const noBlur = glass === 'off' || glass === 'key';
  return {
    glass: glass,
    motion: o.motion || base.motion,
    shadow: o.shadow || base.shadow,
    // glass=key 时各组件的玻璃统一关掉，只有 App.vue 里的关键窗体例外打开
    blurSm: noBlur ? 0 : base.blurSm,
    blurLg: noBlur ? 0 : base.blurLg,
    maxBgBlur: base.maxBgBlur
  };
}

// 当前生效的 fx（theme.js 若已缓存则优先用它传来的值，避免重复读 storage）
export function getFx() {
  let p = {};
  try {
    p = (settings.get() || {}).performance || {};
  } catch (e) {
    p = {};
  }
  if (p.fx) return p.fx;
  // 老数据没有 fx：按当前档位算一份（不写回，等用户改设置时自然会落盘）
  return composeFx(currentQualityKey(), p.fxOverride);
}

// 选档位。manual=true 表示用户亲手选的（之后自动检测不再改）
export function setQuality(k, manual) {
  const key = (k === 'auto' || QUALITY[k]) ? k : 'high';
  const effective = key === 'auto' ? autoKey() : key;
  const base = qualityOf(effective);
  // 选档位 = 换一套新的基准值，所以旧的微调一并清掉（不然"轻量 + 玻璃全部"会让人困惑）
  const fx = composeFx(effective, null);
  // settings.set() 是深合并，空对象清不掉旧键 —— 必须把三个维度逐个写空。
  // 这里不能用 null（deepMerge 会忽略 null），用空字符串当"已重置"的哨兵值。
  const cleared = {};
  FX_PARTS.forEach((k) => { cleared[k] = ''; });
  const patch = {
    quality: key,
    level: effective,
    fx: fx,
    fxOverride: cleared,
    smooth: !!base.smooth
  };
  if (manual === true) { patch.manual = true; patch.auto = false; }
  else if (manual === false) { patch.auto = true; patch.manual = false; }
  try {
    settings.set({ performance: patch });
  } catch (e) {}
  try { theme.apply(); } catch (e) {}
  return key;
}

// 单独微调某一维（毛玻璃 / 动效 / 阴影）。
// 值与所在档位相同时记不下来（自动抹掉 override），UI 上就不会显示"自定义"
export function setFxPart(part, v) {
  if (FX_PARTS.indexOf(part) < 0) return getFx();
  let p = {};
  try {
    p = (settings.get() || {}).performance || {};
  } catch (e) {
    p = {};
  }
  const effective = (p.quality && p.quality !== 'auto' && QUALITY[p.quality]) ? p.quality : currentQualityKey();
  const ov = Object.assign({}, p.fxOverride || {});
  const base = qualityOf(effective);
  // 清除用空字符串 ''，不要用 null：settings.set() 走的 deepMerge 第一行就是
  // `if (over === null) return base` —— null 会被原样忽略，根本覆盖不掉旧值。
  ov[part] = (base[part] === v) ? '' : v;
  const fx = composeFx(effective, ov);
  try {
    settings.set({
      performance: {
        quality: effective,
        level: effective,
        fx: fx,
        fxOverride: ov,
        manual: true,
        auto: false,
        smooth: !!qualityOf(effective).smooth
      }
    });
  } catch (e) {}
  try { theme.apply(); } catch (e) {}
  return fx;
}

// 是否有人为微调（设置页用来显示"已自定义"）
export function customized() {
  return Object.keys(liveOverride()).length > 0;
}

// 首次启动时跑一次：按探测结果选档位（= 旧模型的"自动开流畅模式"）
//   force = true → 忽略"已探测过"，重新测（设置页的「重新检测」）
//   opts.rematch = true → 连"手动选过档位"的承诺一起清掉：
//     重新检测的语义就是"按现在的设备重新帮我匹配"，手动留存的旧档位
//     （可能是在旧机器上选的）不该再压住新探测结果。用完即回到 auto。
export function autoDowngrade(force, opts) {
  let p = {};
  try {
    p = (settings.get() || {}).performance || {};
  } catch (e) {
    p = {};
  }
  const rematch = !!(opts && opts.rematch);
  const prevQuality = (rematch || !p.manual) ? 'auto' : (p.quality || 'auto');
  const manual = rematch ? false : !!p.manual;
  if (!force && p.probed) {
    // 跳过重测，但自动档的解析结果可能已经变了（版本升级加了像素封顶等）：
    // 重新按存的 cpu/px 解析一次，fx 对不上就静默重写并广播 ——
    // 否则老用户要等手动碰设置才能吃到新档位。
    const cpu0 = p.cpu || 0;
    const px0 = p.px || 0;
    const rec = pickAuto(scoreOf(cpu0, px0), px0);
    const need2 = (cpu0 > 0 && cpu0 < LOW_CPU) || px0 > BIG_PIXELS;
    const eff = p.quality === 'auto'
      ? (need2 ? strongerOf(rec, 'lite') : rec)
      : (QUALITY[p.quality] ? p.quality : rec);
    if (p.quality === 'auto' && !fxMatches(p, composeFx(eff, liveOverride()))) {
      const want = composeFx(eff, liveOverride());
      let smooth = !!p.smooth;
      let auto = !!p.auto;
      const base = qualityOf(eff);
      if (base.smooth && !smooth) { smooth = true; auto = true; }
      else if (!base.smooth && auto && smooth) { smooth = false; auto = false; }
      try {
        settings.set({ performance: { level: eff, fx: want, smooth: smooth, auto: auto } });
      } catch (e) {}
      try { theme.apply(); } catch (e) {}
      return {
        skipped: true,
        silentRefresh: true,
        smooth: smooth,
        auto: auto,
        cpu: cpu0,
        px: px0,
        tier: p.tier || 'mid',
        score: p.score || scoreOf(cpu0, px0),
        recommend: rec,
        quality: p.quality || 'auto',
        level: eff
      };
    }
    return {
      skipped: true,
      smooth: !!p.smooth,
      cpu: cpu0,
      px: px0,
      tier: p.tier || 'mid',
      score: p.score || 0,
      recommend: pickAuto(p.score || 0, p.px || 0),
      quality: prevQuality,
      level: p.level || prevQuality
    };
  }
  const r = detect();
  let smooth = !!p.smooth;
  let auto = !!p.auto;
  let quality = prevQuality;
  let level = prevQuality === 'auto' ? r.recommend : prevQuality;
  if (!QUALITY[level]) level = r.recommend;
  // need（CPU 弱或光栅面积过大）是硬下限：至少降到 lite。
  // 不能只看综合分 —— "CPU 很强但 4K 屏"的机器照样会掉帧，见 detect() 里的 need。
  if (r.need) level = strongerOf(level, 'lite');

  // 用户亲手拨过开关 / 亲手选过档位（manual）就不再自动改，哪怕检测结果是"偏弱"。
  // 与旧版口径一致：manual 是硬承诺，自动检测一律不碰（「重新检测」的 rematch 除外）。
  if (!manual) {
    if (quality === 'auto') {
      level = r.need ? strongerOf(r.recommend, 'lite') : r.recommend;
    }
    const base = qualityOf(level);
    if ((r.need || quality === 'auto') && base.smooth && !smooth) {
      // need，或自动档自己选到了省电档 → 打开流畅模式（fx 与 perf-smooth 要一致）
      smooth = true;
      auto = true;
    } else if (!base.smooth && auto && smooth) {
      // 换到更强的机器 / 重测通过 → 把自动开的那次还回去
      smooth = false;
      auto = false;
    } else if (!base.smooth) {
      smooth = false;
    }
  }

  const fx = composeFx(level, null);
  try {
    settings.set({
      performance: {
        probed: true,
        auto: auto,
        smooth: smooth,
        cpu: r.cpu,
        px: r.px,
        tier: r.tier,
        score: r.score,
        quality: quality,
        level: level,
        fx: fx,
        fxOverride: p.fxOverride || {},
        manual: manual
      }
    });
  } catch (e) {}
  // 必须广播：探测是启动 1500ms 后才跑的，那时首屏页面早就渲染完了。
  // 不通知的话页面根节点上的 fx-* class 与 --glass-* 变量还停在探测前的默认值，
  // "首次启动自动匹配性能"就只在下一次进页面才生效 —— 等于没生效。
  // theme.apply() 内部会 $emit('theme:change')，页面的 mixin 据此重算根节点。
  try { theme.apply(); } catch (e) {}
  return Object.assign({
    skipped: false,
    smooth: smooth,
    auto: auto,
    manual: manual,
    quality: quality,
    level: level
  }, r);
}

// 当前设备档位的展示文案（设置页用）
export function summary() {
  let p = {};
  try {
    p = (settings.get() || {}).performance || {};
  } catch (e) {
    p = {};
  }
  if (!p.probed) return { probed: false, text: '未检测' };
  const px = (p.px || 0) / 1e6;
  const score = p.score || scoreOf(p.cpu || 0, p.px || 0);
  const key = p.level || p.quality || 'high';
  const parts = [
    tierText(p.tier || 'mid'),
    score + ' 分',
    px.toFixed(1) + 'M 像素'
  ];
  if (p.auto) parts.push('已自动降级');
  return {
    probed: true,
    cpu: p.cpu || 0,
    px: p.px || 0,
    tier: p.tier || 'mid',
    score: score,
    recommend: pickAuto(score, p.px || 0),
    quality: p.quality || 'auto',
    level: key,
    auto: !!p.auto,
    customized: customized(),
    text: parts.join(' · ')
  };
}
