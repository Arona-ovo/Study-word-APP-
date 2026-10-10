// Repository 抽象接口层
//
// 业务层（services/auth.ts 等）只认识这里的接口，永远不 import sqlite、不拼 SQL。
// 现在有两套实现：
//   LocalSqliteRepository（App 端，plus.sqlite）
//   LocalKvRepository    （无 sqlite 的环境：H5 预览 / 小程序，功能一致、仅性能不同）
// 未来加 CloudRepository 只需实现同一组接口，在 repositories/index.ts 里切换即可。

/** 同步状态（本期纯本地，字段与逻辑先预留） */
export type SyncStatus = 'none' | 'pending' | 'synced' | 'conflict';

/** 所有业务表的公共列：uuid 主键 + 归属 + 时间戳 + 软删除 + 同步状态 */
export interface BaseRow {
  uuid: string;
  user_id: string;
  created_at: number;
  updated_at: number;
  /** 0 未删除 / 1 已删除（软删除，禁止物理 DELETE） */
  is_deleted: number;
  sync_status: SyncStatus;
}

export interface UserRow extends BaseRow {
  username: string;
  /** 单向哈希（argon2id 优先，其次 PBKDF2），绝不出现明文 */
  password_hash: string;
  nickname: string;
  avatar: string;
  last_login_at: number;
}

export interface StudyRecordRow extends BaseRow {
  book_id: string;
  word_id: string;
  sentence_id: string;
  /** e2c 英译中 / c2e 中译英 */
  direction: string;
  /** choice 选择题 / input 手动输入 */
  mode: string;
  /** pass / partial / fail */
  result: string;
  score: number;
  user_answer: string;
  reference: string;
  practiced_at: number;
}

export interface WordFavoriteRow extends BaseRow {
  /** word 单词 / sentence 例句 */
  ref_type: string;
  ref_id: string;
  word: string;
  meaning: string;
  en: string;
  zh: string;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  /** 只取 updated_at >= since 的数据（增量同步预留） */
  since?: number;
}

/* ---------------- 入参 ---------------- */

export interface CreateUserInput {
  username: string;
  password_hash: string;
  nickname?: string;
  avatar?: string;
}

export interface PatchUser {
  nickname?: string;
  avatar?: string;
  password_hash?: string;
  last_login_at?: number;
}

export interface CreateStudyRecord {
  user_id: string;
  book_id?: string;
  word_id?: string;
  sentence_id?: string;
  direction?: string;
  mode?: string;
  result?: string;
  score?: number;
  user_answer?: string;
  reference?: string;
  practiced_at?: number;
}

export interface PatchStudyRecord {
  result?: string;
  score?: number;
  user_answer?: string;
  reference?: string;
  book_id?: string;
}

export interface CreateWordFavorite {
  user_id: string;
  ref_type: string;
  ref_id: string;
  word?: string;
  meaning?: string;
  en?: string;
  zh?: string;
}

export interface PatchWordFavorite {
  word?: string;
  meaning?: string;
  en?: string;
  zh?: string;
}

/* ---------------- 抽象接口 ---------------- */

/**
 * 通用仓储契约：所有业务表都遵守。
 * - 主键一律 uuid，禁止自增 id
 * - 删除一律软删除
 * - 每次修改自动刷新 updated_at 并把 sync_status 标为 pending
 */
export interface Repository<Row extends BaseRow, Create, Patch> {
  readonly tableName: string;
  create(input: Create): Promise<Row>;
  findByUuid(uuid: string): Promise<Row | null>;
  update(uuid: string, patch: Patch): Promise<Row | null>;
  /** 软删除：is_deleted = 1，返回是否命中 */
  softDelete(uuid: string): Promise<boolean>;
  listByUser(user_id: string, opts?: ListOptions): Promise<Row[]>;
  /** 待同步数据（云端接入后用） */
  findPendingSync(user_id: string, limit?: number): Promise<Row[]>;
  /** 标记同步结果；只改 sync_status，不刷新 updated_at（同步记账不算业务修改） */
  markSynced(uuids: string[], status?: SyncStatus): Promise<number>;
}

/** users 额外需要按用户名查找（登录用） */
export interface UserRepository {
  readonly tableName: string;
  create(input: CreateUserInput): Promise<UserRow>;
  findByUuid(uuid: string): Promise<UserRow | null>;
  findByUsername(username: string): Promise<UserRow | null>;
  update(uuid: string, patch: PatchUser): Promise<UserRow | null>;
  softDelete(uuid: string): Promise<boolean>;
  list(opts?: ListOptions): Promise<UserRow[]>;
  findPendingSync(limit?: number): Promise<UserRow[]>;
  markSynced(uuids: string[], status?: SyncStatus): Promise<number>;
}

export interface StudyRecordRepository
  extends Repository<StudyRecordRow, CreateStudyRecord, PatchStudyRecord> {}

export interface WordFavoriteRepository
  extends Repository<WordFavoriteRow, CreateWordFavorite, PatchWordFavorite> {
  /** 按 (user_id, ref_type, ref_id) 查，用于收藏去重 */
  findByRef(user_id: string, ref_type: string, ref_id: string): Promise<WordFavoriteRow | null>;
  /** 有则更新（并复活软删除行），无则新建 */
  upsert(input: CreateWordFavorite): Promise<WordFavoriteRow>;
}

/** 数据源：一组仓储 + 当前后端类型 */
export interface Repositories {
  readonly backend: 'sqlite' | 'kv';
  readonly users: UserRepository;
  readonly studyRecords: StudyRecordRepository;
  readonly wordFavorites: WordFavoriteRepository;
}

/** 用户名归一：去空白 + 转小写（登录与注册必须走同一函数，否则会判重失败） */
export function normalizeUsername(raw: string): string {
  return String(raw == null ? '' : raw).trim().toLowerCase();
}

/** SQLite 没有布尔/真 null 语义，读出来的行统一清洗一遍 */
export function asRow<T extends BaseRow>(raw: any): T | null {
  if (!raw || typeof raw !== 'object') return null;
  const r: any = Object.assign({}, raw);
  r.is_deleted = Number(r.is_deleted) ? 1 : 0;
  r.created_at = Number(r.created_at) || 0;
  r.updated_at = Number(r.updated_at) || 0;
  r.sync_status = (r.sync_status || 'pending') as SyncStatus;
  return r as T;
}
