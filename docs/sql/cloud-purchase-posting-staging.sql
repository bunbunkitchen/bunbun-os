-- Isolated staging pkgrqalpazhwdcxmthvb only. Private backend integration.
-- No opening approval or real document is created by this migration.
BEGIN;
CREATE TABLE bunbun_accounting.purchase_postings (
 purchase_id bigint PRIMARY KEY REFERENCES public.purchases(id),
 expense_id bigint NOT NULL UNIQUE REFERENCES public.expenses(id),
 receipt_id bigint NOT NULL UNIQUE REFERENCES public.inventory_transactions(id),
 invoice_journal_id uuid NOT NULL UNIQUE REFERENCES bunbun_accounting.journals(id),
 payment_journal_id uuid NOT NULL UNIQUE REFERENCES bunbun_accounting.journals(id),
 purchase_snapshot jsonb NOT NULL,
 expense_snapshot jsonb NOT NULL,
 receipt_snapshot jsonb NOT NULL,
 cash_account text NOT NULL CHECK(cash_account IN ('1010','1020')),
 evidence_ref text NOT NULL CHECK(length(btrim(evidence_ref)) BETWEEN 6 AND 500),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bunbun_accounting.purchase_postings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bunbun_accounting.purchase_postings FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON bunbun_accounting.purchase_postings TO service_role;

CREATE FUNCTION bunbun_accounting.post_paid_ingredient_purchase(
 p_purchase_id bigint, p_expected_purchase jsonb, p_expected_expense jsonb,
 p_cash_account text, p_evidence_ref text, p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
 p public.purchases%rowtype; e public.expenses%rowtype; r public.inventory_transactions%rowtype;
 old bunbun_accounting.purchase_postings%rowtype;
 ip uuid; ep uuid; ij uuid:=gen_random_uuid(); ej uuid:=gen_random_uuid();
 n integer; unit_base text; quantity_base numeric; factor numeric;
BEGIN
 IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Private backend required'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND role::text='owner' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Owner approval required'; END IF;
 IF p_cash_account IS NULL OR p_cash_account NOT IN ('1010','1020') OR p_evidence_ref IS NULL
 OR length(btrim(p_evidence_ref)) NOT BETWEEN 6 AND 500 THEN RAISE EXCEPTION 'Cash account and evidence required'; END IF;
 SELECT * INTO p FROM public.purchases WHERE id=p_purchase_id FOR UPDATE;
 IF NOT FOUND OR p.is_deleted IS DISTINCT FROM false OR p.ingredient_id IS NULL
 OR p.maintenance_item_id IS NOT NULL OR p.total IS NULL OR p.total<=0 OR p.jumlah IS NULL OR p.jumlah<=0
 OR p.total<>round(p.total,2) THEN RAISE EXCEPTION 'Valid positive ingredient invoice required'; END IF;
 IF to_jsonb(p) IS DISTINCT FROM p_expected_purchase THEN RAISE EXCEPTION 'Purchase changed since review'; END IF;
 -- Lock the parent before child rows; the same order is used by source guards.
 PERFORM 1 FROM public.expenses WHERE purchase_id=p.id ORDER BY id FOR UPDATE;
 SELECT count(*) INTO n FROM public.expenses WHERE purchase_id=p.id AND NOT is_deleted;
 IF n<>1 THEN RAISE EXCEPTION 'Exactly one full linked payment required'; END IF;
 SELECT * INTO e FROM public.expenses WHERE purchase_id=p.id AND NOT is_deleted;
 IF to_jsonb(e) IS DISTINCT FROM p_expected_expense THEN RAISE EXCEPTION 'Payment changed since review'; END IF;
 IF e.nominal IS DISTINCT FROM p.total OR e.tanggal<p.tanggal THEN RAISE EXCEPTION 'Payment amount/date mismatch'; END IF;
 PERFORM 1 FROM public.inventory_transactions WHERE purchase_id=p.id ORDER BY id FOR UPDATE;
 SELECT count(*) INTO n FROM public.inventory_transactions WHERE purchase_id=p.id AND NOT is_deleted;
 IF n<>1 THEN RAISE EXCEPTION 'Exactly one purchase receipt required'; END IF;
 SELECT * INTO r FROM public.inventory_transactions WHERE purchase_id=p.id AND NOT is_deleted;
 IF r.transaction_type<>'PURCHASE' OR r.ingredient_id IS DISTINCT FROM p.ingredient_id
 OR r.maintenance_item_id IS NOT NULL OR r.transaction_date IS DISTINCT FROM p.tanggal
 OR r.qty IS DISTINCT FROM p.jumlah OR lower(btrim(r.unit)) IS DISTINCT FROM lower(btrim(p.satuan))
 THEN RAISE EXCEPTION 'Purchase receipt mismatch'; END IF;
 CASE lower(btrim(p.satuan))
 WHEN 'kg' THEN unit_base:='g';factor:=1000;
 WHEN 'g' THEN unit_base:='g';factor:=1;
 WHEN 'gr' THEN unit_base:='g';factor:=1;
 WHEN 'gram' THEN unit_base:='g';factor:=1;
 WHEN 'l' THEN unit_base:='ml';factor:=1000;
 WHEN 'liter' THEN unit_base:='ml';factor:=1000;
 WHEN 'ml' THEN unit_base:='ml';factor:=1;
 WHEN 'pc' THEN unit_base:='pcs';factor:=1;
 WHEN 'pcs' THEN unit_base:='pcs';factor:=1;
 ELSE RAISE EXCEPTION 'Unsupported purchase unit'; END CASE;
 quantity_base:=p.jumlah*factor;
 SELECT * INTO old FROM bunbun_accounting.purchase_postings WHERE purchase_id=p.id;
 IF FOUND THEN
   IF old.purchase_snapshot IS DISTINCT FROM to_jsonb(p) OR old.expense_snapshot IS DISTINCT FROM to_jsonb(e)
   OR old.receipt_snapshot IS DISTINCT FROM to_jsonb(r) OR old.cash_account IS DISTINCT FROM p_cash_account
   OR old.evidence_ref IS DISTINCT FROM btrim(p_evidence_ref) THEN RAISE EXCEPTION 'Posted source/review mismatch'; END IF;
   IF EXISTS(SELECT 1 FROM bunbun_accounting.journals WHERE reversal_of IN (old.invoice_journal_id,old.payment_journal_id))
   THEN RAISE EXCEPTION 'Purchase reversed; requires reconciliation'; END IF;
   RETURN jsonb_build_object('already_posted',true,'invoice_journal_id',old.invoice_journal_id,'payment_journal_id',old.payment_journal_id);
 END IF;
 SELECT id INTO ip FROM bunbun_accounting.periods WHERE month_start=date_trunc('month',p.tanggal)::date;
 SELECT id INTO ep FROM bunbun_accounting.periods WHERE month_start=date_trunc('month',e.tanggal)::date;
 IF ip IS NULL OR ep IS NULL THEN RAISE EXCEPTION 'Accounting periods required'; END IF;
 -- Serialize period checks/posting in date order, including month-crossing invoices.
 PERFORM 1 FROM bunbun_accounting.periods WHERE id IN(ip,ep) ORDER BY month_start FOR UPDATE;
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key,narrative,created_by)
 VALUES(ij,ip,p.tanggal,'NORMAL','purchase:'||p.id,gen_random_uuid(),btrim(p_evidence_ref),p_actor_id);
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit,ingredient_id)
 VALUES(ij,1,'1210',p.total,0,p.ingredient_id),(ij,2,'2010',0,p.total,p.ingredient_id);
 INSERT INTO bunbun_accounting.stock_cost_movements(journal_id,source_key,ingredient_id,valuation_class,quantity_base,value_delta,base_unit)
 VALUES(ij,'purchase:'||p.id,p.ingredient_id,'RAW',quantity_base,p.total,unit_base);
 PERFORM bunbun_accounting.post_reviewed_journal(ij,p_actor_id);
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key,cash_flow_category,narrative,created_by)
 VALUES(ej,ep,e.tanggal,'NORMAL','purchase-payment:'||e.id,gen_random_uuid(),'OPERATING',btrim(p_evidence_ref),p_actor_id);
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit)
 VALUES(ej,1,'2010',e.nominal,0),(ej,2,p_cash_account,0,e.nominal);
 PERFORM bunbun_accounting.post_reviewed_journal(ej,p_actor_id);
 INSERT INTO bunbun_accounting.purchase_postings(purchase_id,expense_id,receipt_id,invoice_journal_id,payment_journal_id,
 purchase_snapshot,expense_snapshot,receipt_snapshot,cash_account,evidence_ref,actor_id)
 VALUES(p.id,e.id,r.id,ij,ej,to_jsonb(p),to_jsonb(e),to_jsonb(r),p_cash_account,btrim(p_evidence_ref),p_actor_id);
 RETURN jsonb_build_object('already_posted',false,'invoice_journal_id',ij,'payment_journal_id',ej);
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.post_paid_ingredient_purchase(bigint,jsonb,jsonb,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.post_paid_ingredient_purchase(bigint,jsonb,jsonb,text,text,uuid) TO service_role;

-- Trigger-only definer: clients cannot access the private mapping, but cannot
-- alter or append source rows once the document is posted. No general RPC.
CREATE FUNCTION bunbun_accounting.guard_posted_purchase_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE old_pid bigint; new_pid bigint; pid bigint;
BEGIN
 IF TG_TABLE_NAME='purchases' THEN
   IF TG_OP<>'INSERT' THEN old_pid:=OLD.id; END IF;
   IF TG_OP<>'DELETE' THEN new_pid:=NEW.id; END IF;
 ELSE
   IF TG_OP<>'INSERT' THEN old_pid:=OLD.purchase_id; END IF;
   IF TG_OP<>'DELETE' THEN new_pid:=NEW.purchase_id; END IF;
 END IF;
 FOR pid IN SELECT DISTINCT x FROM unnest(ARRAY[old_pid,new_pid]) x WHERE x IS NOT NULL ORDER BY x LOOP
   -- Parent UPDATE is already row-locked; child writes serialize with posting.
   IF TG_TABLE_NAME<>'purchases' THEN PERFORM 1 FROM public.purchases WHERE id=pid FOR UPDATE; END IF;
   IF EXISTS(SELECT 1 FROM bunbun_accounting.purchase_postings WHERE purchase_id=pid) THEN
     RAISE EXCEPTION 'Pembelian sudah dijurnal. Perubahan sumber memerlukan alur koreksi akuntansi.' USING ERRCODE='55000';
   END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.guard_posted_purchase_source() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_accounting_purchase BEFORE UPDATE OR DELETE ON public.purchases
FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_posted_purchase_source();
CREATE TRIGGER guard_accounting_purchase_expense BEFORE INSERT OR UPDATE OR DELETE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_posted_purchase_source();
CREATE TRIGGER guard_accounting_purchase_receipt BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_transactions
FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_posted_purchase_source();
COMMIT;
