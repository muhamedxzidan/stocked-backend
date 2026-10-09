BEGIN;
-- Drain existing ledger writers before backfilling location projections.
SELECT pg_advisory_xact_lock(847314,1);
LOCK TABLE inventory_balances, stock_movements, return_receipt_lines IN SHARE ROW EXCLUSIVE MODE;

-- CreateEnum
CREATE TYPE "stocktake_status" AS ENUM ('COUNTING', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "stocktake_kind" AS ENUM ('FULL', 'MERCHANT', 'ROW', 'SHELF');

-- AlterTable
ALTER TABLE "stock_adjustments" ADD COLUMN     "stocktake_line_id" UUID,
ALTER COLUMN "reference_movement_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "storage_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_shelves" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "row_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_shelves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_placement_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "shelf_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_placement_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_placement_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "shelf_id" UUID,
    "quantity_delta" INTEGER NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "movement_id" UUID,
    "transfer_id" UUID,
    "actor_id" UUID,
    "actor_name_snapshot" VARCHAR(150),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_placement_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_placement_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "from_shelf_id" UUID,
    "to_shelf_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_name_snapshot" VARCHAR(150) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,

    CONSTRAINT "stock_placement_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_custody_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_line_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "shelf_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "return_custody_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_custody_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_line_id" UUID NOT NULL,
    "shelf_id" UUID,
    "quantity_delta" INTEGER NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "movement_id" UUID,
    "transfer_key" UUID,
    "actor_id" UUID,
    "actor_name_snapshot" VARCHAR(150),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "return_custody_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktakes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "kind" "stocktake_kind" NOT NULL,
    "target_id" UUID,
    "status" "stocktake_status" NOT NULL DEFAULT 'COUNTING',
    "opened_by_id" UUID NOT NULL,
    "opened_by_name_snapshot" VARCHAR(150) NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "director_id" UUID NOT NULL,
    "director_name_snapshot" VARCHAR(150) NOT NULL,
    "notes" VARCHAR(2000) NOT NULL,
    "closed_by_id" UUID,
    "closed_by_name_snapshot" VARCHAR(150),
    "closed_at" TIMESTAMPTZ(3),
    "closing_notes" VARCHAR(2000),

    CONSTRAINT "stocktakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_scopes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stocktake_id" UUID NOT NULL,
    "shelf_id" UUID NOT NULL,
    "row_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "shelf_code_snapshot" VARCHAR(40) NOT NULL,
    "row_code_snapshot" VARCHAR(40) NOT NULL,
    "merchant_name_snapshot" VARCHAR(200) NOT NULL,

    CONSTRAINT "stocktake_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stocktake_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "shelf_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "receipt_line_id" UUID,
    "category" VARCHAR(12) NOT NULL,
    "item_code_snapshot" VARCHAR(40) NOT NULL,
    "item_name_snapshot" VARCHAR(200) NOT NULL,
    "expected_quantity" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stocktake_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_count_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" VARCHAR(2000),
    "notes" VARCHAR(2000),
    "actor_id" UUID NOT NULL,
    "actor_name_snapshot" VARCHAR(150) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stocktake_count_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stocktake_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_name_snapshot" VARCHAR(150) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "details" JSONB NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,

    CONSTRAINT "stocktake_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "storage_rows_warehouse_id_code_key" ON "storage_rows"("warehouse_id", "code");

-- CreateIndex
CREATE INDEX "storage_shelves_merchant_id_row_id_idx" ON "storage_shelves"("merchant_id", "row_id");

-- CreateIndex
CREATE UNIQUE INDEX "storage_shelves_warehouse_id_code_key" ON "storage_shelves"("warehouse_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "storage_shelves_id_warehouse_id_merchant_id_key" ON "storage_shelves"("id", "warehouse_id", "merchant_id");

-- CreateIndex
CREATE INDEX "stock_placement_balances_shelf_id_merchant_id_idx" ON "stock_placement_balances"("shelf_id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_placement_balances_warehouse_id_item_id_shelf_id_key" ON "stock_placement_balances"("warehouse_id", "item_id", "shelf_id");

-- CreateIndex
CREATE INDEX "stock_placement_entries_warehouse_id_item_id_shelf_id_idx" ON "stock_placement_entries"("warehouse_id", "item_id", "shelf_id");

-- CreateIndex
CREATE INDEX "stock_placement_entries_movement_id_idx" ON "stock_placement_entries"("movement_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_placement_transfers_idempotency_key_key" ON "stock_placement_transfers"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "return_custody_balances_receipt_line_id_shelf_id_key" ON "return_custody_balances"("receipt_line_id", "shelf_id");

-- CreateIndex
CREATE INDEX "return_custody_entries_receipt_line_id_shelf_id_idx" ON "return_custody_entries"("receipt_line_id", "shelf_id");

-- CreateIndex
CREATE INDEX "stocktakes_opened_at_id_idx" ON "stocktakes"("opened_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stocktake_scopes_stocktake_id_shelf_id_key" ON "stocktake_scopes"("stocktake_id", "shelf_id");

-- CreateIndex
CREATE INDEX "stocktake_lines_stocktake_id_merchant_id_shelf_id_idx" ON "stocktake_lines"("stocktake_id", "merchant_id", "shelf_id");

-- CreateIndex
CREATE UNIQUE INDEX "stocktake_count_entries_line_id_version_key" ON "stocktake_count_entries"("line_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "stocktake_events_idempotency_key_key" ON "stocktake_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "stocktake_events_stocktake_id_recorded_at_id_idx" ON "stocktake_events"("stocktake_id", "recorded_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_stocktake_line_id_key" ON "stock_adjustments"("stocktake_line_id");

-- Cross-scope constraints not representable by the scalar-only operational models.
ALTER TABLE storage_rows ADD CONSTRAINT storage_row_warehouse_fk FOREIGN KEY(warehouse_id) REFERENCES warehouses(id), ADD CONSTRAINT storage_row_actor_fk FOREIGN KEY(created_by_id) REFERENCES users(id), ADD CONSTRAINT storage_row_scope UNIQUE(id,warehouse_id);
ALTER TABLE storage_shelves ADD CONSTRAINT shelf_row_fk FOREIGN KEY(row_id,warehouse_id) REFERENCES storage_rows(id,warehouse_id), ADD CONSTRAINT shelf_merchant_fk FOREIGN KEY(merchant_id) REFERENCES merchants(id), ADD CONSTRAINT shelf_actor_fk FOREIGN KEY(created_by_id) REFERENCES users(id);
ALTER TABLE stock_placement_balances ADD CONSTRAINT placement_item_fk FOREIGN KEY(warehouse_id,item_id,merchant_id) REFERENCES inventory_balances(warehouse_id,item_id,merchant_id), ADD CONSTRAINT placement_shelf_fk FOREIGN KEY(shelf_id,warehouse_id,merchant_id) REFERENCES storage_shelves(id,warehouse_id,merchant_id);
CREATE UNIQUE INDEX placement_unassigned_key ON stock_placement_balances(warehouse_id,item_id) WHERE shelf_id IS NULL;
ALTER TABLE stock_placement_entries ADD CONSTRAINT placement_entry_item_fk FOREIGN KEY(item_id,merchant_id) REFERENCES items(id,merchant_id), ADD CONSTRAINT placement_entry_warehouse_fk FOREIGN KEY(warehouse_id) REFERENCES warehouses(id), ADD CONSTRAINT placement_entry_shelf_fk FOREIGN KEY(shelf_id,warehouse_id,merchant_id) REFERENCES storage_shelves(id,warehouse_id,merchant_id), ADD CONSTRAINT placement_entry_movement_fk FOREIGN KEY(movement_id,warehouse_id,merchant_id,item_id) REFERENCES stock_movements(id,warehouse_id,merchant_id,item_id), ADD CONSTRAINT placement_entry_actor_fk FOREIGN KEY(actor_id) REFERENCES users(id), ADD CONSTRAINT placement_entry_values CHECK(quantity_delta <> 0 AND kind IN ('BASELINE','MOVEMENT','TRANSFER'));
ALTER TABLE stock_placement_transfers ADD CONSTRAINT placement_transfer_item_fk FOREIGN KEY(item_id,merchant_id) REFERENCES items(id,merchant_id), ADD CONSTRAINT placement_transfer_warehouse_fk FOREIGN KEY(warehouse_id) REFERENCES warehouses(id), ADD CONSTRAINT placement_transfer_from_fk FOREIGN KEY(from_shelf_id,warehouse_id,merchant_id) REFERENCES storage_shelves(id,warehouse_id,merchant_id), ADD CONSTRAINT placement_transfer_to_fk FOREIGN KEY(to_shelf_id,warehouse_id,merchant_id) REFERENCES storage_shelves(id,warehouse_id,merchant_id), ADD CONSTRAINT placement_transfer_actor_fk FOREIGN KEY(actor_id) REFERENCES users(id), ADD CONSTRAINT placement_transfer_values CHECK(quantity BETWEEN 1 AND 2147483647 AND from_shelf_id IS DISTINCT FROM to_shelf_id AND length(btrim(reason)) BETWEEN 10 AND 2000);
ALTER TABLE stock_placement_entries ADD CONSTRAINT placement_entry_transfer_fk FOREIGN KEY(transfer_id) REFERENCES stock_placement_transfers(id);
ALTER TABLE return_receipt_lines ADD CONSTRAINT custody_source_scope UNIQUE(id,warehouse_id,merchant_id,item_id);
ALTER TABLE return_custody_balances ADD CONSTRAINT custody_source_fk FOREIGN KEY(receipt_line_id,warehouse_id,merchant_id,item_id) REFERENCES return_receipt_lines(id,warehouse_id,merchant_id,item_id), ADD CONSTRAINT custody_shelf_fk FOREIGN KEY(shelf_id,warehouse_id,merchant_id) REFERENCES storage_shelves(id,warehouse_id,merchant_id);
CREATE UNIQUE INDEX custody_unassigned_key ON return_custody_balances(receipt_line_id) WHERE shelf_id IS NULL;
ALTER TABLE return_custody_entries ADD CONSTRAINT custody_entry_source_fk FOREIGN KEY(receipt_line_id) REFERENCES return_receipt_lines(id), ADD CONSTRAINT custody_entry_shelf_fk FOREIGN KEY(shelf_id) REFERENCES storage_shelves(id), ADD CONSTRAINT custody_entry_actor_fk FOREIGN KEY(actor_id) REFERENCES users(id), ADD CONSTRAINT custody_entry_movement_fk FOREIGN KEY(movement_id) REFERENCES stock_movements(id), ADD CONSTRAINT custody_entry_values CHECK(quantity_delta <> 0 AND kind IN ('BASELINE','RECEIVE','RELEASE','TRANSFER'));
ALTER TABLE stocktakes ADD CONSTRAINT stocktake_warehouse_fk FOREIGN KEY(warehouse_id) REFERENCES warehouses(id), ADD CONSTRAINT stocktake_opener_fk FOREIGN KEY(opened_by_id) REFERENCES users(id), ADD CONSTRAINT stocktake_director_fk FOREIGN KEY(director_id) REFERENCES users(id), ADD CONSTRAINT stocktake_closer_fk FOREIGN KEY(closed_by_id) REFERENCES users(id), ADD CONSTRAINT stocktake_scope_values CHECK((kind='FULL' AND target_id IS NULL) OR (kind<>'FULL' AND target_id IS NOT NULL)), ADD CONSTRAINT stocktake_close_values CHECK((status IN ('COUNTING','PENDING_APPROVAL') AND closed_by_id IS NULL AND closed_at IS NULL AND closing_notes IS NULL) OR (status IN ('APPROVED','CANCELLED') AND closed_by_id IS NOT NULL AND closed_by_name_snapshot IS NOT NULL AND closed_at>=opened_at AND length(btrim(closing_notes)) BETWEEN 10 AND 2000));
CREATE UNIQUE INDEX one_active_stocktake ON stocktakes((1)) WHERE status IN ('COUNTING','PENDING_APPROVAL');
ALTER TABLE storage_shelves ADD CONSTRAINT shelf_merchant_scope UNIQUE(id,merchant_id);
ALTER TABLE stocktake_scopes ADD CONSTRAINT count_scope_cycle_fk FOREIGN KEY(stocktake_id) REFERENCES stocktakes(id), ADD CONSTRAINT count_scope_shelf_fk FOREIGN KEY(shelf_id,merchant_id) REFERENCES storage_shelves(id,merchant_id);
ALTER TABLE stocktake_lines ADD CONSTRAINT count_line_cycle_fk FOREIGN KEY(stocktake_id) REFERENCES stocktakes(id), ADD CONSTRAINT count_line_scope_fk FOREIGN KEY(stocktake_id,shelf_id) REFERENCES stocktake_scopes(stocktake_id,shelf_id), ADD CONSTRAINT count_line_shelf_fk FOREIGN KEY(shelf_id,warehouse_id,merchant_id) REFERENCES storage_shelves(id,warehouse_id,merchant_id), ADD CONSTRAINT count_line_item_fk FOREIGN KEY(item_id,merchant_id) REFERENCES items(id,merchant_id), ADD CONSTRAINT count_line_custody_fk FOREIGN KEY(receipt_line_id,warehouse_id,merchant_id,item_id) REFERENCES return_receipt_lines(id,warehouse_id,merchant_id,item_id), ADD CONSTRAINT count_line_values CHECK(expected_quantity >= 0 AND version >= 0 AND ((category='AVAILABLE' AND receipt_line_id IS NULL) OR (category='CUSTODY' AND receipt_line_id IS NOT NULL)));
CREATE UNIQUE INDEX count_available_line_key ON stocktake_lines(stocktake_id,shelf_id,item_id) WHERE category='AVAILABLE';
CREATE UNIQUE INDEX count_custody_line_key ON stocktake_lines(stocktake_id,shelf_id,receipt_line_id) WHERE category='CUSTODY';
ALTER TABLE stocktake_count_entries ADD CONSTRAINT count_entry_line_fk FOREIGN KEY(line_id) REFERENCES stocktake_lines(id), ADD CONSTRAINT count_entry_actor_fk FOREIGN KEY(actor_id) REFERENCES users(id), ADD CONSTRAINT count_entry_values CHECK(version>0 AND quantity>=0 AND (reason IS NULL OR length(btrim(reason)) BETWEEN 10 AND 2000));
ALTER TABLE stocktake_events ADD CONSTRAINT count_event_cycle_fk FOREIGN KEY(stocktake_id) REFERENCES stocktakes(id), ADD CONSTRAINT count_event_actor_fk FOREIGN KEY(actor_id) REFERENCES users(id);
ALTER TABLE stock_adjustments ADD CONSTRAINT adjustment_count_source_fk FOREIGN KEY(stocktake_line_id) REFERENCES stocktake_lines(id), ADD CONSTRAINT adjustment_source_exclusive CHECK((reference_movement_id IS NOT NULL AND stocktake_line_id IS NULL) OR (reference_movement_id IS NULL AND stocktake_line_id IS NOT NULL));
-- Counts may be larger than one receipt; SQL integer bounds still apply.
ALTER TABLE stock_adjustments DROP CONSTRAINT stock_adjustments_values_check;
ALTER TABLE stock_adjustments ADD CONSTRAINT stock_adjustments_values_check CHECK(quantity>0 AND length(btrim(reason)) BETWEEN 10 AND 2000 AND ((direction='IN' AND quantity_delta=quantity) OR (direction='OUT' AND quantity_delta=-quantity)));

-- Preserve prior stock and custody in an explicit unassigned pool, without new stock movements.
INSERT INTO stock_placement_entries(id,warehouse_id,merchant_id,item_id,shelf_id,quantity_delta,kind,recorded_at)
SELECT gen_random_uuid(),warehouse_id,merchant_id,item_id,NULL,quantity,'BASELINE',updated_at FROM inventory_balances WHERE quantity>0;
INSERT INTO stock_placement_balances(id,warehouse_id,merchant_id,item_id,shelf_id,quantity,updated_at)
SELECT gen_random_uuid(),warehouse_id,merchant_id,item_id,NULL,quantity,updated_at FROM inventory_balances;
INSERT INTO return_custody_entries(id,receipt_line_id,shelf_id,quantity_delta,kind,recorded_at)
SELECT gen_random_uuid(),l.id,NULL,l.quantity-COALESCE((SELECT SUM(m.quantity_delta) FROM stock_movements m JOIN return_inspection_lines g ON g.id=m.return_inspection_line_id WHERE g.receipt_line_id=l.id),0),'BASELINE',r.received_at
FROM return_receipt_lines l JOIN return_receipts r ON r.id=l.receipt_id
WHERE l.quantity>COALESCE((SELECT SUM(m.quantity_delta) FROM stock_movements m JOIN return_inspection_lines g ON g.id=m.return_inspection_line_id WHERE g.receipt_line_id=l.id),0);
INSERT INTO return_custody_balances(id,receipt_line_id,warehouse_id,merchant_id,item_id,shelf_id,quantity,updated_at)
SELECT gen_random_uuid(),l.id,l.warehouse_id,l.merchant_id,l.item_id,NULL,e.quantity_delta,e.recorded_at FROM return_custody_entries e JOIN return_receipt_lines l ON l.id=e.receipt_line_id;

CREATE FUNCTION apply_placement_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE movement stock_movements; transfer stock_placement_transfers;
BEGIN
 IF NEW.kind='BASELINE' THEN RAISE EXCEPTION 'baseline entries are migration-only' USING ERRCODE='23514'; END IF;
 IF NEW.kind='MOVEMENT' THEN
  SELECT * INTO movement FROM stock_movements WHERE id=NEW.movement_id;
  IF movement IS NULL OR NEW.transfer_id IS NOT NULL OR NEW.actor_id IS DISTINCT FROM movement.actor_id OR NEW.actor_name_snapshot IS DISTINCT FROM movement.actor_name_snapshot OR NEW.recorded_at<>movement.recorded_at THEN RAISE EXCEPTION 'placement movement source mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO transfer FROM stock_placement_transfers WHERE id=NEW.transfer_id;
  IF transfer IS NULL OR NEW.movement_id IS NOT NULL OR NEW.warehouse_id<>transfer.warehouse_id OR NEW.merchant_id<>transfer.merchant_id OR NEW.item_id<>transfer.item_id OR NEW.actor_id IS DISTINCT FROM transfer.actor_id OR NEW.actor_name_snapshot IS DISTINCT FROM transfer.actor_name_snapshot OR NEW.recorded_at<>transfer.recorded_at OR NOT ((NEW.shelf_id IS NOT DISTINCT FROM transfer.from_shelf_id AND NEW.quantity_delta=-transfer.quantity) OR (NEW.shelf_id=transfer.to_shelf_id AND NEW.quantity_delta=transfer.quantity)) THEN RAISE EXCEPTION 'placement transfer source mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO stock_placement_balances(id,warehouse_id,merchant_id,item_id,shelf_id,quantity,updated_at)
 VALUES(gen_random_uuid(),NEW.warehouse_id,NEW.merchant_id,NEW.item_id,NEW.shelf_id,NEW.quantity_delta,NEW.recorded_at)
 ON CONFLICT DO NOTHING;
 -- If this INSERT created the row, its quantity already includes this entry.
 IF NOT FOUND THEN
  UPDATE stock_placement_balances SET quantity=quantity+NEW.quantity_delta,updated_at=NEW.recorded_at WHERE warehouse_id=NEW.warehouse_id AND item_id=NEW.item_id AND shelf_id IS NOT DISTINCT FROM NEW.shelf_id;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER placement_apply AFTER INSERT ON stock_placement_entries FOR EACH ROW EXECUTE FUNCTION apply_placement_entry();

CREATE FUNCTION initialize_movement_placement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO stock_placement_entries(id,warehouse_id,merchant_id,item_id,shelf_id,quantity_delta,kind,movement_id,actor_id,actor_name_snapshot,recorded_at)
 VALUES(gen_random_uuid(),NEW.warehouse_id,NEW.merchant_id,NEW.item_id,NULL,NEW.quantity_delta,'MOVEMENT',NEW.id,NEW.actor_id,NEW.actor_name_snapshot,NEW.recorded_at);
 RETURN NEW;
END; $$;
CREATE TRIGGER movement_placement AFTER INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION initialize_movement_placement();

CREATE FUNCTION check_placement_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wid uuid; iid uuid; total bigint; placed bigint; balance integer; mid uuid;
BEGIN
 wid=NEW.warehouse_id; iid=NEW.item_id;
 SELECT quantity INTO balance FROM inventory_balances WHERE warehouse_id=wid AND item_id=iid;
 SELECT COALESCE(SUM(quantity),0) INTO placed FROM stock_placement_balances WHERE warehouse_id=wid AND item_id=iid;
 IF balance IS NULL OR balance::bigint<>placed OR EXISTS(SELECT 1 FROM stock_placement_balances b WHERE b.warehouse_id=wid AND b.item_id=iid AND (b.quantity<0 OR b.quantity::bigint<>(SELECT COALESCE(SUM(e.quantity_delta),0) FROM stock_placement_entries e WHERE e.warehouse_id=wid AND e.item_id=iid AND e.shelf_id IS NOT DISTINCT FROM b.shelf_id))) THEN RAISE EXCEPTION 'placement ledger, balances and total must match' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='stock_placement_entries' THEN
  mid=NEW.movement_id;
  IF mid IS NOT NULL THEN
   SELECT COALESCE(SUM(quantity_delta),0) INTO total FROM stock_placement_entries WHERE movement_id=mid;
   IF total<>(SELECT quantity_delta FROM stock_movements WHERE id=mid) THEN RAISE EXCEPTION 'movement placement sum mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER placement_projection AFTER INSERT OR UPDATE ON stock_placement_balances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_placement_projection();
CREATE CONSTRAINT TRIGGER placement_entry_projection AFTER INSERT ON stock_placement_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_placement_projection();
CREATE CONSTRAINT TRIGGER total_placement_projection AFTER INSERT OR UPDATE ON inventory_balances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_placement_projection();
CREATE FUNCTION check_placement_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT COUNT(*) FROM stock_placement_entries WHERE transfer_id=NEW.id)<>2 OR (SELECT SUM(quantity_delta) FROM stock_placement_entries WHERE transfer_id=NEW.id)<>0 THEN RAISE EXCEPTION 'transfer must have two balanced entries' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER placement_transfer_projection AFTER INSERT ON stock_placement_transfers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_placement_transfer();

CREATE FUNCTION apply_custody_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source return_receipt_lines; movement stock_movements; receipt return_receipts;
BEGIN
 SELECT * INTO source FROM return_receipt_lines WHERE id=NEW.receipt_line_id;
 SELECT * INTO receipt FROM return_receipts WHERE id=source.receipt_id;
 IF NEW.kind='BASELINE' THEN RAISE EXCEPTION 'custody baseline is migration-only' USING ERRCODE='23514'; END IF;
 IF NEW.shelf_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM storage_shelves WHERE id=NEW.shelf_id AND warehouse_id=source.warehouse_id AND merchant_id=source.merchant_id) THEN RAISE EXCEPTION 'custody shelf ownership mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.kind='RECEIVE' THEN
  IF NEW.movement_id IS NOT NULL OR NEW.transfer_key IS NOT NULL OR NEW.actor_id IS DISTINCT FROM receipt.received_by_id OR NEW.actor_name_snapshot IS DISTINCT FROM receipt.received_by_name_snapshot OR NEW.recorded_at<>receipt.received_at THEN RAISE EXCEPTION 'custody receipt source mismatch' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='RELEASE' THEN
  SELECT * INTO movement FROM stock_movements WHERE id=NEW.movement_id;
  IF movement.kind IS DISTINCT FROM 'RETURN_IN' OR NOT EXISTS(SELECT 1 FROM return_inspection_lines WHERE id=movement.return_inspection_line_id AND receipt_line_id=NEW.receipt_line_id) OR NEW.actor_id IS DISTINCT FROM movement.actor_id OR NEW.actor_name_snapshot IS DISTINCT FROM movement.actor_name_snapshot OR NEW.recorded_at<>movement.recorded_at OR NEW.transfer_key IS NOT NULL THEN RAISE EXCEPTION 'custody restock source mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.transfer_key IS NULL OR NEW.movement_id IS NOT NULL OR NEW.actor_id IS NULL THEN RAISE EXCEPTION 'custody transfer requires audit identity' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO return_custody_balances(id,receipt_line_id,warehouse_id,merchant_id,item_id,shelf_id,quantity,updated_at)
 VALUES(gen_random_uuid(),source.id,source.warehouse_id,source.merchant_id,source.item_id,NEW.shelf_id,NEW.quantity_delta,NEW.recorded_at) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN UPDATE return_custody_balances SET quantity=quantity+NEW.quantity_delta,updated_at=NEW.recorded_at WHERE receipt_line_id=source.id AND shelf_id IS NOT DISTINCT FROM NEW.shelf_id; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER custody_apply AFTER INSERT ON return_custody_entries FOR EACH ROW EXECUTE FUNCTION apply_custody_entry();
CREATE FUNCTION initialize_return_custody() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt return_receipts;
BEGIN
 SELECT * INTO receipt FROM return_receipts WHERE id=NEW.receipt_id;
 INSERT INTO return_custody_entries(id,receipt_line_id,shelf_id,quantity_delta,kind,actor_id,actor_name_snapshot,recorded_at) VALUES(gen_random_uuid(),NEW.id,NULL,NEW.quantity,'RECEIVE',receipt.received_by_id,receipt.received_by_name_snapshot,receipt.received_at);
 RETURN NEW;
END; $$;
CREATE TRIGGER return_custody_receive AFTER INSERT ON return_receipt_lines FOR EACH ROW EXECUTE FUNCTION initialize_return_custody();
CREATE FUNCTION initialize_return_custody_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source uuid;
BEGIN
 IF NEW.kind='RETURN_IN' THEN
  SELECT receipt_line_id INTO source FROM return_inspection_lines WHERE id=NEW.return_inspection_line_id;
  INSERT INTO return_custody_entries(id,receipt_line_id,shelf_id,quantity_delta,kind,movement_id,actor_id,actor_name_snapshot,recorded_at) VALUES(gen_random_uuid(),source,NULL,-NEW.quantity_delta,'RELEASE',NEW.id,NEW.actor_id,NEW.actor_name_snapshot,NEW.recorded_at);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER return_custody_release AFTER INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION initialize_return_custody_release();
CREATE FUNCTION check_custody_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid; expected bigint; actual bigint; mid uuid; tid uuid;
BEGIN
 rid=NEW.receipt_line_id;
 SELECT l.quantity-COALESCE((SELECT SUM(m.quantity_delta) FROM stock_movements m JOIN return_inspection_lines g ON g.id=m.return_inspection_line_id WHERE g.receipt_line_id=l.id),0) INTO expected FROM return_receipt_lines l WHERE l.id=rid;
 SELECT COALESCE(SUM(quantity),0) INTO actual FROM return_custody_balances WHERE receipt_line_id=rid;
 IF expected<>actual OR EXISTS(SELECT 1 FROM return_custody_balances b WHERE b.receipt_line_id=rid AND (b.quantity<0 OR b.quantity::bigint<>(SELECT COALESCE(SUM(e.quantity_delta),0) FROM return_custody_entries e WHERE e.receipt_line_id=rid AND e.shelf_id IS NOT DISTINCT FROM b.shelf_id))) THEN RAISE EXCEPTION 'custody projection mismatch' USING ERRCODE='23514'; END IF;
 FOR mid IN SELECT DISTINCT movement_id FROM return_custody_entries WHERE receipt_line_id=rid AND movement_id IS NOT NULL LOOP
  IF (SELECT SUM(quantity_delta) FROM return_custody_entries WHERE movement_id=mid) IS DISTINCT FROM -(SELECT quantity_delta::bigint FROM stock_movements WHERE id=mid) THEN RAISE EXCEPTION 'custody release sum mismatch' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR tid IN SELECT DISTINCT transfer_key FROM return_custody_entries WHERE receipt_line_id=rid AND transfer_key IS NOT NULL LOOP
  IF (SELECT COUNT(*) FROM return_custody_entries WHERE transfer_key=tid)<>2 OR (SELECT SUM(quantity_delta) FROM return_custody_entries WHERE transfer_key=tid)<>0 OR (SELECT COUNT(DISTINCT receipt_line_id) FROM return_custody_entries WHERE transfer_key=tid)<>1 THEN RAISE EXCEPTION 'custody transfer must balance within its source' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER custody_projection AFTER INSERT OR UPDATE ON return_custody_balances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_custody_projection();
CREATE CONSTRAINT TRIGGER custody_entry_projection AFTER INSERT ON return_custody_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_custody_projection();

CREATE OR REPLACE FUNCTION validate_adjustment_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source RECORD; counted stocktake_count_entries;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.performed_by_id AND role='ADMIN' AND is_active) THEN RAISE EXCEPTION 'adjustments are administrator-only' USING ERRCODE='23514'; END IF;
 IF NEW.stocktake_line_id IS NULL THEN
  SELECT kind,warehouse_id,merchant_id,item_id INTO source FROM stock_movements WHERE id=NEW.reference_movement_id;
  IF source.kind IS DISTINCT FROM 'RECEIPT_IN' OR source.warehouse_id<>NEW.warehouse_id OR source.merchant_id<>NEW.merchant_id OR source.item_id<>NEW.item_id THEN RAISE EXCEPTION 'manual adjustment requires receipt movement' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT l.*,s.status INTO source FROM stocktake_lines l JOIN stocktakes s ON s.id=l.stocktake_id WHERE l.id=NEW.stocktake_line_id;
  SELECT * INTO counted FROM stocktake_count_entries WHERE line_id=NEW.stocktake_line_id ORDER BY version DESC LIMIT 1;
  IF source IS NULL OR counted IS NULL OR source.category<>'AVAILABLE' OR source.status<>'PENDING_APPROVAL' OR source.warehouse_id<>NEW.warehouse_id OR source.merchant_id<>NEW.merchant_id OR source.item_id<>NEW.item_id OR NEW.quantity_delta<>counted.quantity-source.expected_quantity OR NEW.reason IS DISTINCT FROM counted.reason OR NEW.item_code_snapshot<>source.item_code_snapshot OR NEW.item_name_snapshot<>source.item_name_snapshot THEN RAISE EXCEPTION 'stocktake adjustment source mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;

-- Historic documents are immutable. Only state/version projections have narrowly permitted updates.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['stock_placement_entries','stock_placement_transfers','return_custody_entries','stocktake_scopes','stocktake_count_entries','stocktake_events'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation()',t||'_immutable',t);
 END LOOP;
END; $$;
CREATE FUNCTION protect_stocktake_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'stocktake lines cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'version')<>(to_jsonb(OLD)-'version') OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'only count revision can advance' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM stocktakes WHERE id=NEW.stocktake_id AND status='COUNTING') THEN RAISE EXCEPTION 'counting is closed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER stocktake_line_protection BEFORE INSERT OR UPDATE OR DELETE ON stocktake_lines FOR EACH ROW EXECUTE FUNCTION protect_stocktake_line();
CREATE FUNCTION protect_count_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source RECORD;
BEGIN
 SELECT l.*,s.status INTO source FROM stocktake_lines l JOIN stocktakes s ON s.id=l.stocktake_id WHERE l.id=NEW.line_id;
 IF source.status IS DISTINCT FROM 'COUNTING' OR NEW.version<>source.version OR (NEW.quantity<>source.expected_quantity AND length(btrim(COALESCE(NEW.reason,'')))<10) THEN RAISE EXCEPTION 'count revision or difference reason invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER count_entry_protection BEFORE INSERT ON stocktake_count_entries FOR EACH ROW EXECUTE FUNCTION protect_count_entry();
CREATE FUNCTION protect_stocktake() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'stocktakes cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status IN ('APPROVED','CANCELLED') OR (to_jsonb(NEW)-ARRAY['status','closed_by_id','closed_by_name_snapshot','closed_at','closing_notes'])<>(to_jsonb(OLD)-ARRAY['status','closed_by_id','closed_by_name_snapshot','closed_at','closing_notes']) THEN RAISE EXCEPTION 'stocktake history is immutable' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='COUNTING' AND NEW.status IN ('PENDING_APPROVAL','CANCELLED')) OR (OLD.status='PENDING_APPROVAL' AND NEW.status IN ('COUNTING','APPROVED','CANCELLED'))) THEN RAISE EXCEPTION 'invalid stocktake transition' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('APPROVED','CANCELLED') AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.closed_by_id AND role='ADMIN' AND is_active) THEN RAISE EXCEPTION 'only administrator closes stocktake' USING ERRCODE='23514'; END IF;
  IF NEW.status='APPROVED' AND (EXISTS(SELECT 1 FROM stocktake_lines WHERE stocktake_id=NEW.id AND version=0) OR EXISTS(SELECT 1 FROM stocktake_lines l JOIN stocktake_count_entries c ON c.line_id=l.id AND c.version=l.version LEFT JOIN stock_adjustments a ON a.stocktake_line_id=l.id WHERE l.stocktake_id=NEW.id AND l.category='AVAILABLE' AND ((c.quantity<>l.expected_quantity AND a.id IS NULL) OR (c.quantity=l.expected_quantity AND a.id IS NOT NULL)))) THEN RAISE EXCEPTION 'approval must post every available difference' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER stocktake_protection BEFORE UPDATE OR DELETE ON stocktakes FOR EACH ROW EXECUTE FUNCTION protect_stocktake();

CREATE FUNCTION enforce_operational_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active uuid; permitted text;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(847314,1);
 SELECT id INTO active FROM stocktakes WHERE status IN ('COUNTING','PENDING_APPROVAL');
 IF active IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
 -- Self-service authentication is the explicit exception; identity administration remains blocked.
 IF TG_TABLE_NAME='users' AND TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['password_hash','must_change_password','updated_at'])=(to_jsonb(OLD)-ARRAY['password_hash','must_change_password','updated_at']) THEN RETURN NEW; END IF;
 permitted=current_setting('stocked.stocktake_approval',true);
 IF permitted=active::text AND TG_OP<>'DELETE' THEN
  IF TG_TABLE_NAME='stock_adjustments' THEN
   IF EXISTS(SELECT 1 FROM stocktake_lines WHERE id=NEW.stocktake_line_id AND stocktake_id=active AND category='AVAILABLE') THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='stock_movements' THEN
   IF EXISTS(SELECT 1 FROM stock_adjustments a JOIN stocktake_lines l ON l.id=a.stocktake_line_id WHERE a.id=NEW.adjustment_id AND l.stocktake_id=active) THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='stock_placement_entries' THEN
   IF NEW.kind='MOVEMENT' AND EXISTS(SELECT 1 FROM stock_movements m JOIN stock_adjustments a ON a.id=m.adjustment_id JOIN stocktake_lines l ON l.id=a.stocktake_line_id WHERE m.id=NEW.movement_id AND l.stocktake_id=active) THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME IN ('inventory_balances','stock_placement_balances') THEN
   IF EXISTS(SELECT 1 FROM stocktake_lines WHERE stocktake_id=active AND warehouse_id=NEW.warehouse_id AND merchant_id=NEW.merchant_id AND item_id=NEW.item_id AND category='AVAILABLE') THEN RETURN NEW; END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'business modifications paused during stocktake' USING ERRCODE='23514';
END; $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['users','merchants','items','item_code_sequences','receipts','receipt_lines','stock_adjustments','stock_movements','inventory_balances','shipments','shipment_lines','shipment_code_sequences','shipment_preparations','shipment_dispatches','return_receipts','return_receipt_lines','return_inspections','return_inspection_lines','return_reviews','storage_rows','storage_shelves','stock_placement_entries','stock_placement_balances','stock_placement_transfers','return_custody_entries','return_custody_balances'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_operational_gate()',t||'_stocktake_gate',t);
 END LOOP;
END; $$;
ALTER TABLE stock_placement_balances ALTER CONSTRAINT placement_item_fk DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE return_custody_transfers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),receipt_line_id uuid NOT NULL REFERENCES return_receipt_lines(id),from_shelf_id uuid REFERENCES storage_shelves(id),to_shelf_id uuid NOT NULL REFERENCES storage_shelves(id),quantity integer NOT NULL CHECK(quantity>0),reason varchar(2000) NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),actor_id uuid NOT NULL REFERENCES users(id),actor_name_snapshot varchar(150) NOT NULL,recorded_at timestamptz(3) NOT NULL,idempotency_key uuid NOT NULL UNIQUE,request_hash char(64) NOT NULL,CHECK(from_shelf_id IS DISTINCT FROM to_shelf_id));
ALTER TABLE return_custody_entries ADD CONSTRAINT custody_transfer_fk FOREIGN KEY(transfer_key) REFERENCES return_custody_transfers(id);
CREATE TRIGGER custody_transfer_immutable BEFORE UPDATE OR DELETE ON return_custody_transfers FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation();
CREATE TRIGGER custody_transfer_gate BEFORE INSERT OR UPDATE OR DELETE ON return_custody_transfers FOR EACH ROW EXECUTE FUNCTION enforce_operational_gate();
CREATE FUNCTION check_custody_transfer_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t return_custody_transfers;
BEGIN
 IF NEW.kind='TRANSFER' THEN
  SELECT * INTO t FROM return_custody_transfers WHERE id=NEW.transfer_key;
  IF t IS NULL OR NEW.receipt_line_id<>t.receipt_line_id OR NEW.actor_id IS DISTINCT FROM t.actor_id OR NEW.actor_name_snapshot IS DISTINCT FROM t.actor_name_snapshot OR NEW.recorded_at<>t.recorded_at OR NOT ((NEW.shelf_id IS NOT DISTINCT FROM t.from_shelf_id AND NEW.quantity_delta=-t.quantity) OR (NEW.shelf_id=t.to_shelf_id AND NEW.quantity_delta=t.quantity)) THEN RAISE EXCEPTION 'custody transfer source mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER custody_transfer_source BEFORE INSERT ON return_custody_entries FOR EACH ROW EXECUTE FUNCTION check_custody_transfer_source();
CREATE FUNCTION check_custody_transfer_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT COUNT(*) FROM return_custody_entries WHERE transfer_key=NEW.id)<>2 THEN RAISE EXCEPTION 'custody transfer incomplete' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER custody_transfer_complete AFTER INSERT ON return_custody_transfers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_custody_transfer_complete();
ALTER TABLE stocktake_events ADD COLUMN sequence integer NOT NULL;
CREATE UNIQUE INDEX stocktake_events_stocktake_id_sequence_key ON stocktake_events(stocktake_id,sequence);
ALTER TABLE stocktake_events ADD CONSTRAINT event_sequence_positive CHECK(sequence>0);
CREATE FUNCTION protect_stocktake_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cycle stocktakes;
BEGIN
 SELECT * INTO cycle FROM stocktakes WHERE id=NEW.stocktake_id;
 IF cycle.status IN ('APPROVED','CANCELLED') AND NOT ((NEW.kind='APPROVED' AND cycle.status='APPROVED') OR (NEW.kind='CANCELLED' AND cycle.status='CANCELLED')) THEN RAISE EXCEPTION 'closed stocktake does not accept events' USING ERRCODE='23514'; END IF;
 IF cycle.status IN ('APPROVED','CANCELLED') AND (NEW.actor_id<>cycle.closed_by_id OR EXISTS(SELECT 1 FROM stocktake_events WHERE stocktake_id=cycle.id AND kind=NEW.kind)) THEN RAISE EXCEPTION 'closing event must match administrator' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER stocktake_event_protection BEFORE INSERT ON stocktake_events FOR EACH ROW EXECUTE FUNCTION protect_stocktake_event();
CREATE FUNCTION check_stocktake_adjustment_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cycle stocktakes;
BEGIN
 IF NEW.stocktake_line_id IS NOT NULL THEN
  SELECT s.* INTO cycle FROM stocktakes s JOIN stocktake_lines l ON l.stocktake_id=s.id WHERE l.id=NEW.stocktake_line_id;
  IF cycle.status<>'APPROVED' OR NEW.performed_by_id<>cycle.closed_by_id OR NEW.performed_by_name_snapshot<>cycle.closed_by_name_snapshot OR NEW.recorded_at<>cycle.closed_at THEN RAISE EXCEPTION 'stocktake settlement must commit with approval identity and time' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER stocktake_adjustment_commit AFTER INSERT ON stock_adjustments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_stocktake_adjustment_commit();
CREATE FUNCTION protect_placement_projection_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['quantity','updated_at'])<>(to_jsonb(OLD)-ARRAY['quantity','updated_at']) THEN RAISE EXCEPTION 'placement projection identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER placement_balance_identity BEFORE UPDATE OR DELETE ON stock_placement_balances FOR EACH ROW EXECUTE FUNCTION protect_placement_projection_identity();
CREATE TRIGGER custody_balance_identity BEFORE UPDATE OR DELETE ON return_custody_balances FOR EACH ROW EXECUTE FUNCTION protect_placement_projection_identity();
CREATE FUNCTION protect_storage_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['name','is_active'])<>(to_jsonb(OLD)-ARRAY['name','is_active']) THEN RAISE EXCEPTION 'storage location identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER storage_row_identity BEFORE UPDATE OR DELETE ON storage_rows FOR EACH ROW EXECUTE FUNCTION protect_storage_identity();
CREATE TRIGGER storage_shelf_identity BEFORE UPDATE OR DELETE ON storage_shelves FOR EACH ROW EXECUTE FUNCTION protect_storage_identity();
CREATE FUNCTION require_new_placement_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_xid text;
BEGIN
 IF NEW.kind='MOVEMENT' THEN SELECT xmin::text INTO source_xid FROM stock_movements WHERE id=NEW.movement_id;
 ELSIF NEW.kind='TRANSFER' THEN SELECT xmin::text INTO source_xid FROM stock_placement_transfers WHERE id=NEW.transfer_id;
 ELSE RAISE EXCEPTION 'baseline cannot be added after migration' USING ERRCODE='23514'; END IF;
 IF source_xid IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'committed placement source cannot receive more entries' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER placement_new_source BEFORE INSERT ON stock_placement_entries FOR EACH ROW EXECUTE FUNCTION require_new_placement_source();
