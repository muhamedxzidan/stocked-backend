import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { OpenAPIObject } from '@nestjs/swagger';
import { createAdminFixture } from '../support/admin-fixture.js';
import { expectOpenApiResponse } from '../support/openapi-response.js';

describe('Read contracts against real inventory sources', () => {
  let f: Awaited<ReturnType<typeof createAdminFixture>>;
  let merchantId: string,
    itemId: string,
    shelfId: string,
    otherMerchantId: string,
    ownToken: string,
    foreignToken: string;
  let document: OpenAPIObject;
  const notes = 'تم التحقق من المصدر والكميات أثناء الاختبار';
  beforeAll(async () => {
    f = await createAdminFixture();
    await f.app.listen(0, '127.0.0.1');
    document = (
      await request(f.app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
  }, 30000);
  beforeEach(async () => {
    await f.reset();
    const merchant = await f.createLocatedMerchant();
    merchantId = merchant.id;
    shelfId = merchant.shelfId;
    otherMerchantId = (await f.createLocatedMerchant('ZZ')).id;
    itemId = (
      await f
        .post('/items', {
          merchantId,
          name: 'Contract item',
          brand: null,
          color: null,
          weightKg: '1.000',
        })
        .expect(201)
    ).body.id;
    ownToken = await f.tokenFor(
      (await f.createUser('MERCHANT', merchantId)).id,
    );
    foreignToken = await f.tokenFor(
      (await f.createUser('MERCHANT', otherMerchantId)).id,
    );
  });
  afterAll(async () => {
    if (f) await f.close();
  });
  const command = (path: string, body: object, key = randomUUID()) =>
    f.post(path, body).set('Idempotency-Key', key);
  function matches(name: string, body: unknown) {
    expectOpenApiResponse(
      document,
      { $ref: `#/components/schemas/${name}` },
      body,
    );
  }

  it('documents zero balances and immutable receipt/adjustment replies, including nullable fields and replay status', async () => {
    const empty = (await f.get(`/balances/${itemId}`).expect(200)).body;
    expect(empty.quantity).toBe(0);
    expect(empty.updatedAt).toBeNull();
    matches('InventoryBalanceResponseDto', empty);
    matches(
      'InventoryBalancesResponseDto',
      (await f.get('/balances').expect(200)).body,
    );
    const body = {
      merchantId,
      lines: [
        {
          itemId,
          quantity: 5,
          condition: 'GOOD',
          placements: [{ shelfId, quantity: 5 }],
        },
      ],
    };
    const key = randomUUID();
    const receipt = (await command('/receipts', body, key).expect(201)).body;
    const replay = (await command('/receipts', body, key).expect(200)).body;
    expect(replay).toEqual(receipt);
    matches('ReceiptResponseDto', receipt);
    matches('ReceiptResponseDto', replay);
    expect(receipt.notes).toBeNull();
    expect(receipt.lines[0].issueType).toBeNull();
    matches(
      'ReceiptListResponseDto',
      (await f.get('/receipts').expect(200)).body,
    );
    const adjustmentBody = {
      referenceMovementId: receipt.lines[0].movement.id,
      direction: 'OUT',
      quantity: 1,
      reason: notes,
      placements: [{ shelfId, quantity: 1 }],
    };
    const adjustmentKey = randomUUID();
    const adjustment = (
      await command('/stock-adjustments', adjustmentBody, adjustmentKey).expect(
        201,
      )
    ).body;
    const repeated = (
      await command('/stock-adjustments', adjustmentBody, adjustmentKey).expect(
        200,
      )
    ).body;
    expect(repeated).toEqual(adjustment);
    matches('AdjustmentResponseDto', adjustment);
    matches('AdjustmentResponseDto', repeated);
    expect(adjustment.stocktakeLineId).toBeNull();
    expect(adjustment.referenceMovementId).toBe(receipt.lines[0].movement.id);
    matches(
      'AdjustmentListResponseDto',
      (await f.get('/stock-adjustments').expect(200)).body,
    );
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      4,
    );
    await f.post('/receipts', body).expect(400);
    await f.post('/stock-adjustments', adjustmentBody).expect(400);
    await f
      .post('/stock-adjustments', adjustmentBody, ownToken)
      .set('Idempotency-Key', randomUUID())
      .expect(403);
    await f.get(`/receipts/${receipt.id}`, foreignToken).expect(404);
    await f
      .get(`/stock-adjustments/${adjustment.id}`, foreignToken)
      .expect(404);
    await f.get(`/balances/${itemId}`, foreignToken).expect(404);
    matches(
      'ReceiptResponseDto',
      (await f.get(`/receipts/${receipt.id}`, ownToken).expect(200)).body,
    );
    matches(
      'AdjustmentResponseDto',
      (await f.get(`/stock-adjustments/${adjustment.id}`, ownToken).expect(200))
        .body,
    );
    for (const path of [
      'balances',
      'movements',
      'receipts',
      'stock-adjustments',
    ]) {
      await f
        .get(`/${path}?merchantId=${otherMerchantId}`, ownToken)
        .expect(403);
      expect(
        (await f.get(`/${path}`, foreignToken).expect(200)).body.items,
      ).toEqual([]);
    }
  });

  it('matches nested receipt, manual/count settlement, shipment and GOOD/reviewed-return movement contracts', async () => {
    const receipt = (
      await command('/receipts', {
        merchantId,
        lines: [
          {
            itemId,
            quantity: 10,
            condition: 'GOOD',
            placements: [{ shelfId, quantity: 10 }],
          },
        ],
      }).expect(201)
    ).body;
    await command('/stock-adjustments', {
      referenceMovementId: receipt.lines[0].movement.id,
      direction: 'OUT',
      quantity: 1,
      reason: notes,
      placements: [{ shelfId, quantity: 1 }],
    }).expect(201);
    const shipment = (
      await command('/shipments', {
        merchantId,
        lines: [{ itemId, quantity: 4 }],
      }).expect(201)
    ).body;
    await command(`/shipments/${shipment.id}/prepare`, {}).expect(201);
    await command(`/shipments/${shipment.id}/dispatch`, {
      carrierName: 'Carrier',
      trackingNumber: 'CONTRACT',
      placements: [{ itemId, shelfId, quantity: 4 }],
    }).expect(201);
    const arrival = (
      await command('/returns', {
        merchantId,
        shipmentId: shipment.id,
        lines: [
          {
            shipmentLineId: shipment.lines[0].id,
            quantity: 4,
            placements: [{ shelfId, quantity: 4 }],
          },
        ],
      }).expect(201)
    ).body;
    const inspection = (
      await command(`/returns/${arrival.id}/inspect`, {
        lines: [
          {
            receiptLineId: arrival.lines[0].id,
            quantity: 1,
            condition: 'GOOD',
            placements: [{ shelfId, quantity: 1 }],
          },
          {
            receiptLineId: arrival.lines[0].id,
            quantity: 3,
            condition: 'NOTED',
            issueType: 'SCRATCH',
            notes,
          },
        ],
      }).expect(201)
    ).body;
    const pending = inspection.lines.find(
      (line: { condition: string }) => line.condition === 'NOTED',
    );
    await command(`/returns/inspection-lines/${pending.id}/review`, {
      decision: 'ACCEPT_TO_STOCK',
      reason: notes,
      placements: [{ shelfId, quantity: 3 }],
    }).expect(201);
    const opened = (
      await command('/stocktakes', {
        kind: 'MERCHANT',
        targetId: merchantId,
        directorId: f.adminId,
        participantIds: [f.adminId],
        notes,
      }).expect(200)
    ).body;
    const id = opened.event.stocktakeId;
    const snapshot = (await f.get(`/stocktakes/${id}/lines`).expect(200)).body
      .items;
    for (const line of snapshot)
      await command(`/stocktakes/${id}/counts`, {
        lineId: line.id,
        expectedVersion: 0,
        quantity:
          line.expectedQuantity - (line.category === 'AVAILABLE' ? 1 : 0),
        reason: notes,
      }).expect(200);
    await command(`/stocktakes/${id}/submit`, { notes }).expect(200);
    await command(`/stocktakes/${id}/approve`, {
      notes,
      confirmAttendance: true,
    }).expect(200);
    const page = (await f.get(`/movements?itemId=${itemId}`).expect(200)).body;
    matches('InventoryMovementsResponseDto', page);
    expect(page.items).toHaveLength(6);
    const receiptMovement = page.items.find(
      (m: { kind: string }) => m.kind === 'RECEIPT_IN',
    );
    expect(receiptMovement.receiptLine.receipt.id).toBe(receipt.id);
    const manual = page.items.find(
      (m: { adjustment?: { referenceMovementId: string } }) =>
        m.adjustment?.referenceMovementId === receiptMovement.id,
    );
    expect(manual.adjustment.stocktakeLineId).toBeNull();
    const settlement = page.items.find(
      (m: { adjustment?: { stocktakeLineId?: string } }) =>
        m.adjustment?.stocktakeLineId,
    );
    expect(settlement.adjustment.referenceMovementId).toBeNull();
    const dispatched = page.items.find(
      (m: { kind: string }) => m.kind === 'SHIPMENT_OUT',
    );
    expect(dispatched.shipmentDispatch.shipmentId).toBe(shipment.id);
    const returned = page.items.filter(
      (m: { kind: string }) => m.kind === 'RETURN_IN',
    );
    expect(returned).toHaveLength(2);
    expect(
      returned.find((m: { returnReview: unknown }) => m.returnReview === null)
        .returnInspectionLine.condition,
    ).toBe('GOOD');
    expect(
      returned.find((m: { returnReview: unknown }) => m.returnReview !== null)
        .returnReview.decision,
    ).toBe('ACCEPT_TO_STOCK');
    for (const movement of page.items) {
      matches(
        'InventoryMovementResponseDto',
        (await f.get(`/movements/${movement.id}`).expect(200)).body,
      );
      matches(
        'InventoryMovementResponseDto',
        (await f.get(`/movements/${movement.id}`, ownToken).expect(200)).body,
      );
      await f.get(`/movements/${movement.id}`, foreignToken).expect(404);
      for (const source of [
        'receiptLine',
        'adjustment',
        'shipmentLine',
        'shipmentDispatch',
        'returnInspectionLine',
        'returnReview',
      ])
        expect(movement).toHaveProperty(source);
    }
    const adjustments = (await f.get('/stock-adjustments').expect(200)).body;
    matches('AdjustmentListResponseDto', adjustments);
    expect(adjustments.items).toHaveLength(2);
    for (const a of adjustments.items) {
      matches(
        'AdjustmentResponseDto',
        (await f.get(`/stock-adjustments/${a.id}`, ownToken).expect(200)).body,
      );
      await f.get(`/stock-adjustments/${a.id}`, foreignToken).expect(404);
    }
    const balance = (await f.get(`/balances/${itemId}`, ownToken).expect(200))
      .body;
    matches('InventoryBalanceResponseDto', balance);
    expect(balance.quantity).toBe(8);
    expect(
      page.items.reduce(
        (sum: number, m: { quantityDelta: number }) => sum + m.quantityDelta,
        0,
      ),
    ).toBe(8);
    expect(
      (
        await f
          .get(`/movements?itemId=${itemId}&kind=RETURN_IN&limit=1`, ownToken)
          .expect(200)
      ).body.total,
    ).toBe(2);
  });
});
