import 'reflect-metadata';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHash, randomBytes } from 'node:crypto';
import type { App } from 'supertest/types.js';
// Import built Nest classes so HTTP DTO decorator metadata is identical to production.
import { AppModule } from '../dist/app.module.js';
import { AuthModule } from '../dist/auth/auth.module.js';
import { configureHttp } from '../dist/http/configure-http.js';
import { Environment } from '../dist/config/environment.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { PasswordService } from '../dist/auth/password.service.js';
import { SessionService } from '../dist/auth/session.service.js';
import { LoginAttemptsService } from '../dist/auth/login-attempts.service.js';
import { SecurityAuditService } from '../dist/auth/security-audit.service.js';
import { BootstrapAdminService } from '../dist/bootstrap/bootstrap-admin.service.js';
import { Authenticated, Roles } from '../dist/auth/decorators/access.js';
import { UserRole } from '../dist/generated/prisma/client.js';
import { createAuthTestDatabase } from './support/auth-database.js';

@Controller('test-access')
class TestAccessController {
  @Authenticated() @Get('authenticated') authenticated() {
    return { allowed: true };
  }
  @Roles(UserRole.ADMIN) @Get('admin') admin() {
    return { allowed: true };
  }
  @Roles('UNKNOWN' as UserRole) @Get('unknown') unknown() {
    return { allowed: true };
  }
  @Get('undeclared') undeclared() {
    return { allowed: true };
  }
}

const initialPassword = 'Warehouse initial phrase 742!';
const nextPassword = 'Warehouse replacement phrase 853!';
const email = 'admin@example.test';
const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');

