CREATE TABLE "login_attempt_buckets" (
  "key_digest" CHAR(64) PRIMARY KEY,
  "window_started_at" TIMESTAMPTZ(3) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "attempt_count" INTEGER NOT NULL,
  CONSTRAINT "login_attempts_key_digest_check" CHECK (key_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "login_attempts_count_check" CHECK (attempt_count >= 0 AND attempt_count <= 1000000),
  CONSTRAINT "login_attempts_expiry_check" CHECK (expires_at > window_started_at)
);
CREATE INDEX "login_attempt_buckets_expires_at_idx" ON "login_attempt_buckets" ("expires_at");
