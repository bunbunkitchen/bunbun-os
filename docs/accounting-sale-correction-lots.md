# Bunbun OS — Penjualan, Edit & Pembatalan dengan Jejak Lot (PROTOTIPE)

**STATUS: DRAFT PR, EPHEMERAL PG16 ONLY.** Tidak ada migrasi Supabase staging/produksi, perubahan UI transaksi aktif, atau posting jurnal. Seluruh jumlah dan harga di pengujian adalah sintetis, bukan laporan laba aktual Bunbun.

## Temuan dari alur penjualan Bunbun saat ini
- Fungsi `public.record_sale_transaction` membuat satu sales, sale_items, dan CAFE_OUT per produk dengan `sale_id`. Pergerakan tersebut **tidak** menunjuk batch_split/lot asal.
- Fungsi `public.update_sale_transaction` membalik penjualan lama dengan CAFE_IN dan mencatat ulang CAFE_OUT; `public.delete_sale_transaction` memakai CAFE_IN saat membatalkan sales yang dikelola stok. Prosedur lama mengembalikan kuantitas pada level produk, tanpa bukti lot fisik asal.
- Untuk produk pangan, **penjualan yang dibatalkan secara administratif tidak membuktikan barang benar-benar kembali dan layak dijual**. Terutama refund setelah barang dikonsumsi: tidak boleh otomatis menambah inventory.
- Data legacy tanpa operation_key juga tidak boleh dianggap punya catatan lot atau diisi melalui FIFO buatan.

## Perubahan pengembangan
- `tests/sql/accounting-lot-sales-bootstrap.sql` meniru struktur sales dan sale_items yang memang digunakan Bunbun, dengan produk dan stok contoh pada database disposable.
- `docs/sql/accounting-sales-lot-staging.sql`: tabel privat `lot_sale_transactions`, `lot_sale_out_allocations`, `lot_sale_return_allocations`, dan `lot_sale_replacements`. Penghubung setiap CAFE_OUT terjual dengan **lot finished yang dipilih**, serta penghubung setiap CAFE_IN pengembalian ke **alokasi keluar asli**, bukan lot sembarang. Semua bukti recorded bersifat immutable dan punya idempotent operation key.
- Hanya di database uji yang menjalankan file ini, gate diperluas untuk sale-linked CAFE_OUT dan physically returned CAFE_IN. Deferred check membuktikan setiap qty movement = jumlah alokasi yang benar, product/lot match, exact stock balance = jumlah posisi lot; `original_qty - available_qty = pengeluaran manual + lot terjual - lot pengembalian`.
- `docs/sql/accounting-sales-create-staging.sql`: `record_sale_with_lots_staging`, sale + items + per-lot CAFE_OUT dan pengurangan posisi lot seluruhnya dalam satu transaksi. Product row lock mencegah stok dijual ganda. Pembagian satu produk dari banyak lot didukung. Tidak otomatis mengakui HPP/pendapatan dalam jurnal.
- `docs/sql/accounting-sales-cancel-staging.sql`: `cancel_lot_sale_staging` mensyaratkan `p_physically_returned=true`, referensi bukti, login Owner di trusted backend, lalu CAFE_IN dan kenaikan stok ke **lot asal yang sama**. Bila produk tidak benar-benar kembali secara fisik/layak jual, transaksi **harus ditolak**: diperlukan alur refund/kehilangan/COGS reversal tersendiri.
- `docs/sql/accounting-sales-edit-staging.sql`: `replace_lot_sale_staging` mengembalikan fisik lot sale lama lalu membuat penjualan pengganti **dengan ID baru** serta hubungan old→new yang permanen. Jika lot pengganti kurang, seluruh SQL call roll back—sale lama tetap aktif dan stok tetap semula. Tidak menimpa item lama atau menghapus history.
- `tests/sql/accounting-sales-lot-e2e.sql` + `tests/sql/accounting-sales-edit-e2e.sql`: skenario beda produk, dua lot satu SKU, idempotensi, sale product quantity, restock origin, batal ganda, stok kurang, edit sukses/gagal, audit trail & keberhasilan kembali ke saldo lot yang tepat.
- `tests/sql/accounting-sale-race.sh` dan kedua sesi SQL: dua penjualan berebut lot yang sama, hanya satu berhasil setelah product row lock; yang kalah tidak meninggalkan sales, item, atau movement yatim.

## Contoh sintetis
Mulai dengan Original 10 pcs (split:101 = 6, split:102 = 4) dan produk kedua 7 pcs. Penjualan contoh 4 Original dari dua lot + 2 produk kedua; pembatalan dengan bukti fisik mengembalikan **persis** 3 pcs ke split:101, 1 pcs ke split:102, dan 2 pcs ke split:103. Edit penjualan kedua 3 Original menjadi 2 Original menggunakan dua lot; penjualan lama diarsipkan, yang baru muncul dengan nomor berbeda, posisi Original akhir 8 pcs. Tidak ada kas/jurnal HPP baru.

## Yang BELUM BOLEH dianggap selesai
1. **Bukti yang diserahkan caller belum validasi dokumen di server.** Dalam tes, `evidenceRef` dan `physically_returned=true` adalah nilai input sintetis. Backend Owner wajib memverifikasi foto/berita acara, barang fisik layak jual, JWT/session asli, sebelum fungsi dipanggil. Tidak boleh memberi service_role ke browser.
2. **Ini prototipe SQL terpisah** yang memperluas writer gate versi dasar untuk sales, BUKAN gabungan dengan writer gate shaping/frozen/baking. Sebelum staging sungguhan, gabungkan seluruh writer dan semua deferred triggers dalam satu desain yang konsisten, dengan operasi reversal untuk masing-masing lifecycle.
3. Harga sale dari contoh adalah harga input dan bukan bukti hak omzet Bunbun, setoran kafe atau invoice. Setoran yang sudah bersih dari bagian kafe **jangan dipotong 30% lagi**; setoran kafe tetap melunasi piutang, bukan mencatat omzet dua kali.
4. Edit atau pembatalan penjualan yang jurnalnya sudah POSTED butuh **jurnal pembalik**, periode accounting sah, dan rekonsiliasi kas/piutang. Prototipe ini hanya source stock; `financial_posted:false`, tidak membuat P&L aktual.
5. Refund tanpa pengembalian fisik, produk kedaluwarsa, produk sudah dikonsumsi, retur kafe non-sellable, stock adjustment, dan pengiriman konsinyasi membutuhkan kebijakan dan workflow sendiri. Jangan otomatis menambah lot finished.
6. Saldo awal dan biaya acquisition/labor/overhead/reject per lot harus diopname dan disahkan Owner setelah tanggal cutover yang benar. CI menggunakan tanggal/Owner sintetis dan bukan bukti produksi aktual.
7. Supabase staging independen, Auth/RLS lengkap, seluruh writer terintegrasi, panggilan Edge terpercaya, uji beban/concurrency serta rollback drill masih diperlukan; production branch `main` belum diubah.

**Status kesiapan kode: 7 dari 9 jalur stok mempunyai prototipe teruji; 0 dari 9 diintegrasikan ke Bunbun OS aktif.** Dua jalur yang masih tanpa prototipe: pengeluaran satu produk langsung ke kafe dan stock adjustment finished-product. Tidak ada izin cutover atau posting jurnal.