CREATE FUNCTION require_new_custody_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_xid text;
BEGIN
 IF NEW.kind='RECEIVE' THEN SELECT xmin::text INTO source_xid FROM return_receipt_lines WHERE id=NEW.receipt_line_id;
 ELSIF NEW.kind='RELEASE' THEN SELECT xmin::text INTO source_xid FROM stock_movements WHERE id=NEW.movement_id;
 ELSIF NEW.kind='TRANSFER' THEN SELECT xmin::text INTO source_xid FROM return_custody_transfers WHERE id=NEW.transfer_key;
 ELSE RAISE EXCEPTION 'custody baseline cannot be added' USING ERRCODE='23514'; END IF;
 IF source_xid IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'committed custody source cannot receive more entries' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER custody_new_source BEFORE INSERT ON return_custody_entries FOR EACH ROW EXECUTE FUNCTION require_new_custody_source();
CREATE FUNCTION check_stocktake_closure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='APPROVED' THEN
  IF EXISTS(SELECT 1 FROM stocktake_lines l JOIN stocktake_count_entries c ON c.line_id=l.id AND c.version=l.version LEFT JOIN stock_placement_balances b ON b.warehouse_id=l.warehouse_id AND b.item_id=l.item_id AND b.shelf_id=l.shelf_id LEFT JOIN stock_adjustments a ON a.stocktake_line_id=l.id LEFT JOIN stock_movements m ON m.adjustment_id=a.id WHERE l.stocktake_id=NEW.id AND l.category='AVAILABLE' AND (COALESCE(b.quantity,0)<>c.quantity OR (c.quantity<>l.expected_quantity AND m.id IS NULL))) THEN RAISE EXCEPTION 'approval must settle counted shelves and ledger' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status IN ('APPROVED','CANCELLED') AND NOT EXISTS(SELECT 1 FROM stocktake_events WHERE stocktake_id=NEW.id AND kind=NEW.status::text AND actor_id=NEW.closed_by_id AND actor_name_snapshot=NEW.closed_by_name_snapshot AND recorded_at>=NEW.closed_at) THEN RAISE EXCEPTION 'closing audit event is required' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER stocktake_closure_complete AFTER UPDATE ON stocktakes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_stocktake_closure();

