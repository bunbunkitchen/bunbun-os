import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessBatchCostingSnapshot, assessMaterialValuationCoverage } from '../src/utils/hppBatchAssessment.js';

const sample = { batch: { id: 5, status: 'Finished' },
  materials: [{ id: 2, ingredient_id: 3, qty: 100, unit_value: 11 }],
  splits: [{ id: 1, product_id: 12, qty: 10 }] };

test('a complete-looking batch is still not approved to post', () => {
  const x = assessBatchCostingSnapshot(sample);
  assert.equal(x.costingStatus, 'NEEDS_COST_APPROVAL');
  assert.equal(x.readyToPost, false);
});
test('missing historical unit_value blocks valuation even when batch Finished', () => {
  const x = assessBatchCostingSnapshot({
    ...sample,
    materials: [{ ...sample.materials[0], unit_value: null }],
  });
  assert.equal(x.costingStatus, 'NEEDS_VALUATION');
  assert.deepEqual(x.missingMaterialValues, [2]);
});
test('empty material and split arrays cannot be marked ready', () => {
  const x = assessBatchCostingSnapshot({ batch: { id: 2, status: 'Split' }, materials: [], splits: [] });
  assert.equal(x.costingStatus, 'NEEDS_RECONCILIATION');
  assert.equal(x.warnings.length, 2);
});
test('reject malformed batch input', () => {
  assert.throws(() => assessBatchCostingSnapshot({ batch: null, materials: [], splits: [] }));
});

test('monthly coverage never turns unknown unit values into monetary HPP', () => {
  const x = assessMaterialValuationCoverage([
    { id: 1, qty: 3, unit_value: null },
    { id: 2, qty: 4, unit_value: 1100 },
    { id: 3, qty: 0, unit_value: null },
  ]);
  assert.equal(x.transactionCount, 3);
  assert.equal(x.missingValueCount, 2);
  assert.equal(x.invalidQuantityCount, 1);
  assert.equal(x.monetaryTotal, null);
  assert.equal(x.readyToPost, false);
});
