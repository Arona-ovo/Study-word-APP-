// utils/sfx.js - 答题音效（正确 / 半对 / 错误）
//
// 三个 wav 由 _tools/gen-sfx.py 合成（正弦叠谐波 + 指数衰减，钟琴感），
// 随包分发：没有版权问题，也不需要联网 —— 断网时反馈依旧完整。
//
// 三条硬规矩：
//   1) 每次播放新建 InnerAudioContext、播完立即 destroy。
//      复用实例切 src 在部分安卓机上会报 -99（utils/tts.js 已经是这个做法）。
//   2) 同时只存在一个实例：新的先掐掉旧的，连点不会叠成噪音。
//   3) 跟着设置里的开关走，关掉就是彻底静音（连实例都不创建）。
import * as settings from './settings.js';

const FILES = {
  correct: 'correct',
  pass: 'correct',
  partial: 'partial',
  wrong: 'wrong',
  fail: 'wrong'
};

// 各音效时长（ms）：供调用方安排"音效之后再朗读"，避免两种声音叠在一起
const DURATION = { correct: 400, partial: 200, wrong: 380 };

const MIN_GAP = 80;    // 连点保护：这么短的时间内的重复触发直接丢掉

let current = null;
let lastAt = 0;

function srcOf(name) {
  const p = '/static/sfx/' + name + '.wav';
  // App(plus) 端要把应用内资源路径转成本地文件系统路径才播得出来
  // #ifdef APP-PLUS
  if (typeof plus !== 'undefined' && plus.io && plus.io.convertLocalFileSystemURL) {
    try {
      return plus.io.convertLocalFileSystemURL('_www' + p);
    } catch (e) { /* 转换失败就用原路径 */ }
  }
  // #endif
  return p;
}

/** 音效开关（设置 › 朗读与音效） */
export function isEnabled() {
  try {
    return !!(settings.get() && settings.get().voice && settings.get().voice.sfx !== false);
  } catch (e) {
    return true;
  }
}

export function durationOf(kind) {
  return DURATION[kind] || DURATION[FILES[kind]] || 400;
}

function kill() {
  if (!current) return;
  const c = current;
  current = null;
  try { c.stop(); } catch (e) {}
  try { c.destroy(); } catch (e) {}
}

export function stop() {
  kill();
}

/**
 * 播一条答题音效。
 * @param {'correct'|'partial'|'wrong'|'pass'|'fail'} kind
 * @returns {boolean} 是否真的播了（关掉开关 / 连点 / 平台不支持都会返回 false）
 */
export function play(kind) {
  if (!isEnabled()) return false;
  const name = FILES[kind];
  if (!name) return false;

  const now = Date.now();
  if (now - lastAt < MIN_GAP) return false;
  lastAt = now;

  kill();
  let ctx = null;
  try {
    ctx = uni.createInnerAudioContext();
  } catch (e) {
    return false;
  }
  current = ctx;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (current === ctx) current = null;
    try { ctx.destroy(); } catch (e) {}
  };
  ctx.onEnded(finish);
  ctx.onError(finish);
  ctx.onStop(finish);
  ctx.src = srcOf(name);
  try {
    ctx.play();
  } catch (e) {
    finish();
    return false;
  }
  return true;
}
