-- Isolated staging pkgrqalpazhwdcxmthvb only. No real opening/business data.
BEGIN;
INSERT INTO bunbun_accounting.accounts(code,name,kind) VALUES('1290','Biaya Produksi Belum Dialokasikan','ASSET');
CREATE TABLE bunbun_accounting.production_cost_sources (
 expense_id bigint PRIMARY KEY REFERENCES public.expenses(id),
 cost_kind text NOT NULL CHECK(cost_kind IN('LABOR','OVERHEAD')),
 cash_account text NOT NULL CHECK(cash_account IN('1010','1020')),
 amount numeric(18,2) NOT NULL CHECK(amount>0),
 source_snapshot jsonb NOT NULL,
 journal_id uuid NOT NULL UNIQUE REFERENCES bunbun_accounting.journals(id),
 evidence_ref text NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id)
);
CREATE TABLE bunbun_accounting.production_cost_allocations (
 expense_id bigint NOT NULL REFERENCES bunbun_accounting.production_cost_sources(expense_id),
 batch_id bigint NOT NULL REFERENCES public.production_batches(id),
 allocation_date date NOT NULL, amount numeric(18,2) NOT NULL CHECK(amount>0),
 journal_id uuid NOT NULL UNIQUE REFERENCES bunbun_accounting.journals(id),
 operation_key uuid NOT NULL UNIQUE, evidence_ref text NOT NULL,
 PRIMARY KEY(expense_id,batch_id)
);
CREATE INDEX production_allocations_batch ON bunbun_accounting.production_cost_allocations(batch_id);
CREATE TABLE bunbun_accounting.production_completions (
 batch_id bigint PRIMARY KEY REFERENCES public.production_batches(id),
 completion_date date NOT NULL, material_cost numeric(18,2) NOT NULL,
 labor_cost numeric(18,2) NOT NULL, overhead_cost numeric(18,2) NOT NULL,
 reject_cost numeric(18,2) NOT NULL, total_cost numeric(18,2) NOT NULL CHECK(total_cost>0),
 loss_policy text NOT NULL CHECK(loss_policy IN('ABSORB_NORMAL_LOSS','SEPARATE_ABNORMAL_LOSS')),
 journal_id uuid NOT NULL UNIQUE REFERENCES bunbun_accounting.journals(id),
 source_snapshot text NOT NULL, evidence_ref text NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id)
);
CREATE TABLE bunbun_accounting.production_lot_values (
 split_id bigint PRIMARY KEY REFERENCES public.production_batch_splits(id),
 batch_id bigint NOT NULL REFERENCES bunbun_accounting.production_completions(batch_id),
 product_id bigint NOT NULL REFERENCES public.products(id),
 source_movement_id bigint NOT NULL UNIQUE REFERENCES public.product_stock_movements(id),
 initial_location text NOT NULL CHECK(initial_location IN('FINISHED','FROZEN')),
 quantity integer NOT NULL CHECK(quantity>0), actual_value numeric(18,2) NOT NULL CHECK(actual_value>0)
);
CREATE INDEX production_lot_values_batch ON bunbun_accounting.production_lot_values(batch_id);
CREATE TABLE bunbun_accounting.production_cost_operations (
 operation_key uuid PRIMARY KEY, request jsonb NOT NULL, result jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bunbun_accounting.production_cost_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.production_cost_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.production_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.production_lot_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.production_cost_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bunbun_accounting.production_cost_sources,bunbun_accounting.production_cost_allocations,
 bunbun_accounting.production_completions,bunbun_accounting.production_lot_values,bunbun_accounting.production_cost_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON bunbun_accounting.production_cost_sources,bunbun_accounting.production_cost_allocations,
 bunbun_accounting.production_completions,bunbun_accounting.production_lot_values,bunbun_accounting.production_cost_operations TO service_role;

CREATE FUNCTION bunbun_accounting.guard_production_expense() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF TG_TABLE_NAME='expenses' THEN
   IF EXISTS(SELECT 1 FROM bunbun_accounting.production_cost_sources WHERE expense_id=OLD.id)
   THEN RAISE EXCEPTION 'Allocated production expense is immutable; reviewed correction required'; END IF;
 ELSE
   PERFORM 1 FROM public.expenses WHERE id=NEW.expense_id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM bunbun_accounting.production_cost_sources WHERE expense_id=NEW.expense_id)
   THEN RAISE EXCEPTION 'Production expense cannot also become a period expense'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.guard_production_expense() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_accounting_production_expense BEFORE UPDATE OR DELETE ON public.expenses
 FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_production_expense();
