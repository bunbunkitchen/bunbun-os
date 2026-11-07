-- ISOLATED STAGING pkgrqalpazhwdcxmthvb ONLY. No opening or business rows.
-- First actual-cost step: recorded material usage -> WIP. Not final product HPP.
BEGIN;
CREATE TABLE bunbun_accounting.material_postings (
 transaction_id bigint PRIMARY KEY REFERENCES public.inventory_transactions(id),
 ingredient_id bigint NOT NULL REFERENCES public.ingredients(id),
 batch_id bigint NOT NULL REFERENCES public.production_batches(id),
 transaction_date date NOT NULL,
 quantity_base numeric(20,6) NOT NULL CHECK(quantity_base>0),
 base_unit text NOT NULL CHECK(base_unit IN('g','ml','pcs')),
 actual_cost numeric(18,2) NOT NULL CHECK(actual_cost>0),
 journal_id uuid NOT NULL UNIQUE REFERENCES bunbun_accounting.journals(id),
 operation_key uuid NOT NULL UNIQUE,
 request jsonb NOT NULL,
 result jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX material_postings_ingredient_order ON bunbun_accounting.material_postings(ingredient_id,transaction_date,transaction_id);
CREATE INDEX material_ledger_pool_lookup ON bunbun_accounting.stock_cost_movements(ingredient_id,valuation_class);
CREATE INDEX material_source_order_lookup ON public.inventory_transactions(ingredient_id,transaction_date,id) WHERE NOT is_deleted;
ALTER TABLE bunbun_accounting.material_postings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bunbun_accounting.material_postings FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON bunbun_accounting.material_postings TO service_role;

-- Trigger-only private guards; all operational writers already lock ingredients.
CREATE FUNCTION bunbun_accounting.guard_material_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE x bigint; bid bigint; latest bunbun_accounting.material_postings%rowtype;
BEGIN
 IF TG_TABLE_NAME='production_batches' THEN
   IF EXISTS(SELECT 1 FROM bunbun_accounting.material_postings WHERE batch_id=OLD.id)
   THEN RAISE EXCEPTION 'Batch with valued material usage is immutable'; END IF;
 ELSE
   FOR x IN SELECT DISTINCT v FROM unnest(ARRAY[
     CASE WHEN TG_OP<>'INSERT' THEN OLD.ingredient_id END,
     CASE WHEN TG_OP<>'DELETE' THEN NEW.ingredient_id END]) v WHERE v IS NOT NULL ORDER BY v LOOP
     PERFORM 1 FROM public.ingredients WHERE id=x FOR UPDATE;
     SELECT * INTO latest FROM bunbun_accounting.material_postings WHERE ingredient_id=x
       ORDER BY transaction_date DESC,transaction_id DESC LIMIT 1;
     IF FOUND THEN
       IF TG_OP<>'INSERT' AND OLD.ingredient_id=x
         AND (OLD.transaction_date,OLD.id)<=(latest.transaction_date,latest.transaction_id)
       THEN RAISE EXCEPTION 'Valued material history is immutable; downstream revaluation required'; END IF;
       IF TG_OP<>'DELETE' AND NEW.ingredient_id=x AND NOT NEW.is_deleted
         AND (NEW.transaction_date,NEW.id)<=(latest.transaction_date,latest.transaction_id)
       THEN RAISE EXCEPTION 'Backdated material movement requires downstream revaluation'; END IF;
     END IF;
   END LOOP;
   -- Appending even a later material row to an already-valued batch is not a
   -- silent amendment of the approved production source.
   FOR bid IN SELECT DISTINCT v FROM unnest(ARRAY[
     CASE WHEN TG_OP<>'INSERT' THEN OLD.production_batch_id END,
     CASE WHEN TG_OP<>'DELETE' THEN NEW.production_batch_id END]) v WHERE v IS NOT NULL LOOP
     IF EXISTS(SELECT 1 FROM bunbun_accounting.material_postings WHERE batch_id=bid)
     THEN RAISE EXCEPTION 'Batch with valued material usage is immutable'; END IF;
   END LOOP;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.guard_material_history() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_accounting_material_history BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_transactions
 FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_material_history();
CREATE TRIGGER guard_accounting_material_batch BEFORE UPDATE OR DELETE ON public.production_batches
 FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_material_history();

-- Reject new/reversed/backdated raw values that would change a prior moving
-- average. Later same-day receipts are allowed only after the source ID order.
CREATE FUNCTION bunbun_accounting.assert_raw_cost_order(m bunbun_accounting.stock_cost_movements) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE latest bunbun_accounting.material_postings%rowtype; d date; receipt bigint;
BEGIN
 IF m.valuation_class<>'RAW' OR m.ingredient_id IS NULL THEN RETURN; END IF;
 PERFORM 1 FROM public.ingredients WHERE id=m.ingredient_id FOR UPDATE;
 SELECT * INTO latest FROM bunbun_accounting.material_postings WHERE ingredient_id=m.ingredient_id
   ORDER BY transaction_date DESC,transaction_id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT posting_date INTO d FROM bunbun_accounting.journals WHERE id=m.journal_id;
 IF m.source_key LIKE 'material-out:%' THEN
   IF d<latest.transaction_date THEN RAISE EXCEPTION 'Raw material valuation must follow source order'; END IF;
   RETURN;
 END IF;
 IF d<=latest.transaction_date THEN
   IF m.source_key ~ '^purchase:-?[0-9]+(:revision:[0-9]+)?$' THEN
     SELECT id INTO receipt FROM public.inventory_transactions
     WHERE purchase_id=split_part(m.source_key,':',2)::bigint AND NOT is_deleted;
   END IF;
   IF d<latest.transaction_date OR receipt IS NULL OR receipt<=latest.transaction_id
   THEN RAISE EXCEPTION 'Raw material change requires downstream cost revaluation'; END IF;
 END IF;
 RETURN;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.assert_raw_cost_order(bunbun_accounting.stock_cost_movements) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.assert_raw_cost_order(bunbun_accounting.stock_cost_movements) TO service_role;
CREATE FUNCTION bunbun_accounting.guard_raw_cost_order() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE m bunbun_accounting.stock_cost_movements%rowtype;
BEGIN
 IF TG_TABLE_NAME='journals' THEN
   IF NEW.status='POSTED' AND OLD.status<>'POSTED' THEN
     IF EXISTS(SELECT 1 FROM bunbun_accounting.material_postings WHERE journal_id=NEW.reversal_of)
     THEN RAISE EXCEPTION 'Material reversal requires downstream cost revaluation'; END IF;
     FOR m IN SELECT * FROM bunbun_accounting.stock_cost_movements WHERE journal_id=NEW.id LOOP
       PERFORM bunbun_accounting.assert_raw_cost_order(m);
     END LOOP;
   END IF;
 ELSE
   IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM bunbun_accounting.journals WHERE id=OLD.journal_id AND status='POSTED')
   THEN RAISE EXCEPTION 'Posted stock costs are immutable'; END IF;
   IF TG_OP='DELETE' THEN RETURN OLD; END IF;
   PERFORM bunbun_accounting.assert_raw_cost_order(NEW);
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.guard_raw_cost_order() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.guard_raw_cost_order() TO service_role;
CREATE TRIGGER guard_accounting_raw_cost_order BEFORE INSERT OR UPDATE OR DELETE ON bunbun_accounting.stock_cost_movements
 FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_raw_cost_order();
