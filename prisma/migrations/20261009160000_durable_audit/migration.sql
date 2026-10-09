CREATE TYPE audit_entity_type AS ENUM ('ITEM','ROW','SHELF','USER','MERCHANT');
CREATE TYPE audit_action AS ENUM ('CREATE','UPDATE','STATUS');
CREATE TABLE audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entity_type audit_entity_type NOT NULL,
 entity_id uuid NOT NULL,
 action audit_action NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 actor_name_snapshot varchar(150) NOT NULL CHECK(length(btrim(actor_name_snapshot)) BETWEEN 1 AND 150),
 actor_role_snapshot user_role NOT NULL,
 recorded_at timestamptz(3) NOT NULL,
 reason varchar(2000),
 before_snapshot jsonb,
 after_snapshot jsonb NOT NULL,
 CONSTRAINT audit_reason_action CHECK (
   (action='CREATE' AND reason IS NULL AND before_snapshot IS NULL) OR
   (action IN ('UPDATE','STATUS') AND reason IS NOT NULL AND
     length(btrim(reason)) BETWEEN 10 AND 2000 AND reason=btrim(reason) AND before_snapshot IS NOT NULL)
 )
);
-- Exact approved fields prevent persisting credentials or arbitrary request JSON.
CREATE FUNCTION valid_audit_snapshot(kind audit_entity_type,target uuid,snapshot jsonb)
 RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE expected text[]; actual text[]; key text;
BEGIN
 IF snapshot IS NULL OR jsonb_typeof(snapshot)<>'object' THEN RETURN false; END IF;
 expected=CASE kind
 WHEN 'ITEM' THEN ARRAY['id','merchantId','code','name','brand','color','weightKg','notes','isActive']
 WHEN 'ROW' THEN ARRAY['id','warehouseId','code','name','isActive']
 WHEN 'SHELF' THEN ARRAY['id','warehouseId','rowId','merchantId','code','name','isActive']
 WHEN 'USER' THEN ARRAY['id','email','displayName','role','merchantId','isActive','mustChangePassword']
 WHEN 'MERCHANT' THEN ARRAY['id','code','name','phone','isActive'] END;
 -- Required strings, nullable descriptors and UUIDs retain their API types.
 FOR key IN SELECT unnest(CASE kind
   WHEN 'ITEM' THEN ARRAY['id','merchantId','code','name','weightKg']
   WHEN 'ROW' THEN ARRAY['id','warehouseId','code','name']
   WHEN 'SHELF' THEN ARRAY['id','warehouseId','rowId','merchantId','code','name']
   WHEN 'USER' THEN ARRAY['id','email','displayName','role']
   WHEN 'MERCHANT' THEN ARRAY['id','code','name','phone'] END) LOOP
   IF jsonb_typeof(snapshot->key) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 END LOOP;
 IF kind='ITEM' THEN
   FOREACH key IN ARRAY ARRAY['brand','color','notes'] LOOP
     IF jsonb_typeof(snapshot->key) IS NULL OR jsonb_typeof(snapshot->key) NOT IN ('string','null') THEN RETURN false; END IF;
   END LOOP;
   IF snapshot->>'weightKg' !~ '^(0|[1-9][0-9]{0,8})\.[0-9]{3}$' THEN RETURN false; END IF;
   IF (snapshot->>'weightKg')::numeric <= 0 THEN RETURN false; END IF;
 END IF;
 IF kind='USER' THEN
   IF jsonb_typeof(snapshot->'mustChangePassword') IS DISTINCT FROM 'boolean'
     OR snapshot->>'role' NOT IN ('ADMIN','WAREHOUSE_KEEPER','EMPLOYEE','MERCHANT')
     OR jsonb_typeof(snapshot->'merchantId') IS NULL
     OR jsonb_typeof(snapshot->'merchantId') NOT IN ('string','null') THEN RETURN false; END IF;
 END IF;
 FOREACH key IN ARRAY ARRAY['id','merchantId','warehouseId','rowId'] LOOP
   IF snapshot ? key AND snapshot->key <> 'null'::jsonb AND
     (snapshot->>key) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RETURN false; END IF;
 END LOOP;
 SELECT array_agg(k ORDER BY k) INTO actual FROM jsonb_object_keys(snapshot) AS k;
 SELECT array_agg(k ORDER BY k) INTO expected FROM unnest(expected) AS k;
 RETURN COALESCE(actual=expected AND snapshot->>'id'=target::text
   AND jsonb_typeof(snapshot->'id')='string'
   AND jsonb_typeof(snapshot->'isActive')='boolean',false);
END; $$;
ALTER TABLE audit_events ADD CONSTRAINT audit_after_shape CHECK(valid_audit_snapshot(entity_type,entity_id,after_snapshot));
ALTER TABLE audit_events ADD CONSTRAINT audit_before_shape CHECK(before_snapshot IS NULL OR valid_audit_snapshot(entity_type,entity_id,before_snapshot));
CREATE INDEX audit_events_recorded_at_id_idx ON audit_events(recorded_at,id);
CREATE INDEX audit_events_entity_type_entity_id_recorded_at_idx ON audit_events(entity_type,entity_id,recorded_at);
CREATE INDEX audit_events_actor_id_recorded_at_idx ON audit_events(actor_id,recorded_at);
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
 FOR EACH ROW EXECUTE FUNCTION reject_inventory_history_mutation();

ALTER TABLE audit_events ADD CONSTRAINT audit_actor_role CHECK(
 actor_role_snapshot='ADMIN' OR (entity_type='ITEM' AND action='CREATE' AND actor_role_snapshot IN ('WAREHOUSE_KEEPER','EMPLOYEE'))
);
