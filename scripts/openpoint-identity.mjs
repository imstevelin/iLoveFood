#!/usr/bin/env node

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomUUID
} from 'node:crypto';
import { pathToFileURL } from 'node:url';

const CLIENT_ID = '711App';
const REDIRECT_URI = 'seveneleven://711';
const AUTH_BASE = 'https://auth.openpoint.com.tw/SETMemberAuth/';
const MASK_PREFIX = 'IOFT85';
const MASK_SUFFIX = 'mX8pRu';

export function loadOpenPointAuthConfig(env = process.env) {
  const config = {
    clientMima: requireEnv(env, 'OPENPOINT_AUTH_CLIENT_MIMA'),
    aesKey: requireEnv(env, 'OPENPOINT_AUTH_AES_KEY'),
    aesIv: requireEnv(env, 'OPENPOINT_AUTH_AES_IV')
  };
  if (Buffer.byteLength(config.aesKey, 'utf8') !== 32) throw new Error('OPENPOINT_AUTH_AES_KEY must be exactly 32 UTF-8 bytes');
  if (Buffer.byteLength(config.aesIv, 'utf8') !== 16) throw new Error('OPENPOINT_AUTH_AES_IV must be exactly 16 UTF-8 bytes');
  return config;
}

export function generateLoginUrl(config, { now = new Date(), requestId = randomUUID() } = {}) {
  const requestTime = formatTaipeiTimestamp(now);
  const payload = {
    client_id: CLIENT_ID,
    client_mima: config.clientMima,
    request_id: requestId,
    redirect_uri: REDIRECT_URI,
    request_time: requestTime,
    mask: createMask(config, requestId, REDIRECT_URI, requestTime)
  };
  const url = new URL('Auth.html', AUTH_BASE);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('v', encryptJson(payload, config));
  return url.toString();
}

export function parseCallbackUrl(callbackUrl, config) {
  const url = new URL(callbackUrl);
  if (url.protocol !== 'seveneleven:' || url.hostname !== '711') throw new Error('Unexpected callback URL');
  if (url.searchParams.get('return_code') !== '00') throw new Error('OPEN POINT authorization was not successful');
  const encrypted = url.searchParams.get('v');
  if (!encrypted) throw new Error('Callback URL is missing v');

  // URLSearchParams.get() 已完成一次 percent decode，請勿再 decodeURIComponent。
  const auth = decryptJson(encrypted, config);
  requireString(auth.code, 'authorization code');
  requireString(auth.request_id, 'callback request_id');
  return auth;
}

export async function exchangeCallbackForIdentity(callbackUrl, config, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const clock = options.clock || (() => new Date());
  const auth = parseCallbackUrl(callbackUrl, config);
  const requestId = auth.request_id;

  const tokenTime = formatTaipeiTimestamp(clock());
  const tokenResponse = await sendEncryptedRequest('AccessToken.html', {
    client_id: CLIENT_ID,
    client_mima: config.clientMima,
    request_id: requestId,
    code: auth.code,
    request_time: tokenTime,
    mask: createMask(config, requestId, auth.code, tokenTime)
  }, config, fetchImpl);
  const accessToken = requireString(tokenResponse.access_token, 'access_token');

  const midTime = formatTaipeiTimestamp(clock());
  const midResponse = await sendEncryptedRequest('QueryMemberMID.html', {
    client_id: CLIENT_ID,
    client_mima: config.clientMima,
    request_id: requestId,
    access_token: accessToken,
    request_time: midTime,
    mask: createMask(config, requestId, accessToken, midTime)
  }, config, fetchImpl);
  const mid = requireString(midResponse.mid, 'MID');

  const createIdentityRequest = () => {
    const requestTime = formatTaipeiTimestamp(clock());
    return {
      client_id: CLIENT_ID,
      client_mima: config.clientMima,
      request_id: requestId,
      access_token: accessToken,
      mid,
      request_time: requestTime,
      mask: createMask(config, requestId, accessToken, mid, requestTime)
    };
  };
  const [gidResponse, vcodeResponse] = await Promise.all([
    sendEncryptedRequest('QueryMemberGID.html', createIdentityRequest(), config, fetchImpl),
    sendEncryptedRequest('QueryMemberVcode.html', createIdentityRequest(), config, fetchImpl)
  ]);

  return {
    GID: requireString(gidResponse.gid, 'GID'),
    MID: mid,
    VCode: requireString(vcodeResponse.vcode, 'VCode')
  };
}

export function createMask(config, ...parts) {
  return createHash('md5')
    .update(MASK_PREFIX + CLIENT_ID + config.clientMima + parts.join('') + MASK_SUFFIX, 'utf8')
    .digest('hex');
}

export function encryptJson(payload, config) {
  const cipher = createCipheriv('aes-256-cbc', Buffer.from(config.aesKey, 'utf8'), Buffer.from(config.aesIv, 'utf8'));
  return Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]).toString('base64');
}

export function decryptJson(ciphertext, config) {
  const decipher = createDecipheriv('aes-256-cbc', Buffer.from(config.aesKey, 'utf8'), Buffer.from(config.aesIv, 'utf8'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext.trim(), 'base64')),
    decipher.final()
  ]).toString('utf8');
  return JSON.parse(plaintext);
}

export function formatTaipeiTimestamp(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError('Invalid timestamp');
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

async function sendEncryptedRequest(endpoint, payload, config, fetchImpl) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    v: encryptJson(payload, config)
  });
  const response = await fetchImpl(new URL(endpoint, AUTH_BASE), {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/plain, */*',
      'User-Agent': '711App/5.73.0'
    },
    body: body.toString()
  });
  if (!response.ok) throw new Error(`OPEN POINT ${endpoint} returned HTTP ${response.status}`);
  return decryptJson(await response.text(), config);
}

function requireEnv(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return value.trim();
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value) throw new Error(`OPEN POINT response is missing ${name}`);
  return value;
}

function printHelp() {
  console.log(`Usage:
  node scripts/openpoint-identity.mjs login-url
  node scripts/openpoint-identity.mjs exchange '<seveneleven:// callback URL>'

Required environment variables:
  OPENPOINT_AUTH_CLIENT_MIMA
  OPENPOINT_AUTH_AES_KEY
  OPENPOINT_AUTH_AES_IV`);
}

async function main() {
  const [command, value] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  const config = loadOpenPointAuthConfig();
  if (command === 'login-url') {
    console.log(generateLoginUrl(config));
    return;
  }
  if (command === 'exchange') {
    if (!value) throw new Error('exchange requires the complete seveneleven:// callback URL');
    console.log(JSON.stringify(await exchangeCallbackForIdentity(value, config), null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
