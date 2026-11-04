-- Disposable local CI database only.
INSERT INTO public.products(id,sku,nama) OVERRIDING SYSTEM VALUE VALUES(935001,'LOCAL-CAFE-RACE','Synthetic race product');
INSERT INTO public.incomes(id,tanggal,total_penjualan,persentase_bunbun,pemasukan_bunbun) OVERRIDING SYSTEM VALUE VALUES(935001,'2026-12-02',120,70,120);
