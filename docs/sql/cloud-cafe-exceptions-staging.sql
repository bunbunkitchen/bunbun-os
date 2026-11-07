-- Isolated staging: actual net advance receipts/applications and evidenced cafe waste.
BEGIN;
INSERT INTO bunbun_accounting.accounts(code,name,kind,is_cash) VALUES('2130','Setoran Kafe Belum Dialokasikan','LIABILITY',false);
CREATE TABLE bunbun_accounting.cafe_advances (
 income_id bigint PRIMARY KEY REFERENCES bunbun_accounting.income_postings(income_id), amount numeric(18,2) NOT NULL CHECK(amount>0),
 operation_key uuid NOT NULL UNIQUE, request jsonb NOT NULL, source_snapshot text NOT NULL, result jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bunbun_accounting.cafe_advance_reservations (
 income_id bigint NOT NULL REFERENCES bunbun_accounting.cafe_advances(income_id), month date NOT NULL, cafe_key text NOT NULL,
 amount numeric(18,2) NOT NULL CHECK(amount>0), PRIMARY KEY(income_id,month,cafe_key)
);
CREATE TABLE bunbun_accounting.cafe_advance_applications (
 income_id bigint NOT NULL, sale_id bigint NOT NULL, amount numeric(18,2) NOT NULL CHECK(amount>0), applied_on date NOT NULL,
 journal_id uuid NOT NULL REFERENCES bunbun_accounting.journals(id), operation_key uuid NOT NULL,
 PRIMARY KEY(income_id,sale_id), FOREIGN KEY(income_id,sale_id) REFERENCES bunbun_accounting.settlement_allocations(income_id,sale_id)
);
CREATE TABLE bunbun_accounting.cafe_waste_postings (
 report_id uuid NOT NULL REFERENCES bunbun_accounting.cafe_reports(id), product_id bigint NOT NULL REFERENCES public.products(id),
 quantity integer NOT NULL CHECK(quantity>0), actual_value numeric(18,2) NOT NULL CHECK(actual_value>0),
 journal_id uuid NOT NULL UNIQUE REFERENCES bunbun_accounting.journals(id), operation_key uuid NOT NULL UNIQUE,
 request jsonb NOT NULL, source_snapshot text NOT NULL, result jsonb NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id),
 PRIMARY KEY(report_id,product_id)
);
CREATE TABLE bunbun_accounting.cafe_waste_lots (
 report_id uuid NOT NULL, product_id bigint NOT NULL, split_id bigint NOT NULL REFERENCES public.production_batch_splits(id),
 quantity integer NOT NULL CHECK(quantity>0), actual_value numeric(18,2) NOT NULL CHECK(actual_value>0), PRIMARY KEY(report_id,product_id,split_id),
 FOREIGN KEY(report_id,product_id) REFERENCES bunbun_accounting.cafe_waste_postings(report_id,product_id)
);
CREATE TABLE bunbun_accounting.cafe_exception_operations (
 operation_key uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES auth.users(id), request jsonb NOT NULL, result jsonb NOT NULL
);
ALTER TABLE bunbun_accounting.cafe_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.cafe_advance_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.cafe_advance_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.cafe_waste_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.cafe_waste_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.cafe_exception_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bunbun_accounting.cafe_advances,bunbun_accounting.cafe_advance_reservations,bunbun_accounting.cafe_advance_applications,
 bunbun_accounting.cafe_waste_postings,bunbun_accounting.cafe_waste_lots,bunbun_accounting.cafe_exception_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON bunbun_accounting.cafe_advances,bunbun_accounting.cafe_advance_reservations,bunbun_accounting.cafe_advance_applications,
 bunbun_accounting.cafe_waste_postings,bunbun_accounting.cafe_waste_lots,bunbun_accounting.cafe_exception_operations TO service_role;