CREATE FUNCTION validate_stocktake_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shelf storage_shelves; row storage_rows; merchant merchants; cycle stocktakes;
BEGIN
 SELECT * INTO shelf FROM storage_shelves WHERE id=NEW.shelf_id;
 SELECT * INTO row FROM storage_rows WHERE id=shelf.row_id;
 SELECT * INTO merchant FROM merchants WHERE id=shelf.merchant_id;
 SELECT * INTO cycle FROM stocktakes WHERE id=NEW.stocktake_id;
 IF cycle.status<>'COUNTING' OR shelf.warehouse_id<>cycle.warehouse_id OR NEW.row_id<>shelf.row_id OR NEW.merchant_id<>shelf.merchant_id OR NEW.shelf_code_snapshot<>shelf.code OR NEW.row_code_snapshot<>row.code OR NEW.merchant_name_snapshot<>merchant.name OR (cycle.kind='MERCHANT' AND shelf.merchant_id<>cycle.target_id) OR (cycle.kind='ROW' AND shelf.row_id<>cycle.target_id) OR (cycle.kind='SHELF' AND shelf.id<>cycle.target_id) THEN RAISE EXCEPTION 'stocktake scope snapshot mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER stocktake_scope_validation BEFORE INSERT ON stocktake_scopes FOR EACH ROW EXECUTE FUNCTION validate_stocktake_scope();
