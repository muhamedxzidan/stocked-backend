import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

void test('stocktake migration preserves nonempty warehouse ledger and explicitly marks stock unassigned', async () => {
  const source = new URL(process.env.DATABASE_URL);
  if (
    !['localhost', '127.0.0.1'].includes(source.hostname) ||
    source.pathname !== '/stocked_dev'
  )
    throw new Error('Only local stocked_dev is accepted as test configuration');
  const name = `stocked_upgrade_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: source.toString() });
  await admin.connect();
  let db,
    created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    const target = new URL(source);
    target.pathname = `/${name}`;
    db = new pg.Client({ connectionString: target.toString() });
    await db.connect();
    const migrations = new URL('../../prisma/migrations/', import.meta.url),
      upgrade = '20261009150000_stocktakes_locations';
    for (const dir of (await readdir(migrations, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort())
      if (dir < upgrade)
        await db.query(
          await readFile(new URL(`${dir}/migration.sql`, migrations), 'utf8'),
        );
    const actor = (
      await db.query(
        "INSERT INTO users(email,display_name,password_hash,role) VALUES('upgrade@example.test','Director','test-hash','ADMIN') RETURNING id",
      )
    ).rows[0].id;
    const merchant = (
      await db.query(
        "INSERT INTO merchants(code,name,phone,created_by_id) VALUES('MZ','Merchant','010',$1) RETURNING id",
        [actor],
      )
    ).rows[0].id;
    const warehouse = (
      await db.query("SELECT id FROM warehouses WHERE code='MAIN'")
    ).rows[0].id;
    const item = (
      await db.query(
        "INSERT INTO items(merchant_id,ordinal,code,name,weight_kg,created_by_id) VALUES($1,1,'MZ-000001','Existing stock',1,$2) RETURNING id",
        [merchant, actor],
      )
    ).rows[0].id;
    const time = '2026-10-09T00:00:00.000Z';
    await db.query('BEGIN');
    const receipt = (
      await db.query(
        "INSERT INTO receipts(warehouse_id,merchant_id,merchant_name_snapshot,received_by_id,received_by_name_snapshot,received_at,idempotency_key,request_hash) VALUES($1,$2,'Merchant',$3,'Director',$4,$5,$6) RETURNING id",
        [warehouse, merchant, actor, time, randomUUID(), 'a'.repeat(64)],
      )
    ).rows[0].id;
    const line = (
      await db.query(
        "INSERT INTO receipt_lines(receipt_id,warehouse_id,merchant_id,item_id,position,item_code_snapshot,item_name_snapshot,quantity,condition) VALUES($1,$2,$3,$4,1,'MZ-000001','Existing stock',7,'GOOD') RETURNING id",
        [receipt, warehouse, merchant, item],
      )
    ).rows[0].id;
    await db.query(
      'INSERT INTO inventory_balances(warehouse_id,merchant_id,item_id) VALUES($1,$2,$3)',
      [warehouse, merchant, item],
    );
    await db.query(
      "INSERT INTO stock_movements(warehouse_id,merchant_id,item_id,item_code_snapshot,item_name_snapshot,kind,quantity_delta,actor_id,actor_name_snapshot,recorded_at,receipt_line_id) VALUES($1,$2,$3,'MZ-000001','Existing stock','RECEIPT_IN',7,$4,'Director',$5,$6)",
      [warehouse, merchant, item, actor, time, line],
    );
    await db.query(
      'UPDATE inventory_balances SET quantity=7,updated_at=$1 WHERE warehouse_id=$2 AND item_id=$3',
      [time, warehouse, item],
    );
    await db.query('COMMIT');
    const before = (
      await db.query(
        'SELECT id,quantity_delta,recorded_at FROM stock_movements ORDER BY id',
      )
    ).rows;
    await db.query(
      await readFile(new URL(`${upgrade}/migration.sql`, migrations), 'utf8'),
    );
    assert.deepEqual(
      (
        await db.query(
          'SELECT id,quantity_delta,recorded_at FROM stock_movements ORDER BY id',
        )
      ).rows,
      before,
    );
    assert.equal(
      (await db.query('SELECT quantity FROM inventory_balances')).rows[0]
        .quantity,
      7,
    );
    assert.deepEqual(
      (await db.query('SELECT shelf_id,quantity FROM stock_placement_balances'))
        .rows,
      [{ shelf_id: null, quantity: 7 }],
    );
    assert.deepEqual(
      (
        await db.query(
          'SELECT kind,quantity_delta,movement_id FROM stock_placement_entries',
        )
      ).rows,
      [{ kind: 'BASELINE', quantity_delta: 7, movement_id: null }],
    );
    await assert.rejects(
      db.query(
        "INSERT INTO stock_placement_entries(warehouse_id,merchant_id,item_id,quantity_delta,kind,recorded_at) VALUES($1,$2,$3,1,'BASELINE',$4)",
        [warehouse, merchant, item, time],
      ),
      { code: '23514' },
    );
  } finally {
    if (db) await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
