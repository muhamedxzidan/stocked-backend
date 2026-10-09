import { randomUUID } from 'node:crypto';
import { createAdminFixture } from '../support/admin-fixture.js';

describe('merchant UUID case normalization across read scopes', () => {
  let f: Awaited<ReturnType<typeof createAdminFixture>>;
  let merchants: MerchantData[];
  let employeeToken: string;
  let stocktakeId: string;
  let activeStocktakeId: string | undefined;

  type MerchantData = {
    id: string;
    token: string;
    itemId: string;
    rowId: string;
    shelfId: string;
    secondShelfId: string;
    movementId: string;
    receiptId: string;
    adjustmentId: string;
    shipmentId: string;
    returnId: string;
    stocktakeId?: string;
  };

  beforeAll(async () => {
    f = await createAdminFixture();
    await f.app.listen(0, '127.0.0.1');
    await f.reset();

    const first = await f.createLocatedMerchant('MZ');
    const second = await f.createMerchant('ZZ');
    const warehouse = await f.database.warehouse.findUniqueOrThrow({
      where: { code: 'MAIN' },
    });
    const secondRow = (
      await f
        .post('/storage-locations/rows', {
          code: 'ROW-ZZ',
          name: 'Row ZZ',
        })
        .expect(201)
    ).body;
    const secondShelf = (
      await f
        .post('/storage-locations/shelves', {
          merchantId: second.id,
          rowId: secondRow.id,
          code: 'S-ZZ',
          name: 'Shelf ZZ',
        })
        .expect(201)
    ).body;
    if (secondRow.warehouseId !== warehouse.id)
      throw new Error('The ZZ test row was not created in the main warehouse');

    const staff = await f.createUser('EMPLOYEE');
    employeeToken = await f.tokenFor(staff.id);
    const firstUser = await f.createUser('MERCHANT', first.id);
    const secondUser = await f.createUser('MERCHANT', second.id);
    const firstToken = await f.tokenFor(firstUser.id);
    const secondToken = await f.tokenFor(secondUser.id);

    const firstSecondShelf = (
      await f
        .post('/storage-locations/shelves', {
          merchantId: first.id,
          rowId: first.rowId,
          code: 'MZ-SECOND',
          name: 'Second MZ shelf',
        })
        .expect(201)
    ).body;
    const secondSecondShelf = (
      await f
        .post('/storage-locations/shelves', {
          merchantId: second.id,
          rowId: secondRow.id,
          code: 'ZZ-SECOND',
          name: 'Second ZZ shelf',
        })
        .expect(201)
    ).body;

    const createMerchantData = async (
      merchantId: string,
      token: string,
      rowId: string,
      shelfId: string,
      secondShelfId: string,
      name: string,
    ): Promise<MerchantData> => {
      const item = (
        await f
          .post('/items', {
            merchantId,
            name,
            brand: null,
            color: null,
            weightKg: '1.000',
          })
          .expect(201)
      ).body;
      const receipt = (
        await f
          .post('/receipts', {
            merchantId,
            lines: [
              {
                itemId: item.id,
                quantity: 20,
                condition: 'GOOD',
                placements: [{ shelfId, quantity: 20 }],
              },
            ],
          })
          .set('Idempotency-Key', randomUUID())
          .expect(201)
      ).body;
      const adjustment = (
        await f
          .post('/stock-adjustments', {
            referenceMovementId: receipt.lines[0].movement.id,
            direction: 'OUT',
            quantity: 1,
            reason: 'Verified merchant scope fixture',
            placements: [{ shelfId, quantity: 1 }],
          })
          .set('Idempotency-Key', randomUUID())
          .expect(201)
      ).body;
      const shipment = (
        await f
          .post('/shipments', {
            merchantId,
            lines: [{ itemId: item.id, quantity: 3 }],
          })
          .set('Idempotency-Key', randomUUID())
          .expect(201)
      ).body;
      await f
        .post(`/shipments/${shipment.id}/prepare`, {})
        .set('Idempotency-Key', randomUUID())
        .expect(201);
      await f
        .post(`/shipments/${shipment.id}/dispatch`, {
          carrierName: 'Scope test carrier',
          trackingNumber: `TRACK-${name}`,
          placements: [{ itemId: item.id, shelfId, quantity: 3 }],
        })
        .set('Idempotency-Key', randomUUID())
        .expect(201);
      const receivedReturn = (
        await f
          .post('/returns', {
            merchantId,
            shipmentId: shipment.id,
            lines: [
              {
                shipmentLineId: shipment.lines[0].id,
                quantity: 1,
                placements: [{ shelfId, quantity: 1 }],
              },
            ],
          })
          .set('Idempotency-Key', randomUUID())
          .expect(201)
      ).body;
      await f
        .post('/storage-locations/transfers', {
          itemId: item.id,
          fromShelfId: shelfId,
          toShelfId: secondShelfId,
          quantity: 1,
          reason: 'Verified merchant scope transfer',
        })
        .set('Idempotency-Key', randomUUID())
        .expect(201);
      return {
        id: merchantId,
        token,
        itemId: item.id,
        rowId,
        shelfId,
        secondShelfId,
        movementId: receipt.lines[0].movement.id,
        receiptId: receipt.id,
        adjustmentId: adjustment.id,
        shipmentId: shipment.id,
        returnId: receivedReturn.id,
      };
    };

    merchants = [
      await createMerchantData(
        first.id,
        firstToken,
        first.rowId,
        first.shelfId,
        firstSecondShelf.id,
        'MZ scope item',
      ),
      await createMerchantData(
        second.id,
        secondToken,
        secondRow.id,
        secondShelf.id,
        secondSecondShelf.id,
        'ZZ scope item',
      ),
    ];

    for (const merchant of merchants) {
      const opened = await f
        .post('/stocktakes', {
          kind: 'MERCHANT',
          targetId: merchant.id,
          directorId: f.adminId,
          participantIds: [f.adminId],
          notes: 'Merchant UUID scope read fixture',
        })
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      const id = opened.body.event.stocktakeId as string;
      merchant.stocktakeId = id;
      if (!stocktakeId) stocktakeId = id;
      activeStocktakeId = id;
      await f
        .post(`/stocktakes/${id}/cancel`, {
          notes: 'Close merchant UUID scope read fixture',
        })
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      activeStocktakeId = undefined;
    }
  }, 120000);

  afterAll(async () => {
    if (f) {
      try {
        if (activeStocktakeId)
          await f
            .post(`/stocktakes/${activeStocktakeId}/cancel`, {
              notes: 'Close merchant UUID scope read fixture',
            })
            .set('Idempotency-Key', randomUUID())
            .expect(200);
      } finally {
        await f.close();
      }
    }
  });

  const mixedCase = (value: string) =>
    value
      .split('')
      .map((character, index) =>
        /[a-f]/i.test(character)
          ? index % 2 === 0
            ? character.toUpperCase()
            : character.toLowerCase()
          : character,
      )
      .join('');

  async function expectOwnCaseVariants(path: string, merchant: MerchantData) {
    const lower = await f
      .get(path, merchant.token)
      .query({ merchantId: merchant.id.toLowerCase() })
      .expect(200);
    const upper = await f
      .get(path, merchant.token)
      .query({ merchantId: merchant.id.toUpperCase() })
      .expect(200);
    const mixed = await f
      .get(path, merchant.token)
      .query({ merchantId: mixedCase(merchant.id) })
      .expect(200);
    expect(upper.body).toEqual(lower.body);
    expect(mixed.body).toEqual(lower.body);
  }

  async function expectScopeBehavior(
    path: string,
    owns: (record: Record<string, unknown>, merchant: MerchantData) => boolean,
    nonEmpty = true,
    testedMerchants = merchants,
    checkForeignList = true,
  ) {
    for (const merchant of testedMerchants) {
      const index = merchants.indexOf(merchant);
      const foreign = merchants[1 - index];
      await expectOwnCaseVariants(path, merchant);
      const lower = await f
        .get(path, merchant.token)
        .query({ merchantId: merchant.id.toLowerCase() })
        .expect(200);
      const noFilter = await f.get(path, merchant.token).expect(200);
      expect(noFilter.body).toEqual(lower.body);
      if (nonEmpty) expect(lower.body.items.length).toBeGreaterThan(0);
      expect(
        lower.body.items.every((record: Record<string, unknown>) =>
          owns(record, merchant),
        ),
      ).toBe(true);

      for (const foreignId of [
        foreign.id.toLowerCase(),
        foreign.id.toUpperCase(),
        mixedCase(foreign.id),
      ])
        await f
          .get(path, merchant.token)
          .query({ merchantId: foreignId })
          .expect(403);

      await f.get(`${path}?merchantId=invalid`, merchant.token).expect(400);
      await f
        .get(
          `${path}?merchantId=${merchant.id}&merchantId=${merchant.id}`,
          merchant.token,
        )
        .expect(400);

      if (checkForeignList) {
        const foreignList = await f
          .get(path, foreign.token)
          .query({ merchantId: foreign.id })
          .expect(200);
        expect(
          foreignList.body.items.every((record: Record<string, unknown>) =>
            owns(record, foreign),
          ),
        ).toBe(true);
        if (nonEmpty) expect(foreignList.body.items.length).toBeGreaterThan(0);
      }

      const staffOwn = await f
        .get(path, employeeToken)
        .query({ merchantId: merchant.id.toUpperCase() })
        .expect(200);
      const staffForeign = await f
        .get(path, employeeToken)
        .query({ merchantId: foreign.id.toUpperCase() })
        .expect(200);
      expect(
        staffOwn.body.items.every((record: Record<string, unknown>) =>
          owns(record, merchant),
        ),
      ).toBe(true);
      expect(
        staffForeign.body.items.every((record: Record<string, unknown>) =>
          owns(record, foreign),
        ),
      ).toBe(true);
      if (nonEmpty) {
        expect(staffOwn.body.items.length).toBeGreaterThan(0);
        if (checkForeignList)
          expect(staffForeign.body.items.length).toBeGreaterThan(0);
        else expect(staffForeign.body.items).toEqual([]);
      }
    }
  }

  it('normalizes own uppercase item merchant IDs', async () => {
    await expectOwnCaseVariants('/items', merchants[0]);
  });

  it('normalizes own uppercase inventory merchant IDs for balances and movements', async () => {
    for (const path of ['/balances', '/movements'])
      await expectOwnCaseVariants(path, merchants[0]);
  });

  it('normalizes own uppercase receipt merchant IDs', async () => {
    await expectOwnCaseVariants('/receipts', merchants[0]);
  });

  it('normalizes own uppercase adjustment merchant IDs', async () => {
    await expectOwnCaseVariants('/stock-adjustments', merchants[0]);
  });

  it('normalizes own uppercase storage location merchant IDs', async () => {
    for (const path of [
      '/storage-locations/rows',
      '/storage-locations/shelves',
      '/storage-locations/balances',
      '/storage-locations/custody',
      '/storage-locations/entries',
      '/storage-locations/transfers',
    ])
      await expectOwnCaseVariants(path, merchants[0]);
  });

  it('normalizes own uppercase stocktake merchant IDs for list, lines and scopes', async () => {
    for (const path of [
      '/stocktakes',
      `/stocktakes/${stocktakeId}/lines`,
      `/stocktakes/${stocktakeId}/scopes`,
    ])
      await expectOwnCaseVariants(path, merchants[0]);
  });

  it('preserves isolation, staff filtering, validation and foreign-detail behavior', async () => {
    const belongsTo = (
      record: Record<string, unknown>,
      merchant: MerchantData,
    ) =>
      record.merchantId === merchant.id ||
      record.id === merchant.rowId ||
      record.id === merchant.stocktakeId;
    const listPaths = [
      '/items',
      '/balances',
      '/movements',
      '/receipts',
      '/stock-adjustments',
      '/storage-locations/rows',
      '/storage-locations/shelves',
      '/storage-locations/balances',
      '/storage-locations/custody',
      '/storage-locations/entries',
      '/storage-locations/transfers',
      '/shipments',
      '/returns',
      '/stocktakes',
      `/stocktakes/${stocktakeId}/lines`,
      `/stocktakes/${stocktakeId}/scopes`,
    ];
    for (const path of listPaths) {
      if (
        path === `/stocktakes/${stocktakeId}/lines` ||
        path === `/stocktakes/${stocktakeId}/scopes`
      )
        continue;
      await expectScopeBehavior(path, belongsTo, true);
    }
    for (const merchant of merchants) {
      for (const suffix of ['lines', 'scopes'])
        await expectScopeBehavior(
          `/stocktakes/${merchant.stocktakeId}/${suffix}`,
          belongsTo,
          true,
          [merchant],
          false,
        );
    }

    const first = merchants[0];
    const second = merchants[1];
    for (const path of [
      `/items/${second.itemId}`,
      `/balances/${second.itemId}`,
      `/movements/${second.movementId}`,
      `/receipts/${second.receiptId}`,
      `/stock-adjustments/${second.adjustmentId}`,
      `/shipments/${second.shipmentId}`,
      `/returns/${second.returnId}`,
    ])
      await f.get(path, first.token).expect(404);
    await f.get(`/stocktakes/${second.stocktakeId}`, first.token).expect(404);
  }, 30000);

  it('keeps shipment and return read filters case-insensitive', async () => {
    for (const path of ['/shipments', '/returns'])
      await expectOwnCaseVariants(path, merchants[0]);
  });
});
