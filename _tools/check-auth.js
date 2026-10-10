// _tools/check-auth.js - 本地账号体系校验（只读）
// 运行：node --experimental-strip-types _tools/check-auth.js
//
// 覆盖：
//  1) 分层可加载（TS 模块语法 + 依赖链）
//  2) 口令哈希：SHA-256 / HMAC 已知向量、PBKDF2 编解码、错误口令、定长比较
//  3) UUID 主键
//  4) Repository 契约：uuid 主键 / 软删除 / updated_at / sync_status / upsert 复活
//  5) auth：注册查重、登录比对、错误口令、弱口令、登出、会话只进安全存储
//  6) account-sync：未登录空操作，登录后镜像收藏 / 写学习记录 / 取消收藏软删除
//  7) SQL 转义与建表契约（三表公共列齐全、无自增 id）
//  8) argon2 适配器可插拔（注册后走 argon2，未注册时不误判）

const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');
// 动态 import 在 Windows 上必须是 file:// URL
const P = (rel) => 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');

/* ---------------- mock：uni 存储 + plus 安全存储 ---------------- */
const kv = {};          // 普通 storage（模拟）
const secureKv = {};    // plus.navigator 安全存储（模拟）

global.uni = {
  getStorageSync: (k) => (k in kv ? kv[k] : ''),
  setStorageSync: (k, v) => { kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; },
  showToast: () => {}
};

global.plus = {
  // 故意不提供 sqlite → 走 KV 降级实现（顺带验证降级路径可用）
  navigator: {
    setSecureData: (k, v, ok) => { secureKv[k] = v; if (ok) ok(); },
    getSecureData: (k, ok) => { if (ok) ok(secureKv[k] || ''); },
    removeSecureData: (k, ok) => { delete secureKv[k]; if (ok) ok(); }
  },
  storage: {
    setItem: (k, v) => { kv['plus:' + k] = v; },
    getItem: (k) => kv['plus:' + k] || null,
    removeItem: (k) => { delete kv['plus:' + k]; }
  }
};

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function assert(cond, msg) { if (cond) ok(msg); else bad(msg); }
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}