CREATE TRIGGER guard_accounting_production_period_overlap BEFORE INSERT OR UPDATE ON bunbun_accounting.expense_postings
 FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_production_expense();

CREATE FUNCTION bunbun_accounting.guard_valued_production_output() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE bid bigint; sid bigint; incoming boolean;
BEGIN
 IF TG_TABLE_NAME='production_batch_splits' THEN
   FOR bid IN SELECT DISTINCT x FROM unnest(ARRAY[CASE WHEN TG_OP<>'INSERT' THEN OLD.production_batch_id END,
     CASE WHEN TG_OP<>'DELETE' THEN NEW.production_batch_id END]) x WHERE x IS NOT NULL ORDER BY x LOOP
     PERFORM 1 FROM public.production_batches WHERE id=bid FOR UPDATE;
     IF EXISTS(SELECT 1 FROM bunbun_accounting.production_completions WHERE batch_id=bid)
       AND ((TG_OP<>'INSERT' AND OLD.source_split_id IS NULL) OR (TG_OP<>'DELETE' AND NEW.source_split_id IS NULL))
     THEN RAISE EXCEPTION 'Valued root production split is immutable'; END IF;
   END LOOP;
 ELSE
   FOR sid IN SELECT DISTINCT x FROM unnest(ARRAY[CASE WHEN TG_OP<>'INSERT' THEN OLD.batch_split_id END,
     CASE WHEN TG_OP<>'DELETE' THEN NEW.batch_split_id END]) x WHERE x IS NOT NULL ORDER BY x LOOP
     SELECT production_batch_id INTO bid FROM public.production_batch_splits WHERE id=sid AND source_split_id IS NULL;
     IF bid IS NOT NULL THEN
       PERFORM 1 FROM public.production_batches WHERE id=bid FOR UPDATE;
       incoming:=(TG_OP<>'INSERT' AND OLD.movement_type IN('FINISHED_IN','FROZEN_IN'))
         OR (TG_OP<>'DELETE' AND NEW.movement_type IN('FINISHED_IN','FROZEN_IN'));
       IF incoming AND EXISTS(SELECT 1 FROM bunbun_accounting.production_completions WHERE batch_id=bid)
       THEN RAISE EXCEPTION 'Valued production receipt is immutable'; END IF;
     END IF;
   END LOOP;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.guard_valued_production_output() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_accounting_valued_split BEFORE INSERT OR UPDATE OR DELETE ON public.production_batch_splits
 FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_valued_production_output();
CREATE TRIGGER guard_accounting_valued_output BEFORE INSERT OR UPDATE OR DELETE ON public.product_stock_movements
 FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_valued_production_output();

CREATE FUNCTION bunbun_accounting.guard_production_period_close() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.status='CLOSED' AND OLD.status<>'CLOSED' THEN
   IF EXISTS(SELECT 1 FROM bunbun_accounting.production_cost_sources s JOIN public.expenses e ON e.id=s.expense_id
     WHERE e.tanggal<NEW.month_start+interval '1 month' AND s.amount<>(SELECT coalesce(sum(a.amount),0)
       FROM bunbun_accounting.production_cost_allocations a WHERE a.expense_id=s.expense_id AND a.allocation_date<NEW.month_start+interval '1 month'))
   OR EXISTS(SELECT 1 FROM bunbun_accounting.material_postings m LEFT JOIN bunbun_accounting.production_completions c ON c.batch_id=m.batch_id
     WHERE m.transaction_date<NEW.month_start+interval '1 month' AND (c.batch_id IS NULL OR c.completion_date>=NEW.month_start+interval '1 month'))
   THEN RAISE EXCEPTION 'Production costs or completed batch valuation require reconciliation before close'; END IF;
 END IF; RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.guard_production_period_close() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.guard_production_period_close() TO service_role;
