-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "shipment_dispatch_id" UUID,
ADD COLUMN     "shipment_line_id" UUID;

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "merchant_name_snapshot" VARCHAR(200) NOT NULL,
    "registered_by_id" UUID NOT NULL,
    "registered_by_name_snapshot" VARCHAR(150) NOT NULL,
    "registered_at" TIMESTAMPTZ(3) NOT NULL,
    "notes" VARCHAR(2000),
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "item_code_snapshot" VARCHAR(40) NOT NULL,
    "item_name_snapshot" VARCHAR(200) NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "shipment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_code_sequences" (
    "warehouse_id" UUID NOT NULL,
    "last_value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "shipment_code_sequences_pkey" PRIMARY KEY ("warehouse_id")
);

-- CreateTable
CREATE TABLE "shipment_preparations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "prepared_by_id" UUID NOT NULL,
    "prepared_by_name_snapshot" VARCHAR(150) NOT NULL,
    "prepared_at" TIMESTAMPTZ(3) NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,

    CONSTRAINT "shipment_preparations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_dispatches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "preparation_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "carrier_name" VARCHAR(200) NOT NULL,
    "tracking_number" VARCHAR(150) NOT NULL,
    "dispatched_by_id" UUID NOT NULL,
    "dispatched_by_name_snapshot" VARCHAR(150) NOT NULL,
    "dispatched_at" TIMESTAMPTZ(3) NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,

    CONSTRAINT "shipment_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipments_warehouse_id_merchant_id_registered_at_id_idx" ON "shipments"("warehouse_id", "merchant_id", "registered_at", "id");

