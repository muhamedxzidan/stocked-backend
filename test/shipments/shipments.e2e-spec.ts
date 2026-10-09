import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { setTimeout } from 'node:timers/promises';
import { createAdminFixture } from '../support/admin-fixture.js';

describe('Shipments lifecycle and stock isolation', () => {
  let f: Awaited<ReturnType<typeof createAdminFixture>>;
  let merchantId: string;
  let itemId: string;
  beforeAll(async () => {
    f = await createAdminFixture();
    await f.app.listen(0, '127.0.0.1');
  }, 30000);
  beforeEach(async () => {
    await f.reset();
    merchantId = (await f.createLocatedMerchant()).id;
    itemId = (
      await f
        .stockPost('/items', {
          merchantId,
          name: 'Shipment item',
          brand: null,
          color: null,
          weightKg: '0.500',
        })
        .expect(201)
    ).body.id as string;
  });
  afterAll(async () => {
    if (f) await f.close();
  });
  const register = (
    quantity = 4,
    key = randomUUID(),
    token = f.token,
    id = itemId,
  ) =>
    f
      .stockPost(
        '/shipments',
        { merchantId, lines: [{ itemId: id, quantity }] },
        token,
      )
      .set('Idempotency-Key', key);
  const prepare = (id: string, key = randomUUID(), token = f.token) =>
    f
      .stockPost(`/shipments/${id}/prepare`, {}, token)
      .set('Idempotency-Key', key);
  const dispatch = (
    id: string,
    key = randomUUID(),
    token = f.token,
    trackingNumber = '001-AB',
  ) =>
    f
      .stockPost(
        `/shipments/${id}/dispatch`,
        { carrierName: 'Bosta', trackingNumber },
        token,
      )
      .set('Idempotency-Key', key);
  const receive = (quantity = 10, id = itemId) =>
    f
      .stockPost('/receipts', {
        merchantId,
        lines: [{ itemId: id, quantity, condition: 'GOOD' }],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
  const balance = async (id = itemId) =>
    (await f.get(`/balances/${id}`).expect(200)).body.quantity as number;

  it('records each actor and server time, keeps registration/preparation stock-neutral, then deducts once', async () => {
    await receive();
    const registrar = await f.createUser('EMPLOYEE');
    const preparer = await f.createUser('EMPLOYEE');
    const sender = await f.createUser('WAREHOUSE_KEEPER');
    const registered = await register(
      4,
      randomUUID(),
      await f.tokenFor(registrar.id),
    ).expect(201);
    expect(registered.body.code).toBe('SH-000001');
    expect(registered.body.lines[0].itemCodeSnapshot).toBe('MZ-000001');
    expect(await balance()).toBe(10);
    const prepared = await prepare(
      registered.body.id,
      randomUUID(),
      await f.tokenFor(preparer.id),
    ).expect(201);
    expect(await balance()).toBe(10);
    const sent = await dispatch(
      registered.body.id,
      randomUUID(),
      await f.tokenFor(sender.id),
    ).expect(201);
    expect(sent.body.trackingNumber).toBe('001-AB');
    expect(await balance()).toBe(6);
    const detail = await f.get(`/shipments/${registered.body.id}`).expect(200);
    expect(detail.body.status).toBe('DISPATCHED');
    expect(detail.body.timeline).toEqual([
      {
        step: 'REGISTERED',
        actorId: registrar.id,
        actorNameSnapshot: registrar.displayName,
        recordedAt: registered.body.registeredAt,
      },
      {
        step: 'PREPARED',
        actorId: preparer.id,
        actorNameSnapshot: preparer.displayName,
        recordedAt: prepared.body.preparedAt,
      },
      {
        step: 'DISPATCHED',
        actorId: sender.id,
        actorNameSnapshot: sender.displayName,
        recordedAt: sent.body.dispatchedAt,
      },
    ]);
    expect(Date.parse(prepared.body.preparedAt)).toBeGreaterThanOrEqual(
      Date.parse(registered.body.registeredAt),
    );
    expect(Date.parse(sent.body.dispatchedAt)).toBeGreaterThanOrEqual(
      Date.parse(prepared.body.preparedAt),
    );
    const ledger = await f
      .get(`/movements?kind=SHIPMENT_OUT&itemId=${itemId}`)
      .expect(200);
    expect(ledger.body.items).toHaveLength(1);
    expect(ledger.body.items[0].quantityDelta).toBe(-4);
    expect(ledger.body.items[0].shipmentDispatch.shipmentId).toBe(
      registered.body.id,
    );
    expect(ledger.body.items[0].actorId).toBe(sender.id);
    expect(ledger.body.items[0].recordedAt).toBe(sent.body.dispatchedAt);
    expect(JSON.stringify(detail.body)).not.toMatch(
      /requestHash|idempotencyKey|passwordHash|tokenHash/,
    );
  });

  it('rejects skipping preparation, repeated preparation and a second dispatch with a fresh key', async () => {
    await receive();
    const { body } = await register().expect(201);
    await dispatch(body.id).expect(409);
    await prepare(body.id).expect(201);
    await prepare(body.id).expect(409);
    await dispatch(body.id).expect(201);
    await dispatch(body.id).expect(409);
    expect(await balance()).toBe(6);
  });

  it('replays immutable results for all three actions and rejects different actors or payloads', async () => {
    await receive();
    const rk = randomUUID();
    const pk = randomUUID();
    const dk = randomUUID();
    const first = await register(4, rk).expect(201);
    const p = await prepare(first.body.id, pk).expect(201);
    const d = await dispatch(first.body.id, dk).expect(201);
    expect((await register(4, rk).expect(200)).body).toEqual(first.body);
    expect((await prepare(first.body.id, pk).expect(200)).body).toEqual(p.body);
    expect((await dispatch(first.body.id, dk).expect(200)).body).toEqual(
      d.body,
    );
    await register(5, rk).expect(409);
    await dispatch(first.body.id, dk, f.token, 'CHANGED').expect(409);
    const employeeToken = await f.tokenFor((await f.createUser()).id);
    await register(4, rk, employeeToken).expect(409);
    await prepare(first.body.id, pk, employeeToken).expect(409);
    await dispatch(first.body.id, dk, employeeToken).expect(409);
    expect(await balance()).toBe(6);
  });

  it('normalizes UUID case consistently without consuming the item sequence', async () => {
    await receive();
    const rk = randomUUID();
    const body = {
      merchantId: merchantId.toUpperCase(),
      lines: [{ itemId: itemId.toUpperCase(), quantity: 3 }],
    };
    const first = await f
      .stockPost('/shipments', body)
      .set('Idempotency-Key', rk.toUpperCase())
      .expect(201);
    await register(3, rk).expect(200);
    await prepare(first.body.id.toUpperCase()).expect(201);
    await dispatch(first.body.id.toUpperCase()).expect(201);
    expect(await balance()).toBe(7);
    const nextItem = await f
      .stockPost('/items', {
        merchantId,
        name: 'Next',
        brand: null,
        color: null,
        weightKg: '0.250',
      })
      .expect(201);
    expect(nextItem.body.code).toBe('MZ-000002');
  });

  it('registers and prepares without reservations but blocks insufficient dispatch, then succeeds after receipt', async () => {
    const { body } = await register().expect(201);
    await prepare(body.id).expect(201);
    expect(await balance()).toBe(0);
    await dispatch(body.id).expect(409);
    expect(await f.database.shipmentDispatch.count()).toBe(0);
    expect(
      await f.database.stockMovement.count({ where: { kind: 'SHIPMENT_OUT' } }),
    ).toBe(0);
    expect((await f.get(`/shipments/${body.id}`)).body.status).toBe('PREPARED');
    await receive(4);
    await dispatch(body.id).expect(201);
    expect(await balance()).toBe(0);
  });

  it('rolls back every line if one item has insufficient stock', async () => {
    await receive();
    const second = (
      await f
        .stockPost('/items', {
          merchantId,
          name: 'Second',
          brand: null,
          color: null,
          weightKg: '0.100',
        })
        .expect(201)
    ).body.id as string;
    const shipment = await f
      .stockPost('/shipments', {
        merchantId,
        lines: [
          { itemId, quantity: 2 },
          { itemId: second, quantity: 1 },
        ],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await prepare(shipment.body.id).expect(201);
    await dispatch(shipment.body.id).expect(409);
    expect(await balance()).toBe(10);
    expect(await balance(second)).toBe(0);
    expect(await f.database.shipmentDispatch.count()).toBe(0);
    expect(
      await f.database.stockMovement.count({ where: { kind: 'SHIPMENT_OUT' } }),
    ).toBe(0);
  });

  it('isolates merchant reads including item, actor, detail and movement sources; forbids all merchant writes', async () => {
    await receive();
    const { body } = await register().expect(201);
    await prepare(body.id).expect(201);
    await dispatch(body.id).expect(201);
    const own = await f.createUser('MERCHANT', merchantId);
    const ownToken = await f.tokenFor(own.id);
    const other = await f.createLocatedMerchant('AB');
    const foreign = await f.createUser('MERCHANT', other.id);
    const foreignToken = await f.tokenFor(foreign.id);
    expect((await f.get('/shipments', ownToken).expect(200)).body.total).toBe(
      1,
    );
    await f.get(`/shipments/${body.id}`, ownToken).expect(200);
    expect(
      (
        await f
          .get(`/shipments?itemId=${itemId}&actorId=${f.adminId}`, foreignToken)
          .expect(200)
      ).body.total,
    ).toBe(0);
    await f.get(`/shipments/${body.id}`, foreignToken).expect(404);
    await f
      .get(`/shipments?merchantId=${merchantId}`, foreignToken)
      .expect(403);
    const ledger = await f
      .get('/movements?kind=SHIPMENT_OUT', ownToken)
      .expect(200);
    await f
      .get(`/movements/${ledger.body.items[0].id}`, foreignToken)
      .expect(404);
    await register(1, randomUUID(), ownToken).expect(403);
    await prepare(body.id, randomUUID(), ownToken).expect(403);
    await dispatch(body.id, randomUUID(), ownToken).expect(403);
  });

  it('requires a merchant, rejects another merchant item and duplicate normalized items', async () => {
    await f
      .stockPost('/shipments', { lines: [{ itemId, quantity: 1 }] })
      .set('Idempotency-Key', randomUUID())
      .expect(400);
    const other = await f.createLocatedMerchant('AB');
    const foreignItem = (
      await f
        .stockPost('/items', {
          merchantId: other.id,
          name: 'Other',
          brand: null,
          color: null,
          weightKg: '0.100',
        })
        .expect(201)
    ).body.id;
    await register(1, randomUUID(), f.token, foreignItem).expect(404);
    await f
      .stockPost('/shipments', {
        merchantId,
        lines: [
          { itemId, quantity: 1 },
          { itemId: itemId.toUpperCase(), quantity: 1 },
        ],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(400);
    expect(await f.database.shipment.count()).toBe(0);
  });

  it('rejects client actor/time/status and invalid quantities, text, keys and oversized bodies', async () => {
    await register(0).expect(400);
    await register(1.5).expect(400);
    await register(1_000_001).expect(400);
    await register(1, 'bad-key').expect(400);
    await f
      .stockPost('/shipments', {
        merchantId,
        registeredById: f.adminId,
        lines: [{ itemId, quantity: 1 }],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(400);
    const { body } = await register().expect(201);
    await f
      .stockPost(`/shipments/${body.id}/prepare`, {
        preparedAt: '2026-01-01T00:00:00Z',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(400);
    await f
      .stockPost(`/shipments/${body.id}/dispatch`, {
        carrierName: '  ',
        trackingNumber: 'x',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(400);
    await f
      .stockPost(`/shipments/${body.id}/dispatch`, {
        carrierName: 'Bosta',
        trackingNumber: 'x',
        dispatchedById: f.adminId,
      })
      .set('Idempotency-Key', randomUUID())
      .expect(400);
    await f
      .stockPost('/shipments', {
        merchantId,
        notes: 'ا'.repeat(20000),
        lines: [{ itemId, quantity: 1 }],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(413);
  });

  it('rechecks active merchant and items at each applicable stage', async () => {
    await receive();
    const { body } = await register().expect(201);
    await f.database.merchant.update({
      where: { id: merchantId },
      data: { isActive: false },
    });
    await register().expect(409);
    await prepare(body.id).expect(409);
    await f.database.merchant.update({
      where: { id: merchantId },
      data: { isActive: true },
    });
    await prepare(body.id).expect(201);
    await f.database.item.update({
      where: { id: itemId },
      data: { isActive: false },
    });
    await register().expect(409);
    await dispatch(body.id).expect(409);
    expect(await balance()).toBe(10);
    await f.get(`/shipments/${body.id}`).expect(200);
  });

  it('keeps original item and actor snapshots after names change', async () => {
    await receive();
    const { body } = await register().expect(201);
    const p = await prepare(body.id).expect(201);
    await f.database.user.update({
      where: { id: f.adminId },
      data: { displayName: 'Renamed administrator' },
    });
    await f.database.item.update({
      where: { id: itemId },
      data: { name: 'Renamed item' },
    });
    const sent = await dispatch(body.id).expect(201);
    const detail = await f.get(`/shipments/${body.id}`).expect(200);
    expect(detail.body.registeredByNameSnapshot).toBe('Administrator');
    expect(detail.body.preparation.preparedByNameSnapshot).toBe(
      p.body.preparedByNameSnapshot,
    );
    expect(detail.body.dispatch.dispatchedByNameSnapshot).toBe(
      'Renamed administrator',
    );
    const ledger = await f.get('/movements?kind=SHIPMENT_OUT').expect(200);
    expect(ledger.body.items[0].itemNameSnapshot).toBe('Shipment item');
    expect(ledger.body.items[0].recordedAt).toBe(sent.body.dispatchedAt);
  });

  it('filters derived status, item, any-stage actor and registration date with pagination', async () => {
    const employee = await f.createUser();
    const token = await f.tokenFor(employee.id);
    const a = await register(1).expect(201);
    const b = await register(2).expect(201);
    await prepare(b.body.id, randomUUID(), token).expect(201);
    expect(
      (await f.get('/shipments?status=REGISTERED').expect(200)).body.items[0]
        .id,
    ).toBe(a.body.id);
    expect(
      (
        await f
          .get(
            `/shipments?status=PREPARED&itemId=${itemId}&actorId=${employee.id}`,
          )
          .expect(200)
      ).body.total,
    ).toBe(1);
    const page = await f.get('/shipments?limit=1').expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBe(2);
    expect(
      (
        await f
          .get(
            `/shipments?from=${encodeURIComponent(a.body.registeredAt)}&to=2099-01-01T00:00:00Z`,
          )
          .expect(200)
      ).body.total,
    ).toBe(2);
    await f
      .get('/shipments?from=2026-10-10T00:00:00Z&to=2026-10-09T00:00:00Z')
      .expect(400);
  });

  it('serializes identical concurrent requests for every operation', async () => {
    await receive();
    const rk = randomUUID();
    const registrations = await Promise.all([register(4, rk), register(4, rk)]);
    expect(registrations.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 201,
    ]);
    const id = registrations[0]!.body.id as string;
    const pk = randomUUID();
    const preparations = await Promise.all([prepare(id, pk), prepare(id, pk)]);
    expect(preparations.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 201,
    ]);
    const dk = randomUUID();
    const dispatches = await Promise.all([dispatch(id, dk), dispatch(id, dk)]);
    expect(dispatches.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 201,
    ]);
    expect(await balance()).toBe(6);
  });

  it('returns a coherent status and complete timeline while milestones commit concurrently', async () => {
    await receive();
    const registered = await register().expect(201);
    const id = registered.body.id as string;
    const progression = (async () => {
      await prepare(id).expect(201);
      await dispatch(id).expect(201);
    })();
    const reads = await Promise.all(
      Array.from({ length: 20 }, () => f.get(`/shipments/${id}`).expect(200)),
    );
    await progression;
    for (const reply of reads) {
      const expected =
        reply.body.status === 'DISPATCHED'
          ? ['REGISTERED', 'PREPARED', 'DISPATCHED']
          : reply.body.status === 'PREPARED'
            ? ['REGISTERED', 'PREPARED']
            : ['REGISTERED'];
      expect(
        reply.body.timeline.map((event: { step: string }) => event.step),
      ).toEqual(expected);
      expect(Boolean(reply.body.preparation)).toBe(
        reply.body.status !== 'REGISTERED',
      );
      expect(Boolean(reply.body.dispatch)).toBe(
        reply.body.status === 'DISPATCHED',
      );
    }
    expect((await f.get(`/shipments/${id}`).expect(200)).body.status).toBe(
      'DISPATCHED',
    );
  });

  it('uses different writers and keys to prove a shipment can leave only once', async () => {
    await receive();
    const { body } = await register().expect(201);
    const token = await f.tokenFor((await f.createUser()).id);
    const preparations = await Promise.all([
      prepare(body.id),
      prepare(body.id, randomUUID(), token),
    ]);
    expect(preparations.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    const results = await Promise.all([
      dispatch(body.id),
      dispatch(body.id, randomUUID(), token),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(await balance()).toBe(6);
  });

  it('competing shipments cannot overspend the same item', async () => {
    await receive(5);
    const a = await register().expect(201);
    const b = await register().expect(201);
    await prepare(a.body.id).expect(201);
    await prepare(b.body.id).expect(201);
    const token = await f.tokenFor((await f.createUser()).id);
    const replies = await Promise.all([
      dispatch(a.body.id),
      dispatch(b.body.id, randomUUID(), token),
    ]);
    expect(replies.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(await balance()).toBe(1);
  });

  it('allocates independent unique shipment codes under concurrent registration', async () => {
    const token = await f.tokenFor((await f.createUser()).id);
    const results = await Promise.all([
      register(1),
      register(1, randomUUID(), token),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(
      results
        .map((r) => r.body.code as string)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(['SH-000001', 'SH-000002']);
  });

  it('rejects expired sessions after waiting for the shipment lock without posting stock', async () => {
    await receive();
    const { body } = await register().expect(201);
    await prepare(body.id).expect(201);
    const blocker = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await blocker.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM shipments WHERE id=$1 FOR UPDATE', [
        body.id,
      ]);
      const pending = dispatch(body.id).then((reply) => reply);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const [row] = await f.database.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM shipments%FOR UPDATE%') AS waiting`;
        if (row.waiting) {
          waiting = true;
          break;
        }
        await setTimeout(10);
      }
      expect(waiting).toBe(true);
      await blocker.query(
        "UPDATE sessions SET expires_at=created_at+interval '1 millisecond' WHERE user_id=$1",
        [f.adminId],
      );
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(401);
      expect(
        (await f.database.inventoryBalance.findFirst({ where: { itemId } }))
          ?.quantity,
      ).toBe(10);
      expect(await f.database.shipmentDispatch.count()).toBe(0);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
    }
  });
});
