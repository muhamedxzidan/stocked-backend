-- CreateEnum
CREATE TYPE "receipt_line_condition" AS ENUM ('GOOD', 'NOTED');

-- CreateEnum
CREATE TYPE "receipt_issue_type" AS ENUM ('BROKEN', 'SCRATCH', 'DAMAGED', 'OTHER');

-- CreateEnum
CREATE TYPE "stock_movement_kind" AS ENUM ('RECEIPT_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');

-- CreateEnum
CREATE TYPE "stock_adjustment_direction" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(12) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "merchant_name_snapshot" VARCHAR(200) NOT NULL,
    "received_by_id" UUID NOT NULL,
    "received_by_name_snapshot" VARCHAR(150) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "notes" VARCHAR(2000),
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "item_code_snapshot" VARCHAR(40) NOT NULL,
    "item_name_snapshot" VARCHAR(200) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "condition" "receipt_line_condition" NOT NULL,
    "issue_type" "receipt_issue_type",
    "notes" VARCHAR(2000),

    CONSTRAINT "receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("warehouse_id","item_id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "merchant_name_snapshot" VARCHAR(200) NOT NULL,
    "item_id" UUID NOT NULL,
    "item_code_snapshot" VARCHAR(40) NOT NULL,
    "item_name_snapshot" VARCHAR(200) NOT NULL,
    "reference_movement_id" UUID NOT NULL,
    "direction" "stock_adjustment_direction" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "performed_by_id" UUID NOT NULL,
    "performed_by_name_snapshot" VARCHAR(150) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "item_code_snapshot" VARCHAR(40) NOT NULL,
    "item_name_snapshot" VARCHAR(200) NOT NULL,
    "kind" "stock_movement_kind" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_name_snapshot" VARCHAR(150) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "receipt_line_id" UUID,
    "adjustment_id" UUID,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "items_id_merchant_id_key" ON "items"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE INDEX "receipts_warehouse_id_merchant_id_received_at_id_idx" ON "receipts"("warehouse_id", "merchant_id", "received_at", "id");

