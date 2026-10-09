import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import pg from 'pg';

const source = new URL(process.env.DATABASE_URL);
if (
  !['localhost', '127.0.0.1'].includes(source.hostname) ||
  source.pathname !== '/stocked_dev'
)
  throw new Error(
    'Audit database tests require local stocked_dev configuration',
  );

const databaseName = `stocked_audit_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: source.toString() });
let db;
let created = false;
let actorId;
let merchantId;
let userId;
let warehouseId;
let itemId;

before(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const target = new URL(source);
  target.pathname = `/${databaseName}`;
  db = new pg.Client({ connectionString: target.toString() });
  await db.connect();

  const migrations = new URL('../../prisma/migrations/', import.meta.url);
  const directories = (await readdir(migrations, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const directory of directories) {
    await db.query(
      await readFile(new URL(`${directory}/migration.sql`, migrations), 'utf8'),
    );
  }

  actorId = (
    await db.query(
      `INSERT INTO users(email,display_name,password_hash,role)
       VALUES ('audit-admin@example.test','Audit admin','fixture-hash','ADMIN')
       RETURNING id`,
    )
  ).rows[0].id;
  merchantId = (
    await db.query(
      `INSERT INTO merchants(code,name,phone,created_by_id)
       VALUES ('AU','Audit merchant','01000000000',$1) RETURNING id`,
      [actorId],
    )
  ).rows[0].id;
  userId = (
    await db.query(
      `INSERT INTO users(email,display_name,password_hash,role,created_by_id)
       VALUES ('audit-user@example.test','Audit user','fixture-hash','EMPLOYEE',$1)
       RETURNING id`,
      [actorId],
    )
  ).rows[0].id;
  warehouseId = (await db.query("SELECT id FROM warehouses WHERE code='MAIN'"))
    .rows[0].id;
  itemId = (
    await db.query(
      `INSERT INTO items(merchant_id,ordinal,code,name,weight_kg,created_by_id)
       VALUES ($1,1,'AU-000001','Audit item',0.250,$2) RETURNING id`,
      [merchantId, actorId],
    )
  ).rows[0].id;
});

after(async () => {
  try {
    if (db) await db.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }
});

async function isolated(operation) {
  await db.query('BEGIN');
  try {
    await operation();
  } finally {
    await db.query('ROLLBACK');
  }
}

async function rejects(sql, values, constraint, code = '23514') {
  await isolated(async () => {
    await assert.rejects(
      db.query(sql, values),
      (error) =>
        error.code === code &&
        (constraint === undefined || error.constraint === constraint),
    );
  });
}

const snapshots = () => {
  const rowId = randomUUID();
  const shelfId = randomUUID();
  return {
    ITEM: {
      id: itemId,
      merchantId,
      code: 'AU-000001',
      name: 'Audit item',
      brand: null,
      color: null,
      weightKg: '0.250',
      notes: null,
      isActive: true,
    },
    ROW: {
      id: rowId,
      warehouseId,
      code: 'R1',
      name: 'Audit row',
      isActive: true,
    },
    SHELF: {
      id: shelfId,
      warehouseId,
      rowId,
      merchantId,
      code: 'S1',
      name: 'Audit shelf',
      isActive: true,
    },
    USER: {
      id: userId,
      email: 'audit-user@example.test',
      displayName: 'Audit user',
      role: 'EMPLOYEE',
      merchantId: null,
      isActive: true,
      mustChangePassword: false,
    },
    MERCHANT: {
      id: merchantId,
      code: 'AU',
      name: 'Audit merchant',
      phone: '01000000000',
      isActive: true,
    },
  };
};

const insertEvent = `INSERT INTO audit_events(
  entity_type,entity_id,action,actor_id,actor_name_snapshot,actor_role_snapshot,
  recorded_at,reason,before_snapshot,after_snapshot
) VALUES ($1,$2,$3,$4,'Audit admin','ADMIN',$5,$6,$7,$8) RETURNING *`;
const insertEventWithActorRole = `INSERT INTO audit_events(
  entity_type,entity_id,action,actor_id,actor_name_snapshot,actor_role_snapshot,
  recorded_at,reason,before_snapshot,after_snapshot
) VALUES ($1,$2,$3,$4,'Audit admin',$5,$6,$7,$8,$9) RETURNING *`;

async function createEvent({
  entityType = 'USER',
  entityId,
  action = 'CREATE',
  reason = null,
  before = null,
  after,
}) {
  return (
    await db.query(insertEvent, [
      entityType,
      entityId ?? after.id,
      action,
      actorId,
      '2026-10-09T00:00:00Z',
      reason,
      before,
      after,
    ])
  ).rows[0];
}

void test('durable audit database invariants', async (t) => {
  const validUser = snapshots().USER;
  await t.test(
    'accepts the exact create snapshot for every audited entity',
    () =>
      isolated(async () => {
        const entries = snapshots();
        for (const [entityType, after] of Object.entries(entries)) {
          const row = await createEvent({ entityType, after });
          assert.equal(row.entity_type, entityType);
          assert.equal(row.entity_id, after.id);
          assert.equal(row.action, 'CREATE');
          assert.equal(row.reason, null);
          assert.equal(row.before_snapshot, null);
          assert.deepEqual(row.after_snapshot, after);
        }
      }),
  );

  await t.test('allows employee item creation actor snapshots', () =>
    isolated(async () => {
      const item = snapshots().ITEM;
      for (const actorRole of ['EMPLOYEE', 'WAREHOUSE_KEEPER']) {
        const row = (
          await db.query(insertEventWithActorRole, [
            'ITEM',
            item.id,
            'CREATE',
            actorId,
            actorRole,
            '2026-10-09T00:00:00Z',
            null,
            null,
            item,
          ])
        ).rows[0];
        assert.equal(row.actor_role_snapshot, actorRole);
      }
    }),
  );

  await t.test(
    'accepts a reasoned update with matching before and after identities',
    () =>
      isolated(async () => {
        const before = { ...snapshots().USER };
        const after = { ...before, displayName: 'Renamed audit user' };
        const row = await createEvent({
          entityType: 'USER',
          action: 'UPDATE',
          reason: 'Verified administration change',
          before,
          after,
        });
        assert.deepEqual(row.before_snapshot, before);
        assert.deepEqual(row.after_snapshot, after);
        assert.equal(row.reason, 'Verified administration change');
      }),
  );

  await t.test('accepts status changes and reason length boundaries', () =>
    isolated(async () => {
      const before = { ...validUser };
      const after = { ...before, isActive: false };
      for (const reason of ['1234567890', 'r'.repeat(2000)]) {
        const row = await createEvent({
          entityType: 'USER',
          action: 'STATUS',
          reason,
          before,
          after,
        });
        assert.equal(row.action, 'STATUS');
        assert.equal(row.reason, reason);
      }
    }),
  );

  const invalidSnapshots = [
    [
      'after snapshot with a mismatched target identity',
      { ...validUser, id: randomUUID() },
      null,
      'audit_after_shape',
    ],
    [
      'after snapshot with an unknown field',
      { ...validUser, extra: 'not part of the contract' },
      null,
      'audit_after_shape',
    ],
    [
      'after snapshot containing a password hash',
      { ...validUser, passwordHash: 'must-not-be-stored' },
      null,
      'audit_after_shape',
    ],
    [
      'before snapshot containing a password hash',
      validUser,
      { ...validUser, passwordHash: 'must-not-be-stored' },
      'audit_before_shape',
    ],
    [
      'after snapshot with a non-boolean status',
      { ...validUser, isActive: 'true' },
      null,
      'audit_after_shape',
    ],
  ];
  for (const [name, after, before, constraint] of invalidSnapshots) {
    await t.test(name, () =>
      rejects(
        insertEvent,
        [
          'USER',
          validUser.id,
          before ? 'UPDATE' : 'CREATE',
          actorId,
          '2026-10-09T00:00:00Z',
          before ? 'Verified administration change' : null,
          before,
          after,
        ],
        constraint,
      ),
    );
  }

  const typedSnapshotFailures = [
    [
      'ITEM rejects non-string nullable descriptors',
      'ITEM',
      { ...snapshots().ITEM, brand: 12 },
    ],
    [
      'ITEM rejects a non-fixed-three-decimal weight',
      'ITEM',
      { ...snapshots().ITEM, weightKg: '1.25' },
    ],
    [
      'ITEM rejects zero weight',
      'ITEM',
      { ...snapshots().ITEM, weightKg: '0.000' },
    ],
    [
      'ITEM rejects negative weight',
      'ITEM',
      { ...snapshots().ITEM, weightKg: '-1.000' },
    ],
    [
      'ITEM rejects an invalid merchant UUID',
      'ITEM',
      { ...snapshots().ITEM, merchantId: 'not-a-uuid' },
    ],
    [
      'ROW rejects an invalid warehouse UUID',
      'ROW',
      { ...snapshots().ROW, warehouseId: 'not-a-uuid' },
    ],
    [
      'SHELF rejects an invalid row UUID',
      'SHELF',
      { ...snapshots().SHELF, rowId: 'not-a-uuid' },
    ],
    [
      'USER rejects invalid role values',
      'USER',
      { ...validUser, role: 'OWNER' },
    ],
    [
      'USER rejects invalid merchant UUIDs',
      'USER',
      { ...validUser, merchantId: 'not-a-uuid' },
    ],
    [
      'USER rejects a non-boolean mustChangePassword value',
      'USER',
      { ...validUser, mustChangePassword: 'false' },
    ],
    [
      'USER rejects a non-v4 target identity',
      'USER',
      { ...validUser, id: '00000000-0000-1000-8000-000000000001' },
    ],
  ];
  for (const [name, entityType, after] of typedSnapshotFailures) {
    await t.test(name, () =>
      rejects(
        insertEvent,
        [
          entityType,
          entityType === 'USER' ? validUser.id : after.id,
          'CREATE',
          actorId,
          '2026-10-09T00:00:00Z',
          null,
          null,
          after,
        ],
        'audit_after_shape',
      ),
    );
  }

  await t.test(
    'employee actor snapshots cannot create non-items or update',
    () =>
      isolated(async () => {
        const user = validUser;
        for (const [entityType, action, snapshot, reason, before] of [
          ['USER', 'CREATE', user, null, null],
          [
            'ITEM',
            'UPDATE',
            snapshots().ITEM,
            'Verified administration change',
            snapshots().ITEM,
          ],
        ]) {
          await db.query('SAVEPOINT invalid_actor_role');
          await assert.rejects(
            db.query(insertEventWithActorRole, [
              entityType,
              snapshot.id,
              action,
              actorId,
              'EMPLOYEE',
              '2026-10-09T00:00:00Z',
              reason,
              before,
              snapshot,
            ]),
            (error) =>
              error.code === '23514' && error.constraint === 'audit_actor_role',
          );
          await db.query('ROLLBACK TO SAVEPOINT invalid_actor_role');
        }
      }),
  );

  const reasonFailures = [
    ['reason shorter than ten characters', 'Too short'],
    ['reason with leading whitespace', ' Verified administration change'],
    ['reason with trailing whitespace', 'Verified administration change '],
  ];
  for (const [name, reason] of reasonFailures) {
    await t.test(name, () =>
      rejects(
        insertEvent,
        [
          'USER',
          validUser.id,
          'UPDATE',
          actorId,
          '2026-10-09T00:00:00Z',
          reason,
          validUser,
          validUser,
        ],
        'audit_reason_action',
      ),
    );
  }

  await t.test('rejects a reason longer than the storage limit', () =>
    rejects(
      insertEvent,
      [
        'USER',
        validUser.id,
        'UPDATE',
        actorId,
        '2026-10-09T00:00:00Z',
        'r'.repeat(2001),
        validUser,
        validUser,
      ],
      undefined,
      '22001',
    ),
  );

  await t.test('an update requires a before snapshot and a reason', () =>
    rejects(
      insertEvent,
      [
        'USER',
        validUser.id,
        'UPDATE',
        actorId,
        '2026-10-09T00:00:00Z',
        null,
        null,
        validUser,
      ],
      'audit_reason_action',
    ),
  );

  await t.test('a create must not carry a reason or before snapshot', () =>
    rejects(
      insertEvent,
      [
        'USER',
        validUser.id,
        'CREATE',
        actorId,
        '2026-10-09T00:00:00Z',
        'Verified administration change',
        null,
        validUser,
      ],
      'audit_reason_action',
    ),
  );

  await t.test('audit rows reject updates and deletes', () =>
    isolated(async () => {
      const row = await createEvent({ after: validUser });
      for (const sql of [
        "UPDATE audit_events SET reason='Changed reason' WHERE id=$1",
        'DELETE FROM audit_events WHERE id=$1',
      ]) {
        await db.query('SAVEPOINT immutable_audit_attempt');
        await assert.rejects(
          db.query(sql, [row.id]),
          (error) => error.code === '23514',
        );
        await db.query('ROLLBACK TO SAVEPOINT immutable_audit_attempt');
      }
    }),
  );
});
