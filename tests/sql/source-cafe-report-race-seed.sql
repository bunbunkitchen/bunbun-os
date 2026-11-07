-- Disposable local CI database only.
DO $$ BEGIN IF current_database()<>'bunbun_cafe_report_ci' OR EXISTS(SELECT 1 FROM bunbun_accounting.journals)
 OR EXISTS(SELECT 1 FROM bunbun_accounting.cafe_reports) THEN RAISE EXCEPTION 'Requires empty isolated cafe-report CI database'; END IF; END $$;
INSERT INTO public.products(id,sku,nama) OVERRIDING SYSTEM VALUE VALUES(935001,'LOCAL-CAFE-RACE','Synthetic race product');
INSERT INTO public.incomes(id,tanggal,total_penjualan,persentase_bunbun,pemasukan_bunbun) OVERRIDING SYSTEM VALUE VALUES(935001,'2026-12-02',120,70,120);