-- CreateIndex
CREATE INDEX "receipts_warehouse_id_received_by_id_received_at_id_idx" ON "receipts"("warehouse_id", "received_by_id", "received_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_warehouse_id_idempotency_key_key" ON "receipts"("warehouse_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_id_warehouse_id_merchant_id_key" ON "receipts"("id", "warehouse_id", "merchant_id");

-- CreateIndex
CREATE INDEX "receipt_lines_warehouse_id_merchant_id_item_id_receipt_id_idx" ON "receipt_lines"("warehouse_id", "merchant_id", "item_id", "receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_lines_receipt_id_position_key" ON "receipt_lines"("receipt_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_lines_id_warehouse_id_merchant_id_item_id_quantity_key" ON "receipt_lines"("id", "warehouse_id", "merchant_id", "item_id", "quantity");

-- CreateIndex
CREATE INDEX "inventory_balances_merchant_id_item_id_idx" ON "inventory_balances"("merchant_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_balances_warehouse_id_item_id_merchant_id_key" ON "inventory_balances"("warehouse_id", "item_id", "merchant_id");

-- CreateIndex
CREATE INDEX "stock_adjustments_warehouse_id_merchant_id_recorded_at_id_idx" ON "stock_adjustments"("warehouse_id", "merchant_id", "recorded_at", "id");

-- CreateIndex
CREATE INDEX "stock_adjustments_warehouse_id_performed_by_id_recorded_at__idx" ON "stock_adjustments"("warehouse_id", "performed_by_id", "recorded_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_warehouse_id_idempotency_key_key" ON "stock_adjustments"("warehouse_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_id_warehouse_id_merchant_id_item_id_quant_key" ON "stock_adjustments"("id", "warehouse_id", "merchant_id", "item_id", "quantity_delta");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_receipt_line_id_key" ON "stock_movements"("receipt_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_adjustment_id_key" ON "stock_movements"("adjustment_id");

-- CreateIndex
CREATE INDEX "stock_movements_warehouse_id_merchant_id_recorded_at_id_idx" ON "stock_movements"("warehouse_id", "merchant_id", "recorded_at", "id");

-- CreateIndex
CREATE INDEX "stock_movements_warehouse_id_item_id_recorded_at_id_idx" ON "stock_movements"("warehouse_id", "item_id", "recorded_at", "id");

-- CreateIndex
CREATE INDEX "stock_movements_warehouse_id_actor_id_recorded_at_id_idx" ON "stock_movements"("warehouse_id", "actor_id", "recorded_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_id_warehouse_id_merchant_id_item_id_key" ON "stock_movements"("id", "warehouse_id", "merchant_id", "item_id");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_reference_movement_id_fkey" FOREIGN KEY ("reference_movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_receipt_line_id_fkey" FOREIGN KEY ("receipt_line_id") REFERENCES "receipt_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "stock_adjustments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "stock_movements_id_warehouse_id_merchant_id_item_id_quantity_key"
    ON "stock_movements"("id", "warehouse_id", "merchant_id", "item_id", "quantity_delta");

ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_item_merchant_fkey"
    FOREIGN KEY ("item_id", "merchant_id") REFERENCES "items"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receipt_scope_fkey"
    FOREIGN KEY ("receipt_id", "warehouse_id", "merchant_id") REFERENCES "receipts"("id", "warehouse_id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_item_merchant_fkey"
    FOREIGN KEY ("item_id", "merchant_id") REFERENCES "items"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_item_merchant_fkey"
    FOREIGN KEY ("item_id", "merchant_id") REFERENCES "items"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_source_scope_fkey"
    FOREIGN KEY ("reference_movement_id", "warehouse_id", "merchant_id", "item_id") REFERENCES "stock_movements"("id", "warehouse_id", "merchant_id", "item_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_merchant_fkey"
    FOREIGN KEY ("item_id", "merchant_id") REFERENCES "items"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_receipt_source_fkey"
    FOREIGN KEY ("receipt_line_id", "warehouse_id", "merchant_id", "item_id", "quantity_delta") REFERENCES "receipt_lines"("id", "warehouse_id", "merchant_id", "item_id", "quantity") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_adjustment_source_fkey"
    FOREIGN KEY ("adjustment_id", "warehouse_id", "merchant_id", "item_id", "quantity_delta") REFERENCES "stock_adjustments"("id", "warehouse_id", "merchant_id", "item_id", "quantity_delta") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "receipts" ADD CONSTRAINT "receipts_notes_length_check" CHECK ("notes" IS NULL OR (length(btrim("notes")) BETWEEN 1 AND 2000));
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_values_check" CHECK (
    "quantity" BETWEEN 1 AND 1000000 AND "position" BETWEEN 1 AND 100 AND
    (("condition" = 'GOOD' AND "issue_type" IS NULL AND "notes" IS NULL) OR
     ("condition" = 'NOTED' AND "issue_type" IS NOT NULL AND "notes" IS NOT NULL AND length(btrim("notes")) BETWEEN 10 AND 2000))
);
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_quantity_check" CHECK ("quantity" >= 0);
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_values_check" CHECK (
    "quantity" BETWEEN 1 AND 1000000 AND length(btrim("reason")) BETWEEN 10 AND 2000 AND
    (("direction" = 'IN' AND "quantity_delta" = "quantity") OR ("direction" = 'OUT' AND "quantity_delta" = -"quantity"))
);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_values_check" CHECK (
    (("kind" = 'RECEIPT_IN' AND "quantity_delta" > 0 AND "receipt_line_id" IS NOT NULL AND "adjustment_id" IS NULL) OR
     ("kind" = 'ADJUSTMENT_IN' AND "quantity_delta" > 0 AND "receipt_line_id" IS NULL AND "adjustment_id" IS NOT NULL) OR
     ("kind" = 'ADJUSTMENT_OUT' AND "quantity_delta" < 0 AND "receipt_line_id" IS NULL AND "adjustment_id" IS NOT NULL))
);

CREATE FUNCTION reject_inventory_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'inventory history is append-only' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER receipts_append_only BEFORE UPDATE OR DELETE ON "receipts" FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation();
CREATE TRIGGER receipt_lines_append_only BEFORE UPDATE OR DELETE ON "receipt_lines" FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation();
CREATE TRIGGER stock_adjustments_append_only BEFORE UPDATE OR DELETE ON "stock_adjustments" FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation();
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation();

CREATE FUNCTION validate_receipt_movement_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source RECORD;
BEGIN
  IF NEW.kind = 'RECEIPT_IN' THEN
    SELECT r.received_by_id, r.received_by_name_snapshot, r.received_at, l.item_code_snapshot, l.item_name_snapshot
      INTO source FROM "receipt_lines" l JOIN "receipts" r ON r.id=l.receipt_id
      WHERE l.id=NEW.receipt_line_id;
    IF source IS NULL OR NEW.actor_id <> source.received_by_id OR NEW.actor_name_snapshot <> source.received_by_name_snapshot OR NEW.recorded_at <> source.received_at OR NEW.item_code_snapshot <> source.item_code_snapshot OR NEW.item_name_snapshot <> source.item_name_snapshot THEN
      RAISE EXCEPTION 'receipt movement does not match its source' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT a.performed_by_id, a.performed_by_name_snapshot, a.recorded_at, a.item_code_snapshot, a.item_name_snapshot
      INTO source FROM "stock_adjustments" a WHERE a.id=NEW.adjustment_id;
    IF source IS NULL OR NEW.actor_id <> source.performed_by_id OR NEW.actor_name_snapshot <> source.performed_by_name_snapshot OR NEW.recorded_at <> source.recorded_at OR NEW.item_code_snapshot <> source.item_code_snapshot OR NEW.item_name_snapshot <> source.item_name_snapshot THEN
      RAISE EXCEPTION 'adjustment movement does not match its source' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER stock_movement_source_snapshot BEFORE INSERT ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION validate_receipt_movement_source();

CREATE FUNCTION validate_adjustment_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source RECORD;
BEGIN
  SELECT kind, warehouse_id, merchant_id, item_id INTO source FROM "stock_movements" WHERE id=NEW.reference_movement_id;
  IF source.kind IS DISTINCT FROM 'RECEIPT_IN' OR source.warehouse_id <> NEW.warehouse_id OR source.merchant_id <> NEW.merchant_id OR source.item_id <> NEW.item_id THEN
    RAISE EXCEPTION 'adjustment must reference an original receipt movement' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER stock_adjustment_source BEFORE INSERT ON "stock_adjustments" FOR EACH ROW EXECUTE FUNCTION validate_adjustment_source();

CREATE FUNCTION validate_inventory_balance_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'inventory balance rows cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF NEW.quantity < 0 THEN RAISE EXCEPTION 'inventory balance cannot be negative' USING ERRCODE = '23514'; END IF;
  -- Concurrent first writers can both reach this INSERT before the unique-key
  -- conflict is resolved. Only the winning zero-row insert is meaningful;
  -- validate its final state at commit after the writer updates the projection.
  IF TG_OP = 'INSERT' THEN
    IF NEW.quantity <> 0 THEN RAISE EXCEPTION 'new inventory balances must start at zero' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM(quantity_delta),0) INTO total FROM "stock_movements"
    WHERE warehouse_id=NEW.warehouse_id AND item_id=NEW.item_id;
  IF NEW.quantity::BIGINT <> total THEN RAISE EXCEPTION 'inventory balance must equal movement ledger' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER inventory_balance_projection BEFORE INSERT OR UPDATE OR DELETE ON "inventory_balances" FOR EACH ROW EXECUTE FUNCTION validate_inventory_balance_projection();

CREATE FUNCTION validate_balance_projection_deferred() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total BIGINT; current_quantity INTEGER;
BEGIN
  SELECT quantity INTO current_quantity FROM "inventory_balances"
    WHERE warehouse_id=NEW.warehouse_id AND item_id=NEW.item_id;
  SELECT COALESCE(SUM(quantity_delta),0) INTO total FROM "stock_movements"
    WHERE warehouse_id=NEW.warehouse_id AND item_id=NEW.item_id;
  IF current_quantity IS NULL OR current_quantity::BIGINT <> total THEN RAISE EXCEPTION 'inventory balance must equal movement ledger' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER inventory_balance_projection_deferred AFTER INSERT OR UPDATE ON "inventory_balances" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_balance_projection_deferred();

CREATE FUNCTION validate_movement_projection_deferred() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_quantity INTEGER; total BIGINT;
BEGIN
  SELECT quantity INTO current_quantity FROM "inventory_balances" WHERE warehouse_id=NEW.warehouse_id AND item_id=NEW.item_id;
  SELECT COALESCE(SUM(quantity_delta),0) INTO total FROM "stock_movements" WHERE warehouse_id=NEW.warehouse_id AND item_id=NEW.item_id;
  IF current_quantity IS NULL OR current_quantity::BIGINT <> total THEN RAISE EXCEPTION 'movement ledger and balance projection must match' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER stock_movement_projection AFTER INSERT ON "stock_movements" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_movement_projection_deferred();

INSERT INTO "warehouses" ("code", "name") VALUES ('MAIN', 'المخزن الرئيسي');
