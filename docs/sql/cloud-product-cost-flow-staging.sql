-- Isolated staging pkgrqalpazhwdcxmthvb only; no source stock/cash writes.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM bunbun_accounting.production_lot_values)
 THEN RAISE EXCEPTION 'Existing lot values require reviewed position backfill'; END IF; END $$;
CREATE TABLE bunbun_accounting.product_cost_positions (
 split_id bigint NOT NULL REFERENCES public.production_batch_splits(id),
 location text NOT NULL CHECK(location IN('FROZEN','PROOFING','FINISHED','CONSIGNMENT')),
 cafe_key text NOT NULL DEFAULT '', product_id bigint NOT NULL REFERENCES public.products(id),
 quantity integer NOT NULL CHECK(quantity>=0), actual_value numeric(18,2) NOT NULL CHECK(actual_value>=0),
 source_date date NOT NULL, posting_date date NOT NULL,
 PRIMARY KEY(split_id,location,cafe_key),
 CHECK((location='CONSIGNMENT' AND cafe_key IN('PUBLIC_HUB','PUBLIC_COFFEE')) OR (location<>'CONSIGNMENT' AND cafe_key='')),
 CHECK(actual_value::text NOT IN('NaN','Infinity','-Infinity')),
 CHECK((quantity=0 AND actual_value=0) OR quantity>0)
);
CREATE INDEX product_cost_positions_product ON bunbun_accounting.product_cost_positions(product_id,location,cafe_key);
CREATE TABLE bunbun_accounting.product_cost_events (
 operation_key uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN('THAW','BAKE','SHIP','RETURN','WASTE','SALE')),
 movement_id bigint UNIQUE REFERENCES public.product_stock_movements(id),
 sale_id bigint UNIQUE REFERENCES bunbun_accounting.sale_postings(sale_id),
 derived_split_id bigint REFERENCES public.production_batch_splits(id),
 source_date date NOT NULL, posting_date date NOT NULL,
 journal_id uuid NOT NULL UNIQUE REFERENCES bunbun_accounting.journals(id),
 source_snapshot text NOT NULL, request jsonb NOT NULL, result jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kind,derived_split_id)
);
CREATE TABLE bunbun_accounting.product_cost_allocations (
 operation_key uuid NOT NULL REFERENCES bunbun_accounting.product_cost_events(operation_key),
 split_id bigint NOT NULL REFERENCES public.production_batch_splits(id), location text NOT NULL, cafe_key text NOT NULL,
 quantity integer NOT NULL CHECK(quantity>0), actual_value numeric(18,2) NOT NULL CHECK(actual_value>0),
 PRIMARY KEY(operation_key,split_id,location,cafe_key)
);
CREATE TABLE bunbun_accounting.product_cost_sale_sources (
 sale_id bigint NOT NULL REFERENCES bunbun_accounting.sale_postings(sale_id),
 movement_id bigint NOT NULL UNIQUE REFERENCES public.product_stock_movements(id), PRIMARY KEY(sale_id,movement_id)
);
ALTER TABLE bunbun_accounting.product_cost_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.product_cost_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.product_cost_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.product_cost_sale_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bunbun_accounting.product_cost_positions,bunbun_accounting.product_cost_events,
 bunbun_accounting.product_cost_allocations,bunbun_accounting.product_cost_sale_sources FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON bunbun_accounting.product_cost_positions TO service_role;
GRANT SELECT,INSERT ON bunbun_accounting.product_cost_events,bunbun_accounting.product_cost_allocations,bunbun_accounting.product_cost_sale_sources TO service_role;

CREATE FUNCTION bunbun_accounting.seed_product_cost_position() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
 INSERT INTO bunbun_accounting.product_cost_positions(split_id,location,cafe_key,product_id,quantity,actual_value,source_date,posting_date)
 SELECT NEW.split_id,NEW.initial_location,'',NEW.product_id,NEW.quantity,NEW.actual_value,m.movement_date,c.completion_date
 FROM bunbun_accounting.production_completions c JOIN public.product_stock_movements m ON m.id=NEW.source_movement_id WHERE c.batch_id=NEW.batch_id;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.seed_product_cost_position() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.seed_product_cost_position() TO service_role;
CREATE TRIGGER seed_accounting_product_cost_position AFTER INSERT ON bunbun_accounting.production_lot_values
 FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.seed_product_cost_position();

