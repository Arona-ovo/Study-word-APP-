// utils/color.js - 颜色小工具（纯函数、零依赖，方便单测）
//
// 只做一件事：把"用户挑的一个颜色"变成能直接写进 CSS 的值。
//   · 解析：#abc / #aabbcc / 带不带 # 都要能收，收不了就返回空串（调用方自己兜底）
//   · 互转：hex ↔ rgb ↔ hsl（取色面板的三根滑杆用的是 HSL，底下存的是 hex）
//   · 派生：变亮 / 变暗 / 混色 / 深色变体（自定义色也得有自己的深色档，
//           否则深色模式下一刀切 #121513，用户挑的颜色就白挑了）

const HEX = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function clamp(n, lo, hi) {
  const v = Number(n);
  if (!isFinite(v)) return lo;
  return v < lo ? lo : (v > hi ? hi : v);
}

/** 归一成 '#rrggbb'；非法返回 '' */
export function normalizeHex(v) {
  const s = String(v == null ? '' : v).trim();
  const m = s.match(HEX);
  if (!m) return '';
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return '#' + h.toLowerCase();
}

export function isHex(v) {
  return !!normalizeHex(v);
}

/** hex → [r, g, b]（0-255）；非法返回 null */
export function hexToRgb(hex) {
  const h = normalizeHex(hex);
  if (!h) return null;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function rgbToHex(r, g, b) {
  const f = (n) => ('0' + clamp(Math.round(n), 0, 255).toString(16)).slice(-2);
  return '#' + f(r) + f(g) + f(b);
}

/** rgb（0-255）→ { h:0-360, s:0-100, l:0-100 } */
export function rgbToHsl(r, g, b) {
  const R = clamp(r, 0, 255) / 255, G = clamp(g, 0, 255) / 255, B = clamp(b, 0, 255) / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hexToHsl(hex) {
  const c = hexToRgb(hex);
  if (!c) return { h: 0, s: 0, l: 50 };
  return rgbToHsl(c[0], c[1], c[2]);
}

/** { h, s, l } → hex；h 会绕回 0-360，s / l 夹到 0-100 */
export function hslToHex(h, s, l) {
  const H = ((clamp(h, -3600, 3600) % 360) + 360) % 360;
  const S = clamp(s, 0, 100) / 100;
  const L = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = L - c / 2;
  let rgb;
  if (H < 60) rgb = [c, x, 0];
  else if (H < 120) rgb = [x, c, 0];
  else if (H < 180) rgb = [0, c, x];
  else if (H < 240) rgb = [0, x, c];
  else if (H < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
}

/**
 * 变亮 / 变暗：amt > 0 往白走，< 0 往黑走，abs(amt) 是 0-1 的比例。
 * 比在 HSL 里改 L 更接近"叠一层半透明白/黑"的观感，也不会把饱和度洗掉。
 */
export function shade(hex, amt) {
  const c = hexToRgb(hex);
  if (!c) return normalizeHex(hex) || '#000000';
  const a = Number(amt) || 0;
  const t = clamp(Math.abs(a), 0, 1);
  const target = a > 0 ? 255 : 0;
  return rgbToHex(
    c[0] + (target - c[0]) * t,
    c[1] + (target - c[1]) * t,
    c[2] + (target - c[2]) * t
  );
}

/** 两个 hex 混色，t=0 取 a，t=1 取 b */
export function mix(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  if (!x || !y) return normalizeHex(a) || '#000000';
  const k = clamp(t, 0, 1);
  return rgbToHex(
    x[0] + (y[0] - x[0]) * k,
    x[1] + (y[1] - x[1]) * k,
    x[2] + (y[2] - x[2]) * k
  );
}

/** 相对亮度（0-1，WCAG 公式）：决定这个底色上该用黑字还是白字 */
export function luminance(hex) {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const f = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

export function isLight(hex) {
  return luminance(hex) >= 0.5;
}

/** 这个底色上该配的文字颜色（给自定义色上的标签用） */
export function inkOn(hex) {
  return isLight(hex) ? '#17201a' : '#f2f5f3';
}

/**
 * 深色模式下的同款变体：保留色相、饱和度压一档、亮度压到很暗。
 * 和预设的 darkCss 同理 —— 深色下换背景必须看得出换了，
 * 一刀切 #121513 会让"换背景"这个功能在深色下直接失效。
 */
export function darkVariant(hex, level) {
  const c = hexToHsl(hex);
  const l = typeof level === 'number' ? clamp(level, 4, 24) : 11;
  return hslToHex(c.h, Math.min(c.s, 46), l);
}
