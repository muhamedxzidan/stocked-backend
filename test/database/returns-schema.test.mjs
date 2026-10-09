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
const databaseName = `stocked_returns_test_${randomUUID().replaceAll('-', '')}`;
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
      "INSERT INTO users(email,display_name,password_hash,role) VALUES ('return@example.test','SQL actor','fixture-hash','ADMIN') RETURNING id",
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

async function sentScenario() {
  const s = await scenario();
  s.dispatchId = await dispatch(s);
  await movement(s, s.dispatchId);
  await db.query('UPDATE inventory_balances SET quantity=6 WHERE item_id=$1', [
    s.itemId,
  ]);
  return s;
}
async function arrival(s, quantity = 4, overrides = {}) {
  const id = (
    await db.query(
      `INSERT INTO return_receipts(warehouse_id,merchant_id,shipment_id,dispatch_id,merchant_name_snapshot,shipment_code_snapshot,received_by_id,received_by_name_snapshot,received_at,idempotency_key,request_hash)
 VALUES($1,$2,$3,$4,'Merchant MZ','SH-000001',$5,'SQL actor',$6,$7,$8) RETURNING id`,
      [
        warehouseId,
        overrides.merchantId ?? merchantId,
        s.shipmentId,
        s.dispatchId,
        actorId,
        instant,
        randomUUID(),
        'd'.repeat(64),
      ],
    )
  ).rows[0].id;
  const lineId = (
    await db.query(
      `INSERT INTO return_receipt_lines(receipt_id,shipment_id,shipment_line_id,warehouse_id,merchant_id,item_id,position,quantity,item_code_snapshot,item_name_snapshot)
 VALUES($1,$2,$3,$4,$5,$6,1,$7,'MZ-000001','SQL item') RETURNING id`,
      [
        id,
        s.shipmentId,
        overrides.shipmentLineId ?? s.lineId,
        warehouseId,
        merchantId,
        s.itemId,
        quantity,
      ],
    )
  ).rows[0].id;
  return { id, lineId };
}
async function inspection(r) {
  return (
    await db.query(
      `INSERT INTO return_inspections(receipt_id,warehouse_id,merchant_id,inspected_by_id,inspected_by_name_snapshot,inspected_at,idempotency_key,request_hash)
 VALUES($1,$2,$3,$4,'SQL actor',$5,$6,$7) RETURNING id`,
      [
        r.id,
        warehouseId,
        merchantId,
        actorId,
        instant,
        randomUUID(),
        'e'.repeat(64),
      ],
    )
  ).rows[0].id;
}
async function group(
  s,
  r,
  i,
  quantity = 4,
  condition = 'NOTED',
  issueType = 'BROKEN',
  overrides = {},
) {
  return (
    await db.query(
      `INSERT INTO return_inspection_lines(inspection_id,receipt_id,receipt_line_id,warehouse_id,merchant_id,item_id,position,quantity,condition,issue_type,notes)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        i,
        r.id,
        overrides.lineId ?? r.lineId,
        warehouseId,
        overrides.merchantId ?? merchantId,
        s.itemId,
        overrides.position ?? 1,
        quantity,
        condition,
        condition === 'GOOD' ? null : issueType,
        condition === 'GOOD' ? null : 'Clear damage to right corner',
      ],
    )
  ).rows[0].id;
}
async function decision(s, g, accepted = true, overrides = {}) {
  return (
    await db.query(
      `INSERT INTO return_reviews(inspection_line_id,warehouse_id,merchant_id,item_id,decision,reason,reviewed_by_id,reviewed_by_name_snapshot,reviewed_at,idempotency_key,request_hash)
 VALUES($1,$2,$3,$4,$5,'Checked carefully and confirmed',$6,'SQL actor',$7,$8,$9) RETURNING id`,
      [
        g,
        warehouseId,
        merchantId,
        s.itemId,
        accepted ? 'ACCEPT_TO_STOCK' : 'REJECT_OUTSIDE_STOCK',
        overrides.actorId ?? actorId,
        overrides.time ?? instant,
        randomUUID(),
        'f'.repeat(64),
      ],
    )
  ).rows[0].id;
}
async function returnMovement(s, g, reviewId = null, overrides = {}) {
  return db.query(
    `INSERT INTO stock_movements(warehouse_id,merchant_id,item_id,item_code_snapshot,item_name_snapshot,kind,quantity_delta,actor_id,actor_name_snapshot,recorded_at,return_inspection_line_id,return_review_id)
 VALUES($1,$2,$3,'MZ-000001',$4,'RETURN_IN',$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      warehouseId,
      overrides.merchantId ?? merchantId,
      s.itemId,
      overrides.name ?? 'SQL item',
      overrides.delta ?? 4,
      actorId,
      overrides.actorName ?? 'SQL actor',
      overrides.time ?? instant,
      g,
      reviewId,
    ],
  );
}
void test('returns database invariants', async (t) => {
  await t.test('valid physical arrival has no movement or balance change', () =>
    isolated(async () => {
      const s = await sentScenario();
      await arrival(s);
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
  await t.test(
    'GOOD inspection posts once and matches source and projection',
    () =>
      isolated(async () => {
        const s = await sentScenario(),
          r = await arrival(s),
          i = await inspection(r),
          g = await group(s, r, i, 4, 'GOOD');
        await returnMovement(s, g);
        await db.query(
          'UPDATE inventory_balances SET quantity=10 WHERE item_id=$1',
          [s.itemId],
        );
        await db.query('SET CONSTRAINTS ALL IMMEDIATE');
      }),
  );
  await t.test('accepted noted review posts once', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r),
        g = await group(s, r, i),
        v = await decision(s, g);
      await returnMovement(s, g, v);
      await db.query(
        'UPDATE inventory_balances SET quantity=10 WHERE item_id=$1',
        [s.itemId],
      );
      await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    }),
  );
  await t.test('rejected group stays outside ledger', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r),
        g = await group(s, r, i);
      await decision(s, g, false);
      await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    }),
  );
  for (const table of [
    'return_receipts',
    'return_receipt_lines',
    'return_inspections',
    'return_inspection_lines',
    'return_reviews',
  ])
    for (const verb of ['UPDATE', 'DELETE'])
      await t.test(`${table} rejects ${verb}`, () =>
        isolated(async () => {
          const s = await sentScenario(),
            r = await arrival(s),
            i = await inspection(r),
            g = await group(s, r, i);
          await decision(s, g, false);
          await reject(
            () =>
              db.query(
                verb === 'UPDATE'
                  ? `UPDATE ${table} SET id=id`
                  : `DELETE FROM ${table}`,
              ),
            '23514',
            'append-only',
          );
        }),
      );
  await t.test('physical ceiling includes earlier arrivals', () =>
    isolated(async () => {
      const s = await sentScenario();
      await arrival(s, 3);
      await reject(() => arrival(s, 2), '23514', 'exceed');
    }),
  );
  await t.test(
    'arrival at repeatable read is explicitly rejected',
    async () => {
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      try {
        const s = await sentScenario();
        await reject(() => arrival(s), '23514', 'read committed');
      } finally {
        await db.query('ROLLBACK');
      }
    },
  );
  await t.test('arrival merchant cannot differ from original dispatch', () =>
    isolated(async () => {
      const s = await sentScenario();
      await reject(
        () => arrival(s, 4, { merchantId: otherMerchantId }),
        '23503',
      );
    }),
  );
  await t.test('arrival source must be a real original shipment line', () =>
    isolated(async () => {
      const s = await sentScenario();
      await reject(
        () => arrival(s, 4, { shipmentLineId: randomUUID() }),
        '23514',
      );
    }),
  );
  await t.test(
    'same merchant/item source from another shipment is rejected',
    () =>
      isolated(async () => {
        const s = await sentScenario();
        const other = (
          await db.query(
            `INSERT INTO shipments(warehouse_id,merchant_id,code,merchant_name_snapshot,registered_by_id,registered_by_name_snapshot,registered_at,idempotency_key,request_hash) VALUES($1,$2,'SH-000002','Merchant MZ',$3,'SQL actor',$4,$5,$6) RETURNING id`,
            [
              warehouseId,
              merchantId,
              actorId,
              instant,
              randomUUID(),
              'a'.repeat(64),
            ],
          )
        ).rows[0].id;
        const line = (
          await db.query(
            `INSERT INTO shipment_lines(shipment_id,warehouse_id,merchant_id,item_id,position,item_code_snapshot,item_name_snapshot,quantity) VALUES($1,$2,$3,$4,1,'MZ-000001','SQL item',4) RETURNING id`,
            [other, warehouseId, merchantId, s.itemId],
          )
        ).rows[0].id;
        await reject(() => arrival(s, 4, { shipmentLineId: line }), '23503');
      }),
  );
  await t.test('same SKU cannot classify another return receipt line', () =>
    isolated(async () => {
      const s = await sentScenario(),
        first = await arrival(s, 2),
        second = await arrival(s, 2),
        i = await inspection(first);
      await reject(
        () =>
          group(s, first, i, 2, 'NOTED', 'BROKEN', { lineId: second.lineId }),
        '23503',
      );
    }),
  );
  await t.test('inspection cannot mix another merchant', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r);
      await reject(
        () =>
          group(s, r, i, 4, 'NOTED', 'BROKEN', { merchantId: otherMerchantId }),
        '23503',
      );
    }),
  );
  await t.test('inspection cannot classify an unknown receipt line', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r);
      await reject(
        () => group(s, r, i, 4, 'NOTED', 'BROKEN', { lineId: randomUUID() }),
        '23503',
      );
    }),
  );
  for (const quantity of [3, 5])
    await t.test(`inspection total ${quantity} fails completeness`, () =>
      isolated(async () => {
        const s = await sentScenario(),
          r = await arrival(s),
          i = await inspection(r);
        await group(s, r, i, quantity);
        await reject(
          () => db.query('SET CONSTRAINTS ALL IMMEDIATE'),
          '23514',
          'classify every',
        );
      }),
    );
  await t.test('empty inspection fails', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s);
      await inspection(r);
      await reject(
        () => db.query('SET CONSTRAINTS ALL IMMEDIATE'),
        '23514',
        'classify every',
      );
    }),
  );
  await t.test('duplicate same issue classification fails', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r);
      await group(s, r, i, 2);
      await reject(
        () => group(s, r, i, 2, 'NOTED', 'BROKEN', { position: 2 }),
        '23505',
      );
    }),
  );
  await t.test('duplicate GOOD classification fails', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r);
      await group(s, r, i, 2, 'GOOD');
      await reject(
        () => group(s, r, i, 2, 'GOOD', null, { position: 2 }),
        '23505',
      );
    }),
  );
  await t.test('GOOD requires its ledger movement', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r);
      await group(s, r, i, 4, 'GOOD');
      await reject(
        () => db.query('SET CONSTRAINTS ALL IMMEDIATE'),
        '23514',
        'must be posted',
      );
    }),
  );
  await t.test('pending noted group cannot post a movement', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r),
        g = await group(s, r, i);
      await reject(() => returnMovement(s, g), '23514', 'approved source');
    }),
  );
  await t.test('rejected group cannot post a movement', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r),
        g = await group(s, r, i),
        v = await decision(s, g, false);
      await reject(() => returnMovement(s, g, v), '23514', 'approved source');
    }),
  );
  await t.test('MISMATCH cannot be accepted by SQL', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r),
        g = await group(s, r, i, 4, 'NOTED', 'MISMATCH');
      await reject(() => decision(s, g), '23514', 'invalid return review');
    }),
  );
  await t.test('GOOD cannot receive a review', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r),
        g = await group(s, r, i, 4, 'GOOD');
      await reject(() => decision(s, g), '23514', 'invalid return review');
    }),
  );
  await t.test('employee cannot review by SQL', () =>
    isolated(async () => {
      const employee = (
        await db.query(
          "INSERT INTO users(email,display_name,password_hash,role) VALUES('employee@example.test','Employee','fixture','EMPLOYEE') RETURNING id",
        )
      ).rows[0].id;
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r),
        g = await group(s, r, i);
      await reject(
        () => decision(s, g, false, { actorId: employee }),
        '23514',
        'invalid return review',
      );
    }),
  );
  await t.test('accepted review requires its movement', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r),
        g = await group(s, r, i);
      await decision(s, g);
      await reject(
        () => db.query('SET CONSTRAINTS ALL IMMEDIATE'),
        '23514',
        'posting does not match',
      );
    }),
  );
  await t.test('review cannot predate inspection', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r),
        g = await group(s, r, i);
      await reject(
        () => decision(s, g, false, { time: '2020-01-01' }),
        '23514',
        'invalid return review',
      );
    }),
  );
  for (const overrides of [
    { delta: 3 },
    { delta: -4 },
    { name: 'Changed item' },
    { actorName: 'Impersonated' },
    { time: '2026-10-09T01:00:00Z' },
  ])
    await t.test(`return movement rejects ${JSON.stringify(overrides)}`, () =>
      isolated(async () => {
        const s = await sentScenario(),
          r = await arrival(s),
          i = await inspection(r),
          g = await group(s, r, i, 4, 'GOOD');
        await reject(() => returnMovement(s, g, null, overrides), '23514');
      }),
    );
  await t.test('return movement cannot use another merchant', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r),
        g = await group(s, r, i, 4, 'GOOD');
      await reject(
        () => returnMovement(s, g, null, { merchantId: otherMerchantId }),
        '23503',
      );
    }),
  );
  await t.test('same group cannot post twice', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r),
        g = await group(s, r, i, 4, 'GOOD');
      await returnMovement(s, g);
      await reject(() => returnMovement(s, g), '23505');
    }),
  );
  await t.test('return projection must equal ledger', () =>
    isolated(async () => {
      const s = await sentScenario(),
        r = await arrival(s),
        i = await inspection(r),
        g = await group(s, r, i, 4, 'GOOD');
      await returnMovement(s, g);
      await reject(
        () => db.query('SET CONSTRAINTS ALL IMMEDIATE'),
        '23514',
        'movement ledger',
      );
    }),
  );
  await t.test(
    'committed receipt and inspection reject late line additions',
    async (child) => {
      await db.query('BEGIN');
      let s, r, i;
      try {
        s = await sentScenario();
        r = await arrival(s, 1);
        i = await inspection(r);
        await group(s, r, i, 1);
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      }
      await isolated(async () => {
        await reject(
          () =>
            db.query(
              `INSERT INTO return_receipt_lines(receipt_id,shipment_id,shipment_line_id,warehouse_id,merchant_id,item_id,position,quantity,item_code_snapshot,item_name_snapshot) VALUES($1,$2,$3,$4,$5,$6,2,1,'MZ-000001','SQL item')`,
              [r.id, s.shipmentId, s.lineId, warehouseId, merchantId, s.itemId],
            ),
          '23514',
          'sealed',
        );
      });
      await isolated(async () => {
        await reject(
          () => group(s, r, i, 1, 'NOTED', 'SCRATCH', { position: 2 }),
          '23514',
          'sealed',
        );
      });
      await child.test(
        'direct concurrent SQL arrivals cannot exceed physical ceiling',
        async () => {
          const target = new URL(source);
          target.pathname = `/${databaseName}`;
          const left = new pg.Client({ connectionString: target.toString() }),
            right = new pg.Client({ connectionString: target.toString() });
          await left.connect();
          await right.connect();
          const receiveDirect = async (connection) => {
            await connection.query('BEGIN');
            try {
              const header = (
                await connection.query(
                  `INSERT INTO return_receipts(warehouse_id,merchant_id,shipment_id,dispatch_id,merchant_name_snapshot,shipment_code_snapshot,received_by_id,received_by_name_snapshot,received_at,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'Merchant MZ','SH-000001',$5,'SQL actor',$6,$7,$8) RETURNING id`,
                  [
                    warehouseId,
                    merchantId,
                    s.shipmentId,
                    s.dispatchId,
                    actorId,
                    instant,
                    randomUUID(),
                    'a'.repeat(64),
                  ],
                )
              ).rows[0].id;
              await connection.query(
                `INSERT INTO return_receipt_lines(receipt_id,shipment_id,shipment_line_id,warehouse_id,merchant_id,item_id,position,quantity,item_code_snapshot,item_name_snapshot) VALUES($1,$2,$3,$4,$5,$6,1,2,'MZ-000001','SQL item')`,
                [
                  header,
                  s.shipmentId,
                  s.lineId,
                  warehouseId,
                  merchantId,
                  s.itemId,
                ],
              );
              await connection.query('COMMIT');
              return 'committed';
            } catch (error) {
              await connection.query('ROLLBACK');
              if (error.code !== '23514') throw error;
              return error.message;
            }
          };
          let concurrent;
          try {
            await db.query('BEGIN');
            await db.query('SELECT id FROM shipments WHERE id=$1 FOR UPDATE', [
              s.shipmentId,
            ]);
            concurrent = Promise.all([
              receiveDirect(left),
              receiveDirect(right),
            ]);
            let bothWaiting = false;
            for (let n = 0; n < 100; n++) {
              await db.query('SELECT pg_stat_clear_snapshot()');
              const waiters = (
                await db.query(
                  "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO return_%'",
                )
              ).rows[0].n;
              if (waiters === 2) {
                bothWaiting = true;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            assert.equal(bothWaiting, true);
            await db.query('COMMIT');
            const results = await concurrent;
            assert.equal(results.filter((x) => x === 'committed').length, 1);
            assert.equal(results.filter((x) => x.includes('exceed')).length, 1);
            assert.equal(
              (
                await db.query(
                  'SELECT sum(quantity)::int AS n FROM return_receipt_lines WHERE shipment_line_id=$1',
                  [s.lineId],
                )
              ).rows[0].n,
              3,
            );
          } finally {
            await db.query('ROLLBACK');
            if (concurrent) await Promise.allSettled([concurrent]);
            await left.end();
            await right.end();
          }
        },
      );
    },
  );
});
