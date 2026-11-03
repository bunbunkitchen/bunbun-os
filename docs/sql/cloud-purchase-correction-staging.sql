-- ISOLATED STAGING pkgrqalpazhwdcxmthvb ONLY. No real source rows posted.
-- Supports price/full-payment and cash-account correction; quantity/date/item
-- corrections and supplier returns need their own operational workflows.
BEGIN;
ALTER TABLE bunbun_accounting.purchase_postings ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
CREATE TABLE bunbun_accounting.purchase_corrections (
 operation_key uuid PRIMARY KEY,
 purchase_id bigint NOT NULL REFERENCES public.purchases(id),
 revision integer NOT NULL,
 request jsonb NOT NULL,
 previous_posting jsonb NOT NULL,
 current_posting jsonb NOT NULL,
 reversal_invoice_id uuid NOT NULL UNIQUE REFERENCES bunbun_accounting.journals(id),
 reversal_payment_id uuid NOT NULL UNIQUE REFERENCES bunbun_accounting.journals(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(purchase_id,revision)
);
ALTER TABLE bunbun_accounting.purchase_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bunbun_accounting.purchase_corrections FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON bunbun_accounting.purchase_corrections TO service_role;
GRANT UPDATE ON bunbun_accounting.purchase_postings TO service_role;

CREATE OR REPLACE FUNCTION bunbun_accounting.guard_posted_purchase_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE old_pid bigint; new_pid bigint; pid bigint; ingredient bigint; controlled boolean:=false;
BEGIN
 IF TG_TABLE_NAME='purchases' THEN
   IF TG_OP<>'INSERT' THEN old_pid:=OLD.id; END IF;
   IF TG_OP<>'DELETE' THEN new_pid:=NEW.id; END IF;
 ELSE
   IF TG_OP<>'INSERT' THEN old_pid:=OLD.purchase_id; END IF;
   IF TG_OP<>'DELETE' THEN new_pid:=NEW.purchase_id; END IF;
 END IF;
 FOR pid IN SELECT DISTINCT x FROM unnest(ARRAY[old_pid,new_pid]) x WHERE x IS NOT NULL ORDER BY x LOOP
   IF TG_TABLE_NAME<>'purchases' THEN PERFORM 1 FROM public.purchases WHERE id=pid FOR UPDATE; END IF;
   IF EXISTS(SELECT 1 FROM bunbun_accounting.purchase_postings WHERE purchase_id=pid) THEN
     controlled:=false;
     IF TG_OP='UPDATE' AND current_setting('role',true)='service_role'
     AND current_setting('bunbun_accounting.correcting_purchase',true)=pid::text THEN
       IF TG_TABLE_NAME='purchases' THEN
         controlled:=(to_jsonb(OLD)-ARRAY['total','harga_satuan','updated_by','updated_at'])
           IS NOT DISTINCT FROM (to_jsonb(NEW)-ARRAY['total','harga_satuan','updated_by','updated_at']);
       ELSIF TG_TABLE_NAME='expenses' THEN
         controlled:=(to_jsonb(OLD)-ARRAY['nominal','updated_by','updated_at'])
           IS NOT DISTINCT FROM (to_jsonb(NEW)-ARRAY['nominal','updated_by','updated_at']);
       END IF;
     END IF;
     IF NOT controlled THEN RAISE EXCEPTION 'Pembelian sudah dijurnal. Perubahan sumber memerlukan alur koreksi akuntansi.' USING ERRCODE='55000'; END IF;
   END IF;
 END LOOP;
 -- All ingredient movement writes serialize with price correction, including
 -- production usage without a purchase_id. No role bypass for this lock.
 IF TG_TABLE_NAME='inventory_transactions' THEN
   FOR ingredient IN SELECT DISTINCT x FROM unnest(ARRAY[
     CASE WHEN TG_OP<>'INSERT' THEN OLD.ingredient_id END,
     CASE WHEN TG_OP<>'DELETE' THEN NEW.ingredient_id END]) x WHERE x IS NOT NULL ORDER BY x LOOP
     PERFORM 1 FROM public.ingredients WHERE id=ingredient FOR UPDATE;
   END LOOP;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.guard_posted_purchase_source() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION bunbun_accounting.correct_paid_ingredient_purchase(
 p_purchase_id bigint, p_expected_purchase jsonb, p_expected_expense jsonb,
 p_new_unit_price numeric, p_cash_account text, p_evidence_ref text,
 p_operation_key uuid, p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
 p public.purchases%rowtype; e public.expenses%rowtype; r public.inventory_transactions%rowtype;
 old bunbun_accounting.purchase_postings%rowtype; fresh bunbun_accounting.purchase_postings%rowtype;
 previous bunbun_accounting.purchase_corrections%rowtype;
 cost bunbun_accounting.stock_cost_movements%rowtype;
 original bunbun_accounting.journals%rowtype;
 request jsonb; new_total numeric; invoice uuid:=gen_random_uuid(); payment uuid:=gen_random_uuid();
 reverse_invoice uuid:=gen_random_uuid(); reverse_payment uuid:=gen_random_uuid(); rev uuid;
 invoice_period uuid; payment_period uuid; revision_number integer;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Private backend required'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND role::text='owner' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Owner approval required'; END IF;
 IF p_operation_key IS NULL OR p_new_unit_price IS NULL OR p_new_unit_price::text IN('NaN','Infinity','-Infinity')
 OR p_new_unit_price<=0 OR p_new_unit_price<>round(p_new_unit_price,2)
 OR p_cash_account IS NULL OR p_cash_account NOT IN('1010','1020')
 OR p_evidence_ref IS NULL OR length(btrim(p_evidence_ref)) NOT BETWEEN 6 AND 500
 THEN RAISE EXCEPTION 'Valid correction price, cash account, evidence and operation required'; END IF;
 request:=jsonb_build_object('purchase_id',p_purchase_id,'purchase',p_expected_purchase,'expense',p_expected_expense,
   'unit_price',p_new_unit_price,'cash_account',p_cash_account,'evidence',btrim(p_evidence_ref),'actor',p_actor_id);
 SELECT * INTO p FROM public.purchases WHERE id=p_purchase_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Purchase not found'; END IF;
 SELECT * INTO previous FROM bunbun_accounting.purchase_corrections WHERE operation_key=p_operation_key;
 IF FOUND THEN
   IF previous.request IS DISTINCT FROM request THEN RAISE EXCEPTION 'Correction operation reused with different request'; END IF;
   RETURN previous.current_posting || jsonb_build_object('already_corrected',true);
 END IF;
 SELECT * INTO old FROM bunbun_accounting.purchase_postings WHERE purchase_id=p.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Posted purchase required'; END IF;
 SELECT * INTO e FROM public.expenses WHERE id=old.expense_id FOR UPDATE;
 SELECT * INTO r FROM public.inventory_transactions WHERE id=old.receipt_id FOR UPDATE;
 IF to_jsonb(p) IS DISTINCT FROM p_expected_purchase OR to_jsonb(e) IS DISTINCT FROM p_expected_expense
 OR to_jsonb(p) IS DISTINCT FROM old.purchase_snapshot OR to_jsonb(e) IS DISTINCT FROM old.expense_snapshot
 OR to_jsonb(r) IS DISTINCT FROM old.receipt_snapshot THEN RAISE EXCEPTION 'Correction source changed since review'; END IF;
 IF p.jumlah_sediaan IS NULL OR p.jumlah_sediaan<=0 OR p.jumlah_sediaan::text IN('NaN','Infinity','-Infinity')
 OR p.is_deleted OR e.is_deleted OR r.is_deleted THEN RAISE EXCEPTION 'Verified package quantity and active sources required'; END IF;
 new_total:=p_new_unit_price*p.jumlah_sediaan;
 IF new_total<>round(new_total,2) OR new_total>999999999999.99 THEN RAISE EXCEPTION 'Correction total outside supported precision'; END IF;
 IF p.total=new_total AND old.cash_account=p_cash_account THEN RAISE EXCEPTION 'No financial correction requested'; END IF;
 PERFORM 1 FROM public.ingredients WHERE id=p.ingredient_id FOR UPDATE;
 -- Price changes after consumption need downstream cost revaluation, which is
 -- not silently approximated here. Cash-account-only corrections remain valid.
 IF new_total<>p.total AND (EXISTS(SELECT 1 FROM public.inventory_transactions x
   WHERE x.ingredient_id=p.ingredient_id AND NOT x.is_deleted AND x.transaction_date>=p.tanggal
   AND x.transaction_type NOT IN('PURCHASE','PRODUCTION_IN','ADJUSTMENT_IN','NON_PURCHASE_IN'))
 OR EXISTS(SELECT 1 FROM bunbun_accounting.stock_cost_movements m JOIN bunbun_accounting.journals j ON j.id=m.journal_id
   WHERE m.ingredient_id=p.ingredient_id AND m.quantity_base<0 AND j.status='POSTED' AND j.source_type<>'REVERSAL' AND j.posting_date>=p.tanggal))
 THEN RAISE EXCEPTION 'Consumed ingredient requires downstream cost revaluation'; END IF;
 SELECT * INTO cost FROM bunbun_accounting.stock_cost_movements WHERE journal_id=old.invoice_journal_id;
 IF NOT FOUND OR cost.quantity_base<=0 OR cost.value_delta IS DISTINCT FROM p.total THEN RAISE EXCEPTION 'Original purchase cost missing or inconsistent'; END IF;
 SELECT period_id INTO invoice_period FROM bunbun_accounting.journals WHERE id=old.invoice_journal_id;
 SELECT period_id INTO payment_period FROM bunbun_accounting.journals WHERE id=old.payment_journal_id;
 PERFORM 1 FROM bunbun_accounting.periods WHERE id IN(invoice_period,payment_period) ORDER BY month_start FOR UPDATE;
 IF EXISTS(SELECT 1 FROM bunbun_accounting.periods WHERE id IN(invoice_period,payment_period) AND status<>'OPEN')
 THEN RAISE EXCEPTION 'Correction requires original periods OPEN'; END IF;
 revision_number:=old.revision+1;
 FOR original IN SELECT * FROM bunbun_accounting.journals WHERE id IN(old.invoice_journal_id,old.payment_journal_id) ORDER BY id LOOP
   IF original.status<>'POSTED' OR original.source_type<>'NORMAL'
   OR EXISTS(SELECT 1 FROM bunbun_accounting.journals WHERE reversal_of=original.id)
   THEN RAISE EXCEPTION 'Original journal is not reversible'; END IF;
   rev:=CASE WHEN original.id=old.invoice_journal_id THEN reverse_invoice ELSE reverse_payment END;
   INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key,cash_flow_category,reversal_of,narrative,created_by)
   VALUES(rev,original.period_id,original.posting_date,'REVERSAL','purchase-correction-reversal:'||original.id,
     gen_random_uuid(),original.cash_flow_category,original.id,btrim(p_evidence_ref),p_actor_id);
   INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit,product_id,ingredient_id,batch_id,note)
   SELECT rev,line_number,account_code,credit,debit,product_id,ingredient_id,batch_id,note
   FROM bunbun_accounting.journal_lines WHERE journal_id=original.id;
   PERFORM bunbun_accounting.post_reviewed_journal(rev,p_actor_id);
 END LOOP;
 INSERT INTO bunbun_accounting.stock_cost_movements(journal_id,source_key,ingredient_id,valuation_class,quantity_base,value_delta,base_unit)
 VALUES(reverse_invoice,'purchase-correction-reversal:'||old.invoice_journal_id,p.ingredient_id,'RAW',-cost.quantity_base,-cost.value_delta,cost.base_unit);
 PERFORM set_config('bunbun_accounting.correcting_purchase',p.id::text,true);
 UPDATE public.purchases SET total=new_total,harga_satuan=p_new_unit_price,updated_by=p_actor_id WHERE id=p.id RETURNING * INTO p;
 UPDATE public.expenses SET nominal=new_total,updated_by=p_actor_id WHERE id=e.id RETURNING * INTO e;
 PERFORM set_config('bunbun_accounting.correcting_purchase','',true);
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key,narrative,created_by)
 VALUES(invoice,invoice_period,p.tanggal,'NORMAL','purchase:'||p.id||':revision:'||revision_number,gen_random_uuid(),btrim(p_evidence_ref),p_actor_id);
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit,ingredient_id)
 VALUES(invoice,1,'1210',new_total,0,p.ingredient_id),(invoice,2,'2010',0,new_total,p.ingredient_id);
 INSERT INTO bunbun_accounting.stock_cost_movements(journal_id,source_key,ingredient_id,valuation_class,quantity_base,value_delta,base_unit)
 VALUES(invoice,'purchase:'||p.id||':revision:'||revision_number,p.ingredient_id,'RAW',cost.quantity_base,new_total,cost.base_unit);
 PERFORM bunbun_accounting.post_reviewed_journal(invoice,p_actor_id);
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key,cash_flow_category,narrative,created_by)
 VALUES(payment,payment_period,e.tanggal,'NORMAL','purchase-payment:'||e.id||':revision:'||revision_number,gen_random_uuid(),'OPERATING',btrim(p_evidence_ref),p_actor_id);
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit)
 VALUES(payment,1,'2010',new_total,0),(payment,2,p_cash_account,0,new_total);
 PERFORM bunbun_accounting.post_reviewed_journal(payment,p_actor_id);
 UPDATE bunbun_accounting.purchase_postings SET invoice_journal_id=invoice,payment_journal_id=payment,
   purchase_snapshot=to_jsonb(p),expense_snapshot=to_jsonb(e),cash_account=p_cash_account,
   evidence_ref=btrim(p_evidence_ref),actor_id=p_actor_id,revision=revision_number
 WHERE purchase_id=p.id RETURNING * INTO fresh;
 INSERT INTO bunbun_accounting.purchase_corrections(operation_key,purchase_id,revision,request,previous_posting,current_posting,reversal_invoice_id,reversal_payment_id,actor_id)
 VALUES(p_operation_key,p.id,revision_number,request,to_jsonb(old),to_jsonb(fresh),reverse_invoice,reverse_payment,p_actor_id);
 INSERT INTO bunbun_accounting.audit_events(actor_id,action,entity_type,entity_id,details)
 VALUES(p_actor_id,'CORRECT_PAID_PURCHASE','purchase',p.id::text,jsonb_build_object('operation_key',p_operation_key,'revision',revision_number,
   'previous_total',(old.purchase_snapshot->>'total')::numeric,'corrected_total',new_total,'evidence',btrim(p_evidence_ref)));
 RETURN to_jsonb(fresh)||jsonb_build_object('already_corrected',false);
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.correct_paid_ingredient_purchase(bigint,jsonb,jsonb,numeric,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.correct_paid_ingredient_purchase(bigint,jsonb,jsonb,numeric,text,text,uuid,uuid) TO service_role;
COMMIT;
