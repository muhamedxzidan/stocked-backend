import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import request from 'supertest';
import { ItemsService } from '../../dist/items/items.service.js';
import { ItemCodeService } from '../../dist/items/item-code.service.js';
import { createAdminFixture } from '../support/admin-fixture.js';

describe('Items catalog', () => {
  let f: Awaited<ReturnType<typeof createAdminFixture>>;
  let merchantId: string;
  let service: ItemsService;
  const input = () => ({
    merchantId,
    name: ' Widget ',
    brand: ' Acme ',
    color: ' Blue ',
    weightKg: '0.250',
    notes: ' Catalog note ',
  });
  beforeAll(async () => {
    f = await createAdminFixture();
    await f.app.listen(0, '127.0.0.1');
    service = f.app.get(ItemsService);
  }, 30000);
  beforeEach(async () => {
    vi.restoreAllMocks();
    await f.reset();
    merchantId = (await f.createMerchant()).id;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (f) await f.close();
  });
  async function item() {
    return (await f.post('/items', input()).expect(201)).body;
  }
  async function heldRow(table: 'users' | 'merchants', id: string) {
    const connection = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await connection.connect();
    await connection.query('BEGIN');
    await connection.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [
      id,
    ]);
    const pid = (await connection.query('SELECT pg_backend_pid() AS pid'))
      .rows[0].pid as number;
    return { connection, pid };
  }
  async function waitBlocked(pid: number) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [row] = await f.database.$queryRaw<
        { waiting: boolean }[]
      >`SELECT EXISTS(
    SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid))) AS waiting`;
      if (row.waiting) return;
      await setTimeout(10);
    }
    throw new Error('Expected item transaction did not block');
  }
  it('creates server-owned identity, exact decimal data and no stock quantity', async () => {
    const body = await item();
    expect(body).toMatchObject({
      merchantId,
      code: 'MZ-000001',
      name: 'Widget',
      brand: 'Acme',
      color: 'Blue',
      weightKg: '0.250',
      notes: 'Catalog note',
      isActive: true,
      createdById: f.adminId,
    });
    expect(Object.keys(body).sort()).toEqual(
      [
        'id',
        'merchantId',
        'code',
        'name',
        'brand',
        'color',
        'weightKg',
        'notes',
        'isActive',
        'createdById',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(body.createdAt).getTime()).toBeGreaterThan(0);
    expect(await f.database.item.count()).toBe(1);
  });
  it.each(['ADMIN', 'WAREHOUSE_KEEPER', 'EMPLOYEE'] as const)(
    '%s can create catalog entries',
    async (role) => {
      const actor = await f.createUser(role);
      const token = await f.tokenFor(actor.id);
      const { body } = await f.post('/items', input(), token).expect(201);
      expect(body.createdById).toBe(actor.id);
    },
  );
  it.each(['WAREHOUSE_KEEPER', 'EMPLOYEE', 'MERCHANT'] as const)(
    '%s cannot edit or disable items',
    async (role) => {
      const entry = await item();
      const actor = await f.createUser(
        role,
        role === 'MERCHANT' ? merchantId : null,
      );
      const token = await f.tokenFor(actor.id);
      await f
        .patch(`/items/${entry.id}`, { name: 'Changed' }, token)
        .expect(403);
      await f
        .patch(`/items/${entry.id}/status`, { isActive: false }, token)
        .expect(403);
      if (role === 'MERCHANT')
        await f.post('/items', input(), token).expect(403);
    },
  );
  it('isolates merchants by list, UUID, barcode and label including forged filters', async () => {
    const owned = await item();
    const other = (await f.createMerchant('ZZ')).id;
    const foreign = (
      await f.post('/items', { ...input(), merchantId: other }).expect(201)
    ).body;
    const user = await f.createUser('MERCHANT', merchantId);
    const token = await f.tokenFor(user.id);
    expect(
      (await f.get('/items', token).expect(200)).body.items.map(
        (entry: { id: string }) => entry.id,
      ),
    ).toEqual([owned.id]);
    await f.get(`/items/${owned.id}`, token).expect(200);
    await f.get(`/items/by-code/${owned.code}`, token).expect(200);
    await f.get(`/items/${owned.id}/label`, token).expect(200);
    for (const path of [
      `/items/${foreign.id}`,
      `/items/by-code/${foreign.code}`,
      `/items/${foreign.id}/label`,
    ])
      await f.get(path, token).expect(404);
    await f.get(`/items?merchantId=${other}`, token).expect(403);
    await f.get(`/items?merchantId=${randomUUID()}`, token).expect(403);
  });
  it.each(['WAREHOUSE_KEEPER', 'EMPLOYEE'] as const)(
    '%s can read across merchants',
    async (role) => {
      await item();
      const other = await f.createMerchant('ZZ');
      const second = (
        await f.post('/items', { ...input(), merchantId: other.id }).expect(201)
      ).body;
      const token = await f.tokenFor((await f.createUser(role)).id);
      expect((await f.get('/items', token).expect(200)).body.total).toBe(2);
      await f.get(`/items/by-code/${second.code}`, token).expect(200);
      await f.get(`/items/${second.id}/label`, token).expect(200);
    },
  );
  it('requires a session and completed initial password change on every catalog route', async () => {
    const entry = await item();
    await request(f.app.getHttpServer()).get('/api/v1/items').expect(401);
    const token = await f.tokenFor(
      (await f.createUser('EMPLOYEE', null, true)).id,
    );
    for (const path of [
      '/items',
      `/items/${entry.id}`,
      `/items/by-code/${entry.code}`,
      `/items/${entry.id}/label`,
    ])
      await f.get(path, token).expect(403);
    await f.post('/items', input(), token).expect(403);
  });
  it('rejects invalid weights without rounding or accepting JSON numbers', async () => {
    for (const weightKg of [
      '0',
      '0.000',
      '-1',
      '0.0001',
      '1000000000',
      '1e2',
      '01.2',
      ' 1 ',
      '1.',
      'NaN',
      1,
      null,
    ])
      await f.post('/items', { ...input(), weightKg }).expect(400);
    for (const weightKg of ['0.001', '1', '999999999.999']) {
      const { body } = await f
        .post('/items', { ...input(), weightKg })
        .expect(201);
      expect(body.weightKg).toBe(weightKg === '1' ? '1.000' : weightKg);
    }
  });
  it('requires explicit descriptive fields and rejects forged identity and quantities', async () => {
    for (const field of ['merchantId', 'name', 'brand', 'color', 'weightKg']) {
      const body: Record<string, unknown> = { ...input() };
      delete body[field];
      await f.post('/items', body).expect(400);
    }
    for (const extra of [
      { code: 'ZZ-000001' },
      { ordinal: 42 },
      { balance: 100 },
      { createdById: f.adminId },
      { createdAt: new Date().toISOString() },
      { isActive: false },
    ])
      await f.post('/items', { ...input(), ...extra }).expect(400);
    for (const extra of [
      { name: ' ' },
      { brand: '' },
      { color: ' ' },
      { notes: ' ' },
      { merchantId: 'bad' },
    ])
      await f.post('/items', { ...input(), ...extra }).expect(400);
    await f
      .post('/items', { ...input(), brand: null, color: null, notes: null })
      .expect(201);
    await f
      .post('/items', { ...input(), merchantId: randomUUID() })
      .expect(404);
  });
  it('updates descriptors without changing identity and deactivates without deleting', async () => {
    const entry = await item();
    const changed = (
      await f
        .patch(`/items/${entry.id}`, {
          name: ' New ',
          brand: null,
          color: 'Red',
          weightKg: '1.125',
          notes: null,
        })
        .expect(200)
    ).body;
    expect(changed).toMatchObject({
      code: entry.code,
      merchantId,
      createdById: f.adminId,
      createdAt: entry.createdAt,
      name: 'New',
      brand: null,
      color: 'Red',
      weightKg: '1.125',
      notes: null,
    });
    for (const extra of [
      { code: 'MZ-000005' },
      { merchantId: randomUUID() },
      { createdById: randomUUID() },
      { ordinal: 4 },
      { isActive: false },
      { balance: 3 },
      { name: null },
      { weightKg: '1.2345' },
      {},
    ])
      await f.patch(`/items/${entry.id}`, extra).expect(400);
    await f.patch(`/items/${entry.id}/status`, { isActive: false }).expect(200);
    expect((await f.get('/items?isActive=false').expect(200)).body.total).toBe(
      1,
    );
    await f.get(`/items/${entry.id}`).expect(200);
    expect((await item()).code).toBe('MZ-000002');
    await f.patch(`/items/${entry.id}/status`, { isActive: true }).expect(200);
  });
  it('filters and paginates consistently and validates filters', async () => {
    await item();
    await f
      .post('/items', {
        ...input(),
        name: 'Different',
        brand: null,
        color: null,
      })
      .expect(201);
    const first = (await f.get('/items?limit=1&page=1').expect(200)).body;
    const second = (await f.get('/items?limit=1&page=2').expect(200)).body;
    expect(first.total).toBe(2);
    expect(first.items[0].id).not.toBe(second.items[0].id);
    expect((await f.get('/items?search=acme').expect(200)).body.total).toBe(1);
    expect(
      (
        await f
          .get(`/items?merchantId=${merchantId}&search=MZ-000001`)
          .expect(200)
      ).body.total,
    ).toBe(1);
    for (const query of [
      'limit=101',
      'page=0',
      'isActive=yes',
      'merchantId=bad',
      'extra=1',
      'page=1.1',
    ])
      await f.get(`/items?${query}`).expect(400);
  });
  it('normalizes scanner terminators and serves repeatable authorized label data', async () => {
    const entry = await item();
    expect(
      (await f.get('/items/by-code/mz-000001%0D%0A').expect(200)).body.id,
    ).toBe(entry.id);
    const label = (await f.get(`/items/${entry.id}/label`).expect(200)).body;
    expect(label).toEqual({
      code: 'MZ-000001',
      symbology: 'CODE128',
      itemName: 'Widget',
      merchantName: 'Merchant MZ',
      merchantCode: 'MZ',
    });
    expect((await f.get(`/items/${entry.id}/label`).expect(200)).body).toEqual(
      label,
    );
    expect(await f.database.item.count()).toBe(1);
    await f.get('/items/by-code/bad').expect(400);
    await f.get('/items/by-code/MZ-999999').expect(404);
    await f.get(`/items/${randomUUID()}/label`).expect(404);
    await f.get('/items/not-a-uuid').expect(400);
  });
  it('allocates unique consecutive codes for concurrent writers of one merchant', async () => {
    const actors = await Promise.all(
      Array.from({ length: 20 }, () => f.createUser()),
    );
    const tokens = await Promise.all(
      actors.map((actor) => f.tokenFor(actor.id)),
    );
    const responses = await Promise.all(
      tokens.map((token) => f.post('/items', input(), token)),
    );
    expect(responses.map((response) => response.status)).toEqual(
      Array(20).fill(201),
    );
    const codes = responses
      .map((response) => response.body.code as string)
      .sort((a, b) => a.localeCompare(b));
    expect(codes).toEqual(
      Array.from(
        { length: 20 },
        (_, index) => `MZ-${String(index + 1).padStart(6, '0')}`,
      ),
    );
    expect(await f.database.item.count()).toBe(20);
    expect(
      (
        await f.database.itemCodeSequence.findUniqueOrThrow({
          where: { merchantId },
        })
      ).lastValue,
    ).toBe(20n);
  }, 15000);
  it('keeps independent merchant counters and expands beyond six digits', async () => {
    const other = await f.createMerchant('ZZ');
    await f.database.itemCodeSequence.create({
      data: { merchantId, lastValue: 999999n },
    });
    const actor = await f.createUser();
    const token = await f.tokenFor(actor.id);
    const [a, b] = await Promise.all([
      f.post('/items', input()),
      f.post('/items', { ...input(), merchantId: other.id }, token),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.code).toBe('MZ-1000000');
    expect(b.body.code).toBe('ZZ-000001');
    await f.get('/items/by-code/MZ-1000000').expect(200);
  });
  it('rolls back counter allocation with a failed creation', async () => {
    const codes = f.app.get(ItemCodeService);
    const allocate = codes.allocate.bind(codes);
    const spy = vi
      .spyOn(codes, 'allocate')
      .mockImplementationOnce(async (...args) => {
        await allocate(...args);
        throw new Error('Injected rollback');
      });
    await expect(
      service.create(f.context, { ...input(), name: 'Widget' }),
    ).rejects.toThrow('Injected rollback');
    spy.mockRestore();
    expect(await f.database.item.count()).toBe(0);
    expect(await f.database.itemCodeSequence.count()).toBe(0);
    expect((await item()).code).toBe('MZ-000001');
  });
  it('rejects exhausted counters without overflow or partial writes', async () => {
    await f.database.itemCodeSequence.create({
      data: { merchantId, lastValue: 9223372036854775807n },
    });
    await f.post('/items', input()).expect(409);
    expect(await f.database.item.count()).toBe(0);
    expect(
      (
        await f.database.itemCodeSequence.findUniqueOrThrow({
          where: { merchantId },
        })
      ).lastValue,
    ).toBe(9223372036854775807n);
  });
  it('does not create for an inactive merchant', async () => {
    await f
      .patch(`/merchants/${merchantId}/status`, { isActive: false })
      .expect(200);
    await f.post('/items', input()).expect(400);
    expect(await f.database.itemCodeSequence.count()).toBe(0);
  });
  it.each(['disabled', 'revoked', 'role', 'password'] as const)(
    'rechecks a queued writer after %s changes',
    async (change) => {
      const actor = await f.createUser();
      const token = await f.tokenFor(actor.id);
      const context = await f.sessions.authenticate(token);
      const held = await heldRow('users', actor.id);
      const pending = service.create(context, input()).then(
        () => null,
        (error) => error,
      );
      try {
        await waitBlocked(held.pid);
        if (change === 'disabled')
          await held.connection.query(
            'UPDATE users SET is_active=false WHERE id=$1',
            [actor.id],
          );
        if (change === 'revoked')
          await held.connection.query(
            'UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1',
            [context.sessionId],
          );
        if (change === 'role')
          await held.connection.query(
            "UPDATE users SET role='MERCHANT',merchant_id=$2 WHERE id=$1",
            [actor.id, merchantId],
          );
        if (change === 'password')
          await held.connection.query(
            'UPDATE users SET must_change_password=true WHERE id=$1',
            [actor.id],
          );
        await held.connection.query('COMMIT');
        const failure = await pending;
        expect(failure?.getStatus()).toBe(
          change === 'role' || change === 'password' ? 403 : 401,
        );
        expect(await f.database.item.count()).toBe(0);
        expect(await f.database.itemCodeSequence.count()).toBe(0);
      } finally {
        await held.connection.query('ROLLBACK');
        await held.connection.end();
        await pending;
      }
    },
  );
  it('sees a merchant disabled while waiting for its row lock', async () => {
    const held = await heldRow('merchants', merchantId);
    const pending = service.create(f.context, input()).then(
      () => null,
      (error) => error,
    );
    try {
      await waitBlocked(held.pid);
      await held.connection.query(
        'UPDATE merchants SET is_active=false WHERE id=$1',
        [merchantId],
      );
      await held.connection.query('COMMIT');
      expect((await pending)?.getStatus()).toBe(400);
      expect(await f.database.item.count()).toBe(0);
    } finally {
      await held.connection.query('ROLLBACK');
      await held.connection.end();
      await pending;
    }
  });
  it('holds the merchant lock through allocation and creation', async () => {
    const actor = await f.createUser();
    const context = await f.sessions.authenticate(await f.tokenFor(actor.id));
    const codes = f.app.get(ItemCodeService);
    const allocate = codes.allocate.bind(codes);
    let blockingPid = 0;
    let ready!: () => void;
    const entered = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(codes, 'allocate')
      .mockImplementationOnce(async (...args) => {
        const [row] = await args[0].$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        blockingPid = row.pid;
        ready();
        await gate;
        return allocate(...args);
      });
    const creating = service.create(context, input());
    await entered;
    const connection = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await connection.connect();
    let completed = false;
    const disabling = connection
      .query('UPDATE merchants SET is_active=false WHERE id=$1', [merchantId])
      .then(() => {
        completed = true;
      });
    try {
      await waitBlocked(blockingPid);
      expect(completed).toBe(false);
      release();
      await creating;
      await disabling;
      spy.mockRestore();
      await f.post('/items', input()).expect(400);
      expect(await f.database.item.count()).toBe(1);
    } finally {
      release();
      await creating;
      await disabling;
      await connection.end();
      spy.mockRestore();
    }
  });
  it('documents decimal, role and label contracts in Swagger', async () => {
    const { body } = await request(f.app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(body.paths['/api/v1/items/by-code/{code}']).toBeDefined();
    expect(body.paths['/api/v1/items/{id}/label']).toBeDefined();
    expect(body.components.schemas.CreateItemDto.properties.weightKg.type).toBe(
      'string',
    );
    expect(
      body.components.schemas.ItemLabelDto.properties.symbology.enum,
    ).toEqual(['CODE128']);
  });
});
