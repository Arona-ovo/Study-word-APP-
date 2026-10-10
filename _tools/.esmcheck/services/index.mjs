// services/index.js - 统一服务层门面
// 页面只从这里 import：import { ai } from '../../services/index.mjs'
// 注意：为兼容 HBuilderX(Vite) 编译链的互操作，本文件只用具名导入/导出，
//       不要用「namespace 再导出」（export { ns } 形式曾导致 ai 成员在 H5 端丢失）。
import * as llm from './llm.mjs';
import * as voice from './voice.mjs';
import * as config from './config.mjs';
import { explainWord, critiqueTranslation, generateDrill, tutorSystemPrompt, chat as chatTutor, validateKeyFormat, testAIConnection } from './ai-content.mjs';
import { ServiceError } from './http.mjs';
import { LLMError } from './llm.mjs';

export const ai = {
  // 基础能力
  chat: llm.chatCompletion,
  complete: llm.complete,
  speak: voice.speak,
  speakWord: voice.speakWord,
  speakSentence: voice.speakSentence,
  speakAuto: voice.speakAuto,
  stop: voice.stop,
  warmup: voice.warmup,
  isAIEnabled: config.isAIEnabled,
  aiGateReason: config.aiGateReason,
  isAIUsable: config.isAIUsable,
  getAIConfig: config.getAIConfig,
  getVoicePrefs: config.getVoicePrefs,
  // AI 内容能力
  explainWord,
  critiqueTranslation,
  generateDrill,
  tutorSystemPrompt,
  chatTutor,
  validateKeyFormat,
  testAIConnection
};

export { llm, voice, config, ServiceError, LLMError };
