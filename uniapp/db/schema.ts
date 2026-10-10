// 建表 SQL（SQLite，uni-app App 端 plus.sqlite）
//
// 约定（所有业务表统一）：
//   uuid          TEXT 主键，**禁止自增 id**，便于未来多端合并与云同步
//   user_id       TEXT 归属用户（users 表自己的 user_id = 自己的 uuid）
//   created_at    INTEGER 毫秒
//   updated_at    INTEGER 毫秒，每次修改由 Repository 自动刷新
//   is_deleted    INTEGER 0/1，软删除，禁止物理 DELETE
//   sync_status   TEXT  'pending' | 'synced' | 'conflict' | 'none'（本期纯本地，字段先预留）
//
// 注意：Android 端 plus.sqlite 不支持用 ";" 拼多条语句，必须逐条执行。

export const SCHEMA_VERSION = 1;

export const DB_NAME = 'beiwanci';
export const DB_PATH = '_doc/beiwanci.db';

export const TABLES = ['users', 'study_records', 'word_favorite'] as const;
export type TableName = typeof TABLES[number];

export const DDL: string[] = [
  // ---------- 本地用户表 ----------
  `CREATE TABLE IF NOT EXISTS users (
    uuid           TEXT    PRIMARY KEY NOT NULL,
    user_id        TEXT    NOT NULL,
    username       TEXT    NOT NULL,
    password_hash  TEXT    NOT NULL,
    nickname       TEXT    NOT NULL DEFAULT '',
    avatar         TEXT    NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    last_login_at  INTEGER NOT NULL DEFAULT 0,
    is_deleted     INTEGER NOT NULL DEFAULT 0,
    sync_status    TEXT    NOT NULL DEFAULT 'pending'
  )`,
  // ---------- 学习记录表 ----------
  `CREATE TABLE IF NOT EXISTS study_records (
    uuid            TEXT    PRIMARY KEY NOT NULL,
    user_id         TEXT    NOT NULL,
    book_id         TEXT    NOT NULL DEFAULT '',
    word_id         TEXT    NOT NULL DEFAULT '',
    sentence_id     TEXT    NOT NULL DEFAULT '',
    direction       TEXT    NOT NULL DEFAULT '',
    mode            TEXT    NOT NULL DEFAULT '',
    result          TEXT    NOT NULL DEFAULT '',
    score           INTEGER NOT NULL DEFAULT 0,
    user_answer     TEXT    NOT NULL DEFAULT '',
    reference       TEXT    NOT NULL DEFAULT '',
    practiced_at    INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    is_deleted      INTEGER NOT NULL DEFAULT 0,
    sync_status     TEXT    NOT NULL DEFAULT 'pending'
  )`,
  // ---------- 单词/例句收藏表 ----------
  `CREATE TABLE IF NOT EXISTS word_favorite (
    uuid         TEXT    PRIMARY KEY NOT NULL,
    user_id      TEXT    NOT NULL,
    ref_type     TEXT    NOT NULL DEFAULT 'word',
    ref_id       TEXT    NOT NULL,
    word         TEXT    NOT NULL DEFAULT '',
    meaning      TEXT    NOT NULL DEFAULT '',
    en           TEXT    NOT NULL DEFAULT '',
    zh           TEXT    NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    is_deleted   INTEGER NOT NULL DEFAULT 0,
    sync_status  TEXT    NOT NULL DEFAULT 'pending'
  )`
];

export const INDEXES: string[] = [
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)',
  'CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_study_user_time ON study_records(user_id, practiced_at)',
  'CREATE INDEX IF NOT EXISTS idx_study_sync ON study_records(user_id, sync_status)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_fav_user_ref ON word_favorite(user_id, ref_type, ref_id)',
  'CREATE INDEX IF NOT EXISTS idx_fav_sync ON word_favorite(user_id, sync_status)'
];

// 未来迁移写这里：export const MIGRATIONS: { from: number; to: number; sql: string[] }[] = []
export const MIGRATIONS: { from: number; to: number; sql: string[] }[] = [];

export function allSchemaSql(): string[] {
  return DDL.concat(INDEXES);
}
