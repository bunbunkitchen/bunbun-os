/**
 * Read-only monthly HPP audit adapter. This does not post costs or change stock.
 */
import { supabase } from '../lib/supabase';
import { monthBounds, reviewMonthlyExpenses } from '../utils/hppCostReview';
import { assessMaterialValuationCoverage } from '../utils/hppBatchAssessment';

async function fetchAll(queryFactory) {
  const rows = [];
  const pageSize = 500;
  for (let index = 0; index < 100; index++) {
    const { data, error } = await queryFactory().range(index * pageSize, (index + 1) * pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return rows;
  }
  throw new Error('Batas audit 50.000 transaksi tercapai; batasi periode.');
}

export async function getMonthlyHppAudit(month) {
  const bounds = monthBounds(month);
  const [expenses, batches, materialMovements] = await Promise.all([
    fetchAll(() => supabase.from('expenses')
      .select('id,tanggal,kategori,nominal,keterangan,purchase_id,is_deleted')
      .eq('is_deleted', false)
      .gte('tanggal', bounds.start)
      .lt('tanggal', bounds.next)
      .order('id', { ascending: true })),
    fetchAll(() => supabase.from('production_batches')
      .select('id,kode,status,target,selesai,reject,created_at,is_deleted')
      .eq('is_deleted', false)
      .gte('created_at', bounds.startTimestamp)
      .lt('created_at', bounds.nextTimestamp)
      .order('id', { ascending: true })),
    fetchAll(() => supabase.from('inventory_transactions')
      .select('id,qty,unit_value')
      .eq('is_deleted', false)
      .eq('transaction_type', 'PRODUCTION_OUT')
      .gte('transaction_date', bounds.start)
      .lt('transaction_date', bounds.next)
      .order('id', { ascending: true })),
  ]);
  return {
    month,
    expensesReview: reviewMonthlyExpenses(expenses),
    materialValuation: assessMaterialValuationCoverage(materialMovements),
    batches: {
      count: batches.length,
      completedUnitsField: batches.reduce((sum, row) => sum + Number(row.selesai || 0), 0),
      rows: batches,
      periodBasis: 'TANGGAL_PEMBUATAN_BATCH_JAKARTA',
      finalYieldVerified: false,
    },
    estimatedHpp: null,
    readyToPost: false,
  };
}
