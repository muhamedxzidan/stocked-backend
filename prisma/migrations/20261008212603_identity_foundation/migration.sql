-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('ADMIN', 'WAREHOUSE_KEEPER', 'EMPLOYEE', 'MERCHANT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(254) NOT NULL,
    "display_name" VARCHAR(150) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "merchant_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(8) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_merchant_id_idx" ON "users"("merchant_id");

-- CreateIndex
CREATE INDEX "users_role_is_active_idx" ON "users"("role", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_code_key" ON "merchants"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Application invariants not represented by Prisma's schema language.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized_check"
    CHECK (email <> '' AND email = lower(btrim(email))),
  ADD CONSTRAINT "users_display_name_nonempty_check"
    CHECK (btrim(display_name) <> ''),
  ADD CONSTRAINT "users_password_hash_nonempty_check"
    CHECK (btrim(password_hash) <> ''),
  ADD CONSTRAINT "users_role_merchant_check"
    CHECK ((role = 'MERCHANT' AND merchant_id IS NOT NULL)
        OR (role <> 'MERCHANT' AND merchant_id IS NULL));

ALTER TABLE "merchants"
  ADD CONSTRAINT "merchants_code_format_check" CHECK (code ~ '^[A-Z]{2,8}$'),
  ADD CONSTRAINT "merchants_name_nonempty_check" CHECK (btrim(name) <> ''),
  ADD CONSTRAINT "merchants_phone_nonempty_check" CHECK (btrim(phone) <> '');

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_token_hash_format_check" CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "sessions_expires_after_creation_check" CHECK (expires_at > created_at),
  ADD CONSTRAINT "sessions_last_seen_after_creation_check" CHECK (last_seen_at >= created_at),
  ADD CONSTRAINT "sessions_revoked_after_creation_check"
    CHECK (revoked_at IS NULL OR revoked_at >= created_at);

-- Merchant prefixes remain reserved for their original business permanently.
CREATE FUNCTION prevent_merchant_code_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'Merchant code cannot be changed'
      USING ERRCODE = '23514', CONSTRAINT = 'merchants_code_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER merchants_code_immutable
BEFORE UPDATE OF code ON "merchants"
FOR EACH ROW EXECUTE FUNCTION prevent_merchant_code_change();
