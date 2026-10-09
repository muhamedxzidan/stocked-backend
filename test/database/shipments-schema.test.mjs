import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import pg from 'pg';

const source = new URL(process.env.DATABASE_URL);
if (
  !['localhost', '127.0.0.1'].includes(source.hostname) ||
  source.pathname !== '/stocked_dev'
)
  throw new Error('SQL tests only accept local stocked_dev as configuration');
const databaseName = `stocked_shipments_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: source.toString() });
let db,
  created = false,
  actorId,
  merchantId,
  warehouseId,
  otherMerchantId;
const instant = '2026-10-09T00:00:00Z';

before(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const target = new URL(source);
  target.pathname = `/${databaseName}`;
  db = new pg.Client({ connectionString: target.toString() });
  await db.connect();
  const migrations = new URL('../../prisma/migrations/', import.meta.url);
  for (const directory of (await readdir(migrations, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort())
    await db.query(
      await readFile(new URL(`${directory}/migration.sql`, migrations), 'utf8'),
    );
  actorId = (
    await db.query(
      "INSERT INTO users(email,display_name,password_hash,role) VALUES ('ship@example.test','SQL actor','fixture-hash','ADMIN') RETURNING id",
    )
  ).rows[0].id;
  merchantId = (
    await db.query(
      "INSERT INTO merchants(code,name,phone,created_by_id) VALUES ('MZ','Merchant MZ','010',$1) RETURNING id",
      [actorId],
    )
  ).rows[0].id;
  otherMerchantId = (
    await db.query(
      "INSERT INTO merchants(code,name,phone,created_by_id) VALUES ('AB','Other','010',$1) RETURNING id",
      [actorId],
    )
  ).rows[0].id;
  warehouseId = (await db.query("SELECT id FROM warehouses WHERE code='MAIN'"))
    .rows[0].id;
});
after(async () => {
  try {
    if (db) await db.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }
});
async function isolated(work) {
  await db.query('BEGIN');
  try {
    await work();
  } finally {
    await db.query('ROLLBACK');
  }
}
async function reject(work, code = '23514', message) {
  await assert.rejects(
    work,
    (e) => e.code === code && (!message || e.message.includes(message)),
  );
}

async function scenario() {
  const itemId = (
    await db.query(
      `INSERT INTO items(merchant_id,ordinal,code,name,weight_kg,created_by_id)
    VALUES ($1,1,'MZ-000001','SQL item',0.5,$2) RETURNING id`,
      [merchantId, actorId],
    )
  ).rows[0].id;
  const receiptId = (
    await db.query(
      `INSERT INTO receipts(warehouse_id,merchant_id,merchant_name_snapshot,received_by_id,received_by_name_snapshot,received_at,idempotency_key,request_hash)
    VALUES ($1,$2,'Merchant MZ',$3,'SQL actor',$4,$5,$6) RETURNING id`,
      [warehouseId, merchantId, actorId, instant, randomUUID(), 'a'.repeat(64)],
    )
  ).rows[0].id;
  const receiptLineId = (
    await db.query(
      `INSERT INTO receipt_lines(receipt_id,warehouse_id,merchant_id,item_id,position,item_code_snapshot,item_name_snapshot,quantity,condition)
    VALUES ($1,$2,$3,$4,1,'MZ-000001','SQL item',10,'GOOD') RETURNING id`,
      [receiptId, warehouseId, merchantId, itemId],
    )
  ).rows[0].id;
  await db.query(
    'INSERT INTO inventory_balances(warehouse_id,merchant_id,item_id) VALUES ($1,$2,$3)',
    [warehouseId, merchantId, itemId],
  );
  await db.query(
    `INSERT INTO stock_movements(warehouse_id,merchant_id,item_id,item_code_snapshot,item_name_snapshot,kind,quantity_delta,actor_id,actor_name_snapshot,recorded_at,receipt_line_id)
    VALUES ($1,$2,$3,'MZ-000001','SQL item','RECEIPT_IN',10,$4,'SQL actor',$5,$6)`,
    [warehouseId, merchantId, itemId, actorId, instant, receiptLineId],
  );
  await db.query('UPDATE inventory_balances SET quantity=10 WHERE item_id=$1', [
    itemId,
  ]);
  const shipmentId = (
    await db.query(
      `INSERT INTO shipments(warehouse_id,merchant_id,code,merchant_name_snapshot,registered_by_id,registered_by_name_snapshot,registered_at,idempotency_key,request_hash)
    VALUES ($1,$2,'SH-000001','Merchant MZ',$3,'SQL actor',$4,$5,$6) RETURNING id`,
      [warehouseId, merchantId, actorId, instant, randomUUID(), 'a'.repeat(64)],
    )
  ).rows[0].id;
  const lineId = (
    await db.query(
      `INSERT INTO shipment_lines(shipment_id,warehouse_id,merchant_id,item_id,position,item_code_snapshot,item_name_snapshot,quantity)
    VALUES ($1,$2,$3,$4,1,'MZ-000001','SQL item',4) RETURNING id`,
      [shipmentId, warehouseId, merchantId, itemId],
    )
  ).rows[0].id;
  const preparationId = (
    await db.query(
      `INSERT INTO shipment_preparations(shipment_id,warehouse_id,merchant_id,prepared_by_id,prepared_by_name_snapshot,prepared_at,idempotency_key,request_hash)
    VALUES ($1,$2,$3,$4,'SQL actor',$5,$6,$7) RETURNING id`,
      [
        shipmentId,
        warehouseId,
        merchantId,
        actorId,
        instant,
        randomUUID(),
        'b'.repeat(64),
      ],
    )
  ).rows[0].id;
  return { itemId, shipmentId, lineId, preparationId };
}
const insertDispatch = `INSERT INTO shipment_dispatches(shipment_id,preparation_id,warehouse_id,merchant_id,carrier_name,tracking_number,dispatched_by_id,dispatched_by_name_snapshot,dispatched_at,idempotency_key,request_hash)
  VALUES ($1,$2,$3,$4,'Carrier','001',$5,'SQL actor',$6,$7,$8) RETURNING id`;
async function dispatch(s, overrides = {}) {
  return (
    await db.query(insertDispatch, [
      s.shipmentId,
      overrides.preparationId ?? s.preparationId,
      warehouseId,
      overrides.merchantId ?? merchantId,
      actorId,
      overrides.time ?? instant,
      randomUUID(),
      'c'.repeat(64),
    ])
  ).rows[0].id;
}
async function movement(s, dispatchId, overrides = {}) {
  return db.query(
    `INSERT INTO stock_movements(warehouse_id,merchant_id,item_id,item_code_snapshot,item_name_snapshot,kind,quantity_delta,actor_id,actor_name_snapshot,recorded_at,shipment_line_id,shipment_dispatch_id)
    VALUES ($1,$2,$3,'MZ-000001',$4,'SHIPMENT_OUT',$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      warehouseId,
      overrides.merchantId ?? merchantId,
      s.itemId,
      overrides.name ?? 'SQL item',
      overrides.delta ?? -4,
      actorId,
      overrides.actorName ?? 'SQL actor',
      overrides.time ?? instant,
      s.lineId,
      dispatchId,
    ],
  );
}

