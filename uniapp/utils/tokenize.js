// 英文句子的「单词 / 标点」分词：practice.vue（题干/答案/选项点读）与
// sentence-detail.vue（收藏例句详情）共用，保证两处分词与点读行为完全一致。
// 弯撇号统一为直撇号，保证与查词 / 发音时的清洗一致。

// 将英文句子拆分为"单词 / 标点"片段，单词片段（w=true）可点击
export function tokenize(text) {
  return String(text || '')
    .split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/g)
    .filter(p => p !== '')
    .map(p => ({
      t: /^[A-Za-z]/.test(p) ? p.replace(/[’‘`]/g, "'") : p,
      w: /^[A-Za-z]/.test(p)
    }))
}

// 是否英文（不含中文才按英文分词点读，中文整段渲染）
export function isEnglish(text) {
  return !/[\u4e00-\u9fa5]/.test(String(text || ''))
}
