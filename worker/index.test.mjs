import assert from 'node:assert/strict';
import test from 'node:test';

import { validateBatchSearchBody } from './index.js';

const location = {
  CurrentLocation: { Latitude: 25.033, Longitude: 121.5654 },
  SearchLocation: { Latitude: 25.033, Longitude: 121.5654 }
};

test('accepts a bounded Taiwan nearby-search batch', () => {
  const result = validateBatchSearchBody({
    sevenEleven: [location],
    familyMart: [{ Latitude: 25.033, Longitude: 121.5654 }]
  });

  assert.equal(result.sevenEleven.length, 1);
  assert.equal(result.familyMart.length, 1);
});

test('rejects empty, oversized, and out-of-region nearby-search batches', () => {
  assert.throws(() => validateBatchSearchBody({}), /required/);
  assert.throws(() => validateBatchSearchBody({
    sevenEleven: Array.from({ length: 13 }, () => location)
  }), /Too many/);
  assert.throws(() => validateBatchSearchBody({
    familyMart: [{ Latitude: 35, Longitude: 139 }]
  }), /within Taiwan/);
});
