import { supabase } from '../lib/supabase';
import { purchaseAccountingAvailable } from './accountingPurchaseService';
export const periodExpenseAccounts = {
  '6010': 'Gaji nonproduksi', '6020': 'Utilitas nonproduksi', '6030': 'Maintenance periode',
  '6050': 'Sewa periode', '6060': 'Operasional lain nonproduksi',
};
export async function requestExpenseAccounting(input) {
  if (!purchaseAccountingAvailable) throw new Error('Akuntansi pengeluaran tersedia di staging yang ditentukan.');
  const { data, error } = await supabase.functions.invoke('accounting-expense', { body: input });
  if (error) {
    let detail;
    try { detail = await error.context?.json(); } catch { /* gateway unavailable */ }
    throw new Error(detail?.message || ({ STAGING_NOT_CONFIGURED: 'Layanan akuntansi staging belum disiapkan.',
      OWNER_REQUIRED: 'Hanya Owner aktif yang dapat mencatat jurnal.', EXPENSE_NOT_FOUND: 'Pengeluaran tidak ditemukan.' }[detail?.code])
      || 'Layanan akuntansi belum dapat dihubungi. Pengeluaran belum dikonfirmasi.');
  }
  return data;
}
