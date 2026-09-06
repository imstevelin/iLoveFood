const SESSION_COOKIE = 'ilovefood_session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
// Cloudflare Workers Web Crypto rejects PBKDF2 requests above 100,000 iterations.
export const PASSWORD_ITERATIONS = 100_000;
const MAX_AUTH_BODY_BYTES = 4_096;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const DUMMY_PASSWORD_SALT = 'aUxvdmVGb29kLWR1bW15LXNhbHQ';
const DUMMY_PASSWORD_HASH = 'BZHhH3KIbLxGgMQSZhwdul7gfL0LX_eGpr8zVM8bNC8';

export async function handleAuthRequest(request, env, pathname) {
  if (pathname === '/api/auth/session' && request.method === 'GET') {
    const user = await getSessionUser(request, env);
    return noStoreJson({ user });
  }

  if (pathname === '/api/auth/register' && request.method === 'POST') {
    const body = await readAuthBody(request);
    const account = validateCredentials(body, true);
    const now = Math.floor(Date.now() / 1000);
    const userId = crypto.randomUUID();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const passwordHash = await derivePassword(account.password, salt, PASSWORD_ITERATIONS);
    const session = await createSessionRecord(userId, now);

    try {
      await env.AUTH_DB.batch([
        env.AUTH_DB.prepare(
          `INSERT INTO users
            (id, username, display_name, password_hash, password_salt, password_iterations, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        ).bind(
          userId,
          account.username,
          account.displayName,
          toBase64Url(passwordHash),
          toBase64Url(salt),
          PASSWORD_ITERATIONS,
          now
        ),
        env.AUTH_DB.prepare(
          `INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
           VALUES (?1, ?2, ?3, ?4)`
        ).bind(session.tokenHash, userId, session.expiresAt, now)
      ]);
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw authError(409, 'account-exists', '此帳號已被使用');
      throw error;
    }

    return authSuccess(
      { uid: userId, username: account.username, displayName: account.displayName },
      session.token,
      request.url
    );
  }

  if (pathname === '/api/auth/login' && request.method === 'POST') {
    const body = await readAuthBody(request);
    const account = validateCredentials(body, false);
    const row = await env.AUTH_DB.prepare(
      `SELECT id, username, display_name, password_hash, password_salt, password_iterations
       FROM users WHERE username = ?1 LIMIT 1`
    ).bind(account.username).first();

    const salt = fromBase64Url(row?.password_salt || DUMMY_PASSWORD_SALT);
    const expectedHash = fromBase64Url(row?.password_hash || DUMMY_PASSWORD_HASH);
    const derivedHash = await derivePassword(
      account.password,
      salt,
      Number(row?.password_iterations || PASSWORD_ITERATIONS)
    );

    if (!row || expectedHash.byteLength !== derivedHash.byteLength ||
        !crypto.subtle.timingSafeEqual(expectedHash, derivedHash)) {
      throw authError(401, 'invalid-credentials', '帳號或密碼不正確');
    }

    const now = Math.floor(Date.now() / 1000);
    const session = await createSessionRecord(String(row.id), now);
    await env.AUTH_DB.batch([
      env.AUTH_DB.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now),
      env.AUTH_DB.prepare(
        `INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4)`
      ).bind(session.tokenHash, String(row.id), session.expiresAt, now)
    ]);

    return authSuccess(
      {
        uid: String(row.id),
        username: String(row.username),
        displayName: String(row.display_name)
      },
      session.token,
      request.url
    );
  }

  if (pathname === '/api/auth/logout' && request.method === 'POST') {
    const token = readCookie(request, SESSION_COOKIE);
    if (token) {
      await env.AUTH_DB.prepare('DELETE FROM sessions WHERE token_hash = ?1')
        .bind(await hashToken(token))
        .run();
    }
    return noStoreJson({ success: true }, 200, {
      'Set-Cookie': clearSessionCookie(request.url)
    });
  }

  throw authError(404, 'not-found', 'Not found');
}

export async function handleFavoritesRequest(request, env, pathname) {
  const user = await requireSessionUser(request, env);

  if (pathname === '/api/favorites' && request.method === 'GET') {
    const result = await env.AUTH_DB.prepare(
      'SELECT payload FROM favorites WHERE user_id = ?1 ORDER BY updated_at DESC'
    ).bind(user.uid).all();
    const favorites = result.results.flatMap(row => {
      try {
        return [JSON.parse(String(row.payload))];
      } catch {
        return [];
      }
    });
    return noStoreJson({ favorites });
  }

  const match = pathname.match(/^\/api\/favorites\/([^/]{1,1440})$/);
  if (!match) throw authError(404, 'not-found', 'Not found');
  let storeKey;
  try {
    storeKey = decodeURIComponent(match[1]);
  } catch {
    throw authError(400, 'invalid-favorite', '收藏資料格式不正確');
  }
  if (!storeKey || storeKey.length > 160) throw authError(400, 'invalid-favorite', '收藏資料格式不正確');

  if (request.method === 'PUT') {
    const favorite = validateFavorite(await readAuthBody(request));
    const now = Math.floor(Date.now() / 1000);
    await env.AUTH_DB.prepare(
      `INSERT INTO favorites (user_id, store_key, payload, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT(user_id, store_key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
    ).bind(user.uid, storeKey, JSON.stringify(favorite), now).run();
    return noStoreJson({ favorite });
  }

  if (request.method === 'DELETE') {
    await env.AUTH_DB.prepare('DELETE FROM favorites WHERE user_id = ?1 AND store_key = ?2')
      .bind(user.uid, storeKey)
      .run();
    return noStoreJson({ success: true });
  }

  throw authError(405, 'method-not-allowed', 'Method not allowed');
}

export function validateCredentials(body, isRegistration) {
  const rawUsername = typeof body?.username === 'string' ? body.username.normalize('NFKC').trim() : '';
  const username = rawUsername.toLowerCase();
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!USERNAME_PATTERN.test(username)) {
    throw authError(400, 'invalid-username', '帳號需為 3 到 32 個英文字母、數字、句點、底線或連字號');
  }
  if (password.length < 10 || password.length > 128) {
    throw authError(400, 'invalid-password', '密碼長度需為 10 到 128 個字元');
  }

  return {
    username,
    password,
    displayName: isRegistration ? rawUsername : username
  };
}

export function validateFavorite(body) {
  const favorite = {};
  const storeName = typeof body?.storeName === 'string' ? body.storeName.trim() : '';
  if (!storeName || storeName.length > 120) {
    throw authError(400, 'invalid-favorite', '收藏門市名稱格式不正確');
  }
  favorite.storeName = storeName;

  if (body.store711Name !== undefined) {
    if (typeof body.store711Name !== 'string' || body.store711Name.length > 120) {
      throw authError(400, 'invalid-favorite', '7-ELEVEN 門市資料格式不正確');
    }
    favorite.store711Name = body.store711Name;
  }
  if (body.label !== undefined) {
    if (body.label !== '7-11' && body.label !== '全家') {
      throw authError(400, 'invalid-favorite', '門市品牌格式不正確');
    }
    favorite.label = body.label;
  }
  for (const key of ['storeFLongitude', 'storeFLatitude']) {
    if (body[key] !== undefined) {
      const value = Number(body[key]);
      if (!Number.isFinite(value)) throw authError(400, 'invalid-favorite', '門市座標格式不正確');
      if (key === 'storeFLongitude' && (value < 118 || value > 123)) {
        throw authError(400, 'invalid-favorite', '門市座標格式不正確');
      }
      if (key === 'storeFLatitude' && (value < 20 || value > 27)) {
        throw authError(400, 'invalid-favorite', '門市座標格式不正確');
      }
      favorite[key] = value;
    }
  }
  return favorite;
}

async function requireSessionUser(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) throw authError(401, 'not-authenticated', '請先登入');
  return user;
}

async function getSessionUser(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || token.length > 128) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = await env.AUTH_DB.prepare(
    `SELECT users.id, users.username, users.display_name
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ?1 AND sessions.expires_at > ?2 LIMIT 1`
  ).bind(await hashToken(token), now).first();
  if (!row) return null;
  return {
    uid: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name)
  };
}

async function createSessionRecord(userId, now) {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  return {
    token,
    tokenHash: await hashToken(token),
    userId,
    expiresAt: now + SESSION_TTL_SECONDS
  };
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toBase64Url(new Uint8Array(digest));
}

async function derivePassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

async function readAuthBody(request) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > MAX_AUTH_BODY_BYTES) {
    throw authError(413, 'request-too-large', 'Request body too large');
  }
  const text = await request.text();
  if (text.length > MAX_AUTH_BODY_BYTES) {
    throw authError(413, 'request-too-large', 'Request body too large');
  }
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw authError(400, 'invalid-json', 'Invalid JSON');
  }
}

function readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return '';
}

function sessionCookie(token, requestUrl) {
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

function clearSessionCookie(requestUrl) {
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

function authSuccess(user, token, requestUrl) {
  return noStoreJson({ user }, 200, { 'Set-Cookie': sessionCookie(token, requestUrl) });
}

function noStoreJson(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    }
  });
}

function authError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
