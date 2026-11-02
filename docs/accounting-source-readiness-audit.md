# Bunbun OS — Audit Kesiapan Sumber Keuangan sebelum Cutover

Status: **READ-ONLY DRAFT, branch feature/hpp-actual-staging.** Belum digabung ke main, belum ada saldo awal yang disahkan, belum ada nilai laba Bunbun aktual.

## Tujuan untuk Owner
Owner perlu tahu keuntungan usaha dan kesiapan bisnis memberi bonus, merekrut staf, dan menambah produksi. Namun tiga aliran di OS lama — sales, setoran, dan pengeluaran — tidak sama dengan pengakuan pendapatan, HPP, dan laba.

## Fitur baru yang dikerjakan
- Menu **Audit Sumber Keuangan** (`/finance/source-audit`) khusus Owner, dengan pilihan bulan secara eksplisit.
- Data dibaca melalui SELECT terpaginasikan (500 per halaman; batas keras 50.000 per sumber), hanya record `is_deleted=false` dalam masing-masing tanggal bulanan. Jika ada error atau hasil tidak lengkap, audit ditolak.
- Sumber dibaca terpisah: `sales`, `incomes`, `expenses`, `purchases`, `product_stock_movements`, `inventory_transactions`.
- Total nominal Sales, setoran, expense, dan purchasing ditampilkan **terpisah** sebagai total CATATAN OS. Tidak ada rumus `sales - expenses = laba`.
- Pengeluaran yang memiliki `purchase_id` ditandai untuk mencegah pembukuan ganda; referensi purchasing dari bulan lain diberi flag untuk pemeriksaan, bukan disebut pasti orphan.
- `CAFE_OUT` hanya mutasi persediaan. `sale_id` yang kosong dan tautan yang tidak ada pada bulan terpilih diberi catatan; `sale_id` yang ada tidak membuktikan setoran.
- `PRODUCTION_OUT.unit_value` kosong/tidak valid/0 ditandai sebagai gap valuasi, tidak otomatis 0 HPP.
- Semua angka dapat diekspor sebagai laporan audit JSON di perangkat Owner. Tidak ada penulisan database, stock adjustment, pembuatan transaksi kas/jurnal, ataupun perubahan harga master resep.
- Terdapat checklist bukti yang masih harus disahkan sebelum laba aktual dan simulasi bonus/ekspansi diizinkan.

## Audit SELECT historis yang dilakukan 2 November 2026 — data bulan Oktober 2026
Angka di bawah adalah **catatan historis**, bukan laba:

| Sumber | Temuan | Pembacaan yang benar |
|---|---|---|
| Sales channel PUBLIC_HUB | 711 transaksi, Rp20.929.000 tercatat | Tidak otomatis = piutang hak Bunbun atau kas kafe |
| Incomes | 1 setoran, Rp15.209.190 | Nominal diterima menurut OS, belum direkonsiliasi bank/piutang; bisa terkait bulan lain |
| Expenses Bahan Baku | 37 transaksi, Rp9.428.085, seluruhnya tertaut Purchase | Tidak langsung COGS periode tersebut |
| Expenses Maintenance | 9 transaksi, Rp359.300, seluruhnya tertaut Purchase | Klasifikasi expense vs aset/biaya produksi perlu bukti |
| Expenses Gaji | 3 transaksi, Rp4.450.000, tidak tertaut Purchase | Harus pisahkan biaya produksi dari biaya nonproduksi dan periode akrual |
| Purchasing | 46 item, Rp9.787.385 tercatat | Bukan tambahan beban di atas Expense yang sudah terkait |
| Mutasi stok CAFE_OUT | 1.078 mutasi, 1.023 punya sale_id, 55 tanpa sale_id | Mutasi stok bukan bukti pembayaran; telusuri penjualan/retur |
| Inventory PRODUCTION_OUT | 807 mutasi, seluruhnya unit_value NULL | Tidak layak dihitung sebagai COGS aktual |

**Penting:** Nominal Sales dan setoran berasal dari periode tanggal yang sama tetapi proses pengakuan dan jadwal pembayaran dapat berbeda. Jangan langsung membandingkan atau menyimpulkan keuntungan dari selisihnya. Dalam histori OS, Owner menginput setoran setelah nominal diterima; tidak boleh memotong persentase kafe lagi.

## Persiapan tanggal cutover baru
1. Pilih tanggal setelah kesiapan stok opname, bukan otomatis 1 November.
2. Cocokkan stok fisik bahan, WIP, finished, frozen, konsinyasi, retur/reject, dan nilai yang berbukti.
3. Cocokkan kas/bank dari bukti rekening serta piutang dan utang yang benar-benar terbuka.
4. Setelah cutover disahkan, baru petakan transaksi pasca-cutover ke jurnal akuntansi; profit dan cashflow hanya dari POSTED journals.
5. Setoran dari kafe yang merupakan penyelesaian piutang bukan pendapatan baru. Pembelian bahan bukan langsung COGS penjualan.

## Status pengamanan
- UI memakai Owner `RoleRoute`; untuk pembatasan akses sesungguhnya, kebijakan RLS pada tabel Supabase yang dibaca tetap berlaku.
- Tidak ada penulisan Supabase, migrasi, Edge deployment, atau merge `main`.
- Pengujian unit mencakup input sumber tidak lengkap, nominal tidak valid, transaksi terhapus, tanggal luar bulan, tautan silang bulan, penyesuaian stok, pemakaian bahan tanpa nilai.
- Seluruh kesimpulan hasil audit tetap `HISTORICAL_DIAGNOSTIC_ONLY`; tidak ada flag `readyToPost` yang bisa berubah menjadi true dari audit historis.

## Lanjutan sebelum go-live akuntansi
- Staging Supabase terpisah masih diperlukan; pembuatan berpotensi berbiaya dan belum dilakukan.
- Uji autentikasi Owner sesungguhnya, validasi RLS, backend posting atomik, rekonsiliasi sumber ke ledger, serta laporan setelah cutover.
- Owner menandatangani saldo awal, tanggal cutover, dokumen penjualan, dan kebijakan nilai biaya/operasional.

**Kesimpulan:** Audit ini memberi bukti progres dan menunjukkan gap data, tetapi dengan sengaja tidak mengeluarkan angka laba dan tidak menilai keamanan pemberian bonus atau ekspansi sebelum laporan finansial valid.