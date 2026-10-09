import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { setTimeout } from 'node:timers/promises';
import { createAdminFixture } from '../support/admin-fixture.js';

describe('Stocktake, shelf allocation and global write gate', () => {
  let f: Awaited<ReturnType<typeof createAdminFixture>>;
  let merchantId: string,
    itemId: string,
    shelfId: string,
    rowId: string,
    secondShelfId: string,
    keeperId: string,
    keeperToken: string,
    otherMerchantId: string,
    otherShelfId: string;
  const notes = 'تمت مراجعة العد والحضور في المخزن';
  beforeAll(async () => {
    f = await createAdminFixture();
    await f.app.listen(0, '127.0.0.1');
  }, 30000);
  beforeEach(async () => {
    await f.reset();
    const m = await f.createLocatedMerchant();
    merchantId = m.id;
    shelfId = m.shelfId;
    rowId = m.rowId;
    const other = await f.createLocatedMerchant('ZZ');
    otherMerchantId = other.id;
    otherShelfId = other.shelfId;
    secondShelfId = (
      await f
        .post('/storage-locations/shelves', {
          merchantId,
          rowId,
          code: 'MZ-SECOND',
          name: 'Second shelf',
        })
        .expect(201)
    ).body.id;
    itemId = (
      await f
        .post('/items', {
          merchantId,
          name: 'Counted item',
          brand: null,
          color: null,
          weightKg: '1.000',
        })
        .expect(201)
    ).body.id;
    const keeper = await f.createUser('WAREHOUSE_KEEPER');
    keeperId = keeper.id;
    keeperToken = await f.tokenFor(keeper.id);
  });
  afterAll(async () => {
    if (f) await f.close();
  });
  const command = (
    path: string,
    body: object,
    token = f.token,
    key = randomUUID(),
  ) => f.post(path, body, token).set('Idempotency-Key', key);
  const receipt = (quantity = 10, placements = [{ shelfId, quantity }]) =>
    command('/receipts', {
      merchantId,
      lines: [{ itemId, quantity, condition: 'GOOD', placements }],
    }).expect(201);
  const open = (
    kind = 'MERCHANT',
    targetId?: string,
    token = f.token,
    key = randomUUID(),
  ) =>
    command(
      '/stocktakes',
      {
        kind,
        ...((targetId ?? (kind === 'MERCHANT' ? merchantId : undefined))
          ? { targetId: targetId ?? merchantId }
          : {}),
        directorId: f.adminId,
        participantIds: [f.adminId, keeperId],
        notes,
      },
      token,
      key,
    );
  const count = (
    id: string,
    lineId: string,
    quantity: number,
    token = keeperToken,
    expectedVersion = 0,
    key = randomUUID(),
  ) =>
    command(
      `/stocktakes/${id}/counts`,
      {
        lineId,
        quantity,
        expectedVersion,
        reason: 'فرق كمية موثق بعد عد فعلي',
        notes,
      },
      token,
      key,
    );
  const submit = (id: string) =>
    command(`/stocktakes/${id}/submit`, { notes }, keeperToken).expect(200);
  const approve = (id: string, token = f.token, key = randomUUID()) =>
    command(
      `/stocktakes/${id}/approve`,
      { notes, confirmAttendance: true },
      token,
      key,
    );
  const cancel = (id: string) =>
    command(`/stocktakes/${id}/cancel`, { notes }).expect(200);
  const lines = async (id: string) =>
    (await f.get(`/stocktakes/${id}/lines`).expect(200)).body.items as {
      id: string;
      itemId: string;
      shelfId: string;
      expectedQuantity: number;
      category: string;
      version: number;
    }[];
  const cycleId = (response: { body: { event: { stocktakeId: string } } }) =>
    response.body.event.stocktakeId;
  async function countExpected(id: string) {
    for (const l of await lines(id))
      await count(id, l.id, l.expectedQuantity).expect(200);
  }
  async function lock(exclusive: boolean) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    await c.query('BEGIN');
    await c.query(
      exclusive
        ? 'SELECT pg_advisory_xact_lock(847314,1)'
        : 'SELECT pg_advisory_xact_lock_shared(847314,1)',
    );
    return c;
  }
  async function waitForGateWaiters(minimum = 1) {
    for (let n = 0; n < 100; n++) {
      const [r] = await f.database.$queryRaw<
        { waiting: bigint }[]
      >`SELECT COUNT(*) AS waiting FROM pg_locks WHERE locktype='advisory' AND NOT granted AND classid=847314 AND objid=1 AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`;
      if (Number(r.waiting) >= minimum) return;
      await setTimeout(10);
    }
    throw new Error('Expected write gate waiter not observed');
  }

  it('rejects null and invalid location patches without changing either location', async () => {
    const beforeRow = await f.database.storageRow.findUniqueOrThrow({
      where: { id: rowId },
    });
    const beforeShelf = await f.database.storageShelf.findUniqueOrThrow({
      where: { id: shelfId },
    });
    for (const [kind, id] of [
      ['rows', rowId],
      ['shelves', shelfId],
    ]) {
      for (const body of [
        { name: null },
        { isActive: null },
        {},
        { name: '   ' },
        { isActive: 'false' },
        { merchantId: otherMerchantId },
      ]) {
        await request(f.app.getHttpServer())
          .patch(`/api/v1/storage-locations/${kind}/${id}`)
          .set('Authorization', `Bearer ${f.token}`)
          .send(body)
          .expect(400);
      }
    }
    expect(
      await f.database.storageRow.findUniqueOrThrow({ where: { id: rowId } }),
    ).toEqual(beforeRow);
    expect(
      await f.database.storageShelf.findUniqueOrThrow({
        where: { id: shelfId },
      }),
    ).toEqual(beforeShelf);
    await request(f.app.getHttpServer())
      .patch(`/api/v1/storage-locations/shelves/${shelfId}`)
      .set('Authorization', `Bearer ${f.token}`)
      .send({ name: '  Updated shelf  ' })
      .expect(200);
    expect(
      (
        await f.database.storageShelf.findUniqueOrThrow({
          where: { id: shelfId },
        })
      ).name,
    ).toBe('Updated shelf');
    await request(f.app.getHttpServer())
      .patch(`/api/v1/storage-locations/rows/${rowId}`)
      .set('Authorization', `Bearer ${keeperToken}`)
      .send({ name: 'Forbidden change' })
      .expect(403);
  });

  it('rejects unsupported location filters and retains supported ownership and pagination filters', async () => {
    for (const [path, filter] of [
      ['rows', 'itemId'],
      ['rows', 'shelfId'],
      ['shelves', 'itemId'],
      ['entries', 'rowId'],
      ['transfers', 'rowId'],
    ]) {
      await f
        .get(`/storage-locations/${path}?${filter}=${randomUUID()}`)
        .expect(400);
    }
    for (const path of [
      'rows',
      'shelves',
      'balances',
      'custody',
      'entries',
      'transfers',
    ]) {
      await f.get(`/storage-locations/${path}?limit=101`).expect(400);
      await f.get(`/storage-locations/${path}?unexpected=true`).expect(400);
    }
    await receipt(5);
    const own = await f.createUser('MERCHANT', merchantId);
    const token = await f.tokenFor(own.id);
    for (const path of [
      'rows',
      'shelves',
      'balances',
      'custody',
      'entries',
      'transfers',
    ]) {
      await f
        .get(`/storage-locations/${path}?merchantId=${otherMerchantId}`, token)
        .expect(403);
    }
    const rows = (
      await f
        .get(
          `/storage-locations/rows?merchantId=${merchantId}&rowId=${rowId}&page=1&limit=1`,
          token,
        )
        .expect(200)
    ).body;
    expect(rows.items.map((r: { id: string }) => r.id)).toEqual([rowId]);
    const shelves = (
      await f
        .get(
          `/storage-locations/shelves?rowId=${rowId}&shelfId=${shelfId}`,
          token,
        )
        .expect(200)
    ).body;
    expect(shelves.items.map((r: { id: string }) => r.id)).toEqual([shelfId]);
    for (const path of ['balances', 'custody']) {
      const result = (
        await f
          .get(
            `/storage-locations/${path}?rowId=${rowId}&shelfId=${shelfId}&itemId=${itemId}`,
            token,
          )
          .expect(200)
      ).body;
      expect(
        result.items.every(
          (r: { itemId: string; shelfId: string }) =>
            r.itemId === itemId && r.shelfId === shelfId,
        ),
      ).toBe(true);
    }
    const entries = (
      await f
        .get(
          `/storage-locations/entries?itemId=${itemId}&shelfId=${shelfId}`,
          token,
        )
        .expect(200)
    ).body;
    expect(entries.items.length).toBeGreaterThan(0);
    expect(
      entries.items.every(
        (r: { itemId: string; shelfId: string }) =>
          r.itemId === itemId && r.shelfId === shelfId,
      ),
    ).toBe(true);
    await command('/storage-locations/transfers', {
      itemId,
      fromShelfId: shelfId,
      toShelfId: secondShelfId,
      quantity: 1,
      reason: notes,
    }).expect(201);
    const transfers = (
      await f
        .get(
          `/storage-locations/transfers?itemId=${itemId}&shelfId=${secondShelfId}`,
          token,
        )
        .expect(200)
    ).body;
    expect(transfers.total).toBe(1);
    expect(transfers.items[0].toShelfId).toBe(secondShelfId);
  });

  it('publishes response schemas, required command keys and only supported location queries', async () => {
    const doc = (
      await request(f.app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    for (const [path, verbs] of Object.entries(doc.paths) as [
      string,
      Record<
        string,
        {
          parameters?: { name: string; in: string; required?: boolean }[];
          responses: Record<
            string,
            { content?: { 'application/json'?: { schema?: object } } }
          >;
        }
      >,
    ][]) {
      if (
        !path.startsWith('/api/v1/stocktakes') &&
        !path.startsWith('/api/v1/storage-locations')
      )
        continue;
      for (const [method, operation] of Object.entries(verbs)) {
        const status =
          method === 'post' && path.startsWith('/api/v1/storage-locations')
            ? '201'
            : '200';
        expect(
          operation.responses[status]?.content?.['application/json']?.schema,
        ).toBeDefined();
        const header = operation.parameters?.find(
          (p) => p.in === 'header' && p.name === 'Idempotency-Key',
        );
        const keyed =
          method === 'post' &&
          (path.startsWith('/api/v1/stocktakes') ||
            path.endsWith('/transfers') ||
            path.endsWith('/custody-transfers'));
        expect(header?.required ?? false).toBe(keyed);
      }
    }
    for (const [path, supported] of [
      ['rows', ['merchantId', 'rowId', 'page', 'limit']],
      ['shelves', ['merchantId', 'rowId', 'shelfId', 'page', 'limit']],
      [
        'balances',
        ['merchantId', 'rowId', 'shelfId', 'itemId', 'page', 'limit'],
      ],
      [
        'custody',
        ['merchantId', 'rowId', 'shelfId', 'itemId', 'page', 'limit'],
      ],
      ['entries', ['merchantId', 'shelfId', 'itemId', 'page', 'limit']],
      ['transfers', ['merchantId', 'shelfId', 'itemId', 'page', 'limit']],
    ] as const) {
      expect(
        doc.paths[`/api/v1/storage-locations/${path}`].get.parameters
          .filter((p: { in: string }) => p.in === 'query')
          .map((p: { name: string }) => p.name)
          .sort(),
      ).toEqual([...supported].sort());
    }
    expect(
      doc.components.schemas.UpdateStorageLocationDto.properties.name.nullable,
    ).toBe(false);
    expect(
      doc.components.schemas.UpdateStorageLocationDto.properties.isActive
        .nullable,
    ).toBe(false);
  });

  it('matches published location and role-specific stocktake models to live JSON, including replays and nulls', async () => {
    const doc = (
      await request(f.app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    function matchesModel(name: string, value: Record<string, unknown>) {
      const schema = doc.components.schemas[name];
      expect(schema).toBeDefined();
      expect(Object.keys(value).sort()).toEqual(
        Object.keys(schema.properties).sort(),
      );
      for (const key of schema.required ?? [])
        expect(value).toHaveProperty(key);
      for (const [key, definition] of Object.entries(schema.properties) as [
        string,
        {
          type?: string;
          nullable?: boolean;
          format?: string;
          enum?: unknown[];
        },
      ][]) {
        if (value[key] === null) {
          expect(definition.nullable).toBe(true);
        } else if (
          ['string', 'number', 'boolean'].includes(definition.type ?? '')
        ) {
          expect(typeof value[key]).toBe(definition.type);
        }
        if (definition.enum) expect(definition.enum).toContain(value[key]);
        if (definition.format === 'date-time' && value[key] !== null)
          expect(Number.isFinite(Date.parse(value[key] as string))).toBe(true);
      }
    }
    function matchesPage(
      name: string,
      body: {
        items: Record<string, unknown>[];
        total: number;
        page: number;
        limit: number;
      },
    ) {
      matchesModel(name, body);
      const itemRef = doc.components.schemas[name].properties.items.items
        .$ref as string;
      expect(itemRef).toMatch(/^#\/components\/schemas\//);
      for (const item of body.items)
        matchesModel(itemRef.split('/').pop()!, item);
    }
    await receipt(10);
    const transferBody = {
      itemId,
      fromShelfId: shelfId,
      toShelfId: secondShelfId,
      quantity: 1,
      reason: notes,
    };
    const transferKey = randomUUID();
    const transfer = (
      await command(
        '/storage-locations/transfers',
        transferBody,
        f.token,
        transferKey,
      ).expect(201)
    ).body;
    matchesModel('StorageTransferResultDto', transfer);
    matchesModel('StorageTransferResponseDto', transfer.transfer);
    const replay = (
      await command(
        '/storage-locations/transfers',
        transferBody,
        f.token,
        transferKey,
      ).expect(201)
    ).body;
    expect(replay.replayed).toBe(true);
    expect(replay.transfer).toEqual(transfer.transfer);
    const shipment = (
      await command('/shipments', {
        merchantId,
        lines: [{ itemId, quantity: 2 }],
      }).expect(201)
    ).body;
    await command(`/shipments/${shipment.id}/prepare`, {}).expect(201);
    await command(`/shipments/${shipment.id}/dispatch`, {
      carrierName: 'Carrier',
      trackingNumber: 'DOC',
      placements: [{ itemId, shelfId, quantity: 2 }],
    }).expect(201);
    const arrival = (
      await command('/returns', {
        merchantId,
        shipmentId: shipment.id,
        lines: [
          {
            shipmentLineId: shipment.lines[0].id,
            quantity: 2,
            placements: [{ shelfId, quantity: 2 }],
          },
        ],
      }).expect(201)
    ).body;
    const custodyBody = {
      receiptLineId: arrival.lines[0].id,
      fromShelfId: shelfId,
      toShelfId: secondShelfId,
      quantity: 1,
      reason: notes,
    };
    const custodyKey = randomUUID();
    const custody = (
      await command(
        '/storage-locations/custody-transfers',
        custodyBody,
        f.token,
        custodyKey,
      ).expect(201)
    ).body;
    matchesModel('CustodyTransferResultDto', custody);
    matchesModel('CustodyTransferResponseDto', custody.transfer);
    const custodyReplay = (
      await command(
        '/storage-locations/custody-transfers',
        custodyBody,
        f.token,
        custodyKey,
      ).expect(201)
    ).body;
    expect(custodyReplay.replayed).toBe(true);
    expect(custodyReplay.transfer).toEqual(custody.transfer);
    for (const [path, model] of [
      ['rows', 'StorageRowsResponseDto'],
      ['shelves', 'StorageShelvesResponseDto'],
      ['balances', 'StorageBalancesResponseDto'],
      ['custody', 'CustodyBalancesResponseDto'],
      ['entries', 'StorageEntriesResponseDto'],
      ['transfers', 'StorageTransfersResponseDto'],
    ]) {
      matchesPage(
        model,
        (await f.get(`/storage-locations/${path}`).expect(200)).body,
      );
    }
    const own = await f.createUser('MERCHANT', merchantId);
    const merchantToken = await f.tokenFor(own.id);
    const foreign = await f.createUser('MERCHANT', otherMerchantId);
    const foreignToken = await f.tokenFor(foreign.id);
    await f.post('/storage-locations/transfers', transferBody).expect(400);
    await f
      .post('/storage-locations/custody-transfers', custodyBody)
      .expect(400);
    await f
      .post('/stocktakes', {
        kind: 'FULL',
        directorId: f.adminId,
        participantIds: [f.adminId],
        notes,
      })
      .expect(400);
    const openKey = randomUUID();
    const opened = (
      await open('MERCHANT', merchantId, f.token, openKey).expect(200)
    ).body;
    matchesModel('StocktakeCommandResponseDto', opened);
    matchesModel('StocktakeEventResponseDto', opened.event);
    const openedReplay = (
      await open('MERCHANT', merchantId, f.token, openKey).expect(200)
    ).body;
    expect(openedReplay.replayed).toBe(true);
    expect(openedReplay.event).toEqual(opened.event);
    const id = opened.event.stocktakeId;
    const before = (await f.get(`/stocktakes/${id}/lines`).expect(200)).body;
    matchesPage('StocktakeStaffLinesResponseDto', before);
    expect(
      before.items.every((line: { quantity: null }) => line.quantity === null),
    ).toBe(true);
    await countExpected(id);
    for (const [token, header, list, lineModel] of [
      [
        f.token,
        'StocktakeStaffResponseDto',
        'StocktakesStaffResponseDto',
        'StocktakeStaffLinesResponseDto',
      ],
      [
        merchantToken,
        'StocktakeMerchantResponseDto',
        'StocktakesMerchantResponseDto',
        'StocktakeMerchantLinesResponseDto',
      ],
    ]) {
      const body = (await f.get(`/stocktakes/${id}`, token).expect(200)).body;
      matchesModel(header, body);
      matchesPage(list, (await f.get('/stocktakes', token).expect(200)).body);
      matchesPage(
        lineModel,
        (await f.get(`/stocktakes/${id}/lines`, token).expect(200)).body,
      );
      matchesPage(
        'StocktakeScopesResponseDto',
        (await f.get(`/stocktakes/${id}/scopes`, token).expect(200)).body,
      );
    }
    const merchantLines = (
      await f.get(`/stocktakes/${id}/lines`, merchantToken).expect(200)
    ).body.items;
    expect(
      merchantLines.every(
        (line: Record<string, unknown>) =>
          line.merchantId === merchantId &&
          !('countedById' in line) &&
          !('countedByNameSnapshot' in line) &&
          !('countedAt' in line),
      ),
    ).toBe(true);
    await f.get(`/stocktakes/${id}/events`, merchantToken).expect(403);
    await f.get(`/stocktakes/${id}`, foreignToken).expect(404);
    matchesPage(
      'StocktakeEventsResponseDto',
      (await f.get(`/stocktakes/${id}/events`).expect(200)).body,
    );
    await submit(id);
    const approved = (await approve(id).expect(200)).body;
    matchesModel('StocktakeCommandResponseDto', approved);
    matchesModel('StocktakeEventResponseDto', approved.event);
    matchesModel(
      'StocktakeStaffResponseDto',
      (await f.get(`/stocktakes/${id}`).expect(200)).body,
    );
    matchesModel(
      'StocktakeMerchantResponseDto',
      (await f.get(`/stocktakes/${id}`, merchantToken).expect(200)).body,
    );
    const headerVariants =
      doc.paths['/api/v1/stocktakes/{id}'].get.responses['200'].content[
        'application/json'
      ].schema.anyOf;
    expect(headerVariants.map((v: { $ref: string }) => v.$ref)).toEqual([
      '#/components/schemas/StocktakeStaffResponseDto',
      '#/components/schemas/StocktakeMerchantResponseDto',
    ]);
  });

  it('accepts only implemented stocktake queries while preserving merchant and status filtering', async () => {
    const own = await f.createUser('MERCHANT', merchantId);
    const token = await f.tokenFor(own.id);
    await receipt(5);
    const cancelledId = cycleId(await open().expect(200));
    await cancel(cancelledId);
    const id = cycleId(await open().expect(200));
    for (const [path, query] of [
      ['lines', 'status=COUNTING'],
      ['scopes', 'status=COUNTING'],
      ['events', 'status=COUNTING'],
      ['events', `merchantId=${merchantId}`],
    ]) {
      await f.get(`/stocktakes/${id}/${path}?${query}`).expect(400);
    }
    const selected = (
      await f
        .get(
          `/stocktakes?status=COUNTING&merchantId=${merchantId}&limit=1`,
          token,
        )
        .expect(200)
    ).body;
    expect(selected.items.map((r: { id: string }) => r.id)).toEqual([id]);
    expect(selected.total).toBe(1);
    const closed = (await f.get('/stocktakes?status=CANCELLED').expect(200))
      .body;
    expect(closed.items.map((r: { id: string }) => r.id)).toEqual([
      cancelledId,
    ]);
    const selectedLines = (
      await f
        .get(
          `/stocktakes/${id}/lines?merchantId=${merchantId}&shelfId=${shelfId}`,
          token,
        )
        .expect(200)
    ).body;
    expect(selectedLines.items).toHaveLength(1);
    expect(selectedLines.items[0].shelfId).toBe(shelfId);
    const selectedScopes = (
      await f
        .get(
          `/stocktakes/${id}/scopes?merchantId=${merchantId}&page=1&limit=1`,
          token,
        )
        .expect(200)
    ).body;
    expect(selectedScopes.total).toBe(2);
    expect(selectedScopes.items).toHaveLength(1);
    for (const path of ['lines', 'scopes'])
      await f
        .get(`/stocktakes/${id}/${path}?merchantId=${otherMerchantId}`, token)
        .expect(403);
    await f.get(`/stocktakes/${id}/events`, token).expect(403);
    expect(
      (await f.get(`/stocktakes/${id}/events?page=1&limit=1`).expect(200)).body
        .items,
    ).toHaveLength(1);
    for (const path of ['lines', 'scopes', 'events']) {
      await f.get(`/stocktakes/${id}/${path}?limit=101`).expect(400);
      await f.get(`/stocktakes/${id}/${path}?unknown=1`).expect(400);
    }
    const doc = (
      await request(f.app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    for (const [path, fields] of [
      ['/api/v1/stocktakes', ['status', 'merchantId', 'page', 'limit']],
      [
        '/api/v1/stocktakes/{id}/lines',
        ['merchantId', 'shelfId', 'page', 'limit'],
      ],
      ['/api/v1/stocktakes/{id}/scopes', ['merchantId', 'page', 'limit']],
      ['/api/v1/stocktakes/{id}/events', ['page', 'limit']],
    ] as const) {
      expect(
        doc.paths[path].get.parameters
          .filter((p: { in: string }) => p.in === 'query')
          .map((p: { name: string }) => p.name)
          .sort(),
      ).toEqual([...fields].sort());
    }
  });

  it('requires complete merchant-owned shelf allocations and atomically rolls invalid receipts back', async () => {
    await command('/receipts', {
      merchantId,
      lines: [{ itemId, quantity: 5, condition: 'GOOD' }],
    }).expect(400);
    await command('/receipts', {
      merchantId,
      lines: [
        {
          itemId,
          quantity: 5,
          condition: 'GOOD',
          placements: [{ shelfId: otherShelfId, quantity: 5 }],
        },
      ],
    }).expect(400);
    await command('/receipts', {
      merchantId,
      lines: [
        {
          itemId,
          quantity: 5,
          condition: 'GOOD',
          placements: [{ shelfId, quantity: 4 }],
        },
      ],
    }).expect(400);
    expect(await f.database.receipt.count()).toBe(0);
    expect(await f.database.stockMovement.count()).toBe(0);
    await receipt(10, [
      { shelfId, quantity: 6 },
      { shelfId: secondShelfId, quantity: 4 },
    ]);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      10,
    );
    expect(
      (
        await f
          .get(`/storage-locations/balances?merchantId=${merchantId}`)
          .expect(200)
      ).body.items
        .filter((b: { shelfId: string | null }) => b.shelfId)
        .map((b: { quantity: number }) => b.quantity)
        .sort(),
    ).toEqual([4, 6]);
  });
  it('normalizes item and shelf UUIDs and allocation order for retries', async () => {
    const key = randomUUID();
    const body = {
      merchantId: merchantId.toUpperCase(),
      lines: [
        {
          itemId: itemId.toUpperCase(),
          quantity: 5,
          condition: 'GOOD',
          placements: [
            { shelfId: secondShelfId.toUpperCase(), quantity: 2 },
            { shelfId: shelfId.toUpperCase(), quantity: 3 },
          ],
        },
      ],
    };
    await command('/receipts', body, f.token, key).expect(201);
    await command(
      '/receipts',
      {
        merchantId,
        lines: [
          {
            itemId,
            quantity: 5,
            condition: 'GOOD',
            placements: [
              { shelfId, quantity: 3 },
              { shelfId: secondShelfId, quantity: 2 },
            ],
          },
        ],
      },
      f.token,
      key,
    ).expect(200);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      5,
    );
  });
  it('keeps location movement and transfer history inside merchant ownership', async () => {
    await receipt(5);
    await command('/storage-locations/transfers', {
      itemId,
      fromShelfId: shelfId,
      toShelfId: secondShelfId,
      quantity: 1,
      reason: notes,
    }).expect(201);
    const own = await f.createUser('MERCHANT', merchantId),
      foreign = await f.createUser('MERCHANT', otherMerchantId),
      token = await f.tokenFor(own.id),
      foreignToken = await f.tokenFor(foreign.id);
    const history = (
      await f.get('/storage-locations/entries', token).expect(200)
    ).body.items;
    expect(
      history.every(
        (e: { merchantId: string; recordedAt: string; actorId: string }) =>
          e.merchantId === merchantId &&
          e.actorId === f.adminId &&
          Date.parse(e.recordedAt) > 0,
      ),
    ).toBe(true);
    expect(
      (await f.get('/storage-locations/transfers', token).expect(200)).body
        .total,
    ).toBe(1);
    expect(
      (await f.get('/storage-locations/entries', foreignToken).expect(200)).body
        .total,
    ).toBe(0);
    await f
      .get(`/storage-locations/entries?merchantId=${otherMerchantId}`, token)
      .expect(403);
  });
  it('counts all merchant shelves and keeps + and - settlements even with zero net quantity', async () => {
    await receipt(10, [
      { shelfId, quantity: 6 },
      { shelfId: secondShelfId, quantity: 4 },
    ]);
    const id = cycleId(
      await open('MERCHANT', merchantId, keeperToken).expect(200),
    );
    const scope = (await f.get(`/stocktakes/${id}/scopes`).expect(200)).body
      .items;
    expect(scope.map((s: { shelfId: string }) => s.shelfId).sort()).toEqual(
      [shelfId, secondShelfId].sort(),
    );
    for (const l of await lines(id))
      await count(id, l.id, l.shelfId === shelfId ? 5 : 5).expect(200);
    await submit(id);
    await approve(id, keeperToken).expect(403);
    const key = randomUUID();
    await approve(id, f.token, key).expect(200);
    await approve(id, f.token, key).expect(200);
    const adjustments = await f.database.stockAdjustment.findMany({
      where: { stocktakeLineId: { not: null } },
    });
    expect(
      adjustments.map((a) => a.quantityDelta).sort((a, b) => a - b),
    ).toEqual([-1, 1]);
    expect(
      adjustments.every(
        (a) => a.performedById === f.adminId && a.referenceMovementId === null,
      ),
    ).toBe(true);
    const cycle = await f.database.stocktake.findUniqueOrThrow({
      where: { id },
    });
    expect(
      adjustments.every(
        (a) => a.recordedAt.getTime() === cycle.closedAt!.getTime(),
      ),
    ).toBe(true);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      10,
    );
    expect(
      (
        await f
          .get(`/storage-locations/balances?merchantId=${merchantId}`)
          .expect(200)
      ).body.items
        .filter((b: { shelfId: string | null }) => b.shelfId)
        .map((b: { quantity: number }) => b.quantity)
        .sort(),
    ).toEqual([5, 5]);
    await f.patch(`/items/${itemId}`, { name: 'After approval' }).expect(200);
  });
  it('posts administrator-only shortages including an explicit zero count', async () => {
    await receipt(3);
    const id = cycleId(await open().expect(200));
    await count(id, (await lines(id))[0].id, 0).expect(200);
    await submit(id);
    await approve(id).expect(200);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      0,
    );
    expect(
      (await f.database.stockAdjustment.findFirstOrThrow()).quantityDelta,
    ).toBe(-3);
  });
  it('blocks every business write including administrator, but allows reads and authentication', async () => {
    const r = await receipt();
    const id = cycleId(await open().expect(200));
    const writes = [
      () => f.patch(`/items/${itemId}`, { name: 'Blocked' }),
      () =>
        f.post('/items', {
          merchantId,
          name: 'Blocked',
          brand: null,
          color: null,
          weightKg: '1.000',
        }),
      () => f.patch(`/merchants/${merchantId}`, { name: 'Blocked' }),
      () => f.patch(`/users/${keeperId}`, { displayName: 'Blocked' }),
      () =>
        f.post('/storage-locations/rows', { code: 'BLOCKED', name: 'Blocked' }),
      () =>
        f.patch(`/storage-locations/shelves/${shelfId}`, { name: 'Blocked' }),
      () =>
        command('/receipts', {
          merchantId,
          lines: [
            {
              itemId,
              quantity: 1,
              condition: 'GOOD',
              placements: [{ shelfId, quantity: 1 }],
            },
          ],
        }),
      () =>
        command('/shipments', { merchantId, lines: [{ itemId, quantity: 1 }] }),
      () =>
        command('/storage-locations/transfers', {
          itemId,
          fromShelfId: shelfId,
          toShelfId: secondShelfId,
          quantity: 1,
          reason: notes,
        }),
      () =>
        command('/stock-adjustments', {
          referenceMovementId: r.body.lines[0].movement.id,
          direction: 'OUT',
          quantity: 1,
          reason: notes,
          placements: [{ shelfId, quantity: 1 }],
        }),
    ];
    for (const write of writes) {
      const response = await write().expect(409);
      expect(response.body.code).toBe('STOCKTAKE_ACTIVE');
    }
    await f.get(`/balances/${itemId}`).expect(200);
    await f.get('/auth/me').expect(200);
    await expect(
      f.database.item.update({
        where: { id: itemId },
        data: { name: 'Direct blocked' },
      }),
    ).rejects.toThrow();
    await expect(
      f.database.user.update({
        where: { id: keeperId },
        data: { displayName: 'Direct blocked' },
      }),
    ).rejects.toThrow();
    await cancel(id);
    await f
      .patch(`/items/${itemId}`, { name: 'After cancellation' })
      .expect(200);
  });
  it('preserves count history and stock when administrator cancels, and forbids reopening the cancelled cycle', async () => {
    await receipt(4);
    const id = cycleId(await open().expect(200));
    const l = (await lines(id))[0];
    await count(id, l.id, 1).expect(200);
    await command(`/stocktakes/${id}/cancel`, { notes }, keeperToken).expect(
      403,
    );
    await cancel(id);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      4,
    );
    expect(await f.database.stockAdjustment.count()).toBe(0);
    expect(await f.database.stocktakeCountEntry.count()).toBe(1);
    await count(id, l.id, 2).expect(409);
    await command(`/stocktakes/${id}/reopen`, { notes }).expect(409);
    await expect(f.database.stocktakeCountEntry.deleteMany()).rejects.toThrow();
  });
  it('distinguishes missing counts from zero, enforces reasons and optimistic recounts', async () => {
    await receipt(4);
    const id = cycleId(await open().expect(200)),
      l = (await lines(id))[0];
    await command(`/stocktakes/${id}/submit`, { notes }, keeperToken).expect(
      409,
    );
    await command(
      `/stocktakes/${id}/counts`,
      { lineId: l.id, expectedVersion: 0, quantity: 0 },
      keeperToken,
    ).expect(400);
    await count(id, l.id, 2).expect(200);
    await count(id, l.id, 3).expect(409);
    await count(id, l.id, 3, keeperToken, 1).expect(200);
    expect(await f.database.stocktakeCountEntry.count()).toBe(2);
    await submit(id);
    await count(id, l.id, 3, keeperToken, 2).expect(409);
    await command(`/stocktakes/${id}/reopen`, { notes }).expect(200);
    await count(id, l.id, 4, keeperToken, 2).expect(200);
    await submit(id);
    await approve(id).expect(200);
    expect(await f.database.stockAdjustment.count()).toBe(0);
  });
  it('permits one active cycle only and makes open and count retries actor-bound', async () => {
    await receipt();
    const key = randomUUID(),
      first = await open('MERCHANT', merchantId, f.token, key).expect(200),
      id = cycleId(first);
    expect(
      (await open('MERCHANT', merchantId, f.token, key).expect(200)).body.event
        .id,
    ).toBe(first.body.event.id);
    await open('FULL', undefined).expect(409);
    await open('MERCHANT', merchantId, keeperToken, key).expect(409);
    const l = (await lines(id))[0],
      ck = randomUUID();
    await count(id, l.id, 10, keeperToken, 0, ck).expect(200);
    await count(id, l.id, 10, keeperToken, 0, ck).expect(200);
    await count(id, l.id, 9, keeperToken, 0, ck).expect(409);
    expect(await f.database.stocktakeCountEntry.count()).toBe(1);
    await cancel(id);
  });
  it('supports whole warehouse, row and shelf scopes and isolates merchant reads', async () => {
    const own = await f.createUser('MERCHANT', merchantId),
      foreign = await f.createUser('MERCHANT', otherMerchantId),
      ownToken = await f.tokenFor(own.id),
      foreignToken = await f.tokenFor(foreign.id);
    await receipt();
    for (const [kind, target] of [
      ['FULL', undefined],
      ['ROW', rowId],
      ['SHELF', shelfId],
    ] as const) {
      const id = cycleId(await open(kind, target).expect(200)),
        scopes = (await f.get(`/stocktakes/${id}/scopes`).expect(200)).body
          .items;
      expect(scopes.length).toBe(kind === 'SHELF' ? 1 : 3);
      const ownLines = (
        await f.get(`/stocktakes/${id}/lines`, ownToken).expect(200)
      ).body.items;
      expect(
        ownLines.every(
          (l: { merchantId: string }) => l.merchantId === merchantId,
        ),
      ).toBe(true);
      await f.get(`/stocktakes/${id}/events`, ownToken).expect(403);
      await f
        .get(`/stocktakes/${id}/lines?merchantId=${otherMerchantId}`, ownToken)
        .expect(403);
      if (kind === 'SHELF')
        await f.get(`/stocktakes/${id}`, foreignToken).expect(404);
      await cancel(id);
    }
  });
  it('requires recorded presence for counters and final administrator approval', async () => {
    await receipt();
    const outsider = await f.createUser('WAREHOUSE_KEEPER'),
      outsideToken = await f.tokenFor(outsider.id);
    const id = cycleId(await open().expect(200)),
      l = (await lines(id))[0];
    await count(id, l.id, 10, outsideToken).expect(403);
    await command(
      `/stocktakes/${id}/attendance`,
      { userId: outsider.id, present: true, notes },
      keeperToken,
    ).expect(200);
    await count(id, l.id, 10, outsideToken).expect(200);
    await command(
      `/stocktakes/${id}/attendance`,
      { userId: f.adminId, present: false, notes },
      keeperToken,
    ).expect(200);
    await submit(id);
    await approve(id).expect(403);
    await command(
      `/stocktakes/${id}/attendance`,
      { userId: f.adminId, present: true, notes },
      keeperToken,
    ).expect(200);
    await approve(id).expect(200);
  });
  it('supports counted surplus on a known item in a shelf with no prior balance', async () => {
    const id = cycleId(await open().expect(200));
    await command(
      `/stocktakes/${id}/counts`,
      {
        itemId,
        shelfId: secondShelfId,
        expectedVersion: 0,
        quantity: 2,
        reason: notes,
      },
      keeperToken,
    ).expect(200);
    await command(
      `/stocktakes/${id}/counts`,
      {
        itemId,
        shelfId: otherShelfId,
        expectedVersion: 0,
        quantity: 1,
        reason: notes,
      },
      keeperToken,
    ).expect(400);
    await submit(id);
    await approve(id).expect(200);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      2,
    );
  });
  it('makes internal transfers conserve total and prevents overdraw and foreign shelf assignment', async () => {
    await receipt(5);
    const key = randomUUID(),
      body = {
        itemId,
        fromShelfId: shelfId,
        toShelfId: secondShelfId,
        quantity: 2,
        reason: notes,
      };
    await command(
      '/storage-locations/transfers',
      body,
      keeperToken,
      key,
    ).expect(201);
    await command(
      '/storage-locations/transfers',
      body,
      keeperToken,
      key,
    ).expect(201);
    await command('/storage-locations/transfers', {
      ...body,
      quantity: 4,
    }).expect(409);
    await command('/storage-locations/transfers', {
      ...body,
      toShelfId: otherShelfId,
    }).expect(400);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      5,
    );
    expect(await f.database.stockMovement.count()).toBe(1);
    await f
      .patch(`/storage-locations/shelves/${shelfId}`, { isActive: false })
      .expect(409);
  });
  it('rejects approval without presence confirmation', async () => {
    const id = cycleId(await open().expect(200));
    await submit(id);
    await command(`/stocktakes/${id}/approve`, {
      notes,
      confirmAttendance: false,
    }).expect(400);
    expect((await f.get(`/stocktakes/${id}`).expect(200)).body.status).toBe(
      'PENDING_APPROVAL',
    );
    await cancel(id);
  });
  it('rolls all differences, movements and balances back if one settlement fails', async () => {
    await receipt(10, [
      { shelfId, quantity: 6 },
      { shelfId: secondShelfId, quantity: 4 },
    ]);
    const id = cycleId(await open().expect(200));
    for (const l of await lines(id))
      await count(id, l.id, l.expectedQuantity - 1).expect(200);
    await submit(id);
    await f.database.$executeRawUnsafe(
      `CREATE FUNCTION fail_count_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.stocktake_line_id IS NOT NULL AND EXISTS(SELECT 1 FROM stock_adjustments WHERE stocktake_line_id IS NOT NULL) THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END; $$`,
    );
    await f.database.$executeRawUnsafe(
      'CREATE TRIGGER fail_count BEFORE INSERT ON stock_adjustments FOR EACH ROW EXECUTE FUNCTION fail_count_settlement()',
    );
    try {
      await approve(id).expect(500);
      expect(await f.database.stockAdjustment.count()).toBe(0);
      expect(
        (await f.get(`/balances/${itemId}`).expect(200)).body.quantity,
      ).toBe(10);
      expect((await f.get(`/stocktakes/${id}`).expect(200)).body.status).toBe(
        'PENDING_APPROVAL',
      );
    } finally {
      await f.database.$executeRawUnsafe(
        'DROP TRIGGER fail_count ON stock_adjustments',
      );
      await f.database.$executeRawUnsafe(
        'DROP FUNCTION fail_count_settlement()',
      );
    }
    await approve(id).expect(200);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      8,
    );
  });
  it('serializes concurrent approval and cancellation so only one terminal action succeeds', async () => {
    await receipt();
    const id = cycleId(await open().expect(200));
    await countExpected(id);
    await submit(id);
    const [a, c] = await Promise.all([
      approve(id),
      command(`/stocktakes/${id}/cancel`, { notes }),
    ]);
    expect([a.status, c.status].sort((a, b) => a - b)).toEqual([200, 409]);
    expect(['APPROVED', 'CANCELLED']).toContain(
      (await f.get(`/stocktakes/${id}`).expect(200)).body.status,
    );
  });
  it('counts pending return custody separately and never settles its discrepancy into available stock', async () => {
    await receipt(10);
    const shipment = (
      await command('/shipments', {
        merchantId,
        lines: [{ itemId, quantity: 4 }],
      }).expect(201)
    ).body;
    await command(`/shipments/${shipment.id}/prepare`, {}).expect(201);
    await command(`/shipments/${shipment.id}/dispatch`, {
      carrierName: 'Carrier',
      trackingNumber: 'TEST',
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
            quantity: 4,
            condition: 'NOTED',
            issueType: 'SCRATCH',
            notes,
          },
        ],
      }).expect(201)
    ).body;
    const id = cycleId(await open().expect(200));
    const snapshot = await lines(id);
    expect(
      snapshot
        .map((l) => [l.category, l.expectedQuantity])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ['AVAILABLE', 6],
      ['CUSTODY', 4],
    ]);
    for (const l of snapshot)
      await count(id, l.id, l.category === 'CUSTODY' ? 3 : 6).expect(200);
    await submit(id);
    await approve(id).expect(200);
    expect(await f.database.stockAdjustment.count()).toBe(0);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      6,
    );
    expect(
      (
        await f.database.returnCustodyBalance.findFirstOrThrow({
          where: { shelfId },
        })
      ).quantity,
    ).toBe(4);
    await command(
      `/returns/inspection-lines/${inspection.lines[0].id}/review`,
      {
        decision: 'ACCEPT_TO_STOCK',
        reason: notes,
        placements: [{ shelfId: secondShelfId, quantity: 4 }],
        custodySources: [{ shelfId, quantity: 4 }],
      },
    ).expect(201);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      10,
    );
    expect(
      (
        await f.database.returnCustodyBalance.findFirstOrThrow({
          where: { shelfId },
        })
      ).quantity,
    ).toBe(0);
  });
  it('requires administrator allocation of unassigned stock without changing warehouse quantity', async () => {
    const wid = (
      await f.database.warehouse.findUniqueOrThrow({ where: { code: 'MAIN' } })
    ).id;
    await f.database.$transaction(async (tx) => {
      const at = await f.database.time(tx);
      const r = await tx.receipt.create({
        data: {
          warehouseId: wid,
          merchantId,
          merchantNameSnapshot: 'Merchant MZ',
          receivedById: f.adminId,
          receivedByNameSnapshot: 'Administrator',
          receivedAt: at,
          idempotencyKey: randomUUID(),
          requestHash: 'f'.repeat(64),
        },
      });
      const l = await tx.receiptLine.create({
        data: {
          receiptId: r.id,
          warehouseId: wid,
          merchantId,
          itemId,
          itemCodeSnapshot: 'MZ-000001',
          itemNameSnapshot: 'Counted item',
          quantity: 5,
          condition: 'GOOD',
          position: 1,
        },
      });
      await tx.inventoryBalance.create({
        data: {
          warehouseId: wid,
          merchantId,
          itemId,
          quantity: 0,
          updatedAt: at,
        },
      });
      await tx.stockMovement.create({
        data: {
          warehouseId: wid,
          merchantId,
          itemId,
          itemCodeSnapshot: 'MZ-000001',
          itemNameSnapshot: 'Counted item',
          kind: 'RECEIPT_IN',
          quantityDelta: 5,
          actorId: f.adminId,
          actorNameSnapshot: 'Administrator',
          recordedAt: at,
          receiptLineId: l.id,
        },
      });
      await tx.inventoryBalance.update({
        where: { warehouseId_itemId: { warehouseId: wid, itemId } },
        data: { quantity: 5, updatedAt: at },
      });
    });
    await open().expect(409);
    await command(
      '/storage-locations/transfers',
      { itemId, toShelfId: shelfId, quantity: 5, reason: notes },
      keeperToken,
    ).expect(403);
    await command('/storage-locations/transfers', {
      itemId,
      toShelfId: shelfId,
      quantity: 5,
      reason: notes,
    }).expect(201);
    expect((await f.get(`/balances/${itemId}`).expect(200)).body.quantity).toBe(
      5,
    );
    expect(await f.database.stockMovement.count()).toBe(1);
    const id = cycleId(await open().expect(200));
    await cancel(id);
  });
  it('forbids SQL changes to shelf ownership, placement projections, historical allocations and count snapshots', async () => {
    await receipt();
    await expect(
      f.database.storageShelf.update({
        where: { id: shelfId },
        data: { merchantId: otherMerchantId },
      }),
    ).rejects.toThrow();
    const balance = await f.database.stockPlacementBalance.findFirstOrThrow({
      where: { shelfId },
    });
    await expect(
      f.database.stockPlacementBalance.update({
        where: { id: balance.id },
        data: { quantity: 9 },
      }),
    ).rejects.toThrow();
    await expect(
      f.database.stockPlacementBalance.delete({ where: { id: balance.id } }),
    ).rejects.toThrow();
    await expect(f.database.stockPlacementEntry.deleteMany()).rejects.toThrow();
    const id = cycleId(await open().expect(200)),
      l = (await lines(id))[0];
    await expect(
      f.database.stocktakeLine.update({
        where: { id: l.id },
        data: { expectedQuantity: 9 },
      }),
    ).rejects.toThrow();
    await cancel(id);
  });
  it('preserves cycle lock across application instances and prevents a missing-ledger approval in SQL', async () => {
    await receipt();
    const id = cycleId(await open().expect(200)),
      l = (await lines(id))[0];
    await count(id, l.id, 9).expect(200);
    await submit(id);
    await expect(
      f.database.stocktake.update({
        where: { id },
        data: {
          status: 'APPROVED',
          closedById: f.adminId,
          closedByNameSnapshot: 'Administrator',
          closedAt: new Date(),
          closingNotes: notes,
        },
      }),
    ).rejects.toThrow();
    // Persistence is inspected with a separate database connection, as after a process restart.
    const connection = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await connection.connect();
    try {
      expect(
        (
          await connection.query('SELECT status FROM stocktakes WHERE id=$1', [
            id,
          ])
        ).rows[0].status,
      ).toBe('PENDING_APPROVAL');
      await expect(
        connection.query('UPDATE items SET name=$1 WHERE id=$2', [
          'Other process',
          itemId,
        ]),
      ).rejects.toThrow();
    } finally {
      await connection.end();
    }
    await cancel(id);
  });
  it('rejects a pre-opening request which was waiting behind the stocktake lock', async () => {
    await receipt();
    const barrier = await lock(true);
    try {
      const pendingOpen = open().then((r) => r);
      await waitForGateWaiters();
      const pendingWrite = f
        .post(
          '/items',
          {
            merchantId,
            name: 'Queued',
            brand: null,
            color: null,
            weightKg: '1.000',
          },
          keeperToken,
        )
        .then((r) => r);
      await waitForGateWaiters(2);
      await barrier.query('COMMIT');
      const opened = await pendingOpen;
      expect(opened.status).toBe(200);
      expect((await pendingWrite).status).toBe(409);
      await cancel(cycleId(opened));
    } finally {
      await barrier.query('ROLLBACK');
      await barrier.end();
    }
  });
  it('opening drains a previous writer before capturing its committed snapshot', async () => {
    await receipt();
    const previous = await lock(false);
    try {
      await previous.query('UPDATE items SET name=$1 WHERE id=$2', [
        'Name before opening',
        itemId,
      ]);
      const pending = open().then((r) => r);
      await waitForGateWaiters();
      await previous.query('COMMIT');
      const r = await pending;
      expect(r.status).toBe(200);
      const id = cycleId(r);
      expect(
        (await f.get(`/stocktakes/${id}/lines`).expect(200)).body.items[0]
          .itemNameSnapshot,
      ).toBe('Name before opening');
      await cancel(id);
    } finally {
      await previous.query('ROLLBACK');
      await previous.end();
    }
  });
});
