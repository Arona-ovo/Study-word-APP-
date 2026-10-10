// LocalRepository（SQLite 实现）
//
// 只被 repositories/index.ts 实例化；业务层永远拿接口、拿不到这个类。
// 规则：
//   · 主键 uuid，不出现自增 id
//   · 查询默认带 is_deleted = 0
//   · update 自动刷新 updated_at + 标 pending；markSynced 只改 sync_status
//   · 删除一律 buildSoftDelete
import * as sqlite from '../db/sqlite.ts';
import { buildInsert, buildUpdate, buildSoftDelete, esc, notDeleted } from '../db/sql.ts';
import { uuid as newUuid } from '../utils/uuid.ts';
import { now } from '../utils/time.ts';
import {
  asRow, normalizeUsername,
  type UserRow, type StudyRecordRow, type WordFavoriteRow,
  type UserRepository, type StudyRecordRepository, type WordFavoriteRepository,
  type CreateUserInput, type PatchUser,
  type CreateStudyRecord, type PatchStudyRecord,
  type CreateWordFavorite, type PatchWordFavorite,
  type ListOptions, type SyncStatus
} from './types.ts';

function limitSql(opts?: ListOptions): string {
  const limit = opts && opts.limit ? Math.max(1, Math.floor(opts.limit)) : 0;
  const offset = opts && opts.offset ? Math.max(0, Math.floor(opts.offset)) : 0;
  return (limit ? ' LIMIT ' + limit : '') + (offset ? ' OFFSET ' + offset : '');
}

/* ============================ users ============================ */

export class SqliteUserRepository implements UserRepository {
  readonly tableName = 'users';

  async create(input: CreateUserInput): Promise<UserRow> {
    const t = now();
    const id = newUuid();
    const row: any = {
      uuid: id,
      user_id: id,                                  // 用户自身的归属就是自己
      username: normalizeUsername(input.username),
      password_hash: input.password_hash,
      nickname: input.nickname || input.username || '',
      avatar: input.avatar || '',
      created_at: t,
      updated_at: t,
      last_login_at: 0,
      is_deleted: 0,
      sync_status: 'pending'
    };
    await sqlite.exec(buildInsert('users', row));
    return asRow<UserRow>(row) as UserRow;
  }

  async findByUuid(uuidValue: string): Promise<UserRow | null> {
    const rows = await sqlite.select<UserRow>(
      'SELECT * FROM users WHERE uuid = ' + esc(uuidValue) + ' AND ' + notDeleted() + ' LIMIT 1'
    );
    return asRow<UserRow>(rows[0]);
  }

  async findByUsername(username: string): Promise<UserRow | null> {
    const rows = await sqlite.select<UserRow>(
      'SELECT * FROM users WHERE username = ' + esc(normalizeUsername(username)) + ' AND ' + notDeleted() + ' LIMIT 1'
    );
    return asRow<UserRow>(rows[0]);
  }

  async update(uuidValue: string, patch: PatchUser): Promise<UserRow | null> {
    const cur = await this.findByUuid(uuidValue);
    if (!cur) return null;
    const sets: any = Object.assign({}, patch, {
      updated_at: now(),
      sync_status: 'pending' as SyncStatus
    });
    await sqlite.exec(buildUpdate('users', uuidValue, sets));
    return this.findByUuid(uuidValue);
  }

  async softDelete(uuidValue: string): Promise<boolean> {
    const cur = await this.findByUuid(uuidValue);
    if (!cur) return false;
    await sqlite.exec(buildSoftDelete('users', uuidValue, now()));
    return true;
  }

  async list(opts?: ListOptions): Promise<UserRow[]> {
    const rows = await sqlite.select<UserRow>(
      'SELECT * FROM users WHERE ' + notDeleted() + ' ORDER BY created_at DESC' + limitSql(opts)
    );
    return rows.map((r) => asRow<UserRow>(r)).filter(Boolean) as UserRow[];
  }

  async findPendingSync(limit = 100): Promise<UserRow[]> {
    const rows = await sqlite.select<UserRow>(
      "SELECT * FROM users WHERE is_deleted = 0 AND sync_status = 'pending' ORDER BY updated_at ASC" + limitSql({ limit })
    );
    return rows.map((r) => asRow<UserRow>(r)).filter(Boolean) as UserRow[];
  }

