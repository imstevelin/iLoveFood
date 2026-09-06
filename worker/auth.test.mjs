import assert from 'node:assert/strict';
import test from 'node:test';

import { PASSWORD_ITERATIONS, validateCredentials, validateFavorite } from './auth.mjs';

test('keeps PBKDF2 within the Cloudflare Workers runtime limit', () => {
  assert.equal(PASSWORD_ITERATIONS, 100_000);
});

test('normalizes valid account credentials', () => {
  assert.deepEqual(
    validateCredentials({ username: ' Friendly.User ', password: 'a-safe-password-1' }, true),
    {
      username: 'friendly.user',
      password: 'a-safe-password-1',
      displayName: 'Friendly.User'
    }
  );
});

test('rejects invalid account credentials', () => {
  assert.throws(() => validateCredentials({ username: 'a', password: 'a-safe-password-1' }, true), /3 到 32/);
  assert.throws(() => validateCredentials({ username: 'friendly', password: 'short' }, false), /10 到 128/);
});

test('keeps only validated favorite fields', () => {
  assert.deepEqual(validateFavorite({
    storeName: '全家測試店',
    label: '全家',
    storeFLongitude: 121.5,
    storeFLatitude: 25.1,
    unexpected: 'discarded'
  }), {
    storeName: '全家測試店',
    label: '全家',
    storeFLongitude: 121.5,
    storeFLatitude: 25.1
  });
  assert.throws(() => validateFavorite({ storeName: '' }), /名稱/);
});
