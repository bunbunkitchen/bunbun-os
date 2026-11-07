# Bunbun OS — Staging Owner Source Preview Endpoint

**STAGING-ONLY / NOT DEPLOYED / READ ONLY / NOT ACCOUNTING POSTING.**

## Lingkup
- `supabase/functions/accounting-owner-source-preview/index.ts`: Edge Function untuk membaca ulang ID asli dari `sales`, `incomes`, `purchases`, dan `expenses` pada **proyek Supabase staging independen**. Memerlukan JWT Supabase aktif, profil `owner` aktif, project ID staging berbeda dengan ref produksi Bunbun, flag khusus staging, dan exact allowed origin.
- `supabase/functions/_shared/accountingOwnerSourcePreview.js`: mengatur request schema, otorisasi, batas ukuran, membaca sumber secara server-side, memblokir sumber hilang/terhapus/duplikat, lalu menjalankan jembatan `accountingVerifiedSourceBridge.js` untuk pratinjau jurnal.
- Semua bukti `evidenceRef` dan `reviewed:true` dari permintaan **dianggap klaim penginput**, BUKAN persetujuan Owner secara sah atau pengesahan bukti. Posting backend akan memerlukan autentikasi independen serta pemeriksaan dokumen sumber asli oleh Owner yang terverifikasi.
- Endpoint tidak pernah menggunakan `INSERT`, `UPDATE`, `DELETE`, atau fungsi `post_reviewed_journal`. Output hanya status `SOURCE_PREVIEW_UNVERIFIED`, `readyToPost:false`, `writesDatabase:false`, `mayPost:false`, dan `actualProfitAvailable:false`.

## Permintaan yang diizinkan
POST dengan body JSON object yang hanya punya empat field: `action=source-preview`, `cutoverDate=YYYY-MM-DD`, `sourceIds`, `evidence`.
Semua empat daftar sumber wajib disebutkan: `sales`, `incomes`, `purchases`, `expenses`; tiap daftar sampai 20 ID tanpa duplikasi. `evidence` harus punya array `sales`, `deposits`, `purchases`, dan `purchasePayments`. Tidak boleh meminta jurnal, akun, aktor, jumlah, atau parameter SQL secara langsung selain yang ditentukan kontrak.
Backend re-fetch baris dari database berdasarkan ID server-side, tidak mempercayai jumlah atau tanggal yang dikirim dalam body sebagai source truth. Source rows wajib lengkap dan tidak berstatus terhapus.

## Aturan bisnis pratinjau
- Penjualan yang sekadar `CAFE_OUT` atau belum didokumentasikan sebagai *sold* tidak diposting sebagai pendapatan.
- Pendapatan Bunbun menggunakan nominal yang terverifikasi dalam bukti; tidak pernah memotong 30% dari setoran secara otomatis.
- Setoran `incomes` hanya boleh dialokasikan terhadap piutang penjualan terverifikasi; jumlahnya harus sama dengan record `pemasukan_bunbun` sebenarnya, dan tidak boleh melebihi saldo piutang.
- Pengeluaran `expenses` yang terkait `purchase_id` dipakai melunasi utang pembelian, bukan beban laba rugi kedua.
- HPP finished/frozen/titipan tetap TERKUNCI sampai valuasi batch dan stok yang terjual ditelusuri. Kode ini belum membangun jembatan stok/WIP, sehingga laba riil tidak dapat dihitung.
- Dokumentasi logika sumber: `docs/accounting-source-bridge.md`.

## Keamanan
1. Supabase project `bunbun-os` produksi dilarang oleh staging guard; jangan konfigurasi flag staging di proyek produksi.
2. Secret Supabase admin/service-role tetap di Edge runtime. UI publik tidak pernah menerima key server.
3. Supabase `auth.getUser(token)` dan profil owner aktif wajib berhasil; peran dari browser body diabaikan.
4. Data API `public` hanya dibaca melalui server-side client yang dikunci pada staging; RLS aktual dan policy staging **belum** diuji.
5. Jika sumber tidak cocok, endpoint mengembalikan error generik tanpa membocorkan token, kredensial DB atau detail jurnal.
6. Limit 20 IDs per tabel + body 32KiB dan metode POST, CORS exact origin. CORS bukan pengganti autentikasi.

## Status pengerjaan / gerbang rilis
- Endpoint ini baru dikodekan dan unit-tested menggunakan dependency mocks; belum dipasang ke Supabase. Pengujian asli di staging perlu akun Owner dan non-Owner terpisah.
- Saat ini belum tersedia proyek Supabase staging; pembuatan bisa berbiaya dan belum mendapat persetujuan biaya.
- Harus ada alur bukti external invoice/receivables, tanda tangan/persetujuan yang disimpan server-side, stok opname dan HPP batch yang terbukti, sebelum jurnal dapat POSTED.
- Dashboard Laba Rugi dan Growth Bunbun tetap tidak boleh menampilkan angka aktual dari data historis yang belum terverifikasi.

**Database dan aplikasi aktif tidak diubah oleh endpoint pratinjau ini.**