  async markSynced(uuids: string[], status: SyncStatus = 'synced'): Promise<number> {
    const ids = (uuids || []).filter(Boolean);
    if (!ids.length) return 0;
    await sqlite.exec(
      'UPDATE users SET `sync_status` = ' + esc(status) +
      ' WHERE uuid IN (' + ids.map((u) => esc(u)).join(', ') + ')'
    );
    return ids.length;
  }
}

/* ========================= study_records ========================= */

export class SqliteStudyRecordRepository implements StudyRecordRepository {
  readonly tableName = 'study_records';

  private async one(sql: string): Promise<StudyRecordRow | null> {
    const rows = await sqlite.select<StudyRecordRow>(sql);
    return asRow<StudyRecordRow>(rows[0]);
  }

  async create(input: CreateStudyRecord): Promise<StudyRecordRow> {
    const t = now();
    const id = newUuid();
    const row: any = {
      uuid: id,
      user_id: input.user_id,
      book_id: input.book_id || '',
      word_id: input.word_id || '',
      sentence_id: input.sentence_id || '',
      direction: input.direction || '',
      mode: input.mode || '',
      result: input.result || '',
      score: Number(input.score) || 0,
      user_answer: input.user_answer || '',
      reference: input.reference || '',
      practiced_at: Number(input.practiced_at) || t,
      created_at: t,
      updated_at: t,
      is_deleted: 0,
      sync_status: 'pending'
    };
    await sqlite.exec(buildInsert('study_records', row));
    return asRow<StudyRecordRow>(row) as StudyRecordRow;
  }

  async findByUuid(uuidValue: string): Promise<StudyRecordRow | null> {
    return this.one(
      'SELECT * FROM study_records WHERE uuid = ' + esc(uuidValue) + ' AND ' + notDeleted() + ' LIMIT 1'
    );
  }

  async update(uuidValue: string, patch: PatchStudyRecord): Promise<StudyRecordRow | null> {
    if (!(await this.findByUuid(uuidValue))) return null;
    const sets: any = Object.assign({}, patch, { updated_at: now(), sync_status: 'pending' as SyncStatus });
    await sqlite.exec(buildUpdate('study_records', uuidValue, sets));
    return this.findByUuid(uuidValue);
  }

  async softDelete(uuidValue: string): Promise<boolean> {
    if (!(await this.findByUuid(uuidValue))) return false;
    await sqlite.exec(buildSoftDelete('study_records', uuidValue, now()));
    return true;
  }

  async listByUser(userId: string, opts?: ListOptions): Promise<StudyRecordRow[]> {
    let sql =
      'SELECT * FROM study_records WHERE user_id = ' + esc(userId) + ' AND ' + notDeleted();
    if (opts && opts.since) sql += ' AND updated_at >= ' + Math.floor(opts.since);
    sql += ' ORDER BY practiced_at DESC' + limitSql(opts);
    const rows = await sqlite.select<StudyRecordRow>(sql);
    return rows.map((r) => asRow<StudyRecordRow>(r)).filter(Boolean) as StudyRecordRow[];
  }

  async findPendingSync(userId: string, limit = 100): Promise<StudyRecordRow[]> {
    const rows = await sqlite.select<StudyRecordRow>(
      "SELECT * FROM study_records WHERE user_id = " + esc(userId) +
      " AND is_deleted = 0 AND sync_status = 'pending' ORDER BY updated_at ASC" + limitSql({ limit })
    );
    return rows.map((r) => asRow<StudyRecordRow>(r)).filter(Boolean) as StudyRecordRow[];
  }

  async markSynced(uuids: string[], status: SyncStatus = 'synced'): Promise<number> {
    const ids = (uuids || []).filter(Boolean);
    if (!ids.length) return 0;
    await sqlite.exec(
      'UPDATE study_records SET `sync_status` = ' + esc(status) +
      ' WHERE uuid IN (' + ids.map((u) => esc(u)).join(', ') + ')'
    );
    return ids.length;
  }
}

/* ========================= word_favorite ========================= */

export class SqliteWordFavoriteRepository implements WordFavoriteRepository {
  readonly tableName = 'word_favorite';

  private async one(sql: string): Promise<WordFavoriteRow | null> {
    const rows = await sqlite.select<WordFavoriteRow>(sql);
    return asRow<WordFavoriteRow>(rows[0]);
  }

