import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import pg from 'pg';

// A fresh local database for each run; no fixtures touch stocked_dev.
const source = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(source.hostname) || source.pathname !== '/stocked_dev') {
  throw new Error('Database tests require the local stocked_dev configuration');
}
const databaseName = `stocked_identity_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: source.toString() });
let database;
let created = false;
let adminId;
let merchantId;

before(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const target = new URL(source);
  target.pathname = `/${databaseName}`;
  database = new pg.Client({ connectionString: target.toString() });
  await database.connect();
  const migrations = new URL('../../prisma/migrations/', import.meta.url);
  const directories = (await readdir(migrations, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const directory of directories) {
    await database.query(await readFile(new URL(`${directory}/migration.sql`, migrations), 'utf8'));
  }
  adminId = (await database.query(`INSERT INTO users(email, display_name, password_hash, role)
    VALUES ('admin@example.test', 'Test admin', 'fixture-not-a-real-password-hash', 'ADMIN') RETURNING id`)).rows[0].id;
  merchantId = (await database.query(`INSERT INTO merchants(code, name, phone, created_by_id)
    VALUES ('MZ', 'Test merchant', '01000000000', $1) RETURNING id`, [adminId])).rows[0].id;
});

after(async () => {
  try {
    if (database) await database.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }
});

async function isolated(operation) {
  await database.query('BEGIN');
  try { await operation(); } finally { await database.query('ROLLBACK'); }
}
async function rejects(sql, values, constraint, code = '23514') {
  await isolated(async () => {
    await assert.rejects(database.query(sql, values), (error) =>
      error.code === code && error.constraint === constraint);
  });
}
const insertUser = `INSERT INTO users(email,display_name,password_hash,role,merchant_id,created_by_id)
  VALUES ($1,'Test user','fixture-hash',$2,$3,$4)`;
const insertSession = `INSERT INTO sessions(user_id,token_hash,created_at,last_seen_at,expires_at,revoked_at)
  VALUES ($1,$2,$3,$4,$5,$6)`;
const started = '2026-10-09T00:00:00Z';
const earlier = '2026-10-08T23:59:00Z';
const expires = '2026-10-09T12:00:00Z';

// Sequential subtests share a connection and roll back every individual scenario.
void test('identity database invariants', async (t) => {
  const failures = [
    ['duplicate email', insertUser, ['admin@example.test','ADMIN',null,adminId], 'users_email_key','23505'],
    ['uppercase email', insertUser, ['USER@example.test','EMPLOYEE',null,adminId], 'users_email_normalized_check'],
    ['padded email', insertUser, [' user@example.test ','EMPLOYEE',null,adminId], 'users_email_normalized_check'],
    ['empty email', insertUser, ['','EMPLOYEE',null,adminId], 'users_email_normalized_check'],
    ['merchant without owner', insertUser, ['user@example.test','MERCHANT',null,adminId], 'users_role_merchant_check'],
    ['employee with owner', insertUser, ['user@example.test','EMPLOYEE',merchantId,adminId], 'users_role_merchant_check'],
    ['unknown merchant', insertUser, ['user@example.test','MERCHANT',randomUUID(),adminId], 'users_merchant_id_fkey','23503'],
    ['unknown creator', insertUser, ['user@example.test','EMPLOYEE',null,randomUUID()], 'users_created_by_id_fkey','23503'],
    ['duplicate merchant code', `INSERT INTO merchants(code,name,phone,created_by_id) VALUES ('MZ','Other','010',$1)`, [adminId], 'merchants_code_key','23505'],
    ['lowercase merchant code', `INSERT INTO merchants(code,name,phone,created_by_id) VALUES ('mz','Other','010',$1)`, [adminId], 'merchants_code_format_check'],
    ['short merchant code', `INSERT INTO merchants(code,name,phone,created_by_id) VALUES ('M','Other','010',$1)`, [adminId], 'merchants_code_format_check'],
    ['immutable code', `UPDATE merchants SET code='AB' WHERE id=$1`, [merchantId], 'merchants_code_immutable'],
    ['empty merchant name', `UPDATE merchants SET name='  ' WHERE id=$1`, [merchantId], 'merchants_name_nonempty_check'],
    ['empty merchant phone', `UPDATE merchants SET phone='  ' WHERE id=$1`, [merchantId], 'merchants_phone_nonempty_check'],
    ['empty display name', `UPDATE users SET display_name='  ' WHERE id=$1`, [adminId], 'users_display_name_nonempty_check'],
    ['empty password digest', `UPDATE users SET password_hash='' WHERE id=$1`, [adminId], 'users_password_hash_nonempty_check'],
    ['session unknown user', insertSession, [randomUUID(),'a'.repeat(64),started,started,expires,null], 'sessions_user_id_fkey','23503'],
    ['invalid token digest', insertSession, [adminId,'not-a-digest',started,started,expires,null], 'sessions_token_hash_format_check'],
    ['expiry before creation', insertSession, [adminId,'a'.repeat(64),started,started,earlier,null], 'sessions_expires_after_creation_check'],
    ['expiry equal to creation', insertSession, [adminId,'a'.repeat(64),started,started,started,null], 'sessions_expires_after_creation_check'],
    ['last seen before creation', insertSession, [adminId,'a'.repeat(64),started,earlier,expires,null], 'sessions_last_seen_after_creation_check'],
    ['revocation before creation', insertSession, [adminId,'a'.repeat(64),started,started,expires,earlier], 'sessions_revoked_after_creation_check'],
    ['creator delete restricted', `DELETE FROM users WHERE id=$1`, [adminId], 'merchants_created_by_id_fkey','23503'],
  ];
  for (const [name,sql,values,constraint,code] of failures) {
    await t.test(name, () => rejects(sql,values,constraint,code));
  }
  await t.test('multiple accounts for one merchant and restrictive deletion', () => isolated(async () => {
    await database.query(insertUser,['one@example.test','MERCHANT',merchantId,adminId]);
    await database.query(insertUser,['two@example.test','MERCHANT',merchantId,adminId]);
    assert.equal((await database.query('SELECT count(*)::int AS count FROM users WHERE merchant_id=$1',[merchantId])).rows[0].count,2);
    await assert.rejects(database.query('DELETE FROM merchants WHERE id=$1',[merchantId]),
      (error) => error.code === '23503' && error.constraint === 'users_merchant_id_fkey');
  }));
  await t.test('duplicate session digest is rejected', () => isolated(async () => {
    const values=[adminId,'a'.repeat(64),started,started,expires,null];
    await database.query(insertSession,values);
    await assert.rejects(database.query(insertSession,values),
      (error) => error.code === '23505' && error.constraint === 'sessions_token_hash_key');
  }));
  await t.test('sessions prevent deleting their user', () => isolated(async () => {
    const id=(await database.query(`${insertUser} RETURNING id`,['employee@example.test','EMPLOYEE',null,adminId])).rows[0].id;
    await database.query(insertSession,[id,'b'.repeat(64),started,started,expires,null]);
    await assert.rejects(database.query('DELETE FROM users WHERE id=$1',[id]),
      (error) => error.code === '23503' && error.constraint === 'sessions_user_id_fkey');
  }));
  await t.test('code can stay unchanged while merchant details change', () => isolated(async () => {
    await database.query(`UPDATE merchants SET code=code,name='Renamed',is_active=false WHERE id=$1`,[merchantId]);
    assert.equal((await database.query('SELECT code FROM merchants WHERE id=$1',[merchantId])).rows[0].code,'MZ');
    await assert.rejects(database.query(`INSERT INTO merchants(code,name,phone,created_by_id) VALUES ('MZ','New','010',$1)`,[adminId]),
      (error) => error.code === '23505' && error.constraint === 'merchants_code_key');
  }));
});