-- CreateIndex
CREATE INDEX "shipments_warehouse_id_registered_by_id_registered_at_id_idx" ON "shipments"("warehouse_id", "registered_by_id", "registered_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_warehouse_id_idempotency_key_key" ON "shipments"("warehouse_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_warehouse_id_code_key" ON "shipments"("warehouse_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_id_warehouse_id_merchant_id_key" ON "shipments"("id", "warehouse_id", "merchant_id");

-- CreateIndex
CREATE INDEX "shipment_lines_warehouse_id_merchant_id_item_id_shipment_id_idx" ON "shipment_lines"("warehouse_id", "merchant_id", "item_id", "shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_lines_shipment_id_position_key" ON "shipment_lines"("shipment_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_lines_shipment_id_item_id_key" ON "shipment_lines"("shipment_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_lines_id_warehouse_id_merchant_id_item_id_key" ON "shipment_lines"("id", "warehouse_id", "merchant_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_preparations_shipment_id_key" ON "shipment_preparations"("shipment_id");

-- CreateIndex
CREATE INDEX "shipment_preparations_warehouse_id_merchant_id_prepared_at__idx" ON "shipment_preparations"("warehouse_id", "merchant_id", "prepared_at", "id");

-- CreateIndex
CREATE INDEX "shipment_preparations_warehouse_id_prepared_by_id_prepared__idx" ON "shipment_preparations"("warehouse_id", "prepared_by_id", "prepared_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_preparations_warehouse_id_idempotency_key_key" ON "shipment_preparations"("warehouse_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_preparations_id_shipment_id_warehouse_id_merchant__key" ON "shipment_preparations"("id", "shipment_id", "warehouse_id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_dispatches_shipment_id_key" ON "shipment_dispatches"("shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_dispatches_preparation_id_key" ON "shipment_dispatches"("preparation_id");

-- CreateIndex
CREATE INDEX "shipment_dispatches_warehouse_id_merchant_id_dispatched_at__idx" ON "shipment_dispatches"("warehouse_id", "merchant_id", "dispatched_at", "id");

-- CreateIndex
CREATE INDEX "shipment_dispatches_warehouse_id_dispatched_by_id_dispatche_idx" ON "shipment_dispatches"("warehouse_id", "dispatched_by_id", "dispatched_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_dispatches_warehouse_id_idempotency_key_key" ON "shipment_dispatches"("warehouse_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_dispatches_id_warehouse_id_merchant_id_key" ON "shipment_dispatches"("id", "warehouse_id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_shipment_line_id_key" ON "stock_movements"("shipment_line_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_shipment_line_id_fkey" FOREIGN KEY ("shipment_line_id") REFERENCES "shipment_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_shipment_dispatch_id_fkey" FOREIGN KEY ("shipment_dispatch_id") REFERENCES "shipment_dispatches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_registered_by_id_fkey" FOREIGN KEY ("registered_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_code_sequences" ADD CONSTRAINT "shipment_code_sequences_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_preparations" ADD CONSTRAINT "shipment_preparations_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_preparations" ADD CONSTRAINT "shipment_preparations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_preparations" ADD CONSTRAINT "shipment_preparations_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_preparations" ADD CONSTRAINT "shipment_preparations_prepared_by_id_fkey" FOREIGN KEY ("prepared_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_dispatches" ADD CONSTRAINT "shipment_dispatches_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_dispatches" ADD CONSTRAINT "shipment_dispatches_preparation_id_fkey" FOREIGN KEY ("preparation_id") REFERENCES "shipment_preparations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_dispatches" ADD CONSTRAINT "shipment_dispatches_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_dispatches" ADD CONSTRAINT "shipment_dispatches_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_dispatches" ADD CONSTRAINT "shipment_dispatches_dispatched_by_id_fkey" FOREIGN KEY ("dispatched_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Ownership must hold even when bypassing the HTTP services.
ALTER TABLE shipment_lines ADD CONSTRAINT shipment_lines_shipment_scope_fkey
  FOREIGN KEY (shipment_id, warehouse_id, merchant_id) REFERENCES shipments(id, warehouse_id, merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE shipment_lines ADD CONSTRAINT shipment_lines_item_merchant_fkey
  FOREIGN KEY (item_id, merchant_id) REFERENCES items(id, merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE shipment_preparations ADD CONSTRAINT shipment_preparations_scope_fkey
  FOREIGN KEY (shipment_id, warehouse_id, merchant_id) REFERENCES shipments(id, warehouse_id, merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE shipment_dispatches ADD CONSTRAINT shipment_dispatches_scope_fkey
  FOREIGN KEY (shipment_id, warehouse_id, merchant_id) REFERENCES shipments(id, warehouse_id, merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE shipment_dispatches ADD CONSTRAINT shipment_dispatches_preparation_scope_fkey
  FOREIGN KEY (preparation_id, shipment_id, warehouse_id, merchant_id) REFERENCES shipment_preparations(id, shipment_id, warehouse_id, merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_shipment_line_scope_fkey
  FOREIGN KEY (shipment_line_id, warehouse_id, merchant_id, item_id) REFERENCES shipment_lines(id, warehouse_id, merchant_id, item_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_shipment_dispatch_scope_fkey
  FOREIGN KEY (shipment_dispatch_id, warehouse_id, merchant_id) REFERENCES shipment_dispatches(id, warehouse_id, merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE shipments ADD CONSTRAINT shipments_values_check CHECK (
  code ~ '^SH-[0-9]{6,19}$' AND length(btrim(merchant_name_snapshot)) > 0 AND length(btrim(registered_by_name_snapshot)) > 0
  AND request_hash ~ '^[0-9a-f]{64}$' AND (notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 2000));
ALTER TABLE shipment_lines ADD CONSTRAINT shipment_lines_values_check CHECK (
  quantity BETWEEN 1 AND 1000000 AND position BETWEEN 1 AND 100 AND length(btrim(item_code_snapshot)) > 0 AND length(btrim(item_name_snapshot)) > 0);
ALTER TABLE shipment_code_sequences ADD CONSTRAINT shipment_code_sequences_nonnegative_check CHECK (last_value >= 0);
ALTER TABLE shipment_preparations ADD CONSTRAINT shipment_preparations_values_check CHECK (
  length(btrim(prepared_by_name_snapshot)) > 0 AND request_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE shipment_dispatches ADD CONSTRAINT shipment_dispatches_values_check CHECK (
  length(btrim(dispatched_by_name_snapshot)) > 0 AND length(btrim(carrier_name)) BETWEEN 1 AND 200
  AND length(btrim(tracking_number)) BETWEEN 1 AND 150 AND request_hash ~ '^[0-9a-f]{64}$');

CREATE TRIGGER shipments_append_only BEFORE UPDATE OR DELETE ON shipments FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation();
CREATE TRIGGER shipment_lines_append_only BEFORE UPDATE OR DELETE ON shipment_lines FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation();
CREATE TRIGGER shipment_preparations_append_only BEFORE UPDATE OR DELETE ON shipment_preparations FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation();
CREATE TRIGGER shipment_dispatches_append_only BEFORE UPDATE OR DELETE ON shipment_dispatches FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation();

-- Lines are fixed when registration commits, not merely after preparation.
CREATE FUNCTION validate_new_shipment_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE registration_xid TEXT;
BEGIN
  SELECT xmin::text INTO registration_xid FROM shipments WHERE id = NEW.shipment_id;
  IF registration_xid IS DISTINCT FROM (pg_current_xact_id()::text::numeric % 4294967296)::text THEN
    RAISE EXCEPTION 'shipment lines must be inserted in the registration transaction' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER shipment_lines_registration_transaction BEFORE INSERT ON shipment_lines FOR EACH ROW EXECUTE FUNCTION validate_new_shipment_line();

CREATE FUNCTION validate_shipment_registration_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line_count INTEGER; last_position INTEGER;
BEGIN
  SELECT count(*), max(position) INTO line_count, last_position FROM shipment_lines WHERE shipment_id=NEW.id;
  IF line_count NOT BETWEEN 1 AND 100 OR last_position <> line_count THEN
    RAISE EXCEPTION 'shipment registration needs a complete ordered line set' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER shipment_registration_complete AFTER INSERT ON shipments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_shipment_registration_complete();

CREATE FUNCTION validate_shipment_stage_time() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_at TIMESTAMPTZ;
BEGIN
  IF TG_TABLE_NAME = 'shipment_preparations' THEN
    SELECT registered_at INTO previous_at FROM shipments WHERE id=NEW.shipment_id;
    IF previous_at IS NULL OR NEW.prepared_at < previous_at THEN
      RAISE EXCEPTION 'preparation cannot precede registration' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT prepared_at INTO previous_at FROM shipment_preparations WHERE id=NEW.preparation_id;
    IF previous_at IS NULL OR NEW.dispatched_at < previous_at THEN
      RAISE EXCEPTION 'dispatch cannot precede preparation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER shipment_preparation_chronology BEFORE INSERT ON shipment_preparations FOR EACH ROW EXECUTE FUNCTION validate_shipment_stage_time();
CREATE TRIGGER shipment_dispatch_chronology BEFORE INSERT ON shipment_dispatches FOR EACH ROW EXECUTE FUNCTION validate_shipment_stage_time();

ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_values_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_values_check CHECK (
  (kind='RECEIPT_IN' AND quantity_delta>0 AND receipt_line_id IS NOT NULL AND adjustment_id IS NULL AND shipment_line_id IS NULL AND shipment_dispatch_id IS NULL) OR
  (kind='ADJUSTMENT_IN' AND quantity_delta>0 AND receipt_line_id IS NULL AND adjustment_id IS NOT NULL AND shipment_line_id IS NULL AND shipment_dispatch_id IS NULL) OR
  (kind='ADJUSTMENT_OUT' AND quantity_delta<0 AND receipt_line_id IS NULL AND adjustment_id IS NOT NULL AND shipment_line_id IS NULL AND shipment_dispatch_id IS NULL) OR
  (kind='SHIPMENT_OUT' AND quantity_delta<0 AND receipt_line_id IS NULL AND adjustment_id IS NULL AND shipment_line_id IS NOT NULL AND shipment_dispatch_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION validate_receipt_movement_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source RECORD;
BEGIN
  IF NEW.kind = 'RECEIPT_IN' THEN
    SELECT r.received_by_id, r.received_by_name_snapshot, r.received_at, l.item_code_snapshot, l.item_name_snapshot
      INTO source FROM receipt_lines l JOIN receipts r ON r.id=l.receipt_id WHERE l.id=NEW.receipt_line_id;
    IF NOT FOUND OR NEW.actor_id <> source.received_by_id OR NEW.actor_name_snapshot <> source.received_by_name_snapshot OR NEW.recorded_at <> source.received_at OR NEW.item_code_snapshot <> source.item_code_snapshot OR NEW.item_name_snapshot <> source.item_name_snapshot THEN
      RAISE EXCEPTION 'receipt movement does not match its source' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.kind IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT') THEN
    SELECT a.performed_by_id, a.performed_by_name_snapshot, a.recorded_at, a.item_code_snapshot, a.item_name_snapshot
      INTO source FROM stock_adjustments a WHERE a.id=NEW.adjustment_id;
    IF NOT FOUND OR NEW.actor_id <> source.performed_by_id OR NEW.actor_name_snapshot <> source.performed_by_name_snapshot OR NEW.recorded_at <> source.recorded_at OR NEW.item_code_snapshot <> source.item_code_snapshot OR NEW.item_name_snapshot <> source.item_name_snapshot THEN
      RAISE EXCEPTION 'adjustment movement does not match its source' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.kind = 'SHIPMENT_OUT' THEN
    SELECT d.dispatched_by_id, d.dispatched_by_name_snapshot, d.dispatched_at, l.item_code_snapshot, l.item_name_snapshot, l.quantity
      INTO source FROM shipment_lines l JOIN shipment_dispatches d ON d.shipment_id=l.shipment_id
      WHERE l.id=NEW.shipment_line_id AND d.id=NEW.shipment_dispatch_id;
    IF NOT FOUND OR NEW.actor_id <> source.dispatched_by_id OR NEW.actor_name_snapshot <> source.dispatched_by_name_snapshot
      OR NEW.recorded_at <> source.dispatched_at OR NEW.item_code_snapshot <> source.item_code_snapshot
      OR NEW.item_name_snapshot <> source.item_name_snapshot OR NEW.quantity_delta <> -source.quantity THEN
      RAISE EXCEPTION 'shipment movement does not match its source' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported movement source' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION validate_shipment_dispatch_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM shipment_lines WHERE shipment_id=NEW.shipment_id) OR EXISTS (
    SELECT 1 FROM shipment_lines l LEFT JOIN stock_movements m ON m.shipment_line_id=l.id
    WHERE l.shipment_id=NEW.shipment_id AND (m.id IS NULL OR m.shipment_dispatch_id IS DISTINCT FROM NEW.id OR m.quantity_delta <> -l.quantity)
  ) THEN
    RAISE EXCEPTION 'dispatch must post every shipment line exactly once' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER shipment_dispatch_complete AFTER INSERT ON shipment_dispatches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_shipment_dispatch_complete();
