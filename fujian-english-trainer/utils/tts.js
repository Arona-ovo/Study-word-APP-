// utils/tts.js - 文本转语音（单词/句子发音）
// 实现：InnerAudioContext 播放有道词典公开语音接口，无需后端、无需插件。
// 注意：正式发布需在小程序后台把 https://dict.youdao.com 加入 downloadFile 合法域名；
// 开发期在开发者工具勾选"不校验合法域名"即可；真机预览可在预览页右上角菜单打开"调试模式"。
let audioCtx = null;
let lastText = '';
let lastTime = 0;

function detectLang(text) {
  return /[\u4e00-\u9fa5]/.test(text) ? 'zh' : 'en';
}

function ttsUrl(text, lang) {
  const q = encodeURIComponent(text);
  return lang === 'zh'
    ? 'https://dict.youdao.com/dictvoice?le=zh&audio=' + q
    : 'https://dict.youdao.com/dictvoice?type=1&audio=' + q; // type=1 英音 type=2 美音
}

// 播放指定文本的发音；lang 可选 'en' | 'zh'，不传则自动判断
function speak(text, lang) {
  if (!text || !text.trim()) return;
  lang = lang || detectLang(text);

  // 同一内容 800ms 内不重复触发（防止快速连点）
  const now = Date.now();
  if (text === lastText && now - lastTime < 800) return;
  lastText = text;
  lastTime = now;

  if (!audioCtx) {
    audioCtx = wx.createInnerAudioContext();
    audioCtx.onError((err) => {
      console.warn('语音播放失败（真机需在预览菜单开启调试，或配置 downloadFile 域名）', err);
    });
  }
  audioCtx.stop(); // 打断上一段播放，实现"点哪个读哪个"
  audioCtx.src = ttsUrl(text, lang);
  audioCtx.play();
}

function stop() {
  if (audioCtx) audioCtx.stop();
}

module.exports = { speak, stop };
