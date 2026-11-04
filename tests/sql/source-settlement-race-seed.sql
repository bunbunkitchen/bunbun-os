-- LOCAL CI ONLY. Commits synthetic fixtures inside a throwaway DB, never cloud.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM bunbun_accounting.journals) THEN RAISE EXCEPTION 'Requires empty CI ledger'; END IF; END $$;
INSERT INTO public.products(id,sku,nama) OVERRIDING SYSTEM VALUE VALUES(-907001,'RACE-FINANCE','Synthetic race product');
INSERT INTO public.sales(id,sale_date,sales_channel,total_amount) OVERRIDING SYSTEM VALUE VALUES(-907001,'2026-11-04','DIRECT',70000);
INSERT INTO public.sale_items(sale_id,product_id,product_name,quantity,selling_price,subtotal,order_type)
VALUES(-907001,-907001,'Synthetic race product',7,10000,70000,'TAKE_AWAY');
INSERT INTO public.incomes(id,tanggal,total_penjualan,persentase_bunbun,pemasukan_bunbun) OVERRIDING SYSTEM VALUE VALUES
(-907001,'2026-11-05',70000,100,50000),(-907002,'2026-11-05',70000,100,50000);
INSERT INTO bunbun_accounting.periods(id,month_start,cutover_on,status,approved_by,approved_at) VALUES
('90700000-0000-4000-8000-000000000001','2026-11-01','2026-11-01','OPEN','2375b60c-c418-47c2-b157-af80b262fadf',now());
SET ROLE service_role;
DO $$ DECLARE a uuid:='2375b60c-c418-47c2-b157-af80b262fadf'; j uuid:=gen_random_uuid(); s jsonb; BEGIN
 INSERT INTO bunbun_accounting.opening_snapshots(period_id,cutover_on,opening_payload,evidence_summary,status,approved_by,approved_at)
 VALUES('90700000-0000-4000-8000-000000000001','2026-11-01','{"synthetic":true}','LOCAL RACE OPENING','APPROVED',a,now());
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key)
 VALUES(j,'90700000-0000-4000-8000-000000000001','2026-11-01','OPENING','LOCAL-RACE-OPENING',gen_random_uuid());
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit)
 VALUES(j,1,'1020',100000,0),(j,2,'3000',0,100000);
 PERFORM bunbun_accounting.post_reviewed_journal(j,a);
 s:=public.accounting_revenue_service('review_sale','{"saleId":"-907001"}',a);
 PERFORM public.accounting_revenue_service('post_sale',jsonb_build_object('saleId','-907001','sourceSnapshot',s->>'sourceSnapshot',
 'recordedBasis','NET_BUNBUN','netEntitlement','70000','soldConfirmed',true,'evidenceRef','LOCAL-RACE-SOLD','operationKey',gen_random_uuid()),a);
END $$;
RESET ROLE;
