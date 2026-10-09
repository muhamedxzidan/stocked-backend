import { randomUUID } from 'node:crypto';
import { createAdminFixture } from '../support/admin-fixture.js';

describe('Receipts and stock ledger', () => {
  let f: Awaited<ReturnType<typeof createAdminFixture>>;
  let merchantId: string;
  let itemId: string;

  beforeAll(async () => {
    f = await createAdminFixture();
    await f.app.listen(0, '127.0.0.1');
  }, 30000);
  beforeEach(async () => {
    await f.reset();
    const merchant = await f.createMerchant();
    merchantId = merchant.id;
    const response = await f
      .post('/items', {
        merchantId,
        name: 'Test item',
        brand: null,
        color: null,
        weightKg: '0.250',
      })
      .expect(201);
    itemId = response.body.id as string;
  });
  afterAll(async () => {
    if (f) await f.close();
  });

  const notedLine = (quantity: number) => ({
    itemId,
    quantity,
    condition: 'NOTED',
    issueType: 'SCRATCH',
    notes: 'خدش واضح في الغطاء الأمامي بطول 2 سم',
  });
  const receiptBody = (quantity = 4) => ({
    merchantId,
    lines: [{ itemId, quantity, condition: 'GOOD' }, notedLine(2)],
  });
  const receive = (body: object, key = randomUUID(), token = f.token) =>
    f.post('/receipts', body, token).set('Idempotency-Key', key);

  it('records actor, server time, noted defects, ledger movement and total quantity atomically', async () => {
    const employee = await f.createUser('EMPLOYEE');
    const token = await f.tokenFor(employee.id);
    const { body } = await receive(receiptBody(), randomUUID(), token).expect(
      201,
    );
    expect(body.receivedById).toBe(employee.id);
    expect(body.receivedByNameSnapshot).toBe(employee.displayName);
    expect(Date.parse(body.receivedAt)).toBeGreaterThan(0);
    expect(
      body.lines.map((line: { condition: string; quantity: number }) => [
        line.condition,
        line.quantity,
      ]),
    ).toEqual([
      ['GOOD', 4],
      ['NOTED', 2],
    ]);
    expect(body.lines[1].notes).toContain('خدش واضح');
    expect(
      body.lines.every((line: { movement: { id: string } }) =>
        Boolean(line.movement.id),
      ),
    ).toBe(true);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      6,
    );
    const ledger = await f.get(`/movements?itemId=${itemId}`).expect(200);
    expect(ledger.body.items).toHaveLength(2);
    expect(
      ledger.body.items.every(
        (movement: { actorNameSnapshot: string; quantityDelta: number }) =>
          movement.actorNameSnapshot === employee.displayName &&
          movement.quantityDelta > 0,
      ),
    ).toBe(true);
    expect(ledger.body.items[0].recordedAt).toBe(body.receivedAt);
  });

  it('replays an identical idempotent request but rejects a changed body or another actor', async () => {
    const key = randomUUID();
    const body = receiptBody();
    const first = await receive(body, key).expect(201);
    const replay = await receive(body, key).expect(200);
    expect(replay.body.id).toBe(first.body.id);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      6,
    );
    await receive(receiptBody(9), key).expect(409);
    const employee = await f.createUser('EMPLOYEE');
    await receive(body, key, await f.tokenFor(employee.id)).expect(409);
  });

  it('serializes duplicate in-flight requests with the same idempotency key', async () => {
    const key = randomUUID();
    const body = {
      merchantId,
      lines: [{ itemId, quantity: 6, condition: 'GOOD' }],
    };
    const replies = await Promise.all([receive(body, key), receive(body, key)]);
    expect(replies.map((reply) => reply.status)).toEqual(
      expect.arrayContaining([200, 201]),
    );
    expect(replies[0]!.body.id).toBe(replies[1]!.body.id);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      6,
    );
  });

  it('serializes concurrent first receipts so no quantity is lost', async () => {
    const make = (quantity: number) => ({
      merchantId,
      lines: [{ itemId, quantity, condition: 'GOOD' }],
    });
    const results = await Promise.all([
      receive(make(3), randomUUID()).expect(201),
      receive(make(5), randomUUID()).expect(201),
    ]);
    expect(results).toHaveLength(2);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      8,
    );
    const ledger = await f.get(`/movements?itemId=${itemId}`).expect(200);
    expect(
      ledger.body.items.reduce(
        (sum: number, row: { quantityDelta: number }) =>
          sum + row.quantityDelta,
        0,
      ),
    ).toBe(8);
  });

  it('allows only keepers and admins to correct stock against an original receipt', async () => {
    const { body: receipt } = await receive({
      merchantId,
      lines: [{ itemId, quantity: 5, condition: 'GOOD' }],
    }).expect(201);
    const sourceMovementId = receipt.lines[0].movement.id as string;
    const employee = await f.createUser('EMPLOYEE');
    const employeeToken = await f.tokenFor(employee.id);
    const adjustment = {
      referenceMovementId: sourceMovementId,
      direction: 'OUT',
      quantity: 2,
      reason: 'تم تسجيل خمس قطع بالخطأ والكمية الفعلية ثلاث',
    };
    await f
      .post('/stock-adjustments', adjustment, employeeToken)
      .set('Idempotency-Key', randomUUID())
      .expect(403);
    const keeper = await f.createUser('WAREHOUSE_KEEPER');
    const keeperToken = await f.tokenFor(keeper.id);
    const { body: change } = await f
      .post('/stock-adjustments', adjustment, keeperToken)
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(change.performedById).toBe(keeper.id);
    expect(change.performedByNameSnapshot).toBe(keeper.displayName);
    expect(Date.parse(change.recordedAt)).toBeGreaterThan(0);
    expect(change.quantityDelta).toBe(-2);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      3,
    );
    const tooMuch = { ...adjustment, quantity: 4 };
    await f
      .post('/stock-adjustments', tooMuch, keeperToken)
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      3,
    );
  });

  it('keeps merchant receipt, balance and movement reads within its own merchant boundary', async () => {
    const otherMerchant = await f.createMerchant('ZZ');
    const otherItem = (
      await f
        .post('/items', {
          merchantId: otherMerchant.id,
          name: 'Other item',
          brand: null,
          color: null,
          weightKg: '1.000',
        })
        .expect(201)
    ).body;
    const foreignReceipt = {
      merchantId: otherMerchant.id,
      lines: [{ itemId: otherItem.id, quantity: 7, condition: 'GOOD' }],
    };
    await receive(foreignReceipt).expect(201);
    const ownUser = await f.createUser('MERCHANT', merchantId);
    const token = await f.tokenFor(ownUser.id);
    await f.get(`/balances/${otherItem.id}`, token).expect(404);
    await f.get('/balances?merchantId=' + otherMerchant.id, token).expect(403);
    await f.get('/receipts?merchantId=' + otherMerchant.id, token).expect(403);
    await f
      .get(`/movements?itemId=${otherItem.id}`, token)
      .expect(200)
      .then((result) => expect(result.body.total).toBe(0));
  });

  it('rejects ambiguous defect descriptions and disallows direct edits to ledger history', async () => {
    await receive({ merchantId, lines: [notedLine(1)] })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await receive({ merchantId, lines: [{ ...notedLine(1), notes: 'خدش' }] })
      .set('Idempotency-Key', randomUUID())
      .expect(400);
    const receipt = await f.database.receipt.findFirstOrThrow({
      include: { lines: true },
    });
    await expect(
      f.database.receipt.update({
        where: { id: receipt.id },
        data: { notes: 'changed' },
      }),
    ).rejects.toThrow();
    await expect(
      f.database.receiptLine.delete({ where: { id: receipt.lines[0]!.id } }),
    ).rejects.toThrow();
    await expect(f.database.stockMovement.deleteMany()).rejects.toThrow();
    const balance = await f.database.inventoryBalance.findFirstOrThrow();
    await expect(
      f.database.inventoryBalance.update({
        where: {
          warehouseId_itemId: { warehouseId: balance.warehouseId, itemId },
        },
        data: { quantity: 50 },
      }),
    ).rejects.toThrow();
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      1,
    );
  });
});
