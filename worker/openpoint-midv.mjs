const encoder = new TextEncoder();

const SECRET_NAMES = Object.freeze({
  gid: 'OPENPOINT_GID',
  mid: 'OPENPOINT_MID',
  vcode: 'OPENPOINT_VCODE',
  masterKey: 'OPENPOINT_IMAP_MASTER_KEY'
});

export async function generateMidVFromEnv(env, now = new Date()) {
  const identity = Object.fromEntries(
    Object.entries(SECRET_NAMES).map(([field, secretName]) => [field, readSecret(env, secretName)])
  );
  return generateMidV(identity, now);
}

export async function generateMidV({ gid, mid, vcode, masterKey }, now = new Date()) {
  const masterKeyBytes = encoder.encode(requireValue(masterKey, 'masterKey'));
  if (masterKeyBytes.byteLength < 32) {
    throw new Error('OPENPOINT iMAP master key must contain at least 32 UTF-8 bytes');
  }

  const payload = JSON.stringify({
    GID: requireValue(gid, 'gid'),
    MID: requireValue(mid, 'mid'),
    VCode: requireValue(vcode, 'vcode'),
    TimeStamp: formatTaipeiTimestamp(now)
  });

  // OPENPOINT App 的既有協定固定取相同金鑰的前 12 bytes 當 IV。
  // 這不是新協定應採用的 GCM 設計，但不可改成隨機 IV，否則伺服器無法解密。
  const keyBytes = masterKeyBytes.slice(0, 32);
  const iv = masterKeyBytes.slice(0, 12);
  const key = await globalThis.crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    encoder.encode(payload)
  );

  // Web Crypto 的 AES-GCM 輸出已是 ciphertext + 16-byte authentication tag；
  // 再依已通過 OPENPOINT 實際驗證的 Node 規則輸出無換行標準 Base64。
  return bytesToBase64(new Uint8Array(encrypted));
}

export function formatTaipeiTimestamp(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError('Invalid timestamp');
  const taipei = new Date(date.getTime() + 8 * 60 * 60 * 1_000);
  const pad = value => String(value).padStart(2, '0');
  return `${taipei.getUTCFullYear()}/${pad(taipei.getUTCMonth() + 1)}/${pad(taipei.getUTCDate())} ${pad(taipei.getUTCHours())}:${pad(taipei.getUTCMinutes())}:${pad(taipei.getUTCSeconds())}`;
}

function readSecret(env, name) {
  const value = env?.[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required Worker secret: ${name}`);
  return value.trim();
}

function requireValue(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}