CREATE FUNCTION validate_count_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected integer; item items; cycle stocktakes;
BEGIN
 SELECT * INTO item FROM items WHERE id=NEW.item_id;
 SELECT * INTO cycle FROM stocktakes WHERE id=NEW.stocktake_id;
 IF NEW.category='AVAILABLE' THEN SELECT quantity INTO expected FROM stock_placement_balances WHERE warehouse_id=NEW.warehouse_id AND item_id=NEW.item_id AND shelf_id=NEW.shelf_id;
 ELSE SELECT quantity INTO expected FROM return_custody_balances WHERE receipt_line_id=NEW.receipt_line_id AND shelf_id=NEW.shelf_id; END IF;
 IF NEW.warehouse_id<>cycle.warehouse_id OR NEW.item_code_snapshot<>item.code OR NEW.item_name_snapshot<>item.name OR NEW.expected_quantity<>COALESCE(expected,0) OR NEW.version<>0 THEN RAISE EXCEPTION 'count snapshot must match frozen source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER stocktake_count_snapshot BEFORE INSERT ON stocktake_lines FOR EACH ROW EXECUTE FUNCTION validate_count_snapshot();
CREATE FUNCTION validate_stocktake_opening() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(847314,1);
 IF NEW.status<>'COUNTING' OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.director_id AND role='ADMIN' AND is_active AND display_name=NEW.director_name_snapshot) OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.opened_by_id AND role IN ('ADMIN','WAREHOUSE_KEEPER') AND is_active AND display_name=NEW.opened_by_name_snapshot) OR EXISTS(SELECT 1 FROM stock_placement_balances WHERE shelf_id IS NULL AND quantity>0) OR EXISTS(SELECT 1 FROM return_custody_balances WHERE shelf_id IS NULL AND quantity>0) THEN RAISE EXCEPTION 'invalid stocktake opening' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER stocktake_opening_validation BEFORE INSERT ON stocktakes FOR EACH ROW EXECUTE FUNCTION validate_stocktake_opening();