CREATE TRIGGER guard_accounting_raw_journal_order BEFORE UPDATE ON bunbun_accounting.journals
 FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_raw_cost_order();

CREATE FUNCTION bunbun_accounting.process_material_wip(p_action text,p_payload jsonb,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE r public.inventory_transactions%rowtype; b public.production_batches%rowtype;
 old bunbun_accounting.material_postings%rowtype; pid uuid; cutover date; base text; factor numeric; qty numeric;
 pool_qty numeric; pool_value numeric; cost numeric; snapshot text; prior jsonb; pool jsonb; ready boolean;
 journal uuid:=gen_random_uuid(); result jsonb; req jsonb; blockers jsonb:='[]';
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Private backend required'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND role::text='owner' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Owner approval required'; END IF;
 IF p_action NOT IN('review','post') OR p_action IS NULL THEN RAISE EXCEPTION 'Unsupported material action'; END IF;
 SELECT * INTO r FROM public.inventory_transactions WHERE id=(p_payload->>'transactionId')::bigint FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF r.is_deleted OR r.transaction_type<>'PRODUCTION_OUT' OR r.ingredient_id IS NULL OR r.maintenance_item_id IS NOT NULL
 OR r.production_batch_id IS NULL OR r.qty<=0 OR r.qty::text IN('NaN','Infinity','-Infinity')
 THEN RAISE EXCEPTION 'Recorded positive production material usage required'; END IF;
 PERFORM 1 FROM public.ingredients WHERE id=r.ingredient_id FOR UPDATE;
 SELECT * INTO b FROM public.production_batches WHERE id=r.production_batch_id FOR UPDATE;
 IF NOT FOUND OR b.is_deleted OR b.status<>'Finished' OR b.inventory_consumed IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Finished batch with recorded material consumption required'; END IF;
 SELECT * INTO old FROM bunbun_accounting.material_postings WHERE transaction_id=r.id;
 req:=p_payload||jsonb_build_object('actorId',p_actor_id);
 IF FOUND THEN
   IF p_action='review' THEN RETURN jsonb_build_object('posted',true,'result',old.result,'actualProfitAvailable',false); END IF;
   IF old.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'Material operation reused with different request'; END IF;
   RETURN old.result||jsonb_build_object('alreadyProcessed',true);
 END IF;
 CASE lower(btrim(r.unit))
 WHEN 'kg' THEN base:='g';factor:=1000;
 WHEN 'g' THEN base:='g';factor:=1;
 WHEN 'gr' THEN base:='g';factor:=1;
 WHEN 'gram' THEN base:='g';factor:=1;
 WHEN 'l' THEN base:='ml';factor:=1000;
 WHEN 'liter' THEN base:='ml';factor:=1000;
 WHEN 'ml' THEN base:='ml';factor:=1;
 WHEN 'pc' THEN base:='pcs';factor:=1;
 WHEN 'pcs' THEN base:='pcs';factor:=1;
 ELSE RAISE EXCEPTION 'Unsupported material base unit'; END CASE;
 qty:=r.qty*factor;
 SELECT min(cutover_on) INTO cutover FROM bunbun_accounting.opening_snapshots WHERE status='APPROVED';
 SELECT id INTO pid FROM bunbun_accounting.periods WHERE month_start=date_trunc('month',r.transaction_date)::date FOR UPDATE;
 ready:=pid IS NOT NULL AND cutover IS NOT NULL AND r.transaction_date>=cutover
   AND (b.created_at AT TIME ZONE 'Asia/Jakarta')::date>=cutover
   AND EXISTS(SELECT 1 FROM bunbun_accounting.periods WHERE id=pid AND status='OPEN')
   AND EXISTS(SELECT 1 FROM bunbun_accounting.journals WHERE source_type='OPENING' AND status='POSTED' AND posting_date=cutover);
 IF NOT coalesce(ready,false) THEN blockers:=blockers||'"Saldo awal/periode belum siap atau batch berasal dari sebelum saldo awal."'::jsonb; END IF;
 -- A prior unvalued physical mutation cannot disappear from weighted costing.
 IF cutover IS NOT NULL AND EXISTS(SELECT 1 FROM public.inventory_transactions x
   LEFT JOIN bunbun_accounting.material_postings v ON v.transaction_id=x.id
   LEFT JOIN bunbun_accounting.purchase_postings p ON p.receipt_id=x.id
   WHERE x.ingredient_id=r.ingredient_id AND NOT x.is_deleted AND x.transaction_date>=cutover
   AND (x.transaction_date,x.id)<(r.transaction_date,r.id)
   AND NOT ((x.transaction_type='PRODUCTION_OUT' AND v.transaction_id IS NOT NULL)
     OR (x.transaction_type='PURCHASE' AND p.purchase_id IS NOT NULL)))
 THEN blockers:=blockers||'"Ada pembelian, pemakaian, atau penyesuaian sebelumnya yang belum dinilai."'::jsonb; END IF;
 -- No later pool may be pulled backwards into the current average.
 IF EXISTS(SELECT 1 FROM bunbun_accounting.material_postings WHERE ingredient_id=r.ingredient_id
   AND (transaction_date,transaction_id)>(r.transaction_date,r.id))
 OR EXISTS(SELECT 1 FROM bunbun_accounting.stock_cost_movements m JOIN bunbun_accounting.journals j ON j.id=m.journal_id
   WHERE m.ingredient_id=r.ingredient_id AND m.valuation_class='RAW' AND j.status='POSTED' AND j.posting_date>r.transaction_date)
 OR EXISTS(SELECT 1 FROM bunbun_accounting.purchase_postings p JOIN public.inventory_transactions x ON x.id=p.receipt_id
   WHERE x.ingredient_id=r.ingredient_id AND (x.transaction_date,x.id)>(r.transaction_date,r.id))
 THEN blockers:=blockers||'"Nilai bahan yang lebih baru sudah tercatat; rekonsiliasi urutan diperlukan."'::jsonb; END IF;
 SELECT coalesce(sum(m.quantity_base),0),coalesce(sum(m.value_delta),0),
   coalesce(jsonb_agg(jsonb_build_object('id',m.id,'journal',j.id,'date',j.posting_date,'qty',m.quantity_base::text,
     'value',m.value_delta::text,'unit',m.base_unit) ORDER BY m.id),'[]') INTO pool_qty,pool_value,pool
 FROM bunbun_accounting.stock_cost_movements m JOIN bunbun_accounting.journals j ON j.id=m.journal_id
 WHERE m.ingredient_id=r.ingredient_id AND m.valuation_class='RAW' AND j.status='POSTED';
 IF EXISTS(SELECT 1 FROM bunbun_accounting.stock_cost_movements m JOIN bunbun_accounting.journals j ON j.id=m.journal_id
   WHERE m.ingredient_id=r.ingredient_id AND m.valuation_class='RAW' AND j.status='POSTED' AND m.base_unit<>base)
 OR pool_qty<qty OR pool_value<=0 OR pool_qty::text IN('NaN','Infinity','-Infinity')
 OR pool_value::text IN('NaN','Infinity','-Infinity')
 THEN blockers:=blockers||'"Jumlah, satuan, atau nilai bahan yang dibuktikan belum cukup."'::jsonb; END IF;
 cost:=CASE WHEN pool_qty>0 AND pool_qty::text NOT IN('NaN','Infinity','-Infinity')
   AND pool_value::text NOT IN('NaN','Infinity','-Infinity')
   THEN CASE WHEN qty=pool_qty THEN pool_value ELSE trunc(pool_value*qty/pool_qty,2) END END;
 IF cost IS NULL OR cost<=0 THEN blockers:=blockers||'"Biaya pemakaian belum dapat dihitung dalam presisi sen."'::jsonb; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.transaction_date,x.id),'[]') INTO prior
 FROM public.inventory_transactions x WHERE x.ingredient_id=r.ingredient_id AND NOT x.is_deleted
 AND x.transaction_date>=cutover AND (x.transaction_date,x.id)<=(r.transaction_date,r.id);
 -- PostgreSQL core SHA-256 keeps the review bounded without truncating history.
 snapshot:=jsonb_build_object('source',to_jsonb(r),'batch',to_jsonb(b),
   'priorDigest',encode(sha256(convert_to(prior::text,'UTF8')),'hex'),
   'poolDigest',encode(sha256(convert_to(pool::text,'UTF8')),'hex'),'cutover',cutover)::text;
 IF octet_length(snapshot)>24000 THEN blockers:=blockers||'"Riwayat terlalu besar untuk pemeriksaan ini; rekonsiliasi backend diperlukan."'::jsonb; END IF;
 result:=jsonb_build_object('transactionId',r.id::text,'batchId',b.id::text,'batchCode',b.kode,'date',r.transaction_date,
   'ingredientId',r.ingredient_id::text,'quantity',qty::text,'unit',base,'poolQuantity',pool_qty::text,'poolValue',pool_value::text,
   'actualMaterialCost',cost::text,'sourceSnapshot',snapshot,'mayConfirm',jsonb_array_length(blockers)=0,
   'blockers',blockers,'posted',false,'actualProfitAvailable',false,'completeProductCost',false);
 IF p_action='review' THEN RETURN result; END IF;
 IF jsonb_array_length(blockers)>0 THEN RAISE EXCEPTION 'Material source/order/opening requires reconciliation'; END IF;
 IF p_payload->>'sourceSnapshot' IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'Material source or cost pool changed since review'; END IF;
 IF p_payload->'usageConfirmed' IS DISTINCT FROM 'true'::jsonb OR length(btrim(p_payload->>'evidenceRef')) NOT BETWEEN 6 AND 500
 OR p_payload->>'evidenceRef' IS NULL OR p_payload->>'operationKey' IS NULL
 THEN RAISE EXCEPTION 'Verified material usage, evidence and operation required'; END IF;
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key,narrative,created_by)
 VALUES(journal,pid,r.transaction_date,'NORMAL','material-usage:'||r.id,(p_payload->>'operationKey')::uuid,btrim(p_payload->>'evidenceRef'),p_actor_id);
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit,ingredient_id,batch_id)
 VALUES(journal,1,'1215',cost,0,r.ingredient_id,b.id),(journal,2,'1210',0,cost,r.ingredient_id,b.id);
 INSERT INTO bunbun_accounting.stock_cost_movements(journal_id,source_key,ingredient_id,batch_id,valuation_class,quantity_base,value_delta,base_unit)
 VALUES(journal,'material-out:'||r.id,r.ingredient_id,b.id,'RAW',-qty,-cost,base),
       (journal,'material-wip:'||r.id,r.ingredient_id,b.id,'WIP',qty,cost,base);
 PERFORM bunbun_accounting.post_reviewed_journal(journal,p_actor_id);
 result:=jsonb_build_object('transactionId',r.id::text,'journalId',journal,'actualMaterialCost',cost::text,
   'alreadyProcessed',false,'actualProfitAvailable',false,'completeProductCost',false);
 INSERT INTO bunbun_accounting.material_postings(transaction_id,ingredient_id,batch_id,transaction_date,quantity_base,
   base_unit,actual_cost,journal_id,operation_key,request,result,actor_id)
 VALUES(r.id,r.ingredient_id,b.id,r.transaction_date,qty,base,cost,journal,(p_payload->>'operationKey')::uuid,req,result,p_actor_id);
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.process_material_wip(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.process_material_wip(text,jsonb,uuid) TO service_role;
CREATE FUNCTION public.accounting_material_service(p_action text,p_payload jsonb,p_actor_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT bunbun_accounting.process_material_wip(p_action,p_payload,p_actor_id);
$fn$;
REVOKE ALL ON FUNCTION public.accounting_material_service(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_material_service(text,jsonb,uuid) TO service_role;
COMMIT;
