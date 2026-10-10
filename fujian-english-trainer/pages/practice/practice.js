const engine = require('../../utils/engine');
const judge = require('../../utils/judge');
const tts = require('../../utils/tts');
const { WORDS } = require('../../data/words');

// 单词 -> 考纲词条 映射（点读时查词义用）
const WORD_MAP = {};
WORDS.forEach(w => { WORD_MAP[w.w.toLowerCase()] = w; });

// 将英文句子拆分为"单词 / 标点"片段，单词片段可点击
function tokenize(text) {
  return text
    .split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/g)
    .filter(p => p !== '')
    .map(p => ({ t: p, w: /^[A-Za-z]/.test(p) }));
}

function isEnglish(text) {
  return !/[\u4e00-\u9fa5]/.test(text);
}

Page({
  data: {
    labels: ['A', 'B', 'C', 'D'],
    source: 'daily',        // daily 每日练习 | review 错题重练
    questions: [],
    idx: 0,
    q: null,
    options: [],
    mode: 'choice',         // choice 选择题 | input 手动输入
    selected: -1,
    input: '',
    canSubmit: false,       // 提交按钮可用状态（在 JS 中计算，修复 WXML 不支持 .trim() 的 bug）
    answered: false,
    result: null,           // {pass, partial, score}
    userAnswer: '',
    correctCount: 0,
    accuracy: 0,
    finished: false,
    empty: false,
    emptyText: '',
    // 点读相关
    promptIsEn: false,
    promptTokens: [],
    answerIsEn: false,
    answerTokens: [],
    pop: { show: false, word: '', pos: '', meaning: '' }
  },

  onLoad(opt) {
    this.start(opt && opt.source === 'review' ? 'review' : 'daily');
  },

  onHide() { tts.stop(); },
  onUnload() { tts.stop(); },

  start(source) {
    const qs = source === 'review' ? engine.reviewQuestions() : engine.dailyQuestions(10);
    if (!qs.length) {
      this.setData({
        empty: true,
        finished: false,
        emptyText: source === 'review' ? '太棒了，当前没有错题！' : '暂时没有可练习的题目'
      });
      return;
    }
    this.setData({ source, questions: qs, correctCount: 0, accuracy: 0, finished: false, empty: false });
    this.setupQuestion(0);
  },

  setupQuestion(i) {
    const q = this.data.questions[i];
    const promptIsEn = isEnglish(q.prompt);
    const answerIsEn = isEnglish(q.answer);
    this.setData({
      idx: i, q, options: q.options,
      mode: 'choice', selected: -1, input: '', canSubmit: false,
      answered: false, result: null, userAnswer: '',
      promptIsEn: promptIsEn,
      promptTokens: promptIsEn ? tokenize(q.prompt) : [],
      answerIsEn: answerIsEn,
      answerTokens: answerIsEn ? tokenize(q.answer) : [],
      pop: { show: false, word: '', pos: '', meaning: '' }
    });
    // 题目加载后自动朗读题干
    tts.speak(q.prompt);
  },

  switchMode(e) {
    if (this.data.answered) return;
    this.setData({ mode: e.currentTarget.dataset.m });
  },

  // 选择题作答
  choose(e) {
    if (this.data.answered) return;
    const sel = Number(e.currentTarget.dataset.i);
    const pass = sel === this.data.q.answerIndex;
    this.setData({ selected: sel });
    this.finish(pass ? 'pass' : 'fail', pass ? 1 : 0, this.data.q.options[sel]);
  },

  onInput(e) {
    const v = e.detail.value;
    // 修复点：是否可提交在 JS 中判断（WXML 表达式不支持 .trim() 方法调用）
    this.setData({ input: v, canSubmit: !!v.trim() });
  },

  // 手动输入作答
  submitInput() {
    if (this.data.answered || !this.data.input.trim()) return;
    const q = this.data.q;
    const r = q.dir === 'e2c'
      ? judge.judgeZh(this.data.input, q.answer)
      : judge.judgeEn(this.data.input, q.answer);
    const status = r.pass ? 'pass' : (r.partial ? 'partial' : 'fail');
    this.finish(status, r.score, this.data.input.trim());
  },

  finish(status, score, userAnswer) {
    engine.recordAnswer(this.data.q, status, this.data.mode, userAnswer);
    const correctCount = this.data.correctCount + (status === 'pass' ? 1 : 0);
    this.setData({
      answered: true,
      userAnswer: userAnswer,
      result: {
        pass: status === 'pass',
        partial: status === 'partial',
        score: Math.round(score * 100)
      },
      correctCount: correctCount,
      accuracy: Math.round((correctCount / this.data.questions.length) * 100)
    });
    // 作答后朗读参考答案，强化记忆
    setTimeout(() => tts.speak(this.data.q.answer), 400);
  },

  // ---------- 点读 ----------
  tapWord(e) {
    const { w, isw } = e.currentTarget.dataset;
    if (!isw) return;
    const word = (w || '').toLowerCase().replace(/[^a-z'-]/g, '');
    if (!word) return;
    const entry = WORD_MAP[word];
    this.setData({
      pop: {
        show: true,
        word: w,
        pos: entry ? entry.pos : '',
        meaning: entry ? entry.m : ''
      }
    });
    tts.speak(word, 'en');
  },

  closePop() {
    this.setData({ pop: { show: false, word: '', pos: '', meaning: '' } });
  },

  noop() {},

  // 重听按钮（题干 / 参考答案 / 弹窗单词共用）
  replay(e) {
    tts.speak(e.currentTarget.dataset.text);
  },

  next() {
    const n = this.data.idx + 1;
    if (n >= this.data.questions.length) {
      tts.stop();
      this.setData({ finished: true });
    } else {
      this.setupQuestion(n);
    }
  },

  restart() {
    this.start('daily');
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/home' });
  }
});
