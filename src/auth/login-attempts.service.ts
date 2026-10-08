import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { Environment } from '../config/environment.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class LoginAttemptsService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(Environment) private readonly environment: Environment,
  ) {}
  async consume(
    email: string,
    source: string,
  ): Promise<{ retryAfter: number }> {
    // Fixed source→account lock order. Blocked sources do not create unlimited
    // account buckets by submitting a new email for every rejected request.
    const buckets = [
      {
        kind: 'source',
        key: this.key('source', source),
        limit: this.environment.ipAttemptLimit,
      },
      {
        kind: 'account',
        key: this.key('account', email.trim().toLowerCase()),
        limit: this.environment.accountAttemptLimit,
      },
    ];
    // Commit the count even for blocked attempts; throwing inside would roll it back.
    const results = await this.database.$transaction(async (transaction) => {
      const now = await this.database.time(transaction);
      const expiry = new Date(
        now.getTime() + this.environment.loginWindowSeconds * 1000,
      );
      const counts: { count: number; retryAfter: number; limited: boolean }[] =
        [];
      for (const bucket of buckets) {
        const [row] = await transaction.$queryRaw<
          { attempt_count: number; expires_at: Date }[]
        >`
          INSERT INTO login_attempt_buckets (key_digest, window_started_at, expires_at, attempt_count)
          VALUES (${bucket.key}, ${now}, ${expiry}, 1)
          ON CONFLICT (key_digest) DO UPDATE SET
            window_started_at = CASE WHEN login_attempt_buckets.expires_at <= ${now} THEN ${now} ELSE login_attempt_buckets.window_started_at END,
            expires_at = CASE WHEN login_attempt_buckets.expires_at <= ${now} THEN ${expiry} ELSE login_attempt_buckets.expires_at END,
            attempt_count = CASE WHEN login_attempt_buckets.expires_at <= ${now} THEN 1 ELSE LEAST(login_attempt_buckets.attempt_count + 1, 1000000) END
          RETURNING attempt_count, expires_at`;
        counts.push({
          count: row.attempt_count,
          limited: row.attempt_count > bucket.limit,
          retryAfter: Math.max(
            1,
            Math.ceil((row.expires_at.getTime() - now.getTime()) / 1000),
          ),
        });
        if (bucket.kind === 'source' && row.attempt_count > bucket.limit) break;
      }
      return counts;
    });
    const retryAfter = Math.max(
      0,
      ...results.filter((row) => row.limited).map((row) => row.retryAfter),
    );
    if (!retryAfter)
      await setTimeout(
        Math.min(150, (Math.max(...results.map((row) => row.count)) - 1) * 25),
      );
    return { retryAfter };
  }
  private key(kind: string, value: string): string {
    return createHmac(
      'sha256',
      Buffer.from(this.environment.rateLimitSecret, 'hex'),
    )
      .update(`${kind}:${value}`)
      .digest('hex');
  }
}
