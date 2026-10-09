-- CreateEnum
CREATE TYPE "return_issue_type" AS ENUM ('BROKEN', 'SCRATCH', 'DAMAGED', 'MISMATCH', 'OTHER');

-- CreateEnum
CREATE TYPE "return_review_decision" AS ENUM ('ACCEPT_TO_STOCK', 'REJECT_OUTSIDE_STOCK');


-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "return_inspection_line_id" UUID,
ADD COLUMN     "return_review_id" UUID;

-- CreateTable
CREATE TABLE "return_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "dispatch_id" UUID NOT NULL,
    "merchant_name_snapshot" VARCHAR(200) NOT NULL,
    "shipment_code_snapshot" VARCHAR(24) NOT NULL,
    "received_by_id" UUID NOT NULL,
    "received_by_name_snapshot" VARCHAR(150) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "notes" VARCHAR(2000),
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,

    CONSTRAINT "return_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_receipt_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "shipment_line_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "item_code_snapshot" VARCHAR(40) NOT NULL,
    "item_name_snapshot" VARCHAR(200) NOT NULL,

    CONSTRAINT "return_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_inspections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "inspected_by_id" UUID NOT NULL,
    "inspected_by_name_snapshot" VARCHAR(150) NOT NULL,
    "inspected_at" TIMESTAMPTZ(3) NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,

    CONSTRAINT "return_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_inspection_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inspection_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "receipt_line_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "condition" "receipt_line_condition" NOT NULL,
    "issue_type" "return_issue_type",
    "notes" VARCHAR(2000),

    CONSTRAINT "return_inspection_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inspection_line_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "decision" "return_review_decision" NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "reviewed_by_id" UUID NOT NULL,
    "reviewed_by_name_snapshot" VARCHAR(150) NOT NULL,
    "reviewed_at" TIMESTAMPTZ(3) NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,

    CONSTRAINT "return_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "return_receipts_merchant_id_received_at_id_idx" ON "return_receipts"("merchant_id", "received_at", "id");

-- CreateIndex
CREATE INDEX "return_receipts_shipment_id_received_at_id_idx" ON "return_receipts"("shipment_id", "received_at", "id");

