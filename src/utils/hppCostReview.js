/** Read-only cashbook review. Expense categories are NOT accounting cost classifications. */
const allowedMonth = /^\d{4}-(0[1-9]|1[0-2])$/;
export function monthBounds(month) {
  if (!allowedMonth.test(month)) throw new Error('Periode harus berbentuk YYYY-MM.');
  const [year, value] = month.split('-').map(Number);
  const nextYear = value === 12 ? year + 1 : year;
  const nextMonth = value === 12 ? 1 : value + 1;
  return {
    start: `${month}-01`,
    next: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
    startTimestamp: `${month}-01T00:00:00+07:00`,
    nextTimestamp: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+07:00`,
  };
}

export function reviewMonthlyExpenses(expenses = []) {
  if (!Array.isArray(expenses)) throw new Error('Daftar pengeluaran tidak valid.');
  const seenIds = new Set();
  const purchaseIds = new Map();
  const rows = [];
  const categories = new Map();
  let totalPaid = 0;
  for (const item of expenses) {
    if (item.is_deleted === true) continue;
    if (item.id === null || item.id === undefined || seenIds.has(String(item.id))) {
      throw new Error('ID pengeluaran duplikat atau kosong; audit dihentikan.');
    }
    seenIds.add(String(item.id));
    const nominal = Number(item.nominal);
    if (!Number.isFinite(nominal) || nominal < 0) {
      throw new Error(`Nominal pengeluaran tidak valid: ${item.id}`);
    }
    const category = String(item.kategori || 'Tanpa Kategori');
    const purchaseId = item.purchase_id ?? null;
    if (purchaseId !== null) {
      const key = String(purchaseId);
      purchaseIds.set(key, (purchaseIds.get(key) ?? 0) + 1);
    }
    rows.push({
      id: item.id, tanggal: item.tanggal, kategori: category, nominal,
      keterangan: item.keterangan || '', purchaseId,
      status: 'BELUM_DIKLASIFIKASIKAN',
      potentialRole: category === 'Gaji' ? 'PERLU_TINJAU_TENAGA_KERJA' :
        category === 'Maintenance' ? 'PERLU_TINJAU_OVERHEAD_ATAU_PERSEDIAAN' : 'PERLU_TINJAU',
    });
    totalPaid += nominal;
    const group = categories.get(category) ?? { kategori: category, jumlahTransaksi: 0, nominal: 0 };
    group.jumlahTransaksi++;
    group.nominal += nominal;
    categories.set(category, group);
  }
  return {
    totalPaid, totalExpenses: rows.length,
    rows: rows.map(row => ({
      ...row,
      warning: row.purchaseId !== null && purchaseIds.get(String(row.purchaseId)) > 1
        ? 'Beberapa pengeluaran merujuk purchase_id yang sama; cek dahulu.' : null,
    })),
    categories: [...categories.values()].sort((a, b) => a.kategori.localeCompare(b.kategori)),
    approvedCostTotal: null,
    accountingStatus: 'BELUM_DIREKONSILIASI',
  };
}
