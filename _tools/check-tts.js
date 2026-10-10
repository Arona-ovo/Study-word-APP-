// _tools/check-tts.js - 语音供给链逻辑校验（只读，不联网）
// 场景：① 原生可用 → 整句一次播完、无 toast；② 原生失败 → 降级有道整句→逐词；③ 单词有道失败 → 兜底原生
const { load } = require('./lib/load');

// ---- mock uni ----
const toasts = [];
const audioLog = [];
const createLog = [];     // 记录 InnerAudioContext 的创建顺序（含预连接）
let audioMode = 'fail';   // 'fail' | 'ok' | 'all-fail'
let hangAt = 0;           // 第 N 次 play() 挂起（既不结束也不报错）；0 = 不挂
let played = 0;
global.uni = {
  showToast: (o) => { toasts.push(o.title) },
  createInnerAudioContext: () => {
    createLog.push('ctx');
    const ctx = {
      src: '',
      _ended: null,
      _error: null,
      onEnded(cb) { ctx._ended = cb },
      onError(cb) { ctx._error = cb },
      play() {
        audioLog.push(ctx.src);
        played++;
        if (hangAt && played === hangAt) return;  // 模拟"卡住"，用于观察预连接
        // 模拟：有道整句请求失败（HTTP 500），单词请求成功
        const isWhole = /%20|\+/.test(ctx.src);   // 有空格 = 整句请求
        const ok = audioMode === 'ok' || (audioMode === 'fail' && !isWhole);
        if (ok) {
          if (ctx._ended) setTimeout(() => ctx._ended(), 0);
        } else if (ctx._error) {
          setTimeout(() => ctx._error({ errCode: -1 }), 0);
        }
      },
      stop() {},
      destroy() {}
    };
    return ctx;
  }
};

// ---- mock window.speechSynthesis（H5 provider） ----
let webMode = 'ok';   // 'ok' | 'fail'
const webLog = [];
global.window = {
  speechSynthesis: {
    speaking: false,
    pending: false,
    getVoices: () => [{ lang: 'en-US', localService: true }],
    cancel() {},
    speak(u) {
      webLog.push(String(u.text));
      if (webMode === 'ok') { if (u.onend) setTimeout(() => u.onend(), 0) }
      else { if (u.onerror) setTimeout(() => u.onerror({ error: 'synthesis-failed' }), 0) }
    }
  },
  SpeechSynthesisUtterance: function (text) { this.text = text }
};
global.document = { addEventListener() {} };

// 设置（整句朗读引擎偏好），由 tts.js 读取
const store = {};
const settingsStub = {
  get: () => ({ voice: Object.assign({ engine: enginePref, speed: 1.0 }, {}) }),
  set() {}
};
let enginePref = 'auto';

const webTts = load('utils/tts-web.js');
const nativeStub = { name: 'stub-native', warmup() {}, speak() {}, stop() {}, isAvailable: () => false, isSpeaking: () => false };
const tts = load('utils/tts.js', { nativeTts: nativeStub, webTts, settings: settingsStub });

let fail = 0;
function bad(m) { fail++; console.error('  ✗ ' + m) }
function good(m) { console.log('  ✓ ' + m) }

