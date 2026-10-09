import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  createAdminFixture,
  fixturePassword,
} from '../support/admin-fixture.js';

describe('Merchants administration', () => {
  const administrationReason = 'Verified administration change';
  let f: Awaited<ReturnType<typeof createAdminFixture>>;
  beforeAll(async () => {
    f = await createAdminFixture();
  }, 30000);
  beforeEach(async () => {
    await f.reset();
  });
  afterAll(async () => {
    if (f) await f.close();
  });
  const input = { code: ' mz ', name: ' Merchant ', phone: ' +201001234567 ' };
  it('normalizes the immutable merchant code and does not create an account implicitly', async () => {
    const { body } = await f.post('/merchants', input).expect(201);
    expect(body.code).toBe('MZ');
    expect(body.name).toBe('Merchant');
    expect(body.phone).toBe('+201001234567');
    expect(body.createdById).toBe(f.adminId);
    expect(await f.database.user.count()).toBe(1);
    await f
      .patch(`/merchants/${body.id}`, { name: 'Missing reason' })
      .expect(400);
    await f
      .patch(`/merchants/${body.id}/status`, { isActive: false })
      .expect(400);
    await f
      .patch(`/merchants/${body.id}`, {
        name: 'Renamed',
        phone: '001234',
        reason: administrationReason,
      })
      .expect(200);
    expect((await f.get(`/merchants/${body.id}`).expect(200)).body.code).toBe(
      'MZ',
    );
    await f
      .patch(`/merchants/${body.id}`, {
        code: 'ZZ',
        reason: administrationReason,
      })
      .expect(400);
  });
  it('rejects invalid fields, empty patches and nonexistent identifiers', async () => {
    for (const code of ['M', 'M123', 'ABCDEFGHI', 'عربي'])
      await f.post('/merchants', { ...input, code }).expect(400);
    await f.post('/merchants', { ...input, name: '  ' }).expect(400);
    await f.post('/merchants', { ...input, phone: 123 }).expect(400);
    await f
      .post('/merchants', { ...input, createdById: f.adminId })
      .expect(400);
    const merchant = await f.createMerchant();
    await f
      .patch(`/merchants/${merchant.id}`, { reason: administrationReason })
      .expect(400);
    await f
      .patch(`/merchants/${merchant.id}`, {
        name: null,
        reason: administrationReason,
      })
      .expect(400);
    await f
      .patch(`/merchants/${merchant.id}/status`, {
        isActive: 'false',
        reason: administrationReason,
      })
      .expect(400);
    await f.get('/merchants/bad').expect(400);
    await f.get(`/merchants/${randomUUID()}`).expect(404);
    await f
      .patch(`/merchants/${randomUUID()}`, {
        name: 'Missing',
        reason: administrationReason,
      })
      .expect(404);
  });
  it('serializes duplicate normalized merchant codes with a safe conflict response', async () => {
    const responses = await Promise.all([
      f.post('/merchants', input),
      f.post('/merchants', { ...input, code: 'MZ' }),
    ]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    expect(await f.database.merchant.count()).toBe(1);
  });
  it('disables all owned sessions only and preserves individually disabled accounts after reactivation', async () => {
    const first = await f.createMerchant();
    const other = await f.createMerchant('ZZ');
    const one = await f.createUser('MERCHANT', first.id);
    const two = await f.createUser('MERCHANT', first.id);
    const unrelated = await f.createUser('MERCHANT', other.id);
    const a = await f.tokenFor(one.id);
    const b = await f.tokenFor(two.id);
    const c = await f.tokenFor(unrelated.id);
    await f
      .patch(`/users/${two.id}/status`, {
        isActive: false,
        reason: administrationReason,
      })
      .expect(200);
    await f
      .patch(`/merchants/${first.id}/status`, {
        isActive: false,
        reason: administrationReason,
      })
      .expect(200);
    await f.get('/auth/me', a).expect(401);
    await f.get('/auth/me', b).expect(401);
    await f.get('/auth/me', c).expect(200);
    await f
      .patch(`/merchants/${first.id}/status`, {
        isActive: true,
        reason: administrationReason,
      })
      .expect(200);
    await f.get('/auth/me', a).expect(401);
    await f.get('/auth/me', b).expect(401);
    expect(
      (await f.database.user.findUniqueOrThrow({ where: { id: two.id } }))
        .isActive,
    ).toBe(false);
    await f.get('/auth/me', await f.tokenFor(one.id)).expect(200);
    await f.get('/auth/me', c).expect(200);
  });
  it('updates account display names even when their merchant is disabled without introducing a new link', async () => {
    const merchant = await f.createMerchant();
    const user = await f.createUser('MERCHANT', merchant.id);
    await f
      .patch(`/merchants/${merchant.id}/status`, {
        isActive: false,
        reason: administrationReason,
      })
      .expect(200);
    await f
      .patch(`/users/${user.id}`, {
        displayName: 'Corrected name',
        reason: administrationReason,
      })
      .expect(200);
    const staff = await f.createUser();
    await f
      .patch(`/users/${staff.id}`, {
        role: 'MERCHANT',
        reason: administrationReason,
        merchantId: merchant.id,
      })
      .expect(409);
  });
  it('rolls back merchant status and retains sessions if revocation fails', async () => {
    const merchant = await f.createMerchant();
    const user = await f.createUser('MERCHANT', merchant.id);
    const token = await f.tokenFor(user.id);
    const revoke = vi
      .spyOn(f.sessions, 'revokeForUsers')
      .mockRejectedValueOnce(new Error('Simulated revocation failure'));
    try {
      await f
        .patch(`/merchants/${merchant.id}/status`, {
          isActive: false,
          reason: administrationReason,
        })
        .expect(500);
    } finally {
      revoke.mockRestore();
    }
    expect(
      (
        await f.database.merchant.findUniqueOrThrow({
          where: { id: merchant.id },
        })
      ).isActive,
    ).toBe(true);
    await f.get('/auth/me', token).expect(200);
  });
  it('prevents linking a new account when an earlier queued administration transaction disables its merchant', async () => {
    const merchant = await f.createMerchant();
    const held = await f.holdAdministrationLock();
    const pending = f.users
      .create(f.context, {
        email: 'queued@example.test',
        displayName: 'Queued',
        initialPassword: fixturePassword,
        role: 'MERCHANT',
        merchantId: merchant.id,
      })
      .then(
        () => ({ status: 'allowed' }),
        (error: Error) => ({ status: error.name }),
      );
    try {
      await f.waitForBlockedAdministration();
      await held.query('UPDATE merchants SET is_active=false WHERE id=$1', [
        merchant.id,
      ]);
      await held.query('COMMIT');
      expect((await pending).status).toBe('ConflictException');
      expect(
        await f.database.user.count({ where: { merchantId: merchant.id } }),
      ).toBe(0);
    } finally {
      await held.query('ROLLBACK');
      await held.end();
      await pending;
    }
  });
  it('cannot issue a valid session from a login paused before merchant disable', async () => {
    const merchant = await f.createMerchant();
    const user = await f.createUser('MERCHANT', merchant.id);
    let release!: () => void;
    let signal!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verified = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const original = f.passwords.verify.bind(f.passwords);
    const spy = vi
      .spyOn(f.passwords, 'verify')
      .mockImplementationOnce(async (password, hash) => {
        const valid = await original(password, hash);
        signal();
        await paused;
        return valid;
      });
    const pending = f
      .post('/auth/login', { email: user.email, password: fixturePassword })
      .then((response) => response);
    try {
      await verified;
      await f
        .patch(`/merchants/${merchant.id}/status`, {
          isActive: false,
          reason: administrationReason,
        })
        .expect(200);
      release();
      expect((await pending).status).toBe(401);
    } finally {
      release();
      spy.mockRestore();
      await pending;
    }
  });
  it('filters inactive merchants, searches and exposes safe paginated OpenAPI models', async () => {
    const first = await f.createMerchant();
    await f.createMerchant('ZZ');
    await f
      .patch(`/merchants/${first.id}/status`, {
        isActive: false,
        reason: administrationReason,
      })
      .expect(200);
    const inactive = await f.get('/merchants?isActive=false').expect(200);
    expect(inactive.body.items.map((item: { id: string }) => item.id)).toEqual([
      first.id,
    ]);
    expect(
      (await f.get('/merchants?search=zz&limit=1').expect(200)).body.total,
    ).toBe(1);
    await f.get('/merchants?isActive=0').expect(400);
    await f.get('/merchants?limit=101').expect(400);
    const schema = await request(f.app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(schema.body.paths['/api/v1/users']).toBeDefined();
    expect(schema.body.paths['/api/v1/merchants/{id}/status']).toBeDefined();
    expect(
      schema.body.components.schemas.UserResponseDto.properties.passwordHash,
    ).toBeUndefined();
  });
});
