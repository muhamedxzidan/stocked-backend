import { expectOpenApiResponse } from '../support/openapi-response.js';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import request from 'supertest';
import pg from 'pg';
import type { OpenAPIObject } from '@nestjs/swagger';
import {
  createAdminFixture,
  fixturePassword,
} from '../support/admin-fixture.js';

describe('Durable audit event transactions and reads', () => {
  let f: Awaited<ReturnType<typeof createAdminFixture>>;
  const reason = 'Verified inventory administration change';
  beforeAll(async () => {
    f = await createAdminFixture();
    await f.app.listen(0, '127.0.0.1');
  }, 30000);
  beforeEach(async () => {
    await f.reset();
  });
  afterAll(async () => {
    if (f) await f.close();
  });
  async function events(type: string, id: string) {
    return (
      await f
        .get('/audit-events')
        .query({ entityType: type, entityId: id })
        .expect(200)
    ).body.items as {
      id: string;
      entityType: string;
      entityId: string;
      action: string;
      actorId: string;
      actorNameSnapshot: string;
      actorRoleSnapshot: string;
      reason: string | null;
      recordedAt: string;
      beforeSnapshot: Record<string, unknown> | null;
      afterSnapshot: Record<string, unknown>;
    }[];
  }
  async function createEntities() {
    const merchant = (
      await f
        .post('/merchants', {
          code: 'AU',
          name: 'Audited merchant',
          phone: '+201001234567',
        })
        .expect(201)
    ).body;
    const row = (
      await f
        .post('/storage-locations/rows', {
          code: 'AUDIT-ROW',
          name: 'Audited row',
        })
        .expect(201)
    ).body;
    const shelf = (
      await f
        .post('/storage-locations/shelves', {
          code: 'AUDIT-SHELF',
          name: 'Audited shelf',
          merchantId: merchant.id,
          rowId: row.id,
        })
        .expect(201)
    ).body;
    const item = (
      await f
        .post('/items', {
          merchantId: merchant.id,
          name: 'Audited item',
          brand: null,
          color: null,
          weightKg: '1.000',
        })
        .expect(201)
    ).body;
    const user = (
      await f
        .post('/users', {
          email: 'audited@example.test',
          displayName: 'Audited user',
          role: 'EMPLOYEE',
          initialPassword: fixturePassword,
        })
        .expect(201)
    ).body;
    return { merchant, row, shelf, item, user };
  }

  it('persists every create/update/status with safe snapshots, no-op events and matching live response', async () => {
    const e = await createEntities();
    const cases = [
      {
        type: 'MERCHANT',
        value: e.merchant,
        path: `/merchants/${e.merchant.id}`,
        change: { name: 'Renamed merchant' },
        field: 'name',
        statusPath: `/merchants/${e.merchant.id}/status`,
      },
      {
        type: 'ROW',
        value: e.row,
        path: `/storage-locations/rows/${e.row.id}`,
        change: { name: 'Renamed row' },
        field: 'name',
        statusPath: `/storage-locations/rows/${e.row.id}`,
      },
      {
        type: 'SHELF',
        value: e.shelf,
        path: `/storage-locations/shelves/${e.shelf.id}`,
        change: { name: 'Renamed shelf' },
        field: 'name',
        statusPath: `/storage-locations/shelves/${e.shelf.id}`,
      },
      {
        type: 'ITEM',
        value: e.item,
        path: `/items/${e.item.id}`,
        change: { name: 'Renamed item', brand: null, notes: 'Verified notes' },
        field: 'name',
        statusPath: `/items/${e.item.id}/status`,
      },
      {
        type: 'USER',
        value: e.user,
        path: `/users/${e.user.id}`,
        change: { displayName: 'Renamed user' },
        field: 'displayName',
        statusPath: `/users/${e.user.id}/status`,
      },
    ];
    for (const c of cases) {
      const [created] = await events(c.type, c.value.id);
      expect(created).toMatchObject({
        action: 'CREATE',
        actorId: f.adminId,
        actorNameSnapshot: 'Administrator',
        actorRoleSnapshot: 'ADMIN',
        reason: null,
        beforeSnapshot: null,
      });
      const document = (
        await request(f.app.getHttpServer()).get('/api/docs-json').expect(200)
      ).body;
      expectOpenApiResponse(
        document,
        { $ref: '#/components/schemas/AuditEventResponseDto' },
        created,
      );
      expect(created.afterSnapshot[c.field]).toBe(c.value[c.field]);
      expect(Number.isNaN(Date.parse(created.recordedAt))).toBe(false);
      const response = (
        await f
          .patch(c.path, { ...c.change, reason: `  ${reason}  ` })
          .expect(200)
      ).body;
      const [updated] = await events(c.type, c.value.id);
      expect(updated).toMatchObject({
        action: 'UPDATE',
        reason,
        beforeSnapshot: { [c.field]: c.value[c.field] },
        afterSnapshot: { [c.field]: response[c.field] },
      });
      await f.patch(c.path, { ...c.change, reason }).expect(200);
      const [noop] = await events(c.type, c.value.id);
      expect(noop.beforeSnapshot).toEqual(noop.afterSnapshot);
      await f.patch(c.statusPath, { isActive: false, reason }).expect(200);
      const [status] = await events(c.type, c.value.id);
      expect(status).toMatchObject({
        action: 'STATUS',
        beforeSnapshot: { isActive: true },
        afterSnapshot: { isActive: false },
      });
      expect(await events(c.type, c.value.id)).toHaveLength(4);
      expect(
        (await f.get(`/audit-events/${status.id}`).expect(200)).body,
      ).toEqual(status);
    }
    const payload = JSON.stringify(
      (await f.get('/audit-events').expect(200)).body,
    );
    expect(payload).not.toContain(fixturePassword);
    for (const forbidden of [
      'passwordHash',
      'initialPassword',
      'tokenHash',
      'sessionId',
    ])
      expect(payload).not.toContain(forbidden);
    expect((await events('ITEM', e.item.id))[0].afterSnapshot.weightKg).toBe(
      '1.000',
    );
    expect((await events('ITEM', e.item.id))[0].afterSnapshot.brand).toBeNull();
  });

  it('rolls back mutations and revocations when the real audit insert fails', async () => {
    const { merchant, row, shelf, item, user } = await createEntities();
    const activeUser = await f.createUser('EMPLOYEE');
    const activeSessionToken = await f.tokenFor(activeUser.id);
    const merchantUser = await f.createUser('MERCHANT', merchant.id);
    const merchantToken = await f.tokenFor(merchantUser.id);
    const count = await f.database.auditEvent.count();
    await f.database.$executeRawUnsafe(
      `CREATE FUNCTION fail_test_audit_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit insert failure' USING ERRCODE='23514'; END; $$`,
    );
    await f.database.$executeRawUnsafe(
      `CREATE TRIGGER fail_test_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_test_audit_insert()`,
    );
    try {
      for (const [path, change] of [
        [`/items/${item.id}`, { name: 'Must rollback' }],
        [`/storage-locations/rows/${row.id}`, { name: 'Must rollback' }],
        [`/storage-locations/shelves/${shelf.id}`, { name: 'Must rollback' }],
        [`/merchants/${merchant.id}/status`, { isActive: false }],
        [`/users/${activeUser.id}/status`, { isActive: false }],
        [`/users/${user.id}`, { role: 'WAREHOUSE_KEEPER' }],
      ] as const) {
        const response = await f.patch(path, { ...change, reason });
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
      const failed = await f.post('/items', {
        merchantId: merchant.id,
        name: 'Never created',
        brand: null,
        color: null,
        weightKg: '1.000',
      });
      expect(failed.status).toBeGreaterThanOrEqual(400);
      expect(
        await f.database.item.count({ where: { name: 'Never created' } }),
      ).toBe(0);
      expect(
        (await f.database.item.findUniqueOrThrow({ where: { id: item.id } }))
          .name,
      ).toBe(item.name);
      expect(
        (
          await f.database.storageRow.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).name,
      ).toBe(row.name);
      expect(
        (
          await f.database.storageShelf.findUniqueOrThrow({
            where: { id: shelf.id },
          })
        ).name,
      ).toBe(shelf.name);
      expect(
        (
          await f.database.user.findUniqueOrThrow({
            where: { id: activeUser.id },
          })
        ).isActive,
      ).toBe(true);
      expect(
        (await f.database.user.findUniqueOrThrow({ where: { id: user.id } }))
          .role,
      ).toBe('EMPLOYEE');
      expect(
        (
          await f.database.merchant.findUniqueOrThrow({
            where: { id: merchant.id },
          })
        ).isActive,
      ).toBe(true);
      expect(await f.database.auditEvent.count()).toBe(count);
      await f.get('/auth/me', activeSessionToken).expect(200);
      await f.get('/auth/me', merchantToken).expect(200);
    } finally {
      await f.database.$executeRawUnsafe(
        'DROP TRIGGER fail_test_audit ON audit_events',
      );
      await f.database.$executeRawUnsafe(
        'DROP FUNCTION fail_test_audit_insert()',
      );
    }
  });

  it('captures the actor before a self-update and rechecks locked location state', async () => {
    await f
      .patch(`/users/${f.adminId}`, {
        displayName: 'New administrator',
        reason,
      })
      .expect(200);
    const [self] = await events('USER', f.adminId);
    expect(self.actorNameSnapshot).toBe('Administrator');
    expect(self.beforeSnapshot?.displayName).toBe('Administrator');
    expect(self.afterSnapshot.displayName).toBe('New administrator');
    const row = (
      await f
        .post('/storage-locations/rows', {
          code: 'LOCKED',
          name: 'Original row',
        })
        .expect(201)
    ).body;
    const connection = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await connection.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await connection.query('BEGIN');
      const blocker = (await connection.query('SELECT pg_backend_pid() AS pid'))
        .rows[0].pid as number;
      await connection.query('UPDATE storage_rows SET name=$1 WHERE id=$2', [
        'Concurrent correction',
        row.id,
      ]);
      pending = f
        .patch(`/storage-locations/rows/${row.id}`, {
          name: 'Final name',
          reason,
        })
        .then((r) => r);
      let blocked = false;
      for (let i = 0; i < 200; i++) {
        const [state] = await f.database.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND ${blocker}::integer=ANY(pg_blocking_pids(pid))) AS waiting`;
        if (state.waiting) {
          blocked = true;
          break;
        }
        await setTimeout(10);
      }
      expect(blocked).toBe(true);
      await connection.query('COMMIT');
      expect((await pending).status).toBe(200);
      const [updated] = await events('ROW', row.id);
      expect(updated).toMatchObject({
        actorNameSnapshot: 'New administrator',
        beforeSnapshot: { name: 'Concurrent correction' },
        afterSnapshot: { name: 'Final name' },
      });
    } finally {
      await connection.query('ROLLBACK');
      if (pending) await pending;
      await connection.end();
    }
  });

  it('denies non-admin reads, validates reason and filters, and preserves the stocktake gate', async () => {
    const { merchant, row, shelf, item } = await createEntities();
    const [event] = await events('ITEM', item.id);
    for (const role of ['WAREHOUSE_KEEPER', 'EMPLOYEE', 'MERCHANT'] as const) {
      const user = await f.createUser(
        role,
        role === 'MERCHANT' ? merchant.id : null,
      );
      const token = await f.tokenFor(user.id);
      await f.get('/audit-events', token).expect(403);
      await f.get(`/audit-events/${event.id}`, token).expect(403);
    }
    for (const query of [
      { unknown: 'field' },
      { entityType: 'PASSWORD' },
      { entityId: 'bad' },
      { actorId: 'bad' },
      { action: 'DELETE' },
      { page: '1.5' },
      { limit: 101 },
      { from: 'invalid' },
      { from: event.recordedAt, to: event.recordedAt },
    ])
      await f.get('/audit-events').query(query).expect(400);
    const page = (
      await f
        .get('/audit-events')
        .query({
          entityType: 'ITEM',
          entityId: item.id,
          actorId: f.adminId,
          action: 'CREATE',
          from: event.recordedAt,
          to: new Date(Date.parse(event.recordedAt) + 1).toISOString(),
          page: 1,
          limit: 1,
        })
        .expect(200)
    ).body;
    expect(page).toMatchObject({ total: 1, page: 1, limit: 1 });
    expect(page.items[0].id).toBe(event.id);
    expect(
      (
        await f
          .get('/audit-events')
          .query({ to: event.recordedAt, entityId: item.id })
          .expect(200)
      ).body.total,
    ).toBe(0);
    await f.get(`/audit-events/${randomUUID()}`).expect(404);
    for (const invalid of [
      undefined,
      null,
      'short',
      ' '.repeat(12),
      'x'.repeat(2001),
    ])
      await f
        .patch(`/items/${item.id}`, { name: 'Rejected', reason: invalid })
        .expect(400);
    await f.patch(`/items/${item.id}`, { reason }).expect(400);
    const before = await f.database.auditEvent.count();
    const count = (
      await f
        .post('/stocktakes', {
          kind: 'FULL',
          directorId: f.adminId,
          participantIds: [f.adminId],
          notes: 'Scheduled complete audit inventory count',
        })
        .set('Idempotency-Key', randomUUID())
        .expect(200)
    ).body;
    for (const [path, change] of [
      [`/items/${item.id}`, { name: 'Blocked' }],
      [`/storage-locations/rows/${row.id}`, { name: 'Blocked' }],
      [`/storage-locations/shelves/${shelf.id}`, { isActive: false }],
      [`/merchants/${merchant.id}/status`, { isActive: false }],
      [`/users/${f.adminId}`, { displayName: 'Blocked' }],
    ] as const)
      await f.patch(path, { ...change, reason }).expect(409);
    expect(await f.database.auditEvent.count()).toBe(before);
    await f.get('/audit-events').expect(200);
    await f
      .post(`/stocktakes/${count.event.stocktakeId}/cancel`, {
        notes: 'Cancelled scheduled count after verification',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(200);
  });

  it('publishes exact audit query, response and snapshot schemas', async () => {
    const doc = (
      await request(f.app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body as OpenAPIObject;
    const operation = doc.paths['/api/v1/audit-events'].get!;
    const params = operation.parameters as { in: string; name: string }[];
    expect(
      params
        .filter((p) => p.in === 'query')
        .map((p) => p.name)
        .sort(),
    ).toEqual(
      [
        'entityType',
        'entityId',
        'actorId',
        'action',
        'from',
        'to',
        'page',
        'limit',
      ].sort(),
    );
    expect(doc.paths['/api/v1/audit-events'].post).toBeUndefined();
    expect(doc.paths['/api/v1/audit-events/{id}'].delete).toBeUndefined();
    const event = doc.components!.schemas!.AuditEventResponseDto as {
      required: string[];
      properties: Record<string, { anyOf?: unknown[]; nullable?: boolean }>;
    };
    expect(event.required.sort()).toEqual(
      [
        'id',
        'entityType',
        'entityId',
        'action',
        'actorId',
        'actorNameSnapshot',
        'actorRoleSnapshot',
        'recordedAt',
        'reason',
        'beforeSnapshot',
        'afterSnapshot',
      ].sort(),
    );
    expect(event.properties.beforeSnapshot.nullable).toBe(true);
    expect(event.properties.afterSnapshot.anyOf).toHaveLength(5);
    const user = doc.components!.schemas!.UserAuditSnapshotDto as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(user.properties).sort()).toEqual(
      [
        'id',
        'email',
        'displayName',
        'role',
        'merchantId',
        'isActive',
        'mustChangePassword',
      ].sort(),
    );
    for (const name of [
      'UpdateUserDto',
      'SetUserStatusDto',
      'UpdateMerchantDto',
      'SetMerchantStatusDto',
      'UpdateItemDto',
      'SetItemStatusDto',
      'UpdateStorageLocationDto',
    ]) {
      const schema = doc.components!.schemas![name] as { required: string[] };
      expect(schema.required).toContain('reason');
    }
  });
});