  async create(input: CreateWordFavorite): Promise<WordFavoriteRow> {
    const t = now();
    const id = newUuid();
    const row: any = {
      uuid: id,
      user_id: input.user_id,
      ref_type: input.ref_type || 'word',
      ref_id: input.ref_id || '',
      word: input.word || '',
      meaning: input.meaning || '',
      en: input.en || '',
      zh: input.zh || '',
      created_at: t,
      updated_at: t,
      is_deleted: 0,
      sync_status: 'pending'
    };
    await sqlite.exec(buildInsert('word_favorite', row));
    return asRow<WordFavoriteRow>(row) as WordFavoriteRow;
  }

  async findByUuid(uuidValue: string): Promise<WordFavoriteRow | null> {
    return this.one(
      'SELECT * FROM word_favorite WHERE uuid = ' + esc(uuidValue) + ' AND ' + notDeleted() + ' LIMIT 1'
    );
  }

  async findByRef(userId: string, refType: string, refId: string): Promise<WordFavoriteRow | null> {
    return this.one(
      'SELECT * FROM word_favorite WHERE user_id = ' + esc(userId) +
      ' AND ref_type = ' + esc(refType) +
      ' AND ref_id = ' + esc(refId) +
      ' AND ' + notDeleted() + ' LIMIT 1'
    );
  }

  // 有则更新（软删除过的行直接复活），无则新建 —— 收藏/取消收藏来回切时不留垃圾行
  async upsert(input: CreateWordFavorite): Promise<WordFavoriteRow> {
    const rows = await sqlite.select<WordFavoriteRow>(
      'SELECT * FROM word_favorite WHERE user_id = ' + esc(input.user_id) +
      ' AND ref_type = ' + esc(input.ref_type || 'word') +
      ' AND ref_id = ' + esc(input.ref_id || '') + ' LIMIT 1'
    );
    const exist = asRow<WordFavoriteRow>(rows[0]);
    if (!exist) return this.create(input);
    await sqlite.exec(buildUpdate('word_favorite', exist.uuid, {
      word: input.word || '',
      meaning: input.meaning || '',
      en: input.en || '',
      zh: input.zh || '',
      is_deleted: 0,
      updated_at: now(),
      sync_status: 'pending' as SyncStatus
    }));
    return (await this.findByUuid(exist.uuid)) as WordFavoriteRow;
  }

  async update(uuidValue: string, patch: PatchWordFavorite): Promise<WordFavoriteRow | null> {
    if (!(await this.findByUuid(uuidValue))) return null;
    const sets: any = Object.assign({}, patch, { updated_at: now(), sync_status: 'pending' as SyncStatus });
    await sqlite.exec(buildUpdate('word_favorite', uuidValue, sets));
    return this.findByUuid(uuidValue);
  }

  async softDelete(uuidValue: string): Promise<boolean> {
    if (!(await this.findByUuid(uuidValue))) return false;
    await sqlite.exec(buildSoftDelete('word_favorite', uuidValue, now()));
    return true;
  }

  async listByUser(userId: string, opts?: ListOptions): Promise<WordFavoriteRow[]> {
    let sql = 'SELECT * FROM word_favorite WHERE user_id = ' + esc(userId) + ' AND ' + notDeleted();
    if (opts && opts.since) sql += ' AND updated_at >= ' + Math.floor(opts.since);
    sql += ' ORDER BY created_at DESC' + limitSql(opts);
    const rows = await sqlite.select<WordFavoriteRow>(sql);
    return rows.map((r) => asRow<WordFavoriteRow>(r)).filter(Boolean) as WordFavoriteRow[];
  }

  async findPendingSync(userId: string, limit = 100): Promise<WordFavoriteRow[]> {
    const rows = await sqlite.select<WordFavoriteRow>(
      "SELECT * FROM word_favorite WHERE user_id = " + esc(userId) +
      " AND is_deleted = 0 AND sync_status = 'pending' ORDER BY updated_at ASC" + limitSql({ limit })
    );
    return rows.map((r) => asRow<WordFavoriteRow>(r)).filter(Boolean) as WordFavoriteRow[];
  }

  async markSynced(uuids: string[], status: SyncStatus = 'synced'): Promise<number> {
    const ids = (uuids || []).filter(Boolean);
    if (!ids.length) return 0;
    await sqlite.exec(
      'UPDATE word_favorite SET `sync_status` = ' + esc(status) +
      ' WHERE uuid IN (' + ids.map((u) => esc(u)).join(', ') + ')'
    );
    return ids.length;
  }
}
