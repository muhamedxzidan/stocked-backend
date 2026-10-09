import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { setTimeout } from 'node:timers/promises';
import { createAdminFixture } from '../support/admin-fixture.js';

describe('Returns custody, inspection and restocking', () => {
  let f: Awaited<ReturnType<typeof createAdminFixture>>,
    merchantId: string,
    itemId: string,
    shipmentId: string,
    shipmentLineId: string;
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
          name: 'Return item',
          brand: null,
          color: null,
          weightKg: '0.500',
        })
        .expect(201)
    ).body.id;
    await f
      .stockPost('/receipts', {
        merchantId,
        lines: [{ itemId, quantity: 20, condition: 'GOOD' }],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const shipment = await f
      .stockPost('/shipments', {
        merchantId,
        lines: [{ itemId, quantity: 10 }],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    shipmentId = shipment.body.id;
    shipmentLineId = shipment.body.lines[0].id;
    await f
      .stockPost(`/shipments/${shipmentId}/prepare`, {})
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await f
      .stockPost(`/shipments/${shipmentId}/dispatch`, {
        carrierName: 'Carrier',
        trackingNumber: 'R-001',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
  });
  afterAll(async () => {
    if (f) await f.close();
  });
  const receive = (quantity = 10, key = randomUUID(), token = f.token) =>
    f
      .stockPost(
        '/returns',
        { merchantId, shipmentId, lines: [{ shipmentLineId, quantity }] },
        token,
      )
      .set('Idempotency-Key', key);
  const inspect = (
    id: string,
    lines: object[],
    key = randomUUID(),
    token = f.token,
  ) =>
    f
      .stockPost(`/returns/${id}/inspect`, { lines }, token)
      .set('Idempotency-Key', key);
  const review = (
    id: string,
    decision = 'ACCEPT_TO_STOCK',
    key = randomUUID(),
    token = f.token,
    reason = 'Checked carefully and confirmed',
  ) =>
    f
      .stockPost(
        `/returns/inspection-lines/${id}/review`,
        { decision, reason },
        token,
      )
      .set('Idempotency-Key', key);
  const balance = async () =>
    (await f.get(`/balances/${itemId}`).expect(200)).body.quantity as number;
  const noted = (
    receiptLineId: string,
    quantity = 10,
    issueType = 'BROKEN',
    notes = 'كسر واضح في الطرف الأيمن من القطعة',
  ) => ({ receiptLineId, quantity, condition: 'NOTED', issueType, notes });
  const good = (receiptLineId: string, quantity = 10) => ({
    receiptLineId,
    quantity,
    condition: 'GOOD',
  });

  it('records separate receiver, inspector and reviewer with server timestamps and mixed quantities', async () => {
    const receiver = await f.createUser(),
      inspector = await f.createUser(),
      reviewer = await f.createUser('WAREHOUSE_KEEPER');
    const arrival = await receive(
      10,
      randomUUID(),
      await f.tokenFor(receiver.id),
    ).expect(201);
    expect(await balance()).toBe(10);
    expect(
      (await f.get(`/returns/${arrival.body.id}`).expect(200)).body.quantities,
    ).toEqual({
      received: 10,
      uninspected: 10,
      restocked: 0,
      pending: 0,
      rejected: 0,
    });
    const examination = await inspect(
      arrival.body.id,
      [good(arrival.body.lines[0].id, 8), noted(arrival.body.lines[0].id, 2)],
      randomUUID(),
      await f.tokenFor(inspector.id),
    ).expect(201);
    expect(await balance()).toBe(18);
    const pending = examination.body.lines[1];
    const decision = await review(
      pending.id,
      'ACCEPT_TO_STOCK',
      randomUUID(),
      await f.tokenFor(reviewer.id),
    ).expect(201);
    expect(await balance()).toBe(20);
    const detail = (await f.get(`/returns/${arrival.body.id}`).expect(200))
      .body;
    expect(detail.status).toBe('RESOLVED');
    expect(detail.timeline).toEqual([
      {
        step: 'RECEIVED',
        actorId: receiver.id,
        actorNameSnapshot: receiver.displayName,
        recordedAt: arrival.body.receivedAt,
      },
      {
        step: 'INSPECTED',
        actorId: inspector.id,
        actorNameSnapshot: inspector.displayName,
        recordedAt: examination.body.inspectedAt,
      },
      {
        step: 'ACCEPT_TO_STOCK',
        actorId: reviewer.id,
        actorNameSnapshot: reviewer.displayName,
        recordedAt: decision.body.reviewedAt,
        inspectionLineId: pending.id,
      },
    ]);
    expect(Date.parse(examination.body.inspectedAt)).toBeGreaterThanOrEqual(
      Date.parse(arrival.body.receivedAt),
    );
    expect(Date.parse(decision.body.reviewedAt)).toBeGreaterThanOrEqual(
      Date.parse(examination.body.inspectedAt),
    );
    expect(detail.quantities).toEqual({
      received: 10,
      uninspected: 0,
      restocked: 10,
      pending: 0,
      rejected: 0,
    });
    const ledger = (await f.get('/movements?kind=RETURN_IN').expect(200)).body
      .items;
    expect(ledger).toHaveLength(2);
    expect(
      ledger.find((m: { quantityDelta: number }) => m.quantityDelta === 8)
        .actorId,
    ).toBe(inspector.id);
    expect(
      ledger.find((m: { quantityDelta: number }) => m.quantityDelta === 2)
        .returnReview.id,
    ).toBe(decision.body.id);
    expect(JSON.stringify(detail)).not.toMatch(
      /requestHash|idempotencyKey|passwordHash|tokenHash/,
    );
  });
  it('keeps all-noted stock neutral and rejection in custody history without restocking', async () => {
    const r = (await receive().expect(201)).body;
    const i = (await inspect(r.id, [noted(r.lines[0].id)]).expect(201)).body;
    expect(await balance()).toBe(10);
    const before = (await f.get(`/returns/${r.id}`).expect(200)).body;
    expect(before.status).toBe('PENDING_REVIEW');
    expect(before.quantities.pending).toBe(10);
    await review(i.lines[0].id, 'REJECT_OUTSIDE_STOCK').expect(201);
    expect(await balance()).toBe(10);
    const after = (await f.get(`/returns/${r.id}`).expect(200)).body;
    expect(after.quantities.rejected).toBe(10);
    expect(after.status).toBe('RESOLVED');
    expect(
      await f.database.stockMovement.count({ where: { kind: 'RETURN_IN' } }),
    ).toBe(0);
    await receive(1).expect(409);
  });
  it('never accepts a mismatched SKU into the expected item balance', async () => {
    const r = (await receive().expect(201)).body;
    const i = (
      await inspect(r.id, [noted(r.lines[0].id, 10, 'MISMATCH')]).expect(201)
    ).body;
    await review(i.lines[0].id).expect(400);
    await review(i.lines[0].id, 'REJECT_OUTSIDE_STOCK').expect(201);
    expect(await balance()).toBe(10);
  });
  it('supports partial multiple arrivals, counting uninspected, pending and rejected physical pieces', async () => {
    const a = (await receive(4).expect(201)).body;
    const i = (await inspect(a.id, [noted(a.lines[0].id, 4)]).expect(201)).body;
    await review(i.lines[0].id, 'REJECT_OUTSIDE_STOCK').expect(201);
    await receive(3).expect(201);
    await receive(3).expect(201);
    await receive(1).expect(409);
    expect(await f.database.returnReceipt.count()).toBe(3);
    expect(await balance()).toBe(10);
  });
  it('serializes competing receivers before checking the physical return ceiling', async () => {
    const token = await f.tokenFor((await f.createUser()).id);
    const replies = await Promise.all([
      receive(6),
      receive(6, randomUUID(), token),
    ]);
    expect(replies.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(await f.database.returnReceiptLine.count()).toBe(1);
  });
  it('replays all three immutable operations and binds the key to payload and actor', async () => {
    const rk = randomUUID(),
      ik = randomUUID(),
      vk = randomUUID();
    const r = (await receive(10, rk).expect(201)).body;
    const lines = [noted(r.lines[0].id)];
    const i = (await inspect(r.id, lines, ik).expect(201)).body;
    const v = (await review(i.lines[0].id, 'ACCEPT_TO_STOCK', vk).expect(201))
      .body;
    expect((await receive(10, rk).expect(200)).body).toEqual(r);
    expect((await inspect(r.id, lines, ik).expect(200)).body).toEqual(i);
    expect(
      (await review(i.lines[0].id, 'ACCEPT_TO_STOCK', vk).expect(200)).body,
    ).toEqual(v);
    await receive(9, rk).expect(409);
    await inspect(r.id, [noted(r.lines[0].id, 10, 'SCRATCH')], ik).expect(409);
    await review(i.lines[0].id, 'REJECT_OUTSIDE_STOCK', vk).expect(409);
    const other = await f.tokenFor((await f.createUser('WAREHOUSE_KEEPER')).id);
    await receive(10, rk, other).expect(409);
    await inspect(r.id, lines, ik, other).expect(409);
    await review(i.lines[0].id, 'ACCEPT_TO_STOCK', vk, other).expect(409);
    await inspect(r.id, lines).expect(409);
    await review(i.lines[0].id).expect(409);
    expect(await balance()).toBe(20);
  });
  it('serializes identical receive/inspect/review requests and competing decisions without double restocking', async () => {
    const rk = randomUUID(),
      rs = await Promise.all([receive(10, rk), receive(10, rk)]);
    expect(rs.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 201]);
    const r = rs[0]!.body,
      ik = randomUUID(),
      lines = [noted(r.lines[0].id)];
    const ins = await Promise.all([
      inspect(r.id, lines, ik),
      inspect(r.id, lines, ik),
    ]);
    expect(ins.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 201]);
    const id = ins[0]!.body.lines[0].id,
      vk = randomUUID();
    const reviews = await Promise.all([
      review(id, 'ACCEPT_TO_STOCK', vk),
      review(id, 'ACCEPT_TO_STOCK', vk),
    ]);
    expect(reviews.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 201,
    ]);
    expect(await balance()).toBe(20);
  });
  it('only keeper/admin review; merchants read their own returns and cannot write any stage', async () => {
    const r = (await receive().expect(201)).body,
      i = (await inspect(r.id, [noted(r.lines[0].id)]).expect(201)).body;
    const employee = await f.tokenFor((await f.createUser()).id);
    await review(
      i.lines[0].id,
      'ACCEPT_TO_STOCK',
      randomUUID(),
      employee,
    ).expect(403);
    const own = await f.tokenFor(
      (await f.createUser('MERCHANT', merchantId)).id,
    );
    const foreignId = (await f.createLocatedMerchant('AB')).id,
      foreign = await f.tokenFor(
        (await f.createUser('MERCHANT', foreignId)).id,
      );
    await f.get(`/returns/${r.id}`, own).expect(200);
    await f.get(`/returns/${r.id}`, foreign).expect(404);
    expect(
      (
        await f
          .get(`/returns?shipmentId=${shipmentId}&itemId=${itemId}`, foreign)
          .expect(200)
      ).body.total,
    ).toBe(0);
    await f.get(`/returns?merchantId=${merchantId}`, foreign).expect(403);
    await receive(1, randomUUID(), own).expect(403);
    await inspect(r.id, [good(r.lines[0].id)], randomUUID(), own).expect(403);
    await review(i.lines[0].id, 'ACCEPT_TO_STOCK', randomUUID(), own).expect(
      403,
    );
    await review(i.lines[0].id).expect(201);
    const ledger = (await f.get('/movements?kind=RETURN_IN', own).expect(200))
      .body.items;
    await f.get(`/movements/${ledger[0].id}`, foreign).expect(404);
  });
  it('allows one decision when different reviewers compete with different keys', async () => {
    const r = (await receive().expect(201)).body;
    const i = (await inspect(r.id, [noted(r.lines[0].id)]).expect(201)).body;
    const keeper = await f.createUser('WAREHOUSE_KEEPER'),
      token = await f.tokenFor(keeper.id);
    const responses = await Promise.all([
      review(i.lines[0].id),
      review(i.lines[0].id, 'REJECT_OUTSIDE_STOCK', randomUUID(), token),
    ]);
    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    const winner = responses.find((r) => r.status === 201)!.body;
    expect(await balance()).toBe(
      winner.decision === 'ACCEPT_TO_STOCK' ? 20 : 10,
    );
    expect(await f.database.returnReview.count()).toBe(1);
    const filtered = (
      await f
        .get(`/returns?reviewerId=${winner.reviewedById}&status=RESOLVED`)
        .expect(200)
    ).body;
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].id).toBe(r.id);
  });
  it('normalizes all source UUIDs and keys without creating items or consuming codes', async () => {
    const key = randomUUID();
    const body = {
      merchantId: merchantId.toUpperCase(),
      shipmentId: shipmentId.toUpperCase(),
      lines: [{ shipmentLineId: shipmentLineId.toUpperCase(), quantity: 10 }],
    };
    const r = (
      await f
        .stockPost('/returns', body)
        .set('Idempotency-Key', key.toUpperCase())
        .expect(201)
    ).body;
    await receive(10, key).expect(200);
    const ik = randomUUID();
    await inspect(
      r.id.toUpperCase(),
      [good(r.lines[0].id.toUpperCase())],
      ik.toUpperCase(),
    ).expect(201);
    await inspect(r.id, [good(r.lines[0].id)], ik).expect(200);
    expect(await f.database.item.count()).toBe(1);
    expect(await balance()).toBe(20);
  });
  it('allows inactive items in physical custody and rejection but blocks GOOD/accepted restocking', async () => {
    await f.database.item.update({
      where: { id: itemId },
      data: { isActive: false },
    });
    const r = (await receive().expect(201)).body;
    await inspect(r.id, [good(r.lines[0].id)]).expect(409);
    expect(await f.database.returnInspection.count()).toBe(0);
    const i = (await inspect(r.id, [noted(r.lines[0].id)]).expect(201)).body;
    await review(i.lines[0].id).expect(409);
    await review(i.lines[0].id, 'REJECT_OUTSIDE_STOCK').expect(201);
    expect(await balance()).toBe(10);
  });
  it('requires an active merchant and an already dispatched matching source shipment', async () => {
    const other = (await f.createLocatedMerchant('AB')).id;
    await f
      .stockPost('/returns', {
        merchantId: other,
        shipmentId,
        lines: [{ shipmentLineId, quantity: 1 }],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(404);
    await f
      .stockPost('/returns', {
        merchantId,
        shipmentId,
        lines: [{ shipmentLineId: randomUUID(), quantity: 1 }],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(400);
    const unsent = (
      await f
        .stockPost('/shipments', {
          merchantId,
          lines: [{ itemId, quantity: 1 }],
        })
        .set('Idempotency-Key', randomUUID())
        .expect(201)
    ).body;
    await f
      .stockPost('/returns', {
        merchantId,
        shipmentId: unsent.id,
        lines: [{ shipmentLineId: unsent.lines[0].id, quantity: 1 }],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    const r = (await receive().expect(201)).body;
    await f.database.merchant.update({
      where: { id: merchantId },
      data: { isActive: false },
    });
    await inspect(r.id, [good(r.lines[0].id)]).expect(409);
  });
  it('rejects incomplete, duplicated and foreign classifications before any posting', async () => {
    const r = (await receive().expect(201)).body,
      l = r.lines[0].id;
    await inspect(r.id, [good(l, 9)]).expect(400);
    await inspect(r.id, [good(l, 11)]).expect(400);
    await inspect(r.id, [good(l, 5), good(l.toUpperCase(), 5)]).expect(400);
    await inspect(r.id, [noted(l, 5), noted(l, 5)]).expect(400);
    await inspect(r.id, [good(randomUUID(), 10)]).expect(400);
    await inspect(r.id, [{ ...good(l), notes: 'unexpected note' }]).expect(400);
    await inspect(r.id, [noted(l, 10, 'BROKEN', 'short')]).expect(400);
    await inspect(r.id, [noted(l, 10, 'BROKEN', '😀'.repeat(5))]).expect(400);
    await inspect(r.id, [
      { receiptLineId: l, quantity: 10, condition: 'NOTED' },
    ]).expect(400);
    expect(await f.database.returnInspection.count()).toBe(0);
    expect(await balance()).toBe(10);
  });
  it('rejects client actor/time/status and nonpositive quantities, invalid reasons/keys and arrays over bounds', async () => {
    await receive(0).expect(400);
    await receive(1.5).expect(400);
    await receive(1, 'bad').expect(400);
    await f
      .stockPost('/returns', {
        merchantId,
        shipmentId,
        receivedAt: '2020-01-01',
        lines: [{ shipmentLineId, quantity: 1 }],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(400);
    await f
      .stockPost('/returns', {
        merchantId,
        shipmentId,
        lines: [
          { shipmentLineId, quantity: 1 },
          { shipmentLineId: shipmentLineId.toUpperCase(), quantity: 1 },
        ],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(400);
    const r = (await receive().expect(201)).body;
    await f
      .stockPost(`/returns/${r.id}/inspect`, {
        lines: [good(r.lines[0].id)],
        inspectedById: f.adminId,
      })
      .set('Idempotency-Key', randomUUID())
      .expect(400);
    await inspect(
      r.id,
      Array.from({ length: 601 }, () => good(r.lines[0].id, 1)),
    ).expect(400);
    const i = (await inspect(r.id, [noted(r.lines[0].id)]).expect(201)).body;
    await review(
      i.lines[0].id,
      'ACCEPT_TO_STOCK',
      randomUUID(),
      f.token,
      'short',
    ).expect(400);
  });
  it('filters receipt state, actors, source shipment, dates and pagination consistently', async () => {
    const a = (await receive(3).expect(201)).body,
      b = (await receive(3).expect(201)).body,
      c = (await receive(4).expect(201)).body;
    await inspect(b.id, [noted(b.lines[0].id, 3)]).expect(201);
    await inspect(c.id, [good(c.lines[0].id, 4)]).expect(201);
    expect(
      (await f.get('/returns?status=RECEIVED').expect(200)).body.items[0].id,
    ).toBe(a.id);
    expect(
      (await f.get('/returns?status=PENDING_REVIEW').expect(200)).body.items[0]
        .id,
    ).toBe(b.id);
    expect(
      (
        await f
          .get(
            `/returns?status=RESOLVED&inspectorId=${f.adminId}&receiverId=${f.adminId}&shipmentId=${shipmentId}&itemId=${itemId}`,
          )
          .expect(200)
      ).body.total,
    ).toBe(1);
    const page = (await f.get('/returns?limit=1').expect(200)).body;
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(3);
    expect(
      (
        await f
          .get(
            `/returns?from=${encodeURIComponent(a.receivedAt)}&to=2099-01-01T00:00:00Z`,
          )
          .expect(200)
      ).body.total,
    ).toBe(3);
    await f
      .get('/returns?from=2026-10-10T00:00:00Z&to=2026-10-09T00:00:00Z')
      .expect(400);
  });
  it('rejects a session expiring while waiting for original shipment lock without recording arrival', async () => {
    const blocker = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await blocker.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM shipments WHERE id=$1 FOR UPDATE', [
        shipmentId,
      ]);
      const pending = receive().then((r) => r);
      let waiting = false;
      for (let j = 0; j < 100; j++) {
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
      expect(await f.database.returnReceipt.count()).toBe(0);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
    }
  });
  it('uses 4MiB only for POST inspection and preserves 16KiB on other routes and methods', async () => {
    const r = (await receive().expect(201)).body;
    const huge = {
      lines: [good(r.lines[0].id)],
      padding: 'x'.repeat(4 * 1024 * 1024),
    };
    await f
      .stockPost(`/returns/${r.id}/inspect`, huge)
      .set('Idempotency-Key', randomUUID())
      .expect(413);
    await f
      .stockPost('/returns', { padding: 'x'.repeat(17000) })
      .set('Idempotency-Key', randomUUID())
      .expect(413);
    await f
      .patch(`/returns/${r.id}/inspect`, { padding: 'x'.repeat(17000) })
      .expect(413);
    await f
      .stockPost(`/returns/${r.id}/inspect/extra`, {
        padding: 'x'.repeat(17000),
      })
      .expect(413);
    await inspect(r.id, [good(r.lines[0].id)]).expect(201);
  });
  it('accepts 600 groups over 100 source lines with Arabic notes and restocks only the GOOD portions', async () => {
    const itemIds: string[] = [itemId];
    for (let n = 1; n < 100; n++) {
      itemIds.push(
        (
          await f
            .stockPost('/items', {
              merchantId,
              name: `Bulk ${n}`,
              brand: null,
              color: null,
              weightKg: '0.100',
            })
            .expect(201)
        ).body.id,
      );
    }
    await f
      .stockPost('/receipts', {
        merchantId,
        lines: itemIds.map((id) => ({
          itemId: id,
          quantity: 6,
          condition: 'GOOD',
        })),
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const shipment = (
      await f
        .stockPost('/shipments', {
          merchantId,
          lines: itemIds.map((id) => ({ itemId: id, quantity: 6 })),
        })
        .set('Idempotency-Key', randomUUID())
        .expect(201)
    ).body;
    await f
      .stockPost(`/shipments/${shipment.id}/prepare`, {})
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await f
      .stockPost(`/shipments/${shipment.id}/dispatch`, {
        carrierName: 'Carrier',
        trackingNumber: 'BULK',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const r = (
      await f
        .stockPost('/returns', {
          merchantId,
          shipmentId: shipment.id,
          lines: shipment.lines.map((l: { id: string }) => ({
            shipmentLineId: l.id,
            quantity: 6,
          })),
        })
        .set('Idempotency-Key', randomUUID())
        .expect(201)
    ).body;
    const lines = r.lines.flatMap((l: { id: string }) => [
      good(l.id, 1),
      ...['BROKEN', 'SCRATCH', 'DAMAGED', 'MISMATCH', 'OTHER'].map((type) =>
        noted(l.id, 1, type, 'خ'.repeat(2000)),
      ),
    ]);
    expect(lines).toHaveLength(600);
    const examination = (await inspect(r.id, lines).expect(201)).body;
    expect(examination.lines).toHaveLength(600);
    const detail = (await f.get(`/returns/${r.id}`).expect(200)).body;
    expect(detail.quantities).toEqual({
      received: 600,
      uninspected: 0,
      restocked: 100,
      pending: 500,
      rejected: 0,
    });
    expect(
      await f.database.stockMovement.count({ where: { kind: 'RETURN_IN' } }),
    ).toBe(100);
  }, 60000);

  it('rolls back inspection, all movements and balances when a posting fails', async () => {
    const r = (await receive().expect(201)).body;
    await f.database.$executeRawUnsafe(
      `CREATE FUNCTION fail_return_test_posting() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='RETURN_IN' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END; $$`,
    );
    await f.database.$executeRawUnsafe(
      `CREATE TRIGGER fail_return_test_posting BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION fail_return_test_posting()`,
    );
    try {
      await inspect(r.id, [good(r.lines[0].id)]).expect(500);
      expect(await f.database.returnInspection.count()).toBe(0);
      expect(await f.database.returnInspectionLine.count()).toBe(0);
      expect(
        await f.database.stockMovement.count({ where: { kind: 'RETURN_IN' } }),
      ).toBe(0);
      expect(await balance()).toBe(10);
    } finally {
      await f.database.$executeRawUnsafe(
        'DROP TRIGGER fail_return_test_posting ON stock_movements',
      );
      await f.database.$executeRawUnsafe(
        'DROP FUNCTION fail_return_test_posting()',
      );
    }
    await inspect(r.id, [good(r.lines[0].id)]).expect(201);
  });

  it('observes coherent derived states while inspection and review commit concurrently', async () => {
    const r = (await receive().expect(201)).body;
    const progress = (async () => {
      const i = (await inspect(r.id, [noted(r.lines[0].id)]).expect(201)).body;
      await review(i.lines[0].id).expect(201);
    })();
    const replies = await Promise.all(
      Array.from({ length: 20 }, () => f.get(`/returns/${r.id}`).expect(200)),
    );
    await progress;
    for (const reply of replies) {
      const d = reply.body;
      expect(d.quantities.received).toBe(
        d.quantities.uninspected +
          d.quantities.restocked +
          d.quantities.pending +
          d.quantities.rejected,
      );
      if (d.status === 'RECEIVED') {
        expect(d.inspection).toBeNull();
        expect(d.timeline).toHaveLength(1);
      } else if (d.status === 'PENDING_REVIEW') {
        expect(d.quantities.pending).toBe(10);
        expect(d.timeline).toHaveLength(2);
      } else {
        expect(d.quantities.restocked).toBe(10);
        expect(d.timeline).toHaveLength(3);
      }
    }
  });

  it('preserves original receiver/inspector/reviewer and item names after renaming', async () => {
    const r = (await receive().expect(201)).body;
    const i = (await inspect(r.id, [noted(r.lines[0].id)]).expect(201)).body;
    const v = (await review(i.lines[0].id).expect(201)).body;
    await f.database.user.update({
      where: { id: f.adminId },
      data: { displayName: 'Changed administrator' },
    });
    await f.database.item.update({
      where: { id: itemId },
      data: { name: 'Changed item' },
    });
    const d = (await f.get(`/returns/${r.id}`).expect(200)).body;
    expect(d.receivedByNameSnapshot).toBe(r.receivedByNameSnapshot);
    expect(d.inspection.inspectedByNameSnapshot).toBe(
      i.inspectedByNameSnapshot,
    );
    expect(d.inspection.lines[0].review.reviewedByNameSnapshot).toBe(
      v.reviewedByNameSnapshot,
    );
    expect(d.lines[0].itemNameSnapshot).toBe('Return item');
  });
  it('documents response models and requires idempotency on POST only', async () => {
    const doc = (
      await request(f.app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    expect(
      doc.paths['/api/v1/returns'].post.responses['201'].content[
        'application/json'
      ].schema.$ref,
    ).toContain('ReturnReceiptResponseDto');
    expect(
      doc.paths['/api/v1/returns'].get.parameters.some(
        (p: { name: string }) => p.name === 'Idempotency-Key',
      ),
    ).toBe(false);
    expect(
      doc.components.schemas.ReturnReadGroupResponseDto.properties.review,
    ).toBeDefined();
  });
  it('accepts a bounded Arabic inspection body above 16KiB across distinct issue groups', async () => {
    const r = (await receive().expect(201)).body;
    const issues = ['BROKEN', 'SCRATCH', 'DAMAGED', 'MISMATCH', 'OTHER'];
    const lines = issues.map((type) =>
      noted(r.lines[0].id, 2, type, 'خ'.repeat(2000)),
    );
    expect(Buffer.byteLength(JSON.stringify({ lines }))).toBeGreaterThan(16384);
    await inspect(r.id, lines).expect(201);
    expect(await balance()).toBe(10);
  });
});