CREATE FUNCTION check_count_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_version integer;
BEGIN
 SELECT version INTO current_version FROM stocktake_lines WHERE id=NEW.id;
 IF current_version>0 AND NOT EXISTS(SELECT 1 FROM stocktake_count_entries WHERE line_id=NEW.id AND version=current_version) THEN RAISE EXCEPTION 'count revision must have immutable count entry' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER count_revision_complete AFTER INSERT OR UPDATE ON stocktake_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_count_revision();
CREATE FUNCTION check_stocktake_initial_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM stocktake_events WHERE stocktake_id=NEW.id AND kind='OPENED' AND actor_id=NEW.opened_by_id AND actor_name_snapshot=NEW.opened_by_name_snapshot) OR (SELECT COUNT(*) FROM stocktake_scopes WHERE stocktake_id=NEW.id) IS DISTINCT FROM (SELECT COUNT(*) FROM storage_shelves WHERE warehouse_id=NEW.warehouse_id AND (NEW.kind='FULL' OR (NEW.kind='MERCHANT' AND merchant_id=NEW.target_id) OR (NEW.kind='ROW' AND row_id=NEW.target_id) OR (NEW.kind='SHELF' AND id=NEW.target_id))) OR NOT EXISTS(SELECT 1 FROM stocktake_scopes WHERE stocktake_id=NEW.id) THEN RAISE EXCEPTION 'opening must freeze complete scope and audit event' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM stock_placement_balances b JOIN stocktake_scopes s ON s.shelf_id=b.shelf_id AND s.stocktake_id=NEW.id WHERE NOT EXISTS(SELECT 1 FROM stocktake_lines l WHERE l.stocktake_id=NEW.id AND l.shelf_id=b.shelf_id AND l.item_id=b.item_id AND l.category='AVAILABLE')) OR EXISTS(SELECT 1 FROM return_custody_balances b JOIN stocktake_scopes s ON s.shelf_id=b.shelf_id AND s.stocktake_id=NEW.id WHERE b.quantity>0 AND NOT EXISTS(SELECT 1 FROM stocktake_lines l WHERE l.stocktake_id=NEW.id AND l.shelf_id=b.shelf_id AND l.receipt_line_id=b.receipt_line_id AND l.category='CUSTODY')) THEN RAISE EXCEPTION 'opening must snapshot stock and custody independently' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER stocktake_open_complete AFTER INSERT ON stocktakes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_stocktake_initial_scope();

COMMIT;
