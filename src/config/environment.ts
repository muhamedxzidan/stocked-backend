import 'dotenv/config';
import { Injectable } from '@nestjs/common';

@Injectable()
export class Environment {
  readonly databaseUrl = required('DATABASE_URL');
  readonly rateLimitSecret = required('AUTH_RATE_LIMIT_SECRET');
  readonly production = process.env.NODE_ENV === 'production';
  readonly port = integer('PORT', 3000, 1, 65535);
  readonly host = process.env.HOST ?? '127.0.0.1';
  readonly sessionLifetimeMs =
    integer('AUTH_SESSION_SECONDS', 43200, 60, 43200) * 1000;
  readonly sessionIdleMs = integer('AUTH_IDLE_SECONDS', 1800, 30, 1800) * 1000;
  readonly loginWindowSeconds = integer(
    'AUTH_LOGIN_WINDOW_SECONDS',
    900,
    60,
    3600,
  );
  readonly accountAttemptLimit = integer('AUTH_ACCOUNT_ATTEMPTS', 5, 1, 20);
  readonly ipAttemptLimit = integer('AUTH_IP_ATTEMPTS', 20, 1, 100);
  readonly trustedProxies = (process.env.TRUSTED_PROXIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  constructor() {
    let url: URL;
    try {
      url = new URL(this.databaseUrl);
    } catch {
      throw new Error('Invalid DATABASE_URL');
    }
    if (!['postgresql:', 'postgres:'].includes(url.protocol))
      throw new Error('PostgreSQL is required');
    if (!/^[0-9a-f]{64,}$/i.test(this.rateLimitSecret))
      throw new Error(
        'AUTH_RATE_LIMIT_SECRET must contain at least 32 random bytes in hex',
      );
    if (this.production && url.searchParams.get('sslmode') === 'disable')
      throw new Error('Production must not explicitly disable database TLS');
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function integer(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${name}`);
  return value;
}
