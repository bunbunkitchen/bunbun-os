import { supabase } from '../lib/supabase';
import { purchaseAccountingAvailable } from './accountingPurchaseService';
export async function requestRevenueAccounting(input) {
  if (!purchaseAccountingAvailable) throw new Error('Akuntansi penjualan tersedia di staging yang ditentukan.');
  const { data, error } = await supabase.functions.invoke('accounting-revenue', { body: input });
  if (error) {
    let detail;
    try { detail = await error.context?.json(); } catch { /* gateway unavailable */ }
    throw new Error(detail?.message || ({ STAGING_NOT_CONFIGURED: 'Layanan akuntansi staging belum disiapkan.',
      OWNER_REQUIRED: 'Hanya Owner aktif yang dapat mencatat jurnal.', SOURCE_NOT_FOUND: 'Transaksi tidak ditemukan.',
      INVALID_REVIEW_REQUEST: 'Lengkapi pilihan transaksi dan referensi bukti.',
      RECEIVABLES_UNAVAILABLE: 'Daftar piutang belum dapat dimuat.' }[detail?.code]) || 'Layanan akuntansi belum dapat dihubungi. Transaksi belum dikonfirmasi.');
  }
  return data;
}