CREATE FUNCTION bunbun_accounting.guard_cafe_exception_report() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE old_report bunbun_accounting.cafe_reports%rowtype;
BEGIN
 SELECT * INTO old_report FROM bunbun_accounting.cafe_reports WHERE id=OLD.report_id;
 IF EXISTS(SELECT 1 FROM bunbun_accounting.cafe_waste_postings WHERE report_id=OLD.report_id) THEN RAISE EXCEPTION 'Valued cafe waste requires financial correction before report revision'; END IF;
 IF EXISTS(SELECT 1 FROM bunbun_accounting.cafe_advance_reservations a
  WHERE a.month=old_report.month AND a.cafe_key=old_report.cafe_key
   AND a.amount IS DISTINCT FROM (SELECT x.amount FROM bunbun_accounting.cafe_report_receipts x WHERE x.report_id=NEW.report_id AND x.income_id=a.income_id))
 THEN RAISE EXCEPTION 'Advance receipt reservations cannot change through factual revision'; END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.guard_cafe_exception_report() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.guard_cafe_exception_report() TO service_role;
CREATE TRIGGER guard_cafe_exception_report BEFORE UPDATE ON bunbun_accounting.current_cafe_reports FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_cafe_exception_report();

CREATE FUNCTION public.accounting_cafe_exception_service(p_action text,p_payload jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE r bunbun_accounting.cafe_reports%rowtype; bank public.incomes%rowtype; adv bunbun_accounting.cafe_advances%rowtype;
 pos bunbun_accounting.product_cost_positions%rowtype; old bunbun_accounting.cafe_exception_operations%rowtype;
 req jsonb:=jsonb_build_object('action',p_action,'choices',p_payload-ARRAY['sourceSnapshot','operationKey']);
 source jsonb; snap text; result jsonb; selected jsonb:='[]'::jsonb; reservations jsonb; choice jsonb; posted jsonb;
 op uuid; jid uuid:=gen_random_uuid(); pid uuid; effective date; total numeric:=0; reserved numeric; spent numeric; paid numeric; value numeric; remaining_qty integer;
 qty integer:=0; expected_qty integer; product bigint:=(p_payload->>'productId')::bigint; invoice bigint; v_amount numeric; ln integer:=0;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Private backend required'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND role::text='owner' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Owner required'; END IF;
 IF p_action IS NULL OR p_action NOT IN('inspect','review_advance','post_advance','review_apply','post_apply','review_waste','post_waste') THEN RAISE EXCEPTION 'Unsupported cafe exception action'; END IF;
 PERFORM pg_advisory_xact_lock(1129662026,1);
 IF p_action LIKE 'post_%' THEN
  SELECT * INTO old FROM bunbun_accounting.cafe_exception_operations WHERE operation_key=(p_payload->>'operationKey')::uuid;
  IF FOUND THEN IF old.actor_id<>p_actor_id OR old.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'Cafe exception operation replay differs'; END IF; RETURN old.result||'{"alreadyProcessed":true}'::jsonb; END IF;
 END IF;
 SELECT a.* INTO r FROM bunbun_accounting.cafe_reports a JOIN bunbun_accounting.current_cafe_reports c ON c.report_id=a.id WHERE a.id=(p_payload->>'reportId')::uuid;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Current cafe report required'; END IF;
 IF p_action='inspect' THEN
  RETURN jsonb_build_object('advances',coalesce((SELECT jsonb_agg(jsonb_build_object('incomeId',l.income_id::text,'portion',l.amount::text,'posted',a.income_id IS NOT NULL,'receiptPosted',EXISTS(SELECT 1 FROM bunbun_accounting.income_postings ip WHERE ip.income_id=l.income_id),
    'reserved',z.amount::text,'applied',coalesce((SELECT sum(t.amount) FROM bunbun_accounting.cafe_advance_applications t JOIN bunbun_accounting.cafe_ledger_sales s ON s.sale_id=t.sale_id JOIN bunbun_accounting.cafe_reports p ON p.id=s.report_id WHERE t.income_id=l.income_id AND p.month=r.month AND p.cafe_key=r.cafe_key),0)::text) ORDER BY l.income_id)
    FROM bunbun_accounting.cafe_report_receipts l LEFT JOIN bunbun_accounting.cafe_advances a ON a.income_id=l.income_id LEFT JOIN bunbun_accounting.cafe_advance_reservations z ON z.income_id=l.income_id AND z.month=r.month AND z.cafe_key=r.cafe_key WHERE l.report_id=r.id),'[]'::jsonb),
   'sales',coalesce((SELECT jsonb_agg(jsonb_build_object('saleId',p.sale_id::text,'date',s.sale_date,'outstanding',(p.net_entitlement-coalesce((SELECT sum(amount) FROM bunbun_accounting.settlement_allocations WHERE sale_id=p.sale_id),0))::text) ORDER BY p.sale_id) FROM bunbun_accounting.cafe_ledger_sales l JOIN bunbun_accounting.sale_postings p ON p.sale_id=l.sale_id JOIN public.sales s ON s.id=p.sale_id WHERE l.report_id=r.id),'[]'::jsonb),
   'waste',coalesce((SELECT jsonb_agg(jsonb_build_object('productId',x->>'productId','quantity',x->>'wasteQty','posted',w.report_id IS NOT NULL,'actualCost',w.actual_value::text) ORDER BY x->>'productId') FROM jsonb_array_elements(r.input->'rows') x LEFT JOIN bunbun_accounting.cafe_waste_postings w ON w.report_id=r.id AND w.product_id=(x->>'productId')::bigint WHERE (x->>'wasteQty')::integer>0),'[]'::jsonb),
   'positions',coalesce((SELECT jsonb_agg(jsonb_build_object('splitId',split_id::text,'productId',product_id::text,'quantity',quantity::text,'actualValue',actual_value::text,'date',posting_date) ORDER BY split_id) FROM bunbun_accounting.product_cost_positions WHERE location='CONSIGNMENT' AND cafe_key=r.cafe_key AND quantity>0),'[]'::jsonb),'actualProfitAvailable',false);
 END IF;
 IF length(coalesce(p_payload->>'evidenceRef','')) NOT BETWEEN 6 AND 500 THEN RAISE EXCEPTION 'Evidence required'; END IF;
 IF p_action IN('review_advance','post_advance','review_apply','post_apply') THEN
  IF p_payload->>'allocationConfirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confirmed advance allocations required'; END IF;
  SELECT * INTO bank FROM public.incomes WHERE id=(p_payload->>'incomeId')::bigint AND NOT is_deleted FOR UPDATE;
  IF bank.id IS NULL OR bank.pemasukan_bunbun<=0 OR NOT EXISTS(SELECT 1 FROM bunbun_accounting.cafe_report_receipts WHERE report_id=r.id AND income_id=bank.id) THEN RAISE EXCEPTION 'Active linked net receipt required'; END IF;
  SELECT * INTO adv FROM bunbun_accounting.cafe_advances WHERE income_id=bank.id;
  IF p_action IN('review_advance','post_advance') THEN
   IF p_payload->>'cashAccount' IS NULL OR p_payload->>'cashAccount' NOT IN('1010','1020') OR EXISTS(SELECT 1 FROM bunbun_accounting.income_postings WHERE income_id=bank.id) THEN RAISE EXCEPTION 'Unposted receipt and actual receiving account required'; END IF;
   SELECT jsonb_agg(jsonb_build_object('month',c.month,'cafeKey',c.cafe_key,'amount',l.amount::text) ORDER BY c.month,c.cafe_key),sum(l.amount) INTO reservations,total
    FROM bunbun_accounting.cafe_report_receipts l JOIN bunbun_accounting.current_cafe_reports c ON c.report_id=l.report_id WHERE l.income_id=bank.id;
   IF total IS DISTINCT FROM bank.pemasukan_bunbun THEN RAISE EXCEPTION 'Reserve every portion of the full net receipt first'; END IF;
   effective:=bank.tanggal;
   source:=jsonb_build_object('income',to_jsonb(bank),'reservations',reservations);
  ELSE
   IF adv.income_id IS NULL THEN RAISE EXCEPTION 'Post actual advance receipt first'; END IF;
   effective:=(p_payload->>'applicationDate')::date;
   SELECT amount INTO reserved FROM bunbun_accounting.cafe_advance_reservations WHERE income_id=bank.id AND month=r.month AND cafe_key=r.cafe_key;
   IF reserved IS NULL OR effective<bank.tanggal THEN RAISE EXCEPTION 'Advance scope or application date differs'; END IF;
   SELECT coalesce(sum(t.amount),0) INTO spent FROM bunbun_accounting.cafe_advance_applications t JOIN bunbun_accounting.cafe_ledger_sales l ON l.sale_id=t.sale_id JOIN bunbun_accounting.cafe_reports p ON p.id=l.report_id WHERE t.income_id=bank.id AND p.month=r.month AND p.cafe_key=r.cafe_key;
   PERFORM 1 FROM bunbun_accounting.sale_postings WHERE sale_id IN(SELECT (x->>'saleId')::bigint FROM jsonb_array_elements(p_payload->'allocations') x) ORDER BY sale_id FOR UPDATE;
   IF jsonb_array_length(p_payload->'allocations') NOT BETWEEN 1 AND 50 OR (SELECT count(DISTINCT x->>'saleId') FROM jsonb_array_elements(p_payload->'allocations') x)<>jsonb_array_length(p_payload->'allocations') THEN RAISE EXCEPTION 'Unique invoice allocations required'; END IF;
   FOR choice IN SELECT a FROM jsonb_array_elements(p_payload->'allocations') a LOOP
    invoice:=(choice->>'saleId')::bigint; v_amount:=(choice->>'amount')::numeric;
    IF v_amount<=0 OR v_amount<>round(v_amount,2) OR NOT EXISTS(SELECT 1 FROM bunbun_accounting.cafe_ledger_sales WHERE report_id=r.id AND sale_id=invoice)
     OR EXISTS(SELECT 1 FROM bunbun_accounting.settlement_allocations WHERE income_id=bank.id AND sale_id=invoice)
     OR effective<(SELECT sale_date FROM public.sales WHERE id=invoice) THEN RAISE EXCEPTION 'Advance invoice, date or amount requires reconciliation'; END IF;
    SELECT coalesce(sum(a.amount),0) INTO paid FROM bunbun_accounting.settlement_allocations a WHERE a.sale_id=invoice;
    IF paid+v_amount>(SELECT net_entitlement FROM bunbun_accounting.sale_postings WHERE sale_id=invoice) THEN RAISE EXCEPTION 'Advance exceeds actual invoice balance'; END IF;
    total:=total+v_amount;
    selected:=selected||jsonb_build_array(jsonb_build_object('sale', (SELECT to_jsonb(s) FROM bunbun_accounting.sale_postings s WHERE s.sale_id=invoice),'amount',v_amount::text,'alreadyPaid',paid::text));
   END LOOP;
   IF spent+total>reserved OR (SELECT coalesce(sum(amount),0) FROM bunbun_accounting.cafe_advance_applications WHERE income_id=bank.id)+total>adv.amount THEN RAISE EXCEPTION 'Advance amount already consumed or exceeds reservation'; END IF;
   source:=jsonb_build_object('advance',to_jsonb(adv),'reserved',reserved::text,'spent',spent::text,'invoices',selected);
  END IF;
 ELSE
  IF p_payload->>'lossConfirmed' IS DISTINCT FROM 'true' OR r.summary->>'factsMatch' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confirmed reconciled cafe waste required'; END IF;
  IF EXISTS(SELECT 1 FROM bunbun_accounting.cafe_waste_postings WHERE report_id=r.id AND product_id=product) THEN RAISE EXCEPTION 'Cafe waste already valued'; END IF;
  SELECT (x->>'wasteQty')::integer INTO expected_qty FROM jsonb_array_elements(r.input->'rows') x WHERE (x->>'productId')::bigint=product;
  effective:=(p_payload->>'date')::date;
  IF expected_qty IS NULL OR expected_qty<=0 OR effective<>(r.month+interval '1 month'-interval '1 day')::date THEN RAISE EXCEPTION 'Waste requires actual monthly quantity and month-end date'; END IF;
  IF NOT EXISTS(SELECT 1 FROM bunbun_accounting.cafe_ledger_imports WHERE report_id=r.id)
    AND r.source_fingerprint IS DISTINCT FROM bunbun_accounting.cafe_report_sources(r.input)->>'fingerprint' THEN RAISE EXCEPTION 'Waste report source changed'; END IF;
  PERFORM 1 FROM bunbun_accounting.product_cost_positions WHERE location='CONSIGNMENT' AND cafe_key=r.cafe_key AND split_id IN(SELECT (x->>'splitId')::bigint FROM jsonb_array_elements(p_payload->'allocations') x) ORDER BY split_id FOR UPDATE;
  IF jsonb_array_length(p_payload->'allocations') NOT BETWEEN 1 AND 50 OR (SELECT count(DISTINCT x->>'splitId') FROM jsonb_array_elements(p_payload->'allocations') x)<>jsonb_array_length(p_payload->'allocations') THEN RAISE EXCEPTION 'Unique waste lot allocations required'; END IF;
  FOR choice IN SELECT a FROM jsonb_array_elements(p_payload->'allocations') a LOOP
   SELECT * INTO pos FROM bunbun_accounting.product_cost_positions WHERE split_id=(choice->>'splitId')::bigint AND location='CONSIGNMENT' AND cafe_key=r.cafe_key;
   remaining_qty:=(choice->>'quantity')::integer;
   IF pos.split_id IS NULL OR pos.product_id<>product OR remaining_qty<=0 OR remaining_qty>pos.quantity OR pos.posting_date>effective OR pos.source_date>effective THEN RAISE EXCEPTION 'Cafe waste lot/date/quantity differs'; END IF;
   value:=CASE WHEN remaining_qty=pos.quantity THEN pos.actual_value ELSE round(pos.actual_value*remaining_qty/pos.quantity,2) END;
   IF value<=0 THEN RAISE EXCEPTION 'Waste actual cost must be evidenced'; END IF;
   qty:=qty+remaining_qty;total:=total+value;
   selected:=selected||jsonb_build_array(jsonb_build_object('position',to_jsonb(pos),'quantity',remaining_qty,'value',value::text));
  END LOOP;
  IF qty<>expected_qty THEN RAISE EXCEPTION 'Waste lot quantities must equal reported waste'; END IF;
  source:=jsonb_build_object('report',to_jsonb(r),'lots',selected);
 END IF;
 IF effective IS NULL OR NOT EXISTS(SELECT 1 FROM bunbun_accounting.periods WHERE month_start=date_trunc('month',effective)::date AND status='OPEN')
  OR NOT EXISTS(SELECT 1 FROM bunbun_accounting.journals WHERE source_type='OPENING' AND status='POSTED' AND posting_date<=effective) THEN RAISE EXCEPTION 'Approved opening and open actual posting period required'; END IF;
 snap:=encode(sha256(convert_to(source::text,'UTF8')),'hex');
 IF p_action LIKE 'review_%' THEN RETURN jsonb_build_object('sourceSnapshot',snap,'mayConfirm',true,'amount',total::text,'date',effective,'quantity',qty,'details',CASE WHEN reservations IS NOT NULL THEN reservations ELSE selected END,'actualProfitAvailable',false); END IF;
 IF p_payload->>'sourceSnapshot' IS DISTINCT FROM snap THEN RAISE EXCEPTION 'Advance or waste source changed since review'; END IF;
 op:=(p_payload->>'operationKey')::uuid;
 SELECT id INTO pid FROM bunbun_accounting.periods WHERE month_start=date_trunc('month',effective)::date FOR UPDATE;
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key,cash_flow_category,narrative,created_by)
 VALUES(jid,pid,effective,'NORMAL','cafe-exception:'||op,op,CASE WHEN p_action='post_advance' THEN 'OPERATING' ELSE NULL END,p_payload->>'evidenceRef',p_actor_id);
 IF p_action='post_advance' THEN
  INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit) VALUES(jid,1,p_payload->>'cashAccount',total,0),(jid,2,'2130',0,total);
  PERFORM bunbun_accounting.post_reviewed_journal(jid,p_actor_id);
  INSERT INTO bunbun_accounting.income_postings(income_id,journal_id,source_snapshot,cash_account,evidence_ref,actor_id) VALUES(bank.id,jid,to_jsonb(bank),p_payload->>'cashAccount',p_payload->>'evidenceRef',p_actor_id);
  result:=jsonb_build_object('journalId',jid,'incomeId',bank.id::text,'advanceAmount',total::text,'actualProfitAvailable',false);
  INSERT INTO bunbun_accounting.cafe_advances(income_id,amount,operation_key,request,source_snapshot,result,actor_id) VALUES(bank.id,total,op,req,snap,result,p_actor_id);
  INSERT INTO bunbun_accounting.cafe_advance_reservations(income_id,month,cafe_key,amount) SELECT bank.id,(x->>'month')::date,x->>'cafeKey',(x->>'amount')::numeric FROM jsonb_array_elements(reservations) x;
 ELSIF p_action='post_apply' THEN
  INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit) VALUES(jid,1,'2130',total,0),(jid,2,'1120',0,total);
  PERFORM bunbun_accounting.post_reviewed_journal(jid,p_actor_id);
  INSERT INTO bunbun_accounting.settlement_allocations(income_id,sale_id,amount) SELECT bank.id,(x->>'saleId')::bigint,(x->>'amount')::numeric FROM jsonb_array_elements(p_payload->'allocations') x;
  INSERT INTO bunbun_accounting.cafe_advance_applications(income_id,sale_id,amount,applied_on,journal_id,operation_key) SELECT bank.id,(x->>'saleId')::bigint,(x->>'amount')::numeric,effective,jid,op FROM jsonb_array_elements(p_payload->'allocations') x;
  result:=jsonb_build_object('journalId',jid,'appliedAmount',total::text,'actualProfitAvailable',false);
 ELSE
  INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit,product_id) VALUES(jid,1,'6070',total,0,product),(jid,2,'1240',0,total,product);
  FOR choice IN SELECT a FROM jsonb_array_elements(selected) a LOOP
   pos:=jsonb_populate_record(NULL::bunbun_accounting.product_cost_positions,choice->'position');
   UPDATE bunbun_accounting.product_cost_positions SET quantity=quantity-(choice->>'quantity')::integer,actual_value=actual_value-(choice->>'value')::numeric,source_date=effective,posting_date=effective WHERE split_id=pos.split_id AND location='CONSIGNMENT' AND cafe_key=r.cafe_key;
   INSERT INTO bunbun_accounting.stock_cost_movements(journal_id,source_key,product_id,valuation_class,quantity_base,value_delta,base_unit) VALUES(jid,'cafe-waste:'||op||':'||pos.split_id,product,'CONSIGNMENT',-(choice->>'quantity')::integer,-(choice->>'value')::numeric,'pcs');
  END LOOP;
  PERFORM bunbun_accounting.post_reviewed_journal(jid,p_actor_id);
  result:=jsonb_build_object('journalId',jid,'actualWasteCost',total::text,'quantity',qty,'actualProfitAvailable',false);
  INSERT INTO bunbun_accounting.cafe_waste_postings(report_id,product_id,quantity,actual_value,journal_id,operation_key,request,source_snapshot,result,actor_id) VALUES(r.id,product,qty,total,jid,op,req,snap,result,p_actor_id);
  INSERT INTO bunbun_accounting.cafe_waste_lots(report_id,product_id,split_id,quantity,actual_value) SELECT r.id,product,(x->'position'->>'split_id')::bigint,(x->>'quantity')::integer,(x->>'value')::numeric FROM jsonb_array_elements(selected) x;
 END IF;
 INSERT INTO bunbun_accounting.cafe_exception_operations(operation_key,actor_id,request,result) VALUES(op,p_actor_id,req,result);
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.accounting_cafe_exception_service(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_cafe_exception_service(text,jsonb,uuid) TO service_role;
CREATE OR REPLACE FUNCTION bunbun_accounting.cafe_ledger_month_ready(p_month date) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE r bunbun_accounting.cafe_reports%rowtype; l record; net numeric; paid numeric; start_month date;
BEGIN
 SELECT date_trunc('month',min(posting_date))::date INTO start_month FROM bunbun_accounting.journals WHERE source_type='OPENING' AND status='POSTED';
 FOR r IN SELECT x.* FROM bunbun_accounting.current_cafe_reports c JOIN bunbun_accounting.cafe_reports x ON x.id=c.report_id
  WHERE c.month<=p_month AND c.month>=coalesce(start_month,'-infinity'::date) LOOP
  IF r.summary->>'factsMatch' IS DISTINCT FROM 'true' OR (r.input->>'confirmedCredit')::numeric<>0
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.input->'rows') x LEFT JOIN bunbun_accounting.cafe_waste_postings w ON w.report_id=r.id AND w.product_id=(x->>'productId')::bigint WHERE (x->>'wasteQty')::numeric>coalesce(w.quantity,0)) THEN RETURN false; END IF;
  SELECT coalesce(sum((x->>'regularNet')::numeric+(x->>'bundleNet')::numeric+(x->>'discountNet')::numeric),0) INTO net FROM jsonb_array_elements(r.input->'rows') x;
  IF net>0 AND NOT EXISTS(SELECT 1 FROM bunbun_accounting.cafe_ledger_imports WHERE report_id=r.id) THEN RETURN false; END IF;
  FOR l IN SELECT * FROM bunbun_accounting.cafe_report_receipts WHERE report_id=r.id LOOP
   IF NOT EXISTS(SELECT 1 FROM bunbun_accounting.income_postings WHERE income_id=l.income_id)
    OR coalesce((SELECT sum(a.amount) FROM bunbun_accounting.settlement_allocations a JOIN bunbun_accounting.cafe_ledger_sales z ON z.sale_id=a.sale_id WHERE z.report_id=r.id AND a.income_id=l.income_id),0)<>l.amount THEN RETURN false; END IF;
  END LOOP;
  SELECT coalesce(sum(a.amount),0) INTO paid FROM bunbun_accounting.settlement_allocations a JOIN bunbun_accounting.cafe_ledger_sales z ON z.sale_id=a.sale_id JOIN public.incomes i ON i.id=a.income_id LEFT JOIN bunbun_accounting.cafe_advance_applications t ON t.income_id=a.income_id AND t.sale_id=a.sale_id
   WHERE z.report_id=r.id AND coalesce(t.applied_on,i.tanggal)<=(r.input->>'asOfDate')::date;
  IF net-paid<>(r.input->>'confirmedUnpaid')::numeric THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.cafe_ledger_month_ready(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.cafe_ledger_month_ready(date) TO service_role;
COMMIT;
