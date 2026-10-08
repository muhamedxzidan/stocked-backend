import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import pg from 'pg';
import { setTimeout } from 'node:timers/promises';
import { AppModule } from '../../dist/app.module.js';
import { configureHttp } from '../../dist/http/configure-http.js';
import { PrismaService } from '../../dist/database/prisma.service.js';
import { PasswordService } from '../../dist/auth/password.service.js';
import { SessionService } from '../../dist/auth/session.service.js';
import { UsersService } from '../../dist/users/users.service.js';
import { MerchantsService } from '../../dist/merchants/merchants.service.js';
import { SecurityAuditService } from '../../dist/auth/security-audit.service.js';
import type { UserRole } from '../../dist/generated/prisma/client.js';
import type { AuthenticationContext } from '../../dist/auth/authenticated-user.js';
import { createAuthTestDatabase } from './auth-database.js';

export const fixturePassword = 'Administration test phrase 981!';

export async function createAdminFixture() {
  const originalUrl = process.env.DATABASE_URL;
  const originalSecret = process.env.AUTH_RATE_LIMIT_SECRET;
  const testDatabase = await createAuthTestDatabase();
  process.env.DATABASE_URL = testDatabase.url;
  process.env.AUTH_RATE_LIMIT_SECRET = randomBytes(32).toString('hex');
  function restoreEnvironment(): void {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.AUTH_RATE_LIMIT_SECRET;
    else process.env.AUTH_RATE_LIMIT_SECRET = originalSecret;
  }
  let startedApp: INestApplication | undefined;
  try {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = module.createNestApplication({
      bodyParser: false,
      logger: false,
    });
    startedApp = app;
    configureHttp(app);
    await app.init();
    const database = app.get(PrismaService);
    const passwords = app.get(PasswordService);
    const sessions = app.get(SessionService);
    const users = app.get(UsersService);
    const merchants = app.get(MerchantsService);
    const audit = app.get(SecurityAuditService);
    const passwordHash = await passwords.hash(fixturePassword);
    let adminId: string;
    let token: string;
    let context: AuthenticationContext;
    const tokenFor = async (id: string) =>
      database.$transaction(async (transaction) => {
        await sessions.lockUser(transaction, id);
        return (await sessions.create(transaction, id)).token;
      });
    return {
      app,
      database,
      passwords,
      sessions,
      users,
      merchants,
      audit,
      passwordHash,
      tokenFor,
      get adminId() {
        return adminId;
      },
      get token() {
        return token;
      },
      get context() {
        return context;
      },
      async reset() {
        if (
          !new URL(testDatabase.url).pathname.startsWith('/stocked_auth_test_')
        )
          throw new Error('Refusing to reset a non-test database');
        await database.$executeRaw`TRUNCATE sessions, users, merchants, login_attempt_buckets CASCADE`;
        const admin = await database.user.create({
          data: {
            email: 'admin@example.test',
            displayName: 'Administrator',
            role: 'ADMIN',
            passwordHash,
            mustChangePassword: false,
          },
        });
        adminId = admin.id;
        token = await tokenFor(adminId);
        context = await sessions.authenticate(token);
      },
      createUser(
        role: UserRole = 'EMPLOYEE',
        merchantId: string | null = null,
        mustChangePassword = false,
      ) {
        return database.user.create({
          data: {
            email: `${randomUUID()}@example.test`,
            displayName: 'Fixture user',
            role,
            merchantId,
            passwordHash,
            mustChangePassword,
            createdById: adminId,
          },
        });
      },
      createMerchant(code = 'MZ') {
        return database.merchant.create({
          data: {
            code,
            name: `Merchant ${code}`,
            phone: '+201001234567',
            createdById: adminId,
          },
        });
      },
      get(path: string, credential = token) {
        return request(app.getHttpServer())
          .get(`/api/v1${path}`)
          .auth(credential, { type: 'bearer' });
      },
      post(path: string, body: object, credential = token) {
        return request(app.getHttpServer())
          .post(`/api/v1${path}`)
          .auth(credential, { type: 'bearer' })
          .send(body);
      },
      patch(path: string, body: object, credential = token) {
        return request(app.getHttpServer())
          .patch(`/api/v1${path}`)
          .auth(credential, { type: 'bearer' })
          .send(body);
      },
      // A real previous administration transaction for deterministic wait/recheck tests.
      async holdAdministrationLock() {
        const connection = new pg.Client({
          connectionString: testDatabase.url,
        });
        await connection.connect();
        await connection.query('BEGIN');
        await connection.query('SELECT pg_advisory_xact_lock(847312, 2)');
        return connection;
      },
      async waitForBlockedAdministration() {
        for (let attempt = 0; attempt < 100; attempt++) {
          const [row] = await database.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND classid = 847312 AND objid = 2) AS waiting`;
          if (row.waiting) return;
          await setTimeout(10);
        }
        throw new Error(
          'Administration did not reach the expected database lock',
        );
      },
      async close() {
        try {
          await app.close();
        } finally {
          try {
            await testDatabase.dispose();
          } finally {
            restoreEnvironment();
          }
        }
      },
    };
  } catch (error) {
    try {
      if (startedApp) await startedApp.close();
    } finally {
      try {
        await testDatabase.dispose();
      } finally {
        restoreEnvironment();
      }
    }
    throw error;
  }
}
