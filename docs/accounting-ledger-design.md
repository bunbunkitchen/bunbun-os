# Bunbun OS — Rancangan Ledger Akuntansi Setelah Cutover

Status: DESAIN UNTUK REVIEW, BUKAN MIGRASI DAN BUKAN AKTIVASI. Tidak ada SQL yang dijalankan.

## Tujuan
Berikan fondasi untuk laba rugi, arus kas, neraca, margin produk, bonus staf, dan simulasi ekspansi yang bisa dipercaya. Mesin HPP historis tetap read-only; tanggal cutover dan saldo awal disahkan dahulu.

## Tahap yang sudah ada dalam Draft PR #1
- Menu Owner Persiapan Saldo Awal: input stok fisik, harga per satuan, asal bukti, kas, bank, piutang, utang, aset lain.
- Asset opening terpisah: bahan baku, WIP/produksi dalam proses, finished, frozen, dan titipan kafe yang belum terjual.
- Draft JSON/CSV dan audit stok; tidak mengubah data lama.
- Pratinjau jurnal pembukaan debit/kredit yang matematis seimbang dan posisi keuangan sementara.
- Ekuitas awal penyeimbang bukan otomatis modal setoran atau laba. Tidak ada posting otomatis dan tidak ada laporan untung/rugi yang dibuat dari saldo awal.

## Usulan model data BARU (belum ada di Supabase)
1. accounting_periods: tanggal cutover yang disahkan, status OPEN/CLOSED, tanggal disahkan, identitas Owner, bukti audit.
2. accounting_accounts: chart of accounts (kode unik, nama, jenis asset/liability/equity/revenue/COGS/expense, active).
3. accounting_opening_snapshots: snapshot immutable kas/bank, piutang/utang, setiap bahan fisik beserta kuantitas dan valuasi, WIP, finished, frozen, consignment, aset.
4. accounting_journals: journal_id UUID, journal_date, period_id, source_type, source_id, operation_key unik, status, recorded_at/approved_by, reversal_of.
5. accounting_journal_lines: journal_id, account_id, debit NUMERIC(18,2), credit NUMERIC(18,2), reference_item_id, detail; setiap line salah satu debit/kredit > 0.
6. accounting_stock_cost_layers or stock_valuation_movements: valuations after cutover in base units with links to original inventory transaction; never overwrite old unit_value.
7. accounting_batch_costs: referensi batch dan split, hasil biaya bahan/tenaga kerja/OH yang telah disahkan, status RECONCILED/POSTED.
8. accounting_audit_events: actor, action, timestamp, old/new summary, notes, no destructive edit to posted journals.

## Rencana kontrol keamanan
- Tabel baru dalam public wajib RLS enabled, default DENY. SELECT untuk Owner yang benar-benar aktif; periksa profil dan session dengan helper yang diuji.
- Jangan berikan INSERT/UPDATE/DELETE langsung dari browser. Proses posting harus transaksi atomik dari backend terproteksi; hindari security definer baru di schema exposed.
- Jika memakai Edge Function backend, simpan service key HANYA di server; verifikasi JWT/session, role Owner yang aktif, dan parameter request.
- Setiap posting memakai operation_key unik untuk idempotensi; jangan menjumlah ulang expense purchase_id dengan purchasing.
- Hanya posting jurnal apabila jumlah debit = kredit, periode OPEN, bukti stok telah disahkan dan source reference belum dipakai.
- Jurnal POSTED immutable; koreksi dengan jurnal pembalik dan posting baru dengan jejak audit. Closing period melarang backdate mutasi tanpa proses reopen Owner.
- Migrasi disiapkan dengan Supabase CLI, staging terlebih dahulu, security advisors/RLS test, backout plan, kemudian approval produksi terpisah.

## Prinsip pengakuan transaksi setelah cutover
- Pembelian bahan: debit inventory, kredit bank/utang; pengeluaran kas yang tersambung purchase bukan beban bahan kedua.
- Pemakaian produksi: debit WIP, kredit inventory, berdasarkan moving weighted average terverifikasi.
- Penyelesaian produk: debit finished/frozen, kredit WIP; transfer ke kafe yang masih titipan bukan revenue dan bukan COGS.
- Produk benar-benar terjual: revenue yang merupakan hak Bunbun, dan HPP produk terjual (debit COGS kredit stok sesuai arus barang).
- Setoran kafe yang sudah diterima: debit bank/kas, kredit piutang/akun settlement sesuai pencatatan penjualan, jangan menguranginya lagi sebesar komisi kafe.
- Gaji, gas, overhead: biaya produksi dan biaya periode harus diklasifikasikan dari bukti akrual/pemakaian, bukan sekadar kategori cashbook.
- Produk rusak/retur: dipisahkan menurut tahap proses dan keterpulihannya; jangan otomatis membebankan semua ke produksi normal.
- Modal Owner/penarikan Owner: akun ekuitas, bukan pendapatan atau beban operasional.
- Biaya perolehan peralatan: aset tetap untuk disusutkan sesuai kebijakan, bukan otomatis beban di hari pembelian.

## Laporan yang wajib direkonsiliasi
- Neraca: Aset = Kewajiban + Ekuitas.
- Laba rugi: pendapatan yang menjadi hak Bunbun - HPP produk terjual - beban periode.
- Arus kas: kas masuk/keluar operasional, investasi, pendanaan; tidak disamakan dengan laba.
- Perubahan persediaan: saldo awal + perolehan/produksi - keluar/penjualan/adjustment = saldo akhir.
- Keselarasan titipan kafe: jumlah dikirim, terjual, diretur, masih dititip; setoran tunai dipisahkan dari pemindahan stok.
- Pertumbuhan bulanan: pendapatan bersih, laba bersih, gross/net margin, unit terjual, produktivitas, dan status kelengkapan data.

## Gerbang aktivasi
1. Owner menetapkan tanggal cutover, data fisik dan bukti saldo awal, termasuk pekerjaan dalam proses dan aset titipan.
2. Uji semua RLS, posting anti-duplikat, debit/kredit, revisi pembalik, saldo stok negatif, dan otorisasi staff.
3. Lakukan simulasi satu hari produksi dan satu setoran kafe pada staging, cocokkan inventory, kas, P&L dan laporan stock.
4. Peroleh persetujuan eksplisit Owner sebelum merilis migrasi ke Supabase produksi.

## Yang tidak boleh dilakukan
- Jangan mengubah harga master bahan yang dipakai untuk resep.
- Jangan menghapus atau menormalkan transaksi lama untuk mempercantik laporan.
- Jangan menyamakan uang yang tersedia dengan keuntungan yang boleh dibagi.
- Jangan mencampur omzet kafe sebelum bagi hasil dengan setoran bersih yang dicatat Owner.
- Jangan melakukan posting jurnal sebelum saldo awal dan klasifikasi akuntansi disahkan.