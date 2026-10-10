// 极简 SQL 拼装（plus.sqlite 不支持绑定参数，只能拼字面量 → 所有值必须过 esc()）
// 只给 Repository 内部用，业务层永远不直接拼 SQL。

export type SqlValue = string | number | boolean | null | undefined;

export function esc(v: SqlValue): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  // 字符串：单引号转义 + 去掉控制字符（防 SQL 注入 / 断行注入）
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, '');
  return "'" + s.replace(/'/g, "''") + "'";
}

export function buildInsert(table: string, row: Record<string, SqlValue>): string {
  const keys: string[] = [];
  const vals: string[] = [];
  for (const k in row) {
    if (!Object.prototype.hasOwnProperty.call(row, k)) continue;
    keys.push('`' + k + '`');
    vals.push(esc(row[k]));
  }
  return 'INSERT INTO `' + table + '` (' + keys.join(', ') + ') VALUES (' + vals.join(', ') + ')';
}

export function buildUpdate(table: string, uuidValue: string, patch: Record<string, SqlValue>): string {
  const sets: string[] = [];
  for (const k in patch) {
    if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
    sets.push('`' + k + '` = ' + esc(patch[k]));
  }
  return 'UPDATE `' + table + '` SET ' + sets.join(', ') + ' WHERE `uuid` = ' + esc(uuidValue);
}

// 软删除统一入口：不物理删除，改 is_deleted + 刷新 updated_at + 标待同步
export function buildSoftDelete(table: string, uuidValue: string, nowMs: number): string {
  return (
    'UPDATE `' + table + '` SET `is_deleted` = 1, `updated_at` = ' + nowMs +
    ", `sync_status` = 'pending' WHERE `uuid` = " + esc(uuidValue)
  );
}

// 查询条件：只取未删除的数据
export function notDeleted(): string {
  return '`is_deleted` = 0';
}
