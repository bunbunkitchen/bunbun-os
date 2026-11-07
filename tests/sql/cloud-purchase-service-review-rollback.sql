-- Staging only. Reads synthetic source matching through the service transport;
-- never creates an opening or a posted journal.
BEGIN;
INSERT INTO public.purchases(id,tanggal,ingredient_id,jumlah,satuan,harga_satuan,total)
OVERRIDING SYSTEM VALUE SELECT -904003,'2026-11-04',min(id),2,'kg',10000,20000 FROM public.ingredients WHERE NOT is_deleted;
INSERT INTO public.expenses(id,tanggal,kategori,nominal,purchase_id)
OVERRIDING SYSTEM VALUE VALUES(-904003,'2026-11-04','Bahan Baku',20000,-904003);
INSERT INTO public.inventory_transactions(transaction_date,transaction_type,ingredient_id,qty,unit,purchase_id)
SELECT tanggal,'PURCHASE',ingredient_id,jumlah,satuan,id FROM public.purchases WHERE id=-904003;
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.accounting_purchase_service('review','{"purchaseId":"-904003"}','2375b60c-c418-47c2-b157-af80b262fadf');
 IF (r->>'sourceComplete')::boolean IS DISTINCT FROM true OR (r->>'posted')::boolean IS DISTINCT FROM false
 OR (r->>'periodReady')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Review mismatch'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: service transport loads matched source and blocks unapproved period; rolled back' result;
