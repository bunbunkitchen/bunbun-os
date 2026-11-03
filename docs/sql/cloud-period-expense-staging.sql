-- ISOLATED STAGING pkgrqalpazhwdcxmthvb ONLY. No real journal/period created.
BEGIN;
ALTER TABLE public.expenses DROP CONSTRAINT expenses_kategori_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_kategori_check
 CHECK(kategori IN('Gaji','Bahan Baku','Maintenance','Utilitas','Sewa','Operasional Lain'));
CREATE TABLE bunbun_accounting.expense_postings (
 expense_id bigint PRIMARY KEY REFERENCES public.expenses(id),
 journal_id uuid NOT NULL UNIQUE REFERENCES bunbun_accounting.journals(id),
 source_snapshot jsonb NOT NULL,
 expense_account text NOT NULL CHECK(expense_account IN('6010','6020','6030','6050','6060')),
 cash_account text NOT NULL CHECK(cash_account IN('1010','1020')),
 evidence_ref text NOT NULL CHECK(length(btrim(evidence_ref)) BETWEEN 6 AND 500),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 actor_id uuid NOT NULL REFERENCES auth.users(id)
);
CREATE TABLE bunbun_accounting.expense_posting_operations (
 operation_key uuid PRIMARY KEY,
 expense_id bigint NOT NULL REFERENCES public.expenses(id),
 request jsonb NOT NULL,
 previous_posting jsonb,
 result jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bunbun_accounting.expense_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bunbun_accounting.expense_posting_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bunbun_accounting.expense_postings,bunbun_accounting.expense_posting_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON bunbun_accounting.expense_postings TO service_role;
GRANT SELECT,INSERT ON bunbun_accounting.expense_posting_operations TO service_role;

CREATE FUNCTION bunbun_accounting.guard_posted_period_expense() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF EXISTS(SELECT 1 FROM bunbun_accounting.expense_postings WHERE expense_id=OLD.id) THEN
   IF TG_OP='UPDATE' AND current_setting('role',true)='service_role'
   AND current_setting('bunbun_accounting.correcting_expense',true)=OLD.id::text
   AND (to_jsonb(OLD)-ARRAY['nominal','updated_by','updated_at']) IS NOT DISTINCT FROM
       (to_jsonb(NEW)-ARRAY['nominal','updated_by','updated_at']) THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'Pengeluaran sudah dijurnal. Gunakan koreksi akuntansi.' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.guard_posted_period_expense() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_accounting_period_expense BEFORE UPDATE OR DELETE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION bunbun_accounting.guard_posted_period_expense();

CREATE FUNCTION bunbun_accounting.process_period_expense(p_action text,p_payload jsonb,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
 e public.expenses%rowtype; old bunbun_accounting.expense_postings%rowtype;
 operation bunbun_accounting.expense_posting_operations%rowtype;
 j bunbun_accounting.journals%rowtype;
 v_id bigint; period_id uuid; new_journal uuid:=gen_random_uuid(); reversal uuid:=gen_random_uuid();
 v_operation_key uuid; amount numeric; account text; cash text; evidence text; revision integer;
 result jsonb; request jsonb;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Private backend required'; END IF;
 IF p_action='review' THEN
   IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='owner' AND is_active)
   THEN RAISE EXCEPTION 'Active Owner approval required'; END IF;
 ELSE
   PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND role::text='owner' AND is_active FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Active Owner approval required'; END IF;
 END IF;
 v_id:=(p_payload->>'expenseId')::bigint;
 IF p_action='review' THEN
   SELECT * INTO e FROM public.expenses WHERE id=v_id AND NOT is_deleted;
   IF NOT FOUND THEN RETURN NULL; END IF;
   SELECT * INTO old FROM bunbun_accounting.expense_postings WHERE expense_id=e.id;
   RETURN jsonb_build_object('sourceSnapshot',to_jsonb(e)::text,'amount',e.nominal::text,'date',e.tanggal,
     'category',e.kategori,'description',e.keterangan,'posted',old.expense_id IS NOT NULL,
     'expenseAccount',old.expense_account,'cashAccount',old.cash_account,
     'sourceComplete',e.purchase_id IS NULL AND e.nominal>0 AND e.nominal::text NOT IN('NaN','Infinity','-Infinity'),
     'periodReady',EXISTS(SELECT 1 FROM bunbun_accounting.journals x WHERE x.source_type='OPENING' AND x.status='POSTED' AND x.posting_date<=e.tanggal)
       AND EXISTS(SELECT 1 FROM bunbun_accounting.periods x WHERE x.month_start=date_trunc('month',e.tanggal)::date AND x.status='OPEN'));
 END IF;
 IF p_action IS NULL OR p_action NOT IN('post','correct') OR p_payload->>'costScope' IS DISTINCT FROM 'PERIOD_NONPRODUCTION'
 THEN RAISE EXCEPTION 'Nonproduction period expense review required'; END IF;
 account:=p_payload->>'expenseAccount'; cash:=p_payload->>'cashAccount'; evidence:=btrim(p_payload->>'evidenceRef');
 v_operation_key:=(p_payload->>'operationKey')::uuid;
 IF account IS NULL OR account NOT IN('6010','6020','6030','6050','6060')
 OR cash IS NULL OR cash NOT IN('1010','1020') OR evidence IS NULL OR length(evidence) NOT BETWEEN 6 AND 500
 OR v_operation_key IS NULL THEN RAISE EXCEPTION 'Valid accounts, evidence and operation required'; END IF;
 SELECT * INTO e FROM public.expenses WHERE id=v_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
 request:=jsonb_build_object('action',p_action,'payload',p_payload,'actor',p_actor_id);
 SELECT * INTO operation FROM bunbun_accounting.expense_posting_operations x WHERE x.operation_key=v_operation_key;
 IF FOUND THEN
   IF operation.request IS DISTINCT FROM request THEN RAISE EXCEPTION 'Operation reused with different expense request'; END IF;
   RETURN operation.result||jsonb_build_object('alreadyProcessed',true);
 END IF;
 IF e.purchase_id IS NOT NULL THEN RAISE EXCEPTION 'Purchase-linked expense must use purchasing workflow'; END IF;
 IF e.is_deleted IS DISTINCT FROM false OR to_jsonb(e) IS DISTINCT FROM (p_payload->>'sourceSnapshot')::jsonb
 THEN RAISE EXCEPTION 'Expense changed since review'; END IF;
 amount:=CASE WHEN p_action='correct' THEN (p_payload->>'newAmount')::numeric ELSE e.nominal END;
 IF amount IS NULL OR amount<=0 OR amount::text IN('NaN','Infinity','-Infinity') OR amount<>round(amount,2)
 OR amount>999999999999.99 THEN RAISE EXCEPTION 'Valid positive expense amount required'; END IF;
 SELECT * INTO old FROM bunbun_accounting.expense_postings WHERE expense_id=e.id FOR UPDATE;
 IF p_action='post' AND FOUND THEN
   IF old.source_snapshot IS DISTINCT FROM to_jsonb(e) OR old.expense_account IS DISTINCT FROM account
   OR old.cash_account IS DISTINCT FROM cash OR old.evidence_ref IS DISTINCT FROM evidence
   THEN RAISE EXCEPTION 'Expense already posted with different review'; END IF;
   RETURN jsonb_build_object('journalId',old.journal_id,'revision',old.revision,'alreadyProcessed',true);
 ELSIF p_action='correct' AND NOT FOUND THEN RAISE EXCEPTION 'Posted expense required'; END IF;
 IF p_action='correct' AND (old.source_snapshot IS DISTINCT FROM to_jsonb(e)) THEN RAISE EXCEPTION 'Posted expense source mismatch'; END IF;
 SELECT id INTO period_id FROM bunbun_accounting.periods WHERE month_start=date_trunc('month',e.tanggal)::date FOR UPDATE;
 IF period_id IS NULL THEN RAISE EXCEPTION 'Accounting period required'; END IF;
 IF p_action='correct' THEN
   SELECT * INTO j FROM bunbun_accounting.journals WHERE id=old.journal_id;
   IF j.status IS DISTINCT FROM 'POSTED' OR j.source_type IS DISTINCT FROM 'NORMAL'
   OR EXISTS(SELECT 1 FROM bunbun_accounting.journals WHERE reversal_of=j.id)
   THEN RAISE EXCEPTION 'Original expense journal is not reversible'; END IF;
   IF old.expense_account=account AND old.cash_account=cash AND amount=e.nominal THEN RAISE EXCEPTION 'No expense correction requested'; END IF;
   INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key,cash_flow_category,reversal_of,narrative,created_by)
   VALUES(reversal,period_id,e.tanggal,'REVERSAL','expense-reversal:'||j.id,gen_random_uuid(),'OPERATING',j.id,evidence,p_actor_id);
   INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit,note)
   SELECT reversal,line_number,account_code,credit,debit,note FROM bunbun_accounting.journal_lines WHERE journal_id=j.id;
   PERFORM bunbun_accounting.post_reviewed_journal(reversal,p_actor_id);
   PERFORM set_config('bunbun_accounting.correcting_expense',e.id::text,true);
   UPDATE public.expenses SET nominal=amount,updated_by=p_actor_id WHERE id=e.id RETURNING * INTO e;
   PERFORM set_config('bunbun_accounting.correcting_expense','',true);
 END IF;
 revision:=coalesce(old.revision,0)+1;
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key,cash_flow_category,narrative,created_by)
 VALUES(new_journal,period_id,e.tanggal,'NORMAL','expense:'||e.id||':revision:'||revision,gen_random_uuid(),'OPERATING',evidence,p_actor_id);
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit)
 VALUES(new_journal,1,account,amount,0),(new_journal,2,cash,0,amount);
 PERFORM bunbun_accounting.post_reviewed_journal(new_journal,p_actor_id);
 INSERT INTO bunbun_accounting.expense_postings(expense_id,journal_id,source_snapshot,expense_account,cash_account,evidence_ref,revision,actor_id)
 VALUES(e.id,new_journal,to_jsonb(e),account,cash,evidence,revision,p_actor_id)
 ON CONFLICT(expense_id) DO UPDATE SET journal_id=excluded.journal_id,source_snapshot=excluded.source_snapshot,
   expense_account=excluded.expense_account,cash_account=excluded.cash_account,evidence_ref=excluded.evidence_ref,
   revision=excluded.revision,actor_id=excluded.actor_id;
 result:=jsonb_build_object('journalId',new_journal,'revision',revision,'alreadyProcessed',false);
 INSERT INTO bunbun_accounting.expense_posting_operations(operation_key,expense_id,request,previous_posting,result,actor_id)
 VALUES(v_operation_key,e.id,request,CASE WHEN old.expense_id IS NOT NULL THEN to_jsonb(old) END,result,p_actor_id);
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION bunbun_accounting.process_period_expense(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.process_period_expense(text,jsonb,uuid) TO service_role;
CREATE FUNCTION public.accounting_expense_service(p_action text,p_payload jsonb,p_actor_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT bunbun_accounting.process_period_expense(p_action,p_payload,p_actor_id);
$fn$;
REVOKE ALL ON FUNCTION public.accounting_expense_service(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_expense_service(text,jsonb,uuid) TO service_role;
COMMIT;
