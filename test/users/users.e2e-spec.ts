import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  createAdminFixture,
  fixturePassword,
} from '../support/admin-fixture.js';

describe('Users administration', () => {
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
  const input = (email = 'new@example.test') => ({
    email,
    displayName: ' New user ',
    initialPassword: fixturePassword,
    role: 'EMPLOYEE',
  });

  it.each(['EMPLOYEE', 'WAREHOUSE_KEEPER', 'MERCHANT'] as const)(
    'denies every administration route to %s',
    async (role) => {
      const merchant = await f.createMerchant();
      const user = await f.createUser(
        role,
        role === 'MERCHANT' ? merchant.id : null,
      );
      const token = await f.tokenFor(user.id);
      for (const collection of ['users', 'merchants']) {
        const id = collection === 'users' ? user.id : merchant.id;
        await f.get(`/${collection}`, token).expect(403);
        await f.get(`/${collection}/${id}`, token).expect(403);
        await f.post(`/${collection}`, {}, token).expect(403);
        await f
          .patch(
            `/${collection}/${id}`,
            { reason: administrationReason },
            token,
          )
          .expect(403);
        await f
          .patch(
            `/${collection}/${id}/status`,
            { isActive: false, reason: administrationReason },
            token,
          )
          .expect(403);
      }
    },
  );
  it('denies unauthenticated and password-change-only administrators', async () => {
    await request(f.app.getHttpServer()).get('/api/v1/users').expect(401);
    await f.database.user.update({
      where: { id: f.adminId },
      data: { mustChangePassword: true },
    });
    await f.get('/users').expect(403);
    await f
      .post('/merchants', { code: 'MZ', name: 'Merchant', phone: '010' })
      .expect(403);
  });
  it('creates all fixed roles with trusted creator, password hashing and safe responses', async () => {
    const merchant = await f.createMerchant();
    for (const role of ['ADMIN', 'WAREHOUSE_KEEPER', 'EMPLOYEE', 'MERCHANT']) {
      const { body } = await f
        .post('/users', {
          ...input(` new-${role}@EXAMPLE.TEST `),
          role,
          ...(role === 'MERCHANT' ? { merchantId: merchant.id } : {}),
        })
        .expect(201);
      expect(body.email).toBe(`new-${role.toLowerCase()}@example.test`);
      expect(body.displayName).toBe('New user');
      expect(body.createdById).toBe(f.adminId);
      expect(body.mustChangePassword).toBe(true);
      expect(Object.keys(body).sort()).toEqual(
        [
          'id',
          'email',
          'displayName',
          'role',
          'merchantId',
          'isActive',
          'mustChangePassword',
          'createdById',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
      const stored = await f.database.user.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(
        await f.passwords.verify(fixturePassword, stored.passwordHash),
      ).toBe(true);
      expect(JSON.stringify(body)).not.toContain(fixturePassword);
    }
  });
  it('maps concurrent duplicate emails to one success and one safe conflict', async () => {
    const responses = await Promise.all([
      f.post('/users', input()),
      f.post('/users', input(' NEW@EXAMPLE.TEST ')),
    ]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    expect(
      await f.database.user.count({ where: { email: 'new@example.test' } }),
    ).toBe(1);
    expect(
      JSON.stringify(
        responses.find((response) => response.status === 409)?.body,
      ),
    ).not.toMatch(/prisma|INSERT|passwordHash/);
  });
  it('validates merchant relationships and rejects spoofed fields and invalid patches', async () => {
    const merchant = await f.createMerchant();
    await f.post('/users', { ...input(), role: 'MERCHANT' }).expect(400);
    await f.post('/users', { ...input(), merchantId: merchant.id }).expect(400);
    await f
      .post('/users', {
        ...input(),
        role: 'MERCHANT',
        merchantId: randomUUID(),
      })
      .expect(404);
    await f
      .patch(`/merchants/${merchant.id}/status`, {
        isActive: false,
        reason: administrationReason,
      })
      .expect(200);
    await f
      .post('/users', { ...input(), role: 'MERCHANT', merchantId: merchant.id })
      .expect(409);
    await f.post('/users', { ...input(), createdById: f.adminId }).expect(400);
    await f.post('/users', { ...input(), passwordHash: 'spoofed' }).expect(400);
    await f
      .post('/users', { ...input(), initialPassword: 'short' })
      .expect(400);
    await f.post('/users', { ...input(), role: 'OWNER' }).expect(400);
    await f
      .patch(`/users/${f.adminId}`, { reason: administrationReason })
      .expect(400);
    await f
      .patch(`/users/${f.adminId}`, {
        displayName: null,
        reason: administrationReason,
      })
      .expect(400);
    await f
      .patch(`/users/${f.adminId}`, {
        initialPassword: fixturePassword,
        reason: administrationReason,
      })
      .expect(400);
    await f
      .patch(`/users/${f.adminId}/status`, {
        isActive: 'false',
        reason: administrationReason,
      })
      .expect(400);
    await f.get('/users/not-a-uuid').expect(400);
    await f.get(`/users/${randomUUID()}`).expect(404);
  });
  it('preserves sessions on name edits and revokes them on email and role changes', async () => {
    const user = await f.createUser();
    const token = await f.tokenFor(user.id);
    await f
      .patch(`/users/${user.id}`, { displayName: 'Missing reason' })
      .expect(400);
    await f.patch(`/users/${user.id}/status`, { isActive: false }).expect(400);
    await f
      .patch(`/users/${user.id}`, {
        displayName: ' Changed ',
        reason: administrationReason,
      })
      .expect(200);
    expect((await f.get('/auth/me', token).expect(200)).body.displayName).toBe(
      'Changed',
    );
    await f
      .patch(`/users/${user.id}`, {
        email: 'changed@example.test',
        reason: administrationReason,
      })
      .expect(200);
    await f.get('/auth/me', token).expect(401);
    const fresh = await f.tokenFor(user.id);
    await f
      .patch(`/users/${user.id}`, {
        role: 'WAREHOUSE_KEEPER',
        reason: administrationReason,
      })
      .expect(200);
    await f.get('/auth/me', fresh).expect(401);
  });
  it('requires explicit merchant removal and revokes sessions when changing merchant ownership', async () => {
    const first = await f.createMerchant();
    const second = await f.createMerchant('ZZ');
    const user = await f.createUser('MERCHANT', first.id);
    const token = await f.tokenFor(user.id);
    await f
      .patch(`/users/${user.id}`, {
        role: 'EMPLOYEE',
        reason: administrationReason,
      })
      .expect(400);
    await f
      .patch(`/users/${user.id}`, {
        merchantId: null,
        reason: administrationReason,
      })
      .expect(400);
    await f
      .patch(`/users/${user.id}`, {
        merchantId: second.id,
        reason: administrationReason,
      })
      .expect(200);
    await f.get('/auth/me', token).expect(401);
    const { body } = await f
      .patch(`/users/${user.id}`, {
        role: 'EMPLOYEE',
        merchantId: null,
        reason: administrationReason,
      })
      .expect(200);
    expect(body.merchantId).toBeNull();
    expect(body.role).toBe('EMPLOYEE');
    await f
      .patch(`/users/${user.id}`, {
        role: 'MERCHANT',
        reason: administrationReason,
      })
      .expect(400);
    await f
      .patch(`/users/${user.id}`, {
        role: 'MERCHANT',
        merchantId: first.id,
        reason: administrationReason,
      })
      .expect(200);
  });
  it('disable/re-enable never resurrects old sessions', async () => {
    const user = await f.createUser();
    const token = await f.tokenFor(user.id);
    await f
      .patch(`/users/${user.id}/status`, {
        isActive: false,
        reason: administrationReason,
      })
      .expect(200);
    await f.get('/auth/me', token).expect(401);
    await f
      .patch(`/users/${user.id}/status`, {
        isActive: true,
        reason: administrationReason,
      })
      .expect(200);
    await f.get('/auth/me', token).expect(401);
    await f.get('/auth/me', await f.tokenFor(user.id)).expect(200);
  });
  it('protects the last administrator against disable and demotion', async () => {
    await f
      .patch(`/users/${f.adminId}/status`, {
        isActive: false,
        reason: administrationReason,
      })
      .expect(409);
    await f
      .patch(`/users/${f.adminId}`, {
        role: 'EMPLOYEE',
        reason: administrationReason,
      })
      .expect(409);
    await f.get('/users').expect(200);
  });
  it.each(['disable', 'demote'])(
    'concurrent self-%s operations leave one active administrator',
    async (action) => {
      const second = await f.createUser('ADMIN');
      const secondToken = await f.tokenFor(second.id);
      const suffix = action === 'disable' ? '/status' : '';
      const body =
        action === 'disable'
          ? { isActive: false, reason: administrationReason }
          : { role: 'EMPLOYEE', reason: administrationReason };
      const outcomes = await Promise.all([
        f.patch(`/users/${f.adminId}${suffix}`, body),
        f.patch(`/users/${second.id}${suffix}`, body, secondToken),
      ]);
      expect(
        outcomes.map((response) => response.status).sort((a, b) => a - b),
      ).toEqual([200, 409]);
      expect(
        await f.database.user.count({
          where: { role: 'ADMIN', isActive: true },
        }),
      ).toBe(1);
    },
  );
  it('rolls back status changes when session revocation fails', async () => {
    const user = await f.createUser();
    const token = await f.tokenFor(user.id);
    const revoke = vi
      .spyOn(f.sessions, 'revokeForUsers')
      .mockRejectedValueOnce(new Error('Simulated failure'));
    try {
      await f
        .patch(`/users/${user.id}/status`, {
          isActive: false,
          reason: administrationReason,
        })
        .expect(500);
    } finally {
      revoke.mockRestore();
    }
    expect(
      (await f.database.user.findUniqueOrThrow({ where: { id: user.id } }))
        .isActive,
    ).toBe(true);
    await f.get('/auth/me', token).expect(200);
  });
  it.each(['role', 'session', 'password-change'])(
    'rechecks the administrator %s after waiting for the write lock',
    async (change) => {
      const target = await f.createUser();
      const held = await f.holdAdministrationLock();
      const pending = f.users
        .setStatus(f.context, target.id, false, administrationReason)
        .then(
          () => ({ status: 'allowed' }),
          (error: Error) => ({ status: error.name }),
        );
      try {
        await f.waitForBlockedAdministration();
        if (change === 'role')
          await held.query("UPDATE users SET role='EMPLOYEE' WHERE id=$1", [
            f.adminId,
          ]);
        else if (change === 'session')
          await held.query(
            'UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1',
            [f.adminId],
          );
        else
          await held.query(
            'UPDATE users SET must_change_password=true WHERE id=$1',
            [f.adminId],
          );
        await held.query('COMMIT');
        expect((await pending).status).toBe(
          change === 'session' ? 'UnauthorizedException' : 'ForbiddenException',
        );
        expect(
          (
            await f.database.user.findUniqueOrThrow({
              where: { id: target.id },
            })
          ).isActive,
        ).toBe(true);
      } finally {
        await held.query('ROLLBACK');
        await held.end();
        await pending;
      }
    },
  );
  it.each(['disable', 'email'])(
    'rejects a login paused before an administrative %s',
    async (change) => {
      const user = await f.createUser();
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
        if (change === 'disable')
          await f
            .patch(`/users/${user.id}/status`, {
              isActive: false,
              reason: administrationReason,
            })
            .expect(200);
        else
          await f
            .patch(`/users/${user.id}`, {
              email: 'replacement@example.test',
              reason: administrationReason,
            })
            .expect(200);
        release();
        expect((await pending).status).toBe(401);
        expect(
          await f.database.session.count({
            where: { userId: user.id, revokedAt: null },
          }),
        ).toBe(0);
      } finally {
        release();
        spy.mockRestore();
        await pending;
      }
    },
  );
  it('paginates with a stable tie-breaker and strictly parses boolean filters', async () => {
    const users = await Promise.all(
      Array.from({ length: 5 }, () => f.createUser()),
    );
    await f.database.user.updateMany({
      where: { id: { in: users.map((user) => user.id) } },
      data: { createdAt: new Date('2026-01-01T00:00:00Z') },
    });
    await f
      .patch(`/users/${users[0].id}/status`, {
        isActive: false,
        reason: administrationReason,
      })
      .expect(200);
    const inactive = await f.get('/users?isActive=false').expect(200);
    expect(inactive.body.items.map((user: { id: string }) => user.id)).toEqual([
      users[0].id,
    ]);
    const first = await f
      .get('/users?page=1&limit=3&role=EMPLOYEE')
      .expect(200);
    const second = await f
      .get('/users?page=2&limit=3&role=EMPLOYEE')
      .expect(200);
    expect(first.body.total).toBe(5);
    expect(
      new Set(
        [...first.body.items, ...second.body.items].map(
          (user: { id: string }) => user.id,
        ),
      ).size,
    ).toBe(5);
    expect(JSON.stringify(first.body)).not.toMatch(
      /passwordHash|tokenHash|initialPassword/,
    );
    for (const query of [
      'isActive=0',
      'isActive=no',
      'limit=101',
      'page=-1',
      'page=1.5',
      'role=UNKNOWN',
      'merchantId=bad',
    ])
      await f.get(`/users?${query}`).expect(400);
  });
  it('persists successful administration with actor and target snapshots', async () => {
    const { body } = await f.post('/users', input()).expect(201);
    const events = await f.database.auditEvent.findMany({
      where: { entityType: 'USER', entityId: body.id, action: 'CREATE' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: 'USER',
      entityId: body.id,
      action: 'CREATE',
      actorId: f.adminId,
      actorNameSnapshot: expect.any(String),
      actorRoleSnapshot: 'ADMIN',
      reason: null,
      beforeSnapshot: null,
      afterSnapshot: expect.objectContaining({
        id: body.id,
        email: 'new@example.test',
        displayName: 'New user',
      }),
      recordedAt: expect.any(Date),
    });
    expect(JSON.stringify(events)).not.toContain(fixturePassword);
    expect(JSON.stringify(events)).not.toMatch(/passwordHash|initialPassword/);
  });
});