CREATE TRIGGER guard_accounting_production_close BEFORE UPDATE ON bunbun_accounting.periods
 FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_production_period_close();

CREATE FUNCTION bunbun_accounting.process_production_cost(p_action text,p_payload jsonb,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE e public.expenses%rowtype; b public.production_batches%rowtype; src bunbun_accounting.production_cost_sources%rowtype;
 op bunbun_accounting.production_cost_operations%rowtype; sp public.production_batch_splits%rowtype; mv public.product_stock_movements%rowtype;
 mp bunbun_accounting.material_postings%rowtype; req jsonb; snap text; pieces jsonb; roots jsonb:='[]'; blockers jsonb:='[]'; summary jsonb; result jsonb;
 is_cost boolean; is_post boolean; ready boolean; allocation_date date; pid uuid; ep uuid; jid uuid:=gen_random_uuid(); payment_jid uuid:=gen_random_uuid();
 amount numeric; allocated numeric; material numeric; labor numeric; overhead numeric; total numeric; loss numeric; lot_sum numeric:=0;
 latest date; q integer; n integer; ln integer:=0; reject_qty integer:=0; entry jsonb; value numeric; receipt_date date;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Private backend required'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND role::text='owner' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Owner approval required'; END IF;
 IF p_action='inspect_batch' THEN
   SELECT * INTO b FROM public.production_batches WHERE id=(p_payload->>'batchId')::bigint AND NOT is_deleted;
   IF NOT FOUND THEN RETURN NULL; END IF;
   SELECT coalesce(sum(actual_cost),0) INTO material FROM bunbun_accounting.material_postings WHERE batch_id=b.id;
   SELECT coalesce(sum(a.amount) FILTER(WHERE s.cost_kind='LABOR'),0),coalesce(sum(a.amount) FILTER(WHERE s.cost_kind='OVERHEAD'),0)
     INTO labor,overhead FROM bunbun_accounting.production_cost_allocations a JOIN bunbun_accounting.production_cost_sources s ON s.expense_id=a.expense_id WHERE a.batch_id=b.id;
   SELECT coalesce(jsonb_agg(jsonb_build_object('splitId',id::text,'productId',product_id::text,'route',route,
     'quantity',CASE WHEN route='DIRECT' THEN baked_good_qty ELSE qty END) ORDER BY id),'[]') INTO roots
     FROM public.production_batch_splits WHERE production_batch_id=b.id AND source_split_id IS NULL AND NOT is_deleted AND route IN('DIRECT','FROZEN');
   RETURN jsonb_build_object('batchId',b.id::text,'batchCode',b.kode,'materialCost',material::text,'laborCost',labor::text,
     'overheadCost',overhead::text,'totalCost',(material+labor+overhead)::text,'roots',roots,
     'completed',EXISTS(SELECT 1 FROM bunbun_accounting.production_completions WHERE batch_id=b.id),
     'valuedLots',(SELECT coalesce(jsonb_agg(jsonb_build_object('splitId',v.split_id::text,'location',v.initial_location,'quantity',v.quantity,
       'actualValue',v.actual_value::text,'unitValue',round(v.actual_value/v.quantity,6)::text) ORDER BY v.split_id),'[]')
       FROM bunbun_accounting.production_lot_values v WHERE v.batch_id=b.id),'actualProfitAvailable',false);
 END IF;
 IF p_action NOT IN('review_cost','post_cost','review_completion','post_completion') OR p_action IS NULL
 THEN RAISE EXCEPTION 'Unsupported production cost action'; END IF;
 is_cost:=p_action IN('review_cost','post_cost'); is_post:=p_action IN('post_cost','post_completion');
 req:=p_payload||jsonb_build_object('actorId',p_actor_id);
 IF is_post THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(p_payload->>'operationKey',0));
   SELECT * INTO op FROM bunbun_accounting.production_cost_operations WHERE operation_key=(p_payload->>'operationKey')::uuid;
   IF FOUND THEN
     IF op.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'Production operation reused with different request'; END IF;
     RETURN op.result||jsonb_build_object('alreadyProcessed',true);
   END IF;
 END IF;
 IF is_cost THEN
   SELECT * INTO e FROM public.expenses WHERE id=(p_payload->>'expenseId')::bigint FOR UPDATE;
   IF NOT FOUND THEN RETURN NULL; END IF;
   IF e.is_deleted OR e.purchase_id IS NOT NULL OR e.nominal<=0 OR e.nominal::text IN('NaN','Infinity','-Infinity')
   THEN RAISE EXCEPTION 'Separate paid production expense source required'; END IF;
 END IF;
 SELECT * INTO b FROM public.production_batches WHERE id=(p_payload->>'batchId')::bigint FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF b.is_deleted OR b.status<>'Finished' OR b.inventory_consumed IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Finished source batch required'; END IF;
 IF EXISTS(SELECT 1 FROM bunbun_accounting.production_completions WHERE batch_id=b.id)
 THEN RAISE EXCEPTION 'Batch production cost already completed'; END IF;
 allocation_date:=(p_payload->>'date')::date;
 SELECT id INTO pid FROM bunbun_accounting.periods WHERE month_start=date_trunc('month',allocation_date)::date;
 ready:=allocation_date IS NOT NULL AND (b.created_at AT TIME ZONE 'Asia/Jakarta')::date<=allocation_date
   AND EXISTS(SELECT 1 FROM bunbun_accounting.periods WHERE id=pid AND status='OPEN')
   AND EXISTS(SELECT 1 FROM bunbun_accounting.journals WHERE source_type='OPENING' AND status='POSTED'
     AND posting_date<=allocation_date AND posting_date<=(b.created_at AT TIME ZONE 'Asia/Jakarta')::date);
 IF NOT coalesce(ready,false) THEN blockers:=blockers||'"Saldo awal/periode atau tanggal batch belum siap."'::jsonb; END IF;
 IF is_cost THEN
   IF p_payload->>'costKind' NOT IN('LABOR','OVERHEAD') OR p_payload->>'costKind' IS NULL
     OR p_payload->>'cashAccount' NOT IN('1010','1020') OR p_payload->>'cashAccount' IS NULL
     OR p_payload->'productionConfirmed' IS DISTINCT FROM 'true'::jsonb
   THEN RAISE EXCEPTION 'Full production purpose and cash account must be confirmed'; END IF;
   IF (p_payload->>'costKind'='LABOR' AND e.kategori<>'Gaji') OR (p_payload->>'costKind'='OVERHEAD' AND e.kategori NOT IN('Utilitas','Sewa','Maintenance','Operasional Lain'))
   THEN RAISE EXCEPTION 'Expense category is not supported by production cost classification'; END IF;
   amount:=(p_payload->>'amount')::numeric;
   IF amount IS NULL OR amount<=0 OR amount::text IN('NaN','Infinity','-Infinity') OR amount<>round(amount,2)
   THEN RAISE EXCEPTION 'Positive exact production allocation required'; END IF;
   SELECT * INTO src FROM bunbun_accounting.production_cost_sources WHERE expense_id=e.id;
   SELECT coalesce(sum(a.amount),0),coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.batch_id),'[]') INTO allocated,pieces
     FROM bunbun_accounting.production_cost_allocations a WHERE a.expense_id=e.id;
   IF EXISTS(SELECT 1 FROM bunbun_accounting.expense_postings WHERE expense_id=e.id)
   THEN blockers:=blockers||'"Pengeluaran sudah menjadi biaya periode; koreksi klasifikasi diperlukan."'::jsonb; END IF;
   IF src.expense_id IS NOT NULL AND (src.source_snapshot IS DISTINCT FROM to_jsonb(e) OR src.cost_kind<>p_payload->>'costKind' OR src.cash_account<>p_payload->>'cashAccount')
   THEN blockers:=blockers||'"Sumber atau klasifikasi biaya produksi berubah."'::jsonb; END IF;
   IF EXISTS(SELECT 1 FROM bunbun_accounting.production_cost_allocations WHERE expense_id=e.id AND batch_id=b.id)
     OR amount>e.nominal-allocated OR allocation_date<e.tanggal
   THEN blockers:=blockers||'"Alokasi duplikat, melebihi sisa biaya, atau mendahului bukti pembayaran."'::jsonb; END IF;
   SELECT id INTO ep FROM bunbun_accounting.periods WHERE month_start=date_trunc('month',e.tanggal)::date;
   IF src.expense_id IS NULL AND (NOT EXISTS(SELECT 1 FROM bunbun_accounting.periods WHERE id=ep AND status='OPEN')
     OR NOT EXISTS(SELECT 1 FROM bunbun_accounting.journals WHERE source_type='OPENING' AND status='POSTED' AND posting_date<=e.tanggal))
   THEN blockers:=blockers||'"Periode pembayaran atau saldo awal belum siap."'::jsonb; END IF;
   snap:=encode(sha256(convert_to(jsonb_build_object('expense',to_jsonb(e),'batch',to_jsonb(b),'source',to_jsonb(src),'allocations',pieces)::text,'UTF8')),'hex');
   summary:=jsonb_build_object('expenseId',e.id::text,'batchId',b.id::text,'batchCode',b.kode,'expenseAmount',e.nominal::text,
     'remainingBefore', (e.nominal-allocated)::text,'allocationAmount',amount::text,'remainingAfter',(e.nominal-allocated-amount)::text,
     'costKind',p_payload->>'costKind','date',allocation_date);
 ELSE
   IF p_payload->'allCostsConfirmed' IS DISTINCT FROM 'true'::jsonb OR p_payload->>'lossPolicy' IS NULL
     OR p_payload->>'lossPolicy' NOT IN('ABSORB_NORMAL_LOSS','SEPARATE_ABNORMAL_LOSS')
     OR jsonb_typeof(p_payload->'lotCosts') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_payload->'lotCosts') NOT BETWEEN 1 AND 50
   THEN RAISE EXCEPTION 'Verified complete costs, loss policy and root allocations required'; END IF;
   loss:=(p_payload->>'rejectCost')::numeric;
   IF loss IS NULL OR loss<0 OR loss::text IN('NaN','Infinity','-Infinity') OR loss<>round(loss,2)
   THEN RAISE EXCEPTION 'Exact nonnegative reject cost required'; END IF;
   SELECT coalesce(sum(actual_cost),0),max(transaction_date) INTO material,latest FROM bunbun_accounting.material_postings WHERE batch_id=b.id;
   IF material<=0 OR EXISTS(SELECT 1 FROM public.inventory_transactions x LEFT JOIN bunbun_accounting.material_postings m ON m.transaction_id=x.id
     WHERE x.production_batch_id=b.id AND NOT x.is_deleted AND x.transaction_type='PRODUCTION_OUT' AND m.transaction_id IS NULL)
   THEN blockers:=blockers||'"Semua catatan pemakaian bahan harus selesai dinilai."'::jsonb; END IF;
   SELECT coalesce(sum(a.amount) FILTER(WHERE s.cost_kind='LABOR'),0),coalesce(sum(a.amount) FILTER(WHERE s.cost_kind='OVERHEAD'),0),
     greatest(latest,max(a.allocation_date)) INTO labor,overhead,latest
     FROM bunbun_accounting.production_cost_allocations a JOIN bunbun_accounting.production_cost_sources s ON s.expense_id=a.expense_id WHERE a.batch_id=b.id;
   IF (labor=0 AND p_payload->'zeroLaborConfirmed' IS DISTINCT FROM 'true'::jsonb)
     OR (overhead=0 AND p_payload->'zeroOverheadConfirmed' IS DISTINCT FROM 'true'::jsonb)
   THEN blockers:=blockers||'"Tenaga kerja/overhead yang bernilai nol harus dinyatakan dan dibuktikan secara eksplisit."'::jsonb; END IF;
   total:=material+labor+overhead;
   FOR sp IN SELECT * FROM public.production_batch_splits WHERE production_batch_id=b.id AND source_split_id IS NULL ORDER BY id FOR UPDATE LOOP
     IF sp.is_deleted OR sp.route NOT IN('DIRECT','FROZEN','REJECT') OR sp.qty<=0
     THEN RAISE EXCEPTION 'Active root production outputs required'; END IF;
     IF sp.route='REJECT' THEN
       IF EXISTS(SELECT 1 FROM public.product_stock_movements WHERE batch_split_id=sp.id AND movement_type IN('FINISHED_IN','FROZEN_IN') AND NOT is_deleted)
       THEN RAISE EXCEPTION 'Reject root cannot produce usable inventory'; END IF;
       reject_qty:=reject_qty+sp.qty; CONTINUE;
     END IF;
     IF sp.route='DIRECT' AND (sp.baked_good_qty+sp.baked_reject_qty<>sp.qty OR sp.baked_reject_qty<0)
     THEN RAISE EXCEPTION 'Direct output yield must reconcile good and rejected units'; END IF;
     q:=CASE WHEN sp.route='DIRECT' THEN sp.baked_good_qty ELSE sp.qty END;
     IF q<=0 THEN RAISE EXCEPTION 'Positive usable output required'; END IF;
     IF sp.route='DIRECT' THEN reject_qty:=reject_qty+sp.baked_reject_qty; END IF;
     SELECT count(*) INTO n FROM public.product_stock_movements WHERE batch_split_id=sp.id AND movement_type IN('FINISHED_IN','FROZEN_IN') AND NOT is_deleted;
     IF n<>1 THEN RAISE EXCEPTION 'Exactly one matching root stock receipt required'; END IF;
     SELECT * INTO mv FROM public.product_stock_movements WHERE batch_split_id=sp.id AND movement_type IN('FINISHED_IN','FROZEN_IN') AND NOT is_deleted;
     IF mv.product_id<>sp.product_id OR mv.qty<>q OR mv.movement_type<>(CASE WHEN sp.route='DIRECT' THEN 'FINISHED_IN' ELSE 'FROZEN_IN' END)
     THEN RAISE EXCEPTION 'Root stock receipt quantity/product mismatch'; END IF;
     latest:=greatest(latest,mv.movement_date);
     SELECT count(*),sum((x->>'amount')::numeric) INTO n,value FROM jsonb_array_elements(p_payload->'lotCosts') x WHERE (x->>'splitId')::bigint=sp.id;
     IF n<>1 OR value IS NULL OR value<=0 OR value::text IN('NaN','Infinity','-Infinity') OR value<>round(value,2)
     THEN RAISE EXCEPTION 'One positive exact actual cost per usable root split required'; END IF;
     lot_sum:=lot_sum+value;
     roots:=roots||jsonb_build_object('splitId',sp.id::text,'productId',sp.product_id::text,'sourceMovementId',mv.id::text,
       'location',CASE WHEN sp.route='DIRECT' THEN 'FINISHED' ELSE 'FROZEN' END,'quantity',q,'actualValue',value::text,'unitValue',round(value/q,6)::text);
   END LOOP;
   IF jsonb_array_length(roots)<>jsonb_array_length(p_payload->'lotCosts') OR jsonb_array_length(roots)=0 OR lot_sum+loss<>total
   THEN blockers:=blockers||'"Alokasi lot dan reject harus tepat sama dengan total biaya batch."'::jsonb; END IF;
   IF (p_payload->>'lossPolicy'='ABSORB_NORMAL_LOSS' AND loss<>0)
     OR (p_payload->>'lossPolicy'='SEPARATE_ABNORMAL_LOSS' AND (loss<=0 OR reject_qty<=0))
     OR allocation_date<latest
   THEN blockers:=blockers||'"Klasifikasi reject atau tanggal penyelesaian tidak cocok dengan sumber."'::jsonb; END IF;
   SELECT jsonb_build_object('batch',to_jsonb(b),'materials',(SELECT jsonb_agg(to_jsonb(m) ORDER BY transaction_id) FROM bunbun_accounting.material_postings m WHERE batch_id=b.id),
     'allocations',(SELECT jsonb_agg(to_jsonb(a) ORDER BY expense_id) FROM bunbun_accounting.production_cost_allocations a WHERE batch_id=b.id),
     'splits',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.production_batch_splits s WHERE production_batch_id=b.id AND source_split_id IS NULL),
     'receipts',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.product_stock_movements m JOIN public.production_batch_splits s ON s.id=m.batch_split_id
       WHERE s.production_batch_id=b.id AND s.source_split_id IS NULL AND m.movement_type IN('FINISHED_IN','FROZEN_IN')))
     INTO pieces;
   snap:=encode(sha256(convert_to(pieces::text,'UTF8')),'hex');
   summary:=jsonb_build_object('batchId',b.id::text,'batchCode',b.kode,'date',allocation_date,'materialCost',material::text,'laborCost',labor::text,
     'overheadCost',overhead::text,'totalCost',total::text,'rejectCost',loss::text,'rejectQuantity',reject_qty,'lots',roots);
 END IF;
 summary:=summary||jsonb_build_object('sourceSnapshot',snap,'mayConfirm',jsonb_array_length(blockers)=0,'blockers',blockers,'actualProfitAvailable',false);
 IF NOT is_post THEN RETURN summary; END IF;
 IF jsonb_array_length(blockers)>0 THEN RAISE EXCEPTION 'Production source/cost/period requires reconciliation'; END IF;
 IF p_payload->>'sourceSnapshot' IS DISTINCT FROM snap THEN RAISE EXCEPTION 'Production source or allocation balance changed since review'; END IF;
 IF p_payload->>'evidenceRef' IS NULL OR length(btrim(p_payload->>'evidenceRef')) NOT BETWEEN 6 AND 500
 THEN RAISE EXCEPTION 'Production cost evidence required'; END IF;
 PERFORM 1 FROM bunbun_accounting.periods WHERE id IN(pid,ep) ORDER BY month_start FOR UPDATE;
 IF is_cost THEN
   IF src.expense_id IS NULL THEN
     INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key,cash_flow_category,narrative,created_by)
       VALUES(payment_jid,ep,e.tanggal,'NORMAL','production-payment:'||e.id,gen_random_uuid(),'OPERATING',p_payload->>'evidenceRef',p_actor_id);
     INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit)
       VALUES(payment_jid,1,'1290',e.nominal,0),(payment_jid,2,p_payload->>'cashAccount',0,e.nominal);
     PERFORM bunbun_accounting.post_reviewed_journal(payment_jid,p_actor_id);
     INSERT INTO bunbun_accounting.production_cost_sources(expense_id,cost_kind,cash_account,amount,source_snapshot,journal_id,evidence_ref,actor_id)
       VALUES(e.id,p_payload->>'costKind',p_payload->>'cashAccount',e.nominal,to_jsonb(e),payment_jid,p_payload->>'evidenceRef',p_actor_id);
   END IF;
   INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key,narrative,created_by)
     VALUES(jid,pid,allocation_date,'NORMAL','production-allocation:'||e.id||':'||b.id,(p_payload->>'operationKey')::uuid,p_payload->>'evidenceRef',p_actor_id);
   INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit,batch_id)
     VALUES(jid,1,'1215',amount,0,b.id),(jid,2,'1290',0,amount,b.id);
   PERFORM bunbun_accounting.post_reviewed_journal(jid,p_actor_id);
   INSERT INTO bunbun_accounting.production_cost_allocations(expense_id,batch_id,allocation_date,amount,journal_id,operation_key,evidence_ref)
     VALUES(e.id,b.id,allocation_date,amount,jid,(p_payload->>'operationKey')::uuid,p_payload->>'evidenceRef');
 ELSE
   INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key,narrative,created_by)
     VALUES(jid,pid,allocation_date,'NORMAL','production-completion:'||b.id,(p_payload->>'operationKey')::uuid,p_payload->>'evidenceRef',p_actor_id);
   FOR entry IN SELECT * FROM jsonb_array_elements(roots) LOOP
     ln:=ln+1;
     INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit,product_id,batch_id)
       VALUES(jid,ln,CASE WHEN entry->>'location'='FINISHED' THEN '1220' ELSE '1230' END,(entry->>'actualValue')::numeric,0,(entry->>'productId')::bigint,b.id);
     INSERT INTO bunbun_accounting.stock_cost_movements(journal_id,source_key,product_id,batch_id,valuation_class,quantity_base,value_delta,base_unit)
       VALUES(jid,'production-lot:'||(entry->>'splitId'),(entry->>'productId')::bigint,b.id,entry->>'location',(entry->>'quantity')::numeric,(entry->>'actualValue')::numeric,'pcs');
   END LOOP;
   IF loss>0 THEN ln:=ln+1; INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit,batch_id)
     VALUES(jid,ln,'6070',loss,0,b.id); END IF;
   INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit,batch_id) VALUES(jid,ln+1,'1215',0,total,b.id);
   FOR mp IN SELECT * FROM bunbun_accounting.material_postings WHERE batch_id=b.id LOOP
     INSERT INTO bunbun_accounting.stock_cost_movements(journal_id,source_key,ingredient_id,batch_id,valuation_class,quantity_base,value_delta,base_unit)
       VALUES(jid,'production-wip-out:'||mp.transaction_id,mp.ingredient_id,b.id,'WIP',-mp.quantity_base,-mp.actual_cost,mp.base_unit);
   END LOOP;
   PERFORM bunbun_accounting.post_reviewed_journal(jid,p_actor_id);
   INSERT INTO bunbun_accounting.production_completions(batch_id,completion_date,material_cost,labor_cost,overhead_cost,reject_cost,total_cost,loss_policy,journal_id,source_snapshot,evidence_ref,actor_id)
     VALUES(b.id,allocation_date,material,labor,overhead,loss,total,p_payload->>'lossPolicy',jid,snap,p_payload->>'evidenceRef',p_actor_id);
   INSERT INTO bunbun_accounting.production_lot_values(split_id,batch_id,product_id,source_movement_id,initial_location,quantity,actual_value)
     SELECT (x->>'splitId')::bigint,b.id,(x->>'productId')::bigint,(x->>'sourceMovementId')::bigint,x->>'location',(x->>'quantity')::integer,(x->>'actualValue')::numeric
     FROM jsonb_array_elements(roots) x;
 END IF;
 result:=jsonb_build_object('journalId',jid,'batchId',b.id::text,'alreadyProcessed',false,'actualProfitAvailable',false);
 INSERT INTO bunbun_accounting.production_cost_operations(operation_key,request,result,actor_id) VALUES((p_payload->>'operationKey')::uuid,req,result,p_actor_id);
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.process_production_cost(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.process_production_cost(text,jsonb,uuid) TO service_role;
CREATE FUNCTION public.accounting_production_service(p_action text,p_payload jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT bunbun_accounting.process_production_cost(p_action,p_payload,p_actor_id);
$fn$;
REVOKE ALL ON FUNCTION public.accounting_production_service(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_production_service(text,jsonb,uuid) TO service_role;
COMMIT;
