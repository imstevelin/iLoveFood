import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import test from 'node:test';

import { formatTaipeiTimestamp, generateMidV, generateMidVFromEnv } from './openpoint-midv.mjs';

const fixture = Object.freeze({
  gid: 'GID00000000000000',
  mid: '00000000000000000000000000000000',
  vcode: '00000000000000',
  masterKey: '01234567-89ab-cdef-0123-456789abcdef'
});
const now = new Date('2026-09-05T04:34:56.789Z');

test('formats the timestamp in Asia/Taipei regardless of the host timezone', () => {
  assert.equal(formatTaipeiTimestamp(now), '2026/09/05 12:34:56');
});

test('matches the independently implemented Node AES-256-GCM result', async () => {
  const actual = await generateMidV(fixture, now);
  const payload = JSON.stringify({
    GID: fixture.gid,
    MID: fixture.mid,
    VCode: fixture.vcode,
    TimeStamp: '2026/09/05 12:34:56'
  });
  const key = Buffer.from(fixture.masterKey, 'utf8').subarray(0, 32);
  const iv = Buffer.from(fixture.masterKey, 'utf8').subarray(0, 12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const expected = Buffer.concat([
    cipher.update(payload, 'utf8'),
    cipher.final(),
    cipher.getAuthTag()
  ]).toString('base64');

  assert.equal(actual, expected);
  assert.doesNotMatch(actual, /[\r\n]/);
});

test('reads the identity only from the required Worker secrets', async () => {
  const env = {
    OPENPOINT_GID: ` ${fixture.gid} `,
    OPENPOINT_MID: fixture.mid,
    OPENPOINT_VCODE: fixture.vcode,
    OPENPOINT_IMAP_MASTER_KEY: fixture.masterKey
  };
  assert.equal(await generateMidVFromEnv(env, now), await generateMidV(fixture, now));
});

test('rejects missing secrets and undersized keys without exposing values', async () => {
  await assert.rejects(generateMidVFromEnv({}, now), /OPENPOINT_GID/);
  await assert.rejects(generateMidV({ ...fixture, masterKey: 'too-short' }, now), /at least 32/);
});
