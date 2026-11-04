-- ISOLATED STAGING pkgrqalpazhwdcxmthvb ONLY. Revenue and receivables,
-- independent from cash settlement. Does not invent/authorize actual sold COGS.
BEGIN;
CREATE TABLE bunbun_accounting.sale_postings (
 sale_id bigint PRIMARY KEY REFERENCES public.sales(id),
 journal_id uuid NOT NULL UNIQUE REFERENCES bunbun_accounting.journals(id),
 source_snapshot jsonb NOT NULL,
 recorded_basis text NOT NULL CHECK(recorded_basis IN('NET_BUNBUN','GROSS_CAFE')),
 net_entitlement numeric(18,2) NOT NULL CHECK(net_entitlement>0),
 evidence_ref text NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 cogs_journal_id uuid UNIQUE REFERENCES bunbun_accounting.journals(id),
 cogs_status text NOT NULL DEFAULT 'PENDING_VALUATION' CHECK(cogs_status IN('PENDING_VALUATION','POSTED')),
 CHECK((cogs_status='POSTED')=(cogs_journal_id IS NOT NULL))
);
CREATE TABLE bunbun_accounting.income_postings (
 income_id bigint PRIMARY KEY REFERENCES public.incomes(id),
 journal_id uuid NOT NULL UNIQUE REFERENCES bunbun_accounting.journals(id),
 source_snapshot jsonb NOT NULL,
 cash_account text NOT NULL CHECK(cash_account IN('1010','1020')),
 evidence_ref text NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id)
);
CREATE TABLE bunbun_accounting.settlement_allocations (
 income_id bigint NOT NULL REFERENCES bunbun_accounting.income_postings(income_id),
 sale_id bigint NOT NULL REFERENCES bunbun_accounting.sale_postings(sale_id),
 amount numeric(18,2) NOT NULL CHECK(amount>0),
 PRIMARY KEY(income_id,sale_id)
);
CREATE INDEX settlement_sale_lookup ON bunbun_accounting.settlement_allocations(sale_id);
CREATE TABLE bunbun_accounting.revenue_operations (
 operation_key uuid PRIMARY KEY,
 request jsonb NOT NULL,
 result jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bunbun_accounting.sale_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.income_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.settlement_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.revenue_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bunbun_accounting.sale_postings,bunbun_accounting.income_postings,
 bunbun_accounting.settlement_allocations,bunbun_accounting.revenue_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON bunbun_accounting.sale_postings,bunbun_accounting.income_postings,
 bunbun_accounting.settlement_allocations,bunbun_accounting.revenue_operations TO service_role;
-- PostgreSQL requires UPDATE privilege for receivable SELECT FOR UPDATE locks.
GRANT UPDATE ON bunbun_accounting.sale_postings TO service_role;

CREATE FUNCTION bunbun_accounting.guard_posted_revenue_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE a bigint; b bigint; v_id bigint;
BEGIN
 IF TG_TABLE_NAME='incomes' THEN
   IF EXISTS(SELECT 1 FROM bunbun_accounting.income_postings WHERE income_id=OLD.id)
   THEN RAISE EXCEPTION 'Setoran sudah dijurnal. Perubahan memerlukan koreksi akuntansi.' USING ERRCODE='55000'; END IF;
 ELSIF TG_TABLE_NAME='sales' THEN
   IF EXISTS(SELECT 1 FROM bunbun_accounting.sale_postings WHERE sale_id=OLD.id)
   THEN RAISE EXCEPTION 'Penjualan sudah dijurnal. Perubahan memerlukan koreksi akuntansi.' USING ERRCODE='55000'; END IF;
 ELSE
   IF TG_OP<>'INSERT' THEN a:=OLD.sale_id; END IF;
   IF TG_OP<>'DELETE' THEN b:=NEW.sale_id; END IF;
   FOR v_id IN SELECT DISTINCT x FROM unnest(ARRAY[a,b]) x WHERE x IS NOT NULL ORDER BY x LOOP
     PERFORM 1 FROM public.sales WHERE id=v_id FOR UPDATE;
     IF EXISTS(SELECT 1 FROM bunbun_accounting.sale_postings WHERE sale_id=v_id)
     THEN RAISE EXCEPTION 'Rincian penjualan sudah dijurnal dan tidak dapat diubah langsung.' USING ERRCODE='55000'; END IF;
   END LOOP;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.guard_posted_revenue_source() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_accounting_sale BEFORE UPDATE OR DELETE ON public.sales
FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_posted_revenue_source();
CREATE TRIGGER guard_accounting_sale_items BEFORE INSERT OR UPDATE OR DELETE ON public.sale_items
FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_posted_revenue_source();
CREATE TRIGGER guard_accounting_income BEFORE UPDATE OR DELETE ON public.incomes
FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_posted_revenue_source();

CREATE FUNCTION bunbun_accounting.guard_sale_cost_period_close() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.status='CLOSED' AND OLD.status='OPEN' AND EXISTS(
   SELECT 1 FROM public.sales s LEFT JOIN bunbun_accounting.sale_postings p ON p.sale_id=s.id
   WHERE NOT s.is_deleted AND s.sale_date<(NEW.month_start+interval '1 month')::date
     AND s.sale_date>=coalesce((SELECT posting_date FROM bunbun_accounting.journals WHERE source_type='OPENING' AND status='POSTED' LIMIT 1),'-infinity'::date)
     AND (p.sale_id IS NULL OR p.cogs_status<>'POSTED'))
 THEN RAISE EXCEPTION 'Actual sold COGS is incomplete; accounting period cannot close'; END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.guard_sale_cost_period_close() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_accounting_sale_cost_close BEFORE UPDATE ON bunbun_accounting.periods
FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_sale_cost_period_close();

CREATE FUNCTION bunbun_accounting.process_revenue(p_action text,p_payload jsonb,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
 s public.sales%rowtype; i public.incomes%rowtype; sale_post bunbun_accounting.sale_postings%rowtype;
 income_post bunbun_accounting.income_postings%rowtype; operation bunbun_accounting.revenue_operations%rowtype;
 v_id bigint; v_source jsonb; v_items jsonb; v_valid boolean; v_total numeric; v_period uuid;
 v_net numeric; v_basis text; v_cash text; v_evidence text; v_operation uuid;
 v_journal uuid:=gen_random_uuid(); v_result jsonb; v_request jsonb;
 allocation jsonb; v_sale_id bigint; v_allocated numeric:=0; v_amount numeric; v_paid numeric;
 v_cutover date; v_month date; v_pending bigint;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Private backend required'; END IF;
 IF p_action IN('review_sale','review_income','receivables','cost_readiness') THEN
   IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='owner' AND is_active)
   THEN RAISE EXCEPTION 'Active Owner approval required'; END IF;
 ELSE
   PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND role::text='owner' AND is_active FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Active Owner approval required'; END IF;
 END IF;
 IF p_action='cost_readiness' THEN
   IF coalesce(p_payload->>'month','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Valid report month required'; END IF;
   v_month:=((p_payload->>'month')||'-01')::date;
   SELECT posting_date INTO v_cutover FROM bunbun_accounting.journals WHERE source_type='OPENING' AND status='POSTED' LIMIT 1;
   SELECT count(*) INTO v_pending FROM public.sales x LEFT JOIN bunbun_accounting.sale_postings p ON p.sale_id=x.id
   WHERE NOT x.is_deleted AND x.sale_date>=v_cutover AND x.sale_date<(v_month+interval '1 month')::date
     AND (p.sale_id IS NULL OR p.cogs_status<>'POSTED');
   RETURN jsonb_build_object('month',p_payload->>'month','pendingSalesCogs',v_pending,
     'soldCostsComplete',v_cutover IS NOT NULL AND v_pending=0);
 END IF;
 IF p_action='receivables' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('saleId',p.sale_id::text,'date',x.sale_date,'channel',x.sales_channel,
     'entitlement',p.net_entitlement::text,'paid',coalesce(a.paid,0)::text,
     'outstanding',(p.net_entitlement-coalesce(a.paid,0))::text,'cogsStatus',p.cogs_status) ORDER BY x.sale_date,p.sale_id),'[]'::jsonb)
   INTO v_result FROM bunbun_accounting.sale_postings p JOIN public.sales x ON x.id=p.sale_id
   LEFT JOIN LATERAL(SELECT sum(amount) paid FROM bunbun_accounting.settlement_allocations WHERE sale_id=p.sale_id) a ON true;
   RETURN jsonb_build_object('receivables',v_result,'actualProfitAvailable',false);
 END IF;
 IF p_action IS NULL OR p_action NOT IN('review_sale','post_sale','review_income','post_income')
 THEN RAISE EXCEPTION 'Unsupported revenue action'; END IF;
 IF p_action IN('review_sale','post_sale') THEN
   v_id:=(p_payload->>'saleId')::bigint;
   IF p_action='post_sale' THEN
     SELECT * INTO s FROM public.sales WHERE id=v_id FOR UPDATE;
     PERFORM 1 FROM public.sale_items WHERE sale_id=v_id ORDER BY id FOR SHARE;
   ELSE SELECT * INTO s FROM public.sales WHERE id=v_id; END IF;
   IF s.id IS NULL OR s.is_deleted THEN IF p_action='review_sale' THEN RETURN NULL; END IF; RAISE EXCEPTION 'Active sale required'; END IF;
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb),coalesce(sum(subtotal),0),
     coalesce(bool_and(quantity>0 AND selling_price>=0 AND subtotal=quantity*selling_price
       AND quantity::text NOT IN('NaN','Infinity','-Infinity') AND subtotal::text NOT IN('NaN','Infinity','-Infinity')),false)
   INTO v_items,v_total,v_valid FROM public.sale_items x WHERE sale_id=s.id;
   v_source:=jsonb_build_object('sale',to_jsonb(s),'items',v_items);
   v_valid:=v_valid AND v_total=s.total_amount AND s.total_amount>0 AND s.total_amount::text NOT IN('NaN','Infinity','-Infinity');
   SELECT * INTO sale_post FROM bunbun_accounting.sale_postings WHERE sale_id=s.id;
   IF p_action='review_sale' THEN RETURN jsonb_build_object('sourceSnapshot',v_source::text,'date',s.sale_date,
     'channel',s.sales_channel,'total',s.total_amount::text,'sourceComplete',v_valid,'posted',sale_post.sale_id IS NOT NULL,
     'periodReady',EXISTS(SELECT 1 FROM bunbun_accounting.periods WHERE month_start=date_trunc('month',s.sale_date)::date AND status='OPEN')
       AND EXISTS(SELECT 1 FROM bunbun_accounting.journals WHERE source_type='OPENING' AND status='POSTED' AND posting_date<=s.sale_date),
     'actualProfitAvailable',false,'cogsStatus','PENDING_VALUATION'); END IF;
 ELSE
   v_id:=(p_payload->>'incomeId')::bigint;
   IF p_action='post_income' THEN SELECT * INTO i FROM public.incomes WHERE id=v_id FOR UPDATE;
   ELSE SELECT * INTO i FROM public.incomes WHERE id=v_id; END IF;
   IF i.id IS NULL OR i.is_deleted THEN IF p_action='review_income' THEN RETURN NULL; END IF; RAISE EXCEPTION 'Active receipt required'; END IF;
   v_source:=to_jsonb(i); v_valid:=i.pemasukan_bunbun>0 AND i.pemasukan_bunbun::text NOT IN('NaN','Infinity','-Infinity');
   SELECT * INTO income_post FROM bunbun_accounting.income_postings WHERE income_id=i.id;
   IF p_action='review_income' THEN RETURN jsonb_build_object('sourceSnapshot',v_source::text,'date',i.tanggal,
     'amount',i.pemasukan_bunbun::text,'description',i.asal_setoran,'sourceComplete',v_valid,'posted',income_post.income_id IS NOT NULL,
     'periodReady',EXISTS(SELECT 1 FROM bunbun_accounting.periods WHERE month_start=date_trunc('month',i.tanggal)::date AND status='OPEN')
       AND EXISTS(SELECT 1 FROM bunbun_accounting.journals WHERE source_type='OPENING' AND status='POSTED' AND posting_date<=i.tanggal)); END IF;
 END IF;
 v_operation:=(p_payload->>'operationKey')::uuid; v_evidence:=btrim(p_payload->>'evidenceRef');
 IF v_operation IS NULL OR v_evidence IS NULL OR length(v_evidence) NOT BETWEEN 6 AND 500 THEN RAISE EXCEPTION 'Operation and evidence required'; END IF;
 v_request:=jsonb_build_object('action',p_action,'payload',p_payload,'actor',p_actor_id);
 SELECT * INTO operation FROM bunbun_accounting.revenue_operations WHERE operation_key=v_operation;
 IF FOUND THEN
   IF operation.request IS DISTINCT FROM v_request THEN RAISE EXCEPTION 'Revenue operation reused with different request'; END IF;
   RETURN operation.result||jsonb_build_object('alreadyProcessed',true);
 END IF;
 IF NOT v_valid OR v_source IS DISTINCT FROM (p_payload->>'sourceSnapshot')::jsonb THEN RAISE EXCEPTION 'Revenue source changed or invalid'; END IF;
 IF p_action='post_sale' THEN
   IF p_payload->>'soldConfirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confirmed sold goods required'; END IF;
   v_basis:=p_payload->>'recordedBasis'; v_net:=(p_payload->>'netEntitlement')::numeric;
   IF v_basis IS NULL OR v_basis NOT IN('NET_BUNBUN','GROSS_CAFE') OR v_net IS NULL OR v_net<=0
   OR v_net::text IN('NaN','Infinity','-Infinity') OR v_net<>round(v_net,2) OR v_net>999999999999.99
   OR (v_basis='NET_BUNBUN' AND v_net<>s.total_amount) OR (v_basis='GROSS_CAFE' AND v_net>s.total_amount)
   THEN RAISE EXCEPTION 'Sale entitlement does not match recorded basis'; END IF;
   IF sale_post.sale_id IS NOT NULL THEN
     IF sale_post.source_snapshot IS DISTINCT FROM v_source OR sale_post.recorded_basis<>v_basis OR sale_post.net_entitlement<>v_net
       OR sale_post.evidence_ref<>v_evidence THEN RAISE EXCEPTION 'Sale already posted with different review'; END IF;
     RETURN jsonb_build_object('journalId',sale_post.journal_id,'alreadyProcessed',true,'cogsStatus',sale_post.cogs_status,'actualProfitAvailable',false);
   END IF;
   SELECT id INTO v_period FROM bunbun_accounting.periods WHERE month_start=date_trunc('month',s.sale_date)::date FOR UPDATE;
   IF v_period IS NULL THEN RAISE EXCEPTION 'Accounting period required'; END IF;
   INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key,narrative,created_by)
   VALUES(v_journal,v_period,s.sale_date,'NORMAL','sale-revenue:'||s.id,gen_random_uuid(),v_evidence,p_actor_id);
   INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit)
   VALUES(v_journal,1,'1120',v_net,0),(v_journal,2,'4010',0,v_net);
   PERFORM bunbun_accounting.post_reviewed_journal(v_journal,p_actor_id);
   INSERT INTO bunbun_accounting.sale_postings(sale_id,journal_id,source_snapshot,recorded_basis,net_entitlement,evidence_ref,actor_id)
   VALUES(s.id,v_journal,v_source,v_basis,v_net,v_evidence,p_actor_id);
   v_result:=jsonb_build_object('journalId',v_journal,'alreadyProcessed',false,'cogsStatus','PENDING_VALUATION','actualProfitAvailable',false);
 ELSE
   v_cash:=p_payload->>'cashAccount';
   IF v_cash IS NULL OR v_cash NOT IN('1010','1020') OR p_payload->>'allocationConfirmed' IS DISTINCT FROM 'true'
   OR jsonb_typeof(p_payload->'allocations') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Verified receipt allocations and cash account required'; END IF;
   IF jsonb_array_length(p_payload->'allocations') NOT BETWEEN 1 AND 50
   OR (SELECT count(DISTINCT x->>'saleId') FROM jsonb_array_elements(p_payload->'allocations') x)<>jsonb_array_length(p_payload->'allocations')
   THEN RAISE EXCEPTION 'Unique receipt sale allocations required'; END IF;
   IF income_post.income_id IS NOT NULL THEN RAISE EXCEPTION 'Receipt already posted; reload accounting status'; END IF;
   -- Every competing settlement takes the same receivable row locks in ID order.
   PERFORM 1 FROM bunbun_accounting.sale_postings WHERE sale_id IN
     (SELECT (x->>'saleId')::bigint FROM jsonb_array_elements(p_payload->'allocations') x) ORDER BY sale_id FOR UPDATE;
   FOR allocation IN SELECT x FROM jsonb_array_elements(p_payload->'allocations') x LOOP
     v_sale_id:=(allocation->>'saleId')::bigint; v_amount:=(allocation->>'amount')::numeric;
     SELECT * INTO sale_post FROM bunbun_accounting.sale_postings WHERE sale_id=v_sale_id;
     IF NOT FOUND OR v_amount IS NULL OR v_amount<=0 OR v_amount::text IN('NaN','Infinity','-Infinity') OR v_amount<>round(v_amount,2)
     THEN RAISE EXCEPTION 'Posted sale and positive allocation required'; END IF;
     IF (SELECT sale_date FROM public.sales WHERE id=v_sale_id)>i.tanggal THEN RAISE EXCEPTION 'Receipt precedes sale'; END IF;
     SELECT coalesce(sum(amount),0) INTO v_paid FROM bunbun_accounting.settlement_allocations WHERE sale_id=v_sale_id;
     IF v_paid+v_amount>sale_post.net_entitlement THEN RAISE EXCEPTION 'Receipt allocation exceeds outstanding receivable'; END IF;
     v_allocated:=v_allocated+v_amount;
   END LOOP;
   IF v_allocated<>i.pemasukan_bunbun THEN RAISE EXCEPTION 'Allocations must equal actual net receipt'; END IF;
   SELECT id INTO v_period FROM bunbun_accounting.periods WHERE month_start=date_trunc('month',i.tanggal)::date FOR UPDATE;
   IF v_period IS NULL THEN RAISE EXCEPTION 'Accounting period required'; END IF;
   INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key,cash_flow_category,narrative,created_by)
   VALUES(v_journal,v_period,i.tanggal,'NORMAL','income-settlement:'||i.id,gen_random_uuid(),'OPERATING',v_evidence,p_actor_id);
   INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit)
   VALUES(v_journal,1,v_cash,i.pemasukan_bunbun,0),(v_journal,2,'1120',0,i.pemasukan_bunbun);
   PERFORM bunbun_accounting.post_reviewed_journal(v_journal,p_actor_id);
   INSERT INTO bunbun_accounting.income_postings(income_id,journal_id,source_snapshot,cash_account,evidence_ref,actor_id)
   VALUES(i.id,v_journal,v_source,v_cash,v_evidence,p_actor_id);
   INSERT INTO bunbun_accounting.settlement_allocations(income_id,sale_id,amount)
   SELECT i.id,(x->>'saleId')::bigint,(x->>'amount')::numeric FROM jsonb_array_elements(p_payload->'allocations') x;
   v_result:=jsonb_build_object('journalId',v_journal,'alreadyProcessed',false,'actualProfitAvailable',false);
 END IF;
 INSERT INTO bunbun_accounting.revenue_operations(operation_key,request,result,actor_id)
 VALUES(v_operation,v_request,v_result,p_actor_id);
 RETURN v_result;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.process_revenue(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.process_revenue(text,jsonb,uuid) TO service_role;
CREATE FUNCTION public.accounting_revenue_service(p_action text,p_payload jsonb,p_actor_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT bunbun_accounting.process_revenue(p_action,p_payload,p_actor_id);
$fn$;
REVOKE ALL ON FUNCTION public.accounting_revenue_service(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_revenue_service(text,jsonb,uuid) TO service_role;
COMMIT;