-- CreateIndex
CREATE INDEX "return_receipts_received_by_id_received_at_id_idx" ON "return_receipts"("received_by_id", "received_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "return_receipts_warehouse_id_idempotency_key_key" ON "return_receipts"("warehouse_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "return_receipt_source_key" ON "return_receipts"("id", "shipment_id", "warehouse_id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_receipt_scope_key" ON "return_receipts"("id", "warehouse_id", "merchant_id");

-- CreateIndex
CREATE INDEX "return_receipt_lines_shipment_line_id_idx" ON "return_receipt_lines"("shipment_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_receipt_lines_receipt_id_shipment_line_id_key" ON "return_receipt_lines"("receipt_id", "shipment_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_receipt_lines_receipt_id_position_key" ON "return_receipt_lines"("receipt_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "return_receipt_line_scope_key" ON "return_receipt_lines"("id", "receipt_id", "warehouse_id", "merchant_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_inspections_receipt_id_key" ON "return_inspections"("receipt_id");

-- CreateIndex
CREATE INDEX "return_inspections_inspected_by_id_inspected_at_id_idx" ON "return_inspections"("inspected_by_id", "inspected_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "return_inspections_warehouse_id_idempotency_key_key" ON "return_inspections"("warehouse_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "return_inspection_scope_key" ON "return_inspections"("id", "receipt_id", "warehouse_id", "merchant_id");

-- CreateIndex
CREATE INDEX "return_inspection_lines_receipt_line_id_idx" ON "return_inspection_lines"("receipt_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_inspection_lines_inspection_id_position_key" ON "return_inspection_lines"("inspection_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "return_group_scope_key" ON "return_inspection_lines"("id", "warehouse_id", "merchant_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_reviews_inspection_line_id_key" ON "return_reviews"("inspection_line_id");

-- CreateIndex
CREATE INDEX "return_reviews_reviewed_by_id_reviewed_at_id_idx" ON "return_reviews"("reviewed_by_id", "reviewed_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "return_reviews_warehouse_id_idempotency_key_key" ON "return_reviews"("warehouse_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "return_review_scope_key" ON "return_reviews"("id", "inspection_line_id", "warehouse_id", "merchant_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_return_inspection_line_id_key" ON "stock_movements"("return_inspection_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_return_review_id_key" ON "stock_movements"("return_review_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_line_return_scope_key" ON "shipment_lines"("id", "shipment_id", "warehouse_id", "merchant_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_return_scope_key" ON "shipment_dispatches"("id", "shipment_id", "warehouse_id", "merchant_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_return_inspection_line_id_fkey" FOREIGN KEY ("return_inspection_line_id") REFERENCES "return_inspection_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_return_review_id_fkey" FOREIGN KEY ("return_review_id") REFERENCES "return_reviews"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "return_receipts" ADD CONSTRAINT "return_receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "return_receipts" ADD CONSTRAINT "return_receipts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "return_receipts" ADD CONSTRAINT "return_receipts_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "return_receipts" ADD CONSTRAINT "return_receipts_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "shipment_dispatches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "return_receipts" ADD CONSTRAINT "return_receipts_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "return_receipt_lines" ADD CONSTRAINT "return_receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "return_receipts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "return_receipt_lines" ADD CONSTRAINT "return_receipt_lines_shipment_line_id_fkey" FOREIGN KEY ("shipment_line_id") REFERENCES "shipment_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "return_inspections" ADD CONSTRAINT "return_inspections_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "return_receipts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "return_inspections" ADD CONSTRAINT "return_inspections_inspected_by_id_fkey" FOREIGN KEY ("inspected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "return_inspection_lines" ADD CONSTRAINT "return_inspection_lines_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "return_inspections"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "return_inspection_lines" ADD CONSTRAINT "return_inspection_lines_receipt_line_id_fkey" FOREIGN KEY ("receipt_line_id") REFERENCES "return_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "return_reviews" ADD CONSTRAINT "return_reviews_inspection_line_id_fkey" FOREIGN KEY ("inspection_line_id") REFERENCES "return_inspection_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "return_reviews" ADD CONSTRAINT "return_reviews_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite source ownership is enforced independently of the API.
ALTER TABLE return_receipts ADD CONSTRAINT return_receipt_dispatch_scope FOREIGN KEY(dispatch_id,shipment_id,warehouse_id,merchant_id) REFERENCES shipment_dispatches(id,shipment_id,warehouse_id,merchant_id);
ALTER TABLE return_receipt_lines ADD CONSTRAINT return_line_receipt_scope FOREIGN KEY(receipt_id,shipment_id,warehouse_id,merchant_id) REFERENCES return_receipts(id,shipment_id,warehouse_id,merchant_id);
ALTER TABLE return_receipt_lines ADD CONSTRAINT return_line_shipment_scope FOREIGN KEY(shipment_line_id,shipment_id,warehouse_id,merchant_id,item_id) REFERENCES shipment_lines(id,shipment_id,warehouse_id,merchant_id,item_id);
ALTER TABLE return_inspections ADD CONSTRAINT return_inspection_receipt_scope FOREIGN KEY(receipt_id,warehouse_id,merchant_id) REFERENCES return_receipts(id,warehouse_id,merchant_id);
ALTER TABLE return_inspection_lines ADD CONSTRAINT return_group_inspection_scope FOREIGN KEY(inspection_id,receipt_id,warehouse_id,merchant_id) REFERENCES return_inspections(id,receipt_id,warehouse_id,merchant_id);
ALTER TABLE return_inspection_lines ADD CONSTRAINT return_group_receipt_line_scope FOREIGN KEY(receipt_line_id,receipt_id,warehouse_id,merchant_id,item_id) REFERENCES return_receipt_lines(id,receipt_id,warehouse_id,merchant_id,item_id);
ALTER TABLE return_reviews ADD CONSTRAINT return_review_group_scope FOREIGN KEY(inspection_line_id,warehouse_id,merchant_id,item_id) REFERENCES return_inspection_lines(id,warehouse_id,merchant_id,item_id);
ALTER TABLE stock_movements ADD CONSTRAINT movement_return_group_scope FOREIGN KEY(return_inspection_line_id,warehouse_id,merchant_id,item_id) REFERENCES return_inspection_lines(id,warehouse_id,merchant_id,item_id);
ALTER TABLE stock_movements ADD CONSTRAINT movement_return_review_scope FOREIGN KEY(return_review_id,return_inspection_line_id,warehouse_id,merchant_id,item_id) REFERENCES return_reviews(id,inspection_line_id,warehouse_id,merchant_id,item_id);
ALTER TABLE return_receipts ADD CONSTRAINT return_receipt_values CHECK(request_hash ~ '^[0-9a-f]{64}$' AND length(btrim(received_by_name_snapshot))>0 AND length(btrim(merchant_name_snapshot))>0 AND length(btrim(shipment_code_snapshot))>0 AND (notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 2000));
ALTER TABLE return_receipt_lines ADD CONSTRAINT return_line_values CHECK(quantity BETWEEN 1 AND 1000000 AND position BETWEEN 1 AND 100 AND length(btrim(item_code_snapshot))>0 AND length(btrim(item_name_snapshot))>0);
ALTER TABLE return_inspections ADD CONSTRAINT return_inspection_values CHECK(request_hash ~ '^[0-9a-f]{64}$' AND length(btrim(inspected_by_name_snapshot))>0);
ALTER TABLE return_inspection_lines ADD CONSTRAINT return_group_values CHECK(quantity BETWEEN 1 AND 1000000 AND position BETWEEN 1 AND 600 AND ((condition='GOOD' AND issue_type IS NULL AND notes IS NULL) OR (condition='NOTED' AND issue_type IS NOT NULL AND notes IS NOT NULL AND length(btrim(notes)) BETWEEN 10 AND 2000)));
ALTER TABLE return_reviews ADD CONSTRAINT return_review_values CHECK(request_hash ~ '^[0-9a-f]{64}$' AND length(btrim(reviewed_by_name_snapshot))>0 AND length(btrim(reason)) BETWEEN 10 AND 2000);
CREATE UNIQUE INDEX return_good_group_unique ON return_inspection_lines(inspection_id,receipt_line_id) WHERE condition='GOOD';
CREATE UNIQUE INDEX return_noted_group_unique ON return_inspection_lines(inspection_id,receipt_line_id,issue_type) WHERE condition='NOTED';
CREATE TRIGGER return_receipts_append_only BEFORE UPDATE OR DELETE ON return_receipts FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation();
CREATE TRIGGER return_receipt_lines_append_only BEFORE UPDATE OR DELETE ON return_receipt_lines FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation();
CREATE TRIGGER return_inspections_append_only BEFORE UPDATE OR DELETE ON return_inspections FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation();
CREATE TRIGGER return_inspection_lines_append_only BEFORE UPDATE OR DELETE ON return_inspection_lines FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation();
CREATE TRIGGER return_reviews_append_only BEFORE UPDATE OR DELETE ON return_reviews FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation();

CREATE FUNCTION validate_return_arrival_line() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE parent_xid TEXT; sent INTEGER; prior BIGINT; source RECORD;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'return arrivals require read committed isolation' USING ERRCODE='23514';
 END IF;
 SELECT xmin::text INTO parent_xid FROM return_receipts WHERE id=NEW.receipt_id;
 IF parent_xid IS DISTINCT FROM (pg_current_xact_id()::text::numeric % 4294967296)::text THEN
  RAISE EXCEPTION 'return lines are sealed at receipt commit' USING ERRCODE='23514';
 END IF;
 -- A fresh statement snapshot after the lock includes the previous receiver's commit.
 PERFORM id FROM shipments WHERE id=NEW.shipment_id FOR UPDATE;
 SELECT quantity,item_code_snapshot,item_name_snapshot INTO source FROM shipment_lines WHERE id=NEW.shipment_line_id;
 sent:=source.quantity;
 SELECT coalesce(sum(quantity),0) INTO prior FROM return_receipt_lines WHERE shipment_line_id=NEW.shipment_line_id;
 IF sent IS NULL OR prior+NEW.quantity>sent THEN
  RAISE EXCEPTION 'physical returns exceed dispatched quantity' USING ERRCODE='23514';
 END IF;
 IF NEW.item_code_snapshot IS DISTINCT FROM source.item_code_snapshot OR NEW.item_name_snapshot IS DISTINCT FROM source.item_name_snapshot THEN
  RAISE EXCEPTION 'return snapshots must match shipped item' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER return_arrival_line_guard BEFORE INSERT ON return_receipt_lines FOR EACH ROW EXECUTE FUNCTION validate_return_arrival_line();
CREATE FUNCTION validate_return_receipt_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n INTEGER; last_position INTEGER;
BEGIN
 SELECT count(*),max(position) INTO n,last_position FROM return_receipt_lines WHERE receipt_id=NEW.id;
 IF n NOT BETWEEN 1 AND 100 OR last_position<>n THEN
  RAISE EXCEPTION 'return receipt needs complete ordered lines' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER return_receipt_complete AFTER INSERT ON return_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_return_receipt_complete();
CREATE FUNCTION validate_return_stage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source RECORD; user_role user_role;
BEGIN
 IF TG_TABLE_NAME='return_receipts' THEN
  -- Acquire the cap lock before the header's shipment FK takes KEY SHARE.
  -- Direct concurrent SQL writers must not both upgrade that FK lock later.
  PERFORM id FROM shipments WHERE id=NEW.shipment_id FOR UPDATE;
  SELECT dispatched_at INTO source FROM shipment_dispatches WHERE id=NEW.dispatch_id;
  IF source.dispatched_at IS NULL OR NEW.received_at<source.dispatched_at THEN
   RAISE EXCEPTION 'return receipt cannot precede dispatch' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='return_inspections' THEN
  SELECT received_at INTO source FROM return_receipts WHERE id=NEW.receipt_id;
  IF source.received_at IS NULL OR NEW.inspected_at<source.received_at THEN
   RAISE EXCEPTION 'inspection cannot precede arrival' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT l.condition,l.issue_type,i.inspected_at INTO source FROM return_inspection_lines l JOIN return_inspections i ON i.id=l.inspection_id WHERE l.id=NEW.inspection_line_id;
  SELECT role INTO user_role FROM users WHERE id=NEW.reviewed_by_id;
  IF source.condition IS DISTINCT FROM 'NOTED' OR NEW.reviewed_at<source.inspected_at OR user_role NOT IN ('ADMIN','WAREHOUSE_KEEPER') OR (source.issue_type='MISMATCH' AND NEW.decision='ACCEPT_TO_STOCK') THEN
   RAISE EXCEPTION 'invalid return review' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER return_receipt_chronology BEFORE INSERT ON return_receipts FOR EACH ROW EXECUTE FUNCTION validate_return_stage();
CREATE TRIGGER return_inspection_chronology BEFORE INSERT ON return_inspections FOR EACH ROW EXECUTE FUNCTION validate_return_stage();
CREATE TRIGGER return_review_guard BEFORE INSERT ON return_reviews FOR EACH ROW EXECUTE FUNCTION validate_return_stage();
CREATE FUNCTION validate_return_group_seal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_xid TEXT;
BEGIN
 SELECT xmin::text INTO parent_xid FROM return_inspections WHERE id=NEW.inspection_id;
 IF parent_xid IS DISTINCT FROM (pg_current_xact_id()::text::numeric % 4294967296)::text THEN
  RAISE EXCEPTION 'inspection groups are sealed at inspection commit' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER return_group_seal BEFORE INSERT ON return_inspection_lines FOR EACH ROW EXECUTE FUNCTION validate_return_group_seal();
CREATE FUNCTION validate_return_inspection_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n INTEGER; last_position INTEGER;
BEGIN
 SELECT count(*),max(position) INTO n,last_position FROM return_inspection_lines WHERE inspection_id=NEW.id;
 IF n NOT BETWEEN 1 AND 600 OR last_position<>n OR EXISTS (
  SELECT 1 FROM return_receipt_lines l LEFT JOIN return_inspection_lines g ON g.receipt_line_id=l.id AND g.inspection_id=NEW.id
  WHERE l.receipt_id=NEW.receipt_id GROUP BY l.id,l.quantity HAVING coalesce(sum(g.quantity),0)<>l.quantity
 ) THEN
  RAISE EXCEPTION 'inspection must classify every received piece exactly once' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM return_inspection_lines g LEFT JOIN stock_movements m ON m.return_inspection_line_id=g.id WHERE g.inspection_id=NEW.id AND g.condition='GOOD' AND m.id IS NULL) THEN
  RAISE EXCEPTION 'good return groups must be posted' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER return_inspection_complete AFTER INSERT ON return_inspections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_return_inspection_complete();
CREATE FUNCTION validate_return_review_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.decision='ACCEPT_TO_STOCK' AND NOT EXISTS(SELECT 1 FROM stock_movements WHERE return_review_id=NEW.id)) OR
 (NEW.decision='REJECT_OUTSIDE_STOCK' AND EXISTS(SELECT 1 FROM stock_movements WHERE return_inspection_line_id=NEW.inspection_line_id)) THEN
  RAISE EXCEPTION 'return review posting does not match decision' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER return_review_complete AFTER INSERT ON return_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_return_review_complete();

-- Extend the source sum type, preserving all previous branches.
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_values_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_values_check CHECK (
 (kind='RECEIPT_IN' AND quantity_delta>0 AND receipt_line_id IS NOT NULL AND adjustment_id IS NULL AND shipment_line_id IS NULL AND shipment_dispatch_id IS NULL AND return_inspection_line_id IS NULL AND return_review_id IS NULL) OR
 (kind='ADJUSTMENT_IN' AND quantity_delta>0 AND receipt_line_id IS NULL AND adjustment_id IS NOT NULL AND shipment_line_id IS NULL AND shipment_dispatch_id IS NULL AND return_inspection_line_id IS NULL AND return_review_id IS NULL) OR
 (kind='ADJUSTMENT_OUT' AND quantity_delta<0 AND receipt_line_id IS NULL AND adjustment_id IS NOT NULL AND shipment_line_id IS NULL AND shipment_dispatch_id IS NULL AND return_inspection_line_id IS NULL AND return_review_id IS NULL) OR
 (kind='SHIPMENT_OUT' AND quantity_delta<0 AND receipt_line_id IS NULL AND adjustment_id IS NULL AND shipment_line_id IS NOT NULL AND shipment_dispatch_id IS NOT NULL AND return_inspection_line_id IS NULL AND return_review_id IS NULL) OR
 (kind='RETURN_IN' AND quantity_delta>0 AND receipt_line_id IS NULL AND adjustment_id IS NULL AND shipment_line_id IS NULL AND shipment_dispatch_id IS NULL AND return_inspection_line_id IS NOT NULL)
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
  ELSIF NEW.kind = 'RETURN_IN' THEN
    SELECT g.quantity,g.condition,g.issue_type,l.item_code_snapshot,l.item_name_snapshot,
      CASE WHEN g.condition='GOOD' THEN i.inspected_by_id ELSE r.reviewed_by_id END AS actor_id,
      CASE WHEN g.condition='GOOD' THEN i.inspected_by_name_snapshot ELSE r.reviewed_by_name_snapshot END AS actor_name,
      CASE WHEN g.condition='GOOD' THEN i.inspected_at ELSE r.reviewed_at END AS recorded_at,
      r.id AS review_id,r.decision
    INTO source FROM return_inspection_lines g JOIN return_inspections i ON i.id=g.inspection_id
      JOIN return_receipt_lines l ON l.id=g.receipt_line_id
      LEFT JOIN return_reviews r ON r.inspection_line_id=g.id WHERE g.id=NEW.return_inspection_line_id;
    IF NOT FOUND OR NEW.quantity_delta IS DISTINCT FROM source.quantity OR NEW.actor_id IS DISTINCT FROM source.actor_id
      OR NEW.actor_name_snapshot IS DISTINCT FROM source.actor_name OR NEW.recorded_at IS DISTINCT FROM source.recorded_at
      OR NEW.item_code_snapshot IS DISTINCT FROM source.item_code_snapshot OR NEW.item_name_snapshot IS DISTINCT FROM source.item_name_snapshot
      OR (source.condition='GOOD' AND NEW.return_review_id IS NOT NULL)
      OR (source.condition='NOTED' AND (source.issue_type='MISMATCH' OR source.decision IS DISTINCT FROM 'ACCEPT_TO_STOCK' OR NEW.return_review_id IS DISTINCT FROM source.review_id)) THEN
      RAISE EXCEPTION 'return movement does not match approved source' USING ERRCODE='23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported movement source' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