void test('shipment database invariants', async (t) => {
  await t.test('valid full dispatch matches the projection and sources', () =>
    isolated(async () => {
      const s = await scenario();
      const d = await dispatch(s);
      await movement(s, d);
      await db.query(
        'UPDATE inventory_balances SET quantity=6 WHERE item_id=$1',
        [s.itemId],
      );
      await db.query('SET CONSTRAINTS ALL IMMEDIATE');
      assert.equal(
        (
          await db.query(
            'SELECT quantity FROM inventory_balances WHERE item_id=$1',
            [s.itemId],
          )
        ).rows[0].quantity,
        6,
      );
    }),
  );
  for (const table of [
    'shipments',
    'shipment_lines',
    'shipment_preparations',
    'shipment_dispatches',
  ]) {
    for (const verb of ['UPDATE', 'DELETE'])
      await t.test(`${table} rejects ${verb}`, () =>
        isolated(async () => {
          const s = await scenario();
          if (table === 'shipment_dispatches') await dispatch(s);
          const sql =
            verb === 'UPDATE'
              ? `UPDATE ${table} SET id=id`
              : `DELETE FROM ${table}`;
          await reject(() => db.query(sql), '23514', 'append-only');
        }),
      );
  }
  await t.test('dispatch must reference preparation of its own shipment', () =>
    isolated(async () => {
      const s = await scenario();
      await reject(() => dispatch(s, { preparationId: randomUUID() }), '23514');
    }),
  );
  await t.test('dispatch cannot impersonate another merchant', () =>
    isolated(async () => {
      const s = await scenario();
      await reject(() => dispatch(s, { merchantId: otherMerchantId }), '23503');
    }),
  );
  await t.test('preparation cannot predate registration', () =>
    isolated(async () => {
      const s = await scenario();
      await reject(() =>
        db.query(
          `INSERT INTO shipment_preparations(shipment_id,warehouse_id,merchant_id,prepared_by_id,prepared_by_name_snapshot,prepared_at,idempotency_key,request_hash)
      VALUES ($1,$2,$3,$4,'SQL actor','2020-01-01',$5,$6)`,
          [
            s.shipmentId,
            warehouseId,
            merchantId,
            actorId,
            randomUUID(),
            'b'.repeat(64),
          ],
        ),
      );
    }),
  );
  await t.test('dispatch cannot predate preparation', () =>
    isolated(async () => {
      const s = await scenario();
      await reject(
        () => dispatch(s, { time: '2020-01-01' }),
        '23514',
        'precede',
      );
    }),
  );
  await t.test('header-only dispatch fails deferred completeness', () =>
    isolated(async () => {
      const s = await scenario();
      await dispatch(s);
      await reject(
        () => db.query('SET CONSTRAINTS ALL IMMEDIATE'),
        '23514',
        'every shipment line',
      );
    }),
  );
  await t.test('unposted extra line prevents committing partial dispatch', () =>
    isolated(async () => {
      const s = await scenario();
      const secondId = (
        await db.query(
          `INSERT INTO items(merchant_id,ordinal,code,name,weight_kg,created_by_id)
      VALUES ($1,2,'MZ-000002','Second',0.5,$2) RETURNING id`,
          [merchantId, actorId],
        )
      ).rows[0].id;
      await db.query(
        `INSERT INTO shipment_lines(shipment_id,warehouse_id,merchant_id,item_id,position,item_code_snapshot,item_name_snapshot,quantity)
      VALUES ($1,$2,$3,$4,2,'MZ-000002','Second',1)`,
        [s.shipmentId, warehouseId, merchantId, secondId],
      );
      const d = await dispatch(s);
      await movement(s, d);
      await db.query(
        'UPDATE inventory_balances SET quantity=6 WHERE item_id=$1',
        [s.itemId],
      );
      await reject(
        () => db.query('SET CONSTRAINTS ALL IMMEDIATE'),
        '23514',
        'every shipment line',
      );
    }),
  );
  for (const { label, overrides } of [
    { label: 'wrong quantity', overrides: { delta: -3 } },
    { label: 'positive delta', overrides: { delta: 4 } },
    { label: 'wrong snapshot', overrides: { name: 'Changed' } },
    { label: 'wrong actor snapshot', overrides: { actorName: 'Impersonated' } },
    {
      label: 'wrong recorded time',
      overrides: { time: '2026-10-09T01:00:00Z' },
    },
  ])
    await t.test(`movement rejects ${label}`, () =>
      isolated(async () => {
        const s = await scenario();
        const d = await dispatch(s);
        await reject(() => movement(s, d, overrides));
      }),
    );
  await t.test('movement cannot use another merchant', () =>
    isolated(async () => {
      const s = await scenario();
      const d = await dispatch(s);
      await reject(
        () => movement(s, d, { merchantId: otherMerchantId }),
        '23503',
      );
    }),
  );
  await t.test('line cannot post twice', () =>
    isolated(async () => {
      const s = await scenario();
      const d = await dispatch(s);
      await movement(s, d);
      await reject(() => movement(s, d), '23505');
    }),
  );
  await t.test('dispatch requires a projection update', () =>
    isolated(async () => {
      const s = await scenario();
      const d = await dispatch(s);
      await movement(s, d);
      await reject(
        () => db.query('SET CONSTRAINTS ALL IMMEDIATE'),
        '23514',
        'movement ledger',
      );
    }),
  );
  await t.test('shipment line cannot belong to another merchant', () =>
    isolated(async () => {
      const s = await scenario();
      const foreignId = (
        await db.query(
          `INSERT INTO items(merchant_id,ordinal,code,name,weight_kg,created_by_id)
      VALUES ($1,1,'AB-000001','Foreign',0.5,$2) RETURNING id`,
          [otherMerchantId, actorId],
        )
      ).rows[0].id;
      await reject(
        () =>
          db.query(
            `INSERT INTO shipment_lines(shipment_id,warehouse_id,merchant_id,item_id,position,item_code_snapshot,item_name_snapshot,quantity)
      VALUES ($1,$2,$3,$4,2,'AB-000001','Foreign',1)`,
            [s.shipmentId, warehouseId, merchantId, foreignId],
          ),
        '23503',
      );
    }),
  );
  await t.test('shipment rejects empty registration at commit', () =>
    isolated(async () => {
      await db.query(
        `INSERT INTO shipments(warehouse_id,merchant_id,code,merchant_name_snapshot,registered_by_id,registered_by_name_snapshot,registered_at,idempotency_key,request_hash)
      VALUES ($1,$2,'SH-000002','Merchant MZ',$3,'SQL actor',$4,$5,$6)`,
        [
          warehouseId,
          merchantId,
          actorId,
          instant,
          randomUUID(),
          'a'.repeat(64),
        ],
      );
      await reject(
        () => db.query('SET CONSTRAINTS ALL IMMEDIATE'),
        '23514',
        'complete ordered line set',
      );
    }),
  );
  await t.test(
    'committed registration rejects appending new lines',
    async () => {
      await db.query('BEGIN');
      let s;
      try {
        s = await scenario();
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      }
      await isolated(async () => {
        await reject(
          () =>
            db.query(
              `INSERT INTO shipment_lines(shipment_id,warehouse_id,merchant_id,item_id,position,item_code_snapshot,item_name_snapshot,quantity)
        VALUES ($1,$2,$3,$4,2,'MZ-000001','SQL item',1)`,
              [s.shipmentId, warehouseId, merchantId, s.itemId],
            ),
          '23514',
          'registration transaction',
        );
      });
    },
  );
});