CREATE FUNCTION bunbun_accounting.guard_product_cost_sources() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE sid bigint; mid bigint; sale bigint;
BEGIN
 IF TG_TABLE_NAME='production_batch_splits' THEN
   IF EXISTS(SELECT 1 FROM bunbun_accounting.product_cost_events WHERE derived_split_id=OLD.id AND kind='BAKE')
   THEN RAISE EXCEPTION 'Costed frozen baking source is immutable'; END IF;
   IF EXISTS(SELECT 1 FROM bunbun_accounting.product_cost_events WHERE derived_split_id=OLD.id AND kind='THAW')
     AND (TG_OP='DELETE' OR (to_jsonb(OLD)-ARRAY['baked_good_qty','baked_reject_qty','status','updated_at','updated_by']) IS DISTINCT FROM
       (to_jsonb(NEW)-ARRAY['baked_good_qty','baked_reject_qty','status','updated_at','updated_by']))
   THEN RAISE EXCEPTION 'Costed thaw source identity and quantity are immutable'; END IF;
 ELSE
   FOR mid IN SELECT DISTINCT x FROM unnest(ARRAY[CASE WHEN TG_OP<>'INSERT' THEN OLD.id END,CASE WHEN TG_OP<>'DELETE' THEN NEW.id END]) x WHERE x IS NOT NULL LOOP
     IF EXISTS(SELECT 1 FROM bunbun_accounting.product_cost_events WHERE movement_id=mid)
       OR EXISTS(SELECT 1 FROM bunbun_accounting.product_cost_sale_sources WHERE movement_id=mid)
     THEN RAISE EXCEPTION 'Valued product stock source is immutable'; END IF;
   END LOOP;
   FOR sale IN SELECT DISTINCT x FROM unnest(ARRAY[CASE WHEN TG_OP<>'INSERT' THEN OLD.sale_id END,CASE WHEN TG_OP<>'DELETE' THEN NEW.sale_id END]) x WHERE x IS NOT NULL ORDER BY x LOOP
     PERFORM 1 FROM public.sales WHERE id=sale FOR UPDATE;
     IF EXISTS(SELECT 1 FROM bunbun_accounting.sale_postings WHERE sale_id=sale AND cogs_status='POSTED')
     THEN RAISE EXCEPTION 'Costed sale stock sources are immutable'; END IF;
   END LOOP;
   FOR sid IN SELECT DISTINCT x FROM unnest(ARRAY[CASE WHEN TG_OP<>'INSERT' THEN OLD.batch_split_id END,CASE WHEN TG_OP<>'DELETE' THEN NEW.batch_split_id END]) x WHERE x IS NOT NULL ORDER BY x LOOP
     PERFORM 1 FROM public.production_batch_splits WHERE id=sid FOR UPDATE;
     IF ((TG_OP<>'INSERT' AND OLD.movement_type='FINISHED_IN') OR (TG_OP<>'DELETE' AND NEW.movement_type='FINISHED_IN'))
       AND EXISTS(SELECT 1 FROM bunbun_accounting.product_cost_events WHERE derived_split_id=sid AND kind='BAKE')
     THEN RAISE EXCEPTION 'Costed frozen baking receipt is immutable'; END IF;
   END LOOP;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.guard_product_cost_sources() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_accounting_costed_product_source BEFORE INSERT OR UPDATE OR DELETE ON public.product_stock_movements
 FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_product_cost_sources();
CREATE TRIGGER guard_accounting_costed_frozen_split BEFORE UPDATE OR DELETE ON public.production_batch_splits
 FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_product_cost_sources();