describe('Identity API against isolated PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: PrismaService;
  let passwords: PasswordService;
  let sessions: SessionService;
  let attempts: LoginAttemptsService;
  let environment: Environment;
  let bootstrap: BootstrapAdminService;
  let testDatabase: Awaited<ReturnType<typeof createAuthTestDatabase>>;
  let adminId: string;
  let merchantId: string;
  let merchantUserId: string;
  let seedHash: string;
  const originalUrl = process.env.DATABASE_URL;
  const originalSecret = process.env.AUTH_RATE_LIMIT_SECRET;

  beforeAll(async () => {
    testDatabase = await createAuthTestDatabase();
    process.env.DATABASE_URL = testDatabase.url;
    process.env.AUTH_RATE_LIMIT_SECRET = randomBytes(32).toString('hex');
    const module = await Test.createTestingModule({
      imports: [AppModule, AuthModule],
      controllers: [TestAccessController],
      providers: [BootstrapAdminService],
    }).compile();
    app = module.createNestApplication({ bodyParser: false, logger: false });
    configureHttp(app);
    await app.init();
    database = app.get(PrismaService);
    passwords = app.get(PasswordService);
    sessions = app.get(SessionService);
    attempts = app.get(LoginAttemptsService);
    environment = app.get(Environment);
    bootstrap = app.get(BootstrapAdminService);
    seedHash = await passwords.hash(initialPassword);
  }, 30000);
  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      if (testDatabase) await testDatabase.dispose();
      if (originalUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalUrl;
      if (originalSecret === undefined)
        delete process.env.AUTH_RATE_LIMIT_SECRET;
      else process.env.AUTH_RATE_LIMIT_SECRET = originalSecret;
    }
  });
  beforeEach(async () => {
    if (!database) return;
    await database.loginAttemptBucket.deleteMany();
    await database.session.deleteMany();
    if (adminId)
      await database.user.update({
        where: { id: adminId },
        data: {
          passwordHash: seedHash,
          role: 'ADMIN',
          isActive: true,
          mustChangePassword: false,
        },
      });
    if (merchantId)
      await database.merchant.update({
        where: { id: merchantId },
        data: { isActive: true },
      });
  });
  const login = (candidate = email, password = initialPassword) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: candidate, password });
  const me = (token: string) =>
    request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .auth(token, { type: 'bearer' });
  const access = (token: string, route: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/test-access/${route}`)
      .auth(token, { type: 'bearer' });

  it('bootstrap serializes concurrent invocations and can run only once', async () => {
    const outcomes = await Promise.allSettled([
      bootstrap.create(email, 'Admin', initialPassword),
      bootstrap.create('second@example.test', 'Second', initialPassword),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await database.user.count()).toBe(1);
    const admin = await database.user.findFirstOrThrow();
    // Whichever concurrent attempt won is normalized for the following API scenarios.
    await database.user.update({ where: { id: admin.id }, data: { email } });
    adminId = admin.id;
    expect(admin.role).toBe('ADMIN');
    expect(admin.mustChangePassword).toBe(true);
    await expect(
      bootstrap.create('third@example.test', 'Third', initialPassword),
    ).rejects.toThrow('already complete');
    const merchant = await database.merchant.create({
      data: {
        code: 'MZ',
        name: 'Test merchant',
        phone: '010',
        createdById: adminId,
      },
    });
    merchantId = merchant.id;
    const merchantUser = await database.user.create({
      data: {
        email: 'merchant@example.test',
        displayName: 'Merchant user',
        passwordHash: seedHash,
        role: 'MERCHANT',
        merchantId,
        createdById: adminId,
        mustChangePassword: false,
      },
    });
    merchantUserId = merchantUser.id;
  });
  it('database readiness and development OpenAPI are available', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ status: 'ok' });
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(response.body.paths['/api/v1/auth/login']).toBeDefined();
    expect(
      Object.keys(
        response.body.components.schemas.AccountResponseDto.properties,
      ).sort(),
    ).toEqual(
      [
        'id',
        'email',
        'displayName',
        'role',
        'merchantId',
        'mustChangePassword',
      ].sort(),
    );
  });
  it('normalizes email, stores only the token digest, and returns safe account fields', async () => {
    const response = await login('  ADMIN@EXAMPLE.TEST  ').expect(200);
    expect(response.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.body.user.email).toBe(email);
    expect(Object.keys(response.body.user).sort()).toEqual(
      [
        'displayName',
        'email',
        'id',
        'merchantId',
        'mustChangePassword',
        'role',
      ].sort(),
    );
    const stored = await database.session.findFirstOrThrow();
    expect(stored.tokenHash).toBe(digest(response.body.token));
    expect(stored.tokenHash).not.toBe(response.body.token);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(
      12 * 3600000,
    );
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('tokenHash');
    await me(response.body.token).expect(200);
  });
  it('unknown, incorrect, inactive account and inactive merchant have the same failure', async () => {
    const missing = await login('unknown@example.test').expect(401);
    const wrong = await login(email, 'Wrong password phrase 741').expect(401);
    await database.user.update({
      where: { id: adminId },
      data: { isActive: false },
    });
    const inactive = await login().expect(401);
    await database.merchant.update({
      where: { id: merchantId },
      data: { isActive: false },
    });
    const merchant = await login('merchant@example.test').expect(401);
    expect(missing.body).toEqual(wrong.body);
    expect(missing.body).toEqual(inactive.body);
    expect(missing.body).toEqual(merchant.body);
  });
  it('rejects unknown DTO fields, malformed inputs and oversized bodies', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: initialPassword, role: 'ADMIN', merchantId })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 123, password: [] })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'x'.repeat(20000) })
      .expect(413);
  });
  it('denies missing/malformed/fabricated credentials and undeclared route permissions', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    await me('invalid').expect(401);
    await me(randomBytes(32).toString('base64url')).expect(401);
    const { body } = await login().expect(200);
    await access(body.token, 'undeclared').expect(403);
    await access(body.token, 'unknown').expect(403);
    await access(body.token, 'admin').expect(200);
  });
  it('enforces password-change-only sessions then rotates and revokes all older sessions', async () => {
    await database.user.update({
      where: { id: adminId },
      data: { mustChangePassword: true },
    });
    const first = await login().expect(200);
    const second = await login().expect(200);
    await me(first.body.token).expect(200);
    await access(first.body.token, 'authenticated').expect(403);
    const changed = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .auth(first.body.token, { type: 'bearer' })
      .send({ currentPassword: initialPassword, newPassword: nextPassword })
      .expect(200);
    expect(changed.body.token).not.toBe(first.body.token);
    expect(changed.body.user.mustChangePassword).toBe(false);
    await me(first.body.token).expect(401);
    await me(second.body.token).expect(401);
    await access(changed.body.token, 'authenticated').expect(200);
    expect(
      await database.session.count({
        where: { userId: adminId, revokedAt: null },
      }),
    ).toBe(1);
    await login(email, initialPassword).expect(401);
    await database.loginAttemptBucket.deleteMany();
    await login(email, nextPassword).expect(200);
  });
  it('bad password changes preserve the hash and active sessions', async () => {
    const { body } = await login().expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .auth(body.token, { type: 'bearer' })
      .send({
        currentPassword: 'Incorrect current password',
        newPassword: nextPassword,
      })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .auth(body.token, { type: 'bearer' })
      .send({
        currentPassword: initialPassword,
        newPassword: 'films+pic+galeries',
      })
      .expect(400);
    expect(
      (await database.user.findUniqueOrThrow({ where: { id: adminId } }))
        .passwordHash,
    ).toBe(seedHash);
    await me(body.token).expect(200);
  });
  it('failed replacement session rolls back password update and revocations', async () => {
    const { body } = await login().expect(200);
    const create = vi
      .spyOn(sessions, 'create')
      .mockRejectedValueOnce(new Error('Simulated storage failure'));
    try {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .auth(body.token, { type: 'bearer' })
        .send({ currentPassword: initialPassword, newPassword: nextPassword })
        .expect(500);
      expect(response.body.message).toBe('Internal server error');
    } finally {
      create.mockRestore();
    }
    expect(
      (await database.user.findUniqueOrThrow({ where: { id: adminId } }))
        .passwordHash,
    ).toBe(seedHash);
    await me(body.token).expect(200);
  });
  it('simultaneous password changes yield one committed change', async () => {
    const { body } = await login().expect(200);
    const change = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .auth(body.token, { type: 'bearer' })
        .send({ currentPassword: initialPassword, newPassword: nextPassword });
    const responses = await Promise.all([change(), change()]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([200, 401]);
    expect(
      await database.session.count({
        where: { userId: adminId, revokedAt: null },
      }),
    ).toBe(1);
    await me(body.token).expect(401);
  });
  it('login verified before a concurrent password change cannot create a stale session', async () => {
    const { body } = await login().expect(200);
    let release!: () => void;
    let signal!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verified = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const original = passwords.verify.bind(passwords);
    const verification = vi
      .spyOn(passwords, 'verify')
      .mockImplementationOnce(async (password, hash) => {
        const valid = await original(password, hash);
        signal();
        await paused;
        return valid;
      });
    const pendingLogin = login().then((response) => response);
    try {
      await verified;
      await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .auth(body.token, { type: 'bearer' })
        .send({ currentPassword: initialPassword, newPassword: nextPassword })
        .expect(200);
      release();
      expect((await pendingLogin).status).toBe(401);
      expect(
        await database.session.count({
          where: { userId: adminId, revokedAt: null },
        }),
      ).toBe(1);
    } finally {
      release();
      verification.mockRestore();
      await pendingLogin;
    }
  });
  it('the shared limiter schema rejects invalid keys, negative counts and non-increasing timestamps', async () => {
    const now = new Date();
    const data = {
      keyDigest: 'a'.repeat(64),
      windowStartedAt: now,
      expiresAt: new Date(now.getTime() + 1000),
      attemptCount: 1,
    };
    await expect(
      database.loginAttemptBucket.create({
        data: { ...data, keyDigest: 'invalid' },
      }),
    ).rejects.toThrow();
    await expect(
      database.loginAttemptBucket.create({
        data: { ...data, attemptCount: -1 },
      }),
    ).rejects.toThrow();
    await expect(
      database.loginAttemptBucket.create({ data: { ...data, expiresAt: now } }),
    ).rejects.toThrow();
    expect(await database.loginAttemptBucket.count()).toBe(0);
  });
  it('production disables both the Swagger UI and its JSON document', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    let productionApp: INestApplication<App> | undefined;
    try {
      process.env.NODE_ENV = 'production';
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      productionApp = module.createNestApplication({
        bodyParser: false,
        logger: false,
      });
      configureHttp(productionApp);
      await productionApp.init();
      await request(productionApp.getHttpServer()).get('/api/docs').expect(404);
      await request(productionApp.getHttpServer())
        .get('/api/docs-json')
        .expect(404);
      await request(productionApp.getHttpServer())
        .get('/api/v1/health')
        .expect(200);
    } finally {
      if (productionApp) await productionApp.close();
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });
  it('logout revokes the current session even before the required password change', async () => {
    await database.user.update({
      where: { id: adminId },
      data: { mustChangePassword: true },
    });
    const { body } = await login().expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .auth(body.token, { type: 'bearer' })
      .expect(204);
    await me(body.token).expect(401);
  });
  it('absolute expiry and idle timeout are enforced; activity never extends absolute expiry', async () => {
    const first = await login().expect(200);
    const before = await database.session.findUniqueOrThrow({
      where: { tokenHash: digest(first.body.token) },
    });
    await me(first.body.token).expect(200);
    expect(
      (await database.session.findUniqueOrThrow({ where: { id: before.id } }))
        .expiresAt,
    ).toEqual(before.expiresAt);
    const now = Date.now();
    const old = new Date(now - 13 * 3600000);
    await database.session.update({
      where: { id: before.id },
      data: {
        createdAt: old,
        lastSeenAt: old,
        expiresAt: new Date(now - 1000),
      },
    });
    await me(first.body.token).expect(401);
    const second = await login().expect(200);
    const idle = new Date(Date.now() - 31 * 60000);
    await database.session.update({
      where: { tokenHash: digest(second.body.token) },
      data: { createdAt: idle, lastSeenAt: idle },
    });
    await me(second.body.token).expect(401);
  });
  it('reads current roles and account/merchant activity on existing sessions', async () => {
    const admin = await login().expect(200);
    await database.user.update({
      where: { id: adminId },
      data: { role: 'EMPLOYEE' },
    });
    await access(admin.body.token, 'admin').expect(403);
    expect((await me(admin.body.token).expect(200)).body.role).toBe('EMPLOYEE');
    await database.user.update({
      where: { id: adminId },
      data: { isActive: false },
    });
    await me(admin.body.token).expect(401);
    const merchant = await login('merchant@example.test').expect(200);
    await access(merchant.body.token, 'admin').expect(403);
    expect((await me(merchant.body.token).expect(200)).body.id).toBe(
      merchantUserId,
    );
    await database.merchant.update({
      where: { id: merchantId },
      data: { isActive: false },
    });
    await me(merchant.body.token).expect(401);
  });
  it('account limits persist blocked attempts and ignore untrusted spoofed source headers', async () => {
    for (let i = 0; i < 5; i++) await login(email, 'Bad password').expect(401);
    const limited = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '198.51.100.10')
      .send({ email, password: initialPassword })
      .expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(
      (await database.loginAttemptBucket.findMany()).some(
        (bucket) => bucket.attemptCount === 6,
      ),
    ).toBe(true);
    expect(limited.headers['cache-control']).toContain('no-store');
  });
  it('source limit also applies across different unknown account identifiers', async () => {
    for (let i = 0; i < 20; i++)
      await login(`unknown-${i}@example.test`, 'Wrong password').expect(401);
    await login('another@example.test', 'Wrong password').expect(429);
    const before = await database.loginAttemptBucket.count();
    for (let i = 0; i < 3; i++)
      await login(`blocked-new-${i}@example.test`, 'Wrong password').expect(
        429,
      );
    expect(await database.loginAttemptBucket.count()).toBe(before);
  }, 15000);
  it('shared attempt counters serialize across service instances and reset expired windows without cleanup', async () => {
    const other = new LoginAttemptsService(database, environment);
    const results = await Promise.all(
      Array.from({ length: 9 }, (_, i) =>
        (i % 2 ? attempts : other).consume(
          'parallel@example.test',
          'test-source',
        ),
      ),
    );
    expect(results.filter((result) => result.retryAfter === 0)).toHaveLength(5);
    const rows = await database.loginAttemptBucket.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.attemptCount === 9)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('parallel@example.test');
    const old = new Date(Date.now() - 20 * 60000);
    await database.loginAttemptBucket.updateMany({
      data: {
        windowStartedAt: old,
        expiresAt: new Date(old.getTime() + 900000),
      },
    });
    expect(
      (await attempts.consume('parallel@example.test', 'test-source'))
        .retryAfter,
    ).toBe(0);
    expect(
      (await database.loginAttemptBucket.findMany()).every(
        (row) => row.attemptCount === 1,
      ),
    ).toBe(true);
  });
  it('logs only declared audit events and account IDs, never passwords or session tokens', async () => {
    const logger = vi.spyOn(app.get(SecurityAuditService), 'record');
    try {
      const { body } = await login().expect(200);
      const calls = JSON.stringify(logger.mock.calls);
      expect(calls).toContain('login.success');
      expect(calls).not.toContain(initialPassword);
      expect(calls).not.toContain(body.token);
      expect(calls).not.toContain(email);
    } finally {
      logger.mockRestore();
    }
  });
});
