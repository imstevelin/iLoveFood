import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createMask,
  decryptJson,
  encryptJson,
  exchangeCallbackForIdentity,
  formatTaipeiTimestamp,
  generateLoginUrl,
  loadOpenPointAuthConfig,
  parseCallbackUrl
} from './openpoint-identity.mjs';

const config = Object.freeze({
  clientMima: 'test-client-secret',
  aesKey: '0123456789abcdef0123456789abcdef',
  aesIv: '0123456789abcdef'
});
const requestId = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-09-04T22:15:50Z');

test('creates an App-compatible login request that decrypts cleanly', () => {
  const url = new URL(generateLoginUrl(config, { now, requestId }));
  const payload = decryptJson(url.searchParams.get('v'), config);
  assert.equal(url.origin + url.pathname, 'https://auth.openpoint.com.tw/SETMemberAuth/Auth.html');
  assert.equal(payload.request_id, requestId);
  assert.equal(payload.request_time, '20260905061550');
  assert.equal(payload.redirect_uri, 'seveneleven://711');
  assert.equal(payload.mask, createMask(config, requestId, payload.redirect_uri, payload.request_time));
});

test('parses an authorized callback without double URL decoding', () => {
  const encrypted = encryptJson({ code: 'code+/=', request_id: requestId }, config);
  const callback = new URL('seveneleven://711');
  callback.searchParams.set('return_code', '00');
  callback.searchParams.set('v', encrypted);
  assert.equal(parseCallbackUrl(callback.toString(), config).code, 'code+/=');
});

test('exchanges code, token and MID in the verified API order', async () => {
  const callback = new URL('seveneleven://711');
  callback.searchParams.set('return_code', '00');
  callback.searchParams.set('v', encryptJson({ code: 'auth-code', request_id: requestId }, config));
  const calls = [];
  const responses = {
    'AccessToken.html': { access_token: 'access-token' },
    'QueryMemberMID.html': { mid: 'member-id' },
    'QueryMemberGID.html': { gid: 'group-id' },
    'QueryMemberVcode.html': { vcode: 'verification-code' }
  };
  const fetchImpl = async (url, init) => {
    const endpoint = new URL(url).pathname.split('/').pop();
    const payload = decryptJson(new URLSearchParams(init.body).get('v'), config);
    calls.push({ endpoint, payload });
    return new Response(encryptJson(responses[endpoint], config));
  };

  const identity = await exchangeCallbackForIdentity(callback.toString(), config, {
    fetchImpl,
    clock: () => now
  });
  assert.deepEqual(identity, { GID: 'group-id', MID: 'member-id', VCode: 'verification-code' });
  assert.deepEqual(calls.map(call => call.endpoint), [
    'AccessToken.html',
    'QueryMemberMID.html',
    'QueryMemberGID.html',
    'QueryMemberVcode.html'
  ]);

  for (const { payload } of calls) {
    const values = payload.mid
      ? [requestId, payload.access_token, payload.mid, payload.request_time]
      : payload.access_token
        ? [requestId, payload.access_token, payload.request_time]
        : [requestId, payload.code, payload.request_time];
    const expected = createHash('md5')
      .update('IOFT85' + '711App' + config.clientMima + values.join('') + 'mX8pRu')
      .digest('hex');
    assert.equal(payload.mask, expected);
  }
});

test('rejects failed callbacks and invalid secret lengths', () => {
  assert.throws(
    () => parseCallbackUrl('seveneleven://711?return_code=01&v=x', config),
    /not successful/
  );
  assert.throws(
    () => loadOpenPointAuthConfig({
      OPENPOINT_AUTH_CLIENT_MIMA: 'x',
      OPENPOINT_AUTH_AES_KEY: 'short',
      OPENPOINT_AUTH_AES_IV: '0123456789abcdef'
    }),
    /exactly 32/
  );
});

test('formats authentication timestamps in Asia/Taipei', () => {
  assert.equal(formatTaipeiTimestamp(now), '20260905061550');
});