function reset() {
  toasts.length = 0; audioLog.length = 0; webLog.length = 0; createLog.length = 0;
  hangAt = 0; played = 0;
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('— 场景 1：原生可用，整句应走原生（没有网络请求）—');
  reset();
  webMode = 'ok';
  let done1 = false;
  tts.speakSentence('We should protect the environment for our children.', { onDone: () => { done1 = true } });
  await wait(120);
  if (webLog.length === 1) good('原生 TTS 播了 1 次整句：' + JSON.stringify(webLog[0].slice(0, 30) + '…'));
  else bad('原生未被调用，webLog=' + JSON.stringify(webLog));
  if (audioLog.length === 0) good('没有产生有道网络请求（整句不再逐词）');
  else bad('仍走了有道：' + audioLog.length + ' 个请求');
  if (done1) good('onDone 已回调');
  else bad('onDone 未回调');
  if (toasts.length === 0) good('无失败 toast');
  else bad('出现 toast：' + JSON.stringify(toasts));

  console.log('— 场景 2：原生失败，应降级"有道整句 → 逐词" —');
  reset();
  webMode = 'fail';
  let done2 = false;
  tts.speakSentence('We should protect the environment for our children.', { onDone: () => { done2 = true } });
  await wait(2000);
  if (webLog.length >= 1) good('先尝试了原生（' + webLog.length + ' 次）');
  else bad('没有尝试原生');
  if (audioLog.length > 1) good('降级后逐词播放了 ' + audioLog.length + ' 个单元');
  else bad('未降级到有道逐词：audioLog=' + audioLog.length);
  if (done2) good('onDone 已回调');
  else bad('onDone 未回调');

  console.log('— 场景 3：单词点读，有道失败 → 兜底原生 —');
  reset();
  audioMode = 'all-fail';   // 有道单词也失败
  webMode = 'ok';
  let done3 = false;
  tts.speakWord('improve', { onDone: () => { done3 = true } });
  await wait(300);
  if (audioLog.length >= 1) good('先走了有道单词（' + audioLog.length + ' 次）');
  else bad('没有走有道');
  if (webLog.length >= 1) good('有道失败后兜底原生：' + JSON.stringify(webLog));
  else bad('未兜底原生');
  if (toasts.length === 0) good('兜底成功，无 toast');
  else bad('出现 toast：' + JSON.stringify(toasts));
  if (done3) good('onDone 已回调');
  else bad('onDone 未回调');

  console.log('— 场景 4：stop() 应同时停原生与有道 —');
  reset();
  webMode = 'ok';
  let cancelled = false;
  tts.speakSentence('Practice is the key to improving your English.', { onDone: (r) => { cancelled = !!(r && r.cancelled) } });
  tts.stop();
  await wait(50);
  if (cancelled) good('stop() 触发 cancelled 回调');
  else bad('stop() 未触发 cancelled');
  if (tts.isPlaying() === false) good('isPlaying() = false');
  else bad('isPlaying() 仍为 true');

  console.log('— 场景 5：逐词降级时会预连接下一个单元（消除单元间的网络等待）—');
  reset();
  webMode = 'fail';      // 原生不可用 → 走有道
  audioMode = 'fail';    // 有道整句失败 → 逐词
  hangAt = 2;            // 第 1 次 play = 有道整句（正常失败）→ 逐词；第 2 次 play = 第 1 个词（卡住）
  tts.speakSentence('We should protect the environment for our children.');
  await wait(120);
  // 创建顺序：整句(1) + 当前单元(1) + 预连接的下一个单元(1) = 至少 3 个
  if (createLog.length >= 3) good('已预连接下一个单元（ctx 创建数 = ' + createLog.length + '）');
  else bad('没有预连接，单元之间会有一次网络往返（ctx 创建数 = ' + createLog.length + '）');
  if (audioLog.length === 2) good('只有整句与第 1 个词在播，预连接那个不出声');
  else bad('预连接被误播放：audioLog=' + audioLog.length);

  console.log('— 场景 6：engine=online → 完全不走系统语音 —');
  reset();
  enginePref = 'online';
  webMode = 'ok';
  tts.speakSentence('We should protect the environment for our children.');
  await wait(80);
  if (webLog.length === 0) good('未调用系统语音');
  else bad('仍调用了系统语音：' + JSON.stringify(webLog));
  if (audioLog.length >= 1) good('直接走在线发音（' + audioLog.length + ' 个请求）');
  else bad('没有走在线发音');

  console.log('— 场景 7：engine=native → 系统语音不可用时宁可不念，也不逐词念 —');
  reset();
  enginePref = 'native';
  webMode = 'fail';
  let done7 = false;
  tts.speakSentence('We should protect the environment for our children.', { onDone: () => { done7 = true } });
  await wait(120);
  if (audioLog.length === 0) good('没有退化成逐词连读（audioLog 为空）');
  else bad('仍在逐词念：' + audioLog.length + ' 个请求');
  if (done7) good('onDone 已回调（上层可据此提示）');
  else bad('onDone 未回调');
  if (toasts.length === 1) good('提示了一次"发音不可用"');
  else bad('toast 数量异常：' + JSON.stringify(toasts));
  enginePref = 'auto';

  console.log('— status() —');
  console.log('  ' + JSON.stringify(tts.status()));

  console.log(fail === 0 ? '\n全部通过' : '\n失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1) });
