import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthBounds, reviewMonthlyExpenses } from '../src/utils/hppCostReview.js';
import { allocateApprovedMonthlyCosts } from '../src/utils/hppMonthlyAllocation.js';

test('month range handles year boundary and Jakarta timezone', () => {
  assert.equal(monthBounds('2026-12').next, '2027-01-01');
  assert.match(monthBounds('2026-12').startTimestamp, /\+07:00$/);
  assert.throws(() => monthBounds('2026-13'));
});
test('salary and maintenance cashbook are never automatically approved HPP', () => {
  const result = reviewMonthlyExpenses([
    {id:1,tanggal:'2026-10-01',kategori:'Gaji',nominal:'3000000'},
    {id:2,tanggal:'2026-10-01',kategori:'Maintenance',nominal:'255000',purchase_id:140},
    {id:3,tanggal:'2026-10-01',kategori:'Maintenance',nominal:'13000',purchase_id:141},
  ]);
  assert.equal(result.totalPaid,3268000);
  assert.equal(result.approvedCostTotal,null);
  assert.ok(result.rows.every(x => x.status === 'BELUM_DIKLASIFIKASIKAN'));
});
test('cancelled entries ignored and duplicate purchase links flagged', () => {
  const review=reviewMonthlyExpenses([
    {id:1,kategori:'Maintenance',nominal:100,purchase_id:12},
    {id:2,kategori:'Maintenance',nominal:100,purchase_id:12},
    {id:3,kategori:'Gaji',nominal:100,is_deleted:true},
  ]);
  assert.equal(review.totalPaid,200);
  assert.ok(review.rows.every(x=>x.warning));
});
test('duplicate ID and invalid amount rejected', () => {
  assert.throws(()=>reviewMonthlyExpenses([{id:1,nominal:10},{id:1,nominal:12}]));
  assert.throws(()=>reviewMonthlyExpenses([{id:1,nominal:-1}]));
});
const basic={
  month:'2026-10',actualLaborHours:100,actualMachineHours:70,normalMachineHours:100,
  records:[
    {month:'2026-10',sourceKey:'salary:oct',approved:true,type:'DIRECT_LABOR',amount:4200000},
    {month:'2026-10',sourceKey:'gas-consumption:oct',approved:true,type:'VARIABLE_OH',amount:700000},
    {month:'2026-10',sourceKey:'depreciation:oct',approved:true,type:'FIXED_OH',amount:1000000},
    {month:'2026-10',sourceKey:'office:oct',approved:true,type:'PERIOD_EXPENSE',amount:300000},
  ],
  batches:[{id:1,month:'2026-10',laborHours:30,machineHours:20},
    {id:2,month:'2026-10',laborHours:70,machineHours:50}]
};
test('labor and OH based on documented hours and normal capacity', () => {
  const r=allocateApprovedMonthlyCosts(basic);
  assert.equal(r.allocations[0].directLabor,1260000);
  assert.equal(r.allocations[0].variableOverhead,200000);
  assert.equal(r.allocations[0].fixedOverhead,200000);
  assert.equal(r.unallocated.fixedOverhead,300000);
  assert.equal(r.periodExpense,300000);
  assert.equal(r.reconciles,true);
  assert.equal(r.readyToPost,false);
});
test('partial batch hour tracing does not absorb entire labor cost', () => {
  const r=allocateApprovedMonthlyCosts({...basic,batches:[basic.batches[0]]});
  assert.equal(r.unallocated.directLabor,2940000);
});
test('duplicate sources, unapproved costs and overclaimed hours rejected', () => {
  assert.throws(()=>allocateApprovedMonthlyCosts({...basic,records:[basic.records[0],basic.records[0]]}));
  assert.throws(()=>allocateApprovedMonthlyCosts({...basic,records:[{...basic.records[0],approved:false}]}));
  assert.throws(()=>allocateApprovedMonthlyCosts({...basic,batches:[{...basic.batches[0],laborHours:120}]}));
});
test('fixed OH not overallocated at machine usage above normal', () => {
  const r=allocateApprovedMonthlyCosts({...basic,actualMachineHours:140,normalMachineHours:100});
  assert.equal(r.rates.fixedRate,1000000/140);
  assert.equal(r.reconciles,true);
});
