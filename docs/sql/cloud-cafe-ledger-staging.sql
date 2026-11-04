-- Isolated staging only. Actual sold report -> net receivable, then actual net receipt.
BEGIN;
CREATE TABLE bunbun_accounting.cafe_ledger_imports (
 report_id uuid PRIMARY KEY REFERENCES bunbun_accounting.cafe_reports(id), mode text NOT NULL CHECK(mode IN('CREATE','LINK')),
 operation_key uuid NOT NULL UNIQUE, request jsonb NOT NULL, result jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bunbun_accounting.cafe_ledger_sales (
 sale_id bigint PRIMARY KEY REFERENCES bunbun_accounting.sale_postings(sale_id), report_id uuid NOT NULL REFERENCES bunbun_accounting.cafe_ledger_imports(report_id)
);
CREATE INDEX cafe_ledger_sales_report ON bunbun_accounting.cafe_ledger_sales(report_id);
CREATE TABLE bunbun_accounting.cafe_ledger_receipts (
 income_id bigint PRIMARY KEY REFERENCES bunbun_accounting.income_postings(income_id),
 operation_key uuid NOT NULL UNIQUE, request jsonb NOT NULL, result jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bunbun_accounting.cafe_ledger_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.cafe_ledger_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.cafe_ledger_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bunbun_accounting.cafe_ledger_imports,bunbun_accounting.cafe_ledger_sales,bunbun_accounting.cafe_ledger_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON bunbun_accounting.cafe_ledger_imports,bunbun_accounting.cafe_ledger_sales,bunbun_accounting.cafe_ledger_receipts TO service_role;

CREATE FUNCTION bunbun_accounting.guard_cafe_ledger_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF TG_TABLE_NAME='current_cafe_reports' THEN
  IF EXISTS(SELECT 1 FROM bunbun_accounting.cafe_ledger_imports WHERE report_id=OLD.report_id)
   THEN RAISE EXCEPTION 'Imported cafe report needs a financial correction; direct revision is blocked'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.sales_channel::text IN('PUBLIC_HUB','PUBLIC_COFFEE') THEN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cafe-ledger:'||pg_catalog.date_trunc('month',NEW.sale_date)::date::text||':'||NEW.sales_channel::text,0));
  IF EXISTS(SELECT 1 FROM bunbun_accounting.cafe_ledger_imports x JOIN bunbun_accounting.cafe_reports r ON r.id=x.report_id
   WHERE r.month=pg_catalog.date_trunc('month',NEW.sale_date)::date AND r.cafe_key=NEW.sales_channel::text)
  THEN RAISE EXCEPTION 'Imported monthly cafe sales require a financial correction'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.guard_cafe_ledger_scope() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_cafe_ledger_revision BEFORE UPDATE ON bunbun_accounting.current_cafe_reports FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_cafe_ledger_scope();
CREATE TRIGGER guard_cafe_ledger_sale_insert BEFORE INSERT OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_cafe_ledger_scope();

CREATE FUNCTION public.accounting_cafe_ledger_service(p_action text,p_payload jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE r bunbun_accounting.cafe_reports%rowtype; old bunbun_accounting.cafe_ledger_imports%rowtype; old_receipt bunbun_accounting.cafe_ledger_receipts%rowtype;
 bank public.incomes%rowtype; source jsonb; snap text; req jsonb:=p_payload-ARRAY['sourceSnapshot','operationKey']; result jsonb;
 facts jsonb; candidates jsonb; existing jsonb; lines jsonb; allocations jsonb; item jsonb; row_item jsonb; revenue jsonb; current_id uuid;
 v_report_id uuid:=(p_payload->>'reportId')::uuid; op uuid; v_sale_id bigint; sid bigint; sold integer; q integer; n numeric; total numeric:=0;
 category text; remaining integer; base_cents bigint; rem_cents integer; price numeric; state text; period_ready boolean; seen integer;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Private backend required'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND role::text='owner' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Owner required'; END IF;
 IF p_action NOT IN('inspect','review_import','post_import','review_receipt','post_receipt') OR p_action IS NULL THEN RAISE EXCEPTION 'Unsupported cafe ledger action'; END IF;
 -- Same lock as factual report revisions, before scope/source/receipt locks.
 PERFORM pg_advisory_xact_lock(1129662026,1);
 IF p_action='post_import' THEN
  SELECT * INTO old FROM bunbun_accounting.cafe_ledger_imports WHERE operation_key=(p_payload->>'operationKey')::uuid;
  IF FOUND THEN
   IF old.request IS DISTINCT FROM req OR old.actor_id<>p_actor_id THEN RAISE EXCEPTION 'Cafe import replay differs'; END IF;
   RETURN old.result||'{"alreadyProcessed":true}'::jsonb;
  END IF;
 ELSIF p_action='post_receipt' THEN
  SELECT * INTO old_receipt FROM bunbun_accounting.cafe_ledger_receipts WHERE operation_key=(p_payload->>'operationKey')::uuid;
  IF FOUND THEN
   IF old_receipt.request IS DISTINCT FROM req OR old_receipt.actor_id<>p_actor_id THEN RAISE EXCEPTION 'Cafe receipt replay differs'; END IF;
   RETURN old_receipt.result||'{"alreadyProcessed":true}'::jsonb;
  END IF;
 END IF;
 SELECT * INTO r FROM bunbun_accounting.cafe_reports WHERE id=v_report_id;
 SELECT c.report_id INTO current_id FROM bunbun_accounting.current_cafe_reports c WHERE c.month=r.month AND c.cafe_key=r.cafe_key;
 IF r.id IS NULL OR r.id IS DISTINCT FROM current_id THEN RAISE EXCEPTION 'Current cafe report required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cafe-ledger:'||r.month::text||':'||r.cafe_key,0));
 SELECT * INTO old FROM bunbun_accounting.cafe_ledger_imports WHERE cafe_ledger_imports.report_id=r.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id::text,'date',s.sale_date,'total',s.total_amount::text,
  'net',p.net_entitlement::text,'basis',p.recorded_basis,'cogsStatus',p.cogs_status,'journalId',p.journal_id,'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.sale_items i WHERE i.sale_id=s.id)) ORDER BY s.id),'[]'::jsonb)
 INTO candidates FROM public.sales s LEFT JOIN bunbun_accounting.sale_postings p ON p.sale_id=s.id
 WHERE NOT s.is_deleted AND s.sales_channel::text=r.cafe_key AND s.sale_date>=r.month AND s.sale_date<r.month+interval '1 month';
 IF p_action='inspect' THEN
  RETURN jsonb_build_object('reportId',r.id,'imported',old.report_id IS NOT NULL,'import',old.result,'candidates',candidates,
   'receiptStatus',coalesce((SELECT jsonb_agg(jsonb_build_object('incomeId',x.income_id::text,'amount',x.amount::text,'posted',p.income_id IS NOT NULL,'verified',EXISTS(SELECT 1 FROM bunbun_accounting.cafe_ledger_receipts v WHERE v.income_id=x.income_id)) ORDER BY x.income_id)
    FROM bunbun_accounting.cafe_report_receipts x LEFT JOIN bunbun_accounting.income_postings p ON p.income_id=x.income_id WHERE x.report_id=r.id),'[]'::jsonb),
   'actualProfitAvailable',false,'readyToClose',false);
 END IF;
 IF length(coalesce(p_payload->>'evidenceRef','')) NOT BETWEEN 6 AND 500 THEN RAISE EXCEPTION 'Ledger evidence required'; END IF;
 IF p_action IN('review_import','post_import') THEN
  IF old.report_id IS NOT NULL THEN RAISE EXCEPTION 'Cafe report already imported'; END IF;
  IF p_payload->>'actualSoldConfirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Actual sold confirmation required'; END IF;
  PERFORM 1 FROM public.product_stock_movements WHERE movement_date>=r.month AND movement_date<r.month+interval '1 month' ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.incomes WHERE id IN(SELECT income_id FROM bunbun_accounting.cafe_report_receipts WHERE cafe_report_receipts.report_id=r.id) ORDER BY id FOR UPDATE;
  facts:=bunbun_accounting.cafe_report_sources(r.input);
  IF r.summary->>'factsMatch' IS DISTINCT FROM 'true' OR r.source_fingerprint IS DISTINCT FROM facts->>'fingerprint' THEN RAISE EXCEPTION 'Cafe facts changed or still differ; review and save factual report first'; END IF;
  IF (p_payload->>'saleDate')::date<r.month OR (p_payload->>'saleDate')::date>=r.month+interval '1 month' OR p_payload->>'saleDate' IS NULL THEN RAISE EXCEPTION 'Actual sold recognition date must be in report month'; END IF;
  IF p_payload->>'mode'='CREATE' AND (p_payload->>'saleDate')::date<>(r.month+interval '1 month'-interval '1 day')::date THEN RAISE EXCEPTION 'Monthly sold summaries require month-end recognition; earlier deposits need advance accounting'; END IF;
  IF (r.input->>'confirmedCredit')::numeric<>0 THEN RAISE EXCEPTION 'Cafe overpayment needs advance accounting first'; END IF;
  -- Category facts remain on the immutable report. Import only actual sold units.
  FOR row_item IN SELECT x FROM jsonb_array_elements(r.input->'rows') x LOOP
   FOREACH category IN ARRAY ARRAY['regular','bundle','discount'] LOOP
    q:=(row_item->>(category||'Qty'))::integer; n:=(row_item->>(category||'Net'))::numeric;
    IF q>0 AND n=0 THEN RAISE EXCEPTION 'Free promotional goods need explicit accounting classification'; END IF;
    total:=total+n;
   END LOOP;
  END LOOP;
  IF total<=0 OR total>999999999999.99 THEN RAISE EXCEPTION 'Positive net entitlement required'; END IF;
  PERFORM 1 FROM public.sales WHERE NOT is_deleted AND sales_channel::text=r.cafe_key AND sale_date>=r.month AND sale_date<r.month+interval '1 month' ORDER BY id FOR UPDATE;
  IF p_payload->>'mode'='CREATE' THEN
   IF jsonb_array_length(candidates)<>0 OR jsonb_array_length(p_payload->'existingSaleIds')<>0 THEN RAISE EXCEPTION 'Existing cafe sales must be reconciled; shipment-shaped sales cannot be imported twice'; END IF;
  ELSIF p_payload->>'mode'='LINK' THEN
   SELECT coalesce(jsonb_agg(v ORDER BY v),'[]'::jsonb) INTO existing FROM jsonb_array_elements_text(p_payload->'existingSaleIds') v;
   IF existing IS DISTINCT FROM (SELECT coalesce(jsonb_agg(x->>'id' ORDER BY x->>'id'),'[]'::jsonb) FROM jsonb_array_elements(candidates) x)
    OR jsonb_array_length(existing)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(candidates) x WHERE x->>'net' IS NULL OR x->>'basis'<>'NET_BUNBUN')
    OR (SELECT sum((x->>'net')::numeric) FROM jsonb_array_elements(candidates) x)<>total
   THEN RAISE EXCEPTION 'All existing monthly cafe sales must already have matching posted net entitlement'; END IF;
   IF EXISTS(
    WITH actual AS (SELECT i.product_id,sum(i.quantity) qty,sum(i.subtotal) net FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id
     WHERE s.id IN(SELECT (x->>'id')::bigint FROM jsonb_array_elements(candidates) x) GROUP BY i.product_id),
    reported AS (SELECT (x->>'productId')::bigint product_id,((x->>'regularQty')::numeric+(x->>'bundleQty')::numeric+(x->>'discountQty')::numeric) qty,((x->>'regularNet')::numeric+(x->>'bundleNet')::numeric+(x->>'discountNet')::numeric) net FROM jsonb_array_elements(r.input->'rows') x)
    SELECT 1 FROM actual a FULL JOIN reported b USING(product_id) WHERE coalesce(a.qty,0)<>coalesce(b.qty,0) OR coalesce(a.net,0)<>coalesce(b.net,0))
   THEN RAISE EXCEPTION 'Actual sold product quantities differ from existing sales'; END IF;
  ELSE RAISE EXCEPTION 'Explicit CREATE or LINK mode required'; END IF;
  period_ready:=EXISTS(SELECT 1 FROM bunbun_accounting.periods WHERE month_start=r.month AND status='OPEN')
    AND EXISTS(SELECT 1 FROM bunbun_accounting.journals WHERE source_type='OPENING' AND status='POSTED' AND posting_date<=(p_payload->>'saleDate')::date);
  IF NOT period_ready THEN RAISE EXCEPTION 'Reviewed opening and open accounting month required'; END IF;
  source:=jsonb_build_object('report',to_jsonb(r),'facts',facts,'sales',candidates,'periodReady',period_ready);
 ELSE
  SELECT * INTO bank FROM public.incomes WHERE id=(p_payload->>'incomeId')::bigint AND NOT is_deleted FOR UPDATE;
  IF bank.id IS NULL OR NOT EXISTS(SELECT 1 FROM bunbun_accounting.cafe_report_receipts WHERE cafe_report_receipts.report_id=r.id AND income_id=bank.id) THEN RAISE EXCEPTION 'Receipt must be linked to this report'; END IF;
  IF p_payload->>'cashAccount' NOT IN('1010','1020') OR p_payload->>'cashAccount' IS NULL THEN RAISE EXCEPTION 'Verified cash or bank account required'; END IF;
  -- This path deliberately requires one posted invoice per report. Multi-sale
  -- LINK reports keep the existing explicit receipt-allocation workflow.
  IF EXISTS(SELECT 1 FROM bunbun_accounting.cafe_report_receipts l JOIN bunbun_accounting.current_cafe_reports c ON c.report_id=l.report_id
   WHERE l.income_id=bank.id AND (SELECT count(*) FROM bunbun_accounting.cafe_ledger_sales z WHERE z.report_id=l.report_id)<>1)
  THEN RAISE EXCEPTION 'Every linked report needs one imported invoice; multiple existing invoices need explicit settlement allocation'; END IF;
  SELECT jsonb_agg(jsonb_build_object('saleId',s.sale_id::text,'amount',l.amount::text) ORDER BY s.sale_id) INTO allocations
  FROM bunbun_accounting.cafe_report_receipts l JOIN bunbun_accounting.current_cafe_reports c ON c.report_id=l.report_id
   JOIN bunbun_accounting.cafe_ledger_sales s ON s.report_id=l.report_id WHERE l.income_id=bank.id;
  IF allocations IS NULL OR (SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(allocations) x)<>bank.pemasukan_bunbun
  THEN RAISE EXCEPTION 'All portions of net deposit must be linked before posting; no second deduction or guessed balance'; END IF;
  IF EXISTS(SELECT 1 FROM public.sales s WHERE s.id IN(SELECT (x->>'saleId')::bigint FROM jsonb_array_elements(allocations) x) AND s.sale_date>bank.tanggal) THEN RAISE EXCEPTION 'Deposit precedes monthly invoice; advance accounting is required'; END IF;
  SELECT jsonb_agg(to_jsonb(x) ORDER BY sale_id) INTO existing FROM bunbun_accounting.settlement_allocations x WHERE income_id=bank.id;
  IF EXISTS(SELECT 1 FROM bunbun_accounting.income_postings WHERE income_id=bank.id) THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(allocations) x FULL JOIN bunbun_accounting.settlement_allocations a ON a.sale_id=(x->>'saleId')::bigint AND a.income_id=bank.id
    WHERE (a.income_id=bank.id OR x IS NOT NULL) AND (a.amount IS DISTINCT FROM (x->>'amount')::numeric))
    OR (SELECT cash_account FROM bunbun_accounting.income_postings WHERE income_id=bank.id)<>p_payload->>'cashAccount'
   THEN RAISE EXCEPTION 'Posted receipt allocations differ; financial correction required'; END IF;
  END IF;
  source:=jsonb_build_object('income',to_jsonb(bank),'allocations',allocations,'existing',existing,
   'incomePosting',(SELECT to_jsonb(x) FROM bunbun_accounting.income_postings x WHERE income_id=bank.id),
   'sales',(SELECT jsonb_agg(to_jsonb(x) ORDER BY sale_id) FROM bunbun_accounting.sale_postings x WHERE sale_id IN(SELECT (a->>'saleId')::bigint FROM jsonb_array_elements(allocations) a)));
 END IF;
 snap:=encode(sha256(convert_to(source::text,'UTF8')),'hex');
 IF p_action IN('review_import','review_receipt') THEN
  RETURN jsonb_build_object('sourceSnapshot',snap,'netEntitlement',CASE WHEN p_action='review_import' THEN total ELSE bank.pemasukan_bunbun END::text,
   'mode',p_payload->>'mode','allocations',allocations,'mayConfirm',true,'cogsStatus','PENDING_OR_EXISTING','actualProfitAvailable',false);
 END IF;
 IF snap IS DISTINCT FROM p_payload->>'sourceSnapshot' THEN RAISE EXCEPTION 'Cafe ledger sources changed since review'; END IF;
 op:=(p_payload->>'operationKey')::uuid;
 IF p_action='post_import' THEN
  IF p_payload->>'mode'='CREATE' THEN
   INSERT INTO public.sales(sale_date,sales_channel,total_amount,created_by)
   VALUES((p_payload->>'saleDate')::date,r.cafe_key,total,p_actor_id) RETURNING id INTO v_sale_id;
   -- Exact-cent unit pricing, never round q * unit_price away from reported net.
   FOR row_item IN SELECT x FROM jsonb_array_elements(r.input->'rows') x LOOP
    FOREACH category IN ARRAY ARRAY['regular','bundle','discount'] LOOP
     q:=(row_item->>(category||'Qty'))::integer; n:=(row_item->>(category||'Net'))::numeric;
     IF q=0 THEN CONTINUE; END IF;
     base_cents:=floor(n*100/q); rem_cents:=(n*100-base_cents*q)::integer;
     FOR seen IN 0..1 LOOP
      remaining:=CASE WHEN seen=0 THEN q-rem_cents ELSE rem_cents END;price:=(base_cents+seen)::numeric/100;
      IF remaining=0 THEN CONTINUE; END IF;
      INSERT INTO public.sale_items(sale_id,product_id,product_sku,product_name,quantity,selling_price,subtotal,order_type)
      SELECT v_sale_id,p.id,p.sku,p.nama,remaining,price,remaining*price,'TAKE_AWAY' FROM public.products p WHERE p.id=(row_item->>'productId')::bigint AND NOT p.is_deleted;
      IF NOT FOUND THEN RAISE EXCEPTION 'Active report product required'; END IF;
     END LOOP;
    END LOOP;
   END LOOP;
   revenue:=public.accounting_revenue_service('review_sale',jsonb_build_object('saleId',v_sale_id::text),p_actor_id);
   result:=public.accounting_revenue_service('post_sale',jsonb_build_object('saleId',v_sale_id::text,'sourceSnapshot',revenue->>'sourceSnapshot','recordedBasis','NET_BUNBUN','netEntitlement',total::text,'soldConfirmed',true,'evidenceRef',p_payload->>'evidenceRef','operationKey',gen_random_uuid()),p_actor_id);
   existing:=jsonb_build_array(v_sale_id::text);
  ELSE existing:=p_payload->'existingSaleIds'; END IF;
  result:=jsonb_build_object('reportId',r.id,'saleIds',existing,'netEntitlement',total::text,'cogsPending',EXISTS(SELECT 1 FROM bunbun_accounting.sale_postings WHERE sale_postings.sale_id IN(SELECT value::bigint FROM jsonb_array_elements_text(existing)) AND cogs_status<>'POSTED'),'actualProfitAvailable',false);
  INSERT INTO bunbun_accounting.cafe_ledger_imports(report_id,mode,operation_key,request,result,actor_id) VALUES(r.id,p_payload->>'mode',op,req,result,p_actor_id);
  INSERT INTO bunbun_accounting.cafe_ledger_sales(sale_id,report_id) SELECT value::bigint,r.id FROM jsonb_array_elements_text(existing);
 ELSE
  IF EXISTS(SELECT 1 FROM bunbun_accounting.income_postings WHERE income_id=bank.id) THEN
   result:=jsonb_build_object('journalId',(SELECT journal_id FROM bunbun_accounting.income_postings WHERE income_id=bank.id),'alreadyPosted',true,'actualProfitAvailable',false);
  ELSE
   revenue:=public.accounting_revenue_service('review_income',jsonb_build_object('incomeId',bank.id::text),p_actor_id);
   result:=public.accounting_revenue_service('post_income',jsonb_build_object('incomeId',bank.id::text,'sourceSnapshot',revenue->>'sourceSnapshot','cashAccount',p_payload->>'cashAccount','allocationConfirmed',true,'allocations',allocations,'evidenceRef',p_payload->>'evidenceRef','operationKey',gen_random_uuid()),p_actor_id);
  END IF;
  INSERT INTO bunbun_accounting.cafe_ledger_receipts(income_id,operation_key,request,result,actor_id) VALUES(bank.id,op,req,result,p_actor_id);
 END IF;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.accounting_cafe_ledger_service(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_cafe_ledger_service(text,jsonb,uuid) TO service_role;
COMMIT;