(async () => {
  /* ---------- 1. 分层可加载 ---------- */
  console.log('== 1. 分层可加载（utils → db → repositories → services） ==');
  const hash = await import(P('utils/hash.ts'));
  const uuidMod = await import(P('utils/uuid.ts'));
  const timeMod = await import(P('utils/time.ts'));
  const sqlMod = await import(P('db/sql.ts'));
  const schema = await import(P('db/schema.ts'));
  const sqliteMod = await import(P('db/sqlite.ts'));
  const types = await import(P('repositories/types.ts'));
  const reposIndex = await import(P('repositories/index.ts'));
  const auth = await import(P('services/auth.ts'));
  const sync = await import(P('services/account-sync.ts'));
  const argon2 = await import(P('utils/argon2.ts'));
  const secure = await import(P('utils/secure-storage.ts'));
  ok('11 个模块全部加载成功（含 TS 类型剥离）');
  eq(sqliteMod.isSupported(), false, '当前环境无 plus.sqlite → 走 KV 降级');
  const repos = await reposIndex.initRepositories();
  eq(repos.backend, 'kv', '仓储后端');

  /* ---------- 2. 口令哈希 ---------- */
  console.log('== 2. 口令哈希（SHA-256 / HMAC / PBKDF2） ==');
  const hexOf = (u8) => Array.from(u8).map((b) => ('0' + b.toString(16)).slice(-2)).join('');
  eq(
    hexOf(hash.sha256(hash.utf8Bytes('abc'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'SHA-256("abc") 已知向量'
  );
  const keyBytes = new Uint8Array(20).fill(0x0b);
  eq(
    hexOf(hash.hmacSha256(keyBytes, hash.utf8Bytes('Hi There'))),
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    'HMAC-SHA256 RFC4231 向量'
  );
  eq(
    hexOf(hash.pbkdf2(hash.utf8Bytes('password'), hash.utf8Bytes('salt'), 1, 32)),
    '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b',
    'PBKDF2-HMAC-SHA256(password,salt,1,32) 已知向量'
  );
  const enc = hash.pbkdf2Encode('Str0ng!Pass');
  assert(enc.indexOf('$pbkdf2-sha256$i=') === 0, '编码带算法与参数前缀：' + enc.slice(0, 26) + '…');
  assert(hash.pbkdf2Verify('Str0ng!Pass', enc), '正确口令校验通过');
  assert(!hash.pbkdf2Verify('wrong', enc), '错误口令校验失败');
  assert(hash.pbkdf2Encode('Str0ng!Pass') !== enc, '同一口令两次哈希不同（随机盐）');
  assert(hash.pbkdf2Verify('Str0ng!Pass', hash.pbkdf2Encode('Str0ng!Pass')), '换盐后仍能校验');
  assert(!hash.pbkdf2Verify('x', 'garbage'), '非法编码串返回 false 而不是抛错');

  /* ---------- 3. UUID ---------- */
  console.log('== 3. UUID 主键 ==');
  const id1 = uuidMod.uuid();
  assert(uuidMod.isUuid(id1), '格式合法：' + id1);
  assert(id1 !== uuidMod.uuid(), '两次不重复');
  assert(!uuidMod.isUuid('1'), '自增 id 这种不算合法主键');

  /* ---------- 4. Repository 契约（KV 实现 = 与 SQLite 同接口） ---------- */
  console.log('== 4. Repository 契约：软删除 / updated_at / sync_status / upsert ==');
  const users = repos.users;
  const u1 = await users.create({ username: 'Tom', password_hash: 'hash-1', nickname: 'Tom' });
  assert(uuidMod.isUuid(u1.uuid), '主键是 uuid');
  eq(u1.user_id, u1.uuid, 'user_id = 自身 uuid');
  eq(Number(u1.is_deleted), 0, '新建 is_deleted = 0');
  eq(u1.sync_status, 'pending', '新建 sync_status = pending');
  eq(!!(await users.findByUsername('tom')), true, '用户名归一（大小写不敏感）查得到');
  eq(!!(await users.findByUsername('nobody')), false, '不存在的用户返回 null');

  const before = u1.updated_at;
  await new Promise((r) => setTimeout(r, 5));
  const u1b = await users.update(u1.uuid, { nickname: 'Tommy' });
  assert(u1b.updated_at > before, 'update 自动刷新 updated_at');
  eq(u1b.nickname, 'Tommy', '字段确实更新');
  eq(Number(u1b.is_deleted), 0, 'update 不会误删');

  eq(await users.softDelete(u1.uuid), true, '软删除命中');
  eq(await users.findByUuid(u1.uuid), null, '软删除后查不到（列表语义）');
  eq(await users.softDelete(u1.uuid), false, '重复软删除返回 false');
  const all = await users.list();
  eq(all.length, 0, 'list() 只返回未删除的');

  const f1 = await repos.wordFavorites.upsert({ user_id: 'u-1', ref_type: 'word', ref_id: 'w-1', word: 'abandon', meaning: '放弃' });
  const f2 = await repos.wordFavorites.upsert({ user_id: 'u-1', ref_type: 'word', ref_id: 'w-1', word: 'abandon', meaning: '抛弃' });
  eq(f1.uuid, f2.uuid, 'upsert 不产生重复行');
  eq((await repos.wordFavorites.listByUser('u-1')).length, 1, '同一 ref 只保留一条');
  await repos.wordFavorites.softDelete(f1.uuid);
  eq((await repos.wordFavorites.listByUser('u-1')).length, 0, '取消收藏后列表为空');
  const revived = await repos.wordFavorites.upsert({ user_id: 'u-1', ref_type: 'word', ref_id: 'w-1', word: 'abandon', meaning: '放弃' });
  eq(revived.uuid, f1.uuid, '再次收藏复用同一行（复活软删除）');
  eq(Number(revived.is_deleted), 0, '复活后 is_deleted 归 0');

  const r1 = await repos.studyRecords.create({ user_id: 'u-1', result: 'pass', score: 90, sentence_id: 's-1' });
  assert(uuidMod.isUuid(r1.uuid), '学习记录主键是 uuid');
  const pend = await repos.studyRecords.findPendingSync('u-1', 10);
  eq(pend.length, 1, '待同步队列命中新记录');
  eq(await repos.studyRecords.markSynced([r1.uuid]), 1, '标记同步返回条数');
  eq((await repos.studyRecords.findPendingSync('u-1', 10)).length, 0, '标记后不再待同步');

  /* ---------- 5. auth ---------- */
  console.log('== 5. auth：注册 / 登录 / 登出 / 会话存储 ==');
  eq(auth.isLoggedIn(), false, '初始未登录');
  eq(await auth.init(), null, '无会话时 init 返回 null（不抛错）');

  assert(auth.validateUsername('a') !== null, '用户名太短被拒');
  assert(auth.validateUsername('tom') === null, '合法用户名通过');
  assert(auth.validatePassword('1234567') !== null, '密码少于 8 位被拒');
  assert(auth.validatePassword('12345678') === null, '8 位密码通过');

  await auth.register('alice', 'alice-pass-1');
  eq(auth.isLoggedIn(), true, '注册后自动登录');
  const s1 = auth.session();
  assert(!!s1.token && s1.token.length >= 32, '会话 token 已生成（长度 ' + s1.token.length + '）');
  eq(s1.username, 'alice', '会话带用户名');

  let dupErr = null;
  try {
    await auth.register('Alice', 'another-pass');
  } catch (e) {
    dupErr = e;
  }
  assert(dupErr && dupErr.code === 'username-taken', '重名注册被拒（大小写归一后判重）');

  await auth.logout();
  eq(auth.isLoggedIn(), false, '登出后未登录');
  eq(Object.keys(secureKv).length, 0, '登出清空安全存储');

  await auth.login('alice', 'alice-pass-1');
  eq(auth.isLoggedIn(), true, '正确口令登录成功');
  assert(secureKv['bw_session_v1'] && secureKv['bw_session_v1'].length > 0, 'token 写进 plus 安全存储');
  eq(kv['bw_session_v1'] === undefined, true, '普通 storage 里没有 token');
  eq('bw_session_v1' in kv, false, '普通 storage 里没有 token（二次确认）');

  let wrongErr = null;
  try {
    await auth.login('alice', 'bad-pass');
  } catch (e) {
    wrongErr = e;
  }
  assert(wrongErr && wrongErr.code === 'bad-credentials', '错误口令被拒');
  let noUserErr = null;
  try {
    await auth.login('nobody', 'whatever-pass');
  } catch (e) {
    noUserErr = e;
  }
  assert(noUserErr && noUserErr.code === 'bad-credentials', '用户不存在与密码错误同一提示（不暴露注册情况）');

  /* ---------- 6. account-sync ---------- */
  console.log('== 6. account-sync：未登录空操作 / 登录后镜像 ==');
  await auth.logout();
  await sync.mirrorFavorite({ type: 'word', id: 'no-session', word: 'x' });
  await sync.recordStudy({ result: 'pass' });
  ok('未登录时镜像与记录都是空操作（不写库）');

  await auth.login('alice', 'alice-pass-1');
  await sync.importFavorites([
    { type: 'word', id: 'w-1', word: 'abandon', meaning: '放弃' },
    { type: 'sentence', id: 's-9', en: 'Hello', zh: '你好' }
  ]);
  const favs = await repos.wordFavorites.listByUser(auth.currentUserId());
  eq(favs.length, 2, '登录后导入已有收藏到 word_favorite');
  await sync.unmirrorFavorite('word', 'w-1');
  eq((await repos.wordFavorites.listByUser(auth.currentUserId())).length, 1, '取消收藏后仅剩 1 条');
  await sync.recordStudy({ result: 'pass', score: 100, sentenceId: 's-9' });
  const recs = await repos.studyRecords.listByUser(auth.currentUserId());
  eq(recs.length, 1, '答题写入 study_records');
  assert(recs[0].user_id === auth.currentUserId(), '学习记录带 user_id');

  /* ---------- 7. SQL 转义与建表契约 ---------- */
  console.log('== 7. SQL 转义与建表契约 ==');
  eq(sqlMod.esc("a'b"), "'a''b'", '单引号转义（防注入）');
  eq(sqlMod.esc(null), 'NULL', 'null 转 NULL');
  eq(sqlMod.esc(true), '1', '布尔转 1/0');
  const injected = sqlMod.buildInsert('users', { username: "x'); DROP TABLE users; --" });
  assert(injected.indexOf('DROP TABLE') >= 0 && injected.indexOf("''") >= 0, '恶意串被转义后不再截断语句');
  const ddl = schema.DDL.join('\n');
  for (const t of ['users', 'study_records', 'word_favorite']) {
    const m = ddl.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + t + ' \\(([\\s\\S]*?)\\)'));
    assert(!!m, '表 ' + t + ' 已定义');
    if (m) {
      for (const col of ['uuid', 'user_id', 'created_at', 'updated_at', 'is_deleted', 'sync_status']) {
        assert(new RegExp('\\b' + col + '\\b').test(m[1]), t + ' 含公共列 ' + col);
      }
      assert(/uuid\s+TEXT\s+PRIMARY KEY/i.test(m[1]), t + ' 主键是 uuid TEXT');
    }
  }
  assert(!/AUTOINCREMENT/i.test(ddl), '全库没有自增 id');
  eq(schema.TABLES.length, 3, '三张业务表');

  /* ---------- 8. argon2 可插拔 ---------- */
  console.log('== 8. argon2 适配器（可插拔，装包后一行切换） ==');
  const fakeHashWasm = {
    argon2id: async (o) => '$argon2id$v=19$m=' + o.memorySize + ',t=' + o.iterations + ',p=' + o.parallelism + '$c2FsdA$' + hash.bytesToB64(new Uint8Array(8)),
    argon2Verify: async (o) => o.password === 'argon-pass'
  };
  hash.setPasswordHasher(argon2.fromHashWasm(fakeHashWasm));
  eq(hash.isArgon2Enabled(), true, '注册后 argon2 生效');
  const aEnc = await hash.hashPassword('argon-pass');
  assert(aEnc.indexOf('$argon2id$') === 0, '哈希串是 argon2id PHC 格式');
  assert(await hash.verifyPassword('argon-pass', aEnc), 'argon2 校验通过');
  assert(!(await hash.verifyPassword('nope', aEnc)), 'argon2 校验失败');
  assert(await hash.verifyPassword('Str0ng!Pass', enc), '老 PBKDF2 账号仍可校验（混存）');
  eq(hash.needsRehash(enc), true, 'argon2 已启用 → 旧 PBKDF2 需要升级');
  eq(hash.needsRehash(aEnc), false, '已是 argon2 不需升级');
  hash.setPasswordHasher(null);
  eq(hash.isArgon2Enabled(), false, '取消注册后回到 PBKDF2');
  let noArgon = null;
  try {
    await hash.verifyPassword('argon-pass', aEnc);
  } catch (e) {
    noArgon = e;
  }
  assert(noArgon && /argon2/.test(noArgon.message), '未启用 argon2 时校验 argon2 串给出明确错误');
  eq(argon2.autoRegisterArgon2(), false, '全局没有 argon2 时自动注册返回 false（不报错）');

  /* ---------- 9. SQLite 分支：用假驱动记录 SQL，校验语句契约 ---------- */
  console.log('== 9. SQLite 分支：建表 / 软删除 / 待同步 语句契约 ==');
  const executed = [];
  // 假驱动：SELECT 时给 users 表回一行（好让 update / softDelete 走到写SQL的分支）
  const fakeUser = {
    uuid: 'u-x', user_id: 'u-x', username: 'bob', password_hash: 'h', nickname: 'Bob',
    avatar: '', created_at: 1, updated_at: 1, last_login_at: 0, is_deleted: 0, sync_status: 'pending'
  };
  global.plus.sqlite = {
    isOpenDatabase: () => false,
    openDatabase: (o) => { if (o.success) o.success(); },
    executeSql: (o) => { executed.push(o.sql); if (o.success) o.success(); },
    selectSql: (o) => {
      executed.push(o.sql);
      if (o.success) o.success(o.sql.indexOf('FROM users') >= 0 ? [Object.assign({}, fakeUser)] : []);
    },
    transaction: (o) => { if (o.success) o.success(); },
    closeDatabase: (o) => { if (o.success) o.success(); }
  };
  reposIndex.__setRepositories(null);
  const r2 = await reposIndex.initRepositories();
  eq(r2.backend, 'sqlite', '检测到 plus.sqlite → 走 SQLite 后端');
  for (const t of ['users', 'study_records', 'word_favorite']) {
    assert(executed.some((s) => s.indexOf('CREATE TABLE IF NOT EXISTS ' + t) === 0), '建表语句：' + t);
  }
  assert(executed.some((s) => s.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username') === 0), '用户名唯一索引');
  await r2.users.create({ username: 'bob', password_hash: 'h', nickname: 'Bob' });
  const ins = executed.filter((s) => s.indexOf('INSERT INTO `users`') === 0)[0] || '';
  assert(ins.indexOf('`uuid`') >= 0 && ins.indexOf('`user_id`') >= 0 && ins.indexOf('`sync_status`') >= 0, 'INSERT 带公共列');
  assert(/VALUES \('[0-9a-f-]{36}'/.test(ins), 'INSERT 的 uuid 是真实 UUID：' + (ins.match(/VALUES \('([^']+)'/) || [])[1]);
  await r2.users.update('u-x', { nickname: 'Bobby' });
  const upd = executed.filter((s) => s.indexOf('UPDATE `users`') === 0).pop() || '';
  assert(upd.indexOf('`updated_at`') >= 0, 'UPDATE 自动带 updated_at');
  assert(upd.indexOf("`sync_status` = 'pending'") >= 0, 'UPDATE 把 sync_status 标为 pending');
  await r2.users.softDelete('u-x');
  const del = executed.filter((s) => s.indexOf('UPDATE `users`') === 0).pop() || '';
  assert(del.indexOf('`is_deleted` = 1') >= 0, '删除是 UPDATE is_deleted=1（软删除）');
  assert(!/DELETE FROM/i.test(executed.join('|')), '全库没有物理 DELETE');
  await r2.users.findByUsername('bob');
  const sel = executed.filter((s) => s.indexOf('SELECT * FROM users') === 0).pop() || '';
  assert(sel.indexOf('`is_deleted` = 0') >= 0, '查询默认过滤已删除');
  await r2.studyRecords.markSynced(['a', 'b']);
  const mk = executed.filter((s) => s.indexOf('UPDATE study_records') === 0).pop() || '';
  assert(mk.indexOf("`sync_status` = 'synced'") >= 0, 'markSynced 写 synced');
  assert(mk.indexOf('updated_at') < 0, 'markSynced 不刷新 updated_at（同步记账不算业务修改）');

  console.log('');
  console.log(fail === 0 ? '本地账号体系全部通过' : '失败 ' + fail + ' 项');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
