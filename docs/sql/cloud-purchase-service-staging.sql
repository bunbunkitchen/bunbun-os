-- Staging-only service RPC transport; browser roles have no EXECUTE.
-- SECURITY INVOKER preserves the service-role-only private writer checks.
BEGIN;
CREATE FUNCTION public.accounting_purchase_service(p_action text,p_payload jsonb,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE row_data jsonb; result jsonb; v_purchase_id bigint;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Private backend required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='owner' AND is_active)
 THEN RAISE EXCEPTION 'Active Owner approval required'; END IF;
 v_purchase_id:=(p_payload->>'purchaseId')::bigint;
 IF p_action='review' THEN
   SELECT jsonb_build_object('purchaseSnapshot',to_jsonb(p)::text,'expenseSnapshot',to_jsonb(e)::text,
     'total',p.total::text,'unitPrice',p.harga_satuan::text,'quantity',p.jumlah::text,'unit',p.satuan,
     'packageQuantity',p.jumlah_sediaan::text,
     'posted',EXISTS(SELECT 1 FROM bunbun_accounting.purchase_postings x WHERE x.purchase_id=p.id),
     'sourceComplete',(p.ingredient_id IS NOT NULL AND p.maintenance_item_id IS NULL AND p.total>0 AND p.jumlah>0
       AND p.total::text NOT IN('NaN','Infinity','-Infinity') AND p.jumlah::text NOT IN('NaN','Infinity','-Infinity')
       AND (SELECT count(*) FROM public.expenses x WHERE x.purchase_id=p.id AND NOT x.is_deleted)=1
       AND e.nominal=p.total AND e.tanggal>=p.tanggal
       AND (SELECT count(*) FROM public.inventory_transactions x WHERE x.purchase_id=p.id AND NOT x.is_deleted)=1
       AND r.transaction_type='PURCHASE' AND r.ingredient_id=p.ingredient_id AND r.qty=p.jumlah
       AND lower(btrim(r.unit))=lower(btrim(p.satuan)) AND r.transaction_date=p.tanggal),
     'periodReady',(EXISTS(SELECT 1 FROM bunbun_accounting.journals j WHERE j.source_type='OPENING' AND j.status='POSTED' AND j.posting_date<=p.tanggal)
       AND EXISTS(SELECT 1 FROM bunbun_accounting.periods x WHERE x.month_start=date_trunc('month',p.tanggal)::date AND x.status='OPEN')
       AND EXISTS(SELECT 1 FROM bunbun_accounting.periods x WHERE x.month_start=date_trunc('month',e.tanggal)::date AND x.status='OPEN')))
   INTO row_data FROM public.purchases p
   LEFT JOIN LATERAL(SELECT * FROM public.expenses x WHERE x.purchase_id=p.id AND NOT x.is_deleted ORDER BY id LIMIT 1) e ON true
   LEFT JOIN LATERAL(SELECT * FROM public.inventory_transactions x WHERE x.purchase_id=p.id AND NOT x.is_deleted ORDER BY id LIMIT 1) r ON true
   WHERE p.id=v_purchase_id AND NOT p.is_deleted;
   RETURN row_data;
 ELSIF p_action='review-post' THEN
   result:=bunbun_accounting.post_paid_ingredient_purchase(v_purchase_id,(p_payload->>'purchaseSnapshot')::jsonb,
     (p_payload->>'expenseSnapshot')::jsonb,p_payload->>'cashAccount',p_payload->>'evidenceRef',p_actor_id);
 ELSIF p_action='review-correction' THEN
   result:=bunbun_accounting.correct_paid_ingredient_purchase(v_purchase_id,(p_payload->>'purchaseSnapshot')::jsonb,
     (p_payload->>'expenseSnapshot')::jsonb,(p_payload->>'newUnitPrice')::numeric,p_payload->>'cashAccount',
     p_payload->>'evidenceRef',(p_payload->>'operationKey')::uuid,p_actor_id);
 ELSE RAISE EXCEPTION 'Unsupported service action'; END IF;
 RETURN jsonb_build_object('invoiceJournalId',result->>'invoice_journal_id','paymentJournalId',result->>'payment_journal_id',
   'revision',coalesce((result->>'revision')::integer,1),
   'alreadyProcessed',coalesce((result->>'already_posted')::boolean,false) OR coalesce((result->>'already_corrected')::boolean,false));
END $fn$;
REVOKE ALL ON FUNCTION public.accounting_purchase_service(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_purchase_service(text,jsonb,uuid) TO service_role;
COMMIT;
