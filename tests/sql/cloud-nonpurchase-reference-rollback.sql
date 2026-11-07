-- Isolated staging only. All records synthetic; always rollback.
BEGIN;
DO $$
DECLARE actor uuid:=gen_random_uuid(); item bigint; first_id bigint; retry_id bigint; op text:='SYNTHETIC-GIFT-'||gen_random_uuid();
 old_expenses bigint; old_purchases bigint; old_journals bigint;
BEGIN
 SELECT count(*) INTO old_expenses FROM public.expenses;
 SELECT count(*) INTO old_purchases FROM public.purchases;
 SELECT count(*) INTO old_journals FROM bunbun_accounting.journals;
 INSERT INTO auth.users(id,email) VALUES(actor,'synthetic-gift-'||actor||'@example.invalid');
 INSERT INTO public.profiles(id,full_name,role,is_active) VALUES(actor,'Synthetic gift owner','owner',true)
 ON CONFLICT(id) DO UPDATE SET role='owner',is_active=true;
 INSERT INTO public.ingredients(kode,nama,kategori,satuan,harga) VALUES('GIFT-'||left(actor::text,8),'Synthetic gifted material','TEST','g',100) RETURNING id INTO item;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 first_id:=public.record_non_purchase_stock('2026-11-04',item,2,'g',999,'Hadiah / Oleh-oleh','SYNTHETIC gift from test only',op);
 retry_id:=public.record_non_purchase_stock('2026-11-04',item,2,'g',999,'Hadiah / Oleh-oleh','SYNTHETIC gift from test only',op);
 IF first_id<>retry_id OR (SELECT count(*) FROM public.inventory_transactions WHERE operation_key=op)<>1 THEN RAISE EXCEPTION 'Gift retry duplicated stock'; END IF;
 IF (SELECT harga FROM public.ingredients WHERE id=item)<>100 THEN RAISE EXCEPTION 'Gift changed recipe master price'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.inventory_transactions WHERE id=first_id AND transaction_type='ADJUSTMENT' AND qty=2 AND unit='g' AND unit_value=999 AND stock_source='Hadiah / Oleh-oleh' AND purchase_id IS NULL) THEN RAISE EXCEPTION 'Gift source quantity/reference missing'; END IF;
 UPDATE public.profiles SET is_active=false WHERE id=actor;
 BEGIN
  PERFORM public.record_non_purchase_stock('2026-11-04',item,2,'g',999,'Hadiah / Oleh-oleh',null,op||'-inactive');
  RAISE EXCEPTION 'Inactive Owner added stock';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Hanya Owner yang dapat menambah stok non-pembelian.' THEN RAISE; END IF; END;
 UPDATE public.profiles SET is_active=true,role='helper' WHERE id=actor;
 BEGIN
  PERFORM public.record_non_purchase_stock('2026-11-04',item,2,'g',999,'Hadiah / Oleh-oleh',null,op||'-helper');
  RAISE EXCEPTION 'Helper added stock';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Hanya Owner yang dapat menambah stok non-pembelian.' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.expenses)<>old_expenses OR (SELECT count(*) FROM public.purchases)<>old_purchases OR (SELECT count(*) FROM bunbun_accounting.journals)<>old_journals THEN RAISE EXCEPTION 'Gift created cash/purchase/accounting source'; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.record_non_purchase_stock('2026-11-04',1,2,'g',999,'Hadiah / Oleh-oleh',null,'SYNTHETIC-ANON');
  RAISE EXCEPTION 'Anonymous gift write succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: gifted quantity/reference/source preserved, recipe master unchanged, retry once, revoked Owner/Helper/anon denied, no expense/purchase/journal' result;
