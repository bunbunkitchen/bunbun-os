/**
 * Calculation only: requires explicitly approved ACCRUAL costs (never raw expenses).
 * Normal-capacity overhead does not spike merely because production is low.
 */
const types = new Set(['DIRECT_LABOR', 'VARIABLE_OH', 'FIXED_OH', 'PERIOD_EXPENSE']);
function nonnegative(label, value) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label}: nilai harus >= 0 dan finite`);
}
const total = (items, fn) => items.reduce((sum, x) => sum + fn(x), 0);

export function allocateApprovedMonthlyCosts({month, records, batches, actualLaborHours,
  actualMachineHours, normalMachineHours}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Periode tidak valid.');
  if (!Array.isArray(records) || !Array.isArray(batches)) throw new Error('Data tidak valid.');
  for (const [name, value] of Object.entries({actualLaborHours, actualMachineHours, normalMachineHours})) {
    nonnegative(name, value);
  }
  if (!normalMachineHours) throw new Error('Kapasitas normal jam mesin belum ditentukan.');
  const sources = new Set();
  for (const r of records) {
    if (!r.approved || !r.sourceKey || !types.has(r.type) || r.month !== month) {
      throw new Error('Ada biaya belum disetujui atau tidak valid.');
    }
    if (sources.has(r.sourceKey)) throw new Error(`Biaya ganda dari sumber ${r.sourceKey}`);
    sources.add(r.sourceKey);
    nonnegative('Nominal biaya', r.amount);
  }
  const ids = new Set();
  for (const b of batches) {
    if (b.month !== month || ids.has(String(b.id))) throw new Error('Batch duplikat atau beda bulan.');
    ids.add(String(b.id));
    nonnegative('Jam tenaga kerja', b.laborHours);
    nonnegative('Jam mesin', b.machineHours);
  }
  const claimedLaborHours = total(batches, b => b.laborHours);
  const claimedMachineHours = total(batches, b => b.machineHours);
  if (claimedLaborHours > actualLaborHours + 1e-8 ||
      claimedMachineHours > actualMachineHours + 1e-8) {
    throw new Error('Jam batch melebihi jam aktual periode.');
  }
  const amounts = Object.fromEntries([...types].map(type =>
    [type, total(records.filter(r => r.type === type), r => r.amount)]));
  if (amounts.DIRECT_LABOR > 0 && actualLaborHours === 0) throw new Error('Jam tenaga kerja tidak tersedia.');
  if (amounts.VARIABLE_OH > 0 && actualMachineHours === 0) throw new Error('Jam mesin tidak tersedia.');
  const laborRate = actualLaborHours ? amounts.DIRECT_LABOR / actualLaborHours : 0;
  const variableRate = actualMachineHours ? amounts.VARIABLE_OH / actualMachineHours : 0;
  const fixedRate = amounts.FIXED_OH / Math.max(actualMachineHours, normalMachineHours);
  const allocations = batches.map(b => ({
    batchId: b.id,
    directLabor: laborRate * b.laborHours,
    variableOverhead: variableRate * b.machineHours,
    fixedOverhead: fixedRate * b.machineHours,
  }));
  const allocatedLabor = total(allocations, x => x.directLabor);
  const allocatedVariable = total(allocations, x => x.variableOverhead);
  const allocatedFixed = total(allocations, x => x.fixedOverhead);
  const unallocated = {
    directLabor: Math.max(0, amounts.DIRECT_LABOR - allocatedLabor),
    variableOverhead: Math.max(0, amounts.VARIABLE_OH - allocatedVariable),
    fixedOverhead: Math.max(0, amounts.FIXED_OH - allocatedFixed),
  };
  const totalInput = total(Object.values(amounts), x => x);
  const totalAllocated = allocatedLabor + allocatedVariable + allocatedFixed;
  const totalUnallocated = total(Object.values(unallocated), x => x);
  return {
    month, amounts, allocations, unallocated, periodExpense: amounts.PERIOD_EXPENSE,
    rates: { laborRate, variableRate, fixedRate },
    reconciles: Math.abs(totalInput - totalAllocated - totalUnallocated - amounts.PERIOD_EXPENSE) < 0.0001,
    readyToPost: false,
  };
}