-- Existing operational tracking must agree when present. Legacy records still
-- require explicit Owner lot-trace evidence; this function never guesses FIFO.
CREATE FUNCTION bunbun_accounting.product_cost_tracking(p_movement_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE result jsonb; header jsonb;
BEGIN
 IF to_regclass('bunbun_accounting.lot_release_allocations') IS NOT NULL THEN
   EXECUTE 'SELECT jsonb_agg(jsonb_build_object(''lot_key'',lot_key,''qty'',qty) ORDER BY lot_key) FROM bunbun_accounting.lot_release_allocations WHERE stock_movement_id=$1' INTO result USING p_movement_id;
   IF result IS NOT NULL THEN
     EXECUTE 'SELECT to_jsonb(o) FROM bunbun_accounting.lot_release_operations o JOIN public.product_stock_movements m ON m.operation_key=o.operation_key WHERE m.id=$1' INTO header USING p_movement_id;
   END IF;
 END IF;
 IF result IS NULL AND to_regclass('bunbun_accounting.lot_sale_out_allocations') IS NOT NULL THEN
   EXECUTE 'SELECT jsonb_agg(jsonb_build_object(''lot_key'',lot_key,''qty'',qty) ORDER BY lot_key) FROM bunbun_accounting.lot_sale_out_allocations WHERE stock_movement_id=$1' INTO result USING p_movement_id;
 END IF;
 RETURN jsonb_build_object('allocations',result,'header',header);
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.product_cost_tracking(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.product_cost_tracking(bigint) TO service_role;

CREATE FUNCTION bunbun_accounting.process_product_cost(p_action text,p_payload jsonb,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE kind text:=p_payload->>'kind'; m public.product_stock_movements%rowtype; d public.production_batch_splits%rowtype;
 s public.sales%rowtype; sale_post bunbun_accounting.sale_postings%rowtype; pos bunbun_accounting.product_cost_positions%rowtype;
 old bunbun_accounting.product_cost_events%rowtype; req jsonb; items jsonb; stock_sources jsonb; sources jsonb;
 snapshot text; inspected jsonb:='[]'; line jsonb; normalized jsonb; tracked jsonb; blockers jsonb:='[]'; result jsonb;
 src_date date; post_date date:=(p_payload->>'date')::date; pid uuid; j uuid:=gen_random_uuid(); op uuid;
 qty integer; moved numeric; total numeric:=0; loss numeric:=0; quantity_total integer:=0; ln integer:=0;
 from_account text; to_account text; dest_location text; dest_cafe text; dest_split bigint; dest_qty integer;
 expected_location text; cafe text:=coalesce(p_payload->>'cafeKey',''); ready boolean; extra jsonb; row_m public.product_stock_movements%rowtype;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Private backend required'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND role::text='owner' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Owner approval required'; END IF;
 IF p_action='inspect' THEN
   IF (SELECT count(*) FROM bunbun_accounting.product_cost_positions WHERE quantity>0)>500
   THEN RAISE EXCEPTION 'Position list needs a narrower query'; END IF;
   RETURN jsonb_build_object('positions',(SELECT coalesce(jsonb_agg(jsonb_build_object('splitId',p.split_id::text,'productId',p.product_id::text,
     'location',p.location,'cafeKey',p.cafe_key,'quantity',p.quantity,'actualValue',p.actual_value::text,'sourceDate',p.source_date,'postingDate',p.posting_date)
     ORDER BY p.split_id,p.location,p.cafe_key),'[]') FROM bunbun_accounting.product_cost_positions p WHERE p.quantity>0),
     'movements',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM (SELECT st.id::text,st.movement_date,st.movement_type,st.product_id::text,st.batch_split_id::text,st.qty,st.sale_id::text
       FROM public.product_stock_movements st WHERE NOT is_deleted AND NOT EXISTS(SELECT 1 FROM bunbun_accounting.product_cost_events e WHERE e.movement_id=st.id)
       AND movement_type IN('FROZEN_OUT','FINISHED_IN','CAFE_OUT','CAFE_IN','ADJUSTMENT_OUT') ORDER BY id DESC LIMIT 500) x),
     'derivedSplits',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id::text,'sourceSplitId',source_split_id::text,'productId',product_id::text,
       'quantity',ds.qty,'good',baked_good_qty,'reject',baked_reject_qty,'status',status) ORDER BY id),'[]') FROM public.production_batch_splits ds WHERE source_split_id IS NOT NULL AND NOT is_deleted),
     'sales',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM (SELECT sr.id::text,sr.sale_date,sr.sales_channel FROM public.sales sr
       JOIN bunbun_accounting.sale_postings p ON p.sale_id=sr.id WHERE NOT sr.is_deleted AND p.cogs_status='PENDING_VALUATION' ORDER BY sr.id DESC LIMIT 500) x),
     'actualProfitAvailable',false);
 END IF;
 IF p_action NOT IN('review','post') OR kind NOT IN('THAW','BAKE','SHIP','RETURN','WASTE','SALE') OR kind IS NULL
 THEN RAISE EXCEPTION 'Supported product cost event required'; END IF;
 req:=p_payload||jsonb_build_object('actorId',p_actor_id);
 IF p_action='post' THEN
   op:=(p_payload->>'operationKey')::uuid;
   PERFORM pg_advisory_xact_lock(hashtextextended(op::text,0));
   SELECT * INTO old FROM bunbun_accounting.product_cost_events WHERE operation_key=op;
   IF FOUND THEN
     IF old.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'Product cost operation reused with different request'; END IF;
     RETURN old.result||jsonb_build_object('alreadyProcessed',true);
   END IF;
 END IF;
 IF p_payload->'traceConfirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(p_payload->'allocations') IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_payload->'allocations') NOT BETWEEN 1 AND 50
 THEN RAISE EXCEPTION 'Explicit verified product lot trace required'; END IF;
 IF kind='SALE' THEN
   SELECT * INTO s FROM public.sales WHERE id=(p_payload->>'saleId')::bigint FOR UPDATE;
   IF NOT FOUND OR s.is_deleted THEN RAISE EXCEPTION 'Active sold source required'; END IF;
   SELECT * INTO sale_post FROM bunbun_accounting.sale_postings WHERE sale_id=s.id FOR UPDATE;
   IF NOT FOUND OR sale_post.cogs_status<>'PENDING_VALUATION' THEN RAISE EXCEPTION 'Confirmed sale with pending COGS required'; END IF;
   IF s.sales_channel NOT IN('DIRECT','PUBLIC_HUB','PUBLIC_COFFEE') THEN RAISE EXCEPTION 'Specific supported cafe identity required'; END IF;
   src_date:=s.sale_date; expected_location:=CASE WHEN s.sales_channel='DIRECT' THEN 'FINISHED' ELSE 'CONSIGNMENT' END;
   cafe:=CASE WHEN s.sales_channel='DIRECT' THEN '' ELSE s.sales_channel END;
   IF p_payload->>'cafeKey' IS DISTINCT FROM cafe THEN RAISE EXCEPTION 'Sale cafe identity differs'; END IF;
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') INTO items FROM public.sale_items x WHERE sale_id=s.id;
   IF jsonb_array_length(items)=0 THEN RAISE EXCEPTION 'Complete sale items required'; END IF;
   PERFORM 1 FROM public.product_stock_movements WHERE sale_id=s.id ORDER BY id FOR UPDATE;
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') INTO stock_sources FROM public.product_stock_movements x WHERE sale_id=s.id;
   IF expected_location='FINISHED' AND jsonb_array_length(stock_sources)=0 THEN RAISE EXCEPTION 'Recorded direct sale stock out required'; END IF;
   FOR row_m IN SELECT * FROM public.product_stock_movements WHERE sale_id=s.id ORDER BY id LOOP
     IF row_m.is_deleted OR row_m.movement_type<>'CAFE_OUT' THEN RAISE EXCEPTION 'Sale physical sources require reconciliation'; END IF;
     IF expected_location='CONSIGNMENT' AND NOT EXISTS(SELECT 1 FROM bunbun_accounting.product_cost_events WHERE movement_id=row_m.id AND product_cost_events.kind='SHIP'
       AND request->>'cafeKey'=cafe) THEN RAISE EXCEPTION 'Cafe sale stock rows must already be valued as the same cafe shipment'; END IF;
   END LOOP;
 ELSE
   IF kind='BAKE' THEN
     SELECT * INTO d FROM public.production_batch_splits WHERE id=(p_payload->>'derivedSplitId')::bigint FOR UPDATE;
     IF NOT FOUND OR d.source_split_id IS NULL OR d.is_deleted OR d.route<>'DIRECT' OR d.status<>'BAKED'
       OR d.qty<>d.baked_good_qty+d.baked_reject_qty OR d.baked_good_qty<0 OR d.baked_reject_qty<0
     THEN RAISE EXCEPTION 'Reconciled frozen-derived baking source required'; END IF;
   END IF;
   IF p_payload->>'movementId' IS NOT NULL THEN
     SELECT * INTO m FROM public.product_stock_movements WHERE id=(p_payload->>'movementId')::bigint FOR UPDATE;
     IF NOT FOUND OR m.is_deleted OR m.qty<=0 THEN RAISE EXCEPTION 'Active positive stock movement required'; END IF;
     src_date:=m.movement_date;
   ELSIF kind='BAKE' AND d.baked_good_qty=0 THEN
     SELECT * INTO old FROM bunbun_accounting.product_cost_events WHERE product_cost_events.kind='THAW' AND derived_split_id=d.id;
     IF NOT FOUND THEN RAISE EXCEPTION 'Costed thaw required before all-reject baking'; END IF;
     src_date:=(p_payload->>'sourceDate')::date;
     IF src_date IS NULL OR src_date<old.source_date THEN RAISE EXCEPTION 'Actual baking date evidence required'; END IF;
   ELSE RAISE EXCEPTION 'Stock source movement required'; END IF;
   IF EXISTS(SELECT 1 FROM bunbun_accounting.product_cost_events WHERE movement_id=m.id)
     OR (kind='BAKE' AND EXISTS(SELECT 1 FROM bunbun_accounting.product_cost_events WHERE derived_split_id=d.id AND product_cost_events.kind='BAKE'))
   THEN RAISE EXCEPTION 'Product cost source already processed'; END IF;
   IF kind='THAW' THEN
     SELECT * INTO d FROM public.production_batch_splits WHERE id=(p_payload->>'derivedSplitId')::bigint FOR UPDATE;
     IF NOT FOUND OR d.is_deleted OR d.source_split_id IS DISTINCT FROM m.batch_split_id OR d.route<>'DIRECT' OR d.qty<>m.qty
       OR d.product_id<>m.product_id OR m.movement_type<>'FROZEN_OUT'
     THEN RAISE EXCEPTION 'Frozen out and derived split identity/quantity must match'; END IF;
     IF EXISTS(SELECT 1 FROM bunbun_accounting.product_cost_events WHERE derived_split_id=d.id AND product_cost_events.kind='THAW')
     THEN RAISE EXCEPTION 'Derived thaw source already costed'; END IF;
     IF to_regclass('bunbun_accounting.frozen_conversion_operations') IS NOT NULL THEN
       EXECUTE 'SELECT to_jsonb(x) FROM bunbun_accounting.frozen_conversion_operations x WHERE stock_movement_id=$1' INTO extra USING m.id;
       IF extra IS NOT NULL AND (extra->>'direct_split_id')::bigint<>d.id THEN RAISE EXCEPTION 'Tracked frozen conversion differs'; END IF;
     END IF;
     expected_location:='FROZEN';dest_location:='PROOFING';dest_split:=d.id;
   ELSIF kind='BAKE' THEN
     IF p_payload->'noAdditionalBakingCostConfirmed' IS DISTINCT FROM 'true'::jsonb
     THEN RAISE EXCEPTION 'Unknown additional baking labor/overhead must not be treated as zero'; END IF;
     IF (d.baked_good_qty>0 AND (m.batch_split_id IS DISTINCT FROM d.id OR m.product_id<>d.product_id OR m.movement_type<>'FINISHED_IN' OR m.qty<>d.baked_good_qty))
       OR (d.baked_good_qty=0 AND (m.id IS NOT NULL OR EXISTS(SELECT 1 FROM public.product_stock_movements WHERE batch_split_id=d.id AND movement_type='FINISHED_IN' AND NOT is_deleted)))
     THEN RAISE EXCEPTION 'Baking good/reject results and physical receipt must match'; END IF;
     IF to_regclass('bunbun_accounting.baking_operations') IS NOT NULL THEN
       EXECUTE 'SELECT to_jsonb(x) FROM bunbun_accounting.baking_operations x WHERE direct_split_id=$1' INTO extra USING d.id;
       IF extra IS NOT NULL AND ((extra->>'stock_movement_id')::bigint IS DISTINCT FROM m.id
         OR (extra->>'good_qty')::integer<>d.baked_good_qty OR (extra->>'reject_qty')::integer<>d.baked_reject_qty
         OR (extra->>'movement_date')::date<>src_date) THEN RAISE EXCEPTION 'Tracked baking result differs'; END IF;
     END IF;
     expected_location:='PROOFING';dest_location:='FINISHED';dest_split:=d.id;
   ELSIF kind='SHIP' THEN
     IF m.movement_type<>'CAFE_OUT' OR cafe NOT IN('PUBLIC_HUB','PUBLIC_COFFEE') THEN RAISE EXCEPTION 'Explicit supported cafe shipment required'; END IF;
     expected_location:='FINISHED';dest_location:='CONSIGNMENT';dest_cafe:=cafe;
   ELSIF kind='RETURN' THEN
     IF m.movement_type<>'CAFE_IN' OR m.sale_id IS NOT NULL OR cafe NOT IN('PUBLIC_HUB','PUBLIC_COFFEE')
     THEN RAISE EXCEPTION 'Unsold cafe return required; sold refunds need reversal'; END IF;
     expected_location:='CONSIGNMENT';dest_location:='FINISHED';
   ELSE
     IF m.movement_type<>'ADJUSTMENT_OUT' OR m.sale_id IS NOT NULL THEN RAISE EXCEPTION 'Recorded finished stock waste required'; END IF;
     expected_location:='FINISHED';
   END IF;
   tracked:=bunbun_accounting.product_cost_tracking(m.id);
   IF kind='SHIP' AND tracked->'header' IS NOT NULL AND tracked->'header'<>'null'::jsonb
     AND ((tracked->'header'->>'destination_type')<>'CAFE_CONSIGNMENT'
       OR lower(btrim(tracked->'header'->>'destination')) NOT IN(lower(cafe),CASE WHEN cafe='PUBLIC_HUB' THEN 'public hub' ELSE 'the public coffee' END))
   THEN RAISE EXCEPTION 'Tracked shipment cafe identity differs'; END IF;
 END IF;
 loss:=(p_payload->>'rejectCost')::numeric;
 IF loss IS NULL OR loss<0 OR loss::text IN('NaN','Infinity','-Infinity') OR loss<>round(loss,2)
   OR (kind<>'BAKE' AND (loss<>0 OR p_payload->>'lossPolicy' IS DISTINCT FROM 'NONE'))
   OR (kind='BAKE' AND (p_payload->>'lossPolicy' NOT IN('ABSORB_NORMAL_LOSS','SEPARATE_ABNORMAL_LOSS') OR p_payload->>'lossPolicy' IS NULL))
 THEN RAISE EXCEPTION 'Explicit supported loss policy and exact cost required'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_payload->'allocations'))<>(SELECT count(DISTINCT (x->>'splitId',x->>'location',coalesce(x->>'cafeKey',''))) FROM jsonb_array_elements(p_payload->'allocations') x)
 THEN RAISE EXCEPTION 'Duplicate product cost position allocation'; END IF;
 FOR line IN SELECT x FROM jsonb_array_elements(p_payload->'allocations') x ORDER BY (x->>'splitId')::bigint,x->>'location',x->>'cafeKey' LOOP
   qty:=(line->>'quantity')::integer;
   IF qty IS NULL OR qty<=0 OR line->>'location' IS DISTINCT FROM expected_location THEN RAISE EXCEPTION 'Positive exact source position quantity required'; END IF;
   SELECT * INTO pos FROM bunbun_accounting.product_cost_positions WHERE split_id=(line->>'splitId')::bigint AND location=expected_location AND cafe_key=coalesce(line->>'cafeKey','') FOR UPDATE;
   IF NOT FOUND OR pos.quantity<qty OR pos.quantity=0 OR pos.actual_value<=0 THEN RAISE EXCEPTION 'Insufficient valued lot position'; END IF;
   IF (expected_location='CONSIGNMENT' AND pos.cafe_key<>cafe)
     OR (kind<>'SALE' AND pos.product_id<>coalesce(m.product_id,d.product_id))
     OR (kind='THAW' AND pos.split_id IS DISTINCT FROM m.batch_split_id)
     OR (kind='BAKE' AND (pos.split_id<>d.id OR qty<>d.qty OR qty<>pos.quantity))
     OR src_date<pos.source_date OR post_date<pos.posting_date
   THEN RAISE EXCEPTION 'Product lot identity/cafe/date differs from verified source'; END IF;
   moved:=CASE WHEN qty=pos.quantity THEN pos.actual_value ELSE trunc(pos.actual_value*qty/pos.quantity,2) END;
   IF moved<=0 THEN RAISE EXCEPTION 'Cost precision requires larger reconciliation allocation'; END IF;
   inspected:=inspected||jsonb_build_object('position',to_jsonb(pos),'quantity',qty,'value',moved::text);
   total:=total+moved; quantity_total:=quantity_total+qty;
 END LOOP;
 IF kind IN('THAW','BAKE') AND jsonb_array_length(inspected)<>1 THEN RAISE EXCEPTION 'One traced frozen conversion position required'; END IF;
 IF kind<>'SALE' AND quantity_total<>(CASE WHEN kind='BAKE' THEN d.qty ELSE m.qty END)
 THEN RAISE EXCEPTION 'Product lot quantities must equal source movement'; END IF;
 IF kind='SALE' THEN
   IF EXISTS(SELECT 1 FROM public.sale_items WHERE sale_id=s.id AND (quantity<=0 OR quantity<>trunc(quantity)))
   OR EXISTS(WITH sold AS(SELECT product_id,sum(quantity) q FROM public.sale_items WHERE sale_id=s.id GROUP BY product_id),
     allocated AS(SELECT (x->'position'->>'product_id')::bigint product_id,sum((x->>'quantity')::integer) q FROM jsonb_array_elements(inspected) x GROUP BY 1)
     SELECT 1 FROM sold FULL JOIN allocated USING(product_id) WHERE sold.q IS DISTINCT FROM allocated.q)
   THEN RAISE EXCEPTION 'Every actual sold product quantity must match valued lot allocations'; END IF;
   IF jsonb_array_length(stock_sources)>0 AND EXISTS(WITH sold AS(SELECT product_id,sum(quantity) q FROM public.sale_items WHERE sale_id=s.id GROUP BY product_id),
     outs AS(SELECT z.product_id,sum(z.qty) q FROM public.product_stock_movements z WHERE z.sale_id=s.id GROUP BY z.product_id)
     SELECT 1 FROM sold FULL JOIN outs USING(product_id) WHERE sold.q IS DISTINCT FROM outs.q)
   THEN RAISE EXCEPTION 'Sale stock source quantities require reconciliation'; END IF;
   FOR row_m IN SELECT * FROM public.product_stock_movements WHERE sale_id=s.id LOOP
     extra:=bunbun_accounting.product_cost_tracking(row_m.id);
     IF expected_location='FINISHED' AND extra->'allocations'<>'null'::jsonb THEN
       SELECT jsonb_agg(jsonb_build_object('lot_key','split:'||(x->'position'->>'split_id'),'qty',(x->>'quantity')::integer)
         ORDER BY 'split:'||(x->'position'->>'split_id')) INTO normalized FROM jsonb_array_elements(inspected) x WHERE (x->'position'->>'product_id')::bigint=row_m.product_id;
       IF normalized IS DISTINCT FROM extra->'allocations' THEN RAISE EXCEPTION 'Operational sale lot trace differs'; END IF;
     END IF;
   END LOOP;
 ELSIF kind='SHIP' AND tracked->'allocations'<>'null'::jsonb THEN
   SELECT jsonb_agg(jsonb_build_object('lot_key','split:'||(x->'position'->>'split_id'),'qty',(x->>'quantity')::integer)
     ORDER BY 'split:'||(x->'position'->>'split_id')) INTO normalized FROM jsonb_array_elements(inspected) x;
   IF normalized IS DISTINCT FROM tracked->'allocations' THEN RAISE EXCEPTION 'Operational shipment lot trace differs'; END IF;
 END IF;
 IF kind='BAKE' AND (loss>=total AND d.baked_good_qty>0 OR loss>total
   OR p_payload->>'lossPolicy'='ABSORB_NORMAL_LOSS' AND loss<>0
   OR p_payload->>'lossPolicy'='SEPARATE_ABNORMAL_LOSS' AND (loss<=0 OR d.baked_reject_qty<=0)
   OR d.baked_good_qty=0 AND loss<>total)
 THEN RAISE EXCEPTION 'Baking reject valuation must conserve all source value'; END IF;
 SELECT id INTO pid FROM bunbun_accounting.periods WHERE month_start=date_trunc('month',post_date)::date FOR UPDATE;
 ready:=post_date IS NOT NULL AND post_date>=src_date AND date_trunc('month',post_date)=date_trunc('month',src_date)
   AND EXISTS(SELECT 1 FROM bunbun_accounting.periods WHERE id=pid AND status='OPEN')
   AND EXISTS(SELECT 1 FROM bunbun_accounting.journals WHERE source_type='OPENING' AND status='POSTED' AND posting_date<=src_date);
 IF NOT coalesce(ready,false) THEN blockers:=blockers||'"Periode belum siap atau biaya lintas bulan memerlukan akrual/koreksi."'::jsonb; END IF;
 sources:=jsonb_build_object('movement',to_jsonb(m),'derived',to_jsonb(d),'sale',to_jsonb(s),'salePosting',to_jsonb(sale_post),'items',items,'stock',stock_sources,'tracking',tracked,'positions',inspected,'extraTracking',extra);
 snapshot:=encode(sha256(convert_to(sources::text,'UTF8')),'hex');
 result:=jsonb_build_object('kind',kind,'sourceDate',src_date,'postingDate',post_date,'totalCost',total::text,'rejectCost',loss::text,
   'allocations',inspected,'mayConfirm',jsonb_array_length(blockers)=0,'blockers',blockers,'sourceSnapshot',snapshot,'actualProfitAvailable',false);
 IF p_action='review' THEN RETURN result; END IF;
 IF jsonb_array_length(blockers)>0 THEN RAISE EXCEPTION 'Product cost source period requires reconciliation'; END IF;
 IF p_payload->>'sourceSnapshot' IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'Product cost source or position changed since review'; END IF;
 IF p_payload->>'evidenceRef' IS NULL OR length(btrim(p_payload->>'evidenceRef')) NOT BETWEEN 6 AND 500 THEN RAISE EXCEPTION 'Product cost evidence required'; END IF;
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key,narrative,created_by)
 VALUES(j,pid,post_date,'NORMAL',CASE WHEN kind='SALE' THEN 'sold-lot-cogs:'||s.id ELSE 'product-cost:'||kind||':'||CASE WHEN m.id IS NULL THEN 'split:'||d.id::text ELSE 'movement:'||m.id::text END END,op,p_payload->>'evidenceRef',p_actor_id);
 FOR line IN SELECT * FROM jsonb_array_elements(inspected) LOOP
   pos:=jsonb_populate_record(NULL::bunbun_accounting.product_cost_positions,line->'position');qty:=(line->>'quantity')::integer;moved:=(line->>'value')::numeric;
   from_account:=CASE pos.location WHEN 'FROZEN' THEN '1230' WHEN 'PROOFING' THEN '1215' WHEN 'FINISHED' THEN '1220' ELSE '1240' END;
   dest_split:=CASE WHEN kind IN('THAW','BAKE') THEN d.id ELSE pos.split_id END;
   dest_qty:=CASE WHEN kind='BAKE' THEN d.baked_good_qty ELSE qty END;
   to_account:=CASE kind WHEN 'THAW' THEN '1215' WHEN 'BAKE' THEN '1220' WHEN 'SHIP' THEN '1240' WHEN 'RETURN' THEN '1220' WHEN 'WASTE' THEN '6070' ELSE '5010' END;
   UPDATE bunbun_accounting.product_cost_positions SET quantity=quantity-qty,actual_value=actual_value-moved,source_date=src_date,posting_date=post_date
     WHERE split_id=pos.split_id AND location=pos.location AND cafe_key=pos.cafe_key;
   IF kind IN('THAW','BAKE','SHIP','RETURN') AND dest_qty>0 THEN
     PERFORM 1 FROM bunbun_accounting.product_cost_positions WHERE split_id=dest_split AND location=dest_location AND cafe_key=coalesce(dest_cafe,'') FOR UPDATE;
     IF EXISTS(SELECT 1 FROM bunbun_accounting.product_cost_positions WHERE split_id=dest_split AND location=dest_location AND cafe_key=coalesce(dest_cafe,'')
       AND (source_date>src_date OR posting_date>post_date OR product_id<>pos.product_id))
     THEN RAISE EXCEPTION 'Destination cost position requires chronological reconciliation'; END IF;
     INSERT INTO bunbun_accounting.product_cost_positions(split_id,location,cafe_key,product_id,quantity,actual_value,source_date,posting_date)
       VALUES(dest_split,dest_location,coalesce(dest_cafe,''),pos.product_id,dest_qty,moved-loss,src_date,post_date)
       ON CONFLICT(split_id,location,cafe_key) DO UPDATE SET quantity=product_cost_positions.quantity+EXCLUDED.quantity,
         actual_value=product_cost_positions.actual_value+EXCLUDED.actual_value,source_date=greatest(product_cost_positions.source_date,EXCLUDED.source_date),
         posting_date=greatest(product_cost_positions.posting_date,EXCLUDED.posting_date);
   END IF;
   ln:=ln+1;INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit,product_id)
     VALUES(j,ln,from_account,0,moved,pos.product_id);
   IF moved-loss>0 THEN ln:=ln+1;INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit,product_id)
     VALUES(j,ln,to_account,moved-loss,0,pos.product_id); END IF;
   IF kind='BAKE' AND loss>0 THEN ln:=ln+1;INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit,product_id)
     VALUES(j,ln,'6070',loss,0,pos.product_id); END IF;
   INSERT INTO bunbun_accounting.stock_cost_movements(journal_id,source_key,product_id,valuation_class,quantity_base,value_delta,base_unit)
     VALUES(j,'cost-out:'||op||':'||ln,pos.product_id,CASE WHEN pos.location='PROOFING' THEN 'WIP' ELSE pos.location END,-qty,-moved,'pcs');
   IF dest_location IS NOT NULL AND dest_qty>0 THEN
     INSERT INTO bunbun_accounting.stock_cost_movements(journal_id,source_key,product_id,valuation_class,quantity_base,value_delta,base_unit)
       VALUES(j,'cost-in:'||op||':'||ln,pos.product_id,CASE WHEN dest_location='PROOFING' THEN 'WIP' ELSE dest_location END,dest_qty,moved-loss,'pcs');
   END IF;
 END LOOP;
 PERFORM bunbun_accounting.post_reviewed_journal(j,p_actor_id);
 result:=jsonb_build_object('journalId',j,'kind',kind,'totalCost',total::text,'rejectCost',loss::text,'alreadyProcessed',false,'actualProfitAvailable',false);
 INSERT INTO bunbun_accounting.product_cost_events(operation_key,kind,movement_id,sale_id,derived_split_id,source_date,posting_date,journal_id,source_snapshot,request,result,actor_id)
 VALUES(op,kind,m.id,s.id,CASE WHEN kind IN('THAW','BAKE') THEN d.id END,src_date,post_date,j,snapshot,req,result,p_actor_id);
 INSERT INTO bunbun_accounting.product_cost_allocations(operation_key,split_id,location,cafe_key,quantity,actual_value)
 SELECT op,(x->'position'->>'split_id')::bigint,x->'position'->>'location',x->'position'->>'cafe_key',(x->>'quantity')::integer,(x->>'value')::numeric FROM jsonb_array_elements(inspected) x;
 IF kind='SALE' THEN
   UPDATE bunbun_accounting.sale_postings SET cogs_status='POSTED',cogs_journal_id=j WHERE sale_id=s.id;
   INSERT INTO bunbun_accounting.product_cost_sale_sources(sale_id,movement_id) SELECT s.id,id FROM public.product_stock_movements WHERE sale_id=s.id;
 END IF;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.process_product_cost(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.process_product_cost(text,jsonb,uuid) TO service_role;
CREATE FUNCTION public.accounting_product_flow_service(p_action text,p_payload jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT bunbun_accounting.process_product_cost(p_action,p_payload,p_actor_id);
$fn$;
REVOKE ALL ON FUNCTION public.accounting_product_flow_service(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_product_flow_service(text,jsonb,uuid) TO service_role;

CREATE FUNCTION bunbun_accounting.product_cost_readiness(p_month date) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE cutoff date; stock_count integer; wip_count integer; pool_count integer; bake_count integer;
BEGIN
 SELECT min(cutover_on) INTO cutoff FROM bunbun_accounting.opening_snapshots WHERE status='APPROVED';
 SELECT count(*) INTO stock_count FROM public.product_stock_movements m WHERE NOT m.is_deleted AND m.movement_date>=cutoff
   AND m.movement_date<date_trunc('month',p_month)+interval '1 month'
   AND NOT EXISTS(SELECT 1 FROM bunbun_accounting.production_lot_values v JOIN bunbun_accounting.production_completions c ON c.batch_id=v.batch_id
     WHERE v.source_movement_id=m.id AND c.completion_date<date_trunc('month',p_month)+interval '1 month')
   AND NOT EXISTS(SELECT 1 FROM bunbun_accounting.product_cost_events e WHERE e.movement_id=m.id AND e.posting_date<date_trunc('month',p_month)+interval '1 month')
   AND NOT EXISTS(SELECT 1 FROM bunbun_accounting.product_cost_sale_sources x JOIN bunbun_accounting.sale_postings p ON p.sale_id=x.sale_id
     JOIN bunbun_accounting.journals j ON j.id=p.cogs_journal_id WHERE x.movement_id=m.id AND j.posting_date<date_trunc('month',p_month)+interval '1 month');
 SELECT count(DISTINCT m.batch_id) INTO wip_count FROM bunbun_accounting.material_postings m LEFT JOIN bunbun_accounting.production_completions c ON c.batch_id=m.batch_id
   WHERE m.transaction_date<date_trunc('month',p_month)+interval '1 month' AND (c.batch_id IS NULL OR c.completion_date>=date_trunc('month',p_month)+interval '1 month');
 SELECT count(*) INTO pool_count FROM bunbun_accounting.production_cost_sources s JOIN public.expenses e ON e.id=s.expense_id
   WHERE e.tanggal<date_trunc('month',p_month)+interval '1 month' AND s.amount<>(SELECT coalesce(sum(a.amount),0) FROM bunbun_accounting.production_cost_allocations a
     WHERE a.expense_id=s.expense_id AND a.allocation_date<date_trunc('month',p_month)+interval '1 month');
 SELECT count(*) INTO bake_count FROM public.production_batch_splits s JOIN bunbun_accounting.product_cost_events e ON e.derived_split_id=s.id AND e.kind='THAW'
   WHERE s.status='BAKED' AND s.baked_good_qty=0 AND NOT s.is_deleted AND e.source_date<date_trunc('month',p_month)+interval '1 month'
   AND NOT EXISTS(SELECT 1 FROM bunbun_accounting.product_cost_events b WHERE b.derived_split_id=s.id AND b.kind='BAKE' AND b.posting_date<date_trunc('month',p_month)+interval '1 month');
 RETURN jsonb_build_object('productCostsComplete',cutoff IS NOT NULL AND stock_count=0 AND wip_count=0 AND pool_count=0 AND bake_count=0,
   'unvaluedStockMovements',stock_count,'uncompletedBatches',wip_count,'unallocatedProductionSources',pool_count,'unvaluedAllRejectBakes',bake_count);
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.product_cost_readiness(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.product_cost_readiness(date) TO service_role;
CREATE FUNCTION bunbun_accounting.guard_product_cost_close() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.status='CLOSED' AND OLD.status<>'CLOSED' AND (bunbun_accounting.product_cost_readiness(NEW.month_start)->>'productCostsComplete')::boolean IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Product cost movements require reconciliation before close'; END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.guard_product_cost_close() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.guard_product_cost_close() TO service_role;
CREATE TRIGGER zz_guard_accounting_product_cost_close BEFORE UPDATE ON bunbun_accounting.periods FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_product_cost_close();
CREATE OR REPLACE FUNCTION public.accounting_revenue_service(p_action text,p_payload jsonb,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE base jsonb; readiness jsonb;
BEGIN
 base:=bunbun_accounting.process_revenue(p_action,p_payload,p_actor_id);
 IF p_action='cost_readiness' THEN
   readiness:=bunbun_accounting.product_cost_readiness((p_payload->>'month'||'-01')::date);
   base:=base||readiness||jsonb_build_object('soldCostsComplete',coalesce((base->>'soldCostsComplete')::boolean,false) AND (readiness->>'productCostsComplete')::boolean);
 END IF;
 RETURN base;
END $fn$;
COMMIT;
