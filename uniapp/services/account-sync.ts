// 账号数据桥接：把"已有功能"产生的数据写到 Repository 里（仅登录后）
//
// 未登录时这里所有函数都是空操作 —— 现有行为 100% 不变；
// 登录后：收藏会镜像到 word_favorite 表，答题会写 study_records 表，
// 未来接云同步时这三张表就是同步的数据源。
//
// 注意：收藏列表的"展示"仍然读 settings（本地优先、零延迟），
// 这里的镜像是给账号维度留的一份带 user_id / 软删除 / 同步状态的正式数据。
import { getRepositories } from '../repositories/index.ts';
import { isLoggedIn, currentUserId } from './auth.ts';

function uid(): string {
  return isLoggedIn() ? currentUserId() : '';
}

/** 收藏：有则更新（含复活软删除行），无则新建 */
export async function mirrorFavorite(item: any): Promise<void> {
  const userId = uid();
  if (!userId || !item || !item.type) return;
  try {
    const r = getRepositories();
    await r.wordFavorites.upsert({
      user_id: userId,
      ref_type: item.type === 'sentence' ? 'sentence' : 'word',
      ref_id: String(item.id || ''),
      word: item.word || '',
      meaning: item.meaning || '',
      en: item.en || '',
      zh: item.zh || ''
    });
  } catch (e) {
    /* 镜像失败不影响本地收藏 */
  }
}

/** 取消收藏：软删除（is_deleted = 1），不物理删除 */
export async function unmirrorFavorite(type: string, id: string): Promise<void> {
  const userId = uid();
  if (!userId || !id) return;
  try {
    const r = getRepositories();
    const row = await r.wordFavorites.findByRef(userId, type === 'sentence' ? 'sentence' : 'word', String(id));
    if (row) await r.wordFavorites.softDelete(row.uuid);
  } catch (e) {
    /* ignore */
  }
}

/** 登录成功后：把本地已有的收藏一次性导入账号维度 */
export async function importFavorites(list: any[]): Promise<number> {
  const userId = uid();
  if (!userId || !Array.isArray(list) || !list.length) return 0;
  let n = 0;
  try {
    const r = getRepositories();
    for (const item of list) {
      if (!item || !item.type) continue;
      await r.wordFavorites.upsert({
        user_id: userId,
        ref_type: item.type === 'sentence' ? 'sentence' : 'word',
        ref_id: String(item.id || ''),
        word: item.word || '',
        meaning: item.meaning || '',
        en: item.en || '',
        zh: item.zh || ''
      });
      n++;
    }
  } catch (e) {
    /* ignore */
  }
  return n;
}

/** 答题记录：每次作答写一行 study_records */
export async function recordStudy(row: {
  bookId?: string;
  wordId?: string;
  sentenceId?: string;
  direction?: string;
  mode?: string;
  result?: string;
  score?: number;
  userAnswer?: string;
  reference?: string;
}): Promise<void> {
  const userId = uid();
  if (!userId) return;
  try {
    const r = getRepositories();
    await r.studyRecords.create({
      user_id: userId,
      book_id: row.bookId || '',
      word_id: row.wordId || '',
      sentence_id: row.sentenceId || '',
      direction: row.direction || '',
      mode: row.mode || '',
      result: row.result || '',
      score: Number(row.score) || 0,
      user_answer: row.userAnswer || '',
      reference: row.reference || ''
    });
  } catch (e) {
    /* ignore */
  }
}

/** 给设置页展示：当前后端 + 各表条数（调试用，不参与业务） */
export async function stats(): Promise<{ backend: string; favorites: number; records: number }> {
  try {
    const r = getRepositories();
    const userId = uid();
    const favs = userId ? await r.wordFavorites.listByUser(userId, { limit: 1000 }) : [];
    const recs = userId ? await r.studyRecords.listByUser(userId, { limit: 1000 }) : [];
    return { backend: r.backend, favorites: favs.length, records: recs.length };
  } catch (e) {
    return { backend: 'kv', favorites: 0, records: 0 };
  }
}
