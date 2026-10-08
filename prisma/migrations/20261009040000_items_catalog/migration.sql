CREATE TABLE "item_code_sequences" (
  "merchant_id" UUID PRIMARY KEY,
  "last_value" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "item_code_sequences_merchant_id_fkey" FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "item_code_sequences_nonnegative_check" CHECK (last_value >= 0)
);
CREATE TABLE "items" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "merchant_id" UUID NOT NULL,
  "ordinal" BIGINT NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "brand" VARCHAR(100),
  "color" VARCHAR(100),
  "weight_kg" DECIMAL(12,3) NOT NULL,
  "notes" VARCHAR(2000),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "items_merchant_id_fkey" FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "items_created_by_id_fkey" FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "items_ordinal_positive_check" CHECK (ordinal > 0),
  CONSTRAINT "items_name_nonempty_check" CHECK (btrim(name) <> ''),
  CONSTRAINT "items_brand_nonempty_check" CHECK (brand IS NULL OR btrim(brand) <> ''),
  CONSTRAINT "items_color_nonempty_check" CHECK (color IS NULL OR btrim(color) <> ''),
  CONSTRAINT "items_weight_positive_check" CHECK (weight_kg > 0 AND weight_kg <> 'NaN'::numeric),
  CONSTRAINT "items_notes_nonempty_check" CHECK (notes IS NULL OR btrim(notes) <> '')
);
CREATE UNIQUE INDEX "items_code_key" ON items(code);
CREATE UNIQUE INDEX "items_merchant_id_ordinal_key" ON items(merchant_id, ordinal);
CREATE INDEX "items_merchant_id_is_active_created_at_id_idx" ON items(merchant_id, is_active, created_at, id);

CREATE FUNCTION enforce_item_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prefix TEXT; expected TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.merchant_id, NEW.ordinal, NEW.code, NEW.created_by_id, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id, OLD.merchant_id, OLD.ordinal, OLD.code, OLD.created_by_id, OLD.created_at) THEN
      RAISE EXCEPTION 'Item identity cannot be changed'
        USING ERRCODE = '23514', CONSTRAINT = 'items_identity_immutable';
    END IF;
  ELSE
    SELECT code INTO prefix FROM merchants WHERE id = NEW.merchant_id;
    -- Unknown merchants fall through to the FK. Padding never truncates long ordinals.
    expected := prefix || '-' || repeat('0', greatest(0, 6 - length(NEW.ordinal::text))) || NEW.ordinal::text;
    IF prefix IS NOT NULL AND NEW.code IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'Item code must match merchant and ordinal'
        USING ERRCODE = '23514', CONSTRAINT = 'items_code_identity_check';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER items_identity_guard BEFORE INSERT OR UPDATE ON items
FOR EACH ROW EXECUTE FUNCTION enforce_item_identity();
