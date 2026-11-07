-- Disposable CI database only. Never run on Supabase.
DO $$ BEGIN IF current_database()<>'bunbun_production_ci' OR EXISTS(SELECT 1 FROM bunbun_accounting.journals)
 THEN RAISE EXCEPTION 'Requires isolated empty production CI database'; END IF; END $$;
INSERT INTO public.recipes(id,kode,nama,yield_qty) OVERRIDING SYSTEM VALUE VALUES(911001,'RACE-PROD','Synthetic recipe',1);
INSERT INTO public.production_orders(id,kode,tanggal,recipe_id,target_produksi) OVERRIDING SYSTEM VALUE VALUES(911001,'RACE-PROD','2026-11-01',911001,2);
INSERT INTO public.production_batches(id,kode,production_order_id,target,status,inventory_consumed,created_at) OVERRIDING SYSTEM VALUE
 VALUES(911001,'RACE-PROD-1',911001,1,'Finished',true,'2026-11-01'),(911002,'RACE-PROD-2',911001,1,'Finished',true,'2026-11-01');
INSERT INTO public.expenses(id,tanggal,kategori,nominal) OVERRIDING SYSTEM VALUE VALUES(911001,'2026-11-01','Gaji',30);
INSERT INTO bunbun_accounting.periods(id,month_start,cutover_on,status,approved_by,approved_at)
 VALUES('91100000-0000-4000-8000-000000000001','2026-11-01','2026-11-01','OPEN','2375b60c-c418-47c2-b157-af80b262fadf',now());
SET ROLE service_role;
DO $$ DECLARE actor uuid:='2375b60c-c418-47c2-b157-af80b262fadf'; op uuid:=gen_random_uuid(); BEGIN
 INSERT INTO bunbun_accounting.opening_snapshots(period_id,cutover_on,opening_payload,evidence_summary,status,approved_by,approved_at)
 VALUES('91100000-0000-4000-8000-000000000001','2026-11-01','{"test_only":true}','LOCAL-CI-PROD-OPENING','APPROVED',actor,now());
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key)
 VALUES(op,'91100000-0000-4000-8000-000000000001','2026-11-01','OPENING','LOCAL-CI-PROD-OPENING',gen_random_uuid());
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit) VALUES(op,1,'1020',1000,0),(op,2,'3000',0,1000);
 PERFORM bunbun_accounting.post_reviewed_journal(op,actor);
END $$;
RESET ROLE;
